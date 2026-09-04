# User activity tracking

The client sends small batches to `POST /api/activity`. Collection is best-effort:
failed telemetry requests are discarded and never block authentication, navigation,
or gameplay.

Events are stored in `user_activity_events`. An authenticated request is associated
with `auth_users.id` by the server session cookie. Anonymous traffic is associated
only with a random ID kept in the browser tab's `sessionStorage`; there is no
persistent anonymous identifier.

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
abandonment. A future report should classify it as abandoned only when the same
game has no later resume, action, completion, or forfeit within the chosen window.
A bounce is currently a page exit within ten seconds with no tracked interaction.

UI events contain stable element IDs or generic component classes. They never
contain form values, page text, email addresses, invite/reset tokens, arbitrary URL
query parameters, or raw card selections. Only the `pathwayView` query parameter is
retained in page paths.

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
