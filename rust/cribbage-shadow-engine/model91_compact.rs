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
struct State(u128);

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
    fn from_reference(state: &AverageState) -> Self {
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
    fn rank(self, index: usize) -> u8 {
        self.field(SERIES + index as u32 * 4, 15)
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
        let mut points = if matches!(self.count(), 15 | 31) {
            2
        } else {
            0
        };
        let last = self.rank(len - 1);
        let same = 1
            + (0..len - 1)
                .rev()
                .take_while(|i| self.rank(*i) == last)
                .count();
        points += match same {
            2 => 2,
            3 => 6,
            4 => 12,
            _ => 0,
        };
        let mut seen = 0_u16;
        let mut min = 13;
        let mut max = 0;
        let mut run = 0;
        for length in 1..=len {
            let rank = self.rank(len - length);
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

#[derive(Default)]
pub(super) struct WpMemo {
    outcomes: HashMap<WpState, f64, BuildHasherDefault<StateHasher>>,
}

impl WpMemo {
    pub(super) fn clear(&mut self) {
        self.outcomes.clear();
    }

    pub(super) fn forced_play(
        &mut self,
        state: &AverageState,
        scores: [u8; 2],
        role: Role,
        rank: u8,
        board: &BoardWinMatrix,
    ) -> Result<f64, String> {
        self.play(
            WpState {
                peg: State::from_reference(state),
                scores,
                role,
            },
            rank,
            board,
        )
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
        if let Some(value) = self.outcomes.get(&state) {
            return Ok(*value);
        }
        let mut weighted = 0.0;
        let mut copies = 0_u8;
        for rank in 0..RANKS as u8 {
            let count = state.peg.copies(state.peg.current(), rank);
            if count == 0 || state.peg.count() + VALUES[rank as usize] > 31 {
                continue;
            }
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
        if self.outcomes.len() >= 1_000_000 {
            self.outcomes.clear();
        }
        self.outcomes.insert(state, value);
        Ok(value)
    }

    fn play(&mut self, state: WpState, rank: u8, board: &BoardWinMatrix) -> Result<f64, String> {
        let current = state.peg.current();
        if rank >= RANKS as u8 || state.peg.copies(current, rank) == 0 {
            return Err("Model 20.1 WP evaluator selected an absent rank".into());
        }
        let count = state.peg.count() + VALUES[rank as usize];
        if count > 31 || state.peg.len() >= MAX_SERIES {
            return Err("Model 20.1 WP evaluator selected an illegal play".into());
        }
        let mut next = state;
        next.peg.0 -= 1_u128 << (u32::from(current) * HAND_BITS + u32::from(rank) * 3);
        next.peg.set(SERIES + state.peg.len() as u32 * 4, 15, rank);
        next.peg.set(LENGTH, 15, state.peg.len() as u8 + 1);
        next.peg.set(COUNT, 31, count);
        next.scores[current as usize] += next.peg.score();
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::information_set::{PegSeat, RankPegState};

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
        let mut checked = 0;
        for game in 0..32 {
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
                scores: if game < 16 { [0, 0] } else { [118, 119] },
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
        fn visit(series: &mut Vec<u8>, count: u8) {
            let state = AverageState::new([[0; RANKS]; 2], series, count, 0, None, None).unwrap();
            assert_eq!(
                State::from_reference(&state).score(),
                super::super::score_count_for_ranks(series)
            );
            if series.len() == 5 {
                return;
            }
            for rank in 0..RANKS as u8 {
                if count + VALUES[rank as usize] <= 31
                    && series.iter().filter(|r| **r == rank).count() < 4
                {
                    series.push(rank);
                    visit(series, count + VALUES[rank as usize]);
                    series.pop();
                }
            }
        }
        visit(&mut Vec::new(), 0);
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
        }
    }
}
