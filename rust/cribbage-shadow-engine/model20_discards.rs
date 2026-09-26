//! Versioned opponent-discard evidence for Model 20. See the asset README for
//! the little-endian format. Rank weights and empirical suit counts stay distinct.
use crate::board::Role;
use crate::cards::{enumerate_rank_count_keys, rank_counts_from_key};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

pub(crate) const ASSET_NAME: &str = "model20-opponent-discards.bin";
pub(crate) type DiscardRows = HashMap<(Role, [u8; 13]), Vec<([u8; 13], u64)>>;

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct SuitEvidence {
    pub observations: u64,
    pub same_suit: u64,
    // Preserve the historical rounded rate exactly during this consolidation.
    pub rate: f64,
}

pub(crate) struct SuitedDiscardRates {
    pub pairs: [SuitEvidence; 91],
    pub overall_rate: f64,
    pub distinct_rate: f64,
}

impl SuitedDiscardRates {
    pub(crate) fn rate(&self, ranks: &[u8; 13]) -> f64 {
        let mut cards = ranks
            .iter()
            .enumerate()
            .flat_map(|(rank, count)| std::iter::repeat(rank).take(usize::from(*count)));
        let first = cards.next().expect("two-card discard");
        let second = cards.next().expect("two-card discard");
        debug_assert!(cards.next().is_none());
        // Lexicographic order of the thirteen-count rank keys: KK, QK, QQ, ...
        let index = (12 - first) * (13 - first) / 2 + 12 - second;
        let evidence = self.pairs[index];
        if evidence.observations > 0 {
            evidence.rate
        } else if self.distinct_rate != 0.0 {
            self.distinct_rate
        } else {
            self.overall_rate
        }
    }
}

pub(crate) struct Model20DiscardAsset {
    pub discards: DiscardRows,
    pub suits: [SuitedDiscardRates; 2],
    pub fingerprint: [u8; 32],
}

impl Model20DiscardAsset {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        let bytes = fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
        Self::decode(&bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, String> {
        let mut reader = Reader { bytes, position: 0 };
        if reader.take(8)? != b"M20D0001" || reader.u32()? != 1 {
            return Err("unsupported Model 20 discard asset".into());
        }
        let metadata_len = reader.u32()? as usize;
        if reader.u32()? != 2 || reader.u32()? != 1820 || reader.u32()? != 91 {
            return Err("invalid Model 20 discard dimensions".into());
        }
        let payload_len = reader.u32()? as usize;
        let expected_hash = reader.take(32)?;
        if bytes.len() - reader.position != payload_len
            || Sha256::digest(&bytes[reader.position..]).as_slice() != expected_hash
        {
            return Err("Model 20 discard payload length/checksum mismatch".into());
        }
        let metadata: serde_json::Value = serde_json::from_slice(reader.take(metadata_len)?)
            .map_err(|e| format!("Model 20 discard provenance: {e}"))?;
        if metadata["schemaVersion"].as_u64() != Some(1) {
            return Err("invalid Model 20 discard provenance version".into());
        }
        let pairs = enumerate_rank_count_keys(2)
            .iter()
            .map(|key| rank_counts_from_key(key))
            .collect::<Result<Vec<_>, _>>()?;
        let keeps = enumerate_rank_count_keys(4)
            .iter()
            .map(|key| rank_counts_from_key(key))
            .collect::<Result<Vec<_>, _>>()?;
        let mut discards = HashMap::with_capacity(3640);
        let mut suits = Vec::with_capacity(2);
        for role in [Role::Dealer, Role::Pone] {
            let overall_rate = reader.probability()?;
            let distinct_rate = reader.probability()?;
            let mut evidence = [SuitEvidence::default(); 91];
            for (ranks, entry) in pairs.iter().zip(&mut evidence) {
                entry.observations = reader.u64()?;
                entry.same_suit = reader.u64()?;
                entry.rate = reader.probability()?;
                if entry.same_suit > entry.observations
                    || (ranks.contains(&2) && (entry.same_suit != 0 || entry.rate != 0.0))
                    || (entry.observations > 0
                        && (entry.rate - entry.same_suit as f64 / entry.observations as f64).abs()
                            > 5.1e-9)
                {
                    return Err("invalid Model 20 suited-discard evidence".into());
                }
            }
            suits.push(SuitedDiscardRates {
                pairs: evidence,
                overall_rate,
                distinct_rate,
            });
            let fallback = reader.row(&pairs)?;
            if fallback.is_empty() {
                return Err("missing Model 20 discard fallback".into());
            }
            for keep in &keeps {
                let mut row = reader.row(&pairs)?;
                if row.is_empty() {
                    row = fallback.clone();
                }
                row.retain(|(discard, _)| (0..13).all(|r| keep[r] + discard[r] <= 4));
                if row.is_empty() {
                    return Err("Model 20 keep has no physical discard support".into());
                }
                discards.insert((role, *keep), row);
            }
        }
        if reader.position != bytes.len() {
            return Err("trailing Model 20 discard data".into());
        }
        let suits = suits.try_into().map_err(|_| "missing Model 20 suit role")?;
        Ok(Self {
            discards,
            suits,
            fingerprint: expected_hash.try_into().unwrap(),
        })
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self
            .position
            .checked_add(count)
            .ok_or("Model 20 discard offset overflow")?;
        let value = self
            .bytes
            .get(self.position..end)
            .ok_or("truncated Model 20 discard asset")?;
        self.position = end;
        Ok(value)
    }
    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn probability(&mut self) -> Result<f64, String> {
        let value = f64::from_bits(self.u64()?);
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err("invalid Model 20 suit probability".into());
        }
        Ok(value)
    }
    fn row(&mut self, pairs: &[[u8; 13]]) -> Result<Vec<([u8; 13], u64)>, String> {
        let count = self.u16()? as usize;
        if count > pairs.len() {
            return Err("invalid Model 20 discard row length".into());
        }
        let mut result = Vec::with_capacity(count);
        let mut previous = None;
        for _ in 0..count {
            let id = self.take(1)?[0] as usize;
            let weight = self.u64()?;
            if id >= pairs.len() || previous.is_some_and(|last| id <= last) || weight == 0 {
                return Err("invalid Model 20 discard row".into());
            }
            result.push((pairs[id], weight));
            previous = Some(id);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_corrupt_truncated_and_incompatible_assets() {
        let bytes = fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("assets")
                .join(ASSET_NAME),
        )
        .unwrap();
        for length in [0, 7, 32, 63, bytes.len() - 1] {
            assert!(Model20DiscardAsset::decode(&bytes[..length]).is_err());
        }
        for index in [0, 8, 16, 32, bytes.len() - 1] {
            let mut corrupt = bytes.clone();
            corrupt[index] ^= 1;
            assert!(Model20DiscardAsset::decode(&corrupt).is_err());
        }
    }
}
