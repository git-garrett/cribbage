use cribbage_shadow_engine::game::Side;
use cribbage_shadow_engine::model::{
    model16_policy_stats, reset_model16_policy_stats, Model16PolicyMode, Model16PolicySource,
};
use cribbage_shadow_engine::model_id::ModelId;
use cribbage_shadow_engine::playout::{CompactPlayoutRecord, ModelPlayout, PlayoutResult};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process;
use std::process::{Command, Stdio};
use std::str::FromStr;
use std::sync::mpsc;
use std::thread;
use std::time::Instant;

#[derive(Clone, Debug)]
struct Config {
    left: ModelId,
    right: ModelId,
    games: u32,
    start_index: u32,
    total_games: u32,
    seed: u32,
    model_root: String,
    max_steps: u32,
    workers: u32,
    out_dir: Option<PathBuf>,
    db_path: Option<PathBuf>,
    run_id: String,
    matchup_id: String,
    model16_policy_mode: Model16PolicyMode,
}

#[derive(Clone, Debug, Default)]
struct Summary {
    games: u32,
    left_wins: u32,
    right_wins: u32,
    left_score: i64,
    right_score: i64,
    hands: u64,
    steps: u64,
}

fn main() {
    let config = match parse_args(env::args().skip(1).collect()) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{}", error);
            print_usage();
            process::exit(2);
        }
    };

    match run(config) {
        Ok(summary) => {
            let policy = model16_policy_stats();
            println!(
                concat!(
                    "{{",
                    "\"games\":{},",
                    "\"leftWins\":{},",
                    "\"rightWins\":{},",
                    "\"leftAvgScore\":{:.3},",
                    "\"rightAvgScore\":{:.3},",
                    "\"avgHands\":{:.3},",
                    "\"avgSteps\":{:.3},",
                    "\"model16PolicyLookups\":{},",
                    "\"model16PolicyHits\":{},",
                    "\"model16PolicyMisses\":{}",
                    "}}"
                ),
                summary.games,
                summary.left_wins,
                summary.right_wins,
                average(summary.left_score, summary.games),
                average(summary.right_score, summary.games),
                average(summary.hands as i64, summary.games),
                average(summary.steps as i64, summary.games),
                policy.lookups,
                policy.hits,
                policy.misses()
            );
        }
        Err(error) => {
            eprintln!("{}", error);
            process::exit(1);
        }
    }
}

fn run(config: Config) -> Result<Summary, String> {
    if !config.left.has_native_rust_decisions() {
        return Err(format!(
            "cannot run {}: native Rust decisions are not implemented yet",
            config.left
        ));
    }
    if !config.right.has_native_rust_decisions() {
        return Err(format!(
            "cannot run {}: native Rust decisions are not implemented yet",
            config.right
        ));
    }

    reset_model16_policy_stats();
    let mut summary = Summary::default();
    let started_at = iso_now();
    let started = Instant::now();
    if let Some(out_dir) = &config.out_dir {
        fs::create_dir_all(out_dir)
            .map_err(|error| format!("create out dir {} failed: {}", out_dir.display(), error))?;
    }
    if let Some(db_path) = &config.db_path {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create db dir {} failed: {}", parent.display(), error))?;
        }
        initialize_db(db_path, &config, &started_at)?;
    }
    write_status(
        &config,
        &summary,
        "running",
        started.elapsed().as_secs_f64(),
    )?;
    let (sender, receiver) = mpsc::channel();
    let worker_count = config.workers.min(config.games).max(1);
    for worker_index in 0..worker_count {
        let worker_config = config.clone();
        let sender = sender.clone();
        thread::spawn(move || {
            let mut index = worker_index;
            while index < worker_config.games {
                let game_index = worker_config.start_index + index;
                let result = run_game_index(&worker_config, game_index);
                if sender.send((index, result)).is_err() {
                    return;
                }
                index += worker_count;
            }
        });
    }
    drop(sender);
    for (index, result) in receiver {
        let (seed, result) = result?;
        if let Some(db_path) = &config.db_path {
            insert_game(
                db_path,
                &config,
                config.start_index + index,
                seed,
                &result,
                &started_at,
                &iso_now(),
            )?;
        }
        add_result_to_summary(&mut summary, &result);
        write_status(
            &config,
            &summary,
            "running",
            started.elapsed().as_secs_f64(),
        )?;
    }
    if let Some(db_path) = &config.db_path {
        mark_run_complete(db_path, &config.run_id, "complete")?;
    }
    write_status(
        &config,
        &summary,
        "complete",
        started.elapsed().as_secs_f64(),
    )?;
    Ok(summary)
}

