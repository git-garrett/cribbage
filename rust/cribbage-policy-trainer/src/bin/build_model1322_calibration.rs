//! Deterministic Model 13.22 six-card/cut-averaged builder calibration.
//!
//! This measures the production-shaped inner loop with the actor's complete
//! six-card/discard context and an empirical opponent four-card keep prior.
//! The opponent's private discards can either be marginalized through a stored
//! role/keep-conditioned histogram or omitted for the keep-only approximation.
//! It emits compact row aggregates and pone lead-to-cut masks, never a pegging
//! observation-to-action tree.

use cribbage_shadow_engine::board::Role;
use cribbage_shadow_engine::cards::{
    enumerate_rank_count_keys, rank_combination_count, rank_count_key, rank_count_total,
    rank_counts_from_key,
};
use cribbage_shadow_engine::information_set::{PegSeat, RankPegAction, RankPegState};
use cribbage_shadow_engine::model132::{
    adjusted_keep_weight, rollout_model1322_from_actor_screens, rollout_model132_world,
    screen_model1322_actor_context, trace_model911_pair, Model1322DeclineFactors,
    Model1322FastPolicy, Model1322HeuristicPolicy, Model132Observation, Model132PeggingPolicy,
    Model132World, Model911Policy,
};
use cribbage_shadow_engine::model91::{Model91EmpiricalBeliefs, Model91PolicyStats};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::Instant;

const RANKS: usize = 13;
const CANONICAL_SIX_HANDS: usize = 18_395;

#[derive(Debug)]
struct Config {
    output: PathBuf,
    policy: PolicyMode,
    beliefs: Option<PathBuf>,
    factors: PathBuf,
    keep_prior: PathBuf,
    discard_histograms: Option<PathBuf>,
    six_start: usize,
    six_count: usize,
    opponent_keeps_per_role: usize,
    all_opponent_keeps: bool,
    discard_index: Option<usize>,
    cut_rank: Option<u8>,
    seed: u64,
    action_cache_limit: usize,
    evidence_cache_outcome_limit: usize,
    future_cache_limit: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PolicyMode {
    Fast,
    CompleteHand,
    SparseDelta,
}

impl PolicyMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "fast" => Ok(Self::Fast),
            "complete-hand" => Ok(Self::CompleteHand),
            "sparse-delta" => Ok(Self::SparseDelta),
            _ => Err(format!(
                "invalid --policy {value}; expected fast, complete-hand, or sparse-delta"
            )),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::CompleteHand => "complete-hand",
            Self::SparseDelta => "sparse-delta",
        }
    }
}

enum CalibrationPolicy {
    Fast(Model1322FastPolicy),
    CompleteHand(Model1322HeuristicPolicy),
    SparseDelta(Model911Policy),
}

impl CalibrationPolicy {
    fn mode(&self) -> PolicyMode {
        match self {
            Self::Fast(_) => PolicyMode::Fast,
            Self::CompleteHand(_) => PolicyMode::CompleteHand,
            Self::SparseDelta(_) => PolicyMode::SparseDelta,
        }
    }

    fn stats_json(&self) -> Value {
        match self {
            Self::Fast(policy) => {
                let stats = policy.stats();
                json!({
                    "decisionRequests": stats.decision_requests,
                    "candidateEvaluations": stats.candidate_evaluations,
                    "replyRankEvaluations": stats.reply_rank_evaluations,
                    "fictionalContinuationStates": 0,
                })
            }
            Self::CompleteHand(policy) => complete_hand_stats_json(policy.stats()),
            Self::SparseDelta(policy) => complete_hand_stats_json(policy.stats()),
        }
    }
}

impl Model132PeggingPolicy for CalibrationPolicy {
    fn choose_action(&self, observation: &Model132Observation) -> Result<RankPegAction, String> {
        match self {
            Self::Fast(policy) => policy.choose_action(observation),
            Self::CompleteHand(policy) => policy.choose_action(observation),
            Self::SparseDelta(policy) => policy.choose_action(observation),
        }
    }
}

fn complete_hand_stats_json(stats: Model91PolicyStats) -> Value {
    json!({
        "decisionRequests": stats.decision_requests,
        "decisionCacheHits": stats.decision_cache_hits,
        "decisionCacheCapacityClears": stats.decision_cache_capacity_clears,
        "decisionCachePeakEntries": stats.decision_cache_peak_entries,
        "evaluatedDecisions": stats.evaluated_decisions,
        "posteriorRequests": stats.posterior_requests,
        "posteriorHandsGenerated": stats.posterior_hands_generated,
        "continuationStates": stats.random_future_states,
        "continuationCacheHits": stats.future_cache_hits,
        "continuationCacheEntries": stats.future_cache_entries,
        "continuationCacheCapacityClears": stats.future_cache_capacity_clears,
        "continuationCachePeakEntries": stats.future_cache_peak_entries,
    })
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
    fn by_card_ordinal(&self, category: &str) -> Result<[u32; 3], String> {
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
                    "Model 13.22 {category}/{ordinal} held-card decline counts do not sum"
                ));
            }
            if (row.observed_declines == 0) != row.held_given_decline_ppm.is_none() {
                return Err(format!(
                    "Model 13.22 {category}/{ordinal} heldGivenDeclinePpm is inconsistent with its observations"
                ));
            }
            if row
                .held_given_decline_ppm
                .is_some_and(|value| value > 1_000_000)
            {
                return Err(format!(
                    "Model 13.22 {category}/{ordinal} heldGivenDeclinePpm exceeds 1,000,000"
                ));
            }
            result[index] = row.multiplier_ppm.unwrap_or(self.multiplier_ppm);
        }
        Ok(result)
    }
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
struct DiscardHistogramFile {
    schema_version: u32,
    model_version: String,
    fallback_by_role: DiscardFallbackRows,
    roles: DiscardHistogramRoles,
}

#[derive(Debug, Deserialize)]
struct DiscardFallbackRows {
    dealer: BTreeMap<String, u64>,
    pone: BTreeMap<String, u64>,
}

