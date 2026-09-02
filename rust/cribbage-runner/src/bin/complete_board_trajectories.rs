use cribbage_shadow_engine::game::Side;
use cribbage_shadow_engine::model_id::ModelId;
use cribbage_shadow_engine::playout::{CompactHandRecord, ModelPlayout};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::mpsc;
use std::thread;

#[derive(Clone, Debug)]
struct Config {
    source_db: PathBuf,
    out_db: PathBuf,
    model_root: String,
    workers: usize,
    start_ordinal: usize,
    count: Option<usize>,
    max_steps: u32,
}

#[derive(Clone, Debug)]
struct GameKey {
    game_id: String,
    matchup_id: String,
    game_index: i64,
}

#[derive(Clone, Debug)]
struct StoredGame {
    key: GameKey,
    random_seed: u32,
    random_seed_text: String,
    left_model: ModelId,
    right_model: ModelId,
    terminal_hand: u32,
    dealer: Side,
    start_left_score: i32,
    start_right_score: i32,
    left_dealt: Vec<u8>,
    right_dealt: Vec<u8>,
    cut_card: u8,
    discards: Vec<(Side, Vec<u8>)>,
    peg_actions: Vec<(u8, Option<u8>)>,
}

#[derive(Clone, Debug)]
struct ScoreEvent {
    hand_number: u32,
    dealer: Side,
    player: Side,
    phase: &'static str,
    points: i32,
}

#[derive(Clone, Debug)]
struct CompletedGame {
    source: StoredGame,
    final_left_score: i32,
    final_right_score: i32,
    final_hand: u32,
    steps: u32,
    events: Vec<ScoreEvent>,
}

fn main() {
    if let Err(error) = run(parse_args(env::args().skip(1).collect())) {
        eprintln!("{}", error);
        std::process::exit(1);
    }
}

fn parse_args(args: Vec<String>) -> Result<Config, String> {
    let mut source_db = None;
    let mut out_db = None;
    let mut model_root = ".".to_string();
    let mut workers = 1usize;
    let mut start_ordinal = 0usize;
    let mut count = None;
    let mut max_steps = 10_000u32;
    let mut index = 0usize;
    while index < args.len() {
        let flag = &args[index];
        index += 1;
        let value = args
            .get(index)
            .ok_or_else(|| format!("missing value for {}", flag))?;
        index += 1;
        match flag.as_str() {
            "--source-db" => source_db = Some(PathBuf::from(value)),
            "--out-db" => out_db = Some(PathBuf::from(value)),
            "--model-root" => model_root = value.clone(),
            "--workers" => workers = parse_positive(value, flag)?,
            "--start-ordinal" => {
                start_ordinal = value
                    .parse::<usize>()
                    .map_err(|error| format!("invalid {} '{}': {}", flag, value, error))?
            }
            "--count" => count = Some(parse_positive(value, flag)?),
            "--max-steps" => {
                max_steps = value
                    .parse::<u32>()
                    .map_err(|error| format!("invalid {} '{}': {}", flag, value, error))?
            }
            other => return Err(format!("unknown argument {}", other)),
        }
    }
    Ok(Config {
        source_db: source_db.ok_or_else(|| "--source-db is required".to_string())?,
        out_db: out_db.ok_or_else(|| "--out-db is required".to_string())?,
        model_root,
        workers,
        start_ordinal,
        count,
        max_steps,
    })
}

fn parse_positive(value: &str, flag: &str) -> Result<usize, String> {
    let parsed = value
        .parse::<usize>()
        .map_err(|error| format!("invalid {} '{}': {}", flag, value, error))?;
    if parsed == 0 {
        return Err(format!("{} must be positive", flag));
    }
    Ok(parsed)
}

