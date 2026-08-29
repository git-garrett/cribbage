//! Resumable Model 13.2 four-card keep-pair builder.
//!
//! Both modes execute the same information-set-legal pegging policy. The
//! durable asset is keyed only by dealer keep and pone keep. Neither actor's
//! crib discards nor the cut are supplied to the offline rollout. At runtime,
//! the acting player's actual two crib discards reweight compatible opponent
//! keeps before these outcomes are aggregated.

use cribbage_shadow_engine::board::Role;
use cribbage_shadow_engine::cards::{
    enumerate_rank_count_keys, rank_count_total, rank_counts_from_key,
};
use cribbage_shadow_engine::information_set::PegSeat;
use cribbage_shadow_engine::model132::{
    rollout_model132_world, Model132HeuristicPolicy, MODEL132_INVALID_PAIR,
    MODEL132_PAIR_HEADER_BYTES, MODEL132_PAIR_MAGIC, MODEL132_PAIR_RECORD_BYTES,
    MODEL132_PAIR_VERSION,
};
use cribbage_shadow_engine::model91::Model91EmpiricalBeliefs;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process;
use std::time::Instant;

const RANKS: usize = 13;
const STATUS_FILE: &str = "status.json";
const CHECKPOINT_FILE: &str = "checkpoint.json";
const ROWS_FILE: &str = "pair-rows.bin";
const ASSET_FILE: &str = "model132-keep-pairs.bin";
const MANIFEST_FILE: &str = "manifest.json";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum BuildMode {
    MonteCarlo,
    Exhaustive,
}

impl BuildMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "monte-carlo" => Ok(Self::MonteCarlo),
            "exhaustive" => Ok(Self::Exhaustive),
            other => Err(format!("unknown Model 13.2 build mode {other}")),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::MonteCarlo => "monte-carlo",
            Self::Exhaustive => "exhaustive",
        }
    }
}

