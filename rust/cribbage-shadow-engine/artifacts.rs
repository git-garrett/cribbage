use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

use crate::board::Role;
use crate::cards::{
    enumerate_rank_count_keys, rank_combination_count, rank_counts_from_key, RANKS,
};
use crate::model91::Model91EmpiricalBeliefs;

const MODEL91_PAIR_MAGIC: &[u8; 8] = b"M91PR001";
const MODEL91_LEAD_MAGIC: &[u8; 8] = b"M91LD001";
const MODEL91_EV_MAGIC: &[u8; 8] = b"M91EV001";
const MODEL91_HISTOGRAM_MAGIC: &[u8; 8] = b"M91HS001";
const MODEL131_HISTOGRAM_MAGIC: &[u8; 8] = b"M131H001";
const MODEL91_PAIR_HEADER_BYTES: usize = 40;
const MODEL91_EV_HEADER_BYTES: usize = 24;
const MODEL91_EV_RECORD_BYTES: usize = 13;
const MODEL91_HISTOGRAM_HEADER_BYTES: usize = 24;
const MODEL91_HISTOGRAM_BIN_BYTES: usize = 6;
const MODEL131_HISTOGRAM_HEADER_BYTES: usize = 24;
const MODEL131_HISTOGRAM_BIN_BYTES: usize = 4;
const MODEL131_HISTOGRAM_TOTAL_WEIGHT: u32 = 163_185;
const MODEL131_HISTOGRAM_WEIGHT_BITS: u32 = 17;
const MODEL131_HISTOGRAM_PAIR_BITS: u32 = 10;
const MODEL91_INVALID_PAIR: u16 = u16::MAX;
const MODEL91_DISCARD_ROWS: usize = 330_590;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Model91PairOutcome {
    pub dealer_points: u8,
    pub pone_points: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Model91HistogramBin {
    pub my_points: u8,
    pub opponent_points: u8,
    pub weight: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Model91PeggingSummary {
    pub my_ev: f64,
    pub opponent_ev: f64,
    pub best_lead: Option<u8>,
    pub total_weight: u32,
    pub histogram: Vec<Model91HistogramBin>,
}

pub struct Model91PairTable {
    pub keep_ranks: Vec<[u8; 13]>,
    pub keep_id_by_key: HashMap<String, usize>,
    outcomes: Vec<u16>,
    pone_leads: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Model91DiscardEvRecord {
    pub my_weighted_points: u32,
    pub opponent_weighted_points: u32,
    pub total_weight: u32,
    pub best_lead: Option<u8>,
}

pub struct Model91DiscardEvTable {
    records: Vec<Model91DiscardEvRecord>,
    six_row_starts: HashMap<[u8; 13], usize>,
}

pub struct Model91DiscardHistogramTable {
    offsets: Vec<u32>,
    totals: Vec<u32>,
    bins: Vec<Model91HistogramBin>,
    six_row_starts: HashMap<[u8; 13], usize>,
}

/// A single exact Model 13.1 joint pegging histogram row.
///
/// The on-disk packing remains private to the artifact module. Callers see
/// the same legal `(my points, opponent points, weight)` values as the source
/// Model 9.1 histogram.
pub struct Model131HistogramRow<'a> {
    packed_bins: &'a [u8],
}

impl Model131HistogramRow<'_> {
    pub fn total_weight(&self) -> u32 {
        MODEL131_HISTOGRAM_TOTAL_WEIGHT
    }

    pub fn bins(&self) -> impl Iterator<Item = Model91HistogramBin> + '_ {
        self.packed_bins
            .chunks_exact(MODEL131_HISTOGRAM_BIN_BYTES)
            .map(|bytes| {
                let packed = u32::from_le_bytes(bytes.try_into().expect("four-byte bin"));
                unpack_model131_histogram_bin(packed).expect("validated Model 13.1 bin")
            })
    }
}

/// Exact compact joint pegging histograms used by Model 13.1.
///
/// Row counts are stored as one byte because the complete source asset's
/// maximum is 156. Each four-byte bin packs a ten-bit score pair and the
/// original, unquantized seventeen-bit weight. This keeps the durable runtime
/// asset below 100 MB without changing a single probability.
pub struct Model131DiscardHistogramTable {
    bytes: Vec<u8>,
    row_bin_offsets: Vec<u32>,
    bins_start: usize,
    six_row_starts: HashMap<[u8; 13], usize>,
}

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

fn unpack_model91_pair(value: u16) -> Result<Option<Model91PairOutcome>, String> {
    if value == MODEL91_INVALID_PAIR {
        return Ok(None);
    }
    if value >> 10 != 0 {
        return Err(format!(
            "Model 9.1 pair record has reserved bits set: {:#06x}",
            value
        ));
    }
    Ok(Some(Model91PairOutcome {
        dealer_points: (value & 0x1f) as u8,
        pone_points: ((value >> 5) & 0x1f) as u8,
    }))
}

