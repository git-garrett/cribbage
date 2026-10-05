use std::fmt;
use std::str::FromStr;

pub const MODEL_9_0: &str = "schell_table-peg_table-9.0";
pub const MODEL_9_1: &str = "schell_table-peg_table-9.1";
/// Model 9.11 retains Model 9.1's rank-only hand/crib objective and
/// average-continuation evaluator, but rebuilds the discard forecast with the
/// evidence-aware 9.11 keep-pair asset and uses that same executable policy
/// for live pegging.
pub const MODEL_9_11: &str = "schell_table-peg_table-9.11";
pub const MODEL_13_0: &str = "schell_table-peg_table-13.0";
/// Model 13.1 retains Model 13.0's board-aware discard objective, lead
/// selection, and live pegging while substituting the Model 13.1 histogram
/// only for the discard-time pegging distribution.
pub const MODEL_13_1: &str = "schell_table-peg_table-13.1";
/// Model 13.2 is a controlled Model 13.0 discard-forecast ablation. It keeps
/// every live decision path frozen at 13.0 and substitutes only the reusable
/// keep-pair pegging asset used while evaluating discards.
pub const MODEL_13_2: &str = "schell_table-peg_table-13.2";
/// Model 13.21 isolates the pone opening-lead forecast mismatch found in
/// Model 13.2. Dealer discards retain the 13.2 keep-pair forecast, while pone
/// discards and every live decision remain frozen at Model 13.0.
pub const MODEL_13_21: &str = "schell_table-peg_table-13.21";
/// Model 13.215 keeps Model 13.0's discard, current-hand scoring, and live
/// pegging machinery, while replacing its pre-90 heuristic and post-90 future
/// board recursion with empirical phase-seam board matrices. Known and
/// predicted current-hand scores are applied before the continuation lookup.
pub const MODEL_13_215: &str = "schell_table-peg_table-13.215";
/// Model 13.22 uses the completed six-card/discard sparse-correction asset for
/// discard forecasts and opening leads, then continues with the same
/// legal-information executable pegging policy used to build that asset.
pub const MODEL_13_22: &str = "schell_table-peg_table-13.22";
/// Joint correction distributions and legal-information continuation forecasts,
/// selected by actual-board WP using the verified Model 13.215 matrix.
pub const MODEL_13_23: &str = "schell_table-peg_table-13.23";
/// Current production Ace model. Keep the versioned model ID available so
/// existing games can retain the exact engine they started with.
pub const ACE_MODEL: &str = MODEL_28_3_FAST;
pub const MODEL_14_3: &str = "schell_table-peg_table-14.3";
pub const MODEL_14_8: &str = "schell_table-peg_table-14.8";
pub const MODEL_14_8_1: &str = "schell_table-peg_table-14.8.1";
pub const MODEL_15_0: &str = "schell_table-peg_table-15.0";
pub const MODEL_15_1: &str = "schell_table-peg_table-15.1";
pub const MODEL_15_2: &str = "schell_table-peg_table-15.2";
pub const MODEL_16_0: &str = "schell_table-peg_table-16.0";
/// Model 16.1 keeps the 16.0 learned pegging policy but delegates policy
/// misses to the frozen Model 13 pegging evaluator.
pub const MODEL_16_1: &str = "schell_table-peg_table-16.1";
/// Model 16.3 is the compact public-information scorer, with frozen Model 13
/// as its final fallback. It deliberately has no exact-policy lookup table.
pub const MODEL_16_3: &str = "schell_table-peg_table-16.3";
/// Model 20.0 adds conditioned beliefs and suit-aware show forecasts to Ace 13.23.
/// Keep this experimental identity separate from the production Ace alias.
pub const MODEL_20_0: &str = "schell_table-peg_table-20.0";
/// Model 20.1 uses WP-selected live continuation moves for both actors.
pub const MODEL_20_1: &str = "schell_table-peg_table-20.1";
/// Model 20.2 retains 20.1 continuation semantics with a rebuilt board matrix.
pub const MODEL_20_2: &str = "schell_table-peg_table-20.2";
/// Model 20.3 adds complete, smoothed shared opponent-hand beliefs to 20.2.
pub const MODEL_20_3: &str = "schell_table-peg_table-20.3";
/// Model 20.4 retains 20.3 assets and adds the optimizations developed after
/// the 2026-09-28 speed-v4 benchmark restart (frozen commit 567ff4f).
pub const MODEL_20_4: &str = "schell_table-peg_table-20.4";
/// Frozen Model 20.5 optimization baseline, retaining 20.4 learning assets.
pub const MODEL_20_5: &str = "schell_table-peg_table-20.5";
/// Model 20.6 retains 20.5 policy and assets, with exact root utility bounds.
pub const MODEL_20_6: &str = "schell_table-peg_table-20.6";
/// Model 20.7 retains 20.6 policy and assets, avoiding a legal-rank count allocation.
pub const MODEL_20_7: &str = "schell_table-peg_table-20.7";
/// Experimental score-block backward policy; 20.7 discard and root valuation.
pub const MODEL_28_3: &str = "schell_table-peg_table-28.3";
/// Exact optional opening assets; uncovered decisions use ordinary 28.3.
pub const MODEL_28_3_FAST: &str = "schell_table-peg_table-28.3.fast";
/// Experimental posterior-weighted strategic pegging; 20.5 discard assets stay fixed.
pub const MODEL_20_5_PEGGING: &str = "schell_table-peg_table-20.5.pegging";
/// Symmetric backward bucket policy: both actors use their own smoothed posterior.
pub const MODEL_20_5_PEGGING2: &str = "schell_table-peg_table-20.5.pegging2";
/// Five-sample Myrmidon agent from the Moulton cribbage RL framework. Strong
/// Cribbage exposes it as the Easy opponent and also retains it for benchmarks.
pub const MYRMIDON_5: &str = "myrmidon-5";
/// Server-side adaptive opponent which delegates each complete two-hand cycle
/// to Easy, Tough, or Ace. Dynamic itself is not a decision engine.
pub const DYNAMIC: &str = "dynamic";

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ModelId {
    Schell90,
    Schell91,
    Schell911,
    Schell13,
    Schell131,
    Schell132,
    Schell1321,
    Schell13215,
    Schell1322,
    Schell1323,
    Schell143,
    Schell148,
    Schell1481,
    Schell150,
    Schell151,
    Schell152,
    Schell160,
    Schell161,
    Schell163,
    Schell200,
    Schell201,
    Schell202,
    Schell203,
    Schell204,
    Schell205,
    Schell206,
    Schell207,
    Schell283,
    Schell283Fast,
    Schell205Pegging,
    Schell205Pegging2,
    Myrmidon5,
    Dynamic,
}

