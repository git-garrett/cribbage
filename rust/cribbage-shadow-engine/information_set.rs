use crate::board::Role;
use crate::cards::{peg_card_for_rank, rank_counts, score_count, Card};
use crate::game::{CribbageGame, PegHistoryEvent, Side};

const RANKS: usize = 13;
const MAX_PUBLIC_HISTORY: usize = 32;
pub const POLICY_ACTION_COUNT: usize = 14;
pub const PACKED_POLICY_KEY_BYTES: usize = 37;
/// Lossless, full legal-information key used by the Model 16.1 policy path.
/// It intentionally remains distinct from the smaller, generalized Model
/// 16.0 learning key above.
pub const EXACT_PEG_POLICY_KEY_BYTES: usize = 57;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum InfoActor {
    SelfPlayer,
    Opponent,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PublicPegEvent {
    SelfPlay(u8),
    OpponentPlay(u8),
    SelfGo,
    OpponentGo,
    Reset,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct PegInformationSetKey {
    pub role: Role,
    pub my_score: u8,
    pub opponent_score: u8,
    pub own_hand_ranks: u64,
    pub own_discard_ranks: u64,
    pub turn_rank: u8,
    pub count: u8,
    pub current: InfoActor,
    pub go_player: Option<InfoActor>,
    pub last_player: Option<InfoActor>,
    history: [u8; MAX_PUBLIC_HISTORY],
    history_len: u8,
}

pub struct PegObservation<'a> {
    pub role: Role,
    pub my_score: i32,
    pub opponent_score: i32,
    pub own_hand: &'a [Card],
    pub own_discards: &'a [Card],
    pub turn_card: Card,
    pub count: u8,
    pub current: InfoActor,
    pub go_player: Option<InfoActor>,
    pub last_player: Option<InfoActor>,
    pub history: &'a [PublicPegEvent],
}

pub struct PolicyRankObservation<'a> {
    pub role: Role,
    pub my_score: i32,
    pub opponent_score: i32,
    pub own_hand: &'a [u8; RANKS],
    pub own_played: &'a [u8; RANKS],
    pub opponent_played: &'a [u8; RANKS],
    pub current_series: &'a [u8],
    pub count: u8,
    pub go_player: Option<InfoActor>,
    pub last_player: Option<InfoActor>,
}

impl PegInformationSetKey {
    pub fn from_observation(observation: PegObservation<'_>) -> Result<Self, String> {
        if observation.history.len() > MAX_PUBLIC_HISTORY {
            return Err(format!(
                "public pegging history has {} events; maximum is {}",
                observation.history.len(),
                MAX_PUBLIC_HISTORY
            ));
        }
        let mut history = [0_u8; MAX_PUBLIC_HISTORY];
        for (index, event) in observation.history.iter().enumerate() {
            history[index] = encode_public_event(*event)?;
        }
        Ok(PegInformationSetKey {
            role: observation.role,
            my_score: observation.my_score.clamp(0, 121) as u8,
            opponent_score: observation.opponent_score.clamp(0, 121) as u8,
            own_hand_ranks: pack_rank_counts(&rank_counts(observation.own_hand)),
            own_discard_ranks: pack_rank_counts(&rank_counts(observation.own_discards)),
            turn_rank: observation.turn_card.rank,
            count: observation.count,
            current: observation.current,
            go_player: observation.go_player,
            last_player: observation.last_player,
            history,
            history_len: observation.history.len() as u8,
        })
    }

    pub fn history(&self) -> Result<Vec<PublicPegEvent>, String> {
        if self.history_len as usize > MAX_PUBLIC_HISTORY {
            return Err("packed exact pegging history length exceeds capacity".to_string());
        }
        self.history[..self.history_len as usize]
            .iter()
            .copied()
            .map(decode_public_event)
            .collect()
    }

    pub fn to_packed_bytes(&self) -> [u8; EXACT_PEG_POLICY_KEY_BYTES] {
        let mut bytes = [0_u8; EXACT_PEG_POLICY_KEY_BYTES];
        bytes[0] = match self.role {
            Role::Pone => 0,
            Role::Dealer => 1,
        };
        bytes[1] = self.my_score;
        bytes[2] = self.opponent_score;
        bytes[3..11].copy_from_slice(&self.own_hand_ranks.to_le_bytes());
        bytes[11..19].copy_from_slice(&self.own_discard_ranks.to_le_bytes());
        bytes[19] = self.turn_rank;
        bytes[20] = self.count;
        bytes[21] = encode_exact_actor(self.current);
        bytes[22] = encode_exact_optional_actor(self.go_player);
        bytes[23] = encode_exact_optional_actor(self.last_player);
        bytes[24] = self.history_len;
        bytes[25..].copy_from_slice(&self.history);
        bytes
    }

