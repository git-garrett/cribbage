use std::path::Path;

use rusqlite::params;
use serde::Deserialize;
use serde_json::Value;

use super::{auth, isoish_now, open_game_database, Request, Response, Server};

const MAX_BATCH_EVENTS: usize = 50;
const MAX_ACTIVITY_BODY_BYTES: usize = 128 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityBatch {
    schema_version: u8,
    environment: String,
    app_version: String,
    client_session_id: String,
    client: ActivityClient,
    events: Vec<ActivityEvent>,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityClient {
    client_type: String,
    browser: String,
    device_type: String,
    viewport_width: i64,
    viewport_height: i64,
    screen_width: i64,
    screen_height: i64,
    device_pixel_ratio: f64,
    language: String,
    timezone: String,
    platform: String,
    touch_points: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityEvent {
    id: String,
    name: String,
    occurred_at: String,
    page: String,
    game_id: Option<String>,
    metadata: Value,
}

pub fn initialize(data_dir: &Path) -> Result<(), String> {
    let connection = open_game_database(data_dir)?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS user_activity_events (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               event_id TEXT NOT NULL,
               client_session_id TEXT NOT NULL,
               user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
               environment TEXT NOT NULL,
               app_version TEXT NOT NULL,
               event_name TEXT NOT NULL,
               occurred_at TEXT NOT NULL,
               received_at TEXT NOT NULL,
               page TEXT NOT NULL,
               game_id TEXT,
               client_type TEXT NOT NULL,
               browser TEXT NOT NULL,
               device_type TEXT NOT NULL,
               viewport_width INTEGER NOT NULL,
               viewport_height INTEGER NOT NULL,
               screen_width INTEGER NOT NULL,
               screen_height INTEGER NOT NULL,
               device_pixel_ratio REAL NOT NULL,
               language TEXT NOT NULL,
               timezone TEXT NOT NULL,
               platform TEXT NOT NULL,
               touch_points INTEGER NOT NULL,
               metadata_json TEXT NOT NULL,
               UNIQUE(client_session_id, event_id)
             );
             CREATE INDEX IF NOT EXISTS user_activity_events_by_time
               ON user_activity_events(received_at DESC);
             CREATE INDEX IF NOT EXISTS user_activity_events_by_user
               ON user_activity_events(user_id, received_at DESC);
             CREATE INDEX IF NOT EXISTS user_activity_events_by_game
               ON user_activity_events(game_id, received_at DESC);
             CREATE INDEX IF NOT EXISTS user_activity_events_by_kind
               ON user_activity_events(environment, event_name, received_at DESC);
             CREATE INDEX IF NOT EXISTS user_activity_events_by_client_session
               ON user_activity_events(client_session_id, received_at);",
        )
        .map_err(|error| format!("create user activity tables: {error}"))
}

pub fn handle(
    server: &Server,
    request: &Request,
    authenticated_user: Option<&auth::AuthUser>,
) -> Option<Response> {
    if request.path != "/api/activity" {
        return None;
    }
    if request.method == "OPTIONS" {
        return Some(Response::empty(204));
    }
    if request.method != "POST" {
        return Some(Response::json(
            405,
            "{\"error\":\"Method not allowed\"}".to_string(),
        ));
    }
    if request.body.len() > MAX_ACTIVITY_BODY_BYTES {
        return Some(bad_request("Activity batch is too large."));
    }
    let batch = match serde_json::from_str::<ActivityBatch>(&request.body) {
        Ok(batch) => batch,
        Err(_) => return Some(bad_request("Invalid activity batch.")),
    };
    if let Err(message) = validate_batch(&batch) {
        return Some(bad_request(message));
    }
    match store_batch(
        &server.data_dir,
        authenticated_user.map(|user| user.id),
        &batch,
    ) {
        Ok(accepted) => Some(Response::json(
            200,
            format!("{{\"ok\":true,\"accepted\":{accepted}}}"),
        )),
        Err(error) => {
            eprintln!("Activity collection error: {error}");
            Some(Response::json(
                500,
                "{\"error\":\"Activity could not be stored.\"}".to_string(),
            ))
        }
    }
}

fn bad_request(message: &str) -> Response {
    Response::json(400, serde_json::json!({ "error": message }).to_string())
}

fn validate_batch(batch: &ActivityBatch) -> Result<(), &'static str> {
    if batch.schema_version != 1 {
        return Err("Unsupported activity schema version.");
    }
    if !matches!(batch.environment.as_str(), "local" | "lan" | "prod" | "ios") {
        return Err("Invalid activity environment.");
    }
    if !valid_identifier(&batch.client_session_id, 128) || batch.app_version.len() > 32 {
        return Err("Invalid activity session.");
    }
    if batch.events.is_empty() || batch.events.len() > MAX_BATCH_EVENTS {
        return Err("Invalid activity event count.");
    }
    validate_client(&batch.client)?;
    for event in &batch.events {
        if !valid_identifier(&event.id, 128)
            || event.name.is_empty()
            || event.name.len() > 64
            || !event
                .name
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
            || event.occurred_at.is_empty()
            || event.occurred_at.len() > 40
            || !event.page.starts_with('/')
            || event.page.len() > 200
            || event
                .game_id
                .as_ref()
                .is_some_and(|value| !valid_identifier(value, 128))
            || !event.metadata.is_object()
            || serde_json::to_string(&event.metadata)
                .map(|value| value.len() > 4_096)
                .unwrap_or(true)
        {
            return Err("Invalid activity event.");
        }
    }
    Ok(())
}

