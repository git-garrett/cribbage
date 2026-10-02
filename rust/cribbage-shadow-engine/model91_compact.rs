//! Exact implementation of the reference average-continuation calculation.
//! This is decision-local outcome memoization, never a stored action policy.
//! Rank order, multiplicities, score rules and floating-point operation order
//! are unchanged. Only inactive series bytes are canonicalized away.
use super::{AverageState, WeightedPoints, MAX_SERIES, RANKS, VALUES};
use crate::board::Role;
use crate::board_matrix::{BoardMatrixSeam, BoardWinMatrix};
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hash, Hasher};

const HAND_BITS: u32 = 39;
const SERIES: u32 = 78;
const LENGTH: u32 = 110;
const COUNT: u32 = 114;
const CURRENT: u32 = 119;
const GO: u32 = 120;
const LAST: u32 = 122;
const HAND_MASK: u128 = (1_u128 << SERIES) - 1;

/// The entire semantic state fits in 124 bits; equality checks all of them.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct State(u128);

impl Hash for State {
    fn hash<H: Hasher>(&self, hasher: &mut H) {
        hasher.write_u128(self.0);
    }
}

/// Fast indexing for bounded internal state keys. A hash collision never
/// identifies a state: HashMap still compares the complete 128-bit key.
#[derive(Default)]
struct StateHasher(u64);
impl Hasher for StateHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 = self.0.rotate_left(5) ^ u64::from(*byte);
        }
    }
    fn write_u128(&mut self, key: u128) {
        let product = u128::from((key as u64) ^ 0xa0761d6478bd642f)
            * u128::from(((key >> 64) as u64) ^ 0xe7037ed1a0b428db);
        self.0 = product as u64 ^ (product >> 64) as u64;
    }
}

impl State {
    pub(super) fn from_reference(state: &AverageState) -> Self {
        let mut key = 0;
        for player in 0..2 {
            for rank in 0..RANKS {
                debug_assert!(state.hands[player][rank] <= 4);
                key |= u128::from(state.hands[player][rank])
                    << (player as u32 * HAND_BITS + rank as u32 * 3);
            }
        }
        // Bytes beyond plays_len never affect the reference calculation.
        for (index, rank) in state.series().iter().enumerate() {
            debug_assert!(*rank < RANKS as u8);
            key |= u128::from(*rank) << (SERIES + index as u32 * 4);
        }
        key |= u128::from(state.plays_len) << LENGTH;
        key |= u128::from(state.count) << COUNT;
        key |= u128::from(state.current) << CURRENT;
        key |= u128::from(state.go_player.map_or(0, |p| p + 1)) << GO;
        key |= u128::from(state.last_player.map_or(0, |p| p + 1)) << LAST;
        Self(key)
    }
    fn field(self, shift: u32, mask: u128) -> u8 {
        ((self.0 >> shift) & mask) as u8
    }
    fn set(&mut self, shift: u32, mask: u128, value: u8) {
        self.0 = (self.0 & !(mask << shift)) | (u128::from(value) << shift);
    }
    fn copies(self, player: u8, rank: u8) -> u8 {
        self.field(u32::from(player) * HAND_BITS + u32::from(rank) * 3, 7)
    }
    fn count(self) -> u8 {
        self.field(COUNT, 31)
    }
    fn current(self) -> u8 {
        self.field(CURRENT, 1)
    }
    fn len(self) -> usize {
        self.field(LENGTH, 15) as usize
    }
    fn reset(&mut self, current: u8) {
        self.0 &= HAND_MASK;
        self.0 |= u128::from(current) << CURRENT;
    }
    fn score(self) -> u8 {
        let len = self.len();
        if len < 2 {
            return 0;
        }
        let points = if matches!(self.count(), 15 | 31) {
            2
        } else {
            0
        };
        let series = (self.0 >> SERIES) as u32;
        let last = ((series >> ((len - 1) * 4)) & 15) as u8;
        let mut same = 1;
        for index in (0..len - 1).rev() {
            if ((series >> (index * 4)) & 15) as u8 != last {
                break;
            }
            same += 1;
        }
        // A repeated final rank rules out every run ending at this play.
        if same >= 2 {
            return points
                + match same {
                    2 => 2,
                    3 => 6,
                    4 => 12,
                    _ => 0,
                };
        }
        let mut seen = 1_u16 << last;
        let mut min = last;
        let mut max = last;
        let mut run = 0;
        for length in 2..=len {
            let rank = ((series >> ((len - length) * 4)) & 15) as u8;
            let bit = 1_u16 << rank;
            if seen & bit != 0 {
                break;
            }
            seen |= bit;
            min = min.min(rank);
            max = max.max(rank);
            if length >= 3 && usize::from(max - min + 1) == length {
                run = length as u8;
            }
        }
        points + run
    }
}

#[derive(Default)]
pub(super) struct Memo {
    outcomes: HashMap<State, WeightedPoints, BuildHasherDefault<StateHasher>>,
}

