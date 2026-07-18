use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use crate::artifacts::{
    CribRankDiscardTables, CribTripolicyTable, EmpiricalDiscardKeepTable, EmpiricalEntry,
    EmpiricalRoleTable, Model13HoldTable, PairwiseTable, TripolicyPolicy,
};
use crate::board::{
    next_perspective_role, next_score_phase, score_phase_average,
    score_phase_distribution_for_phase, BoardModel, Role, ScorePhase,
};
use crate::cards::{
    cards_for_rank_counts, cards_for_rank_counts_for_scoring, cards_from_ids, full_deck,
    legal_peg_ranks, peg_card_for_rank, rank_combination_count, rank_count_key, rank_count_total,
    rank_counts, remaining_rank_counts, score_count, score_flush_and_right_jack, score_hand,
    score_hand_rank_only, Card,
};
use crate::information_set::{InfoActor, PolicyInformationSetKey, PolicyRankObservation};
use crate::model_id::{
    MODEL_13_0, MODEL_14_3, MODEL_14_8, MODEL_14_8_1, MODEL_15_0, MODEL_15_1, MODEL_15_2,
    MODEL_16_0,
};
use crate::policy::PolicyArtifact;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecisionKind {
    Discard,
    Peg,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PlayerKey {
    Human,
    Ai,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Model16PolicyMode {
    #[default]
    Argmax,
    Sample,
    Fallback,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Model16PolicySource {
    Learned,
    Fallback,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Model16PolicyDecision {
    pub source: Model16PolicySource,
    pub confidence: Option<u32>,
    pub selected_weight: Option<u16>,
}

#[derive(Clone, Debug)]
pub struct DecisionInput {
    pub kind: DecisionKind,
    pub model: String,
    pub player: PlayerKey,
    pub role: Role,
    pub ai_score: i32,
    pub human_score: i32,
    pub ai_hand: Vec<Card>,
    pub ai_table: Vec<Card>,
    pub human_table: Vec<Card>,
    pub human_hand_count: usize,
    /// The acting player's own two discards. Opponent crib cards are hidden
    /// during pegging and must never enter a decision input.
    pub own_discards: Vec<Card>,
    pub turn_card: Card,
    pub count: u8,
    pub turn: PlayerKey,
    pub go_player: Option<PlayerKey>,
    pub last_player: Option<PlayerKey>,
    pub plays: Vec<Card>,
    pub peg_lead: Option<u8>,
    /// Runner-only policy deployment control. Production decision inputs use
    /// the default argmax mode until sampled deployment passes its gate.
    pub model16_policy_mode: Model16PolicyMode,
    /// A reproducible draw in 0..65,535 supplied by the game runner. It is
    /// independent of the deal RNG so policy experiments preserve paired deals.
    pub model16_policy_sample: u16,
}

#[derive(Clone, Debug)]
pub enum Decision {
    Discard {
        card_ids: Vec<u8>,
        best_lead: Option<u8>,
        ev: Option<f64>,
        win_probability: Option<f64>,
    },
    Peg {
        action: String,
        card_id: Option<u8>,
        ev: Option<f64>,
        win_probability: Option<f64>,
        model16_policy: Option<Model16PolicyDecision>,
    },
}

/// The selected action and the model's recommendation for the same decision
/// point. This is used by post-game review rather than live play.
#[derive(Clone, Debug)]
pub struct DecisionReview {
    pub selected: Decision,
    pub recommended: Decision,
}

#[derive(Clone)]
struct WeightedEntry {
    key: String,
    ranks: [u8; 13],
    count: u32,
    suited_rate: Option<f64>,
    full_combination_count: f64,
    scoring_cards: Vec<Card>,
    weight: f64,
}

#[derive(Clone)]
struct ScoreOutcomeResult {
    outcomes: Vec<(i32, f64)>,
    average: f64,
}

#[derive(Clone)]
struct CutRankOption {
    rank: u8,
    card: Card,
    cards: Vec<Card>,
    weight: f64,
}

#[derive(Clone)]
struct DiscardCandidateGroup {
    key: String,
    discard: Vec<Card>,
    keep: Vec<Card>,
}

#[derive(Clone)]
struct PeggingOption {
    lead_rank: i8,
    own_pegging: i32,
    opponent_pegging: i32,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct CurrentHandOutcome {
    own_pegging: i32,
    opponent_pegging: i32,
    own_hand: i32,
    opponent_hand: i32,
}

#[derive(Default, Clone)]
struct WeightedCurrentHandOutcomes {
    entries: Vec<(CurrentHandOutcome, f64)>,
    indexes: HashMap<CurrentHandOutcome, usize>,
}

#[derive(Default, Clone)]
struct LeadCutAccumulator {
    total_weight: f64,
    base_outcomes: WeightedPairI32,
    current_hand_outcomes: WeightedCurrentHandOutcomes,
    own_hand_total: f64,
    opponent_hand_total: f64,
    own_pegging_total: f64,
    opponent_pegging_total: f64,
}

#[derive(Default, Clone)]
struct LeadEvaluation {
    total_weight: f64,
    win_probability_outcomes: WeightedPairU8,
    ordered_win_probability_total: f64,
    own_hand_total: f64,
    opponent_hand_total: f64,
    crib_total: f64,
    own_pegging_total: f64,
    opponent_pegging_total: f64,
}

#[derive(Default)]
struct DiscardMemo {
    adjusted_discards: HashMap<String, Vec<WeightedEntry>>,
    adjusted_keeps: HashMap<String, Vec<WeightedEntry>>,
    own_hand_score_outcomes: HashMap<String, ScoreOutcomeResult>,
    crib_score_outcomes: HashMap<String, ScoreOutcomeResult>,
    opponent_hand_score_outcomes: HashMap<String, Vec<(i32, f64)>>,
    pegging_options: HashMap<String, Vec<PeggingOption>>,
}

struct RuntimeTables {
    root: String,
    empirical: OnceLock<EmpiricalDiscardKeepTable>,
    pairwise: OnceLock<PairwiseTable>,
    pairwise14: OnceLock<PairwiseTable>,
    hold: OnceLock<Model13HoldTable>,
    crib_rank: OnceLock<CribRankDiscardTables>,
    crib_tripolicy14: OnceLock<CribTripolicyTable>,
    policy16: OnceLock<Option<PolicyArtifact>>,
}

static RUNTIME_TABLES: OnceLock<RuntimeTables> = OnceLock::new();
static MODEL16_POLICY_LOOKUPS: AtomicU64 = AtomicU64::new(0);
static MODEL16_POLICY_HITS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Model16PolicyStats {
    pub lookups: u64,
    pub hits: u64,
}

impl Model16PolicyStats {
    pub fn misses(self) -> u64 {
        self.lookups.saturating_sub(self.hits)
    }
}

pub fn model16_policy_stats() -> Model16PolicyStats {
    Model16PolicyStats {
        lookups: MODEL16_POLICY_LOOKUPS.load(Ordering::Relaxed),
        hits: MODEL16_POLICY_HITS.load(Ordering::Relaxed),
    }
}

pub fn reset_model16_policy_stats() {
    MODEL16_POLICY_LOOKUPS.store(0, Ordering::Relaxed);
    MODEL16_POLICY_HITS.store(0, Ordering::Relaxed);
}

#[derive(Clone)]
struct WeightedRankHand {
    ranks: [u8; 13],
    weight: f64,
}

#[derive(Clone, Default)]
struct PeggingOutcomeDistribution {
    outcomes: WeightedPairI32,
    total_weight: f64,
}

#[derive(Clone, Default)]
struct WeightedPairI32 {
    entries: Vec<((i32, i32), f64)>,
    indexes: HashMap<(i32, i32), usize>,
}

#[derive(Clone, Default)]
struct WeightedPairU8 {
    entries: Vec<((u8, u8), f64)>,
    indexes: HashMap<(u8, u8), usize>,
}

#[derive(Clone)]
struct PegSimulationState {
    hands: [[u8; 13]; 2],
    plays: Vec<u8>,
    count: u8,
    current: PlayerKey,
    go_player: Option<PlayerKey>,
    last_player: Option<PlayerKey>,
    perspective: PlayerKey,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct PegSimulationKey {
    hands: [u64; 2],
    plays: u64,
    count: u8,
    current: PlayerKey,
    go_player: Option<PlayerKey>,
    last_player: Option<PlayerKey>,
    perspective: PlayerKey,
}

#[derive(Clone)]
struct OptimalPegSimulationState {
    hands: [[u8; 13]; 2],
    plays: Vec<u8>,
    count: u8,
    current: PlayerKey,
    go_player: Option<PlayerKey>,
    last_player: Option<PlayerKey>,
    perspective: PlayerKey,
    scores: [i32; 2],
    root_scores: [i32; 2],
    perspective_role: Role,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct OptimalPegSimulationKey {
    hands: [u64; 2],
    plays: u64,
    count: u8,
    current: PlayerKey,
    go_player: Option<PlayerKey>,
    last_player: Option<PlayerKey>,
    perspective: PlayerKey,
    scores: [i32; 2],
    root_scores: [i32; 2],
    perspective_role: Role,
}

#[derive(Clone, Default)]
struct WeightedScore {
    total: f64,
    weight: f64,
}

struct PostPeggingWinContext {
    perspective_role: Role,
    pone_is_perspective: bool,
    dealer_is_perspective: bool,
    pone_hand: Vec<(i32, f64)>,
    dealer_hand: Vec<(i32, f64)>,
    crib: Vec<(i32, f64)>,
    memo: HashMap<(i32, i32), f64>,
    board: BoardModel,
}

enum PeggingWinMode {
    HistoricPhase { board: BoardModel },
    KnownCards(PostPeggingWinContext),
}

struct PeggingWinEvaluator {
    perspective_role: Role,
    mode: PeggingWinMode,
}

pub fn parse_decision_input(input_text: &str) -> Result<DecisionInput, String> {
    let mut fields = HashMap::new();
    for part in input_text.split(';') {
        if part.is_empty() {
            continue;
        }
        let Some((key, value)) = part.split_once('=') else {
            return Err(format!("invalid decision input field: {}", part));
        };
        fields.insert(key, value);
    }
    let kind = match fields.get("kind").copied().unwrap_or("") {
        "discard" => DecisionKind::Discard,
        "peg" => DecisionKind::Peg,
        other => return Err(format!("unsupported decision kind: {}", other)),
    };
    let role = parse_role(fields.get("role").copied().unwrap_or(""))?;
    let ai_hand = parse_cards(fields.get("aiHand").copied().unwrap_or(""))?;
    Ok(DecisionInput {
        kind,
        model: fields.get("model").copied().unwrap_or("").to_string(),
        player: parse_player(fields.get("player").copied().unwrap_or("ai"))?,
        role,
        ai_score: parse_i32(fields.get("aiScore").copied().unwrap_or("0"))?,
        human_score: parse_i32(fields.get("humanScore").copied().unwrap_or("0"))?,
        ai_hand,
        ai_table: parse_cards(fields.get("aiTable").copied().unwrap_or(""))?,
        human_table: parse_cards(fields.get("humanTable").copied().unwrap_or(""))?,
        human_hand_count: parse_usize(fields.get("humanHandCount").copied().unwrap_or("0"))?,
        own_discards: parse_cards(fields.get("ownDiscards").copied().unwrap_or(""))?,
        turn_card: Card::new(parse_u8(fields.get("turnCard").copied().unwrap_or("0"))?)?,
        count: parse_u8(fields.get("count").copied().unwrap_or("0"))?,
        turn: parse_player(fields.get("turn").copied().unwrap_or("ai"))?,
        go_player: parse_optional_player(fields.get("go").copied().unwrap_or("-"))?,
        last_player: parse_optional_player(fields.get("last").copied().unwrap_or("-"))?,
        plays: parse_cards(fields.get("plays").copied().unwrap_or(""))?,
        peg_lead: parse_optional_u8(fields.get("pegLead").copied().unwrap_or("-"))?,
        model16_policy_mode: parse_model16_policy_mode(
            fields.get("model16PolicyMode").copied().unwrap_or("argmax"),
        )?,
        model16_policy_sample: parse_u16(
            fields.get("model16PolicySample").copied().unwrap_or("0"),
        )?,
    })
}

pub fn evaluate_decision(input: &DecisionInput, root: &str) -> Result<Decision, String> {
    match input.kind {
        DecisionKind::Discard => recommend_discard(input, root),
        DecisionKind::Peg => recommend_peg(input, root),
    }
}

/// Evaluate a user's already-selected action against the native 13.0 model.
/// Model 13.0 remains the explicit review model even if a developer-only game
/// was played against another model.
pub fn review_decision(
    input: &DecisionInput,
    selected_card_ids: &[u8],
    root: &str,
) -> Result<DecisionReview, String> {
    if input.model != MODEL_13_0 {
        return Err("post-game review currently supports model 13.0 only".to_string());
    }
    let selected = match input.kind {
        DecisionKind::Discard => review_discard_model13(input, selected_card_ids, root)?,
        DecisionKind::Peg => review_peg_model13(input, selected_card_ids, root)?,
    };
    let recommended = evaluate_decision(input, root)?;
    Ok(DecisionReview {
        selected,
        recommended,
    })
}

fn is_supported_rust_model(model: &str) -> bool {
    model == MODEL_13_0
        || model == MODEL_14_3
        || model == MODEL_14_8
        || model == MODEL_14_8_1
        || model == MODEL_15_0
        || model == MODEL_15_1
        || model == MODEL_15_2
        || model == MODEL_16_0
}

fn is_strength_model(input: &DecisionInput) -> bool {
    input.model == MODEL_15_0
        || input.model == MODEL_15_1
        || input.model == MODEL_15_2
        || input.model == MODEL_16_0
}

fn uses_joint_future_pegging(input: &DecisionInput) -> bool {
    input.model == MODEL_15_1
}

fn uses_exact_joint_future_pegging(input: &DecisionInput) -> bool {
    input.model == MODEL_15_2 || input.model == MODEL_16_0
}

fn uses_ordered_current_hand_scoring(input: &DecisionInput) -> bool {
    input.model == MODEL_16_0
}

fn groups_equivalent_discard_candidates(input: &DecisionInput) -> bool {
    input.model == MODEL_14_8_1 || is_strength_model(input)
}

fn board_model_for_input(input: &DecisionInput) -> BoardModel {
    if uses_exact_joint_future_pegging(input) {
        BoardModel::exact_joint_pegging_without_early_heuristic()
    } else if uses_joint_future_pegging(input) {
        BoardModel::joint_pegging_without_early_heuristic()
    } else if is_strength_model(input) {
        BoardModel::without_early_heuristic()
    } else {
        BoardModel::new()
    }
}

pub fn decision_json(decision: &Decision) -> String {
    match decision {
        Decision::Discard {
            card_ids,
            best_lead,
            ..
        } => {
            let ids = card_ids
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",");
            match best_lead {
                Some(lead) => format!("{{\"cardIds\":[{}],\"bestLead\":{}}}", ids, lead),
                None => format!("{{\"cardIds\":[{}],\"bestLead\":null}}", ids),
            }
        }
        Decision::Peg {
            action,
            card_id,
            ev,
            win_probability: _,
            ..
        } => {
            if action == "go" {
                return "{\"action\":\"go\"}".to_string();
            }
            let mut parts = vec![format!("\"action\":\"{}\"", action)];
            if let Some(id) = card_id {
                parts.push(format!("\"cardId\":{}", id));
            }
            if let Some(value) = ev {
                parts.push(format!("\"ev\":{}", round_ev(*value)));
            }
            format!("{{{}}}", parts.join(","))
        }
    }
}

fn recommend_discard(input: &DecisionInput, root: &str) -> Result<Decision, String> {
    if !is_supported_rust_model(&input.model) {
        return Err(format!(
            "unsupported model for Rust discard: {}",
            input.model
        ));
    }
    if input.player != PlayerKey::Ai {
        return Err("Rust shadow discard currently supports AI decisions only".to_string());
    }
    if input.ai_hand.len() != 6 {
        return Err(format!(
            "discard requires six AI cards, got {}",
            input.ai_hand.len()
        ));
    }
    if input.model == MODEL_13_0 {
        return recommend_discard_model13(input, root);
    }
    if input.model == MODEL_14_3 {
        return recommend_discard_model143(input, root);
    }
    let tables = runtime_tables(root)?;
    let empirical = tables.empirical()?;
    let pairwise = tables.pairwise()?;
    let mut seen_cards = [false; 52];
    for card in &input.ai_hand {
        seen_cards[card.id as usize] = true;
    }
    let deck: Vec<Card> = full_deck()
        .into_iter()
        .filter(|card| !seen_cards[card.id as usize])
        .collect();
    let role = input.role;
    let opponent_role = other_role(role);
    let next_role = other_role(role);
    let cut_options = cut_rank_options(&deck);
    let mut memo = DiscardMemo::default();
    let mut board = board_model_for_input(input);
    let ordered_current_hand_scoring = uses_ordered_current_hand_scoring(input);
    let mut recommended: Option<(Vec<Card>, CandidateEvaluation)> = None;
    let candidate_groups = empirical_discard_candidate_groups(
        &input.ai_hand,
        opponent_role,
        &cut_options,
        &deck,
        empirical,
        &mut memo,
        groups_equivalent_discard_candidates(input),
    );

    for group in candidate_groups {
        let Some(evaluation) = evaluate_discard_candidate(
            &input.ai_hand,
            &group.keep,
            &group.discard,
            role,
            opponent_role,
            next_role,
            empirical,
            pairwise,
            &cut_options,
            &deck,
            input.ai_score,
            input.human_score,
            ordered_current_hand_scoring,
            &mut memo,
            &mut board,
        ) else {
            continue;
        };
        let should_replace = match &recommended {
            None => true,
            Some((_, current)) => {
                evaluation.win_probability > current.win_probability
                    || (evaluation.win_probability == current.win_probability
                        && evaluation.total_ev > current.total_ev)
            }
        };
        if should_replace {
            recommended = Some((group.discard, evaluation));
        }
    }

    let Some((discard, evaluation)) = recommended else {
        return Err("no discard candidate evaluated".to_string());
    };
    Ok(Decision::Discard {
        card_ids: discard.iter().map(|card| card.id).collect(),
        best_lead: if evaluation.best_lead >= 0 {
            Some(evaluation.best_lead as u8)
        } else {
            None
        },
        ev: Some(evaluation.total_ev),
        win_probability: Some(evaluation.win_probability),
    })
}

fn recommend_peg(input: &DecisionInput, root: &str) -> Result<Decision, String> {
    if !is_supported_rust_model(&input.model) {
        return Err(format!(
            "unsupported model for Rust pegging: {}",
            input.model
        ));
    }
    if input.player != PlayerKey::Ai {
        return Err("Rust shadow pegging currently supports AI decisions only".to_string());
    }
    if input.turn != PlayerKey::Ai {
        return Err("Rust shadow pegging input is not an AI turn".to_string());
    }
    let legal: Vec<Card> = input
        .ai_hand
        .iter()
        .copied()
        .filter(|card| input.count + card.value <= 31)
        .collect();
    if legal.is_empty() {
        return Ok(Decision::Peg {
            action: "go".to_string(),
            card_id: None,
            ev: None,
            win_probability: None,
            model16_policy: None,
        });
    }
    if legal.len() == 1 {
        let card = legal[0];
        let mut plays = input.plays.clone();
        plays.push(card);
        return Ok(Decision::Peg {
            action: "play".to_string(),
            card_id: Some(card.id),
            ev: Some(score_count(&plays) as f64),
            win_probability: None,
            model16_policy: None,
        });
    }

    let tables = runtime_tables(root)?;
    if input.model == MODEL_16_0 {
        return recommend_peg_model16(input, &legal, tables.policy16()?);
    }
    if input.model == MODEL_13_0 {
        return recommend_peg_model13(input, tables);
    }
    let hold = tables.hold()?;
    if !is_strength_model(input)
        && input.role == Role::Pone
        && input.count == 0
        && input.plays.is_empty()
        && input.ai_hand.len() == 4
    {
        if let Some(lead_rank) = input.peg_lead {
            if let Some(card) = legal.iter().copied().find(|card| card.rank == lead_rank) {
                let ev = exhaustive_pegging_play_ev(input, card, hold);
                return Ok(Decision::Peg {
                    action: "play".to_string(),
                    card_id: Some(card.id),
                    ev: Some(ev),
                    win_probability: None,
                    model16_policy: None,
                });
            }
        }
    }

    let opponent_role = other_role(input.role);
    let known_cards = known_cards_for_pegging(input);
    let available_ranks = remaining_rank_counts(&known_cards);
    let opponent_hands = opponent_rank_hands_for_engine(
        &available_ranks,
        input.human_hand_count as u8,
        &input.human_table,
        opponent_role,
        hold,
        true,
    );
    let mut evaluator = known_card_pegging_win_evaluator(input, hold);
    let mut best_card = legal[0];
    let mut best_score = f64::NEG_INFINITY;
    let mut best_decision: Option<(f64, f64)> = None;

    for card in &legal {
        let distribution = optimal_pegging_outcome_distribution_for_candidate(
            input,
            *card,
            &opponent_hands,
            &mut evaluator,
        );
        let win_probability =
            expected_win_probability_after_pegging(input, &distribution, &mut evaluator);
        let point_ev = pegging_distribution_point_ev(&distribution);
        let immediate = {
            let mut plays = input.plays.clone();
            plays.push(*card);
            score_count(&plays) as f64
        };
        let key = [win_probability, immediate, (card.rank + 1) as f64];
        let best_key = [
            best_score,
            {
                let mut plays = input.plays.clone();
                plays.push(best_card);
                score_count(&plays) as f64
            },
            (best_card.rank + 1) as f64,
        ];
        if compare_tuple(&key, &best_key) > 0 {
            best_score = win_probability;
            best_card = *card;
            best_decision = Some((point_ev, win_probability));
        }
    }

    let (ev, win_probability) = best_decision.unwrap_or_else(|| {
        let distribution = optimal_pegging_outcome_distribution_for_candidate(
            input,
            best_card,
            &opponent_hands,
            &mut evaluator,
        );
        (
            pegging_distribution_point_ev(&distribution),
            expected_win_probability_after_pegging(input, &distribution, &mut evaluator),
        )
    });
    Ok(Decision::Peg {
        action: "play".to_string(),
        card_id: Some(best_card.id),
        ev: Some(ev),
        win_probability: Some(win_probability),
        model16_policy: None,
    })
}

fn recommend_peg_model16(
    input: &DecisionInput,
    legal: &[Card],
    policy: Option<&PolicyArtifact>,
) -> Result<Decision, String> {
    let key = model16_policy_key(input)?;
    let expected_mask = key.expected_legal_mask();
    let actual_mask = legal
        .iter()
        .fold(0_u16, |mask, card| mask | (1 << card.rank));
    if actual_mask != expected_mask {
        return Err(format!(
            "model16 policy key legal mask {:#x} does not match cards {:#x}",
            expected_mask, actual_mask
        ));
    }

    MODEL16_POLICY_LOOKUPS.fetch_add(1, Ordering::Relaxed);
    let policy_entry = if input.model16_policy_mode == Model16PolicyMode::Fallback {
        None
    } else {
        policy.and_then(|artifact| artifact.lookup(&key))
    };
    if policy_entry.is_some() {
        MODEL16_POLICY_HITS.fetch_add(1, Ordering::Relaxed);
    }
    let available_ranks = remaining_rank_counts(&known_cards_for_pegging(input));
    let selected = match (policy_entry, input.model16_policy_mode) {
        (Some(entry), Model16PolicyMode::Sample) => {
            sample_model16_policy_card(legal, &entry.weights, input.model16_policy_sample)?
        }
        (entry, _) => select_model16_argmax_or_fallback(
            input,
            legal,
            entry.map(|value| &value.weights),
            &available_ranks,
        )?,
    };
    let model16_policy = Some(Model16PolicyDecision {
        source: if policy_entry.is_some() {
            Model16PolicySource::Learned
        } else {
            Model16PolicySource::Fallback
        },
        confidence: policy_entry.map(|entry| entry.confidence),
        selected_weight: policy_entry.map(|entry| entry.weights[selected.rank as usize]),
    });

    Ok(Decision::Peg {
        action: "play".to_string(),
        card_id: Some(selected.id),
        // Policy probability and the tactical backoff score are not EV or WP.
        ev: None,
        win_probability: None,
        model16_policy,
    })
}

fn select_model16_argmax_or_fallback(
    input: &DecisionInput,
    legal: &[Card],
    weights: Option<&[u16; 14]>,
    available_ranks: &[u8; 13],
) -> Result<Card, String> {
    legal
        .iter()
        .copied()
        .max_by(|left, right| {
            let left_weight = weights.map_or(0, |values| values[left.rank as usize]);
            let right_weight = weights.map_or(0, |values| values[right.rank as usize]);
            left_weight
                .cmp(&right_weight)
                .then_with(|| {
                    compare_model16_heuristic(
                        model16_heuristic_key(input, *left, available_ranks),
                        model16_heuristic_key(input, *right, available_ranks),
                    )
                })
                // Cards of the same rank are strategically identical. Pick
                // the lowest id so suit/order cannot make play nondeterministic.
                .then_with(|| right.id.cmp(&left.id))
        })
        .ok_or_else(|| "model16 received no legal pegging cards".to_string())
}

fn sample_model16_policy_card(
    legal: &[Card],
    weights: &[u16; 14],
    sample: u16,
) -> Result<Card, String> {
    let target = u32::from(sample) % crate::policy::POLICY_WEIGHT_TOTAL;
    let mut cumulative = 0_u32;
    let mut last_legal = None;
    for (rank, weight) in weights.iter().copied().enumerate().take(13) {
        let Some(card) = legal
            .iter()
            .copied()
            .filter(|card| card.rank as usize == rank)
            .min_by_key(|card| card.id)
        else {
            continue;
        };
        last_legal = Some(card);
        cumulative += u32::from(weight);
        if target < cumulative {
            return Ok(card);
        }
    }
    last_legal.ok_or_else(|| "model16 sampled policy has no legal card".to_string())
}

fn model16_policy_key(input: &DecisionInput) -> Result<PolicyInformationSetKey, String> {
    let own_hand = rank_counts(&input.ai_hand);
    let own_played = rank_counts(&input.ai_table);
    let opponent_played = rank_counts(&input.human_table);
    let current_series = input.plays.iter().map(|card| card.rank).collect::<Vec<_>>();
    PolicyInformationSetKey::from_rank_observation(PolicyRankObservation {
        role: input.role,
        my_score: input.ai_score,
        opponent_score: input.human_score,
        own_hand: &own_hand,
        own_played: &own_played,
        opponent_played: &opponent_played,
        current_series: &current_series,
        count: input.count,
        go_player: model16_policy_actor(input.go_player),
        last_player: model16_policy_actor(input.last_player),
    })
}

fn model16_policy_actor(player: Option<PlayerKey>) -> Option<InfoActor> {
    player.map(|player| match player {
        PlayerKey::Ai => InfoActor::SelfPlayer,
        PlayerKey::Human => InfoActor::Opponent,
    })
}

fn model16_heuristic_key(
    input: &DecisionInput,
    card: Card,
    available_ranks: &[u8; 13],
) -> [f64; 7] {
    let mut plays = input.plays.clone();
    plays.push(card);
    let immediate = f64::from(score_count(&plays));
    let count_after = input.count + card.value;
    let wins_now = f64::from(input.ai_score + immediate as i32 >= 121);
    let mut reply_weight = 0.0;
    let mut reply_point_total = 0.0;
    let mut max_reply: f64 = 0.0;
    let mut winning_reply_weight = 0.0;
    if count_after < 31 {
        for (rank, copies) in available_ranks.iter().copied().enumerate() {
            if copies == 0 {
                continue;
            }
            let reply = peg_card_for_rank(rank as u8);
            if count_after + reply.value > 31 {
                continue;
            }
            plays.push(reply);
            let reply_points = f64::from(score_count(&plays));
            plays.pop();
            let weight = f64::from(copies);
            reply_weight += weight;
            reply_point_total += weight * reply_points;
            max_reply = max_reply.max(reply_points);
            if input.human_score + reply_points as i32 >= 121 {
                winning_reply_weight += weight;
            }
        }
    }
    let expected_reply = if reply_weight > 0.0 {
        reply_point_total / reply_weight
    } else {
        0.0
    };
    let winning_reply_rate = if reply_weight > 0.0 {
        winning_reply_weight / reply_weight
    } else {
        0.0
    };
    let immediate_weight = if input.ai_score >= 117 { 12.0 } else { 6.0 };
    let reply_penalty = if input.human_score >= 117 { 12.0 } else { 4.0 };
    let tactical = immediate * immediate_weight - max_reply * reply_penalty - expected_reply;
    [
        wins_now,
        -winning_reply_rate,
        tactical,
        immediate,
        -max_reply,
        -expected_reply,
        f64::from(card.rank + 1),
    ]
}

fn compare_model16_heuristic(left: [f64; 7], right: [f64; 7]) -> std::cmp::Ordering {
    for (left_value, right_value) in left.into_iter().zip(right) {
        let ordering = left_value.total_cmp(&right_value);
        if ordering != std::cmp::Ordering::Equal {
            return ordering;
        }
    }
    std::cmp::Ordering::Equal
}

#[derive(Clone)]
struct Model13PeggingOption {
    my_ev: f64,
    opponent_ev: f64,
    best_lead: i8,
    hist: WeightedPairI32,
    total_weight: f64,
}

fn recommend_discard_model13(input: &DecisionInput, root: &str) -> Result<Decision, String> {
    let tables = runtime_tables(root)?;
    let crib_rank = tables.crib_rank()?;
    let pairwise = tables.pairwise()?;
    let mut seen_cards = [false; 52];
    for card in &input.ai_hand {
        seen_cards[card.id as usize] = true;
    }
    let deck: Vec<Card> = full_deck()
        .into_iter()
        .filter(|card| !seen_cards[card.id as usize])
        .collect();
    let role = input.role;
    let mut board = BoardModel::new();
    let crib_flush_bonus_by_suit = crib_flush_bonuses_by_suit(&input.ai_hand);
    let mut recommended: Option<(Vec<Card>, CandidateEvaluation)> = None;

    for discard_indices in crate::cards::combinations_indices(input.ai_hand.len(), 2) {
        let mut is_discarded = vec![false; input.ai_hand.len()];
        for index in &discard_indices {
            is_discarded[*index] = true;
        }
        let discard: Vec<Card> = discard_indices
            .iter()
            .map(|index| input.ai_hand[*index])
            .collect();
        let keep: Vec<Card> = input
            .ai_hand
            .iter()
            .enumerate()
            .filter_map(|(index, card)| {
                if is_discarded[index] {
                    None
                } else {
                    Some(*card)
                }
            })
            .collect();
        let Some(evaluation) = evaluate_discard_candidate_model13(
            &input.ai_hand,
            &keep,
            &discard,
            &deck,
            role,
            input.ai_score,
            input.human_score,
            &crib_flush_bonus_by_suit,
            crib_rank,
            pairwise,
            &mut board,
        ) else {
            continue;
        };
        let should_replace = match &recommended {
            None => true,
            Some((_, current)) => {
                evaluation.win_probability > current.win_probability
                    || (evaluation.win_probability == current.win_probability
                        && evaluation.total_ev > current.total_ev)
            }
        };
        if should_replace {
            recommended = Some((discard, evaluation));
        }
    }

    let Some((discard, evaluation)) = recommended else {
        return Err("no 13.0 discard candidate evaluated".to_string());
    };
    Ok(Decision::Discard {
        card_ids: discard.iter().map(|card| card.id).collect(),
        best_lead: if evaluation.best_lead >= 0 {
            Some(evaluation.best_lead as u8)
        } else {
            None
        },
        ev: Some(evaluation.total_ev),
        win_probability: Some(evaluation.win_probability),
    })
}

fn review_discard_model13(
    input: &DecisionInput,
    selected_card_ids: &[u8],
    root: &str,
) -> Result<Decision, String> {
    if input.ai_hand.len() != 6 {
        return Err(format!(
            "discard review requires six cards, got {}",
            input.ai_hand.len()
        ));
    }
    if selected_card_ids.len() != 2 || selected_card_ids[0] == selected_card_ids[1] {
        return Err("discard review requires two distinct selected cards".to_string());
    }
    let selected = selected_card_ids
        .iter()
        .map(|id| {
            input
                .ai_hand
                .iter()
                .copied()
                .find(|card| card.id == *id)
                .ok_or_else(|| "selected discard is not in the original hand".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let keep = input
        .ai_hand
        .iter()
        .copied()
        .filter(|card| !selected_card_ids.contains(&card.id))
        .collect::<Vec<_>>();
    let tables = runtime_tables(root)?;
    let crib_rank = tables.crib_rank()?;
    let pairwise = tables.pairwise()?;
    let mut seen_cards = [false; 52];
    for card in &input.ai_hand {
        seen_cards[card.id as usize] = true;
    }
    let deck = full_deck()
        .into_iter()
        .filter(|card| !seen_cards[card.id as usize])
        .collect::<Vec<_>>();
    let crib_flush_bonus_by_suit = crib_flush_bonuses_by_suit(&input.ai_hand);
    let mut board = BoardModel::new();
    let evaluation = evaluate_discard_candidate_model13(
        &input.ai_hand,
        &keep,
        &selected,
        &deck,
        input.role,
        input.ai_score,
        input.human_score,
        &crib_flush_bonus_by_suit,
        crib_rank,
        pairwise,
        &mut board,
    )
    .ok_or_else(|| "selected discard could not be evaluated".to_string())?;
    Ok(Decision::Discard {
        card_ids: selected_card_ids.to_vec(),
        best_lead: if evaluation.best_lead >= 0 {
            Some(evaluation.best_lead as u8)
        } else {
            None
        },
        ev: Some(evaluation.total_ev),
        win_probability: Some(evaluation.win_probability),
    })
}

#[allow(clippy::too_many_arguments)]
fn evaluate_discard_candidate_model13(
    full_hand: &[Card],
    keep: &[Card],
    discard: &[Card],
    deck: &[Card],
    role: Role,
    player_score: i32,
    opponent_score: i32,
    crib_flush_bonus_by_suit: &[f64; 4],
    crib_rank: &CribRankDiscardTables,
    pairwise: &PairwiseTable,
    board: &mut BoardModel,
) -> Option<CandidateEvaluation> {
    let (hand_score, crib_score) = model13_rank_cut_discard_scores(
        keep,
        discard,
        deck,
        role,
        crib_flush_bonus_by_suit,
        crib_rank,
    );
    let pegging_options = model13_pegging_discard_options(keep, role, full_hand, pairwise);
    if pegging_options.is_empty() {
        return None;
    }
    let mut best: Option<CandidateEvaluation> = None;
    for pegging in pegging_options {
        let net_pegging = pegging.my_ev - pegging.opponent_ev;
        let total_ev = (if role == Role::Dealer {
            hand_score + crib_score
        } else {
            hand_score - crib_score
        }) + net_pegging;
        let win_probability = model13_discard_candidate_win_probability(
            full_hand,
            keep,
            discard,
            deck,
            role,
            &pegging,
            player_score,
            opponent_score,
            crib_rank,
            board,
        );
        let candidate = CandidateEvaluation {
            win_probability,
            total_ev,
            best_lead: pegging.best_lead,
        };
        let should_replace = match &best {
            None => true,
            Some(current) => {
                candidate.win_probability > current.win_probability
                    || (candidate.win_probability == current.win_probability
                        && candidate.total_ev > current.total_ev)
            }
        };
        if should_replace {
            best = Some(candidate);
        }
    }
    best
}

fn recommend_peg_model13(
    input: &DecisionInput,
    tables: &RuntimeTables,
) -> Result<Decision, String> {
    let hold = tables.hold()?;
    let legal: Vec<Card> = input
        .ai_hand
        .iter()
        .copied()
        .filter(|card| input.count + card.value <= 31)
        .collect();
    if input.role == Role::Pone
        && input.count == 0
        && input.plays.is_empty()
        && input.ai_hand.len() == 4
    {
        if let Some(lead_rank) = input.peg_lead {
            if let Some(card) = legal.iter().copied().find(|card| card.rank == lead_rank) {
                let ev = exhaustive_pegging_play_ev_with_weighting(input, card, hold, false);
                return Ok(Decision::Peg {
                    action: "play".to_string(),
                    card_id: Some(card.id),
                    ev: Some(ev),
                    win_probability: None,
                    model16_policy: None,
                });
            }
        }
    }
    let opponent_role = other_role(input.role);
    let known_cards = known_cards_for_pegging(input);
    let available_ranks = remaining_rank_counts(&known_cards);
    let opponent_hands = opponent_rank_hands_for_engine(
        &available_ranks,
        input.human_hand_count as u8,
        &input.human_table,
        opponent_role,
        hold,
        false,
    );
    let mut evaluator = historic_phase_pegging_win_evaluator(input);
    let mut best_card = legal[0];
    let mut best_score = f64::NEG_INFINITY;
    let mut best_decision: Option<(f64, f64)> = None;

    for card in &legal {
        let distribution = optimal_pegging_outcome_distribution_for_candidate(
            input,
            *card,
            &opponent_hands,
            &mut evaluator,
        );
        let win_probability =
            expected_win_probability_after_pegging(input, &distribution, &mut evaluator);
        let point_ev = pegging_distribution_point_ev(&distribution);
        let immediate = {
            let mut plays = input.plays.clone();
            plays.push(*card);
            score_count(&plays) as f64
        };
        let key = [win_probability, immediate, (card.rank + 1) as f64];
        let best_key = [
            best_score,
            {
                let mut plays = input.plays.clone();
                plays.push(best_card);
                score_count(&plays) as f64
            },
            (best_card.rank + 1) as f64,
        ];
        if compare_tuple(&key, &best_key) > 0 {
            best_score = win_probability;
            best_card = *card;
            best_decision = Some((point_ev, win_probability));
        }
    }

    let (ev, win_probability) = best_decision.unwrap_or_else(|| {
        let distribution = optimal_pegging_outcome_distribution_for_candidate(
            input,
            best_card,
            &opponent_hands,
            &mut evaluator,
        );
        (
            pegging_distribution_point_ev(&distribution),
            expected_win_probability_after_pegging(input, &distribution, &mut evaluator),
        )
    });
    Ok(Decision::Peg {
        action: "play".to_string(),
        card_id: Some(best_card.id),
        ev: Some(ev),
        win_probability: Some(win_probability),
        model16_policy: None,
    })
}

fn review_peg_model13(
    input: &DecisionInput,
    selected_card_ids: &[u8],
    root: &str,
) -> Result<Decision, String> {
    if selected_card_ids.len() != 1 {
        return Err("pegging review requires one selected card".to_string());
    }
    let selected_id = selected_card_ids[0];
    let legal = input
        .ai_hand
        .iter()
        .copied()
        .filter(|card| input.count + card.value <= 31)
        .collect::<Vec<_>>();
    let selected = legal
        .iter()
        .copied()
        .find(|card| card.id == selected_id)
        .ok_or_else(|| "selected peg is not legal in the saved position".to_string())?;
    if legal.len() == 1 {
        let mut plays = input.plays.clone();
        plays.push(selected);
        return Ok(Decision::Peg {
            action: "play".to_string(),
            card_id: Some(selected.id),
            ev: Some(score_count(&plays) as f64),
            win_probability: None,
            model16_policy: None,
        });
    }
    let tables = runtime_tables(root)?;
    let hold = tables.hold()?;
    let opponent_role = other_role(input.role);
    let known_cards = known_cards_for_pegging(input);
    let available_ranks = remaining_rank_counts(&known_cards);
    let opponent_hands = opponent_rank_hands_for_engine(
        &available_ranks,
        input.human_hand_count as u8,
        &input.human_table,
        opponent_role,
        hold,
        false,
    );
    let mut evaluator = historic_phase_pegging_win_evaluator(input);
    let distribution = optimal_pegging_outcome_distribution_for_candidate(
        input,
        selected,
        &opponent_hands,
        &mut evaluator,
    );
    let win_probability =
        expected_win_probability_after_pegging(input, &distribution, &mut evaluator);
    let ev = pegging_distribution_point_ev(&distribution);
    Ok(Decision::Peg {
        action: "play".to_string(),
        card_id: Some(selected.id),
        ev: Some(ev),
        win_probability: Some(win_probability),
        model16_policy: None,
    })
}

fn model13_rank_cut_discard_scores(
    keep: &[Card],
    discard: &[Card],
    deck: &[Card],
    role: Role,
    crib_flush_bonus_by_suit: &[f64; 4],
    crib_rank: &CribRankDiscardTables,
) -> (f64, f64) {
    let mut hand_total = 0.0;
    let mut crib_total = 0.0;
    for cut in deck {
        hand_total += score_hand_rank_only(keep, *cut) as f64
            + score_flush_and_right_jack(keep, *cut, false) as f64;
        crib_total += model13_rank_cut_crib_score(discard, role, *cut, crib_rank);
    }
    let count = deck.len().max(1) as f64;
    (
        hand_total / count,
        (crib_total / count) + expected_crib_flush_bonus(discard, crib_flush_bonus_by_suit),
    )
}

fn model13_rank_cut_crib_score(
    discard: &[Card],
    role: Role,
    cut: Card,
    crib_rank: &CribRankDiscardTables,
) -> f64 {
    let discard_key = rank_count_key(&rank_counts(discard));
    crib_rank
        .rank_score(role_index(role), &discard_key, cut.rank)
        .unwrap_or(0.0)
}

#[allow(clippy::too_many_arguments)]
fn model13_discard_candidate_win_probability(
    full_hand: &[Card],
    keep: &[Card],
    discard: &[Card],
    deck: &[Card],
    role: Role,
    pegging: &Model13PeggingOption,
    player_score: i32,
    opponent_score: i32,
    crib_rank: &CribRankDiscardTables,
    board: &mut BoardModel,
) -> f64 {
    let opponent_role = other_role(role);
    let next_role = other_role(role);
    let opponent_hand_distribution =
        score_phase_distribution_for_phase(if opponent_role == Role::Dealer {
            ScorePhase::HandDealer
        } else {
            ScorePhase::HandPone
        });
    let pegging_weight_total = pegging.total_weight.max(1.0);
    let mut base_outcomes = WeightedPairI32::default();
    for cut in deck {
        let own_hand_score = score_hand_rank_only(keep, *cut) as i32
            + score_flush_and_right_jack(keep, *cut, false) as i32;
        let mut seen_cards = full_hand.to_vec();
        seen_cards.push(*cut);
        let crib_outcomes =
            model13_crib_score_outcomes_for_cut(discard, *cut, role, &seen_cards, crib_rank);
        let cut_weight = 1.0 / deck.len().max(1) as f64;
        for (crib_score, crib_weight) in &crib_outcomes {
            for (opponent_hand_score, opponent_hand_weight) in &opponent_hand_distribution {
                let my_base = own_hand_score + if role == Role::Dealer { *crib_score } else { 0 };
                let opponent_base =
                    *opponent_hand_score + if role == Role::Dealer { 0 } else { *crib_score };
                let key = (my_base, opponent_base);
                add_weight_pair_i32(
                    &mut base_outcomes,
                    key,
                    cut_weight * *crib_weight * *opponent_hand_weight,
                );
            }
        }
    }

    let mut total = 0.0;
    let mut total_weight = 0.0;
    for ((my_pegging, opponent_pegging), pegging_weight) in &pegging.hist.entries {
        let normalized_pegging_weight = *pegging_weight / pegging_weight_total;
        for ((my_base, opponent_base), base_weight) in &base_outcomes.entries {
            let weight = normalized_pegging_weight * *base_weight;
            total += weight
                * board.future_win_probability_from_scores(
                    player_score + *my_pegging + *my_base,
                    opponent_score + *opponent_pegging + *opponent_base,
                    next_role,
                    ScorePhase::PeggingPone,
                );
            total_weight += weight;
        }
    }
    if total_weight > 0.0 {
        total / total_weight
    } else {
        0.5
    }
}

fn model13_crib_score_outcomes_for_cut(
    discard: &[Card],
    cut: Card,
    role: Role,
    seen_cards: &[Card],
    crib_rank: &CribRankDiscardTables,
) -> Vec<(i32, f64)> {
    let discard_key = rank_count_key(&rank_counts(discard));
    let Some(entry) = crib_rank.histogram(role_index(role), &discard_key, cut.rank) else {
        let fallback = model13_rank_cut_crib_score(discard, role, cut, crib_rank) as i32
            + score_flush_and_right_jack(discard, cut, true) as i32;
        return vec![(fallback, 1.0)];
    };
    let seen = card_id_set(seen_cards);
    let available = full_deck()
        .into_iter()
        .filter(|card| !seen[card.id as usize])
        .collect::<Vec<_>>();
    let mut outcomes: BTreeMap<i32, f64> = BTreeMap::new();
    let mut total_weight = 0.0;
    for opponent_discard in &entry.opponent_discards {
        let suited_discards = cards_for_rank_counts(&available, &opponent_discard.ranks);
        if suited_discards.is_empty() {
            continue;
        }
        let suited_weight = opponent_discard.weight / suited_discards.len() as f64;
        for suited_discard in suited_discards {
            let score =
                opponent_discard.rank_score + crib_suit_bonus(discard, &suited_discard, cut);
            *outcomes.entry(score).or_insert(0.0) += suited_weight;
            total_weight += suited_weight;
        }
    }
    if total_weight == 0.0 {
        let fallback = model13_rank_cut_crib_score(discard, role, cut, crib_rank) as i32
            + score_flush_and_right_jack(discard, cut, true) as i32;
        return vec![(fallback, 1.0)];
    }
    normalized_score_outcomes(&outcomes, total_weight)
}

fn recommend_discard_model143(input: &DecisionInput, root: &str) -> Result<Decision, String> {
    let tables = runtime_tables(root)?;
    let pairwise14 = tables.pairwise14()?;
    let hold = tables.hold()?;
    let crib_rank = tables.crib_rank()?;
    let crib_tripolicy14 = tables.crib_tripolicy14()?;
    let mut seen_cards = [false; 52];
    for card in &input.ai_hand {
        seen_cards[card.id as usize] = true;
    }
    let deck: Vec<Card> = full_deck()
        .into_iter()
        .filter(|card| !seen_cards[card.id as usize])
        .collect();
    let role = input.role;
    let opponent_role = other_role(role);
    let next_role = other_role(role);
    let cut_options = cut_rank_options(&deck);
    let crib_flush_bonus_by_suit = crib_flush_bonuses_by_suit(&input.ai_hand);
    let mut board = BoardModel::new();
    let mut memo = DiscardMemo::default();
    let mut recommended: Option<(Vec<Card>, CandidateEvaluation)> = None;

    for discard_indices in crate::cards::combinations_indices(input.ai_hand.len(), 2) {
        let mut is_discarded = vec![false; input.ai_hand.len()];
        for index in &discard_indices {
            is_discarded[*index] = true;
        }
        let discard: Vec<Card> = discard_indices
            .iter()
            .map(|index| input.ai_hand[*index])
            .collect();
        let keep: Vec<Card> = input
            .ai_hand
            .iter()
            .enumerate()
            .filter_map(|(index, card)| {
                if is_discarded[index] {
                    None
                } else {
                    Some(*card)
                }
            })
            .collect();
        let Some(evaluation) = evaluate_discard_candidate_model143(
            &input.ai_hand,
            &keep,
            &discard,
            &deck,
            &cut_options,
            role,
            opponent_role,
            next_role,
            input.ai_score,
            input.human_score,
            &crib_flush_bonus_by_suit,
            pairwise14,
            hold,
            crib_tripolicy14,
            crib_rank,
            &mut memo,
            &mut board,
        ) else {
            continue;
        };
        let should_replace = match &recommended {
            None => true,
            Some((_, current)) => {
                evaluation.win_probability > current.win_probability
                    || (evaluation.win_probability == current.win_probability
                        && evaluation.total_ev > current.total_ev)
            }
        };
        if should_replace {
            recommended = Some((discard, evaluation));
        }
    }

    let Some((discard, evaluation)) = recommended else {
        return Err("no 14.3 discard candidate evaluated".to_string());
    };
    Ok(Decision::Discard {
        card_ids: discard.iter().map(|card| card.id).collect(),
        best_lead: if evaluation.best_lead >= 0 {
            Some(evaluation.best_lead as u8)
        } else {
            None
        },
        ev: Some(evaluation.total_ev),
        win_probability: Some(evaluation.win_probability),
    })
}

#[allow(clippy::too_many_arguments)]
fn evaluate_discard_candidate_model143(
    full_hand: &[Card],
    keep: &[Card],
    discard: &[Card],
    deck: &[Card],
    cut_options: &[CutRankOption],
    role: Role,
    opponent_role: Role,
    next_role: Role,
    player_score: i32,
    opponent_score: i32,
    crib_flush_bonus_by_suit: &[f64; 4],
    pairwise14: &PairwiseTable,
    hold: &Model13HoldTable,
    crib_tripolicy14: &CribTripolicyTable,
    crib_rank: &CribRankDiscardTables,
    memo: &mut DiscardMemo,
    board: &mut BoardModel,
) -> Option<CandidateEvaluation> {
    let pegging_options = model143_pegging_discard_options(keep, role, full_hand, pairwise14);
    if pegging_options.is_empty() {
        return None;
    }
    let mut best: Option<CandidateEvaluation> = None;
    for crib_policy in [
        TripolicyPolicy::Ev,
        TripolicyPolicy::On,
        TripolicyPolicy::Off,
    ] {
        let (hand_score, crib_score) = model143_rank_cut_discard_scores(
            keep,
            discard,
            deck,
            role,
            crib_policy,
            crib_flush_bonus_by_suit,
            crib_tripolicy14,
            crib_rank,
        );
        for pegging in &pegging_options {
            let net_pegging = pegging.my_ev - pegging.opponent_ev;
            let total_ev = (if role == Role::Dealer {
                hand_score + crib_score
            } else {
                hand_score - crib_score
            }) + net_pegging;
            let win_probability = model143_discard_candidate_win_probability(
                full_hand,
                keep,
                discard,
                cut_options,
                role,
                opponent_role,
                next_role,
                pegging,
                crib_policy,
                player_score,
                opponent_score,
                hold,
                crib_tripolicy14,
                crib_rank,
                memo,
                board,
            );
            let candidate = CandidateEvaluation {
                win_probability,
                total_ev,
                best_lead: pegging.best_lead,
            };
            let should_replace = match &best {
                None => true,
                Some(current) => {
                    candidate.win_probability > current.win_probability
                        || (candidate.win_probability == current.win_probability
                            && candidate.total_ev > current.total_ev)
                        || (candidate.win_probability == current.win_probability
                            && candidate.total_ev == current.total_ev
                            && lead_tie_value(candidate.best_lead)
                                < lead_tie_value(current.best_lead))
                }
            };
            if should_replace {
                best = Some(candidate);
            }
        }
    }
    best
}

fn model143_rank_cut_discard_scores(
    keep: &[Card],
    discard: &[Card],
    deck: &[Card],
    role: Role,
    crib_policy: TripolicyPolicy,
    crib_flush_bonus_by_suit: &[f64; 4],
    crib_tripolicy: &CribTripolicyTable,
    crib_rank: &CribRankDiscardTables,
) -> (f64, f64) {
    let mut hand_total = 0.0;
    let mut crib_total = 0.0;
    for cut in deck {
        hand_total += score_hand_rank_only(keep, *cut) as f64
            + score_flush_and_right_jack(keep, *cut, false) as f64;
        crib_total += model143_rank_cut_crib_score(
            discard,
            role,
            *cut,
            crib_policy,
            crib_tripolicy,
            crib_rank,
        );
    }
    let count = deck.len().max(1) as f64;
    (
        hand_total / count,
        (crib_total / count) + expected_crib_flush_bonus(discard, crib_flush_bonus_by_suit),
    )
}

fn model143_rank_cut_crib_score(
    discard: &[Card],
    role: Role,
    cut: Card,
    crib_policy: TripolicyPolicy,
    crib_tripolicy: &CribTripolicyTable,
    crib_rank: &CribRankDiscardTables,
) -> f64 {
    let discard_key = rank_count_key(&rank_counts(discard));
    crib_tripolicy
        .entry(role_index(role), &discard_key, cut.rank, crib_policy)
        .map(|entry| entry.average as f64)
        .or_else(|| crib_rank.rank_score(role_index(role), &discard_key, cut.rank))
        .unwrap_or(0.0)
}

fn model143_pegging_discard_options(
    keep: &[Card],
    role: Role,
    known_cards: &[Card],
    pairwise: &PairwiseTable,
) -> Vec<Model13PeggingOption> {
    let mut options = Vec::new();
    for policy in [
        TripolicyPolicy::Ev,
        TripolicyPolicy::On,
        TripolicyPolicy::Off,
    ] {
        if role == Role::Dealer {
            if let Some(summary) = aggregate_pairwise_pegging_summary_policy(
                keep,
                role,
                known_cards,
                None,
                pairwise,
                policy,
            ) {
                options.push(summary);
            }
            continue;
        }
        let keep_ranks = rank_counts(keep);
        for lead_rank in legal_peg_ranks(&keep_ranks, 0) {
            if let Some(summary) = aggregate_pairwise_pegging_summary_policy(
                keep,
                role,
                known_cards,
                Some(lead_rank),
                pairwise,
                policy,
            ) {
                options.push(summary);
            }
        }
    }
    options
}

#[allow(clippy::too_many_arguments)]
fn model143_discard_candidate_win_probability(
    full_hand: &[Card],
    keep: &[Card],
    discard: &[Card],
    cut_options: &[CutRankOption],
    role: Role,
    opponent_role: Role,
    next_role: Role,
    pegging: &Model13PeggingOption,
    crib_policy: TripolicyPolicy,
    player_score: i32,
    opponent_score: i32,
    hold: &Model13HoldTable,
    crib_tripolicy14: &CribTripolicyTable,
    crib_rank: &CribRankDiscardTables,
    memo: &mut DiscardMemo,
    board: &mut BoardModel,
) -> f64 {
    let pegging_weight_total = pegging.total_weight.max(1.0);
    let mut base_outcomes = WeightedPairI32::default();
    let available_cards = full_deck()
        .into_iter()
        .filter(|card| !full_hand.iter().any(|held| held.id == card.id))
        .collect::<Vec<_>>();
    for cut in cut_options {
        let own_hand_score = (score_hand_rank_only(keep, cut.card) as f64
            + expected_known_hand_suit_bonus_for_cut_rank(keep, cut, false))
        .round() as i32;
        let opponent_distribution = model143_opponent_hand_distribution_for_cut_rank(
            full_hand,
            cut,
            opponent_role,
            &available_cards,
            hold,
            memo,
        );
        let crib_outcomes = model143_crib_score_outcomes_for_cut_rank(
            discard,
            role,
            cut,
            full_hand,
            crib_tripolicy14,
            crib_rank,
            crib_policy,
        );
        for (crib_score, crib_weight) in &crib_outcomes {
            for (opponent_hand_score, opponent_hand_weight) in &opponent_distribution {
                let my_base = own_hand_score + if role == Role::Dealer { *crib_score } else { 0 };
                let opponent_base =
                    *opponent_hand_score + if role == Role::Dealer { 0 } else { *crib_score };
                add_weight_pair_i32(
                    &mut base_outcomes,
                    (my_base, opponent_base),
                    cut.weight * *crib_weight * *opponent_hand_weight,
                );
            }
        }
    }

    let mut total = 0.0;
    let mut total_weight = 0.0;
    for ((my_pegging, opponent_pegging), pegging_weight) in &pegging.hist.entries {
        let normalized_pegging_weight = *pegging_weight / pegging_weight_total;
        for ((my_base, opponent_base), base_weight) in &base_outcomes.entries {
            let weight = normalized_pegging_weight * *base_weight;
            total += weight
                * board.future_win_probability_from_scores(
                    player_score + *my_pegging + *my_base,
                    opponent_score + *opponent_pegging + *opponent_base,
                    next_role,
                    ScorePhase::PeggingPone,
                );
            total_weight += weight;
        }
    }
    if total_weight > 0.0 {
        total / total_weight
    } else {
        0.5
    }
}

fn model143_opponent_hand_distribution_for_cut_rank(
    full_hand: &[Card],
    cut: &CutRankOption,
    opponent_role: Role,
    available_cards: &[Card],
    hold: &Model13HoldTable,
    memo: &mut DiscardMemo,
) -> Vec<(i32, f64)> {
    let cache_key = format!(
        "14.3:{}:{}:{}:{}",
        role_name(opponent_role),
        card_set_key(full_hand),
        cut.rank,
        cut.cards
            .iter()
            .map(|card| card.id.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );
    if let Some(cached) = memo.opponent_hand_score_outcomes.get(&cache_key) {
        return cached.clone();
    }
    let mut available_ranks = remaining_rank_counts(full_hand);
    available_ranks[cut.rank as usize] = available_ranks[cut.rank as usize].saturating_sub(1);
    let opponent_hands =
        opponent_rank_hands_for_engine(&available_ranks, 4, &[], opponent_role, hold, true);
    let mut outcomes: BTreeMap<i32, f64> = BTreeMap::new();
    let mut total_weight = 0.0;
    for hand in opponent_hands {
        let rank_only_hand = cards_for_rank_counts_for_scoring(&hand.ranks);
        let score = score_hand_rank_only(&rank_only_hand, cut.card) as f64
            + expected_rank_hand_suit_bonus_for_cut_rank(&hand.ranks, cut, available_cards);
        *outcomes.entry(score.round() as i32).or_insert(0.0) += hand.weight;
        total_weight += hand.weight;
    }
    let result = if total_weight > 0.0 {
        normalized_score_outcomes(&outcomes, total_weight)
    } else {
        vec![(
            score_phase_average(if opponent_role == Role::Dealer {
                ScorePhase::HandDealer
            } else {
                ScorePhase::HandPone
            })
            .round() as i32,
            1.0,
        )]
    };
    memo.opponent_hand_score_outcomes
        .insert(cache_key, result.clone());
    result
}

#[allow(clippy::too_many_arguments)]
fn model143_crib_score_outcomes_for_cut_rank(
    discard: &[Card],
    role: Role,
    cut: &CutRankOption,
    seen_cards: &[Card],
    crib_tripolicy: &CribTripolicyTable,
    crib_rank: &CribRankDiscardTables,
    policy: TripolicyPolicy,
) -> Vec<(i32, f64)> {
    let discard_key = rank_count_key(&rank_counts(discard));
    let Some(entry) = crib_tripolicy.entry(role_index(role), &discard_key, cut.rank, policy) else {
        let fallback = model143_rank_cut_crib_score(
            discard,
            role,
            cut.card,
            policy,
            crib_tripolicy,
            crib_rank,
        ) + expected_known_hand_suit_bonus_for_cut_rank(discard, cut, true);
        return vec![(fallback.round() as i32, 1.0)];
    };
    let mut available_ranks = remaining_rank_counts(seen_cards);
    available_ranks[cut.rank as usize] = available_ranks[cut.rank as usize].saturating_sub(1);
    let available_cards = full_deck()
        .into_iter()
        .filter(|card| !seen_cards.iter().any(|seen| seen.id == card.id))
        .collect::<Vec<_>>();
    let mut outcomes: BTreeMap<i32, f64> = BTreeMap::new();
    let mut total_weight = 0.0;
    for opponent_discard in &entry.opponent_discards {
        let availability_scale = rank_combination_count(&opponent_discard.ranks, &available_ranks)
            / rank_combination_count(&opponent_discard.ranks, &[4u8; 13]).max(1.0);
        let adjusted_weight = opponent_discard.weight as f64 * availability_scale;
        if adjusted_weight <= 0.0 {
            continue;
        }
        let score = opponent_discard.rank_score as f64
            + expected_crib_suit_bonus_for_cut_rank(
                discard,
                &opponent_discard.ranks,
                cut,
                &available_cards,
            );
        *outcomes.entry(score.round() as i32).or_insert(0.0) += adjusted_weight;
        total_weight += adjusted_weight;
    }
    if total_weight == 0.0 {
        let fallback = model143_rank_cut_crib_score(
            discard,
            role,
            cut.card,
            policy,
            crib_tripolicy,
            crib_rank,
        ) + expected_known_hand_suit_bonus_for_cut_rank(discard, cut, true);
        return vec![(fallback.round() as i32, 1.0)];
    }
    normalized_score_outcomes(&outcomes, total_weight)
}

fn model13_pegging_discard_options(
    keep: &[Card],
    role: Role,
    known_cards: &[Card],
    pairwise: &PairwiseTable,
) -> Vec<Model13PeggingOption> {
    if role == Role::Dealer {
        return aggregate_pairwise_pegging_summary(keep, role, known_cards, None, pairwise)
            .into_iter()
            .collect();
    }
    let keep_ranks = rank_counts(keep);
    let mut best: Option<Model13PeggingOption> = None;
    for lead_rank in legal_peg_ranks(&keep_ranks, 0) {
        let Some(summary) =
            aggregate_pairwise_pegging_summary(keep, role, known_cards, Some(lead_rank), pairwise)
        else {
            continue;
        };
        let should_replace = match &best {
            None => true,
            Some(current) => compare_model13_lead_summary(&summary, current) > 0,
        };
        if should_replace {
            best = Some(summary);
        }
    }
    best.into_iter().collect()
}

fn aggregate_pairwise_pegging_summary(
    keep: &[Card],
    role: Role,
    known_cards: &[Card],
    lead_rank: Option<u8>,
    pairwise: &PairwiseTable,
) -> Option<Model13PeggingOption> {
    let keep_key = rank_count_key(&rank_counts(keep));
    let keep_id = pairwise.keep_id_by_key.get(&keep_key).copied()?;
    let available = remaining_rank_counts(known_cards);
    let range = if role == Role::Dealer {
        pairwise.dealer_record_range(keep_id)?
    } else {
        pairwise.pone_record_range(keep_id, lead_rank? as usize)?
    };
    let mut hist = WeightedPairI32::default();
    let mut total_weight = 0.0;
    let mut my_total = 0.0;
    let mut opponent_total = 0.0;
    for index in range {
        let record = if role == Role::Dealer {
            pairwise.dealer_record(index)?
        } else {
            pairwise.pone_record(index)?
        };
        let weight = pairwise.opponent_keep_weight(&available, record.opponent_keep_id as usize);
        if weight <= 0.0 {
            continue;
        }
        let my_pegging = record.my_pegging as i32;
        let opponent_pegging = record.opponent_pegging as i32;
        add_weight_pair_i32(&mut hist, (my_pegging, opponent_pegging), weight);
        total_weight += weight;
        my_total += my_pegging as f64 * weight;
        opponent_total += opponent_pegging as f64 * weight;
    }
    if total_weight == 0.0 {
        return None;
    }
    Some(Model13PeggingOption {
        my_ev: my_total / total_weight,
        opponent_ev: opponent_total / total_weight,
        best_lead: lead_rank.map(|rank| rank as i8).unwrap_or(-1),
        hist,
        total_weight,
    })
}

fn aggregate_pairwise_pegging_summary_policy(
    keep: &[Card],
    role: Role,
    known_cards: &[Card],
    lead_rank: Option<u8>,
    pairwise: &PairwiseTable,
    policy: TripolicyPolicy,
) -> Option<Model13PeggingOption> {
    let keep_key = rank_count_key(&rank_counts(keep));
    let keep_id = pairwise.keep_id_by_key.get(&keep_key).copied()?;
    let available = remaining_rank_counts(known_cards);
    let range = if role == Role::Dealer {
        pairwise.dealer_record_range(keep_id)?
    } else {
        pairwise.pone_record_range(keep_id, lead_rank? as usize)?
    };
    let mut hist = WeightedPairI32::default();
    let mut total_weight = 0.0;
    let mut my_total = 0.0;
    let mut opponent_total = 0.0;
    for index in range {
        let record = if role == Role::Dealer {
            pairwise.dealer_record_for_policy(index, policy)?
        } else {
            pairwise.pone_record_for_policy(index, policy)?
        };
        let weight = pairwise.opponent_keep_weight(&available, record.opponent_keep_id as usize);
        if weight <= 0.0 {
            continue;
        }
        let my_pegging = record.my_pegging as i32;
        let opponent_pegging = record.opponent_pegging as i32;
        add_weight_pair_i32(&mut hist, (my_pegging, opponent_pegging), weight);
        total_weight += weight;
        my_total += my_pegging as f64 * weight;
        opponent_total += opponent_pegging as f64 * weight;
    }
    if total_weight == 0.0 {
        return None;
    }
    Some(Model13PeggingOption {
        my_ev: my_total / total_weight,
        opponent_ev: opponent_total / total_weight,
        best_lead: lead_rank.map(|rank| rank as i8).unwrap_or(-1),
        hist,
        total_weight,
    })
}

fn compare_model13_lead_summary(
    candidate: &Model13PeggingOption,
    current: &Model13PeggingOption,
) -> i32 {
    let candidate_net = candidate.my_ev - candidate.opponent_ev;
    let current_net = current.my_ev - current.opponent_ev;
    if candidate_net > current_net {
        return 1;
    }
    if candidate_net < current_net {
        return -1;
    }
    if candidate.my_ev > current.my_ev {
        return 1;
    }
    if candidate.my_ev < current.my_ev {
        return -1;
    }
    let candidate_value = if candidate.best_lead >= 0 {
        peg_card_for_rank(candidate.best_lead as u8).value
    } else {
        0
    };
    let current_value = if current.best_lead >= 0 {
        peg_card_for_rank(current.best_lead as u8).value
    } else {
        0
    };
    current_value.cmp(&candidate_value) as i32
}

fn crib_flush_bonuses_by_suit(hand: &[Card]) -> [f64; 4] {
    const CRIB_FLUSH_BONUS_BY_SUIT_COUNT: [f64; 7] = [
        0.094202898551,
        0.072463768116,
        0.054347826087,
        0.0395256917,
        0.02766798419,
        0.018445322793,
        0.011528326746,
    ];
    let mut suit_counts = [0usize; 4];
    for card in hand {
        suit_counts[card.suit as usize] += 1;
    }
    let mut bonuses = [0.0; 4];
    for suit in 0..4 {
        bonuses[suit] = *CRIB_FLUSH_BONUS_BY_SUIT_COUNT
            .get(suit_counts[suit])
            .unwrap_or(&0.0);
    }
    bonuses
}

fn expected_crib_flush_bonus(discard: &[Card], crib_flush_bonus_by_suit: &[f64; 4]) -> f64 {
    if discard.len() != 2 || discard[0].suit != discard[1].suit {
        return 0.0;
    }
    crib_flush_bonus_by_suit[discard[0].suit as usize]
}

fn card_id_set(cards: &[Card]) -> [bool; 52] {
    let mut seen = [false; 52];
    for card in cards {
        seen[card.id as usize] = true;
    }
    seen
}

#[derive(Clone)]
struct CandidateEvaluation {
    win_probability: f64,
    total_ev: f64,
    best_lead: i8,
}

fn empirical_discard_candidate_groups(
    hand: &[Card],
    opponent_role: Role,
    cut_options: &[CutRankOption],
    deck: &[Card],
    table: &EmpiricalDiscardKeepTable,
    memo: &mut DiscardMemo,
    group_equivalent_candidates: bool,
) -> Vec<DiscardCandidateGroup> {
    let mut groups: Vec<DiscardCandidateGroup> = Vec::new();
    let base_available_ranks = remaining_rank_counts(hand);
    for discard_indices in crate::cards::combinations_indices(hand.len(), 2) {
        let mut is_discarded = vec![false; hand.len()];
        for index in &discard_indices {
            is_discarded[*index] = true;
        }
        let discard: Vec<Card> = discard_indices.iter().map(|index| hand[*index]).collect();
        let keep: Vec<Card> = hand
            .iter()
            .enumerate()
            .filter_map(|(index, card)| {
                if is_discarded[index] {
                    None
                } else {
                    Some(*card)
                }
            })
            .collect();
        let key = if group_equivalent_candidates {
            empirical_discard_candidate_equivalence_key(
                &keep,
                &discard,
                opponent_role,
                cut_options,
                deck,
                &base_available_ranks,
                table,
                memo,
            )
        } else {
            card_set_key(&discard)
        };
        if !groups.iter().any(|group| group.key == key) {
            groups.push(DiscardCandidateGroup { key, discard, keep });
        }
    }
    groups
}

#[allow(clippy::too_many_arguments)]
fn empirical_discard_candidate_equivalence_key(
    keep: &[Card],
    discard: &[Card],
    opponent_role: Role,
    cut_options: &[CutRankOption],
    deck: &[Card],
    base_available_ranks: &[u8; 13],
    table: &EmpiricalDiscardKeepTable,
    memo: &mut DiscardMemo,
) -> String {
    let keep_ranks = rank_counts(keep);
    let keep_key = rank_count_key(&keep_ranks);
    let discard_key = rank_count_key(&rank_counts(discard));
    let mut parts = vec![
        format!("keep={}", keep_key),
        format!("discard={}", discard_key),
    ];
    for cut in cut_options {
        if base_available_ranks[cut.rank as usize] == 0 {
            continue;
        }
        let mut available_ranks = *base_available_ranks;
        available_ranks[cut.rank as usize] = available_ranks[cut.rank as usize].saturating_sub(1);
        let own_hand = empirical_own_hand_score_outcomes_for_cut_rank(keep, &keep_key, cut, memo);
        let crib = empirical_crib_score_outcomes_for_cut_rank(
            discard,
            opponent_role,
            cut,
            &available_ranks,
            deck,
            table,
            memo,
        );
        parts.push(format!(
            "{}:own={};crib={}",
            cut.rank,
            empirical_score_outcome_signature(&own_hand.outcomes),
            empirical_score_outcome_signature(&crib.outcomes),
        ));
    }
    parts.join("|")
}

fn empirical_score_outcome_signature(outcomes: &[(i32, f64)]) -> String {
    outcomes
        .iter()
        .map(|(score, weight)| format!("{}:{}", score, weight))
        .collect::<Vec<_>>()
        .join(",")
}

#[allow(clippy::too_many_arguments)]
fn evaluate_discard_candidate(
    full_hand: &[Card],
    keep: &[Card],
    discard: &[Card],
    role: Role,
    opponent_role: Role,
    next_role: Role,
    empirical: &EmpiricalDiscardKeepTable,
    pairwise: &PairwiseTable,
    cut_options: &[CutRankOption],
    deck: &[Card],
    player_score: i32,
    opponent_score: i32,
    ordered_current_hand_scoring: bool,
    memo: &mut DiscardMemo,
    board: &mut BoardModel,
) -> Option<CandidateEvaluation> {
    let keep_ranks = rank_counts(keep);
    let keep_key = rank_count_key(&keep_ranks);
    let base_available_ranks = remaining_rank_counts(full_hand);
    let mut lead_evaluations: BTreeMap<i8, LeadEvaluation> = BTreeMap::new();

    for cut in cut_options {
        if base_available_ranks[cut.rank as usize] == 0 {
            continue;
        }
        let mut available_ranks = base_available_ranks;
        available_ranks[cut.rank as usize] = available_ranks[cut.rank as usize].saturating_sub(1);
        let own_hand = empirical_own_hand_score_outcomes_for_cut_rank(keep, &keep_key, cut, memo);
        if own_hand.outcomes.is_empty() {
            continue;
        }
        let crib = empirical_crib_score_outcomes_for_cut_rank(
            discard,
            opponent_role,
            cut,
            &available_ranks,
            deck,
            empirical,
            memo,
        );
        if crib.outcomes.is_empty() {
            continue;
        }
        let lead_cut_outcomes = empirical_keep_lead_outcomes_for_cut_rank(
            &keep_ranks,
            &keep_key,
            role,
            opponent_role,
            cut,
            &available_ranks,
            deck,
            &own_hand.outcomes,
            pairwise,
            empirical,
            memo,
            ordered_current_hand_scoring,
        );
        for (lead_rank, lead_cut) in lead_cut_outcomes {
            if lead_cut.total_weight == 0.0 {
                continue;
            }
            let accumulator = lead_evaluations.entry(lead_rank).or_default();
            accumulator.total_weight += lead_cut.total_weight * cut.weight;
            accumulator.own_hand_total += lead_cut.own_hand_total * cut.weight;
            accumulator.opponent_hand_total += lead_cut.opponent_hand_total * cut.weight;
            accumulator.crib_total += crib.average * lead_cut.total_weight * cut.weight;
            accumulator.own_pegging_total += lead_cut.own_pegging_total * cut.weight;
            accumulator.opponent_pegging_total += lead_cut.opponent_pegging_total * cut.weight;
            if ordered_current_hand_scoring {
                for (outcome, outcome_weight) in lead_cut.current_hand_outcomes.entries {
                    for (crib_score, crib_weight) in &crib.outcomes {
                        let scenario_weight = outcome_weight * *crib_weight * cut.weight;
                        accumulator.ordered_win_probability_total += scenario_weight
                            * ordered_current_hand_win_probability(
                                board,
                                player_score,
                                opponent_score,
                                role,
                                next_role,
                                outcome,
                                *crib_score,
                            );
                    }
                }
            } else {
                for ((own_base, opponent_base), base_weight) in lead_cut.base_outcomes.entries {
                    for (crib_score, crib_weight) in &crib.outcomes {
                        let own_round_score =
                            own_base + if role == Role::Dealer { *crib_score } else { 0 };
                        let opponent_round_score =
                            opponent_base + if role == Role::Dealer { 0 } else { *crib_score };
                        let scenario_weight = base_weight * *crib_weight * cut.weight;
                        let key = score_pair_i32(
                            player_score + own_round_score,
                            opponent_score + opponent_round_score,
                        );
                        add_weight_pair_u8(
                            &mut accumulator.win_probability_outcomes,
                            key,
                            scenario_weight,
                        );
                    }
                }
            }
        }
    }

    let mut best: Option<CandidateEvaluation> = None;
    for (lead_rank, accumulator) in lead_evaluations {
        if accumulator.total_weight == 0.0 {
            continue;
        }
        let hand_score = accumulator.own_hand_total / accumulator.total_weight;
        let crib_score = accumulator.crib_total / accumulator.total_weight;
        let net_pegging = (accumulator.own_pegging_total - accumulator.opponent_pegging_total)
            / accumulator.total_weight;
        let total_ev = (if role == Role::Dealer {
            hand_score + crib_score
        } else {
            hand_score - crib_score
        }) + net_pegging;
        let win_probability_total = if ordered_current_hand_scoring {
            accumulator.ordered_win_probability_total
        } else {
            accumulator
                .win_probability_outcomes
                .entries
                .iter()
                .map(|((my_score, future_opponent_score), weight)| {
                    *weight
                        * board.future_win_probability_from_scores(
                            i32::from(*my_score),
                            i32::from(*future_opponent_score),
                            next_role,
                            ScorePhase::PeggingPone,
                        )
                })
                .sum()
        };
        let win_probability = win_probability_total / accumulator.total_weight;
        let candidate = CandidateEvaluation {
            win_probability,
            total_ev,
            best_lead: lead_rank,
        };
        let should_replace = match &best {
            None => true,
            Some(current) => {
                candidate.win_probability > current.win_probability
                    || (candidate.win_probability == current.win_probability
                        && candidate.total_ev > current.total_ev)
                    || (candidate.win_probability == current.win_probability
                        && candidate.total_ev == current.total_ev
                        && lead_tie_value(candidate.best_lead) < lead_tie_value(current.best_lead))
            }
        };
        if should_replace {
            best = Some(candidate);
        }
    }
    best
}

#[allow(clippy::too_many_arguments)]
fn ordered_current_hand_win_probability(
    board: &mut BoardModel,
    player_score: i32,
    opponent_score: i32,
    role: Role,
    next_role: Role,
    outcome: CurrentHandOutcome,
    crib_score: i32,
) -> f64 {
    if player_score >= 121 {
        return 1.0;
    }
    if opponent_score >= 121 {
        return 0.0;
    }

    // The pairwise table retains only aggregate pegging totals, not the
    // card-by-card scoring chronology. A one-sided count-out is exact; when
    // both aggregates cross 121, retain 15.2's neutral joint ambiguity rule.
    let mut my_score = player_score + outcome.own_pegging;
    let mut their_score = opponent_score + outcome.opponent_pegging;
    match (my_score >= 121, their_score >= 121) {
        (true, false) => return 1.0,
        (false, true) => return 0.0,
        (true, true) => return 0.5,
        (false, false) => {}
    }

    // Pone counts first, regardless of which side is the model perspective.
    if role == Role::Pone {
        my_score += outcome.own_hand;
        if my_score >= 121 {
            return 1.0;
        }
    } else {
        their_score += outcome.opponent_hand;
        if their_score >= 121 {
            return 0.0;
        }
    }

    // Dealer counts only if pone did not go out.
    if role == Role::Dealer {
        my_score += outcome.own_hand;
        if my_score >= 121 {
            return 1.0;
        }
    } else {
        their_score += outcome.opponent_hand;
        if their_score >= 121 {
            return 0.0;
        }
    }

    // The dealer's crib is the final scoring event in the current hand.
    if role == Role::Dealer {
        my_score += crib_score;
        if my_score >= 121 {
            return 1.0;
        }
    } else {
        their_score += crib_score;
        if their_score >= 121 {
            return 0.0;
        }
    }

    board.future_win_probability_from_scores(
        my_score,
        their_score,
        next_role,
        ScorePhase::PeggingPone,
    )
}

#[allow(clippy::too_many_arguments)]
fn empirical_keep_lead_outcomes_for_cut_rank(
    keep_ranks: &[u8; 13],
    keep_key: &str,
    role: Role,
    opponent_role: Role,
    cut: &CutRankOption,
    available_ranks: &[u8; 13],
    available_cards: &[Card],
    own_hand_outcomes: &[(i32, f64)],
    pairwise: &PairwiseTable,
    table: &EmpiricalDiscardKeepTable,
    memo: &mut DiscardMemo,
    ordered_current_hand_scoring: bool,
) -> BTreeMap<i8, LeadCutAccumulator> {
    let role_table = empirical_role(table, opponent_role);
    let cache_key = format!(
        "{}:{}",
        role_name(opponent_role),
        rank_count_key(available_ranks)
    );
    let entries = adjusted_empirical_entries(
        &role_table.keeps,
        available_ranks,
        &mut memo.adjusted_keeps,
        &cache_key,
        4,
        0.0,
    );
    let mut lead_outcomes: BTreeMap<i8, LeadCutAccumulator> = BTreeMap::new();
    for entry in entries {
        let opponent_hand_outcomes =
            empirical_opponent_hand_score_outcomes_for_cut_rank(&entry, cut, available_cards, memo);
        if opponent_hand_outcomes.is_empty() {
            continue;
        }
        let pegging_options_key = format!("{}:{}:{}", role_name(role), keep_key, entry.key);
        let pegging_options = if let Some(cached) = memo.pegging_options.get(&pegging_options_key) {
            cached.clone()
        } else {
            let options =
                pairwise_pegging_options_for_keeps(pairwise, keep_ranks, role, &entry.ranks);
            memo.pegging_options
                .insert(pegging_options_key, options.clone());
            options
        };
        if pegging_options.is_empty() {
            continue;
        }
        for pegging in pegging_options {
            let accumulator = lead_outcomes.entry(pegging.lead_rank).or_default();
            for (opponent_hand_score, opponent_hand_weight) in &opponent_hand_outcomes {
                for (own_hand_score, own_hand_weight) in own_hand_outcomes {
                    let weight = entry.weight * *opponent_hand_weight * *own_hand_weight;
                    if ordered_current_hand_scoring {
                        add_weight_current_hand_outcome(
                            &mut accumulator.current_hand_outcomes,
                            CurrentHandOutcome {
                                own_pegging: pegging.own_pegging,
                                opponent_pegging: pegging.opponent_pegging,
                                own_hand: *own_hand_score,
                                opponent_hand: *opponent_hand_score,
                            },
                            weight,
                        );
                    } else {
                        add_weight_pair_i32(
                            &mut accumulator.base_outcomes,
                            (
                                *own_hand_score + pegging.own_pegging,
                                *opponent_hand_score + pegging.opponent_pegging,
                            ),
                            weight,
                        );
                    }
                    accumulator.total_weight += weight;
                    accumulator.own_hand_total += *own_hand_score as f64 * weight;
                    accumulator.opponent_hand_total += *opponent_hand_score as f64 * weight;
                    accumulator.own_pegging_total += pegging.own_pegging as f64 * weight;
                    accumulator.opponent_pegging_total += pegging.opponent_pegging as f64 * weight;
                }
            }
        }
    }
    lead_outcomes
}

fn empirical_opponent_hand_score_outcomes_for_cut_rank(
    entry: &WeightedEntry,
    cut: &CutRankOption,
    available_cards: &[Card],
    memo: &mut DiscardMemo,
) -> Vec<(i32, f64)> {
    let cache_key = format!(
        "{}:rank:{}:{}:{}",
        entry.key,
        cut.rank,
        cut.cards
            .iter()
            .map(|card| card.id.to_string())
            .collect::<Vec<_>>()
            .join(","),
        ids_key(available_cards)
    );
    if let Some(cached) = memo.opponent_hand_score_outcomes.get(&cache_key) {
        return cached.clone();
    }
    let mut outcomes: BTreeMap<i32, f64> = BTreeMap::new();
    let cut_card_weight = 1.0 / cut.cards.len().max(1) as f64;
    let mut total_weight = 0.0;
    for cut_card in &cut.cards {
        let filtered: Vec<Card> = available_cards
            .iter()
            .copied()
            .filter(|card| card.id != cut_card.id)
            .collect();
        let card_outcomes =
            empirical_opponent_hand_score_outcomes(entry, *cut_card, &filtered, memo);
        for (score, weight) in card_outcomes {
            let adjusted_weight = weight * cut_card_weight;
            *outcomes.entry(score).or_insert(0.0) += adjusted_weight;
            total_weight += adjusted_weight;
        }
    }
    let result = if total_weight > 0.0 {
        normalized_score_outcomes(&outcomes, total_weight)
    } else {
        Vec::new()
    };
    memo.opponent_hand_score_outcomes
        .insert(cache_key, result.clone());
    result
}

fn empirical_opponent_hand_score_outcomes(
    entry: &WeightedEntry,
    cut_card: Card,
    available_cards: &[Card],
    memo: &mut DiscardMemo,
) -> Vec<(i32, f64)> {
    let cache_key = format!("{}:{}:{}", entry.key, cut_card.id, ids_key(available_cards));
    if let Some(cached) = memo.opponent_hand_score_outcomes.get(&cache_key) {
        return cached.clone();
    }
    let rank_score = score_hand_rank_only(&entry.scoring_cards, cut_card) as i32;
    let suit_bonuses =
        rank_hand_suit_bonus_outcomes_for_cut_card(&entry.ranks, cut_card, available_cards);
    let mut outcomes: BTreeMap<i32, f64> = BTreeMap::new();
    for (bonus, weight) in &suit_bonuses {
        *outcomes.entry(rank_score + *bonus).or_insert(0.0) += *weight;
    }
    let result = if suit_bonuses.is_empty() {
        Vec::new()
    } else {
        normalized_score_outcomes(&outcomes, 1.0)
    };
    memo.opponent_hand_score_outcomes
        .insert(cache_key, result.clone());
    result
}

fn empirical_own_hand_score_outcomes_for_cut_rank(
    keep: &[Card],
    keep_key: &str,
    cut: &CutRankOption,
    memo: &mut DiscardMemo,
) -> ScoreOutcomeResult {
    let cache_key = format!(
        "{}:{}:{}",
        keep_key,
        cut.rank,
        cut.cards
            .iter()
            .map(|card| card.id.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );
    if let Some(cached) = memo.own_hand_score_outcomes.get(&cache_key) {
        return cached.clone();
    }
    let mut outcomes: BTreeMap<i32, f64> = BTreeMap::new();
    for cut_card in &cut.cards {
        let score = score_hand_rank_only(keep, *cut_card)
            + score_flush_and_right_jack(keep, *cut_card, false);
        *outcomes.entry(score as i32).or_insert(0.0) += 1.0;
    }
    let result = score_outcome_result(&outcomes, cut.cards.len().max(1) as f64);
    memo.own_hand_score_outcomes
        .insert(cache_key, result.clone());
    result
}

#[allow(clippy::too_many_arguments)]
fn empirical_crib_score_outcomes_for_cut_rank(
    discard: &[Card],
    opponent_role: Role,
    cut: &CutRankOption,
    available_ranks: &[u8; 13],
    available_cards: &[Card],
    table: &EmpiricalDiscardKeepTable,
    memo: &mut DiscardMemo,
) -> ScoreOutcomeResult {
    let cache_key = format!(
        "{}:{}:rank:{}:{}:{}:{}",
        role_name(opponent_role),
        card_set_key(discard),
        cut.rank,
        cut.cards
            .iter()
            .map(|card| card.id.to_string())
            .collect::<Vec<_>>()
            .join(","),
        rank_count_key(available_ranks),
        ids_key(available_cards)
    );
    if let Some(cached) = memo.crib_score_outcomes.get(&cache_key) {
        return cached.clone();
    }
    let mut outcomes: BTreeMap<i32, f64> = BTreeMap::new();
    let cut_card_weight = 1.0 / cut.cards.len().max(1) as f64;
    let mut total_weight = 0.0;
    for cut_card in &cut.cards {
        let filtered: Vec<Card> = available_cards
            .iter()
            .copied()
            .filter(|card| card.id != cut_card.id)
            .collect();
        let card_result = empirical_crib_score_outcomes_for_cut_card(
            discard,
            opponent_role,
            *cut_card,
            available_ranks,
            &filtered,
            table,
            memo,
        );
        for (score, weight) in card_result.outcomes {
            let adjusted_weight = weight * cut_card_weight;
            *outcomes.entry(score).or_insert(0.0) += adjusted_weight;
            total_weight += adjusted_weight;
        }
    }
    let result = score_outcome_result(&outcomes, total_weight);
    memo.crib_score_outcomes.insert(cache_key, result.clone());
    result
}

#[allow(clippy::too_many_arguments)]
fn empirical_crib_score_outcomes_for_cut_card(
    discard: &[Card],
    opponent_role: Role,
    cut_card: Card,
    available_ranks: &[u8; 13],
    available_cards: &[Card],
    table: &EmpiricalDiscardKeepTable,
    memo: &mut DiscardMemo,
) -> ScoreOutcomeResult {
    let cache_key = format!(
        "{}:{}:{}:{}",
        role_name(opponent_role),
        card_set_key(discard),
        cut_card.id,
        ids_key(available_cards)
    );
    if let Some(cached) = memo.crib_score_outcomes.get(&cache_key) {
        return cached.clone();
    }
    let role_table = empirical_role(table, opponent_role);
    let entries = adjusted_empirical_entries(
        &role_table.discards,
        available_ranks,
        &mut memo.adjusted_discards,
        &format!(
            "{}:{}",
            role_name(opponent_role),
            rank_count_key(available_ranks)
        ),
        2,
        if role_table.distinct_suited_discard_rate != 0.0 {
            role_table.distinct_suited_discard_rate
        } else {
            role_table.suited_discard_rate
        },
    );
    let mut outcomes: BTreeMap<i32, f64> = BTreeMap::new();
    let mut total_weight = 0.0;
    let mut total = 0.0;
    for entry in entries {
        let mut crib_rank_cards = discard.to_vec();
        crib_rank_cards.extend(entry.scoring_cards.iter().copied());
        let rank_score = score_hand_rank_only(&crib_rank_cards, cut_card) as i32;
        let suited_discards = cards_for_rank_counts(available_cards, &entry.ranks);
        if suited_discards.is_empty() {
            continue;
        }
        let mut suited = Vec::new();
        let mut unsuited = Vec::new();
        for opponent_discard in suited_discards {
            if rank_pair_can_be_suited(&entry.ranks)
                && opponent_discard[0].suit == opponent_discard[1].suit
            {
                suited.push(opponent_discard);
            } else {
                unsuited.push(opponent_discard);
            }
        }
        let (suited_weight, unsuited_weight) =
            empirical_suited_split_weights(&entry, role_table, suited.len(), unsuited.len());
        for (group, group_weight) in [(&suited, suited_weight), (&unsuited, unsuited_weight)] {
            if group.is_empty() || group_weight <= 0.0 {
                continue;
            }
            let per_combo_weight = group_weight / group.len() as f64;
            for opponent_discard in group {
                let score = rank_score + crib_suit_bonus(discard, opponent_discard, cut_card);
                *outcomes.entry(score).or_insert(0.0) += per_combo_weight;
                total += score as f64 * per_combo_weight;
                total_weight += per_combo_weight;
            }
        }
    }
    let result = if total_weight > 0.0 {
        ScoreOutcomeResult {
            outcomes: normalized_score_outcomes(&outcomes, total_weight),
            average: total / total_weight,
        }
    } else {
        ScoreOutcomeResult {
            outcomes: Vec::new(),
            average: 0.0,
        }
    };
    memo.crib_score_outcomes.insert(cache_key, result.clone());
    result
}

fn adjusted_empirical_entries(
    entries: &[EmpiricalEntry],
    available_ranks: &[u8; 13],
    cache: &mut HashMap<String, Vec<WeightedEntry>>,
    cache_key: &str,
    fallback_size: u8,
    fallback_suited_rate: f64,
) -> Vec<WeightedEntry> {
    if let Some(cached) = cache.get(cache_key) {
        return cached.clone();
    }
    let mut adjusted: Vec<WeightedEntry> = entries
        .iter()
        .filter_map(|entry| {
            let available_combinations = rank_combination_count(&entry.ranks, available_ranks);
            let weight =
                entry.count as f64 * (available_combinations / entry.full_combination_count);
            if weight <= 0.0 {
                return None;
            }
            Some(WeightedEntry {
                key: entry.key.clone(),
                ranks: entry.ranks,
                count: entry.count,
                suited_rate: Some(entry.suited_rate),
                full_combination_count: entry.full_combination_count,
                scoring_cards: cards_for_rank_counts_for_scoring(&entry.ranks),
                weight,
            })
        })
        .collect();
    if adjusted.is_empty() {
        adjusted = crate::cards::enumerate_rank_hands(available_ranks, fallback_size)
            .into_iter()
            .filter_map(|(ranks, weight)| {
                if weight <= 0.0 {
                    return None;
                }
                Some(WeightedEntry {
                    key: rank_count_key(&ranks),
                    ranks,
                    count: 0,
                    suited_rate: if fallback_size == 2 {
                        Some(fallback_suited_rate)
                    } else {
                        None
                    },
                    full_combination_count: rank_combination_count(&ranks, &[4u8; 13]).max(1.0),
                    scoring_cards: cards_for_rank_counts_for_scoring(&ranks),
                    weight,
                })
            })
            .collect();
    }
    cache.insert(cache_key.to_string(), adjusted.clone());
    adjusted
}

fn pairwise_pegging_options_for_keeps(
    table: &PairwiseTable,
    own_keep: &[u8; 13],
    role: Role,
    opponent_keep: &[u8; 13],
) -> Vec<PeggingOption> {
    let own_key = rank_count_key(own_keep);
    let opponent_key = rank_count_key(opponent_keep);
    let Some(own_keep_id) = table.keep_id_by_key.get(&own_key).copied() else {
        return Vec::new();
    };
    let Some(opponent_keep_id) = table.keep_id_by_key.get(&opponent_key).copied() else {
        return Vec::new();
    };
    if role == Role::Dealer {
        let Some(range) = table.dealer_record_range(own_keep_id) else {
            return Vec::new();
        };
        if let Some(record) = find_pairwise_record(table, true, range, opponent_keep_id) {
            return vec![PeggingOption {
                lead_rank: -1,
                own_pegging: record.my_pegging as i32,
                opponent_pegging: record.opponent_pegging as i32,
            }];
        }
        return Vec::new();
    }
    let mut options = Vec::new();
    for lead_rank in legal_peg_ranks(own_keep, 0) {
        let Some(range) = table.pone_record_range(own_keep_id, lead_rank as usize) else {
            continue;
        };
        if let Some(record) = find_pairwise_record(table, false, range, opponent_keep_id) {
            options.push(PeggingOption {
                lead_rank: lead_rank as i8,
                own_pegging: record.my_pegging as i32,
                opponent_pegging: record.opponent_pegging as i32,
            });
        }
    }
    options
}

fn find_pairwise_record(
    table: &PairwiseTable,
    dealer: bool,
    range: std::ops::Range<usize>,
    opponent_keep_id: usize,
) -> Option<crate::artifacts::PairwiseRecord> {
    for index in range {
        let record = if dealer {
            table.dealer_record(index)
        } else {
            table.pone_record(index)
        }?;
        let id = record.opponent_keep_id as usize;
        if id == opponent_keep_id {
            return Some(record);
        }
        if id > opponent_keep_id {
            break;
        }
    }
    None
}

fn rank_hand_suit_bonus_outcomes_for_cut_card(
    ranks: &[u8; 13],
    cut_card: Card,
    available_cards: &[Card],
) -> Vec<(i32, f64)> {
    let suit_counts = rank_suit_counts_excluding(available_cards, cut_card);
    let rank_totals = rank_totals_from_suit_counts(&suit_counts);
    let total_hand_combinations = rank_combination_count(ranks, &rank_totals);
    if total_hand_combinations == 0.0 {
        return Vec::new();
    }

    let jack_count = ranks[10];
    let mut knob_probability = 0.0;
    if jack_count > 0 {
        let total_jacks = rank_totals[10];
        let cut_suit_jack_available = suit_counts[10][cut_card.suit as usize];
        let jack_denominator = crate::cards::choose(total_jacks, jack_count);
        if cut_suit_jack_available > 0 && jack_denominator != 0.0 {
            knob_probability =
                crate::cards::choose(total_jacks - 1, jack_count - 1) / jack_denominator;
        }
    }

    let mut flush_by_suit = [0.0f64; 4];
    if ranks.iter().sum::<u8>() == 4 && ranks.iter().all(|count| *count <= 1) {
        for suit in 0..4 {
            flush_by_suit[suit] =
                same_suit_rank_hand_probability(ranks, suit, &suit_counts, &rank_totals);
        }
    }
    let flush_cut_probability = flush_by_suit[cut_card.suit as usize];
    let flush_other_probability = flush_by_suit
        .iter()
        .enumerate()
        .filter_map(|(suit, probability)| {
            if suit == cut_card.suit as usize {
                None
            } else {
                Some(*probability)
            }
        })
        .sum::<f64>();
    let flush_cut_includes_knob = if jack_count > 0 {
        flush_cut_probability
    } else {
        0.0
    };
    let knob_only_probability = (knob_probability - flush_cut_includes_knob).max(0.0);
    let no_bonus_probability =
        (1.0 - flush_cut_probability - flush_other_probability - knob_only_probability).max(0.0);

    let mut outcomes: BTreeMap<i32, f64> = BTreeMap::new();
    if no_bonus_probability > 0.0 {
        outcomes.insert(0, no_bonus_probability);
    }
    if knob_only_probability > 0.0 {
        *outcomes.entry(1).or_insert(0.0) += knob_only_probability;
    }
    if flush_other_probability > 0.0 {
        *outcomes.entry(4).or_insert(0.0) += flush_other_probability;
    }
    if flush_cut_probability > 0.0 {
        let bonus = 5 + if jack_count > 0 { 1 } else { 0 };
        *outcomes.entry(bonus).or_insert(0.0) += flush_cut_probability;
    }
    let total_weight = outcomes.values().sum::<f64>();
    if total_weight > 0.0 {
        normalized_score_outcomes(&outcomes, total_weight)
    } else {
        Vec::new()
    }
}

fn rank_suit_counts_excluding(available_cards: &[Card], excluded: Card) -> [[u8; 4]; 13] {
    let mut counts = [[0u8; 4]; 13];
    for card in available_cards {
        if card.id == excluded.id {
            continue;
        }
        counts[card.rank as usize][card.suit as usize] += 1;
    }
    counts
}

fn suit_probability(cards: &[Card], suit: u8) -> f64 {
    if cards.is_empty() {
        return 0.0;
    }
    cards.iter().filter(|card| card.suit == suit).count() as f64 / cards.len() as f64
}

fn expected_known_hand_suit_bonus_for_cut_rank(
    hand: &[Card],
    cut: &CutRankOption,
    crib: bool,
) -> f64 {
    let mut points = 0.0;
    for card in hand {
        if card.rank == 10 {
            points += suit_probability(&cut.cards, card.suit);
        }
    }
    if !hand.is_empty() && hand.iter().all(|card| card.suit == hand[0].suit) {
        let match_probability = suit_probability(&cut.cards, hand[0].suit);
        if crib {
            points += 5.0 * match_probability;
        } else {
            points += 4.0 + match_probability;
        }
    }
    points
}

fn expected_rank_hand_suit_bonus_for_cut_rank(
    ranks: &[u8; 13],
    cut: &CutRankOption,
    available_cards: &[Card],
) -> f64 {
    let mut total = 0.0;
    for cut_card in &cut.cards {
        let suit_counts = rank_suit_counts_excluding(available_cards, *cut_card);
        let rank_totals = rank_totals_from_suit_counts(&suit_counts);
        let mut points = 0.0;
        let jack_count = ranks[10];
        if jack_count > 0 {
            points += jack_count as f64 * suit_counts[10][cut_card.suit as usize] as f64
                / rank_totals[10].max(1) as f64;
        }
        for suit in 0..4 {
            let flush_probability =
                same_suit_rank_hand_probability(ranks, suit, &suit_counts, &rank_totals);
            points += flush_probability
                * if suit == cut_card.suit as usize {
                    5.0
                } else {
                    4.0
                };
        }
        total += points;
    }
    total / cut.cards.len().max(1) as f64
}

fn expected_crib_suit_bonus_for_cut_rank(
    discard: &[Card],
    opponent_ranks: &[u8; 13],
    cut: &CutRankOption,
    available_cards: &[Card],
) -> f64 {
    let mut total = 0.0;
    for cut_card in &cut.cards {
        let suit_counts = rank_suit_counts_excluding(available_cards, *cut_card);
        let rank_totals = rank_totals_from_suit_counts(&suit_counts);
        let mut points = 0.0;
        for card in discard {
            if card.rank == 10 && card.suit == cut_card.suit {
                points += 1.0;
            }
        }
        let opponent_jack_count = opponent_ranks[10];
        if opponent_jack_count > 0 {
            points += opponent_jack_count as f64 * suit_counts[10][cut_card.suit as usize] as f64
                / rank_totals[10].max(1) as f64;
        }
        if discard.len() == 2
            && discard[0].suit == cut_card.suit
            && discard[1].suit == cut_card.suit
        {
            points += 5.0
                * same_suit_rank_hand_probability(
                    opponent_ranks,
                    cut_card.suit as usize,
                    &suit_counts,
                    &rank_totals,
                );
        }
        total += points;
    }
    total / cut.cards.len().max(1) as f64
}

fn rank_totals_from_suit_counts(counts: &[[u8; 4]; 13]) -> [u8; 13] {
    let mut totals = [0u8; 13];
    for rank in 0..13 {
        totals[rank] = counts[rank].iter().sum();
    }
    totals
}

fn same_suit_rank_hand_probability(
    ranks: &[u8; 13],
    suit: usize,
    suit_counts: &[[u8; 4]; 13],
    rank_totals: &[u8; 13],
) -> f64 {
    let mut probability = 1.0;
    for rank in 0..13 {
        let count = ranks[rank];
        if count == 0 {
            continue;
        }
        if count > 1 {
            return 0.0;
        }
        let total = rank_totals[rank];
        if total == 0 {
            return 0.0;
        }
        probability *= suit_counts[rank][suit] as f64 / total as f64;
    }
    probability
}

fn empirical_suited_split_weights(
    entry: &WeightedEntry,
    role_table: &EmpiricalRoleTable,
    suited_len: usize,
    unsuited_len: usize,
) -> (f64, f64) {
    if !rank_pair_can_be_suited(&entry.ranks) || suited_len == 0 {
        return (0.0, entry.weight);
    }
    if unsuited_len == 0 {
        return (entry.weight, 0.0);
    }
    let rate = if let Some(rate) = entry.suited_rate {
        rate
    } else if role_table.distinct_suited_discard_rate != 0.0 {
        role_table.distinct_suited_discard_rate
    } else {
        role_table.suited_discard_rate
    }
    .clamp(0.0, 1.0);
    (entry.weight * rate, entry.weight * (1.0 - rate))
}

fn rank_pair_can_be_suited(ranks: &[u8; 13]) -> bool {
    ranks.iter().sum::<u8>() == 2 && ranks.iter().all(|count| *count <= 1)
}

fn crib_suit_bonus(discard: &[Card], opponent_discard: &[Card], cut: Card) -> i32 {
    let mut crib = discard.to_vec();
    crib.extend(opponent_discard.iter().copied());
    let mut points = 0;
    for card in &crib {
        if card.rank == 10 && card.suit == cut.suit {
            points += 1;
        }
    }
    if crib.iter().all(|card| card.suit == cut.suit) {
        points += 5;
    }
    points
}

fn cut_rank_options(deck: &[Card]) -> Vec<CutRankOption> {
    let mut by_rank: Vec<Vec<Card>> = (0..13).map(|_| Vec::new()).collect();
    for card in deck {
        by_rank[card.rank as usize].push(*card);
    }
    let total = deck.len().max(1) as f64;
    let mut options = Vec::new();
    for (rank, cards) in by_rank.into_iter().enumerate() {
        if cards.is_empty() {
            continue;
        }
        options.push(CutRankOption {
            rank: rank as u8,
            card: Card::new(rank as u8).expect("rank card id in range"),
            weight: cards.len() as f64 / total,
            cards,
        });
    }
    options
}

fn score_outcome_result(outcomes: &BTreeMap<i32, f64>, total_weight: f64) -> ScoreOutcomeResult {
    if total_weight == 0.0 {
        return ScoreOutcomeResult {
            outcomes: Vec::new(),
            average: 0.0,
        };
    }
    let mut total = 0.0;
    for (score, weight) in outcomes {
        total += *score as f64 * *weight;
    }
    ScoreOutcomeResult {
        outcomes: normalized_score_outcomes(outcomes, total_weight),
        average: total / total_weight,
    }
}

fn normalized_score_outcomes(outcomes: &BTreeMap<i32, f64>, total_weight: f64) -> Vec<(i32, f64)> {
    outcomes
        .iter()
        .map(|(score, weight)| (*score, *weight / total_weight))
        .collect()
}

fn score_pair_i32(my_score: i32, opponent_score: i32) -> (u8, u8) {
    (
        my_score.clamp(0, 121) as u8,
        opponent_score.clamp(0, 121) as u8,
    )
}

fn add_weight_pair_i32(outcomes: &mut WeightedPairI32, key: (i32, i32), weight: f64) {
    if let Some(index) = outcomes.indexes.get(&key).copied() {
        outcomes.entries[index].1 += weight;
        return;
    }
    outcomes.indexes.insert(key, outcomes.entries.len());
    outcomes.entries.push((key, weight));
}

fn add_weight_current_hand_outcome(
    outcomes: &mut WeightedCurrentHandOutcomes,
    key: CurrentHandOutcome,
    weight: f64,
) {
    if let Some(index) = outcomes.indexes.get(&key).copied() {
        outcomes.entries[index].1 += weight;
        return;
    }
    outcomes.indexes.insert(key, outcomes.entries.len());
    outcomes.entries.push((key, weight));
}

fn add_weight_pair_u8(outcomes: &mut WeightedPairU8, key: (u8, u8), weight: f64) {
    if let Some(index) = outcomes.indexes.get(&key).copied() {
        outcomes.entries[index].1 += weight;
        return;
    }
    outcomes.indexes.insert(key, outcomes.entries.len());
    outcomes.entries.push((key, weight));
}

fn known_cards_for_pegging(input: &DecisionInput) -> Vec<Card> {
    let mut known = Vec::new();
    known.extend(input.ai_hand.iter().copied());
    known.extend(input.ai_table.iter().copied());
    known.extend(input.human_table.iter().copied());
    known.extend(input.own_discards.iter().copied());
    known.push(input.turn_card);
    known
}

fn opponent_rank_hands_for_engine(
    available: &[u8; 13],
    size: u8,
    opponent_table: &[Card],
    opponent_role: Role,
    hold: &Model13HoldTable,
    corrected_availability_weighting: bool,
) -> Vec<WeightedRankHand> {
    let hands = crate::cards::enumerate_rank_hands(available, size)
        .into_iter()
        .map(|(ranks, weight)| WeightedRankHand { ranks, weight })
        .collect::<Vec<_>>();
    if hands.is_empty() {
        return hands;
    }
    let prefix_ranks = opponent_table
        .iter()
        .take(3)
        .map(|card| card.rank)
        .collect::<Vec<_>>();
    let prefix_key = rank_prefix_key(&prefix_ranks);
    let Some(context_records) = hold.context_records(
        role_index(opponent_role),
        &prefix_key,
        prefix_ranks.len() as u8,
    ) else {
        return hands;
    };
    let context_weights = context_records
        .iter()
        .copied()
        .collect::<HashMap<usize, u32>>();
    hands
        .into_iter()
        .filter_map(|hand| {
            let key = rank_count_key(&hand.ranks);
            let hand_id = *hold.hand_id_by_key.get(&key)?;
            let count = *context_weights.get(&hand_id)? as f64;
            let weight = if corrected_availability_weighting {
                count
                    * (rank_combination_count(&hand.ranks, available)
                        / rank_combination_count(&hand.ranks, &[4u8; 13]).max(1.0))
            } else {
                count
            };
            if weight > 0.0 {
                Some(WeightedRankHand {
                    ranks: hand.ranks,
                    weight,
                })
            } else {
                None
            }
        })
        .collect()
}

fn exhaustive_pegging_play_ev(input: &DecisionInput, card: Card, hold: &Model13HoldTable) -> f64 {
    exhaustive_pegging_play_ev_with_weighting(input, card, hold, true)
}

fn exhaustive_pegging_play_ev_with_weighting(
    input: &DecisionInput,
    card: Card,
    hold: &Model13HoldTable,
    corrected_availability_weighting: bool,
) -> f64 {
    let opponent_role = other_role(input.role);
    let known_cards = known_cards_for_pegging(input);
    let available = remaining_rank_counts(&known_cards);
    let opponent_hands = opponent_rank_hands_for_engine(
        &available,
        input.human_hand_count as u8,
        &input.human_table,
        opponent_role,
        hold,
        corrected_availability_weighting,
    );
    exhaustive_pegging_point_ev(input, card, &opponent_hands)
}

fn exhaustive_pegging_point_ev(
    input: &DecisionInput,
    card: Card,
    opponent_hands: &[WeightedRankHand],
) -> f64 {
    let own_ranks = ranks_after_playing(&input.ai_hand, card);
    let mut weighted_total = 0.0;
    let mut total_weight = 0.0;
    let immediate_score = {
        let mut plays = input.plays.clone();
        plays.push(card);
        score_count(&plays) as f64
    };
    let count_after_play = input.count + card.value;
    for possible_opponent_hand in opponent_hands {
        let state = PegSimulationState {
            hands: hands_for_perspective(own_ranks, possible_opponent_hand.ranks),
            plays: if count_after_play == 31 {
                Vec::new()
            } else {
                ranks_for_cards_with_extra(&input.plays, card)
            },
            count: if count_after_play == 31 {
                0
            } else {
                count_after_play
            },
            current: PlayerKey::Human,
            go_player: None,
            last_player: if count_after_play == 31 {
                None
            } else {
                Some(PlayerKey::Ai)
            },
            perspective: PlayerKey::Ai,
        };
        let mut memo = HashMap::new();
        let result = simulate_pegging_future(state, &mut memo);
        weighted_total +=
            ((immediate_score * result.weight) + result.total) * possible_opponent_hand.weight;
        total_weight += result.weight * possible_opponent_hand.weight;
    }
    if total_weight > 0.0 {
        weighted_total / total_weight
    } else {
        immediate_score
    }
}

fn simulate_pegging_future(
    state: PegSimulationState,
    memo: &mut HashMap<PegSimulationKey, WeightedScore>,
) -> WeightedScore {
    let key = peg_simulation_key(&state);
    if let Some(cached) = memo.get(&key) {
        return cached.clone();
    }
    let remaining_cards = rank_count_total(&state.hands[0]) + rank_count_total(&state.hands[1]);
    if remaining_cards == 0 {
        let last_point = if state.last_player.is_some() && state.count != 0 {
            perspective_score(
                state.perspective,
                state.last_player.expect("checked last player"),
                1,
            ) as f64
        } else {
            0.0
        };
        let terminal = WeightedScore {
            total: last_point,
            weight: 1.0,
        };
        memo.insert(key, terminal.clone());
        return terminal;
    }
    let current_index = player_index(state.current);
    let legal = legal_peg_ranks(&state.hands[current_index], state.count);
    if legal.is_empty() {
        if state.go_player.is_some() {
            let go_point = if state.last_player.is_some() && state.count != 31 {
                perspective_score(
                    state.perspective,
                    state.last_player.expect("checked last player"),
                    1,
                ) as f64
            } else {
                0.0
            };
            let future = simulate_pegging_future(
                PegSimulationState {
                    plays: Vec::new(),
                    count: 0,
                    current: other_player(state.current),
                    go_player: None,
                    last_player: None,
                    ..state.clone()
                },
                memo,
            );
            let result = WeightedScore {
                total: (go_point * future.weight) + future.total,
                weight: future.weight,
            };
            memo.insert(key, result.clone());
            return result;
        }
        let result = simulate_pegging_future(
            PegSimulationState {
                current: other_player(state.current),
                go_player: Some(state.current),
                ..state.clone()
            },
            memo,
        );
        memo.insert(key, result.clone());
        return result;
    }

    let mut total = 0.0;
    let mut weight = 0.0;
    for rank in legal {
        let branch_weight = state.hands[current_index][rank as usize] as f64;
        let mut hands = state.hands;
        hands[current_index][rank as usize] -= 1;
        let mut plays = state.plays.clone();
        plays.push(rank);
        let play_cards = plays
            .iter()
            .map(|played_rank| peg_card_for_rank(*played_rank))
            .collect::<Vec<_>>();
        let points = score_count(&play_cards) as f64;
        let next_count = state.count + peg_card_for_rank(rank).value;
        let next_state = if next_count == 31 {
            PegSimulationState {
                hands,
                plays: Vec::new(),
                count: 0,
                current: other_player(state.current),
                go_player: None,
                last_player: None,
                perspective: state.perspective,
            }
        } else {
            PegSimulationState {
                hands,
                plays,
                count: next_count,
                current: other_player(state.current),
                go_player: None,
                last_player: Some(state.current),
                perspective: state.perspective,
            }
        };
        let future = simulate_pegging_future(next_state, memo);
        let signed_points =
            perspective_score(state.perspective, state.current, points as i32) as f64;
        total += branch_weight * ((signed_points * future.weight) + future.total);
        weight += branch_weight * future.weight;
    }
    let result = WeightedScore { total, weight };
    memo.insert(key, result.clone());
    result
}

fn optimal_pegging_outcome_distribution_for_candidate(
    input: &DecisionInput,
    card: Card,
    opponent_hands: &[WeightedRankHand],
    evaluator: &mut PeggingWinEvaluator,
) -> PeggingOutcomeDistribution {
    let own_ranks = ranks_after_playing(&input.ai_hand, card);
    let immediate_score = {
        let mut plays = input.plays.clone();
        plays.push(card);
        score_count(&plays) as i32
    };
    let count_after_play = input.count + card.value;
    let root_scores = scores_from_input(input);
    let mut outcomes = PeggingOutcomeDistribution::default();
    if root_scores[player_index(PlayerKey::Ai)] + immediate_score >= 121 {
        add_outcome_for_player(
            &mut outcomes,
            PlayerKey::Ai,
            PlayerKey::Ai,
            immediate_score,
            1.0,
        );
        outcomes.total_weight = 1.0;
        return outcomes;
    }
    for possible_opponent_hand in opponent_hands {
        let mut scores = root_scores;
        scores[player_index(PlayerKey::Ai)] += immediate_score;
        let state = OptimalPegSimulationState {
            hands: hands_for_perspective(own_ranks, possible_opponent_hand.ranks),
            plays: if count_after_play == 31 {
                Vec::new()
            } else {
                ranks_for_cards_with_extra(&input.plays, card)
            },
            count: if count_after_play == 31 {
                0
            } else {
                count_after_play
            },
            current: PlayerKey::Human,
            go_player: None,
            last_player: if count_after_play == 31 {
                None
            } else {
                Some(PlayerKey::Ai)
            },
            perspective: PlayerKey::Ai,
            scores,
            root_scores,
            perspective_role: input.role,
        };
        let mut memo = HashMap::new();
        let result = simulate_optimal_pegging_distribution(state, &mut memo, evaluator);
        for (key, weight) in result.outcomes.entries {
            add_weight_pair_i32(
                &mut outcomes.outcomes,
                key,
                weight * possible_opponent_hand.weight,
            );
        }
        outcomes.total_weight += result.total_weight * possible_opponent_hand.weight;
    }
    outcomes
}

fn simulate_optimal_pegging_distribution(
    state: OptimalPegSimulationState,
    memo: &mut HashMap<OptimalPegSimulationKey, PeggingOutcomeDistribution>,
    evaluator: &mut PeggingWinEvaluator,
) -> PeggingOutcomeDistribution {
    let key = optimal_peg_simulation_key(&state);
    if let Some(cached) = memo.get(&key) {
        return cached.clone();
    }
    let remaining_cards = rank_count_total(&state.hands[0]) + rank_count_total(&state.hands[1]);
    if remaining_cards == 0 {
        let mut scores = state.scores;
        if let Some(last_player) = state.last_player {
            if state.count != 0 {
                scores[player_index(last_player)] += 1;
            }
        }
        let result = outcome_from_scores(state.root_scores, scores, state.perspective);
        memo.insert(key, result.clone());
        return result;
    }

    let current_index = player_index(state.current);
    let legal = legal_peg_ranks(&state.hands[current_index], state.count);
    if legal.is_empty() {
        if state.go_player.is_some() {
            let mut scores = state.scores;
            if let Some(last_player) = state.last_player {
                if state.count != 31 {
                    scores[player_index(last_player)] += 1;
                    if scores[player_index(last_player)] >= 121 {
                        let result =
                            outcome_from_scores(state.root_scores, scores, state.perspective);
                        memo.insert(key, result.clone());
                        return result;
                    }
                }
            }
            let result = simulate_optimal_pegging_distribution(
                OptimalPegSimulationState {
                    scores,
                    plays: Vec::new(),
                    count: 0,
                    current: other_player(state.current),
                    go_player: None,
                    last_player: None,
                    ..state.clone()
                },
                memo,
                evaluator,
            );
            memo.insert(key, result.clone());
            return result;
        }
        let result = simulate_optimal_pegging_distribution(
            OptimalPegSimulationState {
                current: other_player(state.current),
                go_player: Some(state.current),
                ..state.clone()
            },
            memo,
            evaluator,
        );
        memo.insert(key, result.clone());
        return result;
    }

    let mut best: Option<PeggingOutcomeDistribution> = None;
    let mut best_score = if state.current == state.perspective {
        f64::NEG_INFINITY
    } else {
        f64::INFINITY
    };
    let mut best_point_ev = f64::NEG_INFINITY;
    for rank in legal {
        let candidate = optimal_pegging_branch(&state, rank, memo, evaluator);
        let score = expected_win_probability_for_distribution(
            state.root_scores,
            state.perspective,
            &candidate,
            evaluator,
        );
        let point_ev = pegging_distribution_point_ev(&candidate);
        let is_better = if state.current == state.perspective {
            score > best_score || (score == best_score && point_ev > best_point_ev)
        } else {
            score < best_score || (score == best_score && point_ev < best_point_ev)
        };
        if best.is_none() || is_better {
            best = Some(candidate);
            best_score = score;
            best_point_ev = point_ev;
        }
    }
    let result = best.unwrap_or_else(|| {
        let mut fallback = PeggingOutcomeDistribution::default();
        add_weight_pair_i32(&mut fallback.outcomes, (0, 0), 1.0);
        fallback.total_weight = 1.0;
        fallback
    });
    memo.insert(key, result.clone());
    result
}

fn optimal_pegging_branch(
    state: &OptimalPegSimulationState,
    rank: u8,
    memo: &mut HashMap<OptimalPegSimulationKey, PeggingOutcomeDistribution>,
    evaluator: &mut PeggingWinEvaluator,
) -> PeggingOutcomeDistribution {
    let current_index = player_index(state.current);
    let mut hands = state.hands;
    hands[current_index][rank as usize] -= 1;
    let mut plays = state.plays.clone();
    plays.push(rank);
    let play_cards = plays
        .iter()
        .map(|played_rank| peg_card_for_rank(*played_rank))
        .collect::<Vec<_>>();
    let points = score_count(&play_cards) as i32;
    let next_count = state.count + peg_card_for_rank(rank).value;
    let mut scores = state.scores;
    scores[current_index] += points;
    if scores[current_index] >= 121 {
        return outcome_from_scores(state.root_scores, scores, state.perspective);
    }
    let next_state = if next_count == 31 {
        OptimalPegSimulationState {
            hands,
            scores,
            plays: Vec::new(),
            count: 0,
            current: other_player(state.current),
            go_player: None,
            last_player: None,
            perspective: state.perspective,
            root_scores: state.root_scores,
            perspective_role: state.perspective_role,
        }
    } else {
        OptimalPegSimulationState {
            hands,
            scores,
            plays,
            count: next_count,
            current: other_player(state.current),
            go_player: None,
            last_player: Some(state.current),
            perspective: state.perspective,
            root_scores: state.root_scores,
            perspective_role: state.perspective_role,
        }
    };
    simulate_optimal_pegging_distribution(next_state, memo, evaluator)
}

fn expected_win_probability_after_pegging(
    input: &DecisionInput,
    distribution: &PeggingOutcomeDistribution,
    evaluator: &mut PeggingWinEvaluator,
) -> f64 {
    if distribution.total_weight == 0.0 {
        return 0.0;
    }
    let root_scores = scores_from_input(input);
    expected_win_probability_for_distribution(root_scores, PlayerKey::Ai, distribution, evaluator)
}

fn expected_win_probability_for_distribution(
    root_scores: [i32; 2],
    perspective: PlayerKey,
    distribution: &PeggingOutcomeDistribution,
    evaluator: &mut PeggingWinEvaluator,
) -> f64 {
    if distribution.total_weight == 0.0 {
        return 0.0;
    }
    let opponent = other_player(perspective);
    let mut total = 0.0;
    for ((my_pegging, opponent_pegging), weight) in &distribution.outcomes.entries {
        let my_score = root_scores[player_index(perspective)] + *my_pegging;
        let opponent_score = root_scores[player_index(opponent)] + *opponent_pegging;
        total += *weight * evaluator.win_probability(my_score, opponent_score);
    }
    total / distribution.total_weight
}

fn historic_phase_pegging_win_evaluator(input: &DecisionInput) -> PeggingWinEvaluator {
    PeggingWinEvaluator {
        perspective_role: input.role,
        mode: PeggingWinMode::HistoricPhase {
            board: BoardModel::new(),
        },
    }
}

fn known_card_pegging_win_evaluator(
    input: &DecisionInput,
    hold: &Model13HoldTable,
) -> PeggingWinEvaluator {
    PeggingWinEvaluator {
        perspective_role: input.role,
        mode: PeggingWinMode::KnownCards(post_pegging_win_context(input, hold)),
    }
}

fn post_pegging_win_context(
    input: &DecisionInput,
    hold: &Model13HoldTable,
) -> PostPeggingWinContext {
    let perspective_role = input.role;
    let pone_is_perspective = input.role == Role::Pone;
    let dealer_is_perspective = input.role == Role::Dealer;
    PostPeggingWinContext {
        perspective_role,
        pone_is_perspective,
        dealer_is_perspective,
        pone_hand: upcoming_hand_score_distribution(input, Role::Pone, hold),
        dealer_hand: upcoming_hand_score_distribution(input, Role::Dealer, hold),
        crib: upcoming_crib_score_distribution(input),
        memo: HashMap::new(),
        board: board_model_for_input(input),
    }
}

impl PeggingWinEvaluator {
    fn win_probability(&mut self, my_score: i32, opponent_score: i32) -> f64 {
        match &mut self.mode {
            PeggingWinMode::HistoricPhase { board } => board.future_win_probability_from_scores(
                my_score,
                opponent_score,
                self.perspective_role,
                ScorePhase::HandPone,
            ),
            PeggingWinMode::KnownCards(context) => {
                post_pegging_win_probability(context, my_score, opponent_score)
            }
        }
    }
}

fn upcoming_hand_score_distribution(
    input: &DecisionInput,
    scorer_role: Role,
    hold: &Model13HoldTable,
) -> Vec<(i32, f64)> {
    let ai_is_scorer = input.role == scorer_role;
    if ai_is_scorer {
        let mut cards = input.ai_table.clone();
        cards.extend(input.ai_hand.iter().copied());
        return vec![(score_hand(&cards, input.turn_card, false) as i32, 1.0)];
    }
    let mut known_cards = Vec::new();
    known_cards.extend(input.ai_hand.iter().copied());
    known_cards.extend(input.ai_table.iter().copied());
    known_cards.extend(input.human_table.iter().copied());
    known_cards.extend(input.own_discards.iter().copied());
    known_cards.push(input.turn_card);
    let mut known_ids = [false; 52];
    for card in &known_cards {
        known_ids[card.id as usize] = true;
    }
    let available_cards = full_deck()
        .into_iter()
        .filter(|card| !known_ids[card.id as usize])
        .collect::<Vec<_>>();
    let available_ranks = remaining_rank_counts(&known_cards);
    let opponent_hands = opponent_rank_hands_for_engine(
        &available_ranks,
        input.human_hand_count as u8,
        &input.human_table,
        scorer_role,
        hold,
        true,
    );
    let mut outcomes: BTreeMap<i32, f64> = BTreeMap::new();
    let mut total_weight = 0.0;
    for hand in opponent_hands {
        let suited_hands = cards_for_rank_counts(&available_cards, &hand.ranks);
        if suited_hands.is_empty() {
            continue;
        }
        let suited_weight = hand.weight / suited_hands.len() as f64;
        for suited_hand in suited_hands {
            let mut cards = input.human_table.clone();
            cards.extend(suited_hand);
            let score = score_hand(&cards, input.turn_card, false) as i32;
            *outcomes.entry(score).or_insert(0.0) += suited_weight;
            total_weight += suited_weight;
        }
    }
    if total_weight == 0.0 {
        return vec![(
            score_phase_average(if scorer_role == Role::Dealer {
                ScorePhase::HandDealer
            } else {
                ScorePhase::HandPone
            })
            .round() as i32,
            1.0,
        )];
    }
    normalized_score_outcomes(&outcomes, total_weight)
}

fn upcoming_crib_score_distribution(_input: &DecisionInput) -> Vec<(i32, f64)> {
    // The acting player knows only their own two discards. The other two crib
    // cards remain hidden until scoring, so treating the complete crib as an
    // exact future score would leak opponent information. Keep the existing
    // legal global prior until a conditional own-discard crib asset exists.
    vec![(score_phase_average(ScorePhase::Crib).round() as i32, 1.0)]
}

fn post_pegging_win_probability(
    context: &mut PostPeggingWinContext,
    my_score: i32,
    opponent_score: i32,
) -> f64 {
    if my_score >= 121 {
        return 1.0;
    }
    if opponent_score >= 121 {
        return 0.0;
    }
    let key = (my_score, opponent_score);
    if let Some(cached) = context.memo.get(&key) {
        return *cached;
    }
    let mut total = 0.0;
    let mut total_weight = 0.0;
    for (pone_score, pone_weight) in &context.pone_hand {
        let after_pone_my = my_score
            + if context.pone_is_perspective {
                *pone_score
            } else {
                0
            };
        let after_pone_opponent = opponent_score
            + if context.pone_is_perspective {
                0
            } else {
                *pone_score
            };
        if after_pone_my >= 121 {
            total += *pone_weight;
            total_weight += *pone_weight;
            continue;
        }
        if after_pone_opponent >= 121 {
            total_weight += *pone_weight;
            continue;
        }
        for (dealer_score, dealer_weight) in &context.dealer_hand {
            let after_dealer_my = after_pone_my
                + if context.dealer_is_perspective {
                    *dealer_score
                } else {
                    0
                };
            let after_dealer_opponent = after_pone_opponent
                + if context.dealer_is_perspective {
                    0
                } else {
                    *dealer_score
                };
            if after_dealer_my >= 121 {
                total += *pone_weight * *dealer_weight;
                total_weight += *pone_weight * *dealer_weight;
                continue;
            }
            if after_dealer_opponent >= 121 {
                total_weight += *pone_weight * *dealer_weight;
                continue;
            }
            for (crib_score, crib_weight) in &context.crib {
                let after_crib_my = after_dealer_my
                    + if context.dealer_is_perspective {
                        *crib_score
                    } else {
                        0
                    };
                let after_crib_opponent = after_dealer_opponent
                    + if context.dealer_is_perspective {
                        0
                    } else {
                        *crib_score
                    };
                let weight = *pone_weight * *dealer_weight * *crib_weight;
                if after_crib_my >= 121 {
                    total += weight;
                } else if after_crib_opponent < 121 {
                    total += weight
                        * context.board.future_win_probability_from_scores(
                            after_crib_my,
                            after_crib_opponent,
                            next_perspective_role(context.perspective_role, ScorePhase::Crib),
                            next_score_phase(ScorePhase::Crib),
                        );
                }
                total_weight += weight;
            }
        }
    }
    let probability = if total_weight > 0.0 {
        total / total_weight
    } else {
        context.board.future_win_probability_from_scores(
            my_score,
            opponent_score,
            context.perspective_role,
            ScorePhase::HandPone,
        )
    };
    context.memo.insert(key, probability);
    probability
}

fn pegging_distribution_point_ev(distribution: &PeggingOutcomeDistribution) -> f64 {
    if distribution.total_weight == 0.0 {
        return 0.0;
    }
    let mut total = 0.0;
    for ((my, opponent), weight) in &distribution.outcomes.entries {
        total += (*my as f64 - *opponent as f64) * *weight;
    }
    total / distribution.total_weight
}

fn outcome_from_scores(
    root_scores: [i32; 2],
    scores: [i32; 2],
    perspective: PlayerKey,
) -> PeggingOutcomeDistribution {
    let opponent = other_player(perspective);
    let mut distribution = PeggingOutcomeDistribution::default();
    add_weight_pair_i32(
        &mut distribution.outcomes,
        (
            (scores[player_index(perspective)] - root_scores[player_index(perspective)]).max(0),
            (scores[player_index(opponent)] - root_scores[player_index(opponent)]).max(0),
        ),
        1.0,
    );
    distribution.total_weight = 1.0;
    distribution
}

fn add_outcome_for_player(
    distribution: &mut PeggingOutcomeDistribution,
    perspective: PlayerKey,
    player: PlayerKey,
    points: i32,
    weight: f64,
) {
    let my = if player == perspective { points } else { 0 };
    let opponent = if player == perspective { 0 } else { points };
    add_weight_pair_i32(&mut distribution.outcomes, (my, opponent), weight);
}

fn ranks_after_playing(hand: &[Card], played: Card) -> [u8; 13] {
    let mut ranks = rank_counts(hand);
    ranks[played.rank as usize] = ranks[played.rank as usize].saturating_sub(1);
    ranks
}

fn ranks_for_cards_with_extra(cards: &[Card], extra: Card) -> Vec<u8> {
    let mut ranks = cards.iter().map(|card| card.rank).collect::<Vec<_>>();
    ranks.push(extra.rank);
    ranks
}

fn hands_for_perspective(ai_ranks: [u8; 13], human_ranks: [u8; 13]) -> [[u8; 13]; 2] {
    [human_ranks, ai_ranks]
}

fn scores_from_input(input: &DecisionInput) -> [i32; 2] {
    [input.human_score, input.ai_score]
}

fn player_index(player: PlayerKey) -> usize {
    match player {
        PlayerKey::Human => 0,
        PlayerKey::Ai => 1,
    }
}

fn other_player(player: PlayerKey) -> PlayerKey {
    match player {
        PlayerKey::Human => PlayerKey::Ai,
        PlayerKey::Ai => PlayerKey::Human,
    }
}

fn perspective_score(perspective: PlayerKey, scorer: PlayerKey, points: i32) -> i32 {
    if perspective == scorer {
        points
    } else {
        -points
    }
}

fn role_index(role: Role) -> u8 {
    match role {
        Role::Dealer => 0,
        Role::Pone => 1,
    }
}

fn rank_prefix_key(ranks: &[u8]) -> String {
    let mut sorted = ranks.to_vec();
    sorted.sort_unstable();
    sorted
        .iter()
        .map(|rank| crate::cards::RANKS[*rank as usize])
        .collect::<Vec<_>>()
        .join(",")
}

fn peg_simulation_key(state: &PegSimulationState) -> PegSimulationKey {
    PegSimulationKey {
        hands: pack_hands(&state.hands),
        plays: pack_play_ranks(&state.plays),
        count: state.count,
        current: state.current,
        go_player: state.go_player,
        last_player: state.last_player,
        perspective: state.perspective,
    }
}

fn optimal_peg_simulation_key(state: &OptimalPegSimulationState) -> OptimalPegSimulationKey {
    OptimalPegSimulationKey {
        hands: pack_hands(&state.hands),
        plays: pack_play_ranks(&state.plays),
        count: state.count,
        current: state.current,
        go_player: state.go_player,
        last_player: state.last_player,
        perspective: state.perspective,
        scores: state.scores,
        root_scores: state.root_scores,
        perspective_role: state.perspective_role,
    }
}

fn pack_hands(hands: &[[u8; 13]; 2]) -> [u64; 2] {
    [pack_rank_counts(&hands[0]), pack_rank_counts(&hands[1])]
}

fn pack_rank_counts(ranks: &[u8; 13]) -> u64 {
    let mut packed = 0_u64;
    for (index, count) in ranks.iter().enumerate() {
        debug_assert!(*count <= 4);
        packed |= u64::from(*count) << (index * 3);
    }
    packed
}

fn pack_play_ranks(plays: &[u8]) -> u64 {
    debug_assert!(plays.len() <= 14);
    let mut packed = plays.len() as u64;
    for (index, rank) in plays.iter().enumerate() {
        debug_assert!(*rank < 13);
        packed |= u64::from(*rank + 1) << (4 + index * 4);
    }
    packed
}

fn compare_tuple(a: &[f64], b: &[f64]) -> i32 {
    for index in 0..a.len().min(b.len()) {
        if a[index] > b[index] {
            return 1;
        }
        if a[index] < b[index] {
            return -1;
        }
    }
    0
}

fn runtime_tables(root: &str) -> Result<&'static RuntimeTables, String> {
    if let Some(tables) = RUNTIME_TABLES.get() {
        return Ok(tables);
    }
    let tables = RuntimeTables::new(root);
    let _ = RUNTIME_TABLES.set(tables);
    RUNTIME_TABLES
        .get()
        .ok_or_else(|| "RuntimeTables cache was not initialized".to_string())
}

impl RuntimeTables {
    fn new(root: &str) -> RuntimeTables {
        RuntimeTables {
            root: root.to_string(),
            empirical: OnceLock::new(),
            pairwise: OnceLock::new(),
            pairwise14: OnceLock::new(),
            hold: OnceLock::new(),
            crib_rank: OnceLock::new(),
            crib_tripolicy14: OnceLock::new(),
            policy16: OnceLock::new(),
        }
    }

    fn empirical(&self) -> Result<&EmpiricalDiscardKeepTable, String> {
        load_cached(&self.empirical, "empirical", || {
            EmpiricalDiscardKeepTable::load_edk1(self.asset_path("empirical-discard-keep-14.8.bin"))
        })
    }

    fn pairwise(&self) -> Result<&PairwiseTable, String> {
        load_cached(&self.pairwise, "pairwise", || {
            PairwiseTable::load_p12p(self.asset_path("model13-pairwise.bin"))
        })
    }

    fn pairwise14(&self) -> Result<&PairwiseTable, String> {
        load_cached(&self.pairwise14, "pairwise14", || {
            PairwiseTable::load_p12p(self.asset_path("model143-pairwise.bin"))
        })
    }

    fn hold(&self) -> Result<&Model13HoldTable, String> {
        load_cached(&self.hold, "hold", || {
            Model13HoldTable::load_p13h(self.asset_path("model13-hold.bin"))
        })
    }

    fn crib_rank(&self) -> Result<&CribRankDiscardTables, String> {
        load_cached(&self.crib_rank, "crib_rank", || {
            CribRankDiscardTables::load(
                self.asset_path("crib-rank-score-by-discard-cut.json"),
                self.asset_path("crib-score-histogram-by-discard-cut.json"),
            )
        })
    }

    fn crib_tripolicy14(&self) -> Result<&CribTripolicyTable, String> {
        load_cached(&self.crib_tripolicy14, "crib_tripolicy14", || {
            CribTripolicyTable::load_c14b(self.asset_path("model143-crib.bin"))
        })
    }

    fn policy16(&self) -> Result<Option<&PolicyArtifact>, String> {
        if let Some(policy) = self.policy16.get() {
            return Ok(policy.as_ref());
        }
        let path = self.asset_path("model16-pegging-policy.bin");
        let policy = match fs::metadata(&path) {
            Ok(_) => Some(PolicyArtifact::load(&path)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(format!("stat {} failed: {}", path.display(), error)),
        };
        let _ = self.policy16.set(policy);
        self.policy16
            .get()
            .map(Option::as_ref)
            .ok_or_else(|| "RuntimeTables policy16 cache was not initialized".to_string())
    }

    fn asset_path(&self, filename: &str) -> PathBuf {
        let mut path = PathBuf::from(&self.root);
        path.push("rust");
        path.push("cribbage-shadow-engine");
        path.push("assets");
        path.push(filename);
        path
    }
}

fn load_cached<'a, T>(
    lock: &'a OnceLock<T>,
    name: &str,
    load: impl FnOnce() -> Result<T, String>,
) -> Result<&'a T, String> {
    if let Some(value) = lock.get() {
        return Ok(value);
    }
    let value = load()?;
    let _ = lock.set(value);
    lock.get()
        .ok_or_else(|| format!("RuntimeTables {} cache was not initialized", name))
}

fn empirical_role(table: &EmpiricalDiscardKeepTable, role: Role) -> &EmpiricalRoleTable {
    match role {
        Role::Dealer => &table.dealer,
        Role::Pone => &table.pone,
    }
}

fn other_role(role: Role) -> Role {
    match role {
        Role::Dealer => Role::Pone,
        Role::Pone => Role::Dealer,
    }
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::Dealer => "dealer",
        Role::Pone => "pone",
    }
}

fn parse_role(value: &str) -> Result<Role, String> {
    match value {
        "dealer" => Ok(Role::Dealer),
        "pone" => Ok(Role::Pone),
        other => Err(format!("invalid role: {}", other)),
    }
}

fn parse_player(value: &str) -> Result<PlayerKey, String> {
    match value {
        "human" => Ok(PlayerKey::Human),
        "ai" => Ok(PlayerKey::Ai),
        other => Err(format!("invalid player: {}", other)),
    }
}

fn parse_optional_player(value: &str) -> Result<Option<PlayerKey>, String> {
    if value == "-" || value.is_empty() {
        return Ok(None);
    }
    parse_player(value).map(Some)
}

fn parse_cards(value: &str) -> Result<Vec<Card>, String> {
    if value.is_empty() {
        return Ok(Vec::new());
    }
    let mut ids = Vec::new();
    for part in value.split(',') {
        if part.is_empty() {
            continue;
        }
        ids.push(parse_u8(part)?);
    }
    cards_from_ids(&ids)
}

fn parse_i32(value: &str) -> Result<i32, String> {
    value
        .parse::<i32>()
        .map_err(|error| format!("invalid i32 {}: {}", value, error))
}

fn parse_usize(value: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|error| format!("invalid usize {}: {}", value, error))
}

fn parse_u8(value: &str) -> Result<u8, String> {
    value
        .parse::<u8>()
        .map_err(|error| format!("invalid u8 {}: {}", value, error))
}

fn parse_u16(value: &str) -> Result<u16, String> {
    value
        .parse::<u16>()
        .map_err(|error| format!("invalid u16 {}: {}", value, error))
}

fn parse_model16_policy_mode(value: &str) -> Result<Model16PolicyMode, String> {
    match value {
        "argmax" => Ok(Model16PolicyMode::Argmax),
        "sample" => Ok(Model16PolicyMode::Sample),
        "fallback" => Ok(Model16PolicyMode::Fallback),
        other => Err(format!("invalid Model 16 policy mode: {}", other)),
    }
}

fn parse_optional_u8(value: &str) -> Result<Option<u8>, String> {
    if value == "-" || value.is_empty() {
        return Ok(None);
    }
    parse_u8(value).map(Some)
}

fn ids_key(cards: &[Card]) -> String {
    let mut ids: Vec<u8> = cards.iter().map(|card| card.id).collect();
    ids.sort_unstable();
    ids.iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

fn card_set_key(cards: &[Card]) -> String {
    ids_key(cards)
}

fn lead_tie_value(lead_rank: i8) -> i32 {
    if lead_rank >= 0 {
        crate::cards::VALUES[lead_rank as usize] as i32
    } else {
        -1
    }
}

fn round_ev(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{PolicyArtifactMetadata, QuantizedPolicyEntry, POLICY_WEIGHT_TOTAL};

    fn model16_peg_input() -> DecisionInput {
        DecisionInput {
            kind: DecisionKind::Peg,
            model: MODEL_16_0.to_string(),
            player: PlayerKey::Ai,
            role: Role::Pone,
            ai_score: 120,
            human_score: 116,
            ai_hand: cards_from_ids(&[4, 5]).unwrap(),
            ai_table: Vec::new(),
            human_table: cards_from_ids(&[9]).unwrap(),
            human_hand_count: 3,
            own_discards: cards_from_ids(&[0, 1]).unwrap(),
            turn_card: Card::new(2).unwrap(),
            count: 10,
            turn: PlayerKey::Ai,
            go_player: None,
            last_player: Some(PlayerKey::Human),
            plays: cards_from_ids(&[9]).unwrap(),
            peg_lead: None,
            model16_policy_mode: Model16PolicyMode::Argmax,
            model16_policy_sample: 0,
        }
    }

    fn model16_artifact(input: &DecisionInput, selected_rank: u8) -> PolicyArtifact {
        let key = model16_policy_key(input).unwrap();
        let mut weights = [0_u16; 14];
        weights[selected_rank as usize] = POLICY_WEIGHT_TOTAL as u16;
        PolicyArtifact::new(
            PolicyArtifactMetadata {
                training_seed: 16,
                training_iterations: 100,
                checkpoint_checksum: 7,
                source_nodes: 1,
                source_singletons: 0,
                included_entries: 0,
                minimum_visits: 1,
                provenance: "model16-runtime-test".to_string(),
                backoff: "legal-information heuristic".to_string(),
            },
            vec![QuantizedPolicyEntry {
                key,
                legal_mask: key.expected_legal_mask(),
                confidence: 10,
                weights,
            }],
        )
        .unwrap()
    }

    fn current_hand_outcome(
        own_pegging: i32,
        opponent_pegging: i32,
        own_hand: i32,
        opponent_hand: i32,
    ) -> CurrentHandOutcome {
        CurrentHandOutcome {
            own_pegging,
            opponent_pegging,
            own_hand,
            opponent_hand,
        }
    }

    #[test]
    fn current_hand_outcomes_preserve_scoring_components() {
        let mut outcomes = WeightedCurrentHandOutcomes::default();
        add_weight_current_hand_outcome(&mut outcomes, current_hand_outcome(0, 0, 6, 6), 1.0);
        add_weight_current_hand_outcome(&mut outcomes, current_hand_outcome(6, 6, 0, 0), 1.0);

        assert_eq!(outcomes.entries.len(), 2);
    }

    #[test]
    fn ordered_current_hand_awards_pone_hand_first() {
        let outcome = current_hand_outcome(0, 0, 6, 6);
        let mut collapsed_board = BoardModel::exact_joint_pegging_without_early_heuristic();
        let mut dealer_board = BoardModel::exact_joint_pegging_without_early_heuristic();
        let mut pone_board = BoardModel::exact_joint_pegging_without_early_heuristic();

        // This is the 15.2 failure mode: collapsing both hands before the
        // board call produces 121-121, and the perspective-first terminal
        // check incorrectly awards the dealer the game.
        assert_eq!(
            collapsed_board.future_win_probability_from_scores(
                121,
                121,
                Role::Pone,
                ScorePhase::PeggingPone,
            ),
            1.0
        );
        assert_eq!(
            ordered_current_hand_win_probability(
                &mut dealer_board,
                115,
                115,
                Role::Dealer,
                Role::Pone,
                outcome,
                12,
            ),
            0.0
        );
        assert_eq!(
            ordered_current_hand_win_probability(
                &mut pone_board,
                115,
                115,
                Role::Pone,
                Role::Dealer,
                outcome,
                12,
            ),
            1.0
        );
    }

    #[test]
    fn ordered_current_hand_resolves_pegging_before_hands() {
        let outcome = current_hand_outcome(1, 0, 0, 1);
        let mut board = BoardModel::exact_joint_pegging_without_early_heuristic();

        assert_eq!(
            ordered_current_hand_win_probability(
                &mut board,
                120,
                120,
                Role::Dealer,
                Role::Pone,
                outcome,
                0,
            ),
            1.0
        );
    }

    #[test]
    fn ordered_current_hand_resolves_dealer_hand_before_crib() {
        let outcome = current_hand_outcome(0, 0, 1, 0);
        let mut board = BoardModel::exact_joint_pegging_without_early_heuristic();

        assert_eq!(
            ordered_current_hand_win_probability(
                &mut board,
                120,
                100,
                Role::Dealer,
                Role::Pone,
                outcome,
                0,
            ),
            1.0
        );
    }

    #[test]
    fn ordered_current_hand_delays_dealer_crib_until_after_pone_hand() {
        let outcome = current_hand_outcome(0, 0, 0, 1);
        let mut board = BoardModel::exact_joint_pegging_without_early_heuristic();

        assert_eq!(
            ordered_current_hand_win_probability(
                &mut board,
                120,
                120,
                Role::Dealer,
                Role::Pone,
                outcome,
                1,
            ),
            0.0
        );
    }

    #[test]
    fn ordered_current_hand_keeps_joint_pegging_double_out_indeterminate() {
        let outcome = current_hand_outcome(1, 1, 0, 0);
        let mut board = BoardModel::exact_joint_pegging_without_early_heuristic();

        assert_eq!(
            ordered_current_hand_win_probability(
                &mut board,
                120,
                120,
                Role::Dealer,
                Role::Pone,
                outcome,
                0,
            ),
            0.5
        );
    }

    #[test]
    fn packed_rank_counts_preserve_distinct_counts() {
        let mut ranks_a = [0_u8; 13];
        let mut ranks_b = [0_u8; 13];
        ranks_a[0] = 1;
        ranks_a[12] = 4;
        ranks_b[0] = 2;
        ranks_b[12] = 3;

        assert_ne!(pack_rank_counts(&ranks_a), pack_rank_counts(&ranks_b));
        assert_eq!(pack_rank_counts(&ranks_a), (1_u64 << 0) | (4_u64 << 36));
    }

    #[test]
    fn packed_play_ranks_preserve_order_and_length() {
        assert_ne!(pack_play_ranks(&[6, 7]), pack_play_ranks(&[7, 6]));
        assert_ne!(pack_play_ranks(&[6]), pack_play_ranks(&[6, 0]));
        assert_eq!(pack_play_ranks(&[]), 0);
    }

    #[test]
    fn packed_pegging_keys_distinguish_state_fields() {
        let mut hands = [[0_u8; 13]; 2];
        hands[player_index(PlayerKey::Ai)][4] = 1;
        hands[player_index(PlayerKey::Human)][7] = 1;
        let base = PegSimulationState {
            hands,
            plays: vec![4, 7],
            count: 13,
            current: PlayerKey::Ai,
            go_player: None,
            last_player: Some(PlayerKey::Human),
            perspective: PlayerKey::Ai,
        };
        let mut reordered = base.clone();
        reordered.plays = vec![7, 4];
        let mut changed_hand = base.clone();
        changed_hand.hands[player_index(PlayerKey::Ai)][4] = 0;
        changed_hand.hands[player_index(PlayerKey::Ai)][5] = 1;

        assert_ne!(peg_simulation_key(&base), peg_simulation_key(&reordered));
        assert_ne!(peg_simulation_key(&base), peg_simulation_key(&changed_hand));
    }

    #[test]
    fn model16_policy_overrides_backoff_without_hidden_hand_search() {
        let input = model16_peg_input();
        let fallback = recommend_peg_model16(&input, &input.ai_hand, None).unwrap();
        let artifact = model16_artifact(&input, 5);
        let learned = recommend_peg_model16(&input, &input.ai_hand, Some(&artifact)).unwrap();

        assert!(matches!(
            fallback,
            Decision::Peg {
                card_id: Some(4),
                model16_policy: Some(Model16PolicyDecision {
                    source: Model16PolicySource::Fallback,
                    ..
                }),
                ..
            }
        ));
        assert!(matches!(
            learned,
            Decision::Peg {
                card_id: Some(5),
                ev: None,
                win_probability: None,
                model16_policy: Some(Model16PolicyDecision {
                    source: Model16PolicySource::Learned,
                    confidence: Some(10),
                    selected_weight: Some(65535),
                }),
                ..
            }
        ));
    }

    #[test]
    fn model16_sampled_average_policy_respects_weight_boundaries() {
        let mut input = model16_peg_input();
        input.model16_policy_mode = Model16PolicyMode::Sample;
        let mut artifact = model16_artifact(&input, 5);
        artifact.entries[0].weights = [0; 14];
        artifact.entries[0].weights[4] = 32_767;
        artifact.entries[0].weights[5] = 32_768;

        input.model16_policy_sample = 0;
        assert!(matches!(
            recommend_peg_model16(&input, &input.ai_hand, Some(&artifact)).unwrap(),
            Decision::Peg {
                card_id: Some(4),
                ..
            }
        ));
        input.model16_policy_sample = 32_766;
        assert!(matches!(
            recommend_peg_model16(&input, &input.ai_hand, Some(&artifact)).unwrap(),
            Decision::Peg {
                card_id: Some(4),
                ..
            }
        ));
        input.model16_policy_sample = 32_767;
        assert!(matches!(
            recommend_peg_model16(&input, &input.ai_hand, Some(&artifact)).unwrap(),
            Decision::Peg {
                card_id: Some(5),
                ..
            }
        ));
        input.model16_policy_sample = 65_534;
        assert!(matches!(
            recommend_peg_model16(&input, &input.ai_hand, Some(&artifact)).unwrap(),
            Decision::Peg {
                card_id: Some(5),
                ..
            }
        ));
    }

    #[test]
    fn model16_fallback_override_bypasses_present_policy() {
        let mut input = model16_peg_input();
        input.model16_policy_mode = Model16PolicyMode::Fallback;
        let artifact = model16_artifact(&input, 5);
        assert!(matches!(
            recommend_peg_model16(&input, &input.ai_hand, Some(&artifact)).unwrap(),
            Decision::Peg {
                card_id: Some(4),
                model16_policy: Some(Model16PolicyDecision {
                    source: Model16PolicySource::Fallback,
                    confidence: None,
                    selected_weight: None,
                }),
                ..
            }
        ));
    }

    #[test]
    fn model16_shared_policy_key_has_one_deterministic_action() {
        let input = model16_peg_input();
        let artifact = model16_artifact(&input, 5);
        let mut alternate_world = input.clone();
        // These legal/public cards affected the legacy opponent-world
        // enumerator but are intentionally outside the learned abstraction.
        // An actual hidden opponent hand is not present in DecisionInput at all.
        alternate_world.own_discards = cards_from_ids(&[13, 14]).unwrap();
        alternate_world.turn_card = Card::new(15).unwrap();
        alternate_world.peg_lead = Some(4);
        assert_eq!(
            model16_policy_key(&input).unwrap(),
            model16_policy_key(&alternate_world).unwrap()
        );

        let first = recommend_peg_model16(&input, &input.ai_hand, Some(&artifact)).unwrap();
        let second =
            recommend_peg_model16(&alternate_world, &alternate_world.ai_hand, Some(&artifact))
                .unwrap();
        assert_eq!(decision_json(&first), decision_json(&second));
    }

    #[test]
    fn model16_policy_file_is_loaded_once_and_reused() {
        let input = model16_peg_input();
        let artifact = model16_artifact(&input, 5);
        let root =
            std::env::temp_dir().join(format!("cribbage-model16-runtime-{}", std::process::id()));
        let path = root
            .join("rust")
            .join("cribbage-shadow-engine")
            .join("assets")
            .join("model16-pegging-policy.bin");
        artifact.save(&path).unwrap();
        let tables = RuntimeTables::new(root.to_str().unwrap());
        let first = tables.policy16().unwrap().unwrap();
        let second = tables.policy16().unwrap().unwrap();
        assert!(std::ptr::eq(first, second));
        assert_eq!(first, &artifact);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn decision_parser_ignores_legacy_full_crib_and_uses_own_discards() {
        let input = parse_decision_input(
            "kind=peg;model=15.2;role=dealer;aiHand=0,1;aiTable=;humanTable=;humanHandCount=4;crib=4,5,6,7;ownDiscards=2,3;turnCard=8;count=0;turn=ai;go=-;last=-;plays=;pegLead=-",
        )
        .unwrap();

        assert_eq!(
            input
                .own_discards
                .iter()
                .map(|card| card.id)
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
        let mut known = known_cards_for_pegging(&input)
            .iter()
            .map(|card| card.id)
            .collect::<Vec<_>>();
        known.sort_unstable();
        assert_eq!(known, vec![0, 1, 2, 3, 8]);
        assert_eq!(
            upcoming_crib_score_distribution(&input),
            vec![(score_phase_average(ScorePhase::Crib).round() as i32, 1.0)]
        );

        let mut model16 = input.clone();
        model16.model = MODEL_16_0.to_string();
        assert!(!uses_ordered_current_hand_scoring(&input));
        assert!(uses_ordered_current_hand_scoring(&model16));
    }
}
