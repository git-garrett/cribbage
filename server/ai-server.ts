import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, stat, appendFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { MODEL } from "./ai-constants";

declare const __APP_VERSION__: string;

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const ROOT = process.cwd();
const STATIC_DIR = resolve(process.env.CRIBBAGE_STATIC_DIR || join(ROOT, "dist"));
const DATA_DIR = resolve(process.env.CRIBBAGE_DATA_DIR || join(ROOT, "data"));
const DB_PATH = resolve(process.env.CRIBBAGE_DB_PATH || join(DATA_DIR, "cribbage-server.sqlite"));
const MARKETING_HOSTS = new Set(["strongcribbage.com"]);
const AI_QUEUE_MAX_WAITING = Number(process.env.AI_QUEUE_MAX_WAITING || 4);

type JsonRecord = Record<string, unknown>;
type AiJobKind = "game-action" | "ai-discard" | "ai-peg" | "model-status";
type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: unknown[]): void;
    all(...values: unknown[]): unknown[];
  };
};

let databasePromise: Promise<DatabaseSyncLike | null> | null = null;
let aiWorker: Worker | null = null;
let nextAiJobId = 1;
let activeAiJob: QueuedAiJob | null = null;
const aiJobQueue: QueuedAiJob[] = [];

function jsonResponse(response: ServerResponse, status: number, payload: unknown): void {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  response.end(body);
}

function textResponse(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(message),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  response.end(message);
}

function optionsResponse(response: ServerResponse): void {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
  });
  response.end();
}

async function readRequestJson(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 5_000_000) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonRecord;
}

class ServerBusyError extends Error {
  constructor(message = "Server Busy") {
    super(message);
    this.name = "ServerBusyError";
  }
}

interface QueuedAiJob {
  id: number;
  kind: AiJobKind;
  requestBody: JsonRecord;
  resolve: (value: JsonRecord) => void;
  reject: (error: Error) => void;
}

function getAiWorker(): Worker {
  if (aiWorker) return aiWorker;
  aiWorker = new Worker(new URL("./ai-worker.mjs", import.meta.url));
  aiWorker.on("message", (message: { id: number; ok: boolean; payload?: JsonRecord; error?: string; stack?: string | null }) => {
    const job = activeAiJob;
    if (!job || message.id !== job.id) return;
    activeAiJob = null;
    if (message.ok) {
      job.resolve(message.payload ?? {});
    } else {
      const error = new Error(message.error || "AI worker failed.");
      if (message.stack) error.stack = message.stack;
      job.reject(error);
    }
    processAiQueue();
  });
  aiWorker.on("error", (error) => {
    failActiveAndQueued(error);
  });
  aiWorker.on("exit", (code) => {
    aiWorker = null;
    if (activeAiJob || aiJobQueue.length || code !== 0) {
      failActiveAndQueued(new Error(`AI worker exited with code ${code}.`));
    }
  });
  return aiWorker;
}

function failActiveAndQueued(error: Error): void {
  const active = activeAiJob;
  activeAiJob = null;
  if (active) active.reject(error);
  const queued = aiJobQueue.splice(0);
  for (const job of queued) job.reject(error);
}

function processAiQueue(): void {
  if (activeAiJob || !aiJobQueue.length) return;
  activeAiJob = aiJobQueue.shift() ?? null;
  if (!activeAiJob) return;
  getAiWorker().postMessage({
    id: activeAiJob.id,
    kind: activeAiJob.kind,
    requestBody: activeAiJob.requestBody,
  });
}

function runAiJob(kind: AiJobKind, requestBody: JsonRecord): Promise<JsonRecord> {
  if (aiJobQueue.length >= AI_QUEUE_MAX_WAITING) throw new ServerBusyError();
  return new Promise((resolve, reject) => {
    aiJobQueue.push({
      id: nextAiJobId++,
      kind,
      requestBody,
      resolve,
      reject,
    });
    processAiQueue();
  });
}

