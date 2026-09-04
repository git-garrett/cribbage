use cribbage_shadow_engine::dynamic::{
    DynamicCycleSample, DynamicProfile, DynamicState, EASY_CALIBRATED_REGRET, HANDICAP_DEADBAND,
    MIN_COMPLETE_CYCLES, MOVING_AVERAGE_HALF_LIFE_CYCLES,
};
use cribbage_shadow_engine::game::Side;
use cribbage_shadow_engine::model_id::ModelId;

fn sample(regret: f64) -> DynamicCycleSample {
    DynamicCycleSample {
        dealer_discard_regret: regret,
        dealer_pegging_regret: regret,
        pone_discard_regret: regret,
        pone_pegging_regret: regret,
    }
}

#[test]
fn dynamic_starts_easy_and_waits_for_six_complete_cycles() {
    let mut profile = DynamicProfile::default();
    let state = DynamicState::new(profile.clone(), 7, [0, 0]);

    assert_eq!(state.decision_model(), ModelId::Myrmidon5);
    for expected_cycles in 1..MIN_COMPLETE_CYCLES {
        profile.observe_cycle(sample(0.0));
        assert_eq!(profile.complete_cycles, expected_cycles);
        assert_eq!(profile.strength, 0);
    }
    profile.observe_cycle(sample(0.0));
    assert_eq!(profile.complete_cycles, MIN_COMPLETE_CYCLES);
    assert_eq!(profile.strength, 5);
}

#[test]
fn four_buckets_are_combined_evenly() {
    let mut profile = DynamicProfile::default();
    profile.observe_cycle(DynamicCycleSample {
        dealer_discard_regret: 0.04,
        dealer_pegging_regret: 0.0,
        pone_discard_regret: 0.0,
        pone_pegging_regret: 0.0,
    });

    assert!((profile.ewma_handicap - -0.01).abs() < 1e-12);
    assert!((profile.regret.dealer_discard - 0.04).abs() < 1e-12);
    assert_eq!(profile.regret.dealer_pegging, 0.0);
}

#[test]
fn deadband_prevents_strength_changes_at_the_current_quality() {
    let mut profile = DynamicProfile::default();
    for _ in 0..MIN_COMPLETE_CYCLES {
        profile.observe_cycle(sample(EASY_CALIBRATED_REGRET + HANDICAP_DEADBAND / 2.0));
    }
    assert_eq!(profile.strength, 0);
}

#[test]
fn ewma_has_an_eighteen_cycle_half_life() {
    assert_eq!(MOVING_AVERAGE_HALF_LIFE_CYCLES, 18.0);
    let mut profile = DynamicProfile::default();
    profile.observe_cycle(sample(0.04));
    for _ in 0..18 {
        profile.observe_cycle(sample(0.0));
    }

    assert!((profile.regret.dealer_discard - 0.02).abs() < 1e-12);
    assert!((profile.ewma_handicap - -0.02).abs() < 1e-12);
}

#[test]
fn delegate_is_reselected_only_after_opposite_dealer_roles() {
    let mut state = DynamicState::new(DynamicProfile::default(), 7, [0, 0]);

    assert!(!state.complete_hand(Side::Left, [10, 8], 11));
    assert!(!state.complete_hand(Side::Left, [20, 16], 11));
    assert!(!state.complete_hand(Side::Right, [30, 24], 11));
    assert!(state.complete_hand(Side::Left, [40, 32], 11));
}

#[test]
fn incompatible_evaluator_profiles_start_fresh() {
    let mut profile = DynamicProfile::default();
    profile.evaluator_version = "older-ace".to_string();
    profile.complete_cycles = 20;
    profile.strength = 100;

    let state = DynamicState::new(profile, 7, [0, 0]);
    assert_eq!(state.profile(), &DynamicProfile::default());
    assert_eq!(state.decision_model(), ModelId::Myrmidon5);
}

#[test]
fn restored_legacy_state_is_normalized_before_play() {
    let mut state: DynamicState = serde_json::from_str(
        r#"{"profile":{"complete_cycles":20,"ewma_margin":4.0,"strength":100},"cycle_start_scores":[0,0],"first_completed_dealer":null,"delegate":"Tough"}"#,
    )
    .unwrap();

    state.normalize_profile_version(7);
    assert_eq!(state.profile(), &DynamicProfile::default());
    assert_eq!(state.decision_model(), ModelId::Myrmidon5);
}
