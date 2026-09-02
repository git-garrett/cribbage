//! Deterministic feasibility calibration for the Model 9.11 baseline and the
//! sparse Model 13.22 dead-card edit pass.

use cribbage_shadow_engine::cards::{
    enumerate_rank_count_keys, rank_count_total, rank_counts_from_key,
};
use cribbage_shadow_engine::information_set::PegSeat;
use cribbage_shadow_engine::model132::{
    rollout_model1322_delta, rollout_model132_world, trace_model911_pair, Model1322DeclineFactors,
    Model911Policy,
};
use cribbage_shadow_engine::model91::{Model91EmpiricalBeliefs, Model91PolicyStats};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::Instant;

const CANONICAL_KEEPS: usize = 1_820;
const RANK_COUNT: usize = 13;
const COMPATIBLE_ORDERED_PAIRS: u64 = 3_274_375;
const REFERENCE_FULL_CORRECTION_CONTEXTS: u64 = 99_181_545_503;
const MAX_OWN_DISCARD_RANK_PAIRS_PER_KEEP: u64 = 91;
const RANK_ONLY_CUTS: u64 = 13;

struct Config {
    output: PathBuf,
    beliefs: PathBuf,
    factors: PathBuf,
    pairs: usize,
    contexts_per_pair: usize,
    seed: u64,
    action_cache_limit: usize,
    evidence_cache_outcome_limit: usize,
    future_cache_limit: usize,
}

