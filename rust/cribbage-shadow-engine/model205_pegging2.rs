//! Symmetric backward induction over legal-observation buckets.
//!
//! Both simulated actors use the same posterior, continuation solver, inner
//! after-pegging WP objective, and tie rules. Live root selection retains the
//! baseline's richer counting-aware valuation in model.rs. A bucket is solved
//! only after its later decisions have been solved. Each hypothetical play
//! decreases remaining cards before another non-forced decision is needed.
//!
//! This implementation rebuilds worlds on each uncached observation. It is NOT
//! the requested single backward pass over equivalence-grouped continuations.
//!
//! Beliefs are the fixed empirical inference model, conditioned on this actor's
//! own observation. They are NOT recomputed as equilibrium reach probabilities.
//! In particular an opponent bucket is never populated from the root's worlds,
//! which would incorrectly reveal the root player's private hand.
use super::{world_state, Model132Observation, PegCandidateForecast, PolicyAssets, World};
use crate::board::Role;
use crate::board_matrix::{BoardMatrixSeam, BoardWinMatrix};
use crate::cards::{rank_count_total, score_count_ranks};
use crate::information_set::{RankPegAction, RankPegState};
use crate::model132::Model911Policy;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

// Admission stops when full; uncached buckets are solved again, never replaced
// by another policy or a partially evaluated move. All entries die with the solve.
const MAX_CACHED_BUCKETS: usize = 200_000;

#[derive(Default, Debug, serde::Serialize)]
pub(super) struct SearchStats {
    pub solved_buckets_by_cards: [usize; 9],
    pub cached_buckets: usize,
    pub cache_hits: usize,
    pub cache_admission_skips: usize,
    pub posterior_worlds: usize,
    pub candidate_worlds: usize,
    pub transitions: usize,
    pub pruned_candidates: usize,
    pub max_depth: usize,
}

#[derive(Clone)]
struct WeightedState {
    state: RankPegState,
    weight: f64,
}

/// Preserve the baseline inner policy's objective. The live root uses its
/// existing known-card counting context instead. Scores at or beyond 121
/// terminate before the lookup; nonterminal coordinates must be valid.
pub(crate) fn terminal_wp(board: &BoardWinMatrix, role: Role, my_score: i32, other_score: i32) -> f64 {
    if my_score >= 121 { return 1.0; }
    if other_score >= 121 { return 0.0; }
    match role {
        Role::Dealer => board.dealer_win_probability(BoardMatrixSeam::AfterPegging,
            my_score as u8, other_score as u8),
        Role::Pone => 1.0 - board.dealer_win_probability(BoardMatrixSeam::AfterPegging,
            other_score as u8, my_score as u8),
    }
}

pub(super) fn forecast(
    assets: &PolicyAssets,
    beliefs: &Model911Policy,
    observation: &Model132Observation,
    worlds: Vec<World>,
    actions: &[RankPegAction],
) -> Result<(Vec<PegCandidateForecast>, SearchStats), String> {
    let board = assets.wp_board.as_ref().ok_or("20.5.pegging2 requires a WP board")?;
    // Only posterior construction is reused from Model911Policy. Its action
    // chooser and average-continuation evaluator are never called here.
    let posterior = |observation: &Model132Observation| assets.worlds_for_hand(observation, beliefs, None);
    let mut search = Search::new(&posterior, board);
    if let Some(progress) = &search.progress { progress.begin(actions.len()); }
    let result = search.evaluate(observation, worlds, actions, false)?;
    Ok((result, search.stats))
}

struct Search<'a, B> {
    posterior: &'a B,
    board: &'a BoardWinMatrix,
    choices: HashMap<Model132Observation, RankPegAction>,
    stack: Vec<usize>,
    stats: SearchStats,
    progress: Option<Arc<crate::progress::DecisionProgress>>,
    prune: bool,
}

