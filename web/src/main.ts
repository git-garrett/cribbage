import type {
  AnalyticsDecisionReview,
  AnalyticsEvent,
  AnalyticsScoreCategory,
  AnalyticsRole,
  GameSnapshot,
  GameState,
  Opponent,
  PlayerKey,
  ScorePhase,
} from "./engine";
import aiBenchmarkSummary from "./ai-benchmark-summary.json";

const DEFAULT_OPPONENT: Opponent = "schell_table-peg_table-14.2";

type BaselineScoreTotals = Pick<
  AnalyticsTotals,
  | "wins"
  | "losses"
  | "skunks"
  | "skunked"
  | "doubleSkunks"
  | "doubleSkunked"
  | "peggingDealer"
  | "peggingPone"
  | "handDealer"
  | "handPone"
  | "crib"
>;

interface AiBenchmarkSummarySource {
  version: number;
  source?: string;
  games?: number;
  opponent?: string;
  aiTotals?: Partial<BaselineScoreTotals>;
  opportunities?: Partial<Record<ScoreKey, number>>;
  models?: Record<string, {
    games?: number;
    aiTotals?: Partial<BaselineScoreTotals>;
    opportunities?: Partial<Record<ScoreKey, number>>;
  }>;
  benchmarks?: Array<{
    source?: string;
    games?: number;
    models?: Record<string, {
      games?: number;
      aiTotals?: Partial<BaselineScoreTotals>;
      opportunities?: Partial<Record<ScoreKey, number>>;
    }>;
  }>;
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeLocalStorageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing or locked-down contexts.
  }
}

const state: {
  game: GameState | null;
  selected: Set<number>;
  pending: boolean;
  splashOpen: boolean;
  hasResumableGame: boolean;
  resultOverride: string[] | null;
  parGuides: boolean;
  analyticsOpen: boolean;
  analyticsMode: "my" | "full";
  gameLogOpen: boolean;
  modelInfoOpen: boolean;
  decisionReviewOpen: boolean;
  selectedModelInfo: Opponent;
  selectedLogGameId: string | null;
  snapshotEventId: string | null;
  dismissedGameOverId: string | null;
  aiThinking: boolean;
  modelLoading: boolean;
  completingReviews: boolean;
  noticeText: string;
  noticeHistory: string[];
  noticeHistoryIndex: number | null;
  noticeQueue: string[];
  noticeResultLines: string[];
  noticeUpdatedAt: number;
  noticeTimer: number | null;
  dealCutRevealStage: "human" | "ai" | null;
  dealCutResolve: (() => void) | null;
  dealAnimation: { key: string; dealer: string; pone: string } | null;
  animatedDealKeys: Set<string>;
  turnCutRevealStage: "user-cut" | "ai-cut" | "user-turn" | "ai-turn" | "revealed" | null;
  turnCutResolve: (() => void) | null;
  cutForDealPreparation: { key: string; promise: Promise<ServerCutForDealPreparationResponse> } | null;
  aiDiscardPreparation: { key: string; promise: Promise<AiDiscardPreparationResult> } | null;
  nextHandPreparation: { key: string; promise: Promise<ServerAiDiscardPreparationResponse> } | null;
} = {
  game: null,
  selected: new Set(),
  pending: false,
  splashOpen: false,
  hasResumableGame: false,
  resultOverride: null,
  parGuides: safeLocalStorageGet("strong-cribbage.admin.parGuides") === "1",
  analyticsOpen: false,
  analyticsMode: "my",
  gameLogOpen: false,
  modelInfoOpen: false,
  decisionReviewOpen: false,
  selectedModelInfo: DEFAULT_OPPONENT,
  selectedLogGameId: null,
  snapshotEventId: null,
  dismissedGameOverId: null,
  aiThinking: false,
  modelLoading: false,
  completingReviews: false,
  noticeText: "",
  noticeHistory: [],
  noticeHistoryIndex: null,
  noticeQueue: [],
  noticeResultLines: [],
  noticeUpdatedAt: 0,
  noticeTimer: null,
  dealCutRevealStage: null,
  dealCutResolve: null,
  dealAnimation: null,
  animatedDealKeys: new Set(),
  turnCutRevealStage: null,
  turnCutResolve: null,
  cutForDealPreparation: null,
  aiDiscardPreparation: null,
  nextHandPreparation: null,
};

type TurnCutProgress = "ai-turn" | "revealed" | "confirmed" | null;

let interactionEpoch = 0;
const failedNextHandPreparationKeys = new Set<string>();

function resetTransientGameUi(): void {
  interactionEpoch += 1;
  state.selected.clear();
  state.resultOverride = null;
  state.dismissedGameOverId = null;
  state.aiThinking = false;
  state.modelLoading = false;
  state.completingReviews = false;
  state.noticeText = "";
  state.noticeHistory = [];
  state.noticeHistoryIndex = null;
  state.noticeResultLines = [];
  clearNoticeQueue();
  renderNoticeText("");
  state.dealCutRevealStage = null;
  if (state.dealCutResolve) state.dealCutResolve();
  state.dealCutResolve = null;
  state.dealAnimation = null;
  state.animatedDealKeys = new Set();
  state.turnCutRevealStage = null;
  if (state.turnCutResolve) state.turnCutResolve();
  state.turnCutResolve = null;
  state.cutForDealPreparation = null;
  state.aiDiscardPreparation = null;
  state.nextHandPreparation = null;
  failedNextHandPreparationKeys.clear();
  closeDecisionSnapshot();
  state.analyticsOpen = false;
  state.gameLogOpen = false;
  state.modelInfoOpen = false;
  state.decisionReviewOpen = false;
}

function setAiThinking(active: boolean): void {
  state.aiThinking = active;
}

const els = {
  app: document.querySelector(".app") as HTMLElement,
  splashPage: document.querySelector("#splash-page") as HTMLElement,
  splashNewGame: document.querySelector("#splash-new-game") as HTMLButtonElement,
  splashResumeGame: document.querySelector("#splash-resume-game") as HTMLButtonElement,
  splashNameRow: document.querySelector("#splash-name-row") as HTMLElement,
  splashFirstName: document.querySelector("#splash-first-name") as HTMLInputElement,
  board: document.querySelector("#board") as HTMLElement,
  menuToggle: document.querySelector("#menu-toggle") as HTMLButtonElement,
  settingsPanel: document.querySelector("#settings-panel") as HTMLElement,
  adminMenu: document.querySelector("#admin-menu") as HTMLElement,
  parGuidesToggle: document.querySelector("#par-guides-toggle") as HTMLInputElement,
  appVersion: document.querySelector("#app-version") as HTMLElement,
  myStatsOpen: document.querySelector("#my-stats-open") as HTMLButtonElement,
  analyticsOpen: document.querySelector("#analytics-open") as HTMLButtonElement,
  exportGameLog: document.querySelector("#export-game-log") as HTMLButtonElement,
  troubleGame: document.querySelector("#trouble-game") as HTMLButtonElement,
  analyticsClose: document.querySelector("#analytics-close") as HTMLButtonElement,
  analyticsPage: document.querySelector("#analytics-page") as HTMLElement,
  analyticsTitle: document.querySelector("#analytics-title") as HTMLElement,
  analyticsSummary: document.querySelector("#analytics-summary") as HTMLElement,
  analyticsTotals: document.querySelector("#analytics-totals") as HTMLElement,
  analyticsGames: document.querySelector("#analytics-games") as HTMLElement,
  analyticsHands: document.querySelector("#analytics-hands") as HTMLElement,
  analyticsScores: document.querySelector("#analytics-scores") as HTMLElement,
  analyticsPegging: document.querySelector("#analytics-pegging") as HTMLElement,
  gameLogOpen: document.querySelector("#game-log-open") as HTMLButtonElement,
  gameLogClose: document.querySelector("#game-log-close") as HTMLButtonElement,
  gameLogPage: document.querySelector("#game-log-page") as HTMLElement,
  gameLogSummary: document.querySelector("#game-log-summary") as HTMLElement,
  gameLogOpponent: document.querySelector("#game-log-opponent") as HTMLSelectElement,
  gameLogList: document.querySelector("#game-log-list") as HTMLElement,
  modelInfoOpen: document.querySelector("#model-info-open") as HTMLButtonElement,
  modelInfoClose: document.querySelector("#model-info-close") as HTMLButtonElement,
  modelInfoPage: document.querySelector("#model-info-page") as HTMLElement,
  modelInfoSummary: document.querySelector("#model-info-summary") as HTMLElement,
  modelInfoList: document.querySelector("#model-info-list") as HTMLElement,
  modelInfoContent: document.querySelector("#model-info-content") as HTMLElement,
  modelLoading: document.querySelector("#model-loading") as HTMLElement,
  decisionReviewPage: document.querySelector("#decision-review-page") as HTMLElement,
  decisionReviewClose: document.querySelector("#decision-review-close") as HTMLButtonElement,
  decisionReviewSummary: document.querySelector("#decision-review-summary") as HTMLElement,
  decisionReviewContent: document.querySelector("#decision-review-content") as HTMLElement,
  decisionSnapshot: document.querySelector("#decision-snapshot") as HTMLElement,
  decisionSnapshotClose: document.querySelector("#decision-snapshot-close") as HTMLButtonElement,
  decisionSnapshotTitle: document.querySelector("#decision-snapshot-title") as HTMLElement,
  decisionSnapshotTable: document.querySelector("#decision-snapshot-table") as HTMLElement,
  result: document.querySelector("#result") as HTMLElement,
  resultInline: document.querySelector("#result-inline") as HTMLElement,
  scoringResult: document.querySelector("#scoring-result") as HTMLElement,
  humanScore: document.querySelector("#human-score") as HTMLElement,
  humanPace: document.querySelector("#human-pace") as HTMLElement,
  humanFinal: document.querySelector("#human-final") as HTMLElement,
  humanDealer: document.querySelector("#human-dealer") as HTMLElement,
  scoreCut: document.querySelector("#score-cut") as HTMLElement,
  aiScore: document.querySelector("#ai-score") as HTMLElement,
  aiPace: document.querySelector("#ai-pace") as HTMLElement,
  aiFinal: document.querySelector("#ai-final") as HTMLElement,
  aiDealer: document.querySelector("#ai-dealer") as HTMLElement,
  dealer: document.querySelector("#dealer") as HTMLElement,
  turn: document.querySelector("#turn") as HTMLElement,
  count: document.querySelector("#count") as HTMLElement,
  modelThinking: document.querySelector("#model-thinking") as HTMLElement,
  thinkingOverlay: document.querySelector("#thinking-overlay") as HTMLElement,
  thinkingOverlayLabel: document.querySelector("#thinking-overlay-label") as HTMLElement,
  turnCard: document.querySelector("#turn-card") as HTMLElement,
  playAreaTitle: document.querySelector("#play-area-title") as HTMLElement,
  plays: document.querySelector("#plays") as HTMLElement,
  noticeBack: document.querySelector("#notice-back") as HTMLButtonElement,
  noticeForward: document.querySelector("#notice-forward") as HTMLButtonElement,
  userHandTitle: document.querySelector("#user-hand-title") as HTMLElement,
  aiStrip: document.querySelector(".ai-strip") as HTMLElement,
  humanHand: document.querySelector("#human-hand") as HTMLElement,
  aiHand: document.querySelector("#ai-hand") as HTMLElement,
  discard: document.querySelector("#discard") as HTMLButtonElement,
  cutForDeal: document.querySelector("#cut-for-deal") as HTMLButtonElement,
  play: document.querySelector("#play") as HTMLButtonElement,
  go: document.querySelector("#go") as HTMLButtonElement,
  newGame: document.querySelector("#new-game") as HTMLButtonElement,
  opponent: document.querySelector("#opponent") as HTMLSelectElement,
  scoringReview: document.querySelector("#scoring-review") as HTMLElement,
  scoringTitle: document.querySelector("#scoring-title") as HTMLElement,
  scoringCards: document.querySelector("#scoring-cards") as HTMLElement,
  scoringPoints: document.querySelector("#scoring-points") as HTMLElement,
  continueScoring: document.querySelector("#continue-scoring") as HTMLButtonElement,
  acknowledgePeggingReset: document.querySelector("#acknowledge-pegging-reset") as HTMLButtonElement,
  continuePegging: document.querySelector("#continue-pegging") as HTMLButtonElement,
  gameOverAlert: document.querySelector("#game-over-alert") as HTMLElement,
  gameOverTitle: document.querySelector("#game-over-title") as HTMLElement,
  gameOverClose: document.querySelector("#game-over-close") as HTMLButtonElement,
  singleGameReport: document.querySelector("#single-game-report") as HTMLElement,
};

const SHARED_PAR_HOLES = [17, 33, 43, 59, 69, 85, 95];
const GRANULAR_PARS = {
  pone: {
    pegging: 2.0,
    hand: 8.1,
    total: 10.1,
  },
  dealer: {
    pegging: 3.5,
    hand: 8.0,
    crib: 4.7,
    total: 16.2,
  },
} as const;
const SAVE_KEY = "strong-cribbage.game.v1";
const ANALYTICS_KEY = "strong-cribbage.analytics.v1";
const PHONE_GAME_DB_NAME = "cribbage-game-log";
const PHONE_GAME_DB_VERSION = 1;
const NOTICE_MIN_MS = 600;
const SIMPLE_NETWORK_OPPONENT: Opponent = "schell_table-peg_table-14.2";
const URL_PARAMS = new URLSearchParams(window.location.search);
const FULL_APP_MODE = URL_PARAMS.get("full") === "1" || URL_PARAMS.get("mode") === "full";
const SIMPLE_NETWORK_MODE = !FULL_APP_MODE;
const SESSION_TAG = (URL_PARAMS.get("tag") || "").trim();
const PLAYER_FIRST_NAME_KEY = "strong-cribbage.playerFirstName.v1";
const SIMPLE_NETWORK_SESSION_KEY = "strong-cribbage.simpleNetworkSession";
const REMOTE_AI_DISABLED = URL_PARAMS.get("local") === "1";
const REMOTE_AI_BASE = (URL_PARAMS.get("api") || "").replace(/\/$/, "");
const REMOTE_AI_EXPLICIT = URL_PARAMS.has("api");
const IS_VITE_DEV = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
const SERVER_UPLOAD_KEY = "strong-cribbage.serverUploadedGames.v1";
const ADMIN_HASH = "#strong-admin-13";

let playerFirstName = (safeLocalStorageGet(PLAYER_FIRST_NAME_KEY) || "").trim();

els.parGuidesToggle.checked = state.parGuides;

interface AnalyticsStore {
  version: 1;
  events: AnalyticsEvent[];
}

interface ServerDiscardResponse {
  cardIds?: number[];
  cards?: Array<{ id: number }>;
}

interface ServerPeggingResponse {
  action?: "play" | "go";
  cardId?: number;
  card?: { id: number };
  ev?: number;
}

interface AnalyticsTotals {
  games: number;
  wins: number;
  losses: number;
  skunks: number;
  skunked: number;
  doubleSkunks: number;
  doubleSkunked: number;
  peggingDealer: number;
  peggingPone: number;
  handDealer: number;
  handPone: number;
  crib: number;
  peggingDealerHands: number;
  peggingPoneHands: number;
  handDealerHands: number;
  handPoneHands: number;
  cribHands: number;
  baselineGames?: number;
  baselineSources?: string[];
}

type ScoreKey = "peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib";
const ERROR_EV_THRESHOLD = 0.25;
const ERROR_WIN_PROBABILITY_THRESHOLD = 0.0025;
const ERROR_SCORE_KEYS: ScoreKey[] = ["peggingDealer", "peggingPone", "handDealer", "handPone", "crib"];
type GameEndEvent = Extract<AnalyticsEvent, { type: "game" }> & { action: "end" };
type ScoreEvent = Extract<AnalyticsEvent, { type: "score" }>;
type DiscardEvent = Extract<AnalyticsEvent, { type: "discard" }>;
type PeggingEvent = Extract<AnalyticsEvent, { type: "pegging" }>;
type DecisionReviewEvent = (DiscardEvent | PeggingEvent) & { review: AnalyticsDecisionReview };
interface GameLogRecord {
  gameId: string;
  start?: Extract<AnalyticsEvent, { type: "game" }>;
  end: GameEndEvent;
  opponent: Opponent;
}
interface DecisionEvTotals {
  total: number;
  discard: number;
  pegging: number;
  dealer: number;
  pone: number;
  pointEvTotal: number;
  count: number;
}
interface DecisionErrorAverages {
  totals: Record<ScoreKey, number>;
  games: number;
  hands: number;
}

interface SavedGameRecord {
  version: 1;
  snapshot: GameSnapshot;
  state: GameState;
}

function loadSavedGame(): SavedGameRecord | null {
  const saved = safeLocalStorageGet(SAVE_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as Partial<SavedGameRecord>;
    if (parsed.version !== 1 || !parsed.snapshot || !parsed.state) return null;
    return parsed as SavedGameRecord;
  } catch {
    safeLocalStorageRemove(SAVE_KEY);
    return null;
  }
}

function saveGame(): void {
  if (!currentSnapshot || !state.game) return;
  safeLocalStorageSet(SAVE_KEY, JSON.stringify({ version: 1, snapshot: currentSnapshot, state: state.game }));
  syncAnalytics(currentSnapshot.analyticsEvents ?? state.game.analyticsEvents ?? []);
}

let currentSnapshot: GameSnapshot | null = null;
const simpleNetworkSessionValue = SIMPLE_NETWORK_OPPONENT;
const savedGame = loadSavedGame();
if (savedGame) {
  currentSnapshot = savedGame.snapshot;
  state.game = savedGame.state;
}
const simpleLoadedState = state.game;
state.splashOpen = SIMPLE_NETWORK_MODE && !playerFirstName;
state.hasResumableGame = SIMPLE_NETWORK_MODE && currentSnapshot?.opponent === SIMPLE_NETWORK_OPPONENT && simpleLoadedState?.phase !== "game_over";
if (
  SIMPLE_NETWORK_MODE &&
  (
    currentSnapshot?.opponent !== SIMPLE_NETWORK_OPPONENT ||
    safeLocalStorageGet(SIMPLE_NETWORK_SESSION_KEY) !== simpleNetworkSessionValue ||
    simpleLoadedState?.phase === "game_over"
  )
) {
  currentSnapshot = null;
  state.game = null;
  safeLocalStorageRemove(SAVE_KEY);
}
state.hasResumableGame = SIMPLE_NETWORK_MODE && currentSnapshot?.opponent === SIMPLE_NETWORK_OPPONENT && state.game?.phase !== "game_over";
if (SIMPLE_NETWORK_MODE) {
  safeLocalStorageSet(SIMPLE_NETWORK_SESSION_KEY, simpleNetworkSessionValue);
} else {
  safeLocalStorageRemove(SIMPLE_NETWORK_SESSION_KEY);
}
els.appVersion.textContent = displayAppVersion(__APP_VERSION__);
buildBoard();

function applySimpleNetworkMode(): void {
  if (!SIMPLE_NETWORK_MODE) return;
  els.app.dataset.simpleNetwork = "true";
  els.opponent.value = SIMPLE_NETWORK_OPPONENT;
  els.opponent.disabled = true;
  els.opponent.closest("label")?.setAttribute("hidden", "");
  els.gameLogOpen.hidden = true;
  els.modelInfoOpen.hidden = true;
  els.exportGameLog.hidden = true;
  els.modelLoading.hidden = true;
}

function applyAdminVisibility(): void {
  const showAdmin = window.location.hash === ADMIN_HASH;
  els.adminMenu.hidden = !showAdmin;
  if (!showAdmin) els.adminMenu.removeAttribute("open");
}

applySimpleNetworkMode();
applyAdminVisibility();
window.addEventListener("hashchange", applyAdminVisibility);
try {
  if (state.game) render(state.game);
} catch (error) {
  console.warn("Initial game render failed", error);
  state.splashOpen = SIMPLE_NETWORK_MODE && !playerFirstName;
  document.body.dataset.splash = state.splashOpen ? "true" : "false";
  els.splashPage.hidden = !state.splashOpen;
  els.result.textContent = error instanceof Error ? error.message : "Startup failed";
}

function loadAnalytics(): AnalyticsStore {
  const fallback: AnalyticsStore = { version: 1, events: [] };
  const saved = safeLocalStorageGet(ANALYTICS_KEY);
  if (!saved) return fallback;
  try {
    const parsed = JSON.parse(saved) as AnalyticsStore;
    if (parsed.version !== 1 || !Array.isArray(parsed.events)) return fallback;
    return parsed;
  } catch {
    safeLocalStorageRemove(ANALYTICS_KEY);
    return fallback;
  }
}

