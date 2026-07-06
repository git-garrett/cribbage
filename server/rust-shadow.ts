import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  MODEL_13,
  MODEL_14_3,
  MODEL_14_8,
  MODEL_14_8_1,
  MODEL_15,
  MODEL_15_0,
  MODEL_15_2,
} from "./ai-constants";

type JsonRecord = Record<string, unknown>;

type DatabaseSyncLike = {
  prepare(sql: string): {
    run(...values: unknown[]): void;
  };
};

export interface RustShadowRecord {
  kind: string;
  action: string | null;
  tag: string | null;
  model: string;
  gameId: string | null;
  receivedAt: string;
  nodeDurationMs: number;
  rustDurationMs: number | null;
  rustStatus: string;
  parityStatus: string;
  request: JsonRecord;
  nodeResponse: JsonRecord;
  rustResponse: JsonRecord | null;
  error: string | null;
}

type ExpectedRustDecision = JsonRecord & {
  kind: "discard" | "peg";
  expected: JsonRecord;
  inputText: string | null;
};

const RUST_SHADOW_ENABLED = process.env.CRIBBAGE_RUST_SHADOW === "1";
const RUST_SHADOW_BIN = resolve(process.env.CRIBBAGE_RUST_SHADOW_BIN || "rust/cribbage-shadow-engine/cribbage-shadow-engine");
const RUST_SHADOW_TIMEOUT_MS = Number.parseInt(process.env.CRIBBAGE_RUST_SHADOW_TIMEOUT_MS || "5000", 10);
const RUST_SHADOW_PERSISTENT = process.env.CRIBBAGE_RUST_SHADOW_PERSISTENT !== "0";
const RUST_SHADOW_SAMPLE_RATE = boundedFloat(process.env.CRIBBAGE_RUST_SHADOW_SAMPLE_RATE, 1, 0, 1);
const RUST_SHADOW_MAX_IN_FLIGHT = Math.max(
  1,
  Number.parseInt(process.env.CRIBBAGE_RUST_SHADOW_MAX_IN_FLIGHT || "2", 10) || 2,
);
const RUST_SHADOW_MODELS = new Set(
  (process.env.CRIBBAGE_RUST_SHADOW_MODELS || `${MODEL_13},${MODEL_14_3},${MODEL_14_8},${MODEL_14_8_1},${MODEL_15_0},${MODEL_15},${MODEL_15_2}`)
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean),
);
let rustShadowInFlight = 0;
let rustShadowDropped = 0;
let rustShadowSampledOut = 0;

type PendingRustRequest = {
  input: JsonRecord;
  resolve: (value: { durationMs: number; response: JsonRecord }) => void;
  reject: (error: Error) => void;
  startedAt: number | null;
  timer: NodeJS.Timeout | null;
  settled: boolean;
};

export type RustPrimaryDecisionResult = {
  durationMs: number;
  response: JsonRecord;
  decision: JsonRecord;
};

let rustWorker: ChildProcessWithoutNullStreams | null = null;
let rustWorkerBuffer = "";
let rustWorkerQueue: PendingRustRequest[] = [];

