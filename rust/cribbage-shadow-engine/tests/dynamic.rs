use cribbage_shadow_engine::dynamic::{
    DynamicProfile, DynamicState, MARGIN_DEADBAND, MOVING_AVERAGE_HALF_LIFE_CYCLES,
};
use cribbage_shadow_engine::game::Side;
use cribbage_shadow_engine::model_id::ModelId;

fn finish_cycle(state: &mut DynamicState, scores: &mut [i32; 2], margin: i32) {
    let human_gain = 20 + margin.max(0);
    let ai_gain = 20 + (-margin).max(0);
    scores[Side::Left.index()] += human_gain;
    scores[Side::Right.index()] += ai_gain;
    assert!(!state.complete_hand(Side::Left, *scores, 11));
    assert!(state.complete_hand(Side::Right, *scores, 11));
}

#[test]
fn dynamic_starts_easy_and_waits_for_six_complete_cycles() {
    let mut state = DynamicState::new(DynamicProfile::default(), 7, [0, 0]);
    let mut scores = [0, 0];

    assert_eq!(state.decision_model(), ModelId::Myrmidon5);
    for expected_cycles in 1..=5 {
        finish_cycle(&mut state, &mut scores, 4);
        assert_eq!(state.profile().complete_cycles, expected_cycles);
        assert_eq!(state.profile().strength, 0);
    }
    finish_cycle(&mut state, &mut scores, 4);
    assert_eq!(state.profile().complete_cycles, 6);
    assert_eq!(state.profile().strength, 5);
}

#[test]
fn incomplete_final_cycle_is_ignored() {
    let mut state = DynamicState::new(DynamicProfile::default(), 7, [0, 0]);

    assert!(!state.complete_hand(Side::Left, [12, 8], 11));
    assert_eq!(state.profile().complete_cycles, 0);
    assert_eq!(state.profile().strength, 0);
}

#[test]
fn deadband_prevents_strength_changes_near_zero() {
    let profile = DynamicProfile {
        complete_cycles: 6,
        ewma_margin: MARGIN_DEADBAND / 2.0,
        strength: 40,
    };
    let mut state = DynamicState::new(profile, 7, [0, 0]);
    let mut scores = [0, 0];

    finish_cycle(&mut state, &mut scores, 0);
    assert_eq!(state.profile().strength, 40);
}

#[test]
fn ewma_has_an_eighteen_cycle_half_life() {
    assert_eq!(MOVING_AVERAGE_HALF_LIFE_CYCLES, 18.0);
    let mut state = DynamicState::new(DynamicProfile::default(), 7, [0, 0]);
    let mut scores = [0, 0];
    finish_cycle(&mut state, &mut scores, 8);
    for _ in 0..18 {
        finish_cycle(&mut state, &mut scores, 0);
    }

    assert!((state.profile().ewma_margin - 4.0).abs() < 1e-9);
}

#[test]
fn a_complete_cycle_requires_opposite_dealer_roles() {
    let mut state = DynamicState::new(DynamicProfile::default(), 7, [0, 0]);

    assert!(!state.complete_hand(Side::Left, [10, 8], 11));
    assert!(!state.complete_hand(Side::Left, [20, 16], 11));
    assert_eq!(state.profile().complete_cycles, 0);
}
