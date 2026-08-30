use std::env;
use std::sync::OnceLock;

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand_core::{OsRng, RngCore};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{email, open_game_database, Request, Response, Server};

const SESSION_COOKIE: &str = "strong_cribbage_session";
const SESSION_SECONDS: i64 = 30 * 24 * 60 * 60;
const OTP_SECONDS: i64 = 10 * 60;
const RESET_SECONDS: i64 = 30 * 60;
const INVITE_SECONDS: i64 = 7 * 24 * 60 * 60;

const EXISTING_USERS: [(&str, &str); 7] = [
    ("Garrett", "founder@evenvision.com"),
    ("Kurt", "hollywood2742@gmail.com"),
    ("Popchuckles", "Crperks@charter.net"),
    ("Stoneman", "4stoneman@gmail.com"),
    ("Travis", "kephart98532@gmail.com"),
    ("Shane", "shanerk00111@gmail.com"),
    ("Vince", "Vpellegrini@me.com"),
];

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub email: String,
    password_hash: Option<String>,
}

#[derive(Deserialize)]
struct EmailRequest {
    email: String,
}

#[derive(Deserialize)]
struct PasswordLoginRequest {
    email: String,
    password: String,
}

#[derive(Deserialize)]
struct OtpVerifyRequest {
    email: String,
    code: String,
}

#[derive(Deserialize)]
struct PasswordTokenRequest {
    token: String,
    password: String,
}

