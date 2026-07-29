pub const RANKS: [&str; 13] = [
    "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
];
pub const SUIT_ASCII: [&str; 4] = ["d", "c", "h", "s"];
pub const SUIT_NAMES: [&str; 4] = ["diamonds", "clubs", "hearts", "spades"];
pub const VALUES: [u8; 13] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Card {
    pub id: u8,
    pub rank: u8,
    pub suit: u8,
    pub value: u8,
}

impl Card {
    pub fn new(id: u8) -> Result<Card, String> {
        if id >= 52 {
            return Err(format!("card id out of range: {}", id));
        }
        let rank = id % 13;
        let suit = id / 13;
        Ok(Card {
            id,
            rank,
            suit,
            value: VALUES[rank as usize],
        })
    }

    pub fn label(&self) -> String {
        format!(
            "{}{}",
            RANKS[self.rank as usize], SUIT_ASCII[self.suit as usize]
        )
    }
}

pub fn cards_from_ids(ids: &[u8]) -> Result<Vec<Card>, String> {
    ids.iter().copied().map(Card::new).collect()
}

pub fn full_deck() -> Vec<Card> {
    (0u8..52)
        .map(|id| Card::new(id).expect("full deck id in range"))
        .collect()
}

pub fn peg_card_for_rank(rank: u8) -> Card {
    Card::new(rank).expect("rank card id in range")
}

pub fn rank_counts(cards: &[Card]) -> [u8; 13] {
    let mut counts = [0u8; 13];
    for card in cards {
        counts[card.rank as usize] += 1;
    }
    counts
}

pub fn rank_count_total(ranks: &[u8; 13]) -> u8 {
    ranks.iter().sum()
}

pub fn remaining_rank_counts(known_cards: &[Card]) -> [u8; 13] {
    let mut counts = [4u8; 13];
    for card in known_cards {
        let index = card.rank as usize;
        counts[index] = counts[index].saturating_sub(1);
    }
    counts
}

pub fn rank_count_key(counts: &[u8; 13]) -> String {
    counts
        .iter()
        .map(|count| char::from(b'0' + *count))
        .collect()
}

pub fn rank_counts_from_key(key: &str) -> Result<[u8; 13], String> {
    if key.len() != 13 {
        return Err(format!("rank-count key must be 13 characters: {}", key));
    }
    let mut counts = [0u8; 13];
    for (index, byte) in key.bytes().enumerate() {
        if !(b'0'..=b'4').contains(&byte) {
            return Err(format!("invalid rank-count digit in {}", key));
        }
        counts[index] = byte - b'0';
    }
    Ok(counts)
}

pub fn choose(n: u8, k: u8) -> f64 {
    if k > n {
        return 0.0;
    }
    if k == 0 || k == n {
        return 1.0;
    }
    let mut result = 1.0;
    for i in 1..=k {
        result = (result * f64::from(n - k + i)) / f64::from(i);
    }
    result
}

pub fn rank_combination_count(ranks: &[u8; 13], available: &[u8; 13]) -> f64 {
    let mut weight = 1.0;
    for rank in 0..13 {
        if ranks[rank] > available[rank] {
            return 0.0;
        }
        weight *= choose(available[rank], ranks[rank]);
    }
    weight
}

pub fn enumerate_rank_hands(available: &[u8; 13], size: u8) -> Vec<([u8; 13], f64)> {
    let mut hands = Vec::new();
    let mut ranks = [0u8; 13];

    fn visit(
        rank: usize,
        remaining: u8,
        weight: f64,
        available: &[u8; 13],
        ranks: &mut [u8; 13],
        hands: &mut Vec<([u8; 13], f64)>,
    ) {
        if rank == 13 {
            if remaining == 0 {
                hands.push((*ranks, weight));
            }
            return;
        }
        let max_use = available[rank].min(remaining);
        for used in 0..=max_use {
            ranks[rank] = used;
            visit(
                rank + 1,
                remaining - used,
                weight * choose(available[rank], used),
                available,
                ranks,
                hands,
            );
        }
        ranks[rank] = 0;
    }

    visit(0, size, 1.0, available, &mut ranks, &mut hands);
    hands
}

pub fn enumerate_rank_count_keys(size: u8) -> Vec<String> {
    let mut keys = Vec::new();
    let mut ranks = [0u8; 13];

    fn visit(rank: usize, remaining: u8, ranks: &mut [u8; 13], keys: &mut Vec<String>) {
        if rank == 13 {
            if remaining == 0 {
                keys.push(rank_count_key(ranks));
            }
            return;
        }
        let max_use = remaining.min(4);
        for used in 0..=max_use {
            ranks[rank] = used;
            visit(rank + 1, remaining - used, ranks, keys);
        }
        ranks[rank] = 0;
    }

    visit(0, size, &mut ranks, &mut keys);
    keys
}

