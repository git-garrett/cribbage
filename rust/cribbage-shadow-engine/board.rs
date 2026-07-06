use std::collections::HashMap;

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

pub struct BoardModel {
    distributions: HashMap<ScorePhase, Vec<(u8, f64)>>,
    cycle_delta_cache: HashMap<Role, Vec<((u8, u8), f64)>>,
    memo: HashMap<(u8, u8, Role, ScorePhase), f64>,
    use_heuristic_before_90: bool,
    joint_future_pegging: bool,
}

impl BoardModel {
    pub fn new() -> BoardModel {
        BoardModel::with_options(true, false)
    }

    pub fn without_early_heuristic() -> BoardModel {
        BoardModel::with_options(false, false)
    }

    pub fn joint_pegging_without_early_heuristic() -> BoardModel {
        BoardModel::with_options(false, true)
    }

    fn with_options(use_heuristic_before_90: bool, joint_future_pegging: bool) -> BoardModel {
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
        BoardModel {
            distributions,
            cycle_delta_cache: HashMap::new(),
            memo: HashMap::new(),
            use_heuristic_before_90,
            joint_future_pegging,
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
        if self.use_heuristic_before_90 && my < 90 && opponent < 90 {
            return heuristic_win_probability(my as f64, opponent as f64, perspective_role);
        }
        let key = (my, opponent, perspective_role, phase);
        if let Some(value) = self.memo.get(&key) {
            return *value;
        }
        self.memo.insert(key, 0.5);

        if self.joint_future_pegging && phase == ScorePhase::PeggingPone {
            let probability = if self.cycle_terminal_impossible(my, opponent, perspective_role) {
                self.future_terminal_safe_cycle_win_probability(my, opponent, perspective_role)
            } else {
                self.future_joint_pegging_win_probability(my, opponent, perspective_role)
            };
            self.memo.insert(key, probability);
            return probability;
        }

        let scorer_role = match phase {
            ScorePhase::PeggingPone | ScorePhase::HandPone => Role::Pone,
            ScorePhase::PeggingDealer | ScorePhase::HandDealer | ScorePhase::Crib => Role::Dealer,
        };
        let perspective_scores = perspective_role == scorer_role;
        let distribution = self
            .distributions
            .get(&phase)
            .cloned()
            .unwrap_or_else(|| vec![(0, 1.0)]);
        let mut probability = 0.0;
        for (points, weight) in distribution {
            if perspective_scores {
                let next_my = my.saturating_add(points);
                probability += weight
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
                let next_opponent = opponent.saturating_add(points);
                probability += weight
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
        self.memo.insert(key, probability);
        probability
    }

    fn future_terminal_safe_cycle_win_probability(
        &mut self,
        my: u8,
        opponent: u8,
        perspective_role: Role,
    ) -> f64 {
        let next_role = next_perspective_role(perspective_role, ScorePhase::Crib);
        let deltas = self.cycle_delta_distribution(perspective_role);
        if !self.cycle_terminal_impossible(my, opponent, next_role) {
            let mut probability = 0.0;
            for ((my_delta, opponent_delta), weight) in deltas {
                probability += weight
                    * self.future_win_probability_u8(
                        my + my_delta,
                        opponent + opponent_delta,
                        next_role,
                        ScorePhase::PeggingPone,
                    );
            }
            return probability;
        }

        let paired_deltas = self.cycle_delta_distribution(next_role);
        let (base, zero_cycle_weight) =
            self.cycle_delta_continuation_value(&deltas, my, opponent, next_role);
        let (paired_base, paired_zero_cycle_weight) =
            self.cycle_delta_continuation_value(&paired_deltas, my, opponent, perspective_role);
        let denominator = 1.0 - (zero_cycle_weight * paired_zero_cycle_weight);
        if denominator.abs() < 1e-12 {
            let paired_key = (my, opponent, next_role, ScorePhase::PeggingPone);
            self.memo.insert(paired_key, 0.5);
            return 0.5;
        }
        let probability = (base + zero_cycle_weight * paired_base) / denominator;
        let paired_probability = (paired_base + paired_zero_cycle_weight * base) / denominator;
        let paired_key = (my, opponent, next_role, ScorePhase::PeggingPone);
        self.memo.insert(paired_key, paired_probability);
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
        let pone_distribution = self
            .distributions
            .get(&ScorePhase::PeggingPone)
            .cloned()
            .unwrap_or_else(|| vec![(0, 1.0)]);
        let dealer_distribution = self
            .distributions
            .get(&ScorePhase::PeggingDealer)
            .cloned()
            .unwrap_or_else(|| vec![(0, 1.0)]);
        let mut probability = 0.0;
        for (pone_points, pone_weight) in pone_distribution {
            for (dealer_points, dealer_weight) in &dealer_distribution {
                let weight = pone_weight * *dealer_weight;
                let (next_my, next_opponent) = if perspective_role == Role::Pone {
                    (
                        my.saturating_add(pone_points),
                        opponent.saturating_add(*dealer_points),
                    )
                } else {
                    (
                        my.saturating_add(*dealer_points),
                        opponent.saturating_add(pone_points),
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

    fn cycle_terminal_impossible(&self, my: u8, opponent: u8, perspective_role: Role) -> bool {
        let pone_cycle_max = self.max_points(ScorePhase::PeggingPone) as u16
            + self.max_points(ScorePhase::HandPone) as u16;
        let dealer_cycle_max = self.max_points(ScorePhase::PeggingDealer) as u16
            + self.max_points(ScorePhase::HandDealer) as u16
            + self.max_points(ScorePhase::Crib) as u16;
        let (my_max, opponent_max) = if perspective_role == Role::Pone {
            (pone_cycle_max, dealer_cycle_max)
        } else {
            (dealer_cycle_max, pone_cycle_max)
        };
        (my as u16) + my_max < 121 && (opponent as u16) + opponent_max < 121
    }

    fn max_points(&self, phase: ScorePhase) -> u8 {
        self.distributions
            .get(&phase)
            .and_then(|distribution| distribution.iter().map(|(points, _)| *points).max())
            .unwrap_or(0)
    }

    fn cycle_delta_distribution(&mut self, perspective_role: Role) -> Vec<((u8, u8), f64)> {
        if let Some(cached) = self.cycle_delta_cache.get(&perspective_role) {
            return cached.clone();
        }
        let mut states = HashMap::new();
        add_cycle_state(&mut states, (0, 0), 1.0);
        states = apply_cycle_joint_pegging_delta(
            states,
            &self.distribution_for(ScorePhase::PeggingPone),
            &self.distribution_for(ScorePhase::PeggingDealer),
            perspective_role,
        );
        states = apply_cycle_delta_phase(
            states,
            &self.distribution_for(ScorePhase::HandPone),
            perspective_role == Role::Pone,
        );
        states = apply_cycle_delta_phase(
            states,
            &self.distribution_for(ScorePhase::HandDealer),
            perspective_role == Role::Dealer,
        );
        states = apply_cycle_delta_phase(
            states,
            &self.distribution_for(ScorePhase::Crib),
            perspective_role == Role::Dealer,
        );
        let distribution = states.into_iter().collect::<Vec<_>>();
        self.cycle_delta_cache
            .insert(perspective_role, distribution.clone());
        distribution
    }

    fn distribution_for(&self, phase: ScorePhase) -> Vec<(u8, f64)> {
        self.distributions
            .get(&phase)
            .cloned()
            .unwrap_or_else(|| vec![(0, 1.0)])
    }
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
        test_board_with_cycle(pone_points, dealer_points, 0, 0, 0)
    }

    fn test_board_with_cycle(
        pone_pegging: u8,
        dealer_pegging: u8,
        pone_hand: u8,
        dealer_hand: u8,
        crib: u8,
    ) -> BoardModel {
        let mut distributions = HashMap::new();
        distributions.insert(ScorePhase::PeggingPone, vec![(pone_pegging, 1.0)]);
        distributions.insert(ScorePhase::PeggingDealer, vec![(dealer_pegging, 1.0)]);
        distributions.insert(ScorePhase::HandPone, vec![(pone_hand, 1.0)]);
        distributions.insert(ScorePhase::HandDealer, vec![(dealer_hand, 1.0)]);
        distributions.insert(ScorePhase::Crib, vec![(crib, 1.0)]);
        BoardModel {
            distributions,
            cycle_delta_cache: HashMap::new(),
            memo: HashMap::new(),
            use_heuristic_before_90: false,
            joint_future_pegging: true,
        }
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
        let mut pone_board = test_board_with_cycle(0, 0, 2, 2, 0);
        assert_eq!(
            pone_board.future_win_probability_from_scores(
                119,
                119,
                Role::Pone,
                ScorePhase::PeggingPone
            ),
            1.0
        );

        let mut dealer_board = test_board_with_cycle(0, 0, 2, 2, 0);
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
        let mut dealer_board = test_board_with_cycle(0, 0, 0, 2, 2);
        assert_eq!(
            dealer_board.future_win_probability_from_scores(
                119,
                119,
                Role::Dealer,
                ScorePhase::PeggingPone
            ),
            1.0
        );

        let mut pone_board = test_board_with_cycle(0, 0, 0, 2, 2);
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
        let mut board = test_board_with_cycle(0, 0, 0, 0, 0);
        assert_eq!(
            board.future_win_probability_from_scores(50, 50, Role::Pone, ScorePhase::PeggingPone),
            0.5
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