impl Memo {
    pub(super) fn len(&self) -> usize {
        self.outcomes.len()
    }
    pub(super) fn clear(&mut self) {
        self.outcomes.clear();
    }
    pub(super) fn forced_play(
        &mut self,
        state: &AverageState,
        rank: u8,
        hits: &mut u64,
    ) -> Result<WeightedPoints, String> {
        self.play(State::from_reference(state), rank, hits)
    }
    fn future(&mut self, state: State, hits: &mut u64) -> Result<WeightedPoints, String> {
        // A finished continuation is cheaper to compute than to hash/store.
        // Keep the identical terminal value and arithmetic; omit only memo work.
        if state.0 & HAND_MASK == 0 {
            let mut result = WeightedPoints {
                points: [0.0; 2],
                weight: 1.0,
            };
            let last = state.field(LAST, 3);
            if state.count() != 0 && last != 0 {
                result.points[usize::from(last - 1)] = 1.0;
            }
            return Ok(result);
        }
        if let Some(outcome) = self.outcomes.get(&state).copied() {
            *hits = hits.saturating_add(1);
            return Ok(outcome);
        }
        let result = {
            let mut found = false;
            let mut total = WeightedPoints::default();
            // Identical ascending rank and multiplicity order to the oracle.
            // No heap allocation for a list containing at most four ranks.
            for rank in 0..RANKS as u8 {
                let copies = state.copies(state.current(), rank);
                if copies == 0 || state.count() + VALUES[rank as usize] > 31 {
                    continue;
                }
                found = true;
                let branch = self.play(state, rank, hits)?;
                let weight = f64::from(copies);
                total.points[0] += branch.points[0] * weight;
                total.points[1] += branch.points[1] * weight;
                total.weight += branch.weight * weight;
            }
            if found {
                total
            } else {
                self.go(state, hits)?
            }
        };
        self.outcomes.insert(state, result);
        Ok(result)
    }
    fn play(&mut self, state: State, rank: u8, hits: &mut u64) -> Result<WeightedPoints, String> {
        let current = state.current();
        if rank >= RANKS as u8 || state.copies(current, rank) == 0 {
            return Err("Model 9.1 average continuation selected an absent rank".into());
        }
        let count = state.count() + VALUES[rank as usize];
        if count > 31 {
            return Err("Model 9.1 average continuation exceeded 31".into());
        }
        if state.len() >= MAX_SERIES {
            return Err("Model 9.1 average series exceeds eight cards".into());
        }
        let mut next = state;
        next.0 -= 1_u128 << (u32::from(current) * HAND_BITS + u32::from(rank) * 3);
        next.set(SERIES + state.len() as u32 * 4, 15, rank);
        next.set(LENGTH, 15, state.len() as u8 + 1);
        next.set(COUNT, 31, count);
        let points = next.score();
        if count == 31 {
            next.reset(1 - current);
        } else {
            next.set(LAST, 3, current + 1);
            if state.field(GO, 3) == 0 {
                next.set(CURRENT, 1, 1 - current);
            }
        }
        let mut future = self.future(next, hits)?;
        future.points[current as usize] += f64::from(points) * future.weight;
        Ok(future)
    }
    fn go(&mut self, state: State, hits: &mut u64) -> Result<WeightedPoints, String> {
        let mut next = state;
        if state.field(GO, 3) != 0 {
            let scorer = state.field(LAST, 3);
            next.reset(1 - state.current());
            let mut future = self.future(next, hits)?;
            if scorer != 0 {
                future.points[(scorer - 1) as usize] += future.weight;
            }
            Ok(future)
        } else {
            next.set(GO, 3, state.current() + 1);
            next.set(CURRENT, 1, 1 - state.current());
            self.future(next, hits)
        }
    }
}

/// Model 20.1's action evaluator averages terminal win probabilities, never
/// point means. As with the historical average-continuation evaluator, this is
/// a value estimate for choosing one action, not an omniscient action policy.
/// The enclosing live rollout asks the WP chooser again at every actual step.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct WpState {
    peg: State,
    scores: [u8; 2],
    role: Role,
}

// Splitting the packed state into words avoids u128 alignment padding in
// each hash-table entry. Equality and hashing retain every state/score/role bit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct WpKey {
    peg: [u64; 2],
    scores: [u8; 2],
    role: Role,
}

impl From<WpState> for WpKey {
    fn from(state: WpState) -> Self {
        Self {
            peg: [state.peg.0 as u64, (state.peg.0 >> 64) as u64],
            scores: state.scores,
            role: state.role,
        }
    }
}

impl Hash for WpKey {
    fn hash<H: Hasher>(&self, hasher: &mut H) {
        // Mix board context before multiplication; appending it left score
        // variants in the same probe chain. Equality still checks every field.
        let role = match self.role {
            Role::Dealer => 0_u64,
            Role::Pone => 1,
        };
        let context = u64::from(self.scores[0]) | (u64::from(self.scores[1]) << 8) | (role << 16);
        hasher.write_u128(
            u128::from(self.peg[0]) | (u128::from(self.peg[1] ^ (context << 14)) << 64),
        );
    }
}

// A bounded, decision-local memo of pure scoring results. A collision replaces
// an entry only after full-key comparison; it never substitutes another score.
// 131,072 packed entries (1 MiB); see docs/research/model203-series-scoring.md.
const SCORE_CACHE_BITS: u32 = 17;
const SCORE_KEY_BITS: u32 = CURRENT - SERIES;
const SCORE_KEY_MASK: u64 = (1_u64 << SCORE_KEY_BITS) - 1;