function saveAnalytics(store: AnalyticsStore): void {
  safeLocalStorageSet(ANALYTICS_KEY, JSON.stringify(store));
}

let phoneGameDbPromise: Promise<IDBDatabase | null> | null = null;

function openPhoneGameDb(): Promise<IDBDatabase | null> {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (phoneGameDbPromise) return phoneGameDbPromise;
  phoneGameDbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(PHONE_GAME_DB_NAME, PHONE_GAME_DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("events")) {
        const events = db.createObjectStore("events", { keyPath: "id" });
        events.createIndex("gameId", "gameId", { unique: false });
        events.createIndex("type", "type", { unique: false });
      }
      if (!db.objectStoreNames.contains("games")) {
        const games = db.createObjectStore("games", { keyPath: "gameId" });
        games.createIndex("opponent", "opponent", { unique: false });
        games.createIndex("endedAt", "endedAt", { unique: false });
        games.createIndex("includedInTables", "includedInTables", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return phoneGameDbPromise;
}

function persistPhoneGameEvents(events: AnalyticsEvent[]): void {
  if (!events.length) return;
  void openPhoneGameDb().then((db) => {
    if (!db) return;
    const transaction = db.transaction(["events", "games"], "readwrite");
    const eventStore = transaction.objectStore("events");
    const gameStore = transaction.objectStore("games");
    for (const event of events) {
      const taggedEvent = tagPhoneRecord(event);
      eventStore.put(taggedEvent);
      if (event.type === "game" && event.action === "end") {
        gameStore.put({
          gameId: event.gameId,
          source: "phone",
          opponent: event.opponent,
          winner: event.winner ?? null,
          loser: event.loser ?? null,
          result: event.result ?? null,
          finalScores: event.finalScores ?? null,
          endedAt: event.at,
          includedInTables: 1,
          tags: currentSessionTag() ? [currentSessionTag()] : [],
          sessionTag: currentSessionTag() || null,
          notes: currentSessionTag() ? `tag:${currentSessionTag()}` : "",
          randomSeed: null,
        });
      }
    }
  }).catch(() => {
    // localStorage remains the fallback analytics store if IndexedDB is unavailable.
  });
}

function tagPhoneRecord<T extends object>(record: T): T & { tags?: string[]; sessionTag?: string } {
  const sessionTag = currentSessionTag();
  if (!sessionTag) return record;
  const rawTags = (record as { tags?: unknown }).tags;
  const existingTags = Array.isArray(rawTags) ? rawTags.filter((tag): tag is string => typeof tag === "string") : [];
  const tags = existingTags.includes(sessionTag) ? existingTags : [...existingTags, sessionTag];
  return {
    ...record,
    tags,
    sessionTag,
  };
}

function cleanFirstName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}

function currentSessionTag(): string {
  return SESSION_TAG || playerFirstName;
}

function saveSplashName(): boolean {
  const name = cleanFirstName(els.splashFirstName.value);
  if (!name) {
    if (!playerFirstName) {
      els.splashFirstName.focus();
      els.splashFirstName.setCustomValidity("Enter your first name.");
      els.splashFirstName.reportValidity();
      return false;
    }
    return true;
  }
  els.splashFirstName.setCustomValidity("");
  playerFirstName = name;
  safeLocalStorageSet(PLAYER_FIRST_NAME_KEY, playerFirstName);
  return true;
}

function usesRemoteAi(): boolean {
  return SIMPLE_NETWORK_MODE && !REMOTE_AI_DISABLED && (!IS_VITE_DEV || REMOTE_AI_EXPLICIT);
}

async function serverJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${REMOTE_AI_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Server request failed with ${response.status}`);
    }
    if (!contentType.includes("application/json")) {
      throw new Error(`Server returned ${contentType || "non-JSON"} instead of JSON.`);
    }
    return response.json() as Promise<T>;
  } finally {
    window.clearTimeout(timeout);
  }
}

function uploadedGameIds(): Set<string> {
  try {
    const parsed = JSON.parse(safeLocalStorageGet(SERVER_UPLOAD_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function markGameUploaded(gameId: string): void {
  const ids = uploadedGameIds();
  ids.add(gameId);
  safeLocalStorageSet(SERVER_UPLOAD_KEY, JSON.stringify([...ids]));
}

function uploadCompletedGame(gameId: string): void {
  if (!usesRemoteAi() || uploadedGameIds().has(gameId)) return;
  const store = loadAnalytics();
  const events = store.events.filter((event) => event.gameId === gameId).map((event) => tagPhoneRecord(event));
  if (!events.length) return;
  const endEvent = events.find((event) => event.type === "game" && event.action === "end");
  void serverJson("/api/games", {
    gameId,
    tag: currentSessionTag() || null,
    appVersion: __APP_VERSION__,
    model: SIMPLE_NETWORK_OPPONENT,
    finalResult: endEvent ?? null,
    snapshot: currentSnapshot?.gameId === gameId ? currentSnapshot : null,
    events,
  }).then(() => {
    markGameUploaded(gameId);
  }).catch((error) => {
    console.warn("Completed game upload failed", error);
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readPhoneStore<T>(db: IDBDatabase | null, storeName: string): Promise<T[]> {
  if (!db || !db.objectStoreNames.contains(storeName)) return [];
  const transaction = db.transaction(storeName, "readonly");
  return idbRequest<T[]>(transaction.objectStore(storeName).getAll());
}

async function exportPhoneGameLog(): Promise<void> {
  const db = await openPhoneGameDb();
  const store = loadAnalytics();
  const [indexedDbGames, indexedDbEvents] = await Promise.all([
    readPhoneStore<Record<string, unknown>>(db, "games"),
    readPhoneStore<AnalyticsEvent>(db, "events"),
  ]);
  const eventsById = new Map<string, AnalyticsEvent>();
  for (const event of store.events) eventsById.set(event.id, event);
  for (const event of indexedDbEvents) eventsById.set(event.id, event);
  const events = [...eventsById.values()].sort((a, b) => a.at.localeCompare(b.at));
  const exportRecord = {
    schemaVersion: 1,
    source: "phone",
    sessionTag: currentSessionTag() || null,
    tags: currentSessionTag() ? [currentSessionTag()] : [],
    exportedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    analyticsKey: ANALYTICS_KEY,
    indexedDbName: PHONE_GAME_DB_NAME,
    games: indexedDbGames,
    events,
  };
  const blob = new Blob([`${JSON.stringify(exportRecord, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cribbage-phone-games-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function syncAnalytics(events: AnalyticsEvent[]): void {
  if (!events.length) return;
  const store = loadAnalytics();
  const known = new Set(store.events.map((event) => event.id));
  const newEvents: AnalyticsEvent[] = [];
  for (const event of events) {
    if (!known.has(event.id)) {
      const taggedEvent = tagPhoneRecord(event);
      store.events.push(taggedEvent);
      known.add(event.id);
      newEvents.push(taggedEvent);
    }
  }
  store.events.sort((a, b) => a.at.localeCompare(b.at));
  saveAnalytics(store);
  persistPhoneGameEvents(newEvents);
  for (const event of newEvents) {
    if (event.type === "game" && event.action === "end") uploadCompletedGame(event.gameId);
  }
}

function markAppReady(): void {
  document.body.dataset.ready = "true";
}

function buildBoard(): void {
  els.board.innerHTML = "";
  for (const player of ["human", "ai"] as const) {
    const lane = document.createElement("div");
    lane.className = `lane ${player}`;

    const label = document.createElement("div");
    label.className = "lane-label";
    label.textContent = player === "human" ? "User" : "AI";
    lane.append(label);

    const track = document.createElement("div");
    track.className = "track";

    track.append(holeElement("start-back", true, 1, 1));
    track.append(holeElement("start-front", true, 2, 1));
    for (let i = 1; i <= 60; i += 1) track.append(holeElement(i, false, outboundColumn(i), 1));
    for (let i = 61; i <= 120; i += 1) track.append(holeElement(i, false, returnColumn(i), 2));
    track.append(holeElement(121, false, 2, 2));
    track.append(paceSvg());

    lane.append(track);
    els.board.append(lane);
  }
}

function outboundColumn(holeNumber: number): number {
  return 3 + holeNumber + Math.floor((holeNumber - 1) / 5);
}

function returnColumn(holeNumber: number): number {
  const hole60Column = outboundColumn(60);
  const offset = holeNumber - 61;
  return hole60Column - offset - Math.floor(offset / 5);
}

function holeElement(position: number | string, start: boolean, column: number, row: number): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "hole-wrap";
  wrap.dataset.position = String(position);
  wrap.dataset.row = String(row);
  wrap.style.gridColumn = String(column);
  wrap.style.gridRow = String(row);

  const hole = document.createElement("span");
  hole.className = "hole";
  hole.dataset.position = String(position);
  if (start) hole.classList.add("start");
  if (!start && Number(position) % 5 === 0 && Number(position) !== 120) wrap.classList.add("group-end");
  if (Number(position) === 121) hole.classList.add("finish");
  wrap.append(hole);

  if (!start && Number(position) % 5 === 0 && Number(position) !== 120) {
    const label = document.createElement("span");
    label.className = "hole-number";
    label.textContent = String(position);
    wrap.append(label);
  }

  return wrap;
}

function paceSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("pace-lines");
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

function fallbackPegPositions(scores: GameState["scores"]): GameState["pegPositions"] {
  return {
    human: ["start-front", Math.min(scores.human, 121)],
    ai: ["start-front", Math.min(scores.ai, 121)],
  };
}

function renderBoard(
  scores: GameState["scores"],
  pegPositions: GameState["pegPositions"] = fallbackPegPositions(scores),
  firstDealer: string | null = null,
  phase: GameState["phase"] = "discard",
  handNumber = 1,
): void {
  const fallback = fallbackPegPositions(scores);
  const firstDealerPlayer = firstDealer === "User" ? "human" : "ai";
  const completedHands = completedHandCount(phase, handNumber);
  const showParGuides = state.parGuides;
  const projections = showParGuides ? projectedCourse(scores, firstDealerPlayer, completedHands) : {
    human: new Map<string, { hand: number; score: number }>(),
    ai: new Map<string, { hand: number; score: number }>(),
  };
  for (const lane of els.board.querySelectorAll(".lane")) {
    const player = lane.classList.contains("human") ? "human" : "ai";
    const positions = pegPositions[player] || fallback[player];
    const projectedPositions = projections[player];
    for (const hole of lane.querySelectorAll<HTMLElement>(".hole")) {
      const wrap = hole.closest<HTMLElement>(".hole-wrap");
      if (!wrap) continue;
      hole.classList.remove("peg", "back-peg", "front-peg");
      wrap.classList.remove(
        "expected-human",
        "expected-ai",
        "expected-ahead",
        "expected-behind",
        "ringed",
        "ring-short",
        "ring-long",
      );
      wrap.removeAttribute("title");
      if (showParGuides) applyRingMarker(wrap, Number(hole.dataset.position), player, firstDealerPlayer);
      const projection = projectedPositions.get(hole.dataset.position || "");
      if (projection) {
        wrap.classList.add(paceStatus(Number(hole.dataset.position), parHolesFor(player, firstDealerPlayer)[completedHands - 1 + projection.hand]));
        wrap.title = `${player === "human" ? "User" : "AI"} expected after hand ${projection.hand}: ${projection.score.toFixed(1)}`;
      }
      if (String(positions[0]) === hole.dataset.position) hole.classList.add("peg", "back-peg");
      if (String(positions[1]) === hole.dataset.position) hole.classList.add("peg", "front-peg");
    }
  }
  requestAnimationFrame(() => {
    if (showParGuides) renderPaceLines(pegPositions, projections, firstDealerPlayer, completedHands);
    else clearPaceLines();
  });
}

function clearPaceLines(): void {
  for (const svg of els.board.querySelectorAll<SVGSVGElement>(".pace-lines")) svg.replaceChildren();
}

function applyRingMarker(
  wrap: HTMLElement,
  position: number,
  player: "human" | "ai",
  firstDealerPlayer: "human" | "ai",
): void {
  if (!Number.isFinite(position)) return;
  const parHoles = parHolesFor(player, firstDealerPlayer);
  const index = parHoles.indexOf(position);
  if (index === -1 || index === parHoles.length - 1) return;
  wrap.classList.add("ringed");
  const nextHole = parHoles[index + 1];
  wrap.classList.add(nextHole - position <= 12 ? "ring-short" : "ring-long");
}

function renderPaceLines(
  pegPositions: GameState["pegPositions"],
  projections: Record<"human" | "ai", Map<string, { hand: number; score: number }>>,
  firstDealerPlayer: "human" | "ai",
  completedHands: number,
): void {
  for (const lane of els.board.querySelectorAll<HTMLElement>(".lane")) {
    const player = lane.classList.contains("human") ? "human" : "ai";
    const track = lane.querySelector<HTMLElement>(".track");
    const svg = lane.querySelector<SVGSVGElement>(".pace-lines");
    if (!track || !svg) continue;
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${track.clientWidth} ${track.clientHeight}`);
    const parHoles = parHolesFor(player, firstDealerPlayer);
    const currentParIndex = completedHands - 1;
    let lineIndex = 0;
    if (currentParIndex >= 0) {
      addPaceLine(
        svg,
        track,
        pegPositions[player]?.[1],
        parHoles[currentParIndex],
        player,
        lineSide(lineIndex),
        completedHands,
        paceStatus(Number(pegPositions[player]?.[1]), parHoles[currentParIndex]),
      );
      lineIndex += 1;
    }
    for (const [hole, projection] of projections[player]) {
      const parHole = parHoles[currentParIndex + projection.hand];
      if (parHole) {
        addPaceLine(
          svg,
          track,
          parHole,
          hole,
          player,
          lineSide(lineIndex),
          completedHands + projection.hand,
          paceStatus(Number(hole), parHole),
        );
        lineIndex += 1;
      }
    }
  }
}

function lineSide(index: number): "outside" | "inside" {
  return index % 2 === 0 ? "outside" : "inside";
}

type LinePoint = { x: number; y: number };
type PaceStatus = "expected-ahead" | "expected-behind";

function paceStatus(position: number, parPosition: number | undefined): PaceStatus {
  return Number.isFinite(position) && parPosition !== undefined && position >= parPosition
    ? "expected-ahead"
    : "expected-behind";
}

function addPaceLine(
  svg: SVGSVGElement,
  track: HTMLElement,
  fromPosition: number | string | undefined,
  toPosition: number | string | undefined,
  player: "human" | "ai",
  side: "outside" | "inside",
  label: number,
  status: PaceStatus,
): void {
  if (fromPosition === undefined || toPosition === undefined) return;
  const start = holeLinePoint(track, fromPosition, side);
  const end = holeLinePoint(track, toPosition, side);
  if (!start || !end) return;

  const points: LinePoint[] = [{ x: start.x, y: start.y }];
  if (start.row === end.row) {
    points.push({ x: end.x, y: end.y });
  } else {
    const turnX = uTurnLineX(track);
    points.push({ x: turnX, y: start.y }, { x: turnX, y: end.y }, { x: end.x, y: end.y });
  }

  const totalLength = polylineLength(points);
  const labelGap = Math.min(16, Math.max(10, totalLength * 0.34));
  const labelCenter = pointAtPolylineDistance(points, totalLength / 2);
  const gapStart = Math.max(0, totalLength / 2 - labelGap / 2);
  const gapEnd = Math.min(totalLength, totalLength / 2 + labelGap / 2);
  appendPacePath(svg, status, subPolyline(points, 0, gapStart));
  appendPacePath(svg, status, subPolyline(points, gapEnd, totalLength));

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.classList.add("pace-label", `pace-label-${player}`);
  text.textContent = String(label);
  text.setAttribute("x", labelCenter.x.toFixed(2));
  text.setAttribute("y", labelCenter.y.toFixed(2));
  text.setAttribute("text-anchor", "middle");
  svg.append(text);
}

function appendPacePath(svg: SVGSVGElement, status: PaceStatus, points: LinePoint[]): void {
  if (points.length < 2) return;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData(points));
  path.classList.add("pace-line", status);
  svg.append(path);
}

function pathData(points: LinePoint[]): string {
  const [first, ...rest] = points;
  return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${rest
    .map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ")}`;
}

function subPolyline(points: LinePoint[], fromDistance: number, toDistance: number): LinePoint[] {
  if (toDistance <= fromDistance) return [];
  const result = [pointAtPolylineDistance(points, fromDistance)];
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = pointDistance(previous, current);
    const segmentStart = walked;
    const segmentEnd = walked + length;
    if (segmentEnd > fromDistance && segmentEnd < toDistance) result.push(current);
    walked = segmentEnd;
  }
  result.push(pointAtPolylineDistance(points, toDistance));
  return result;
}

function pointAtPolylineDistance(points: LinePoint[], targetDistance: number): LinePoint {
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = pointDistance(previous, current);
    if (walked + length >= targetDistance) {
      const ratio = length === 0 ? 0 : (targetDistance - walked) / length;
      return {
        x: previous.x + (current.x - previous.x) * ratio,
        y: previous.y + (current.y - previous.y) * ratio,
      };
    }
    walked += length;
  }
  return points[points.length - 1];
}

function polylineLength(points: LinePoint[]): number {
  return points.reduce((total, point, index) => (
    index === 0 ? 0 : total + pointDistance(points[index - 1], point)
  ), 0);
}

function pointDistance(a: LinePoint, b: LinePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function holeLinePoint(
  track: HTMLElement,
  position: number | string,
  side: "outside" | "inside",
): { x: number; y: number; row: 1 | 2 } | null {
  const wrap = track.querySelector<HTMLElement>(`.hole-wrap[data-position="${position}"]`);
  if (!wrap) return null;
  const trackRect = track.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const row = wrap.dataset.row === "2" ? 2 : 1;
  const centerY = wrapRect.top - trackRect.top + 2;
  const tangentOffset = 5;
  const outside = row === 1 ? centerY - tangentOffset : centerY + tangentOffset;
  const inside = row === 1 ? centerY + tangentOffset : centerY - tangentOffset;
  const y = side === "outside" ? outside : inside;
  return {
    x: wrapRect.left - trackRect.left + wrapRect.width / 2,
    y,
    row,
  };
}

function uTurnLineX(track: HTMLElement): number {
  const wrap60 = track.querySelector<HTMLElement>('.hole-wrap[data-position="60"]');
  if (!wrap60) return track.clientWidth;
  const trackRect = track.getBoundingClientRect();
  const wrapRect = wrap60.getBoundingClientRect();
  return wrapRect.left - trackRect.left + wrapRect.width / 2 + 5;
}

function completedHandCount(phase: GameState["phase"], handNumber: number): number {
  if (["pegging_complete", "score_pone", "score_dealer", "score_crib", "game_over"].includes(phase)) {
    return handNumber;
  }
  return Math.max(0, handNumber - 1);
}

function parHolesFor(player: "human" | "ai", firstDealerPlayer: "human" | "ai"): number[] {
  const holes: number[] = [player === firstDealerPlayer ? 7 : 17];
  let par = holes[0];
  for (let hand = 2; hand <= 16 && par < 121; hand += 1) {
    par += roleForHand(player, firstDealerPlayer, hand) === "dealer"
      ? GRANULAR_PARS.dealer.total
      : GRANULAR_PARS.pone.total;
    holes.push(Math.min(121, Math.max(1, Math.round(par))));
  }
  if (holes[holes.length - 1] !== 121) holes.push(121);
  return [...new Set(holes)];
}

function projectedCourse(
  scores: GameState["scores"],
  firstDealerPlayer: "human" | "ai",
  completedHands: number,
): Record<"human" | "ai", Map<string, { hand: number; score: number }>> {
  const result = {
    human: new Map<string, { hand: number; score: number }>(),
    ai: new Map<string, { hand: number; score: number }>(),
  };
  if (completedHands <= 0) return result;
  const projections = {
    human: projectedPlayerCourse("human", scores.human, firstDealerPlayer, completedHands),
    ai: projectedPlayerCourse("ai", scores.ai, firstDealerPlayer, completedHands),
  };
  const winningHand = Math.min(
    ...Object.values(projections)
      .flat()
      .filter((projection) => projection.score >= 121)
      .map((projection) => projection.hand),
    Number.POSITIVE_INFINITY,
  );
  for (const player of ["human", "ai"] as const) {
    for (const projection of projections[player]) {
      if (projection.hand > winningHand) continue;
      result[player].set(String(projection.position), { hand: projection.hand, score: projection.score });
    }
  }
  return result;
}

function projectedPlayerCourse(
  player: "human" | "ai",
  score: number,
  firstDealerPlayer: "human" | "ai",
  completedHands: number,
): Array<{ hand: number; position: number; score: number }> {
  const result: Array<{ hand: number; position: number; score: number }> = [];
  const parHoles = parHolesFor(player, firstDealerPlayer);
  const currentParIndex = completedHands - 1;
  const currentPar = parHoles[currentParIndex];
  if (!currentPar) return result;
  const offset = score - currentPar;
  for (let index = currentParIndex + 1; index < parHoles.length; index += 1) {
    const projectedScore = Math.min(121, Math.max(1, parHoles[index] + offset));
    result.push({
      hand: index - currentParIndex,
      position: Math.min(121, Math.max(1, Math.round(projectedScore))),
      score: projectedScore,
    });
  }
  return result;
}

function dealerForHand(firstDealerPlayer: "human" | "ai", handNumber: number): "human" | "ai" {
  const oddHand = handNumber % 2 === 1;
  return oddHand ? firstDealerPlayer : firstDealerPlayer === "human" ? "ai" : "human";
}

function winProbabilityPhaseForGame(game: GameState): ScorePhase {
  if (game.phase === "score_pone") return "handPone";
  if (game.phase === "score_dealer") return "handDealer";
  if (game.phase === "score_crib") return "crib";
  return "peggingPone";
}

function approximateDisplayWinProbability(myScore: number, opponentScore: number): number {
  return Math.max(0.01, Math.min(0.99, 0.5 + ((myScore - opponentScore) / 90)));
}

function renderScorePace(game: GameState): void {
  const firstDealerPlayer = game.firstDealer === "User" ? "human" : "ai";
  void winProbabilityPhaseForGame(game);
  for (const player of ["human", "ai"] as const) {
    const pace = player === "human" ? els.humanPace : els.aiPace;
    const final = player === "human" ? els.humanFinal : els.aiFinal;
    if (!state.parGuides) {
      pace.replaceChildren();
      pace.classList.remove("ahead", "behind");
      final.textContent = "";
      final.classList.remove("expected-win");
      continue;
    }
    const targetHole = Math.round(cumulativeParThroughHand(player, firstDealerPlayer, game.handNumber));
    const score = game.scores[player];
    const delta = score - targetHole;
    pace.classList.toggle("ahead", delta >= 0);
    pace.classList.toggle("behind", delta < 0);
    pace.replaceChildren();
    const parLine = document.createElement("span");
    parLine.textContent = `${delta >= 0 ? "+" : ""}${delta} Par ${targetHole}`;
    const opponent = player === "human" ? "ai" : "human";
    const role = roleForHand(player, firstDealerPlayer, game.handNumber);
    void role;
    const winProbability = approximateDisplayWinProbability(game.scores[player], game.scores[opponent]);
    const winDelta = winProbability - 0.5;
    const winLine = document.createElement("span");
    winLine.className = `score-win-prob ${winDelta >= 0 ? "ahead" : "behind"}`;
    winLine.textContent = `WP ${(winProbability * 100).toFixed(1)}% (${winDelta >= 0 ? "+" : ""}${(winDelta * 100).toFixed(1)})`;
    pace.append(parLine, winLine);
    final.textContent = "";
    final.classList.remove("expected-win");
  }
}

interface GranularParState {
  par: Record<"human" | "ai", number>;
  next: number;
}

interface OutProjection {
  player: "human" | "ai";
  beforeScores: Record<"human" | "ai", number>;
  label: string;
  component: ParComponent;
  pone: "human" | "ai";
}

type ParComponent = "ponePeg" | "dealerPeg" | "poneHand" | "dealerHand" | "crib";

function granularParState(game: GameState, firstDealerPlayer: "human" | "ai"): GranularParState {
  const completedFullHands = Math.max(0, game.handNumber - 1);
  const par = {
    human: cumulativeParThroughHand("human", firstDealerPlayer, completedFullHands),
    ai: cumulativeParThroughHand("ai", firstDealerPlayer, completedFullHands),
  };
  const completedCurrent = completedComponentsForPhase(game.phase);
  for (let index = 0; index < completedCurrent; index += 1) {
    applyParComponent(par, componentForHand(firstDealerPlayer, game.handNumber, index));
  }
  return { par, next: completedCurrent };
}

function cumulativeParThroughHand(
  player: "human" | "ai",
  firstDealerPlayer: "human" | "ai",
  handNumber: number,
): number {
  if (handNumber <= 0) return 0;
  return parHolesFor(player, firstDealerPlayer)[handNumber - 1] ?? 121;
}

function completedComponentsForPhase(phase: GameState["phase"]): number {
  if (phase === "discard" || phase === "ai_discarding") return 0;
  if (phase === "pegging" || phase === "pegging_complete") return 2;
  if (phase === "score_pone") return 3;
  if (phase === "score_dealer") return 4;
  return 5;
}

function roleForHand(
  player: "human" | "ai",
  firstDealerPlayer: "human" | "ai",
  handNumber: number,
): "dealer" | "pone" {
  return player === dealerForHand(firstDealerPlayer, handNumber) ? "dealer" : "pone";
}

function componentForHand(
  firstDealerPlayer: "human" | "ai",
  handNumber: number,
  index: number,
): { player: "human" | "ai"; component: ParComponent; amount: number; label: string; pone: "human" | "ai" } {
  const rawComponents = rawComponentsForHand(firstDealerPlayer, handNumber);
  const components = rawComponents.map((component) => ({
    ...component,
    amount: scaledParComponentAmount(component.player, firstDealerPlayer, handNumber, component.amount),
  }));
  return components[index] ?? components[components.length - 1];
}

function forecastComponentForHand(
  firstDealerPlayer: "human" | "ai",
  handNumber: number,
  index: number,
): { player: "human" | "ai"; component: ParComponent; amount: number; label: string; pone: "human" | "ai" } {
  const components = rawComponentsForHand(firstDealerPlayer, handNumber);
  return components[index] ?? components[components.length - 1];
}

function rawComponentsForHand(
  firstDealerPlayer: "human" | "ai",
  handNumber: number,
): Array<{ player: "human" | "ai"; component: ParComponent; amount: number; label: string; pone: "human" | "ai" }> {
  const dealer = dealerForHand(firstDealerPlayer, handNumber);
  const pone = dealer === "human" ? "ai" : "human";
  return [
    { player: pone, component: "ponePeg", amount: GRANULAR_PARS.pone.pegging, label: "pone peg", pone },
    { player: dealer, component: "dealerPeg", amount: GRANULAR_PARS.dealer.pegging, label: "dealer peg", pone },
    { player: pone, component: "poneHand", amount: GRANULAR_PARS.pone.hand, label: "pone hand", pone },
    { player: dealer, component: "dealerHand", amount: GRANULAR_PARS.dealer.hand, label: "dealer hand", pone },
    { player: dealer, component: "crib", amount: GRANULAR_PARS.dealer.crib, label: "crib", pone },
  ];
}

function scaledParComponentAmount(
  player: "human" | "ai",
  firstDealerPlayer: "human" | "ai",
  handNumber: number,
  rawAmount: number,
): number {
  const previousPar = cumulativeParThroughHand(player, firstDealerPlayer, handNumber - 1);
  const nextPar = cumulativeParThroughHand(player, firstDealerPlayer, handNumber);
  const roleTotal = roleForHand(player, firstDealerPlayer, handNumber) === "dealer"
    ? GRANULAR_PARS.dealer.total
    : GRANULAR_PARS.pone.total;
  const handDelta = Math.max(0, nextPar - previousPar);
  return roleTotal > 0 ? (rawAmount / roleTotal) * handDelta : 0;
}

function applyParComponent(
  par: Record<"human" | "ai", number>,
  component: { player: "human" | "ai"; amount: number },
): void {
  par[component.player] += component.amount;
}

function projectedOutMoment(
  game: GameState,
  firstDealerPlayer: "human" | "ai",
  parState: GranularParState,
): OutProjection | null {
  let handNumber = game.handNumber;
  let componentIndex = parState.next;
  const forecastParState = granularForecastParState(game, firstDealerPlayer);
  const projected = { ...game.scores };
  const currentPar = { ...forecastParState.par };
  const offsets = {
    human: game.scores.human - currentPar.human,
    ai: game.scores.ai - currentPar.ai,
  };
  for (let guard = 0; guard < 160; guard += 1) {
    if (componentIndex >= 5) {
      handNumber += 1;
      componentIndex = 0;
    }
    const component = forecastComponentForHand(firstDealerPlayer, handNumber, componentIndex);
    const alreadyOut = (["human", "ai"] as const).find((player) => projected[player] >= 121);
    if (alreadyOut) {
      return {
        player: alreadyOut,
        beforeScores: { ...projected },
        label: component.label,
        component: component.component,
        pone: component.pone,
      };
    }
    const beforeScores = { ...projected };
    currentPar[component.player] += component.amount;
    projected[component.player] = Math.min(121, currentPar[component.player] + offsets[component.player]);
    if (projected[component.player] >= 121) {
      return {
        player: component.player,
        beforeScores,
        label: component.label,
        component: component.component,
        pone: component.pone,
      };
    }
    componentIndex += 1;
  }
  return null;
}

function relativeOutLabel(viewer: "human" | "ai", projection: OutProjection): string {
  const kind = projection.component === "crib"
    ? "crib"
    : projection.component === "poneHand" || projection.component === "dealerHand"
      ? "hand"
      : "peg";
  return `${viewer === projection.player ? "own" : "opponent"} ${kind}`;
}

function granularForecastParState(game: GameState, firstDealerPlayer: "human" | "ai"): GranularParState {
  const completedFullHands = Math.max(0, game.handNumber - 1);
  const par = {
    human: cumulativeForecastParThroughHand("human", firstDealerPlayer, completedFullHands),
    ai: cumulativeForecastParThroughHand("ai", firstDealerPlayer, completedFullHands),
  };
  const completedCurrent = completedComponentsForPhase(game.phase);
  for (let index = 0; index < completedCurrent; index += 1) {
    applyParComponent(par, forecastComponentForHand(firstDealerPlayer, game.handNumber, index));
  }
  return { par, next: completedCurrent };
}

function cumulativeForecastParThroughHand(
  player: "human" | "ai",
  firstDealerPlayer: "human" | "ai",
  handNumber: number,
): number {
  if (handNumber <= 0) return 0;
  let par = player === firstDealerPlayer ? 7 : 17;
  for (let hand = 2; hand <= handNumber; hand += 1) {
    par += roleForHand(player, firstDealerPlayer, hand) === "dealer"
      ? GRANULAR_PARS.dealer.total
      : GRANULAR_PARS.pone.total;
  }
  return par;
}

async function ensureOpponentResources(opponent: Opponent): Promise<void> {
  void opponent;
}

interface ServerGameActionResponse {
  state: GameState;
  snapshot: GameSnapshot;
}

interface AiDiscardPreparationResult {
  cardIds: number[];
  bestLead: number | null;
}

interface ServerAiDiscardPreparationResponse extends ServerGameActionResponse {
  recommendation: {
    cardIds: number[];
    bestLead: number | null;
  };
}

interface ServerCutForDealPreparationResponse extends ServerGameActionResponse {
  recommendation?: {
    cardIds: number[];
    bestLead: number | null;
  } | null;
}

async function serverGameAction(action: string, payload: Record<string, unknown> | null = null): Promise<GameState> {
  const response = await serverJson<ServerGameActionResponse>("/api/game/action", {
    action,
    payload: payload ?? {},
    snapshot: currentSnapshot,
    tag: currentSessionTag() || null,
  });
  currentSnapshot = response.snapshot;
  state.game = response.state;
  saveGame();
  startCutForDealPreparation(response.state);
  startAiDiscardPreparation(response.state);
  startNextHandPreparation(response.state);
  return response.state;
}

function cutForDealPreparationKey(game: GameState): string | null {
  if (!currentSnapshot || game.phase !== "cut_for_deal") return null;
  return `${currentSnapshot.gameId ?? "game"}:${currentSnapshot.cutDeck?.join(",") ?? ""}`;
}

function storePreparedAiDiscard(game: GameState, recommendation?: AiDiscardPreparationResult | null): void {
  if (!recommendation) return;
  const key = aiDiscardPreparationKey(game);
  if (!key) return;
  state.aiDiscardPreparation = {
    key,
    promise: Promise.resolve({
      cardIds: recommendation.cardIds,
      bestLead: recommendation.bestLead,
    }),
  };
}

function startCutForDealPreparation(game: GameState): void {
  const key = cutForDealPreparationKey(game);
  if (!key) return;
  if (state.cutForDealPreparation?.key === key) return;
  const snapshot = currentSnapshot;
  if (!snapshot) return;
  const promise = serverJson<ServerCutForDealPreparationResponse>("/api/game/action", {
    action: "prepare-cut-for-deal",
    payload: {},
    snapshot,
    tag: currentSessionTag() || null,
  });
  void promise.catch(() => {
    if (state.cutForDealPreparation?.key === key) state.cutForDealPreparation = null;
  });
  state.cutForDealPreparation = { key, promise };
}

function preparedCutForDealFor(game: GameState | null): Promise<ServerCutForDealPreparationResponse> | null {
  if (!game) return null;
  const key = cutForDealPreparationKey(game);
  return key && state.cutForDealPreparation?.key === key ? state.cutForDealPreparation.promise : null;
}

function applyPreparedCutForDeal(response: ServerCutForDealPreparationResponse): GameState {
  currentSnapshot = response.snapshot;
  state.game = response.state;
  saveGame();
  state.cutForDealPreparation = null;
  storePreparedAiDiscard(response.state, response.recommendation ?? null);
  if (response.state.phase === "cut_for_deal") startCutForDealPreparation(response.state);
  return response.state;
}

function aiDiscardPreparationKey(game: GameState): string | null {
  if (!currentSnapshot || game.phase !== "discard" || game.aiHandCount !== 6) return null;
  return `${currentSnapshot.gameId ?? "game"}:${game.handNumber}:${game.dealer}`;
}

function startAiDiscardPreparation(game: GameState): void {
  const key = aiDiscardPreparationKey(game);
  if (!key) return;
  if (state.aiDiscardPreparation?.key === key) return;
  const snapshot = currentSnapshot;
  if (!snapshot) return;
  const promise = serverJson<ServerAiDiscardPreparationResponse>("/api/game/action", {
    action: "prepare-ai-discard",
    payload: {},
    snapshot,
    tag: currentSessionTag() || null,
  }).then((response) => ({
    cardIds: response.recommendation.cardIds,
    bestLead: response.recommendation.bestLead,
  }));
  void promise.catch(() => {});
  state.aiDiscardPreparation = { key, promise };
}

function preparedAiDiscardFor(game: GameState | null): Promise<AiDiscardPreparationResult> | null {
  if (!game || !currentSnapshot) return null;
  const key = `${currentSnapshot.gameId ?? "game"}:${game.handNumber}:${game.dealer}`;
  return state.aiDiscardPreparation?.key === key ? state.aiDiscardPreparation.promise : null;
}

function nextHandPreparationKey(game: GameState): string | null {
  if (
    !currentSnapshot ||
    !game.scoring ||
    !["score_pone", "score_dealer", "score_crib"].includes(game.phase)
  ) {
    return null;
  }
  return `${currentSnapshot.gameId ?? "game"}:${game.handNumber}:next`;
}

function startNextHandPreparation(game: GameState): void {
  const key = nextHandPreparationKey(game);
  if (!key) return;
  if (state.nextHandPreparation?.key === key) return;
  if (failedNextHandPreparationKeys.has(key)) return;
  const snapshot = currentSnapshot;
  if (!snapshot) return;
  const promise = serverJson<ServerAiDiscardPreparationResponse>("/api/game/action", {
    action: "prepare-next-hand-ai-discard",
    payload: {},
    snapshot,
    tag: currentSessionTag() || null,
  });
  void promise.catch(() => {
    failedNextHandPreparationKeys.add(key);
    if (state.nextHandPreparation?.key === key) state.nextHandPreparation = null;
  });
  state.nextHandPreparation = { key, promise };
}

function preparedNextHandFor(game: GameState | null): Promise<ServerAiDiscardPreparationResponse> | null {
  if (!game || game.phase !== "score_crib" || game.scoring?.stage !== "crib") return null;
  const key = nextHandPreparationKey(game);
  return key && state.nextHandPreparation?.key === key ? state.nextHandPreparation.promise : null;
}

function applyPreparedNextHand(response: ServerAiDiscardPreparationResponse): GameState {
  currentSnapshot = response.snapshot;
  state.game = response.state;
  saveGame();
  storePreparedAiDiscard(response.state, response.recommendation);
  state.nextHandPreparation = null;
  failedNextHandPreparationKeys.delete(nextHandPreparationKey(response.state) ?? "");
  return response.state;
}

async function api(path: string, body: Record<string, unknown> | null = null): Promise<GameState> {
  try {
    if (path === "/api/state") {
      if (state.game) return state.game;
      return serverGameAction("new", { opponent: SIMPLE_NETWORK_MODE ? SIMPLE_NETWORK_OPPONENT : DEFAULT_OPPONENT });
    }
    if (path === "/api/new") {
      const opponent = SIMPLE_NETWORK_MODE
        ? SIMPLE_NETWORK_OPPONENT
        : (body?.opponent as Opponent) || DEFAULT_OPPONENT;
      return serverGameAction("new", { opponent });
    }
    if (path === "/api/cut-for-deal") {
      return serverGameAction("cut-for-deal");
    }
    if (path === "/api/trouble-game") {
      return serverGameAction("trouble-game");
    }
    if (path === "/api/discard") {
      return serverGameAction("discard", { ids: (body?.ids as number[]) || [] });
    }
    if (path === "/api/finish-discard") {
      return serverGameAction("finish-discard");
    }
    if (path === "/api/finish-discard-with-cards") {
      return serverGameAction("finish-discard-with-cards", {
        ids: (body?.ids as number[]) || [],
        bestLead: typeof body?.bestLead === "number" ? body.bestLead : null,
      });
    }
    if (path === "/api/play") {
      return serverGameAction("play", { id: body?.id as number });
    }
    if (path === "/api/play-human") {
      return serverGameAction("play-human", { id: body?.id as number });
    }
    if (path === "/api/go") {
      return serverGameAction("go");
    }
    if (path === "/api/go-human") {
      return serverGameAction("go-human");
    }
    if (path === "/api/advance-pegging") {
      return serverGameAction("advance-pegging");
    }
    if (path === "/api/acknowledge-pegging-reset") {
      return serverGameAction("acknowledge-pegging-reset");
    }
    if (path === "/api/complete-decision-reviews") {
      return serverGameAction("complete-decision-reviews");
    }
    if (path === "/api/prepare-next-hand-ai-discard") {
      const response = await serverJson<ServerAiDiscardPreparationResponse>("/api/game/action", {
        action: "prepare-next-hand-ai-discard",
        payload: {},
        snapshot: currentSnapshot,
        tag: currentSessionTag() || null,
      });
      return applyPreparedNextHand(response);
    }
    if (path === "/api/continue-scoring") {
      return serverGameAction("continue-scoring");
    }
    throw new Error("Unknown local action.");
  } catch (error) {
    render(state.game);
    throw error;
  }
}

function cardElement(card: GameState["humanHand"][number], options: { clickable?: boolean; disabled?: boolean } = {}): HTMLElement {
  const button = document.createElement(options.clickable ? "button" : "div");
  button.className = `card ${card.suit}`;
  button.dataset.index = String(card.index);
  button.dataset.id = String(card.id);
  if (card.owner) button.dataset.owner = card.owner;
  if (state.selected.has(card.id)) button.classList.add("selected");
  if (options.disabled && button instanceof HTMLButtonElement) button.disabled = true;
  if (options.clickable && button instanceof HTMLButtonElement) {
    button.type = "button";
    button.addEventListener("click", () => onCardClick(card));
  }
  button.innerHTML = `
    <span class="corner">
      <span>${card.rank}</span>
      <span>${card.symbol}</span>
    </span>
    <span class="rank">${card.rank}</span>
    <span class="suit">${card.symbol}</span>
  `;
  return button;
}

function cardBack(): HTMLElement {
  const card = document.createElement("div");
  card.className = "card back";
  return card;
}

function aiCardSlots(game: GameState): number {
  const needsStablePeggingSpace = game.phase === "pegging" || game.phase === "pegging_complete" || game.peggingResetPending;
  return needsStablePeggingSpace ? Math.max(4, game.aiHandCount) : game.aiHandCount;
}

function onCardClick(card: GameState["humanHand"][number]): void {
  if (state.pending) return;
  const game = state.game;
  if (!game) return;
  if (game.phase === "discard") {
    if (state.selected.has(card.id)) state.selected.delete(card.id);
    else if (state.selected.size < 2) state.selected.add(card.id);
    state.resultOverride = [];
    render(game);
    return;
  }
  if (game.phase === "pegging" && game.turn === "User") {
    if (!game.legalCardIds.includes(card.id)) return;
    if (state.selected.has(card.id)) state.selected.delete(card.id);
    else {
      state.selected.clear();
      state.selected.add(card.id);
    }
    render(game);
  }
}

function renderCards(container: HTMLElement, cards: GameState["humanHand"], options = {}): void {
  container.hidden = false;
  container.innerHTML = "";
  for (const card of cards) container.append(cardElement(card, options));
}

function renderPlayedCards(game: GameState): void {
  const activeCards = game.plays.length
    ? game.plays
    : game.peggingResetPending
      ? game.completedPlays.at(-1) ?? []
      : [];
  els.plays.innerHTML = "";
  els.plays.hidden = activeCards.length === 0;
  if (!activeCards.length) return;
  const active = document.createElement("div");
  active.className = "cards played-active pegging-row";
  for (const card of activeCards) active.append(cardElement(card));
  els.plays.append(active);
}

function cutCardText(card: NonNullable<GameState["cutForDeal"]>["human"]): string {
  return card ? `${card.rank}${card.symbol}` : "";
}

function appendCutDealerBadge(label: HTMLElement, game: GameState, player: "User" | "AI", showAiCut: boolean): void {
  if (!showAiCut || game.phase === "cut_for_deal" || game.dealer !== player) return;
  const badge = document.createElement("span");
  badge.className = "dealer-button cut-dealer-badge";
  badge.textContent = "Crib";
  label.append(badge);
}

function renderDealCut(game: GameState, revealStage: "human" | "ai" | null = null): void {
  els.plays.innerHTML = "";
  els.plays.hidden = false;
  const row = document.createElement("div");
  row.className = "cards played-active pegging-row deal-cut-row";
  const showHumanCut = Boolean(game.cutForDeal?.human && (!revealStage || revealStage === "human" || revealStage === "ai"));
  const showAiCut = Boolean(game.cutForDeal?.ai && (!revealStage || revealStage === "ai"));
  const deck = cardBack();
  deck.classList.add("cut-deck");
  deck.setAttribute("role", "button");
  deck.setAttribute("aria-label", state.dealCutResolve ? "Continue to deal" : "Cut deck for deal");
  deck.tabIndex = state.pending ? -1 : 0;
  deck.addEventListener("click", () => {
    if (state.dealCutResolve) {
      completeDealCutReveal();
      return;
    }
    void cutForDeal();
  });
  deck.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (state.dealCutResolve) {
      completeDealCutReveal();
      return;
    }
    void cutForDeal();
  });
  const humanSlot = document.createElement("div");
  humanSlot.className = "cut-slot cut-slot-human";
  if (showHumanCut && game.cutForDeal?.human) {
    const human = document.createElement("div");
    human.className = "cut-result cut-result-human cut-card-reveal";
    const label = document.createElement("span");
    label.textContent = "User";
    appendCutDealerBadge(label, game, "User", showAiCut);
    human.append(label, cardElement(game.cutForDeal.human));
    humanSlot.append(human);
  }
  const aiSlot = document.createElement("div");
  aiSlot.className = "cut-slot cut-slot-ai";
  if (showAiCut && game.cutForDeal?.ai) {
    const ai = document.createElement("div");
    ai.className = "cut-result cut-result-ai cut-card-reveal";
    const label = document.createElement("span");
    label.textContent = "AI";
    appendCutDealerBadge(label, game, "AI", showAiCut);
    ai.append(label, cardElement(game.cutForDeal.ai));
    aiSlot.append(ai);
  }
  row.append(humanSlot, deck, aiSlot);
  els.plays.append(row);
}

function completeTurnCutInteraction(): void {
  const resolve = state.turnCutResolve;
  if (!resolve) return;
  state.turnCutResolve = null;
  const wasConfirmingCut = state.turnCutRevealStage === "revealed";
  if (wasConfirmingCut) {
    state.turnCutRevealStage = null;
    state.resultOverride = ["Waiting for AI to play."];
    setAiThinking(true);
    render(state.game);
  }
  resolve();
}

function renderTurnCut(game: GameState): void {
  els.plays.innerHTML = "";
  els.plays.hidden = false;
  const row = document.createElement("div");
  row.className = "cards played-active pegging-row turn-cut-row";
  const emptySlot = document.createElement("div");
  emptySlot.className = "cut-slot cut-slot-human";
  const cutSlot = document.createElement("div");
  cutSlot.className = "cut-slot cut-slot-ai";
  const deck = cardBack();
  deck.classList.add("turn-cut-deck");
  const userCanAct = state.turnCutRevealStage === "user-cut" ||
    state.turnCutRevealStage === "user-turn" ||
    state.turnCutRevealStage === "revealed";
  if (userCanAct) {
    deck.setAttribute("role", "button");
    deck.tabIndex = 0;
    deck.setAttribute(
      "aria-label",
      state.turnCutRevealStage === "revealed"
        ? "Continue to pegging"
        : state.turnCutRevealStage === "user-cut"
          ? "Cut deck"
          : "Turn cut card",
    );
    deck.addEventListener("click", completeTurnCutInteraction);
    deck.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      completeTurnCutInteraction();
    });
  }
  const label = document.createElement("div");
  label.className = "turn-cut-label";
  if (state.turnCutRevealStage === "user-cut") label.textContent = "Cut the deck";
  else if (state.turnCutRevealStage === "ai-cut") label.textContent = "AI cuts the deck";
  else if (state.turnCutRevealStage === "user-turn") label.textContent = "Turn the cut card";
  else if (state.turnCutRevealStage === "ai-turn") label.textContent = "AI turns the cut card";
  else label.textContent = "Cut card";

  const showCutCard = state.turnCutRevealStage === "ai-turn" ||
    state.turnCutRevealStage === "revealed";
  if (showCutCard && game.turnCard) {
    const cut = document.createElement("div");
    cut.className = "cut-result turn-card-reveal";
    const cutLabel = document.createElement("span");
    cutLabel.textContent = "Cut";
    cut.append(cutLabel, cardElement(game.turnCard));
    if (state.turnCutRevealStage === "revealed") {
      cut.setAttribute("role", "button");
      cut.tabIndex = 0;
      cut.setAttribute("aria-label", "Continue to pegging");
      cut.addEventListener("click", completeTurnCutInteraction);
      cut.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        completeTurnCutInteraction();
      });
    }
    cutSlot.append(cut);
  }
  row.append(emptySlot, deck, cutSlot);
  els.plays.append(label, row);
}