impl<'a, B: Fn(&Model132Observation) -> Result<Vec<World>, String>> Search<'a, B> {
    fn new(posterior: &'a B, board: &'a BoardWinMatrix) -> Self {
        Self { posterior, board, choices: HashMap::new(), stack: Vec::new(),
            stats: SearchStats::default(), progress: crate::progress::current(), prune: true }
    }

    fn check_cancelled(&self) -> Result<(), String> {
        if let Some(progress) = &self.progress { progress.check_cancelled()?; }
        Ok(())
    }

    fn choose(&mut self, observation: &Model132Observation) -> Result<RankPegAction, String> {
        self.check_cancelled()?;
        let legal = observation.legal_actions();
        if let [forced] = legal.as_slice() { return Ok(*forced); }
        if let Some(&choice) = self.choices.get(observation) {
            self.stats.cache_hits += 1;
            return Ok(choice);
        }
        // Generate the complete bucket from this actor's knowledge, NOT from
        // the enclosing world's other hand or weights. Hash collisions are
        // resolved by complete Model132Observation equality.
        let worlds = (self.posterior)(observation)?;
        let forecasts = self.evaluate(observation, worlds, &legal, self.prune)?;
        let best = self.best(observation, &forecasts)?;
        if self.choices.len() < MAX_CACHED_BUCKETS {
            self.choices.insert(observation.clone(), best);
            self.stats.cached_buckets = self.choices.len();
        } else {
            self.stats.cache_admission_skips += 1;
        }
        Ok(best)
    }

    fn key(&self, observation: &Model132Observation, candidate: &PegCandidateForecast) -> (f64, u8, u8) {
        let wp = candidate.outcomes.iter().map(|&(own, other, weight)| weight * terminal_wp(
            self.board, observation.role, observation.my_score + i32::from(own),
            observation.opponent_score + i32::from(other),
        )).sum();
        let RankPegAction::Play(rank) = candidate.action else { return (wp, 0, 0); };
        let mut series = observation.current_series.clone(); series.push(rank);
        (wp, score_count_ranks(&series), rank)
    }

    fn best(&self, observation: &Model132Observation, forecasts: &[PegCandidateForecast]) -> Result<RankPegAction, String> {
        forecasts.iter().max_by(|a, b| self.key(observation, a).partial_cmp(&self.key(observation, b)).unwrap())
            .map(|candidate| candidate.action).ok_or_else(|| "20.5.pegging2 has no complete candidate".into())
    }

    fn evaluate(
        &mut self, observation: &Model132Observation, worlds: Vec<World>,
        actions: &[RankPegAction], prune: bool,
    ) -> Result<Vec<PegCandidateForecast>, String> {
        self.check_cancelled()?;
        observation.validate()?;
        if !(0..121).contains(&observation.my_score) || !(0..121).contains(&observation.opponent_score) {
            return Err("20.5.pegging2 requires a nonterminal board position".into());
        }
        let remaining = usize::from(rank_count_total(&observation.own_remaining))
            + 4 - usize::from(rank_count_total(&observation.opponent_played));
        if self.stack.last().is_some_and(|&parent| remaining >= parent) {
            return Err("20.5.pegging2 backward dependency did not decrease remaining cards".into());
        }
        self.stack.push(remaining);
        self.stats.max_depth = self.stats.max_depth.max(self.stack.len());
        let result = self.evaluate_bucket(observation, worlds, actions, prune);
        self.stack.pop();
        if result.is_ok() { self.stats.solved_buckets_by_cards[remaining] += 1; }
        result
    }