pub const ACE_MODEL_ID: ModelId = ModelId::Schell283Fast;

impl ModelId {
    pub fn as_str(self) -> &'static str {
        match self {
            ModelId::Schell90 => MODEL_9_0,
            ModelId::Schell91 => MODEL_9_1,
            ModelId::Schell911 => MODEL_9_11,
            ModelId::Schell13 => MODEL_13_0,
            ModelId::Schell131 => MODEL_13_1,
            ModelId::Schell132 => MODEL_13_2,
            ModelId::Schell1321 => MODEL_13_21,
            ModelId::Schell13215 => MODEL_13_215,
            ModelId::Schell1322 => MODEL_13_22,
            ModelId::Schell1323 => MODEL_13_23,
            ModelId::Schell143 => MODEL_14_3,
            ModelId::Schell148 => MODEL_14_8,
            ModelId::Schell1481 => MODEL_14_8_1,
            ModelId::Schell150 => MODEL_15_0,
            ModelId::Schell151 => MODEL_15_1,
            ModelId::Schell152 => MODEL_15_2,
            ModelId::Schell160 => MODEL_16_0,
            ModelId::Schell161 => MODEL_16_1,
            ModelId::Schell163 => MODEL_16_3,
            ModelId::Schell200 => MODEL_20_0,
            ModelId::Schell201 => MODEL_20_1,
            ModelId::Schell202 => MODEL_20_2,
            ModelId::Schell203 => MODEL_20_3,
            ModelId::Schell204 => MODEL_20_4,
            ModelId::Schell205 => MODEL_20_5,
            ModelId::Schell206 => MODEL_20_6,
            ModelId::Schell207 => MODEL_20_7,
            ModelId::Schell283 => MODEL_28_3,
            ModelId::Schell283Fast => MODEL_28_3_FAST,
            ModelId::Schell205Pegging => MODEL_20_5_PEGGING,
            ModelId::Schell205Pegging2 => MODEL_20_5_PEGGING2,
            ModelId::Myrmidon5 => MYRMIDON_5,
            ModelId::Dynamic => DYNAMIC,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ModelId::Schell90 => "Schell Table + Peg Table 9.0",
            ModelId::Schell91 => "Schell Table + Peg Table 9.1",
            ModelId::Schell911 => "Schell Table + Peg Table 9.11",
            ModelId::Schell13 => "Schell Table + Peg Table 13.0",
            ModelId::Schell131 => "Schell Table + Peg Table 13.1",
            ModelId::Schell132 => "Schell Table + Peg Table 13.2",
            ModelId::Schell1321 => "Schell Table + Peg Table 13.21",
            ModelId::Schell13215 => "Schell Table + Peg Table 13.215",
            ModelId::Schell1322 => "Schell Table + Peg Table 13.22",
            ModelId::Schell1323 => "Schell Table + Peg Table 13.23",
            ModelId::Schell143 => "Schell Table + Peg Table 14.3",
            ModelId::Schell148 => "Schell Table + Peg Table 14.8",
            ModelId::Schell1481 => "Schell Table + Peg Table 14.8.1",
            ModelId::Schell150 => "Schell Table + Peg Table 15.0",
            ModelId::Schell151 => "Schell Table + Peg Table 15.1",
            ModelId::Schell152 => "Schell Table + Peg Table 15.2",
            ModelId::Schell160 => "Schell Table + Peg Table 16.0",
            ModelId::Schell161 => "Schell Table + Peg Table 16.1",
            ModelId::Schell163 => "Schell Table + Peg Table 16.3",
            ModelId::Schell200 => "Schell Table + Peg Table 20.0",
            ModelId::Schell201 => "Schell Table + Peg Table 20.1",
            ModelId::Schell202 => "Schell Table + Peg Table 20.2",
            ModelId::Schell203 => "Schell Table + Peg Table 20.3",
            ModelId::Schell204 => "Schell Table + Peg Table 20.4",
            ModelId::Schell205 => "Schell Table + Peg Table 20.5",
            ModelId::Schell206 => "Schell Table + Peg Table 20.6",
            ModelId::Schell207 => "Schell Table + Peg Table 20.7",
            ModelId::Schell283 => "28.3 Score-block pegging (experimental)",
            ModelId::Schell283Fast => "28.3.fast Exact opening assets (experimental)",
            ModelId::Schell205Pegging => "20.5.pegging (experimental)",
            ModelId::Schell205Pegging2 => "20.5.pegging2 (experimental)",
            ModelId::Myrmidon5 => "Myrmidon (5 simulations)",
            ModelId::Dynamic => "Dynamic",
        }
    }

    pub fn has_native_rust_decisions(self) -> bool {
        matches!(
            self,
            ModelId::Schell90
                | ModelId::Schell91
                | ModelId::Schell911
                | ModelId::Schell13
                | ModelId::Schell131
                | ModelId::Schell132
                | ModelId::Schell1321
                | ModelId::Schell13215
                | ModelId::Schell1322
                | ModelId::Schell1323
                | ModelId::Schell143
                | ModelId::Schell148
                | ModelId::Schell1481
                | ModelId::Schell150
                | ModelId::Schell151
                | ModelId::Schell152
                | ModelId::Schell160
                | ModelId::Schell161
                | ModelId::Schell163
                | ModelId::Schell200
                | ModelId::Schell201
                | ModelId::Schell202
                | ModelId::Schell203
                | ModelId::Schell204
                | ModelId::Schell205
                | ModelId::Schell206
                | ModelId::Schell207
                | ModelId::Schell283
                | ModelId::Schell283Fast
                | ModelId::Schell205Pegging
                | ModelId::Schell205Pegging2
                | ModelId::Myrmidon5
        )
    }

    pub fn is_strength_model(self) -> bool {
        matches!(
            self,
            ModelId::Schell150
                | ModelId::Schell151
                | ModelId::Schell152
                | ModelId::Schell160
                | ModelId::Schell161
                | ModelId::Schell163
        )
    }

    pub fn is_ace(self) -> bool {
        matches!(self, ModelId::Schell13 | ModelId::Schell13215 | ModelId::Schell1323 | ModelId::Schell283 | ModelId::Schell283Fast)
    }
}

