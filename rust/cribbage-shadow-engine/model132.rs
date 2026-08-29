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
    Model91Actor, Model91EmpiricalBeliefs, Model91Observation, Model91Policy, Model91PolicyStats,
};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

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

/// The first executable Model 13.2 policy. It reuses Model 9.1's legal
/// information-set evaluator, but supplies the cut and the actor's own crib
/// discards and disables its cross-decision cache. Each simulated actor calls
/// this same policy through `Model132Observation`; hidden world state never
/// crosses the boundary.
pub struct Model132HeuristicPolicy {
    inner: RefCell<Model91Policy>,
    include_cut_in_beliefs: bool,
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

    let mut state = RankPegState {
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
    };
    while !state.complete {
        let actor = state.current;
        let action = choose_for_state(policy, &state, actor)?;
        state.apply(action)?;
    }
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
}
