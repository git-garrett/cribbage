export type ActivityEnvironment = "local" | "lan" | "prod" | "ios";

export interface ActivityClientInfo {
  clientType: "web" | "ios_app";
  browser: string;
  deviceType: "phone" | "tablet" | "desktop";
  viewportWidth: number;
  viewportHeight: number;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  language: string;
  timezone: string;
  platform: string;
  touchPoints: number;
}

export interface ActivityContext {
  authenticated: boolean;
  gameId?: string | null;
  phase?: string | null;
  opponent?: string | null;
  surface?: string | null;
}

interface ActivityEvent {
  id: string;
  name: string;
  occurredAt: string;
  page: string;
  gameId?: string;
  metadata: Record<string, ActivityMetadataValue>;
}

type ActivityMetadataValue = string | number | boolean | null | Array<string | number | boolean>;

interface ActivityTrackerOptions {
  endpoint: string;
  environment: ActivityEnvironment;
  appVersion: string;
  client: ActivityClientInfo;
  getContext: () => ActivityContext;
  sessionStorage?: Storage;
  transport?: typeof fetch;
}

interface BurstState {
  timestamps: number[];
  repeatReported: boolean;
  rageReported: boolean;
}

export interface InteractionBurst {
  repeat: boolean;
  rage: boolean;
  count: number;
}

const ACTIVITY_SESSION_KEY = "strong-cribbage.activity-session.v1";
const ALLOWED_PATHWAY_VIEWS = new Set([
  "play",
  "human",
  "tutorial",
  "settings",
  "gameplay",
  "statistics",
]);

function isPrivateNetworkHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host.endsWith(".local")) return true;
  const parts = host.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function activityEnvironment(hostname: string, nativeIos: boolean): ActivityEnvironment {
  if (nativeIos) return "ios";
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "local";
  if (isPrivateNetworkHostname(host)) return "lan";
  return "prod";
}

export function activityBrowser(userAgent: string, nativeIos: boolean): string {
  if (nativeIos) return "ios_app";
  if (/EdgiOS|Edg\//i.test(userAgent)) return "edge";
  if (/FxiOS|Firefox\//i.test(userAgent)) return "firefox";
  if (/CriOS|Chrome\//i.test(userAgent)) return "chrome";
  if (/Safari\//i.test(userAgent) && /iPhone|iPad|iPod/i.test(userAgent)) return "mobile_safari";
  if (/Safari\//i.test(userAgent)) return "safari";
  return "other";
}

export function activityDeviceType(
  userAgent: string,
  platform: string,
  touchPoints: number,
  screenWidth: number,
  screenHeight: number,
): ActivityClientInfo["deviceType"] {
  const ipad = /iPad/i.test(userAgent) || (platform === "MacIntel" && touchPoints > 1);
  if (ipad) return "tablet";
  if (/iPhone|iPod|Android.*Mobile|Mobile/i.test(userAgent)) return "phone";
  if (touchPoints > 1 && Math.min(screenWidth, screenHeight) <= 1024) return "tablet";
  return "desktop";
}

export function safeActivityPage(urlValue: string): string {
  try {
    const url = new URL(urlValue, "https://activity.invalid");
    const view = url.searchParams.get("pathwayView");
    return view && ALLOWED_PATHWAY_VIEWS.has(view)
      ? `${url.pathname}?pathwayView=${encodeURIComponent(view)}`
      : url.pathname;
  } catch {
    return "/";
  }
}

export function shouldRecordBounce(durationMs: number, interactionCount: number): boolean {
  return durationMs >= 0 && durationMs < 10_000 && interactionCount === 0;
}

export function shouldRecordAbandonmentCandidate(context: ActivityContext): boolean {
  return context.surface === "game" && Boolean(
    context.gameId && context.phase && context.phase !== "game_over",
  );
}

export class InteractionBurstDetector {
  private readonly bursts = new Map<string, BurstState>();

  record(target: string, at: number): InteractionBurst {
    const previous = this.bursts.get(target);
    const latestPrevious = previous?.timestamps.at(-1);
    const reset = latestPrevious === undefined || at - latestPrevious > 5_000;
    const state: BurstState = reset
      ? { timestamps: [], repeatReported: false, rageReported: false }
      : previous ?? { timestamps: [], repeatReported: false, rageReported: false };
    state.timestamps = state.timestamps.filter((timestamp) => at - timestamp <= 5_000);
    state.timestamps.push(at);
    const oneSecondCount = state.timestamps.filter((timestamp) => at - timestamp <= 1_000).length;
    const repeat = state.timestamps.length >= 3 && !state.repeatReported;
    const rage = oneSecondCount >= 3 && !state.rageReported;
    if (repeat) state.repeatReported = true;
    if (rage) state.rageReported = true;
    this.bursts.set(target, state);
    return { repeat, rage, count: state.timestamps.length };
  }
}

function randomActivityId(prefix: string): string {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function activitySessionId(storage?: Storage): string {
  try {
    const existing = storage?.getItem(ACTIVITY_SESSION_KEY);
    if (existing) return existing;
    const created = randomActivityId("session");
    storage?.setItem(ACTIVITY_SESSION_KEY, created);
    return created;
  } catch {
    return randomActivityId("session");
  }
}

function cleanMetadata(metadata: Record<string, unknown>): Record<string, ActivityMetadataValue> {
  const cleaned: Record<string, ActivityMetadataValue> = {};
  for (const [rawKey, rawValue] of Object.entries(metadata).slice(0, 24)) {
    const key = rawKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
    if (!key) continue;
    if (typeof rawValue === "string") cleaned[key] = rawValue.slice(0, 240);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) cleaned[key] = rawValue;
    else if (typeof rawValue === "boolean" || rawValue === null) cleaned[key] = rawValue;
    else if (Array.isArray(rawValue)) {
      cleaned[key] = rawValue
        .filter((value): value is string | number | boolean => (
          typeof value === "string" || typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value))
        ))
        .slice(0, 12)
        .map((value) => typeof value === "string" ? value.slice(0, 120) : value);
    }
  }
  return cleaned;
}

export function activityTarget(target: EventTarget | null): string | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>(
    "button, a, form, summary, select, input[type='button'], input[type='submit'], input[type='checkbox'], input[type='radio'], input[type='file'], [role='button'], [data-card-id]",
  );
  if (!element) return null;
  if (element.dataset.activity) return element.dataset.activity.slice(0, 120);
  if (element.id) return `#${element.id}`;
  if (element.dataset.pathwayDestination) return `pathway:${element.dataset.pathwayDestination.slice(0, 80)}`;
  if (element.dataset.pathwayTarget) return `pathway:${element.dataset.pathwayTarget.slice(0, 80)}`;
  const stableClass = [...element.classList].find((name) => /^[a-z][a-z0-9_-]{1,60}$/i.test(name));
  return `${element.tagName.toLowerCase()}${stableClass ? `.${stableClass}` : ""}`;
}

export function currentActivityClient(nativeIos: boolean): ActivityClientInfo {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const touchPoints = navigator.maxTouchPoints || 0;
  const screenWidth = Math.round(globalThis.screen?.width || window.innerWidth || 0);
  const screenHeight = Math.round(globalThis.screen?.height || window.innerHeight || 0);
  return {
    clientType: nativeIos ? "ios_app" : "web",
    browser: activityBrowser(userAgent, nativeIos),
    deviceType: activityDeviceType(userAgent, platform, touchPoints, screenWidth, screenHeight),
    viewportWidth: Math.round(window.innerWidth || 0),
    viewportHeight: Math.round(window.innerHeight || 0),
    screenWidth,
    screenHeight,
    devicePixelRatio: Number((window.devicePixelRatio || 1).toFixed(2)),
    language: (navigator.language || "").slice(0, 32),
    timezone: (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone.slice(0, 64);
      } catch {
        return "";
      }
    })(),
    platform: platform.slice(0, 64),
    touchPoints,
  };
}