function renderDealAnimation(): void {
  if (!state.dealAnimation) return;
  els.plays.innerHTML = "";
  els.plays.hidden = false;
  const shell = document.createElement("div");
  shell.className = "deal-animation";
  const deck = cardBack();
  deck.classList.add("deal-animation-deck");
  shell.append(deck);
  const pone = document.createElement("div");
  pone.className = "deal-animation-hand deal-animation-pone";
  const dealer = document.createElement("div");
  dealer.className = "deal-animation-hand deal-animation-dealer";
  const poneLabel = document.createElement("span");
  poneLabel.textContent = `${state.dealAnimation.pone} hand`;
  const dealerLabel = document.createElement("span");
  dealerLabel.textContent = `${state.dealAnimation.dealer} hand`;
  pone.append(poneLabel);
  dealer.append(dealerLabel);
  for (let index = 0; index < 6; index += 1) {
    const poneCard = cardBack();
    poneCard.classList.add("deal-animation-card");
    poneCard.style.animationDelay = `${index * 235}ms`;
    pone.append(poneCard);
    const dealerCard = cardBack();
    dealerCard.classList.add("deal-animation-card");
    dealerCard.style.animationDelay = `${(index * 235) + 115}ms`;
    dealer.append(dealerCard);
  }
  shell.append(pone, dealer);
  els.plays.append(shell);
}

