#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const cacheDir = path.join(root, ".background", "status-history");
const args = process.argv.slice(2);
const trendThresholdSeconds = Number.parseInt(process.env.STATUS_TREND_THRESHOLD_SECONDS || "300", 10);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isoFromEstimate(updatedAt, seconds) {
  if (!updatedAt || !Number.isFinite(seconds)) return null;
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return null;
  return new Date(updatedMs + seconds * 1000).toISOString();
}

function formatLocal(iso) {
  if (!iso) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

function trendLabel(previousIso, currentIso) {
  if (!previousIso || !currentIso) return "no prior estimate";
  const deltaSeconds = (Date.parse(currentIso) - Date.parse(previousIso)) / 1000;
  if (deltaSeconds > trendThresholdSeconds) return `slipping back by ${formatDelta(deltaSeconds)}`;
  if (deltaSeconds < -trendThresholdSeconds) return `advancing by ${formatDelta(Math.abs(deltaSeconds))}`;
  return "staying consistent";
}

function formatDelta(seconds) {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function cachePathFor(statusPath) {
  const hash = crypto.createHash("sha256").update(path.relative(root, statusPath)).digest("hex").slice(0, 16);
  return path.join(cacheDir, `${hash}.json`);
}

function readPrevious(statusPath) {
  const cachePath = cachePathFor(statusPath);
  if (!fs.existsSync(cachePath)) return null;
  try {
    return readJson(cachePath);
  } catch {
    return null;
  }
}

function writePrevious(statusPath, snapshot) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePathFor(statusPath), `${JSON.stringify(snapshot, null, 2)}\n`);
}

function newestStatusUnder(dir) {
  if (!fs.existsSync(dir)) return null;
  let newest = null;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.endsWith(".batches")) stack.push(fullPath);
      } else if (entry.name === "status.json") {
        const mtimeMs = fs.statSync(fullPath).mtimeMs;
        if (!newest || mtimeMs > newest.mtimeMs) newest = { path: fullPath, mtimeMs };
      }
    }
  }
  return newest?.path || null;
}

function defaultStatusPaths() {
  return [
    newestStatusUnder(path.join(root, "benchmarks", "ai-smoke")),
    newestStatusUnder(path.join(root, "benchmarks", "pegging-table")),
  ].filter(Boolean);
}

function describe(statusPath) {
  const status = readJson(statusPath);
  const expectedCompletionAt = status.expectedCompletionAt || isoFromEstimate(status.updatedAt, status.estimatedRemainingSeconds);
  const previous = readPrevious(statusPath);
  const trend = trendLabel(previous?.expectedCompletionAt, expectedCompletionAt);
  const name = status.runId || path.basename(path.dirname(statusPath));
  const progress = Number.isFinite(status.progressPercent) ? `${status.progressPercent.toFixed(2)}%` : "unknown progress";
  const completed = status.completedGames !== undefined && status.totalGames !== undefined
    ? `${status.completedGames}/${status.totalGames} games`
    : status.completedRows !== undefined && status.totalRows !== undefined
      ? `${status.completedRows}/${status.totalRows} rows`
      : "";
  const rate = status.gamesPerSecond !== undefined
    ? `${status.gamesPerSecond.toFixed(3)} games/sec`
    : status.rowsPerSecond !== undefined
      ? `${status.rowsPerSecond.toFixed(3)} rows/sec`
      : "";

  writePrevious(statusPath, {
    statusPath: path.relative(root, statusPath),
    recordedAt: new Date().toISOString(),
    updatedAt: status.updatedAt || null,
    expectedCompletionAt,
  });

  return {
    name,
    status: status.status,
    phase: status.phase || null,
    progress,
    completed,
    rate,
    updatedAt: status.updatedAt || null,
    expectedCompletionAt,
    trend,
    path: path.relative(root, statusPath),
  };
}

const statusPaths = (args.length ? args : defaultStatusPaths()).map((arg) => path.resolve(root, arg));
if (!statusPaths.length) {
  console.error("No status files found. Pass one or more status.json paths.");
  process.exit(1);
}

for (const item of statusPaths.map(describe)) {
  console.log(`${item.name}: ${item.status}${item.phase ? ` (${item.phase})` : ""}`);
  console.log(`  Progress: ${item.progress}${item.completed ? `, ${item.completed}` : ""}${item.rate ? `, ${item.rate}` : ""}`);
  console.log(`  Expected completion: ${formatLocal(item.expectedCompletionAt)} (${item.trend})`);
  console.log(`  Updated: ${formatLocal(item.updatedAt)}`);
  console.log(`  Status file: ${item.path}`);
}
