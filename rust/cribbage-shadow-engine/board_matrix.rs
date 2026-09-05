use std::fs;
use std::path::Path;

pub const BOARD_MATRIX_SCORE_COUNT: usize = 121;
const BOARD_MATRIX_MAGIC: &[u8; 4] = b"BWM2";
const BOARD_MATRIX_VERSION: u32 = 2;
const HEADER_BYTES: usize = 16;
const SEAM_COUNT: usize = 4;
const CELLS_PER_SEAM: usize = BOARD_MATRIX_SCORE_COUNT * BOARD_MATRIX_SCORE_COUNT;
const CELL_COUNT: usize = SEAM_COUNT * CELLS_PER_SEAM;
const FILE_BYTES: usize = HEADER_BYTES + (CELL_COUNT * 8);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(usize)]
pub enum BoardMatrixSeam {
    Discard = 0,
    AfterDiscard = 1,
    AfterPegging = 2,
    AfterPone = 3,
}

/// Win probabilities at four phase seams, indexed by the dealer and pone
/// scores in the hand containing the seam. The compact artifact is read once
/// and kept in RAM by the runtime table cache.
pub struct BoardWinMatrix {
    probabilities: Box<[f64]>,
}

impl BoardWinMatrix {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let bytes =
            fs::read(path).map_err(|error| format!("read {} failed: {}", path.display(), error))?;
        Self::decode(&bytes).map_err(|error| format!("invalid {}: {}", path.display(), error))
    }

    fn decode(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() != FILE_BYTES {
            return Err(format!(
                "expected {} bytes, found {}",
                FILE_BYTES,
                bytes.len()
            ));
        }
        if &bytes[..4] != BOARD_MATRIX_MAGIC {
            return Err("wrong magic; expected BWM2".to_string());
        }
        let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        if version != BOARD_MATRIX_VERSION {
            return Err(format!("unsupported version {}", version));
        }
        let score_count = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        if score_count != BOARD_MATRIX_SCORE_COUNT {
            return Err(format!(
                "expected {} scores per axis, found {}",
                BOARD_MATRIX_SCORE_COUNT, score_count
            ));
        }
        let seam_count = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
        if seam_count != SEAM_COUNT {
            return Err(format!(
                "expected {} seams, found {}",
                SEAM_COUNT, seam_count
            ));
        }

        let mut probabilities = Vec::with_capacity(CELL_COUNT);
        for chunk in bytes[HEADER_BYTES..].chunks_exact(8) {
            let probability = f64::from_le_bytes(chunk.try_into().unwrap());
            if !probability.is_finite() || !(0.0..=1.0).contains(&probability) {
                return Err(format!("probability outside [0, 1]: {}", probability));
            }
            probabilities.push(probability);
        }
        Ok(Self {
            probabilities: probabilities.into_boxed_slice(),
        })
    }

    pub fn dealer_win_probability(
        &self,
        seam: BoardMatrixSeam,
        dealer_score: u8,
        pone_score: u8,
    ) -> f64 {
        debug_assert!((dealer_score as usize) < BOARD_MATRIX_SCORE_COUNT);
        debug_assert!((pone_score as usize) < BOARD_MATRIX_SCORE_COUNT);
        self.probabilities[(seam as usize * CELLS_PER_SEAM)
            + (dealer_score as usize * BOARD_MATRIX_SCORE_COUNT)
            + pone_score as usize]
    }

    #[cfg(test)]
    pub(crate) fn from_function(function: impl Fn(BoardMatrixSeam, u8, u8) -> f64) -> Self {
        let mut probabilities = Vec::with_capacity(CELL_COUNT);
        for seam in [
            BoardMatrixSeam::Discard,
            BoardMatrixSeam::AfterDiscard,
            BoardMatrixSeam::AfterPegging,
            BoardMatrixSeam::AfterPone,
        ] {
            for dealer_score in 0..BOARD_MATRIX_SCORE_COUNT as u8 {
                for pone_score in 0..BOARD_MATRIX_SCORE_COUNT as u8 {
                    probabilities.push(function(seam, dealer_score, pone_score));
                }
            }
        }
        Self {
            probabilities: probabilities.into_boxed_slice(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded_matrix(value: f64) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(FILE_BYTES);
        bytes.extend_from_slice(BOARD_MATRIX_MAGIC);
        bytes.extend_from_slice(&BOARD_MATRIX_VERSION.to_le_bytes());
        bytes.extend_from_slice(&(BOARD_MATRIX_SCORE_COUNT as u32).to_le_bytes());
        bytes.extend_from_slice(&(SEAM_COUNT as u32).to_le_bytes());
        for _ in 0..CELL_COUNT {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn decodes_compact_matrix() {
        let mut bytes = encoded_matrix(0.625);
        let after_pegging_first_cell =
            HEADER_BYTES + (BoardMatrixSeam::AfterPegging as usize * CELLS_PER_SEAM * 8);
        bytes[after_pegging_first_cell..after_pegging_first_cell + 8]
            .copy_from_slice(&0.75_f64.to_le_bytes());
        let matrix = BoardWinMatrix::decode(&bytes).unwrap();
        assert_eq!(
            matrix.dealer_win_probability(BoardMatrixSeam::Discard, 0, 0),
            0.625
        );
        assert_eq!(
            matrix.dealer_win_probability(BoardMatrixSeam::AfterPone, 120, 120),
            0.625
        );
        assert_eq!(
            matrix.dealer_win_probability(BoardMatrixSeam::AfterPegging, 0, 0),
            0.75
        );
    }

    #[test]
    fn rejects_invalid_probability() {
        let mut bytes = encoded_matrix(0.5);
        bytes[HEADER_BYTES..HEADER_BYTES + 8].copy_from_slice(&f64::NAN.to_le_bytes());
        assert!(BoardWinMatrix::decode(&bytes).is_err());
    }
}
