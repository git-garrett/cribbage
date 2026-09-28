//! Complete conditional discard probabilities for 20.3. The stored dense rows
//! are indexed by role, lexicographic four-card keep, and two-card discard.
use crate::board::Role;
use crate::cards::{enumerate_rank_count_keys, rank_counts_from_key};
use crate::model20_discards::{SuitEvidence, SuitedDiscardRates};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

const SHA256: &str = "efd7a4594a8c42fc0e332726d44e8ababf541b3eb80c4cbf8140b9629389dbad";
pub(crate) const ASSET_NAME: &str = "model203-opponent-discards.bin";

pub(crate) struct Model203DiscardAsset {
    // Probability divided by the physical combination count before observing
    // our six cards. This division is fixed per keep and paid only at load time.
    per_combination: Vec<f64>,
    pairs: Vec<([u8; 13], usize, usize)>,
    pub suits: [SuitedDiscardRates; 2],
    pub fingerprint: [u8; 32],
}

fn choose(n: usize, k: usize) -> usize {
    if n < k { return 0; }
    (0..k).fold(1, |v, i| v * (n - i) / (i + 1))
}

fn keep_index(keep: &[u8; 13]) -> Result<usize, String> {
    let mut index = 0;
    let mut card = 0;
    for rank in (0..13).rev() {
        if keep[rank] > 4 { return Err("invalid opponent keep".into()); }
        for _ in 0..keep[rank] {
            card += 1;
            if card > 4 { return Err("invalid opponent keep".into()); }
            index += choose(12 - rank + card - 1, card);
        }
    }
    if card != 4 { return Err("invalid opponent keep".into()); }
    Ok(index)
}

