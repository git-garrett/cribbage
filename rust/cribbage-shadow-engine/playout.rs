use crate::board::Role;
use crate::cards::{score_count, score_hand, Card};
use crate::game::{CribbageGame, Phase, Side};
use crate::model::{evaluate_decision, Decision, DecisionInput, DecisionKind, PlayerKey};
use crate::model_id::ModelId;
use std::time::Instant;

#[derive(Clone, Debug)]
pub struct PlayoutResult {
    pub winner: Side,
    pub left_score: i32,
    pub right_score: i32,
    pub hands: u32,
    pub steps: u32,
    pub record: CompactPlayoutRecord,
}

#[derive(Clone, Debug, Default)]
pub struct CompactPlayoutRecord {
    pub hands: Vec<CompactHandRecord>,
    pub discards: Vec<CompactDiscardRecord>,
    pub peg_plays: Vec<CompactPegPlayRecord>,
}

#[derive(Clone, Debug)]
pub struct CompactHandRecord {
    pub hand_number: u32,
    pub dealer: Side,
    pub pone: Side,
    pub start_left_score: i32,
    pub start_right_score: i32,
    pub end_left_score: Option<i32>,
    pub end_right_score: Option<i32>,
    pub cut_card: Card,
    pub left_dealt: Vec<Card>,
    pub right_dealt: Vec<Card>,
    pub left_keep: Vec<Card>,
    pub right_keep: Vec<Card>,
    pub crib: Vec<Card>,
    pub left_pegging_points: i32,
    pub right_pegging_points: i32,
    pub left_hand_points: i32,
    pub right_hand_points: i32,
    pub crib_points: i32,
    pub left_available_pegging_points: i32,
    pub right_available_pegging_points: i32,
    pub left_available_hand_points: i32,
    pub right_available_hand_points: i32,
    pub available_crib_points: i32,
}

#[derive(Clone, Debug)]
pub struct CompactDiscardRecord {
    pub hand_number: u32,
    pub player: Side,
    pub role: Role,
    pub model: ModelId,
    pub selected_ev: Option<f64>,
    pub selected_win_probability: Option<f64>,
    pub decision_elapsed_us: Option<u64>,
    pub cards: Vec<Card>,
    pub hand_before: Vec<Card>,
    pub remaining_hand: Vec<Card>,
    pub crib_after_discard: Vec<Card>,
    pub left_score: i32,
    pub right_score: i32,
}

#[derive(Clone, Debug)]
pub struct CompactPegPlayRecord {
    pub hand_number: u32,
    pub sequence: u32,
    pub player: Option<Side>,
    pub role: Option<Role>,
    pub model: Option<ModelId>,
    pub selected_ev: Option<f64>,
    pub selected_win_probability: Option<f64>,
    pub decision_elapsed_us: Option<u64>,
    pub legal_count: Option<usize>,
    pub action: u8,
    pub card: Option<Card>,
    pub count_before: u8,
    pub count_after: u8,
    pub points: i32,
    pub left_score: i32,
    pub right_score: i32,
}

#[derive(Clone, Debug)]
pub struct ModelPlayout {
    pub game: CribbageGame,
    pub left_model: ModelId,
    pub right_model: ModelId,
    pub peg_leads: [Option<u8>; 2],
    pub record: CompactPlayoutRecord,
}

impl ModelPlayout {
    pub fn new(
        seed: u32,
        first_deal: Side,
        left_model: ModelId,
        right_model: ModelId,
    ) -> Result<ModelPlayout, String> {
        if !left_model.has_native_rust_decisions() {
            return Err(format!(
                "{} does not yet have native Rust decisions",
                left_model
            ));
        }
        if !right_model.has_native_rust_decisions() {
            return Err(format!(
                "{} does not yet have native Rust decisions",
                right_model
            ));
        }
        let game = CribbageGame::new_with_seed(seed, first_deal);
        let mut playout = ModelPlayout {
            game,
            left_model,
            right_model,
            peg_leads: [None, None],
            record: CompactPlayoutRecord::default(),
        };
        playout.start_hand_record();
        Ok(playout)
    }

