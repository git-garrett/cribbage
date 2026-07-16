use std::collections::HashMap;
use std::env;
use std::fmt::Write as _;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use cribbage_shadow_engine::cards::{Card, RANKS, SUIT_NAMES, VALUES};
use cribbage_shadow_engine::decision::{
    recommend_discard_for_side, recommend_peg_for_side, PegDecision,
};
use cribbage_shadow_engine::game::{CribbageGame, Phase, Side};
use cribbage_shadow_engine::model_id::{ModelId, MODEL_15_2};

const HUMAN: Side = Side::Left;
const AI: Side = Side::Right;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct Session {
    id: String,
    tag: Option<String>,
    model: ModelId,
    game: CribbageGame,
    waiting_for_deal_cut: bool,
    deal_cut_revealed: bool,
    waiting_for_ai_discard: bool,
    deal_cuts: [Card; 2],
    created_at: String,
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
}

#[derive(Default)]
struct AppState {
    sessions: HashMap<String, Session>,
    uploads: HashMap<String, UploadedGame>,
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
    let uploads = load_uploads(&data_dir).unwrap_or_else(|error| {
        eprintln!("Rust API leaderboard history was not loaded: {}", error);
        HashMap::new()
    });
    let listener = TcpListener::bind(&address)
        .unwrap_or_else(|error| panic!("could not bind Rust API server at {}: {}", address, error));
    let server = Arc::new(Server {
        state: Mutex::new(AppState {
            sessions: HashMap::new(),
            uploads,
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
    let response = match (request.method.as_str(), request.path.as_str()) {
        ("OPTIONS", _) => Response::empty(204),
        ("GET", "/health") => Response::json(200, health_json()),
        ("GET", "/api/model") => Response::json(200, model_json()),
        ("GET", "/api/leaderboard") => Response::json(200, leaderboard_json(server)?),
        ("POST", "/api/game/action") => game_action(server, &request.body),
        ("POST", "/api/game/session/save") => save_session(server, &request.body),
        ("POST", "/api/game/session/load") => load_session(server, &request.body),
        ("POST", "/api/game/session/complete") => Response::json(200, "{\"ok\":true}".to_string()),
        ("POST", "/api/games") => upload_game(server, &request.body),
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
    let headers = std::str::from_utf8(&bytes[..header_end]).map_err(|error| error.to_string())?;
    let request_line = headers
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
    let content_length = headers
        .lines()
        .find_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
        })
        .unwrap_or(0);
    if content_length > 1_000_000 {
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
    Ok(Request { method, path, body })
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

struct Response {
    status: u16,
    body: String,
}

impl Response {
    fn json(status: u16, body: String) -> Response {
        Response { status, body }
    }

    fn empty(status: u16) -> Response {
        Response {
            status,
            body: String::new(),
        }
    }
}

fn write_response(stream: &mut TcpStream, response: Response) -> Result<(), String> {
    let reason = match response.status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        410 => "Gone",
        500 => "Internal Server Error",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n\r\n",
        response.status,
        reason,
        response.body.len(),
    );
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
        "{{\"ok\":true,\"appVersion\":\"{}\",\"model\":\"{}\",\"runtime\":\"rust\"}}",
        APP_VERSION, MODEL_15_2
    )
}

fn model_json() -> String {
    format!(
        "{{\"appVersion\":\"{}\",\"model\":\"{}\",\"runtime\":\"rust\",\"models\":[\"schell_table-peg_table-13.0\",\"schell_table-peg_table-14.3\",\"schell_table-peg_table-14.8\",\"schell_table-peg_table-14.8.1\",\"schell_table-peg_table-15.0\",\"schell_table-peg_table-15.1\",\"schell_table-peg_table-15.2\"]}}",
        APP_VERSION, MODEL_15_2
    )
}

fn game_action(server: &Server, body: &str) -> Response {
    let action = json_string(body, "action").unwrap_or_default();
    let tag = json_string(body, "tag")
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.chars().take(80).collect());
    let result = (|| -> Result<String, String> {
        let mut app = server
            .state
            .lock()
            .map_err(|_| "server state lock poisoned".to_string())?;
        if action == "new" || action == "state" && json_string(body, "gameId").is_none() {
            let model = json_string(body, "opponent")
                .and_then(|value| ModelId::from_str(&value).ok())
                .unwrap_or(ModelId::Schell152);
            let session = new_session(model, tag);
            let id = session.id.clone();
            app.sessions.insert(id.clone(), session);
            return response_for_session(app.sessions.get(&id).expect("new session exists"));
        }

        let session_id =
            json_string(body, "gameId").ok_or_else(|| "Missing game session id.".to_string())?;
        let session = app
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| "Game session was not found; start a new game.".to_string())?;
        if tag.is_some() {
            session.tag = tag;
        }
        apply_action(session, &action, body, &server.model_root)?;
        let response = response_for_session(session)?;
        if matches!(
            action.as_str(),
            "prepare-cut-for-deal" | "prepare-ai-discard" | "prepare-next-hand-ai-discard"
        ) && !session.waiting_for_deal_cut
            && session.game.phase == Phase::Discard
        {
            return response_with_discard_recommendation(response, session, &server.model_root);
        }
        Ok(response)
    })();
    match result {
        Ok(json) => Response::json(200, json),
        Err(error) => Response::json(400, format!("{{\"error\":\"{}\"}}", json_escape(&error))),
    }
}

fn new_session(model: ModelId, tag: Option<String>) -> Session {
    let counter = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    let seed = (unix_millis() as u32).wrapping_add((counter as u32).wrapping_mul(0x9e37_79b9));
    let first_deal = if seed & 1 == 0 { HUMAN } else { AI };
    let game = CribbageGame::new_with_seed(seed, first_deal);
    let first = Card::new(((seed >> 8) % 52) as u8).expect("cut card in range");
    let second = Card::new(((seed.rotate_left(11) % 51) + 1) as u8).expect("cut card in range");
    Session {
        id: format!("rust-{:x}-{:x}", unix_millis(), counter),
        tag,
        model,
        game,
        waiting_for_deal_cut: true,
        deal_cut_revealed: false,
        waiting_for_ai_discard: false,
        deal_cuts: [first, second],
        created_at: isoish_now(),
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
        "prepare-ai-discard" | "prepare-next-hand-ai-discard" => Ok(()),
        "discard" => {
            require_phase(session, Phase::Discard)?;
            if session.waiting_for_deal_cut || session.waiting_for_ai_discard {
                return Err("It is not time for the user discard.".to_string());
            }
            let ids = json_number_array(body, "ids");
            if ids.len() != 2 {
                return Err("Select exactly two cards to discard.".to_string());
            }
            session.game.discard(HUMAN, [ids[0] as u8, ids[1] as u8])?;
            session.waiting_for_ai_discard = true;
            Ok(())
        }
        "finish-discard" | "finish-discard-with-cards" => {
            if !session.waiting_for_ai_discard {
                return Ok(());
            }
            let supplied = json_number_array(body, "ids");
            let ids = if supplied.len() == 2 {
                [supplied[0] as u8, supplied[1] as u8]
            } else {
                let decision =
                    recommend_discard_for_side(&session.game, AI, session.model, model_root)?;
                if decision.card_ids.len() != 2 {
                    return Err("Rust AI discard did not select two cards.".to_string());
                }
                [decision.card_ids[0], decision.card_ids[1]]
            };
            session.game.discard(AI, ids)?;
            session.waiting_for_ai_discard = false;
            Ok(())
        }
        "play" | "play-human" => {
            require_phase(session, Phase::Pegging)?;
            let id = json_number(body, "id").ok_or_else(|| "Missing card id.".to_string())? as u8;
            session.game.play_card(HUMAN, id)?;
            Ok(())
        }
        "go" | "go-human" => {
            require_phase(session, Phase::Pegging)?;
            session.game.say_go(HUMAN)
        }
        "advance-pegging" => {
            require_phase(session, Phase::Pegging)?;
            if session.game.pegging_reset_pending || session.game.current_player() != AI {
                return Ok(());
            }
            match recommend_peg_for_side(&session.game, AI, session.model, None, model_root)? {
                PegDecision::Go => session.game.say_go(AI),
                PegDecision::Play { card_id, .. } => {
                    session.game.play_card(AI, card_id).map(|_| ())
                }
            }
        }
        "acknowledge-pegging-reset" => {
            session.game.acknowledge_pegging_reset();
            Ok(())
        }
        "continue-scoring" => {
            require_phase(session, Phase::PeggingComplete)?;
            session.game.score_after_pegging()
        }
        "complete-decision-reviews" => Ok(()),
        other => Err(format!("Unknown game action: {}", other)),
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
    session: &Session,
    model_root: &str,
) -> Result<String, String> {
    let decision = recommend_discard_for_side(&session.game, AI, session.model, model_root)?;
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

fn game_state_json(session: &Session) -> String {
    let game = &session.game;
    let phase = public_phase(session);
    let human_hand = cards_json(&game.player(HUMAN).hand, Some("User"));
    let human_table = cards_json(&game.player(HUMAN).table, Some("User"));
    let ai_table = cards_json(&game.player(AI).table, Some("AI"));
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
    format!(
        "{{\"phase\":\"{}\",\"message\":\"{}\",\"log\":[],\"result\":{},\"handNumber\":{},\"scores\":{{\"human\":{},\"ai\":{}}},\"pegPositions\":{{\"human\":[{},{}],\"ai\":[{},{}]}},\"dealer\":\"{}\",\"firstDealer\":\"{}\",\"cribOwner\":\"{}\",\"turn\":{},\"count\":{},\"turnCard\":{},\"plays\":{},\"completedPlays\":{},\"peggingResetPending\":{},\"humanHand\":{},\"aiHandCount\":{},\"humanTable\":{},\"aiTable\":{},\"legalCardIds\":{},\"aiLegalCardIds\":{},\"canGo\":{},\"scoring\":null,\"cutForDeal\":{},\"analyticsEvents\":{}}}",
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
        card_json(game.turn_card, None),
        cards_json(&game.plays, None),
        nested_cards_json(&game.completed_plays),
        game.pegging_reset_pending,
        human_hand,
        game.player(AI).hand.len(),
        human_table,
        ai_table,
        legal_human,
        legal_ai,
        phase == "pegging" && game.current_player() == HUMAN && game.legal_cards(HUMAN).is_empty(),
        cut_for_deal,
        analytics_events_json(session),
    )
}

fn snapshot_json(session: &Session) -> String {
    let game = &session.game;
    format!(
        "{{\"version\":1,\"gameId\":\"{}\",\"rngState\":{},\"analyticsCounter\":0,\"analyticsEvents\":{},\"opponent\":\"{}\",\"deal\":{},\"firstDeal\":{},\"handNumber\":{},\"human\":{},\"ai\":{},\"turnCard\":{},\"crib\":{},\"plays\":{},\"playOwners\":{},\"completedPlays\":{},\"completedPlayOwners\":[],\"peggingResetPending\":{},\"count\":{},\"turn\":{},\"goPlayer\":{},\"lastPlayer\":{},\"scoringReview\":null,\"phase\":\"{}\",\"message\":\"{}\",\"log\":[],\"result\":{},\"pegPositions\":{{\"human\":[{},{}],\"ai\":[{},{}]}},\"pendingDiscardReviews\":[],\"pendingPeggingReviews\":[]}}",
        json_escape(&session.id),
        game.rng_state,
        analytics_events_json(session),
        session.model.as_str(),
        side_number(game.deal),
        side_number(game.first_deal),
        game.hand_number,
        player_snapshot_json(game, HUMAN),
        player_snapshot_json(game, AI),
        game.turn_card.id,
        number_array_json(&game.crib.iter().map(|card| card.id).collect::<Vec<_>>()),
        number_array_json(&game.plays.iter().map(|card| card.id).collect::<Vec<_>>()),
        side_array_json(&game.play_owners),
        nested_number_arrays_json(&game.completed_plays),
        game.pegging_reset_pending,
        game.count,
        if game.current_player() == HUMAN { 0 } else { 1 },
        option_player_json(game.go_player),
        option_player_json(game.last_player),
        public_phase(session),
        json_escape(&message_for(session)),
        result_json(session),
        game.player(HUMAN).score,
        game.player(HUMAN).score,
        game.player(AI).score,
        game.player(AI).score,
    )
}

fn player_snapshot_json(game: &CribbageGame, side: Side) -> String {
    let player = game.player(side);
    format!(
        "{{\"hand\":{},\"table\":{},\"crib\":{},\"score\":{}}}",
        number_array_json(&player.hand.iter().map(|card| card.id).collect::<Vec<_>>()),
        number_array_json(&player.table.iter().map(|card| card.id).collect::<Vec<_>>()),
        number_array_json(&player.crib.iter().map(|card| card.id).collect::<Vec<_>>()),
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
    match session.game.phase {
        Phase::Discard => "discard",
        Phase::Pegging => "pegging",
        Phase::PeggingComplete => "pegging_complete",
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
        "game_over" => "Game over.".to_string(),
        _ => String::new(),
    }
}

fn result_json(session: &Session) -> String {
    if session.game.phase != Phase::GameOver {
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
    if game.phase != Phase::GameOver {
        return format!("[{}]", start);
    }
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
    let end = format!(
        "{{\"id\":\"{}-end\",\"at\":\"{}\",\"type\":\"game\",\"action\":\"end\",\"gameId\":\"{}\",\"opponent\":\"{}\",\"winner\":\"{}\",\"loser\":\"{}\",\"result\":\"{}\",\"finalScores\":{{\"human\":{},\"ai\":{}}}}}",
        json_escape(&session.id),
        isoish_now(),
        json_escape(&session.id),
        session.model.as_str(),
        winner,
        loser,
        result,
        human_score,
        ai_score,
    );
    format!("[{},{}]", start, end)
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

fn nested_cards_json(groups: &[Vec<Card>]) -> String {
    format!(
        "[{}]",
        groups
            .iter()
            .map(|cards| cards_json(cards, None))
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
        let session = app
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| "Game session was not found.".to_string())?;
        session.tag = tag;
        Ok(())
    })();
    match result {
        Ok(()) => Response::json(200, "{\"ok\":true}".to_string()),
        Err(error) => Response::json(400, format!("{{\"error\":\"{}\"}}", json_escape(&error))),
    }
}

fn load_session(server: &Server, body: &str) -> Response {
    let tag = json_string(body, "tag").unwrap_or_default();
    let result = (|| -> Result<String, String> {
        let app = server
            .state
            .lock()
            .map_err(|_| "server state lock poisoned".to_string())?;
        let session = app
            .sessions
            .values()
            .filter(|session| {
                session.tag.as_deref() == Some(tag.as_str())
                    && session.game.phase != Phase::GameOver
            })
            .max_by_key(|session| &session.created_at);
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
    let result = (|| -> Result<(), String> {
        let game_id =
            json_string(body, "gameId").ok_or_else(|| "Missing completed game id.".to_string())?;
        let player = json_string(body, "tag").unwrap_or_else(|| "Anonymous".to_string());
        let winner = json_string(body, "winner");
        let result = json_string(body, "result").unwrap_or_else(|| "regular".to_string());
        let model = json_string(body, "model").unwrap_or_else(|| MODEL_15_2.to_string());
        let human_score = json_number_after(body, "human").unwrap_or(0) as i32;
        let ai_score = json_number_after(body, "ai").unwrap_or(0) as i32;
        let upload = UploadedGame {
            game_id: game_id.clone(),
            player,
            winner,
            result,
            human_score,
            ai_score,
            model,
            ended_at: isoish_now(),
        };
        let mut app = server
            .state
            .lock()
            .map_err(|_| "server state lock poisoned".to_string())?;
        app.uploads.insert(game_id, upload);
        persist_uploads(&server.data_dir, &app.uploads)?;
        Ok(())
    })();
    match result {
        Ok(()) => Response::json(200, "{\"ok\":true}".to_string()),
        Err(error) => Response::json(400, format!("{{\"error\":\"{}\"}}", json_escape(&error))),
    }
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

#[derive(Default)]
struct PlayerTotals {
    games: i32,
    wins: i32,
    losses: i32,
    skunks: i32,
    skunked: i32,
    points: i32,
    margin_total: i32,
}

fn leaderboard_json(server: &Server) -> Result<String, String> {
    let app = server
        .state
        .lock()
        .map_err(|_| "server state lock poisoned".to_string())?;
    let mut totals: HashMap<String, PlayerTotals> = HashMap::new();
    for upload in app.uploads.values() {
        let total = totals.entry(upload.player.clone()).or_default();
        total.games += 1;
        let won = upload.winner.as_deref() == Some("human");
        let margin = upload.human_score - upload.ai_score;
        total.margin_total += margin;
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
    let mut rows = totals.into_iter().collect::<Vec<_>>();
    rows.sort_by(|(left_name, left), (right_name, right)| {
        right
            .points
            .cmp(&left.points)
            .then_with(|| right.wins.cmp(&left.wins))
            .then_with(|| left_name.cmp(right_name))
    });
    let player_stats = rows.iter().map(|(player, total)| {
        let games = total.games.max(1) as f64;
        format!(
            "{{\"player\":\"{}\",\"games\":{},\"wins\":{},\"losses\":{},\"skunks\":{},\"skunked\":{},\"leaderboardPoints\":{},\"leaderboardPointsPerGame\":{:.3},\"winRate\":{:.3},\"avgMargin\":{:.3}}}",
            json_escape(player), total.games, total.wins, total.losses, total.skunks, total.skunked, total.points,
            total.points as f64 / games, total.wins as f64 / games, total.margin_total as f64 / games,
        )
    }).collect::<Vec<_>>().join(",");
    Ok(format!(
        "{{\"generatedAt\":\"{}\",\"source\":\"rust-api-tsv\",\"model\":\"15.2 public\",\"games\":{},\"playerStats\":[{}],\"bestWinRate\":[],\"winRate14_3\":[],\"bestWins\":[],\"mostSkunks\":[]}}",
        isoish_now(), app.uploads.len(), player_stats
    ))
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
    format!("{}Z", unix_millis())
}