async function ensureDatabase(): Promise<DatabaseSyncLike | null> {
  if (databasePromise) return databasePromise;
  databasePromise = (async () => {
    await mkdir(dirname(DB_PATH), { recursive: true });
    try {
      const sqlite = await import("node:sqlite");
      const db = new sqlite.DatabaseSync(DB_PATH) as DatabaseSyncLike;
      db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS game_uploads (
          game_id TEXT PRIMARY KEY,
          tag TEXT,
          app_version TEXT,
          model TEXT,
          uploaded_at TEXT NOT NULL,
          final_result_json TEXT,
          snapshot_json TEXT,
          events_json TEXT NOT NULL,
          request_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          tag TEXT,
          model TEXT NOT NULL,
          game_id TEXT,
          received_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          request_json TEXT NOT NULL,
          response_json TEXT NOT NULL
        );
      `);
      return db;
    } catch (error) {
      console.warn("SQLite unavailable; falling back to JSONL logs.", error);
      return null;
    }
  })();
  return databasePromise;
}

async function persistAiRequest(kind: string, requestBody: JsonRecord, responseBody: JsonRecord, durationMs: number): Promise<void> {
  const db = await ensureDatabase();
  const snapshot = requestBody.snapshot as { gameId?: string } | undefined;
  const record = {
    kind,
    tag: typeof requestBody.tag === "string" ? requestBody.tag : null,
    model: MODEL,
    gameId: snapshot?.gameId ?? null,
    receivedAt: new Date().toISOString(),
    durationMs: Math.round(durationMs),
    request: requestBody,
    response: responseBody,
  };
  if (!db) {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(join(DATA_DIR, "ai-requests.jsonl"), `${JSON.stringify(record)}\n`);
    return;
  }
  db.prepare(`
    INSERT INTO ai_requests
      (kind, tag, model, game_id, received_at, duration_ms, request_json, response_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.kind,
    record.tag,
    record.model,
    record.gameId,
    record.receivedAt,
    record.durationMs,
    JSON.stringify(requestBody),
    JSON.stringify(responseBody),
  );
}

async function persistGameUpload(requestBody: JsonRecord): Promise<void> {
  const db = await ensureDatabase();
  const gameId = String(requestBody.gameId || (requestBody.snapshot as { gameId?: string } | undefined)?.gameId || "");
  if (!gameId) throw new Error("Game upload is missing gameId.");
  const record = {
    gameId,
    tag: typeof requestBody.tag === "string" ? requestBody.tag : null,
    appVersion: typeof requestBody.appVersion === "string" ? requestBody.appVersion : __APP_VERSION__,
    model: typeof requestBody.model === "string" ? requestBody.model : MODEL,
    uploadedAt: new Date().toISOString(),
    finalResult: requestBody.finalResult ?? null,
    snapshot: requestBody.snapshot ?? null,
    events: requestBody.events ?? [],
    request: requestBody,
  };
  if (!db) {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(join(DATA_DIR, "game-uploads.jsonl"), `${JSON.stringify(record)}\n`);
    return;
  }
  db.prepare(`
    INSERT INTO game_uploads
      (game_id, tag, app_version, model, uploaded_at, final_result_json, snapshot_json, events_json, request_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(game_id) DO UPDATE SET
      tag = excluded.tag,
      app_version = excluded.app_version,
      model = excluded.model,
      uploaded_at = excluded.uploaded_at,
      final_result_json = excluded.final_result_json,
      snapshot_json = excluded.snapshot_json,
      events_json = excluded.events_json,
      request_json = excluded.request_json
  `).run(
    record.gameId,
    record.tag,
    record.appVersion,
    record.model,
    record.uploadedAt,
    JSON.stringify(record.finalResult),
    JSON.stringify(record.snapshot),
    JSON.stringify(record.events),
    JSON.stringify(record.request),
  );
}

function uploadedGameLeaderboardRows(db: DatabaseSyncLike): JsonRecord[] {
  return db.prepare(`
    SELECT game_id, tag, model, uploaded_at, final_result_json
    FROM game_uploads
    WHERE model = ?
    ORDER BY uploaded_at ASC
  `).all(MODEL) as JsonRecord[];
}

function playerNameFromTag(tag: unknown): string {
  return typeof tag === "string" && tag.trim() ? tag.trim().slice(0, 40) : "Anonymous";
}

function finalResultFromRow(row: JsonRecord): JsonRecord | null {
  try {
    const parsed = JSON.parse(String(row.final_result_json || "null")) as JsonRecord | null;
    if (!parsed || typeof parsed !== "object") return null;
    const scores = parsed.finalScores as JsonRecord | undefined;
    if (!scores || typeof scores !== "object") return null;
    if (!Number.isFinite(Number(scores.human)) || !Number.isFinite(Number(scores.ai))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildLeaderboardSummary(rows: JsonRecord[]): JsonRecord {
  const players = new Map<string, {
    player: string;
    games: number;
    wins: number;
    losses: number;
    skunks: number;
    skunked: number;
    pointsFor: number;
    pointsAgainst: number;
  }>();
  const bestWins: JsonRecord[] = [];
  for (const row of rows) {
    const finalResult = finalResultFromRow(row);
    if (!finalResult) continue;
    const scores = finalResult.finalScores as JsonRecord;
    const humanScore = Number(scores.human);
    const aiScore = Number(scores.ai);
    const result = typeof finalResult.result === "string" ? finalResult.result : "regular";
    const player = playerNameFromTag(row.tag);
    const stats = players.get(player) ?? {
      player,
      games: 0,
      wins: 0,
      losses: 0,
      skunks: 0,
      skunked: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    };
    const humanWon = finalResult.winner === "human";
    stats.games += 1;
    if (humanWon) stats.wins += 1;
    else stats.losses += 1;
    if (humanWon && (result === "skunk" || result === "double-skunk")) stats.skunks += 1;
    if (!humanWon && (result === "skunk" || result === "double-skunk")) stats.skunked += 1;
    stats.pointsFor += humanScore;
    stats.pointsAgainst += aiScore;
    players.set(player, stats);
    if (humanWon) {
      bestWins.push({
        player,
        margin: humanScore - aiScore,
        humanScore,
        aiScore,
        result,
        opponent: row.model || MODEL,
        endedAt: typeof finalResult.at === "string" ? finalResult.at : row.uploaded_at,
      });
    }
  }
  const playerStats = [...players.values()].map((player) => ({
    ...player,
    winRate: player.games ? player.wins / player.games : 0,
    avgMargin: player.games ? (player.pointsFor - player.pointsAgainst) / player.games : 0,
  })).sort((a, b) => (
    b.winRate - a.winRate ||
    b.games - a.games ||
    b.skunks - a.skunks ||
    b.avgMargin - a.avgMargin ||
    a.player.localeCompare(b.player)
  ));
  bestWins.sort((a, b) => (
    Number(b.margin) - Number(a.margin) ||
    String(a.endedAt).localeCompare(String(b.endedAt))
  ));
  const highSkunkCount = Math.max(0, ...playerStats.map((player) => player.skunks));
  return {
    generatedAt: new Date().toISOString(),
    source: "server-game-uploads",
    model: MODEL,
    games: playerStats.reduce((sum, player) => sum + player.games, 0),
    playerStats,
    winRate14_3: playerStats,
    bestWins,
    mostSkunks: highSkunkCount > 0 ? playerStats.filter((player) => player.skunks === highSkunkCount) : [],
  };
}

async function leaderboardSummary(): Promise<JsonRecord> {
  const db = await ensureDatabase();
  if (!db) {
    return {
      generatedAt: new Date().toISOString(),
      source: "server-game-uploads",
      model: MODEL,
      games: 0,
      playerStats: [],
      winRate14_3: [],
      bestWins: [],
      mostSkunks: [],
    };
  }
  return buildLeaderboardSummary(uploadedGameLeaderboardRows(db));
}

async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  if (request.method === "GET" && pathname === "/health") {
    jsonResponse(response, 200, {
      ok: true,
      appVersion: __APP_VERSION__,
      model: MODEL,
      sqlite: Boolean(await ensureDatabase()),
    });
    return;
  }
  if (request.method === "GET" && pathname === "/api/leaderboard") {
    jsonResponse(response, 200, await leaderboardSummary());
    return;
  }
  if (request.method === "GET" && pathname === "/api/model") {
    jsonResponse(response, 200, {
      appVersion: __APP_VERSION__,
      model: MODEL,
      loaded: null,
      queue: {
        active: Boolean(activeAiJob),
        waiting: aiJobQueue.length,
        maxWaiting: AI_QUEUE_MAX_WAITING,
      },
    });
    return;
  }
  if (request.method !== "POST") {
    textResponse(response, 405, "Method not allowed");
    return;
  }

  const requestBody = await readRequestJson(request);
  const startedAt = performance.now();
  if (pathname === "/api/game/action") {
    const payload = await runAiJob("game-action", requestBody);
    jsonResponse(response, 200, payload);
    return;
  }
  if (pathname === "/api/ai/discard") {
    const payload = await runAiJob("ai-discard", requestBody);
    await persistAiRequest("discard", requestBody, payload, performance.now() - startedAt);
    jsonResponse(response, 200, payload);
    return;
  }
  if (pathname === "/api/ai/peg") {
    const payload = await runAiJob("ai-peg", requestBody);
    await persistAiRequest("peg", requestBody, payload, performance.now() - startedAt);
    jsonResponse(response, 200, payload);
    return;
  }
  if (pathname === "/api/games") {
    await persistGameUpload(requestBody);
    jsonResponse(response, 200, { ok: true });
    return;
  }
  textResponse(response, 404, "Not found");
}

function contentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".bin") return "application/octet-stream";
  return "application/octet-stream";
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  const decodedPath = decodeURIComponent(pathname);
  if (/\/assets\/.*(peg-table|pegging|crib-score-histogram|discard-cut|remaining-hand|pone-lead|\.bin)/i.test(decodedPath)) {
    textResponse(response, 404, "Not found");
    return;
  }
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = normalize(join(STATIC_DIR, requestedPath));
  if (!filePath.startsWith(STATIC_DIR)) {
    textResponse(response, 403, "Forbidden");
    return;
  }
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "content-type": contentType(filePath),
      "content-length": stats.size,
      "cache-control": filePath.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    const indexPath = join(STATIC_DIR, "index.html");
    const body = await readFile(indexPath);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-cache",
    });
    response.end(body);
  }
}

async function serveComingSoon(response: ServerResponse): Promise<void> {
  await serveStatic(response, "/coming-soon.html");
}

function requestHost(request: IncomingMessage): string {
  return String(request.headers.host || "").split(":")[0].toLowerCase();
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "OPTIONS") {
      optionsResponse(response);
      return;
    }
    if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }
    if (MARKETING_HOSTS.has(requestHost(request)) && (url.pathname === "/" || url.pathname === "/index.html")) {
      await serveComingSoon(response);
      return;
    }
    await serveStatic(response, url.pathname);
  })().catch((error) => {
    console.error(error);
    if (!response.headersSent && error instanceof ServerBusyError) {
      jsonResponse(response, 503, { error: "Server Busy" });
    } else if (!response.headersSent) {
      jsonResponse(response, 500, { error: error instanceof Error ? error.message : "Server error" });
    }
    else response.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Cribbage server listening on http://${HOST}:${PORT}`);
  console.log(`Static files: ${STATIC_DIR}`);
  console.log(`Database: ${DB_PATH}`);
});