impl Model91PairTable {
    pub fn load(
        pair_path: impl AsRef<Path>,
        lead_path: impl AsRef<Path>,
    ) -> Result<Model91PairTable, String> {
        let pair_path = pair_path.as_ref();
        let pair_bytes = fs::read(pair_path).map_err(|error| {
            format!(
                "read Model 9.1 pair table {} failed: {}",
                pair_path.display(),
                error
            )
        })?;
        if pair_bytes.len() < MODEL91_PAIR_HEADER_BYTES || &pair_bytes[..8] != MODEL91_PAIR_MAGIC {
            return Err("invalid Model 9.1 pair table header".to_string());
        }
        let version = read_u32_le(&pair_bytes, 8)?;
        let keep_count = read_u32_le(&pair_bytes, 12)? as usize;
        let dealer_start = read_u32_le(&pair_bytes, 16)? as usize;
        let dealer_count = read_u32_le(&pair_bytes, 20)? as usize;
        let pone_start = read_u32_le(&pair_bytes, 24)? as usize;
        let pone_count = read_u32_le(&pair_bytes, 28)? as usize;
        let keep_keys = enumerate_rank_count_keys(4);
        if version != 1
            || keep_count != keep_keys.len()
            || dealer_start != 0
            || dealer_count != keep_count
            || pone_start != 0
            || pone_count != keep_count
        {
            return Err(format!(
                "unsupported or incomplete Model 9.1 pair table: v{}, keeps {}, dealer {}+{}, pone {}+{}",
                version, keep_count, dealer_start, dealer_count, pone_start, pone_count
            ));
        }
        let expected_pair_bytes = MODEL91_PAIR_HEADER_BYTES
            .checked_add(
                keep_count
                    .checked_mul(keep_count)
                    .and_then(|records| records.checked_mul(2))
                    .ok_or_else(|| "Model 9.1 pair table size overflow".to_string())?,
            )
            .ok_or_else(|| "Model 9.1 pair table size overflow".to_string())?;
        if pair_bytes.len() != expected_pair_bytes {
            return Err(format!(
                "Model 9.1 pair table has {} bytes; expected {}",
                pair_bytes.len(),
                expected_pair_bytes
            ));
        }

        let lead_path = lead_path.as_ref();
        let lead_bytes = fs::read(lead_path).map_err(|error| {
            format!(
                "read Model 9.1 pone leads {} failed: {}",
                lead_path.display(),
                error
            )
        })?;
        if lead_bytes.len() < 24 || &lead_bytes[..8] != MODEL91_LEAD_MAGIC {
            return Err("invalid Model 9.1 pone-lead table header".to_string());
        }
        let lead_version = read_u32_le(&lead_bytes, 8)?;
        let lead_keep_count = read_u32_le(&lead_bytes, 12)? as usize;
        let lead_start = read_u32_le(&lead_bytes, 16)? as usize;
        let lead_count = read_u32_le(&lead_bytes, 20)? as usize;
        if lead_version != 1
            || lead_keep_count != keep_count
            || lead_start != 0
            || lead_count != keep_count
            || lead_bytes.len() != 24 + keep_count
        {
            return Err("unsupported or incomplete Model 9.1 pone-lead table".to_string());
        }

        let keep_ranks = keep_keys
            .iter()
            .map(|key| rank_counts_from_key(key))
            .collect::<Result<Vec<_>, _>>()?;
        let keep_id_by_key = keep_keys
            .into_iter()
            .enumerate()
            .map(|(index, key)| (key, index))
            .collect::<HashMap<_, _>>();
        let pone_leads = lead_bytes[24..].to_vec();
        for (keep, lead) in keep_ranks.iter().zip(&pone_leads) {
            if *lead >= 13 || keep[*lead as usize] == 0 {
                return Err("Model 9.1 pone-lead table selects an absent rank".to_string());
            }
        }
        let outcomes = pair_bytes[MODEL91_PAIR_HEADER_BYTES..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        for (dealer_id, dealer) in keep_ranks.iter().enumerate() {
            for (pone_id, pone) in keep_ranks.iter().enumerate() {
                let compatible = dealer
                    .iter()
                    .zip(pone)
                    .all(|(dealer_count, pone_count)| dealer_count + pone_count <= 4);
                let outcome = unpack_model91_pair(outcomes[dealer_id * keep_count + pone_id])?;
                if compatible != outcome.is_some() {
                    return Err(format!(
                        "Model 9.1 pair compatibility mismatch at dealer {}, pone {}",
                        dealer_id, pone_id
                    ));
                }
            }
        }
        Ok(Model91PairTable {
            keep_ranks,
            keep_id_by_key,
            outcomes,
            pone_leads,
        })
    }

    pub fn outcome(
        &self,
        dealer_keep_id: usize,
        pone_keep_id: usize,
    ) -> Result<Option<Model91PairOutcome>, String> {
        let keep_count = self.keep_ranks.len();
        let index = dealer_keep_id
            .checked_mul(keep_count)
            .and_then(|base| base.checked_add(pone_keep_id))
            .ok_or_else(|| "Model 9.1 pair index overflow".to_string())?;
        let packed = self
            .outcomes
            .get(index)
            .copied()
            .ok_or_else(|| "Model 9.1 pair index is out of range".to_string())?;
        unpack_model91_pair(packed)
    }

    /// Aggregate the complete keep-pair asset after removing all six cards the
    /// actor can see at discard time. `available` must therefore describe the
    /// 46 unseen physical cards, not merely the cards outside the retained keep.
    pub fn aggregate(
        &self,
        own_keep: &[u8; 13],
        role: Role,
        available: &[u8; 13],
    ) -> Result<Model91PeggingSummary, String> {
        let own_key = own_keep
            .iter()
            .map(|count| char::from(b'0' + *count))
            .collect::<String>();
        let own_keep_id = self
            .keep_id_by_key
            .get(&own_key)
            .copied()
            .ok_or_else(|| "Model 9.1 own keep is not canonical".to_string())?;
        let mut histogram = BTreeMap::<(u8, u8), u32>::new();
        let mut my_weighted_points = 0_u64;
        let mut opponent_weighted_points = 0_u64;
        let mut total_weight = 0_u32;
        for (opponent_keep_id, opponent_keep) in self.keep_ranks.iter().enumerate() {
            let raw_weight = rank_combination_count(opponent_keep, available);
            let weight = raw_weight.round() as u32;
            if weight == 0 {
                continue;
            }
            if (raw_weight - f64::from(weight)).abs() > f64::EPSILON {
                return Err("Model 9.1 opponent keep weight is not integral".to_string());
            }
            let (dealer_id, pone_id) = match role {
                Role::Dealer => (own_keep_id, opponent_keep_id),
                Role::Pone => (opponent_keep_id, own_keep_id),
            };
            let outcome = self.outcome(dealer_id, pone_id)?.ok_or_else(|| {
                "Model 9.1 compatible weighted opponent keep has no pair outcome".to_string()
            })?;
            let (my_points, opponent_points) = match role {
                Role::Dealer => (outcome.dealer_points, outcome.pone_points),
                Role::Pone => (outcome.pone_points, outcome.dealer_points),
            };
            *histogram.entry((my_points, opponent_points)).or_insert(0) = histogram
                .get(&(my_points, opponent_points))
                .copied()
                .unwrap_or(0)
                .checked_add(weight)
                .ok_or_else(|| "Model 9.1 histogram bin weight overflow".to_string())?;
            total_weight = total_weight
                .checked_add(weight)
                .ok_or_else(|| "Model 9.1 aggregate total weight overflow".to_string())?;
            my_weighted_points += u64::from(my_points) * u64::from(weight);
            opponent_weighted_points += u64::from(opponent_points) * u64::from(weight);
        }
        if total_weight == 0 {
            return Err("Model 9.1 aggregate has no compatible opponent keeps".to_string());
        }
        let best_lead = match role {
            Role::Dealer => None,
            Role::Pone => Some(self.pone_leads[own_keep_id]),
        };
        Ok(Model91PeggingSummary {
            my_ev: my_weighted_points as f64 / f64::from(total_weight),
            opponent_ev: opponent_weighted_points as f64 / f64::from(total_weight),
            best_lead,
            total_weight,
            histogram: histogram
                .into_iter()
                .map(
                    |((my_points, opponent_points), weight)| Model91HistogramBin {
                        my_points,
                        opponent_points,
                        weight,
                    },
                )
                .collect(),
        })
    }
}

impl Model91DiscardEvTable {
    pub fn load(path: impl AsRef<Path>) -> Result<Model91DiscardEvTable, String> {
        let path = path.as_ref();
        let bytes = fs::read(path).map_err(|error| {
            format!(
                "read Model 9.1 discard EV table {} failed: {}",
                path.display(),
                error
            )
        })?;
        if bytes.len() < MODEL91_EV_HEADER_BYTES || &bytes[..8] != MODEL91_EV_MAGIC {
            return Err("invalid Model 9.1 discard EV header".to_string());
        }
        let version = read_u32_le(&bytes, 8)?;
        let row_count = read_u32_le(&bytes, 12)? as usize;
        let record_bytes = read_u32_le(&bytes, 16)? as usize;
        if version != 1
            || row_count != MODEL91_DISCARD_ROWS
            || record_bytes != MODEL91_EV_RECORD_BYTES
            || read_u32_le(&bytes, 20)? != 0
        {
            return Err("unsupported Model 9.1 discard EV format".to_string());
        }
        let expected = MODEL91_EV_HEADER_BYTES
            .checked_add(
                row_count
                    .checked_mul(record_bytes)
                    .ok_or_else(|| "Model 9.1 discard EV size overflow".to_string())?,
            )
            .ok_or_else(|| "Model 9.1 discard EV size overflow".to_string())?;
        if bytes.len() != expected {
            return Err("Model 9.1 discard EV file length is inconsistent".to_string());
        }
        let mut records = Vec::with_capacity(row_count);
        for row in 0..row_count {
            let offset = MODEL91_EV_HEADER_BYTES + row * record_bytes;
            let lead = bytes[offset + 12];
            if lead != u8::MAX && lead >= 13 {
                return Err(format!("Model 9.1 discard EV row {} has invalid lead", row));
            }
            let total_weight = read_u32_le(&bytes, offset + 8)?;
            if total_weight != 163_185 {
                return Err(format!(
                    "Model 9.1 discard EV row {} has weight {}; expected 163185",
                    row, total_weight
                ));
            }
            if (row % 2 == 0 && lead == u8::MAX) || (row % 2 == 1 && lead != u8::MAX) {
                return Err(format!(
                    "Model 9.1 discard EV row {} has a role-inconsistent lead",
                    row
                ));
            }
            let my_weighted_points = read_u32_le(&bytes, offset)?;
            let opponent_weighted_points = read_u32_le(&bytes, offset + 4)?;
            let maximum_points = total_weight * 31;
            if my_weighted_points > maximum_points || opponent_weighted_points > maximum_points {
                return Err(format!(
                    "Model 9.1 discard EV row {} has an impossible weighted sum",
                    row
                ));
            }
            records.push(Model91DiscardEvRecord {
                my_weighted_points,
                opponent_weighted_points,
                total_weight,
                best_lead: (lead != u8::MAX).then_some(lead),
            });
        }
        Ok(Model91DiscardEvTable {
            records,
            six_row_starts: model91_six_row_starts()?,
        })
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    pub fn record(&self, row: usize) -> Option<Model91DiscardEvRecord> {
        self.records.get(row).copied()
    }

    pub fn record_for(
        &self,
        six: &[u8; 13],
        discard: &[u8; 13],
        role: Role,
    ) -> Option<Model91DiscardEvRecord> {
        let row = model91_discard_row(&self.six_row_starts, six, discard, role)?;
        self.record(row)
    }
}

impl Model91DiscardHistogramTable {
    pub fn load(path: impl AsRef<Path>) -> Result<Model91DiscardHistogramTable, String> {
        let path = path.as_ref();
        let bytes = fs::read(path).map_err(|error| {
            format!(
                "read Model 9.1 discard histogram {} failed: {}",
                path.display(),
                error
            )
        })?;
        if bytes.len() < MODEL91_HISTOGRAM_HEADER_BYTES || &bytes[..8] != MODEL91_HISTOGRAM_MAGIC {
            return Err("invalid Model 9.1 discard histogram header".to_string());
        }
        let version = read_u32_le(&bytes, 8)?;
        let row_count = read_u32_le(&bytes, 12)? as usize;
        let bin_bytes = read_u32_le(&bytes, 16)? as usize;
        let bin_count = read_u32_le(&bytes, 20)? as usize;
        if version != 1
            || row_count != MODEL91_DISCARD_ROWS
            || bin_bytes != MODEL91_HISTOGRAM_BIN_BYTES
        {
            return Err("unsupported Model 9.1 discard histogram format".to_string());
        }
        let offsets_start = MODEL91_HISTOGRAM_HEADER_BYTES;
        let totals_start = offsets_start
            .checked_add(
                (row_count + 1)
                    .checked_mul(4)
                    .ok_or_else(|| "Model 9.1 histogram directory overflow".to_string())?,
            )
            .ok_or_else(|| "Model 9.1 histogram directory overflow".to_string())?;
        let bins_start = totals_start
            .checked_add(
                row_count
                    .checked_mul(4)
                    .ok_or_else(|| "Model 9.1 histogram totals overflow".to_string())?,
            )
            .ok_or_else(|| "Model 9.1 histogram totals overflow".to_string())?;
        let expected = bins_start
            .checked_add(
                bin_count
                    .checked_mul(bin_bytes)
                    .ok_or_else(|| "Model 9.1 histogram bins overflow".to_string())?,
            )
            .ok_or_else(|| "Model 9.1 histogram bins overflow".to_string())?;
        if bytes.len() != expected {
            return Err("Model 9.1 discard histogram length is inconsistent".to_string());
        }
        let offsets = read_u32_vec(&bytes, offsets_start, row_count + 1)?;
        let totals = read_u32_vec(&bytes, totals_start, row_count)?;
        if offsets.first().copied() != Some(0)
            || offsets.last().copied() != Some(bin_count as u32)
            || offsets.windows(2).any(|window| window[0] > window[1])
        {
            return Err("Model 9.1 histogram offsets are invalid".to_string());
        }
        let mut bins = Vec::with_capacity(bin_count);
        for bin in 0..bin_count {
            let offset = bins_start + bin * bin_bytes;
            let pair = unpack_model91_pair(read_u16_le(&bytes, offset)?)?
                .ok_or_else(|| "Model 9.1 histogram contains invalid score pair".to_string())?;
            let weight = read_u32_le(&bytes, offset + 2)?;
            if weight == 0 {
                return Err("Model 9.1 histogram contains a zero-weight bin".to_string());
            }
            bins.push(Model91HistogramBin {
                my_points: pair.dealer_points,
                opponent_points: pair.pone_points,
                weight,
            });
        }
        for row in 0..row_count {
            let start = offsets[row] as usize;
            let end = offsets[row + 1] as usize;
            let mut total = 0_u32;
            let mut previous_pair = None;
            for bin in &bins[start..end] {
                let pair = u16::from(bin.my_points) | (u16::from(bin.opponent_points) << 5);
                if previous_pair.is_some_and(|previous| previous >= pair) {
                    return Err(format!(
                        "Model 9.1 histogram row {} is not strictly ordered",
                        row
                    ));
                }
                previous_pair = Some(pair);
                total = total
                    .checked_add(bin.weight)
                    .ok_or_else(|| "Model 9.1 histogram row weight overflow".to_string())?;
            }
            if total != totals[row] || total != 163_185 {
                return Err(format!(
                    "Model 9.1 histogram row {} has total {}; expected directory total {} and canonical total 163185",
                    row, total, totals[row]
                ));
            }
        }
        Ok(Model91DiscardHistogramTable {
            offsets,
            totals,
            bins,
            six_row_starts: model91_six_row_starts()?,
        })
    }