fn run(config: Result<Config, String>) -> Result<(), String> {
    let config = config?;
    if !config.source_db.is_file() {
        return Err(format!(
            "source database does not exist: {}",
            config.source_db.display()
        ));
    }
    if let Some(parent) = config.out_db.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create {} failed: {}", parent.display(), error))?;
    }
    let mut output = Connection::open(&config.out_db)
        .map_err(|error| format!("open {} failed: {}", config.out_db.display(), error))?;
    initialize_output(&output)?;
    let completed = completed_ids(&output)?;
    let source = Connection::open(&config.source_db)
        .map_err(|error| format!("open {} failed: {}", config.source_db.display(), error))?;
    let mut keys = load_game_keys(&source)?;
    keys = keys
        .into_iter()
        .skip(config.start_ordinal)
        .take(config.count.unwrap_or(usize::MAX))
        .filter(|key| !completed.contains(&key.game_id))
        .collect();
    let total = keys.len();
    if total == 0 {
        println!("{{\"status\":\"complete\",\"completed\":0}}");
        return Ok(());
    }

    let worker_count = config.workers.min(total).max(1);
    let (sender, receiver) = mpsc::channel();
    for worker_index in 0..worker_count {
        let sender = sender.clone();
        let source_db = config.source_db.clone();
        let model_root = config.model_root.clone();
        let worker_keys: Vec<GameKey> = keys
            .iter()
            .skip(worker_index)
            .step_by(worker_count)
            .cloned()
            .collect();
        let max_steps = config.max_steps;
        thread::spawn(move || {
            let connection = match Connection::open(&source_db) {
                Ok(connection) => connection,
                Err(error) => {
                    let _ = sender.send(Err(format!(
                        "worker open {} failed: {}",
                        source_db.display(),
                        error
                    )));
                    return;
                }
            };
            for key in worker_keys {
                let result = load_stored_game(&connection, key)
                    .and_then(|game| complete_game(game, &model_root, max_steps));
                if sender.send(result).is_err() {
                    return;
                }
            }
        });
    }
    drop(sender);

    let mut written = 0usize;
    for result in receiver {
        let game = result?;
        write_completed_game(&mut output, &config.source_db, &game)?;
        written += 1;
        if written % 100 == 0 || written == total {
            eprintln!("completed {}/{} trajectories", written, total);
        }
    }
    if written != total {
        return Err(format!("received {} results for {} games", written, total));
    }
    println!(
        "{{\"status\":\"complete\",\"completed\":{},\"workers\":{}}}",
        written, worker_count
    );
    Ok(())
}

