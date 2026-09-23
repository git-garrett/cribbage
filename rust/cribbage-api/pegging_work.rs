//! One ephemeral opening calculation per live game. Never persist moves or observations.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use cribbage_shadow_engine::decision::{recommend_peg_for_side_with_caches, PegDecision};
use cribbage_shadow_engine::game::CribbageGame;
use cribbage_shadow_engine::game::Phase;
use cribbage_shadow_engine::model_id::ModelId;
use cribbage_shadow_engine::progress::{with_progress, DecisionProgress};
use serde_json::{json, Value};

use super::{
    auth, json_number, json_string, load_session_by_id, Response, Server, Session, AI, HUMAN,
};

#[derive(Default)]
pub(super) struct Registry(Mutex<HashMap<String, Arc<Work>>>);

pub(super) struct Work {
    key: String,
    owner: Option<i64>,
    hand: u32,
    played: usize,
    created: Instant,
    progress: Arc<DecisionProgress>,
    finished: AtomicBool,
    result: Mutex<Option<Result<PegDecision, String>>>,
    changed: Condvar,
}

impl Work {
    fn wait(&self) -> Result<PegDecision, String> {
        let result = self.result.lock().unwrap_or_else(|e| e.into_inner());
        let result = self
            .changed
            .wait_while(result, |r| r.is_none())
            .unwrap_or_else(|e| e.into_inner());
        result.as_ref().unwrap().clone()
    }

    fn failed(&self) -> bool {
        self.finished.load(Ordering::Acquire)
            && self
                .result
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
                .is_some_and(Result::is_err)
    }

    fn snapshot(&self) -> Value {
        let finished = self.finished.load(Ordering::Acquire);
        let (completed, total) = self.progress.snapshot();
        json!({"completed":completed,"total":total,
            "state":if self.failed() { "failed" } else if finished { "ready" } else { "running" }})
    }
}

impl Registry {
    fn start(
        &self,
        session: &Session,
        key: String,
        solve: impl FnOnce() -> Result<PegDecision, String> + Send + 'static,
    ) -> Arc<Work> {
        let mut jobs = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(job) = jobs.get(&session.id) {
            if job.key == key && job.owner == session.owner_user_id && !job.failed() {
                return Arc::clone(job);
            }
        }
        // Completed abandoned games need no long-lived cache. Never evict running work.
        jobs.retain(|_, job| {
            !job.finished.load(Ordering::Acquire)
                || job.created.elapsed() < Duration::from_secs(600)
        });
        let job = Arc::new(Work {
            key,
            owner: session.owner_user_id,
            hand: session.game.hand_number,
            played: session.game.player(HUMAN).table.len(),
            created: Instant::now(),
            progress: Arc::new(DecisionProgress::default()),
            finished: AtomicBool::new(false),
            result: Mutex::new(None),
            changed: Condvar::new(),
        });
        jobs.insert(session.id.clone(), Arc::clone(&job));
        let worker = Arc::clone(&job);
        let spawned = std::thread::Builder::new()
            .name("ace-opening".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    with_progress(Arc::clone(&worker.progress), solve)
                }))
                .unwrap_or_else(|_| Err("Ace calculation failed; please retry.".into()));
                let mut saved = worker.result.lock().unwrap_or_else(|e| e.into_inner());
                *saved = Some(result);
                worker.finished.store(true, Ordering::Release);
                drop(saved);
                worker.changed.notify_all();
            });
        if let Err(error) = spawned {
            let mut saved = job.result.lock().unwrap_or_else(|e| e.into_inner());
            *saved = Some(Err(error.to_string()));
            job.finished.store(true, Ordering::Release);
            drop(saved);
            job.changed.notify_all();
        }
        job
    }
}

/// A signature of the actor's legal observation, never the opponent's hidden cards.
pub(super) fn opening_key(session: &Session) -> Option<String> {
    let game = &session.game;
    let own = game.player(AI);
    let opponent = game.player(HUMAN);
    if session.model != ModelId::Schell1323
        || session.forfeited
        || session.completed_at.is_some()
        || session.waiting_for_deal_cut
        || session.waiting_for_ai_discard
        || game.phase != Phase::Pegging
        || game.pegging_reset_pending
        || game.current_player() != AI
        || own.hand.len() != 4
        || !own.table.is_empty()
        || opponent.table.len() > 1
        || opponent.hand.len() + opponent.table.len() != 4
    {
        return None;
    }
    Some(format!(
        "{:?}",
        (
            game.hand_number,
            game.dealer,
            game.turn_card,
            own.score,
            opponent.score,
            (
                &own.hand,
                &own.discarded_to_crib,
                &opponent.table,
                opponent.hand.len()
            ),
            (game.count, &game.plays, game.go_player, game.last_player),
        )
    ))
}

