//! Frozen native reader for the historical Model 9.0 discard-time pegging table.
//!
//! The packed file is a lossless binary transcription of the original JSON
//! values.  It exists so Model 9.1 can be benchmarked against the real 9.0
//! baseline without involving a second runtime or changing Model 9.0 strategy.

use crate::board::Role;
use crate::cards::{enumerate_rank_count_keys, rank_counts_from_key};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const MAGIC: &[u8; 8] = b"M90EV001";
const VERSION: u32 = 1;
const HEADER_BYTES: usize = 24;
const RECORD_BYTES: usize = 17;
const EXPECTED_ROWS: usize = 330_590;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Model90DiscardRecord {
    pub my_ev: f64,
    pub opponent_ev: f64,
    pub best_lead: Option<u8>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct RowKey {
    six: [u8; 13],
    discard: [u8; 13],
    role: Role,
}

pub struct Model90DiscardTable {
    records: Vec<Model90DiscardRecord>,
    rows: HashMap<RowKey, usize>,
}

impl Model90DiscardTable {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let bytes =
            fs::read(path).map_err(|error| format!("read {} failed: {}", path.display(), error))?;
        if bytes.len() < HEADER_BYTES || &bytes[..8] != MAGIC {
            return Err(format!("{} is not a Model 9.0 EV asset", path.display()));
        }
        let version = read_u32(&bytes, 8)?;
        let row_count = read_u32(&bytes, 12)? as usize;
        let record_bytes = read_u32(&bytes, 16)? as usize;
        let reserved = read_u32(&bytes, 20)?;
        if version != VERSION
            || row_count != EXPECTED_ROWS
            || record_bytes != RECORD_BYTES
            || reserved != 0
        {
            return Err(format!(
                "{} has invalid Model 9.0 header: version={}, rows={}, recordBytes={}, reserved={}",
                path.display(),
                version,
                row_count,
                record_bytes,
                reserved
            ));
        }
        let expected_len = HEADER_BYTES + row_count * RECORD_BYTES;
        if bytes.len() != expected_len {
            return Err(format!(
                "{} has {} bytes; expected {}",
                path.display(),
                bytes.len(),
                expected_len
            ));
        }
        let mut records = Vec::with_capacity(row_count);
        for row in 0..row_count {
            let offset = HEADER_BYTES + row * RECORD_BYTES;
            let my_ev = read_f64(&bytes, offset)?;
            let opponent_ev = read_f64(&bytes, offset + 8)?;
            let lead = bytes[offset + 16];
            if !my_ev.is_finite()
                || !opponent_ev.is_finite()
                || (lead != u8::MAX && lead >= 13)
                || (row % 2 == 0 && lead == u8::MAX)
                || (row % 2 == 1 && lead != u8::MAX)
            {
                return Err(format!(
                    "{} has invalid Model 9.0 row {}",
                    path.display(),
                    row
                ));
            }
            records.push(Model90DiscardRecord {
                my_ev,
                opponent_ev,
                best_lead: (lead != u8::MAX).then_some(lead),
            });
        }
        let rows = canonical_rows()?;
        if rows.len() != row_count {
            return Err(format!(
                "Model 9.0 canonical index has {} rows; expected {}",
                rows.len(),
                row_count
            ));
        }
        Ok(Self { records, rows })
    }

    pub fn get(
        &self,
        six: &[u8; 13],
        discard: &[u8; 13],
        role: Role,
    ) -> Option<Model90DiscardRecord> {
        self.rows
            .get(&RowKey {
                six: *six,
                discard: *discard,
                role,
            })
            .and_then(|index| self.records.get(*index))
            .copied()
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}

fn canonical_rows() -> Result<HashMap<RowKey, usize>, String> {
    let mut rows = HashMap::with_capacity(EXPECTED_ROWS);
    for key in enumerate_rank_count_keys(6) {
        let six = rank_counts_from_key(&key)?;
        for discard in discards_from_six(&six) {
            for role in [Role::Pone, Role::Dealer] {
                let row = rows.len();
                if rows.insert(RowKey { six, discard, role }, row).is_some() {
                    return Err("duplicate Model 9.0 canonical row".to_string());
                }
            }
        }
    }
    Ok(rows)
}

fn discards_from_six(six: &[u8; 13]) -> Vec<[u8; 13]> {
    let mut discards = Vec::new();
    for first in 0..13 {
        if six[first] == 0 {
            continue;
        }
        for second in first..13 {
            let needed = if first == second { 2 } else { 1 };
            if six[second] < needed {
                continue;
            }
            let mut discard = [0_u8; 13];
            discard[first] += 1;
            discard[second] += 1;
            discards.push(discard);
        }
    }
    discards
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "truncated Model 9.0 asset".to_string())?;
    Ok(u32::from_le_bytes(value.try_into().unwrap()))
}

fn read_f64(bytes: &[u8], offset: usize) -> Result<f64, String> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| "truncated Model 9.0 asset".to_string())?;
    Ok(f64::from_le_bytes(value.try_into().unwrap()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_index_has_every_historical_row() {
        let rows = canonical_rows().unwrap();
        assert_eq!(rows.len(), EXPECTED_ROWS);
    }
}
