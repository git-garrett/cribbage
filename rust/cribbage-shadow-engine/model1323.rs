//! Model 13.23's live candidate forecasts, with opt-in Model 20 beliefs.
//! Board utility is applied by the caller. The default continuation policy
//! preserves the frozen correction builder.
//! Only finite outcome distributions leave this module. No paths or actions
//! keyed by observations survive a decision.
use crate::board::Role;
use crate::cards::{
    enumerate_rank_count_keys, rank_combination_count, rank_count_key, rank_count_total,
    rank_counts_from_key,
};
use crate::information_set::{
    InfoActor, PegSeat, PublicPegEvent, RankPegAction, RankPegEvent, RankPegState,
};
use crate::model132::{
    choose_for_state, Model1322DeclineFactors, Model132Observation, Model132PeggingPolicy,
    Model911Policy,
};
use crate::model20_discards::{Model20DiscardAsset, SuitedDiscardRates};
use crate::model91::{Model91EmpiricalBeliefs, OpponentHandCache};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Identities recorded by the running correction builder, in header order:
/// beliefs, decline factors, keep prior, discard prior, baseline keep pairs.
pub const CORRECTION_INPUT_CHECKSUMS: [u64; 5] = [
    0xd448af761929fc49,
    0x16c335c394fc6faf,
    0x67d164d96f8e4674,
    0x6f52321c1516e5c0,
    0x1457241478e3d307,
];
/// Production never samples. Finite budgets are retained only for diagnostic
/// comparisons through the explicit forecast interface.
pub const LIVE_WORLD_BUDGET: usize = usize::MAX;

/// One actor's current-hand card population and conditioned discard prior,
/// scoped to its asset fingerprint. History-dependent weights and solves stay fresh.
#[derive(Clone, Default)]
pub(crate) struct HandCache(Arc<Mutex<Option<HandPopulation>>>);

impl std::fmt::Debug for HandCache {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let population = self.0.lock().unwrap_or_else(|error| error.into_inner());
        formatter
            .debug_struct("Model1323HandCache")
            .field(
                "conditioned_keeps",
                &population.as_ref().map_or(0, |p| p.discards.len()),
            )
            .finish()
    }
}

impl HandCache {
    pub(crate) fn clear(&self) {
        *self.0.lock().unwrap_or_else(|error| error.into_inner()) = None;
    }

