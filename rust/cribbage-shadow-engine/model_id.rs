use std::fmt;
use std::str::FromStr;

pub const MODEL_13_0: &str = "schell_table-peg_table-13.0";
pub const MODEL_14_8: &str = "schell_table-peg_table-14.8";
pub const MODEL_14_8_1: &str = "schell_table-peg_table-14.8.1";
pub const MODEL_15_0: &str = "schell_table-peg_table-15.0";

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ModelId {
    Schell13,
    Schell148,
    Schell1481,
    Schell150,
}

impl ModelId {
    pub fn as_str(self) -> &'static str {
        match self {
            ModelId::Schell13 => MODEL_13_0,
            ModelId::Schell148 => MODEL_14_8,
            ModelId::Schell1481 => MODEL_14_8_1,
            ModelId::Schell150 => MODEL_15_0,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ModelId::Schell13 => "Schell Table + Peg Table 13.0",
            ModelId::Schell148 => "Schell Table + Peg Table 14.8",
            ModelId::Schell1481 => "Schell Table + Peg Table 14.8.1",
            ModelId::Schell150 => "Schell Table + Peg Table 15.0",
        }
    }

    pub fn has_native_rust_decisions(self) -> bool {
        matches!(self, ModelId::Schell148 | ModelId::Schell1481 | ModelId::Schell150)
    }

    pub fn is_strength_model(self) -> bool {
        matches!(self, ModelId::Schell150)
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
            MODEL_14_8 => Ok(ModelId::Schell148),
            MODEL_14_8_1 => Ok(ModelId::Schell1481),
            MODEL_15_0 => Ok(ModelId::Schell150),
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
        assert_eq!(MODEL_14_8_1.parse::<ModelId>().unwrap().as_str(), MODEL_14_8_1);
        assert!(ModelId::Schell150.has_native_rust_decisions());
        assert!(!ModelId::Schell13.has_native_rust_decisions());
    }
}
