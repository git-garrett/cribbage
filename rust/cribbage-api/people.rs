use std::collections::HashMap;
use std::path::Path;

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use cribbage_shadow_engine::dynamic::MIN_COMPLETE_CYCLES;
use rand_core::{OsRng, RngCore};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{auth::AuthUser, open_game_database, Request, Response, Server};

const ONLINE_SECONDS: i64 = 15 * 60;
const CHALLENGE_SECONDS: i64 = 10 * 60;
const TABLE_SECONDS: i64 = 12 * 60 * 60;
const MAX_AVATAR_BYTES: usize = 420_000;

fn dynamic_handicap_value(evaluator_version: &str, profile: &Value) -> Option<Value> {
    let cycles = profile["complete_cycles"].as_u64().unwrap_or_default();
    let wp_per_decision = profile["ewma_handicap"].as_f64()?;
    if cycles == 0 || !wp_per_decision.is_finite() {
        return None;
    }
    Some(json!({
        "wpPerDecision": wp_per_decision,
        "cycles": cycles,
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
struct TableSelection {
    table_id: String,
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
        ("POST", "/api/people/challenge") => create_challenge(server, request, user),
        ("POST", "/api/people/challenge/accept") => accept_challenge(server, request, user),
        ("POST", "/api/people/table") => table_status(server, request, user),
        ("POST", "/api/people/table/cut") => cut_for_deal(server, request, user),
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
    Ok(json!({
        "onlineCount": online_count,
        "players": players,
        "incomingChallenges": incoming,
        "outgoingChallenges": outgoing,
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
    let connection = open_game_database(&server.data_dir)
        .map_err(|error| PeopleError::internal("open challenge database", error))?;
    let target = connection
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
    if let Some(existing) = connection
        .query_row(
            "SELECT id, table_id FROM people_challenges
             WHERE challenger_id = ?1 AND challenged_id = ?2
               AND status = 'pending' AND expires_at > ?3
             ORDER BY created_at DESC LIMIT 1",
            params![user.id, target.0, now],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| PeopleError::internal("find active challenge", error))?
    {
        return Ok(json!({
            "challenge": challenge_value(
                &existing.0,
                &existing.1,
                "pending",
                &target.1,
                &target.2,
                target.3,
                dynamic_handicap_for_user(&connection, target.0)?,
            ),
        }));
    }
    let id = random_id("challenge");
    let table_id = random_id("table");
    connection
        .execute(
            "INSERT INTO people_challenges
             (id, table_id, challenger_id, challenged_id, status, created_at, updated_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?5, ?6)",
            params![id, table_id, user.id, target.0, now, now + CHALLENGE_SECONDS],
        )
        .map_err(|error| PeopleError::internal("create player challenge", error))?;
    Ok(json!({
        "challenge": challenge_value(
            &id,
            &table_id,
            "pending",
            &target.1,
            &target.2,
            target.3,
            dynamic_handicap_for_user(&connection, target.0)?,
        ),
    }))
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
            params![input.challenge_id, user.id, now, now + TABLE_SECONDS],
        )
        .map_err(|error| PeopleError::internal("accept player challenge", error))?;
    if updated == 0 {
        return Err(PeopleError::conflict(
            "That challenge is no longer available.",
        ));
    }
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
        .transaction()
        .map_err(|error| PeopleError::internal("begin deal cut", error))?;
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
    transaction
        .commit()
        .map_err(|error| PeopleError::internal("commit deal cut", error))?;
    table_value(server, &input.table_id, user.id)
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
    let row = table_row(&connection, table_id)?;
    if viewer_id != row.challenger_id && viewer_id != row.challenged_id {
        return Err(PeopleError::not_found("That player table was not found."));
    }
    let phase = if row.status == "pending" {
        "waiting"
    } else if row.dealer_id.is_some() {
        "deal_ready"
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
    use std::sync::Mutex;

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
                    json!({"started_dynamic": true, "complete_cycles": 8, "ewma_handicap": -0.0125}).to_string(),
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
        assert_eq!(
            value["profile"]["dynamicHandicap"]["wpPerDecision"],
            -0.0125
        );
        assert_eq!(
            value["profile"]["dynamicHandicap"]["evaluatorVersion"],
            "ace-13.0"
        );
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
                    json!({"started_dynamic": true, "complete_cycles": 8, "ewma_handicap": -0.0125}).to_string(),
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
        assert_eq!(
            value["players"][0]["dynamicHandicap"]["wpPerDecision"],
            -0.0125
        );
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
        assert_eq!(second["table"]["phase"], "deal_ready");
        assert!(second["table"]["dealerUsername"].is_string());
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }
}
