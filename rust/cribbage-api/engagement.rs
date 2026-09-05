use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{auth, isoish_now, open_game_database, Request, Response, Server};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngagementRequest {
    #[serde(default = "default_days")]
    days: i64,
    #[serde(default = "default_all")]
    environment: String,
    #[serde(default = "default_all")]
    audience: String,
}

#[derive(Clone)]
struct EventRow {
    user_id: Option<i64>,
    username: Option<String>,
    display_name: Option<String>,
    session_id: String,
    event_name: String,
    received_at: String,
    page: String,
    game_id: Option<String>,
    environment: String,
    app_version: String,
    client_type: String,
    browser: String,
    device_type: String,
    viewport_width: i64,
    viewport_height: i64,
    screen_width: i64,
    screen_height: i64,
    device_pixel_ratio: f64,
    touch_points: i64,
    language: String,
    timezone: String,
    platform: String,
    metadata: Value,
    active_now: bool,
    active_last_24_hours: bool,
    visitor_id: String,
}

#[derive(Default)]
struct Breakdown {
    events: usize,
    sessions: HashSet<String>,
    visitors: HashSet<String>,
}

#[derive(Default)]
struct TimeBucket {
    events: usize,
    visitors: HashSet<String>,
    sessions: HashSet<String>,
    game_starts: HashSet<String>,
    game_completions: HashSet<String>,
    game_forfeits: HashSet<String>,
    bounces: usize,
    error_events: usize,
    friction_events: usize,
    abandonment_candidates: HashSet<String>,
}

