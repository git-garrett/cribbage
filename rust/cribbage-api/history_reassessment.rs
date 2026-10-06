//! Offline reviews are overlays: original games and their opponent identities
//! remain available, and stale browser uploads cannot replace the reviewed copy.
use super::*;

pub fn summary(connection: &Connection, user_id: i64) -> Result<Option<Value>, String> {
    let text = connection
        .query_row(
            "SELECT summary_json FROM player_history_reassessments WHERE user_id=?1",
            [user_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("read history assessment: {error}"))?;
    text.map(|text| serde_json::from_str(&text).map_err(|error| error.to_string()))
        .transpose()
}

pub fn payload(connection: &Connection, user_id: i64, game_id: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT payload_json FROM player_reviewed_games WHERE user_id=?1 AND game_id=?2",
            params![user_id, game_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("read reviewed game: {error}"))
}

pub fn overlay_events(
    connection: &Connection,
    user_id: i64,
    events: &mut Vec<Value>,
) -> Result<(), String> {
    let mut statement = connection
        .prepare("SELECT payload_json FROM player_reviewed_games WHERE user_id=?1 ORDER BY game_id")
        .map_err(|error| format!("read reviewed history: {error}"))?;
    let rows = statement
        .query_map([user_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("read reviewed history rows: {error}"))?;
    let mut indices = events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| event["id"].as_str().map(|id| (id.to_string(), index)))
        .collect::<HashMap<_, _>>();
    for row in rows {
        let payload: Value = serde_json::from_str(&row.map_err(|error| error.to_string())?)
            .map_err(|error| format!("parse reviewed history: {error}"))?;
        let reviewed = payload["events"]
            .as_array()
            .ok_or("reviewed history lacks events")?;
        for event in reviewed {
            let id = event["id"].as_str().ok_or("reviewed event lacks id")?;
            if let Some(index) = indices.get(id) {
                events[*index] = event.clone();
            } else {
                indices.insert(id.to_string(), events.len());
                events.push(event.clone());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_is_account_scoped_and_preserves_new_games() {
        let dir = std::env::temp_dir().join(format!("reviewed-history-{}", unix_millis()));
        initialize_game_database(&dir).unwrap();
        let connection = open_game_database(&dir).unwrap();
        for user in [1, 2] {
            let game = format!("game-{user}");
            connection
                .execute(
                    "INSERT INTO player_reviewed_games VALUES (?1,?2,?3)",
                    params![
                        user,
                        game,
                        json!({"events":[{"id":game,"review":{"model":"latest"}}]}).to_string()
                    ],
                )
                .unwrap();
        }
        let mut events = vec![
            json!({"id":"game-1","review":{"model":"old"}}),
            json!({"id":"new-game"}),
        ];
        overlay_events(&connection, 1, &mut events).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["review"]["model"], "latest");
        assert_eq!(events[1]["id"], "new-game");
        assert!(summary(&connection, 2).unwrap().is_none());
        assert!(payload(&connection, 2, "game-1").unwrap().is_none());
        assert!(payload(&connection, 1, "game-1").unwrap().is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