#[derive(Debug, Deserialize)]
struct DiscardHistogramRoles {
    dealer: BTreeMap<String, BTreeMap<String, u64>>,
    pone: BTreeMap<String, BTreeMap<String, u64>>,
}

#[derive(Clone, Debug)]
struct DiscardVariant {
    ranks: [u8; RANKS],
    weight: u64,
}

#[derive(Clone, Debug)]
struct OpponentKeep {
    ranks: [u8; RANKS],
    weight: u64,
    discards: Vec<DiscardVariant>,
}

struct OpponentPriors {
    dealer: Vec<OpponentKeep>,
    pone: Vec<OpponentKeep>,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct WeightedSummary {
    own_points_x_weight: f64,
    opponent_points_x_weight: f64,
    weight: f64,
}

impl WeightedSummary {
    fn add(&mut self, own: u8, opponent: u8, weight: f64) -> Result<(), String> {
        self.own_points_x_weight += f64::from(own) * weight;
        self.opponent_points_x_weight += f64::from(opponent) * weight;
        self.weight += weight;
        if !self.own_points_x_weight.is_finite()
            || !self.opponent_points_x_weight.is_finite()
            || !self.weight.is_finite()
        {
            return Err("Model 13.22 floating score accumulator overflow".to_string());
        }
        Ok(())
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
    let mut policy = PolicyMode::Fast;
    let mut beliefs = None;
    let mut factors = None;
    let mut keep_prior = None;
    let mut discard_histograms = None;
    let mut keep_only_opponent_discards = false;
    let mut six_start = None;
    let mut six_count = None;
    let mut opponent_keeps_per_role = 1_usize;
    let mut opponent_keeps_per_role_set = false;
    let mut all_opponent_keeps = false;
    let mut discard_index = None;
    let mut cut_rank = None;
    let mut seed = 0x1322_0001_u64;
    let mut action_cache_limit = 1_000_000_usize;
    let mut evidence_cache_outcome_limit = 500_000_usize;
    let mut future_cache_limit = 2_000_000_usize;
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
            "--policy" => policy = PolicyMode::parse(&value(&mut index)?)?,
            "--beliefs" => beliefs = Some(PathBuf::from(value(&mut index)?)),
            "--factors" => factors = Some(PathBuf::from(value(&mut index)?)),
            "--keep-prior" => keep_prior = Some(PathBuf::from(value(&mut index)?)),
            "--discard-histograms" => discard_histograms = Some(PathBuf::from(value(&mut index)?)),
            "--keep-only-opponent-discards" => keep_only_opponent_discards = true,
            "--six-start" => six_start = Some(parse_usize(&value(&mut index)?, flag)?),
            "--six-count" => six_count = Some(parse_usize(&value(&mut index)?, flag)?),
            "--opponent-keeps-per-role" => {
                opponent_keeps_per_role = parse_usize(&value(&mut index)?, flag)?;
                opponent_keeps_per_role_set = true;
            }
            "--all-opponent-keeps" => all_opponent_keeps = true,
            "--discard-index" => discard_index = Some(parse_usize(&value(&mut index)?, flag)?),
            "--cut-rank" => {
                let parsed = parse_usize(&value(&mut index)?, flag)?;
                cut_rank = Some(
                    u8::try_from(parsed)
                        .map_err(|_| format!("invalid --cut-rank {parsed}: exceeds u8"))?,
                )
            }
            "--seed" => seed = parse_u64(&value(&mut index)?)?,
            "--action-cache-limit" => action_cache_limit = parse_usize(&value(&mut index)?, flag)?,
            "--evidence-cache-outcome-limit" => {
                evidence_cache_outcome_limit = parse_usize(&value(&mut index)?, flag)?
            }
            "--future-cache-limit" => future_cache_limit = parse_usize(&value(&mut index)?, flag)?,
            "--help" | "-h" => {
                println!(
                    "build_model1322_calibration --output DIR \
                     [--policy fast|complete-hand|sparse-delta] [--beliefs FILE] --factors FILE \
                     --keep-prior FILE (--discard-histograms FILE | \
                     --keep-only-opponent-discards) --six-start N --six-count N \
                     (--all-opponent-keeps | [--opponent-keeps-per-role N]) \
                     [--discard-index N] \
                     [--cut-rank 0..12] [--seed N] \
                     [--action-cache-limit N] [--evidence-cache-outcome-limit N] \
                     [--future-cache-limit N]"
                );
                process::exit(0);
            }
            _ => return Err(format!("unknown Model 13.22 calibration argument {flag}")),
        }
    }
    let config = Config {
        output: output.ok_or_else(|| "--output is required".to_string())?,
        policy,
        beliefs,
        factors: factors.ok_or_else(|| "--factors is required".to_string())?,
        keep_prior: keep_prior.ok_or_else(|| "--keep-prior is required".to_string())?,
        discard_histograms,
        six_start: six_start.ok_or_else(|| "--six-start is required".to_string())?,
        six_count: six_count.ok_or_else(|| "--six-count is required".to_string())?,
        opponent_keeps_per_role: if all_opponent_keeps {
            usize::MAX
        } else {
            opponent_keeps_per_role
        },
        all_opponent_keeps,
        discard_index,
        cut_rank,
        seed,
        action_cache_limit,
        evidence_cache_outcome_limit,
        future_cache_limit,
    };
    if config.six_count == 0
        || config.opponent_keeps_per_role == 0
        || config.six_start + config.six_count > CANONICAL_SIX_HANDS
        || config.cut_rank.is_some_and(|rank| rank as usize >= RANKS)
    {
        return Err("invalid Model 13.22 calibration range or opponent sample".to_string());
    }
    if all_opponent_keeps && opponent_keeps_per_role_set {
        return Err(
            "specify --all-opponent-keeps or --opponent-keeps-per-role, not both".to_string(),
        );
    }
    if keep_only_opponent_discards == config.discard_histograms.is_some() {
        return Err(
            "specify exactly one of --discard-histograms or --keep-only-opponent-discards"
                .to_string(),
        );
    }
    if matches!(
        config.policy,
        PolicyMode::CompleteHand | PolicyMode::SparseDelta
    ) && config.beliefs.is_none()
    {
        return Err("--beliefs is required with complete-hand policies".to_string());
    }
    Ok(config)
}

