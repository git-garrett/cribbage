//! Exact finite score distributions, not observation-to-action policy storage.
use std::io::{Read, Write};

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct JointScores {
    // Sorted sparse bins. Most rows occupy only a small part of the u8 × u8 space.
    bins: Vec<(u16, u128)>,
}

impl JointScores {
    pub fn add(&mut self, own: u8, opponent: u8, weight: u128) -> Result<(), String> {
        if weight == 0 {
            return Ok(());
        }
        let key = (u16::from(own) << 8) | u16::from(opponent);
        match self.bins.binary_search_by_key(&key, |bin| bin.0) {
            Ok(index) => {
                self.bins[index].1 = self.bins[index]
                    .1
                    .checked_add(weight)
                    .ok_or("joint score weight overflow")?
            }
            Err(index) => self.bins.insert(index, (key, weight)),
        }
        Ok(())
    }

    pub fn bins(&self) -> impl Iterator<Item = (u8, u8, u128)> + '_ {
        self.bins
            .iter()
            .map(|&(key, weight)| ((key >> 8) as u8, key as u8, weight))
    }

    pub fn moments(&self) -> Result<[u128; 3], String> {
        let mut result = [0_u128; 3];
        for (own, opponent, weight) in self.bins() {
            for (slot, multiplier) in
                result
                    .iter_mut()
                    .zip([u128::from(own), u128::from(opponent), 1])
            {
                *slot = slot
                    .checked_add(
                        weight
                            .checked_mul(multiplier)
                            .ok_or("joint score moment overflow")?,
                    )
                    .ok_or("joint score moment overflow")?;
            }
        }
        Ok(result)
    }

    pub fn merge(&mut self, other: &Self) -> Result<(), String> {
        for (own, opponent, weight) in other.bins() {
            self.add(own, opponent, weight)?;
        }
        Ok(())
    }

    pub fn write(&self, writer: &mut impl Write) -> Result<(), String> {
        writer
            .write_all(&(self.bins.len() as u32).to_le_bytes())
            .map_err(|e| e.to_string())?;
        for (key, weight) in &self.bins {
            writer
                .write_all(&key.to_le_bytes())
                .and_then(|_| writer.write_all(&weight.to_le_bytes()))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn read(reader: &mut impl Read) -> Result<Self, String> {
        let mut count = [0_u8; 4];
        reader.read_exact(&mut count).map_err(|e| e.to_string())?;
        let count = u32::from_le_bytes(count) as usize;
        if count > 65_536 {
            return Err("joint score bin count exceeds u8 pair domain".into());
        }
        let mut bins = Vec::with_capacity(count);
        for _ in 0..count {
            let mut bytes = [0_u8; 18];
            reader.read_exact(&mut bytes).map_err(|e| e.to_string())?;
            let key = u16::from_le_bytes(bytes[..2].try_into().unwrap());
            let weight = u128::from_le_bytes(bytes[2..].try_into().unwrap());
            if weight == 0 || bins.last().is_some_and(|&(previous, _)| previous >= key) {
                return Err("joint score bins must be positive, unique, and sorted".into());
            }
            bins.push((key, weight));
        }
        let value = Self { bins };
        value.moments()?;
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_means_do_not_erase_joint_outcomes() {
        let mut correlated = JointScores::default();
        correlated.add(0, 0, 1).unwrap();
        correlated.add(4, 4, 1).unwrap();
        let mut anticorrelated = JointScores::default();
        anticorrelated.add(0, 4, 1).unwrap();
        anticorrelated.add(4, 0, 1).unwrap();
        assert_eq!(correlated.moments(), anticorrelated.moments());
        assert_ne!(correlated, anticorrelated);
        for original in [correlated, anticorrelated] {
            let mut bytes = Vec::new();
            original.write(&mut bytes).unwrap();
            assert_eq!(JointScores::read(&mut bytes.as_slice()).unwrap(), original);
        }
    }

    #[test]
    fn preserves_u128_weights_and_rejects_corruption() {
        let mut value = JointScores::default();
        value.add(7, 3, u128::from(u64::MAX) + 99).unwrap();
        let mut bytes = Vec::new();
        value.write(&mut bytes).unwrap();
        assert_eq!(JointScores::read(&mut bytes.as_slice()).unwrap(), value);
        assert!(JointScores::read(&mut &bytes[..bytes.len() - 1]).is_err());
        assert!(JointScores::read(&mut u32::MAX.to_le_bytes().as_slice()).is_err());
    }

    #[test]
    fn model13215_board_matrix_distinguishes_equal_mean_distributions() {
        use crate::board_matrix::{BoardMatrixSeam, BoardWinMatrix};
        let board = BoardWinMatrix::load(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/board-win-matrix.bin"),
        )
        .unwrap();
        let mut correlated = JointScores::default();
        correlated.add(0, 0, 1).unwrap();
        correlated.add(4, 4, 1).unwrap();
        let mut anticorrelated = JointScores::default();
        anticorrelated.add(0, 4, 1).unwrap();
        anticorrelated.add(4, 0, 1).unwrap();
        let wp = |distribution: &JointScores| {
            let total = distribution.moments().unwrap()[2] as f64;
            distribution
                .bins()
                .map(|(own, opponent, weight)| {
                    board.dealer_win_probability(
                        BoardMatrixSeam::AfterPegging,
                        100 + own,
                        111 + opponent,
                    ) * weight as f64
                        / total
                })
                .sum::<f64>()
        };
        assert_eq!(correlated.moments(), anticorrelated.moments());
        assert!((wp(&correlated) - 0.17044501324344652).abs() < 1e-12);
        assert!((wp(&anticorrelated) - 0.21785388603677494).abs() < 1e-12);
    }
}
