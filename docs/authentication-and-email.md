# Accounts and Transactional Email

Production uses server-side accounts and opaque sessions. The browser receives
an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie; it does not store bearer
tokens. The server replaces client-supplied game tags with the authenticated
account name before saving or loading a game.

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
