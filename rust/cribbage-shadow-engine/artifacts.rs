use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::cards::{enumerate_rank_count_keys, rank_combination_count, rank_counts_from_key, RANKS};

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

fn read_u16_le(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let slice = bytes.get(offset..offset + 2).ok_or_else(|| format!("u16 out of range at {}", offset))?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let slice = bytes.get(offset..offset + 4).ok_or_else(|| format!("u32 out of range at {}", offset))?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_f64_le(bytes: &[u8], offset: usize) -> Result<f64, String> {
    let slice = bytes.get(offset..offset + 8).ok_or_else(|| format!("f64 out of range at {}", offset))?;
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
        let bytes = fs::read(path.as_ref()).map_err(|error| format!("read pairwise table failed: {}", error))?;
        if bytes.len() < 20 {
            return Err("pairwise table too short".to_string());
        }
        let magic = std::str::from_utf8(&bytes[0..4]).map_err(|error| error.to_string())?;
        if magic != "P12P" && magic != "P13P" {
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
            return Err(format!("keep count mismatch: {} vs {}", keep_count, keep_keys.len()));
        }

        let mut offset = 20usize;
        let dealer_offsets = read_u32_vec(&bytes, offset, keep_count + 1)?;
        offset += (keep_count + 1) * 4;
        let pone_offsets = read_u32_vec(&bytes, offset, (keep_count * 13) + 1)?;
        offset += ((keep_count * 13) + 1) * 4;
        let dealer_records = read_u32_vec(&bytes, offset, dealer_record_count)?;
        offset += dealer_record_count * 4;
        let pone_records = read_u32_vec(&bytes, offset, pone_record_count)?;
        offset += pone_record_count * 4;
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
        })
    }

    pub fn opponent_keep_weight(&self, available: &[u8; 13], opponent_keep_id: usize) -> f64 {
        self.keep_ranks
            .get(opponent_keep_id)
            .map(|ranks| rank_combination_count(ranks, available))
            .unwrap_or(0.0)
    }

    pub fn dealer_record_range(&self, keep_id: usize) -> Option<std::ops::Range<usize>> {
        Some((*self.dealer_offsets.get(keep_id)? as usize)..(*self.dealer_offsets.get(keep_id + 1)? as usize))
    }

    pub fn pone_record_range(&self, keep_id: usize, lead_rank: usize) -> Option<std::ops::Range<usize>> {
        let index = (keep_id * 13) + lead_rank;
        Some((*self.pone_offsets.get(index)? as usize)..(*self.pone_offsets.get(index + 1)? as usize))
    }

    pub fn dealer_record(&self, index: usize) -> Option<PairwiseRecord> {
        self.dealer_records.get(index).copied().map(unpack_pairwise_record)
    }

    pub fn pone_record(&self, index: usize) -> Option<PairwiseRecord> {
        self.pone_records.get(index).copied().map(unpack_pairwise_record)
    }
}

pub fn pairwise_self_test(root: &str) -> Result<(), String> {
    let path = Path::new(root)
        .join("web")
        .join("src")
        .join("models")
        .join("schell_table-peg_table-12.0")
        .join("pegging-outcome-pairwise.bin");
    let table = PairwiseTable::load_p12p(path)?;
    if table.keep_ranks.len() != 1820 {
        return Err(format!("unexpected keep count: {}", table.keep_ranks.len()));
    }
    if table.dealer_offsets.len() != 1821 {
        return Err(format!("unexpected dealer offset count: {}", table.dealer_offsets.len()));
    }
    if table.pone_offsets.len() != (1820 * 13) + 1 {
        return Err(format!("unexpected pone offset count: {}", table.pone_offsets.len()));
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
        let bytes = fs::read(path.as_ref()).map_err(|error| format!("read empirical table failed: {}", error))?;
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
            return Err(format!("unsupported empirical table header: v{}, roles {}", version, role_count));
        }
        let mut offset = 8usize;
        let mut roles: [Option<EmpiricalRoleTable>; 2] = [None, None];
        for _ in 0..role_count {
            let role_index = *bytes.get(offset).ok_or_else(|| "role index out of range".to_string())? as usize;
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
                let key_slice = bytes.get(offset..offset + 13).ok_or_else(|| "discard key out of range".to_string())?;
                let key = std::str::from_utf8(key_slice).map_err(|error| error.to_string())?.to_string();
                offset += 13;
                let count = read_u32_le(&bytes, offset)?;
                offset += 4;
                let suited_rate = read_f64_le(&bytes, offset)?;
                offset += 8;
                let ranks = rank_counts_from_key(&key)?;
                let full_combination_count = rank_combination_count(&ranks, &[4u8; 13]).max(1.0);
                discards.push(EmpiricalEntry { key, ranks, count, suited_rate, full_combination_count });
            }

            let mut keeps = Vec::with_capacity(keep_count);
            for _ in 0..keep_count {
                let key_slice = bytes.get(offset..offset + 13).ok_or_else(|| "keep key out of range".to_string())?;
                let key = std::str::from_utf8(key_slice).map_err(|error| error.to_string())?.to_string();
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
            dealer: roles[0].take().ok_or_else(|| "missing dealer empirical role".to_string())?,
            pone: roles[1].take().ok_or_else(|| "missing pone empirical role".to_string())?,
        })
    }
}

pub fn empirical_self_test(root: &str) -> Result<(), String> {
    let path = Path::new(root)
        .join("web")
        .join("src")
        .join("models")
        .join("rank-crib-discard")
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
    if table.dealer.discards.first().map(|entry| entry.key.as_str()) != Some("0000000000002") {
        return Err("dealer first discard key mismatch".to_string());
    }
    if table.pone.discards.first().map(|entry| entry.key.as_str()) != Some("0000000000002") {
        return Err("pone first discard key mismatch".to_string());
    }
    Ok(())
}

impl Model13HoldTable {
    pub fn load_p13h(path: impl AsRef<Path>) -> Result<Model13HoldTable, String> {
        let bytes = fs::read(path.as_ref()).map_err(|error| format!("read model13 hold table failed: {}", error))?;
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

    pub fn context_records(&self, role: u8, prefix_key: &str, prefix_length: u8) -> Option<&Vec<(usize, u32)>> {
        let prefix_index = *self.prefix_id_by_key.get(prefix_key)? as u16;
        self.contexts.get(&(role, prefix_length, prefix_index))
    }
}

pub fn model13_hold_self_test(root: &str) -> Result<(), String> {
    let path = Path::new(root)
        .join("web")
        .join("src")
        .join("models")
        .join("schell_table-peg_table-13.0")
        .join("pegging-remaining-hand-distribution.bin");
    let table = Model13HoldTable::load_p13h(path)?;
    if table.hand_ranks.len() != 2372 {
        return Err(format!("unexpected model13 hand keys: {}", table.hand_ranks.len()));
    }
    if table.prefix_id_by_key.len() != 560 {
        return Err(format!("unexpected model13 prefix keys: {}", table.prefix_id_by_key.len()));
    }
    if !table.hand_id_by_key.contains_key("0000000000000") || !table.hand_id_by_key.contains_key("4000000000000") {
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
        keys.push(ranks.iter().map(|rank| RANKS[*rank]).collect::<Vec<_>>().join(","));
        return;
    }
    for rank in start..13 {
        ranks.push(rank);
        generate_prefix_keys(size, rank, ranks, keys);
        ranks.pop();
    }
}
