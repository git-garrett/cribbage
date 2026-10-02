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

## Text sign-in codes

Twilio Verify supplies an additional passwordless sign-in option for existing
accounts with an administrator-enrolled mobile number. It is single-factor
sign-in, not an additional MFA step. Email and password sign-in remain available.

Create a Verify service named **Strong Cribbage** with six-digit, provider-generated
codes, the do-not-share warning, and Fraud Guard enabled. Store these three values
only in `/etc/cribbage/cribbage.env`:

```dotenv
TWILIO_VERIFY_SERVICE_SID=VA_REPLACE_WITH_SERVICE_SID
TWILIO_API_KEY_SID=SK_REPLACE_WITH_RESTRICTED_KEY_SID
TWILIO_API_KEY_SECRET=REPLACE_WITH_KEY_SECRET
```

The restricted key needs only `/twilio/verify/verification/create` and
`/twilio/verify/verification-check/create`. With all three values absent, SMS
sign-in is disabled and its button is hidden. Partial configuration prevents
startup. Verify OTP does not depend on the ordinary messaging campaign.

After obtaining the account owner's consent, an administrator can enroll their
number through `POST /api/auth/sms/enroll` with the existing
`x-cribbage-admin-key` header and a JSON body containing `email` and `phone`.
The phone must include its E.164 country code (for example `+12025550123`).
Enrollment cannot create accounts or share a number between accounts. Replacing
a number invalidates outstanding SMS challenges; successful text sign-in records
proof of phone possession. Phone numbers and credentials never enter public
responses or client bundles.

The login screen asks for the account email and offers **Text me a sign-in code**.
`POST /api/auth/sms/request` accepts only the account identity for destination
selection and returns a generic message plus an opaque challenge token, including
for missing accounts or numbers. `POST /api/auth/sms/verify` accepts that token
and the six-digit code. The server checks the stored Twilio verification SID,
current phone enrollment, expiry, and attempt budget before issuing its normal
session cookie. Successful challenges cannot be replayed.
The browser retains a pending SMS challenge when returning to the sign-in
options during the resend cooldown, so the code already received remains usable.
Throttled requests return HTTP 429 without replacing the pending challenge;
provider failures return HTTP 503. The browser keeps an existing code-entry flow
usable in both cases. Per-email and IP request limits also cover unknown accounts.

Sends have a 30-second per-account cooldown and limits of six per account, fifteen
per originating IP, and thirty across this private-preview app per hour. Five
code checks are allowed per provider verification, shared across resends. These
reservations and challenge consumption use SQLite transactions. Twilio failures
never grant access; the login screen keeps email sign-in available. The API must
remain bound to loopback behind Caddy, as in the production deployment, for
trusted proxy IP attribution.

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