impl fmt::Display for ModelId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for ModelId {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            MODEL_9_0 => Ok(ModelId::Schell90),
            MODEL_9_1 => Ok(ModelId::Schell91),
            MODEL_9_11 => Ok(ModelId::Schell911),
            MODEL_13_0 => Ok(ModelId::Schell13),
            MODEL_13_1 => Ok(ModelId::Schell131),
            MODEL_13_2 => Ok(ModelId::Schell132),
            MODEL_13_21 => Ok(ModelId::Schell1321),
            MODEL_13_215 => Ok(ModelId::Schell13215),
            MODEL_13_22 => Ok(ModelId::Schell1322),
            MODEL_13_23 => Ok(ModelId::Schell1323),
            MODEL_14_3 => Ok(ModelId::Schell143),
            MODEL_14_8 => Ok(ModelId::Schell148),
            MODEL_14_8_1 => Ok(ModelId::Schell1481),
            MODEL_15_0 => Ok(ModelId::Schell150),
            MODEL_15_1 => Ok(ModelId::Schell151),
            MODEL_15_2 => Ok(ModelId::Schell152),
            MODEL_16_0 => Ok(ModelId::Schell160),
            MODEL_16_1 => Ok(ModelId::Schell161),
            MODEL_16_3 => Ok(ModelId::Schell163),
            MODEL_20_0 => Ok(ModelId::Schell200),
            MODEL_20_1 => Ok(ModelId::Schell201),
            MODEL_20_2 => Ok(ModelId::Schell202),
            MODEL_20_3 => Ok(ModelId::Schell203),
            MODEL_20_4 => Ok(ModelId::Schell204),
            MODEL_20_5 => Ok(ModelId::Schell205),
            MODEL_20_6 => Ok(ModelId::Schell206),
            MODEL_20_7 => Ok(ModelId::Schell207),
            MODEL_28_3 | "28.3" => Ok(ModelId::Schell283),
            MODEL_28_3_FAST | "28.3.fast" => Ok(ModelId::Schell283Fast),
            MODEL_20_5_PEGGING | "20.5.pegging" => Ok(ModelId::Schell205Pegging),
            MODEL_20_5_PEGGING2 | "20.5.pegging2" => Ok(ModelId::Schell205Pegging2),
            MYRMIDON_5 => Ok(ModelId::Myrmidon5),
            DYNAMIC => Ok(ModelId::Dynamic),
            other => Err(format!("unsupported model id: {}", other)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_model_ids() {
        assert_eq!(MODEL_9_0.parse::<ModelId>().unwrap(), ModelId::Schell90);
        assert!(ModelId::Schell90.has_native_rust_decisions());
        assert!(!ModelId::Schell90.is_strength_model());
        assert_eq!(MODEL_9_1.parse::<ModelId>().unwrap(), ModelId::Schell91);
        assert!(ModelId::Schell91.has_native_rust_decisions());
        assert!(!ModelId::Schell91.is_strength_model());
        assert_eq!(MODEL_9_11.parse::<ModelId>().unwrap(), ModelId::Schell911);
        assert!(ModelId::Schell911.has_native_rust_decisions());
        assert!(!ModelId::Schell911.is_strength_model());
        assert_eq!(MODEL_13_0.parse::<ModelId>().unwrap(), ModelId::Schell13);
        assert_eq!(MODEL_13_1.parse::<ModelId>().unwrap(), ModelId::Schell131);
        assert!(ModelId::Schell131.has_native_rust_decisions());
        assert_eq!(MODEL_13_2.parse::<ModelId>().unwrap(), ModelId::Schell132);
        assert!(ModelId::Schell132.has_native_rust_decisions());
        assert!(!ModelId::Schell132.is_strength_model());
        assert_eq!(MODEL_13_21.parse::<ModelId>().unwrap(), ModelId::Schell1321);
        assert!(ModelId::Schell1321.has_native_rust_decisions());
        assert!(!ModelId::Schell1321.is_strength_model());
        assert_eq!(
            MODEL_13_215.parse::<ModelId>().unwrap(),
            ModelId::Schell13215
        );
        assert!(ModelId::Schell13215.has_native_rust_decisions());
        assert!(!ModelId::Schell13215.is_strength_model());
        assert_eq!(MODEL_13_22.parse::<ModelId>().unwrap(), ModelId::Schell1322);
        assert!(ModelId::Schell1322.has_native_rust_decisions());
        assert!(!ModelId::Schell1322.is_strength_model());
        assert_eq!(MODEL_13_23.parse::<ModelId>().unwrap(), ModelId::Schell1323);
        assert!(ModelId::Schell1323.has_native_rust_decisions());
        assert!(ModelId::Schell1323.is_ace());
        assert_eq!(MODEL_20_0.parse::<ModelId>().unwrap(), ModelId::Schell200);
        assert_eq!(MODEL_20_1.parse::<ModelId>().unwrap(), ModelId::Schell201);
        assert!(ModelId::Schell201.has_native_rust_decisions());
        assert_eq!(MODEL_20_2.parse::<ModelId>().unwrap(), ModelId::Schell202);
        assert_eq!(MODEL_20_4.parse::<ModelId>().unwrap(), ModelId::Schell204);
        assert_eq!(MODEL_20_5.parse::<ModelId>().unwrap(), ModelId::Schell205);
        assert_eq!(MODEL_20_6.parse::<ModelId>().unwrap(), ModelId::Schell206);
        assert_eq!(ModelId::Schell206.as_str(), MODEL_20_6);
        assert!(ModelId::Schell206.has_native_rust_decisions());
        assert!(!ModelId::Schell206.is_ace());
        assert_eq!(MODEL_28_3.parse::<ModelId>().unwrap(), ModelId::Schell283);
        assert_eq!("28.3".parse::<ModelId>().unwrap().as_str(), MODEL_28_3);
        assert!(ModelId::Schell283.has_native_rust_decisions());
        assert!(ModelId::Schell283.is_ace());
        assert_eq!("28.3.fast".parse::<ModelId>().unwrap().as_str(), MODEL_28_3_FAST);
        assert!(ModelId::Schell283Fast.has_native_rust_decisions());
        assert!(ModelId::Schell283Fast.is_ace());
        assert_eq!(MODEL_20_7.parse::<ModelId>().unwrap(), ModelId::Schell207);
        assert_eq!(ModelId::Schell207.as_str(), MODEL_20_7);
        assert!(ModelId::Schell207.has_native_rust_decisions());
        assert!(!ModelId::Schell207.is_ace());
        assert_eq!(MODEL_20_5_PEGGING.parse::<ModelId>().unwrap(), ModelId::Schell205Pegging);
        assert_eq!("20.5.pegging".parse::<ModelId>().unwrap(), ModelId::Schell205Pegging);
        assert_eq!(ModelId::Schell205Pegging.as_str(), MODEL_20_5_PEGGING);
        assert!(ModelId::Schell205Pegging.has_native_rust_decisions());
        assert!(!ModelId::Schell205Pegging.is_ace());
        assert_eq!(MODEL_20_5_PEGGING2.parse::<ModelId>().unwrap(), ModelId::Schell205Pegging2);
        assert_eq!("20.5.pegging2".parse::<ModelId>().unwrap(), ModelId::Schell205Pegging2);
        assert_eq!(ModelId::Schell205Pegging2.as_str(), MODEL_20_5_PEGGING2);
        assert!(ModelId::Schell205Pegging2.has_native_rust_decisions());
        assert!(!ModelId::Schell205Pegging2.is_ace());
        assert_eq!(ModelId::Schell204.as_str(), MODEL_20_4);
        assert_eq!(ModelId::Schell205.as_str(), MODEL_20_5);
        assert!(ModelId::Schell204.has_native_rust_decisions());
        assert!(ModelId::Schell205.has_native_rust_decisions());
        assert!(!ModelId::Schell204.is_ace());
        assert!(!ModelId::Schell205.is_ace());
        assert_eq!(MODEL_20_3.parse::<ModelId>().unwrap(), ModelId::Schell203);
        assert_eq!(ModelId::Schell203.as_str(), MODEL_20_3);
        assert!(ModelId::Schell203.has_native_rust_decisions());
        assert!(!ModelId::Schell203.is_ace());
        assert_eq!(ModelId::Schell202.as_str(), MODEL_20_2);
        assert!(ModelId::Schell202.has_native_rust_decisions());
        assert!(!ModelId::Schell202.is_ace());
        assert!(!ModelId::Schell201.is_ace());
        assert_eq!(ModelId::Schell200.as_str(), MODEL_20_0);
        assert!(ModelId::Schell200.has_native_rust_decisions());
        assert!(!ModelId::Schell200.is_strength_model());
        assert!(!ModelId::Schell200.is_ace());
        assert_ne!(ModelId::Schell200, ACE_MODEL_ID);
        assert_eq!(ACE_MODEL_ID.as_str(), ACE_MODEL);
        assert!(ACE_MODEL_ID.is_ace());
        assert!(ModelId::Schell13.is_ace());
        assert!(!ModelId::Schell911.is_ace());
        assert_eq!(MODEL_14_3.parse::<ModelId>().unwrap(), ModelId::Schell143);
        assert_eq!(
            MODEL_14_8_1.parse::<ModelId>().unwrap().as_str(),
            MODEL_14_8_1
        );
        assert!(ModelId::Schell150.has_native_rust_decisions());
        assert!(ModelId::Schell151.has_native_rust_decisions());
        assert!(ModelId::Schell152.has_native_rust_decisions());
        assert!(ModelId::Schell160.has_native_rust_decisions());
        assert!(ModelId::Schell160.is_strength_model());
        assert!(ModelId::Schell161.has_native_rust_decisions());
        assert!(ModelId::Schell161.is_strength_model());
        assert!(ModelId::Schell163.has_native_rust_decisions());
        assert!(ModelId::Schell163.is_strength_model());
        assert!(ModelId::Schell13.has_native_rust_decisions());
        assert_eq!(MODEL_15_1.parse::<ModelId>().unwrap().as_str(), MODEL_15_1);
        assert_eq!(MODEL_15_2.parse::<ModelId>().unwrap().as_str(), MODEL_15_2);
        assert_eq!(MODEL_16_0.parse::<ModelId>().unwrap().as_str(), MODEL_16_0);
        assert_eq!(MODEL_16_1.parse::<ModelId>().unwrap().as_str(), MODEL_16_1);
        assert_eq!(MODEL_16_3.parse::<ModelId>().unwrap().as_str(), MODEL_16_3);
        assert_eq!(MYRMIDON_5.parse::<ModelId>().unwrap(), ModelId::Myrmidon5);
        assert!(ModelId::Myrmidon5.has_native_rust_decisions());
        assert!(!ModelId::Myrmidon5.is_strength_model());
        assert_eq!(DYNAMIC.parse::<ModelId>().unwrap(), ModelId::Dynamic);
        assert_eq!(ModelId::Dynamic.as_str(), DYNAMIC);
        assert!(!ModelId::Dynamic.has_native_rust_decisions());
        assert!(!ModelId::Dynamic.is_strength_model());
    }
}