fn run_game_index(config: &Config, index: u32) -> Result<(u32, PlayoutResult), String> {
    let first_deal = if index % 2 == 0 {
        Side::Left
    } else {
        Side::Right
    };
    let seed = config.seed.wrapping_add(index);
    let mut playout = ModelPlayout::new(seed, first_deal, config.left, config.right)?;
    playout.set_model16_policy_mode(config.model16_policy_mode);
    let result = playout.play_to_end(&config.model_root, config.max_steps)?;
    Ok((seed, result))
}

fn add_result_to_summary(summary: &mut Summary, result: &PlayoutResult) {
    summary.games += 1;
    match result.winner {
        Side::Left => summary.left_wins += 1,
        Side::Right => summary.right_wins += 1,
    }
    summary.left_score += i64::from(result.left_score);
    summary.right_score += i64::from(result.right_score);
    summary.hands += u64::from(result.hands);
    summary.steps += u64::from(result.steps);
}

fn parse_args(args: Vec<String>) -> Result<Config, String> {
    let mut left = ModelId::Schell150;
    let mut right = ModelId::Schell1481;
    let mut games = 1u32;
    let mut start_index = 0u32;
    let mut total_games: Option<u32> = None;
    let mut seed = 0x9e3779b9u32;
    let mut model_root = ".".to_string();
    let mut max_steps = 10_000u32;
    let mut workers = 1u32;
    let mut out_dir: Option<PathBuf> = None;
    let mut db_path: Option<PathBuf> = None;
    let mut run_id: Option<String> = None;
    let mut matchup_id: Option<String> = None;
    let mut model16_policy_mode = Model16PolicyMode::Argmax;

    let mut index = 0usize;
    while index < args.len() {
        let key = &args[index];
        if key == "--help" || key == "-h" {
            return Err("usage requested".to_string());
        }
        let Some(value) = args.get(index + 1) else {
            return Err(format!("missing value for {}", key));
        };
        match key.as_str() {
            "--left" => left = ModelId::from_str(value)?,
            "--right" => right = ModelId::from_str(value)?,
            "--games" => games = parse_u32("--games", value)?,
            "--start-index" => start_index = parse_u32("--start-index", value)?,
            "--total-games" => total_games = Some(parse_u32("--total-games", value)?),
            "--seed" => seed = parse_seed(value)?,
            "--model-root" => model_root = value.clone(),
            "--max-steps" => max_steps = parse_u32("--max-steps", value)?,
            "--workers" => workers = parse_u32("--workers", value)?,
            "--out-dir" => out_dir = Some(PathBuf::from(value)),
            "--db" => db_path = Some(PathBuf::from(value)),
            "--run-id" => run_id = Some(value.clone()),
            "--matchup-id" => matchup_id = Some(value.clone()),
            "--model16-policy-mode" => model16_policy_mode = parse_model16_policy_mode(value)?,
            other => return Err(format!("unknown argument: {}", other)),
        }
        index += 2;
    }

    if games == 0 {
        return Err("--games must be greater than zero".to_string());
    }
    if workers == 0 {
        return Err("--workers must be greater than zero".to_string());
    }
    let resolved_total_games = total_games.unwrap_or(start_index.saturating_add(games));
    if resolved_total_games < start_index.saturating_add(games) {
        return Err("--total-games must be at least --start-index + --games".to_string());
    }
    let resolved_run_id = run_id.unwrap_or_else(|| {
        out_dir
            .as_ref()
            .and_then(|path| path.file_name())
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
            .unwrap_or_else(|| {
                format!(
                    "rust-{}-vs-{}-{}",
                    model_slug(left),
                    model_slug(right),
                    seed
                )
            })
    });
    let resolved_matchup_id =
        matchup_id.unwrap_or_else(|| format!("{}__{}", model_slug(left), model_slug(right)));
    Ok(Config {
        left,
        right,
        games,
        start_index,
        total_games: resolved_total_games,
        seed,
        model_root,
        max_steps,
        workers,
        out_dir,
        db_path,
        run_id: resolved_run_id,
        matchup_id: resolved_matchup_id,
        model16_policy_mode,
    })
}

