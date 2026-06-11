#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const cacheDir = path.join(root, ".background", "status-history");
const args = process.argv.slice(2);
const trendThresholdSeconds = Number.parseInt(process.env.STATUS_TREND_THRESHOLD_SECONDS || "300", 10);
const staleThresholdSeconds = Number.parseInt(process.env.STATUS_STALE_THRESHOLD_SECONDS || "3600", 10);

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
    const previous = readJson(cachePath);
    if (Array.isArray(previous.samples)) return previous;
    return { ...previous, samples: [previous].filter((sample) => sample.recordedAt) };
  } catch {
    return null;
  }
}

function writePrevious(statusPath, snapshot) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const previous = readPrevious(statusPath);
  const samples = [...(previous?.samples ?? []), snapshot]
    .filter((sample) => sample.recordedAt)
    .filter((sample) => Date.parse(snapshot.recordedAt) - Date.parse(sample.recordedAt) <= 24 * 60 * 60 * 1000)
    .slice(-200);
  fs.writeFileSync(cachePathFor(statusPath), `${JSON.stringify({ ...snapshot, samples }, null, 2)}\n`);
}

function isTerminalStatus(status) {
  return ["complete", "completed", "done", "failed"].includes(String(status?.status || "").toLowerCase());
}

function isStaleStatus(status) {
  if (!status?.updatedAt || !Number.isFinite(staleThresholdSeconds) || staleThresholdSeconds <= 0) return false;
  return Date.now() - Date.parse(status.updatedAt) > staleThresholdSeconds * 1000;
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
        try {
          const status = readJson(fullPath);
          if (isTerminalStatus(status) || isStaleStatus(status)) continue;
        } catch {
          continue;
        }
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

function completedCount(status) {
  if (Number.isFinite(status.completedGames)) return status.completedGames;
  if (Number.isFinite(status.completedRows)) return status.completedRows;
  return null;
}

function totalCount(status) {
  if (Number.isFinite(status.totalGames)) return status.totalGames;
  if (Number.isFinite(status.totalRows)) return status.totalRows;
  return null;
}

function rateUnit(status) {
  if (status.completedGames !== undefined || status.gamesPerSecond !== undefined) return "games/sec";
  if (status.completedRows !== undefined || status.rowsPerSecond !== undefined) return "rows/sec";
  return "units/sec";
}

function recentRate(previous, currentStatus, recordedAt) {
  const currentCompleted = completedCount(currentStatus);
  const total = totalCount(currentStatus);
  if (!Number.isFinite(currentCompleted) || !Number.isFinite(total)) return null;
  const currentRecordedMs = Date.parse(recordedAt);
  const samples = [...(previous?.samples ?? [])]
    .filter((sample) => Number.isFinite(sample.completed) && Number.isFinite(Date.parse(sample.recordedAt)))
    .filter((sample) => currentRecordedMs > Date.parse(sample.recordedAt))
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const baseline = samples.find((sample) => currentRecordedMs - Date.parse(sample.recordedAt) >= 60 * 1000) ?? samples[0];
  if (!baseline) return null;
  const elapsedSeconds = (currentRecordedMs - Date.parse(baseline.recordedAt)) / 1000;
  const delta = currentCompleted - baseline.completed;
  if (elapsedSeconds <= 0 || delta < 0) return null;
  const rate = delta / elapsedSeconds;
  const remaining = Math.max(0, total - currentCompleted);
  return {
    rate,
    delta,
    elapsedSeconds,
    expectedCompletionAt: rate > 0 ? isoFromEstimate(recordedAt, remaining / rate) : null,
  };
}

function describe(statusPath) {
  const status = readJson(statusPath);
  const expectedCompletionAt = status.expectedCompletionAt || isoFromEstimate(status.updatedAt, status.estimatedRemainingSeconds);
  const previous = readPrevious(statusPath);
  const trend = trendLabel(previous?.expectedCompletionAt, expectedCompletionAt);
  const recordedAt = new Date().toISOString();
  const recent = recentRate(previous, status, recordedAt);
  const recentTrend = trendLabel(previous?.recentExpectedCompletionAt, recent?.expectedCompletionAt);
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
    recordedAt,
    updatedAt: status.updatedAt || null,
    expectedCompletionAt,
    recentExpectedCompletionAt: recent?.expectedCompletionAt || null,
    completed: completedCount(status),
    total: totalCount(status),
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
    recent,
    recentTrend,
    unit: rateUnit(status),
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
  console.log(`  Progress: ${item.progress}${item.completed ? `, ${item.completed}` : ""}${item.rate ? `, lifetime average ${item.rate}` : ""}`);
  console.log(`  Lifetime-average expected completion: ${formatLocal(item.expectedCompletionAt)} (${item.trend})`);
  if (item.recent) {
    console.log(
      `  Recent rate: ${item.recent.rate.toFixed(3)} ${item.unit} over ${formatDelta(item.recent.elapsedSeconds)} ` +
        `(${item.recent.delta} completed); recent expected completion: ${formatLocal(item.recent.expectedCompletionAt)} (${item.recentTrend})`,
    );
  }
  console.log(`  Updated: ${formatLocal(item.updatedAt)}`);
  console.log(`  Status file: ${item.path}`);
}