fn run(config: Config) -> Result<(), String> {
    fs::create_dir_all(&config.output)
        .map_err(|error| format!("create {} failed: {error}", config.output.display()))?;
    let factor_asset: FactorAsset = serde_json::from_slice(
        &fs::read(&config.factors)
            .map_err(|error| format!("read {} failed: {error}", config.factors.display()))?,
    )
    .map_err(|error| format!("parse {} failed: {error}", config.factors.display()))?;
    if factor_asset.schema_version != 3 || factor_asset.model_version != "13.22" {
        return Err("unsupported Model 13.22 decline-factor asset".to_string());
    }
    let factors = Model1322DeclineFactors {
        three_card_run_ppm: factor_asset
            .factors
            .three_card_run
            .by_card_ordinal("threeCardRun")?,
        four_plus_card_run_ppm: factor_asset
            .factors
            .four_plus_card_run
            .by_card_ordinal("fourPlusCardRun")?,
        pair_ppm: factor_asset.factors.pair.by_card_ordinal("pair")?,
        pair_royal_after_pair_ppm: factor_asset
            .factors
            .pair_royal_after_pair
            .by_card_ordinal("pairRoyalAfterPair")?,
        four_of_a_kind_after_pair_royal_ppm: factor_asset
            .factors
            .four_of_a_kind_after_pair_royal
            .by_card_ordinal("fourOfAKindAfterPairRoyal")?,
        safe_pair_ppm: factor_asset.factors.safe_pair.by_card_ordinal("safePair")?,
        safe_pair_royal_ppm: factor_asset
            .factors
            .safe_pair_royal
            .by_card_ordinal("safePairRoyal")?,
    };
    let opponent_priors =
        load_opponent_priors(&config.keep_prior, config.discard_histograms.as_deref())?;
    let policy =
        match config.policy {
            PolicyMode::Fast => CalibrationPolicy::Fast(Model1322FastPolicy::new(factors)?),
            PolicyMode::CompleteHand => {
                let beliefs_path = config.beliefs.as_ref().ok_or_else(|| {
                    "--beliefs is required with --policy complete-hand".to_string()
                })?;
                let beliefs = Model91EmpiricalBeliefs::load(beliefs_path)?;
                CalibrationPolicy::CompleteHand(Model1322HeuristicPolicy::new(
                    Some(beliefs),
                    factors,
                    config.action_cache_limit,
                    config.future_cache_limit,
                )?)
            }
            PolicyMode::SparseDelta => {
                let beliefs_path = config.beliefs.as_ref().ok_or_else(|| {
                    "--beliefs is required with --policy sparse-delta".to_string()
                })?;
                let beliefs = Model91EmpiricalBeliefs::load(beliefs_path)?;
                CalibrationPolicy::SparseDelta(Model911Policy::new_with_evidence_cache(
                    Some(beliefs),
                    factors,
                    config.action_cache_limit,
                    config.evidence_cache_outcome_limit,
                    config.future_cache_limit,
                )?)
            }
        };
    let six_hands = enumerate_rank_count_keys(6)
        .iter()
        .map(|key| rank_counts_from_key(key))
        .collect::<Result<Vec<_>, _>>()?;
    if six_hands.len() != CANONICAL_SIX_HANDS {
        return Err(format!(
            "canonical six-card count is {}; expected {CANONICAL_SIX_HANDS}",
            six_hands.len()
        ));
    }
    let started = Instant::now();
    let mut completed_roots = 0_usize;
    let mut total_rollouts = 0_u64;
    let mut total_physical_cut_worlds = 0_u64;
    let mut projected_full_rollouts_sum = 0_f64;
    write_status(
        &config,
        "running",
        completed_roots,
        total_rollouts,
        total_physical_cut_worlds,
        projected_full_rollouts_sum,
        started.elapsed().as_secs_f64(),
        &policy,
    )?;

    for six_id in config.six_start..config.six_start + config.six_count {
        let output_path = config.output.join(format!("root-{six_id:05}.json"));
        if output_path.exists() {
            let existing: Value =
                serde_json::from_slice(&fs::read(&output_path).map_err(|error| {
                    format!(
                        "read completed root {} failed: {error}",
                        output_path.display()
                    )
                })?)
                .map_err(|error| {
                    format!(
                        "parse completed root {} failed: {error}",
                        output_path.display()
                    )
                })?;
            total_rollouts += existing["rollouts"].as_u64().unwrap_or(0);
            total_physical_cut_worlds += existing["physicalCutWorlds"].as_u64().unwrap_or(0);
            projected_full_rollouts_sum += existing["projectedFullRolloutsFromRoot"]
                .as_f64()
                .unwrap_or(0.0);
            completed_roots += 1;
            continue;
        }
        let root = build_root(&config, six_id, &six_hands, &opponent_priors, &policy)?;
        total_rollouts += root["rollouts"].as_u64().unwrap_or(0);
        total_physical_cut_worlds += root["physicalCutWorlds"].as_u64().unwrap_or(0);
        projected_full_rollouts_sum += root["projectedFullRolloutsFromRoot"]
            .as_f64()
            .unwrap_or(0.0);
        atomic_write_json(&output_path, &root)?;
        completed_roots += 1;
        write_status(
            &config,
            "running",
            completed_roots,
            total_rollouts,
            total_physical_cut_worlds,
            projected_full_rollouts_sum,
            started.elapsed().as_secs_f64(),
            &policy,
        )?;
    }
    write_status(
        &config,
        "complete",
        completed_roots,
        total_rollouts,
        total_physical_cut_worlds,
        projected_full_rollouts_sum,
        started.elapsed().as_secs_f64(),
        &policy,
    )?;
    atomic_write_json(
        &config.output.join("manifest.json"),
        &json!({
            "schemaVersion": 1,
            "modelVersion": "13.22",
            "status": "complete",
            "sixCardRootRange": {"start": config.six_start, "count": config.six_count},
            "opponentKeepSelection": if config.all_opponent_keeps { "all-compatible" } else { "deterministic-sample" },
            "opponentKeepsPerRole": if config.all_opponent_keeps { None } else { Some(config.opponent_keeps_per_role) },
            "discardIndex": config.discard_index,
            "cutRank": config.cut_rank,
            "seed": format!("0x{:016x}", config.seed),
            "cutSemantics": if config.discard_histograms.is_some() {
                "all physically available cut ranks after own six cards plus opponent keep and empirical private discard; score aggregates weighted by remaining rank multiplicity"
            } else {
                "keep-only approximation: cut ranks are weighted by physical multiplicity after own six cards plus opponent keep; the unknown opponent private discard is not guessed or removed"
            },
            "opponentKeepPrior": config.keep_prior,
            "opponentDiscardHistograms": config.discard_histograms,
            "completeHandBeliefs": if matches!(policy.mode(), PolicyMode::CompleteHand | PolicyMode::SparseDelta) { config.beliefs.as_ref() } else { None },
            "opponentPrivateDiscardMode": opponent_discard_mode(&config),
            "pairedWorldSemantics": "one rollout returns both terminal totals; the actor row stores own and opponent points without a reversed duplicate rollout",
            "offlineEnumeration": "the builder knows both exact hands for state advancement and terminal scoring; every modeled move is selected only from the acting player's legal observation, so exact-world enumeration does not cause strategy fusion",
            "leadLookup": "for each sampled pone six-card/discard context, thirteen rank-indexed bit masks identify cuts for which that rank is the selected opening lead",
            "goEvidence": "opponent go sets every rank legal at that count to zero likelihood",
            "declineEvidence": config.factors,
            "declineEvidenceCardOrdinals": ["first", "second", "third"],
            "heldGivenDeclineEvidence": "the schema-3 asset stores P(card held | observed non-scoring decline) plus the likelihood multiplier used to update the policy's current prior",
            "declineEvidenceConfounders": "an observed alternative that scores is a competing choice and supplies no decline evidence",
            "safeRetaliationEvidence": "retaliation is impossible when the needed card is known dead, cannot fit under 31, or the other player already said go in the round",
            "peggingPolicyMode": policy.mode().name(),
            "peggingPolicy": policy_description(policy.mode()),
            "runtimePolicyContract": runtime_policy_contract(policy.mode()),
            "cache": {
                "actionCacheLimit": if matches!(policy.mode(), PolicyMode::CompleteHand | PolicyMode::SparseDelta) { Some(config.action_cache_limit) } else { None },
                "evidenceCacheOutcomeLimit": if policy.mode() == PolicyMode::SparseDelta { Some(config.evidence_cache_outcome_limit) } else { None },
                "continuationCacheLimit": if matches!(policy.mode(), PolicyMode::CompleteHand | PolicyMode::SparseDelta) { Some(config.future_cache_limit) } else { None },
                "scope": "a shared immutable rank-hand compatibility index plus streaming in-memory action and continuation caches inside one builder worker; action keys contain only the acting player's legal observation and beliefs, no cache is serialized into the model asset, and one recursive decision may temporarily exceed the continuation capacity target",
                "worldTraversal": "process exact worlds in deterministic input order; the first occurrence of a legal observation computes and memoizes its action, and later matching observations reuse it without materializing observation groups or posterior vectors",
                "inMemoryContinuationStateMemo": matches!(policy.mode(), PolicyMode::CompleteHand | PolicyMode::SparseDelta),
                "nestedContinuationTree": false,
                "durableObservationActionTree": false,
            },
            "calibrationOnly": !config.all_opponent_keeps,
            "productionCaveat": if config.all_opponent_keeps {
                "this shard exhaustively executes every compatible stored opponent keep/private-discard/cut world; completed shards still require deterministic packing before runtime use"
            } else if config.discard_histograms.is_some() {
                "sampled compatible opponent keeps execute every supported conditional discard and cut; exact per-root workload enumerates the complete stored priors, but this remains a timing calibration rather than a production asset"
            } else {
                "sampled compatible opponent keeps execute one under-informed keep-only opponent policy across every available cut; exact per-root workload enumerates the complete keep priors, but this remains a timing calibration rather than a production asset"
            },
        }),
    )?;
    Ok(())
}