pub fn initialize(data_dir: &std::path::Path) -> Result<(), String> {
    let connection = open_game_database(data_dir)?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS auth_users (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               username TEXT NOT NULL UNIQUE COLLATE NOCASE,
               display_name TEXT NOT NULL,
               email TEXT NOT NULL,
               normalized_email TEXT NOT NULL UNIQUE,
               password_hash TEXT,
               invited_at INTEGER,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS auth_challenges (
               id TEXT PRIMARY KEY,
               user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
               purpose TEXT NOT NULL,
               secret_hash TEXT NOT NULL,
               expires_at INTEGER NOT NULL,
               attempts INTEGER NOT NULL DEFAULT 0,
               consumed_at INTEGER,
               created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS auth_challenges_lookup
               ON auth_challenges(user_id, purpose, created_at DESC);
             CREATE TABLE IF NOT EXISTS auth_sessions (
               token_hash TEXT PRIMARY KEY,
               user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
               expires_at INTEGER NOT NULL,
               created_at INTEGER NOT NULL,
               last_seen_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS auth_sessions_user
               ON auth_sessions(user_id, expires_at);
             CREATE TABLE IF NOT EXISTS auth_rate_events (
               kind TEXT NOT NULL,
               subject TEXT NOT NULL,
               occurred_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS auth_rate_events_lookup
               ON auth_rate_events(kind, subject, occurred_at DESC);",
        )
        .map_err(|error| format!("create authentication tables: {}", error))?;

    let now = unix_seconds();
    for (username, email) in EXISTING_USERS {
        connection
            .execute(
                "INSERT INTO auth_users
                 (username, display_name, email, normalized_email, created_at, updated_at)
                 VALUES (?1, ?1, ?2, ?3, ?4, ?4)
                 ON CONFLICT(username) DO UPDATE SET
                   display_name = excluded.display_name,
                   email = excluded.email,
                   normalized_email = excluded.normalized_email,
                   updated_at = excluded.updated_at",
                params![username, email, normalize_email(email), now],
            )
            .map_err(|error| format!("seed account for {}: {}", username, error))?;
    }
    Ok(())
}

pub fn validate_configuration() -> Result<(), String> {
    if !auth_required() {
        return Ok(());
    }
    for name in ["CRIBBAGE_AUTH_PEPPER", "SENDGRID_API_KEY"] {
        if env::var(name)
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
        {
            return Err(format!(
                "{} must be configured when authentication is required",
                name
            ));
        }
    }
    Ok(())
}

pub fn auth_required() -> bool {
    env::var("CRIBBAGE_REQUIRE_AUTH")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

pub fn protects(path: &str) -> bool {
    matches!(
        path,
        "/api/game/action"
            | "/api/game/session/save"
            | "/api/game/session/load"
            | "/api/game/session/complete"
            | "/api/games"
    )
}

pub fn handle(server: &Server, request: &Request) -> Option<Response> {
    let response = match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/api/auth/session") => session_response(server, request),
        ("POST", "/api/auth/login") => password_login(server, request),
        ("POST", "/api/auth/otp/request") => otp_request(server, request),
        ("POST", "/api/auth/otp/verify") => otp_verify(server, request),
        ("POST", "/api/auth/password/request") => password_request(server, request),
        ("POST", "/api/auth/password/reset") => password_reset(server, request),
        ("POST", "/api/auth/invite/send") => invite_send(server, request),
        ("POST", "/api/auth/invite/accept") => invite_accept(server, request),
        ("POST", "/api/auth/logout") => logout(server, request),
        _ => return None,
    };
    Some(response)
}

pub fn authenticated_user(server: &Server, request: &Request) -> Result<Option<AuthUser>, String> {
    let Some(token) = cookie_value(request, SESSION_COOKIE) else {
        return Ok(None);
    };
    let now = unix_seconds();
    let connection = open_game_database(&server.data_dir)?;
    let token_hash = digest(&token);
    let user = connection
        .query_row(
            "SELECT u.id, u.username, u.display_name, u.email, u.password_hash
             FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
             WHERE s.token_hash = ?1 AND s.expires_at > ?2",
            params![token_hash, now],
            user_from_row,
        )
        .optional()
        .map_err(|error| format!("read authentication session: {}", error))?;
    if user.is_some() {
        connection
            .execute(
                "UPDATE auth_sessions SET last_seen_at = ?2 WHERE token_hash = ?1",
                params![token_hash, now],
            )
            .map_err(|error| format!("update authentication session: {}", error))?;
    }
    Ok(user)
}

pub fn body_for_user(body: &str, user: &AuthUser) -> String {
    let Ok(mut value) = serde_json::from_str::<Value>(body) else {
        return body.to_string();
    };
    if let Some(object) = value.as_object_mut() {
        object.insert("tag".to_string(), Value::String(user.display_name.clone()));
    }
    serde_json::to_string(&value).unwrap_or_else(|_| body.to_string())
}

fn session_response(server: &Server, request: &Request) -> Response {
    match authenticated_user(server, request) {
        Ok(Some(user)) => Response::json(200, user_json(&user)),
        Ok(None) => Response::json(200, "{\"authenticated\":false}".to_string()),
        Err(error) => internal_error(error),
    }
}

fn password_login(server: &Server, request: &Request) -> Response {
    let Ok(input) = parse::<PasswordLoginRequest>(request) else {
        return bad_request("Enter a valid email and password.");
    };
    let normalized = normalize_email(&input.email);
    if normalized.is_empty() || input.password.is_empty() {
        return invalid_credentials();
    }
    match rate_limited(&server.data_dir, "password-login", &normalized, 15 * 60, 10) {
        Ok(true) => return too_many_requests(),
        Err(error) => return internal_error(error),
        Ok(false) => {}
    }
    let user = match find_user_by_email(&server.data_dir, &normalized) {
        Ok(user) => user,
        Err(error) => return internal_error(error),
    };
    let valid = user
        .as_ref()
        .and_then(|user| user.password_hash.as_deref())
        .map(|hash| verify_password(hash, &input.password))
        .unwrap_or_else(|| {
            // Keep missing accounts and passwordless accounts on the same
            // deliberately expensive verification path.
            verify_password(dummy_password_hash(), &input.password)
        });
    if !valid {
        return invalid_credentials();
    }
    create_session_response(server, &user.expect("valid password has a user"))
}

fn otp_request(server: &Server, request: &Request) -> Response {
    let Ok(input) = parse::<EmailRequest>(request) else {
        return bad_request("Enter a valid email address.");
    };
    let normalized = normalize_email(&input.email);
    let message = generic_email_response(
        "If that email belongs to an account, a sign-in code is on its way.",
    );
    match rate_limited(&server.data_dir, "otp-request", &normalized, 60 * 60, 6) {
        Ok(true) => return message,
        Err(error) => return internal_error(error),
        Ok(false) => {}
    }
    let Some(user) = (match find_user_by_email(&server.data_dir, &normalized) {
        Ok(user) => user,
        Err(error) => return internal_error(error),
    }) else {
        return message;
    };
    let code = random_code();
    if let Err(error) = create_challenge(server, &user, "otp", &code, OTP_SECONDS) {
        return internal_error(error);
    }
    if let Err(error) = email::send(
        &user.email,
        &user.display_name,
        &email::one_time_code(&user.display_name, &code),
    ) {
        eprintln!(
            "Could not send one-time code for user {}: {}",
            user.id, error
        );
    }
    message
}

fn otp_verify(server: &Server, request: &Request) -> Response {
    let Ok(input) = parse::<OtpVerifyRequest>(request) else {
        return bad_request("Enter the six-digit code from your email.");
    };
    let normalized = normalize_email(&input.email);
    if input.code.len() != 6 || !input.code.bytes().all(|value| value.is_ascii_digit()) {
        return invalid_code();
    }
    match rate_limited(&server.data_dir, "otp-verify", &normalized, 15 * 60, 12) {
        Ok(true) => return too_many_requests(),
        Err(error) => return internal_error(error),
        Ok(false) => {}
    }
    let Some(user) = (match find_user_by_email(&server.data_dir, &normalized) {
        Ok(user) => user,
        Err(error) => return internal_error(error),
    }) else {
        return invalid_code();
    };
    match consume_challenge(server, &user, "otp", &input.code, 5) {
        Ok(true) => create_session_response(server, &user),
        Ok(false) => invalid_code(),
        Err(error) => internal_error(error),
    }
}

fn password_request(server: &Server, request: &Request) -> Response {
    let Ok(input) = parse::<EmailRequest>(request) else {
        return bad_request("Enter a valid email address.");
    };
    let normalized = normalize_email(&input.email);
    let message =
        generic_email_response("If that email belongs to an account, a reset link is on its way.");
    match rate_limited(
        &server.data_dir,
        "password-request",
        &normalized,
        60 * 60,
        4,
    ) {
        Ok(true) => return message,
        Err(error) => return internal_error(error),
        Ok(false) => {}
    }
    let Some(user) = (match find_user_by_email(&server.data_dir, &normalized) {
        Ok(user) => user,
        Err(error) => return internal_error(error),
    }) else {
        return message;
    };
    let token = random_token(32);
    if let Err(error) = create_challenge(server, &user, "password-reset", &token, RESET_SECONDS) {
        return internal_error(error);
    }
    let url = format!("{}/?reset={}", public_origin(), token);
    if let Err(error) = email::send(
        &user.email,
        &user.display_name,
        &email::password_reset(&user.display_name, &url),
    ) {
        eprintln!(
            "Could not send password reset for user {}: {}",
            user.id, error
        );
    }
    message
}

fn password_reset(server: &Server, request: &Request) -> Response {
    let Ok(input) = parse::<PasswordTokenRequest>(request) else {
        return bad_request("The reset request is incomplete.");
    };
    if let Err(message) = validate_password(&input.password) {
        return bad_request(message);
    }
    match user_for_token(server, "password-reset", &input.token) {
        Ok(Some(user)) => match set_password_and_consume(
            server,
            &user,
            "password-reset",
            &input.token,
            &input.password,
        ) {
            Ok(true) => create_session_response(server, &user),
            Ok(false) => invalid_link(),
            Err(error) => internal_error(error),
        },
        Ok(None) => invalid_link(),
        Err(error) => internal_error(error),
    }
}

fn invite_send(server: &Server, request: &Request) -> Response {
    if !admin_authorized(request) {
        return Response::json(403, "{\"error\":\"Forbidden\"}".to_string());
    }
    let Ok(input) = parse::<EmailRequest>(request) else {
        return bad_request("Enter a valid account email.");
    };
    let Some(user) = (match find_user_by_email(&server.data_dir, &normalize_email(&input.email)) {
        Ok(user) => user,
        Err(error) => return internal_error(error),
    }) else {
        return Response::json(404, "{\"error\":\"Account not found.\"}".to_string());
    };
    let token = random_token(32);
    if let Err(error) = create_challenge(server, &user, "invite", &token, INVITE_SECONDS) {
        return internal_error(error);
    }
    let url = format!("{}/?invite={}", public_origin(), token);
    if let Err(error) = email::send(
        &user.email,
        &user.display_name,
        &email::invitation(&user.display_name, &url),
    ) {
        return internal_error(error);
    }
    let connection = match open_game_database(&server.data_dir) {
        Ok(connection) => connection,
        Err(error) => return internal_error(error),
    };
    if let Err(error) = connection.execute(
        "UPDATE auth_users SET invited_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![user.id, unix_seconds()],
    ) {
        return internal_error(format!("record invitation: {}", error));
    }
    Response::json(200, "{\"ok\":true}".to_string())
}

fn invite_accept(server: &Server, request: &Request) -> Response {
    let Ok(input) = parse::<PasswordTokenRequest>(request) else {
        return bad_request("The invitation is incomplete.");
    };
    if let Err(message) = validate_password(&input.password) {
        return bad_request(message);
    }
    match user_for_token(server, "invite", &input.token) {
        Ok(Some(user)) => {
            match set_password_and_consume(server, &user, "invite", &input.token, &input.password) {
                Ok(true) => create_session_response(server, &user),
                Ok(false) => invalid_link(),
                Err(error) => internal_error(error),
            }
        }
        Ok(None) => invalid_link(),
        Err(error) => internal_error(error),
    }
}

fn logout(server: &Server, request: &Request) -> Response {
    if let Some(token) = cookie_value(request, SESSION_COOKIE) {
        if let Ok(connection) = open_game_database(&server.data_dir) {
            let _ = connection.execute(
                "DELETE FROM auth_sessions WHERE token_hash = ?1",
                [digest(&token)],
            );
        }
    }
    Response::json(200, "{\"ok\":true}".to_string()).with_header(
        "Set-Cookie",
        format!(
            "{}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{}",
            SESSION_COOKIE,
            secure_cookie_suffix()
        ),
    )
}

fn create_session_response(server: &Server, user: &AuthUser) -> Response {
    let token = random_token(32);
    let now = unix_seconds();
    let connection = match open_game_database(&server.data_dir) {
        Ok(connection) => connection,
        Err(error) => return internal_error(error),
    };
    if let Err(error) =
        connection.execute("DELETE FROM auth_sessions WHERE expires_at <= ?1", [now])
    {
        return internal_error(format!("prune expired authentication sessions: {}", error));
    }
    if let Err(error) = connection.execute(
        "INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![digest(&token), user.id, now + SESSION_SECONDS, now],
    ) {
        return internal_error(format!("create authentication session: {}", error));
    }
    Response::json(200, user_json(user)).with_header(
        "Set-Cookie",
        format!(
            "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
            SESSION_COOKIE,
            token,
            SESSION_SECONDS,
            secure_cookie_suffix()
        ),
    )
}

fn create_challenge(
    server: &Server,
    user: &AuthUser,
    purpose: &str,
    secret: &str,
    ttl: i64,
) -> Result<(), String> {
    let connection = open_game_database(&server.data_dir)?;
    let now = unix_seconds();
    connection
        .execute(
            "UPDATE auth_challenges SET consumed_at = ?3
             WHERE user_id = ?1 AND purpose = ?2 AND consumed_at IS NULL",
            params![user.id, purpose, now],
        )
        .map_err(|error| format!("expire earlier authentication challenge: {}", error))?;
    connection
        .execute(
            "INSERT INTO auth_challenges
             (id, user_id, purpose, secret_hash, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                random_token(18),
                user.id,
                purpose,
                challenge_digest(purpose, secret),
                now + ttl,
                now
            ],
        )
        .map_err(|error| format!("create authentication challenge: {}", error))?;
    Ok(())
}

fn consume_challenge(
    server: &Server,
    user: &AuthUser,
    purpose: &str,
    secret: &str,
    max_attempts: i64,
) -> Result<bool, String> {
    let connection = open_game_database(&server.data_dir)?;
    let now = unix_seconds();
    let row = connection
        .query_row(
            "SELECT id, secret_hash, attempts FROM auth_challenges
             WHERE user_id = ?1 AND purpose = ?2 AND consumed_at IS NULL AND expires_at > ?3
             ORDER BY created_at DESC LIMIT 1",
            params![user.id, purpose, now],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("read authentication challenge: {}", error))?;
    let Some((id, expected, attempts)) = row else {
        return Ok(false);
    };
    if attempts >= max_attempts {
        return Ok(false);
    }
    if !constant_time_eq(
        expected.as_bytes(),
        challenge_digest(purpose, secret).as_bytes(),
    ) {
        connection
            .execute(
                "UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?1",
                [id],
            )
            .map_err(|error| format!("record authentication attempt: {}", error))?;
        return Ok(false);
    }
    connection
        .execute(
            "UPDATE auth_challenges SET consumed_at = ?2 WHERE id = ?1",
            params![id, now],
        )
        .map_err(|error| format!("consume authentication challenge: {}", error))?;
    Ok(true)
}

fn user_for_token(server: &Server, purpose: &str, token: &str) -> Result<Option<AuthUser>, String> {
    let connection = open_game_database(&server.data_dir)?;
    let now = unix_seconds();
    let expected = challenge_digest(purpose, token);
    connection
        .query_row(
            "SELECT u.id, u.username, u.display_name, u.email, u.password_hash
             FROM auth_challenges c JOIN auth_users u ON u.id = c.user_id
             WHERE c.purpose = ?1 AND c.secret_hash = ?2 AND c.consumed_at IS NULL
               AND c.expires_at > ?3 AND c.attempts < 5
             ORDER BY c.created_at DESC LIMIT 1",
            params![purpose, expected, now],
            user_from_row,
        )
        .optional()
        .map_err(|error| format!("read authentication link: {}", error))
}

fn set_password_and_consume(
    server: &Server,
    user: &AuthUser,
    purpose: &str,
    token: &str,
    password: &str,
) -> Result<bool, String> {
    if !consume_challenge(server, user, purpose, token, 5)? {
        return Ok(false);
    }
    let password_hash = hash_password(password)?;
    let connection = open_game_database(&server.data_dir)?;
    connection
        .execute(
            "UPDATE auth_users SET password_hash = ?2, updated_at = ?3 WHERE id = ?1",
            params![user.id, password_hash, unix_seconds()],
        )
        .map_err(|error| format!("save password: {}", error))?;
    connection
        .execute("DELETE FROM auth_sessions WHERE user_id = ?1", [user.id])
        .map_err(|error| format!("retire earlier sessions: {}", error))?;
    Ok(true)
}

fn find_user_by_email(
    data_dir: &std::path::Path,
    normalized: &str,
) -> Result<Option<AuthUser>, String> {
    let connection = open_game_database(data_dir)?;
    connection
        .query_row(
            "SELECT id, username, display_name, email, password_hash
             FROM auth_users WHERE normalized_email = ?1",
            [normalized],
            user_from_row,
        )
        .optional()
        .map_err(|error| format!("read account: {}", error))
}

fn user_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuthUser> {
    Ok(AuthUser {
        id: row.get(0)?,
        username: row.get(1)?,
        display_name: row.get(2)?,
        email: row.get(3)?,
        password_hash: row.get(4)?,
    })
}

fn rate_limited(
    data_dir: &std::path::Path,
    kind: &str,
    subject: &str,
    window: i64,
    maximum: i64,
) -> Result<bool, String> {
    let connection = open_game_database(data_dir)?;
    let now = unix_seconds();
    connection
        .execute(
            "DELETE FROM auth_rate_events WHERE occurred_at < ?1",
            [now - 24 * 60 * 60],
        )
        .map_err(|error| format!("prune authentication rate events: {}", error))?;
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM auth_rate_events
             WHERE kind = ?1 AND subject = ?2 AND occurred_at >= ?3",
            params![kind, subject, now - window],
            |row| row.get(0),
        )
        .map_err(|error| format!("check authentication rate: {}", error))?;
    connection
        .execute(
            "INSERT INTO auth_rate_events (kind, subject, occurred_at) VALUES (?1, ?2, ?3)",
            params![kind, subject, now],
        )
        .map_err(|error| format!("record authentication rate event: {}", error))?;
    Ok(count >= maximum)
}

fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| format!("hash password: {}", error))
}