fn parse_u32(name: &str, value: &str) -> Result<u32, String> {
    value
        .parse::<u32>()
        .map_err(|error| format!("invalid {} value '{}': {}", name, value, error))
}

fn parse_seed(value: &str) -> Result<u32, String> {
    if let Some(hex) = value.strip_prefix("0x") {
        return u32::from_str_radix(hex, 16)
            .map_err(|error| format!("invalid --seed value '{}': {}", value, error));
    }
    parse_u32("--seed", value)
}

fn parse_model16_policy_mode(value: &str) -> Result<Model16PolicyMode, String> {
    match value {
        "argmax" => Ok(Model16PolicyMode::Argmax),
        "sample" => Ok(Model16PolicyMode::Sample),
        "fallback" => Ok(Model16PolicyMode::Fallback),
        other => Err(format!(
            "invalid --model16-policy-mode '{}'; expected argmax, sample, or fallback",
            other
        )),
    }
}

fn average(total: i64, count: u32) -> f64 {
    if count == 0 {
        0.0
    } else {
        total as f64 / f64::from(count)
    }
}

fn print_usage() {
    eprintln!(concat!(
        "Usage: cribbage-runner ",
        "--left <model> --right <model> --games <n> ",
        "[--start-index <n>] [--total-games <n>] ",
        "[--seed <u32|0xhex>] [--model-root <path>] [--max-steps <n>] ",
        "[--workers <n>] [--out-dir <path>] [--db <path>] [--run-id <id>] ",
        "[--model16-policy-mode <argmax|sample|fallback>]"
    ));
}

fn model_slug(model: ModelId) -> String {
    model
        .as_str()
        .replace("schell_table-peg_table-", "")
        .replace('.', "_")
}

fn status_path(config: &Config) -> Option<PathBuf> {
    config.out_dir.as_ref().map(|dir| dir.join("status.json"))
}

fn write_status(
    config: &Config,
    summary: &Summary,
    status: &str,
    elapsed_seconds: f64,
) -> Result<(), String> {
    let Some(path) = status_path(config) else {
        return Ok(());
    };
    let games_per_second = if elapsed_seconds > 0.0 {
        f64::from(summary.games) / elapsed_seconds
    } else {
        0.0
    };
    let completed = config.start_index.saturating_add(summary.games);
    let remaining = config.total_games.saturating_sub(completed);
    let estimated_remaining_seconds = if games_per_second > 0.0 {
        Some(f64::from(remaining) / games_per_second)
    } else {
        None
    };
    let policy = model16_policy_stats();
    let json = format!(
        concat!(
            "{{\n",
            "  \"status\": \"{}\",\n",
            "  \"updatedAt\": \"{}\",\n",
            "  \"runId\": \"{}\",\n",
            "  \"left\": \"{}\",\n",
            "  \"right\": \"{}\",\n",
            "  \"workers\": {},\n",
            "  \"savedGames\": {},\n",
            "  \"completedGames\": {},\n",
            "  \"totalGames\": {},\n",
            "  \"progressPercent\": {:.6},\n",
            "  \"gamesPerSecond\": {:.6},\n",
            "  \"estimatedRemainingSeconds\": {},\n",
            "  \"model16PolicyLookups\": {},\n",
            "  \"model16PolicyHits\": {},\n",
            "  \"model16PolicyMisses\": {},\n",
            "  \"gameDbPath\": {},\n",
            "  \"outDir\": {}\n",
            "}}\n"
        ),
        json_escape(status),
        iso_now(),
        json_escape(&config.run_id),
        json_escape(config.left.as_str()),
        json_escape(config.right.as_str()),
        config.workers,
        completed,
        completed,
        config.total_games,
        if config.total_games > 0 {
            f64::from(completed) * 100.0 / f64::from(config.total_games)
        } else {
            100.0
        },
        games_per_second,
        estimated_remaining_seconds
            .map(|value| format!("{:.3}", value))
            .unwrap_or_else(|| "null".to_string()),
        policy.lookups,
        policy.hits,
        policy.misses(),
        config
            .db_path
            .as_ref()
            .map(|path| format!("\"{}\"", json_escape(&path.to_string_lossy())))
            .unwrap_or_else(|| "null".to_string()),
        config
            .out_dir
            .as_ref()
            .map(|path| format!("\"{}\"", json_escape(&path.to_string_lossy())))
            .unwrap_or_else(|| "null".to_string())
    );
    fs::write(&path, json)
        .map_err(|error| format!("write status {} failed: {}", path.display(), error))
}

