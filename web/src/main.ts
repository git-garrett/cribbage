import { Capacitor } from "@capacitor/core";

import type {
  AnalyticsDecisionReview,
  AnalyticsEvent,
  AnalyticsScoreCategory,
  AnalyticsRole,
  GameSnapshot,
  GameState,
  Opponent,
  Phase,
  PlayerKey,
  ScorePhase,
} from "./api-types";
import {
  aceAdviceDecisionKey,
  isAceAdviceOpponent,
  mistakeAdviceForChoice,
  type AceAdviceAction,
} from "./ace-advice";
import { ACE_OPPONENTS, isAceOpponent, PRODUCTION_ACE_OPPONENT } from "./ace-opponent";
import aiBenchmarkSummary from "./ai-benchmark-summary.json";
import { maybeLoadAdSense } from "./adsense";
import {
  ActivityTracker,
  activityEnvironment,
  activityTarget,
  currentActivityClient,
  safeActivityPage,
} from "./activity";
import { AuthenticationRequiredError, shouldRecoverExpiredSession } from "./auth-recovery";
import { circularTurnCutPresentation, createCircularBoard, updateCircularBoard } from "./circular-board";
import { comparisonTone, type ComparisonTone } from "./comparison-difference";
import {
  DYNAMIC_CALIBRATING_LABEL,
  dynamicCardCopy,
  dynamicHandicapPointsCopy,
  dynamicProvisionalHandicapCopy,
  freshestDynamicCalibration,
  isDynamicCalibrating,
  playerHandicapCopy,
  type DynamicCalibration,
} from "./dynamic-calibration";
import { endGameAds } from "./end-game-ad";
import { shouldAnimateScoringCards, shouldShowScoreBubble } from "./fast-counting-policy";
import { singleGameReportRows } from "./game-report";
import {
  gameAnalysisProgress,
  helpCountForGame,
  pendingAnalysisGameIds,
} from "./game-analysis";
import {
  leaderboardMetricValue,
  rankLeaderboardHandicaps,
  rankLeaderboardMetricPlayers,
  type LeaderboardMetric,
  type LeaderboardWindow,
} from "./leaderboard";
import { mergedLifetimeResults, type LifetimeScoringStats } from "./my-stats";
import { myStatsTableRows } from "./my-stats-table";
import { resumablePathwayDestinations } from "./pathway-resume";
import { peggingDisplayCardLimit, peggingDisplaySeries, recentPeggingCards } from "./pegging-display";
import { opponentGoEvent } from "./pegging-presentation";
import { resolveRemoteAiBase } from "./runtime-config";
import { shouldRestoreSavedGameSurface } from "./resume-surface";
import { isCoherentSavedGameState } from "./saved-game-state";
import { scoringTitle } from "./scoring-title";
import { analyticsForStatsOpponent, statsOpponentForModel } from "./stats-opponent";
import {
  handScoreNoticeParts,
  peggingScoreNoticeParts,
  scoreNoticeEmphasisCardIds,
  scoreSummaryPoints,
  shouldAnnounceScoreEvent,
} from "./score-notice-policy";
import {
  baselineScoreEvents,
  collectNewScoreEvents,
  createScoreNoticeCursor,
  currentScoringScoreEvent,
  scoreboardStateForScoringConfirmation,
  scoreEventsForGame,
  type ScoreEvent,
  type ScoreNoticeCursor,
} from "./score-notice-cursor";
import {
  type TurnCutRevealStage,
  shouldRevealCribOwner,
  shouldOfferMasterHint,
  shouldShowDecisionSnapshotCut,
  shouldShowStrategicGuides,
  turnCutPresentation,
} from "./ui-visibility";
import { shouldUploadCompletedGame } from "./upload-policy";

const DEFAULT_OPPONENT: Opponent = PRODUCTION_ACE_OPPONENT;
const DECISION_REVIEWER_NAME = "Ace";
const MAX_FEEDBACK_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const FEEDBACK_SCREENSHOT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PATHWAY_OPPONENTS = {
  easy: "myrmidon-5",
  tough: "schell_table-peg_table-9.11",
  master: DEFAULT_OPPONENT,
  dynamic: "dynamic",
} as const satisfies Record<string, Opponent>;

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
  cribbagePointsScored?: number;
  cribbagePointsAgainst?: number;
  leaderboardScore?: number;
  leaderboardPointsPerGame?: number;
  pointDifferential?: number;
  winRate: number;
  avgMargin: number;
  scoringGames?: number;
  analyzedGames?: number;
  errors?: number;
  humanScoring?: LifetimeScoringStats;
  aiScoring?: LifetimeScoringStats;
}

interface DynamicHandicapSummary {
  wpPerGame: number;
  cycles: number;
  cyclesPerGame: number;
  evaluatorVersion: string;
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
  playerStatsByOpponent?: Partial<Record<MyStatsOpponent, LeaderboardPlayer[]>>;
  playerStatsByWindow?: Partial<Record<LeaderboardWindow, LeaderboardPlayer[]>>;
  playerHandicaps?: Record<string, DynamicHandicapSummary>;
  bestWinRate?: LeaderboardPlayer[];
  winRate14_3?: LeaderboardPlayer[];
  bestWins?: LeaderboardWin[];
  mostSkunks: LeaderboardPlayer[];
}

type GameNoticeBase = {
  key: string;
  text: string;
  label: string;
  player: PlayerKey;
  anchor: "play" | "cut" | "scoring";
  emphasizedCardIds: number[];
};

type GameNotice = GameNoticeBase & (
  | { kind: "score"; points: number }
  | { kind: "go"; callout: "GO"; playerText: string }
  | { kind: "start"; callout: string; playerText: string }
);

interface ScoreSummary {
  key: string;
  category: "hand" | "crib";
  title: string;
  points: number;
  items: Array<{ label: string; points: number }>;
  nextLabel: string;
}

const EMPTY_LEADERBOARD_SUMMARY: LeaderboardSummarySource = {
  generatedAt: "",
  source: "server-game-uploads",
  model: "13.0 public",
  games: 0,
  playerStats: [],
  playerStatsByOpponent: {},
  playerHandicaps: {},
  winRate14_3: [],
  bestWins: [],
  mostSkunks: [],
};

type ServerBusyRetry = () => void | Promise<void>;
type AppFontSize = "normal" | "large" | "x-large";
type ScoringTransitionStage = "leaving" | "entering" | null;
type PathwayView = "home" | "play" | "human" | "tutorial" | "settings" | "gameplay";
type PathwayRoute = PathwayView | "statistics" | "leaderboard";
type MyStatsOpponent = "master" | "human" | "easy" | "tough" | "grandmaster" | "dynamic";
type StatsView = "stats" | "game-log";
type GameLogView = "games" | "errors";

const MY_STATS_OPPONENT_LABEL: Record<MyStatsOpponent, string> = {
  master: "Ace",
  human: "Human opponents",
  easy: "Easy",
  tough: "Tough",
  grandmaster: "Legend",
  dynamic: "Dynamic",
};

const FONT_SIZE_STORAGE_KEY = "strong-cribbage.fontSize";
const FAST_COUNTING_STORAGE_KEY = "strong-cribbage.fastCounting.v1";
const HINTS_ENABLED_STORAGE_KEY = "strong-cribbage.hintsEnabled.v1";
const ERROR_NOTICES_ENABLED_STORAGE_KEY = "strong-cribbage.errorNoticesEnabled.v1";
const DISMISSED_GAME_OVER_STORAGE_KEY = "strong-cribbage.dismissedGameOverId";
const LEADERBOARD_CACHE_KEY = "strong-cribbage.leaderboard.v1";
const PEOPLE_IDLE_MS = 15 * 60 * 1000;
const PEOPLE_POLL_MS = 60_000;
const PEOPLE_ACTIVITY_HEARTBEAT_MIN_MS = PEOPLE_POLL_MS;
const PEOPLE_CHALLENGE_RETRY_MS = 1_500;
const PEOPLE_CHALLENGE_ATTENTION_MS = 2_400;
const HUMAN_GAME_WATCH_RETRY_MS = 1_000;

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
  fastCounting: boolean;
  hintsEnabled: boolean;
  errorNoticesEnabled: boolean;
  analyticsOpen: boolean;
  engagementOpen: boolean;
  analyticsMode: "my" | "full";
  statsView: StatsView;
  gameLogView: GameLogView;
  myStatsOpponent: MyStatsOpponent;
  leaderboardOpen: boolean;
  leaderboardMetric: LeaderboardMetric;
  leaderboardWindow: LeaderboardWindow;
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
  noticeQueue: GameNotice[];
  noticeResultLines: string[];
  noticeTimer: number | null;
  activeNotice: GameNotice | null;
  peggingScoreNoticeHeld: boolean;
  scoreNoticeCursor: ScoreNoticeCursor;
  announcedGoNoticeKeys: Set<string>;
  dealCutRevealStage: "cutting" | "human" | "ai" | null;
  dealCutIndex: number | null;
  dealAiCutIndex: number | null;
  dealCutResolve: (() => void) | null;
  scoreSummaryQueue: ScoreSummary[];
  activeScoreSummary: ScoreSummary | null;
  confirmedScoreSummaryKey: string | null;
  scoringTransitionStage: ScoringTransitionStage;
  dealAnimation: { key: string; dealer: string; pone: string } | null;
  animatedDealKeys: Set<string>;
  animatedDiscardKeys: Set<string>;
  animatedTurnCutCardKeys: Set<string>;
  turnCutRevealStage: TurnCutRevealStage;
  turnCutResolve: (() => void) | null;
  cutForDealPreparation: CutForDealPreparation | null;
  aiDiscardPreparation: { key: string; promise: Promise<AiDiscardPreparationResult> } | null;
  finishingDiscardKey: string | null;
  aceAdvicePreparation: AceAdvicePreparation | null;
  aceMistake: AceMistake | null;
  masterHint: PresentedAceAdvice | null;
  pendingPathwayRoute: PathwayRoute | null;
  pendingMasterGameId: string | null;
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
  fastCounting: safeLocalStorageGet(FAST_COUNTING_STORAGE_KEY) === "1",
  hintsEnabled: safeLocalStorageGet(HINTS_ENABLED_STORAGE_KEY) !== "0",
  errorNoticesEnabled: safeLocalStorageGet(ERROR_NOTICES_ENABLED_STORAGE_KEY) !== "0",
  analyticsOpen: false,
  engagementOpen: false,
  analyticsMode: "my",
  statsView: "stats",
  gameLogView: "games",
  myStatsOpponent: "master",
  leaderboardOpen: false,
  leaderboardMetric: "handicap",
  leaderboardWindow: "monthly",
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
  noticeQueue: [],
  noticeResultLines: [],
  noticeTimer: null,
  activeNotice: null,
  peggingScoreNoticeHeld: false,
  scoreNoticeCursor: createScoreNoticeCursor(),
  announcedGoNoticeKeys: new Set(),
  dealCutRevealStage: null,
  dealCutIndex: null,
  dealAiCutIndex: null,
  dealCutResolve: null,
  scoreSummaryQueue: [],
  activeScoreSummary: null,
  confirmedScoreSummaryKey: null,
  scoringTransitionStage: null,
  dealAnimation: null,
  animatedDealKeys: new Set(),
  animatedDiscardKeys: new Set(),
  animatedTurnCutCardKeys: new Set(),
  turnCutRevealStage: null,
  turnCutResolve: null,
  cutForDealPreparation: null,
  aiDiscardPreparation: null,
  finishingDiscardKey: null,
  aceAdvicePreparation: null,
  aceMistake: null,
  masterHint: null,
  pendingPathwayRoute: null,
  pendingMasterGameId: null,
};

type TurnCutProgress = "ai-turn" | "user-turn" | null;

let interactionEpoch = 0;
let gameStateGeneration = 0;
let aceMistakeChoiceRevision = 0;

function resetTransientGameUi(): void {
  interactionEpoch += 1;
  gameStateGeneration += 1;
  aceMistakeChoiceRevision += 1;
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
  state.noticeResultLines = [];
  state.scoreNoticeCursor = createScoreNoticeCursor();
  state.announcedGoNoticeKeys = new Set();
  clearNoticeQueue();
  state.dealCutRevealStage = null;
  state.dealCutIndex = null;
  state.dealAiCutIndex = null;
  if (state.dealCutResolve) state.dealCutResolve();
  state.dealCutResolve = null;
  state.scoreSummaryQueue = [];
  state.activeScoreSummary = null;
  state.confirmedScoreSummaryKey = null;
  state.scoringTransitionStage = null;
  state.dealAnimation = null;
  state.animatedDealKeys = new Set();
  state.animatedDiscardKeys = new Set();
  state.animatedTurnCutCardKeys = new Set();
  state.turnCutRevealStage = null;
  if (state.turnCutResolve) state.turnCutResolve();
  state.turnCutResolve = null;
  state.cutForDealPreparation = null;
  state.aiDiscardPreparation = null;
  state.aceAdvicePreparation = null;
  state.aceMistake = null;
  state.masterHint = null;
  state.pendingPathwayRoute = null;
  state.pendingMasterGameId = null;
  els.masterSessionDialog.hidden = true;
  closeDecisionSnapshot();
  state.analyticsOpen = false;
  state.engagementOpen = false;
  state.leaderboardOpen = false;
  state.modelInfoOpen = false;
  state.decisionReviewOpen = false;
}

function setAiThinking(active: boolean): void {
  state.aiThinking = active;
}

const els = {
  app: document.querySelector(".app") as HTMLElement,
  topbar: document.querySelector(".app > .topbar") as HTMLElement,
  table: document.querySelector(".table") as HTMLElement,
  actions: document.querySelector(".app > .table .actions") as HTMLElement,
  scoreboard: document.querySelector(".app > .scoreboard") as HTMLElement,
  dynamicCalibrationStatus: document.querySelector("#dynamic-calibration-status") as HTMLElement,
  dynamicCalibrationHandicap: document.querySelector("#dynamic-calibration-handicap") as HTMLElement,
  played: document.querySelector(".app > .table > .played") as HTMLElement,
  aceTools: document.querySelector("#ace-tools") as HTMLElement,
  pathwayPage: document.querySelector("#pathway-page") as HTMLElement,
  pathwayBrandbar: document.querySelector(".pathway-brandbar") as HTMLElement,
  pathwayLogoHome: document.querySelector("#pathway-logo-home") as HTMLAnchorElement,
  pathwayHeaderHome: document.querySelector("#pathway-header-home") as HTMLButtonElement,
  pathwayHeaderParentLabel: document.querySelector("#pathway-header-parent-label") as HTMLElement,
  pathwayViews: [...document.querySelectorAll<HTMLElement>("[data-pathway-view]")],
  pathwayTargetButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-pathway-target]")],
  pathwayBackButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-pathway-back]")],
  pathwayDestinationButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-pathway-destination]")],
  dynamicCardCopy: document.querySelector("#dynamic-card-copy") as HTMLElement,
  pathwayStatistics: document.querySelector("#pathway-statistics") as HTMLButtonElement,
  pathwayLeaderboard: document.querySelector("#pathway-leaderboard") as HTMLButtonElement,
  engagementPathwayOpen: document.querySelector("#engagement-pathway-open") as HTMLButtonElement,
  bugReportOpen: document.querySelector("#bug-report-open") as HTMLButtonElement,
  bugReportDialog: document.querySelector("#bug-report-dialog") as HTMLDialogElement,
  bugReportForm: document.querySelector("#bug-report-form") as HTMLFormElement,
  bugReportDescription: document.querySelector("#bug-report-description") as HTMLTextAreaElement,
  bugReportScreenshot: document.querySelector("#bug-report-screenshot") as HTMLInputElement,
  bugReportStatus: document.querySelector("#bug-report-status") as HTMLElement,
  bugReportClose: document.querySelector("#bug-report-close") as HTMLButtonElement,
  bugReportCancel: document.querySelector("#bug-report-cancel") as HTMLButtonElement,
  bugReportSubmit: document.querySelector("#bug-report-submit") as HTMLButtonElement,
  featureRequestOpen: document.querySelector("#feature-request-open") as HTMLButtonElement,
  featureRequestDialog: document.querySelector("#feature-request-dialog") as HTMLDialogElement,
  featureRequestForm: document.querySelector("#feature-request-form") as HTMLFormElement,
  featureRequestDescription: document.querySelector("#feature-request-description") as HTMLTextAreaElement,
  featureRequestStatus: document.querySelector("#feature-request-status") as HTMLElement,
  featureRequestClose: document.querySelector("#feature-request-close") as HTMLButtonElement,
  featureRequestCancel: document.querySelector("#feature-request-cancel") as HTMLButtonElement,
  featureRequestSubmit: document.querySelector("#feature-request-submit") as HTMLButtonElement,
  peoplePresence: document.querySelector("#people-presence") as HTMLElement,
  peoplePresenceToggle: document.querySelector("#people-presence-toggle") as HTMLButtonElement,
  peoplePresenceLabel: document.querySelector("#people-presence-label") as HTMLElement,
  peoplePresenceAlert: document.querySelector("#people-presence-alert") as HTMLElement,
  peoplePresencePanel: document.querySelector("#people-presence-panel") as HTMLElement,
  peoplePresenceClose: document.querySelector("#people-presence-close") as HTMLButtonElement,
  peopleTableSection: document.querySelector("#people-table-section") as HTMLElement,
  peopleTableList: document.querySelector("#people-table-list") as HTMLElement,
  peopleChallengeSection: document.querySelector("#people-challenge-section") as HTMLElement,
  peopleChallengeList: document.querySelector("#people-challenge-list") as HTMLElement,
  peopleOnlineList: document.querySelector("#people-online-list") as HTMLElement,
  humanDirectory: document.querySelector("#human-directory") as HTMLElement,
  peopleProfilePage: document.querySelector("#people-profile-page") as HTMLElement,
  peopleProfileBack: document.querySelector("#people-profile-back") as HTMLButtonElement,
  peopleProfileAvatar: document.querySelector("#people-profile-avatar") as HTMLElement,
  peopleProfileTitle: document.querySelector("#people-profile-title") as HTMLElement,
  peopleProfilePresence: document.querySelector("#people-profile-presence") as HTMLElement,
  peopleProfileHandicap: document.querySelector("#people-profile-handicap") as HTMLElement,
  peopleProfilePlay: document.querySelector("#people-profile-play") as HTMLButtonElement,
  peopleProfileHeadToHead: document.querySelector("#people-profile-head-to-head") as HTMLElement,
  peopleProfileHeadToHeadGames: document.querySelector("#people-profile-head-to-head-games") as HTMLElement,
  peopleProfileHeadToHeadScore: document.querySelector("#people-profile-head-to-head-score") as HTMLElement,
  peopleProfileHeadToHeadViewerWins: document.querySelector("#people-profile-head-to-head-viewer-wins") as HTMLElement,
  peopleProfileHeadToHeadProfileWins: document.querySelector("#people-profile-head-to-head-profile-wins") as HTMLElement,
  peopleProfileHeadToHeadOpponent: document.querySelector("#people-profile-head-to-head-opponent") as HTMLElement,
  peopleProfileHeadToHeadSummary: document.querySelector("#people-profile-head-to-head-summary") as HTMLElement,
  peopleProfileForm: document.querySelector("#people-profile-form") as HTMLFormElement,
  peopleProfileUsername: document.querySelector("#people-profile-username") as HTMLInputElement,
  peopleProfileEmail: document.querySelector("#people-profile-email") as HTMLInputElement,
  peopleProfileImage: document.querySelector("#people-profile-image") as HTMLInputElement,
  peopleProfileSave: document.querySelector("#people-profile-save") as HTMLButtonElement,
  peoplePasswordReset: document.querySelector("#people-password-reset") as HTMLButtonElement,
  peopleProfileStatus: document.querySelector("#people-profile-status") as HTMLElement,
  humanTablePage: document.querySelector("#human-table-page") as HTMLElement,
  humanTableBack: document.querySelector("#human-table-back") as HTMLButtonElement,
  humanTableTitle: document.querySelector("#human-table-title") as HTMLElement,
  humanTableMessage: document.querySelector("#human-table-message") as HTMLElement,
  humanTableChallenger: document.querySelector("#human-table-challenger") as HTMLElement,
  humanTableChallenged: document.querySelector("#human-table-challenged") as HTMLElement,
  humanTableCuts: document.querySelector("#human-table-cuts") as HTMLElement,
  humanTableCut: document.querySelector("#human-table-cut") as HTMLButtonElement,
  humanTableStatus: document.querySelector("#human-table-status") as HTMLElement,
  sizeDialog: document.querySelector("#size-dialog") as HTMLDialogElement,
  sizeDialogClose: document.querySelector("#size-dialog-close") as HTMLButtonElement,
  sizeDialogSave: document.querySelector("#size-dialog-save") as HTMLButtonElement,
  sizeDialogStatus: document.querySelector("#size-dialog-status") as HTMLElement,
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
  authCancel: document.querySelector("#auth-cancel") as HTMLButtonElement,
  authAccountRow: document.querySelector("#auth-account-row") as HTMLElement,
  authAccountProfile: document.querySelector("#auth-account-profile") as HTMLButtonElement,
  authLogout: document.querySelector("#auth-logout") as HTMLButtonElement,
  authLoginRow: document.querySelector("#auth-login-row") as HTMLElement,
  authLogin: document.querySelector("#auth-login") as HTMLButtonElement,
  splashPage: document.querySelector("#splash-page") as HTMLElement,
  splashEyebrow: document.querySelector("#splash-eyebrow") as HTMLElement,
  splashDescription: document.querySelector("#splash-description") as HTMLElement,
  splashNewGame: document.querySelector("#splash-new-game") as HTMLButtonElement,
  splashResumeGame: document.querySelector("#splash-resume-game") as HTMLButtonElement,
  splashNameRow: document.querySelector("#splash-name-row") as HTMLElement,
  splashFirstName: document.querySelector("#splash-first-name") as HTMLInputElement,
  board: document.querySelector("#board") as HTMLElement,
  appBrandHome: document.querySelector("#app-brand-home") as HTMLAnchorElement,
  appBack: document.querySelector("#app-back") as HTMLButtonElement,
  appBackLabel: document.querySelector("#app-back-label") as HTMLElement,
  mobileHeaderReveal: document.querySelector("#mobile-header-reveal") as HTMLButtonElement,
  fontSizeSelect: document.querySelector("#font-size-select") as HTMLSelectElement,
  fastCounting: document.querySelector("#fast-counting") as HTMLInputElement,
  hintsEnabled: document.querySelector("#hints-enabled") as HTMLInputElement,
  errorNoticesEnabled: document.querySelector("#error-notices-enabled") as HTMLInputElement,
  // The shared header no longer has a hamburger. This inert element keeps the
  // retired menu's developer-only actions safely disconnected for now.
  menuToggle: document.createElement("button"),
  settingsPanel: document.querySelector("#settings-panel") as HTMLElement,
  adminMenu: document.querySelector("#admin-menu") as HTMLElement,
  engagementMenuOpen: document.querySelector("#engagement-menu-open") as HTMLButtonElement,
  parGuidesToggle: document.querySelector("#par-guides-toggle") as HTMLInputElement,
  appVersion: document.querySelector("#app-version") as HTMLElement,
  currentModel: document.querySelector("#current-model") as HTMLElement,
  myStatsOpen: document.querySelector("#my-stats-open") as HTMLButtonElement,
  analyticsOpen: document.querySelector("#analytics-open") as HTMLButtonElement,
  engagementPage: document.querySelector("#engagement-page") as HTMLElement,
  engagementClose: document.querySelector("#engagement-close") as HTMLButtonElement,
  engagementRange: document.querySelector("#engagement-range") as HTMLSelectElement,
  engagementEnvironment: document.querySelector("#engagement-environment") as HTMLSelectElement,
  engagementAudience: document.querySelector("#engagement-audience") as HTMLSelectElement,
  engagementRefresh: document.querySelector("#engagement-refresh") as HTMLButtonElement,
  engagementExport: document.querySelector("#engagement-export") as HTMLButtonElement,
  engagementSummary: document.querySelector("#engagement-summary") as HTMLElement,
  engagementStatus: document.querySelector("#engagement-status") as HTMLElement,
  engagementContent: document.querySelector("#engagement-content") as HTMLElement,
  engagementTabButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-engagement-tab]")],
  engagementPanels: [...document.querySelectorAll<HTMLElement>("[data-engagement-panel]")],
  engagementInsights: document.querySelector("#engagement-insights") as HTMLElement,
  engagementOverview: document.querySelector("#engagement-overview") as HTMLElement,
  engagementDefinitions: document.querySelector("#engagement-definitions") as HTMLElement,
  engagementActivityChart: document.querySelector("#engagement-activity-chart") as HTMLElement,
  engagementFunnel: document.querySelector("#engagement-funnel") as HTMLElement,
  engagementUsers: document.querySelector("#engagement-users") as HTMLElement,
  engagementRecent: document.querySelector("#engagement-recent") as HTMLElement,
  engagementHealth: document.querySelector("#engagement-health") as HTMLElement,
  engagementExperienceChart: document.querySelector("#engagement-experience-chart") as HTMLElement,
  engagementInteractions: document.querySelector("#engagement-interactions") as HTMLElement,
  engagementErrors: document.querySelector("#engagement-errors") as HTMLElement,
  engagementSurfaces: document.querySelector("#engagement-surfaces") as HTMLElement,
  engagementPathways: document.querySelector("#engagement-pathways") as HTMLElement,
  engagementOpponents: document.querySelector("#engagement-opponents") as HTMLElement,
  engagementDevices: document.querySelector("#engagement-devices") as HTMLElement,
  engagementClients: document.querySelector("#engagement-clients") as HTMLElement,
  engagementEnvironments: document.querySelector("#engagement-environments") as HTMLElement,
  engagementLocations: document.querySelector("#engagement-locations") as HTMLElement,
  engagementEvents: document.querySelector("#engagement-events") as HTMLElement,
  engagementStates: document.querySelector("#engagement-states") as HTMLElement,
  engagementDaily: document.querySelector("#engagement-daily") as HTMLElement,
  exportGameLog: document.querySelector("#export-game-log") as HTMLButtonElement,
  troubleGame: document.querySelector("#trouble-game") as HTMLButtonElement,
  analyticsPage: document.querySelector("#analytics-page") as HTMLElement,
  analyticsTitle: document.querySelector("#analytics-title") as HTMLElement,
  analyticsSummary: document.querySelector("#analytics-summary") as HTMLElement,
  statsViewTabs: document.querySelector("#stats-view-tabs") as HTMLElement,
  statsViewTabButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-stats-view]")],
  myStatsOpponentTabs: document.querySelector("#my-stats-opponent-tabs") as HTMLElement,
  myStatsOpponentTabButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-my-stats-opponent]")],
  statsGameLog: document.querySelector("#stats-game-log") as HTMLElement,
  analyticsTotals: document.querySelector("#analytics-totals") as HTMLElement,
  analyticsGames: document.querySelector("#analytics-games") as HTMLElement,
  analyticsHands: document.querySelector("#analytics-hands") as HTMLElement,
  analyticsScores: document.querySelector("#analytics-scores") as HTMLElement,
  analyticsPegging: document.querySelector("#analytics-pegging") as HTMLElement,
  gameLogOpen: document.querySelector("#game-log-open") as HTMLButtonElement,
  gameLogSummary: document.querySelector("#game-log-summary") as HTMLElement,
  gameLogAnalyzeAll: document.querySelector("#game-log-analyze-all") as HTMLButtonElement,
  gameLogViewTabButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-game-log-view]")],
  gameLogGames: document.querySelector("#game-log-games") as HTMLElement,
  gameLogErrors: document.querySelector("#game-log-errors") as HTMLElement,
  gameLogErrorsSummary: document.querySelector("#game-log-errors-summary") as HTMLElement,
  gameLogErrorsList: document.querySelector("#game-log-errors-list") as HTMLElement,
  gameLogOpponent: document.querySelector("#game-log-opponent") as HTMLSelectElement,
  gameLogResult: document.querySelector("#game-log-result") as HTMLSelectElement,
  gameLogMatchType: document.querySelector("#game-log-match-type") as HTMLSelectElement,
  gameLogList: document.querySelector("#game-log-list") as HTMLElement,
  leaderboardPage: document.querySelector("#leaderboard-page") as HTMLElement,
  leaderboardSummary: document.querySelector("#leaderboard-summary") as HTMLElement,
  leaderboardList: document.querySelector("#leaderboard-list") as HTMLElement,
  leaderboardMetricTabButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-leaderboard-metric]")],
  leaderboardWindowTabs: document.querySelector("#leaderboard-window-tabs") as HTMLElement,
  leaderboardWindowTabButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-leaderboard-window]")],
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
  humanScorePanel: document.querySelector("#human-score-panel") as HTMLElement,
  humanScore: document.querySelector("#human-score") as HTMLElement,
  humanPace: document.querySelector("#human-pace") as HTMLElement,
  humanFinal: document.querySelector("#human-final") as HTMLElement,
  humanName: document.querySelector("#human-name") as HTMLElement,
  humanDealer: document.querySelector("#human-dealer") as HTMLElement,
  scoreCut: document.querySelector("#score-cut") as HTMLElement,
  aiScorePanel: document.querySelector("#ai-score-panel") as HTMLElement,
  aiScore: document.querySelector("#ai-score") as HTMLElement,
  aiPace: document.querySelector("#ai-pace") as HTMLElement,
  aiFinal: document.querySelector("#ai-final") as HTMLElement,
  aiName: document.querySelector("#ai-name") as HTMLElement,
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
  aceMistake: document.querySelector("#ace-mistake") as HTMLButtonElement,
  playAreaTitle: document.querySelector("#play-area-title") as HTMLElement,
  plays: document.querySelector("#plays") as HTMLElement,
  cribTray: document.querySelector("#crib-tray") as HTMLElement,
  cribTrayLabel: document.querySelector("#crib-tray-label") as HTMLElement,
  cribTrayStack: document.querySelector("#crib-tray-stack") as HTMLElement,
  userHandTitle: document.querySelector("#user-hand-title") as HTMLElement,
  userPanelHeader: document.querySelector(".user-panel-header") as HTMLElement,
  userHandMeta: document.querySelector("#user-hand-meta") as HTMLElement,
  aiStrip: document.querySelector(".ai-strip") as HTMLElement,
  aiHandTitle: document.querySelector("#ai-hand-title") as HTMLElement,
  humanHand: document.querySelector("#human-hand") as HTMLElement,
  aiHand: document.querySelector("#ai-hand") as HTMLElement,
  discard: document.querySelector("#discard") as HTMLButtonElement,
  cutForDeal: document.querySelector("#cut-for-deal") as HTMLButtonElement,
  play: document.querySelector("#play") as HTMLButtonElement,
  askMaster: document.querySelector("#ask-master") as HTMLButtonElement,
  go: document.querySelector("#go") as HTMLButtonElement,
  opponent: document.querySelector("#opponent") as HTMLSelectElement,
  scoringReview: document.querySelector("#scoring-review") as HTMLElement,
  scoringTitle: document.querySelector("#scoring-title") as HTMLElement,
  scoringCards: document.querySelector("#scoring-cards") as HTMLElement,
  scoringPoints: document.querySelector("#scoring-points") as HTMLElement,
  scoreSummaryDialog: document.querySelector("#score-summary-dialog") as HTMLElement,
  scoreSummaryEyebrow: document.querySelector("#score-summary-eyebrow") as HTMLElement,
  scoreSummaryTitle: document.querySelector("#score-summary-title") as HTMLElement,
  scoreSummaryItems: document.querySelector("#score-summary-items") as HTMLElement,
  skipCounting: document.querySelector("#skip-counting") as HTMLButtonElement,
  continueScoring: document.querySelector("#continue-scoring") as HTMLButtonElement,
  acknowledgePeggingReset: document.querySelector("#acknowledge-pegging-reset") as HTMLButtonElement,
  continuePegging: document.querySelector("#continue-pegging") as HTMLButtonElement,
  gameOverAlert: document.querySelector("#game-over-alert") as HTMLElement,
  gameOverTitle: document.querySelector("#game-over-title") as HTMLElement,
  gameOverClose: document.querySelector("#game-over-close") as HTMLButtonElement,
  singleGameReport: document.querySelector("#single-game-report") as HTMLElement,
  masterHintDialog: document.querySelector("#master-hint-dialog") as HTMLElement,
  masterHintCard: document.querySelector("#master-hint-card") as HTMLElement,
  masterHintEyebrow: document.querySelector("#master-hint-eyebrow") as HTMLElement,
  masterHintTitle: document.querySelector("#master-hint-title") as HTMLElement,
  masterHintCopy: document.querySelector("#master-hint-copy") as HTMLElement,
  masterHintDismiss: document.querySelector("#master-hint-dismiss") as HTMLButtonElement,
  masterHintApply: document.querySelector("#master-hint-apply") as HTMLButtonElement,
  masterSessionDialog: document.querySelector("#master-session-dialog") as HTMLElement,
  masterSessionStatus: document.querySelector("#master-session-status") as HTMLElement,
  masterSessionCancel: document.querySelector("#master-session-cancel") as HTMLButtonElement,
  masterSessionSave: document.querySelector("#master-session-save") as HTMLButtonElement,
  masterSessionForfeit: document.querySelector("#master-session-forfeit") as HTMLButtonElement,
};

let mobileGameplayHeaderHideTimer: number | null = null;
let mobileGameplayHeaderWasActive = false;
let mobileHeaderTouchStartY: number | null = null;

