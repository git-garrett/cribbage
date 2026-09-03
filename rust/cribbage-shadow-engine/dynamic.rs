//! Lightweight, cycle-balanced strength adaptation for the Dynamic opponent.
//!
//! This module chooses one existing executable model for a complete two-hand
//! cycle. It does not cache game observations or actions; each selected model
//! continues to make decisions from the legal information available at play
//! time.

use crate::game::Side;
use crate::model_id::ModelId;
use serde::{Deserialize, Serialize};

pub const MIN_COMPLETE_CYCLES: u32 = 6;
pub const MOVING_AVERAGE_HALF_LIFE_CYCLES: f64 = 18.0;
pub const MARGIN_DEADBAND: f64 = 1.0;
pub const STRENGTH_STEP: u16 = 5;
const TOUGH_STRENGTH: u16 = 100;
const ACE_STRENGTH: u16 = 200;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DynamicProfile {
    pub complete_cycles: u32,
    /// Human points minus Dynamic points per complete two-hand cycle.
    pub ewma_margin: f64,
    /// 0 = Easy, 100 = Tough, 200 = Ace, with probabilistic blends between.
    pub strength: u16,
}

impl Default for DynamicProfile {
    fn default() -> Self {
        Self {
            complete_cycles: 0,
            ewma_margin: 0.0,
            strength: 0,
        }
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
    cycle_start_scores: [i32; 2],
    first_completed_dealer: Option<Side>,
    delegate: DynamicDelegate,
}

impl DynamicState {
    pub fn new(profile: DynamicProfile, selector_seed: u32, scores: [i32; 2]) -> Self {
        let delegate = select_delegate(profile.strength, selector_seed, profile.complete_cycles);
        Self {
            profile,
            cycle_start_scores: scores,
            first_completed_dealer: None,
            delegate,
        }
    }

    pub fn profile(&self) -> &DynamicProfile {
        &self.profile
    }

    pub fn decision_model(&self) -> ModelId {
        self.delegate.model()
    }

    /// Records a hand only after its crib has been scored. Returns true only
    /// when this hand completes a role-balanced two-hand cycle.
    pub fn complete_hand(&mut self, dealer: Side, scores: [i32; 2], selector_seed: u32) -> bool {
        let Some(first_dealer) = self.first_completed_dealer else {
            self.first_completed_dealer = Some(dealer);
            return false;
        };

        if dealer == first_dealer {
            // A restored or malformed sequence must never turn two hands with
            // the same role into evidence. Drop the partial sequence and wait
            // for a fresh, balanced pair.
            self.cycle_start_scores = scores;
            self.first_completed_dealer = None;
            return false;
        }

        let human_points = scores[Side::Left.index()] - self.cycle_start_scores[Side::Left.index()];
        let dynamic_points =
            scores[Side::Right.index()] - self.cycle_start_scores[Side::Right.index()];
        self.observe_cycle_margin((human_points - dynamic_points) as f64);
        self.cycle_start_scores = scores;
        self.first_completed_dealer = None;
        self.delegate = select_delegate(
            self.profile.strength,
            selector_seed,
            self.profile.complete_cycles,
        );
        true
    }

    fn observe_cycle_margin(&mut self, margin: f64) {
        let alpha = 1.0 - 0.5_f64.powf(1.0 / MOVING_AVERAGE_HALF_LIFE_CYCLES);
        if self.profile.complete_cycles == 0 {
            self.profile.ewma_margin = margin;
        } else {
            self.profile.ewma_margin += alpha * (margin - self.profile.ewma_margin);
        }
        self.profile.complete_cycles += 1;

        if self.profile.complete_cycles < MIN_COMPLETE_CYCLES {
            return;
        }
        if self.profile.ewma_margin > MARGIN_DEADBAND {
            self.profile.strength = self
                .profile
                .strength
                .saturating_add(STRENGTH_STEP)
                .min(ACE_STRENGTH);
        } else if self.profile.ewma_margin < -MARGIN_DEADBAND {
            self.profile.strength = self.profile.strength.saturating_sub(STRENGTH_STEP);
        }
    }
}

fn select_delegate(strength: u16, selector_seed: u32, complete_cycles: u32) -> DynamicDelegate {
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

    let sample = deterministic_unit_interval(selector_seed, complete_cycles);
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

fn deterministic_unit_interval(selector_seed: u32, complete_cycles: u32) -> f64 {
    let mut value =
        u64::from(selector_seed) ^ u64::from(complete_cycles).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^= value >> 31;
    (value >> 11) as f64 / ((1_u64 << 53) as f64)
}
