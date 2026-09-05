# User activity tracking

The client sends small batches to `POST /api/activity`. Collection is best-effort:
failed telemetry requests are discarded and never block authentication, navigation,
or gameplay.

Events are stored in `user_activity_events`. An authenticated request is associated
with `auth_users.id` by the server session cookie. Anonymous traffic is associated
only with a random ID kept in the browser tab's `sessionStorage`; there is no
persistent anonymous identifier.

## Stored fields and retention limits

Each row stores the event and tab-session IDs, optional account ID, environment,
application version, event name, client occurrence time, server receipt time,
sanitized page, optional game ID, normalized client/device dimensions, and a
small JSON metadata object. The private reporting interface exposes aggregates,
account display names, and a sanitized recent-activity trail to designated
administrators. It does not return account IDs, session IDs, game IDs, email
addresses, or raw metadata.

There is currently no automatic retention or deletion schedule. “All time”
therefore means all rows still present in the server database, not necessarily
the lifetime of the product. Anonymous tab IDs disappear from the browser when
the tab session ends, but their collected event rows remain until an explicit
retention policy removes them. Client occurrence times are not trusted for
reporting windows; reports use the server receipt time.

## Environments and clients

`environment` is one of:

- `local`: loopback browser traffic on the laptop
- `lan`: private-IP or `.local` browser traffic
- `prod`: public web traffic, including Mobile Safari
- `ios`: the native iOS app

Each event also records the app version, web/native client type, browser family,
phone/tablet/desktop class, viewport and screen dimensions, pixel ratio, language,
timezone, platform, and touch-point count. Raw user-agent strings are not retained.

## Event names

- `session_start`, `page_view`, `page_exit`, `visibility`, `viewport_resize`
- `login`, `logout`
- `game_start`, `game_resume`, `game_complete`, `game_forfeit`
- `game_abandonment_candidate`
- `ui_interaction`, `repeat_ui_action`, `rage_click`
- `server_error_ui`, `client_error`
- `bounce`

An active game at page exit is a `game_abandonment_candidate`, not a final
abandonment. The report classifies it as abandoned only when the same game has
no later resume, completion, or forfeit within the chosen window.
A bounce is currently a page exit within ten seconds with no tracked interaction.

UI events contain stable element IDs or generic component classes. They never
contain form values, page text, email addresses, invite/reset tokens, arbitrary URL
query parameters, or raw card selections. Only the `pathwayView` query parameter is
retained in page paths.

## Private engagement report

`POST /api/admin/engagement` accepts `days` as `1`, `7`, `30`, `90`, or `0`
for all available history, plus `environment` (`all`, `prod`, `ios`, `lan`, or
`local`) and `audience` (`all`, `registered`, or `anonymous`) filters. The
server resolves the immutable account IDs in
`CRIBBAGE_ENGAGEMENT_ADMIN_USER_IDS` into account-role rows once when the role
schema is first initialized. The production service config designates account
IDs `1` (Garrett) and `53` (Test); a fresh local database defaults to its seeded
owner account ID `1`. Initialization fails rather than partially completing if
any configured account does not exist. Later profile-name edits neither grant
nor revoke access. Adding another administrator requires an explicit stable-ID
configuration and role migration. Hiding the client link is only a convenience—the
API independently returns `403` to every other signed-in account.

The report defines its metrics in the response and UI. Active visitors combine
distinct authenticated accounts with anonymous tab sessions. Returning users
are authenticated accounts seen on two or more UTC dates in the window.
Completion rate divides distinct completed games by distinct games with any
lifecycle event in the same window. This keeps older human-game completions
without a corresponding start event from producing a rate above 100 percent.
An abandonment is a game's latest abandonment candidate with no later resume,
completion, or forfeit event in the selected window. Funnel conversion uses
sessions with a recorded `session_start` as its denominator and counts each
later step only when that session reached the preceding steps in order. Daily
aggregates are available as a CSV download. The report also provides hourly and daily
trend series, previous-window comparisons, active-now and last-24-hour visitors,
account-level engagement, recent activity, screen and pathway use, interaction
hot spots, sanitized error groups, event inventory, and client, platform,
version, screen, pixel-ratio, touch, timezone, language, visibility, orientation,
authentication, and recorded game-phase breakdowns. Anonymous activity from a
tab that later uses exactly one signed-in account is reconciled to that account
for visitor totals. If multiple accounts share a tab, each account remains a
distinct visitor and unattributable anonymous activity remains separate.

## Known measurement gaps

- A `page_exit` event can be lost when the browser terminates abruptly, so the
  current average duration is observed page lifetime rather than authoritative
  engaged time. A low-frequency visible-page heartbeat would close this gap.
- Gameplay currently records starts, resumes, completions, forfeits, and exit
  candidates, but not the timing of each hand, discard, pegging, hint, or score
  review. Milestone events would identify the precise stage where play slows or
  stops. Human-game starts are recorded from this release forward; older human
  completions may have no matching historical start event.
- Client-visible errors are recorded, but API route latency and response status
  are not. Duration/status buckets would connect performance to frustration.
- Anonymous identity lives only for a browser tab. A durable random browser ID
  would make anonymous return usage measurable across tabs and days.
- No explicit satisfaction signal is collected. An optional one-tap response
  after a completed game would complement behavioral inference.

## Interim queries

```sql
-- Daily event totals by environment.
SELECT substr(received_at, 1, 10) AS day, environment, event_name, count(*) AS events
FROM user_activity_events
GROUP BY day, environment, event_name
ORDER BY day DESC, environment, event_name;

-- Named-user symptoms and their client context.
SELECT u.username, e.received_at, e.event_name, e.browser, e.device_type,
       e.viewport_width, e.viewport_height, e.page, e.metadata_json
FROM user_activity_events e
JOIN auth_users u ON u.id = e.user_id
WHERE e.event_name IN ('client_error', 'server_error_ui', 'rage_click',
                       'repeat_ui_action', 'game_abandonment_candidate')
ORDER BY e.received_at DESC;
```
