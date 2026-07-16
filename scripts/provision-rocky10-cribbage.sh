#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${LOG_FILE:-/root/cribbage-provision.log}"
exec > >(tee -a "$LOG_FILE") 2>&1

log() {
  printf '\n==> %s\n' "$*"
}

log "Starting cribbage Rocky 10 provisioning at $(date -Is)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
fi

if [[ "${ID:-}" != "rocky" || "${VERSION_ID%%.*}" != "10" ]]; then
  echo "Expected Rocky Linux 10; found ${PRETTY_NAME:-unknown}." >&2
  exit 1
fi

log "Refreshing base system packages"
dnf -y upgrade --refresh

log "Installing runtime and security packages"
dnf -y install \
  ca-certificates \
  chrony \
  curl \
  dnf-automatic \
  dnf-plugins-core \
  firewalld \
  gcc \
  gzip \
  policycoreutils-python-utils \
  rust \
  cargo \
  tar \
  unzip \
  xz

if ! rpm -q caddy >/dev/null 2>&1; then
  log "Enabling Caddy COPR and installing Caddy"
  dnf -y copr enable @caddy/caddy
  dnf -y install caddy
fi

log "Creating cribbage service user and filesystem layout"
if ! id cribbage >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/cribbage --shell /usr/sbin/nologin cribbage
fi
install -d -o root -g root -m 755 /opt/cribbage
install -d -o cribbage -g cribbage -m 750 /var/lib/cribbage

log "Enabling time sync"
systemctl enable --now chronyd

log "Disabling unused base-image network services"
systemctl disable --now cockpit.socket cockpit.service 2>/dev/null || true
systemctl disable --now rpcbind.socket rpcbind.service 2>/dev/null || true

log "Configuring firewalld"
systemctl enable --now firewalld
for _ in {1..20}; do
  if firewall-cmd --state >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
firewall-cmd --state >/dev/null
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --remove-service=cockpit || true
firewall-cmd --reload
firewall-cmd --list-all

log "Hardening sshd without disabling root key access"
cat > /etc/ssh/sshd_config.d/10-cribbage-hardening.conf <<'SSHDCONFIG'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitTunnel no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
SSHDCONFIG
sshd -t
systemctl reload sshd

log "Applying conservative kernel/network hardening"
cat > /etc/sysctl.d/99-cribbage-hardening.conf <<'SYSCTL'
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
kernel.dmesg_restrict = 1
kernel.kptr_restrict = 2
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.tcp_syncookies = 1
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
SYSCTL
sysctl --system

log "Keeping SELinux enforcing and allowing Caddy to proxy to the app"
if command -v getenforce >/dev/null 2>&1; then
  getenforce
fi
setsebool -P httpd_can_network_connect 1 || true

log "Enabling unattended package updates"
if [[ -f /etc/dnf/automatic.conf ]]; then
  sed -i \
    -e 's/^apply_updates = .*/apply_updates = yes/' \
    -e 's/^download_updates = .*/download_updates = yes/' \
    /etc/dnf/automatic.conf
fi
systemctl enable --now dnf-automatic.timer

log "Runtime versions"
caddy version

log "Provisioning complete at $(date -Is)"