function boundedFloat(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(value || "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestModel(requestBody: JsonRecord, nodeResponse: JsonRecord): string {
  const snapshot = requestBody.snapshot as JsonRecord | undefined;
  const responseSnapshot = nodeResponse.snapshot as JsonRecord | undefined;
  const payload = requestBody.payload as JsonRecord | undefined;
  if (typeof snapshot?.opponent === "string") return snapshot.opponent;
  if (typeof responseSnapshot?.opponent === "string") return responseSnapshot.opponent;
  if (typeof payload?.opponent === "string") return payload.opponent;
  return "";
}

export function requestModelForPayload(requestBody: JsonRecord, responseBody: JsonRecord = {}): string {
  return requestModel(requestBody, responseBody);
}

function requestGameId(requestBody: JsonRecord, nodeResponse: JsonRecord): string | null {
  const snapshot = requestBody.snapshot as JsonRecord | undefined;
  const responseSnapshot = nodeResponse.snapshot as JsonRecord | undefined;
  const gameId = snapshot?.gameId ?? responseSnapshot?.gameId ?? requestBody.gameId;
  return typeof gameId === "string" && gameId ? gameId : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function playerSnapshot(snapshot: JsonRecord, player: "human" | "ai"): JsonRecord {
  const value = snapshot[player];
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function idsValue(value: unknown): string {
  return Array.isArray(value) ? value.filter((item) => typeof item === "number").join(",") : "";
}

function nullablePlayer(value: unknown): string {
  return value === "human" || value === "ai" ? value : "-";
}

function dealerKey(snapshot: JsonRecord): "human" | "ai" {
  return numberValue(snapshot.deal) === 1 ? "ai" : "human";
}

function poneKey(snapshot: JsonRecord): "human" | "ai" {
  return dealerKey(snapshot) === "ai" ? "human" : "ai";
}

function roleFor(snapshot: JsonRecord, player: "human" | "ai"): "dealer" | "pone" {
  return dealerKey(snapshot) === player ? "dealer" : "pone";
}

function currentPlayerKey(snapshot: JsonRecord): "human" | "ai" {
  return numberValue(snapshot.turn) === 0 ? poneKey(snapshot) : dealerKey(snapshot);
}

function compactRustDecisionInput(kind: "discard" | "peg", model: string, snapshotValue: unknown): string | null {
  if (!snapshotValue || typeof snapshotValue !== "object") return null;
  const snapshot = snapshotValue as JsonRecord;
  const ai = playerSnapshot(snapshot, "ai");
  const human = playerSnapshot(snapshot, "human");
  const aiHand = Array.isArray(ai.hand) ? ai.hand : [];
  const humanHand = Array.isArray(human.hand) ? human.hand : [];
  const fields: Record<string, string | number> = {
    v: 1,
    kind,
    model,
    player: "ai",
    role: roleFor(snapshot, "ai"),
    dealer: dealerKey(snapshot),
    pone: poneKey(snapshot),
    phase: typeof snapshot.phase === "string" ? snapshot.phase : "",
    handNumber: numberValue(snapshot.handNumber, 1),
    aiScore: numberValue(ai.score),
    humanScore: numberValue(human.score),
    myScore: numberValue(ai.score),
    opponentScore: numberValue(human.score),
    aiHand: idsValue(aiHand),
    humanHandCount: humanHand.filter((item) => typeof item === "number").length,
    aiTable: idsValue(ai.table),
    humanTable: idsValue(human.table),
    crib: idsValue(snapshot.crib),
    turnCard: numberValue(snapshot.turnCard, 0),
    count: numberValue(snapshot.count),
    turn: currentPlayerKey(snapshot),
    go: nullablePlayer(snapshot.goPlayer),
    last: nullablePlayer(snapshot.lastPlayer),
    plays: idsValue(snapshot.plays),
    playOwners: Array.isArray(snapshot.playOwners) ? snapshot.playOwners.map(nullablePlayer).join(",") : "",
    pegLead: typeof (snapshot.pegTableLeads as JsonRecord | undefined)?.ai === "number"
      ? (snapshot.pegTableLeads as JsonRecord).ai as number
      : "-",
  };
  return Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(";");
}

export function compactRustPrimaryDecisionInput(kind: "discard" | "peg", model: string, snapshotValue: unknown): string | null {
  return compactRustDecisionInput(kind, model, snapshotValue);
}

function expectedRustDecision(kind: string, requestBody: JsonRecord, nodeResponse: JsonRecord): ExpectedRustDecision | null {
  const recommendation = nodeResponse.recommendation as JsonRecord | undefined;
  if (recommendation && Array.isArray(recommendation.cardIds)) {
    const model = requestModel(requestBody, nodeResponse);
    const snapshot = nodeResponse.snapshot ?? requestBody.snapshot ?? null;
    return {
      kind: "discard",
      expected: {
        cardIds: recommendation.cardIds,
        bestLead: typeof recommendation.bestLead === "number" ? recommendation.bestLead : null,
      },
      inputText: compactRustDecisionInput("discard", model, snapshot),
      snapshot,
    };
  }

  const pegRecommendation = nodeResponse.pegRecommendation as JsonRecord | undefined;
  if (kind === "game-action" && pegRecommendation && typeof pegRecommendation.action === "string") {
    const model = requestModel(requestBody, nodeResponse);
    const snapshot = pegRecommendation.decisionSnapshot ?? null;
    const expected: JsonRecord = { action: pegRecommendation.action };
    if (typeof pegRecommendation.cardId === "number") expected.cardId = pegRecommendation.cardId;
    if (typeof pegRecommendation.ev === "number") expected.ev = pegRecommendation.ev;
    return {
      kind: "peg",
      expected,
      inputText: compactRustDecisionInput("peg", model, snapshot),
      snapshot,
    };
  }

  if (kind === "ai-discard" && Array.isArray(nodeResponse.cardIds)) {
    const model = requestModel(requestBody, nodeResponse);
    const snapshot = requestBody.snapshot ?? null;
    return {
      kind: "discard",
      expected: {
        cardIds: nodeResponse.cardIds,
        bestLead: typeof nodeResponse.bestLead === "number" ? nodeResponse.bestLead : null,
      },
      inputText: compactRustDecisionInput("discard", model, snapshot),
      snapshot,
    };
  }

  if (kind === "ai-peg" && typeof nodeResponse.action === "string") {
    const model = requestModel(requestBody, nodeResponse);
    const snapshot = requestBody.snapshot ?? null;
    const expected: JsonRecord = { action: nodeResponse.action };
    if (typeof nodeResponse.cardId === "number") expected.cardId = nodeResponse.cardId;
    if (typeof nodeResponse.ev === "number") expected.ev = nodeResponse.ev;
    return {
      kind: "peg",
      expected,
      inputText: compactRustDecisionInput("peg", model, snapshot),
      snapshot,
    };
  }

  return null;
}

export function shouldRunRustShadow(kind: string, requestBody: JsonRecord, nodeResponse: JsonRecord): boolean {
  if (!RUST_SHADOW_ENABLED) return false;
  const model = requestModel(requestBody, nodeResponse);
  if (!RUST_SHADOW_MODELS.has(model)) return false;
  if (!expectedRustDecision(kind, requestBody, nodeResponse)?.inputText) return false;
  if (RUST_SHADOW_SAMPLE_RATE < 1 && Math.random() >= RUST_SHADOW_SAMPLE_RATE) {
    rustShadowSampledOut += 1;
    return false;
  }
  if (rustShadowInFlight >= RUST_SHADOW_MAX_IN_FLIGHT) {
    rustShadowDropped += 1;
    return false;
  }
  rustShadowInFlight += 1;
  return true;
}

function runRustShadowProcess(input: JsonRecord): Promise<{ durationMs: number; response: JsonRecord }> {
  const startedAt = performance.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(RUST_SHADOW_BIN, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Rust shadow timed out after ${RUST_SHADOW_TIMEOUT_MS}ms`));
    }, RUST_SHADOW_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Rust shadow exited ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
        return;
      }
      try {
        resolvePromise({
          durationMs: performance.now() - startedAt,
          response: JSON.parse(Buffer.concat(stdout).toString("utf8")) as JsonRecord,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

function rejectRustWorkerQueue(error: Error): void {
  for (const pending of rustWorkerQueue) {
    if (pending.settled) continue;
    pending.settled = true;
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(error);
  }
  rustWorkerQueue = [];
}

function stopRustWorker(error?: Error): void {
  const child = rustWorker;
  rustWorker = null;
  rustWorkerBuffer = "";
  if (error) rejectRustWorkerQueue(error);
  if (child && !child.killed) child.kill("SIGTERM");
}

function sendNextRustWorkerRequest(): void {
  if (!rustWorker || rustWorkerQueue.length === 0) return;
  const pending = rustWorkerQueue[0];
  if (pending.startedAt !== null) return;
  pending.startedAt = performance.now();
  pending.timer = setTimeout(() => {
    stopRustWorker(new Error(`Rust shadow timed out after ${RUST_SHADOW_TIMEOUT_MS}ms`));
  }, RUST_SHADOW_TIMEOUT_MS);
  try {
    rustWorker.stdin.write(`${JSON.stringify(pending.input)}\n`);
  } catch (error) {
    stopRustWorker(error instanceof Error ? error : new Error(String(error)));
  }
}

function handleRustWorkerLine(line: string): void {
  const pending = rustWorkerQueue.shift();
  if (!pending) return;
  if (pending.settled) {
    sendNextRustWorkerRequest();
    return;
  }
  pending.settled = true;
  if (pending.timer) clearTimeout(pending.timer);
  try {
    pending.resolve({
      durationMs: performance.now() - (pending.startedAt ?? performance.now()),
      response: JSON.parse(line) as JsonRecord,
    });
  } catch (error) {
    pending.reject(error instanceof Error ? error : new Error(String(error)));
  }
  sendNextRustWorkerRequest();
}

function ensureRustWorker(): ChildProcessWithoutNullStreams {
  if (rustWorker) return rustWorker;
  const child = spawn(RUST_SHADOW_BIN, [], {
    env: { ...process.env, CRIBBAGE_RUST_SHADOW_WORKER: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  rustWorker = child;
  rustWorkerBuffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    rustWorkerBuffer += chunk.toString("utf8");
    for (;;) {
      const newlineIndex = rustWorkerBuffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = rustWorkerBuffer.slice(0, newlineIndex).trim();
      rustWorkerBuffer = rustWorkerBuffer.slice(newlineIndex + 1);
      if (line) handleRustWorkerLine(line);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trim();
    if (message) console.warn("Rust shadow worker stderr:", message);
  });
  child.on("error", (error) => {
    if (rustWorker === child) stopRustWorker(error);
  });
  child.on("close", (code) => {
    if (rustWorker === child) {
      stopRustWorker(new Error(`Rust shadow worker exited ${code}`));
    }
  });
  return child;
}

function runRustShadowWorker(input: JsonRecord): Promise<{ durationMs: number; response: JsonRecord }> {
  return new Promise((resolvePromise, reject) => {
    rustWorkerQueue.push({
      input,
      resolve: resolvePromise,
      reject,
      startedAt: null,
      timer: null,
      settled: false,
    });
    ensureRustWorker();
    sendNextRustWorkerRequest();
  });
}

function runRustShadowEngine(input: JsonRecord): Promise<{ durationMs: number; response: JsonRecord }> {
  return RUST_SHADOW_PERSISTENT ? runRustShadowWorker(input) : runRustShadowProcess(input);
}

export async function runRustPrimaryDecision(
  kind: "discard" | "peg",
  action: string,
  model: string,
  snapshot: unknown,
): Promise<RustPrimaryDecisionResult> {
  const inputText = compactRustDecisionInput(kind, model, snapshot);
  if (!inputText) throw new Error("Unable to build Rust primary decision input.");
  const rust = await runRustShadowEngine({
    kind,
    action,
    model,
    decision: {
      kind,
      expected: {},
      inputText,
    },
  });
  if (rust.response.supported === false) {
    throw new Error(typeof rust.response.reason === "string" ? rust.response.reason : "Rust primary decision unsupported.");
  }
  if (rust.response.ok !== true || !rust.response.decision || typeof rust.response.decision !== "object") {
    throw new Error(typeof rust.response.error === "string" ? rust.response.error : "Rust primary decision failed.");
  }
  return {
    durationMs: rust.durationMs,
    response: rust.response,
    decision: rust.response.decision as JsonRecord,
  };
}

function summarizeParity(expected: ExpectedRustDecision | null, nodeResponse: JsonRecord, rustResponse: JsonRecord): string {
  if (rustResponse.supported === false) return "unsupported";
  if (expected && rustResponse.decision) {
    return stableJson(expected.expected) === stableJson(rustResponse.decision) ? "match" : "mismatch";
  }
  return stableJson(nodeResponse) === stableJson(rustResponse) ? "match" : "mismatch";
}

async function persistRustShadowJsonl(dataDir: string, record: RustShadowRecord): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await appendFile(join(dataDir, "rust-shadow-requests.jsonl"), `${JSON.stringify(record)}\n`);
}

export function persistRustShadowRecord(db: DatabaseSyncLike | null, dataDir: string, record: RustShadowRecord): void {
  if (!db) {
    void persistRustShadowJsonl(dataDir, record).catch((error) => {
      console.warn("Failed to persist Rust shadow JSONL record.", error);
    });
    return;
  }
  try {
    db.prepare(`
      INSERT INTO rust_shadow_requests
        (kind, action, tag, model, game_id, received_at, node_duration_ms, rust_duration_ms,
         rust_status, parity_status, request_json, node_response_json, rust_response_json, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.kind,
      record.action,
      record.tag,
      record.model,
      record.gameId,
      record.receivedAt,
      Math.round(record.nodeDurationMs),
      record.rustDurationMs === null ? null : Math.round(record.rustDurationMs),
      record.rustStatus,
      record.parityStatus,
      JSON.stringify(record.request),
      JSON.stringify(record.nodeResponse),
      record.rustResponse === null ? null : JSON.stringify(record.rustResponse),
      record.error,
    );
  } catch (error) {
    console.warn("Failed to persist Rust shadow DB record.", error);
  }
}

export async function runRustShadowRequest(
  kind: string,
  requestBody: JsonRecord,
  nodeResponse: JsonRecord,
  nodeDurationMs: number,
): Promise<RustShadowRecord> {
  const model = requestModel(requestBody, nodeResponse);
  const action = typeof requestBody.action === "string" ? requestBody.action : null;
  const expected = expectedRustDecision(kind, requestBody, nodeResponse);
  const base = {
    kind,
    action,
    tag: typeof requestBody.tag === "string" ? requestBody.tag : null,
    model,
    gameId: requestGameId(requestBody, nodeResponse),
    receivedAt: new Date().toISOString(),
    nodeDurationMs,
    request: requestBody,
    nodeResponse,
  };
  try {
    const rust = await runRustShadowEngine({
      kind,
      action,
      model,
      request: requestBody,
      nodeResponse,
      decision: expected,
    });
    return {
      ...base,
      rustDurationMs: rust.durationMs,
      rustStatus: rust.response.supported === false ? "unsupported" : "ok",
      parityStatus: summarizeParity(expected, nodeResponse, rust.response),
      rustResponse: rust.response,
      error: typeof rust.response.reason === "string" ? rust.response.reason : null,
    };
  } catch (error) {
    return {
      ...base,
      rustDurationMs: null,
      rustStatus: "error",
      parityStatus: "error",
      rustResponse: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rustShadowInFlight = Math.max(0, rustShadowInFlight - 1);
  }
}

export function rustShadowBinaryPath(): string {
  return RUST_SHADOW_BIN;
}

export function rustShadowStatus(): JsonRecord {
  return {
    enabled: RUST_SHADOW_ENABLED,
    binary: RUST_SHADOW_BIN,
    binaryExists: existsSync(RUST_SHADOW_BIN),
    models: [...RUST_SHADOW_MODELS],
    timeoutMs: RUST_SHADOW_TIMEOUT_MS,
    persistent: RUST_SHADOW_PERSISTENT,
    sampleRate: RUST_SHADOW_SAMPLE_RATE,
    maxInFlight: RUST_SHADOW_MAX_IN_FLIGHT,
    inFlight: rustShadowInFlight,
    dropped: rustShadowDropped,
    sampledOut: rustShadowSampledOut,
    workerRunning: rustWorker !== null,
    workerQueue: rustWorkerQueue.length,
  };
}
