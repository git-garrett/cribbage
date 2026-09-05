use std::collections::HashMap;
use std::path::Path;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use cribbage_shadow_engine::cards::{score_hand_components, Card, RANKS, SUIT_NAMES};
use cribbage_shadow_engine::decision::{
    review_discard_for_side_with_recommendation, review_peg_for_side_with_recommendation,
    DecisionReview as EngineDecisionReview,
};
use cribbage_shadow_engine::dynamic::{
    DYNAMIC_EVALUATOR_VERSION, MIN_COMPLETE_CYCLES, MIN_COMPLETE_GAMES_FOR_PERSONAL_LENGTH,
    UNIVERSAL_CYCLES_PER_GAME,
};
use cribbage_shadow_engine::game::{CribbageGame, Phase, Side};
#[cfg(test)]
use cribbage_shadow_engine::model_id::ModelId;
use cribbage_shadow_engine::model_id::ACE_MODEL_ID;
use rand_core::{OsRng, RngCore};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{auth::AuthUser, open_game_database, Request, Response, Server};

const ONLINE_SECONDS: i64 = 15 * 60;
const CHALLENGE_SECONDS: i64 = 10 * 60;
const TABLE_IDLE_SECONDS: i64 = 30 * 24 * 60 * 60;
const MAX_AVATAR_BYTES: usize = 420_000;
const CHALLENGE_WATCH_SECONDS: u64 = 20;
const HUMAN_GAME_WATCH_SECONDS: u64 = 20;

static CHALLENGE_SIGNAL: OnceLock<(Mutex<()>, Condvar)> = OnceLock::new();
static HUMAN_GAME_SIGNAL: OnceLock<(Mutex<()>, Condvar)> = OnceLock::new();

fn challenge_signal() -> &'static (Mutex<()>, Condvar) {
    CHALLENGE_SIGNAL.get_or_init(|| (Mutex::new(()), Condvar::new()))
}

fn notify_challenge_watchers() {
    let (lock, signal) = challenge_signal();
    let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    signal.notify_all();
}

fn human_game_signal() -> &'static (Mutex<()>, Condvar) {
    HUMAN_GAME_SIGNAL.get_or_init(|| (Mutex::new(()), Condvar::new()))
}

fn notify_human_game_watchers() {
    let (lock, signal) = human_game_signal();
    let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    signal.notify_all();
}

fn dynamic_handicap_value(evaluator_version: &str, profile: &Value) -> Option<Value> {
    let mut cycles = profile["handicap_cycles"].as_u64().unwrap_or_default();
    if cycles == 0 && profile["complete_games"].as_u64().unwrap_or_default() > 0 {
        cycles = profile["complete_cycles"].as_u64().unwrap_or_default();
    }
    let legacy_wp_per_game = profile["ewma_game_handicap"].as_f64();
    let wp_per_cycle = profile["ewma_cycle_handicap"]
        .as_f64()
        .or_else(|| legacy_wp_per_game.map(|value| value / UNIVERSAL_CYCLES_PER_GAME))?;
    let length_games = profile["length_games"].as_u64().unwrap_or_default();
    let personal_cycles_per_game = profile["ewma_cycles_per_game"].as_f64().unwrap_or_default();
    if cycles < u64::from(MIN_COMPLETE_CYCLES) || !wp_per_cycle.is_finite() {
        return None;
    }
    let cycles_per_game = if length_games >= u64::from(MIN_COMPLETE_GAMES_FOR_PERSONAL_LENGTH)
        && personal_cycles_per_game.is_finite()
        && personal_cycles_per_game > 0.0
    {
        personal_cycles_per_game
    } else {
        UNIVERSAL_CYCLES_PER_GAME
    };
    let wp_per_game = legacy_wp_per_game.unwrap_or(wp_per_cycle * cycles_per_game);
    Some(json!({
        "wpPerGame": wp_per_game,
        "cycles": cycles,
        "cyclesPerGame": cycles_per_game,
        "evaluatorVersion": evaluator_version,
    }))
}

