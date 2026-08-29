//! Legal, rank-only Model 9.1 pegging policy and fixed-keep rollout.
//!
//! The simulator owns both hidden keeps.  The policy interface accepts only a
//! `Model91Observation`, which contains the acting player's retained cards,
//! own two discards, the cut card, and public pegging history. The opponent's
//! discards and retained cards remain hidden.
//!
//! The frozen discard assets predate those two legal fields. Their explicitly
//! marked legacy keep-pair rollout path still omits both so the assets remain
//! reproducible; live Model 9.x play does not use that path.

use crate::board::Role;
use crate::cards::{
    enumerate_rank_hands, peg_card_for_rank, rank_count_total, score_count, VALUES,
};
use crate::information_set::{PegSeat, RankPegAction, RankPegEvent, RankPegState};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const RANKS: usize = 13;
const MAX_SERIES: usize = 8;
const BELIEF_MAGIC: &[u8; 8] = b"M91BL001";
const BELIEF_HEADER_BYTES: usize = 28;
const BELIEF_ENTRY_BYTES: usize = 22;
const BELIEF_RECORD_BYTES: usize = 21;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Model91Actor {
    SelfPlayer,
    Opponent,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct Model91Observation {
    pub role: Role,
    pub own_remaining: [u8; RANKS],
    pub own_played: [u8; RANKS],
    pub opponent_played: [u8; RANKS],
    pub own_discards: [u8; RANKS],
    pub turn_rank: Option<u8>,
    pub current_series: [u8; MAX_SERIES],
    pub current_series_len: u8,
    pub count: u8,
    pub go_player: Option<Model91Actor>,
    pub last_player: Option<Model91Actor>,
}

impl Model91Observation {
    #[allow(clippy::too_many_arguments)]
    pub fn from_public_state(
        role: Role,
        own_remaining: [u8; RANKS],
        own_played: [u8; RANKS],
        opponent_played: [u8; RANKS],
        own_discards: [u8; RANKS],
        turn_rank: Option<u8>,
        current_series: &[u8],
        count: u8,
        go_player: Option<Model91Actor>,
        last_player: Option<Model91Actor>,
    ) -> Result<Self, String> {
        if current_series.len() > MAX_SERIES {
            return Err(format!(
                "Model 9.1 current series has {} cards; maximum is {}",
                current_series.len(),
                MAX_SERIES
            ));
        }
        let mut packed_series = [0_u8; MAX_SERIES];
        packed_series[..current_series.len()].copy_from_slice(current_series);
        let observation = Model91Observation {
            role,
            own_remaining,
            own_played,
            opponent_played,
            own_discards,
            turn_rank,
            current_series: packed_series,
            current_series_len: current_series.len() as u8,
            count,
            go_player,
            last_player,
        };
        observation.validate()?;
        Ok(observation)
    }

    pub fn from_state(state: &RankPegState, actor: PegSeat) -> Result<Self, String> {
        Self::from_state_with_known_cards(state, actor, true)
    }

    fn from_state_without_crib_or_cut(
        state: &RankPegState,
        actor: PegSeat,
    ) -> Result<Self, String> {
        Self::from_state_with_known_cards(state, actor, false)
    }

    fn from_state_with_known_cards(
        state: &RankPegState,
        actor: PegSeat,
        include_known_cards: bool,
    ) -> Result<Self, String> {
        if state.current != actor {
            return Err("Model 9.1 observation actor is not the current player".to_string());
        }
        if state.plays.len() > MAX_SERIES {
            return Err(format!(
                "Model 9.1 current series has {} cards; maximum is {}",
                state.plays.len(),
                MAX_SERIES
            ));
        }
        let mut own_played = [0_u8; RANKS];
        let mut opponent_played = [0_u8; RANKS];
        for event in &state.history {
            if let RankPegEvent::Play { seat, rank } = *event {
                let target = if seat == actor {
                    &mut own_played
                } else {
                    &mut opponent_played
                };
                target[rank as usize] = target[rank as usize].saturating_add(1);
            }
        }
        Model91Observation::from_public_state(
            if actor == state.dealer {
                Role::Dealer
            } else {
                Role::Pone
            },
            state.hands[actor.index()],
            own_played,
            opponent_played,
            if include_known_cards {
                state.own_discards[actor.index()]
            } else {
                [0_u8; RANKS]
            },
            include_known_cards.then_some(state.turn_rank),
            &state.plays,
            state.count,
            relative_actor(state.go_player, actor),
            relative_actor(state.last_player, actor),
        )
    }

    pub fn own_initial_keep(&self) -> [u8; RANKS] {
        std::array::from_fn(|rank| self.own_remaining[rank] + self.own_played[rank])
    }

    pub fn opponent_remaining_count(&self) -> Result<u8, String> {
        let played = rank_count_total(&self.opponent_played);
        4_u8.checked_sub(played)
            .ok_or_else(|| "Model 9.1 observation has more than four opponent plays".to_string())
    }

    pub fn series(&self) -> &[u8] {
        &self.current_series[..self.current_series_len as usize]
    }

    fn validate(&self) -> Result<(), String> {
        if self.current_series_len as usize > MAX_SERIES {
            return Err("Model 9.1 current series length exceeds capacity".to_string());
        }
        if self.count > 31 {
            return Err("Model 9.1 count exceeds 31".to_string());
        }
        for (label, ranks) in [
            ("own remaining", &self.own_remaining),
            ("own played", &self.own_played),
            ("opponent played", &self.opponent_played),
            ("own discards", &self.own_discards),
        ] {
            if ranks.iter().any(|count| *count > 4) {
                return Err(format!(
                    "Model 9.1 {} contains more than four copies",
                    label
                ));
            }
        }
        if rank_count_total(&self.own_initial_keep()) != 4 {
            return Err("Model 9.1 actor keep does not total four cards".to_string());
        }
        if !matches!(rank_count_total(&self.own_discards), 0 | 2) {
            return Err("Model 9.1 own discards must contain zero or two cards".to_string());
        }
        if self.turn_rank.is_some_and(|rank| rank as usize >= RANKS) {
            return Err("Model 9.1 cut rank is invalid".to_string());
        }
        self.opponent_remaining_count()?;
        let series_count = self
            .series()
            .iter()
            .map(|rank| VALUES[*rank as usize])
            .sum::<u8>();
        if series_count != self.count {
            return Err(format!(
                "Model 9.1 series count {} does not match state count {}",
                series_count, self.count
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct BeliefKey {
    opponent_role: Role,
    played: [u8; RANKS],
}

#[derive(Clone, Debug, Default)]
pub struct Model91EmpiricalBeliefs {
    entries: HashMap<BeliefKey, Vec<([u8; RANKS], u64)>>,
}

impl Model91EmpiricalBeliefs {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let bytes = fs::read(path).map_err(|error| {
            format!(
                "read Model 9.1 belief asset {} failed: {}",
                path.display(),
                error
            )
        })?;
        if bytes.len() < BELIEF_HEADER_BYTES || &bytes[..8] != BELIEF_MAGIC {
            return Err("invalid Model 9.1 belief asset header".to_string());
        }
        let version = read_u32(&bytes, 8)?;
        let entry_count = read_u32(&bytes, 12)? as usize;
        let record_count = read_u32(&bytes, 16)? as usize;
        let entry_bytes = read_u32(&bytes, 20)? as usize;
        let record_bytes = read_u32(&bytes, 24)? as usize;
        if version != 1 || entry_bytes != BELIEF_ENTRY_BYTES || record_bytes != BELIEF_RECORD_BYTES
        {
            return Err("unsupported Model 9.1 belief asset format".to_string());
        }
        let records_start = BELIEF_HEADER_BYTES
            .checked_add(
                entry_count
                    .checked_mul(entry_bytes)
                    .ok_or_else(|| "Model 9.1 belief directory overflow".to_string())?,
            )
            .ok_or_else(|| "Model 9.1 belief directory overflow".to_string())?;
        let expected = records_start
            .checked_add(
                record_count
                    .checked_mul(record_bytes)
                    .ok_or_else(|| "Model 9.1 belief records overflow".to_string())?,
            )
            .ok_or_else(|| "Model 9.1 belief records overflow".to_string())?;
        if bytes.len() != expected {
            return Err("Model 9.1 belief asset length is inconsistent".to_string());
        }
        let mut result = Model91EmpiricalBeliefs::default();
        let mut expected_first_record = 0_usize;
        for entry in 0..entry_count {
            let offset = BELIEF_HEADER_BYTES + entry * entry_bytes;
            let role = match bytes[offset] {
                0 => Role::Dealer,
                1 => Role::Pone,
                other => return Err(format!("invalid Model 9.1 belief role {}", other)),
            };
            let mut played = [0_u8; RANKS];
            played.copy_from_slice(&bytes[offset + 1..offset + 14]);
            let first_record = read_u32(&bytes, offset + 14)? as usize;
            let count = read_u32(&bytes, offset + 18)? as usize;
            if first_record != expected_first_record || first_record + count > record_count {
                return Err("Model 9.1 belief directory is not contiguous".to_string());
            }
            let mut rows = Vec::with_capacity(count);
            for record in first_record..first_record + count {
                let record_offset = records_start + record * record_bytes;
                let mut remaining = [0_u8; RANKS];
                remaining.copy_from_slice(&bytes[record_offset..record_offset + RANKS]);
                let weight = read_u64(&bytes, record_offset + RANKS)?;
                rows.push((remaining, weight));
            }
            result.insert(role, played, rows)?;
            expected_first_record += count;
        }
        if expected_first_record != record_count {
            return Err("Model 9.1 belief directory does not cover all records".to_string());
        }
        Ok(result)
    }

    pub fn insert(
        &mut self,
        opponent_role: Role,
        played: [u8; RANKS],
        remaining_hands: Vec<([u8; RANKS], u64)>,
    ) -> Result<(), String> {
        let played_count = rank_count_total(&played);
        if !(1..=3).contains(&played_count) {
            return Err("Model 9.1 empirical prefix length must be one through three".to_string());
        }
        let maximum_remaining = 4 - played_count;
        if remaining_hands
            .iter()
            .any(|(hand, weight)| rank_count_total(hand) > maximum_remaining || *weight == 0)
        {
            return Err(
                "Model 9.1 empirical remaining hand has invalid maximum size or weight".to_string(),
            );
        }
        let key = BeliefKey {
            opponent_role,
            played,
        };
        if self.entries.insert(key, remaining_hands).is_some() {
            return Err("duplicate Model 9.1 empirical belief prefix".to_string());
        }
        Ok(())
    }

    fn hands(
        &self,
        opponent_role: Role,
        played: [u8; RANKS],
        available: &[u8; RANKS],
        size: u8,
    ) -> Option<Vec<([u8; RANKS], f64)>> {
        let rows = self.entries.get(&BeliefKey {
            opponent_role,
            played,
        })?;
        Some(
            rows.iter()
                .filter(|(hand, _)| {
                    rank_count_total(hand) == size
                        && hand
                            .iter()
                            .zip(available)
                            .all(|(needed, remaining)| needed <= remaining)
                })
                .map(|(hand, weight)| (*hand, *weight as f64))
                .collect(),
        )
    }
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| format!("Model 9.1 u32 read at {} is out of range", offset))?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, String> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| format!("Model 9.1 u64 read at {} is out of range", offset))?;
    Ok(u64::from_le_bytes([
        value[0], value[1], value[2], value[3], value[4], value[5], value[6], value[7],
    ]))
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Model91PolicyStats {
    pub decision_requests: u64,
    pub decision_cache_hits: u64,
    pub evaluated_decisions: u64,
    pub random_future_states: u64,
}

pub struct Model91Policy {
    empirical: Option<Model91EmpiricalBeliefs>,
    decision_cache: HashMap<Model91Observation, RankPegAction>,
    cache_limit: usize,
    stats: Model91PolicyStats,
}

impl Model91Policy {
    pub fn new(empirical: Option<Model91EmpiricalBeliefs>, cache_limit: usize) -> Self {
        Model91Policy {
            empirical,
            decision_cache: HashMap::new(),
            cache_limit,
            stats: Model91PolicyStats::default(),
        }
    }

    pub fn choose_action(
        &mut self,
        observation: &Model91Observation,
    ) -> Result<RankPegAction, String> {
        observation.validate()?;
        self.stats.decision_requests = self.stats.decision_requests.saturating_add(1);
        if let Some(action) = self.decision_cache.get(observation).copied() {
            self.stats.decision_cache_hits = self.stats.decision_cache_hits.saturating_add(1);
            return Ok(action);
        }
        let legal = legal_ranks(&observation.own_remaining, observation.count);
        let action = match legal.as_slice() {
            [] => RankPegAction::Go,
            [rank] => RankPegAction::Play(*rank),
            _ => RankPegAction::Play(self.best_rank(observation, &legal)?),
        };
        self.stats.evaluated_decisions = self.stats.evaluated_decisions.saturating_add(1);
        if self.cache_limit > 0 {
            if self.decision_cache.len() >= self.cache_limit {
                self.decision_cache.clear();
            }
            self.decision_cache.insert(*observation, action);
        }
        Ok(action)
    }

    pub fn stats(&self) -> Model91PolicyStats {
        self.stats
    }

    pub fn decision_cache_len(&self) -> usize {
        self.decision_cache.len()
    }

    pub fn clear_decision_cache(&mut self) {
        self.decision_cache.clear();
    }

    fn best_rank(&mut self, observation: &Model91Observation, legal: &[u8]) -> Result<u8, String> {
        let opponent_hands = self.opponent_hands(observation)?;
        let mut memo = HashMap::new();
        let mut best = legal[0];
        let mut best_net = f64::NEG_INFINITY;
        let mut best_immediate = 0_u8;
        for rank in legal.iter().copied() {
            let (net, immediate) = candidate_net_ev(observation, rank, &opponent_hands, &mut memo)?;
            let replace = net > best_net
                || (net == best_net && immediate > best_immediate)
                || (net == best_net && immediate == best_immediate && rank > best);
            if replace {
                best = rank;
                best_net = net;
                best_immediate = immediate;
            }
        }
        self.stats.random_future_states = self
            .stats
            .random_future_states
            .saturating_add(memo.len() as u64);
        Ok(best)
    }

    fn opponent_hands(
        &self,
        observation: &Model91Observation,
    ) -> Result<Vec<([u8; RANKS], f64)>, String> {
        let own_initial = observation.own_initial_keep();
        let mut available = [4_u8; RANKS];
        for rank in 0..RANKS {
            let known = own_initial[rank]
                .saturating_add(observation.own_discards[rank])
                .saturating_add(observation.opponent_played[rank])
                .saturating_add(u8::from(observation.turn_rank == Some(rank as u8)));
            available[rank] = available[rank]
                .checked_sub(known)
                .ok_or_else(|| format!("Model 9.1 known rank {} exceeds four cards", rank))?;
        }
        let size = observation.opponent_remaining_count()?;
        let opponent_role = match observation.role {
            Role::Dealer => Role::Pone,
            Role::Pone => Role::Dealer,
        };
        if rank_count_total(&observation.opponent_played) > 0 {
            if let Some(empirical) = self.empirical.as_ref().and_then(|beliefs| {
                beliefs.hands(opponent_role, observation.opponent_played, &available, size)
            }) {
                return Ok(empirical);
            }
        }
        Ok(enumerate_rank_hands(&available, size))
    }
}

pub fn rollout_model91_pair(
    dealer_keep: [u8; RANKS],
    pone_keep: [u8; RANKS],
    policy: &mut Model91Policy,
) -> Result<(u8, u8), String> {
    if rank_count_total(&dealer_keep) != 4 || rank_count_total(&pone_keep) != 4 {
        return Err("Model 9.1 pair rollout requires two four-card keeps".to_string());
    }
    if dealer_keep
        .iter()
        .zip(pone_keep)
        .any(|(dealer, pone)| dealer + pone > 4)
    {
        return Err("Model 9.1 pair rollout received incompatible keeps".to_string());
    }
    let mut state = RankPegState {
        hands: [dealer_keep, pone_keep],
        own_discards: [[0_u8; RANKS]; 2],
        turn_rank: 0,
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
    while !state.complete {
        let actor = state.current;
        let legal = state.legal_actions();
        if legal.is_empty() {
            return Err(
                "Model 9.1 pair rollout reached a non-terminal state without actions".to_string(),
            );
        }
        let action = if legal.len() == 1 {
            legal[0]
        } else {
            // The historical reusable keep-pair asset did not have a specific
            // six-card deal or cut. Keep that builder path explicit; live
            // Model 9.x decisions always use `from_state`/`from_public_state`
            // with the legally known cards populated.
            let observation = Model91Observation::from_state_without_crib_or_cut(&state, actor)?;
            let action = policy.choose_action(&observation)?;
            if !legal.contains(&action) {
                return Err("Model 9.1 policy selected an illegal action".to_string());
            }
            action
        };
        state.apply(action)?;
    }
    Ok((
        u8::try_from(state.scores[PegSeat::Zero.index()])
            .map_err(|_| "dealer pegging score does not fit u8".to_string())?,
        u8::try_from(state.scores[PegSeat::One.index()])
            .map_err(|_| "pone pegging score does not fit u8".to_string())?,
    ))
}

pub fn model91_initial_pone_lead(
    pone_keep: [u8; RANKS],
    policy: &mut Model91Policy,
) -> Result<u8, String> {
    if rank_count_total(&pone_keep) != 4 {
        return Err("Model 9.1 pone lead requires a four-card keep".to_string());
    }
    let observation = Model91Observation {
        role: Role::Pone,
        own_remaining: pone_keep,
        own_played: [0_u8; RANKS],
        opponent_played: [0_u8; RANKS],
        own_discards: [0_u8; RANKS],
        turn_rank: None,
        current_series: [0_u8; MAX_SERIES],
        current_series_len: 0,
        count: 0,
        go_player: None,
        last_player: None,
    };
    match policy.choose_action(&observation)? {
        RankPegAction::Play(rank) => Ok(rank),
        RankPegAction::Go => Err("Model 9.1 pone policy returned go with four cards".to_string()),
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct AverageState {
    hands: [[u8; RANKS]; 2],
    plays: Vec<u8>,
    count: u8,
    current: u8,
    go_player: Option<u8>,
    last_player: Option<u8>,
}

#[derive(Clone, Copy, Debug, Default)]
struct WeightedPoints {
    points: [f64; 2],
    weight: f64,
}

fn candidate_net_ev(
    observation: &Model91Observation,
    rank: u8,
    opponent_hands: &[([u8; RANKS], f64)],
    memo: &mut HashMap<AverageState, WeightedPoints>,
) -> Result<(f64, u8), String> {
    let immediate = score_count_for_ranks(
        &observation
            .series()
            .iter()
            .copied()
            .chain(std::iter::once(rank))
            .collect::<Vec<_>>(),
    );
    let mut own_weighted = 0.0;
    let mut opponent_weighted = 0.0;
    let mut total_weight = 0.0;
    for (opponent_hand, opponent_weight) in opponent_hands {
        if *opponent_weight <= 0.0 {
            continue;
        }
        let state = AverageState {
            hands: [observation.own_remaining, *opponent_hand],
            plays: observation.series().to_vec(),
            count: observation.count,
            current: 0,
            go_player: relative_index(observation.go_player),
            last_player: relative_index(observation.last_player),
        };
        let result = average_forced_play(&state, rank, memo)?;
        own_weighted += result.points[0] * *opponent_weight;
        opponent_weighted += result.points[1] * *opponent_weight;
        total_weight += result.weight * *opponent_weight;
    }
    if total_weight == 0.0 {
        return Ok((f64::from(immediate), immediate));
    }
    Ok(((own_weighted - opponent_weighted) / total_weight, immediate))
}

fn average_future(
    state: &AverageState,
    memo: &mut HashMap<AverageState, WeightedPoints>,
) -> Result<WeightedPoints, String> {
    if let Some(cached) = memo.get(state).copied() {
        return Ok(cached);
    }
    if state.hands.iter().flatten().all(|count| *count == 0) {
        let mut terminal = WeightedPoints {
            points: [0.0, 0.0],
            weight: 1.0,
        };
        if state.count != 0 {
            if let Some(last) = state.last_player {
                terminal.points[last as usize] = 1.0;
            }
        }
        memo.insert(state.clone(), terminal);
        return Ok(terminal);
    }
    let legal = legal_ranks(&state.hands[state.current as usize], state.count);
    let result = if legal.is_empty() {
        average_go(state, memo)?
    } else {
        let mut total = WeightedPoints::default();
        for rank in legal {
            let branch_weight = f64::from(state.hands[state.current as usize][rank as usize]);
            let branch = average_forced_play(state, rank, memo)?;
            total.points[0] += branch.points[0] * branch_weight;
            total.points[1] += branch.points[1] * branch_weight;
            total.weight += branch.weight * branch_weight;
        }
        total
    };
    memo.insert(state.clone(), result);
    Ok(result)
}

fn average_forced_play(
    state: &AverageState,
    rank: u8,
    memo: &mut HashMap<AverageState, WeightedPoints>,
) -> Result<WeightedPoints, String> {
    let player = state.current as usize;
    if rank as usize >= RANKS || state.hands[player][rank as usize] == 0 {
        return Err("Model 9.1 average continuation selected an absent rank".to_string());
    }
    let next_count = state.count + VALUES[rank as usize];
    if next_count > 31 {
        return Err("Model 9.1 average continuation exceeded 31".to_string());
    }
    let mut next = state.clone();
    next.hands[player][rank as usize] -= 1;
    next.plays.push(rank);
    let points = score_count_for_ranks(&next.plays);
    if next_count == 31 {
        next.plays.clear();
        next.count = 0;
        next.current = 1 - state.current;
        next.go_player = None;
        next.last_player = None;
    } else {
        next.count = next_count;
        next.last_player = Some(state.current);
        if state.go_player.is_none() {
            next.current = 1 - state.current;
        }
    }
    let mut future = average_future(&next, memo)?;
    future.points[player] += f64::from(points) * future.weight;
    Ok(future)
}

fn average_go(
    state: &AverageState,
    memo: &mut HashMap<AverageState, WeightedPoints>,
) -> Result<WeightedPoints, String> {
    let mut next = state.clone();
    if state.go_player.is_some() {
        let scorer = state.last_player;
        next.plays.clear();
        next.count = 0;
        next.current = 1 - state.current;
        next.go_player = None;
        next.last_player = None;
        let mut future = average_future(&next, memo)?;
        if let Some(scorer) = scorer {
            future.points[scorer as usize] += future.weight;
        }
        Ok(future)
    } else {
        next.go_player = Some(state.current);
        next.current = 1 - state.current;
        average_future(&next, memo)
    }
}

fn legal_ranks(hand: &[u8; RANKS], count: u8) -> Vec<u8> {
    hand.iter()
        .enumerate()
        .filter_map(|(rank, copies)| {
            (*copies > 0 && count + VALUES[rank] <= 31).then_some(rank as u8)
        })
        .collect()
}

fn score_count_for_ranks(ranks: &[u8]) -> u8 {
    score_count(
        &ranks
            .iter()
            .copied()
            .map(peg_card_for_rank)
            .collect::<Vec<_>>(),
    )
}

fn relative_actor(seat: Option<PegSeat>, actor: PegSeat) -> Option<Model91Actor> {
    seat.map(|seat| {
        if seat == actor {
            Model91Actor::SelfPlayer
        } else {
            Model91Actor::Opponent
        }
    })
}

fn relative_index(actor: Option<Model91Actor>) -> Option<u8> {
    actor.map(|actor| match actor {
        Model91Actor::SelfPlayer => 0,
        Model91Actor::Opponent => 1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::process;

    fn hand(entries: &[(u8, u8)]) -> [u8; RANKS] {
        let mut hand = [0_u8; RANKS];
        for (rank, copies) in entries {
            hand[*rank as usize] = *copies;
        }
        hand
    }

    fn state(opponent: [u8; RANKS]) -> RankPegState {
        RankPegState {
            hands: [hand(&[(0, 1), (4, 1), (5, 1), (9, 1)]), opponent],
            own_discards: [hand(&[(1, 1), (2, 1)]), hand(&[(3, 1), (6, 1)])],
            turn_rank: 8,
            scores: [0, 0],
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

    #[test]
    fn observation_uses_own_discard_and_cut_but_ignores_hidden_opponent_cards() {
        let first = state(hand(&[(1, 1), (2, 1), (3, 1), (7, 1)]));
        let mut second = state(hand(&[(6, 1), (7, 1), (8, 1), (11, 1)]));
        second.own_discards[PegSeat::One.index()] = hand(&[(12, 2)]);
        let first_observation = Model91Observation::from_state(&first, PegSeat::Zero).unwrap();
        let second_observation = Model91Observation::from_state(&second, PegSeat::Zero).unwrap();
        assert_eq!(first_observation, second_observation);

        let mut policy = Model91Policy::new(None, 100);
        assert_eq!(
            policy.choose_action(&first_observation).unwrap(),
            policy.choose_action(&second_observation).unwrap()
        );
        assert_eq!(policy.stats().decision_cache_hits, 1);

        let mut different_own_discard = first.clone();
        different_own_discard.own_discards[PegSeat::Zero.index()] = hand(&[(10, 2)]);
        assert_ne!(
            first_observation,
            Model91Observation::from_state(&different_own_discard, PegSeat::Zero).unwrap()
        );

        let mut different_cut = first.clone();
        different_cut.turn_rank = 12;
        assert_ne!(
            first_observation,
            Model91Observation::from_state(&different_cut, PegSeat::Zero).unwrap()
        );
    }

    #[test]
    fn opponent_belief_removes_own_discard_and_cut_cards() {
        let mut known = state(hand(&[(1, 1), (2, 1), (3, 1), (7, 1)]));
        known.own_discards[PegSeat::Zero.index()] = hand(&[(0, 2)]);
        known.turn_rank = 0;
        let observation = Model91Observation::from_state(&known, PegSeat::Zero).unwrap();
        let policy = Model91Policy::new(None, 0);
        let opponent_hands = policy.opponent_hands(&observation).unwrap();

        assert!(!opponent_hands.is_empty());
        assert!(opponent_hands.iter().all(|(opponent, _)| opponent[0] == 0));
    }

    #[test]
    fn pair_rollout_is_deterministic_and_scores_both_roles() {
        let dealer = hand(&[(4, 2), (5, 1), (9, 1)]);
        let pone = hand(&[(0, 1), (1, 1), (2, 1), (3, 1)]);
        let mut first_policy = Model91Policy::new(None, 10_000);
        let mut second_policy = Model91Policy::new(None, 10_000);
        let first = rollout_model91_pair(dealer, pone, &mut first_policy).unwrap();
        let second = rollout_model91_pair(dealer, pone, &mut second_policy).unwrap();
        assert_eq!(first, second);
        assert!(first.0 <= 31 && first.1 <= 31);
    }

    #[test]
    fn average_continuation_handles_go_and_last_card() {
        let mut memo = HashMap::new();
        let state = AverageState {
            hands: [hand(&[(9, 1)]), hand(&[(8, 1)])],
            plays: vec![9, 9, 4],
            count: 25,
            current: 0,
            go_player: None,
            last_player: Some(1),
        };
        let result = average_future(&state, &mut memo).unwrap();
        assert_eq!(result.weight, 1.0);
        assert!(result.points.iter().sum::<f64>() >= 1.0);
    }

    #[test]
    fn model91_uses_complete_cribbage_pegging_scores() {
        assert_eq!(score_count_for_ranks(&[4, 9]), 2);
        assert_eq!(score_count_for_ranks(&[4, 4]), 2);
        assert_eq!(score_count_for_ranks(&[4, 4, 4]), 8);
        assert_eq!(score_count_for_ranks(&[4, 4, 4, 4]), 12);
        assert_eq!(score_count_for_ranks(&[0, 2, 1]), 3);
        assert_eq!(score_count_for_ranks(&[9, 9, 9, 0]), 2);
    }

    #[test]
    fn empirical_belief_filters_impossible_hidden_hands() {
        let mut beliefs = Model91EmpiricalBeliefs::default();
        beliefs
            .insert(
                Role::Dealer,
                hand(&[(0, 1)]),
                vec![(hand(&[(4, 3)]), 7), (hand(&[(12, 3)]), 11)],
            )
            .unwrap();
        let available = hand(&[(4, 2), (12, 4)]);
        let hands = beliefs
            .hands(Role::Dealer, hand(&[(0, 1)]), &available, 3)
            .unwrap();
        assert_eq!(hands, vec![(hand(&[(12, 3)]), 11.0)]);
    }

    #[test]
    fn packed_empirical_beliefs_round_trip_without_hidden_state() {
        let path = env::temp_dir().join(format!("cribbage-model91-beliefs-{}.bin", process::id()));
        let played = hand(&[(0, 1)]);
        let remaining = hand(&[(4, 2), (8, 1)]);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(BELIEF_MAGIC);
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        bytes.extend_from_slice(&(BELIEF_ENTRY_BYTES as u32).to_le_bytes());
        bytes.extend_from_slice(&(BELIEF_RECORD_BYTES as u32).to_le_bytes());
        bytes.push(0);
        bytes.extend_from_slice(&played);
        bytes.extend_from_slice(&0_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        bytes.extend_from_slice(&remaining);
        bytes.extend_from_slice(&17_u64.to_le_bytes());
        fs::write(&path, bytes).unwrap();

        let beliefs = Model91EmpiricalBeliefs::load(&path).unwrap();
        let rows = beliefs
            .hands(Role::Dealer, played, &[4_u8; RANKS], 3)
            .unwrap();
        assert_eq!(rows, vec![(remaining, 17.0)]);
        fs::remove_file(path).unwrap();
    }
}
