#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
REMOTE="origin"
BASE_BRANCH="master"
API_ROOT="https://api.github.com"

usage() {
  cat <<'USAGE'
Usage:
  scripts/github-release-pr.sh create "PR title" [body-file]
  scripts/github-release-pr.sh status [PR-number]
  scripts/github-release-pr.sh wait [PR-number]
  scripts/github-release-pr.sh merge [PR-number]

Uses the HTTPS credential already saved for github.com. It never prints the
credential and does not require gh, a browser, or a GitHub connector.
USAGE
}

repository_from_remote() {
  local remote_url path
  remote_url="$(git -C "$ROOT_DIR" remote get-url "$REMOTE")"
  case "$remote_url" in
    git@github.com:*) path="${remote_url#git@github.com:}" ;;
    ssh://git@github.com/*) path="${remote_url#ssh://git@github.com/}" ;;
    https://github.com/*) path="${remote_url#https://github.com/}" ;;
    *)
      echo "Unsupported GitHub remote: $remote_url" >&2
      exit 2
      ;;
  esac
  printf '%s' "${path%.git}"
}

load_credentials() {
  local credentials
  credentials="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill)" || {
    echo "No saved HTTPS credential is available for github.com." >&2
    exit 1
  }
  GITHUB_USERNAME="$(printf '%s\n' "$credentials" | sed -n 's/^username=//p')"
  GITHUB_TOKEN="$(printf '%s\n' "$credentials" | sed -n 's/^password=//p')"
  unset credentials
  if [[ -z "$GITHUB_USERNAME" || -z "$GITHUB_TOKEN" ]]; then
    echo "The saved github.com credential is incomplete." >&2
    exit 1
  fi
}

github_api() {
  local method="$1" path="$2" payload="${3:-}"
  if [[ -n "$payload" ]]; then
    curl -sS --fail-with-body -X "$method" -u "$GITHUB_USERNAME:$GITHUB_TOKEN" \
      -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' \
      "$API_ROOT$path" --data "$payload"
  else
    curl -sS --fail-with-body -X "$method" -u "$GITHUB_USERNAME:$GITHUB_TOKEN" \
      -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' \
      "$API_ROOT$path"
  fi
}

json_value() {
  local expression="$1"
  node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const value = JSON.parse(input);
      const result = Function("value", `return (${process.argv[1]})`)(value);
      if (result !== undefined && result !== null) process.stdout.write(String(result));
    });
  ' "$expression"
}

urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
}

current_pr() {
  local explicit="${1:-}" branch owner encoded response
  if [[ -n "$explicit" ]]; then
    printf '%s' "$explicit"
    return
  fi
  branch="$(git -C "$ROOT_DIR" branch --show-current)"
  owner="${REPOSITORY%%/*}"
  encoded="$(urlencode "$owner:$branch")"
  response="$(github_api GET "/repos/$REPOSITORY/pulls?state=open&head=$encoded&base=$BASE_BRANCH")"
  printf '%s' "$response" | json_value 'value[0]?.number'
}

pr_snapshot() {
  local pr_number="$1"
  github_api GET "/repos/$REPOSITORY/pulls/$pr_number"
}

quality_snapshot() {
  local sha="$1"
  github_api GET "/repos/$REPOSITORY/commits/$sha/check-runs" | json_value '
    (() => {
      const check = value.check_runs?.find(item => item.name === "test");
      return check ? JSON.stringify({status: check.status, conclusion: check.conclusion, url: check.html_url}) : "";
    })()
  '
}

show_status() {
  local pr_number="$1" snapshot sha quality
  snapshot="$(pr_snapshot "$pr_number")"
  sha="$(printf '%s' "$snapshot" | json_value 'value.head.sha')"
  quality="$(quality_snapshot "$sha")"
  printf 'PR #%s %s\n' "$pr_number" "$(printf '%s' "$snapshot" | json_value 'value.html_url')"
  if [[ -z "$quality" ]]; then
    echo "Quality: pending (check not created yet)"
  else
    printf '%s' "$quality" | node -e '
      let input = "";
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const check = JSON.parse(input);
        console.log(`Quality: ${check.status}${check.conclusion ? ` / ${check.conclusion}` : ""}`);
        if (check.url) console.log(check.url);
      });
    '
  fi
}

command="${1:-}"
[[ -n "$command" ]] || { usage; exit 2; }
shift
if [[ "$command" == "--help" || "$command" == "-h" ]]; then
  usage
  exit 0
fi