fn build_root(
    config: &Config,
    six_id: usize,
    six_hands: &[[u8; RANKS]],
    priors: &OpponentPriors,
    policy: &CalibrationPolicy,
) -> Result<Value, String> {
    let own_six = six_hands[six_id];
    let own_discards = selected_discards(&own_six, config.discard_index)?;
    let compatible_pone_keeps = adjusted_opponents(&own_six, &priors.pone)?;
    let compatible_dealer_keeps = adjusted_opponents(&own_six, &priors.dealer)?;
    let exact_dealer_worlds =
        exact_role_rollouts(&own_six, &compatible_pone_keeps, config.cut_rank)
            .saturating_mul(own_discards.len() as u64);
    let exact_pone_worlds =
        exact_role_rollouts(&own_six, &compatible_dealer_keeps, config.cut_rank)
            .saturating_mul(own_discards.len() as u64);
    let exact_root_rollouts = exact_dealer_worlds.saturating_add(exact_pone_worlds);
    let selected_pone_keeps = sample_opponents(
        &compatible_pone_keeps,
        config.opponent_keeps_per_role,
        mix64(config.seed ^ six_id as u64 ^ 0xd3a1_e200),
    );
    let selected_dealer_keeps = sample_opponents(
        &compatible_dealer_keeps,
        config.opponent_keeps_per_role,
        mix64(config.seed ^ six_id as u64 ^ 0xa90e_0000),
    );
    let mut dealer_rows = BTreeMap::<String, WeightedSummary>::new();
    let mut pone_rows = BTreeMap::<String, WeightedSummary>::new();
    let mut lead_cut_masks = BTreeMap::<String, [u16; RANKS]>::new();
    let mut rollouts = 0_u64;
    let mut physical_cut_worlds = 0_u64;

    for own_discard in &own_discards {
        let own_keep = subtract(&own_six, own_discard)?;
        let dealer_key = format!(
            "{}:{}:dealer",
            rank_count_key(&own_six),
            rank_count_key(own_discard)
        );
        run_sampled_role(
            Role::Dealer,
            &own_six,
            own_keep,
            *own_discard,
            &dealer_key,
            &selected_pone_keeps,
            config.cut_rank,
            policy,
            &mut dealer_rows,
            &mut lead_cut_masks,
            &mut rollouts,
            &mut physical_cut_worlds,
        )?;
        let pone_key = format!(
            "{}:{}:pone",
            rank_count_key(&own_six),
            rank_count_key(own_discard)
        );
        run_sampled_role(
            Role::Pone,
            &own_six,
            own_keep,
            *own_discard,
            &pone_key,
            &selected_dealer_keeps,
            config.cut_rank,
            policy,
            &mut pone_rows,
            &mut lead_cut_masks,
            &mut rollouts,
            &mut physical_cut_worlds,
        )?;
    }
    Ok(json!({
        "schemaVersion": 1,
        "modelVersion": "13.22",
        "sixId": six_id,
        "ownSix": rank_count_key(&own_six),
        "compatibleOpponentKeeps": {
            "dealer": compatible_dealer_keeps.len(),
            "pone": compatible_pone_keeps.len(),
        },
        "sampledOpponentKeeps": {
            "dealer": selected_dealer_keeps.len(),
            "pone": selected_pone_keeps.len(),
        },
        "rollouts": rollouts,
        "physicalCutWorlds": physical_cut_worlds,
        "exactFullRolloutsForRootByOwnRole": {
            "dealer": exact_dealer_worlds,
            "pone": exact_pone_worlds,
        },
        "exactFullRolloutsForRoot": exact_root_rollouts,
        "projectedFullRolloutsFromRoot": exact_root_rollouts as f64 * CANONICAL_SIX_HANDS as f64,
        "workloadSemantics": if config.discard_histograms.is_some() {
            "own six/discard/role rows times every physically compatible empirical opponent keep/private-discard cell and available cut rank"
        } else {
            "own six/discard/role rows times every physically compatible empirical opponent four-card keep and available cut rank; opponent private discards are omitted"
        },
        "dealerRows": dealer_rows,
        "poneRows": pone_rows,
        "poneLeadCutMasks": lead_cut_masks,
    }))
}

