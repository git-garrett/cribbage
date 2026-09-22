//! One player history across Ace promotions. Evaluator versions belong to the
//! evidence ledger, not to the identity of the aggregate or its calibration.
use super::*;

pub const PLAYER_HISTORY_KEY: &str = "player-history";

type CycleKey = (String, u32);

pub fn save(connection: &Connection, user_id: i64, profile: &DynamicProfile) -> Result<(), String> {
    connection.execute(
        "INSERT INTO dynamic_player_profiles (user_id, evaluator_version, profile_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id, evaluator_version) DO UPDATE SET
           profile_json=excluded.profile_json, updated_at=excluded.updated_at",
        params![user_id, PLAYER_HISTORY_KEY, serde_json::to_string(profile)
            .map_err(|error| format!("serialize player history: {error}"))?, isoish_now()],
    ).map_err(|error| format!("save player history: {error}"))?;
    Ok(())
}

fn promote(mut profile: DynamicProfile) -> DynamicProfile {
    // The saved history is independent of whether its former evaluator is
    // still present in the model registry. Only the profile schema migrates.
    profile.evaluator_version = DYNAMIC_EVALUATOR_VERSION.to_string();
    profile = profile.into_current();
    profile.strength_baseline_evaluator = None;
    profile
}

pub fn load(connection: &Connection, user_id: i64) -> Result<Option<DynamicProfile>, String> {
    let stored = connection.query_row(
        "SELECT profile_json FROM dynamic_player_profiles WHERE user_id=?1 AND evaluator_version=?2",
        params![user_id, PLAYER_HISTORY_KEY], |row| row.get::<_, String>(0),
    ).optional().map_err(|error| format!("read player history: {error}"))?;
    if let Some(text) = stored {
        return serde_json::from_str(&text)
            .map(promote)
            .map(Some)
            .map_err(|error| format!("parse player history: {error}"));
    }
    legacy_history(connection, user_id)
}