fn initialize_output(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS trajectory_games (
  source_game_id TEXT PRIMARY KEY,
  source_db TEXT NOT NULL,
  matchup_id TEXT NOT NULL,
  game_index INTEGER NOT NULL,
  random_seed TEXT NOT NULL,
  left_engine TEXT NOT NULL,
  right_engine TEXT NOT NULL,
  terminal_hand_number INTEGER NOT NULL,
  terminal_start_left_score INTEGER NOT NULL,
  terminal_start_right_score INTEGER NOT NULL,
  final_left_score INTEGER NOT NULL,
  final_right_score INTEGER NOT NULL,
  final_hand_number INTEGER NOT NULL,
  continuation_steps INTEGER NOT NULL,
  event_count INTEGER NOT NULL,
  reconstruction_verified INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trajectory_events (
  source_game_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  hand_number INTEGER NOT NULL,
  dealer INTEGER NOT NULL,
  player INTEGER NOT NULL,
  phase TEXT NOT NULL,
  points INTEGER NOT NULL,
  PRIMARY KEY (source_game_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_trajectory_games_matchup
  ON trajectory_games(matchup_id, game_index);
"#,
        )
        .map_err(|error| format!("initialize output failed: {}", error))
}

fn completed_ids(connection: &Connection) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare("SELECT source_game_id FROM trajectory_games")
        .map_err(|error| format!("prepare completed IDs failed: {}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("query completed IDs failed: {}", error))?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|error| format!("read completed IDs failed: {}", error))
}

fn load_game_keys(connection: &Connection) -> Result<Vec<GameKey>, String> {
    let mut statement = connection
        .prepare(
            "SELECT game_id, matchup_id, game_index FROM compact_games \
             WHERE reproducible = 1 AND included_in_tables = 1 \
             ORDER BY matchup_id, game_index, game_id",
        )
        .map_err(|error| format!("prepare game list failed: {}", error))?;
    let rows = statement
        .query_map([], |row| {
            Ok(GameKey {
                game_id: row.get(0)?,
                matchup_id: row.get(1)?,
                game_index: row.get(2)?,
            })
        })
        .map_err(|error| format!("query game list failed: {}", error))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read game list failed: {}", error))
}

fn load_stored_game(connection: &Connection, key: GameKey) -> Result<StoredGame, String> {
    let game = connection
        .query_row(
            r#"
SELECT g.random_seed, g.left_engine, g.right_engine,
       h.hand_number, h.dealer, h.start_left_score, h.start_right_score,
       h.left_dealt, h.right_dealt, h.cut_card
FROM compact_games g
JOIN compact_hands h ON h.game_id = g.game_id
WHERE g.game_id = ?1
  AND h.hand_number = (SELECT MAX(hand_number) FROM compact_hands WHERE game_id = g.game_id)
"#,
            [&key.game_id],
            |row| {
                let seed_text: String = row.get(0)?;
                let left_text: String = row.get(1)?;
                let right_text: String = row.get(2)?;
                Ok((
                    seed_text,
                    left_text,
                    right_text,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Vec<u8>>(7)?,
                    row.get::<_, Vec<u8>>(8)?,
                    row.get::<_, i64>(9)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("load {} failed: {}", key.game_id, error))?
        .ok_or_else(|| format!("{} has no terminal hand", key.game_id))?;
    let random_seed = game
        .0
        .parse::<u32>()
        .map_err(|error| format!("{} has non-Rust seed '{}': {}", key.game_id, game.0, error))?;
    let left_model = ModelId::from_str(&game.1)?;
    let right_model = ModelId::from_str(&game.2)?;
    let terminal_hand = u32::try_from(game.3)
        .map_err(|_| format!("{} has invalid terminal hand {}", key.game_id, game.3))?;
    let dealer = parse_side(game.4)?;
    let cut_card = u8::try_from(game.9)
        .map_err(|_| format!("{} has invalid cut card {}", key.game_id, game.9))?;

    let mut discards = Vec::new();
    let mut statement = connection
        .prepare(
            "SELECT player, cards FROM compact_discards \
             WHERE game_id = ?1 AND hand_number = ?2 ORDER BY player",
        )
        .map_err(|error| format!("prepare terminal discards failed: {}", error))?;
    let rows = statement
        .query_map(params![key.game_id, terminal_hand], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
        })
        .map_err(|error| format!("query terminal discards failed: {}", error))?;
    for row in rows {
        let (side, cards) = row.map_err(|error| format!("read terminal discard failed: {}", error))?;
        discards.push((parse_side(side)?, cards));
    }

    let mut peg_actions = Vec::new();
    let mut statement = connection
        .prepare(
            "SELECT action, card FROM compact_peg_plays \
             WHERE game_id = ?1 AND hand_number = ?2 ORDER BY sequence",
        )
        .map_err(|error| format!("prepare terminal pegging failed: {}", error))?;
    let rows = statement
        .query_map(params![key.game_id, terminal_hand], |row| {
            let action = row.get::<_, i64>(0)?;
            let card = row.get::<_, Option<i64>>(1)?;
            Ok((action, card))
        })
        .map_err(|error| format!("query terminal pegging failed: {}", error))?;
    for row in rows {
        let (action, card) = row.map_err(|error| format!("read terminal pegging failed: {}", error))?;
        peg_actions.push((
            u8::try_from(action).map_err(|_| format!("invalid pegging action {}", action))?,
            card.map(u8::try_from)
                .transpose()
                .map_err(|_| format!("invalid pegging card {:?}", card))?,
        ));
    }

    Ok(StoredGame {
        key,
        random_seed,
        random_seed_text: game.0,
        left_model,
        right_model,
        terminal_hand,
        dealer,
        start_left_score: i32::try_from(game.5).map_err(|_| "left score out of range")?,
        start_right_score: i32::try_from(game.6).map_err(|_| "right score out of range")?,
        left_dealt: game.7,
        right_dealt: game.8,
        cut_card,
        discards,
        peg_actions,
    })
}

fn complete_game(
    source: StoredGame,
    model_root: &str,
    max_steps: u32,
) -> Result<CompletedGame, String> {
    let first_deal = if source.terminal_hand % 2 == 1 {
        source.dealer
    } else {
        source.dealer.other()
    };
    let mut playout = ModelPlayout::new_at_hand(
        source.random_seed,
        first_deal,
        source.terminal_hand,
        source.start_left_score,
        source.start_right_score,
        source.left_model,
        source.right_model,
    )?;
    verify_terminal_deal(&source, &playout)?;
    let result = playout.play_until_both_reach(model_root, 121, 121, max_steps)?;
    verify_terminal_decisions(&source, &result.record)?;
    let events = score_events(&result.record);
    if events.is_empty() {
        return Err(format!("{} produced no continuation events", source.key.game_id));
    }
    Ok(CompletedGame {
        source,
        final_left_score: result.left_score,
        final_right_score: result.right_score,
        final_hand: result.hands,
        steps: result.steps,
        events,
    })
}

fn verify_terminal_deal(source: &StoredGame, playout: &ModelPlayout) -> Result<(), String> {
    let ids = |side| {
        playout
            .game
            .player(side)
            .hand
            .iter()
            .copied()
            .map(compact_card_id)
            .collect::<Vec<_>>()
    };
    if playout.game.dealer != source.dealer
        || ids(Side::Left) != source.left_dealt
        || ids(Side::Right) != source.right_dealt
        || compact_card_id(playout.game.turn_card) != source.cut_card
    {
        return Err(format!(
            "{} terminal deal reconstruction mismatch",
            source.key.game_id
        ));
    }
    Ok(())
}

fn verify_terminal_decisions(
    source: &StoredGame,
    record: &cribbage_shadow_engine::playout::CompactPlayoutRecord,
) -> Result<(), String> {
    let generated_discards: Vec<(Side, Vec<u8>)> = record
        .discards
        .iter()
        .filter(|discard| discard.hand_number == source.terminal_hand)
        .map(|discard| {
            (
                discard.player,
                discard.cards.iter().copied().map(compact_card_id).collect(),
            )
        })
        .collect();
    if generated_discards != source.discards {
        return Err(format!(
            "{} terminal discard reconstruction mismatch",
            source.key.game_id
        ));
    }
    let generated_peg: Vec<(u8, Option<u8>)> = record
        .peg_plays
        .iter()
        .filter(|play| play.hand_number == source.terminal_hand)
        .map(|play| (play.action, play.card.map(compact_card_id)))
        .collect();
    if generated_peg.len() < source.peg_actions.len()
        || generated_peg[..source.peg_actions.len()] != source.peg_actions
    {
        return Err(format!(
            "{} terminal pegging reconstruction mismatch",
            source.key.game_id
        ));
    }
    Ok(())
}

fn score_events(
    record: &cribbage_shadow_engine::playout::CompactPlayoutRecord,
) -> Vec<ScoreEvent> {
    let mut events = Vec::new();
    for hand in &record.hands {
        let has_actions = record
            .discards
            .iter()
            .any(|discard| discard.hand_number == hand.hand_number)
            || record
                .peg_plays
                .iter()
                .any(|play| play.hand_number == hand.hand_number);
        if !has_actions {
            continue;
        }
        append_hand_events(&mut events, hand, record);
    }
    events
}

fn append_hand_events(
    events: &mut Vec<ScoreEvent>,
    hand: &CompactHandRecord,
    record: &cribbage_shadow_engine::playout::CompactPlayoutRecord,
) {
    let mut left_score = hand.start_left_score;
    let mut right_score = hand.start_right_score;
    if hand.cut_card.rank == 10 {
        push_event(events, hand, hand.dealer, "heels", 2);
        if hand.dealer == Side::Left {
            left_score += 2;
        } else {
            right_score += 2;
        }
    }
    for play in record
        .peg_plays
        .iter()
        .filter(|play| play.hand_number == hand.hand_number)
    {
        let left_delta = play.left_score - left_score;
        let right_delta = play.right_score - right_score;
        if left_delta > 0 {
            push_event(events, hand, Side::Left, "pegging", left_delta);
        }
        if right_delta > 0 {
            push_event(events, hand, Side::Right, "pegging", right_delta);
        }
        left_score = play.left_score;
        right_score = play.right_score;
    }
    let pone_points = if hand.pone == Side::Left {
        hand.left_hand_points
    } else {
        hand.right_hand_points
    };
    push_event(events, hand, hand.pone, "pone_hand", pone_points);
    let dealer_points = if hand.dealer == Side::Left {
        hand.left_hand_points
    } else {
        hand.right_hand_points
    };
    push_event(events, hand, hand.dealer, "dealer_hand", dealer_points);
    push_event(events, hand, hand.dealer, "crib", hand.crib_points);
}

fn push_event(
    events: &mut Vec<ScoreEvent>,
    hand: &CompactHandRecord,
    player: Side,
    phase: &'static str,
    points: i32,
) {
    if points > 0 {
        events.push(ScoreEvent {
            hand_number: hand.hand_number,
            dealer: hand.dealer,
            player,
            phase,
            points,
        });
    }
}

fn write_completed_game(
    connection: &mut Connection,
    source_db: &Path,
    game: &CompletedGame,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("begin output transaction failed: {}", error))?;
    transaction
        .execute(
            r#"
INSERT OR REPLACE INTO trajectory_games (
  source_game_id, source_db, matchup_id, game_index, random_seed,
  left_engine, right_engine, terminal_hand_number,
  terminal_start_left_score, terminal_start_right_score,
  final_left_score, final_right_score, final_hand_number,
  continuation_steps, event_count, reconstruction_verified
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1)
"#,
            params![
                game.source.key.game_id,
                source_db.to_string_lossy(),
                game.source.key.matchup_id,
                game.source.key.game_index,
                game.source.random_seed_text,
                game.source.left_model.as_str(),
                game.source.right_model.as_str(),
                game.source.terminal_hand,
                game.source.start_left_score,
                game.source.start_right_score,
                game.final_left_score,
                game.final_right_score,
                game.final_hand,
                game.steps,
                game.events.len(),
            ],
        )
        .map_err(|error| format!("write {} failed: {}", game.source.key.game_id, error))?;
    transaction
        .execute(
            "DELETE FROM trajectory_events WHERE source_game_id = ?1",
            [&game.source.key.game_id],
        )
        .map_err(|error| format!("clear trajectory events failed: {}", error))?;
    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO trajectory_events \
                 (source_game_id, sequence, hand_number, dealer, player, phase, points) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|error| format!("prepare trajectory event insert failed: {}", error))?;
        for (sequence, event) in game.events.iter().enumerate() {
            statement
                .execute(params![
                    game.source.key.game_id,
                    sequence,
                    event.hand_number,
                    side_code(event.dealer),
                    side_code(event.player),
                    event.phase,
                    event.points,
                ])
                .map_err(|error| format!("write trajectory event failed: {}", error))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("commit output failed: {}", error))
}

fn parse_side(value: i64) -> Result<Side, String> {
    match value {
        0 => Ok(Side::Left),
        1 => Ok(Side::Right),
        _ => Err(format!("invalid side code {}", value)),
    }
}

fn side_code(side: Side) -> i64 {
    match side {
        Side::Left => 0,
        Side::Right => 1,
    }
}

fn compact_card_id(card: cribbage_shadow_engine::cards::Card) -> u8 {
    (card.rank * 4) + card.suit
}
