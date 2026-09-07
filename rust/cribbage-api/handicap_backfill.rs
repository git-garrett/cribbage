use super::*;

#[derive(Clone, Debug, Eq, PartialEq)]
struct Options {
    players: Vec<String>,
    through: String,
    apply: bool,
}

#[derive(Clone)]
struct SelectedSession {
    session: Session,
    cycle_samples: Vec<(u32, String, DynamicCycleSample)>,
    game_length: Option<(String, f64)>,
    completed_analyses: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerResult {
    player: String,
    calibration_completed_at: String,
    calibration_evaluator_version: String,
    selected_sessions: usize,
    selected_session_ids: Vec<String>,
    completed_analyses: usize,
    cycles: usize,
    completed_games: usize,
    handicap_before: Option<f64>,
    handicap_after: Option<f64>,
}

fn parse_options(arguments: &[String]) -> Result<Options, String> {
    if arguments.first().map(String::as_str) != Some("backfill-handicaps") {
        return Err(format!("unknown command: {}", arguments.join(" ")));
    }
    let mut players = None;
    let mut through = None;
    let mut apply = None;
    let mut index = 1;
    while index < arguments.len() {
        match arguments[index].as_str() {
            "--players" => {
                index += 1;
                let value = arguments
                    .get(index)
                    .ok_or_else(|| "--players requires a comma-separated value".to_string())?;
                let parsed = value
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                if parsed.is_empty() {
                    return Err("--players must name at least one player".to_string());
                }
                players = Some(parsed);
            }
            "--through" => {
                index += 1;
                through = Some(
                    arguments
                        .get(index)
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| "--through requires an ISO timestamp".to_string())?
                        .clone(),
                );
            }
            "--dry-run" if apply.is_none() => apply = Some(false),
            "--apply-offline" if apply.is_none() => apply = Some(true),
            option => return Err(format!("unknown or duplicate backfill option: {option}")),
        }
        index += 1;
    }
    let through = through.ok_or_else(|| "--through is required".to_string())?;
    let through = canonical_utc_timestamp(&through)
        .ok_or_else(|| "--through must be a UTC timestamp".to_string())?;
    Ok(Options {
        players: players.ok_or_else(|| "--players is required".to_string())?,
        through,
        apply: apply
            .ok_or_else(|| "choose exactly one of --dry-run or --apply-offline".to_string())?,
    })
}

fn player_identity(connection: &Connection, requested: &str) -> Result<(i64, String), String> {
    let matches = connection
        .prepare(
            "SELECT id, display_name FROM auth_users
             WHERE lower(trim(display_name)) = lower(trim(?1))
                OR lower(trim(username)) = lower(trim(?1))",
        )
        .map_err(|error| format!("prepare player lookup: {error}"))?
        .query_map([requested], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("find player {requested}: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read player {requested}: {error}"))?;
    match matches.as_slice() {
        [player] => Ok(player.clone()),
        [] => Err(format!("player {requested} was not found")),
        _ => Err(format!("player {requested} is ambiguous")),
    }
}