impl Model203DiscardAsset {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        let bytes = fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
        if format!("{:x}", Sha256::digest(&bytes)) != SHA256 {
            return Err("Model 20.3 discard asset differs from its verified snapshot".into());
        }
        Self::decode(&bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, String> {
        let mut reader = Reader { bytes, position: 0 };
        if reader.take(8)? != b"M203OD01" {
            return Err("unsupported Model 20.3 discard asset".into());
        }
        let version = reader.u32()?;
        if ![1, 2].contains(&version) { return Err("unsupported Model 20.3 discard asset version".into()); }
        let metadata_len = reader.u32()? as usize;
        if reader.u32()? != 2 || reader.u32()? != 1820 || reader.u32()? != 91 {
            return Err("invalid Model 20.3 discard dimensions".into());
        }
        let payload_len = reader.u32()? as usize;
        let hash: [u8; 32] = reader.take(32)?.try_into().unwrap();
        if bytes.len() - reader.position != payload_len || Sha256::digest(&bytes[reader.position..]).as_slice() != hash {
            return Err("Model 20.3 discard payload checksum/length mismatch".into());
        }
        let metadata: serde_json::Value = serde_json::from_slice(reader.take(metadata_len)?).map_err(|e| e.to_string())?;
        if metadata["schemaVersion"] != version || metadata["modelVersion"] != "20.3" {
            return Err("invalid Model 20.3 discard provenance".into());
        }
        let pairs = enumerate_rank_count_keys(2).iter().map(|key| {
            let ranks = rank_counts_from_key(key)?;
            let mut cards = ranks.iter().enumerate().flat_map(|(r, n)| std::iter::repeat(r).take(*n as usize));
            Ok((ranks, cards.next().unwrap(), cards.next().unwrap()))
        }).collect::<Result<Vec<_>, String>>()?;
        let mut suits = Vec::new();
        for role in 0..2 {
            let overall_rate = reader.probability()?;
            let distinct_rate = reader.probability()?;
            let (strength, prior) = if version == 2 {
                let calibration = &metadata["suitedSection"]["calibration"][role];
                let strength = calibration["strength"].as_f64().ok_or("missing suit prior strength")?;
                let prior = calibration["priorMean"].as_f64().ok_or("missing suit prior mean")?;
                if !strength.is_finite() || strength < 0.0 || !prior.is_finite() || !(0.0..1.0).contains(&prior) || prior == 0.0 {
                    return Err("invalid Model 20.3 suit prior".into());
                }
                (strength, prior)
            } else { (0.0, distinct_rate) };
            let mut evidence = [SuitEvidence::default(); 91];
            for ((_, a, b), entry) in pairs.iter().zip(&mut evidence) {
                entry.observations = reader.u64()?;
                entry.same_suit = reader.u64()?;
                entry.rate = reader.probability()?;
                let expected = if a == b { 0.0 } else if entry.observations as f64 + strength > 0.0 {
                    (entry.same_suit as f64 + strength * prior) / (entry.observations as f64 + strength)
                } else { prior };
                if entry.same_suit > entry.observations || (a == b && (entry.same_suit != 0 || entry.rate != 0.0))
                    || ((version == 2 || entry.observations > 0) && (entry.rate-expected).abs() > if version == 2 { 1e-12 } else { 5.1e-9 }) {
                    return Err("invalid Model 20.3 suit evidence".into());
                }
            }
            if version == 2 {
                let n: f64 = evidence.iter().map(|e| e.observations as f64).sum();
                let same: f64 = evidence.iter().map(|e| e.same_suit as f64).sum();
                let distinct_n: f64 = pairs.iter().zip(&evidence).filter(|((_,a,b),_)| a != b).map(|(_,e)| e.observations as f64).sum();
                if n <= 0.0 || (overall_rate - same/n).abs() > 1e-12 || (prior - (same+1.0)/(distinct_n+4.0)).abs() > 1e-12 || (distinct_rate-prior).abs() > 1e-12 {
                    return Err("inconsistent Model 20.3 suit prior/counts".into());
                }
            }
            suits.push(SuitedDiscardRates { pairs: evidence, overall_rate, distinct_rate });
        }
        let keeps = enumerate_rank_count_keys(4).iter().map(|key| rank_counts_from_key(key)).collect::<Result<Vec<_>, _>>()?;
        let mut per_combination = Vec::with_capacity(2*1820*91);
        for _ in 0..2 {
            for keep in &keeps {
                let mut total = 0.0;
                for (_, a, b) in &pairs {
                    let p = reader.probability()?;
                    let x = 4 - keep[*a];
                    let base = if a == b { f64::from(x * x.saturating_sub(1))/2.0 } else { f64::from(x * (4-keep[*b])) };
                    if (base > 0.0 && p <= 0.0) || (base == 0.0 && p != 0.0) {
                        return Err("incomplete or impossible Model 20.3 discard support".into());
                    }
                    total += p;
                    per_combination.push(if base > 0.0 { p/base } else { 0.0 });
                }
                if (total - 1.0).abs() > 1e-12 { return Err("unnormalized Model 20.3 discard row".into()); }
            }
        }
        if reader.position != bytes.len() { return Err("trailing Model 20.3 discard data".into()); }
        Ok(Self { per_combination, pairs, suits: suits.try_into().map_err(|_| "missing suit role")?, fingerprint: hash })
    }

    pub(crate) fn conditioned(&self, role: Role, keep: &[u8; 13], own_six: &[u8; 13], cut: u8) -> Result<Vec<([u8; 13], f64)>, String> {
        if cut >= 13 { return Err("invalid cut rank".into()); }
        let index = keep_index(keep)? + if role == Role::Dealer { 0 } else { 1820 };
        let mut available = [0; 13];
        for rank in 0..13 {
            available[rank] = 4_u8.checked_sub(keep[rank]).and_then(|n| n.checked_sub(own_six[rank])).ok_or("impossible hidden world")?;
        }
        let mut variants = Vec::with_capacity(91);
        for ((discard, a, b), weight) in self.pairs.iter().zip(&self.per_combination[index*91..(index+1)*91]) {
            let x = available[*a];
            let combinations = if a == b { f64::from(x * x.saturating_sub(1))/2.0 } else { f64::from(x * available[*b]) };
            let copies = available[cut as usize].saturating_sub(discard[cut as usize]);
            if combinations > 0.0 && copies > 0 {
                // Keep floating probabilities: integer rounding could erase the
                // small positive prior and recreate the empirical-zero bug.
                variants.push((*discard, weight * combinations * f64::from(copies)));
            }
        }
        Ok(variants)
    }
}

struct Reader<'a> { bytes: &'a [u8], position: usize }
impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self.position.checked_add(count).ok_or("discard offset overflow")?;
        let value = self.bytes.get(self.position..end).ok_or("truncated Model 20.3 discard asset")?;
        self.position = end;
        Ok(value)
    }
    fn u32(&mut self) -> Result<u32, String> { Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn u64(&mut self) -> Result<u64, String> { Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap())) }
    fn probability(&mut self) -> Result<f64, String> {
        let value = f64::from_bits(self.u64()?);
        if !value.is_finite() || !(0.0..=1.0).contains(&value) { return Err("invalid discard probability".into()); }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dense_keep_index_matches_all_1820_lexicographic_keys() {
        for (i, key) in enumerate_rank_count_keys(4).iter().enumerate() {
            assert_eq!(keep_index(&rank_counts_from_key(key).unwrap()).unwrap(), i);
        }
        assert!(keep_index(&[0; 13]).is_err());
    }

    #[test]
    fn loaded_support_is_complete_and_conditioning_matches_physical_combinations() {
        let bytes = fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("assets").join(ASSET_NAME)).unwrap();
        let asset = Model203DiscardAsset::decode(&bytes).unwrap();
        // Exhaust every keep, both roles and all possible cut ranks with six
        // known cards; verify exact zeros, positivity and depletion weights.
        for (i, key) in enumerate_rank_count_keys(4).iter().enumerate() {
            let keep = rank_counts_from_key(key).unwrap();
            let mut own = [0; 13];
            let mut left = 6;
            for rank in (0..13).rev() { own[rank] = left.min(4-keep[rank]); left -= own[rank]; }
            for role in [Role::Dealer, Role::Pone] {
                for cut in 0..13 {
                    if keep[cut] + own[cut] == 4 { continue; }
                    let actual = asset.conditioned(role, &keep, &own, cut as u8).unwrap();
                    let mut j = 0;
                    for (pair_index, (d, _, _)) in asset.pairs.iter().enumerate() {
                        let possible = (0..13).all(|r| keep[r]+own[r]+d[r]+u8::from(r==cut) <= 4);
                        if possible {
                            assert_eq!(&actual[j].0, d);
                            assert!(actual[j].1 > 0.0 && actual[j].1.is_finite());
                            let available = std::array::from_fn(|r| 4-keep[r]-own[r]);
                            let expected = asset.per_combination[(i+if role==Role::Dealer {0} else {1820})*91+pair_index]
                                * crate::cards::rank_combination_count(d,&available) * f64::from(available[cut]-d[cut]);
                            assert_eq!(actual[j].1, expected);
                            j += 1;
                        }
                    }
                    assert_eq!(actual.len(),j);
                    assert!(j > 0);
                }
            }
        }
        let mut corrupt = bytes.clone();
        *corrupt.last_mut().unwrap() ^= 1;
        assert!(Model203DiscardAsset::decode(&corrupt).is_err());
        assert!(Model203DiscardAsset::decode(&bytes[..bytes.len()-1]).is_err());
    }

    #[test]
    fn refreshed_suit_rates_must_match_raw_counts_and_beta_prior() {
        let original = fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("assets").join(ASSET_NAME)).unwrap();
        assert_eq!(u32::from_le_bytes(original[8..12].try_into().unwrap()), 2);
        let metadata_len = u32::from_le_bytes(original[12..16].try_into().unwrap()) as usize;
        // QK is the first distinct-rank row. Recompute the checksum so this
        // exercises posterior/count validation, not the checksum guard.
        let row = 64 + metadata_len + 16 + 24;
        for offset in [row, row + 16] {
            let mut changed = original.clone();
            if offset == row {
                let n = u64::from_le_bytes(changed[offset..offset+8].try_into().unwrap());
                changed[offset..offset+8].copy_from_slice(&(n+100).to_le_bytes());
            } else {
                let p = f64::from_le_bytes(changed[offset..offset+8].try_into().unwrap());
                changed[offset..offset+8].copy_from_slice(&(p+0.001).to_le_bytes());
            }
            let hash: [u8;32] = Sha256::digest(&changed[64..]).into();
            changed[32..64].copy_from_slice(&hash);
            assert!(Model203DiscardAsset::decode(&changed).err().unwrap().contains("suit evidence"));
        }
    }
}
