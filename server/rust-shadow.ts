import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { MODEL_14_8, MODEL_14_8_1 } from "./ai-constants";

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

const RUST_SHADOW_ENABLED = process.env.CRIBBAGE_RUST_SHADOW === "1";
const RUST_SHADOW_BIN = resolve(process.env.CRIBBAGE_RUST_SHADOW_BIN || "rust/cribbage-shadow-engine/cribbage-shadow-engine");
const RUST_SHADOW_TIMEOUT_MS = Number.parseInt(process.env.CRIBBAGE_RUST_SHADOW_TIMEOUT_MS || "5000", 10);
const RUST_SHADOW_SAMPLE_RATE = boundedFloat(process.env.CRIBBAGE_RUST_SHADOW_SAMPLE_RATE, 1, 0, 1);
const RUST_SHADOW_MAX_IN_FLIGHT = Math.max(
  1,
  Number.parseInt(process.env.CRIBBAGE_RUST_SHADOW_MAX_IN_FLIGHT || "2", 10) || 2,
);
const RUST_SHADOW_MODELS = new Set(
  (process.env.CRIBBAGE_RUST_SHADOW_MODELS || `${MODEL_14_8},${MODEL_14_8_1}`)
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean),
);
let rustShadowInFlight = 0;
let rustShadowDropped = 0;
let rustShadowSampledOut = 0;

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

function requestGameId(requestBody: JsonRecord, nodeResponse: JsonRecord): string | null {
  const snapshot = requestBody.snapshot as JsonRecord | undefined;
  const responseSnapshot = nodeResponse.snapshot as JsonRecord | undefined;
  const gameId = snapshot?.gameId ?? responseSnapshot?.gameId ?? requestBody.gameId;
  return typeof gameId === "string" && gameId ? gameId : null;
}

export function shouldRunRustShadow(requestBody: JsonRecord, nodeResponse: JsonRecord): boolean {
  if (!RUST_SHADOW_ENABLED) return false;
  const model = requestModel(requestBody, nodeResponse);
  if (!RUST_SHADOW_MODELS.has(model)) return false;
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

function summarizeParity(nodeResponse: JsonRecord, rustResponse: JsonRecord): string {
  if (rustResponse.supported === false) return "unsupported";
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
    const rust = await runRustShadowProcess({
      kind,
      action,
      model,
      request: requestBody,
      nodeResponse,
    });
    return {
      ...base,
      rustDurationMs: rust.durationMs,
      rustStatus: rust.response.supported === false ? "unsupported" : "ok",
      parityStatus: summarizeParity(nodeResponse, rust.response),
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
    sampleRate: RUST_SHADOW_SAMPLE_RATE,
    maxInFlight: RUST_SHADOW_MAX_IN_FLIGHT,
    inFlight: rustShadowInFlight,
    dropped: rustShadowDropped,
    sampledOut: rustShadowSampledOut,
  };
}