function renderCutCard(card: GameState["turnCard"]): void {
  els.turnCard.innerHTML = "";
  els.turnCard.className = "cut-card";
  els.scoreCut.hidden = !card;
  els.turnCard.hidden = !card;
  if (card) els.turnCard.append(cardElement(card));
}

function selectedPlayableCard(game: GameState): GameState["humanHand"][number] | undefined {
  return game.humanHand.find((card) => state.selected.has(card.id) && game.legalCardIds.includes(card.id));
}

function renderScoring(scoring: GameState["scoring"]): void {
  els.scoringReview.hidden = !scoring;
  if (!scoring) {
    els.scoringCards.innerHTML = "";
    els.scoringResult.innerHTML = "";
    return;
  }
  els.scoringTitle.textContent = scoring.title;
  els.scoringPoints.textContent = `${scoring.points} point${scoring.points === 1 ? "" : "s"}`;
  els.continueScoring.textContent = scoring.nextLabel;
  renderCards(els.scoringCards, scoring.cards);
  els.scoringResult.textContent = scoringBreakdownText(scoring);
}

function scoringBreakdownText(scoring: NonNullable<GameState["scoring"]>): string {
  const parts: string[] = [];
  const entries: Array<[keyof typeof scoring.components, string]> = [
    ["fifteens", "fifteens"],
    ["pairs", "pairs"],
    ["runs", "runs"],
    ["flush", "flush"],
    ["knobs", "knobs"],
  ];
  for (const [key, label] of entries) {
    const value = scoring.components[key];
    if (typeof value === "number" && value > 0) parts.push(`${value} from ${label}`);
  }
  const pointLabel = scoring.points === 1 ? "point" : "points";
  if (!parts.length) return `${scoring.points} ${pointLabel}.`;
  return `${scoring.points} ${pointLabel}: ${parts.join(", ")}.`;
}

function renderResult(game: GameState): void {
  if (game.phase === "game_over") {
    state.noticeResultLines = [];
    clearNoticeQueue();
    applyNotice("");
    els.resultInline.innerHTML = "";
    return;
  }
  const lines = (state.resultOverride ?? (game.result.length ? game.result : [game.message])).filter(
    (line) => line !== "User turn.",
  );
  const commonPrefix = matchingPrefixLength(state.noticeResultLines, lines);
  const newLines = lines.slice(commonPrefix).filter(Boolean);
  state.noticeResultLines = [...lines];
  enqueueNotices(newLines);
  els.resultInline.innerHTML = "";
  if (!game.scoring) els.scoringResult.innerHTML = "";
}

function matchingPrefixLength(left: string[], right: string[]): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

function clearNoticeQueue(): void {
  state.noticeQueue = [];
  if (state.noticeTimer !== null) {
    window.clearTimeout(state.noticeTimer);
    state.noticeTimer = null;
  }
}

function enqueueNotices(lines: string[]): void {
  if (!lines.length) {
    renderNoticeText(state.noticeHistoryIndex === null ? state.noticeText : state.noticeHistory[state.noticeHistoryIndex] ?? "");
    return;
  }
  if (state.noticeHistoryIndex !== null) {
    state.noticeHistoryIndex = null;
  }
  state.noticeQueue.push(...lines);
  drainNoticeQueue();
}

function drainNoticeQueue(): void {
  if (state.noticeTimer !== null) return;
  const nextText = state.noticeQueue.shift();
  if (nextText === undefined) {
    renderNoticeText(state.noticeText);
    return;
  }
  if (nextText === state.noticeText) {
    renderNoticeText(state.noticeText);
    drainNoticeQueue();
    return;
  }
  const elapsed = performance.now() - state.noticeUpdatedAt;
  const apply = (): void => {
    state.noticeTimer = null;
    applyNotice(nextText);
    if (state.noticeQueue.length) {
      state.noticeTimer = window.setTimeout(() => {
        state.noticeTimer = null;
        drainNoticeQueue();
      }, NOTICE_MIN_MS);
    }
  };
  if (!state.noticeText || elapsed >= NOTICE_MIN_MS) apply();
  else {
    state.noticeTimer = window.setTimeout(() => {
      state.noticeTimer = null;
      apply();
    }, NOTICE_MIN_MS - elapsed);
  }
}

function applyNotice(nextText: string): void {
  if (state.noticeText && state.noticeText !== nextText) {
    state.noticeHistory.push(state.noticeText);
    if (state.noticeHistory.length > 40) state.noticeHistory.shift();
  }
  state.noticeText = nextText;
  state.noticeUpdatedAt = performance.now();
  renderNoticeText(state.noticeText);
}

function renderNoticeText(text: string): void {
  els.result.innerHTML = "";
  if (text) {
    const item = document.createElement("div");
    item.textContent = text;
    els.result.append(item);
  }
  els.noticeBack.disabled = state.noticeHistory.length === 0 || state.noticeHistoryIndex === 0;
  els.noticeForward.disabled = state.noticeHistoryIndex === null;
}

function shouldInlineResult(game: GameState): boolean {
  void game;
  return false;
}

function latestGameEnd(game: GameState): GameEndEvent | undefined {
  return [...game.analyticsEvents]
    .reverse()
    .find((event): event is GameEndEvent => event.type === "game" && event.action === "end");
}

function renderGameOver(game: GameState): void {
  const end = latestGameEnd(game);
  const gameId = end?.gameId ?? null;
  const dismissed = Boolean(gameId && state.dismissedGameOverId === gameId);
  els.gameOverAlert.hidden = game.phase !== "game_over" || dismissed;
  els.singleGameReport.hidden = game.phase !== "game_over" || !dismissed;
  if (game.phase !== "game_over") {
    els.singleGameReport.innerHTML = "";
    return;
  }
  if (!end) {
    els.gameOverTitle.textContent = "Game over!";
    els.singleGameReport.innerHTML = "";
    return;
  }
  els.gameOverTitle.textContent = `${playerName(end.winner ?? "human")} won!`;
  renderSingleGameReport(game, end);
}

function renderSingleGameReport(game: GameState, end: GameEndEvent): void {
  els.singleGameReport.innerHTML = "";
  const newGame = document.createElement("button");
  newGame.type = "button";
  newGame.className = "report-new-game";
  newGame.textContent = "New game";
  newGame.addEventListener("click", () => {
    void startNewGameFromUi();
  });
  els.singleGameReport.append(newGame);
  renderGameReportInto(els.singleGameReport, game.analyticsEvents, end, "Game report", game.scores);
}

function renderGameReportInto(
  container: HTMLElement,
  events: AnalyticsEvent[],
  end: GameEndEvent,
  titleText = "Game report",
  fallbackScores: GameState["scores"] = { human: 0, ai: 0 },
): void {
  const scoreEvents = events.filter(
    (event): event is ScoreEvent => event.type === "score" && event.gameId === end.gameId,
  );
  const report = singleGameTotals(scoreEvents, end);
  const title = document.createElement("h2");
  title.textContent = titleText;
  const summary = document.createElement("p");
  const start = gameStartFor(events, end.gameId);
  const finalScores = end.finalScores ?? fallbackScores;
  const result = end.result && end.result !== "regular" ? `, ${end.result}` : "";
  summary.textContent = `${shortDate(end.at)} vs AI. ${playerName(end.winner ?? "human")} won ${finalScores.human}-${finalScores.ai}${result}.`;
  const cards = document.createElement("div");
  cards.className = "single-game-report-cards";
  cards.append(analyticsTotalCard("User", report.human, "human", { showGames: false }));
  cards.append(analyticsTotalCard("AI", report.ai, "ai", { showGames: false }));
  container.append(title, summary, cards, singleGameDecisionReview(events, end));
}

