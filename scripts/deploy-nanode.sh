#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
REMOTE_HOST="${REMOTE_HOST:-172.239.170.10}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PORT="${REMOTE_PORT:-22}"
SSH_KEY="${SSH_KEY:-${ROOT_DIR}/../../keys/strongcribbage_admin_ed25519}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/cribbage}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/var/lib/cribbage}"
REMOTE_PORT_APP="${REMOTE_PORT_APP:-8787}"
REMOTE_BIND_HOST="${REMOTE_BIND_HOST:-127.0.0.1}"
DOMAIN="${DOMAIN:-cribbage.strongcribbage.com, strongcribbage.com}"
ARCHIVE="${ROOT_DIR}/cribbage-server-${VERSION}.tgz"

SSH_BASE=(ssh -p "$REMOTE_PORT" -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
SCP_BASE=(scp -P "$REMOTE_PORT" -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"

usage() {
  cat <<USAGE
Usage:
  scripts/deploy-nanode.sh deploy [--skip-build]
  scripts/deploy-nanode.sh pull
  scripts/deploy-nanode.sh health

Environment overrides:
  REMOTE_HOST=${REMOTE_HOST}
  REMOTE_USER=${REMOTE_USER}
  SSH_KEY=${SSH_KEY}
  DOMAIN=${DOMAIN}

The pull action downloads production SQLite files to production-pulls/<timestamp>/.
USAGE
}

remote_exec() {
  "${SSH_BASE[@]}" "$REMOTE" "$@"
}

deploy() {
  local skip_build=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-build) skip_build=1 ;;
      *) echo "Unknown deploy option: $1" >&2; usage; exit 2 ;;
    esac
    shift
  done

  if [[ "$skip_build" -eq 0 ]]; then
    (cd "$ROOT_DIR" && npm run build:deploy && npm run package:server)
  elif [[ ! -f "$ARCHIVE" ]]; then
    echo "Missing archive: $ARCHIVE" >&2
    echo "Run without --skip-build first." >&2
    exit 1
  fi

  echo "Uploading $ARCHIVE to $REMOTE..."
  "${SCP_BASE[@]}" "$ARCHIVE" "$REMOTE:/tmp/$(basename "$ARCHIVE")"

  echo "Installing app files on $REMOTE..."
  remote_exec "id cribbage >/dev/null 2>&1 || useradd --system --home-dir '$REMOTE_DATA_DIR' --shell /usr/sbin/nologin cribbage && \
    mkdir -p '$REMOTE_APP_DIR' '$REMOTE_DATA_DIR' && \
    rm -rf '$REMOTE_APP_DIR/dist' '$REMOTE_APP_DIR/server-dist' '$REMOTE_APP_DIR/package.json' '$REMOTE_APP_DIR/docs' '$REMOTE_APP_DIR/rust' && \
    tar -xzf '/tmp/$(basename "$ARCHIVE")' -C '$REMOTE_APP_DIR' && \
    cd '$REMOTE_APP_DIR/rust' && cargo build --locked --release --manifest-path cribbage-api/Cargo.toml && \
    chown -R root:root '$REMOTE_APP_DIR' && \
    chown -R cribbage:cribbage '$REMOTE_DATA_DIR' && \
    chmod 755 '$REMOTE_APP_DIR' && \
    chmod 750 '$REMOTE_DATA_DIR'"

  echo "Writing systemd unit..."
  "${SSH_BASE[@]}" "$REMOTE" "cat > /etc/systemd/system/cribbage.service" <<SERVICE
[Unit]
Description=Cribbage Rust API and static client
After=network.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_APP_DIR}
Environment=HOST=${REMOTE_BIND_HOST}
Environment=PORT=${REMOTE_PORT_APP}
Environment=CRIBBAGE_MODEL_ROOT=${REMOTE_APP_DIR}
Environment=CRIBBAGE_DATA_DIR=${REMOTE_DATA_DIR}
ExecStart=${REMOTE_APP_DIR}/rust/target/release/cribbage-api
Restart=always
RestartSec=3
User=cribbage
Group=cribbage
UMask=0077
CapabilityBoundingSet=
RemoveIPC=true
NoNewPrivileges=true
PrivateDevices=true
PrivateTmp=true
ProtectHome=true
ProtectHostname=true
ProtectProc=invisible
ProcSubset=pid
ProtectSystem=strict
ReadWritePaths=${REMOTE_DATA_DIR}
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
ProtectClock=true
ProtectControlGroups=true
ProtectKernelLogs=true
ProtectKernelModules=true
ProtectKernelTunables=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
SERVICE

  echo "Writing Caddy reverse proxy..."
  "${SSH_BASE[@]}" "$REMOTE" "cat > /etc/caddy/Caddyfile" <<CADDY
${DOMAIN} {
	encode zstd gzip
	@api path /api/* /health
	handle @api {
		reverse_proxy ${REMOTE_BIND_HOST}:${REMOTE_PORT_APP}
	}
	handle {
		root * ${REMOTE_APP_DIR}/dist
		try_files {path} /index.html
		file_server
	}
}
CADDY

  echo "Starting services..."
  remote_exec "systemctl daemon-reload && \
    systemctl enable --now cribbage && \
    systemctl restart cribbage && \
    caddy fmt --overwrite /etc/caddy/Caddyfile >/dev/null && \
    systemctl enable --now caddy && \
    systemctl reload caddy"

  health
}

pull() {
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  local target="${ROOT_DIR}/production-pulls/${stamp}"
  mkdir -p "$target"
  echo "Pulling production DB files into $target..."
  "${SCP_BASE[@]}" "$REMOTE:${REMOTE_DATA_DIR}/cribbage-server.sqlite*" "$target/" || {
    echo "No production SQLite files found at ${REMOTE_DATA_DIR}/cribbage-server.sqlite*" >&2
    exit 1
  }
  remote_exec "systemctl status cribbage --no-pager" > "$target/cribbage-service-status.txt" || true
  remote_exec "curl -s http://${REMOTE_BIND_HOST}:${REMOTE_PORT_APP}/health" > "$target/health.json" || true
  echo "$target"
}

health() {
  echo "Checking remote health..."
  local attempt
  for attempt in {1..20}; do
    if remote_exec "curl -fsS http://${REMOTE_BIND_HOST}:${REMOTE_PORT_APP}/health && echo"; then
      echo "Public URL: http://${REMOTE_HOST}/"
      return 0
    fi
    sleep 1
  done
  echo "Remote health check failed after waiting for the app to start." >&2
  return 1
}

case "${1:-}" in
  deploy) shift; deploy "$@" ;;
  pull) shift; pull "$@" ;;
  health) shift; health "$@" ;;
  ""|-h|--help|help) usage ;;
  *) echo "Unknown action: $1" >&2; usage; exit 2 ;;
esac
