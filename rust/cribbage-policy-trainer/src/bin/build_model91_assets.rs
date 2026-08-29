//! Resumable builder for Model 9.1 legal-policy keep-pair outcomes and final
//! six-card EV/histogram assets.

use cribbage_shadow_engine::artifacts::{
    Model131DiscardHistogramTable, Model91DiscardHistogramTable,
};
use cribbage_shadow_engine::board::Role;
use cribbage_shadow_engine::cards::{
    enumerate_rank_count_keys, enumerate_rank_hands, rank_count_key, rank_count_total,
    rank_counts_from_key, RANKS,
};
use cribbage_shadow_engine::model91::{
    model91_initial_pone_lead, rollout_model91_pair, Model91EmpiricalBeliefs, Model91Policy,
    Model91PolicyStats,
};
use serde::Deserialize;
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process;
use std::time::{Duration, Instant};

const PAIR_MAGIC: &[u8; 8] = b"M91PR001";
const PAIR_VERSION: u32 = 1;
const PAIR_RECORD_BYTES: usize = 2;
const PAIR_HEADER_BYTES: usize = 40;
const PAIR_FILE: &str = "pair-outcomes.bin";
const LEAD_FILE: &str = "pone-leads.bin";
const LEAD_MAGIC: &[u8; 8] = b"M91LD001";
const STATUS_FILE: &str = "status.json";
const CHECKPOINT_FILE: &str = "checkpoint.txt";
const MANIFEST_FILE: &str = "manifest.json";
const INVALID_PAIR: u16 = u16::MAX;
const EV_MAGIC: &[u8; 8] = b"M91EV001";
const HIST_MAGIC: &[u8; 8] = b"M91HS001";
const EV_FILE: &str = "discard-ev.bin";
const HIST_ROWS_FILE: &str = "histogram-rows.bin";
const HIST_FILE: &str = "discard-histograms.bin";
const AGGREGATE_CHECKPOINT_FILE: &str = "aggregate-checkpoint.txt";
const AGGREGATE_STATUS_FILE: &str = "aggregate-status.json";
const AGGREGATE_MANIFEST_FILE: &str = "aggregate-manifest.json";
const EV_HEADER_BYTES: usize = 24;
const EV_RECORD_BYTES: usize = 13;
const HIST_HEADER_BYTES: usize = 24;
const HIST_BIN_BYTES: usize = 6;
const BELIEF_MAGIC: &[u8; 8] = b"M91BL001";
const BELIEF_ENTRY_BYTES: usize = 22;
const BELIEF_RECORD_BYTES: usize = 21;
const MODEL90_MAGIC: &[u8; 8] = b"M90EV001";
const MODEL90_RECORD_BYTES: usize = 17;
const MODEL131_HISTOGRAM_MAGIC: &[u8; 8] = b"M131H001";
const MODEL131_HISTOGRAM_HEADER_BYTES: usize = 24;
const MODEL131_HISTOGRAM_TOTAL_WEIGHT: u32 = 163_185;
const MODEL131_HISTOGRAM_PAIR_BITS: u32 = 10;
const MODEL131_HISTOGRAM_MAX_WEIGHT: u32 = (1 << 17) - 1;

#[derive(Clone, Debug)]
struct PairConfig {
    output: PathBuf,
    hold_table: Option<PathBuf>,
    resume: bool,
    dealer_start: usize,
    dealer_count: Option<usize>,
    pone_start: usize,
    pone_count: Option<usize>,
    status_every: usize,
    policy_cache_limit: usize,
}

#[derive(Clone, Debug)]
struct PairCheckpoint {
    hold_checksum: u64,
    dealer_start: usize,
    dealer_count: usize,
    pone_start: usize,
    pone_count: usize,
    completed_dealer_keeps: usize,
    valid_pairs: u64,
    bytes_written: u64,
}

#[derive(Clone, Debug)]
struct AggregateConfig {
    pairs: PathBuf,
    leads: PathBuf,
    output: PathBuf,
    resume: bool,
    six_start: usize,
    six_count: Option<usize>,
    status_every: usize,
}

#[derive(Clone, Debug)]
struct AggregateCheckpoint {
    pair_checksum: u64,
    lead_checksum: u64,
    six_start: usize,
    six_count: usize,
    completed_six_hands: usize,
    completed_rows: usize,
    histogram_bins: u64,
    ev_bytes: u64,
    histogram_row_bytes: u64,
}

#[derive(Clone, Debug)]
struct PairMatrix {
    keep_count: usize,
    values: Vec<u16>,
}

#[derive(Clone, Debug)]
struct MergeConfig {
    shards: PathBuf,
    output: PathBuf,
}

#[derive(Clone, Debug)]
struct BeliefConfig {
    input: PathBuf,
    output: PathBuf,
}

#[derive(Clone, Debug)]
struct QuantizationConfig {
    histogram: PathBuf,
    output: PathBuf,
}

#[derive(Clone, Debug)]
struct Model90PackConfig {
    input: PathBuf,
    output: PathBuf,
}

#[derive(Clone, Debug)]
struct Model131PackConfig {
    histogram: PathBuf,
    output: PathBuf,
}

#[derive(Debug, Deserialize)]
struct HoldTableFile {
    roles: HashMap<String, HashMap<String, HoldPrefixLevel>>,
}

#[derive(Debug, Deserialize)]
struct HoldPrefixLevel {
    prefixes: HashMap<String, HoldPrefix>,
}

#[derive(Debug, Deserialize)]
struct HoldPrefix {
    #[serde(rename = "remainingHands")]
    remaining_hands: HashMap<String, u64>,
}

#[derive(Debug, Deserialize)]
struct Model90PolicyFile {
    rows: usize,
    #[serde(rename = "pegEvs")]
    peg_evs: HashMap<String, (f64, f64, Option<u8>)>,
}

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let result = match args.first().map(String::as_str) {
        Some("pairs") => parse_pair_config(&args[1..]).and_then(|config| build_pairs(&config)),
        Some("aggregate") => {
            parse_aggregate_config(&args[1..]).and_then(|config| build_aggregate(&config))
        }
        Some("merge-pairs") => {
            parse_merge_config(&args[1..]).and_then(|config| merge_pair_shards(&config))
        }
        Some("pack-beliefs") => {
            parse_belief_config(&args[1..]).and_then(|config| pack_beliefs(&config))
        }
        Some("analyze-quantization") => parse_quantization_config(&args[1..])
            .and_then(|config| analyze_histogram_quantization(&config)),
        Some("pack-model90") => {
            parse_model90_pack_config(&args[1..]).and_then(|config| pack_model90(&config))
        }
        Some("pack-model131") => {
            parse_model131_pack_config(&args[1..]).and_then(|config| pack_model131(&config))
        }
        Some("help") | Some("--help") | Some("-h") | None => {
            print_usage();
            Ok(())
        }
        Some(command) => Err(format!("unknown Model 9.1 builder command {}", command)),
    };
    if let Err(error) = result {
        eprintln!("{}", error);
        process::exit(1);
    }
}

fn parse_model131_pack_config(args: &[String]) -> Result<Model131PackConfig, String> {
    let mut histogram = None;
    let mut output = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--histogram" => {
                histogram = Some(PathBuf::from(argument(args, &mut index, "--histogram")?))
            }
            "--output" => output = Some(PathBuf::from(argument(args, &mut index, "--output")?)),
            other => return Err(format!("unknown pack-model131 argument {}", other)),
        }
    }
    Ok(Model131PackConfig {
        histogram: histogram.ok_or_else(|| "pack-model131 requires --histogram".to_string())?,
        output: output.ok_or_else(|| "pack-model131 requires --output".to_string())?,
    })
}

fn pack_model131(config: &Model131PackConfig) -> Result<(), String> {
    let table = Model91DiscardHistogramTable::load(&config.histogram)?;
    if table.len() != 330_590 {
        return Err(format!(
            "Model 13.1 source has {} rows; expected 330590",
            table.len()
        ));
    }
    let bin_count = (0..table.len()).try_fold(0_u32, |total, row| {
        let (bins, row_total) = table
            .row(row)
            .ok_or_else(|| format!("Model 13.1 source row {} is missing", row))?;
        if row_total != MODEL131_HISTOGRAM_TOTAL_WEIGHT || bins.is_empty() || bins.len() > 255 {
            return Err(format!(
                "Model 13.1 source row {} has {} bins and total {}",
                row,
                bins.len(),
                row_total
            ));
        }
        total
            .checked_add(bins.len() as u32)
            .ok_or_else(|| "Model 13.1 bin count overflow".to_string())
    })?;
    let capacity = MODEL131_HISTOGRAM_HEADER_BYTES
        .checked_add(table.len())
        .and_then(|bytes| bytes.checked_add(bin_count as usize * 4))
        .ok_or_else(|| "Model 13.1 asset size overflow".to_string())?;
    let mut output = Vec::with_capacity(capacity);
    output.extend_from_slice(MODEL131_HISTOGRAM_MAGIC);
    output.extend_from_slice(&1_u32.to_le_bytes());
    output.extend_from_slice(&(table.len() as u32).to_le_bytes());
    output.extend_from_slice(&bin_count.to_le_bytes());
    output.extend_from_slice(&MODEL131_HISTOGRAM_TOTAL_WEIGHT.to_le_bytes());
    for row in 0..table.len() {
        let (bins, _) = table.row(row).expect("validated source row");
        output.push(bins.len() as u8);
    }
    let mut max_row_bins = 0_usize;
    let mut max_weight = 0_u32;
    for row in 0..table.len() {
        let (bins, _) = table.row(row).expect("validated source row");
        max_row_bins = max_row_bins.max(bins.len());
        for bin in bins {
            if bin.my_points >= 32
                || bin.opponent_points >= 32
                || bin.weight == 0
                || bin.weight > MODEL131_HISTOGRAM_MAX_WEIGHT
            {
                return Err(format!(
                    "Model 13.1 source row {} contains unencodable bin {:?}",
                    row, bin
                ));
            }
            max_weight = max_weight.max(bin.weight);
            let pair = u32::from(bin.my_points) | (u32::from(bin.opponent_points) << 5);
            let packed = pair | (bin.weight << MODEL131_HISTOGRAM_PAIR_BITS);
            output.extend_from_slice(&packed.to_le_bytes());
        }
    }
    if output.len() != capacity {
        return Err(format!(
            "Model 13.1 pack emitted {} bytes; expected {}",
            output.len(),
            capacity
        ));
    }
    if let Some(parent) = config.output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create {} failed: {}", parent.display(), error))?;
    }
    atomic_write(&config.output, &output)?;
    let packed = Model131DiscardHistogramTable::load(&config.output)?;
    if packed.len() != table.len() {
        return Err("Model 13.1 packed/source row counts differ".to_string());
    }
    for row_index in 0..table.len() {
        let (source_bins, source_total) = table
            .row(row_index)
            .ok_or_else(|| format!("Model 13.1 source row {} disappeared", row_index))?;
        let packed_row = packed
            .row(row_index)
            .ok_or_else(|| format!("Model 13.1 packed row {} is missing", row_index))?;
        if source_total != packed_row.total_weight()
            || !source_bins.iter().copied().eq(packed_row.bins())
        {
            return Err(format!(
                "Model 13.1 packed row {} differs from its exact source",
                row_index
            ));
        }
    }
    println!(
        "state=complete phase=pack-model131 rows={} bins={} maxRowBins={} maxWeight={} bytes={} exactRoundTrip=true sourceChecksum={:016x} checksum={:016x} output={}",
        table.len(),
        bin_count,
        max_row_bins,
        max_weight,
        output.len(),
        fnv1a64_file(&config.histogram)?,
        fnv1a64_file(&config.output)?,
        config.output.display()
    );
    Ok(())
}