pub fn combinations_indices(len: usize, size: usize) -> Vec<Vec<usize>> {
    let mut result = Vec::new();
    let mut selected = Vec::new();

    fn visit(
        start: usize,
        len: usize,
        size: usize,
        selected: &mut Vec<usize>,
        result: &mut Vec<Vec<usize>>,
    ) {
        if selected.len() == size {
            result.push(selected.clone());
            return;
        }
        let needed = size - selected.len();
        for index in start..=len - needed {
            selected.push(index);
            visit(index + 1, len, size, selected, result);
            selected.pop();
        }
    }

    if size <= len {
        visit(0, len, size, &mut selected, &mut result);
    }
    result
}

pub fn card_combinations(cards: &[Card], size: usize) -> Vec<Vec<Card>> {
    combinations_indices(cards.len(), size)
        .into_iter()
        .map(|indices| indices.into_iter().map(|index| cards[index]).collect())
        .collect()
}

pub fn cards_for_rank_counts(available: &[Card], ranks: &[u8; 13]) -> Vec<Vec<Card>> {
    let mut by_rank: Vec<Vec<Card>> = (0..13).map(|_| Vec::new()).collect();
    for card in available {
        by_rank[card.rank as usize].push(*card);
    }
    let groups: Vec<(usize, usize)> = ranks
        .iter()
        .enumerate()
        .filter_map(|(rank, count)| {
            if *count > 0 {
                Some((rank, *count as usize))
            } else {
                None
            }
        })
        .collect();
    if groups.is_empty() {
        return vec![Vec::new()];
    }
    let mut hands: Vec<Vec<Card>> = vec![Vec::new()];
    for (rank, count) in groups {
        let options = card_combinations(&by_rank[rank], count);
        if options.is_empty() {
            return Vec::new();
        }
        let mut next = Vec::new();
        for hand in &hands {
            for option in &options {
                let mut merged = hand.clone();
                merged.extend(option.iter().copied());
                next.push(merged);
            }
        }
        hands = next;
    }
    hands
}

pub fn cards_for_rank_counts_for_scoring(ranks: &[u8; 13]) -> Vec<Card> {
    let mut cards = Vec::new();
    for (rank, count) in ranks.iter().enumerate() {
        for _ in 0..*count {
            cards.push(peg_card_for_rank(rank as u8));
        }
    }
    cards
}

pub fn legal_peg_ranks(ranks: &[u8; 13], count: u8) -> Vec<u8> {
    let mut legal = Vec::new();
    for (rank, copies) in ranks.iter().enumerate() {
        if *copies > 0 && count + VALUES[rank] <= 31 {
            legal.push(rank as u8);
        }
    }
    legal
}