fn initialize_db(db_path: &Path, config: &Config, started_at: &str) -> Result<(), String> {
    let sql = format!(
        "{}\n{}\n",
        compact_schema_sql(),
        format!(
            concat!(
                "INSERT INTO ai_runs (run_id, out_dir, command, git_commit, run_seed, status, started_at, metadata_json) ",
                "VALUES ({}, {}, {}, {}, {}, 'running', {}, {}) ",
                "ON CONFLICT(run_id) DO UPDATE SET status='running', run_seed=excluded.run_seed, metadata_json=excluded.metadata_json;"
            ),
            sql_text(&config.run_id),
            sql_text(
                &config
                    .out_dir
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_default()
            ),
            sql_text(&env::args().collect::<Vec<_>>().join(" ")),
            sql_text(""),
            sql_text(&format!("{}", config.seed)),
            sql_text(started_at),
            sql_text(&format!(
                "{{\"left\":\"{}\",\"right\":\"{}\",\"workers\":{},\"model16PolicyMode\":\"{}\"}}",
                json_escape(config.left.as_str()),
                json_escape(config.right.as_str()),
                config.workers,
                model16_policy_mode_name(config.model16_policy_mode)
            ))
        )
    );
    run_sqlite(db_path, &sql)?;
    ensure_compact_schema_columns(db_path)
}

fn mark_run_complete(db_path: &Path, run_id: &str, status: &str) -> Result<(), String> {
    run_sqlite(
        db_path,
        &format!(
            "UPDATE ai_runs SET status = {}, completed_at = {} WHERE run_id = {};\n",
            sql_text(status),
            sql_text(&iso_now()),
            sql_text(run_id)
        ),
    )
}

fn insert_game(
    db_path: &Path,
    config: &Config,
    game_index: u32,
    seed: u32,
    result: &PlayoutResult,
    started_at: &str,
    ended_at: &str,
) -> Result<(), String> {
    let game_id = format!("{}:{}:{}", config.run_id, config.matchup_id, game_index);
    let mut sql = String::new();
    sql.push_str("BEGIN;\n");
    sql.push_str(&format!(
        "DELETE FROM compact_peg_plays WHERE game_id = {};\nDELETE FROM compact_discards WHERE game_id = {};\nDELETE FROM compact_hands WHERE game_id = {};\nDELETE FROM compact_games WHERE game_id = {};\n",
        sql_text(&game_id),
        sql_text(&game_id),
        sql_text(&game_id),
        sql_text(&game_id)
    ));
    sql.push_str(&format!(
        concat!(
            "INSERT INTO compact_games (game_id, run_id, matchup_id, game_index, random_seed, left_engine, right_engine, ",
            "winner, result, final_left_score, final_right_score, started_at, ended_at, reproducible, included_in_tables, source_log_path, log_detail, notes) ",
            "VALUES ({}, {}, {}, {}, {}, {}, {}, {}, 0, {}, {}, {}, {}, 1, 1, NULL, 'rust-compact', '');\n"
        ),
        sql_text(&game_id),
        sql_text(&config.run_id),
        sql_text(&config.matchup_id),
        game_index,
        sql_text(&format!("{}", seed)),
        sql_text(config.left.as_str()),
        sql_text(config.right.as_str()),
        side_code(result.winner),
        result.left_score,
        result.right_score,
        sql_text(started_at),
        sql_text(ended_at)
    ));
    append_hand_rows(&mut sql, &game_id, &result.record);
    append_discard_rows(&mut sql, &game_id, &result.record);
    append_peg_rows(&mut sql, &game_id, &result.record);
    sql.push_str("COMMIT;\n");
    run_sqlite(db_path, &sql)
}

