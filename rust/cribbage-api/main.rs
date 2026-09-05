use std::collections::{HashMap, HashSet};
use std::env;
use std::fmt::Write as _;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use cribbage_shadow_engine::cards::{
    full_deck, score_count_components, score_hand_components, Card, HandScoreComponents,
    PeggingScoreComponents, RANKS, SUIT_NAMES, VALUES,
};
use cribbage_shadow_engine::decision::{
    recommend_discard_for_side, recommend_peg_for_side, recommend_peg_for_side_with_model911_cache,
    review_discard_for_side_with_recommendation, review_peg_for_side_with_recommendation,
    DecisionReview as EngineDecisionReview, PegDecision, ReviewedDecisionValue,
};
use cribbage_shadow_engine::dynamic::{
    DynamicCycleSample, DynamicProfile, DynamicState, DYNAMIC_EVALUATOR_VERSION,
    MIN_COMPLETE_CYCLES,
};
use cribbage_shadow_engine::game::{CribbageGame, Phase, Side};
use cribbage_shadow_engine::model::Model911HandCache;
use cribbage_shadow_engine::model_id::{
    ModelId, DYNAMIC, MODEL_13_0, MODEL_9_1, MODEL_9_11, MYRMIDON_5,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

mod activity;
mod auth;
mod email;
mod feedback;
mod people;

const HUMAN: Side = Side::Left;
const AI: Side = Side::Right;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const GIT_COMMIT: &str = match option_env!("CRIBBAGE_BUILD_GIT_COMMIT") {
    Some(value) => value,
    None => "unknown",
};

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct Session {
    id: String,
    tag: Option<String>,
    model: ModelId,
    seed: u32,
    game: CribbageGame,
    waiting_for_deal_cut: bool,
    deal_cut_revealed: bool,
    waiting_for_ai_discard: bool,
    turn_card_revealed: bool,
    deal_cuts: [Card; 2],
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
    forfeited: bool,
    decision_reviews: Vec<SavedDecisionReview>,
    prepared_decision_analyses: Vec<PreparedDecisionAnalysis>,
    help_events: Vec<SavedHelpEvent>,
    score_events: Vec<SavedScoreEvent>,
    next_review_id: u32,
    event_sequence: u64,
    pending_final_scoring: Option<FinalScoring>,
    model911_hand_cache: Model911HandCache,
    dynamic: Option<DynamicState>,
}

impl Session {
    fn decision_model(&self) -> ModelId {
        self.dynamic
            .as_ref()
            .map(DynamicState::decision_model)
            .unwrap_or(self.model)
    }

    fn use_dynamic_profile(&mut self, profile: DynamicProfile) {
        self.dynamic = Some(DynamicState::new(
            profile,
            self.seed,
            score_snapshot(&self.game),
        ));
    }
}

enum DeferredRecommendation {
    AiDiscard(CribbageGame, ModelId),
    MasterHint {
        session_id: String,
        game: CribbageGame,
        cached: Option<PreparedDecisionAnalysis>,
    },
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
enum ReviewKind {
    Discard,
    Peg,
}

#[derive(Clone, Deserialize, Serialize)]
struct SavedDecisionReview {
    id: String,
    at: String,
    kind: ReviewKind,
    game: CribbageGame,
    selected_card_ids: Vec<u8>,
    completed: Option<CompletedDecisionReview>,
    #[serde(default)]
    prior_analyses: Vec<CompletedDecisionReview>,
    #[serde(default)]
    prepared_analysis: Option<PreparedDecisionAnalysis>,
}

#[derive(Clone, Deserialize, Serialize)]
struct SavedDecisionValue {
    card_ids: Vec<u8>,
    ev: Option<f64>,
    win_probability: Option<f64>,
}

#[derive(Clone, Deserialize, Serialize)]
struct PreparedDecisionAnalysis {
    decision_key: String,
    evaluator_model: String,
    kind: ReviewKind,
    recommended: SavedDecisionValue,
}

#[derive(Clone, Deserialize, Serialize)]
struct SavedHelpEvent {
    id: String,
    at: String,
    hand_number: u32,
    decision_key: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct CompletedDecisionReview {
    #[serde(default = "default_analysis_model")]
    evaluator_model: String,
    selected_card_ids: Vec<u8>,
    recommended_card_ids: Vec<u8>,
    selected_ev: f64,
    recommended_ev: f64,
    selected_win_probability: Option<f64>,
    recommended_win_probability: Option<f64>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
enum FinalScoringStage {
    Pone,
    Dealer,
    Crib,
}

#[derive(Clone, Deserialize, Serialize)]
struct FinalScoring {
    stage: FinalScoringStage,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
enum SavedScoreCategory {
    Pegging,
    Hand,
    Crib,
}

#[derive(Clone, Deserialize, Serialize)]
struct SavedScoreEvent {
    id: String,
    at: String,
    hand_number: u32,
    player: Side,
    dealer: Side,
    category: SavedScoreCategory,
    points: i32,
    reason: String,
    total_score: i32,
    scores: [i32; 2],
    cards: Vec<Card>,
    turn_card: Option<Card>,
    count: Option<u8>,
    #[serde(default)]
    score_components: Option<PeggingScoreComponents>,
}

/// The private, server-owned game session as stored in SQLite.  The browser
/// snapshot intentionally excludes the AI's cards, so it must never be used
/// as a recovery source.
#[derive(Deserialize, Serialize)]
struct PersistedSession {
    version: u8,
    id: String,
    tag: Option<String>,
    model: String,
    seed: u32,
    game: CribbageGame,
    waiting_for_deal_cut: bool,
    deal_cut_revealed: bool,
    waiting_for_ai_discard: bool,
    turn_card_revealed: bool,
    deal_cuts: [Card; 2],
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
    #[serde(default)]
    forfeited: bool,
    decision_reviews: Vec<SavedDecisionReview>,
    #[serde(default)]
    prepared_decision_analyses: Vec<PreparedDecisionAnalysis>,
    #[serde(default)]
    help_events: Vec<SavedHelpEvent>,
    #[serde(default)]
    score_events: Vec<SavedScoreEvent>,
    next_review_id: u32,
    event_sequence: u64,
    pending_final_scoring: Option<FinalScoring>,
    #[serde(default)]
    dynamic: Option<DynamicState>,
}

#[derive(Clone)]
struct UploadedGame {
    game_id: String,
    player: String,
    winner: Option<String>,
    result: String,
    human_score: i32,
    ai_score: i32,
    model: String,
    ended_at: String,
    human_scoring: ScoringTotals,
    ai_scoring: ScoringTotals,
    analyzed: bool,
    errors: i32,
}

#[derive(Clone, Default, Eq, PartialEq)]
struct ScoringTotals {
    pegging_dealer: i32,
    pegging_pone: i32,
    hand_dealer: i32,
    hand_pone: i32,
    crib: i32,
    pegging_dealer_hands: i32,
    pegging_pone_hands: i32,
    hand_dealer_hands: i32,
    hand_pone_hands: i32,
    crib_hands: i32,
}

impl ScoringTotals {
    fn add(&mut self, other: &Self) {
        self.pegging_dealer += other.pegging_dealer;
        self.pegging_pone += other.pegging_pone;
        self.hand_dealer += other.hand_dealer;
        self.hand_pone += other.hand_pone;
        self.crib += other.crib;
        self.pegging_dealer_hands += other.pegging_dealer_hands;
        self.pegging_pone_hands += other.pegging_pone_hands;
        self.hand_dealer_hands += other.hand_dealer_hands;
        self.hand_pone_hands += other.hand_pone_hands;
        self.crib_hands += other.crib_hands;
    }

    fn has_opportunities(&self) -> bool {
        self.pegging_dealer_hands
            + self.pegging_pone_hands
            + self.hand_dealer_hands
            + self.hand_pone_hands
            + self.crib_hands
            > 0
    }
}

#[derive(Default)]
struct AppState {
    sessions: HashMap<String, Session>,
    uploads: HashMap<String, UploadedGame>,
    leaderboard_summary: String,
}

struct Server {
    state: Mutex<AppState>,
    model_root: String,
    data_dir: PathBuf,
}

fn main() {
    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("PORT").unwrap_or_else(|_| "8787".to_string());
    let address = format!("{}:{}", host, port);
    let model_root = env::var("CRIBBAGE_MODEL_ROOT").unwrap_or_else(|_| {
        env::current_dir()
            .ok()
            .and_then(|path| path.to_str().map(str::to_string))
            .unwrap_or_else(|| ".".to_string())
    });
    let data_dir = env::var("CRIBBAGE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(&model_root).join("data"));
    initialize_game_database(&data_dir).unwrap_or_else(|error| {
        panic!(
            "could not initialize durable game storage in {}: {}",
            data_dir.display(),
            error
        )
    });
    auth::initialize(&data_dir)
        .unwrap_or_else(|error| panic!("could not initialize authentication storage: {}", error));
    activity::initialize(&data_dir)
        .unwrap_or_else(|error| panic!("could not initialize activity storage: {}", error));
    feedback::initialize(&data_dir)
        .unwrap_or_else(|error| panic!("could not initialize feedback storage: {}", error));
    people::initialize(&data_dir)
        .unwrap_or_else(|error| panic!("could not initialize people storage: {}", error));
    auth::validate_configuration()
        .unwrap_or_else(|error| panic!("invalid authentication configuration: {}", error));
    let uploads = load_uploads(&data_dir).unwrap_or_else(|error| {
        eprintln!("Rust API leaderboard history was not loaded: {}", error);
        HashMap::new()
    });
    let leaderboard_summary = leaderboard_summary_json_for_data_dir(&uploads, &data_dir);
    let sessions = load_active_sessions(&data_dir).unwrap_or_else(|error| {
        eprintln!("Durable game sessions were not loaded: {}", error);
        HashMap::new()
    });
    let listener = TcpListener::bind(&address)
        .unwrap_or_else(|error| panic!("could not bind Rust API server at {}: {}", address, error));
    let server = Arc::new(Server {
        state: Mutex::new(AppState {
            sessions,
            uploads,
            leaderboard_summary,
        }),
        model_root,
        data_dir,
    });
    eprintln!("Cribbage Rust API listening on http://{}", address);

    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let server = Arc::clone(&server);
        std::thread::spawn(move || {
            if let Err(error) = handle_connection(stream, &server) {
                eprintln!("Rust API request failed: {}", error);
            }
        });
    }
}

fn handle_connection(mut stream: TcpStream, server: &Server) -> Result<(), String> {
    let request = read_request(&mut stream)?;
    if let Some(response) = auth::handle(server, &request) {
        return write_response(&mut stream, response);
    }
    let authenticated_user = auth::authenticated_user(server, &request)
        .map_err(|error| format!("authenticate request: {}", error))?;
    let requires_user = request.method != "OPTIONS"
        && request.path != "/api/activity"
        && ((auth::auth_required() && auth::protects(&request.path))
            || (request.path == "/api/game/action"
                && game_action_requires_auth(server, &request.body)));
    if requires_user && authenticated_user.is_none() {
        return write_response(
            &mut stream,
            Response::json(401, "{\"error\":\"Sign in to continue.\"}".to_string()),
        );
    }
    if let Some(response) = activity::handle(server, &request, authenticated_user.as_ref()) {
        return write_response(&mut stream, response);
    }
    if let Some(response) = feedback::handle(server, &request, authenticated_user.as_ref()) {
        return write_response(&mut stream, response);
    }
    if let Some(response) = people::handle(server, &request, authenticated_user.as_ref()) {
        return write_response(&mut stream, response);
    }
    let request_body = authenticated_user
        .as_ref()
        .map(|user| auth::body_for_user(&request.body, user))
        .unwrap_or_else(|| request.body.clone());
    let response = match (request.method.as_str(), request.path.as_str()) {
        ("OPTIONS", _) => Response::empty(204),
        ("GET", "/health") => Response::json(200, health_json()),
        ("GET", "/api/model") => Response::json(200, model_json()),
        ("GET", "/api/leaderboard") => Response::json(200, leaderboard_json(server)?),
        ("POST", "/api/game/action") => {
            game_action(server, &request_body, authenticated_user.as_ref())
        }
        ("POST", "/api/game/review") => {
            review_game(server, &request_body, authenticated_user.as_ref())
        }
        ("POST", "/api/game/session/save") => save_session(server, &request_body),
        ("POST", "/api/game/session/load") => load_session(server, &request_body),
        ("POST", "/api/game/session/complete") => Response::json(200, "{\"ok\":true}".to_string()),
        ("POST", "/api/games") => upload_game(server, &request_body),
        ("POST", "/api/ai/discard") | ("POST", "/api/ai/peg") => Response::json(
            410,
            "{\"error\":\"Direct decision endpoints were retired; use /api/game/action.\"}"
                .to_string(),
        ),
        _ => Response::json(404, "{\"error\":\"Not found\"}".to_string()),
    };
    write_response(&mut stream, response)
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end;
    loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("request closed before headers".to_string());
        }
        bytes.extend_from_slice(&chunk[..read]);
        if let Some(index) = find_bytes(&bytes, b"\r\n\r\n") {
            header_end = index + 4;
            break;
        }
        if bytes.len() > 64 * 1024 {
            return Err("request headers are too large".to_string());
        }
    }
    let header_text =
        std::str::from_utf8(&bytes[..header_end]).map_err(|error| error.to_string())?;
    let request_line = header_text
        .lines()
        .next()
        .ok_or_else(|| "missing request line".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "missing request method".to_string())?
        .to_string();
    let raw_path = request_parts
        .next()
        .ok_or_else(|| "missing request path".to_string())?;
    let path = raw_path.split('?').next().unwrap_or(raw_path).to_string();
    let headers = header_text
        .lines()
        .skip(1)
        .filter_map(|line| {
            line.split_once(':')
                .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
        })
        .collect::<HashMap<_, _>>();
    let content_length = header_text
        .lines()
        .find_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
        })
        .unwrap_or(0);
    let max_body = if path == "/api/feedback/bug-report" {
        7_250_000
    } else {
        1_000_000
    };
    if content_length > max_body {
        return Err("request body is too large".to_string());
    }
    while bytes.len() < header_end + content_length {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("request closed before body".to_string());
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
    let body = String::from_utf8(bytes[header_end..header_end + content_length].to_vec())
        .map_err(|error| error.to_string())?;
    Ok(Request {
        method,
        path,
        headers,
        body,
    })
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

struct Response {
    status: u16,
    body: String,
    headers: Vec<(String, String)>,
}

impl Response {
    fn json(status: u16, body: String) -> Response {
        Response {
            status,
            body,
            headers: Vec::new(),
        }
    }

    fn empty(status: u16) -> Response {
        Response {
            status,
            body: String::new(),
            headers: Vec::new(),
        }
    }

    fn with_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Response {
        self.headers.push((name.into(), value.into()));
        self
    }
}

fn write_response(stream: &mut TcpStream, response: Response) -> Result<(), String> {
    let reason = match response.status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        410 => "Gone",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        _ => "Error",
    };
    let mut header = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type, x-cribbage-admin-key\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n",
        response.status,
        reason,
        response.body.len(),
    );
    for (name, value) in &response.headers {
        write!(&mut header, "{}: {}\r\n", name, value).map_err(|error| error.to_string())?;
    }
    header.push_str("\r\n");
    stream
        .write_all(header.as_bytes())
        .map_err(|error| error.to_string())?;
    stream
        .write_all(response.body.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn health_json() -> String {
    format!(
        "{{\"ok\":true,\"appVersion\":\"{}\",\"model\":\"{}\",\"runtime\":\"rust\",\"gitCommit\":\"{}\"}}",
        APP_VERSION, MODEL_13_0, GIT_COMMIT
    )
}

fn model_json() -> String {
    format!(
        "{{\"appVersion\":\"{}\",\"model\":\"{}\",\"runtime\":\"rust\",\"models\":[\"{}\",\"{}\",\"{}\",\"schell_table-peg_table-13.0\",\"schell_table-peg_table-13.1\",\"schell_table-peg_table-14.3\",\"schell_table-peg_table-14.8\",\"schell_table-peg_table-14.8.1\",\"schell_table-peg_table-15.0\",\"schell_table-peg_table-15.1\",\"schell_table-peg_table-15.2\",\"schell_table-peg_table-16.0\",\"schell_table-peg_table-16.1\",\"schell_table-peg_table-16.3\",\"{}\"]}}",
        APP_VERSION, MODEL_13_0, MYRMIDON_5, MODEL_9_1, MODEL_9_11, DYNAMIC
    )
}

fn game_action_requires_auth(server: &Server, body: &str) -> bool {
    let action = json_string(body, "action").unwrap_or_default();
    if action == "new" || action == "state" && json_string(body, "gameId").is_none() {
        return json_string(body, "opponent")
            .and_then(|value| ModelId::from_str(&value).ok())
            .map(|model| !guest_model(model))
            .unwrap_or(true);
    }
    let Some(session_id) = json_string(body, "gameId") else {
        return true;
    };
    if let Ok(app) = server.state.lock() {
        if let Some(session) = app.sessions.get(&session_id) {
            return !guest_model(session.model);
        }
    }
    load_session_by_id(&server.data_dir, &session_id)
        .ok()
        .flatten()
        .map(|session| !guest_model(session.model))
        .unwrap_or(true)
}

fn guest_model(model: ModelId) -> bool {
    matches!(
        model,
        ModelId::Myrmidon5 | ModelId::Schell91 | ModelId::Schell911
    )
}

fn game_action(
    server: &Server,
    body: &str,
    authenticated_user: Option<&auth::AuthUser>,
) -> Response {
    let action = json_string(body, "action").unwrap_or_default();
    let tag = json_string(body, "tag")
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.chars().take(80).collect());
    // A discard recommendation can take appreciably longer than the state
    // transition itself. Capture the exact post-transition game while holding
    // the lock, then evaluate it after releasing the global session lock. A
    // slow preparation for one game must not make every other game appear
    // unavailable.
    let result = (|| -> Result<(String, Option<DeferredRecommendation>), String> {
        let mut app = server
            .state
            .lock()
            .map_err(|_| "server state lock poisoned".to_string())?;
        if action == "new" || action == "state" && json_string(body, "gameId").is_none() {
            let model = json_string(body, "opponent")
                .and_then(|value| ModelId::from_str(&value).ok())
                .unwrap_or(ModelId::Schell13);
            if let Some(existing) = tag.as_deref().and_then(|tag| {
                app.sessions
                    .values()
                    .filter(|session| {
                        session.tag.as_deref() == Some(tag)
                            && session_status(session) == "active"
                            && session.model == model
                    })
                    .max_by_key(|session| &session.updated_at)
            }) {
                return response_for_session(existing).map(|response| (response, None));
            }
            let inherited_dynamic_profile = if model == ModelId::Dynamic {
                authenticated_user
                    .map(|user| load_dynamic_profile(&server.data_dir, user.id))
                    .transpose()?
                    .flatten()
            } else {
                None
            };
            let mut session = new_session(model, tag);
            if let Some(profile) = inherited_dynamic_profile {
                session.use_dynamic_profile(profile);
            }
            if model == ModelId::Dynamic {
                if let Some(user) = authenticated_user {
                    if let Some(profile) =
                        sync_dynamic_player_profile(&server.data_dir, user.id, &session)?
                    {
                        session.use_dynamic_profile(profile);
                    }
                }
            }
            session.event_sequence = 1;
            if let Err(error) = persist_session_event(&server.data_dir, &session, "new", body) {
                return Err(error);
            }
            let id = session.id.clone();
            app.sessions.insert(id.clone(), session);
            return response_for_session(app.sessions.get(&id).expect("new session exists"))
                .map(|response| (response, None));
        }

        let session_id =
            json_string(body, "gameId").ok_or_else(|| "Missing game session id.".to_string())?;
        if !app.sessions.contains_key(&session_id) {
            if let Some(session) = load_session_by_id(&server.data_dir, &session_id)? {
                app.sessions.insert(session_id.clone(), session);
            }
        }
        let session = app
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| "Game session was not found; start a new game.".to_string())?;
        let before = session.clone();
        if tag.is_some() {
            session.tag = tag;
        }
        if let Err(error) = apply_action(session, &action, body, &server.model_root) {
            *session = before;
            return Err(error);
        }
        if session.game.phase != Phase::Pegging {
            session.model911_hand_cache.clear();
        }
        if session.game.phase == Phase::GameOver
            && session.pending_final_scoring.is_none()
            && session.completed_at.is_none()
        {
            session.completed_at = Some(isoish_now());
        }
        let records_event = !matches!(
            action.as_str(),
            "state" | "prepare-ai-discard" | "master-hint"
        );
        if records_event {
            session.updated_at = isoish_now();
            session.event_sequence += 1;
            if let Err(error) = persist_session_event(&server.data_dir, session, &action, body) {
                *session = before;
                return Err(error);
            }
        } else if session.tag != before.tag {
            session.updated_at = isoish_now();
            if let Err(error) = persist_session_snapshot(&server.data_dir, session) {
                *session = before;
                return Err(error);
            }
        }
        if action == "continue-scoring" {
            if let Some(user) = authenticated_user {
                if let Some(profile) =
                    sync_dynamic_player_profile(&server.data_dir, user.id, session)?
                {
                    if let Some(dynamic) = session.dynamic.as_mut() {
                        dynamic.use_profile(profile, session.seed);
                        persist_session_snapshot(&server.data_dir, session)?;
                    }
                }
            }
        }
        let response = response_for_session(session)?;
        let recommendation_game = if action == "master-hint" {
            let kind = match session.game.phase {
                Phase::Discard => ReviewKind::Discard,
                Phase::Pegging => ReviewKind::Peg,
                _ => return Err("Ace advice is not available for this decision.".to_string()),
            };
            let decision_key = decision_analysis_key(kind, &session.game);
            let cached = session
                .prepared_decision_analyses
                .iter()
                .find(|analysis| {
                    analysis.decision_key == decision_key
                        && analysis.evaluator_model == DYNAMIC_EVALUATOR_VERSION
                })
                .cloned();
            Some(DeferredRecommendation::MasterHint {
                session_id: session.id.clone(),
                game: session.game.clone(),
                cached,
            })
        } else if matches!(
            action.as_str(),
            "prepare-cut-for-deal" | "prepare-ai-discard"
        ) && !session.waiting_for_deal_cut
            && session.game.phase == Phase::Discard
        {
            Some(DeferredRecommendation::AiDiscard(
                session.game.clone(),
                session.decision_model(),
            ))
        } else {
            None
        };
        Ok((response, recommendation_game))
    })();
    match result {
        Ok((response, Some(DeferredRecommendation::AiDiscard(game, model)))) => {
            match response_with_discard_recommendation(response, &game, model, &server.model_root) {
                Ok(json) => Response::json(200, json),
                Err(error) => {
                    Response::json(400, format!("{{\"error\":\"{}\"}}", json_escape(&error)))
                }
            }
        }
        Ok((
            response,
            Some(DeferredRecommendation::MasterHint {
                session_id,
                game,
                cached,
            }),
        )) => {
            let evaluated =
                evaluate_master_hint(&game, cached, &server.model_root).and_then(|hint| {
                    let response = if let Some(analysis) = hint.analysis.as_ref() {
                        store_prepared_decision_analysis(server, &session_id, analysis.clone())?
                    } else {
                        response
                    };
                    response_with_master_hint(response, &hint)
                });
            match evaluated {
                Ok(json) => Response::json(200, json),
                Err(error) => {
                    Response::json(400, format!("{{\"error\":\"{}\"}}", json_escape(&error)))
                }
            }
        }
        Ok((json, None)) => Response::json(200, json),
        Err(error) => Response::json(400, format!("{{\"error\":\"{}\"}}", json_escape(&error))),
    }
}

fn review_game(
    server: &Server,
    body: &str,
    authenticated_user: Option<&auth::AuthUser>,
) -> Response {
    let result = (|| -> Result<String, String> {
        let game_id =
            json_string(body, "gameId").ok_or_else(|| "Missing completed game id.".to_string())?;
        let requested_tag = json_string(body, "tag").filter(|value| !value.trim().is_empty());
        let pending = {
            let mut app = server
                .state
                .lock()
                .map_err(|_| "server state lock poisoned".to_string())?;
            if !app.sessions.contains_key(&game_id) {
                if let Some(session) = load_session_by_id(&server.data_dir, &game_id)? {
                    app.sessions.insert(game_id.clone(), session);
                }
            }
            let session = app
                .sessions
                .get(&game_id)
                .ok_or_else(|| "The saved game is not available for analysis.".to_string())?;
            if requested_tag
                .as_deref()
                .is_some_and(|tag| session.tag.as_deref() != Some(tag))
            {
                return Err("The saved game belongs to another player.".to_string());
            }
            session
                .decision_reviews
                .iter()
                .find(|review| saved_decision_analysis(review, DYNAMIC_EVALUATOR_VERSION).is_none())
                .cloned()
        };

        if let Some(pending) = pending {
            let completed = evaluate_saved_decision_review(&pending, &server.model_root)?;
            let mut app = server
                .state
                .lock()
                .map_err(|_| "server state lock poisoned".to_string())?;
            let session = app
                .sessions
                .get_mut(&game_id)
                .ok_or_else(|| "The saved game is no longer available.".to_string())?;
            let before = session.clone();
            if let Some(saved) = session.decision_reviews.iter_mut().find(|review| {
                review.id == pending.id
                    && saved_decision_analysis(review, DYNAMIC_EVALUATOR_VERSION).is_none()
            }) {
                save_completed_decision_analysis(saved, completed);
                session.updated_at = isoish_now();
                session.event_sequence += 1;
                if let Err(error) =
                    persist_session_event(&server.data_dir, session, "review-decision", body)
                {
                    *session = before;
                    return Err(error);
                }
            }
        }

        if let Some(user) = authenticated_user {
            let mut app = server
                .state
                .lock()
                .map_err(|_| "server state lock poisoned".to_string())?;
            let session = app
                .sessions
                .get_mut(&game_id)
                .ok_or_else(|| "The saved game is no longer available.".to_string())?;
            if let Some(profile) = sync_dynamic_player_profile(&server.data_dir, user.id, session)?
            {
                if let Some(dynamic) = session.dynamic.as_mut() {
                    dynamic.use_profile(profile, session.seed);
                    persist_session_snapshot(&server.data_dir, session)?;
                }
            }
        }

        let app = server
            .state
            .lock()
            .map_err(|_| "server state lock poisoned".to_string())?;
        response_for_session(
            app.sessions
                .get(&game_id)
                .ok_or_else(|| "The saved game is no longer available.".to_string())?,
        )
    })();
    match result {
        Ok(json) => Response::json(200, json),
        Err(error) => Response::json(400, format!("{{\"error\":\"{}\"}}", json_escape(&error))),
    }
}

fn new_session(model: ModelId, tag: Option<String>) -> Session {
    let counter = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    let seed = (unix_millis() as u32).wrapping_add((counter as u32).wrapping_mul(0x9e37_79b9));
    new_session_from_seed(model, tag, seed, counter)
}

fn new_session_from_seed(model: ModelId, tag: Option<String>, seed: u32, counter: u64) -> Session {
    let deal_cuts = deal_cuts_for_seed(seed);
    let first_deal =
        first_dealer_for_deal_cuts(deal_cuts).expect("deal-cut generator must resolve tied ranks");
    let game = CribbageGame::new_with_seed(seed, first_deal);
    let dynamic = (model == ModelId::Dynamic)
        .then(|| DynamicState::new(DynamicProfile::default(), seed, score_snapshot(&game)));
    Session {
        id: format!("rust-{:x}-{:x}", unix_millis(), counter),
        tag,
        model,
        seed,
        game,
        waiting_for_deal_cut: true,
        deal_cut_revealed: false,
        waiting_for_ai_discard: false,
        turn_card_revealed: false,
        deal_cuts,
        created_at: isoish_now(),
        updated_at: isoish_now(),
        completed_at: None,
        forfeited: false,
        decision_reviews: Vec::new(),
        prepared_decision_analyses: Vec::new(),
        help_events: Vec::new(),
        score_events: Vec::new(),
        next_review_id: 1,
        event_sequence: 0,
        pending_final_scoring: None,
        model911_hand_cache: Model911HandCache::new(),
        dynamic,
    }
}

fn game_database_path(data_dir: &Path) -> PathBuf {
    // This is the established production SQLite database.  The Rust API uses
    // namespaced tables so the older service's data is left untouched.
    data_dir.join("cribbage-server.sqlite")
}

fn open_game_database(data_dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|error| format!("create {}: {}", data_dir.display(), error))?;
    let connection = Connection::open(game_database_path(data_dir))
        .map_err(|error| format!("open game database: {}", error))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("configure game database timeout: {}", error))?;
    Ok(connection)
}

