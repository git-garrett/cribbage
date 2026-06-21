import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, stat, appendFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  CribbageGame,
  WinGame,
  hasLoadedOpponentResources,
  loadOpponentResources,
  type GameSnapshot,
  type Opponent,
} from "../web/src/engine";

declare const __APP_VERSION__: string;

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const ROOT = process.cwd();
const STATIC_DIR = resolve(process.env.CRIBBAGE_STATIC_DIR || join(ROOT, "dist"));
const DATA_DIR = resolve(process.env.CRIBBAGE_DATA_DIR || join(ROOT, "data"));
const DB_PATH = resolve(process.env.CRIBBAGE_DB_PATH || join(DATA_DIR, "cribbage-server.sqlite"));
const PROTECTED_MODEL_ASSET_DIR = resolve(ROOT, "web/src/models");
const MODEL: Opponent = "schell_table-peg_table-14.2";
const MARKETING_HOSTS = new Set(["strongcribbage.com"]);

type JsonRecord = Record<string, unknown>;
type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: unknown[]): void;
  };
};

let databasePromise: Promise<DatabaseSyncLike | null> | null = null;
let modelPromise: Promise<void> | null = null;

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

async function ensureModel(): Promise<void> {
  if (hasLoadedOpponentResources(MODEL)) return;
  modelPromise ??= loadOpponentResources(MODEL).finally(() => {
    modelPromise = null;
  });
  await modelPromise;
}

async function ensureOpponentModel(opponent: Opponent): Promise<void> {
  if (hasLoadedOpponentResources(opponent)) return;
  await loadOpponentResources(opponent);
}

function gamePayload(game: CribbageGame): JsonRecord {
  return {
    state: game.state(),
    snapshot: game.snapshot(),
  };
}

async function handleGameAction(requestBody: JsonRecord): Promise<JsonRecord> {
  const action = String(requestBody.action || "");
  const payload = (requestBody.payload && typeof requestBody.payload === "object"
    ? requestBody.payload
    : {}) as JsonRecord;
  let game: CribbageGame;
  try {
    if (action === "new") {
      const opponent = (typeof payload.opponent === "string" ? payload.opponent : MODEL) as Opponent;
      game = new CribbageGame(opponent, undefined, { dealMode: "cut" });
      return gamePayload(game);
    }
    if (action === "trouble-game") {
      game = new CribbageGame(MODEL);
      game.startTroublePeggingPosition();
      return gamePayload(game);
    }
    if (!requestBody.snapshot) throw new Error("Missing game snapshot.");
    game = CribbageGame.restore(requestBody.snapshot as GameSnapshot);
    switch (action) {
      case "state":
        break;
      case "cut-for-deal":
        game.cutForDeal();
        break;
      case "discard":
        game.discard((payload.ids as number[]) || []);
        break;
      case "prepare-ai-discard": {
        await ensureOpponentModel(game.opponent as Opponent);
        const recommendation = game.recommendAiDiscard();
        return {
          state: game.state(),
          snapshot: game.snapshot(),
          recommendation,
        };
      }
      case "finish-discard":
        await ensureOpponentModel(game.opponent as Opponent);
        game.finishDiscard();
        break;
      case "finish-discard-with-cards":
        await ensureOpponentModel(game.opponent as Opponent);
        game.finishDiscardWithAiCards((payload.ids as number[]) || [], typeof payload.bestLead === "number" ? payload.bestLead : null);
        break;
      case "play":
        game.play(payload.id as number);
        break;
      case "play-human":
        game.playHumanPeggingCard(payload.id as number);
        break;
      case "go":
        game.go();
        break;
      case "go-human":
        game.humanPeggingGo();
        break;
      case "advance-pegging": {
        const startedAt = performance.now();
        await ensureOpponentModel(game.opponent as Opponent);
        game.advancePeggingToHuman();
        game.recordAiPeggingThinkTime(performance.now() - startedAt);
        break;
      }
      case "acknowledge-pegging-reset":
        game.acknowledgePeggingReset();
        break;
      case "complete-decision-reviews":
        await ensureModel();
        game.completePendingDecisionReviews();
        break;
      case "continue-scoring":
        game.continueScoring();
        break;
      default:
        throw new Error(`Unknown game action: ${action}`);
    }
    return gamePayload(game);
  } catch (error) {
    if (error instanceof WinGame && game!) return gamePayload(game);
    throw error;
  }
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
  if (request.method === "GET" && pathname === "/api/model") {
    jsonResponse(response, 200, {
      appVersion: __APP_VERSION__,
      model: MODEL,
      loaded: hasLoadedOpponentResources(MODEL),
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
    const payload = await handleGameAction(requestBody);
    jsonResponse(response, 200, payload);
    return;
  }
  if (pathname === "/api/ai/discard") {
    await ensureModel();
    const game = CribbageGame.restore(requestBody.snapshot as GameSnapshot);
    const recommendation = game.recommendAiDiscard();
    const payload: JsonRecord = { ...recommendation, model: MODEL };
    await persistAiRequest("discard", requestBody, payload, performance.now() - startedAt);
    jsonResponse(response, 200, payload);
    return;
  }
  if (pathname === "/api/ai/peg") {
    await ensureModel();
    const game = CribbageGame.restore(requestBody.snapshot as GameSnapshot);
    const action = game.recommendAiPeggingAction();
    const payload: JsonRecord = { ...action, model: MODEL };
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

const nativeFetch = globalThis.fetch.bind(globalThis);
function protectedModelAssetPath(assetUrl: string): string | null {
  const assetName = assetUrl.split("/").pop() || "";
  if (!assetName.endsWith(".bin")) return null;
  const modelByAsset: Record<string, string> = {
    "pegging-outcome-pairwise.bin": "schell_table-peg_table-12.0",
    "pegging-remaining-hand-distribution.bin": "schell_table-peg_table-13.0",
    "pone-lead-frequency.bin": "schell_table-peg_table-13.0",
    "pegging-outcome-tripolicy-aligned.bin": "schell_table-peg_table-14.0",
    "crib-score-histogram-tripolicy-by-discard-cut.bin": "schell_table-peg_table-14.0",
  };
  const sourceName = Object.keys(modelByAsset).find((name) => {
    const prefix = name.slice(0, -".bin".length);
    return assetName === name || assetName.startsWith(`${prefix}-`);
  });
  if (!sourceName) return null;
  const modelDir = modelByAsset[sourceName];
  if (!modelDir) return null;
  const filePath = normalize(join(PROTECTED_MODEL_ASSET_DIR, modelDir, sourceName));
  return filePath.startsWith(PROTECTED_MODEL_ASSET_DIR) ? filePath : null;
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const value = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (value.startsWith("/assets/")) {
    const protectedPath = protectedModelAssetPath(value);
    if (protectedPath) {
      const body = await readFile(protectedPath);
      return new Response(body);
    }
    const filePath = normalize(join(STATIC_DIR, value));
    if (!filePath.startsWith(STATIC_DIR)) return new Response("Forbidden", { status: 403 });
    const body = await readFile(filePath);
    return new Response(body);
  }
  return nativeFetch(input, init);
};

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
    if (!response.headersSent) jsonResponse(response, 500, { error: error instanceof Error ? error.message : "Server error" });
    else response.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Cribbage server listening on http://${HOST}:${PORT}`);
  console.log(`Static files: ${STATIC_DIR}`);
  console.log(`Database: ${DB_PATH}`);
});