fn parse_model90_pack_config(args: &[String]) -> Result<Model90PackConfig, String> {
    let mut input = None;
    let mut output = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--input" => input = Some(PathBuf::from(argument(args, &mut index, "--input")?)),
            "--output" => output = Some(PathBuf::from(argument(args, &mut index, "--output")?)),
            other => return Err(format!("unknown pack-model90 argument {}", other)),
        }
    }
    Ok(Model90PackConfig {
        input: input.ok_or_else(|| "pack-model90 requires --input".to_string())?,
        output: output.ok_or_else(|| "pack-model90 requires --output".to_string())?,
    })
}

fn pack_model90(config: &Model90PackConfig) -> Result<(), String> {
    let source = fs::read(&config.input)
        .map_err(|error| format!("read {} failed: {}", config.input.display(), error))?;
    let mut policy: Model90PolicyFile = serde_json::from_slice(&source)
        .map_err(|error| format!("parse {} failed: {}", config.input.display(), error))?;
    if policy.rows != 330_590 || policy.peg_evs.len() != policy.rows {
        return Err(format!(
            "historical Model 9.0 source declares {} rows and contains {}; expected 330590",
            policy.rows,
            policy.peg_evs.len()
        ));
    }

    let mut bytes = Vec::with_capacity(24 + policy.rows * MODEL90_RECORD_BYTES);
    bytes.extend_from_slice(MODEL90_MAGIC);
    bytes.extend_from_slice(&1_u32.to_le_bytes());
    bytes.extend_from_slice(&(policy.rows as u32).to_le_bytes());
    bytes.extend_from_slice(&(MODEL90_RECORD_BYTES as u32).to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    let mut emitted = 0_usize;
    for six_key in enumerate_rank_count_keys(6) {
        let six = rank_counts_from_key(&six_key)?;
        for discard in discards_from_six(&six) {
            let discard_key = rank_count_key(&discard);
            for role in [Role::Pone, Role::Dealer] {
                let role_key = match role {
                    Role::Pone => "pone",
                    Role::Dealer => "dealer",
                };
                let key = format!("{}:{}:{}", six_key, discard_key, role_key);
                let (my_ev, opponent_ev, best_lead) = policy
                    .peg_evs
                    .remove(&key)
                    .ok_or_else(|| format!("historical Model 9.0 source is missing {}", key))?;
                if !my_ev.is_finite()
                    || !opponent_ev.is_finite()
                    || best_lead.is_some_and(|lead| lead >= 13)
                    || (role == Role::Pone && best_lead.is_none())
                    || (role == Role::Dealer && best_lead.is_some())
                {
                    return Err(format!(
                        "historical Model 9.0 source has invalid row {}",
                        key
                    ));
                }
                bytes.extend_from_slice(&my_ev.to_le_bytes());
                bytes.extend_from_slice(&opponent_ev.to_le_bytes());
                bytes.push(best_lead.unwrap_or(u8::MAX));
                emitted += 1;
            }
        }
    }
    if emitted != policy.rows || !policy.peg_evs.is_empty() {
        return Err(format!(
            "historical Model 9.0 canonical pack emitted {} rows with {} unexpected rows left",
            emitted,
            policy.peg_evs.len()
        ));
    }
    if let Some(parent) = config.output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create {} failed: {}", parent.display(), error))?;
    }
    atomic_write(&config.output, &bytes)?;
    println!(
        "state=complete phase=pack-model90 rows={} bytes={} checksum={:016x} output={}",
        emitted,
        bytes.len(),
        fnv1a64_file(&config.output)?,
        config.output.display()
    );
    Ok(())
}

fn parse_quantization_config(args: &[String]) -> Result<QuantizationConfig, String> {
    let mut histogram = None;
    let mut output = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--histogram" => {
                histogram = Some(PathBuf::from(argument(args, &mut index, "--histogram")?))
            }
            "--output" => output = Some(PathBuf::from(argument(args, &mut index, "--output")?)),
            other => return Err(format!("unknown analyze-quantization argument {}", other)),
        }
    }
    Ok(QuantizationConfig {
        histogram: histogram
            .ok_or_else(|| "analyze-quantization requires --histogram".to_string())?,
        output: output.ok_or_else(|| "analyze-quantization requires --output".to_string())?,
    })
}

fn analyze_histogram_quantization(config: &QuantizationConfig) -> Result<(), String> {
    const DENOMINATOR: u64 = 65_535;
    let table = Model91DiscardHistogramTable::load(&config.histogram)?;
    let mut my_error_total = 0.0;
    let mut opponent_error_total = 0.0;
    let mut net_error_total = 0.0;
    let mut my_error_max: f64 = 0.0;
    let mut opponent_error_max: f64 = 0.0;
    let mut net_error_max: f64 = 0.0;
    for row in 0..table.len() {
        let (bins, total_weight) = table
            .row(row)
            .ok_or_else(|| format!("missing Model 9.1 histogram row {}", row))?;
        let total_weight_u64 = u64::from(total_weight);
        let mut quantized = Vec::with_capacity(bins.len());
        let mut assigned = 0_u64;
        for (index, bin) in bins.iter().enumerate() {
            let numerator = u64::from(bin.weight) * DENOMINATOR;
            let floor = numerator / total_weight_u64;
            assigned += floor;
            quantized.push((index, floor as u32, numerator % total_weight_u64));
        }
        let remaining = (DENOMINATOR - assigned) as usize;
        let mut remainder_order = (0..quantized.len()).collect::<Vec<_>>();
        remainder_order.sort_by(|left, right| {
            quantized[*right]
                .2
                .cmp(&quantized[*left].2)
                .then_with(|| quantized[*left].0.cmp(&quantized[*right].0))
        });
        for index in remainder_order.into_iter().take(remaining) {
            quantized[index].1 += 1;
        }
        let exact_my = bins
            .iter()
            .map(|bin| f64::from(bin.my_points) * f64::from(bin.weight))
            .sum::<f64>()
            / f64::from(total_weight);
        let exact_opponent = bins
            .iter()
            .map(|bin| f64::from(bin.opponent_points) * f64::from(bin.weight))
            .sum::<f64>()
            / f64::from(total_weight);
        let quantized_my = quantized
            .iter()
            .map(|(index, weight, _)| f64::from(bins[*index].my_points) * f64::from(*weight))
            .sum::<f64>()
            / DENOMINATOR as f64;
        let quantized_opponent = quantized
            .iter()
            .map(|(index, weight, _)| f64::from(bins[*index].opponent_points) * f64::from(*weight))
            .sum::<f64>()
            / DENOMINATOR as f64;
        let my_error = (quantized_my - exact_my).abs();
        let opponent_error = (quantized_opponent - exact_opponent).abs();
        let net_error = ((quantized_my - quantized_opponent) - (exact_my - exact_opponent)).abs();
        my_error_total += my_error;
        opponent_error_total += opponent_error;
        net_error_total += net_error;
        my_error_max = my_error_max.max(my_error);
        opponent_error_max = opponent_error_max.max(opponent_error);
        net_error_max = net_error_max.max(net_error);
    }
    let row_count = table.len();
    let report = json!({
        "version": 1,
        "model": "schell_table-peg_table-9.1",
        "sourceHistogram": config.histogram.display().to_string(),
        "sourceHistogramChecksum": format!("{:016x}", fnv1a64_file(&config.histogram)?),
        "rows": row_count,
        "scheme": "per-row largest-remainder probability quantization",
        "denominator": DENOMINATOR,
        "projectedBinBytes": 4,
        "meanAbsoluteMyEvError": my_error_total / row_count as f64,
        "maxAbsoluteMyEvError": my_error_max,
        "meanAbsoluteOpponentEvError": opponent_error_total / row_count as f64,
        "maxAbsoluteOpponentEvError": opponent_error_max,
        "meanAbsoluteNetEvError": net_error_total / row_count as f64,
        "maxAbsoluteNetEvError": net_error_max,
        "selectedProductionFormat": "exact six-byte score-pair/u32-weight bins",
    });
    atomic_write_json(&config.output, &report)?;
    println!(
        "state=complete phase=analyze-quantization rows={} meanNetError={:.12} maxNetError={:.12} output={}",
        row_count,
        net_error_total / row_count as f64,
        net_error_max,
        config.output.display()
    );
    Ok(())
}

fn parse_belief_config(args: &[String]) -> Result<BeliefConfig, String> {
    let mut input = None;
    let mut output = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--input" => input = Some(PathBuf::from(argument(args, &mut index, "--input")?)),
            "--output" => output = Some(PathBuf::from(argument(args, &mut index, "--output")?)),
            other => return Err(format!("unknown pack-beliefs argument {}", other)),
        }
    }
    Ok(BeliefConfig {
        input: input.ok_or_else(|| "pack-beliefs requires --input".to_string())?,
        output: output.ok_or_else(|| "pack-beliefs requires --output".to_string())?,
    })
}

fn pack_beliefs(config: &BeliefConfig) -> Result<(), String> {
    let entries = load_hold_entries(&config.input)?;
    let record_count = entries.iter().map(|(_, _, rows)| rows.len()).sum::<usize>();
    let mut directory = Vec::with_capacity(entries.len() * BELIEF_ENTRY_BYTES);
    let mut records = Vec::with_capacity(record_count * BELIEF_RECORD_BYTES);
    let mut first_record = 0_u32;
    for (role, played, rows) in &entries {
        directory.push(match role {
            Role::Dealer => 0,
            Role::Pone => 1,
        });
        directory.extend_from_slice(played);
        directory.extend_from_slice(&first_record.to_le_bytes());
        directory.extend_from_slice(&(rows.len() as u32).to_le_bytes());
        for (remaining, weight) in rows {
            records.extend_from_slice(remaining);
            records.extend_from_slice(&weight.to_le_bytes());
        }
        first_record = first_record
            .checked_add(rows.len() as u32)
            .ok_or_else(|| "Model 9.1 belief record count overflow".to_string())?;
    }
    let mut bytes = Vec::with_capacity(28 + directory.len() + records.len());
    bytes.extend_from_slice(BELIEF_MAGIC);
    bytes.extend_from_slice(&1_u32.to_le_bytes());
    bytes.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&(record_count as u32).to_le_bytes());
    bytes.extend_from_slice(&(BELIEF_ENTRY_BYTES as u32).to_le_bytes());
    bytes.extend_from_slice(&(BELIEF_RECORD_BYTES as u32).to_le_bytes());
    bytes.extend_from_slice(&directory);
    bytes.extend_from_slice(&records);
    if let Some(parent) = config.output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create {} failed: {}", parent.display(), error))?;
    }
    atomic_write(&config.output, &bytes)?;
    let checksum = fnv1a64_file(&config.output)?;
    println!(
        "state=complete phase=pack-beliefs entries={} records={} bytes={} checksum={:016x} output={}",
        entries.len(),
        record_count,
        bytes.len(),
        checksum,
        config.output.display()
    );
    Ok(())
}

