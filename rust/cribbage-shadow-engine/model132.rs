//! Model 13.2's legal-information boundary for executable pegging policies.
//!
//! `RankPegState` may contain both hidden hands so a simulator can score a
//! world.  A policy never receives that state.  It receives only the acting
//! player's `Model132Observation`.

use crate::board::Role;
use crate::cards::{
    enumerate_rank_count_keys, rank_combination_count, rank_count_key, rank_count_total,
    rank_counts_from_key, VALUES,
};
use crate::information_set::{
    InfoActor, PegSeat, PublicPegEvent, RankPegAction, RankPegEvent, RankPegState,
};
use crate::model91::{
    Model91Actor, Model91Choice, Model91EmpiricalBeliefs, Model91Observation, Model91Policy,
    Model91PolicyStats,
};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

const RANKS: usize = 13;
const MAX_SERIES: usize = 8;
pub const MODEL132_PAIR_MAGIC: &[u8; 8] = b"M132P001";
pub const MODEL132_PAIR_VERSION: u32 = 1;
pub const MODEL132_PAIR_HEADER_BYTES: usize = 56;
pub const MODEL132_PAIR_RECORD_BYTES: usize = 2;
pub const MODEL132_INVALID_PAIR: u16 = u16::MAX;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Model132PairOutcome {
    pub dealer_points: u8,
    pub pone_points: u8,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Model132HistogramBin {
    pub my_points: u8,
    pub opponent_points: u8,
    pub weight: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Model132PeggingSummary {
    pub my_ev: f64,
    pub opponent_ev: f64,
    pub total_weight: u64,
    pub histogram: Vec<Model132HistogramBin>,
}

/// Reusable Model 13.2 keep-pair outcomes. The offline rollout deliberately
/// omits both players' crib discards. At discard-selection time the actor's
/// actual two discards are removed from opponent-hand availability before the
/// pair outcomes are aggregated.
pub struct Model132KeepPairTable {
    pub keep_ranks: Vec<[u8; RANKS]>,
    keep_id_by_key: HashMap<String, usize>,
    dealer_prior: Vec<u64>,
    pone_prior: Vec<u64>,
    outcomes: Vec<u16>,
    exhaustive: bool,
}

impl Model132KeepPairTable {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let bytes = fs::read(path).map_err(|error| {
            format!(
                "read Model 13.2 pair asset {} failed: {error}",
                path.display()
            )
        })?;
        if bytes.len() < MODEL132_PAIR_HEADER_BYTES || &bytes[..8] != MODEL132_PAIR_MAGIC {
            return Err("invalid Model 13.2 pair asset header".to_string());
        }
        let version = read_u32(&bytes, 8)?;
        let keep_count = read_u32(&bytes, 12)? as usize;
        let dealer_start = read_u32(&bytes, 16)? as usize;
        let dealer_count = read_u32(&bytes, 20)? as usize;
        let record_bytes = read_u32(&bytes, 24)? as usize;
        let flags = read_u32(&bytes, 28)?;
        let prior_offset = read_u64(&bytes, 32)? as usize;
        let outcome_offset = read_u64(&bytes, 40)? as usize;
        let declared_pairs = read_u64(&bytes, 48)?;
        let keep_keys = enumerate_rank_count_keys(4);
        if version != MODEL132_PAIR_VERSION
            || keep_count != keep_keys.len()
            || dealer_start != 0
            || dealer_count != keep_count
            || record_bytes != MODEL132_PAIR_RECORD_BYTES
            || flags & !1 != 0
            || prior_offset != MODEL132_PAIR_HEADER_BYTES
            || outcome_offset != prior_offset + keep_count * 2 * 8
        {
            return Err("unsupported or incomplete Model 13.2 pair asset".to_string());
        }
        let expected = outcome_offset
            .checked_add(keep_count * keep_count * MODEL132_PAIR_RECORD_BYTES)
            .ok_or_else(|| "Model 13.2 pair asset size overflow".to_string())?;
        if bytes.len() != expected {
            return Err(format!(
                "Model 13.2 pair asset has {} bytes; expected {expected}",
                bytes.len()
            ));
        }
        let dealer_prior = read_u64_slice(&bytes, prior_offset, keep_count)?;
        let pone_prior = read_u64_slice(&bytes, prior_offset + keep_count * 8, keep_count)?;
        let outcomes = bytes[outcome_offset..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        let actual_pairs = outcomes
            .iter()
            .filter(|value| **value != MODEL132_INVALID_PAIR)
            .count() as u64;
        if actual_pairs != declared_pairs {
            return Err(format!(
                "Model 13.2 pair asset declares {declared_pairs} outcomes but contains {actual_pairs}"
            ));
        }
        for value in outcomes
            .iter()
            .copied()
            .filter(|value| *value != MODEL132_INVALID_PAIR)
        {
            unpack_pair(value)?;
        }
        let keep_ranks = keep_keys
            .iter()
            .map(|key| rank_counts_from_key(key))
            .collect::<Result<Vec<_>, _>>()?;
        let keep_id_by_key = keep_keys
            .into_iter()
            .enumerate()
            .map(|(index, key)| (key, index))
            .collect();
        Ok(Self {
            keep_ranks,
            keep_id_by_key,
            dealer_prior,
            pone_prior,
            outcomes,
            exhaustive: flags & 1 != 0,
        })
    }

    pub fn is_exhaustive(&self) -> bool {
        self.exhaustive
    }

    /// Aggregate an own keep against the empirical opponent-keep prior after
    /// removing the actor's two known crib discards. This is the runtime
    /// dead-card modifier that allows the durable asset to key only four-card
    /// keeps rather than every six-card/discard context.
    pub fn aggregate_discard_forecast(
        &self,
        own_keep: &[u8; RANKS],
        own_discards: &[u8; RANKS],
        role: Role,
    ) -> Result<Model132PeggingSummary, String> {
        if rank_count_total(own_keep) != 4 || rank_count_total(own_discards) != 2 {
            return Err(
                "Model 13.2 discard forecast requires a four-card keep and two discards"
                    .to_string(),
            );
        }
        let own_id = self
            .keep_id_by_key
            .get(&rank_count_key(own_keep))
            .copied()
            .ok_or_else(|| "Model 13.2 own keep is not canonical".to_string())?;
        let mut available = [4_u8; RANKS];
        for rank in 0..RANKS {
            available[rank] = available[rank]
                .checked_sub(own_keep[rank])
                .and_then(|count| count.checked_sub(own_discards[rank]))
                .ok_or_else(|| format!("Model 13.2 known rank {rank} exceeds four cards"))?;
        }
        let opponent_prior = match role {
            Role::Dealer => &self.pone_prior,
            Role::Pone => &self.dealer_prior,
        };
        let mut histogram = BTreeMap::<(u8, u8), u64>::new();
        let mut my_weighted = 0_u64;
        let mut opponent_weighted = 0_u64;
        let mut total_weight = 0_u64;
        for (opponent_id, opponent_keep) in self.keep_ranks.iter().enumerate() {
            let weight =
                adjusted_keep_weight(opponent_prior[opponent_id], opponent_keep, &available)?;
            if weight == 0 {
                continue;
            }
            let (dealer_id, pone_id) = match role {
                Role::Dealer => (own_id, opponent_id),
                Role::Pone => (opponent_id, own_id),
            };
            let packed = self.outcomes[dealer_id * self.keep_ranks.len() + pone_id];
            if packed == MODEL132_INVALID_PAIR {
                if self.exhaustive {
                    return Err(
                        "Model 13.2 exhaustive asset is missing a compatible pair".to_string()
                    );
                }
                continue;
            }
            let outcome = unpack_pair(packed)?;
            let (my_points, opponent_points) = match role {
                Role::Dealer => (outcome.dealer_points, outcome.pone_points),
                Role::Pone => (outcome.pone_points, outcome.dealer_points),
            };
            *histogram.entry((my_points, opponent_points)).or_default() = histogram
                .get(&(my_points, opponent_points))
                .copied()
                .unwrap_or(0)
                .checked_add(weight)
                .ok_or_else(|| "Model 13.2 histogram weight overflow".to_string())?;
            total_weight = total_weight
                .checked_add(weight)
                .ok_or_else(|| "Model 13.2 total weight overflow".to_string())?;
            my_weighted = my_weighted
                .checked_add(u64::from(my_points) * weight)
                .ok_or_else(|| "Model 13.2 weighted own score overflow".to_string())?;
            opponent_weighted = opponent_weighted
                .checked_add(u64::from(opponent_points) * weight)
                .ok_or_else(|| "Model 13.2 weighted opponent score overflow".to_string())?;
        }
        if total_weight == 0 {
            return Err(
                "Model 13.2 discard forecast has no compatible sampled opponent keeps".to_string(),
            );
        }
        Ok(Model132PeggingSummary {
            my_ev: my_weighted as f64 / total_weight as f64,
            opponent_ev: opponent_weighted as f64 / total_weight as f64,
            total_weight,
            histogram: histogram
                .into_iter()
                .map(
                    |((my_points, opponent_points), weight)| Model132HistogramBin {
                        my_points,
                        opponent_points,
                        weight,
                    },
                )
                .collect(),
        })
    }
}

pub fn adjusted_keep_weight(
    empirical_weight: u64,
    keep: &[u8; RANKS],
    available: &[u8; RANKS],
) -> Result<u64, String> {
    if empirical_weight == 0 {
        return Ok(0);
    }
    let full = rank_combination_count(keep, &[4_u8; RANKS]);
    let remaining = rank_combination_count(keep, available);
    if full <= 0.0 {
        return Err("Model 13.2 prior contains an invalid four-card keep".to_string());
    }
    Ok((empirical_weight as f64 * remaining / full).round() as u64)
}

fn unpack_pair(value: u16) -> Result<Model132PairOutcome, String> {
    if value == MODEL132_INVALID_PAIR || value >> 10 != 0 {
        return Err(format!("invalid Model 13.2 pair outcome {value:#06x}"));
    }
    Ok(Model132PairOutcome {
        dealer_points: (value & 0x1f) as u8,
        pone_points: ((value >> 5) & 0x1f) as u8,
    })
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| format!("Model 13.2 u32 is out of range at {offset}"))?;
    Ok(u32::from_le_bytes(value.try_into().expect("four bytes")))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, String> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| format!("Model 13.2 u64 is out of range at {offset}"))?;
    Ok(u64::from_le_bytes(value.try_into().expect("eight bytes")))
}

