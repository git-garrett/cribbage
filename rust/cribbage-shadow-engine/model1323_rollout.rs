//! Storage reuse for one forecast. Game rules remain in RankPegState, and every
//! world and legal observation receives the reference path's validation.
use super::*;

#[derive(Default)]
pub(super) struct RolloutStorage {
    states: Vec<RankPegState>,
    steps: Vec<u8>,
    buffers: Vec<(Vec<u8>, Vec<PublicPegEvent>)>,
    root_buffers: (Vec<u8>, Vec<PublicPegEvent>),
    pending: Vec<usize>,
    observations: Vec<Model132Observation>,
}

impl RolloutStorage {
    pub(super) fn batch(
        &mut self, observation: &Model132Observation, policy: &impl Model132PeggingPolicy,
        worlds: &[World], action: RankPegAction, scores: &mut Vec<(u8, u8)>,
    ) -> Result<(), String> {
        if !policy.reuse_rollout_buffers() {
            *scores = rollout_candidate_batch(observation, policy, worlds, action)?;
            return Ok(());
        }
        self.run::<true>(observation, policy, worlds, action)?;
        scores.clear();
        for state in &self.states[..worlds.len()] {
            scores.push(score_delta(state, observation)?);
        }
        Ok(())
    }

    pub(super) fn scalar(
        &mut self, observation: &Model132Observation, policy: &impl Model132PeggingPolicy,
        world: &World, action: RankPegAction, scratch: &mut Model132ObservationScratch,
    ) -> Result<(u8, u8), String> {
        if !policy.reuse_rollout_buffers() {
            return rollout_candidate(observation, policy, world, action, scratch);
        }
        self.run::<false>(observation, policy, std::slice::from_ref(world), action)?;
        score_delta(&self.states[0], observation)
    }

    fn prepare(&mut self, observation: &Model132Observation, worlds: &[World]) -> Result<(), String> {
        // A speculative batch may have failed before its observations were
        // reclaimed. Never carry one world's observation into another query.
        for (index, obs) in self.pending.drain(..).zip(self.observations.drain(..)) {
            self.buffers[index] = (obs.current_series, obs.public_history);
        }
        self.steps.clear();
        self.steps.resize(worlds.len(), 0);
        for (index, world) in worlds.iter().enumerate() {
            if index == self.states.len() {
                let mut state = world_state(observation, world)?;
                // Typical complete-hand bounds, not new limits on accepted input.
                state.plays.reserve(8_usize.saturating_sub(state.plays.len()));
                state.history.reserve(32_usize.saturating_sub(state.history.len()));
                self.states.push(state);
                self.buffers.push((Vec::with_capacity(8), Vec::with_capacity(32)));
            } else {
                refill_world(&mut self.states[index], observation, world, &mut self.root_buffers)?;
            }
        }
        Ok(())
    }

    fn run<const BATCHED: bool>(
        &mut self, observation: &Model132Observation, policy: &impl Model132PeggingPolicy,
        worlds: &[World], action: RankPegAction,
    ) -> Result<(), String> {
        self.prepare(observation, worlds)?;
        for state in &mut self.states[..worlds.len()] {
            state.apply_without_temporary_vectors(action)?;
        }
        loop {
            if BATCHED {
                if let Some(progress) = crate::progress::current() { progress.check_cancelled()?; }
            }
            for index in 0..worlds.len() {
                while !self.states[index].complete && self.states[index].winner.is_none() {
                    let mask = self.states[index].legal_rank_mask();
                    if mask.count_ones() <= 1 {
                        let forced = if mask == 0 { RankPegAction::Go }
                            else { RankPegAction::Play(mask.trailing_zeros() as u8) };
                        self.states[index].apply_without_temporary_vectors(forced)?;
                        self.step::<BATCHED>(index)?;
                    } else {
                        let state = &self.states[index];
                        self.observations.push(Model132Observation::from_state_with_buffers(
                            state, state.current,
                            std::mem::take(&mut self.buffers[index].0),
                            std::mem::take(&mut self.buffers[index].1),
                        )?);
                        self.pending.push(index);
                        break;
                    }
                }
            }
            if self.pending.is_empty() { return Ok(()); }
            if BATCHED {
                let actions = policy.choose_actions(&self.observations)?;
                if actions.len() != self.pending.len() { return Err("incorrect batch action count".into()); }
                // Canonical lane order also preserves policy memo access order.
                for (offset, action) in actions.into_iter().enumerate() {
                    let index = self.pending[offset];
                    if !self.states[index].allows(action) { return Err("illegal batch action".into()); }
                    self.states[index].apply_without_temporary_vectors(action)?;
                    self.step::<BATCHED>(index)?;
                }
                for (index, obs) in self.pending.drain(..).zip(self.observations.drain(..)) {
                    self.buffers[index] = (obs.current_series, obs.public_history);
                }
            } else {
                let action = policy.choose_action(&self.observations[0])?;
                let index = self.pending[0];
                if !self.states[index].allows(action) {
                    return Err(format!("Model 13.2 policy returned illegal action {action:?}"));
                }
                let obs = self.observations.pop().unwrap();
                self.pending.clear();
                self.buffers[index] = (obs.current_series, obs.public_history);
                self.states[index].apply_without_temporary_vectors(action)?;
                self.step::<BATCHED>(index)?;
            }
        }
    }

