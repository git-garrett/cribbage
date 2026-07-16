use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::cards::{
    enumerate_rank_count_keys, rank_combination_count, rank_counts_from_key, RANKS,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PairwiseRecord {
    pub opponent_keep_id: u16,
    pub my_pegging: u8,
    pub opponent_pegging: u8,
    pub weight: u16,
}

pub struct PairwiseTable {
    pub keep_ranks: Vec<[u8; 13]>,
    pub keep_id_by_key: HashMap<String, usize>,
    pub dealer_offsets: Vec<u32>,
    pub pone_offsets: Vec<u32>,
    pub dealer_records: Vec<u32>,
    pub pone_records: Vec<u32>,
    pub dealer_aligned_records: Vec<u8>,
    pub pone_aligned_records: Vec<u8>,
    pub record_bytes: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TripolicyPolicy {
    Ev,
    On,
    Off,
}

#[derive(Clone, Debug)]
pub struct EmpiricalEntry {
    pub key: String,
    pub ranks: [u8; 13],
    pub count: u32,
    pub suited_rate: f64,
    pub full_combination_count: f64,
}

#[derive(Clone, Debug)]
pub struct EmpiricalRoleTable {
    pub suited_discard_rate: f64,
    pub distinct_suited_discard_rate: f64,
    pub discards: Vec<EmpiricalEntry>,
    pub keeps: Vec<EmpiricalEntry>,
}

pub struct EmpiricalDiscardKeepTable {
    pub dealer: EmpiricalRoleTable,
    pub pone: EmpiricalRoleTable,
}

pub struct Model13HoldTable {
    pub hand_ranks: Vec<[u8; 13]>,
    pub hand_id_by_key: HashMap<String, usize>,
    pub prefix_id_by_key: HashMap<String, usize>,
    pub contexts: HashMap<(u8, u8, u16), Vec<(usize, u32)>>,
}

#[derive(Clone, Debug)]
pub struct CribRankHistogramDiscard {
    pub ranks: [u8; 13],
    pub weight: f64,
    pub rank_score: i32,
}

#[derive(Clone, Debug)]
pub struct CribRankHistogramEntry {
    pub opponent_discards: Vec<CribRankHistogramDiscard>,
}

pub struct CribRankDiscardTables {
    pub rank_scores: HashMap<(u8, String, u8), f64>,
    pub histograms: HashMap<(u8, String, u8), CribRankHistogramEntry>,
}

#[derive(Clone, Debug)]
pub struct CribTripolicyDiscard {
    pub ranks: [u8; 13],
    pub weight: u32,
    pub rank_score: f32,
}

#[derive(Clone, Debug)]
pub struct CribTripolicyEntry {
    pub average: f32,
    pub opponent_discards: Vec<CribTripolicyDiscard>,
}

pub struct CribTripolicyTable {
    pub pair_keys: Vec<String>,
    pub pair_index_by_key: HashMap<String, usize>,
    pub directory: Vec<CribTripolicyDirectoryRecord>,
    pub records: Vec<CribTripolicyRecord>,
    pub policy_count: usize,
}

#[derive(Clone, Copy)]
pub struct CribTripolicyDirectoryRecord {
    pub average: f32,
    pub record_offset: u32,
    pub record_count: u16,
}

#[derive(Clone, Copy)]
pub struct CribTripolicyRecord {
    pub opponent_pair_index: u8,
    pub weight: u32,
    pub rank_score: f32,
}

fn read_u16_le(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let slice = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| format!("u16 out of range at {}", offset))?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| format!("u32 out of range at {}", offset))?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_f32_le(bytes: &[u8], offset: usize) -> Result<f32, String> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| format!("f32 out of range at {}", offset))?;
    Ok(f32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_f64_le(bytes: &[u8], offset: usize) -> Result<f64, String> {
    let slice = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| format!("f64 out of range at {}", offset))?;
    Ok(f64::from_le_bytes([
        slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
    ]))
}

fn read_u32_vec(bytes: &[u8], offset: usize, count: usize) -> Result<Vec<u32>, String> {
    let mut values = Vec::with_capacity(count);
    for index in 0..count {
        values.push(read_u32_le(bytes, offset + (index * 4))?);
    }
    Ok(values)
}

pub fn unpack_pairwise_record(record: u32) -> PairwiseRecord {
    PairwiseRecord {
        opponent_keep_id: (record & 0x7ff) as u16,
        my_pegging: ((record >> 11) & 0x1f) as u8,
        opponent_pegging: ((record >> 16) & 0x1f) as u8,
        weight: (((record >> 21) & 0xff) + 1) as u16,
    }
}