function applyProductionOpponentVisibility(production: boolean): void {
  if (!production) return;
  for (const selector of [
    '[data-pathway-destination="grandmaster"]',
    '[data-my-stats-opponent="grandmaster"]',
  ]) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      element.hidden = true;
    });
  }
}

applyProductionOpponentVisibility(import.meta.env.PROD);

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
  if (error instanceof AuthenticationRequiredError) {
    clearServerBusy();
    state.pending = false;
    setAiThinking(false);
    return;
  }
  console.warn("API interaction failed", error);
  activityTracker.track("server_error_ui", {
    error: activityErrorSummary(error),
    retryAvailable: Boolean(retry),
  }, true);
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
  if (activeHumanTable) {
    await retry();
    return;
  }
  if (recovered && await resumeReconciledGame(recovered)) return;
  await retry();
}

async function reconcileRemoteGameState(): Promise<GameState | null> {
  // An action may have reached the server even if its response was interrupted.
  // Before replaying it, use the authoritative session to avoid leaving the UI
  // behind an already-revealed cut card or an AI discard that has completed.
  if (!currentSnapshot?.gameId) return null;
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
const NOTICE_VISIBLE_MS = 2_200;
const SIMPLE_NETWORK_OPPONENT: Opponent = DEFAULT_OPPONENT;
const SIMPLE_NETWORK_PUBLIC_OPPONENTS = new Set<string>([
  "dynamic",
  "myrmidon-5",
  "schell_table-peg_table-9.1",
  "schell_table-peg_table-9.11",
  ...ACE_OPPONENTS,
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
// A local browser session may read a pulled production snapshot through the
// local API, but it must never write QA results back to production.
const LOCAL_QA_MODE = IS_VITE_DEV && LOCAL_NETWORK_MODE;
const PATHWAY_NAV_ENABLED = SIMPLE_NETWORK_MODE && URL_PARAMS.get("pathway") !== "0";
const PATHWAY_VIEW_PARAM = "pathwayView";
const PATHWAY_HISTORY_STATE_KEY = "strongCribbagePathway";
const AUTHENTICATION_ENABLED = true;
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
  engagementAdmin?: boolean;
}

interface EngagementBreakdown {
  label: string;
  events: number;
  sessions: number;
  visitors: number;
}

interface EngagementTrendPoint {
  period: string;
  activeVisitors: number;
  sessions: number;
  events: number;
  gameStarts: number;
  gameCompletions: number;
  gameForfeits: number;
  bounces: number;
  errorEvents: number;
  frictionEvents: number;
  abandonmentCandidates: number;
}

interface EngagementUserActivity {
  username: string;
  displayName: string;
  lastActive: string;
  activeDays: number;
  sessions: number;
  events: number;
  pageViews: number;
  gameStarts: number;
  observedGames: number;
  gameCompletions: number;
  errors: number;
  frictionEvents: number;
  primaryClient: string;
}

interface EngagementRecentActivity {
  at: string;
  person: string;
  username: string | null;
  event: string;
  detail: string;
  environment: string;
  client: string;
}

interface EngagementReport {
  range: {
    days: number;
    label: string;
    from: string | null;
    to: string;
    environment: string;
    audience: string;
  };
  totals: {
    activeVisitors: number;
    registeredUsers: number;
    anonymousSessions: number;
    signedInSessions: number;
    sessions: number;
    returningUsers: number;
    events: number;
    pageViews: number;
    interactions: number;
    activeNow: number;
    activeLast24Hours: number;
    gameStarts: number;
    observedGames: number;
    gameResumes: number;
    gameCompletions: number;
    gameForfeits: number;
    gameAbandons: number;
    completionPercent: number;
    bounceSessions: number;
    bouncePercent: number;
    errorEvents: number;
    errorSessions: number;
    frictionEvents: number;
    frictionSessions: number;
    averageExitSeconds: number;
  };
  comparison: null | Record<string, number | null>;
  definitions: Record<string, string>;
  funnel: Array<{ label: string; sessions: number; conversionPercent: number; dropOff: number | null; denominator: string }>;
  pathways: EngagementBreakdown[];
  opponents: EngagementBreakdown[];
  devices: EngagementBreakdown[];
  clients: EngagementBreakdown[];
  environments: EngagementBreakdown[];
  locations: EngagementBreakdown[];
  surfaces: EngagementBreakdown[];
  eventTypes: EngagementBreakdown[];
  states: EngagementBreakdown[];
  interactions: EngagementBreakdown[];
  errors: EngagementBreakdown[];
  users: EngagementUserActivity[];
  recentActivity: EngagementRecentActivity[];
  daily: EngagementTrendPoint[];
  hourly: EngagementTrendPoint[];
  csv: string;
}

let engagementReport: EngagementReport | null = null;
let engagementTab: "overview" | "people" | "experience" | "data" = "overview";

interface PeopleProfile {
  username: string;
  displayName: string;
  email?: string;
  avatarDataUrl: string | null;
  textSize?: AppFontSize;
  online: boolean;
  lookingForGame: boolean;
  isSelf: boolean;
  dynamicCalibration?: DynamicCalibration;
  dynamicHandicap?: DynamicHandicapSummary;
  headToHead?: PeopleHeadToHead;
}

interface PeopleHeadToHead {
  games: number;
  viewerWins: number;
  profileWins: number;
  viewerAverageMargin: number;
  viewerSkunks: number;
  profileSkunks: number;
}

interface PeoplePlayer {
  username: string;
  displayName: string;
  avatarDataUrl: string | null;
  online?: boolean;
  lookingForGame?: boolean;
  dynamicHandicap?: DynamicHandicapSummary;
}

interface PeopleChallenge {
  id: string;
  tableId: string;
  status: "pending" | "accepted";
  player: PeoplePlayer;
}

interface PeopleDirectoryResponse {
  onlineCount: number;
  players: PeoplePlayer[];
  incomingChallenges: PeopleChallenge[];
  outgoingChallenges: PeopleChallenge[];
  activeTable: HumanTable | null;
}

interface PeopleProfileResponse {
  profile: PeopleProfile;
}

interface ChallengeResponse {
  challenge: PeopleChallenge;
}

interface HumanCutCard {
  id: number;
  rank: string;
  suit: "clubs" | "diamonds" | "hearts" | "spades";
  symbol: string;
}

interface HumanTable {
  id: string;
  phase: "waiting" | "cut_for_deal" | "playing" | "complete";
  viewerSeat: "challenger" | "challenged";
  challenger: PeoplePlayer;
  challenged: PeoplePlayer;
  challengerCut: HumanCutCard | null;
  challengedCut: HumanCutCard | null;
  dealerUsername: string | null;
}

interface HumanTableResponse {
  table: HumanTable;
}

interface HumanGameResponse extends ServerGameActionResponse {
  tableId: string;
  revision: number;
  canContinueScoring: boolean;
  canAcknowledgePeggingReset: boolean;
  players: Record<PlayerKey, string>;
  acknowledgment?: {
    actionId: string;
    appliedRevision: number;
    alreadyApplied: boolean;
  };
  watchTimedOut?: boolean;
}

interface PendingHumanGameCommand {
  tableId: string;
  action: string;
  payloadKey: string;
  actionId: string;
}

type PendingAuthDestination =
  | { kind: "master" }
  | { kind: "dynamic" }
  | { kind: "statistics" }
  | { kind: "human" }
  | { kind: "table"; tableId: string }
  | { kind: "challenge"; username: string }
  | { kind: "profile"; username: string };

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
let selectedPathwayOpponent: Opponent | null = null;
let remoteResumableModelGames = new Map<Opponent, Phase>();
let pathwayResumeRefreshGeneration = 0;
let pendingAuthDestination: PendingAuthDestination | null = null;
let peopleDirectory: PeopleDirectoryResponse = {
  onlineCount: 0,
  players: [],
  incomingChallenges: [],
  outgoingChallenges: [],
  activeTable: null,
};
let ownPeopleProfile: PeopleProfile | null = null;
let selectedPeopleProfile: PeopleProfile | null = null;
let pendingAvatarDataUrl: string | null = null;
let activeHumanTable: HumanTable | null = null;
let peoplePollTimer: number | null = null;
let peopleDirectoryInteractionActive = false;
let peopleDirectoryInteractionReleaseTimer: number | null = null;
let pendingPeopleDirectory: PeopleDirectoryResponse | null = null;
let peopleChallengeWatchGeneration = 0;
let peopleChallengeWatchAbortController: AbortController | null = null;
let peopleChallengeAttentionTimer: number | null = null;
let humanTablePollTimer: number | null = null;
let humanGameWatchGeneration = 0;
let humanGameTableId: string | null = null;
let humanGameRevision = -1;
let pendingHumanGameCommand: PendingHumanGameCommand | null = null;
let humanGameRefreshPromise: Promise<void> | null = null;
let humanGameCanContinueScoring = false;
let humanGameCanAcknowledgePeggingReset = false;
let humanDecisionReviewPlayer: PlayerKey = "human";
let peopleIdleTimer: number | null = null;
let peopleLastActivityAt = Date.now();
let peopleLastHeartbeatAt = 0;
let peopleActive = false;

els.parGuidesToggle.checked = state.parGuides;
els.fastCounting.checked = state.fastCounting;
els.hintsEnabled.checked = state.hintsEnabled;
els.errorNoticesEnabled.checked = state.errorNoticesEnabled;

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
  helps: number;
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
type DiscardEvent = Extract<AnalyticsEvent, { type: "discard" }>;
type PeggingEvent = Extract<AnalyticsEvent, { type: "pegging" }>;
type DecisionReviewEvent = (DiscardEvent | PeggingEvent) & { review: AnalyticsDecisionReview };
interface GameLogRecord {
  gameId: string;
  start?: Extract<AnalyticsEvent, { type: "game" }>;
  end: GameEndEvent;
  opponent: string;
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
    if (!isCoherentSavedGameState(record.state)) {
      safeLocalStorageRemove(SAVE_KEY);
      return null;
    }
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
function pathwayOpponent(destination: string | undefined): Opponent | null {
  if (!destination || !Object.prototype.hasOwnProperty.call(PATHWAY_OPPONENTS, destination)) return null;
  return PATHWAY_OPPONENTS[destination as keyof typeof PATHWAY_OPPONENTS];
}
function isPathwayOpponent(opponent: string | undefined): opponent is Opponent {
  return Boolean(
    opponent && (Object.values(PATHWAY_OPPONENTS) as readonly Opponent[]).includes(opponent as Opponent),
  );
}
function selectedMenuOpponent(): Opponent {
  return SIMPLE_NETWORK_MODE ? selectedPathwayOpponent ?? SIMPLE_NETWORK_OPPONENT : DEFAULT_OPPONENT;
}
const savedGame = loadSavedGame();
if (savedGame) {
  currentSnapshot = savedGame.snapshot;
  state.game = savedGame.state;
  gameStateGeneration = 1;
  if (isAceOpponent(savedGame.snapshot.opponent)) {
    selectedPathwayOpponent = DEFAULT_OPPONENT;
  } else if (isPathwayOpponent(savedGame.snapshot.opponent)) {
    selectedPathwayOpponent = savedGame.snapshot.opponent;
  }
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

function activityErrorSummary(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.replace(/([?&](?:invite|reset|token|api)=)[^\s&#]*/gi, "$1[redacted]")
    .slice(0, 300);
}

function currentActivitySurface(): string {
  if (!els.engagementPage.hidden) return "admin:engagement";
  if (!els.authPage.hidden) {
    if (!els.authPasswordForm.hidden) return URL_PARAMS.has("invite") ? "auth:invite" : "auth:reset";
    if (!els.authOtpForm.hidden) return "auth:otp";
    return "auth:login";
  }
  if (!els.peopleProfilePage.hidden) return "people:profile";
  if (!els.humanTablePage.hidden) return "people:table";
  if (state.analyticsOpen) return "statistics";
  if (state.leaderboardOpen) return "leaderboard";
  if (state.modelInfoOpen) return "model-info";
  if (state.decisionReviewOpen) return "decision-review";
  if (!els.pathwayPage.hidden) return `pathway:${els.pathwayPage.dataset.view || "home"}`;
  if (!els.splashPage.hidden) return "splash";
  return state.game ? "game" : "app";
}

function availableSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

const nativeIosClient = Capacitor.isNativePlatform();
const activityTracker = new ActivityTracker({
  endpoint: `${REMOTE_AI_BASE}/api/activity`,
  environment: activityEnvironment(window.location.hostname, nativeIosClient),
  appVersion: __APP_VERSION__,
  client: currentActivityClient(nativeIosClient),
  sessionStorage: availableSessionStorage(),
  getContext: () => ({
    authenticated: authenticatedUser !== null,
    gameId: currentSnapshot?.gameId ?? null,
    phase: state.game?.phase ?? null,
    opponent: currentSnapshot?.opponent ?? null,
    surface: currentActivitySurface(),
  }),
});
let lastActivityPageView = "";

function trackActivityPageView(surface = currentActivitySurface(), source = "navigation"): void {
  const key = `${safeActivityPage(window.location.href)}|${surface}`;
  if (key === lastActivityPageView) return;
  lastActivityPageView = key;
  activityTracker.track("page_view", { surface, source });
}

activityTracker.track("session_start");
window.addEventListener("error", (event) => {
  activityTracker.track("client_error", {
    kind: "error",
    error: activityErrorSummary(event.error ?? event.message),
  }, true);
});
window.addEventListener("unhandledrejection", (event) => {
  activityTracker.track("client_error", {
    kind: "unhandledrejection",
    error: activityErrorSummary(event.reason),
  }, true);
});

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
  els.opponent.value = selectedMenuOpponent();
  syncPathwayOpponentPresentation(selectedMenuOpponent());
  els.opponent.disabled = true;
  els.opponent.closest("label")?.setAttribute("hidden", "");
  els.gameLogOpen.hidden = true;
  els.modelInfoOpen.hidden = true;
  els.exportGameLog.hidden = true;
  els.modelLoading.hidden = true;
}

function applyAdminVisibility(): void {
  const showAdmin = Boolean(authenticatedUser?.engagementAdmin) || window.location.hash === ADMIN_HASH;
  els.adminMenu.hidden = !showAdmin;
  els.engagementPathwayOpen.hidden = !authenticatedUser?.engagementAdmin;
  els.engagementMenuOpen.hidden = !authenticatedUser?.engagementAdmin;
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
trackActivityPageView(currentActivitySurface(), "initial");
window.addEventListener("hashchange", applyAdminVisibility);
window.addEventListener("popstate", () => {
  if (PATHWAY_NAV_ENABLED) applyPathwayRoute(pathwayRouteFromLocation());
  void syncPeopleRouteFromLocation().catch((error) => {
    console.warn("Player route could not be restored", error);
  });
});

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
    if (shouldRecoverExpiredSession(response.status, path)) {
      throw recoverExpiredAuthentication();
    }
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
    if (error instanceof ApiInteractionError || error instanceof AuthenticationRequiredError) throw error;
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
    if (shouldRecoverExpiredSession(response.status, path)) {
      throw recoverExpiredAuthentication();
    }
    if (!response.ok || !contentType.includes("application/json")) {
      throw new ApiInteractionError(`Server Busy (${response.status})`);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ApiInteractionError || error instanceof AuthenticationRequiredError) throw error;
    throw new ApiInteractionError("Server Busy", { cause: error });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function authJson<T>(
  path: string,
  body?: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
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
    if (shouldRecoverExpiredSession(response.status, path)) {
      throw recoverExpiredAuthentication();
    }
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "Account service is temporarily unavailable.");
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") throw error;
    throw new Error("Account service is temporarily unavailable.");
  } finally {
    options.signal?.removeEventListener("abort", abort);
    window.clearTimeout(timeout);
  }
}

interface FeedbackResponse {
  ok: boolean;
  message: string;
}

function feedbackPageContext(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

function submitFeedback(
  path: "/api/feedback/bug-report" | "/api/feedback/feature-request",
  body: Record<string, unknown>,
): Promise<FeedbackResponse> {
  return authJson<FeedbackResponse>(path, body);
}

function feedbackScreenshotError(file: File): string | null {
  if (!FEEDBACK_SCREENSHOT_TYPES.has(file.type)) {
    return "Choose a PNG, JPEG, or WebP screenshot.";
  }
  if (file.size > MAX_FEEDBACK_SCREENSHOT_BYTES) {
    return "Keep the screenshot under 5 MB.";
  }
  return null;
}

function screenshotDataUrl(file: File): Promise<string> {
  const validationError = feedbackScreenshotError(file);
  if (validationError) return Promise.reject(new Error(validationError));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("The screenshot could not be read."));
    });
    reader.addEventListener("error", () => reject(new Error("The screenshot could not be read.")));
    reader.readAsDataURL(file);
  });
}

function setFeedbackStatus(
  status: HTMLElement,
  state: "sending" | "success" | "error" | "idle",
  message = "",
): void {
  if (state === "sending") status.dataset.state = "sending";
  if (state === "success") status.dataset.state = "success";
  if (state === "error") status.dataset.state = "error";
  if (state === "idle") delete status.dataset.state;
  status.textContent = message;
}

function setFeedbackSubmitting(
  submit: HTMLButtonElement,
  cancel: HTMLButtonElement,
  close: HTMLButtonElement,
  submitting: boolean,
): void {
  submit.disabled = submitting;
  cancel.disabled = submitting;
  close.disabled = submitting;
}

function openFeedbackDialog(dialog: HTMLDialogElement, description: HTMLTextAreaElement): void {
  if (dialog.open) return;
  dialog.showModal();
  description.focus();
}

function resetBugReportDialog(): void {
  els.bugReportForm.reset();
  els.bugReportScreenshot.setCustomValidity("");
  setFeedbackStatus(els.bugReportStatus, "idle");
  setFeedbackSubmitting(els.bugReportSubmit, els.bugReportCancel, els.bugReportClose, false);
}

function resetFeatureRequestDialog(): void {
  els.featureRequestForm.reset();
  setFeedbackStatus(els.featureRequestStatus, "idle");
  setFeedbackSubmitting(els.featureRequestSubmit, els.featureRequestCancel, els.featureRequestClose, false);
}

function peopleInitials(player: Pick<PeoplePlayer, "displayName" | "username">): string {
  const words = (player.displayName || player.username).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "SC";
  return `${words[0][0] || ""}${words.length > 1 ? words.at(-1)?.[0] || "" : words[0][1] || ""}`.toUpperCase();
}

const HANDICAP_EXPLANATION = "Handicap is a skill-only (no chance or cards component) measure of cribbage skill.";
const HANDICAP_TOOLTIP_ID = "player-handicap-tooltip";
let handicapTooltipOwner: HTMLElement | null = null;

function normalizedPlayerDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function handicapForPlayer(
  displayName: string,
  explicit?: DynamicHandicapSummary | null,
): DynamicHandicapSummary | null {
  if (explicit && Number.isFinite(explicit.wpPerGame)) return explicit;
  const normalized = normalizedPlayerDisplayName(displayName);
  const knownPlayers = [
    ownPeopleProfile,
    selectedPeopleProfile,
    activeHumanTable?.challenger,
    activeHumanTable?.challenged,
    peopleDirectory.activeTable?.challenger,
    peopleDirectory.activeTable?.challenged,
    ...peopleDirectory.players,
    ...peopleDirectory.incomingChallenges.map((challenge) => challenge.player),
    ...peopleDirectory.outgoingChallenges.map((challenge) => challenge.player),
  ].filter((player): player is PeoplePlayer | PeopleProfile => Boolean(player));
  const known = knownPlayers.find((player) =>
    normalizedPlayerDisplayName(player.displayName) === normalized
    || normalizedPlayerDisplayName(player.username) === normalized
  );
  if (known?.dynamicHandicap && Number.isFinite(known.dynamicHandicap.wpPerGame)) {
    return known.dynamicHandicap;
  }
  for (const [player, handicap] of Object.entries(state.leaderboardSummary.playerHandicaps ?? {})) {
    if (normalizedPlayerDisplayName(player) === normalized && Number.isFinite(handicap.wpPerGame)) {
      return handicap;
    }
  }
  return null;
}

function playerHandicapMarker(
  handicap: DynamicHandicapSummary | null | undefined,
  options: { interactive?: boolean } = {},
): HTMLElement | null {
  const copy = playerHandicapCopy(handicap);
  if (!copy) return null;
  const marker = document.createElement("span");
  marker.className = "player-handicap";
  marker.textContent = copy;
  if (options.interactive !== false) {
    marker.tabIndex = 0;
    marker.setAttribute("aria-describedby", HANDICAP_TOOLTIP_ID);
    marker.setAttribute("aria-label", `${copy.slice(1, -1)} handicap. ${HANDICAP_EXPLANATION}`);
  } else {
    marker.classList.add("is-static");
    marker.setAttribute("aria-hidden", "true");
  }
  return marker;
}

function handicapTooltipElement(): HTMLElement {
  const existing = document.querySelector(`#${HANDICAP_TOOLTIP_ID}`) as HTMLElement | null;
  if (existing) return existing;
  const tooltip = document.createElement("div");
  tooltip.id = HANDICAP_TOOLTIP_ID;
  tooltip.className = "player-handicap-tooltip";
  tooltip.role = "tooltip";
  tooltip.textContent = HANDICAP_EXPLANATION;
  tooltip.hidden = true;
  document.body.append(tooltip);
  return tooltip;
}

function showHandicapTooltip(marker: HTMLElement): void {
  const tooltip = handicapTooltipElement();
  handicapTooltipOwner = marker;
  tooltip.hidden = false;
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";
  const markerRect = marker.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const margin = 12;
  const left = Math.min(
    window.innerWidth - tooltipRect.width - margin,
    Math.max(margin, markerRect.left + markerRect.width / 2 - tooltipRect.width / 2),
  );
  const roomBelow = markerRect.bottom + 8 + tooltipRect.height <= window.innerHeight - margin;
  const top = roomBelow
    ? markerRect.bottom + 8
    : Math.max(margin, markerRect.top - tooltipRect.height - 8);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideHandicapTooltip(marker: HTMLElement): void {
  if (handicapTooltipOwner !== marker) return;
  dismissHandicapTooltip();
}

function dismissHandicapTooltip(): void {
  const tooltip = document.querySelector(`#${HANDICAP_TOOLTIP_ID}`) as HTMLElement | null;
  if (tooltip) tooltip.hidden = true;
  handicapTooltipOwner = null;
}

function handicapMarkerFromEvent(event: Event): HTMLElement | null {
  return event.target instanceof Element
    ? event.target.closest<HTMLElement>(".player-handicap:not(.is-static)")
    : null;
}

document.addEventListener("mouseover", (event) => {
  const marker = handicapMarkerFromEvent(event);
  if (marker) showHandicapTooltip(marker);
});
document.addEventListener("mouseout", (event) => {
  const marker = handicapMarkerFromEvent(event);
  if (marker && !(event.relatedTarget instanceof Node && marker.contains(event.relatedTarget))) {
    hideHandicapTooltip(marker);
  }
});
document.addEventListener("focusin", (event) => {
  const marker = handicapMarkerFromEvent(event);
  if (marker) showHandicapTooltip(marker);
});
document.addEventListener("focusout", (event) => {
  const marker = handicapMarkerFromEvent(event);
  if (marker) hideHandicapTooltip(marker);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && handicapTooltipOwner) hideHandicapTooltip(handicapTooltipOwner);
});

function setPlayerIdentity(
  element: HTMLElement,
  displayName: string,
  handicap: DynamicHandicapSummary | null = handicapForPlayer(displayName),
  options: { interactive?: boolean } = {},
): void {
  const name = document.createElement("span");
  name.className = "player-identity-name";
  name.textContent = displayName;
  const marker = playerHandicapMarker(handicap, options);
  element.replaceChildren(name, ...(marker ? [marker] : []));
}

function renderPeopleAvatar(element: HTMLElement, player: Pick<PeoplePlayer, "displayName" | "username" | "avatarDataUrl">): void {
  element.setAttribute("aria-hidden", "true");
  element.textContent = peopleInitials(player);
  element.style.backgroundImage = player.avatarDataUrl ? `url(${JSON.stringify(player.avatarDataUrl).slice(1, -1)})` : "";
  element.classList.toggle("has-image", Boolean(player.avatarDataUrl));
}

function peopleListItem(
  player: PeoplePlayer,
  options: { challenge?: boolean; game?: boolean; looking?: boolean; actionLabel?: string; statusText?: string } = {},
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "people-list-item";
  if (options.challenge) button.classList.add("is-challenge");
  if (options.game) button.classList.add("is-game");
  if (options.looking) button.classList.add("is-looking");
  const avatar = document.createElement("span");
  avatar.className = "people-avatar people-list-avatar";
  renderPeopleAvatar(avatar, player);
  const copy = document.createElement("span");
  copy.className = "people-list-copy";
  const name = document.createElement("strong");
  setPlayerIdentity(name, player.displayName, player.dynamicHandicap ?? null, { interactive: false });
  const status = document.createElement("small");
  status.textContent = options.statusText ?? (options.challenge
    ? "Wants to play you"
    : options.looking
      ? "Looking for a game"
      : "Online now");
  copy.append(name, status);
  const action = document.createElement("span");
  action.className = "people-list-action";
  action.textContent = options.actionLabel || "View";
  button.append(avatar, copy, action);
  return button;
}

function resumableHumanTable(): HumanTable | null {
  if (activeHumanTable && activeHumanTable.phase !== "complete") return activeHumanTable;
  if (peopleDirectory.activeTable?.phase !== "complete") return peopleDirectory.activeTable;
  return null;
}

function humanTableOpponent(table: HumanTable): PeoplePlayer {
  return table.viewerSeat === "challenger" ? table.challenged : table.challenger;
}

function humanTableResumeStatus(table: HumanTable): string {
  if (table.phase === "waiting") return "Waiting for them to join";
  if (table.phase === "cut_for_deal") return "Game ready · Cut for deal";
  return "Game in progress";
}

function humanTableResumeItem(table: HumanTable): HTMLButtonElement {
  return peopleListItem(humanTableOpponent(table), {
    game: true,
    actionLabel: "Resume",
    statusText: humanTableResumeStatus(table),
  });
}

function resumeHumanTable(table: HumanTable): void {
  dismissHandicapTooltip();
  els.peoplePresencePanel.hidden = true;
  els.peoplePresenceToggle.setAttribute("aria-expanded", "false");
  void openHumanTable(table.id);
}

function challengeIds(directory: PeopleDirectoryResponse): string[] {
  return directory.incomingChallenges.map((challenge) => challenge.id).sort();
}

function peopleDirectoryPresentationKey(directory: PeopleDirectoryResponse): string {
  return JSON.stringify({
    onlineCount: directory.onlineCount,
    players: directory.players.map((player) => [
      player.username,
      player.displayName,
      player.lookingForGame,
      player.dynamicHandicap?.wpPerGame ?? null,
    ]),
    incomingChallenges: directory.incomingChallenges.map((challenge) => [
      challenge.id,
      challenge.status,
      challenge.player.username,
    ]),
    activeTable: directory.activeTable
      ? [directory.activeTable.id, directory.activeTable.phase, directory.activeTable.dealerUsername]
      : null,
  });
}

function announceIncomingChallenge(challenge: PeopleChallenge): void {
  els.peoplePresenceAlert.setAttribute(
    "aria-label",
    `${challenge.player.displayName} challenged you to a game`,
  );
  els.peoplePresence.classList.remove("challenge-arrived");
  void els.peoplePresence.offsetWidth;
  els.peoplePresence.classList.add("challenge-arrived");
  if (peopleChallengeAttentionTimer !== null) window.clearTimeout(peopleChallengeAttentionTimer);
  peopleChallengeAttentionTimer = window.setTimeout(() => {
    els.peoplePresence.classList.remove("challenge-arrived");
    peopleChallengeAttentionTimer = null;
  }, PEOPLE_CHALLENGE_ATTENTION_MS);
}

function beginPeopleDirectoryInteraction(): void {
  if (peopleDirectoryInteractionReleaseTimer !== null) {
    window.clearTimeout(peopleDirectoryInteractionReleaseTimer);
    peopleDirectoryInteractionReleaseTimer = null;
  }
  peopleDirectoryInteractionActive = true;
}

function finishPeopleDirectoryInteraction(): void {
  if (!peopleDirectoryInteractionActive) return;
  if (peopleDirectoryInteractionReleaseTimer !== null) {
    window.clearTimeout(peopleDirectoryInteractionReleaseTimer);
  }
  peopleDirectoryInteractionReleaseTimer = window.setTimeout(() => {
    peopleDirectoryInteractionReleaseTimer = null;
    peopleDirectoryInteractionActive = false;
    const directory = pendingPeopleDirectory;
    pendingPeopleDirectory = null;
    if (directory) applyPeopleDirectory(directory);
  }, 0);
}

function applyPeopleDirectory(directory: PeopleDirectoryResponse): void {
  if (peopleDirectoryInteractionActive) {
    pendingPeopleDirectory = directory;
    return;
  }
  const changed = peopleDirectoryPresentationKey(directory) !== peopleDirectoryPresentationKey(peopleDirectory);
  const previousIds = new Set(challengeIds(peopleDirectory));
  const arrived = directory.incomingChallenges.find((challenge) => !previousIds.has(challenge.id));
  peopleDirectory = directory;
  renderPeopleDirectory({ animate: changed });
  if (arrived) announceIncomingChallenge(arrived);
}

function renderPeopleDirectory(options: { animate?: boolean } = {}): void {
  const animate = options.animate === true;
  dismissHandicapTooltip();
  els.peoplePresence.hidden = false;
  els.peoplePresence.classList.toggle("directory-updated", animate);
  els.peopleOnlineList.classList.toggle("people-directory-updated", animate);
  els.humanDirectory.classList.toggle("people-directory-updated", animate);
  const activeTable = resumableHumanTable();
  els.peoplePresenceLabel.textContent = activeTable
    ? `${peopleDirectory.onlineCount} online · Resume`
    : `${peopleDirectory.onlineCount} online`;
  const challengeCount = peopleDirectory.incomingChallenges.length;
  els.peoplePresenceAlert.hidden = challengeCount === 0;
  els.peoplePresenceAlert.textContent = String(challengeCount);
  if (!challengeCount) {
    els.peoplePresenceAlert.removeAttribute("aria-label");
    els.peoplePresence.classList.remove("challenge-arrived");
  } else {
    els.peoplePresenceAlert.setAttribute(
      "aria-label",
      `${challengeCount} pending game challenge${challengeCount === 1 ? "" : "s"}`,
    );
  }
  els.peoplePresence.classList.toggle("has-challenge", challengeCount > 0);
  els.peoplePresence.classList.toggle("has-game", Boolean(activeTable));
  els.peoplePresenceToggle.setAttribute(
    "aria-label",
    challengeCount
      ? `${challengeCount} player challenge${challengeCount === 1 ? "" : "s"}; ${peopleDirectory.onlineCount} players online`
      : activeTable
        ? `Resume game with ${humanTableOpponent(activeTable).displayName}; ${peopleDirectory.onlineCount} players online`
      : `${peopleDirectory.onlineCount} players online`,
  );

  els.peopleTableSection.hidden = !activeTable;
  els.peopleTableList.replaceChildren();
  if (activeTable) {
    const row = humanTableResumeItem(activeTable);
    row.addEventListener("click", () => resumeHumanTable(activeTable));
    els.peopleTableList.append(row);
  }

  els.peopleChallengeSection.hidden = challengeCount === 0;
  els.peopleChallengeList.replaceChildren();
  for (const challenge of peopleDirectory.incomingChallenges) {
    const row = peopleListItem(challenge.player, { challenge: true, actionLabel: "Join" });
    row.addEventListener("click", () => void acceptPeopleChallenge(challenge));
    els.peopleChallengeList.append(row);
  }

  els.peopleOnlineList.replaceChildren();
  if (!peopleDirectory.players.length) {
    const empty = document.createElement("p");
    empty.className = "people-list-empty";
    empty.textContent = authenticatedUser ? "No other players are online right now." : "No players are online right now.";
    els.peopleOnlineList.append(empty);
  } else {
    for (const player of peopleDirectory.players) {
      const row = peopleListItem(player, { looking: player.lookingForGame });
      row.addEventListener("click", () => void openPeopleProfile(player.username));
      els.peopleOnlineList.append(row);
    }
  }

  els.humanDirectory.replaceChildren();
  if (activeTable) {
    const row = humanTableResumeItem(activeTable);
    row.addEventListener("click", () => resumeHumanTable(activeTable));
    els.humanDirectory.append(row);
  }
  if (!peopleDirectory.players.length && !activeTable) {
    const empty = document.createElement("div");
    empty.className = "human-directory-empty";
    const title = document.createElement("strong");
    title.textContent = "You have the clubhouse to yourself.";
    const note = document.createElement("span");
    note.textContent = "Leave this page open and you’ll appear as ready to play when someone arrives.";
    empty.append(title, note);
    els.humanDirectory.append(empty);
  } else {
    for (const player of peopleDirectory.players) {
      const row = peopleListItem(player, {
        looking: player.lookingForGame,
        actionLabel: player.lookingForGame ? "Ready" : "Profile",
      });
      row.addEventListener("click", () => void openPeopleProfile(player.username));
      els.humanDirectory.append(row);
    }
  }
}

function isLookingForHumanGame(): boolean {
  return !els.pathwayPage.hidden && els.pathwayPage.dataset.view === "human" && els.humanTablePage.hidden;
}

function shouldHeartbeatPeoplePresence(): boolean {
  return Boolean(authenticatedUser && (peopleActive || isLookingForHumanGame()));
}