#[derive(Clone, Debug)]
struct Config {
    mode: BuildMode,
    output: PathBuf,
    beliefs: PathBuf,
    keep_prior: PathBuf,
    samples: usize,
    seed: u64,
    resume: bool,
    keep_start: usize,
    keep_count: Option<usize>,
    status_every: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Checkpoint {
    version: u32,
    mode: BuildMode,
    seed: u64,
    samples: usize,
    keep_start: usize,
    keep_count: usize,
    completed_dealer_keeps: usize,
    completed_pairs: u64,
    row_bytes: u64,
    belief_checksum: String,
    keep_prior_checksum: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeepPriorFile {
    version: u32,
    roles: KeepPriorRoles,
}

#[derive(Debug, Deserialize)]
struct KeepPriorRoles {
    pone: BTreeMap<String, u64>,
    dealer: BTreeMap<String, u64>,
}

#[derive(Clone, Debug)]
struct KeepPrior {
    // Pone then dealer, aligned with canonical four-card keep IDs.
    by_role: [Vec<u64>; 2],
}

impl KeepPrior {
    fn weight(&self, role: Role, keep_id: usize) -> u64 {
        self.by_role[role_index(role)][keep_id]
    }
}

fn main() {
    let result = parse_config(&env::args().skip(1).collect::<Vec<_>>()).and_then(run);
    if let Err(error) = result {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn parse_config(args: &[String]) -> Result<Config, String> {
    let mut mode = None;
    let mut output = None;
    let mut beliefs = None;
    let mut keep_prior = None;
    let mut samples = 18_usize;
    let mut seed = 0x1320_0001_u64;
    let mut resume = false;
    let mut keep_start = 0_usize;
    let mut keep_count = None;
    let mut status_every = 1_usize;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--mode" => mode = Some(BuildMode::parse(&argument(args, &mut index, "--mode")?)?),
            "--output" => output = Some(PathBuf::from(argument(args, &mut index, "--output")?)),
            "--beliefs" => beliefs = Some(PathBuf::from(argument(args, &mut index, "--beliefs")?)),
            "--keep-prior" => {
                keep_prior = Some(PathBuf::from(argument(args, &mut index, "--keep-prior")?))
            }
            "--samples" => {
                samples = parse_usize(&argument(args, &mut index, "--samples")?, "samples")?
            }
            "--seed" => seed = parse_u64(&argument(args, &mut index, "--seed")?)?,
            "--resume" => {
                resume = true;
                index += 1;
            }
            "--keep-start" => {
                keep_start =
                    parse_usize(&argument(args, &mut index, "--keep-start")?, "keep start")?
            }
            "--keep-count" => {
                keep_count = Some(parse_usize(
                    &argument(args, &mut index, "--keep-count")?,
                    "keep count",
                )?)
            }
            "--status-every" => {
                status_every = parse_usize(
                    &argument(args, &mut index, "--status-every")?,
                    "status every",
                )?
            }
            "--help" | "-h" => {
                print_usage();
                process::exit(0);
            }
            other => return Err(format!("unknown Model 13.2 builder argument {other}")),
        }
    }
    if samples == 0 || status_every == 0 {
        return Err("samples and status-every must be positive".to_string());
    }
    Ok(Config {
        mode: mode.ok_or_else(|| "--mode is required".to_string())?,
        output: output.ok_or_else(|| "--output is required".to_string())?,
        beliefs: beliefs.ok_or_else(|| "--beliefs is required".to_string())?,
        keep_prior: keep_prior.ok_or_else(|| "--keep-prior is required".to_string())?,
        samples,
        seed,
        resume,
        keep_start,
        keep_count,
        status_every,
    })
}

fn run(config: Config) -> Result<(), String> {
    let keep_keys = enumerate_rank_count_keys(4);
    let keeps = keep_keys
        .iter()
        .map(|key| rank_counts_from_key(key))
        .collect::<Result<Vec<_>, _>>()?;
    let keep_count = config
        .keep_count
        .unwrap_or_else(|| keeps.len().saturating_sub(config.keep_start));
    if keep_count == 0 || config.keep_start + keep_count > keeps.len() {
        return Err("Model 13.2 dealer-keep range is invalid".to_string());
    }
    let belief_checksum = format!("{:016x}", fnv1a64_file(&config.beliefs)?);
    let keep_prior_checksum = format!("{:016x}", fnv1a64_file(&config.keep_prior)?);
    let beliefs = Model91EmpiricalBeliefs::load(&config.beliefs)?;
    let prior = load_keep_prior(&config.keep_prior, &keep_keys)?;
    let selected = selected_pairs(&config, &keeps, &prior)?;
    let target_pairs = selected
        [config.keep_start * keeps.len()..(config.keep_start + keep_count) * keeps.len()]
        .iter()
        .filter(|selected| **selected)
        .count() as u64;
    let policy = Model132HeuristicPolicy::without_cut(Some(beliefs));

    fs::create_dir_all(&config.output)
        .map_err(|error| format!("create {} failed: {error}", config.output.display()))?;
    let rows_path = config.output.join(ROWS_FILE);
    let checkpoint_path = config.output.join(CHECKPOINT_FILE);
    let mut checkpoint = if config.resume && checkpoint_path.exists() && rows_path.exists() {
        let checkpoint: Checkpoint = serde_json::from_slice(
            &fs::read(&checkpoint_path)
                .map_err(|error| format!("read {} failed: {error}", checkpoint_path.display()))?,
        )
        .map_err(|error| format!("parse {} failed: {error}", checkpoint_path.display()))?;
        validate_checkpoint(
            &checkpoint,
            &config,
            keep_count,
            &belief_checksum,
            &keep_prior_checksum,
        )?;
        checkpoint
    } else {
        if checkpoint_path.exists() || rows_path.exists() {
            return Err(format!(
                "{} already contains a build; use --resume or a new directory",
                config.output.display()
            ));
        }
        File::create(&rows_path)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("create {} failed: {error}", rows_path.display()))?;
        Checkpoint {
            version: 3,
            mode: config.mode,
            seed: config.seed,
            samples: config.samples,
            keep_start: config.keep_start,
            keep_count,
            completed_dealer_keeps: 0,
            completed_pairs: 0,
            row_bytes: 0,
            belief_checksum: belief_checksum.clone(),
            keep_prior_checksum: keep_prior_checksum.clone(),
        }
    };
    let mut rows_file = open_truncated(&rows_path, checkpoint.row_bytes)?;
    atomic_write_json(&checkpoint_path, &checkpoint)?;
    let started = Instant::now();
    write_status(&config, &checkpoint, target_pairs, started, "running", None)?;

    for relative_dealer in checkpoint.completed_dealer_keeps..keep_count {
        let dealer_id = config.keep_start + relative_dealer;
        let dealer_keep = keeps[dealer_id];
        let mut row_pairs = 0_u64;
        for (pone_id, pone_keep) in keeps.iter().copied().enumerate() {
            let value = if selected[dealer_id * keeps.len() + pone_id] {
                let (dealer_points, pone_points) = rollout_model132_world(
                    [dealer_keep, pone_keep],
                    [[0_u8; RANKS]; 2],
                    None,
                    PegSeat::Zero,
                    &policy,
                )?;
                row_pairs += 1;
                pack_pair(dealer_points, pone_points)?
            } else {
                MODEL132_INVALID_PAIR
            };
            rows_file
                .write_all(&value.to_le_bytes())
                .map_err(|error| format!("write Model 13.2 pair row failed: {error}"))?;
        }
        checkpoint.completed_dealer_keeps += 1;
        checkpoint.completed_pairs += row_pairs;
        checkpoint.row_bytes += (keeps.len() * MODEL132_PAIR_RECORD_BYTES) as u64;
        if checkpoint.completed_dealer_keeps == keep_count
            || checkpoint.completed_dealer_keeps % config.status_every == 0
        {
            rows_file
                .sync_all()
                .map_err(|error| format!("sync {} failed: {error}", rows_path.display()))?;
            atomic_write_json(&checkpoint_path, &checkpoint)?;
            write_status(&config, &checkpoint, target_pairs, started, "running", None)?;
        }
    }
    if checkpoint.completed_pairs != target_pairs {
        return Err(format!(
            "Model 13.2 emitted {} pairs; expected {target_pairs}",
            checkpoint.completed_pairs
        ));
    }
    rows_file
        .sync_all()
        .map_err(|error| format!("sync {} failed: {error}", rows_path.display()))?;
    atomic_write_json(&checkpoint_path, &checkpoint)?;
    let asset_path = config.output.join(ASSET_FILE);
    pack_asset(&rows_path, &asset_path, &checkpoint, keeps.len(), &prior)?;
    let checksum = format!("{:016x}", fnv1a64_file(&asset_path)?);
    write_status(
        &config,
        &checkpoint,
        target_pairs,
        started,
        "complete",
        Some(&checksum),
    )?;
    atomic_write_json(
        &config.output.join(MANIFEST_FILE),
        &json!({
            "status": "complete",
            "version": 2,
            "model": "schell_table-peg_table-13.2",
            "mode": config.mode,
            "rowIdentity": "ordered dealer four-card rank keep, pone four-card rank keep",
            "dealerKeepStart": checkpoint.keep_start,
            "dealerKeepCount": checkpoint.keep_count,
            "canonicalKeepCount": keeps.len(),
            "pairOutcomes": checkpoint.completed_pairs,
            "targetOpponentKeepsPerOwnKeep": if config.mode == BuildMode::MonteCarlo { Some(config.samples) } else { None },
            "seed": format!("0x{:016x}", config.seed),
            "peggingPolicy": "Model132HeuristicPolicy without cut or crib discards; actor-legal observation; decision-local evaluation",
            "keepPrior": config.keep_prior.display().to_string(),
            "keepPriorChecksum": keep_prior_checksum,
            "ownDiscardConditioning": "omitted from reusable offline pair rollout; runtime removes the selected two crib discards when reweighting opponent keeps",
            "opponentDiscardConditioning": "omitted; opponent original deal and discard are marginalized into the role-specific keep prior",
            "cutConditioning": "omitted from discard forecast; live pegging removes the revealed cut from opponent-hand beliefs",
            "beliefChecksum": belief_checksum,
            "asset": asset_path.display().to_string(),
            "assetBytes": fs::metadata(&asset_path).map_err(|error| format!("stat {} failed: {error}", asset_path.display()))?.len(),
            "assetChecksum": checksum,
        }),
    )?;
    println!(
        "state=complete mode={} dealerKeeps={} pairs={} elapsedSeconds={:.3} asset={}",
        config.mode.label(),
        checkpoint.completed_dealer_keeps,
        checkpoint.completed_pairs,
        started.elapsed().as_secs_f64(),
        asset_path.display()
    );
    Ok(())
}

fn load_keep_prior(path: &Path, keep_keys: &[String]) -> Result<KeepPrior, String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "read Model 13.2 keep prior {} failed: {error}",
            path.display()
        )
    })?;
    let source: KeepPriorFile = serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "parse Model 13.2 keep prior {} failed: {error}",
            path.display()
        )
    })?;
    if source.version != 1 {
        return Err(format!(
            "unsupported Model 13.2 keep-prior version {}",
            source.version
        ));
    }
    let parse_role = |label: &str, entries: BTreeMap<String, u64>| -> Result<Vec<u64>, String> {
        for (key, weight) in &entries {
            let ranks = rank_counts_from_key(key)?;
            if rank_count_total(&ranks) != 4 || *weight == 0 {
                return Err(format!(
                    "Model 13.2 {label} keep prior contains invalid entry {key}={weight}"
                ));
            }
        }
        let weights = keep_keys
            .iter()
            .map(|key| entries.get(key).copied().unwrap_or(0))
            .collect::<Vec<_>>();
        if weights.iter().all(|weight| *weight == 0) {
            return Err(format!("Model 13.2 {label} keep prior is empty"));
        }
        Ok(weights)
    };
    Ok(KeepPrior {
        by_role: [
            parse_role("pone", source.roles.pone)?,
            parse_role("dealer", source.roles.dealer)?,
        ],
    })
}

