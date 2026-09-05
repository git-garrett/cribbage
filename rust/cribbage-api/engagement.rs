use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{auth, isoish_now, open_game_database, Request, Response, Server};

#[derive(Deserialize)]
struct EngagementRequest {
    #[serde(default = "default_days")]
    days: i64,
}

#[derive(Clone)]
struct EventRow {
    user_id: Option<i64>,
    session_id: String,
    event_name: String,
    received_at: String,
    game_id: Option<String>,
    browser: String,
    device_type: String,
    viewport_width: i64,
    viewport_height: i64,
    metadata: Value,
}

#[derive(Default)]
struct Breakdown {
    events: usize,
    sessions: HashSet<String>,
    visitors: HashSet<String>,
}

fn default_days() -> i64 {
    30
}

pub fn handle(
    server: &Server,
    request: &Request,
    authenticated_user: Option<&auth::AuthUser>,
) -> Option<Response> {
    if request.path != "/api/admin/engagement" {
        return None;
    }
    if request.method == "OPTIONS" {
        return Some(Response::empty(204));
    }
    if request.method != "POST" {
        return Some(Response::json(
            405,
            json!({"error": "Method not allowed"}).to_string(),
        ));
    }
    let Some(user) = authenticated_user else {
        return Some(Response::json(
            401,
            json!({"error": "Sign in to continue."}).to_string(),
        ));
    };
    if !auth::is_engagement_admin(user) {
        return Some(Response::json(
            403,
            json!({"error": "Engagement reporting is restricted."}).to_string(),
        ));
    }
    let input = match serde_json::from_str::<EngagementRequest>(&request.body) {
        Ok(input) if matches!(input.days, 0 | 1 | 7 | 30 | 90) => input,
        _ => {
            return Some(Response::json(
                400,
                json!({"error": "Choose a supported reporting window."}).to_string(),
            ))
        }
    };
    Some(match report(&server.data_dir, input.days) {
        Ok(report) => Response::json(200, report.to_string()),
        Err(error) => {
            eprintln!("Engagement reporting error: {error}");
            Response::json(
                500,
                json!({"error": "Engagement reporting is temporarily unavailable."}).to_string(),
            )
        }
    })
}