fn read_u64_slice(bytes: &[u8], offset: usize, count: usize) -> Result<Vec<u64>, String> {
    (0..count)
        .map(|index| read_u64(bytes, offset + index * 8))
        .collect()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Model132Observation {
    pub role: Role,
    pub my_score: i32,
    pub opponent_score: i32,
    pub own_remaining: [u8; RANKS],
    pub own_played: [u8; RANKS],
    pub opponent_played: [u8; RANKS],
    pub own_discards: [u8; RANKS],
    pub turn_rank: u8,
    pub current_series: Vec<u8>,
    pub count: u8,
    pub go_player: Option<InfoActor>,
    pub last_player: Option<InfoActor>,
    pub public_history: Vec<PublicPegEvent>,
}

impl Model132Observation {
    pub fn from_state(state: &RankPegState, actor: PegSeat) -> Result<Self, String> {
        if state.current != actor {
            return Err("Model 13.2 observation actor is not the current player".to_string());
        }

        let mut own_played = [0_u8; RANKS];
        let mut opponent_played = [0_u8; RANKS];
        let mut public_history = Vec::with_capacity(state.history.len());
        for event in &state.history {
            match *event {
                RankPegEvent::Play { seat, rank } if seat == actor => {
                    add_played_rank(&mut own_played, rank)?;
                    public_history.push(PublicPegEvent::SelfPlay(rank));
                }
                RankPegEvent::Play { rank, .. } => {
                    add_played_rank(&mut opponent_played, rank)?;
                    public_history.push(PublicPegEvent::OpponentPlay(rank));
                }
                RankPegEvent::Go { seat } if seat == actor => {
                    public_history.push(PublicPegEvent::SelfGo);
                }
                RankPegEvent::Go { .. } => {
                    public_history.push(PublicPegEvent::OpponentGo);
                }
                RankPegEvent::Reset => public_history.push(PublicPegEvent::Reset),
            }
        }

        let observation = Model132Observation {
            role: if actor == state.dealer {
                Role::Dealer
            } else {
                Role::Pone
            },
            my_score: state.scores[actor.index()],
            opponent_score: state.scores[actor.other().index()],
            own_remaining: state.hands[actor.index()],
            own_played,
            opponent_played,
            own_discards: state.own_discards[actor.index()],
            turn_rank: state.turn_rank,
            current_series: state.plays.clone(),
            count: state.count,
            go_player: relative_actor(state.go_player, actor),
            last_player: relative_actor(state.last_player, actor),
            public_history,
        };
        observation.validate()?;
        Ok(observation)
    }

    pub fn legal_actions(&self) -> Vec<RankPegAction> {
        let actions = self
            .own_remaining
            .iter()
            .enumerate()
            .filter_map(|(rank, copies)| {
                (*copies > 0 && self.count + VALUES[rank] <= 31)
                    .then_some(RankPegAction::Play(rank as u8))
            })
            .collect::<Vec<_>>();
        if actions.is_empty() {
            vec![RankPegAction::Go]
        } else {
            actions
        }
    }

    fn validate(&self) -> Result<(), String> {
        if !(0..=121).contains(&self.my_score) || !(0..=121).contains(&self.opponent_score) {
            return Err("Model 13.2 score is outside 0..=121".to_string());
        }
        if self.turn_rank as usize >= RANKS {
            return Err("Model 13.2 cut rank is invalid".to_string());
        }
        if self.count > 31 {
            return Err("Model 13.2 count exceeds 31".to_string());
        }
        if self.current_series.len() > MAX_SERIES {
            return Err(format!(
                "Model 13.2 current series has {} cards; maximum is {}",
                self.current_series.len(),
                MAX_SERIES
            ));
        }
        for (label, ranks) in [
            ("own remaining", &self.own_remaining),
            ("own played", &self.own_played),
            ("opponent played", &self.opponent_played),
            ("own discards", &self.own_discards),
        ] {
            if ranks.iter().any(|copies| *copies > 4) {
                return Err(format!("Model 13.2 {label} contains more than four copies"));
            }
        }
        let own_initial_keep =
            std::array::from_fn(|rank| self.own_remaining[rank] + self.own_played[rank]);
        if rank_count_total(&own_initial_keep) != 4 {
            return Err("Model 13.2 actor keep does not total four cards".to_string());
        }
        if !matches!(rank_count_total(&self.own_discards), 0 | 2) {
            return Err("Model 13.2 own discards must contain zero or two cards".to_string());
        }
        if rank_count_total(&self.opponent_played) > 4 {
            return Err("Model 13.2 observation has more than four opponent plays".to_string());
        }
        let series_count = self
            .current_series
            .iter()
            .try_fold(0_u8, |total, rank| {
                VALUES
                    .get(*rank as usize)
                    .map(|value| total.saturating_add(*value))
            })
            .ok_or_else(|| "Model 13.2 current series contains an invalid rank".to_string())?;
        if series_count != self.count {
            return Err(format!(
                "Model 13.2 series count {series_count} does not match state count {}",
                self.count
            ));
        }
        Ok(())
    }
}

/// Executable policies cross this boundary; hidden-world state does not.
pub trait Model132PeggingPolicy {
    fn choose_action(&self, observation: &Model132Observation) -> Result<RankPegAction, String>;
}

/// One fully specified hidden world used by an offline builder. The builder
/// may inspect both hands to group equivalent legal observations; policies
/// still receive only `Model132Observation`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Model132World {
    pub hands: [[u8; RANKS]; 2],
    pub own_discards: [[u8; RANKS]; 2],
}

/// The first executable Model 13.2 policy. It reuses Model 9.1's legal
/// information-set evaluator, but supplies the cut and the actor's own crib
/// discards and disables its cross-decision cache. Each simulated actor calls
/// this same policy through `Model132Observation`; hidden world state never
/// crosses the boundary.
pub struct Model132HeuristicPolicy {
    inner: RefCell<Model91Policy>,
    include_cut_in_beliefs: bool,
}

/// Versioned likelihoods for legally playable scoring cards an opponent did
/// not play. Each array is indexed by the opponent's first, second, or third
/// card. Values are parts per million estimates of P(non-scoring decline |
/// opponent held the candidate card and it was legal).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Model1322DeclineFactors {
    pub three_card_run_ppm: [u32; 3],
    pub four_plus_card_run_ppm: [u32; 3],
    pub pair_ppm: [u32; 3],
    pub pair_royal_after_pair_ppm: [u32; 3],
    pub four_of_a_kind_after_pair_royal_ppm: [u32; 3],
    pub safe_pair_ppm: [u32; 3],
    pub safe_pair_royal_ppm: [u32; 3],
}

impl Model1322DeclineFactors {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let asset: serde_json::Value = serde_json::from_slice(
            &fs::read(path).map_err(|error| format!("read {} failed: {error}", path.display()))?,
        )
        .map_err(|error| format!("parse {} failed: {error}", path.display()))?;
        if asset["schemaVersion"].as_u64() != Some(3)
            || asset["modelVersion"].as_str() != Some("13.22")
        {
            return Err("unsupported Model 13.22 decline-factor asset".to_string());
        }
        let factors = Self {
            three_card_run_ppm: decline_factor_ordinals(&asset, "threeCardRun")?,
            four_plus_card_run_ppm: decline_factor_ordinals(&asset, "fourPlusCardRun")?,
            pair_ppm: decline_factor_ordinals(&asset, "pair")?,
            pair_royal_after_pair_ppm: decline_factor_ordinals(&asset, "pairRoyalAfterPair")?,
            four_of_a_kind_after_pair_royal_ppm: decline_factor_ordinals(
                &asset,
                "fourOfAKindAfterPairRoyal",
            )?,
            safe_pair_ppm: decline_factor_ordinals(&asset, "safePair")?,
            safe_pair_royal_ppm: decline_factor_ordinals(&asset, "safePairRoyal")?,
        };
        factors.validate()?;
        Ok(factors)
    }

    pub fn validate(&self) -> Result<(), String> {
        for (label, values) in [
            ("three-card run", self.three_card_run_ppm),
            ("four-plus-card run", self.four_plus_card_run_ppm),
            ("pair", self.pair_ppm),
            ("pair royal after a pair", self.pair_royal_after_pair_ppm),
            (
                "four of a kind after a pair royal",
                self.four_of_a_kind_after_pair_royal_ppm,
            ),
            ("safe pair", self.safe_pair_ppm),
            ("safe pair royal", self.safe_pair_royal_ppm),
        ] {
            for (index, value) in values.into_iter().enumerate() {
                if value > 1_000_000 {
                    return Err(format!(
                        "Model 13.22 {label} card {} decline factor exceeds 1,000,000 ppm",
                        index + 1
                    ));
                }
            }
        }
        Ok(())
    }
}

fn decline_factor_ordinals(asset: &serde_json::Value, category: &str) -> Result<[u32; 3], String> {
    let row = &asset["factors"][category];
    let fallback = row["multiplierPpm"]
        .as_u64()
        .ok_or_else(|| format!("Model 13.22 {category} lacks multiplierPpm"))?;
    let mut result = [0_u32; 3];
    for (index, ordinal) in ["first", "second", "third"].into_iter().enumerate() {
        let ordinal_row = &row["byCardOrdinal"][ordinal];
        let observed = required_factor_count(ordinal_row, category, ordinal, "observedDeclines")?;
        let held = required_factor_count(ordinal_row, category, ordinal, "declinesWithCardHeld")?;
        let not_held =
            required_factor_count(ordinal_row, category, ordinal, "declinesWithoutCardHeld")?;
        if held.saturating_add(not_held) != observed {
            return Err(format!(
                "Model 13.22 {category}/{ordinal} held-card counts do not sum"
            ));
        }
        let posterior = ordinal_row["heldGivenDeclinePpm"].as_u64();
        if (observed == 0) != posterior.is_none()
            || posterior.is_some_and(|value| value > 1_000_000)
        {
            return Err(format!(
                "Model 13.22 {category}/{ordinal} posterior is inconsistent"
            ));
        }
        let multiplier = ordinal_row["multiplierPpm"].as_u64().unwrap_or(fallback);
        result[index] = u32::try_from(multiplier)
            .map_err(|_| format!("Model 13.22 {category}/{ordinal} multiplier does not fit u32"))?;
    }
    Ok(result)
}

fn required_factor_count(
    row: &serde_json::Value,
    category: &str,
    ordinal: &str,
    field: &str,
) -> Result<u64, String> {
    row[field]
        .as_u64()
        .ok_or_else(|| format!("Model 13.22 {category}/{ordinal} lacks {field}"))
}

/// Model 9.11's executable pegging policy and Model 13.22's shared correction
/// policy. A context-free adapter builds the reusable four-keep pair matrix;
/// the live adapter adds actor-owned discards and the cut. Both retain the
/// same go/decline behavior and share builder-local action, evidence, and
/// continuation memoization.
pub struct Model911Policy {
    inner: Arc<Mutex<Model91Policy>>,
    factors: Model1322DeclineFactors,
    include_owned_dead_cards: bool,
}