#[derive(Default)]
struct SeriesScoreMemo {
    entries: Vec<u64>,
}

impl SeriesScoreMemo {
    fn index(key: u64) -> usize {
        (key.wrapping_mul(0x9e3779b97f4a7c15) >> (64 - SCORE_CACHE_BITS)) as usize
    }

    fn score(&mut self, state: State) -> u8 {
        // Tiny sequences cost less to calculate than to look up.
        if state.len() < 3 {
            return state.score();
        }
        if self.entries.is_empty() {
            self.entries.resize(1 << SCORE_CACHE_BITS, 0);
        }
        // All eight rank slots, the active length, and count. Hand contents,
        // turn, go, last player, scores, and role do not affect this pure score.
        let key = ((state.0 >> SERIES) as u64) & SCORE_KEY_MASK;
        let entry = &mut self.entries[Self::index(key)];
        if *entry & SCORE_KEY_MASK == key {
            return (*entry >> SCORE_KEY_BITS) as u8;
        }
        let score = state.score();
        // The nonzero length makes a valid key distinct from an empty entry.
        *entry = key | (u64::from(score) << SCORE_KEY_BITS);
        score
    }

    fn clear(&mut self) {
        self.entries.fill(0);
    }
}

#[derive(Default)]
pub(super) struct WpMemo {
    outcomes: HashMap<WpKey, f64, BuildHasherDefault<StateHasher>>,
    series_scores: SeriesScoreMemo,
    collapse_forced: bool,
}

impl WpMemo {
    /// Decision-local opt-in for 20.6; historical models keep the recursive path.
    pub(super) fn collapse_forced_continuations(&mut self) {
        self.collapse_forced = true;
    }

    pub(super) fn clear(&mut self) {
        self.outcomes.clear();
        self.series_scores.clear();
    }

    pub(super) fn forced_play(
        &mut self,
        state: &AverageState,
        scores: [u8; 2],
        role: Role,
        rank: u8,
        board: &BoardWinMatrix,
    ) -> Result<f64, String> {
        self.forced_play_prepared(State::from_reference(state), scores, role, rank, board)
    }

    pub(super) fn forced_play_prepared(
        &mut self,
        state: State,
        scores: [u8; 2],
        role: Role,
        rank: u8,
        board: &BoardWinMatrix,
    ) -> Result<f64, String> {
        let state = WpState {
            peg: state,
            scores,
            role,
        };
        if rank >= RANKS as u8 || state.peg.copies(state.peg.current(), rank) == 0 {
            return Err("Model 20.1 WP evaluator selected an absent rank".into());
        }
        if state.peg.count() + VALUES[rank as usize] > 31 {
            return Err("Model 20.1 WP evaluator selected an illegal play".into());
        }
        if self.collapse_forced {
            self.play_collapsed(state, rank, board)
        } else {
            self.play(state, rank, board)
        }
    }

    fn terminal(state: WpState, board: &BoardWinMatrix) -> f64 {
        if state.scores[0] >= 121 {
            return 1.0;
        }
        if state.scores[1] >= 121 {
            return 0.0;
        }
        match state.role {
            Role::Dealer => board.dealer_win_probability(
                BoardMatrixSeam::AfterPegging,
                state.scores[0],
                state.scores[1],
            ),
            Role::Pone => {
                1.0 - board.dealer_win_probability(
                    BoardMatrixSeam::AfterPegging,
                    state.scores[1],
                    state.scores[0],
                )
            }
        }
    }

    fn future(&mut self, mut state: WpState, board: &BoardWinMatrix) -> Result<f64, String> {
        // Stop immediately at the first winner, before a later scoring event.
        if state.scores.iter().any(|score| *score >= 121) {
            return Ok(Self::terminal(state, board));
        }
        if state.peg.0 & HAND_MASK == 0 {
            let last = state.peg.field(LAST, 3);
            if state.peg.count() != 0 && last != 0 {
                state.scores[usize::from(last - 1)] += 1;
            }
            return Ok(Self::terminal(state, board));
        }
        // Memoize zero-count states, where different played series can converge.
        // Keep cheap one/two-card tails out of the bounded memo as well.
        let cache = state.peg.count() == 0 && {
            let hands = state.peg.0 & HAND_MASK;
            // Rank counts occupy three-bit fields; sum their bit planes.
            let rank_low_bits = HAND_MASK / 7;
            let remaining = (hands & rank_low_bits).count_ones()
                + 2 * ((hands >> 1) & rank_low_bits).count_ones()
                + 4 * ((hands >> 2) & rank_low_bits).count_ones();
            remaining > 2
        };
        if cache {
            if let Some(value) = self.outcomes.get(&WpKey::from(state)) {
                return Ok(*value);
            }
        }
        let mut weighted = 0.0;
        let mut copies = 0_u8;
        // The active hand has at most four ranks. Visit present, playable
        // ranks in ascending order so the floating-point sum stays identical.
        let hand_mask = (1_u64 << HAND_BITS) - 1;
        let hand = (state.peg.0 >> (u32::from(state.peg.current()) * HAND_BITS)) as u64
            & hand_mask;
        let room = 31 - state.peg.count();
        let legal_ranks = if room >= 10 { 13 } else { u32::from(room) };
        let mut present = (hand | (hand >> 1) | (hand >> 2)) & (hand_mask / 7)
            & ((1_u64 << (legal_ranks * 3)) - 1);
        while present != 0 {
            let shift = present.trailing_zeros();
            present &= present - 1;
            let rank = (shift / 3) as u8;
            let count = ((hand >> shift) & 7) as u8;
            weighted += f64::from(count) * self.play(state, rank, board)?;
            copies += count;
        }
        let value = if copies > 0 {
            weighted / f64::from(copies)
        } else {
            let mut next = state;
            if state.peg.field(GO, 3) != 0 {
                let last = state.peg.field(LAST, 3);
                if last != 0 {
                    next.scores[usize::from(last - 1)] += 1;
                }
                next.peg.reset(1 - state.peg.current());
            } else {
                next.peg.set(GO, 3, state.peg.current() + 1);
                next.peg.set(CURRENT, 1, 1 - state.peg.current());
            }
            self.future(next, board)?
        };
        // This memo exists for one live decision and includes scores and role.
        if cache {
            if self.outcomes.len() >= 1_000_000 {
                self.outcomes.clear();
            }
            self.outcomes.insert(WpKey::from(state), value);
        }
        Ok(value)
    }

