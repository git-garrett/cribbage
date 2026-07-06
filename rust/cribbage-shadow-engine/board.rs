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
    memo: HashMap<(u8, u8, Role, ScorePhase), f64>,
    use_heuristic_before_90: bool,
}

impl BoardModel {
    pub fn new() -> BoardModel {
        BoardModel::with_options(true)
    }

    pub fn without_early_heuristic() -> BoardModel {
        BoardModel::with_options(false)
    }

    fn with_options(use_heuristic_before_90: bool) -> BoardModel {
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
            memo: HashMap::new(),
            use_heuristic_before_90,
        }
    }

    pub fn future_win_probability(
        &mut self,
        my_score: f64,
        opponent_score: f64,
        perspective_role: Role,
        phase: ScorePhase,
    ) -> f64 {
        let my = my_score.round().clamp(0.0, 121.0) as u8;
        let opponent = opponent_score.round().clamp(0.0, 121.0) as u8;
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
                        self.future_win_probability(
                            next_my as f64,
                            opponent as f64,
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
                        self.future_win_probability(
                            my as f64,
                            next_opponent as f64,
                            next_perspective_role(perspective_role, phase),
                            next_score_phase(phase),
                        )
                    };
            }
        }
        self.memo.insert(key, probability);
        probability
    }
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
