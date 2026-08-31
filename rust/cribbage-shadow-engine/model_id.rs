use std::fmt;
use std::str::FromStr;

pub const MODEL_9_0: &str = "schell_table-peg_table-9.0";
pub const MODEL_9_1: &str = "schell_table-peg_table-9.1";
pub const MODEL_13_0: &str = "schell_table-peg_table-13.0";
/// Model 13.1 retains Model 13.0's board-aware discard objective, lead
/// selection, and live pegging while substituting the Model 13.1 histogram
/// only for the discard-time pegging distribution.
pub const MODEL_13_1: &str = "schell_table-peg_table-13.1";
/// Model 13.2 is a controlled Model 13.0 discard-forecast ablation. It keeps
/// every live decision path frozen at 13.0 and substitutes only the reusable
/// keep-pair pegging asset used while evaluating discards.
pub const MODEL_13_2: &str = "schell_table-peg_table-13.2";
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
/// Five-sample Myrmidon agent from the Moulton cribbage RL framework. Strong
/// Cribbage exposes it as the Easy opponent and also retains it for benchmarks.
pub const MYRMIDON_5: &str = "myrmidon-5";

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ModelId {
    Schell90,
    Schell91,
    Schell13,
    Schell131,
    Schell132,
    Schell143,
    Schell148,
    Schell1481,
    Schell150,
    Schell151,
    Schell152,
    Schell160,
    Schell161,
    Schell163,
    Myrmidon5,
}

impl ModelId {
    pub fn as_str(self) -> &'static str {
        match self {
            ModelId::Schell90 => MODEL_9_0,
            ModelId::Schell91 => MODEL_9_1,
            ModelId::Schell13 => MODEL_13_0,
            ModelId::Schell131 => MODEL_13_1,
            ModelId::Schell132 => MODEL_13_2,
            ModelId::Schell143 => MODEL_14_3,
            ModelId::Schell148 => MODEL_14_8,
            ModelId::Schell1481 => MODEL_14_8_1,
            ModelId::Schell150 => MODEL_15_0,
            ModelId::Schell151 => MODEL_15_1,
            ModelId::Schell152 => MODEL_15_2,
            ModelId::Schell160 => MODEL_16_0,
            ModelId::Schell161 => MODEL_16_1,
            ModelId::Schell163 => MODEL_16_3,
            ModelId::Myrmidon5 => MYRMIDON_5,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ModelId::Schell90 => "Schell Table + Peg Table 9.0",
            ModelId::Schell91 => "Schell Table + Peg Table 9.1",
            ModelId::Schell13 => "Schell Table + Peg Table 13.0",
            ModelId::Schell131 => "Schell Table + Peg Table 13.1",
            ModelId::Schell132 => "Schell Table + Peg Table 13.2",
            ModelId::Schell143 => "Schell Table + Peg Table 14.3",
            ModelId::Schell148 => "Schell Table + Peg Table 14.8",
            ModelId::Schell1481 => "Schell Table + Peg Table 14.8.1",
            ModelId::Schell150 => "Schell Table + Peg Table 15.0",
            ModelId::Schell151 => "Schell Table + Peg Table 15.1",
            ModelId::Schell152 => "Schell Table + Peg Table 15.2",
            ModelId::Schell160 => "Schell Table + Peg Table 16.0",
            ModelId::Schell161 => "Schell Table + Peg Table 16.1",
            ModelId::Schell163 => "Schell Table + Peg Table 16.3",
            ModelId::Myrmidon5 => "Myrmidon (5 simulations)",
        }
    }

    pub fn has_native_rust_decisions(self) -> bool {
        matches!(
            self,
            ModelId::Schell90
                | ModelId::Schell91
                | ModelId::Schell13
                | ModelId::Schell131
                | ModelId::Schell132
                | ModelId::Schell143
                | ModelId::Schell148
                | ModelId::Schell1481
                | ModelId::Schell150
                | ModelId::Schell151
                | ModelId::Schell152
                | ModelId::Schell160
                | ModelId::Schell161
                | ModelId::Schell163
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
            MODEL_13_0 => Ok(ModelId::Schell13),
            MODEL_13_1 => Ok(ModelId::Schell131),
            MODEL_13_2 => Ok(ModelId::Schell132),
            MODEL_14_3 => Ok(ModelId::Schell143),
            MODEL_14_8 => Ok(ModelId::Schell148),
            MODEL_14_8_1 => Ok(ModelId::Schell1481),
            MODEL_15_0 => Ok(ModelId::Schell150),
            MODEL_15_1 => Ok(ModelId::Schell151),
            MODEL_15_2 => Ok(ModelId::Schell152),
            MODEL_16_0 => Ok(ModelId::Schell160),
            MODEL_16_1 => Ok(ModelId::Schell161),
            MODEL_16_3 => Ok(ModelId::Schell163),
            MYRMIDON_5 => Ok(ModelId::Myrmidon5),
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
        assert_eq!(MODEL_13_0.parse::<ModelId>().unwrap(), ModelId::Schell13);
        assert_eq!(MODEL_13_1.parse::<ModelId>().unwrap(), ModelId::Schell131);
        assert!(ModelId::Schell131.has_native_rust_decisions());
        assert_eq!(MODEL_13_2.parse::<ModelId>().unwrap(), ModelId::Schell132);
        assert!(ModelId::Schell132.has_native_rust_decisions());
        assert!(!ModelId::Schell132.is_strength_model());
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
    }
}