impl PairwiseTable {
    pub fn load_p12p(path: impl AsRef<Path>) -> Result<PairwiseTable, String> {
        let bytes = fs::read(path.as_ref())
            .map_err(|error| format!("read pairwise table failed: {}", error))?;
        if bytes.len() < 20 {
            return Err("pairwise table too short".to_string());
        }
        let magic = std::str::from_utf8(&bytes[0..4]).map_err(|error| error.to_string())?;
        if magic != "P12P" && magic != "P13P" && magic != "P14A" {
            return Err(format!("unsupported pairwise table magic: {}", magic));
        }
        let version = read_u16_le(&bytes, 4)?;
        if version != 1 {
            return Err(format!("unsupported pairwise table version: {}", version));
        }
        let keep_count = read_u16_le(&bytes, 6)? as usize;
        let dealer_record_count = read_u32_le(&bytes, 8)? as usize;
        let pone_record_count = read_u32_le(&bytes, 12)? as usize;
        let keep_keys = enumerate_rank_count_keys(4);
        if keep_count != keep_keys.len() {
            return Err(format!(
                "keep count mismatch: {} vs {}",
                keep_count,
                keep_keys.len()
            ));
        }

        let record_bytes = if magic == "P14A" {
            read_u16_le(&bytes, 16)? as usize
        } else {
            4
        };
        if magic == "P14A" && record_bytes != 7 {
            return Err(format!("unsupported P14A record width: {}", record_bytes));
        }

        let mut offset = 20usize;
        let dealer_offsets = read_u32_vec(&bytes, offset, keep_count + 1)?;
        offset += (keep_count + 1) * 4;
        let pone_offsets = read_u32_vec(&bytes, offset, (keep_count * 13) + 1)?;
        offset += ((keep_count * 13) + 1) * 4;
        let (dealer_records, pone_records, dealer_aligned_records, pone_aligned_records) =
            if magic == "P14A" {
                let dealer_bytes = dealer_record_count * record_bytes;
                let dealer_aligned_records = bytes
                    .get(offset..offset + dealer_bytes)
                    .ok_or_else(|| "aligned dealer records out of range".to_string())?
                    .to_vec();
                offset += dealer_bytes;
                let pone_bytes = pone_record_count * record_bytes;
                let pone_aligned_records = bytes
                    .get(offset..offset + pone_bytes)
                    .ok_or_else(|| "aligned pone records out of range".to_string())?
                    .to_vec();
                offset += pone_bytes;
                (
                    Vec::new(),
                    Vec::new(),
                    dealer_aligned_records,
                    pone_aligned_records,
                )
            } else {
                let dealer_records = read_u32_vec(&bytes, offset, dealer_record_count)?;
                offset += dealer_record_count * 4;
                let pone_records = read_u32_vec(&bytes, offset, pone_record_count)?;
                offset += pone_record_count * 4;
                (dealer_records, pone_records, Vec::new(), Vec::new())
            };
        if offset > bytes.len() {
            return Err("pairwise table truncated".to_string());
        }

        let mut keep_ranks = Vec::with_capacity(keep_keys.len());
        let mut keep_id_by_key = HashMap::with_capacity(keep_keys.len());
        for (index, key) in keep_keys.iter().enumerate() {
            keep_ranks.push(rank_counts_from_key(key)?);
            keep_id_by_key.insert(key.clone(), index);
        }

        Ok(PairwiseTable {
            keep_ranks,
            keep_id_by_key,
            dealer_offsets,
            pone_offsets,
            dealer_records,
            pone_records,
            dealer_aligned_records,
            pone_aligned_records,
            record_bytes,
        })
    }

    pub fn opponent_keep_weight(&self, available: &[u8; 13], opponent_keep_id: usize) -> f64 {
        self.keep_ranks
            .get(opponent_keep_id)
            .map(|ranks| rank_combination_count(ranks, available))
            .unwrap_or(0.0)
    }

    pub fn dealer_record_range(&self, keep_id: usize) -> Option<std::ops::Range<usize>> {
        Some(
            (*self.dealer_offsets.get(keep_id)? as usize)
                ..(*self.dealer_offsets.get(keep_id + 1)? as usize),
        )
    }

    pub fn pone_record_range(
        &self,
        keep_id: usize,
        lead_rank: usize,
    ) -> Option<std::ops::Range<usize>> {
        let index = (keep_id * 13) + lead_rank;
        Some(
            (*self.pone_offsets.get(index)? as usize)
                ..(*self.pone_offsets.get(index + 1)? as usize),
        )
    }

    pub fn dealer_record(&self, index: usize) -> Option<PairwiseRecord> {
        if !self.dealer_aligned_records.is_empty() {
            return self.dealer_record_for_policy(index, TripolicyPolicy::Ev);
        }
        self.dealer_records
            .get(index)
            .copied()
            .map(unpack_pairwise_record)
    }

    pub fn pone_record(&self, index: usize) -> Option<PairwiseRecord> {
        if !self.pone_aligned_records.is_empty() {
            return self.pone_record_for_policy(index, TripolicyPolicy::Ev);
        }
        self.pone_records
            .get(index)
            .copied()
            .map(unpack_pairwise_record)
    }

    pub fn dealer_record_for_policy(
        &self,
        index: usize,
        policy: TripolicyPolicy,
    ) -> Option<PairwiseRecord> {
        self.record_for_policy(
            &self.dealer_aligned_records,
            self.dealer_records.get(index).copied(),
            index,
            policy,
        )
    }