fn merge_pair_shards(config: &MergeConfig) -> Result<(), String> {
    if config.output.exists() {
        return Err(format!(
            "merge output {} already exists",
            config.output.display()
        ));
    }
    let keep_count = enumerate_rank_count_keys(4).len();
    let mut shards = Vec::new();
    for entry in fs::read_dir(&config.shards)
        .map_err(|error| format!("read {} failed: {}", config.shards.display(), error))?
    {
        let entry = entry.map_err(|error| format!("read shard entry failed: {}", error))?;
        if !entry
            .file_type()
            .map_err(|error| format!("stat shard entry failed: {}", error))?
            .is_dir()
        {
            continue;
        }
        let checkpoint_path = entry.path().join(CHECKPOINT_FILE);
        let pair_path = entry.path().join(PAIR_FILE);
        let lead_path = entry.path().join(LEAD_FILE);
        if !checkpoint_path.exists() || !pair_path.exists() || !lead_path.exists() {
            continue;
        }
        let checkpoint = read_pair_checkpoint(&checkpoint_path)?;
        if checkpoint.completed_dealer_keeps != checkpoint.dealer_count {
            return Err(format!("shard {} is not complete", entry.path().display()));
        }
        validate_pair_header(&pair_path, &checkpoint, keep_count)?;
        if checkpoint.pone_start != 0 || checkpoint.pone_count != keep_count {
            return Err(format!(
                "shard {} does not cover every pone keep",
                entry.path().display()
            ));
        }
        shards.push((checkpoint, pair_path, lead_path));
    }
    shards.sort_by_key(|(checkpoint, _, _)| checkpoint.dealer_start);
    if shards.is_empty() {
        return Err("no complete Model 9.1 pair shards found".to_string());
    }
    let hold_checksum = shards[0].0.hold_checksum;
    let lead_checksum = fnv1a64_file(&shards[0].2)?;
    let mut next_dealer = 0_usize;
    let mut valid_pairs = 0_u64;
    for (checkpoint, _, lead_path) in &shards {
        if checkpoint.dealer_start != next_dealer {
            return Err(format!(
                "pair shards have a gap or overlap at dealer keep {}",
                next_dealer
            ));
        }
        if checkpoint.hold_checksum != hold_checksum {
            return Err("pair shards use different empirical hold tables".to_string());
        }
        if fnv1a64_file(lead_path)? != lead_checksum {
            return Err("pair shards produced different pone-lead files".to_string());
        }
        next_dealer += checkpoint.dealer_count;
        valid_pairs += checkpoint.valid_pairs;
    }
    if next_dealer != keep_count {
        return Err(format!(
            "pair shards cover {} dealer keeps; expected {}",
            next_dealer, keep_count
        ));
    }
    fs::create_dir_all(&config.output)
        .map_err(|error| format!("create {} failed: {}", config.output.display(), error))?;
    let merged_checkpoint = PairCheckpoint {
        hold_checksum,
        dealer_start: 0,
        dealer_count: keep_count,
        pone_start: 0,
        pone_count: keep_count,
        completed_dealer_keeps: keep_count,
        valid_pairs,
        bytes_written: (PAIR_HEADER_BYTES + keep_count * keep_count * PAIR_RECORD_BYTES) as u64,
    };
    let pair_output = config.output.join(PAIR_FILE);
    let mut output = File::create(&pair_output)
        .map_err(|error| format!("create {} failed: {}", pair_output.display(), error))?;
    write_pair_header(&mut output, &merged_checkpoint, keep_count)?;
    for (_, pair_path, _) in &shards {
        let mut input = File::open(pair_path)
            .map_err(|error| format!("open {} failed: {}", pair_path.display(), error))?;
        input
            .seek(SeekFrom::Start(PAIR_HEADER_BYTES as u64))
            .map_err(|error| format!("seek {} failed: {}", pair_path.display(), error))?;
        std::io::copy(&mut input, &mut output)
            .map_err(|error| format!("merge {} failed: {}", pair_path.display(), error))?;
    }
    output
        .sync_all()
        .map_err(|error| format!("sync {} failed: {}", pair_output.display(), error))?;
    fs::copy(&shards[0].2, config.output.join(LEAD_FILE))
        .map_err(|error| format!("copy merged pone leads failed: {}", error))?;
    write_pair_checkpoint(&config.output.join(CHECKPOINT_FILE), &merged_checkpoint)?;
    let checksum = fnv1a64_file(&pair_output)?;
    let manifest = json!({
        "version": 1,
        "model": "schell_table-peg_table-9.1",
        "phase": "merged-pairs",
        "magic": "M91PR001",
        "keepCount": keep_count,
        "validPairs": valid_pairs,
        "recordBytes": PAIR_RECORD_BYTES,
        "bytes": merged_checkpoint.bytes_written,
        "holdChecksum": format!("{:016x}", hold_checksum),
        "leadChecksum": format!("{:016x}", lead_checksum),
        "outputChecksum": format!("{:016x}", checksum),
        "shards": shards.len(),
        "sourceRoot": config.shards.display().to_string(),
    });
    atomic_write_json(&config.output.join(MANIFEST_FILE), &manifest)?;
    println!(
        "state=complete phase=merge-pairs shards={} dealerKeeps={} validPairs={} bytes={} checksum={:016x} output={}",
        shards.len(),
        keep_count,
        valid_pairs,
        merged_checkpoint.bytes_written,
        checksum,
        pair_output.display()
    );
    Ok(())
}

fn parse_merge_config(args: &[String]) -> Result<MergeConfig, String> {
    let mut shards = None;
    let mut output = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--shards" => shards = Some(PathBuf::from(argument(args, &mut index, "--shards")?)),
            "--output" => output = Some(PathBuf::from(argument(args, &mut index, "--output")?)),
            other => return Err(format!("unknown merge-pairs argument {}", other)),
        }
    }
    Ok(MergeConfig {
        shards: shards.ok_or_else(|| "merge-pairs requires --shards".to_string())?,
        output: output.ok_or_else(|| "merge-pairs requires --output".to_string())?,
    })
}

fn build_pairs(config: &PairConfig) -> Result<(), String> {
    let keep_keys = enumerate_rank_count_keys(4);
    let keeps = keep_keys
        .iter()
        .map(|key| rank_counts_from_key(key))
        .collect::<Result<Vec<_>, _>>()?;
    let keep_count = keeps.len();
    let dealer_count = config
        .dealer_count
        .unwrap_or(keep_count.saturating_sub(config.dealer_start));
    let pone_count = config
        .pone_count
        .unwrap_or(keep_count.saturating_sub(config.pone_start));
    validate_range("dealer", config.dealer_start, dealer_count, keep_count)?;
    validate_range("pone", config.pone_start, pone_count, keep_count)?;

    let (empirical, hold_checksum) = match &config.hold_table {
        Some(path) => (Some(load_hold_table(path)?), fnv1a64_file(path)?),
        None => (None, 0),
    };
    fs::create_dir_all(&config.output)
        .map_err(|error| format!("create {} failed: {}", config.output.display(), error))?;
    let pair_path = config.output.join(PAIR_FILE);
    let checkpoint_path = config.output.join(CHECKPOINT_FILE);
    let resumable_build_exists = checkpoint_path.exists() || pair_path.exists();
    let mut checkpoint = if config.resume && resumable_build_exists {
        if !checkpoint_path.exists() || !pair_path.exists() {
            return Err(
                "Model 9.1 pair resume requires both checkpoint and pair files".to_string(),
            );
        }
        let checkpoint = read_pair_checkpoint(&checkpoint_path)?;
        validate_checkpoint(
            &checkpoint,
            hold_checksum,
            config.dealer_start,
            dealer_count,
            config.pone_start,
            pone_count,
        )?;
        validate_pair_header(&pair_path, &checkpoint, keep_count)?;
        checkpoint
    } else {
        if pair_path.exists() || checkpoint_path.exists() {
            return Err(format!(
                "{} already contains a pair build; use --resume or a new output directory",
                config.output.display()
            ));
        }
        let checkpoint = PairCheckpoint {
            hold_checksum,
            dealer_start: config.dealer_start,
            dealer_count,
            pone_start: config.pone_start,
            pone_count,
            completed_dealer_keeps: 0,
            valid_pairs: 0,
            bytes_written: PAIR_HEADER_BYTES as u64,
        };
        let mut file = File::create(&pair_path)
            .map_err(|error| format!("create {} failed: {}", pair_path.display(), error))?;
        write_pair_header(&mut file, &checkpoint, keep_count)?;
        file.sync_all()
            .map_err(|error| format!("sync {} failed: {}", pair_path.display(), error))?;
        checkpoint
    };
    let expected_length = checkpoint.bytes_written;
    let metadata = fs::metadata(&pair_path)
        .map_err(|error| format!("stat {} failed: {}", pair_path.display(), error))?;
    if metadata.len() < expected_length {
        return Err("Model 9.1 pair file is shorter than its checkpoint".to_string());
    }
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&pair_path)
        .map_err(|error| format!("open {} failed: {}", pair_path.display(), error))?;
    file.set_len(expected_length)
        .map_err(|error| format!("truncate {} failed: {}", pair_path.display(), error))?;
    file.seek(SeekFrom::End(0))
        .map_err(|error| format!("seek {} failed: {}", pair_path.display(), error))?;

    let mut policy = Model91Policy::new(empirical, config.policy_cache_limit);
    let started = Instant::now();
    write_pair_status(
        config,
        &checkpoint,
        policy.stats(),
        started.elapsed(),
        "running",
        None,
    )?;
    for relative_dealer in checkpoint.completed_dealer_keeps..dealer_count {
        let dealer_id = config.dealer_start + relative_dealer;
        let dealer_keep = keeps[dealer_id];
        let mut row = Vec::with_capacity(pone_count * PAIR_RECORD_BYTES);
        let mut unit_valid_pairs = 0_u64;
        for pone_id in config.pone_start..config.pone_start + pone_count {
            let pone_keep = keeps[pone_id];
            let packed = if compatible(&dealer_keep, &pone_keep) {
                let (dealer_points, pone_points) =
                    rollout_model91_pair(dealer_keep, pone_keep, &mut policy)?;
                unit_valid_pairs += 1;
                pack_pair(dealer_points, pone_points)?
            } else {
                INVALID_PAIR
            };
            row.extend_from_slice(&packed.to_le_bytes());
        }
        file.write_all(&row)
            .map_err(|error| format!("append {} failed: {}", pair_path.display(), error))?;
        checkpoint.completed_dealer_keeps = relative_dealer + 1;
        checkpoint.valid_pairs += unit_valid_pairs;
        checkpoint.bytes_written += row.len() as u64;
        let checkpoint_due = checkpoint.completed_dealer_keeps == dealer_count
            || checkpoint.completed_dealer_keeps % config.status_every == 0;
        if checkpoint_due {
            file.sync_all()
                .map_err(|error| format!("sync {} failed: {}", pair_path.display(), error))?;
            write_pair_checkpoint(&checkpoint_path, &checkpoint)?;
            write_pair_status(
                config,
                &checkpoint,
                policy.stats(),
                started.elapsed(),
                "running",
                None,
            )?;
        }
    }
    file.sync_all()
        .map_err(|error| format!("sync {} failed: {}", pair_path.display(), error))?;
    write_pone_leads(config, &keeps, &mut policy)?;
    write_pair_checkpoint(&checkpoint_path, &checkpoint)?;
    let output_checksum = fnv1a64_file(&pair_path)?;
    let elapsed = started.elapsed();
    write_pair_status(
        config,
        &checkpoint,
        policy.stats(),
        elapsed,
        "complete",
        Some(output_checksum),
    )?;
    write_pair_manifest(
        config,
        &checkpoint,
        policy.stats(),
        elapsed,
        output_checksum,
        keep_count,
    )?;
    println!(
        "state=complete phase=pairs dealerKeeps={}/{} validPairs={} bytes={} elapsedSeconds={:.3} checksum={:016x} status={}",
        checkpoint.completed_dealer_keeps,
        checkpoint.dealer_count,
        checkpoint.valid_pairs,
        checkpoint.bytes_written,
        elapsed.as_secs_f64(),
        output_checksum,
        config.output.join(STATUS_FILE).display()
    );
    Ok(())
}

