#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="/private/tmp/strong-cribbage-local-runtime"
DATA_DIR="${CRIBBAGE_LOCAL_DATA_DIR:-${RUNTIME_DIR}/data}"
FINGERPRINT_FILE="${RUNTIME_DIR}/fingerprint"
LOCK_DIR="${RUNTIME_DIR}/operation.lock"
API_LABEL="com.strongcribbage.local-api"
WEB_LABEL="com.strongcribbage.local-web"
API_PORT=8787
WEB_PORT=8765

usage() {
  cat <<'USAGE'
Usage: scripts/local-runtime.sh start|restart|stop|status

This is the single owner of the shared local Cribbage runtime used by Codex in
VS Code and the Codex app. It uses launchd labels com.strongcribbage.local-api
and com.strongcribbage.local-web, API port 8787, and web/LAN port 8765.

start    Reuse the current source build, or rebuild and replace a stale runtime.
restart  Rebuild and replace the runtime unconditionally.
stop     Stop only the two repository-owned launchd services.
status   Show service, listener, health, version, and source-staleness status.

Local state and logs live in /private/tmp/strong-cribbage-local-runtime/. On first use, existing local data
is copied from the former dated runtime when available, otherwise from data/.
Email delivery is disabled unless CRIBBAGE_LOCAL_SENDGRID_API_KEY is provided.
USAGE
}

service_loaded() {
  launchctl list "$1" >/dev/null 2>&1
}