    pub fn pone_record_for_policy(
        &self,
        index: usize,
        policy: TripolicyPolicy,
    ) -> Option<PairwiseRecord> {
        self.record_for_policy(
            &self.pone_aligned_records,
            self.pone_records.get(index).copied(),
            index,
            policy,
        )
    }

    fn record_for_policy(
        &self,
        aligned_records: &[u8],
        word_record: Option<u32>,
        index: usize,
        policy: TripolicyPolicy,
    ) -> Option<PairwiseRecord> {
        if aligned_records.is_empty() {
            return word_record.map(unpack_pairwise_record);
        }
        let offset = index.checked_mul(self.record_bytes)?;
        let slice = aligned_records.get(offset..offset + 7)?;
        let lo = u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]);
        let hi = (slice[4] as u32) | ((slice[5] as u32) << 8) | ((slice[6] as u32) << 16);
        let opponent_keep_id = (lo & 0x7ff) as u16;
        let weight = (((lo >> 11) & 0xff) + 1) as u16;
        let (my_pegging, opponent_pegging) = match policy {
            TripolicyPolicy::Ev => (((lo >> 19) & 0x1f) as u8, ((lo >> 24) & 0x1f) as u8),
            TripolicyPolicy::On => (
                (((lo >> 29) & 0x7) | ((hi & 0x3) << 3)) as u8,
                ((hi >> 2) & 0x1f) as u8,
            ),
            TripolicyPolicy::Off => (((hi >> 7) & 0x1f) as u8, ((hi >> 12) & 0x1f) as u8),
        };
        Some(PairwiseRecord {
            opponent_keep_id,
            my_pegging,
            opponent_pegging,
            weight,
        })
    }
}

impl CribTripolicyTable {
    pub fn load_c14b(path: impl AsRef<Path>) -> Result<CribTripolicyTable, String> {
        let bytes = fs::read(path.as_ref())
            .map_err(|error| format!("read crib tripolicy table failed: {}", error))?;
        if bytes.len() < 28 {
            return Err("crib tripolicy table too short".to_string());
        }
        let magic = std::str::from_utf8(&bytes[0..4]).map_err(|error| error.to_string())?;
        if magic != "C14B" {
            return Err(format!("unsupported crib tripolicy table magic: {}", magic));
        }
        let version = read_u16_le(&bytes, 4)?;
        if version != 1 {
            return Err(format!("unsupported crib tripolicy version: {}", version));
        }
        let pair_count = read_u16_le(&bytes, 6)? as usize;
        let entry_count = read_u32_le(&bytes, 8)? as usize;
        let directory_offset = read_u32_le(&bytes, 16)? as usize;
        let records_offset = read_u32_le(&bytes, 20)? as usize;
        let directory_record_bytes = read_u16_le(&bytes, 24)? as usize;
        let opponent_record_bytes = read_u16_le(&bytes, 26)? as usize;
        if directory_record_bytes != 10 || opponent_record_bytes != 9 {
            return Err(format!(
                "unsupported crib tripolicy record widths: {}/{}",
                directory_record_bytes, opponent_record_bytes
            ));
        }
        let pair_keys = enumerate_rank_count_keys(2);
        if pair_count != pair_keys.len() {
            return Err(format!(
                "crib tripolicy pair count mismatch: {} vs {}",
                pair_count,
                pair_keys.len()
            ));
        }
        let policy_count = 3usize;
        if entry_count != 2 * pair_count * 13 * policy_count {
            return Err(format!(
                "crib tripolicy entry count mismatch: {}",
                entry_count
            ));
        }

        let mut directory = Vec::with_capacity(entry_count);
        for index in 0..entry_count {
            let offset = directory_offset + (index * directory_record_bytes);
            directory.push(CribTripolicyDirectoryRecord {
                average: read_f32_le(&bytes, offset)?,
                record_offset: read_u32_le(&bytes, offset + 4)?,
                record_count: read_u16_le(&bytes, offset + 8)?,
            });
        }
        let max_record_end = directory
            .iter()
            .map(|record| record.record_offset as usize + record.record_count as usize)
            .max()
            .unwrap_or(0);
        let mut records = Vec::with_capacity(max_record_end);
        for index in 0..max_record_end {
            let offset = records_offset + (index * opponent_record_bytes);
            let opponent_pair_index = *bytes
                .get(offset)
                .ok_or_else(|| "crib tripolicy record out of range".to_string())?;
            records.push(CribTripolicyRecord {
                opponent_pair_index,
                weight: read_u32_le(&bytes, offset + 1)?,
                rank_score: read_f32_le(&bytes, offset + 5)?,
            });
        }
        let mut pair_index_by_key = HashMap::with_capacity(pair_keys.len());
        for (index, key) in pair_keys.iter().enumerate() {
            pair_index_by_key.insert(key.clone(), index);
        }
        Ok(CribTripolicyTable {
            pair_keys,
            pair_index_by_key,
            directory,
            records,
            policy_count,
        })
    }