function schedulePeopleIdleTimeout(): void {
  if (peopleIdleTimer !== null) window.clearTimeout(peopleIdleTimer);
  peopleIdleTimer = null;
  if (!authenticatedUser || !peopleActive) return;
  const remaining = Math.max(0, PEOPLE_IDLE_MS - (Date.now() - peopleLastActivityAt));
  peopleIdleTimer = window.setTimeout(() => {
    if (Date.now() - peopleLastActivityAt < PEOPLE_IDLE_MS) {
      schedulePeopleIdleTimeout();
      return;
    }
    peopleActive = false;
    peopleIdleTimer = null;
  }, remaining);
}

function recordPeopleActivity(): boolean {
  const now = Date.now();
  const reactivating = !peopleActive || now - peopleLastActivityAt >= PEOPLE_IDLE_MS;
  peopleLastActivityAt = now;
  peopleActive = true;
  schedulePeopleIdleTimeout();
  if (
    !authenticatedUser ||
    document.visibilityState !== "visible" ||
    (!reactivating && now - peopleLastHeartbeatAt < PEOPLE_ACTIVITY_HEARTBEAT_MIN_MS)
  ) return false;
  peopleLastHeartbeatAt = now;
  void refreshPeople({ heartbeat: true });
  return true;
}

async function refreshPeople(options: { heartbeat?: boolean } = {}): Promise<void> {
  try {
    if (authenticatedUser && options.heartbeat) peopleLastHeartbeatAt = Date.now();
    const directory = authenticatedUser && options.heartbeat
      ? await authJson<PeopleDirectoryResponse>("/api/people/presence", {
        lookingForGame: isLookingForHumanGame(),
      })
      : await authJson<PeopleDirectoryResponse>("/api/people/online");
    applyPeopleDirectory(directory);
  } catch (error) {
    console.warn("Player presence refresh failed", error);
  }
}

function stopPeopleChallengeWatch(): void {
  peopleChallengeWatchGeneration += 1;
  peopleChallengeWatchAbortController?.abort();
  peopleChallengeWatchAbortController = null;
}

function startPeopleChallengeWatch(): void {
  const generation = ++peopleChallengeWatchGeneration;
  if (!authenticatedUser || document.visibilityState !== "visible") return;
  const controller = new AbortController();
  peopleChallengeWatchAbortController = controller;
  void ((async () => {
    while (
      authenticatedUser
      && document.visibilityState === "visible"
      && generation === peopleChallengeWatchGeneration
    ) {
      try {
        const directory = await authJson<PeopleDirectoryResponse>("/api/people/challenges/watch", {
          knownChallengeIds: challengeIds(peopleDirectory),
        }, { signal: controller.signal });
        if (!authenticatedUser || generation !== peopleChallengeWatchGeneration) return;
        applyPeopleDirectory(directory);
      } catch (error) {
        if (!authenticatedUser || generation !== peopleChallengeWatchGeneration) return;
        console.warn("Player challenge watch failed", error);
        await waitMs(PEOPLE_CHALLENGE_RETRY_MS);
      }
    }
  })().finally(() => {
    if (peopleChallengeWatchAbortController === controller) {
      peopleChallengeWatchAbortController = null;
    }
  }));
}

function schedulePeoplePoll(): void {
  if (peoplePollTimer !== null) window.clearTimeout(peoplePollTimer);
  peoplePollTimer = window.setTimeout(async () => {
    if (document.visibilityState === "visible") {
      await refreshPeople({ heartbeat: shouldHeartbeatPeoplePresence() });
    }
    schedulePeoplePoll();
  }, PEOPLE_POLL_MS);
}

async function initializePeople(): Promise<void> {
  if (authenticatedUser) {
    peopleActive = true;
    peopleLastActivityAt = Date.now();
    schedulePeopleIdleTimeout();
    try {
      const response = await authJson<PeopleProfileResponse>("/api/people/me");
      ownPeopleProfile = response.profile;
      setPlayerIdentity(
        els.authAccountProfile,
        response.profile.displayName,
        response.profile.dynamicHandicap ?? null,
      );
      if (response.profile.textSize) {
        state.fontSize = normalizeAppFontSize(response.profile.textSize);
        safeLocalStorageSet(FONT_SIZE_STORAGE_KEY, state.fontSize);
        applyFontSizePreference();
      }
    } catch (error) {
      console.warn("Player profile refresh failed", error);
    }
  } else {
    ownPeopleProfile = null;
    peopleActive = false;
    if (peopleIdleTimer !== null) window.clearTimeout(peopleIdleTimer);
    peopleIdleTimer = null;
  }
  await refreshPeople({ heartbeat: Boolean(authenticatedUser) });
  startPeopleChallengeWatch();
  schedulePeoplePoll();
}

function profileRouteUrl(username: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("profile", username);
  url.searchParams.delete("table");
  return `${url.pathname}${url.search}${url.hash}`;
}

function tableRouteUrl(tableId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("table", tableId);
  url.searchParams.delete("profile");
  return `${url.pathname}${url.search}${url.hash}`;
}

function renderPeopleProfile(profile: PeopleProfile): void {
  selectedPeopleProfile = profile;
  renderPeopleAvatar(els.peopleProfileAvatar, profile);
  setPlayerIdentity(els.peopleProfileTitle, profile.displayName, profile.dynamicHandicap ?? null);
  els.peopleProfilePresence.textContent = profile.online
    ? profile.lookingForGame
      ? "Online · Looking for a game"
      : "Online now"
    : "Offline";
  els.peopleProfilePresence.classList.toggle("is-online", profile.online);
  const handicap = profile.dynamicHandicap;
  els.peopleProfileHandicap.hidden = !handicap;
  els.peopleProfileHandicap.textContent = handicap
    ? `Ace handicap: ${dynamicHandicapPointsCopy(handicap.wpPerGame)} WP pts/game · ${handicap.cycles} calibrated cycle${handicap.cycles === 1 ? "" : "s"}`
    : "";
  els.peopleProfilePlay.hidden = profile.isSelf || !profile.online;
  els.peopleProfilePlay.textContent = authenticatedUser ? "Play now" : "Sign in to play";
  renderPeopleHeadToHead(profile);
  els.peopleProfileForm.hidden = !profile.isSelf;
  if (profile.isSelf) {
    els.peopleProfileUsername.value = profile.username;
    els.peopleProfileEmail.value = profile.email || authenticatedUser?.email || "";
    pendingAvatarDataUrl = profile.avatarDataUrl;
  }
}

function renderPeopleHeadToHead(profile: PeopleProfile): void {
  const stats = profile.headToHead;
  els.peopleProfileHeadToHead.hidden = profile.isSelf || !stats;
  if (!stats) return;

  const gameWord = stats.games === 1 ? "game" : "games";
  els.peopleProfileHeadToHeadGames.textContent = `${stats.games} ${gameWord}`;
  els.peopleProfileHeadToHeadViewerWins.textContent = String(stats.viewerWins);
  els.peopleProfileHeadToHeadProfileWins.textContent = String(stats.profileWins);
  setPlayerIdentity(
    els.peopleProfileHeadToHeadOpponent,
    profile.displayName,
    profile.dynamicHandicap ?? null,
  );
  els.peopleProfileHeadToHeadScore.hidden = stats.games === 0;
  if (stats.games === 0) {
    els.peopleProfileHeadToHeadSummary.textContent = "No completed games together yet.";
    return;
  }

  const margin = Math.abs(stats.viewerAverageMargin).toFixed(1);
  const lead = stats.viewerAverageMargin > 0
    ? `You lead by ${margin} points per game.`
    : stats.viewerAverageMargin < 0
      ? `${profile.displayName} leads by ${margin} points per game.`
      : "Your average margin is even.";
  const skunks = stats.viewerSkunks || stats.profileSkunks
    ? ` Skunks: ${stats.viewerSkunks}–${stats.profileSkunks}.`
    : "";
  els.peopleProfileHeadToHeadSummary.textContent = `${lead}${skunks}`;
}

async function openPeopleProfile(username: string, options: { push?: boolean } = {}): Promise<void> {
  dismissHandicapTooltip();
  els.peoplePresencePanel.hidden = true;
  els.peoplePresenceToggle.setAttribute("aria-expanded", "false");
  els.peopleProfileStatus.textContent = "";
  const response = await authJson<PeopleProfileResponse>("/api/people/profile", { username });
  renderPeopleProfile(response.profile);
  els.peopleProfilePage.hidden = false;
  els.humanTablePage.hidden = true;
  if (options.push !== false) {
    window.history.pushState({ peopleProfile: response.profile.username }, "", profileRouteUrl(response.profile.username));
  }
  trackActivityPageView("people:profile");
  window.setTimeout(() => els.peopleProfileBack.focus(), 0);
}

function hidePeopleProfile(): void {
  els.peopleProfilePage.hidden = true;
  selectedPeopleProfile = null;
  pendingAvatarDataUrl = null;
}

function playerSeat(player: PeoplePlayer, label: string): HTMLElement[] {
  const avatar = document.createElement("div");
  avatar.className = "people-avatar human-seat-avatar";
  renderPeopleAvatar(avatar, player);
  const copy = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.textContent = label;
  const name = document.createElement("strong");
  setPlayerIdentity(name, player.displayName, player.dynamicHandicap ?? null);
  copy.append(eyebrow, name);
  return [avatar, copy];
}

function humanCutElement(card: HumanCutCard, label: string): HTMLElement {
  const element = document.createElement("div");
  element.className = `human-cut-card ${card.suit}`;
  element.setAttribute("aria-label", `${label}: ${card.rank} of ${card.suit}`);
  const rank = document.createElement("strong");
  rank.textContent = card.rank;
  const suit = document.createElement("span");
  suit.textContent = card.symbol;
  element.append(rank, suit);
  return element;
}

function renderHumanTable(table: HumanTable): void {
  if (activeHumanTable?.id !== table.id) {
    humanGameWatchGeneration += 1;
    humanGameTableId = table.id;
    humanGameRevision = -1;
    pendingHumanGameCommand = null;
  }
  activeHumanTable = table;
  peopleDirectory.activeTable = table.phase === "complete" ? null : table;
  syncPathwayResumePresentation();
  els.humanTableChallenger.replaceChildren(...playerSeat(table.challenger, "Challenger"));
  els.humanTableChallenged.replaceChildren(...playerSeat(table.challenged, "Invited player"));
  els.humanTableCuts.replaceChildren();
  if (table.challengerCut) els.humanTableCuts.append(humanCutElement(table.challengerCut, table.challenger.displayName));
  if (table.challengedCut) els.humanTableCuts.append(humanCutElement(table.challengedCut, table.challenged.displayName));
  const ownCut = table.viewerSeat === "challenger" ? table.challengerCut : table.challengedCut;
  if (table.phase === "waiting") {
    els.humanTableTitle.textContent = "Waiting at the table.";
    els.humanTableMessage.textContent = `${table.challenged.displayName} has been invited. This table will open when they join.`;
    els.humanTableCut.hidden = true;
  } else if (table.phase === "cut_for_deal") {
    els.humanTableTitle.textContent = "Cut for first deal.";
    els.humanTableMessage.textContent = ownCut
      ? "Your cut is on the table. Waiting for the other player."
      : "Both players are seated. Low card deals first.";
    els.humanTableCut.hidden = Boolean(ownCut);
  } else if (table.phase === "playing") {
    els.humanTableTitle.textContent = `${table.dealerUsername || "Dealer"} deals first.`;
    els.humanTableMessage.textContent = "Both cuts are down. Opening the first deal…";
    els.humanTableCut.hidden = true;
  } else {
    els.humanTableTitle.textContent = "Game complete.";
    els.humanTableMessage.textContent = "Opening the completed game…";
    els.humanTableCut.hidden = true;
  }
}

function applyHumanGameResponse(response: HumanGameResponse): GameState {
  const sameTable = humanGameTableId === response.tableId;
  if (sameTable && response.revision < humanGameRevision && state.game) return state.game;
  if (!sameTable) {
    humanGameTableId = response.tableId;
    humanGameRevision = -1;
    pendingHumanGameCommand = null;
  }
  humanGameRevision = response.revision;
  humanGameCanContinueScoring = response.canContinueScoring;
  humanGameCanAcknowledgePeggingReset = response.canAcknowledgePeggingReset;
  const currentScoreEvent = currentScoringScoreEvent(response.snapshot.gameId ?? null, response.state);
  state.scoreSummaryQueue = state.scoreSummaryQueue.filter((summary) => summary.key === currentScoreEvent?.id);
  if (state.activeScoreSummary && state.activeScoreSummary.key !== currentScoreEvent?.id) {
    state.activeScoreSummary = null;
    renderScoreSummaryDialog();
  }
  if (activeHumanTable && response.state.phase === "game_over") {
    activeHumanTable.phase = "complete";
    if (peopleDirectory.activeTable?.id === activeHumanTable.id) peopleDirectory.activeTable = null;
  }
  applyAuthoritativeGameState(response.snapshot, response.state);
  syncPathwayResumePresentation();
  return response.state;
}

async function fetchHumanGame(): Promise<GameState> {
  if (!activeHumanTable) throw new Error("That player table is no longer open.");
  const response = await authJson<HumanGameResponse>("/api/people/table/game", {
    tableId: activeHumanTable.id,
  });
  return applyHumanGameResponse(response);
}

function startHumanGameSync(): void {
  const generation = ++humanGameWatchGeneration;
  const tableId = activeHumanTable?.id;
  if (!tableId || state.game?.phase === "game_over") return;
  void (async () => {
    while (
      generation === humanGameWatchGeneration
      && activeHumanTable?.id === tableId
      && state.game?.phase !== "game_over"
    ) {
      if (state.pending || !els.pathwayPage.hidden || !els.authPage.hidden) {
        await waitMs(250);
        continue;
      }
      const afterRevision = humanGameRevision;
      try {
        const response = await authJson<HumanGameResponse>("/api/people/table/game/watch", {
          tableId,
          afterRevision,
        });
        if (generation !== humanGameWatchGeneration || activeHumanTable?.id !== tableId) return;
        if (state.pending || !els.pathwayPage.hidden || !els.authPage.hidden) continue;
        if (response.revision > humanGameRevision) {
          state.selected.clear();
          const game = applyHumanGameResponse(response);
          render(game);
        }
      } catch (error) {
        if (generation !== humanGameWatchGeneration || activeHumanTable?.id !== tableId) return;
        els.humanTableStatus.textContent = error instanceof Error ? error.message : "The game could not be refreshed.";
        await waitMs(HUMAN_GAME_WATCH_RETRY_MS);
      }
    }
  })();
}

async function performVisibleHumanGameRefresh(): Promise<void> {
  if (!activeHumanTable || state.game?.phase === "game_over" || state.pending) return;
  const tableId = activeHumanTable.id;
  humanGameWatchGeneration += 1;
  const beforeRevision = humanGameRevision;
  try {
    const response = await authJson<HumanGameResponse>("/api/people/table/game", { tableId });
    if (activeHumanTable?.id !== tableId) return;
    const game = applyHumanGameResponse(response);
    if (response.revision > beforeRevision) {
      state.selected.clear();
      render(game);
    }
  } catch (error) {
    els.humanTableStatus.textContent = error instanceof Error ? error.message : "The game could not be refreshed.";
  } finally {
    if (activeHumanTable?.id === tableId) startHumanGameSync();
  }
}

function refreshVisibleHumanGame(): Promise<void> {
  if (humanGameRefreshPromise) return humanGameRefreshPromise;
  humanGameRefreshPromise = performVisibleHumanGameRefresh().finally(() => {
    humanGameRefreshPromise = null;
  });
  return humanGameRefreshPromise;
}

async function enterHumanGame(started = false): Promise<void> {
  if (!activeHumanTable) return;
  const previousGameId = currentSnapshot?.gameId;
  const game = await fetchHumanGame();
  if (previousGameId !== currentSnapshot?.gameId) humanDecisionReviewPlayer = "human";
  state.splashOpen = false;
  state.hasResumableGame = false;
  els.splashPage.hidden = true;
  els.pathwayPage.hidden = true;
  els.peopleProfilePage.hidden = true;
  els.humanTablePage.hidden = true;
  render(game);
  if (started && currentSnapshot?.gameId) {
    activityTracker.track("game_start", {
      opponent: "human",
      handNumber: game.handNumber,
    }, true);
  }
  if (previousGameId !== currentSnapshot?.gameId) announceGameEntry(game);
  startHumanGameSync();
}

/*
 * Human tables use a revision watch rather than a timer poll. The generation
 * token is the local cancellation mechanism; late responses are also guarded
 * by applyHumanGameResponse's monotonic revision check.
 */
function stopHumanGameSync(): void {
  humanGameWatchGeneration += 1;
}

/*
 * Table setup still has no game revision until both cuts are down, so it uses
 * its slower table-status poll and hands off to the game watch after dealing.
 */
function scheduleHumanTablePoll(): void {
  if (humanTablePollTimer !== null) window.clearTimeout(humanTablePollTimer);
  if (!activeHumanTable || els.humanTablePage.hidden || activeHumanTable.phase === "playing" || activeHumanTable.phase === "complete") return;
  humanTablePollTimer = window.setTimeout(async () => {
    if (!activeHumanTable || els.humanTablePage.hidden) return;
    try {
      const response = await authJson<HumanTableResponse>("/api/people/table", { tableId: activeHumanTable.id });
      renderHumanTable(response.table);
      if (response.table.phase === "playing" || response.table.phase === "complete") {
        await enterHumanGame(true);
        return;
      }
      scheduleHumanTablePoll();
    } catch (error) {
      els.humanTableStatus.textContent = error instanceof Error ? error.message : "The table could not be refreshed.";
      scheduleHumanTablePoll();
    }
  }, 1_800);
}

async function openHumanTable(tableId: string, options: { push?: boolean } = {}): Promise<void> {
  const response = await authJson<HumanTableResponse>("/api/people/table", { tableId });
  renderHumanTable(response.table);
  hidePeopleProfile();
  els.humanTableStatus.textContent = "";
  if (options.push !== false) {
    window.history.pushState({ humanTable: tableId }, "", tableRouteUrl(tableId));
  }
  if (response.table.phase === "playing" || response.table.phase === "complete") {
    els.humanTablePage.hidden = true;
    await enterHumanGame();
    return;
  }
  els.humanTablePage.hidden = false;
  trackActivityPageView("people:table");
  scheduleHumanTablePoll();
  void refreshPeople({ heartbeat: true });
}

function hideHumanTable(): void {
  els.humanTablePage.hidden = true;
  activeHumanTable = null;
  syncPathwayResumePresentation();
  if (humanTablePollTimer !== null) window.clearTimeout(humanTablePollTimer);
  humanTablePollTimer = null;
  stopHumanGameSync();
  humanGameTableId = null;
  humanGameRevision = -1;
  pendingHumanGameCommand = null;
  humanGameCanContinueScoring = false;
  humanGameCanAcknowledgePeggingReset = false;
  humanDecisionReviewPlayer = "human";
}

async function challengePeoplePlayer(username: string): Promise<void> {
  if (!authenticatedUser) {
    requestAuthentication({ kind: "challenge", username }, "Sign in to invite this player to a game.");
    return;
  }
  const response = await authJson<ChallengeResponse>("/api/people/challenge", { username });
  await openHumanTable(response.challenge.tableId);
}

async function acceptPeopleChallenge(challenge: PeopleChallenge): Promise<void> {
  if (!authenticatedUser) return;
  const response = await authJson<{ ok: boolean; tableId: string }>("/api/people/challenge/accept", {
    challengeId: challenge.id,
  });
  await openHumanTable(response.tableId);
}

async function resizeProfileImage(file: File): Promise<string> {
  if (!file.type.match(/^image\/(jpeg|png|webp)$/)) throw new Error("Choose a JPEG, PNG, or WebP image.");
  if (file.size > 8_000_000) throw new Error("Choose an image smaller than 8 MB.");
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let cleanup = (): void => undefined;
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    cleanup = () => bitmap.close();
  } else {
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    try {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => reject(new Error("This image could not be read.")), { once: true });
        image.src = imageUrl;
      });
    } catch (error) {
      URL.revokeObjectURL(imageUrl);
      throw error;
    }
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
    cleanup = () => URL.revokeObjectURL(imageUrl);
  }
  const size = 320;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    cleanup();
    throw new Error("This browser cannot resize the image.");
  }
  const crop = Math.min(width, height);
  const sourceX = (width - crop) / 2;
  const sourceY = (height - crop) / 2;
  context.drawImage(source, sourceX, sourceY, crop, crop, 0, 0, size, size);
  cleanup();
  return canvas.toDataURL("image/jpeg", 0.84);
}

function openSizeDialog(): void {
  const selected = els.sizeDialog.querySelector<HTMLInputElement>(`input[name="pathway-size"][value="${state.fontSize}"]`);
  if (selected) selected.checked = true;
  els.sizeDialogStatus.textContent = authenticatedUser
    ? "This preference is saved with your account."
    : "This preference is saved in this browser.";
  els.sizeDialog.showModal();
}

async function saveSizePreference(): Promise<void> {
  const selected = els.sizeDialog.querySelector<HTMLInputElement>('input[name="pathway-size"]:checked');
  if (!selected) return;
  state.fontSize = normalizeAppFontSize(selected.value);
  safeLocalStorageSet(FONT_SIZE_STORAGE_KEY, state.fontSize);
  applyFontSizePreference();
  if (authenticatedUser) {
    await authJson<{ ok: boolean; textSize: AppFontSize }>("/api/people/preferences", {
      textSize: state.fontSize,
    });
    if (ownPeopleProfile) ownPeopleProfile.textSize = state.fontSize;
  }
  els.sizeDialog.close();
  render(state.game);
}

function requestAuthentication(destination: PendingAuthDestination | null, message: string): void {
  pendingAuthDestination = destination;
  els.pathwayPage.hidden = true;
  hidePeopleProfile();
  hideHumanTable();
  showAuthView("login", message);
  window.setTimeout(() => els.authEmail.focus(), 0);
}

function currentAuthenticationRequest(): {
  destination: PendingAuthDestination | null;
  message: string;
} {
  if (pendingAuthDestination) {
    return { destination: pendingAuthDestination, message: "Your session expired. Sign in to continue." };
  }
  const locationRequest = locationAuthenticationRequest();
  if (locationRequest) return locationRequest;
  if (activeHumanTable) {
    return {
      destination: { kind: "table", tableId: activeHumanTable.id },
      message: "Your session expired. Sign in to return to this table.",
    };
  }
  if (selectedPeopleProfile) {
    return {
      destination: { kind: "profile", username: selectedPeopleProfile.username },
      message: "Your session expired. Sign in to return to this player profile.",
    };
  }
  if (state.analyticsOpen && state.analyticsMode === "my") {
    return { destination: { kind: "statistics" }, message: "Your session expired. Sign in to view your statistics." };
  }
  if (selectedPathwayOpponent === DEFAULT_OPPONENT) {
    return { destination: { kind: "master" }, message: "Your session expired. Sign in to continue with Ace." };
  }
  if (selectedPathwayOpponent === PATHWAY_OPPONENTS.dynamic) {
    return { destination: { kind: "dynamic" }, message: "Your session expired. Sign in to continue with Dynamic." };
  }
  return { destination: null, message: "Your session expired. Sign in to continue." };
}

function recoverExpiredAuthentication(): AuthenticationRequiredError {
  const request = currentAuthenticationRequest();
  authenticatedUser = null;
  state.engagementOpen = false;
  els.engagementPage.hidden = true;
  applyAdminVisibility();
  ownPeopleProfile = null;
  peopleActive = false;
  stopPeopleChallengeWatch();
  if (peopleIdleTimer !== null) window.clearTimeout(peopleIdleTimer);
  peopleIdleTimer = null;
  if (humanTablePollTimer !== null) window.clearTimeout(humanTablePollTimer);
  humanTablePollTimer = null;
  stopHumanGameSync();
  els.authAccountRow.hidden = true;
  els.authLoginRow.hidden = false;
  resetTransientGameUi();
  requestAuthentication(request.destination, request.message);
  return new AuthenticationRequiredError();
}

function locationAuthenticationRequest(): {
  destination: PendingAuthDestination;
  message: string;
} | null {
  const params = new URL(window.location.href).searchParams;
  const tableId = params.get("table");
  if (tableId) {
    return {
      destination: { kind: "table", tableId },
      message: "Sign in to take your seat at this table.",
    };
  }
  const username = params.get("profile");
  if (username) {
    return {
      destination: { kind: "profile", username },
      message: "Sign in to view this player profile.",
    };
  }
  const route = pathwayRouteFromLocation();
  if (route === "statistics") {
    return {
      destination: { kind: "statistics" },
      message: "Sign in to view your statistics.",
    };
  }
  if (route === "human") {
    return {
      destination: { kind: "human" },
      message: "Sign in to find a human opponent.",
    };
  }
  return null;
}

async function resumeAuthenticatedDestination(): Promise<void> {
  const destination = pendingAuthDestination;
  pendingAuthDestination = null;
  if (!destination) {
    if (PATHWAY_NAV_ENABLED) applyPathwayRoute(pathwayRouteFromLocation());
    return;
  }
  if (destination.kind === "master") {
    await launchPathwayOpponent(DEFAULT_OPPONENT);
  } else if (destination.kind === "dynamic") {
    await launchPathwayOpponent(PATHWAY_OPPONENTS.dynamic);
  } else if (destination.kind === "statistics") {
    if (pathwayRouteFromLocation() === "statistics") applyPathwayRoute("statistics");
    else navigatePathway("statistics");
  } else if (destination.kind === "human") {
    if (pathwayRouteFromLocation() === "human") applyPathwayRoute("human");
    else navigatePathway("human");
  } else if (destination.kind === "table") {
    await openHumanTable(destination.tableId, { push: false });
  } else if (destination.kind === "profile") {
    await openPeopleProfile(destination.username, { push: false });
  } else {
    await challengePeoplePlayer(destination.username);
  }
}

function clearPeopleRouteParameter(parameter: "profile" | "table"): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(parameter);
  window.history.replaceState(
    pathwayHistoryState(pathwayRouteFromLocation()),
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function cancelPendingAuthentication(): void {
  const destination = pendingAuthDestination;
  pendingAuthDestination = null;
  els.authPage.hidden = true;
  document.body.dataset.auth = "guest";
  if (destination?.kind === "table") clearPeopleRouteParameter("table");
  if (
    (destination?.kind === "human" && pathwayRouteFromLocation() === "human")
    || (destination?.kind === "statistics" && pathwayRouteFromLocation() === "statistics")
  ) {
    const url = new URL(window.location.href);
    url.searchParams.delete(PATHWAY_VIEW_PARAM);
    window.history.replaceState(pathwayHistoryState("home"), "", `${url.pathname}${url.search}${url.hash}`);
  }
  applyPathwayRoute(pathwayRouteFromLocation());
  void syncPeopleRouteFromLocation();
}

async function syncPeopleRouteFromLocation(): Promise<void> {
  const params = new URL(window.location.href).searchParams;
  const tableId = params.get("table");
  const username = params.get("profile");
  if (tableId) {
    if (!authenticatedUser) {
      requestAuthentication({ kind: "table", tableId }, "Sign in to take your seat at this table.");
      return;
    }
    await openHumanTable(tableId, { push: false });
    return;
  }
  hideHumanTable();
  if (username) {
    if (!authenticatedUser) {
      requestAuthentication({ kind: "profile", username }, "Sign in to view this player profile.");
      return;
    }
    await openPeopleProfile(username, { push: false });
    return;
  }
  hidePeopleProfile();
}

type AuthView = "login" | "otp" | "reset" | "invite";

function showAuthView(view: AuthView, message = "", error = false): void {
  document.body.dataset.auth = "signed-out";
  els.authPage.hidden = false;
  els.pathwayPage.hidden = true;
  els.peopleProfilePage.hidden = true;
  els.humanTablePage.hidden = true;
  els.splashPage.hidden = true;
  syncMobileGameplayHeaderPlacement();
  els.authLoginForm.hidden = view !== "login";
  els.authOtpForm.hidden = view !== "otp";
  els.authPasswordForm.hidden = view !== "reset" && view !== "invite";
  els.authStatus.textContent = message;
  els.authStatus.dataset.error = error ? "true" : "false";
  els.authCancel.hidden = AUTHENTICATION_ENABLED || !pendingAuthDestination || view !== "login";
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
  trackActivityPageView(`auth:${view}`);
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
  els.authLoginRow.hidden = true;
  els.authAccountProfile.textContent = user.displayName;
  applyAdminVisibility();
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("reset");
  cleanUrl.searchParams.delete("invite");
  window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}

async function initializeAuthentication(): Promise<boolean> {
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
    authenticatedUser = null;
    applyAdminVisibility();
    document.body.dataset.auth = "guest";
    els.authPage.hidden = true;
    els.authAccountRow.hidden = true;
    els.authLoginRow.hidden = false;
    if (AUTHENTICATION_ENABLED) {
      showAuthView("login");
      window.setTimeout(() => els.authEmail.focus(), 0);
      return false;
    }
    return true;
  } catch (error) {
    if (AUTHENTICATION_ENABLED) {
      showAuthView("login", error instanceof Error ? error.message : "Account service is temporarily unavailable.", true);
      return false;
    }
    document.body.dataset.auth = "guest";
    els.authPage.hidden = true;
    els.authAccountRow.hidden = true;
    els.authLoginRow.hidden = false;
    return true;
  }
}