/// The logical cut is independent of the browser's reveal/confirmation animation.
pub(super) fn prepare(server: &Server, session: &Session) -> Option<Arc<Work>> {
    let key = opening_key(session)?;
    let game = session.game.clone();
    let root = server.model_root.clone();
    let cache91 = session.model911_hand_cache.clone();
    let cache13 = session.model1323_hand_cache.clone();
    Some(server.pegging_work.start(session, key, move || {
        recommend_peg_for_side_with_caches(
            &game,
            AI,
            ModelId::Schell1323,
            None,
            &root,
            Some(&cache91),
            Some(&cache13),
        )
    }))
}

/// Project the next opening once Ace has chosen its discard. The starter was
/// fixed at deal time; only the opponent's eventual four-card count is needed.
/// This cannot influence the already-completed discard decision or human UI.
fn after_discard(session: &Session, cards: &[u8]) -> Option<Session> {
    if session.model != ModelId::Schell1323
        || session.game.dealer != HUMAN
        || session.game.phase != Phase::Discard
        || cards.len() != 2
        || session.game.player(AI).hand.len() != 6
    {
        return None;
    }
    let mut opening = session.clone();
    // The policy sees only this count, never these hidden ranks or a guessed discard.
    opening.game.player_mut(HUMAN).hand.truncate(4);
    opening.game.discard(AI, [cards[0], cards[1]]).ok()?;
    opening.waiting_for_ai_discard = false;
    opening_key(&opening)?;
    Some(opening)
}

pub(super) fn prepare_after_discard(
    server: &Server,
    session_id: &str,
    discarded_from: &CribbageGame,
    cards: &[u8],
) {
    let Ok(app) = server.state.lock() else { return };
    let Some(session) = app.sessions.get(session_id) else {
        return;
    };
    if session.game.hand_number != discarded_from.hand_number
        || session.game.player(AI).hand != discarded_from.player(AI).hand
    {
        return;
    }
    if let Some(opening) = after_discard(session, cards) {
        prepare(server, &opening);
    }
}

pub(super) struct PreparedDecision {
    key: String,
    pub decision: PegDecision,
}

impl PreparedDecision {
    pub fn matches(&self, session: &Session) -> bool {
        opening_key(session).as_ref() == Some(&self.key)
    }
}

/// Wait with no session lock held. Preparation, duplicate requests, and retries join one solve.
pub(super) fn decision(
    server: &Server,
    body: &str,
    user: Option<&auth::AuthUser>,
) -> Result<Option<PreparedDecision>, String> {
    let id = json_string(body, "gameId").ok_or("Missing game session id.")?;
    let job = {
        let mut app = server
            .state
            .lock()
            .map_err(|_| "server state lock poisoned")?;
        if !app.sessions.contains_key(&id) {
            if let Some(session) = load_session_by_id(&server.data_dir, &id)? {
                app.sessions.insert(id.clone(), session);
            }
        }
        let session = app.sessions.get(&id).ok_or("Game session was not found.")?;
        if !super::session_owned_by(session, user) {
            return Err("Game session was not found for this account.".into());
        }
        prepare(server, session)
    };
    job.map(|job| {
        job.wait().map(|decision| PreparedDecision {
            key: job.key.clone(),
            decision,
        })
    })
    .transpose()
}