    pub fn entry(
        &self,
        role: u8,
        discard_key: &str,
        cut_rank: u8,
        policy: TripolicyPolicy,
    ) -> Option<CribTripolicyEntry> {
        let pair_index = *self.pair_index_by_key.get(discard_key)?;
        let policy_index = match policy {
            TripolicyPolicy::Ev => 0usize,
            TripolicyPolicy::On => 1usize,
            TripolicyPolicy::Off => 2usize,
        };
        let entry_index = (((role as usize * self.pair_keys.len()) + pair_index) * 13
            + cut_rank as usize)
            * self.policy_count
            + policy_index;
        let directory = *self.directory.get(entry_index)?;
        let mut opponent_discards = Vec::with_capacity(directory.record_count as usize);
        for index in 0..directory.record_count as usize {
            let record = *self.records.get(directory.record_offset as usize + index)?;
            let key = self.pair_keys.get(record.opponent_pair_index as usize)?;
            opponent_discards.push(CribTripolicyDiscard {
                ranks: rank_counts_from_key(key).ok()?,
                weight: record.weight,
                rank_score: record.rank_score,
            });
        }
        Some(CribTripolicyEntry {
            average: directory.average,
            opponent_discards,
        })
    }
}

pub fn pairwise_self_test(root: &str) -> Result<(), String> {
    let path = Path::new(root)
        .join("rust")
        .join("cribbage-shadow-engine")
        .join("assets")
        .join("model13-pairwise.bin");
    let table = PairwiseTable::load_p12p(path)?;
    if table.keep_ranks.len() != 1820 {
        return Err(format!("unexpected keep count: {}", table.keep_ranks.len()));
    }
    if table.dealer_offsets.len() != 1821 {
        return Err(format!(
            "unexpected dealer offset count: {}",
            table.dealer_offsets.len()
        ));
    }
    if table.pone_offsets.len() != (1820 * 13) + 1 {
        return Err(format!(
            "unexpected pone offset count: {}",
            table.pone_offsets.len()
        ));
    }
    if table.keep_id_by_key.get("0000000000004").copied() != Some(0) {
        return Err("first keep key mismatch".to_string());
    }
    if table.keep_id_by_key.get("4000000000000").copied() != Some(1819) {
        return Err("last keep key mismatch".to_string());
    }
    Ok(())
}

impl EmpiricalDiscardKeepTable {
    pub fn load_edk1(path: impl AsRef<Path>) -> Result<EmpiricalDiscardKeepTable, String> {
        let bytes = fs::read(path.as_ref())
            .map_err(|error| format!("read empirical table failed: {}", error))?;
        if bytes.len() < 8 {
            return Err("empirical table too short".to_string());
        }
        let magic = std::str::from_utf8(&bytes[0..4]).map_err(|error| error.to_string())?;
        if magic != "EDK1" {
            return Err(format!("unsupported empirical table magic: {}", magic));
        }
        let version = read_u16_le(&bytes, 4)?;
        let role_count = read_u16_le(&bytes, 6)?;
        if version != 1 || role_count != 2 {
            return Err(format!(
                "unsupported empirical table header: v{}, roles {}",
                version, role_count
            ));
        }
        let mut offset = 8usize;
        let mut roles: [Option<EmpiricalRoleTable>; 2] = [None, None];
        for _ in 0..role_count {
            let role_index = *bytes
                .get(offset)
                .ok_or_else(|| "role index out of range".to_string())?
                as usize;
            offset += 1;
            let discard_count = read_u16_le(&bytes, offset)? as usize;
            offset += 2;
            let keep_count = read_u16_le(&bytes, offset)? as usize;
            offset += 2;
            let suited_discard_rate = read_f64_le(&bytes, offset)?;
            offset += 8;
            let distinct_suited_discard_rate = read_f64_le(&bytes, offset)?;
            offset += 8;

            let mut discards = Vec::with_capacity(discard_count);
            for _ in 0..discard_count {
                let key_slice = bytes
                    .get(offset..offset + 13)
                    .ok_or_else(|| "discard key out of range".to_string())?;
                let key = std::str::from_utf8(key_slice)
                    .map_err(|error| error.to_string())?
                    .to_string();
                offset += 13;
                let count = read_u32_le(&bytes, offset)?;
                offset += 4;
                let suited_rate = read_f64_le(&bytes, offset)?;
                offset += 8;
                let ranks = rank_counts_from_key(&key)?;
                let full_combination_count = rank_combination_count(&ranks, &[4u8; 13]).max(1.0);
                discards.push(EmpiricalEntry {
                    key,
                    ranks,
                    count,
                    suited_rate,
                    full_combination_count,
                });
            }

            let mut keeps = Vec::with_capacity(keep_count);
            for _ in 0..keep_count {
                let key_slice = bytes
                    .get(offset..offset + 13)
                    .ok_or_else(|| "keep key out of range".to_string())?;
                let key = std::str::from_utf8(key_slice)
                    .map_err(|error| error.to_string())?
                    .to_string();
                offset += 13;
                let count = read_u32_le(&bytes, offset)?;
                offset += 4;
                let ranks = rank_counts_from_key(&key)?;
                let full_combination_count = rank_combination_count(&ranks, &[4u8; 13]).max(1.0);
                keeps.push(EmpiricalEntry {
                    key,
                    ranks,
                    count,
                    suited_rate: 0.0,
                    full_combination_count,
                });
            }

            if role_index >= roles.len() {
                return Err(format!("invalid empirical role index: {}", role_index));
            }
            roles[role_index] = Some(EmpiricalRoleTable {
                suited_discard_rate,
                distinct_suited_discard_rate,
                discards,
                keeps,
            });
        }

        Ok(EmpiricalDiscardKeepTable {
            dealer: roles[0]
                .take()
                .ok_or_else(|| "missing dealer empirical role".to_string())?,
            pone: roles[1]
                .take()
                .ok_or_else(|| "missing pone empirical role".to_string())?,
        })
    }
}

