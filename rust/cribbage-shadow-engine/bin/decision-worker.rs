//! Streaming benchmark adapter. This file can be built against a frozen engine
//! checkout without changing that checkout's model implementation or assets.
use cribbage_shadow_engine::model::{
    evaluate_decision_with_caches, parse_decision_input, Decision, DecisionKind, Model13HandCache,
    Model911HandCache,
};
use serde_json::json;
use std::io::{self, BufRead, Write};
use std::time::Instant;

fn cpu_ns() -> u64 {
    let mut time = std::mem::MaybeUninit::<libc::timespec>::uninit();
    // Process CPU time excludes waiting for another worker or the asset build.
    let status = unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, time.as_mut_ptr()) };
    assert_eq!(status, 0, "read process CPU clock");
    let time = unsafe { time.assume_init() };
    time.tv_sec as u64 * 1_000_000_000 + time.tv_nsec as u64
}

fn main() {
    let root = std::env::var("CRIBBAGE_RUST_MODEL_ROOT").expect("model root is required");
    let model = std::env::var("CRIBBAGE_FROZEN_MODEL").expect("frozen model is required");
    let cache = Model13HandCache::new();
    let cache911 = Model911HandCache::new();
    let trace = std::env::var("CRIBBAGE_DECISION_TRACE_DIR").ok().map(|directory| {
        std::fs::create_dir_all(&directory).expect("create trace directory");
        std::fs::OpenOptions::new().create(true).append(true)
            .open(format!("{directory}/{}.jsonl", std::process::id())).expect("open trace")
    });
    let mut trace = trace;
    for line in io::stdin().lock().lines() {
        let raw = line.as_ref().ok().cloned();
        let started = Instant::now();
        let cpu_started = cpu_ns();
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
        let mut response = match result {
            Ok(Decision::Discard { ev, win_probability, .. } | Decision::Peg { ev, win_probability, .. })
                if ev.is_some_and(|v| !v.is_finite()) || win_probability.is_some_and(|v| !v.is_finite()) =>
                json!({"ok":false,"model":model,"error":"nonfinite decision"}),
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
        response["cpuNs"] = json!(cpu_ns() - cpu_started);
        response["arithmeticBits"] = json!(std::mem::size_of::<f64>() * 8);
        response["elapsedUs"] = json!(started.elapsed().as_micros() as u64);
        if let Some(trace) = trace.as_mut() {
            writeln!(trace, "{}", json!({"request":raw,"response":response})).expect("write trace");
            trace.flush().expect("flush trace");
        }
        if writeln!(io::stdout(), "{response}").is_err() {
            break;
        }
        if io::stdout().flush().is_err() {
            break;
        }
    }
}
