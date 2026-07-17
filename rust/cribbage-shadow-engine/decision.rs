use crate::board::Role;
use crate::game::{CribbageGame, Side};
use crate::model::{self, Decision, DecisionInput, DecisionKind, PlayerKey};
use crate::model_id::ModelId;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscardDecision {
    pub card_ids: Vec<u8>,
    pub best_lead: Option<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PegDecision {
    Go,
    Play { card_id: u8, ev: Option<f64> },
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
            ..
        } => Ok(DiscardDecision {
            card_ids,
            best_lead,
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
    ensure_native_model(model_id)?;
    let input = decision_input(game, side, model_id, DecisionKind::Peg, peg_lead);
    match model::evaluate_decision(&input, root)? {
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
            ..
        } if action == "play" => Ok(PegDecision::Play { card_id, ev }),
        Decision::Peg { action, .. } => Err(format!("unsupported pegging action: {}", action)),
        Decision::Discard { .. } => Err("pegging decision returned discard action".to_string()),
    }
}

/// Compare a saved discard against the native 13.0 decision at that exact
/// game state. Reviews intentionally use a fixed model so their results stay
/// comparable across games.
pub fn review_discard_for_side(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    selected_card_ids: [u8; 2],
    root: &str,
) -> Result<DecisionReview, String> {
    let input = decision_input(game, side, model_id, DecisionKind::Discard, None);
    review_for_side(&input, &selected_card_ids, root, DecisionKind::Discard)
}

/// Compare a saved peg play against the native 13.0 decision at that exact
/// game state.
pub fn review_peg_for_side(
    game: &CribbageGame,
    side: Side,
    model_id: ModelId,
    selected_card_id: u8,
    root: &str,
) -> Result<DecisionReview, String> {
    let input = decision_input(game, side, model_id, DecisionKind::Peg, None);
    review_for_side(&input, &[selected_card_id], root, DecisionKind::Peg)
}

fn review_for_side(
    input: &DecisionInput,
    selected_card_ids: &[u8],
    root: &str,
    kind: DecisionKind,
) -> Result<DecisionReview, String> {
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
        crib: game.crib.clone(),
        turn_card: game.turn_card,
        count: game.count,
        turn: PlayerKey::Ai,
        go_player: mapped_player(game.go_player, side),
        last_player: mapped_player(game.last_player, side),
        plays: game.plays.clone(),
        peg_lead,
    }
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
    fn accepts_model13_native_decisions() {
        let game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let result = recommend_discard_for_side(
            &game,
            Side::Left,
            ModelId::Schell13,
            root.to_str().unwrap(),
        );
        assert!(result.is_ok(), "{:?}", result);
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
}