fn verify_password(stored: &str, password: &str) -> bool {
    PasswordHash::new(stored)
        .ok()
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

fn dummy_password_hash() -> &'static str {
    // A valid Argon2id hash keeps unknown-email timing close to a real login.
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| {
        hash_password("this is only a timing equalizer")
            .expect("the built-in dummy password can be hashed")
    })
    .as_str()
}

fn validate_password(password: &str) -> Result<(), &'static str> {
    let length = password.chars().count();
    if length < 15 {
        return Err("Use at least 15 characters for your password.");
    }
    if length > 128 {
        return Err("Use no more than 128 characters for your password.");
    }
    Ok(())
}

fn parse<T: for<'de> Deserialize<'de>>(request: &Request) -> Result<T, ()> {
    serde_json::from_str(&request.body).map_err(|_| ())
}

fn cookie_value(request: &Request, name: &str) -> Option<String> {
    request.headers.get("cookie").and_then(|header| {
        header.split(';').find_map(|part| {
            let (candidate, value) = part.trim().split_once('=')?;
            (candidate == name).then(|| value.to_string())
        })
    })
}

fn admin_authorized(request: &Request) -> bool {
    let configured = env::var("CRIBBAGE_AUTH_ADMIN_KEY").unwrap_or_default();
    let provided = request
        .headers
        .get("x-cribbage-admin-key")
        .cloned()
        .unwrap_or_default();
    !configured.is_empty() && constant_time_eq(configured.as_bytes(), provided.as_bytes())
}

