//! Correlation trial: value each world before merging its terminal score bin.
//! Pruning uses WP <= 1, since the old marginal-context bounds do not apply.
use super::*;
pub(crate) struct JointForecast {
    pub forecast: PegCandidateForecast,
    pub wp: f64,
}
impl PreparedDecision<'_> {
    pub(crate) fn forecast_joint(
        &self,
        actions: &[RankPegAction],
        cache: Option<&HandCache>,
        prune: bool,
        value: &mut impl FnMut(&[u8; 13], &[u8; 13], u8, u8) -> Result<f64, String>,
    ) -> Result<Vec<JointForecast>, String> {
        let worlds = self.assets.worlds_for_hand_with_posterior(
            self.observation,
            &self.policy,
            cache,
            Some(&self.hands),
        )?;
        let count = worlds.len();
        let worlds = sample_worlds(worlds, usize::MAX, observation_seed(self.observation))?;
        forecast(
            self.observation,
            &self.policy,
            &worlds,
            count,
            actions,
            prune,
            value,
        )
    }
}
fn forecast(
    o: &Model132Observation,
    policy: &impl Model132PeggingPolicy,
    worlds: &[World],
    count: usize,
    actions: &[RankPegAction],
    prune: bool,
    value: &mut impl FnMut(&[u8; 13], &[u8; 13], u8, u8) -> Result<f64, String>,
) -> Result<Vec<JointForecast>, String> {
    let mut actions = actions.to_vec();
    if prune {
        direct_bounds::ordering::order(o, &mut actions);
    }
    let total: f64 = worlds.iter().map(|w| w.weight).sum();
    let mut remaining = vec![0.0; worlds.len() + 1];
    for i in (0..worlds.len()).rev() {
        remaining[i] = remaining[i + 1] + worlds[i].weight;
    }
    let roundoff = (worlds.len() as f64 + 1.0) * f64::EPSILON;
    let allowance = if roundoff < 1.0 / 16.0 {
        64.0 * roundoff * remaining[0].max(1.0)
    } else {
        f64::INFINITY
    };
    let mut incumbent = f64::NEG_INFINITY;
    let mut forecasts = Vec::new();
    let mut storage = rollout_storage::RolloutStorage::default();
    let mut scratch = Model132ObservationScratch::default();
    let batch = policy.rollout_batch_size().clamp(1, 32);
    let mut scores = Vec::new();
    let progress = crate::progress::current();
    if let Some(p) = &progress {
        p.begin(actions.len() * worlds.len());
    }
    for (action_index, action) in actions.into_iter().enumerate() {
        let mut outcomes = BTreeMap::new();
        let mut wp = 0.0;
        let mut inferior = false;
        for (i, w) in worlds.iter().enumerate() {
            if i % 256 == 0 {
                if let Some(p) = &progress {
                    p.check_cancelled()?;
                    p.complete(action_index * worlds.len() + i);
                }
            }
            if batch > 1 && i % batch == 0 {
                if storage
                    .batch(
                        o,
                        policy,
                        &worlds[i..(i + batch).min(worlds.len())],
                        action,
                        &mut scores,
                    )
                    .is_err()
                {
                    scores.clear();
                }
            }
            let (a, b) = if let Some(&score) = scores.get(i % batch) {
                score
            } else {
                storage.scalar(o, policy, w, action, &mut scratch)?
            };
            let v = value(&w.remaining, &w.discards, a, b)?;
            if !v.is_finite() || !(0.0..=1.0).contains(&v) {
                return Err("joint WP outside [0,1]".into());
            }
            wp += w.weight * v;
            *outcomes.entry((a, b)).or_insert(0.0) += w.weight;
            if prune && i + 1 < worlds.len() && wp + remaining[i + 1] + allowance < incumbent {
                inferior = true;
                break;
            }
        }
        if let Some(p) = &progress {
            p.complete((action_index + 1) * worlds.len());
        }
        if inferior {
            continue;
        }
        let normalized = wp / total;
        incumbent = incumbent.max(wp);
        forecasts.push(JointForecast {
            wp: normalized,
            forecast: PegCandidateForecast {
                action,
                outcomes: outcomes.into_iter().map(|((a, b), w)| (a, b, w)).collect(),
                posterior_worlds: count,
                evaluated_worlds: worlds.len(),
            },
        });
    }
    forecasts.sort_by_key(|f| match f.forecast.action {
        RankPegAction::Play(r) => r,
        RankPegAction::Go => 13,
    });
    Ok(forecasts)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pruned_and_full_joint_values_choose_identically() {
        let o = Model132Observation {
            role: Role::Pone,
            my_score: 70,
            opponent_score: 71,
            own_remaining: {
                let mut h = [0; 13];
                h[0] = 2;
                h[3] = 2;
                h
            },
            own_played: [0; 13],
            opponent_played: [0; 13],
            own_discards: {
                let mut h = [0; 13];
                h[4] = 2;
                h
            },
            turn_rank: 12,
            current_series: vec![],
            count: 0,
            go_player: None,
            last_player: None,
            public_history: vec![],
        };
        let worlds = vec![
            World {
                remaining: {
                    let mut h = [0; 13];
                    h[7] = 4;
                    h
                },
                discards: {
                    let mut h = [0; 13];
                    h[8] = 2;
                    h
                },
                weight: 0.6,
            },
            World {
                remaining: {
                    let mut h = [0; 13];
                    h[9] = 4;
                    h
                },
                discards: {
                    let mut h = [0; 13];
                    h[10] = 2;
                    h
                },
                weight: 0.4,
            },
        ];
        struct First;
        impl Model132PeggingPolicy for First {
            fn choose_action(&self, o: &Model132Observation) -> Result<RankPegAction, String> {
                Ok(o.legal_actions()[0])
            }
        }
        let val = |h: &[u8; 13], d: &[u8; 13], a: u8, b: u8| {
            Ok((50.0 + f64::from(a) - f64::from(b) + f64::from(h[7]) + f64::from(d[8])) / 100.0)
        };
        let full = forecast(
            &o,
            &First,
            &worlds,
            2,
            &o.legal_actions(),
            false,
            &mut val.clone(),
        )
        .unwrap();
        let reference = forecast_world_actions(&o, &First, &worlds, 2, &o.legal_actions()).unwrap();
        for (a, b) in full.iter().zip(&reference) {
            assert_eq!(a.forecast.action, b.action);
            assert_eq!(a.forecast.outcomes, b.outcomes);
        }
        let pruned = forecast(
            &o,
            &First,
            &worlds,
            2,
            &o.legal_actions(),
            true,
            &mut val.clone(),
        )
        .unwrap();
        let varied: Vec<_> = (1..=40)
            .map(|n| World {
                weight: 1.0 / f64::from(n * n * n),
                ..worlds[(n % 2) as usize].clone()
            })
            .collect();
        let certain = forecast(
            &o,
            &First,
            &varied,
            40,
            &o.legal_actions(),
            true,
            &mut |_, _, _, _| Ok(1.0),
        )
        .unwrap();
        assert_eq!(certain.len(), o.legal_actions().len());
        for f in certain {
            assert_eq!(f.wp.to_bits(), 1.0f64.to_bits());
        }
        let best = full.iter().map(|f| f.wp).fold(0.0, f64::max);
        assert!(pruned.iter().any(|f| f.wp == best));
        for a in &pruned {
            let b = full
                .iter()
                .find(|b| b.forecast.action == a.forecast.action)
                .unwrap();
            assert_eq!(a.wp.to_bits(), b.wp.to_bits());
            assert_eq!(a.forecast.outcomes, b.forecast.outcomes);
        }
    }
}