    fn step<const BATCHED: bool>(&mut self, index: usize) -> Result<(), String> {
        self.steps[index] += 1;
        if self.steps[index] > 32 {
            return Err(if BATCHED { "batch failed to finish" } else { "13.23 forecast failed to finish pegging" }.into());
        }
        Ok(())
    }
}

fn score_delta(state: &RankPegState, root: &Model132Observation) -> Result<(u8, u8), String> {
    Ok((
        u8::try_from(state.scores[0] - root.my_score).map_err(|e| e.to_string())?,
        u8::try_from(state.scores[1] - root.opponent_score).map_err(|e| e.to_string())?,
    ))
}

fn refill_world(
    state: &mut RankPegState, observation: &Model132Observation, world: &World,
    root_buffers: &mut (Vec<u8>, Vec<PublicPegEvent>),
) -> Result<(), String> {
    let relative = |actor| if actor == InfoActor::SelfPlayer { PegSeat::Zero } else { PegSeat::One };
    state.hands = [observation.own_remaining, world.remaining];
    state.own_discards = [observation.own_discards, world.discards];
    state.turn_rank = observation.turn_rank;
    state.scores = [observation.my_score, observation.opponent_score];
    state.dealer = if observation.role == Role::Dealer { PegSeat::Zero } else { PegSeat::One };
    state.current = PegSeat::Zero;
    state.plays.clear();
    state.plays.extend_from_slice(&observation.current_series);
    state.count = observation.count;
    state.go_player = observation.go_player.map(relative);
    state.last_player = observation.last_player.map(relative);
    state.history.clear();
    state.history.extend(observation.public_history.iter().map(|event| match event {
        PublicPegEvent::SelfPlay(rank) => RankPegEvent::Play { seat: PegSeat::Zero, rank: *rank },
        PublicPegEvent::OpponentPlay(rank) => RankPegEvent::Play { seat: PegSeat::One, rank: *rank },
        PublicPegEvent::SelfGo => RankPegEvent::Go { seat: PegSeat::Zero },
        PublicPegEvent::OpponentGo => RankPegEvent::Go { seat: PegSeat::One },
        PublicPegEvent::Reset => RankPegEvent::Reset,
    }));
    state.winner = None;
    state.complete = false;
    let reconstructed = Model132Observation::from_state_with_buffers(
        state, PegSeat::Zero, std::mem::take(&mut root_buffers.0), std::mem::take(&mut root_buffers.1),
    )?;
    let matches = reconstructed == *observation;
    *root_buffers = (reconstructed.current_series, reconstructed.public_history);
    if !matches { return Err("13.23 public history disagrees with the live card observation".into()); }
    for rank in 0..13 {
        let total = state.hands[0][rank] + state.hands[1][rank]
            + state.own_discards[0][rank] + state.own_discards[1][rank]
            + observation.own_played[rank] + observation.opponent_played[rank]
            + u8::from(rank == observation.turn_rank as usize);
        if total > 4 { return Err("13.23 posterior world exceeds the physical deck".into()); }
    }
    Ok(())
}
