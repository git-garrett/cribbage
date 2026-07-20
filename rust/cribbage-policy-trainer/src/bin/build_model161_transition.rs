//! Resumable exact-transition compiler for the first Model 16.1 reference
//! asset. It evaluates the final Model 16 policy through the engine-owned
//! legal-information adapter, never by selecting from a simulated opponent's
//! private cards.

use cribbage_shadow_engine::information_set::{PegSeat, RankPegAction, RankPegState};
use cribbage_shadow_engine::model::{model16_policy_action_from_rank_state, Model16PolicySource};
use cribbage_shadow_engine::policy::PolicyArtifact;
use cribbage_shadow_engine::policy_transition::{
    TransitionArtifactHeader, TransitionRecord, TransitionScoreContext, TRANSITION_EVENT_CAPACITY,
};
use cribbage_shadow_engine::{board::Role, cards};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process;
use std::time::Instant;

const STATUS_FILE: &str = "status.json";
const CHECKPOINT_FILE: &str = "checkpoint.txt";
const RECORD_FILE: &str = "records.bin";

#[derive(Clone, Debug)]
struct Config {
    policy: PathBuf,
    output: PathBuf,
    contexts: Vec<TransitionScoreContext>,
    resume: bool,
    status_every: usize,
    max_units: Option<usize>,
}

#[derive(Clone, Debug)]
struct Checkpoint {
    policy_checksum: u64,
    completed_units: usize,
    target_units: usize,
    record_count: u64,
    bytes_written: u64,
}

fn main() {
    let config = match parse_args(env::args().skip(1).collect()) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{}", error);
            print_usage();
            process::exit(2);
        }
    };
    if let Err(error) = run(&config) {
        eprintln!("{}", error);
        process::exit(1);
    }
}