    fn play(&mut self, state: WpState, rank: u8, board: &BoardWinMatrix) -> Result<f64, String> {
        let current = state.peg.current();
        // forced_play checks the entry; future visits only present, playable ranks.
        debug_assert!(rank < RANKS as u8 && state.peg.copies(current, rank) > 0);
        let count = state.peg.count() + VALUES[rank as usize];
        debug_assert!(count <= 31);
        if state.peg.len() >= MAX_SERIES {
            return Err("Model 20.1 WP evaluator selected an illegal play".into());
        }
        let mut next = state;
        next.peg.0 -= 1_u128 << (u32::from(current) * HAND_BITS + u32::from(rank) * 3);
        next.peg.set(SERIES + state.peg.len() as u32 * 4, 15, rank);
        next.peg.set(LENGTH, 15, state.peg.len() as u8 + 1);
        next.peg.set(COUNT, 31, count);
        next.scores[current as usize] += self.series_scores.score(next.peg);
        if count == 31 {
            next.peg.reset(1 - current);
        } else {
            next.peg.set(LAST, 3, current + 1);
            if state.peg.field(GO, 3) == 0 {
                next.peg.set(CURRENT, 1, 1 - current);
            }
        }
        self.future(next, board)
    }
    // Keep the historical evaluator above unchanged. This 20.6-only loop
    // collapses one physical legal card or go, not duplicate-rank weighting.
    // Cache-eligible states still take the original lookup/insert path.
    fn after_play(&mut self, state: WpState, rank: u8) -> Result<WpState, String> {
        let current = state.peg.current();
        // forced_play checks the entry; future visits only present, playable ranks.
        debug_assert!(rank < RANKS as u8 && state.peg.copies(current, rank) > 0);
        let count = state.peg.count() + VALUES[rank as usize];
        debug_assert!(count <= 31);
        if state.peg.len() >= MAX_SERIES {
            return Err("Model 20.1 WP evaluator selected an illegal play".into());
        }
        let mut next = state;
        next.peg.0 -= 1_u128 << (u32::from(current) * HAND_BITS + u32::from(rank) * 3);
        next.peg.set(SERIES + state.peg.len() as u32 * 4, 15, rank);
        next.peg.set(LENGTH, 15, state.peg.len() as u8 + 1);
        next.peg.set(COUNT, 31, count);
        next.scores[current as usize] += self.series_scores.score(next.peg);
        if count == 31 {
            next.peg.reset(1 - current);
        } else {
            next.peg.set(LAST, 3, current + 1);
            if state.peg.field(GO, 3) == 0 {
                next.peg.set(CURRENT, 1, 1 - current);
            }
        }
        Ok(next)
    }
    #[inline]
    fn remaining(peg: State) -> u32 {
        let hands = peg.0 & HAND_MASK;
        let low = HAND_MASK / 7;
        (hands & low).count_ones()
            + 2 * ((hands >> 1) & low).count_ones()
            + 4 * ((hands >> 2) & low).count_ones()
    }

    #[inline]
    fn legal(peg: State) -> (u64, u64) {
        let mask = (1_u64 << HAND_BITS) - 1;
        let hand = (peg.0 >> (u32::from(peg.current()) * HAND_BITS)) as u64 & mask;
        let room = 31 - peg.count();
        let ranks = if room >= 10 { 13 } else { u32::from(room) };
        (
            hand,
            (hand | hand >> 1 | hand >> 2) & (mask / 7) & ((1_u64 << (ranks * 3)) - 1),
        )
    }

    #[inline]
    fn after_go(mut state: WpState) -> WpState {
        let current = state.peg.current();
        if state.peg.field(GO, 3) != 0 {
            let last = state.peg.field(LAST, 3);
            if last != 0 {
                state.scores[usize::from(last - 1)] += 1;
            }
            state.peg.reset(1 - current);
        } else {
            state.peg.set(GO, 3, current + 1);
            state.peg.set(CURRENT, 1, 1 - current);
        }
        state
    }

    // Each elided (0 + 1 * value) / 1 normalizes negative zero once.
    #[inline]
    fn finish_collapsed(value: f64, normalize_zero: bool) -> f64 {
        if normalize_zero {
            0.0 + value
        } else {
            value
        }
    }

