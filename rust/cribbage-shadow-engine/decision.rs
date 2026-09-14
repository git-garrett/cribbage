use crate::board::Role;
use crate::game::{CribbageGame, Side};
use crate::information_set::perspective_history;
use crate::model::{
    self, Decision, DecisionInput, DecisionKind, Model13HandCache, Model16PolicyMode,
    Model911HandCache, PlayerKey,
};
use crate::model_id::ModelId;

#[derive(Clone, Debug, PartialEq)]
pub struct DiscardDecision {
    pub card_ids: Vec<u8>,
    pub best_lead: Option<u8>,
    pub ev: Option<f64>,
    pub win_probability: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PegDecision {
    Go,
    Play {
        card_id: u8,
        ev: Option<f64>,
        win_probability: Option<f64>,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReviewedDecisionValue {
    pub card_ids: Vec<u8>,
    pub ev: Option<f64>,
    pub win_probability: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DecisionReview {
    pub selected: ReviewedDecisionValue,
    pub recommended: ReviewedDecisionValue,
}

pub fn recommend_discard_for_side(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    root: &str,
) -> Result<DiscardDecision, String> {
    ensure_native_model(model_id)?;
    let input = decision_input(game, side, model_id, DecisionKind::Discard, None);
    match model::evaluate_decision(&input, root)? {
        Decision::Discard {
            card_ids,
            best_lead,
            ev,
            win_probability,
        } => Ok(DiscardDecision {
            card_ids,
            best_lead,
            ev,
            win_probability,
        }),
        Decision::Peg { .. } => Err("discard decision returned pegging action".to_string()),
    }
}

pub fn recommend_peg_for_side(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    peg_lead: Option<u8>,
    root: &str,
) -> Result<PegDecision, String> {
    recommend_peg_for_side_with_model911_cache(game, side, model_id, peg_lead, root, None)
}

pub fn recommend_peg_for_side_with_model911_cache(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    peg_lead: Option<u8>,
    root: &str,
    model911_cache: Option<&Model911HandCache>,
) -> Result<PegDecision, String> {
    recommend_peg_for_side_with_caches(game, side, model_id, peg_lead, root, model911_cache, None)
}

pub fn recommend_peg_for_side_with_caches(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    peg_lead: Option<u8>,
    root: &str,
    model911_cache: Option<&Model911HandCache>,
    model13_cache: Option<&Model13HandCache>,
) -> Result<PegDecision, String> {
    ensure_native_model(model_id)?;
    let input = decision_input(game, side, model_id, DecisionKind::Peg, peg_lead);
    match model::evaluate_decision_with_caches(&input, root, model911_cache, model13_cache)? {
        Decision::Peg {
            action,
            card_id: _,
            ev: _,
            ..
        } if action == "go" => Ok(PegDecision::Go),
        Decision::Peg {
            action,
            card_id: Some(card_id),
            ev,
            win_probability,
            ..
        } if action == "play" => Ok(PegDecision::Play {
            card_id,
            ev,
            win_probability,
        }),
        Decision::Peg { action, .. } => Err(format!("unsupported pegging action: {}", action)),
        Decision::Discard { .. } => Err("pegging decision returned discard action".to_string()),
    }
}

/// Compare a saved discard against the requested Ace decision at that exact
/// game state. Callers use the production Ace version so results remain
/// comparable within an evaluator version.
pub fn review_discard_for_side(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    selected_card_ids: [u8; 2],
    root: &str,
) -> Result<DecisionReview, String> {
    review_discard_for_side_with_recommendation(game, side, model_id, selected_card_ids, None, root)
}

pub fn review_discard_for_side_with_recommendation(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    selected_card_ids: [u8; 2],
    recommended: Option<ReviewedDecisionValue>,
    root: &str,
) -> Result<DecisionReview, String> {
    let input = decision_input(game, side, model_id, DecisionKind::Discard, None);
    review_for_side(
        &input,
        &selected_card_ids,
        recommended,
        root,
        DecisionKind::Discard,
    )
}

/// Compare a saved peg play against the requested Ace decision at that exact
/// game state.
pub fn review_peg_for_side(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    selected_card_id: u8,
    root: &str,
) -> Result<DecisionReview, String> {
    review_peg_for_side_with_recommendation(game, side, model_id, selected_card_id, None, root)
}

pub fn review_peg_for_side_with_recommendation(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    selected_card_id: u8,
    recommended: Option<ReviewedDecisionValue>,
    root: &str,
) -> Result<DecisionReview, String> {
    let input = decision_input(game, side, model_id, DecisionKind::Peg, None);
    review_for_side(
        &input,
        &[selected_card_id],
        recommended,
        root,
        DecisionKind::Peg,
    )
}

fn review_for_side(
    input: &DecisionInput,
    selected_card_ids: &[u8],
    recommended: Option<ReviewedDecisionValue>,
    root: &str,
    kind: DecisionKind,
) -> Result<DecisionReview, String> {
    if let Some(recommended) = recommended {
        let mut selected_ids = selected_card_ids.to_vec();
        let mut recommended_ids = recommended.card_ids.clone();
        selected_ids.sort_unstable();
        recommended_ids.sort_unstable();
        let selected = if selected_ids == recommended_ids {
            recommended.clone()
        } else {
            review_value(
                model::evaluate_selected_decision(input, selected_card_ids, root)?,
                kind,
            )?
        };
        return Ok(DecisionReview {
            selected,
            recommended,
        });
    }
    let review = model::review_decision(input, selected_card_ids, root)?;
    Ok(DecisionReview {
        selected: review_value(review.selected, kind)?,
        recommended: review_value(review.recommended, kind)?,
    })
}

fn review_value(decision: Decision, kind: DecisionKind) -> Result<ReviewedDecisionValue, String> {
    match (kind, decision) {
        (
            DecisionKind::Discard,
            Decision::Discard {
                card_ids,
                ev,
                win_probability,
                ..
            },
        ) => Ok(ReviewedDecisionValue {
            card_ids,
            ev,
            win_probability,
        }),
        (
            DecisionKind::Peg,
            Decision::Peg {
                action,
                card_id: Some(card_id),
                ev,
                win_probability,
                ..
            },
        ) if action == "play" => Ok(ReviewedDecisionValue {
            card_ids: vec![card_id],
            ev,
            win_probability,
        }),
        (DecisionKind::Peg, Decision::Peg { action, .. }) => Err(format!(
            "review returned unsupported pegging action: {}",
            action
        )),
        _ => Err("review returned the wrong decision kind".to_string()),
    }
}

fn ensure_native_model(model_id: ModelId) -> Result<(), String> {
    if model_id.has_native_rust_decisions() {
        Ok(())
    } else {
        Err(format!(
            "{} does not yet have native Rust decision support",
            model_id.as_str()
        ))
    }
}

fn decision_input(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    kind: DecisionKind,
    peg_lead: Option<u8>,
) -> DecisionInput {
    let opponent = side.other();
    DecisionInput {
        kind,
        model: model_id.as_str().to_string(),
        player: PlayerKey::Ai,
        role: role_for_side(game, side),
        ai_score: game.player(side).score,
        human_score: game.player(opponent).score,
        ai_hand: game.player(side).hand.clone(),
        ai_table: game.player(side).table.clone(),
        human_table: game.player(opponent).table.clone(),
        human_hand_count: game.player(opponent).hand.len(),
        own_discards: game.player(side).discarded_to_crib.clone(),
        turn_card: game.turn_card,
        count: game.count,
        turn: PlayerKey::Ai,
        go_player: mapped_player(game.go_player, side),
        last_player: mapped_player(game.last_player, side),
        plays: game.plays.clone(),
        public_history: perspective_history(game, side),
        peg_lead,
        model16_policy_mode: Model16PolicyMode::Argmax,
        model16_policy_sample: 0,
        decision_seed: server_decision_seed(game, side, kind),
    }
}

fn server_decision_seed(game: &CribbageGame, side: Side, kind: DecisionKind) -> u64 {
    let side_tag = match side {
        Side::Left => 0x4c45_4654_u64,
        Side::Right => 0x5249_4748_u64,
    };
    let kind_tag = match kind {
        DecisionKind::Discard => 0x4449_5343_u64,
        DecisionKind::Peg => 0x5045_4721_u64,
    };
    (u64::from(game.rng_state) << 32) ^ u64::from(game.hand_number) ^ side_tag ^ kind_tag
}

fn role_for_side(game: &CribbageGame, side: Side) -> Role {
    if side == game.dealer {
        Role::Dealer
    } else {
        Role::Pone
    }
}

fn mapped_player(player: Option<Side>, perspective: Side) -> Option<PlayerKey> {
    player.map(|side| {
        if side == perspective {
            PlayerKey::Ai
        } else {
            PlayerKey::Human
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_id::ModelId;

    #[test]
    #[ignore = "bounded release-mode engine-played hand cost comparison"]
    fn model1323_exhaustive_engine_played_hand_cost() {
        use crate::cards::cards_from_ids;
        use crate::game::Phase;
        use std::time::Instant;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_str()
            .unwrap();
        let fixture = std::env::var("MODEL1323_COST_FIXTURE").unwrap_or_else(|_| "opening".into());
        let repeats: usize = std::env::var("MODEL1323_COST_REPEATS")
            .unwrap_or_else(|_| "3".into())
            .parse()
            .unwrap();
        assert!(repeats > 0);
        let (own, opponent, cut, scores) = match fixture.as_str() {
            "opening" => ([0, 3, 4, 9, 1, 6], [2, 5, 8, 12, 7, 11], 10, [0, 0]),
            "paired-fives" => ([4, 17, 5, 9, 6, 12], [0, 2, 8, 11, 1, 7], 10, [0, 0]),
            "low-run" => ([0, 1, 2, 3, 9, 12], [4, 5, 6, 7, 10, 11], 8, [0, 0]),
            "high-cards" => ([8, 9, 10, 11, 4, 12], [1, 2, 3, 5, 6, 7], 0, [0, 0]),
            "close-race" => ([0, 3, 4, 9, 1, 6], [2, 5, 8, 12, 7, 11], 10, [116, 118]),
            _ => panic!("unknown timing fixture"),
        };
        let mut initial = CribbageGame::new_with_seed(1323, Side::Right);
        initial.player_mut(Side::Left).hand = cards_from_ids(&own).unwrap();
        initial.player_mut(Side::Right).hand = cards_from_ids(&opponent).unwrap();
        initial.turn_card = crate::cards::Card::new(cut).unwrap();
        initial.discard(Side::Left, [own[4], own[5]]).unwrap();
        initial
            .discard(Side::Right, [opponent[4], opponent[5]])
            .unwrap();
        initial.player_mut(Side::Left).score = scores[0];
        initial.player_mut(Side::Right).score = scores[1];
        // Warm immutable assets; each timed hand still starts with fresh caches.
        for model in [ModelId::Schell13215, ModelId::Schell1323] {
            recommend_peg_for_side(&initial, Side::Left, model, None, root).unwrap();
        }
        let mut report = Vec::new();
        for repeat in 0..repeats {
            let mut game = initial.clone();
            let caches13215 = [Model13HandCache::new(), Model13HandCache::new()];
            let caches1323 = [Model13HandCache::new(), Model13HandCache::new()];
            let mut turns = [0, 0];
            while game.phase == Phase::Pegging {
                if game.pegging_reset_pending {
                    game.acknowledge_pegging_reset();
                    continue;
                }
                let actor = game.current_player();
                let legal = game.legal_cards(actor);
                let chosen = if legal.len() > 1 {
                    let mut times = [0.0; 2];
                    let mut decisions = [None, None];
                    for offset in 0..2 {
                        let mode = (offset + repeat + turns[actor.index()]) % 2;
                        let (model, cache) = if mode == 0 {
                            (ModelId::Schell13215, &caches13215[actor.index()])
                        } else {
                            (ModelId::Schell1323, &caches1323[actor.index()])
                        };
                        let start = Instant::now();
                        decisions[mode] = Some(
                            recommend_peg_for_side_with_caches(
                                &game,
                                actor,
                                model,
                                None,
                                root,
                                None,
                                Some(cache),
                            )
                            .unwrap(),
                        );
                        times[mode] = start.elapsed().as_secs_f64();
                    }
                    report.push(serde_json::json!({"fixture":fixture,"repeat":repeat,
                        "actor":actor.index(),"actorTurn":turns[actor.index()],
                        "count":game.count,"legalActions":legal.len(),
                        "seconds13215":times[0],"seconds1323":times[1]}));
                    turns[actor.index()] += 1;
                    match decisions[1].as_ref().unwrap() {
                        PegDecision::Play { card_id, .. } => Some(*card_id),
                        PegDecision::Go => panic!("go with legal cards"),
                    }
                } else {
                    legal.first().map(|card| card.id)
                };
                // Actual 13.23 choices advance the hand, not a scripted trace.
                if let Some(card) = chosen {
                    game.play_card(actor, card).unwrap();
                } else {
                    game.say_go(actor).unwrap();
                }
            }
            std::fs::write(
                std::env::temp_dir().join(format!("model1323-exhaustive-native-{fixture}.json")),
                serde_json::to_vec_pretty(&report).unwrap(),
            )
            .unwrap();
        }
    }

    #[test]
    #[ignore = "bounded release-mode multi-turn native speed comparison"]
    fn model1323_hand_cache_native_speed_comparison() {
        use crate::cards::cards_from_ids;
        use crate::game::Phase;
        use std::time::Instant;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_str()
            .unwrap();
        let mut report = Vec::new();
        for (fixture, own, opponent, cut) in [
            ("opening", [0, 3, 4, 9, 1, 6], [2, 5, 8, 12, 7, 11], 10),
            (
                "paired-fives",
                [4, 17, 5, 9, 6, 12],
                [0, 2, 8, 11, 1, 7],
                10,
            ),
        ] {
            let mut game = CribbageGame::new_with_seed(1323, Side::Right);
            game.player_mut(Side::Left).hand = cards_from_ids(&own).unwrap();
            game.player_mut(Side::Right).hand = cards_from_ids(&opponent).unwrap();
            game.turn_card = crate::cards::Card::new(cut).unwrap();
            game.discard(Side::Left, [own[4], own[5]]).unwrap();
            game.discard(Side::Right, [opponent[4], opponent[5]])
                .unwrap();
            let initial = game.clone();
            // Preload immutable runtime assets outside all measurements.
            for model in [ModelId::Schell13215, ModelId::Schell1323] {
                recommend_peg_for_side(&game, Side::Left, model, None, root).unwrap();
            }
            for repeat in 0..5 {
                let mut game = initial.clone();
                let caches13215 = [Model13HandCache::new(), Model13HandCache::new()];
                let caches1323 = [Model13HandCache::new(), Model13HandCache::new()];
                let mut turns = [0, 0];
                while game.phase == Phase::Pegging {
                    if game.pegging_reset_pending {
                        game.acknowledge_pegging_reset();
                        continue;
                    }
                    let actor = game.current_player();
                    let legal = game.legal_cards(actor);
                    if legal.len() > 1 {
                        let mut seconds = [0.0; 3];
                        let mut decisions = [None, None, None];
                        // Rotate timing order to reduce systematic load/cache bias.
                        for offset in 0..3 {
                            let mode = (offset + repeat + turns[actor.index()]) % 3;
                            let (model, cache) = match mode {
                                0 => (ModelId::Schell13215, Some(&caches13215[actor.index()])),
                                1 => (ModelId::Schell1323, None),
                                _ => (ModelId::Schell1323, Some(&caches1323[actor.index()])),
                            };
                            let start = Instant::now();
                            decisions[mode] = Some(
                                recommend_peg_for_side_with_caches(
                                    &game, actor, model, None, root, None, cache,
                                )
                                .unwrap(),
                            );
                            seconds[mode] = start.elapsed().as_secs_f64();
                        }
                        assert_eq!(decisions[1], decisions[2]);
                        report.push(serde_json::json!({"fixture":fixture,"repeat":repeat,
                            "actor":actor.index(),"actorTurn":turns[actor.index()],
                            "count":game.count,"legalActions":legal.len(),
                            "seconds13215":seconds[0],"seconds1323Uncached":seconds[1],
                            "seconds1323Cached":seconds[2],"identicalDecision":true}));
                        turns[actor.index()] += 1;
                    }
                    // The same legal trace feeds all three evaluators; no model
                    // gets easier positions because it chose different cards.
                    match legal.first() {
                        Some(card) => {
                            game.play_card(actor, card.id).unwrap();
                        }
                        None => {
                            game.say_go(actor).unwrap();
                        }
                    }
                }
                for cache in caches13215.iter().chain(&caches1323) {
                    cache.clear();
                }
                std::fs::write(
                    std::env::temp_dir().join("model1323-hand-cache-native-timing.json"),
                    serde_json::to_vec_pretty(&report).unwrap(),
                )
                .unwrap();
            }
        }
    }

    #[test]
    fn server_stochastic_seed_is_repeatable_and_deal_local() {
        let first_game = CribbageGame::new_with_seed(0x1234_5678, Side::Left);
        let second_game = CribbageGame::new_with_seed(0x8765_4321, Side::Left);
        let first = server_decision_seed(&first_game, Side::Right, DecisionKind::Discard);

        assert_eq!(
            first,
            server_decision_seed(&first_game, Side::Right, DecisionKind::Discard)
        );
        assert_ne!(
            first,
            server_decision_seed(&second_game, Side::Right, DecisionKind::Discard)
        );
        assert_ne!(
            first,
            server_decision_seed(&first_game, Side::Left, DecisionKind::Discard)
        );
        assert_ne!(
            first,
            server_decision_seed(&first_game, Side::Right, DecisionKind::Peg)
        );
    }

    #[test]
    fn saved_recommendation_is_reused_without_re_evaluating_it() {
        let game = CribbageGame::new_with_seed(0x1234_5678, Side::Left);
        let selected = [
            game.player(Side::Left).hand[0].id,
            game.player(Side::Left).hand[1].id,
        ];
        let recommended = ReviewedDecisionValue {
            card_ids: selected.to_vec(),
            ev: Some(1.25),
            win_probability: Some(0.55),
        };

        let review = review_discard_for_side_with_recommendation(
            &game,
            Side::Left,
            ModelId::Schell13,
            selected,
            Some(recommended.clone()),
            "/missing-model-root",
        )
        .unwrap();

        assert_eq!(review.selected, recommended);
        assert_eq!(review.recommended, recommended);
    }

    #[test]
    fn model13x_discard_decisions_defer_the_executable_lead() {
        let game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        // Model 13.2 is exercised after its exhaustive asset is installed;
        // unlike the frozen baselines it must fail closed while that asset is absent.
        for model in [ModelId::Schell13, ModelId::Schell131] {
            let decision =
                recommend_discard_for_side(&game, Side::Left, model, root.to_str().unwrap())
                    .unwrap();
            assert_eq!(decision.best_lead, None);
        }
    }

    #[test]
    fn model132_live_pegging_is_frozen_model13() {
        let mut game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        game.discard(Side::Left, [29, 11]).unwrap();
        game.discard(Side::Right, [51, 15]).unwrap();
        let pone = game.pone;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();

        let model13 =
            recommend_peg_for_side(&game, pone, ModelId::Schell13, None, root.to_str().unwrap())
                .unwrap();
        let model132 = recommend_peg_for_side(
            &game,
            pone,
            ModelId::Schell132,
            None,
            root.to_str().unwrap(),
        )
        .unwrap();

        assert_eq!(model132, model13);

        let model1321 = recommend_peg_for_side(
            &game,
            pone,
            ModelId::Schell1321,
            None,
            root.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(model1321, model13);
    }

    #[test]
    fn model1321_pone_discard_is_frozen_model13() {
        let game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        let pone = game.pone;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();

        let model13 =
            recommend_discard_for_side(&game, pone, ModelId::Schell13, root.to_str().unwrap())
                .unwrap();
        let model1321 =
            recommend_discard_for_side(&game, pone, ModelId::Schell1321, root.to_str().unwrap())
                .unwrap();

        assert_eq!(model1321, model13);
    }

    #[test]
    fn reviews_a_saved_discard_with_model13() {
        let game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let hand = &game.player(Side::Left).hand;
        let result = review_discard_for_side(
            &game,
            Side::Left,
            ModelId::Schell13,
            [hand[0].id, hand[1].id],
            root.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(result.selected.card_ids.len(), 2);
        assert_eq!(result.recommended.card_ids.len(), 2);
        assert!(result.selected.ev.is_some());
        assert!(result.recommended.win_probability.is_some());
    }

    #[test]
    fn model9_decision_input_exposes_own_discard_and_cut_but_not_opponent_discard() {
        let mut game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        game.discard(Side::Left, [29, 11]).unwrap();
        game.discard(Side::Right, [51, 15]).unwrap();

        let left = decision_input(
            &game,
            Side::Left,
            ModelId::Schell91,
            DecisionKind::Peg,
            None,
        );
        let right = decision_input(
            &game,
            Side::Right,
            ModelId::Schell91,
            DecisionKind::Peg,
            None,
        );

        assert_eq!(
            left.own_discards
                .iter()
                .map(|card| card.id)
                .collect::<Vec<_>>(),
            vec![29, 11]
        );
        assert_eq!(
            right
                .own_discards
                .iter()
                .map(|card| card.id)
                .collect::<Vec<_>>(),
            vec![51, 15]
        );
        assert_eq!(left.turn_card, game.turn_card);
        assert_eq!(right.turn_card, game.turn_card);
        assert_eq!(game.crib.len(), 4);
    }

    #[test]
    fn model9_opening_lead_is_recomputed_after_the_cut() {
        let mut game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        game.discard(Side::Left, [29, 11]).unwrap();
        game.discard(Side::Right, [51, 15]).unwrap();
        let pone = game.pone;
        let distinct_ranks = game.player(pone).hand.iter().map(|card| card.rank).fold(
            Vec::new(),
            |mut ranks, rank| {
                if !ranks.contains(&rank) {
                    ranks.push(rank);
                }
                ranks
            },
        );
        assert!(distinct_ranks.len() >= 2);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();

        let first = recommend_peg_for_side(
            &game,
            pone,
            ModelId::Schell91,
            Some(distinct_ranks[0]),
            root.to_str().unwrap(),
        )
        .unwrap();
        let second = recommend_peg_for_side(
            &game,
            pone,
            ModelId::Schell91,
            Some(distinct_ranks[1]),
            root.to_str().unwrap(),
        )
        .unwrap();

        assert_eq!(first, second);
    }

    #[test]
    fn model13x_opening_lead_is_recomputed_after_the_cut() {
        let mut game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        game.discard(Side::Left, [29, 11]).unwrap();
        game.discard(Side::Right, [51, 15]).unwrap();
        let pone = game.pone;
        let distinct_ranks = game.player(pone).hand.iter().map(|card| card.rank).fold(
            Vec::new(),
            |mut ranks, rank| {
                if !ranks.contains(&rank) {
                    ranks.push(rank);
                }
                ranks
            },
        );
        assert!(distinct_ranks.len() >= 2);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();

        for model in [ModelId::Schell13, ModelId::Schell131] {
            let first = recommend_peg_for_side(
                &game,
                pone,
                model,
                Some(distinct_ranks[0]),
                root.to_str().unwrap(),
            )
            .unwrap();
            let second = recommend_peg_for_side(
                &game,
                pone,
                model,
                Some(distinct_ranks[1]),
                root.to_str().unwrap(),
            )
            .unwrap();

            assert_eq!(first, second);
        }
    }

    #[test]
    fn model9_discard_decisions_defer_the_opening_lead() {
        let game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        for model in [ModelId::Schell90, ModelId::Schell91] {
            let decision =
                recommend_discard_for_side(&game, Side::Left, model, root.to_str().unwrap())
                    .unwrap();
            assert_eq!(decision.best_lead, None);
        }
    }
}
