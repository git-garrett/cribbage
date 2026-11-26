use cribbage_shadow_engine::model::{
    evaluate_decision, evaluate_decision_with_caches, evaluate_selected_decision,
    parse_decision_input, review_decision, Decision, Model13HandCache,
};
use cribbage_shadow_engine::model_id::{MODEL_28_3_FAST, MODEL_28_4};

fn root() -> String {
    std::env::var("CRIBBAGE_MODEL_ROOT").unwrap_or_else(|_| {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_str()
            .unwrap()
            .into()
    })
}

fn assert_exact(actual: &Decision, expected: &Decision) {
    match (actual, expected) {
        (
            Decision::Discard {
                card_ids: a,
                best_lead: al,
                ev: ae,
                win_probability: aw,
            },
            Decision::Discard {
                card_ids: b,
                best_lead: bl,
                ev: be,
                win_probability: bw,
            },
        ) => {
            assert_eq!(
                (a, al, ae.map(f64::to_bits), aw.map(f64::to_bits)),
                (b, bl, be.map(f64::to_bits), bw.map(f64::to_bits))
            );
        }
        (
            Decision::Peg {
                action: a,
                card_id: ac,
                ev: ae,
                win_probability: aw,
                model16_policy: ap,
            },
            Decision::Peg {
                action: b,
                card_id: bc,
                ev: be,
                win_probability: bw,
                model16_policy: bp,
            },
        ) => {
            assert_eq!(
                (a, ac, ae.map(f64::to_bits), aw.map(f64::to_bits)),
                (b, bc, be.map(f64::to_bits), bw.map(f64::to_bits))
            );
            assert!(ap.is_none() && bp.is_none());
        }
        _ => panic!("different decision kinds"),
    }
}

#[test]
fn model284_matches_production_pegging_and_all_review_paths() {
    let root = root();
    for role in ["dealer", "pone"] {
        let history = if role == "dealer" {
            "aiHand=3,4,9;aiTable=0;plays=2,0,5;count=10;last=human;pegHistory=o2,s0,o5"
        } else {
            "aiHand=4,9;aiTable=0,3;plays=0,2,3,5;count=14;last=human;pegHistory=s0,o2,s3,o5"
        };
        for (own, other) in [(95, 96), (119, 118)] {
            let fields = format!("kind=peg;role={role};ownDiscards=1,6;turnCard=10;humanTable=2,5;humanHandCount=2;aiScore={own};humanScore={other};{history}");
            let baseline =
                parse_decision_input(&format!("model={MODEL_28_3_FAST};{fields}")).unwrap();
            let candidate = parse_decision_input(&format!("model=28.4;{fields}")).unwrap();
            assert_eq!(candidate.model, MODEL_28_4);
            let expected = evaluate_decision(&baseline, &root).unwrap();
            let cache = Model13HandCache::new();
            for input in [&candidate, &baseline, &candidate] {
                let actual =
                    evaluate_decision_with_caches(input, &root, None, Some(&cache)).unwrap();
                assert_exact(&actual, &expected);
            }
            // Include the alternative, not just the recommended action.
            for card in [4, 9] {
                let before = review_decision(&baseline, &[card], &root).unwrap();
                let after = review_decision(&candidate, &[card], &root).unwrap();
                assert_exact(&after.selected, &before.selected);
                assert_exact(&after.recommended, &before.recommended);
                assert_exact(
                    &evaluate_selected_decision(&candidate, &[card], &root).unwrap(),
                    &before.selected,
                );
            }
            assert_eq!(candidate.model, MODEL_28_4);
        }
    }
}

#[test]
#[ignore = "requires the installed full production correction asset"]
fn model284_matches_production_discard_and_review() {
    let root = root();
    for role in ["dealer", "pone"] {
        let fields =
            format!("kind=discard;role={role};aiHand=0,4,8,12,16,20;aiScore=75;humanScore=82");
        let baseline = parse_decision_input(&format!("model={MODEL_28_3_FAST};{fields}")).unwrap();
        let candidate = parse_decision_input(&format!("model={MODEL_28_4};{fields}")).unwrap();
        let expected = evaluate_decision(&baseline, &root).unwrap();
        assert_exact(&evaluate_decision(&candidate, &root).unwrap(), &expected);
        for cards in [&[0, 4][..], &[16, 20][..]] {
            let before = review_decision(&baseline, cards, &root).unwrap();
            let after = review_decision(&candidate, cards, &root).unwrap();
            assert_exact(&after.selected, &before.selected);
            assert_exact(&after.recommended, &before.recommended);
            assert_exact(
                &evaluate_selected_decision(&candidate, cards, &root).unwrap(),
                &before.selected,
            );
        }
    }
}