    pub fn from_packed_bytes(bytes: &[u8]) -> Result<PegInformationSetKey, String> {
        if bytes.len() != EXACT_PEG_POLICY_KEY_BYTES {
            return Err(format!(
                "packed exact pegging key has {} bytes; expected {}",
                bytes.len(),
                EXACT_PEG_POLICY_KEY_BYTES
            ));
        }
        let role = match bytes[0] {
            0 => Role::Pone,
            1 => Role::Dealer,
            value => return Err(format!("invalid exact policy role {}", value)),
        };
        let own_hand_ranks = u64::from_le_bytes(bytes[3..11].try_into().unwrap());
        let own_discard_ranks = u64::from_le_bytes(bytes[11..19].try_into().unwrap());
        validate_policy_rank_counts(own_hand_ranks)?;
        validate_policy_rank_counts(own_discard_ranks)?;
        if bytes[19] >= RANKS as u8 {
            return Err(format!("invalid exact policy turn rank {}", bytes[19]));
        }
        if bytes[20] > 31 {
            return Err(format!("invalid exact policy count {}", bytes[20]));
        }
        let history_len = bytes[24] as usize;
        if history_len > MAX_PUBLIC_HISTORY {
            return Err(format!(
                "invalid exact policy history length {}",
                history_len
            ));
        }
        let mut history = [0_u8; MAX_PUBLIC_HISTORY];
        history.copy_from_slice(&bytes[25..]);
        for event in history.iter().take(history_len) {
            decode_public_event(*event)?;
        }
        if history.iter().skip(history_len).any(|event| *event != 0) {
            return Err("exact policy key has data after its history".to_string());
        }
        Ok(PegInformationSetKey {
            role,
            my_score: bytes[1],
            opponent_score: bytes[2],
            own_hand_ranks,
            own_discard_ranks,
            turn_rank: bytes[19],
            count: bytes[20],
            current: decode_exact_actor(bytes[21])?,
            go_player: decode_exact_optional_actor(bytes[22])?,
            last_player: decode_exact_optional_actor(bytes[23])?,
            history,
            history_len: history_len as u8,
        })
    }
}

pub fn perspective_history(game: &CribbageGame, perspective: Side) -> Vec<PublicPegEvent> {
    game.pegging_history
        .iter()
        .map(|event| match *event {
            PegHistoryEvent::Play { side, rank } if side == perspective => {
                PublicPegEvent::SelfPlay(rank)
            }
            PegHistoryEvent::Play { rank, .. } => PublicPegEvent::OpponentPlay(rank),
            PegHistoryEvent::Go { side } if side == perspective => PublicPegEvent::SelfGo,
            PegHistoryEvent::Go { .. } => PublicPegEvent::OpponentGo,
            PegHistoryEvent::Reset => PublicPegEvent::Reset,
        })
        .collect()
}

pub fn information_set_from_game(
    game: &CribbageGame,
    perspective: Side,
) -> Result<PegInformationSetKey, String> {
    let opponent = perspective.other();
    let history = perspective_history(game, perspective);
    PegInformationSetKey::from_observation(PegObservation {
        role: if perspective == game.dealer {
            Role::Dealer
        } else {
            Role::Pone
        },
        my_score: game.player(perspective).score,
        opponent_score: game.player(opponent).score,
        own_hand: &game.player(perspective).hand,
        own_discards: &game.player(perspective).discarded_to_crib,
        turn_card: game.turn_card,
        count: game.count,
        current: actor(game.current_player(), perspective),
        go_player: game.go_player.map(|side| actor(side, perspective)),
        last_player: game.last_player.map(|side| actor(side, perspective)),
        history: &history,
    })
}

fn actor(side: Side, perspective: Side) -> InfoActor {
    if side == perspective {
        InfoActor::SelfPlayer
    } else {
        InfoActor::Opponent
    }
}

