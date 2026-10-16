//! One immutable generation per process; JSON lines in and out.
use cribbage_shadow_engine::{
    cards::Card, game::Side,
    model::{self, Decision, DecisionKind, Model13HandCache, Model911HandCache},
    model_id::ModelId, model29_snapshot,
    playout::{CompactPlayoutRecord, ModelPlayout},
};
use serde_json::{json, Value};
use std::{io::{self, BufRead, Write}, time::Instant};

fn ids(cards: &[Card]) -> Vec<u8> { cards.iter().map(|c| c.id).collect() }

fn hands(record: &CompactPlayoutRecord) -> Vec<Value> {
    record.hands.iter().map(|h| {
        let plays: Vec<_> = record.peg_plays.iter().filter(|p| p.hand_number == h.hand_number)
            .map(|p| json!({"actor":p.player.map(Side::index),"action":p.action,
                "card":p.card.map(|c|c.id),"before":p.count_before,"after":p.count_after,
                "points":p.points,"scores":[p.left_score,p.right_score]})).collect();
        json!({"number":h.hand_number,"dealer":h.dealer.index(),
            "start":[h.start_left_score,h.start_right_score],
            "end":[h.end_left_score,h.end_right_score],"cut":h.cut_card.id,
            "dealt":[ids(&h.left_dealt),ids(&h.right_dealt)],
            "keeps":[ids(&h.left_keep),ids(&h.right_keep)],
            "handPoints":[h.left_available_hand_points,h.right_available_hand_points],
            "cribPoints":h.available_crib_points,"plays":plays})
    }).collect()
}

fn decision(value: Decision) -> Value {
    match value {
        Decision::Discard { card_ids, best_lead, ev, win_probability } =>
            json!({"cards":card_ids,"lead":best_lead,"ev":ev,"wp":win_probability}),
        Decision::Peg { action, card_id, ev, win_probability, .. } =>
            json!({"action":action,"card":card_id,"ev":ev,"wp":win_probability}),
    }
}

fn run(root: &str, reference: Option<&str>, r: &Value) -> Result<Value, String> {
    if r["kind"] == "decision" {
        let input = model::parse_decision_input(r["inputText"].as_str().ok_or("missing inputText")?)?;
        return model::evaluate_decision(&input, root).map(decision);
    }
    let seed = r["seed"].as_u64().filter(|s| *s <= u32::MAX as u64).ok_or("invalid seed")? as u32;
    let first = match r["firstDealer"].as_u64() {
        Some(0) => Side::Left, Some(1) => Side::Right, _ => return Err("invalid firstDealer".into()),
    };
    let start: [i32; 2] = serde_json::from_value(r.get("scores").cloned().unwrap_or(json!([0,0])))
        .map_err(|e| e.to_string())?;
    if start.iter().any(|s| !(0..121).contains(s)) { return Err("invalid starting score".into()); }
    let candidate = r["candidateSide"].as_u64();
    if candidate.is_some_and(|s| s > 1) || candidate.is_some() != reference.is_some() {
        return Err("evaluation requires reference root and candidate side".into());
    }
    let trajectory = r["kind"] == "trajectory";
    if trajectory && (candidate.is_some() || start != [0,0]) {
        return Err("transposition requires a training trajectory from 0–0".into());
    }
    let model = |side| if candidate.is_none_or(|c| c == side) { ModelId::Schell290 } else { ModelId::Schell283 };
    let mut game = ModelPlayout::new_at_hand(seed, first, 1, start[0], start[1], model(0), model(1))?;
    let started = Instant::now();
    let (winner, scores, record) = if trajectory {
        let result = game.play_until_both_reach(root, 121, 121, 10000)?;
        (None, [result.left_score,result.right_score], result.record)
    } else {
        let caches = [Model13HandCache::new(),Model13HandCache::new()];
        let cache911 = [Model911HandCache::new(),Model911HandCache::new()];
        let result = game.play_to_end_with_override(root,10000,&mut |input| {
            let is_reference = input.model == ModelId::Schell283.as_str();
            let target = if is_reference { reference.ok_or("reference missing")? } else { root };
            // Both sides use the same algorithm and FP64 arithmetic. The roots
            // alone differ. 29.0 bypasses opening assets tied to old priors.
            let mut input = input.clone(); input.model = ModelId::Schell290.as_str().into();
            let index = usize::from(is_reference);
            if input.kind == DecisionKind::Discard { caches[index].clear(); }
            model::evaluate_decision_with_caches(&input,target,Some(&cache911[index]),Some(&caches[index])).map(Some)
        })?;
        (Some(result.winner.index()),[result.left_score,result.right_score],result.record)
    };
    Ok(json!({"model":"29.0","seed":seed,"firstDealer":first.index(),"start":start,
        "winner":winner,"scores":scores,"hands":hands(&record),"trajectory":trajectory,
        "candidateSide":candidate,"seconds":started.elapsed().as_secs_f64()}))
}

fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    let root = args.get(1).ok_or("usage: model29-worker ROOT [REFERENCE_ROOT]")?;
    let reference = args.get(2).map(String::as_str);
    model29_snapshot::verify(root)?;
    if let Some(other) = reference { model29_snapshot::verify(other)?; }
    for line in io::stdin().lock().lines() {
        let result = line.map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str(&s).map_err(|e|e.to_string()))
            .and_then(|r| run(root,reference,&r));
        let response = match result { Ok(v) => json!({"ok":true,"result":v}), Err(e) => json!({"ok":false,"error":e}) };
        writeln!(io::stdout(),"{response}").map_err(|e|e.to_string())?;
        io::stdout().flush().map_err(|e|e.to_string())?;
    }
    Ok(())
}