    fn future_collapsed(
        &mut self,
        mut state: WpState,
        board: &BoardWinMatrix,
    ) -> Result<f64, String> {
        let mut normalize_zero = false;
        loop {
            if state.scores.iter().any(|score| *score >= 121) {
                return Ok(Self::finish_collapsed(
                    Self::terminal(state, board),
                    normalize_zero,
                ));
            }
            if state.peg.0 & HAND_MASK == 0 {
                let last = state.peg.field(LAST, 3);
                if state.peg.count() != 0 && last != 0 {
                    state.scores[usize::from(last - 1)] += 1;
                }
                return Ok(Self::finish_collapsed(
                    Self::terminal(state, board),
                    normalize_zero,
                ));
            }
            let cache = state.peg.count() == 0 && Self::remaining(state.peg) > 2;
            if cache {
                if let Some(value) = self.outcomes.get(&WpKey::from(state)) {
                    return Ok(Self::finish_collapsed(*value, normalize_zero));
                }
            }
            let (hand, mut present) = Self::legal(state.peg);
            // Preserve cached entry insertion and duplicate-rank multiply/divide.
            if !cache {
                if present == 0 {
                    state = Self::after_go(state);
                    continue;
                }
                if present.is_power_of_two() {
                    let shift = present.trailing_zeros();
                    if (hand >> shift) & 7 == 1 {
                        normalize_zero = true;
                        state = self.after_play(state, (shift / 3) as u8)?;
                        continue;
                    }
                }
            }
            let mut weighted = 0.0;
            let mut copies = 0_u8;
            while present != 0 {
                let shift = present.trailing_zeros();
                present &= present - 1;
                let count = ((hand >> shift) & 7) as u8;
                weighted +=
                    f64::from(count) * self.play_collapsed(state, (shift / 3) as u8, board)?;
                copies += count;
            }
            let value = if copies > 0 {
                weighted / f64::from(copies)
            } else {
                self.future_collapsed(Self::after_go(state), board)?
            };
            if cache {
                if self.outcomes.len() >= 1_000_000 {
                    self.outcomes.clear();
                }
                self.outcomes.insert(WpKey::from(state), value);
            }
            return Ok(Self::finish_collapsed(value, normalize_zero));
        }
    }