fn calibration_boundary(
    connection: &Connection,
    user_id: i64,
) -> Result<(String, String, HashSet<String>), String> {
    // Calibration is a player milestone that survives evaluator upgrades. Pick
    // the first evaluator under which the player reached the full threshold;
    // never combine partial progress from different evaluator versions.
    let stored = connection
        .prepare(
            "SELECT DISTINCT c.evaluator_version, c.session_id, c.first_hand_number, s.session_json
             FROM dynamic_profile_cycles c
             JOIN cribbage_game_sessions s ON s.session_id = c.session_id
             WHERE c.user_id = ?1",
        )
        .map_err(|error| format!("prepare calibration history: {error}"))?
        .query_map([user_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u32>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| format!("read calibration history: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("collect calibration history: {error}"))?;
    let mut by_evaluator = HashMap::<String, Vec<(String, String, u32)>>::new();
    for (evaluator, session_id, first_hand, text) in stored {
        let session = serde_json::from_str::<PersistedSession>(&text)
            .map_err(|error| format!("parse calibration session {session_id}: {error}"))
            .and_then(restore_persisted_session)?;
        by_evaluator.entry(evaluator).or_default().push((
            cycle_completed_at(&session, first_hand),
            session_id,
            first_hand,
        ));
    }
    let minimum = usize::try_from(MIN_COMPLETE_CYCLES).unwrap_or(usize::MAX);
    let mut candidates = by_evaluator
        .into_iter()
        .filter_map(|(evaluator, mut rows)| {
            rows.sort();
            (rows.len() >= minimum).then(|| (rows[minimum - 1].0.clone(), evaluator, rows))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| (&left.0, &left.1).cmp(&(&right.0, &right.1)));
    let Some((completed_at, evaluator, rows)) = candidates.into_iter().next() else {
        return Err(format!(
            "player has not completed {} calibration cycles under one evaluator",
            MIN_COMPLETE_CYCLES
        ));
    };
    let baseline_sessions = rows
        .iter()
        .take(minimum)
        .map(|(_, session_id, _)| session_id.clone())
        .collect();
    Ok((completed_at, evaluator, baseline_sessions))
}

fn completed_at(session: &Session) -> Option<&str> {
    (session.game.phase == Phase::GameOver && !session.forfeited)
        .then(|| session.completed_at.as_deref())
        .flatten()
}

fn should_select_session(
    session: &Session,
    baseline_sessions: &HashSet<String>,
    calibration_completed_at: &str,
    through: &str,
) -> bool {
    if session.created_at.as_str() > through {
        return false;
    }
    if session.model == ModelId::Dynamic || baseline_sessions.contains(&session.id) {
        return true;
    }
    session.model.is_ace()
        && completed_at(session).is_some_and(|at| at > calibration_completed_at && at <= through)
}

fn load_selected_sessions(
    connection: &Connection,
    user_id: i64,
    display_name: &str,
    baseline_sessions: &HashSet<String>,
    calibration_completed_at: &str,
    through: &str,
) -> Result<Vec<Session>, String> {
    let stored = connection
        .prepare("SELECT session_json FROM cribbage_game_sessions ORDER BY created_at, session_id")
        .map_err(|error| format!("prepare sessions for {display_name}: {error}"))?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("read sessions for {display_name}: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("collect sessions for {display_name}: {error}"))?;
    stored
        .into_iter()
        .map(|text| {
            serde_json::from_str::<PersistedSession>(&text)
                .map_err(|error| format!("parse session for {display_name}: {error}"))
                .and_then(restore_persisted_session)
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|sessions| {
            sessions
                .into_iter()
                .filter(|session| {
                    let owned = session.owner_user_id == Some(user_id);
                    let legacy_match = session.owner_user_id.is_none()
                        && session.tag.as_deref().is_some_and(|tag| {
                            tag.trim().eq_ignore_ascii_case(display_name.trim())
                        });
                    (owned || legacy_match)
                        && should_select_session(
                            session,
                            baseline_sessions,
                            calibration_completed_at,
                            through,
                        )
                })
                .collect()
        })
}

fn cycle_completed_at(session: &Session, first_hand: u32) -> String {
    let second_hand = first_hand + 1;
    session
        .score_events
        .iter()
        .filter(|event| {
            event.hand_number == second_hand && event.category == SavedScoreCategory::Crib
        })
        .map(|event| event.at.as_str())
        .max()
        .unwrap_or(&session.updated_at)
        .to_string()
}

fn prepare_session(mut session: Session, model_root: &str) -> Result<SelectedSession, String> {
    let missing = session
        .decision_reviews
        .iter()
        .filter(|review| saved_decision_analysis(review, DYNAMIC_EVALUATOR_VERSION).is_none())
        .count();
    for review in &mut session.decision_reviews {
        if saved_decision_analysis(review, DYNAMIC_EVALUATOR_VERSION).is_some() {
            continue;
        }
        let completed = evaluate_saved_decision_review(review, model_root)
            .map_err(|error| format!("analyze {} in {}: {error}", review.id, session.id))?;
        save_completed_decision_analysis(review, completed);
    }
    let stored = serde_json::to_string(&persisted_session(&session))
        .map_err(|error| format!("canonicalize {}: {error}", session.id))?;
    session = serde_json::from_str::<PersistedSession>(&stored)
        .map_err(|error| format!("parse canonical {}: {error}", session.id))
        .and_then(restore_persisted_session)?;
    let cycle_samples = eligible_dynamic_cycle_samples(&session)
        .into_iter()
        .map(|cycle| {
            (
                cycle.first_hand,
                cycle_completed_at(&session, cycle.first_hand),
                cycle.strength_sample,
            )
        })
        .collect();
    let game_length = eligible_dynamic_game_length(&session).map(|length| {
        (
            session
                .completed_at
                .clone()
                .unwrap_or_else(|| session.updated_at.clone()),
            length,
        )
    });
    Ok(SelectedSession {
        session,
        cycle_samples,
        game_length,
        completed_analyses: missing,
    })
}

fn current_handicap(connection: &Connection, user_id: i64) -> Result<Option<f64>, String> {
    let saved = connection
        .query_row(
            "SELECT profile_json FROM dynamic_player_profiles
             WHERE user_id = ?1 AND evaluator_version = ?2",
            params![user_id, DYNAMIC_EVALUATOR_VERSION],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("read current handicap: {error}"))?;
    saved
        .map(|text| {
            serde_json::from_str::<DynamicProfile>(&text)
                .map_err(|error| format!("parse current handicap: {error}"))
                .map(|profile| profile.into_current().handicap_per_game())
        })
        .transpose()
        .map(Option::flatten)
}

fn rebuild_profile(sessions: &[SelectedSession], started_dynamic: bool) -> DynamicProfile {
    let mut cycles = sessions
        .iter()
        .flat_map(|selected| {
            selected
                .cycle_samples
                .iter()
                .map(move |(first_hand, at, sample)| {
                    (at, &selected.session.id, *first_hand, *sample)
                })
        })
        .collect::<Vec<_>>();
    cycles.sort_by(|left, right| (left.0, left.1, left.2).cmp(&(right.0, right.1, right.2)));
    let mut games = sessions
        .iter()
        .filter_map(|selected| {
            selected
                .game_length
                .as_ref()
                .map(|(at, length)| (at, &selected.session.id, *length))
        })
        .collect::<Vec<_>>();
    games.sort_by(|left, right| (left.0, left.1).cmp(&(right.0, right.1)));

    let mut profile = DynamicProfile {
        started_dynamic,
        ..DynamicProfile::default()
    };
    for (_, _, _, sample) in cycles {
        profile.observe_cycle(sample);
    }
    for (_, _, length) in games {
        profile.observe_game_length(length);
    }
    profile
}

fn persist_player(
    transaction: &rusqlite::Transaction<'_>,
    user_id: i64,
    sessions: &mut [SelectedSession],
    profile: &DynamicProfile,
) -> Result<(), String> {
    transaction
        .execute(
            "DELETE FROM dynamic_profile_cycles WHERE user_id = ?1 AND evaluator_version = ?2",
            params![user_id, DYNAMIC_EVALUATOR_VERSION],
        )
        .map_err(|error| format!("clear current cycle evidence: {error}"))?;
    transaction
        .execute(
            "DELETE FROM dynamic_profile_games WHERE user_id = ?1 AND evaluator_version = ?2",
            params![user_id, DYNAMIC_EVALUATOR_VERSION],
        )
        .map_err(|error| format!("clear current game lengths: {error}"))?;

    for selected in sessions.iter_mut() {
        // Active and forfeited Dynamic sessions may contribute already-played
        // complete cycles, but the repair must not alter their resumable state.
        if completed_at(&selected.session).is_some() {
            if selected.session.model == ModelId::Dynamic {
                selected.session.use_dynamic_profile(profile.clone());
            }
            let session_json = serde_json::to_string(&persisted_session(&selected.session))
                .map_err(|error| format!("serialize {}: {error}", selected.session.id))?;
            transaction
                .execute(
                    "UPDATE cribbage_game_sessions SET session_json = ?1 WHERE session_id = ?2",
                    params![session_json, selected.session.id],
                )
                .map_err(|error| {
                    format!("save reviewed session {}: {error}", selected.session.id)
                })?;
        }
        for (first_hand, at, sample) in &selected.cycle_samples {
            transaction
                .execute(
                    "INSERT INTO dynamic_profile_cycles
                     (user_id, evaluator_version, session_id, first_hand_number, sample_json, applied_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        user_id,
                        DYNAMIC_EVALUATOR_VERSION,
                        selected.session.id,
                        first_hand,
                        serde_json::to_string(sample)
                            .map_err(|error| format!("serialize cycle sample: {error}"))?,
                        at,
                    ],
                )
                .map_err(|error| format!("save cycle evidence: {error}"))?;
        }
        if let Some((at, length)) = &selected.game_length {
            transaction
                .execute(
                    "INSERT INTO dynamic_profile_games
                     (user_id, evaluator_version, session_id, sample_json, applied_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        user_id,
                        DYNAMIC_EVALUATOR_VERSION,
                        selected.session.id,
                        json!({"cyclesPerGame": length}).to_string(),
                        at,
                    ],
                )
                .map_err(|error| format!("save game length: {error}"))?;
        }
    }
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
                serde_json::to_string(profile)
                    .map_err(|error| format!("serialize rebuilt profile: {error}"))?,
                isoish_now(),
            ],
        )
        .map_err(|error| format!("save rebuilt profile: {error}"))?;
    Ok(())
}

fn backup_database(data_dir: &Path) -> Result<PathBuf, String> {
    let database = game_database_path(data_dir);
    let connection = open_game_database(data_dir)?;
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|error| format!("checkpoint database before backfill: {error}"))?;
    drop(connection);
    let backup_dir = data_dir.join("handicap-backups");
    std::fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("create handicap backup directory: {error}"))?;
    let backup = backup_dir.join(format!(
        "cribbage-server.sqlite.{}.pre-handicap-backfill",
        unix_millis()
    ));
    std::fs::copy(&database, &backup)
        .map_err(|error| format!("back up {}: {error}", database.display()))?;
    Ok(backup)
}

pub fn run(arguments: &[String], data_dir: &Path, model_root: &str) -> Result<(), String> {
    let options = parse_options(arguments)?;
    let database = game_database_path(data_dir);
    if !database.is_file() {
        return Err(format!(
            "game database does not exist: {}",
            database.display()
        ));
    }
    let mut connection = if options.apply {
        open_game_database(data_dir)?
    } else {
        Connection::open_with_flags(
            &database,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| format!("open game database read-only: {error}"))?
    };
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("configure game database timeout: {error}"))?;
    let mut plans = Vec::new();
    for requested in &options.players {
        let (user_id, display_name) = player_identity(&connection, requested)?;
        let before = current_handicap(&connection, user_id)?;
        let (calibration_completed_at, calibration_evaluator_version, baseline_sessions) =
            calibration_boundary(&connection, user_id)?;
        let sessions = load_selected_sessions(
            &connection,
            user_id,
            &display_name,
            &baseline_sessions,
            &calibration_completed_at,
            &options.through,
        )?;
        if sessions.is_empty() {
            return Err(format!("no eligible sessions found for {display_name}"));
        }
        let started_dynamic = sessions
            .iter()
            .any(|session| session.model == ModelId::Dynamic);
        let prepared = sessions
            .into_iter()
            .map(|session| prepare_session(session, model_root))
            .collect::<Result<Vec<_>, _>>()?;
        plans.push((
            user_id,
            display_name,
            before,
            calibration_completed_at,
            calibration_evaluator_version,
            started_dynamic,
            prepared,
        ));
    }

    let backup = options
        .apply
        .then(|| backup_database(data_dir))
        .transpose()?;
    let transaction = options
        .apply
        .then(|| connection.transaction())
        .transpose()
        .map_err(|error| format!("begin handicap backfill: {error}"))?;
    let mut results = Vec::new();
    for (
        user_id,
        display_name,
        before,
        calibration_completed_at,
        calibration_evaluator_version,
        started_dynamic,
        mut sessions,
    ) in plans
    {
        let completed_analyses = sessions
            .iter()
            .map(|session| session.completed_analyses)
            .sum();
        let profile = rebuild_profile(&sessions, started_dynamic);
        let cycles = usize::try_from(profile.handicap_cycles).unwrap_or(usize::MAX);
        let games = usize::try_from(profile.length_games).unwrap_or(usize::MAX);
        let after = profile.handicap_per_game();
        if options.apply {
            persist_player(
                transaction
                    .as_ref()
                    .expect("apply mode must have a transaction"),
                user_id,
                &mut sessions,
                &profile,
            )?;
        }
        results.push(PlayerResult {
            player: display_name,
            calibration_completed_at,
            calibration_evaluator_version,
            selected_sessions: sessions.len(),
            selected_session_ids: sessions
                .iter()
                .map(|selected| selected.session.id.clone())
                .collect(),
            completed_analyses,
            cycles,
            completed_games: games,
            handicap_before: before,
            handicap_after: after,
        });
    }
    if let Some(transaction) = transaction {
        transaction
            .commit()
            .map_err(|error| format!("commit handicap backfill: {error}"))?;
    }
    println!(
        "{}",
        serde_json::to_string(&json!({
            "mode": if options.apply { "applied" } else { "dry-run" },
            "through": options.through,
            "backup": backup.map(|path| path.display().to_string()),
            "players": results,
        }))
        .map_err(|error| format!("serialize backfill report: {error}"))?
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn review(
        id: &str,
        hand_number: u32,
        human_is_dealer: bool,
        kind: ReviewKind,
        at: &str,
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
                game.player_mut(HUMAN).hand = vec![Card::new(0).unwrap(), Card::new(2).unwrap()];
                vec![0]
            }
        };
        SavedDecisionReview {
            id: id.to_string(),
            at: at.to_string(),
            kind,
            game,
            selected_card_ids,
            completed: Some(completed_review(0.45, 0.50)),
            prior_analyses: Vec::new(),
            prepared_analysis: None,
        }
    }

    fn completed_hand_event(hand_number: u32, dealer: Side, at: &str) -> SavedScoreEvent {
        SavedScoreEvent {
            id: format!("hand-{hand_number}-crib"),
            at: at.to_string(),
            hand_number,
            player: dealer,
            dealer,
            category: SavedScoreCategory::Crib,
            points: 0,
            reason: "Crib".to_string(),
            total_score: 0,
            scores: [12 * hand_number as i32, 10 * hand_number as i32],
            cards: Vec::new(),
            turn_card: None,
            count: None,
            score_components: None,
        }
    }

    fn reviewed_session(model: ModelId, id: &str, day: u32) -> Session {
        let at = format!("2026-01-{day:02}T00:00:00.000Z");
        let mut session = new_session_from_seed(model, Some("Travis".to_string()), day, 1);
        session.id = id.to_string();
        session.created_at = at.clone();
        session.updated_at = at.clone();
        session.completed_at = Some(at.clone());
        session.game.hand_number = 3;
        session.game.phase = Phase::GameOver;
        session.score_events = vec![
            completed_hand_event(1, HUMAN, &at),
            completed_hand_event(2, AI, &at),
        ];
        session.decision_reviews = vec![
            review("dealer-discard", 1, true, ReviewKind::Discard, &at),
            review("dealer-peg", 1, true, ReviewKind::Peg, &at),
            review("pone-discard", 2, false, ReviewKind::Discard, &at),
            review("pone-peg", 2, false, ReviewKind::Peg, &at),
        ];
        session
    }

    type DatabaseState = (
        String,
        Vec<(String, u32, String, String)>,
        Vec<(String, String, String)>,
        Vec<(String, String)>,
    );

    fn database_state(data_dir: &Path, user_id: i64) -> DatabaseState {
        let connection = open_game_database(data_dir).unwrap();
        let profile = connection
            .query_row(
                "SELECT profile_json FROM dynamic_player_profiles
                 WHERE user_id = ?1 AND evaluator_version = ?2",
                params![user_id, DYNAMIC_EVALUATOR_VERSION],
                |row| row.get(0),
            )
            .unwrap();
        let cycles = connection
            .prepare(
                "SELECT session_id, first_hand_number, sample_json, applied_at
                 FROM dynamic_profile_cycles
                 WHERE user_id = ?1 AND evaluator_version = ?2
                 ORDER BY applied_at, session_id, first_hand_number",
            )
            .unwrap()
            .query_map(params![user_id, DYNAMIC_EVALUATOR_VERSION], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let games = connection
            .prepare(
                "SELECT session_id, sample_json, applied_at FROM dynamic_profile_games
                 WHERE user_id = ?1 AND evaluator_version = ?2
                 ORDER BY applied_at, session_id",
            )
            .unwrap()
            .query_map(params![user_id, DYNAMIC_EVALUATOR_VERSION], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let sessions = connection
            .prepare(
                "SELECT session_id, session_json FROM cribbage_game_sessions
                 WHERE tag = 'Travis' ORDER BY session_id",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        (profile, cycles, games, sessions)
    }

    fn backup_count(data_dir: &Path) -> usize {
        std::fs::read_dir(data_dir.join("handicap-backups"))
            .unwrap()
            .count()
    }

    #[test]
    fn command_requires_an_explicit_mode_and_scope() {
        assert!(parse_options(&["backfill-handicaps".to_string()]).is_err());
        assert!(parse_options(&[
            "backfill-handicaps".to_string(),
            "--players".to_string(),
            "Shane,Garrett".to_string(),
            "--through".to_string(),
            "2026-09-07T05:00:00Z".to_string(),
            "--apply".to_string(),
        ])
        .is_err());
        assert_eq!(
            parse_options(&[
                "backfill-handicaps".to_string(),
                "--players".to_string(),
                "Shane,Garrett".to_string(),
                "--through".to_string(),
                "2026-09-07T05:00:00Z".to_string(),
                "--dry-run".to_string(),
            ])
            .unwrap(),
            Options {
                players: vec!["Shane".to_string(), "Garrett".to_string()],
                through: "2026-09-07T05:00:00.000Z".to_string(),
                apply: false,
            }
        );
    }

    #[test]
    fn selection_includes_baseline_dynamic_and_post_calibration_ace_sessions() {
        let calibration = "2026-09-05T03:50:00Z";
        let through = "2026-09-07T05:00:00Z";
        let mut baseline = new_session_from_seed(ACE_MODEL_ID, Some("Shane".to_string()), 1, 1);
        baseline.id = "baseline".to_string();
        baseline.created_at = "2026-09-01T00:00:00Z".to_string();
        baseline.completed_at = Some("2026-09-02T00:00:00Z".to_string());
        baseline.game.phase = Phase::GameOver;
        let mut dynamic = new_session_from_seed(ModelId::Dynamic, Some("Shane".to_string()), 2, 1);
        dynamic.id = "dynamic".to_string();
        dynamic.created_at = "2026-09-03T00:00:00Z".to_string();
        let mut ace = new_session_from_seed(ACE_MODEL_ID, Some("Shane".to_string()), 3, 1);
        ace.id = "ace".to_string();
        ace.created_at = "2026-09-05T04:00:00Z".to_string();
        ace.completed_at = Some("2026-09-05T05:00:00Z".to_string());
        ace.game.phase = Phase::GameOver;
        let mut early_ace = ace.clone();
        early_ace.id = "early".to_string();
        early_ace.completed_at = Some("2026-09-04T05:00:00Z".to_string());
        let baseline_ids = HashSet::from(["baseline".to_string()]);

        assert!(should_select_session(
            &baseline,
            &baseline_ids,
            calibration,
            through
        ));
        assert!(should_select_session(
            &dynamic,
            &baseline_ids,
            calibration,
            through
        ));
        assert!(should_select_session(
            &ace,
            &baseline_ids,
            calibration,
            through
        ));
        assert!(!should_select_session(
            &early_ace,
            &baseline_ids,
            calibration,
            through
        ));
    }

    #[test]
    fn apply_is_idempotent_backed_up_and_transactional() {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-handicap-backfill-test-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&data_dir).unwrap();
        auth::initialize(&data_dir).unwrap();
        let connection = open_game_database(&data_dir).unwrap();
        let user_id = connection
            .query_row(
                "SELECT id FROM auth_users WHERE username = 'Travis'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        drop(connection);

        let mut sessions = (1..=6)
            .map(|day| reviewed_session(ModelId::Myrmidon5, &format!("baseline-{day}"), day))
            .collect::<Vec<_>>();
        let mut active_dynamic = reviewed_session(ModelId::Dynamic, "dynamic-7", 7);
        active_dynamic.game.phase = Phase::Discard;
        active_dynamic.completed_at = None;
        sessions.push(active_dynamic);
        sessions.push(reviewed_session(ACE_MODEL_ID, "ace-8", 8));
        let calibration_start =
            new_session_from_seed(ModelId::Dynamic, Some("Travis".to_string()), 19, 1);
        sync_dynamic_player_profile(&data_dir, user_id, &calibration_start).unwrap();
        for session in &mut sessions {
            session.owner_user_id = Some(user_id);
            persist_session_event(&data_dir, session, "new", "{}").unwrap();
            sync_dynamic_player_profile(&data_dir, user_id, session).unwrap();
        }

        let mut arguments = vec![
            "backfill-handicaps".to_string(),
            "--players".to_string(),
            "Travis".to_string(),
            "--through".to_string(),
            "2026-01-10T00:00:00Z".to_string(),
            "--dry-run".to_string(),
        ];
        let before = database_state(&data_dir, user_id);
        let active_before = before
            .3
            .iter()
            .find(|(id, _)| id == "dynamic-7")
            .unwrap()
            .1
            .clone();
        run(&arguments, &data_dir, ".").unwrap();
        assert_eq!(database_state(&data_dir, user_id), before);
        assert!(!data_dir.join("handicap-backups").exists());

        *arguments.last_mut().unwrap() = "--apply-offline".to_string();
        run(&arguments, &data_dir, ".").unwrap();
        let first = database_state(&data_dir, user_id);
        assert_eq!(first.1.len(), 8);
        assert_eq!(
            first.3.iter().find(|(id, _)| id == "dynamic-7").unwrap().1,
            active_before
        );
        assert_eq!(backup_count(&data_dir), 1);

        run(&arguments, &data_dir, ".").unwrap();
        assert_eq!(database_state(&data_dir, user_id), first);
        assert_eq!(backup_count(&data_dir), 2);

        let connection = open_game_database(&data_dir).unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER fail_backfill BEFORE INSERT ON dynamic_profile_cycles
                 BEGIN SELECT RAISE(ABORT, 'forced backfill failure'); END;",
            )
            .unwrap();
        drop(connection);
        assert!(run(&arguments, &data_dir, ".").is_err());
        assert_eq!(database_state(&data_dir, user_id), first);

        std::fs::remove_dir_all(data_dir).unwrap();
    }
}