fn append_hand_rows(sql: &mut String, game_id: &str, record: &CompactPlayoutRecord) {
    for hand in &record.hands {
        sql.push_str(&format!(
            concat!(
                "INSERT OR REPLACE INTO compact_hands (game_id, hand_number, dealer, pone, start_left_score, start_right_score, ",
                "end_left_score, end_right_score, cut_card, left_dealt, right_dealt, left_keep, right_keep, crib, peg_sequence, ",
                "left_pegging_points, right_pegging_points, left_hand_points, right_hand_points, crib_points, ",
                "left_available_pegging_points, right_available_pegging_points, left_available_hand_points, ",
                "right_available_hand_points, available_crib_points) ",
                "VALUES ({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, NULL, {}, {}, {}, {}, {}, {}, {}, {}, {}, {});\n"
            ),
            sql_text(game_id),
            hand.hand_number,
            side_code(hand.dealer),
            side_code(hand.pone),
            hand.start_left_score,
            hand.start_right_score,
            sql_opt_i32(hand.end_left_score),
            sql_opt_i32(hand.end_right_score),
            compact_card_id(hand.cut_card),
            sql_card_blob(&hand.left_dealt),
            sql_card_blob(&hand.right_dealt),
            sql_card_blob(&hand.left_keep),
            sql_card_blob(&hand.right_keep),
            sql_card_blob(&hand.crib),
            hand.left_pegging_points,
            hand.right_pegging_points,
            hand.left_hand_points,
            hand.right_hand_points,
            hand.crib_points,
            hand.left_available_pegging_points,
            hand.right_available_pegging_points,
            hand.left_available_hand_points,
            hand.right_available_hand_points,
            hand.available_crib_points
        ));
    }
}

fn append_discard_rows(sql: &mut String, game_id: &str, record: &CompactPlayoutRecord) {
    for discard in &record.discards {
        sql.push_str(&format!(
            concat!(
                "INSERT OR REPLACE INTO compact_discards (game_id, hand_number, player, role, model, selected_ev, selected_win_probability, ",
                "recommended_win_probability, win_probability_delta, decision_elapsed_us, cards, hand_before, remaining_hand, crib_after_discard, left_score, right_score) ",
                "VALUES ({}, {}, {}, {}, {}, {}, {}, {}, 0, {}, {}, {}, {}, {}, {}, {});\n"
            ),
            sql_text(game_id),
            discard.hand_number,
            side_code(discard.player),
            role_code(discard.role),
            sql_text(discard.model.as_str()),
            sql_opt_f64(discard.selected_ev),
            sql_opt_f64(discard.selected_win_probability),
            sql_opt_f64(discard.selected_win_probability),
            sql_opt_u64(discard.decision_elapsed_us),
            sql_card_blob(&discard.cards),
            sql_card_blob(&discard.hand_before),
            sql_card_blob(&discard.remaining_hand),
            sql_card_blob(&discard.crib_after_discard),
            discard.left_score,
            discard.right_score
        ));
    }
}

