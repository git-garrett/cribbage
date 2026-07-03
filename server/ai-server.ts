import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, stat, appendFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { MODEL, MODEL_13, MODEL_14_3 } from "./ai-constants";
import {
  persistRustShadowRecord,
  runRustShadowRequest,
  shouldRunRustShadow,
  rustShadowStatus,
} from "./rust-shadow";

declare const __APP_VERSION__: string;

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const ROOT = process.cwd();
const STATIC_DIR = resolve(process.env.CRIBBAGE_STATIC_DIR || join(ROOT, "dist"));
const DATA_DIR = resolve(process.env.CRIBBAGE_DATA_DIR || join(ROOT, "data"));
const DB_PATH = resolve(process.env.CRIBBAGE_DB_PATH || join(DATA_DIR, "cribbage-server.sqlite"));
const MARKETING_HOSTS = new Set(["strongcribbage.com"]);
const AI_QUEUE_MAX_WAITING = Number(process.env.AI_QUEUE_MAX_WAITING || 4);
const LEADERBOARD_MODELS = [MODEL_13, MODEL_14_3] as const;
const PUBLIC_GAME_MODELS = [MODEL_13, MODEL_14_3] as const;

type JsonRecord = Record<string, unknown>;
type AiJobKind = "game-action" | "ai-discard" | "ai-peg" | "model-status";
type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: unknown[]): void;
    all(...values: unknown[]): unknown[];
    get(...values: unknown[]): unknown;
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
  const nextIndex = nextAiJobIndex();
  activeAiJob = aiJobQueue.splice(nextIndex, 1)[0] ?? null;
  if (!activeAiJob) return;
  getAiWorker().postMessage({
    id: activeAiJob.id,
    kind: activeAiJob.kind,
    requestBody: activeAiJob.requestBody,
  });
}

function isLowPriorityAiJob(job: Pick<QueuedAiJob, "kind" | "requestBody">): boolean {
  return job.kind === "game-action" && job.requestBody.action === "complete-decision-reviews";
}

function nextAiJobIndex(): number {
  const liveIndex = aiJobQueue.findIndex((job) => !isLowPriorityAiJob(job));
  return liveIndex === -1 ? 0 : liveIndex;
}

