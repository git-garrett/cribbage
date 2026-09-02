//! Resumable Model 9.11 four-keep by four-keep pair builder.
//!
//! Every durable row is fsynced before its atomic checkpoint advances. Resume
//! truncates any uncheckpointed tail, so interruption can repeat at most one
//! dealer-keep row and can never duplicate or skip a matrix cell.

use cribbage_shadow_engine::cards::{enumerate_rank_count_keys, rank_counts_from_key};
use cribbage_shadow_engine::model132::{
    rollout_model911_pair, Model1322DeclineFactors, Model911Policy,
};
use cribbage_shadow_engine::model91::{Model91EmpiricalBeliefs, Model91PolicyStats};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process;
use std::time::Instant;

const MAGIC: &[u8; 8] = b"M911PR01";
const VERSION: u32 = 1;
const HEADER_BYTES: usize = 56;
const RECORD_BYTES: usize = 2;
const INVALID_PAIR: u16 = u16::MAX;
const KEEP_COUNT: usize = 1_820;
const PAIR_FILE: &str = "pair-outcomes.bin";
const CHECKPOINT_FILE: &str = "checkpoint.json";
const STATUS_FILE: &str = "status.json";
const MANIFEST_FILE: &str = "manifest.json";

#[derive(Debug)]
enum Command {
    Build(BuildConfig),
    Merge(MergeConfig),
}

#[derive(Debug)]
struct BuildConfig {
    output: PathBuf,
    beliefs: PathBuf,
    factors: PathBuf,
    dealer_start: usize,
    dealer_count: usize,
    pone_start: usize,
    pone_count: usize,
    resume: bool,
    status_every: usize,
    action_cache_limit: usize,
    future_cache_limit: usize,
}

