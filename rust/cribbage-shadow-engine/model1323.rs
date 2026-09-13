//! Model 13.23's live candidate forecasts. Board utility is applied by the
//! caller; continuation actions use the unchanged correction-builder policy.
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
use crate::model91::Model91EmpiricalBeliefs;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;

/// Identities recorded by the running correction builder, in header order:
/// beliefs, decline factors, keep prior, discard prior, baseline keep pairs.
pub const CORRECTION_INPUT_CHECKSUMS: [u64; 5] = [
    0xd448af761929fc49,
    0x16c335c394fc6faf,
    0x67d164d96f8e4674,
    0x6f52321c1516e5c0,
    0x1457241478e3d307,
];
pub const LIVE_WORLD_BUDGET: usize = 512;

pub struct PolicyAssets {
    beliefs: Model91EmpiricalBeliefs,
    factors: Model1322DeclineFactors,
    discards: OpponentDiscardPrior,
}

impl PolicyAssets {
    pub fn load(directory: &Path) -> Result<Self, String> {
        for (name, expected) in [
            (
                "model91-pegging-beliefs.bin",
                "2823cdf5357e4fbab379b09f2aad8d45a53a423e852e920e0c54b7ff57b7c6af",
            ),
            (
                "model1322-decline-factors.json",
                "4dfb1b8c20f612153a6b0d57496fd77c5219a8a2ba7e01acb8909b862d5418dc",
            ),
            (
                "model1322-opponent-discard-histograms.json",
                "c2b274d38e94f8ff5c0aeabcddf7980dee89ae374af7564330f6d7e69193ac87",
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
        Ok(Self {
            beliefs: Model91EmpiricalBeliefs::load(directory.join("model91-pegging-beliefs.bin"))?,
            factors: Model1322DeclineFactors::load(
                directory.join("model1322-decline-factors.json"),
            )?,
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
        // All action/evidence/continuation memoization is decision-local.
        let policy = Model911Policy::new_with_evidence_cache(
            Some(self.beliefs.clone()),
            self.factors,
            100_000,
            300_000,
            1_000_000,
        )?;
        let worlds = self.worlds(observation, &policy)?;
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
        forecast_worlds(observation, &policy, &worlds, count)
    }

    fn worlds(
        &self,
        observation: &Model132Observation,
        policy: &Model911Policy,
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
        for (remaining, hand_weight) in policy.opponent_hands(observation)? {
            let initial =
                std::array::from_fn(|rank| remaining[rank] + observation.opponent_played[rank]);
            let variants = self.discards.conditioned(
                opponent_role,
                &initial,
                &own_six,
                observation.turn_rank,
            )?;
            let total: f64 = variants.iter().map(|(_, weight)| weight).sum();
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
                worlds.extend(variants.into_iter().map(|(discards, weight)| World {
                    remaining,
                    discards,
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
            let own =
                u8::try_from(state.scores[0] - observation.my_score).map_err(|e| e.to_string())?;
            let opponent = u8::try_from(state.scores[1] - observation.opponent_score)
                .map_err(|e| e.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model132::rollout_model132_world;

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