/// Preserve a legacy aggregate exactly, then apply previously uncounted cycles.
/// A later backfill may supersede the baseline only when its recorded evidence
/// covers the earlier history in full. This avoids both discarding an existing
/// EWMA and counting the same reviewed hands again under another Ace version.
fn legacy_history(connection: &Connection, user_id: i64) -> Result<Option<DynamicProfile>, String> {
    let mut statement = connection
        .prepare(
            "SELECT evaluator_version, profile_json FROM dynamic_player_profiles
         WHERE user_id=?1 ORDER BY updated_at, evaluator_version",
        )
        .map_err(|error| format!("read legacy profiles: {error}"))?;
    let rows = statement
        .query_map([user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("read legacy profiles: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("collect legacy profiles: {error}"))?;
    let mut profiles = Vec::new();
    for (version, text) in rows {
        if ModelId::from_str(&version).is_ok_and(|model| model.is_ace()) {
            let profile: DynamicProfile = serde_json::from_str(&text)
                .map_err(|error| format!("parse legacy profile: {error}"))?;
            profiles.push((version, promote(profile)));
        }
    }
    if profiles.is_empty() {
        return Ok(None);
    }
    let versions: HashSet<_> = profiles
        .iter()
        .map(|(version, _)| version.clone())
        .collect();
    let mut statement = connection
        .prepare(
            "SELECT evaluator_version, session_id, first_hand_number, sample_json
         FROM dynamic_profile_cycles WHERE user_id=?1 ORDER BY applied_at, rowid",
        )
        .map_err(|error| format!("read legacy cycles: {error}"))?;
    let cycles = statement
        .query_map([user_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                (row.get::<_, String>(1)?, row.get::<_, u32>(2)?),
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| format!("read legacy cycles: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("collect legacy cycles: {error}"))?;
    let mut statement = connection
        .prepare(
            "SELECT evaluator_version, session_id, sample_json FROM dynamic_profile_games
         WHERE user_id=?1 ORDER BY applied_at, rowid",
        )
        .map_err(|error| format!("read legacy lengths: {error}"))?;
    let games = statement
        .query_map([user_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("read legacy lengths: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("collect legacy lengths: {error}"))?;
    let cycle_keys = |version: &str| -> HashSet<CycleKey> {
        cycles
            .iter()
            .filter(|row| row.0 == version)
            .map(|row| row.1.clone())
            .collect()
    };
    let game_keys = |version: &str| -> HashSet<String> {
        games
            .iter()
            .filter(|row| row.0 == version)
            .map(|row| row.1.clone())
            .collect()
    };
    let mut baseline = &profiles[0];
    let mut seen_cycles = cycle_keys(&baseline.0);
    let mut seen_games = game_keys(&baseline.0);
    for candidate in profiles.iter().skip(1) {
        let candidate_cycles = cycle_keys(&candidate.0);
        let candidate_games = game_keys(&candidate.0);
        if (baseline.1.complete_cycles == 0 || !seen_cycles.is_empty())
            && candidate.1.complete_cycles >= baseline.1.complete_cycles
            && candidate.1.handicap_cycles >= baseline.1.handicap_cycles
            && candidate.1.length_games >= baseline.1.length_games
            && candidate_cycles.len() >= candidate.1.complete_cycles as usize
            && candidate_games.len() >= candidate.1.length_games as usize
            && seen_cycles.is_subset(&candidate_cycles)
            && seen_games.is_subset(&candidate_games)
        {
            baseline = candidate;
            seen_cycles = candidate_cycles;
            seen_games = candidate_games;
        }
    }
    let mut profile = baseline.1.clone();
    profile.started_dynamic = profiles.iter().any(|(_, profile)| profile.started_dynamic);
    for (version, key, text) in cycles {
        if !versions.contains(&version) || !seen_cycles.insert(key) {
            continue;
        }
        let value: Value =
            serde_json::from_str(&text).map_err(|error| format!("parse legacy cycle: {error}"))?;
        let mut sample: DynamicCycleSample = serde_json::from_value(value.clone())
            .map_err(|error| format!("parse legacy cycle: {error}"))?;
        // Pre-cycle-handicap evidence has no total. It must not become a false
        // zero-regret handicap sample merely because serde supplies a default.
        if value.get("total_regret").is_none() {
            sample.total_regret = f64::NAN;
        }
        profile.observe_cycle(sample);
    }
    for (version, key, text) in games {
        if !versions.contains(&version) || !seen_games.insert(key) {
            continue;
        }
        let value: Value =
            serde_json::from_str(&text).map_err(|error| format!("parse legacy length: {error}"))?;
        if let Some(length) = value["cyclesPerGame"].as_f64() {
            profile.observe_game_length(length);
        }
    }
    Ok(Some(profile))
}

pub fn migrate(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("begin player history migration: {error}"))?;
    let users = transaction
        .prepare(
            "SELECT DISTINCT user_id FROM dynamic_player_profiles WHERE user_id NOT IN
         (SELECT user_id FROM dynamic_player_profiles WHERE evaluator_version=?1)",
        )
        .map_err(|error| format!("find legacy players: {error}"))?
        .query_map([PLAYER_HISTORY_KEY], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("read legacy players: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("collect legacy players: {error}"))?;
    for user_id in users {
        if let Some(profile) = load(&transaction, user_id)? {
            save(&transaction, user_id, &profile)?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("commit player history migration: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database(label: &str) -> (PathBuf, Connection) {
        let dir = std::env::temp_dir().join(format!(
            "continuous-history-{label}-{}-{}",
            std::process::id(),
            unix_millis()
        ));
        initialize_game_database(&dir).unwrap();
        let connection = open_game_database(&dir).unwrap();
        (dir, connection)
    }

    fn sample(regret: f64) -> DynamicCycleSample {
        DynamicCycleSample {
            dealer_discard_regret: regret / 4.0,
            dealer_pegging_regret: regret / 4.0,
            pone_discard_regret: regret / 4.0,
            pone_pegging_regret: regret / 4.0,
            total_regret: regret,
        }
    }

    fn legacy(
        connection: &Connection,
        version: &str,
        indices: std::ops::Range<u32>,
        regret: f64,
        at: &str,
    ) -> DynamicProfile {
        let mut profile = DynamicProfile {
            started_dynamic: true,
            ..DynamicProfile::default()
        };
        for index in indices {
            profile.observe_cycle(sample(regret));
            profile.observe_game_length(4.5);
            let session = format!("game-{index}");
            connection
                .execute(
                    "INSERT INTO dynamic_profile_cycles VALUES (1,?1,?2,1,?3,?4)",
                    params![
                        version,
                        session,
                        serde_json::to_string(&sample(regret)).unwrap(),
                        at
                    ],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO dynamic_profile_games VALUES (1,?1,?2,?3,?4)",
                    params![
                        version,
                        session,
                        json!({"cyclesPerGame":4.5}).to_string(),
                        at
                    ],
                )
                .unwrap();
        }
        profile.evaluator_version = version.to_string();
        connection
            .execute(
                "INSERT INTO dynamic_player_profiles VALUES (1,?1,?2,?3)",
                params![version, serde_json::to_string(&profile).unwrap(), at],
            )
            .unwrap();
        profile
    }

    #[test]
    fn migration_extends_backfilled_history_once_and_keeps_legacy_records() {
        let (dir, mut connection) = database("backfilled");
        legacy(&connection, MODEL_13_0, 0..8, 0.06, "2026-09-01");
        let previous = legacy(&connection, MODEL_13_215, 0..58, 0.02, "2026-09-15");
        legacy(
            &connection,
            DYNAMIC_EVALUATOR_VERSION,
            58..66,
            0.04,
            "2026-09-22",
        );
        let mut expected = promote(previous);
        for _ in 0..8 {
            expected.observe_cycle(sample(0.04));
            expected.observe_game_length(4.5);
        }
        assert_eq!(load(&connection, 1).unwrap().unwrap(), expected);
        migrate(&mut connection).unwrap();
        assert_eq!(load(&connection, 1).unwrap().unwrap(), expected);
        migrate(&mut connection).unwrap();
        assert_eq!(load(&connection, 1).unwrap().unwrap(), expected);
        let count: u32 = connection
            .query_row("SELECT count(*) FROM dynamic_profile_cycles", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 74, "original review evidence remains intact");
        // Re-reviewing either an old or new game with the current model adds nothing.
        for session in ["game-0", "game-58"] {
            let transaction = connection.transaction().unwrap();
            assert!(sync_dynamic_profile_evidence(
                &transaction,
                1,
                session,
                true,
                vec![EligibleDynamicCycle {
                    first_hand: 1,
                    strength_sample: sample(0.3)
                }],
                Some(6.0)
            )
            .unwrap()
            .is_none());
            transaction.commit().unwrap();
        }
        assert_eq!(load(&connection, 1).unwrap().unwrap(), expected);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn partial_calibration_accumulates_across_versions() {
        let (dir, connection) = database("partial");
        let previous = legacy(&connection, MODEL_13_215, 0..3, 0.02, "2026-09-15");
        legacy(
            &connection,
            DYNAMIC_EVALUATOR_VERSION,
            3..6,
            0.04,
            "2026-09-22",
        );
        let mut expected = promote(previous);
        for _ in 0..3 {
            expected.observe_cycle(sample(0.04));
            expected.observe_game_length(4.5);
        }
        let actual = load(&connection, 1).unwrap().unwrap();
        assert_eq!(actual, expected);
        assert_eq!(actual.complete_cycles, MIN_COMPLETE_CYCLES);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn future_promotion_keeps_the_entire_continuous_profile() {
        let (dir, mut connection) = database("future");
        let mut previous = legacy(&connection, MODEL_13_215, 0..12, 0.02, "2026-09-15");
        previous.evaluator_version = "retired-ace-evaluator".to_string();
        save(&connection, 1, &previous).unwrap();
        let expected = promote(previous);
        assert_eq!(load(&connection, 1).unwrap().unwrap(), expected);
        let transaction = connection.transaction().unwrap();
        let actual = sync_dynamic_profile_evidence(
            &transaction,
            1,
            "new",
            false,
            vec![EligibleDynamicCycle {
                first_hand: 1,
                strength_sample: sample(0.04),
            }],
            Some(5.0),
        )
        .unwrap()
        .unwrap();
        transaction.commit().unwrap();
        let mut expected = expected;
        expected.observe_cycle(sample(0.04));
        expected.observe_game_length(5.0);
        assert_eq!(actual, expected);
        assert_eq!(load(&connection, 1).unwrap().unwrap(), expected);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn larger_new_version_history_does_not_replace_disjoint_older_history() {
        let (dir, connection) = database("larger");
        let previous = legacy(&connection, MODEL_13_215, 0..6, 0.02, "2026-09-15");
        legacy(
            &connection,
            DYNAMIC_EVALUATOR_VERSION,
            6..20,
            0.04,
            "2026-09-22",
        );
        let mut expected = promote(previous);
        for _ in 0..14 {
            expected.observe_cycle(sample(0.04));
            expected.observe_game_length(4.5);
        }
        assert_eq!(load(&connection, 1).unwrap().unwrap(), expected);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