function runAiJob(kind: AiJobKind, requestBody: JsonRecord): Promise<JsonRecord> {
  const lowPriority = isLowPriorityAiJob({ kind, requestBody });
  const liveWaiting = aiJobQueue.filter((job) => !isLowPriorityAiJob(job)).length;
  if (lowPriority ? aiJobQueue.length >= AI_QUEUE_MAX_WAITING : liveWaiting >= AI_QUEUE_MAX_WAITING) {
    throw new ServerBusyError();
  }
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
        CREATE TABLE IF NOT EXISTS game_sessions (
          session_key TEXT PRIMARY KEY,
          tag TEXT NOT NULL,
          model TEXT NOT NULL,
          game_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          status TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          state_json TEXT NOT NULL,
          request_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rust_shadow_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          action TEXT,
          tag TEXT,
          model TEXT NOT NULL,
          game_id TEXT,
          received_at TEXT NOT NULL,
          node_duration_ms INTEGER NOT NULL,
          rust_duration_ms INTEGER,
          rust_status TEXT NOT NULL,
          parity_status TEXT NOT NULL,
          request_json TEXT NOT NULL,
          node_response_json TEXT NOT NULL,
          rust_response_json TEXT,
          error TEXT
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
  const snapshot = requestBody.snapshot as { gameId?: string; opponent?: string } | undefined;
  const record = {
    kind,
    tag: typeof requestBody.tag === "string" ? requestBody.tag : null,
    model: typeof snapshot?.opponent === "string" ? snapshot.opponent : MODEL,
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

function scheduleRustShadow(
  kind: AiJobKind,
  requestBody: JsonRecord,
  nodeResponse: JsonRecord,
  nodeDurationMs: number,
): void {
  if (!shouldRunRustShadow(kind, requestBody, nodeResponse)) return;
  void (async () => {
    const record = await runRustShadowRequest(kind, requestBody, nodeResponse, nodeDurationMs);
    persistRustShadowRecord(await ensureDatabase(), DATA_DIR, record);
  })().catch((error) => {
    console.warn("Rust shadow request failed.", error);
  });
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
  await clearCompletedGameSession(db, record.tag, record.model, record.gameId);
}

function sessionTagFromRequest(requestBody: JsonRecord): string | null {
  return typeof requestBody.tag === "string" && requestBody.tag.trim()
    ? requestBody.tag.trim().slice(0, 80)
    : null;
}

function sessionModelFromRequest(requestBody: JsonRecord): string {
  if (typeof requestBody.model === "string" && requestBody.model.trim()) {
    return requestBody.model.trim().slice(0, 120);
  }
  const snapshot = requestBody.snapshot as JsonRecord | undefined;
  if (snapshot && typeof snapshot.opponent === "string" && snapshot.opponent.trim()) {
    return snapshot.opponent.trim().slice(0, 120);
  }
  return MODEL;
}

function gameSessionKey(tag: string, model: string): string {
  return `${model.toLowerCase()}::${tag.toLowerCase()}`;
}

async function persistGameSession(requestBody: JsonRecord): Promise<void> {
  const tag = sessionTagFromRequest(requestBody);
  if (!tag) return;
  const snapshot = requestBody.snapshot as JsonRecord | undefined;
  const state = requestBody.state as JsonRecord | undefined;
  if (!snapshot || !state) throw new Error("Game session save is missing state or snapshot.");
  if (state.phase === "game_over") {
    await completeGameSession(requestBody);
    return;
  }
  const db = await ensureDatabase();
  if (!db) {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(join(DATA_DIR, "game-sessions.jsonl"), `${JSON.stringify({ ...requestBody, savedAt: new Date().toISOString() })}\n`);
    return;
  }
  const model = sessionModelFromRequest(requestBody);
  const now = new Date().toISOString();
  const gameId = String(requestBody.gameId || snapshot.gameId || "");
  db.prepare(`
    INSERT INTO game_sessions
      (session_key, tag, model, game_id, created_at, updated_at, status, snapshot_json, state_json, request_json)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      tag = excluded.tag,
      model = excluded.model,
      game_id = excluded.game_id,
      updated_at = excluded.updated_at,
      status = 'active',
      snapshot_json = excluded.snapshot_json,
      state_json = excluded.state_json,
      request_json = excluded.request_json
  `).run(
    gameSessionKey(tag, model),
    tag,
    model,
    gameId || null,
    now,
    now,
    JSON.stringify(snapshot),
    JSON.stringify(state),
    JSON.stringify(requestBody),
  );
}

async function loadGameSession(requestBody: JsonRecord): Promise<JsonRecord> {
  const tag = sessionTagFromRequest(requestBody);
  if (!tag) return { ok: true, session: null };
  const db = await ensureDatabase();
  if (!db) return { ok: true, session: null };
  const requestedModel = typeof requestBody.model === "string" && requestBody.model.trim()
    ? requestBody.model.trim().slice(0, 120)
    : null;
  const row = requestedModel
    ? db.prepare(`
        SELECT game_id, updated_at, snapshot_json, state_json
        FROM game_sessions
        WHERE session_key = ? AND status = 'active'
      `).get(gameSessionKey(tag, requestedModel)) as JsonRecord | undefined
    : db.prepare(`
        SELECT game_id, updated_at, snapshot_json, state_json
        FROM game_sessions
        WHERE lower(tag) = lower(?) AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(tag) as JsonRecord | undefined;
  if (!row) return { ok: true, session: null };
  return {
    ok: true,
    session: {
      gameId: row.game_id ?? null,
      updatedAt: row.updated_at,
      snapshot: JSON.parse(String(row.snapshot_json)),
      state: JSON.parse(String(row.state_json)),
    },
  };
}

async function completeGameSession(requestBody: JsonRecord): Promise<void> {
  const tag = sessionTagFromRequest(requestBody);
  if (!tag) return;
  const db = await ensureDatabase();
  if (!db) return;
  const model = sessionModelFromRequest(requestBody);
  const gameId = typeof requestBody.gameId === "string" && requestBody.gameId ? requestBody.gameId : null;
  if (gameId) {
    db.prepare(`
      DELETE FROM game_sessions
      WHERE session_key = ? AND (game_id = ? OR game_id IS NULL)
    `).run(gameSessionKey(tag, model), gameId);
  } else {
    db.prepare("DELETE FROM game_sessions WHERE session_key = ?").run(gameSessionKey(tag, model));
  }
}

async function clearCompletedGameSession(db: DatabaseSyncLike, tag: string | null, model: string, gameId: string): Promise<void> {
  if (!tag) return;
  db.prepare(`
    DELETE FROM game_sessions
    WHERE session_key = ? AND (game_id = ? OR game_id IS NULL)
  `).run(gameSessionKey(tag, model), gameId);
}

function uploadedGameLeaderboardRows(db: DatabaseSyncLike): JsonRecord[] {
  const placeholders = LEADERBOARD_MODELS.map(() => "?").join(", ");
  return db.prepare(`
    SELECT game_id, tag, model, uploaded_at, final_result_json
    FROM game_uploads
    WHERE model IN (${placeholders})
    ORDER BY uploaded_at ASC
  `).all(...LEADERBOARD_MODELS) as JsonRecord[];
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
    model: "13.0/14.3 alternating",
    models: LEADERBOARD_MODELS,
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
      model: "13.0/14.3 alternating",
      models: LEADERBOARD_MODELS,
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
      rustShadow: rustShadowStatus(),
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
    const publicRequest = await publicGameActionRequest(request, requestBody);
    const payload = await runAiJob("game-action", publicRequest);
    scheduleRustShadow("game-action", publicRequest, payload, performance.now() - startedAt);
    jsonResponse(response, 200, payload);
    return;
  }
  if (pathname === "/api/ai/discard") {
    const payload = await runAiJob("ai-discard", requestBody);
    await persistAiRequest("discard", requestBody, payload, performance.now() - startedAt);
    scheduleRustShadow("ai-discard", requestBody, payload, performance.now() - startedAt);
    jsonResponse(response, 200, payload);
    return;
  }
  if (pathname === "/api/ai/peg") {
    const payload = await runAiJob("ai-peg", requestBody);
    await persistAiRequest("peg", requestBody, payload, performance.now() - startedAt);
    scheduleRustShadow("ai-peg", requestBody, payload, performance.now() - startedAt);
    jsonResponse(response, 200, payload);
    return;
  }
  if (pathname === "/api/games") {
    await persistGameUpload(requestBody);
    jsonResponse(response, 200, { ok: true });
    return;
  }
  if (pathname === "/api/game/session/save") {
    await persistGameSession(requestBody);
    jsonResponse(response, 200, { ok: true });
    return;
  }
  if (pathname === "/api/game/session/load") {
    jsonResponse(response, 200, await loadGameSession(requestBody));
    return;
  }
  if (pathname === "/api/game/session/complete") {
    await completeGameSession(requestBody);
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
  const host = String(request.headers.host || "").toLowerCase();
  const closingBracket = host.indexOf("]");
  if (host.startsWith("[") && closingBracket > 1) return host.slice(1, closingBracket);
  return host.split(":")[0];
}

function isLocalNetworkHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  if (normalized.endsWith(".local")) return true;
  const parts = normalized.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

function gameUploadCountsByPublicModel(db: DatabaseSyncLike): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(PUBLIC_GAME_MODELS.map((model) => [model, 0]));
  const placeholders = PUBLIC_GAME_MODELS.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT model, final_result_json
    FROM game_uploads
    WHERE model IN (${placeholders})
  `).all(...PUBLIC_GAME_MODELS) as JsonRecord[];
  for (const row of rows) {
    if (!finalResultFromRow(row)) continue;
    const model = String(row.model || "");
    if (model in counts) counts[model] += 1;
  }
  return counts;
}

function activeGameSessionCountsByPublicModel(db: DatabaseSyncLike): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(PUBLIC_GAME_MODELS.map((model) => [model, 0]));
  const placeholders = PUBLIC_GAME_MODELS.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT model, COUNT(*) AS games
    FROM game_sessions
    WHERE status = 'active' AND model IN (${placeholders})
    GROUP BY model
  `).all(...PUBLIC_GAME_MODELS) as JsonRecord[];
  for (const row of rows) {
    const model = String(row.model || "");
    if (model in counts) counts[model] += Number(row.games || 0);
  }
  return counts;
}

function gameUploadCountsByPublicModelForTag(db: DatabaseSyncLike, tag: string): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(PUBLIC_GAME_MODELS.map((model) => [model, 0]));
  const placeholders = PUBLIC_GAME_MODELS.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT model, final_result_json
    FROM game_uploads
    WHERE lower(tag) = lower(?) AND model IN (${placeholders})
  `).all(tag, ...PUBLIC_GAME_MODELS) as JsonRecord[];
  for (const row of rows) {
    if (!finalResultFromRow(row)) continue;
    const model = String(row.model || "");
    if (model in counts) counts[model] += 1;
  }
  return counts;
}

function activeGameSessionCountsByPublicModelForTag(db: DatabaseSyncLike, tag: string): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(PUBLIC_GAME_MODELS.map((model) => [model, 0]));
  const placeholders = PUBLIC_GAME_MODELS.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT model, COUNT(*) AS games
    FROM game_sessions
    WHERE lower(tag) = lower(?) AND status = 'active' AND model IN (${placeholders})
    GROUP BY model
  `).all(tag, ...PUBLIC_GAME_MODELS) as JsonRecord[];
  for (const row of rows) {
    const model = String(row.model || "");
    if (model in counts) counts[model] += Number(row.games || 0);
  }
  return counts;
}

function mostRecentPublicModel(db: DatabaseSyncLike): string | null {
  const placeholders = PUBLIC_GAME_MODELS.map(() => "?").join(", ");
  const upload = db.prepare(`
    SELECT model, uploaded_at AS at
    FROM game_uploads
    WHERE model IN (${placeholders})
    ORDER BY uploaded_at DESC
    LIMIT 1
  `).get(...PUBLIC_GAME_MODELS) as JsonRecord | undefined;
  const session = db.prepare(`
    SELECT model, created_at AS at
    FROM game_sessions
    WHERE status = 'active' AND model IN (${placeholders})
    ORDER BY created_at DESC
    LIMIT 1
  `).get(...PUBLIC_GAME_MODELS) as JsonRecord | undefined;
  if (!upload && !session) return null;
  if (!upload) return String(session?.model || "");
  if (!session) return String(upload.model || "");
  return String(String(session.at || "") > String(upload.at || "") ? session.model : upload.model);
}

function randomPublicModel(): string {
  return Math.random() < 0.5 ? MODEL_13 : MODEL_14_3;
}

function balancedPublicModelFromCounts(counts: Record<string, number>): string | null {
  const count13 = counts[MODEL_13] ?? 0;
  const count14_3 = counts[MODEL_14_3] ?? 0;
  if (count13 < count14_3) return MODEL_13;
  if (count14_3 < count13) return MODEL_14_3;
  return null;
}

async function publicModelForGameStart(tag: string | null = null): Promise<string> {
  const db = await ensureDatabase();
  if (!db) return MODEL_13;
  if (tag) {
    const uploadCounts = gameUploadCountsByPublicModelForTag(db, tag);
    const sessionCounts = activeGameSessionCountsByPublicModelForTag(db, tag);
    const personalChoice = balancedPublicModelFromCounts({
      [MODEL_13]: uploadCounts[MODEL_13] + sessionCounts[MODEL_13],
      [MODEL_14_3]: uploadCounts[MODEL_14_3] + sessionCounts[MODEL_14_3],
    });
    return personalChoice ?? randomPublicModel();
  }
  const uploadCounts = gameUploadCountsByPublicModel(db);
  const sessionCounts = activeGameSessionCountsByPublicModel(db);
  const globalChoice = balancedPublicModelFromCounts({
    [MODEL_13]: uploadCounts[MODEL_13] + sessionCounts[MODEL_13],
    [MODEL_14_3]: uploadCounts[MODEL_14_3] + sessionCounts[MODEL_14_3],
  });
  return globalChoice ?? (mostRecentPublicModel(db) === MODEL_13 ? MODEL_14_3 : MODEL_13);
}

async function publicGameActionRequest(request: IncomingMessage, requestBody: JsonRecord): Promise<JsonRecord> {
  if (isLocalNetworkHost(requestHost(request))) return requestBody;
  if (requestBody.action !== "new") return requestBody;
  const payload = requestBody.payload && typeof requestBody.payload === "object"
    ? requestBody.payload as JsonRecord
    : {};
  const publicPayload = { ...payload };
  publicPayload.opponent = await publicModelForGameStart(sessionTagFromRequest(requestBody));
  return {
    ...requestBody,
    payload: publicPayload,
  };
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