fn build_aggregate(config: &AggregateConfig) -> Result<(), String> {
    let pair_checksum = fnv1a64_file(&config.pairs)?;
    let lead_checksum = fnv1a64_file(&config.leads)?;
    let pair_matrix = load_pair_matrix(&config.pairs)?;
    let leads = load_pone_leads(&config.leads, pair_matrix.keep_count)?;
    let keep_keys = enumerate_rank_count_keys(4);
    let keeps = keep_keys
        .iter()
        .map(|key| rank_counts_from_key(key))
        .collect::<Result<Vec<_>, _>>()?;
    if pair_matrix.keep_count != keeps.len() {
        return Err("Model 9.1 pair matrix keep count does not match canonical keeps".to_string());
    }
    let keep_ids = keeps
        .iter()
        .copied()
        .enumerate()
        .map(|(index, keep)| (keep, index))
        .collect::<HashMap<_, _>>();
    let six_keys = enumerate_rank_count_keys(6);
    let six_hands = six_keys
        .iter()
        .map(|key| rank_counts_from_key(key))
        .collect::<Result<Vec<_>, _>>()?;
    let six_count = config
        .six_count
        .unwrap_or(six_hands.len().saturating_sub(config.six_start));
    validate_range("six-card", config.six_start, six_count, six_hands.len())?;
    let target_rows = six_hands[config.six_start..config.six_start + six_count]
        .iter()
        .map(|hand| discards_from_six(hand).len() * 2)
        .sum::<usize>();

    fs::create_dir_all(&config.output)
        .map_err(|error| format!("create {} failed: {}", config.output.display(), error))?;
    let ev_path = config.output.join(EV_FILE);
    let hist_rows_path = config.output.join(HIST_ROWS_FILE);
    let checkpoint_path = config.output.join(AGGREGATE_CHECKPOINT_FILE);
    let resumable_build_exists =
        checkpoint_path.exists() || ev_path.exists() || hist_rows_path.exists();
    let mut checkpoint = if config.resume && resumable_build_exists {
        if !checkpoint_path.exists() || !ev_path.exists() || !hist_rows_path.exists() {
            return Err(
                "Model 9.1 aggregate resume requires checkpoint, EV, and histogram-row files"
                    .to_string(),
            );
        }
        let checkpoint = read_aggregate_checkpoint(&checkpoint_path)?;
        validate_aggregate_checkpoint(
            &checkpoint,
            pair_checksum,
            lead_checksum,
            config.six_start,
            six_count,
        )?;
        checkpoint
    } else {
        if ev_path.exists() || hist_rows_path.exists() || checkpoint_path.exists() {
            return Err(format!(
                "{} already contains an aggregate build; use --resume or a new output directory",
                config.output.display()
            ));
        }
        let mut ev_file = File::create(&ev_path)
            .map_err(|error| format!("create {} failed: {}", ev_path.display(), error))?;
        write_ev_header(&mut ev_file, target_rows)?;
        ev_file
            .sync_all()
            .map_err(|error| format!("sync {} failed: {}", ev_path.display(), error))?;
        File::create(&hist_rows_path)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("create {} failed: {}", hist_rows_path.display(), error))?;
        AggregateCheckpoint {
            pair_checksum,
            lead_checksum,
            six_start: config.six_start,
            six_count,
            completed_six_hands: 0,
            completed_rows: 0,
            histogram_bins: 0,
            ev_bytes: EV_HEADER_BYTES as u64,
            histogram_row_bytes: 0,
        }
    };
    validate_aggregate_lengths(&ev_path, &hist_rows_path, &checkpoint)?;
    let mut ev_file = open_truncated(&ev_path, checkpoint.ev_bytes)?;
    let mut hist_rows_file = open_truncated(&hist_rows_path, checkpoint.histogram_row_bytes)?;

    let started = Instant::now();
    write_aggregate_status(config, &checkpoint, started.elapsed(), "running", None)?;
    for relative_six in checkpoint.completed_six_hands..six_count {
        let six_id = config.six_start + relative_six;
        let six = six_hands[six_id];
        let mut available = [4_u8; 13];
        for rank in 0..13 {
            available[rank] = available[rank]
                .checked_sub(six[rank])
                .ok_or_else(|| format!("six-card hand {} exceeds rank availability", six_id))?;
        }
        let opponent_hands = enumerate_rank_hands(&available, 4)
            .into_iter()
            .map(|(hand, weight)| {
                let keep_id = keep_ids
                    .get(&hand)
                    .copied()
                    .ok_or_else(|| "enumerated opponent keep lacks canonical id".to_string())?;
                let integer_weight = weight.round() as u32;
                if (weight - f64::from(integer_weight)).abs() > f64::EPSILON {
                    return Err("opponent keep multiplicity is not integral".to_string());
                }
                Ok((keep_id, integer_weight))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let mut unit_rows = 0_usize;
        let mut unit_bins = 0_u64;
        for discard in discards_from_six(&six) {
            let keep = subtract_ranks(&six, &discard)?;
            let own_keep_id = keep_ids
                .get(&keep)
                .copied()
                .ok_or_else(|| "discard candidate keep lacks canonical id".to_string())?;
            for role in [Role::Pone, Role::Dealer] {
                let mut histogram = BTreeMap::<u16, u32>::new();
                let mut my_sum = 0_u64;
                let mut opponent_sum = 0_u64;
                let mut total_weight = 0_u32;
                for (opponent_keep_id, weight) in &opponent_hands {
                    let (dealer_id, pone_id) = match role {
                        Role::Dealer => (own_keep_id, *opponent_keep_id),
                        Role::Pone => (*opponent_keep_id, own_keep_id),
                    };
                    let (dealer_points, pone_points) =
                        pair_matrix.outcome(dealer_id, pone_id)?.ok_or_else(|| {
                            "compatible opponent keep is missing from Model 9.1 pair matrix"
                                .to_string()
                        })?;
                    let (my_points, opponent_points) = match role {
                        Role::Dealer => (dealer_points, pone_points),
                        Role::Pone => (pone_points, dealer_points),
                    };
                    let score_pair = pack_pair(my_points, opponent_points)?;
                    *histogram.entry(score_pair).or_insert(0) = histogram
                        .get(&score_pair)
                        .copied()
                        .unwrap_or(0)
                        .checked_add(*weight)
                        .ok_or_else(|| "Model 9.1 histogram bin weight overflow".to_string())?;
                    my_sum += u64::from(my_points) * u64::from(*weight);
                    opponent_sum += u64::from(opponent_points) * u64::from(*weight);
                    total_weight = total_weight
                        .checked_add(*weight)
                        .ok_or_else(|| "Model 9.1 histogram total weight overflow".to_string())?;
                }
                let lead = match role {
                    Role::Pone => leads[own_keep_id],
                    Role::Dealer => u8::MAX,
                };
                write_ev_record(&mut ev_file, my_sum, opponent_sum, total_weight, lead)?;
                write_histogram_row(&mut hist_rows_file, &histogram, total_weight)?;
                unit_rows += 1;
                unit_bins += histogram.len() as u64;
            }
        }
        checkpoint.completed_six_hands = relative_six + 1;
        checkpoint.completed_rows += unit_rows;
        checkpoint.histogram_bins += unit_bins;
        checkpoint.ev_bytes += (unit_rows * EV_RECORD_BYTES) as u64;
        checkpoint.histogram_row_bytes +=
            (unit_rows * 6) as u64 + unit_bins * HIST_BIN_BYTES as u64;
        let checkpoint_due = checkpoint.completed_six_hands == six_count
            || checkpoint.completed_six_hands % config.status_every == 0;
        if checkpoint_due {
            ev_file
                .sync_all()
                .map_err(|error| format!("sync {} failed: {}", ev_path.display(), error))?;
            hist_rows_file
                .sync_all()
                .map_err(|error| format!("sync {} failed: {}", hist_rows_path.display(), error))?;
            write_aggregate_checkpoint(&checkpoint_path, &checkpoint)?;
            write_aggregate_status(config, &checkpoint, started.elapsed(), "running", None)?;
        }
    }
    if checkpoint.completed_rows != target_rows {
        return Err(format!(
            "Model 9.1 aggregate emitted {} rows; expected {}",
            checkpoint.completed_rows, target_rows
        ));
    }
    ev_file
        .sync_all()
        .map_err(|error| format!("sync {} failed: {}", ev_path.display(), error))?;
    hist_rows_file
        .sync_all()
        .map_err(|error| format!("sync {} failed: {}", hist_rows_path.display(), error))?;
    write_aggregate_checkpoint(&checkpoint_path, &checkpoint)?;
    let hist_path = config.output.join(HIST_FILE);
    pack_histogram_asset(&hist_rows_path, &hist_path, checkpoint.completed_rows)?;
    validate_ev_histogram_means(&ev_path, &hist_path)?;
    let ev_checksum = fnv1a64_file(&ev_path)?;
    let hist_checksum = fnv1a64_file(&hist_path)?;
    let elapsed = started.elapsed();
    write_aggregate_status(
        config,
        &checkpoint,
        elapsed,
        "complete",
        Some((ev_checksum, hist_checksum)),
    )?;
    write_aggregate_manifest(
        config,
        &checkpoint,
        elapsed,
        ev_checksum,
        hist_checksum,
        fs::metadata(&hist_path)
            .map_err(|error| format!("stat {} failed: {}", hist_path.display(), error))?
            .len(),
    )?;
    println!(
        "state=complete phase=aggregate sixHands={}/{} rows={} bins={} evBytes={} histogramBytes={} elapsedSeconds={:.3} evChecksum={:016x} histogramChecksum={:016x} status={}",
        checkpoint.completed_six_hands,
        checkpoint.six_count,
        checkpoint.completed_rows,
        checkpoint.histogram_bins,
        checkpoint.ev_bytes,
        fs::metadata(&hist_path).map(|metadata| metadata.len()).unwrap_or(0),
        elapsed.as_secs_f64(),
        ev_checksum,
        hist_checksum,
        config.output.join(AGGREGATE_STATUS_FILE).display()
    );
    Ok(())
}

impl PairMatrix {
    fn outcome(&self, dealer_id: usize, pone_id: usize) -> Result<Option<(u8, u8)>, String> {
        if dealer_id >= self.keep_count || pone_id >= self.keep_count {
            return Err("Model 9.1 pair lookup is outside the keep matrix".to_string());
        }
        Ok(unpack_pair_value(
            self.values[dealer_id * self.keep_count + pone_id],
        ))
    }
}

fn load_pair_matrix(path: &Path) -> Result<PairMatrix, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("read pair matrix {} failed: {}", path.display(), error))?;
    if bytes.len() < PAIR_HEADER_BYTES || &bytes[..8] != PAIR_MAGIC {
        return Err("invalid Model 9.1 pair matrix header".to_string());
    }
    if read_u32(&bytes, 8)? != PAIR_VERSION {
        return Err("unsupported Model 9.1 pair matrix version".to_string());
    }
    let keep_count = read_u32(&bytes, 12)? as usize;
    let dealer_start = read_u32(&bytes, 16)? as usize;
    let dealer_count = read_u32(&bytes, 20)? as usize;
    let pone_start = read_u32(&bytes, 24)? as usize;
    let pone_count = read_u32(&bytes, 28)? as usize;
    if dealer_start != 0
        || pone_start != 0
        || dealer_count != keep_count
        || pone_count != keep_count
    {
        return Err("aggregate requires a complete Model 9.1 pair matrix".to_string());
    }
    let expected = PAIR_HEADER_BYTES + keep_count * keep_count * PAIR_RECORD_BYTES;
    if bytes.len() != expected {
        return Err(format!(
            "Model 9.1 pair matrix has {} bytes; expected {}",
            bytes.len(),
            expected
        ));
    }
    let values = bytes[PAIR_HEADER_BYTES..]
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    Ok(PairMatrix { keep_count, values })
}