fn append_peg_rows(sql: &mut String, game_id: &str, record: &CompactPlayoutRecord) {
    for play in &record.peg_plays {
        sql.push_str(&format!(
            concat!(
                "INSERT OR REPLACE INTO compact_peg_plays (game_id, hand_number, sequence, player, role, model, selected_ev, ",
                "selected_win_probability, model16_policy_source, model16_policy_confidence, model16_policy_selected_weight, ",
                "decision_elapsed_us, legal_count, action, card, count_before, count_after, points, left_score, right_score) ",
                "VALUES ({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {});\n"
            ),
            sql_text(game_id),
            play.hand_number,
            play.sequence,
            sql_opt_side(play.player),
            sql_opt_role(play.role),
            play.model.map(|model| sql_text(model.as_str())).unwrap_or_else(|| "NULL".to_string()),
            sql_opt_f64(play.selected_ev),
            sql_opt_f64(play.selected_win_probability),
            play.model16_policy
                .map(|trace| sql_text(model16_policy_source_name(trace.source)))
                .unwrap_or_else(|| "NULL".to_string()),
            play.model16_policy
                .and_then(|trace| trace.confidence)
                .map(|value| value.to_string())
                .unwrap_or_else(|| "NULL".to_string()),
            play.model16_policy
                .and_then(|trace| trace.selected_weight)
                .map(|value| value.to_string())
                .unwrap_or_else(|| "NULL".to_string()),
            sql_opt_u64(play.decision_elapsed_us),
            play.legal_count.map(|count| count.to_string()).unwrap_or_else(|| "NULL".to_string()),
            play.action,
            play.card.map(compact_card_id).map(|id| id.to_string()).unwrap_or_else(|| "NULL".to_string()),
            play.count_before,
            play.count_after,
            play.points,
            play.left_score,
            play.right_score
        ));
    }
}

fn compact_schema_sql() -> &'static str {
    r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS ai_runs (
  run_id TEXT PRIMARY KEY,
  out_dir TEXT NOT NULL,
  command TEXT,
  git_commit TEXT,
  run_seed TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  included_in_tables INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS ai_run_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS compact_games (
  game_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  matchup_id TEXT NOT NULL,
  game_index INTEGER NOT NULL,
  random_seed TEXT NOT NULL DEFAULT '',
  left_engine TEXT NOT NULL,
  right_engine TEXT NOT NULL,
  winner INTEGER,
  result INTEGER,
  final_left_score INTEGER,
  final_right_score INTEGER,
  started_at TEXT,
  ended_at TEXT,
  reproducible INTEGER NOT NULL DEFAULT 1,
  included_in_tables INTEGER NOT NULL DEFAULT 1,
  source_log_path TEXT,
  log_detail TEXT NOT NULL DEFAULT 'compact',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_compact_games_run_index ON compact_games(run_id, matchup_id, game_index);
CREATE INDEX IF NOT EXISTS idx_compact_games_run ON compact_games(run_id);
CREATE INDEX IF NOT EXISTS idx_compact_games_models ON compact_games(left_engine, right_engine);
CREATE TABLE IF NOT EXISTS compact_hands (
  game_id TEXT NOT NULL,
  hand_number INTEGER NOT NULL,
  dealer INTEGER NOT NULL,
  pone INTEGER NOT NULL,
  start_left_score INTEGER,
  start_right_score INTEGER,
  end_left_score INTEGER,
  end_right_score INTEGER,
  cut_card INTEGER,
  left_dealt BLOB,
  right_dealt BLOB,
  left_keep BLOB,
  right_keep BLOB,
  crib BLOB,
  peg_sequence BLOB,
  left_pegging_points INTEGER NOT NULL DEFAULT 0,
  right_pegging_points INTEGER NOT NULL DEFAULT 0,
  left_hand_points INTEGER NOT NULL DEFAULT 0,
  right_hand_points INTEGER NOT NULL DEFAULT 0,
  crib_points INTEGER NOT NULL DEFAULT 0,
  left_available_pegging_points INTEGER NOT NULL DEFAULT 0,
  right_available_pegging_points INTEGER NOT NULL DEFAULT 0,
  left_available_hand_points INTEGER NOT NULL DEFAULT 0,
  right_available_hand_points INTEGER NOT NULL DEFAULT 0,
  available_crib_points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, hand_number)
);
CREATE TABLE IF NOT EXISTS compact_peg_plays (
  game_id TEXT NOT NULL,
  hand_number INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  player INTEGER,
  role INTEGER,
  model TEXT,
  selected_ev REAL,
  selected_win_probability REAL,
  model16_policy_source TEXT,
  model16_policy_confidence INTEGER,
  model16_policy_selected_weight INTEGER,
  decision_elapsed_us INTEGER,
  legal_count INTEGER,
  action INTEGER NOT NULL,
  card INTEGER,
  count_before INTEGER,
  count_after INTEGER,
  points INTEGER NOT NULL DEFAULT 0,
  left_score INTEGER,
  right_score INTEGER,
  PRIMARY KEY (game_id, hand_number, sequence)
);
CREATE TABLE IF NOT EXISTS compact_discards (
  game_id TEXT NOT NULL,
  hand_number INTEGER NOT NULL,
  player INTEGER NOT NULL,
  role INTEGER NOT NULL,
  model TEXT,
  selected_ev REAL,
  selected_win_probability REAL,
  recommended_win_probability REAL,
  win_probability_delta REAL,
  decision_elapsed_us INTEGER,
  cards BLOB,
  hand_before BLOB,
  remaining_hand BLOB,
  crib_after_discard BLOB,
  left_score INTEGER,
  right_score INTEGER,
  PRIMARY KEY (game_id, hand_number, player)
);
CREATE INDEX IF NOT EXISTS idx_compact_discards_model ON compact_discards(model, role);
"#
}

