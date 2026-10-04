//! Exact, decision-local root utility ceilings for Model 20.6.
//! Enumerates rule-legal continuations, memoizing only their maximum utility.
//! No observation/action table, endpoint collection, or persistent graph.
use super::*;

#[path = "model206_ordering.rs"]
pub(super) mod ordering;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct State {
    hands: [u64; 2],
    plays: [u8; 8],
    scores: [u8; 2],
    len: u8,
    count: u8,
    current: u8,
    go: u8,
    last: u8,
    done: bool,
}
impl State {
    fn from_reference(s: &RankPegState) -> Self {
        assert!(s.plays.len() <= 8);
        let mut plays = [0; 8];
        plays[..s.plays.len()].copy_from_slice(&s.plays);
        Self {
            hands: std::array::from_fn(|p| {
                s.hands[p]
                    .iter()
                    .enumerate()
                    .map(|(r, &n)| u64::from(n) << (r * 3))
                    .sum()
            }),
            plays,
            scores: s.scores.map(|v| u8::try_from(v).unwrap()),
            len: s.plays.len() as u8,
            count: s.count,
            current: s.current.index() as u8,
            go: s.go_player.map_or(2, |p| p.index() as u8),
            last: s.last_player.map_or(2, |p| p.index() as u8),
            done: s.complete || s.winner.is_some(),
        }
    }
    fn copies(self, p: usize, r: usize) -> u8 {
        ((self.hands[p] >> (r * 3)) & 7) as u8
    }
    fn mask(self) -> u16 {
        if self.done {
            return 0;
        }
        (0..13).fold(0, |m, r| {
            m | if self.copies(self.current as usize, r) > 0
                && self.count + crate::cards::VALUES[r] <= 31
            {
                1 << r
            } else {
                0
            }
        })
    }
    fn add(&mut self, p: u8, n: u8) {
        self.scores[p as usize] = (self.scores[p as usize] + n).min(121);
        if self.scores[p as usize] >= 121 {
            self.done = true;
        }
    }
    fn reset(&mut self, next: u8) {
        self.plays = [0; 8];
        self.len = 0;
        self.count = 0;
        self.go = 2;
        self.last = 2;
        self.current = next;
    }
    fn apply(mut self, action: RankPegAction) -> Self {
        match action {
            RankPegAction::Play(r) => {
                debug_assert!(!self.done && self.mask() & (1 << r) != 0);
                self.hands[self.current as usize] -= 1_u64 << (r * 3);
                self.plays[self.len as usize] = r;
                self.len += 1;
                self.count += crate::cards::VALUES[r as usize];
                self.last = self.current;
                self.add(
                    self.current,
                    crate::cards::score_count_ranks(&self.plays[..self.len as usize]),
                );
                if self.done {
                    return self;
                }
                if self.count == 31 {
                    self.reset(1 - self.current);
                } else if self.go == 2 {
                    self.current = 1 - self.current;
                }
                if self.hands == [0, 0] {
                    if self.count != 0 && self.last != 2 {
                        self.add(self.last, 1);
                    }
                    self.done = true;
                }
            }
            RankPegAction::Go => {
                debug_assert!(!self.done && self.mask() == 0);
                if self.go != 2 {
                    if self.last != 2 && self.count != 31 {
                        self.add(self.last, 1);
                    }
                    if !self.done {
                        self.reset(1 - self.current);
                        if self.hands == [0, 0] {
                            self.done = true;
                        }
                    }
                } else {
                    self.go = self.current;
                    self.current = 1 - self.current;
                }
            }
        }
        self
    }
    fn score_key(self) -> u16 {
        u16::from(self.scores[0]) * 256 + u16::from(self.scores[1])
    }
}

/// Root utility and all memoized values live for this one decision only.
/// Hidden ranks describe a hypothetical world; no policy receives them here.
struct Bounder {
    root: [u8; 2],
    direct: HashMap<State, f64>,
    utilities: HashMap<u16, f64>,
}

impl Bounder {
    fn new(o: &Model132Observation) -> Self {
        Self {
            root: [o.my_score as u8, o.opponent_score as u8],
            direct: HashMap::new(),
            utilities: HashMap::new(),
        }
    }

    fn value(&mut self, key: u16, wp: &mut impl FnMut(u8, u8) -> f64) -> Result<f64, String> {
        if let Some(&v) = self.utilities.get(&key) {
            return Ok(v);
        }
        let own = (key / 256) as u8 - self.root[0];
        let other = (key % 256) as u8 - self.root[1];
        let v = wp(own, other);
        if !v.is_finite() || !(0.0..=1.0).contains(&v) {
            return Err("20.6 choice bound requires a finite WP in [0, 1]".into());
        }
        self.utilities.insert(key, v);
        Ok(v)
    }