#[derive(Debug)]
struct MergeConfig {
    shards: PathBuf,
    output: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Checkpoint {
    schema_version: u32,
    model_version: String,
    state: String,
    belief_checksum: String,
    factor_checksum: String,
    dealer_start: usize,
    dealer_count: usize,
    pone_start: usize,
    pone_count: usize,
    completed_dealer_keeps: usize,
    valid_pairs: u64,
    bytes_written: u64,
    elapsed_seconds: f64,
}

fn main() {
    let result = parse_command().and_then(|command| match command {
        Command::Build(config) => build(&config),
        Command::Merge(config) => merge(&config),
    });
    if let Err(error) = result {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn parse_command() -> Result<Command, String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    match args.first().map(String::as_str) {
        Some("build") => parse_build(&args[1..]).map(Command::Build),
        Some("merge") => parse_merge(&args[1..]).map(Command::Merge),
        Some("--help") | Some("-h") | None => {
            println!(
                "build_model911_pairs build --output DIR --beliefs FILE --factors FILE \
                 --dealer-start N --dealer-count N [--pone-start N --pone-count N] \
                 [--resume] [--status-every N] [--action-cache-limit N] \
                 [--future-cache-limit N]\n\
                 build_model911_pairs merge --shards DIR --output DIR"
            );
            process::exit(0);
        }
        Some(other) => Err(format!("unknown Model 9.11 pair command {other}")),
    }
}

fn parse_build(args: &[String]) -> Result<BuildConfig, String> {
    let mut output = None;
    let mut beliefs = None;
    let mut factors = None;
    let mut dealer_start = None;
    let mut dealer_count = None;
    let mut pone_start = 0_usize;
    let mut pone_count = KEEP_COUNT;
    let mut resume = false;
    let mut status_every = 1_usize;
    let mut action_cache_limit = 1_000_000_usize;
    let mut future_cache_limit = 5_000_000_usize;
    let mut index = 0_usize;
    while index < args.len() {
        let flag = &args[index];
        index += 1;
        let value = |index: &mut usize| -> Result<String, String> {
            let value = args
                .get(*index)
                .cloned()
                .ok_or_else(|| format!("{flag} requires a value"))?;
            *index += 1;
            Ok(value)
        };
        match flag.as_str() {
            "--output" => output = Some(PathBuf::from(value(&mut index)?)),
            "--beliefs" => beliefs = Some(PathBuf::from(value(&mut index)?)),
            "--factors" => factors = Some(PathBuf::from(value(&mut index)?)),
            "--dealer-start" => dealer_start = Some(parse_usize(&value(&mut index)?, flag)?),
            "--dealer-count" => dealer_count = Some(parse_usize(&value(&mut index)?, flag)?),
            "--pone-start" => pone_start = parse_usize(&value(&mut index)?, flag)?,
            "--pone-count" => pone_count = parse_usize(&value(&mut index)?, flag)?,
            "--status-every" => status_every = parse_usize(&value(&mut index)?, flag)?,
            "--action-cache-limit" => action_cache_limit = parse_usize(&value(&mut index)?, flag)?,
            "--future-cache-limit" => future_cache_limit = parse_usize(&value(&mut index)?, flag)?,
            "--resume" => resume = true,
            other => return Err(format!("unknown Model 9.11 build argument {other}")),
        }
    }
    let config = BuildConfig {
        output: output.ok_or_else(|| "build requires --output".to_string())?,
        beliefs: beliefs.ok_or_else(|| "build requires --beliefs".to_string())?,
        factors: factors.ok_or_else(|| "build requires --factors".to_string())?,
        dealer_start: dealer_start.ok_or_else(|| "build requires --dealer-start".to_string())?,
        dealer_count: dealer_count.ok_or_else(|| "build requires --dealer-count".to_string())?,
        pone_start,
        pone_count,
        resume,
        status_every,
        action_cache_limit,
        future_cache_limit,
    };
    validate_range("dealer", config.dealer_start, config.dealer_count)?;
    validate_range("pone", config.pone_start, config.pone_count)?;
    if config.status_every == 0 {
        return Err("--status-every must be positive".to_string());
    }
    Ok(config)
}

fn parse_merge(args: &[String]) -> Result<MergeConfig, String> {
    let mut shards = None;
    let mut output = None;
    let mut index = 0_usize;
    while index < args.len() {
        let flag = &args[index];
        index += 1;
        let value = args
            .get(index)
            .cloned()
            .ok_or_else(|| format!("{flag} requires a value"))?;
        index += 1;
        match flag.as_str() {
            "--shards" => shards = Some(PathBuf::from(value)),
            "--output" => output = Some(PathBuf::from(value)),
            other => return Err(format!("unknown Model 9.11 merge argument {other}")),
        }
    }
    Ok(MergeConfig {
        shards: shards.ok_or_else(|| "merge requires --shards".to_string())?,
        output: output.ok_or_else(|| "merge requires --output".to_string())?,
    })
}

fn build(config: &BuildConfig) -> Result<(), String> {
    fs::create_dir_all(&config.output)
        .map_err(|error| format!("create {} failed: {error}", config.output.display()))?;
    let belief_checksum = checksum_string(fnv1a64_file(&config.beliefs)?);
    let factor_checksum = checksum_string(fnv1a64_file(&config.factors)?);
    let beliefs = Model91EmpiricalBeliefs::load(&config.beliefs)?;
    let factors = Model1322DeclineFactors::load(&config.factors)?;
    let keeps = enumerate_rank_count_keys(4)
        .iter()
        .map(|key| rank_counts_from_key(key))
        .collect::<Result<Vec<_>, _>>()?;
    if keeps.len() != KEEP_COUNT {
        return Err(format!(
            "Model 9.11 keep count is {}; expected {KEEP_COUNT}",
            keeps.len()
        ));
    }
    let checkpoint_path = config.output.join(CHECKPOINT_FILE);
    let pair_path = config.output.join(PAIR_FILE);
    let expected_new = Checkpoint {
        schema_version: 1,
        model_version: "9.11".to_string(),
        state: "running".to_string(),
        belief_checksum,
        factor_checksum,
        dealer_start: config.dealer_start,
        dealer_count: config.dealer_count,
        pone_start: config.pone_start,
        pone_count: config.pone_count,
        completed_dealer_keeps: 0,
        valid_pairs: 0,
        bytes_written: HEADER_BYTES as u64,
        elapsed_seconds: 0.0,
    };
    let mut checkpoint = if config.resume && checkpoint_path.exists() && pair_path.exists() {
        let checkpoint: Checkpoint = serde_json::from_slice(
            &fs::read(&checkpoint_path)
                .map_err(|error| format!("read {} failed: {error}", checkpoint_path.display()))?,
        )
        .map_err(|error| format!("parse {} failed: {error}", checkpoint_path.display()))?;
        validate_checkpoint(&checkpoint, &expected_new)?;
        validate_header(&pair_path, &checkpoint)?;
        checkpoint
    } else {
        if checkpoint_path.exists() || pair_path.exists() {
            return Err(format!(
                "{} contains a Model 9.11 build; use --resume or a new directory",
                config.output.display()
            ));
        }
        let mut file = File::create(&pair_path)
            .map_err(|error| format!("create {} failed: {error}", pair_path.display()))?;
        write_header(&mut file, &expected_new)?;
        file.sync_all()
            .map_err(|error| format!("sync {} failed: {error}", pair_path.display()))?;
        atomic_json(&checkpoint_path, &expected_new)?;
        expected_new
    };
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&pair_path)
        .map_err(|error| format!("open {} failed: {error}", pair_path.display()))?;
    if file
        .metadata()
        .map_err(|error| format!("stat {} failed: {error}", pair_path.display()))?
        .len()
        < checkpoint.bytes_written
    {
        return Err("Model 9.11 pair file is shorter than its checkpoint".to_string());
    }
    file.set_len(checkpoint.bytes_written)
        .map_err(|error| format!("truncate {} failed: {error}", pair_path.display()))?;
    file.seek(SeekFrom::End(0))
        .map_err(|error| format!("seek {} failed: {error}", pair_path.display()))?;

    let policy = Model911Policy::new(
        Some(beliefs),
        factors,
        config.action_cache_limit,
        config.future_cache_limit,
    )?;
    let resumed_elapsed = checkpoint.elapsed_seconds;
    let started = Instant::now();
    write_status(config, &checkpoint, policy.stats())?;
    for relative_dealer in checkpoint.completed_dealer_keeps..config.dealer_count {
        let dealer_id = config.dealer_start + relative_dealer;
        let mut row = Vec::with_capacity(config.pone_count * RECORD_BYTES);
        let mut valid = 0_u64;
        for pone_id in config.pone_start..config.pone_start + config.pone_count {
            let value = if compatible(&keeps[dealer_id], &keeps[pone_id]) {
                let (dealer_points, pone_points) =
                    rollout_model911_pair(keeps[dealer_id], keeps[pone_id], &policy)?;
                valid += 1;
                pack_pair(dealer_points, pone_points)?
            } else {
                INVALID_PAIR
            };
            row.extend_from_slice(&value.to_le_bytes());
        }
        file.write_all(&row)
            .map_err(|error| format!("append {} failed: {error}", pair_path.display()))?;
        checkpoint.completed_dealer_keeps = relative_dealer + 1;
        checkpoint.valid_pairs = checkpoint.valid_pairs.saturating_add(valid);
        checkpoint.bytes_written = checkpoint.bytes_written.saturating_add(row.len() as u64);
        checkpoint.elapsed_seconds = resumed_elapsed + started.elapsed().as_secs_f64();
        if checkpoint.completed_dealer_keeps == config.dealer_count
            || checkpoint.completed_dealer_keeps % config.status_every == 0
        {
            file.sync_all()
                .map_err(|error| format!("sync {} failed: {error}", pair_path.display()))?;
            atomic_json(&checkpoint_path, &checkpoint)?;
            write_status(config, &checkpoint, policy.stats())?;
        }
    }
    checkpoint.state = "complete".to_string();
    checkpoint.elapsed_seconds = resumed_elapsed + started.elapsed().as_secs_f64();
    file.sync_all()
        .map_err(|error| format!("sync {} failed: {error}", pair_path.display()))?;
    atomic_json(&checkpoint_path, &checkpoint)?;
    let output_checksum = checksum_string(fnv1a64_file(&pair_path)?);
    write_status(config, &checkpoint, policy.stats())?;
    atomic_json(
        &config.output.join(MANIFEST_FILE),
        &json!({
            "schemaVersion": 1,
            "modelVersion": "9.11",
            "status": "complete",
            "policy": "Model 9.1 complete compatible-hand EV with Model 13.22 go and scoring-decline likelihood updates; no crib discards or cut",
            "dealerRange": {"start": config.dealer_start, "count": config.dealer_count},
            "poneRange": {"start": config.pone_start, "count": config.pone_count},
            "validPairs": checkpoint.valid_pairs,
            "bytes": checkpoint.bytes_written,
            "beliefChecksum": checkpoint.belief_checksum,
            "factorChecksum": checkpoint.factor_checksum,
            "outputChecksum": output_checksum,
            "checkpointUnit": "one dealer-keep row",
            "resumeSemantics": "truncate to last fsynced checkpoint and deterministically recompute at most one row",
        }),
    )?;
    Ok(())
}

fn merge(config: &MergeConfig) -> Result<(), String> {
    if config.output.exists() {
        let manifest_path = config.output.join(MANIFEST_FILE);
        let pair_path = config.output.join(PAIR_FILE);
        if manifest_path.exists() && pair_path.exists() {
            let manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| {
                    format!("read {} failed: {error}", manifest_path.display())
                })?)
                .map_err(|error| format!("parse {} failed: {error}", manifest_path.display()))?;
            let expected_bytes =
                HEADER_BYTES as u64 + (KEEP_COUNT * KEEP_COUNT * RECORD_BYTES) as u64;
            if manifest["status"].as_str() == Some("complete")
                && fs::metadata(&pair_path)
                    .map_err(|error| format!("stat {} failed: {error}", pair_path.display()))?
                    .len()
                    == expected_bytes
            {
                return Ok(());
            }
        }
    }
    let mut shards = Vec::<(Checkpoint, PathBuf)>::new();
    for entry in fs::read_dir(&config.shards)
        .map_err(|error| format!("read {} failed: {error}", config.shards.display()))?
    {
        let path = entry
            .map_err(|error| format!("read shard entry failed: {error}"))?
            .path();
        if !path.is_dir() {
            continue;
        }
        let checkpoint_path = path.join(CHECKPOINT_FILE);
        let pair_path = path.join(PAIR_FILE);
        if !checkpoint_path.exists() || !pair_path.exists() {
            continue;
        }
        let checkpoint: Checkpoint = serde_json::from_slice(
            &fs::read(&checkpoint_path)
                .map_err(|error| format!("read {} failed: {error}", checkpoint_path.display()))?,
        )
        .map_err(|error| format!("parse {} failed: {error}", checkpoint_path.display()))?;
        if checkpoint.state != "complete"
            || checkpoint.completed_dealer_keeps != checkpoint.dealer_count
            || checkpoint.pone_start != 0
            || checkpoint.pone_count != KEEP_COUNT
        {
            return Err(format!(
                "shard {} is incomplete or not full-width",
                path.display()
            ));
        }
        validate_header(&pair_path, &checkpoint)?;
        shards.push((checkpoint, pair_path));
    }
    shards.sort_by_key(|(checkpoint, _)| checkpoint.dealer_start);
    if shards.is_empty() {
        return Err("no complete Model 9.11 shards found".to_string());
    }
    let belief_checksum = shards[0].0.belief_checksum.clone();
    let factor_checksum = shards[0].0.factor_checksum.clone();
    let mut next = 0_usize;
    let mut valid_pairs = 0_u64;
    for (checkpoint, _) in &shards {
        if checkpoint.dealer_start != next
            || checkpoint.belief_checksum != belief_checksum
            || checkpoint.factor_checksum != factor_checksum
        {
            return Err(format!(
                "Model 9.11 shards have a gap, overlap, or source mismatch at {next}"
            ));
        }
        next += checkpoint.dealer_count;
        valid_pairs = valid_pairs.saturating_add(checkpoint.valid_pairs);
    }
    if next != KEEP_COUNT {
        return Err(format!(
            "Model 9.11 shards cover {next}/{KEEP_COUNT} dealer keeps"
        ));
    }
    fs::create_dir_all(&config.output)
        .map_err(|error| format!("create {} failed: {error}", config.output.display()))?;
    let pair_path = config.output.join(PAIR_FILE);
    let merged_checkpoint = Checkpoint {
        schema_version: 1,
        model_version: "9.11".to_string(),
        state: "complete".to_string(),
        belief_checksum,
        factor_checksum,
        dealer_start: 0,
        dealer_count: KEEP_COUNT,
        pone_start: 0,
        pone_count: KEEP_COUNT,
        completed_dealer_keeps: KEEP_COUNT,
        valid_pairs,
        bytes_written: HEADER_BYTES as u64 + (KEEP_COUNT * KEEP_COUNT * RECORD_BYTES) as u64,
        elapsed_seconds: shards
            .iter()
            .map(|(checkpoint, _)| checkpoint.elapsed_seconds)
            .sum(),
    };
    let mut output = File::create(&pair_path)
        .map_err(|error| format!("create {} failed: {error}", pair_path.display()))?;
    write_header(&mut output, &merged_checkpoint)?;
    for (_, shard_path) in &shards {
        let mut input = File::open(shard_path)
            .map_err(|error| format!("open {} failed: {error}", shard_path.display()))?;
        input
            .seek(SeekFrom::Start(HEADER_BYTES as u64))
            .map_err(|error| format!("seek {} failed: {error}", shard_path.display()))?;
        std::io::copy(&mut input, &mut output)
            .map_err(|error| format!("merge {} failed: {error}", shard_path.display()))?;
    }
    output
        .sync_all()
        .map_err(|error| format!("sync {} failed: {error}", pair_path.display()))?;
    atomic_json(&config.output.join(CHECKPOINT_FILE), &merged_checkpoint)?;
    atomic_json(
        &config.output.join(MANIFEST_FILE),
        &json!({
            "schemaVersion": 1,
            "modelVersion": "9.11",
            "status": "complete",
            "shards": shards.len(),
            "dealerKeeps": KEEP_COUNT,
            "poneKeeps": KEEP_COUNT,
            "validPairs": valid_pairs,
            "bytes": merged_checkpoint.bytes_written,
            "beliefChecksum": merged_checkpoint.belief_checksum,
            "factorChecksum": merged_checkpoint.factor_checksum,
            "outputChecksum": checksum_string(fnv1a64_file(&pair_path)?),
        }),
    )?;
    Ok(())
}

