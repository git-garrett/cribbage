//! Deterministic build-time workload and exact-result oracle; never used by gameplay.
use cribbage_shadow_engine::decision::{self, PegDecision};
use cribbage_shadow_engine::game::{CribbageGame, Phase, Side};
use cribbage_shadow_engine::model::{self, Decision, Model13HandCache, Model911HandCache};
use cribbage_shadow_engine::model_id::{ModelId, ACE_MODEL};
use serde_json::{json, Value};
use std::time::Instant;

fn value(d: Decision) -> Value {
    match d {
        Decision::Discard {
            card_ids,
            best_lead,
            ev,
            win_probability,
        } => {
            json!({"cards":card_ids,"lead":best_lead,"evBits":ev.map(f64::to_bits),"wpBits":win_probability.map(f64::to_bits)})
        }
        Decision::Peg {
            action,
            card_id,
            ev,
            win_probability,
            ..
        } => {
            json!({"action":action,"card":card_id,"evBits":ev.map(f64::to_bits),"wpBits":win_probability.map(f64::to_bits)})
        }
    }
}

fn full_hand(seed: u32, model_id: ModelId, root: &str) -> Result<Value, String> {
    let mut game = CribbageGame::new_with_seed(seed, Side::Left);
    game.players[0].score = 72;
    game.players[1].score = 79;
    let mut trace = Vec::new();
    let caches = [Model13HandCache::new(), Model13HandCache::new()];
    let caches911 = [Model911HandCache::new(), Model911HandCache::new()];
    for side in [Side::Left, Side::Right] {
        let d = decision::recommend_discard_for_side(&game, side, model_id, root)?;
        trace.push(json!({"side":side.index(),"discard":d.card_ids,"lead":d.best_lead,"evBits":d.ev.map(f64::to_bits),"wpBits":d.win_probability.map(f64::to_bits)}));
        let cards: [u8; 2] = d.card_ids.try_into().map_err(|_| "expected two discards")?;
        game.discard(side, cards)?;
    }
    let mut steps = 0;
    while game.phase == Phase::Pegging {
        steps += 1;
        if steps > 40 {
            return Err("full-hand workload did not terminate".into());
        }
        if game.pegging_reset_pending {
            game.acknowledge_pegging_reset();
            continue;
        }
        let side = game.current_player();
        let d = decision::recommend_peg_for_side_with_caches(
            &game,
            side,
            model_id,
            None,
            root,
            Some(&caches911[side.index()]),
            Some(&caches[side.index()]),
        )?;
        match d {
            PegDecision::Go => {
                trace.push(json!({"side":side.index(),"action":"go"}));
                game.say_go(side)?;
            }
            PegDecision::Play {
                card_id,
                ev,
                win_probability,
            } => {
                trace.push(json!({"side":side.index(),"card":card_id,"evBits":ev.map(f64::to_bits),"wpBits":win_probability.map(f64::to_bits)}));
                game.play_card(side, card_id)?;
            }
        }
    }
    if game.phase != Phase::PeggingComplete {
        return Err("expected a complete pegging hand".into());
    }
    game.score_after_pegging()?;
    Ok(json!({"trace":trace,"scores":[game.players[0].score,game.players[1].score]}))
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 5 {
        return Err("usage: pgo-workload CORPUS ROOT MODEL train|validate play|reviews".into());
    }
    let corpus: Value =
        serde_json::from_slice(&std::fs::read(&args[0]).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let model_name = if args[2] == "ace" {
        ACE_MODEL
    } else {
        &args[2]
    };
    let model_id: ModelId = model_name.parse()?;
    let cases = corpus
        .as_array()
        .ok_or("workload corpus must be an array")?;
    let suite = &args[3];
    if suite != "train" && suite != "validate" {
        return Err("invalid workload suite".into());
    }
    if args[4] != "play" && args[4] != "reviews" {
        return Err("invalid workload kind".into());
    }
    let started = Instant::now();
    let mut rows = Vec::new();
    let cache = Model13HandCache::new();
    let cache911 = Model911HandCache::new();
    for case in cases {
        if case["suite"] != *suite {
            continue;
        }
        let mode = case["mode"].as_str().ok_or("missing mode")?;
        if args[4] == "play" && matches!(mode, "selected" | "review") {
            continue;
        }
        let v = if mode == "hand" {
            full_hand(
                case["seed"].as_u64().ok_or("missing hand seed")? as u32,
                model_id,
                &args[1],
            )?
        } else {
            let text = case["inputText"]
                .as_str()
                .ok_or("missing input")?
                .replace("{model}", model_name);
            let input = model::parse_decision_input(&text)?;
            if input.kind == model::DecisionKind::Discard {
                cache.clear();
            }
            let selected = case["selected"].as_u64().unwrap_or(0) as u8;
            match mode {
                "play" => value(model::evaluate_decision_with_caches(
                    &input,
                    &args[1],
                    Some(&cache911),
                    Some(&cache),
                )?),
                "selected" => value(model::evaluate_selected_decision(
                    &input,
                    &[selected],
                    &args[1],
                )?),
                "review" => {
                    let r = model::review_decision(&input, &[selected], &args[1])?;
                    json!({"selected":value(r.selected),"recommended":value(r.recommended)})
                }
                _ => return Err(format!("invalid workload mode: {mode}")),
            }
        };
        rows.push(json!({"id":case["id"],"mode":mode,"value":v}));
    }
    if rows.is_empty() {
        return Err("empty workload suite".into());
    }
    println!(
        "{}",
        json!({"model":model_name,"suite":suite,"seconds":started.elapsed().as_secs_f64(),"values":rows})
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("PGO workload failed: {error}");
        std::process::exit(1);
    }
}
