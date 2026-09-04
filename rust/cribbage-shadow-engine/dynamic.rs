//! Player-level, role-balanced strength adaptation for the Dynamic opponent.
//!
//! Dynamic delegates play through the normal executable policies. This module
//! stores only aggregate Ace-reviewed decision quality; it never stores an
//! observation-to-action table or a pegging path graph.

use crate::game::Side;
use crate::model_id::{ModelId, MODEL_13_0};
use serde::{Deserialize, Serialize};

pub const DYNAMIC_PROFILE_VERSION: u8 = 2;
pub const DYNAMIC_EVALUATOR_VERSION: &str = MODEL_13_0;
pub const MIN_COMPLETE_CYCLES: u32 = 6;
pub const MOVING_AVERAGE_HALF_LIFE_CYCLES: f64 = 18.0;
/// Half a tenth of a percentage point of win probability per decision.
pub const HANDICAP_DEADBAND: f64 = 0.0005;
pub const STRENGTH_STEP: u16 = 5;
pub const EASY_CALIBRATED_REGRET: f64 = 0.020;
pub const TOUGH_CALIBRATED_REGRET: f64 = 0.006;
pub const ACE_CALIBRATED_REGRET: f64 = 0.0;
const TOUGH_STRENGTH: u16 = 100;
const ACE_STRENGTH: u16 = 200;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct DynamicRegretBuckets {
    pub dealer_discard: f64,
    pub dealer_pegging: f64,
    pub pone_discard: f64,
    pub pone_pegging: f64,
}