async function completeAuthenticationAndStart(response: AuthSessionResponse, method: string): Promise<void> {
  if (!response.authenticated || !response.user) {
    throw new Error("The account response was incomplete.");
  }
  finishAuthentication(response.user);
  activityTracker.track("login", { method }, true);
  await initializePeople();
  await resumeAuthenticatedDestination();
  if (!PATHWAY_NAV_ENABLED) await initializeGameState();
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
  if (LOCAL_QA_MODE) return;
  if (!authenticatedUser) return;
  const playerTag = currentSessionTag();
  if (!shouldUploadCompletedGame({
    remoteEnabled: usesRemoteAi(),
    localQaMode: LOCAL_QA_MODE,
    force,
    alreadyUploaded: uploadedGameIds().has(gameId),
    playerTag,
  })) return;
  const store = loadAnalytics();
  const events = store.events.filter((event) => event.gameId === gameId).map((event) => tagPhoneRecord(event));
  if (!events.length) return;
  const endEvent = events.find((event) => event.type === "game" && event.action === "end");
  if (!endEvent) return;
  const startEvent = events.find(
    (event): event is Extract<AnalyticsEvent, { type: "game" }> & { tags?: string[]; sessionTag?: string } =>
      event.type === "game" && event.action === "start",
  );
  void serverJson<CompletedGameUploadResponse>("/api/games", {
    gameId,
    tag: playerTag,
    appVersion: __APP_VERSION__,
    model: startEvent?.opponent ?? currentSnapshot?.opponent ?? SIMPLE_NETWORK_OPPONENT,
    finalResult: endEvent,
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
  if (LOCAL_QA_MODE) return;
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
  state.engagementOpen = false;
  els.engagementPage.hidden = true;
  if (els.pathwayPage.hidden && isActiveGame(state.game)) suspendActiveGameForPathway();
  els.pathwayPage.hidden = false;
  els.pathwayPage.dataset.view = view;
  const parent = pathwayParentRoute(view);
  els.pathwayHeaderHome.hidden = parent === null;
  if (parent) els.pathwayHeaderParentLabel.textContent = pathwayRouteLabel(parent);
  syncMobileGameplayHeaderPlacement();
  syncPathwayResumePresentation();
  for (const pathwayView of els.pathwayViews) {
    pathwayView.hidden = pathwayView.dataset.pathwayView !== view;
  }
  els.pathwayPage.scrollTo({ top: 0, left: 0 });
  if (view === "human") renderPeopleDirectory();
  if (authenticatedUser) void refreshPeople({ heartbeat: true });
  if (view === "play") void refreshPathwayResumeSessions();
}

function syncPathwayResumePresentation(): void {
  const modelGames = Array.from(remoteResumableModelGames, ([opponent, phase]) => ({ opponent, phase }));
  const localGameState = state.game;
  if (state.hasResumableGame && localGameState && localGameState.phase !== "game_over" && currentSnapshot?.opponent) {
    const localIndex = modelGames.findIndex((game) => game.opponent === currentSnapshot?.opponent);
    const localGame = { opponent: currentSnapshot.opponent, phase: localGameState.phase };
    if (localIndex >= 0) modelGames[localIndex] = localGame;
    else modelGames.push(localGame);
  }
  const resumable = new Set(resumablePathwayDestinations({
    modelGames,
    humanGameActive: resumableHumanTable() !== null,
  }));
  for (const button of els.pathwayDestinationButtons) {
    const destination = button.dataset.pathwayDestination as "easy" | "tough" | "master" | "dynamic" | "human";
    const active = resumable.has(destination);
    button.classList.toggle("pathway-choice-resumable", active);
    button.dataset.resumable = active ? "true" : "false";
    if (active) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
    const status = button.querySelector<HTMLElement>(".pathway-resume-status");
    if (status) status.hidden = !active;
  }
  const liveCalibration = currentSnapshot?.opponent === PATHWAY_OPPONENTS.dynamic
    ? state.game?.dynamicCalibration
    : null;
  const profileCalibration = ownPeopleProfile?.dynamicCalibration;
  const calibration = liveCalibration &&
    (!profileCalibration || liveCalibration.completeCycles >= profileCalibration.completeCycles)
    ? liveCalibration
    : profileCalibration;
  const hasStartedGame = Boolean(
    calibration?.started ||
    remoteResumableModelGames.has(PATHWAY_OPPONENTS.dynamic) ||
    currentSnapshot?.opponent === PATHWAY_OPPONENTS.dynamic && state.game,
  );
  const copy = dynamicCardCopy(calibration, hasStartedGame);
  els.dynamicCardCopy.textContent = copy;
  els.dynamicCardCopy.dataset.state = copy === DYNAMIC_CALIBRATING_LABEL ? "calibrating" : "default";
}

function renderDynamicCalibrationStatus(game: GameState): void {
  const calibration = game.dynamicCalibration;
  const calibrating = isDynamicCalibrating(calibration);
  els.dynamicCalibrationStatus.hidden = !calibrating;
  if (!calibration || !calibrating) {
    els.dynamicCalibrationStatus.removeAttribute("aria-label");
    els.dynamicCalibrationHandicap.hidden = true;
    return;
  }
  const handicapCopy = dynamicProvisionalHandicapCopy(calibration);
  els.dynamicCalibrationHandicap.hidden = !handicapCopy;
  if (handicapCopy && els.dynamicCalibrationHandicap.textContent !== handicapCopy) {
    els.dynamicCalibrationHandicap.textContent = handicapCopy;
  }
  const accessibleCopy = `Dynamic calibration: ${calibration.completeCycles} of ${calibration.minimumCycles} complete cycles${handicapCopy ? `. ${handicapCopy}` : ""}`;
  if (els.dynamicCalibrationStatus.getAttribute("aria-label") !== accessibleCopy) {
    els.dynamicCalibrationStatus.setAttribute("aria-label", accessibleCopy);
  }
}

function pathwayOpponentLabel(opponent: Opponent): "Easy" | "Tough" | "Ace" | "Dynamic" {
  if (opponent === PATHWAY_OPPONENTS.easy) return "Easy";
  if (opponent === PATHWAY_OPPONENTS.tough) return "Tough";
  if (opponent === PATHWAY_OPPONENTS.dynamic) return "Dynamic";
  return "Ace";
}

function syncPathwayOpponentPresentation(opponent: Opponent): void {
  const label = pathwayOpponentLabel(opponent);
  els.splashEyebrow.textContent = `Strong Cribbage · ${label}`;
  els.splashDescription.textContent = `Play one-on-one against the ${label} opponent.`;
}

function beginPathwayOpponent(opponent: Opponent): void {
  state.pendingPathwayRoute = null;
  state.pendingMasterGameId = null;
  els.masterSessionDialog.hidden = true;
  if (opponent === DEFAULT_OPPONENT && !authenticatedUser) {
    requestAuthentication({ kind: "master" }, "Sign in to play Ace.");
    return;
  }
  if (opponent === PATHWAY_OPPONENTS.dynamic && !authenticatedUser) {
    requestAuthentication({ kind: "dynamic" }, "Sign in so Dynamic can adapt to your play over time.");
    return;
  }
  selectedPathwayOpponent = opponent;
  els.opponent.value = opponent;
  syncPathwayOpponentPresentation(opponent);
  els.pathwayPage.hidden = true;
  state.hasResumableGame = false;

  if (!playerFirstName) {
    state.splashOpen = true;
    document.body.dataset.splash = "true";
    els.splashPage.hidden = false;
    els.splashResumeGame.hidden = true;
    els.splashNewGame.hidden = false;
    els.splashNameRow.hidden = false;
    window.setTimeout(() => els.splashFirstName.focus(), 0);
    return;
  }

  state.splashOpen = false;
  document.body.dataset.splash = "false";
  els.splashPage.hidden = true;
  void startNewGameFromUi({ forceNew: true, allowActiveReplacement: true });
}

async function launchPathwayOpponent(opponent: Opponent): Promise<void> {
  if ((opponent === DEFAULT_OPPONENT || opponent === PATHWAY_OPPONENTS.dynamic) && !authenticatedUser) {
    beginPathwayOpponent(opponent);
    return;
  }
  beginPathwayOpponent(opponent);
}

function suspendActiveGameForPathway(): void {
  state.pending = false;
  resetTransientGameUi();
}

function clearForfeitedLocalGame(gameId: string): void {
  if (currentSnapshot?.gameId !== gameId) return;
  currentSnapshot = null;
  state.game = null;
  state.hasResumableGame = false;
  gameStateGeneration += 1;
  safeLocalStorageRemove(SAVE_KEY);
}

function leaveActivePathwayGame(route: PathwayRoute): void {
  const gameId = currentSnapshot && isAceOpponent(currentSnapshot.opponent) && isActiveGame(state.game)
    ? currentSnapshot.gameId
    : null;
  if (!gameId) {
    navigatePathway(route);
    return;
  }
  state.pendingPathwayRoute = route;
  state.pendingMasterGameId = gameId;
  els.masterSessionStatus.textContent = "";
  els.masterSessionDialog.hidden = false;
  window.setTimeout(() => els.masterSessionSave.focus(), 0);
}

function dismissMasterSessionDialog(): void {
  state.pendingPathwayRoute = null;
  state.pendingMasterGameId = null;
  els.masterSessionDialog.hidden = true;
  els.masterSessionStatus.textContent = "";
}

async function forfeitSavedMasterGame(): Promise<void> {
  const gameId = state.pendingMasterGameId;
  const nextRoute = state.pendingPathwayRoute;
  if (!gameId || !nextRoute) return;
  els.masterSessionForfeit.disabled = true;
  els.masterSessionSave.disabled = true;
  els.masterSessionCancel.disabled = true;
  els.masterSessionStatus.textContent = "Forfeiting Ace game…";
  try {
    await serverJson<ServerGameActionResponse>("/api/game/action", {
      action: "forfeit",
      gameId,
      payload: {},
      tag: currentSessionTag() || null,
    });
    activityTracker.track("game_forfeit", { gameId, opponent: DEFAULT_OPPONENT }, true);
    clearForfeitedLocalGame(gameId);
    dismissMasterSessionDialog();
    navigatePathway(nextRoute);
  } catch (error) {
    els.masterSessionStatus.textContent = error instanceof Error ? error.message : "The Ace game could not be forfeited.";
  } finally {
    els.masterSessionForfeit.disabled = false;
    els.masterSessionSave.disabled = false;
    els.masterSessionCancel.disabled = false;
  }
}

function pathwayRouteFromLocation(): PathwayRoute {
  const route = new URL(window.location.href).searchParams.get(PATHWAY_VIEW_PARAM);
  if (route === "play" || route === "human" || route === "tutorial" || route === "settings" || route === "gameplay" || route === "statistics" || route === "leaderboard") return route;
  return "home";
}

function pathwayParentRoute(route: PathwayRoute): PathwayRoute | null {
  if (route === "home") return null;
  if (route === "human") return "play";
  if (route === "gameplay") return "settings";
  return "home";
}

function currentAppBackRoute(): PathwayRoute {
  const route = pathwayRouteFromLocation();
  if (state.analyticsOpen && route === "statistics") return pathwayParentRoute(route) ?? "home";
  if (state.leaderboardOpen && route === "leaderboard") return pathwayParentRoute(route) ?? "home";
  return "play";
}

function pathwayRouteLabel(route: PathwayRoute): string {
  if (route === "play") return "Play";
  if (route === "settings") return "Settings";
  if (route === "tutorial") return "Training";
  if (route === "statistics") return "Statistics";
  if (route === "leaderboard") return "Leaderboard";
  if (route === "human") return "Human Opponents";
  if (route === "gameplay") return "Gameplay";
  return "Home";
}

function pathwayHistoryState(route: PathwayRoute): Record<string, unknown> {
  const existing = window.history.state;
  const state = existing && typeof existing === "object" ? existing as Record<string, unknown> : {};
  return { ...state, [PATHWAY_HISTORY_STATE_KEY]: route };
}

function pathwayUrl(route: PathwayRoute, clearPeopleRoute = false): string {
  const url = new URL(window.location.href);
  if (clearPeopleRoute) {
    url.searchParams.delete("table");
    url.searchParams.delete("profile");
  }
  if (route === "home") url.searchParams.delete(PATHWAY_VIEW_PARAM);
  else url.searchParams.set(PATHWAY_VIEW_PARAM, route);
  return `${url.pathname}${url.search}${url.hash}`;
}

function applyPathwayRoute(route: PathwayRoute): void {
  if (route === "human" && !authenticatedUser) {
    requestAuthentication({ kind: "human" }, "Sign in to find a human opponent.");
    return;
  }
  if (route === "statistics") {
    if (!authenticatedUser) {
      requestAuthentication({ kind: "statistics" }, "Sign in to view your statistics.");
      return;
    }
    els.pathwayPage.hidden = true;
    state.splashOpen = false;
    document.body.dataset.splash = "false";
    openAnalytics("my");
    return;
  }
  if (route === "leaderboard") {
    els.pathwayPage.hidden = true;
    state.splashOpen = false;
    document.body.dataset.splash = "false";
    openLeaderboard();
    return;
  }

  if (state.analyticsOpen) {
    state.analyticsOpen = false;
    render(state.game);
  }
  state.leaderboardOpen = false;
  showPathwayView(route);
  trackActivityPageView(`pathway:${route}`);
}

function navigatePathway(route: PathwayRoute): void {
  if (!PATHWAY_NAV_ENABLED) return;
  window.history.pushState(pathwayHistoryState(route), "", pathwayUrl(route, true));
  applyPathwayRoute(route);
}

function applyPathwayNavigation(): void {
  els.pathwayPage.hidden = !PATHWAY_NAV_ENABLED;
  if (!PATHWAY_NAV_ENABLED) return;
  const route = pathwayRouteFromLocation();
  window.history.replaceState(pathwayHistoryState(route), "", pathwayUrl(route));
}

function buildBoard(): void {
  els.board.innerHTML = "";
  els.board.append(createCircularBoard());
  for (const player of ["human", "ai"] as const) {
    const lane = document.createElement("div");
    lane.className = `lane ${player}`;

    const label = document.createElement("div");
    label.className = "lane-label";
    label.textContent = playerName(player);
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
        wrap.title = `${playerName(player)} expected after hand ${projection.hand}: ${projection.score.toFixed(1)}`;
      }
      if (String(positions[0]) === hole.dataset.position) hole.classList.add("peg", "back-peg");
      if (String(positions[1]) === hole.dataset.position) hole.classList.add("peg", "front-peg");
    }
  }
  requestAnimationFrame(() => {
    if (showParGuides) renderPaceLines(pegPositions, projections, firstDealerPlayer, completedHands);
    else clearPaceLines();
  });
  const dealCutPresentation = state.dealCutRevealStage
    ? {
        eyebrow: "First deal",
        value: state.dealCutRevealStage === "ai" ? "LOW" : "CUT",
        detail: state.dealCutRevealStage === "cutting"
          ? "Choosing card"
          : state.dealCutRevealStage === "human"
            ? "Your card"
            : "Low card deals",
      }
    : null;
  updateCircularBoard(els.board, game, circularTurnCutPresentation(state.turnCutRevealStage) ?? dealCutPresentation, {
    human: playerDisplayName(),
    ai: engineName(currentSnapshot?.opponent ?? els.opponent.value),
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

interface MasterHint {
  kind: "discard" | "play" | "go";
  cardIds: number[];
}

interface AceAdvice extends MasterHint {
  cards: Array<{ id: number; rank: string; symbol: string }>;
}

interface PresentedAceAdvice extends AceAdvice {
  mode: "hint" | "mistake";
}

interface AceAdvicePreparation {
  key: string;
  advice: AceAdvice | null;
  promise: Promise<AceAdvice>;
}

interface AceMistake {
  handNumber: number;
  advice: AceAdvice;
}

interface ServerMasterHintResponse extends ServerGameActionResponse {
  hint: MasterHint;
}

interface RemoteGameSession {
  gameId: string | null;
  updatedAt: string;
  snapshot: GameSnapshot;
  state: GameState;
}

interface RemoteGameSessionResponse {
  ok: boolean;
  session: RemoteGameSession | null;
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

function newHumanGameActionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function humanGameCommand(
  tableId: string,
  action: string,
  payload: Record<string, unknown>,
): PendingHumanGameCommand {
  const payloadKey = JSON.stringify(payload);
  if (
    pendingHumanGameCommand?.tableId === tableId
    && pendingHumanGameCommand.action === action
    && pendingHumanGameCommand.payloadKey === payloadKey
  ) {
    return pendingHumanGameCommand;
  }
  pendingHumanGameCommand = {
    tableId,
    action,
    payloadKey,
    actionId: newHumanGameActionId(),
  };
  return pendingHumanGameCommand;
}

async function submitHumanGameAction(
  action: string,
  payload: Record<string, unknown>,
): Promise<GameState> {
  if (!activeHumanTable) throw new Error("That player table is no longer open.");
  const command = humanGameCommand(activeHumanTable.id, action, payload);
  const response = await authJson<HumanGameResponse>("/api/people/table/game/action", {
    tableId: command.tableId,
    action,
    actionId: command.actionId,
    revision: humanGameRevision,
    payload,
  });
  const acknowledgment = response.acknowledgment;
  if (
    !acknowledgment
    || acknowledgment.actionId !== command.actionId
    || acknowledgment.appliedRevision > response.revision
  ) {
    throw new Error("The player action acknowledgment was invalid.");
  }
  if (pendingHumanGameCommand?.actionId === command.actionId) pendingHumanGameCommand = null;
  return applyHumanGameResponse(response);
}

async function serverGameAction(action: string, payload: Record<string, unknown> | null = null): Promise<GameState> {
  if (activeHumanTable) {
    if (action === "state") return fetchHumanGame();
    const humanAction = action === "play-human"
      ? "play"
      : action === "go-human"
        ? "go"
        : action;
    const previousPhase = state.game?.phase;
    const game = await submitHumanGameAction(humanAction, payload ?? {});
    if (game.phase === "game_over" && previousPhase !== "game_over" && currentSnapshot?.gameId) {
      activityTracker.trackGameCompleted(currentSnapshot.gameId, {
        opponent: "human",
        humanScore: game.scores.human,
        aiScore: game.scores.ai,
        handNumber: game.handNumber,
      });
    }
    startHumanGameSync();
    return game;
  }
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
  const gameId = response.snapshot.gameId;
  if (action === "new" && gameId) {
    activityTracker.track("game_start", {
      opponent: response.snapshot.opponent,
      handNumber: response.state.handNumber,
    }, true);
  }
  if (response.state.phase === "game_over" && gameId) {
    activityTracker.trackGameCompleted(gameId, {
      opponent: response.snapshot.opponent,
      humanScore: response.state.scores.human,
      aiScore: response.state.scores.ai,
      handNumber: response.state.handNumber,
    });
  }
  startCutForDealPreparation(response.state);
  startAiDiscardPreparation(response.state);
  return response.state;
}

function lowerLevelOpponent(opponent: string | undefined): boolean {
  return isAceAdviceOpponent(opponent);
}

function canAskMaster(game: GameState): boolean {
  if (activeHumanTable) return false;
  const opponent = currentSnapshot?.opponent ?? selectedMenuOpponent();
  const interactionBlocked = Boolean(
    state.dealAnimation ||
    state.dealCutRevealStage ||
    state.dealCutResolve ||
    state.turnCutRevealStage,
  );
  return shouldOfferMasterHint(
    lowerLevelOpponent(opponent),
    game.phase,
    game.turn,
    game.legalCardIds.length,
    game.peggingResetPending,
    interactionBlocked,
  );
}

function aceAdvicePreparationKey(game: GameState | null): string | null {
  if (
    !game ||
    !currentSnapshot ||
    (!state.hintsEnabled && !state.errorNoticesEnabled) ||
    !canAskMaster(game)
  ) return null;
  return aceAdviceDecisionKey(currentSnapshot.gameId, game);
}

function aceAdviceFromHint(game: GameState, hint: MasterHint): AceAdvice {
  const cards = hint.cardIds
    .map((id) => game.humanHand.find((card) => card.id === id))
    .filter((card): card is GameState["humanHand"][number] => Boolean(card))
    .map(({ id, rank, symbol }) => ({ id, rank, symbol }));
  return { ...hint, cards };
}

function startAceAdvicePreparation(game: GameState): AceAdvicePreparation | null {
  const key = aceAdvicePreparationKey(game);
  if (!key || state.pending) return null;
  if (state.aceAdvicePreparation?.key === key) return state.aceAdvicePreparation;
  const snapshot = currentSnapshot;
  if (!snapshot) return null;

  let preparation: AceAdvicePreparation;
  const promise = serverJson<ServerMasterHintResponse>("/api/game/action", {
    action: "master-hint",
    payload: {},
    snapshot,
    tag: currentSessionTag() || null,
  }).then((response) => {
    const advice = aceAdviceFromHint(game, response.hint);
    if (state.aceAdvicePreparation === preparation) preparation.advice = advice;
    return advice;
  });
  preparation = { key, advice: null, promise };
  state.aceAdvicePreparation = preparation;
  void promise.catch(() => {
    if (state.aceAdvicePreparation === preparation) state.aceAdvicePreparation = null;
  });
  return preparation;
}

function preparedAceAdviceFor(game: GameState | null): AceAdvicePreparation | null {
  const key = aceAdvicePreparationKey(game);
  return key && state.aceAdvicePreparation?.key === key ? state.aceAdvicePreparation : null;
}

function reviewUserChoiceWithAce(
  game: GameState | null,
  action: AceAdviceAction,
  selectedCardIds: readonly number[],
): void {
  const choiceRevision = ++aceMistakeChoiceRevision;
  state.aceMistake = null;
  const preparation = preparedAceAdviceFor(game);
  state.aceAdvicePreparation = null;
  if (!game || !preparation) return;
  if (!state.errorNoticesEnabled) return;
  const handNumber = game.handNumber;
  void mistakeAdviceForChoice(
    action,
    selectedCardIds,
    preparation.advice ?? preparation.promise,
    () => aceMistakeChoiceRevision === choiceRevision,
  ).then((advice) => {
    if (!advice || !state.errorNoticesEnabled || state.game?.handNumber !== handNumber) return;
    state.aceMistake = { handNumber, advice };
    render(state.game);
  }).catch(() => undefined);
}

async function requestMasterHint(): Promise<void> {
  const game = state.game;
  if (!state.hintsEnabled || !game || state.pending || !canAskMaster(game)) return;
  const preparation = startAceAdvicePreparation(game);
  if (!preparation) return;
  state.pending = true;
  state.masterHint = null;
  render(game);
  try {
    const advice = preparation.advice ?? await preparation.promise;
    if (aceAdvicePreparationKey(state.game) !== preparation.key) return;
    await api("/api/record-help", { decisionKey: preparation.key });
    state.masterHint = { ...advice, mode: "hint" };
    render(state.game);
    window.setTimeout(() => els.masterHintApply.focus(), 0);
  } catch (error) {
    showServerBusy(error, () => void requestMasterHint());
  } finally {
    state.pending = false;
    render(state.game);
  }
}

function dismissMasterHint({ focus = false }: { focus?: boolean } = {}): void {
  const mode = state.masterHint?.mode;
  state.masterHint = null;
  if (mode === "mistake") state.aceMistake = null;
  els.masterHintDialog.hidden = true;
  if (focus) {
    window.setTimeout(() => {
      if (mode === "hint" && !els.askMaster.hidden) {
        els.askMaster.focus();
        return;
      }
      els.humanHand.querySelector<HTMLButtonElement>("button.card:not(:disabled)")?.focus();
    }, 0);
  }
}

function renderMasterHint(): void {
  const hint = state.masterHint;
  if (!hint) {
    els.masterHintDialog.hidden = true;
    return;
  }
  const recommendation = hint.kind === "go"
    ? "Ace recommends Go."
    : hint.cards.length
      ? `Ace recommends ${hint.kind === "discard" ? "discarding" : "playing"} ${hint.cards.map((card) => `${card.rank}${card.symbol}`).join(" and ")}.`
      : "Ace’s recommendation is no longer available.";
  const reviewingMistake = hint.mode === "mistake";
  els.masterHintCard.dataset.mode = hint.mode;
  els.masterHintEyebrow.textContent = reviewingMistake ? "Ace spotted an error" : "Ace’s advice";
  els.masterHintTitle.textContent = reviewingMistake ? "Review this choice" : "Ace recommends";
  els.masterHintCopy.textContent = reviewingMistake
    ? `${hint.kind === "discard" ? "Those discards were" : "That play was"} an error. ${recommendation}`
    : recommendation;
  els.masterHintDismiss.textContent = reviewingMistake ? "Got it" : "Dismiss";
  els.masterHintApply.hidden = reviewingMistake;
  els.masterHintApply.disabled = !hint.cards.length && hint.kind !== "go";
  els.masterHintDialog.hidden = false;
}

function isActiveGame(game: GameState | null): game is GameState {
  return Boolean(game && game.phase !== "game_over");
}

function canStartFreshGame(game: GameState | null): boolean {
  return !game || game.phase === "game_over" || game.phase === "cut_for_deal";
}

async function findRemoteActiveGameSession(opponent?: Opponent): Promise<RemoteGameSession | null> {
  if (!usesRemoteAi() || !authenticatedUser) return null;
  const tag = currentSessionTag();
  if (!tag) return null;
  const response = await serverJson<RemoteGameSessionResponse>("/api/game/session/load", {
    tag,
    opponent: opponent ?? null,
  });
  const session = response.session;
  if (!session || session.state.phase === "game_over") return null;
  return session;
}

async function refreshPathwayResumeSessions(): Promise<void> {
  const generation = ++pathwayResumeRefreshGeneration;
  if (!usesRemoteAi() || !authenticatedUser) {
    remoteResumableModelGames = new Map();
    syncPathwayResumePresentation();
    return;
  }
  try {
    const sessions = await Promise.all(
      Object.values(PATHWAY_OPPONENTS).map(async (opponent) => ({
        opponent,
        session: await findRemoteActiveGameSession(opponent),
      })),
    );
    if (generation !== pathwayResumeRefreshGeneration) return;
    remoteResumableModelGames = new Map(
      sessions.flatMap(({ opponent, session }) => session ? [[opponent, session.state.phase] as const] : []),
    );
    syncPathwayResumePresentation();
  } catch {
    // Keep the last known presentation when a passive refresh cannot reach the server.
  }
}

async function loadRemoteActiveGameSession(opponent?: Opponent): Promise<GameState | null> {
  const session = await findRemoteActiveGameSession(opponent);
  if (!session) return null;
  if (SIMPLE_NETWORK_MODE && !isAllowedSimpleNetworkOpponent(session.snapshot.opponent)) return null;
  applyAuthoritativeGameState(session.snapshot, session.state);
  activityTracker.track("game_resume", {
    opponent: session.snapshot.opponent,
    handNumber: session.state.handNumber,
    resumedPhase: session.state.phase,
  });
  baselineScoreEvents(
    state.scoreNoticeCursor,
    scoreNoticeGameId(session.state),
    session.state.analyticsEvents,
  );
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
  if (activeHumanTable) return;
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
  if (activeHumanTable) return;
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
      const next = await serverGameAction("discard", { ids: (body?.ids as number[]) || [] });
      if (currentSnapshot?.gameId) storeLiveDecisionReview(currentSnapshot.gameId);
      return next;
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
      const next = await serverGameAction("play", { id: body?.id as number });
      if (currentSnapshot?.gameId) storeLiveDecisionReview(currentSnapshot.gameId);
      return next;
    }
    if (path === "/api/play-human") {
      const next = await serverGameAction("play-human", { id: body?.id as number });
      if (currentSnapshot?.gameId) storeLiveDecisionReview(currentSnapshot.gameId);
      return next;
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
    if (path === "/api/record-help") {
      return serverGameAction("record-help", { decisionKey: String(body?.decisionKey ?? "") });
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
  const compactCardLimit = peggingDisplayCardLimit(window.innerWidth);
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
    for (const [index, card] of compact.visible.entries()) {
      const element = cardElement(card);
      element.classList.add(index === compact.visible.length - 1
        ? "pegging-card-exposed"
        : "pegging-card-covered");
      row.append(element);
    }
    els.plays.append(row);
  }
}

const DEAL_CUT_CARD_COUNT = 52;

function cutCardText(card: NonNullable<GameState["turnCard"]>): string {
  return `${card.rank}${card.symbol}`;
}

function dealCutOutcomeLabel(game: GameState): string {
  const winner = game.dealer === "User" ? playerDisplayName() : playerName("ai");
  return `${winner} cut the low card. ${winner} gets the first crib.`;
}

function dealCutReveal(
  card: NonNullable<NonNullable<GameState["cutForDeal"]>["human"]>,
  player: PlayerKey,
  animate: boolean,
): HTMLElement {
  const result = document.createElement("div");
  result.className = `deal-cut-reveal deal-cut-reveal-${player}${animate ? " cut-card-reveal" : " deal-cut-reveal-settled"}`;
  const label = document.createElement("span");
  label.textContent = player === "human" ? "You" : playerName("ai");
  result.append(label, cardElement(card));
  return result;
}

function renderDealCut(game: GameState, revealStage: "cutting" | "human" | "ai" | null = null): void {
  els.plays.innerHTML = "";
  els.plays.hidden = false;
  const row = document.createElement("div");
  row.className = "deal-cut-spread";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Choose where to cut the 52-card deck");
  const humanIndex = state.dealCutIndex ?? Math.floor(DEAL_CUT_CARD_COUNT / 2);
  const aiIndex = state.dealAiCutIndex ?? Math.max(0, humanIndex - 3);
  const showHumanCut = Boolean(game.cutForDeal?.human && (revealStage === "human" || revealStage === "ai"));
  const showAiCut = Boolean(game.cutForDeal?.ai && revealStage === "ai");

  for (let index = 0; index < DEAL_CUT_CARD_COUNT; index += 1) {
    const slot = document.createElement("div");
    slot.className = "deal-cut-choice";
    if (index === state.dealCutIndex) slot.classList.add("deal-cut-choice-selected");
    slot.setAttribute("role", "button");
    slot.setAttribute("aria-label", `Cut at card ${index + 1} of ${DEAL_CUT_CARD_COUNT}`);
    slot.tabIndex = state.pending || revealStage || index !== humanIndex ? -1 : 0;
    const deckCard = cardBack();
    deckCard.classList.add("deal-cut-card");
    deckCard.setAttribute("aria-hidden", "true");
    if (revealStage === "cutting" && index === humanIndex) deckCard.classList.add("deal-cut-card-lift");
    const choose = (): void => {
      if (state.pending || revealStage) return;
      void cutForDeal(index);
    };
    slot.addEventListener("click", choose);
    slot.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const targetIndex = Math.max(0, Math.min(DEAL_CUT_CARD_COUNT - 1, index + direction));
        (row.children.item(targetIndex) as HTMLElement | null)?.focus();
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      choose();
    });
    slot.append(deckCard);
    if (showHumanCut && index === humanIndex && game.cutForDeal?.human) {
      slot.classList.add("deal-cut-choice-revealed");
      slot.append(dealCutReveal(game.cutForDeal.human, "human", revealStage === "human"));
    }
    if (showAiCut && index === aiIndex && game.cutForDeal?.ai) {
      slot.classList.add("deal-cut-choice-revealed");
      slot.append(dealCutReveal(game.cutForDeal.ai, "ai", true));
    }
    row.append(slot);
  }
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
  if (game.phase === "ai_discarding") return `Waiting for ${playerName("ai")} to discard.`;
  if (shouldShowAiThinkingForPegging(game)) return `Waiting for ${playerName("ai")} to play.`;
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

function prepareTurnCardReveal(row: HTMLElement, deck: HTMLElement, card: HTMLElement): void {
  if (!row.isConnected || !deck.isConnected || !card.isConnected) return;
  const deckRect = deck.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const fromX = deckRect.left + (deckRect.width / 2) - (cardRect.left + (cardRect.width / 2));
  const fromY = deckRect.bottom - cardRect.bottom;
  card.style.setProperty("--turn-card-from-x", `${fromX}px`);
  card.style.setProperty("--turn-card-from-y", `${fromY}px`);
  card.style.setProperty("--turn-card-mid-x", `${fromX * 0.28}px`);
  card.style.setProperty("--turn-card-mid-y", `${(fromY * 0.28) - Math.min(18, deckRect.height * 0.12)}px`);
  row.classList.add("turn-card-reveal-ready");
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
  label.textContent = presentGameText(presentation.label);

  const showCutCard = state.turnCutRevealStage === "ai-turn" ||
    state.turnCutRevealStage === "revealed";
  let animatedCutCard: HTMLElement | null = null;
  if (isDiscardMistakeOnTurnCut() && !els.aceMistake.hidden) {
    emptySlot.classList.add("turn-cut-error-slot");
    emptySlot.append(els.aceMistake);
  }
  if (showCutCard && game.turnCard) {
    const cut = document.createElement("div");
    const animateCutCard = shouldAnimateTurnCutCard(game);
    cut.className = `cut-result turn-card-reveal${animateCutCard ? " turn-card-reveal-animated" : ""}`;
    const cutLabel = document.createElement("span");
    cutLabel.textContent = "Cut";
    const card = cardElement(game.turnCard);
    cut.append(cutLabel, card);
    if (animateCutCard) animatedCutCard = card;
    if (state.turnCutRevealStage === "revealed") {
      makeTurnCutControl(cut, presentation.action?.ariaLabel ?? "Continue to pegging");
    }
    cutSlot.append(cut);
  }
  row.append(emptySlot, deck, cutSlot);
  els.plays.append(label, row);
  const cardToAnimate = animatedCutCard;
  if (cardToAnimate) {
    window.requestAnimationFrame(() => prepareTurnCardReveal(row, deck, cardToAnimate));
  }
}

const DEAL_CARD_INTERVAL_MS = 125;
const DEAL_CARD_DURATION_MS = 500;
const SCORING_RACK_LEAVE_MS = 220;
const SCORING_RACK_ENTER_MS = 300;

function tableMotionDisabled(): boolean {
  return state.fontSize === "x-large" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function playScoringStageTransition(action: () => Promise<GameState>): Promise<GameState> {
  const animateOutgoing = Boolean(state.game?.scoring) && shouldAnimateScoringCards(state.fastCounting, tableMotionDisabled());
  if (animateOutgoing) {
    state.scoringTransitionStage = "leaving";
    render(state.game);
    await waitForPaint();
  }

  try {
    const [next] = await Promise.all([
      action(),
      animateOutgoing ? waitMs(SCORING_RACK_LEAVE_MS) : Promise.resolve(),
    ]);
    state.scoringTransitionStage = next.scoring && shouldAnimateScoringCards(state.fastCounting, tableMotionDisabled())
      ? "entering"
      : null;
    render(next);
    if (state.scoringTransitionStage === "entering") {
      await waitForPaint();
      await waitMs(SCORING_RACK_ENTER_MS);
      state.scoringTransitionStage = null;
      render(next);
    }
    return next;
  } catch (error) {
    state.scoringTransitionStage = null;
    throw error;
  }
}

function prepareDealAnimation(shell: HTMLElement, deck: HTMLElement): void {
  if (!shell.isConnected) return;
  const deckRect = deck.getBoundingClientRect();
  const deckX = deckRect.left + (deckRect.width / 2);
  const deckY = deckRect.top + (deckRect.height / 2);
  for (const card of shell.querySelectorAll<HTMLElement>(".deal-animation-card")) {
    const cardRect = card.getBoundingClientRect();
    const fromX = deckX - (cardRect.left + (cardRect.width / 2));
    const fromY = deckY - (cardRect.top + (cardRect.height / 2));
    const owner = card.closest<HTMLElement>(".deal-animation-hand")?.dataset.owner;
    const direction = owner === "ai" ? -1 : 1;
    card.style.setProperty("--deal-from-x", `${fromX}px`);
    card.style.setProperty("--deal-from-y", `${fromY}px`);
    card.style.setProperty("--deal-mid-x", `${(fromX * 0.46) + (direction * 18)}px`);
    card.style.setProperty("--deal-mid-y", `${fromY * 0.46}px`);
    card.style.setProperty("--deal-start-rotation", `${direction * 7}deg`);
    card.style.setProperty("--deal-mid-rotation", `${direction * -2}deg`);
  }
  shell.classList.add("deal-animation-ready");
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
  pone.dataset.owner = state.dealAnimation.pone === "AI" ? "ai" : "human";
  const dealer = document.createElement("div");
  dealer.className = "deal-animation-hand deal-animation-dealer";
  dealer.dataset.owner = state.dealAnimation.dealer === "AI" ? "ai" : "human";
  const poneLabel = document.createElement("span");
  poneLabel.textContent = `${gameParticipantName(state.dealAnimation.pone)} hand`;
  const dealerLabel = document.createElement("span");
  dealerLabel.textContent = `${gameParticipantName(state.dealAnimation.dealer)} hand`;
  pone.append(poneLabel);
  dealer.append(dealerLabel);
  for (let index = 0; index < 6; index += 1) {
    const poneOrder = index * 2;
    const poneCard = cardBack();
    poneCard.classList.add("deal-animation-card");
    poneCard.dataset.dealOrder = String(poneOrder);
    poneCard.style.animationDelay = `${poneOrder * DEAL_CARD_INTERVAL_MS}ms`;
    pone.append(poneCard);
    const dealerOrder = poneOrder + 1;
    const dealerCard = cardBack();
    dealerCard.classList.add("deal-animation-card");
    dealerCard.dataset.dealOrder = String(dealerOrder);
    dealerCard.style.animationDelay = `${dealerOrder * DEAL_CARD_INTERVAL_MS}ms`;
    dealer.append(dealerCard);
  }
  shell.append(pone, dealer);
  els.plays.append(shell);
  window.requestAnimationFrame(() => prepareDealAnimation(shell, deck));
}

interface CardFlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PeggingPlaySource {
  rect: CardFlightRect;
}

function capturePeggingPlaySource(player: PlayerKey, cardId?: number): PeggingPlaySource | null {
  const humanCard = cardId === undefined
    ? null
    : els.humanHand.querySelector<HTMLElement>(`.card[data-id="${cardId}"]`);
  const aiCards = [...els.aiHand.querySelectorAll<HTMLElement>(".card:not(.placeholder)")];
  const element = player === "human" ? humanCard : aiCards.at(-1) ?? null;
  const rect = element?.getBoundingClientRect();
  if (rect?.width && rect.height) {
    return { rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  }
  if (player === "human") return null;

  const anchor = els.aiScorePanel.getBoundingClientRect();
  const sample = els.humanHand.querySelector<HTMLElement>(".card")
    ?? els.plays.querySelector<HTMLElement>(".card");
  const sampleRect = sample?.getBoundingClientRect();
  const width = sampleRect?.width || 76;
  const height = sampleRect?.height || 108;
  return {
    rect: {
      left: anchor.right - width,
      top: anchor.bottom + 10,
      width,
      height,
    },
  };
}

function newlyPlayedCard(
  previous: GameState,
  next: GameState,
  player: PlayerKey,
): GameState["plays"][number] | null {
  if (next.plays.length <= previous.plays.length) return null;
  const card = next.plays.at(-1);
  if (!card || card.owner !== player) return null;
  return card;
}

async function animatePeggingPlay(
  previous: GameState,
  next: GameState,
  player: PlayerKey,
  source: PeggingPlaySource | null,
): Promise<void> {
  const card = newlyPlayedCard(previous, next, player);
  if (!card || !source || tableMotionDisabled()) return;
  const destinations = [...els.plays.querySelectorAll<HTMLElement>(
    `.played-active.pegging-row .card:not(.pegging-overflow-card)[data-id="${card.id}"]`,
  )];
  const destination = destinations.at(-1);
  if (!destination) return;
  const destinationRect = destination.getBoundingClientRect();
  if (!destinationRect.width || !destinationRect.height) return;

  const layer = document.createElement("div");
  layer.className = "pegging-play-flight-layer";
  layer.dataset.player = player;
  layer.setAttribute("aria-hidden", "true");
  const flyingCard = destination.cloneNode(true) as HTMLElement;
  flyingCard.classList.remove("pegging-card-arriving");
  flyingCard.classList.add("pegging-flying-card");
  flyingCard.style.left = `${destinationRect.left}px`;
  flyingCard.style.top = `${destinationRect.top}px`;
  flyingCard.style.width = `${destinationRect.width}px`;
  flyingCard.style.height = `${destinationRect.height}px`;
  layer.append(flyingCard);

  const startX = source.rect.left - destinationRect.left;
  const startY = source.rect.top - destinationRect.top;
  const startScaleX = source.rect.width / destinationRect.width;
  const startScaleY = source.rect.height / destinationRect.height;
  const midScaleX = 1 + ((startScaleX - 1) * 0.42);
  const midScaleY = 1 + ((startScaleY - 1) * 0.42);
  const rotation = player === "ai" ? "4deg" : "-2deg";

  // Paint the flight clone at its source before it enters the document. WAAPI
  // does not apply its first keyframe synchronously in every browser.
  flyingCard.style.opacity = "0.92";
  flyingCard.style.transform = `translate3d(${startX}px, ${startY}px, 0) scale(${startScaleX}, ${startScaleY}) rotate(${rotation})`;
  destination.classList.add("pegging-card-arriving");
  document.body.append(layer);

  try {
    await flyingCard.animate([
      {
        opacity: 0.92,
        transform: `translate3d(${startX}px, ${startY}px, 0) scale(${startScaleX}, ${startScaleY}) rotate(${rotation})`,
      },
      {
        offset: 0.56,
        opacity: 1,
        transform: `translate3d(${startX * 0.42}px, ${(startY * 0.42) - 16}px, 0) scale(${midScaleX}, ${midScaleY}) rotate(${player === "ai" ? "1.5deg" : "-0.8deg"})`,
      },
      {
        opacity: 1,
        transform: "translate3d(0, 0, 0) scale(1) rotate(0deg)",
      },
    ], {
      duration: player === "ai" ? 560 : 480,
      easing: "cubic-bezier(0.22, 0.72, 0.24, 1)",
      fill: "both",
    }).finished.catch(() => undefined);
  } finally {
    destination.classList.remove("pegging-card-arriving");
    layer.remove();
  }
}

function shouldHoldPeggingScoreNotice(
  previous: GameState,
  next: GameState,
  player: PlayerKey,
  source: PeggingPlaySource | null,
): boolean {
  return Boolean(newlyPlayedCard(previous, next, player) && source && !tableMotionDisabled());
}

async function renderPeggingPlayWithMotion(
  previous: GameState,
  next: GameState,
  player: PlayerKey,
  source: PeggingPlaySource | null,
): Promise<void> {
  const holdScoreNotice = shouldHoldPeggingScoreNotice(previous, next, player, source);
  if (holdScoreNotice) state.peggingScoreNoticeHeld = true;
  render(next);
  try {
    await animatePeggingPlay(previous, next, player, source);
  } finally {
    if (holdScoreNotice) {
      state.peggingScoreNoticeHeld = false;
      drainNoticeQueue();
    }
  }
}

interface DiscardFlightSource {
  element: HTMLElement | null;
  rect: CardFlightRect;
  card: HTMLElement;
}

function discardAnimationKey(game: GameState, player: PlayerKey): string {
  const gameId = currentSnapshot?.gameId ?? "game";
  return `${gameId}:${game.handNumber}:discard:${player}`;
}

function discardFlightCard(source: HTMLElement | null): HTMLElement {
  const card = source ? source.cloneNode(true) as HTMLElement : cardBack();
  card.classList.remove("selected", "placeholder", "discard-card-departing");
  card.classList.add("discard-flying-card");
  card.setAttribute("aria-hidden", "true");
  card.removeAttribute("id");
  card.removeAttribute("tabindex");
  if (card instanceof HTMLButtonElement) card.disabled = true;
  return card;
}

function discardFlightSources(player: PlayerKey, cardIds: readonly number[]): DiscardFlightSource[] {
  if (player === "human") {
    return cardIds.flatMap((id) => {
      const element = els.plays.querySelector<HTMLElement>(`.card[data-id="${id}"]`)
        ?? els.humanHand.querySelector<HTMLElement>(`.card[data-id="${id}"]`);
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      return rect.width && rect.height ? [{ element, rect, card: discardFlightCard(element) }] : [];
    });
  }

  const visibleCards = [...els.aiHand.querySelectorAll<HTMLElement>(".card:not(.placeholder)")]
    .filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .slice(-2);
  if (visibleCards.length === 2) {
    return visibleCards.map((element) => ({
      element,
      rect: element.getBoundingClientRect(),
      card: discardFlightCard(element),
    }));
  }

  const sample = els.humanHand.querySelector<HTMLElement>(".card")
    ?? els.plays.querySelector<HTMLElement>(".card");
  const sampleRect = sample?.getBoundingClientRect();
  const width = sampleRect?.width || 76;
  const height = sampleRect?.height || 108;
  const anchor = els.aiName.getBoundingClientRect();
  return [0, 1].map((index) => ({
    element: null,
    rect: {
      left: anchor.left + (anchor.width / 2) - (width / 2) + (index * 10) - 5,
      top: anchor.bottom + 8 + (index * 3),
      width,
      height,
    },
    card: discardFlightCard(null),
  }));
}

function cribFlightDestination(): { x: number; y: number } {
  const stackRect = els.cribTrayStack.getBoundingClientRect();
  if (!els.cribTray.hidden && stackRect.width > 0 && stackRect.height > 0) {
    return {
      x: stackRect.left + (stackRect.width / 2),
      y: stackRect.top + (stackRect.height / 2),
    };
  }
  const tableRect = els.table.getBoundingClientRect();
  const humanOwnsCrib = state.game?.cribOwner === "User";
  return {
    x: tableRect.right - 18 - (tableRect.width > 520 ? 41 : 34),
    y: humanOwnsCrib ? tableRect.bottom - 92 : tableRect.top + 74,
  };
}

function cribTrayFill(game: GameState): "empty" | "partial" | "full" {
  const animatedDiscards = (["human", "ai"] as const)
    .filter((player) => state.animatedDiscardKeys.has(discardAnimationKey(game, player)))
    .length;
  if (animatedDiscards >= 2) return "full";
  if (animatedDiscards === 1) return "partial";
  if (game.phase === "ai_discarding") return "partial";
  if (game.phase === "pegging" || game.phase === "pegging_complete") return "full";
  return "empty";
}

function usesMobileGameplayLayout(): boolean {
  return window.innerWidth <= 640;
}

function mobileGameplayHeaderActive(): boolean {
  return usesMobileGameplayLayout() &&
    els.app.dataset.view === "game" &&
    els.pathwayPage.hidden &&
    els.splashPage.hidden &&
    els.authPage.hidden &&
    els.peopleProfilePage.hidden &&
    els.humanTablePage.hidden;
}

function clearMobileGameplayHeaderHideTimer(): void {
  if (mobileGameplayHeaderHideTimer === null) return;
  window.clearTimeout(mobileGameplayHeaderHideTimer);
  mobileGameplayHeaderHideTimer = null;
}

function hideMobileGameplayHeader(): void {
  clearMobileGameplayHeaderHideTimer();
  if (!mobileGameplayHeaderActive() || !els.peoplePresencePanel.hidden) return;
  if (els.topbar.contains(document.activeElement)) return;
  els.topbar.classList.add("mobile-game-header-hidden");
}

function scheduleMobileGameplayHeaderHide(delay = 2800): void {
  clearMobileGameplayHeaderHideTimer();
  if (!mobileGameplayHeaderActive() || !els.peoplePresencePanel.hidden) return;
  mobileGameplayHeaderHideTimer = window.setTimeout(hideMobileGameplayHeader, delay);
}

function showMobileGameplayHeader(autoHide = true): void {
  if (!mobileGameplayHeaderActive()) return;
  els.topbar.classList.remove("mobile-game-header-hidden");
  if (autoHide) scheduleMobileGameplayHeaderHide();
  else clearMobileGameplayHeaderHideTimer();
}

function syncMobileGameplayHeaderPlacement(): void {
  const active = mobileGameplayHeaderActive();
  const pathwayHeaderActive = !els.pathwayPage.hidden;
  const utilityHeaderActive = state.analyticsOpen || state.leaderboardOpen || state.modelInfoOpen || state.decisionReviewOpen;
  document.body.classList.toggle("mobile-game-header-active", active);
  if (active || utilityHeaderActive) {
    if (els.peoplePresence.parentElement !== els.topbar) els.topbar.append(els.peoplePresence);
    if (active && !mobileGameplayHeaderWasActive) showMobileGameplayHeader();
  } else if (pathwayHeaderActive) {
    clearMobileGameplayHeaderHideTimer();
    els.topbar.classList.remove("mobile-game-header-hidden");
    if (els.peoplePresence.parentElement !== els.pathwayBrandbar) {
      els.pathwayBrandbar.append(els.peoplePresence);
    }
  } else {
    clearMobileGameplayHeaderHideTimer();
    els.topbar.classList.remove("mobile-game-header-hidden");
    if (els.peoplePresence.parentElement !== document.body) {
      document.body.insertBefore(els.peoplePresence, els.pathwayPage);
    }
  }
  mobileGameplayHeaderWasActive = active;
}

function syncGameplayArtifactPlacement(game: GameState): void {
  const cribParent = usesMobileGameplayLayout()
    ? game.cribOwner === "User" ? els.humanScorePanel : els.aiScorePanel
    : els.table;
  const cutParent = usesMobileGameplayLayout() ? els.scoreboard : els.played;
  const hintParent = usesMobileGameplayLayout() ? els.aceTools : els.actions;
  const mistakeParent = isDiscardMistakeOnTurnCut()
    ? els.plays
    : usesMobileGameplayLayout() ? els.aceTools : els.scoreCut;
  if (els.cribTray.parentElement !== cribParent) cribParent.append(els.cribTray);
  if (els.scoreCut.parentElement !== cutParent) cutParent.append(els.scoreCut);
  if (els.askMaster.parentElement !== hintParent) hintParent.append(els.askMaster);
  if (els.aceMistake.parentElement !== mistakeParent) mistakeParent.append(els.aceMistake);
}

function renderCribTray(game: GameState): void {
  const visible = game.phase === "discard" ||
    game.phase === "ai_discarding" ||
    game.phase === "pegging" ||
    game.phase === "pegging_complete";
  els.cribTray.hidden = !visible;
  if (!visible) return;
  const owner: PlayerKey = game.cribOwner === "User" ? "human" : "ai";
  els.cribTray.dataset.owner = owner;
  els.cribTray.dataset.fill = cribTrayFill(game);
  els.cribTrayLabel.textContent = usesMobileGameplayLayout() ? "Crib" : `${playerPossessive(owner)} crib`;
  els.cribTray.setAttribute("aria-label", `${playerPossessive(owner)} crib`);
}

async function playDiscardToCribAnimation(
  game: GameState | null,
  player: PlayerKey,
  cardIds: readonly number[] = [],
): Promise<void> {
  if (!game) return;
  const key = discardAnimationKey(game, player);
  if (state.animatedDiscardKeys.has(key)) return;
  state.animatedDiscardKeys.add(key);
  if (tableMotionDisabled()) return;
  const sources = discardFlightSources(player, cardIds);
  if (sources.length !== 2) return;

  const destination = cribFlightDestination();
  const layer = document.createElement("div");
  layer.className = "discard-flight-layer";
  layer.dataset.player = player;
  layer.setAttribute("aria-hidden", "true");
  els.cribTray.classList.add("crib-tray-receiving");

  for (const source of sources) {
    source.element?.classList.add("discard-card-departing");
    source.card.style.left = `${source.rect.left}px`;
    source.card.style.top = `${source.rect.top}px`;
    source.card.style.width = `${source.rect.width}px`;
    source.card.style.height = `${source.rect.height}px`;
    layer.append(source.card);
  }
  document.body.append(layer);

  const flights = sources.map((source, index) => {
    const startX = source.rect.left + (source.rect.width / 2);
    const startY = source.rect.top + (source.rect.height / 2);
    const dx = destination.x - startX + (index * 7) - 3.5;
    const dy = destination.y - startY + (index * 4);
    const midX = dx * 0.46;
    const midY = (dy * 0.46) - 34;
    return source.card.animate([
      { opacity: 1, transform: "translate3d(0, 0, 0) scale(1) rotate(0deg)" },
      { offset: 0.5, opacity: 1, transform: `translate3d(${midX}px, ${midY}px, 0) scale(1.02) rotate(${index ? 5 : -5}deg)` },
      { opacity: 0.96, transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.96) rotate(${index ? 4 : -4}deg)` },
    ], {
      duration: 720,
      delay: index * 130,
      easing: "cubic-bezier(0.22, 0.72, 0.24, 1)",
      fill: "forwards",
    }).finished.catch(() => undefined);
  });

  await Promise.all(flights);
  await waitMs(100);
  els.cribTray.dataset.fill = player === "ai" ? "full" : "partial";
  els.cribTray.classList.remove("crib-tray-receiving");
  layer.remove();
  for (const source of sources) source.element?.classList.remove("discard-card-departing");
}

function renderCutCard(card: GameState["turnCard"]): void {
  els.turnCard.innerHTML = "";
  els.turnCard.className = "cut-card";
  els.scoreCut.hidden = !card;
  els.turnCard.hidden = !card;
  if (card) els.turnCard.append(cardElement(card));
}

function isDiscardMistakeOnTurnCut(): boolean {
  return Boolean(state.turnCutRevealStage && state.aceMistake?.advice.kind === "discard");
}

function renderAceMistakeBadge(game: GameState): void {
  if (state.aceMistake && state.aceMistake.handNumber !== game.handNumber) state.aceMistake = null;
  const opponent = currentSnapshot?.opponent ?? selectedMenuOpponent();
  const visible = Boolean(
    state.errorNoticesEnabled &&
    state.aceMistake &&
    state.masterHint?.mode !== "mistake" &&
    lowerLevelOpponent(opponent) &&
    (
      isDiscardMistakeOnTurnCut() ||
      (
        game.turnCardRevealed &&
        game.turnCard &&
        (game.phase === "pegging" || game.phase === "pegging_complete")
      )
    ),
  );
  els.aceMistake.hidden = !visible;
}

function selectedPlayableCard(game: GameState): GameState["humanHand"][number] | undefined {
  return game.humanHand.find((card) => state.selected.has(card.id) && game.legalCardIds.includes(card.id));
}

function renderScoring(scoring: GameState["scoring"]): void {
  els.scoringReview.hidden = !scoring;
  if (!scoring) {
    delete els.scoringReview.dataset.owner;
    delete els.scoringReview.dataset.transition;
    els.scoringCards.innerHTML = "";
    return;
  }
  els.scoringReview.dataset.owner = scoring.owner === "AI" ? "ai" : "human";
  if (state.scoringTransitionStage) {
    els.scoringReview.dataset.transition = state.scoringTransitionStage;
  } else {
    delete els.scoringReview.dataset.transition;
  }
  const owner: PlayerKey = scoring.owner === "AI" ? "ai" : "human";
  els.scoringTitle.textContent = scoringTitle(
    playerName(owner),
    scoring.stage === "crib" ? "crib" : "hand",
  );
  renderCards(els.scoringCards, scoring.cards);
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
    els.resultInline.innerHTML = "";
    return;
  }
  if (state.scoringTransitionStage === "entering") {
    state.noticeResultLines = [];
    els.resultInline.innerHTML = "";
    return;
  }
  const notices = newScoreNotices(game);
  const goNotice = newOpponentGoNotice(game);
  if (goNotice) notices.push(goNotice);
  ensureCurrentScoreSummary(game);
  enqueueNotices(notices);
  maybeOpenScoreSummary();
  state.noticeResultLines = [];
  els.resultInline.innerHTML = "";
}

function scoreSummaryNextLabel(game: GameState): string {
  const scoring = game.scoring;
  if (!scoring) return "Next";
  if (scoring.nextLabel === "View game result") return "View Game Result";
  const dealer = game.dealer === "User" ? "human" : "ai";
  if (scoring.stage === "pone") return `${playerPossessive(dealer)} Hand Next`;
  if (scoring.stage === "dealer") return `${playerPossessive(dealer)} Crib Next`;
  return "Next Hand";
}

function scoreSummaryForEvent(event: ScoreEvent, game: GameState): ScoreSummary | null {
  if (event.category !== "hand" && event.category !== "crib") return null;
  const player = event.player === "human" ? "human" : "ai";
  const items = handScoreNoticeParts(event, game.scoring?.cards, game.turnCard) ?? (event.points === 0
    ? [{ label: "No scoring combinations", points: 0 }]
    : [{ label: event.category === "crib" ? "Crib" : "Hand", points: event.points }]);
  return {
    key: event.id,
    category: event.category,
    title: `${playerPossessive(player)} ${event.category}`,
    points: scoreSummaryPoints(event),
    items,
    nextLabel: scoreSummaryNextLabel(game),
  };
}

function ensureCurrentScoreSummary(game: GameState): void {
  if (!game.scoring || state.pending) return;
  const event = currentScoringScoreEvent(scoreNoticeGameId(game), game);
  if (!event) return;
  if (state.activeScoreSummary?.key === event.id) return;
  if (state.scoreSummaryQueue.some((summary) => summary.key === event.id)) return;
  const summary = scoreSummaryForEvent(event, game);
  if (summary) state.scoreSummaryQueue.push(summary);
}

function newOpponentGoNotice(game: GameState): GameNotice | null {
  const event = opponentGoEvent(game);
  if (!event) return null;
  const key = `go:${event.id}`;
  if (state.announcedGoNoticeKeys.has(key)) return null;
  state.announcedGoNoticeKeys.add(key);
  return {
    key,
    kind: "go",
    text: `${playerName("ai")} says Go. Your play.`,
    label: `${playerName("ai")} says`,
    callout: "GO",
    player: "human",
    playerText: "Your play",
    anchor: "play",
    emphasizedCardIds: [],
  };
}

function gameEntryOpponentName(): string {
  if (activeHumanTable) {
    return activeHumanTable.viewerSeat === "challenger"
      ? activeHumanTable.challenged.displayName
      : activeHumanTable.challenger.displayName;
  }
  return engineName(currentSnapshot?.opponent ?? els.opponent.value);
}

function announceGameEntry(game: GameState): void {
  clearNoticeQueue();
  const opponent = gameEntryOpponentName();
  enqueueNotices([{
    key: `playing:${currentSnapshot?.gameId ?? game.handNumber}`,
    kind: "start",
    text: `Playing ${opponent}.`,
    label: "Playing",
    callout: opponent,
    player: "ai",
    playerText: "Game started",
    anchor: "play",
    emphasizedCardIds: [],
  }]);
}

function newScoreNotices(game: GameState): GameNotice[] {
  const gameId = scoreNoticeGameId(game);
  const events = scoreEventsForGame(gameId, game.analyticsEvents);
  const notices: GameNotice[] = [];
  for (const event of collectNewScoreEvents(state.scoreNoticeCursor, gameId, game.analyticsEvents)) {
    if (!shouldAnnounceScoreEvent(event, events)) continue;
    const summary = scoreSummaryForEvent(event, game);
    if (summary) state.scoreSummaryQueue.push(summary);
    if (!shouldShowScoreBubble(state.fastCounting, event.category)) continue;
    const player = event.player === "human" ? playerDisplayName() : playerName("ai");
    const parts = handScoreNoticeParts(event, game.scoring?.cards, game.turnCard)
      ?? peggingScoreNoticeParts(event)
      ?? [{ label: scoreNoticeLabel(event), points: event.points }];
    for (const [index, part] of parts.entries()) {
      const pointLabel = part.points === 1 ? "point" : "points";
      notices.push({
        key: `score:${event.id}:${index}`,
        kind: "score",
        text: `${part.label}. ${player} scores ${part.points} ${pointLabel}.`,
        label: part.label,
        points: part.points,
        player: event.player,
        anchor: event.reason === "Heels" ? "cut" : event.category === "pegging" ? "play" : "scoring",
        emphasizedCardIds: scoreNoticeEmphasisCardIds(
          event,
          part,
          game.scoring?.cards,
          game.turnCard,
        ),
      });
    }
  }
  return notices;
}

function scoreNoticeGameId(game: GameState): string | null {
  if (currentSnapshot?.gameId) return currentSnapshot.gameId;
  for (let index = game.analyticsEvents.length - 1; index >= 0; index -= 1) {
    const gameId = game.analyticsEvents[index]?.gameId;
    if (gameId) return gameId;
  }
  return null;
}

function gameForScoreboard(game: GameState): GameState {
  const event = currentScoringScoreEvent(scoreNoticeGameId(game), game);
  const display = scoreboardStateForScoringConfirmation(
    game,
    event,
    state.confirmedScoreSummaryKey,
  );
  if (display.scores === game.scores) return game;
  return { ...game, ...display };
}

function scoreNoticeLabel(event: ScoreEvent): string {
  if (event.reason === "Heels") return "Heels";
  if (event.reason === "Go") return "Go point";
  if (event.category === "hand") return "Hand";
  if (event.category === "crib") return "Crib";
  if (event.count === 15) return "Fifteen";
  if (event.count === 31) return "Thirty-one";
  return "Pegging";
}

function clearNoticeQueue(): void {
  state.noticeQueue = [];
  if (state.noticeTimer !== null) {
    window.clearTimeout(state.noticeTimer);
    state.noticeTimer = null;
  }
  state.activeNotice = null;
  els.result.innerHTML = "";
  clearScoringCardEmphasis();
}

function enqueueNotices(notices: GameNotice[]): void {
  if (!notices.length) return;
  state.noticeQueue.push(...notices);
  drainNoticeQueue();
}

function drainNoticeQueue(): void {
  if (state.noticeTimer !== null || state.peggingScoreNoticeHeld) return;
  const notice = state.noticeQueue.shift();
  if (!notice) {
    maybeOpenScoreSummary();
    return;
  }
  state.activeNotice = notice;
  showNoticeBubble(notice);
  state.noticeTimer = window.setTimeout(() => {
    state.noticeTimer = null;
    state.activeNotice = null;
    els.result.innerHTML = "";
    clearScoringCardEmphasis();
    drainNoticeQueue();
  }, NOTICE_VISIBLE_MS);
}

function renderScoreSummaryDialog(): void {
  const summary = state.activeScoreSummary;
  els.scoreSummaryDialog.hidden = !summary;
  if (!summary) {
    els.scoreSummaryItems.innerHTML = "";
    return;
  }
  els.skipCounting.hidden = true;
  els.scoreSummaryEyebrow.textContent = summary.category === "crib" ? "Crib counted" : "Hand counted";
  els.scoreSummaryTitle.textContent = summary.title;
  els.scoringPoints.textContent = `${summary.points} point${summary.points === 1 ? "" : "s"}`;
  els.scoreSummaryItems.innerHTML = "";
  for (const item of summary.items) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = item.label;
    const points = document.createElement("strong");
    points.textContent = item.points > 0 ? `+${item.points}` : "0";
    row.append(label, points);
    els.scoreSummaryItems.append(row);
  }
  els.continueScoring.textContent = summary.nextLabel;
  els.continueScoring.disabled = state.pending;
}

function maybeOpenScoreSummary(): void {
  if (state.activeScoreSummary || state.noticeTimer !== null || state.noticeQueue.length) return;
  const next = state.scoreSummaryQueue.shift();
  if (!next) return;
  state.activeScoreSummary = next;
  renderScoreSummaryDialog();
  window.requestAnimationFrame(() => els.continueScoring.focus({ preventScroll: true }));
}

function showNoticeBubble(notice: GameNotice): void {
  els.result.innerHTML = "";
  const bubble = document.createElement("div");
  bubble.className = `game-notification game-notification-score${notice.kind === "go" ? " game-notification-go" : notice.kind === "start" ? " game-notification-start" : ""}`;
  bubble.dataset.noticeKey = notice.key;
  bubble.setAttribute("aria-label", notice.text);
  bubble.dataset.player = notice.player;
  bubble.dataset.cardEmphasis = notice.emphasizedCardIds.length ? "true" : "false";
  const label = document.createElement("span");
  label.className = "game-notification-label";
  label.textContent = notice.label;
  const points = document.createElement("strong");
  points.className = "game-notification-points";
  points.textContent = notice.kind === "score" ? `+${notice.points}` : notice.callout;
  const player = document.createElement("span");
  player.className = "game-notification-player";
  player.textContent = notice.kind === "score" ? playerName(notice.player) : notice.playerText;
  label.setAttribute("aria-hidden", "true");
  points.setAttribute("aria-hidden", "true");
  player.setAttribute("aria-hidden", "true");
  bubble.append(label, points, player);
  els.result.append(bubble);
  positionNoticeBubble(bubble, notice);
  window.requestAnimationFrame(() => {
    if (bubble.isConnected) positionNoticeBubble(bubble, notice);
  });
  renderScoringCardEmphasis();
}

function clearScoringCardEmphasis(): void {
  for (const card of document.querySelectorAll<HTMLElement>(".score-card-lift")) {
    card.classList.remove("score-card-lift");
  }
}

function renderScoringCardEmphasis(): void {
  clearScoringCardEmphasis();
  if (state.fastCounting) return;
  const notice = state.activeNotice;
  if (!notice?.emphasizedCardIds.length) return;
  void els.scoringCards.offsetWidth;
  notice.emphasizedCardIds.forEach((id) => {
    const selector = `.card[data-id="${id}"]`;
    const card = els.scoringCards.querySelector<HTMLElement>(selector)
      ?? els.turnCard.querySelector<HTMLElement>(selector);
    if (!card) return;
    card.classList.add("score-card-lift");
  });
}

function positionNoticeBubble(bubble: HTMLElement, notice: GameNotice): void {
  const layerRect = els.result.getBoundingClientRect();
  let anchor: Element | null = null;
  if (notice.anchor === "scoring") anchor = els.scoringCards.querySelector(".card:last-child");
  else if (notice.anchor === "cut") anchor = els.turnCard.querySelector(".card");
  else if (notice.anchor === "play") anchor = els.plays.querySelector(".played-active .card:last-child");
  const anchorRect = anchor?.getBoundingClientRect();
  const edgeInset = Math.min(90, layerRect.width * 0.28);
  const rawX = anchorRect ? anchorRect.left - layerRect.left + (anchorRect.width / 2) : layerRect.width / 2;
  const rawY = anchorRect ? anchorRect.top - layerRect.top + (anchorRect.height * 0.36) : layerRect.height * 0.46;
  const x = Math.max(edgeInset, Math.min(layerRect.width - edgeInset, rawX));
  const y = Math.max(78, Math.min(layerRect.height - 88, rawY));
  bubble.style.setProperty("--notice-x", `${x}px`);
  bubble.style.setProperty("--notice-y", `${y}px`);
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
    if (activeHumanTable) {
      hideHumanTable();
      navigatePathway("human");
      return;
    }
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
  report.human.helps = helpCountForGame(events, end.gameId);
  const title = document.createElement("h2");
  title.textContent = titleText;
  const summary = document.createElement("p");
  const start = gameStartFor(events, end.gameId);
  const opponent = engineName(start?.opponent);
  const finalScores = end.finalScores ?? fallbackScores;
  const result = end.result && end.result !== "regular" ? `, ${end.result}` : "";
  summary.textContent = `${shortDate(end.at)} vs ${opponent}. ${playerName(end.winner ?? "human", start?.opponent)} won ${finalScores.human}-${finalScores.ai}${result}.`;
  container.append(
    title,
    summary,
    singleGameReportTable(report, { includeAceHelps: isAceAdviceOpponent(start?.opponent) }),
    singleGameDecisionReview(events, end),
  );
}

function singleGameDecisionReview(events: AnalyticsEvent[], end: GameEndEvent): HTMLElement {
  const section = document.createElement("section");
  section.className = "decision-review";
  const start = gameStartFor(events, end.gameId);
  const humanMatch = start?.opponent === "human";
  const reviewPlayer = humanMatch ? humanDecisionReviewPlayer : "human";
  const reviewName = gameReportPlayerName(start, reviewPlayer);
  const title = document.createElement("h3");
  title.textContent = humanMatch ? `${reviewName}'s errors` : "Decision review";
  section.append(title);

  if (humanMatch) {
    const tabs = document.createElement("div");
    tabs.className = "decision-review-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Player errors");
    for (const player of ["human", "ai"] as const) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "decision-review-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(reviewPlayer === player));
      tab.textContent = gameReportPlayerName(start, player);
      tab.addEventListener("click", () => {
        humanDecisionReviewPlayer = player;
        render(state.game);
      });
      tabs.append(tab);
    }
    section.append(tabs);
  }

  const mistakes = sortedDecisionMistakes(events, end.gameId, reviewPlayer);
  const pending = pendingDecisionReviews(events, end.gameId, reviewPlayer);
  const reviewed = reviewedUserDecisions(events, end.gameId, reviewPlayer);

  if (pending.length) {
    const pendingNotice = document.createElement("div");
    pendingNotice.className = "decision-review-pending";
    const pendingBody = document.createElement("div");
    pendingBody.className = "decision-review-pending-body";
    const pendingText = document.createElement("span");
    pendingText.textContent = `${pending.length} ${reviewName} decision${pending.length === 1 ? "" : "s"} still need${pending.length === 1 ? "s" : ""} ${DECISION_REVIEWER_NAME} analysis.`;
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
    const analyze = document.createElement("button");
    analyze.type = "button";
    analyze.className = "decision-review-analyze";
    analyze.textContent = state.completingReviews ? "Analyzing" : `Analyze with ${DECISION_REVIEWER_NAME}`;
    analyze.disabled = state.completingReviews || state.pending;
    analyze.addEventListener("click", () => {
      void analyzeGameDecisionReviews(end.gameId);
    });
    pendingNotice.append(analyze);
    section.append(pendingNotice);
    if (!reviewed.length) return section;
  }

  const model = document.createElement("p");
  model.textContent = pending.length
    ? `Completed decisions are compared with ${DECISION_REVIEWER_NAME} decision analysis. Win probability is primary; point EV is supporting context.`
    : `Compared with ${DECISION_REVIEWER_NAME} decision analysis. Win probability is primary; point EV is supporting context.`;
  const totals = decisionEvTotals(mistakes);
  section.append(model, decisionEvSummary(totals), decisionWinProbabilityImpact(totals));

  if (!mistakes.length) {
    const empty = document.createElement("div");
    empty.className = "decision-review-empty";
    empty.textContent = `No ${reviewName} discards or peg plays were flagged by ${DECISION_REVIEWER_NAME} analysis.`;
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
    detail.textContent = decisionReviewText(event, reviewName);
    toggle.append(label, detail);
    const camera = document.createElement("button");
    camera.type = "button";
    camera.className = "decision-camera";
    camera.setAttribute("aria-label", `Show table for hand ${event.handNumber} ${event.type} error`);
    const context = decisionContext(event, events, reviewName);
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

function pendingDecisionReviews(
  events: AnalyticsEvent[],
  gameId: string,
  player: PlayerKey = "human",
): Array<DiscardEvent | PeggingEvent> {
  return events.filter((event): event is DiscardEvent | PeggingEvent =>
    event.gameId === gameId &&
    ((event.type === "discard" && event.player === player) ||
      (event.type === "pegging" && event.action === "play" && event.player === player)) &&
    !event.review,
  );
}

function decisionMistakes(
  events: AnalyticsEvent[],
  gameId: string,
  player: PlayerKey = "human",
): DecisionReviewEvent[] {
  return events.filter((event): event is DecisionReviewEvent => {
    if (
      event.gameId !== gameId ||
      !((event.type === "discard" && event.player === player) ||
        (event.type === "pegging" && event.action === "play" && event.player === player)) ||
      !event.review
    ) {
      return false;
    }
    const reviewedEvent = event as DecisionReviewEvent;
    return !sameCards(reviewedEvent.review.selected, reviewedEvent.review.recommended) &&
      decisionMistakeMagnitude(reviewedEvent) >= decisionMistakeThreshold(reviewedEvent);
  });
}

function reviewedUserDecisions(
  events: AnalyticsEvent[],
  gameId: string,
  player: PlayerKey = "human",
): DecisionReviewEvent[] {
  return events.filter((event): event is DecisionReviewEvent =>
    event.gameId === gameId &&
    ((event.type === "discard" && event.player === player) ||
      (event.type === "pegging" && event.action === "play" && event.player === player)) &&
    Boolean(event.review)
  );
}

function decisionAnalysisForGame(events: AnalyticsEvent[], gameId: string): { analyzed: boolean; errors: number } {
  const progress = gameAnalysisProgress(events, gameId);
  return {
    analyzed: progress.complete,
    errors: decisionMistakes(events, gameId).length,
  };
}

function sortedDecisionMistakes(
  events: AnalyticsEvent[],
  gameId: string,
  player: PlayerKey = "human",
): DecisionReviewEvent[] {
  return decisionMistakes(events, gameId, player).sort((left, right) =>
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
  title.textContent = `${playerDisplayName()} decision loss`;
  const note = document.createElement("em");
  note.textContent = `Point EV, with errors identified by ${playerName("ai")} win-probability impact.`;
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

function decisionContext(
  event: DecisionReviewEvent,
  events: AnalyticsEvent[],
  reviewName = playerDisplayName(),
): HTMLElement {
  const detail = document.createElement("div");
  detail.className = "decision-context";
  const rows: Array<[string, string]> = [];
  const gameStart = gameStartFor(events, event.gameId);
  const ownName = gameReportPlayerName(gameStart, "human");
  const opponentName = gameReportPlayerName(gameStart, "ai");
  const possessive = reviewName.endsWith("s") ? `${reviewName}'` : `${reviewName}'s`;
  const handStart = handStartFor(events, event.gameId, event.handNumber);
  const score = "scores" in event && event.scores
    ? event.scores
    : event.type === "pegging" && event.scoresBefore
      ? event.scoresBefore
      : handStart?.scores;
  if (score) rows.push(["Score", `${ownName} ${score.human}, ${opponentName} ${score.ai}`]);
  const firstDealer = firstDealerForGame(events, event.gameId);
  if (score && firstDealer) {
    const components = event.type === "pegging" ? 2 : 0;
    rows.push([`${ownName} par`, parStatusText("human", score.human, firstDealer, event.handNumber, components)]);
    rows.push([`${opponentName} par`, parStatusText("ai", score.ai, firstDealer, event.handNumber, components)]);
  }
  rows.push(["Hand", String(event.handNumber)]);
  if (handStart) {
    rows.push(["Dealer", playerName(handStart.dealer)]);
    rows.push(["Pone", playerName(handStart.pone)]);
    if (handStart.turnCard) rows.push(["Cut", event.type === "discard" ? "Not yet shown" : handStart.turnCard]);
  }
  if (event.type === "discard") {
    rows.push([`${possessive} hand`, (event.handBeforeDiscard ?? [...event.remainingHand, ...event.cards]).join(" ")]);
    rows.push([`${reviewName} discarded`, event.review.selected.join(" ")]);
    rows.push([`${DECISION_REVIEWER_NAME} advised`, event.review.recommended.join(" ")]);
    rows.push(["Kept", event.remainingHand.join(" ")]);
    rows.push(["Crib after discard", event.cribAfterDiscard.join(" ") || "None"]);
  } else {
    if (event.cutCard) rows.push(["Cut", event.cutCard]);
    if (event.hand?.length) rows.push([`${possessive} hand`, event.hand.join(" ")]);
    if (event.completedPlayGroups?.length) {
      rows.push(["Prior counts", event.completedPlayGroups.map((group) => group.join(" ")).join(" / ")]);
    }
    rows.push(["Current count before play", String(event.countBefore ?? Math.max(0, event.count - cardValueFromLabel(event.card)))]);
    rows.push(["Already played", event.playedCards?.join(" ") || "None"]);
    rows.push([`${reviewName} played`, event.review.selected.join(" ")]);
    rows.push([`${DECISION_REVIEWER_NAME} advised`, event.review.recommended.join(" ")]);
  }
  rows.push([`${possessive} point EV`, formatEvPoints(event.review.selectedEv)]);
  rows.push(["Advised point EV", formatEvPoints(event.review.recommendedEv)]);
  rows.push(["Point EV impact", formatEvPoints(-Math.max(0, event.review.delta))]);
  if (event.review.selectedWinProbability !== undefined && event.review.recommendedWinProbability !== undefined) {
    rows.push([`${possessive} win probability`, formatWinProbability(event.review.selectedWinProbability)]);
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
    (candidate.type === "discard" ||
      (candidate.type === "pegging" && candidate.action === "play")) &&
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
  const gameStart = gameStartFor(events, event.gameId);
  const actor = event.player ?? "human";
  const actorName = gameReportPlayerName(gameStart, actor);
  const score = "scores" in event && event.scores
    ? event.scores
    : event.type === "pegging" && event.scoresBefore
      ? event.scoresBefore
      : handStart?.scores ?? { human: 0, ai: 0 };
  const dealer = handStart?.dealer ?? (event.role === "dealer" ? actor : actor === "human" ? "ai" : "human");
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
    snapshotStatus("Turn", actorName),
  );
  table.append(status);

  if (event.type === "discard") {
    table.append(
      snapshotDiscardSection(
        event.cribOwner === "human"
          ? `Select two cards to discard to ${playerPossessive("human")} crib`
          : `Select two cards to discard to ${playerPossessive("ai")} crib`,
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
  root.append(snapshotDecisionSummary(event, actorName));
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
    const identity = document.createElement("span");
    if (player === "human") setPlayerIdentity(identity, playerName(player));
    else identity.textContent = playerName(player);
    if (dealer === player) {
      const badge = document.createElement("span");
      badge.className = "dealer-button";
      badge.textContent = "Crib";
      if (player === "human") name.append(badge, " ", identity);
      else name.append(identity, " ", badge);
    } else {
      name.append(identity);
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
  if (normalizedPlayerDisplayName(value) === normalizedPlayerDisplayName(playerDisplayName())) {
    setPlayerIdentity(strong, value);
  } else {
    strong.textContent = value;
  }
  item.append(`${label}: `, strong);
  return item;
}

function snapshotDecisionSummary(event: DecisionReviewEvent, actorName = playerDisplayName()): HTMLElement {
  const summary = document.createElement("div");
  summary.className = "snapshot-decision-summary";
  const yourMove = document.createElement("div");
  const advisedMove = document.createElement("div");
  const selectedLabel = event.type === "discard" ? `${actorName} discarded` : `${actorName} played`;
  const advisedLabel = event.type === "discard"
    ? `${DECISION_REVIEWER_NAME} advised discarding`
    : `${DECISION_REVIEWER_NAME} advised playing`;
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
    message: `Waiting for ${playerName("ai")} to discard.`,
    result: [...game.result, `${playerDisplayName()} discarded two cards to the crib.`, `Waiting for ${playerName("ai")} to discard.`],
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

function gameReportPlayerName(
  start: Extract<AnalyticsEvent, { type: "game" }> | undefined,
  player: PlayerKey,
): string {
  return start?.players?.[player] ?? playerName(player, start?.opponent);
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

function decisionReviewText(event: DecisionReviewEvent, reviewName = playerDisplayName()): string {
  const review = event.review;
  const pointEv = `${reviewName} EV ${formatEvPoints(review.selectedEv)}, advised EV ${formatEvPoints(review.recommendedEv)}`;
  const delta = review.winProbabilityDelta !== undefined
    ? `; win% impact ${formatPercentagePointDelta(decisionErrorWinProbabilityImpact(event))}; ${pointEv}`
    : review.delta !== 0
      ? `; point EV impact ${formatEv(-Math.max(0, review.delta))}`
      : "";
  if (event.type === "discard") {
    return `${reviewName} discarded ${review.selected.join(" ")}; ${DECISION_REVIEWER_NAME} advised ${review.recommended.join(" ")}${delta}.`;
  }
  return `${reviewName} played ${review.selected.join(" ")}; ${DECISION_REVIEWER_NAME} advised ${review.recommended.join(" ")}${delta}.`;
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
  const personalStats = state.analyticsMode === "my";
  els.statsViewTabs.hidden = !personalStats;
  els.myStatsOpponentTabs.hidden = !personalStats || state.statsView !== "stats";
  els.statsGameLog.hidden = !personalStats || state.statsView !== "game-log";
  els.analyticsTotals.hidden = personalStats && state.statsView !== "stats";
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

  if (personalStats && state.statsView === "game-log") {
    renderStatsViewTabs();
    renderGameLog();
    return;
  }

  if (personalStats) {
    renderStatsViewTabs();
    renderMyStats(events);
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

function renderStatsViewTabs(): void {
  for (const button of els.statsViewTabButtons) {
    const selected = button.dataset.statsView === state.statsView;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

function renderMyStats(events: AnalyticsEvent[]): void {
  renderMyStatsOpponentTabs();
  const opponentLabel = MY_STATS_OPPONENT_LABEL[state.myStatsOpponent];
  const scopedEvents = analyticsForStatsOpponent(events, state.myStatsOpponent);
  const scopedScoreEvents = scopedEvents.filter((event): event is ScoreEvent => event.type === "score");
  const scopedGameEvents = scopedEvents.filter((event): event is Extract<AnalyticsEvent, { type: "game" }> =>
    event.type === "game"
  );
  const completedGames = scopedGameEvents.filter((event) => event.action === "end").length;
  const localTotals = playerAnalyticsTotals(scopedEvents, scopedScoreEvents, scopedGameEvents);
  const lifetime = mergedLifetimeResults(
    playerDisplayName(),
    state.leaderboardSummary.playerStatsByOpponent?.[state.myStatsOpponent] ?? [],
    localTotals,
  );
  if (!lifetime.human.games) {
    renderEmptyMyStatsOpponent();
    return;
  }
  const serverScoringAvailable = lifetime.source === "server" && lifetime.scoringGames !== undefined;
  const totals = {
    human: { ...(serverScoringAvailable ? emptyAnalyticsTotals() : localTotals.human), ...lifetime.human },
    ai: { ...(serverScoringAvailable ? emptyAnalyticsTotals() : localTotals.ai), ...lifetime.ai },
  };
  els.analyticsTitle.textContent = "My Stats";
  els.analyticsSummary.textContent = serverScoringAvailable
    ? lifetime.scoringGames === lifetime.human.games
      ? `Scoring averages use every recorded hand across all ${lifetime.human.games} production game${lifetime.human.games === 1 ? "" : "s"} against ${opponentLabel}.`
      : `${lifetime.human.games} production game${lifetime.human.games === 1 ? "" : "s"} against ${opponentLabel}; scoring averages use every recorded hand from ${lifetime.scoringGames} game${lifetime.scoringGames === 1 ? "" : "s"} with detailed scoring.`
    : lifetime.source === "server"
      ? "Loading production scoring history…"
      : completedGames
        ? `${completedGames} completed game${completedGames === 1 ? "" : "s"} against ${opponentLabel} recorded on this device.`
      : "Loading merged production history…";
  els.analyticsTotals.innerHTML = "";
  els.analyticsTotals.classList.add("my-stats-comparison");
  els.analyticsTotals.append(myStatsComparisonTable(
    lifetime.player,
    totals,
    serverScoringAvailable ? lifetime.scoringGames ?? 0 : completedGames,
    lifetime.human.games,
    serverScoringAvailable,
    opponentLabel,
  ));
  renderAnalyticsRows(els.analyticsGames, []);
  renderAnalyticsRows(els.analyticsHands, []);
  renderAnalyticsRows(els.analyticsScores, []);
  renderAnalyticsRows(els.analyticsPegging, []);
}

function renderMyStatsOpponentTabs(): void {
  els.myStatsOpponentTabs.hidden = state.analyticsMode !== "my" || state.statsView !== "stats";
  for (const button of els.myStatsOpponentTabButtons) {
    const opponent = button.dataset.myStatsOpponent as MyStatsOpponent;
    const selected = opponent === state.myStatsOpponent;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

function renderEmptyMyStatsOpponent(): void {
  const opponent = state.myStatsOpponent;
  const human = opponent === "human";
  els.analyticsTitle.textContent = "My Stats";
  els.analyticsSummary.textContent = human
    ? "Track your completed head-to-head games separately from your AI matches."
    : opponent === "master"
      ? "Track your completed games against Ace."
      : `Track your completed games against ${MY_STATS_OPPONENT_LABEL[opponent]} separately from Ace.`;
  els.analyticsTotals.innerHTML = "";
  els.analyticsTotals.classList.add("my-stats-comparison");
  els.analyticsTotals.append(emptyMyStatsComparisonTable(
    playerDisplayName(),
    human ? "Human opponents" : MY_STATS_OPPONENT_LABEL[opponent],
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
  const pendingGameIds = pendingAnalysisGameIds(events, games.map((game) => game.gameId));
  const pendingDecisions = pendingGameIds.reduce(
    (sum, gameId) => sum + gameAnalysisProgress(events, gameId).pending,
    0,
  );
  els.gameLogAnalyzeAll.disabled = !pendingDecisions || state.completingReviews;
  els.gameLogAnalyzeAll.textContent = state.completingReviews && state.reviewProgress
    ? `Analyzing ${state.reviewProgress.total - state.reviewProgress.remaining}/${state.reviewProgress.total}`
    : pendingDecisions
      ? `Analyze all (${pendingGameIds.length})`
      : "All analyzed";
  for (const button of els.gameLogViewTabButtons) {
    const selected = button.dataset.gameLogView === state.gameLogView;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  els.gameLogGames.hidden = state.gameLogView !== "games";
  els.gameLogErrors.hidden = state.gameLogView !== "errors";
  els.gameLogSummary.textContent = `${games.length} completed game${games.length === 1 ? "" : "s"}${pendingDecisions ? ` · ${pendingDecisions} decision${pendingDecisions === 1 ? "" : "s"} awaiting analysis` : " · Analysis complete"}.`;
  if (state.gameLogView === "errors") {
    renderGameLogErrors(events, games);
    return;
  }

  syncGameLogFilter(games);
  const selectedOpponent = els.gameLogOpponent.value;
  const selectedResult = els.gameLogResult.value;
  const selectedMatchType = els.gameLogMatchType.value;
  const filtered = games.filter((game) =>
    (!selectedOpponent || game.opponent === selectedOpponent) &&
    (!selectedResult || gameLogResult(game) === selectedResult) &&
    (!selectedMatchType || gameLogMatchType(game) === selectedMatchType)
  );
  if (!state.selectedLogGameId || !filtered.some((game) => game.gameId === state.selectedLogGameId)) {
    state.selectedLogGameId = filtered[0]?.gameId ?? null;
  }

  const filters = [
    selectedOpponent ? engineName(selectedOpponent) : "",
    selectedResult ? `${selectedResult === "loss" ? "losses" : `${selectedResult}s`}` : "",
    selectedMatchType ? selectedMatchType.toUpperCase() : "",
  ].filter(Boolean);
  els.gameLogSummary.textContent = `${filtered.length} completed game${filtered.length === 1 ? "" : "s"}${filters.length ? ` · ${filters.join(" · ")}` : ""}.`;
  els.gameLogList.innerHTML = "";
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "analytics-empty";
    empty.textContent = "No completed games match this filter.";
    els.gameLogList.append(empty);
    return;
  }

  for (const game of filtered) {
    const item = document.createElement("article");
    item.className = "game-log-item";
    item.classList.toggle("selected", game.gameId === state.selectedLogGameId);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "game-log-item-open";
    const result = game.end.finalScores
      ? `${game.end.finalScores.human}-${game.end.finalScores.ai}`
      : "Final score unavailable";
    const title = document.createElement("strong");
    title.textContent = `${shortDate(game.end.at)} · vs ${engineName(game.opponent)}`;
    const meta = document.createElement("span");
    meta.textContent = `${playerName(game.end.winner, game.opponent)} won ${result}${game.end.result && game.end.result !== "regular" ? ` (${game.end.result})` : ""}`;
    const ev = document.createElement("span");
    const progress = gameAnalysisProgress(events, game.gameId);
    const totals = decisionEvTotals(decisionMistakes(events, game.gameId));
    ev.textContent = progress.pending
      ? `${progress.reviewed}/${progress.total} moves checked${totals.count ? ` · ${totals.count} error${totals.count === 1 ? "" : "s"} found` : ""}`
      : `${formatPercentagePointDelta(totals.total)} error win% (${totals.count}); ${formatEvPoints(totals.pointEvTotal)} EV`;
    ev.className = totals.total < 0 ? "game-log-ev has-errors" : "game-log-ev";
    open.append(title, meta, ev);
    open.addEventListener("click", () => openLoggedGameReport(game.gameId));
    item.append(open);
    if (progress.pending) {
      const analyze = document.createElement("button");
      analyze.type = "button";
      analyze.className = "game-log-item-analyze";
      analyze.textContent = "Analyze";
      analyze.setAttribute("aria-label", `Analyze ${shortDate(game.end.at)} game against ${engineName(game.opponent)}`);
      analyze.disabled = state.completingReviews;
      analyze.addEventListener("click", () => void analyzeGameDecisionReviews(game.gameId));
      item.append(analyze);
    }
    els.gameLogList.append(item);
  }
}

function openLoggedGameReport(gameId: string, errorEventId: string | null = null): void {
  closeDecisionSnapshot();
  state.selectedLogGameId = gameId;
  state.analyticsOpen = false;
  state.decisionReviewOpen = true;
  render(state.game);
  if (errorEventId) {
    state.snapshotEventId = errorEventId;
    renderDecisionSnapshot(loadAnalytics().events);
  }
}

function renderGameLogErrors(events: AnalyticsEvent[], games: GameLogRecord[]): void {
  const gamesById = new Map(games.map((game) => [game.gameId, game]));
  const errors = games
    .flatMap((game) => decisionMistakes(events, game.gameId))
    .sort((left, right) => {
      const leftDate = gamesById.get(left.gameId)?.end.at ?? left.at;
      const rightDate = gamesById.get(right.gameId)?.end.at ?? right.at;
      return rightDate.localeCompare(leftDate) || decisionMistakeSortValue(right) - decisionMistakeSortValue(left);
    });
  els.gameLogErrorsSummary.textContent = errors.length
    ? `${errors.length} error${errors.length === 1 ? "" : "s"} found across analyzed decisions.`
    : "No analyzed errors yet.";
  els.gameLogErrorsList.innerHTML = "";
  if (!errors.length) {
    const empty = document.createElement("p");
    empty.className = "analytics-empty";
    empty.textContent = pendingAnalysisGameIds(events, games.map((game) => game.gameId)).length
      ? "Analyze unfinished games to complete this list."
      : "Ace did not flag any errors in the analyzed games.";
    els.gameLogErrorsList.append(empty);
    return;
  }
  for (const error of errors) {
    const game = gamesById.get(error.gameId);
    if (!game) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-log-error-item";
    const title = document.createElement("strong");
    title.textContent = `Hand ${error.handNumber} ${error.type === "discard" ? "discard" : "peg"} · vs ${engineName(game.opponent)}`;
    const detail = document.createElement("span");
    detail.textContent = decisionReviewText(error);
    const impact = document.createElement("em");
    impact.textContent = `${shortDate(game.end.at)} · ${formatPercentagePointDelta(decisionErrorWinProbabilityImpact(error))} win%`;
    button.append(title, detail, impact);
    button.addEventListener("click", () => openLoggedGameReport(game.gameId, error.id));
    els.gameLogErrorsList.append(button);
  }
}

function gameLogResult(game: GameLogRecord): "win" | "loss" | "skunk" {
  if (game.end.result === "skunk" || game.end.result === "double-skunk") return "skunk";
  return game.end.winner === "human" ? "win" : "loss";
}

function gameLogMatchType(game: Pick<GameLogRecord, "opponent">): "ai" | "human" {
  const opponent = game.opponent.toLowerCase();
  return opponent === "human" || opponent.startsWith("human:") ? "human" : "ai";
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
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
  if ((!usesRemoteAi() && !LOCAL_QA_MODE) || state.leaderboardFetched || state.leaderboardLoading) return;
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

interface PlayerIdentityContent {
  player: string;
  handicap: DynamicHandicapSummary | null;
}

type LeaderboardContent = string | Array<string | PlayerIdentityContent>;

interface LeaderboardRowData {
  key: string;
  cells: LeaderboardContent[];
}

function leaderboardPlayerIdentity(player: string): PlayerIdentityContent {
  return { player, handicap: null };
}

function leaderboardContentKey(content: LeaderboardContent): string {
  return typeof content === "string" ? `text:${content}` : `rich:${JSON.stringify(content)}`;
}

function setLeaderboardContent(element: HTMLElement, content: LeaderboardContent): boolean {
  const key = leaderboardContentKey(content);
  if (element.dataset.contentKey === key) return false;
  if (typeof content === "string") {
    element.textContent = content;
  } else {
    const parts = content.map((part) => {
      if (typeof part === "string") return document.createTextNode(part);
      const identity = document.createElement("span");
      identity.className = "leaderboard-player-identity";
      setPlayerIdentity(identity, part.player, part.handicap);
      return identity;
    });
    element.replaceChildren(...parts);
  }
  element.dataset.contentKey = key;
  return true;
}

let renderedLeaderboardKey = "";

const LEADERBOARD_METRIC_LABELS: Record<LeaderboardMetric, string> = {
  handicap: "Current handicap",
  pointsPerGame: "Tourney Points / Game",
  winPercentage: "Win percentage",
  pointDifferential: "Point differential / game",
  totalPoints: "Points scored",
  totalWins: "Total wins",
};

const LEADERBOARD_WINDOW_LABELS: Record<LeaderboardWindow, string> = {
  daily: "Past 24 hours",
  weekly: "Past 7 days",
  monthly: "Past 30 days",
  allTime: "All time",
};

function renderLeaderboardTabs(): void {
  for (const button of els.leaderboardMetricTabButtons) {
    const selected = button.dataset.leaderboardMetric === state.leaderboardMetric;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  const handicap = state.leaderboardMetric === "handicap";
  els.leaderboardWindowTabs.hidden = handicap;
  for (const button of els.leaderboardWindowTabButtons) {
    const selected = button.dataset.leaderboardWindow === state.leaderboardWindow;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}

function leaderboardMetricCopy(player: LeaderboardPlayer, metric: Exclude<LeaderboardMetric, "handicap">): string {
  const value = leaderboardMetricValue(player, metric);
  if (metric === "pointsPerGame") return `${value.toFixed(2)} pts/game`;
  if (metric === "winPercentage") return percentage(value);
  if (metric === "pointDifferential") return formatSigned(value);
  return String(Math.round(value));
}

function renderLeaderboard(): void {
  const loading = state.leaderboardLoading && !state.leaderboardLoaded;
  const summary = state.leaderboardSummary;
  const renderKey = `${loading ? "loading" : "ready"}:${state.leaderboardMetric}:${state.leaderboardWindow}:${leaderboardSummaryKey(summary)}`;
  if (renderKey === renderedLeaderboardKey) return;
  renderedLeaderboardKey = renderKey;
  renderLeaderboardTabs();
  if (loading) {
    els.leaderboardList.replaceChildren(leaderboardLoadingElement());
    els.leaderboardSummary.textContent = "Loading leaderboard...";
    return;
  }

  const animate = state.leaderboardAnimateNext;
  state.leaderboardAnimateNext = false;
  els.leaderboardList.querySelector(".leaderboard-loading")?.remove();

  if (state.leaderboardMetric === "handicap") {
    const handicaps = rankLeaderboardHandicaps(
      Object.entries(summary.playerHandicaps ?? {})
        .filter(([, handicap]) => Number.isFinite(handicap.wpPerGame))
        .map(([player, handicap]) => ({ player, ...handicap })),
    );
    els.leaderboardSummary.textContent = "";
    reconcileLeaderboardSection(
      "ranking",
      LEADERBOARD_METRIC_LABELS.handicap,
      handicaps.map((handicap, index) => ({
        key: handicap.player,
        cells: [
          [`${index + 1}. `, leaderboardPlayerIdentity(handicap.player)],
          dynamicHandicapPointsCopy(handicap.wpPerGame),
        ],
      })),
      animate,
    );
    reconcileLeaderboardEmpty(handicaps.length === 0);
    return;
  }

  const fallbackAllTime = summary.playerStatsByOpponent?.master ?? summary.playerStats ?? summary.winRate14_3 ?? [];
  const players = summary.playerStatsByWindow?.[state.leaderboardWindow]
    ?? (state.leaderboardWindow === "allTime" ? fallbackAllTime : []);
  const rankedPlayers = rankLeaderboardMetricPlayers(players, state.leaderboardMetric);
  const games = players.reduce((total, player) => total + player.games, 0);
  const windowLabel = LEADERBOARD_WINDOW_LABELS[state.leaderboardWindow];
  const metricLabel = LEADERBOARD_METRIC_LABELS[state.leaderboardMetric];
  els.leaderboardSummary.textContent = `${windowLabel} · ${games} completed game${games === 1 ? "" : "s"}.`;
  reconcileLeaderboardSection(
    "ranking",
    `${metricLabel} · ${windowLabel}`,
    rankedPlayers.map((player, index) => ({
      key: player.player,
      cells: [
        [`${index + 1}. `, leaderboardPlayerIdentity(player.player)],
        leaderboardMetricCopy(player, state.leaderboardMetric as Exclude<LeaderboardMetric, "handicap">),
        `${player.wins}-${player.losses} · ${player.games} game${player.games === 1 ? "" : "s"}`,
      ],
    })),
    animate,
  );
  reconcileLeaderboardEmpty(rankedPlayers.length === 0);
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

function updateLeaderboardRow(row: HTMLElement, cells: LeaderboardContent[]): boolean {
  let changed = false;
  while (row.children.length < cells.length) row.append(document.createElement("span"));
  while (row.children.length > cells.length) row.lastElementChild?.remove();
  cells.forEach((content, index) => {
    const cell = row.children[index] as HTMLElement;
    if (setLeaderboardContent(cell, content)) changed = true;
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
  els.decisionReviewSummary.textContent = `${shortDate(selected.end.at)} vs ${engineName(selected.opponent)}.`;
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
        opponent: start?.opponent ?? event.opponent,
      });
    }
  }
  return records.sort((a, b) => b.end.at.localeCompare(a.end.at));
}

function syncGameLogFilter(games: GameLogRecord[]): void {
  const selected = els.gameLogOpponent.value;
  const opponents = [...new Set(games.map((game) => game.opponent))]
    .sort((a, b) => analyticsEngineSortKey(a as Opponent) - analyticsEngineSortKey(b as Opponent));
  els.gameLogOpponent.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All opponents";
  els.gameLogOpponent.append(all);
  for (const opponent of opponents) {
    const option = document.createElement("option");
    option.value = opponent;
    option.textContent = gameLogMatchType({ opponent }) === "human" ? "Human" : engineName(opponent);
    els.gameLogOpponent.append(option);
  }
  els.gameLogOpponent.value = opponents.includes(selected) ? selected : "";
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
  els.analyticsTotals.append(analyticsTotalCard(playerDisplayName(), humanTotals, "human"));
  const games = gameLogRecords(events);
  els.analyticsTotals.append(decisionErrorAveragesCard(
    decisionErrorAverages(events, games),
    decisionErrorAverages(events, games.slice(0, 10)),
  ));
  els.analyticsTotals.append(analyticsTotalCard(`${playerDisplayName()} vs all opponents`, humanTotals, "human"));
  for (const engine of sortedAnalyticsEngines(aiByModel, aiHumanByModel, humanByModel)) {
    const userTotals = humanByModel.get(engine) ?? emptyAnalyticsTotals();
    els.analyticsTotals.append(analyticsTotalCard(`${playerDisplayName()} vs ${engineName(engine)}`, userTotals, "human"));
  }
  els.analyticsTotals.append(analyticsTotalCard("All opponents", aiAllTotals, "ai"));
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
    "myrmidon-5",
    "schell_table-peg_table-9.1",
    "schell_table-peg_table-9.11",
    ...ACE_OPPONENTS,
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
    helps: 0,
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
  if (kind === "human" && (label === playerDisplayName() || label.startsWith(`${playerDisplayName()} vs `))) {
    setPlayerIdentity(title, playerDisplayName());
    title.append(label.slice(playerDisplayName().length));
  } else {
    title.textContent = label;
  }
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

function singleGameReportTable(
  report: { human: AnalyticsTotals; ai: AnalyticsTotals },
  options: { includeAceHelps?: boolean } = {},
): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "single-game-report-table";
  const playerLabel = playerDisplayName();
  const opponentLabel = playerName("ai");
  table.setAttribute("aria-label", `${playerLabel} and ${opponentLabel} game comparison; difference is ${playerLabel} minus ${opponentLabel}`);

  const head = table.createTHead();
  const header = head.insertRow();
  for (const [label, className] of [["Metric", ""], [playerLabel, "human"], [opponentLabel, "ai"], ["Diff.", "difference"]]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    if (className) cell.className = className;
    if (className === "difference") cell.title = `${playerLabel} minus ${opponentLabel}`;
    if (className === "human") setPlayerIdentity(cell, label);
    else cell.textContent = label;
    header.append(cell);
  }

  const body = table.createTBody();
  for (const row of singleGameReportRows(report.human, report.ai, options)) {
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
  opponentLabel = playerName("ai"),
): HTMLElement {
  const section = document.createElement("div");
  section.className = "my-stats-table-wrap";

  const table = document.createElement("table");
  table.className = "my-stats-table";
  table.setAttribute("aria-label", `${playerLabel} and ${opponentLabel} statistics comparison; difference is ${playerLabel} minus ${opponentLabel}`);

  const head = table.createTHead();
  const header = head.insertRow();
  for (const [label, className] of [["Metric", ""], [playerLabel, "human"], [opponentLabel, "ai"], ["Diff.", "difference"]]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    if (className) cell.className = className;
    if (className === "difference") cell.title = `${playerLabel} minus ${opponentLabel}`;
    if (className === "human") setPlayerIdentity(cell, label);
    else cell.textContent = label;
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

  return section;
}

function emptyMyStatsComparisonTable(playerLabel: string, opponentLabel: string): HTMLElement {
  const section = document.createElement("div");
  section.className = "my-stats-table-wrap";
  const table = document.createElement("table");
  table.className = "my-stats-table";
  table.setAttribute("aria-label", `${playerLabel} and ${opponentLabel} statistics comparison; no completed games yet`);

  const head = table.createTHead();
  const header = head.insertRow();
  for (const [label, className] of [["Metric", ""], [playerLabel, "human"], [opponentLabel, "ai"], ["Diff.", "difference"]]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    if (className) cell.className = className;
    if (className === "human") setPlayerIdentity(cell, label);
    else cell.textContent = label;
    header.append(cell);
  }

  const body = table.createTBody();
  for (const row of myStatsTableRows(emptyAnalyticsTotals(), emptyAnalyticsTotals())) {
    const tableRow = body.insertRow();
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = row.label;
    tableRow.append(label);
    for (const className of ["human", "ai", "difference"]) {
      const cell = tableRow.insertCell();
      cell.className = className;
      cell.textContent = "—";
    }
  }
  section.append(table);
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

function playerName(player: PlayerKey | undefined, opponent?: string): string {
  if (!player) return "-";
  if (player === "human") return playerDisplayName();
  if (activeHumanTable) return gameEntryOpponentName();
  return engineName(opponent ?? currentSnapshot?.opponent ?? els.opponent.value);
}

function engineName(engine: string | undefined): string {
  if (!engine) return "Ace";
  if (engine === "human") return activeHumanTable ? gameEntryOpponentName() : "Human opponent";
  if (engine === PATHWAY_OPPONENTS.easy) return "Easy";
  if (engine === PATHWAY_OPPONENTS.tough) return "Tough";
  if (engine.toLowerCase().includes("grandmaster")) return "Legend";
  if (engine.toLowerCase().includes("dynamic")) return "Dynamic";
  return "Ace";
}

function playerDisplayName(): string {
  return authenticatedUser?.displayName || playerFirstName || "Player";
}

function gameParticipantName(player: string | null | undefined): string {
  if (!player) return "-";
  return player === "User" ? playerDisplayName() : playerName("ai");
}

function playerPossessive(player: PlayerKey): string {
  const name = playerName(player);
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function presentGameText(value: string): string {
  return value
    .replace(/\bUser\b/g, playerDisplayName())
    .replace(/\bAI\b/g, playerName("ai"));
}

function normalizeAnalyticsEngine(engine: string | undefined): Opponent {
  if (engine === "human") return "human";
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
  if (state.dealCutRevealStage === "ai" && game.cutForDeal) return dealCutOutcomeLabel(game);
  if (state.dealCutRevealStage) return "Cut for deal. Low card deals.";
  if (game.phase === "cut_for_deal") return "Cut for deal. Low card deals.";
  if (game.phase === "discard") {
    return game.cribOwner === "User"
      ? `Select two cards to discard to ${playerPossessive("human")} crib.`
      : `Select two cards to discard to ${playerPossessive("ai")} crib.`;
  }
  if (game.phase === "ai_discarding") return "";
  if (game.phase === "pegging") return "";
  if (game.phase === "pegging_complete") return "Pegging complete";
  return "";
}

function renderUtilityPages(): void {
  els.app.dataset.view = state.engagementOpen
    ? "engagement"
    : state.analyticsOpen
      ? "analytics"
    : state.leaderboardOpen
      ? "leaderboard"
      : state.modelInfoOpen
        ? "model-info"
        : state.decisionReviewOpen
          ? "decision-review"
          : "game";
  syncMobileGameplayHeaderPlacement();
  els.analyticsPage.hidden = !state.analyticsOpen;
  els.engagementPage.hidden = !state.engagementOpen;
  els.leaderboardPage.hidden = !state.leaderboardOpen;
  els.modelInfoPage.hidden = !state.modelInfoOpen;
  els.decisionReviewPage.hidden = !state.decisionReviewOpen;
  els.appBackLabel.textContent = pathwayRouteLabel(currentAppBackRoute());
  if (state.analyticsOpen) renderAnalytics();
  if (state.leaderboardOpen) renderLeaderboard();
  if (state.modelInfoOpen) renderModelInfoPage();
  if (state.decisionReviewOpen) renderDecisionReviewPage();
  if (state.engagementOpen || state.analyticsOpen || state.leaderboardOpen || state.modelInfoOpen || state.decisionReviewOpen) {
    trackActivityPageView(currentActivitySurface());
  }
}

function render(game: GameState | null): void {
  if (!game) {
    renderUtilityPages();
    return;
  }
  syncGameplayArtifactPlacement(game);
  els.pathwayStatistics.disabled = false;
  syncAnalytics(game.analyticsEvents);
  state.game = game;
  if (SIMPLE_NETWORK_MODE && game.phase === "game_over") state.hasResumableGame = false;
  document.body.dataset.splash = state.splashOpen ? "true" : "false";
  els.splashPage.hidden = !state.splashOpen;
  trackActivityPageView(currentActivitySurface());
  syncMobileGameplayHeaderPlacement();
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
  els.app.dataset.fastCounting = state.fastCounting ? "true" : "false";
  const showingDealCut = Boolean(state.dealCutRevealStage) || game.phase === "cut_for_deal";
  els.app.dataset.dealCutActive = showingDealCut ? "true" : "false";
  els.app.dataset.dealAnimationActive = state.dealAnimation ? "true" : "false";
  els.app.dataset.cutConfirming = state.dealCutResolve ? "true" : "false";
  renderUtilityPages();
  els.app.dataset.inlineResult = shouldInlineResult(game) ? "true" : "false";
  const showParGuides = shouldShowStrategicGuides(state.parGuides, SIMPLE_NETWORK_MODE);
  els.app.dataset.parGuides = showParGuides ? "true" : "false";
  const scoreboardGame = gameForScoreboard(game);
  els.humanScore.textContent = String(scoreboardGame.scores.human);
  els.aiScore.textContent = String(scoreboardGame.scores.ai);
  els.currentModel.textContent = engineName(currentSnapshot?.opponent ?? els.opponent.value ?? DEFAULT_OPPONENT);
  renderDynamicCalibrationStatus(game);
  renderScorePace(scoreboardGame);
  const revealCribOwner = shouldRevealCribOwner(game.phase, state.dealCutRevealStage);
  setPlayerIdentity(els.humanName, playerDisplayName());
  els.aiName.textContent = playerName("ai");
  els.aiHandTitle.textContent = `${playerPossessive("ai")} hand`;
  els.humanDealer.hidden = !revealCribOwner || game.dealer !== "User";
  els.aiDealer.hidden = !revealCribOwner || game.dealer !== "AI";
  els.dealer.textContent = gameParticipantName(game.dealer);
  els.turn.textContent = gameParticipantName(game.turn);
  els.count.textContent = String(game.count);
  const showModelLoadingUi = state.modelLoading && !SIMPLE_NETWORK_MODE;
  els.modelThinking.hidden = !showModelLoadingUi;
  const thinkingLabel = els.modelThinking.querySelector(".thinking-label");
  if (thinkingLabel) {
    thinkingLabel.textContent = "Loading opponent";
  }
  els.thinkingOverlay.hidden = !showModelLoadingUi;
  els.thinkingOverlayLabel.textContent = "Loading opponent";
  els.modelLoading.hidden = !showModelLoadingUi;
  renderServerBusy();
  renderCutCard(state.turnCutRevealStage || !game.turnCardRevealed ? null : game.turnCard);
  renderAceMistakeBadge(game);
  renderScoring(game.scoring);
  renderGameOver(game);
  renderBoard(scoreboardGame);
  renderCribTray(game);
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
  els.plays.classList.toggle("deal-cut-active", showingDealCut);
  els.userPanelHeader.hidden = hideHandsForInterstitial;
  els.userHandTitle.hidden = false;
  els.userHandTitle.textContent = game.peggingResetPending
    ? "Press OK to continue"
    : game.phase === "cut_for_deal"
      ? "Cut for deal"
      : game.phase === "pegging"
      ? `${playerPossessive("human")} hand`
      : `${playerPossessive("human")} hand`;
  const showHandMeta = !usesMobileGameplayLayout() &&
    !hideHandsForInterstitial &&
    game.phase === "pegging" &&
    !game.peggingResetPending;
  els.userHandMeta.hidden = !showHandMeta;
  els.userHandMeta.textContent = showHandMeta
    ? `Dealer: ${gameParticipantName(game.dealer)} · ${game.aiHandCount} ${engineName(currentSnapshot?.opponent ?? els.opponent.value)} ${game.aiHandCount === 1 ? "card" : "cards"}`
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
  renderResult(game);
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
  const turnCut = turnCutPresentation(state.turnCutRevealStage);
  const waitingForTurnCutClick = Boolean(turnCut?.action);
  const waitingForDealCutOk = Boolean(state.dealCutResolve);
  const selectedPlay = selectedPlayableCard(game);
  const aceAdviceEligible = canAskMaster(game);
  const masterAdviceAvailable = state.hintsEnabled && aceAdviceEligible && !state.masterHint;
  els.cutForDeal.hidden = !gameActive || !waitingForTurnCutClick;
  els.discard.hidden = !gameActive || Boolean(state.dealAnimation) || Boolean(state.dealCutRevealStage) || waitingForDealCutOk || Boolean(state.turnCutRevealStage) || game.phase !== "discard";
  els.play.hidden = !gameActive || Boolean(state.dealAnimation) || waitingForDealCutOk || Boolean(state.turnCutRevealStage) || game.peggingResetPending || !(game.phase === "pegging" && game.turn === "User");
  els.askMaster.hidden = !masterAdviceAvailable;
  els.go.hidden = !(activeHumanTable && game.phase === "pegging" && game.turn === "User" && game.canGo && !game.peggingResetPending);
  els.discard.disabled = !(game.phase === "discard" && state.selected.size === 2);
  els.cutForDeal.textContent = turnCut?.action?.buttonLabel ?? "Cut deck";
  els.cutForDeal.disabled = !waitingForTurnCutClick;
  els.play.textContent = selectedPlay ? `Play ${selectedPlay.rank}${selectedPlay.symbol}` : "Play selected";
  els.play.disabled = game.peggingResetPending || !(game.phase === "pegging" && game.turn === "User" && selectedPlay);
  els.askMaster.disabled = !masterAdviceAvailable || state.pending;
  els.go.disabled = !game.canGo;
  const humanScoringWait = Boolean(activeHumanTable && !humanGameCanContinueScoring);
  els.continueScoring.hidden = game.phase === "game_over" || humanScoringWait;
  els.continueScoring.disabled = game.phase === "game_over" || !game.scoring || humanScoringWait;
  els.skipCounting.hidden = !game.scoring || Boolean(state.activeScoreSummary);
  els.skipCounting.disabled = state.pending;
  els.acknowledgePeggingReset.hidden = !game.peggingResetPending || Boolean(activeHumanTable && !humanGameCanAcknowledgePeggingReset);
  els.continuePegging.hidden = game.peggingResetPending || game.phase !== "pegging_complete" || humanScoringWait;
  if (state.pending) {
    els.discard.disabled = true;
    els.cutForDeal.disabled = !(waitingForDealCutOk || waitingForTurnCutClick);
    els.play.disabled = true;
    els.askMaster.disabled = true;
    els.go.disabled = true;
    els.acknowledgePeggingReset.disabled = true;
    els.continueScoring.disabled = true;
    els.continuePegging.disabled = true;
  } else {
    els.acknowledgePeggingReset.disabled = false;
    els.continuePegging.disabled = false;
  }
  renderScoringCardEmphasis();
  renderScoreSummaryDialog();
  renderMasterHint();
  if (
    !state.pending &&
    aceAdviceEligible &&
    (state.hintsEnabled || state.errorNoticesEnabled)
  ) startAceAdvicePreparation(game);
}

function shouldAdvancePeggingAi(game: GameState): boolean {
  return !activeHumanTable && game.phase === "pegging" && game.turn === "AI" && !game.peggingResetPending;
}

function shouldShowAiThinkingForPegging(game: GameState): boolean {
  return shouldAdvancePeggingAi(game);
}

function shouldAutoHumanGo(game: GameState): boolean {
  return !activeHumanTable && game.phase === "pegging" && game.turn === "User" && game.canGo && !game.peggingResetPending;
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
  if (tableMotionDisabled()) return;
  const dealer = game.dealer;
  const pone = dealer === "User" ? "AI" : "User";
  state.dealAnimation = { key, dealer, pone };
  state.resultOverride = [`Dealing hand ${game.handNumber}.`];
  render(game);
  await waitForPaint();
  await waitMs((11 * DEAL_CARD_INTERVAL_MS) + DEAL_CARD_DURATION_MS + 100);
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
      const previous = current;
      const source = capturePeggingPlaySource("ai");
      current = await withDelayedAiThinking(current, () => api("/api/advance-pegging", {}));
      await renderPeggingPlayWithMotion(previous, current, "ai", source);
      continue;
    }
    return current;
  }
  throw new Error("Pegging continuation did not settle.");
}

const storedReviewQueues = new Map<string, Promise<ReturnType<typeof gameAnalysisProgress>>>();

function requestNextStoredDecisionReview(gameId: string): Promise<ReturnType<typeof gameAnalysisProgress>> {
  const previous = storedReviewQueues.get(gameId) ?? Promise.resolve(gameAnalysisProgress(loadAnalytics().events, gameId));
  const request = previous.catch(() => gameAnalysisProgress(loadAnalytics().events, gameId)).then(async () => {
    if (activeHumanTable && currentSnapshot?.gameId === gameId) {
      const response = await authJson<HumanGameResponse>("/api/people/table/game/review", {
        tableId: activeHumanTable.id,
      });
      applyHumanGameResponse(response);
      return gameAnalysisProgress(loadAnalytics().events, gameId);
    }
    const before = gameAnalysisProgress(loadAnalytics().events, gameId);
    if (!before.pending) return before;
    const response = await serverJson<ServerGameActionResponse>("/api/game/review", {
      gameId,
      tag: currentSessionTag() || null,
    });
    syncAnalytics(response.state.analyticsEvents);
    mergeReviewedDynamicCalibration(gameId, response.state.dynamicCalibration);
    return gameAnalysisProgress(loadAnalytics().events, gameId);
  });
  storedReviewQueues.set(gameId, request);
  void request.finally(() => {
    if (storedReviewQueues.get(gameId) === request) storedReviewQueues.delete(gameId);
  }).catch(() => undefined);
  return request;
}

function mergeReviewedDynamicCalibration(
  gameId: string,
  reviewed: DynamicCalibration | null | undefined,
): void {
  if (!state.game || currentSnapshot?.gameId !== gameId) return;
  const current = state.game.dynamicCalibration;
  const freshest = freshestDynamicCalibration(current, reviewed);
  if (!freshest || freshest === current) return;
  state.game = { ...state.game, dynamicCalibration: freshest };
  if (ownPeopleProfile) {
    const profileCalibration = freshestDynamicCalibration(
      ownPeopleProfile.dynamicCalibration,
      freshest,
    );
    if (profileCalibration !== ownPeopleProfile.dynamicCalibration) {
      ownPeopleProfile = { ...ownPeopleProfile, dynamicCalibration: profileCalibration ?? undefined };
    }
  }
  saveGame();
  syncPathwayResumePresentation();
}

function storeLiveDecisionReview(gameId: string): void {
  void requestNextStoredDecisionReview(gameId).then(() => {
    if (state.analyticsOpen || state.decisionReviewOpen || currentSnapshot?.gameId === gameId) render(state.game);
  }).catch((error) => {
    console.warn("Live Ace decision review will be backfilled later", error);
  });
}

async function analyzeGameDecisionReviews(gameId: string): Promise<void> {
  if (state.pending || state.completingReviews) return;
  const initial = gameAnalysisProgress(loadAnalytics().events, gameId);
  if (!initial.pending) return;
  state.completingReviews = true;
  state.reviewProgress = { total: initial.pending, remaining: initial.pending };
  render(state.game);
  try {
    for (;;) {
      const beforeRemaining = gameAnalysisProgress(loadAnalytics().events, gameId).pending;
      if (!beforeRemaining) break;
      const progress = await requestNextStoredDecisionReview(gameId);
      const remaining = progress.pending;
      state.reviewProgress = { total: initial.pending, remaining };
      render(state.game);
      if (!remaining || remaining >= beforeRemaining) break;
      await waitMs(35);
    }
  } catch (error) {
    showServerBusy(error, () => analyzeGameDecisionReviews(gameId));
  } finally {
    state.completingReviews = false;
    state.reviewProgress = null;
    render(state.game);
  }
}

async function analyzeAllLoggedGames(): Promise<void> {
  if (state.pending || state.completingReviews) return;
  const events = loadAnalytics().events;
  const games = gameLogRecords(events);
  const gameIds = pendingAnalysisGameIds(events, games.map((game) => game.gameId));
  const total = gameIds.reduce((sum, gameId) => sum + gameAnalysisProgress(events, gameId).pending, 0);
  if (!total) return;
  state.completingReviews = true;
  state.reviewProgress = { total, remaining: total };
  render(state.game);
  try {
    let remaining = total;
    for (const gameId of gameIds) {
      for (;;) {
        const before = gameAnalysisProgress(loadAnalytics().events, gameId).pending;
        if (!before) break;
        const progress = await requestNextStoredDecisionReview(gameId);
        const completed = before - progress.pending;
        if (completed <= 0) break;
        remaining = Math.max(0, remaining - completed);
        state.reviewProgress = { total, remaining };
        render(state.game);
        await waitMs(35);
      }
    }
  } catch (error) {
    showServerBusy(error, () => analyzeAllLoggedGames());
  } finally {
    state.completingReviews = false;
    state.reviewProgress = null;
    render(state.game);
  }
}

els.bugReportOpen.addEventListener("click", () => {
  resetBugReportDialog();
  openFeedbackDialog(els.bugReportDialog, els.bugReportDescription);
});

els.bugReportClose.addEventListener("click", () => els.bugReportDialog.close());
els.bugReportCancel.addEventListener("click", () => els.bugReportDialog.close());
els.bugReportDialog.addEventListener("close", resetBugReportDialog);
els.bugReportDialog.addEventListener("cancel", (event) => {
  if (els.bugReportSubmit.disabled) event.preventDefault();
});

els.bugReportScreenshot.addEventListener("change", () => {
  const file = els.bugReportScreenshot.files?.[0];
  const error = file ? feedbackScreenshotError(file) : null;
  els.bugReportScreenshot.setCustomValidity(error || "");
  setFeedbackStatus(els.bugReportStatus, error ? "error" : "idle", error || "");
});

els.bugReportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!els.bugReportForm.reportValidity()) return;
  setFeedbackSubmitting(els.bugReportSubmit, els.bugReportCancel, els.bugReportClose, true);
  setFeedbackStatus(els.bugReportStatus, "sending", "Sending your bug report…");
  try {
    const file = els.bugReportScreenshot.files?.[0];
    const screenshot = file ? await screenshotDataUrl(file) : undefined;
    const response = await submitFeedback("/api/feedback/bug-report", {
      description: els.bugReportDescription.value,
      screenshotDataUrl: screenshot,
      page: feedbackPageContext(),
    });
    els.bugReportForm.reset();
    setFeedbackStatus(els.bugReportStatus, "success", response.message);
  } catch (error) {
    setFeedbackStatus(
      els.bugReportStatus,
      "error",
      error instanceof Error ? error.message : "Your bug report could not be sent. Please try again.",
    );
  } finally {
    setFeedbackSubmitting(els.bugReportSubmit, els.bugReportCancel, els.bugReportClose, false);
  }
});

els.featureRequestOpen.addEventListener("click", () => {
  resetFeatureRequestDialog();
  openFeedbackDialog(els.featureRequestDialog, els.featureRequestDescription);
});

els.featureRequestClose.addEventListener("click", () => els.featureRequestDialog.close());
els.featureRequestCancel.addEventListener("click", () => els.featureRequestDialog.close());
els.featureRequestDialog.addEventListener("close", resetFeatureRequestDialog);
els.featureRequestDialog.addEventListener("cancel", (event) => {
  if (els.featureRequestSubmit.disabled) event.preventDefault();
});

els.featureRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!els.featureRequestForm.reportValidity()) return;
  setFeedbackSubmitting(
    els.featureRequestSubmit,
    els.featureRequestCancel,
    els.featureRequestClose,
    true,
  );
  setFeedbackStatus(els.featureRequestStatus, "sending", "Sending your feature request…");
  try {
    const response = await submitFeedback("/api/feedback/feature-request", {
      description: els.featureRequestDescription.value,
      page: feedbackPageContext(),
    });
    els.featureRequestForm.reset();
    setFeedbackStatus(els.featureRequestStatus, "success", response.message);
  } catch (error) {
    setFeedbackStatus(
      els.featureRequestStatus,
      "error",
      error instanceof Error ? error.message : "Your feature request could not be sent. Please try again.",
    );
  } finally {
    setFeedbackSubmitting(
      els.featureRequestSubmit,
      els.featureRequestCancel,
      els.featureRequestClose,
      false,
    );
  }
});

for (const button of els.pathwayTargetButtons) {
  button.addEventListener("click", () => {
    const target = button.dataset.pathwayTarget as PathwayView | undefined;
    if (target) navigatePathway(target);
  });
}

for (const button of els.pathwayBackButtons) {
  button.addEventListener("click", () => {
    const view = button.closest<HTMLElement>("[data-pathway-view]")?.dataset.pathwayView as PathwayView | undefined;
    const destination = button.dataset.pathwayBack as PathwayView | undefined;
    navigatePathway(destination || (view ? pathwayParentRoute(view) : null) || "home");
  });
}

els.pathwayLogoHome.addEventListener("click", (event) => {
  if (!PATHWAY_NAV_ENABLED) return;
  event.preventDefault();
  navigatePathway("home");
});

els.appBrandHome.addEventListener("click", (event) => {
  if (!PATHWAY_NAV_ENABLED) return;
  event.preventDefault();
  leaveActivePathwayGame("home");
});

els.appBack.addEventListener("click", () => {
  if (PATHWAY_NAV_ENABLED) {
    const parent = currentAppBackRoute();
    if (parent === "play") leaveActivePathwayGame(parent);
    else navigatePathway(parent);
    return;
  }
  state.splashOpen = true;
  render(state.game);
});

els.pathwayHeaderHome.addEventListener("click", () => {
  const view = els.pathwayPage.dataset.view as PathwayView;
  const parent = pathwayParentRoute(view);
  if (parent) navigatePathway(parent);
});

for (const button of els.pathwayDestinationButtons) {
  if (button.disabled) continue;
  const destination = button.dataset.pathwayDestination;
  if (destination === "human") {
    button.addEventListener("click", () => {
      const table = resumableHumanTable();
      if (button.dataset.resumable === "true" && table) {
        void openHumanTable(table.id);
        return;
      }
      if (!authenticatedUser) {
        requestAuthentication({ kind: "human" }, "Sign in to find a human opponent.");
        return;
      }
      navigatePathway("human");
    });
    continue;
  }
  if (destination === "size") {
    button.addEventListener("click", openSizeDialog);
    continue;
  }
  if (destination === "gameplay") {
    button.addEventListener("click", () => navigatePathway("gameplay"));
    continue;
  }
  const opponent = pathwayOpponent(destination);
  if (!opponent) continue;
  button.addEventListener("click", () => {
    if (button.dataset.resumable === "true") {
      els.pathwayPage.hidden = true;
      state.splashOpen = false;
      document.body.dataset.splash = "false";
      void resumeGameFromSplash(opponent);
      return;
    }
    void launchPathwayOpponent(opponent);
  });
}

els.pathwayStatistics.addEventListener("click", () => {
  if (!authenticatedUser) {
    requestAuthentication({ kind: "statistics" }, "Sign in to view your statistics.");
    return;
  }
  navigatePathway("statistics");
});

els.pathwayLeaderboard.addEventListener("click", () => navigatePathway("leaderboard"));

els.peoplePresenceToggle.addEventListener("click", () => {
  const open = els.peoplePresencePanel.hidden;
  els.peoplePresencePanel.hidden = !open;
  els.peoplePresenceToggle.setAttribute("aria-expanded", String(open));
  if (open) {
    showMobileGameplayHeader(false);
    renderPeopleDirectory();
    void refreshPeople({ heartbeat: Boolean(authenticatedUser) });
  } else {
    scheduleMobileGameplayHeaderHide(700);
  }
});

els.peoplePresencePanel.addEventListener("pointerdown", beginPeopleDirectoryInteraction);
document.addEventListener("pointerup", finishPeopleDirectoryInteraction, { capture: true });
document.addEventListener("pointercancel", finishPeopleDirectoryInteraction, { capture: true });

els.peoplePresenceClose.addEventListener("click", () => {
  els.peoplePresencePanel.hidden = true;
  els.peoplePresenceToggle.setAttribute("aria-expanded", "false");
  els.peoplePresenceToggle.focus();
  scheduleMobileGameplayHeaderHide(700);
});

els.authLogin.addEventListener("click", () => {
  els.peoplePresencePanel.hidden = true;
  els.peoplePresenceToggle.setAttribute("aria-expanded", "false");
  requestAuthentication(null, "Sign in to your Strong Cribbage account.");
});

els.peopleProfileBack.addEventListener("click", () => {
  if (window.history.state?.peopleProfile) {
    window.history.back();
    return;
  }
  clearPeopleRouteParameter("profile");
  hidePeopleProfile();
  applyPathwayRoute(pathwayRouteFromLocation());
});

els.peopleProfilePlay.addEventListener("click", () => {
  if (selectedPeopleProfile) void challengePeoplePlayer(selectedPeopleProfile.username);
});

els.peopleProfileImage.addEventListener("change", async () => {
  const file = els.peopleProfileImage.files?.[0];
  if (!file || !selectedPeopleProfile) return;
  els.peopleProfileStatus.textContent = "Preparing profile picture…";
  try {
    pendingAvatarDataUrl = await resizeProfileImage(file);
    const preview = { ...selectedPeopleProfile, avatarDataUrl: pendingAvatarDataUrl };
    renderPeopleAvatar(els.peopleProfileAvatar, preview);
    els.peopleProfileStatus.textContent = "Profile picture ready to save.";
  } catch (error) {
    els.peopleProfileStatus.textContent = error instanceof Error ? error.message : "That picture could not be prepared.";
    els.peopleProfileImage.value = "";
  }
});

els.peopleProfileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authenticatedUser || !els.peopleProfileForm.reportValidity()) return;
  els.peopleProfileSave.disabled = true;
  els.peopleProfileStatus.textContent = "Saving profile…";
  try {
    const response = await authJson<PeopleProfileResponse>("/api/people/me", {
      username: els.peopleProfileUsername.value,
      email: els.peopleProfileEmail.value,
      avatarDataUrl: pendingAvatarDataUrl,
      textSize: state.fontSize,
    });
    ownPeopleProfile = response.profile;
    authenticatedUser = {
      username: response.profile.username,
      displayName: response.profile.displayName,
      email: response.profile.email || els.peopleProfileEmail.value,
    };
    playerFirstName = response.profile.displayName;
    safeLocalStorageSet(PLAYER_FIRST_NAME_KEY, playerFirstName);
    setPlayerIdentity(
      els.authAccountProfile,
      response.profile.displayName,
      response.profile.dynamicHandicap ?? null,
    );
    renderPeopleProfile(response.profile);
    const url = profileRouteUrl(response.profile.username);
    window.history.replaceState({ peopleProfile: response.profile.username }, "", url);
    els.peopleProfileStatus.textContent = "Profile saved.";
    await refreshPeople({ heartbeat: true });
  } catch (error) {
    els.peopleProfileStatus.textContent = error instanceof Error ? error.message : "The profile could not be saved.";
  } finally {
    els.peopleProfileSave.disabled = false;
  }
});

els.peoplePasswordReset.addEventListener("click", async () => {
  if (!authenticatedUser) return;
  els.peoplePasswordReset.disabled = true;
  els.peopleProfileStatus.textContent = "Requesting a private reset link…";
  try {
    const response = await authJson<AuthMessageResponse>("/api/auth/password/request", {
      email: authenticatedUser.email,
    });
    els.peopleProfileStatus.textContent = response.message || "A password reset link is on its way.";
  } catch (error) {
    els.peopleProfileStatus.textContent = error instanceof Error ? error.message : "The reset link could not be requested.";
  } finally {
    els.peoplePasswordReset.disabled = false;
  }
});

els.authAccountProfile.addEventListener("click", () => {
  if (authenticatedUser) void openPeopleProfile(authenticatedUser.username);
});

els.humanTableBack.addEventListener("click", () => {
  if (window.history.state?.humanTable) {
    window.history.back();
    return;
  }
  clearPeopleRouteParameter("table");
  hideHumanTable();
  applyPathwayRoute(pathwayRouteFromLocation());
});

els.humanTableCut.addEventListener("click", async () => {
  if (!activeHumanTable) return;
  els.humanTableCut.disabled = true;
  els.humanTableStatus.textContent = "Cutting the deck…";
  try {
    const response = await authJson<HumanTableResponse>("/api/people/table/cut", {
      tableId: activeHumanTable.id,
    });
    renderHumanTable(response.table);
    els.humanTableStatus.textContent = "";
    if (response.table.phase === "playing") {
      await enterHumanGame(true);
      return;
    }
    scheduleHumanTablePoll();
  } catch (error) {
    els.humanTableStatus.textContent = error instanceof Error ? error.message : "The deck could not be cut.";
  } finally {
    els.humanTableCut.disabled = false;
  }
});

els.sizeDialog.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSizePreference().catch((error) => {
    els.sizeDialogStatus.textContent = error instanceof Error ? error.message : "The text size could not be saved.";
  });
});

els.sizeDialogClose.addEventListener("click", () => els.sizeDialog.close());

document.addEventListener("keydown", (event) => {
  recordPeopleActivity();
  if (event.key !== "Escape" || els.pathwayPage.hidden) return;
  const parent = pathwayParentRoute(els.pathwayPage.dataset.view as PathwayView);
  if (parent) navigatePathway(parent);
});

function engagementMetric(
  label: string,
  value: string,
  note: string,
  change?: { value: number | null; points?: boolean; lowerIsBetter?: boolean },
): HTMLElement {
  const card = document.createElement("article");
  card.className = "engagement-metric";
  const heading = document.createElement("span");
  heading.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  const detail = document.createElement("small");
  detail.textContent = note;
  card.append(heading, strong);
  if (change) {
    const comparison = document.createElement("em");
    if (change.value === null) {
      comparison.textContent = "No prior baseline";
      comparison.dataset.tone = "neutral";
    } else {
      const positive = change.value > 0;
      comparison.textContent = `${positive ? "+" : ""}${change.value}${change.points ? " pts" : "%"} vs prior`;
      const improved = change.lowerIsBetter ? !positive : positive;
      comparison.dataset.tone = change.value === 0 ? "neutral" : improved ? "good" : "watch";
    }
    card.append(comparison);
  }
  card.append(detail);
  return card;
}

function engagementTable(
  container: HTMLElement,
  headings: string[],
  rows: Array<Array<string | number>>,
  emptyMessage: string,
): void {
  container.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "engagement-empty";
    empty.textContent = emptyMessage;
    container.append(empty);
    return;
  }
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headingRow = document.createElement("tr");
  for (const heading of headings) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = heading;
    headingRow.append(cell);
  }
  head.append(headingRow);
  const body = document.createElement("tbody");
  for (const values of rows) {
    const row = document.createElement("tr");
    values.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) (cell as HTMLTableCellElement).scope = "row";
      cell.textContent = String(value);
      row.append(cell);
    });
    body.append(row);
  }
  table.append(head, body);
  container.append(table);
}

type EngagementChartKey = keyof Omit<EngagementTrendPoint, "period">;

interface EngagementChartSeries {
  key: EngagementChartKey;
  label: string;
  color: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function engagementSvgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function filledEngagementTrend(report: EngagementReport): EngagementTrendPoint[] {
  const hourly = report.range.days === 1;
  const source = hourly ? report.hourly : report.daily;
  if (report.range.days === 0) return source;
  const values = new Map(source.map((point) => [point.period, point]));
  const end = new Date(report.range.to);
  const start = new Date(end.getTime() - report.range.days * 24 * 60 * 60 * 1_000);
  if (hourly) {
    start.setUTCMinutes(0, 0, 0);
    end.setUTCMinutes(0, 0, 0);
  } else {
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(0, 0, 0, 0);
  }
  const points: EngagementTrendPoint[] = [];
  for (const value = new Date(start); value <= end; hourly ? value.setUTCHours(value.getUTCHours() + 1) : value.setUTCDate(value.getUTCDate() + 1)) {
    const period = value.toISOString().slice(0, hourly ? 13 : 10);
    points.push(values.get(period) ?? {
      period,
      activeVisitors: 0,
      sessions: 0,
      events: 0,
      gameStarts: 0,
      gameCompletions: 0,
      gameForfeits: 0,
      bounces: 0,
      errorEvents: 0,
      frictionEvents: 0,
      abandonmentCandidates: 0,
    });
  }
  return points;
}

function engagementPeriodLabel(period: string, hourly: boolean): string {
  if (hourly) return `${period.slice(11, 13)}:00`;
  const date = new Date(`${period}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function renderEngagementLineChart(
  container: HTMLElement,
  report: EngagementReport,
  series: EngagementChartSeries[],
): void {
  container.replaceChildren();
  const points = filledEngagementTrend(report);
  if (!report.totals.events || !points.length) {
    const empty = document.createElement("p");
    empty.className = "engagement-empty";
    empty.textContent = "No activity was recorded for this chart.";
    container.append(empty);
    return;
  }

  const hidden = new Set((container.dataset.hiddenSeries || "").split(",").filter(Boolean));
  if (series.every((item) => hidden.has(item.key))) hidden.delete(series[0].key);
  const legend = document.createElement("div");
  legend.className = "engagement-chart-legend";
  for (const item of series) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.series = item.key;
    button.setAttribute("aria-pressed", String(!hidden.has(item.key)));
    const swatch = document.createElement("i");
    swatch.style.setProperty("--series-color", item.color);
    button.append(swatch, document.createTextNode(item.label));
    button.addEventListener("click", () => {
      if (hidden.has(item.key)) hidden.delete(item.key);
      else if (series.length - hidden.size > 1) hidden.add(item.key);
      container.dataset.hiddenSeries = [...hidden].join(",");
      renderEngagementLineChart(container, report, series);
    });
    legend.append(button);
  }

  const visible = series.filter((item) => !hidden.has(item.key));
  const width = 900;
  const height = 310;
  const bounds = { top: 20, right: 18, bottom: 42, left: 48 };
  const plotWidth = width - bounds.left - bounds.right;
  const plotHeight = height - bounds.top - bounds.bottom;
  const maximum = Math.max(1, ...points.flatMap((point) => visible.map((item) => Number(point[item.key]))));
  const roundedMaximum = maximum <= 4 ? maximum : Math.ceil(maximum / 5) * 5;
  const x = (index: number) => bounds.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => bounds.top + plotHeight - (value / roundedMaximum) * plotHeight;

  const scroller = document.createElement("div");
  scroller.className = "engagement-chart-scroll";
  const svg = engagementSvgElement("svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${series.map((item) => item.label).join(", ")} over ${report.range.label.toLowerCase()}`);
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (roundedMaximum / 4) * tick;
    const tickY = y(value);
    const line = engagementSvgElement("line");
    line.setAttribute("x1", String(bounds.left));
    line.setAttribute("x2", String(width - bounds.right));
    line.setAttribute("y1", String(tickY));
    line.setAttribute("y2", String(tickY));
    line.classList.add("engagement-chart-gridline");
    const label = engagementSvgElement("text");
    label.setAttribute("x", String(bounds.left - 10));
    label.setAttribute("y", String(tickY + 4));
    label.setAttribute("text-anchor", "end");
    label.classList.add("engagement-chart-axis");
    label.textContent = String(Number(value.toFixed(1)));
    svg.append(line, label);
  }
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  for (const index of labelIndexes) {
    const label = engagementSvgElement("text");
    label.setAttribute("x", String(x(index)));
    label.setAttribute("y", String(height - 12));
    label.setAttribute("text-anchor", index === 0 ? "start" : index === points.length - 1 ? "end" : "middle");
    label.classList.add("engagement-chart-axis");
    label.textContent = engagementPeriodLabel(points[index].period, report.range.days === 1);
    svg.append(label);
  }
  for (const item of visible) {
    const path = engagementSvgElement("path");
    path.setAttribute("d", points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(Number(point[item.key]))}`).join(" "));
    path.style.setProperty("--series-color", item.color);
    path.classList.add("engagement-chart-line");
    svg.append(path);
    points.forEach((point, index) => {
      const circle = engagementSvgElement("circle");
      circle.setAttribute("cx", String(x(index)));
      circle.setAttribute("cy", String(y(Number(point[item.key]))));
      circle.setAttribute("r", points.length > 45 ? "2.25" : "4");
      circle.style.setProperty("--series-color", item.color);
      circle.classList.add("engagement-chart-point");
      const title = engagementSvgElement("title");
      title.textContent = `${item.label}: ${point[item.key]} · ${engagementPeriodLabel(point.period, report.range.days === 1)}`;
      circle.append(title);
      svg.append(circle);
    });
  }
  scroller.append(svg);
  container.append(legend, scroller);
}

function engagementInsight(title: string, value: string, detail: string, tone: "good" | "watch" | "neutral"): HTMLElement {
  const item = document.createElement("article");
  item.dataset.tone = tone;
  const label = document.createElement("span");
  label.textContent = title;
  const strong = document.createElement("strong");
  strong.textContent = value;
  const copy = document.createElement("p");
  copy.textContent = detail;
  item.append(label, strong, copy);
  return item;
}

function comparisonValue(report: EngagementReport, key: string): number | null {
  return report.comparison?.[key] ?? null;
}

function renderEngagementTabs(): void {
  for (const button of els.engagementTabButtons) {
    const selected = button.dataset.engagementTab === engagementTab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const panel of els.engagementPanels) {
    panel.hidden = panel.dataset.engagementPanel !== engagementTab;
  }
}

function renderEngagementReport(report: EngagementReport): void {
  const totals = report.totals;
  const environment = report.range.environment === "all" ? "all environments" : report.range.environment;
  const audience = report.range.audience === "all" ? "everyone" : report.range.audience;
  els.engagementSummary.textContent = `${report.range.label} · ${environment} · ${audience} · refreshed ${new Date(report.range.to).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const visitorChange = comparisonValue(report, "activeVisitors");
  const completionChange = comparisonValue(report, "completionPercent");
  els.engagementInsights.replaceChildren(
    engagementInsight("Active now", String(totals.activeNow), `${totals.activeLast24Hours} visitor${totals.activeLast24Hours === 1 ? "" : "s"} in the last 24 hours.`, totals.activeNow ? "good" : "neutral"),
    engagementInsight("Audience trend", visitorChange === null ? "No baseline" : `${visitorChange > 0 ? "+" : ""}${visitorChange}%`, "Active visitors compared with the prior matching window.", visitorChange === null || visitorChange === 0 ? "neutral" : visitorChange > 0 ? "good" : "watch"),
    engagementInsight("Game follow-through", `${totals.completionPercent}%`, `${totals.gameCompletions} completions among ${totals.observedGames} observed games; ${totals.gameAbandons} unresolved abandonments.`, totals.observedGames === 0 ? "neutral" : totals.completionPercent >= 70 ? "good" : "watch"),
    engagementInsight("UX signals", String(totals.errorEvents + totals.frictionEvents), `${totals.errorEvents} errors and ${totals.frictionEvents} repeat/rage-click signals.`, totals.errorEvents + totals.frictionEvents ? "watch" : "good"),
  );
  els.engagementOverview.replaceChildren(
    engagementMetric("Active visitors", String(totals.activeVisitors), `${totals.registeredUsers} signed-in people; ${totals.anonymousSessions} anonymous sessions.`, { value: visitorChange }),
    engagementMetric("Sessions", String(totals.sessions), `${totals.signedInSessions} sessions included a signed-in account.`, { value: comparisonValue(report, "sessions") }),
    engagementMetric("Returning people", String(totals.returningUsers), "Signed-in on at least two distinct UTC dates."),
    engagementMetric("Game starts", String(totals.gameStarts), `${totals.gameResumes} game resume events.`, { value: comparisonValue(report, "gameStarts") }),
    engagementMetric("Completed games", String(totals.gameCompletions), `${totals.completionPercent}% of ${totals.observedGames} observed games completed.`, { value: completionChange, points: true }),
    engagementMetric("Observed time", totals.averageExitSeconds ? `${Math.round(totals.averageExitSeconds / 60)}m` : "—", "Average page lifetime when a page-exit event arrived."),
  );
  renderEngagementLineChart(els.engagementActivityChart, report, [
    { key: "activeVisitors", label: "Visitors", color: "#71c9a9" },
    { key: "sessions", label: "Sessions", color: "#e8c575" },
    { key: "gameStarts", label: "Game starts", color: "#7eb7e8" },
    { key: "gameCompletions", label: "Completions", color: "#ee826b" },
  ]);
  els.engagementDefinitions.replaceChildren(...Object.entries(report.definitions).map(([key, definition]) => {
    const item = document.createElement("p");
    const term = document.createElement("strong");
    term.textContent = key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
    item.append(term, document.createTextNode(` — ${definition}`));
    return item;
  }));
  els.engagementFunnel.replaceChildren(...report.funnel.map((step) => {
    const item = document.createElement("article");
    const copy = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = step.label;
    const detail = document.createElement("span");
    detail.textContent = `${step.sessions} sessions · ${step.conversionPercent}%${step.dropOff ? ` · ${step.dropOff} dropped before this step` : ""}`;
    copy.append(label, detail);
    const bar = document.createElement("i");
    bar.style.setProperty("--engagement-width", `${Math.min(100, step.conversionPercent)}%`);
    item.append(copy, bar);
    return item;
  }));
  const breakdownRows = (rows: EngagementBreakdown[]) => rows.map((row) => [row.label, row.events, row.sessions, row.visitors]);
  els.engagementHealth.replaceChildren(
    engagementMetric("Bounce rate", `${totals.bouncePercent}%`, `${totals.bounceSessions} sessions ended in under 10 seconds without an interaction.`, { value: comparisonValue(report, "bouncePercent"), points: true, lowerIsBetter: true }),
    engagementMetric("Error sessions", String(totals.errorSessions), `${totals.errorEvents} client or server errors.`, { value: comparisonValue(report, "errorSessions"), lowerIsBetter: true }),
    engagementMetric("Friction sessions", String(totals.frictionSessions), `${totals.frictionEvents} repeated-action or rage-click signals.`),
    engagementMetric("Unresolved abandons", String(totals.gameAbandons), `${totals.gameForfeits} explicit forfeits in the same window.`),
  );
  renderEngagementLineChart(els.engagementExperienceChart, report, [
    { key: "bounces", label: "Bounces", color: "#e8c575" },
    { key: "errorEvents", label: "Errors", color: "#ee826b" },
    { key: "frictionEvents", label: "Friction", color: "#b893e6" },
    { key: "abandonmentCandidates", label: "Abandon signals", color: "#7eb7e8" },
  ]);
  engagementTable(
    els.engagementUsers,
    ["Person", "Last active", "Days", "Sessions", "Starts", "Observed", "Completed", "Errors", "Friction", "Primary client"],
    report.users.map((user) => [user.displayName, new Date(user.lastActive).toLocaleString(), user.activeDays, user.sessions, user.gameStarts, user.observedGames, user.gameCompletions, user.errors, user.frictionEvents, user.primaryClient]),
    "No signed-in people were active in this window.",
  );
  engagementTable(
    els.engagementRecent,
    ["Received", "Person", "Event", "Context", "Environment", "Client"],
    report.recentActivity.map((activity) => [new Date(activity.at).toLocaleString(), activity.person, activity.event.replaceAll("_", " "), activity.detail, activity.environment, activity.client]),
    "No recent activity matches these filters.",
  );
  engagementTable(els.engagementInteractions, ["Control", "Events", "Sessions", "Visitors"], breakdownRows(report.interactions), "No tracked interactions in this window.");
  engagementTable(els.engagementErrors, ["Error", "Events", "Sessions", "Visitors"], breakdownRows(report.errors), "No client or server errors in this window.");
  engagementTable(els.engagementSurfaces, ["Screen", "Views", "Sessions", "Visitors"], breakdownRows(report.surfaces), "No screen views in this window.");
  engagementTable(els.engagementPathways, ["Pathway", "Views", "Sessions", "Visitors"], breakdownRows(report.pathways), "No pathway views in this window.");
  engagementTable(els.engagementOpponents, ["Opponent/model", "Games", "Sessions", "Visitors"], breakdownRows(report.opponents), "No game activity in this window.");
  engagementTable(els.engagementDevices, ["Device · browser · viewport", "Events", "Sessions", "Visitors"], breakdownRows(report.devices), "No client activity in this window.");
  engagementTable(els.engagementClients, ["Client · platform · screen", "Events", "Sessions", "Visitors"], breakdownRows(report.clients), "No client activity in this window.");
  engagementTable(els.engagementEnvironments, ["Environment · version", "Events", "Sessions", "Visitors"], breakdownRows(report.environments), "No environment data in this window.");
  engagementTable(els.engagementLocations, ["Timezone · language", "Events", "Sessions", "Visitors"], breakdownRows(report.locations), "No regional context in this window.");
  engagementTable(els.engagementEvents, ["Event", "Count", "Sessions", "Visitors"], breakdownRows(report.eventTypes), "No events in this window.");
  engagementTable(els.engagementStates, ["State or phase", "Events", "Sessions", "Visitors"], breakdownRows(report.states), "No state or phase signals in this window.");
  engagementTable(
    els.engagementDaily,
    ["UTC date", "Visitors", "Sessions", "Events", "Starts", "Completed", "Bounces", "Errors", "Friction", "Abandon signals"],
    report.daily.map((row) => [row.period, row.activeVisitors, row.sessions, row.events, row.gameStarts, row.gameCompletions, row.bounces, row.errorEvents, row.frictionEvents, row.abandonmentCandidates]),
    "No daily activity in this window.",
  );
  renderEngagementTabs();
  els.engagementContent.hidden = false;
  els.engagementExport.disabled = report.daily.length === 0;
}

async function loadEngagementReport(): Promise<void> {
  els.engagementStatus.textContent = "Loading engagement data…";
  els.engagementContent.hidden = true;
  els.engagementExport.disabled = true;
  els.engagementRefresh.disabled = true;
  try {
    const days = Number(els.engagementRange.value);
    const environment = els.engagementEnvironment.value;
    const audience = els.engagementAudience.value;
    engagementReport = await authJson<EngagementReport>("/api/admin/engagement", { days, environment, audience });
    renderEngagementReport(engagementReport);
    els.engagementStatus.textContent = engagementReport.totals.events
      ? ""
      : "No activity was recorded in this window.";
  } catch (error) {
    engagementReport = null;
    els.engagementSummary.textContent = "Engagement report unavailable";
    els.engagementStatus.textContent = error instanceof Error ? error.message : "The report could not be loaded.";
  } finally {
    els.engagementRefresh.disabled = false;
  }
}

function openEngagementReport(): void {
  if (!authenticatedUser?.engagementAdmin) return;
  closeDecisionSnapshot();
  state.engagementOpen = true;
  state.analyticsOpen = false;
  state.leaderboardOpen = false;
  state.modelInfoOpen = false;
  state.decisionReviewOpen = false;
  els.pathwayPage.hidden = true;
  els.settingsPanel.hidden = true;
  render(state.game);
  void loadEngagementReport();
}

function closeEngagementReport(): void {
  state.engagementOpen = false;
  const url = new URL(window.location.href);
  url.searchParams.delete("engagement");
  window.history.replaceState(pathwayHistoryState("home"), "", `${url.pathname}${url.search}${url.hash}`);
  showPathwayView("home");
  render(state.game);
}

els.engagementPathwayOpen.addEventListener("click", openEngagementReport);
els.engagementMenuOpen.addEventListener("click", openEngagementReport);
els.engagementClose.addEventListener("click", closeEngagementReport);
els.engagementRange.addEventListener("change", () => void loadEngagementReport());
els.engagementEnvironment.addEventListener("change", () => void loadEngagementReport());
els.engagementAudience.addEventListener("change", () => void loadEngagementReport());
els.engagementRefresh.addEventListener("click", () => void loadEngagementReport());
for (const button of els.engagementTabButtons) {
  button.addEventListener("click", () => {
    engagementTab = button.dataset.engagementTab as typeof engagementTab;
    renderEngagementTabs();
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = els.engagementTabButtons.indexOf(button);
    const next = event.key === "ArrowRight" ? index + 1 : index - 1;
    els.engagementTabButtons[(next + els.engagementTabButtons.length) % els.engagementTabButtons.length].click();
    els.engagementTabButtons[(next + els.engagementTabButtons.length) % els.engagementTabButtons.length].focus();
  });
}
els.engagementExport.addEventListener("click", () => {
  if (!engagementReport?.csv) return;
  const blob = new Blob([engagementReport.csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `strong-cribbage-engagement-${engagementReport.range.days || "all"}-days.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});

function openAnalytics(mode: "my" | "full"): void {
  if (mode === "my" && PATHWAY_NAV_ENABLED && pathwayRouteFromLocation() !== "statistics") {
    window.history.pushState(pathwayHistoryState("statistics"), "", pathwayUrl("statistics"));
    els.pathwayPage.hidden = true;
  }
  closeDecisionSnapshot();
  state.analyticsMode = mode;
  state.statsView = "stats";
  if (mode !== "my") state.myStatsOpponent = "master";
  state.analyticsOpen = true;
  state.engagementOpen = false;
  state.leaderboardOpen = false;
  state.modelInfoOpen = false;
  state.decisionReviewOpen = false;
  els.settingsPanel.hidden = true;
  els.menuToggle.setAttribute("aria-expanded", "false");
  render(state.game);
  if (mode === "my") void loadInitialLeaderboard();
}

els.myStatsOpen.addEventListener("click", () => {
  if (!authenticatedUser) {
    requestAuthentication({ kind: "statistics" }, "Sign in to view your statistics.");
    return;
  }
  openAnalytics("my");
});

els.analyticsOpen.addEventListener("click", () => {
  openAnalytics("full");
});

for (const button of els.myStatsOpponentTabButtons) {
  button.addEventListener("click", () => {
    if (button.dataset.statsAvailable === "false") return;
    state.myStatsOpponent = button.dataset.myStatsOpponent as MyStatsOpponent;
    render(state.game);
  });
}

for (const button of els.statsViewTabButtons) {
  button.addEventListener("click", () => {
    state.statsView = button.dataset.statsView as StatsView;
    render(state.game);
  });
}

for (const button of els.gameLogViewTabButtons) {
  button.addEventListener("click", () => {
    state.gameLogView = button.dataset.gameLogView as GameLogView;
    render(state.game);
  });
}

els.gameLogAnalyzeAll.addEventListener("click", () => {
  void analyzeAllLoggedGames();
});

function openStatsGameLog(): void {
  openAnalytics("my");
  state.statsView = "game-log";
  render(state.game);
}

els.gameLogOpen.addEventListener("click", openStatsGameLog);

function openLeaderboard(): void {
  closeDecisionSnapshot();
  state.leaderboardOpen = true;
  state.leaderboardMetric = "handicap";
  state.leaderboardWindow = "monthly";
  state.engagementOpen = false;
  state.analyticsOpen = false;
  state.modelInfoOpen = false;
  state.decisionReviewOpen = false;
  els.settingsPanel.hidden = true;
  els.menuToggle.setAttribute("aria-expanded", "false");
  render(state.game);
  void loadInitialLeaderboard();
}

function bindLeaderboardTabs(
  buttons: HTMLButtonElement[],
  select: (button: HTMLButtonElement) => void,
): void {
  for (const button of buttons) {
    button.addEventListener("click", () => select(button));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = buttons.indexOf(button);
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = buttons[(index + offset + buttons.length) % buttons.length];
      next.click();
      next.focus();
    });
  }
}

bindLeaderboardTabs(els.leaderboardMetricTabButtons, (button) => {
  state.leaderboardMetric = button.dataset.leaderboardMetric as LeaderboardMetric;
  render(state.game);
});

bindLeaderboardTabs(els.leaderboardWindowTabButtons, (button) => {
  state.leaderboardWindow = button.dataset.leaderboardWindow as LeaderboardWindow;
  render(state.game);
});

els.modelInfoOpen.addEventListener("click", () => {
  closeDecisionSnapshot();
  state.selectedModelInfo = normalizeAnalyticsEngine(els.opponent.value);
  state.modelInfoOpen = true;
  state.engagementOpen = false;
  state.analyticsOpen = false;
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
    showServerBusy(error, () => els.exportGameLog.click());
  } finally {
    els.exportGameLog.disabled = false;
  }
});

els.decisionReviewClose.addEventListener("click", () => {
  closeDecisionSnapshot();
  state.decisionReviewOpen = false;
  state.analyticsMode = "my";
  state.statsView = "game-log";
  state.analyticsOpen = true;
  render(state.game);
});

els.decisionSnapshotClose.addEventListener("click", () => {
  closeDecisionSnapshot();
});

els.gameLogOpponent.addEventListener("change", () => {
  state.selectedLogGameId = null;
  render(state.game);
});

els.gameLogResult.addEventListener("change", () => {
  state.selectedLogGameId = null;
  render(state.game);
});

els.gameLogMatchType.addEventListener("change", () => {
  state.selectedLogGameId = null;
  render(state.game);
});

els.parGuidesToggle.addEventListener("change", () => {
  state.parGuides = els.parGuidesToggle.checked;
  safeLocalStorageSet("strong-cribbage.admin.parGuides", state.parGuides ? "1" : "0");
  render(state.game);
});

els.fastCounting.addEventListener("change", () => {
  state.fastCounting = els.fastCounting.checked;
  safeLocalStorageSet(FAST_COUNTING_STORAGE_KEY, state.fastCounting ? "1" : "0");
  if (state.fastCounting && state.game?.scoring) {
    clearNoticeQueue();
    state.scoringTransitionStage = null;
  }
  render(state.game);
});

els.hintsEnabled.addEventListener("change", () => {
  state.hintsEnabled = els.hintsEnabled.checked;
  safeLocalStorageSet(HINTS_ENABLED_STORAGE_KEY, state.hintsEnabled ? "1" : "0");
  if (!state.hintsEnabled && state.masterHint?.mode === "hint") {
    state.masterHint = null;
    els.masterHintDialog.hidden = true;
  }
  if (!state.hintsEnabled && !state.errorNoticesEnabled) state.aceAdvicePreparation = null;
  render(state.game);
});

els.errorNoticesEnabled.addEventListener("change", () => {
  state.errorNoticesEnabled = els.errorNoticesEnabled.checked;
  safeLocalStorageSet(ERROR_NOTICES_ENABLED_STORAGE_KEY, state.errorNoticesEnabled ? "1" : "0");
  if (!state.errorNoticesEnabled) {
    state.aceMistake = null;
    if (state.masterHint?.mode === "mistake") {
      state.masterHint = null;
      els.masterHintDialog.hidden = true;
    }
  }
  if (!state.hintsEnabled && !state.errorNoticesEnabled) state.aceAdvicePreparation = null;
  render(state.game);
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

async function cutForDeal(cutIndex = Math.floor(DEAL_CUT_CARD_COUNT / 2)): Promise<void> {
  if (state.pending) return;
  state.pending = true;
  state.dealCutIndex = cutIndex;
  state.dealAiCutIndex = null;
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
      state.dealAiCutIndex = (cutIndex + Math.ceil(DEAL_CUT_CARD_COUNT / 2)) % DEAL_CUT_CARD_COUNT;
      state.dealCutRevealStage = "human";
      render(next);
      await waitForPaint();
      await waitForTableMotion(800);
      state.dealCutRevealStage = "ai";
      render(next);
      await waitForPaint();
      await waitForTableMotion(1_250);
      state.dealCutRevealStage = null;
      state.resultOverride = null;
      render(next);
      await playDealAnimationIfNeeded(next);
    } else {
      render(next);
    }
  } catch (error) {
    showServerBusy(error, () => cutForDeal(cutIndex));
  } finally {
    state.dealCutRevealStage = null;
    state.dealCutIndex = null;
    state.dealAiCutIndex = null;
    state.dealCutResolve = null;
    state.pending = false;
    render(state.game);
  }
}

els.cutForDeal.addEventListener("click", () => {
  if (state.turnCutResolve) {
    completeTurnCutInteraction();
    return;
  }
  if (state.turnCutRevealStage) return;
  void cutForDeal(Math.floor(DEAL_CUT_CARD_COUNT / 2));
});

els.askMaster.addEventListener("click", () => {
  void requestMasterHint();
});

els.aceMistake.addEventListener("click", () => {
  const mistake = state.aceMistake;
  if (!mistake) return;
  state.masterHint = { ...mistake.advice, mode: "mistake" };
  render(state.game);
  window.setTimeout(() => els.masterHintDismiss.focus(), 0);
});

els.masterHintDismiss.addEventListener("click", () => {
  dismissMasterHint({ focus: true });
  render(state.game);
});

els.masterHintApply.addEventListener("click", () => {
  const hint = state.masterHint;
  if (!hint || state.pending) return;
  dismissMasterHint();
  if (hint.kind === "discard" && hint.cardIds.length === 2) {
    state.selected = new Set(hint.cardIds);
    render(state.game);
    els.discard.click();
    return;
  }
  if (hint.kind === "play" && hint.cardIds.length === 1) {
    state.selected = new Set(hint.cardIds);
    render(state.game);
    els.play.click();
    return;
  }
  if (hint.kind === "go") els.go.click();
});

els.masterSessionCancel.addEventListener("click", () => {
  dismissMasterSessionDialog();
});

els.masterSessionSave.addEventListener("click", () => {
  const route = state.pendingPathwayRoute;
  if (!route) return;
  dismissMasterSessionDialog();
  navigatePathway(route);
});

els.masterSessionForfeit.addEventListener("click", () => {
  void forfeitSavedMasterGame();
});

els.discard.addEventListener("click", async () => {
  if (state.pending) return;
  const selectedIds = Array.from(state.selected);
  reviewUserChoiceWithAce(state.game, "discard", selectedIds);
  const optimisticNext = activeHumanTable ? null : optimisticAiDiscardingState(state.game, selectedIds);
  const epoch = interactionEpoch;
  state.pending = true;
  render(state.game);
  await waitForPaint();
  let handoffToBackground = false;
  try {
    state.resultOverride = null;
    const discardRequest = api("/api/discard", { ids: selectedIds });
    void discardRequest.catch(() => undefined);
    await playDiscardToCribAnimation(state.game, "human", selectedIds);
    if (epoch !== interactionEpoch) return;
    if (optimisticNext) {
      handoffToBackground = true;
      state.selected.clear();
      state.pending = false;
      render(optimisticNext);
      await waitForPaint();
      await playDiscardToCribAnimation(optimisticNext, "ai");
      if (epoch !== interactionEpoch) return;
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
      if (activeHumanTable) {
        startHumanGameSync();
        return;
      }
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
  const previous = state.game;
  if (!card || !previous) return;
  const playSource = capturePeggingPlaySource("human", card.id);
  reviewUserChoiceWithAce(state.game, "play", [card.id]);
  state.pending = true;
  render(state.game);
  await waitForPaint();
  try {
    state.resultOverride = null;
    const next = await api("/api/play-human", { id: card.id });
    state.selected.clear();
    await renderPeggingPlayWithMotion(previous, next, "human", playSource);
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
  const dismissedSummary = state.activeScoreSummary;
  const previouslyConfirmedSummaryKey = state.confirmedScoreSummaryKey;
  state.confirmedScoreSummaryKey = dismissedSummary?.key ?? null;
  state.activeScoreSummary = null;
  renderScoreSummaryDialog();
  state.pending = true;
  render(state.game);
  try {
    state.resultOverride = null;
    const next = await playScoringStageTransition(() => api("/api/continue-scoring", {}));
    state.selected.clear();
    await playDealAnimationIfNeeded(next);
  } catch (error) {
    state.scoringTransitionStage = null;
    state.confirmedScoreSummaryKey = previouslyConfirmedSummaryKey;
    state.activeScoreSummary = dismissedSummary;
    showServerBusy(error, () => els.continueScoring.click());
  } finally {
    state.pending = false;
    render(state.game);
  }
});

els.skipCounting.addEventListener("click", () => {
  if (state.pending || !state.game?.scoring) return;
  clearNoticeQueue();
  ensureCurrentScoreSummary(state.game);
  maybeOpenScoreSummary();
  els.skipCounting.hidden = true;
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

async function startNewGameFromUi(
  { forceNew = false, allowActiveReplacement = false }: { forceNew?: boolean; allowActiveReplacement?: boolean } = {},
): Promise<void> {
  if (state.pending) return;
  if (state.splashOpen && !saveSplashName()) return;
  if (forceNew && !allowActiveReplacement && !canStartFreshGame(state.game)) {
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
  if (forceNew && isActiveGame(state.game) && currentSnapshot?.gameId) {
    activityTracker.track("game_abandonment_candidate", {
      reason: "replacement",
      replacedGameId: currentSnapshot.gameId,
    }, true);
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
      announceGameEntry(remoteGame);
      if (await resumeReconciledGame(remoteGame)) return;
      await continuePeggingAfterRender(remoteGame);
      return;
    }
    const next = await api("/api/new", { opponent: els.opponent.value });
    state.splashOpen = false;
    state.hasResumableGame = true;
    els.settingsPanel.hidden = true;
    els.menuToggle.setAttribute("aria-expanded", "false");
    render(next);
    announceGameEntry(next);
    if (!(await resumeReconciledGame(next))) await continuePeggingAfterRender(next);
  } catch (error) {
    showServerBusy(error, () => startNewGameFromUi());
  } finally {
    state.pending = false;
    render(state.game);
  }
}

async function resumeGameFromSplash(opponent?: Opponent): Promise<void> {
  const localGameMatches = state.hasResumableGame
    && state.game?.phase !== "game_over"
    && (!opponent || currentSnapshot?.opponent === opponent);
  if (state.pending || (!localGameMatches && (!opponent || !remoteResumableModelGames.has(opponent)))) return;
  if (!saveSplashName()) return;
  if (opponent) {
    selectedPathwayOpponent = opponent;
    els.opponent.value = opponent;
    syncPathwayOpponentPresentation(opponent);
  }
  state.pending = true;
  state.splashOpen = false;
  render(state.game);
  try {
    const game = localGameMatches
      ? await reconcileRemoteGameState() ?? state.game ?? await loadRemoteActiveGameSession(opponent)
      : await loadRemoteActiveGameSession(opponent);
    if (!game) return;
    render(game);
    announceGameEntry(game);
    if (await resumeReconciledGame(game)) return;
    await continuePeggingAfterRender(game);
  } catch (error) {
    showServerBusy(error, () => resumeGameFromSplash(opponent));
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
    await completeAuthenticationAndStart(response, "password");
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
    await completeAuthenticationAndStart(response, "otp");
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

els.authCancel.addEventListener("click", cancelPendingAuthentication);

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
    await completeAuthenticationAndStart(response, inviteToken ? "invite" : "password_reset");
  } catch (error) {
    showAuthView(view, error instanceof Error ? error.message : "The password could not be saved.", true);
  } finally {
    setAuthBusy(els.authPasswordForm, false);
  }
});

els.authLogout.addEventListener("click", async () => {
  els.authLogout.disabled = true;
  activityTracker.track("logout", {}, true);
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
  void startNewGameFromUi({ forceNew: selectedPathwayOpponent !== null });
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

function recordUiInteraction(kind: "click" | "change" | "submit", event: Event): void {
  const target = activityTarget(event.target);
  if (target) activityTracker.trackInteraction(kind, target);
}

document.addEventListener("click", (event) => recordUiInteraction("click", event), { capture: true });
document.addEventListener("change", (event) => recordUiInteraction("change", event), { capture: true });
document.addEventListener("submit", (event) => recordUiInteraction("submit", event), { capture: true });

window.addEventListener("touchstart", (event) => {
  recordPeopleActivity();
  if (!mobileGameplayHeaderActive() ||
      !els.topbar.classList.contains("mobile-game-header-hidden") ||
      event.touches.length !== 1 ||
      window.scrollY > 2) {
    mobileHeaderTouchStartY = null;
    return;
  }
  const touch = event.touches[0];
  mobileHeaderTouchStartY = touch.clientY;
}, { passive: true });

window.addEventListener("touchmove", (event) => {
  if (mobileHeaderTouchStartY === null || event.touches.length !== 1) return;
  const touch = event.touches[0];
  if (touch.clientY - mobileHeaderTouchStartY >= 46) {
    mobileHeaderTouchStartY = null;
    showMobileGameplayHeader();
  }
}, { passive: true });

window.addEventListener("touchend", () => {
  mobileHeaderTouchStartY = null;
}, { passive: true });

document.addEventListener("pointerdown", (event) => {
  recordPeopleActivity();
  const activityPointerTarget = activityTarget(event.target);
  if (activityPointerTarget) activityTracker.trackPointer(activityPointerTarget);
  if (!mobileGameplayHeaderActive()) return;
  const target = event.target;
  if (target instanceof Node && !els.topbar.contains(target)) hideMobileGameplayHeader();
}, { capture: true });

els.mobileHeaderReveal.addEventListener("click", (event) => {
  event.stopPropagation();
  showMobileGameplayHeader();
});

els.topbar.addEventListener("focusin", () => showMobileGameplayHeader(false));
els.topbar.addEventListener("focusout", () => scheduleMobileGameplayHeaderHide());

let activityResizeTimer: number | null = null;
window.addEventListener("resize", () => {
  render(state.game);
  if (activityResizeTimer !== null) window.clearTimeout(activityResizeTimer);
  activityResizeTimer = window.setTimeout(() => {
    activityResizeTimer = null;
    activityTracker.track("viewport_resize", {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      orientation: window.innerWidth >= window.innerHeight ? "landscape" : "portrait",
    });
  }, 500);
});
window.addEventListener("pagehide", () => {
  activityTracker.trackPageExit();
  uploadLocalCompletedGames(true);
});

let authenticationRecovery: Promise<void> | null = null;

function recoverInterruptedAuthentication(): void {
  if (
    authenticationRecovery ||
    authenticatedUser ||
    !AUTHENTICATION_ENABLED ||
    els.authPage.hidden ||
    els.authStatus.dataset.error !== "true"
  ) return;
  authenticationRecovery = (async () => {
    if (!await initializeAuthentication()) return;
    await initializePeople();
    await resumeAuthenticatedDestination();
  })().finally(() => {
    authenticationRecovery = null;
  });
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    lastActivityPageView = "";
    trackActivityPageView(currentActivitySurface(), "pageshow");
  }
  recoverInterruptedAuthentication();
  if (event.persisted) void refreshVisibleHumanGame();
});
document.addEventListener("visibilitychange", () => {
  activityTracker.track("visibility", { state: document.visibilityState });
  if (document.visibilityState === "hidden") {
    stopPeopleChallengeWatch();
    return;
  }
  if (document.visibilityState === "visible") {
    startPeopleChallengeWatch();
    if (!recordPeopleActivity()) {
      if (authenticatedUser) peopleLastHeartbeatAt = Date.now();
      void refreshPeople({ heartbeat: Boolean(authenticatedUser) });
    }
    recoverInterruptedAuthentication();
    void refreshVisibleHumanGame();
  }
});

document.addEventListener("wheel", recordPeopleActivity, { passive: true });

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
  await playDiscardToCribAnimation(state.game, "ai");
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
  if (!await initializeAuthentication()) {
    if (!URL_PARAMS.get("reset") && !URL_PARAMS.get("invite")) {
      const request = locationAuthenticationRequest();
      if (request) requestAuthentication(request.destination, request.message);
    }
    return;
  }
  await initializePeople();
  if (URL_PARAMS.get("engagement") === "1" && authenticatedUser?.engagementAdmin) {
    openEngagementReport();
    markAppReady();
    return;
  }
  await syncPeopleRouteFromLocation();
  if (authenticatedUser && pendingAuthDestination) {
    await resumeAuthenticatedDestination();
  }
  if (PATHWAY_NAV_ENABLED) {
    if (els.peopleProfilePage.hidden && els.humanTablePage.hidden && !activeHumanTable && !pendingAuthDestination) {
      applyPathwayRoute(pathwayRouteFromLocation());
    }
    markAppReady();
    return;
  }
  await initializeGameState();
}

if (shouldRestoreSavedGameSurface({
  route: PATHWAY_NAV_ENABLED ? pathwayRouteFromLocation() : null,
  activeGame: Boolean(state.game && state.game.phase !== "game_over"),
})) {
  try {
    render(state.game);
  } catch (error) {
    console.warn("Initial game render failed", error);
    state.splashOpen = SIMPLE_NETWORK_MODE && !playerFirstName;
    document.body.dataset.splash = state.splashOpen ? "true" : "false";
    els.splashPage.hidden = !state.splashOpen;
    showServerBusy(error, null);
  }
}

void initializeApplication();