function singleGameDecisionReview(events: AnalyticsEvent[], end: GameEndEvent): HTMLElement {
  const section = document.createElement("section");
  section.className = "decision-review";
  const title = document.createElement("h3");
  title.textContent = "Decision review";
  const model = document.createElement("p");
  model.textContent = "Compared to AI analysis.";
  section.append(title, model);

  const mistakes = sortedDecisionMistakes(events, end.gameId);
  const totals = decisionEvTotals(mistakes);
  section.append(decisionEvSummary(totals), decisionWinProbabilityImpact(totals));

  if (!mistakes.length) {
    const empty = document.createElement("div");
    empty.className = "decision-review-empty";
    empty.textContent = "No user discards or peg plays were flagged by AI analysis.";
    section.append(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "decision-review-list";
  for (const event of mistakes) {
    const item = document.createElement("div");
    item.className = "decision-review-item";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "decision-review-toggle";
    const label = document.createElement("strong");
    label.textContent = event.type === "discard"
      ? `Hand ${event.handNumber} discard`
      : `Hand ${event.handNumber} peg`;
    const detail = document.createElement("span");
    detail.textContent = decisionReviewText(event);
    toggle.append(label, detail);
    const camera = document.createElement("button");
    camera.type = "button";
    camera.className = "decision-camera";
    camera.setAttribute("aria-label", `Show table for hand ${event.handNumber} ${event.type} error`);
    const context = decisionContext(event, events);
    context.hidden = true;
    toggle.addEventListener("click", () => {
      context.hidden = !context.hidden;
    });
    camera.addEventListener("click", () => {
      state.snapshotEventId = event.id;
      renderDecisionSnapshot(events);
    });
    item.append(toggle, camera);
    list.append(item);
    list.append(context);
  }
  section.append(list);
  return section;
}

function decisionMistakes(events: AnalyticsEvent[], gameId: string): DecisionReviewEvent[] {
  return events.filter((event): event is DecisionReviewEvent => {
    if (
      event.gameId !== gameId ||
      !((event.type === "discard" && event.player === "human") ||
        (event.type === "pegging" && event.action === "play" && event.player === "human")) ||
      !event.review
    ) {
      return false;
    }
    const reviewedEvent = event as DecisionReviewEvent;
    return !sameCards(reviewedEvent.review.selected, reviewedEvent.review.recommended) &&
      decisionMistakeMagnitude(reviewedEvent) >= decisionMistakeThreshold(reviewedEvent);
  });
}

function sortedDecisionMistakes(events: AnalyticsEvent[], gameId: string): DecisionReviewEvent[] {
  return decisionMistakes(events, gameId).sort((left, right) =>
    decisionMistakeSortValue(right) - decisionMistakeSortValue(left) ||
    left.handNumber - right.handNumber ||
    events.indexOf(left) - events.indexOf(right)
  );
}

function decisionMistakeSortValue(event: DecisionReviewEvent): number {
  return event.review.winProbabilityDelta === undefined
    ? Math.max(0, event.review.delta)
    : Math.max(0, event.review.winProbabilityDelta);
}

function decisionEvTotals(events: DecisionReviewEvent[]): DecisionEvTotals {
  const totals: DecisionEvTotals = {
    total: 0,
    discard: 0,
    pegging: 0,
    dealer: 0,
    pone: 0,
    pointEvTotal: 0,
    count: events.length,
  };
  for (const event of events) {
    const delta = Math.max(0, decisionWinProbabilityDelta(event));
    const pointEvDelta = Math.max(0, event.review.delta);
    totals.total += delta;
    totals.pointEvTotal += pointEvDelta;
    if (event.type === "discard") totals.discard += delta;
    if (event.type === "pegging") totals.pegging += delta;
    if (event.role === "dealer") totals.dealer += delta;
    if (event.role === "pone") totals.pone += delta;
  }
  return totals;
}

function decisionWinProbabilityDelta(event: DecisionReviewEvent): number {
  return Number(event.review.winProbabilityDelta ?? 0);
}

function decisionMistakeMagnitude(event: DecisionReviewEvent): number {
  const winProbabilityDelta = event.review.winProbabilityDelta;
  return winProbabilityDelta === undefined
    ? Math.max(0, event.review.delta)
    : Math.max(0, winProbabilityDelta);
}

function decisionMistakeThreshold(event: DecisionReviewEvent): number {
  return event.review.winProbabilityDelta === undefined
    ? ERROR_EV_THRESHOLD
    : ERROR_WIN_PROBABILITY_THRESHOLD;
}

function emptyDecisionErrorTotals(): Record<ScoreKey, number> {
  return {
    peggingDealer: 0,
    peggingPone: 0,
    handDealer: 0,
    handPone: 0,
    crib: 0,
  };
}

function categorizedDecisionError(event: DecisionReviewEvent): Record<ScoreKey, number> {
  const totals = emptyDecisionErrorTotals();
  const totalDelta = Math.max(0, event.review.delta);
  if (decisionMistakeMagnitude(event) < decisionMistakeThreshold(event)) return totals;
  const componentDeltas = event.review.components?.delta;
  if (componentDeltas) {
    for (const key of ERROR_SCORE_KEYS) {
      const value = Math.max(0, Number(componentDeltas[key] ?? 0));
      if (value >= ERROR_EV_THRESHOLD) totals[key] += value;
    }
    if (ERROR_SCORE_KEYS.some((key) => totals[key] > 0)) return totals;
  }

  if (event.type === "pegging") {
    totals[event.role === "dealer" ? "peggingDealer" : "peggingPone"] += totalDelta;
    return totals;
  }

  totals[event.role === "dealer" ? "handDealer" : "handPone"] += totalDelta;
  if (event.role === "dealer") totals.crib += totalDelta;
  return totals;
}

function decisionErrorAverages(events: AnalyticsEvent[], games: GameLogRecord[]): DecisionErrorAverages {
  const gameIds = new Set(games.map((game) => game.gameId));
  const handIds = new Set<string>();
  const totals = emptyDecisionErrorTotals();
  for (const event of events) {
    if (event.type === "hand" && gameIds.has(event.gameId)) {
      handIds.add(`${event.gameId}:${event.handNumber}`);
    }
    if (
      !gameIds.has(event.gameId) ||
      !((event.type === "discard" && event.player === "human") ||
        (event.type === "pegging" && event.action === "play" && event.player === "human")) ||
      !event.review ||
      sameCards(event.review.selected, event.review.recommended) ||
      decisionMistakeMagnitude(event as DecisionReviewEvent) < decisionMistakeThreshold(event as DecisionReviewEvent)
    ) {
      continue;
    }
    const categorized = categorizedDecisionError(event as DecisionReviewEvent);
    for (const key of ERROR_SCORE_KEYS) totals[key] += categorized[key];
  }
  return {
    totals,
    games: games.length,
    hands: handIds.size,
  };
}

function decisionErrorAveragesCard(all: DecisionErrorAverages, recent: DecisionErrorAverages): HTMLElement {
  const card = document.createElement("div");
  card.className = "analytics-total analytics-total-wide error-average-card";
  const title = document.createElement("strong");
  title.textContent = "User Error EV";
  card.append(title);
  for (const key of ERROR_SCORE_KEYS) {
    const row = document.createElement("span");
    row.className = "error-average-row";
    const label = document.createElement("strong");
    const perGame = averageError(all.totals[key], all.games);
    const perHand = averageError(all.totals[key], all.hands);
    const recentPerGame = averageError(recent.totals[key], recent.games);
    const recentPerHand = averageError(recent.totals[key], recent.hands);
    label.textContent = errorScoreLabel(key);
    label.classList.add(errorSeverityClass(Math.max(perGame, perHand, recentPerGame, recentPerHand)));
    const value = document.createElement("em");
    value.textContent = `All ${formatEv(perGame)}/game ${formatEv(perHand)}/hand · L10 ${formatEv(recentPerGame)}/game ${formatEv(recentPerHand)}/hand`;
    row.append(label, value);
    card.append(row);
  }
  return card;
}

function averageError(total: number, count: number): number {
  return count > 0 ? total / count : 0;
}

function errorSeverityClass(value: number): string {
  if (value >= 1) return "error-severity-high";
  if (value > 0) return "error-severity-medium";
  return "error-severity-none";
}

function errorScoreLabel(key: ScoreKey): string {
  if (key === "peggingDealer") return "Peg as dealer";
  if (key === "peggingPone") return "Peg as pone";
  if (key === "handDealer") return "Hand as dealer";
  if (key === "handPone") return "Hand as pone";
  return "Crib";
}

function decisionEvSummary(totals: DecisionEvTotals): HTMLElement {
  const summary = document.createElement("div");
  summary.className = "decision-ev-summary";
  for (const [label, value] of [
    ["Total win%", totals.total],
    ["Pegging", totals.pegging],
    ["Discard", totals.discard],
    ["Dealer", totals.dealer],
    ["Pone", totals.pone],
  ] as const) {
    const item = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = label;
    const amount = document.createElement("em");
    amount.textContent = formatPercentagePointDelta(value);
    item.append(name, amount);
    summary.append(item);
  }
  const pointEv = document.createElement("span");
  const pointEvName = document.createElement("strong");
  pointEvName.textContent = "Point EV";
  const pointEvAmount = document.createElement("em");
  pointEvAmount.textContent = formatEvPoints(totals.pointEvTotal);
  pointEv.append(pointEvName, pointEvAmount);
  summary.append(pointEv);
  return summary;
}

function formatEv(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatEvPoints(value: number): string {
  return `${formatEv(value)} points`;
}

function formatPercentagePointDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatWinProbability(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function decisionWinProbabilityImpact(totals: DecisionEvTotals): HTMLElement {
  const impact = document.createElement("p");
  impact.className = "decision-outcome-impact";
  impact.textContent = `Total win probability change from reviewed errors: ${formatPercentagePointDelta(totals.total)}.`;
  return impact;
}

function finalOutScoreEvent(events: AnalyticsEvent[], end: GameEndEvent): ScoreEvent | undefined {
  return [...events]
    .reverse()
    .find((event): event is ScoreEvent =>
      event.type === "score" &&
      event.gameId === end.gameId &&
      event.player === end.winner &&
      event.totalScore >= 121,
    );
}

function decisionContext(event: DecisionReviewEvent, events: AnalyticsEvent[]): HTMLElement {
  const detail = document.createElement("div");
  detail.className = "decision-context";
  const rows: Array<[string, string]> = [];
  const handStart = handStartFor(events, event.gameId, event.handNumber);
  const score = "scores" in event && event.scores
    ? event.scores
    : event.type === "pegging" && event.scoresBefore
      ? event.scoresBefore
      : handStart?.scores;
  if (score) rows.push(["Score", `User ${score.human}, AI ${score.ai}`]);
  const firstDealer = firstDealerForGame(events, event.gameId);
  if (score && firstDealer) {
    const components = event.type === "pegging" ? 2 : 0;
    rows.push(["User par", parStatusText("human", score.human, firstDealer, event.handNumber, components)]);
    rows.push(["AI par", parStatusText("ai", score.ai, firstDealer, event.handNumber, components)]);
  }
  rows.push(["Hand", String(event.handNumber)]);
  if (handStart) {
    rows.push(["Dealer", playerName(handStart.dealer)]);
    rows.push(["Pone", playerName(handStart.pone)]);
    if (handStart.turnCard) rows.push(["Cut", event.type === "discard" ? "Not yet shown" : handStart.turnCard]);
  }
  if (event.type === "discard") {
    rows.push(["Your hand", (event.handBeforeDiscard ?? [...event.remainingHand, ...event.cards]).join(" ")]);
    rows.push(["You discarded", event.review.selected.join(" ")]);
    rows.push(["AI advised", event.review.recommended.join(" ")]);
    rows.push(["Kept", event.remainingHand.join(" ")]);
    rows.push(["Crib after discard", event.cribAfterDiscard.join(" ") || "None"]);
  } else {
    if (event.cutCard) rows.push(["Cut", event.cutCard]);
    if (event.hand?.length) rows.push(["Your hand", event.hand.join(" ")]);
    if (event.completedPlayGroups?.length) {
      rows.push(["Prior counts", event.completedPlayGroups.map((group) => group.join(" ")).join(" / ")]);
    }
    rows.push(["Current count before play", String(event.countBefore ?? Math.max(0, event.count - cardValueFromLabel(event.card)))]);
    rows.push(["Already played", event.playedCards?.join(" ") || "None"]);
    rows.push(["You played", event.review.selected.join(" ")]);
    rows.push(["AI advised", event.review.recommended.join(" ")]);
  }
  rows.push(["Your point EV", formatEvPoints(event.review.selectedEv)]);
  rows.push(["Advised point EV", formatEvPoints(event.review.recommendedEv)]);
  rows.push(["Point EV gain", formatEvPoints(event.review.delta)]);
  if (event.review.selectedWinProbability !== undefined && event.review.recommendedWinProbability !== undefined) {
    rows.push(["Your win probability", formatWinProbability(event.review.selectedWinProbability)]);
    rows.push(["Advised win probability", formatWinProbability(event.review.recommendedWinProbability)]);
    rows.push(["Win probability gain", formatPercentagePointDelta(event.review.winProbabilityDelta ?? 0)]);
  }

  for (const [label, value] of rows) {
    const term = document.createElement("strong");
    term.textContent = label;
    const desc = document.createElement("span");
    desc.textContent = value;
    detail.append(term, desc);
  }
  return detail;
}

function renderDecisionSnapshot(events: AnalyticsEvent[]): void {
  const event = events.find((candidate): candidate is DecisionReviewEvent =>
    candidate.id === state.snapshotEventId &&
    ((candidate.type === "discard" && candidate.player === "human") ||
      (candidate.type === "pegging" && candidate.action === "play" && candidate.player === "human")) &&
    Boolean(candidate.review),
  );
  if (!event) {
    closeDecisionSnapshot();
    return;
  }
  els.decisionSnapshot.hidden = false;
  els.decisionSnapshotTitle.textContent = event.type === "discard"
    ? `Hand ${event.handNumber} discard`
    : `Hand ${event.handNumber} peg`;
  els.decisionSnapshotTable.innerHTML = "";
  els.decisionSnapshotTable.append(decisionSnapshotTable(event, events));
}

function closeDecisionSnapshot(): void {
  state.snapshotEventId = null;
  els.decisionSnapshot.hidden = true;
  els.decisionSnapshotTable.innerHTML = "";
}

function decisionSnapshotTable(event: DecisionReviewEvent, events: AnalyticsEvent[]): HTMLElement {
  const handStart = handStartFor(events, event.gameId, event.handNumber);
  const score = "scores" in event && event.scores
    ? event.scores
    : event.type === "pegging" && event.scoresBefore
      ? event.scoresBefore
      : handStart?.scores ?? { human: 0, ai: 0 };
  const dealer = handStart?.dealer ?? (event.role === "dealer" ? "human" : "ai");
  const firstDealer = firstDealerForGame(events, event.gameId);
  const root = document.createElement("div");
  root.className = "snapshot-table-view";
  root.append(snapshotScoreboard(score, dealer, event, firstDealer));

  const table = document.createElement("div");
  table.className = "table snapshot-table-surface";

  const status = document.createElement("div");
  status.className = "status";
  status.append(
    snapshotStatus("Dealer", playerName(dealer)),
    snapshotStatus("Count", event.type === "pegging" ? String(event.countBefore ?? 0) : "0"),
    snapshotStatus("Turn", "User"),
  );
  table.append(status);

  if (event.type === "discard") {
    table.append(
      snapshotDiscardSection(
        event.cribOwner === "human" ? "Select two cards to discard to your crib" : "Select two cards to discard to AI's crib",
        event.handBeforeDiscard ?? [...event.remainingHand, ...event.cards],
      ),
    );
  } else {
    table.append(
      snapshotPlayedSection(event),
      snapshotCardSection("Select card to play", event.hand ?? [], "cards"),
    );
  }
  root.append(table);
  root.append(snapshotDecisionSummary(event));
  return root;
}

function snapshotScoreboard(
  scores: Record<PlayerKey, number>,
  dealer: PlayerKey,
  event: DecisionReviewEvent,
  firstDealer: PlayerKey | undefined,
): HTMLElement {
  const board = document.createElement("div");
  board.className = "scoreboard snapshot-scoreboard";
  for (const player of ["human", "ai"] as const) {
    const score = document.createElement("div");
    score.className = `score${player === "ai" ? " ai" : ""}`;
    const label = document.createElement("span");
    label.className = "score-label";
    const name = document.createElement("span");
    name.className = "player-name";
    if (dealer === player) {
      const badge = document.createElement("span");
      badge.className = "dealer-button";
      badge.textContent = "Crib";
      if (player === "human") name.append(badge, " ", playerName(player));
      else name.append(playerName(player), " ", badge);
    } else {
      name.textContent = playerName(player);
    }
    label.append(name);
    const value = document.createElement("strong");
    value.textContent = String(scores[player]);
    const pace = document.createElement("span");
    pace.className = "score-pace";
    pace.textContent = firstDealer ? parStatusText(player, scores[player], firstDealer, event.handNumber, event.type === "pegging" ? 2 : 0) : "";
    score.append(label, value, pace);
    board.append(score);
  }
  const cut = document.createElement("div");
  cut.className = "score-cut";
  const cutLabel = document.createElement("span");
  cutLabel.textContent = "Cut";
  const cutCard = document.createElement("span");
  cutCard.className = "cut-card";
  const cutValue = event.type === "pegging" ? event.cutCard : undefined;
  if (cutValue) cutCard.append(cardElement(cardFromLabel(cutValue, 900)));
  else cutCard.hidden = true;
  cut.append(cutLabel, cutCard);
  board.insertBefore(cut, board.children[1] ?? null);
  return board;
}

function snapshotStatus(label: string, value: string): HTMLElement {
  const item = document.createElement("span");
  if (label === "Count") item.className = "status-count";
  const strong = document.createElement("strong");
  strong.textContent = value;
  item.append(`${label}: `, strong);
  return item;
}

function snapshotDecisionSummary(event: DecisionReviewEvent): HTMLElement {
  const summary = document.createElement("div");
  summary.className = "snapshot-decision-summary";
  const yourMove = document.createElement("div");
  const advisedMove = document.createElement("div");
  const selectedLabel = event.type === "discard" ? "You discarded" : "You played";
  const advisedLabel = event.type === "discard" ? "AI advised discarding" : "AI advised playing";
  yourMove.append(labelValue(selectedLabel, event.review.selected.join(" ")));
  advisedMove.append(labelValue(advisedLabel, event.review.recommended.join(" ")));
  summary.append(yourMove, advisedMove);
  return summary;
}

function labelValue(label: string, value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const term = document.createElement("strong");
  term.textContent = label;
  const detail = document.createElement("span");
  detail.textContent = value || "None";
  fragment.append(term, detail);
  return fragment;
}

function snapshotPlayedSection(event: DecisionReviewEvent): HTMLElement {
  const section = document.createElement("div");
  section.className = "played snapshot-played";
  const plays = document.createElement("div");
  plays.className = "snapshot-plays";
  const active = document.createElement("div");
  active.className = "cards played-active pegging-row";
  for (const card of event.type === "pegging" ? event.playedCards ?? [] : []) {
    active.append(cardElement(cardFromLabel(card, active.childElementCount)));
  }
  plays.append(active);
  if (event.type === "pegging") {
    for (const group of [...(event.completedPlayGroups ?? [])].reverse()) {
      const archived = document.createElement("div");
      archived.className = "cards played-archive pegging-row";
      for (const card of group) archived.append(cardElement(cardFromLabel(card, archived.childElementCount)));
      plays.append(archived);
    }
  }
  const result = document.createElement("div");
  result.className = "result";
  result.textContent = `Count ${event.type === "pegging" ? event.countBefore ?? 0 : 0}`;
  section.append(plays, result);
  return section;
}

function snapshotDiscardSection(titleText: string, labels: string[]): HTMLElement {
  const section = document.createElement("div");
  section.className = "played snapshot-discard";
  const title = document.createElement("h2");
  title.textContent = titleText;
  const cards = document.createElement("div");
  cards.className = "cards";
  labels.forEach((label, index) => cards.append(cardElement(cardFromLabel(label, index + 100), { disabled: true })));
  section.append(title, cards);
  return section;
}

function snapshotCardSection(titleText: string, labels: string[], className: string): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "user-panel snapshot-user-panel";
  const title = document.createElement("h2");
  title.textContent = titleText;
  const cards = document.createElement("div");
  cards.className = className;
  labels.forEach((label, index) => cards.append(cardElement(cardFromLabel(label, index), { disabled: true })));
  panel.append(title, cards);
  return panel;
}

function cardFromLabel(label: string, index: number): GameState["humanHand"][number] {
  const suitKey = label.slice(-1);
  const rank = label.slice(0, -1);
  const suitMap: Record<string, { suit: string; symbol: string }> = {
    d: { suit: "diamonds", symbol: "♦" },
    c: { suit: "clubs", symbol: "♣" },
    h: { suit: "hearts", symbol: "♥" },
    s: { suit: "spades", symbol: "♠" },
  };
  const suit = suitMap[suitKey] ?? { suit: "spades", symbol: suitKey };
  return {
    index,
    id: 10000 + index,
    rank,
    suit: suit.suit,
    symbol: suit.symbol,
    value: cardValueFromLabel(label),
    label,
  };
}

function cardFromId(id: number, index: number | null = null): GameState["humanHand"][number] {
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suits = [
    { key: "d", suit: "diamonds", symbol: "♦" },
    { key: "c", suit: "clubs", symbol: "♣" },
    { key: "h", suit: "hearts", symbol: "♥" },
    { key: "s", suit: "spades", symbol: "♠" },
  ];
  const rank = ranks[id % 13] ?? "?";
  const suit = suits[Math.floor(id / 13)] ?? suits[0];
  const label = `${rank}${suit.key}`;
  return {
    index,
    id,
    rank,
    suit: suit.suit,
    symbol: suit.symbol,
    value: cardValueFromLabel(label),
    label,
  };
}

function optimisticAiDiscardingState(game: GameState | null, discardedIds: number[]): GameState | null {
  const turnCardId = currentSnapshot?.turnCard;
  if (!game || game.phase !== "discard" || typeof turnCardId !== "number" || game.aiHandCount !== 6) return null;
  const discarded = new Set(discardedIds);
  return {
    ...game,
    phase: "ai_discarding",
    message: "Waiting for AI to discard.",
    result: [...game.result, "User discarded two cards to the crib.", "Waiting for AI to discard."],
    turnCard: cardFromId(turnCardId),
    humanHand: game.humanHand.filter((card) => !discarded.has(card.id)),
    legalCardIds: [],
  };
}

function handStartFor(events: AnalyticsEvent[], gameId: string, handNumber: number): Extract<AnalyticsEvent, { type: "hand" }> | undefined {
  return events.find(
    (event): event is Extract<AnalyticsEvent, { type: "hand" }> =>
      event.type === "hand" && event.action === "start" && event.gameId === gameId && event.handNumber === handNumber,
  );
}

function gameStartFor(events: AnalyticsEvent[], gameId: string): Extract<AnalyticsEvent, { type: "game" }> | undefined {
  return events.find(
    (event): event is Extract<AnalyticsEvent, { type: "game" }> =>
      event.type === "game" && event.action === "start" && event.gameId === gameId,
  );
}

function firstDealerForGame(events: AnalyticsEvent[], gameId: string): "human" | "ai" | undefined {
  const firstHand = handStartFor(events, gameId, 1);
  return firstHand?.dealer;
}

function parStatusText(
  player: "human" | "ai",
  score: number,
  firstDealerPlayer: "human" | "ai",
  handNumber: number,
  currentHandComponents = 0,
): string {
  const par = {
    human: cumulativeParThroughHand("human", firstDealerPlayer, Math.max(0, handNumber - 1)),
    ai: cumulativeParThroughHand("ai", firstDealerPlayer, Math.max(0, handNumber - 1)),
  };
  for (let index = 0; index < currentHandComponents; index += 1) {
    applyParComponent(par, componentForHand(firstDealerPlayer, handNumber, index));
  }
  const parHole = Math.round(par[player]);
  const delta = score - parHole;
  return `${formatSignedInteger(delta)} Par ${parHole}`;
}

function formatSignedInteger(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function cardValueFromLabel(label: string | undefined): number {
  if (!label) return 0;
  const rank = label.slice(0, -1);
  if (rank === "A") return 1;
  if (["J", "Q", "K"].includes(rank)) return 10;
  return Number.parseInt(rank, 10) || 0;
}

function decisionReviewText(event: DecisionReviewEvent): string {
  const review = event.review;
  const pointEv = `your EV ${formatEvPoints(review.selectedEv)}, advised EV ${formatEvPoints(review.recommendedEv)}`;
  const delta = review.winProbabilityDelta !== undefined
    ? `; win% gain ${formatPercentagePointDelta(review.winProbabilityDelta)}; ${pointEv}`
    : review.delta !== 0
      ? `; AI analysis gain ${formatEv(review.delta)}`
      : "";
  if (event.type === "discard") {
    return `You discarded ${review.selected.join(" ")}; AI advised ${review.recommended.join(" ")}${delta}.`;
  }
  return `You played ${review.selected.join(" ")}; AI advised ${review.recommended.join(" ")}${delta}.`;
}

function sameCards(left: string[], right: string[]): boolean {
  return [...left].sort().join("|") === [...right].sort().join("|");
}

function singleGameTotals(scoreEvents: ScoreEvent[], end: GameEndEvent): { human: AnalyticsTotals; ai: AnalyticsTotals } {
  const human = emptyAnalyticsTotals();
  const ai = emptyAnalyticsTotals();
  const opportunities = {
    human: emptyOpportunitySets(),
    ai: emptyOpportunitySets(),
  };
  for (const event of scoreEvents) {
    const totals = event.player === "human" ? human : ai;
    const sets = event.player === "human" ? opportunities.human : opportunities.ai;
    const key = scoreKey(event.category, event.role);
    totals[key] += event.points;
    sets[key].add(`${event.gameId}:${event.handNumber}`);
  }
  human.games = 1;
  ai.games = 1;
  if (end.winner === "human") {
    human.wins = 1;
    ai.losses = 1;
  } else {
    ai.wins = 1;
    human.losses = 1;
  }
  const loser = end.loser ?? (end.winner === "human" ? "ai" : "human");
  if (end.result === "skunk" || end.result === "double-skunk") {
    const winnerTotals = end.winner === "human" ? human : ai;
    const loserTotals = loser === "human" ? human : ai;
    winnerTotals.skunks = 1;
    loserTotals.skunked = 1;
  }
  if (end.result === "double-skunk") {
    const winnerTotals = end.winner === "human" ? human : ai;
    const loserTotals = loser === "human" ? human : ai;
    winnerTotals.doubleSkunks = 1;
    loserTotals.doubleSkunked = 1;
  }
  applyOpportunityCounts(human, opportunities.human);
  applyOpportunityCounts(ai, opportunities.ai);
  return { human, ai };
}

function renderAnalytics(): void {
  const events = loadAnalytics().events;
  const scoreEvents = events.filter((event): event is Extract<AnalyticsEvent, { type: "score" }> =>
    event.type === "score"
  );
  const gameEvents = events.filter((event): event is Extract<AnalyticsEvent, { type: "game" }> =>
    event.type === "game"
  );
  const handEvents = events.filter((event): event is Extract<AnalyticsEvent, { type: "hand" }> =>
    event.type === "hand"
  );
  const peggingEvents = events.filter((event): event is Extract<AnalyticsEvent, { type: "pegging" }> =>
    event.type === "pegging"
  );

  if (state.analyticsMode === "my") {
    renderMyStats(scoreEvents, gameEvents);
    return;
  }

  els.analyticsTitle.textContent = "Analytics";
  const completedGames = gameEvents.filter((event) => event.action === "end").length;
  const startedHands = handEvents.filter((event) => event.action === "start").length;
  els.analyticsSummary.textContent = `${completedGames} completed game${completedGames === 1 ? "" : "s"}; ${startedHands} hand${startedHands === 1 ? "" : "s"} logged.`;

  renderAnalyticsTotals(events, scoreEvents, gameEvents);
  renderAnalyticsRows(
    els.analyticsGames,
    [...gameEvents].reverse().slice(0, 40).map((event) =>
      event.action === "start"
        ? [`Game started`, `Engine: ${engineName(event.opponent)}`, shortDate(event.at)]
        : [
            `${playerName(event.winner)} won${event.result && event.result !== "regular" ? ` by ${event.result}` : ""}`,
            `Final ${event.finalScores?.human ?? 0}-${event.finalScores?.ai ?? 0}`,
            shortDate(event.at),
          ],
    ),
  );
  renderAnalyticsRows(
    els.analyticsHands,
    [...handEvents].reverse().slice(0, 80).map((event) => [
      `Hand ${event.handNumber} ${event.action}`,
      `Dealer: ${playerName(event.dealer)}; Pone: ${playerName(event.pone)}`,
      `Score ${event.scores.human}-${event.scores.ai}${event.turnCard ? `; Cut ${event.turnCard}` : ""}`,
    ]),
  );
  renderAnalyticsRows(
    els.analyticsScores,
    [...scoreEvents].reverse().slice(0, 120).map((event) => [
      `Hand ${event.handNumber}: ${playerName(event.player)} +${event.points}`,
      `${scoreLabel(event.category, event.role)}: ${event.reason}`,
      `Total ${event.totalScore}${event.card ? `; Card ${event.card}` : ""}${event.count ? `; Count ${event.count}` : ""}`,
    ]),
  );
  renderAnalyticsRows(
    els.analyticsPegging,
    [...peggingEvents].reverse().slice(0, 160).map((event) => [
      `Hand ${event.handNumber}: ${event.action}`,
      event.player ? `${playerName(event.player)} as ${event.role}` : "Count",
      event.message,
    ]),
  );
}

function renderMyStats(scoreEvents: ScoreEvent[], gameEvents: Extract<AnalyticsEvent, { type: "game" }>[]): void {
  const completedGames = gameEvents.filter((event) => event.action === "end").length;
  const totals = playerAnalyticsTotals(scoreEvents, gameEvents);
  els.analyticsTitle.textContent = "My Stats";
  els.analyticsSummary.textContent = completedGames
    ? `${completedGames} completed game${completedGames === 1 ? "" : "s"} recorded.`
    : "No completed games yet.";
  els.analyticsTotals.innerHTML = "";
  els.analyticsTotals.append(simpleAnalyticsCard("User", totals.human, "human"));
  els.analyticsTotals.append(simpleAnalyticsCard("AI", totals.ai, "ai"));
  renderAnalyticsRows(els.analyticsGames, []);
  renderAnalyticsRows(els.analyticsHands, []);
  renderAnalyticsRows(els.analyticsScores, []);
  renderAnalyticsRows(els.analyticsPegging, []);
}

function playerAnalyticsTotals(
  scoreEvents: ScoreEvent[],
  gameEvents: Extract<AnalyticsEvent, { type: "game" }>[],
): { human: AnalyticsTotals; ai: AnalyticsTotals } {
  const human = emptyAnalyticsTotals();
  const ai = emptyAnalyticsTotals();
  const opportunities = {
    human: emptyOpportunitySets(),
    ai: emptyOpportunitySets(),
  };
  for (const event of scoreEvents) {
    const totals = event.player === "human" ? human : ai;
    const sets = event.player === "human" ? opportunities.human : opportunities.ai;
    const key = scoreKey(event.category, event.role);
    totals[key] += event.points;
    sets[key].add(`${event.gameId}:${event.handNumber}`);
  }
  for (const event of gameEvents) {
    if (event.action !== "end" || !event.winner) continue;
    human.games += 1;
    ai.games += 1;
    if (event.winner === "human") {
      human.wins += 1;
      ai.losses += 1;
    } else {
      ai.wins += 1;
      human.losses += 1;
    }
  }
  applyOpportunityCounts(human, opportunities.human);
  applyOpportunityCounts(ai, opportunities.ai);
  return { human, ai };
}

function renderGameLog(): void {
  const events = loadAnalytics().events;
  const games = gameLogRecords(events);
  syncGameLogFilter(games);
  const selectedOpponent = els.gameLogOpponent.value;
  const filtered = selectedOpponent
    ? games.filter((game) => game.opponent === selectedOpponent)
    : games;
  if (!state.selectedLogGameId || !filtered.some((game) => game.gameId === state.selectedLogGameId)) {
    state.selectedLogGameId = filtered[0]?.gameId ?? null;
  }

  els.gameLogSummary.textContent = `${filtered.length} completed game${filtered.length === 1 ? "" : "s"}${selectedOpponent ? " vs AI" : ""}.`;
  els.gameLogList.innerHTML = "";
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "analytics-empty";
    empty.textContent = "No completed games match this filter.";
    els.gameLogList.append(empty);
    return;
  }

  for (const game of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-log-item";
    button.classList.toggle("selected", game.gameId === state.selectedLogGameId);
    const result = game.end.finalScores
      ? `${game.end.finalScores.human}-${game.end.finalScores.ai}`
      : "Final score unavailable";
    button.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = `${shortDate(game.end.at)} · vs AI`;
    const meta = document.createElement("span");
    meta.textContent = `${playerName(game.end.winner)} won ${result}${game.end.result && game.end.result !== "regular" ? ` (${game.end.result})` : ""}`;
    const ev = document.createElement("span");
    const totals = decisionEvTotals(decisionMistakes(events, game.gameId));
    ev.textContent = `${formatPercentagePointDelta(totals.total)} error win% (${totals.count}); ${formatEvPoints(totals.pointEvTotal)} EV`;
    ev.className = totals.total > 0 ? "game-log-ev has-errors" : "game-log-ev";
    button.append(title, meta, ev);
    button.addEventListener("click", () => {
      state.selectedLogGameId = game.gameId;
      state.gameLogOpen = false;
      state.decisionReviewOpen = true;
      render(state.game);
    });
    els.gameLogList.append(button);
  }
}

function renderDecisionReviewPage(): void {
  const events = loadAnalytics().events;
  const games = gameLogRecords(events);
  const selected = games.find((game) => game.gameId === state.selectedLogGameId) ?? games[0];
  els.decisionReviewContent.innerHTML = "";
  if (!selected) {
    els.decisionReviewSummary.textContent = "No completed games yet.";
    const empty = document.createElement("p");
    empty.className = "analytics-empty";
    empty.textContent = "Open the game log after completing a game.";
    els.decisionReviewContent.append(empty);
    return;
  }
  els.decisionReviewSummary.textContent = `${shortDate(selected.end.at)} vs AI.`;
  renderGameReportInto(
    els.decisionReviewContent,
    events,
    selected.end,
    "Logged game report",
    selected.end.finalScores ?? { human: 0, ai: 0 },
  );
}

function renderModelInfoPage(): void {
  els.modelInfoSummary.textContent = `Current default: ${engineName(DEFAULT_OPPONENT)}.`;
  els.modelInfoList.innerHTML = "";
  els.modelInfoContent.textContent = "Model details are server-side only in production.";
}

function markdownSummary(markdown: string): string {
  const html: string[] = [];
  let listOpen = false;
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      continue;
    }
    if (line.startsWith("- ")) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
    if (line.startsWith("# ")) {
      html.push(`<h3>${escapeHtml(line.slice(2))}</h3>`);
    } else if (line.startsWith("## ")) {
      html.push(`<h4>${escapeHtml(line.slice(3))}</h4>`);
    } else {
      html.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (listOpen) html.push("</ul>");
  return html.join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function gameLogRecords(events: AnalyticsEvent[]): GameLogRecord[] {
  const starts = new Map<string, Extract<AnalyticsEvent, { type: "game" }>>();
  const records: GameLogRecord[] = [];
  for (const event of events) {
    if (event.type !== "game") continue;
    if (event.action === "start") starts.set(event.gameId, event);
    if (event.action === "end") {
      const start = starts.get(event.gameId);
      records.push({
        gameId: event.gameId,
        start,
        end: event as GameEndEvent,
        opponent: normalizeAnalyticsEngine(start?.opponent ?? event.opponent),
      });
    }
  }
  return records.sort((a, b) => b.end.at.localeCompare(a.end.at));
}

function syncGameLogFilter(games: GameLogRecord[]): void {
  const selected = els.gameLogOpponent.value;
  const opponents = [...new Set(games.map((game) => game.opponent))]
    .sort((a, b) => analyticsEngineSortKey(a) - analyticsEngineSortKey(b));
  els.gameLogOpponent.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All opponents";
  els.gameLogOpponent.append(all);
  for (const opponent of opponents) {
    const option = document.createElement("option");
    option.value = opponent;
    option.textContent = "AI";
    els.gameLogOpponent.append(option);
  }
  els.gameLogOpponent.value = opponents.includes(selected as Opponent) ? selected : "";
}

function renderAnalyticsTotals(
  events: AnalyticsEvent[],
  scoreEvents: Extract<AnalyticsEvent, { type: "score" }>[],
  gameEvents: Extract<AnalyticsEvent, { type: "game" }>[],
): void {
  const humanTotals = emptyAnalyticsTotals();
  const aiAllTotals = emptyAnalyticsTotals();
  const aiHumanTotals = emptyAnalyticsTotals();
  const humanByModel = new Map<Opponent, AnalyticsTotals>();
  const aiByModel = new Map<Opponent, AnalyticsTotals>();
  const aiHumanByModel = new Map<Opponent, AnalyticsTotals>();
  const gameEngines = engineByGame(gameEvents);
  const opportunities = new Map<AnalyticsTotals, Record<ScoreKey, Set<string>>>();
  const ensureOpportunities = (totals: AnalyticsTotals): Record<ScoreKey, Set<string>> => {
    const existing = opportunities.get(totals);
    if (existing) return existing;
    const next = emptyOpportunitySets();
    opportunities.set(totals, next);
    return next;
  };
  const modelTotals = (engine: Opponent): AnalyticsTotals => {
    const existing = aiByModel.get(engine);
    if (existing) return existing;
    const next = emptyAnalyticsTotals();
    aiByModel.set(engine, next);
    return next;
  };
  const userModelTotals = (engine: Opponent): AnalyticsTotals => {
    const existing = humanByModel.get(engine);
    if (existing) return existing;
    const next = emptyAnalyticsTotals();
    humanByModel.set(engine, next);
    return next;
  };
  const modelHumanTotals = (engine: Opponent): AnalyticsTotals => {
    const existing = aiHumanByModel.get(engine);
    if (existing) return existing;
    const next = emptyAnalyticsTotals();
    aiHumanByModel.set(engine, next);
    return next;
  };

  for (const event of scoreEvents) {
    const key = scoreKey(event.category, event.role);
    const handKey = `${event.gameId}:${event.handNumber}`;
    if (event.player === "human") {
      const engine = gameEngines.get(event.gameId) ?? DEFAULT_OPPONENT;
      const perUserModel = userModelTotals(engine);
      humanTotals[key] += event.points;
      perUserModel[key] += event.points;
      ensureOpportunities(humanTotals)[key].add(handKey);
      ensureOpportunities(perUserModel)[key].add(handKey);
    } else {
      const engine = gameEngines.get(event.gameId) ?? DEFAULT_OPPONENT;
      const perModel = modelTotals(engine);
      const perHumanModel = modelHumanTotals(engine);
      aiAllTotals[key] += event.points;
      aiHumanTotals[key] += event.points;
      perModel[key] += event.points;
      perHumanModel[key] += event.points;
      ensureOpportunities(aiAllTotals)[key].add(handKey);
      ensureOpportunities(aiHumanTotals)[key].add(handKey);
      ensureOpportunities(perModel)[key].add(handKey);
      ensureOpportunities(perHumanModel)[key].add(handKey);
    }
  }
  for (const event of gameEvents) {
    if (event.action !== "end" || !event.winner) continue;
    const loser = event.loser ?? (event.winner === "human" ? "ai" : "human");
    const result = event.result ?? gameResultFromScores(event.winner, event.finalScores);
    humanTotals.games += 1;
    aiAllTotals.games += 1;
    aiHumanTotals.games += 1;
    const engine = gameEngines.get(event.gameId) ?? normalizeAnalyticsEngine(event.opponent);
    const perModel = modelTotals(engine);
    const perHumanModel = modelHumanTotals(engine);
    const perUserModel = userModelTotals(engine);
    perModel.games += 1;
    perHumanModel.games += 1;
    perUserModel.games += 1;
    const winnerTotals = event.winner === "human" ? humanTotals : aiAllTotals;
    const loserTotals = loser === "human" ? humanTotals : aiAllTotals;
    winnerTotals.wins += 1;
    loserTotals.losses += 1;
    if (event.winner === "ai") {
      aiHumanTotals.wins += 1;
      perModel.wins += 1;
      perHumanModel.wins += 1;
      perUserModel.losses += 1;
    } else {
      aiHumanTotals.losses += 1;
      perModel.losses += 1;
      perHumanModel.losses += 1;
      perUserModel.wins += 1;
    }
    if (result === "skunk" || result === "double-skunk") {
      winnerTotals.skunks += 1;
      loserTotals.skunked += 1;
      if (event.winner === "ai") {
        aiHumanTotals.skunks += 1;
        perModel.skunks += 1;
        perHumanModel.skunks += 1;
        perUserModel.skunked += 1;
      } else {
        aiHumanTotals.skunked += 1;
        perModel.skunked += 1;
        perHumanModel.skunked += 1;
        perUserModel.skunks += 1;
      }
    }
    if (result === "double-skunk") {
      winnerTotals.doubleSkunks += 1;
      loserTotals.doubleSkunked += 1;
      if (event.winner === "ai") {
        aiHumanTotals.doubleSkunks += 1;
        perModel.doubleSkunks += 1;
        perHumanModel.doubleSkunks += 1;
        perUserModel.doubleSkunked += 1;
      } else {
        aiHumanTotals.doubleSkunked += 1;
        perModel.doubleSkunked += 1;
        perHumanModel.doubleSkunked += 1;
        perUserModel.doubleSkunks += 1;
      }
    }
  }
  applyOpportunityCounts(humanTotals, ensureOpportunities(humanTotals));
  applyOpportunityCounts(aiAllTotals, ensureOpportunities(aiAllTotals));
  applyOpportunityCounts(aiHumanTotals, ensureOpportunities(aiHumanTotals));
  for (const totals of humanByModel.values()) applyOpportunityCounts(totals, ensureOpportunities(totals));
  for (const totals of aiByModel.values()) applyOpportunityCounts(totals, ensureOpportunities(totals));
  for (const totals of aiHumanByModel.values()) applyOpportunityCounts(totals, ensureOpportunities(totals));
  addAiBaselineTotals(aiAllTotals, aiByModel);
  els.analyticsTotals.innerHTML = "";
  els.analyticsTotals.append(analyticsTotalCard("User", humanTotals, "human"));
  const games = gameLogRecords(events);
  els.analyticsTotals.append(decisionErrorAveragesCard(
    decisionErrorAverages(events, games),
    decisionErrorAverages(events, games.slice(0, 10)),
  ));
  els.analyticsTotals.append(analyticsTotalCard("User vs All AI", humanTotals, "human"));
  for (const engine of sortedAnalyticsEngines(aiByModel, aiHumanByModel, humanByModel)) {
    const userTotals = humanByModel.get(engine) ?? emptyAnalyticsTotals();
    els.analyticsTotals.append(analyticsTotalCard(`User vs ${engineName(engine)}`, userTotals, "human"));
  }
  els.analyticsTotals.append(analyticsTotalCard("All AI", aiAllTotals, "ai"));
  for (const engine of sortedAnalyticsEngines(aiByModel, aiHumanByModel, humanByModel)) {
    const totals = aiByModel.get(engine);
    if (totals) els.analyticsTotals.append(analyticsTotalCard(engineName(engine), totals, "ai"));
  }
}

function sortedAnalyticsEngines(
  aiByModel: Map<Opponent, AnalyticsTotals>,
  aiHumanByModel: Map<Opponent, AnalyticsTotals>,
  humanByModel: Map<Opponent, AnalyticsTotals> = new Map(),
): Opponent[] {
  const engines = new Set<Opponent>([...aiByModel.keys(), ...aiHumanByModel.keys(), ...humanByModel.keys()]);
  return [...engines].sort((a, b) => analyticsEngineSortKey(a) - analyticsEngineSortKey(b));
}

function analyticsEngineSortKey(engine: Opponent): number {
  return [
    "schell_table-peg_table-14.2",
    "schell_table-peg_table-14.1",
    "schell_table-peg_table-14.0",
    "schell_table-peg_table-13.0",
    "schell_table-peg_table-12.0",
    "schell_table-peg_table-11.1",
    "schell_table-peg_table-11.0",
    "schell_table-peg_table-10.0",
    "schell_table-peg_table-9.0",
    "schell_table-peg_table-8.0",
    "schell_table-peg_table-7.0",
    "schell_table-peg_table-6.0",
    "schell_table-peg_table-5.0",
    "schell_table-peg_table-4.0",
    "ras_table-peg_table-4.0",
    "schell_table-peg-3.0",
    "ras_table-peg-3.0",
    "schell_table-2.0",
    "ras_table-2.0",
    "original_exhaustive_peg-1.2",
    "original-1.1",
  ].indexOf(engine);
}

function renderAnalyticsRows(container: HTMLElement, rows: string[][]): void {
  container.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "analytics-empty";
    empty.textContent = "No records yet.";
    container.append(empty);
    return;
  }
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "analytics-row";
    for (const value of row) {
      const span = document.createElement("span");
      span.textContent = value;
      item.append(span);
    }
    container.append(item);
  }
}

function emptyAnalyticsTotals(): AnalyticsTotals {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    skunks: 0,
    skunked: 0,
    doubleSkunks: 0,
    doubleSkunked: 0,
    peggingDealer: 0,
    peggingPone: 0,
    handDealer: 0,
    handPone: 0,
    crib: 0,
    peggingDealerHands: 0,
    peggingPoneHands: 0,
    handDealerHands: 0,
    handPoneHands: 0,
    cribHands: 0,
  };
}

function emptyOpportunitySets(): Record<ScoreKey, Set<string>> {
  return {
    peggingDealer: new Set<string>(),
    peggingPone: new Set<string>(),
    handDealer: new Set<string>(),
    handPone: new Set<string>(),
    crib: new Set<string>(),
  };
}

function applyOpportunityCounts(
  totals: AnalyticsTotals,
  opportunities: Record<ScoreKey, Set<string>>,
): void {
  totals.peggingDealerHands += opportunities.peggingDealer.size;
  totals.peggingPoneHands += opportunities.peggingPone.size;
  totals.handDealerHands += opportunities.handDealer.size;
  totals.handPoneHands += opportunities.handPone.size;
  totals.cribHands += opportunities.crib.size;
}

function engineByGame(gameEvents: Extract<AnalyticsEvent, { type: "game" }>[]): Map<string, Opponent> {
  const engines = new Map<string, Opponent>();
  for (const event of gameEvents) engines.set(event.gameId, normalizeAnalyticsEngine(event.opponent));
  return engines;
}

function addAiBaselineTotals(aiAllTotals: AnalyticsTotals, aiByModel: Map<Opponent, AnalyticsTotals>): void {
  const baseline = aiBenchmarkSummary as unknown as AiBenchmarkSummarySource;
  if (baseline.version !== 1) return;
  const addModel = (
    engineValue: string | undefined,
    games: number | undefined,
    totals: Partial<BaselineScoreTotals> | undefined,
    opportunities: Partial<Record<ScoreKey, number>> | undefined,
    sourceLabel: string,
  ): void => {
    if (!totals) return;
    const engine = normalizeAnalyticsEngine(engineValue);
    const perModel = aiByModel.get(engine) ?? emptyAnalyticsTotals();
    aiByModel.set(engine, perModel);
    addBaselineStats(aiAllTotals, games, totals, opportunities, sourceLabel);
    addBaselineStats(perModel, games, totals, opportunities, sourceLabel);
  };

  addModel(
    baseline.opponent,
    baseline.games,
    baseline.aiTotals,
    baseline.opportunities,
    benchmarkLabel(baseline.source, baseline.games),
  );
  for (const [engine, model] of Object.entries(baseline.models ?? {})) {
    addModel(engine, model.games, model.aiTotals, model.opportunities, benchmarkLabel(baseline.source, model.games));
  }
  for (const benchmark of baseline.benchmarks ?? []) {
    const label = benchmarkLabel(benchmark.source, benchmark.games);
    for (const [engine, model] of Object.entries(benchmark.models ?? {})) {
      addModel(engine, model.games ?? benchmark.games, model.aiTotals, model.opportunities, label);
    }
  }
}

function addBaselineStats(
  totals: AnalyticsTotals,
  games: number | undefined,
  baselineTotals: Partial<BaselineScoreTotals>,
  opportunities: Partial<Record<ScoreKey, number>> | undefined,
  sourceLabel: string,
): void {
  const baselineTotalKeys = [
    "wins",
    "losses",
    "skunks",
    "skunked",
    "doubleSkunks",
    "doubleSkunked",
    "peggingDealer",
    "peggingPone",
    "handDealer",
    "handPone",
    "crib",
  ] as const;
  for (const key of baselineTotalKeys) {
    totals[key] += Number(baselineTotals[key] ?? 0);
  }
  totals.games += Number(games ?? 0);
  totals.peggingDealerHands += Number(opportunities?.peggingDealer ?? 0);
  totals.peggingPoneHands += Number(opportunities?.peggingPone ?? 0);
  totals.handDealerHands += Number(opportunities?.handDealer ?? 0);
  totals.handPoneHands += Number(opportunities?.handPone ?? 0);
  totals.cribHands += Number(opportunities?.crib ?? 0);
  totals.baselineGames = (totals.baselineGames ?? 0) + Number(games ?? 0);
  if (sourceLabel) totals.baselineSources = [...new Set([...(totals.baselineSources ?? []), sourceLabel])];
}

function analyticsTotalCard(
  label: string,
  totals: AnalyticsTotals,
  kind: "human" | "ai",
  options: { showGames?: boolean } = {},
): HTMLElement {
  const card = document.createElement("div");
  card.className = `analytics-total ${kind}`;
  const benchmarkNote = totals.baselineGames
    ? `Includes benchmarks: ${(totals.baselineSources ?? ["AI baseline"]).join("; ")} (${totals.baselineGames} model-games)`
    : "";
  const title = document.createElement("strong");
  title.textContent = label;
  card.append(title);
  if (kind === "ai" && benchmarkNote) {
    const note = document.createElement("span");
    note.className = "analytics-baseline-note";
    note.textContent = benchmarkNote;
    card.append(note);
  }
  const add = (text: string, className = ""): void => {
    const span = document.createElement("span");
    if (className) span.className = className;
    span.textContent = text;
    card.append(span);
  };
  if (options.showGames !== false) add(`Games: ${totals.games}`, "analytics-total-wide");
  add(`Wins: ${totals.wins}`);
  add(`Losses: ${totals.losses}`);
  add(`Avg peg as dealer: ${averageLabel(totals.peggingDealer, totals.peggingDealerHands)}`);
  add(`Avg peg as pone: ${averageLabel(totals.peggingPone, totals.peggingPoneHands)}`);
  add(`Avg hand as dealer: ${averageLabel(totals.handDealer, totals.handDealerHands)}`);
  add(`Avg hand as pone: ${averageLabel(totals.handPone, totals.handPoneHands)}`);
  add(`Avg crib: ${averageLabel(totals.crib, totals.cribHands)}`);
  add("", "analytics-total-blank");
  add(`Skunks: ${totals.skunks}`);
  add(`Skunked: ${totals.skunked}`);
  add(`Double skunks: ${totals.doubleSkunks}`);
  add(`Double skunked: ${totals.doubleSkunked}`);
  return card;
}

function simpleAnalyticsCard(label: string, totals: AnalyticsTotals, kind: "human" | "ai"): HTMLElement {
  const card = document.createElement("div");
  card.className = `analytics-total ${kind}`;
  const title = document.createElement("strong");
  title.textContent = label;
  card.append(title);
  const add = (text: string, className = ""): void => {
    const span = document.createElement("span");
    if (className) span.className = className;
    span.textContent = text;
    card.append(span);
  };
  const pegging = totals.peggingDealer + totals.peggingPone;
  const hands = totals.handDealer + totals.handPone;
  const totalScoring = pegging + hands + totals.crib;
  add(`Games: ${totals.games}`, "analytics-total-wide");
  add(`Wins: ${totals.wins}`);
  add(`Losses: ${totals.losses}`);
  add(`Total scoring: ${totalScoring}`, "analytics-total-wide");
  add(`Avg scoring: ${averageLabel(totalScoring, totals.games)}`);
  add(`Pegging: ${pegging}`);
  add(`Hands: ${hands}`);
  add(`Crib: ${totals.crib}`);
  return card;
}

function benchmarkLabel(source: string | undefined, games: number | undefined): string {
  if (source === "ras-v-schell-1000") return "1,000 Ras vs Schell";
  if (source === "three-way-ai-vs-ai-900") return "900 three-way AI vs AI";
  if (source === "three-way-expert-1.1-900") return "900 three-way with Original 1.1";
  if (source === "ras-v-expert-1.1-1000-large") return "1,000 Ras vs Original 1.1";
  if (source === "ras-v-schell-100000-large") return "100,000 Ras vs Schell";
  if (source === "schell-v-expert-1.1-1000-large") return "1,000 Schell vs Original 1.1";
  if (source === "four-model-ai-vs-ai-6000") return "6,000 four-model AI vs AI";
  if (source === "top-three-10k-30000") return "30,000 top-three AI vs AI";
  if (source === "sqlite-ai-benchmark-summary") return "SQLite AI benchmark summary";
  return source || "AI baseline";
}

function averageLabel(points: number, hands: number): string {
  if (!hands) return "-";
  return `${(points / hands).toFixed(2)} (${hands})`;
}

function gameResultFromScores(
  winner: PlayerKey,
  scores: Record<PlayerKey, number> | undefined,
): "regular" | "skunk" | "double-skunk" {
  const loser = winner === "human" ? "ai" : "human";
  const loserScore = scores?.[loser] ?? 121;
  if (loserScore <= 60) return "double-skunk";
  if (loserScore <= 90) return "skunk";
  return "regular";
}

function scoreKey(
  category: AnalyticsScoreCategory,
  role: AnalyticsRole,
): "peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib" {
  if (category === "crib") return "crib";
  return `${category}${role === "dealer" ? "Dealer" : "Pone"}`;
}

function scoreLabel(category: AnalyticsScoreCategory, role: AnalyticsRole): string {
  if (category === "crib") return "Crib";
  return `${category === "pegging" ? "Pegging" : "Hand"} as ${role}`;
}

function playerName(player: PlayerKey | undefined): string {
  if (!player) return "-";
  return player === "human" ? "User" : "AI";
}

function engineName(engine: string | undefined): string {
  if (!engine) return "-";
  const version = engine.match(/(\d+(?:\.\d+)?)$/)?.[1];
  return version ? `AI ${version}` : "AI";
}

function normalizeAnalyticsEngine(engine: string | undefined): Opponent {
  if (engine === "ras-table-1.0") return "ras_table-2.0";
  if (engine === "ras-table-peg-1.1") return "ras_table-peg-3.0";
  if (engine === "ras-table-peg_table-1.2") return "ras_table-peg_table-4.0";
  if (engine === "schell-table-1.0") return "schell_table-2.0";
  if (engine === "schell-table-peg-1.1") return "schell_table-peg-3.0";
  if (engine === "schell-table-peg_table-1.2") return "schell_table-peg_table-4.0";
  if (engine === "expert" || engine === "expert-1.1") return "original-1.1";
  if (engine === "expert-peg-1.2") return "original_exhaustive_peg-1.2";
  if (
    engine === "expert-2.0-ras-tables" ||
    engine === "expert_ras-table-1.0" ||
    engine === "expert_ras_table-2.0"
  ) return "ras_table-2.0";
  if (
    engine === "expert-peg-2.1" ||
    engine === "expert_ras-table-peg-1.1" ||
    engine === "expert_ras_table-peg-3.0"
  ) return "ras_table-peg-3.0";
  if (engine === "expert-peg_table-2.2") return "ras_table-peg_table-4.0";
  if (
    engine === "expert-peg-2.2" ||
    engine === "expert_schell-table-peg-1.1" ||
    engine === "expert_schell_table-peg-3.0"
  ) return "schell_table-peg-3.0";
  if (
    engine === "expert-peg_table-1.3" ||
    engine === "expert-peg_table-2.3" ||
    engine === "expert_schell-table-peg_table-1.2" ||
    engine === "expert_schell_table-peg_table-4.0"
  ) {
    return "schell_table-peg_table-4.0";
  }
  if (
    engine === "original-1.1" ||
    engine === "original_exhaustive_peg-1.2" ||
    engine === "ras_table-2.0" ||
    engine === "ras_table-peg-3.0" ||
    engine === "ras_table-peg_table-4.0" ||
    engine === "schell_table-peg-3.0" ||
    engine === "schell_table-peg_table-4.0" ||
    engine === "schell_table-peg_table-5.0" ||
    engine === "schell_table-peg_table-6.0" ||
    engine === "schell_table-peg_table-7.0" ||
    engine === "schell_table-peg_table-8.0" ||
    engine === "schell_table-peg_table-9.0" ||
    engine === "schell_table-peg_table-10.0" ||
    engine === "schell_table-peg_table-11.0" ||
    engine === "schell_table-peg_table-11.1" ||
    engine === "schell_table-peg_table-12.0" ||
    engine === "schell_table-peg_table-13.0" ||
    engine === "schell_table-peg_table-14.0" ||
    engine === "schell_table-peg_table-14.1" ||
    engine === "schell_table-peg_table-14.2" ||
    engine === "schell_table-2.0"
  ) {
    return engine;
  }
  return DEFAULT_OPPONENT;
}

function displayAppVersion(version: string): string {
  return version.replace(/^(\d+\.\d+)\.0$/, "$1");
}

function shortDate(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function playAreaTitle(game: GameState): string {
  if (state.turnCutRevealStage === "user-cut") return "Cut the deck for AI";
  if (state.turnCutRevealStage === "ai-cut") return "AI cuts the deck";
  if (state.turnCutRevealStage === "user-turn") return "Turn the cut card";
  if (state.turnCutRevealStage === "ai-turn") return "AI turns the cut card";
  if (state.turnCutRevealStage === "revealed") return "Cut card";
  if (game.phase === "cut_for_deal") return game.cutForDeal?.prompt || "Tap the deck to cut for first deal";
  if (game.phase === "discard") {
    return game.cribOwner === "User"
      ? "Select two cards to discard to your crib"
      : "Select two cards to discard to AI's crib";
  }
  if (game.phase === "ai_discarding") return "Waiting for AI to discard";
  if (game.phase === "pegging") return "";
  if (game.phase === "pegging_complete") return "Pegging complete";
  return "";
}

function render(game: GameState | null): void {
  if (!game) return;
  syncAnalytics(game.analyticsEvents);
  state.game = game;
  if (SIMPLE_NETWORK_MODE && game.phase === "game_over") state.hasResumableGame = false;
  document.body.dataset.splash = state.splashOpen ? "true" : "false";
  els.splashPage.hidden = !state.splashOpen;
  els.splashResumeGame.hidden = !state.hasResumableGame;
  els.splashNameRow.hidden = Boolean(playerFirstName);
  els.splashFirstName.value = playerFirstName || els.splashFirstName.value;
  els.app.dataset.phase = game.phase;
  els.app.dataset.cutConfirming = state.dealCutResolve ? "true" : "false";
  els.app.dataset.view = state.analyticsOpen
    ? "analytics"
    : state.gameLogOpen
      ? "game-log"
      : state.modelInfoOpen
        ? "model-info"
        : state.decisionReviewOpen
          ? "decision-review"
          : "game";
  els.app.dataset.inlineResult = shouldInlineResult(game) ? "true" : "false";
  els.app.dataset.parGuides = state.parGuides ? "true" : "false";
  els.analyticsPage.hidden = !state.analyticsOpen;
  els.gameLogPage.hidden = !state.gameLogOpen;
  els.modelInfoPage.hidden = !state.modelInfoOpen;
  els.decisionReviewPage.hidden = !state.decisionReviewOpen;
  if (state.analyticsOpen) renderAnalytics();
  if (state.gameLogOpen) renderGameLog();
  if (state.modelInfoOpen) renderModelInfoPage();
  if (state.decisionReviewOpen) renderDecisionReviewPage();
  els.humanScore.textContent = String(game.scores.human);
  els.aiScore.textContent = String(game.scores.ai);
  renderScorePace(game);
  els.humanDealer.hidden = game.dealer !== "User";
  els.aiDealer.hidden = game.dealer !== "AI";
  els.dealer.textContent = game.dealer;
  els.turn.textContent = game.turn || "-";
  els.count.textContent = String(game.count);
  const showModelLoadingUi = state.modelLoading && !SIMPLE_NETWORK_MODE;
  els.modelThinking.hidden = !state.aiThinking && !showModelLoadingUi;
  const thinkingLabel = els.modelThinking.querySelector(".thinking-label");
  if (thinkingLabel) {
    thinkingLabel.textContent = showModelLoadingUi ? "Loading model" : "AI thinking";
  }
  els.thinkingOverlay.hidden = !state.aiThinking && !showModelLoadingUi;
  els.thinkingOverlayLabel.textContent = showModelLoadingUi ? "Loading model" : "AI thinking";
  els.modelLoading.hidden = !showModelLoadingUi;
  renderCutCard(state.turnCutRevealStage ? null : game.turnCard);
  renderScoring(game.scoring);
  renderResult(game);
  renderGameOver(game);
  renderBoard(game.scores, game.pegPositions, game.firstDealer, game.phase, game.handNumber);
  const playTitle = playAreaTitle(game);
  els.playAreaTitle.textContent = playTitle;
  els.playAreaTitle.hidden = !playTitle;
  els.userHandTitle.textContent = game.peggingResetPending
    ? "Press OK to continue"
    : game.phase === "cut_for_deal"
      ? "Cut for deal"
      : game.phase === "pegging"
      ? "Select card to play"
      : "User hand";
  if (state.dealAnimation) {
    renderDealAnimation();
  } else if (state.turnCutRevealStage) {
    renderTurnCut(game);
  } else if (state.dealCutRevealStage && game.cutForDeal) {
    renderDealCut(game, state.dealCutRevealStage);
  } else if (game.phase === "cut_for_deal") {
    renderDealCut(game);
  } else if (game.phase === "discard") {
    renderCards(els.plays, game.humanHand, { clickable: true });
  } else if (game.scoring) {
    els.plays.innerHTML = "";
    els.plays.hidden = true;
  } else {
    renderPlayedCards(game);
  }
  const hideHandsForInterstitial = Boolean(state.dealAnimation || state.dealCutRevealStage);
  renderCards(els.humanHand, hideHandsForInterstitial ? [] : game.humanHand, {
    clickable: !hideHandsForInterstitial && game.phase !== "discard" && game.phase === "pegging" && game.turn === "User",
  });

  els.aiHand.innerHTML = "";
  els.aiStrip.hidden = game.phase === "game_over";
  const aiSlots = hideHandsForInterstitial ? 0 : aiCardSlots(game);
  for (let i = 0; i < aiSlots; i += 1) {
    const card = cardBack();
    if (i >= game.aiHandCount) {
      card.classList.add("placeholder");
      card.setAttribute("aria-hidden", "true");
    }
    els.aiHand.append(card);
  }

  const gameActive = game.phase !== "game_over";
  const waitingForTurnCutClick = state.turnCutRevealStage === "user-cut" ||
    state.turnCutRevealStage === "user-turn" ||
    state.turnCutRevealStage === "revealed";
  const waitingForDealCutOk = Boolean(state.dealCutResolve);
  els.cutForDeal.hidden = !gameActive || (game.phase !== "cut_for_deal" && !waitingForTurnCutClick && !waitingForDealCutOk);
  els.discard.hidden = !gameActive || Boolean(state.dealAnimation) || waitingForDealCutOk || Boolean(state.turnCutRevealStage) || game.phase !== "discard";
  els.play.hidden = !gameActive || Boolean(state.dealAnimation) || waitingForDealCutOk || Boolean(state.turnCutRevealStage) || game.peggingResetPending || !(game.phase === "pegging" && game.turn === "User");
  els.go.hidden = true;
  els.discard.disabled = !(game.phase === "discard" && state.selected.size === 2);
  els.cutForDeal.textContent = state.turnCutRevealStage === "user-turn"
    ? "Turn cut card"
    : state.turnCutRevealStage === "user-cut"
      ? "Cut deck"
      : state.turnCutRevealStage === "revealed" || waitingForDealCutOk
        ? "OK"
        : "Cut deck";
  els.cutForDeal.disabled = game.phase !== "cut_for_deal" && !waitingForTurnCutClick && !waitingForDealCutOk;
  els.play.disabled = game.peggingResetPending || !(game.phase === "pegging" && game.turn === "User" && selectedPlayableCard(game));
  els.go.disabled = !game.canGo;
  els.continueScoring.hidden = game.phase === "game_over";
  els.continueScoring.disabled = game.phase === "game_over" || !game.scoring;
  els.acknowledgePeggingReset.hidden = !game.peggingResetPending;
  els.continuePegging.hidden = game.peggingResetPending || game.phase !== "pegging_complete";
  if (state.pending) {
    els.discard.disabled = true;
    els.cutForDeal.disabled = !(waitingForDealCutOk || waitingForTurnCutClick);
    els.play.disabled = true;
    els.go.disabled = true;
    els.acknowledgePeggingReset.disabled = true;
    els.newGame.disabled = true;
    els.continueScoring.disabled = true;
    els.continuePegging.disabled = true;
  } else {
    els.acknowledgePeggingReset.disabled = false;
    els.newGame.disabled = false;
    els.continuePegging.disabled = false;
  }

}

function shouldAdvancePeggingAi(game: GameState): boolean {
  return game.phase === "pegging" && game.turn === "AI" && !game.peggingResetPending;
}

function shouldAutoHumanGo(game: GameState): boolean {
  return game.phase === "pegging" && game.turn === "User" && game.canGo && !game.peggingResetPending;
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function completeDealCutReveal(): void {
  const resolve = state.dealCutResolve;
  if (!resolve) return;
  state.dealCutResolve = null;
  resolve();
}

function waitForDealCutOk(): Promise<void> {
  return new Promise((resolve) => {
    state.dealCutResolve = resolve;
  });
}

function dealAnimationKey(game: GameState): string | null {
  if (game.phase !== "discard") return null;
  const gameId = currentSnapshot?.gameId ?? "game";
  return `${gameId}:${game.handNumber}`;
}

async function playDealAnimationIfNeeded(game: GameState): Promise<void> {
  const key = dealAnimationKey(game);
  if (!key || state.animatedDealKeys.has(key)) return;
  const dealer = game.dealer;
  const pone = dealer === "User" ? "AI" : "User";
  state.animatedDealKeys.add(key);
  state.dealAnimation = { key, dealer, pone };
  state.resultOverride = [`Dealing hand ${game.handNumber}.`];
  render(game);
  await waitForPaint();
  await waitMs(1840);
  state.dealAnimation = null;
  state.resultOverride = null;
  render(game);
}

function waitForTurnCutInteraction(): Promise<void> {
  return new Promise((resolve) => {
    state.turnCutResolve = resolve;
  });
}

async function playTurnCardReveal(game: GameState): Promise<void> {
  if (game.phase !== "pegging" || !game.turnCard) {
    render(game);
    return;
  }
  if (game.dealer === "AI") {
    state.turnCutRevealStage = "user-cut";
    state.resultOverride = ["Cut the deck for AI."];
    render(game);
    await waitForPaint();
    await waitForTurnCutInteraction();
    state.turnCutRevealStage = "ai-turn";
    state.resultOverride = ["AI turns the cut card."];
    render(game);
    await waitForPaint();
    await waitMs(750);
  } else {
    state.turnCutRevealStage = "ai-cut";
    state.resultOverride = ["AI cuts the deck."];
    render(game);
    await waitForPaint();
    await waitMs(650);
    state.turnCutRevealStage = "user-turn";
    state.resultOverride = ["Turn the cut card."];
    render(game);
    await waitForPaint();
    await waitForTurnCutInteraction();
  }
  state.turnCutRevealStage = "revealed";
  state.resultOverride = [`Cut card is ${cutCardText(game.turnCard)}.`];
  const confirmed = waitForTurnCutInteraction();
  render(game);
  await waitForPaint();
  await confirmed;
  state.turnCutRevealStage = null;
  state.turnCutResolve = null;
  state.resultOverride = null;
  render(game);
}

async function playTurnCutWhileFinishingDiscard(game: GameState | null): Promise<TurnCutProgress> {
  if (!game || game.phase !== "ai_discarding") return null;
  if (game.dealer === "AI") {
    state.turnCutRevealStage = "user-cut";
    state.resultOverride = ["Cut the deck for AI."];
    render(game);
    await waitForPaint();
    await waitForTurnCutInteraction();
    state.turnCutRevealStage = "ai-turn";
    state.resultOverride = ["AI turns the cut card."];
    render(game);
    await waitForPaint();
    await waitMs(450);
    state.turnCutRevealStage = "revealed";
    state.resultOverride = [`Cut card is ${cutCardText(game.turnCard)}.`];
    const confirmed = waitForTurnCutInteraction();
    render(game);
    await waitForPaint();
    await confirmed;
    return "confirmed";
  }
  state.turnCutRevealStage = "ai-cut";
  state.resultOverride = ["AI cuts the deck."];
  render(game);
  await waitForPaint();
  await waitMs(650);
  state.turnCutRevealStage = "user-turn";
  state.resultOverride = ["Turn the cut card."];
  render(game);
  await waitForPaint();
  await waitForTurnCutInteraction();
  state.turnCutRevealStage = "revealed";
  state.resultOverride = [`Cut card is ${cutCardText(game.turnCard)}.`];
  const confirmed = waitForTurnCutInteraction();
  render(game);
  await waitForPaint();
  await confirmed;
  return "confirmed";
}

async function finishTurnCardReveal(game: GameState, startStage: TurnCutProgress): Promise<void> {
  if (startStage === "confirmed") {
    state.turnCutRevealStage = null;
    state.turnCutResolve = null;
    state.resultOverride = null;
    render(game);
    return;
  }
  if (game.phase !== "pegging" || !game.turnCard) {
    state.turnCutRevealStage = null;
    state.turnCutResolve = null;
    state.resultOverride = null;
    render(game);
    return;
  }
  if (!startStage) {
    await playTurnCardReveal(game);
    return;
  }
  if (startStage === "ai-turn") {
    state.turnCutRevealStage = "ai-turn";
    state.resultOverride = ["AI turns the cut card."];
    render(game);
    await waitForPaint();
    await waitMs(700);
  }
  state.turnCutRevealStage = "revealed";
  state.resultOverride = [`Cut card is ${cutCardText(game.turnCard)}.`];
  const confirmed = waitForTurnCutInteraction();
  render(game);
  await waitForPaint();
  await confirmed;
  state.turnCutRevealStage = null;
  state.turnCutResolve = null;
  state.resultOverride = null;
  render(game);
}

async function prepareModel13Pegging(game: GameState): Promise<void> {
  void game;
}

async function continuePeggingAfterRender(game: GameState): Promise<GameState> {
  let current = game;
  for (let guard = 0; guard < 16; guard += 1) {
    if (shouldAutoHumanGo(current)) {
      render(current);
      await waitForPaint();
      current = await api("/api/go-human", {});
      render(current);
      continue;
    }
    if (shouldAdvancePeggingAi(current)) {
      setAiThinking(true);
      render(current);
      await waitForPaint();
      try {
        current = await api("/api/advance-pegging", {});
        render(current);
        scheduleDecisionReviewCompletion();
      } finally {
        setAiThinking(false);
        render(state.game);
      }
      continue;
    }
    return current;
  }
  throw new Error("Pegging continuation did not settle.");
}

function scheduleDecisionReviewCompletion(): void {
  if (state.completingReviews) return;
  state.completingReviews = true;
  window.setTimeout(() => {
    api("/api/complete-decision-reviews", {})
      .then((next) => render(next))
      .catch((error) => {
        els.result.textContent = error instanceof Error ? error.message : "Request failed";
      })
      .finally(() => {
        state.completingReviews = false;
      });
  }, 0);
}

els.menuToggle.addEventListener("click", () => {
  const open = els.settingsPanel.hidden;
  els.settingsPanel.hidden = !open;
  els.menuToggle.setAttribute("aria-expanded", String(open));
});

document.addEventListener("pointerdown", (event) => {
  if (els.settingsPanel.hidden) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (els.settingsPanel.contains(target) || els.menuToggle.contains(target)) return;
  els.settingsPanel.hidden = true;
  els.menuToggle.setAttribute("aria-expanded", "false");
});

function openAnalytics(mode: "my" | "full"): void {
  closeDecisionSnapshot();
  state.analyticsMode = mode;
  state.analyticsOpen = true;
  state.gameLogOpen = false;
  state.modelInfoOpen = false;
  state.decisionReviewOpen = false;
  els.settingsPanel.hidden = true;
  els.menuToggle.setAttribute("aria-expanded", "false");
  render(state.game);
}

els.myStatsOpen.addEventListener("click", () => {
  openAnalytics("my");
});

els.analyticsOpen.addEventListener("click", () => {
  openAnalytics("full");
});

els.analyticsClose.addEventListener("click", () => {
  state.analyticsOpen = false;
  render(state.game);
});

els.gameLogOpen.addEventListener("click", () => {
  closeDecisionSnapshot();
  state.gameLogOpen = true;
  state.analyticsOpen = false;
  state.modelInfoOpen = false;
  state.decisionReviewOpen = false;
  els.settingsPanel.hidden = true;
  els.menuToggle.setAttribute("aria-expanded", "false");
  render(state.game);
});

els.gameLogClose.addEventListener("click", () => {
  state.gameLogOpen = false;
  render(state.game);
});

els.modelInfoOpen.addEventListener("click", () => {
  closeDecisionSnapshot();
  state.selectedModelInfo = normalizeAnalyticsEngine(els.opponent.value);
  state.modelInfoOpen = true;
  state.analyticsOpen = false;
  state.gameLogOpen = false;
  state.decisionReviewOpen = false;
  els.settingsPanel.hidden = true;
  els.menuToggle.setAttribute("aria-expanded", "false");
  render(state.game);
});

els.modelInfoClose.addEventListener("click", () => {
  state.modelInfoOpen = false;
  render(state.game);
});

els.exportGameLog.addEventListener("click", async () => {
  els.exportGameLog.disabled = true;
  try {
    await exportPhoneGameLog();
    els.settingsPanel.hidden = true;
    els.menuToggle.setAttribute("aria-expanded", "false");
  } catch (error) {
    els.result.textContent = error instanceof Error ? error.message : "Export failed";
  } finally {
    els.exportGameLog.disabled = false;
  }
});

els.decisionReviewClose.addEventListener("click", () => {
  closeDecisionSnapshot();
  state.decisionReviewOpen = false;
  state.gameLogOpen = true;
  render(state.game);
});

els.decisionSnapshotClose.addEventListener("click", () => {
  closeDecisionSnapshot();
});

els.gameLogOpponent.addEventListener("change", () => {
  state.selectedLogGameId = null;
  renderGameLog();
});

els.parGuidesToggle.addEventListener("change", () => {
  state.parGuides = els.parGuidesToggle.checked;
  safeLocalStorageSet("strong-cribbage.admin.parGuides", state.parGuides ? "1" : "0");
  render(state.game);
});

els.noticeBack.addEventListener("click", () => {
  if (!state.noticeHistory.length) return;
  if (state.noticeHistoryIndex === null) state.noticeHistoryIndex = state.noticeHistory.length - 1;
  else state.noticeHistoryIndex = Math.max(0, state.noticeHistoryIndex - 1);
  renderNoticeText(state.noticeHistory[state.noticeHistoryIndex] ?? "");
});

els.noticeForward.addEventListener("click", () => {
  if (state.noticeHistoryIndex === null) return;
  if (state.noticeHistoryIndex >= state.noticeHistory.length - 1) {
    state.noticeHistoryIndex = null;
    renderNoticeText(state.noticeText);
    return;
  }
  state.noticeHistoryIndex += 1;
  renderNoticeText(state.noticeHistory[state.noticeHistoryIndex] ?? "");
});

els.opponent.addEventListener("change", async () => {
  if (state.pending) return;
  if (usesRemoteAi()) return;
  try {
    await ensureOpponentResources(normalizeAnalyticsEngine(els.opponent.value));
  } catch (error) {
    els.result.textContent = error instanceof Error ? error.message : "Model load failed";
  }
});

els.gameOverClose.addEventListener("click", () => {
  const end = state.game ? latestGameEnd(state.game) : null;
  state.dismissedGameOverId = end?.gameId ?? null;
  render(state.game);
});

async function cutForDeal(): Promise<void> {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  await waitForPaint();
  try {
    state.resultOverride = null;
    const preparedCut = preparedCutForDealFor(state.game);
    let next: GameState;
    if (preparedCut) {
      try {
        next = applyPreparedCutForDeal(await preparedCut);
      } catch {
        state.cutForDealPreparation = null;
        next = await api("/api/cut-for-deal", {});
      }
    } else {
      next = await api("/api/cut-for-deal", {});
    }
    state.selected.clear();
    if (next.cutForDeal?.human && next.cutForDeal.ai) {
      state.dealCutRevealStage = "human";
      state.resultOverride = [`User cut ${cutCardText(next.cutForDeal.human)}.`];
      render(next);
      await waitForPaint();
      await waitMs(800);
      state.dealCutRevealStage = "ai";
      state.resultOverride = [next.cutForDeal.prompt];
      const confirmed = waitForDealCutOk();
      render(next);
      await waitForPaint();
      await confirmed;
      state.dealCutRevealStage = null;
      state.resultOverride = null;
      render(next);
      await playDealAnimationIfNeeded(next);
    } else {
      render(next);
    }
  } finally {
    state.dealCutRevealStage = null;
    state.dealCutResolve = null;
    state.pending = false;
    render(state.game);
  }
}

els.cutForDeal.addEventListener("click", () => {
  if (state.dealCutResolve) {
    completeDealCutReveal();
    return;
  }
  if (state.turnCutResolve) {
    completeTurnCutInteraction();
    return;
  }
  if (state.turnCutRevealStage) return;
  void cutForDeal();
});

els.discard.addEventListener("click", async () => {
  if (state.pending) return;
  const selectedIds = Array.from(state.selected);
  const optimisticNext = optimisticAiDiscardingState(state.game, selectedIds);
  const epoch = interactionEpoch;
  state.pending = true;
  render(state.game);
  await waitForPaint();
  let handoffToBackground = false;
  try {
    state.resultOverride = null;
    const discardRequest = api("/api/discard", { ids: selectedIds });
    if (optimisticNext) {
      handoffToBackground = true;
      state.selected.clear();
      state.pending = false;
      render(optimisticNext);
      await waitForPaint();
      const cutInteraction = playTurnCutWhileFinishingDiscard(optimisticNext);
      let next: GameState;
      try {
        next = await discardRequest;
      } catch (error) {
        if (epoch === interactionEpoch) {
          state.turnCutRevealStage = null;
          if (state.turnCutResolve) state.turnCutResolve();
          state.turnCutResolve = null;
        }
        throw error;
      }
      if (epoch !== interactionEpoch) return;
      const startStage = await cutInteraction;
      if (epoch !== interactionEpoch) return;
      render(next);
      await finishDiscardInBackground(epoch, startStage);
      return;
    }
    const next = await discardRequest;
    state.selected.clear();
    render(next);
    await waitForPaint();
    if (next.phase === "ai_discarding") {
      handoffToBackground = true;
      state.pending = false;
      render(state.game);
      await waitForPaint();
      finishDiscardInBackground(interactionEpoch);
      return;
    }
    await prepareModel13Pegging(next);
  } catch (error) {
    state.resultOverride = [error instanceof Error ? error.message : "Discard failed"];
    render(state.game);
  } finally {
    if (!handoffToBackground) setAiThinking(false);
    state.pending = false;
    render(state.game);
  }
});

els.play.addEventListener("click", async () => {
  if (state.pending) return;
  const card = state.game ? selectedPlayableCard(state.game) : null;
  if (!card) return;
  state.pending = true;
  setAiThinking(true);
  render(state.game);
  await waitForPaint();
  try {
    state.resultOverride = null;
    const next = await api("/api/play-human", { id: card.id });
    state.selected.clear();
    render(next);
    await continuePeggingAfterRender(next);
  } finally {
    setAiThinking(false);
    state.pending = false;
    render(state.game);
  }
});

els.go.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  try {
    state.resultOverride = null;
    const next = await api("/api/go-human", {});
    render(next);
    await continuePeggingAfterRender(next);
  } finally {
    state.pending = false;
    render(state.game);
  }
});

els.acknowledgePeggingReset.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  try {
    state.resultOverride = null;
    const next = await api("/api/acknowledge-pegging-reset", {});
    render(next);
    await continuePeggingAfterRender(next);
  } finally {
    state.pending = false;
    render(state.game);
  }
});

