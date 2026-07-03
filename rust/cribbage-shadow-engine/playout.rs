use crate::board::Role;
use crate::game::{CribbageGame, Phase, Side};
use crate::model::{evaluate_decision, Decision, DecisionInput, DecisionKind, PlayerKey};
use crate::model_id::ModelId;

#[derive(Clone, Debug)]
pub struct PlayoutResult {
    pub winner: Side,
    pub left_score: i32,
    pub right_score: i32,
    pub hands: u32,
    pub steps: u32,
}

#[derive(Clone, Debug)]
pub struct ModelPlayout {
    pub game: CribbageGame,
    pub left_model: ModelId,
    pub right_model: ModelId,
    pub peg_leads: [Option<u8>; 2],
}

impl ModelPlayout {
    pub fn new(seed: u32, first_deal: Side, left_model: ModelId, right_model: ModelId) -> Result<ModelPlayout, String> {
        if !left_model.has_native_rust_decisions() {
            return Err(format!("{} does not yet have native Rust decisions", left_model));
        }
        if !right_model.has_native_rust_decisions() {
            return Err(format!("{} does not yet have native Rust decisions", right_model));
        }
        Ok(ModelPlayout {
            game: CribbageGame::new_with_seed(seed, first_deal),
            left_model,
            right_model,
            peg_leads: [None, None],
        })
    }

    pub fn play_to_end(&mut self, root: &str, max_steps: u32) -> Result<PlayoutResult, String> {
        for step in 0..max_steps {
            match self.game.phase {
                Phase::Discard => self.play_discard_round(root)?,
                Phase::Pegging => self.play_pegging_step(root)?,
                Phase::PeggingComplete => {
                    let hand_number = self.game.hand_number;
                    self.game.score_after_pegging()?;
                    if self.game.phase == Phase::Discard && self.game.hand_number != hand_number {
                        self.peg_leads = [None, None];
                    }
                }
                Phase::GameOver => {
                    let left_score = self.game.player(Side::Left).score;
                    let right_score = self.game.player(Side::Right).score;
                    return Ok(PlayoutResult {
                        winner: if left_score >= 121 { Side::Left } else { Side::Right },
                        left_score,
                        right_score,
                        hands: self.game.hand_number,
                        steps: step,
                    });
                }
            }
        }
        Err(format!("model playout exceeded {} steps", max_steps))
    }

    fn play_discard_round(&mut self, root: &str) -> Result<(), String> {
        for side in [Side::Left, Side::Right] {
            if self.game.phase == Phase::Discard && self.game.player(side).hand.len() == 6 {
                let input = self.decision_input(side, DecisionKind::Discard);
                let decision = evaluate_decision(&input, root)?;
                let Decision::Discard { card_ids, best_lead } = decision else {
                    return Err("discard decision returned pegging action".to_string());
                };
                if card_ids.len() != 2 {
                    return Err(format!("discard decision returned {} cards", card_ids.len()));
                }
                self.peg_leads[side.index()] = best_lead;
                self.game.discard(side, [card_ids[0], card_ids[1]])?;
            }
        }
        Ok(())
    }

    fn play_pegging_step(&mut self, root: &str) -> Result<(), String> {
        if self.game.pegging_reset_pending {
            self.game.acknowledge_pegging_reset();
            return Ok(());
        }
        let side = self.game.current_player();
        let legal = self.game.legal_cards(side);
        if legal.is_empty() {
            self.game.say_go(side)?;
            return Ok(());
        }
        if legal.len() == 1 {
            self.game.play_card(side, legal[0].id)?;
            return Ok(());
        }
        let input = self.decision_input(side, DecisionKind::Peg);
        let decision = evaluate_decision(&input, root)?;
        match decision {
            Decision::Peg { action, .. } if action == "go" => self.game.say_go(side),
            Decision::Peg { card_id: Some(card_id), .. } => self.game.play_card(side, card_id).map(|_| ()),
            Decision::Peg { .. } => Err("pegging decision did not include a card".to_string()),
            Decision::Discard { .. } => Err("pegging decision returned discard action".to_string()),
        }
    }

    fn decision_input(&self, side: Side, kind: DecisionKind) -> DecisionInput {
        let opponent = side.other();
        DecisionInput {
            kind,
            model: self.model(side).as_str().to_string(),
            player: PlayerKey::Ai,
            role: self.role(side),
            ai_score: self.game.player(side).score,
            human_score: self.game.player(opponent).score,
            ai_hand: self.game.player(side).hand.clone(),
            ai_table: self.game.player(side).table.clone(),
            human_table: self.game.player(opponent).table.clone(),
            human_hand_count: self.game.player(opponent).hand.len(),
            crib: self.game.crib.clone(),
            turn_card: self.game.turn_card,
            count: self.game.count,
            turn: PlayerKey::Ai,
            go_player: self.game.go_player.map(|player| if player == side { PlayerKey::Ai } else { PlayerKey::Human }),
            last_player: self.game.last_player.map(|player| if player == side { PlayerKey::Ai } else { PlayerKey::Human }),
            plays: self.game.plays.clone(),
            peg_lead: self.peg_leads[side.index()],
        }
    }

    fn model(&self, side: Side) -> ModelId {
        match side {
            Side::Left => self.left_model,
            Side::Right => self.right_model,
        }
    }

    fn role(&self, side: Side) -> Role {
        if side == self.game.dealer {
            Role::Dealer
        } else {
            Role::Pone
        }
    }
}
