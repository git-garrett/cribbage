import { Capacitor } from "@capacitor/core";

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
} from "./api-types";
import aiBenchmarkSummary from "./ai-benchmark-summary.json";
import { maybeLoadAdSense } from "./adsense";
import { circularTurnCutPresentation, createCircularBoard, updateCircularBoard } from "./circular-board";
import { comparisonTone, type ComparisonTone } from "./comparison-difference";
import { endGameAds } from "./end-game-ad";
import { singleGameReportRows } from "./game-report";
import { rankLeaderboardWins } from "./leaderboard";
import { mergedLifetimeResults, type LifetimeScoringStats } from "./my-stats";
import { myStatsTableRows } from "./my-stats-table";
import { peggingDisplaySeries, recentPeggingCards } from "./pegging-display";
import { resolveRemoteAiBase } from "./runtime-config";
import {
  type TurnCutRevealStage,
  shouldRevealCribOwner,
  shouldShowDecisionSnapshotCut,
  shouldShowStrategicGuides,
  turnCutPresentation,
} from "./ui-visibility";
import { shouldUploadCompletedGame } from "./upload-policy";

const DEFAULT_OPPONENT: Opponent = "schell_table-peg_table-13.0";

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

interface LeaderboardPlayer {
  player: string;
  games: number;
  wins: number;
  losses: number;
  skunks: number;
  skunked: number;
  leaderboardPoints?: number;
  leaderboardPointsPerGame?: number;
  winRate: number;
  avgMargin: number;
  scoringGames?: number;
  analyzedGames?: number;
  errors?: number;
  humanScoring?: LifetimeScoringStats;
  aiScoring?: LifetimeScoringStats;
}

interface LeaderboardWin {
  player: string;
  margin: number;
  humanScore: number;
  aiScore: number;
  result: string;
  opponent: string;
  endedAt: string;
}

interface LeaderboardSummarySource {
  generatedAt: string;
  source?: string;
  model?: string;
  games: number;
  playerStats: LeaderboardPlayer[];
  bestWinRate?: LeaderboardPlayer[];
  winRate14_3?: LeaderboardPlayer[];
  bestWins?: LeaderboardWin[];
  mostSkunks: LeaderboardPlayer[];
}

const EMPTY_LEADERBOARD_SUMMARY: LeaderboardSummarySource = {
  generatedAt: "",
  source: "server-game-uploads",
  model: "13.0 public",
  games: 0,
  playerStats: [],
  winRate14_3: [],
  bestWins: [],
  mostSkunks: [],
};

type ServerBusyRetry = () => void | Promise<void>;
type AppFontSize = "normal" | "large" | "x-large";
type PathwayView = "home" | "play" | "tutorial" | "settings";

const FONT_SIZE_STORAGE_KEY = "strong-cribbage.fontSize";
const DISMISSED_GAME_OVER_STORAGE_KEY = "strong-cribbage.dismissedGameOverId";
const LEADERBOARD_CACHE_KEY = "strong-cribbage.leaderboard.v1";

function normalizeAppFontSize(value: string | null): AppFontSize {
  return value === "large" || value === "x-large" ? value : "normal";
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

function loadCachedLeaderboardSummary(): LeaderboardSummarySource | null {
  try {
    const parsed = JSON.parse(safeLocalStorageGet(LEADERBOARD_CACHE_KEY) || "null") as Partial<LeaderboardSummarySource> | null;
    if (
      !parsed ||
      typeof parsed.generatedAt !== "string" ||
      typeof parsed.games !== "number" ||
      !Array.isArray(parsed.playerStats) ||
      !Array.isArray(parsed.mostSkunks)
    ) {
      return null;
    }
    return parsed as LeaderboardSummarySource;
  } catch {
    safeLocalStorageRemove(LEADERBOARD_CACHE_KEY);
    return null;
  }
}

const cachedLeaderboardSummary = loadCachedLeaderboardSummary();

const state: {
  game: GameState | null;
  selected: Set<number>;
  pending: boolean;
  splashOpen: boolean;
  hasResumableGame: boolean;
  resultOverride: string[] | null;
  serverBusy: { retry: ServerBusyRetry | null } | null;
  parGuides: boolean;
  fontSize: AppFontSize;
  analyticsOpen: boolean;
  analyticsMode: "my" | "full";
  gameLogOpen: boolean;
  leaderboardOpen: boolean;
  leaderboardLoading: boolean;
  leaderboardLoaded: boolean;
  leaderboardFetched: boolean;
  leaderboardRevision: number;
  leaderboardAnimateNext: boolean;
  leaderboardSummary: LeaderboardSummarySource;
  modelInfoOpen: boolean;
  decisionReviewOpen: boolean;
  selectedModelInfo: Opponent;
  selectedLogGameId: string | null;
  snapshotEventId: string | null;
  dismissedGameOverId: string | null;
  gameOverAdPending: boolean;
  aiThinking: boolean;
  modelLoading: boolean;
  completingReviews: boolean;
  reviewProgress: { total: number; remaining: number } | null;
  noticeText: string;
  noticeHistory: string[];
  noticeHistoryIndex: number | null;
  noticeQueue: string[];
  noticeResultLines: string[];
  noticeUpdatedAt: number;
  noticeTimer: number | null;
  dealCutRevealStage: "cutting" | "human" | "ai" | null;
  dealCutResolve: (() => void) | null;
  dealAnimation: { key: string; dealer: string; pone: string } | null;
  animatedDealKeys: Set<string>;
  animatedTurnCutCardKeys: Set<string>;
  turnCutRevealStage: TurnCutRevealStage;
  turnCutResolve: (() => void) | null;
  cutForDealPreparation: CutForDealPreparation | null;
  aiDiscardPreparation: { key: string; promise: Promise<AiDiscardPreparationResult> } | null;
  finishingDiscardKey: string | null;
} = {
  game: null,
  selected: new Set(),
  pending: false,
  splashOpen: false,
  hasResumableGame: false,
  resultOverride: null,
  serverBusy: null,
  parGuides: safeLocalStorageGet("strong-cribbage.admin.parGuides") === "1",
  fontSize: normalizeAppFontSize(safeLocalStorageGet(FONT_SIZE_STORAGE_KEY)),
  analyticsOpen: false,
  analyticsMode: "my",
  gameLogOpen: false,
  leaderboardOpen: false,
  leaderboardLoading: false,
  leaderboardLoaded: cachedLeaderboardSummary !== null,
  leaderboardFetched: false,
  leaderboardRevision: 0,
  leaderboardAnimateNext: false,
  leaderboardSummary: cachedLeaderboardSummary ?? EMPTY_LEADERBOARD_SUMMARY,
  modelInfoOpen: false,
  decisionReviewOpen: false,
  selectedModelInfo: DEFAULT_OPPONENT,
  selectedLogGameId: null,
  snapshotEventId: null,
  dismissedGameOverId: safeLocalStorageGet(DISMISSED_GAME_OVER_STORAGE_KEY),
  gameOverAdPending: false,
  aiThinking: false,
  modelLoading: false,
  completingReviews: false,
  reviewProgress: null,
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
  animatedTurnCutCardKeys: new Set(),
  turnCutRevealStage: null,
  turnCutResolve: null,
  cutForDealPreparation: null,
  aiDiscardPreparation: null,
  finishingDiscardKey: null,
};

type TurnCutProgress = "ai-turn" | "user-turn" | null;

let interactionEpoch = 0;
let gameStateGeneration = 0;

function resetTransientGameUi(): void {
  interactionEpoch += 1;
  gameStateGeneration += 1;
  state.selected.clear();
  state.resultOverride = null;
  state.serverBusy = null;
  state.dismissedGameOverId = null;
  state.gameOverAdPending = false;
  safeLocalStorageRemove(DISMISSED_GAME_OVER_STORAGE_KEY);
  state.aiThinking = false;
  state.modelLoading = false;
  state.completingReviews = false;
  state.reviewProgress = null;
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
  state.animatedTurnCutCardKeys = new Set();
  state.turnCutRevealStage = null;
  if (state.turnCutResolve) state.turnCutResolve();
  state.turnCutResolve = null;
  state.cutForDealPreparation = null;
  state.aiDiscardPreparation = null;
  closeDecisionSnapshot();
  state.analyticsOpen = false;
  state.gameLogOpen = false;
  state.leaderboardOpen = false;
  state.modelInfoOpen = false;
  state.decisionReviewOpen = false;
}

function setAiThinking(active: boolean): void {
  state.aiThinking = active;
}

const els = {
  app: document.querySelector(".app") as HTMLElement,
  pathwayPage: document.querySelector("#pathway-page") as HTMLElement,
  pathwayViews: [...document.querySelectorAll<HTMLElement>("[data-pathway-view]")],
  pathwayTargetButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-pathway-target]")],
  pathwayBackButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-pathway-back]")],
  pathwayStatistics: document.querySelector("#pathway-statistics") as HTMLButtonElement,
  authPage: document.querySelector("#auth-page") as HTMLElement,
  authTitle: document.querySelector("#auth-title") as HTMLElement,
  authIntro: document.querySelector("#auth-intro") as HTMLElement,
  authLoginForm: document.querySelector("#auth-login-form") as HTMLFormElement,
  authOtpForm: document.querySelector("#auth-otp-form") as HTMLFormElement,
  authPasswordForm: document.querySelector("#auth-password-form") as HTMLFormElement,
  authEmail: document.querySelector("#auth-email") as HTMLInputElement,
  authPassword: document.querySelector("#auth-password") as HTMLInputElement,
  authOtp: document.querySelector("#auth-otp") as HTMLInputElement,
  authNewPassword: document.querySelector("#auth-new-password") as HTMLInputElement,
  authCodeRequest: document.querySelector("#auth-code-request") as HTMLButtonElement,
  authForgotPassword: document.querySelector("#auth-forgot-password") as HTMLButtonElement,
  authOtpBack: document.querySelector("#auth-otp-back") as HTMLButtonElement,
  authPasswordAction: document.querySelector("#auth-password-action") as HTMLButtonElement,
  authStatus: document.querySelector("#auth-status") as HTMLElement,
  authAccountRow: document.querySelector("#auth-account-row") as HTMLElement,
  authAccountName: document.querySelector("#auth-account-name") as HTMLElement,
  authLogout: document.querySelector("#auth-logout") as HTMLButtonElement,
  splashPage: document.querySelector("#splash-page") as HTMLElement,
  splashNewGame: document.querySelector("#splash-new-game") as HTMLButtonElement,
  splashResumeGame: document.querySelector("#splash-resume-game") as HTMLButtonElement,
  splashNameRow: document.querySelector("#splash-name-row") as HTMLElement,
  splashFirstName: document.querySelector("#splash-first-name") as HTMLInputElement,
  board: document.querySelector("#board") as HTMLElement,
  handNumber: document.querySelector("#hand-number") as HTMLElement,
  fontSizeSelect: document.querySelector("#font-size-select") as HTMLSelectElement,
  menuToggle: document.querySelector("#menu-toggle") as HTMLButtonElement,
  settingsPanel: document.querySelector("#settings-panel") as HTMLElement,
  adminMenu: document.querySelector("#admin-menu") as HTMLElement,
  parGuidesToggle: document.querySelector("#par-guides-toggle") as HTMLInputElement,
  appVersion: document.querySelector("#app-version") as HTMLElement,
  currentModel: document.querySelector("#current-model") as HTMLElement,
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
  leaderboardOpen: document.querySelector("#leaderboard-open") as HTMLButtonElement,
  leaderboardClose: document.querySelector("#leaderboard-close") as HTMLButtonElement,
  leaderboardPage: document.querySelector("#leaderboard-page") as HTMLElement,
  leaderboardSummary: document.querySelector("#leaderboard-summary") as HTMLElement,
  leaderboardHighlights: document.querySelector("#leaderboard-highlights") as HTMLElement,
  leaderboardList: document.querySelector("#leaderboard-list") as HTMLElement,
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
  serverBusyAlert: document.querySelector("#server-busy-alert") as HTMLElement,
  serverBusyRetry: document.querySelector("#server-busy-retry") as HTMLButtonElement,
  turnCard: document.querySelector("#turn-card") as HTMLElement,
  playAreaTitle: document.querySelector("#play-area-title") as HTMLElement,
  plays: document.querySelector("#plays") as HTMLElement,
  noticeBack: document.querySelector("#notice-back") as HTMLButtonElement,
  noticeForward: document.querySelector("#notice-forward") as HTMLButtonElement,
  userHandTitle: document.querySelector("#user-hand-title") as HTMLElement,
  userPanelHeader: document.querySelector(".user-panel-header") as HTMLElement,
  userHandMeta: document.querySelector("#user-hand-meta") as HTMLElement,
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