fn selected_pairs(
    config: &Config,
    keeps: &[[u8; RANKS]],
    prior: &KeepPrior,
) -> Result<Vec<bool>, String> {
    let keep_count = keeps.len();
    let mut selected = vec![false; keep_count * keep_count];
    if config.mode == BuildMode::Exhaustive {
        for (dealer_id, dealer) in keeps.iter().enumerate() {
            for (pone_id, pone) in keeps.iter().enumerate() {
                if compatible(dealer, pone)
                    && (prior.weight(Role::Dealer, dealer_id) > 0
                        || prior.weight(Role::Pone, pone_id) > 0)
                {
                    selected[dealer_id * keep_count + pone_id] = true;
                }
            }
        }
        return Ok(selected);
    }

    // Every compatible pair has the same inclusion probability. The retained
    // subset can therefore be normalized under either role prior without the
    // directional union bias of separate row and column samples.
    let threshold = config.samples.min(keep_count) as u64;
    for (dealer_id, dealer) in keeps.iter().enumerate() {
        for (pone_id, pone) in keeps.iter().enumerate() {
            let required =
                prior.weight(Role::Dealer, dealer_id) > 0 || prior.weight(Role::Pone, pone_id) > 0;
            if required
                && compatible(dealer, pone)
                && pair_hash(config.seed, 0, dealer_id as u64, pone_id as u64) % (keep_count as u64)
                    < threshold
            {
                selected[dealer_id * keep_count + pone_id] = true;
            }
        }
    }
    if selected.iter().all(|selected| !*selected) {
        return Err("Model 13.2 Monte Carlo selected no compatible keep pairs".to_string());
    }
    Ok(selected)
}