    #[cfg(test)]
    pub(crate) fn is_populated(&self) -> bool {
        self.0.lock().unwrap().is_some()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct HandIdentity {
    discard_asset_sha256: [u8; 32],
    role: Role,
    own_keep: [u8; 13],
    own_discards: [u8; 13],
    turn_rank: u8,
}

impl HandIdentity {
    fn from_observation(observation: &Model132Observation, discard_asset_sha256: [u8; 32]) -> Self {
        Self {
            discard_asset_sha256,
            role: observation.role,
            own_keep: std::array::from_fn(|rank| {
                observation.own_remaining[rank] + observation.own_played[rank]
            }),
            own_discards: observation.own_discards,
            turn_rank: observation.turn_rank,
        }
    }
}

struct DiscardSupport {
    variants: Vec<([u8; 13], f64)>,
    total: f64,
}

struct HandPopulation {
    identity: HandIdentity,
    opponent_hands: OpponentHandCache,
    discards: HashMap<[u8; 13], DiscardSupport>,
    #[cfg(test)]
    conditioning_calls: usize,
    #[cfg(test)]
    conditioning_hits: usize,
}

impl HandPopulation {
    fn new(identity: HandIdentity) -> Self {
        Self {
            identity,
            opponent_hands: OpponentHandCache::default(),
            discards: HashMap::new(),
            #[cfg(test)]
            conditioning_calls: 0,
            #[cfg(test)]
            conditioning_hits: 0,
        }
    }
}

pub struct PolicyAssets {
    beliefs: Model91EmpiricalBeliefs,
    factors: Model1322DeclineFactors,
    discards: OpponentDiscardPrior,
    discard_asset_sha256: [u8; 32],
    suit_rates: Option<[SuitedDiscardRates; 2]>,
    empirical_depletion: bool,
}

impl PolicyAssets {
    pub(crate) fn opening_keep_weights(
        &self,
        opponent_role: Role,
        available: &[u8; 13],
    ) -> Result<Vec<([u8; 13], f64)>, String> {
        self.beliefs.opening_hands(opponent_role, available)
    }

    fn load_pegging_inputs(
        directory: &Path,
    ) -> Result<(Model91EmpiricalBeliefs, Model1322DeclineFactors), String> {
        for (name, expected) in [
            (
                "model91-pegging-beliefs.bin",
                "2823cdf5357e4fbab379b09f2aad8d45a53a423e852e920e0c54b7ff57b7c6af",
            ),
            (
                "model1322-decline-factors.json",
                "4dfb1b8c20f612153a6b0d57496fd77c5219a8a2ba7e01acb8909b862d5418dc",
            ),
        ] {
            let bytes = fs::read(directory.join(name))
                .map_err(|e| format!("read 13.23 policy input {name}: {e}"))?;
            if format!("{:x}", Sha256::digest(bytes)) != expected {
                return Err(format!(
                    "13.23 policy input {name} differs from its correction builder"
                ));
            }
        }
        Ok((
            Model91EmpiricalBeliefs::load(directory.join("model91-pegging-beliefs.bin"))?,
            Model1322DeclineFactors::load(directory.join("model1322-decline-factors.json"))?,
        ))
    }

    pub fn load(directory: &Path) -> Result<Self, String> {
        let (beliefs, factors) = Self::load_pegging_inputs(directory)?;
        let path = directory.join("model1322-opponent-discard-histograms.json");
        let bytes = fs::read(&path).map_err(|e| format!("read 13.23 discard input: {e}"))?;
        let discard_asset_sha256 = Sha256::digest(&bytes);
        if format!("{discard_asset_sha256:x}")
            != "c2b274d38e94f8ff5c0aeabcddf7980dee89ae374af7564330f6d7e69193ac87"
        {
            return Err("13.23 discard input differs from its correction builder".into());
        }
        Ok(Self {
            empirical_depletion: false,
            beliefs,
            factors,
            suit_rates: None,
            discard_asset_sha256: discard_asset_sha256.into(),
            discards: OpponentDiscardPrior::load(
                &directory.join("model1322-opponent-discard-histograms.json"),
            )?,
        })
    }

    pub fn forecast(
        &self,
        observation: &Model132Observation,
        world_budget: usize,
    ) -> Result<Vec<PegCandidateForecast>, String> {
        self.forecast_with_hand_cache(observation, world_budget, None)
    }

    pub(crate) fn load_model20(directory: &Path) -> Result<Self, String> {
        let path = directory.join("model132-keep-prior.json");
        let bytes = fs::read(&path).map_err(|e| format!("read Model 20 keep prior: {e}"))?;
        if format!("{:x}", Sha256::digest(bytes))
            != "ce5f9e6fc81854d5a6cab52a539906298e65c70861afa54ddfaf94eb4c09b4a4"
        {
            return Err(
                "Model 20 keep prior differs from the frozen 13.23 builder input".to_string(),
            );
        }
        let (mut beliefs, factors) = Self::load_pegging_inputs(directory)?;
        beliefs.load_opening_keep_prior(&path)?;
        let packed =
            Model20DiscardAsset::load(&directory.join(crate::model20_discards::ASSET_NAME))?;
        Ok(Self {
            beliefs,
            factors,
            discard_asset_sha256: packed.fingerprint,
            discards: OpponentDiscardPrior {
                by_role_keep: packed.discards,
            },
            suit_rates: Some(packed.suits),
            empirical_depletion: true,
        })
    }

    pub(crate) fn suited_discard_rates(&self, role: Role) -> Result<&SuitedDiscardRates, String> {
        let rates = self
            .suit_rates
            .as_ref()
            .ok_or("Model 20 suited-discard evidence is missing")?;
        Ok(&rates[if role == Role::Dealer { 0 } else { 1 }])
    }

    pub(crate) fn forecast_with_hand_cache(
        &self,
        observation: &Model132Observation,
        world_budget: usize,
        cache: Option<&HandCache>,
    ) -> Result<Vec<PegCandidateForecast>, String> {
        let policy = self.decision_policy()?;
        let worlds = self.worlds_for_hand(observation, &policy, cache)?;
        self.forecast_population(observation, world_budget, &policy, worlds)
    }

    /// Exhaustive production choice. Only provably inferior candidates may
    /// stop early; every returned candidate has its full, unmodified histogram.
    /// `win_probability` must return a finite probability in [0, 1].
    pub(crate) fn forecast_for_choice(
        &self,
        observation: &Model132Observation,
        cache: Option<&HandCache>,
        win_probability: &mut impl FnMut(u8, u8) -> f64,
    ) -> Result<Vec<PegCandidateForecast>, String> {
        let policy = self.decision_policy()?;
        let worlds = self.worlds_for_hand(observation, &policy, cache)?;
        let count = worlds.len();
        let worlds = sample_worlds(worlds, LIVE_WORLD_BUDGET, observation_seed(observation))?;
        forecast_worlds_for_choice(observation, &policy, &worlds, count, win_probability)
    }

    fn decision_policy(&self) -> Result<Model911Policy, String> {
        // All action/evidence/continuation memoization is decision-local.
        let policy = Model911Policy::new_with_evidence_cache(
            Some(self.beliefs.clone()),
            self.factors,
            100_000,
            300_000,
            1_000_000,
        )?;
        policy.use_compact_continuations();
        if self.empirical_depletion {
            policy.use_empirical_depletion();
        }
        Ok(policy)
    }

    fn worlds_for_hand(
        &self,
        observation: &Model132Observation,
        policy: &Model911Policy,
        cache: Option<&HandCache>,
    ) -> Result<Vec<World>, String> {
        if let Some(cache) = cache {
            // Release the hand cache before the expensive decision-local solve.
            let mut population = cache.0.lock().unwrap_or_else(|error| error.into_inner());
            observation.validate()?;
            let identity = HandIdentity::from_observation(observation, self.discard_asset_sha256);
            if population.as_ref().is_none_or(|p| p.identity != identity) {
                *population = Some(HandPopulation::new(identity));
            }
            self.worlds_with_cache(observation, policy, population.as_mut())
        } else {
            self.worlds(observation, policy)
        }
    }

    #[cfg(test)]
    fn forecast_using(
        &self,
        observation: &Model132Observation,
        world_budget: usize,
        policy: &Model911Policy,
    ) -> Result<Vec<PegCandidateForecast>, String> {
        let worlds = self.worlds(observation, policy)?;
        self.forecast_population(observation, world_budget, policy, worlds)
    }

    fn forecast_population(
        &self,
        observation: &Model132Observation,
        world_budget: usize,
        policy: &impl Model132PeggingPolicy,
        worlds: Vec<World>,
    ) -> Result<Vec<PegCandidateForecast>, String> {
        // Late continuations are cheap enough to enumerate without sampling.
        let remaining = rank_count_total(&observation.own_remaining) + 4
            - rank_count_total(&observation.opponent_played);
        let budget = if remaining <= 4 {
            usize::MAX
        } else {
            world_budget
        };
        let count = worlds.len();
        let worlds = sample_worlds(worlds, budget, observation_seed(observation))?;
        forecast_worlds(observation, policy, &worlds, count)
    }

    fn worlds(
        &self,
        observation: &Model132Observation,
        policy: &Model911Policy,
    ) -> Result<Vec<World>, String> {
        self.worlds_with_cache(observation, policy, None)
    }

    fn worlds_with_cache(
        &self,
        observation: &Model132Observation,
        policy: &Model911Policy,
        mut population: Option<&mut HandPopulation>,
    ) -> Result<Vec<World>, String> {
        observation.validate()?;
        if rank_count_total(&observation.own_discards) != 2 {
            return Err("13.23 requires the actor's two known crib discards".into());
        }
        let own_six = std::array::from_fn(|rank| {
            observation.own_remaining[rank]
                + observation.own_played[rank]
                + observation.own_discards[rank]
        });
        let opponent_role = if observation.role == Role::Dealer {
            Role::Pone
        } else {
            Role::Dealer
        };
        let mut worlds = Vec::new();
        // Keep the finite initial-keep conditioning results until hand end.
        // Current posterior support below filters newly impossible worlds;
        // rescanning the whole conditioning cache would add work each turn.
        let mut hands = policy.opponent_hands_with_cache(
            observation,
            population.as_deref_mut().map(|p| &mut p.opponent_hands),
        )?;
        if hands.is_empty() {
            // A sparse empirical row can contain only hands excluded by the
            // actor's known cards or public history. Missing empirical support
            // is not physical impossibility. Reuse the same legal-information
            // weighting with a physical prior only at these undefined roots;
            // successful roots and the frozen continuation policy stay exact.
            let physical = Model911Policy::new(None, self.factors, 0, 0)?;
            hands = physical.opponent_hands_with_cache(
                observation,
                population.as_deref_mut().map(|p| &mut p.opponent_hands),
            )?;
        }
        for (remaining, hand_weight) in hands {
            let initial =
                std::array::from_fn(|rank| remaining[rank] + observation.opponent_played[rank]);
            let condition = || -> Result<DiscardSupport, String> {
                let variants = self.discards.conditioned(
                    opponent_role,
                    &initial,
                    &own_six,
                    observation.turn_rank,
                )?;
                let total = variants.iter().map(|(_, weight)| weight).sum();
                Ok(DiscardSupport { variants, total })
            };
            let fresh;
            let support = if let Some(population) = &mut population {
                use std::collections::hash_map::Entry;
                match population.discards.entry(initial) {
                    Entry::Occupied(entry) => {
                        #[cfg(test)]
                        {
                            population.conditioning_hits += 1;
                        }
                        entry.into_mut()
                    }
                    Entry::Vacant(entry) => {
                        #[cfg(test)]
                        {
                            population.conditioning_calls += 1;
                        }
                        entry.insert(condition()?)
                    }
                }
            } else {
                fresh = condition()?;
                &fresh
            };
            let total = support.total;
            let variants = &support.variants;
            if !total.is_finite() {
                return Err("13.23 posterior hand has invalid opponent-discard support".into());
            }
            if total <= 0.0 {
                // Conditioning a sparse prior can eliminate a keep that the
                // card-only posterior admitted. Normalize surviving worlds
                // together; fail only if the entire joint support is empty.
                continue;
            }
            // With <=1 opponent card there can never be an opponent choice;
            // private discards cannot affect a forced continuation. Collapse
            // that irrelevant dimension exactly, rather than sampling it.
            if rank_count_total(&remaining) <= 1 {
                worlds.push(World {
                    remaining,
                    discards: variants[0].0,
                    weight: hand_weight,
                });
            } else {
                worlds.extend(variants.iter().map(|(discards, weight)| World {
                    remaining,
                    discards: *discards,
                    weight: hand_weight * weight / total,
                }));
            }
        }
        if worlds.is_empty() {
            return Err("13.23 has no legal opponent worlds".into());
        }
        Ok(worlds)
    }
}

pub struct PegCandidateForecast {
    pub action: RankPegAction,
    /// Normalized joint future increments. Race-to-121 terminal scores are
    /// resolved in sequence during simulation, before hand/crib evaluation.
    pub outcomes: Vec<(u8, u8, f64)>,
    pub posterior_worlds: usize,
    pub evaluated_worlds: usize,
}

#[derive(Clone, Debug, PartialEq)]
struct World {
    remaining: [u8; 13],
    discards: [u8; 13],
    weight: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscardPriorFile {
    schema_version: u32,
    model_version: String,
    roles: BTreeMap<String, BTreeMap<String, BTreeMap<String, u64>>>,
    fallback_by_role: BTreeMap<String, BTreeMap<String, u64>>,
}

struct OpponentDiscardPrior {
    by_role_keep: HashMap<(Role, [u8; 13]), Vec<([u8; 13], u64)>>,
}

impl OpponentDiscardPrior {
    fn load(path: &Path) -> Result<Self, String> {
        let mut file: DiscardPriorFile =
            serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if file.schema_version != 1 || file.model_version != "13.22" {
            return Err("13.23 requires the correction builder's calibrated discard prior".into());
        }
        let mut by_role_keep = HashMap::new();
        for (role, label) in [(Role::Dealer, "dealer"), (Role::Pone, "pone")] {
            let mut keeps = file
                .roles
                .remove(label)
                .ok_or("missing discard-prior role")?;
            let fallback = file
                .fallback_by_role
                .remove(label)
                .ok_or("missing discard-prior fallback")?;
            for key in enumerate_rank_count_keys(4) {
                let keep = rank_counts_from_key(&key)?;
                let source = keeps.remove(&key).unwrap_or_else(|| fallback.clone());
                let mut variants = Vec::new();
                for (discard_key, weight) in source {
                    let discard = rank_counts_from_key(&discard_key)?;
                    if rank_count_total(&discard) != 2 {
                        return Err("invalid opponent discard prior".into());
                    }
                    if weight > 0 && (0..13).all(|rank| keep[rank] + discard[rank] <= 4) {
                        variants.push((discard, weight));
                    }
                }
                if variants.is_empty() {
                    return Err(format!("no discard prior for {label} {key}"));
                }
                // Stable order independent of map hashing.
                variants.sort_by_key(|(ranks, _)| rank_count_key(ranks));
                by_role_keep.insert((role, keep), variants);
            }
        }
        Ok(Self { by_role_keep })
    }

    fn conditioned(
        &self,
        role: Role,
        keep: &[u8; 13],
        own_six: &[u8; 13],
        cut: u8,
    ) -> Result<Vec<([u8; 13], f64)>, String> {
        let variants = self
            .by_role_keep
            .get(&(role, *keep))
            .ok_or("missing opponent keep prior")?;
        let mut baseline = [0; 13];
        let mut available = [0; 13];
        for rank in 0..13 {
            baseline[rank] = 4_u8
                .checked_sub(keep[rank])
                .ok_or("impossible opponent keep")?;
            available[rank] = baseline[rank]
                .checked_sub(own_six[rank])
                .ok_or("impossible hidden world")?;
        }
        Ok(variants
            .iter()
            .filter_map(|(discard, weight)| {
                let base = rank_combination_count(discard, &baseline);
                let actual = rank_combination_count(discard, &available);
                let copies = available[cut as usize].saturating_sub(discard[cut as usize]);
                if base <= 0.0 || actual <= 0.0 || copies == 0 {
                    return None;
                }
                // Match the frozen builder's integer reweighting before conditioning
                // on the known cut. Normalize within each posterior keep afterward.
                let adjusted = (*weight as f64 * actual / base).round() as u64;
                (adjusted > 0).then_some((*discard, adjusted as f64 * f64::from(copies)))
            })
            .collect())
    }
}

fn observation_seed(observation: &Model132Observation) -> u64 {
    let mut key = observation.clone();
    // Changing board scores changes utility, not the sampled card population.
    key.my_score = 0;
    key.opponent_score = 0;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut hasher);
    hasher.finish()
}

fn sample_worlds(mut worlds: Vec<World>, budget: usize, seed: u64) -> Result<Vec<World>, String> {
    let total: f64 = worlds.iter().map(|world| world.weight).sum();
    if budget == 0
        || worlds.is_empty()
        || !total.is_finite()
        || total <= 0.0
        || worlds
            .iter()
            .any(|world| !world.weight.is_finite() || world.weight <= 0.0)
    {
        return Err("invalid 13.23 posterior population or sample budget".into());
    }
    if worlds.len() <= budget {
        for world in &mut worlds {
            world.weight /= total;
        }
        return Ok(worlds);
    }
    let mut selected: Vec<(usize, usize)> = Vec::new();
    let mut index = 0;
    let mut cumulative = worlds[0].weight;
    for sample in 0..budget {
        let mut random = seed.wrapping_add((sample as u64 + 1).wrapping_mul(0x9e3779b97f4a7c15));
        random = (random ^ (random >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        random = (random ^ (random >> 27)).wrapping_mul(0x94d049bb133111eb);
        random ^= random >> 31;
        let fraction = (random >> 11) as f64 / (1_u64 << 53) as f64;
        let target = (sample as f64 + fraction) * total / budget as f64;
        while target >= cumulative && index + 1 < worlds.len() {
            index += 1;
            cumulative += worlds[index].weight;
        }
        if let Some((_, count)) = selected
            .last_mut()
            .filter(|(previous, _)| *previous == index)
        {
            *count += 1;
        } else {
            selected.push((index, 1));
        }
    }
    Ok(selected
        .into_iter()
        .map(|(index, count)| World {
            weight: count as f64 / budget as f64,
            ..worlds[index].clone()
        })
        .collect())
}

fn world_state(observation: &Model132Observation, world: &World) -> Result<RankPegState, String> {
    let relative = |actor: InfoActor| {
        if actor == InfoActor::SelfPlayer {
            PegSeat::Zero
        } else {
            PegSeat::One
        }
    };
    let state = RankPegState {
        hands: [observation.own_remaining, world.remaining],
        own_discards: [observation.own_discards, world.discards],
        turn_rank: observation.turn_rank,
        scores: [observation.my_score, observation.opponent_score],
        dealer: if observation.role == Role::Dealer {
            PegSeat::Zero
        } else {
            PegSeat::One
        },
        current: PegSeat::Zero,
        plays: observation.current_series.clone(),
        count: observation.count,
        go_player: observation.go_player.map(relative),
        last_player: observation.last_player.map(relative),
        history: observation
            .public_history
            .iter()
            .map(|event| match event {
                PublicPegEvent::SelfPlay(rank) => RankPegEvent::Play {
                    seat: PegSeat::Zero,
                    rank: *rank,
                },
                PublicPegEvent::OpponentPlay(rank) => RankPegEvent::Play {
                    seat: PegSeat::One,
                    rank: *rank,
                },
                PublicPegEvent::SelfGo => RankPegEvent::Go {
                    seat: PegSeat::Zero,
                },
                PublicPegEvent::OpponentGo => RankPegEvent::Go { seat: PegSeat::One },
                PublicPegEvent::Reset => RankPegEvent::Reset,
            })
            .collect(),
        winner: None,
        complete: false,
    };
    if Model132Observation::from_state(&state, PegSeat::Zero)? != *observation {
        return Err("13.23 public history disagrees with the live card observation".into());
    }
    for rank in 0..13 {
        let total = state.hands[0][rank]
            + state.hands[1][rank]
            + state.own_discards[0][rank]
            + state.own_discards[1][rank]
            + observation.own_played[rank]
            + observation.opponent_played[rank]
            + u8::from(rank == observation.turn_rank as usize);
        if total > 4 {
            return Err("13.23 posterior world exceeds the physical deck".into());
        }
    }
    Ok(state)
}

fn forecast_worlds(
    observation: &Model132Observation,
    policy: &impl Model132PeggingPolicy,
    worlds: &[World],
    posterior_worlds: usize,
) -> Result<Vec<PegCandidateForecast>, String> {
    let mut forecasts = Vec::new();
    for action in observation.legal_actions() {
        let mut outcomes = BTreeMap::new();
        for world in worlds {
            let (own, opponent) = rollout_candidate(observation, policy, world, action)?;
            *outcomes.entry((own, opponent)).or_insert(0.0) += world.weight;
        }
        forecasts.push(PegCandidateForecast {
            action,
            outcomes: outcomes
                .into_iter()
                .map(|((own, opponent), weight)| (own, opponent, weight))
                .collect(),
            posterior_worlds,
            evaluated_worlds: worlds.len(),
        });
    }
    Ok(forecasts)
}

/// A challenger can be discarded only when its accumulated WP plus *all*
/// unevaluated probability mass is below a completely evaluated incumbent.
/// Histograms and final WP sums retain the reference's canonical order.
fn forecast_worlds_for_choice(
    observation: &Model132Observation,
    policy: &impl Model132PeggingPolicy,
    worlds: &[World],
    posterior_worlds: usize,
    win_probability: &mut impl FnMut(u8, u8) -> f64,
) -> Result<Vec<PegCandidateForecast>, String> {
    let progress = crate::progress::current();
    let actions = observation.legal_actions();
    if let Some(progress) = &progress {
        progress.begin(worlds.len() * actions.len());
    }
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
    let mut incumbent = f64::NEG_INFINITY;
    let mut forecasts = Vec::new();
    let mut utilities = BTreeMap::new();
    for (action_index, action) in actions.into_iter().enumerate() {
        let mut outcomes = BTreeMap::new();
        let mut partial_wp = 0.0;
        let mut inferior = false;
        for (index, world) in worlds.iter().enumerate() {
            if index % 256 == 0 {
                if let Some(progress) = &progress {
                    progress.complete(action_index * worlds.len() + index);
                }
            }
            let score = rollout_candidate(observation, policy, world, action)?;
            *outcomes.entry(score).or_insert(0.0) += world.weight;
            let utility = *utilities
                .entry(score)
                .or_insert_with(|| win_probability(score.0, score.1));
            if !utility.is_finite() || !(0.0..=1.0).contains(&utility) {
                return Err("13.23 choice bound requires a finite WP in [0, 1]".into());
            }
            partial_wp += world.weight * utility;
            if index + 1 < worlds.len() && partial_wp + remaining[index + 1] + allowance < incumbent
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
    Ok(forecasts)
}

fn rollout_candidate(
    observation: &Model132Observation,
    policy: &impl Model132PeggingPolicy,
    world: &World,
    action: RankPegAction,
) -> Result<(u8, u8), String> {
    let mut state = world_state(observation, world)?;
    state.apply(action)?;
    let mut steps = 0;
    while !state.complete && state.winner.is_none() {
        let legal = state.legal_actions();
        let next = match legal.as_slice() {
            [] => return Err("13.23 forecast has no action before completion".into()),
            [forced] => *forced,
            _ => choose_for_state(policy, &state, state.current)?,
        };
        state.apply(next)?;
        steps += 1;
        if steps > 32 {
            return Err("13.23 forecast failed to finish pegging".into());
        }
    }
    Ok((
        u8::try_from(state.scores[0] - observation.my_score).map_err(|e| e.to_string())?,
        u8::try_from(state.scores[1] - observation.opponent_score).map_err(|e| e.to_string())?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model132::rollout_model132_world;

    fn assert_identical_forecasts(
        actual: &[PegCandidateForecast],
        expected: &[PegCandidateForecast],
    ) {
        assert_eq!(actual.len(), expected.len());
        for (actual, expected) in actual.iter().zip(expected) {
            assert_eq!(actual.action, expected.action);
            assert_eq!(actual.posterior_worlds, expected.posterior_worlds);
            assert_eq!(actual.evaluated_worlds, expected.evaluated_worlds);
            let bits = |forecast: &PegCandidateForecast| {
                forecast
                    .outcomes
                    .iter()
                    .map(|(own, opponent, weight)| (*own, *opponent, weight.to_bits()))
                    .collect::<Vec<_>>()
            };
            assert_eq!(bits(actual), bits(expected));
        }
    }

    #[test]
    fn model20_enriched_discards_preserve_every_legacy_suit_rate() {
        use crate::artifacts::EmpiricalDiscardKeepTable;
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
        let packed =
            Model20DiscardAsset::load(&directory.join(crate::model20_discards::ASSET_NAME))
                .unwrap();
        // Conditional weights now include later games. The Python packing tests
        // compare every rank weight against the retained raw-count evidence.
        assert_eq!(packed.discards.len(), 3640);
        let legacy =
            EmpiricalDiscardKeepTable::load_edk1(directory.join("empirical-discard-keep-14.8.bin"))
                .unwrap();
        for (old, new) in [&legacy.dealer, &legacy.pone]
            .into_iter()
            .zip(&packed.suits)
        {
            assert_eq!(
                old.suited_discard_rate.to_bits(),
                new.overall_rate.to_bits()
            );
            assert_eq!(
                old.distinct_suited_discard_rate.to_bits(),
                new.distinct_rate.to_bits()
            );
            for (entry, evidence) in old.discards.iter().zip(&new.pairs) {
                assert_eq!(u64::from(entry.count), evidence.observations);
                assert_eq!(
                    (entry.count as f64 * entry.suited_rate).round() as u64,
                    evidence.same_suit
                );
                assert_eq!(
                    entry.suited_rate.to_bits(),
                    new.rate(&entry.ranks).to_bits()
                );
            }
        }
    }

    #[test]
    fn model20_loads_without_either_legacy_discard_asset() {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
        let directory =
            std::env::temp_dir().join(format!("model20-packed-only-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        for name in [
            "model91-pegging-beliefs.bin",
            "model1322-decline-factors.json",
            "model132-keep-prior.json",
            crate::model20_discards::ASSET_NAME,
        ] {
            fs::copy(source.join(name), directory.join(name)).unwrap();
        }
        let assets = PolicyAssets::load_model20(&directory).unwrap();
        assert_eq!(assets.discards.by_role_keep.len(), 3640);
        for role in [Role::Dealer, Role::Pone] {
            assert!(assets.suited_discard_rates(role).is_ok());
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "release-only, paired asset-loading timing probe"]
    fn model20_discard_asset_load_timing() {
        use crate::artifacts::EmpiricalDiscardKeepTable;
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
        let mut old_times = Vec::new();
        let mut new_times = Vec::new();
        for iteration in 0..22 {
            for mode in [iteration % 2, 1 - iteration % 2] {
                let start = std::time::Instant::now();
                if mode == 0 {
                    let ranks = OpponentDiscardPrior::load(
                        &directory.join("model1322-opponent-discard-histograms.json"),
                    )
                    .unwrap();
                    let suits = EmpiricalDiscardKeepTable::load_edk1(
                        directory.join("empirical-discard-keep-14.8.bin"),
                    )
                    .unwrap();
                    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                    std::hint::black_box((&ranks, &suits));
                    if iteration >= 2 {
                        old_times.push(elapsed);
                    }
                } else {
                    let packed = Model20DiscardAsset::load(
                        &directory.join(crate::model20_discards::ASSET_NAME),
                    )
                    .unwrap();
                    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                    std::hint::black_box(&packed);
                    if iteration >= 2 {
                        new_times.push(elapsed);
                    }
                }
            }
        }
        old_times.sort_by(f64::total_cmp);
        new_times.sort_by(f64::total_cmp);
        let report = serde_json::json!({
            "legacyMedianMs": (old_times[9] + old_times[10]) / 2.0,
            "packedMedianMs": (new_times[9] + new_times[10]) / 2.0,
            "legacyMs": old_times,
            "packedMs": new_times,
        });
        fs::write(
            std::env::temp_dir().join("model20-discard-asset-load-timing.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
        println!(
            "asset-load median legacy_ms={:.3} packed_ms={:.3} repetitions={}",
            (old_times[9] + old_times[10]) / 2.0,
            (new_times[9] + new_times[10]) / 2.0,
            new_times.len()
        );
    }

    #[test]
    fn model20_loads_empirical_opening_prior_without_changing_frozen_ace() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets");
        let frozen = PolicyAssets::load(&directory).unwrap();
        let model20 = PolicyAssets::load_model20(&directory).unwrap();
        let physical = Model911Policy::new(None, frozen.factors, 0, 0).unwrap();
        let mut observation = opening().0;
        for role in [Role::Dealer, Role::Pone] {
            observation.role = role;
            let original = frozen
                .decision_policy()
                .unwrap()
                .opponent_hands_with_cache(&observation, None)
                .unwrap();
            assert_eq!(
                original,
                physical
                    .opponent_hands_with_cache(&observation, None)
                    .unwrap()
            );
            let policy = model20.decision_policy().unwrap();
            let corrected = policy
                .opponent_hands_with_cache(&observation, None)
                .unwrap();
            assert!(!corrected.is_empty());
            assert_ne!(corrected, original);
            let cache = HandCache::default();
            let expected = model20.worlds(&observation, &policy).unwrap();
            for _ in 0..2 {
                let actual = model20
                    .worlds_for_hand(&observation, &policy, Some(&cache))
                    .unwrap();
                assert_eq!(actual.len(), expected.len());
                for (actual, expected) in actual.iter().zip(&expected) {
                    assert_eq!(actual.remaining, expected.remaining);
                    assert_eq!(actual.discards, expected.discards);
                    assert_eq!(actual.weight.to_bits(), expected.weight.to_bits());
                }
            }
        }
    }

    #[test]
    fn model20_requires_the_frozen_empirical_keep_asset() {
        let directory =
            std::env::temp_dir().join(format!("model20-keep-prior-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        assert!(PolicyAssets::load_model20(&directory)
            .err()
            .unwrap()
            .contains("read Model 20 keep prior"));
        fs::write(directory.join("model132-keep-prior.json"), b"{}").unwrap();
        assert!(PolicyAssets::load_model20(&directory)
            .err()
            .unwrap()
            .contains("differs from the frozen"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn hand_cache_preserves_world_order_weights_and_samples_through_complete_hands() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let policy =
            Model911Policy::new(Some(assets.beliefs.clone()), assets.factors, 0, 0).unwrap();
        let caches = [HandCache::default(), HandCache::default()];
        for (ranks, discards, cut) in [
            ([0, 3, 4, 9], [1, 6], 10),
            ([4, 4, 5, 9], [6, 12], 10),
            ([0, 1, 2, 3], [9, 12], 8),
            ([0, 1, 1, 1], [1, 4], 10),
        ] {
            let (mut observation, world) = opening();
            observation.own_remaining = hand(&ranks);
            observation.own_discards = hand(&discards);
            observation.turn_rank = cut;
            let mut state = world_state(&observation, &world).unwrap();
            let mut observations = Vec::new();
            while !state.complete {
                let observation = Model132Observation::from_state(&state, state.current).unwrap();
                observations.push((state.current.index(), observation));
                state.apply(state.legal_actions()[0]).unwrap();
            }
            // Rewinds and alternating identities must also yield fresh-equivalent results.
            for (actor, observation) in observations.iter().chain(observations.iter().rev()) {
                let expected = assets.worlds(observation, &policy);
                let actual = assets.worlds_for_hand(observation, &policy, Some(&caches[*actor]));
                let expected = match expected {
                    Ok(worlds) => worlds,
                    Err(error) => {
                        // Preserve the frozen policy's empty-support failure too.
                        assert_eq!(actual.unwrap_err(), error);
                        continue;
                    }
                };
                let actual = actual.unwrap();
                assert_eq!(actual.len(), expected.len());
                for (a, b) in actual.iter().zip(&expected) {
                    assert_eq!(
                        (a.remaining, a.discards, a.weight.to_bits()),
                        (b.remaining, b.discards, b.weight.to_bits())
                    );
                }
                assert_eq!(
                    sample_worlds(actual, LIVE_WORLD_BUDGET, observation_seed(observation))
                        .unwrap(),
                    sample_worlds(expected, LIVE_WORLD_BUDGET, observation_seed(observation))
                        .unwrap()
                );
            }
            assert!(caches.iter().any(|cache| cache
                .0
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .conditioning_hits
                > 0));
        }
        for cache in caches {
            cache.clear();
            assert!(cache.0.lock().unwrap().is_none());
        }
    }

    #[test]
    fn hand_cache_reuses_conditioning_but_recomputes_late_forecasts_exactly() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let policy =
            Model911Policy::new(Some(assets.beliefs.clone()), assets.factors, 0, 0).unwrap();
        let caches = [HandCache::default(), HandCache::default()];
        let (observation, world) = opening();
        let mut state = world_state(&observation, &world).unwrap();
        while !state.complete {
            let observation = Model132Observation::from_state(&state, state.current).unwrap();
            let cache = &caches[state.current.index()];
            assets
                .worlds_for_hand(&observation, &policy, Some(cache))
                .unwrap();
            if state.hands.iter().map(rank_count_total).sum::<u8>() <= 4 {
                let expected = assets.forecast(&observation, LIVE_WORLD_BUDGET).unwrap();
                let actual = assets
                    .forecast_with_hand_cache(&observation, LIVE_WORLD_BUDGET, Some(cache))
                    .unwrap();
                assert_identical_forecasts(&actual, &expected);
            }
            state.apply(state.legal_actions()[0]).unwrap();
        }
        assert!(caches.iter().all(|cache| cache
            .0
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .conditioning_hits
            > 0));
    }

    #[test]
    #[ignore = "full-budget multi-turn exact forecast and population timing probe"]
    fn hand_cache_full_budget_equivalence_and_timing() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let policy =
            Model911Policy::new(Some(assets.beliefs.clone()), assets.factors, 0, 0).unwrap();
        let caches = [HandCache::default(), HandCache::default()];
        let (observation, world) = opening();
        let mut state = world_state(&observation, &world).unwrap();
        let mut report = Vec::new();
        let mut turns = [0, 0];
        let population_caches = [HandCache::default(), HandCache::default()];
        while !state.complete {
            let actor = state.current.index();
            let observation = Model132Observation::from_state(&state, state.current).unwrap();
            let mut population_seconds = [0.0, 0.0];
            // Repeated fresh timing isolates the small card-population cost.
            // The cached population is evaluated once per actual turn; the
            // separate forecast cache has not been warmed on the current turn.
            let mut fresh = Vec::new();
            let start = std::time::Instant::now();
            for _ in 0..100 {
                fresh = assets.worlds(&observation, &policy).unwrap();
            }
            population_seconds[0] = start.elapsed().as_secs_f64() / 100.0;
            let start = std::time::Instant::now();
            let actual = assets
                .worlds_for_hand(&observation, &policy, Some(&population_caches[actor]))
                .unwrap();
            population_seconds[1] = start.elapsed().as_secs_f64();
            assert_eq!(actual, fresh);
            let start = std::time::Instant::now();
            let expected = assets.forecast(&observation, LIVE_WORLD_BUDGET).unwrap();
            let uncached_seconds = start.elapsed().as_secs_f64();
            let start = std::time::Instant::now();
            let actual = assets
                .forecast_with_hand_cache(&observation, LIVE_WORLD_BUDGET, Some(&caches[actor]))
                .unwrap();
            let cached_seconds = start.elapsed().as_secs_f64();
            assert_identical_forecasts(&actual, &expected);
            let cache = caches[actor].0.lock().unwrap();
            let cache = cache.as_ref().unwrap();
            report.push(serde_json::json!({"actor":actor,"actorTurn":turns[actor],
                "populationSeconds":population_seconds,"uncachedSeconds":uncached_seconds,
                "cachedSeconds":cached_seconds,"bitExact":true,"budget":LIVE_WORLD_BUDGET,
                "conditionedKeeps":cache.discards.len(),"conditioningCalls":cache.conditioning_calls,
                "conditioningHits":cache.conditioning_hits}));
            turns[actor] += 1;
            state.apply(state.legal_actions()[0]).unwrap();
        }
        fs::write(
            std::env::temp_dir().join("model1323-hand-cache-equivalence.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn compact_live_forecasts_preserve_every_joint_bin_and_weight() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let (observation, world) = opening();
        let mut state = world_state(&observation, &world).unwrap();
        for _ in 0..4 {
            state.apply(state.legal_actions()[0]).unwrap();
        }
        let observation = Model132Observation::from_state(&state, state.current).unwrap();
        let policy = Model911Policy::new_with_evidence_cache(
            Some(assets.beliefs.clone()),
            assets.factors,
            100_000,
            300_000,
            1_000_000,
        )
        .unwrap();
        let expected = assets
            .forecast_using(&observation, LIVE_WORLD_BUDGET, &policy)
            .unwrap();
        let actual = assets.forecast(&observation, LIVE_WORLD_BUDGET).unwrap();
        assert_identical_forecasts(&actual, &expected);
    }

    #[test]
    #[ignore = "full-budget release-mode differential and timing probe"]
    fn compact_full_budget_reference_equivalence() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let (opening, world) = opening();
        let mut state = world_state(&opening, &world).unwrap();
        let mut cases = vec![("opening", opening.clone())];
        state.apply(state.legal_actions()[0]).unwrap();
        cases.push((
            "dealer-first-reply",
            Model132Observation::from_state(&state, state.current).unwrap(),
        ));
        for _ in 0..3 {
            state.apply(state.legal_actions()[0]).unwrap();
        }
        cases.push((
            "two-versus-two",
            Model132Observation::from_state(&state, state.current).unwrap(),
        ));
        let mut endgame = opening;
        endgame.my_score = 119;
        endgame.opponent_score = 120;
        endgame.current_series = vec![12];
        endgame.count = 10;
        endgame.opponent_played[12] = 1;
        endgame.last_player = Some(InfoActor::Opponent);
        endgame.public_history = vec![PublicPegEvent::OpponentPlay(12)];
        cases.push(("count-out", endgame));
        for (label, ranks, discards, cut) in [
            ("opening-fives", [4, 4, 5, 9], [6, 12], 10),
            ("opening-low-run", [0, 1, 2, 3], [9, 12], 8),
            ("opening-high-cards", [8, 9, 10, 11], [4, 12], 0),
            ("opening-sparse-prior", [0, 1, 1, 1], [1, 4], 10),
        ] {
            let (mut observation, _) = self::opening();
            observation.own_remaining = hand(&ranks);
            observation.own_discards = hand(&discards);
            observation.turn_rank = cut;
            cases.push((label, observation));
        }
        let (mut close_race, _) = self::opening();
        close_race.my_score = 116;
        close_race.opponent_score = 118;
        cases.push(("close-race", close_race));
        let mut report = Vec::new();
        for (label, observation) in cases {
            let policy = Model911Policy::new_with_evidence_cache(
                Some(assets.beliefs.clone()),
                assets.factors,
                100_000,
                300_000,
                1_000_000,
            )
            .unwrap();
            let start = std::time::Instant::now();
            let expected = assets
                .forecast_using(&observation, LIVE_WORLD_BUDGET, &policy)
                .unwrap();
            let reference_seconds = start.elapsed().as_secs_f64();
            let reference_stats = policy.stats();
            drop(policy);
            let policy = Model911Policy::new_with_evidence_cache(
                Some(assets.beliefs.clone()),
                assets.factors,
                100_000,
                300_000,
                1_000_000,
            )
            .unwrap();
            policy.use_compact_continuations();
            let start = std::time::Instant::now();
            let actual = assets
                .forecast_using(&observation, LIVE_WORLD_BUDGET, &policy)
                .unwrap();
            let compact_seconds = start.elapsed().as_secs_f64();
            let compact_stats = policy.stats();
            assert_identical_forecasts(&actual, &expected);
            report.push(
                serde_json::json!({"fixture":label,"referenceSeconds":reference_seconds,
                "compactSeconds":compact_seconds,"speedup":reference_seconds/compact_seconds,
                "referenceFutureStates":reference_stats.random_future_states,
                "compactFutureStates":compact_stats.random_future_states,
                "referenceCacheClears":reference_stats.future_cache_capacity_clears,
                "compactCacheClears":compact_stats.future_cache_capacity_clears,
                "referenceEvaluatedDecisions":reference_stats.evaluated_decisions,
                "compactEvaluatedDecisions":compact_stats.evaluated_decisions,
                "budget":LIVE_WORLD_BUDGET,"posteriorWorlds":actual[0].posterior_worlds,
                "evaluatedWorlds":actual[0].evaluated_worlds,"bitExact":true}),
            );
            fs::write(
                std::env::temp_dir().join("model1323-compact-equivalence.json"),
                serde_json::to_vec_pretty(&report).unwrap(),
            )
            .unwrap();
        }
    }

    fn hand(ranks: &[usize]) -> [u8; 13] {
        let mut result = [0; 13];
        for rank in ranks {
            result[*rank] += 1;
        }
        result
    }

    fn opening() -> (Model132Observation, World) {
        (
            Model132Observation {
                role: Role::Pone,
                my_score: 0,
                opponent_score: 0,
                own_remaining: hand(&[0, 3, 4, 9]),
                own_played: [0; 13],
                opponent_played: [0; 13],
                own_discards: hand(&[1, 6]),
                turn_rank: 10,
                current_series: Vec::new(),
                count: 0,
                go_player: None,
                last_player: None,
                public_history: Vec::new(),
            },
            World {
                remaining: hand(&[2, 5, 8, 12]),
                discards: hand(&[7, 11]),
                weight: 1.0,
            },
        )
    }

    struct FirstLegal;
    impl Model132PeggingPolicy for FirstLegal {
        fn choose_action(
            &self,
            observation: &Model132Observation,
        ) -> Result<RankPegAction, String> {
            Ok(observation.legal_actions()[0])
        }
    }

    #[test]
    fn production_forecast_does_not_sample_hidden_worlds() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let (observation, world) = opening();
        let forecasts = assets
            .forecast_population(
                &observation,
                LIVE_WORLD_BUDGET,
                &FirstLegal,
                vec![world; 513],
            )
            .unwrap();
        assert!(forecasts
            .iter()
            .all(|f| f.evaluated_worlds == f.posterior_worlds));
    }

    #[test]
    fn choice_bound_preserves_full_histograms_and_never_eliminates_ties() {
        let (observation, world) = opening();
        let worlds = sample_worlds(vec![world; 513], usize::MAX, 0).unwrap();
        let full = forecast_worlds(&observation, &FirstLegal, &worlds, worlds.len()).unwrap();
        let target = (full[0].outcomes[0].0, full[0].outcomes[0].1);
        assert!(full
            .iter()
            .any(|f| (f.outcomes[0].0, f.outcomes[0].1) != target));
        for difference in [0.0, f64::EPSILON, 0.25] {
            let utility = |a, b| 0.5 + if (a, b) == target { difference } else { 0.0 };
            let bounded = forecast_worlds_for_choice(
                &observation,
                &FirstLegal,
                &worlds,
                worlds.len(),
                &mut |a, b| utility(a, b),
            )
            .unwrap();
            let progress = std::sync::Arc::new(crate::progress::DecisionProgress::default());
            let observed = crate::progress::with_progress(std::sync::Arc::clone(&progress), || {
                forecast_worlds_for_choice(&observation, &FirstLegal, &worlds, worlds.len(),
                    &mut |a, b| utility(a, b)).unwrap()
            });
            assert_identical_forecasts(&bounded, &observed);
            let total = worlds.len() * observation.legal_actions().len();
            assert_eq!(progress.snapshot(), (total, total), "pruned branches count as resolved");
            let score = |f: &PegCandidateForecast| {
                f.outcomes
                    .iter()
                    .map(|(a, b, w)| w * utility(*a, *b))
                    .sum::<f64>()
            };
            let best = full.iter().map(score).fold(f64::NEG_INFINITY, f64::max);
            // Preserve *every* tied winner so the production tie break is unchanged.
            for expected in full.iter().filter(|f| score(f) == best) {
                let actual = bounded
                    .iter()
                    .find(|f| f.action == expected.action)
                    .unwrap();
                assert_identical_forecasts(
                    std::slice::from_ref(actual),
                    std::slice::from_ref(expected),
                );
            }
            for actual in &bounded {
                let expected = full.iter().find(|f| f.action == actual.action).unwrap();
                assert_identical_forecasts(
                    std::slice::from_ref(actual),
                    std::slice::from_ref(expected),
                );
            }
            if difference <= f64::EPSILON {
                assert_eq!(bounded.len(), full.len());
            } else {
                assert!(
                    bounded.len() < full.len(),
                    "fixture must exercise actual early termination"
                );
            }
        }
    }

    #[test]
    fn choice_bound_matches_full_evaluation_with_unequal_world_weights() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let (observation, _) = opening();
        let policy = assets.decision_policy().unwrap();
        let worlds: Vec<_> = assets
            .worlds(&observation, &policy)
            .unwrap()
            .into_iter()
            .step_by(97)
            .take(64)
            .enumerate()
            .map(|(index, mut world)| {
                world.weight *= if index % 3 == 0 {
                    1e-12
                } else {
                    (index + 1) as f64
                };
                world
            })
            .collect();
        let worlds = sample_worlds(worlds, usize::MAX, 0).unwrap();
        let full = forecast_worlds(&observation, &FirstLegal, &worlds, worlds.len()).unwrap();
        for seed in 0..32_u32 {
            let utility = |a: u8, b: u8| {
                let hash =
                    (u32::from(a) * 65537 + u32::from(b) * 257 + seed).wrapping_mul(2654435761);
                f64::from(hash % 1025) / 1024.0
            };
            let actual = forecast_worlds_for_choice(
                &observation,
                &FirstLegal,
                &worlds,
                worlds.len(),
                &mut |a, b| utility(a, b),
            )
            .unwrap();
            let score = |f: &PegCandidateForecast| {
                f.outcomes
                    .iter()
                    .map(|(a, b, w)| w * utility(*a, *b))
                    .sum::<f64>()
            };
            let best = full.iter().map(score).fold(f64::NEG_INFINITY, f64::max);
            for winner in full.iter().filter(|f| score(f) == best) {
                assert!(actual.iter().any(|f| f.action == winner.action));
            }
            for candidate in actual {
                let expected = full.iter().find(|f| f.action == candidate.action).unwrap();
                assert_identical_forecasts(
                    std::slice::from_ref(&candidate),
                    std::slice::from_ref(expected),
                );
            }
        }
    }

    #[test]
    #[ignore = "release-mode exhaustive opening cost and cache probe"]
    fn exhaustive_opening_cost_probe() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let (observation, _) = opening();
        let limits: Vec<usize> = std::env::var("MODEL1323_PROBE_CACHES")
            .unwrap_or_else(|_| "100000,300000,1000000".into())
            .split(',')
            .map(|value| value.parse().unwrap())
            .collect();
        assert_eq!(limits.len(), 3);
        let policy = Model911Policy::new_with_evidence_cache(
            Some(assets.beliefs.clone()),
            assets.factors,
            limits[0],
            limits[1],
            limits[2],
        )
        .unwrap();
        policy.use_compact_continuations();
        let start = std::time::Instant::now();
        let forecasts = assets
            .forecast_using(&observation, usize::MAX, &policy)
            .unwrap();
        let report = serde_json::json!({
            "seconds": start.elapsed().as_secs_f64(),
            "cacheLimits": limits,
            "worlds": forecasts[0].posterior_worlds,
            "evaluatedWorlds": forecasts[0].evaluated_worlds,
            "stats": format!("{:?}", policy.stats()),
        });
        fs::write(
            std::env::temp_dir().join("model1323-exhaustive-opening.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
        assert_eq!(forecasts[0].evaluated_worlds, forecasts[0].posterior_worlds);
    }

    #[test]
    fn live_continuation_matches_builder_rollout() {
        let (observation, world) = opening();
        let expected = rollout_model132_world(
            [observation.own_remaining, world.remaining],
            [observation.own_discards, world.discards],
            Some(observation.turn_rank),
            PegSeat::One,
            &FirstLegal,
        )
        .unwrap();
        let forecasts = forecast_worlds(&observation, &FirstLegal, &[world], 1).unwrap();
        assert_eq!(forecasts.len(), 4);
        assert_eq!(forecasts[0].outcomes, vec![(expected.0, expected.1, 1.0)]);
    }

    #[test]
    fn unchanged_model911_policy_matches_builder_and_ignores_actor_invisible_cards() {
        let (observation, world) = opening();
        let factors = Model1322DeclineFactors::load(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/model1322-decline-factors.json"),
        )
        .unwrap();
        let beliefs = Model91EmpiricalBeliefs::load(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/model91-pegging-beliefs.bin"),
        )
        .unwrap();
        let policy = Model911Policy::new_with_evidence_cache(
            Some(beliefs),
            factors,
            10_000,
            10_000,
            100_000,
        )
        .unwrap();
        let root_action = policy.choose_action(&observation).unwrap();
        let expected = rollout_model132_world(
            [observation.own_remaining, world.remaining],
            [observation.own_discards, world.discards],
            Some(observation.turn_rank),
            PegSeat::One,
            &policy,
        )
        .unwrap();
        let forecasts = forecast_worlds(&observation, &policy, &[world.clone()], 1).unwrap();
        assert_eq!(
            forecasts
                .iter()
                .find(|f| f.action == root_action)
                .unwrap()
                .outcomes,
            vec![(expected.0, expected.1, 1.0)]
        );
        let alternate = World {
            remaining: hand(&[1, 7, 8, 11]),
            discards: hand(&[2, 12]),
            weight: 1.0,
        };
        for hidden in [world, alternate] {
            let state = world_state(&observation, &hidden).unwrap();
            assert_eq!(
                choose_for_state(&policy, &state, PegSeat::Zero).unwrap(),
                root_action
            );
        }
    }

    #[test]
    fn opponent_discard_conditioning_respects_own_six_and_cut() {
        let keep = hand(&[0, 1, 2, 3]);
        let own_six = hand(&[4, 4, 4, 5, 6, 7]);
        let impossible_with_cut = hand(&[4, 8]);
        let possible = hand(&[9, 10]);
        let prior = OpponentDiscardPrior {
            by_role_keep: HashMap::from([(
                (Role::Dealer, keep),
                vec![(impossible_with_cut, 100), (possible, 100)],
            )]),
        };
        let variants = prior.conditioned(Role::Dealer, &keep, &own_six, 4).unwrap();
        assert_eq!(variants, vec![(possible, 100.0)]);
    }

    #[test]
    fn benchmark_index_22_has_legal_opponent_worlds_after_three_fives() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let observation = Model132Observation {
            role: Role::Dealer,
            my_score: 9,
            opponent_score: 20,
            own_remaining: hand(&[2, 2, 3]),
            own_played: hand(&[4]),
            opponent_played: hand(&[4, 4]),
            own_discards: hand(&[5, 12]),
            turn_rank: 11,
            current_series: vec![4, 4, 4],
            count: 15,
            go_player: None,
            last_player: Some(InfoActor::Opponent),
            public_history: vec![
                PublicPegEvent::OpponentPlay(4),
                PublicPegEvent::SelfPlay(4),
                PublicPegEvent::OpponentPlay(4),
            ],
        };
        let policy = assets.decision_policy().unwrap();
        // The empirical row for two played fives contains only two more
        // fives, but the actor already held a fifth five in that world.
        assert!(policy.opponent_hands(&observation).unwrap().is_empty());
        let worlds = assets.worlds(&observation, &policy).unwrap();
        assert!(!worlds.is_empty());
        assert!(worlds.iter().all(|world| (0..13).all(|rank| {
            observation.own_remaining[rank] + observation.own_played[rank]
                + observation.own_discards[rank] + observation.opponent_played[rank]
                + world.remaining[rank] + world.discards[rank]
                + u8::from(observation.turn_rank as usize == rank) <= 4
        })));
        let cache = HandCache::default();
        assert_eq!(worlds, assets.worlds_for_hand(&observation, &policy, Some(&cache)).unwrap());
        let forecasts = assets.forecast(&observation, LIVE_WORLD_BUDGET).unwrap();
        assert_eq!(forecasts.len(), 2);
        for candidate in forecasts {
            assert!((candidate.outcomes.iter().map(|(_, _, weight)| weight).sum::<f64>() - 1.0).abs() < 1e-10);
        }
    }

    #[test]
    fn benchmark_index_94_physical_fallback_preserves_opponent_go_evidence() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let observation = Model132Observation {
            role: Role::Dealer,
            my_score: 38,
            opponent_score: 44,
            own_remaining: hand(&[7, 8]),
            own_played: hand(&[9, 10]),
            opponent_played: hand(&[0, 1, 2]),
            own_discards: hand(&[0, 12]),
            turn_rank: 6,
            current_series: vec![],
            count: 0,
            go_player: None,
            last_player: None,
            public_history: vec![
                PublicPegEvent::OpponentPlay(2),
                PublicPegEvent::SelfPlay(9),
                PublicPegEvent::OpponentPlay(1),
                PublicPegEvent::SelfPlay(10),
                PublicPegEvent::OpponentPlay(0),
                PublicPegEvent::SelfGo,
                PublicPegEvent::OpponentGo,
                PublicPegEvent::Reset,
            ],
        };
        let policy = assets.decision_policy().unwrap();
        assert!(policy.opponent_hands(&observation).unwrap().is_empty());
        let worlds = assets.worlds(&observation, &policy).unwrap();
        assert!(!worlds.is_empty());
        // The opponent said go at 26, so its last card must exceed five.
        assert!(worlds.iter().all(|world| world.remaining[..5] == [0; 5]));
        let cache = HandCache::default();
        assert_eq!(worlds, assets.worlds_for_hand(&observation, &policy, Some(&cache)).unwrap());
        let forecasts = assets.forecast(&observation, LIVE_WORLD_BUDGET).unwrap();
        assert_eq!(forecasts.len(), 2);
        assert!(forecasts.iter().all(|candidate| candidate.posterior_worlds == candidate.evaluated_worlds));
    }

    #[test]
    fn zero_support_keep_is_removed_without_rejecting_a_legal_position() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let (mut observation, _) = opening();
        observation.own_remaining = hand(&[0, 1, 1, 1]);
        observation.own_discards = hand(&[1, 4]);
        let unsupported = rank_counts_from_key("0000000110020").unwrap();
        let policy = Model911Policy::new_with_evidence_cache(
            Some(assets.beliefs.clone()),
            assets.factors,
            1000,
            1000,
            1000,
        )
        .unwrap();
        assert!(policy
            .opponent_hands(&observation)
            .unwrap()
            .iter()
            .any(|(ranks, _)| *ranks == unsupported));
        let worlds = assets.worlds(&observation, &policy).unwrap();
        assert!(!worlds.iter().any(|world| world.remaining == unsupported));
        let normalized = sample_worlds(worlds, usize::MAX, 0).unwrap();
        assert!((normalized.iter().map(|world| world.weight).sum::<f64>() - 1.0).abs() < 1e-10);
    }

    #[test]
    fn late_forecast_enumerates_the_full_posterior_even_with_budget_one() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let (observation, world) = opening();
        let mut state = world_state(&observation, &world).unwrap();
        while state
            .hands
            .iter()
            .flatten()
            .map(|n| usize::from(*n))
            .sum::<usize>()
            > 4
        {
            state.apply(state.legal_actions()[0]).unwrap();
        }
        let observation = Model132Observation::from_state(&state, state.current).unwrap();
        let forecasts = assets.forecast(&observation, 1).unwrap();
        assert!(!forecasts.is_empty());
        for candidate in forecasts {
            assert!(candidate.posterior_worlds > 1);
            assert_eq!(candidate.evaluated_worlds, candidate.posterior_worlds);
            assert!(
                (candidate
                    .outcomes
                    .iter()
                    .map(|(_, _, weight)| weight)
                    .sum::<f64>()
                    - 1.0)
                    .abs()
                    < 1e-10
            );
        }
    }

    #[test]
    fn scoring_out_stops_before_opponent_can_reply() {
        let (mut observation, mut world) = opening();
        observation.my_score = 119;
        observation.opponent_score = 120;
        observation.current_series = vec![12];
        observation.count = 10;
        observation.opponent_played[12] = 1;
        observation.last_player = Some(InfoActor::Opponent);
        observation.public_history = vec![PublicPegEvent::OpponentPlay(12)];
        world.remaining[12] -= 1;
        let forecasts = forecast_worlds(&observation, &FirstLegal, &[world], 1).unwrap();
        let fifteen = forecasts
            .iter()
            .find(|f| f.action == RankPegAction::Play(4))
            .unwrap();
        assert_eq!(fifteen.outcomes, vec![(2, 0, 1.0)]);
    }

    #[test]
    fn deterministic_sampling_preserves_mass_and_small_populations_are_exact() {
        let (_, world) = opening();
        let worlds: Vec<_> = (1..101)
            .map(|i| World {
                weight: i as f64,
                ..world.clone()
            })
            .collect();
        let selected = sample_worlds(worlds.clone(), 16, 42).unwrap();
        assert_eq!(selected, sample_worlds(worlds.clone(), 16, 42).unwrap());
        assert!((selected.iter().map(|w| w.weight).sum::<f64>() - 1.0).abs() < 1e-12);
        let exact = sample_worlds(worlds, 100, 7).unwrap();
        assert_eq!(exact.len(), 100);
        assert!((exact[0].weight - 1.0 / 5050.0).abs() < 1e-12);
    }

    #[test]
    fn board_scores_do_not_change_sampled_card_population() {
        let (mut observation, _) = opening();
        let seed = observation_seed(&observation);
        observation.my_score = 110;
        observation.opponent_score = 115;
        assert_eq!(observation_seed(&observation), seed);
    }

    #[test]
    #[ignore = "bounded release-mode forecast timing probe"]
    fn live_forecast_timing_probe() {
        let assets =
            PolicyAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
        let (observation, _) = opening();
        let mut report = Vec::new();
        for budget in [128, 512, 1024] {
            let start = std::time::Instant::now();
            let forecasts = assets.forecast(&observation, budget).unwrap();
            let means: Vec<_> = forecasts
                .iter()
                .map(|f| {
                    (
                        f.action,
                        f.outcomes
                            .iter()
                            .map(|(a, b, w)| (f64::from(*a) - f64::from(*b)) * w)
                            .sum::<f64>(),
                    )
                })
                .collect();
            report.push(serde_json::json!({"budget": budget, "seconds": start.elapsed().as_secs_f64(),
                "population": forecasts[0].posterior_worlds, "evaluated": forecasts[0].evaluated_worlds,
                "netMeans": format!("{means:?}"), "candidates": forecasts.iter().map(|f|
                    serde_json::json!({"action": format!("{:?}",f.action), "outcomes": f.outcomes})).collect::<Vec<_>>() }));
            fs::write(
                std::env::temp_dir().join("model1323-live-probe.json"),
                serde_json::to_vec_pretty(&report).unwrap(),
            )
            .unwrap();
        }
    }
}