fn report(data_dir: &std::path::Path, days: i64) -> Result<Value, String> {
    let connection = open_game_database(data_dir)?;
    let modifier = format!("-{days} days");
    let mut statement = connection
        .prepare(
            "SELECT user_id, client_session_id, event_name, received_at, game_id,
                    browser, device_type, viewport_width, viewport_height, metadata_json
             FROM user_activity_events
             WHERE ?1 = 0 OR received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?2)
             ORDER BY received_at, id",
        )
        .map_err(|error| format!("prepare engagement events: {error}"))?;
    let rows = statement
        .query_map(params![days, modifier], |row| {
            let metadata_json = row.get::<_, String>(9)?;
            Ok(EventRow {
                user_id: row.get(0)?,
                session_id: row.get(1)?,
                event_name: row.get(2)?,
                received_at: row.get(3)?,
                game_id: row.get(4)?,
                browser: row.get(5)?,
                device_type: row.get(6)?,
                viewport_width: row.get(7)?,
                viewport_height: row.get(8)?,
                metadata: serde_json::from_str(&metadata_json).unwrap_or_else(|_| json!({})),
            })
        })
        .map_err(|error| format!("query engagement events: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read engagement events: {error}"))?;

    let sessions = rows
        .iter()
        .map(|event| event.session_id.clone())
        .collect::<HashSet<_>>();
    let registered_users = rows
        .iter()
        .filter_map(|event| event.user_id)
        .collect::<HashSet<_>>();
    let visitors = rows.iter().map(visitor_key).collect::<HashSet<_>>();
    let anonymous_sessions = rows
        .iter()
        .filter(|event| event.user_id.is_none())
        .map(|event| event.session_id.clone())
        .collect::<HashSet<_>>();
    let mut user_days: HashMap<i64, HashSet<String>> = HashMap::new();
    for event in &rows {
        if let Some(user_id) = event.user_id {
            user_days
                .entry(user_id)
                .or_default()
                .insert(day(&event.received_at));
        }
    }
    let returning_users = user_days.values().filter(|dates| dates.len() >= 2).count();
    let game_starts = rows
        .iter()
        .filter(|event| event.event_name == "game_start")
        .count();
    let game_completions = rows
        .iter()
        .filter(|event| event.event_name == "game_complete")
        .count();
    let game_forfeits = rows
        .iter()
        .filter(|event| event.event_name == "game_forfeit")
        .count();
    let game_abandons = unresolved_abandonments(&rows);

    let pathways = breakdown(rows.iter().filter_map(|event| {
        if event.event_name != "page_view" {
            return None;
        }
        metadata_string(event, "surface")
            .filter(|surface| surface.starts_with("pathway:"))
            .map(|surface| (surface.trim_start_matches("pathway:").to_string(), event))
    }));
    let opponents = breakdown(rows.iter().filter_map(|event| {
        (event.event_name == "game_start").then(|| {
            (
                metadata_string(event, "opponent")
                    .unwrap_or("Unknown")
                    .to_string(),
                event,
            )
        })
    }));
    let devices = breakdown(rows.iter().map(|event| {
        (
            format!(
                "{} · {} · {}×{}",
                title_case(&event.device_type),
                event.browser,
                event.viewport_width,
                event.viewport_height
            ),
            event,
        )
    }));

    let session_starts = sessions_for(&rows, |event| event.event_name == "session_start");
    let play_views = sessions_for(&rows, |event| {
        event.event_name == "page_view" && metadata_string(event, "surface") == Some("pathway:play")
    });
    let started_sessions = sessions_for(&rows, |event| event.event_name == "game_start");
    let completed_sessions = sessions_for(&rows, |event| event.event_name == "game_complete");
    let funnel_base = session_starts.len();
    let funnel = [
        ("Sessions started", session_starts.len()),
        ("Reached Play Now", play_views.len()),
        ("Started a game", started_sessions.len()),
        ("Completed a game", completed_sessions.len()),
    ]
    .into_iter()
    .map(|(label, count)| {
        json!({
            "label": label,
            "sessions": count,
            "conversionPercent": percent(count, funnel_base),
            "denominator": "sessions with session_start in this window"
        })
    })
    .collect::<Vec<_>>();

    let mut daily: BTreeMap<String, (HashSet<String>, HashSet<String>, usize, usize)> =
        BTreeMap::new();
    for event in &rows {
        let entry = daily.entry(day(&event.received_at)).or_default();
        entry.0.insert(visitor_key(event));
        entry.1.insert(event.session_id.clone());
        if event.event_name == "game_start" {
            entry.2 += 1;
        } else if event.event_name == "game_complete" {
            entry.3 += 1;
        }
    }
    let daily = daily
        .into_iter()
        .map(
            |(date, (daily_visitors, daily_sessions, starts, completions))| {
                json!({
                    "date": date,
                    "activeVisitors": daily_visitors.len(),
                    "sessions": daily_sessions.len(),
                    "gameStarts": starts,
                    "gameCompletions": completions
                })
            },
        )
        .collect::<Vec<_>>();
    let csv = daily_csv(&daily);
    let first_event = rows.first().map(|event| event.received_at.clone());

    Ok(json!({
        "range": {
            "days": days,
            "label": if days == 0 { "All time".to_string() } else { format!("Last {days} day{}", if days == 1 { "" } else { "s" }) },
            "from": first_event,
            "to": isoish_now()
        },
        "totals": {
            "activeVisitors": visitors.len(),
            "registeredUsers": registered_users.len(),
            "anonymousSessions": anonymous_sessions.len(),
            "sessions": sessions.len(),
            "returningUsers": returning_users,
            "events": rows.len(),
            "gameStarts": game_starts,
            "gameCompletions": game_completions,
            "gameForfeits": game_forfeits,
            "gameAbandons": game_abandons,
            "completionPercent": percent(game_completions, game_starts)
        },
        "definitions": {
            "activeVisitors": "Distinct signed-in accounts plus distinct anonymous tab sessions with an event in the selected window.",
            "returningUsers": "Signed-in accounts active on at least two distinct UTC dates in the selected window.",
            "gameAbandons": "Games whose latest abandonment candidate has no later resume, completion, or forfeit event in the selected window.",
            "completionPercent": "Game completions divided by game starts in the selected window."
        },
        "funnel": funnel,
        "pathways": pathways,
        "opponents": opponents,
        "devices": devices,
        "daily": daily,
        "csv": csv
    }))
}

