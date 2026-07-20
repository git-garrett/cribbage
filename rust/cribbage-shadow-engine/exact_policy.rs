//! Model 16.1 policy artifact keyed by the complete legal pegging observation.
//! This remains separate from `policy.rs`, whose smaller key deliberately
//! preserves Model 16.0's training abstraction and historical behavior.

use crate::information_set::{
    PegInformationSetKey, EXACT_PEG_POLICY_KEY_BYTES, POLICY_ACTION_COUNT,
};
use crate::policy::POLICY_WEIGHT_TOTAL;
use std::fs;
use std::io::Write;
use std::path::Path;

const EXACT_POLICY_MAGIC: &[u8; 8] = b"C161POL1";
const EXACT_POLICY_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExactPolicyMetadata {
    pub training_seed: u64,
    pub training_iterations: u64,
    pub checkpoint_checksum: u64,
    pub source_nodes: u64,
    pub included_entries: u64,
    pub minimum_visits: u64,
    pub provenance: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExactQuantizedPolicyEntry {
    pub key: PegInformationSetKey,
    pub legal_mask: u16,
    pub confidence: u32,
    pub weights: [u16; POLICY_ACTION_COUNT],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExactPolicyArtifact {
    pub metadata: ExactPolicyMetadata,
    pub entries: Vec<ExactQuantizedPolicyEntry>,
}

impl ExactPolicyArtifact {
    pub fn new(
        mut metadata: ExactPolicyMetadata,
        mut entries: Vec<ExactQuantizedPolicyEntry>,
    ) -> Result<ExactPolicyArtifact, String> {
        entries.sort_by_key(|entry| entry.key.to_packed_bytes());
        metadata.included_entries = entries.len() as u64;
        let artifact = ExactPolicyArtifact { metadata, entries };
        artifact.validate()?;
        Ok(artifact)
    }

    pub fn lookup(&self, key: &PegInformationSetKey) -> Option<&ExactQuantizedPolicyEntry> {
        let packed = key.to_packed_bytes();
        self.entries
            .binary_search_by(|entry| entry.key.to_packed_bytes().cmp(&packed))
            .ok()
            .and_then(|index| self.entries.get(index))
    }

    pub fn save(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let path = path.as_ref();
        let bytes = self.to_bytes()?;
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)
            .map_err(|error| format!("create {} failed: {}", parent.display(), error))?;
        let temporary = path.with_extension("tmp");
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("create {} failed: {}", temporary.display(), error))?;
        file.write_all(&bytes)
            .map_err(|error| format!("write {} failed: {}", temporary.display(), error))?;
        file.sync_all()
            .map_err(|error| format!("sync {} failed: {}", temporary.display(), error))?;
        fs::rename(&temporary, path).map_err(|error| {
            format!(
                "rename {} to {} failed: {}",
                temporary.display(),
                path.display(),
                error
            )
        })
    }

    pub fn load(path: impl AsRef<Path>) -> Result<ExactPolicyArtifact, String> {
        let path = path.as_ref();
        let bytes =
            fs::read(path).map_err(|error| format!("read {} failed: {}", path.display(), error))?;
        ExactPolicyArtifact::from_bytes(&bytes)
    }

    pub fn checksum(&self) -> Result<u64, String> {
        let bytes = self.to_bytes()?;
        Ok(u64::from_le_bytes(
            bytes[bytes.len() - 8..].try_into().unwrap(),
        ))
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        let provenance = self.metadata.provenance.as_bytes();
        let provenance_len = u32::try_from(provenance.len())
            .map_err(|_| "exact policy provenance is too long".to_string())?;
        let mut bytes = Vec::with_capacity(
            92 + provenance.len() + self.entries.len() * (EXACT_PEG_POLICY_KEY_BYTES + 34),
        );
        bytes.extend_from_slice(EXACT_POLICY_MAGIC);
        bytes.extend_from_slice(&EXACT_POLICY_VERSION.to_le_bytes());
        bytes.extend_from_slice(&(EXACT_PEG_POLICY_KEY_BYTES as u32).to_le_bytes());
        bytes.extend_from_slice(&(POLICY_ACTION_COUNT as u32).to_le_bytes());
        bytes.extend_from_slice(&POLICY_WEIGHT_TOTAL.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.training_seed.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.training_iterations.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.checkpoint_checksum.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.source_nodes.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.included_entries.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.minimum_visits.to_le_bytes());
        bytes.extend_from_slice(&provenance_len.to_le_bytes());
        bytes.extend_from_slice(provenance);
        for entry in &self.entries {
            bytes.extend_from_slice(&entry.key.to_packed_bytes());
            bytes.extend_from_slice(&entry.legal_mask.to_le_bytes());
            bytes.extend_from_slice(&entry.confidence.to_le_bytes());
            for weight in entry.weights {
                bytes.extend_from_slice(&weight.to_le_bytes());
            }
        }
        let checksum = fnv1a64(&bytes);
        bytes.extend_from_slice(&checksum.to_le_bytes());
        Ok(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<ExactPolicyArtifact, String> {
        if bytes.len() < 8 {
            return Err("exact policy artifact is truncated".to_string());
        }
        let payload_len = bytes.len() - 8;
        let expected_checksum = u64::from_le_bytes(bytes[payload_len..].try_into().unwrap());
        let actual_checksum = fnv1a64(&bytes[..payload_len]);
        if expected_checksum != actual_checksum {
            return Err(format!(
                "exact policy checksum mismatch: expected {:016x}, got {:016x}",
                expected_checksum, actual_checksum
            ));
        }
        let mut cursor = ByteCursor::new(&bytes[..payload_len]);
        if cursor.take(8)? != EXACT_POLICY_MAGIC {
            return Err("invalid exact policy artifact magic".to_string());
        }
        if cursor.u32()? != EXACT_POLICY_VERSION {
            return Err("unsupported exact policy artifact version".to_string());
        }
        if cursor.u32()? != EXACT_PEG_POLICY_KEY_BYTES as u32 {
            return Err("unsupported exact policy key width".to_string());
        }
        if cursor.u32()? != POLICY_ACTION_COUNT as u32 {
            return Err("unsupported exact policy action count".to_string());
        }
        if cursor.u32()? != POLICY_WEIGHT_TOTAL {
            return Err("unsupported exact policy weight total".to_string());
        }
        let training_seed = cursor.u64()?;
        let training_iterations = cursor.u64()?;
        let checkpoint_checksum = cursor.u64()?;
        let source_nodes = cursor.u64()?;
        let included_entries = cursor.u64()?;
        let minimum_visits = cursor.u64()?;
        let provenance_len = cursor.u32()? as usize;
        let provenance = String::from_utf8(cursor.take(provenance_len)?.to_vec())
            .map_err(|_| "exact policy provenance is not UTF-8".to_string())?;
        let entry_bytes = EXACT_PEG_POLICY_KEY_BYTES + 2 + 4 + POLICY_ACTION_COUNT * 2;
        if included_entries > (cursor.remaining() / entry_bytes) as u64 {
            return Err("exact policy entry count exceeds remaining bytes".to_string());
        }
        let mut entries = Vec::with_capacity(included_entries as usize);
        for _ in 0..included_entries {
            let key =
                PegInformationSetKey::from_packed_bytes(cursor.take(EXACT_PEG_POLICY_KEY_BYTES)?)?;
            let legal_mask = cursor.u16()?;
            let confidence = cursor.u32()?;
            let mut weights = [0_u16; POLICY_ACTION_COUNT];
            for weight in &mut weights {
                *weight = cursor.u16()?;
            }
            entries.push(ExactQuantizedPolicyEntry {
                key,
                legal_mask,
                confidence,
                weights,
            });
        }
        if cursor.remaining() != 0 {
            return Err(format!(
                "exact policy artifact has {} unexpected payload bytes",
                cursor.remaining()
            ));
        }
        ExactPolicyArtifact::new(
            ExactPolicyMetadata {
                training_seed,
                training_iterations,
                checkpoint_checksum,
                source_nodes,
                included_entries,
                minimum_visits,
                provenance,
            },
            entries,
        )
    }

    fn validate(&self) -> Result<(), String> {
        if self.metadata.provenance.trim().is_empty() {
            return Err("exact policy provenance must not be empty".to_string());
        }
        if self.metadata.included_entries != self.entries.len() as u64 {
            return Err("exact policy metadata entry count is inconsistent".to_string());
        }
        let mut previous = None;
        for entry in &self.entries {
            let packed = entry.key.to_packed_bytes();
            if previous.as_ref().is_some_and(|prior| prior >= &packed) {
                return Err("exact policy entries are not strictly ordered".to_string());
            }
            previous = Some(packed);
            if entry.legal_mask != entry.key.expected_legal_mask() {
                return Err("exact policy entry has the wrong legal action mask".to_string());
            }
            let mut total = 0_u32;
            for (index, weight) in entry.weights.iter().copied().enumerate() {
                if entry.legal_mask & (1 << index) == 0 && weight != 0 {
                    return Err("exact policy assigns weight to an illegal action".to_string());
                }
                total += u32::from(weight);
            }
            if total != POLICY_WEIGHT_TOTAL {
                return Err(
                    "exact policy action weights do not sum to the quantization total".to_string(),
                );
            }
        }
        Ok(())
    }
}

struct ByteCursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> ByteCursor<'a> {
    fn new(bytes: &'a [u8]) -> ByteCursor<'a> {
        ByteCursor { bytes, offset: 0 }
    }

    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(count)
            .ok_or_else(|| "exact policy cursor overflow".to_string())?;
        let result = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| "exact policy artifact is truncated".to_string())?;
        self.offset = end;
        Ok(result)
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

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::Role;
    use crate::cards::cards_from_ids;
    use crate::information_set::{InfoActor, PegInformationSetKey, PegObservation};

    fn artifact() -> ExactPolicyArtifact {
        let hand = cards_from_ids(&[4, 5]).unwrap();
        let discards = cards_from_ids(&[0, 1]).unwrap();
        let key = PegInformationSetKey::from_observation(PegObservation {
            role: Role::Pone,
            my_score: 119,
            opponent_score: 118,
            own_hand: &hand,
            own_discards: &discards,
            turn_card: cards_from_ids(&[2]).unwrap()[0],
            count: 10,
            current: InfoActor::SelfPlayer,
            go_player: None,
            last_player: Some(InfoActor::Opponent),
            history: &[],
        })
        .unwrap();
        let mut weights = [0_u16; POLICY_ACTION_COUNT];
        weights[4] = POLICY_WEIGHT_TOTAL as u16;
        ExactPolicyArtifact::new(
            ExactPolicyMetadata {
                training_seed: 16,
                training_iterations: 99,
                checkpoint_checksum: 7,
                source_nodes: 1,
                included_entries: 0,
                minimum_visits: 2,
                provenance: "exact-policy-test".to_string(),
            },
            vec![ExactQuantizedPolicyEntry {
                key,
                legal_mask: key.expected_legal_mask(),
                confidence: 4,
                weights,
            }],
        )
        .unwrap()
    }

    #[test]
    fn exact_policy_round_trips_and_rejects_corruption() {
        let artifact = artifact();
        let bytes = artifact.to_bytes().unwrap();
        assert_eq!(ExactPolicyArtifact::from_bytes(&bytes).unwrap(), artifact);
        let mut corrupt = bytes;
        corrupt[20] ^= 1;
        assert!(ExactPolicyArtifact::from_bytes(&corrupt).is_err());
        assert!(ExactPolicyArtifact::from_bytes(&corrupt[..20]).is_err());
    }
}