fn load_pone_leads(path: &Path, expected_keep_count: usize) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("read pone leads {} failed: {}", path.display(), error))?;
    if bytes.len() < 24 || &bytes[..8] != LEAD_MAGIC || read_u32(&bytes, 8)? != 1 {
        return Err("invalid Model 9.1 pone-lead header".to_string());
    }
    let keep_count = read_u32(&bytes, 12)? as usize;
    let start = read_u32(&bytes, 16)? as usize;
    let count = read_u32(&bytes, 20)? as usize;
    if keep_count != expected_keep_count || start != 0 || count != keep_count {
        return Err("aggregate requires a complete Model 9.1 pone-lead table".to_string());
    }
    if bytes.len() != 24 + keep_count {
        return Err("Model 9.1 pone-lead file length is inconsistent".to_string());
    }
    if bytes[24..].iter().any(|lead| *lead >= 13) {
        return Err("Model 9.1 pone-lead file contains an invalid rank".to_string());
    }
    Ok(bytes[24..].to_vec())
}

fn parse_aggregate_config(args: &[String]) -> Result<AggregateConfig, String> {
    let mut pairs = None;
    let mut leads = None;
    let mut output = None;
    let mut resume = false;
    let mut six_start = 0_usize;
    let mut six_count = None;
    let mut status_every = 10_usize;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--resume" => {
                resume = true;
                index += 1;
            }
            "--pairs" => pairs = Some(PathBuf::from(argument(args, &mut index, "--pairs")?)),
            "--leads" => leads = Some(PathBuf::from(argument(args, &mut index, "--leads")?)),
            "--output" => output = Some(PathBuf::from(argument(args, &mut index, "--output")?)),
            "--six-start" => {
                six_start = parse_usize(&argument(args, &mut index, "--six-start")?, "six start")?
            }
            "--six-count" => {
                six_count = Some(parse_usize(
                    &argument(args, &mut index, "--six-count")?,
                    "six count",
                )?)
            }
            "--status-every" => {
                status_every = parse_usize(
                    &argument(args, &mut index, "--status-every")?,
                    "status interval",
                )?;
                if status_every == 0 {
                    return Err("--status-every must be positive".to_string());
                }
            }
            other => return Err(format!("unknown aggregate argument {}", other)),
        }
    }
    Ok(AggregateConfig {
        pairs: pairs.ok_or_else(|| "aggregate requires --pairs".to_string())?,
        leads: leads.ok_or_else(|| "aggregate requires --leads".to_string())?,
        output: output.ok_or_else(|| "aggregate requires --output".to_string())?,
        resume,
        six_start,
        six_count,
        status_every,
    })
}

fn discards_from_six(hand: &[u8; 13]) -> Vec<[u8; 13]> {
    let mut discards = Vec::new();
    for first in 0..13 {
        if hand[first] == 0 {
            continue;
        }
        for second in first..13 {
            if hand[second] == 0 || (first == second && hand[first] < 2) {
                continue;
            }
            let mut discard = [0_u8; 13];
            discard[first] += 1;
            discard[second] += 1;
            discards.push(discard);
        }
    }
    discards
}

fn subtract_ranks(whole: &[u8; 13], part: &[u8; 13]) -> Result<[u8; 13], String> {
    let mut result = [0_u8; 13];
    for rank in 0..13 {
        result[rank] = whole[rank]
            .checked_sub(part[rank])
            .ok_or_else(|| "discard is not contained in six-card hand".to_string())?;
    }
    if rank_count_total(&result) != 4 {
        return Err("discard did not leave a four-card keep".to_string());
    }
    Ok(result)
}

