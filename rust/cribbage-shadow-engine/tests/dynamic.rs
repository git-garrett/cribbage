use cribbage_shadow_engine::dynamic::{
    DynamicCycleSample, DynamicProfile, DynamicState, DYNAMIC_EVALUATOR_VERSION,
    EASY_CALIBRATED_REGRET_PER_DECISION, HANDICAP_HALF_LIFE_CYCLES, MIN_COMPLETE_CYCLES,
    MOVING_AVERAGE_HALF_LIFE_CYCLES, REGRET_DEADBAND, UNIVERSAL_CYCLES_PER_GAME,
};
use cribbage_shadow_engine::game::Side;
use cribbage_shadow_engine::model_id::{ModelId, ACE_MODEL, ACE_MODEL_ID};

fn sample(regret: f64) -> DynamicCycleSample {
    DynamicCycleSample {
        dealer_discard_regret: regret,
        dealer_pegging_regret: regret,
        pone_discard_regret: regret,
        pone_pegging_regret: regret,
        total_regret: regret * 4.0,
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
fn dynamic_uses_the_production_ace_for_evaluation_and_top_strength() {
    assert_eq!(DYNAMIC_EVALUATOR_VERSION, ACE_MODEL);
    let mut profile = DynamicProfile::default();
    profile.strength = 200;
    let state = DynamicState::new(profile, 7, [0, 0]);
    assert_eq!(state.decision_model(), ACE_MODEL_ID);
}

#[test]
fn four_buckets_are_combined_evenly() {
    let mut profile = DynamicProfile::default();
    profile.observe_cycle(DynamicCycleSample {
        dealer_discard_regret: 0.04,
        dealer_pegging_regret: 0.0,
        pone_discard_regret: 0.0,
        pone_pegging_regret: 0.0,
        total_regret: 0.04,
    });

    assert!((profile.regret.dealer_discard - 0.04).abs() < 1e-12);
    assert_eq!(profile.regret.dealer_pegging, 0.0);
    assert_eq!(profile.handicap_cycles, 1);
}

#[test]
fn deadband_prevents_strength_changes_at_the_current_quality() {
    let mut profile = DynamicProfile::default();
    for _ in 0..MIN_COMPLETE_CYCLES {
        profile.observe_cycle(sample(
            EASY_CALIBRATED_REGRET_PER_DECISION + REGRET_DEADBAND / 2.0,
        ));
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
}

#[test]
fn handicap_is_cycle_regret_normalized_to_a_per_game_total() {
    assert!((HANDICAP_HALF_LIFE_CYCLES - 81.288).abs() < 1e-12);
    let mut profile = DynamicProfile::default();
    profile.observe_cycle(sample(0.02));
    assert_eq!(profile.handicap_cycles, 1);
    assert_eq!(profile.cycles_per_game(), UNIVERSAL_CYCLES_PER_GAME);
    assert!(
        (profile.handicap_per_game().unwrap() - (-0.08 * UNIVERSAL_CYCLES_PER_GAME)).abs() < 1e-12
    );

    for _ in 0..6 {
        profile.observe_game_length(5.0);
    }
    assert_eq!(profile.cycles_per_game(), 5.0);
    assert!((profile.handicap_per_game().unwrap() - -0.4).abs() < 1e-12);
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

#[test]
fn older_profile_keeps_strength_but_starts_fresh_cycle_handicap_evidence() {
    let mut state: DynamicState = serde_json::from_str(
        r#"{"profile":{"profile_version":2,"evaluator_version":"schell_table-peg_table-13.215","started_dynamic":true,"complete_cycles":20,"regret":{"dealer_discard":0.01,"dealer_pegging":0.01,"pone_discard":0.01,"pone_pegging":0.01},"ewma_handicap":-0.01,"strength":100},"first_completed_dealer":null,"delegate_cycles":4,"delegate":"Tough"}"#,
    )
    .unwrap();

    state.normalize_profile_version(7);
    assert_eq!(state.profile().complete_cycles, 20);
    assert_eq!(state.profile().handicap_cycles, 0);
    assert_eq!(state.profile().ewma_cycle_handicap, 0.0);
    assert_eq!(state.decision_model(), ModelId::Schell911);
}

#[test]
fn game_based_profile_preserves_its_published_handicap_during_migration() {
    let profile: DynamicProfile = serde_json::from_str(
        r#"{"profile_version":3,"evaluator_version":"schell_table-peg_table-13.215","started_dynamic":true,"complete_cycles":20,"regret":{"dealer_discard":0.01,"dealer_pegging":0.01,"pone_discard":0.01,"pone_pegging":0.01},"complete_games":2,"ewma_game_handicap":-0.125,"strength":100}"#,
    )
    .unwrap();

    let migrated = profile.into_current();
    assert_eq!(migrated.handicap_cycles, 20);
    assert!((migrated.handicap_per_game().unwrap() - -0.125).abs() < 1e-12);
}