impl DynamicRegretBuckets {
    fn mean(self) -> f64 {
        (self.dealer_discard + self.dealer_pegging + self.pone_discard + self.pone_pegging) / 4.0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct DynamicCycleSample {
    pub dealer_discard_regret: f64,
    pub dealer_pegging_regret: f64,
    pub pone_discard_regret: f64,
    pub pone_pegging_regret: f64,
}

impl DynamicCycleSample {
    fn buckets(self) -> DynamicRegretBuckets {
        DynamicRegretBuckets {
            dealer_discard: self.dealer_discard_regret,
            dealer_pegging: self.dealer_pegging_regret,
            pone_discard: self.pone_discard_regret,
            pone_pegging: self.pone_pegging_regret,
        }
    }

    pub fn handicap(self) -> f64 {
        -self.buckets().mean()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DynamicProfile {
    #[serde(default)]
    pub profile_version: u8,
    #[serde(default)]
    pub evaluator_version: String,
    /// Whether the player has actually taken a seat against Dynamic. Other
    /// Ace-reviewed games may calibrate this profile without setting it.
    #[serde(default)]
    pub started_dynamic: bool,
    pub complete_cycles: u32,
    #[serde(default)]
    pub regret: DynamicRegretBuckets,
    /// Moving average of user WP minus Ace WP, balanced equally across roles
    /// and decision types. Negative values are the user's WP handicap to Ace.
    #[serde(default)]
    pub ewma_handicap: f64,
    /// 0 = Easy, 100 = Tough, 200 = Ace, with probabilistic blends between.
    pub strength: u16,
}

impl Default for DynamicProfile {
    fn default() -> Self {
        Self {
            profile_version: DYNAMIC_PROFILE_VERSION,
            evaluator_version: DYNAMIC_EVALUATOR_VERSION.to_string(),
            started_dynamic: false,
            complete_cycles: 0,
            regret: DynamicRegretBuckets::default(),
            ewma_handicap: 0.0,
            strength: 0,
        }
    }
}

impl DynamicProfile {
    pub fn is_current(&self) -> bool {
        self.profile_version == DYNAMIC_PROFILE_VERSION
            && self.evaluator_version == DYNAMIC_EVALUATOR_VERSION
    }

    pub fn observe_cycle(&mut self, sample: DynamicCycleSample) {
        if !self.is_current() {
            *self = Self::default();
        }
        let sample = sample.buckets();
        let alpha = 1.0 - 0.5_f64.powf(1.0 / MOVING_AVERAGE_HALF_LIFE_CYCLES);
        if self.complete_cycles == 0 {
            self.regret = sample;
        } else {
            self.regret.dealer_discard +=
                alpha * (sample.dealer_discard - self.regret.dealer_discard);
            self.regret.dealer_pegging +=
                alpha * (sample.dealer_pegging - self.regret.dealer_pegging);
            self.regret.pone_discard += alpha * (sample.pone_discard - self.regret.pone_discard);
            self.regret.pone_pegging += alpha * (sample.pone_pegging - self.regret.pone_pegging);
        }
        self.complete_cycles += 1;
        self.ewma_handicap = -self.regret.mean();

        if self.complete_cycles < MIN_COMPLETE_CYCLES {
            return;
        }
        let expected_regret = calibrated_regret_for_strength(self.strength);
        let observed_regret = self.regret.mean();
        if observed_regret + HANDICAP_DEADBAND < expected_regret {
            self.strength = self
                .strength
                .saturating_add(STRENGTH_STEP)
                .min(ACE_STRENGTH);
        } else if observed_regret > expected_regret + HANDICAP_DEADBAND {
            self.strength = self.strength.saturating_sub(STRENGTH_STEP);
        }
    }
}

fn calibrated_regret_for_strength(strength: u16) -> f64 {
    let strength = strength.min(ACE_STRENGTH);
    if strength <= TOUGH_STRENGTH {
        let fraction = f64::from(strength) / f64::from(TOUGH_STRENGTH);
        EASY_CALIBRATED_REGRET + fraction * (TOUGH_CALIBRATED_REGRET - EASY_CALIBRATED_REGRET)
    } else {
        let fraction = f64::from(strength - TOUGH_STRENGTH) / f64::from(TOUGH_STRENGTH);
        TOUGH_CALIBRATED_REGRET + fraction * (ACE_CALIBRATED_REGRET - TOUGH_CALIBRATED_REGRET)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
enum DynamicDelegate {
    Easy,
    Tough,
    Ace,
}

impl DynamicDelegate {
    fn model(self) -> ModelId {
        match self {
            Self::Easy => ModelId::Myrmidon5,
            Self::Tough => ModelId::Schell911,
            Self::Ace => ModelId::Schell13,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DynamicState {
    profile: DynamicProfile,
    #[serde(default)]
    first_completed_dealer: Option<Side>,
    #[serde(default)]
    delegate_cycles: u32,
    delegate: DynamicDelegate,
}

impl DynamicState {
    pub fn new(mut profile: DynamicProfile, selector_seed: u32, _scores: [i32; 2]) -> Self {
        if !profile.is_current() {
            profile = DynamicProfile::default();
        }
        let delegate = select_delegate(profile.strength, selector_seed, 0);
        Self {
            profile,
            first_completed_dealer: None,
            delegate_cycles: 0,
            delegate,
        }
    }

    pub fn profile(&self) -> &DynamicProfile {
        &self.profile
    }

    pub fn normalize_profile_version(&mut self, selector_seed: u32) {
        if !self.profile.is_current() {
            *self = Self::new(DynamicProfile::default(), selector_seed, [0, 0]);
        }
    }

    pub fn use_profile(&mut self, mut profile: DynamicProfile, _selector_seed: u32) {
        if !profile.is_current() {
            profile = DynamicProfile::default();
        }
        self.profile = profile;
    }

    pub fn decision_model(&self) -> ModelId {
        self.delegate.model()
    }

    /// Resamples the delegate only after a complete, role-balanced pair of
    /// hands. Score is deliberately not calibration evidence.
    pub fn complete_hand(&mut self, dealer: Side, _scores: [i32; 2], selector_seed: u32) -> bool {
        let Some(first_dealer) = self.first_completed_dealer else {
            self.first_completed_dealer = Some(dealer);
            return false;
        };

        if dealer == first_dealer {
            self.first_completed_dealer = None;
            return false;
        }

        self.first_completed_dealer = None;
        self.delegate_cycles += 1;
        self.delegate = select_delegate(self.profile.strength, selector_seed, self.delegate_cycles);
        true
    }
}

fn select_delegate(strength: u16, selector_seed: u32, cycles: u32) -> DynamicDelegate {
    let strength = strength.min(ACE_STRENGTH);
    if strength == 0 {
        return DynamicDelegate::Easy;
    }
    if strength == TOUGH_STRENGTH {
        return DynamicDelegate::Tough;
    }
    if strength == ACE_STRENGTH {
        return DynamicDelegate::Ace;
    }

    let sample = deterministic_unit_interval(selector_seed, cycles);
    if strength < TOUGH_STRENGTH {
        if sample < f64::from(strength) / f64::from(TOUGH_STRENGTH) {
            DynamicDelegate::Tough
        } else {
            DynamicDelegate::Easy
        }
    } else if sample < f64::from(strength - TOUGH_STRENGTH) / f64::from(TOUGH_STRENGTH) {
        DynamicDelegate::Ace
    } else {
        DynamicDelegate::Tough
    }
}

fn deterministic_unit_interval(selector_seed: u32, cycles: u32) -> f64 {
    let mut value =
        u64::from(selector_seed) ^ u64::from(cycles).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^= value >> 31;
    (value >> 11) as f64 / ((1_u64 << 53) as f64)
}