fn encode_exact_actor(actor: InfoActor) -> u8 {
    match actor {
        InfoActor::SelfPlayer => 0,
        InfoActor::Opponent => 1,
    }
}

fn decode_exact_actor(value: u8) -> Result<InfoActor, String> {
    match value {
        0 => Ok(InfoActor::SelfPlayer),
        1 => Ok(InfoActor::Opponent),
        value => Err(format!("invalid exact policy actor {}", value)),
    }
}

fn encode_exact_optional_actor(actor: Option<InfoActor>) -> u8 {
    match actor {
        None => 0,
        Some(InfoActor::SelfPlayer) => 1,
        Some(InfoActor::Opponent) => 2,
    }
}

fn decode_exact_optional_actor(value: u8) -> Result<Option<InfoActor>, String> {
    match value {
        0 => Ok(None),
        1 => Ok(Some(InfoActor::SelfPlayer)),
        2 => Ok(Some(InfoActor::Opponent)),
        value => Err(format!("invalid exact policy optional actor {}", value)),
    }
}

fn pack_rank_counts(counts: &[u8; RANKS]) -> u64 {
    counts
        .iter()
        .enumerate()
        .fold(0_u64, |packed, (rank, count)| {
            packed | (u64::from(*count) << (rank * 3))
        })
}

/// Runtime/training abstraction over exact legal information sets. Every
/// field is observable by the acting player; cut and private discard ranks are
/// intentionally omitted so equivalent pegging situations share experience.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct PolicyInformationSetKey {
    pub role: Role,
    pub board_pressure_class: u8,
    pub own_hand_ranks: u64,
    pub own_played_ranks: u64,
    pub opponent_played_ranks: u64,
    pub current_series: u64,
    pub count: u8,
    pub go_player: u8,
    pub last_player: u8,
}

impl PolicyInformationSetKey {
    pub fn from_state(state: &RankPegState, perspective: PegSeat) -> Result<Self, String> {
        let mut own_played = [0_u8; RANKS];
        let mut opponent_played = [0_u8; RANKS];
        for event in &state.history {
            if let RankPegEvent::Play { seat, rank } = *event {
                add_policy_played_rank(
                    if seat == perspective {
                        &mut own_played
                    } else {
                        &mut opponent_played
                    },
                    rank,
                )?;
            }
        }
        Self::from_rank_observation(PolicyRankObservation {
            role: if perspective == state.dealer {
                Role::Dealer
            } else {
                Role::Pone
            },
            my_score: state.scores[perspective.index()],
            opponent_score: state.scores[perspective.other().index()],
            own_hand: &state.hands[perspective.index()],
            own_played: &own_played,
            opponent_played: &opponent_played,
            current_series: &state.plays,
            count: state.count,
            go_player: relative_seat(state.go_player, perspective),
            last_player: relative_seat(state.last_player, perspective),
        })
    }

    pub fn from_game(game: &CribbageGame, perspective: Side) -> Result<Self, String> {
        let mut own_played = [0_u8; RANKS];
        let mut opponent_played = [0_u8; RANKS];
        for event in &game.pegging_history {
            if let PegHistoryEvent::Play { side, rank } = *event {
                add_policy_played_rank(
                    if side == perspective {
                        &mut own_played
                    } else {
                        &mut opponent_played
                    },
                    rank,
                )?;
            }
        }
        let current_series = game.plays.iter().map(|card| card.rank).collect::<Vec<_>>();
        Self::from_rank_observation(PolicyRankObservation {
            role: if perspective == game.dealer {
                Role::Dealer
            } else {
                Role::Pone
            },
            my_score: game.player(perspective).score,
            opponent_score: game.player(perspective.other()).score,
            own_hand: &rank_counts(&game.player(perspective).hand),
            own_played: &own_played,
            opponent_played: &opponent_played,
            current_series: &current_series,
            count: game.count,
            go_player: relative_side(game.go_player, perspective),
            last_player: relative_side(game.last_player, perspective),
        })
    }

