#!/usr/bin/env bash
# Apply to the dedicated Rocky Linux server after review and merge.
# Stage access.caddy (username + bcrypt hash) and tunnel.pub separately.
set -euo pipefail
cd -- "$(dirname "$0")"
[[ "$EUID" == 0 ]] || { echo 'Run as root on the dedicated server.' >&2; exit 1; }
test -s /etc/caddy/access.caddy
test -s tunnel.pub
command -v caddy >/dev/null

id workbench-tunnel >/dev/null 2>&1 || useradd --system --create-home --shell /sbin/nologin workbench-tunnel
install -d -m 700 -o workbench-tunnel -g workbench-tunnel /home/workbench-tunnel/.ssh
{ printf 'restrict,port-forwarding,permitlisten="127.0.0.1:18766" '; cat tunnel.pub; } > /home/workbench-tunnel/.ssh/authorized_keys
chown workbench-tunnel:workbench-tunnel /home/workbench-tunnel/.ssh/authorized_keys
chmod 600 /home/workbench-tunnel/.ssh/authorized_keys
restorecon -RF /home/workbench-tunnel/.ssh

install -m 600 sshd.conf /etc/ssh/sshd_config.d/00-workbench.conf
/usr/sbin/sshd -t
systemctl reload sshd

chown root:caddy /etc/caddy/access.caddy
chmod 640 /etc/caddy/access.caddy
caddy validate --config "$PWD/Caddyfile" --adapter caddyfile
install -m 644 Caddyfile /etc/caddy/Caddyfile
restorecon /etc/caddy/Caddyfile /etc/caddy/access.caddy
# Keep SELinux enforcing; permit the proxy to connect to its loopback upstream.
setsebool -P httpd_can_network_connect 1
systemctl enable --now caddy
systemctl reload caddy
echo 'Remote access configuration installed.'