fn write_ev_header(writer: &mut impl Write, row_count: usize) -> Result<(), String> {
    writer
        .write_all(EV_MAGIC)
        .and_then(|_| writer.write_all(&1_u32.to_le_bytes()))
        .and_then(|_| writer.write_all(&(row_count as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(EV_RECORD_BYTES as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&0_u32.to_le_bytes()))
        .map_err(|error| format!("write Model 9.1 EV header failed: {}", error))
}

fn write_ev_record(
    writer: &mut impl Write,
    my_sum: u64,
    opponent_sum: u64,
    total_weight: u32,
    lead: u8,
) -> Result<(), String> {
    let my_sum = u32::try_from(my_sum)
        .map_err(|_| "Model 9.1 player weighted score exceeds u32".to_string())?;
    let opponent_sum = u32::try_from(opponent_sum)
        .map_err(|_| "Model 9.1 opponent weighted score exceeds u32".to_string())?;
    writer
        .write_all(&my_sum.to_le_bytes())
        .and_then(|_| writer.write_all(&opponent_sum.to_le_bytes()))
        .and_then(|_| writer.write_all(&total_weight.to_le_bytes()))
        .and_then(|_| writer.write_all(&[lead]))
        .map_err(|error| format!("write Model 9.1 EV record failed: {}", error))
}

fn write_histogram_row(
    writer: &mut impl Write,
    histogram: &BTreeMap<u16, u32>,
    total_weight: u32,
) -> Result<(), String> {
    let bin_count = u16::try_from(histogram.len())
        .map_err(|_| "Model 9.1 histogram has too many bins".to_string())?;
    writer
        .write_all(&bin_count.to_le_bytes())
        .and_then(|_| writer.write_all(&total_weight.to_le_bytes()))
        .map_err(|error| format!("write Model 9.1 histogram row failed: {}", error))?;
    for (pair, weight) in histogram {
        writer
            .write_all(&pair.to_le_bytes())
            .and_then(|_| writer.write_all(&weight.to_le_bytes()))
            .map_err(|error| format!("write Model 9.1 histogram bin failed: {}", error))?;
    }
    Ok(())
}

fn pack_histogram_asset(rows_path: &Path, output: &Path, row_count: usize) -> Result<(), String> {
    let bytes = fs::read(rows_path).map_err(|error| {
        format!(
            "read histogram rows {} failed: {}",
            rows_path.display(),
            error
        )
    })?;
    let mut offsets = Vec::with_capacity(row_count + 1);
    let mut totals = Vec::with_capacity(row_count);
    let mut cursor = 0_usize;
    let mut bins = 0_u32;
    offsets.push(0_u32);
    for _ in 0..row_count {
        let bin_count = read_u16(&bytes, cursor)? as usize;
        let total = read_u32(&bytes, cursor + 2)?;
        cursor += 6;
        let bin_bytes = bin_count
            .checked_mul(HIST_BIN_BYTES)
            .ok_or_else(|| "Model 9.1 histogram row byte overflow".to_string())?;
        if cursor + bin_bytes > bytes.len() {
            return Err("Model 9.1 histogram row file is truncated".to_string());
        }
        totals.push(total);
        bins = bins
            .checked_add(bin_count as u32)
            .ok_or_else(|| "Model 9.1 histogram bin offset overflow".to_string())?;
        offsets.push(bins);
        cursor += bin_bytes;
    }
    if cursor != bytes.len() {
        return Err(format!(
            "Model 9.1 histogram rows contain {} trailing bytes",
            bytes.len() - cursor
        ));
    }
    let mut file = File::create(output)
        .map_err(|error| format!("create {} failed: {}", output.display(), error))?;
    file.write_all(HIST_MAGIC)
        .and_then(|_| file.write_all(&1_u32.to_le_bytes()))
        .and_then(|_| file.write_all(&(row_count as u32).to_le_bytes()))
        .and_then(|_| file.write_all(&(HIST_BIN_BYTES as u32).to_le_bytes()))
        .and_then(|_| file.write_all(&bins.to_le_bytes()))
        .map_err(|error| format!("write {} header failed: {}", output.display(), error))?;
    for offset in &offsets {
        file.write_all(&offset.to_le_bytes())
            .map_err(|error| format!("write {} offsets failed: {}", output.display(), error))?;
    }
    for total in &totals {
        file.write_all(&total.to_le_bytes())
            .map_err(|error| format!("write {} totals failed: {}", output.display(), error))?;
    }
    cursor = 0;
    for _ in 0..row_count {
        let bin_count = read_u16(&bytes, cursor)? as usize;
        cursor += 6;
        let bin_bytes = bin_count * HIST_BIN_BYTES;
        file.write_all(&bytes[cursor..cursor + bin_bytes])
            .map_err(|error| format!("write {} bins failed: {}", output.display(), error))?;
        cursor += bin_bytes;
    }
    file.sync_all()
        .map_err(|error| format!("sync {} failed: {}", output.display(), error))
}

fn validate_ev_histogram_means(ev_path: &Path, hist_path: &Path) -> Result<(), String> {
    let ev = fs::read(ev_path)
        .map_err(|error| format!("read EV asset {} failed: {}", ev_path.display(), error))?;
    let hist = fs::read(hist_path)
        .map_err(|error| format!("read histogram {} failed: {}", hist_path.display(), error))?;
    if ev.len() < EV_HEADER_BYTES || &ev[..8] != EV_MAGIC {
        return Err("invalid Model 9.1 EV asset".to_string());
    }
    if hist.len() < HIST_HEADER_BYTES || &hist[..8] != HIST_MAGIC {
        return Err("invalid Model 9.1 histogram asset".to_string());
    }
    let row_count = read_u32(&ev, 12)? as usize;
    if read_u32(&hist, 12)? as usize != row_count {
        return Err("Model 9.1 EV/histogram row counts differ".to_string());
    }
    let bin_count = read_u32(&hist, 20)? as usize;
    let offsets_start = HIST_HEADER_BYTES;
    let totals_start = offsets_start + (row_count + 1) * 4;
    let bins_start = totals_start + row_count * 4;
    if bins_start + bin_count * HIST_BIN_BYTES != hist.len() {
        return Err("Model 9.1 histogram asset length is inconsistent".to_string());
    }
    for row in 0..row_count {
        let ev_offset = EV_HEADER_BYTES + row * EV_RECORD_BYTES;
        let expected_my = read_u32(&ev, ev_offset)? as u64;
        let expected_opponent = read_u32(&ev, ev_offset + 4)? as u64;
        let expected_total = read_u32(&ev, ev_offset + 8)?;
        let total = read_u32(&hist, totals_start + row * 4)?;
        if total != expected_total {
            return Err(format!("Model 9.1 row {} total weight differs", row));
        }
        let start = read_u32(&hist, offsets_start + row * 4)? as usize;
        let end = read_u32(&hist, offsets_start + (row + 1) * 4)? as usize;
        let mut my_sum = 0_u64;
        let mut opponent_sum = 0_u64;
        let mut weight_sum = 0_u32;
        for bin in start..end {
            let offset = bins_start + bin * HIST_BIN_BYTES;
            let pair = read_u16(&hist, offset)?;
            let (my, opponent) = unpack_pair_value(pair)
                .ok_or_else(|| format!("Model 9.1 row {} contains invalid score pair", row))?;
            let weight = read_u32(&hist, offset + 2)?;
            my_sum += u64::from(my) * u64::from(weight);
            opponent_sum += u64::from(opponent) * u64::from(weight);
            weight_sum = weight_sum
                .checked_add(weight)
                .ok_or_else(|| "Model 9.1 validation weight overflow".to_string())?;
        }
        if my_sum != expected_my || opponent_sum != expected_opponent || weight_sum != total {
            return Err(format!(
                "Model 9.1 row {} histogram mean validation failed",
                row
            ));
        }
    }
    Ok(())
}

fn write_aggregate_checkpoint(path: &Path, checkpoint: &AggregateCheckpoint) -> Result<(), String> {
    let contents = format!(
        concat!(
            "pairChecksum={:016x}\n",
            "leadChecksum={:016x}\n",
            "sixStart={}\n",
            "sixCount={}\n",
            "completedSixHands={}\n",
            "completedRows={}\n",
            "histogramBins={}\n",
            "evBytes={}\n",
            "histogramRowBytes={}\n"
        ),
        checkpoint.pair_checksum,
        checkpoint.lead_checksum,
        checkpoint.six_start,
        checkpoint.six_count,
        checkpoint.completed_six_hands,
        checkpoint.completed_rows,
        checkpoint.histogram_bins,
        checkpoint.ev_bytes,
        checkpoint.histogram_row_bytes,
    );
    atomic_write(path, contents.as_bytes())
}

fn read_aggregate_checkpoint(path: &Path) -> Result<AggregateCheckpoint, String> {
    let fields = read_key_values(path)?;
    Ok(AggregateCheckpoint {
        pair_checksum: parse_hex_field(&fields, "pairChecksum")?,
        lead_checksum: parse_hex_field(&fields, "leadChecksum")?,
        six_start: parse_field(&fields, "sixStart")?,
        six_count: parse_field(&fields, "sixCount")?,
        completed_six_hands: parse_field(&fields, "completedSixHands")?,
        completed_rows: parse_field(&fields, "completedRows")?,
        histogram_bins: parse_field(&fields, "histogramBins")?,
        ev_bytes: parse_field(&fields, "evBytes")?,
        histogram_row_bytes: parse_field(&fields, "histogramRowBytes")?,
    })
}

fn validate_aggregate_checkpoint(
    checkpoint: &AggregateCheckpoint,
    pair_checksum: u64,
    lead_checksum: u64,
    six_start: usize,
    six_count: usize,
) -> Result<(), String> {
    if checkpoint.pair_checksum != pair_checksum
        || checkpoint.lead_checksum != lead_checksum
        || checkpoint.six_start != six_start
        || checkpoint.six_count != six_count
        || checkpoint.completed_six_hands > six_count
    {
        return Err(
            "resume configuration does not match Model 9.1 aggregate checkpoint".to_string(),
        );
    }
    if checkpoint.ev_bytes
        != EV_HEADER_BYTES as u64 + (checkpoint.completed_rows * EV_RECORD_BYTES) as u64
    {
        return Err("Model 9.1 aggregate checkpoint EV byte count is inconsistent".to_string());
    }
    Ok(())
}

fn validate_aggregate_lengths(
    ev_path: &Path,
    hist_rows_path: &Path,
    checkpoint: &AggregateCheckpoint,
) -> Result<(), String> {
    let ev_length = fs::metadata(ev_path)
        .map_err(|error| format!("stat {} failed: {}", ev_path.display(), error))?
        .len();
    let hist_length = fs::metadata(hist_rows_path)
        .map_err(|error| format!("stat {} failed: {}", hist_rows_path.display(), error))?
        .len();
    if ev_length < checkpoint.ev_bytes || hist_length < checkpoint.histogram_row_bytes {
        return Err("Model 9.1 aggregate file is shorter than its checkpoint".to_string());
    }
    Ok(())
}

fn open_truncated(path: &Path, length: u64) -> Result<File, String> {
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("open {} failed: {}", path.display(), error))?;
    file.set_len(length)
        .map_err(|error| format!("truncate {} failed: {}", path.display(), error))?;
    file.seek(SeekFrom::End(0))
        .map_err(|error| format!("seek {} failed: {}", path.display(), error))?;
    Ok(file)
}

fn write_aggregate_status(
    config: &AggregateConfig,
    checkpoint: &AggregateCheckpoint,
    elapsed: Duration,
    state: &str,
    checksums: Option<(u64, u64)>,
) -> Result<(), String> {
    let rate = if elapsed.is_zero() {
        0.0
    } else {
        checkpoint.completed_six_hands as f64 / elapsed.as_secs_f64()
    };
    let eta_seconds = if rate > 0.0 {
        checkpoint
            .six_count
            .saturating_sub(checkpoint.completed_six_hands) as f64
            / rate
    } else {
        0.0
    };
    let status = json!({
        "state": state,
        "phase": "aggregate",
        "pairs": config.pairs.display().to_string(),
        "leads": config.leads.display().to_string(),
        "pairChecksum": format!("{:016x}", checkpoint.pair_checksum),
        "leadChecksum": format!("{:016x}", checkpoint.lead_checksum),
        "sixStart": checkpoint.six_start,
        "sixCount": checkpoint.six_count,
        "completedSixHands": checkpoint.completed_six_hands,
        "completedRows": checkpoint.completed_rows,
        "histogramBins": checkpoint.histogram_bins,
        "evBytes": checkpoint.ev_bytes,
        "histogramRowBytes": checkpoint.histogram_row_bytes,
        "elapsedSeconds": elapsed.as_secs_f64(),
        "sixHandsPerSecond": rate,
        "etaSeconds": eta_seconds,
        "evChecksum": checksums.map(|value| format!("{:016x}", value.0)),
        "histogramChecksum": checksums.map(|value| format!("{:016x}", value.1)),
    });
    atomic_write_json(&config.output.join(AGGREGATE_STATUS_FILE), &status)
}

fn write_aggregate_manifest(
    config: &AggregateConfig,
    checkpoint: &AggregateCheckpoint,
    elapsed: Duration,
    ev_checksum: u64,
    hist_checksum: u64,
    hist_bytes: u64,
) -> Result<(), String> {
    let manifest = json!({
        "version": 1,
        "model": "schell_table-peg_table-9.1",
        "phase": "aggregate",
        "weighting": "compatible opponent four-card rank keeps reweighted after removing all six visible actor cards",
        "evMagic": "M91EV001",
        "histogramMagic": "M91HS001",
        "sixStart": checkpoint.six_start,
        "sixCount": checkpoint.six_count,
        "rows": checkpoint.completed_rows,
        "histogramBins": checkpoint.histogram_bins,
        "histogramBinBytes": HIST_BIN_BYTES,
        "evBytes": checkpoint.ev_bytes,
        "histogramBytes": hist_bytes,
        "elapsedSeconds": elapsed.as_secs_f64(),
        "pairChecksum": format!("{:016x}", checkpoint.pair_checksum),
        "leadChecksum": format!("{:016x}", checkpoint.lead_checksum),
        "evChecksum": format!("{:016x}", ev_checksum),
        "histogramChecksum": format!("{:016x}", hist_checksum),
        "sourcePairs": config.pairs.display().to_string(),
        "sourceLeads": config.leads.display().to_string(),
    });
    atomic_write_json(&config.output.join(AGGREGATE_MANIFEST_FILE), &manifest)
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let slice = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| format!("u16 read at {} is out of range", offset))?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| format!("u32 read at {} is out of range", offset))?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn unpack_pair_value(value: u16) -> Option<(u8, u8)> {
    (value != INVALID_PAIR).then_some(((value & 0x1f) as u8, ((value >> 5) & 0x1f) as u8))
}

