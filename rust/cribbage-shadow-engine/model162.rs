//! Compact legal-information action scorer retained as Model 16.3.
//!
//! Its features are derived from [`PegInformationSetKey`], so the scorer can
//! never see an opponent's retained cards or crib cards. The legacy module
//! name and `C162SCO1` artifact format are retained solely to load the frozen
//! scorer baseline without rewriting its bytes.

use crate::information_set::{
    InfoActor, PegInformationSetKey, PublicPegEvent, POLICY_ACTION_COUNT,
};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;

const SCORER_MAGIC: &[u8; 8] = b"C162SCO1";
const SCORER_VERSION: u32 = 1;
const MAX_FEATURE_SLOTS: usize = 65_536;

/// Public, measurable quantities used to represent what the opponent can
/// still plausibly hold.  These are inputs to the compact scorer rather than
/// a hidden-world posterior: rank depletion is reconstructed only from cards
/// visible to the acting player and publicly announced plays.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicOpponentBeliefFeatures {
    pub opponent_played_ranks: [u8; 13],
    pub known_rank_depletion: [u8; 13],
    pub opponent_cards_remaining: u8,
    pub self_go_declarations: u8,
    pub opponent_go_declarations: u8,
    pub completed_series: u8,
}

impl PublicOpponentBeliefFeatures {
    pub fn from_key(key: &PegInformationSetKey) -> Result<Self, String> {
        let mut opponent_played_ranks = [0_u8; 13];
        let mut known_rank_depletion = unpack_ranks(key.own_hand_ranks);
        add_counts(
            &mut known_rank_depletion,
            unpack_ranks(key.own_discard_ranks),
        );
        known_rank_depletion[key.turn_rank as usize] =
            known_rank_depletion[key.turn_rank as usize].saturating_add(1);
        let mut self_go_declarations = 0_u8;
        let mut opponent_go_declarations = 0_u8;
        let mut completed_series = 0_u8;
        for event in key.history()? {
            match event {
                PublicPegEvent::SelfPlay(rank) => {
                    known_rank_depletion[rank as usize] =
                        known_rank_depletion[rank as usize].saturating_add(1);
                }
                PublicPegEvent::OpponentPlay(rank) => {
                    opponent_played_ranks[rank as usize] =
                        opponent_played_ranks[rank as usize].saturating_add(1);
                    known_rank_depletion[rank as usize] =
                        known_rank_depletion[rank as usize].saturating_add(1);
                }
                PublicPegEvent::SelfGo => {
                    self_go_declarations = self_go_declarations.saturating_add(1);
                }
                PublicPegEvent::OpponentGo => {
                    opponent_go_declarations = opponent_go_declarations.saturating_add(1);
                }
                PublicPegEvent::Reset => {
                    completed_series = completed_series.saturating_add(1);
                }
            }
        }
        let opponent_cards_remaining = 4_u8.saturating_sub(
            opponent_played_ranks
                .iter()
                .copied()
                .fold(0_u8, u8::saturating_add),
        );
        Ok(PublicOpponentBeliefFeatures {
            opponent_played_ranks,
            known_rank_depletion,
            opponent_cards_remaining,
            self_go_declarations,
            opponent_go_declarations,
            completed_series,
        })
    }
}

/// A full-policy training row expressed as a centered, regret-derived action
/// advantage.  The exact checkpoint produces these before its policy is
/// quantized, so the miss scorer learns an action-quality signal rather than
/// merely copying the selected action probability.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Model162ActionAdvantageEntry {
    pub key: PegInformationSetKey,
    pub legal_mask: u16,
    pub confidence: u32,
    pub advantages: [i16; POLICY_ACTION_COUNT],
}

/// Versioned, compact action-advantage scorer used only after an exact-policy
/// table miss. Each row is a feature-hash bucket and each column is one of the
/// thirteen ranks plus go.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Model162ActionScorerMetadata {
    pub source_policy_checksum: u64,
    pub source_entries: u64,
    pub included_entries: u64,
    pub feature_slots: u32,
    pub minimum_confidence: u32,
    pub provenance: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Model162ActionScorer {
    pub metadata: Model162ActionScorerMetadata,
    action_bias: [i16; POLICY_ACTION_COUNT],
    action_support: [bool; POLICY_ACTION_COUNT],
    feature_weights: Vec<[i16; POLICY_ACTION_COUNT]>,
    feature_counts: Vec<[u32; POLICY_ACTION_COUNT]>,
}