fn run(config: &Config) -> Result<(), String> {
    let policy = PolicyArtifact::load(&config.policy)?;
    let policy_checksum = policy.checksum()?;
    let keeps = cards::enumerate_rank_count_keys(4)
        .iter()
        .map(|key| cards::rank_counts_from_key(key))
        .collect::<Result<Vec<_>, _>>()?;
    let available_units = keeps.len() * 2;
    let target_units = config
        .max_units
        .unwrap_or(available_units)
        .min(available_units);
    let header = TransitionArtifactHeader {
        policy_checksum,
        contexts: config.contexts.clone(),
    };
    fs::create_dir_all(&config.output)
        .map_err(|error| format!("create {} failed: {}", config.output.display(), error))?;
    let record_path = config.output.join(RECORD_FILE);
    let mut checkpoint = if config.resume {
        let checkpoint = read_checkpoint(&config.output.join(CHECKPOINT_FILE))?;
        if checkpoint.policy_checksum != policy_checksum {
            return Err("resume policy checksum does not match the requested policy".to_string());
        }
        if checkpoint.target_units != target_units {
            return Err("resume target-unit count does not match the requested build".to_string());
        }
        verify_header(&record_path, &header)?;
        let metadata = fs::metadata(&record_path)
            .map_err(|error| format!("stat {} failed: {}", record_path.display(), error))?;
        if metadata.len() < checkpoint.bytes_written {
            return Err("transition record file is shorter than its checkpoint".to_string());
        }
        checkpoint
    } else {
        if record_path.exists() || config.output.join(CHECKPOINT_FILE).exists() {
            return Err(format!(
                "{} already contains a build; use --resume or choose a new output directory",
                config.output.display()
            ));
        }
        let mut file = File::create(&record_path)
            .map_err(|error| format!("create {} failed: {}", record_path.display(), error))?;
        header.write_to(&mut file)?;
        file.sync_all()
            .map_err(|error| format!("sync {} failed: {}", record_path.display(), error))?;
        Checkpoint {
            policy_checksum,
            completed_units: 0,
            target_units,
            record_count: 0,
            bytes_written: header.encoded_len() as u64,
        }
    };
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&record_path)
        .map_err(|error| format!("open {} failed: {}", record_path.display(), error))?;
    file.set_len(checkpoint.bytes_written)
        .map_err(|error| format!("truncate {} failed: {}", record_path.display(), error))?;
    file.seek(SeekFrom::End(0))
        .map_err(|error| format!("seek {} failed: {}", record_path.display(), error))?;

    let started = Instant::now();
    write_status(config, &checkpoint, started.elapsed(), "running", None)?;
    for unit in checkpoint.completed_units..target_units {
        let (role, own_keep_id) = work_unit(unit, keeps.len());
        let own = keeps[own_keep_id];
        let mut bytes = Vec::new();
        let mut rows = 0_u64;
        for (opponent_keep_id, opponent) in keeps.iter().copied().enumerate() {
            if !compatible(own, opponent) {
                continue;
            }
            for (context_id, context) in config.contexts.iter().copied().enumerate() {
                let record = compile_record(
                    own_keep_id,
                    opponent_keep_id,
                    context_id,
                    role,
                    own,
                    opponent,
                    context,
                    &policy,
                )?;
                bytes.extend_from_slice(&record.encode()?);
                rows += 1;
            }
        }
        file.write_all(&bytes)
            .map_err(|error| format!("append {} failed: {}", record_path.display(), error))?;
        checkpoint.completed_units = unit + 1;
        checkpoint.record_count += rows;
        checkpoint.bytes_written += bytes.len() as u64;
        let checkpoint_due = checkpoint.completed_units == target_units
            || checkpoint.completed_units % config.status_every == 0;
        if checkpoint_due {
            file.sync_all()
                .map_err(|error| format!("sync {} failed: {}", record_path.display(), error))?;
            write_checkpoint(&config.output.join(CHECKPOINT_FILE), &checkpoint)?;
            write_status(config, &checkpoint, started.elapsed(), "running", None)?;
        }
    }
    file.sync_all()
        .map_err(|error| format!("sync {} failed: {}", record_path.display(), error))?;
    write_checkpoint(&config.output.join(CHECKPOINT_FILE), &checkpoint)?;
    let checksum = fnv1a64_file(&record_path)?;
    write_status(
        config,
        &checkpoint,
        started.elapsed(),
        "complete",
        Some(checksum),
    )?;
    println!(
        "state=complete units={}/{} records={} bytes={} checksum={:016x} status={}",
        checkpoint.completed_units,
        checkpoint.target_units,
        checkpoint.record_count,
        checkpoint.bytes_written,
        checksum,
        config.output.join(STATUS_FILE).display()
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn compile_record(
    own_keep_id: usize,
    opponent_keep_id: usize,
    context_id: usize,
    role: Role,
    own: [u8; 13],
    opponent: [u8; 13],
    context: TransitionScoreContext,
    policy: &PolicyArtifact,
) -> Result<TransitionRecord, String> {
    let dealer = if role == Role::Dealer {
        PegSeat::Zero
    } else {
        PegSeat::One
    };
    let mut state = RankPegState {
        hands: [own, opponent],
        own_discards: [[0_u8; 13]; 2],
        turn_rank: 0,
        scores: [
            i32::from(context.own_score),
            i32::from(context.opponent_score),
        ],
        dealer,
        current: dealer.other(),
        plays: Vec::new(),
        count: 0,
        go_player: None,
        last_player: None,
        history: Vec::new(),
        winner: None,
        complete: false,
    };
    let mut events = [0_u8; TRANSITION_EVENT_CAPACITY];
    let mut event_len = 0_usize;
    let mut learned_actions = 0_u8;
    let mut fallback_actions = 0_u8;
    while !state.complete && state.winner.is_none() {
        let actor = state.current;
        let action = model16_policy_action_from_rank_state(&state, actor, Some(policy))?;
        if matches!(action.action, RankPegAction::Play(_)) {
            match action.source {
                Model16PolicySource::Learned => learned_actions = learned_actions.saturating_add(1),
                Model16PolicySource::Fallback => {
                    fallback_actions = fallback_actions.saturating_add(1)
                }
            }
        }
        let before = state.scores;
        let points = state.apply(action.action)?;
        if points > 0 {
            let scorer = if state.scores[PegSeat::Zero.index()] > before[PegSeat::Zero.index()] {
                PegSeat::Zero
            } else if state.scores[PegSeat::One.index()] > before[PegSeat::One.index()] {
                PegSeat::One
            } else {
                return Err("pegging simulation reported points without a scorer".to_string());
            };
            if event_len == TRANSITION_EVENT_CAPACITY {
                return Err("pegging transition exceeded event capacity".to_string());
            }
            events[event_len] = (if scorer == PegSeat::One { 0x80 } else { 0 }) | points as u8;
            event_len += 1;
        }
    }
    Ok(TransitionRecord {
        own_keep_id: u16::try_from(own_keep_id)
            .map_err(|_| "own keep id does not fit transition record".to_string())?,
        opponent_keep_id: u16::try_from(opponent_keep_id)
            .map_err(|_| "opponent keep id does not fit transition record".to_string())?,
        context_id: u16::try_from(context_id)
            .map_err(|_| "transition context id does not fit record".to_string())?,
        role: if role == Role::Dealer { 1 } else { 0 },
        event_len: event_len as u8,
        events,
        learned_actions,
        fallback_actions,
    })
}

fn compatible(left: [u8; 13], right: [u8; 13]) -> bool {
    left.iter()
        .zip(right)
        .all(|(left_count, right_count)| left_count + right_count <= 4)
}

fn work_unit(unit: usize, keep_count: usize) -> (Role, usize) {
    if unit < keep_count {
        (Role::Pone, unit)
    } else {
        (Role::Dealer, unit - keep_count)
    }
}

fn write_checkpoint(path: &Path, checkpoint: &Checkpoint) -> Result<(), String> {
    let contents = format!(
        concat!(
            "policyChecksum={:016x}\n",
            "completedUnits={}\n",
            "targetUnits={}\n",
            "recordCount={}\n",
            "bytesWritten={}\n"
        ),
        checkpoint.policy_checksum,
        checkpoint.completed_units,
        checkpoint.target_units,
        checkpoint.record_count,
        checkpoint.bytes_written
    );
    atomic_write(path, contents.as_bytes())
}

fn read_checkpoint(path: &Path) -> Result<Checkpoint, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("read {} failed: {}", path.display(), error))?;
    let mut policy_checksum = None;
    let mut completed_units = None;
    let mut target_units = None;
    let mut record_count = None;
    let mut bytes_written = None;
    for line in contents.lines() {
        let Some((key, value)) = line.split_once('=') else {
            return Err(format!("invalid checkpoint line {}", line));
        };
        match key {
            "policyChecksum" => {
                policy_checksum = Some(u64::from_str_radix(value, 16).map_err(|error| {
                    format!("invalid checkpoint policy checksum {}: {}", value, error)
                })?)
            }
            "completedUnits" => completed_units = Some(parse_usize(value, key)?),
            "targetUnits" => target_units = Some(parse_usize(value, key)?),
            "recordCount" => record_count = Some(parse_u64(value, key)?),
            "bytesWritten" => bytes_written = Some(parse_u64(value, key)?),
            other => return Err(format!("unknown checkpoint field {}", other)),
        }
    }
    Ok(Checkpoint {
        policy_checksum: policy_checksum
            .ok_or_else(|| "checkpoint lacks policy checksum".to_string())?,
        completed_units: completed_units
            .ok_or_else(|| "checkpoint lacks completed units".to_string())?,
        target_units: target_units.ok_or_else(|| "checkpoint lacks target units".to_string())?,
        record_count: record_count.ok_or_else(|| "checkpoint lacks record count".to_string())?,
        bytes_written: bytes_written.ok_or_else(|| "checkpoint lacks byte count".to_string())?,
    })
}