pub fn empirical_self_test(root: &str) -> Result<(), String> {
    let path = Path::new(root)
        .join("rust")
        .join("cribbage-shadow-engine")
        .join("assets")
        .join("empirical-discard-keep-14.8.bin");
    let table = EmpiricalDiscardKeepTable::load_edk1(path)?;
    if table.dealer.discards.len() != 91 || table.pone.discards.len() != 91 {
        return Err(format!(
            "unexpected discard counts: dealer {}, pone {}",
            table.dealer.discards.len(),
            table.pone.discards.len()
        ));
    }
    if table.dealer.keeps.len() != 1767 || table.pone.keeps.len() != 1814 {
        return Err(format!(
            "unexpected keep counts: dealer {}, pone {}",
            table.dealer.keeps.len(),
            table.pone.keeps.len()
        ));
    }
    if table
        .dealer
        .discards
        .first()
        .map(|entry| entry.key.as_str())
        != Some("0000000000002")
    {
        return Err("dealer first discard key mismatch".to_string());
    }
    if table.pone.discards.first().map(|entry| entry.key.as_str()) != Some("0000000000002") {
        return Err("pone first discard key mismatch".to_string());
    }
    Ok(())
}

impl Model13HoldTable {
    pub fn load_p13h(path: impl AsRef<Path>) -> Result<Model13HoldTable, String> {
        let bytes = fs::read(path.as_ref())
            .map_err(|error| format!("read model13 hold table failed: {}", error))?;
        if bytes.len() < 28 {
            return Err("model13 hold table too short".to_string());
        }
        let magic = std::str::from_utf8(&bytes[0..4]).map_err(|error| error.to_string())?;
        if magic != "P13H" {
            return Err(format!("unsupported model13 hold magic: {}", magic));
        }
        let version = read_u16_le(&bytes, 4)?;
        let context_bytes = read_u16_le(&bytes, 6)? as usize;
        let context_count = read_u32_le(&bytes, 8)? as usize;
        let record_count = read_u32_le(&bytes, 12)? as usize;
        let context_offset = read_u32_le(&bytes, 16)? as usize;
        let records_offset = read_u32_le(&bytes, 20)? as usize;
        let record_bytes = read_u16_le(&bytes, 24)? as usize;
        if version != 1 || context_bytes != 16 || record_bytes != 6 {
            return Err(format!(
                "invalid model13 hold header: v{}, context {}, record {}",
                version, context_bytes, record_bytes
            ));
        }

        let hand_keys = model13_hold_hand_keys();
        let prefix_keys = model13_hold_prefix_keys();
        let mut hand_ranks = Vec::with_capacity(hand_keys.len());
        let mut hand_id_by_key = HashMap::with_capacity(hand_keys.len());
        for (index, key) in hand_keys.iter().enumerate() {
            hand_ranks.push(rank_counts_from_key(key)?);
            hand_id_by_key.insert(key.clone(), index);
        }
        let prefix_id_by_key = prefix_keys
            .iter()
            .enumerate()
            .map(|(index, key)| (key.clone(), index))
            .collect::<HashMap<_, _>>();

        let mut contexts = HashMap::with_capacity(context_count);
        for index in 0..context_count {
            let offset = context_offset + (index * context_bytes);
            if offset + context_bytes > bytes.len() {
                return Err("model13 hold context out of range".to_string());
            }
            let role = bytes[offset];
            let prefix_length = bytes[offset + 1];
            let prefix_index = read_u16_le(&bytes, offset + 2)?;
            let first_record = read_u32_le(&bytes, offset + 8)? as usize;
            let context_record_count = read_u16_le(&bytes, offset + 12)? as usize;
            let mut records = Vec::with_capacity(context_record_count);
            for record_index in 0..context_record_count {
                let absolute = first_record + record_index;
                if absolute >= record_count {
                    break;
                }
                let record_offset = records_offset + (absolute * record_bytes);
                if record_offset + record_bytes > bytes.len() {
                    return Err("model13 hold record out of range".to_string());
                }
                let hand_id = read_u16_le(&bytes, record_offset)? as usize;
                let weight = read_u32_le(&bytes, record_offset + 2)?;
                if hand_id < hand_ranks.len() && weight > 0 {
                    records.push((hand_id, weight));
                }
            }
            contexts.insert((role, prefix_length, prefix_index), records);
        }

        Ok(Model13HoldTable {
            hand_ranks,
            hand_id_by_key,
            prefix_id_by_key,
            contexts,
        })
    }