REPOSITORY="$(repository_from_remote)"
load_credentials
trap 'unset GITHUB_USERNAME GITHUB_TOKEN' EXIT

case "$command" in
  create)
    title="${1:-}"
    body_file="${2:-}"
    [[ -n "$title" ]] || { usage; exit 2; }
    [[ -z "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=normal)" ]] || {
      echo "Refusing to open a PR from a dirty worktree." >&2
      exit 1
    }
    branch="$(git -C "$ROOT_DIR" branch --show-current)"
    [[ -n "$branch" && "$branch" != "$BASE_BRANCH" ]] || {
      echo "Create the PR from a feature branch, not $BASE_BRANCH." >&2
      exit 1
    }
    head_sha="$(git -C "$ROOT_DIR" rev-parse HEAD)"
    remote_sha="$(git -C "$ROOT_DIR" rev-parse "$REMOTE/$branch" 2>/dev/null || true)"
    [[ "$head_sha" == "$remote_sha" ]] || {
      echo "Push the exact feature HEAD before opening its PR." >&2
      exit 1
    }
    existing="$(current_pr)"
    if [[ -n "$existing" ]]; then
      show_status "$existing"
      exit 0
    fi
    body=""
    if [[ -n "$body_file" ]]; then
      [[ -r "$body_file" ]] || { echo "Cannot read PR body file: $body_file" >&2; exit 1; }
      body="$(<"$body_file")"
    fi
    payload="$(node -e '
      const [title, head, base, body] = process.argv.slice(1);
      process.stdout.write(JSON.stringify({title, head, base, body}));
    ' "$title" "$branch" "$BASE_BRANCH" "$body")"
    response="$(github_api POST "/repos/$REPOSITORY/pulls" "$payload")"
    pr_number="$(printf '%s' "$response" | json_value 'value.number')"
    show_status "$pr_number"
    ;;
  status)
    pr_number="$(current_pr "${1:-}")"
    [[ -n "$pr_number" ]] || { echo "No open PR targets $BASE_BRANCH from the current branch." >&2; exit 1; }
    show_status "$pr_number"
    ;;
  wait)
    pr_number="$(current_pr "${1:-}")"
    [[ -n "$pr_number" ]] || { echo "No open PR targets $BASE_BRANCH from the current branch." >&2; exit 1; }
    for _ in $(seq 1 80); do
      snapshot="$(pr_snapshot "$pr_number")"
      sha="$(printf '%s' "$snapshot" | json_value 'value.head.sha')"
      quality="$(quality_snapshot "$sha")"
      if [[ -n "$quality" ]]; then
        status="$(printf '%s' "$quality" | json_value 'value.status')"
        conclusion="$(printf '%s' "$quality" | json_value 'value.conclusion')"
        if [[ "$status" == "completed" && "$conclusion" == "success" ]]; then
          show_status "$pr_number"
          exit 0
        fi
        if [[ "$status" == "completed" ]]; then
          show_status "$pr_number"
          exit 1
        fi
      fi
      sleep 15
    done
    echo "Quality did not finish within 20 minutes." >&2
    exit 1
    ;;
  merge)
    pr_number="$(current_pr "${1:-}")"
    [[ -n "$pr_number" ]] || { echo "No open PR targets $BASE_BRANCH from the current branch." >&2; exit 1; }
    snapshot="$(pr_snapshot "$pr_number")"
    sha="$(printf '%s' "$snapshot" | json_value 'value.head.sha')"
    quality="$(quality_snapshot "$sha")"
    [[ -n "$quality" ]] || {
      echo "Refusing to merge before the Quality test has started." >&2
      exit 1
    }
    status="$(printf '%s' "$quality" | json_value 'value.status')"
    conclusion="$(printf '%s' "$quality" | json_value 'value.conclusion')"
    [[ "$status" == "completed" && "$conclusion" == "success" ]] || {
      echo "Refusing to merge before the Quality test succeeds." >&2
      exit 1
    }
    payload="$(node -e '
      process.stdout.write(JSON.stringify({sha: process.argv[1], merge_method: "squash"}));
    ' "$sha")"
    response="$(github_api PUT "/repos/$REPOSITORY/pulls/$pr_number/merge" "$payload")"
    merged="$(printf '%s' "$response" | json_value 'value.merged')"
    [[ "$merged" == "true" ]] || {
      printf '%s\n' "$response" >&2
      exit 1
    }
    printf 'Merged PR #%s at %s\n' "$pr_number" "$(printf '%s' "$response" | json_value 'value.sha')"
    ;;
  *)
    usage
    exit 2
    ;;
esac
