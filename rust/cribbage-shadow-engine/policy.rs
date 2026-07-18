use crate::information_set::{
    PolicyInformationSetKey, PACKED_POLICY_KEY_BYTES, POLICY_ACTION_COUNT,
};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const POLICY_MAGIC: &[u8; 8] = b"C16POL01";
const POLICY_VERSION: u32 = 1;
const POLICY_KEY_SCHEMA: u32 = 1;
pub const POLICY_WEIGHT_TOTAL: u32 = 65_535;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyArtifactMetadata {
    pub training_seed: u64,
    pub training_iterations: u64,
    pub checkpoint_checksum: u64,
    pub source_nodes: u64,
    pub source_singletons: u64,
    pub included_entries: u64,
    pub minimum_visits: u64,
    pub provenance: String,
    pub backoff: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QuantizedPolicyEntry {
    pub key: PolicyInformationSetKey,
    pub legal_mask: u16,
    pub confidence: u32,
    pub weights: [u16; POLICY_ACTION_COUNT],
}

impl QuantizedPolicyEntry {
    pub fn probabilities(&self) -> [f64; POLICY_ACTION_COUNT] {
        let mut probabilities = [0.0; POLICY_ACTION_COUNT];
        for (probability, weight) in probabilities.iter_mut().zip(self.weights) {
            *probability = f64::from(weight) / f64::from(POLICY_WEIGHT_TOTAL);
        }
        probabilities
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyArtifact {
    pub metadata: PolicyArtifactMetadata,
    pub entries: Vec<QuantizedPolicyEntry>,
}

impl PolicyArtifact {
    pub fn new(
        mut metadata: PolicyArtifactMetadata,
        mut entries: Vec<QuantizedPolicyEntry>,
    ) -> Result<PolicyArtifact, String> {
        entries.sort_by_key(|entry| entry.key.to_packed_bytes());
        metadata.included_entries = entries.len() as u64;
        let artifact = PolicyArtifact { metadata, entries };
        artifact.validate()?;
        Ok(artifact)
    }

    pub fn lookup(&self, key: &PolicyInformationSetKey) -> Option<&QuantizedPolicyEntry> {
        let packed = key.to_packed_bytes();
        self.entries
            .binary_search_by(|entry| entry.key.to_packed_bytes().cmp(&packed))
            .ok()
            .and_then(|index| self.entries.get(index))
    }

    pub fn checksum(&self) -> Result<u64, String> {
        let bytes = self.to_bytes()?;
        Ok(u64::from_le_bytes(
            bytes[bytes.len() - 8..].try_into().unwrap(),
        ))
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

    pub fn load(path: impl AsRef<Path>) -> Result<PolicyArtifact, String> {
        let path = path.as_ref();
        let bytes =
            fs::read(path).map_err(|error| format!("read {} failed: {}", path.display(), error))?;
        PolicyArtifact::from_bytes(&bytes)
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        let provenance = self.metadata.provenance.as_bytes();
        let backoff = self.metadata.backoff.as_bytes();
        let provenance_len = u32::try_from(provenance.len())
            .map_err(|_| "policy provenance is too long".to_string())?;
        let backoff_len = u32::try_from(backoff.len())
            .map_err(|_| "policy backoff metadata is too long".to_string())?;
        let mut bytes = Vec::with_capacity(112 + self.entries.len() * 44);
        bytes.extend_from_slice(POLICY_MAGIC);
        bytes.extend_from_slice(&POLICY_VERSION.to_le_bytes());
        bytes.extend_from_slice(&POLICY_KEY_SCHEMA.to_le_bytes());
        bytes.extend_from_slice(&(POLICY_ACTION_COUNT as u32).to_le_bytes());
        bytes.extend_from_slice(&POLICY_WEIGHT_TOTAL.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.training_seed.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.training_iterations.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.checkpoint_checksum.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.source_nodes.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.source_singletons.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.included_entries.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.minimum_visits.to_le_bytes());
        bytes.extend_from_slice(&provenance_len.to_le_bytes());
        bytes.extend_from_slice(&backoff_len.to_le_bytes());
        bytes.extend_from_slice(provenance);
        bytes.extend_from_slice(backoff);
        for entry in &self.entries {
            bytes.extend_from_slice(&entry.key.to_packed_bytes());
            bytes.extend_from_slice(&entry.legal_mask.to_le_bytes());
            bytes.extend_from_slice(&entry.confidence.to_le_bytes());
            let legal = legal_action_indices(entry.legal_mask);
            for action in legal.iter().take(legal.len().saturating_sub(1)) {
                bytes.extend_from_slice(&entry.weights[*action].to_le_bytes());
            }
        }
        let checksum = fnv1a64(&bytes);
        bytes.extend_from_slice(&checksum.to_le_bytes());
        Ok(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<PolicyArtifact, String> {
        if bytes.len() < 8 {
            return Err("policy artifact is truncated".to_string());
        }
        let payload_len = bytes.len() - 8;
        let expected_checksum = u64::from_le_bytes(bytes[payload_len..].try_into().unwrap());
        let actual_checksum = fnv1a64(&bytes[..payload_len]);
        if expected_checksum != actual_checksum {
            return Err(format!(
                "policy checksum mismatch: expected {:016x}, got {:016x}",
                expected_checksum, actual_checksum
            ));
        }
        let mut cursor = ByteCursor::new(&bytes[..payload_len]);
        if cursor.take(8)? != POLICY_MAGIC {
            return Err("invalid policy artifact magic".to_string());
        }
        let version = cursor.u32()?;
        if version != POLICY_VERSION {
            return Err(format!("unsupported policy artifact version {}", version));
        }
        let key_schema = cursor.u32()?;
        if key_schema != POLICY_KEY_SCHEMA {
            return Err(format!("unsupported policy key schema {}", key_schema));
        }
        let action_count = cursor.u32()?;
        if action_count != POLICY_ACTION_COUNT as u32 {
            return Err(format!("unsupported policy action count {}", action_count));
        }
        let weight_total = cursor.u32()?;
        if weight_total != POLICY_WEIGHT_TOTAL {
            return Err(format!("unsupported policy weight total {}", weight_total));
        }
        let training_seed = cursor.u64()?;
        let training_iterations = cursor.u64()?;
        let checkpoint_checksum = cursor.u64()?;
        let source_nodes = cursor.u64()?;
        let source_singletons = cursor.u64()?;
        let included_entries = cursor.u64()?;
        let minimum_visits = cursor.u64()?;
        let provenance_len = cursor.u32()? as usize;
        let backoff_len = cursor.u32()? as usize;
        let provenance = String::from_utf8(cursor.take(provenance_len)?.to_vec())
            .map_err(|_| "policy provenance is not UTF-8".to_string())?;
        let backoff = String::from_utf8(cursor.take(backoff_len)?.to_vec())
            .map_err(|_| "policy backoff metadata is not UTF-8".to_string())?;
        let minimum_entry_bytes = PACKED_POLICY_KEY_BYTES + 2 + 4;
        if included_entries > (cursor.remaining() / minimum_entry_bytes) as u64 {
            return Err("policy entry count exceeds remaining bytes".to_string());
        }
        let mut entries = Vec::with_capacity(included_entries as usize);
        for _ in 0..included_entries {
            let key =
                PolicyInformationSetKey::from_packed_bytes(cursor.take(PACKED_POLICY_KEY_BYTES)?)?;
            let legal_mask = cursor.u16()?;
            let confidence = cursor.u32()?;
            validate_legal_mask(&key, legal_mask)?;
            let legal = legal_action_indices(legal_mask);
            let mut weights = [0_u16; POLICY_ACTION_COUNT];
            let mut used = 0_u32;
            for action in legal.iter().take(legal.len().saturating_sub(1)) {
                let weight = cursor.u16()?;
                weights[*action] = weight;
                used += u32::from(weight);
            }
            if used > POLICY_WEIGHT_TOTAL {
                return Err("policy weights exceed their quantization total".to_string());
            }
            weights[*legal.last().unwrap()] = (POLICY_WEIGHT_TOTAL - used) as u16;
            entries.push(QuantizedPolicyEntry {
                key,
                legal_mask,
                confidence,
                weights,
            });
        }
        if cursor.remaining() != 0 {
            return Err(format!(
                "policy artifact has {} unexpected payload bytes",
                cursor.remaining()
            ));
        }
        let artifact = PolicyArtifact {
            metadata: PolicyArtifactMetadata {
                training_seed,
                training_iterations,
                checkpoint_checksum,
                source_nodes,
                source_singletons,
                included_entries,
                minimum_visits,
                provenance,
                backoff,
            },
            entries,
        };
        artifact.validate()?;
        Ok(artifact)
    }

    fn validate(&self) -> Result<(), String> {
        if self.metadata.included_entries != self.entries.len() as u64 {
            return Err("policy metadata entry count does not match entries".to_string());
        }
        let mut previous = None;
        for entry in &self.entries {
            validate_legal_mask(&entry.key, entry.legal_mask)?;
            let mut total = 0_u32;
            for action in 0..POLICY_ACTION_COUNT {
                let legal = entry.legal_mask & (1 << action) != 0;
                if !legal && entry.weights[action] != 0 {
                    return Err(format!("illegal action {} has policy weight", action));
                }
                total += u32::from(entry.weights[action]);
            }
            if total != POLICY_WEIGHT_TOTAL {
                return Err(format!(
                    "policy weights total {}; expected {}",
                    total, POLICY_WEIGHT_TOTAL
                ));
            }
            let packed = entry.key.to_packed_bytes();
            if previous.as_ref().is_some_and(|prior| prior >= &packed) {
                return Err("policy entries are duplicated or out of order".to_string());
            }
            previous = Some(packed);
        }
        Ok(())
    }
}

pub fn policy_asset_path(root: impl AsRef<Path>) -> PathBuf {
    root.as_ref()
        .join("rust")
        .join("cribbage-shadow-engine")
        .join("assets")
        .join("model16-pegging-policy.bin")
}

fn validate_legal_mask(key: &PolicyInformationSetKey, mask: u16) -> Result<(), String> {
    if mask == 0 || mask >> POLICY_ACTION_COUNT != 0 {
        return Err(format!("invalid policy legal mask {:#x}", mask));
    }
    let expected = key.expected_legal_mask();
    if mask != expected {
        return Err(format!(
            "policy legal mask {:#x} does not match key {:#x}",
            mask, expected
        ));
    }
    Ok(())
}

fn legal_action_indices(mask: u16) -> Vec<usize> {
    (0..POLICY_ACTION_COUNT)
        .filter(|action| mask & (1 << action) != 0)
        .collect()
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

struct ByteCursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> ByteCursor<'a> {
    fn new(bytes: &'a [u8]) -> ByteCursor<'a> {
        ByteCursor { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| "policy artifact offset overflow".to_string())?;
        let slice = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| "policy artifact is truncated".to_string())?;
        self.offset = end;
        Ok(slice)
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
        self.bytes.len() - self.offset
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::Role;

    fn key(rank: u8) -> PolicyInformationSetKey {
        PolicyInformationSetKey {
            role: Role::Pone,
            board_pressure_class: 0,
            own_hand_ranks: 1_u64 << (rank as usize * 3),
            own_played_ranks: 0,
            opponent_played_ranks: 0,
            current_series: 0,
            count: 0,
            go_player: 0,
            last_player: 0,
        }
    }

    fn entry(rank: u8, weights: &[(usize, u16)]) -> QuantizedPolicyEntry {
        let key = key(rank);
        let mut packed = [0_u16; POLICY_ACTION_COUNT];
        for (action, weight) in weights {
            packed[*action] = *weight;
        }
        QuantizedPolicyEntry {
            key,
            legal_mask: key.expected_legal_mask(),
            confidence: 7,
            weights: packed,
        }
    }

    fn artifact() -> PolicyArtifact {
        PolicyArtifact::new(
            PolicyArtifactMetadata {
                training_seed: 7,
                training_iterations: 99,
                checkpoint_checksum: 0x1234,
                source_nodes: 2,
                source_singletons: 3,
                included_entries: 0,
                minimum_visits: 2,
                provenance: "unit-test".to_string(),
                backoff: "legal-observation heuristic".to_string(),
            },
            vec![entry(4, &[(4, u16::MAX)]), entry(2, &[(2, u16::MAX)])],
        )
        .unwrap()
    }

    #[test]
    fn policy_artifact_round_trips_deterministically() {
        let artifact = artifact();
        let bytes = artifact.to_bytes().unwrap();
        let loaded = PolicyArtifact::from_bytes(&bytes).unwrap();
        assert_eq!(loaded, artifact);
        assert_eq!(loaded.to_bytes().unwrap(), bytes);
        assert_eq!(loaded.lookup(&key(4)).unwrap().confidence, 7);

        let path = std::env::temp_dir().join(format!(
            "cribbage-policy-artifact-{}.bin",
            std::process::id()
        ));
        artifact.save(&path).unwrap();
        assert_eq!(PolicyArtifact::load(&path).unwrap(), artifact);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn policy_artifact_rejects_corruption_and_truncation() {
        let bytes = artifact().to_bytes().unwrap();
        let mut corrupt = bytes.clone();
        corrupt[20] ^= 1;
        assert!(PolicyArtifact::from_bytes(&corrupt).is_err());
        assert!(PolicyArtifact::from_bytes(&bytes[..bytes.len() - 1]).is_err());
    }

    #[test]
    fn policy_artifact_rejects_wrong_legal_mask() {
        let mut artifact = artifact();
        artifact.entries[0].legal_mask = 1 << 12;
        assert!(artifact.to_bytes().is_err());
    }

    #[test]
    fn server_asset_path_is_stable() {
        assert_eq!(
            policy_asset_path("/srv/cribbage"),
            PathBuf::from(
                "/srv/cribbage/rust/cribbage-shadow-engine/assets/model16-pegging-policy.bin"
            )
        );
    }
}