els.continueScoring.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  try {
    state.resultOverride = null;
    const preparedNext = preparedNextHandFor(state.game);
    if (preparedNext) {
      setAiThinking(true);
      render(state.game);
    }
    let next: GameState;
    if (preparedNext) {
      try {
        next = applyPreparedNextHand(await preparedNext);
      } catch {
        state.nextHandPreparation = null;
        next = await api("/api/continue-scoring", {});
      }
    } else {
      next = await api("/api/continue-scoring", {});
    }
    state.selected.clear();
    render(next);
    await playDealAnimationIfNeeded(next);
  } finally {
    setAiThinking(false);
    state.pending = false;
    render(state.game);
  }
});

els.continuePegging.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  try {
    state.resultOverride = null;
    const next = await api("/api/continue-scoring", {});
    state.selected.clear();
    render(next);
  } finally {
    state.pending = false;
    render(state.game);
  }
});

async function startNewGameFromUi(): Promise<void> {
  if (state.pending) return;
  if (state.splashOpen && !saveSplashName()) return;
  resetTransientGameUi();
  state.pending = true;
  render(state.game);
  try {
    const next = await api("/api/new", { opponent: els.opponent.value });
    state.splashOpen = false;
    state.hasResumableGame = true;
    els.settingsPanel.hidden = true;
    els.menuToggle.setAttribute("aria-expanded", "false");
    render(next);
  } catch (error) {
    const message = error instanceof Error ? error.message : "New game failed";
    state.resultOverride = [message];
    els.result.textContent = message;
  } finally {
    state.pending = false;
    render(state.game);
  }
}