listener_pid() {
  lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

source_fingerprint() {
  {
    for file in package.json package-lock.json vite.config.ts web/index.html web/styles.css rust/Cargo.toml rust/Cargo.lock scripts/local-runtime.sh scripts/local-static-server.py; do
      shasum "${ROOT_DIR}/${file}"
    done
    find "${ROOT_DIR}/web/src" "${ROOT_DIR}/rust/cribbage-api" "${ROOT_DIR}/rust/cribbage-shadow-engine" \
      -type f \( -name '*.ts' -o -name '*.rs' -o -name 'Cargo.toml' \) -print \
      | LC_ALL=C sort \
      | while IFS= read -r file; do shasum "$file"; done
  } | shasum | awk '{print $1}'
}

runtime_is_current() {
  [[ -f "$FINGERPRINT_FILE" ]] || return 1
  [[ "$(cat "$FINGERPRINT_FILE")" == "$(source_fingerprint)" ]] || return 1
  local expected_version
  expected_version="$(node -p "require('${ROOT_DIR}/package.json').version")"
  curl -fsS "http://127.0.0.1:${API_PORT}/health" 2>/dev/null | grep -q "\"appVersion\":\"${expected_version}\"" || return 1
  curl -fsS "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1 || return 1
  service_loaded "$API_LABEL" && service_loaded "$WEB_LABEL"
}

acquire_lock() {
  mkdir -p "$RUNTIME_DIR"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "Another local-runtime operation is already in progress: $LOCK_DIR" >&2
    exit 1
  fi
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
}

stop_services() {
  launchctl remove "$WEB_LABEL" >/dev/null 2>&1 || true
  launchctl remove "$API_LABEL" >/dev/null 2>&1 || true
  for _ in {1..50}; do
    if [[ -z "$(listener_pid "$WEB_PORT")" && -z "$(listener_pid "$API_PORT")" ]]; then
      return
    fi
    sleep 0.1
  done
  echo "A listener remained after stopping the shared services." >&2
  return 1
}

assert_ports_free() {
  local web_pid api_pid
  web_pid="$(listener_pid "$WEB_PORT")"
  api_pid="$(listener_pid "$API_PORT")"
  if [[ -n "$web_pid" || -n "$api_pid" ]]; then
    echo "Refusing to replace listeners not owned by the shared launchd services." >&2
    [[ -n "$web_pid" ]] && echo "Port ${WEB_PORT}: PID ${web_pid}" >&2
    [[ -n "$api_pid" ]] && echo "Port ${API_PORT}: PID ${api_pid}" >&2
    return 1
  fi
}

bootstrap_data() {
  [[ -f "${DATA_DIR}/cribbage-server.sqlite" ]] && return
  mkdir -p "$DATA_DIR"
  local source_dir=""
  if [[ -f "/private/tmp/strong-cribbage-local-runtime-20260903/data/cribbage-server.sqlite" ]]; then
    source_dir="/private/tmp/strong-cribbage-local-runtime-20260903/data"
  elif [[ -f "${ROOT_DIR}/data/cribbage-server.sqlite" ]]; then
    source_dir="${ROOT_DIR}/data"
  fi
  if [[ -n "$source_dir" ]]; then
    echo "Bootstrapping shared local data from ${source_dir}"
    for file in cribbage-server.sqlite cribbage-server.sqlite-wal cribbage-server.sqlite-shm leaderboard-games.tsv; do
      [[ -f "${source_dir}/${file}" ]] && cp -p "${source_dir}/${file}" "${DATA_DIR}/${file}"
    done
  fi
}

wait_for_runtime() {
  local expected_version
  expected_version="$(node -p "require('${ROOT_DIR}/package.json').version")"
  for _ in {1..100}; do
    if curl -fsS "http://127.0.0.1:${API_PORT}/health" 2>/dev/null | grep -q "\"appVersion\":\"${expected_version}\"" \
      && curl -fsS "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1; then
      return
    fi
    sleep 0.2
  done
  echo "The shared runtime did not become healthy. Check ${RUNTIME_DIR}/api.log and web.log." >&2
  return 1
}

start_runtime() {
  local force="${1:-false}"
  acquire_lock
  if [[ "$force" != "true" ]] && runtime_is_current; then
    echo "Shared local runtime is already current."
    status_runtime
    return
  fi
  if service_loaded "$API_LABEL" || service_loaded "$WEB_LABEL"; then
    stop_services
  fi
  assert_ports_free
  bootstrap_data
  echo "Building the current web client and Rust API..."
  (cd "$ROOT_DIR" && npm run build && cargo build --manifest-path rust/cribbage-api/Cargo.toml --release)
  mkdir -p "${RUNTIME_DIR}/dist" "${RUNTIME_DIR}/rust/cribbage-shadow-engine/assets"
  rsync -a --delete "${ROOT_DIR}/dist/" "${RUNTIME_DIR}/dist/"
  rsync -a --delete "${ROOT_DIR}/rust/cribbage-shadow-engine/assets/" "${RUNTIME_DIR}/rust/cribbage-shadow-engine/assets/"
  COPYFILE_DISABLE=1 cp "${ROOT_DIR}/rust/target/release/cribbage-api" "${RUNTIME_DIR}/cribbage-api"
  COPYFILE_DISABLE=1 cp "${ROOT_DIR}/scripts/local-static-server.py" "${RUNTIME_DIR}/local-static-server.py"
  chmod +x "${RUNTIME_DIR}/cribbage-api"
  : >"${RUNTIME_DIR}/api.log"
  : >"${RUNTIME_DIR}/web.log"
  local python_bin
  python_bin="$(command -v python3)"
  launchctl submit -l "$API_LABEL" -o "${RUNTIME_DIR}/api.log" -e "${RUNTIME_DIR}/api.log" -- \
    /usr/bin/env HOST=127.0.0.1 PORT=8787 \
    CRIBBAGE_MODEL_ROOT="$RUNTIME_DIR" CRIBBAGE_DATA_DIR="$DATA_DIR" \
    CRIBBAGE_REQUIRE_AUTH=true CRIBBAGE_PUBLIC_ORIGIN=http://127.0.0.1:8765 \
    CRIBBAGE_AUTH_PEPPER="${CRIBBAGE_LOCAL_AUTH_PEPPER:-strong-cribbage-local-development}" \
    SENDGRID_API_KEY="${CRIBBAGE_LOCAL_SENDGRID_API_KEY:-local-email-disabled}" \
    "${RUNTIME_DIR}/cribbage-api"
  launchctl submit -l "$WEB_LABEL" -o "${RUNTIME_DIR}/web.log" -e "${RUNTIME_DIR}/web.log" -- \
    /usr/bin/env CRIBBAGE_LOCAL_DIST="${RUNTIME_DIR}/dist" \
    "$python_bin" "${RUNTIME_DIR}/local-static-server.py"
  wait_for_runtime
  source_fingerprint >"$FINGERPRINT_FILE"
  echo "Shared local runtime started."
  status_runtime
}

status_runtime() {
  local api_status web_status api_pid web_pid health freshness
  api_status="stopped"; web_status="stopped"; freshness="stale"
  service_loaded "$API_LABEL" && api_status="loaded"
  service_loaded "$WEB_LABEL" && web_status="loaded"
  api_pid="$(listener_pid "$API_PORT")"; web_pid="$(listener_pid "$WEB_PORT")"
  health="$(curl -fsS "http://127.0.0.1:${API_PORT}/health" 2>/dev/null || true)"
  runtime_is_current && freshness="current"
  echo "API service: ${api_status}; listener: ${api_pid:-none}; health: ${health:-unavailable}"
  echo "Web service: ${web_status}; listener: ${web_pid:-none}"
  echo "Source: ${freshness}"
  echo "Local: http://127.0.0.1:${WEB_PORT}/"
  echo "LAN/iOS: http://<this-Mac's-LAN-IP>:${WEB_PORT}/"
}

case "${1:-}" in
  start) start_runtime false ;;
  restart) start_runtime true ;;
  stop) acquire_lock; stop_services; echo "Shared local runtime stopped." ;;
  status) status_runtime ;;
  -h|--help|help|"") usage ;;
  *) echo "Unknown action: $1" >&2; usage; exit 2 ;;
esac
