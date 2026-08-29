//! Benchmark-only implementation of Richard Moulton and AJ Marasco's
//! Myrmidon agent.
//!
//! The decision contract follows the published `Myrmidon.py` behavior with
//! five sampled starter cards.  It deliberately preserves the reference
//! agent's rank-based card-membership semantics, including excluding every
//! rank already present in the dealt hand from starter sampling.

use crate::board::Role;
use crate::cards::{card_combinations, full_deck, score_count, score_hand, Card};

pub const MYRMIDON_STARTER_SAMPLES: usize = 5;

#[derive(Clone, Copy, Debug)]
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        SplitMix64 { state: seed }
    }

    fn next(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        value ^ (value >> 31)
    }

    fn index(&mut self, upper: usize) -> usize {
        debug_assert!(upper > 0);
        (self.next() % upper as u64) as usize
    }
}

/// Select two crib cards using Myrmidon's five-sample discard heuristic.
///
/// The random seed is supplied by the benchmark runner and does not advance
/// the deal RNG, preserving paired deals across model orientations.
pub fn recommend_discard(hand: &[Card], role: Role, seed: u64) -> Result<[u8; 2], String> {
    if hand.len() != 6 {
        return Err(format!(
            "Myrmidon discard requires six cards, got {}",
            hand.len()
        ));
    }
    let starter_options = full_deck()
        .into_iter()
        // The Python reference Card equality compares ranks rather than
        // physical-card identity, so randomStarter rejects an entire rank if
        // any copy of that rank is in the player's hand.
        .filter(|candidate| !hand.iter().any(|card| card.rank == candidate.rank))
        .collect::<Vec<_>>();
    if starter_options.is_empty() {
        return Err("Myrmidon has no rank-compatible starter options".to_string());
    }

    let mut rng = SplitMix64::new(seed);
    let mut card_scores = vec![0_i64; hand.len()];

    for keep in card_combinations(hand, 4) {
        for _ in 0..MYRMIDON_STARTER_SAMPLES {
            let starter = starter_options[rng.index(starter_options.len())];
            let score = i64::from(score_hand(&keep, starter, false));
            for (index, card) in hand.iter().enumerate() {
                if keep.iter().any(|kept| kept.rank == card.rank) {
                    card_scores[index] += score;
                }
            }
        }
    }

    for discard_pair in card_combinations(hand, 2) {
        for _ in 0..MYRMIDON_STARTER_SAMPLES {
            let starter = starter_options[rng.index(starter_options.len())];
            let score = i64::from(score_hand(&discard_pair, starter, false));
            for (index, card) in hand.iter().enumerate() {
                if !discard_pair
                    .iter()
                    .any(|discarded| discarded.rank == card.rank)
                {
                    continue;
                }
                match role {
                    Role::Dealer => {
                        card_scores[index] -= score;
                        if card.rank == 4 {
                            card_scores[index] += 2;
                        }
                    }
                    Role::Pone => card_scores[index] += score,
                }
            }
        }
    }

    let mut remaining_cards = hand.to_vec();
    let mut remaining_scores = card_scores;
    let mut selected = [0_u8; 2];
    for slot in &mut selected {
        let lowest = remaining_scores
            .iter()
            .enumerate()
            .min_by_key(|(_, score)| *score)
            .map(|(index, _)| index)
            .ok_or_else(|| "Myrmidon discard selection ran out of cards".to_string())?;
        *slot = remaining_cards.remove(lowest).id;
        remaining_scores.remove(lowest);
    }
    Ok(selected)
}

/// Select a pegging card using Myrmidon's immediate-score/count heuristic.
pub fn recommend_peg(hand: &[Card], plays: &[Card], count: u8) -> Result<u8, String> {
    let mut best: Option<(u8, i32)> = None;
    for card in hand {
        if count + card.value > 31 {
            continue;
        }
        let mut next_plays = plays.to_vec();
        next_plays.push(*card);
        let mut score = 10 * i32::from(score_count(&next_plays)) + i32::from(card.rank + 1);
        let next_count = count + card.value;
        if matches!(next_count, 5 | 10 | 21) {
            score = 1.max(score - 10);
        }
        if next_count < 5 {
            score += 15;
        }
        // Strict comparison preserves the reference agent's first-card tie
        // break in current play-hand order.
        if best.is_none_or(|(_, best_score)| score > best_score) {
            best = Some((card.id, score));
        }
    }
    best.map(|(card_id, _)| card_id)
        .ok_or_else(|| "Myrmidon has no legal pegging card".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cards(ids: &[u8]) -> Vec<Card> {
        ids.iter()
            .copied()
            .map(Card::new)
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn discard_is_reproducible_for_a_fixed_seed() {
        let hand = cards(&[0, 14, 28, 42, 4, 50]);
        let first = recommend_discard(&hand, Role::Pone, 0x4d59_524d_4944_4f4e).unwrap();
        let second = recommend_discard(&hand, Role::Pone, 0x4d59_524d_4944_4f4e).unwrap();
        assert_eq!(first, second);
        // Cross-checked against canonical Myrmidon.py at commit 2d6370b with
        // the identical supplied starter sequence.
        assert_eq!(first, [14, 50]);
        assert_eq!(
            recommend_discard(
                &cards(&[4, 17, 30, 43, 9, 24]),
                Role::Dealer,
                0x1310_4d59_524d_0001,
            )
            .unwrap(),
            [9, 24]
        );
        assert_eq!(
            recommend_discard(
                &cards(&[3, 18, 33, 48, 11, 38]),
                Role::Pone,
                0x1310_4d59_524d_0002,
            )
            .unwrap(),
            [18, 33]
        );
    }

    #[test]
    fn pegging_prefers_immediate_pair_points() {
        let hand = cards(&[4, 8]);
        let plays = cards(&[17]);
        assert_eq!(recommend_peg(&hand, &plays, 5).unwrap(), 4);
        assert_eq!(
            recommend_peg(&cards(&[0, 5, 11]), &cards(&[3, 16]), 8).unwrap(),
            11
        );
    }

    #[test]
    fn pegging_preserves_first_card_tie_break() {
        let hand = cards(&[9, 22]);
        assert_eq!(recommend_peg(&hand, &[], 20).unwrap(), 9);
    }
}
