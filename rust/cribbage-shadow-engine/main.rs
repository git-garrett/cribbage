use std::io::{self, BufRead, Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};

mod artifacts;
mod board;
mod cards;
mod model;

fn json_escape(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 8);
    for ch in value.chars() {
        match ch {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            c if c.is_control() => output.push_str(&format!("\\u{:04x}", c as u32)),
            c => output.push(c),
        }
    }
    output
}

fn extract_json_string(input: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\"", key);
    let key_pos = input.find(&needle)?;
    let after_key = &input[key_pos + needle.len()..];
    let colon_pos = after_key.find(':')?;
    let after_colon = after_key[colon_pos + 1..].trim_start();
    if !after_colon.starts_with('"') {
        return None;
    }
    let mut escaped = false;
    let mut result = String::new();
    for ch in after_colon[1..].chars() {
        if escaped {
            result.push(match ch {
                '"' => '"',
                '\\' => '\\',
                '/' => '/',
                'b' => '\u{0008}',
                'f' => '\u{000c}',
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            return Some(result);
        }
        result.push(ch);
    }
    None
}

struct Response {
    json: String,
    success: bool,
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn self_test_response(kind: &str, result: Result<(), String>, now_ms: u128) -> Response {
    match result {
        Ok(()) => Response {
            json: format!(
                concat!(
                    "{{",
                    "\"ok\":true,",
                    "\"engine\":\"rust-14.8-shadow\",",
                    "\"kind\":\"{}\",",
                    "\"supported\":true,",
                    "\"completedAtUnixMs\":{}",
                    "}}"
                ),
                json_escape(kind),
                now_ms
            ),
            success: true,
        },
        Err(error) => Response {
            json: format!(
                concat!(
                    "{{",
                    "\"ok\":false,",
                    "\"engine\":\"rust-14.8-shadow\",",
                    "\"kind\":\"{}\",",
                    "\"supported\":true,",
                    "\"completedAtUnixMs\":{},",
                    "\"error\":\"{}\"",
                    "}}"
                ),
                json_escape(kind),
                now_ms,
                json_escape(&error)
            ),
            success: false,
        },
    }
}

fn response_for_input(input: &str) -> Response {
    let kind = extract_json_string(&input, "kind").unwrap_or_else(|| "unknown".to_string());
    let action = extract_json_string(&input, "action").unwrap_or_else(|| "unknown".to_string());
    let model = extract_json_string(&input, "model").unwrap_or_else(|| "unknown".to_string());
    let now_ms = now_unix_ms();

    if kind == "self-test" {
        return self_test_response("self-test", cards::self_test(), now_ms);
    }

    if kind == "pairwise-self-test" {
        let root = std::env::var("CRIBBAGE_RUST_MODEL_ROOT").unwrap_or_else(|_| ".".to_string());
        return self_test_response("pairwise-self-test", artifacts::pairwise_self_test(&root), now_ms);
    }

    if kind == "empirical-self-test" {
        let root = std::env::var("CRIBBAGE_RUST_MODEL_ROOT").unwrap_or_else(|_| ".".to_string());
        return self_test_response("empirical-self-test", artifacts::empirical_self_test(&root), now_ms);
    }

    if kind == "model13-hold-self-test" {
        let root = std::env::var("CRIBBAGE_RUST_MODEL_ROOT").unwrap_or_else(|_| ".".to_string());
        return self_test_response("model13-hold-self-test", artifacts::model13_hold_self_test(&root), now_ms);
    }

    if let Some(input_text) = extract_json_string(&input, "inputText") {
        let root = std::env::var("CRIBBAGE_RUST_MODEL_ROOT").unwrap_or_else(|_| ".".to_string());
        return match model::parse_decision_input(&input_text)
            .and_then(|decision_input| model::evaluate_decision(&decision_input, &root))
        {
            Ok(decision) => Response {
                json: format!(
                    concat!(
                    "{{",
                    "\"ok\":true,",
                    "\"engine\":\"rust-14.8-shadow\",",
                    "\"supported\":true,",
                    "\"model\":\"{}\",",
                    "\"kind\":\"{}\",",
                    "\"action\":\"{}\",",
                    "\"decision\":{},",
                    "\"requestBytes\":{},",
                    "\"completedAtUnixMs\":{}",
                    "}}"
                ),
                    json_escape(&model),
                    json_escape(&kind),
                    json_escape(&action),
                    model::decision_json(&decision),
                    input.len(),
                    now_ms
                ),
                success: true,
            },
            Err(error) => Response {
                json: format!(
                    concat!(
                    "{{",
                    "\"ok\":false,",
                    "\"engine\":\"rust-14.8-shadow\",",
                    "\"supported\":true,",
                    "\"model\":\"{}\",",
                    "\"kind\":\"{}\",",
                    "\"action\":\"{}\",",
                    "\"requestBytes\":{},",
                    "\"completedAtUnixMs\":{},",
                    "\"error\":\"{}\"",
                    "}}"
                ),
                    json_escape(&model),
                    json_escape(&kind),
                    json_escape(&action),
                    input.len(),
                    now_ms,
                    json_escape(&error)
                ),
                success: false,
            },
        };
    }

    Response {
        json: format!(
            concat!(
            "{{",
            "\"ok\":true,",
            "\"engine\":\"rust-14.8-shadow\",",
            "\"supported\":false,",
            "\"model\":\"{}\",",
            "\"kind\":\"{}\",",
            "\"action\":\"{}\",",
            "\"requestBytes\":{},",
            "\"completedAtUnixMs\":{},",
            "\"reason\":\"14.8 Rust decision logic is not ported yet\"",
            "}}"
        ),
            json_escape(&model),
            json_escape(&kind),
            json_escape(&action),
            input.len(),
            now_ms
        ),
        success: true,
    }
}

fn main() {
    if std::env::var("CRIBBAGE_RUST_SHADOW_WORKER").as_deref() == Ok("1") {
        let stdin = io::stdin();
        let mut stdout = io::stdout();
        for line in stdin.lock().lines() {
            let response = match line {
                Ok(input) => response_for_input(&input),
                Err(error) => Response {
                    json: format!(
                        "{{\"ok\":false,\"engine\":\"rust-14.8-shadow\",\"supported\":false,\"reason\":\"stdin read failed: {}\"}}",
                        json_escape(&error.to_string())
                    ),
                    success: false,
                },
            };
            if writeln!(stdout, "{}", response.json).is_err() {
                break;
            }
            let _ = stdout.flush();
        }
        return;
    }

    let mut input = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut input) {
        println!(
            "{{\"ok\":false,\"engine\":\"rust-14.8-shadow\",\"supported\":false,\"reason\":\"stdin read failed: {}\"}}",
            json_escape(&error.to_string())
        );
        std::process::exit(1);
    }
    let response = response_for_input(&input);
    println!("{}", response.json);
    if !response.success {
        std::process::exit(1);
    }
}