fn verify_header(path: &Path, expected: &TransitionArtifactHeader) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|error| format!("open {} failed: {}", path.display(), error))?;
    let actual = TransitionArtifactHeader::read_from(&mut file)?;
    if &actual != expected {
        return Err(
            "resume artifact header does not match requested policy or contexts".to_string(),
        );
    }
    Ok(())
}

fn write_status(
    config: &Config,
    checkpoint: &Checkpoint,
    elapsed: std::time::Duration,
    state: &str,
    output_checksum: Option<u64>,
) -> Result<(), String> {
    let rate = if elapsed.is_zero() {
        0.0
    } else {
        checkpoint.completed_units as f64 / elapsed.as_secs_f64()
    };
    let eta_seconds = if rate > 0.0 {
        checkpoint
            .target_units
            .saturating_sub(checkpoint.completed_units) as f64
            / rate
    } else {
        0.0
    };
    let contexts = config
        .contexts
        .iter()
        .map(|context| format!("[{},{}]", context.own_score, context.opponent_score))
        .collect::<Vec<_>>()
        .join(",");
    let checksum = output_checksum
        .map(|value| format!("\"{:016x}\"", value))
        .unwrap_or_else(|| "null".to_string());
    let contents = format!(
        concat!(
            "{{\n",
            "  \"state\": \"{}\",\n",
            "  \"policy\": \"{}\",\n",
            "  \"policyChecksum\": \"{:016x}\",\n",
            "  \"contexts\": [{}],\n",
            "  \"targetUnits\": {},\n",
            "  \"completedUnits\": {},\n",
            "  \"recordCount\": {},\n",
            "  \"bytesWritten\": {},\n",
            "  \"elapsedSeconds\": {:.6},\n",
            "  \"unitsPerSecond\": {:.6},\n",
            "  \"etaSeconds\": {:.3},\n",
            "  \"outputChecksum\": {}\n",
            "}}\n"
        ),
        state,
        json_escape(&config.policy.display().to_string()),
        checkpoint.policy_checksum,
        contexts,
        checkpoint.target_units,
        checkpoint.completed_units,
        checkpoint.record_count,
        checkpoint.bytes_written,
        elapsed.as_secs_f64(),
        rate,
        eta_seconds,
        checksum,
    );
    atomic_write(&config.output.join(STATUS_FILE), contents.as_bytes())
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    let mut file = File::create(&temporary)
        .map_err(|error| format!("create {} failed: {}", temporary.display(), error))?;
    file.write_all(contents)
        .map_err(|error| format!("write {} failed: {}", temporary.display(), error))?;
    file.sync_all()
        .map_err(|error| format!("sync {} failed: {}", temporary.display(), error))?;
    fs::rename(&temporary, path).map_err(|error| {
        format!(
            "rename {} to {} failed: {}",
            temporary.display(),
            path.display(),
            error
        )
    })
}