    pub fn context_records(
        &self,
        role: u8,
        prefix_key: &str,
        prefix_length: u8,
    ) -> Option<&Vec<(usize, u32)>> {
        let prefix_index = *self.prefix_id_by_key.get(prefix_key)? as u16;
        self.contexts.get(&(role, prefix_length, prefix_index))
    }
}

impl CribRankDiscardTables {
    pub fn load(
        rank_score_path: impl AsRef<Path>,
        histogram_path: impl AsRef<Path>,
    ) -> Result<CribRankDiscardTables, String> {
        Ok(CribRankDiscardTables {
            rank_scores: parse_crib_rank_scores(
                &fs::read_to_string(rank_score_path.as_ref())
                    .map_err(|error| format!("read crib rank score table failed: {}", error))?,
            )?,
            histograms: parse_crib_histograms(
                &fs::read_to_string(histogram_path.as_ref())
                    .map_err(|error| format!("read crib histogram table failed: {}", error))?,
            )?,
        })
    }

    pub fn rank_score(&self, role: u8, discard_key: &str, cut_rank: u8) -> Option<f64> {
        self.rank_scores
            .get(&(role, discard_key.to_string(), cut_rank))
            .copied()
    }

    pub fn histogram(
        &self,
        role: u8,
        discard_key: &str,
        cut_rank: u8,
    ) -> Option<&CribRankHistogramEntry> {
        self.histograms
            .get(&(role, discard_key.to_string(), cut_rank))
    }
}

struct JsonCursor<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> JsonCursor<'a> {
    fn new(input: &'a str) -> JsonCursor<'a> {
        JsonCursor {
            bytes: input.as_bytes(),
            position: 0,
        }
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.position += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.position).copied()
    }

    fn next(&mut self) -> Option<u8> {
        let byte = self.peek()?;
        self.position += 1;
        Some(byte)
    }

    fn expect(&mut self, expected: u8) -> Result<(), String> {
        self.skip_ws();
        match self.next() {
            Some(actual) if actual == expected => Ok(()),
            Some(actual) => Err(format!(
                "expected '{}' at {}, got '{}'",
                expected as char,
                self.position.saturating_sub(1),
                actual as char
            )),
            None => Err(format!("expected '{}' at eof", expected as char)),
        }
    }

    fn consume_if(&mut self, byte: u8) -> bool {
        self.skip_ws();
        if self.peek() == Some(byte) {
            self.position += 1;
            true
        } else {
            false
        }
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.skip_ws();
        self.expect(b'"')?;
        let mut output = String::new();
        while let Some(byte) = self.next() {
            match byte {
                b'"' => return Ok(output),
                b'\\' => {
                    let escaped = self
                        .next()
                        .ok_or_else(|| "unterminated string escape".to_string())?;
                    match escaped {
                        b'"' => output.push('"'),
                        b'\\' => output.push('\\'),
                        b'/' => output.push('/'),
                        b'b' => output.push('\u{0008}'),
                        b'f' => output.push('\u{000c}'),
                        b'n' => output.push('\n'),
                        b'r' => output.push('\r'),
                        b't' => output.push('\t'),
                        other => {
                            return Err(format!("unsupported string escape: {}", other as char))
                        }
                    }
                }
                _ => output.push(byte as char),
            }
        }
        Err("unterminated string".to_string())
    }

    fn parse_f64(&mut self) -> Result<f64, String> {
        self.skip_ws();
        let start = self.position;
        while matches!(
            self.peek(),
            Some(b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')
        ) {
            self.position += 1;
        }
        if start == self.position {
            return Err(format!("expected number at {}", start));
        }
        let text = std::str::from_utf8(&self.bytes[start..self.position])
            .map_err(|error| error.to_string())?;
        text.parse::<f64>()
            .map_err(|error| format!("invalid number '{}': {}", text, error))
    }

    fn parse_i32(&mut self) -> Result<i32, String> {
        let value = self.parse_f64()?;
        Ok(value as i32)
    }

    fn parse_literal(&mut self, literal: &[u8]) -> Result<(), String> {
        self.skip_ws();
        let end = self.position + literal.len();
        if self.bytes.get(self.position..end) == Some(literal) {
            self.position = end;
            Ok(())
        } else {
            Err(format!(
                "expected literal {} at {}",
                String::from_utf8_lossy(literal),
                self.position
            ))
        }
    }

    fn skip_value(&mut self) -> Result<(), String> {
        self.skip_ws();
        match self.peek() {
            Some(b'{') => {
                self.expect(b'{')?;
                if self.consume_if(b'}') {
                    return Ok(());
                }
                loop {
                    self.parse_string()?;
                    self.expect(b':')?;
                    self.skip_value()?;
                    if self.consume_if(b'}') {
                        return Ok(());
                    }
                    self.expect(b',')?;
                }
            }
            Some(b'[') => {
                self.expect(b'[')?;
                if self.consume_if(b']') {
                    return Ok(());
                }
                loop {
                    self.skip_value()?;
                    if self.consume_if(b']') {
                        return Ok(());
                    }
                    self.expect(b',')?;
                }
            }
            Some(b'"') => {
                self.parse_string()?;
                Ok(())
            }
            Some(b't') => self.parse_literal(b"true"),
            Some(b'f') => self.parse_literal(b"false"),
            Some(b'n') => self.parse_literal(b"null"),
            Some(_) => {
                self.parse_f64()?;
                Ok(())
            }
            None => Err("unexpected eof while skipping json value".to_string()),
        }
    }
}