/// Model 13.22 uses Model 9.11's executable policy with actor-owned dead cards
/// enabled. Keeping one implementation prevents the baseline and correction
/// stages from drifting apart.
pub type Model1322HeuristicPolicy = Model911Policy;

/// Counters for the fusion-safe direct policy. There are deliberately no
/// fictional-world or continuation-tree counters: one call scores only the
/// legal actions visible in the supplied observation.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Model1322FastPolicyStats {
    pub decision_requests: u64,
    pub candidate_evaluations: u64,
    pub reply_rank_evaluations: u64,
}

/// Fast executable policy for the Model 13.22 offline builder.
///
/// Model 13.0's builder was fast because it advanced one exact two-hand state
/// directly. Its strategy fusion came from `optimalPegging` selecting each
/// move with both hands visible. This policy is the narrow correction: exact
/// hands still drive state advancement and scoring, but action selection is a
/// bounded tactical calculation over `Model132Observation` only.
pub struct Model1322FastPolicy {
    factors: Model1322DeclineFactors,
    stats: Cell<Model1322FastPolicyStats>,
}

impl Model1322FastPolicy {
    pub fn new(factors: Model1322DeclineFactors) -> Result<Self, String> {
        factors.validate()?;
        Ok(Self {
            factors,
            stats: Cell::new(Model1322FastPolicyStats::default()),
        })
    }

    pub fn stats(&self) -> Model1322FastPolicyStats {
        self.stats.get()
    }
}

impl Model132PeggingPolicy for Model1322FastPolicy {
    fn choose_action(&self, observation: &Model132Observation) -> Result<RankPegAction, String> {
        let legal = observation.legal_actions();
        if legal == [RankPegAction::Go] {
            return Ok(RankPegAction::Go);
        }
        let likelihoods = model1322_opponent_rank_likelihoods(observation, self.factors)?;
        let available = model1322_available_opponent_ranks(observation)?;
        let mut stats = self.stats.get();
        stats.decision_requests = stats.decision_requests.saturating_add(1);
        let mut best = None::<(u8, [f64; 7])>;
        for action in legal {
            let RankPegAction::Play(rank) = action else {
                continue;
            };
            stats.candidate_evaluations = stats.candidate_evaluations.saturating_add(1);
            let key =
                model1322_fast_action_key(observation, rank, &available, &likelihoods, &mut stats)?;
            if best
                .as_ref()
                .is_none_or(|(_, current)| compare_model1322_fast_key(key, *current).is_gt())
            {
                best = Some((rank, key));
            }
        }
        self.stats.set(stats);
        best.map(|(rank, _)| RankPegAction::Play(rank))
            .ok_or_else(|| "Model 13.22 fast policy received no legal play".to_string())
    }
}

fn model1322_available_opponent_ranks(
    observation: &Model132Observation,
) -> Result<[u8; RANKS], String> {
    let mut available = [4_u8; RANKS];
    for rank in 0..RANKS {
        let known = observation.own_remaining[rank]
            .saturating_add(observation.own_played[rank])
            .saturating_add(observation.opponent_played[rank])
            .saturating_add(observation.own_discards[rank])
            .saturating_add(u8::from(observation.turn_rank as usize == rank));
        available[rank] = 4_u8.checked_sub(known).ok_or_else(|| {
            format!("Model 13.22 observation uses more than four rank {rank} cards")
        })?;
    }
    Ok(available)
}