    pub fn from_rank_observation(observation: PolicyRankObservation<'_>) -> Result<Self, String> {
        Ok(PolicyInformationSetKey {
            role: observation.role,
            board_pressure_class: board_pressure_class(
                observation.my_score,
                observation.opponent_score,
            ),
            own_hand_ranks: pack_rank_counts(observation.own_hand),
            own_played_ranks: pack_rank_counts(observation.own_played),
            opponent_played_ranks: pack_rank_counts(observation.opponent_played),
            current_series: pack_current_series(observation.current_series)?,
            count: observation.count,
            go_player: encode_policy_actor(observation.go_player),
            last_player: encode_policy_actor(observation.last_player),
        })
    }

    pub fn expected_legal_mask(&self) -> u16 {
        let mut mask = 0_u16;
        for rank in 0..RANKS {
            let copies = (self.own_hand_ranks >> (rank * 3)) & 0b111;
            if copies != 0 && self.count + peg_card_for_rank(rank as u8).value <= 31 {
                mask |= 1 << rank;
            }
        }
        if mask == 0 {
            1 << (POLICY_ACTION_COUNT - 1)
        } else {
            mask
        }
    }

    pub fn to_packed_bytes(&self) -> [u8; PACKED_POLICY_KEY_BYTES] {
        let mut bytes = [0_u8; PACKED_POLICY_KEY_BYTES];
        bytes[0] = match self.role {
            Role::Pone => 0,
            Role::Dealer => 1,
        };
        bytes[1] = self.board_pressure_class;
        bytes[2..10].copy_from_slice(&self.own_hand_ranks.to_le_bytes());
        bytes[10..18].copy_from_slice(&self.own_played_ranks.to_le_bytes());
        bytes[18..26].copy_from_slice(&self.opponent_played_ranks.to_le_bytes());
        bytes[26..34].copy_from_slice(&self.current_series.to_le_bytes());
        bytes[34] = self.count;
        bytes[35] = self.go_player;
        bytes[36] = self.last_player;
        bytes
    }

    pub fn from_packed_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() != PACKED_POLICY_KEY_BYTES {
            return Err(format!(
                "packed policy key has {} bytes; expected {}",
                bytes.len(),
                PACKED_POLICY_KEY_BYTES
            ));
        }
        let role = match bytes[0] {
            0 => Role::Pone,
            1 => Role::Dealer,
            value => return Err(format!("invalid policy role {}", value)),
        };
        if bytes[1] > 16 {
            return Err("invalid policy board-pressure class".to_string());
        }
        let own_hand_ranks = u64::from_le_bytes(bytes[2..10].try_into().unwrap());
        let own_played_ranks = u64::from_le_bytes(bytes[10..18].try_into().unwrap());
        let opponent_played_ranks = u64::from_le_bytes(bytes[18..26].try_into().unwrap());
        validate_policy_rank_counts(own_hand_ranks)?;
        validate_policy_rank_counts(own_played_ranks)?;
        validate_policy_rank_counts(opponent_played_ranks)?;
        let current_series = u64::from_le_bytes(bytes[26..34].try_into().unwrap());
        validate_current_series(current_series)?;
        if bytes[34] > 31 {
            return Err(format!("invalid policy count {}", bytes[34]));
        }
        if bytes[35] > 2 || bytes[36] > 2 {
            return Err("invalid relative policy actor".to_string());
        }
        Ok(PolicyInformationSetKey {
            role,
            board_pressure_class: bytes[1],
            own_hand_ranks,
            own_played_ranks,
            opponent_played_ranks,
            current_series,
            count: bytes[34],
            go_player: bytes[35],
            last_player: bytes[36],
        })
    }
}

fn board_pressure_class(my_score: i32, opponent_score: i32) -> u8 {
    if my_score >= 117 {
        let my_out = (121 - my_score).clamp(1, 4) as u8;
        return if opponent_score >= 117 {
            4 + my_out
        } else {
            my_out
        };
    }
    if opponent_score >= 117 {
        return 8 + (121 - opponent_score).clamp(1, 4) as u8;
    }
    match (my_score >= 105, opponent_score >= 105) {
        (false, false) => 0,
        (true, false) => 13,
        (false, true) => 14,
        (true, true) if my_score >= opponent_score => 15,
        (true, true) => 16,
    }
}

fn add_policy_played_rank(counts: &mut [u8; RANKS], rank: u8) -> Result<(), String> {
    if rank >= RANKS as u8 {
        return Err(format!("invalid policy history rank {}", rank));
    }
    counts[rank as usize] += 1;
    if counts[rank as usize] > 4 {
        return Err(format!(
            "policy history has more than four rank {} cards",
            rank
        ));
    }
    Ok(())
}