fn fnv1a64_file(path: &Path) -> Result<u64, String> {
    let mut file =
        File::open(path).map_err(|error| format!("open {} failed: {}", path.display(), error))?;
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("read {} failed: {}", path.display(), error))?;
        if count == 0 {
            return Ok(hash);
        }
        for byte in &buffer[..count] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
}

fn parse_args(args: Vec<String>) -> Result<Config, String> {
    let mut policy = None;
    let mut output = None;
    let mut contexts = None;
    let mut resume = false;
    let mut status_every = 10_usize;
    let mut max_units = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--resume" => {
                resume = true;
                index += 1;
            }
            "--policy" => policy = Some(PathBuf::from(argument(&args, &mut index, "--policy")?)),
            "--output" => output = Some(PathBuf::from(argument(&args, &mut index, "--output")?)),
            "--contexts" => {
                contexts = Some(parse_contexts(&argument(&args, &mut index, "--contexts")?)?)
            }
            "--status-every" => {
                status_every =
                    parse_usize(&argument(&args, &mut index, "--status-every")?, "status")?;
                if status_every == 0 {
                    return Err("--status-every must be positive".to_string());
                }
            }
            "--max-units" => {
                max_units = Some(parse_usize(
                    &argument(&args, &mut index, "--max-units")?,
                    "max units",
                )?)
            }
            other => return Err(format!("unknown argument {}", other)),
        }
    }
    Ok(Config {
        policy: policy.ok_or_else(|| "--policy is required".to_string())?,
        output: output.ok_or_else(|| "--output is required".to_string())?,
        contexts: contexts.ok_or_else(|| "--contexts is required".to_string())?,
        resume,
        status_every,
        max_units,
    })
}

fn argument(args: &[String], index: &mut usize, option: &str) -> Result<String, String> {
    *index += 1;
    let value = args
        .get(*index)
        .cloned()
        .ok_or_else(|| format!("{} requires a value", option))?;
    *index += 1;
    Ok(value)
}

fn parse_contexts(value: &str) -> Result<Vec<TransitionScoreContext>, String> {
    let mut contexts = Vec::new();
    for pair in value.split(',') {
        let Some((own, opponent)) = pair.split_once(':') else {
            return Err(format!(
                "invalid score context {}; expected own:opponent",
                pair
            ));
        };
        let context = TransitionScoreContext {
            own_score: own
                .parse::<u8>()
                .map_err(|error| format!("invalid own score {}: {}", own, error))?,
            opponent_score: opponent
                .parse::<u8>()
                .map_err(|error| format!("invalid opponent score {}: {}", opponent, error))?,
        };
        if context.own_score > 120 || context.opponent_score > 120 {
            return Err(format!("score context {} exceeds 120", pair));
        }
        if contexts.contains(&context) {
            return Err(format!("duplicate score context {}", pair));
        }
        contexts.push(context);
    }
    if contexts.is_empty() {
        return Err("at least one score context is required".to_string());
    }
    Ok(contexts)
}

fn parse_usize(value: &str, label: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|error| format!("invalid {} {}: {}", label, value, error))
}

fn parse_u64(value: &str, label: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|error| format!("invalid {} {}: {}", label, value, error))
}

fn json_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

fn print_usage() {
    eprintln!(
        "usage: build_model161_transition --policy FILE --output DIRECTORY --contexts OWN:OPP[,OWN:OPP...] [--resume] [--status-every UNITS] [--max-units UNITS]"
    );
}