    pub fn play_to_end(&mut self, root: &str, max_steps: u32) -> Result<PlayoutResult, String> {
        for step in 0..max_steps {
            match self.game.phase {
                Phase::Discard => self.play_discard_round(root)?,
                Phase::Pegging => self.play_pegging_step(root)?,
                Phase::PeggingComplete => {
                    let hand_number = self.game.hand_number;
                    self.finalize_scoring_for_current_hand();
                    self.game.score_after_pegging()?;
                    self.finish_current_hand_record();
                    if self.game.phase == Phase::Discard && self.game.hand_number != hand_number {
                        self.peg_leads = [None, None];
                        self.start_hand_record();
                    }
                }
                Phase::GameOver => {
                    let left_score = self.game.player(Side::Left).score;
                    let right_score = self.game.player(Side::Right).score;
                    return Ok(PlayoutResult {
                        winner: if left_score >= 121 {
                            Side::Left
                        } else {
                            Side::Right
                        },
                        left_score,
                        right_score,
                        hands: self.game.hand_number,
                        steps: step,
                        record: self.record.clone(),
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
                let decision_started = Instant::now();
                let decision = evaluate_decision(&input, root)?;
                let decision_elapsed_us = elapsed_micros(decision_started);
                let Decision::Discard {
                    card_ids,
                    best_lead,
                    ev,
                    win_probability,
                } = decision
                else {
                    return Err("discard decision returned pegging action".to_string());
                };
                if card_ids.len() != 2 {
                    return Err(format!(
                        "discard decision returned {} cards",
                        card_ids.len()
                    ));
                }
                let hand_before = self.game.player(side).hand.clone();
                self.peg_leads[side.index()] = best_lead;
                let left_before = self.game.player(Side::Left).score;
                let right_before = self.game.player(Side::Right).score;
                self.game.discard(side, [card_ids[0], card_ids[1]])?;
                self.add_pegging_delta(left_before, right_before);
                self.add_available_cut_jack_points(left_before, right_before);
                let cards = card_ids
                    .iter()
                    .copied()
                    .map(Card::new)
                    .collect::<Result<Vec<_>, _>>()?;
                self.record.discards.push(CompactDiscardRecord {
                    hand_number: self.game.hand_number,
                    player: side,
                    role: self.role(side),
                    model: self.model(side),
                    selected_ev: ev,
                    selected_win_probability: win_probability,
                    decision_elapsed_us: Some(decision_elapsed_us),
                    cards,
                    hand_before,
                    remaining_hand: self.game.player(side).hand.clone(),
                    crib_after_discard: self.game.crib.clone(),
                    left_score: self.game.player(Side::Left).score,
                    right_score: self.game.player(Side::Right).score,
                });
                self.refresh_current_hand_cards();
            }
        }
        Ok(())
    }

    fn play_pegging_step(&mut self, root: &str) -> Result<(), String> {
        if self.game.pegging_reset_pending {
            let count_before = self.game.count;
            let left_before = self.game.player(Side::Left).score;
            let right_before = self.game.player(Side::Right).score;
            self.game.acknowledge_pegging_reset();
            let left_after = self.game.player(Side::Left).score;
            let right_after = self.game.player(Side::Right).score;
            self.record.peg_plays.push(CompactPegPlayRecord {
                hand_number: self.game.hand_number,
                sequence: self.next_peg_sequence(),
                player: None,
                role: None,
                model: None,
                selected_ev: None,
                selected_win_probability: None,
                decision_elapsed_us: None,
                legal_count: None,
                action: 2,
                card: None,
                count_before,
                count_after: self.game.count,
                points: (left_after - left_before) + (right_after - right_before),
                left_score: left_after,
                right_score: right_after,
            });
            self.add_pegging_delta(left_before, right_before);
            return Ok(());
        }
        let side = self.game.current_player();
        let legal = self.game.legal_cards(side);
        if legal.is_empty() {
            let count_before = self.game.count;
            let left_before = self.game.player(Side::Left).score;
            let right_before = self.game.player(Side::Right).score;
            self.game.say_go(side)?;
            let left_after = self.game.player(Side::Left).score;
            let right_after = self.game.player(Side::Right).score;
            self.record.peg_plays.push(CompactPegPlayRecord {
                hand_number: self.game.hand_number,
                sequence: self.next_peg_sequence(),
                player: Some(side),
                role: Some(self.role(side)),
                model: Some(self.model(side)),
                selected_ev: None,
                selected_win_probability: None,
                decision_elapsed_us: None,
                legal_count: Some(0),
                action: 1,
                card: None,
                count_before,
                count_after: self.game.count,
                points: 0,
                left_score: left_after,
                right_score: right_after,
            });
            self.add_pegging_delta(left_before, right_before);
            self.add_available_go_points(left_before, right_before);
            return Ok(());
        }
        let count_before = self.game.count;
        let left_before = self.game.player(Side::Left).score;
        let right_before = self.game.player(Side::Right).score;
        if legal.len() == 1 {
            let card = legal[0];
            let mut plays = self.game.plays.clone();
            plays.push(card);
            let ev = score_count(&plays) as f64;
            let points = self.game.play_card(side, card.id)?;
            let left_after = self.game.player(Side::Left).score;
            let right_after = self.game.player(Side::Right).score;
            let available_points = self.available_pegging_points_after_play(
                left_before,
                right_before,
                i32::from(points),
            );
            self.record.peg_plays.push(CompactPegPlayRecord {
                hand_number: self.game.hand_number,
                sequence: self.next_peg_sequence(),
                player: Some(side),
                role: Some(self.role(side)),
                model: Some(self.model(side)),
                selected_ev: Some(ev),
                selected_win_probability: None,
                decision_elapsed_us: None,
                legal_count: Some(1),
                action: 0,
                card: Some(card),
                count_before,
                count_after: self.game.count,
                points: i32::from(points),
                left_score: left_after,
                right_score: right_after,
            });
            self.add_pegging_delta(left_before, right_before);
            self.add_available_pegging_points(side, available_points);
            return Ok(());
        }
        let input = self.decision_input(side, DecisionKind::Peg);
        let decision_started = Instant::now();
        let decision = evaluate_decision(&input, root)?;
        let decision_elapsed_us = elapsed_micros(decision_started);
        match decision {
            Decision::Peg { action, .. } if action == "go" => {
                self.game.say_go(side)?;
                let left_after = self.game.player(Side::Left).score;
                let right_after = self.game.player(Side::Right).score;
                self.record.peg_plays.push(CompactPegPlayRecord {
                    hand_number: self.game.hand_number,
                    sequence: self.next_peg_sequence(),
                    player: Some(side),
                    role: Some(self.role(side)),
                    model: Some(self.model(side)),
                    selected_ev: None,
                    selected_win_probability: None,
                    decision_elapsed_us: Some(decision_elapsed_us),
                    legal_count: Some(legal.len()),
                    action: 1,
                    card: None,
                    count_before,
                    count_after: self.game.count,
                    points: 0,
                    left_score: left_after,
                    right_score: right_after,
                });
                self.add_pegging_delta(left_before, right_before);
                self.add_available_go_points(left_before, right_before);
                Ok(())
            }
            Decision::Peg {
                card_id: Some(card_id),
                ev,
                win_probability,
                ..
            } => {
                let card = self
                    .game
                    .player(side)
                    .hand
                    .iter()
                    .copied()
                    .find(|candidate| candidate.id == card_id)
                    .ok_or_else(|| format!("pegging decision chose missing card {}", card_id))?;
                let points = self.game.play_card(side, card_id)?;
                let left_after = self.game.player(Side::Left).score;
                let right_after = self.game.player(Side::Right).score;
                let available_points = self.available_pegging_points_after_play(
                    left_before,
                    right_before,
                    i32::from(points),
                );
                self.record.peg_plays.push(CompactPegPlayRecord {
                    hand_number: self.game.hand_number,
                    sequence: self.next_peg_sequence(),
                    player: Some(side),
                    role: Some(self.role(side)),
                    model: Some(self.model(side)),
                    selected_ev: ev,
                    selected_win_probability: win_probability,
                    decision_elapsed_us: Some(decision_elapsed_us),
                    legal_count: Some(legal.len()),
                    action: 0,
                    card: Some(card),
                    count_before,
                    count_after: self.game.count,
                    points: i32::from(points),
                    left_score: left_after,
                    right_score: right_after,
                });
                self.add_pegging_delta(left_before, right_before);
                self.add_available_pegging_points(side, available_points);
                Ok(())
            }
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
            own_discards: self.game.player(side).discarded_to_crib.clone(),
            turn_card: self.game.turn_card,
            count: self.game.count,
            turn: PlayerKey::Ai,
            go_player: self.game.go_player.map(|player| {
                if player == side {
                    PlayerKey::Ai
                } else {
                    PlayerKey::Human
                }
            }),
            last_player: self.game.last_player.map(|player| {
                if player == side {
                    PlayerKey::Ai
                } else {
                    PlayerKey::Human
                }
            }),
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

    fn start_hand_record(&mut self) {
        self.record.hands.push(CompactHandRecord {
            hand_number: self.game.hand_number,
            dealer: self.game.dealer,
            pone: self.game.pone,
            start_left_score: self.game.player(Side::Left).score,
            start_right_score: self.game.player(Side::Right).score,
            end_left_score: None,
            end_right_score: None,
            cut_card: self.game.turn_card,
            left_dealt: self.game.player(Side::Left).hand.clone(),
            right_dealt: self.game.player(Side::Right).hand.clone(),
            left_keep: Vec::new(),
            right_keep: Vec::new(),
            crib: Vec::new(),
            left_pegging_points: 0,
            right_pegging_points: 0,
            left_hand_points: 0,
            right_hand_points: 0,
            crib_points: 0,
            left_available_pegging_points: 0,
            right_available_pegging_points: 0,
            left_available_hand_points: 0,
            right_available_hand_points: 0,
            available_crib_points: 0,
        });
    }

    fn current_hand_mut(&mut self) -> Option<&mut CompactHandRecord> {
        self.record
            .hands
            .iter_mut()
            .rev()
            .find(|hand| hand.hand_number == self.game.hand_number)
    }

    fn refresh_current_hand_cards(&mut self) {
        let left_keep = self.game.player(Side::Left).hand.clone();
        let right_keep = self.game.player(Side::Right).hand.clone();
        let crib = self.game.crib.clone();
        if let Some(hand) = self.current_hand_mut() {
            hand.left_keep = left_keep;
            hand.right_keep = right_keep;
            hand.crib = crib;
        }
    }

    fn add_pegging_delta(&mut self, left_before: i32, right_before: i32) {
        let left_delta = self.game.player(Side::Left).score - left_before;
        let right_delta = self.game.player(Side::Right).score - right_before;
        if left_delta == 0 && right_delta == 0 {
            return;
        }
        if let Some(hand) = self.current_hand_mut() {
            hand.left_pegging_points += left_delta;
            hand.right_pegging_points += right_delta;
        }
    }

    fn add_available_pegging_points(&mut self, side: Side, points: i32) {
        if points <= 0 {
            return;
        }
        if let Some(hand) = self.current_hand_mut() {
            if side == Side::Left {
                hand.left_available_pegging_points += points;
            } else {
                hand.right_available_pegging_points += points;
            }
        }
    }

    fn add_available_cut_jack_points(&mut self, left_before: i32, right_before: i32) {
        let left_delta = self.game.player(Side::Left).score - left_before;
        let right_delta = self.game.player(Side::Right).score - right_before;
        if left_delta > 0 {
            self.add_available_pegging_points(Side::Left, 2);
        }
        if right_delta > 0 {
            self.add_available_pegging_points(Side::Right, 2);
        }
    }

    fn add_available_go_points(&mut self, left_before: i32, right_before: i32) {
        let left_delta = self.game.player(Side::Left).score - left_before;
        let right_delta = self.game.player(Side::Right).score - right_before;
        if left_delta > 0 {
            self.add_available_pegging_points(Side::Left, 1);
        }
        if right_delta > 0 {
            self.add_available_pegging_points(Side::Right, 1);
        }
    }

    fn available_pegging_points_after_play(
        &self,
        left_before: i32,
        right_before: i32,
        immediate_points: i32,
    ) -> i32 {
        let actual_delta = (self.game.player(Side::Left).score - left_before)
            + (self.game.player(Side::Right).score - right_before);
        let includes_last_card_point = actual_delta > immediate_points
            || (self.game.phase == Phase::PeggingComplete && self.game.count > 0);
        immediate_points + if includes_last_card_point { 1 } else { 0 }
    }

    fn next_peg_sequence(&self) -> u32 {
        self.record
            .peg_plays
            .iter()
            .filter(|play| play.hand_number == self.game.hand_number)
            .count() as u32
    }

    fn finalize_scoring_for_current_hand(&mut self) {
        let left_before = self.game.player(Side::Left).score;
        let right_before = self.game.player(Side::Right).score;
        let pone = self.game.pone;
        let dealer = self.game.dealer;
        let pone_points =
            score_hand(&self.game.player(pone).table, self.game.turn_card, false) as i32;
        let scored_pone = points_until_win(self.game.player(pone).score, pone_points);
        let mut available_pone = pone_points;
        let mut simulated_left = left_before + if pone == Side::Left { scored_pone } else { 0 };
        let mut simulated_right = right_before + if pone == Side::Right { scored_pone } else { 0 };
        let mut scored_dealer = 0;
        let mut scored_crib = 0;
        let mut available_dealer = 0;
        let mut available_crib = 0;
        if simulated_left < 121 && simulated_right < 121 {
            let dealer_points =
                score_hand(&self.game.player(dealer).table, self.game.turn_card, false) as i32;
            scored_dealer = points_until_win(self.game.player(dealer).score, dealer_points);
            available_dealer = dealer_points;
            simulated_left += if dealer == Side::Left {
                scored_dealer
            } else {
                0
            };
            simulated_right += if dealer == Side::Right {
                scored_dealer
            } else {
                0
            };
        }
        if simulated_left < 121 && simulated_right < 121 {
            let crib_points =
                score_hand(&self.game.player(dealer).crib, self.game.turn_card, true) as i32;
            scored_crib =
                points_until_win(self.game.player(dealer).score + scored_dealer, crib_points);
            available_crib = crib_points;
        }
        if left_before >= 121 || right_before >= 121 {
            available_pone = 0;
        }
        if let Some(hand) = self.current_hand_mut() {
            if pone == Side::Left {
                hand.left_hand_points = scored_pone;
                hand.left_available_hand_points = available_pone;
            } else {
                hand.right_hand_points = scored_pone;
                hand.right_available_hand_points = available_pone;
            }
            if dealer == Side::Left {
                hand.left_hand_points = scored_dealer;
                hand.left_available_hand_points = available_dealer;
            } else {
                hand.right_hand_points = scored_dealer;
                hand.right_available_hand_points = available_dealer;
            }
            hand.crib_points = scored_crib;
            hand.available_crib_points = available_crib;
        }
    }

    fn finish_current_hand_record(&mut self) {
        let left_score = self.game.player(Side::Left).score;
        let right_score = self.game.player(Side::Right).score;
        if let Some(hand) = self.current_hand_mut() {
            hand.end_left_score = Some(left_score);
            hand.end_right_score = Some(right_score);
        }
    }
}

fn points_until_win(score: i32, points: i32) -> i32 {
    if score >= 121 {
        0
    } else {
        points.min(121 - score)
    }
}

fn elapsed_micros(started: Instant) -> u64 {
    started.elapsed().as_micros().min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playout_accepts_native_models() {
        let playout = ModelPlayout::new(
            0x9e3779b9,
            Side::Left,
            ModelId::Schell150,
            ModelId::Schell1481,
        );
        assert!(playout.is_ok());
    }

    #[test]
    fn playout_accepts_model13_after_native_port() {
        let playout = ModelPlayout::new(
            0x9e3779b9,
            Side::Left,
            ModelId::Schell150,
            ModelId::Schell13,
        );
        assert!(playout.is_ok());
    }

    #[test]
    fn playout_accepts_model16() {
        let playout = ModelPlayout::new(
            0x9e3779b9,
            Side::Left,
            ModelId::Schell160,
            ModelId::Schell152,
        );
        assert!(playout.is_ok());
    }
}
