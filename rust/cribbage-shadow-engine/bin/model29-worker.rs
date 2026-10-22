//! One immutable generation per process; JSON lines in and out.
use cribbage_shadow_engine::{
    board::Role,
    cards::Card, game::Side,
    model::{self, Decision, DecisionKind, Model13HandCache, Model911HandCache},
    model_id::ModelId, model29_snapshot,
    playout::{CompactPlayoutRecord, ModelPlayout},
};
use serde_json::{json, Value};
use std::{io::{self, BufRead, Write}, time::Instant};
#[allow(dead_code)]
#[path = "../examples/model283-hands.rs"]
mod hand_rollout;

fn policy_model() -> ModelId {
    if model29_snapshot::model_version()=="29.1" {ModelId::Schell291} else {ModelId::Schell290}
}

fn counterfactual(root: &str, r: &Value) -> Result<Value, String> {
    let started = Instant::now();
    let own: Vec<u8> = serde_json::from_value(r["own"].clone()).map_err(|e|e.to_string())?;
    if own.len()!=6 || own.iter().any(|c|*c>=52) || (0..6).any(|i|(i+1..6).any(|j|own[i]==own[j])) { return Err("invalid own six".into()); }
    let scores: [i32;2] = serde_json::from_value(r["scores"].clone()).map_err(|e|e.to_string())?;
    if scores.iter().any(|s|!(0..121).contains(s)) {return Err("invalid forecast scores".into());}
    let dealer = r["dealer"].as_u64().filter(|d|*d<2).ok_or("invalid forecast dealer")?;
    let mut seed = r["seed"].as_u64().filter(|n|*n<=u32::MAX as u64).ok_or("invalid forecast seed")? as u32;
    let mut deck: Vec<u8> = (0..52).filter(|c|!own.contains(c)).collect();
    for i in (1..deck.len()).rev() {
        seed=seed.wrapping_mul(1664525).wrapping_add(1013904223);
        deck.swap(i, (seed as usize)%(i+1));
    }
    let six=&deck[..6]; let cut=deck[6];
    // Opponent chooses with its own six and public pre-cut board only.
    let input=model::parse_decision_input(&format!("kind=discard;model=29.0;role={};aiHand={};aiScore={};humanScore={};turnCard=0",
        if dealer==1 {"dealer"} else {"pone"},six.iter().map(u8::to_string).collect::<Vec<_>>().join(","),scores[1],scores[0]))?;
    let Decision::Discard {card_ids,..}=model::evaluate_decision(&input,root)? else {return Err("expected discard".into());};
    let opponent: Vec<_> = six.iter().copied().filter(|c|!card_ids.contains(c)).chain(card_ids.iter().copied()).collect();
    let mut outcomes=vec![];
    for a in 0..6 {for b in a+1..6 {
        let discard=[own[a],own[b]];
        let ordered: Vec<_>=own.iter().copied().filter(|c|!discard.contains(c)).chain(discard).collect();
        let result=hand_rollout::run(&json!({"own":ordered,"opponent":opponent,"cut":cut,"scores":scores,"dealer":dealer,"finishCounting":true}),policy_model(),root)?;
        outcomes.push(json!({"key":cribbage_shadow_engine::model29_forecast::key(&own,&discard,scores,dealer==0),"discard":discard,"scores":result["scores"],"pegEnd":result["pegEnd"],"postCutStart":result["postCutStart"]}));
    }}
    Ok(json!({"model":model29_snapshot::model_version(),"seed":r["seed"],"own":own,"opponent":opponent,"cut":cut,"start":scores,"dealer":dealer,
        "outcomes":outcomes,"seconds":started.elapsed().as_secs_f64(),"cache":model29_snapshot::cache_stats()}))
}