fn ensure_compact_schema_columns(db_path: &Path) -> Result<(), String> {
    let hand_columns = sqlite_table_columns(db_path, "compact_hands")?;
    let hand_migrations = [
        (
            "left_available_pegging_points",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "right_available_pegging_points",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        ("left_available_hand_points", "INTEGER NOT NULL DEFAULT 0"),
        ("right_available_hand_points", "INTEGER NOT NULL DEFAULT 0"),
        ("available_crib_points", "INTEGER NOT NULL DEFAULT 0"),
    ];
    let mut sql = String::new();
    for (column, definition) in hand_migrations {
        if !hand_columns.iter().any(|existing| existing == column) {
            sql.push_str(&format!(
                "ALTER TABLE compact_hands ADD COLUMN {} {};\n",
                column, definition
            ));
        }
    }
    let discard_columns = sqlite_table_columns(db_path, "compact_discards")?;
    if !discard_columns
        .iter()
        .any(|existing| existing == "decision_elapsed_us")
    {
        sql.push_str("ALTER TABLE compact_discards ADD COLUMN decision_elapsed_us INTEGER;\n");
    }
    let peg_columns = sqlite_table_columns(db_path, "compact_peg_plays")?;
    if !peg_columns
        .iter()
        .any(|existing| existing == "decision_elapsed_us")
    {
        sql.push_str("ALTER TABLE compact_peg_plays ADD COLUMN decision_elapsed_us INTEGER;\n");
    }
    let policy_columns = [
        ("model16_policy_source", "TEXT"),
        ("model16_policy_confidence", "INTEGER"),
        ("model16_policy_selected_weight", "INTEGER"),
    ];
    for (column, definition) in policy_columns {
        if !peg_columns.iter().any(|existing| existing == column) {
            sql.push_str(&format!(
                "ALTER TABLE compact_peg_plays ADD COLUMN {} {};\n",
                column, definition
            ));
        }
    }
    if sql.is_empty() {
        Ok(())
    } else {
        run_sqlite(db_path, &sql)
    }
}

fn sqlite_table_columns(db_path: &Path, table_name: &str) -> Result<Vec<String>, String> {
    let output = Command::new("sqlite3")
        .arg(db_path)
        .arg(format!("PRAGMA table_info({});", table_name))
        .output()
        .map_err(|error| format!("sqlite3 table info failed: {}", error))?;
    if !output.status.success() {
        return Err(format!(
            "sqlite3 table info failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split('|').nth(1))
        .map(|name| name.to_string())
        .collect())
}

fn run_sqlite(db_path: &Path, sql: &str) -> Result<(), String> {
    let mut child = Command::new("sqlite3")
        .arg(db_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("spawn sqlite3 failed: {}", error))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| "sqlite3 stdin unavailable".to_string())?
        .write_all(sql.as_bytes())
        .map_err(|error| format!("write sqlite3 stdin failed: {}", error))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("wait sqlite3 failed: {}", error))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "sqlite3 failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

fn side_code(side: Side) -> u8 {
    match side {
        Side::Left => 0,
        Side::Right => 1,
    }
}

fn role_code(role: cribbage_shadow_engine::board::Role) -> u8 {
    match role {
        cribbage_shadow_engine::board::Role::Pone => 0,
        cribbage_shadow_engine::board::Role::Dealer => 1,
    }
}

fn model16_policy_mode_name(mode: Model16PolicyMode) -> &'static str {
    match mode {
        Model16PolicyMode::Argmax => "argmax",
        Model16PolicyMode::Sample => "sample",
        Model16PolicyMode::Fallback => "fallback",
    }
}

fn model16_policy_source_name(source: Model16PolicySource) -> &'static str {
    match source {
        Model16PolicySource::Learned => "learned",
        Model16PolicySource::Scorer => "scorer",
        Model16PolicySource::Fallback => "fallback",
    }
}