fn parse_crib_rank_scores(input: &str) -> Result<HashMap<(u8, String, u8), f64>, String> {
    let mut cursor = JsonCursor::new(input);
    let mut scores = HashMap::new();
    cursor.expect(b'{')?;
    if cursor.consume_if(b'}') {
        return Ok(scores);
    }
    loop {
        let key = cursor.parse_string()?;
        cursor.expect(b':')?;
        if key == "table" {
            parse_crib_rank_score_table(&mut cursor, &mut scores)?;
        } else {
            cursor.skip_value()?;
        }
        if cursor.consume_if(b'}') {
            break;
        }
        cursor.expect(b',')?;
    }
    Ok(scores)
}

fn parse_crib_rank_score_table(
    cursor: &mut JsonCursor<'_>,
    scores: &mut HashMap<(u8, String, u8), f64>,
) -> Result<(), String> {
    cursor.expect(b'{')?;
    if cursor.consume_if(b'}') {
        return Ok(());
    }
    loop {
        let role_name = cursor.parse_string()?;
        let role = crib_role_index(&role_name)?;
        cursor.expect(b':')?;
        cursor.expect(b'{')?;
        if !cursor.consume_if(b'}') {
            loop {
                let discard_key = cursor.parse_string()?;
                cursor.expect(b':')?;
                cursor.expect(b'[')?;
                for cut_rank in 0..13u8 {
                    if cursor.peek() == Some(b'n') {
                        cursor.parse_literal(b"null")?;
                    } else {
                        let score = cursor.parse_f64()?;
                        scores.insert((role, discard_key.clone(), cut_rank), score);
                    }
                    if cut_rank < 12 {
                        cursor.expect(b',')?;
                    }
                }
                cursor.expect(b']')?;
                if cursor.consume_if(b'}') {
                    break;
                }
                cursor.expect(b',')?;
            }
        }
        if cursor.consume_if(b'}') {
            break;
        }
        cursor.expect(b',')?;
    }
    Ok(())
}

fn parse_crib_histograms(
    input: &str,
) -> Result<HashMap<(u8, String, u8), CribRankHistogramEntry>, String> {
    let mut cursor = JsonCursor::new(input);
    let mut histograms = HashMap::new();
    cursor.expect(b'{')?;
    if cursor.consume_if(b'}') {
        return Ok(histograms);
    }
    loop {
        let key = cursor.parse_string()?;
        cursor.expect(b':')?;
        if key == "table" {
            parse_crib_histogram_table(&mut cursor, &mut histograms)?;
        } else {
            cursor.skip_value()?;
        }
        if cursor.consume_if(b'}') {
            break;
        }
        cursor.expect(b',')?;
    }
    Ok(histograms)
}

fn parse_crib_histogram_table(
    cursor: &mut JsonCursor<'_>,
    histograms: &mut HashMap<(u8, String, u8), CribRankHistogramEntry>,
) -> Result<(), String> {
    cursor.expect(b'{')?;
    if cursor.consume_if(b'}') {
        return Ok(());
    }
    loop {
        let role_name = cursor.parse_string()?;
        let role = crib_role_index(&role_name)?;
        cursor.expect(b':')?;
        cursor.expect(b'{')?;
        if !cursor.consume_if(b'}') {
            loop {
                let discard_key = cursor.parse_string()?;
                cursor.expect(b':')?;
                cursor.expect(b'[')?;
                for cut_rank in 0..13u8 {
                    let entry = parse_crib_histogram_entry(cursor)?;
                    histograms.insert((role, discard_key.clone(), cut_rank), entry);
                    if cut_rank < 12 {
                        cursor.expect(b',')?;
                    }
                }
                cursor.expect(b']')?;
                if cursor.consume_if(b'}') {
                    break;
                }
                cursor.expect(b',')?;
            }
        }
        if cursor.consume_if(b'}') {
            break;
        }
        cursor.expect(b',')?;
    }
    Ok(())
}

