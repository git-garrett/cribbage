//! Streaming saved-choice reviews, with an explicit evaluator on every request.
use cribbage_shadow_engine::model::{parse_decision_input, review_decision, Decision};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    id: String,
    model: String,
    input_text: String,
    selected_card_ids: Vec<u8>,
}

fn value(decision: Decision) -> Result<Value, String> {
    match decision {
        Decision::Discard {
            card_ids,
            ev,
            win_probability,
            ..
        } => Ok(json!({"cardIds":card_ids,"ev":ev,"winProbability":win_probability})),
        Decision::Peg {
            action,
            card_id: Some(id),
            ev,
            win_probability,
            ..
        } if action == "play" => {
            Ok(json!({"cardIds":[id],"ev":ev,"winProbability":win_probability}))
        }
        _ => Err("saved review must select cards".into()),
    }
}

fn review(request: &Request, root: &str) -> Result<Value, String> {
    let input = parse_decision_input(&request.input_text)?;
    if input.model != request.model {
        return Err("input differs from requested evaluator".into());
    }
    let result = review_decision(&input, &request.selected_card_ids, root)?;
    Ok(json!({"selected":value(result.selected)?,"recommended":value(result.recommended)?}))
}

fn main() {
    let root = std::env::var("CRIBBAGE_RUST_MODEL_ROOT").expect("model root is required");
    let stdout = io::stdout();
    let mut output = stdout.lock();
    for line in io::stdin().lock().lines() {
        let response = match line
            .map_err(|e| e.to_string())
            .and_then(|line| serde_json::from_str::<Request>(&line).map_err(|e| e.to_string()))
        {
            Ok(request) => match review(&request, &root) {
                Ok(result) => {
                    json!({"ok":true,"id":request.id,"model":request.model,"review":result})
                }
                Err(error) => {
                    json!({"ok":false,"id":request.id,"model":request.model,"error":error})
                }
            },
            Err(error) => json!({"ok":false,"error":error}),
        };
        if writeln!(output, "{response}")
            .and_then(|_| output.flush())
            .is_err()
        {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mismatched_evaluator_cannot_be_mislabeled_as_a_historical_review() {
        let request = Request {
            id: "saved-choice".into(),
            model: "schell_table-peg_table-13.0".into(),
            input_text:
                "kind=peg;model=schell_table-peg_table-28.3.fast;role=pone;aiHand=1,2;turnCard=4"
                    .into(),
            selected_card_ids: vec![1],
        };
        assert_eq!(
            review(&request, "/unused").unwrap_err(),
            "input differs from requested evaluator"
        );
    }
}