fn write_pone_leads(
    config: &PairConfig,
    keeps: &[[u8; 13]],
    policy: &mut Model91Policy,
) -> Result<(), String> {
    let pone_count = config
        .pone_count
        .unwrap_or(keeps.len().saturating_sub(config.pone_start));
    let path = config.output.join(LEAD_FILE);
    let mut bytes = Vec::with_capacity(24 + pone_count);
    bytes.extend_from_slice(LEAD_MAGIC);
    bytes.extend_from_slice(&1_u32.to_le_bytes());
    bytes.extend_from_slice(&(keeps.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&(config.pone_start as u32).to_le_bytes());
    bytes.extend_from_slice(&(pone_count as u32).to_le_bytes());
    for keep in &keeps[config.pone_start..config.pone_start + pone_count] {
        bytes.push(model91_initial_pone_lead(*keep, policy)?);
    }
    atomic_write(&path, &bytes)
}

fn parse_pair_config(args: &[String]) -> Result<PairConfig, String> {
    let mut output = None;
    let mut hold_table = None;
    let mut resume = false;
    let mut dealer_start = 0_usize;
    let mut dealer_count = None;
    let mut pone_start = 0_usize;
    let mut pone_count = None;
    let mut status_every = 1_usize;
    let mut policy_cache_limit = 1_000_000_usize;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--resume" => {
                resume = true;
                index += 1;
            }
            "--output" => output = Some(PathBuf::from(argument(args, &mut index, "--output")?)),
            "--hold-table" => {
                hold_table = Some(PathBuf::from(argument(args, &mut index, "--hold-table")?))
            }
            "--dealer-start" => {
                dealer_start = parse_usize(
                    &argument(args, &mut index, "--dealer-start")?,
                    "dealer start",
                )?
            }
            "--dealer-count" => {
                dealer_count = Some(parse_usize(
                    &argument(args, &mut index, "--dealer-count")?,
                    "dealer count",
                )?)
            }
            "--pone-start" => {
                pone_start =
                    parse_usize(&argument(args, &mut index, "--pone-start")?, "pone start")?
            }
            "--pone-count" => {
                pone_count = Some(parse_usize(
                    &argument(args, &mut index, "--pone-count")?,
                    "pone count",
                )?)
            }
            "--status-every" => {
                status_every = parse_usize(
                    &argument(args, &mut index, "--status-every")?,
                    "status interval",
                )?;
                if status_every == 0 {
                    return Err("--status-every must be positive".to_string());
                }
            }
            "--policy-cache-limit" => {
                policy_cache_limit = parse_usize(
                    &argument(args, &mut index, "--policy-cache-limit")?,
                    "policy cache limit",
                )?
            }
            other => return Err(format!("unknown pairs argument {}", other)),
        }
    }
    Ok(PairConfig {
        output: output.ok_or_else(|| "pairs requires --output".to_string())?,
        hold_table,
        resume,
        dealer_start,
        dealer_count,
        pone_start,
        pone_count,
        status_every,
        policy_cache_limit,
    })
}

fn load_hold_table(path: &Path) -> Result<Model91EmpiricalBeliefs, String> {
    let entries = load_hold_entries(path)?;
    let mut beliefs = Model91EmpiricalBeliefs::default();
    for (role, played, rows) in entries {
        beliefs.insert(role, played, rows)?;
    }
    Ok(beliefs)
}

type HoldEntry = (Role, [u8; 13], Vec<([u8; 13], u64)>);

fn load_hold_entries(path: &Path) -> Result<Vec<HoldEntry>, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("read hold table {} failed: {}", path.display(), error))?;
    let source: HoldTableFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("parse hold table {} failed: {}", path.display(), error))?;
    let mut entries = Vec::new();
    for (role_name, levels) in source.roles {
        let role = parse_role(&role_name)?;
        for (length, level) in levels {
            let expected_length = parse_usize(&length, "hold prefix length")?;
            for (prefix, remaining_hands) in level.prefixes {
                let played = parse_prefix(&prefix)?;
                if played.iter().map(|count| *count as usize).sum::<usize>() != expected_length {
                    return Err(format!(
                        "hold prefix {} does not match declared length {}",
                        prefix, expected_length
                    ));
                }
                let mut rows = remaining_hands
                    .remaining_hands
                    .into_iter()
                    .map(|(key, weight)| Ok((rank_counts_from_key(&key)?, weight)))
                    .collect::<Result<Vec<_>, String>>()?;
                rows.sort_by_key(|(remaining, _)| *remaining);
                entries.push((role, played, rows));
            }
        }
    }
    entries.sort_by_key(|(role, played, _)| {
        (
            match role {
                Role::Dealer => 0_u8,
                Role::Pone => 1_u8,
            },
            *played,
        )
    });
    let mut validator = Model91EmpiricalBeliefs::default();
    for (role, played, rows) in &entries {
        validator.insert(*role, *played, rows.clone())?;
    }
    Ok(entries)
}

fn parse_prefix(prefix: &str) -> Result<[u8; 13], String> {
    let mut counts = [0_u8; 13];
    if prefix.is_empty() {
        return Ok(counts);
    }
    for label in prefix.split(',') {
        let rank = RANKS
            .iter()
            .position(|candidate| *candidate == label)
            .ok_or_else(|| format!("unknown rank {} in empirical prefix", label))?;
        counts[rank] = counts[rank].saturating_add(1);
        if counts[rank] > 4 {
            return Err(format!("empirical prefix {} exceeds four copies", prefix));
        }
    }
    Ok(counts)
}

fn parse_role(value: &str) -> Result<Role, String> {
    match value {
        "dealer" => Ok(Role::Dealer),
        "pone" => Ok(Role::Pone),
        other => Err(format!("unknown empirical hold role {}", other)),
    }
}

fn compatible(left: &[u8; 13], right: &[u8; 13]) -> bool {
    left.iter()
        .zip(right)
        .all(|(left_count, right_count)| left_count + right_count <= 4)
}

fn pack_pair(dealer_points: u8, pone_points: u8) -> Result<u16, String> {
    if dealer_points > 31 || pone_points > 31 {
        return Err(format!(
            "Model 9.1 pair score does not fit five bits: {},{}",
            dealer_points, pone_points
        ));
    }
    Ok(u16::from(dealer_points) | (u16::from(pone_points) << 5))
}

#[cfg(test)]
fn unpack_pair(value: u16) -> Option<(u8, u8)> {
    (value != INVALID_PAIR).then_some(((value & 0x1f) as u8, ((value >> 5) & 0x1f) as u8))
}

