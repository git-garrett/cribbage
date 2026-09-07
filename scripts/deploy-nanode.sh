#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "$ROOT_DIR" rev-parse --path-format=absolute --git-common-dir)"
REPOSITORY_ROOT="$(dirname "$GIT_COMMON_DIR")"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
REMOTE_HOST="${REMOTE_HOST:-172.239.170.10}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PORT="${REMOTE_PORT:-22}"
SSH_KEY="${SSH_KEY:-${REPOSITORY_ROOT}/../../keys/strongcribbage_admin_ed25519}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/cribbage}"
REMOTE_RELEASES_DIR="${REMOTE_RELEASES_DIR:-${REMOTE_APP_DIR}/releases}"
REMOTE_CURRENT_LINK="${REMOTE_CURRENT_LINK:-${REMOTE_APP_DIR}/current}"
REMOTE_BUILD_DIR="${REMOTE_BUILD_DIR:-${REMOTE_APP_DIR}/build}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/var/lib/cribbage}"
REMOTE_PORT_APP="${REMOTE_PORT_APP:-8787}"
REMOTE_BIND_HOST="${REMOTE_BIND_HOST:-127.0.0.1}"
GAME_DOMAIN="${GAME_DOMAIN:-cribbage.strongcribbage.com}"
MARKETING_DOMAIN="${MARKETING_DOMAIN:-strongcribbage.com}"
ARCHIVE="${ROOT_DIR}/cribbage-server-${VERSION}.tgz"
PRODUCTION_BRANCH="master"
PRODUCTION_REMOTE="origin"
GIT_COMMIT=""

