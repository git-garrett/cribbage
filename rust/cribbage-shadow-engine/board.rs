use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use crate::board_matrix::{BoardMatrixSeam, BoardWinMatrix};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Role {
    Dealer,
    Pone,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ScorePhase {
    PeggingPone,
    PeggingDealer,
    HandPone,
    HandDealer,
    Crib,
}

#[derive(Clone, Copy)]
struct PhaseStats {
    average: f64,
    standard_deviation: f64,
    min: f64,
    max: f64,
}

#[derive(Clone, Copy)]
struct CycleFastPathCutoffs {
    pone: u8,
    dealer: u8,
}

const CYCLE_FAST_PATH_QUANTILE: f64 = 0.999;
const ZERO_DISTRIBUTION: [(u8, f64); 1] = [(0, 1.0)];
const SCORE_STATES: usize = 122;
const ROLE_STATES: usize = 2;
const PHASE_STATES: usize = 5;
const BOARD_MEMO_SIZE: usize = SCORE_STATES * SCORE_STATES * ROLE_STATES * PHASE_STATES;

struct BoardDistributions {
    pegging_pone: Vec<(u8, f64)>,
    pegging_dealer: Vec<(u8, f64)>,
    hand_pone: Vec<(u8, f64)>,
    hand_dealer: Vec<(u8, f64)>,
    crib: Vec<(u8, f64)>,
    cycle_delta_pone: Vec<((u8, u8), f64)>,
    cycle_delta_dealer: Vec<((u8, u8), f64)>,
    cycle_fast_path_cutoffs: CycleFastPathCutoffs,
    max_pegging_pone: u8,
    max_pegging_dealer: u8,
}

impl BoardDistributions {
    fn standard() -> &'static BoardDistributions {
        static STANDARD: OnceLock<BoardDistributions> = OnceLock::new();
        STANDARD.get_or_init(|| {
            let mut distributions = HashMap::new();
            for phase in [
                ScorePhase::PeggingPone,
                ScorePhase::PeggingDealer,
                ScorePhase::HandPone,
                ScorePhase::HandDealer,
                ScorePhase::Crib,
            ] {
                distributions.insert(phase, score_phase_distribution(phase_stats(phase)));
            }
            BoardDistributions::from_phase_map(distributions)
        })
    }

    fn from_phase_map(distributions: HashMap<ScorePhase, Vec<(u8, f64)>>) -> BoardDistributions {
        let cycle_fast_path_cutoffs =
            cycle_fast_path_cutoffs(&distributions, CYCLE_FAST_PATH_QUANTILE);
        let cycle_delta_pone = build_cycle_delta_distribution(&distributions, Role::Pone);
        let cycle_delta_dealer = build_cycle_delta_distribution(&distributions, Role::Dealer);
        let pegging_pone = distributions
            .get(&ScorePhase::PeggingPone)
            .cloned()
            .unwrap_or_else(|| ZERO_DISTRIBUTION.to_vec());
        let pegging_dealer = distributions
            .get(&ScorePhase::PeggingDealer)
            .cloned()
            .unwrap_or_else(|| ZERO_DISTRIBUTION.to_vec());
        let hand_pone = distributions
            .get(&ScorePhase::HandPone)
            .cloned()
            .unwrap_or_else(|| ZERO_DISTRIBUTION.to_vec());
        let hand_dealer = distributions
            .get(&ScorePhase::HandDealer)
            .cloned()
            .unwrap_or_else(|| ZERO_DISTRIBUTION.to_vec());
        let crib = distributions
            .get(&ScorePhase::Crib)
            .cloned()
            .unwrap_or_else(|| ZERO_DISTRIBUTION.to_vec());
        let max_pegging_pone = max_distribution_points(&pegging_pone);
        let max_pegging_dealer = max_distribution_points(&pegging_dealer);
        BoardDistributions {
            pegging_pone,
            pegging_dealer,
            hand_pone,
            hand_dealer,
            crib,
            cycle_delta_pone,
            cycle_delta_dealer,
            cycle_fast_path_cutoffs,
            max_pegging_pone,
            max_pegging_dealer,
        }
    }

    fn distribution(&'static self, phase: ScorePhase) -> &'static [(u8, f64)] {
        match phase {
            ScorePhase::PeggingPone => &self.pegging_pone,
            ScorePhase::PeggingDealer => &self.pegging_dealer,
            ScorePhase::HandPone => &self.hand_pone,
            ScorePhase::HandDealer => &self.hand_dealer,
            ScorePhase::Crib => &self.crib,
        }
    }

    fn cycle_delta_distribution(&'static self, role: Role) -> &'static [((u8, u8), f64)] {
        match role {
            Role::Pone => &self.cycle_delta_pone,
            Role::Dealer => &self.cycle_delta_dealer,
        }
    }
}

pub struct BoardModel {
    distributions: &'static BoardDistributions,
    memo: BoardMemo,
    board_matrix: Option<Arc<BoardWinMatrix>>,
    use_heuristic_before_90: bool,
    joint_future_pegging: bool,
    joint_only_when_terminal_ambiguity_possible: bool,
}

struct BoardMemo {
    values: Vec<f64>,
}

impl BoardMemo {
    fn new() -> BoardMemo {
        BoardMemo {
            values: vec![f64::NAN; BOARD_MEMO_SIZE],
        }
    }

    fn get(&self, my: u8, opponent: u8, role: Role, phase: ScorePhase) -> Option<f64> {
        let value = self.values[board_memo_index(my, opponent, role, phase)];
        if value.is_nan() {
            None
        } else {
            Some(value)
        }
    }

    fn set(&mut self, my: u8, opponent: u8, role: Role, phase: ScorePhase, value: f64) {
        let index = board_memo_index(my, opponent, role, phase);
        self.values[index] = value;
    }
}

fn board_memo_index(my: u8, opponent: u8, role: Role, phase: ScorePhase) -> usize {
    ((((my as usize) * SCORE_STATES + opponent as usize) * ROLE_STATES + role_index(role))
        * PHASE_STATES)
        + score_phase_index(phase)
}

fn role_index(role: Role) -> usize {
    match role {
        Role::Pone => 0,
        Role::Dealer => 1,
    }
}

fn score_phase_index(phase: ScorePhase) -> usize {
    match phase {
        ScorePhase::PeggingPone => 0,
        ScorePhase::PeggingDealer => 1,
        ScorePhase::HandPone => 2,
        ScorePhase::HandDealer => 3,
        ScorePhase::Crib => 4,
    }
}

impl BoardModel {
    pub fn new() -> BoardModel {
        BoardModel::with_options(true, false, false)
    }

    pub fn without_early_heuristic() -> BoardModel {
        BoardModel::with_options(false, false, false)
    }

    pub fn joint_pegging_without_early_heuristic() -> BoardModel {
        BoardModel::with_options(false, true, false)
    }

    pub fn exact_joint_pegging_without_early_heuristic() -> BoardModel {
        BoardModel::with_options(false, true, true)
    }

    /// Use empirical continuation values at the four supported phase seams.
    pub fn from_board_matrix(board_matrix: Arc<BoardWinMatrix>) -> BoardModel {
        let mut board = BoardModel::with_options(false, false, false);
        board.board_matrix = Some(board_matrix);
        board
    }

    pub fn matrix_win_probability_from_scores(
        &self,
        my_score: i32,
        opponent_score: i32,
        perspective_role: Role,
        seam: BoardMatrixSeam,
    ) -> Option<f64> {
        if my_score >= 121 {
            return Some(1.0);
        }
        if opponent_score >= 121 {
            return Some(0.0);
        }
        let my = my_score.clamp(0, 120) as u8;
        let opponent = opponent_score.clamp(0, 120) as u8;
        self.board_matrix
            .as_ref()
            .map(|matrix| match perspective_role {
                Role::Dealer => matrix.dealer_win_probability(seam, my, opponent),
                Role::Pone => 1.0 - matrix.dealer_win_probability(seam, opponent, my),
            })
    }

    fn with_options(
        use_heuristic_before_90: bool,
        joint_future_pegging: bool,
        joint_only_when_terminal_ambiguity_possible: bool,
    ) -> BoardModel {
        BoardModel {
            distributions: BoardDistributions::standard(),
            memo: BoardMemo::new(),
            board_matrix: None,
            use_heuristic_before_90,
            joint_future_pegging,
            joint_only_when_terminal_ambiguity_possible,
        }
    }

    #[allow(dead_code)]
    pub fn future_win_probability(
        &mut self,
        my_score: f64,
        opponent_score: f64,
        perspective_role: Role,
        phase: ScorePhase,
    ) -> f64 {
        let my = my_score.round().clamp(0.0, 121.0) as u8;
        let opponent = opponent_score.round().clamp(0.0, 121.0) as u8;
        self.future_win_probability_u8(my, opponent, perspective_role, phase)
    }

    pub fn future_win_probability_from_scores(
        &mut self,
        my_score: i32,
        opponent_score: i32,
        perspective_role: Role,
        phase: ScorePhase,
    ) -> f64 {
        let my = my_score.clamp(0, 121) as u8;
        let opponent = opponent_score.clamp(0, 121) as u8;
        self.future_win_probability_u8(my, opponent, perspective_role, phase)
    }

    fn future_win_probability_u8(
        &mut self,
        my: u8,
        opponent: u8,
        perspective_role: Role,
        phase: ScorePhase,
    ) -> f64 {
        if my >= 121 {
            return 1.0;
        }
        if opponent >= 121 {
            return 0.0;
        }
        let seam = match phase {
            ScorePhase::PeggingPone => Some(BoardMatrixSeam::Discard),
            ScorePhase::HandPone => Some(BoardMatrixSeam::AfterPegging),
            ScorePhase::HandDealer => Some(BoardMatrixSeam::AfterPone),
            ScorePhase::PeggingDealer | ScorePhase::Crib => None,
        };
        if let Some(probability) = seam.and_then(|seam| {
            self.matrix_win_probability_from_scores(
                i32::from(my),
                i32::from(opponent),
                perspective_role,
                seam,
            )
        }) {
            return probability;
        }
        if self.use_heuristic_before_90 && my < 90 && opponent < 90 {
            return heuristic_win_probability(my as f64, opponent as f64, perspective_role);
        }
        if let Some(value) = self.memo.get(my, opponent, perspective_role, phase) {
            return value;
        }
        self.memo.set(my, opponent, perspective_role, phase, 0.5);

        if self.joint_future_pegging
            && phase == ScorePhase::PeggingPone
            && (!self.joint_only_when_terminal_ambiguity_possible
                || self.joint_pegging_terminal_ambiguity_possible(my, opponent, perspective_role))
        {
            let probability = if self.joint_only_when_terminal_ambiguity_possible {
                self.future_joint_pegging_win_probability(my, opponent, perspective_role)
            } else if self.cycle_fast_path_allowed(my, opponent, perspective_role) {
                self.future_cycle_win_probability(my, opponent, perspective_role)
            } else {
                self.future_joint_pegging_win_probability(my, opponent, perspective_role)
            };
            self.memo
                .set(my, opponent, perspective_role, phase, probability);
            return probability;
        }

        let scorer_role = match phase {
            ScorePhase::PeggingPone | ScorePhase::HandPone => Role::Pone,
            ScorePhase::PeggingDealer | ScorePhase::HandDealer | ScorePhase::Crib => Role::Dealer,
        };
        let perspective_scores = perspective_role == scorer_role;
        let distribution = self.distributions.distribution(phase);
        let mut probability = 0.0;
        for (points, weight) in distribution {
            if perspective_scores {
                let next_my = my.saturating_add(*points);
                probability += *weight
                    * if next_my >= 121 {
                        1.0
                    } else {
                        self.future_win_probability_u8(
                            next_my,
                            opponent,
                            next_perspective_role(perspective_role, phase),
                            next_score_phase(phase),
                        )
                    };
            } else {
                let next_opponent = opponent.saturating_add(*points);
                probability += *weight
                    * if next_opponent >= 121 {
                        0.0
                    } else {
                        self.future_win_probability_u8(
                            my,
                            next_opponent,
                            next_perspective_role(perspective_role, phase),
                            next_score_phase(phase),
                        )
                    };
            }
        }
        self.memo
            .set(my, opponent, perspective_role, phase, probability);
        probability
    }

    fn future_cycle_win_probability(
        &mut self,
        my: u8,
        opponent: u8,
        perspective_role: Role,
    ) -> f64 {
        let next_role = next_perspective_role(perspective_role, ScorePhase::Crib);
        let deltas = self
            .distributions
            .cycle_delta_distribution(perspective_role);
        if !self.cycle_fast_path_allowed(my, opponent, next_role) {
            let mut probability = 0.0;
            for ((my_delta, opponent_delta), weight) in deltas {
                probability += *weight
                    * self.future_win_probability_u8(
                        my + *my_delta,
                        opponent + *opponent_delta,
                        next_role,
                        ScorePhase::PeggingPone,
                    );
            }
            return probability;
        }

        let paired_deltas = self.distributions.cycle_delta_distribution(next_role);
        let (base, zero_cycle_weight) =
            self.cycle_delta_continuation_value(deltas, my, opponent, next_role);
        let (paired_base, paired_zero_cycle_weight) =
            self.cycle_delta_continuation_value(paired_deltas, my, opponent, perspective_role);
        let denominator = 1.0 - (zero_cycle_weight * paired_zero_cycle_weight);
        if denominator.abs() < 1e-12 {
            self.memo
                .set(my, opponent, next_role, ScorePhase::PeggingPone, 0.5);
            return 0.5;
        }
        let probability = (base + zero_cycle_weight * paired_base) / denominator;
        let paired_probability = (paired_base + paired_zero_cycle_weight * base) / denominator;
        self.memo.set(
            my,
            opponent,
            next_role,
            ScorePhase::PeggingPone,
            paired_probability,
        );
        probability
    }

    fn cycle_delta_continuation_value(
        &mut self,
        deltas: &[((u8, u8), f64)],
        origin_my: u8,
        origin_opponent: u8,
        next_role: Role,
    ) -> (f64, f64) {
        let mut value = 0.0;
        let mut zero_cycle_weight = 0.0;
        for ((my_delta, opponent_delta), weight) in deltas {
            if *my_delta == 0 && *opponent_delta == 0 {
                zero_cycle_weight += *weight;
                continue;
            }
            value += *weight
                * self.future_win_probability_u8(
                    origin_my + *my_delta,
                    origin_opponent + *opponent_delta,
                    next_role,
                    ScorePhase::PeggingPone,
                );
        }
        (value, zero_cycle_weight)
    }

    fn future_joint_pegging_win_probability(
        &mut self,
        my: u8,
        opponent: u8,
        perspective_role: Role,
    ) -> f64 {
        let pone_distribution = self.distributions.distribution(ScorePhase::PeggingPone);
        let dealer_distribution = self.distributions.distribution(ScorePhase::PeggingDealer);
        let mut probability = 0.0;
        for (pone_points, pone_weight) in pone_distribution {
            for (dealer_points, dealer_weight) in dealer_distribution {
                let weight = *pone_weight * *dealer_weight;
                let (next_my, next_opponent) = if perspective_role == Role::Pone {
                    (
                        my.saturating_add(*pone_points),
                        opponent.saturating_add(*dealer_points),
                    )
                } else {
                    (
                        my.saturating_add(*dealer_points),
                        opponent.saturating_add(*pone_points),
                    )
                };
                let my_out = next_my >= 121;
                let opponent_out = next_opponent >= 121;
                probability += weight
                    * match (my_out, opponent_out) {
                        (true, true) => 0.5,
                        (true, false) => 1.0,
                        (false, true) => 0.0,
                        (false, false) => self.future_win_probability_u8(
                            next_my,
                            next_opponent,
                            perspective_role,
                            ScorePhase::HandPone,
                        ),
                    };
            }
        }
        probability
    }

    fn cycle_fast_path_allowed(&self, my: u8, opponent: u8, perspective_role: Role) -> bool {
        let (my_cutoff, opponent_cutoff) = if perspective_role == Role::Pone {
            (
                self.distributions.cycle_fast_path_cutoffs.pone,
                self.distributions.cycle_fast_path_cutoffs.dealer,
            )
        } else {
            (
                self.distributions.cycle_fast_path_cutoffs.dealer,
                self.distributions.cycle_fast_path_cutoffs.pone,
            )
        };
        (my as u16) + (my_cutoff as u16) < 121 && (opponent as u16) + (opponent_cutoff as u16) < 121
    }

    fn joint_pegging_terminal_ambiguity_possible(
        &self,
        my: u8,
        opponent: u8,
        perspective_role: Role,
    ) -> bool {
        let pone_max = self.distributions.max_pegging_pone;
        let dealer_max = self.distributions.max_pegging_dealer;
        let (my_max, opponent_max) = if perspective_role == Role::Pone {
            (pone_max, dealer_max)
        } else {
            (dealer_max, pone_max)
        };
        (my as u16) + (my_max as u16) >= 121 && (opponent as u16) + (opponent_max as u16) >= 121
    }
}

fn build_cycle_delta_distribution(
    distributions: &HashMap<ScorePhase, Vec<(u8, f64)>>,
    perspective_role: Role,
) -> Vec<((u8, u8), f64)> {
    let mut states = HashMap::new();
    add_cycle_state(&mut states, (0, 0), 1.0);
    states = apply_cycle_joint_pegging_delta(
        states,
        distribution_or_zero(distributions, ScorePhase::PeggingPone),
        distribution_or_zero(distributions, ScorePhase::PeggingDealer),
        perspective_role,
    );
    states = apply_cycle_delta_phase(
        states,
        distribution_or_zero(distributions, ScorePhase::HandPone),
        perspective_role == Role::Pone,
    );
    states = apply_cycle_delta_phase(
        states,
        distribution_or_zero(distributions, ScorePhase::HandDealer),
        perspective_role == Role::Dealer,
    );
    states = apply_cycle_delta_phase(
        states,
        distribution_or_zero(distributions, ScorePhase::Crib),
        perspective_role == Role::Dealer,
    );
    states.into_iter().collect()
}

fn max_distribution_points(distribution: &[(u8, f64)]) -> u8 {
    distribution
        .iter()
        .map(|(points, _)| *points)
        .max()
        .unwrap_or(0)
}

fn apply_cycle_joint_pegging_delta(
    states: HashMap<(u8, u8), f64>,
    pone_distribution: &[(u8, f64)],
    dealer_distribution: &[(u8, f64)],
    perspective_role: Role,
) -> HashMap<(u8, u8), f64> {
    let mut next_states = HashMap::new();
    for ((my, opponent), state_weight) in states {
        for (pone_points, pone_weight) in pone_distribution {
            for (dealer_points, dealer_weight) in dealer_distribution {
                let weight = state_weight * *pone_weight * *dealer_weight;
                let (my_delta, opponent_delta) = if perspective_role == Role::Pone {
                    (*pone_points, *dealer_points)
                } else {
                    (*dealer_points, *pone_points)
                };
                add_cycle_state(
                    &mut next_states,
                    (my + my_delta, opponent + opponent_delta),
                    weight,
                );
            }
        }
    }
    next_states
}

fn apply_cycle_delta_phase(
    states: HashMap<(u8, u8), f64>,
    distribution: &[(u8, f64)],
    perspective_scores: bool,
) -> HashMap<(u8, u8), f64> {
    let mut next_states = HashMap::new();
    for ((my, opponent), state_weight) in states {
        for (points, phase_weight) in distribution {
            let weight = state_weight * *phase_weight;
            if perspective_scores {
                add_cycle_state(&mut next_states, (my + *points, opponent), weight);
            } else {
                add_cycle_state(&mut next_states, (my, opponent + *points), weight);
            }
        }
    }
    next_states
}

fn add_cycle_state(states: &mut HashMap<(u8, u8), f64>, key: (u8, u8), weight: f64) {
    *states.entry(key).or_insert(0.0) += weight;
}

fn cycle_fast_path_cutoffs(
    distributions: &HashMap<ScorePhase, Vec<(u8, f64)>>,
    quantile: f64,
) -> CycleFastPathCutoffs {
    let pone = percentile_points(
        &convolve_score_distributions(
            distribution_or_zero(distributions, ScorePhase::PeggingPone),
            distribution_or_zero(distributions, ScorePhase::HandPone),
        ),
        quantile,
    );
    let dealer = percentile_points(
        &convolve_score_distributions(
            &convolve_score_distributions(
                distribution_or_zero(distributions, ScorePhase::PeggingDealer),
                distribution_or_zero(distributions, ScorePhase::HandDealer),
            ),
            distribution_or_zero(distributions, ScorePhase::Crib),
        ),
        quantile,
    );
    CycleFastPathCutoffs { pone, dealer }
}

fn distribution_or_zero(
    distributions: &HashMap<ScorePhase, Vec<(u8, f64)>>,
    phase: ScorePhase,
) -> &[(u8, f64)] {
    distributions
        .get(&phase)
        .map(Vec::as_slice)
        .unwrap_or(&ZERO_DISTRIBUTION)
}

fn convolve_score_distributions(left: &[(u8, f64)], right: &[(u8, f64)]) -> Vec<(u8, f64)> {
    let mut states = HashMap::new();
    for (left_points, left_weight) in left {
        for (right_points, right_weight) in right {
            *states.entry(*left_points + *right_points).or_insert(0.0) +=
                *left_weight * *right_weight;
        }
    }
    let mut distribution = states.into_iter().collect::<Vec<_>>();
    distribution.sort_by_key(|(points, _)| *points);
    distribution
}

fn percentile_points(distribution: &[(u8, f64)], quantile: f64) -> u8 {
    let target = quantile.clamp(0.0, 1.0);
    let mut cumulative = 0.0;
    for (points, weight) in distribution {
        cumulative += *weight;
        if cumulative >= target {
            return *points;
        }
    }
    distribution
        .iter()
        .map(|(points, _)| *points)
        .max()
        .unwrap_or(0)
}

pub fn next_score_phase(phase: ScorePhase) -> ScorePhase {
    match phase {
        ScorePhase::PeggingPone => ScorePhase::PeggingDealer,
        ScorePhase::PeggingDealer => ScorePhase::HandPone,
        ScorePhase::HandPone => ScorePhase::HandDealer,
        ScorePhase::HandDealer => ScorePhase::Crib,
        ScorePhase::Crib => ScorePhase::PeggingPone,
    }
}

pub fn next_perspective_role(role: Role, phase: ScorePhase) -> Role {
    if phase != ScorePhase::Crib {
        return role;
    }
    match role {
        Role::Dealer => Role::Pone,
        Role::Pone => Role::Dealer,
    }
}

pub fn score_phase_average(phase: ScorePhase) -> f64 {
    phase_stats(phase).average
}

pub fn score_phase_distribution_for_phase(phase: ScorePhase) -> Vec<(i32, f64)> {
    score_phase_distribution(phase_stats(phase))
        .into_iter()
        .map(|(score, weight)| (i32::from(score), weight))
        .collect()
}

fn heuristic_win_probability(my_score: f64, opponent_score: f64, perspective_role: Role) -> f64 {
    let role_bonus = match perspective_role {
        Role::Dealer => 2.4,
        Role::Pone => -1.2,
    };
    let score_edge = my_score - opponent_score + role_bonus;
    (0.5 + score_edge / 80.0).clamp(0.02, 0.98)
}

fn score_phase_distribution(stats: PhaseStats) -> Vec<(u8, f64)> {
    let min = stats.min.floor().max(0.0) as i32;
    let max = stats.max.ceil().max(min as f64) as i32;
    if stats.standard_deviation <= 0.0 {
        return vec![(stats.average.round() as u8, 1.0)];
    }
    let mut values = Vec::new();
    let mut total = 0.0;
    for points in min..=max {
        let low = points as f64 - 0.5;
        let high = points as f64 + 0.5;
        let probability = normal_cdf(high, stats.average, stats.standard_deviation)
            - normal_cdf(low, stats.average, stats.standard_deviation);
        if probability > 0.0 {
            values.push((points as u8, probability));
            total += probability;
        }
    }
    if total > 0.0 {
        for (_, probability) in values.iter_mut() {
            *probability /= total;
        }
    }
    values
}

fn normal_cdf(value: f64, mean_value: f64, standard_deviation: f64) -> f64 {
    0.5 * (1.0 + erf((value - mean_value) / (standard_deviation * std::f64::consts::SQRT_2)))
}

fn erf(value: f64) -> f64 {
    let sign = if value < 0.0 { -1.0 } else { 1.0 };
    let x = value.abs();
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;
    let p = 0.3275911;
    let t = 1.0 / (1.0 + p * x);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * (-x * x).exp();
    sign * y
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_board_with_joint_pegging(pone_points: u8, dealer_points: u8) -> BoardModel {
        test_board_with_cycle(pone_points, dealer_points, 0, 0, 0, false)
    }

    fn test_board_with_exact_joint_pegging(pone_points: u8, dealer_points: u8) -> BoardModel {
        test_board_with_cycle(pone_points, dealer_points, 0, 0, 0, true)
    }

    fn test_board_with_cycle(
        pone_pegging: u8,
        dealer_pegging: u8,
        pone_hand: u8,
        dealer_hand: u8,
        crib: u8,
        joint_only_when_terminal_ambiguity_possible: bool,
    ) -> BoardModel {
        let mut distributions = HashMap::new();
        distributions.insert(ScorePhase::PeggingPone, vec![(pone_pegging, 1.0)]);
        distributions.insert(ScorePhase::PeggingDealer, vec![(dealer_pegging, 1.0)]);
        distributions.insert(ScorePhase::HandPone, vec![(pone_hand, 1.0)]);
        distributions.insert(ScorePhase::HandDealer, vec![(dealer_hand, 1.0)]);
        distributions.insert(ScorePhase::Crib, vec![(crib, 1.0)]);
        BoardModel {
            distributions: Box::leak(Box::new(BoardDistributions::from_phase_map(distributions))),
            memo: BoardMemo::new(),
            board_matrix: None,
            use_heuristic_before_90: false,
            joint_future_pegging: true,
            joint_only_when_terminal_ambiguity_possible,
        }
    }

    #[test]
    fn cycle_fast_path_uses_999th_percentile_cutoffs() {
        let board = BoardModel::joint_pegging_without_early_heuristic();
        assert_eq!(board.distributions.cycle_fast_path_cutoffs.pone, 24);
        assert_eq!(board.distributions.cycle_fast_path_cutoffs.dealer, 34);
        assert!(board.cycle_fast_path_allowed(96, 86, Role::Pone));
        assert!(!board.cycle_fast_path_allowed(97, 86, Role::Pone));
        assert!(!board.cycle_fast_path_allowed(96, 87, Role::Pone));
        assert!(board.cycle_fast_path_allowed(86, 96, Role::Dealer));
        assert!(!board.cycle_fast_path_allowed(87, 96, Role::Dealer));
        assert!(!board.cycle_fast_path_allowed(86, 97, Role::Dealer));
    }

    #[test]
    fn board_memo_index_stays_inside_fixed_state_space() {
        assert_eq!(
            board_memo_index(0, 0, Role::Pone, ScorePhase::PeggingPone),
            0
        );
        let max_index = board_memo_index(121, 121, Role::Dealer, ScorePhase::Crib);
        assert_eq!(max_index, BOARD_MEMO_SIZE - 1);
        assert_ne!(
            board_memo_index(12, 34, Role::Pone, ScorePhase::HandPone),
            board_memo_index(12, 34, Role::Dealer, ScorePhase::HandPone)
        );
        assert_ne!(
            board_memo_index(12, 34, Role::Dealer, ScorePhase::HandPone),
            board_memo_index(12, 34, Role::Dealer, ScorePhase::HandDealer)
        );
    }

    #[test]
    fn matrix_lookup_uses_dealer_perspective_for_both_roles() {
        let matrix = Arc::new(BoardWinMatrix::from_function(|_, dealer, pone| {
            ((dealer as usize * 121) + pone as usize) as f64 / 14_640.0
        }));
        let mut dealer_board = BoardModel::from_board_matrix(Arc::clone(&matrix));
        let mut pone_board = BoardModel::from_board_matrix(matrix);

        let dealer = dealer_board.future_win_probability_from_scores(
            30,
            40,
            Role::Dealer,
            ScorePhase::PeggingPone,
        );
        let pone = pone_board.future_win_probability_from_scores(
            40,
            30,
            Role::Pone,
            ScorePhase::PeggingPone,
        );
        assert!((dealer - (1.0 - pone)).abs() < 1e-12);
    }

    #[test]
    fn matrix_board_selects_the_matching_phase_seam() {
        let matrix = Arc::new(BoardWinMatrix::from_function(|seam, _, _| match seam {
            BoardMatrixSeam::Discard => 0.1,
            BoardMatrixSeam::AfterDiscard => 0.2,
            BoardMatrixSeam::AfterPegging => 0.3,
            BoardMatrixSeam::AfterPone => 0.4,
        }));
        let mut board = BoardModel::from_board_matrix(matrix);

        let probability =
            board.future_win_probability_from_scores(10, 20, Role::Pone, ScorePhase::HandPone);
        assert!((probability - 0.7).abs() < 1e-12);
    }

    #[test]
    fn joint_future_pegging_treats_double_out_as_indeterminate() {
        let mut board = test_board_with_joint_pegging(2, 2);
        assert_eq!(
            board.future_win_probability_from_scores(119, 119, Role::Pone, ScorePhase::PeggingPone),
            0.5
        );
    }

    #[test]
    fn exact_joint_future_pegging_treats_double_out_as_indeterminate() {
        let mut board = test_board_with_exact_joint_pegging(2, 2);
        assert_eq!(
            board.future_win_probability_from_scores(119, 119, Role::Pone, ScorePhase::PeggingPone),
            0.5
        );
    }

    #[test]
    fn joint_future_pegging_awards_single_side_outcomes() {
        let mut pone_board = test_board_with_joint_pegging(2, 0);
        assert_eq!(
            pone_board.future_win_probability_from_scores(
                119,
                119,
                Role::Pone,
                ScorePhase::PeggingPone
            ),
            1.0
        );

        let mut dealer_board = test_board_with_joint_pegging(0, 2);
        assert_eq!(
            dealer_board.future_win_probability_from_scores(
                119,
                119,
                Role::Pone,
                ScorePhase::PeggingPone
            ),
            0.0
        );
    }

    #[test]
    fn cycle_terminal_order_scores_pone_hand_before_dealer_hand() {
        let mut pone_board = test_board_with_cycle(0, 0, 2, 2, 0, false);
        assert_eq!(
            pone_board.future_win_probability_from_scores(
                119,
                119,
                Role::Pone,
                ScorePhase::PeggingPone
            ),
            1.0
        );

        let mut dealer_board = test_board_with_cycle(0, 0, 2, 2, 0, false);
        assert_eq!(
            dealer_board.future_win_probability_from_scores(
                119,
                119,
                Role::Dealer,
                ScorePhase::PeggingPone
            ),
            0.0
        );
    }

    #[test]
    fn cycle_terminal_order_scores_dealer_hand_before_crib() {
        let mut dealer_board = test_board_with_cycle(0, 0, 0, 2, 2, false);
        assert_eq!(
            dealer_board.future_win_probability_from_scores(
                119,
                119,
                Role::Dealer,
                ScorePhase::PeggingPone
            ),
            1.0
        );

        let mut pone_board = test_board_with_cycle(0, 0, 0, 2, 2, false);
        assert_eq!(
            pone_board.future_win_probability_from_scores(
                119,
                119,
                Role::Pone,
                ScorePhase::PeggingPone
            ),
            0.0
        );
    }

    #[test]
    fn cycle_without_progress_remains_indeterminate() {
        let mut board = test_board_with_cycle(0, 0, 0, 0, 0, false);
        assert_eq!(
            board.future_win_probability_from_scores(50, 50, Role::Pone, ScorePhase::PeggingPone),
            0.5
        );
    }

    #[test]
    fn exact_joint_gate_awards_single_side_pegging_terminal_without_joint_ambiguity() {
        let mut pone_board = test_board_with_exact_joint_pegging(2, 0);
        assert_eq!(
            pone_board.future_win_probability_from_scores(
                119,
                119,
                Role::Pone,
                ScorePhase::PeggingPone
            ),
            1.0
        );

        let mut dealer_board = test_board_with_exact_joint_pegging(0, 2);
        assert_eq!(
            dealer_board.future_win_probability_from_scores(
                119,
                119,
                Role::Pone,
                ScorePhase::PeggingPone
            ),
            0.0
        );
    }
}

fn phase_stats(phase: ScorePhase) -> PhaseStats {
    match phase {
        ScorePhase::PeggingDealer => PhaseStats {
            average: 3.6911769014341838,
            standard_deviation: 2.2810332319118443,
            min: 0.0,
            max: 24.0,
        },
        ScorePhase::PeggingPone => PhaseStats {
            average: 2.193263591774455,
            standard_deviation: 2.0901657692050355,
            min: 0.0,
            max: 21.0,
        },
        ScorePhase::HandDealer => PhaseStats {
            average: 7.4683076643312996,
            standard_deviation: 4.216974737126742,
            min: 0.0,
            max: 28.0,
        },
        ScorePhase::HandPone => PhaseStats {
            average: 7.893774277790997,
            standard_deviation: 3.9011785163442547,
            min: 0.0,
            max: 29.0,
        },
        ScorePhase::Crib => PhaseStats {
            average: 4.328369593219221,
            standard_deviation: 3.368893338401471,
            min: 0.0,
            max: 24.0,
        },
    }
}