fn pair_hash(seed: u64, direction: u64, own: u64, opponent: u64) -> u64 {
    let mut value = seed
        ^ direction.wrapping_mul(0x94d0_49bb_1331_11eb)
        ^ own.wrapping_mul(0x9e37_79b9_7f4a_7c15)
        ^ opponent.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn compatible(first: &[u8; RANKS], second: &[u8; RANKS]) -> bool {
    first
        .iter()
        .zip(second)
        .all(|(first, second)| first + second <= 4)
}

fn role_index(role: Role) -> usize {
    match role {
        Role::Pone => 0,
        Role::Dealer => 1,
    }
}

fn pack_pair(dealer_points: u8, pone_points: u8) -> Result<u16, String> {
    if dealer_points > 31 || pone_points > 31 {
        return Err("Model 13.2 pegging points exceed five-bit range".to_string());
    }
    Ok(u16::from(dealer_points) | (u16::from(pone_points) << 5))
}

fn pack_asset(
    rows_path: &Path,
    asset_path: &Path,
    checkpoint: &Checkpoint,
    canonical_keep_count: usize,
    prior: &KeepPrior,
) -> Result<(), String> {
    let mut rows = File::open(rows_path)
        .map_err(|error| format!("open {} failed: {error}", rows_path.display()))?;
    let temporary = asset_path.with_extension("tmp");
    let mut asset = File::create(&temporary)
        .map_err(|error| format!("create {} failed: {error}", temporary.display()))?;
    let prior_offset = MODEL132_PAIR_HEADER_BYTES as u64;
    let outcome_offset = prior_offset + canonical_keep_count as u64 * 2 * 8;
    let flags = u32::from(checkpoint.mode == BuildMode::Exhaustive);
    asset
        .write_all(MODEL132_PAIR_MAGIC)
        .and_then(|_| asset.write_all(&MODEL132_PAIR_VERSION.to_le_bytes()))
        .and_then(|_| asset.write_all(&(canonical_keep_count as u32).to_le_bytes()))
        .and_then(|_| asset.write_all(&(checkpoint.keep_start as u32).to_le_bytes()))
        .and_then(|_| asset.write_all(&(checkpoint.keep_count as u32).to_le_bytes()))
        .and_then(|_| asset.write_all(&(MODEL132_PAIR_RECORD_BYTES as u32).to_le_bytes()))
        .and_then(|_| asset.write_all(&flags.to_le_bytes()))
        .and_then(|_| asset.write_all(&prior_offset.to_le_bytes()))
        .and_then(|_| asset.write_all(&outcome_offset.to_le_bytes()))
        .and_then(|_| asset.write_all(&checkpoint.completed_pairs.to_le_bytes()))
        .map_err(|error| format!("write Model 13.2 pair asset header failed: {error}"))?;
    for role in [Role::Dealer, Role::Pone] {
        for weight in &prior.by_role[role_index(role)] {
            asset
                .write_all(&weight.to_le_bytes())
                .map_err(|error| format!("write Model 13.2 prior failed: {error}"))?;
        }
    }
    std::io::copy(&mut rows, &mut asset)
        .map_err(|error| format!("copy Model 13.2 pair rows failed: {error}"))?;
    asset
        .sync_all()
        .map_err(|error| format!("sync Model 13.2 pair asset failed: {error}"))?;
    let expected = outcome_offset
        + checkpoint.keep_count as u64
            * canonical_keep_count as u64
            * MODEL132_PAIR_RECORD_BYTES as u64;
    let actual = fs::metadata(&temporary)
        .map_err(|error| format!("stat {} failed: {error}", temporary.display()))?
        .len();
    if actual != expected {
        return Err(format!(
            "Model 13.2 pair asset has {actual} bytes; expected {expected}"
        ));
    }
    fs::rename(&temporary, asset_path).map_err(|error| {
        format!(
            "rename {} to {} failed: {error}",
            temporary.display(),
            asset_path.display()
        )
    })
}

fn validate_checkpoint(
    checkpoint: &Checkpoint,
    config: &Config,
    keep_count: usize,
    belief_checksum: &str,
    keep_prior_checksum: &str,
) -> Result<(), String> {
    if checkpoint.version != 3
        || checkpoint.mode != config.mode
        || checkpoint.seed != config.seed
        || checkpoint.samples != config.samples
        || checkpoint.keep_start != config.keep_start
        || checkpoint.keep_count != keep_count
        || checkpoint.completed_dealer_keeps > keep_count
        || checkpoint.belief_checksum != belief_checksum
        || checkpoint.keep_prior_checksum != keep_prior_checksum
    {
        return Err("Model 13.2 checkpoint does not match requested build".to_string());
    }
    Ok(())
}

fn open_truncated(path: &Path, length: u64) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("open {} failed: {error}", path.display()))?;
    if file
        .metadata()
        .map_err(|error| format!("stat {} failed: {error}", path.display()))?
        .len()
        < length
    {
        return Err(format!("{} is shorter than its checkpoint", path.display()));
    }
    file.set_len(length)
        .map_err(|error| format!("truncate {} failed: {error}", path.display()))?;
    let mut file = file;
    file.seek(SeekFrom::End(0))
        .map_err(|error| format!("seek {} failed: {error}", path.display()))?;
    Ok(file)
}