fn initialize_game_database(data_dir: &Path) -> Result<(), String> {
    let connection = open_game_database(data_dir)?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS cribbage_game_sessions (
               session_id TEXT PRIMARY KEY,
               tag TEXT,
               model TEXT NOT NULL,
               status TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               session_json TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS cribbage_game_sessions_active_tag
               ON cribbage_game_sessions(tag, status, updated_at DESC);
             CREATE TABLE IF NOT EXISTS cribbage_game_events (
               session_id TEXT NOT NULL,
               event_sequence INTEGER NOT NULL,
               occurred_at TEXT NOT NULL,
               action TEXT NOT NULL,
               request_json TEXT NOT NULL,
               game_json TEXT NOT NULL,
               public_state_json TEXT NOT NULL,
               PRIMARY KEY(session_id, event_sequence)
             );
             CREATE INDEX IF NOT EXISTS cribbage_game_events_by_time
               ON cribbage_game_events(occurred_at DESC);
             CREATE TABLE IF NOT EXISTS cribbage_completed_game_uploads (
               game_id TEXT PRIMARY KEY,
               received_at TEXT NOT NULL,
               payload_json TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS dynamic_player_profiles (
               user_id INTEGER NOT NULL,
               evaluator_version TEXT NOT NULL,
               profile_json TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               PRIMARY KEY(user_id, evaluator_version)
             );
             CREATE TABLE IF NOT EXISTS dynamic_profile_cycles (
               user_id INTEGER NOT NULL,
               evaluator_version TEXT NOT NULL,
               session_id TEXT NOT NULL,
               first_hand_number INTEGER NOT NULL,
               sample_json TEXT NOT NULL,
               applied_at TEXT NOT NULL,
               PRIMARY KEY(user_id, evaluator_version, session_id, first_hand_number)
             );
             CREATE TABLE IF NOT EXISTS dynamic_profile_games (
               user_id INTEGER NOT NULL,
               evaluator_version TEXT NOT NULL,
               session_id TEXT NOT NULL,
               sample_json TEXT NOT NULL,
               applied_at TEXT NOT NULL,
               PRIMARY KEY(user_id, evaluator_version, session_id)
             );",
        )
        .map_err(|error| format!("create game tables: {}", error))
}

fn persisted_session(session: &Session) -> PersistedSession {
    PersistedSession {
        version: 1,
        id: session.id.clone(),
        tag: session.tag.clone(),
        model: session.model.as_str().to_string(),
        seed: session.seed,
        game: session.game.clone(),
        waiting_for_deal_cut: session.waiting_for_deal_cut,
        deal_cut_revealed: session.deal_cut_revealed,
        waiting_for_ai_discard: session.waiting_for_ai_discard,
        turn_card_revealed: session.turn_card_revealed,
        deal_cuts: session.deal_cuts,
        created_at: session.created_at.clone(),
        updated_at: session.updated_at.clone(),
        completed_at: session.completed_at.clone(),
        forfeited: session.forfeited,
        decision_reviews: session.decision_reviews.clone(),
        prepared_decision_analyses: session.prepared_decision_analyses.clone(),
        help_events: session.help_events.clone(),
        score_events: session.score_events.clone(),
        next_review_id: session.next_review_id,
        event_sequence: session.event_sequence,
        pending_final_scoring: session.pending_final_scoring.clone(),
        dynamic: session.dynamic.clone(),
    }
}

fn restore_persisted_session(stored: PersistedSession) -> Result<Session, String> {
    if stored.version != 1 {
        return Err(format!("unsupported saved game version {}", stored.version));
    }
    let model = ModelId::from_str(&stored.model)?;
    let mut session = Session {
        id: stored.id,
        tag: stored.tag,
        model,
        seed: stored.seed,
        game: stored.game,
        waiting_for_deal_cut: stored.waiting_for_deal_cut,
        deal_cut_revealed: stored.deal_cut_revealed,
        waiting_for_ai_discard: stored.waiting_for_ai_discard,
        turn_card_revealed: stored.turn_card_revealed,
        deal_cuts: stored.deal_cuts,
        created_at: stored.created_at,
        updated_at: stored.updated_at,
        completed_at: stored.completed_at,
        forfeited: stored.forfeited,
        decision_reviews: stored.decision_reviews,
        prepared_decision_analyses: stored.prepared_decision_analyses,
        help_events: stored.help_events,
        score_events: stored.score_events,
        next_review_id: stored.next_review_id,
        event_sequence: stored.event_sequence,
        pending_final_scoring: stored.pending_final_scoring,
        model911_hand_cache: Model911HandCache::new(),
        dynamic: stored.dynamic,
    };
    if let Some(dynamic) = session.dynamic.as_mut() {
        dynamic.normalize_profile_version(session.seed);
    }
    Ok(session)
}

fn session_status(session: &Session) -> &'static str {
    if session.forfeited {
        "forfeited"
    } else if session.game.phase == Phase::GameOver && session.pending_final_scoring.is_none() {
        "complete"
    } else {
        "active"
    }
}

fn persist_session_snapshot(data_dir: &Path, session: &Session) -> Result<(), String> {
    let session_json = serde_json::to_string(&persisted_session(session))
        .map_err(|error| format!("serialize game session: {}", error))?;
    let connection = open_game_database(data_dir)?;
    connection
        .execute(
            "INSERT INTO cribbage_game_sessions
             (session_id, tag, model, status, created_at, updated_at, session_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(session_id) DO UPDATE SET
               tag = excluded.tag,
               model = excluded.model,
               status = excluded.status,
               updated_at = excluded.updated_at,
               session_json = excluded.session_json",
            params![
                session.id,
                session.tag,
                session.model.as_str(),
                session_status(session),
                session.created_at,
                session.updated_at,
                session_json,
            ],
        )
        .map_err(|error| format!("save game session: {}", error))?;
    Ok(())
}

fn action_request_json(action: &str, body: &str) -> String {
    let payload = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|request| request.get("payload").cloned())
        .unwrap_or(Value::Null);
    json!({
        "action": action,
        "payload": payload,
    })
    .to_string()
}

fn persist_session_event(
    data_dir: &Path,
    session: &Session,
    action: &str,
    body: &str,
) -> Result<(), String> {
    let session_json = serde_json::to_string(&persisted_session(session))
        .map_err(|error| format!("serialize game session: {}", error))?;
    let game_json = serde_json::to_string(&session.game)
        .map_err(|error| format!("serialize game state: {}", error))?;
    let public_state_json = game_state_json(session);
    let connection = open_game_database(data_dir)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("begin game event transaction: {}", error))?;
    transaction
        .execute(
            "INSERT INTO cribbage_game_sessions
             (session_id, tag, model, status, created_at, updated_at, session_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(session_id) DO UPDATE SET
               tag = excluded.tag,
               model = excluded.model,
               status = excluded.status,
               updated_at = excluded.updated_at,
               session_json = excluded.session_json",
            params![
                session.id,
                session.tag,
                session.model.as_str(),
                session_status(session),
                session.created_at,
                session.updated_at,
                session_json,
            ],
        )
        .map_err(|error| format!("save game session: {}", error))?;
    transaction
        .execute(
            "INSERT INTO cribbage_game_events
             (session_id, event_sequence, occurred_at, action, request_json, game_json, public_state_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                session.id,
                session.event_sequence,
                session.updated_at,
                action,
                action_request_json(action, body),
                game_json,
                public_state_json,
            ],
        )
        .map_err(|error| format!("save game event: {}", error))?;
    transaction
        .commit()
        .map_err(|error| format!("commit game event: {}", error))?;
    Ok(())
}

