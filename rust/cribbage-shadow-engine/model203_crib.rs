//! Indexed crib rank scores and smoothed, role-specific opponent discard priors.
use crate::board::Role;
use crate::cards::Card;
use crate::model20_discards::SuitedDiscardRates;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

pub(crate) const ASSET_NAME: &str = "model203-crib.bin";
const PAIRS: usize = 91;
const SCORES: usize = PAIRS * 13 * PAIRS;

pub struct Model203CribTable {
    probabilities: [[f64; PAIRS]; 2],
    scores: Box<[u8]>,
    pairs: [[u8; 2]; PAIRS],
}

fn pair_index(a: u8, b: u8) -> usize {
    let (first, second) = (usize::from(a.min(b)), usize::from(a.max(b)));
    (12 - first) * (13 - first) / 2 + 12 - second
}

impl Model203CribTable {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        Self::decode(&fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?)
    }

    fn decode(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < 64 || &bytes[..8] != b"M203CR01" {
            return Err("invalid Model 20.3 crib header".into());
        }
        let field =
            |offset| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let (version, roles, pairs, ranks, metadata_len, payload_len) = (
            field(8),
            field(12),
            field(16),
            field(20),
            field(24),
            field(28),
        );
        if (version, roles, pairs, ranks) != (1, 2, PAIRS, 13)
            || bytes.len() - 64 != payload_len
            || metadata_len.checked_add(2 * PAIRS * 16 + SCORES) != Some(payload_len)
            || Sha256::digest(&bytes[64..]).as_slice() != &bytes[32..64]
        {
            return Err("Model 20.3 crib dimensions/length/checksum mismatch".into());
        }
        let metadata: serde_json::Value = serde_json::from_slice(&bytes[64..64 + metadata_len])
            .map_err(|e| format!("Model 20.3 crib provenance: {e}"))?;
        if metadata["schemaVersion"].as_u64() != Some(1)
            || metadata["modelVersion"].as_str() != Some("20.3")
        {
            return Err("invalid Model 20.3 crib provenance".into());
        }
        let mut probabilities = [[0.0; PAIRS]; 2];
        let mut offset = 64 + metadata_len;
        for (role, row) in probabilities.iter_mut().enumerate() {
            let mut count = 0u64;
            for p in row.iter_mut() {
                count = count
                    .checked_add(u64::from_le_bytes(
                        bytes[offset..offset + 8].try_into().unwrap(),
                    ))
                    .ok_or("Model 20.3 crib count overflow")?;
                *p = f64::from_le_bytes(bytes[offset + 8..offset + 16].try_into().unwrap());
                if !p.is_finite() || *p <= 0.0 || *p > 1.0 {
                    return Err("invalid Model 20.3 crib probability".into());
                }
                offset += 16;
            }
            let name = ["dealer", "pone"][role];
            if (row.iter().sum::<f64>() - 1.0).abs() > 1e-12
                || metadata["observationsByRole"][name].as_u64() != Some(count)
            {
                return Err("Model 20.3 crib mass/count mismatch".into());
            }
        }
        let mut pair_ranks = [[0; 2]; PAIRS];
        for first in 0..13u8 {
            for second in first..13u8 {
                pair_ranks[pair_index(first, second)] = [first, second];
            }
        }
        let scores = bytes[offset..].to_vec().into_boxed_slice();
        for (own, [a, b]) in pair_ranks.iter().copied().enumerate() {
            for cut in 0..13u8 {
                for (other, [c, d]) in pair_ranks.iter().copied().enumerate() {
                    let impossible = a == b && a == cut && a == c && a == d;
                    let score = scores[(own * 13 + usize::from(cut)) * PAIRS + other];
                    if (score == 255) != impossible || (!impossible && score > 28) {
                        return Err("invalid Model 20.3 crib score/support".into());
                    }
                }
            }
        }
        Ok(Self {
            probabilities,
            scores,
            pairs: pair_ranks,
        })
    }

    pub(crate) fn rank_mean(&self, role: u8, ranks: &[u8; 13], cut: u8) -> Option<f64> {
        if role > 1 || cut >= 13 || ranks.iter().sum::<u8>() != 2 {
            return None;
        }
        let mut cards = ranks
            .iter()
            .enumerate()
            .flat_map(|(r, n)| std::iter::repeat(r as u8).take(*n as usize));
        let own = pair_index(cards.next()?, cards.next()?);
        let row = &self.scores[(own * 13 + cut as usize) * PAIRS..][..PAIRS];
        let mut total = 0.0;
        let mut points = 0.0;
        for (score, weight) in row.iter().zip(&self.probabilities[1 - role as usize]) {
            if *score != 255 {
                total += weight;
                points += f64::from(*score) * weight;
            }
        }
        Some((points / total * 100_000.0).round() / 100_000.0)
    }

    pub(crate) fn outcomes(
        &self,
        discard: &[Card],
        cut: Card,
        role: Role,
        known: &[Card],
        rates: Option<&SuitedDiscardRates>,
    ) -> Vec<(i32, f64)> {
        debug_assert_eq!(discard.len(), 2);
        let own = pair_index(discard[0].rank, discard[1].rank);
        let scores = &self.scores[(own * 13 + cut.rank as usize) * PAIRS..][..PAIRS];
        let weights = &self.probabilities[if role == Role::Dealer { 1 } else { 0 }];
        let mut suits = [15u8; 13];
        for card in known.iter().chain(discard).chain(std::iter::once(&cut)) {
            suits[card.rank as usize] &= !(1 << card.suit);
        }
        let own_jack = discard
            .iter()
            .filter(|c| c.rank == 10 && c.suit == cut.suit)
            .count();
        let can_flush = discard.iter().all(|c| c.suit == cut.suit);
        let mut outcomes = [0.0; 30];
        for (index, [a, b]) in self.pairs.iter().copied().enumerate() {
            let score = scores[index];
            if score == 255 {
                continue;
            }
            let (sa, sb) = (suits[a as usize], suits[b as usize]);
            let (na, nb) = (sa.count_ones() as usize, sb.count_ones() as usize);
            let total = if a == b {
                na * na.saturating_sub(1) / 2
            } else {
                na * nb
            };
            if total == 0 {
                continue;
            }
            let suited = if a == b {
                0
            } else {
                (sa & sb).count_ones() as usize
            };
            let unsuited = total - suited;
            // Preserve the existing rank/suit conditioning semantics. A separate
            // versioned change can adjust rank mass for partial card depletion.
            let (per_suited, per_unsuited) = if let Some(rates) = rates {
                if suited == 0 {
                    (0.0, weights[index] / unsuited as f64)
                } else if unsuited == 0 {
                    (weights[index] / suited as f64, 0.0)
                } else {
                    let p = rates.rate_at(index);
                    (
                        weights[index] * p / suited as f64,
                        weights[index] * (1.0 - p) / unsuited as f64,
                    )
                }
            } else {
                (weights[index] / total as f64, weights[index] / total as f64)
            };
            for s in 0..4u8 {
                if sa & (1 << s) == 0 {
                    continue;
                }
                for t in 0..4u8 {
                    if sb & (1 << t) == 0 || (a == b && t <= s) {
                        continue;
                    }
                    let weight = if s == t { per_suited } else { per_unsuited };
                    let jack = usize::from(a == 10 && s == cut.suit)
                        + usize::from(b == 10 && t == cut.suit);
                    let flush = if can_flush && s == cut.suit && t == cut.suit {
                        5
                    } else {
                        0
                    };
                    outcomes[score as usize + own_jack + jack + flush] += weight;
                }
            }
        }
        let total = outcomes.iter().sum::<f64>();
        debug_assert!(total > 0.0, "no physically possible crib pair");
        outcomes
            .iter()
            .enumerate()
            .filter_map(|(score, w)| (*w > 0.0).then_some((score as i32, w / total)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::{score_hand_rank_only, Card};

    #[test]
    fn model203_crib_binary_scores_every_legal_rank_combination_exactly() {
        let table = Model203CribTable::load(
            &Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("assets")
                .join(ASSET_NAME),
        )
        .unwrap();
        let mut legal = 0;
        for (own, [a, b]) in table.pairs.iter().copied().enumerate() {
            for cut in 0..13u8 {
                for (other, [c, d]) in table.pairs.iter().copied().enumerate() {
                    let score = table.scores[(own * 13 + cut as usize) * PAIRS + other];
                    if score == 255 {
                        continue;
                    }
                    let hand: Vec<_> = [a, b, c, d]
                        .iter()
                        .map(|r| Card::new(*r).unwrap())
                        .collect();
                    assert_eq!(score, score_hand_rank_only(&hand, Card::new(cut).unwrap()));
                    legal += 1;
                }
            }
        }
        assert_eq!(legal, 107640);
    }

    #[test]
    fn model203_crib_binary_rejects_corrupt_truncated_and_wrong_dimensions() {
        let bytes = fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("assets")
                .join(ASSET_NAME),
        )
        .unwrap();
        for length in [0, 63, bytes.len() - 1] {
            assert!(Model203CribTable::decode(&bytes[..length]).is_err());
        }
        let mut corrupt = bytes.clone();
        *corrupt.last_mut().unwrap() ^= 1;
        assert!(Model203CribTable::decode(&corrupt).is_err());
        let mut wrong = bytes;
        wrong[16] = 90;
        assert!(Model203CribTable::decode(&wrong).is_err());
    }

    pub(crate) fn use_legacy_weights(
        table: &mut Model203CribTable,
        legacy: &crate::artifacts::CribRankDiscardTables,
    ) {
        for role in 0..2u8 {
            let mut counts = [0.0; PAIRS];
            for ((own_role, _, _), entry) in &legacy.histograms {
                if *own_role != role {
                    continue;
                }
                for d in &entry.opponent_discards {
                    let mut ranks = d
                        .ranks
                        .iter()
                        .enumerate()
                        .flat_map(|(r, n)| std::iter::repeat(r as u8).take(*n as usize));
                    counts[pair_index(ranks.next().unwrap(), ranks.next().unwrap())] = d.weight;
                }
            }
            // Keep raw weights in this parity fixture: production probabilities
            // are normalized, but common scaling cancels in the final histogram.
            table.probabilities[1 - role as usize] = counts;
        }
    }
}

#[cfg(test)]
pub(crate) use tests::use_legacy_weights;
