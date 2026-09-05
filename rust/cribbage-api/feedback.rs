use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use rusqlite::params;
use serde::Deserialize;
use serde_json::json;

use super::{auth::AuthUser, email, open_game_database, Request, Response, Server};

const MAX_DESCRIPTION_CHARS: usize = 2_000;
const MAX_SCREENSHOT_BYTES: usize = 5 * 1024 * 1024;
const RATE_WINDOW_SECONDS: i64 = 60 * 60;
const RATE_MAX_PER_KIND: i64 = 5;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BugReportInput {
    description: String,
    #[serde(default)]
    screenshot_data_url: Option<String>,
    #[serde(default)]
    page: String,
}

#[derive(Deserialize)]
struct FeatureRequestInput {
    description: String,
    #[serde(default)]
    page: String,
}

pub fn initialize(data_dir: &Path) -> Result<(), String> {
    let connection = open_game_database(data_dir)?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS feedback_rate_events (
               kind TEXT NOT NULL,
               user_id INTEGER NOT NULL,
               occurred_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS feedback_rate_events_lookup
               ON feedback_rate_events(kind, user_id, occurred_at DESC);",
        )
        .map_err(|error| format!("create feedback rate-limit table: {}", error))
}

pub fn handle(server: &Server, request: &Request, user: Option<&AuthUser>) -> Option<Response> {
    let response = match (request.method.as_str(), request.path.as_str()) {
        ("POST", "/api/feedback/bug-report") => {
            let Some(user) = user else {
                return Some(unauthorized());
            };
            submit_bug_report(server, request, user)
        }
        ("POST", "/api/feedback/feature-request") => {
            let Some(user) = user else {
                return Some(unauthorized());
            };
            submit_feature_request(server, request, user)
        }
        _ => return None,
    };
    Some(response)
}

fn submit_bug_report(server: &Server, request: &Request, user: &AuthUser) -> Response {
    let Ok(input) = serde_json::from_str::<BugReportInput>(&request.body) else {
        return bad_request("Describe what went wrong.");
    };
    let description = match validate_description(&input.description) {
        Ok(description) => description,
        Err(message) => return bad_request(message),
    };
    let screenshot = match input.screenshot_data_url.as_deref() {
        Some(value) if !value.is_empty() => match screenshot_attachment(value) {
            Ok(attachment) => Some(attachment),
            Err(message) => return bad_request(message),
        },
        _ => None,
    };
    if let Some(response) = enforce_rate_limit(server, "bug-report", user.id) {
        return response;
    }
    let message = email::bug_report(
        &user.display_name,
        &user.username,
        &user.email,
        &description,
        &clean_page(&input.page),
        screenshot,
    );
    if let Err(error) = deliver_feedback(&message, user) {
        eprintln!(
            "Feedback delivery failed for user {} (bug-report): {}",
            user.id, error
        );
        return internal_error();
    }
    created("Bug report sent. Thank you for helping improve Strong Cribbage.")
}

fn submit_feature_request(server: &Server, request: &Request, user: &AuthUser) -> Response {
    let Ok(input) = serde_json::from_str::<FeatureRequestInput>(&request.body) else {
        return bad_request("Describe the feature you would like to see.");
    };
    let description = match validate_description(&input.description) {
        Ok(description) => description,
        Err(message) => return bad_request(message),
    };
    if let Some(response) = enforce_rate_limit(server, "feature-request", user.id) {
        return response;
    }
    let message = email::feature_request(
        &user.display_name,
        &user.username,
        &user.email,
        &description,
        &clean_page(&input.page),
    );
    if let Err(error) = deliver_feedback(&message, user) {
        eprintln!(
            "Feedback delivery failed for user {} (feature-request): {}",
            user.id, error
        );
        return internal_error();
    }
    created("Feature request sent. Thank you—I’ll read every one.")
}

#[cfg(not(test))]
fn deliver_feedback(message: &email::EmailMessage, user: &AuthUser) -> Result<(), String> {
    email::send_feedback(message, &user.email, &user.display_name)
}

#[cfg(test)]
fn deliver_feedback(_message: &email::EmailMessage, _user: &AuthUser) -> Result<(), String> {
    Ok(())
}

fn validate_description(value: &str) -> Result<String, &'static str> {
    let value = value.trim();
    let length = value.chars().count();
    if length < 10 {
        return Err("Please add at least 10 characters so the request is actionable.");
    }
    if length > MAX_DESCRIPTION_CHARS {
        return Err("Keep the description under 2,000 characters.");
    }
    Ok(value.to_string())
}

fn clean_page(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        return "Not provided".to_string();
    }
    value.chars().take(300).collect()
}

fn screenshot_attachment(value: &str) -> Result<email::EmailAttachment, &'static str> {
    let (prefix, encoded) = value
        .split_once(',')
        .ok_or("Upload a PNG, JPEG, or WebP screenshot.")?;
    let (mime_type, extension) = match prefix {
        "data:image/png;base64" => ("image/png", "png"),
        "data:image/jpeg;base64" => ("image/jpeg", "jpg"),
        "data:image/webp;base64" => ("image/webp", "webp"),
        _ => return Err("Upload a PNG, JPEG, or WebP screenshot."),
    };
    if encoded.len() > 7_000_000 {
        return Err("Keep the screenshot under 5 MB.");
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "The screenshot could not be read.")?;
    if bytes.len() > MAX_SCREENSHOT_BYTES {
        return Err("Keep the screenshot under 5 MB.");
    }
    let valid_signature = match mime_type {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if !valid_signature {
        return Err("The screenshot contents do not match its file type.");
    }
    Ok(email::EmailAttachment {
        filename: format!("strong-cribbage-bug-report.{}", extension),
        mime_type: mime_type.to_string(),
        content: STANDARD.encode(bytes),
    })
}