    pub fn len(&self) -> usize {
        self.totals.len()
    }

    pub fn is_empty(&self) -> bool {
        self.totals.is_empty()
    }

    pub fn row(&self, row: usize) -> Option<(&[Model91HistogramBin], u32)> {
        let start = *self.offsets.get(row)? as usize;
        let end = *self.offsets.get(row + 1)? as usize;
        Some((&self.bins[start..end], self.totals[row]))
    }

    pub fn row_for(
        &self,
        six: &[u8; 13],
        discard: &[u8; 13],
        role: Role,
    ) -> Option<(&[Model91HistogramBin], u32)> {
        let row = model91_discard_row(&self.six_row_starts, six, discard, role)?;
        self.row(row)
    }
}

fn unpack_model131_histogram_bin(packed: u32) -> Result<Model91HistogramBin, String> {
    let used_bits = MODEL131_HISTOGRAM_PAIR_BITS + MODEL131_HISTOGRAM_WEIGHT_BITS;
    if packed >> used_bits != 0 {
        return Err("Model 13.1 histogram bin has reserved bits set".to_string());
    }
    let pair_mask = (1_u32 << MODEL131_HISTOGRAM_PAIR_BITS) - 1;
    let pair = packed & pair_mask;
    let weight = packed >> MODEL131_HISTOGRAM_PAIR_BITS;
    if weight == 0 {
        return Err("Model 13.1 histogram contains a zero-weight bin".to_string());
    }
    Ok(Model91HistogramBin {
        my_points: (pair & 0x1f) as u8,
        opponent_points: ((pair >> 5) & 0x1f) as u8,
        weight,
    })
}

impl Model131DiscardHistogramTable {
    pub fn load(path: impl AsRef<Path>) -> Result<Model131DiscardHistogramTable, String> {
        let path = path.as_ref();
        let bytes = fs::read(path).map_err(|error| {
            format!(
                "read Model 13.1 discard histogram {} failed: {}",
                path.display(),
                error
            )
        })?;
        if bytes.len() < MODEL131_HISTOGRAM_HEADER_BYTES || &bytes[..8] != MODEL131_HISTOGRAM_MAGIC
        {
            return Err("invalid Model 13.1 discard histogram header".to_string());
        }
        let version = read_u32_le(&bytes, 8)?;
        let row_count = read_u32_le(&bytes, 12)? as usize;
        let bin_count = read_u32_le(&bytes, 16)? as usize;
        let total_weight = read_u32_le(&bytes, 20)?;
        if version != 1
            || row_count != MODEL91_DISCARD_ROWS
            || total_weight != MODEL131_HISTOGRAM_TOTAL_WEIGHT
        {
            return Err("unsupported Model 13.1 discard histogram format".to_string());
        }
        let counts_start = MODEL131_HISTOGRAM_HEADER_BYTES;
        let bins_start = counts_start
            .checked_add(row_count)
            .ok_or_else(|| "Model 13.1 histogram directory overflow".to_string())?;
        let expected = bins_start
            .checked_add(
                bin_count
                    .checked_mul(MODEL131_HISTOGRAM_BIN_BYTES)
                    .ok_or_else(|| "Model 13.1 histogram bins overflow".to_string())?,
            )
            .ok_or_else(|| "Model 13.1 histogram size overflow".to_string())?;
        if bytes.len() != expected {
            return Err(format!(
                "Model 13.1 histogram has {} bytes; expected {}",
                bytes.len(),
                expected
            ));
        }

        let mut row_bin_offsets = Vec::with_capacity(row_count + 1);
        row_bin_offsets.push(0_u32);
        let mut consumed_bins = 0_u32;
        for row in 0..row_count {
            let row_bins = u32::from(bytes[counts_start + row]);
            if row_bins == 0 {
                return Err(format!("Model 13.1 histogram row {} is empty", row));
            }
            consumed_bins = consumed_bins
                .checked_add(row_bins)
                .ok_or_else(|| "Model 13.1 histogram directory overflow".to_string())?;
            row_bin_offsets.push(consumed_bins);
        }
        if consumed_bins as usize != bin_count {
            return Err(format!(
                "Model 13.1 histogram directory covers {} bins; expected {}",
                consumed_bins, bin_count
            ));
        }

        for row in 0..row_count {
            let start = row_bin_offsets[row] as usize;
            let end = row_bin_offsets[row + 1] as usize;
            let mut previous_pair = None;
            let mut row_weight = 0_u32;
            for bin in start..end {
                let offset = bins_start + bin * MODEL131_HISTOGRAM_BIN_BYTES;
                let packed = read_u32_le(&bytes, offset)?;
                let decoded = unpack_model131_histogram_bin(packed)?;
                let pair = u16::from(decoded.my_points) | (u16::from(decoded.opponent_points) << 5);
                if previous_pair.is_some_and(|previous| previous >= pair) {
                    return Err(format!(
                        "Model 13.1 histogram row {} is not strictly ordered",
                        row
                    ));
                }
                previous_pair = Some(pair);
                row_weight = row_weight
                    .checked_add(decoded.weight)
                    .ok_or_else(|| "Model 13.1 histogram row weight overflow".to_string())?;
            }
            if row_weight != MODEL131_HISTOGRAM_TOTAL_WEIGHT {
                return Err(format!(
                    "Model 13.1 histogram row {} has total {}; expected {}",
                    row, MODEL131_HISTOGRAM_TOTAL_WEIGHT, row_weight
                ));
            }
        }

        Ok(Model131DiscardHistogramTable {
            bytes,
            row_bin_offsets,
            bins_start,
            six_row_starts: model91_six_row_starts()?,
        })
    }