SSH_BASE=(ssh -p "$REMOTE_PORT" -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
SCP_BASE=(scp -P "$REMOTE_PORT" -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"

usage() {
  cat <<USAGE
Usage:
  scripts/deploy-nanode.sh check
  scripts/deploy-nanode.sh deploy
  scripts/deploy-nanode.sh pull
  scripts/deploy-nanode.sh health

Environment overrides:
  REMOTE_HOST=${REMOTE_HOST}
  REMOTE_USER=${REMOTE_USER}
  SSH_KEY=${SSH_KEY}
  GAME_DOMAIN=${GAME_DOMAIN}
  MARKETING_DOMAIN=${MARKETING_DOMAIN}

The pull action downloads production SQLite files to production-pulls/<timestamp>/.
USAGE
}

remote_exec() {
  "${SSH_BASE[@]}" "$REMOTE" "$@"
}

fail_checkout() {
  echo "Production checkout rejected: $1" >&2
  exit 1
}

check_production_checkout() {
  local branch remote_ref remote_commit
  branch="$(git -C "$ROOT_DIR" symbolic-ref --quiet --short HEAD)" \
    || fail_checkout "HEAD is detached; use ${PRODUCTION_BRANCH}."
  [[ "$branch" == "$PRODUCTION_BRANCH" ]] \
    || fail_checkout "branch is ${branch}; use ${PRODUCTION_BRANCH}."

  if [[ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=normal)" ]]; then
    git -C "$ROOT_DIR" status --short >&2
    fail_checkout "the working tree or index is not clean."
  fi

  git -C "$ROOT_DIR" fetch --quiet "$PRODUCTION_REMOTE" \
    "${PRODUCTION_BRANCH}:refs/remotes/${PRODUCTION_REMOTE}/${PRODUCTION_BRANCH}" \
    || fail_checkout "could not refresh ${PRODUCTION_REMOTE}/${PRODUCTION_BRANCH}."
  remote_ref="refs/remotes/${PRODUCTION_REMOTE}/${PRODUCTION_BRANCH}"
  git -C "$ROOT_DIR" show-ref --verify --quiet "$remote_ref" \
    || fail_checkout "${remote_ref} does not exist."
  GIT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  remote_commit="$(git -C "$ROOT_DIR" rev-parse "$remote_ref")"
  [[ "$GIT_COMMIT" == "$remote_commit" ]] \
    || fail_checkout "HEAD ${GIT_COMMIT} does not match ${PRODUCTION_REMOTE}/${PRODUCTION_BRANCH} ${remote_commit}."

  echo "Production checkout verified: ${PRODUCTION_BRANCH} at ${GIT_COMMIT}."
}

check_archive_identity() {
  local archive_commit archive_version
  read -r archive_version archive_commit < <(
    tar -xOzf "$ARCHIVE" deployment.json | node -e \
      'let input=""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => { const value = JSON.parse(input); process.stdout.write(`${value.version || ""} ${value.gitCommit || ""}\n`); });'
  )
  [[ "$archive_commit" == "$GIT_COMMIT" ]] \
    || fail_checkout "archive commit ${archive_commit:-unknown} does not match ${GIT_COMMIT}."
  [[ "$archive_version" == "$VERSION" ]] \
    || fail_checkout "archive version ${archive_version:-unknown} does not match ${VERSION}."
}

rollback_release() {
  local backup_dir="$1"
  local replacement_link="${REMOTE_APP_DIR}/.current-rollback-${GIT_COMMIT}"

  echo "Rolling back to the previous production release..." >&2
  remote_exec "test -f '${backup_dir}/ready'" || {
    echo "Rollback was not attempted because no completed cutover backup was found." >&2
    return 1
  }
  remote_exec "set -e
    if [ -f '${backup_dir}/had-current-link' ]; then
      read -r previous_release < '${backup_dir}/current-target'
      rm -f '${replacement_link}'
      ln -s \"\$previous_release\" '${replacement_link}'
      mv -Tf '${replacement_link}' '${REMOTE_CURRENT_LINK}'
    else
      rm -f '${REMOTE_CURRENT_LINK}'
    fi
    if [ -f '${backup_dir}/cribbage.service' ]; then
      cp -a '${backup_dir}/cribbage.service' /etc/systemd/system/cribbage.service
    else
      rm -f /etc/systemd/system/cribbage.service
    fi
    if [ -f '${backup_dir}/Caddyfile' ]; then
      cp -a '${backup_dir}/Caddyfile' /etc/caddy/Caddyfile
    else
      rm -f /etc/caddy/Caddyfile
    fi
    systemctl daemon-reload
    systemctl restart cribbage
    systemctl reload caddy"
}

deploy() {
  local remote_archive release_dir incoming_dir unit_candidate caddy_candidate
  local backup_dir replacement_link
  [[ $# -eq 0 ]] || { echo "deploy does not accept options." >&2; usage; exit 2; }
  check_production_checkout
  [[ -r "$SSH_KEY" ]] || {
    echo "Production SSH key is not readable: ${SSH_KEY}" >&2
    exit 1
  }

  (cd "$ROOT_DIR" && npm run qa:predeploy)
  check_production_checkout
  check_archive_identity

  remote_archive="/tmp/$(basename "$ARCHIVE")"
  release_dir="${REMOTE_RELEASES_DIR}/${GIT_COMMIT}"
  incoming_dir="${REMOTE_RELEASES_DIR}/.incoming-${GIT_COMMIT}"
  unit_candidate="/tmp/cribbage.service.${GIT_COMMIT}"
  caddy_candidate="/tmp/Caddyfile.${GIT_COMMIT}"
  backup_dir="/tmp/cribbage-deploy-backup-${GIT_COMMIT}"
  replacement_link="${REMOTE_APP_DIR}/.current-${GIT_COMMIT}"

  echo "Uploading $ARCHIVE to $REMOTE..."
  "${SCP_BASE[@]}" "$ARCHIVE" "$REMOTE:$remote_archive"

  echo "Building an isolated Linux release on $REMOTE..."
  remote_exec "id cribbage >/dev/null 2>&1 || useradd --system --home-dir '$REMOTE_DATA_DIR' --shell /usr/sbin/nologin cribbage && \
    install -d -m 755 '$REMOTE_APP_DIR' '$REMOTE_RELEASES_DIR' '$REMOTE_BUILD_DIR' && \
    install -d -m 750 -o cribbage -g cribbage '$REMOTE_DATA_DIR' && \
    mkdir -p /etc/cribbage && \
    chmod 700 /etc/cribbage && \
    if [ ! -d '$release_dir' ]; then \
      rm -rf '$incoming_dir' && \
      mkdir -p '$incoming_dir' && \
      mkdir -p '$incoming_dir/dist/assets' && \
      if [ -d '$REMOTE_CURRENT_LINK/dist/assets' ]; then \
        cp -a '$REMOTE_CURRENT_LINK/dist/assets/.' '$incoming_dir/dist/assets/'; \
      elif [ -d '$REMOTE_APP_DIR/dist/assets' ]; then \
        cp -a '$REMOTE_APP_DIR/dist/assets/.' '$incoming_dir/dist/assets/'; \
      fi && \
      tar -xzf '$remote_archive' -C '$incoming_dir' && \
      cd '$incoming_dir/rust' && \
      CRIBBAGE_BUILD_GIT_COMMIT='$GIT_COMMIT' CARGO_TARGET_DIR='$REMOTE_BUILD_DIR/target' cargo build --locked --release --manifest-path cribbage-api/Cargo.toml && \
      install -d -m 755 '$incoming_dir/rust/target/release' && \
      install -m 755 '$REMOTE_BUILD_DIR/target/release/cribbage-api' '$incoming_dir/rust/target/release/cribbage-api' && \
      chown -R root:root '$incoming_dir' && \
      chmod 755 '$incoming_dir' && \
      mv '$incoming_dir' '$release_dir'; \
    fi && \
    test -x '$release_dir/rust/target/release/cribbage-api'"

  echo "Preparing systemd and Caddy configuration..."
  "${SSH_BASE[@]}" "$REMOTE" "cat > '$unit_candidate'" <<SERVICE
[Unit]
Description=Cribbage Rust API and static client
After=network.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_CURRENT_LINK}
Environment=HOST=${REMOTE_BIND_HOST}
Environment=PORT=${REMOTE_PORT_APP}
Environment=CRIBBAGE_MODEL_ROOT=${REMOTE_CURRENT_LINK}
Environment=CRIBBAGE_DATA_DIR=${REMOTE_DATA_DIR}
Environment=CRIBBAGE_REQUIRE_AUTH=true
Environment=CRIBBAGE_ENGAGEMENT_ADMIN_USER_IDS=1,53
Environment=CRIBBAGE_PUBLIC_ORIGIN=https://${GAME_DOMAIN}
Environment=CRIBBAGE_MAIL_FROM=hello@strongcribbage.com
Environment="CRIBBAGE_MAIL_FROM_NAME=Strong Cribbage"
Environment=CRIBBAGE_MAIL_REPLY_TO=founder@evenvision.com
Environment=CRIBBAGE_EMAIL_DELIVERY_PAUSED=true
EnvironmentFile=-/etc/cribbage/cribbage.env
ExecStart=${REMOTE_CURRENT_LINK}/rust/target/release/cribbage-api
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

  "${SSH_BASE[@]}" "$REMOTE" "cat > '$caddy_candidate'" <<CADDY
${GAME_DOMAIN} {
	encode zstd gzip
	@api path /api/* /health
	handle @api {
		reverse_proxy ${REMOTE_BIND_HOST}:${REMOTE_PORT_APP} {
			lb_try_duration 5s
			lb_try_interval 100ms
		}
	}
	root * ${REMOTE_CURRENT_LINK}/dist
	@assets path /assets/*
	handle @assets {
		file_server
	}
	handle {
		header Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
		try_files {path} /index.html
		file_server
	}
}

${MARKETING_DOMAIN} {
	encode zstd gzip
	root * ${REMOTE_CURRENT_LINK}/dist
	try_files {path} /coming-soon.html
	file_server
}
CADDY

  remote_exec "caddy fmt --overwrite '$caddy_candidate' >/dev/null && \
    caddy validate --adapter caddyfile --config '$caddy_candidate' >/dev/null"

  echo "Validating leaderboard score reconciliation..."
  remote_exec "runuser -u cribbage -- python3 \
    '$release_dir/scripts/repair_leaderboard_scores.py' --dry-run"

  echo "Atomically activating release $GIT_COMMIT..."
  if ! remote_exec "set -e
    rm -rf '$backup_dir'
    mkdir -p '$backup_dir'
    if [ -L '$REMOTE_CURRENT_LINK' ]; then
      readlink '$REMOTE_CURRENT_LINK' > '${backup_dir}/current-target'
      touch '${backup_dir}/had-current-link'
    fi
    if [ -f /etc/systemd/system/cribbage.service ]; then
      cp -a /etc/systemd/system/cribbage.service '${backup_dir}/cribbage.service'
    fi
    if [ -f /etc/caddy/Caddyfile ]; then
      cp -a /etc/caddy/Caddyfile '${backup_dir}/Caddyfile'
    fi
    touch '${backup_dir}/ready'
    rm -f '$replacement_link'
    ln -s '$release_dir' '$replacement_link'
    mv -Tf '$replacement_link' '$REMOTE_CURRENT_LINK'
    install -m 644 '$unit_candidate' /etc/systemd/system/cribbage.service
    install -m 644 '$caddy_candidate' /etc/caddy/Caddyfile
    systemctl daemon-reload
    systemctl enable cribbage >/dev/null
    systemctl enable --now caddy >/dev/null
    systemctl reload caddy
    systemctl stop cribbage
    runuser -u cribbage -- python3 '$release_dir/scripts/repair_leaderboard_scores.py'
    systemctl restart cribbage"; then
    rollback_release "$backup_dir"
    return 1
  fi

  if ! health "$GIT_COMMIT"; then
    rollback_release "$backup_dir"
    return 1
  fi
  if ! (cd "$ROOT_DIR" && node scripts/check-client-cache-contract.cjs "https://${GAME_DOMAIN}"); then
    rollback_release "$backup_dir"
    return 1
  fi

  remote_exec "rm -f '$remote_archive' '$unit_candidate' '$caddy_candidate' && rm -rf '$backup_dir'"
  echo "Active release: $release_dir"
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
  if remote_exec "test -f '${REMOTE_DATA_DIR}/leaderboard-games.tsv'"; then
    "${SCP_BASE[@]}" "$REMOTE:${REMOTE_DATA_DIR}/leaderboard-games.tsv" "$target/"
  fi
  remote_exec "systemctl status cribbage --no-pager" > "$target/cribbage-service-status.txt" || true
  remote_exec "curl -s http://${REMOTE_BIND_HOST}:${REMOTE_PORT_APP}/health" > "$target/health.json" || true
  echo "$target"
}

health() {
  echo "Checking remote health..."
  local expected_commit="${1:-}" attempt response="" response_commit=""
  for attempt in {1..20}; do
    if response="$(remote_exec "curl -fsS http://${REMOTE_BIND_HOST}:${REMOTE_PORT_APP}/health")"; then
      response_commit="$(printf '%s' "$response" | node -e \
        'let input=""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => { try { process.stdout.write(JSON.parse(input).gitCommit || ""); } catch {} });')"
      if [[ -n "$expected_commit" && "$response_commit" != "$expected_commit" ]]; then
        sleep 1
        continue
      fi
      echo "$response"
      break
    fi
    sleep 1
  done
  [[ -n "${response:-}" && ( -z "$expected_commit" || "$response_commit" == "$expected_commit" ) ]] || {
    echo "Remote health check failed after waiting for the app to start." >&2
    return 1
  }

  echo "Checking public health..."
  for attempt in {1..20}; do
    if response="$(curl -fsS "https://${GAME_DOMAIN}/health")"; then
      response_commit="$(printf '%s' "$response" | node -e \
        'let input=""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => { try { process.stdout.write(JSON.parse(input).gitCommit || ""); } catch {} });')"
      if [[ -z "$expected_commit" || "$response_commit" == "$expected_commit" ]]; then
        echo "$response"
        echo "Public URL: https://${GAME_DOMAIN}/"
        return 0
      fi
    fi
    sleep 1
  done
  echo "Public health check failed after waiting for the deployed commit." >&2
  return 1
}

case "${1:-}" in
  check) shift; [[ $# -eq 0 ]] || { usage; exit 2; }; check_production_checkout ;;
  deploy) shift; deploy "$@" ;;
  pull) shift; pull "$@" ;;
  health) shift; health "$@" ;;
  ""|-h|--help|help) usage ;;
  *) echo "Unknown action: $1" >&2; usage; exit 2 ;;
esac