#[derive(Default)]
struct UserActivity {
    username: String,
    display_name: String,
    last_active: String,
    active_days: HashSet<String>,
    sessions: HashSet<String>,
    events: usize,
    page_views: usize,
    game_starts: HashSet<String>,
    observed_games: HashSet<String>,
    game_completions: HashSet<String>,
    errors: usize,
    friction_events: usize,
    clients: HashMap<String, usize>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Totals {
    active_visitors: usize,
    registered_users: usize,
    anonymous_sessions: usize,
    signed_in_sessions: usize,
    sessions: usize,
    returning_users: usize,
    events: usize,
    page_views: usize,
    interactions: usize,
    active_now: usize,
    active_last_24_hours: usize,
    game_starts: usize,
    observed_games: usize,
    game_resumes: usize,
    game_completions: usize,
    game_forfeits: usize,
    game_abandons: usize,
    completion_percent: f64,
    bounce_sessions: usize,
    bounce_percent: f64,
    error_events: usize,
    error_sessions: usize,
    friction_events: usize,
    friction_sessions: usize,
    average_exit_seconds: f64,
}

fn default_days() -> i64 {
    30
}

fn default_all() -> String {
    "all".to_string()
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
    if !auth::is_engagement_admin(&server.data_dir, user) {
        return Some(Response::json(
            403,
            json!({"error": "Engagement reporting is restricted."}).to_string(),
        ));
    }
    let input = match serde_json::from_str::<EngagementRequest>(&request.body) {
        Ok(input)
            if matches!(input.days, 0 | 1 | 7 | 30 | 90)
                && matches!(
                    input.environment.as_str(),
                    "all" | "local" | "lan" | "prod" | "ios"
                )
                && matches!(input.audience.as_str(), "all" | "registered" | "anonymous") =>
        {
            input
        }
        _ => {
            return Some(Response::json(
                400,
                json!({"error": "Choose supported report filters."}).to_string(),
            ))
        }
    };
    Some(
        match report(
            &server.data_dir,
            input.days,
            &input.environment,
            &input.audience,
        ) {
            Ok(report) => Response::json(200, report.to_string()),
            Err(error) => {
                eprintln!("Engagement reporting error: {error}");
                Response::json(
                    500,
                    json!({"error": "Engagement reporting is temporarily unavailable."})
                        .to_string(),
                )
            }
        },
    )
}

fn report(
    data_dir: &std::path::Path,
    days: i64,
    environment: &str,
    audience: &str,
) -> Result<Value, String> {
    let rows = load_events(data_dir, days, environment, audience, false)?;
    let previous_rows = if days == 0 {
        Vec::new()
    } else {
        load_events(data_dir, days, environment, audience, true)?
    };
    let report_totals = totals(&rows);
    let previous_totals = totals(&previous_rows);
    let comparison_value = if days == 0 {
        Value::Null
    } else {
        comparison(&report_totals, &previous_totals)
    };

    let pathways = breakdown(rows.iter().filter_map(|event| {
        if event.event_name != "page_view" {
            return None;
        }
        metadata_string(event, "surface")
            .filter(|surface| surface.starts_with("pathway:"))
            .map(|surface| (title_case(surface.trim_start_matches("pathway:")), event))
    }));
    let opponents = game_breakdown(&rows);
    let devices = breakdown(rows.iter().map(|event| {
        (
            format!(
                "{} · {} · {}×{}",
                title_case(&event.device_type),
                title_case(&event.browser),
                event.viewport_width,
                event.viewport_height
            ),
            event,
        )
    }));
    let clients = breakdown(rows.iter().map(|event| {
        (
            format!(
                "{} · {} · {}×{} screen · {:.1}× · {} touch",
                title_case(&event.client_type),
                title_case(&event.platform),
                event.screen_width,
                event.screen_height,
                event.device_pixel_ratio,
                event.touch_points
            ),
            event,
        )
    }));
    let environments = breakdown(rows.iter().map(|event| {
        (
            format!(
                "{} · v{}",
                title_case(&event.environment),
                event.app_version
            ),
            event,
        )
    }));
    let locations = breakdown(rows.iter().map(|event| {
        (
            format!(
                "{} · {}",
                if event.timezone.is_empty() {
                    "Unknown timezone"
                } else {
                    &event.timezone
                },
                if event.language.is_empty() {
                    "Unknown language"
                } else {
                    &event.language
                }
            ),
            event,
        )
    }));
    let surfaces = breakdown(rows.iter().filter_map(|event| {
        (event.event_name == "page_view").then(|| {
            (
                metadata_string(event, "surface")
                    .map(title_case)
                    .unwrap_or_else(|| event.page.clone()),
                event,
            )
        })
    }));
    let event_types = breakdown(
        rows.iter()
            .map(|event| (title_case(&event.event_name), event)),
    );
    let states = breakdown(rows.iter().filter_map(|event| {
        let label = match event.event_name.as_str() {
            "visibility" => metadata_string(event, "state")
                .map(|value| format!("Visibility · {}", title_case(value))),
            "viewport_resize" => metadata_string(event, "orientation")
                .map(|value| format!("Resize · {}", title_case(value))),
            "login" => metadata_string(event, "method")
                .map(|value| format!("Login · {}", title_case(value))),
            "logout" => Some("Logout".to_string()),
            _ => metadata_string(event, "phase")
                .map(|value| format!("Game phase · {}", title_case(value))),
        };
        label.map(|value| (value, event))
    }));
    let interactions = breakdown(rows.iter().filter_map(|event| {
        matches!(
            event.event_name.as_str(),
            "ui_interaction" | "repeat_ui_action" | "rage_click"
        )
        .then(|| {
            (
                metadata_string(event, "target")
                    .map(friendly_target)
                    .unwrap_or_else(|| "Unknown control".to_string()),
                event,
            )
        })
    }));
    let errors = breakdown(rows.iter().filter_map(|event| {
        matches!(
            event.event_name.as_str(),
            "client_error" | "server_error_ui"
        )
        .then(|| {
            let kind = if event.event_name == "client_error" {
                "Client"
            } else {
                "Server"
            };
            (
                format!(
                    "{kind} · {}",
                    metadata_string(event, "error").unwrap_or("No error summary")
                ),
                event,
            )
        })
    }));

    let funnel_counts = ordered_funnel_counts(&rows);
    let funnel_base = funnel_counts[0];
    let funnel = [
        ("Sessions started", funnel_counts[0]),
        ("Reached home", funnel_counts[1]),
        ("Reached Play Now", funnel_counts[2]),
        ("Started a game", funnel_counts[3]),
        ("Completed a game", funnel_counts[4]),
    ]
    .into_iter()
    .scan(None, |previous: &mut Option<usize>, (label, count)| {
        let drop_off = previous.map(|value| value.saturating_sub(count));
        *previous = Some(count);
        Some(json!({
            "label": label,
            "sessions": count,
            "conversionPercent": percent(count, funnel_base),
            "dropOff": drop_off,
            "denominator": "sessions with session_start in this window"
        }))
    })
    .collect::<Vec<_>>();

    let daily = time_series(&rows, false);
    let hourly = time_series(&rows, true);
    let users = user_activity(&rows);
    let recent_activity = recent_activity(&rows);
    let csv = engagement_csv(&daily);
    let first_event = rows.first().map(|event| event.received_at.clone());

    Ok(json!({
        "range": {
            "days": days,
            "label": if days == 0 { "All time".to_string() } else { format!("Last {days} day{}", if days == 1 { "" } else { "s" }) },
            "from": first_event,
            "to": isoish_now(),
            "environment": environment,
            "audience": audience
        },
        "totals": report_totals,
        "comparison": comparison_value,
        "definitions": {
            "activeVisitors": "Distinct signed-in accounts plus distinct anonymous tab sessions with an event in the selected window.",
            "activeNow": "Distinct visitors with an event received in the last 15 minutes.",
            "returningUsers": "Signed-in accounts active on at least two distinct UTC dates in the selected window.",
            "gameAbandons": "Games whose latest abandonment candidate has no later resume, completion, or forfeit event in the selected window.",
            "completionPercent": "Distinct completed games divided by distinct games with any lifecycle event in the selected window.",
            "bouncePercent": "Sessions with a bounce event divided by all sessions in the selected window.",
            "averageExitSeconds": "Average observed page lifetime from page_exit events; exits the browser could not send are absent."
        },
        "funnel": funnel,
        "pathways": pathways,
        "opponents": opponents,
        "devices": devices,
        "clients": clients,
        "environments": environments,
        "locations": locations,
        "surfaces": surfaces,
        "eventTypes": event_types,
        "states": states,
        "interactions": interactions,
        "errors": errors,
        "users": users,
        "recentActivity": recent_activity,
        "daily": daily,
        "hourly": hourly,
        "csv": csv
    }))
}

fn load_events(
    data_dir: &std::path::Path,
    days: i64,
    environment: &str,
    audience: &str,
    previous: bool,
) -> Result<Vec<EventRow>, String> {
    let connection = open_game_database(data_dir)?;
    let modifier = format!("-{days} days");
    let previous_modifier = format!("-{} days", days * 2);
    let window = if previous {
        "?1 > 0 AND e.received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?3)
         AND e.received_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?2)"
    } else {
        "(?1 = 0 OR e.received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?2))"
    };
    let sql = format!(
        "SELECT e.user_id, u.username, u.display_name, e.client_session_id,
                e.event_name, e.received_at, e.page, e.game_id, e.environment,
                e.app_version, e.client_type, e.browser, e.device_type,
                e.viewport_width, e.viewport_height, e.screen_width, e.screen_height,
                e.device_pixel_ratio, e.touch_points, e.language, e.timezone, e.platform,
                e.metadata_json,
                e.received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 minutes'),
                e.received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')
         FROM user_activity_events e
         LEFT JOIN auth_users u ON u.id = e.user_id
         WHERE {window}
           AND (?4 = 'all' OR e.environment = ?4)
           AND (?5 = 'all' OR (?5 = 'registered' AND e.user_id IS NOT NULL)
                OR (?5 = 'anonymous' AND e.user_id IS NULL))
         ORDER BY e.received_at, e.id"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("prepare engagement events: {error}"))?;
    let mut rows = statement
        .query_map(
            params![days, modifier, previous_modifier, environment, audience],
            |row| {
                let metadata_json = row.get::<_, String>(22)?;
                Ok(EventRow {
                    user_id: row.get(0)?,
                    username: row.get(1)?,
                    display_name: row.get(2)?,
                    session_id: row.get(3)?,
                    event_name: row.get(4)?,
                    received_at: row.get(5)?,
                    page: row.get(6)?,
                    game_id: row.get(7)?,
                    environment: row.get(8)?,
                    app_version: row.get(9)?,
                    client_type: row.get(10)?,
                    browser: row.get(11)?,
                    device_type: row.get(12)?,
                    viewport_width: row.get(13)?,
                    viewport_height: row.get(14)?,
                    screen_width: row.get(15)?,
                    screen_height: row.get(16)?,
                    device_pixel_ratio: row.get(17)?,
                    touch_points: row.get(18)?,
                    language: row.get(19)?,
                    timezone: row.get(20)?,
                    platform: row.get(21)?,
                    metadata: serde_json::from_str(&metadata_json).unwrap_or_else(|_| json!({})),
                    active_now: row.get::<_, i64>(23)? != 0,
                    active_last_24_hours: row.get::<_, i64>(24)? != 0,
                    visitor_id: String::new(),
                })
            },
        )
        .map_err(|error| format!("query engagement events: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read engagement events: {error}"))?;
    let session_users = rows
        .iter()
        .filter_map(|event| {
            event
                .user_id
                .map(|user_id| (event.session_id.clone(), user_id))
        })
        .collect::<HashMap<_, _>>();
    for event in &mut rows {
        event.visitor_id = session_users
            .get(&event.session_id)
            .copied()
            .or(event.user_id)
            .map(|id| format!("user:{id}"))
            .unwrap_or_else(|| format!("anonymous:{}", event.session_id));
    }
    Ok(rows)
}

fn totals(rows: &[EventRow]) -> Totals {
    let sessions = rows
        .iter()
        .map(|event| event.session_id.clone())
        .collect::<HashSet<_>>();
    let signed_in_sessions = rows
        .iter()
        .filter(|event| event.user_id.is_some())
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
    for event in rows {
        if let Some(user_id) = event.user_id {
            user_days
                .entry(user_id)
                .or_default()
                .insert(day(&event.received_at));
        }
    }
    let returning_users = user_days.values().filter(|dates| dates.len() >= 2).count();
    let game_starts = distinct_games(rows, |event| event.event_name == "game_start").len();
    let observed_games = distinct_games(rows, is_game_lifecycle).len();
    let game_completions = distinct_games(rows, |event| event.event_name == "game_complete").len();
    let bounce_sessions = sessions_for(rows, |event| event.event_name == "bounce");
    let error_sessions = sessions_for(rows, is_error);
    let friction_sessions = sessions_for(rows, is_friction);
    let exit_durations = rows
        .iter()
        .filter(|event| event.event_name == "page_exit")
        .filter_map(|event| metadata_number(event, "durationMs"))
        .collect::<Vec<_>>();
    Totals {
        active_visitors: visitors.len(),
        registered_users: registered_users.len(),
        anonymous_sessions: anonymous_sessions.len(),
        signed_in_sessions: signed_in_sessions.len(),
        sessions: sessions.len(),
        returning_users,
        events: rows.len(),
        page_views: count_events(rows, &["page_view"]),
        interactions: count_events(rows, &["ui_interaction"]),
        active_now: rows
            .iter()
            .filter(|event| event.active_now)
            .map(visitor_key)
            .collect::<HashSet<_>>()
            .len(),
        active_last_24_hours: rows
            .iter()
            .filter(|event| event.active_last_24_hours)
            .map(visitor_key)
            .collect::<HashSet<_>>()
            .len(),
        game_starts,
        observed_games,
        game_resumes: count_events(rows, &["game_resume"]),
        game_completions,
        game_forfeits: distinct_games(rows, |event| event.event_name == "game_forfeit").len(),
        game_abandons: unresolved_abandonments(rows),
        completion_percent: percent(game_completions, observed_games),
        bounce_sessions: bounce_sessions.len(),
        bounce_percent: percent(bounce_sessions.len(), sessions.len()),
        error_events: rows.iter().filter(|event| is_error(event)).count(),
        error_sessions: error_sessions.len(),
        friction_events: rows.iter().filter(|event| is_friction(event)).count(),
        friction_sessions: friction_sessions.len(),
        average_exit_seconds: if exit_durations.is_empty() {
            0.0
        } else {
            ((exit_durations.iter().sum::<f64>() / exit_durations.len() as f64) / 100.0).round()
                / 10.0
        },
    }
}

fn comparison(current: &Totals, previous: &Totals) -> Value {
    json!({
        "activeVisitors": percent_change(current.active_visitors as f64, previous.active_visitors as f64),
        "sessions": percent_change(current.sessions as f64, previous.sessions as f64),
        "gameStarts": percent_change(current.game_starts as f64, previous.game_starts as f64),
        "completionPercent": point_change(current.completion_percent, previous.completion_percent),
        "bouncePercent": point_change(current.bounce_percent, previous.bounce_percent),
        "errorSessions": percent_change(current.error_sessions as f64, previous.error_sessions as f64)
    })
}

fn percent_change(current: f64, previous: f64) -> Option<f64> {
    if previous == 0.0 {
        None
    } else {
        Some((((current - previous) / previous) * 1000.0).round() / 10.0)
    }
}

fn point_change(current: f64, previous: f64) -> f64 {
    ((current - previous) * 10.0).round() / 10.0
}

fn time_series(rows: &[EventRow], hourly: bool) -> Vec<Value> {
    let mut buckets: BTreeMap<String, TimeBucket> = BTreeMap::new();
    for event in rows {
        let key = if hourly {
            event.received_at.chars().take(13).collect()
        } else {
            day(&event.received_at)
        };
        let bucket = buckets.entry(key).or_default();
        bucket.events += 1;
        bucket.visitors.insert(visitor_key(event));
        bucket.sessions.insert(event.session_id.clone());
        match event.event_name.as_str() {
            "game_start" => {
                if let Some(game_id) = &event.game_id {
                    bucket.game_starts.insert(game_id.clone());
                }
            }
            "game_complete" => {
                if let Some(game_id) = &event.game_id {
                    bucket.game_completions.insert(game_id.clone());
                }
            }
            "game_forfeit" => {
                if let Some(game_id) = &event.game_id {
                    bucket.game_forfeits.insert(game_id.clone());
                }
            }
            "bounce" => bucket.bounces += 1,
            "client_error" | "server_error_ui" => bucket.error_events += 1,
            "rage_click" | "repeat_ui_action" => bucket.friction_events += 1,
            "game_abandonment_candidate" => {
                if let Some(game_id) = &event.game_id {
                    bucket.abandonment_candidates.insert(game_id.clone());
                }
            }
            _ => {}
        }
    }
    buckets
        .into_iter()
        .map(|(period, bucket)| {
            json!({
                "period": period,
                "activeVisitors": bucket.visitors.len(),
                "sessions": bucket.sessions.len(),
                "events": bucket.events,
                "gameStarts": bucket.game_starts.len(),
                "gameCompletions": bucket.game_completions.len(),
                "gameForfeits": bucket.game_forfeits.len(),
                "bounces": bucket.bounces,
                "errorEvents": bucket.error_events,
                "frictionEvents": bucket.friction_events,
                "abandonmentCandidates": bucket.abandonment_candidates.len()
            })
        })
        .collect()
}

fn user_activity(rows: &[EventRow]) -> Vec<Value> {
    let mut users: HashMap<i64, UserActivity> = HashMap::new();
    for event in rows {
        let Some(user_id) = event.user_id else {
            continue;
        };
        let user = users.entry(user_id).or_insert_with(|| UserActivity {
            username: event
                .username
                .clone()
                .unwrap_or_else(|| "Unknown".to_string()),
            display_name: event
                .display_name
                .clone()
                .unwrap_or_else(|| "Unknown".to_string()),
            ..Default::default()
        });
        if event.received_at > user.last_active {
            user.last_active = event.received_at.clone();
        }
        user.active_days.insert(day(&event.received_at));
        user.sessions.insert(event.session_id.clone());
        user.events += 1;
        match event.event_name.as_str() {
            "page_view" => user.page_views += 1,
            "game_start" => {
                if let Some(game_id) = &event.game_id {
                    user.game_starts.insert(game_id.clone());
                }
            }
            "game_complete" => {
                if let Some(game_id) = &event.game_id {
                    user.game_completions.insert(game_id.clone());
                }
            }
            "client_error" | "server_error_ui" => user.errors += 1,
            "rage_click" | "repeat_ui_action" => user.friction_events += 1,
            _ => {}
        }
        if is_game_lifecycle(event) {
            if let Some(game_id) = &event.game_id {
                user.observed_games.insert(game_id.clone());
            }
        }
        *user
            .clients
            .entry(format!(
                "{} · {}",
                title_case(&event.device_type),
                title_case(&event.browser)
            ))
            .or_default() += 1;
    }
    let mut result = users
        .into_values()
        .map(|user| {
            let primary_client = user
                .clients
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .map(|(label, _)| label)
                .unwrap_or_else(|| "Unknown".to_string());
            json!({
                "username": user.username,
                "displayName": user.display_name,
                "lastActive": user.last_active,
                "activeDays": user.active_days.len(),
                "sessions": user.sessions.len(),
                "events": user.events,
                "pageViews": user.page_views,
                "gameStarts": user.game_starts.len(),
                "observedGames": user.observed_games.len(),
                "gameCompletions": user.game_completions.len(),
                "errors": user.errors,
                "frictionEvents": user.friction_events,
                "primaryClient": primary_client
            })
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| {
        right["lastActive"]
            .as_str()
            .cmp(&left["lastActive"].as_str())
    });
    result
}

fn recent_activity(rows: &[EventRow]) -> Vec<Value> {
    rows.iter()
        .rev()
        .take(60)
        .map(|event| {
            let detail = ["surface", "target", "opponent", "reason", "resumedPhase"]
                .iter()
                .find_map(|key| metadata_string(event, key))
                .unwrap_or(&event.page);
            json!({
                "at": event.received_at,
                "person": event.display_name.as_deref().unwrap_or("Anonymous"),
                "username": event.username,
                "event": event.event_name,
                "detail": detail,
                "environment": event.environment,
                "client": format!("{} · {}", title_case(&event.device_type), title_case(&event.browser))
            })
        })
        .collect()
}

fn visitor_key(event: &EventRow) -> String {
    event.visitor_id.clone()
}

fn day(value: &str) -> String {
    value.chars().take(10).collect()
}

fn metadata_string<'a>(event: &'a EventRow, key: &str) -> Option<&'a str> {
    event.metadata.get(key).and_then(Value::as_str)
}