fn pack_current_series(plays: &[u8]) -> Result<u64, String> {
    if plays.len() > 8 {
        return Err(format!(
            "current pegging series has {} plays; maximum is 8",
            plays.len()
        ));
    }
    let mut packed = 0_u64;
    for (index, rank) in plays.iter().copied().enumerate() {
        if rank >= RANKS as u8 {
            return Err(format!("invalid current-series rank {}", rank));
        }
        packed |= u64::from(rank + 1) << (index * 4);
    }
    Ok(packed)
}

fn relative_seat(seat: Option<PegSeat>, perspective: PegSeat) -> Option<InfoActor> {
    match seat {
        None => None,
        Some(seat) if seat == perspective => Some(InfoActor::SelfPlayer),
        Some(_) => Some(InfoActor::Opponent),
    }
}

fn relative_side(side: Option<Side>, perspective: Side) -> Option<InfoActor> {
    match side {
        None => None,
        Some(side) if side == perspective => Some(InfoActor::SelfPlayer),
        Some(_) => Some(InfoActor::Opponent),
    }
}

fn encode_policy_actor(actor: Option<InfoActor>) -> u8 {
    match actor {
        None => 0,
        Some(InfoActor::SelfPlayer) => 1,
        Some(InfoActor::Opponent) => 2,
    }
}

fn validate_policy_rank_counts(packed: u64) -> Result<(), String> {
    if packed >> (RANKS * 3) != 0 {
        return Err("packed policy rank counts use reserved bits".to_string());
    }
    for rank in 0..RANKS {
        if ((packed >> (rank * 3)) & 0b111) > 4 {
            return Err(format!("invalid packed policy count at rank {}", rank));
        }
    }
    Ok(())
}

fn validate_current_series(mut packed: u64) -> Result<(), String> {
    let mut found_zero = false;
    for _ in 0..8 {
        let rank = packed & 0b1111;
        if rank == 0 {
            found_zero = true;
        } else if found_zero || rank > RANKS as u64 {
            return Err("invalid packed current pegging series".to_string());
        }
        packed >>= 4;
    }
    if packed != 0 {
        return Err("packed current series uses reserved bits".to_string());
    }
    Ok(())
}

fn encode_public_event(event: PublicPegEvent) -> Result<u8, String> {
    match event {
        PublicPegEvent::SelfPlay(rank) if rank < RANKS as u8 => Ok(1 + rank),
        PublicPegEvent::OpponentPlay(rank) if rank < RANKS as u8 => Ok(14 + rank),
        PublicPegEvent::SelfGo => Ok(27),
        PublicPegEvent::OpponentGo => Ok(28),
        PublicPegEvent::Reset => Ok(29),
        PublicPegEvent::SelfPlay(rank) | PublicPegEvent::OpponentPlay(rank) => {
            Err(format!("invalid pegging rank {}", rank))
        }
    }
}