function resumeGameFromSplash(): void {
  if (state.pending || !state.hasResumableGame) return;
  if (!saveSplashName()) return;
  state.splashOpen = false;
  render(state.game);
  void continuePeggingAfterRender(state.game as GameState).catch((error) => {
    els.result.textContent = error instanceof Error ? error.message : "Request failed";
  });
}

els.splashFirstName.addEventListener("input", () => {
  els.splashFirstName.setCustomValidity("");
});

els.splashNewGame.addEventListener("click", () => {
  void startNewGameFromUi();
});

els.splashResumeGame.addEventListener("click", () => {
  resumeGameFromSplash();
});

els.newGame.addEventListener("click", () => {
  void startNewGameFromUi();
});

els.troubleGame.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  state.selected.clear();
  render(state.game);
  try {
    state.resultOverride = null;
    state.dismissedGameOverId = null;
    els.opponent.value = SIMPLE_NETWORK_OPPONENT;
    const next = await api("/api/trouble-game", {});
    els.settingsPanel.hidden = true;
    els.menuToggle.setAttribute("aria-expanded", "false");
    render(next);
    await prepareModel13Pegging(next);
  } finally {
    setAiThinking(false);
    state.pending = false;
    render(state.game);
  }
});

window.addEventListener("resize", () => render(state.game));