    fn maximum(&mut self, state: State, wp: &mut impl FnMut(u8, u8) -> f64) -> Result<f64, String> {
        if let Some(&v) = self.direct.get(&state) {
            return Ok(v);
        }
        let value = if state.done {
            self.value(state.score_key(), wp)?
        } else {
            let mut ranks = state.mask();
            if ranks == 0 {
                self.maximum(state.apply(RankPegAction::Go), wp)?
            } else {
                let mut best: f64 = 0.0;
                while ranks != 0 {
                    let rank = ranks.trailing_zeros() as u8;
                    ranks &= ranks - 1;
                    best = best.max(self.maximum(state.apply(RankPegAction::Play(rank)), wp)?);
                    // WP cannot exceed one, regardless of policy or posterior.
                    if best == 1.0 {
                        break;
                    }
                }
                best
            }
        };
        self.direct.insert(state, value);
        Ok(value)
    }

    fn action_bounds(
        &mut self,
        o: &Model132Observation,
        worlds: &[World],
        action: RankPegAction,
        wp: &mut impl FnMut(u8, u8) -> f64,
    ) -> Result<Vec<f64>, String> {
        let mut by_hand = HashMap::new();
        let mut result = Vec::with_capacity(worlds.len());
        let progress = crate::progress::current();
        for (index, world) in worlds.iter().enumerate() {
            if index % 256 == 0 {
                if let Some(progress) = &progress {
                    progress.check_cancelled()?;
                }
            }
            let value = if let Some(&v) = by_hand.get(&world.remaining) {
                v
            } else {
                // Discard variants can change policy choices, but not the set
                // of legal pegging endpoints for these remaining ranks.
                let state = State::from_reference(&world_state(o, world)?).apply(action);
                let v = self.maximum(state, wp)?;
                by_hand.insert(world.remaining, v);
                v
            };
            result.push(value);
        }
        Ok(result)
    }
}