    fn evaluate_bucket(
        &mut self, observation: &Model132Observation, mut worlds: Vec<World>,
        actions: &[RankPegAction], prune: bool,
    ) -> Result<Vec<PegCandidateForecast>, String> {
        let legal = observation.legal_actions();
        if worlds.is_empty() || actions.is_empty() || actions.iter().any(|a| !legal.contains(a)) {
            return Err("20.5.pegging2 requires a nonempty posterior and legal candidates".into());
        }
        let posterior_worlds = worlds.len();
        worlds.sort_by(|a, b| a.remaining.cmp(&b.remaining).then(a.discards.cmp(&b.discards))
            .then(a.weight.total_cmp(&b.weight)));
        let mut merged: Vec<World> = Vec::with_capacity(worlds.len());
        for world in worlds {
            if !world.weight.is_finite() || world.weight < 0.0 {
                return Err("20.5.pegging2 received an invalid posterior weight".into());
            }
            if world.weight == 0.0 { continue; }
            if let Some(prior) = merged.last_mut().filter(|prior|
                prior.remaining == world.remaining && prior.discards == world.discards) {
                prior.weight += world.weight;
            } else { merged.push(world); }
        }
        let total: f64 = merged.iter().map(|w| w.weight).sum();
        if !total.is_finite() || total <= 0.0 {
            return Err("20.5.pegging2 has no finite positive posterior mass".into());
        }
        let states = merged.iter().map(|w| Ok(WeightedState {
            state: world_state(observation, w)?, weight: w.weight / total,
        })).collect::<Result<Vec<_>, String>>()?;
        self.stats.posterior_worlds += states.len();
        let mut unexamined = vec![0.0; states.len() + 1];
        for i in (0..states.len()).rev() { unexamined[i] = unexamined[i + 1] + states[i].weight; }
        let roundoff = (states.len() as f64 + 1.0) * f64::EPSILON;
        let allowance = if roundoff < 1.0 / 16.0 {
            64.0 * roundoff * unexamined[0].max(1.0)
        } else { f64::INFINITY };
        let mut best_wp = f64::NEG_INFINITY;
        let mut forecasts = Vec::new();
        for (action_index, &action) in actions.iter().enumerate() {
            let mut outcomes = BTreeMap::<(u8, u8), f64>::new();
            let mut partial = 0.0;
            let mut inferior = false;
            for (index, world) in states.iter().enumerate() {
                if index % 128 == 0 { self.check_cancelled()?; }
                let mut state = world.state.clone();
                state.apply_without_temporary_vectors(action)?;
                self.stats.transitions += 1;
                self.finish(&mut state)?;
                self.stats.candidate_worlds += 1;
                let own = u8::try_from(state.scores[0] - observation.my_score)
                    .map_err(|_| "20.5.pegging2 own score delta is out of range")?;
                let other = u8::try_from(state.scores[1] - observation.opponent_score)
                    .map_err(|_| "20.5.pegging2 opponent score delta is out of range")?;
                *outcomes.entry((own, other)).or_default() += world.weight;
                partial += world.weight * terminal_wp(self.board, observation.role, state.scores[0], state.scores[1]);
                if prune && partial + unexamined[index + 1] + allowance < best_wp {
                    inferior = true; self.stats.pruned_candidates += 1; break;
                }
            }
            if inferior { continue; }
            let candidate = PegCandidateForecast { action,
                outcomes: outcomes.into_iter().map(|((a, b), w)| (a, b, w)).collect(),
                posterior_worlds, evaluated_worlds: states.len() };
            best_wp = best_wp.max(self.key(observation, &candidate).0);
            forecasts.push(candidate);
            if self.stack.len() == 1 {
                if let Some(progress) = &self.progress { progress.complete(action_index + 1); }
            }
        }
        Ok(forecasts)
    }