impl Model162ActionScorer {
    /// Build the scorer from regret-derived action advantages. The retained
    /// 16.3 baseline was distilled from the retired 16.2 experiment.
    pub fn build_from_action_advantages(
        source_checkpoint_checksum: u64,
        entries: &[Model162ActionAdvantageEntry],
        feature_slots: usize,
        minimum_confidence: u32,
        provenance: String,
    ) -> Result<Model162ActionScorer, String> {
        if feature_slots == 0 || feature_slots > MAX_FEATURE_SLOTS {
            return Err(format!(
                "Model 16.2 feature slots must be in 1..={}, got {}",
                MAX_FEATURE_SLOTS, feature_slots
            ));
        }
        if provenance.trim().is_empty() {
            return Err("Model 16.2 scorer provenance must not be empty".to_string());
        }

        let mut sums = vec![[0_i64; POLICY_ACTION_COUNT]; feature_slots];
        let mut counts = vec![[0_u32; POLICY_ACTION_COUNT]; feature_slots];
        let mut bias_sums = [0_i64; POLICY_ACTION_COUNT];
        let mut bias_counts = [0_u32; POLICY_ACTION_COUNT];
        let mut included_entries = 0_u64;

        for entry in entries {
            if entry.confidence < minimum_confidence {
                continue;
            }
            let legal_mask = entry.key.expected_legal_mask();
            if entry.legal_mask != legal_mask {
                return Err(format!(
                    "Model 16.2 action-advantage legal mask {:#x} does not match key {:#x}",
                    entry.legal_mask, legal_mask
                ));
            }
            let feature_ids = feature_ids(&entry.key)?;
            included_entries = included_entries.saturating_add(1);
            for action in 0..POLICY_ACTION_COUNT {
                if legal_mask & (1 << action) == 0 {
                    continue;
                }
                let advantage = i64::from(entry.advantages[action]);
                bias_sums[action] += advantage;
                bias_counts[action] = bias_counts[action].saturating_add(1);
                for feature in &feature_ids {
                    let slot = (*feature as usize) % feature_slots;
                    sums[slot][action] += advantage;
                    counts[slot][action] = counts[slot][action].saturating_add(1);
                }
            }
        }
        if included_entries == 0 {
            return Err("no Model 16.2 training entries meet the confidence threshold".to_string());
        }

        let action_bias = average_rows(&bias_sums, &bias_counts);
        let feature_weights = sums
            .iter()
            .zip(&counts)
            .map(|(sum, count)| average_rows(sum, count))
            .collect::<Vec<_>>();
        let scorer = Model162ActionScorer {
            metadata: Model162ActionScorerMetadata {
                source_policy_checksum: source_checkpoint_checksum,
                source_entries: entries.len() as u64,
                included_entries,
                feature_slots: feature_slots as u32,
                minimum_confidence,
                provenance,
            },
            action_bias,
            action_support: std::array::from_fn(|action| bias_counts[action] != 0),
            feature_weights,
            feature_counts: counts,
        };
        scorer.validate()?;
        Ok(scorer)
    }