fn validate_client(client: &ActivityClient) -> Result<(), &'static str> {
    let dimensions = [
        client.viewport_width,
        client.viewport_height,
        client.screen_width,
        client.screen_height,
    ];
    if !matches!(client.client_type.as_str(), "web" | "ios_app")
        || !matches!(client.device_type.as_str(), "phone" | "tablet" | "desktop")
        || client.browser.is_empty()
        || client.browser.len() > 32
        || dimensions.iter().any(|value| !(0..=10_000).contains(value))
        || !client.device_pixel_ratio.is_finite()
        || !(0.1..=10.0).contains(&client.device_pixel_ratio)
        || client.language.len() > 32
        || client.timezone.len() > 64
        || client.platform.len() > 64
        || !(0..=20).contains(&client.touch_points)
    {
        return Err("Invalid activity client.");
    }
    Ok(())
}

fn valid_identifier(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn store_batch(
    data_dir: &Path,
    user_id: Option<i64>,
    batch: &ActivityBatch,
) -> Result<usize, String> {
    let mut connection = open_game_database(data_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("begin activity transaction: {error}"))?;
    let received_at = isoish_now();
    let mut accepted = 0;
    for event in &batch.events {
        let metadata_json = serde_json::to_string(&event.metadata)
            .map_err(|error| format!("serialize activity metadata: {error}"))?;
        accepted += transaction
            .execute(
                "INSERT OR IGNORE INTO user_activity_events
                 (event_id, client_session_id, user_id, environment, app_version,
                  event_name, occurred_at, received_at, page, game_id,
                  client_type, browser, device_type, viewport_width, viewport_height,
                  screen_width, screen_height, device_pixel_ratio, language, timezone,
                  platform, touch_points, metadata_json)
                 VALUES
                 (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                  ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
                params![
                    event.id,
                    batch.client_session_id,
                    user_id,
                    batch.environment,
                    batch.app_version,
                    event.name,
                    event.occurred_at,
                    received_at,
                    event.page,
                    event.game_id,
                    batch.client.client_type,
                    batch.client.browser,
                    batch.client.device_type,
                    batch.client.viewport_width,
                    batch.client.viewport_height,
                    batch.client.screen_width,
                    batch.client.screen_height,
                    batch.client.device_pixel_ratio,
                    batch.client.language,
                    batch.client.timezone,
                    batch.client.platform,
                    batch.client.touch_points,
                    metadata_json,
                ],
            )
            .map_err(|error| format!("store activity event: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("commit activity transaction: {error}"))?;
    Ok(accepted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_batch() -> ActivityBatch {
        ActivityBatch {
            schema_version: 1,
            environment: "prod".to_string(),
            app_version: "16.3.0".to_string(),
            client_session_id: "session-test".to_string(),
            client: ActivityClient {
                client_type: "web".to_string(),
                browser: "mobile_safari".to_string(),
                device_type: "phone".to_string(),
                viewport_width: 390,
                viewport_height: 844,
                screen_width: 390,
                screen_height: 844,
                device_pixel_ratio: 3.0,
                language: "en-US".to_string(),
                timezone: "America/Los_Angeles".to_string(),
                platform: "iPhone".to_string(),
                touch_points: 5,
            },
            events: vec![ActivityEvent {
                id: "event-test".to_string(),
                name: "page_view".to_string(),
                occurred_at: "2026-09-04T12:00:00.000Z".to_string(),
                page: "/?pathwayView=play".to_string(),
                game_id: None,
                metadata: serde_json::json!({"surface":"play"}),
            }],
        }
    }

    #[test]
    fn stores_activity_with_environment_client_and_optional_user() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-activity-test-{}-{}",
            std::process::id(),
            super::super::unix_millis()
        ));
        super::super::auth::initialize(&data_dir).unwrap();
        initialize(&data_dir).unwrap();
        let batch = test_batch();
        assert_eq!(store_batch(&data_dir, Some(1), &batch).unwrap(), 1);
        assert_eq!(store_batch(&data_dir, Some(1), &batch).unwrap(), 0);

        let connection = open_game_database(&data_dir).unwrap();
        let row = connection
            .query_row(
                "SELECT user_id, environment, browser, device_type, viewport_width, event_name
                 FROM user_activity_events",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            row,
            (
                1,
                "prod".to_string(),
                "mobile_safari".to_string(),
                "phone".to_string(),
                390,
                "page_view".to_string(),
            )
        );
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn rejects_unknown_environments_and_oversized_batches() {
        let mut batch = test_batch();
        batch.environment = "staging".to_string();
        assert_eq!(validate_batch(&batch), Err("Invalid activity environment."));
        batch.environment = "prod".to_string();
        batch.events.clear();
        assert_eq!(validate_batch(&batch), Err("Invalid activity event count."));
    }
}