#[derive(Clone)]
struct CorrectionJob {
    hands: [[u8; RANK_COUNT]; 2],
    discards: [[u8; RANK_COUNT]; 2],
    cut: u8,
    expected: (u8, u8),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FactorAsset {
    schema_version: u32,
    model_version: String,
    factors: FactorRows,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FactorRows {
    three_card_run: FactorRow,
    four_plus_card_run: FactorRow,
    pair: FactorRow,
    pair_royal_after_pair: FactorRow,
    four_of_a_kind_after_pair_royal: FactorRow,
    safe_pair: FactorRow,
    safe_pair_royal: FactorRow,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FactorRow {
    multiplier_ppm: u32,
    by_card_ordinal: FactorOrdinalRows,
}

#[derive(Debug, Deserialize)]
struct FactorOrdinalRows {
    first: FactorOrdinalRow,
    second: FactorOrdinalRow,
    third: FactorOrdinalRow,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FactorOrdinalRow {
    multiplier_ppm: Option<u32>,
    observed_declines: u64,
    declines_with_card_held: u64,
    declines_without_card_held: u64,
    held_given_decline_ppm: Option<u32>,
}

impl FactorRow {
    fn ordinals(&self, category: &str) -> Result<[u32; 3], String> {
        let rows = [
            ("first", &self.by_card_ordinal.first),
            ("second", &self.by_card_ordinal.second),
            ("third", &self.by_card_ordinal.third),
        ];
        let mut result = [0_u32; 3];
        for (index, (ordinal, row)) in rows.into_iter().enumerate() {
            if row.declines_with_card_held + row.declines_without_card_held != row.observed_declines
            {
                return Err(format!(
                    "Model 13.22 {category}/{ordinal} held-card counts do not sum"
                ));
            }
            if (row.observed_declines == 0) != row.held_given_decline_ppm.is_none() {
                return Err(format!(
                    "Model 13.22 {category}/{ordinal} posterior is inconsistent"
                ));
            }
            result[index] = row.multiplier_ppm.unwrap_or(self.multiplier_ppm);
        }
        Ok(result)
    }
}

#[derive(Clone, Copy)]
struct SplitMix64(u64);

impl SplitMix64 {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut value = self.0;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        value ^ (value >> 31)
    }
}

fn main() {
    if let Err(error) = parse_config().and_then(run) {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn parse_config() -> Result<Config, String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let mut output = None;
    let mut beliefs = None;
    let mut factors = None;
    let mut pairs = 12_usize;
    let mut contexts_per_pair = 12_usize;
    let mut seed = 0x0911_1322_u64;
    let mut action_cache_limit = 100_000_usize;
    let mut evidence_cache_outcome_limit = 2_000_000_usize;
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
            "--pairs" => pairs = parse_usize(&value(&mut index)?, flag)?,
            "--contexts-per-pair" => contexts_per_pair = parse_usize(&value(&mut index)?, flag)?,
            "--seed" => seed = parse_u64(&value(&mut index)?)?,
            "--action-cache-limit" => action_cache_limit = parse_usize(&value(&mut index)?, flag)?,
            "--evidence-cache-outcome-limit" => {
                evidence_cache_outcome_limit = parse_usize(&value(&mut index)?, flag)?
            }
            "--future-cache-limit" => future_cache_limit = parse_usize(&value(&mut index)?, flag)?,
            "--help" | "-h" => {
                println!(
                    "calibrate_model911_delta --output DIR --beliefs FILE --factors FILE \
                     [--pairs N] [--contexts-per-pair N] [--seed N] \
                     [--action-cache-limit N] [--evidence-cache-outcome-limit N] \
                     [--future-cache-limit N]"
                );
                process::exit(0);
            }
            _ => return Err(format!("unknown Model 9.11 calibration argument {flag}")),
        }
    }
    if pairs == 0 || contexts_per_pair == 0 || evidence_cache_outcome_limit == 0 {
        return Err("pairs, contexts, and evidence-cache capacity must be positive".to_string());
    }
    Ok(Config {
        output: output.ok_or_else(|| "--output is required".to_string())?,
        beliefs: beliefs.ok_or_else(|| "--beliefs is required".to_string())?,
        factors: factors.ok_or_else(|| "--factors is required".to_string())?,
        pairs,
        contexts_per_pair,
        seed,
        action_cache_limit,
        evidence_cache_outcome_limit,
        future_cache_limit,
    })
}

fn run(config: Config) -> Result<(), String> {
    fs::create_dir_all(&config.output)
        .map_err(|error| format!("create {} failed: {error}", config.output.display()))?;
    let factors = load_factors(&config.factors)?;
    let beliefs = Model91EmpiricalBeliefs::load(&config.beliefs)?;
    let keep_keys = enumerate_rank_count_keys(4);
    if keep_keys.len() != CANONICAL_KEEPS {
        return Err("Model 9.11 canonical keep count changed".to_string());
    }
    let keeps = keep_keys
        .iter()
        .map(|key| rank_counts_from_key(key))
        .collect::<Result<Vec<_>, _>>()?;
    let pair_ids = sampled_compatible_pairs(&keeps, config.pairs, config.seed)?;

    let edit_policy = Model911Policy::new_with_evidence_cache(
        Some(beliefs.clone()),
        factors,
        config.action_cache_limit,
        config.evidence_cache_outcome_limit,
        config.future_cache_limit,
    )?;
    let mut baseline_seconds = 0.0_f64;
    let mut edit_seconds = 0.0_f64;
    let mut jobs = Vec::with_capacity(config.pairs * config.contexts_per_pair);
    let mut action_changed = 0_u64;
    let mut outcome_changed = 0_u64;
    let mut opening_changed = 0_u64;
    let mut screened_decisions = 0_u64;
    let mut suffix_decisions = 0_u64;
    let mut first_change_total = 0_u64;
    for (dealer_id, pone_id) in &pair_ids {
        let hands = [keeps[*dealer_id], keeps[*pone_id]];
        let baseline_started = Instant::now();
        let trace = trace_model911_pair(hands[0], hands[1], &edit_policy)?;
        baseline_seconds += baseline_started.elapsed().as_secs_f64();
        let mut random = SplitMix64(
            config.seed ^ (*dealer_id as u64).rotate_left(17) ^ (*pone_id as u64).rotate_left(41),
        );
        let edit_started = Instant::now();
        for _ in 0..config.contexts_per_pair {
            let (discards, cut) = draw_dead_context(hands, &mut random)?;
            let edited = rollout_model1322_delta(&trace, discards, cut, &edit_policy)?;
            action_changed += u64::from(edited.action_changed);
            outcome_changed += u64::from(edited.outcome_changed);
            opening_changed += u64::from(edited.opening_action_changed);
            screened_decisions += edited.screened_policy_decisions as u64;
            suffix_decisions += edited.suffix_policy_decisions as u64;
            first_change_total += edited.first_changed_policy_decision.unwrap_or(0) as u64;
            jobs.push(CorrectionJob {
                hands,
                discards,
                cut,
                expected: edited.outcome,
            });
        }
        edit_seconds += edit_started.elapsed().as_secs_f64();
    }
    let edit_stats = edit_policy.stats();

    let full_policy = Model911Policy::new(
        Some(beliefs),
        factors,
        config.action_cache_limit,
        config.future_cache_limit,
    )?;
    let full_started = Instant::now();
    for job in &jobs {
        let outcome = rollout_model132_world(
            job.hands,
            job.discards,
            Some(job.cut),
            PegSeat::Zero,
            &full_policy,
        )?;
        if outcome != job.expected {
            return Err("Model 13.22 delta outcome differs from full replay".to_string());
        }
    }
    let full_seconds = full_started.elapsed().as_secs_f64();
    let full_stats = full_policy.stats();

    let contexts = jobs.len() as u64;
    let edit_rate = contexts as f64 / edit_seconds;
    let full_rate = contexts as f64 / full_seconds;
    let factorized_actor_screen_contexts =
        COMPATIBLE_ORDERED_PAIRS * 2 * MAX_OWN_DISCARD_RANK_PAIRS_PER_KEEP * RANK_ONLY_CUTS;
    let report = json!({
        "status": "complete",
        "schemaVersion": 1,
        "baselineModel": "9.11",
        "correctedModel": "13.22",
        "seed": format!("0x{:016x}", config.seed),
        "sample": {
            "compatibleOrderedKeepPairs": pair_ids.len(),
            "deadCardContextsPerPair": config.contexts_per_pair,
            "deadCardContexts": contexts,
            "contextSemantics": "both actors' two physical crib discards plus one rank-only cut, sampled without replacement from cards outside both exact keeps"
        },
        "baseline": {
            "policy": "context-free Model 9.11: Model 9.1 complete-hand EV evaluator plus Model 13.22 go/decline evidence",
            "seconds": baseline_seconds,
            "pairsPerSecond": pair_ids.len() as f64 / baseline_seconds,
            "projectedCompatiblePairs": COMPATIBLE_ORDERED_PAIRS,
            "projectedSingleWorkerSeconds": COMPATIBLE_ORDERED_PAIRS as f64 * baseline_seconds / pair_ids.len() as f64,
            "cacheAccounting": "reported in the combined baseline/edit policy stats because baseline evidence remains hot for its correction contexts",
        },
        "edit": {
            "seconds": edit_seconds,
            "contextsPerSecond": edit_rate,
            "speedupVersusFullReplay": full_seconds / edit_seconds,
            "actionChangedContexts": action_changed,
            "actionChangedRate": action_changed as f64 / contexts as f64,
            "terminalOutcomeChangedContexts": outcome_changed,
            "terminalOutcomeChangedRate": outcome_changed as f64 / contexts as f64,
            "openingActionChangedContexts": opening_changed,
            "openingActionChangedRate": opening_changed as f64 / contexts as f64,
            "meanScreenedPolicyDecisions": screened_decisions as f64 / contexts as f64,
            "meanSuffixPolicyDecisions": suffix_decisions as f64 / contexts as f64,
            "meanFirstChangedPolicyDecisionWhenChanged": if action_changed > 0 { Some(first_change_total as f64 / action_changed as f64) } else { None },
            "policyStats": policy_stats_json(edit_stats),
        },
        "fullReplayControl": {
            "seconds": full_seconds,
            "contextsPerSecond": full_rate,
            "allOutcomesMatchedDelta": true,
            "policyStats": policy_stats_json(full_stats),
        },
        "projection": {
            "referenceCorrectionContexts": REFERENCE_FULL_CORRECTION_CONTEXTS,
            "referenceSource": "benchmarks/model1322/keep-discard-calibration-20260831/report.json",
            "idealSixWorkerEditDaysAtMeasuredRate": REFERENCE_FULL_CORRECTION_CONTEXTS as f64 / edit_rate / 6.0 / 86_400.0,
            "requiredPerWorkerRateForSevenDaysAtSixWorkers": REFERENCE_FULL_CORRECTION_CONTEXTS as f64 / 6.0 / (7.0 * 86_400.0),
            "rawSparseCorrectionCells": (REFERENCE_FULL_CORRECTION_CONTEXTS as f64 * outcome_changed as f64 / contexts as f64).round() as u64,
            "factorizedActorScreenContextsUpperBound": factorized_actor_screen_contexts,
            "factorizedActorScreenIdealSixWorkerDaysAtMeasuredRate": factorized_actor_screen_contexts as f64 / edit_rate / 6.0 / 86_400.0,
            "factorizedActorScreenDerivation": "compatible keep pairs * two actors * at most 91 rank-only own-discard pairs * 13 rank-only cuts; the other actor's private discard is irrelevant until a changed action requires suffix replay",
            "caveat": "synthetic physical dead-card contexts measure the exact edit seam. The factorized number bounds baseline-path screening, not changed suffixes; production must rerun with the role/keep-conditioned empirical discard distribution and dynamically balanced workers"
        },
        "cache": {
            "actionEntries": config.action_cache_limit,
            "evidenceActionHandOutcomes": config.evidence_cache_outcome_limit,
            "evidenceLifetime": "one row-major worker shard with capacity clearing; each baseline trace is corrected immediately while its evidence is hot, and structural observations may also be reused across exact keep pairs",
            "continuationEntries": config.future_cache_limit,
            "durableObservationActionTable": false,
        },
        "integrity": {
            "updatedGoDeclineLogicUsedByBaselineAndCorrection": true,
            "actorOwnedDiscardsAndCutOmittedOnlyFromBaseline": true,
            "firstChangedActionReplaysOnlyCorrectedSuffix": true,
            "everyDeltaComparedWithFreshFullReplay": true,
        }
    });
    let bytes = serde_json::to_vec_pretty(&report)
        .map_err(|error| format!("serialize Model 9.11 report failed: {error}"))?;
    fs::write(config.output.join("report.json"), bytes)
        .map_err(|error| format!("write Model 9.11 report failed: {error}"))?;
    println!(
        "{}",
        serde_json::to_string_pretty(&report)
            .map_err(|error| format!("print Model 9.11 report failed: {error}"))?
    );
    Ok(())
}

fn sampled_compatible_pairs(
    keeps: &[[u8; RANK_COUNT]],
    count: usize,
    seed: u64,
) -> Result<Vec<(usize, usize)>, String> {
    let cells = keeps.len() * keeps.len();
    let mut random = SplitMix64(seed);
    // Consecutive compatible cells reproduce the production pair builder's
    // row-major locality and expose its maximum safe action/evidence reuse.
    let groups = 1_usize;
    let mut seen = BTreeSet::new();
    let mut selected = Vec::with_capacity(count);
    for group in 0..groups {
        let target = count / groups + usize::from(group < count % groups);
        let mut cell = (random.next() as usize) % cells;
        let mut added = 0_usize;
        let mut attempts = 0_usize;
        while added < target {
            if attempts > cells {
                return Err("could not sample enough compatible Model 9.11 pairs".to_string());
            }
            attempts += 1;
            let pair = (cell / keeps.len(), cell % keeps.len());
            cell = (cell + 1) % cells;
            if compatible(&keeps[pair.0], &keeps[pair.1]) && seen.insert(pair) {
                selected.push(pair);
                added += 1;
            }
        }
    }
    Ok(selected)
}

fn compatible(left: &[u8; RANK_COUNT], right: &[u8; RANK_COUNT]) -> bool {
    left.iter()
        .zip(right)
        .all(|(left, right)| left + right <= 4)
}

fn draw_dead_context(
    hands: [[u8; RANK_COUNT]; 2],
    random: &mut SplitMix64,
) -> Result<([[u8; RANK_COUNT]; 2], u8), String> {
    let mut available = [4_u8; RANK_COUNT];
    for rank in 0..RANK_COUNT {
        available[rank] = available[rank]
            .checked_sub(hands[0][rank].saturating_add(hands[1][rank]))
            .ok_or_else(|| format!("Model 9.11 sampled pair overuses rank {rank}"))?;
    }
    let mut discards = [[0_u8; RANK_COUNT]; 2];
    for seat in 0..2 {
        for _ in 0..2 {
            let rank = draw_rank(&mut available, random)?;
            discards[seat][rank as usize] += 1;
        }
    }
    let cut = draw_rank(&mut available, random)?;
    Ok((discards, cut))
}

fn draw_rank(available: &mut [u8; RANK_COUNT], random: &mut SplitMix64) -> Result<u8, String> {
    let total = rank_count_total(available);
    if total == 0 {
        return Err("Model 9.11 dead-card sampler exhausted its deck".to_string());
    }
    let mut target = (random.next() % u64::from(total)) as u8;
    for (rank, copies) in available.iter_mut().enumerate() {
        if target < *copies {
            *copies -= 1;
            return Ok(rank as u8);
        }
        target -= *copies;
    }
    Err("Model 9.11 dead-card sampler failed to select a rank".to_string())
}

fn load_factors(path: &Path) -> Result<Model1322DeclineFactors, String> {
    let asset: FactorAsset = serde_json::from_slice(
        &fs::read(path).map_err(|error| format!("read {} failed: {error}", path.display()))?,
    )
    .map_err(|error| format!("parse {} failed: {error}", path.display()))?;
    if asset.schema_version != 3 || asset.model_version != "13.22" {
        return Err("unsupported Model 13.22 decline-factor asset".to_string());
    }
    let rows = asset.factors;
    let factors = Model1322DeclineFactors {
        three_card_run_ppm: rows.three_card_run.ordinals("threeCardRun")?,
        four_plus_card_run_ppm: rows.four_plus_card_run.ordinals("fourPlusCardRun")?,
        pair_ppm: rows.pair.ordinals("pair")?,
        pair_royal_after_pair_ppm: rows.pair_royal_after_pair.ordinals("pairRoyalAfterPair")?,
        four_of_a_kind_after_pair_royal_ppm: rows
            .four_of_a_kind_after_pair_royal
            .ordinals("fourOfAKindAfterPairRoyal")?,
        safe_pair_ppm: rows.safe_pair.ordinals("safePair")?,
        safe_pair_royal_ppm: rows.safe_pair_royal.ordinals("safePairRoyal")?,
    };
    factors.validate()?;
    Ok(factors)
}

fn policy_stats_json(stats: Model91PolicyStats) -> Value {
    json!({
        "decisionRequests": stats.decision_requests,
        "decisionCacheHits": stats.decision_cache_hits,
        "decisionCacheCapacityClears": stats.decision_cache_capacity_clears,
        "futureStates": stats.random_future_states,
        "futureCacheHits": stats.future_cache_hits,
        "futureCacheCapacityClears": stats.future_cache_capacity_clears,
        "evidenceCacheRequests": stats.evidence_cache_requests,
        "evidenceCacheHits": stats.evidence_cache_hits,
        "evidenceCacheHitRate": if stats.evidence_cache_requests > 0 { stats.evidence_cache_hits as f64 / stats.evidence_cache_requests as f64 } else { 0.0 },
        "evidenceCacheCapacityClears": stats.evidence_cache_capacity_clears,
        "evidenceCachePeakOutcomes": stats.evidence_cache_peak_outcomes,
    })
}

fn parse_usize(value: &str, flag: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|error| format!("invalid {flag} {value}: {error}"))
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