fn rejected_discards_with(
    root: &str,
    r: &Value,
    mut rollout: impl FnMut(&Value, ModelId, &str) -> Result<Value, String>,
) -> Result<Value, String> {
    let started = Instant::now();
    let own: Vec<u8> = serde_json::from_value(r["own"].clone()).map_err(|e|e.to_string())?;
    let other: Vec<u8> = serde_json::from_value(r["opponent"].clone()).map_err(|e|e.to_string())?;
    let chosen: [u8;2] = serde_json::from_value(r["selectedDiscard"].clone()).map_err(|e|e.to_string())?;
    let scores: [i32;2] = serde_json::from_value(r["scores"].clone()).map_err(|e|e.to_string())?;
    let cut = r["cut"].as_u64().filter(|n| *n < 52).ok_or("invalid cut")? as u8;
    let dealer = r["dealer"].as_u64().filter(|n| *n < 2).ok_or("invalid dealer")?;
    let source = r["sourceGame"].as_str().filter(|s| s.starts_with("train:")).ok_or("not a training source")?;
    let hand = r["hand"].as_u64().filter(|n| *n > 0).ok_or("invalid hand number")?;
    let actor = r["actor"].as_u64().filter(|n| *n < 2).ok_or("invalid actor")?;
    if own.len() != 6 || other.len() != 6 || chosen[0] == chosen[1]
        || chosen.iter().any(|c| !own.contains(c)) || scores.iter().any(|s| !(0..121).contains(s)) {
        return Err("invalid rejected-discard context".into());
    }
    let mut seen = [false;52];
    for &c in own.iter().chain(&other).chain(std::iter::once(&cut)) {
        if c >= 52 || seen[c as usize] { return Err("invalid physical deal".into()); }
        seen[c as usize] = true;
    }
    let mut outcomes = Vec::with_capacity(14);
    for a in 0..6 { for b in a+1..6 {
        let discard = [own[a],own[b]];
        if discard.iter().all(|c| chosen.contains(c)) { continue; }
        let ordered: Vec<_> = own.iter().copied().filter(|c| !discard.contains(c)).chain(discard).collect();
        // Only the engine sees the physical deal. Its executable policy builds
        // each actor's legal observation, exactly as in an ordinary game.
        let result = rollout(&json!({"own":ordered,"opponent":other,"cut":cut,
            "scores":scores,"dealer":dealer,"finishCounting":true}),policy_model(),root)?;
        outcomes.push(json!({"key":cribbage_shadow_engine::model29_forecast::key(&own,&discard,scores,dealer==0),
            "discard":discard,"scores":result["scores"],"pegEnd":result["pegEnd"],"postCutStart":result["postCutStart"],
            "forecast":r["forecastInputs"][cribbage_shadow_engine::model29_forecast::key(&own,&discard,scores,dealer==0)]}));
    }}
    Ok(json!({"model":model29_snapshot::model_version(),"sourceRoot":root,"evidenceKind":"rejected","sourceGame":source,"hand":hand,"actor":actor,
        "seed":r["seed"],"own":own,"opponent":other,"cut":cut,"start":scores,"dealer":dealer,
        "selectedDiscard":chosen,"outcomes":outcomes,"seconds":started.elapsed().as_secs_f64(),
        "cache":model29_snapshot::cache_stats()}))
}

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

// Serialize observations already collected by ModelPlayout. No extra decisions
// or model calls: recording must not change policy, cache use or learning data.
fn benchmark(record: &CompactPlayoutRecord) -> Value {
    let role = |r: Role| if r == Role::Dealer { "dealer" } else { "pone" };
    let discards: Vec<_> = record.discards.iter().map(|d| json!({
        "hand":d.hand_number,"actor":d.player.index(),"role":role(d.role),"model":d.model.as_str(),
        "ev":d.selected_ev,"wp":d.selected_win_probability,"micros":d.decision_elapsed_us
    })).collect();
    let plays: Vec<_> = record.peg_plays.iter().map(|p| json!({
        "hand":p.hand_number,"sequence":p.sequence,"actor":p.player.map(Side::index),
        "role":p.role.map(role),"model":p.model.map(|m|m.as_str()),
        "ev":p.selected_ev,"evKind":"future_net","wp":p.selected_win_probability,
        "micros":p.decision_elapsed_us,"legalCount":p.legal_count,
        "action":p.action,"card":p.card.map(|c|c.id),"before":p.count_before,
        "after":p.count_after,"points":p.points,"scores":[p.left_score,p.right_score]
    })).collect();
    json!({"schemaVersion":1,"discards":discards,"plays":plays})
}

