#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
REMOTE_HOST="${REMOTE_HOST:-45.79.111.69}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PORT="${REMOTE_PORT:-22}"
SSH_KEY="${SSH_KEY:-${ROOT_DIR}/../2019.private}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/cribbage}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/var/lib/cribbage}"
REMOTE_PORT_APP="${REMOTE_PORT_APP:-8787}"
REMOTE_BIND_HOST="${REMOTE_BIND_HOST:-127.0.0.1}"
DOMAIN="${DOMAIN:-:80}"
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
  remote_exec "mkdir -p '$REMOTE_APP_DIR' '$REMOTE_DATA_DIR' && \
    rm -rf '$REMOTE_APP_DIR/dist' '$REMOTE_APP_DIR/server-dist' '$REMOTE_APP_DIR/package.json' '$REMOTE_APP_DIR/docs' && \
    tar -xzf '/tmp/$(basename "$ARCHIVE")' -C '$REMOTE_APP_DIR'"

  echo "Writing systemd unit..."
  "${SSH_BASE[@]}" "$REMOTE" "cat > /etc/systemd/system/cribbage.service" <<SERVICE
[Unit]
Description=Cribbage Model 13 API and static client
After=network.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_APP_DIR}
Environment=HOST=${REMOTE_BIND_HOST}
Environment=PORT=${REMOTE_PORT_APP}
Environment=CRIBBAGE_STATIC_DIR=${REMOTE_APP_DIR}/dist
Environment=CRIBBAGE_DB_PATH=${REMOTE_DATA_DIR}/cribbage-server.sqlite
Environment=NODE_OPTIONS=--max-old-space-size=512
ExecStart=/usr/bin/node --experimental-sqlite ${REMOTE_APP_DIR}/server-dist/server.mjs
Restart=always
RestartSec=3
User=root
Group=root

[Install]
WantedBy=multi-user.target
SERVICE

  echo "Writing Caddy reverse proxy..."
  "${SSH_BASE[@]}" "$REMOTE" "cat > /etc/caddy/Caddyfile" <<CADDY
${DOMAIN} {
	reverse_proxy ${REMOTE_BIND_HOST}:${REMOTE_PORT_APP}
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
  remote_exec "curl -sS http://${REMOTE_BIND_HOST}:${REMOTE_PORT_APP}/health && echo"
  echo "Public URL: http://${REMOTE_HOST}/"
}

case "${1:-}" in
  deploy) shift; deploy "$@" ;;
  pull) shift; pull "$@" ;;
  health) shift; health "$@" ;;
  ""|-h|--help|help) usage ;;
  *) echo "Unknown action: $1" >&2; usage; exit 2 ;;
esac
