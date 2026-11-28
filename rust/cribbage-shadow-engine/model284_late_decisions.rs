//! Small, counterfactual late-game decisions; no complete games or activation.
use super::*;
use crate::game::{CribbageGame, Phase, Side};
use sha2::{Digest, Sha256};
use std::path::Path;

fn values(input: &DecisionInput, tables: &RuntimeTables) -> serde_json::Value {
    let decision = recommend_peg_model1323(input, &input.ai_hand, tables, None).unwrap();
    match decision {
        Decision::Peg {
            card_id: Some(card),
            win_probability: Some(wp),
            ev: Some(ev),
            ..
        } => {
            assert!(input
                .ai_hand
                .iter()
                .any(|c| c.id == card && input.count + c.value <= 31));
            assert!((0.0..=1.0).contains(&wp) && ev.is_finite());
            serde_json::json!({"card":card,"wp":wp,"ev":ev})
        }
        _ => panic!("valued legal play required"),
    }
}

#[test]
#[ignore = "requires prepared late-game candidate assets"]
fn late_game_hypothetical_decisions_compare_candidate_with_ace() {
    let candidate = std::env::var("CRIBBAGE_284_LATE_ASSET_ROOT").expect("candidate root required");
    let candidate = Path::new(&candidate);
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let reference = RuntimeTables::new(root.to_str().unwrap());
    let updated = RuntimeTables::new(root.to_str().unwrap());
    let assets = Model1323PolicyAssets::with_model284_test_beliefs(
        &root.join("rust/cribbage-shadow-engine/assets"),
        candidate,
    )
    .unwrap();
    assert!(updated.policy_assets205.set(assets).is_ok());
    let mut report = Vec::new();
    for role in ["dealer", "pone"] {
        let history = if role == "dealer" {
            "aiHand=0,4;aiTable=3,9;humanTable=2,5,13;humanHandCount=1;plays=2,3,5,9,13;count=24;last=human;pegHistory=o2,s3,o5,s9,o0"
        } else {
            "aiHand=4,9;aiTable=0,3;humanTable=2,5;humanHandCount=2;plays=0,2,3,5;count=14;last=human;pegHistory=s0,o2,s3,o5"
        };
        for (own, other) in (111..=120).flat_map(|own| [111, 115, 120].map(|other| (own, other))) {
            let input = parse_decision_input(&format!(
                "model={MODEL_28_3};kind=peg;role={role};ownDiscards=1,6;turnCard=11;aiScore={own};humanScore={other};{history}"
            )).unwrap();
            validate_modern_pegging_input(&input).unwrap();
            report.push(
                serde_json::json!({"role":role,"ownScore":own,"otherScore":other,
                "reference":values(&input,&reference),"candidate":values(&input,&updated),"kind":"two-card-continuation"}),
            );
        }
        let history = if role == "dealer" {
            "humanTable=13,8,14;humanHandCount=1;plays=13,3,8,9,14;pegHistory=o0,s3,o8,s9,o1"
        } else {
            "humanTable=12,14;humanHandCount=2;plays=3,12,9,14;pegHistory=s3,o12,s9,o1"
        };
        for own in [119, 120] {
            let input = parse_decision_input(&format!(
                "model={MODEL_28_3};kind=peg;role={role};aiHand=4,0;aiTable=3,9;ownDiscards=1,6;turnCard=11;aiScore={own};humanScore=120;count=26;last=human;{history}"
            )).unwrap();
            validate_modern_pegging_input(&input).unwrap();
            for (name, tables) in [("reference", &reference), ("candidate", &updated)] {
                let result = recommend_peg_model1323(&input, &input.ai_hand, tables, None).unwrap();
                assert!(
                    matches!(
                        result,
                        Decision::Peg {
                            card_id: Some(4),
                            win_probability: Some(1.0),
                            ..
                        }
                    ),
                    "{name}: {result:?}"
                );
            }
            report.push(
                serde_json::json!({"role":role,"ownScore":own,"otherScore":120,
                "kind":"certain-31-scoreout","passed":true}),
            );
        }
    }
    // Add different physical deals and histories, rather than only rebasing
    // the same two hands. Generate short legal prefixes and stop at a choice;
    // neither profile plays a complete hand or game during this validation.
    let panel: serde_json::Value =
        serde_json::from_slice(&fs::read(candidate.join("hypotheticals.json")).unwrap()).unwrap();
    let seed = panel["seed"].as_str().unwrap();
    let mut quotas = [0; 2];
    for attempt in 0..1024u32 {
        if quotas == [32, 32] {
            break;
        }
        let hash = Sha256::digest(format!("{seed}:decision-prefix:{attempt}"));
        let game_seed = u32::from_le_bytes(hash[..4].try_into().unwrap());
        let mut game = CribbageGame::new_with_seed(game_seed, Side::Right);
        game.player_mut(Side::Left).score = 111 + (attempt % 10) as i32;
        game.player_mut(Side::Right).score = 111 + ((attempt / 10) % 10) as i32;
        for side in [Side::Left, Side::Right] {
            let hand = &game.player(side).hand;
            game.discard(side, [hand[0].id, hand[1].id]).unwrap();
        }
        for _ in 0..12 {
            if game.phase != Phase::Pegging {
                break;
            }
            if game.pegging_reset_pending {
                game.acknowledge_pegging_reset();
                continue;
            }
            let side = game.current_player();
            let role = if side == game.dealer { 0 } else { 1 };
            let legal = game.legal_cards(side);
            if game.player(side).hand.len() == 2
                && (1..=2).contains(&game.player(side.other()).hand.len())
                && legal.len() == 2
                && legal[0].rank != legal[1].rank
                && quotas[role] < 32
            {
                let input = crate::decision::decision_input(
                    &game,
                    side,
                    crate::model_id::ModelId::Schell283,
                    DecisionKind::Peg,
                    None,
                );
                validate_modern_pegging_input(&input).unwrap();
                report.push(serde_json::json!({"kind":"varied-legal-prefix","role":if role==0 {"dealer"}else{"pone"},
                    "gameSeed":game_seed,"ownScore":input.ai_score,"otherScore":input.human_score,
                    "visibleInput":format!("{input:?}"),"reference":values(&input,&reference),"candidate":values(&input,&updated)}));
                quotas[role] += 1;
                break;
            }
            if legal.is_empty() {
                game.say_go(side).unwrap();
            } else {
                let index = (game.random() * legal.len() as f64).floor() as usize;
                game.play_card(side, legal[index].id).unwrap();
            }
        }
    }
    assert_eq!(quotas, [32, 32]);
    let body = serde_json::json!({"positions":report,"passed":true,"wholeGamesRun":0,
        "scope":"Finite probability/legality checks and certain score-outs; differing actions have no omniscient best-play labels."});
    fs::write(
        candidate.join("decision-hypotheticals.json"),
        serde_json::to_vec_pretty(&body).unwrap(),
    )
    .unwrap();
}