fn model1322_fast_action_key(
    observation: &Model132Observation,
    rank: u8,
    available: &[u8; RANKS],
    likelihoods: &[u32; RANKS],
    stats: &mut Model1322FastPolicyStats,
) -> Result<[f64; 7], String> {
    if rank as usize >= RANKS || observation.own_remaining[rank as usize] == 0 {
        return Err(format!(
            "Model 13.22 fast policy received absent rank {rank}"
        ));
    }
    let mut series = [0_u8; MAX_SERIES + 1];
    let length = observation.current_series.len();
    series[..length].copy_from_slice(&observation.current_series);
    series[length] = rank;
    let played_length = length + 1;
    let immediate = f64::from(score_count_for_rank_series(&series[..played_length]));
    let count_after = observation.count + VALUES[rank as usize];
    let wins_now = f64::from(observation.my_score + immediate as i32 >= 121);
    let mut reply_weight = 0.0;
    let mut reply_point_total = 0.0;
    let mut max_reply = 0.0_f64;
    let mut winning_reply_weight = 0.0;
    if count_after < 31
        && played_length < MAX_SERIES
        && observation.go_player != Some(InfoActor::Opponent)
    {
        for reply_rank in 0..RANKS {
            if available[reply_rank] == 0
                || likelihoods[reply_rank] == 0
                || count_after + VALUES[reply_rank] > 31
            {
                continue;
            }
            stats.reply_rank_evaluations = stats.reply_rank_evaluations.saturating_add(1);
            series[played_length] = reply_rank as u8;
            let reply_points = f64::from(score_count_for_rank_series(&series[..played_length + 1]));
            let weight =
                f64::from(available[reply_rank]) * f64::from(likelihoods[reply_rank]) / 1_000_000.0;
            reply_weight += weight;
            reply_point_total += weight * reply_points;
            max_reply = max_reply.max(reply_points);
            if observation.opponent_score + reply_points as i32 >= 121 {
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
    let immediate_weight = if observation.my_score >= 117 {
        12.0
    } else {
        6.0
    };
    let reply_penalty = if observation.opponent_score >= 117 {
        12.0
    } else {
        4.0
    };
    let tactical = immediate * immediate_weight - max_reply * reply_penalty - expected_reply;
    Ok([
        wins_now,
        -winning_reply_rate,
        tactical,
        immediate,
        -max_reply,
        -expected_reply,
        f64::from(rank + 1),
    ])
}

fn compare_model1322_fast_key(left: [f64; 7], right: [f64; 7]) -> std::cmp::Ordering {
    for (left_value, right_value) in left.into_iter().zip(right) {
        let ordering = left_value.total_cmp(&right_value);
        if !ordering.is_eq() {
            return ordering;
        }
    }
    std::cmp::Ordering::Equal
}

fn score_count_for_rank_series(ranks: &[u8]) -> u8 {
    if ranks.len() < 2 {
        return 0;
    }
    let mut points = 0_u8;
    let count = ranks.iter().map(|rank| VALUES[*rank as usize]).sum::<u8>();
    if matches!(count, 15 | 31) {
        points += 2;
    }
    let last = ranks[ranks.len() - 1];
    let same = 1 + ranks[..ranks.len() - 1]
        .iter()
        .rev()
        .take_while(|rank| **rank == last)
        .count();
    points += match same {
        2 => 2,
        3 => 6,
        4 => 12,
        _ => 0,
    };
    for run_length in (3..=ranks.len()).rev() {
        let tail = &ranks[ranks.len() - run_length..];
        let mut seen = [false; RANKS];
        let mut min = u8::MAX;
        let mut max = 0_u8;
        let unique = tail.iter().all(|rank| {
            let index = *rank as usize;
            if index >= RANKS || seen[index] {
                return false;
            }
            seen[index] = true;
            min = min.min(*rank);
            max = max.max(*rank);
            true
        });
        if unique && usize::from(max - min + 1) == run_length {
            points += run_length as u8;
            break;
        }
    }
    points
}

impl Model911Policy {
    pub fn new(
        empirical: Option<Model91EmpiricalBeliefs>,
        factors: Model1322DeclineFactors,
        action_cache_limit: usize,
        future_cache_limit: usize,
    ) -> Result<Self, String> {
        Self::new_with_evidence_cache(
            empirical,
            factors,
            action_cache_limit,
            0,
            future_cache_limit,
        )
    }

    pub fn new_with_evidence_cache(
        empirical: Option<Model91EmpiricalBeliefs>,
        factors: Model1322DeclineFactors,
        action_cache_limit: usize,
        evidence_cache_outcome_limit: usize,
        future_cache_limit: usize,
    ) -> Result<Self, String> {
        factors.validate()?;
        Ok(Self {
            inner: Arc::new(Mutex::new(Model91Policy::new_with_evidence_cache(
                empirical,
                action_cache_limit,
                evidence_cache_outcome_limit,
                future_cache_limit,
            ))),
            factors,
            include_owned_dead_cards: true,
        })
    }

    /// Reuse the same memoized evaluator while omitting both players' crib
    /// discards and the cut. This is the Model 9.11 four-keep baseline used by
    /// the pair builder, not a separate playing strategy.
    pub fn context_free_baseline(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            factors: self.factors,
            include_owned_dead_cards: false,
        }
    }

    pub fn stats(&self) -> Model91PolicyStats {
        self.lock_inner().stats()
    }

    pub fn clear_hand_cache(&self) {
        self.lock_inner().clear_future_cache();
    }

    pub fn clear_edit_evidence_cache(&self) {
        self.lock_inner().clear_evidence_cache();
    }

    fn lock_inner(&self) -> MutexGuard<'_, Model91Policy> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn model91_observation(
        &self,
        observation: &Model132Observation,
    ) -> Result<Model91Observation, String> {
        let own_discards = if self.include_owned_dead_cards {
            observation.own_discards
        } else {
            [0_u8; RANKS]
        };
        Model91Observation::from_public_state(
            observation.role,
            observation.own_remaining,
            observation.own_played,
            observation.opponent_played,
            own_discards,
            self.include_owned_dead_cards
                .then_some(observation.turn_rank),
            &observation.current_series,
            observation.count,
            model91_actor(observation.go_player),
            model91_actor(observation.last_player),
        )
    }

    pub fn choose_action_for_weighted_opponent_hands(
        &self,
        observation: &Model132Observation,
        opponent_hands: Vec<([u8; RANKS], f64)>,
    ) -> Result<RankPegAction, String> {
        let model91_observation = self.model91_observation(observation)?;
        let likelihoods = model1322_opponent_rank_likelihoods_with_known_cut(
            observation,
            self.factors,
            self.include_owned_dead_cards,
        )?;
        self.lock_inner().choose_action_for_weighted_opponent_hands(
                &model91_observation,
                opponent_hands,
                &likelihoods,
            )
    }

    pub fn choose_action_with_net_ev(
        &self,
        observation: &Model132Observation,
    ) -> Result<Model91Choice, String> {
        let model91_observation = self.model91_observation(observation)?;
        let likelihoods = model1322_opponent_rank_likelihoods_with_known_cut(
            observation,
            self.factors,
            self.include_owned_dead_cards,
        )?;
        self.lock_inner()
            .choose_action_with_opponent_likelihood_and_net_ev(&model91_observation, &likelihoods)
    }
}

impl Model132PeggingPolicy for Model911Policy {
    fn choose_action(&self, observation: &Model132Observation) -> Result<RankPegAction, String> {
        let model91_observation = self.model91_observation(observation)?;
        let likelihoods = model1322_opponent_rank_likelihoods_with_known_cut(
            observation,
            self.factors,
            self.include_owned_dead_cards,
        )?;
        self.lock_inner()
            .choose_action_with_opponent_likelihood(&model91_observation, &likelihoods)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DeclinedCompletion {
    ThreeCardRun,
    FourPlusCardRun,
    Pair,
    PairRoyal,
    FourOfAKind,
}

fn decline_factor_ppm(
    factors: Model1322DeclineFactors,
    completion: DeclinedCompletion,
    retaliation_impossible: bool,
    opponent_card_ordinal: usize,
) -> u32 {
    let Some(index) = opponent_card_ordinal
        .checked_sub(1)
        .filter(|index| *index < 3)
    else {
        return 0;
    };
    let values = match completion {
        DeclinedCompletion::ThreeCardRun => factors.three_card_run_ppm,
        DeclinedCompletion::FourPlusCardRun => factors.four_plus_card_run_ppm,
        DeclinedCompletion::Pair if retaliation_impossible => factors.safe_pair_ppm,
        DeclinedCompletion::Pair => factors.pair_ppm,
        DeclinedCompletion::PairRoyal if retaliation_impossible => factors.safe_pair_royal_ppm,
        DeclinedCompletion::PairRoyal => factors.pair_royal_after_pair_ppm,
        DeclinedCompletion::FourOfAKind => factors.four_of_a_kind_after_pair_royal_ppm,
    };
    values[index]
}

fn declined_completion(series: &[u8], candidate: u8) -> Option<DeclinedCompletion> {
    let same_suffix = series
        .iter()
        .rev()
        .take_while(|rank| **rank == candidate)
        .count();
    match same_suffix {
        1 => return Some(DeclinedCompletion::Pair),
        2 => return Some(DeclinedCompletion::PairRoyal),
        3.. => return Some(DeclinedCompletion::FourOfAKind),
        _ => {}
    }
    let mut with_candidate = series.to_vec();
    with_candidate.push(candidate);
    for length in (3..=with_candidate.len()).rev() {
        let tail = &with_candidate[with_candidate.len() - length..];
        let mut seen = [false; RANKS];
        let mut min = u8::MAX;
        let mut max = 0_u8;
        let unique = tail.iter().all(|rank| {
            let index = *rank as usize;
            if index >= RANKS || seen[index] {
                return false;
            }
            seen[index] = true;
            min = min.min(*rank);
            max = max.max(*rank);
            true
        });
        if unique && usize::from(max - min + 1) == length {
            return Some(if length == 3 {
                DeclinedCompletion::ThreeCardRun
            } else {
                DeclinedCompletion::FourPlusCardRun
            });
        }
    }
    None
}

/// Reconstruct the likelihood evidence available to the acting player. A go
/// hard-excludes every rank that could legally have been played. Declining a
/// legal pair/run multiplier is softer evidence. Multiple public declines are
/// combined as independent likelihood observations.
pub fn model1322_opponent_rank_likelihoods(
    observation: &Model132Observation,
    factors: Model1322DeclineFactors,
) -> Result<[u32; RANKS], String> {
    model1322_opponent_rank_likelihoods_with_known_cut(observation, factors, true)
}

fn model1322_opponent_rank_likelihoods_with_known_cut(
    observation: &Model132Observation,
    factors: Model1322DeclineFactors,
    include_known_cut: bool,
) -> Result<[u32; RANKS], String> {
    factors.validate()?;
    let mut likelihoods = [1_000_000_u32; RANKS];
    let mut series = Vec::<u8>::new();
    let mut count = 0_u8;
    let mut public_known = [0_u8; RANKS];
    let mut opponent_cards_played = 0_usize;
    let mut self_said_go = false;
    if include_known_cut {
        public_known[observation.turn_rank as usize] = 1;
    }
    for event in &observation.public_history {
        match *event {
            PublicPegEvent::SelfPlay(rank) => {
                count = count.saturating_add(VALUES[rank as usize]);
                series.push(rank);
                public_known[rank as usize] = public_known[rank as usize].saturating_add(1);
            }
            PublicPegEvent::OpponentPlay(actual) => {
                let opponent_card_ordinal = opponent_cards_played + 1;
                let actual_is_competing_score = declined_completion(&series, actual).is_some()
                    || matches!(count + VALUES[actual as usize], 15 | 31);
                if !actual_is_competing_score {
                    for candidate in 0..RANKS as u8 {
                        if candidate == actual || count + VALUES[candidate as usize] > 31 {
                            continue;
                        }
                        if let Some(completion) = declined_completion(&series, candidate) {
                            let retaliation_impossible = self_said_go
                                || public_known[candidate as usize] >= 3
                                || count.saturating_add(2 * VALUES[candidate as usize]) > 31;
                            let factor = decline_factor_ppm(
                                factors,
                                completion,
                                retaliation_impossible,
                                opponent_card_ordinal,
                            );
                            likelihoods[candidate as usize] =
                                ((u64::from(likelihoods[candidate as usize]) * u64::from(factor))
                                    / 1_000_000) as u32;
                        }
                    }
                }
                // Once this rank is publicly played, earlier soft evidence
                // about holding that observed copy is constant across current
                // remaining-hand worlds.
                likelihoods[actual as usize] = 1_000_000;
                count = count.saturating_add(VALUES[actual as usize]);
                series.push(actual);
                public_known[actual as usize] = public_known[actual as usize].saturating_add(1);
                opponent_cards_played += 1;
            }
            PublicPegEvent::OpponentGo => {
                for rank in 0..RANKS {
                    if count + VALUES[rank] <= 31 {
                        likelihoods[rank] = 0;
                    }
                }
            }
            PublicPegEvent::SelfGo => self_said_go = true,
            PublicPegEvent::Reset => {
                series.clear();
                count = 0;
                self_said_go = false;
            }
        }
    }
    Ok(likelihoods)
}

impl Model132HeuristicPolicy {
    pub fn new(empirical: Option<Model91EmpiricalBeliefs>) -> Self {
        Self {
            inner: RefCell::new(Model91Policy::new(empirical, 0)),
            include_cut_in_beliefs: true,
        }
    }

    /// Reusable keep-pair forecast adapter. The offline pair asset has neither
    /// crib discards nor a cut. Live pegging uses `new`, supplies the actor's
    /// actual discards, and removes the revealed cut from opponent-hand
    /// availability.
    pub fn without_cut(empirical: Option<Model91EmpiricalBeliefs>) -> Self {
        Self {
            inner: RefCell::new(Model91Policy::new(empirical, 0)),
            include_cut_in_beliefs: false,
        }
    }

    pub fn stats(&self) -> Model91PolicyStats {
        self.inner.borrow().stats()
    }
}

impl Model132PeggingPolicy for Model132HeuristicPolicy {
    fn choose_action(&self, observation: &Model132Observation) -> Result<RankPegAction, String> {
        let model91_observation = self.model91_observation(observation)?;
        self.inner.borrow_mut().choose_action(&model91_observation)
    }
}

impl Model132HeuristicPolicy {
    fn model91_observation(
        &self,
        observation: &Model132Observation,
    ) -> Result<Model91Observation, String> {
        Model91Observation::from_public_state(
            observation.role,
            observation.own_remaining,
            observation.own_played,
            observation.opponent_played,
            observation.own_discards,
            self.include_cut_in_beliefs.then_some(observation.turn_rank),
            &observation.current_series,
            observation.count,
            model91_actor(observation.go_player),
            model91_actor(observation.last_player),
        )
    }
}

/// Play one fully specified hidden world. Both actors select every move from
/// their own legal observation. The returned points are from seat zero's
/// perspective.
pub fn rollout_model132_world(
    hands: [[u8; RANKS]; 2],
    own_discards: [[u8; RANKS]; 2],
    turn_rank: Option<u8>,
    dealer: PegSeat,
    policy: &impl Model132PeggingPolicy,
) -> Result<(u8, u8), String> {
    let mut state = model132_world_state(hands, own_discards, turn_rank, dealer)?;
    while !state.complete {
        let actor = state.current;
        let legal = state.legal_actions();
        if legal.is_empty() {
            return Err(
                "Model 13.2 rollout reached a non-terminal state without actions".to_string(),
            );
        }
        let action = if legal.len() == 1 {
            legal[0]
        } else {
            choose_for_state(policy, &state, actor)?
        };
        state.apply(action)?;
    }
    model132_world_outcome(&state)
}

/// One context-free Model 9.11 keep-pair rollout retained only for the current
/// builder edit unit. The durable 9.11 asset stores its terminal outcome, not
/// this action sequence.
#[derive(Clone, Debug)]
pub struct Model911PairTrace {
    hands: [[u8; RANKS]; 2],
    actions: Vec<RankPegAction>,
    outcome: (u8, u8),
    pub policy_decisions: usize,
}

impl Model911PairTrace {
    pub fn outcome(&self) -> (u8, u8) {
        self.outcome
    }
}

/// Produce one durable Model 9.11 pair cell. Builders that do not need the
/// ephemeral action trace can use this entry point directly.
pub fn rollout_model911_pair(
    dealer_keep: [u8; RANKS],
    pone_keep: [u8; RANKS],
    policy: &Model911Policy,
) -> Result<(u8, u8), String> {
    Ok(trace_model911_pair(dealer_keep, pone_keep, policy)?.outcome())
}

/// Model 9.11's context-free opening lead. Decline evidence cannot affect an
/// opening observation because no opponent action has occurred, but this
/// entry point deliberately crosses the same executable policy boundary used
/// by every later decision.
pub fn model911_initial_pone_lead(
    pone_keep: [u8; RANKS],
    policy: &Model911Policy,
) -> Result<u8, String> {
    if rank_count_total(&pone_keep) != 4 {
        return Err("Model 9.11 pone lead requires a four-card keep".to_string());
    }
    let observation = Model132Observation {
        role: Role::Pone,
        my_score: 0,
        opponent_score: 0,
        own_remaining: pone_keep,
        own_played: [0_u8; RANKS],
        opponent_played: [0_u8; RANKS],
        own_discards: [0_u8; RANKS],
        turn_rank: 0,
        current_series: Vec::new(),
        count: 0,
        go_player: None,
        last_player: None,
        public_history: Vec::new(),
    };
    match policy.context_free_baseline().choose_action(&observation)? {
        RankPegAction::Play(rank) => Ok(rank),
        RankPegAction::Go => Err("Model 9.11 pone policy returned go with four cards".to_string()),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Model1322DeltaOutcome {
    pub outcome: (u8, u8),
    pub action_changed: bool,
    pub outcome_changed: bool,
    pub opening_action_changed: bool,
    pub screened_policy_decisions: usize,
    pub first_changed_policy_decision: Option<usize>,
    pub suffix_policy_decisions: usize,
}

/// First baseline-path action changed by one actor's own discard and cut.
/// The other actor's private discard is deliberately absent: before either
/// player changes the public action sequence it cannot affect this actor's
/// legal observation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Model1322ActorScreen {
    pub actor: PegSeat,
    pub first_changed_action_index: Option<usize>,
    pub corrected_action: Option<RankPegAction>,
    pub screened_policy_decisions: usize,
}

/// Build one reusable context-free Model 9.11 pair result and its ephemeral
/// edit trace. Both actors use the same go/decline policy; own discards and cut
/// are intentionally omitted at this baseline stage.
pub fn trace_model911_pair(
    dealer_keep: [u8; RANKS],
    pone_keep: [u8; RANKS],
    policy: &Model911Policy,
) -> Result<Model911PairTrace, String> {
    let baseline = policy.context_free_baseline();
    let hands = [dealer_keep, pone_keep];
    let mut state = model132_world_state(hands, [[0_u8; RANKS]; 2], None, PegSeat::Zero)?;
    let mut actions = Vec::with_capacity(10);
    let mut policy_decisions = 0_usize;
    while !state.complete {
        let legal = state.legal_actions();
        if legal.is_empty() {
            return Err(
                "Model 9.11 trace reached a non-terminal state without actions".to_string(),
            );
        }
        let action = if legal.len() == 1 {
            legal[0]
        } else {
            policy_decisions += 1;
            choose_for_state(&baseline, &state, state.current)?
        };
        actions.push(action);
        state.apply(action)?;
    }
    Ok(Model911PairTrace {
        hands,
        actions,
        outcome: model132_world_outcome(&state)?,
        policy_decisions,
    })
}

/// Apply one complete dead-card context to a Model 9.11 baseline trace. If all
/// selected actions remain stable, the baseline terminal cell is reused. At
/// the first changed action, only the corrected suffix is played. Candidate
/// continuation evidence is shared with the baseline policy through its
/// builder-local cache.
pub fn rollout_model1322_delta(
    trace: &Model911PairTrace,
    own_discards: [[u8; RANKS]; 2],
    turn_rank: u8,
    policy: &Model911Policy,
) -> Result<Model1322DeltaOutcome, String> {
    let mut state =
        model132_world_state(trace.hands, own_discards, Some(turn_rank), PegSeat::Zero)?;
    let mut screened_policy_decisions = 0_usize;
    for (action_index, baseline_action) in trace.actions.iter().copied().enumerate() {
        if state.complete {
            return Err("Model 13.22 edit trace completed before its baseline".to_string());
        }
        let legal = state.legal_actions();
        if !legal.contains(&baseline_action) {
            return Err("Model 13.22 baseline action became physically illegal".to_string());
        }
        let corrected_action = if legal.len() == 1 {
            legal[0]
        } else {
            screened_policy_decisions += 1;
            choose_for_state(policy, &state, state.current)?
        };
        if corrected_action != baseline_action {
            let first_changed_policy_decision = Some(screened_policy_decisions);
            state.apply(corrected_action)?;
            let mut suffix_policy_decisions = 0_usize;
            while !state.complete {
                let legal = state.legal_actions();
                if legal.is_empty() {
                    return Err(
                        "Model 13.22 suffix reached a non-terminal state without actions"
                            .to_string(),
                    );
                }
                let action = if legal.len() == 1 {
                    legal[0]
                } else {
                    suffix_policy_decisions += 1;
                    choose_for_state(policy, &state, state.current)?
                };
                state.apply(action)?;
            }
            let outcome = model132_world_outcome(&state)?;
            return Ok(Model1322DeltaOutcome {
                outcome,
                action_changed: true,
                outcome_changed: outcome != trace.outcome,
                opening_action_changed: action_index == 0,
                screened_policy_decisions,
                first_changed_policy_decision,
                suffix_policy_decisions,
            });
        }
        state.apply(baseline_action)?;
    }
    if !state.complete {
        return Err("Model 13.22 stable edit trace did not reach its terminal state".to_string());
    }
    let outcome = model132_world_outcome(&state)?;
    if outcome != trace.outcome {
        return Err("Model 13.22 stable action trace changed terminal pegging points".to_string());
    }
    Ok(Model1322DeltaOutcome {
        outcome,
        action_changed: false,
        outcome_changed: false,
        opening_action_changed: false,
        screened_policy_decisions,
        first_changed_policy_decision: None,
        suffix_policy_decisions: 0,
    })
}

/// Screen one actor's baseline decisions using only that actor's private dead
/// cards and the shared cut. This is the exact factorization used by the
/// production edit pass before a changed action joins both private contexts.
pub fn screen_model1322_actor_context(
    trace: &Model911PairTrace,
    actor: PegSeat,
    own_discard: [u8; RANKS],
    turn_rank: u8,
    policy: &Model911Policy,
) -> Result<Model1322ActorScreen, String> {
    let mut discards = [[0_u8; RANKS]; 2];
    discards[actor.index()] = own_discard;
    let mut state = model132_world_state(trace.hands, discards, Some(turn_rank), PegSeat::Zero)?;
    let mut screened_policy_decisions = 0_usize;
    for (action_index, baseline_action) in trace.actions.iter().copied().enumerate() {
        if state.complete {
            return Err("Model 13.22 actor screen completed before its baseline".to_string());
        }
        let legal = state.legal_actions();
        if !legal.contains(&baseline_action) {
            return Err("Model 13.22 actor screen found an illegal baseline action".to_string());
        }
        if state.current == actor && legal.len() > 1 {
            screened_policy_decisions += 1;
            let corrected_action = choose_for_state(policy, &state, actor)?;
            if corrected_action != baseline_action {
                return Ok(Model1322ActorScreen {
                    actor,
                    first_changed_action_index: Some(action_index),
                    corrected_action: Some(corrected_action),
                    screened_policy_decisions,
                });
            }
        }
        state.apply(baseline_action)?;
    }
    Ok(Model1322ActorScreen {
        actor,
        first_changed_action_index: None,
        corrected_action: None,
        screened_policy_decisions,
    })
}

/// Join independently screened actor contexts. A stable pair returns the
/// Model 9.11 cell immediately. If either actor changes first, only that exact
/// joint context is materialized and replay begins at the changed action.
pub fn rollout_model1322_from_actor_screens(
    trace: &Model911PairTrace,
    own_discards: [[u8; RANKS]; 2],
    turn_rank: u8,
    screens: [Model1322ActorScreen; 2],
    policy: &Model911Policy,
) -> Result<Model1322DeltaOutcome, String> {
    if screens[0].actor == screens[1].actor {
        return Err("Model 13.22 actor screens must cover both seats".to_string());
    }
    let screened_policy_decisions = screens
        .iter()
        .map(|screen| screen.screened_policy_decisions)
        .sum();
    let first = screens
        .iter()
        .filter_map(|screen| {
            screen
                .first_changed_action_index
                .map(|index| (index, screen))
        })
        .min_by_key(|(index, _)| *index);
    let Some((first_action_index, first_screen)) = first else {
        return Ok(Model1322DeltaOutcome {
            outcome: trace.outcome,
            action_changed: false,
            outcome_changed: false,
            opening_action_changed: false,
            screened_policy_decisions,
            first_changed_policy_decision: None,
            suffix_policy_decisions: 0,
        });
    };
    let corrected_action = first_screen
        .corrected_action
        .ok_or_else(|| "Model 13.22 changed actor screen lacks its action".to_string())?;
    let mut state =
        model132_world_state(trace.hands, own_discards, Some(turn_rank), PegSeat::Zero)?;
    let mut first_changed_policy_decision = 0_usize;
    for baseline_action in trace.actions.iter().copied().take(first_action_index) {
        if state.legal_actions().len() > 1 {
            first_changed_policy_decision += 1;
        }
        state.apply(baseline_action)?;
    }
    if state.current != first_screen.actor || !state.legal_actions().contains(&corrected_action) {
        return Err(
            "Model 13.22 joined actor screen is inconsistent with its exact state".to_string(),
        );
    }
    first_changed_policy_decision += 1;
    state.apply(corrected_action)?;
    let mut suffix_policy_decisions = 0_usize;
    while !state.complete {
        let legal = state.legal_actions();
        if legal.is_empty() {
            return Err(
                "Model 13.22 factorized suffix reached a non-terminal state without actions"
                    .to_string(),
            );
        }
        let action = if legal.len() == 1 {
            legal[0]
        } else {
            suffix_policy_decisions += 1;
            choose_for_state(policy, &state, state.current)?
        };
        state.apply(action)?;
    }
    let outcome = model132_world_outcome(&state)?;
    Ok(Model1322DeltaOutcome {
        outcome,
        action_changed: true,
        outcome_changed: outcome != trace.outcome,
        opening_action_changed: first_action_index == 0,
        screened_policy_decisions,
        first_changed_policy_decision: Some(first_changed_policy_decision),
        suffix_policy_decisions,
    })
}

/// Roll out complete hidden worlds together. Worlds at the same legal
/// information set share one modeled action, while their hidden cards remain
/// available to the builder for exact state advancement and terminal scoring.
/// Returned outcomes preserve input order.
pub fn rollout_model132_worlds(
    worlds: &[Model132World],
    turn_rank: Option<u8>,
    dealer: PegSeat,
    policy: &impl Model132PeggingPolicy,
) -> Result<Vec<(u8, u8)>, String> {
    let mut states = worlds
        .iter()
        .map(|world| model132_world_state(world.hands, world.own_discards, turn_rank, dealer))
        .collect::<Result<Vec<_>, _>>()?;
    let mut incomplete = states.len();
    while incomplete > 0 {
        let mut decision_groups = BTreeMap::<Vec<u8>, Vec<usize>>::new();
        let mut progressed = false;
        for (index, state) in states.iter_mut().enumerate() {
            if state.complete {
                continue;
            }
            let legal = state.legal_actions();
            if legal.is_empty() {
                return Err(
                    "Model 13.2 batched rollout reached a non-terminal state without actions"
                        .to_string(),
                );
            }
            if legal.len() == 1 {
                state.apply(legal[0])?;
                progressed = true;
                if state.complete {
                    incomplete -= 1;
                }
                continue;
            }
            let actor = state.current;
            let key = state.information_set(actor)?.to_packed_bytes().to_vec();
            decision_groups.entry(key).or_default().push(index);
        }
        for indexes in decision_groups.values() {
            let first = indexes[0];
            let actor = states[first].current;
            let action = choose_for_state(policy, &states[first], actor)?;
            for index in indexes {
                states[*index].apply(action)?;
                progressed = true;
                if states[*index].complete {
                    incomplete -= 1;
                }
            }
        }
        if !progressed {
            return Err("Model 13.2 batched rollout made no progress".to_string());
        }
    }
    states.iter().map(model132_world_outcome).collect()
}

/// Offline Model 13.22 rollout for a complete weighted hidden-world
/// population. Decisions by `perspective` aggregate its compatible hidden
/// opponent hands directly; decisions by the simulated opponent continue to
/// use the executable legal-information policy because this population fixes
/// `perspective`'s hand and therefore cannot represent the opponent's full
/// belief. This is an efficiency seam, not perfect-information play.
pub fn rollout_model132_weighted_worlds(
    worlds: &[Model132World],
    weights: &[f64],
    turn_rank: Option<u8>,
    dealer: PegSeat,
    perspective: PegSeat,
    policy: &Model1322HeuristicPolicy,
) -> Result<Vec<(u8, u8)>, String> {
    if worlds.len() != weights.len()
        || weights
            .iter()
            .any(|weight| !weight.is_finite() || *weight <= 0.0)
    {
        return Err(
            "Model 13.22 weighted worlds require one positive finite weight per world".to_string(),
        );
    }
    let mut states = worlds
        .iter()
        .map(|world| model132_world_state(world.hands, world.own_discards, turn_rank, dealer))
        .collect::<Result<Vec<_>, _>>()?;
    let mut incomplete = states.len();
    while incomplete > 0 {
        let mut decision_groups = BTreeMap::<Vec<u8>, Vec<usize>>::new();
        let mut progressed = false;
        for (index, state) in states.iter_mut().enumerate() {
            if state.complete {
                continue;
            }
            let legal = state.legal_actions();
            if legal.is_empty() {
                return Err(
                    "Model 13.22 weighted rollout reached a non-terminal state without actions"
                        .to_string(),
                );
            }
            if legal.len() == 1 {
                state.apply(legal[0])?;
                progressed = true;
                if state.complete {
                    incomplete -= 1;
                }
                continue;
            }
            let actor = state.current;
            let key = state.information_set(actor)?.to_packed_bytes().to_vec();
            decision_groups.entry(key).or_default().push(index);
        }
        for indexes in decision_groups.values() {
            let first = indexes[0];
            let actor = states[first].current;
            let action = if actor == perspective {
                let observation = Model132Observation::from_state(&states[first], actor)?;
                let mut hidden_hands = BTreeMap::<[u8; RANKS], f64>::new();
                for index in indexes {
                    let hand = states[*index].hands[actor.other().index()];
                    *hidden_hands.entry(hand).or_default() += weights[*index];
                }
                let action = policy.choose_action_for_weighted_opponent_hands(
                    &observation,
                    hidden_hands.into_iter().collect(),
                )?;
                if !observation.legal_actions().contains(&action) {
                    return Err(format!(
                        "Model 13.22 weighted policy returned illegal action {action:?}"
                    ));
                }
                action
            } else {
                choose_for_state(policy, &states[first], actor)?
            };
            for index in indexes {
                states[*index].apply(action)?;
                progressed = true;
                if states[*index].complete {
                    incomplete -= 1;
                }
            }
        }
        if !progressed {
            return Err("Model 13.22 weighted rollout made no progress".to_string());
        }
    }
    states.iter().map(model132_world_outcome).collect()
}

fn model132_world_state(
    hands: [[u8; RANKS]; 2],
    own_discards: [[u8; RANKS]; 2],
    turn_rank: Option<u8>,
    dealer: PegSeat,
) -> Result<RankPegState, String> {
    if hands.iter().any(|hand| rank_count_total(hand) != 4) {
        return Err("Model 13.2 rollout requires two four-card keeps".to_string());
    }
    if own_discards
        .iter()
        .any(|discard| !matches!(rank_count_total(discard), 0 | 2))
    {
        return Err("Model 13.2 rollout discards must contain zero or two cards".to_string());
    }
    if turn_rank.is_some_and(|rank| rank as usize >= RANKS) {
        return Err("Model 13.2 rollout cut rank is invalid".to_string());
    }
    let mut known = [0_u8; RANKS];
    for rank in 0..RANKS {
        known[rank] = hands[0][rank]
            .saturating_add(hands[1][rank])
            .saturating_add(own_discards[0][rank])
            .saturating_add(own_discards[1][rank])
            .saturating_add(u8::from(turn_rank == Some(rank as u8)));
        if known[rank] > 4 {
            return Err(format!(
                "Model 13.2 rollout uses more than four rank {rank} cards"
            ));
        }
    }

    Ok(RankPegState {
        hands,
        own_discards,
        // RankPegState predates cut-optional forecast rollouts. The no-cut
        // policy adapter ignores this placeholder completely.
        turn_rank: turn_rank.unwrap_or(0),
        scores: [0, 0],
        dealer,
        current: dealer.other(),
        plays: Vec::new(),
        count: 0,
        go_player: None,
        last_player: None,
        history: Vec::new(),
        winner: None,
        complete: false,
    })
}

fn model132_world_outcome(state: &RankPegState) -> Result<(u8, u8), String> {
    Ok((
        u8::try_from(state.scores[0])
            .map_err(|_| "Model 13.2 seat-zero score does not fit u8".to_string())?,
        u8::try_from(state.scores[1])
            .map_err(|_| "Model 13.2 seat-one score does not fit u8".to_string())?,
    ))
}

pub fn choose_for_state(
    policy: &impl Model132PeggingPolicy,
    state: &RankPegState,
    actor: PegSeat,
) -> Result<RankPegAction, String> {
    let observation = Model132Observation::from_state(state, actor)?;
    let action = policy.choose_action(&observation)?;
    if !observation.legal_actions().contains(&action) {
        return Err(format!(
            "Model 13.2 policy returned illegal action {action:?}"
        ));
    }
    Ok(action)
}

fn add_played_rank(counts: &mut [u8; RANKS], rank: u8) -> Result<(), String> {
    let copies = counts
        .get_mut(rank as usize)
        .ok_or_else(|| format!("invalid Model 13.2 history rank {rank}"))?;
    *copies += 1;
    if *copies > 4 {
        return Err(format!(
            "Model 13.2 history has more than four rank {rank} cards"
        ));
    }
    Ok(())
}

fn relative_actor(seat: Option<PegSeat>, actor: PegSeat) -> Option<InfoActor> {
    seat.map(|seat| {
        if seat == actor {
            InfoActor::SelfPlayer
        } else {
            InfoActor::Opponent
        }
    })
}

fn model91_actor(actor: Option<InfoActor>) -> Option<Model91Actor> {
    actor.map(|actor| match actor {
        InfoActor::SelfPlayer => Model91Actor::SelfPlayer,
        InfoActor::Opponent => Model91Actor::Opponent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn hand(entries: &[(u8, u8)]) -> [u8; RANKS] {
        let mut result = [0_u8; RANKS];
        for (rank, copies) in entries {
            result[*rank as usize] = *copies;
        }
        result
    }

    fn state(opponent_hand: [u8; RANKS], opponent_discards: [u8; RANKS]) -> RankPegState {
        RankPegState {
            hands: [hand(&[(0, 1), (4, 1), (7, 1), (12, 1)]), opponent_hand],
            own_discards: [hand(&[(2, 1), (3, 1)]), opponent_discards],
            turn_rank: 8,
            scores: [71, 69],
            dealer: PegSeat::One,
            current: PegSeat::Zero,
            plays: Vec::new(),
            count: 0,
            go_player: None,
            last_player: None,
            history: Vec::new(),
            winner: None,
            complete: false,
        }
    }

    struct HighestLegalRank;

    impl Model132PeggingPolicy for HighestLegalRank {
        fn choose_action(
            &self,
            observation: &Model132Observation,
        ) -> Result<RankPegAction, String> {
            observation
                .legal_actions()
                .last()
                .copied()
                .ok_or_else(|| "no legal Model 13.2 action".to_string())
        }
    }

    struct CountingPolicy(Cell<u64>);

    impl Model132PeggingPolicy for CountingPolicy {
        fn choose_action(
            &self,
            observation: &Model132Observation,
        ) -> Result<RankPegAction, String> {
            self.0.set(self.0.get() + 1);
            observation
                .legal_actions()
                .first()
                .copied()
                .ok_or_else(|| "no legal Model 13.2 action".to_string())
        }
    }

    fn decline_factors() -> Model1322DeclineFactors {
        Model1322DeclineFactors {
            three_card_run_ppm: [400_000; 3],
            four_plus_card_run_ppm: [500_000; 3],
            pair_ppm: [600_000; 3],
            pair_royal_after_pair_ppm: [700_000; 3],
            four_of_a_kind_after_pair_royal_ppm: [800_000; 3],
            safe_pair_ppm: [110_000; 3],
            safe_pair_royal_ppm: [220_000; 3],
        }
    }

    #[test]
    fn fast_policy_action_is_invariant_to_hidden_opponent_hand() {
        let first = state(
            hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
            hand(&[(6, 1), (10, 1)]),
        );
        let second = state(
            hand(&[(2, 1), (6, 1), (8, 1), (10, 1)]),
            hand(&[(1, 1), (11, 1)]),
        );
        let policy = Model1322FastPolicy::new(decline_factors()).unwrap();

        let first_action = choose_for_state(&policy, &first, PegSeat::Zero).unwrap();
        let second_action = choose_for_state(&policy, &second, PegSeat::Zero).unwrap();

        assert_eq!(first_action, second_action);
        assert_eq!(policy.stats().decision_requests, 2);
    }

    #[test]
    fn complete_hand_policy_action_is_invariant_to_builder_hidden_hand() {
        let first = state(
            hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
            hand(&[(6, 1), (10, 1)]),
        );
        let second = state(
            hand(&[(2, 1), (6, 1), (8, 1), (10, 1)]),
            hand(&[(1, 1), (11, 1)]),
        );
        let policy = Model1322HeuristicPolicy::new(None, decline_factors(), 1_000, 0).unwrap();

        let first_action = choose_for_state(&policy, &first, PegSeat::Zero).unwrap();
        let second_action = choose_for_state(&policy, &second, PegSeat::Zero).unwrap();

        assert_eq!(first_action, second_action);
        assert_eq!(policy.stats().decision_requests, 2);
        assert_eq!(policy.stats().decision_cache_hits, 1);
    }

    #[test]
    fn fast_policy_does_not_model_a_reply_after_opponent_go() {
        let observation = Model132Observation {
            role: Role::Pone,
            my_score: 0,
            opponent_score: 0,
            own_remaining: hand(&[(0, 1), (1, 1), (10, 1), (11, 1)]),
            own_played: [0; RANKS],
            opponent_played: [0; RANKS],
            own_discards: hand(&[(2, 1), (3, 1)]),
            turn_rank: 8,
            current_series: vec![8, 9, 10],
            count: 29,
            go_player: Some(InfoActor::Opponent),
            last_player: Some(InfoActor::SelfPlayer),
            public_history: Vec::new(),
        };
        let policy = Model1322FastPolicy::new(decline_factors()).unwrap();

        let action = policy.choose_action(&observation).unwrap();

        assert_eq!(action, RankPegAction::Play(1));
        assert_eq!(policy.stats().reply_rank_evaluations, 0);
    }

    #[test]
    fn fast_policy_scores_only_visible_candidates_and_reply_ranks() {
        let world = state(
            hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
            hand(&[(6, 1), (10, 1)]),
        );
        let policy = Model1322FastPolicy::new(decline_factors()).unwrap();

        choose_for_state(&policy, &world, PegSeat::Zero).unwrap();

        let stats = policy.stats();
        assert_eq!(stats.decision_requests, 1);
        assert_eq!(stats.candidate_evaluations, 4);
        assert!(stats.reply_rank_evaluations <= 4 * RANKS as u64);
    }

    #[test]
    fn fast_policy_uses_complete_pegging_scoring() {
        assert_eq!(score_count_for_rank_series(&[4, 9]), 2);
        assert_eq!(score_count_for_rank_series(&[4, 4]), 2);
        assert_eq!(score_count_for_rank_series(&[4, 4, 4]), 8);
        assert_eq!(score_count_for_rank_series(&[4, 4, 4, 4]), 12);
        assert_eq!(score_count_for_rank_series(&[0, 2, 1]), 3);
    }

    #[test]
    fn hidden_opponent_world_cannot_change_our_observation_or_action() {
        let first = state(
            hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
            hand(&[(6, 1), (10, 1)]),
        );
        let second = state(
            hand(&[(2, 1), (6, 1), (8, 1), (10, 1)]),
            hand(&[(1, 1), (11, 1)]),
        );

        assert_eq!(
            Model132Observation::from_state(&first, PegSeat::Zero).unwrap(),
            Model132Observation::from_state(&second, PegSeat::Zero).unwrap()
        );
        assert_eq!(
            choose_for_state(&HighestLegalRank, &first, PegSeat::Zero).unwrap(),
            choose_for_state(&HighestLegalRank, &second, PegSeat::Zero).unwrap()
        );
    }

    #[test]
    fn actor_receives_own_private_discard_and_public_cut() {
        let first = state(
            hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
            hand(&[(6, 1), (10, 1)]),
        );
        let mut changed_discard = first.clone();
        changed_discard.own_discards[PegSeat::Zero.index()] = hand(&[(5, 1), (6, 1)]);
        let mut changed_cut = first.clone();
        changed_cut.turn_rank = 9;

        assert_ne!(
            Model132Observation::from_state(&first, PegSeat::Zero).unwrap(),
            Model132Observation::from_state(&changed_discard, PegSeat::Zero).unwrap()
        );
        assert_ne!(
            Model132Observation::from_state(&first, PegSeat::Zero).unwrap(),
            Model132Observation::from_state(&changed_cut, PegSeat::Zero).unwrap()
        );
    }

    #[test]
    fn discard_forecast_policy_omits_cut_but_live_policy_uses_it() {
        let first = state(
            hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
            hand(&[(6, 1), (10, 1)]),
        );
        let mut changed_cut = first.clone();
        changed_cut.turn_rank = 9;
        let first_observation = Model132Observation::from_state(&first, PegSeat::Zero).unwrap();
        let changed_observation =
            Model132Observation::from_state(&changed_cut, PegSeat::Zero).unwrap();

        let offline = Model132HeuristicPolicy::without_cut(None);
        assert_eq!(
            offline.model91_observation(&first_observation).unwrap(),
            offline.model91_observation(&changed_observation).unwrap()
        );

        let live = Model132HeuristicPolicy::new(None);
        assert_ne!(
            live.model91_observation(&first_observation).unwrap(),
            live.model91_observation(&changed_observation).unwrap()
        );
    }

    #[test]
    fn no_cut_rollout_does_not_remove_a_placeholder_card() {
        let result = rollout_model132_world(
            [hand(&[(0, 4)]), hand(&[(4, 1), (5, 1), (6, 1), (7, 1)])],
            [hand(&[(1, 1), (2, 1)]), hand(&[(8, 1), (9, 1)])],
            None,
            PegSeat::One,
            &HighestLegalRank,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn rollout_bypasses_policy_for_forced_actions() {
        let policy = CountingPolicy(Cell::new(0));
        rollout_model132_world(
            [hand(&[(0, 4)]), hand(&[(4, 4)])],
            [[0_u8; RANKS]; 2],
            None,
            PegSeat::Zero,
            &policy,
        )
        .unwrap();
        assert_eq!(policy.0.get(), 0);
    }

    #[test]
    fn batched_worlds_match_sequential_rollouts_and_share_legal_decisions() {
        let worlds = vec![
            Model132World {
                hands: [
                    hand(&[(0, 1), (4, 1), (7, 1), (12, 1)]),
                    hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
                ],
                own_discards: [[0_u8; RANKS]; 2],
            },
            Model132World {
                hands: [
                    hand(&[(0, 1), (4, 1), (7, 1), (12, 1)]),
                    hand(&[(2, 1), (6, 1), (8, 1), (10, 1)]),
                ],
                own_discards: [[0_u8; RANKS]; 2],
            },
        ];
        let sequential_policy = CountingPolicy(Cell::new(0));
        let sequential = worlds
            .iter()
            .map(|world| {
                rollout_model132_world(
                    world.hands,
                    world.own_discards,
                    None,
                    PegSeat::One,
                    &sequential_policy,
                )
            })
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let batched_policy = CountingPolicy(Cell::new(0));

        let batched =
            rollout_model132_worlds(&worlds, None, PegSeat::One, &batched_policy).unwrap();

        assert_eq!(batched, sequential);
        assert!(batched_policy.0.get() < sequential_policy.0.get());
    }

    #[test]
    fn opponent_go_hard_excludes_every_rank_that_was_legal() {
        let mut observation = Model132Observation::from_state(
            &state(
                hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
                hand(&[(6, 1), (10, 1)]),
            ),
            PegSeat::Zero,
        )
        .unwrap();
        observation.public_history = vec![PublicPegEvent::SelfPlay(8), PublicPegEvent::OpponentGo];
        let likelihoods = model1322_opponent_rank_likelihoods(
            &observation,
            Model1322DeclineFactors {
                three_card_run_ppm: [400_000; 3],
                four_plus_card_run_ppm: [500_000; 3],
                pair_ppm: [600_000; 3],
                pair_royal_after_pair_ppm: [700_000; 3],
                four_of_a_kind_after_pair_royal_ppm: [800_000; 3],
                safe_pair_ppm: [110_000; 3],
                safe_pair_royal_ppm: [220_000; 3],
            },
        )
        .unwrap();
        assert_eq!(likelihoods[0], 0);
        assert_eq!(likelihoods[10], 0);
        assert_eq!(likelihoods[12], 0);
    }

    #[test]
    fn later_decline_evidence_cannot_resurrect_a_rank_excluded_by_go() {
        let mut observation = Model132Observation::from_state(
            &state(
                hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
                hand(&[(6, 1), (10, 1)]),
            ),
            PegSeat::Zero,
        )
        .unwrap();
        observation.public_history = vec![
            PublicPegEvent::SelfPlay(0),
            PublicPegEvent::OpponentGo,
            PublicPegEvent::Reset,
            PublicPegEvent::SelfPlay(4),
            PublicPegEvent::OpponentPlay(0),
        ];

        let likelihoods =
            model1322_opponent_rank_likelihoods(&observation, decline_factors()).unwrap();

        assert_eq!(likelihoods[4], 0);
    }

    #[test]
    fn declined_pair_uses_soft_empirical_likelihood() {
        let mut observation = Model132Observation::from_state(
            &state(
                hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
                hand(&[(6, 1), (10, 1)]),
            ),
            PegSeat::Zero,
        )
        .unwrap();
        observation.public_history =
            vec![PublicPegEvent::SelfPlay(4), PublicPegEvent::OpponentPlay(0)];
        let likelihoods = model1322_opponent_rank_likelihoods(
            &observation,
            Model1322DeclineFactors {
                three_card_run_ppm: [400_000; 3],
                four_plus_card_run_ppm: [500_000; 3],
                pair_ppm: [600_000; 3],
                pair_royal_after_pair_ppm: [700_000; 3],
                four_of_a_kind_after_pair_royal_ppm: [800_000; 3],
                safe_pair_ppm: [110_000; 3],
                safe_pair_royal_ppm: [220_000; 3],
            },
        )
        .unwrap();
        assert_eq!(likelihoods[4], 600_000);
        assert_eq!(likelihoods[0], 1_000_000);
    }

    #[test]
    fn decline_factor_uses_opponents_card_ordinal_across_rounds() {
        let mut observation = Model132Observation::from_state(
            &state(
                hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
                hand(&[(6, 1), (10, 1)]),
            ),
            PegSeat::Zero,
        )
        .unwrap();
        observation.public_history = vec![
            PublicPegEvent::OpponentPlay(2),
            PublicPegEvent::Reset,
            PublicPegEvent::SelfPlay(4),
            PublicPegEvent::OpponentPlay(0),
        ];
        let mut factors = decline_factors();
        factors.pair_ppm = [610_000, 620_000, 630_000];

        let likelihoods = model1322_opponent_rank_likelihoods(&observation, factors).unwrap();

        assert_eq!(likelihoods[4], 620_000);
    }

    #[test]
    fn opponent_decline_after_self_go_uses_safe_factor() {
        let mut observation = Model132Observation::from_state(
            &state(
                hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
                hand(&[(6, 1), (10, 1)]),
            ),
            PegSeat::Zero,
        )
        .unwrap();
        observation.public_history = vec![
            PublicPegEvent::SelfPlay(4),
            PublicPegEvent::SelfGo,
            PublicPegEvent::OpponentPlay(0),
        ];

        let likelihoods =
            model1322_opponent_rank_likelihoods(&observation, decline_factors()).unwrap();

        assert_eq!(likelihoods[4], 110_000);
    }

    #[test]
    fn competing_scoring_play_does_not_supply_decline_evidence() {
        let mut observation = Model132Observation::from_state(
            &state(
                hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
                hand(&[(6, 1), (10, 1)]),
            ),
            PegSeat::Zero,
        )
        .unwrap();
        observation.public_history =
            vec![PublicPegEvent::SelfPlay(4), PublicPegEvent::OpponentPlay(9)];

        let likelihoods =
            model1322_opponent_rank_likelihoods(&observation, decline_factors()).unwrap();

        assert_eq!(likelihoods[4], 1_000_000);
    }

    #[test]
    fn pair_royal_and_four_kind_declines_use_their_behavior_factors() {
        let mut observation = Model132Observation::from_state(
            &state(
                hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
                hand(&[(6, 1), (10, 1)]),
            ),
            PegSeat::Zero,
        )
        .unwrap();
        observation.public_history = vec![
            PublicPegEvent::SelfPlay(4),
            PublicPegEvent::SelfPlay(4),
            PublicPegEvent::OpponentPlay(0),
        ];
        let pair_royal =
            model1322_opponent_rank_likelihoods(&observation, decline_factors()).unwrap();
        assert_eq!(pair_royal[4], 700_000);

        observation.public_history = vec![
            PublicPegEvent::SelfPlay(4),
            PublicPegEvent::SelfPlay(4),
            PublicPegEvent::SelfPlay(4),
            PublicPegEvent::OpponentPlay(0),
        ];
        let four_kind =
            model1322_opponent_rank_likelihoods(&observation, decline_factors()).unwrap();
        assert_eq!(four_kind[4], 800_000);
    }

    #[test]
    fn count_safe_pair_and_pair_royal_use_stronger_specific_factors() {
        let mut observation = Model132Observation::from_state(
            &state(
                hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
                hand(&[(6, 1), (10, 1)]),
            ),
            PegSeat::Zero,
        )
        .unwrap();
        observation.public_history = vec![
            PublicPegEvent::SelfPlay(1),
            PublicPegEvent::SelfPlay(9),
            PublicPegEvent::OpponentPlay(0),
        ];
        let safe_pair =
            model1322_opponent_rank_likelihoods(&observation, decline_factors()).unwrap();
        assert_eq!(safe_pair[9], 110_000);

        observation.public_history = vec![
            PublicPegEvent::SelfPlay(9),
            PublicPegEvent::SelfPlay(9),
            PublicPegEvent::OpponentPlay(0),
        ];
        let safe_pair_royal =
            model1322_opponent_rank_likelihoods(&observation, decline_factors()).unwrap();
        assert_eq!(safe_pair_royal[9], 220_000);
    }

    #[test]
    fn keep_only_forecast_may_omit_unknown_opponent_discards() {
        let result = rollout_model132_world(
            [
                hand(&[(0, 1), (1, 1), (2, 1), (3, 1)]),
                hand(&[(4, 1), (5, 1), (6, 1), (7, 1)]),
            ],
            [hand(&[(8, 1), (9, 1)]), [0_u8; RANKS]],
            None,
            PegSeat::One,
            &HighestLegalRank,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn discard_forecast_reweights_pair_outcomes_after_both_dead_discards() {
        let own = hand(&[(0, 1), (1, 1), (2, 1), (3, 1)]);
        let eliminated = hand(&[(4, 4)]);
        let remaining = hand(&[(5, 4)]);
        let keeps = vec![own, eliminated, remaining];
        let mut outcomes = vec![MODEL132_INVALID_PAIR; keeps.len() * keeps.len()];
        outcomes[1] = u16::from(2_u8) | (u16::from(1_u8) << 5);
        outcomes[2] = u16::from(4_u8);
        let table = Model132KeepPairTable {
            keep_id_by_key: keeps
                .iter()
                .enumerate()
                .map(|(index, keep)| (rank_count_key(keep), index))
                .collect(),
            keep_ranks: keeps,
            dealer_prior: vec![0, 0, 0],
            pone_prior: vec![0, 100, 100],
            outcomes,
            exhaustive: true,
        };
        let discards = hand(&[(4, 1), (6, 1)]);

        let summary = table
            .aggregate_discard_forecast(&own, &discards, Role::Dealer)
            .unwrap();

        assert_eq!(summary.total_weight, 100);
        assert_eq!(summary.my_ev, 4.0);
        assert_eq!(summary.opponent_ev, 0.0);
        assert_eq!(summary.histogram.len(), 1);
    }

    #[test]
    fn four_of_a_rank_weight_becomes_zero_when_one_copy_is_dead() {
        let four_fives = hand(&[(4, 4)]);
        let mut available = [4_u8; RANKS];
        available[4] = 3;
        assert_eq!(
            adjusted_keep_weight(1_000, &four_fives, &available).unwrap(),
            0
        );
    }

    #[test]
    fn ordered_public_history_is_preserved_relative_to_actor() {
        let mut state = state(
            hand(&[(1, 1), (5, 1), (9, 1), (11, 1)]),
            hand(&[(6, 1), (10, 1)]),
        );
        state.hands[PegSeat::Zero.index()] = hand(&[(4, 1), (7, 1), (12, 1)]);
        state.hands[PegSeat::One.index()] = hand(&[(5, 1), (9, 1), (11, 1)]);
        state.plays = vec![0, 1];
        state.count = 3;
        state.history = vec![
            RankPegEvent::Play {
                seat: PegSeat::Zero,
                rank: 0,
            },
            RankPegEvent::Play {
                seat: PegSeat::One,
                rank: 1,
            },
        ];

        let observation = Model132Observation::from_state(&state, PegSeat::Zero).unwrap();
        assert_eq!(
            observation.public_history,
            vec![PublicPegEvent::SelfPlay(0), PublicPegEvent::OpponentPlay(1)]
        );
    }

    #[test]
    fn model911_baseline_and_dead_card_delta_match_full_rollouts() {
        let dealer = hand(&[(4, 2), (5, 1), (9, 1)]);
        let pone = hand(&[(0, 1), (1, 1), (2, 1), (3, 1)]);
        let policy = Model911Policy::new_with_evidence_cache(
            None,
            decline_factors(),
            10_000,
            500_000,
            1_000_000,
        )
        .unwrap();
        let trace = trace_model911_pair(dealer, pone, &policy).unwrap();
        let baseline = policy.context_free_baseline();
        assert_eq!(
            trace.outcome(),
            rollout_model132_world(
                [dealer, pone],
                [[0_u8; RANKS]; 2],
                None,
                PegSeat::Zero,
                &baseline,
            )
            .unwrap()
        );

        for (dealer_discards, pone_discards, cut) in [
            (hand(&[(6, 1), (7, 1)]), hand(&[(8, 1), (10, 1)]), 12),
            (hand(&[(0, 1), (11, 1)]), hand(&[(6, 2)]), 8),
            (hand(&[(12, 2)]), hand(&[(7, 1), (8, 1)]), 10),
        ] {
            let discards = [dealer_discards, pone_discards];
            let delta = rollout_model1322_delta(&trace, discards, cut, &policy).unwrap();
            let screens = [
                screen_model1322_actor_context(
                    &trace,
                    PegSeat::Zero,
                    dealer_discards,
                    cut,
                    &policy,
                )
                .unwrap(),
                screen_model1322_actor_context(&trace, PegSeat::One, pone_discards, cut, &policy)
                    .unwrap(),
            ];
            let factorized =
                rollout_model1322_from_actor_screens(&trace, discards, cut, screens, &policy)
                    .unwrap();
            let full =
                rollout_model132_world([dealer, pone], discards, Some(cut), PegSeat::Zero, &policy)
                    .unwrap();
            assert_eq!(delta.outcome, full);
            assert_eq!(factorized.outcome, full);
            assert_eq!(factorized.action_changed, delta.action_changed);
            assert_eq!(factorized.outcome_changed, delta.outcome_changed);
            assert_eq!(
                factorized.opening_action_changed,
                delta.opening_action_changed
            );
            assert_eq!(delta.outcome_changed, delta.outcome != trace.outcome());
        }
        assert!(policy.stats().evidence_cache_hits > 0);
    }

    #[test]
    fn model911_builder_entry_points_use_the_shared_context_free_policy() {
        let dealer = hand(&[(4, 2), (5, 1), (9, 1)]);
        let pone = hand(&[(0, 1), (1, 1), (2, 1), (3, 1)]);
        let policy = Model911Policy::new(None, decline_factors(), 10_000, 1_000_000).unwrap();

        assert_eq!(
            rollout_model911_pair(dealer, pone, &policy).unwrap(),
            trace_model911_pair(dealer, pone, &policy)
                .unwrap()
                .outcome()
        );
        let mut model91 = Model91Policy::new(None, 10_000);
        assert_eq!(
            model911_initial_pone_lead(pone, &policy).unwrap(),
            crate::model91::model91_initial_pone_lead(pone, &mut model91).unwrap()
        );
    }

    #[test]
    fn model911_reuses_same_actor_descendants_after_an_opponent_play() {
        let mut first = Model132Observation {
            role: Role::Dealer,
            my_score: 20,
            opponent_score: 18,
            own_remaining: hand(&[(4, 1), (5, 1), (9, 1), (10, 1)]),
            own_played: [0; RANKS],
            opponent_played: hand(&[(0, 1)]),
            own_discards: hand(&[(2, 1), (3, 1)]),
            turn_rank: 12,
            current_series: vec![0],
            count: 1,
            go_player: None,
            last_player: Some(InfoActor::Opponent),
            public_history: vec![PublicPegEvent::OpponentPlay(0)],
        };
        let policy = Model911Policy::new(None, decline_factors(), 10_000, 1_000_000).unwrap();
        let RankPegAction::Play(first_rank) = policy.choose_action(&first).unwrap() else {
            panic!("Model 9.11 returned go with four legal cards");
        };
        let after_first = policy.stats();

        first.own_remaining[first_rank as usize] -= 1;
        first.own_played[first_rank as usize] += 1;
        first.opponent_played[1] += 1;
        first.current_series.extend([first_rank, 1]);
        first.count += VALUES[first_rank as usize] + VALUES[1];
        first.last_player = Some(InfoActor::Opponent);
        first.public_history.extend([
            PublicPegEvent::SelfPlay(first_rank),
            PublicPegEvent::OpponentPlay(1),
        ]);

        policy.choose_action(&first).unwrap();
        let after_second = policy.stats();
        assert!(after_first.future_cache_entries > 0);
        assert_eq!(after_second.future_cache_capacity_clears, 0);
        assert!(after_second.future_cache_hits > after_first.future_cache_hits);
    }
}
