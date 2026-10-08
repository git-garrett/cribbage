# Remote workbench

`https://workbench.strongcribbage.com` is a dedicated Rocky Linux 9 Nanode
gateway for the existing live workbench. The Mac remains the data source and
must be awake, logged in, and online. A launch agent reconnects its outbound SSH
tunnel after network interruptions and login. The gateway starts at server boot.
The Nanode does not run benchmarks or copy their databases.

The browser's native username/password prompt uses the generic realm `Access`.
All HTTPS paths, including assets, health and APIs, require authentication before
proxying. Passwords are stored only as bcrypt hashes on the server; authentication
headers are stripped before forwarding. Anonymous responses contain no workbench
content. Offline upstreams return `Unavailable` after authentication. The chosen
hostname itself remains publicly visible in DNS and certificate records.

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
2. On the new server, install Caddy using its official RPM repository:
   `dnf install -y dnf-plugins-core`, `dnf copr enable -y @caddy/caddy`, then
   `dnf install -y caddy`. Apply Rocky security updates during setup.
3. Generate a unique random browser password locally. Stream it to
   `caddy hash-password` over SSH stdin; store a line containing the username and
   returned hash in `/etc/caddy/access.caddy`, root:caddy, mode 0640. Keep the
   plaintext out of Git, shell command arguments and server files.
4. Generate a dedicated Ed25519 tunnel key on the Mac. Copy only its public key
   as `tunnel.pub` alongside the three server configuration files from
   `scripts/remote-workbench/`, and run `configure-server.sh` on the Nanode.
   Its SSH user can bind only the loopback tunnel port; shells, commands,
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

Verify anonymous and incorrect-password requests to `/`, `/health`, `/api/jobs`,
`/api/report`, `/app.js`, `/style.css` and `/favicon.svg` all return 401 and no
application data. Verify authenticated page and API requests, at least one live
report, and that POST is rejected. Verify the tunnel binds only to 127.0.0.1 and
unauthorized SSH listen ports and shell commands fail. Restart the tunnel to
check reconnection, then confirm a fresh live report. Do not print credentials
in command output during these checks.

For status, use `systemctl status caddy` on the Nanode and
`launchctl print gui/$(id -u)/com.strongcribbage.workbench-tunnel` on the Mac.
The tunnel error log is `~/.config/strongcribbage-workbench/tunnel.log`.
To rotate browser access, replace the hash in `/etc/caddy/access.caddy`, validate
the Caddyfile and reload Caddy. Browsers may need to close their session to forget
cached Basic authentication credentials. To revoke remote access, stop Caddy or
unload the tunnel; neither action affects compute jobs. Remove the dedicated DNS
record and Nanode when retiring the gateway to stop hosting charges.

References: [Caddy authentication](https://caddyserver.com/docs/caddyfile/directives/basic_auth),
[Caddy RPM installation](https://caddyserver.com/docs/install#fedora-redhat-centos).
