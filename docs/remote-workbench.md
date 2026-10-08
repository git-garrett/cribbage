# Remote workbench

The gateway's Caddyfile imports optional root-owned
`/etc/caddy/status-logging*.caddy` files managed by the status-monitor project.
Keep this import during gateway reconfiguration so request collection survives.
An empty glob is allowed on servers without the monitoring configuration.

`https://workbench.strongcribbage.com` is a dedicated Rocky Linux 9 Nanode
gateway for the existing live workbench. The Mac remains the data source and
must be awake, logged in, and online. A launch agent reconnects its outbound SSH
tunnel after network interruptions and login. The gateway starts at server boot.
The Nanode does not run benchmarks or copy their databases.

The public `/login` page contains only a generic sign-in form. All other HTTPS
paths, including assets, health and APIs, require a valid session before proxying.
A loopback Flask/Gunicorn service verifies credentials and signs a Secure,
HttpOnly, SameSite=Strict, host-only cookie with a 12-hour absolute lifetime.
The server stores only a PBKDF2-SHA256 password hash and a random session signing
key. Cookies and legacy authorization headers are stripped before forwarding to
the workbench. Anonymous requests redirect to the form without a native browser
authentication challenge. Incorrect credentials show an inline error.

The form checks a session-bound CSRF token and its exact HTTPS origin. Password
checks are limited to 10 per IP per minute and 100 overall per minute; the single
Gunicorn worker shares this limit across its four threads. A verifier failure
blocks access. Offline upstreams return a generic temporary-unavailability
message. The hostname itself remains visible in DNS and certificate records.

## Installation

Follow the branch, PR, review and merge steps in `production-workflow.md`.
Use the merged, clean `master` checkout for these workbench-specific deployment
files. `deploy-nanode.sh` deploys the separate game application and is not used for
this gateway.

1. Use the `status_monitor` project's provisioning helpers for Linode and
   Cloudflare credentials. Create a Seattle `g6-nanode-1` with `linode/rocky9`,
   an administrator SSH public key, and a cloud firewall allowing inbound TCP
   22, 80 and 443 only; default inbound DROP, outbound ACCEPT. The plan is
   $5/month at initial provisioning. Do not change the game server.
2. Install Caddy using its official RPM repository:
   `dnf install -y dnf-plugins-core`, `dnf copr enable -y @caddy/caddy`, then
   `dnf install -y caddy`. Apply Rocky security updates during setup. Install
   `python3.11 python3.11-pip`, create `/opt/workbench-access/venv` with
   `python3.11 -m venv`, and install `scripts/remote-workbench/requirements.txt`
   using that venv's pip.
3. Generate a unique random browser password locally. Use Werkzeug's
   `generate_password_hash(password, method='pbkdf2:sha256:1000000')` locally,
   and stream JSON containing `username`, `passwordHash` and a new random
   `secretKey` (e.g. `secrets.token_urlsafe(48)`) over SSH stdin to
   `/etc/workbench-access/credentials.json`. Initially create the directory
   mode 0700 and file mode 0600. Keep plaintext credentials and the signing key
   out of Git, command arguments and logs. Keep the browser password in the
   owner's private local access record; never save it on the server.
4. Generate a dedicated Ed25519 tunnel key on the Mac. Copy only its public key
   as `tunnel.pub` alongside the files from `scripts/remote-workbench/`, keeping
   the `templates/` subdirectory. Run `configure-server.sh` on the Nanode.
   It installs the unprivileged sign-in service on `127.0.0.1:18767` and sets
   credential ownership to root:workbench-access, directory 0750, file 0640.
   Its SSH tunnel user can bind only `127.0.0.1:18766`; shells, commands,
   additional listen ports and local forwarding are disabled. Keep the separate
   administrator key for maintenance.
5. Create the Cloudflare A record pointing `workbench.strongcribbage.com` at the
   Nanode IPv4 address, DNS only, TTL 300. Caddy obtains and renews HTTPS directly.
6. With a verified host-key file, run `install-tunnel.py SERVER_IP TUNNEL_KEY
   KNOWN_HOSTS` on the Mac. It stores credentials under
   `~/.config/strongcribbage-workbench` and installs
   `~/Library/LaunchAgents/com.strongcribbage.workbench-tunnel.plist`.
   The existing local service continues to be managed by `local-runtime.sh`.

## Verification and maintenance

Install the sign-in requirements in the test environment, then run
`scripts/run-quiet.sh 'Sign-in tests' python -m pytest -q scripts/remote-workbench/test_access.py`.
Verify anonymous requests to `/`, `/health`, `/api/jobs`, `/api/report`, `/app.js`,
`/style.css` and `/favicon.svg` redirect to `/login` without application data or
`WWW-Authenticate`. In WebKit and Chromium, submit an incorrect password followed
by the correct one; verify an inline error, successful navigation and a working
refresh. With the project Playwright browsers installed, run
`node scripts/remote-workbench/verify-browser.cjs PRIVATE_ACCESS_JSON` for that
public smoke check; the JSON contains the existing `username` and `password`.
Check the secure cookie flags, a live report, and that authenticated
POST `/api/job-visibility` can archive and elevate a registered job with the
workbench's JSON and custom request header. Other writes remain rejected; a
cross-origin form cannot change visibility. Check the verifier failing closed.
Verify the tunnel binds only to 127.0.0.1 and unauthorized SSH listen ports and
shell commands fail. Restart the tunnel to check reconnection, then confirm a
fresh live report. Do not print credentials or session cookies during checks.

For status, use `systemctl status caddy workbench-access` on the Nanode and
`launchctl print gui/$(id -u)/com.strongcribbage.workbench-tunnel` on the Mac.
The tunnel error log is `~/.config/strongcribbage-workbench/tunnel.log`.
To rotate browser access, atomically replace the password hash in the credential
JSON while retaining its permissions, and restart `workbench-access`. A changed
hash or signing key invalidates existing sessions. Remove the obsolete
`/etc/caddy/access.caddy` file after migrating from Basic authentication.
To revoke remote access, stop Caddy or unload the tunnel; neither action affects
compute jobs. Remove the dedicated DNS record and Nanode when retiring the
gateway to stop hosting charges.

References: [Caddy forward authentication](https://caddyserver.com/docs/caddyfile/directives/forward_auth),
[Caddy RPM installation](https://caddyserver.com/docs/install#fedora-redhat-centos),
[Flask security](https://flask.palletsprojects.com/en/stable/web-security/).