fn compact_card_id(card: cribbage_shadow_engine::cards::Card) -> u8 {
    (card.rank * 4) + card.suit
}

fn sql_card_blob(cards: &[cribbage_shadow_engine::cards::Card]) -> String {
    let mut hex = String::new();
    for card in cards {
        hex.push_str(&format!("{:02x}", compact_card_id(*card)));
    }
    format!("X'{}'", hex)
}

fn sql_text(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn sql_opt_i32(value: Option<i32>) -> String {
    value
        .map(|item| item.to_string())
        .unwrap_or_else(|| "NULL".to_string())
}

fn sql_opt_f64(value: Option<f64>) -> String {
    value
        .filter(|item| item.is_finite())
        .map(|item| format!("{:.12}", item))
        .unwrap_or_else(|| "NULL".to_string())
}

fn sql_opt_u64(value: Option<u64>) -> String {
    value
        .map(|item| item.to_string())
        .unwrap_or_else(|| "NULL".to_string())
}

fn sql_opt_side(value: Option<Side>) -> String {
    value
        .map(|side| side_code(side).to_string())
        .unwrap_or_else(|| "NULL".to_string())
}

fn sql_opt_role(value: Option<cribbage_shadow_engine::board::Role>) -> String {
    value
        .map(|role| role_code(role).to_string())
        .unwrap_or_else(|| "NULL".to_string())
}

fn json_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn iso_now() -> String {
    let output = Command::new("date")
        .arg("-u")
        .arg("+%Y-%m-%dT%H:%M:%SZ")
        .output();
    if let Ok(output) = output {
        if output.status.success() {
            return String::from_utf8_lossy(&output.stdout).trim().to_string();
        }
    }
    "1970-01-01T00:00:00Z".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model16_policy_ablation_modes() {
        for (name, expected) in [
            ("argmax", Model16PolicyMode::Argmax),
            ("sample", Model16PolicyMode::Sample),
            ("fallback", Model16PolicyMode::Fallback),
        ] {
            assert_eq!(parse_model16_policy_mode(name).unwrap(), expected);
        }
        assert!(parse_model16_policy_mode("other").is_err());
    }

    #[test]
    fn compact_schema_contains_model16_decision_telemetry() {
        let schema = compact_schema_sql();
        assert!(schema.contains("model16_policy_source TEXT"));
        assert!(schema.contains("model16_policy_confidence INTEGER"));
        assert!(schema.contains("model16_policy_selected_weight INTEGER"));
    }
}