pub fn score_hand(hand: &[Card], turn_card: Card, crib: bool) -> u8 {
    score_hand_components(hand, turn_card, crib).total()
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct HandScoreComponents {
    pub fifteens: u8,
    pub pairs: u8,
    pub runs: u8,
    pub flush: u8,
    pub knobs: u8,
}

impl HandScoreComponents {
    pub fn total(self) -> u8 {
        self.fifteens + self.pairs + self.runs + self.flush + self.knobs
    }
}

/// Return conventional hand-score categories separately for display. A crib
/// requires the cut card for a flush, while a hand may count a four-card flush.
pub fn score_hand_components(hand: &[Card], turn_card: Card, crib: bool) -> HandScoreComponents {
    let knobs = hand
        .iter()
        .any(|card| card.rank == 10 && card.suit == turn_card.suit) as u8;
    let flush_and_knobs = score_flush_and_right_jack(hand, turn_card, crib);
    HandScoreComponents {
        fifteens: score_fifteens(hand, turn_card),
        pairs: score_sets(hand, turn_card),
        runs: score_runs(hand, turn_card),
        flush: flush_and_knobs.saturating_sub(knobs),
        knobs,
    }
}

pub fn score_hand_rank_only(hand: &[Card], turn_card: Card) -> u8 {
    score_fifteens(hand, turn_card) + score_sets(hand, turn_card) + score_runs(hand, turn_card)
}

pub fn score_fifteens(hand: &[Card], turn_card: Card) -> u8 {
    let mut cards = hand.to_vec();
    cards.push(turn_card);
    let mut points = 0u8;
    let total_masks = 1u32 << cards.len();
    for mask in 0u32..total_masks {
        if mask.count_ones() < 2 {
            continue;
        }
        let mut total = 0u8;
        for (index, card) in cards.iter().enumerate() {
            if (mask & (1u32 << index)) != 0 {
                total += card.value;
            }
        }
        if total == 15 {
            points += 2;
        }
    }
    points
}

pub fn score_sets(hand: &[Card], turn_card: Card) -> u8 {
    let mut cards = hand.to_vec();
    cards.push(turn_card);
    let mut points = 0u8;
    for i in 0..cards.len() {
        for j in (i + 1)..cards.len() {
            if cards[i].rank == cards[j].rank {
                points += 2;
            }
        }
    }
    points
}

pub fn score_runs(hand: &[Card], turn_card: Card) -> u8 {
    let mut counts = [0u8; 13];
    for card in hand {
        counts[card.rank as usize] += 1;
    }
    counts[turn_card.rank as usize] += 1;

    let mut best_len = 0usize;
    let mut best_mult = 0u8;
    let mut rank = 0usize;
    while rank < 13 {
        while rank < 13 && counts[rank] == 0 {
            rank += 1;
        }
        let start = rank;
        let mut mult = 1u8;
        while rank < 13 && counts[rank] > 0 {
            mult *= counts[rank];
            rank += 1;
        }
        let len = rank - start;
        if len >= 3 && len > best_len {
            best_len = len;
            best_mult = mult;
        }
    }

    if best_len >= 3 {
        (best_len as u8) * best_mult
    } else {
        0
    }
}

pub fn score_flush_and_right_jack(hand: &[Card], turn_card: Card, crib: bool) -> u8 {
    let mut points = 0u8;
    for card in hand {
        if card.rank == 10 && card.suit == turn_card.suit {
            points += 1;
        }
    }
    if hand.is_empty() {
        return points;
    }
    let suit = hand[0].suit;
    if hand.iter().all(|card| card.suit == suit) {
        if suit == turn_card.suit {
            points += 5;
        } else if !crib {
            points += 4;
        }
    }
    points
}

pub fn score_count(plays: &[Card]) -> u8 {
    if plays.len() < 2 {
        return 0;
    }
    let mut points = 0u8;
    let count: u8 = plays.iter().map(|card| card.value).sum();
    if count == 15 {
        points += 2;
    }
    if count == 31 {
        points += 2;
    }

    let last_rank = plays[plays.len() - 1].rank;
    let mut same_rank_count = 1usize;
    for card in plays[..plays.len() - 1].iter().rev() {
        if card.rank != last_rank {
            break;
        }
        same_rank_count += 1;
    }
    points += match same_rank_count {
        2 => 2,
        3 => 6,
        4 => 12,
        _ => 0,
    };

    for run_len in (3..=plays.len()).rev() {
        let tail = &plays[(plays.len() - run_len)..];
        let mut seen = [false; 13];
        let mut min_rank = 13u8;
        let mut max_rank = 0u8;
        let mut unique = true;
        for card in tail {
            let rank = card.rank as usize;
            if seen[rank] {
                unique = false;
                break;
            }
            seen[rank] = true;
            min_rank = min_rank.min(card.rank);
            max_rank = max_rank.max(card.rank);
        }
        if unique && (max_rank - min_rank + 1) as usize == run_len {
            points += run_len as u8;
            break;
        }
    }

    points
}

pub fn self_test() -> Result<(), String> {
    let cases: Vec<(&str, Vec<u8>, u8, bool, u8, u8)> = vec![
        ("double-run-four", vec![0, 14, 28, 42], 2, false, 8, 10),
        ("double-double-run", vec![0, 14, 28, 41], 1, false, 12, 16),
        ("crib-flush", vec![26, 32, 33, 35], 51, true, 0, 2),
    ];
    for (name, hand_ids, cut_id, crib, expected_runs, expected_score) in cases {
        let hand = cards_from_ids(&hand_ids)?;
        let cut = Card::new(cut_id)?;
        let runs = score_runs(&hand, cut);
        let score = score_hand(&hand, cut, crib);
        if runs != expected_runs || score != expected_score {
            return Err(format!(
                "{} failed: runs {} != {}, score {} != {}",
                name, runs, expected_runs, score, expected_score
            ));
        }
    }

    let pegging_cases: Vec<(&str, Vec<u8>, u8)> = vec![
        ("pegging-run-345", vec![2, 29, 43], 3),
        ("pegging-run-435", vec![29, 2, 43], 3),
        ("pegging-triple-8", vec![7, 20, 33], 6),
    ];
    for (name, ids, expected) in pegging_cases {
        let cards = cards_from_ids(&ids)?;
        let score = score_count(&cards);
        if score != expected {
            return Err(format!("{} failed: score {} != {}", name, score, expected));
        }
    }

    Ok(())
}