    fn play_collapsed(
        &mut self,
        state: WpState,
        rank: u8,
        board: &BoardWinMatrix,
    ) -> Result<f64, String> {
        let next = self.after_play(state, rank)?;
        self.future_collapsed(next, board)
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::information_set::{PegSeat, RankPegState};

    #[test]
    fn series_score_memo_checks_collisions_and_survives_clear() {
        let mut seen = vec![None; 1 << SCORE_CACHE_BITS];
        let mut collision = None;
        for mut encoded in 0..13_usize.pow(4) {
            let mut series = [0; 4];
            for rank in &mut series {
                *rank = (encoded % 13) as u8;
                encoded /= 13;
            }
            let count: u8 = series.iter().map(|r| VALUES[*r as usize]).sum();
            if count > 31 { continue; }
            let state = State::from_reference(
                &AverageState::new([[0; RANKS]; 2], &series, count, 0, None, None).unwrap(),
            );
            let score = super::super::score_count_for_ranks(&series);
            let key = ((state.0 >> SERIES) as u64) & SCORE_KEY_MASK;
            let index = SeriesScoreMemo::index(key);
            if let Some((other, other_score)) = seen[index] {
                if other_score != score {
                    collision = Some((other, other_score, state, score));
                    break;
                }
            } else {
                seen[index] = Some((state, score));
            }
        }
        let (a, a_score, b, b_score) = collision.expect("find a real score-key collision");
        let mut memo = SeriesScoreMemo::default();
        for _ in 0..3 {
            for (state, score) in [(a, a_score), (b, b_score), (a, a_score)] {
                assert_eq!(memo.score(state), score);
                assert_eq!(memo.score(state), score);
            }
            memo.clear();
        }
        let mut changed_context = a;
        changed_context.set(0, 7, 4);
        changed_context.set(CURRENT, 1, 1);
        changed_context.set(GO, 3, 2);
        changed_context.set(LAST, 3, 1);
        assert_eq!(memo.score(changed_context), a_score);
    }

    #[test]
    fn series_score_memo_keys_length_and_count_and_skips_tiny_sequences() {
        let make = |series: &[u8], count| State::from_reference(
            &AverageState::new([[0; RANKS]; 2], series, count, 0, None, None).unwrap(),
        );
        let mut memo = SeriesScoreMemo::default();
        assert_eq!(memo.score(make(&[4], 5)), 0);
        assert_eq!(memo.score(make(&[4, 4], 10)), 2);
        assert!(memo.entries.is_empty());
        let a = make(&[1, 2, 3], 9);
        // Trailing rank zero leaves the rank bits unchanged; length still matters.
        let mut b = make(&[1, 2, 3, 0], 10);
        b.set(COUNT, 31, 9); // Isolate length: only the active length now differs.
        assert_eq!(memo.score(a), 3);
        assert_eq!(memo.score(b), 4);
        let mut different_count = a;
        different_count.set(COUNT, 31, 15);
        assert_eq!(memo.score(different_count), a.score() + 2);
        assert_eq!(memo.score(a), 3);
    }

    #[test]
    fn wp_checked_entry_and_recursive_series_guard_reject_invalid_plays() {
        let board = BoardWinMatrix::from_function(|_, _, _| 0.5);
        let mut memo = WpMemo::default();
        let mut hands = [[0; RANKS]; 2];
        hands[0][0] = 1;
        let state = AverageState::new(hands, &[], 0, 0, None, None).unwrap();
        for rank in [1, 13, 255] {
            assert_eq!(
                memo.forced_play(&state, [0, 0], Role::Dealer, rank, &board)
                    .unwrap_err(),
                "Model 20.1 WP evaluator selected an absent rank"
            );
        }
        hands[0] = [0; RANKS];
        hands[0][4] = 1;
        let blocked = AverageState::new(hands, &[9, 9, 9], 30, 0, None, Some(1)).unwrap();
        assert_eq!(
            memo.forced_play(&blocked, [0, 0], Role::Dealer, 4, &board)
                .unwrap_err(),
            "Model 20.1 WP evaluator selected an illegal play"
        );
        // An invalid internal caller can supply more cards than a hand permits.
        // Retain the series bound even after a legal root play and a forced go.
        hands[0] = [0; RANKS];
        hands[0][2] = 2;
        let oversized =
            AverageState::new(hands, &[0, 1, 0, 1, 0, 1, 0], 10, 0, None, Some(1)).unwrap();
        assert_eq!(
            memo.forced_play(&oversized, [0, 0], Role::Dealer, 2, &board)
                .unwrap_err(),
            "Model 20.1 WP evaluator selected an illegal play"
        );
    }

    #[test]
    fn collapsed_wp_preserves_zero_bits_cache_and_series_guards() {
        for probability in [-0.0, 0.0, 0.12345678901234567, 1.0] {
            let board = BoardWinMatrix::from_function(|_, _, _| probability);
            for role in [Role::Dealer, Role::Pone] {
                let mut old = WpMemo::default();
                let mut new = WpMemo::default();
                new.collapse_forced_continuations();
                for rank in 0..13 {
                    for count in 1..=4 {
                        let mut hands = [[0; RANKS]; 2];
                        hands[1][rank] = count;
                        for (series, total, go, last) in [
                            (vec![], 0, None, None),
                            (vec![9, 9, 9], 30, None, Some(0)),
                            (vec![0, 1, 0, 1, 0, 1, 0], 10, None, Some(1)),
                        ] {
                            let average =
                                AverageState::new(hands, &series, total, 0, go, last).unwrap();
                            for scores in [[0, 0], [120, 119], [119, 120]] {
                                let state = WpState {
                                    peg: State::from_reference(&average),
                                    scores,
                                    role,
                                };
                                let expected = old.future(state, &board).map(f64::to_bits);
                                assert_eq!(
                                    new.future_collapsed(state, &board).map(f64::to_bits),
                                    expected
                                );
                            }
                        }
                    }
                }
                assert_eq!(new.outcomes.len(), old.outcomes.len());
                assert!(old.outcomes.iter().all(|(key, value)| new
                    .outcomes
                    .get(key)
                    .map(|v| v.to_bits())
                    == Some(value.to_bits())));
                new.clear();
                assert!(new.collapse_forced);
                assert!(new.outcomes.is_empty());
            }
        }
    }

    fn reference_wp(state: &RankPegState, board: &BoardWinMatrix) -> f64 {
        if let Some(winner) = state.winner {
            return f64::from(winner == PegSeat::Zero);
        }
        if state.complete {
            let dealer = state.scores[state.dealer.index()] as u8;
            let pone = state.scores[state.dealer.other().index()] as u8;
            let value = board.dealer_win_probability(BoardMatrixSeam::AfterPegging, dealer, pone);
            return if state.dealer == PegSeat::Zero {
                value
            } else {
                1.0 - value
            };
        }
        let mut total = 0.0;
        let mut mass = 0.0;
        for action in state.legal_actions() {
            let weight = match action {
                crate::information_set::RankPegAction::Go => 1.0,
                crate::information_set::RankPegAction::Play(rank) => {
                    f64::from(state.hands[state.current.index()][rank as usize])
                }
            };
            let mut next = state.clone();
            next.apply(action).unwrap();
            total += weight * reference_wp(&next, board);
            mass += weight;
        }
        total / mass
    }

    #[test]
    fn wp_evaluator_matches_scoring_oracle_and_stops_at_first_winner() {
        // Nonlinear utility detects averaging points before applying WP.
        let board = BoardWinMatrix::from_function(|_, dealer, pone| {
            1.0 / (1.0 + ((f64::from(pone) - f64::from(dealer)) / 7.0).exp())
        });
        let mut seed = 201;
        let mut memo = WpMemo::default();
        let mut prepared_memo = WpMemo::default();
        let mut collapsed_memo = WpMemo::default();
        collapsed_memo.collapse_forced_continuations();
        let mut checked = 0;
        for game in 0..128 {
            let mut deck: Vec<u8> = (0..52).map(|card| card % 13).collect();
            for index in (1..deck.len()).rev() {
                deck.swap(index, next_random(&mut seed) % (index + 1));
            }
            let mut hands = [[0; RANKS]; 2];
            for index in 0..8 {
                hands[index / 4][deck[index] as usize] += 1;
            }
            let mut state = RankPegState {
                hands,
                own_discards: [[0; RANKS]; 2],
                turn_rank: deck[8],
                scores: if game < 64 { [0, 0] } else { [118, 119] },
                dealer: if game % 2 == 0 {
                    PegSeat::Zero
                } else {
                    PegSeat::One
                },
                current: PegSeat::Zero,
                plays: Vec::new(),
                count: 0,
                go_player: None,
                last_player: None,
                history: Vec::new(),
                winner: None,
                complete: false,
            };
            while !state.complete && state.winner.is_none() {
                let average = AverageState::new(
                    state.hands,
                    &state.plays,
                    state.count,
                    state.current.index() as u8,
                    state.go_player.map(|s| s.index() as u8),
                    state.last_player.map(|s| s.index() as u8),
                )
                .unwrap();
                let prepared = State::from_reference(&average);
                for action in state.legal_actions() {
                    let crate::information_set::RankPegAction::Play(rank) = action else {
                        continue;
                    };
                    let mut next = state.clone();
                    next.apply(action).unwrap();
                    let actual = memo
                        .forced_play(
                            &average,
                            [state.scores[0] as u8, state.scores[1] as u8],
                            if state.dealer == PegSeat::Zero {
                                Role::Dealer
                            } else {
                                Role::Pone
                            },
                            rank,
                            &board,
                        )
                        .unwrap();
                    assert_eq!(
                        prepared_memo.forced_play_prepared(
                            prepared,
                            [state.scores[0] as u8, state.scores[1] as u8],
                            if state.dealer == PegSeat::Zero { Role::Dealer } else { Role::Pone },
                            rank,
                            &board,
                        ).unwrap().to_bits(),
                        actual.to_bits(),
                    );
                    assert_eq!(collapsed_memo.forced_play_prepared(
                        prepared, [state.scores[0] as u8, state.scores[1] as u8],
                        if state.dealer == PegSeat::Zero { Role::Dealer } else { Role::Pone },
                        rank, &board,
                    ).unwrap().to_bits(), actual.to_bits());
                    assert!(
                        (actual - reference_wp(&next, &board)).abs() < 1e-12,
                        "state={state:?} action={action:?}"
                    );
                    checked += 1;
                }
                let legal = state.legal_actions();
                state
                    .apply(legal[next_random(&mut seed) % legal.len()])
                    .unwrap();
            }
        }
        assert!(checked > 200);
    }

    fn bits(value: WeightedPoints) -> [u64; 3] {
        [
            value.points[0].to_bits(),
            value.points[1].to_bits(),
            value.weight.to_bits(),
        ]
    }
    fn next_random(seed: &mut u64) -> usize {
        *seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (*seed >> 32) as usize
    }

    #[test]
    fn compact_continuations_match_reference_bit_for_bit_through_complete_games() {
        let mut seed = 1323;
        let mut checked = 0;
        for _ in 0..64 {
            let mut deck: Vec<u8> = (0..52).map(|card| card % 13).collect();
            for i in (1..deck.len()).rev() {
                deck.swap(i, next_random(&mut seed) % (i + 1));
            }
            let mut hands = [[0; RANKS]; 2];
            for i in 0..8 {
                hands[i / 4][deck[i] as usize] += 1;
            }
            let mut game = RankPegState {
                hands,
                own_discards: [[0; RANKS]; 2],
                turn_rank: 0,
                scores: [0; 2],
                dealer: PegSeat::One,
                current: PegSeat::Zero,
                plays: Vec::new(),
                count: 0,
                go_player: None,
                last_player: None,
                history: Vec::new(),
                winner: None,
                complete: false,
            };
            let mut reference = HashMap::new();
            let mut compact = Memo::default();
            while !game.complete && game.winner.is_none() {
                let state = AverageState::new(
                    game.hands,
                    &game.plays,
                    game.count,
                    game.current.index() as u8,
                    game.go_player.map(|p| p.index() as u8),
                    game.last_player.map(|p| p.index() as u8),
                )
                .unwrap();
                let expected =
                    super::super::average_future(&state, &mut reference, &mut 0).unwrap();
                let actual = compact
                    .future(State::from_reference(&state), &mut 0)
                    .unwrap();
                assert_eq!(bits(actual), bits(expected), "state={state:?}");
                for action in game.legal_actions() {
                    if let crate::information_set::RankPegAction::Play(rank) = action {
                        assert_eq!(
                            bits(compact.forced_play(&state, rank, &mut 0).unwrap()),
                            bits(
                                super::super::average_forced_play(
                                    &state,
                                    rank,
                                    &mut reference,
                                    &mut 0
                                )
                                .unwrap()
                            )
                        );
                    }
                }
                checked += 1;
                let legal = game.legal_actions();
                game.apply(legal[next_random(&mut seed) % legal.len()])
                    .unwrap();
            }
        }
        assert!(checked >= 512);
    }

    #[test]
    fn compact_key_keeps_every_active_field_and_ignores_only_inactive_bytes() {
        let mut original =
            AverageState::new([[0; RANKS]; 2], &[0, 4], 6, 0, None, Some(1)).unwrap();
        let expected = State::from_reference(&original);
        original.plays[7] = 12;
        assert_eq!(State::from_reference(&original), expected);
        for field in 0..31 {
            let mut changed = original;
            match field {
                0..=25 => changed.hands[field / 13][field % 13] = 1,
                26 => changed.plays[0] = 1,
                27 => changed.plays_len = 1,
                28 => changed.count = 7,
                29 => changed.current = 1,
                _ => changed.go_player = Some(0),
            }
            assert_ne!(State::from_reference(&changed), expected);
        }
        original.last_player = None;
        assert_ne!(State::from_reference(&original), expected);
    }

    #[test]
    fn compact_scoring_matches_reference_for_all_legal_series_up_to_five_cards() {
        fn visit(series: &mut Vec<u8>, count: u8, memo: &mut SeriesScoreMemo) {
            let state = AverageState::new([[0; RANKS]; 2], series, count, 0, None, None).unwrap();
            assert_eq!(
                State::from_reference(&state).score(),
                super::super::score_count_for_ranks(series)
            );
            let packed = State::from_reference(&state);
            let expected = super::super::score_count_for_ranks(series);
            assert_eq!(memo.score(packed), expected);
            assert_eq!(memo.score(packed), expected);
            if series.len() == 5 {
                return;
            }
            for rank in 0..RANKS as u8 {
                if count + VALUES[rank as usize] <= 31
                    && series.iter().filter(|r| **r == rank).count() < 4
                {
                    series.push(rank);
                    visit(series, count + VALUES[rank as usize], memo);
                    series.pop();
                }
            }
        }
        let mut memo = SeriesScoreMemo::default();
        visit(&mut Vec::new(), 0, &mut memo);
        for series in [
            vec![0, 1, 2, 3, 4, 5, 6],
            vec![6, 5, 4, 3, 2, 1, 0],
            vec![0, 0, 1, 2, 3, 4, 5, 6],
            vec![0, 1, 0, 1, 0, 1, 0, 1],
            vec![0, 0, 0, 0, 1, 1, 1, 1],
        ] {
            let count = series.iter().map(|rank| VALUES[*rank as usize]).sum();
            let state = AverageState::new([[0; RANKS]; 2], &series, count, 0, None, None).unwrap();
            assert_eq!(
                State::from_reference(&state).score(),
                super::super::score_count_for_ranks(&series)
            );
            let expected = super::super::score_count_for_ranks(&series);
            assert_eq!(memo.score(State::from_reference(&state)), expected);
            assert_eq!(memo.score(State::from_reference(&state)), expected);
        }
    }
}

#[cfg(test)]
mod wp_key_tests {
    use super::*;