fn random_token(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn random_code() -> String {
    let mut bytes = [0u8; 4];
    OsRng.fill_bytes(&mut bytes);
    format!("{:06}", u32::from_le_bytes(bytes) % 1_000_000)
}

fn digest(value: &str) -> String {
    let bytes = Sha256::digest(value.as_bytes());
    bytes.iter().map(|byte| format!("{:02x}", byte)).collect()
}

fn challenge_digest(purpose: &str, secret: &str) -> String {
    let pepper = env::var("CRIBBAGE_AUTH_PEPPER")
        .unwrap_or_else(|_| "local-development-auth-pepper".to_string());
    digest(&format!("{}:{}:{}", purpose, secret, pepper))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

fn normalize_email(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

fn public_origin() -> String {
    env::var("CRIBBAGE_PUBLIC_ORIGIN")
        .unwrap_or_else(|_| "https://cribbage.strongcribbage.com".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn secure_cookie_suffix() -> &'static str {
    if public_origin().starts_with("https://") {
        "; Secure"
    } else {
        ""
    }
}

fn unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn user_json(user: &AuthUser) -> String {
    json!({
        "authenticated": true,
        "user": {
            "username": user.username,
            "displayName": user.display_name,
            "email": user.email
        }
    })
    .to_string()
}

fn generic_email_response(message: &str) -> Response {
    Response::json(200, json!({"ok": true, "message": message}).to_string())
}

fn bad_request(message: &str) -> Response {
    Response::json(400, json!({"error": message}).to_string())
}

fn invalid_credentials() -> Response {
    Response::json(
        401,
        "{\"error\":\"Email or password is incorrect.\"}".to_string(),
    )
}

fn invalid_code() -> Response {
    Response::json(
        401,
        "{\"error\":\"That code is invalid or has expired.\"}".to_string(),
    )
}

fn invalid_link() -> Response {
    Response::json(
        401,
        "{\"error\":\"That private link is invalid or has expired.\"}".to_string(),
    )
}

fn too_many_requests() -> Response {
    Response::json(
        429,
        "{\"error\":\"Too many attempts. Please wait and try again.\"}".to_string(),
    )
}

fn internal_error(error: String) -> Response {
    eprintln!("Authentication error: {}", error);
    Response::json(
        500,
        "{\"error\":\"Authentication is temporarily unavailable.\"}".to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn test_server(name: &str) -> Server {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-auth-{}-{}-{}",
            name,
            std::process::id(),
            super::super::unix_millis()
        ));
        super::super::initialize_game_database(&data_dir).unwrap();
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

    #[test]
    fn seeds_the_named_existing_accounts_with_corrected_vince_email() {
        let server = test_server("seeds");
        let connection = open_game_database(&server.data_dir).unwrap();
        let rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM auth_users", [], |row| row.get(0))
            .unwrap();
        let vince: String = connection
            .query_row(
                "SELECT email FROM auth_users WHERE username = 'Vince'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 7);
        assert_eq!(vince, "Vpellegrini@me.com");
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn password_policy_accepts_passphrases_without_composition_rules() {
        assert!(validate_password("correct horse battery staple").is_ok());
        assert!(validate_password("short password").is_err());
    }

    #[test]
    fn authenticated_request_tag_replaces_client_supplied_identity() {
        let user = AuthUser {
            id: 1,
            username: "Garrett".to_string(),
            display_name: "Garrett".to_string(),
            email: "founder@evenvision.com".to_string(),
            password_hash: None,
        };
        let body = body_for_user(r#"{"tag":"Someone else","action":"new"}"#, &user);
        let value: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(value["tag"], "Garrett");
    }

    #[test]
    fn one_time_challenges_are_single_use() {
        let server = test_server("otp");
        let user = find_user_by_email(&server.data_dir, "founder@evenvision.com")
            .unwrap()
            .unwrap();
        create_challenge(&server, &user, "otp", "482193", OTP_SECONDS).unwrap();
        assert!(consume_challenge(&server, &user, "otp", "482193", 5).unwrap());
        assert!(!consume_challenge(&server, &user, "otp", "482193", 5).unwrap());
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn password_login_issues_a_secure_opaque_session() {
        let server = test_server("password-login");
        let password = "a long memorable cribbage passphrase";
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "UPDATE auth_users SET password_hash = ?2 WHERE normalized_email = ?1",
                params!["founder@evenvision.com", hash_password(password).unwrap()],
            )
            .unwrap();
        let request = Request {
            method: "POST".to_string(),
            path: "/api/auth/login".to_string(),
            headers: HashMap::new(),
            body: json!({
                "email": "FOUNDER@EVENVISION.COM",
                "password": password
            })
            .to_string(),
        };

        let response = password_login(&server, &request);

        assert_eq!(response.status, 200);
        assert!(response.body.contains("\"displayName\":\"Garrett\""));
        let cookie = response
            .headers
            .iter()
            .find(|(name, _)| name == "Set-Cookie")
            .map(|(_, value)| value)
            .expect("login response has a session cookie");
        assert!(cookie.starts_with("strong_cribbage_session="));
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("Secure"));
        assert!(cookie.contains("SameSite=Lax"));
        assert!(!cookie.contains(password));
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }
}