    pub fn len(&self) -> usize {
        self.row_bin_offsets.len().saturating_sub(1)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn row(&self, row: usize) -> Option<Model131HistogramRow<'_>> {
        let start = *self.row_bin_offsets.get(row)? as usize;
        let end = *self.row_bin_offsets.get(row + 1)? as usize;
        let byte_start = self.bins_start + start * MODEL131_HISTOGRAM_BIN_BYTES;
        let byte_end = self.bins_start + end * MODEL131_HISTOGRAM_BIN_BYTES;
        Some(Model131HistogramRow {
            packed_bins: self.bytes.get(byte_start..byte_end)?,
        })
    }

    pub fn row_for(
        &self,
        six: &[u8; 13],
        discard: &[u8; 13],
        role: Role,
    ) -> Option<Model131HistogramRow<'_>> {
        let row = model91_discard_row(&self.six_row_starts, six, discard, role)?;
        self.row(row)
    }
}

fn model91_six_row_starts() -> Result<HashMap<[u8; 13], usize>, String> {
    let mut starts = HashMap::with_capacity(18_395);
    let mut row = 0_usize;
    for key in enumerate_rank_count_keys(6) {
        let six = rank_counts_from_key(&key)?;
        starts.insert(six, row);
        row += model91_discards_from_six(&six).len() * 2;
    }
    if starts.len() != 18_395 || row != MODEL91_DISCARD_ROWS {
        return Err("Model 9.1 canonical discard index has invalid dimensions".to_string());
    }
    Ok(starts)
}

fn model91_discard_row(
    starts: &HashMap<[u8; 13], usize>,
    six: &[u8; 13],
    discard: &[u8; 13],
    role: Role,
) -> Option<usize> {
    let base = *starts.get(six)?;
    let discard_index = model91_discards_from_six(six)
        .iter()
        .position(|candidate| candidate == discard)?;
    let role_offset = match role {
        Role::Pone => 0,
        Role::Dealer => 1,
    };
    Some(base + discard_index * 2 + role_offset)
}

fn model91_discards_from_six(six: &[u8; 13]) -> Vec<[u8; 13]> {
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

pub fn model91_self_test(root: &str) -> Result<(), String> {
    let asset_root = Path::new(root)
        .join("rust")
        .join("cribbage-shadow-engine")
        .join("assets");
    let table = Model91PairTable::load(
        asset_root.join("model91-pair-outcomes.bin"),
        asset_root.join("model91-pone-leads.bin"),
    )?;
    if table.keep_ranks.len() != 1_820 || table.keep_id_by_key.len() != 1_820 {
        return Err("Model 9.1 self-test found an unexpected keep count".to_string());
    }
    let mut own_keep = [0_u8; 13];
    own_keep[0..4].fill(1);
    let mut available = [4_u8; 13];
    for rank in 0..6 {
        available[rank] -= 1;
    }
    for role in [Role::Pone, Role::Dealer] {
        let summary = table.aggregate(&own_keep, role, &available)?;
        if summary.total_weight != 163_185
            || summary.histogram.iter().map(|bin| bin.weight).sum::<u32>() != 163_185
        {
            return Err(format!(
                "Model 9.1 {:?} self-test aggregate has incorrect weight",
                role
            ));
        }
    }
    let ev = Model91DiscardEvTable::load(asset_root.join("model91-discard-ev.bin"))?;
    let mut six = [0_u8; 13];
    six[0..6].fill(1);
    let mut discard = [0_u8; 13];
    discard[0..2].fill(1);
    let mut selected_keep = six;
    for rank in 0..13 {
        selected_keep[rank] -= discard[rank];
    }
    for role in [Role::Pone, Role::Dealer] {
        let record = ev
            .record_for(&six, &discard, role)
            .ok_or_else(|| format!("Model 9.1 {:?} self-test EV row is missing", role))?;
        if record.total_weight != 163_185 {
            return Err(format!(
                "Model 9.1 {:?} self-test EV row has incorrect weight",
                role
            ));
        }
        let source = table.aggregate(&selected_keep, role, &available)?;
        let my_ev = f64::from(record.my_weighted_points) / f64::from(record.total_weight);
        let opponent_ev =
            f64::from(record.opponent_weighted_points) / f64::from(record.total_weight);
        if (my_ev - source.my_ev).abs() > 1e-12
            || (opponent_ev - source.opponent_ev).abs() > 1e-12
            || record.best_lead != source.best_lead
        {
            return Err(format!(
                "Model 9.1 {:?} direct EV row does not match its pair source",
                role
            ));
        }
    }
    Model91EmpiricalBeliefs::load(asset_root.join("model91-pegging-beliefs.bin"))?;
    Ok(())
}

pub fn model131_self_test(root: &str) -> Result<(), String> {
    let asset_root = Path::new(root)
        .join("rust")
        .join("cribbage-shadow-engine")
        .join("assets");
    let histogram =
        Model131DiscardHistogramTable::load(asset_root.join("model131-discard-histograms.bin"))?;
    let ev = Model91DiscardEvTable::load(asset_root.join("model91-discard-ev.bin"))?;
    if histogram.len() != MODEL91_DISCARD_ROWS || histogram.len() != ev.len() {
        return Err("Model 13.1 self-test row counts differ".to_string());
    }
    let mut six = [0_u8; 13];
    six[0..6].fill(1);
    let mut discard = [0_u8; 13];
    discard[0..2].fill(1);
    for role in [Role::Pone, Role::Dealer] {
        let row = histogram
            .row_for(&six, &discard, role)
            .ok_or_else(|| format!("Model 13.1 {:?} histogram row is missing", role))?;
        let record = ev
            .record_for(&six, &discard, role)
            .ok_or_else(|| format!("Model 13.1 {:?} EV row is missing", role))?;
        let mut total = 0_u32;
        let mut my_total = 0_u64;
        let mut opponent_total = 0_u64;
        for bin in row.bins() {
            total = total
                .checked_add(bin.weight)
                .ok_or_else(|| "Model 13.1 self-test weight overflow".to_string())?;
            my_total += u64::from(bin.my_points) * u64::from(bin.weight);
            opponent_total += u64::from(bin.opponent_points) * u64::from(bin.weight);
        }
        if total != row.total_weight()
            || total != record.total_weight
            || my_total != u64::from(record.my_weighted_points)
            || opponent_total != u64::from(record.opponent_weighted_points)
        {
            return Err(format!(
                "Model 13.1 {:?} exact histogram does not match its EV twin",
                role
            ));
        }
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

#[cfg(test)]
mod model91_tests {
    use super::*;
    use std::env;
    use std::process;

    fn model91_temp_dir(label: &str) -> std::path::PathBuf {
        let path = env::temp_dir().join(format!(
            "cribbage-model91-artifacts-{}-{}",
            label,
            process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn model91_pair_reader_reweights_after_all_six_visible_cards() {
        let root = model91_temp_dir("pair");
        let pair_path = root.join("pair-outcomes.bin");
        let lead_path = root.join("pone-leads.bin");
        let keep_keys = enumerate_rank_count_keys(4);
        let keeps = keep_keys
            .iter()
            .map(|key| rank_counts_from_key(key).unwrap())
            .collect::<Vec<_>>();
        let mut pair_bytes = Vec::with_capacity(40 + keeps.len() * keeps.len() * 2);
        pair_bytes.extend_from_slice(MODEL91_PAIR_MAGIC);
        pair_bytes.extend_from_slice(&1_u32.to_le_bytes());
        pair_bytes.extend_from_slice(&(keeps.len() as u32).to_le_bytes());
        pair_bytes.extend_from_slice(&0_u32.to_le_bytes());
        pair_bytes.extend_from_slice(&(keeps.len() as u32).to_le_bytes());
        pair_bytes.extend_from_slice(&0_u32.to_le_bytes());
        pair_bytes.extend_from_slice(&(keeps.len() as u32).to_le_bytes());
        pair_bytes.extend_from_slice(&0_u64.to_le_bytes());
        for dealer in &keeps {
            for pone in &keeps {
                let compatible = dealer
                    .iter()
                    .zip(pone)
                    .all(|(dealer_count, pone_count)| dealer_count + pone_count <= 4);
                let value = if compatible {
                    1_u16 | (2_u16 << 5)
                } else {
                    MODEL91_INVALID_PAIR
                };
                pair_bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        fs::write(&pair_path, pair_bytes).unwrap();

        let mut lead_bytes = Vec::with_capacity(24 + keeps.len());
        lead_bytes.extend_from_slice(MODEL91_LEAD_MAGIC);
        lead_bytes.extend_from_slice(&1_u32.to_le_bytes());
        lead_bytes.extend_from_slice(&(keeps.len() as u32).to_le_bytes());
        lead_bytes.extend_from_slice(&0_u32.to_le_bytes());
        lead_bytes.extend_from_slice(&(keeps.len() as u32).to_le_bytes());
        for keep in &keeps {
            lead_bytes.push(keep.iter().position(|count| *count > 0).unwrap() as u8);
        }
        fs::write(&lead_path, lead_bytes).unwrap();

        let table = Model91PairTable::load(&pair_path, &lead_path).unwrap();
        let own_keep = {
            let mut ranks = [0_u8; 13];
            ranks[0..4].fill(1);
            ranks
        };
        let mut available = [4_u8; 13];
        for rank in 0..6 {
            available[rank] -= 1;
        }
        let pone = table.aggregate(&own_keep, Role::Pone, &available).unwrap();
        assert_eq!(pone.total_weight, 163_185);
        assert_eq!(pone.my_ev, 2.0);
        assert_eq!(pone.opponent_ev, 1.0);
        assert_eq!(pone.histogram.len(), 1);
        assert!(pone.best_lead.is_some());

        let dealer = table
            .aggregate(&own_keep, Role::Dealer, &available)
            .unwrap();
        assert_eq!(dealer.total_weight, 163_185);
        assert_eq!(dealer.my_ev, 1.0);
        assert_eq!(dealer.opponent_ev, 2.0);
        assert_eq!(dealer.best_lead, None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn model91_ev_and_histogram_readers_preserve_exact_weighted_sums() {
        let root = model91_temp_dir("aggregate");
        let ev_path = root.join("discard-ev.bin");
        let histogram_path = root.join("discard-histograms.bin");

        let mut ev = Vec::new();
        ev.extend_from_slice(MODEL91_EV_MAGIC);
        ev.extend_from_slice(&1_u32.to_le_bytes());
        ev.extend_from_slice(&(MODEL91_DISCARD_ROWS as u32).to_le_bytes());
        ev.extend_from_slice(&(MODEL91_EV_RECORD_BYTES as u32).to_le_bytes());
        ev.extend_from_slice(&0_u32.to_le_bytes());
        for row in 0..MODEL91_DISCARD_ROWS {
            let (my, opponent, total, lead) = if row % 2 == 0 {
                (369_555_u32, 326_370_u32, 163_185_u32, 7_u8)
            } else {
                (652_740, 815_925, 163_185, u8::MAX)
            };
            ev.extend_from_slice(&my.to_le_bytes());
            ev.extend_from_slice(&opponent.to_le_bytes());
            ev.extend_from_slice(&total.to_le_bytes());
            ev.push(lead);
        }
        fs::write(&ev_path, ev).unwrap();

        let bin_count = (MODEL91_DISCARD_ROWS / 2) * 3 + (MODEL91_DISCARD_ROWS % 2) * 2;
        let mut histogram = Vec::new();
        histogram.extend_from_slice(MODEL91_HISTOGRAM_MAGIC);
        histogram.extend_from_slice(&1_u32.to_le_bytes());
        histogram.extend_from_slice(&(MODEL91_DISCARD_ROWS as u32).to_le_bytes());
        histogram.extend_from_slice(&(MODEL91_HISTOGRAM_BIN_BYTES as u32).to_le_bytes());
        histogram.extend_from_slice(&(bin_count as u32).to_le_bytes());
        let mut offset = 0_u32;
        histogram.extend_from_slice(&offset.to_le_bytes());
        for row in 0..MODEL91_DISCARD_ROWS {
            offset += if row % 2 == 0 { 2 } else { 1 };
            histogram.extend_from_slice(&offset.to_le_bytes());
        }
        for _ in 0..MODEL91_DISCARD_ROWS {
            histogram.extend_from_slice(&163_185_u32.to_le_bytes());
        }
        for row in 0..MODEL91_DISCARD_ROWS {
            let bins = if row % 2 == 0 {
                &[(1_u8, 2_u8, 60_000_u32), (3, 2, 103_185)][..]
            } else {
                &[(4_u8, 5_u8, 163_185_u32)][..]
            };
            for (my, opponent, weight) in bins {
                let pair = u16::from(*my) | (u16::from(*opponent) << 5);
                histogram.extend_from_slice(&pair.to_le_bytes());
                histogram.extend_from_slice(&weight.to_le_bytes());
            }
        }
        fs::write(&histogram_path, histogram).unwrap();

        let ev = Model91DiscardEvTable::load(&ev_path).unwrap();
        let hist = Model91DiscardHistogramTable::load(&histogram_path).unwrap();
        assert_eq!(ev.len(), hist.len());
        let first_six = rank_counts_from_key(&enumerate_rank_count_keys(6)[0]).unwrap();
        let first_discard = model91_discards_from_six(&first_six)[0];
        assert_eq!(
            ev.record_for(&first_six, &first_discard, Role::Pone),
            ev.record(0)
        );
        assert_eq!(
            ev.record_for(&first_six, &first_discard, Role::Dealer),
            ev.record(1)
        );
        assert_eq!(
            hist.row_for(&first_six, &first_discard, Role::Pone),
            hist.row(0)
        );
        assert_eq!(
            hist.row_for(&first_six, &first_discard, Role::Dealer),
            hist.row(1)
        );
        for row in 0..ev.len() {
            let expected = ev.record(row).unwrap();
            let (bins, total) = hist.row(row).unwrap();
            let my = bins
                .iter()
                .map(|bin| u64::from(bin.my_points) * u64::from(bin.weight))
                .sum::<u64>();
            let opponent = bins
                .iter()
                .map(|bin| u64::from(bin.opponent_points) * u64::from(bin.weight))
                .sum::<u64>();
            assert_eq!(my, u64::from(expected.my_weighted_points));
            assert_eq!(opponent, u64::from(expected.opponent_weighted_points));
            assert_eq!(total, expected.total_weight);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn model131_histogram_reader_preserves_exact_unquantized_bins() {
        let root = model91_temp_dir("model131");
        let path = root.join("model131-discard-histograms.bin");
        let bins_per_row = 3_u8;
        let bin_count = MODEL91_DISCARD_ROWS * usize::from(bins_per_row);
        let mut bytes = Vec::with_capacity(
            MODEL131_HISTOGRAM_HEADER_BYTES
                + MODEL91_DISCARD_ROWS
                + bin_count * MODEL131_HISTOGRAM_BIN_BYTES,
        );
        bytes.extend_from_slice(MODEL131_HISTOGRAM_MAGIC);
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        bytes.extend_from_slice(&(MODEL91_DISCARD_ROWS as u32).to_le_bytes());
        bytes.extend_from_slice(&(bin_count as u32).to_le_bytes());
        bytes.extend_from_slice(&MODEL131_HISTOGRAM_TOTAL_WEIGHT.to_le_bytes());
        bytes.extend(std::iter::repeat_n(bins_per_row, MODEL91_DISCARD_ROWS));
        let expected = [
            Model91HistogramBin {
                my_points: 1,
                opponent_points: 2,
                weight: 60_000,
            },
            Model91HistogramBin {
                my_points: 3,
                opponent_points: 2,
                weight: 60_000,
            },
            Model91HistogramBin {
                my_points: 4,
                opponent_points: 5,
                weight: 43_185,
            },
        ];
        for _ in 0..MODEL91_DISCARD_ROWS {
            for bin in expected {
                let pair = u32::from(bin.my_points) | (u32::from(bin.opponent_points) << 5);
                let packed = pair | (bin.weight << MODEL131_HISTOGRAM_PAIR_BITS);
                bytes.extend_from_slice(&packed.to_le_bytes());
            }
        }
        fs::write(&path, bytes).unwrap();

        let table = Model131DiscardHistogramTable::load(&path).unwrap();
        assert_eq!(table.len(), MODEL91_DISCARD_ROWS);
        let row = table.row(0).unwrap();
        assert_eq!(row.total_weight(), MODEL131_HISTOGRAM_TOTAL_WEIGHT);
        assert_eq!(row.bins().collect::<Vec<_>>(), expected);
        fs::remove_dir_all(root).unwrap();
    }
}