    fn finish(&mut self, state: &mut RankPegState) -> Result<(), String> {
        let mut steps = 0;
        while !state.complete && state.winner.is_none() {
            self.check_cancelled()?;
            let legal = state.legal_actions();
            let action = match legal.as_slice() {
                [] => return Err("20.5.pegging2 reached a nonterminal dead end".into()),
                [forced] => *forced,
                _ => self.choose(&Model132Observation::from_state(state, state.current)?)?,
            };
            state.apply_without_temporary_vectors(action)?;
            self.stats.transitions += 1;
            steps += 1;
            if steps > 32 { return Err("20.5.pegging2 continuation did not terminate".into()); }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::information_set::{InfoActor, PegSeat, PublicPegEvent, RankPegEvent};
    use std::collections::HashSet;

    fn hand(ranks: &[usize]) -> [u8; 13] {
        let mut counts = [0; 13];
        for &rank in ranks { counts[rank] += 1; }
        counts
    }

    // Four prior deals provide uncertainty about BOTH players' hands. Each
    // actor knows which of its own variants it holds, but not the other's.
    fn population(scores: [i32; 2]) -> Vec<(RankPegState, f64)> {
        let mut worlds = Vec::new();
        for (a, pa) in [([0, 3, 4, 9], 0.75), ([0, 3, 4, 8], 0.25)] {
            for (b, pb) in [([2, 5, 6, 10], 0.625), ([2, 5, 6, 11], 0.375)] {
                worlds.push((RankPegState {
                    hands: [hand(&a), hand(&b)], own_discards: [hand(&[1, 7]), hand(&[1, 12])],
                    turn_rank: 12, scores, dealer: PegSeat::One, current: PegSeat::Zero,
                    plays: vec![], count: 0, go_player: None, last_player: None,
                    history: vec![], winner: None, complete: false,
                }, pa * pb));
            }
        }
        worlds
    }

    fn replay(original: &RankPegState, observation: &Model132Observation) -> Option<RankPegState> {
        let actor = if observation.role == Role::Dealer { original.dealer } else { original.dealer.other() };
        let mut state = original.clone();
        let target = observation.public_history.iter().map(|event| match event {
            PublicPegEvent::SelfPlay(rank) => RankPegEvent::Play { seat: actor, rank: *rank },
            PublicPegEvent::OpponentPlay(rank) => RankPegEvent::Play { seat: actor.other(), rank: *rank },
            PublicPegEvent::SelfGo => RankPegEvent::Go { seat: actor },
            PublicPegEvent::OpponentGo => RankPegEvent::Go { seat: actor.other() },
            PublicPegEvent::Reset => RankPegEvent::Reset,
        }).collect::<Vec<_>>();
        while state.history.len() < target.len() {
            let (seat, action) = match target[state.history.len()] {
                RankPegEvent::Play { seat, rank } => (seat, RankPegAction::Play(rank)),
                RankPegEvent::Go { seat } => (seat, RankPegAction::Go),
                RankPegEvent::Reset => return None,
            };
            if state.current != seat || state.apply(action).is_err() || !target.starts_with(&state.history) {
                return None;
            }
        }
        if state.complete || state.winner.is_some() || state.current != actor { return None; }
        (Model132Observation::from_state(&state, actor).ok()? == *observation).then_some(state)
    }

    fn posterior(population: &[(RankPegState, f64)], observation: &Model132Observation) -> Result<Vec<World>, String> {
        let mut result = Vec::new();
        for (original, weight) in population {
            if let Some(state) = replay(original, observation) {
                let other = state.current.other().index();
                result.push(World { remaining: state.hands[other], discards: state.own_discards[other], weight: *weight });
            }
        }
        if result.is_empty() { return Err("test posterior unexpectedly empty".into()); }
        Ok(result)
    }

    fn board() -> BoardWinMatrix {
        BoardWinMatrix::from_function(|_, dealer, pone|
            (0.5 + (f64::from(dealer) - f64::from(pone)) / 256.0).clamp(0.0, 1.0))
    }

    fn after_two_plays(mut state: RankPegState) -> RankPegState {
        state.apply(RankPegAction::Play(0)).unwrap();
        state.apply(RankPegAction::Play(2)).unwrap();
        state
    }

    // Independent reference: enumerate a small public forest, then visit its
    // distinct observations in ascending remaining-card order. Value each move
    // by replay using already selected child actions. No recursive solver,
    // pruning, memo admission, or optimized transitions are used for this table.
    fn backward_reference(
        population: &[(RankPegState, f64)], board: &BoardWinMatrix,
    ) -> HashMap<Model132Observation, (RankPegAction, f64)> {
        let mut pending = population.iter().map(|(state, _)| after_two_plays(state.clone())).collect::<Vec<_>>();
        let mut observations = HashSet::new();
        while let Some(state) = pending.pop() {
            if state.complete || state.winner.is_some() { continue; }
            if state.legal_actions().len() > 1 {
                observations.insert(Model132Observation::from_state(&state, state.current).unwrap());
            }
            for action in state.legal_actions() {
                let mut next = state.clone(); next.apply(action).unwrap(); pending.push(next);
            }
        }
        let mut observations = observations.into_iter().collect::<Vec<_>>();
        observations.sort_by_key(|o| rank_count_total(&o.own_remaining) + 4 - rank_count_total(&o.opponent_played));
        let mut result = HashMap::<Model132Observation, (RankPegAction, f64)>::new();
        for observation in observations {
            let worlds = posterior(population, &observation).unwrap();
            let total: f64 = worlds.iter().map(|w| w.weight).sum();
            let mut best = None;
            for action in observation.legal_actions() {
                let mut expectation = 0.0;
                for world in &worlds {
                    let mut state = world_state(&observation, world).unwrap();
                    state.apply(action).unwrap();
                    while !state.complete && state.winner.is_none() {
                        let legal = state.legal_actions();
                        let selected = if legal.len() == 1 { legal[0] } else {
                            let next = Model132Observation::from_state(&state, state.current).unwrap();
                            result.get(&next).expect("later bucket must already be solved").0
                        };
                        state.apply(selected).unwrap();
                    }
                    expectation += world.weight / total * terminal_wp(board, observation.role, state.scores[0], state.scores[1]);
                }
                let RankPegAction::Play(rank) = action else { panic!("nonforced go"); };
                let mut series = observation.current_series.clone(); series.push(rank);
                let key = (expectation, score_count_ranks(&series), rank);
                if best.as_ref().is_none_or(|(previous, _)| key > *previous) { best = Some((key, action)); }
            }
            let (key, action) = best.unwrap(); result.insert(observation, (action, key.0));
        }
        result
    }

    #[test]
    fn both_players_match_independent_bottom_up_bucket_table() {
        for scores in [[55, 58], [118, 117]] {
            let deals = population(scores);
            let board = board();
            let reference = backward_reference(&deals, &board);
            let belief = |o: &Model132Observation| posterior(&deals, o);
            let mut solver = Search::new(&belief, &board);
            // Largest buckets first require the production solver to resolve
            // their children itself; the reference did the reverse order.
            let mut observations = reference.keys().cloned().collect::<Vec<_>>();
            observations.sort_by_key(|o| std::cmp::Reverse(rank_count_total(&o.own_remaining) + 4 - rank_count_total(&o.opponent_played)));
            let mut roles = [0; 2];
            for observation in &observations {
                let expected = reference[observation];
                assert_eq!(solver.choose(observation).unwrap(), expected.0, "{observation:?}");
                let full = solver.evaluate(observation, belief(observation).unwrap(), &observation.legal_actions(), false).unwrap();
                let selected = full.iter().find(|candidate| candidate.action == expected.0).unwrap();
                assert!((solver.key(observation, selected).0 - expected.1).abs() < 1e-12);
                roles[usize::from(observation.role == Role::Dealer)] += 1;
            }
            assert!(roles.iter().all(|&count| count > 0));
            assert!(solver.stats.max_depth >= 3);
            assert!(solver.stats.cache_hits > 0);
        }
    }

    #[test]
    fn opponent_bucket_retains_alternatives_to_the_roots_actual_hand() {
        let deals = population([55, 58]); let board = board();
        let belief = |o: &Model132Observation| posterior(&deals, o);
        let mut a = after_two_plays(deals[0].0.clone());
        let mut changed_a = after_two_plays(deals[2].0.clone());
        for state in [&mut a, &mut changed_a] { state.apply(RankPegAction::Play(3)).unwrap(); }
        let first = Model132Observation::from_state(&a, a.current).unwrap();
        let second = Model132Observation::from_state(&changed_a, changed_a.current).unwrap();
        assert_eq!(first, second);
        let worlds = belief(&first).unwrap();
        assert_eq!(worlds.len(), 2);
        assert_ne!(worlds[0].remaining, worlds[1].remaining);
        assert_eq!(Search::new(&belief, &board).choose(&first).unwrap(),
            Search::new(&belief, &board).choose(&second).unwrap());
    }

    #[test]
    fn world_order_splitting_cache_order_and_pruning_preserve_choices() {
        let deals = population([55, 58]); let board = board();
        let belief = |o: &Model132Observation| posterior(&deals, o);
        let altered = |o: &Model132Observation| {
            let mut worlds = belief(o)?;
            worlds.reverse();
            Ok(worlds.iter().flat_map(|w| [World { weight: w.weight / 2.0, ..w.clone() },
                World { weight: w.weight / 2.0, ..w.clone() }]).collect())
        };
        let reference = backward_reference(&deals, &board);
        let mut reordered = Search::new(&altered, &board); reordered.prune = false;
        let mut pruned = Search::new(&belief, &board);
        for (observation, (action, _)) in &reference {
            assert_eq!(reordered.choose(observation).unwrap(), *action);
            assert_eq!(pruned.choose(observation).unwrap(), *action);
        }
    }

    #[test]
    fn scoreouts_force_terminal_values_and_cancelled_search_does_not_cache_partial_answers() {
        let deals = population([119, 120]); let board = board();
        let belief = |o: &Model132Observation| posterior(&deals, o);
        let mut observation = Model132Observation::from_state(&after_two_plays(deals[0].0.clone()), PegSeat::Zero).unwrap();
        observation.role = Role::Dealer;
        observation.own_remaining = hand(&[0, 4, 9, 10]);
        observation.count = 10; observation.current_series = vec![9];
        observation.own_played = [0; 13]; observation.opponent_played = hand(&[9]);
        observation.public_history = vec![PublicPegEvent::OpponentPlay(9)];
        observation.last_player = Some(InfoActor::Opponent);
        let worlds = vec![World { remaining: hand(&[2, 5, 6]), discards: hand(&[1, 12]), weight: 1.0 }];
        let never = |_: &Model132Observation| -> Result<Vec<World>, String> { panic!("winner must terminate before another bucket"); };
        let mut solver = Search::new(&never, &board);
        let values = solver.evaluate(&observation, worlds, &[RankPegAction::Play(4)], false).unwrap();
        assert_eq!(values[0].outcomes, vec![(2, 0, 1.0)]);
        assert_eq!(solver.key(&observation, &values[0]).0, 1.0);
        let progress = Arc::new(crate::progress::DecisionProgress::default()); progress.cancel();
        crate::progress::with_progress(progress, || {
            let observation = Model132Observation::from_state(&after_two_plays(deals[0].0.clone()), PegSeat::Zero).unwrap();
            let mut cancelled = Search::new(&belief, &board);
            assert_eq!(cancelled.choose(&observation), Err(crate::progress::CANCELLED_ERROR.into()));
            assert!(cancelled.choices.is_empty());
        });
    }

    #[test]
    fn invalid_weights_are_rejected_and_role_utilities_are_complementary() {
        let deals = population([55, 58]); let board = board();
        let observation = Model132Observation::from_state(&after_two_plays(deals[0].0.clone()), PegSeat::Zero).unwrap();
        let belief = |o: &Model132Observation| posterior(&deals, o);
        for invalid in [f64::NAN, f64::INFINITY, -0.25] {
            let mut worlds = belief(&observation).unwrap(); worlds[0].weight = invalid;
            assert!(Search::new(&belief, &board).evaluate(&observation, worlds, &observation.legal_actions(), false).is_err());
        }
        for (dealer, pone) in [(0, 0), (55, 58), (120, 120), (121, 120), (119, 121)] {
            assert_eq!(terminal_wp(&board, Role::Dealer, dealer, pone)
                + terminal_wp(&board, Role::Pone, pone, dealer), 1.0);
        }
    }

    /// Explicit opt-in diagnostic. Production has no wall-clock cutoff or
    /// fallback. Cancellation here returns an error and records work completed.
    #[test]
    #[ignore = "requires explicit fixture/output paths; may perform expensive full posterior searches"]
    fn saved_fixture_feasibility_screen() {
        let fixtures: serde_json::Value = serde_json::from_slice(&std::fs::read(
            std::env::var("PEGGING2_FIXTURES").expect("fixture path")).unwrap()).unwrap();
        let output = std::path::PathBuf::from(std::env::var("PEGGING2_OUTPUT").expect("output path"));
        let asset_root = std::path::PathBuf::from(std::env::var("CRIBBAGE_RUST_MODEL_ROOT").expect("asset root"));
        let assets = PolicyAssets::load_model205(&asset_root.join("rust/cribbage-shadow-engine/assets")).unwrap();
        let beliefs = assets.decision_policy().unwrap();
        let board = assets.wp_board.as_ref().unwrap();
        let seconds = std::env::var("PEGGING2_TIMEOUT_SECONDS").unwrap_or_else(|_| "30".into()).parse::<u64>().unwrap();
        let mut rows = Vec::new();
        for fixture in fixtures.as_array().unwrap() {
            let mut input = crate::model::parse_decision_input(fixture["inputText"].as_str().unwrap()).unwrap();
            input.model = crate::model_id::MODEL_20_5_PEGGING2.into();
            let observation = crate::model::model1323_observation(&input);
            let progress = Arc::new(crate::progress::DecisionProgress::default());
            let timer_progress = Arc::clone(&progress);
            let (stop, stopped) = std::sync::mpsc::channel();
            let timer = std::thread::spawn(move || {
                if stopped.recv_timeout(std::time::Duration::from_secs(seconds)).is_err() { timer_progress.cancel(); }
            });
            let start = std::time::Instant::now();
            let (result, stats) = crate::progress::with_progress(progress, || {
                let posterior = |o: &Model132Observation| assets.worlds_for_hand(o, &beliefs, None);
                let mut search = Search::new(&posterior, board);
                let result = posterior(&observation).and_then(|worlds|
                    search.evaluate(&observation, worlds, &observation.legal_actions(), false))
                    .and_then(|forecasts| {
                        let decision = crate::model::select_saved_model1323_forecasts(
                            &input, asset_root.to_str().unwrap(), &forecasts,
                        )?;
                        let crate::model::Decision::Peg { card_id, win_probability, .. } = decision
                            else { return Err("expected a pegging decision".into()); };
                        let rank = card_id.map(|id| id % 13);
                        let action = rank.map(RankPegAction::Play).unwrap_or(RankPegAction::Go);
                        let chosen = forecasts.iter().find(|f| f.action == action).unwrap();
                        Ok(serde_json::json!({"rank":rank,"winProbability":win_probability,
                            "posteriorWorlds":chosen.posterior_worlds}))
                    });
                (result, search.stats)
            });
            let elapsed = start.elapsed().as_secs_f64();
            let _ = stop.send(()); timer.join().unwrap();
            let row = match result {
                Ok(decision) => serde_json::json!({"fixture":fixture,"status":"complete","seconds":elapsed,"decision":decision,"stats":stats}),
                Err(error) if error == crate::progress::CANCELLED_ERROR => serde_json::json!({"fixture":fixture,"status":"cancelled_at_limit","limitSeconds":seconds,"seconds":elapsed,"stats":stats}),
                Err(error) => panic!("unexpected fixture error: {error}"),
            };
            rows.push(row);
            std::fs::write(&output, serde_json::to_vec_pretty(&rows).unwrap()).unwrap();
        }
    }
}