    #[test]
    fn wp_key_hash_distributes_board_scores_across_buckets() {
        // Same remaining hands can recur at many board scores. Appending scores
        // without mixing them into the low hash bits puts them in one probe chain.
        for role in [Role::Dealer, Role::Pone] {
            let mut buckets = std::collections::HashSet::new();
            let mut fingerprints = std::collections::HashSet::new();
            for ours in 0..9 {
                for theirs in 0..9 {
                    let state = WpState {
                        peg: State((1 << 0) | (1 << 3) | (1 << 6) | (1 << 39) | (1 << 42)),
                        scores: [ours, theirs],
                        role,
                    };
                    let mut hasher = StateHasher::default();
                    WpKey::from(state).hash(&mut hasher);
                    let hash = hasher.finish();
                    buckets.insert(hash & ((1 << 19) - 1));
                    fingerprints.insert(hash >> 57);
                }
            }
            assert!(
                buckets.len() >= 64,
                "only {} initial buckets",
                buckets.len()
            );
            assert!(
                fingerprints.len() >= 16,
                "only {} fingerprints",
                fingerprints.len()
            );
        }
    }

    #[test]
    fn wp_key_retains_all_fields_under_hash_collisions_without_alignment_padding() {
        #[derive(Default)]
        struct CollisionHasher;
        impl Hasher for CollisionHasher {
            fn finish(&self) -> u64 {
                0
            }
            fn write(&mut self, _: &[u8]) {}
        }
        assert_eq!(std::mem::size_of::<(WpKey, f64)>(), 32);
        assert_eq!(std::mem::size_of::<(WpState, f64)>(), 48);
        let states = std::iter::once(0)
            .chain((0..128).map(|bit| 1_u128 << bit))
            .chain(std::iter::once(u128::MAX));
        let mut score_cases = vec![[0, 0], [120, 119], [119, 120], [255, 255]];
        for bit in 0..8 {
            score_cases.push([1_u8 << bit, 0]);
            score_cases.push([0, 1_u8 << bit]);
        }
        let mut outcomes = HashMap::<WpKey, usize, BuildHasherDefault<CollisionHasher>>::default();
        let mut cases = Vec::new();
        for peg in states {
            for scores in &score_cases {
                for role in [Role::Dealer, Role::Pone] {
                    let state = WpState {
                        peg: State(peg),
                        scores: *scores,
                        role,
                    };
                    let value = cases.len();
                    assert_eq!(outcomes.insert(WpKey::from(state), value), None);
                    cases.push(state);
                }
            }
        }
        assert_eq!(outcomes.len(), cases.len());
        for (value, state) in cases.into_iter().enumerate() {
            assert_eq!(outcomes.get(&WpKey::from(state)), Some(&value));
        }
    }
}