fn write_status(
    config: &Config,
    checkpoint: &Checkpoint,
    target_pairs: u64,
    started: Instant,
    status: &str,
    checksum: Option<&str>,
) -> Result<(), String> {
    let elapsed = started.elapsed().as_secs_f64();
    let rate = if elapsed > 0.0 {
        checkpoint.completed_dealer_keeps as f64 / elapsed
    } else {
        0.0
    };
    let remaining = checkpoint
        .keep_count
        .saturating_sub(checkpoint.completed_dealer_keeps);
    atomic_write_json(
        &config.output.join(STATUS_FILE),
        &json!({
            "status": status,
            "mode": config.mode,
            "keepStart": checkpoint.keep_start,
            "keepCount": checkpoint.keep_count,
            "completedDealerKeeps": checkpoint.completed_dealer_keeps,
            "pairs": checkpoint.completed_pairs,
            "targetPairs": target_pairs,
            "elapsedSecondsThisRun": elapsed,
            "dealerKeepsPerSecondThisRun": rate,
            "etaSecondsThisRun": if rate > 0.0 { Some(remaining as f64 / rate) } else { None },
            "assetChecksum": checksum,
        }),
    )
}

fn atomic_write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let mut bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("serialize {} failed: {error}", path.display()))?;
    bytes.push(b'\n');
    let temporary = path.with_extension("tmp");
    let mut file = File::create(&temporary)
        .map_err(|error| format!("create {} failed: {error}", temporary.display()))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("write {} failed: {error}", temporary.display()))?;
    fs::rename(&temporary, path).map_err(|error| {
        format!(
            "rename {} to {} failed: {error}",
            temporary.display(),
            path.display()
        )
    })
}

