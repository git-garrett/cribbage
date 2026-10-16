//! Explicitly approximate, age-limited training cache. Production remains exact.
use super::*;
use crate::model29_snapshot as session;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

const BASELINE_POLICY: &str = "7c4c58c9100ef3f5388b0d5e3838b6542fb810e230451035d5dee2f5b6cfd2a8";

fn config() -> Result<Value, String> {
    let path = std::env::var("MODEL29_CACHE_CONFIG").map_err(|e| e.to_string())?;
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn clock(c: &Value) -> Result<u64, String> {
    let path = c["clock"].as_str().ok_or("missing cache clock")?;
    let value: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    value["completedGames"].as_u64().ok_or("invalid completed-game clock".into())
}
// Includes all inputs already guarded by the exact opening fingerprint, plus
// the training-only reader. A code change never extends an old chunk's life.
fn contract(s: &Solver) -> String {
    // Policy fingerprint also includes priors, which deliberately may lag.
    // The run pins source + executable separately from the generation identity.
    let _ = s;
    session::code_identity()
}
fn location(c: &Value, s: &Solver, p: &Position, lead: u8) -> Result<PathBuf, String> {
    let field=if c["baselineGeneration"].as_str()==Some(&session::generation()) {"referenceRoot"} else {"root"};
    Ok(shard_path(Path::new(c[field].as_str().ok_or("missing cache root")?), s.cut, p.scores, lead))
}
fn fresh(born: u64, now: u64, limit: u64) -> bool {
    now >= born && now - born < limit
}

pub(super) fn forecast(s: &mut Solver, p: &Position, next: &Position, own: &Hand,
    other: &[Hand], lead: u8, public_own: &[Hand]) -> Result<Option<Solved>, String> {
    if p.actor != 0 || p.path != 1 { return Ok(None); }
    let c = config()?;
    let now = clock(&c)?;
    let limit = c["maxAgeGames"].as_u64().filter(|n| *n > 0).ok_or("invalid cache age")?;
    let path = location(&c, s, p, lead)?;
    let mut baseline = shard_path(Path::new(c["baseline"].as_str().ok_or("missing inherited cache")?), s.cut, p.scores, lead);
    if !baseline.exists() {
        if let Some(tail)=c["baselineTail"].as_str() {baseline=shard_path(Path::new(tail),s.cut,p.scores,lead);}
    }
    let (path, policy, born, generation) = if path.exists() {
        // Header metadata and body are committed in the same atomic file.
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let n = u32::from_le_bytes(bytes.get(..4).ok_or("short training cache")?.try_into().unwrap()) as usize;
        if n > 8192 { return Err("invalid training header size".into()); }
        let h: Value = serde_json::from_slice(bytes.get(4..4+n).ok_or("short training header")?).map_err(|e| e.to_string())?;
        let age = h["training"]["bornGame"].as_u64().ok_or("missing cache birth")?;
        if h["training"]["code"] != contract(s) || !fresh(age, now, limit) {
            session::cache_event("expired", now.saturating_sub(age), "");
            return Ok(None);
        }
        (path, h["policy"].as_str().ok_or("missing cache policy")?.to_owned(), age,
            h["training"]["generation"].as_str().ok_or("missing cache generation")?.to_owned())
    } else if baseline.exists() && fresh(0, now, limit) {
        // This separately staged, immutable bank is accepted only by a run
        // whose generation-zero parity stage passed. Never relax production.
        if c["baselinePolicy"] != BASELINE_POLICY || c["code"] != contract(s) {
            return Err("inherited opening cache contract changed".into());
        }
        (baseline, BASELINE_POLICY.to_owned(), 0, "inherited-28.3".to_owned())
    } else {
        session::cache_event("misses", 0, "");
        return Ok(None);
    };
    let book = Book::read(&path, s.cut, p.scores, lead, &policy)?;
    let known = s.live.unwrap().known;
    let public = (book.dealer_plays < 3).then_some(public_own);
    let live = private_solve(s, &book, next, *own, other, &known, public)?;
    s.stats.opening_loaded_rows += book.rows.len() as u64;
    s.stats.opening_successes += 1;
    session::cache_event("hits", now-born, &generation);
    Ok(Some(Solved { table: Table::Constant(BAD), live }))
}

pub(super) fn capture(s: &mut Solver, p: &Position, next: &Position,
    own: &[Hand], other: &[Hand], i: usize, lead: u8) -> Result<Solved, String> {
    if !session::cache_enabled() || p.actor != 0 || p.path != 1 {
        return s.solve_live(next, own, other, Some(i));
    }
    let c = config()?;
    let born = clock(&c)?;
    s.opening_book = Some(Book::default());
    let solved = s.solve_live(next, own, other, Some(i))?;
    let mut book = s.opening_book.take().ok_or("missing captured opening")?;
    book.finish();
    let path = location(&c, s, p, lead)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    book.write_metadata(&path, s.cut, p.scores, lead, &fingerprint(s),
        Some(json!({"bornGame":born,"generation":session::generation(),"code":contract(s)})))?;
    session::cache_event("writes", 0, &session::generation());
    Ok(solved)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn age_is_since_computation_and_expires_at_the_limit() {
        assert!(fresh(10, 50_009, 50_000));
        assert!(!fresh(10, 50_010, 50_000));
        assert!(!fresh(10, 9, 50_000));
    }
}