pub(super) fn forecast_worlds_for_choice(
    observation: &Model132Observation,
    policy: &impl Model132PeggingPolicy,
    worlds: &[World],
    posterior_worlds: usize,
    win_probability: &mut impl FnMut(u8, u8) -> f64,
) -> Result<Vec<PegCandidateForecast>, String> {
    let progress = crate::progress::current();
    let mut observation_scratch = Model132ObservationScratch::default();
    let mut rollout_storage = rollout_storage::RolloutStorage::default();
    let batch_size = policy.rollout_batch_size().clamp(1, 32);
    let mut batch_scores = Vec::new();
    let mut actions = observation.legal_actions();
    if let Some(progress) = &progress {
        progress.check_cancelled()?;
        progress.begin(worlds.len() * actions.len());
    }
    ordering::order(observation, &mut actions);
    let mut remaining = vec![0.0; worlds.len() + 1];
    for index in (0..worlds.len()).rev() {
        remaining[index] = remaining[index + 1] + worlds[index].weight;
    }
    // All summands are nonnegative and utility is <= 1. This allowance
    // conservatively covers the world-order sums, reverse mass sum, and both
    // histogram-order weighted sums (standard gamma_n floating-point bounds).
    // Disallow pruning altogether when n*epsilon is outside that small-error
    // regime. Exact ties and near ties must always complete.
    let roundoff = (worlds.len() as f64 + 1.0) * f64::EPSILON;
    let allowance = if roundoff < 1.0 / 16.0 {
        64.0 * roundoff * remaining[0].max(1.0)
    } else {
        f64::INFINITY
    };
    let mut bounder = Bounder::new(observation);
    let mut incumbent = f64::NEG_INFINITY;
    let mut forecasts = Vec::new();
    let mut utilities = BTreeMap::new();
    for (action_index, action) in actions.into_iter().enumerate() {
        // No incumbent exists for the first root: its bound cannot prune work.
        let bounds = if incumbent.is_finite() {
            Some(bounder.action_bounds(observation, worlds, action, win_probability)?)
        } else {
            None
        };
        let mut upper = Vec::new();
        if let Some(bounds) = &bounds {
            upper.resize(worlds.len() + 1, 0.0);
            for i in (0..worlds.len()).rev() {
                upper[i] = upper[i + 1] + worlds[i].weight * bounds[i];
            }
        }
        let remaining_upper = if bounds.is_some() { &upper } else { &remaining };
        let mut outcomes = BTreeMap::new();
        let mut partial_wp = 0.0;
        let mut inferior = remaining_upper[0] + allowance < incumbent;
        for (index, world) in worlds.iter().enumerate() {
            if inferior {
                break;
            }
            if index % 256 == 0 {
                if let Some(progress) = &progress {
                    progress.check_cancelled()?;
                    progress.complete(action_index * worlds.len() + index);
                }
            }
            if batch_size > 1 && index % batch_size == 0 {
                match rollout_storage.batch(
                    observation,
                    policy,
                    &worlds[index..(index + batch_size).min(worlds.len())],
                    action,
                    &mut batch_scores,
                ) {
                    Ok(()) => (),
                    Err(_) => {
                        if let Some(progress) = &progress {
                            progress.check_cancelled()?;
                        }
                        // A speculative later world may never be needed after pruning.
                        // Revisit this chunk in canonical scalar order before exposing errors.
                        batch_scores.clear();
                    }
                };
            }
            let score = if let Some(score) = batch_scores.get(index % batch_size) {
                *score
            } else {
                rollout_storage.scalar(
                    observation,
                    policy,
                    world,
                    action,
                    &mut observation_scratch,
                )?
            };
            *outcomes.entry(score).or_insert(0.0) += world.weight;
            let utility = *utilities
                .entry(score)
                .or_insert_with(|| win_probability(score.0, score.1));
            if !utility.is_finite() || !(0.0..=1.0).contains(&utility) {
                return Err("13.23 choice bound requires a finite WP in [0, 1]".into());
            }
            if let Some(bounds) = &bounds {
                // Every executable-policy endpoint must fit the rule-legal ceiling.
                // Refuse an invalid result instead of silently discarding a contender.
                if utility > bounds[index] {
                    return Err("20.6 rollout utility exceeds its exact ceiling".into());
                }
            }
            partial_wp += world.weight * utility;
            if index + 1 < worlds.len()
                && partial_wp + remaining_upper[index + 1] + allowance < incumbent
            {
                inferior = true;
                break;
            }
        }
        // Pruned work is resolved too; it must not leave the bar short.
        if let Some(progress) = &progress {
            progress.complete((action_index + 1) * worlds.len());
        }
        if inferior {
            continue;
        }
        let wp: f64 = outcomes
            .iter()
            .map(|(score, weight)| weight * utilities[score])
            .sum();
        incumbent = incumbent.max(wp);
        forecasts.push(PegCandidateForecast {
            action,
            outcomes: outcomes.into_iter().map(|((a, b), w)| (a, b, w)).collect(),
            posterior_worlds,
            evaluated_worlds: worlds.len(),
        });
    }
    // Traversal hints must not change the existing final choice/tie order.
    forecasts.sort_by_key(|f| ordering::rank(f.action));
    Ok(forecasts)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn walk(r: &RankPegState, checks: &mut usize) -> Vec<u16> {
        let s = State::from_reference(r);
        *checks += 1;
        if s.done {
            return vec![s.score_key()];
        }
        let mut ends = Vec::new();
        for action in r.legal_actions() {
            let mut next = r.clone();
            next.apply(action).unwrap();
            assert_eq!(s.apply(action), State::from_reference(&next));
            ends.extend(walk(&next, checks));
        }
        ends.sort_unstable();
        ends.dedup();
        ends
    }
    #[test]
    fn direct_maximum_matches_exhaustive_rule_legal_endpoints() {
        let mut seed = 205_930_u64;
        let mut random = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            (seed >> 32) as usize
        };
        let mut checks = 0;
        for game in 0..2048 {
            let mut deck: Vec<u8> = (0..52).map(|v| v % 13).collect();
            for i in (1..52).rev() {
                deck.swap(i, random() % (i + 1));
            }
            if game < 5 {
                let targeted = [
                    [0, 0, 0, 0, 1, 1, 1, 1],
                    [0, 1, 2, 3, 4, 5, 6, 7],
                    [9, 9, 9, 9, 12, 12, 12, 12],
                    [4, 4, 5, 5, 6, 6, 7, 7],
                    [0, 0, 1, 2, 0, 0, 3, 4],
                ];
                deck[..8].copy_from_slice(&targeted[game]);
            }
            let mut hands = [[0; 13]; 2];
            for i in 0..8 {
                hands[i / 4][deck[i] as usize] += 1;
            }
            let mut r = RankPegState {
                hands,
                own_discards: [[0; 13]; 2],
                turn_rank: 0,
                scores: match game % 4 {
                    0 => [118, 119],
                    1 => [120, 100],
                    _ => [0, 0],
                },
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
            for _ in 0..game % 7 {
                if r.complete || r.winner.is_some() {
                    break;
                }
                let legal = r.legal_actions();
                r.apply(legal[random() % legal.len()]).unwrap();
            }
            let expected = walk(&r, &mut checks);
            let s = State::from_reference(&r);
            let mut b = Bounder {
                root: r.scores.map(|v| v as u8),
                direct: HashMap::new(),
                utilities: HashMap::new(),
            };
            let value = |a: u8, c: u8| {
                if r.scores[0] + i32::from(a) >= 121 {
                    1.0
                } else if r.scores[1] + i32::from(c) >= 121 {
                    0.0
                } else {
                    f64::from(
                        (u16::from(a) * 37 + u16::from(c) * 11 + u16::from(a) * u16::from(c))
                            % 1000,
                    ) / 1000.0
                }
            };
            let max = expected
                .iter()
                .map(|&v| value((v / 256) as u8 - b.root[0], (v % 256) as u8 - b.root[1]))
                .fold(0.0_f64, f64::max);
            assert_eq!(
                b.maximum(s, &mut |a, c| value(a, c)).unwrap().to_bits(),
                max.to_bits()
            );
        }
        assert!(checks > 1000);
        println!("BOUND_PROOF states={checks} roots=2048");
    }
}
