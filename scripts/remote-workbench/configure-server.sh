#!/usr/bin/env bash
# Apply to the dedicated Rocky Linux server after review and merge.
# Stage credentials.json (hashed password + signing key) and tunnel.pub separately.
set -euo pipefail
cd -- "$(dirname "$0")"
[[ "$EUID" == 0 ]] || { echo 'Run as root on the dedicated server.' >&2; exit 1; }
test -s /etc/workbench-access/credentials.json
test -x /opt/workbench-access/venv/bin/gunicorn
test -s tunnel.pub
command -v caddy >/dev/null

id workbench-access >/dev/null 2>&1 || useradd --system --shell /sbin/nologin workbench-access
chown root:workbench-access /etc/workbench-access /etc/workbench-access/credentials.json
chmod 750 /etc/workbench-access
chmod 640 /etc/workbench-access/credentials.json
install -d -m 755 /opt/workbench-access/app/templates
install -m 644 access.py /opt/workbench-access/app/access.py
install -m 644 templates/login.html /opt/workbench-access/app/templates/login.html
install -m 644 access.service /etc/systemd/system/workbench-access.service
systemctl daemon-reload
systemctl enable workbench-access
systemctl restart workbench-access
# A missing or invalid verifier must not turn the public gateway into a bypass.
for attempt in {1..20}; do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18767/verify || true)" == 303 ]]; then
    break
  fi
  sleep 1
done
[[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18767/verify)" == 303 ]]

id workbench-tunnel >/dev/null 2>&1 || useradd --system --create-home --shell /sbin/nologin workbench-tunnel
install -d -m 700 -o workbench-tunnel -g workbench-tunnel /home/workbench-tunnel/.ssh
{ printf 'restrict,port-forwarding,permitlisten="127.0.0.1:18766" '; cat tunnel.pub; } > /home/workbench-tunnel/.ssh/authorized_keys
chown workbench-tunnel:workbench-tunnel /home/workbench-tunnel/.ssh/authorized_keys
chmod 600 /home/workbench-tunnel/.ssh/authorized_keys
restorecon -RF /home/workbench-tunnel/.ssh

install -m 600 sshd.conf /etc/ssh/sshd_config.d/00-workbench.conf
/usr/sbin/sshd -t
systemctl reload sshd

caddy validate --config "$PWD/Caddyfile" --adapter caddyfile
install -m 644 Caddyfile /etc/caddy/Caddyfile
restorecon /etc/caddy/Caddyfile
# Keep SELinux enforcing; permit the proxy to connect to its loopback upstream.
setsebool -P httpd_can_network_connect 1
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http --add-service=https
  firewall-cmd --add-service=http --add-service=https
fi
systemctl enable --now caddy
systemctl reload caddy
echo 'Remote access configuration installed.'