fn enforce_rate_limit(server: &Server, kind: &str, user_id: i64) -> Option<Response> {
    match rate_limited(&server.data_dir, kind, user_id) {
        Ok(true) => Some(Response::json(
            429,
            json!({"error": "You’ve sent several requests recently. Please wait and try again."})
                .to_string(),
        )),
        Ok(false) => None,
        Err(error) => {
            eprintln!("Feedback rate-limit check failed: {}", error);
            Some(internal_error())
        }
    }
}

fn rate_limited(data_dir: &Path, kind: &str, user_id: i64) -> Result<bool, String> {
    let mut connection = open_game_database(data_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("begin feedback rate-limit transaction: {}", error))?;
    let now = unix_seconds();
    transaction
        .execute(
            "DELETE FROM feedback_rate_events WHERE occurred_at < ?1",
            [now - RATE_WINDOW_SECONDS],
        )
        .map_err(|error| format!("expire feedback rate-limit events: {}", error))?;
    let count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM feedback_rate_events
             WHERE kind = ?1 AND user_id = ?2 AND occurred_at >= ?3",
            params![kind, user_id, now - RATE_WINDOW_SECONDS],
            |row| row.get(0),
        )
        .map_err(|error| format!("count feedback rate-limit events: {}", error))?;
    if count >= RATE_MAX_PER_KIND {
        transaction
            .commit()
            .map_err(|error| format!("commit feedback rate-limit check: {}", error))?;
        return Ok(true);
    }
    transaction
        .execute(
            "INSERT INTO feedback_rate_events (kind, user_id, occurred_at) VALUES (?1, ?2, ?3)",
            params![kind, user_id, now],
        )
        .map_err(|error| format!("record feedback rate-limit event: {}", error))?;
    transaction
        .commit()
        .map_err(|error| format!("commit feedback rate-limit event: {}", error))?;
    Ok(false)
}

fn unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn unauthorized() -> Response {
    Response::json(
        401,
        json!({"error": "Sign in to send feedback."}).to_string(),
    )
}

fn bad_request(message: &str) -> Response {
    Response::json(400, json!({"error": message}).to_string())
}

fn created(message: &str) -> Response {
    Response::json(201, json!({"ok": true, "message": message}).to_string())
}

fn internal_error() -> Response {
    Response::json(
        500,
        json!({"error": "Your request could not be sent. Please try again."}).to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn test_server(name: &str) -> Server {
        let data_dir = std::env::temp_dir().join(format!(
            "strong-cribbage-feedback-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&data_dir);
        std::fs::create_dir_all(&data_dir).unwrap();
        initialize(&data_dir).unwrap();
        Server {
            state: Mutex::new(super::super::AppState {
                sessions: HashMap::new(),
                uploads: HashMap::new(),
                leaderboard_summary: "{}".to_string(),
            }),
            model_root: ".".to_string(),
            data_dir,
        }
    }

    fn request(path: &str, body: serde_json::Value) -> Request {
        Request {
            method: "POST".to_string(),
            path: path.to_string(),
            headers: HashMap::new(),
            body: body.to_string(),
        }
    }

    #[test]
    fn validates_real_image_signatures_and_size() {
        let png = STANDARD.encode(b"\x89PNG\r\n\x1a\nsmall");
        let attachment = screenshot_attachment(&format!("data:image/png;base64,{}", png)).unwrap();
        assert_eq!(attachment.mime_type, "image/png");
        let fake = STANDARD.encode(b"not really a jpeg");
        assert!(screenshot_attachment(&format!("data:image/jpeg;base64,{}", fake)).is_err());
        let too_large = STANDARD.encode(vec![0_u8; MAX_SCREENSHOT_BYTES + 1]);
        assert_eq!(
            screenshot_attachment(&format!("data:image/png;base64,{}", too_large)),
            Err("Keep the screenshot under 5 MB.")
        );
    }

    #[test]
    fn endpoints_validate_and_rate_limit_each_feedback_kind() {
        let server = test_server("routes");
        let user = super::super::auth::test_user(7, "Garrett", "founder@example.test");
        let invalid = handle(
            &server,
            &request("/api/feedback/bug-report", json!({"description": "short"})),
            Some(&user),
        )
        .unwrap();
        assert_eq!(invalid.status, 400);

        for _ in 0..RATE_MAX_PER_KIND {
            let response = handle(
                &server,
                &request(
                    "/api/feedback/bug-report",
                    json!({"description": "The cards overlap unexpectedly."}),
                ),
                Some(&user),
            )
            .unwrap();
            assert_eq!(response.status, 201);
            assert!(!response.body.contains("cards overlap"));
        }
        let limited = handle(
            &server,
            &request(
                "/api/feedback/bug-report",
                json!({"description": "The cards overlap unexpectedly."}),
            ),
            Some(&user),
        )
        .unwrap();
        assert_eq!(limited.status, 429);

        let feature = handle(
            &server,
            &request(
                "/api/feedback/feature-request",
                json!({"description": "Please add a daily challenge board."}),
            ),
            Some(&user),
        )
        .unwrap();
        assert_eq!(feature.status, 201);
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }
}