class ApiInteractionError extends Error {
  constructor(message = "Server Busy", options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiInteractionError";
  }
}

function renderServerBusy(): void {
  els.serverBusyAlert.hidden = !state.serverBusy;
}

function clearServerBusy(): void {
  state.serverBusy = null;
  renderServerBusy();
}

function showServerBusy(error: unknown, retry: ServerBusyRetry | null): void {
  console.warn("API interaction failed", error);
  state.serverBusy = { retry };
  state.pending = false;
  setAiThinking(false);
  renderServerBusy();
}

els.serverBusyRetry.addEventListener("click", () => {
  const retry = state.serverBusy?.retry;
  if (!retry) return;
  clearServerBusy();
  void retryAfterServerBusy(retry).catch((error) => {
    showServerBusy(error, retry);
  });
});

async function retryAfterServerBusy(retry: ServerBusyRetry): Promise<void> {
  const recovered = await reconcileRemoteGameState();
  if (recovered && await resumeReconciledGame(recovered)) return;
  await retry();
}

async function reconcileRemoteGameState(): Promise<GameState | null> {
  // An action may have reached the server even if its response was interrupted.
  // Before replaying it, use the authoritative session to avoid leaving the UI
  // behind an already-revealed cut card or an AI discard that has completed.
  if (!usesRemoteAi() || !currentSnapshot?.gameId) return null;
  return serverGameAction("state");
}

async function resumeReconciledGame(game: GameState): Promise<boolean> {
  if (game.phase === "ai_discarding") {
    await finishDiscardInBackground(interactionEpoch);
    return true;
  }
  if (game.turnCardRevealed && game.phase === "pegging") {
    await continuePeggingAfterRender(game);
    return true;
  }
  return game.turnCardRevealed && game.phase === "game_over";
}

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
const SIMPLE_NETWORK_OPPONENT: Opponent = "schell_table-peg_table-13.0";
const SIMPLE_NETWORK_PUBLIC_OPPONENTS = new Set<string>([
  "schell_table-peg_table-13.0",
]);
const SIMPLE_NETWORK_LOCAL_OPPONENTS = new Set<string>([
  ...SIMPLE_NETWORK_PUBLIC_OPPONENTS,
  "schell_table-peg_table-16.3",
  "schell_table-peg_table-16.1",
  "schell_table-peg_table-16.0",
  "schell_table-peg_table-15.2",
  "schell_table-peg_table-15.1",
  "schell_table-peg_table-15.0",
  "schell_table-peg_table-13.0",
  "schell_table-peg_table-14.3",
  "schell_table-peg_table-14.8",
  "schell_table-peg_table-14.8.1",
]);
const URL_PARAMS = new URLSearchParams(window.location.search);
const FULL_APP_MODE = URL_PARAMS.get("full") === "1" || URL_PARAMS.get("mode") === "full";
const SIMPLE_NETWORK_MODE = !FULL_APP_MODE;
const SESSION_TAG = (URL_PARAMS.get("tag") || "").trim();
const PLAYER_FIRST_NAME_KEY = "strong-cribbage.playerFirstName.v1";
const SIMPLE_NETWORK_SESSION_KEY = "strong-cribbage.simpleNetworkSession";
const REMOTE_AI_DISABLED = URL_PARAMS.get("local") === "1";
const REMOTE_AI_BASE = resolveRemoteAiBase(window.location.search, Capacitor.isNativePlatform());
const REMOTE_AI_EXPLICIT = URL_PARAMS.has("api");
const IS_VITE_DEV = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
const LOCAL_NETWORK_MODE = isLocalNetworkHostname(window.location.hostname);
const PATHWAY_NAV_ENABLED = LOCAL_NETWORK_MODE && URL_PARAMS.get("pathway") !== "0";
const AUTHENTICATION_ENABLED = !LOCAL_NETWORK_MODE || URL_PARAMS.get("auth") === "1" || REMOTE_AI_EXPLICIT;
const SIMPLE_NETWORK_LOCAL_AI_MODE = SIMPLE_NETWORK_MODE &&
  LOCAL_NETWORK_MODE &&
  (REMOTE_AI_DISABLED || (IS_VITE_DEV && !REMOTE_AI_EXPLICIT));
const SERVER_UPLOAD_KEY = "strong-cribbage.serverUploadedGames.v1";
const ADMIN_HASH = "#strong-admin-13";

let playerFirstName = (safeLocalStorageGet(PLAYER_FIRST_NAME_KEY) || "").trim();

interface AuthUser {
  username: string;
  displayName: string;
  email: string;
}

interface AuthSessionResponse {
  authenticated: boolean;
  user?: AuthUser;
}

interface AuthMessageResponse {
  ok: boolean;
  message?: string;
}

let authenticatedUser: AuthUser | null = null;
let pendingAuthEmail = "";
let pathwayStatsReturn = false;

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

interface CompletedGameUploadResponse {
  ok: boolean;
  updated?: boolean;
  leaderboard?: LeaderboardSummarySource;
}

interface AnalyticsTotals {
  games: number;
  wins: number;
  losses: number;
  skunks: number;
  skunked: number;
  doubleSkunks: number;
  doubleSkunked: number;
  analyzedGames: number;
  errors: number;
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
    const record = parsed as SavedGameRecord;
    // Snapshots from before server-authoritative reveal support may already
    // contain the turn card. Treat any missing reveal marker as private.
    if (record.snapshot.turnCardRevealed !== true || record.state.turnCardRevealed !== true) {
      record.snapshot.turnCard = null;
      record.snapshot.turnCardRevealed = false;
      record.state.turnCard = null;
      record.state.turnCardRevealed = false;
    }
    delete record.snapshot.rngState;
    return record;
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
function currentSnapshotGeneration(): number {
  return gameStateGeneration;
}

function canApplySnapshotResponse(requestSnapshot: GameSnapshot | null, requestGeneration: number): boolean {
  return currentSnapshot === requestSnapshot && gameStateGeneration === requestGeneration;
}

function applyAuthoritativeGameState(snapshot: GameSnapshot, game: GameState): void {
  currentSnapshot = snapshot;
  state.game = game;
  gameStateGeneration += 1;
  saveGame();
}

function simpleNetworkSessionValue(): string {
  return SIMPLE_NETWORK_LOCAL_AI_MODE ? "rust-13.0-14.3-14.8-14.8.1-15.0-15.1-15.2-16.0-16.1-16.3" : "rust-13.0";
}
function isValidSimpleNetworkSessionValue(value: string | null): boolean {
  return value === simpleNetworkSessionValue() || value === SIMPLE_NETWORK_OPPONENT;
}
function simpleNetworkAllowedOpponents(): Set<string> {
  return SIMPLE_NETWORK_LOCAL_AI_MODE ? SIMPLE_NETWORK_LOCAL_OPPONENTS : SIMPLE_NETWORK_PUBLIC_OPPONENTS;
}
function isAllowedSimpleNetworkOpponent(opponent: string | undefined): boolean {
  return Boolean(opponent && simpleNetworkAllowedOpponents().has(opponent));
}
function selectedMenuOpponent(): Opponent {
  return SIMPLE_NETWORK_MODE ? SIMPLE_NETWORK_OPPONENT : DEFAULT_OPPONENT;
}
const savedGame = loadSavedGame();
if (savedGame) {
  currentSnapshot = savedGame.snapshot;
  state.game = savedGame.state;
  gameStateGeneration = 1;
}
const simpleLoadedState = state.game;
state.splashOpen = SIMPLE_NETWORK_MODE && !playerFirstName;
state.hasResumableGame = SIMPLE_NETWORK_MODE &&
  isAllowedSimpleNetworkOpponent(currentSnapshot?.opponent) &&
  simpleLoadedState?.phase !== "game_over";
if (
  SIMPLE_NETWORK_MODE &&
  (
    !currentSnapshot?.opponent ||
    !isAllowedSimpleNetworkOpponent(currentSnapshot.opponent) ||
    !isValidSimpleNetworkSessionValue(safeLocalStorageGet(SIMPLE_NETWORK_SESSION_KEY)) ||
    simpleLoadedState?.phase === "game_over"
  )
) {
  currentSnapshot = null;
  state.game = null;
  gameStateGeneration += 1;
  safeLocalStorageRemove(SAVE_KEY);
}
state.hasResumableGame = SIMPLE_NETWORK_MODE &&
  isAllowedSimpleNetworkOpponent(currentSnapshot?.opponent) &&
  state.game?.phase !== "game_over";
if (SIMPLE_NETWORK_MODE) {
  safeLocalStorageSet(SIMPLE_NETWORK_SESSION_KEY, simpleNetworkSessionValue());
} else {
  safeLocalStorageRemove(SIMPLE_NETWORK_SESSION_KEY);
}
els.appVersion.textContent = displayAppVersion(__APP_VERSION__);
buildBoard();

function applyFullModeOpponentAvailability(): void {
  els.opponent.value = DEFAULT_OPPONENT;
  els.opponent.disabled = true;
  els.opponent.closest("label")?.setAttribute("hidden", "");
}

function applySimpleNetworkMode(): void {
  if (!SIMPLE_NETWORK_MODE) {
    applyFullModeOpponentAvailability();
    return;
  }
  els.app.dataset.simpleNetwork = "true";
  const allowedOpponents = simpleNetworkAllowedOpponents();
  for (const option of [...els.opponent.options]) {
    const allowed = allowedOpponents.has(option.value);
    option.hidden = !allowed;
    option.disabled = !allowed;
  }
  els.opponent.value = SIMPLE_NETWORK_OPPONENT;
  els.opponent.disabled = true;
  els.opponent.closest("label")?.setAttribute("hidden", "");
  els.gameLogOpen.hidden = true;
  els.leaderboardOpen.hidden = false;
  els.modelInfoOpen.hidden = true;
  els.exportGameLog.hidden = true;
  els.modelLoading.hidden = true;
  syncNewGameControl(state.game);
}

function applyAdminVisibility(): void {
  const showAdmin = window.location.hash === ADMIN_HASH;
  els.adminMenu.hidden = !showAdmin;
  if (!showAdmin) els.adminMenu.removeAttribute("open");
}

function applyFontSizePreference(): void {
  els.fontSizeSelect.value = state.fontSize;
  document.body.dataset.fontSize = state.fontSize;
}

applySimpleNetworkMode();
applyAdminVisibility();
applyFontSizePreference();
applyPathwayNavigation();
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

function isLocalNetworkHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  if (host.endsWith(".local")) return true;
  const parts = host.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
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
  uploadLocalCompletedGames();
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
      credentials: "include",
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      await response.text().catch(() => "");
      throw new ApiInteractionError(`Server Busy (${response.status})`);
    }
    if (!contentType.includes("application/json")) {
      throw new ApiInteractionError("Server Busy");
    }
    try {
      return await response.json() as T;
    } catch (error) {
      throw new ApiInteractionError("Server Busy", { cause: error });
    }
  } catch (error) {
    if (error instanceof ApiInteractionError) throw error;
    throw new ApiInteractionError("Server Busy", { cause: error });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function serverGetJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${REMOTE_AI_BASE}${path}`, {
      method: "GET",
      headers: { "accept": "application/json" },
      credentials: "include",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      throw new ApiInteractionError(`Server Busy (${response.status})`);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ApiInteractionError) throw error;
    throw new ApiInteractionError("Server Busy", { cause: error });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function authJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${REMOTE_AI_BASE}${path}`, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "accept": "application/json", "content-type": "application/json" }
        : { "accept": "application/json" },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Account service is temporarily unavailable.");
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") throw error;
    throw new Error("Account service is temporarily unavailable.");
  } finally {
    window.clearTimeout(timeout);
  }
}