fn validate_checkpoint(checkpoint: &Checkpoint, expected: &Checkpoint) -> Result<(), String> {
    if checkpoint.schema_version != expected.schema_version
        || checkpoint.model_version != expected.model_version
        || checkpoint.belief_checksum != expected.belief_checksum
        || checkpoint.factor_checksum != expected.factor_checksum
        || checkpoint.dealer_start != expected.dealer_start
        || checkpoint.dealer_count != expected.dealer_count
        || checkpoint.pone_start != expected.pone_start
        || checkpoint.pone_count != expected.pone_count
        || checkpoint.completed_dealer_keeps > checkpoint.dealer_count
        || checkpoint.bytes_written
            != HEADER_BYTES as u64
                + (checkpoint.completed_dealer_keeps * checkpoint.pone_count * RECORD_BYTES) as u64
    {
        return Err("resume configuration does not match Model 9.11 checkpoint".to_string());
    }
    Ok(())
}

fn write_header(writer: &mut impl Write, checkpoint: &Checkpoint) -> Result<(), String> {
    let belief_checksum = parse_checksum(&checkpoint.belief_checksum)?;
    let factor_checksum = parse_checksum(&checkpoint.factor_checksum)?;
    writer
        .write_all(MAGIC)
        .and_then(|_| writer.write_all(&VERSION.to_le_bytes()))
        .and_then(|_| writer.write_all(&(KEEP_COUNT as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(checkpoint.dealer_start as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(checkpoint.dealer_count as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(checkpoint.pone_start as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(checkpoint.pone_count as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(RECORD_BYTES as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&0_u32.to_le_bytes()))
        .and_then(|_| writer.write_all(&belief_checksum.to_le_bytes()))
        .and_then(|_| writer.write_all(&factor_checksum.to_le_bytes()))
        .map_err(|error| format!("write Model 9.11 header failed: {error}"))
}

fn validate_header(path: &Path, checkpoint: &Checkpoint) -> Result<(), String> {
    let mut actual = [0_u8; HEADER_BYTES];
    File::open(path)
        .and_then(|mut file| file.read_exact(&mut actual))
        .map_err(|error| format!("read {} header failed: {error}", path.display()))?;
    let mut expected = Vec::with_capacity(HEADER_BYTES);
    write_header(&mut expected, checkpoint)?;
    if actual.as_slice() != expected.as_slice() {
        return Err(format!(
            "{} has the wrong Model 9.11 header",
            path.display()
        ));
    }
    Ok(())
}

fn write_status(
    config: &BuildConfig,
    checkpoint: &Checkpoint,
    stats: Model91PolicyStats,
) -> Result<(), String> {
    let rate = if checkpoint.elapsed_seconds > 0.0 {
        checkpoint.valid_pairs as f64 / checkpoint.elapsed_seconds
    } else {
        0.0
    };
    let remaining_rows = checkpoint
        .dealer_count
        .saturating_sub(checkpoint.completed_dealer_keeps);
    let pairs_per_row = if checkpoint.completed_dealer_keeps > 0 {
        checkpoint.valid_pairs as f64 / checkpoint.completed_dealer_keeps as f64
    } else {
        0.0
    };
    atomic_json(
        &config.output.join(STATUS_FILE),
        &json!({
            "status": checkpoint.state,
            "modelVersion": "9.11",
            "dealerStart": checkpoint.dealer_start,
            "dealerCount": checkpoint.dealer_count,
            "completedDealerKeeps": checkpoint.completed_dealer_keeps,
            "validPairs": checkpoint.valid_pairs,
            "elapsedSeconds": checkpoint.elapsed_seconds,
            "pairsPerSecond": rate,
            "etaSeconds": if rate > 0.0 { remaining_rows as f64 * pairs_per_row / rate } else { 0.0 },
            "bytesWritten": checkpoint.bytes_written,
            "resume": config.resume,
            "checkpointUnit": "dealer keep row",
            "cacheLimits": {"action": config.action_cache_limit, "continuation": config.future_cache_limit},
            "policyStats": {
                "decisionRequests": stats.decision_requests,
                "decisionCacheHits": stats.decision_cache_hits,
                "futureStates": stats.random_future_states,
                "futureCacheHits": stats.future_cache_hits,
                "futureCacheCapacityClears": stats.future_cache_capacity_clears,
                "futureCachePeakEntries": stats.future_cache_peak_entries,
            }
        }),
    )
}

fn compatible(left: &[u8; 13], right: &[u8; 13]) -> bool {
    left.iter()
        .zip(right)
        .all(|(left_count, right_count)| left_count + right_count <= 4)
}

fn pack_pair(dealer_points: u8, pone_points: u8) -> Result<u16, String> {
    if dealer_points > 31 || pone_points > 31 {
        return Err(format!(
            "Model 9.11 score does not fit five bits: {dealer_points},{pone_points}"
        ));
    }
    Ok(u16::from(dealer_points) | (u16::from(pone_points) << 5))
}

fn validate_range(label: &str, start: usize, count: usize) -> Result<(), String> {
    if count == 0 || start >= KEEP_COUNT || start.saturating_add(count) > KEEP_COUNT {
        return Err(format!(
            "{label} range {start}+{count} is outside 0..{KEEP_COUNT}"
        ));
    }
    Ok(())
}

fn parse_usize(value: &str, flag: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|error| format!("invalid {flag} {value}: {error}"))
}

fn checksum_string(value: u64) -> String {
    format!("{value:016x}")
}

fn parse_checksum(value: &str) -> Result<u64, String> {
    u64::from_str_radix(value, 16).map_err(|error| format!("invalid checksum {value}: {error}"))
}

fn fnv1a64_file(path: &Path) -> Result<u64, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("open {} for checksum failed: {error}", path.display()))?;
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("read {} for checksum failed: {error}", path.display()))?;
        if count == 0 {
            break;
        }
        for byte in &buffer[..count] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100_0000_01b3);
        }
    }
    Ok(hash)
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("serialize {} failed: {error}", path.display()))?;
    let temporary = path.with_extension(format!("{}.tmp", process::id()));
    {
        let mut file = File::create(&temporary)
            .map_err(|error| format!("create {} failed: {error}", temporary.display()))?;
        file.write_all(&bytes)
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("write {} failed: {error}", temporary.display()))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("replace {} failed: {error}", path.display()))
}