fn visitor_key(event: &EventRow) -> String {
    event
        .user_id
        .map(|id| format!("user:{id}"))
        .unwrap_or_else(|| format!("anonymous:{}", event.session_id))
}

fn day(value: &str) -> String {
    value.chars().take(10).collect()
}

fn metadata_string<'a>(event: &'a EventRow, key: &str) -> Option<&'a str> {
    event.metadata.get(key).and_then(Value::as_str)
}

fn percent(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        ((numerator as f64 / denominator as f64) * 1000.0).round() / 10.0
    }
}

fn title_case(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => "Unknown".to_string(),
    }
}

fn sessions_for(rows: &[EventRow], predicate: impl Fn(&EventRow) -> bool) -> HashSet<String> {
    rows.iter()
        .filter(|event| predicate(event))
        .map(|event| event.session_id.clone())
        .collect()
}

fn unresolved_abandonments(rows: &[EventRow]) -> usize {
    let mut candidates: HashMap<String, usize> = HashMap::new();
    for (index, event) in rows.iter().enumerate() {
        let Some(game_id) = &event.game_id else {
            continue;
        };
        if event.event_name == "game_abandonment_candidate" {
            candidates.insert(game_id.clone(), index);
        } else if matches!(
            event.event_name.as_str(),
            "game_resume" | "game_complete" | "game_forfeit"
        ) {
            if candidates
                .get(game_id)
                .is_some_and(|candidate| *candidate < index)
            {
                candidates.remove(game_id);
            }
        }
    }
    candidates.len()
}