    /// Return a centered action advantage for every action.  A value is
    /// present only when at least one legal feature bucket supplied evidence
    /// for that action; callers must then still apply the legal action mask.
    pub fn action_advantages(
        &self,
        key: &PegInformationSetKey,
    ) -> Result<[Option<i32>; POLICY_ACTION_COUNT], String> {
        self.validate()?;
        let feature_ids = feature_ids(key)?;
        let mut total = [0_i64; POLICY_ACTION_COUNT];
        let mut used = [0_u32; POLICY_ACTION_COUNT];
        for action in 0..POLICY_ACTION_COUNT {
            if self.action_support[action] {
                total[action] = i64::from(self.action_bias[action]);
                used[action] = 1;
            }
        }
        for feature in feature_ids {
            let slot = (feature as usize) % self.feature_weights.len();
            for action in 0..POLICY_ACTION_COUNT {
                if self.feature_counts[slot][action] == 0 {
                    continue;
                }
                total[action] += i64::from(self.feature_weights[slot][action]);
                used[action] = used[action].saturating_add(1);
            }
        }
        Ok(std::array::from_fn(|action| {
            (used[action] != 0).then(|| {
                (total[action] / i64::from(used[action]))
                    .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
            })
        }))
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

    pub fn load(path: impl AsRef<Path>) -> Result<Model162ActionScorer, String> {
        let path = path.as_ref();
        let bytes =
            fs::read(path).map_err(|error| format!("read {} failed: {}", path.display(), error))?;
        Model162ActionScorer::from_bytes(&bytes)
    }

    pub fn checksum(&self) -> Result<u64, String> {
        let bytes = self.to_bytes()?;
        Ok(u64::from_le_bytes(
            bytes[bytes.len() - 8..].try_into().expect("checksum width"),
        ))
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        let provenance = self.metadata.provenance.as_bytes();
        let provenance_len = u32::try_from(provenance.len())
            .map_err(|_| "Model 16.2 scorer provenance is too long".to_string())?;
        let slots = self.feature_weights.len();
        let row_bytes = POLICY_ACTION_COUNT * (2 + 4);
        let mut bytes = Vec::with_capacity(80 + provenance.len() + slots * row_bytes);
        bytes.extend_from_slice(SCORER_MAGIC);
        bytes.extend_from_slice(&SCORER_VERSION.to_le_bytes());
        bytes.extend_from_slice(&(POLICY_ACTION_COUNT as u32).to_le_bytes());
        bytes.extend_from_slice(&self.metadata.source_policy_checksum.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.source_entries.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.included_entries.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.feature_slots.to_le_bytes());
        bytes.extend_from_slice(&self.metadata.minimum_confidence.to_le_bytes());
        bytes.extend_from_slice(&provenance_len.to_le_bytes());
        bytes.extend_from_slice(provenance);
        for value in self.action_bias {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for (weights, counts) in self.feature_weights.iter().zip(&self.feature_counts) {
            for value in weights {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
            for value in counts {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        let checksum = fnv1a64(&bytes);
        bytes.extend_from_slice(&checksum.to_le_bytes());
        Ok(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Model162ActionScorer, String> {
        if bytes.len() < 8 {
            return Err("Model 16.2 scorer is truncated".to_string());
        }
        let payload_len = bytes.len() - 8;
        let expected_checksum = u64::from_le_bytes(bytes[payload_len..].try_into().unwrap());
        let actual_checksum = fnv1a64(&bytes[..payload_len]);
        if expected_checksum != actual_checksum {
            return Err(format!(
                "Model 16.2 scorer checksum mismatch: expected {:016x}, got {:016x}",
                expected_checksum, actual_checksum
            ));
        }
        let mut cursor = ByteCursor::new(&bytes[..payload_len]);
        if cursor.take(8)? != SCORER_MAGIC {
            return Err("invalid Model 16.2 scorer magic".to_string());
        }
        if cursor.u32()? != SCORER_VERSION {
            return Err("unsupported Model 16.2 scorer version".to_string());
        }
        if cursor.u32()? != POLICY_ACTION_COUNT as u32 {
            return Err("unsupported Model 16.2 action count".to_string());
        }
        let source_policy_checksum = cursor.u64()?;
        let source_entries = cursor.u64()?;
        let included_entries = cursor.u64()?;
        let feature_slots = cursor.u32()?;
        let minimum_confidence = cursor.u32()?;
        let provenance_len = cursor.u32()? as usize;
        let provenance = String::from_utf8(cursor.take(provenance_len)?.to_vec())
            .map_err(|_| "Model 16.2 scorer provenance is not UTF-8".to_string())?;
        let mut action_bias = [0_i16; POLICY_ACTION_COUNT];
        for value in &mut action_bias {
            *value = cursor.i16()?;
        }
        if feature_slots == 0 || feature_slots as usize > MAX_FEATURE_SLOTS {
            return Err(format!(
                "invalid Model 16.2 scorer feature slots {}",
                feature_slots
            ));
        }
        let slots = feature_slots as usize;
        let row_bytes = POLICY_ACTION_COUNT * (2 + 4);
        if cursor.remaining() != slots * row_bytes {
            return Err("Model 16.2 scorer rows do not match feature slot count".to_string());
        }
        let mut feature_weights = Vec::with_capacity(slots);
        let mut feature_counts = Vec::with_capacity(slots);
        for _ in 0..slots {
            let mut weights = [0_i16; POLICY_ACTION_COUNT];
            for value in &mut weights {
                *value = cursor.i16()?;
            }
            let mut counts = [0_u32; POLICY_ACTION_COUNT];
            for value in &mut counts {
                *value = cursor.u32()?;
            }
            feature_weights.push(weights);
            feature_counts.push(counts);
        }
        let scorer = Model162ActionScorer {
            metadata: Model162ActionScorerMetadata {
                source_policy_checksum,
                source_entries,
                included_entries,
                feature_slots,
                minimum_confidence,
                provenance,
            },
            action_bias,
            action_support: std::array::from_fn(|action| {
                feature_counts.iter().any(|counts| counts[action] != 0)
            }),
            feature_weights,
            feature_counts,
        };
        scorer.validate()?;
        Ok(scorer)
    }

    fn validate(&self) -> Result<(), String> {
        if self.metadata.provenance.trim().is_empty() {
            return Err("Model 16.2 scorer provenance must not be empty".to_string());
        }
        if self.metadata.included_entries == 0 {
            return Err("Model 16.2 scorer has no training entries".to_string());
        }
        if self.metadata.feature_slots == 0
            || self.metadata.feature_slots as usize > MAX_FEATURE_SLOTS
            || self.feature_weights.len() != self.metadata.feature_slots as usize
            || self.feature_counts.len() != self.metadata.feature_slots as usize
        {
            return Err("Model 16.2 scorer feature rows are inconsistent".to_string());
        }
        Ok(())
    }
}

fn average_rows(
    sums: &[i64; POLICY_ACTION_COUNT],
    counts: &[u32; POLICY_ACTION_COUNT],
) -> [i16; POLICY_ACTION_COUNT] {
    std::array::from_fn(|action| {
        if counts[action] == 0 {
            0
        } else {
            (sums[action] / i64::from(counts[action]))
                .clamp(i64::from(i16::MIN), i64::from(i16::MAX)) as i16
        }
    })
}

fn feature_ids(key: &PegInformationSetKey) -> Result<Vec<u64>, String> {
    let belief = PublicOpponentBeliefFeatures::from_key(key)?;
    let history = key.history()?;
    let mut features = Vec::with_capacity(48);
    let role = match key.role {
        crate::board::Role::Pone => 0_u64,
        crate::board::Role::Dealer => 1_u64,
    };
    let current = actor_token(key.current);
    let go = optional_actor_token(key.go_player);
    let last = optional_actor_token(key.last_player);
    let score_delta = i16::from(key.my_score) - i16::from(key.opponent_score);
    features.push(hash_feature(&[1, role]));
    features.push(hash_feature(&[
        2,
        u64::from(key.my_score),
        u64::from(key.opponent_score),
    ]));
    features.push(hash_feature(&[3, role, (score_delta + 121) as u64]));
    features.push(hash_feature(&[
        4,
        role,
        u64::from(key.turn_rank),
        key.own_discard_ranks,
    ]));
    features.push(hash_feature(&[
        5,
        key.own_hand_ranks,
        u64::from(key.count),
        current,
        go,
        last,
    ]));
    features.push(hash_feature(&[
        6,
        u64::from(belief.opponent_cards_remaining),
        u64::from(belief.self_go_declarations),
        u64::from(belief.opponent_go_declarations),
        u64::from(belief.completed_series),
    ]));
    features.push(hash_feature(&[7, history_hash(&history)]));
    for width in 1..=4 {
        let start = history.len().saturating_sub(width);
        features.push(hash_feature(&[
            8 + width as u64,
            history_hash(&history[start..]),
            u64::from(key.count),
            current,
        ]));
    }
    for rank in 0..13 {
        features.push(hash_feature(&[
            16,
            rank as u64,
            u64::from(belief.opponent_played_ranks[rank]),
            u64::from(belief.known_rank_depletion[rank]),
        ]));
    }
    let mut seen = HashSet::new();
    features.retain(|feature| seen.insert(*feature));
    Ok(features)
}

fn unpack_ranks(packed: u64) -> [u8; 13] {
    std::array::from_fn(|rank| ((packed >> (rank * 3)) & 0b111) as u8)
}

fn add_counts(destination: &mut [u8; 13], source: [u8; 13]) {
    for (destination, source) in destination.iter_mut().zip(source) {
        *destination = destination.saturating_add(source);
    }
}

fn actor_token(actor: InfoActor) -> u64 {
    match actor {
        InfoActor::SelfPlayer => 0,
        InfoActor::Opponent => 1,
    }
}

fn optional_actor_token(actor: Option<InfoActor>) -> u64 {
    actor.map(actor_token).map(|value| value + 1).unwrap_or(0)
}

fn history_hash(history: &[PublicPegEvent]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for event in history {
        hash ^= match event {
            PublicPegEvent::SelfPlay(rank) => 1 + u64::from(*rank),
            PublicPegEvent::OpponentPlay(rank) => 32 + u64::from(*rank),
            PublicPegEvent::SelfGo => 64,
            PublicPegEvent::OpponentGo => 65,
            PublicPegEvent::Reset => 66,
        };
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    hash
}

fn hash_feature(values: &[u64]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for value in values {
        for byte in value.to_le_bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x1000_0000_01b3);
        }
    }
    hash
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x1000_0000_01b3)
    })
}

struct ByteCursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> ByteCursor<'a> {
    fn new(bytes: &'a [u8]) -> ByteCursor<'a> {
        ByteCursor { bytes, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(count)
            .ok_or_else(|| "Model 16.2 scorer cursor overflow".to_string())?;
        if end > self.bytes.len() {
            return Err("Model 16.2 scorer is truncated".to_string());
        }
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(value)
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn i16(&mut self) -> Result<i16, String> {
        Ok(i16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::Role;
    use crate::information_set::{PegObservation, POLICY_ACTION_COUNT};

    fn key(history: &[PublicPegEvent]) -> PegInformationSetKey {
        PegInformationSetKey::from_observation(PegObservation {
            role: Role::Pone,
            my_score: 94,
            opponent_score: 91,
            own_hand: &[
                crate::cards::Card::new(1).unwrap(),
                crate::cards::Card::new(5).unwrap(),
            ],
            own_discards: &[
                crate::cards::Card::new(8).unwrap(),
                crate::cards::Card::new(24).unwrap(),
            ],
            turn_card: crate::cards::Card::new(12).unwrap(),
            count: 10,
            current: InfoActor::SelfPlayer,
            go_player: None,
            last_player: Some(InfoActor::Opponent),
            history,
        })
        .unwrap()
    }

    fn training_rows() -> Vec<Model162ActionAdvantageEntry> {
        let first = key(&[PublicPegEvent::SelfPlay(1), PublicPegEvent::OpponentPlay(5)]);
        let second = key(&[PublicPegEvent::OpponentPlay(5), PublicPegEvent::SelfPlay(1)]);
        let first_mask = first.expected_legal_mask();
        let second_mask = second.expected_legal_mask();
        let mut first_advantages = [0_i16; POLICY_ACTION_COUNT];
        first_advantages[1] = 100;
        let mut second_advantages = [0_i16; POLICY_ACTION_COUNT];
        second_advantages[5] = 100;
        vec![
            Model162ActionAdvantageEntry {
                key: first,
                legal_mask: first_mask,
                confidence: 7,
                advantages: first_advantages,
            },
            Model162ActionAdvantageEntry {
                key: second,
                legal_mask: second_mask,
                confidence: 7,
                advantages: second_advantages,
            },
        ]
    }

    #[test]
    fn public_belief_features_use_only_visible_history_and_depletion() {
        let features = PublicOpponentBeliefFeatures::from_key(&key(&[
            PublicPegEvent::SelfPlay(1),
            PublicPegEvent::OpponentPlay(5),
            PublicPegEvent::OpponentGo,
            PublicPegEvent::Reset,
        ]))
        .unwrap();
        assert_eq!(features.opponent_played_ranks[5], 1);
        assert_eq!(features.opponent_cards_remaining, 3);
        assert_eq!(features.opponent_go_declarations, 1);
        assert_eq!(features.completed_series, 1);
        assert!(features.known_rank_depletion[1] >= 1);
        assert!(features.known_rank_depletion[5] >= 1);
    }

    #[test]
    fn ordered_public_history_changes_feature_identity() {
        let first = feature_ids(&key(&[
            PublicPegEvent::SelfPlay(1),
            PublicPegEvent::OpponentPlay(5),
        ]))
        .unwrap();
        let second = feature_ids(&key(&[
            PublicPegEvent::OpponentPlay(5),
            PublicPegEvent::SelfPlay(1),
        ]))
        .unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn scorer_round_trips_and_scores_a_legal_view() {
        let source = training_rows();
        let scorer = Model162ActionScorer::build_from_action_advantages(
            3,
            &source,
            64,
            1,
            "unit-test".to_string(),
        )
        .unwrap();
        let bytes = scorer.to_bytes().unwrap();
        assert_eq!(Model162ActionScorer::from_bytes(&bytes).unwrap(), scorer);
        assert!(scorer
            .action_advantages(&source[0].key)
            .unwrap()
            .iter()
            .any(Option::is_some));
        let mut corrupt = bytes;
        corrupt[12] ^= 1;
        assert!(Model162ActionScorer::from_bytes(&corrupt).is_err());
    }
}