/// A small read that never takes the game-state lock or starts engine work.
pub(super) fn progress(server: &Server, body: &str, user: Option<&auth::AuthUser>) -> Response {
    let id = json_string(body, "gameId").unwrap_or_default();
    let hand = json_number(body, "handNumber");
    let played = json_number(body, "played");
    let jobs = server
        .pegging_work
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let progress = jobs
        .get(&id)
        .filter(|job| {
            job.owner == user.map(|u| u.id)
                && hand == Some(u64::from(job.hand))
                && played == Some(job.played as u64)
        })
        .map(|job| job.snapshot());
    Response::json(200, json!({"progress":progress}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{new_session_from_seed, AppState};
    use cribbage_shadow_engine::game::CribbageGame;
    use std::sync::mpsc;

    fn opening() -> Session {
        let mut session = new_session_from_seed(ModelId::Schell1323, None, 42, 1);
        session.game = CribbageGame::new_with_seed(42, HUMAN);
        for side in [HUMAN, AI] {
            let cards = [
                session.game.player(side).hand[0].id,
                session.game.player(side).hand[1].id,
            ];
            session.game.discard(side, cards).unwrap();
        }
        session.waiting_for_deal_cut = false;
        session.turn_card_revealed = true;
        session
    }

    #[test]
    fn legal_observation_gates_preparation_and_invalidates_stale_results() {
        let mut session = opening();
        let key = opening_key(&session).unwrap();
        session.forfeited = true;
        assert!(opening_key(&session).is_none());
        session.forfeited = false;
        session.completed_at = Some("finished".into());
        assert!(opening_key(&session).is_none());
        session.completed_at = None;
        session.turn_card_revealed = false;
        assert_eq!(
            opening_key(&session).unwrap(),
            key,
            "presentation must not delay calculation"
        );
        session.turn_card_revealed = true;
        session.game.player_mut(HUMAN).hand[0] =
            cribbage_shadow_engine::cards::Card::new(0).unwrap();
        session.game.player_mut(HUMAN).discarded_to_crib.reverse();
        assert_eq!(
            opening_key(&session).unwrap(),
            key,
            "opponent's private cards are irrelevant"
        );
        session.game.player_mut(AI).score += 1;
        assert_ne!(opening_key(&session).unwrap(), key);
        session.game.player_mut(AI).score -= 1;
        let id = session.game.player(AI).hand[0].id;
        session.game.play_card(AI, id).unwrap();
        assert!(opening_key(&session).is_none());
    }

    #[test]
    fn preparation_and_advance_share_work_without_holding_the_session_lock() {
        let session = opening();
        let card_id = session.game.player(AI).hand[0].id;
        let expected = PegDecision::Play {
            card_id,
            ev: Some(0.0),
            win_probability: Some(0.5),
        };
        let server = Arc::new(Server {
            pegging_work: Registry::default(),
            state: Mutex::new(AppState::default()),
            model_root: String::new(),
            data_dir: std::env::temp_dir(),
        });
        server
            .state
            .lock()
            .unwrap()
            .sessions
            .insert(session.id.clone(), session.clone());
        let key = opening_key(&session).unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let result = expected.clone();
        let job = server.pegging_work.start(&session, key.clone(), move || {
            started_tx.send(()).unwrap();
            finish_rx.recv().unwrap();
            Ok(result)
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let same = prepare(&server, &session).unwrap();
        assert!(Arc::ptr_eq(&job, &same));
        let body = json!({"gameId":session.id}).to_string();
        let waiting_server = Arc::clone(&server);
        let waiting =
            std::thread::spawn(move || decision(&waiting_server, &body, None).unwrap().unwrap());
        // Progress must remain readable even if another request owns the game lock.
        let guard = server.state.lock().unwrap();
        let query = json!({"gameId":session.id,"handNumber":session.game.hand_number,"played":0})
            .to_string();
        let live: Value = serde_json::from_str(&progress(&server, &query, None).body).unwrap();
        assert_eq!(live["progress"]["state"], "running");
        drop(guard);
        finish_tx.send(()).unwrap();
        let prepared = waiting.join().unwrap();
        assert_eq!(prepared.decision, expected);
        assert!(prepared.matches(&session));
        let ready: Value = serde_json::from_str(&progress(&server, &query, None).body).unwrap();
        assert_eq!(ready["progress"]["state"], "ready");
        let other_user = auth::test_user(999, "other", "other@example.invalid");
        let private: Value =
            serde_json::from_str(&progress(&server, &query, Some(&other_user)).body).unwrap();
        assert!(private["progress"].is_null());
        let stale = json!({"gameId":session.id,"handNumber":session.game.hand_number+1,"played":0})
            .to_string();
        let stale: Value = serde_json::from_str(&progress(&server, &stale, None).body).unwrap();
        assert!(stale["progress"].is_null());
    }

    #[test]
    fn discard_projection_matches_the_actual_opening_for_every_opponent_discard() {
        let mut heels_cases = 0;
        for seed in 0..32 {
            let mut session = new_session_from_seed(ModelId::Schell1323, None, seed, 1);
            session.game = CribbageGame::new_with_seed(seed, HUMAN);
            session.waiting_for_deal_cut = false;
            if seed == 0 {
                session.game.turn_card = crate::full_deck()
                    .into_iter()
                    .find(|card| {
                        card.rank == 10
                            && !session.game.player(AI).hand.contains(card)
                            && !session.game.player(HUMAN).hand.contains(card)
                    })
                    .unwrap();
            }
            let cards = [
                session.game.player(AI).hand[0].id,
                session.game.player(AI).hand[1].id,
            ];
            let projected = after_discard(&session, &cards).unwrap();
            assert!(!projected.turn_card_revealed, "no UI reveal is required");
            if session.game.turn_card.rank == 10 {
                heels_cases += 1;
            }
            for i in 0..6 {
                for j in i + 1..6 {
                    let mut actual = session.clone();
                    let human_cards = [
                        actual.game.player(HUMAN).hand[i].id,
                        actual.game.player(HUMAN).hand[j].id,
                    ];
                    actual.game.discard(HUMAN, human_cards).unwrap();
                    actual.game.discard(AI, cards).unwrap();
                    assert_eq!(opening_key(&projected), opening_key(&actual));
                }
            }
        }
        assert!(heels_cases > 0, "cover heels scores in the projection");
    }

    #[test]
    fn failed_work_can_be_retried_without_poisoning_the_next_move() {
        let session = opening();
        let registry = Registry::default();
        let key = opening_key(&session).unwrap();
        let failed = registry.start(&session, key.clone(), || Err("first request failed".into()));
        assert!(failed.wait().is_err());
        let retry = registry.start(&session, key, || Ok(PegDecision::Go));
        assert!(!Arc::ptr_eq(&failed, &retry));
        assert_eq!(retry.wait().unwrap(), PegDecision::Go);
    }
    #[test]
    #[ignore = "full production Ace opening; run in release mode with assets"]
    fn discard_calculation_prepares_the_lead_before_opponent_discard_or_reveal() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let data_dir = std::env::temp_dir().join(format!(
            "ace-preparation-{}-{}",
            std::process::id(),
            crate::unix_millis()
        ));
        crate::initialize_game_database(&data_dir).unwrap();
        let mut session = new_session_from_seed(ModelId::Schell1323, None, 42, 1);
        session.game = CribbageGame::new_with_seed(42, HUMAN);
        session.waiting_for_deal_cut = false;
        let id = session.id.clone();
        let server = Server {
            pegging_work: Registry::default(),
            state: Mutex::new(AppState::default()),
            model_root: root.to_string_lossy().into_owned(),
            data_dir: data_dir.clone(),
        };
        server
            .state
            .lock()
            .unwrap()
            .sessions
            .insert(id.clone(), session);
        let discarded = crate::game_action(
            &server,
            &json!({"gameId":id,"action":"prepare-ai-discard"}).to_string(),
            None,
        );
        assert_eq!(discarded.status, 200, "{}", discarded.body);
        let response: Value = serde_json::from_str(&discarded.body).unwrap();
        let job = server
            .pegging_work
            .0
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .expect("discard calculation must start work without a UI reveal or human discard");
        let human_cards = {
            let app = server.state.lock().unwrap();
            let session = &app.sessions[&id];
            assert!(!session.turn_card_revealed);
            assert_eq!(session.game.player(HUMAN).hand.len(), 6);
            [
                session.game.player(HUMAN).hand[0].id,
                session.game.player(HUMAN).hand[1].id,
            ]
        };
        for body in [
            json!({"gameId":id,"action":"discard","ids":human_cards}),
            json!({"gameId":id,"action":"finish-discard-with-cards","ids":response["recommendation"]["cardIds"]}),
            json!({"gameId":id,"action":"reveal-turn-card"}),
        ] {
            let result = crate::game_action(&server, &body.to_string(), None);
            assert_eq!(result.status, 200, "{}", result.body);
        }
        let expected = job.wait().unwrap();
        let advanced = crate::game_action(
            &server,
            &json!({"gameId":id,"action":"advance-pegging"}).to_string(),
            None,
        );
        assert_eq!(advanced.status, 200, "{}", advanced.body);
        let same = server
            .pegging_work
            .0
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .unwrap();
        assert!(
            Arc::ptr_eq(&job, &same),
            "the prepared solve must be reused"
        );
        let PegDecision::Play { card_id, .. } = expected else {
            panic!("opening must be a play")
        };
        let app = server.state.lock().unwrap();
        let game = &app.sessions[&id].game;
        assert_eq!(
            game.player(AI)
                .table
                .iter()
                .map(|c| c.id)
                .collect::<Vec<_>>(),
            vec![card_id]
        );
        drop(app);
        std::fs::remove_dir_all(data_dir).unwrap();
    }
}