fn breakdown<'a>(rows: impl Iterator<Item = (String, &'a EventRow)>) -> Vec<Value> {
    let mut groups: BTreeMap<String, Breakdown> = BTreeMap::new();
    for (label, event) in rows {
        let group = groups.entry(label).or_default();
        group.events += 1;
        group.sessions.insert(event.session_id.clone());
        group.visitors.insert(visitor_key(event));
    }
    let mut result = groups
        .into_iter()
        .map(|(label, group)| {
            json!({
                "label": label,
                "events": group.events,
                "sessions": group.sessions.len(),
                "visitors": group.visitors.len()
            })
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| {
        right["events"]
            .as_u64()
            .cmp(&left["events"].as_u64())
            .then_with(|| left["label"].as_str().cmp(&right["label"].as_str()))
    });
    result
}

fn daily_csv(daily: &[Value]) -> String {
    let mut csv = "date,active_visitors,sessions,game_starts,game_completions\n".to_string();
    for row in daily {
        csv.push_str(&format!(
            "{},{},{},{},{}\n",
            row["date"].as_str().unwrap_or_default(),
            row["activeVisitors"].as_u64().unwrap_or_default(),
            row["sessions"].as_u64().unwrap_or_default(),
            row["gameStarts"].as_u64().unwrap_or_default(),
            row["gameCompletions"].as_u64().unwrap_or_default(),
        ));
    }
    csv
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_server(name: &str) -> Server {
        let data_dir = std::env::temp_dir().join(format!(
            "cribbage-engagement-test-{name}-{}-{}",
            std::process::id(),
            super::super::unix_millis()
        ));
        super::super::auth::initialize(&data_dir).unwrap();
        super::super::activity::initialize(&data_dir).unwrap();
        Server {
            state: std::sync::Mutex::new(Default::default()),
            model_root: ".".to_string(),
            data_dir,
        }
    }

    fn request(days: i64) -> Request {
        Request {
            method: "POST".to_string(),
            path: "/api/admin/engagement".to_string(),
            headers: HashMap::new(),
            body: json!({"days": days}).to_string(),
        }
    }

    fn add_event(
        server: &Server,
        id: &str,
        user_id: Option<i64>,
        session: &str,
        name: &str,
        game_id: Option<&str>,
        metadata: Value,
    ) {
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO user_activity_events
             (event_id, client_session_id, user_id, environment, app_version, event_name,
              occurred_at, received_at, page, game_id, client_type, browser, device_type,
              viewport_width, viewport_height, screen_width, screen_height, device_pixel_ratio,
              language, timezone, platform, touch_points, metadata_json)
             VALUES (?1, ?2, ?3, 'prod', '16.3.0', ?4, '2026-09-05T12:00:00Z',
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '/', ?5, 'web', 'safari',
                     'phone', 390, 844, 390, 844, 3.0, 'en-US', 'UTC', 'iPhone', 5, ?6)",
                params![id, session, user_id, name, game_id, metadata.to_string()],
            )
            .unwrap();
    }

    #[test]
    fn owner_and_test_user_receive_the_same_seeded_report() {
        let server = test_server("authorized");
        add_event(
            &server,
            "1",
            Some(1),
            "s1",
            "session_start",
            None,
            json!({}),
        );
        add_event(
            &server,
            "2",
            Some(1),
            "s1",
            "page_view",
            None,
            json!({"surface":"pathway:play"}),
        );
        add_event(
            &server,
            "3",
            Some(1),
            "s1",
            "game_start",
            Some("g1"),
            json!({"opponent":"dynamic"}),
        );
        add_event(
            &server,
            "4",
            Some(1),
            "s1",
            "game_complete",
            Some("g1"),
            json!({}),
        );
        let owner = auth::test_auth_user(1, "Garrett");
        let tester = auth::test_auth_user(8, "Test");
        let owner_response = handle(&server, &request(30), Some(&owner)).unwrap();
        let tester_response = handle(&server, &request(30), Some(&tester)).unwrap();
        assert_eq!(owner_response.status, 200);
        let mut owner_value: Value = serde_json::from_str(&owner_response.body).unwrap();
        let mut tester_value: Value = serde_json::from_str(&tester_response.body).unwrap();
        owner_value["range"]["to"] = Value::Null;
        tester_value["range"]["to"] = Value::Null;
        assert_eq!(owner_value, tester_value);
        let value = owner_value;
        assert_eq!(value["totals"]["gameStarts"], 1);
        assert_eq!(value["totals"]["gameCompletions"], 1);
        assert_eq!(value["totals"]["completionPercent"], 100.0);
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn unauthorized_users_receive_no_admin_data() {
        let server = test_server("forbidden");
        add_event(
            &server,
            "1",
            Some(1),
            "secret-session",
            "session_start",
            None,
            json!({}),
        );
        let player = auth::test_auth_user(2, "Player");
        let response = handle(&server, &request(30), Some(&player)).unwrap();
        assert_eq!(response.status, 403);
        assert!(!response.body.contains("secret-session"));
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn abandonment_candidates_are_cleared_by_later_activity() {
        let rows = vec![
            EventRow {
                user_id: Some(1),
                session_id: "s".into(),
                event_name: "game_abandonment_candidate".into(),
                received_at: "1".into(),
                game_id: Some("resumed".into()),
                browser: "x".into(),
                device_type: "desktop".into(),
                viewport_width: 1,
                viewport_height: 1,
                metadata: json!({}),
            },
            EventRow {
                user_id: Some(1),
                session_id: "s".into(),
                event_name: "game_resume".into(),
                received_at: "2".into(),
                game_id: Some("resumed".into()),
                browser: "x".into(),
                device_type: "desktop".into(),
                viewport_width: 1,
                viewport_height: 1,
                metadata: json!({}),
            },
            EventRow {
                user_id: Some(1),
                session_id: "s".into(),
                event_name: "game_abandonment_candidate".into(),
                received_at: "3".into(),
                game_id: Some("abandoned".into()),
                browser: "x".into(),
                device_type: "desktop".into(),
                viewport_width: 1,
                viewport_height: 1,
                metadata: json!({}),
            },
        ];
        assert_eq!(unresolved_abandonments(&rows), 1);
    }
}
