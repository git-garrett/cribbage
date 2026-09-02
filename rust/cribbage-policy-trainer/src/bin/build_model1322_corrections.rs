//! Resumable pair-oriented Model 13.22 dead-card correction builder.
//!
//! The durable asset contains only weighted terminal pegging summaries for
//! finite six-card/discard rows plus pone lead cut masks. Ephemeral Model 9.11
//! traces, actor screens, and suffix caches never leave a worker.

use cribbage_shadow_engine::cards::{
    enumerate_rank_count_keys, rank_combination_count, rank_count_key, rank_count_total,
    rank_counts_from_key,
};
use cribbage_shadow_engine::information_set::{PegSeat, RankPegAction};
use cribbage_shadow_engine::model132::{
    adjusted_keep_weight, model911_initial_pone_lead, rollout_model1322_from_actor_screens,
    rollout_model132_world, screen_model1322_actor_context, trace_model911_pair,
    Model1322ActorScreen, Model1322DeclineFactors, Model911PairTrace, Model911Policy,
};
use cribbage_shadow_engine::model91::{Model91EmpiricalBeliefs, Model91PolicyStats};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::env;
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process;
use std::time::Instant;

const RANKS: usize = 13;
const KEEP_COUNT: usize = 1_820;
const ROLE_ROW_COUNT: usize = 165_295;
const MAGIC: &[u8; 8] = b"M1322C01";
const VERSION: u32 = 1;
const HEADER_BYTES: usize = 128;
const ACCUMULATOR_BYTES: usize = 48;
const PARTIAL_FILE: &str = "partial.bin";
const MERGED_FILE: &str = "model1322-corrections.bin";
const CHECKPOINT_FILE: &str = "checkpoint.json";
const STATUS_FILE: &str = "status.json";
const MANIFEST_FILE: &str = "manifest.json";
const BASELINE_MAGIC: &[u8; 8] = b"M911PR01";
const BASELINE_HEADER_BYTES: usize = 56;
const INVALID_PAIR: u16 = u16::MAX;

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
    keep_prior: PathBuf,
    discard_histograms: PathBuf,
    baseline_pairs: PathBuf,
    dealer_start: usize,
    dealer_count: usize,
    pone_start: usize,
    pone_count: usize,
    resume: bool,
    action_cache_limit: usize,
    evidence_cache_outcome_limit: usize,
    future_cache_limit: usize,
    verify_first_worlds: usize,
}

#[derive(Debug)]
struct MergeConfig {
    shards: PathBuf,
    output: PathBuf,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct WeightedAccumulator {
    own_points_x_weight: u128,
    opponent_points_x_weight: u128,
    weight: u128,
}

impl WeightedAccumulator {
    fn add(&mut self, own: u8, opponent: u8, weight: u128) -> Result<(), String> {
        self.own_points_x_weight = self
            .own_points_x_weight
            .checked_add(u128::from(own) * weight)
            .ok_or_else(|| "Model 13.22 own weighted score overflow".to_string())?;
        self.opponent_points_x_weight = self
            .opponent_points_x_weight
            .checked_add(u128::from(opponent) * weight)
            .ok_or_else(|| "Model 13.22 opponent weighted score overflow".to_string())?;
        self.weight = self
            .weight
            .checked_add(weight)
            .ok_or_else(|| "Model 13.22 total weight overflow".to_string())?;
        Ok(())
    }