export class ActivityTracker {
  private readonly sessionId: string;
  private readonly startedAt = Date.now();
  private readonly burstDetector = new InteractionBurstDetector();
  private readonly completedGames = new Set<string>();
  private readonly transport: typeof fetch;
  private queue: ActivityEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private batching = false;
  private interactions = 0;

  constructor(private readonly options: ActivityTrackerOptions) {
    this.sessionId = activitySessionId(options.sessionStorage);
    this.transport = options.transport ?? globalThis.fetch.bind(globalThis);
  }

  track(name: string, metadata: Record<string, unknown> = {}, flush = false): void {
    const context = this.options.getContext();
    const combined = cleanMetadata({
      authenticated: context.authenticated,
      phase: context.phase ?? null,
      opponent: context.opponent ?? null,
      surface: context.surface ?? null,
      ...metadata,
    });
    this.queue.push({
      id: randomActivityId("event"),
      name: name.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 64),
      occurredAt: new Date().toISOString(),
      page: safeActivityPage(window.location.href),
      gameId: context.gameId?.slice(0, 128) || undefined,
      metadata: combined,
    });
    if (this.queue.length > 50) this.queue.splice(0, this.queue.length - 50);
    if (!this.batching) {
      if (flush || this.queue.length >= 10) void this.flush(flush);
      else this.scheduleFlush();
    }
  }

  trackInteraction(kind: "click" | "change" | "submit", target: string): void {
    this.interactions += 1;
    this.track("ui_interaction", { kind, target });
  }

  trackPointer(target: string): void {
    const burst = this.burstDetector.record(target, Date.now());
    if (burst.repeat) this.track("repeat_ui_action", { target, count: burst.count });
    if (burst.rage) this.track("rage_click", { target, count: burst.count }, true);
  }

  trackGameCompleted(gameId: string, metadata: Record<string, unknown>): void {
    if (this.completedGames.has(gameId)) return;
    this.completedGames.add(gameId);
    this.track("game_complete", metadata, true);
  }

  trackPageExit(): void {
    const durationMs = Math.max(0, Date.now() - this.startedAt);
    this.batching = true;
    this.track("page_exit", { durationMs, interactionCount: this.interactions });
    if (shouldRecordBounce(durationMs, this.interactions)) {
      this.track("bounce", { durationMs });
    }
    const context = this.options.getContext();
    if (shouldRecordAbandonmentCandidate(context)) {
      this.track("game_abandonment_candidate", { reason: "page_exit", durationMs });
    }
    this.batching = false;
    void this.flush(true);
  }

  async flush(keepalive = false): Promise<void> {
    if ((this.flushing && !keepalive) || this.queue.length === 0) return;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const events = this.queue.splice(0, keepalive ? 50 : 25);
    const parallelExitFlush = this.flushing;
    if (!parallelExitFlush) this.flushing = true;
    try {
      await this.transport(this.options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        keepalive,
        body: JSON.stringify({
          schemaVersion: 1,
          environment: this.options.environment,
          appVersion: this.options.appVersion,
          clientSessionId: this.sessionId,
          client: this.options.client,
          events,
        }),
      });
    } catch {
      // Activity collection must never interrupt authentication or gameplay.
    } finally {
      if (!parallelExitFlush) {
        this.flushing = false;
        if (this.queue.length) this.scheduleFlush();
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 5_000);
  }
}
