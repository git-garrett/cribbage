use cribbage_shadow_engine::model::{
    evaluate_decision, evaluate_decision_with_caches, evaluate_selected_decision,
    parse_decision_input, Decision, Model13HandCache,
};
use cribbage_shadow_engine::model_id::{MODEL_13_23, MODEL_20_0};

fn assert_discard_cache_and_review(fields: &str) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let root = root.to_str().unwrap();
    let ace = parse_decision_input(&format!("model={MODEL_13_23};{fields}")).unwrap();
    let model20 = parse_decision_input(&format!("model={MODEL_20_0};{fields}")).unwrap();
    let frozen = evaluate_decision(&ace, root).unwrap();
    let actual = evaluate_decision(&model20, root).unwrap();
    assert_ne!(format!("{actual:?}"), format!("{frozen:?}"), "{fields}");
    let cache = Model13HandCache::new();
    let cached = evaluate_decision_with_caches(&model20, root, None, Some(&cache)).unwrap();
    assert_eq!(format!("{cached:?}"), format!("{actual:?}"));
    let selected = match &actual {
        Decision::Discard { card_ids, .. } => card_ids.clone(),
        Decision::Peg { card_id, .. } => card_id.iter().copied().collect(),
    };
    let review = evaluate_selected_decision(&model20, &selected, root).unwrap();
    assert_eq!(format!("{review:?}"), format!("{actual:?}"));
}

#[test]
fn model20_pegging_cache_and_review_use_corrected_beliefs() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let root = root.to_str().unwrap();
    for role in ["dealer", "pone"] {
        let fields = format!(
            "kind=peg;turnCard=10;role={role};ownDiscards=1,6;aiHand=4,9;aiTable=0,3;humanTable=2,5;humanHandCount=2;aiScore=95;humanScore=96;plays=0,2,3,5;count=14;last=human;pegHistory=s0,o2,s3,o5"
        );
        let ace = parse_decision_input(&format!("model={MODEL_13_23};{fields}")).unwrap();
        let model20 = parse_decision_input(&format!("model={MODEL_20_0};{fields}")).unwrap();
        let frozen = evaluate_decision(&ace, root).unwrap();
        let actual = evaluate_decision(&model20, root).unwrap();
        assert_ne!(format!("{actual:?}"), format!("{frozen:?}"));
        let cache = Model13HandCache::new();
        // Card support may be reused across models; posterior weights may not.
        evaluate_decision_with_caches(&ace, root, None, Some(&cache)).unwrap();
        for _ in 0..2 {
            let cached = evaluate_decision_with_caches(&model20, root, None, Some(&cache)).unwrap();
            assert_eq!(format!("{cached:?}"), format!("{actual:?}"));
        }
        let Decision::Peg {
            card_id: Some(card),
            ..
        } = actual
        else {
            panic!("expected play")
        };
        let review = evaluate_selected_decision(&model20, &[card], root).unwrap();
        assert_eq!(format!("{review:?}"), format!("{actual:?}"));
    }
}

#[test]
#[ignore = "requires the installed production correction asset"]
fn model20_discard_and_review_use_conditioned_show_scores() {
    for role in ["dealer", "pone"] {
        for (own, opponent) in [(0, 0), (118, 117)] {
            assert_discard_cache_and_review(&format!(
                "kind=discard;role={role};aiHand=0,4,8,12,16,20;aiScore={own};humanScore={opponent}"
            ));
        }
    }
}