fn write_pair_header(
    writer: &mut impl Write,
    checkpoint: &PairCheckpoint,
    keep_count: usize,
) -> Result<(), String> {
    writer
        .write_all(PAIR_MAGIC)
        .and_then(|_| writer.write_all(&PAIR_VERSION.to_le_bytes()))
        .and_then(|_| writer.write_all(&(keep_count as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(checkpoint.dealer_start as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(checkpoint.dealer_count as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(checkpoint.pone_start as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(checkpoint.pone_count as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&checkpoint.hold_checksum.to_le_bytes()))
        .map_err(|error| format!("write Model 9.1 pair header failed: {}", error))
}

fn validate_pair_header(
    path: &Path,
    checkpoint: &PairCheckpoint,
    keep_count: usize,
) -> Result<(), String> {
    let mut bytes = [0_u8; PAIR_HEADER_BYTES];
    File::open(path)
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|error| format!("read pair header {} failed: {}", path.display(), error))?;
    let mut expected = Vec::new();
    write_pair_header(&mut expected, checkpoint, keep_count)?;
    if bytes.as_slice() != expected.as_slice() {
        return Err("Model 9.1 pair header does not match checkpoint/configuration".to_string());
    }
    Ok(())
}

fn write_pair_checkpoint(path: &Path, checkpoint: &PairCheckpoint) -> Result<(), String> {
    let contents = format!(
        concat!(
            "holdChecksum={:016x}\n",
            "dealerStart={}\n",
            "dealerCount={}\n",
            "poneStart={}\n",
            "poneCount={}\n",
            "completedDealerKeeps={}\n",
            "validPairs={}\n",
            "bytesWritten={}\n"
        ),
        checkpoint.hold_checksum,
        checkpoint.dealer_start,
        checkpoint.dealer_count,
        checkpoint.pone_start,
        checkpoint.pone_count,
        checkpoint.completed_dealer_keeps,
        checkpoint.valid_pairs,
        checkpoint.bytes_written,
    );
    atomic_write(path, contents.as_bytes())
}

fn read_pair_checkpoint(path: &Path) -> Result<PairCheckpoint, String> {
    let fields = read_key_values(path)?;
    Ok(PairCheckpoint {
        hold_checksum: parse_hex_field(&fields, "holdChecksum")?,
        dealer_start: parse_field(&fields, "dealerStart")?,
        dealer_count: parse_field(&fields, "dealerCount")?,
        pone_start: parse_field(&fields, "poneStart")?,
        pone_count: parse_field(&fields, "poneCount")?,
        completed_dealer_keeps: parse_field(&fields, "completedDealerKeeps")?,
        valid_pairs: parse_field(&fields, "validPairs")?,
        bytes_written: parse_field(&fields, "bytesWritten")?,
    })
}

fn validate_checkpoint(
    checkpoint: &PairCheckpoint,
    hold_checksum: u64,
    dealer_start: usize,
    dealer_count: usize,
    pone_start: usize,
    pone_count: usize,
) -> Result<(), String> {
    if checkpoint.hold_checksum != hold_checksum
        || checkpoint.dealer_start != dealer_start
        || checkpoint.dealer_count != dealer_count
        || checkpoint.pone_start != pone_start
        || checkpoint.pone_count != pone_count
    {
        return Err("resume configuration does not match Model 9.1 checkpoint".to_string());
    }
    if checkpoint.completed_dealer_keeps > dealer_count {
        return Err("Model 9.1 checkpoint exceeds its dealer range".to_string());
    }
    let expected = PAIR_HEADER_BYTES as u64
        + (checkpoint.completed_dealer_keeps * pone_count * PAIR_RECORD_BYTES) as u64;
    if checkpoint.bytes_written != expected {
        return Err("Model 9.1 checkpoint byte count is inconsistent".to_string());
    }
    Ok(())
}

fn write_pair_status(
    config: &PairConfig,
    checkpoint: &PairCheckpoint,
    stats: Model91PolicyStats,
    elapsed: Duration,
    state: &str,
    output_checksum: Option<u64>,
) -> Result<(), String> {
    let rate = if elapsed.is_zero() {
        0.0
    } else {
        checkpoint.valid_pairs as f64 / elapsed.as_secs_f64()
    };
    let average_pairs_per_unit = if checkpoint.completed_dealer_keeps == 0 {
        0.0
    } else {
        checkpoint.valid_pairs as f64 / checkpoint.completed_dealer_keeps as f64
    };
    let remaining_units = checkpoint
        .dealer_count
        .saturating_sub(checkpoint.completed_dealer_keeps);
    let eta_seconds = if rate > 0.0 {
        remaining_units as f64 * average_pairs_per_unit / rate
    } else {
        0.0
    };
    let status = json!({
        "state": state,
        "phase": "pairs",
        "holdTable": config.hold_table.as_ref().map(|path| path.display().to_string()),
        "holdChecksum": format!("{:016x}", checkpoint.hold_checksum),
        "dealerStart": checkpoint.dealer_start,
        "dealerCount": checkpoint.dealer_count,
        "poneStart": checkpoint.pone_start,
        "poneCount": checkpoint.pone_count,
        "completedDealerKeeps": checkpoint.completed_dealer_keeps,
        "validPairs": checkpoint.valid_pairs,
        "bytesWritten": checkpoint.bytes_written,
        "elapsedSeconds": elapsed.as_secs_f64(),
        "pairsPerSecond": rate,
        "etaSeconds": eta_seconds,
        "policyCacheLimit": config.policy_cache_limit,
        "policyCache": {
            "decisionRequests": stats.decision_requests,
            "decisionCacheHits": stats.decision_cache_hits,
            "evaluatedDecisions": stats.evaluated_decisions,
            "randomFutureStates": stats.random_future_states,
        },
        "outputChecksum": output_checksum.map(|value| format!("{:016x}", value)),
    });
    atomic_write_json(&config.output.join(STATUS_FILE), &status)
}

fn write_pair_manifest(
    config: &PairConfig,
    checkpoint: &PairCheckpoint,
    stats: Model91PolicyStats,
    elapsed: Duration,
    output_checksum: u64,
    keep_count: usize,
) -> Result<(), String> {
    let manifest = json!({
        "version": 1,
        "model": "schell_table-peg_table-9.1",
        "phase": "pairs",
        "policy": "Model 9 exhaustive net-EV choice from retained four cards and public pegging history; no cut or crib cards",
        "magic": "M91PR001",
        "keepCount": keep_count,
        "dealerStart": checkpoint.dealer_start,
        "dealerCount": checkpoint.dealer_count,
        "poneStart": checkpoint.pone_start,
        "poneCount": checkpoint.pone_count,
        "validPairs": checkpoint.valid_pairs,
        "recordBytes": PAIR_RECORD_BYTES,
        "bytes": checkpoint.bytes_written,
        "elapsedSeconds": elapsed.as_secs_f64(),
        "holdTable": config.hold_table.as_ref().map(|path| path.display().to_string()),
        "holdChecksum": format!("{:016x}", checkpoint.hold_checksum),
        "outputChecksum": format!("{:016x}", output_checksum),
        "policyStats": {
            "decisionRequests": stats.decision_requests,
            "decisionCacheHits": stats.decision_cache_hits,
            "evaluatedDecisions": stats.evaluated_decisions,
            "randomFutureStates": stats.random_future_states,
        },
    });
    atomic_write_json(&config.output.join(MANIFEST_FILE), &manifest)
}

fn validate_range(label: &str, start: usize, count: usize, total: usize) -> Result<(), String> {
    if count == 0 || start >= total || start.saturating_add(count) > total {
        return Err(format!(
            "{} range {}+{} is outside 0..{}",
            label, start, count, total
        ));
    }
    Ok(())
}

fn read_key_values(path: &Path) -> Result<HashMap<String, String>, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("read {} failed: {}", path.display(), error))?;
    let mut fields = HashMap::new();
    for line in contents.lines() {
        let (key, value) = line
            .split_once('=')
            .ok_or_else(|| format!("invalid checkpoint line {}", line))?;
        if fields.insert(key.to_string(), value.to_string()).is_some() {
            return Err(format!("duplicate checkpoint field {}", key));
        }
    }
    Ok(fields)
}

fn parse_field<T: std::str::FromStr>(
    fields: &HashMap<String, String>,
    name: &str,
) -> Result<T, String>
where
    T::Err: std::fmt::Display,
{
    let value = fields
        .get(name)
        .ok_or_else(|| format!("checkpoint lacks {}", name))?;
    value
        .parse::<T>()
        .map_err(|error| format!("invalid checkpoint {} {}: {}", name, value, error))
}

fn parse_hex_field(fields: &HashMap<String, String>, name: &str) -> Result<u64, String> {
    let value = fields
        .get(name)
        .ok_or_else(|| format!("checkpoint lacks {}", name))?;
    u64::from_str_radix(value, 16)
        .map_err(|error| format!("invalid checkpoint {} {}: {}", name, value, error))
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

fn parse_usize(value: &str, label: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|error| format!("invalid {} {}: {}", label, value, error))
}

fn atomic_write_json(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("serialize {} failed: {}", path.display(), error))?;
    bytes.push(b'\n');
    atomic_write(path, &bytes)
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

fn print_usage() {
    eprintln!(concat!(
        "usage:\n",
        "  build_model91_assets pairs --output DIRECTORY [--hold-table FILE] [--resume]\n",
        "    [--dealer-start N] [--dealer-count N] [--pone-start N] [--pone-count N]\n",
        "    [--status-every N] [--policy-cache-limit N]\n",
        "  build_model91_assets merge-pairs --shards DIRECTORY --output DIRECTORY\n",
        "  build_model91_assets aggregate --pairs FILE --leads FILE --output DIRECTORY [--resume]\n",
        "    [--six-start N] [--six-count N] [--status-every N]\n",
        "  build_model91_assets pack-beliefs --input FILE --output FILE\n",
        "  build_model91_assets analyze-quantization --histogram FILE --output FILE\n",
        "  build_model91_assets pack-model90 --input FILE --output FILE\n",
        "  build_model91_assets pack-model131 --histogram FILE --output FILE\n"
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_synthetic_complete_pair_assets(root: &Path) -> (PathBuf, PathBuf) {
        let keep_keys = enumerate_rank_count_keys(4);
        let keeps = keep_keys
            .iter()
            .map(|key| rank_counts_from_key(key).unwrap())
            .collect::<Vec<_>>();
        let pair_path = root.join(PAIR_FILE);
        let lead_path = root.join(LEAD_FILE);
        let checkpoint = PairCheckpoint {
            hold_checksum: 0,
            dealer_start: 0,
            dealer_count: keeps.len(),
            pone_start: 0,
            pone_count: keeps.len(),
            completed_dealer_keeps: keeps.len(),
            valid_pairs: 3_274_375,
            bytes_written: (PAIR_HEADER_BYTES + keeps.len() * keeps.len() * 2) as u64,
        };
        let mut pairs = Vec::new();
        write_pair_header(&mut pairs, &checkpoint, keeps.len()).unwrap();
        for dealer in &keeps {
            for pone in &keeps {
                let value = if compatible(dealer, pone) {
                    pack_pair(1, 2).unwrap()
                } else {
                    INVALID_PAIR
                };
                pairs.extend_from_slice(&value.to_le_bytes());
            }
        }
        fs::write(&pair_path, pairs).unwrap();

        let mut leads = Vec::new();
        leads.extend_from_slice(LEAD_MAGIC);
        leads.extend_from_slice(&1_u32.to_le_bytes());
        leads.extend_from_slice(&(keeps.len() as u32).to_le_bytes());
        leads.extend_from_slice(&0_u32.to_le_bytes());
        leads.extend_from_slice(&(keeps.len() as u32).to_le_bytes());
        for keep in &keeps {
            leads.push(keep.iter().position(|count| *count > 0).unwrap() as u8);
        }
        fs::write(&lead_path, leads).unwrap();
        (pair_path, lead_path)
    }

    #[test]
    fn pair_score_record_round_trips_and_reserves_invalid() {
        for dealer in 0..=31 {
            for pone in 0..=31 {
                let packed = pack_pair(dealer, pone).unwrap();
                assert_ne!(packed, INVALID_PAIR);
                assert_eq!(unpack_pair(packed), Some((dealer, pone)));
            }
        }
        assert_eq!(unpack_pair(INVALID_PAIR), None);
        assert!(pack_pair(32, 0).is_err());
    }

    #[test]
    fn empirical_prefix_parser_preserves_duplicate_ranks() {
        let counts = parse_prefix("A,5,5").unwrap();
        assert_eq!(counts[0], 1);
        assert_eq!(counts[4], 2);
        assert_eq!(counts.iter().sum::<u8>(), 3);
    }

    #[test]
    fn canonical_six_card_discard_space_has_model9_row_count() {
        let six_hands = enumerate_rank_count_keys(6)
            .iter()
            .map(|key| rank_counts_from_key(key).unwrap())
            .collect::<Vec<_>>();
        let discard_contexts = six_hands
            .iter()
            .map(|hand| discards_from_six(hand).len())
            .sum::<usize>();
        assert_eq!(six_hands.len(), 18_395);
        assert_eq!(discard_contexts, 165_295);
        assert_eq!(discard_contexts * 2, 330_590);
    }

    #[test]
    fn exact_histogram_round_trip_matches_ev_sums() {
        let root = env::temp_dir().join(format!("cribbage-model91-hist-test-{}", process::id()));
        if root.exists() {
            fs::remove_dir_all(&root).unwrap();
        }
        fs::create_dir_all(&root).unwrap();
        let rows_path = root.join(HIST_ROWS_FILE);
        let ev_path = root.join(EV_FILE);
        let hist_path = root.join(HIST_FILE);
        let mut first = BTreeMap::new();
        first.insert(pack_pair(2, 1).unwrap(), 3);
        first.insert(pack_pair(0, 4).unwrap(), 2);
        let mut second = BTreeMap::new();
        second.insert(pack_pair(5, 0).unwrap(), 7);
        let mut rows = File::create(&rows_path).unwrap();
        write_histogram_row(&mut rows, &first, 5).unwrap();
        write_histogram_row(&mut rows, &second, 7).unwrap();
        rows.sync_all().unwrap();
        let mut ev = File::create(&ev_path).unwrap();
        write_ev_header(&mut ev, 2).unwrap();
        write_ev_record(&mut ev, 6, 11, 5, 0).unwrap();
        write_ev_record(&mut ev, 35, 0, 7, u8::MAX).unwrap();
        ev.sync_all().unwrap();
        pack_histogram_asset(&rows_path, &hist_path, 2).unwrap();
        validate_ev_histogram_means(&ev_path, &hist_path).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn aggregate_resume_is_byte_identical_and_role_perspectives_are_not_swapped_games() {
        let root = env::temp_dir().join(format!("cribbage-model91-resume-test-{}", process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let (pairs, leads) = write_synthetic_complete_pair_assets(&root);
        let output = root.join("aggregate");
        let config = AggregateConfig {
            pairs,
            leads,
            output: output.clone(),
            resume: false,
            six_start: 0,
            six_count: Some(1),
            status_every: 1,
        };
        build_aggregate(&config).unwrap();
        let first_ev = fs::read(output.join(EV_FILE)).unwrap();
        let first_hist = fs::read(output.join(HIST_FILE)).unwrap();

        let mut resumed = config;
        resumed.resume = true;
        build_aggregate(&resumed).unwrap();
        assert_eq!(fs::read(output.join(EV_FILE)).unwrap(), first_ev);
        assert_eq!(fs::read(output.join(HIST_FILE)).unwrap(), first_hist);

        let ev = fs::read(output.join(EV_FILE)).unwrap();
        let rows = read_u32(&ev, 12).unwrap() as usize;
        assert!(rows > 0 && rows % 2 == 0);
        for candidate in 0..rows / 2 {
            let pone_offset = EV_HEADER_BYTES + (candidate * 2) * EV_RECORD_BYTES;
            let dealer_offset = pone_offset + EV_RECORD_BYTES;
            let pone_my = read_u32(&ev, pone_offset).unwrap();
            let pone_opponent = read_u32(&ev, pone_offset + 4).unwrap();
            let dealer_my = read_u32(&ev, dealer_offset).unwrap();
            let dealer_opponent = read_u32(&ev, dealer_offset + 4).unwrap();
            assert_eq!(pone_my, dealer_opponent);
            assert_eq!(pone_opponent, dealer_my);
            assert_ne!(ev[pone_offset + 12], u8::MAX);
            assert_eq!(ev[dealer_offset + 12], u8::MAX);
        }
        fs::remove_dir_all(root).unwrap();
    }
}
