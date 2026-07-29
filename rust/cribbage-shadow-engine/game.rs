use crate::cards::{full_deck, score_count, score_hand, Card};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Side {
    Left,
    Right,
}

impl Side {
    pub fn other(self) -> Side {
        match self {
            Side::Left => Side::Right,
            Side::Right => Side::Left,
        }
    }

    pub fn index(self) -> usize {
        match self {
            Side::Left => 0,
            Side::Right => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PegTurn {
    Pone,
    Dealer,
}

impl PegTurn {
    fn other(self) -> PegTurn {
        match self {
            PegTurn::Pone => PegTurn::Dealer,
            PegTurn::Dealer => PegTurn::Pone,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Phase {
    Discard,
    Pegging,
    PeggingComplete,
    ScorePone,
    ScoreDealer,
    ScoreCrib,
    GameOver,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PegHistoryEvent {
    Play { side: Side, rank: u8 },
    Go { side: Side },
    Reset,
}

#[derive(Clone, Debug, Default)]
pub struct PlayerState {
    pub hand: Vec<Card>,
    pub table: Vec<Card>,
    /// The two cards this player contributed to the current crib. These are
    /// private to the player until crib scoring; `CribbageGame::crib` remains
    /// the server-authoritative complete crib.
    pub discarded_to_crib: Vec<Card>,
    pub crib: Vec<Card>,
    pub score: i32,
}

#[derive(Clone, Debug)]
pub struct CribbageGame {
    pub players: [PlayerState; 2],
    pub deal: Side,
    pub first_deal: Side,
    pub dealer: Side,
    pub pone: Side,
    pub turn_card: Card,
    pub crib: Vec<Card>,
    pub plays: Vec<Card>,
    pub play_owners: Vec<Side>,
    pub completed_plays: Vec<Vec<Card>>,
    pub completed_play_owners: Vec<Vec<Side>>,
    /// Perfect-recall public pegging history for the current hand. Unlike
    /// `plays`, this survives count resets and records go declarations.
    pub pegging_history: Vec<PegHistoryEvent>,
    pub hand_number: u32,
    pub count: u8,
    pub turn: PegTurn,
    pub go_player: Option<Side>,
    pub last_player: Option<Side>,
    pub pegging_reset_pending: bool,
    pub phase: Phase,
    pub rng_state: u32,
}

impl CribbageGame {
    pub fn new_with_seed(seed: u32, first_deal: Side) -> CribbageGame {
        let mut game = CribbageGame {
            players: [PlayerState::default(), PlayerState::default()],
            deal: first_deal,
            first_deal,
            dealer: first_deal,
            pone: first_deal.other(),
            turn_card: Card::new(0).expect("card id in range"),
            crib: Vec::new(),
            plays: Vec::new(),
            play_owners: Vec::new(),
            completed_plays: Vec::new(),
            completed_play_owners: Vec::new(),
            pegging_history: Vec::new(),
            hand_number: 1,
            count: 0,
            turn: PegTurn::Pone,
            go_player: None,
            last_player: None,
            pegging_reset_pending: false,
            phase: Phase::Discard,
            rng_state: if seed == 0 { 0x9e3779b9 } else { seed },
        };
        game.start_hand();
        game
    }

    pub fn random(&mut self) -> f64 {
        self.rng_state = self
            .rng_state
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        f64::from(self.rng_state) / 4_294_967_296.0
    }

    pub fn shuffled_deck(&mut self) -> Vec<Card> {
        let mut deck = full_deck();
        for i in (1..deck.len()).rev() {
            let j = (self.random() * ((i + 1) as f64)).floor() as usize;
            deck.swap(i, j);
        }
        deck
    }

    pub fn start_hand(&mut self) {
        self.dealer = self.deal;
        self.pone = self.deal.other();
        let mut deck = self.shuffled_deck();
        self.player_mut(self.dealer).hand = deck.drain(0..6).collect();
        self.player_mut(self.pone).hand = deck.drain(0..6).collect();
        for player in &mut self.players {
            player.table.clear();
            player.discarded_to_crib.clear();
            player.crib.clear();
        }
        self.turn_card = deck.remove(0);
        self.crib.clear();
        self.plays.clear();
        self.play_owners.clear();
        self.completed_plays.clear();
        self.completed_play_owners.clear();
        self.pegging_history.clear();
        self.count = 0;
        self.turn = PegTurn::Pone;
        self.go_player = None;
        self.last_player = None;
        self.pegging_reset_pending = false;
        self.phase = Phase::Discard;
    }

    pub fn player(&self, side: Side) -> &PlayerState {
        &self.players[side.index()]
    }

    pub fn player_mut(&mut self, side: Side) -> &mut PlayerState {
        &mut self.players[side.index()]
    }

    pub fn current_player(&self) -> Side {
        match self.turn {
            PegTurn::Pone => self.pone,
            PegTurn::Dealer => self.dealer,
        }
    }

    pub fn legal_cards(&self, side: Side) -> Vec<Card> {
        self.player(side)
            .hand
            .iter()
            .copied()
            .filter(|card| self.count + card.value <= 31)
            .collect()
    }

    pub fn discard(&mut self, side: Side, card_ids: [u8; 2]) -> Result<(), String> {
        if self.phase != Phase::Discard {
            return Err("it is not discard time".to_string());
        }
        let discards = self.remove_cards(side, &card_ids)?;
        self.player_mut(side).discarded_to_crib = discards.clone();
        self.crib.extend(discards);
        if self.player(self.dealer).hand.len() == 4 && self.player(self.pone).hand.len() == 4 {
            self.begin_pegging();
        }
        Ok(())
    }

    pub fn begin_pegging(&mut self) {
        self.phase = Phase::Pegging;
        self.pegging_reset_pending = false;
        self.player_mut(self.dealer).crib = self.crib.clone();
        if self.turn_card.rank == 10 {
            self.peg(self.dealer, 2);
        }
    }

    pub fn play_card(&mut self, side: Side, card_id: u8) -> Result<u8, String> {
        if self.pegging_reset_pending {
            return Err("acknowledge the pegging reset before continuing".to_string());
        }
        if self.phase != Phase::Pegging {
            return Err("it is not pegging time".to_string());
        }
        if self.current_player() != side {
            return Err("it is not this player's turn".to_string());
        }
        let legal = self.legal_cards(side);
        if !legal.iter().any(|card| card.id == card_id) {
            return Err("that card would take the count over 31 or is not in hand".to_string());
        }
        let card = self.remove_cards(side, &[card_id])?[0];
        self.player_mut(side).table.push(card);
        self.pegging_history.push(PegHistoryEvent::Play {
            side,
            rank: card.rank,
        });
        self.plays.push(card);
        self.play_owners.push(side);
        self.count += card.value;
        self.last_player = Some(side);
        let points = score_count(&self.plays);
        self.peg(side, i32::from(points));
        if self.count == 31 {
            self.pegging_reset_pending = true;
        } else if self.go_player.is_none() {
            self.turn = self.turn.other();
        }
        if !self.pegging_reset_pending {
            self.complete_pegging_if_no_cards();
        }
        Ok(points)
    }

    pub fn say_go(&mut self, side: Side) -> Result<(), String> {
        if self.pegging_reset_pending {
            return Err("acknowledge the pegging reset before continuing".to_string());
        }
        if self.phase != Phase::Pegging {
            return Err("it is not pegging time".to_string());
        }
        if self.current_player() != side {
            return Err("it is not this player's turn".to_string());
        }
        if !self.legal_cards(side).is_empty() {
            return Err("player has a legal card to play".to_string());
        }
        self.pegging_history.push(PegHistoryEvent::Go { side });
        if self.go_player.is_some() {
            if let Some(last_player) = self.last_player {
                if self.count != 31 {
                    self.peg(last_player, 1);
                }
            }
            self.pegging_reset_pending = true;
        } else {
            self.go_player = Some(side);
            self.turn = self.turn.other();
        }
        Ok(())
    }

    pub fn acknowledge_pegging_reset(&mut self) {
        if !self.pegging_reset_pending {
            return;
        }
        self.pegging_reset_pending = false;
        self.pegging_history.push(PegHistoryEvent::Reset);
        self.clear_current_pegging_series();
        self.turn = self.turn.other();
        self.complete_pegging_if_no_cards();
    }

    pub fn complete_pegging_if_no_cards(&mut self) {
        if self.phase != Phase::Pegging {
            return;
        }
        if !self.player(self.dealer).hand.is_empty() || !self.player(self.pone).hand.is_empty() {
            return;
        }
        self.finish_pegging();
        if self.phase == Phase::Pegging {
            self.phase = Phase::PeggingComplete;
        }
    }

    pub fn finish_pegging(&mut self) {
        if let Some(last_player) = self.last_player {
            if self.count != 0 {
                self.peg(last_player, 1);
            }
        }
    }

    /// Start the post-pegging count with the pone's hand. The interactive
    /// client advances through each scoring phase with `continue_scoring` so
    /// players can see every hand and the crib before the next deal.
    pub fn start_scoring(&mut self) -> Result<(), String> {
        if self.phase != Phase::PeggingComplete {
            return Err("pegging is not complete".to_string());
        }
        let pone_points = score_hand(&self.player(self.pone).table, self.turn_card, false);
        self.peg(self.pone, i32::from(pone_points));
        if self.phase != Phase::GameOver {
            self.phase = Phase::ScorePone;
        }
        Ok(())
    }

    /// Count the next hand or crib, or deal the next hand after the crib has
    /// been acknowledged.
    pub fn continue_scoring(&mut self) -> Result<(), String> {
        match self.phase {
            Phase::ScorePone => {
                let dealer_points =
                    score_hand(&self.player(self.dealer).table, self.turn_card, false);
                self.peg(self.dealer, i32::from(dealer_points));
                if self.phase != Phase::GameOver {
                    self.phase = Phase::ScoreDealer;
                }
            }
            Phase::ScoreDealer => {
                let crib_points = score_hand(&self.player(self.dealer).crib, self.turn_card, true);
                self.peg(self.dealer, i32::from(crib_points));
                if self.phase != Phase::GameOver {
                    self.phase = Phase::ScoreCrib;
                }
            }
            Phase::ScoreCrib => {
                self.deal = self.deal.other();
                self.hand_number += 1;
                self.start_hand();
            }
            _ => return Err("there is no hand score to continue".to_string()),
        }
        Ok(())
    }

    /// Complete scoring without pausing. Simulations and batch runners use
    /// this convenience method; the web game uses the two methods above.
    pub fn score_after_pegging(&mut self) -> Result<(), String> {
        self.start_scoring()?;
        while matches!(
            self.phase,
            Phase::ScorePone | Phase::ScoreDealer | Phase::ScoreCrib
        ) {
            self.continue_scoring()?;
        }
        Ok(())
    }

    fn clear_current_pegging_series(&mut self) {
        if !self.plays.is_empty() {
            self.completed_plays.push(self.plays.clone());
            self.completed_play_owners.push(self.play_owners.clone());
        }
        self.plays.clear();
        self.play_owners.clear();
        self.count = 0;
        self.go_player = None;
        self.last_player = None;
    }

    fn remove_cards(&mut self, side: Side, card_ids: &[u8]) -> Result<Vec<Card>, String> {
        let hand = &mut self.player_mut(side).hand;
        let mut removed = Vec::with_capacity(card_ids.len());
        for id in card_ids {
            let Some(index) = hand.iter().position(|card| card.id == *id) else {
                return Err(format!("card {} is not in hand", id));
            };
            removed.push(hand.remove(index));
        }
        Ok(removed)
    }

    fn peg(&mut self, side: Side, points: i32) {
        if points <= 0 || self.phase == Phase::GameOver {
            return;
        }
        let player = self.player_mut(side);
        player.score = (player.score + points).min(121);
        if player.score >= 121 {
            self.phase = Phase::GameOver;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(cards: &[Card]) -> Vec<u8> {
        cards.iter().map(|card| card.id).collect()
    }

    #[test]
    fn shuffle_matches_typescript_lcg() {
        let mut game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        game.rng_state = 0x9e3779b9;
        let deck = game.shuffled_deck();
        assert_eq!(
            ids(&deck[..13]),
            vec![29, 11, 42, 16, 24, 9, 51, 15, 22, 32, 44, 48, 41]
        );
        assert_eq!(game.rng_state, 4_191_386_374);
    }

    #[test]
    fn start_hand_deals_dealer_then_pone_then_turn_card() {
        let game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        assert_eq!(
            ids(&game.player(Side::Left).hand),
            vec![29, 11, 42, 16, 24, 9]
        );
        assert_eq!(
            ids(&game.player(Side::Right).hand),
            vec![51, 15, 22, 32, 44, 48]
        );
        assert_eq!(game.turn_card.id, 41);
        assert_eq!(game.dealer, Side::Left);
        assert_eq!(game.pone, Side::Right);
    }

    #[test]
    fn discard_begins_pegging_after_both_players_discard() {
        let mut game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        game.discard(Side::Left, [29, 11]).unwrap();
        assert_eq!(game.phase, Phase::Discard);
        game.discard(Side::Right, [51, 15]).unwrap();
        assert_eq!(game.phase, Phase::Pegging);
        assert_eq!(ids(&game.crib), vec![29, 11, 51, 15]);
        assert_eq!(
            ids(&game.player(Side::Left).discarded_to_crib),
            vec![29, 11]
        );
        assert_eq!(
            ids(&game.player(Side::Right).discarded_to_crib),
            vec![51, 15]
        );
        assert_eq!(ids(&game.player(Side::Left).crib), vec![29, 11, 51, 15]);
    }

    #[test]
    fn pegging_thirty_one_waits_for_acknowledged_reset() {
        let mut game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        game.phase = Phase::Pegging;
        game.turn = PegTurn::Pone;
        game.count = 21;
        game.plays = vec![
            Card::new(4).unwrap(),
            Card::new(5).unwrap(),
            Card::new(9).unwrap(),
        ];
        game.player_mut(game.pone).hand = vec![Card::new(12).unwrap()];
        game.player_mut(game.dealer).hand.clear();
        let score = game.play_card(game.pone, 12).unwrap();
        assert_eq!(score, 2);
        assert_eq!(game.player(game.pone).score, 2);
        assert!(game.pegging_reset_pending);
        assert_eq!(game.count, 31);
        game.acknowledge_pegging_reset();
        assert_eq!(game.count, 0);
        assert!(!game.pegging_reset_pending);
    }

    #[test]
    fn finish_pegging_awards_last_card() {
        let mut game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        game.phase = Phase::Pegging;
        game.count = 10;
        game.last_player = Some(game.pone);
        game.player_mut(game.pone).hand.clear();
        game.player_mut(game.dealer).hand.clear();
        game.complete_pegging_if_no_cards();
        assert_eq!(game.phase, Phase::PeggingComplete);
        assert_eq!(game.player(game.pone).score, 1);
    }

    #[test]
    fn naive_policy_can_play_full_game_to_winner() {
        let mut game = CribbageGame::new_with_seed(0x9e3779b9, Side::Left);
        for _ in 0..2_000 {
            match game.phase {
                Phase::Discard => {
                    for side in [game.dealer, game.pone] {
                        if game.phase == Phase::Discard && game.player(side).hand.len() == 6 {
                            let cards = ids(&game.player(side).hand[..2]);
                            game.discard(side, [cards[0], cards[1]]).unwrap();
                        }
                    }
                }
                Phase::Pegging => {
                    if game.pegging_reset_pending {
                        game.acknowledge_pegging_reset();
                        continue;
                    }
                    let side = game.current_player();
                    let legal = game.legal_cards(side);
                    if let Some(card) = legal.first() {
                        game.play_card(side, card.id).unwrap();
                    } else {
                        game.say_go(side).unwrap();
                    }
                }
                Phase::PeggingComplete => {
                    game.score_after_pegging().unwrap();
                }
                Phase::ScorePone | Phase::ScoreDealer | Phase::ScoreCrib => {
                    game.continue_scoring().unwrap();
                }
                Phase::GameOver => {
                    assert!(
                        game.player(Side::Left).score == 121
                            || game.player(Side::Right).score == 121
                    );
                    assert!(game.hand_number > 1);
                    return;
                }
            }
        }
        panic!("naive full-game smoke exceeded guard");
    }
}