    fn merge(&mut self, other: Self) -> Result<(), String> {
        self.own_points_x_weight = self
            .own_points_x_weight
            .checked_add(other.own_points_x_weight)
            .ok_or_else(|| "Model 13.22 merged own score overflow".to_string())?;
        self.opponent_points_x_weight = self
            .opponent_points_x_weight
            .checked_add(other.opponent_points_x_weight)
            .ok_or_else(|| "Model 13.22 merged opponent score overflow".to_string())?;
        self.weight = self
            .weight
            .checked_add(other.weight)
            .ok_or_else(|| "Model 13.22 merged weight overflow".to_string())?;
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct OwnContext {
    discard: [u8; RANKS],
    six: [u8; RANKS],
    row_id: usize,
}

struct ContextIndex {
    by_keep: Vec<Vec<OwnContext>>,
    discard_id_by_keep: Vec<HashMap<u32, usize>>,
    rows: Vec<OwnContext>,
}

#[derive(Clone, Copy, Debug)]
struct DiscardVariant {
    context_index: usize,
    ranks: [u8; RANKS],
    weight: u64,
}

struct Priors {
    dealer_keep: Vec<u64>,
    pone_keep: Vec<u64>,
    dealer_discards: Vec<Vec<DiscardVariant>>,
    pone_discards: Vec<Vec<DiscardVariant>>,
}

#[derive(Debug, Deserialize)]
struct KeepPriorFile {
    version: u32,
    roles: KeepPriorRoles,
}

#[derive(Debug, Deserialize)]
struct KeepPriorRoles {
    dealer: BTreeMap<String, u64>,
    pone: BTreeMap<String, u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistogramFile {
    schema_version: u32,
    model_version: String,
    fallback_by_role: HistogramFallback,
    roles: HistogramRoles,
}

#[derive(Debug, Deserialize)]
struct HistogramFallback {
    dealer: BTreeMap<String, u64>,
    pone: BTreeMap<String, u64>,
}

#[derive(Debug, Deserialize)]
struct HistogramRoles {
    dealer: BTreeMap<String, BTreeMap<String, u64>>,
    pone: BTreeMap<String, BTreeMap<String, u64>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildState {
    schema_version: u32,
    model_version: String,
    state: String,
    dealer_start: usize,
    dealer_count: usize,
    pone_start: usize,
    pone_count: usize,
    completed_dealer_keeps: usize,
    compatible_pairs: u64,
    actor_screens: u64,
    suffix_rollouts: u64,
    stable_joint_worlds: u64,
    exact_joint_worlds: u64,
    verified_worlds: u64,
    elapsed_seconds: f64,
    belief_checksum: String,
    factor_checksum: String,
    prior_checksum: String,
    histogram_checksum: String,
    baseline_checksum: String,
}

struct PartialAsset {
    state: BuildState,
    dealer: Vec<WeightedAccumulator>,
    pone: Vec<WeightedAccumulator>,
    pone_lead_masks: Vec<u16>,
}

struct PairWork<'a> {
    trace: &'a Model911PairTrace,
    hands: [[u8; RANKS]; 2],
    dealer_contexts: &'a [OwnContext],
    pone_contexts: &'a [OwnContext],
    dealer_screens: Vec<Option<Model1322ActorScreen>>,
    pone_screens: Vec<Option<Model1322ActorScreen>>,
    corrected_outcomes: HashMap<u32, (u8, u8)>,
    baseline_pone_lead: u8,
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
                "build_model1322_corrections build --output DIR --beliefs FILE --factors FILE \
                 --keep-prior FILE --discard-histograms FILE --baseline-pairs FILE \
                 --dealer-start N --dealer-count N [--pone-start N --pone-count N] [--resume] \
                 [--action-cache-limit N] [--evidence-cache-outcome-limit N] \
                 [--future-cache-limit N] [--verify-first-worlds N]\n\
                 build_model1322_corrections merge --shards DIR --output DIR"
            );
            process::exit(0);
        }
        Some(other) => Err(format!("unknown Model 13.22 correction command {other}")),
    }
}

fn parse_build(args: &[String]) -> Result<BuildConfig, String> {
    let mut output = None;
    let mut beliefs = None;
    let mut factors = None;
    let mut keep_prior = None;
    let mut discard_histograms = None;
    let mut baseline_pairs = None;
    let mut dealer_start = None;
    let mut dealer_count = None;
    let mut pone_start = 0_usize;
    let mut pone_count = KEEP_COUNT;
    let mut resume = false;
    let mut action_cache_limit = 100_000_usize;
    let mut evidence_cache_outcome_limit = 500_000_usize;
    let mut future_cache_limit = 3_000_000_usize;
    let mut verify_first_worlds = 0_usize;
    let mut index = 0_usize;
    while index < args.len() {
        let flag = &args[index];
        index += 1;
        let value = |index: &mut usize| -> Result<String, String> {
            let result = args
                .get(*index)
                .cloned()
                .ok_or_else(|| format!("{flag} requires a value"))?;
            *index += 1;
            Ok(result)
        };
        match flag.as_str() {
            "--output" => output = Some(PathBuf::from(value(&mut index)?)),
            "--beliefs" => beliefs = Some(PathBuf::from(value(&mut index)?)),
            "--factors" => factors = Some(PathBuf::from(value(&mut index)?)),
            "--keep-prior" => keep_prior = Some(PathBuf::from(value(&mut index)?)),
            "--discard-histograms" => discard_histograms = Some(PathBuf::from(value(&mut index)?)),
            "--baseline-pairs" => baseline_pairs = Some(PathBuf::from(value(&mut index)?)),
            "--dealer-start" => dealer_start = Some(parse_usize(&value(&mut index)?, flag)?),
            "--dealer-count" => dealer_count = Some(parse_usize(&value(&mut index)?, flag)?),
            "--pone-start" => pone_start = parse_usize(&value(&mut index)?, flag)?,
            "--pone-count" => pone_count = parse_usize(&value(&mut index)?, flag)?,
            "--action-cache-limit" => action_cache_limit = parse_usize(&value(&mut index)?, flag)?,
            "--evidence-cache-outcome-limit" => {
                evidence_cache_outcome_limit = parse_usize(&value(&mut index)?, flag)?
            }
            "--future-cache-limit" => future_cache_limit = parse_usize(&value(&mut index)?, flag)?,
            "--verify-first-worlds" => {
                verify_first_worlds = parse_usize(&value(&mut index)?, flag)?
            }
            "--resume" => resume = true,
            other => return Err(format!("unknown Model 13.22 build argument {other}")),
        }
    }
    let config = BuildConfig {
        output: output.ok_or_else(|| "build requires --output".to_string())?,
        beliefs: beliefs.ok_or_else(|| "build requires --beliefs".to_string())?,
        factors: factors.ok_or_else(|| "build requires --factors".to_string())?,
        keep_prior: keep_prior.ok_or_else(|| "build requires --keep-prior".to_string())?,
        discard_histograms: discard_histograms
            .ok_or_else(|| "build requires --discard-histograms".to_string())?,
        baseline_pairs: baseline_pairs
            .ok_or_else(|| "build requires --baseline-pairs".to_string())?,
        dealer_start: dealer_start.ok_or_else(|| "build requires --dealer-start".to_string())?,
        dealer_count: dealer_count.ok_or_else(|| "build requires --dealer-count".to_string())?,
        pone_start,
        pone_count,
        resume,
        action_cache_limit,
        evidence_cache_outcome_limit,
        future_cache_limit,
        verify_first_worlds,
    };
    validate_range("dealer", config.dealer_start, config.dealer_count)?;
    validate_range("pone", config.pone_start, config.pone_count)?;
    if config.evidence_cache_outcome_limit == 0 {
        return Err("--evidence-cache-outcome-limit must be positive".to_string());
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
            other => return Err(format!("unknown Model 13.22 merge argument {other}")),
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
    let checksums = [
        checksum_string(fnv1a64_file(&config.beliefs)?),
        checksum_string(fnv1a64_file(&config.factors)?),
        checksum_string(fnv1a64_file(&config.keep_prior)?),
        checksum_string(fnv1a64_file(&config.discard_histograms)?),
        checksum_string(fnv1a64_file(&config.baseline_pairs)?),
    ];
    let keep_keys = enumerate_rank_count_keys(4);
    let keeps = keep_keys
        .iter()
        .map(|key| rank_counts_from_key(key))
        .collect::<Result<Vec<_>, _>>()?;
    if keeps.len() != KEEP_COUNT {
        return Err(format!(
            "Model 13.22 keep count is {}; expected {KEEP_COUNT}",
            keeps.len()
        ));
    }
    let contexts = build_context_index(&keep_keys, &keeps)?;
    let priors = load_priors(
        &config.keep_prior,
        &config.discard_histograms,
        &keep_keys,
        &contexts,
    )?;
    let baseline = load_baseline_pairs(&config.baseline_pairs)?;
    let beliefs = Model91EmpiricalBeliefs::load(&config.beliefs)?;
    let factors = Model1322DeclineFactors::load(&config.factors)?;
    let policy = Model911Policy::new_with_evidence_cache(
        Some(beliefs.clone()),
        factors,
        config.action_cache_limit,
        config.evidence_cache_outcome_limit,
        config.future_cache_limit,
    )?;
    let verification_policy = (config.verify_first_worlds > 0)
        .then(|| {
            Model911Policy::new_with_evidence_cache(
                Some(beliefs),
                factors,
                config.action_cache_limit,
                config.evidence_cache_outcome_limit,
                config.future_cache_limit,
            )
        })
        .transpose()?;
    let expected_state = new_state(config, &checksums);
    let partial_path = config.output.join(PARTIAL_FILE);
    let checkpoint_path = config.output.join(CHECKPOINT_FILE);
    let mut partial = if config.resume && partial_path.exists() {
        let partial = read_partial(&partial_path)?;
        validate_state(&partial.state, &expected_state)?;
        partial
    } else {
        if partial_path.exists() || checkpoint_path.exists() {
            return Err(format!(
                "{} contains a correction build; use --resume or a new directory",
                config.output.display()
            ));
        }
        PartialAsset {
            state: expected_state,
            dealer: vec![WeightedAccumulator::default(); ROLE_ROW_COUNT],
            pone: vec![WeightedAccumulator::default(); ROLE_ROW_COUNT],
            pone_lead_masks: vec![0_u16; ROLE_ROW_COUNT * RANKS],
        }
    };
    write_checkpoint(config, &partial.state, policy.stats())?;
    let resumed_elapsed = partial.state.elapsed_seconds;
    let started = Instant::now();
    for relative_dealer in partial.state.completed_dealer_keeps..config.dealer_count {
        let dealer_id = config.dealer_start + relative_dealer;
        for pone_id in config.pone_start..config.pone_start + config.pone_count {
            if !compatible(&keeps[dealer_id], &keeps[pone_id]) {
                continue;
            }
            let trace = trace_model911_pair(keeps[dealer_id], keeps[pone_id], &policy)?;
            let expected = baseline_outcome(&baseline, dealer_id, pone_id)?;
            if trace.outcome() != expected {
                return Err(format!(
                    "Model 9.11 trace differs from baseline cell {dealer_id},{pone_id}"
                ));
            }
            let mut pair = PairWork {
                trace: &trace,
                hands: [keeps[dealer_id], keeps[pone_id]],
                dealer_contexts: &contexts.by_keep[dealer_id],
                pone_contexts: &contexts.by_keep[pone_id],
                dealer_screens: vec![None; contexts.by_keep[dealer_id].len() * RANKS],
                pone_screens: vec![None; contexts.by_keep[pone_id].len() * RANKS],
                corrected_outcomes: HashMap::new(),
                baseline_pone_lead: model911_initial_pone_lead(keeps[pone_id], &policy)?,
            };
            process_dealer_rows(
                &mut pair,
                &priors,
                pone_id,
                &policy,
                verification_policy.as_ref(),
                config.verify_first_worlds,
                &mut partial,
            )?;
            process_pone_rows(
                &mut pair,
                &priors,
                dealer_id,
                &policy,
                verification_policy.as_ref(),
                config.verify_first_worlds,
                &mut partial,
            )?;
            partial.state.compatible_pairs += 1;
        }
        partial.state.completed_dealer_keeps = relative_dealer + 1;
        partial.state.elapsed_seconds = resumed_elapsed + started.elapsed().as_secs_f64();
        write_partial(&partial_path, &partial)?;
        write_checkpoint(config, &partial.state, policy.stats())?;
    }
    partial.state.state = "complete".to_string();
    partial.state.elapsed_seconds = resumed_elapsed + started.elapsed().as_secs_f64();
    write_partial(&partial_path, &partial)?;
    write_checkpoint(config, &partial.state, policy.stats())?;
    atomic_json(
        &config.output.join(MANIFEST_FILE),
        &json!({
            "schemaVersion": 1,
            "modelVersion": "13.22",
            "status": "complete",
            "architecture": "pair-oriented Model 9.11 trace plus factorized actor dead-card screens and changed-suffix replay",
            "durableOutput": "weighted terminal six-card/discard summaries and pone lead cut masks only",
            "dealerRange": {"start": config.dealer_start, "count": config.dealer_count},
            "poneRange": {"start": config.pone_start, "count": config.pone_count},
            "roleRows": ROLE_ROW_COUNT,
            "compatiblePairs": partial.state.compatible_pairs,
            "actorScreens": partial.state.actor_screens,
            "suffixRollouts": partial.state.suffix_rollouts,
            "stableJointWorlds": partial.state.stable_joint_worlds,
            "exactJointWorlds": partial.state.exact_joint_worlds,
            "verifiedWorlds": partial.state.verified_worlds,
            "elapsedSeconds": partial.state.elapsed_seconds,
            "checksums": {
                "beliefs": partial.state.belief_checksum,
                "factors": partial.state.factor_checksum,
                "keepPrior": partial.state.prior_checksum,
                "discardHistograms": partial.state.histogram_checksum,
                "baselinePairs": partial.state.baseline_checksum,
                "partial": checksum_string(fnv1a64_file(&partial_path)?),
            },
            "resumeSemantics": "the atomic partial snapshot is authoritative; interruption deterministically repeats at most one dealer-keep row",
        }),
    )?;
    println!(
        "state=complete dealerStart={} dealerCount={} compatiblePairs={} elapsedSeconds={:.3}",
        config.dealer_start,
        config.dealer_count,
        partial.state.compatible_pairs,
        partial.state.elapsed_seconds
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn process_dealer_rows(
    pair: &mut PairWork<'_>,
    priors: &Priors,
    pone_id: usize,
    policy: &Model911Policy,
    verification_policy: Option<&Model911Policy>,
    verify_limit: usize,
    partial: &mut PartialAsset,
) -> Result<(), String> {
    for dealer_context_index in 0..pair.dealer_contexts.len() {
        let context = &pair.dealer_contexts[dealer_context_index];
        let keep_weight =
            adjusted_prior_weight(priors.pone_keep[pone_id], &pair.hands[1], &context.six)?;
        if keep_weight == 0 {
            continue;
        }
        let variants = adjusted_discard_variants(
            &priors.pone_discards[pone_id],
            &pair.hands[1],
            &context.six,
        )?;
        for cut in 0..RANKS as u8 {
            for variant in &variants {
                let copies = cut_copies(&context.six, &pair.hands[1], &variant.ranks, cut);
                if copies == 0 {
                    continue;
                }
                let outcome = corrected_outcome(
                    pair,
                    dealer_context_index,
                    variant.context_index,
                    cut,
                    policy,
                    verification_policy,
                    verify_limit,
                    partial,
                )?;
                let weight =
                    u128::from(keep_weight) * u128::from(variant.weight) * u128::from(copies);
                partial.dealer[context.row_id].add(outcome.0, outcome.1, weight)?;
                partial.state.exact_joint_worlds += 1;
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn process_pone_rows(
    pair: &mut PairWork<'_>,
    priors: &Priors,
    dealer_id: usize,
    policy: &Model911Policy,
    verification_policy: Option<&Model911Policy>,
    verify_limit: usize,
    partial: &mut PartialAsset,
) -> Result<(), String> {
    for pone_context_index in 0..pair.pone_contexts.len() {
        let context = &pair.pone_contexts[pone_context_index];
        let keep_weight =
            adjusted_prior_weight(priors.dealer_keep[dealer_id], &pair.hands[0], &context.six)?;
        if keep_weight == 0 {
            continue;
        }
        let variants = adjusted_discard_variants(
            &priors.dealer_discards[dealer_id],
            &pair.hands[0],
            &context.six,
        )?;
        for cut in 0..RANKS as u8 {
            if let Some(screen) = actor_screen(
                pair,
                PegSeat::One,
                pone_context_index,
                cut,
                policy,
                &mut partial.state,
            )? {
                set_pone_lead_mask(
                    &mut partial.pone_lead_masks,
                    context.row_id,
                    cut,
                    pair.baseline_pone_lead,
                    screen,
                )?;
            }
            for variant in &variants {
                let copies = cut_copies(&context.six, &pair.hands[0], &variant.ranks, cut);
                if copies == 0 {
                    continue;
                }
                let outcome = corrected_outcome(
                    pair,
                    variant.context_index,
                    pone_context_index,
                    cut,
                    policy,
                    verification_policy,
                    verify_limit,
                    partial,
                )?;
                let weight =
                    u128::from(keep_weight) * u128::from(variant.weight) * u128::from(copies);
                partial.pone[context.row_id].add(outcome.1, outcome.0, weight)?;
                partial.state.exact_joint_worlds += 1;
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn corrected_outcome(
    pair: &mut PairWork<'_>,
    dealer_context_index: usize,
    pone_context_index: usize,
    cut: u8,
    policy: &Model911Policy,
    verification_policy: Option<&Model911Policy>,
    verify_limit: usize,
    partial: &mut PartialAsset,
) -> Result<(u8, u8), String> {
    let key = ((dealer_context_index * pair.pone_contexts.len() + pone_context_index) * RANKS
        + cut as usize) as u32;
    if let Some(outcome) = pair.corrected_outcomes.get(&key).copied() {
        return Ok(outcome);
    }
    let dealer_screen = actor_screen(
        pair,
        PegSeat::Zero,
        dealer_context_index,
        cut,
        policy,
        &mut partial.state,
    )?
    .ok_or_else(|| "physically weighted dealer screen is unavailable".to_string())?;
    let pone_screen = actor_screen(
        pair,
        PegSeat::One,
        pone_context_index,
        cut,
        policy,
        &mut partial.state,
    )?
    .ok_or_else(|| "physically weighted pone screen is unavailable".to_string())?;
    let stable = dealer_screen.first_changed_action_index.is_none()
        && pone_screen.first_changed_action_index.is_none();
    let outcome = if stable {
        partial.state.stable_joint_worlds += 1;
        pair.trace.outcome()
    } else {
        let discards = [
            pair.dealer_contexts[dealer_context_index].discard,
            pair.pone_contexts[pone_context_index].discard,
        ];
        let corrected = rollout_model1322_from_actor_screens(
            pair.trace,
            discards,
            cut,
            [dealer_screen, pone_screen],
            policy,
        )?;
        partial.state.suffix_rollouts += 1;
        corrected.outcome
    };
    if partial.state.verified_worlds < verify_limit as u64 {
        let verification_policy =
            verification_policy.ok_or_else(|| "verification policy is missing".to_string())?;
        let discards = [
            pair.dealer_contexts[dealer_context_index].discard,
            pair.pone_contexts[pone_context_index].discard,
        ];
        let direct = rollout_model132_world(
            pair.hands,
            discards,
            Some(cut),
            PegSeat::Zero,
            verification_policy,
        )?;
        if direct != outcome {
            return Err(
                "Model 13.22 sparse correction differs from direct full replay".to_string(),
            );
        }
        partial.state.verified_worlds += 1;
    }
    if !stable {
        pair.corrected_outcomes.insert(key, outcome);
    }
    Ok(outcome)
}

fn actor_screen(
    pair: &mut PairWork<'_>,
    actor: PegSeat,
    context_index: usize,
    cut: u8,
    policy: &Model911Policy,
    state: &mut BuildState,
) -> Result<Option<Model1322ActorScreen>, String> {
    let (contexts, screens) = match actor {
        PegSeat::Zero => (pair.dealer_contexts, &mut pair.dealer_screens),
        PegSeat::One => (pair.pone_contexts, &mut pair.pone_screens),
    };
    let slot = context_index * RANKS + cut as usize;
    if let Some(screen) = screens[slot] {
        return Ok(Some(screen));
    }
    let discard = contexts[context_index].discard;
    if !screen_is_physical(&pair.hands, actor, &discard, cut) {
        return Ok(None);
    }
    let screen = screen_model1322_actor_context(pair.trace, actor, discard, cut, policy)?;
    screens[slot] = Some(screen);
    state.actor_screens += 1;
    Ok(Some(screen))
}

fn set_pone_lead_mask(
    masks: &mut [u16],
    row_id: usize,
    cut: u8,
    baseline_lead: u8,
    screen: Model1322ActorScreen,
) -> Result<(), String> {
    let lead = if screen.first_changed_action_index == Some(0) {
        match screen.corrected_action {
            Some(RankPegAction::Play(rank)) => rank,
            _ => return Err("Model 13.22 corrected pone lead is not a play".to_string()),
        }
    } else {
        baseline_lead
    };
    let bit = 1_u16 << cut;
    for rank in 0..RANKS {
        if rank != lead as usize && masks[row_id * RANKS + rank] & bit != 0 {
            return Err(format!(
                "inconsistent Model 13.22 pone lead for row {row_id}, cut {cut}"
            ));
        }
    }
    masks[row_id * RANKS + lead as usize] |= bit;
    Ok(())
}

fn build_context_index(
    keep_keys: &[String],
    keeps: &[[u8; RANKS]],
) -> Result<ContextIndex, String> {
    let keep_id_by_key = keep_keys
        .iter()
        .enumerate()
        .map(|(index, key)| (key.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut by_keep = vec![Vec::new(); KEEP_COUNT];
    let mut rows = Vec::with_capacity(ROLE_ROW_COUNT);
    for six_key in enumerate_rank_count_keys(6) {
        let six = rank_counts_from_key(&six_key)?;
        for discard in discards_from_six(&six) {
            let keep = subtract(&six, &discard)?;
            let keep_id = keep_id_by_key
                .get(&rank_count_key(&keep))
                .copied()
                .ok_or_else(|| "Model 13.22 keep is not canonical".to_string())?;
            let context = OwnContext {
                discard,
                six,
                row_id: rows.len(),
            };
            by_keep[keep_id].push(context.clone());
            rows.push(context);
        }
    }
    if rows.len() != ROLE_ROW_COUNT {
        return Err(format!(
            "Model 13.22 role row count is {}; expected {ROLE_ROW_COUNT}",
            rows.len()
        ));
    }
    let discard_id_by_keep = by_keep
        .iter()
        .map(|contexts| {
            contexts
                .iter()
                .enumerate()
                .map(|(index, context)| (rank_code(&context.discard), index))
                .collect::<HashMap<_, _>>()
        })
        .collect();
    for (keep, contexts) in keeps.iter().zip(&by_keep) {
        if contexts.is_empty() || rank_count_total(keep) != 4 {
            return Err("Model 13.22 context index contains an empty keep".to_string());
        }
    }
    Ok(ContextIndex {
        by_keep,
        discard_id_by_keep,
        rows,
    })
}

fn load_priors(
    prior_path: &Path,
    histogram_path: &Path,
    keep_keys: &[String],
    contexts: &ContextIndex,
) -> Result<Priors, String> {
    let prior: KeepPriorFile = serde_json::from_slice(
        &fs::read(prior_path)
            .map_err(|error| format!("read {} failed: {error}", prior_path.display()))?,
    )
    .map_err(|error| format!("parse {} failed: {error}", prior_path.display()))?;
    if prior.version != 1 {
        return Err("unsupported Model 13.22 keep prior".to_string());
    }
    let histograms: HistogramFile = serde_json::from_slice(
        &fs::read(histogram_path)
            .map_err(|error| format!("read {} failed: {error}", histogram_path.display()))?,
    )
    .map_err(|error| format!("parse {} failed: {error}", histogram_path.display()))?;
    if histograms.schema_version != 1 || histograms.model_version != "13.22" {
        return Err("unsupported Model 13.22 discard histogram".to_string());
    }
    let dealer_keep = prior_vector(&prior.roles.dealer, keep_keys)?;
    let pone_keep = prior_vector(&prior.roles.pone, keep_keys)?;
    let dealer_discards = discard_vectors(
        histograms.roles.dealer,
        histograms.fallback_by_role.dealer,
        keep_keys,
        contexts,
    )?;
    let pone_discards = discard_vectors(
        histograms.roles.pone,
        histograms.fallback_by_role.pone,
        keep_keys,
        contexts,
    )?;
    Ok(Priors {
        dealer_keep,
        pone_keep,
        dealer_discards,
        pone_discards,
    })
}

fn prior_vector(prior: &BTreeMap<String, u64>, keep_keys: &[String]) -> Result<Vec<u64>, String> {
    keep_keys
        .iter()
        .map(|key| Ok(prior.get(key).copied().unwrap_or(0)))
        .collect()
}

fn discard_vectors(
    mut histograms: BTreeMap<String, BTreeMap<String, u64>>,
    fallback: BTreeMap<String, u64>,
    keep_keys: &[String],
    contexts: &ContextIndex,
) -> Result<Vec<Vec<DiscardVariant>>, String> {
    keep_keys
        .iter()
        .enumerate()
        .map(|(keep_id, keep_key)| {
            let source = histograms
                .remove(keep_key)
                .unwrap_or_else(|| fallback.clone());
            let mut variants = Vec::new();
            for (discard_key, weight) in source {
                if weight == 0 {
                    continue;
                }
                let ranks = rank_counts_from_key(&discard_key)?;
                if rank_count_total(&ranks) != 2 {
                    return Err(format!("invalid Model 13.22 discard {discard_key}"));
                }
                let Some(context_index) = contexts.discard_id_by_keep[keep_id]
                    .get(&rank_code(&ranks))
                    .copied()
                else {
                    continue;
                };
                variants.push(DiscardVariant {
                    context_index,
                    ranks,
                    weight,
                });
            }
            variants.sort_by_key(|variant| variant.context_index);
            if variants.is_empty() {
                return Err(format!(
                    "Model 13.22 keep {keep_key} has no physical discard histogram"
                ));
            }
            Ok(variants)
        })
        .collect()
}

fn adjusted_prior_weight(
    prior: u64,
    opponent_keep: &[u8; RANKS],
    own_six: &[u8; RANKS],
) -> Result<u64, String> {
    let mut available = [0_u8; RANKS];
    for rank in 0..RANKS {
        available[rank] = 4_u8
            .checked_sub(own_six[rank])
            .ok_or_else(|| "Model 13.22 own six exceeds the deck".to_string())?;
    }
    adjusted_keep_weight(prior, opponent_keep, &available)
}

fn adjusted_discard_variants(
    variants: &[DiscardVariant],
    opponent_keep: &[u8; RANKS],
    own_six: &[u8; RANKS],
) -> Result<Vec<DiscardVariant>, String> {
    let mut baseline_available = [0_u8; RANKS];
    let mut actual_available = [0_u8; RANKS];
    for rank in 0..RANKS {
        baseline_available[rank] = 4_u8
            .checked_sub(opponent_keep[rank])
            .ok_or_else(|| "Model 13.22 opponent keep exceeds the deck".to_string())?;
        actual_available[rank] = baseline_available[rank]
            .checked_sub(own_six[rank])
            .ok_or_else(|| "Model 13.22 exact keep world is impossible".to_string())?;
    }
    Ok(variants
        .iter()
        .filter_map(|variant| {
            let baseline = rank_combination_count(&variant.ranks, &baseline_available).max(0.0);
            let actual = rank_combination_count(&variant.ranks, &actual_available).max(0.0);
            if baseline == 0.0 || actual == 0.0 {
                return None;
            }
            let weight = (variant.weight as f64 * actual / baseline).round() as u64;
            (weight > 0).then_some(DiscardVariant { weight, ..*variant })
        })
        .collect())
}

fn load_baseline_pairs(path: &Path) -> Result<Vec<u16>, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("read {} failed: {error}", path.display()))?;
    let expected = BASELINE_HEADER_BYTES + KEEP_COUNT * KEEP_COUNT * 2;
    if bytes.len() != expected || &bytes[..8] != BASELINE_MAGIC {
        return Err("invalid or incomplete Model 9.11 baseline pair asset".to_string());
    }
    Ok(bytes[BASELINE_HEADER_BYTES..]
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect())
}

fn baseline_outcome(values: &[u16], dealer_id: usize, pone_id: usize) -> Result<(u8, u8), String> {
    let value = values[dealer_id * KEEP_COUNT + pone_id];
    if value == INVALID_PAIR || value >> 10 != 0 {
        return Err("Model 9.11 baseline is missing a compatible pair".to_string());
    }
    Ok(((value & 0x1f) as u8, ((value >> 5) & 0x1f) as u8))
}

fn new_state(config: &BuildConfig, checksums: &[String; 5]) -> BuildState {
    BuildState {
        schema_version: 1,
        model_version: "13.22".to_string(),
        state: "running".to_string(),
        dealer_start: config.dealer_start,
        dealer_count: config.dealer_count,
        pone_start: config.pone_start,
        pone_count: config.pone_count,
        completed_dealer_keeps: 0,
        compatible_pairs: 0,
        actor_screens: 0,
        suffix_rollouts: 0,
        stable_joint_worlds: 0,
        exact_joint_worlds: 0,
        verified_worlds: 0,
        elapsed_seconds: 0.0,
        belief_checksum: checksums[0].clone(),
        factor_checksum: checksums[1].clone(),
        prior_checksum: checksums[2].clone(),
        histogram_checksum: checksums[3].clone(),
        baseline_checksum: checksums[4].clone(),
    }
}

fn validate_state(actual: &BuildState, expected: &BuildState) -> Result<(), String> {
    if actual.schema_version != expected.schema_version
        || actual.model_version != expected.model_version
        || actual.dealer_start != expected.dealer_start
        || actual.dealer_count != expected.dealer_count
        || actual.pone_start != expected.pone_start
        || actual.pone_count != expected.pone_count
        || actual.completed_dealer_keeps > actual.dealer_count
        || actual.belief_checksum != expected.belief_checksum
        || actual.factor_checksum != expected.factor_checksum
        || actual.prior_checksum != expected.prior_checksum
        || actual.histogram_checksum != expected.histogram_checksum
        || actual.baseline_checksum != expected.baseline_checksum
    {
        return Err(
            "Model 13.22 resume configuration does not match its partial asset".to_string(),
        );
    }
    Ok(())
}

fn write_checkpoint(
    config: &BuildConfig,
    state: &BuildState,
    stats: Model91PolicyStats,
) -> Result<(), String> {
    atomic_json(&config.output.join(CHECKPOINT_FILE), state)?;
    let rate = if state.elapsed_seconds > 0.0 {
        state.compatible_pairs as f64 / state.elapsed_seconds
    } else {
        0.0
    };
    let remaining_rows = state
        .dealer_count
        .saturating_sub(state.completed_dealer_keeps);
    let pairs_per_row = if state.completed_dealer_keeps > 0 {
        state.compatible_pairs as f64 / state.completed_dealer_keeps as f64
    } else {
        0.0
    };
    let eta = if rate > 0.0 {
        remaining_rows as f64 * pairs_per_row / rate
    } else {
        0.0
    };
    atomic_json(
        &config.output.join(STATUS_FILE),
        &json!({
            "schemaVersion": 1,
            "modelVersion": "13.22",
            "status": state.state,
            "dealerStart": state.dealer_start,
            "dealerCount": state.dealer_count,
            "completedDealerKeeps": state.completed_dealer_keeps,
            "poneStart": state.pone_start,
            "poneCount": state.pone_count,
            "compatiblePairs": state.compatible_pairs,
            "pairsPerSecond": rate,
            "actorScreens": state.actor_screens,
            "suffixRollouts": state.suffix_rollouts,
            "stableJointWorlds": state.stable_joint_worlds,
            "exactJointWorlds": state.exact_joint_worlds,
            "verifiedWorlds": state.verified_worlds,
            "elapsedSeconds": state.elapsed_seconds,
            "etaSeconds": eta,
            "checkpointUnit": "dealer keep row",
            "cacheLimits": {
                "action": config.action_cache_limit,
                "evidenceOutcomes": config.evidence_cache_outcome_limit,
                "continuation": config.future_cache_limit,
            },
            "policyStats": policy_stats_json(stats),
        }),
    )
}

fn policy_stats_json(stats: Model91PolicyStats) -> serde_json::Value {
    json!({
        "decisionRequests": stats.decision_requests,
        "decisionCacheHits": stats.decision_cache_hits,
        "decisionCacheCapacityClears": stats.decision_cache_capacity_clears,
        "decisionCachePeakEntries": stats.decision_cache_peak_entries,
        "evaluatedDecisions": stats.evaluated_decisions,
        "posteriorRequests": stats.posterior_requests,
        "posteriorHandsGenerated": stats.posterior_hands_generated,
        "futureStates": stats.random_future_states,
        "futureCacheHits": stats.future_cache_hits,
        "futureCacheEntries": stats.future_cache_entries,
        "futureCacheCapacityClears": stats.future_cache_capacity_clears,
        "futureCachePeakEntries": stats.future_cache_peak_entries,
    })
}

fn write_partial(path: &Path, partial: &PartialAsset) -> Result<(), String> {
    let temporary = path.with_extension(format!("tmp-{}", process::id()));
    let file = File::create(&temporary)
        .map_err(|error| format!("create {} failed: {error}", temporary.display()))?;
    let mut writer = BufWriter::with_capacity(4 * 1024 * 1024, file);
    write_header(&mut writer, &partial.state)?;
    for values in [&partial.dealer, &partial.pone] {
        for value in values {
            writer
                .write_all(&value.own_points_x_weight.to_le_bytes())
                .and_then(|_| writer.write_all(&value.opponent_points_x_weight.to_le_bytes()))
                .and_then(|_| writer.write_all(&value.weight.to_le_bytes()))
                .map_err(|error| format!("write {} failed: {error}", temporary.display()))?;
        }
    }
    for mask in &partial.pone_lead_masks {
        writer
            .write_all(&mask.to_le_bytes())
            .map_err(|error| format!("write {} failed: {error}", temporary.display()))?;
    }
    writer
        .flush()
        .map_err(|error| format!("flush {} failed: {error}", temporary.display()))?;
    writer
        .get_ref()
        .sync_all()
        .map_err(|error| format!("sync {} failed: {error}", temporary.display()))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("replace {} failed: {error}", path.display()))
}

fn read_partial(path: &Path) -> Result<PartialAsset, String> {
    let expected =
        HEADER_BYTES + ROLE_ROW_COUNT * 2 * ACCUMULATOR_BYTES + ROLE_ROW_COUNT * RANKS * 2;
    let mut bytes =
        fs::read(path).map_err(|error| format!("read {} failed: {error}", path.display()))?;
    if bytes.len() != expected {
        return Err(format!(
            "Model 13.22 partial has {} bytes; expected {expected}",
            bytes.len()
        ));
    }
    let state = read_header(&bytes[..HEADER_BYTES])?;
    let mut offset = HEADER_BYTES;
    let mut read_accumulators = || -> Vec<WeightedAccumulator> {
        (0..ROLE_ROW_COUNT)
            .map(|_| {
                let own = u128::from_le_bytes(bytes[offset..offset + 16].try_into().unwrap());
                let opponent =
                    u128::from_le_bytes(bytes[offset + 16..offset + 32].try_into().unwrap());
                let weight =
                    u128::from_le_bytes(bytes[offset + 32..offset + 48].try_into().unwrap());
                offset += ACCUMULATOR_BYTES;
                WeightedAccumulator {
                    own_points_x_weight: own,
                    opponent_points_x_weight: opponent,
                    weight,
                }
            })
            .collect()
    };
    let dealer = read_accumulators();
    let pone = read_accumulators();
    let pone_lead_masks = bytes[offset..]
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    bytes.clear();
    Ok(PartialAsset {
        state,
        dealer,
        pone,
        pone_lead_masks,
    })
}

fn write_header(writer: &mut impl Write, state: &BuildState) -> Result<(), String> {
    let values = [
        parse_checksum(&state.belief_checksum)?,
        parse_checksum(&state.factor_checksum)?,
        parse_checksum(&state.prior_checksum)?,
        parse_checksum(&state.histogram_checksum)?,
        parse_checksum(&state.baseline_checksum)?,
    ];
    writer
        .write_all(MAGIC)
        .and_then(|_| writer.write_all(&VERSION.to_le_bytes()))
        .and_then(|_| writer.write_all(&(ROLE_ROW_COUNT as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(state.dealer_start as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(state.dealer_count as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(state.pone_start as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(state.pone_count as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&(state.completed_dealer_keeps as u32).to_le_bytes()))
        .and_then(|_| writer.write_all(&0_u32.to_le_bytes()))
        .map_err(|error| format!("write Model 13.22 header failed: {error}"))?;
    for value in values {
        writer
            .write_all(&value.to_le_bytes())
            .map_err(|error| format!("write Model 13.22 checksum failed: {error}"))?;
    }
    for value in [
        state.compatible_pairs,
        state.actor_screens,
        state.suffix_rollouts,
        state.stable_joint_worlds,
        state.exact_joint_worlds,
    ] {
        writer
            .write_all(&value.to_le_bytes())
            .map_err(|error| format!("write Model 13.22 counter failed: {error}"))?;
    }
    writer
        .write_all(&state.elapsed_seconds.to_le_bytes())
        .map_err(|error| format!("write Model 13.22 elapsed time failed: {error}"))
}

fn read_header(bytes: &[u8]) -> Result<BuildState, String> {
    if bytes.len() != HEADER_BYTES || &bytes[..8] != MAGIC || read_u32(bytes, 8)? != VERSION {
        return Err("invalid Model 13.22 correction header".to_string());
    }
    if read_u32(bytes, 12)? as usize != ROLE_ROW_COUNT {
        return Err("Model 13.22 correction row count changed".to_string());
    }
    let checksum = |offset| checksum_string(read_u64(bytes, offset).unwrap());
    Ok(BuildState {
        schema_version: 1,
        model_version: "13.22".to_string(),
        state: if read_u32(bytes, 32)? == read_u32(bytes, 20)? {
            "complete".to_string()
        } else {
            "running".to_string()
        },
        dealer_start: read_u32(bytes, 16)? as usize,
        dealer_count: read_u32(bytes, 20)? as usize,
        pone_start: read_u32(bytes, 24)? as usize,
        pone_count: read_u32(bytes, 28)? as usize,
        completed_dealer_keeps: read_u32(bytes, 32)? as usize,
        belief_checksum: checksum(40),
        factor_checksum: checksum(48),
        prior_checksum: checksum(56),
        histogram_checksum: checksum(64),
        baseline_checksum: checksum(72),
        compatible_pairs: read_u64(bytes, 80)?,
        actor_screens: read_u64(bytes, 88)?,
        suffix_rollouts: read_u64(bytes, 96)?,
        stable_joint_worlds: read_u64(bytes, 104)?,
        exact_joint_worlds: read_u64(bytes, 112)?,
        verified_worlds: 0,
        elapsed_seconds: read_f64(bytes, 120)?,
    })
}

fn merge(config: &MergeConfig) -> Result<(), String> {
    fs::create_dir_all(&config.output)
        .map_err(|error| format!("create {} failed: {error}", config.output.display()))?;
    let mut shards = fs::read_dir(&config.shards)
        .map_err(|error| format!("read {} failed: {error}", config.shards.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.join(PARTIAL_FILE).is_file())
        .map(|path| read_partial(&path.join(PARTIAL_FILE)))
        .collect::<Result<Vec<_>, _>>()?;
    shards.sort_by_key(|partial| partial.state.dealer_start);
    if shards.is_empty() {
        return Err("no Model 13.22 correction shards found".to_string());
    }
    let first = shards[0].state.clone();
    let mut next = 0_usize;
    let mut merged = PartialAsset {
        state: BuildState {
            dealer_start: 0,
            dealer_count: KEEP_COUNT,
            pone_start: 0,
            pone_count: KEEP_COUNT,
            completed_dealer_keeps: KEEP_COUNT,
            state: "complete".to_string(),
            ..first.clone()
        },
        dealer: vec![WeightedAccumulator::default(); ROLE_ROW_COUNT],
        pone: vec![WeightedAccumulator::default(); ROLE_ROW_COUNT],
        pone_lead_masks: vec![0_u16; ROLE_ROW_COUNT * RANKS],
    };
    merged.state.compatible_pairs = 0;
    merged.state.actor_screens = 0;
    merged.state.suffix_rollouts = 0;
    merged.state.stable_joint_worlds = 0;
    merged.state.exact_joint_worlds = 0;
    merged.state.verified_worlds = 0;
    merged.state.elapsed_seconds = 0.0;
    for shard in &shards {
        validate_merge_shard(&shard.state, &first, next)?;
        next += shard.state.dealer_count;
        merged.state.compatible_pairs += shard.state.compatible_pairs;
        merged.state.actor_screens += shard.state.actor_screens;
        merged.state.suffix_rollouts += shard.state.suffix_rollouts;
        merged.state.stable_joint_worlds += shard.state.stable_joint_worlds;
        merged.state.exact_joint_worlds += shard.state.exact_joint_worlds;
        merged.state.elapsed_seconds = merged
            .state
            .elapsed_seconds
            .max(shard.state.elapsed_seconds);
        for index in 0..ROLE_ROW_COUNT {
            merged.dealer[index].merge(shard.dealer[index])?;
            merged.pone[index].merge(shard.pone[index])?;
        }
        merge_lead_masks(&mut merged.pone_lead_masks, &shard.pone_lead_masks)?;
    }
    if next != KEEP_COUNT {
        return Err(format!(
            "Model 13.22 correction shards cover {next}/{KEEP_COUNT} dealer keeps"
        ));
    }
    validate_merged_rows(&merged)?;
    let output_path = config.output.join(MERGED_FILE);
    write_partial(&output_path, &merged)?;
    atomic_json(
        &config.output.join(MANIFEST_FILE),
        &json!({
            "schemaVersion": 1,
            "modelVersion": "13.22",
            "status": "complete",
            "shards": shards.len(),
            "dealerKeeps": KEEP_COUNT,
            "poneKeeps": KEEP_COUNT,
            "roleRows": ROLE_ROW_COUNT,
            "compatiblePairs": merged.state.compatible_pairs,
            "actorScreens": merged.state.actor_screens,
            "suffixRollouts": merged.state.suffix_rollouts,
            "stableJointWorlds": merged.state.stable_joint_worlds,
            "exactJointWorlds": merged.state.exact_joint_worlds,
            "wallSeconds": merged.state.elapsed_seconds,
            "bytes": fs::metadata(&output_path).map_err(|error| error.to_string())?.len(),
            "outputChecksum": checksum_string(fnv1a64_file(&output_path)?),
            "rowOrder": "canonical six-card rank hand, canonical contained two-card discard; dealer and pone arrays use the same 165,295 row order",
            "poneLeadMasks": "thirteen u16 masks per pone row; bit c marks cut rank c",
            "durableObservationActionTable": false,
        }),
    )?;
    Ok(())
}

fn validate_merge_shard(
    actual: &BuildState,
    first: &BuildState,
    expected_start: usize,
) -> Result<(), String> {
    if actual.state != "complete"
        || actual.completed_dealer_keeps != actual.dealer_count
        || actual.dealer_start != expected_start
        || actual.pone_start != 0
        || actual.pone_count != KEEP_COUNT
        || actual.belief_checksum != first.belief_checksum
        || actual.factor_checksum != first.factor_checksum
        || actual.prior_checksum != first.prior_checksum
        || actual.histogram_checksum != first.histogram_checksum
        || actual.baseline_checksum != first.baseline_checksum
    {
        return Err("incompatible or incomplete Model 13.22 correction shard".to_string());
    }
    Ok(())
}

fn merge_lead_masks(target: &mut [u16], source: &[u16]) -> Result<(), String> {
    for row in 0..ROLE_ROW_COUNT {
        for cut in 0..RANKS {
            let bit = 1_u16 << cut;
            let mut selected = None;
            for rank in 0..RANKS {
                if source[row * RANKS + rank] & bit != 0 {
                    if selected.replace(rank).is_some() {
                        return Err("one correction shard has conflicting pone leads".to_string());
                    }
                }
            }
            if let Some(rank) = selected {
                for other in 0..RANKS {
                    if other != rank && target[row * RANKS + other] & bit != 0 {
                        return Err(
                            "Model 13.22 correction shards disagree on a pone lead".to_string()
                        );
                    }
                }
                target[row * RANKS + rank] |= bit;
            }
        }
    }
    Ok(())
}

fn validate_merged_rows(asset: &PartialAsset) -> Result<(), String> {
    let contexts = build_context_index(
        &enumerate_rank_count_keys(4),
        &enumerate_rank_count_keys(4)
            .iter()
            .map(|key| rank_counts_from_key(key))
            .collect::<Result<Vec<_>, _>>()?,
    )?;
    for row in 0..ROLE_ROW_COUNT {
        if asset.dealer[row].weight == 0 || asset.pone[row].weight == 0 {
            return Err(format!("Model 13.22 merged row {row} has zero weight"));
        }
        let expected = (0..RANKS)
            .filter(|rank| contexts.rows[row].six[*rank] < 4)
            .fold(0_u16, |mask, rank| mask | (1_u16 << rank));
        let mut actual = 0_u16;
        for rank in 0..RANKS {
            let mask = asset.pone_lead_masks[row * RANKS + rank];
            if actual & mask != 0 {
                return Err(format!(
                    "Model 13.22 merged row {row} has conflicting lead masks"
                ));
            }
            actual |= mask;
        }
        if actual != expected {
            return Err(format!(
                "Model 13.22 merged row {row} has incomplete lead cuts"
            ));
        }
    }
    Ok(())
}

fn screen_is_physical(
    hands: &[[u8; RANKS]; 2],
    actor: PegSeat,
    discard: &[u8; RANKS],
    cut: u8,
) -> bool {
    (0..RANKS).all(|rank| {
        let cut_count = u8::from(rank == cut as usize);
        hands[0][rank]
            + hands[1][rank]
            + discard[rank] * u8::from(actor == PegSeat::Zero || actor == PegSeat::One)
            + cut_count
            <= 4
    })
}

fn cut_copies(
    own_six: &[u8; RANKS],
    opponent_keep: &[u8; RANKS],
    opponent_discard: &[u8; RANKS],
    cut: u8,
) -> u8 {
    let rank = cut as usize;
    4_u8.saturating_sub(
        own_six[rank]
            .saturating_add(opponent_keep[rank])
            .saturating_add(opponent_discard[rank]),
    )
}

fn compatible(left: &[u8; RANKS], right: &[u8; RANKS]) -> bool {
    (0..RANKS).all(|rank| left[rank] + right[rank] <= 4)
}

fn discards_from_six(six: &[u8; RANKS]) -> Vec<[u8; RANKS]> {
    let mut result = Vec::new();
    for first in 0..RANKS {
        if six[first] == 0 {
            continue;
        }
        for second in first..RANKS {
            let needed = if first == second { 2 } else { 1 };
            if six[second] < needed {
                continue;
            }
            let mut discard = [0_u8; RANKS];
            discard[first] += 1;
            discard[second] += 1;
            result.push(discard);
        }
    }
    result
}

fn subtract(six: &[u8; RANKS], discard: &[u8; RANKS]) -> Result<[u8; RANKS], String> {
    let mut keep = [0_u8; RANKS];
    for rank in 0..RANKS {
        keep[rank] = six[rank]
            .checked_sub(discard[rank])
            .ok_or_else(|| "discard is not contained in six-card hand".to_string())?;
    }
    if rank_count_total(&keep) != 4 {
        return Err("Model 13.22 keep does not total four cards".to_string());
    }
    Ok(keep)
}

fn rank_code(ranks: &[u8; RANKS]) -> u32 {
    ranks
        .iter()
        .fold(0_u32, |value, count| value * 5 + u32::from(*count))
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
        .parse()
        .map_err(|error| format!("invalid {flag} {value}: {error}"))
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let temporary = path.with_extension(format!("tmp-{}", process::id()));
    let mut bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("serialize {} failed: {error}", path.display()))?;
    bytes.push(b'\n');
    let mut file = File::create(&temporary)
        .map_err(|error| format!("create {} failed: {error}", temporary.display()))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("write {} failed: {error}", temporary.display()))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("replace {} failed: {error}", path.display()))
}

fn fnv1a64_file(path: &Path) -> Result<u64, String> {
    let mut file =
        File::open(path).map_err(|error| format!("open {} failed: {error}", path.display()))?;
    let mut hash = 0xcbf29ce484222325_u64;
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("read {} failed: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        for byte in &buffer[..read] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    Ok(hash)
}

fn checksum_string(value: u64) -> String {
    format!("{value:016x}")
}

fn parse_checksum(value: &str) -> Result<u64, String> {
    u64::from_str_radix(value, 16).map_err(|error| format!("invalid checksum {value}: {error}"))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| format!("u32 is out of range at {offset}"))?;
    Ok(u32::from_le_bytes(value.try_into().unwrap()))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, String> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| format!("u64 is out of range at {offset}"))?;
    Ok(u64::from_le_bytes(value.try_into().unwrap()))
}

fn read_f64(bytes: &[u8], offset: usize) -> Result<f64, String> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| format!("f64 is out of range at {offset}"))?;
    Ok(f64::from_le_bytes(value.try_into().unwrap()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_context_index_has_expected_rows() {
        let keys = enumerate_rank_count_keys(4);
        let keeps = keys
            .iter()
            .map(|key| rank_counts_from_key(key).unwrap())
            .collect::<Vec<_>>();
        let index = build_context_index(&keys, &keeps).unwrap();
        assert_eq!(index.rows.len(), ROLE_ROW_COUNT);
        assert!(index.by_keep.iter().all(|contexts| !contexts.is_empty()));
    }

    #[test]
    fn accumulator_uses_exact_integer_weights() {
        let mut value = WeightedAccumulator::default();
        value.add(7, 3, 11).unwrap();
        value.add(1, 9, 5).unwrap();
        assert_eq!(value.weight, 16);
        assert_eq!(value.own_points_x_weight, 82);
        assert_eq!(value.opponent_points_x_weight, 78);
    }
}