fn load_active_sessions(data_dir: &Path) -> Result<HashMap<String, Session>, String> {
    let connection = open_game_database(data_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT session_json FROM cribbage_game_sessions
             WHERE status = 'active' ORDER BY updated_at DESC",
        )
        .map_err(|error| format!("read active sessions: {}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("read active session rows: {}", error))?;
    let mut sessions = HashMap::new();
    for row in rows {
        let stored = row.map_err(|error| format!("read active session: {}", error))?;
        let saved: PersistedSession = serde_json::from_str(&stored)
            .map_err(|error| format!("parse saved game session: {}", error))?;
        let session = restore_persisted_session(saved)?;
        sessions.insert(session.id.clone(), session);
    }
    Ok(sessions)
}

fn load_session_by_id(data_dir: &Path, session_id: &str) -> Result<Option<Session>, String> {
    let connection = open_game_database(data_dir)?;
    let saved = connection
        .query_row(
            "SELECT session_json FROM cribbage_game_sessions WHERE session_id = ?1",
            [session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("find saved game session: {}", error))?;
    saved
        .map(|text| {
            let stored = serde_json::from_str::<PersistedSession>(&text)
                .map_err(|error| format!("parse saved game session: {}", error))?;
            restore_persisted_session(stored)
        })
        .transpose()
}

fn load_session_by_tag(
    data_dir: &Path,
    tag: &str,
    model: Option<ModelId>,
) -> Result<Option<Session>, String> {
    let connection = open_game_database(data_dir)?;
    let saved = match model {
        Some(model) => connection
            .query_row(
                "SELECT session_json FROM cribbage_game_sessions
             WHERE tag = ?1 AND model = ?2 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
                params![tag, model.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional(),
        None => connection
            .query_row(
                "SELECT session_json FROM cribbage_game_sessions
             WHERE tag = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
                [tag],
                |row| row.get::<_, String>(0),
            )
            .optional(),
    }
    .map_err(|error| format!("find saved game by tag: {}", error))?;
    saved
        .map(|text| {
            let stored = serde_json::from_str::<PersistedSession>(&text)
                .map_err(|error| format!("parse saved game session: {}", error))?;
            restore_persisted_session(stored)
        })
        .transpose()
}

fn load_dynamic_profile(data_dir: &Path, user_id: i64) -> Result<Option<DynamicProfile>, String> {
    let connection = open_game_database(data_dir)?;
    let saved = connection
        .query_row(
            "SELECT profile_json FROM dynamic_player_profiles
             WHERE user_id = ?1 AND evaluator_version = ?2",
            params![user_id, DYNAMIC_EVALUATOR_VERSION],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("find Dynamic player profile: {}", error))?;
    saved
        .map(|text| {
            let profile = serde_json::from_str::<DynamicProfile>(&text)
                .map_err(|error| format!("parse Dynamic player profile: {}", error))?;
            Ok(Some(profile.into_current()))
        })
        .transpose()
        .map(Option::flatten)
}

#[derive(Clone, Copy, Default)]
struct RegretAccumulator {
    sum: f64,
    count: u32,
}

impl RegretAccumulator {
    fn add(&mut self, regret: f64) {
        self.sum += regret;
        self.count += 1;
    }

    fn mean(self) -> Option<f64> {
        (self.count > 0).then(|| self.sum / f64::from(self.count))
    }
}

#[derive(Default)]
struct CycleRegretAccumulators {
    dealer_discard: RegretAccumulator,
    dealer_pegging: RegretAccumulator,
    pone_discard: RegretAccumulator,
    pone_pegging: RegretAccumulator,
}

impl CycleRegretAccumulators {
    fn add(&mut self, kind: ReviewKind, dealer: bool, regret: f64) {
        match (dealer, kind) {
            (true, ReviewKind::Discard) => self.dealer_discard.add(regret),
            (true, ReviewKind::Peg) => self.dealer_pegging.add(regret),
            (false, ReviewKind::Discard) => self.pone_discard.add(regret),
            (false, ReviewKind::Peg) => self.pone_pegging.add(regret),
        }
    }

    fn sample(self, total_regret: f64) -> Option<DynamicCycleSample> {
        Some(DynamicCycleSample {
            dealer_discard_regret: self.dealer_discard.mean()?,
            dealer_pegging_regret: self.dealer_pegging.mean()?,
            pone_discard_regret: self.pone_discard.mean()?,
            pone_pegging_regret: self.pone_pegging.mean()?,
            total_regret,
        })
    }
}

fn reviewed_decision_regret(review: &SavedDecisionReview) -> Option<f64> {
    if review.kind == ReviewKind::Peg {
        if review.game.legal_cards(HUMAN).len() <= 1 {
            return None;
        }
        let selected = *review.selected_card_ids.first()?;
        let mut result = review.game.clone();
        result.play_card(HUMAN, selected).ok()?;
        if result.phase == Phase::GameOver {
            return None;
        }
    }

    let completed = saved_decision_analysis(review, DYNAMIC_EVALUATOR_VERSION)?;
    let selected = completed.selected_win_probability?;
    let recommended = completed.recommended_win_probability?;
    if !selected.is_finite()
        || !recommended.is_finite()
        || !(0.0..=1.0).contains(&selected)
        || !(0.0..=1.0).contains(&recommended)
        || recommended + f64::EPSILON < selected
    {
        return None;
    }
    Some(recommended - selected)
}

#[derive(Clone, Copy, Debug)]
struct EligibleDynamicCycle {
    first_hand: u32,
    strength_sample: DynamicCycleSample,
}

/// Collect only fully scored, fully reviewed two-hand cycles. Model evaluation
/// happens when each choice is saved; this aggregation is deliberately cheap.
fn eligible_dynamic_cycle_samples(session: &Session) -> Vec<EligibleDynamicCycle> {
    let completed_hands = session
        .score_events
        .iter()
        .filter(|event| event.category == SavedScoreCategory::Crib)
        .map(|event| event.hand_number)
        .collect::<HashSet<_>>();
    let mut samples = Vec::new();

    for first_hand in (1..=session.game.hand_number).step_by(2) {
        let second_hand = first_hand + 1;
        if !completed_hands.contains(&first_hand) || !completed_hands.contains(&second_hand) {
            continue;
        }
        if session
            .help_events
            .iter()
            .any(|event| event.hand_number == first_hand || event.hand_number == second_hand)
        {
            continue;
        }
        let reviews = session
            .decision_reviews
            .iter()
            .filter(|review| {
                review.game.hand_number == first_hand || review.game.hand_number == second_hand
            })
            .collect::<Vec<_>>();
        if reviews.is_empty()
            || reviews
                .iter()
                .any(|review| saved_decision_analysis(review, DYNAMIC_EVALUATOR_VERSION).is_none())
        {
            continue;
        }

        let mut buckets = CycleRegretAccumulators::default();
        let mut total_regret = 0.0;
        for review in reviews {
            if let Some(regret) = reviewed_decision_regret(review) {
                buckets.add(review.kind, review.game.dealer == HUMAN, regret);
                total_regret += regret;
            }
        }
        if let Some(sample) = buckets.sample(total_regret) {
            samples.push(EligibleDynamicCycle {
                first_hand,
                strength_sample: sample,
            });
        }
    }
    samples
}

fn eligible_dynamic_game_length(session: &Session) -> Option<f64> {
    (session.game.phase == Phase::GameOver
        && session.pending_final_scoring.is_none()
        && !session.forfeited)
        .then(|| f64::from(session.game.hand_number) / 2.0)
}

fn sync_dynamic_player_profile(
    data_dir: &Path,
    user_id: i64,
    session: &Session,
) -> Result<Option<DynamicProfile>, String> {
    let samples = eligible_dynamic_cycle_samples(session);
    let game_length = eligible_dynamic_game_length(session);
    let mut connection = open_game_database(data_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("begin Dynamic profile transaction: {}", error))?;
    let saved = transaction
        .query_row(
            "SELECT profile_json FROM dynamic_player_profiles
             WHERE user_id = ?1 AND evaluator_version = ?2",
            params![user_id, DYNAMIC_EVALUATOR_VERSION],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("read Dynamic player profile: {}", error))?;
    let parsed = saved
        .map(|text| {
            serde_json::from_str::<DynamicProfile>(&text)
                .map_err(|error| format!("parse Dynamic player profile: {}", error))
        })
        .transpose()?;
    let needs_initial_save = parsed
        .as_ref()
        .map(|profile| !profile.is_current())
        .unwrap_or(true);
    let mut profile = parsed.map(DynamicProfile::into_current).unwrap_or_default();
    let mut changed = false;
    if session.model == ModelId::Dynamic && !profile.started_dynamic {
        profile.started_dynamic = true;
        changed = true;
    }

    for cycle in samples {
        let first_hand = cycle.first_hand;
        let sample = cycle.strength_sample;
        let sample_json = serde_json::to_string(&sample)
            .map_err(|error| format!("serialize Dynamic cycle sample: {}", error))?;
        let inserted = transaction
            .execute(
                "INSERT OR IGNORE INTO dynamic_profile_cycles
                 (user_id, evaluator_version, session_id, first_hand_number, sample_json, applied_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    user_id,
                    DYNAMIC_EVALUATOR_VERSION,
                    session.id,
                    first_hand,
                    sample_json,
                    isoish_now(),
                ],
            )
            .map_err(|error| format!("save Dynamic cycle sample: {}", error))?;
        if inserted > 0 {
            profile.observe_cycle(sample);
            changed = true;
        }
    }

    if let Some(cycles_per_game) = game_length {
        let sample_json = json!({"cyclesPerGame": cycles_per_game}).to_string();
        let inserted = transaction
            .execute(
                "INSERT OR IGNORE INTO dynamic_profile_games
                 (user_id, evaluator_version, session_id, sample_json, applied_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    user_id,
                    DYNAMIC_EVALUATOR_VERSION,
                    session.id,
                    sample_json,
                    isoish_now(),
                ],
            )
            .map_err(|error| format!("save Dynamic game length: {}", error))?;
        if inserted > 0 {
            profile.observe_game_length(cycles_per_game);
            changed = true;
        }
    }

    if changed || needs_initial_save {
        let profile_json = serde_json::to_string(&profile)
            .map_err(|error| format!("serialize Dynamic player profile: {}", error))?;
        transaction
            .execute(
                "INSERT INTO dynamic_player_profiles
                 (user_id, evaluator_version, profile_json, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(user_id, evaluator_version) DO UPDATE SET
                   profile_json = excluded.profile_json,
                   updated_at = excluded.updated_at",
                params![
                    user_id,
                    DYNAMIC_EVALUATOR_VERSION,
                    profile_json,
                    isoish_now()
                ],
            )
            .map_err(|error| format!("save Dynamic player profile: {}", error))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("commit Dynamic player profile: {}", error))?;
    Ok((changed || needs_initial_save).then_some(profile))
}

fn persist_completed_game_upload(data_dir: &Path, game_id: &str, body: &str) -> Result<(), String> {
    let connection = open_game_database(data_dir)?;
    connection
        .execute(
            "INSERT INTO cribbage_completed_game_uploads (game_id, received_at, payload_json)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(game_id) DO UPDATE SET
               received_at = excluded.received_at,
               payload_json = excluded.payload_json",
            params![game_id, isoish_now(), body],
        )
        .map_err(|error| format!("save completed game upload: {}", error))?;
    Ok(())
}

fn scoring_totals_from_upload(body: &str) -> (ScoringTotals, ScoringTotals) {
    let Ok(payload) = serde_json::from_str::<Value>(body) else {
        return (ScoringTotals::default(), ScoringTotals::default());
    };
    let Some(events) = payload.get("events").and_then(Value::as_array) else {
        return (ScoringTotals::default(), ScoringTotals::default());
    };
    let mut human = ScoringTotals::default();
    let mut ai = ScoringTotals::default();
    let mut human_opportunities = HashSet::new();
    let mut ai_opportunities = HashSet::new();
    for event in events {
        if event.get("type").and_then(Value::as_str) != Some("score") {
            continue;
        }
        let Some(player) = event.get("player").and_then(Value::as_str) else {
            continue;
        };
        let Some(category) = event.get("category").and_then(Value::as_str) else {
            continue;
        };
        let role = event.get("role").and_then(Value::as_str).unwrap_or("");
        let Some(key) = scoring_key(category, role) else {
            continue;
        };
        let hand_number = event.get("handNumber").and_then(Value::as_u64).unwrap_or(0);
        let points = event
            .get("points")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
        match player {
            "human" => {
                add_scoring_points(&mut human, key, points);
                human_opportunities.insert((hand_number, key));
            }
            "ai" => {
                add_scoring_points(&mut ai, key, points);
                ai_opportunities.insert((hand_number, key));
            }
            _ => {}
        }
    }
    apply_scoring_opportunities(&mut human, &human_opportunities);
    apply_scoring_opportunities(&mut ai, &ai_opportunities);
    (human, ai)
}

fn decision_errors_from_upload(body: &str) -> (bool, i32) {
    let Ok(payload) = serde_json::from_str::<Value>(body) else {
        return (false, 0);
    };
    let Some(events) = payload.get("events").and_then(Value::as_array) else {
        return (false, 0);
    };
    let mut analyzed = false;
    let mut errors = 0;
    for event in events {
        let Some(review) = event.get("review") else {
            continue;
        };
        let user_decision = event.get("player").and_then(Value::as_str) == Some("human")
            && (event.get("type").and_then(Value::as_str) == Some("discard")
                || (event.get("type").and_then(Value::as_str) == Some("pegging")
                    && event.get("action").and_then(Value::as_str) == Some("play")));
        if !user_decision {
            continue;
        }
        analyzed = true;
        let selected = review.get("selected").and_then(Value::as_array);
        let recommended = review.get("recommended").and_then(Value::as_array);
        let same_choice = selected
            .zip(recommended)
            .is_some_and(|(selected, recommended)| {
                let mut selected = selected
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>();
                let mut recommended = recommended
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>();
                selected.sort_unstable();
                recommended.sort_unstable();
                selected == recommended
            });
        let impact = review
            .get("winProbabilityDelta")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        if !same_choice && impact >= 0.0025 {
            errors += 1;
        }
    }
    (analyzed, errors)
}

fn scoring_key(category: &str, role: &str) -> Option<u8> {
    match (category, role) {
        ("pegging", "dealer") => Some(0),
        ("pegging", "pone") => Some(1),
        ("hand", "dealer") => Some(2),
        ("hand", "pone") => Some(3),
        ("crib", _) => Some(4),
        _ => None,
    }
}

fn add_scoring_points(totals: &mut ScoringTotals, key: u8, points: i32) {
    match key {
        0 => totals.pegging_dealer += points,
        1 => totals.pegging_pone += points,
        2 => totals.hand_dealer += points,
        3 => totals.hand_pone += points,
        4 => totals.crib += points,
        _ => {}
    }
}

fn apply_scoring_opportunities(totals: &mut ScoringTotals, seen: &HashSet<(u64, u8)>) {
    let count = |key| {
        seen.iter()
            .filter(|(_, candidate)| *candidate == key)
            .count() as i32
    };
    totals.pegging_dealer_hands = count(0);
    totals.pegging_pone_hands = count(1);
    totals.hand_dealer_hands = count(2);
    totals.hand_pone_hands = count(3);
    totals.crib_hands = count(4);
}

fn hydrate_upload_scoring(
    data_dir: &Path,
    uploads: &mut HashMap<String, UploadedGame>,
) -> Result<(), String> {
    if uploads.is_empty() {
        return Ok(());
    }
    let connection = open_game_database(data_dir)?;
    let mut statement = connection
        .prepare("SELECT game_id, payload_json FROM cribbage_completed_game_uploads")
        .map_err(|error| format!("read completed game scoring: {}", error))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("read completed game scoring rows: {}", error))?;
    for row in rows {
        let (game_id, payload) =
            row.map_err(|error| format!("read completed game scoring: {}", error))?;
        if let Some(upload) = uploads.get_mut(&game_id) {
            let (human, ai) = scoring_totals_from_upload(&payload);
            upload.human_scoring = human;
            upload.ai_scoring = ai;
            let (analyzed, errors) = decision_errors_from_upload(&payload);
            upload.analyzed = analyzed;
            upload.errors = errors;
        }
    }
    Ok(())
}

/// Simulate the initial cut from a shuffled deck.  A tied pair is discarded
/// and both players cut again, so every presented result has a definite lower
/// rank and the cards are always distinct.
fn deal_cuts_for_seed(seed: u32) -> [Card; 2] {
    let mut cut_rng = seed ^ 0xa5a5_5a5a;
    loop {
        let mut deck = full_deck();
        for index in (1..deck.len()).rev() {
            cut_rng = cut_rng.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let swap_index = ((u64::from(cut_rng) * (index as u64 + 1)) >> 32) as usize;
            deck.swap(index, swap_index);
        }
        if let Some(cuts) = first_non_tied_deal_cuts(&deck) {
            return cuts;
        }
    }
}

fn first_non_tied_deal_cuts(deck: &[Card]) -> Option<[Card; 2]> {
    deck.chunks_exact(2)
        .find(|pair| pair[0].rank != pair[1].rank)
        .map(|pair| [pair[0], pair[1]])
}

fn first_dealer_for_deal_cuts(deal_cuts: [Card; 2]) -> Option<Side> {
    match deal_cuts[0].rank.cmp(&deal_cuts[1].rank) {
        std::cmp::Ordering::Less => Some(HUMAN),
        std::cmp::Ordering::Greater => Some(AI),
        std::cmp::Ordering::Equal => None,
    }
}

fn apply_action(
    session: &mut Session,
    action: &str,
    body: &str,
    model_root: &str,
) -> Result<(), String> {
    match action {
        "state" => Ok(()),
        "trouble-game" => {
            Err("The legacy trouble-game fixture was retired with the Node engine.".to_string())
        }
        "cut-for-deal" | "prepare-cut-for-deal" => {
            if !session.waiting_for_deal_cut {
                // The browser prefetches this transition before the cut
                // animation completes. A subsequent click must therefore be
                // safe to retry against the same server-authoritative game.
                return Ok(());
            }
            session.waiting_for_deal_cut = false;
            session.deal_cut_revealed = true;
            Ok(())
        }
        "prepare-ai-discard" => Ok(()),
        "master-hint" => {
            if session.model == ModelId::Schell13 {
                return Err("Ace is already your opponent.".to_string());
            }
            match session.game.phase {
                Phase::Discard
                    if !session.waiting_for_deal_cut && !session.waiting_for_ai_discard =>
                {
                    Ok(())
                }
                Phase::Pegging
                    if !session.game.pegging_reset_pending
                        && session.game.current_player() == HUMAN =>
                {
                    Ok(())
                }
                _ => Err("Ace advice is not available for this decision.".to_string()),
            }
        }
        "record-help" => {
            let decision_key = json_string(body, "decisionKey")
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Missing Ace help decision key.".to_string())?;
            if !session
                .help_events
                .iter()
                .any(|event| event.decision_key == decision_key)
            {
                session.help_events.push(SavedHelpEvent {
                    id: format!("{}-help-{}", session.id, session.help_events.len() + 1),
                    at: isoish_now(),
                    hand_number: session.game.hand_number,
                    decision_key: decision_key.chars().take(180).collect(),
                });
            }
            Ok(())
        }
        "forfeit" => {
            if session.model != ModelId::Schell13 {
                return Err("Only an Ace game can be forfeited here.".to_string());
            }
            session.forfeited = true;
            session.completed_at = Some(isoish_now());
            Ok(())
        }
        "prepare-next-hand-ai-discard" => {
            Err("The next hand must begin with an explicit scoring acknowledgement.".to_string())
        }
        "discard" => {
            require_phase(session, Phase::Discard)?;
            if session.waiting_for_deal_cut || session.waiting_for_ai_discard {
                return Err("It is not time for the user discard.".to_string());
            }
            let ids = json_number_array(body, "ids");
            if ids.len() != 2 {
                return Err("Select exactly two cards to discard.".to_string());
            }
            let review_game = session.game.clone();
            session.game.discard(HUMAN, [ids[0] as u8, ids[1] as u8])?;
            queue_decision_review(
                session,
                ReviewKind::Discard,
                review_game,
                vec![ids[0] as u8, ids[1] as u8],
            );
            session.waiting_for_ai_discard = true;
            Ok(())
        }
        "finish-discard" | "finish-discard-with-cards" => {
            if !session.waiting_for_ai_discard {
                return Ok(());
            }
            let score_before = score_snapshot(&session.game);
            let supplied = json_number_array(body, "ids");
            let ids = if supplied.len() == 2 {
                [supplied[0] as u8, supplied[1] as u8]
            } else {
                let decision = recommend_discard_for_side(
                    &session.game,
                    AI,
                    session.decision_model(),
                    model_root,
                )?;
                if decision.card_ids.len() != 2 {
                    return Err("Rust AI discard did not select two cards.".to_string());
                }
                [decision.card_ids[0], decision.card_ids[1]]
            };
            session.game.discard(AI, ids)?;
            session.waiting_for_ai_discard = false;
            let turn_card = session.game.turn_card;
            ensure_score_opportunity(
                session,
                SavedScoreCategory::Pegging,
                HUMAN,
                Vec::new(),
                Some(turn_card),
                None,
            );
            ensure_score_opportunity(
                session,
                SavedScoreCategory::Pegging,
                AI,
                Vec::new(),
                Some(turn_card),
                None,
            );
            record_score_changes(
                session,
                score_before,
                SavedScoreCategory::Pegging,
                "Heels",
                Vec::new(),
                Some(turn_card),
                None,
                None,
            );
            Ok(())
        }
        "reveal-turn-card" => {
            if session.waiting_for_deal_cut || session.waiting_for_ai_discard {
                return Err("It is not time to reveal the turn card.".to_string());
            }
            match session.game.phase {
                Phase::Pegging | Phase::GameOver => {
                    session.turn_card_revealed = true;
                    Ok(())
                }
                _ => Err("It is not time to reveal the turn card.".to_string()),
            }
        }
        "play" | "play-human" => {
            require_phase(session, Phase::Pegging)?;
            let id = json_number(body, "id").ok_or_else(|| "Missing card id.".to_string())? as u8;
            let review_game = session.game.clone();
            let score_before = score_snapshot(&session.game);
            session.game.play_card(HUMAN, id)?;
            let score_components = score_count_components(&session.game.plays);
            record_score_changes(
                session,
                score_before,
                SavedScoreCategory::Pegging,
                "Pegging play",
                Card::new(id).ok().into_iter().collect(),
                Some(session.game.turn_card),
                Some(session.game.count),
                Some(score_components),
            );
            queue_decision_review(session, ReviewKind::Peg, review_game, vec![id]);
            Ok(())
        }
        "go" | "go-human" => {
            require_phase(session, Phase::Pegging)?;
            let score_before = score_snapshot(&session.game);
            session.game.say_go(HUMAN)?;
            record_score_changes(
                session,
                score_before,
                SavedScoreCategory::Pegging,
                "Go",
                Vec::new(),
                Some(session.game.turn_card),
                Some(session.game.count),
                None,
            );
            Ok(())
        }
        "advance-pegging" => {
            require_phase(session, Phase::Pegging)?;
            if session.game.pegging_reset_pending || session.game.current_player() != AI {
                return Ok(());
            }
            let score_before = score_snapshot(&session.game);
            let decision_model = session.decision_model();
            let (reason, cards, score_components) =
                match recommend_peg_for_side_with_model911_cache(
                    &session.game,
                    AI,
                    decision_model,
                    None,
                    model_root,
                    Some(&session.model911_hand_cache),
                )? {
                    PegDecision::Go => {
                        session.game.say_go(AI)?;
                        ("Go", Vec::new(), None)
                    }
                    PegDecision::Play { card_id, .. } => {
                        session.game.play_card(AI, card_id)?;
                        (
                            "Pegging play",
                            Card::new(card_id).ok().into_iter().collect(),
                            Some(score_count_components(&session.game.plays)),
                        )
                    }
                };
            record_score_changes(
                session,
                score_before,
                SavedScoreCategory::Pegging,
                reason,
                cards,
                Some(session.game.turn_card),
                Some(session.game.count),
                score_components,
            );
            Ok(())
        }
        "acknowledge-pegging-reset" => {
            session.game.acknowledge_pegging_reset();
            Ok(())
        }
        "continue-scoring" => {
            if session.pending_final_scoring.is_some() {
                // The final scoring review is intentionally acknowledged on
                // its own click.  This lets the player see the hand or crib
                // that crossed 121 before the winner view replaces it.
                session.pending_final_scoring = None;
                return Ok(());
            }
            let hand_number = session.game.hand_number;
            let completed_hand_dealer =
                (session.game.phase == Phase::ScoreDealer).then_some(session.game.dealer);
            let score_before = score_snapshot(&session.game);
            let score_stage = match session.game.phase {
                Phase::PeggingComplete => Some((
                    SavedScoreCategory::Hand,
                    session.game.pone,
                    session.game.player(session.game.pone).table.clone(),
                    "Hand",
                )),
                Phase::ScorePone => Some((
                    SavedScoreCategory::Hand,
                    session.game.dealer,
                    session.game.player(session.game.dealer).table.clone(),
                    "Hand",
                )),
                Phase::ScoreDealer => Some((
                    SavedScoreCategory::Crib,
                    session.game.dealer,
                    session.game.player(session.game.dealer).crib.clone(),
                    "Crib",
                )),
                _ => None,
            };
            if let Some((category, player, cards, _)) = &score_stage {
                ensure_score_opportunity(
                    session,
                    *category,
                    *player,
                    cards.clone(),
                    Some(session.game.turn_card),
                    None,
                );
            }
            let final_stage = match session.game.phase {
                Phase::PeggingComplete => {
                    session.game.start_scoring()?;
                    Some(FinalScoringStage::Pone)
                }
                Phase::ScorePone => {
                    session.game.continue_scoring()?;
                    Some(FinalScoringStage::Dealer)
                }
                Phase::ScoreDealer => {
                    session.game.continue_scoring()?;
                    Some(FinalScoringStage::Crib)
                }
                _ => {
                    session.game.continue_scoring()?;
                    None
                }
            };
            if let Some((category, _, cards, reason)) = score_stage {
                record_score_changes(
                    session,
                    score_before,
                    category,
                    reason,
                    cards,
                    Some(session.game.turn_card),
                    None,
                    None,
                );
            }
            if let (Some(dealer), Some(dynamic)) = (completed_hand_dealer, session.dynamic.as_mut())
            {
                dynamic.complete_hand(dealer, score_snapshot(&session.game), session.seed);
            }
            if session.game.phase == Phase::GameOver {
                session.pending_final_scoring = final_stage.map(|stage| FinalScoring { stage });
            }
            if session.game.hand_number != hand_number {
                session.turn_card_revealed = false;
            }
            Ok(())
        }
        "complete-decision-reviews" => complete_decision_reviews(
            session,
            json_number(body, "limit")
                .map(|value| (value as usize).max(1))
                .unwrap_or(usize::MAX),
            model_root,
        ),
        other => Err(format!("Unknown game action: {}", other)),
    }
}

fn queue_decision_review(
    session: &mut Session,
    kind: ReviewKind,
    game: CribbageGame,
    selected_card_ids: Vec<u8>,
) {
    let id = format!("{}-review-{}", session.id, session.next_review_id);
    session.next_review_id += 1;
    let decision_key = decision_analysis_key(kind, &game);
    let prepared_analysis = session
        .prepared_decision_analyses
        .iter()
        .position(|analysis| {
            analysis.decision_key == decision_key
                && analysis.evaluator_model == DYNAMIC_EVALUATOR_VERSION
        })
        .map(|index| session.prepared_decision_analyses.remove(index));
    let completed = prepared_analysis.as_ref().and_then(|analysis| {
        same_card_selection(&selected_card_ids, &analysis.recommended.card_ids).then(|| {
            completed_review_from_saved_values(
                &analysis.evaluator_model,
                analysis.recommended.clone(),
                analysis.recommended.clone(),
            )
        })
    });
    let prepared_analysis = if completed.is_some() {
        None
    } else {
        prepared_analysis
    };
    session.decision_reviews.push(SavedDecisionReview {
        id,
        at: isoish_now(),
        kind,
        game,
        selected_card_ids,
        completed,
        prior_analyses: Vec::new(),
        prepared_analysis,
    });
}

fn default_analysis_model() -> String {
    DYNAMIC_EVALUATOR_VERSION.to_string()
}

fn saved_decision_analysis<'a>(
    review: &'a SavedDecisionReview,
    evaluator_model: &str,
) -> Option<&'a CompletedDecisionReview> {
    review
        .completed
        .as_ref()
        .filter(|analysis| analysis.evaluator_model == evaluator_model)
        .or_else(|| {
            review
                .prior_analyses
                .iter()
                .find(|analysis| analysis.evaluator_model == evaluator_model)
        })
}

fn save_completed_decision_analysis(
    review: &mut SavedDecisionReview,
    completed: CompletedDecisionReview,
) {
    review.prepared_analysis = None;
    if let Some(index) = review
        .prior_analyses
        .iter()
        .position(|analysis| analysis.evaluator_model == completed.evaluator_model)
    {
        review.prior_analyses.remove(index);
    }
    if let Some(previous) = review.completed.replace(completed) {
        if previous.evaluator_model
            != review
                .completed
                .as_ref()
                .expect("completed analysis was just stored")
                .evaluator_model
        {
            review.prior_analyses.push(previous);
        }
    }
}

fn same_card_selection(left: &[u8], right: &[u8]) -> bool {
    let mut left = left.to_vec();
    let mut right = right.to_vec();
    left.sort_unstable();
    right.sort_unstable();
    left == right
}

fn decision_analysis_key(kind: ReviewKind, game: &CribbageGame) -> String {
    let kind = match kind {
        ReviewKind::Discard => "discard",
        ReviewKind::Peg => "peg",
    };
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    if let Ok(encoded) = serde_json::to_vec(game) {
        for byte in encoded {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    format!("{kind}:{hash:016x}")
}

fn score_category_label(category: SavedScoreCategory) -> &'static str {
    match category {
        SavedScoreCategory::Pegging => "pegging",
        SavedScoreCategory::Hand => "hand",
        SavedScoreCategory::Crib => "crib",
    }
}

fn score_snapshot(game: &CribbageGame) -> [i32; 2] {
    [game.player(HUMAN).score, game.player(AI).score]
}

fn ensure_score_opportunity(
    session: &mut Session,
    category: SavedScoreCategory,
    player: Side,
    cards: Vec<Card>,
    turn_card: Option<Card>,
    count: Option<u8>,
) {
    if session.score_events.iter().any(|event| {
        event.hand_number == session.game.hand_number
            && event.category == category
            && event.player == player
    }) {
        return;
    }
    let scores = score_snapshot(&session.game);
    let event_number = session.score_events.len() + 1;
    session.score_events.push(SavedScoreEvent {
        id: format!("{}-score-{}", session.id, event_number),
        at: isoish_now(),
        hand_number: session.game.hand_number,
        player,
        dealer: session.game.dealer,
        category,
        points: 0,
        reason: score_category_label(category).to_string(),
        total_score: session.game.player(player).score,
        scores,
        cards,
        turn_card,
        count,
        score_components: None,
    });
}

fn record_score_changes(
    session: &mut Session,
    before: [i32; 2],
    category: SavedScoreCategory,
    reason: &str,
    cards: Vec<Card>,
    turn_card: Option<Card>,
    count: Option<u8>,
    score_components: Option<PeggingScoreComponents>,
) {
    let scores = score_snapshot(&session.game);
    for player in [HUMAN, AI] {
        let points = scores[player.index()] - before[player.index()];
        if points <= 0 {
            continue;
        }
        let event_number = session.score_events.len() + 1;
        let mut event_score_components = score_components;
        if let Some(components) = event_score_components.as_mut() {
            components.last_card = u8::try_from(points)
                .unwrap_or_default()
                .saturating_sub(components.total());
        }
        session.score_events.push(SavedScoreEvent {
            id: format!("{}-score-{}", session.id, event_number),
            at: isoish_now(),
            hand_number: session.game.hand_number,
            player,
            dealer: session.game.dealer,
            category,
            points,
            reason: reason.to_string(),
            total_score: scores[player.index()],
            scores,
            cards: cards.clone(),
            turn_card,
            count,
            score_components: event_score_components,
        });
    }
}

fn complete_decision_reviews(
    session: &mut Session,
    limit: usize,
    model_root: &str,
) -> Result<(), String> {
    if session.game.phase != Phase::GameOver || session.pending_final_scoring.is_some() {
        return Err("Decision review is available after the game ends.".to_string());
    }
    let mut completed = 0;
    for pending in &mut session.decision_reviews {
        if completed >= limit
            || saved_decision_analysis(pending, DYNAMIC_EVALUATOR_VERSION).is_some()
        {
            continue;
        }
        let analysis = evaluate_saved_decision_review(pending, model_root)?;
        save_completed_decision_analysis(pending, analysis);
        completed += 1;
    }
    Ok(())
}

fn evaluate_saved_decision_review(
    pending: &SavedDecisionReview,
    model_root: &str,
) -> Result<CompletedDecisionReview, String> {
    let prepared = pending
        .prepared_analysis
        .as_ref()
        .filter(|analysis| analysis.evaluator_model == DYNAMIC_EVALUATOR_VERSION)
        .map(|analysis| ReviewedDecisionValue {
            card_ids: analysis.recommended.card_ids.clone(),
            ev: analysis.recommended.ev,
            win_probability: analysis.recommended.win_probability,
        });
    let review = match pending.kind {
        ReviewKind::Discard => {
            if pending.selected_card_ids.len() != 2 {
                return Err("saved discard review is malformed".to_string());
            }
            review_discard_for_side_with_recommendation(
                &pending.game,
                HUMAN,
                ModelId::Schell13,
                [pending.selected_card_ids[0], pending.selected_card_ids[1]],
                prepared,
                model_root,
            )?
        }
        ReviewKind::Peg => {
            let Some(selected) = pending.selected_card_ids.first().copied() else {
                return Err("saved pegging review is malformed".to_string());
            };
            review_peg_for_side_with_recommendation(
                &pending.game,
                HUMAN,
                ModelId::Schell13,
                selected,
                prepared,
                model_root,
            )?
        }
    };
    Ok(completed_review(review))
}

fn completed_review(review: EngineDecisionReview) -> CompletedDecisionReview {
    CompletedDecisionReview {
        evaluator_model: DYNAMIC_EVALUATOR_VERSION.to_string(),
        selected_card_ids: review.selected.card_ids,
        recommended_card_ids: review.recommended.card_ids,
        selected_ev: review.selected.ev.unwrap_or(0.0),
        recommended_ev: review.recommended.ev.unwrap_or(0.0),
        selected_win_probability: review.selected.win_probability,
        recommended_win_probability: review.recommended.win_probability,
    }
}

fn completed_review_from_saved_values(
    evaluator_model: &str,
    selected: SavedDecisionValue,
    recommended: SavedDecisionValue,
) -> CompletedDecisionReview {
    CompletedDecisionReview {
        evaluator_model: evaluator_model.to_string(),
        selected_card_ids: selected.card_ids,
        recommended_card_ids: recommended.card_ids,
        selected_ev: selected.ev.unwrap_or(0.0),
        recommended_ev: recommended.ev.unwrap_or(0.0),
        selected_win_probability: selected.win_probability,
        recommended_win_probability: recommended.win_probability,
    }
}

fn require_phase(session: &Session, phase: Phase) -> Result<(), String> {
    if session.game.phase == phase {
        Ok(())
    } else {
        Err("That action is not available in the current game phase.".to_string())
    }
}

fn response_for_session(session: &Session) -> Result<String, String> {
    let mut response = String::new();
    write!(
        response,
        "{{\"state\":{},\"snapshot\":{}",
        game_state_json(session),
        snapshot_json(session),
    )
    .map_err(|error| error.to_string())?;
    response.push('}');
    Ok(response)
}

fn response_with_discard_recommendation(
    mut response: String,
    game: &CribbageGame,
    model: ModelId,
    model_root: &str,
) -> Result<String, String> {
    let decision = recommend_discard_for_side(game, AI, model, model_root)?;
    let Some(body) = response.strip_suffix('}').map(str::to_string) else {
        return Err("could not append Rust discard recommendation".to_string());
    };
    response = body;
    write!(
        response,
        ",\"recommendation\":{{\"cardIds\":{},\"bestLead\":{}}}}}",
        number_array_json(&decision.card_ids),
        option_u8_json(decision.best_lead),
    )
    .map_err(|error| error.to_string())?;
    Ok(response)
}

struct MasterHintEvaluation {
    kind: &'static str,
    card_ids: Vec<u8>,
    analysis: Option<PreparedDecisionAnalysis>,
}

fn evaluate_master_hint(
    game: &CribbageGame,
    cached: Option<PreparedDecisionAnalysis>,
    model_root: &str,
) -> Result<MasterHintEvaluation, String> {
    if let Some(analysis) = cached {
        let kind = match analysis.kind {
            ReviewKind::Discard => "discard",
            ReviewKind::Peg => "play",
        };
        return Ok(MasterHintEvaluation {
            kind,
            card_ids: analysis.recommended.card_ids.clone(),
            analysis: Some(analysis),
        });
    }

    let (kind, review_kind, recommended) = match game.phase {
        Phase::Discard => {
            let decision = recommend_discard_for_side(game, HUMAN, ModelId::Schell13, model_root)?;
            (
                "discard",
                ReviewKind::Discard,
                Some(SavedDecisionValue {
                    card_ids: decision.card_ids,
                    ev: decision.ev,
                    win_probability: decision.win_probability,
                }),
            )
        }
        Phase::Pegging => {
            match recommend_peg_for_side(game, HUMAN, ModelId::Schell13, None, model_root)? {
                PegDecision::Play {
                    card_id,
                    ev,
                    win_probability,
                } => (
                    "play",
                    ReviewKind::Peg,
                    Some(SavedDecisionValue {
                        card_ids: vec![card_id],
                        ev,
                        win_probability,
                    }),
                ),
                PegDecision::Go => ("go", ReviewKind::Peg, None),
            }
        }
        _ => return Err("Ace advice is not available for this decision.".to_string()),
    };
    let analysis = recommended.map(|recommended| PreparedDecisionAnalysis {
        decision_key: decision_analysis_key(review_kind, game),
        evaluator_model: DYNAMIC_EVALUATOR_VERSION.to_string(),
        kind: review_kind,
        recommended,
    });
    let card_ids = analysis
        .as_ref()
        .map(|analysis| analysis.recommended.card_ids.clone())
        .unwrap_or_default();
    Ok(MasterHintEvaluation {
        kind,
        card_ids,
        analysis,
    })
}

fn store_prepared_decision_analysis(
    server: &Server,
    session_id: &str,
    analysis: PreparedDecisionAnalysis,
) -> Result<String, String> {
    let mut app = server
        .state
        .lock()
        .map_err(|_| "server state lock poisoned".to_string())?;
    let session = app
        .sessions
        .get_mut(session_id)
        .ok_or_else(|| "The saved game is no longer available.".to_string())?;
    let already_completed = session.decision_reviews.iter().any(|review| {
        decision_analysis_key(review.kind, &review.game) == analysis.decision_key
            && saved_decision_analysis(review, &analysis.evaluator_model).is_some()
    });
    let mut changed = false;
    if !already_completed {
        if let Some(review) = session.decision_reviews.iter_mut().find(|review| {
            decision_analysis_key(review.kind, &review.game) == analysis.decision_key
                && saved_decision_analysis(review, &analysis.evaluator_model).is_none()
        }) {
            if review.prepared_analysis.is_none() {
                review.prepared_analysis = Some(analysis.clone());
                changed = true;
            }
        } else if !session.prepared_decision_analyses.iter().any(|saved| {
            saved.decision_key == analysis.decision_key
                && saved.evaluator_model == analysis.evaluator_model
        }) {
            session.prepared_decision_analyses.push(analysis.clone());
            changed = true;
        }
    }
    if changed {
        session.updated_at = isoish_now();
        session.event_sequence += 1;
        let body = json!({
            "payload": {
                "decisionKey": analysis.decision_key,
                "evaluatorModel": analysis.evaluator_model,
                "recommendedCardIds": analysis.recommended.card_ids,
                "recommendedEv": analysis.recommended.ev,
                "recommendedWinProbability": analysis.recommended.win_probability,
            }
        })
        .to_string();
        persist_session_event(&server.data_dir, session, "analyze-decision", &body)?;
    }
    response_for_session(session)
}

fn response_with_master_hint(
    mut response: String,
    hint: &MasterHintEvaluation,
) -> Result<String, String> {
    let Some(body) = response.strip_suffix('}').map(str::to_string) else {
        return Err("could not append Ace hint".to_string());
    };
    response = body;
    write!(
        response,
        ",\"hint\":{{\"kind\":\"{}\",\"cardIds\":{}}}}}",
        hint.kind,
        number_array_json(&hint.card_ids),
    )
    .map_err(|error| error.to_string())?;
    Ok(response)
}

fn game_state_json(session: &Session) -> String {
    let game = &session.game;
    let phase = public_phase(session);
    let turn_card = if session.turn_card_revealed {
        card_json(game.turn_card, None)
    } else {
        "null".to_string()
    };
    let human_hand = cards_json(&game.player(HUMAN).hand, Some("User"));
    let human_table = cards_json(&game.player(HUMAN).table, Some("User"));
    let ai_table = cards_json(&game.player(AI).table, Some("AI"));
    let scoring = scoring_json(session);
    let legal_human = if phase == "pegging" && game.current_player() == HUMAN {
        number_array_json(
            &game
                .legal_cards(HUMAN)
                .iter()
                .map(|card| card.id)
                .collect::<Vec<_>>(),
        )
    } else {
        "[]".to_string()
    };
    let legal_ai = if phase == "pegging" && game.current_player() == AI {
        number_array_json(
            &game
                .legal_cards(AI)
                .iter()
                .map(|card| card.id)
                .collect::<Vec<_>>(),
        )
    } else {
        "[]".to_string()
    };
    let turn = if phase == "pegging" {
        json_string_value(side_label(game.current_player()))
    } else {
        "null".to_string()
    };
    let cut_for_deal = if session.deal_cut_revealed {
        format!(
            "{{\"human\":{},\"ai\":{},\"prompt\":\"{}\"}}",
            card_json(session.deal_cuts[0], None),
            card_json(session.deal_cuts[1], None),
            json_escape(&format!("{} deals first.", side_label(game.first_deal))),
        )
    } else {
        "null".to_string()
    };
    let dynamic_calibration = session
        .dynamic
        .as_ref()
        .map(|dynamic| {
            let complete_cycles = dynamic.profile().complete_cycles;
            let provisional_handicap = dynamic
                .profile()
                .handicap_per_game()
                .map(json_f64)
                .unwrap_or_else(|| "null".to_string());
            format!(
                "{{\"started\":true,\"completeCycles\":{},\"minimumCycles\":{},\"complete\":{},\"provisionalHandicapPerGame\":{}}}",
                complete_cycles,
                MIN_COMPLETE_CYCLES,
                complete_cycles >= MIN_COMPLETE_CYCLES,
                provisional_handicap,
            )
        })
        .unwrap_or_else(|| "null".to_string());
    format!(
        "{{\"phase\":\"{}\",\"message\":\"{}\",\"log\":[],\"result\":{},\"handNumber\":{},\"scores\":{{\"human\":{},\"ai\":{}}},\"pegPositions\":{{\"human\":[{},{}],\"ai\":[{},{}]}},\"dealer\":\"{}\",\"firstDealer\":\"{}\",\"cribOwner\":\"{}\",\"turn\":{},\"count\":{},\"turnCard\":{},\"turnCardRevealed\":{},\"plays\":{},\"completedPlays\":{},\"peggingResetPending\":{},\"humanHand\":{},\"aiHandCount\":{},\"humanTable\":{},\"aiTable\":{},\"legalCardIds\":{},\"aiLegalCardIds\":{},\"canGo\":{},\"scoring\":{},\"cutForDeal\":{},\"dynamicCalibration\":{},\"analyticsEvents\":{}}}",
        phase,
        json_escape(&message_for(session)),
        result_json(session),
        game.hand_number,
        game.player(HUMAN).score,
        game.player(AI).score,
        game.player(HUMAN).score,
        game.player(HUMAN).score,
        game.player(AI).score,
        game.player(AI).score,
        side_label(game.dealer),
        side_label(game.first_deal),
        side_label(game.dealer),
        turn,
        game.count,
        turn_card,
        session.turn_card_revealed,
        cards_with_owners_json(&game.plays, &game.play_owners),
        nested_cards_with_owners_json(&game.completed_plays, &game.completed_play_owners),
        game.pegging_reset_pending,
        human_hand,
        game.player(AI).hand.len(),
        human_table,
        ai_table,
        legal_human,
        legal_ai,
        phase == "pegging" && game.current_player() == HUMAN && game.legal_cards(HUMAN).is_empty(),
        scoring,
        cut_for_deal,
        dynamic_calibration,
        analytics_events_json(session),
    )
}

fn score_stage_details(
    game: &CribbageGame,
) -> Option<(&'static str, Side, &[Card], bool, &'static str)> {
    match game.phase {
        Phase::ScorePone => Some((
            "pone",
            game.pone,
            &game.player(game.pone).table,
            false,
            "Show dealer hand",
        )),
        Phase::ScoreDealer => Some((
            "dealer",
            game.dealer,
            &game.player(game.dealer).table,
            false,
            "Show crib",
        )),
        Phase::ScoreCrib => Some((
            "crib",
            game.dealer,
            &game.player(game.dealer).crib,
            true,
            "Next hand",
        )),
        _ => None,
    }
}

fn final_score_stage_details(
    session: &Session,
) -> Option<(&'static str, Side, &[Card], bool, &'static str)> {
    let pending = session.pending_final_scoring.as_ref()?;
    let game = &session.game;
    match pending.stage {
        FinalScoringStage::Pone => Some((
            "pone",
            game.pone,
            &game.player(game.pone).table,
            false,
            "View game result",
        )),
        FinalScoringStage::Dealer => Some((
            "dealer",
            game.dealer,
            &game.player(game.dealer).table,
            false,
            "View game result",
        )),
        FinalScoringStage::Crib => Some((
            "crib",
            game.dealer,
            &game.player(game.dealer).crib,
            true,
            "View game result",
        )),
    }
}

fn scoring_stage_details(
    session: &Session,
) -> Option<(&'static str, Side, &[Card], bool, &'static str)> {
    final_score_stage_details(session).or_else(|| score_stage_details(&session.game))
}

fn hand_score_components_json(components: HandScoreComponents) -> String {
    format!(
        "{{\"total\":{},\"fifteens\":{},\"pairs\":{},\"runs\":{},\"flush\":{},\"knobs\":{}}}",
        components.total(),
        components.fifteens,
        components.pairs,
        components.runs,
        components.flush,
        components.knobs,
    )
}

fn pegging_score_components_json(components: PeggingScoreComponents) -> String {
    format!(
        "{{\"total\":{},\"fifteens\":{},\"thirtyOne\":{},\"pairs\":{},\"runs\":{},\"lastCard\":{}}}",
        components.total(),
        components.fifteens,
        components.thirty_one,
        components.pairs,
        components.runs,
        components.last_card,
    )
}

fn scoring_json(session: &Session) -> String {
    let game = &session.game;
    let Some((stage, owner, cards, crib, next_label)) = scoring_stage_details(session) else {
        return "null".to_string();
    };
    let components = score_hand_components(cards, game.turn_card, crib);
    let title = format!(
        "{} {}",
        side_label(owner),
        if crib { "crib" } else { "hand" }
    );
    format!(
        "{{\"stage\":\"{}\",\"title\":\"{}\",\"owner\":\"{}\",\"cards\":{},\"points\":{},\"components\":{},\"nextLabel\":\"{}\"}}",
        stage,
        json_escape(&title),
        side_label(owner),
        cards_json(cards, Some(side_label(owner))),
        components.total(),
        hand_score_components_json(components),
        next_label,
    )
}

fn snapshot_json(session: &Session) -> String {
    let game = &session.game;
    let scoring_review = scoring_snapshot_json(session);
    let turn_card = if session.turn_card_revealed {
        game.turn_card.id.to_string()
    } else {
        "null".to_string()
    };
    format!(
        "{{\"version\":1,\"gameId\":\"{}\",\"analyticsCounter\":0,\"analyticsEvents\":{},\"opponent\":\"{}\",\"deal\":{},\"firstDeal\":{},\"handNumber\":{},\"human\":{},\"ai\":{},\"turnCard\":{},\"turnCardRevealed\":{},\"crib\":{},\"plays\":{},\"playOwners\":{},\"completedPlays\":{},\"completedPlayOwners\":{},\"peggingResetPending\":{},\"count\":{},\"turn\":{},\"goPlayer\":{},\"lastPlayer\":{},\"scoringReview\":{},\"phase\":\"{}\",\"message\":\"{}\",\"log\":[],\"result\":{},\"pegPositions\":{{\"human\":[{},{}],\"ai\":[{},{}]}},\"pendingDiscardReviews\":{},\"pendingPeggingReviews\":{}}}",
        json_escape(&session.id),
        analytics_events_json(session),
        session.model.as_str(),
        side_number(game.deal),
        side_number(game.first_deal),
        game.hand_number,
        player_snapshot_json(game, HUMAN),
        player_snapshot_json(game, AI),
        turn_card,
        session.turn_card_revealed,
        "[]",
        number_array_json(&game.plays.iter().map(|card| card.id).collect::<Vec<_>>()),
        side_array_json(&game.play_owners),
        nested_number_arrays_json(&game.completed_plays),
        nested_side_arrays_json(&game.completed_play_owners),
        game.pegging_reset_pending,
        game.count,
        if game.current_player() == HUMAN { 0 } else { 1 },
        option_player_json(game.go_player),
        option_player_json(game.last_player),
        scoring_review,
        public_phase(session),
        json_escape(&message_for(session)),
        result_json(session),
        game.player(HUMAN).score,
        game.player(HUMAN).score,
        game.player(AI).score,
        game.player(AI).score,
        pending_reviews_json(session, ReviewKind::Discard),
        pending_reviews_json(session, ReviewKind::Peg),
    )
}

fn scoring_snapshot_json(session: &Session) -> String {
    let game = &session.game;
    let Some((stage, owner, cards, crib, next_label)) = scoring_stage_details(session) else {
        return "null".to_string();
    };
    let components = score_hand_components(cards, game.turn_card, crib);
    let title = format!(
        "{} {}",
        side_label(owner),
        if crib { "crib" } else { "hand" }
    );
    format!(
        "{{\"stage\":\"{}\",\"title\":\"{}\",\"owner\":\"{}\",\"rawCards\":{},\"points\":{},\"components\":{},\"nextLabel\":\"{}\"}}",
        stage,
        json_escape(&title),
        side_label(owner),
        number_array_json(&cards.iter().map(|card| card.id).collect::<Vec<_>>()),
        components.total(),
        hand_score_components_json(components),
        next_label,
    )
}

fn player_snapshot_json(game: &CribbageGame, side: Side) -> String {
    let player = game.player(side);
    // Snapshots are stored by the browser. Only the human's private hand is
    // needed for recovery; the AI hand and both players' crib views must stay
    // server-private until scoring.
    let hand = if side == HUMAN {
        number_array_json(&player.hand.iter().map(|card| card.id).collect::<Vec<_>>())
    } else {
        "[]".to_string()
    };
    format!(
        "{{\"hand\":{},\"table\":{},\"crib\":{},\"score\":{}}}",
        hand,
        number_array_json(&player.table.iter().map(|card| card.id).collect::<Vec<_>>()),
        "[]",
        player.score,
    )
}

fn public_phase(session: &Session) -> &'static str {
    if session.waiting_for_deal_cut {
        return "cut_for_deal";
    }
    if session.waiting_for_ai_discard {
        return "ai_discarding";
    }
    if let Some(pending) = &session.pending_final_scoring {
        return match pending.stage {
            FinalScoringStage::Pone => "score_pone",
            FinalScoringStage::Dealer => "score_dealer",
            FinalScoringStage::Crib => "score_crib",
        };
    }
    match session.game.phase {
        Phase::Discard => "discard",
        Phase::Pegging => "pegging",
        Phase::PeggingComplete => "pegging_complete",
        Phase::ScorePone => "score_pone",
        Phase::ScoreDealer => "score_dealer",
        Phase::ScoreCrib => "score_crib",
        Phase::GameOver => "game_over",
    }
}

fn message_for(session: &Session) -> String {
    match public_phase(session) {
        "cut_for_deal" => "Cut the deck for first deal.".to_string(),
        "discard" => format!(
            "Select two cards to discard to {}'s crib.",
            side_label(session.game.dealer)
        ),
        "ai_discarding" => "AI is choosing two cards to discard.".to_string(),
        "pegging" => format!("{} to play.", side_label(session.game.current_player())),
        "pegging_complete" => "Pegging complete. Continue to score the hand.".to_string(),
        "score_pone" => format!("{} hand counted.", side_label(session.game.pone)),
        "score_dealer" => format!("{} hand counted.", side_label(session.game.dealer)),
        "score_crib" => format!("{} crib counted.", side_label(session.game.dealer)),
        "game_over" => "Game over.".to_string(),
        _ => String::new(),
    }
}

fn result_json(session: &Session) -> String {
    if session.game.phase != Phase::GameOver || session.pending_final_scoring.is_some() {
        return "[]".to_string();
    }
    let winner = if session.game.player(HUMAN).score >= 121 {
        "User"
    } else {
        "AI"
    };
    format!("[\"{} wins.\"]", winner)
}

fn analytics_events_json(session: &Session) -> String {
    let game = &session.game;
    let start = format!(
        "{{\"id\":\"{}-start\",\"at\":\"{}\",\"type\":\"game\",\"action\":\"start\",\"gameId\":\"{}\",\"opponent\":\"{}\"}}",
        json_escape(&session.id),
        json_escape(&session.created_at),
        json_escape(&session.id),
        session.model.as_str(),
    );
    let mut events = vec![start];
    events.extend(
        session
            .score_events
            .iter()
            .map(|event| saved_score_event_json(session, event)),
    );
    events.extend(
        session
            .decision_reviews
            .iter()
            .map(|review| decision_review_event_json(session, review)),
    );
    events.extend(session.help_events.iter().map(|event| {
        format!(
            "{{\"id\":\"{}\",\"at\":\"{}\",\"type\":\"help\",\"action\":\"request\",\"gameId\":\"{}\",\"handNumber\":{},\"advisor\":\"Ace\"}}",
            json_escape(&event.id),
            json_escape(&event.at),
            json_escape(&session.id),
            event.hand_number,
        )
    }));
    if game.phase == Phase::GameOver && session.pending_final_scoring.is_none() {
        let human_score = game.player(HUMAN).score;
        let ai_score = game.player(AI).score;
        let winner = if human_score >= 121 { "human" } else { "ai" };
        let loser = if winner == "human" { "ai" } else { "human" };
        let lower = human_score.min(ai_score);
        let result = if lower < 61 {
            "double-skunk"
        } else if lower < 91 {
            "skunk"
        } else {
            "regular"
        };
        events.push(format!(
            "{{\"id\":\"{}-end\",\"at\":\"{}\",\"type\":\"game\",\"action\":\"end\",\"gameId\":\"{}\",\"opponent\":\"{}\",\"winner\":\"{}\",\"loser\":\"{}\",\"result\":\"{}\",\"finalScores\":{{\"human\":{},\"ai\":{}}}}}",
            json_escape(&session.id),
            json_escape(session.completed_at.as_deref().unwrap_or(&session.updated_at)),
            json_escape(&session.id),
            session.model.as_str(),
            winner,
            loser,
            result,
            human_score,
            ai_score,
        ));
    }
    format!("[{}]", events.join(","))
}

fn saved_score_event_json(session: &Session, event: &SavedScoreEvent) -> String {
    let turn_card = event
        .turn_card
        .map(|card| format!(",\"turnCard\":{}", json_string_value(&card.label())))
        .unwrap_or_default();
    let count = event
        .count
        .map(|value| format!(",\"count\":{}", value))
        .unwrap_or_default();
    let score_components = match (event.category, event.turn_card) {
        (SavedScoreCategory::Pegging, _) => event
            .score_components
            .map(|components| {
                format!(
                    ",\"scoreComponents\":{}",
                    pegging_score_components_json(components)
                )
            })
            .unwrap_or_default(),
        (SavedScoreCategory::Hand, Some(turn_card)) => format!(
            ",\"scoreComponents\":{}",
            hand_score_components_json(score_hand_components(&event.cards, turn_card, false))
        ),
        (SavedScoreCategory::Crib, Some(turn_card)) => format!(
            ",\"scoreComponents\":{}",
            hand_score_components_json(score_hand_components(&event.cards, turn_card, true))
        ),
        _ => String::new(),
    };
    format!(
        "{{\"id\":\"{}\",\"at\":\"{}\",\"type\":\"score\",\"gameId\":\"{}\",\"handNumber\":{},\"player\":\"{}\",\"role\":\"{}\",\"category\":\"{}\",\"points\":{},\"reason\":\"{}\",\"totalScore\":{},\"scores\":{{\"human\":{},\"ai\":{}}},\"cards\":{}{}{}{}}}",
        json_escape(&event.id),
        json_escape(&event.at),
        json_escape(&session.id),
        event.hand_number,
        side_key(event.player),
        if event.player == event.dealer { "dealer" } else { "pone" },
        score_category_label(event.category),
        event.points,
        json_escape(&event.reason),
        event.total_score,
        event.scores[HUMAN.index()],
        event.scores[AI.index()],
        card_labels_json(&event.cards),
        turn_card,
        count,
        score_components,
    )
}

fn pending_reviews_json(session: &Session, kind: ReviewKind) -> String {
    let pending = session
        .decision_reviews
        .iter()
        .filter(|review| {
            review.kind == kind
                && saved_decision_analysis(review, DYNAMIC_EVALUATOR_VERSION).is_none()
        })
        .map(|review| format!("{{\"id\":\"{}\"}}", json_escape(&review.id)))
        .collect::<Vec<_>>();
    format!("[{}]", pending.join(","))
}

fn decision_review_event_json(session: &Session, review: &SavedDecisionReview) -> String {
    let game = &review.game;
    let role = if game.dealer == HUMAN {
        "dealer"
    } else {
        "pone"
    };
    let review_json = saved_decision_analysis(review, DYNAMIC_EVALUATOR_VERSION)
        .map(|completed| format!(",\"review\":{}", completed_review_json(completed)))
        .unwrap_or_default();
    match review.kind {
        ReviewKind::Discard => {
            let selected = card_labels_for_ids(&review.selected_card_ids);
            let remaining = game
                .player(HUMAN)
                .hand
                .iter()
                .filter(|card| !review.selected_card_ids.contains(&card.id))
                .map(|card| card.label())
                .collect::<Vec<_>>();
            format!(
                "{{\"id\":\"{}\",\"at\":\"{}\",\"type\":\"discard\",\"gameId\":\"{}\",\"handNumber\":{},\"player\":\"human\",\"role\":\"{}\",\"cards\":{},\"cribOwner\":\"{}\",\"cribAfterDiscard\":{},\"remainingHand\":{},\"handBeforeDiscard\":{},\"scores\":{{\"human\":{},\"ai\":{}}},\"dealer\":\"{}\",\"model\":\"{}\"{}}}",
                json_escape(&review.id),
                json_escape(&review.at),
                json_escape(&session.id),
                game.hand_number,
                role,
                string_array_json(&selected),
                if game.dealer == HUMAN { "human" } else { "ai" },
                string_array_json(&selected),
                string_array_json(&remaining),
                card_labels_json(&game.player(HUMAN).hand),
                game.player(HUMAN).score,
                game.player(AI).score,
                if game.dealer == HUMAN { "human" } else { "ai" },
                MODEL_13_0,
                review_json,
            )
        }
        ReviewKind::Peg => {
            let selected = card_labels_for_ids(&review.selected_card_ids);
            let selected_value = review
                .selected_card_ids
                .first()
                .and_then(|id| Card::new(*id).ok())
                .map(|card| card.value)
                .unwrap_or(0);
            format!(
                "{{\"id\":\"{}\",\"at\":\"{}\",\"type\":\"pegging\",\"action\":\"play\",\"gameId\":\"{}\",\"handNumber\":{},\"player\":\"human\",\"role\":\"{}\",\"card\":\"{}\",\"hand\":{},\"playedCards\":{},\"completedPlayGroups\":{},\"cutCard\":\"{}\",\"countBefore\":{},\"scoresBefore\":{{\"human\":{},\"ai\":{}}},\"count\":{},\"scores\":{{\"human\":{},\"ai\":{}}},\"message\":\"User played {}\",\"model\":\"{}\"{}}}",
                json_escape(&review.id),
                json_escape(&review.at),
                json_escape(&session.id),
                game.hand_number,
                role,
                json_escape(selected.first().map(String::as_str).unwrap_or("card")),
                card_labels_json(&game.player(HUMAN).hand),
                card_labels_json(&game.plays),
                nested_card_labels_json(&game.completed_plays),
                json_escape(&game.turn_card.label()),
                game.count,
                game.player(HUMAN).score,
                game.player(AI).score,
                game.count + selected_value,
                game.player(HUMAN).score,
                game.player(AI).score,
                json_escape(selected.first().map(String::as_str).unwrap_or("card")),
                MODEL_13_0,
                review_json,
            )
        }
    }
}

fn completed_review_json(review: &CompletedDecisionReview) -> String {
    let mut fields = vec![
        format!("\"model\":\"{}\"", json_escape(&review.evaluator_model)),
        format!(
            "\"selected\":{}",
            string_array_json(&card_labels_for_ids(&review.selected_card_ids))
        ),
        format!(
            "\"recommended\":{}",
            string_array_json(&card_labels_for_ids(&review.recommended_card_ids))
        ),
        format!("\"selectedEv\":{}", json_f64(review.selected_ev)),
        format!("\"recommendedEv\":{}", json_f64(review.recommended_ev)),
        format!(
            "\"delta\":{}",
            json_f64(review.recommended_ev - review.selected_ev)
        ),
    ];
    if let (Some(selected), Some(recommended)) = (
        review.selected_win_probability,
        review.recommended_win_probability,
    ) {
        fields.push(format!("\"selectedWinProbability\":{}", json_f64(selected)));
        fields.push(format!(
            "\"recommendedWinProbability\":{}",
            json_f64(recommended)
        ));
        fields.push(format!(
            "\"winProbabilityDelta\":{}",
            json_f64(recommended - selected)
        ));
    }
    format!("{{{}}}", fields.join(","))
}

fn card_labels_for_ids(ids: &[u8]) -> Vec<String> {
    ids.iter()
        .filter_map(|id| Card::new(*id).ok().map(|card| card.label()))
        .collect()
}

fn card_labels_json(cards: &[Card]) -> String {
    string_array_json(&cards.iter().map(|card| card.label()).collect::<Vec<_>>())
}

fn nested_card_labels_json(groups: &[Vec<Card>]) -> String {
    format!(
        "[{}]",
        groups
            .iter()
            .map(|cards| card_labels_json(cards))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn string_array_json(values: &[String]) -> String {
    format!(
        "[{}]",
        values
            .iter()
            .map(|value| json_string_value(value))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn json_f64(value: f64) -> String {
    if value.is_finite() {
        format!("{:.6}", value)
    } else {
        "0".to_string()
    }
}

fn card_json(card: Card, owner: Option<&str>) -> String {
    let owner = owner
        .map(|value| format!(",\"owner\":\"{}\"", value))
        .unwrap_or_default();
    format!(
        "{{\"index\":{},\"id\":{},\"rank\":\"{}\",\"suit\":\"{}\",\"symbol\":\"{}\",\"value\":{},\"label\":\"{}\"{}}}",
        card.id,
        card.id,
        RANKS[card.rank as usize],
        SUIT_NAMES[card.suit as usize],
        match card.suit { 0 => "♦", 1 => "♣", 2 => "♥", _ => "♠" },
        VALUES[card.rank as usize],
        card.label(),
        owner,
    )
}

fn cards_json(cards: &[Card], owner: Option<&str>) -> String {
    let cards = cards
        .iter()
        .map(|card| card_json(*card, owner))
        .collect::<Vec<_>>();
    format!("[{}]", cards.join(","))
}

fn side_key(side: Side) -> &'static str {
    if side == HUMAN {
        "human"
    } else {
        "ai"
    }
}

fn cards_with_owners_json(cards: &[Card], owners: &[Side]) -> String {
    let cards = cards
        .iter()
        .enumerate()
        .map(|(index, card)| card_json(*card, owners.get(index).copied().map(side_key)))
        .collect::<Vec<_>>();
    format!("[{}]", cards.join(","))
}

fn nested_cards_with_owners_json(groups: &[Vec<Card>], owner_groups: &[Vec<Side>]) -> String {
    format!(
        "[{}]",
        groups
            .iter()
            .enumerate()
            .map(|(index, cards)| {
                cards_with_owners_json(
                    cards,
                    owner_groups.get(index).map(Vec::as_slice).unwrap_or(&[]),
                )
            })
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn number_array_json(values: &[u8]) -> String {
    format!(
        "[{}]",
        values
            .iter()
            .map(u8::to_string)
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn nested_number_arrays_json(groups: &[Vec<Card>]) -> String {
    format!(
        "[{}]",
        groups
            .iter()
            .map(|cards| number_array_json(&cards.iter().map(|card| card.id).collect::<Vec<_>>()))
            .collect::<Vec<_>>()
            .join(","),
    )
}

fn side_array_json(sides: &[Side]) -> String {
    format!(
        "[{}]",
        sides
            .iter()
            .map(|side| json_string_value(if *side == HUMAN { "human" } else { "ai" }))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn nested_side_arrays_json(groups: &[Vec<Side>]) -> String {
    format!(
        "[{}]",
        groups
            .iter()
            .map(|sides| side_array_json(sides))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn side_label(side: Side) -> &'static str {
    if side == HUMAN {
        "User"
    } else {
        "AI"
    }
}

fn side_number(side: Side) -> u8 {
    if side == HUMAN {
        0
    } else {
        1
    }
}

fn option_player_json(value: Option<Side>) -> String {
    value
        .map(|side| json_string_value(if side == HUMAN { "human" } else { "ai" }))
        .unwrap_or_else(|| "null".to_string())
}

fn option_u8_json(value: Option<u8>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string())
}

fn json_string_value(value: &str) -> String {
    format!("\"{}\"", json_escape(value))
}

fn save_session(server: &Server, body: &str) -> Response {
    let result = (|| -> Result<(), String> {
        let session_id =
            json_string(body, "gameId").ok_or_else(|| "Missing game session id.".to_string())?;
        let tag = json_string(body, "tag").filter(|value| !value.trim().is_empty());
        let mut app = server
            .state
            .lock()
            .map_err(|_| "server state lock poisoned".to_string())?;
        if !app.sessions.contains_key(&session_id) {
            if let Some(session) = load_session_by_id(&server.data_dir, &session_id)? {
                app.sessions.insert(session_id.clone(), session);
            }
        }
        let session = app
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| "Game session was not found.".to_string())?;
        let before = session.clone();
        session.tag = tag;
        session.updated_at = isoish_now();
        if let Err(error) = persist_session_snapshot(&server.data_dir, session) {
            *session = before;
            return Err(error);
        }
        Ok(())
    })();
    match result {
        Ok(()) => Response::json(200, "{\"ok\":true}".to_string()),
        Err(error) => Response::json(400, format!("{{\"error\":\"{}\"}}", json_escape(&error))),
    }
}

fn load_session(server: &Server, body: &str) -> Response {
    let tag = json_string(body, "tag").unwrap_or_default();
    let requested_model =
        json_string(body, "opponent").and_then(|value| ModelId::from_str(&value).ok());
    let result = (|| -> Result<String, String> {
        let mut app = server
            .state
            .lock()
            .map_err(|_| "server state lock poisoned".to_string())?;
        let in_memory_id = app
            .sessions
            .values()
            .filter(|session| {
                session.tag.as_deref() == Some(tag.as_str())
                    && session_status(session) == "active"
                    && requested_model.is_none_or(|model| session.model == model)
            })
            .max_by_key(|session| &session.updated_at)
            .map(|session| session.id.clone());
        if in_memory_id.is_none() {
            if let Some(session) = load_session_by_tag(&server.data_dir, &tag, requested_model)? {
                let id = session.id.clone();
                app.sessions.insert(id, session);
            }
        }
        let session = in_memory_id
            .as_deref()
            .and_then(|id| app.sessions.get(id))
            .or_else(|| {
                app.sessions
                    .values()
                    .filter(|session| {
                        session.tag.as_deref() == Some(tag.as_str())
                            && session_status(session) == "active"
                            && requested_model.is_none_or(|model| session.model == model)
                    })
                    .max_by_key(|session| &session.updated_at)
            });
        if let Some(session) = session {
            return Ok(format!(
                "{{\"ok\":true,\"session\":{{\"gameId\":\"{}\",\"updatedAt\":\"{}\",\"snapshot\":{},\"state\":{}}}}}",
                json_escape(&session.id),
                isoish_now(),
                snapshot_json(session),
                game_state_json(session),
            ));
        }
        Ok("{\"ok\":true,\"session\":null}".to_string())
    })();
    match result {
        Ok(json) => Response::json(200, json),
        Err(error) => Response::json(500, format!("{{\"error\":\"{}\"}}", json_escape(&error))),
    }
}

fn upload_game(server: &Server, body: &str) -> Response {
    let result = (|| -> Result<(bool, String), String> {
        let game_id =
            json_string(body, "gameId").ok_or_else(|| "Missing completed game id.".to_string())?;
        let player = json_string(body, "tag").unwrap_or_else(|| "Anonymous".to_string());
        let winner = json_string(body, "winner");
        let result = json_string(body, "result").unwrap_or_else(|| "regular".to_string());
        let model = json_string(body, "model").unwrap_or_else(|| MODEL_13_0.to_string());
        let human_score = json_number_after(body, "human").unwrap_or(0) as i32;
        let ai_score = json_number_after(body, "ai").unwrap_or(0) as i32;
        let ended_at = completed_game_timestamp(body)
            .or_else(|| game_start_timestamp(&game_id))
            .unwrap_or_else(isoish_now);
        let (human_scoring, ai_scoring) = scoring_totals_from_upload(body);
        let (analyzed, errors) = decision_errors_from_upload(body);
        let upload = UploadedGame {
            game_id: game_id.clone(),
            player,
            winner,
            result,
            human_score,
            ai_score,
            model,
            ended_at,
            human_scoring,
            ai_scoring,
            analyzed,
            errors,
        };
        let mut app = server
            .state
            .lock()
            .map_err(|_| "server state lock poisoned".to_string())?;
        if let Some(existing) = app.uploads.get(&game_id) {
            if existing.player == upload.player
                && existing.winner == upload.winner
                && existing.result == upload.result
                && existing.human_score == upload.human_score
                && existing.ai_score == upload.ai_score
                && existing.model == upload.model
                && existing.human_scoring == upload.human_scoring
                && existing.ai_scoring == upload.ai_scoring
                && existing.analyzed == upload.analyzed
                && existing.errors == upload.errors
            {
                return Ok((false, app.leaderboard_summary.clone()));
            }
        }
        let is_new = !app.uploads.contains_key(&game_id);
        let previous = app.uploads.insert(game_id.clone(), upload);
        if let Err(error) = persist_uploads(&server.data_dir, &app.uploads) {
            if let Some(previous) = previous {
                app.uploads.insert(game_id.clone(), previous);
            } else {
                app.uploads.remove(&game_id);
            }
            return Err(error);
        }
        if let Err(error) = persist_completed_game_upload(&server.data_dir, &game_id, body) {
            if let Some(previous) = previous {
                app.uploads.insert(game_id.clone(), previous);
            } else {
                app.uploads.remove(&game_id);
            }
            // Keep the TSV and in-memory leaderboard transactionally aligned
            // with the permanent payload log when a database write fails.
            let _ = persist_uploads(&server.data_dir, &app.uploads);
            return Err(error);
        }
        app.leaderboard_summary =
            leaderboard_summary_json_for_data_dir(&app.uploads, &server.data_dir);
        Ok((is_new, app.leaderboard_summary.clone()))
    })();
    match result {
        Ok((updated, leaderboard)) => Response::json(
            200,
            format!(
                "{{\"ok\":true,\"updated\":{},\"leaderboard\":{}}}",
                updated, leaderboard
            ),
        ),
        Err(error) => Response::json(400, format!("{{\"error\":\"{}\"}}", json_escape(&error))),
    }
}

fn completed_game_timestamp(body: &str) -> Option<String> {
    let payload = serde_json::from_str::<Value>(body).ok()?;
    let value = payload.get("finalResult")?.get("at")?.as_str()?;
    canonical_utc_timestamp(value)
}

/// Historical browser game IDs encode their creation instant in base 36;
/// Rust session IDs encode the same value in hexadecimal.  This is a start
/// time, not an exact completion time, so it is only used when the uploaded
/// completion event has no valid timestamp.
fn game_start_timestamp(game_id: &str) -> Option<String> {
    let millis = if let Some(encoded) = game_id.strip_prefix("game-") {
        u64::from_str_radix(encoded.split('-').next()?, 36).ok()?
    } else if let Some(encoded) = game_id.strip_prefix("rust-") {
        u64::from_str_radix(encoded.split('-').next()?, 16).ok()?
    } else {
        return None;
    };
    Some(iso8601_from_unix_millis(millis))
}

fn uploads_path(data_dir: &Path) -> PathBuf {
    data_dir.join("leaderboard-games.tsv")
}

fn load_uploads(data_dir: &Path) -> Result<HashMap<String, UploadedGame>, String> {
    let path = uploads_path(data_dir);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(format!("read {}: {}", path.display(), error)),
    };
    let mut uploads = HashMap::new();
    for (line_number, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 9 {
            return Err(format!(
                "{}:{} has {} fields",
                path.display(),
                line_number + 1,
                fields.len()
            ));
        }
        let game_id = decode_field(fields[0])?;
        let human_score = fields[4]
            .parse::<i32>()
            .map_err(|error| error.to_string())?;
        let ai_score = fields[5]
            .parse::<i32>()
            .map_err(|error| error.to_string())?;
        uploads.insert(
            game_id.clone(),
            UploadedGame {
                game_id,
                player: decode_field(fields[1])?,
                winner: if fields[2].is_empty() {
                    None
                } else {
                    Some(decode_field(fields[2])?)
                },
                result: decode_field(fields[3])?,
                human_score,
                ai_score,
                model: decode_field(fields[6])?,
                ended_at: decode_field(fields[7])?,
                human_scoring: ScoringTotals::default(),
                ai_scoring: ScoringTotals::default(),
                analyzed: false,
                errors: 0,
            },
        );
        if fields[8] != "v1" {
            return Err(format!(
                "{}:{} has unsupported record version",
                path.display(),
                line_number + 1
            ));
        }
    }
    hydrate_upload_scoring(data_dir, &mut uploads)?;
    Ok(uploads)
}

fn persist_uploads(data_dir: &Path, uploads: &HashMap<String, UploadedGame>) -> Result<(), String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|error| format!("create {}: {}", data_dir.display(), error))?;
    let path = uploads_path(data_dir);
    let temporary = data_dir.join("leaderboard-games.tsv.tmp");
    let mut rows = uploads.values().collect::<Vec<_>>();
    rows.sort_by(|left, right| left.game_id.cmp(&right.game_id));
    let contents = rows
        .into_iter()
        .map(|upload| {
            [
                encode_field(&upload.game_id),
                encode_field(&upload.player),
                upload
                    .winner
                    .as_deref()
                    .map(encode_field)
                    .unwrap_or_default(),
                encode_field(&upload.result),
                upload.human_score.to_string(),
                upload.ai_score.to_string(),
                encode_field(&upload.model),
                encode_field(&upload.ended_at),
                "v1".to_string(),
            ]
            .join("\t")
        })
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(&temporary, format!("{}\n", contents))
        .map_err(|error| format!("write {}: {}", temporary.display(), error))?;
    std::fs::rename(&temporary, &path)
        .map_err(|error| format!("replace {}: {}", path.display(), error))
}

fn encode_field(value: &str) -> String {
    value
        .replace('%', "%25")
        .replace('\t', "%09")
        .replace('\n', "%0A")
        .replace('\r', "%0D")
}

fn decode_field(value: &str) -> Result<String, String> {
    let mut output = String::new();
    let mut characters = value.chars();
    while let Some(character) = characters.next() {
        if character != '%' {
            output.push(character);
            continue;
        }
        let code = [characters.next(), characters.next()];
        match code {
            [Some('2'), Some('5')] => output.push('%'),
            [Some('0'), Some('9')] => output.push('\t'),
            [Some('0'), Some('A')] => output.push('\n'),
            [Some('0'), Some('D')] => output.push('\r'),
            _ => return Err("invalid leaderboard record escaping".to_string()),
        }
    }
    Ok(output)
}

#[derive(Clone, Default)]
struct PlayerTotals {
    games: i32,
    wins: i32,
    losses: i32,
    skunks: i32,
    skunked: i32,
    points: i32,
    margin_total: i32,
    scoring_games: i32,
    human_scoring: ScoringTotals,
    ai_scoring: ScoringTotals,
    analyzed_games: i32,
    errors: i32,
}

const STATS_OPPONENT_FAMILIES: [&str; 6] =
    ["master", "human", "easy", "tough", "grandmaster", "dynamic"];

fn stats_opponent_family(model: &str) -> &'static str {
    let normalized = model.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "myrmidon-5" => "easy",
        "schell_table-peg_table-9.1" | "schell_table-peg_table-9.11" => "tough",
        value if value == "human" || value.starts_with("human:") => "human",
        value if value.contains("grandmaster") => "grandmaster",
        value if value.contains("dynamic") => "dynamic",
        _ => "master",
    }
}

fn add_upload_to_player_totals(total: &mut PlayerTotals, upload: &UploadedGame) {
    total.games += 1;
    total.human_scoring.add(&upload.human_scoring);
    total.ai_scoring.add(&upload.ai_scoring);
    if upload.human_scoring.has_opportunities() || upload.ai_scoring.has_opportunities() {
        total.scoring_games += 1;
    }
    if upload.analyzed {
        total.analyzed_games += 1;
    }
    total.errors += upload.errors;
    let won = upload.winner.as_deref() == Some("human");
    total.margin_total += upload.human_score - upload.ai_score;
    if won {
        total.wins += 1;
        total.points += if upload.result == "skunk" || upload.result == "double-skunk" {
            2
        } else {
            1
        };
        if upload.result == "skunk" || upload.result == "double-skunk" {
            total.skunks += 1;
        }
    } else {
        total.losses += 1;
        if upload.result == "skunk" || upload.result == "double-skunk" {
            total.skunked += 1;
        }
    }
}

struct LeaderboardWin {
    player: String,
    margin: i32,
    human_score: i32,
    ai_score: i32,
    result: String,
    model: String,
    ended_at: String,
}

fn leaderboard_json(server: &Server) -> Result<String, String> {
    let app = server
        .state
        .lock()
        .map_err(|_| "server state lock poisoned".to_string())?;
    Ok(app.leaderboard_summary.clone())
}

#[cfg(test)]
fn leaderboard_summary_json(uploads: &HashMap<String, UploadedGame>) -> String {
    leaderboard_summary_json_with_handicaps(uploads, &HashMap::new())
}

fn leaderboard_summary_json_for_data_dir(
    uploads: &HashMap<String, UploadedGame>,
    data_dir: &Path,
) -> String {
    let handicaps = people::handicap_summaries(data_dir).unwrap_or_else(|error| {
        eprintln!("Player handicaps were not loaded for the leaderboard: {error}");
        HashMap::new()
    });
    leaderboard_summary_json_with_handicaps(uploads, &handicaps)
}

fn leaderboard_summary_json_with_handicaps(
    uploads: &HashMap<String, UploadedGame>,
    handicaps: &HashMap<String, Value>,
) -> String {
    let mut totals: HashMap<String, PlayerTotals> = HashMap::new();
    let mut totals_by_opponent: HashMap<&'static str, HashMap<String, PlayerTotals>> =
        HashMap::new();
    let mut best_wins = Vec::new();
    for upload in uploads.values() {
        add_upload_to_player_totals(totals.entry(upload.player.clone()).or_default(), upload);
        add_upload_to_player_totals(
            totals_by_opponent
                .entry(stats_opponent_family(&upload.model))
                .or_default()
                .entry(upload.player.clone())
                .or_default(),
            upload,
        );
        let won = upload.winner.as_deref() == Some("human");
        let margin = upload.human_score - upload.ai_score;
        if won {
            best_wins.push(LeaderboardWin {
                player: upload.player.clone(),
                margin,
                human_score: upload.human_score,
                ai_score: upload.ai_score,
                result: upload.result.clone(),
                model: upload.model.clone(),
                ended_at: upload.ended_at.clone(),
            });
        }
    }
    let mut rows = totals.into_iter().collect::<Vec<_>>();
    rows.sort_by(compare_leaderboard_players);
    let player_stats = leaderboard_player_json(&rows);
    let player_stats_by_opponent = STATS_OPPONENT_FAMILIES
        .iter()
        .map(|family| {
            let mut family_rows = totals_by_opponent
                .remove(family)
                .unwrap_or_default()
                .into_iter()
                .collect::<Vec<_>>();
            family_rows.sort_by(compare_leaderboard_players);
            format!("\"{}\":[{}]", family, leaderboard_player_json(&family_rows))
        })
        .collect::<Vec<_>>()
        .join(",");
    let mut handicap_rows = handicaps.iter().collect::<Vec<_>>();
    handicap_rows.sort_by(|(left, _), (right, _)| left.cmp(right));
    let handicap_json = handicap_rows
        .into_iter()
        .map(|(player, handicap)| {
            format!(
                "\"{}\":{}",
                json_escape(player),
                serde_json::to_string(handicap).unwrap_or_else(|_| "null".to_string())
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let mut skunk_rows = rows
        .iter()
        .filter(|(_, total)| total.skunks > 0)
        .collect::<Vec<_>>();
    skunk_rows.sort_by(|(left_name, left), (right_name, right)| {
        right
            .skunks
            .cmp(&left.skunks)
            .then_with(|| right.points.cmp(&left.points))
            .then_with(|| left_name.cmp(right_name))
    });
    let most_skunks = leaderboard_player_json(&skunk_rows);
    best_wins.sort_by(|left, right| {
        right
            .margin
            .cmp(&left.margin)
            .then_with(|| left.ended_at.cmp(&right.ended_at))
            .then_with(|| left.player.cmp(&right.player))
    });
    let best_wins_json = best_wins
        .iter()
        .map(|win| {
            format!(
                "{{\"player\":\"{}\",\"margin\":{},\"humanScore\":{},\"aiScore\":{},\"result\":\"{}\",\"opponent\":\"{}\",\"endedAt\":\"{}\"}}",
                json_escape(&win.player),
                win.margin,
                win.human_score,
                win.ai_score,
                json_escape(&win.result),
                json_escape(&win.model),
                json_escape(&win.ended_at),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"generatedAt\":\"{}\",\"source\":\"rust-api-tsv\",\"model\":\"historical\",\"games\":{},\"playerStats\":[{}],\"playerStatsByOpponent\":{{{}}},\"playerHandicaps\":{{{}}},\"bestWinRate\":[{}],\"winRate14_3\":[{}],\"bestWins\":[{}],\"mostSkunks\":[{}]}}",
        isoish_now(),
        uploads.len(),
        player_stats,
        player_stats_by_opponent,
        handicap_json,
        player_stats,
        player_stats,
        best_wins_json,
        most_skunks,
    )
}

fn leaderboard_weighted_results(total: &PlayerTotals) -> i64 {
    i64::from(total.points + total.losses + total.skunked)
}

fn leaderboard_score(total: &PlayerTotals) -> f64 {
    let weighted_results = leaderboard_weighted_results(total);
    if weighted_results > 0 {
        f64::from(total.points) / weighted_results as f64
    } else {
        0.0
    }
}

/// Rank by (wins + skunks) / (wins + skunks + losses + skunked).
/// Cross multiplication keeps the comparison exact and lets equal scores fall
/// through to ordinary win rate, average margin, then player name.
fn compare_leaderboard_players(
    (left_name, left): &(String, PlayerTotals),
    (right_name, right): &(String, PlayerTotals),
) -> std::cmp::Ordering {
    let left_weighted_results = leaderboard_weighted_results(left).max(1);
    let right_weighted_results = leaderboard_weighted_results(right).max(1);
    let left_games = i64::from(left.games.max(1));
    let right_games = i64::from(right.games.max(1));
    (i64::from(right.points) * left_weighted_results)
        .cmp(&(i64::from(left.points) * right_weighted_results))
        .then_with(|| {
            (i64::from(right.wins) * left_games).cmp(&(i64::from(left.wins) * right_games))
        })
        .then_with(|| {
            (i64::from(right.margin_total) * left_games)
                .cmp(&(i64::from(left.margin_total) * right_games))
        })
        .then_with(|| left_name.cmp(right_name))
}

fn leaderboard_player_json<T>(rows: &[T]) -> String
where
    T: std::borrow::Borrow<(String, PlayerTotals)>,
{
    rows.iter()
        .map(|row| {
            let (player, total) = row.borrow();
            let games = total.games.max(1) as f64;
            format!(
                "{{\"player\":\"{}\",\"games\":{},\"wins\":{},\"losses\":{},\"skunks\":{},\"skunked\":{},\"leaderboardPoints\":{},\"leaderboardScore\":{:.6},\"leaderboardPointsPerGame\":{:.6},\"winRate\":{:.3},\"avgMargin\":{:.3},\"scoringGames\":{},\"analyzedGames\":{},\"errors\":{},\"humanScoring\":{},\"aiScoring\":{}}}",
                json_escape(player),
                total.games,
                total.wins,
                total.losses,
                total.skunks,
                total.skunked,
                total.points,
                leaderboard_score(total),
                leaderboard_score(total),
                total.wins as f64 / games,
                total.margin_total as f64 / games,
                total.scoring_games,
                total.analyzed_games,
                total.errors,
                scoring_totals_json(&total.human_scoring),
                scoring_totals_json(&total.ai_scoring),
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn scoring_totals_json(totals: &ScoringTotals) -> String {
    format!(
        "{{\"peggingDealer\":{},\"peggingPone\":{},\"handDealer\":{},\"handPone\":{},\"crib\":{},\"peggingDealerHands\":{},\"peggingPoneHands\":{},\"handDealerHands\":{},\"handPoneHands\":{},\"cribHands\":{}}}",
        totals.pegging_dealer,
        totals.pegging_pone,
        totals.hand_dealer,
        totals.hand_pone,
        totals.crib,
        totals.pegging_dealer_hands,
        totals.pegging_pone_hands,
        totals.hand_dealer_hands,
        totals.hand_pone_hands,
        totals.crib_hands,
    )
}

fn json_string(input: &str, key: &str) -> Option<String> {
    let marker = format!("\"{}\"", key);
    let start = input.find(&marker)? + marker.len();
    let remainder = input[start..].trim_start();
    let remainder = remainder.strip_prefix(':')?.trim_start();
    parse_json_string(remainder)
}

fn parse_json_string(input: &str) -> Option<String> {
    let text = input.strip_prefix('"')?;
    let mut output = String::new();
    let mut escaped = false;
    for character in text.chars() {
        if escaped {
            output.push(match character {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '"' {
            return Some(output);
        } else {
            output.push(character);
        }
    }
    None
}

fn json_number(input: &str, key: &str) -> Option<u64> {
    let marker = format!("\"{}\"", key);
    let start = input.find(&marker)? + marker.len();
    let remainder = input[start..].trim_start().strip_prefix(':')?.trim_start();
    let digits = remainder
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    (!digits.is_empty()).then(|| digits.parse().ok()).flatten()
}

fn json_number_after(input: &str, key: &str) -> Option<u64> {
    let marker = format!("\"{}\"", key);
    let mut remainder = input;
    while let Some(index) = remainder.find(&marker) {
        let after_marker = &remainder[index + marker.len()..];
        let candidate = after_marker
            .trim_start()
            .strip_prefix(':')
            .map(str::trim_start)
            .and_then(|value| {
                let digits = value
                    .chars()
                    .take_while(|character| character.is_ascii_digit())
                    .collect::<String>();
                (!digits.is_empty()).then(|| digits.parse().ok()).flatten()
            });
        if candidate.is_some() {
            return candidate;
        }
        remainder = after_marker;
    }
    None
}

fn json_number_array(input: &str, key: &str) -> Vec<u64> {
    let marker = format!("\"{}\"", key);
    let Some(start) = input.find(&marker) else {
        return Vec::new();
    };
    let Some(open) = input[start + marker.len()..]
        .find('[')
        .map(|index| start + marker.len() + index)
    else {
        return Vec::new();
    };
    let Some(close) = input[open..].find(']').map(|index| open + index) else {
        return Vec::new();
    };
    input[open + 1..close]
        .split(',')
        .filter_map(|value| value.trim().parse::<u64>().ok())
        .collect()
}

fn json_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn isoish_now() -> String {
    iso8601_from_unix_millis(unix_millis() as u64)
}

fn canonical_utc_timestamp(value: &str) -> Option<String> {
    let millis = parse_utc_timestamp_millis(value)?;
    Some(iso8601_from_unix_millis(millis))
}

fn parse_utc_timestamp_millis(value: &str) -> Option<u64> {
    let legacy_digits = value.strip_suffix('Z').unwrap_or(value);
    if (11..=16).contains(&legacy_digits.len())
        && legacy_digits.bytes().all(|byte| byte.is_ascii_digit())
    {
        return legacy_digits.parse().ok();
    }

    let bytes = value.as_bytes();
    let valid_length = bytes.len() == 20 || (22..=24).contains(&bytes.len());
    if !valid_length
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
        || bytes.last() != Some(&b'Z')
    {
        return None;
    }
    let fraction_millis = if bytes.len() == 20 {
        0
    } else {
        if bytes.get(19) != Some(&b'.') {
            return None;
        }
        let fraction = &value[20..value.len() - 1];
        if fraction.is_empty()
            || fraction.len() > 3
            || !fraction.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        fraction.parse::<u64>().ok()? * 10_u64.pow((3 - fraction.len()) as u32)
    };
    let number = |start: usize, end: usize| value.get(start..end)?.parse::<u64>().ok();
    let year = number(0, 4)?;
    let month = number(5, 7)?;
    let day = number(8, 10)?;
    let hour = number(11, 13)?;
    let minute = number(14, 16)?;
    let second = number(17, 19)?;
    if year < 1970
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let days = days_from_civil(year as i64, month as i64, day as i64);
    if days < 0 {
        return None;
    }
    let seconds = (days as u64)
        .checked_mul(86_400)?
        .checked_add(hour * 3_600 + minute * 60 + second)?;
    seconds.checked_mul(1_000)?.checked_add(fraction_millis)
}

fn days_in_month(year: u64, month: u64) -> u64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

fn days_from_civil(mut year: i64, month: i64, day: i64) -> i64 {
    if month <= 2 {
        year -= 1;
    }
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_prime = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn iso8601_from_unix_millis(millis: u64) -> String {
    let seconds = millis / 1_000;
    let days = (seconds / 86_400) as i64;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_date_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis_part:03}Z",
        millis_part = millis % 1_000,
    )
}

// Gregorian civil-date conversion for days since 1970-01-01.  Keeping this
// tiny conversion local avoids another runtime dependency just to timestamp
// game records in standards-compliant ISO 8601.
fn civil_date_from_days(days_since_epoch: i64) -> (i64, u64, u64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month as u64, day as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_reports_the_commit_compiled_into_the_binary() {
        assert!(health_json().contains(&format!("\"gitCommit\":\"{}\"", GIT_COMMIT)));
    }

    #[test]
    fn model_metadata_includes_pathway_and_experimental_models() {
        assert!(model_json().contains(MYRMIDON_5));
        assert!(model_json().contains(MODEL_9_1));
        assert!(model_json().contains(MODEL_9_11));
        assert!(model_json().contains("schell_table-peg_table-13.1"));
        assert!(model_json().contains("schell_table-peg_table-16.0"));
        assert!(model_json().contains("schell_table-peg_table-16.1"));
        assert!(model_json().contains("schell_table-peg_table-16.3"));
        assert!(model_json().contains(DYNAMIC));
    }

    #[test]
    fn pathway_models_are_preserved_in_new_server_sessions() {
        for model in [
            ModelId::Myrmidon5,
            ModelId::Schell91,
            ModelId::Schell911,
            ModelId::Schell13,
            ModelId::Dynamic,
        ] {
            let session = new_session_from_seed(model, Some("Player".to_string()), 0x1234_5678, 1);
            assert_eq!(session.model, model);
            assert!(
                snapshot_json(&session).contains(&format!("\"opponent\":\"{}\"", model.as_str()))
            );
        }
    }

    #[test]
    fn lower_opponent_new_does_not_resume_a_saved_master_game() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-model-session-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        let server = Server {
            state: Mutex::new(AppState::default()),
            model_root: String::new(),
            data_dir: data_dir.clone(),
        };
        let master = game_action(
            &server,
            &json!({"action": "new", "opponent": MODEL_13_0, "tag": "Garrett"}).to_string(),
            None,
        );
        assert_eq!(master.status, 200);
        let master_response = serde_json::from_str::<Value>(&master.body).unwrap();
        let master_game_id = master_response["snapshot"]["gameId"].as_str().unwrap();
        let cut = game_action(
            &server,
            &json!({"action": "cut-for-deal", "gameId": master_game_id, "tag": "Garrett"})
                .to_string(),
            None,
        );
        assert_eq!(cut.status, 200);
        let easy = game_action(
            &server,
            &json!({"action": "new", "opponent": MYRMIDON_5, "tag": "Garrett"}).to_string(),
            None,
        );
        assert_eq!(easy.status, 200);
        let response = serde_json::from_str::<Value>(&easy.body).unwrap();
        assert_eq!(response["snapshot"]["opponent"], MYRMIDON_5);

        let resumed_master = game_action(
            &server,
            &json!({"action": "new", "opponent": MODEL_13_0, "tag": "Garrett"}).to_string(),
            None,
        );
        let resumed = serde_json::from_str::<Value>(&resumed_master.body).unwrap();
        assert_eq!(resumed["snapshot"]["gameId"], master_game_id);

        let forfeit = game_action(
            &server,
            &json!({"action": "forfeit", "gameId": master_game_id, "tag": "Garrett"}).to_string(),
            None,
        );
        assert_eq!(forfeit.status, 200);
        let replacement_master = game_action(
            &server,
            &json!({"action": "new", "opponent": MODEL_13_0, "tag": "Garrett"}).to_string(),
            None,
        );
        let replacement = serde_json::from_str::<Value>(&replacement_master.body).unwrap();
        assert_ne!(replacement["snapshot"]["gameId"], master_game_id);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn guest_access_allows_easy_and_tough_but_requires_login_for_master() {
        let server = Server {
            state: Mutex::new(AppState::default()),
            model_root: String::new(),
            data_dir: std::env::temp_dir().join("cribbage-unused-guest-access"),
        };
        assert!(!game_action_requires_auth(
            &server,
            &json!({"action": "new", "payload": {"opponent": MYRMIDON_5}}).to_string(),
        ));
        assert!(!game_action_requires_auth(
            &server,
            &json!({"action": "new", "payload": {"opponent": MODEL_9_1}}).to_string(),
        ));
        assert!(!game_action_requires_auth(
            &server,
            &json!({"action": "new", "payload": {"opponent": MODEL_9_11}}).to_string(),
        ));
        assert!(game_action_requires_auth(
            &server,
            &json!({"action": "new", "payload": {"opponent": MODEL_13_0}}).to_string(),
        ));
        assert!(game_action_requires_auth(
            &server,
            &json!({"action": "new", "payload": {"opponent": DYNAMIC}}).to_string(),
        ));
    }

    #[test]
    fn score_cycles_do_not_change_dynamic_decision_quality_profile() {
        let mut session = new_session_from_seed(ModelId::Dynamic, None, 0x1234_5678, 1);
        assert_eq!(session.decision_model(), ModelId::Myrmidon5);

        let dynamic = session.dynamic.as_mut().expect("dynamic state");
        assert!(!dynamic.complete_hand(HUMAN, [14, 10], session.seed));
        assert!(dynamic.complete_hand(AI, [28, 20], session.seed));
        assert_eq!(dynamic.profile().complete_cycles, 0);
        assert_eq!(dynamic.profile().strength, 0);
    }

    #[test]
    fn pathway_models_complete_server_authoritative_ai_discards() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        for model in [
            ModelId::Myrmidon5,
            ModelId::Schell91,
            ModelId::Schell13,
            ModelId::Dynamic,
        ] {
            let mut session = new_session_from_seed(model, None, 0x1234_5678, 1);
            session.waiting_for_deal_cut = false;
            let human_discards = [
                session.game.player(HUMAN).hand[0].id,
                session.game.player(HUMAN).hand[1].id,
            ];
            session.game.discard(HUMAN, human_discards).unwrap();
            session.waiting_for_ai_discard = true;

            apply_action(&mut session, "finish-discard", "{}", root.to_str().unwrap()).unwrap();

            assert!(!session.waiting_for_ai_discard);
            assert_eq!(session.game.player(AI).hand.len(), 4);
            assert_eq!(session.game.crib.len(), 4);
        }
    }

    #[test]
    fn public_pegging_cards_preserve_current_and_completed_series_owners() {
        let mut session = new_session(ModelId::Schell13, None);
        session.waiting_for_deal_cut = false;
        session.turn_card_revealed = true;
        session.game.phase = Phase::Pegging;
        session.game.plays = vec![Card::new(3).unwrap(), Card::new(4).unwrap()];
        session.game.play_owners = vec![HUMAN, AI];
        session.game.completed_plays = vec![vec![Card::new(1).unwrap(), Card::new(2).unwrap()]];
        session.game.completed_play_owners = vec![vec![AI, HUMAN]];

        let state = serde_json::from_str::<Value>(&game_state_json(&session)).unwrap();
        assert_eq!(state["plays"][0]["owner"], "human");
        assert_eq!(state["plays"][1]["owner"], "ai");
        assert_eq!(state["completedPlays"][0][0]["owner"], "ai");
        assert_eq!(state["completedPlays"][0][1]["owner"], "human");

        let snapshot = serde_json::from_str::<Value>(&snapshot_json(&session)).unwrap();
        assert_eq!(snapshot["completedPlayOwners"][0][0], "ai");
        assert_eq!(snapshot["completedPlayOwners"][0][1], "human");
    }

    #[test]
    fn leaderboard_summary_preserves_players_wins_and_skunks() {
        let uploads = HashMap::from([
            (
                "garrett-win".to_string(),
                UploadedGame {
                    game_id: "garrett-win".to_string(),
                    player: "Garrett".to_string(),
                    winner: Some("human".to_string()),
                    result: "skunk".to_string(),
                    human_score: 121,
                    ai_score: 90,
                    model: "schell_table-peg_table-15.2".to_string(),
                    ended_at: "2026-07-01T00:00:00Z".to_string(),
                    human_scoring: ScoringTotals::default(),
                    ai_scoring: ScoringTotals::default(),
                    analyzed: false,
                    errors: 0,
                },
            ),
            (
                "kurtis-loss".to_string(),
                UploadedGame {
                    game_id: "kurtis-loss".to_string(),
                    player: "Kurtis".to_string(),
                    winner: Some("ai".to_string()),
                    result: "regular".to_string(),
                    human_score: 111,
                    ai_score: 121,
                    model: "schell_table-peg_table-13.0".to_string(),
                    ended_at: "2026-07-02T00:00:00Z".to_string(),
                    human_scoring: ScoringTotals::default(),
                    ai_scoring: ScoringTotals::default(),
                    analyzed: false,
                    errors: 0,
                },
            ),
        ]);

        let summary = leaderboard_summary_json(&uploads);

        assert!(summary.contains("\"games\":2"));
        assert!(summary.contains("\"player\":\"Garrett\""));
        assert!(summary.contains("\"player\":\"Kurtis\""));
        assert!(summary.contains("\"bestWins\":[{\"player\":\"Garrett\""));
        assert!(summary.contains("\"mostSkunks\":[{\"player\":\"Garrett\""));
    }

    #[test]
    fn leaderboard_summary_groups_lifetime_stats_by_opponent_family() {
        let uploads = HashMap::from([
            (
                "ace-loss".to_string(),
                UploadedGame {
                    game_id: "ace-loss".to_string(),
                    player: "Garrett".to_string(),
                    winner: Some("ai".to_string()),
                    result: "regular".to_string(),
                    human_score: 112,
                    ai_score: 121,
                    model: "schell_table-peg_table-13.0".to_string(),
                    ended_at: "2026-09-01T00:00:00Z".to_string(),
                    human_scoring: ScoringTotals::default(),
                    ai_scoring: ScoringTotals::default(),
                    analyzed: false,
                    errors: 0,
                },
            ),
            (
                "easy-win".to_string(),
                UploadedGame {
                    game_id: "easy-win".to_string(),
                    player: "Garrett".to_string(),
                    winner: Some("human".to_string()),
                    result: "skunk".to_string(),
                    human_score: 121,
                    ai_score: 88,
                    model: "myrmidon-5".to_string(),
                    ended_at: "2026-09-02T00:00:00Z".to_string(),
                    human_scoring: ScoringTotals::default(),
                    ai_scoring: ScoringTotals::default(),
                    analyzed: false,
                    errors: 0,
                },
            ),
        ]);

        let handicaps = HashMap::from([(
            "Garrett".to_string(),
            json!({
                "wpPerGame": -0.125,
                "cycles": 8,
                "cyclesPerGame": 5.0,
                "evaluatorVersion": "ace-13.0",
            }),
        )]);
        let summary = serde_json::from_str::<Value>(&leaderboard_summary_json_with_handicaps(
            &uploads, &handicaps,
        ))
        .unwrap();
        assert_eq!(summary["playerStats"][0]["games"], 2);
        assert_eq!(summary["playerStatsByOpponent"]["master"][0]["games"], 1);
        assert_eq!(summary["playerStatsByOpponent"]["master"][0]["losses"], 1);
        assert_eq!(summary["playerStatsByOpponent"]["easy"][0]["games"], 1);
        assert_eq!(summary["playerStatsByOpponent"]["easy"][0]["wins"], 1);
        assert_eq!(summary["playerStatsByOpponent"]["easy"][0]["skunks"], 1);
        assert_eq!(summary["playerHandicaps"]["Garrett"]["wpPerGame"], -0.125);
    }

    #[test]
    fn leaderboard_scoring_uses_all_persisted_score_events_and_hand_counts() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-scoring-stats-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        let server = Server {
            state: Mutex::new(AppState {
                sessions: HashMap::new(),
                uploads: HashMap::new(),
                leaderboard_summary: leaderboard_summary_json(&HashMap::new()),
            }),
            model_root: String::new(),
            data_dir: data_dir.clone(),
        };
        let game = r#"{
          "gameId":"scored-game",
          "tag":"Garrett",
          "winner":"human",
          "result":"regular",
          "model":"schell_table-peg_table-13.0",
          "human":121,
          "ai":110,
          "events":[
            {"type":"score","player":"human","category":"pegging","role":"dealer","handNumber":1,"points":2},
            {"type":"score","player":"human","category":"pegging","role":"dealer","handNumber":1,"points":3},
            {"type":"score","player":"human","category":"hand","role":"dealer","handNumber":1,"points":10},
            {"type":"score","player":"human","category":"crib","role":"dealer","handNumber":1,"points":6},
            {"type":"score","player":"ai","category":"pegging","role":"pone","handNumber":1,"points":4},
            {"type":"score","player":"ai","category":"hand","role":"pone","handNumber":1,"points":8}
          ]
        }"#;

        upload_game(&server, game);
        let second_game = r#"{
          "gameId":"second-scored-game",
          "tag":"Garrett",
          "winner":"ai",
          "result":"regular",
          "model":"schell_table-peg_table-13.0",
          "human":115,
          "ai":121,
          "events":[
            {"type":"score","player":"human","category":"pegging","role":"dealer","handNumber":1,"points":4},
            {"type":"score","player":"ai","category":"pegging","role":"pone","handNumber":1,"points":3}
          ]
        }"#;
        let response = upload_game(&server, second_game);
        let response_json = serde_json::from_str::<Value>(&response.body).unwrap();
        let row = &response_json["leaderboard"]["playerStats"][0];
        assert_eq!(row["scoringGames"], 2);
        assert_eq!(row["humanScoring"]["peggingDealer"], 9);
        assert_eq!(row["humanScoring"]["peggingDealerHands"], 2);
        assert_eq!(row["humanScoring"]["crib"], 6);
        assert_eq!(row["aiScoring"]["handPone"], 8);

        let reloaded = load_uploads(&data_dir).unwrap();
        let reloaded_summary =
            serde_json::from_str::<Value>(&leaderboard_summary_json(&reloaded)).unwrap();
        let reloaded_row = &reloaded_summary["playerStats"][0];
        assert_eq!(reloaded_row["humanScoring"]["peggingDealer"], 9);
        assert_eq!(reloaded_row["humanScoring"]["peggingDealerHands"], 2);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn analyzed_uploads_count_reviewed_human_decision_errors() {
        let payload = r#"{
          "events":[
            {"type":"discard","player":"human","review":{"selected":["5C","6D"],"recommended":["6D","7H"],"winProbabilityDelta":0.01}},
            {"type":"pegging","action":"play","player":"human","review":{"selected":["8S"],"recommended":["8S"],"winProbabilityDelta":0.05}},
            {"type":"discard","player":"ai","review":{"selected":["AC","2D"],"recommended":["3H","4S"],"winProbabilityDelta":0.05}}
          ]
        }"#;

        assert_eq!(decision_errors_from_upload(payload), (true, 1));
    }

    #[test]
    fn reuploading_analyzed_game_refreshes_lifetime_error_totals() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-analysis-upload-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        let server = Server {
            state: Mutex::new(AppState {
                sessions: HashMap::new(),
                uploads: HashMap::new(),
                leaderboard_summary: leaderboard_summary_json(&HashMap::new()),
            }),
            model_root: String::new(),
            data_dir: data_dir.clone(),
        };
        let game = r#"{"gameId":"analyzed-game","tag":"Garrett","winner":"human","result":"regular","model":"schell_table-peg_table-13.0","human":121,"ai":100,"events":[]}"#;
        let analyzed_game = r#"{"gameId":"analyzed-game","tag":"Garrett","winner":"human","result":"regular","model":"schell_table-peg_table-13.0","human":121,"ai":100,"events":[{"type":"discard","player":"human","review":{"selected":["5C","6D"],"recommended":["6D","7H"],"winProbabilityDelta":0.01}}]}"#;

        upload_game(&server, game);
        let refreshed = upload_game(&server, analyzed_game);
        let refreshed_json = serde_json::from_str::<Value>(&refreshed.body).unwrap();
        let row = &refreshed_json["leaderboard"]["playerStats"][0];
        assert!(refreshed.body.contains("\"updated\":false"));
        assert_eq!(row["analyzedGames"], 1);
        assert_eq!(row["errors"], 1);

        let reloaded = load_uploads(&data_dir).unwrap();
        let reloaded_summary =
            serde_json::from_str::<Value>(&leaderboard_summary_json(&reloaded)).unwrap();
        let reloaded_row = &reloaded_summary["playerStats"][0];
        assert_eq!(reloaded_row["analyzedGames"], 1);
        assert_eq!(reloaded_row["errors"], 1);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn leaderboard_ranks_by_weighted_wins_and_skunk_results() {
        let mut rows = vec![
            (
                "Skunk split".to_string(),
                PlayerTotals {
                    games: 2,
                    wins: 1,
                    losses: 1,
                    skunks: 1,
                    skunked: 1,
                    points: 2,
                    ..PlayerTotals::default()
                },
            ),
            (
                "Two of three".to_string(),
                PlayerTotals {
                    games: 3,
                    wins: 2,
                    losses: 1,
                    points: 2,
                    ..PlayerTotals::default()
                },
            ),
        ];

        rows.sort_by(compare_leaderboard_players);

        assert_eq!(rows[0].0, "Two of three");
        assert_eq!(rows[1].0, "Skunk split");
    }

    #[test]
    fn leaderboard_totals_change_only_for_a_new_completed_game() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-leaderboard-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        let uploads = HashMap::new();
        let server = Server {
            state: Mutex::new(AppState {
                sessions: HashMap::new(),
                uploads,
                leaderboard_summary: leaderboard_summary_json(&HashMap::new()),
            }),
            model_root: String::new(),
            data_dir: data_dir.clone(),
        };
        let game = r#"{"gameId":"finished-game","tag":"Garrett","winner":"human","result":"regular","model":"schell_table-peg_table-13.0","human":121,"ai":100}"#;

        let first = upload_game(&server, game);
        assert!(first.body.contains("\"updated\":true"));
        assert!(first.body.contains("\"games\":1"));
        let cached_after_first = leaderboard_json(&server).unwrap();

        let duplicate = upload_game(&server, game);
        assert!(duplicate.body.contains("\"updated\":false"));
        assert_eq!(leaderboard_json(&server).unwrap(), cached_after_first);
        assert_eq!(server.state.lock().unwrap().uploads.len(), 1);

        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn historical_batch_uploads_preserve_each_completed_game_time() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-historical-upload-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        let server = Server {
            state: Mutex::new(AppState {
                sessions: HashMap::new(),
                uploads: HashMap::new(),
                leaderboard_summary: leaderboard_summary_json(&HashMap::new()),
            }),
            model_root: String::new(),
            data_dir: data_dir.clone(),
        };
        let june_game = r#"{"gameId":"game-mqw4gr42-a76tvpv","tag":"Garrett","model":"schell_table-peg_table-13.0","finalResult":{"at":"2026-06-27T09:12:34.567Z","winner":"human","result":"regular","finalScores":{"human":121,"ai":119}}}"#;
        let july_game = r#"{"gameId":"game-mrdnucml-p0cssyr","tag":"Garrett","model":"schell_table-peg_table-13.0","finalResult":{"at":"2026-07-09T15:49:01.234Z","winner":"human","result":"regular","finalScores":{"human":121,"ai":118}}}"#;

        upload_game(&server, june_game);
        let response = upload_game(&server, july_game);

        assert!(response
            .body
            .contains("\"endedAt\":\"2026-06-27T09:12:34.567Z\""));
        assert!(response
            .body
            .contains("\"endedAt\":\"2026-07-09T15:49:01.234Z\""));
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn historical_upload_without_a_valid_end_time_uses_the_game_start_time() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-historical-fallback-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        let server = Server {
            state: Mutex::new(AppState {
                sessions: HashMap::new(),
                uploads: HashMap::new(),
                leaderboard_summary: leaderboard_summary_json(&HashMap::new()),
            }),
            model_root: String::new(),
            data_dir: data_dir.clone(),
        };
        let game = r#"{"gameId":"game-mqw4gr42-a76tvpv","tag":"Garrett","model":"schell_table-peg_table-13.0","finalResult":{"at":"2026-02-30T12:00:00.000Z","winner":"human","result":"regular","finalScores":{"human":121,"ai":119}}}"#;

        let response = upload_game(&server, game);

        assert!(response
            .body
            .contains("\"endedAt\":\"2026-06-27T08:52:48.578Z\""));
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn lower_deal_cut_receives_first_deal_and_crib() {
        let human_two = Card::new(1).unwrap();
        let ai_five = Card::new(4).unwrap();
        let first_deal = first_dealer_for_deal_cuts([human_two, ai_five]).unwrap();
        let game = CribbageGame::new_with_seed(17, first_deal);

        assert_eq!(first_deal, HUMAN);
        assert_eq!(game.first_deal, HUMAN);
        assert_eq!(game.dealer, HUMAN);
        assert_eq!(game.pone, AI);
    }

    #[test]
    fn tied_deal_cuts_are_recut_before_a_result_is_shown() {
        let ace_diamonds = Card::new(0).unwrap();
        let ace_clubs = Card::new(13).unwrap();
        let human_two = Card::new(1).unwrap();
        let ai_five = Card::new(4).unwrap();

        assert_eq!(
            first_non_tied_deal_cuts(&[ace_diamonds, ace_clubs, human_two, ai_five]),
            Some([human_two, ai_five])
        );
    }

    #[test]
    fn generated_deal_cuts_are_distinct_and_have_a_matching_dealer() {
        for seed in 0..1_024 {
            let cuts = deal_cuts_for_seed(seed);
            assert_ne!(cuts[0].id, cuts[1].id);
            assert_ne!(cuts[0].rank, cuts[1].rank);
            assert_eq!(
                first_dealer_for_deal_cuts(cuts),
                Some(if cuts[0].rank < cuts[1].rank {
                    HUMAN
                } else {
                    AI
                })
            );

            let session = new_session_from_seed(ModelId::Schell13, None, seed, 1);
            assert_eq!(
                session.game.first_deal,
                first_dealer_for_deal_cuts(session.deal_cuts).unwrap()
            );
            assert_eq!(session.game.dealer, session.game.first_deal);
        }
    }

    #[test]
    fn snapshot_redacts_ai_hand_and_complete_crib() {
        let mut session = new_session(ModelId::Schell13, None);
        session.waiting_for_deal_cut = false;
        let dealer = session.game.dealer;
        let pone = session.game.pone;
        let dealer_discards = [
            session.game.player(dealer).hand[0].id,
            session.game.player(dealer).hand[1].id,
        ];
        let pone_discards = [
            session.game.player(pone).hand[0].id,
            session.game.player(pone).hand[1].id,
        ];
        session.game.discard(dealer, dealer_discards).unwrap();
        session.game.discard(pone, pone_discards).unwrap();

        let snapshot = snapshot_json(&session);
        let ai_hand = number_array_json(
            &session
                .game
                .player(AI)
                .hand
                .iter()
                .map(|card| card.id)
                .collect::<Vec<_>>(),
        );

        assert!(snapshot.contains("\"ai\":{\"hand\":[]"));
        assert!(!snapshot.contains(&format!("\"hand\":{}", ai_hand)));
        assert_eq!(snapshot.matches("\"crib\":[]").count(), 3);
    }

    #[test]
    fn turn_card_stays_private_until_the_reveal_action() {
        let mut session = new_session(ModelId::Schell13, None);
        session.waiting_for_deal_cut = false;
        let turn_card = session.game.turn_card;
        let dealer = session.game.dealer;
        let pone = session.game.pone;
        let dealer_discards = [
            session.game.player(dealer).hand[0].id,
            session.game.player(dealer).hand[1].id,
        ];
        let pone_discards = [
            session.game.player(pone).hand[0].id,
            session.game.player(pone).hand[1].id,
        ];

        assert!(game_state_json(&session).contains("\"turnCard\":null,\"turnCardRevealed\":false"));
        assert!(snapshot_json(&session).contains("\"turnCard\":null,\"turnCardRevealed\":false"));
        assert!(!snapshot_json(&session).contains("\"rngState\""));

        session.game.discard(dealer, dealer_discards).unwrap();
        session.game.discard(pone, pone_discards).unwrap();
        assert_eq!(session.game.phase, Phase::Pegging);
        assert!(game_state_json(&session).contains("\"turnCard\":null,\"turnCardRevealed\":false"));
        assert!(snapshot_json(&session).contains("\"turnCard\":null,\"turnCardRevealed\":false"));

        apply_action(&mut session, "reveal-turn-card", "{}", ".").unwrap();

        assert!(game_state_json(&session).contains(&format!(
            "\"turnCard\":{},\"turnCardRevealed\":true",
            card_json(turn_card, None)
        )));
        assert!(snapshot_json(&session).contains(&format!(
            "\"turnCard\":{},\"turnCardRevealed\":true",
            turn_card.id
        )));
    }

    #[test]
    fn scoring_is_revealed_one_stage_at_a_time_with_a_breakdown() {
        let mut session = new_session(ModelId::Schell13, None);
        session.waiting_for_deal_cut = false;
        session.turn_card_revealed = true;
        let pone = session.game.pone;
        let dealer = session.game.dealer;
        session.game.phase = Phase::PeggingComplete;
        session.game.turn_card = Card::new(8).unwrap();
        session.game.player_mut(pone).table = vec![
            Card::new(4).unwrap(),
            Card::new(5).unwrap(),
            Card::new(6).unwrap(),
            Card::new(7).unwrap(),
        ];
        session.game.player_mut(dealer).table = vec![
            Card::new(9).unwrap(),
            Card::new(10).unwrap(),
            Card::new(11).unwrap(),
            Card::new(12).unwrap(),
        ];
        session.game.player_mut(dealer).crib = vec![
            Card::new(13).unwrap(),
            Card::new(14).unwrap(),
            Card::new(15).unwrap(),
            Card::new(16).unwrap(),
        ];

        apply_action(&mut session, "continue-scoring", "{}", ".").unwrap();
        let pone_state = game_state_json(&session);
        assert_eq!(session.game.phase, Phase::ScorePone);
        assert!(pone_state.contains("\"phase\":\"score_pone\""));
        assert!(pone_state.contains("\"stage\":\"pone\""));
        assert!(pone_state.contains("\"fifteens\":4"));
        assert!(pone_state.contains("\"runs\":5"));
        assert!(pone_state.contains("\"flush\":5"));

        apply_action(&mut session, "continue-scoring", "{}", ".").unwrap();
        assert_eq!(session.game.phase, Phase::ScoreDealer);
        assert!(game_state_json(&session).contains("\"stage\":\"dealer\""));

        apply_action(&mut session, "continue-scoring", "{}", ".").unwrap();
        assert_eq!(session.game.phase, Phase::ScoreCrib);
        assert!(game_state_json(&session).contains("\"stage\":\"crib\""));

        assert!(apply_action(&mut session, "prepare-next-hand-ai-discard", "{}", ".").is_err());
        assert_eq!(session.game.phase, Phase::ScoreCrib);
        assert!(game_state_json(&session).contains("\"stage\":\"crib\""));

        apply_action(&mut session, "continue-scoring", "{}", ".").unwrap();
        assert_eq!(session.game.phase, Phase::Discard);
    }

    #[test]
    fn scoring_progress_does_not_create_dynamic_calibration_evidence() {
        let mut session = new_session_from_seed(ModelId::Dynamic, None, 0x1234_5678, 1);
        session.waiting_for_deal_cut = false;
        session.turn_card_revealed = true;
        session.game.turn_card = Card::new(8).unwrap();
        session.game.phase = Phase::ScorePone;

        apply_action(&mut session, "continue-scoring", "{}", ".").unwrap();
        assert_eq!(
            session.dynamic.as_ref().unwrap().profile().complete_cycles,
            0
        );

        apply_action(&mut session, "continue-scoring", "{}", ".").unwrap();
        assert_eq!(
            session.dynamic.as_ref().unwrap().profile().complete_cycles,
            0
        );

        session.game.dealer = session.game.dealer.other();
        session.game.pone = session.game.dealer.other();
        session.game.phase = Phase::ScoreDealer;
        apply_action(&mut session, "continue-scoring", "{}", ".").unwrap();
        assert_eq!(
            session.dynamic.as_ref().unwrap().profile().complete_cycles,
            0
        );
    }

    #[test]
    fn analytics_include_score_events_for_completed_scoring_stages() {
        let mut session = new_session(ModelId::Schell13, None);
        session.waiting_for_deal_cut = false;
        session.turn_card_revealed = true;
        let pone = session.game.pone;
        session.game.phase = Phase::PeggingComplete;
        session.game.turn_card = Card::new(8).unwrap();
        session.game.player_mut(pone).table = vec![
            Card::new(4).unwrap(),
            Card::new(5).unwrap(),
            Card::new(6).unwrap(),
            Card::new(7).unwrap(),
        ];

        apply_action(&mut session, "continue-scoring", "{}", ".").unwrap();

        let analytics = analytics_events_json(&session);
        assert!(analytics.contains("\"type\":\"score\""));
        assert!(analytics.contains("\"category\":\"hand\""));
        assert!(analytics.contains("\"scoreComponents\":"));
        assert!(analytics.contains("\"runs\":5"));
    }

    #[test]
    fn pegging_score_events_include_pair_royal_components() {
        let mut session = new_session(ModelId::Schell13, None);
        session.waiting_for_deal_cut = false;
        session.turn_card_revealed = true;
        session.game.phase = Phase::Pegging;
        session.game.dealer = HUMAN;
        session.game.pone = AI;
        session.game.turn = cribbage_shadow_engine::game::PegTurn::Dealer;
        session.game.count = 16;
        session.game.plays = vec![Card::new(7).unwrap(), Card::new(20).unwrap()];
        session.game.play_owners = vec![AI, HUMAN];
        session.game.player_mut(HUMAN).hand = vec![Card::new(33).unwrap(), Card::new(1).unwrap()];
        session.game.player_mut(AI).hand = vec![Card::new(2).unwrap()];

        apply_action(&mut session, "play-human", "{\"id\":33}", ".").unwrap();

        let analytics = analytics_events_json(&session);
        assert!(analytics.contains("\"category\":\"pegging\""));
        assert!(analytics.contains("\"scoreComponents\":{\"total\":6"));
        assert!(analytics.contains("\"pairs\":6"));
    }

    #[test]
    fn final_hand_is_shown_before_the_game_over_result() {
        let mut session = new_session(ModelId::Schell13, None);
        session.waiting_for_deal_cut = false;
        session.turn_card_revealed = true;
        session.game.phase = Phase::PeggingComplete;
        session.game.dealer = AI;
        session.game.pone = HUMAN;
        session.game.turn_card = Card::new(8).unwrap();
        session.game.player_mut(HUMAN).score = 110;
        session.game.player_mut(HUMAN).table = vec![
            Card::new(4).unwrap(),
            Card::new(5).unwrap(),
            Card::new(6).unwrap(),
            Card::new(7).unwrap(),
        ];

        apply_action(&mut session, "continue-scoring", "{}", ".").unwrap();

        assert_eq!(session.game.phase, Phase::GameOver);
        assert!(session.pending_final_scoring.is_some());
        let count = game_state_json(&session);
        assert!(count.contains("\"phase\":\"score_pone\""));
        assert!(count.contains("\"nextLabel\":\"View game result\""));
        assert!(count.contains("\"result\":[]"));
        assert!(!analytics_events_json(&session).contains("\"action\":\"end\""));

        apply_action(&mut session, "continue-scoring", "{}", ".").unwrap();
        assert!(session.pending_final_scoring.is_none());
        assert!(game_state_json(&session).contains("\"phase\":\"game_over\""));
        assert!(analytics_events_json(&session).contains("\"action\":\"end\""));
    }

    #[test]
    fn durable_sessions_restore_private_game_state_and_action_history() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-durable-session-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        let mut session = new_session_from_seed(
            ModelId::Schell13,
            Some("Garrett".to_string()),
            0x1234_5678,
            1,
        );
        let ai_private_card = session.game.player(AI).hand[0].id;
        session.event_sequence = 1;
        persist_session_event(&data_dir, &session, "new", "{\"action\":\"new\"}").unwrap();

        let restored = load_session_by_id(&data_dir, &session.id).unwrap().unwrap();
        assert_eq!(restored.id, session.id);
        assert_eq!(restored.tag.as_deref(), Some("Garrett"));
        assert_eq!(restored.seed, 0x1234_5678);
        assert_eq!(restored.game.player(AI).hand[0].id, ai_private_card);
        assert_eq!(restored.event_sequence, 1);

        let connection = open_game_database(&data_dir).unwrap();
        let events: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM cribbage_game_events WHERE session_id = ?1",
                [session.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(events, 1);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    fn completed_review(selected: f64, recommended: f64) -> CompletedDecisionReview {
        CompletedDecisionReview {
            evaluator_model: DYNAMIC_EVALUATOR_VERSION.to_string(),
            selected_card_ids: vec![0],
            recommended_card_ids: vec![1],
            selected_ev: 0.0,
            recommended_ev: 0.0,
            selected_win_probability: Some(selected),
            recommended_win_probability: Some(recommended),
        }
    }

    fn calibration_review(
        id: &str,
        hand_number: u32,
        human_is_dealer: bool,
        kind: ReviewKind,
        selected: f64,
        recommended: f64,
    ) -> SavedDecisionReview {
        use cribbage_shadow_engine::game::PegTurn;

        let mut game = CribbageGame::new_with_seed(hand_number, HUMAN);
        game.hand_number = hand_number;
        game.dealer = if human_is_dealer { HUMAN } else { AI };
        game.pone = game.dealer.other();
        let selected_card_ids = match kind {
            ReviewKind::Discard => vec![0, 1],
            ReviewKind::Peg => {
                game.phase = Phase::Pegging;
                game.turn = if human_is_dealer {
                    PegTurn::Dealer
                } else {
                    PegTurn::Pone
                };
                game.count = 0;
                game.player_mut(HUMAN).hand = vec![Card::new(0).unwrap(), Card::new(2).unwrap()];
                vec![0]
            }
        };
        SavedDecisionReview {
            id: id.to_string(),
            at: isoish_now(),
            kind,
            game,
            selected_card_ids,
            completed: Some(completed_review(selected, recommended)),
            prior_analyses: Vec::new(),
            prepared_analysis: None,
        }
    }

    fn completed_hand_event(hand_number: u32, dealer: Side) -> SavedScoreEvent {
        SavedScoreEvent {
            id: format!("hand-{hand_number}-crib"),
            at: isoish_now(),
            hand_number,
            player: dealer,
            dealer,
            category: SavedScoreCategory::Crib,
            points: 0,
            reason: "Crib".to_string(),
            total_score: 0,
            scores: [0, 0],
            cards: Vec::new(),
            turn_card: None,
            count: None,
            score_components: None,
        }
    }

    fn reviewed_cycle_session(model: ModelId, id: &str) -> Session {
        let mut session = new_session_from_seed(model, Some("Travis".to_string()), 17, 1);
        session.id = id.to_string();
        session.game.hand_number = 3;
        session.game.phase = Phase::GameOver;
        session.score_events = vec![completed_hand_event(1, HUMAN), completed_hand_event(2, AI)];
        session.score_events[0].scores = [12, 10];
        session.score_events[1].scores = [24, 22];
        session.decision_reviews = vec![
            calibration_review("dealer-discard", 1, true, ReviewKind::Discard, 0.46, 0.50),
            calibration_review("dealer-peg-1", 1, true, ReviewKind::Peg, 0.48, 0.50),
            calibration_review("dealer-peg-2", 1, true, ReviewKind::Peg, 0.48, 0.50),
            calibration_review("pone-discard", 2, false, ReviewKind::Discard, 0.49, 0.50),
            calibration_review("pone-peg", 2, false, ReviewKind::Peg, 0.50, 0.50),
        ];
        session
    }

    #[test]
    fn reviewed_cycle_averages_each_role_and_decision_bucket_once() {
        let session = reviewed_cycle_session(ModelId::Myrmidon5, "easy-cycle");
        let samples = eligible_dynamic_cycle_samples(&session);

        assert_eq!(samples.len(), 1);
        let sample = samples[0].strength_sample;
        assert!((sample.dealer_discard_regret - 0.04).abs() < 1e-12);
        assert!((sample.dealer_pegging_regret - 0.02).abs() < 1e-12);
        assert!((sample.pone_discard_regret - 0.01).abs() < 1e-12);
        assert_eq!(sample.pone_pegging_regret, 0.0);
        assert!((sample.mean_regret() - 0.0175).abs() < 1e-12);
        assert!((sample.total_regret - 0.09).abs() < 1e-12);
    }

    #[test]
    fn handicap_cycle_requires_every_saved_decision_review() {
        let mut session = reviewed_cycle_session(ModelId::Myrmidon5, "incomplete-cycle");
        session.decision_reviews[0].completed = None;
        assert!(eligible_dynamic_cycle_samples(&session).is_empty());

        session.decision_reviews[0].completed = Some(completed_review(0.46, 0.50));
        assert_eq!(eligible_dynamic_cycle_samples(&session).len(), 1);
    }

    #[test]
    fn a_received_ace_tip_disqualifies_the_entire_cycle() {
        let mut session = reviewed_cycle_session(ModelId::Myrmidon5, "helped-cycle");
        session.help_events.push(SavedHelpEvent {
            id: "helped-cycle-help-1".to_string(),
            at: isoish_now(),
            hand_number: 2,
            decision_key: "helped-cycle:hand-2:discard".to_string(),
        });

        assert!(eligible_dynamic_cycle_samples(&session).is_empty());
    }

    #[test]
    fn proactive_ace_analysis_does_not_disqualify_a_cycle() {
        let mut session = reviewed_cycle_session(ModelId::Myrmidon5, "analyzed-cycle");
        let game = session.decision_reviews[0].game.clone();
        session
            .prepared_decision_analyses
            .push(PreparedDecisionAnalysis {
                decision_key: decision_analysis_key(ReviewKind::Discard, &game),
                evaluator_model: DYNAMIC_EVALUATOR_VERSION.to_string(),
                kind: ReviewKind::Discard,
                recommended: SavedDecisionValue {
                    card_ids: vec![0, 1],
                    ev: Some(0.0),
                    win_probability: Some(0.50),
                },
            });

        assert_eq!(eligible_dynamic_cycle_samples(&session).len(), 1);
    }

    #[test]
    fn in_progress_dynamic_handicap_uses_completed_cycle_regret() {
        let mut session = reviewed_cycle_session(ModelId::Dynamic, "live-cycle-handicap");
        session.game.phase = Phase::ScoreCrib;
        let sample = eligible_dynamic_cycle_samples(&session)[0].strength_sample;
        let mut profile = DynamicProfile::default();
        profile.observe_cycle(sample);
        let dynamic = session.dynamic.as_mut().unwrap();
        dynamic.use_profile(profile, session.seed);

        let state = serde_json::from_str::<Value>(&game_state_json(&session)).unwrap();
        let handicap = state["dynamicCalibration"]["provisionalHandicapPerGame"]
            .as_f64()
            .unwrap();
        assert!((handicap - (-0.09 * 4.516)).abs() < 1e-12);
    }

    #[test]
    fn forced_unreliable_and_terminal_plays_are_not_calibration_evidence() {
        use cribbage_shadow_engine::game::PegTurn;

        let mut session = reviewed_cycle_session(ModelId::Schell911, "filtered-cycle");
        let mut forced = calibration_review("forced", 1, true, ReviewKind::Peg, 0.0, 1.0);
        forced.game.player_mut(HUMAN).hand = vec![Card::new(0).unwrap()];
        let mut unreliable = calibration_review("unreliable", 1, true, ReviewKind::Peg, 0.0, 1.0);
        unreliable
            .completed
            .as_mut()
            .unwrap()
            .selected_win_probability = None;
        let mut terminal = calibration_review("terminal", 1, true, ReviewKind::Peg, 0.0, 1.0);
        terminal.game.player_mut(HUMAN).score = 119;
        terminal.game.plays = vec![Card::new(13).unwrap()];
        terminal.game.play_owners = vec![AI];
        terminal.game.count = 1;
        terminal.game.turn = PegTurn::Dealer;
        session
            .decision_reviews
            .extend([forced, unreliable, terminal]);

        let sample = eligible_dynamic_cycle_samples(&session)[0].strength_sample;
        assert!((sample.dealer_pegging_regret - 0.02).abs() < 1e-12);
        assert!((sample.total_regret - 0.09).abs() < 1e-12);
    }

    #[test]
    fn player_profile_is_idempotent_cross_opponent_and_evaluator_versioned() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-dynamic-profile-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        auth::initialize(&data_dir).unwrap();
        let connection = open_game_database(&data_dir).unwrap();
        let travis = connection
            .query_row(
                "SELECT id, username, display_name, email, password_hash
                 FROM auth_users WHERE username = 'Travis'",
                [],
                auth::user_from_row,
            )
            .unwrap();
        drop(connection);
        let easy = reviewed_cycle_session(ModelId::Myrmidon5, "easy-cycle");
        let tough = reviewed_cycle_session(ModelId::Schell911, "tough-cycle");
        let first = sync_dynamic_player_profile(&data_dir, travis.id, &easy)
            .unwrap()
            .unwrap();
        assert_eq!(first.complete_cycles, 1);
        assert_eq!(first.handicap_cycles, 1);
        assert!((first.ewma_cycle_handicap - -0.09).abs() < 1e-12);
        assert!(sync_dynamic_player_profile(&data_dir, travis.id, &easy)
            .unwrap()
            .is_none());
        let second = sync_dynamic_player_profile(&data_dir, travis.id, &tough)
            .unwrap()
            .unwrap();
        assert_eq!(second.complete_cycles, 2);
        assert_eq!(second.handicap_cycles, 2);
        assert!((second.ewma_cycle_handicap - -0.09).abs() < 1e-12);
        assert_eq!(
            load_dynamic_profile(&data_dir, travis.id).unwrap(),
            Some(second.clone())
        );

        let server = Server {
            state: Mutex::new(AppState::default()),
            model_root: String::new(),
            data_dir: data_dir.clone(),
        };
        let response = game_action(
            &server,
            &json!({"action": "new", "opponent": DYNAMIC, "tag": "Travis"}).to_string(),
            Some(&travis),
        );
        assert_eq!(response.status, 200);
        let response_json = serde_json::from_str::<Value>(&response.body).unwrap();
        assert_eq!(
            response_json["state"]["dynamicCalibration"]["started"],
            true
        );
        assert_eq!(
            response_json["state"]["dynamicCalibration"]["completeCycles"],
            2
        );
        assert_eq!(
            response_json["state"]["dynamicCalibration"]["minimumCycles"],
            MIN_COMPLETE_CYCLES
        );
        assert_eq!(
            response_json["state"]["dynamicCalibration"]["complete"],
            false
        );
        let provisional = response_json["state"]["dynamicCalibration"]
            ["provisionalHandicapPerGame"]
            .as_f64()
            .unwrap();
        assert!((provisional - second.handicap_per_game().unwrap()).abs() < 1e-12);
        let app = server.state.lock().unwrap();
        let inherited = app
            .sessions
            .values()
            .next()
            .unwrap()
            .dynamic
            .as_ref()
            .unwrap();
        assert!(inherited.profile().started_dynamic);
        assert_eq!(inherited.profile().complete_cycles, second.complete_cycles);
        assert_eq!(inherited.profile().handicap_cycles, second.handicap_cycles);
        assert_eq!(
            inherited.profile().ewma_cycle_handicap,
            second.ewma_cycle_handicap
        );
        drop(app);

        let connection = open_game_database(&data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO dynamic_player_profiles
                 (user_id, evaluator_version, profile_json, updated_at)
                 VALUES (?1, 'older-ace', '{}', ?2)",
                params![travis.id, isoish_now()],
            )
            .unwrap();
        let profile_versions: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM dynamic_player_profiles WHERE user_id = ?1",
                [travis.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(profile_versions, 2);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn player_profile_applies_later_cycles_from_the_same_dynamic_session() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-dynamic-multi-cycle-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        auth::initialize(&data_dir).unwrap();
        let connection = open_game_database(&data_dir).unwrap();
        let travis = connection
            .query_row(
                "SELECT id, username, display_name, email, password_hash
                 FROM auth_users WHERE username = 'Travis'",
                [],
                auth::user_from_row,
            )
            .unwrap();
        drop(connection);

        let mut session = reviewed_cycle_session(ModelId::Dynamic, "dynamic-multi-cycle");
        let first = sync_dynamic_player_profile(&data_dir, travis.id, &session)
            .unwrap()
            .unwrap();
        assert_eq!(first.complete_cycles, 1);
        session.use_dynamic_profile(first);
        persist_session_snapshot(&data_dir, &session).unwrap();
        let mut session = load_session_by_id(&data_dir, &session.id)
            .unwrap()
            .unwrap();
        assert_eq!(
            session.dynamic.as_ref().unwrap().profile().complete_cycles,
            1
        );

        session.game.hand_number = 5;
        session
            .score_events
            .extend([completed_hand_event(3, HUMAN), completed_hand_event(4, AI)]);
        session.decision_reviews.extend([
            calibration_review("dealer-discard-2", 3, true, ReviewKind::Discard, 0.45, 0.50),
            calibration_review("dealer-peg-2", 3, true, ReviewKind::Peg, 0.47, 0.50),
            calibration_review("pone-discard-2", 4, false, ReviewKind::Discard, 0.48, 0.50),
            calibration_review("pone-peg-2", 4, false, ReviewKind::Peg, 0.49, 0.50),
        ]);

        let second = sync_dynamic_player_profile(&data_dir, travis.id, &session)
            .unwrap()
            .unwrap();
        assert_eq!(second.complete_cycles, 2);
        assert_eq!(second.handicap_cycles, 2);
        session.use_dynamic_profile(second.clone());
        persist_session_snapshot(&data_dir, &session).unwrap();
        let resumed = load_session_by_id(&data_dir, &session.id)
            .unwrap()
            .unwrap();
        assert_eq!(
            resumed.dynamic.as_ref().unwrap().profile().complete_cycles,
            2
        );
        let resumed_handicap = resumed
            .dynamic
            .as_ref()
            .unwrap()
            .profile()
            .handicap_per_game()
            .unwrap();
        assert!((resumed_handicap - second.handicap_per_game().unwrap()).abs() < 1e-12);
        assert!(sync_dynamic_player_profile(&data_dir, travis.id, &session)
            .unwrap()
            .is_none());

        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn starting_dynamic_persists_zero_cycle_calibration() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-dynamic-start-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        auth::initialize(&data_dir).unwrap();
        let connection = open_game_database(&data_dir).unwrap();
        let travis = connection
            .query_row(
                "SELECT id, username, display_name, email, password_hash
                 FROM auth_users WHERE username = 'Travis'",
                [],
                auth::user_from_row,
            )
            .unwrap();
        drop(connection);
        let server = Server {
            state: Mutex::new(AppState::default()),
            model_root: String::new(),
            data_dir: data_dir.clone(),
        };

        let response = game_action(
            &server,
            &json!({"action": "new", "opponent": DYNAMIC, "tag": "Travis"}).to_string(),
            Some(&travis),
        );

        assert_eq!(response.status, 200);
        let response_json = serde_json::from_str::<Value>(&response.body).unwrap();
        let calibration = &response_json["state"]["dynamicCalibration"];
        assert_eq!(calibration["completeCycles"], 0);
        assert_eq!(calibration["minimumCycles"], MIN_COMPLETE_CYCLES);
        assert!(calibration["provisionalHandicapPerGame"].is_null());
        let saved = load_dynamic_profile(&data_dir, travis.id).unwrap().unwrap();
        assert!(saved.started_dynamic);
        assert_eq!(saved.complete_cycles, 0);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn ace_help_is_deduplicated_by_decision_and_emitted_as_analytics() {
        let mut session = new_session(ModelId::Myrmidon5, Some("Garrett".to_string()));
        let body = r#"{"decisionKey":"game:hand-1:discard"}"#;

        apply_action(&mut session, "record-help", body, ".").unwrap();
        apply_action(&mut session, "record-help", body, ".").unwrap();

        assert_eq!(session.help_events.len(), 1);
        let analytics = analytics_events_json(&session);
        assert!(analytics.contains("\"type\":\"help\""));
        assert!(analytics.contains("\"advisor\":\"Ace\""));
    }

    #[test]
    fn prepared_ace_analysis_is_logged_once_and_reused_by_the_saved_choice() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-api-prepared-analysis-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        let session = new_session_from_seed(ModelId::Myrmidon5, None, 17, 1);
        let session_id = session.id.clone();
        let game = session.game.clone();
        let selected = vec![game.player(HUMAN).hand[0].id, game.player(HUMAN).hand[1].id];
        let analysis = PreparedDecisionAnalysis {
            decision_key: decision_analysis_key(ReviewKind::Discard, &game),
            evaluator_model: DYNAMIC_EVALUATOR_VERSION.to_string(),
            kind: ReviewKind::Discard,
            recommended: SavedDecisionValue {
                card_ids: selected.clone(),
                ev: Some(1.25),
                win_probability: Some(0.55),
            },
        };
        let server = Server {
            state: Mutex::new(AppState {
                sessions: HashMap::from([(session_id.clone(), session)]),
                ..AppState::default()
            }),
            model_root: String::new(),
            data_dir: data_dir.clone(),
        };

        store_prepared_decision_analysis(&server, &session_id, analysis.clone()).unwrap();
        store_prepared_decision_analysis(&server, &session_id, analysis).unwrap();

        let restored = load_session_by_id(&data_dir, &session_id).unwrap().unwrap();
        assert_eq!(restored.prepared_decision_analyses.len(), 1);
        let mut app = server.state.lock().unwrap();
        let saved = app.sessions.get_mut(&session_id).unwrap();
        queue_decision_review(saved, ReviewKind::Discard, game, selected);
        let completed = saved.decision_reviews[0].completed.as_ref().unwrap();
        assert_eq!(completed.evaluator_model, DYNAMIC_EVALUATOR_VERSION);
        assert_eq!(completed.selected_win_probability, Some(0.55));
        drop(app);

        let connection = open_game_database(&data_dir).unwrap();
        let analysis_events: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM cribbage_game_events
                 WHERE session_id = ?1 AND action = 'analyze-decision'",
                [session_id.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(analysis_events, 1);
        let logged_model: String = connection
            .query_row(
                "SELECT json_extract(request_json, '$.payload.evaluatorModel')
                 FROM cribbage_game_events
                 WHERE session_id = ?1 AND action = 'analyze-decision'",
                [session_id.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(logged_model, DYNAMIC_EVALUATOR_VERSION);
        let logged_win_probability: f64 = connection
            .query_row(
                "SELECT json_extract(request_json, '$.payload.recommendedWinProbability')
                 FROM cribbage_game_events
                 WHERE session_id = ?1 AND action = 'analyze-decision'",
                [session_id.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(logged_win_probability, 0.55);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn a_new_evaluator_keeps_prior_analysis_and_backfills_only_its_version() {
        let mut review = calibration_review(
            "versioned-analysis",
            1,
            true,
            ReviewKind::Discard,
            0.46,
            0.50,
        );
        review.completed.as_mut().unwrap().evaluator_model = "ace-older".to_string();
        assert!(saved_decision_analysis(&review, DYNAMIC_EVALUATOR_VERSION).is_none());

        save_completed_decision_analysis(&mut review, completed_review(0.48, 0.50));

        assert!(saved_decision_analysis(&review, DYNAMIC_EVALUATOR_VERSION).is_some());
        assert!(saved_decision_analysis(&review, "ace-older").is_some());
        assert_eq!(review.prior_analyses.len(), 1);
    }

    #[test]
    fn game_timestamps_are_valid_iso_8601() {
        assert_eq!(iso8601_from_unix_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            iso8601_from_unix_millis(1_735_689_600_123),
            "2025-01-01T00:00:00.123Z"
        );
    }
}