fn decode_public_event(value: u8) -> Result<PublicPegEvent, String> {
    match value {
        1..=13 => Ok(PublicPegEvent::SelfPlay(value - 1)),
        14..=26 => Ok(PublicPegEvent::OpponentPlay(value - 14)),
        27 => Ok(PublicPegEvent::SelfGo),
        28 => Ok(PublicPegEvent::OpponentGo),
        29 => Ok(PublicPegEvent::Reset),
        other => Err(format!("invalid packed public pegging event {}", other)),
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PegSeat {
    Zero,
    One,
}

impl PegSeat {
    pub fn index(self) -> usize {
        match self {
            PegSeat::Zero => 0,
            PegSeat::One => 1,
        }
    }

    pub fn other(self) -> PegSeat {
        match self {
            PegSeat::Zero => PegSeat::One,
            PegSeat::One => PegSeat::Zero,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RankPegAction {
    Play(u8),
    Go,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RankPegEvent {
    Play { seat: PegSeat, rank: u8 },
    Go { seat: PegSeat },
    Reset,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RankPegState {
    pub hands: [[u8; RANKS]; 2],
    pub own_discards: [[u8; RANKS]; 2],
    pub turn_rank: u8,
    pub scores: [i32; 2],
    pub dealer: PegSeat,
    pub current: PegSeat,
    pub plays: Vec<u8>,
    pub count: u8,
    pub go_player: Option<PegSeat>,
    pub last_player: Option<PegSeat>,
    pub history: Vec<RankPegEvent>,
    pub winner: Option<PegSeat>,
    pub complete: bool,
}

impl RankPegState {
    pub fn legal_actions(&self) -> Vec<RankPegAction> {
        if self.complete || self.winner.is_some() {
            return Vec::new();
        }
        let legal = legal_ranks(&self.hands[self.current.index()], self.count);
        if legal.is_empty() {
            vec![RankPegAction::Go]
        } else {
            legal.into_iter().map(RankPegAction::Play).collect()
        }
    }

    pub fn apply(&mut self, action: RankPegAction) -> Result<i32, String> {
        if self.complete || self.winner.is_some() {
            return Err("pegging state is already terminal".to_string());
        }
        match action {
            RankPegAction::Play(rank) => self.apply_play(rank),
            RankPegAction::Go => self.apply_go(),
        }
    }

    pub fn information_set(&self, perspective: PegSeat) -> Result<PegInformationSetKey, String> {
        let history = self
            .history
            .iter()
            .map(|event| perspective_event(*event, perspective))
            .collect::<Vec<_>>();
        let own_hand = cards_for_rank_counts(&self.hands[perspective.index()]);
        let own_discards = cards_for_rank_counts(&self.own_discards[perspective.index()]);
        PegInformationSetKey::from_observation(PegObservation {
            role: if perspective == self.dealer {
                Role::Dealer
            } else {
                Role::Pone
            },
            my_score: self.scores[perspective.index()],
            opponent_score: self.scores[perspective.other().index()],
            own_hand: &own_hand,
            own_discards: &own_discards,
            turn_card: peg_card_for_rank(self.turn_rank),
            count: self.count,
            current: seat_actor(self.current, perspective),
            go_player: self.go_player.map(|seat| seat_actor(seat, perspective)),
            last_player: self.last_player.map(|seat| seat_actor(seat, perspective)),
            history: &history,
        })
    }

    fn apply_play(&mut self, rank: u8) -> Result<i32, String> {
        if rank >= RANKS as u8 {
            return Err(format!("invalid pegging rank {}", rank));
        }
        let current_index = self.current.index();
        if self.hands[current_index][rank as usize] == 0 {
            return Err(format!("rank {} is not in the current hand", rank));
        }
        let card = peg_card_for_rank(rank);
        if self.count + card.value > 31 {
            return Err(format!("rank {} would take the count over 31", rank));
        }
        self.hands[current_index][rank as usize] -= 1;
        self.history.push(RankPegEvent::Play {
            seat: self.current,
            rank,
        });
        self.plays.push(rank);
        self.count += card.value;
        self.last_player = Some(self.current);
        let played_cards = self
            .plays
            .iter()
            .copied()
            .map(peg_card_for_rank)
            .collect::<Vec<_>>();
        let points = i32::from(score_count(&played_cards));
        self.add_score(self.current, points);
        if self.winner.is_some() {
            return Ok(points);
        }
        if self.count == 31 {
            self.reset_series(self.current.other());
        } else if self.go_player.is_none() {
            self.current = self.current.other();
        }
        self.complete_if_empty();
        Ok(points)
    }

    fn apply_go(&mut self) -> Result<i32, String> {
        if !legal_ranks(&self.hands[self.current.index()], self.count).is_empty() {
            return Err("current player still has a legal rank".to_string());
        }
        self.history.push(RankPegEvent::Go { seat: self.current });
        if self.go_player.is_some() {
            let scorer = self.last_player;
            let points = i32::from(scorer.is_some() && self.count != 31);
            if let Some(last_player) = scorer {
                if points != 0 {
                    self.add_score(last_player, points);
                }
            }
            if self.winner.is_none() {
                self.reset_series(self.current.other());
                self.complete_if_empty_without_last();
            }
            Ok(points)
        } else {
            self.go_player = Some(self.current);
            self.current = self.current.other();
            Ok(0)
        }
    }

    fn reset_series(&mut self, next: PegSeat) {
        self.history.push(RankPegEvent::Reset);
        self.plays.clear();
        self.count = 0;
        self.go_player = None;
        self.last_player = None;
        self.current = next;
    }

    fn complete_if_empty(&mut self) {
        if self.hands.iter().flatten().any(|count| *count != 0) {
            return;
        }
        if self.count != 0 {
            if let Some(last_player) = self.last_player {
                self.add_score(last_player, 1);
            }
        }
        self.complete = self.winner.is_none();
    }

    fn complete_if_empty_without_last(&mut self) {
        if self.hands.iter().flatten().all(|count| *count == 0) {
            self.complete = self.winner.is_none();
        }
    }

    fn add_score(&mut self, seat: PegSeat, points: i32) {
        if points <= 0 || self.winner.is_some() {
            return;
        }
        let score = &mut self.scores[seat.index()];
        *score = (*score + points).min(121);
        if *score >= 121 {
            self.winner = Some(seat);
            self.complete = true;
        }
    }
}

fn legal_ranks(hand: &[u8; RANKS], count: u8) -> Vec<u8> {
    hand.iter()
        .enumerate()
        .filter_map(|(rank, copies)| {
            (*copies > 0 && count + peg_card_for_rank(rank as u8).value <= 31).then_some(rank as u8)
        })
        .collect()
}

fn cards_for_rank_counts(counts: &[u8; RANKS]) -> Vec<Card> {
    let mut cards = Vec::new();
    for (rank, copies) in counts.iter().enumerate() {
        for _ in 0..*copies {
            cards.push(peg_card_for_rank(rank as u8));
        }
    }
    cards
}

fn seat_actor(seat: PegSeat, perspective: PegSeat) -> InfoActor {
    if seat == perspective {
        InfoActor::SelfPlayer
    } else {
        InfoActor::Opponent
    }
}

fn perspective_event(event: RankPegEvent, perspective: PegSeat) -> PublicPegEvent {
    match event {
        RankPegEvent::Play { seat, rank } if seat == perspective => PublicPegEvent::SelfPlay(rank),
        RankPegEvent::Play { rank, .. } => PublicPegEvent::OpponentPlay(rank),
        RankPegEvent::Go { seat } if seat == perspective => PublicPegEvent::SelfGo,
        RankPegEvent::Go { .. } => PublicPegEvent::OpponentGo,
        RankPegEvent::Reset => PublicPegEvent::Reset,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hand(entries: &[(u8, u8)]) -> [u8; RANKS] {
        let mut hand = [0_u8; RANKS];
        for (rank, count) in entries {
            hand[*rank as usize] = *count;
        }
        hand
    }

    fn state(hands: [[u8; RANKS]; 2]) -> RankPegState {
        RankPegState {
            hands,
            own_discards: [hand(&[(0, 1), (1, 1)]), hand(&[(2, 1), (3, 1)])],
            turn_rank: 4,
            scores: [0, 0],
            dealer: PegSeat::One,
            current: PegSeat::Zero,
            plays: Vec::new(),
            count: 0,
            go_player: None,
            last_player: None,
            history: Vec::new(),
            winner: None,
            complete: false,
        }
    }

    #[test]
    fn information_set_excludes_hidden_opponent_hand() {
        let first = state([hand(&[(4, 1), (5, 1)]), hand(&[(6, 1), (7, 1)])]);
        let second = state([hand(&[(4, 1), (5, 1)]), hand(&[(8, 1), (9, 1)])]);

        assert_eq!(
            first.information_set(PegSeat::Zero).unwrap(),
            second.information_set(PegSeat::Zero).unwrap()
        );
        assert_eq!(first.legal_actions(), second.legal_actions());
    }

    #[test]
    fn information_set_preserves_ordered_public_history() {
        let mut first = state([hand(&[(4, 1)]), hand(&[(5, 1)])]);
        first.history = vec![
            RankPegEvent::Play {
                seat: PegSeat::Zero,
                rank: 4,
            },
            RankPegEvent::Play {
                seat: PegSeat::One,
                rank: 5,
            },
        ];
        let mut second = first.clone();
        second.history.reverse();

        assert_ne!(
            first.information_set(PegSeat::Zero).unwrap(),
            second.information_set(PegSeat::Zero).unwrap()
        );
    }

    #[test]
    fn exact_policy_key_round_trips_and_rejects_trailing_history() {
        let mut game = state([hand(&[(4, 1), (9, 1)]), hand(&[(6, 1), (7, 1)])]);
        game.scores = [119, 118];
        game.count = 13;
        game.plays = vec![4, 7];
        game.go_player = Some(PegSeat::One);
        game.last_player = Some(PegSeat::Zero);
        game.history = vec![
            RankPegEvent::Play {
                seat: PegSeat::Zero,
                rank: 4,
            },
            RankPegEvent::Play {
                seat: PegSeat::One,
                rank: 7,
            },
        ];
        let key = game.information_set(PegSeat::Zero).unwrap();
        let bytes = key.to_packed_bytes();

        assert_eq!(
            PegInformationSetKey::from_packed_bytes(&bytes).unwrap(),
            key
        );
        let mut corrupt = bytes;
        corrupt[25 + 3] = 29;
        assert!(PegInformationSetKey::from_packed_bytes(&corrupt).is_err());
        assert!(PegInformationSetKey::from_packed_bytes(&bytes[..56]).is_err());
    }

    #[test]
    fn runtime_rank_observation_matches_simulator_policy_key() {
        let mut simulator = state([hand(&[(4, 1), (9, 1)]), hand(&[(6, 2)])]);
        simulator.scores = [97, 112];
        simulator.plays = vec![7];
        simulator.count = 8;
        simulator.go_player = None;
        simulator.last_player = Some(PegSeat::One);
        simulator.history = vec![
            RankPegEvent::Play {
                seat: PegSeat::Zero,
                rank: 5,
            },
            RankPegEvent::Reset,
            RankPegEvent::Play {
                seat: PegSeat::One,
                rank: 7,
            },
        ];
        let own_played = hand(&[(5, 1)]);
        let opponent_played = hand(&[(7, 1)]);
        let runtime = PolicyInformationSetKey::from_rank_observation(PolicyRankObservation {
            role: Role::Pone,
            my_score: 97,
            opponent_score: 112,
            own_hand: &simulator.hands[0],
            own_played: &own_played,
            opponent_played: &opponent_played,
            current_series: &[7],
            count: 8,
            go_player: None,
            last_player: Some(InfoActor::Opponent),
        })
        .unwrap();

        assert_eq!(
            runtime,
            PolicyInformationSetKey::from_state(&simulator, PegSeat::Zero).unwrap()
        );
    }

    #[test]
    fn simulator_scores_thirty_one_and_resets_deterministically() {
        let mut first = state([hand(&[(9, 2)]), hand(&[(9, 1), (0, 1)])]);
        let mut second = first.clone();
        let actions = [
            RankPegAction::Play(9),
            RankPegAction::Play(9),
            RankPegAction::Play(9),
            RankPegAction::Play(0),
        ];
        let mut final_points = 0;
        for action in actions {
            final_points = first.apply(action).unwrap();
            assert_eq!(second.apply(action).unwrap(), final_points);
        }

        assert_eq!(first, second);
        assert_eq!(final_points, 2);
        assert_eq!(first.count, 0);
        assert_eq!(first.current, PegSeat::Zero);
        assert_eq!(first.scores[PegSeat::One.index()], 4);
        assert_eq!(first.history.last(), Some(&RankPegEvent::Reset));
    }

    #[test]
    fn simulator_records_go_and_awards_last_card() {
        let mut game = state([hand(&[(9, 1)]), hand(&[(9, 1)])]);
        game.count = 25;
        game.plays = vec![9, 9, 4];
        game.last_player = Some(PegSeat::One);

        assert_eq!(game.legal_actions(), vec![RankPegAction::Go]);
        game.apply(RankPegAction::Go).unwrap();
        assert_eq!(game.current, PegSeat::One);
        game.apply(RankPegAction::Go).unwrap();

        assert_eq!(game.scores[PegSeat::One.index()], 1);
        assert!(game.history.contains(&RankPegEvent::Go {
            seat: PegSeat::Zero
        }));
        assert!(game.history.contains(&RankPegEvent::Reset));
    }

    #[test]
    fn simulator_stops_immediately_on_terminal_score() {
        let mut game = state([hand(&[(6, 1)]), hand(&[(7, 1)])]);
        game.scores[0] = 119;
        game.plays = vec![6];
        game.count = 7;
        game.last_player = Some(PegSeat::One);

        game.apply(RankPegAction::Play(6)).unwrap();

        assert_eq!(game.winner, Some(PegSeat::Zero));
        assert!(game.complete);
        assert!(game.legal_actions().is_empty());
    }
}