type AuthView = "login" | "otp" | "reset" | "invite";

function showAuthView(view: AuthView, message = "", error = false): void {
  document.body.dataset.auth = "signed-out";
  els.authPage.hidden = false;
  els.splashPage.hidden = true;
  els.authLoginForm.hidden = view !== "login";
  els.authOtpForm.hidden = view !== "otp";
  els.authPasswordForm.hidden = view !== "reset" && view !== "invite";
  els.authStatus.textContent = message;
  els.authStatus.dataset.error = error ? "true" : "false";
  if (view === "reset") {
    els.authTitle.textContent = "Choose a new password.";
    els.authIntro.textContent = "Secure your Strong Cribbage account with a memorable passphrase.";
    els.authPasswordAction.textContent = "Save new password";
  } else if (view === "invite") {
    els.authTitle.textContent = "Welcome to the table.";
    els.authIntro.textContent = "Finish setting up your Strong Cribbage account.";
    els.authPasswordAction.textContent = "Set up account";
  } else if (view === "otp") {
    els.authTitle.textContent = "Check your email.";
    els.authIntro.textContent = `Enter the six-digit code sent to ${pendingAuthEmail}.`;
  } else {
    els.authTitle.textContent = "Your seat is waiting.";
    els.authIntro.textContent = "Sign in to continue your games and keep your results with your account.";
  }
  markAppReady();
}

function setAuthBusy(form: HTMLFormElement, busy: boolean): void {
  for (const control of form.querySelectorAll("button, input")) {
    (control as HTMLButtonElement | HTMLInputElement).disabled = busy;
  }
}

function authEmail(): string | null {
  const email = els.authEmail.value.trim();
  if (!email || !els.authEmail.checkValidity()) {
    els.authEmail.reportValidity();
    return null;
  }
  pendingAuthEmail = email;
  return email;
}

function finishAuthentication(user: AuthUser): void {
  const previousPlayer = playerFirstName;
  authenticatedUser = user;
  playerFirstName = user.displayName;
  if (previousPlayer && previousPlayer !== playerFirstName) {
    currentSnapshot = null;
    state.game = null;
    gameStateGeneration += 1;
    safeLocalStorageRemove(SAVE_KEY);
  }
  safeLocalStorageSet(PLAYER_FIRST_NAME_KEY, playerFirstName);
  document.body.dataset.auth = "signed-in";
  els.authPage.hidden = true;
  els.authAccountRow.hidden = false;
  els.authAccountName.textContent = user.displayName;
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("reset");
  cleanUrl.searchParams.delete("invite");
  window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}

async function initializeAuthentication(): Promise<boolean> {
  if (!AUTHENTICATION_ENABLED) {
    document.body.dataset.auth = "disabled";
    els.authAccountRow.hidden = true;
    return true;
  }
  const resetToken = URL_PARAMS.get("reset");
  const inviteToken = URL_PARAMS.get("invite");
  if (resetToken) {
    showAuthView("reset");
    window.setTimeout(() => els.authNewPassword.focus(), 0);
    return false;
  }
  if (inviteToken) {
    showAuthView("invite");
    window.setTimeout(() => els.authNewPassword.focus(), 0);
    return false;
  }
  try {
    const session = await authJson<AuthSessionResponse>("/api/auth/session");
    if (session.authenticated && session.user) {
      finishAuthentication(session.user);
      return true;
    }
    showAuthView("login");
    window.setTimeout(() => els.authEmail.focus(), 0);
    return false;
  } catch (error) {
    showAuthView("login", error instanceof Error ? error.message : "Account service is temporarily unavailable.", true);
    return false;
  }
}

