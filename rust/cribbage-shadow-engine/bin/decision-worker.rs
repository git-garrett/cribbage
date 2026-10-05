//! Streaming benchmark adapter. This file can be built against a frozen engine
//! checkout without changing that checkout's model implementation or assets.
use cribbage_shadow_engine::model::{
    evaluate_decision_with_caches, parse_decision_input, Decision, DecisionKind, Model13HandCache,
    Model911HandCache,
};
use serde_json::json;
use std::io::{self, BufRead, Write};

fn main() {
    let root = std::env::var("CRIBBAGE_RUST_MODEL_ROOT").expect("model root is required");
    let model = std::env::var("CRIBBAGE_FROZEN_MODEL").expect("frozen model is required");
    let cache = Model13HandCache::new();
    let cache911 = Model911HandCache::new();
    for line in io::stdin().lock().lines() {
        let result = line.map_err(|e| e.to_string()).and_then(|line| {
            let request: serde_json::Value =
                serde_json::from_str(&line).map_err(|e| e.to_string())?;
            let input =
                parse_decision_input(request["inputText"].as_str().ok_or("missing inputText")?)?;
            if input.model != model {
                return Err("request differs from frozen model".into());
            }
            if input.kind == DecisionKind::Discard {
                cache.clear();
            }
            evaluate_decision_with_caches(&input, &root, Some(&cache911), Some(&cache))
        });
        let response = match result {
            Ok(Decision::Discard {
                card_ids,
                best_lead,
                ev,
                win_probability,
            }) => {
                json!({"ok":true,"model":model,"decision":{"cardIds":card_ids,"bestLead":best_lead,"ev":ev,"winProbability":win_probability}})
            }
            Ok(Decision::Peg {
                action,
                card_id,
                ev,
                win_probability,
                ..
            }) => {
                json!({"ok":true,"model":model,"decision":{"action":action,"cardId":card_id,"ev":ev,"winProbability":win_probability}})
            }
            Err(error) => json!({"ok":false,"model":model,"error":error}),
        };
        if writeln!(io::stdout(), "{response}").is_err() {
            break;
        }
        if io::stdout().flush().is_err() {
            break;
        }
    }
}