async function finishDiscardInBackground(
  epoch = interactionEpoch,
  preplayedStartStage?: TurnCutProgress,
): Promise<void> {
  const isCurrent = (): boolean => epoch === interactionEpoch;
  setAiThinking(false);
  render(state.game);
  await waitForPaint();
  if (!isCurrent()) return;
  let failed = false;
  try {
    state.resultOverride = null;
    const preparedDiscard = preparedAiDiscardFor(state.game);
    const finish = (async () => {
      if (!preparedDiscard) return api("/api/finish-discard", {});
      try {
        const prepared = await preparedDiscard;
        return api("/api/finish-discard-with-cards", {
          ids: prepared.cardIds,
          bestLead: prepared.bestLead,
        });
      } catch {
        return api("/api/finish-discard", {});
      }
    })();
    const startStage = preplayedStartStage === undefined
      ? await playTurnCutWhileFinishingDiscard(state.game)
      : preplayedStartStage;
    if (!isCurrent()) return;
    setAiThinking(true);
    state.resultOverride = ["Waiting for AI to discard."];
    render(state.game);
    await waitForPaint();
    const next = await finish;
    if (!isCurrent()) return;
    setAiThinking(false);
    await finishTurnCardReveal(next, startStage);
    if (!isCurrent()) return;
    setAiThinking(true);
    await prepareModel13Pegging(next);
    if (!isCurrent()) return;
    await continuePeggingAfterRender(next);
  } catch (error) {
    if (!isCurrent()) return;
    failed = true;
    state.resultOverride = [error instanceof Error ? error.message : "Request failed"];
    render(state.game);
  } finally {
    if (!isCurrent()) return;
    state.turnCutRevealStage = null;
    state.turnCutResolve = null;
    if (!failed) state.resultOverride = null;
    setAiThinking(false);
    render(state.game);
  }
}

api("/api/state")
  .then(async (game) => {
    startAiDiscardPreparation(game);
    render(game);
    markAppReady();
    if (game.phase === "ai_discarding") finishDiscardInBackground(interactionEpoch);
    else await continuePeggingAfterRender(game);
    scheduleDecisionReviewCompletion();
  })
  .catch((error) => {
    markAppReady();
    els.result.textContent = error instanceof Error ? error.message : "Request failed";
  });