async function completeAuthenticationAndStart(response: AuthSessionResponse): Promise<void> {
  if (!response.authenticated || !response.user) {
    throw new Error("The account response was incomplete.");
  }
  finishAuthentication(response.user);
  await initializeGameState();
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

function uploadCompletedGame(gameId: string, force = false): void {
  const playerTag = currentSessionTag();
  if (!shouldUploadCompletedGame({
    remoteEnabled: usesRemoteAi(),
    force,
    alreadyUploaded: uploadedGameIds().has(gameId),
    playerTag,
  })) return;
  const store = loadAnalytics();
  const events = store.events.filter((event) => event.gameId === gameId).map((event) => tagPhoneRecord(event));
  if (!events.length) return;
  const endEvent = events.find((event) => event.type === "game" && event.action === "end");
  void serverJson<CompletedGameUploadResponse>("/api/games", {
    gameId,
    tag: playerTag,
    appVersion: __APP_VERSION__,
    model: currentSnapshot?.opponent ?? SIMPLE_NETWORK_OPPONENT,
    finalResult: endEvent ?? null,
    snapshot: currentSnapshot?.gameId === gameId ? currentSnapshot : null,
    events,
  }).then((response) => {
    if (endEvent) markGameUploaded(gameId);
    if (response.updated && response.leaderboard) {
      applyLeaderboardSummary(response.leaderboard, { animate: true });
    }
  }).catch((error) => {
    console.warn("Completed game upload failed", error);
  });
}

function uploadLocalCompletedGames(force = false): void {
  if (!usesRemoteAi()) return;
  const completedGameIds = new Set(
    loadAnalytics().events
      .filter((event) => event.type === "game" && event.action === "end")
      .map((event) => event.gameId),
  );
  for (const gameId of completedGameIds) uploadCompletedGame(gameId, force);
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
  const existingIndexes = new Map(store.events.map((event, index) => [event.id, index]));
  const changedEvents: AnalyticsEvent[] = [];
  for (const event of events) {
    const taggedEvent = tagPhoneRecord(event);
    const existingIndex = existingIndexes.get(event.id);
    if (existingIndex === undefined) {
      store.events.push(taggedEvent);
      existingIndexes.set(event.id, store.events.length - 1);
      changedEvents.push(taggedEvent);
      continue;
    }
    if (JSON.stringify(store.events[existingIndex]) !== JSON.stringify(taggedEvent)) {
      store.events[existingIndex] = taggedEvent;
      changedEvents.push(taggedEvent);
    }
  }
  store.events.sort((a, b) => a.at.localeCompare(b.at));
  saveAnalytics(store);
  persistPhoneGameEvents(changedEvents);
  for (const event of changedEvents) {
    if (event.type === "game" && event.action === "end") uploadCompletedGame(event.gameId, true);
    else if ("review" in event && event.review) uploadCompletedGame(event.gameId, true);
  }
}

function markAppReady(): void {
  document.body.dataset.ready = "true";
}

function showPathwayView(view: PathwayView): void {
  if (!PATHWAY_NAV_ENABLED) return;
  els.pathwayPage.hidden = false;
  els.pathwayPage.dataset.view = view;
  for (const pathwayView of els.pathwayViews) {
    pathwayView.hidden = pathwayView.dataset.pathwayView !== view;
  }
  els.pathwayPage.scrollTo({ top: 0, left: 0 });
}

function applyPathwayNavigation(): void {
  els.pathwayPage.hidden = !PATHWAY_NAV_ENABLED;
  if (PATHWAY_NAV_ENABLED) showPathwayView("home");
}

function buildBoard(): void {
  els.board.innerHTML = "";
  els.board.append(createCircularBoard());
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

function renderBoard(game: GameState): void {
  const { scores, pegPositions, firstDealer, phase, handNumber } = game;
  const fallback = fallbackPegPositions(scores);
  const firstDealerPlayer = firstDealer === "User" ? "human" : "ai";
  const completedHands = completedHandCount(phase, handNumber);
  const showParGuides = shouldShowStrategicGuides(state.parGuides, SIMPLE_NETWORK_MODE);
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
  updateCircularBoard(els.board, game, circularTurnCutPresentation(state.turnCutRevealStage));
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
  const showParGuides = shouldShowStrategicGuides(state.parGuides, SIMPLE_NETWORK_MODE);
  void winProbabilityPhaseForGame(game);
  for (const player of ["human", "ai"] as const) {
    const pace = player === "human" ? els.humanPace : els.aiPace;
    const final = player === "human" ? els.humanFinal : els.aiFinal;
    if (!showParGuides) {
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

interface ServerGameActionResponse {
  state: GameState;
  snapshot: GameSnapshot;
}

interface RemoteGameSessionResponse {
  ok: boolean;
  session: {
    gameId: string | null;
    updatedAt: string;
    snapshot: GameSnapshot;
    state: GameState;
  } | null;
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

interface CutForDealPreparation {
  key: string;
  generation: number;
  snapshot: GameSnapshot;
  promise: Promise<ServerCutForDealPreparationResponse>;
}

async function serverGameAction(action: string, payload: Record<string, unknown> | null = null): Promise<GameState> {
  const requestSnapshot = currentSnapshot;
  const requestGeneration = currentSnapshotGeneration();
  const response = await serverJson<ServerGameActionResponse>("/api/game/action", {
    action,
    payload: payload ?? {},
    snapshot: requestSnapshot,
    tag: currentSessionTag() || null,
  });
  if (!canApplySnapshotResponse(requestSnapshot, requestGeneration)) {
    console.warn("Ignored stale game action response.", {
      action,
      requestPhase: requestSnapshot?.phase ?? null,
      currentPhase: currentSnapshot?.phase ?? null,
    });
    return state.game ?? response.state;
  }
  applyAuthoritativeGameState(response.snapshot, response.state);
  startCutForDealPreparation(response.state);
  startAiDiscardPreparation(response.state);
  return response.state;
}

function isActiveGame(game: GameState | null): game is GameState {
  return Boolean(game && game.phase !== "game_over");
}

function canStartFreshGame(game: GameState | null): boolean {
  return !game || game.phase === "game_over" || game.phase === "cut_for_deal";
}

function syncNewGameControl(game: GameState | null): boolean {
  const canStartNewGame = canStartFreshGame(game);
  els.newGame.hidden = false;
  els.newGame.disabled = !canStartNewGame;
  return canStartNewGame;
}

async function loadRemoteActiveGameSession(): Promise<GameState | null> {
  if (!usesRemoteAi()) return null;
  const tag = currentSessionTag();
  if (!tag) return null;
  const response = await serverJson<RemoteGameSessionResponse>("/api/game/session/load", {
    tag,
  });
  const session = response.session;
  if (!session || session.state.phase === "game_over") return null;
  if (SIMPLE_NETWORK_MODE && !isAllowedSimpleNetworkOpponent(session.snapshot.opponent)) return null;
  applyAuthoritativeGameState(session.snapshot, session.state);
  state.hasResumableGame = true;
  return session.state;
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
  state.cutForDealPreparation = { key, generation: currentSnapshotGeneration(), snapshot, promise };
}

function preparedCutForDealFor(game: GameState | null): CutForDealPreparation | null {
  if (!game) return null;
  const key = cutForDealPreparationKey(game);
  return key && state.cutForDealPreparation?.key === key ? state.cutForDealPreparation : null;
}

function applyPreparedCutForDeal(
  response: ServerCutForDealPreparationResponse,
  preparation: CutForDealPreparation | null = state.cutForDealPreparation,
): GameState {
  if (preparation && !canApplySnapshotResponse(preparation.snapshot, preparation.generation)) {
    console.warn("Ignored stale prepared cut-for-deal response.");
    if (state.cutForDealPreparation === preparation) state.cutForDealPreparation = null;
    return state.game ?? response.state;
  }
  applyAuthoritativeGameState(response.snapshot, response.state);
  if (!preparation || state.cutForDealPreparation === preparation) state.cutForDealPreparation = null;
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

function finishDiscardKeyFor(game: GameState | null): string | null {
  if (!game || !currentSnapshot || game.phase !== "ai_discarding") return null;
  return `${currentSnapshot.gameId ?? "game"}:${game.handNumber}:${game.dealer}`;
}

async function api(path: string, body: Record<string, unknown> | null = null): Promise<GameState> {
  try {
    if (path === "/api/state") {
      if (state.game) return state.game;
      return serverGameAction("new", { opponent: selectedMenuOpponent() });
    }
    if (path === "/api/new") {
      return serverGameAction("new", { opponent: selectedMenuOpponent() });
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
    if (path === "/api/reveal-turn-card") {
      return serverGameAction("reveal-turn-card");
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
      return serverGameAction("complete-decision-reviews", {
        limit: typeof body?.limit === "number" ? body.limit : undefined,
      });
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
  button.setAttribute("aria-label", `${card.rank} of ${card.suit}`);
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
  card.setAttribute("aria-label", "Hidden card");
  card.setAttribute("role", "img");
  return card;
}

function aiCardSlots(game: GameState): number {
  if (game.aiHandCount === 0) return 0;
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
  const compactCardLimit = 4;
  const series = peggingDisplaySeries(game);
  els.plays.innerHTML = "";
  els.plays.hidden = series.length === 0;
  els.plays.classList.toggle("pegging-history-only", series.length > 0 && series.every((group) => !group.current));
  for (const group of series) {
    const row = document.createElement("div");
    row.className = `cards ${group.current ? "played-active" : "played-archive"} pegging-row`;
    const label = group.current ? "Current pegging series" : "Prior pegging series";
    row.setAttribute("aria-label", `${label}: ${group.cards.map((card) => `${card.rank}${card.symbol}`).join(", ")}`);
    const compact = recentPeggingCards(group.cards, compactCardLimit);
    if (compact.hidden.length > 0) {
      const marker = document.createElement("span");
      marker.className = "pegging-overflow-marker";
      marker.textContent = `+${compact.hidden.length}`;
      marker.setAttribute("aria-hidden", "true");
      row.append(marker);
    }
    for (const card of compact.hidden) {
      const element = cardElement(card);
      element.classList.add("pegging-overflow-card");
      row.append(element);
    }
    for (const card of compact.visible) row.append(cardElement(card));
    els.plays.append(row);
  }
}

function cutCardText(card: NonNullable<GameState["cutForDeal"]>["human"]): string {
  return card ? `${card.rank}${card.symbol}` : "";
}

function appendCutDealerBadge(label: HTMLElement, game: GameState, player: "User" | "AI", showAiCut: boolean): void {
  if (
    !showAiCut ||
    !shouldRevealCribOwner(game.phase, state.dealCutRevealStage) ||
    game.dealer !== player
  ) return;
  const badge = document.createElement("span");
  badge.className = "dealer-button cut-dealer-badge";
  badge.textContent = "Crib";
  label.append(badge);
}

function renderDealCut(game: GameState, revealStage: "cutting" | "human" | "ai" | null = null): void {
  els.plays.innerHTML = "";
  els.plays.hidden = false;
  const row = document.createElement("div");
  row.className = "cards played-active pegging-row deal-cut-row";
  const showHumanCut = Boolean(game.cutForDeal?.human && (!revealStage || revealStage === "human" || revealStage === "ai"));
  const showAiCut = Boolean(game.cutForDeal?.ai && (!revealStage || revealStage === "ai"));
  const deck = cardBack();
  deck.classList.add("cut-deck");
  if (revealStage === "cutting") deck.classList.add("cut-deck-cutting");
  else if (revealStage === "human" || revealStage === "ai") deck.classList.add("cut-deck-cut");
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
    const waitMessage = postTurnCutWaitMessage(state.game);
    state.resultOverride = waitMessage ? [waitMessage] : null;
    if (state.game && shouldShowAiThinkingAfterTurnCut(state.game)) setAiThinking(true);
    render(state.game);
  }
  resolve();
}

function postTurnCutWaitMessage(game: GameState | null): string | null {
  if (!game) return null;
  if (game.phase === "ai_discarding") return "Waiting for AI to discard.";
  if (shouldShowAiThinkingForPegging(game)) return "Waiting for AI to play.";
  return null;
}

function shouldShowAiThinkingAfterTurnCut(game: GameState): boolean {
  return game.phase === "ai_discarding" || shouldShowAiThinkingForPegging(game);
}

function shouldAnimateTurnCutCard(game: GameState): boolean {
  if (!game.turnCard) return false;
  const gameKey = currentSnapshot?.gameId ?? "active";
  const key = `${gameKey}:${game.handNumber}:${game.turnCard.id}`;
  if (state.animatedTurnCutCardKeys.has(key)) return false;
  state.animatedTurnCutCardKeys.add(key);
  return true;
}

function makeTurnCutControl(element: HTMLElement, ariaLabel: string): void {
  element.setAttribute("role", "button");
  element.tabIndex = 0;
  element.setAttribute("aria-label", ariaLabel);
  element.addEventListener("click", completeTurnCutInteraction);
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    completeTurnCutInteraction();
  });
}

function renderTurnCut(game: GameState): void {
  const presentation = turnCutPresentation(state.turnCutRevealStage);
  if (!presentation) return;
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
  if (state.turnCutRevealStage === "user-cutting" || state.turnCutRevealStage === "ai-cutting") {
    deck.classList.add("turn-cut-deck-cutting");
  } else if (
    state.turnCutRevealStage === "user-turn" ||
    state.turnCutRevealStage === "ai-turn" ||
    state.turnCutRevealStage === "revealed"
  ) {
    deck.classList.add("turn-cut-deck-cut");
  }
  if (presentation.action) makeTurnCutControl(deck, presentation.action.ariaLabel);
  const label = document.createElement("div");
  label.className = "turn-cut-label";
  label.textContent = presentation.label;

  const showCutCard = state.turnCutRevealStage === "ai-turn" ||
    state.turnCutRevealStage === "revealed";
  if (showCutCard && game.turnCard) {
    const cut = document.createElement("div");
    cut.className = `cut-result turn-card-reveal${shouldAnimateTurnCutCard(game) ? " turn-card-reveal-animated" : ""}`;
    const cutLabel = document.createElement("span");
    cutLabel.textContent = "Cut";
    cut.append(cutLabel, cardElement(game.turnCard));
    if (state.turnCutRevealStage === "revealed") {
      makeTurnCutControl(cut, presentation.action?.ariaLabel ?? "Continue to pegging");
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
  els.gameOverClose.disabled = state.gameOverAdPending;
  els.gameOverClose.textContent = state.gameOverAdPending ? "Opening report…" : "View report";
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
  if (!dismissed) endGameAds.prepare(end.gameId);
  renderSingleGameReport(game, end);
}

function renderSingleGameReport(game: GameState, end: GameEndEvent): void {
  els.singleGameReport.innerHTML = "";
  const newGame = document.createElement("button");
  newGame.type = "button";
  newGame.className = "report-new-game";
  newGame.textContent = "New game";
  newGame.addEventListener("click", () => {
    void startNewGameFromUi({ forceNew: true });
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
  const analysis = decisionAnalysisForGame(events, end.gameId);
  report.human.analyzedGames = analysis.analyzed ? 1 : 0;
  report.human.errors = analysis.errors;
  const title = document.createElement("h2");
  title.textContent = titleText;
  const summary = document.createElement("p");
  const start = gameStartFor(events, end.gameId);
  const finalScores = end.finalScores ?? fallbackScores;
  const result = end.result && end.result !== "regular" ? `, ${end.result}` : "";
  summary.textContent = `${shortDate(end.at)} vs AI. ${playerName(end.winner ?? "human")} won ${finalScores.human}-${finalScores.ai}${result}.`;
  container.append(title, summary, singleGameReportTable(report), singleGameDecisionReview(events, end));
}

function singleGameDecisionReview(events: AnalyticsEvent[], end: GameEndEvent): HTMLElement {
  const section = document.createElement("section");
  section.className = "decision-review";
  const title = document.createElement("h3");
  title.textContent = "Decision review";
  section.append(title);

  const mistakes = sortedDecisionMistakes(events, end.gameId);
  const pending = pendingDecisionReviews(events, end.gameId);

  if (pending.length) {
    const pendingNotice = document.createElement("div");
    pendingNotice.className = "decision-review-pending";
    const canAnalyze = canAnalyzeCurrentGameDecisionReviews(end.gameId);
    const pendingBody = document.createElement("div");
    pendingBody.className = "decision-review-pending-body";
    const pendingText = document.createElement("span");
    pendingText.textContent = canAnalyze
      ? "Analyze your errors with AI 13.0 and learn how to improve:"
      : `${pending.length} user decision${pending.length === 1 ? "" : "s"} not analyzed.`;
    pendingBody.append(pendingText);
    if (state.completingReviews && state.reviewProgress) {
      const total = Math.max(1, state.reviewProgress.total);
      const remaining = Math.max(0, Math.min(total, state.reviewProgress.remaining));
      const completed = Math.max(0, total - remaining);
      const progressRow = document.createElement("div");
      progressRow.className = "decision-review-progress";
      const progress = document.createElement("progress");
      progress.max = total;
      progress.value = completed;
      const label = document.createElement("span");
      label.textContent = `Analyzed ${completed} of ${total}`;
      progressRow.append(progress, label);
      pendingBody.append(progressRow);
    }
    pendingNotice.append(pendingBody);
    if (canAnalyze) {
      const analyze = document.createElement("button");
      analyze.type = "button";
      analyze.className = "decision-review-analyze";
      analyze.textContent = state.completingReviews ? "Analyzing" : "Analyze with AI 13.0";
      analyze.disabled = state.completingReviews || state.pending;
      analyze.addEventListener("click", () => {
        void analyzeCurrentGameDecisionReviews();
      });
      pendingNotice.append(analyze);
    }
    section.append(pendingNotice);
    return section;
  }

  const model = document.createElement("p");
  model.textContent = "Compared with AI 13.0 decision analysis. Win probability is primary; point EV is supporting context.";
  const totals = decisionEvTotals(mistakes);
  section.append(model, decisionEvSummary(totals), decisionWinProbabilityImpact(totals));

  if (!mistakes.length) {
    const empty = document.createElement("div");
    empty.className = "decision-review-empty";
    empty.textContent = "No user discards or peg plays were flagged by AI 13.0 analysis.";
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

function pendingDecisionReviews(events: AnalyticsEvent[], gameId: string): Array<DiscardEvent | PeggingEvent> {
  return events.filter((event): event is DiscardEvent | PeggingEvent =>
    event.gameId === gameId &&
    ((event.type === "discard" && event.player === "human") ||
      (event.type === "pegging" && event.action === "play" && event.player === "human")) &&
    !event.review,
  );
}

function canAnalyzeCurrentGameDecisionReviews(gameId: string): boolean {
  const pendingDiscardCount = currentSnapshot?.pendingDiscardReviews?.length ?? 0;
  const pendingPeggingCount = currentSnapshot?.pendingPeggingReviews?.length ?? 0;
  return Boolean(
    state.game?.phase === "game_over" &&
      currentSnapshot?.gameId === gameId &&
      pendingDiscardCount + pendingPeggingCount > 0,
  );
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

function reviewedUserDecisions(events: AnalyticsEvent[], gameId: string): DecisionReviewEvent[] {
  return events.filter((event): event is DecisionReviewEvent =>
    event.gameId === gameId &&
    ((event.type === "discard" && event.player === "human") ||
      (event.type === "pegging" && event.action === "play" && event.player === "human")) &&
    Boolean(event.review)
  );
}

function decisionAnalysisForGame(events: AnalyticsEvent[], gameId: string): { analyzed: boolean; errors: number } {
  return {
    analyzed: reviewedUserDecisions(events, gameId).length > 0,
    errors: decisionMistakes(events, gameId).length,
  };
}

function sortedDecisionMistakes(events: AnalyticsEvent[], gameId: string): DecisionReviewEvent[] {
  return decisionMistakes(events, gameId).sort((left, right) =>
    decisionMistakeSortValue(right) - decisionMistakeSortValue(left) ||
    left.handNumber - right.handNumber ||
    events.indexOf(left) - events.indexOf(right)
  );
}

function decisionMistakeSortValue(event: DecisionReviewEvent): number {
  return decisionMistakeMagnitude(event);
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
    const impact = decisionErrorWinProbabilityImpact(event);
    const pointEvImpact = -Math.max(0, event.review.delta);
    totals.total += impact;
    totals.pointEvTotal += pointEvImpact;
    if (event.type === "discard") totals.discard += impact;
    if (event.type === "pegging") totals.pegging += impact;
    if (event.role === "dealer") totals.dealer += impact;
    if (event.role === "pone") totals.pone += impact;
  }
  return totals;
}

function decisionWinProbabilityDelta(event: DecisionReviewEvent): number {
  return Number(event.review.winProbabilityDelta ?? 0);
}

function decisionErrorWinProbabilityImpact(event: DecisionReviewEvent): number {
  return -Math.max(0, decisionWinProbabilityDelta(event));
}

function decisionMistakeMagnitude(event: DecisionReviewEvent): number {
  return Math.max(0, decisionWinProbabilityDelta(event));
}

function decisionMistakeThreshold(_event: DecisionReviewEvent): number {
  return ERROR_WIN_PROBABILITY_THRESHOLD;
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
      if (value > 0) totals[key] += value;
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
      gameIds.has(event.gameId) &&
      ((event.type === "discard" && event.player === "human") ||
        (event.type === "pegging" && event.action === "play" && event.player === "human"))
    ) {
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
  title.textContent = "User decision loss";
  const note = document.createElement("em");
  note.textContent = "Point EV, with errors identified by AI 13.0 win-probability impact.";
  card.append(title, note);
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
  impact.textContent = `Total win probability impact from reviewed errors: ${formatPercentagePointDelta(totals.total)}.`;
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
  rows.push(["Point EV impact", formatEvPoints(-Math.max(0, event.review.delta))]);
  if (event.review.selectedWinProbability !== undefined && event.review.recommendedWinProbability !== undefined) {
    rows.push(["Your win probability", formatWinProbability(event.review.selectedWinProbability)]);
    rows.push(["Advised win probability", formatWinProbability(event.review.recommendedWinProbability)]);
    rows.push(["Win probability impact", formatPercentagePointDelta(decisionErrorWinProbabilityImpact(event))]);
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
  cut.hidden = !shouldShowDecisionSnapshotCut(event.type, cutValue);
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
  if (!game || game.phase !== "discard" || game.aiHandCount !== 6) return null;
  const discarded = new Set(discardedIds);
  return {
    ...game,
    phase: "ai_discarding",
    message: "Waiting for AI to discard.",
    result: [...game.result, "User discarded two cards to the crib.", "Waiting for AI to discard."],
    turnCard: null,
    turnCardRevealed: false,
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
    ? `; win% impact ${formatPercentagePointDelta(decisionErrorWinProbabilityImpact(event))}; ${pointEv}`
    : review.delta !== 0
      ? `; point EV impact ${formatEv(-Math.max(0, review.delta))}`
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
    renderMyStats(events, scoreEvents, gameEvents);
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

function renderMyStats(
  events: AnalyticsEvent[],
  scoreEvents: ScoreEvent[],
  gameEvents: Extract<AnalyticsEvent, { type: "game" }>[],
): void {
  const completedGames = gameEvents.filter((event) => event.action === "end").length;
  const localTotals = playerAnalyticsTotals(events, scoreEvents, gameEvents);
  const lifetime = mergedLifetimeResults(
    playerFirstName,
    state.leaderboardSummary.playerStats ?? [],
    localTotals,
  );
  const serverScoringAvailable = lifetime.source === "server" && lifetime.scoringGames !== undefined;
  const totals = {
    human: { ...(serverScoringAvailable ? emptyAnalyticsTotals() : localTotals.human), ...lifetime.human },
    ai: { ...(serverScoringAvailable ? emptyAnalyticsTotals() : localTotals.ai), ...lifetime.ai },
  };
  els.analyticsTitle.textContent = "My Stats";
  els.analyticsSummary.textContent = serverScoringAvailable
    ? lifetime.scoringGames === lifetime.human.games
      ? `Scoring averages use every recorded hand across all ${lifetime.human.games} production game${lifetime.human.games === 1 ? "" : "s"}.`
      : `${lifetime.human.games} production game${lifetime.human.games === 1 ? "" : "s"}; scoring averages use every recorded hand from ${lifetime.scoringGames} game${lifetime.scoringGames === 1 ? "" : "s"} with detailed scoring.`
    : lifetime.source === "server"
      ? "Loading production scoring history…"
    : completedGames
      ? `${completedGames} completed game${completedGames === 1 ? "" : "s"} recorded on this device.`
      : "Loading merged production history…";
  els.analyticsTotals.innerHTML = "";
  els.analyticsTotals.classList.add("my-stats-comparison");
  els.analyticsTotals.append(myStatsComparisonTable(
    lifetime.player,
    totals,
    serverScoringAvailable ? lifetime.scoringGames ?? 0 : completedGames,
    lifetime.human.games,
    serverScoringAvailable,
  ));
  renderAnalyticsRows(els.analyticsGames, []);
  renderAnalyticsRows(els.analyticsHands, []);
  renderAnalyticsRows(els.analyticsScores, []);
  renderAnalyticsRows(els.analyticsPegging, []);
}

function playerAnalyticsTotals(
  events: AnalyticsEvent[],
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
  for (const game of gameEvents) {
    if (game.action !== "end") continue;
    const analysis = decisionAnalysisForGame(events, game.gameId);
    if (analysis.analyzed) human.analyzedGames += 1;
    human.errors += analysis.errors;
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
    ev.className = totals.total < 0 ? "game-log-ev has-errors" : "game-log-ev";
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

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function playerLeaderboardPoints(player: LeaderboardPlayer): number {
  return typeof player.leaderboardPoints === "number" && Number.isFinite(player.leaderboardPoints)
    ? player.leaderboardPoints
    : player.wins + player.skunks;
}

function playerLeaderboardRate(player: LeaderboardPlayer): number {
  if (typeof player.leaderboardPointsPerGame === "number" && Number.isFinite(player.leaderboardPointsPerGame)) {
    return player.leaderboardPointsPerGame;
  }
  return player.games ? playerLeaderboardPoints(player) / player.games : 0;
}

function formatLeaderboardScore(player: LeaderboardPlayer): string {
  return percentage(playerLeaderboardRate(player));
}

function formatLeaderboardPointsDetail(player: LeaderboardPlayer): string {
  return `${playerLeaderboardPoints(player)} pts in ${player.games} game${player.games === 1 ? "" : "s"}`;
}

function leaderboardSummaryKey(summary: LeaderboardSummarySource): string {
  return JSON.stringify(summary);
}

function applyLeaderboardSummary(
  summary: LeaderboardSummarySource,
  { animate = false }: { animate?: boolean } = {},
): void {
  const changed = leaderboardSummaryKey(state.leaderboardSummary) !== leaderboardSummaryKey(summary);
  state.leaderboardSummary = summary;
  state.leaderboardLoaded = true;
  safeLocalStorageSet(LEADERBOARD_CACHE_KEY, JSON.stringify(summary));
  if (!changed) return;
  state.leaderboardRevision += 1;
  state.leaderboardAnimateNext = animate && state.leaderboardOpen;
  if (state.leaderboardOpen || (state.analyticsOpen && state.analyticsMode === "my")) render(state.game);
}

async function loadInitialLeaderboard(): Promise<void> {
  if (!usesRemoteAi() || state.leaderboardFetched || state.leaderboardLoading) return;
  state.leaderboardLoading = true;
  const requestedRevision = state.leaderboardRevision;
  render(state.game);
  try {
    const summary = await serverGetJson<LeaderboardSummarySource>("/api/leaderboard");
    // A completed game may arrive while this first-load request is in flight.
    // Its upload response is newer and must win over this older snapshot.
    if (state.leaderboardRevision === requestedRevision) applyLeaderboardSummary(summary);
    state.leaderboardFetched = true;
  } catch (error) {
    console.warn("Initial leaderboard load failed", error);
  } finally {
    state.leaderboardLoading = false;
    if (state.leaderboardOpen || (state.analyticsOpen && state.analyticsMode === "my")) render(state.game);
  }
}

interface LeaderboardRowData {
  key: string;
  cells: string[];
}

let renderedLeaderboardKey = "";

function renderLeaderboard(): void {
  const loading = state.leaderboardLoading && !state.leaderboardLoaded;
  const summary = state.leaderboardSummary;
  const renderKey = `${loading ? "loading" : "ready"}:${leaderboardSummaryKey(summary)}`;
  if (renderKey === renderedLeaderboardKey) return;
  renderedLeaderboardKey = renderKey;
  const rankedPlayers = summary.playerStats?.length ? summary.playerStats : summary.winRate14_3 ?? [];
  const bestWins = rankLeaderboardWins(summary.bestWins ?? []);
  const leaderboardScope = summary.source === "rust-api-tsv"
    ? "production"
    : summary.model
      ? engineName(summary.model)
      : "production";
  els.leaderboardSummary.textContent = loading
    ? "Loading leaderboard..."
    : `${summary.games} completed ${leaderboardScope} game${summary.games === 1 ? "" : "s"} recorded.`;
  if (loading) {
    els.leaderboardHighlights.replaceChildren();
    els.leaderboardList.replaceChildren(leaderboardLoadingElement());
    return;
  }

  const animate = state.leaderboardAnimateNext;
  state.leaderboardAnimateNext = false;
  const topPlayer = rankedPlayers[0] ?? null;
  const skunks = summary.mostSkunks?.length ? summary.mostSkunks : [];
  reconcileLeaderboardCard(
    "top-score",
    "Top leaderboard score",
    topPlayer
      ? `${topPlayer.player} ${formatLeaderboardScore(topPlayer)} (${formatLeaderboardPointsDetail(topPlayer)})`
      : "No games yet",
    animate,
  );
  reconcileLeaderboardCard(
    "skunks",
    "Skunked the AI:",
    skunks.length
      ? skunks.map((player) => `${player.player} ${player.skunks}`).join(", ")
      : "No skunks yet",
    animate,
  );
  reconcileLeaderboardSection(
    "players",
    "Leaderboard score vs AI",
    rankedPlayers.map((player) => ({
      key: player.player,
      cells: [
        player.player,
        `${formatLeaderboardScore(player)} (${formatLeaderboardPointsDetail(player)})`,
        `${player.wins}-${player.losses}; skunks ${player.skunks}`,
      ],
    })),
    animate,
  );
  reconcileLeaderboardSection(
    "wins",
    "Biggest human wins",
    bestWins.map((win) => ({
      key: `${win.player}\u0000${win.endedAt}\u0000${win.margin}`,
      cells: [
        win.player,
        `Margin ${formatSigned(win.margin)}`,
        `${engineName(win.opponent)} · ${shortDate(win.endedAt)}${win.result !== "regular" ? ` · ${win.result}` : ""}`,
      ],
    })),
    animate,
  );
  reconcileLeaderboardEmpty(rankedPlayers.length === 0 && bestWins.length === 0);
}

function leaderboardLoadingElement(): HTMLElement {
  const loading = document.createElement("p");
  loading.className = "analytics-empty leaderboard-loading";
  loading.setAttribute("role", "status");
  const throbber = document.createElement("span");
  throbber.className = "throbber";
  throbber.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = "Loading leaderboard...";
  loading.append(throbber, label);
  return loading;
}

function reconcileLeaderboardCard(key: string, label: string, value: string, animate: boolean): void {
  let card = Array.from(els.leaderboardHighlights.children).find(
    (element) => (element as HTMLElement).dataset.leaderboardCard === key,
  ) as HTMLElement | undefined;
  if (!card) {
    card = document.createElement("div");
    card.className = "analytics-total";
    card.dataset.leaderboardCard = key;
    const title = document.createElement("span");
    const strong = document.createElement("strong");
    card.append(title, strong);
    els.leaderboardHighlights.append(card);
  }
  const [title, strong] = Array.from(card.children) as [HTMLElement, HTMLElement];
  title.textContent = label;
  const changed = strong.textContent !== value;
  strong.textContent = value;
  if (changed && animate) pulseLeaderboardElement(card, "leaderboard-card-updated");
}

function reconcileLeaderboardSection(
  key: string,
  title: string,
  rows: LeaderboardRowData[],
  animate: boolean,
): void {
  let section = Array.from(els.leaderboardList.children).find(
    (element) => (element as HTMLElement).dataset.leaderboardSection === key,
  ) as HTMLElement | undefined;
  if (!section) {
    section = document.createElement("section");
    section.className = "leaderboard-section";
    section.dataset.leaderboardSection = key;
    const heading = document.createElement("h2");
    heading.className = "leaderboard-section-title";
    const list = document.createElement("div");
    list.className = "leaderboard-rows";
    section.append(heading, list);
    els.leaderboardList.append(section);
  }
  const heading = section.children[0] as HTMLElement;
  const list = section.children[1] as HTMLElement;
  heading.textContent = title;
  section.hidden = rows.length === 0;

  const existingRows = new Map(
    Array.from(list.children).map((element) => [(element as HTMLElement).dataset.leaderboardRow ?? "", element as HTMLElement]),
  );
  const before = animate
    ? new Map(Array.from(existingRows.entries()).map(([rowKey, row]) => [rowKey, row.getBoundingClientRect()]))
    : new Map<string, DOMRect>();
  const nextRows: HTMLElement[] = [];
  const changedRows = new Set<HTMLElement>();
  for (const data of rows) {
    let row = existingRows.get(data.key);
    if (!row) {
      row = document.createElement("div");
      row.className = "analytics-row leaderboard-row";
      row.dataset.leaderboardRow = data.key;
      if (animate) changedRows.add(row);
    }
    if (updateLeaderboardRow(row, data.cells)) changedRows.add(row);
    nextRows.push(row);
    existingRows.delete(data.key);
  }
  for (const row of existingRows.values()) row.remove();
  for (const row of nextRows) list.append(row);
  if (!animate) return;
  for (const row of nextRows) {
    const prior = before.get(row.dataset.leaderboardRow ?? "");
    if (prior) animateLeaderboardMove(row, prior);
    if (changedRows.has(row)) pulseLeaderboardElement(row, "leaderboard-row-updated");
  }
}

function updateLeaderboardRow(row: HTMLElement, cells: string[]): boolean {
  let changed = false;
  while (row.children.length < cells.length) row.append(document.createElement("span"));
  while (row.children.length > cells.length) row.lastElementChild?.remove();
  cells.forEach((text, index) => {
    const cell = row.children[index] as HTMLElement;
    if (cell.textContent === text) return;
    cell.textContent = text;
    changed = true;
  });
  return changed;
}

function reconcileLeaderboardEmpty(empty: boolean): void {
  const existing = Array.from(els.leaderboardList.children).find(
    (element) => (element as HTMLElement).dataset.leaderboardEmpty === "true",
  ) as HTMLElement | undefined;
  if (!empty) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const message = document.createElement("p");
  message.className = "analytics-empty";
  message.dataset.leaderboardEmpty = "true";
  message.textContent = "No leaderboard data yet.";
  els.leaderboardList.append(message);
}

function animateLeaderboardMove(row: HTMLElement, prior: DOMRect): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const current = row.getBoundingClientRect();
  const deltaY = prior.top - current.top;
  if (Math.abs(deltaY) < 1 || typeof row.animate !== "function") return;
  row.animate(
    [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
    { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  );
}

function pulseLeaderboardElement(element: HTMLElement, className: string): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), 520);
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
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
  els.analyticsTotals.classList.remove("my-stats-comparison");
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
    "schell_table-peg_table-13.0",
    "schell_table-peg_table-16.3",
    "schell_table-peg_table-16.1",
    "schell_table-peg_table-16.0",
    "schell_table-peg_table-15.2",
    "schell_table-peg_table-15.1",
    "schell_table-peg_table-15.0",
    "schell_table-peg_table-14.8.1",
    "schell_table-peg_table-14.8",
    "schell_table-peg_table-14.3",
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
    analyzedGames: 0,
    errors: 0,
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

function singleGameReportTable(report: { human: AnalyticsTotals; ai: AnalyticsTotals }): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "single-game-report-table";
  table.setAttribute("aria-label", "Player and AI game comparison; difference is Player minus AI");

  const head = table.createTHead();
  const header = head.insertRow();
  for (const [label, className] of [["Metric", ""], ["Player", "human"], ["AI", "ai"], ["Diff.", "difference"]]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    if (className) cell.className = className;
    if (className === "difference") cell.title = "Player minus AI";
    cell.textContent = label;
    header.append(cell);
  }

  const body = table.createTBody();
  for (const row of singleGameReportRows(report.human, report.ai)) {
    const tableRow = body.insertRow();
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = row.label;
    const player = tableRow.insertCell();
    player.className = "human";
    player.textContent = row.player;
    applyComparisonTone(player, row.playerTone);
    const ai = tableRow.insertCell();
    ai.className = "ai";
    ai.textContent = row.ai;
    applyComparisonTone(ai, row.aiTone);
    const difference = tableRow.insertCell();
    difference.className = "difference";
    difference.textContent = row.difference;
    applyComparisonTone(difference, comparisonTone(row.difference));
    tableRow.prepend(label);
  }
  return table;
}

function myStatsComparisonTable(
  playerLabel: string,
  totals: { human: AnalyticsTotals; ai: AnalyticsTotals },
  scoringGames: number,
  lifetimeGames: number,
  serverScoring: boolean,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "my-stats-table-wrap";

  const table = document.createElement("table");
  table.className = "my-stats-table";
  table.setAttribute("aria-label", `${playerLabel} and AI statistics comparison; difference is ${playerLabel} minus AI`);

  const head = table.createTHead();
  const header = head.insertRow();
  for (const [label, className] of [["Metric", ""], [playerLabel, "human"], ["AI", "ai"], ["Diff.", "difference"]]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    if (className) cell.className = className;
    if (className === "difference") cell.title = `${playerLabel} minus AI`;
    cell.textContent = label;
    header.append(cell);
  }

  const body = table.createTBody();
  for (const row of myStatsTableRows(totals.human, totals.ai)) {
    const tableRow = body.insertRow();
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = row.label;
    const player = tableRow.insertCell();
    player.className = "human";
    player.textContent = row.player;
    const ai = tableRow.insertCell();
    ai.className = "ai";
    ai.textContent = row.ai;
    const difference = tableRow.insertCell();
    difference.className = "difference";
    difference.textContent = row.difference;
    applyComparisonTone(difference, comparisonTone(row.difference));
    tableRow.prepend(label);
  }
  section.append(table);

  if (serverScoring && scoringGames !== lifetimeGames) {
    const note = document.createElement("p");
    note.className = "my-stats-scoring-note";
    note.textContent = `${lifetimeGames - scoringGames} older game${lifetimeGames - scoringGames === 1 ? " does" : "s do"} not contain detailed scoring events and ${lifetimeGames - scoringGames === 1 ? "is" : "are"} excluded from scoring averages.`;
    section.append(note);
  }
  return section;
}

function applyComparisonTone(cell: HTMLTableCellElement, tone: ComparisonTone | undefined): void {
  if (tone) cell.classList.add(`comparison-${tone}`);
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
  const version = engine.match(/(\d+(?:\.\d+)*)$/)?.[1];
  return version ? `AI ${version}` : "AI";
}

function normalizeAnalyticsEngine(engine: string | undefined): Opponent {
  if (engine && SIMPLE_NETWORK_LOCAL_OPPONENTS.has(engine)) return engine as Opponent;
  return DEFAULT_OPPONENT;
}

function displayAppVersion(version: string): string {
  return version.replace(/^(\d+\.\d+)\.0$/, "$1");
}

function shortDate(value: string): string {
  // Older production rows used a Unix-millisecond value with a trailing Z
  // (for example, "1785700000000Z"), which is not a valid browser date.
  // Continue to render those rows while new server records use ISO 8601.
  const legacyMillis = /^\d{11,}Z?$/.test(value) ? Number(value.replace(/Z$/, "")) : NaN;
  const date = Number.isFinite(legacyMillis) ? new Date(legacyMillis) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function playAreaTitle(game: GameState): string {
  if (state.dealAnimation) return "";
  if (turnCutPresentation(state.turnCutRevealStage)) return "";
  if (state.dealCutRevealStage === "cutting") return "Cutting the deck";
  if (state.dealCutRevealStage) return "Cut result";
  if (game.phase === "cut_for_deal") return game.cutForDeal?.prompt || "Tap the deck to cut for first deal";
  if (game.phase === "discard") {
    return game.cribOwner === "User"
      ? "Select two cards to discard to your crib"
      : "Select two cards to discard to AI's crib";
  }
  if (game.phase === "ai_discarding") return "";
  if (game.phase === "pegging") return "";
  if (game.phase === "pegging_complete") return "Pegging complete";
  return "";
}

function render(game: GameState | null): void {
  if (!game) return;
  els.pathwayStatistics.disabled = false;
  syncAnalytics(game.analyticsEvents);
  state.game = game;
  if (SIMPLE_NETWORK_MODE && game.phase === "game_over") state.hasResumableGame = false;
  document.body.dataset.splash = state.splashOpen ? "true" : "false";
  els.splashPage.hidden = !state.splashOpen;
  maybeLoadAdSense({
    hostname: window.location.hostname,
    isNativePlatform: Capacitor.isNativePlatform(),
    authenticated: authenticatedUser !== null,
    splashOpen: state.splashOpen,
  });
  els.splashResumeGame.hidden = !state.hasResumableGame;
  els.splashNewGame.hidden = state.hasResumableGame;
  els.splashNameRow.hidden = Boolean(playerFirstName);
  els.splashFirstName.value = playerFirstName || els.splashFirstName.value;
  els.app.dataset.phase = game.phase;
  els.app.dataset.cutConfirming = state.dealCutResolve ? "true" : "false";
  els.app.dataset.view = state.analyticsOpen
    ? "analytics"
    : state.gameLogOpen
      ? "game-log"
      : state.leaderboardOpen
        ? "leaderboard"
        : state.modelInfoOpen
          ? "model-info"
          : state.decisionReviewOpen
            ? "decision-review"
            : "game";
  els.app.dataset.inlineResult = shouldInlineResult(game) ? "true" : "false";
  const showParGuides = shouldShowStrategicGuides(state.parGuides, SIMPLE_NETWORK_MODE);
  els.app.dataset.parGuides = showParGuides ? "true" : "false";
  els.analyticsPage.hidden = !state.analyticsOpen;
  els.gameLogPage.hidden = !state.gameLogOpen;
  els.leaderboardPage.hidden = !state.leaderboardOpen;
  els.modelInfoPage.hidden = !state.modelInfoOpen;
  els.decisionReviewPage.hidden = !state.decisionReviewOpen;
  if (state.analyticsOpen) renderAnalytics();
  if (state.gameLogOpen) renderGameLog();
  if (state.leaderboardOpen) renderLeaderboard();
  if (state.modelInfoOpen) renderModelInfoPage();
  if (state.decisionReviewOpen) renderDecisionReviewPage();
  els.humanScore.textContent = String(game.scores.human);
  els.aiScore.textContent = String(game.scores.ai);
  els.handNumber.textContent = `Hand ${game.handNumber}`;
  els.currentModel.textContent = engineName(currentSnapshot?.opponent ?? els.opponent.value ?? DEFAULT_OPPONENT);
  renderScorePace(game);
  const revealCribOwner = shouldRevealCribOwner(game.phase, state.dealCutRevealStage);
  els.humanDealer.hidden = !revealCribOwner || game.dealer !== "User";
  els.aiDealer.hidden = !revealCribOwner || game.dealer !== "AI";
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
  renderServerBusy();
  renderCutCard(state.turnCutRevealStage || !game.turnCardRevealed ? null : game.turnCard);
  renderScoring(game.scoring);
  renderResult(game);
  renderGameOver(game);
  renderBoard(game);
  const hideHandsForInterstitial = Boolean(
    state.dealAnimation ||
    state.dealCutRevealStage ||
    state.turnCutRevealStage ||
    game.phase === "cut_for_deal",
  );
  const playTitle = playAreaTitle(game);
  els.playAreaTitle.textContent = playTitle;
  els.playAreaTitle.hidden = !playTitle;
  els.plays.classList.remove("pegging-history-only");
  els.userPanelHeader.hidden = hideHandsForInterstitial;
  els.userHandTitle.hidden = false;
  els.userHandTitle.textContent = game.peggingResetPending
    ? "Press OK to continue"
    : game.phase === "cut_for_deal"
      ? "Cut for deal"
      : game.phase === "pegging"
      ? "Your hand"
      : "User hand";
  const showHandMeta = !hideHandsForInterstitial && game.phase === "pegging" && !game.peggingResetPending;
  els.userHandMeta.hidden = !showHandMeta;
  els.userHandMeta.textContent = showHandMeta
    ? `Dealer: ${game.dealer} · ${game.aiHandCount} AI ${game.aiHandCount === 1 ? "card" : "cards"}`
    : "";
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
  renderCards(els.humanHand, hideHandsForInterstitial ? [] : game.humanHand, {
    clickable: !hideHandsForInterstitial && game.phase !== "discard" && game.phase === "pegging" && game.turn === "User",
  });

  els.aiHand.innerHTML = "";
  const aiSlots = hideHandsForInterstitial ? 0 : aiCardSlots(game);
  els.aiStrip.hidden = game.phase === "game_over" || hideHandsForInterstitial || aiSlots === 0;
  for (let i = 0; i < aiSlots; i += 1) {
    const card = cardBack();
    if (i >= game.aiHandCount) {
      card.classList.add("placeholder");
      card.setAttribute("aria-hidden", "true");
    }
    els.aiHand.append(card);
  }

  const gameActive = game.phase !== "game_over";
  const canStartNewGame = syncNewGameControl(game);
  const turnCut = turnCutPresentation(state.turnCutRevealStage);
  const waitingForTurnCutClick = Boolean(turnCut?.action);
  const waitingForDealCutOk = Boolean(state.dealCutResolve);
  const selectedPlay = selectedPlayableCard(game);
  els.cutForDeal.hidden = !gameActive || (game.phase !== "cut_for_deal" && !waitingForTurnCutClick && !waitingForDealCutOk);
  els.discard.hidden = !gameActive || Boolean(state.dealAnimation) || waitingForDealCutOk || Boolean(state.turnCutRevealStage) || game.phase !== "discard";
  els.play.hidden = !gameActive || Boolean(state.dealAnimation) || waitingForDealCutOk || Boolean(state.turnCutRevealStage) || game.peggingResetPending || !(game.phase === "pegging" && game.turn === "User");
  els.go.hidden = true;
  els.discard.disabled = !(game.phase === "discard" && state.selected.size === 2);
  els.cutForDeal.textContent = turnCut?.action?.buttonLabel ?? (waitingForDealCutOk ? "OK" : "Cut deck");
  els.cutForDeal.disabled = game.phase !== "cut_for_deal" && !waitingForTurnCutClick && !waitingForDealCutOk;
  els.play.textContent = selectedPlay ? `Play ${selectedPlay.rank}${selectedPlay.symbol}` : "Select a card";
  els.play.disabled = game.peggingResetPending || !(game.phase === "pegging" && game.turn === "User" && selectedPlay);
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
    els.newGame.disabled = !canStartNewGame;
    els.continuePegging.disabled = false;
  }
}

function shouldAdvancePeggingAi(game: GameState): boolean {
  return game.phase === "pegging" && game.turn === "AI" && !game.peggingResetPending;
}

function shouldShowAiThinkingForPegging(game: GameState): boolean {
  return shouldAdvancePeggingAi(game);
}

function shouldAutoHumanGo(game: GameState): boolean {
  return game.phase === "pegging" && game.turn === "User" && game.canGo && !game.peggingResetPending;
}

async function withDelayedAiThinking<T>(game: GameState, action: () => Promise<T>): Promise<T> {
  const shouldShow = shouldShowAiThinkingForPegging(game);
  const shownAt = shouldShow ? performance.now() : 0;
  if (shouldShow) {
    setAiThinking(true);
    render(state.game);
    await waitForPaint();
  }
  try {
    return await action();
  } finally {
    if (shouldShow) {
      const elapsed = performance.now() - shownAt;
      if (elapsed < 160) await waitMs(160 - elapsed);
      setAiThinking(false);
      render(state.game);
    }
  }
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

function waitForTableMotion(ms: number): Promise<void> {
  return waitMs(state.fontSize === "x-large" ? 0 : ms);
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
  state.animatedDealKeys.add(key);
  if (state.fontSize === "x-large") return;
  const dealer = game.dealer;
  const pone = dealer === "User" ? "AI" : "User";
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

function showTurnCutStage(
  game: GameState,
  stage: Exclude<TurnCutRevealStage, null>,
  notice: string | null = null,
): void {
  state.turnCutRevealStage = stage;
  state.resultOverride = notice ? [notice] : null;
  render(game);
}

function canRevealTurnCard(game: GameState): boolean {
  return game.phase === "pegging" || game.phase === "game_over";
}

async function revealAndConfirmTurnCard(): Promise<GameState> {
  const revealedGame = await api("/api/reveal-turn-card", {});
  if (!revealedGame.turnCard || !revealedGame.turnCardRevealed) {
    throw new Error("The server did not reveal the turn card.");
  }
  showTurnCutStage(revealedGame, "revealed", `Cut card is ${cutCardText(revealedGame.turnCard)}.`);
  const confirmed = waitForTurnCutInteraction();
  await waitForPaint();
  await confirmed;
  state.turnCutRevealStage = null;
  state.turnCutResolve = null;
  state.resultOverride = null;
  render(revealedGame);
  return revealedGame;
}

async function playTurnCardReveal(game: GameState): Promise<GameState> {
  if (!canRevealTurnCard(game)) {
    render(game);
    return game;
  }
  if (game.dealer === "AI") {
    showTurnCutStage(game, "user-cut");
    await waitForPaint();
    await waitForTurnCutInteraction();
    showTurnCutStage(game, "user-cutting");
    await waitForPaint();
    await waitForTableMotion(580);
    showTurnCutStage(game, "ai-turn");
    await waitForPaint();
    await waitForTableMotion(750);
  } else {
    showTurnCutStage(game, "ai-cutting");
    await waitForPaint();
    await waitForTableMotion(650);
    showTurnCutStage(game, "user-turn");
    await waitForPaint();
    await waitForTurnCutInteraction();
  }
  return revealAndConfirmTurnCard();
}

async function playTurnCutWhileFinishingDiscard(game: GameState | null): Promise<TurnCutProgress> {
  if (!game || game.phase !== "ai_discarding") return null;
  if (game.dealer === "AI") {
    showTurnCutStage(game, "user-cut");
    await waitForPaint();
    await waitForTurnCutInteraction();
    showTurnCutStage(game, "user-cutting");
    await waitForPaint();
    await waitForTableMotion(580);
    showTurnCutStage(game, "ai-turn");
    await waitForPaint();
    await waitForTableMotion(450);
    return "ai-turn";
  }
  showTurnCutStage(game, "ai-cutting");
  await waitForPaint();
  await waitForTableMotion(650);
  showTurnCutStage(game, "user-turn");
  await waitForPaint();
  await waitForTurnCutInteraction();
  return "user-turn";
}

async function finishTurnCardReveal(game: GameState, startStage: TurnCutProgress): Promise<GameState> {
  if (!canRevealTurnCard(game)) {
    state.turnCutRevealStage = null;
    state.turnCutResolve = null;
    state.resultOverride = null;
    render(game);
    return game;
  }
  if (!startStage) {
    return playTurnCardReveal(game);
  }
  if (startStage === "ai-turn") {
    showTurnCutStage(game, "ai-turn");
    await waitForPaint();
    await waitForTableMotion(700);
  }
  return revealAndConfirmTurnCard();
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
      render(current);
      await waitForPaint();
      current = await withDelayedAiThinking(current, () => api("/api/advance-pegging", {}));
      render(current);
      continue;
    }
    return current;
  }
  throw new Error("Pegging continuation did not settle.");
}

async function analyzeCurrentGameDecisionReviews(): Promise<void> {
  if (!state.game || state.game.phase !== "game_over" || state.pending || state.completingReviews) return;
  const total = (currentSnapshot?.pendingDiscardReviews?.length ?? 0) + (currentSnapshot?.pendingPeggingReviews?.length ?? 0);
  if (!total) return;
  state.completingReviews = true;
  state.reviewProgress = { total, remaining: total };
  render(state.game);
  try {
    for (;;) {
      const beforeRemaining = (currentSnapshot?.pendingDiscardReviews?.length ?? 0) +
        (currentSnapshot?.pendingPeggingReviews?.length ?? 0);
      if (!beforeRemaining) break;
      const next = await api("/api/complete-decision-reviews", { limit: 1 });
      const remaining = (currentSnapshot?.pendingDiscardReviews?.length ?? 0) +
        (currentSnapshot?.pendingPeggingReviews?.length ?? 0);
      state.reviewProgress = { total, remaining };
      render(next);
      if (!remaining || remaining >= beforeRemaining) break;
      await waitMs(35);
    }
  } catch (error) {
    showServerBusy(error, () => analyzeCurrentGameDecisionReviews());
  } finally {
    state.completingReviews = false;
    state.reviewProgress = null;
    render(state.game);
  }
}

els.menuToggle.addEventListener("click", () => {
  const open = els.settingsPanel.hidden;
  els.settingsPanel.hidden = !open;
  els.menuToggle.setAttribute("aria-expanded", String(open));
});

for (const button of els.pathwayTargetButtons) {
  button.addEventListener("click", () => {
    const target = button.dataset.pathwayTarget as PathwayView | undefined;
    if (target) showPathwayView(target);
  });
}

for (const button of els.pathwayBackButtons) {
  button.addEventListener("click", () => showPathwayView("home"));
}

els.pathwayStatistics.addEventListener("click", () => {
  if (els.pathwayStatistics.disabled || !state.game) return;
  pathwayStatsReturn = true;
  els.pathwayPage.hidden = true;
  state.splashOpen = false;
  document.body.dataset.splash = "false";
  openAnalytics("my");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || els.pathwayPage.hidden) return;
  if (els.pathwayPage.dataset.view !== "home") showPathwayView("home");
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
  state.leaderboardOpen = false;
  state.modelInfoOpen = false;
  state.decisionReviewOpen = false;
  els.settingsPanel.hidden = true;
  els.menuToggle.setAttribute("aria-expanded", "false");
  render(state.game);
  if (mode === "my") void loadInitialLeaderboard();
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
  if (pathwayStatsReturn) {
    pathwayStatsReturn = false;
    showPathwayView("home");
  }
});

els.gameLogOpen.addEventListener("click", () => {
  closeDecisionSnapshot();
  state.gameLogOpen = true;
  state.analyticsOpen = false;
  state.leaderboardOpen = false;
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

els.leaderboardOpen.addEventListener("click", () => {
  closeDecisionSnapshot();
  state.leaderboardOpen = true;
  state.analyticsOpen = false;
  state.gameLogOpen = false;
  state.modelInfoOpen = false;
  state.decisionReviewOpen = false;
  els.settingsPanel.hidden = true;
  els.menuToggle.setAttribute("aria-expanded", "false");
  render(state.game);
  void loadInitialLeaderboard();
});

els.leaderboardClose.addEventListener("click", () => {
  state.leaderboardOpen = false;
  render(state.game);
});

els.modelInfoOpen.addEventListener("click", () => {
  closeDecisionSnapshot();
  state.selectedModelInfo = normalizeAnalyticsEngine(els.opponent.value);
  state.modelInfoOpen = true;
  state.analyticsOpen = false;
  state.gameLogOpen = false;
  state.leaderboardOpen = false;
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

els.opponent.addEventListener("change", () => {
  els.opponent.value = selectedMenuOpponent();
  render(state.game);
});

els.gameOverClose.addEventListener("click", () => {
  void openGameReportFromWinner();
});

async function openGameReportFromWinner(): Promise<void> {
  if (state.gameOverAdPending) return;
  const end = state.game ? latestGameEnd(state.game) : null;
  const gameId = end?.gameId ?? null;
  if (!gameId) return;

  state.gameOverAdPending = true;
  render(state.game);
  try {
    await endGameAds.showBeforeReport(gameId);
  } finally {
    state.gameOverAdPending = false;
  }

  const currentEnd = state.game ? latestGameEnd(state.game) : null;
  if (currentEnd?.gameId !== gameId) {
    render(state.game);
    return;
  }
  state.dismissedGameOverId = gameId;
  if (state.dismissedGameOverId) {
    safeLocalStorageSet(DISMISSED_GAME_OVER_STORAGE_KEY, state.dismissedGameOverId);
  } else {
    safeLocalStorageRemove(DISMISSED_GAME_OVER_STORAGE_KEY);
  }
  render(state.game);
}

async function cutForDeal(): Promise<void> {
  if (state.pending) return;
  state.pending = true;
  state.dealCutRevealStage = "cutting";
  render(state.game);
  await waitForPaint();
  try {
    state.resultOverride = null;
    const cutAnimation = waitForTableMotion(580);
    const preparedCut = preparedCutForDealFor(state.game);
    let next: GameState;
    if (preparedCut) {
      try {
        next = applyPreparedCutForDeal(await preparedCut.promise, preparedCut);
      } catch {
        state.cutForDealPreparation = null;
        next = await api("/api/cut-for-deal", {});
      }
    } else {
      next = await api("/api/cut-for-deal", {});
    }
    await cutAnimation;
    state.selected.clear();
    if (next.cutForDeal?.human && next.cutForDeal.ai) {
      state.dealCutRevealStage = "human";
      state.resultOverride = [`User cut ${cutCardText(next.cutForDeal.human)}.`];
      render(next);
      await waitForPaint();
      await waitForTableMotion(800);
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
  } catch (error) {
    showServerBusy(error, () => cutForDeal());
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
    state.selected = new Set(selectedIds);
    showServerBusy(error, () => els.discard.click());
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
  render(state.game);
  await waitForPaint();
  try {
    state.resultOverride = null;
    const next = await api("/api/play-human", { id: card.id });
    state.selected.clear();
    render(next);
    await waitForPaint();
    await continuePeggingAfterRender(next);
  } catch (error) {
    state.selected = new Set([card.id]);
    showServerBusy(error, () => els.play.click());
    render(state.game);
  } finally {
    state.pending = false;
    render(state.game);
  }
});

els.go.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  await waitForPaint();
  try {
    state.resultOverride = null;
    const next = await api("/api/go-human", {});
    render(next);
    await continuePeggingAfterRender(next);
  } catch (error) {
    showServerBusy(error, () => els.go.click());
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
  } catch (error) {
    showServerBusy(error, () => els.acknowledgePeggingReset.click());
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
    const next = await api("/api/continue-scoring", {});
    state.selected.clear();
    render(next);
    await playDealAnimationIfNeeded(next);
  } catch (error) {
    showServerBusy(error, () => els.continueScoring.click());
  } finally {
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
  } catch (error) {
    showServerBusy(error, () => els.continuePegging.click());
  } finally {
    state.pending = false;
    render(state.game);
  }
});

async function startNewGameFromUi({ forceNew = false }: { forceNew?: boolean } = {}): Promise<void> {
  if (state.pending) return;
  if (state.splashOpen && !saveSplashName()) return;
  if (forceNew && !canStartFreshGame(state.game)) {
    els.settingsPanel.hidden = true;
    els.menuToggle.setAttribute("aria-expanded", "false");
    render(state.game);
    return;
  }
  if (isActiveGame(state.game) && !forceNew) {
    state.splashOpen = false;
    els.settingsPanel.hidden = true;
    els.menuToggle.setAttribute("aria-expanded", "false");
    render(state.game);
    return;
  }
  resetTransientGameUi();
  state.pending = true;
  render(state.game);
  try {
    const remoteGame = forceNew ? null : await loadRemoteActiveGameSession();
    if (remoteGame) {
      state.splashOpen = false;
      els.settingsPanel.hidden = true;
      els.menuToggle.setAttribute("aria-expanded", "false");
      render(remoteGame);
      await continuePeggingAfterRender(remoteGame);
      return;
    }
    const next = await api("/api/new", { opponent: els.opponent.value });
    state.splashOpen = false;
    state.hasResumableGame = true;
    els.settingsPanel.hidden = true;
    els.menuToggle.setAttribute("aria-expanded", "false");
    render(next);
  } catch (error) {
    showServerBusy(error, () => startNewGameFromUi());
  } finally {
    state.pending = false;
    render(state.game);
  }
}

async function resumeGameFromSplash(): Promise<void> {
  if (state.pending || !state.hasResumableGame) return;
  if (!saveSplashName()) return;
  state.pending = true;
  state.splashOpen = false;
  render(state.game);
  try {
    const game = state.game ?? await loadRemoteActiveGameSession();
    if (!game) return;
    render(game);
    await continuePeggingAfterRender(game);
  } catch (error) {
    showServerBusy(error, () => resumeGameFromSplash());
  } finally {
    state.pending = false;
    render(state.game);
  }
}

els.authLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = authEmail();
  if (!email || !els.authLoginForm.reportValidity()) return;
  setAuthBusy(els.authLoginForm, true);
  showAuthView("login", "Signing in…");
  try {
    const response = await authJson<AuthSessionResponse>("/api/auth/login", {
      email,
      password: els.authPassword.value,
    });
    await completeAuthenticationAndStart(response);
  } catch (error) {
    showAuthView("login", error instanceof Error ? error.message : "Sign-in failed.", true);
  } finally {
    setAuthBusy(els.authLoginForm, false);
  }
});

els.authCodeRequest.addEventListener("click", async () => {
  const email = authEmail();
  if (!email) return;
  setAuthBusy(els.authLoginForm, true);
  showAuthView("login", "Sending a secure code…");
  try {
    const response = await authJson<AuthMessageResponse>("/api/auth/otp/request", { email });
    showAuthView("otp", response.message || "If that email belongs to an account, a sign-in code is on its way.");
    window.setTimeout(() => els.authOtp.focus(), 0);
  } catch (error) {
    showAuthView("login", error instanceof Error ? error.message : "The code could not be requested.", true);
  } finally {
    setAuthBusy(els.authLoginForm, false);
  }
});

els.authForgotPassword.addEventListener("click", async () => {
  const email = authEmail();
  if (!email) return;
  setAuthBusy(els.authLoginForm, true);
  showAuthView("login", "Requesting a private reset link…");
  try {
    const response = await authJson<AuthMessageResponse>("/api/auth/password/request", { email });
    showAuthView("login", response.message || "If that email belongs to an account, a reset link is on its way.");
  } catch (error) {
    showAuthView("login", error instanceof Error ? error.message : "The reset link could not be requested.", true);
  } finally {
    setAuthBusy(els.authLoginForm, false);
  }
});

els.authOtpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!els.authOtpForm.reportValidity()) return;
  setAuthBusy(els.authOtpForm, true);
  showAuthView("otp", "Verifying code…");
  try {
    const response = await authJson<AuthSessionResponse>("/api/auth/otp/verify", {
      email: pendingAuthEmail,
      code: els.authOtp.value.trim(),
    });
    await completeAuthenticationAndStart(response);
  } catch (error) {
    showAuthView("otp", error instanceof Error ? error.message : "The code could not be verified.", true);
  } finally {
    setAuthBusy(els.authOtpForm, false);
  }
});

els.authOtpBack.addEventListener("click", () => {
  els.authOtp.value = "";
  showAuthView("login");
});

els.authPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!els.authPasswordForm.reportValidity()) return;
  const inviteToken = URL_PARAMS.get("invite");
  const resetToken = URL_PARAMS.get("reset");
  const token = inviteToken || resetToken;
  const view: AuthView = inviteToken ? "invite" : "reset";
  if (!token) {
    showAuthView(view, "That private link is incomplete.", true);
    return;
  }
  setAuthBusy(els.authPasswordForm, true);
  showAuthView(view, "Securing your account…");
  try {
    const response = await authJson<AuthSessionResponse>(
      inviteToken ? "/api/auth/invite/accept" : "/api/auth/password/reset",
      { token, password: els.authNewPassword.value },
    );
    await completeAuthenticationAndStart(response);
  } catch (error) {
    showAuthView(view, error instanceof Error ? error.message : "The password could not be saved.", true);
  } finally {
    setAuthBusy(els.authPasswordForm, false);
  }
});

els.authLogout.addEventListener("click", async () => {
  els.authLogout.disabled = true;
  try {
    await authJson<AuthMessageResponse>("/api/auth/logout", {});
  } finally {
    safeLocalStorageRemove(PLAYER_FIRST_NAME_KEY);
    window.location.reload();
  }
});

els.splashFirstName.addEventListener("input", () => {
  els.splashFirstName.setCustomValidity("");
});

els.splashNewGame.addEventListener("click", () => {
  void startNewGameFromUi();
});

els.splashResumeGame.addEventListener("click", () => {
  void resumeGameFromSplash();
});

els.fontSizeSelect.addEventListener("change", () => {
  state.fontSize = normalizeAppFontSize(els.fontSizeSelect.value);
  safeLocalStorageSet(FONT_SIZE_STORAGE_KEY, state.fontSize);
  applyFontSizePreference();
  render(state.game);
});

els.newGame.addEventListener("click", () => {
  void startNewGameFromUi({ forceNew: true });
});

els.troubleGame.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  state.selected.clear();
  render(state.game);
  try {
    state.resultOverride = null;
    state.dismissedGameOverId = null;
    safeLocalStorageRemove(DISMISSED_GAME_OVER_STORAGE_KEY);
    els.opponent.value = SIMPLE_NETWORK_OPPONENT;
    const next = await api("/api/trouble-game", {});
    els.settingsPanel.hidden = true;
    els.menuToggle.setAttribute("aria-expanded", "false");
    render(next);
    await prepareModel13Pegging(next);
  } catch (error) {
    showServerBusy(error, () => els.troubleGame.click());
  } finally {
    setAiThinking(false);
    state.pending = false;
    render(state.game);
  }
});

window.addEventListener("resize", () => render(state.game));
window.addEventListener("pagehide", () => {
  uploadLocalCompletedGames(true);
});

async function finishDiscardInBackground(
  epoch = interactionEpoch,
  preplayedStartStage?: TurnCutProgress,
): Promise<void> {
  const isCurrent = (): boolean => epoch === interactionEpoch;
  const finishKey = finishDiscardKeyFor(state.game);
  if (finishKey && state.finishingDiscardKey === finishKey) return;
  state.finishingDiscardKey = finishKey;
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
    const revealedGame = await finishTurnCardReveal(next, startStage);
    if (!isCurrent()) return;
    setAiThinking(true);
    await prepareModel13Pegging(revealedGame);
    if (!isCurrent()) return;
    await continuePeggingAfterRender(revealedGame);
  } catch (error) {
    if (!isCurrent()) return;
    failed = true;
    showServerBusy(error, () => finishDiscardInBackground(epoch, preplayedStartStage));
    render(state.game);
  } finally {
    if (!finishKey || state.finishingDiscardKey === finishKey) state.finishingDiscardKey = null;
    if (!isCurrent()) return;
    state.turnCutRevealStage = null;
    state.turnCutResolve = null;
    if (!failed) state.resultOverride = null;
    setAiThinking(false);
    render(state.game);
  }
}

async function initializeGameState(): Promise<void> {
  try {
    uploadLocalCompletedGames(true);
    const remoteGame = await loadRemoteActiveGameSession();
    const initialGame = remoteGame ?? await api("/api/state");
    startCutForDealPreparation(initialGame);
    startAiDiscardPreparation(initialGame);
    render(initialGame);
    markAppReady();
    if (initialGame.phase === "ai_discarding") finishDiscardInBackground(interactionEpoch);
    else await continuePeggingAfterRender(initialGame);
  } catch (error) {
    markAppReady();
    showServerBusy(error, () => initializeGameState());
  }
}

async function initializeApplication(): Promise<void> {
  if (await initializeAuthentication()) {
    await initializeGameState();
  }
}

void initializeApplication();