#[allow(clippy::too_many_arguments)]
fn run_sampled_role(
    own_role: Role,
    own_six: &[u8; RANKS],
    own_keep: [u8; RANKS],
    own_discard: [u8; RANKS],
    row_key: &str,
    opponents: &[OpponentKeep],
    cut_rank: Option<u8>,
    policy: &CalibrationPolicy,
    rows: &mut BTreeMap<String, WeightedSummary>,
    lead_cut_masks: &mut BTreeMap<String, [u16; RANKS]>,
    rollouts: &mut u64,
    physical_cut_worlds: &mut u64,
) -> Result<(), String> {
    if let CalibrationPolicy::SparseDelta(sparse_policy) = policy {
        return run_sparse_role(
            own_role,
            own_six,
            own_keep,
            own_discard,
            row_key,
            opponents,
            cut_rank,
            sparse_policy,
            policy,
            rows,
            lead_cut_masks,
            rollouts,
            physical_cut_worlds,
        );
    }
    let cut_start = cut_rank.unwrap_or(0);
    let cut_end = cut_rank.map_or(RANKS as u8, |rank| rank + 1);
    let summary = rows.entry(row_key.to_string()).or_default();
    let mut row_lead_masks = [0_u16; RANKS];
    for cut in cut_start..cut_end {
        let mut found_world = false;
        for opponent in opponents {
            for opponent_discard in &opponent.discards {
                let copies = cut_copies(own_six, &opponent.ranks, &opponent_discard.ranks, cut);
                if copies == 0 {
                    continue;
                }
                let (hands, discards) = match own_role {
                    Role::Dealer => (
                        [own_keep, opponent.ranks],
                        [own_discard, opponent_discard.ranks],
                    ),
                    Role::Pone => (
                        [opponent.ranks, own_keep],
                        [opponent_discard.ranks, own_discard],
                    ),
                };
                let world = Model132World {
                    hands,
                    own_discards: discards,
                };
                if !found_world && own_role == Role::Pone {
                    let lead = opening_lead(&world, cut, policy)?;
                    row_lead_masks[lead as usize] |= 1_u16 << cut;
                }
                found_world = true;
                let weight =
                    opponent.weight as f64 * opponent_discard.weight as f64 * f64::from(copies);
                let (dealer_points, pone_points) = rollout_model132_world(
                    world.hands,
                    world.own_discards,
                    Some(cut),
                    PegSeat::Zero,
                    policy,
                )?;
                let (own_points, opponent_points) = match own_role {
                    Role::Dealer => (dealer_points, pone_points),
                    Role::Pone => (pone_points, dealer_points),
                };
                summary.add(own_points, opponent_points, weight)?;
                *rollouts = rollouts.saturating_add(1);
                *physical_cut_worlds = physical_cut_worlds.saturating_add(u64::from(copies));
            }
        }
    }
    if own_role == Role::Pone {
        lead_cut_masks.insert(row_key.to_string(), row_lead_masks);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_sparse_role(
    own_role: Role,
    own_six: &[u8; RANKS],
    own_keep: [u8; RANKS],
    own_discard: [u8; RANKS],
    row_key: &str,
    opponents: &[OpponentKeep],
    cut_rank: Option<u8>,
    sparse_policy: &Model911Policy,
    policy: &CalibrationPolicy,
    rows: &mut BTreeMap<String, WeightedSummary>,
    lead_cut_masks: &mut BTreeMap<String, [u16; RANKS]>,
    rollouts: &mut u64,
    physical_cut_worlds: &mut u64,
) -> Result<(), String> {
    let cut_start = cut_rank.unwrap_or(0);
    let cut_end = cut_rank.map_or(RANKS as u8, |rank| rank + 1);
    let summary = rows.entry(row_key.to_string()).or_default();
    let mut row_lead_masks = [0_u16; RANKS];
    let mut lead_found_for_cut = [false; RANKS];
    let traces = opponents
        .iter()
        .map(|opponent| {
            let hands = match own_role {
                Role::Dealer => [own_keep, opponent.ranks],
                Role::Pone => [opponent.ranks, own_keep],
            };
            Ok((
                opponent,
                hands,
                trace_model911_pair(hands[0], hands[1], sparse_policy)?,
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    for cut in cut_start..cut_end {
        for (opponent, hands, trace) in &traces {
            if !opponent
                .discards
                .iter()
                .any(|discard| cut_copies(own_six, &opponent.ranks, &discard.ranks, cut) > 0)
            {
                continue;
            }
            let own_actor = match own_role {
                Role::Dealer => PegSeat::Zero,
                Role::Pone => PegSeat::One,
            };
            let opponent_actor = own_actor.other();
            let own_screen =
                screen_model1322_actor_context(trace, own_actor, own_discard, cut, sparse_policy)?;
            for opponent_discard in &opponent.discards {
                let copies = cut_copies(own_six, &opponent.ranks, &opponent_discard.ranks, cut);
                if copies == 0 {
                    continue;
                }
                let discards = match own_role {
                    Role::Dealer => [own_discard, opponent_discard.ranks],
                    Role::Pone => [opponent_discard.ranks, own_discard],
                };
                let opponent_screen = screen_model1322_actor_context(
                    trace,
                    opponent_actor,
                    opponent_discard.ranks,
                    cut,
                    sparse_policy,
                )?;
                if own_role == Role::Pone && !lead_found_for_cut[cut as usize] {
                    let lead = opening_lead(
                        &Model132World {
                            hands: *hands,
                            own_discards: discards,
                        },
                        cut,
                        policy,
                    )?;
                    row_lead_masks[lead as usize] |= 1_u16 << cut;
                    lead_found_for_cut[cut as usize] = true;
                }
                let screens = match own_actor {
                    PegSeat::Zero => [own_screen, opponent_screen],
                    PegSeat::One => [opponent_screen, own_screen],
                };
                let corrected = rollout_model1322_from_actor_screens(
                    trace,
                    discards,
                    cut,
                    screens,
                    sparse_policy,
                )?
                .outcome;
                let weight =
                    opponent.weight as f64 * opponent_discard.weight as f64 * f64::from(copies);
                let (own_points, opponent_points) = match own_role {
                    Role::Dealer => corrected,
                    Role::Pone => (corrected.1, corrected.0),
                };
                summary.add(own_points, opponent_points, weight)?;
                *rollouts = rollouts.saturating_add(1);
                *physical_cut_worlds = physical_cut_worlds.saturating_add(u64::from(copies));
            }
        }
    }
    if own_role == Role::Pone {
        lead_cut_masks.insert(row_key.to_string(), row_lead_masks);
    }
    Ok(())
}

fn opening_lead(world: &Model132World, cut: u8, policy: &CalibrationPolicy) -> Result<u8, String> {
    let state = RankPegState {
        hands: world.hands,
        own_discards: world.own_discards,
        turn_rank: cut,
        scores: [0, 0],
        dealer: PegSeat::Zero,
        current: PegSeat::One,
        plays: Vec::new(),
        count: 0,
        go_player: None,
        last_player: None,
        history: Vec::new(),
        winner: None,
        complete: false,
    };
    let legal = state.legal_actions();
    let action = if legal.len() == 1 {
        legal[0]
    } else {
        let observation = Model132Observation::from_state(&state, PegSeat::One)?;
        policy.choose_action(&observation)?
    };
    match action {
        RankPegAction::Play(rank) => Ok(rank),
        RankPegAction::Go => Err("Model 13.22 opening lead returned go".to_string()),
    }
}

fn write_status(
    config: &Config,
    state: &str,
    completed_roots: usize,
    rollouts: u64,
    physical_cut_worlds: u64,
    projected_sum: f64,
    elapsed: f64,
    policy: &CalibrationPolicy,
) -> Result<(), String> {
    let rate = if elapsed > 0.0 {
        rollouts as f64 / elapsed
    } else {
        0.0
    };
    let projected_full_rollouts = if completed_roots > 0 {
        projected_sum / completed_roots as f64
    } else {
        0.0
    };
    let projected_cpu_seconds = if rate > 0.0 {
        projected_full_rollouts / rate
    } else {
        0.0
    };
    atomic_write_json(
        &config.output.join("status.json"),
        &json!({
            "status": state,
            "modelVersion": "13.22",
            "completedSixCardRoots": completed_roots,
            "targetSixCardRoots": config.six_count,
            "rollouts": rollouts,
            "physicalCutWorlds": physical_cut_worlds,
            "elapsedSeconds": elapsed,
            "rolloutsPerSecond": rate,
            "projectedFullRollouts": projected_full_rollouts,
            "projectedFullCpuSeconds": projected_cpu_seconds,
            "projectedFullWallSecondsAt10Cores": projected_cpu_seconds / 10.0,
            "policyMode": policy.mode().name(),
            "cacheLimits": if matches!(policy.mode(), PolicyMode::CompleteHand | PolicyMode::SparseDelta) {
                json!({
                    "action": config.action_cache_limit,
                    "evidenceOutcomes": if policy.mode() == PolicyMode::SparseDelta { Some(config.evidence_cache_outcome_limit) } else { None },
                    "continuation": config.future_cache_limit,
                })
            } else {
                Value::Null
            },
            "policyStats": policy.stats_json(),
        }),
    )
}

fn policy_description(mode: PolicyMode) -> &'static str {
    match mode {
        PolicyMode::Fast => "Model1322FastPolicy: bounded public-information tactical action scorer with go/decline likelihood evidence; no nested fictional-world solve",
        PolicyMode::CompleteHand => "Model1322HeuristicPolicy: Model 9.1 complete compatible-hand enumeration and exhaustive EV continuation, updated with the actor's legally known discards/cut plus Model 13.22 go and decline evidence",
        PolicyMode::SparseDelta => "Model 9.11 context-free keep-pair trace plus exact Model 13.22 dead-card reweighting; unchanged actions reuse the baseline terminal cell and only the suffix after the first changed action is replayed",
    }
}

fn runtime_policy_contract(mode: PolicyMode) -> &'static str {
    match mode {
        PolicyMode::Fast => "the released Model 13.22 must load the same schema-3 evidence asset and execute Model1322FastPolicy, including go exclusions and decline updates, so live play matches the strategy predicted by this builder",
        PolicyMode::CompleteHand => "the released Model 13.22 must execute the same complete-compatible-hand Model1322HeuristicPolicy from only the acting player's legal observation, including the same schema-3 go/decline updates; builder-only knowledge is used solely to enumerate and score exact training worlds",
        PolicyMode::SparseDelta => "Model 9.11 and Model 13.22 share one complete-compatible-hand executable policy; runtime enables actor-owned discards and cut while the reusable baseline omits them, and both apply identical schema-3 go/decline evidence",
    }
}

fn load_opponent_priors(
    keep_prior_path: &Path,
    discard_histogram_path: Option<&Path>,
) -> Result<OpponentPriors, String> {
    let keep_prior: KeepPriorFile = serde_json::from_slice(
        &fs::read(keep_prior_path)
            .map_err(|error| format!("read {} failed: {error}", keep_prior_path.display()))?,
    )
    .map_err(|error| format!("parse {} failed: {error}", keep_prior_path.display()))?;
    if keep_prior.version != 1 {
        return Err(format!(
            "unsupported opponent keep-prior version {}",
            keep_prior.version
        ));
    }
    let KeepPriorRoles { dealer, pone } = keep_prior.roles;
    let Some(discard_histogram_path) = discard_histogram_path else {
        return Ok(OpponentPriors {
            dealer: keep_only_priors(dealer)?,
            pone: keep_only_priors(pone)?,
        });
    };
    let histograms: DiscardHistogramFile =
        serde_json::from_slice(&fs::read(discard_histogram_path).map_err(|error| {
            format!("read {} failed: {error}", discard_histogram_path.display())
        })?)
        .map_err(|error| format!("parse {} failed: {error}", discard_histogram_path.display()))?;
    if histograms.schema_version != 1 || histograms.model_version != "13.22" {
        return Err("unsupported Model 13.22 opponent-discard histogram".to_string());
    }
    Ok(OpponentPriors {
        dealer: join_prior_and_histograms(
            dealer,
            histograms.roles.dealer,
            histograms.fallback_by_role.dealer,
        )?,
        pone: join_prior_and_histograms(
            pone,
            histograms.roles.pone,
            histograms.fallback_by_role.pone,
        )?,
    })
}

fn keep_only_priors(prior: BTreeMap<String, u64>) -> Result<Vec<OpponentKeep>, String> {
    prior
        .into_iter()
        .map(|(keep_key, weight)| {
            let ranks = rank_counts_from_key(&keep_key)?;
            if rank_count_total(&ranks) != 4 || weight == 0 {
                return Err(format!("invalid opponent keep prior {keep_key}={weight}"));
            }
            Ok(OpponentKeep {
                ranks,
                weight,
                discards: vec![DiscardVariant {
                    ranks: [0_u8; RANKS],
                    weight: 1,
                }],
            })
        })
        .collect()
}

fn opponent_discard_mode(config: &Config) -> &'static str {
    if config.discard_histograms.is_some() {
        "conditional-histogram"
    } else {
        "keep-only-omitted"
    }
}

fn join_prior_and_histograms(
    prior: BTreeMap<String, u64>,
    mut histograms: BTreeMap<String, BTreeMap<String, u64>>,
    fallback: BTreeMap<String, u64>,
) -> Result<Vec<OpponentKeep>, String> {
    prior
        .into_iter()
        .map(|(keep_key, weight)| {
            let ranks = rank_counts_from_key(&keep_key)?;
            if rank_count_total(&ranks) != 4 || weight == 0 {
                return Err(format!("invalid opponent keep prior {keep_key}={weight}"));
            }
            let source = histograms
                .remove(&keep_key)
                .unwrap_or_else(|| fallback.clone());
            let discards = source
                .into_iter()
                .map(|(discard_key, discard_weight)| {
                    let discard = rank_counts_from_key(&discard_key)?;
                    if rank_count_total(&discard) != 2 || discard_weight == 0 {
                        return Err(format!(
                            "invalid opponent discard histogram {discard_key}={discard_weight}"
                        ));
                    }
                    Ok(DiscardVariant {
                        ranks: discard,
                        weight: discard_weight,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            if discards.is_empty() {
                return Err(format!("opponent keep {keep_key} has no discard variants"));
            }
            Ok(OpponentKeep {
                ranks,
                weight,
                discards,
            })
        })
        .collect()
}

fn adjusted_opponents(
    own_six: &[u8; RANKS],
    prior: &[OpponentKeep],
) -> Result<Vec<OpponentKeep>, String> {
    let mut available_for_keep = [4_u8; RANKS];
    for rank in 0..RANKS {
        available_for_keep[rank] = available_for_keep[rank]
            .checked_sub(own_six[rank])
            .ok_or_else(|| "own six-card hand exceeds deck availability".to_string())?;
    }
    let mut result = Vec::new();
    for opponent in prior {
        let keep_weight =
            adjusted_keep_weight(opponent.weight, &opponent.ranks, &available_for_keep)?;
        if keep_weight == 0 {
            continue;
        }
        let mut actual_available = [0_u8; RANKS];
        let mut baseline_available = [0_u8; RANKS];
        for rank in 0..RANKS {
            baseline_available[rank] = 4_u8
                .checked_sub(opponent.ranks[rank])
                .ok_or_else(|| "opponent keep exceeds deck availability".to_string())?;
            actual_available[rank] = baseline_available[rank]
                .checked_sub(own_six[rank])
                .ok_or_else(|| {
                    "own six plus opponent keep exceeds deck availability".to_string()
                })?;
        }
        let discards = opponent
            .discards
            .iter()
            .filter_map(|discard| {
                let baseline = rank_combination_count(&discard.ranks, &baseline_available).max(0.0);
                let actual = rank_combination_count(&discard.ranks, &actual_available).max(0.0);
                if baseline == 0.0 || actual == 0.0 {
                    return None;
                }
                let adjusted = (discard.weight as f64 * actual / baseline).round() as u64;
                (adjusted > 0).then_some(DiscardVariant {
                    ranks: discard.ranks,
                    weight: adjusted,
                })
            })
            .collect::<Vec<_>>();
        if !discards.is_empty() {
            result.push(OpponentKeep {
                ranks: opponent.ranks,
                weight: keep_weight,
                discards,
            });
        }
    }
    Ok(result)
}

fn exact_role_rollouts(
    own_six: &[u8; RANKS],
    opponents: &[OpponentKeep],
    cut_rank: Option<u8>,
) -> u64 {
    opponents
        .iter()
        .flat_map(|opponent| {
            opponent.discards.iter().map(|discard| {
                let cut_start = cut_rank.unwrap_or(0);
                let cut_end = cut_rank.map_or(RANKS as u8, |rank| rank + 1);
                (cut_start..cut_end)
                    .filter(|cut| cut_copies(own_six, &opponent.ranks, &discard.ranks, *cut) > 0)
                    .count() as u64
            })
        })
        .sum()
}

fn selected_discards(
    own_six: &[u8; RANKS],
    discard_index: Option<usize>,
) -> Result<Vec<[u8; RANKS]>, String> {
    let discards = discards_from_six(own_six);
    let Some(discard_index) = discard_index else {
        return Ok(discards);
    };
    discards
        .get(discard_index)
        .copied()
        .map(|discard| vec![discard])
        .ok_or_else(|| {
            format!(
                "discard index {discard_index} is out of range for {} candidates",
                discards.len()
            )
        })
}

fn sample_opponents(opponents: &[OpponentKeep], count: usize, seed: u64) -> Vec<OpponentKeep> {
    let indexes = (0..opponents.len()).collect::<Vec<_>>();
    spread_sample(&indexes, count.min(indexes.len()), seed)
        .into_iter()
        .map(|index| opponents[index].clone())
        .collect()
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

fn spread_sample(values: &[usize], count: usize, seed: u64) -> Vec<usize> {
    if count >= values.len() {
        return values.to_vec();
    }
    let offset = seed as usize % values.len();
    (0..count)
        .map(|index| values[(offset + index * values.len() / count) % values.len()])
        .collect()
}

fn mix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn parse_usize(value: &str, label: &str) -> Result<usize, String> {
    value
        .parse()
        .map_err(|error| format!("invalid {label} {value}: {error}"))
}

fn parse_u64(value: &str) -> Result<u64, String> {
    if let Some(hex) = value.strip_prefix("0x") {
        u64::from_str_radix(hex, 16).map_err(|error| format!("invalid seed {value}: {error}"))
    } else {
        value
            .parse()
            .map_err(|error| format!("invalid seed {value}: {error}"))
    }
}

fn atomic_write_json(path: &Path, value: &Value) -> Result<(), String> {
    let temporary = path.with_extension(format!("tmp-{}", process::id()));
    let mut bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("serialize {} failed: {error}", path.display()))?;
    bytes.push(b'\n');
    fs::write(&temporary, bytes)
        .map_err(|error| format!("write {} failed: {error}", temporary.display()))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("replace {} failed: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ranks(entries: &[(usize, u8)]) -> [u8; RANKS] {
        let mut result = [0_u8; RANKS];
        for (rank, count) in entries {
            result[*rank] = *count;
        }
        result
    }

    #[test]
    fn cut_availability_removes_opponent_private_discards() {
        let own_six = ranks(&[(4, 2), (5, 4)]);
        let opponent_keep = ranks(&[(4, 1), (6, 3)]);
        let opponent_discard = ranks(&[(4, 1), (7, 1)]);
        assert_eq!(
            cut_copies(&own_six, &opponent_keep, &opponent_discard, 4),
            0
        );
        assert_eq!(
            cut_copies(&own_six, &opponent_keep, &opponent_discard, 7),
            3
        );
    }

    #[test]
    fn exact_workload_counts_each_supported_cut_rank_once() {
        let own_six = ranks(&[(0, 4), (1, 2)]);
        let opponent = OpponentKeep {
            ranks: ranks(&[(2, 4)]),
            weight: 1,
            discards: vec![DiscardVariant {
                ranks: ranks(&[(3, 2)]),
                weight: 1,
            }],
        };
        assert_eq!(exact_role_rollouts(&own_six, &[opponent.clone()], None), 11);
        assert_eq!(exact_role_rollouts(&own_six, &[opponent], Some(0)), 0);
    }

    #[test]
    fn keep_only_prior_uses_one_empty_private_discard() {
        let keep = ranks(&[(2, 2), (6, 1), (12, 1)]);
        let mut prior = BTreeMap::new();
        prior.insert(rank_count_key(&keep), 17);

        let opponents = keep_only_priors(prior).unwrap();

        assert_eq!(opponents.len(), 1);
        assert_eq!(opponents[0].ranks, keep);
        assert_eq!(opponents[0].weight, 17);
        assert_eq!(opponents[0].discards.len(), 1);
        assert_eq!(opponents[0].discards[0].ranks, [0_u8; RANKS]);
        assert_eq!(opponents[0].discards[0].weight, 1);
    }

    #[test]
    fn throughput_probe_selects_one_discard_candidate() {
        let own_six = ranks(&[(0, 2), (1, 2), (2, 2)]);
        let all = selected_discards(&own_six, None).unwrap();
        let selected = selected_discards(&own_six, Some(1)).unwrap();

        assert_eq!(selected, vec![all[1]]);
        assert!(selected_discards(&own_six, Some(all.len())).is_err());
    }
}