fn parse_crib_histogram_entry(
    cursor: &mut JsonCursor<'_>,
) -> Result<CribRankHistogramEntry, String> {
    let mut opponent_discards = Vec::new();
    cursor.expect(b'{')?;
    if cursor.consume_if(b'}') {
        return Ok(CribRankHistogramEntry { opponent_discards });
    }
    loop {
        let key = cursor.parse_string()?;
        cursor.expect(b':')?;
        if key == "opponentDiscards" {
            opponent_discards = parse_crib_histogram_discards(cursor)?;
        } else {
            cursor.skip_value()?;
        }
        if cursor.consume_if(b'}') {
            break;
        }
        cursor.expect(b',')?;
    }
    Ok(CribRankHistogramEntry { opponent_discards })
}

fn parse_crib_histogram_discards(
    cursor: &mut JsonCursor<'_>,
) -> Result<Vec<CribRankHistogramDiscard>, String> {
    let mut discards = Vec::new();
    cursor.expect(b'[')?;
    if cursor.consume_if(b']') {
        return Ok(discards);
    }
    loop {
        let mut ranks: Option<[u8; 13]> = None;
        let mut weight: Option<f64> = None;
        let mut rank_score: Option<i32> = None;
        cursor.expect(b'{')?;
        if !cursor.consume_if(b'}') {
            loop {
                let key = cursor.parse_string()?;
                cursor.expect(b':')?;
                match key.as_str() {
                    "ranks" => {
                        let value = cursor.parse_string()?;
                        ranks = Some(rank_counts_from_key(&value)?);
                    }
                    "weight" => weight = Some(cursor.parse_f64()?),
                    "rankScore" => rank_score = Some(cursor.parse_i32()?),
                    _ => cursor.skip_value()?,
                }
                if cursor.consume_if(b'}') {
                    break;
                }
                cursor.expect(b',')?;
            }
        }
        discards.push(CribRankHistogramDiscard {
            ranks: ranks.ok_or_else(|| "crib histogram discard missing ranks".to_string())?,
            weight: weight.ok_or_else(|| "crib histogram discard missing weight".to_string())?,
            rank_score: rank_score
                .ok_or_else(|| "crib histogram discard missing rankScore".to_string())?,
        });
        if cursor.consume_if(b']') {
            break;
        }
        cursor.expect(b',')?;
    }
    Ok(discards)
}

fn crib_role_index(role: &str) -> Result<u8, String> {
    match role {
        "dealer" => Ok(0),
        "pone" => Ok(1),
        other => Err(format!("unsupported crib rank role: {}", other)),
    }
}

pub fn model13_hold_self_test(root: &str) -> Result<(), String> {
    let path = Path::new(root)
        .join("rust")
        .join("cribbage-shadow-engine")
        .join("assets")
        .join("model13-hold.bin");
    let table = Model13HoldTable::load_p13h(path)?;
    if table.hand_ranks.len() != 2372 {
        return Err(format!(
            "unexpected model13 hand keys: {}",
            table.hand_ranks.len()
        ));
    }
    if table.prefix_id_by_key.len() != 560 {
        return Err(format!(
            "unexpected model13 prefix keys: {}",
            table.prefix_id_by_key.len()
        ));
    }
    if !table.hand_id_by_key.contains_key("0000000000000")
        || !table.hand_id_by_key.contains_key("4000000000000")
    {
        return Err("model13 hand key boundary mismatch".to_string());
    }
    if !table.prefix_id_by_key.contains_key("") || !table.prefix_id_by_key.contains_key("K,K,K") {
        return Err("model13 prefix key boundary mismatch".to_string());
    }
    Ok(())
}

fn model13_hold_hand_keys() -> Vec<String> {
    const MISSING: [&str; 8] = [
        "0000020000011",
        "0000020001001",
        "0000201010000",
        "0010010002000",
        "0010200100000",
        "0100010000020",
        "0100010002000",
        "1010200000000",
    ];
    let mut keys = Vec::new();
    for size in 0..=4 {
        keys.extend(enumerate_rank_count_keys(size));
    }
    keys.sort();
    keys.retain(|key| !MISSING.contains(&key.as_str()));
    keys
}

fn model13_hold_prefix_keys() -> Vec<String> {
    let mut keys = vec![String::new()];
    let mut ranks = Vec::new();
    for size in 1..=3 {
        generate_prefix_keys(size, 0, &mut ranks, &mut keys);
    }
    keys.sort();
    keys
}

fn generate_prefix_keys(size: usize, start: usize, ranks: &mut Vec<usize>, keys: &mut Vec<String>) {
    if ranks.len() == size {
        keys.push(
            ranks
                .iter()
                .map(|rank| RANKS[*rank])
                .collect::<Vec<_>>()
                .join(","),
        );
        return;
    }
    for rank in start..13 {
        ranks.push(rank);
        generate_prefix_keys(size, rank, ranks, keys);
        ranks.pop();
    }
}
