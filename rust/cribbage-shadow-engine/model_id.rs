use std::fmt;
use std::str::FromStr;

pub const MODEL_13_0: &str = "schell_table-peg_table-13.0";
pub const MODEL_14_3: &str = "schell_table-peg_table-14.3";
pub const MODEL_14_8: &str = "schell_table-peg_table-14.8";
pub const MODEL_14_8_1: &str = "schell_table-peg_table-14.8.1";
pub const MODEL_15_0: &str = "schell_table-peg_table-15.0";
pub const MODEL_15_1: &str = "schell_table-peg_table-15.1";
pub const MODEL_15_2: &str = "schell_table-peg_table-15.2";
pub const MODEL_16_0: &str = "schell_table-peg_table-16.0";

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ModelId {
    Schell13,
    Schell143,
    Schell148,
    Schell1481,
    Schell150,
    Schell151,
    Schell152,
    Schell160,
}

impl ModelId {
    pub fn as_str(self) -> &'static str {
        match self {
            ModelId::Schell13 => MODEL_13_0,
            ModelId::Schell143 => MODEL_14_3,
            ModelId::Schell148 => MODEL_14_8,
            ModelId::Schell1481 => MODEL_14_8_1,
            ModelId::Schell150 => MODEL_15_0,
            ModelId::Schell151 => MODEL_15_1,
            ModelId::Schell152 => MODEL_15_2,
            ModelId::Schell160 => MODEL_16_0,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ModelId::Schell13 => "Schell Table + Peg Table 13.0",
            ModelId::Schell143 => "Schell Table + Peg Table 14.3",
            ModelId::Schell148 => "Schell Table + Peg Table 14.8",
            ModelId::Schell1481 => "Schell Table + Peg Table 14.8.1",
            ModelId::Schell150 => "Schell Table + Peg Table 15.0",
            ModelId::Schell151 => "Schell Table + Peg Table 15.1",
            ModelId::Schell152 => "Schell Table + Peg Table 15.2",
            ModelId::Schell160 => "Schell Table + Peg Table 16.0",
        }
    }

    pub fn has_native_rust_decisions(self) -> bool {
        matches!(
            self,
            ModelId::Schell13
                | ModelId::Schell143
                | ModelId::Schell148
                | ModelId::Schell1481
                | ModelId::Schell150
                | ModelId::Schell151
                | ModelId::Schell152
                | ModelId::Schell160
        )
    }

    pub fn is_strength_model(self) -> bool {
        matches!(
            self,
            ModelId::Schell150 | ModelId::Schell151 | ModelId::Schell152 | ModelId::Schell160
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
            MODEL_13_0 => Ok(ModelId::Schell13),
            MODEL_14_3 => Ok(ModelId::Schell143),
            MODEL_14_8 => Ok(ModelId::Schell148),
            MODEL_14_8_1 => Ok(ModelId::Schell1481),
            MODEL_15_0 => Ok(ModelId::Schell150),
            MODEL_15_1 => Ok(ModelId::Schell151),
            MODEL_15_2 => Ok(ModelId::Schell152),
            MODEL_16_0 => Ok(ModelId::Schell160),
            other => Err(format!("unsupported model id: {}", other)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_model_ids() {
        assert_eq!(MODEL_13_0.parse::<ModelId>().unwrap(), ModelId::Schell13);
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
        assert!(ModelId::Schell13.has_native_rust_decisions());
        assert_eq!(MODEL_15_1.parse::<ModelId>().unwrap().as_str(), MODEL_15_1);
        assert_eq!(MODEL_15_2.parse::<ModelId>().unwrap().as_str(), MODEL_15_2);
        assert_eq!(MODEL_16_0.parse::<ModelId>().unwrap().as_str(), MODEL_16_0);
    }
}
