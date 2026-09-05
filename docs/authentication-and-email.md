# Accounts and Transactional Email

Production uses server-side accounts and opaque sessions. The browser receives
an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie; it does not store bearer
tokens. The server replaces client-supplied game tags with the authenticated
account name before saving or loading a game.

The private preview requires a signed-in account for every application area and
every application API. `/health` and the authentication endpoints remain public
so the login, password recovery, invitation, and access-request flows can work.
Deep links to games, player profiles, statistics, and human tables retain their
destination while asking the visitor to sign in.

Passwords are hashed with Argon2id. One-time codes, password-reset links, and
invitation links are random, hashed in SQLite with the deployment pepper,
single-use, rate-limited, and time-limited. Email sign-in is a passwordless
single-factor option, not multi-factor authentication.

The account migration is idempotent and seeds these established player names:

| Player | Email |
|---|---|
| Garrett | founder@evenvision.com |
| Kurt | hollywood2742@gmail.com |
| Popchuckles | Crperks@charter.net |
| Stoneman | 4stoneman@gmail.com |
| Travis | kephart98532@gmail.com |
| Shane | shanerk00111@gmail.com |
| Vince | Vpellegrini@me.com |

Accounts begin without a password. A player can sign in immediately with an
emailed one-time code, set a password through an invitation, or request a
password-reset email.

## Private server configuration

Store production secrets in `/etc/cribbage/cribbage.env` as documented in
`nanode-rocky-server-setup.md`. Never put SendGrid keys, the authentication
pepper, or the invitation admin key in this repository.

Set `CRIBBAGE_EMAIL_DELIVERY_PAUSED=true` to accept outbound messages into the
durable SQLite delivery queue without contacting SendGrid. Newer sign-in,
password-reset, and invitation messages supersede older queued messages for the
same account. Expired authentication messages are discarded instead of being
sent with unusable credentials. Bug reports, feature requests, and access
requests remain queued without an expiry.

Production deployments default the pause to `true`. After SendGrid is healthy,
set `CRIBBAGE_EMAIL_DELIVERY_PAUSED=false` in `/etc/cribbage/cribbage.env` and
restart the service.
The delivery worker drains pending messages through SendGrid and retries
temporary failures every minute. Interrupted delivery claims are eligible for
retry only after their five-minute lease expires, avoiding overlap during a
normal service restart. Successfully sent, expired, and superseded messages
have their stored body and credentials redacted.

## Preview access requests

The public homepage collects first name, last name, requested username, and
email through `POST /api/auth/access-request`. Each request is stored durably in
the `auth_access_requests` table before the notification email is attempted, so
a temporary email-provider failure does not lose the request. Repeated requests
from the same normalized email update that record and are rate-limited.

Notifications go to `CRIBBAGE_ACCESS_REQUEST_TO` when set, then fall back to
`CRIBBAGE_MAIL_REPLY_TO`. The applicant's address is used as the email reply-to.

## Sending an invitation

Invitation issuance is an administrator-only API operation:

```bash
curl -X POST https://cribbage.strongcribbage.com/api/auth/invite/send \
  -H 'content-type: application/json' \
  -H 'x-cribbage-admin-key: REPLACE_WITH_ADMIN_KEY' \
  --data '{"email":"player@example.com"}'
```

The invitation expires after seven days. Issuing a later invitation retires
the earlier unused invitation for that account.