fn dynamic_handicap_for_user(
    connection: &rusqlite::Connection,
    user_id: i64,
) -> Result<Option<Value>, PeopleError> {
    let saved = connection
        .query_row(
            "SELECT evaluator_version, profile_json
             FROM dynamic_player_profiles
             WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 1",
            [user_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| PeopleError::internal("read Dynamic handicap", error))?;
    let Some((evaluator_version, profile_json)) = saved else {
        return Ok(None);
    };
    let profile = serde_json::from_str::<Value>(&profile_json)
        .map_err(|error| PeopleError::internal("parse Dynamic handicap", error))?;
    Ok(dynamic_handicap_value(&evaluator_version, &profile))
}

pub fn handicap_summaries(data_dir: &Path) -> Result<HashMap<String, Value>, String> {
    let connection = open_game_database(data_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT u.display_name, dp.evaluator_version, dp.profile_json
             FROM dynamic_player_profiles dp
             JOIN auth_users u ON u.id = dp.user_id
             ORDER BY u.id, dp.updated_at DESC",
        )
        .map_err(|error| format!("prepare player handicaps: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("read player handicaps: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("collect player handicaps: {error}"))?;
    let mut handicaps = HashMap::new();
    for (display_name, evaluator_version, profile_json) in rows {
        if handicaps.contains_key(&display_name) {
            continue;
        }
        let profile = serde_json::from_str::<Value>(&profile_json)
            .map_err(|error| format!("parse Dynamic handicap for {display_name}: {error}"))?;
        if let Some(handicap) = dynamic_handicap_value(&evaluator_version, &profile) {
            handicaps.insert(display_name, handicap);
        }
    }
    Ok(handicaps)
}

#[derive(Debug)]
struct PeopleError {
    status: u16,
    message: String,
    detail: Option<String>,
}

impl PeopleError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: 400,
            message: message.into(),
            detail: None,
        }
    }

    fn unauthorized() -> Self {
        Self {
            status: 401,
            message: "Sign in to continue.".to_string(),
            detail: None,
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: 404,
            message: message.into(),
            detail: None,
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: 409,
            message: message.into(),
            detail: None,
        }
    }

    fn internal(context: &str, error: impl std::fmt::Display) -> Self {
        Self {
            status: 500,
            message: "The player service is temporarily unavailable.".to_string(),
            detail: Some(format!("{}: {}", context, error)),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileLookup {
    username: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileUpdate {
    username: String,
    email: String,
    avatar_data_url: Option<String>,
    text_size: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresenceUpdate {
    looking_for_game: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreferenceUpdate {
    text_size: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChallengeCreate {
    username: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChallengeSelection {
    challenge_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChallengeWatchSelection {
    #[serde(default)]
    known_challenge_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableSelection {
    table_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HumanGameActionSelection {
    table_id: String,
    action: String,
    revision: i64,
    #[serde(default)]
    action_id: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HumanGameWatchSelection {
    table_id: String,
    after_revision: i64,
}

#[derive(Clone, Deserialize, Serialize)]
struct HumanGameRecord {
    version: u8,
    game_id: String,
    game: CribbageGame,
    turn_card_revealed: bool,
    created_at: i64,
    #[serde(default)]
    completed_at: Option<i64>,
    #[serde(default)]
    pending_final_scoring: Option<HumanFinalScoringStage>,
    #[serde(default)]
    score_events: Vec<HumanScoreEvent>,
    #[serde(default)]
    decision_reviews: Vec<HumanDecisionReview>,
    #[serde(default)]
    next_review_id: u32,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
enum HumanFinalScoringStage {
    Pone,
    Dealer,
    Crib,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
enum HumanScoreCategory {
    Hand,
    Crib,
}

#[derive(Clone, Deserialize, Serialize)]
struct HumanScoreEvent {
    id: String,
    at: i64,
    hand_number: u32,
    player: Side,
    dealer: Side,
    category: HumanScoreCategory,
    points: i32,
    total_score: i32,
    scores: [i32; 2],
    cards: Vec<Card>,
    turn_card: Card,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
enum HumanReviewKind {
    Discard,
    Peg,
}

#[derive(Clone, Deserialize, Serialize)]
struct HumanDecisionReview {
    id: String,
    at: i64,
    kind: HumanReviewKind,
    player: Side,
    game: CribbageGame,
    selected_card_ids: Vec<u8>,
    completed: Option<HumanCompletedDecisionReview>,
}

#[derive(Clone, Deserialize, Serialize)]
struct HumanCompletedDecisionReview {
    evaluator_model: String,
    selected_card_ids: Vec<u8>,
    recommended_card_ids: Vec<u8>,
    selected_ev: f64,
    recommended_ev: f64,
    selected_win_probability: Option<f64>,
    recommended_win_probability: Option<f64>,
}

pub fn initialize(data_dir: &std::path::Path) -> Result<(), String> {
    let connection = open_game_database(data_dir)?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS people_profiles (
               user_id INTEGER PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
               avatar_data_url TEXT,
               text_size TEXT NOT NULL DEFAULT 'normal',
               updated_at INTEGER NOT NULL
             );
             INSERT OR IGNORE INTO people_profiles (user_id, text_size, updated_at)
               SELECT id, 'normal', updated_at FROM auth_users;
             CREATE TABLE IF NOT EXISTS people_presence (
               user_id INTEGER PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
               last_seen_at INTEGER NOT NULL,
               looking_for_game INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS people_presence_online
               ON people_presence(last_seen_at DESC, looking_for_game DESC);
             CREATE TABLE IF NOT EXISTS people_challenges (
               id TEXT PRIMARY KEY,
               table_id TEXT NOT NULL UNIQUE,
               challenger_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
               challenged_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
               status TEXT NOT NULL,
               challenger_cut INTEGER,
               challenged_cut INTEGER,
               dealer_id INTEGER REFERENCES auth_users(id),
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               expires_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS people_challenges_incoming
               ON people_challenges(challenged_id, status, created_at DESC);
             CREATE INDEX IF NOT EXISTS people_challenges_outgoing
               ON people_challenges(challenger_id, status, created_at DESC);
             CREATE TABLE IF NOT EXISTS people_games (
               table_id TEXT PRIMARY KEY REFERENCES people_challenges(table_id) ON DELETE CASCADE,
               game_id TEXT NOT NULL UNIQUE,
               game_json TEXT NOT NULL,
               revision INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               completed_at INTEGER
             );
             CREATE INDEX IF NOT EXISTS people_games_active
               ON people_games(completed_at, updated_at DESC);
             CREATE TABLE IF NOT EXISTS people_game_actions (
               table_id TEXT NOT NULL REFERENCES people_games(table_id) ON DELETE CASCADE,
               actor_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
               action_id TEXT NOT NULL,
               action TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               result_revision INTEGER NOT NULL,
               created_at INTEGER NOT NULL,
               PRIMARY KEY(table_id, actor_id, action_id)
             );
             CREATE TABLE IF NOT EXISTS people_head_to_head_games (
               game_id TEXT PRIMARY KEY,
               first_player_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
               second_player_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
               winner_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
               first_score INTEGER NOT NULL,
               second_score INTEGER NOT NULL,
               completed_at INTEGER NOT NULL,
               CHECK(first_player_id <> second_player_id),
               CHECK(winner_id = first_player_id OR winner_id = second_player_id)
             );
             CREATE INDEX IF NOT EXISTS people_head_to_head_pairs
               ON people_head_to_head_games(first_player_id, second_player_id, completed_at DESC);",
        )
        .map_err(|error| format!("create people tables: {}", error))?;
    Ok(())
}

pub fn handle(server: &Server, request: &Request, user: Option<&AuthUser>) -> Option<Response> {
    let result = match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/api/people/me") => own_profile(server, user),
        ("POST", "/api/people/me") => update_profile(server, request, user),
        ("POST", "/api/people/preferences") => update_preferences(server, request, user),
        ("POST", "/api/people/profile") => public_profile(server, request, user),
        ("GET", "/api/people/online") => online_people(server, user),
        ("POST", "/api/people/presence") => heartbeat(server, request, user),
        ("POST", "/api/people/challenges/watch") => watch_challenges(server, request, user),
        ("POST", "/api/people/challenge") => create_challenge(server, request, user),
        ("POST", "/api/people/challenge/accept") => accept_challenge(server, request, user),
        ("POST", "/api/people/table") => table_status(server, request, user),
        ("POST", "/api/people/table/cut") => cut_for_deal(server, request, user),
        ("POST", "/api/people/table/game") => human_game_status(server, request, user),
        ("POST", "/api/people/table/game/watch") => watch_human_game(server, request, user),
        ("POST", "/api/people/table/game/action") => human_game_action(server, request, user),
        ("POST", "/api/people/table/game/review") => human_game_review(server, request, user),
        _ => return None,
    };
    Some(match result {
        Ok(value) => Response::json(200, value.to_string()),
        Err(error) => {
            if let Some(detail) = error.detail {
                eprintln!("People error: {}", detail);
            }
            Response::json(error.status, json!({"error": error.message}).to_string())
        }
    })
}

fn own_profile(server: &Server, user: Option<&AuthUser>) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    profile_value(server, &user.username, Some(user.id), true)
}

fn public_profile(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let input: ProfileLookup = parse(request, "Choose a player profile.")?;
    profile_value(
        server,
        input.username.trim(),
        user.map(|value| value.id),
        false,
    )
}

fn profile_value(
    server: &Server,
    username: &str,
    viewer_id: Option<i64>,
    include_private: bool,
) -> Result<Value, PeopleError> {
    let connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open profile database", error))?;
    let cutoff = unix_seconds() - ONLINE_SECONDS;
    let profile = connection
        .query_row(
            "SELECT u.id, u.username, u.display_name, u.email,
                    p.avatar_data_url, COALESCE(p.text_size, 'normal'),
                    COALESCE(pr.last_seen_at, 0), COALESCE(pr.looking_for_game, 0)
             FROM auth_users u
             LEFT JOIN people_profiles p ON p.user_id = u.id
             LEFT JOIN people_presence pr ON pr.user_id = u.id
             WHERE u.username = ?1 COLLATE NOCASE",
            [username],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)? != 0,
                ))
            },
        )
        .optional()
        .map_err(|error| PeopleError::internal("read profile", error))?
        .ok_or_else(|| PeopleError::not_found("That player profile was not found."))?;
    let is_self = viewer_id == Some(profile.0);
    let mut value = json!({
        "username": profile.1,
        "displayName": profile.2,
        "avatarDataUrl": profile.4,
        "online": profile.6 >= cutoff,
        "lookingForGame": profile.6 >= cutoff && profile.7,
        "isSelf": is_self,
    });
    if include_private && is_self {
        value["email"] = Value::String(profile.3);
        value["textSize"] = Value::String(profile.5);
    }
    if let Some((evaluator_version, profile_json)) = connection
        .query_row(
            "SELECT evaluator_version, profile_json
             FROM dynamic_player_profiles
             WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 1",
            [profile.0],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| PeopleError::internal("read Dynamic handicap", error))?
    {
        let dynamic_profile = serde_json::from_str::<Value>(&profile_json)
            .map_err(|error| PeopleError::internal("parse Dynamic handicap", error))?;
        let cycles = dynamic_profile["complete_cycles"]
            .as_u64()
            .unwrap_or_default();
        let started = dynamic_profile["started_dynamic"]
            .as_bool()
            .unwrap_or_default();
        value["dynamicCalibration"] = json!({
            "started": started,
            "completeCycles": cycles,
            "minimumCycles": MIN_COMPLETE_CYCLES,
            "complete": cycles >= u64::from(MIN_COMPLETE_CYCLES),
        });
        if let Some(handicap) = dynamic_handicap_value(&evaluator_version, &dynamic_profile) {
            value["dynamicHandicap"] = handicap;
        }
    }
    if let Some(viewer_id) = viewer_id.filter(|viewer_id| *viewer_id != profile.0) {
        value["headToHead"] = head_to_head_value(&connection, viewer_id, profile.0)?;
    }
    Ok(json!({"profile": value}))
}

fn head_to_head_value(
    connection: &rusqlite::Connection,
    viewer_id: i64,
    profile_id: i64,
) -> Result<Value, PeopleError> {
    let values = connection
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN winner_id = ?1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN winner_id = ?2 THEN 1 ELSE 0 END), 0),
                    COALESCE(AVG(CASE
                      WHEN first_player_id = ?1 THEN first_score - second_score
                      ELSE second_score - first_score
                    END), 0.0),
                    COALESCE(SUM(CASE
                      WHEN winner_id = ?1
                       AND ((first_player_id = ?1 AND second_score <= 90)
                         OR (second_player_id = ?1 AND first_score <= 90))
                      THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE
                      WHEN winner_id = ?2
                       AND ((first_player_id = ?2 AND second_score <= 90)
                         OR (second_player_id = ?2 AND first_score <= 90))
                      THEN 1 ELSE 0 END), 0)
             FROM people_head_to_head_games
             WHERE (first_player_id = ?1 AND second_player_id = ?2)
                OR (first_player_id = ?2 AND second_player_id = ?1)",
            params![viewer_id, profile_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, f64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .map_err(|error| PeopleError::internal("read head-to-head stats", error))?;
    Ok(json!({
        "games": values.0,
        "viewerWins": values.1,
        "profileWins": values.2,
        "viewerAverageMargin": values.3,
        "viewerSkunks": values.4,
        "profileSkunks": values.5,
    }))
}

fn update_profile(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let mut input: ProfileUpdate = parse(request, "Complete the profile fields.")?;
    input.username = validate_username(&input.username)?;
    input.email = validate_email(&input.email)?;
    validate_text_size(&input.text_size)?;
    let avatar = validate_avatar(input.avatar_data_url.as_deref())?;
    let now = unix_seconds();
    let mut connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open profile database", error))?;
    let transaction = connection
        .transaction()
        .map_err(|error| PeopleError::internal("begin profile update", error))?;
    let duplicate: Option<i64> = transaction
        .query_row(
            "SELECT id FROM auth_users
             WHERE (username = ?1 COLLATE NOCASE OR normalized_email = ?2) AND id <> ?3
             LIMIT 1",
            params![input.username, normalize_email(&input.email), user.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| PeopleError::internal("check profile uniqueness", error))?;
    if duplicate.is_some() {
        return Err(PeopleError::conflict(
            "That username or email is already attached to another account.",
        ));
    }
    transaction
        .execute(
            "UPDATE auth_users
             SET username = ?2, display_name = ?2, email = ?3, normalized_email = ?4, updated_at = ?5
             WHERE id = ?1",
            params![user.id, input.username, input.email, normalize_email(&input.email), now],
        )
        .map_err(|error| PeopleError::internal("update account profile", error))?;
    transaction
        .execute(
            "INSERT INTO people_profiles (user_id, avatar_data_url, text_size, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(user_id) DO UPDATE SET
               avatar_data_url = excluded.avatar_data_url,
               text_size = excluded.text_size,
               updated_at = excluded.updated_at",
            params![user.id, avatar, input.text_size, now],
        )
        .map_err(|error| PeopleError::internal("update public profile", error))?;
    transaction
        .commit()
        .map_err(|error| PeopleError::internal("commit profile update", error))?;
    profile_value(server, &input.username, Some(user.id), true)
}

fn heartbeat(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let input: PresenceUpdate = parse(request, "Presence state is incomplete.")?;
    let connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open presence database", error))?;
    let now = unix_seconds();
    connection
        .execute(
            "INSERT INTO people_presence (user_id, last_seen_at, looking_for_game)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(user_id) DO UPDATE SET
               last_seen_at = excluded.last_seen_at,
               looking_for_game = excluded.looking_for_game",
            params![user.id, now, input.looking_for_game],
        )
        .map_err(|error| PeopleError::internal("record presence", error))?;
    directory_value(server, Some(user))
}

fn update_preferences(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let input: PreferenceUpdate = parse(request, "Choose a text size.")?;
    validate_text_size(&input.text_size)?;
    let connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open preferences database", error))?;
    connection
        .execute(
            "INSERT INTO people_profiles (user_id, text_size, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(user_id) DO UPDATE SET
               text_size = excluded.text_size,
               updated_at = excluded.updated_at",
            params![user.id, input.text_size, unix_seconds()],
        )
        .map_err(|error| PeopleError::internal("update text size preference", error))?;
    Ok(json!({"ok": true, "textSize": input.text_size}))
}

fn online_people(server: &Server, user: Option<&AuthUser>) -> Result<Value, PeopleError> {
    directory_value(server, user)
}

fn watch_challenges(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let mut input: ChallengeWatchSelection = parse(request, "Challenge watch is incomplete.")?;
    if input.known_challenge_ids.len() > 100 {
        return Err(PeopleError::bad_request(
            "Too many challenge ids were supplied.",
        ));
    }
    input.known_challenge_ids.sort();
    input.known_challenge_ids.dedup();
    let deadline = Instant::now() + Duration::from_secs(CHALLENGE_WATCH_SECONDS);
    let (lock, signal) = challenge_signal();

    loop {
        // Hold the signal mutex while checking SQLite so an invitation cannot
        // be committed and signaled in the gap before this request waits.
        let guard = lock
            .lock()
            .map_err(|error| PeopleError::internal("watch challenge signal", error))?;
        let current = incoming_challenge_ids(server, user.id)?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        if current != input.known_challenge_ids || remaining.is_zero() {
            drop(guard);
            return directory_value(server, Some(user));
        }
        let (guard, wait) = signal
            .wait_timeout(guard, remaining)
            .map_err(|error| PeopleError::internal("wait for player challenge", error))?;
        drop(guard);
        if wait.timed_out() {
            return directory_value(server, Some(user));
        }
    }
}

fn incoming_challenge_ids(server: &Server, user_id: i64) -> Result<Vec<String>, PeopleError> {
    let connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open challenge watch database", error))?;
    let mut statement = connection
        .prepare(
            "SELECT id FROM people_challenges
             WHERE challenged_id = ?1 AND status = 'pending' AND expires_at > ?2
             ORDER BY id",
        )
        .map_err(|error| PeopleError::internal("prepare challenge watch", error))?;
    let ids = statement
        .query_map(params![user_id, unix_seconds()], |row| row.get(0))
        .map_err(|error| PeopleError::internal("read challenge watch", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| PeopleError::internal("collect challenge watch", error))?;
    Ok(ids)
}

fn directory_value(server: &Server, viewer: Option<&AuthUser>) -> Result<Value, PeopleError> {
    let connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open people directory", error))?;
    let now = unix_seconds();
    connection
        .execute(
            "UPDATE people_challenges SET status = 'expired', updated_at = ?1
             WHERE status = 'pending' AND expires_at <= ?1",
            [now],
        )
        .map_err(|error| PeopleError::internal("expire challenges", error))?;
    let cutoff = now - ONLINE_SECONDS;
    let viewer_id = viewer.map(|user| user.id).unwrap_or(-1);
    let mut statement = connection
        .prepare(
            "SELECT u.id, u.username, u.display_name, p.avatar_data_url, pr.looking_for_game
             FROM people_presence pr
             JOIN auth_users u ON u.id = pr.user_id
             LEFT JOIN people_profiles p ON p.user_id = u.id
             WHERE pr.last_seen_at >= ?1 AND u.id <> ?2
             ORDER BY pr.looking_for_game DESC, u.username COLLATE NOCASE ASC",
        )
        .map_err(|error| PeopleError::internal("prepare online directory", error))?;
    let player_rows = statement
        .query_map(params![cutoff, viewer_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)? != 0,
            ))
        })
        .map_err(|error| PeopleError::internal("read online directory", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| PeopleError::internal("collect online directory", error))?;
    let players = player_rows
        .into_iter()
        .map(
            |(user_id, username, display_name, avatar, looking_for_game)| {
                let mut player = player_value(
                    &username,
                    &display_name,
                    avatar,
                    dynamic_handicap_for_user(&connection, user_id)?,
                );
                player["online"] = Value::Bool(true);
                player["lookingForGame"] = Value::Bool(looking_for_game);
                Ok(player)
            },
        )
        .collect::<Result<Vec<_>, PeopleError>>()?;
    let online_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM people_presence WHERE last_seen_at >= ?1",
            [cutoff],
            |row| row.get(0),
        )
        .map_err(|error| PeopleError::internal("count online players", error))?;

    let incoming = if let Some(viewer) = viewer {
        challenge_rows(&connection, viewer.id, true, now)?
    } else {
        Vec::new()
    };
    let outgoing = if let Some(viewer) = viewer {
        challenge_rows(&connection, viewer.id, false, now)?
    } else {
        Vec::new()
    };
    let active_table = if let Some(viewer) = viewer {
        let table_id = connection
            .query_row(
                "SELECT c.table_id
                 FROM people_challenges c
                 LEFT JOIN people_games g ON g.table_id = c.table_id
                 WHERE c.status = 'accepted' AND c.expires_at > ?2
                   AND (c.challenger_id = ?1 OR c.challenged_id = ?1)
                   AND g.completed_at IS NULL
                 ORDER BY COALESCE(g.updated_at, c.updated_at) DESC, c.created_at DESC
                 LIMIT 1",
                params![viewer.id, now],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| PeopleError::internal("read active player table", error))?;
        table_id
            .map(|table_id| {
                table_value(server, &table_id, viewer.id).map(|response| response["table"].clone())
            })
            .transpose()?
    } else {
        None
    };
    Ok(json!({
        "onlineCount": online_count,
        "players": players,
        "incomingChallenges": incoming,
        "outgoingChallenges": outgoing,
        "activeTable": active_table,
    }))
}

fn challenge_rows(
    connection: &rusqlite::Connection,
    user_id: i64,
    incoming: bool,
    now: i64,
) -> Result<Vec<Value>, PeopleError> {
    let (owner_column, player_column) = if incoming {
        ("c.challenged_id", "c.challenger_id")
    } else {
        ("c.challenger_id", "c.challenged_id")
    };
    let sql = format!(
        "SELECT c.id, c.table_id, c.status, u.username, u.display_name, p.avatar_data_url,
                COALESCE(pr.last_seen_at, 0) >= ?2, u.id
         FROM people_challenges c
         JOIN auth_users u ON u.id = {}
         LEFT JOIN people_profiles p ON p.user_id = u.id
         LEFT JOIN people_presence pr ON pr.user_id = u.id
         WHERE {} = ?1 AND c.status = 'pending' AND c.expires_at > ?3
         ORDER BY c.created_at DESC",
        player_column, owner_column
    );
    let cutoff = now - ONLINE_SECONDS;
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| PeopleError::internal("prepare challenge list", error))?;
    let rows = statement
        .query_map(params![user_id, cutoff, now], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, bool>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })
        .map_err(|error| PeopleError::internal("read challenges", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| PeopleError::internal("collect challenges", error))?;
    rows.into_iter()
        .map(
            |(id, table_id, status, username, display_name, avatar, online, player_id)| {
                let mut player = player_value(
                    &username,
                    &display_name,
                    avatar,
                    dynamic_handicap_for_user(connection, player_id)?,
                );
                player["online"] = Value::Bool(online);
                Ok(json!({
                    "id": id,
                    "tableId": table_id,
                    "status": status,
                    "player": player,
                }))
            },
        )
        .collect()
}

fn create_challenge(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let input: ChallengeCreate = parse(request, "Choose an online player.")?;
    let now = unix_seconds();
    let mut connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open challenge database", error))?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| PeopleError::internal("start challenge transaction", error))?;
    let target = transaction
        .query_row(
            "SELECT u.id, u.username, u.display_name, p.avatar_data_url,
                    COALESCE(pr.last_seen_at, 0)
             FROM auth_users u
             LEFT JOIN people_profiles p ON p.user_id = u.id
             LEFT JOIN people_presence pr ON pr.user_id = u.id
             WHERE u.username = ?1 COLLATE NOCASE",
            [input.username.trim()],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| PeopleError::internal("find challenged player", error))?
        .ok_or_else(|| PeopleError::not_found("That player was not found."))?;
    if target.0 == user.id {
        return Err(PeopleError::bad_request("Choose another player."));
    }
    if target.4 < now - ONLINE_SECONDS {
        return Err(PeopleError::conflict("That player is no longer online."));
    }
    if let Some(existing) = transaction
        .query_row(
            "SELECT id, table_id, challenger_id FROM people_challenges
             WHERE ((challenger_id = ?1 AND challenged_id = ?2)
                 OR (challenger_id = ?2 AND challenged_id = ?1))
               AND status = 'pending' AND expires_at > ?3
             ORDER BY created_at ASC, id ASC LIMIT 1",
            params![user.id, target.0, now],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| PeopleError::internal("find active challenge", error))?
    {
        let status = if existing.2 == user.id {
            "pending"
        } else {
            transaction
                .execute(
                    "UPDATE people_challenges
                     SET status = 'accepted', updated_at = ?2, expires_at = ?3
                     WHERE id = ?1 AND status = 'pending'",
                    params![existing.0, now, now + TABLE_IDLE_SECONDS],
                )
                .map_err(|error| PeopleError::internal("join crossed challenge", error))?;
            "accepted"
        };
        let response = json!({
            "challenge": challenge_value(
                &existing.0,
                &existing.1,
                status,
                &target.1,
                &target.2,
                target.3,
                dynamic_handicap_for_user(&transaction, target.0)?,
            ),
        });
        transaction
            .commit()
            .map_err(|error| PeopleError::internal("commit active challenge", error))?;
        if status == "accepted" {
            notify_challenge_watchers();
        }
        return Ok(response);
    }
    let id = random_id("challenge");
    let table_id = random_id("table");
    transaction
        .execute(
            "INSERT INTO people_challenges
             (id, table_id, challenger_id, challenged_id, status, created_at, updated_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5, ?6)",
            params![id, table_id, user.id, target.0, now, now + CHALLENGE_SECONDS],
        )
        .map_err(|error| PeopleError::internal("create player challenge", error))?;
    let response = json!({
        "challenge": challenge_value(
            &id,
            &table_id,
            "pending",
            &target.1,
            &target.2,
            target.3,
            dynamic_handicap_for_user(&transaction, target.0)?,
        ),
    });
    transaction
        .commit()
        .map_err(|error| PeopleError::internal("commit player challenge", error))?;
    notify_challenge_watchers();
    Ok(response)
}

fn accept_challenge(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let input: ChallengeSelection = parse(request, "Choose a challenge to join.")?;
    let now = unix_seconds();
    let connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open challenge database", error))?;
    let updated = connection
        .execute(
            "UPDATE people_challenges
             SET status = 'accepted', updated_at = ?3, expires_at = ?4
             WHERE id = ?1 AND challenged_id = ?2 AND status = 'pending' AND expires_at > ?3",
            params![input.challenge_id, user.id, now, now + TABLE_IDLE_SECONDS],
        )
        .map_err(|error| PeopleError::internal("accept player challenge", error))?;
    if updated == 0 {
        return Err(PeopleError::conflict(
            "That challenge is no longer available.",
        ));
    }
    notify_challenge_watchers();
    let table_id: String = connection
        .query_row(
            "SELECT table_id FROM people_challenges WHERE id = ?1",
            [input.challenge_id],
            |row| row.get(0),
        )
        .map_err(|error| PeopleError::internal("read accepted table", error))?;
    Ok(json!({"ok": true, "tableId": table_id}))
}

fn table_status(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let input: TableSelection = parse(request, "Choose a player table.")?;
    table_value(server, &input.table_id, user.id)
}

fn renew_human_table(connection: &rusqlite::Connection, table_id: &str) -> Result<(), PeopleError> {
    let now = unix_seconds();
    connection
        .execute(
            "UPDATE people_challenges
             SET expires_at = ?2
             WHERE table_id = ?1 AND status = 'accepted'
               AND expires_at > ?3 AND expires_at < ?4",
            params![
                table_id,
                now + TABLE_IDLE_SECONDS,
                now,
                now + TABLE_IDLE_SECONDS / 2,
            ],
        )
        .map_err(|error| PeopleError::internal("renew player table", error))?;
    Ok(())
}

fn cut_for_deal(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let input: TableSelection = parse(request, "Choose a player table.")?;
    let mut connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open table database", error))?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| PeopleError::internal("begin deal cut", error))?;
    renew_human_table(&transaction, &input.table_id)?;
    let row = table_row(&transaction, &input.table_id)?;
    if user.id != row.challenger_id && user.id != row.challenged_id {
        return Err(PeopleError::not_found("That player table was not found."));
    }
    if row.status != "accepted" {
        return Err(PeopleError::conflict(
            "Wait for the other player to join before cutting.",
        ));
    }
    if row.dealer_id.is_none() {
        let existing = if user.id == row.challenger_id {
            row.challenger_cut
        } else {
            row.challenged_cut
        };
        if existing.is_none() {
            let other_cut = if user.id == row.challenger_id {
                row.challenged_cut
            } else {
                row.challenger_cut
            };
            let card = random_cut_card(other_cut);
            let column = if user.id == row.challenger_id {
                "challenger_cut"
            } else {
                "challenged_cut"
            };
            let sql = format!(
                "UPDATE people_challenges SET {} = ?2, updated_at = ?3 WHERE table_id = ?1",
                column
            );
            transaction
                .execute(&sql, params![input.table_id, card, unix_seconds()])
                .map_err(|error| PeopleError::internal("record deal cut", error))?;
        }
        let cuts = transaction
            .query_row(
                "SELECT challenger_cut, challenged_cut FROM people_challenges WHERE table_id = ?1",
                [&input.table_id],
                |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?)),
            )
            .map_err(|error| PeopleError::internal("read deal cuts", error))?;
        if let (Some(challenger), Some(challenged)) = cuts {
            let dealer_id = if cut_rank(challenger) < cut_rank(challenged) {
                row.challenger_id
            } else {
                row.challenged_id
            };
            transaction
                .execute(
                    "UPDATE people_challenges SET dealer_id = ?2, updated_at = ?3 WHERE table_id = ?1",
                    params![input.table_id, dealer_id, unix_seconds()],
                )
                .map_err(|error| PeopleError::internal("choose first dealer", error))?;
        }
    }
    let dealer_id = transaction
        .query_row(
            "SELECT dealer_id FROM people_challenges WHERE table_id = ?1",
            [&input.table_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .map_err(|error| PeopleError::internal("read first dealer", error))?;
    if let Some(dealer_id) = dealer_id {
        ensure_human_game(&transaction, &input.table_id, dealer_id, row.challenger_id)?;
    }
    transaction
        .commit()
        .map_err(|error| PeopleError::internal("commit deal cut", error))?;
    table_value(server, &input.table_id, user.id)
}

fn ensure_human_game(
    connection: &rusqlite::Connection,
    table_id: &str,
    dealer_id: i64,
    challenger_id: i64,
) -> Result<(), PeopleError> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM people_games WHERE table_id = ?1",
            [table_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| PeopleError::internal("find player game", error))?
        .is_some();
    if exists {
        return Ok(());
    }
    let seed = OsRng.next_u32();
    let first_deal = if dealer_id == challenger_id {
        Side::Left
    } else {
        Side::Right
    };
    let record = HumanGameRecord {
        version: 1,
        game_id: random_id("human-game"),
        game: CribbageGame::new_with_seed(seed, first_deal),
        turn_card_revealed: false,
        created_at: unix_seconds(),
        completed_at: None,
        pending_final_scoring: None,
        score_events: Vec::new(),
        decision_reviews: Vec::new(),
        next_review_id: 0,
    };
    let game_json = serde_json::to_string(&record)
        .map_err(|error| PeopleError::internal("serialize player game", error))?;
    connection
        .execute(
            "INSERT OR IGNORE INTO people_games
             (table_id, game_id, game_json, revision, created_at, updated_at)
             VALUES (?1, ?2, ?3, 0, ?4, ?4)",
            params![table_id, record.game_id, game_json, record.created_at],
        )
        .map_err(|error| PeopleError::internal("create player game", error))?;
    Ok(())
}

#[derive(Clone)]
struct TableRow {
    status: String,
    challenger_id: i64,
    challenged_id: i64,
    challenger_cut: Option<i64>,
    challenged_cut: Option<i64>,
    dealer_id: Option<i64>,
    challenger_username: String,
    challenger_display_name: String,
    challenger_avatar: Option<String>,
    challenged_username: String,
    challenged_display_name: String,
    challenged_avatar: Option<String>,
}

fn table_row(connection: &rusqlite::Connection, table_id: &str) -> Result<TableRow, PeopleError> {
    connection
        .query_row(
            "SELECT c.status, c.challenger_id, c.challenged_id,
                    c.challenger_cut, c.challenged_cut, c.dealer_id,
                    a.username, a.display_name, ap.avatar_data_url,
                    b.username, b.display_name, bp.avatar_data_url
             FROM people_challenges c
             JOIN auth_users a ON a.id = c.challenger_id
             JOIN auth_users b ON b.id = c.challenged_id
             LEFT JOIN people_profiles ap ON ap.user_id = a.id
             LEFT JOIN people_profiles bp ON bp.user_id = b.id
             WHERE c.table_id = ?1 AND c.expires_at > ?2",
            params![table_id, unix_seconds()],
            |row| {
                Ok(TableRow {
                    status: row.get(0)?,
                    challenger_id: row.get(1)?,
                    challenged_id: row.get(2)?,
                    challenger_cut: row.get(3)?,
                    challenged_cut: row.get(4)?,
                    dealer_id: row.get(5)?,
                    challenger_username: row.get(6)?,
                    challenger_display_name: row.get(7)?,
                    challenger_avatar: row.get(8)?,
                    challenged_username: row.get(9)?,
                    challenged_display_name: row.get(10)?,
                    challenged_avatar: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(|error| PeopleError::internal("read player table", error))?
        .ok_or_else(|| PeopleError::not_found("That player table was not found."))
}

fn table_value(server: &Server, table_id: &str, viewer_id: i64) -> Result<Value, PeopleError> {
    let connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open table database", error))?;
    renew_human_table(&connection, table_id)?;
    let row = table_row(&connection, table_id)?;
    if viewer_id != row.challenger_id && viewer_id != row.challenged_id {
        return Err(PeopleError::not_found("That player table was not found."));
    }
    if let Some(dealer_id) = row.dealer_id {
        ensure_human_game(&connection, table_id, dealer_id, row.challenger_id)?;
    }
    let game_phase = connection
        .query_row(
            "SELECT game_json FROM people_games WHERE table_id = ?1",
            [table_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| PeopleError::internal("read player game phase", error))?
        .map(|stored| {
            serde_json::from_str::<HumanGameRecord>(&stored)
                .map(|record| {
                    if record.game.phase == Phase::GameOver
                        && record.pending_final_scoring.is_none()
                    {
                        "complete"
                    } else {
                        "playing"
                    }
                })
                .map_err(|error| PeopleError::internal("parse player game phase", error))
        })
        .transpose()?;
    let phase = if row.status == "pending" {
        "waiting"
    } else if let Some(game_phase) = game_phase {
        game_phase
    } else if row.dealer_id.is_some() {
        "playing"
    } else {
        "cut_for_deal"
    };
    Ok(json!({
        "table": {
            "id": table_id,
            "phase": phase,
            "viewerSeat": if viewer_id == row.challenger_id { "challenger" } else { "challenged" },
            "challenger": player_value(
                &row.challenger_username,
                &row.challenger_display_name,
                row.challenger_avatar,
                dynamic_handicap_for_user(&connection, row.challenger_id)?,
            ),
            "challenged": player_value(
                &row.challenged_username,
                &row.challenged_display_name,
                row.challenged_avatar,
                dynamic_handicap_for_user(&connection, row.challenged_id)?,
            ),
            "challengerCut": row.challenger_cut.map(cut_card_value),
            "challengedCut": row.challenged_cut.map(cut_card_value),
            "dealerUsername": row.dealer_id.map(|id| {
                if id == row.challenger_id { row.challenger_username.clone() } else { row.challenged_username.clone() }
            }),
        }
    }))
}

fn human_game_status(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let input: TableSelection = parse(request, "Choose a player table.")?;
    human_game_value(server, &input.table_id, user.id, true)
}

fn human_game_value(
    server: &Server,
    table_id: &str,
    viewer_id: i64,
    renew_table: bool,
) -> Result<Value, PeopleError> {
    let connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open player game database", error))?;
    if renew_table {
        renew_human_table(&connection, table_id)?;
    }
    let row = table_row(&connection, table_id)?;
    let viewer = table_viewer_side(&row, viewer_id)?;
    let dealer_id = row
        .dealer_id
        .ok_or_else(|| PeopleError::conflict("Both players must cut before the game can begin."))?;
    ensure_human_game(&connection, table_id, dealer_id, row.challenger_id)?;
    let (record, revision) = load_human_game(&connection, table_id)?;
    Ok(human_game_response(
        table_id, &row, &record, revision, viewer,
    ))
}

fn watch_human_game(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let input: HumanGameWatchSelection = parse(request, "Choose a player game to watch.")?;
    if input.after_revision < -1 {
        return Err(PeopleError::bad_request("The watched revision is invalid."));
    }
    let deadline = Instant::now() + Duration::from_secs(HUMAN_GAME_WATCH_SECONDS);
    let (lock, signal) = human_game_signal();
    loop {
        let guard = lock
            .lock()
            .map_err(|error| PeopleError::internal("watch player game signal", error))?;
        let mut response = human_game_value(server, &input.table_id, user.id, false)?;
        let revision = response["revision"].as_i64().unwrap_or(-1);
        let remaining = deadline.saturating_duration_since(Instant::now());
        if revision > input.after_revision || remaining.is_zero() {
            response["watchTimedOut"] = Value::Bool(remaining.is_zero());
            drop(guard);
            return Ok(response);
        }
        let (guard, wait) = signal
            .wait_timeout(guard, remaining)
            .map_err(|error| PeopleError::internal("wait for player game update", error))?;
        drop(guard);
        if wait.timed_out() {
            let mut response = human_game_value(server, &input.table_id, user.id, false)?;
            response["watchTimedOut"] = Value::Bool(true);
            return Ok(response);
        }
    }
}

fn human_game_action(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let input: HumanGameActionSelection = parse(request, "Choose a player game action.")?;
    let mut connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open player game database", error))?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| PeopleError::internal("begin player game action", error))?;
    renew_human_table(&transaction, &input.table_id)?;
    let row = table_row(&transaction, &input.table_id)?;
    let viewer = table_viewer_side(&row, user.id)?;
    let (mut record, revision) = load_human_game(&transaction, &input.table_id)?;
    let action_id = input.action_id.trim();
    if action_id.is_empty() {
        return Err(PeopleError::bad_request(
            "The player action id is required.",
        ));
    }
    if action_id.len() > 120 {
        return Err(PeopleError::bad_request(
            "The player action id is too long.",
        ));
    }
    let action_id = action_id.to_string();
    let payload_json = serde_json::to_string(&input.payload)
        .map_err(|error| PeopleError::internal("serialize player action", error))?;
    if let Some((saved_action, saved_payload, applied_revision)) = transaction
        .query_row(
            "SELECT action, payload_json, result_revision
             FROM people_game_actions
             WHERE table_id = ?1 AND actor_id = ?2 AND action_id = ?3",
            params![input.table_id, user.id, action_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| PeopleError::internal("find acknowledged player action", error))?
    {
        if saved_action != input.action || saved_payload != payload_json {
            return Err(PeopleError::conflict(
                "That player action id was already used for another move.",
            ));
        }
        let response = acknowledge_human_game_action(
            human_game_response(&input.table_id, &row, &record, revision, viewer),
            &action_id,
            applied_revision,
            true,
        );
        transaction
            .commit()
            .map_err(|error| PeopleError::internal("finish acknowledged player action", error))?;
        return Ok(response);
    }
    // Both players can choose their private discards from the same revision.
    // The choices touch disjoint hands, so merge the second valid discard into
    // the latest authoritative game instead of forcing a needless refresh.
    if revision != input.revision && input.action != "discard" {
        return Err(PeopleError::conflict(
            "The other player moved first. Refreshing the table will show the latest play.",
        ));
    }

    match input.action.as_str() {
        "discard" => {
            if record.game.phase != Phase::Discard || record.game.player(viewer).hand.len() != 6 {
                return Err(PeopleError::conflict("Your discard is already down."));
            }
            let ids = human_action_card_ids(&input.payload, 2)?;
            let review_game = record.game.clone();
            record
                .game
                .discard(viewer, [ids[0], ids[1]])
                .map_err(PeopleError::bad_request)?;
            queue_human_decision_review(
                &mut record,
                HumanReviewKind::Discard,
                viewer,
                review_game,
                ids,
            );
            if record.game.phase == Phase::Pegging || record.game.phase == Phase::GameOver {
                record.turn_card_revealed = true;
            }
        }
        "play" => {
            let id = input.payload["id"]
                .as_u64()
                .and_then(|value| u8::try_from(value).ok())
                .ok_or_else(|| PeopleError::bad_request("Choose a card to play."))?;
            let review_game = record.game.clone();
            record
                .game
                .play_card(viewer, id)
                .map_err(PeopleError::bad_request)?;
            queue_human_decision_review(
                &mut record,
                HumanReviewKind::Peg,
                viewer,
                review_game,
                vec![id],
            );
        }
        "go" => {
            record
                .game
                .say_go(viewer)
                .map_err(PeopleError::bad_request)?;
        }
        "acknowledge-pegging-reset" => {
            if record.game.pegging_reset_pending && record.game.current_player() != viewer {
                return Err(PeopleError::conflict(
                    "The other player is clearing the count.",
                ));
            }
            record.game.acknowledge_pegging_reset();
        }
        "continue-scoring" => {
            if human_scoring_controller(&record) != Some(viewer) {
                return Err(PeopleError::conflict(
                    "The player whose cards are being counted advances the shared review.",
                ));
            }
            if record.pending_final_scoring.is_some() {
                record.pending_final_scoring = None;
            } else {
                let hand_number = record.game.hand_number;
                let before = human_score_snapshot(&record.game);
                let score_stage = match record.game.phase {
                    Phase::PeggingComplete => Some((
                        HumanScoreCategory::Hand,
                        record.game.pone,
                        record.game.player(record.game.pone).table.clone(),
                        HumanFinalScoringStage::Pone,
                    )),
                    Phase::ScorePone => Some((
                        HumanScoreCategory::Hand,
                        record.game.dealer,
                        record.game.player(record.game.dealer).table.clone(),
                        HumanFinalScoringStage::Dealer,
                    )),
                    Phase::ScoreDealer => Some((
                        HumanScoreCategory::Crib,
                        record.game.dealer,
                        record.game.player(record.game.dealer).crib.clone(),
                        HumanFinalScoringStage::Crib,
                    )),
                    _ => None,
                };
                if record.game.phase == Phase::PeggingComplete {
                    record
                        .game
                        .start_scoring()
                        .map_err(PeopleError::bad_request)?;
                } else {
                    record
                        .game
                        .continue_scoring()
                        .map_err(PeopleError::bad_request)?;
                }
                if let Some((category, player, cards, final_stage)) = score_stage {
                    record_human_score_event(
                        &mut record,
                        hand_number,
                        before,
                        category,
                        player,
                        cards,
                    );
                    if record.game.phase == Phase::GameOver {
                        record.pending_final_scoring = Some(final_stage);
                    }
                }
            }
            if record.game.phase == Phase::Discard {
                record.turn_card_revealed = false;
            }
        }
        _ => {
            return Err(PeopleError::bad_request(
                "That player game action is not available.",
            ))
        }
    }

    let now = unix_seconds();
    let completed_at = (record.game.phase == Phase::GameOver
        && record.pending_final_scoring.is_none())
    .then_some(now);
    if record.completed_at.is_none() {
        record.completed_at = completed_at;
    }
    let game_json = serde_json::to_string(&record)
        .map_err(|error| PeopleError::internal("serialize player game", error))?;
    let updated = transaction
        .execute(
            "UPDATE people_games
             SET game_json = ?2, revision = revision + 1, updated_at = ?3,
                 completed_at = COALESCE(completed_at, ?4)
             WHERE table_id = ?1 AND revision = ?5",
            params![input.table_id, game_json, now, completed_at, revision],
        )
        .map_err(|error| PeopleError::internal("save player game", error))?;
    if updated != 1 {
        return Err(PeopleError::conflict(
            "The other player moved first. Refreshing the table will show the latest play.",
        ));
    }
    transaction
        .execute(
            "INSERT INTO people_game_actions
             (table_id, actor_id, action_id, action, payload_json, result_revision, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                input.table_id,
                user.id,
                action_id,
                input.action,
                payload_json,
                revision + 1,
                now,
            ],
        )
        .map_err(|error| PeopleError::internal("acknowledge player action", error))?;
    if record.game.phase == Phase::GameOver && record.pending_final_scoring.is_none() {
        record_head_to_head_game(&transaction, &row, &record, now)?;
    }
    transaction
        .commit()
        .map_err(|error| PeopleError::internal("commit player game action", error))?;
    notify_human_game_watchers();
    let response = human_game_response(&input.table_id, &row, &record, revision + 1, viewer);
    Ok(acknowledge_human_game_action(
        response,
        &action_id,
        revision + 1,
        false,
    ))
}

fn human_game_review(
    server: &Server,
    request: &Request,
    user: Option<&AuthUser>,
) -> Result<Value, PeopleError> {
    let user = user.ok_or_else(PeopleError::unauthorized)?;
    let input: TableSelection = parse(request, "Choose a player table.")?;
    let pending = {
        let connection = open_game_database(&server.data_dir)
            .map_err(|error| PeopleError::internal("open player review database", error))?;
        let row = table_row(&connection, &input.table_id)?;
        table_viewer_side(&row, user.id)?;
        let (record, _) = load_human_game(&connection, &input.table_id)?;
        record
            .decision_reviews
            .iter()
            .find(|review| review.completed.is_none())
            .cloned()
    };

    let completed = pending
        .as_ref()
        .map(|review| evaluate_human_decision_review(review, &server.model_root))
        .transpose()?;

    let mut connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open player review database", error))?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| PeopleError::internal("begin player decision review", error))?;
    let row = table_row(&transaction, &input.table_id)?;
    let viewer = table_viewer_side(&row, user.id)?;
    let (mut record, revision) = load_human_game(&transaction, &input.table_id)?;
    let mut response_revision = revision;
    let mut review_saved = false;
    if let (Some(pending), Some(completed)) = (pending, completed) {
        if let Some(saved) = record
            .decision_reviews
            .iter_mut()
            .find(|review| review.id == pending.id && review.completed.is_none())
        {
            saved.completed = Some(completed);
            let game_json = serde_json::to_string(&record)
                .map_err(|error| PeopleError::internal("serialize player review", error))?;
            let updated = transaction
                .execute(
                    "UPDATE people_games
                     SET game_json = ?2, revision = revision + 1, updated_at = ?3
                     WHERE table_id = ?1 AND revision = ?4",
                    params![input.table_id, game_json, unix_seconds(), revision],
                )
                .map_err(|error| PeopleError::internal("save player decision review", error))?;
            if updated != 1 {
                return Err(PeopleError::conflict(
                    "The player game changed while Ace was reviewing it.",
                ));
            }
            response_revision += 1;
            review_saved = true;
        }
    }
    transaction
        .commit()
        .map_err(|error| PeopleError::internal("commit player decision review", error))?;
    if review_saved {
        notify_human_game_watchers();
    }
    Ok(human_game_response(
        &input.table_id,
        &row,
        &record,
        response_revision,
        viewer,
    ))
}

fn queue_human_decision_review(
    record: &mut HumanGameRecord,
    kind: HumanReviewKind,
    player: Side,
    game: CribbageGame,
    selected_card_ids: Vec<u8>,
) {
    let id = format!("{}-review-{}", record.game_id, record.next_review_id);
    record.next_review_id += 1;
    record.decision_reviews.push(HumanDecisionReview {
        id,
        at: unix_seconds(),
        kind,
        player,
        game,
        selected_card_ids,
        completed: None,
    });
}

fn human_score_snapshot(game: &CribbageGame) -> [i32; 2] {
    [
        game.player(Side::Left).score,
        game.player(Side::Right).score,
    ]
}

fn human_score_for_side(scores: [i32; 2], side: Side) -> i32 {
    match side {
        Side::Left => scores[0],
        Side::Right => scores[1],
    }
}

fn record_human_score_event(
    record: &mut HumanGameRecord,
    hand_number: u32,
    before: [i32; 2],
    category: HumanScoreCategory,
    player: Side,
    cards: Vec<Card>,
) {
    let scores = human_score_snapshot(&record.game);
    let total_score = human_score_for_side(scores, player);
    let points = total_score - human_score_for_side(before, player);
    let event_number = record.score_events.len() + 1;
    record.score_events.push(HumanScoreEvent {
        id: format!("{}-score-{}", record.game_id, event_number),
        at: unix_seconds(),
        hand_number,
        player,
        dealer: record.game.dealer,
        category,
        points,
        total_score,
        scores,
        cards,
        turn_card: record.game.turn_card,
    });
}

fn evaluate_human_decision_review(
    pending: &HumanDecisionReview,
    model_root: &str,
) -> Result<HumanCompletedDecisionReview, PeopleError> {
    let review = match pending.kind {
        HumanReviewKind::Discard => {
            if pending.selected_card_ids.len() != 2 {
                return Err(PeopleError::bad_request(
                    "The saved discard review is malformed.",
                ));
            }
            review_discard_for_side_with_recommendation(
                &pending.game,
                pending.player,
                ACE_MODEL_ID,
                [pending.selected_card_ids[0], pending.selected_card_ids[1]],
                None,
                model_root,
            )
        }
        HumanReviewKind::Peg => {
            let selected = pending.selected_card_ids.first().copied().ok_or_else(|| {
                PeopleError::bad_request("The saved pegging review is malformed.")
            })?;
            review_peg_for_side_with_recommendation(
                &pending.game,
                pending.player,
                ACE_MODEL_ID,
                selected,
                None,
                model_root,
            )
        }
    }
    .map_err(|error| PeopleError::internal("evaluate player decision", error))?;
    Ok(human_completed_review(review))
}

fn human_completed_review(review: EngineDecisionReview) -> HumanCompletedDecisionReview {
    HumanCompletedDecisionReview {
        evaluator_model: DYNAMIC_EVALUATOR_VERSION.to_string(),
        selected_card_ids: review.selected.card_ids,
        recommended_card_ids: review.recommended.card_ids,
        selected_ev: review.selected.ev.unwrap_or(0.0),
        recommended_ev: review.recommended.ev.unwrap_or(0.0),
        selected_win_probability: review.selected.win_probability,
        recommended_win_probability: review.recommended.win_probability,
    }
}

fn table_viewer_side(row: &TableRow, viewer_id: i64) -> Result<Side, PeopleError> {
    if viewer_id == row.challenger_id {
        Ok(Side::Left)
    } else if viewer_id == row.challenged_id {
        Ok(Side::Right)
    } else {
        Err(PeopleError::not_found("That player table was not found."))
    }
}

fn load_human_game(
    connection: &rusqlite::Connection,
    table_id: &str,
) -> Result<(HumanGameRecord, i64), PeopleError> {
    let (stored, revision) = connection
        .query_row(
            "SELECT game_json, revision FROM people_games WHERE table_id = ?1",
            [table_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|error| PeopleError::internal("read player game", error))?
        .ok_or_else(|| PeopleError::conflict("The player game has not started yet."))?;
    let record = serde_json::from_str::<HumanGameRecord>(&stored)
        .map_err(|error| PeopleError::internal("parse player game", error))?;
    if record.version != 1 {
        return Err(PeopleError::conflict(
            "This player game was saved by an unsupported version.",
        ));
    }
    Ok((record, revision))
}

fn human_action_card_ids(payload: &Value, expected: usize) -> Result<Vec<u8>, PeopleError> {
    let ids = payload["ids"]
        .as_array()
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_u64().and_then(|id| u8::try_from(id).ok()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if ids.len() != expected {
        return Err(PeopleError::bad_request(format!(
            "Choose exactly {expected} cards."
        )));
    }
    Ok(ids)
}

fn record_head_to_head_game(
    connection: &rusqlite::Connection,
    row: &TableRow,
    record: &HumanGameRecord,
    completed_at: i64,
) -> Result<(), PeopleError> {
    let left_score = record.game.player(Side::Left).score;
    let right_score = record.game.player(Side::Right).score;
    let winner_id = if left_score >= 121 {
        row.challenger_id
    } else {
        row.challenged_id
    };
    connection
        .execute(
            "INSERT OR IGNORE INTO people_head_to_head_games
             (game_id, first_player_id, second_player_id, winner_id, first_score, second_score, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.game_id,
                row.challenger_id,
                row.challenged_id,
                winner_id,
                left_score,
                right_score,
                completed_at,
            ],
        )
        .map_err(|error| PeopleError::internal("record player game result", error))?;
    Ok(())
}

fn view_key(side: Side, viewer: Side) -> &'static str {
    if side == viewer {
        "human"
    } else {
        "ai"
    }
}

fn view_label(side: Side, viewer: Side) -> &'static str {
    if side == viewer {
        "User"
    } else {
        "AI"
    }
}

fn view_number(side: Side, viewer: Side) -> u8 {
    if side == viewer {
        0
    } else {
        1
    }
}

fn human_public_phase(record: &HumanGameRecord, viewer: Side) -> &'static str {
    if let Some(stage) = record.pending_final_scoring {
        return match stage {
            HumanFinalScoringStage::Pone => "score_pone",
            HumanFinalScoringStage::Dealer => "score_dealer",
            HumanFinalScoringStage::Crib => "score_crib",
        };
    }
    match record.game.phase {
        Phase::Discard if record.game.player(viewer).hand.len() == 4 => "ai_discarding",
        Phase::Discard => "discard",
        Phase::Pegging => "pegging",
        Phase::PeggingComplete => "pegging_complete",
        Phase::ScorePone => "score_pone",
        Phase::ScoreDealer => "score_dealer",
        Phase::ScoreCrib => "score_crib",
        Phase::GameOver => "game_over",
    }
}

fn human_card_value(card: Card, owner: Option<&str>) -> Value {
    let symbol = match card.suit {
        0 => "♦",
        1 => "♣",
        2 => "♥",
        _ => "♠",
    };
    let mut value = json!({
        "index": card.id,
        "id": card.id,
        "rank": RANKS[card.rank as usize],
        "suit": SUIT_NAMES[card.suit as usize],
        "symbol": symbol,
        "value": card.value,
        "label": card.label(),
    });
    if let Some(owner) = owner {
        value["owner"] = Value::String(owner.to_string());
    }
    value
}

fn human_cards_value(cards: &[Card], owner: Option<&str>) -> Value {
    Value::Array(
        cards
            .iter()
            .copied()
            .map(|card| human_card_value(card, owner))
            .collect(),
    )
}

fn human_owned_cards_value(cards: &[Card], owners: &[Side], viewer: Side) -> Value {
    Value::Array(
        cards
            .iter()
            .enumerate()
            .map(|(index, card)| {
                human_card_value(
                    *card,
                    owners
                        .get(index)
                        .copied()
                        .map(|side| view_key(side, viewer)),
                )
            })
            .collect(),
    )
}

fn human_nested_owned_cards_value(
    groups: &[Vec<Card>],
    owner_groups: &[Vec<Side>],
    viewer: Side,
) -> Value {
    Value::Array(
        groups
            .iter()
            .enumerate()
            .map(|(index, cards)| {
                human_owned_cards_value(
                    cards,
                    owner_groups.get(index).map(Vec::as_slice).unwrap_or(&[]),
                    viewer,
                )
            })
            .collect(),
    )
}

fn human_scoring_value(record: &HumanGameRecord, viewer: Side) -> Value {
    let game = &record.game;
    let final_details = record.pending_final_scoring.map(|stage| match stage {
        HumanFinalScoringStage::Pone => (
            "pone",
            game.pone,
            game.player(game.pone).table.as_slice(),
            false,
            "View game result",
        ),
        HumanFinalScoringStage::Dealer => (
            "dealer",
            game.dealer,
            game.player(game.dealer).table.as_slice(),
            false,
            "View game result",
        ),
        HumanFinalScoringStage::Crib => (
            "crib",
            game.dealer,
            game.player(game.dealer).crib.as_slice(),
            true,
            "View game result",
        ),
    });
    let details = final_details.or_else(|| match game.phase {
        Phase::ScorePone => Some((
            "pone",
            game.pone,
            game.player(game.pone).table.as_slice(),
            false,
            "Show dealer hand",
        )),
        Phase::ScoreDealer => Some((
            "dealer",
            game.dealer,
            game.player(game.dealer).table.as_slice(),
            false,
            "Show crib",
        )),
        Phase::ScoreCrib => Some((
            "crib",
            game.dealer,
            game.player(game.dealer).crib.as_slice(),
            true,
            "Next hand",
        )),
        _ => None,
    });
    let Some((stage, owner, cards, crib, next_label)) = details else {
        return Value::Null;
    };
    let components = score_hand_components(cards, game.turn_card, crib);
    json!({
        "stage": stage,
        "title": format!("{} {}", view_label(owner, viewer), if crib { "crib" } else { "hand" }),
        "owner": view_label(owner, viewer),
        "cards": human_cards_value(cards, Some(view_key(owner, viewer))),
        "points": components.total(),
        "components": {
            "total": components.total(),
            "fifteens": components.fifteens,
            "pairs": components.pairs,
            "runs": components.runs,
            "flush": components.flush,
            "knobs": components.knobs,
        },
        "nextLabel": next_label,
    })
}

fn human_scoring_controller(record: &HumanGameRecord) -> Option<Side> {
    let game = &record.game;
    if let Some(stage) = record.pending_final_scoring {
        return Some(match stage {
            HumanFinalScoringStage::Pone => game.pone,
            HumanFinalScoringStage::Dealer | HumanFinalScoringStage::Crib => game.dealer,
        });
    }
    match game.phase {
        Phase::PeggingComplete | Phase::ScorePone => Some(game.pone),
        Phase::ScoreDealer | Phase::ScoreCrib => Some(game.dealer),
        _ => None,
    }
}

fn human_game_message(record: &HumanGameRecord, viewer: Side) -> String {
    let game = &record.game;
    match human_public_phase(record, viewer) {
        "discard" => format!(
            "Select two cards to discard to {} crib.",
            if game.dealer == viewer {
                "your"
            } else {
                "your opponent's"
            }
        ),
        "ai_discarding" => "Waiting for your opponent to discard.".to_string(),
        "pegging" if game.current_player() == viewer => "Your play.".to_string(),
        "pegging" => "Waiting for your opponent to play.".to_string(),
        "pegging_complete" => "Pegging complete. The pone counts first.".to_string(),
        "score_pone" => format!("{} hand counted.", view_label(game.pone, viewer)),
        "score_dealer" => format!("{} hand counted.", view_label(game.dealer, viewer)),
        "score_crib" => format!("{} crib counted.", view_label(game.dealer, viewer)),
        "game_over" => "Game over.".to_string(),
        _ => String::new(),
    }
}

fn human_game_analytics(record: &HumanGameRecord, row: &TableRow, viewer: Side) -> Value {
    let timestamp = |seconds: i64| {
        super::iso8601_from_unix_millis(
            u64::try_from(seconds)
                .unwrap_or_default()
                .saturating_mul(1_000),
        )
    };
    let created_at = timestamp(record.created_at);
    let mut events = vec![json!({
        "id": format!("{}-start", record.game_id),
        "at": created_at,
        "type": "game",
        "action": "start",
        "gameId": record.game_id,
        "opponent": "human",
        "players": {
            "human": if viewer == Side::Left { &row.challenger_display_name } else { &row.challenged_display_name },
            "ai": if viewer == Side::Left { &row.challenged_display_name } else { &row.challenger_display_name },
        },
    })];
    events.extend(record.score_events.iter().map(|event| {
        let crib = event.category == HumanScoreCategory::Crib;
        let components = score_hand_components(&event.cards, event.turn_card, crib);
        json!({
            "id": event.id,
            "at": timestamp(event.at),
            "type": "score",
            "gameId": record.game_id,
            "handNumber": event.hand_number,
            "player": view_key(event.player, viewer),
            "role": if event.player == event.dealer { "dealer" } else { "pone" },
            "category": if crib { "crib" } else { "hand" },
            "points": event.points,
            "reason": if crib { "Crib" } else { "Hand" },
            "totalScore": event.total_score,
            "scores": {
                "human": human_score_for_side(event.scores, viewer),
                "ai": human_score_for_side(event.scores, viewer.other()),
            },
            "cards": event.cards.iter().map(Card::label).collect::<Vec<_>>(),
            "turnCard": event.turn_card.label(),
            "scoreComponents": {
                "total": components.total(),
                "fifteens": components.fifteens,
                "pairs": components.pairs,
                "runs": components.runs,
                "flush": components.flush,
                "knobs": components.knobs,
            },
        })
    }));
    if record.game.phase == Phase::GameOver && record.pending_final_scoring.is_none() {
        events.extend(record.decision_reviews.iter().map(|review| {
            human_decision_review_value(record, review, viewer, timestamp(review.at))
        }));
        let winner = if record.game.player(Side::Left).score >= 121 {
            Side::Left
        } else {
            Side::Right
        };
        let loser = winner.other();
        let loser_score = record.game.player(loser).score;
        let result = if loser_score <= 60 {
            "double-skunk"
        } else if loser_score <= 90 {
            "skunk"
        } else {
            "regular"
        };
        events.push(json!({
            "id": format!("{}-end", record.game_id),
            "at": timestamp(record.completed_at.unwrap_or(record.created_at)),
            "type": "game",
            "action": "end",
            "gameId": record.game_id,
            "opponent": "human",
            "players": {
                "human": if viewer == Side::Left { &row.challenger_display_name } else { &row.challenged_display_name },
                "ai": if viewer == Side::Left { &row.challenged_display_name } else { &row.challenger_display_name },
            },
            "winner": view_key(winner, viewer),
            "loser": view_key(loser, viewer),
            "result": result,
            "finalScores": {
                "human": record.game.player(viewer).score,
                "ai": record.game.player(viewer.other()).score,
            },
        }));
    }
    Value::Array(events)
}

fn human_decision_review_value(
    record: &HumanGameRecord,
    saved: &HumanDecisionReview,
    viewer: Side,
    at: String,
) -> Value {
    let game = &saved.game;
    let player = view_key(saved.player, viewer);
    let selected = human_card_labels(&saved.selected_card_ids);
    let role = if game.dealer == saved.player {
        "dealer"
    } else {
        "pone"
    };
    let mut event = match saved.kind {
        HumanReviewKind::Discard => {
            let remaining = game
                .player(saved.player)
                .hand
                .iter()
                .filter(|card| !saved.selected_card_ids.contains(&card.id))
                .map(Card::label)
                .collect::<Vec<_>>();
            json!({
                "id": saved.id,
                "at": at,
                "type": "discard",
                "gameId": record.game_id,
                "handNumber": game.hand_number,
                "player": player,
                "role": role,
                "cards": selected,
                "cribOwner": view_key(game.dealer, viewer),
                "cribAfterDiscard": selected,
                "remainingHand": remaining,
                "handBeforeDiscard": game.player(saved.player).hand.iter().map(Card::label).collect::<Vec<_>>(),
                "scores": {
                    "human": game.player(viewer).score,
                    "ai": game.player(viewer.other()).score,
                },
                "dealer": view_key(game.dealer, viewer),
                "model": DYNAMIC_EVALUATOR_VERSION,
            })
        }
        HumanReviewKind::Peg => {
            let selected_card = saved
                .selected_card_ids
                .first()
                .and_then(|id| Card::new(*id).ok());
            json!({
                "id": saved.id,
                "at": at,
                "type": "pegging",
                "action": "play",
                "gameId": record.game_id,
                "handNumber": game.hand_number,
                "player": player,
                "role": role,
                "card": selected.first().cloned().unwrap_or_else(|| "card".to_string()),
                "hand": game.player(saved.player).hand.iter().map(Card::label).collect::<Vec<_>>(),
                "playedCards": game.plays.iter().map(Card::label).collect::<Vec<_>>(),
                "completedPlayGroups": game.completed_plays.iter().map(|cards| cards.iter().map(Card::label).collect::<Vec<_>>()).collect::<Vec<_>>(),
                "cutCard": game.turn_card.label(),
                "countBefore": game.count,
                "scoresBefore": {
                    "human": game.player(viewer).score,
                    "ai": game.player(viewer.other()).score,
                },
                "count": game.count.saturating_add(selected_card.map(|card| card.value).unwrap_or_default()),
                "scores": {
                    "human": game.player(viewer).score,
                    "ai": game.player(viewer.other()).score,
                },
                "message": format!("{} played {}", player, selected.first().cloned().unwrap_or_else(|| "a card".to_string())),
                "model": DYNAMIC_EVALUATOR_VERSION,
            })
        }
    };
    if let Some(completed) = &saved.completed {
        event["review"] = human_completed_review_value(completed);
    }
    event
}

fn human_completed_review_value(review: &HumanCompletedDecisionReview) -> Value {
    let mut value = json!({
        "model": review.evaluator_model,
        "selected": human_card_labels(&review.selected_card_ids),
        "recommended": human_card_labels(&review.recommended_card_ids),
        "selectedEv": review.selected_ev,
        "recommendedEv": review.recommended_ev,
        "delta": review.recommended_ev - review.selected_ev,
    });
    if let (Some(selected), Some(recommended)) = (
        review.selected_win_probability,
        review.recommended_win_probability,
    ) {
        value["selectedWinProbability"] = Value::from(selected);
        value["recommendedWinProbability"] = Value::from(recommended);
        value["winProbabilityDelta"] = Value::from(recommended - selected);
    }
    value
}

fn human_card_labels(ids: &[u8]) -> Vec<String> {
    ids.iter()
        .filter_map(|id| Card::new(*id).ok())
        .map(|card| card.label())
        .collect()
}

fn acknowledge_human_game_action(
    mut response: Value,
    action_id: &str,
    applied_revision: i64,
    already_applied: bool,
) -> Value {
    response["acknowledgment"] = json!({
        "actionId": action_id,
        "appliedRevision": applied_revision,
        "alreadyApplied": already_applied,
    });
    response
}

fn human_game_response(
    table_id: &str,
    row: &TableRow,
    record: &HumanGameRecord,
    revision: i64,
    viewer: Side,
) -> Value {
    let game = &record.game;
    let opponent = viewer.other();
    let phase = human_public_phase(record, viewer);
    let scoring = human_scoring_value(record, viewer);
    let analytics = human_game_analytics(record, row, viewer);
    let turn_card = if record.turn_card_revealed {
        human_card_value(game.turn_card, None)
    } else {
        Value::Null
    };
    let legal = if phase == "pegging" && game.current_player() == viewer {
        game.legal_cards(viewer)
            .iter()
            .map(|card| Value::from(card.id))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let result = if game.phase == Phase::GameOver && record.pending_final_scoring.is_none() {
        let winner = if game.player(Side::Left).score >= 121 {
            Side::Left
        } else {
            Side::Right
        };
        vec![Value::String(format!(
            "{} wins.",
            view_label(winner, viewer)
        ))]
    } else {
        Vec::new()
    };
    let state = json!({
        "phase": phase,
        "message": human_game_message(record, viewer),
        "log": [],
        "result": result,
        "handNumber": game.hand_number,
        "scores": {
            "human": game.player(viewer).score,
            "ai": game.player(opponent).score,
        },
        "pegPositions": {
            "human": [game.player(viewer).score, game.player(viewer).score],
            "ai": [game.player(opponent).score, game.player(opponent).score],
        },
        "dealer": view_label(game.dealer, viewer),
        "firstDealer": view_label(game.first_deal, viewer),
        "cribOwner": view_label(game.dealer, viewer),
        "turn": if phase == "pegging" { Value::String(view_label(game.current_player(), viewer).to_string()) } else { Value::Null },
        "count": game.count,
        "turnCard": turn_card,
        "turnCardRevealed": record.turn_card_revealed,
        "plays": human_owned_cards_value(&game.plays, &game.play_owners, viewer),
        "completedPlays": human_nested_owned_cards_value(&game.completed_plays, &game.completed_play_owners, viewer),
        "peggingResetPending": game.pegging_reset_pending,
        "humanHand": human_cards_value(&game.player(viewer).hand, Some("human")),
        "aiHandCount": game.player(opponent).hand.len(),
        "humanTable": human_cards_value(&game.player(viewer).table, Some("human")),
        "aiTable": human_cards_value(&game.player(opponent).table, Some("ai")),
        "legalCardIds": legal,
        "aiLegalCardIds": [],
        "canGo": phase == "pegging" && game.current_player() == viewer && game.legal_cards(viewer).is_empty(),
        "scoring": scoring,
        "cutForDeal": Value::Null,
        "dynamicCalibration": Value::Null,
        "analyticsEvents": analytics,
    });

    let scoring_review = if scoring.is_null() {
        Value::Null
    } else {
        json!({
            "stage": scoring["stage"],
            "title": scoring["title"],
            "owner": scoring["owner"],
            "rawCards": scoring["cards"].as_array().unwrap_or(&Vec::new()).iter().map(|card| card["id"].clone()).collect::<Vec<_>>(),
            "points": scoring["points"],
            "components": scoring["components"],
            "nextLabel": scoring["nextLabel"],
        })
    };
    let mapped_side = |side: Side| Value::String(view_key(side, viewer).to_string());
    let snapshot = json!({
        "version": 1,
        "gameId": record.game_id,
        "analyticsCounter": revision,
        "analyticsEvents": state["analyticsEvents"],
        "opponent": "human",
        "deal": view_number(game.deal, viewer),
        "firstDeal": view_number(game.first_deal, viewer),
        "handNumber": game.hand_number,
        "human": {
            "hand": game.player(viewer).hand.iter().map(|card| card.id).collect::<Vec<_>>(),
            "table": game.player(viewer).table.iter().map(|card| card.id).collect::<Vec<_>>(),
            "crib": [],
            "score": game.player(viewer).score,
        },
        "ai": {
            "hand": [],
            "table": game.player(opponent).table.iter().map(|card| card.id).collect::<Vec<_>>(),
            "crib": [],
            "score": game.player(opponent).score,
        },
        "turnCard": if record.turn_card_revealed { Value::from(game.turn_card.id) } else { Value::Null },
        "turnCardRevealed": record.turn_card_revealed,
        "crib": [],
        "plays": game.plays.iter().map(|card| card.id).collect::<Vec<_>>(),
        "playOwners": game.play_owners.iter().map(|side| view_key(*side, viewer)).collect::<Vec<_>>(),
        "completedPlays": game.completed_plays.iter().map(|cards| cards.iter().map(|card| card.id).collect::<Vec<_>>()).collect::<Vec<_>>(),
        "completedPlayOwners": game.completed_play_owners.iter().map(|owners| owners.iter().map(|side| view_key(*side, viewer)).collect::<Vec<_>>()).collect::<Vec<_>>(),
        "peggingResetPending": game.pegging_reset_pending,
        "count": game.count,
        "turn": view_number(game.current_player(), viewer),
        "goPlayer": game.go_player.map(&mapped_side).unwrap_or(Value::Null),
        "lastPlayer": game.last_player.map(&mapped_side).unwrap_or(Value::Null),
        "scoringReview": scoring_review,
        "phase": phase,
        "message": state["message"],
        "log": [],
        "result": state["result"],
        "pegPositions": state["pegPositions"],
        "pendingDiscardReviews": [],
        "pendingPeggingReviews": [],
    });
    json!({
        "tableId": table_id,
        "revision": revision,
        "canContinueScoring": human_scoring_controller(record) == Some(viewer),
        "canAcknowledgePeggingReset": game.pegging_reset_pending && game.current_player() == viewer,
        "players": {
            "human": if viewer == Side::Left { row.challenger_display_name.clone() } else { row.challenged_display_name.clone() },
            "ai": if viewer == Side::Left { row.challenged_display_name.clone() } else { row.challenger_display_name.clone() },
        },
        "state": state,
        "snapshot": snapshot,
    })
}

fn player_value(
    username: &str,
    display_name: &str,
    avatar: Option<String>,
    handicap: Option<Value>,
) -> Value {
    let mut player = json!({
        "username": username,
        "displayName": display_name,
        "avatarDataUrl": avatar,
    });
    if let Some(handicap) = handicap {
        player["dynamicHandicap"] = handicap;
    }
    player
}

fn challenge_value(
    id: &str,
    table_id: &str,
    status: &str,
    username: &str,
    display_name: &str,
    avatar: Option<String>,
    handicap: Option<Value>,
) -> Value {
    json!({
        "id": id,
        "tableId": table_id,
        "status": status,
        "player": player_value(username, display_name, avatar, handicap),
    })
}

fn cut_card_value(card: i64) -> Value {
    const RANKS: [&str; 13] = [
        "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
    ];
    const SUITS: [(&str, &str); 4] = [
        ("clubs", "♣"),
        ("diamonds", "♦"),
        ("hearts", "♥"),
        ("spades", "♠"),
    ];
    let rank = (card.rem_euclid(13)) as usize;
    let suit = (card.div_euclid(13).rem_euclid(4)) as usize;
    json!({
        "id": card,
        "rank": RANKS[rank],
        "suit": SUITS[suit].0,
        "symbol": SUITS[suit].1,
    })
}

fn cut_rank(card: i64) -> i64 {
    card.rem_euclid(13)
}

fn random_cut_card(other: Option<i64>) -> i64 {
    loop {
        let mut bytes = [0u8; 4];
        OsRng.fill_bytes(&mut bytes);
        let card = (u32::from_le_bytes(bytes) % 52) as i64;
        if other
            .map(|value| cut_rank(value) != cut_rank(card))
            .unwrap_or(true)
        {
            return card;
        }
    }
}

fn validate_username(value: &str) -> Result<String, PeopleError> {
    let username = value
        .trim()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let length = username.chars().count();
    if !(2..=28).contains(&length) {
        return Err(PeopleError::bad_request(
            "Use 2 to 28 characters for your username.",
        ));
    }
    if !username
        .chars()
        .all(|character| character.is_alphanumeric() || matches!(character, ' ' | '-' | '_' | '\''))
    {
        return Err(PeopleError::bad_request(
            "Usernames can use letters, numbers, spaces, apostrophes, hyphens, and underscores.",
        ));
    }
    Ok(username)
}

fn validate_email(value: &str) -> Result<String, PeopleError> {
    let email = value.trim();
    let parts = email.split('@').collect::<Vec<_>>();
    if email.len() > 254
        || parts.len() != 2
        || parts[0].is_empty()
        || !parts[1].contains('.')
        || email.chars().any(char::is_whitespace)
    {
        return Err(PeopleError::bad_request("Enter a valid email address."));
    }
    Ok(email.to_string())
}

fn validate_text_size(value: &str) -> Result<(), PeopleError> {
    if matches!(value, "normal" | "large" | "x-large") {
        Ok(())
    } else {
        Err(PeopleError::bad_request("Choose a supported text size."))
    }
}

fn validate_avatar(value: Option<&str>) -> Result<Option<String>, PeopleError> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let encoded = [
        "data:image/jpeg;base64,",
        "data:image/png;base64,",
        "data:image/webp;base64,",
    ]
    .iter()
    .find_map(|prefix| value.strip_prefix(prefix))
    .ok_or_else(|| PeopleError::bad_request("Choose a JPEG, PNG, or WebP profile picture."))?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| PeopleError::bad_request("That profile picture could not be read."))?;
    if bytes.len() > MAX_AVATAR_BYTES {
        return Err(PeopleError::bad_request(
            "Keep the profile picture under 420 KB after resizing.",
        ));
    }
    Ok(Some(value.to_string()))
}

fn normalize_email(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn random_id(prefix: &str) -> String {
    let mut bytes = [0u8; 18];
    OsRng.fill_bytes(&mut bytes);
    format!("{}-{}", prefix, URL_SAFE_NO_PAD.encode(bytes))
}

fn parse<T: for<'de> Deserialize<'de>>(
    request: &Request,
    message: &'static str,
) -> Result<T, PeopleError> {
    serde_json::from_str(&request.body).map_err(|_| PeopleError::bad_request(message))
}

fn unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Barrier, Mutex};

    fn test_server(name: &str) -> Server {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-people-{}-{}-{}",
            name,
            std::process::id(),
            super::super::unix_millis()
        ));
        super::super::initialize_game_database(&data_dir).unwrap();
        super::super::auth::initialize(&data_dir).unwrap();
        initialize(&data_dir).unwrap();
        Server {
            state: Mutex::new(super::super::AppState {
                sessions: HashMap::new(),
                uploads: HashMap::new(),
                leaderboard_summary: "{}".to_string(),
            }),
            model_root: String::new(),
            data_dir,
        }
    }

    fn user(server: &Server, username: &str) -> AuthUser {
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .query_row(
                "SELECT id, username, display_name, email, password_hash FROM auth_users WHERE username = ?1",
                [username],
                super::super::auth::user_from_row,
            )
            .unwrap()
    }

    fn request(path: &str, body: Value) -> Request {
        Request {
            method: "POST".to_string(),
            path: path.to_string(),
            headers: HashMap::new(),
            body: body.to_string(),
        }
    }

    #[test]
    fn updates_the_public_profile_and_durable_text_size() {
        let server = test_server("profile");
        let account = user(&server, "Garrett");
        let response = update_profile(
            &server,
            &request(
                "/api/people/me",
                json!({
                    "username": "Garrett 29",
                    "email": "new@example.com",
                    "avatarDataUrl": "data:image/png;base64,aGVsbG8=",
                    "textSize": "large"
                }),
            ),
            Some(&account),
        )
        .unwrap();
        assert_eq!(response["profile"]["username"], "Garrett 29");
        assert_eq!(response["profile"]["email"], "new@example.com");
        assert_eq!(response["profile"]["textSize"], "large");
        assert_eq!(
            response["profile"]["avatarDataUrl"],
            "data:image/png;base64,aGVsbG8="
        );
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn public_profile_includes_viewer_head_to_head_results() {
        let server = test_server("head-to-head");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let connection = open_game_database(&server.data_dir).unwrap();
        for (game_id, first_id, second_id, winner_id, first_score, second_score) in [
            ("h2h-1", garrett.id, kurt.id, garrett.id, 121, 90),
            ("h2h-2", kurt.id, garrett.id, kurt.id, 121, 113),
            ("h2h-3", garrett.id, kurt.id, garrett.id, 121, 119),
        ] {
            connection
                .execute(
                    "INSERT INTO people_head_to_head_games
                     (game_id, first_player_id, second_player_id, winner_id, first_score, second_score, completed_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![game_id, first_id, second_id, winner_id, first_score, second_score, unix_seconds()],
                )
                .unwrap();
        }
        drop(connection);

        let value = profile_value(&server, "Kurt", Some(garrett.id), false).unwrap();
        assert_eq!(value["profile"]["headToHead"]["games"], 3);
        assert_eq!(value["profile"]["headToHead"]["viewerWins"], 2);
        assert_eq!(value["profile"]["headToHead"]["profileWins"], 1);
        assert_eq!(value["profile"]["headToHead"]["viewerSkunks"], 1);
        assert_eq!(value["profile"]["headToHead"]["profileSkunks"], 0);
        assert_eq!(
            value["profile"]["headToHead"]["viewerAverageMargin"],
            json!(25.0 / 3.0)
        );
        let own = profile_value(&server, "Garrett", Some(garrett.id), true).unwrap();
        assert!(own["profile"].get("headToHead").is_none());
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn player_profile_includes_the_versioned_ace_handicap() {
        let server = test_server("dynamic-handicap");
        let garrett = user(&server, "Garrett");
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO dynamic_player_profiles
                 (user_id, evaluator_version, profile_json, updated_at)
                 VALUES (?1, 'ace-13.0', ?2, '2026-09-02T00:00:00.000Z')",
                params![
                    garrett.id,
                    json!({"started_dynamic": true, "complete_cycles": 8, "handicap_cycles": 8, "ewma_cycle_handicap": -0.025, "length_games": 6, "ewma_cycles_per_game": 5.0}).to_string(),
                ],
            )
            .unwrap();
        drop(connection);

        let value = profile_value(&server, "Garrett", Some(garrett.id), true).unwrap();
        assert_eq!(value["profile"]["dynamicHandicap"]["cycles"], 8);
        assert_eq!(value["profile"]["dynamicCalibration"]["completeCycles"], 8);
        assert_eq!(
            value["profile"]["dynamicCalibration"]["minimumCycles"],
            MIN_COMPLETE_CYCLES
        );
        assert_eq!(value["profile"]["dynamicCalibration"]["complete"], true);
        assert_eq!(value["profile"]["dynamicHandicap"]["wpPerGame"], -0.125);
        assert_eq!(
            value["profile"]["dynamicHandicap"]["evaluatorVersion"],
            "ace-13.0"
        );
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn player_profile_omits_handicap_until_calibration_is_complete() {
        let server = test_server("incomplete-dynamic-handicap");
        let garrett = user(&server, "Garrett");
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO dynamic_player_profiles
                 (user_id, evaluator_version, profile_json, updated_at)
                 VALUES (?1, 'ace-13.0', ?2, '2026-09-02T00:00:00.000Z')",
                params![
                    garrett.id,
                    json!({"started_dynamic": true, "complete_cycles": 5, "handicap_cycles": 5, "ewma_cycle_handicap": -0.025, "length_games": 6, "ewma_cycles_per_game": 5.0}).to_string(),
                ],
            )
            .unwrap();
        drop(connection);

        let value = profile_value(&server, "Garrett", Some(garrett.id), true).unwrap();
        assert!(value["profile"].get("dynamicHandicap").is_none());
        assert_eq!(value["profile"]["dynamicCalibration"]["complete"], false);
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn lists_looking_players_first_and_excludes_the_viewer() {
        let server = test_server("directory");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let vince = user(&server, "Vince");
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO dynamic_player_profiles
                 (user_id, evaluator_version, profile_json, updated_at)
                 VALUES (?1, 'ace-13.0', ?2, '2026-09-02T00:00:00.000Z')",
                params![
                    vince.id,
                    json!({"started_dynamic": true, "complete_cycles": 8, "handicap_cycles": 8, "ewma_cycle_handicap": -0.025, "length_games": 6, "ewma_cycles_per_game": 5.0}).to_string(),
                ],
            )
            .unwrap();
        drop(connection);
        for (account, looking) in [(&garrett, false), (&kurt, false), (&vince, true)] {
            heartbeat(
                &server,
                &request("/api/people/presence", json!({"lookingForGame": looking})),
                Some(account),
            )
            .unwrap();
        }
        let value = directory_value(&server, Some(&garrett)).unwrap();
        assert_eq!(value["onlineCount"], 3);
        assert_eq!(value["players"][0]["username"], "Vince");
        assert_eq!(value["players"][0]["lookingForGame"], true);
        assert_eq!(value["players"][0]["dynamicHandicap"]["wpPerGame"], -0.125);
        assert_eq!(value["players"][1]["username"], "Kurt");
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn presence_expires_after_fifteen_minutes_even_for_an_account() {
        assert_eq!(ONLINE_SECONDS, 15 * 60);
        let server = test_server("presence-idle");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        heartbeat(
            &server,
            &request("/api/people/presence", json!({"lookingForGame": false})),
            Some(&kurt),
        )
        .unwrap();
        assert_eq!(
            profile_value(&server, "Kurt", Some(garrett.id), false).unwrap()["profile"]["online"],
            true
        );

        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "UPDATE people_presence SET last_seen_at = ?2 WHERE user_id = ?1",
                params![kurt.id, unix_seconds() - ONLINE_SECONDS - 1],
            )
            .unwrap();
        drop(connection);

        assert_eq!(
            profile_value(&server, "Kurt", Some(garrett.id), false).unwrap()["profile"]["online"],
            false
        );
        assert!(directory_value(&server, Some(&garrett)).unwrap()["players"]
            .as_array()
            .unwrap()
            .is_empty());
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn challenge_acceptance_reaches_a_shared_cut_for_deal_table() {
        let server = test_server("challenge");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        heartbeat(
            &server,
            &request("/api/people/presence", json!({"lookingForGame": false})),
            Some(&kurt),
        )
        .unwrap();
        let challenge = create_challenge(
            &server,
            &request("/api/people/challenge", json!({"username": "Kurt"})),
            Some(&garrett),
        )
        .unwrap();
        let challenge_id = challenge["challenge"]["id"].as_str().unwrap();
        let table_id = challenge["challenge"]["tableId"].as_str().unwrap();
        let watched = watch_challenges(
            &server,
            &request(
                "/api/people/challenges/watch",
                json!({"knownChallengeIds": []}),
            ),
            Some(&kurt),
        )
        .unwrap();
        assert_eq!(watched["incomingChallenges"][0]["id"], challenge_id);
        let accepted = accept_challenge(
            &server,
            &request(
                "/api/people/challenge/accept",
                json!({"challengeId": challenge_id}),
            ),
            Some(&kurt),
        )
        .unwrap();
        assert_eq!(accepted["tableId"], table_id);
        let cleared = watch_challenges(
            &server,
            &request(
                "/api/people/challenges/watch",
                json!({"knownChallengeIds": [challenge_id]}),
            ),
            Some(&kurt),
        )
        .unwrap();
        assert!(cleared["incomingChallenges"].as_array().unwrap().is_empty());
        let from_challenger = table_value(&server, table_id, garrett.id).unwrap();
        let from_challenged = table_value(&server, table_id, kurt.id).unwrap();
        assert_eq!(from_challenger["table"]["phase"], "cut_for_deal");
        assert_eq!(
            from_challenged["table"]["id"],
            from_challenger["table"]["id"]
        );
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn crossed_challenge_joins_and_accepts_the_first_table() {
        let server = test_server("crossed-challenge");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        for player in [&garrett, &kurt] {
            heartbeat(
                &server,
                &request("/api/people/presence", json!({"lookingForGame": true})),
                Some(player),
            )
            .unwrap();
        }

        let first = create_challenge(
            &server,
            &request("/api/people/challenge", json!({"username": "Kurt"})),
            Some(&garrett),
        )
        .unwrap();
        let crossed = create_challenge(
            &server,
            &request("/api/people/challenge", json!({"username": "Garrett"})),
            Some(&kurt),
        )
        .unwrap();

        assert_eq!(crossed["challenge"]["id"], first["challenge"]["id"]);
        assert_eq!(
            crossed["challenge"]["tableId"],
            first["challenge"]["tableId"]
        );
        assert_eq!(crossed["challenge"]["status"], "accepted");
        let table_id = first["challenge"]["tableId"].as_str().unwrap();
        let from_garrett = table_value(&server, table_id, garrett.id).unwrap();
        let from_kurt = table_value(&server, table_id, kurt.id).unwrap();
        assert_eq!(from_garrett["table"]["phase"], "cut_for_deal");
        assert_eq!(from_kurt["table"]["id"], from_garrett["table"]["id"]);

        let connection = open_game_database(&server.data_dir).unwrap();
        let pair_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM people_challenges
                 WHERE (challenger_id = ?1 AND challenged_id = ?2)
                    OR (challenger_id = ?2 AND challenged_id = ?1)",
                params![garrett.id, kurt.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pair_count, 1);
        drop(connection);
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn simultaneous_crossed_challenges_create_one_table() {
        let server = Arc::new(test_server("simultaneous-crossed-challenge"));
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        for player in [&garrett, &kurt] {
            heartbeat(
                &server,
                &request("/api/people/presence", json!({"lookingForGame": true})),
                Some(player),
            )
            .unwrap();
        }

        let barrier = Arc::new(Barrier::new(3));
        let first_server = Arc::clone(&server);
        let first_barrier = Arc::clone(&barrier);
        let first_player = garrett.clone();
        let first = std::thread::spawn(move || {
            first_barrier.wait();
            create_challenge(
                &first_server,
                &request("/api/people/challenge", json!({"username": "Kurt"})),
                Some(&first_player),
            )
            .unwrap()
        });
        let second_server = Arc::clone(&server);
        let second_barrier = Arc::clone(&barrier);
        let second_player = kurt.clone();
        let second = std::thread::spawn(move || {
            second_barrier.wait();
            create_challenge(
                &second_server,
                &request("/api/people/challenge", json!({"username": "Garrett"})),
                Some(&second_player),
            )
            .unwrap()
        });
        barrier.wait();
        let first = first.join().unwrap();
        let second = second.join().unwrap();

        assert_eq!(first["challenge"]["id"], second["challenge"]["id"]);
        assert_eq!(
            first["challenge"]["tableId"],
            second["challenge"]["tableId"]
        );
        assert!(
            first["challenge"]["status"] == "accepted"
                || second["challenge"]["status"] == "accepted"
        );
        let connection = open_game_database(&server.data_dir).unwrap();
        let saved: (i64, String) = connection
            .query_row(
                "SELECT COUNT(*), MIN(status) FROM people_challenges
                 WHERE (challenger_id = ?1 AND challenged_id = ?2)
                    OR (challenger_id = ?2 AND challenged_id = ?1)",
                params![garrett.id, kurt.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(saved, (1, "accepted".to_string()));
        drop(connection);
        let data_dir = server.data_dir.clone();
        drop(server);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn directory_restores_the_viewers_active_human_table() {
        let server = test_server("active-human-table");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let now = unix_seconds();
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO people_challenges
                 (id, table_id, challenger_id, challenged_id, status, created_at, updated_at, expires_at)
                 VALUES ('c', 't', ?1, ?2, 'accepted', ?3, ?3, ?4)",
                params![garrett.id, kurt.id, now, now + TABLE_IDLE_SECONDS],
            )
            .unwrap();
        drop(connection);

        let garrett_directory = directory_value(&server, Some(&garrett)).unwrap();
        let kurt_directory = directory_value(&server, Some(&kurt)).unwrap();
        assert_eq!(garrett_directory["activeTable"]["id"], "t");
        assert_eq!(kurt_directory["activeTable"]["id"], "t");
        assert_eq!(garrett_directory["activeTable"]["phase"], "cut_for_deal");
        assert_eq!(kurt_directory["activeTable"]["phase"], "cut_for_deal");

        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn opening_an_active_table_renews_its_idle_expiration() {
        let server = test_server("renew-active-human-table");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let now = unix_seconds();
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO people_challenges
                 (id, table_id, challenger_id, challenged_id, status, created_at, updated_at, expires_at)
                 VALUES ('c', 't', ?1, ?2, 'accepted', ?3, ?3, ?4)",
                params![garrett.id, kurt.id, now, now + 60],
            )
            .unwrap();
        drop(connection);

        table_value(&server, "t", garrett.id).unwrap();

        let connection = open_game_database(&server.data_dir).unwrap();
        let expires_at: i64 = connection
            .query_row(
                "SELECT expires_at FROM people_challenges WHERE table_id = 't'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(expires_at >= now + TABLE_IDLE_SECONDS - 1);
        drop(connection);
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn each_hand_owner_advances_scoring_while_both_players_see_the_count() {
        let server = test_server("shared-human-scoring");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let now = unix_seconds();
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO people_challenges
                 (id, table_id, challenger_id, challenged_id, status, dealer_id, created_at, updated_at, expires_at)
                 VALUES ('c', 't', ?1, ?2, 'accepted', ?1, ?3, ?3, ?4)",
                params![garrett.id, kurt.id, now, now + TABLE_IDLE_SECONDS],
            )
            .unwrap();
        ensure_human_game(&connection, "t", garrett.id, garrett.id).unwrap();
        let (mut record, _) = load_human_game(&connection, "t").unwrap();
        record.game.phase = Phase::PeggingComplete;
        record.turn_card_revealed = true;
        connection
            .execute(
                "UPDATE people_games SET game_json = ?2 WHERE table_id = ?1",
                params!["t", serde_json::to_string(&record).unwrap()],
            )
            .unwrap();
        drop(connection);

        let pone_before = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&kurt),
        )
        .unwrap();
        let dealer_before = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&garrett),
        )
        .unwrap();
        assert_eq!(pone_before["canContinueScoring"], true);
        assert_eq!(dealer_before["canContinueScoring"], false);

        human_game_action(
            &server,
            &request(
                "/api/people/table/game/action",
                json!({
                    "tableId": "t",
                    "action": "continue-scoring",
                    "actionId": "shared-score-pone",
                    "revision": pone_before["revision"],
                    "payload": {},
                }),
            ),
            Some(&kurt),
        )
        .unwrap();
        let pone_after = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&kurt),
        )
        .unwrap();
        let dealer_after = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&garrett),
        )
        .unwrap();
        assert_eq!(pone_after["revision"], dealer_after["revision"]);
        assert_eq!(pone_after["state"]["scoring"]["stage"], "pone");
        assert_eq!(dealer_after["state"]["scoring"]["stage"], "pone");
        assert_eq!(
            pone_after["state"]["scoring"]["points"],
            dealer_after["state"]["scoring"]["points"]
        );
        let pone_event = pone_after["state"]["analyticsEvents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|event| event["type"] == "score")
            .unwrap();
        let dealer_event = dealer_after["state"]["analyticsEvents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|event| event["type"] == "score")
            .unwrap();
        assert_eq!(pone_event["player"], "human");
        assert_eq!(dealer_event["player"], "ai");
        for key in ["category", "points", "cards", "turnCard", "scoreComponents"] {
            assert_eq!(pone_event[key], dealer_event[key]);
        }
        assert_eq!(pone_after["canContinueScoring"], true);
        assert_eq!(dealer_after["canContinueScoring"], false);

        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn human_actions_are_acknowledged_once_and_watched_by_revision() {
        let server = test_server("acknowledged-human-action");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let now = unix_seconds();
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO people_challenges
                 (id, table_id, challenger_id, challenged_id, status, dealer_id, created_at, updated_at, expires_at)
                 VALUES ('c', 't', ?1, ?2, 'accepted', ?1, ?3, ?3, ?4)",
                params![garrett.id, kurt.id, now, now + TABLE_IDLE_SECONDS],
            )
            .unwrap();
        ensure_human_game(&connection, "t", garrett.id, garrett.id).unwrap();
        let (mut record, _) = load_human_game(&connection, "t").unwrap();
        record.game.phase = Phase::PeggingComplete;
        record.turn_card_revealed = true;
        connection
            .execute(
                "UPDATE people_games SET game_json = ?2 WHERE table_id = ?1",
                params!["t", serde_json::to_string(&record).unwrap()],
            )
            .unwrap();
        drop(connection);

        let first_request = request(
            "/api/people/table/game/action",
            json!({
                "tableId": "t",
                "action": "continue-scoring",
                "actionId": "count-pone",
                "revision": 0,
                "payload": {},
            }),
        );
        let missing_action_id = human_game_action(
            &server,
            &request(
                "/api/people/table/game/action",
                json!({
                    "tableId": "t",
                    "action": "continue-scoring",
                    "revision": 0,
                    "payload": {},
                }),
            ),
            Some(&kurt),
        )
        .unwrap_err();
        assert_eq!(missing_action_id.status, 400);

        let first = human_game_action(&server, &first_request, Some(&kurt)).unwrap();
        assert_eq!(first["revision"], 1);
        assert_eq!(first["acknowledgment"]["actionId"], "count-pone");
        assert_eq!(first["acknowledgment"]["appliedRevision"], 1);
        assert_eq!(first["acknowledgment"]["alreadyApplied"], false);

        let replayed = human_game_action(&server, &first_request, Some(&kurt)).unwrap();
        assert_eq!(replayed["revision"], 1);
        assert_eq!(replayed["state"]["phase"], "score_pone");
        assert_eq!(replayed["acknowledgment"]["appliedRevision"], 1);
        assert_eq!(replayed["acknowledgment"]["alreadyApplied"], true);

        let reused = human_game_action(
            &server,
            &request(
                "/api/people/table/game/action",
                json!({
                    "tableId": "t",
                    "action": "continue-scoring",
                    "actionId": "count-pone",
                    "revision": 1,
                    "payload": {"different": true},
                }),
            ),
            Some(&kurt),
        )
        .unwrap_err();
        assert_eq!(reused.status, 409);

        let watched = watch_human_game(
            &server,
            &request(
                "/api/people/table/game/watch",
                json!({"tableId": "t", "afterRevision": 0}),
            ),
            Some(&garrett),
        )
        .unwrap();
        assert_eq!(watched["revision"], 1);
        assert_eq!(watched["watchTimedOut"], false);

        let connection = open_game_database(&server.data_dir).unwrap();
        let action_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM people_game_actions WHERE table_id = 't'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(action_count, 1);
        drop(connection);
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn winning_human_count_stays_visible_until_its_owner_opens_the_result() {
        let server = test_server("shared-human-final-count");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let now = unix_seconds();
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO people_challenges
                 (id, table_id, challenger_id, challenged_id, status, dealer_id, created_at, updated_at, expires_at)
                 VALUES ('c', 't', ?1, ?2, 'accepted', ?1, ?3, ?3, ?4)",
                params![garrett.id, kurt.id, now, now + TABLE_IDLE_SECONDS],
            )
            .unwrap();
        ensure_human_game(&connection, "t", garrett.id, garrett.id).unwrap();
        let (mut record, _) = load_human_game(&connection, "t").unwrap();
        let pone = record.game.pone;
        record.game.player_mut(pone).score = 120;
        record.game.player_mut(pone).table = [0, 14, 28, 42]
            .into_iter()
            .map(|id| Card::new(id).unwrap())
            .collect();
        record.game.turn_card = Card::new(2).unwrap();
        record.game.phase = Phase::PeggingComplete;
        record.turn_card_revealed = true;
        connection
            .execute(
                "UPDATE people_games SET game_json = ?2 WHERE table_id = ?1",
                params!["t", serde_json::to_string(&record).unwrap()],
            )
            .unwrap();
        drop(connection);

        let counted = human_game_action(
            &server,
            &request(
                "/api/people/table/game/action",
                json!({
                    "tableId": "t",
                    "action": "continue-scoring",
                    "actionId": "winning-score",
                    "revision": 0,
                    "payload": {},
                }),
            ),
            Some(&kurt),
        )
        .unwrap();
        assert_eq!(counted["state"]["phase"], "score_pone");
        assert_eq!(counted["state"]["result"], json!([]));
        assert_eq!(counted["state"]["scoring"]["nextLabel"], "View game result");
        assert_eq!(counted["canContinueScoring"], true);
        assert_eq!(
            table_value(&server, "t", kurt.id).unwrap()["table"]["phase"],
            "playing"
        );

        let completed = human_game_action(
            &server,
            &request(
                "/api/people/table/game/action",
                json!({
                    "tableId": "t",
                    "action": "continue-scoring",
                    "actionId": "view-winning-result",
                    "revision": counted["revision"],
                    "payload": {},
                }),
            ),
            Some(&kurt),
        )
        .unwrap();
        assert_eq!(completed["state"]["phase"], "game_over");
        assert_eq!(completed["state"]["result"], json!(["User wins."]));
        assert_eq!(
            table_value(&server, "t", kurt.id).unwrap()["table"]["phase"],
            "complete"
        );

        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn both_players_cut_and_the_lower_rank_deals() {
        let server = test_server("cut");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let now = unix_seconds();
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO people_challenges
                 (id, table_id, challenger_id, challenged_id, status, created_at, updated_at, expires_at)
                 VALUES ('c', 't', ?1, ?2, 'accepted', ?3, ?3, ?4)",
                params![garrett.id, kurt.id, now, now + CHALLENGE_SECONDS],
            )
            .unwrap();
        drop(connection);
        let first = cut_for_deal(
            &server,
            &request("/api/people/table/cut", json!({"tableId": "t"})),
            Some(&garrett),
        )
        .unwrap();
        assert_eq!(first["table"]["phase"], "cut_for_deal");
        let second = cut_for_deal(
            &server,
            &request("/api/people/table/cut", json!({"tableId": "t"})),
            Some(&kurt),
        )
        .unwrap();
        assert_eq!(second["table"]["phase"], "playing");
        assert!(second["table"]["dealerUsername"].is_string());

        let challenger_game = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&garrett),
        )
        .unwrap();
        let challenged_game = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&kurt),
        )
        .unwrap();
        assert_eq!(challenger_game["state"]["phase"], "discard");
        assert_eq!(challenged_game["state"]["phase"], "discard");
        assert_eq!(
            challenger_game["state"]["humanHand"]
                .as_array()
                .unwrap()
                .len(),
            6
        );
        assert_eq!(
            challenged_game["state"]["humanHand"]
                .as_array()
                .unwrap()
                .len(),
            6
        );
        assert_eq!(challenger_game["state"]["aiHandCount"], 6);
        assert_eq!(challenged_game["state"]["aiHandCount"], 6);
        assert_ne!(
            challenger_game["state"]["humanHand"],
            challenged_game["state"]["humanHand"]
        );
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn human_table_actions_wait_for_the_other_player_without_exposing_their_hand() {
        let server = test_server("human-actions");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let now = unix_seconds();
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO people_challenges
                 (id, table_id, challenger_id, challenged_id, status, created_at, updated_at, expires_at)
                 VALUES ('c', 't', ?1, ?2, 'accepted', ?3, ?3, ?4)",
                params![garrett.id, kurt.id, now, now + CHALLENGE_SECONDS],
            )
            .unwrap();
        drop(connection);
        cut_for_deal(
            &server,
            &request("/api/people/table/cut", json!({"tableId": "t"})),
            Some(&garrett),
        )
        .unwrap();
        cut_for_deal(
            &server,
            &request("/api/people/table/cut", json!({"tableId": "t"})),
            Some(&kurt),
        )
        .unwrap();

        let initial = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&garrett),
        )
        .unwrap();
        let simultaneous_opponent = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&kurt),
        )
        .unwrap();
        let ids = initial["state"]["humanHand"]
            .as_array()
            .unwrap()
            .iter()
            .take(2)
            .map(|card| card["id"].as_u64().unwrap())
            .collect::<Vec<_>>();
        let after_discard = human_game_action(
            &server,
            &request(
                "/api/people/table/game/action",
                json!({
                    "tableId": "t",
                    "action": "discard",
                    "actionId": "garrett-discard",
                    "revision": initial["revision"],
                    "payload": {"ids": ids},
                }),
            ),
            Some(&garrett),
        )
        .unwrap();
        assert_eq!(after_discard["state"]["phase"], "ai_discarding");
        assert_eq!(
            after_discard["state"]["humanHand"]
                .as_array()
                .unwrap()
                .len(),
            4
        );
        assert_eq!(
            after_discard["state"]["analyticsEvents"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let connection = open_game_database(&server.data_dir).unwrap();
        let (saved_after_discard, _) = load_human_game(&connection, "t").unwrap();
        assert_eq!(saved_after_discard.decision_reviews.len(), 1);
        assert_eq!(saved_after_discard.decision_reviews[0].player, Side::Left);
        assert_eq!(
            saved_after_discard.decision_reviews[0].kind,
            HumanReviewKind::Discard
        );
        drop(connection);

        let opponent_view = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&kurt),
        )
        .unwrap();
        assert_eq!(opponent_view["state"]["phase"], "discard");
        assert_eq!(
            opponent_view["state"]["humanHand"]
                .as_array()
                .unwrap()
                .len(),
            6
        );
        assert_eq!(opponent_view["state"]["aiHandCount"], 4);
        assert!(opponent_view["snapshot"]["ai"]["hand"]
            .as_array()
            .unwrap()
            .is_empty());

        let opponent_ids = simultaneous_opponent["state"]["humanHand"]
            .as_array()
            .unwrap()
            .iter()
            .take(2)
            .map(|card| card["id"].as_u64().unwrap())
            .collect::<Vec<_>>();
        let pegging = human_game_action(
            &server,
            &request(
                "/api/people/table/game/action",
                json!({
                    "tableId": "t",
                    "action": "discard",
                    "actionId": "kurt-discard",
                    "revision": simultaneous_opponent["revision"],
                    "payload": {"ids": opponent_ids},
                }),
            ),
            Some(&kurt),
        )
        .unwrap();
        assert_eq!(pegging["state"]["phase"], "pegging");
        assert_eq!(pegging["state"]["turnCardRevealed"], true);
        assert!(pegging["state"]["turnCard"].is_object());
        let connection = open_game_database(&server.data_dir).unwrap();
        let (saved_after_discards, _) = load_human_game(&connection, "t").unwrap();
        assert_eq!(saved_after_discards.decision_reviews.len(), 2);
        assert_eq!(saved_after_discards.decision_reviews[1].player, Side::Right);
        drop(connection);

        let garrett_pegging = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&garrett),
        )
        .unwrap();
        let (actor, acting_view) = if garrett_pegging["state"]["turn"] == "User" {
            (&garrett, garrett_pegging)
        } else {
            (&kurt, pegging)
        };
        let card_id = acting_view["state"]["legalCardIds"][0].as_u64().unwrap();
        let played = human_game_action(
            &server,
            &request(
                "/api/people/table/game/action",
                json!({
                    "tableId": "t",
                    "action": "play",
                    "actionId": "first-peg-play",
                    "revision": acting_view["revision"],
                    "payload": {"id": card_id},
                }),
            ),
            Some(actor),
        )
        .unwrap();
        assert_eq!(played["state"]["plays"].as_array().unwrap().len(), 1);
        assert_eq!(
            played["revision"],
            acting_view["revision"].as_i64().unwrap() + 1
        );
        let connection = open_game_database(&server.data_dir).unwrap();
        let (saved_after_play, _) = load_human_game(&connection, "t").unwrap();
        assert_eq!(saved_after_play.decision_reviews.len(), 3);
        assert_eq!(
            saved_after_play.decision_reviews[2].kind,
            HumanReviewKind::Peg
        );
        drop(connection);

        let stale = human_game_action(
            &server,
            &request(
                "/api/people/table/game/action",
                json!({
                    "tableId": "t",
                    "action": "play",
                    "actionId": "stale-peg-play",
                    "revision": acting_view["revision"],
                    "payload": {"id": card_id},
                }),
            ),
            Some(actor),
        )
        .unwrap_err();
        assert_eq!(stale.status, 409);
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn human_table_review_persists_ace_evaluation_without_revealing_it_live() {
        let mut server = test_server("human-review");
        server.model_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .to_string_lossy()
            .into_owned();
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let now = unix_seconds();
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO people_challenges
                 (id, table_id, challenger_id, challenged_id, status, dealer_id, created_at, updated_at, expires_at)
                 VALUES ('c', 't', ?1, ?2, 'accepted', ?1, ?3, ?3, ?4)",
                params![garrett.id, kurt.id, now, now + CHALLENGE_SECONDS],
            )
            .unwrap();
        ensure_human_game(&connection, "t", garrett.id, garrett.id).unwrap();
        drop(connection);

        let initial = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&garrett),
        )
        .unwrap();
        let ids = initial["state"]["humanHand"]
            .as_array()
            .unwrap()
            .iter()
            .take(2)
            .map(|card| card["id"].as_u64().unwrap())
            .collect::<Vec<_>>();
        let acted = human_game_action(
            &server,
            &request(
                "/api/people/table/game/action",
                json!({
                    "tableId": "t",
                    "action": "discard",
                    "actionId": "reviewed-discard",
                    "revision": initial["revision"],
                    "payload": {"ids": ids},
                }),
            ),
            Some(&garrett),
        )
        .unwrap();

        let reviewed = human_game_review(
            &server,
            &request("/api/people/table/game/review", json!({"tableId": "t"})),
            Some(&garrett),
        )
        .unwrap();
        assert_eq!(
            reviewed["revision"].as_i64().unwrap(),
            acted["revision"].as_i64().unwrap() + 1
        );
        assert_eq!(
            reviewed["state"]["analyticsEvents"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let opponent_view = human_game_status(
            &server,
            &request("/api/people/table/game", json!({"tableId": "t"})),
            Some(&kurt),
        )
        .unwrap();
        assert_eq!(opponent_view["revision"], reviewed["revision"]);
        let connection = open_game_database(&server.data_dir).unwrap();
        let (saved, _) = load_human_game(&connection, "t").unwrap();
        let evaluation = saved.decision_reviews[0].completed.as_ref().unwrap();
        assert_eq!(evaluation.evaluator_model, DYNAMIC_EVALUATOR_VERSION);
        assert_eq!(evaluation.selected_card_ids.len(), 2);
        assert_eq!(evaluation.recommended_card_ids.len(), 2);
        drop(connection);
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn human_table_can_play_through_to_a_recorded_winner() {
        let server = test_server("human-full-game");
        let garrett = user(&server, "Garrett");
        let kurt = user(&server, "Kurt");
        let now = unix_seconds();
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO people_challenges
                 (id, table_id, challenger_id, challenged_id, status, created_at, updated_at, expires_at)
                 VALUES ('c', 't', ?1, ?2, 'accepted', ?3, ?3, ?4)",
                params![garrett.id, kurt.id, now, now + CHALLENGE_SECONDS],
            )
            .unwrap();
        drop(connection);
        for account in [&garrett, &kurt] {
            cut_for_deal(
                &server,
                &request("/api/people/table/cut", json!({"tableId": "t"})),
                Some(account),
            )
            .unwrap();
        }

        for step in 0..2_000 {
            let connection = open_game_database(&server.data_dir).unwrap();
            let (record, _) = load_human_game(&connection, "t").unwrap();
            drop(connection);
            if record.game.phase == Phase::GameOver && record.pending_final_scoring.is_none() {
                let connection = open_game_database(&server.data_dir).unwrap();
                let recorded: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM people_head_to_head_games WHERE game_id = ?1",
                        [record.game_id.as_str()],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(recorded, 1);
                assert_eq!(
                    table_value(&server, "t", garrett.id).unwrap()["table"]["phase"],
                    "complete"
                );
                let row = table_row(&connection, "t").unwrap();
                let mut reviewed = record.clone();
                for side in [Side::Left, Side::Right] {
                    let saved = reviewed
                        .decision_reviews
                        .iter_mut()
                        .find(|review| review.player == side)
                        .unwrap();
                    saved.completed = Some(HumanCompletedDecisionReview {
                        evaluator_model: DYNAMIC_EVALUATOR_VERSION.to_string(),
                        selected_card_ids: saved.selected_card_ids.clone(),
                        recommended_card_ids: saved.selected_card_ids.clone(),
                        selected_ev: 1.0,
                        recommended_ev: 1.0,
                        selected_win_probability: Some(0.5),
                        recommended_win_probability: Some(0.5),
                    });
                }
                for viewer in [Side::Left, Side::Right] {
                    let analytics = human_game_analytics(&reviewed, &row, viewer);
                    let reviewed_players = analytics
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|event| event["review"].is_object())
                        .map(|event| event["player"].as_str().unwrap())
                        .collect::<std::collections::HashSet<_>>();
                    assert_eq!(
                        reviewed_players,
                        std::collections::HashSet::from(["human", "ai"])
                    );
                }
                std::fs::remove_dir_all(server.data_dir).unwrap();
                return;
            }

            let (side, action, payload) = if record.pending_final_scoring.is_some() {
                (
                    human_scoring_controller(&record).unwrap(),
                    "continue-scoring",
                    json!({}),
                )
            } else {
                match record.game.phase {
                    Phase::Discard => {
                        let side = if record.game.player(Side::Left).hand.len() == 6 {
                            Side::Left
                        } else {
                            Side::Right
                        };
                        let ids = record.game.player(side).hand[..2]
                            .iter()
                            .map(|card| card.id)
                            .collect::<Vec<_>>();
                        (side, "discard", json!({"ids": ids}))
                    }
                    Phase::Pegging if record.game.pegging_reset_pending => (
                        record.game.current_player(),
                        "acknowledge-pegging-reset",
                        json!({}),
                    ),
                    Phase::Pegging => {
                        let side = record.game.current_player();
                        let legal = record.game.legal_cards(side);
                        if let Some(card) = legal.first() {
                            (side, "play", json!({"id": card.id}))
                        } else {
                            (side, "go", json!({}))
                        }
                    }
                    Phase::PeggingComplete
                    | Phase::ScorePone
                    | Phase::ScoreDealer
                    | Phase::ScoreCrib => (
                        human_scoring_controller(&record).unwrap(),
                        "continue-scoring",
                        json!({}),
                    ),
                    Phase::GameOver => unreachable!(),
                }
            };
            let account = if side == Side::Left { &garrett } else { &kurt };
            let view = human_game_status(
                &server,
                &request("/api/people/table/game", json!({"tableId": "t"})),
                Some(account),
            )
            .unwrap();
            human_game_action(
                &server,
                &request(
                    "/api/people/table/game/action",
                    json!({
                        "tableId": "t",
                        "action": action,
                        "actionId": format!("smoke-{step}"),
                        "revision": view["revision"],
                        "payload": payload,
                    }),
                ),
                Some(account),
            )
            .unwrap();
        }
        panic!("human game smoke test exceeded its action guard");
    }
}