fn fnv1a64_file(path: &Path) -> Result<u64, String> {
    let mut file =
        File::open(path).map_err(|error| format!("open {} failed: {error}", path.display()))?;
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("read {} failed: {error}", path.display()))?;
        if count == 0 {
            return Ok(hash);
        }
        for byte in &buffer[..count] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
}

fn argument(args: &[String], index: &mut usize, option: &str) -> Result<String, String> {
    *index += 1;
    let value = args
        .get(*index)
        .cloned()
        .ok_or_else(|| format!("{option} requires a value"))?;
    *index += 1;
    Ok(value)
}

fn parse_usize(value: &str, label: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|error| format!("invalid {label} {value}: {error}"))
}

fn parse_u64(value: &str) -> Result<u64, String> {
    if let Some(hex) = value.strip_prefix("0x") {
        u64::from_str_radix(hex, 16).map_err(|error| format!("invalid seed {value}: {error}"))
    } else {
        value
            .parse::<u64>()
            .map_err(|error| format!("invalid seed {value}: {error}"))
    }
}

fn print_usage() {
    eprintln!(
        "usage: build_model132_histograms --mode monte-carlo|exhaustive --output DIR \
         --beliefs FILE --keep-prior FILE [--samples N] [--seed N] \
         [--keep-start N] [--keep-count N] [--resume]"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keep(entries: &[(usize, u8)]) -> [u8; RANKS] {
        let mut result = [0_u8; RANKS];
        for (rank, copies) in entries {
            result[*rank] = *copies;
        }
        result
    }

    fn config(mode: BuildMode, samples: usize) -> Config {
        Config {
            mode,
            output: PathBuf::new(),
            beliefs: PathBuf::new(),
            keep_prior: PathBuf::new(),
            samples,
            seed: 7,
            resume: false,
            keep_start: 0,
            keep_count: None,
            status_every: 1,
        }
    }

    #[test]
    fn monte_carlo_pair_sampling_is_deterministic_and_uniform() {
        let keeps = vec![
            keep(&[(0, 4)]),
            keep(&[(1, 4)]),
            keep(&[(2, 4)]),
            keep(&[(3, 4)]),
        ];
        let prior = KeepPrior {
            by_role: [vec![1; keeps.len()], vec![1; keeps.len()]],
        };
        let first = selected_pairs(&config(BuildMode::MonteCarlo, 2), &keeps, &prior).unwrap();
        let second = selected_pairs(&config(BuildMode::MonteCarlo, 2), &keeps, &prior).unwrap();
        assert_eq!(first, second);
        for (dealer, dealer_keep) in keeps.iter().enumerate() {
            for (pone, pone_keep) in keeps.iter().enumerate() {
                assert_eq!(
                    first[dealer * keeps.len() + pone],
                    compatible(dealer_keep, pone_keep)
                        && pair_hash(7, 0, dealer as u64, pone as u64) % (keeps.len() as u64) < 2
                );
            }
        }
    }

    #[test]
    fn exhaustive_build_keeps_every_pair_needed_by_either_role_prior() {
        let keeps = vec![keep(&[(0, 4)]), keep(&[(1, 4)]), keep(&[(2, 4)])];
        let prior = KeepPrior {
            by_role: [vec![1, 0, 0], vec![0, 1, 0]],
        };
        let selected = selected_pairs(&config(BuildMode::Exhaustive, 1), &keeps, &prior).unwrap();
        assert!(selected[2 * keeps.len()]);
        assert!(selected[1 * keeps.len() + 2]);
        assert!(!selected[2 * keeps.len() + 2]);
    }

    #[test]
    fn keep_prior_rejects_non_four_card_entries() {
        let source = serde_json::json!({
            "version": 1,
            "roles": {
                "pone": {"1000000000000": 1},
                "dealer": {"1111000000000": 1}
            }
        });
        let path = env::temp_dir().join(format!(
            "model132-invalid-keep-prior-{}.json",
            process::id()
        ));
        fs::write(&path, serde_json::to_vec(&source).unwrap()).unwrap();
        let error = load_keep_prior(&path, &enumerate_rank_count_keys(4)).unwrap_err();
        fs::remove_file(path).unwrap();
        assert!(error.contains("invalid entry"));
    }
}