fn metadata_number(event: &EventRow, key: &str) -> Option<f64> {
    event.metadata.get(key).and_then(Value::as_f64)
}

fn percent(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        ((numerator as f64 / denominator as f64) * 1000.0).round() / 10.0
    }
}

fn title_case(value: &str) -> String {
    value
        .split(['_', ':'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn friendly_target(value: &str) -> String {
    title_case(
        value
            .trim_start_matches('#')
            .trim_start_matches("button.")
            .trim_start_matches("pathway:"),
    )
}

fn count_events(rows: &[EventRow], names: &[&str]) -> usize {
    rows.iter()
        .filter(|event| names.contains(&event.event_name.as_str()))
        .count()
}

fn distinct_games(rows: &[EventRow], predicate: impl Fn(&EventRow) -> bool) -> HashSet<String> {
    rows.iter()
        .filter(|event| predicate(event))
        .filter_map(|event| event.game_id.clone())
        .collect()
}

fn is_game_lifecycle(event: &EventRow) -> bool {
    matches!(
        event.event_name.as_str(),
        "game_start"
            | "game_resume"
            | "game_complete"
            | "game_forfeit"
            | "game_abandonment_candidate"
    )
}

fn is_error(event: &EventRow) -> bool {
    matches!(
        event.event_name.as_str(),
        "client_error" | "server_error_ui"
    )
}

fn is_friction(event: &EventRow) -> bool {
    matches!(event.event_name.as_str(), "rage_click" | "repeat_ui_action")
}

fn sessions_for(rows: &[EventRow], predicate: impl Fn(&EventRow) -> bool) -> HashSet<String> {
    rows.iter()
        .filter(|event| predicate(event))
        .map(|event| event.session_id.clone())
        .collect()
}

fn ordered_funnel_counts(rows: &[EventRow]) -> [usize; 5] {
    let mut progress: HashMap<String, usize> = HashMap::new();
    for event in rows {
        let step = progress.entry(event.session_id.clone()).or_default();
        if *step < 5 && matches_funnel_step(*step, event) {
            *step += 1;
        }
    }
    let mut counts = [0; 5];
    for completed_steps in progress.into_values() {
        for count in counts.iter_mut().take(completed_steps) {
            *count += 1;
        }
    }
    counts
}

fn matches_funnel_step(step: usize, event: &EventRow) -> bool {
    match step {
        0 => event.event_name == "session_start",
        1 => {
            event.event_name == "page_view"
                && matches!(
                    metadata_string(event, "surface"),
                    Some("pathway:home") | Some("home")
                )
        }
        2 => {
            event.event_name == "page_view"
                && metadata_string(event, "surface") == Some("pathway:play")
        }
        3 => event.event_name == "game_start",
        4 => event.event_name == "game_complete",
        _ => false,
    }
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
        ) && candidates
            .get(game_id)
            .is_some_and(|candidate| *candidate < index)
        {
            candidates.remove(game_id);
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
    result.truncate(40);
    result
}

fn game_breakdown(rows: &[EventRow]) -> Vec<Value> {
    let labels = rows
        .iter()
        .filter(|event| is_game_lifecycle(event))
        .filter_map(|event| {
            Some((
                event.game_id.as_ref()?.clone(),
                title_case(metadata_string(event, "opponent")?),
            ))
        })
        .collect::<HashMap<_, _>>();
    let mut groups: BTreeMap<String, (HashSet<String>, HashSet<String>, HashSet<String>)> =
        BTreeMap::new();
    for event in rows.iter().filter(|event| is_game_lifecycle(event)) {
        let Some(game_id) = &event.game_id else {
            continue;
        };
        let label = labels
            .get(game_id)
            .cloned()
            .unwrap_or_else(|| "Unknown".to_string());
        let group = groups.entry(label).or_default();
        group.0.insert(game_id.clone());
        group.1.insert(event.session_id.clone());
        group.2.insert(visitor_key(event));
    }
    let mut result = groups
        .into_iter()
        .map(|(label, (games, sessions, visitors))| {
            json!({
                "label": label,
                "events": games.len(),
                "sessions": sessions.len(),
                "visitors": visitors.len()
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

fn engagement_csv(daily: &[Value]) -> String {
    let mut csv = "date,active_visitors,sessions,events,game_starts,game_completions,game_forfeits,bounces,error_events,friction_events,abandonment_candidates\n".to_string();
    for row in daily {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{}\n",
            row["period"].as_str().unwrap_or_default(),
            row["activeVisitors"].as_u64().unwrap_or_default(),
            row["sessions"].as_u64().unwrap_or_default(),
            row["events"].as_u64().unwrap_or_default(),
            row["gameStarts"].as_u64().unwrap_or_default(),
            row["gameCompletions"].as_u64().unwrap_or_default(),
            row["gameForfeits"].as_u64().unwrap_or_default(),
            row["bounces"].as_u64().unwrap_or_default(),
            row["errorEvents"].as_u64().unwrap_or_default(),
            row["frictionEvents"].as_u64().unwrap_or_default(),
            row["abandonmentCandidates"].as_u64().unwrap_or_default(),
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
            body: json!({"days": days, "environment": "all", "audience": "all"}).to_string(),
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
        let connection = open_game_database(&server.data_dir).unwrap();
        connection
            .execute(
                "INSERT INTO auth_users
                 (username, display_name, email, normalized_email, created_at, updated_at)
                 VALUES ('Test', 'Test', 'test@example.test', 'test@example.test', 1, 1)",
                [],
            )
            .unwrap();
        let test_user_id = connection.last_insert_rowid();
        connection
            .execute(
                "INSERT INTO auth_roles (user_id, role, created_at)
                 VALUES (?1, 'engagement_admin', 1)",
                [test_user_id],
            )
            .unwrap();
        drop(connection);
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
        let owner = auth::test_user(1, "Garrett", "owner@example.test");
        let tester = auth::test_user(test_user_id, "Test", "test@example.test");
        let owner_response = handle(&server, &request(30), Some(&owner)).unwrap();
        let tester_response = handle(&server, &request(30), Some(&tester)).unwrap();
        assert_eq!(owner_response.status, 200);
        let mut owner_value: Value = serde_json::from_str(&owner_response.body).unwrap();
        let mut tester_value: Value = serde_json::from_str(&tester_response.body).unwrap();
        owner_value["range"]["to"] = Value::Null;
        tester_value["range"]["to"] = Value::Null;
        assert_eq!(owner_value, tester_value);
        assert_eq!(owner_value["totals"]["gameStarts"], 1);
        assert_eq!(owner_value["totals"]["gameCompletions"], 1);
        assert_eq!(owner_value["users"][0]["displayName"], "Garrett");
        assert_eq!(owner_value["daily"][0]["gameCompletions"], 1);
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
        let player = auth::test_user(2, "Player", "player@example.test");
        let response = handle(&server, &request(30), Some(&player)).unwrap();
        assert_eq!(response.status, 403);
        assert!(!response.body.contains("secret-session"));
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn filters_are_validated_and_applied() {
        let server = test_server("filters");
        add_event(
            &server,
            "1",
            Some(1),
            "signed",
            "session_start",
            None,
            json!({}),
        );
        add_event(&server, "2", None, "anon", "session_start", None, json!({}));
        let owner = auth::test_user(1, "Garrett", "owner@example.test");
        let mut filtered = request(30);
        filtered.body =
            json!({"days": 30, "environment": "prod", "audience": "registered"}).to_string();
        let response = handle(&server, &filtered, Some(&owner)).unwrap();
        let value: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(value["totals"]["sessions"], 1);
        assert_eq!(value["totals"]["anonymousSessions"], 0);

        filtered.body =
            json!({"days": 30, "environment": "everywhere", "audience": "all"}).to_string();
        assert_eq!(
            handle(&server, &filtered, Some(&owner)).unwrap().status,
            400
        );
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn a_tab_that_signs_in_counts_as_one_visitor() {
        let server = test_server("visitor-reconciliation");
        add_event(
            &server,
            "1",
            None,
            "same-tab",
            "session_start",
            None,
            json!({}),
        );
        add_event(
            &server,
            "2",
            Some(1),
            "same-tab",
            "login",
            None,
            json!({"method":"password"}),
        );
        let owner = auth::test_user(1, "Garrett", "owner@example.test");
        let response = handle(&server, &request(30), Some(&owner)).unwrap();
        let value: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(value["totals"]["activeVisitors"], 1);
        assert_eq!(value["totals"]["sessions"], 1);
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    #[test]
    fn completion_rate_uses_every_observed_game_once() {
        let server = test_server("completion-denominator");
        add_event(
            &server,
            "1",
            Some(1),
            "human-session",
            "game_complete",
            Some("human-game"),
            json!({"opponent":"human"}),
        );
        add_event(
            &server,
            "2",
            Some(1),
            "ai-session",
            "game_start",
            Some("ai-game"),
            json!({"opponent":"dynamic"}),
        );
        add_event(
            &server,
            "3",
            Some(1),
            "ai-session",
            "game_complete",
            Some("ai-game"),
            json!({"opponent":"dynamic"}),
        );
        let owner = auth::test_user(1, "Garrett", "owner@example.test");
        let response = handle(&server, &request(30), Some(&owner)).unwrap();
        let value: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(value["totals"]["gameStarts"], 1);
        assert_eq!(value["totals"]["observedGames"], 2);
        assert_eq!(value["totals"]["gameCompletions"], 2);
        assert_eq!(value["totals"]["completionPercent"], 100.0);
        assert_eq!(value["opponents"][0]["events"], 1);
        assert_eq!(value["opponents"][1]["events"], 1);
        std::fs::remove_dir_all(server.data_dir).unwrap();
    }

    fn event(name: &str, game_id: &str, at: &str) -> EventRow {
        EventRow {
            user_id: Some(1),
            username: Some("Garrett".into()),
            display_name: Some("Garrett".into()),
            session_id: "s".into(),
            event_name: name.into(),
            received_at: at.into(),
            page: "/".into(),
            game_id: Some(game_id.into()),
            environment: "prod".into(),
            app_version: "1".into(),
            client_type: "web".into(),
            browser: "safari".into(),
            device_type: "desktop".into(),
            viewport_width: 1,
            viewport_height: 1,
            screen_width: 1,
            screen_height: 1,
            device_pixel_ratio: 1.0,
            touch_points: 0,
            language: "en".into(),
            timezone: "UTC".into(),
            platform: "Mac".into(),
            metadata: json!({}),
            active_now: false,
            active_last_24_hours: false,
            visitor_id: "user:1".into(),
        }
    }

    #[test]
    fn abandonment_candidates_are_cleared_by_later_activity() {
        let rows = vec![
            event("game_abandonment_candidate", "resumed", "1"),
            event("game_resume", "resumed", "2"),
            event("game_abandonment_candidate", "abandoned", "3"),
        ];
        assert_eq!(unresolved_abandonments(&rows), 1);
    }

    #[test]
    fn funnel_requires_each_step_in_order() {
        let mut ordered = vec![
            event("session_start", "none", "1"),
            event("page_view", "none", "2"),
            event("page_view", "none", "3"),
            event("game_start", "game", "4"),
            event("game_complete", "game", "5"),
        ];
        ordered[0].game_id = None;
        ordered[1].game_id = None;
        ordered[1].metadata = json!({"surface":"pathway:home"});
        ordered[2].game_id = None;
        ordered[2].metadata = json!({"surface":"pathway:play"});

        let mut out_of_order = vec![
            event("session_start", "none", "1"),
            event("page_view", "none", "2"),
            event("game_start", "game-2", "3"),
            event("page_view", "none", "4"),
            event("game_complete", "game-2", "5"),
        ];
        for row in &mut out_of_order {
            row.session_id = "out-of-order".into();
        }
        out_of_order[0].game_id = None;
        out_of_order[1].game_id = None;
        out_of_order[1].metadata = json!({"surface":"pathway:play"});
        out_of_order[3].game_id = None;
        out_of_order[3].metadata = json!({"surface":"pathway:home"});

        ordered.extend(out_of_order);
        assert_eq!(ordered_funnel_counts(&ordered), [2, 2, 1, 1, 1]);
    }
}