fn run(root: &str, reference: Option<&str>, r: &Value) -> Result<Value, String> {
    let cache = r["cache"].as_bool().unwrap_or(true)
        && std::env::var_os("MODEL29_CACHE_CONFIG").is_some();
    model29_snapshot::reset_cache_stats();
    model29_snapshot::activate(root, cache)?;
    cribbage_shadow_engine::model291_forecast::record(reference.is_none() && r["kind"]=="game" && model29_snapshot::model_version()=="29.1");
    if r["kind"] == "counterfactual" || r["kind"] == "rejected-discards" {
        if reference.is_some() { return Err("evaluation cannot generate training evidence".into()); }
        return if r["kind"] == "rejected-discards" {
            rejected_discards_with(root,r,hand_rollout::run)
        } else { counterfactual(root,r) };
    }
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
    if r["kind"] != "game" { return Err("only ordinary games are supported".into()); }
    let candidate_model=policy_model();
    let model = |side| if candidate.is_none_or(|c| c == side) { candidate_model } else { ModelId::Schell283 };
    let mut game = ModelPlayout::new_at_hand(seed, first, 1, start[0], start[1], model(0), model(1))?;
    let started = Instant::now();
    let (winner, scores, record) = {
        let caches = [Model13HandCache::new(),Model13HandCache::new()];
        let cache911 = [Model911HandCache::new(),Model911HandCache::new()];
        let result = game.play_to_end_with_override(root,10000,&mut |input| {
            let is_reference = input.model == ModelId::Schell283.as_str();
            let target = if is_reference { reference.ok_or("reference missing")? } else { root };
            model29_snapshot::activate(target, cache)?;
            let mut input = input.clone(); input.model = policy_model().as_str().into();
            let index = usize::from(is_reference);
            if input.kind == DecisionKind::Discard { caches[index].clear(); }
            model::evaluate_decision_with_caches(&input,target,Some(&cache911[index]),Some(&caches[index])).map(Some)
        })?;
        (Some(result.winner.index()),[result.left_score,result.right_score],result.record)
    };
    let forecasts=cribbage_shadow_engine::model291_forecast::take_records();
    let mut output = json!({"model":if candidate_model==ModelId::Schell291 {"29.1"} else {"29.0"},"sourceRoot":root,"seed":seed,"firstDealer":first.index(),"start":start,
        "winner":winner,"scores":scores,"hands":hands(&record),"trajectory":false,
        "candidateSide":candidate,"seconds":started.elapsed().as_secs_f64(),
        "cache":model29_snapshot::cache_stats()});
    if reference.is_some() { output["benchmark"] = benchmark(&record); }
    else if candidate_model==ModelId::Schell291 { output["forecastInputs"]=forecasts; }
    Ok(output)
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

#[cfg(test)]
mod training_tests {
    use super::*;
    fn fixture() -> Value {
        json!({"own":[0,1,2,3,4,5],"opponent":[13,14,15,16,17,18],"cut":50,
            "scores":[90,100],"dealer":1,"selectedDiscard":[5,4],
            "sourceGame":"train:0:2","hand":1,"actor":0,"seed":17})
    }
    #[test]
    fn all_fourteen_rejected_discards_use_the_same_deal_and_root() {
        let r = fixture();
        let mut tested = std::collections::HashSet::new();
        let result = rejected_discards_with("frozen",&r,|h,model,root| {
            assert_eq!(root,"frozen"); assert_eq!(model,ModelId::Schell290);
            assert_eq!(h["opponent"],r["opponent"]); assert_eq!(h["cut"],r["cut"]);
            assert_eq!(h["scores"],r["scores"]); assert_eq!(h["dealer"],r["dealer"]);
            assert_eq!(h["finishCounting"],true);
            let own: Vec<u8> = serde_json::from_value(h["own"].clone()).unwrap();
            let mut pair = [own[4],own[5]]; pair.sort_unstable();
            assert_ne!(pair,[4,5]); assert!(tested.insert(pair));
            let mut sorted = own.clone(); sorted.sort_unstable(); assert_eq!(sorted,vec![0,1,2,3,4,5]);
            Ok(json!({"scores":[101,121]}))
        }).unwrap();
        assert_eq!(tested.len(),14); assert_eq!(result["outcomes"].as_array().unwrap().len(),14);
        assert_eq!(result["sourceGame"],"train:0:2");
        assert!(result["outcomes"].as_array().unwrap().iter().all(|v|v["scores"]==json!([101,121])));
    }
    #[test]
    fn malformed_deals_are_rejected_before_any_continuation() {
        for (field,value) in [("selectedDiscard",json!([0,0])),("cut",json!(0)),
                              ("sourceGame",json!("eval:0")),("scores",json!([121,0]))] {
            let mut r=fixture(); r[field]=value;
            assert!(rejected_discards_with("unused",&r,|_,_,_| panic!("invalid context played")).is_err());
        }
    }
}
