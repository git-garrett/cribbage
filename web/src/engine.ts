import cribFlushBonusBySuitCount from "./models/schell_table-peg_table-7.0/crib-flush-bonus.json";
import boardPositionStats from "./models/flush-aware-board-position-stats.json";
import cribRankComponentsByDiscardCut from "./models/rank-crib-discard/crib-rank-components-by-discard-cut.json";
import cribRankScoreByDiscardCut from "./models/rank-crib-discard/crib-rank-score-by-discard-cut.json";
import cribScoreHistogramByDiscardCut from "./models/rank-crib-discard/crib-score-histogram-by-discard-cut.json";
import handRankScoreByKeepCut from "./models/rank-crib-discard/hand-rank-score-by-keep-cut.json";
import peggingPairwise12Manifest from "./models/schell_table-peg_table-12.0/pegging-outcome-pairwise.manifest.json";
import peggingPairwise12Url from "./models/schell_table-peg_table-12.0/pegging-outcome-pairwise.bin?url";
import model13HoldManifest from "./models/schell_table-peg_table-13.0/pegging-remaining-hand-distribution.manifest.json";
import model13HoldUrl from "./models/schell_table-peg_table-13.0/pegging-remaining-hand-distribution.bin?url";
import model13LeadManifest from "./models/schell_table-peg_table-13.0/pone-lead-frequency.manifest.json";
import model13LeadUrl from "./models/schell_table-peg_table-13.0/pone-lead-frequency.bin?url";
import peggingPairwise14Manifest from "./models/schell_table-peg_table-14.0/pegging-outcome-tripolicy-aligned.manifest.json";
import peggingPairwise14Url from "./models/schell_table-peg_table-14.0/pegging-outcome-tripolicy-aligned.bin?url";
import cribTripolicy14Manifest from "./models/schell_table-peg_table-14.0/crib-score-histogram-tripolicy-by-discard-cut.manifest.json";
import cribTripolicy14Url from "./models/schell_table-peg_table-14.0/crib-score-histogram-tripolicy-by-discard-cut.bin?url";

export type PlayerKey = "human" | "ai";
export type Opponent =
  | "original-1.1"
  | "original_exhaustive_peg-1.2"
  | "ras_table-2.0"
  | "ras_table-peg-3.0"
  | "ras_table-peg_table-4.0"
  | "schell_table-peg-3.0"
  | "schell_table-peg_table-4.0"
  | "schell_table-peg_table-5.0"
  | "schell_table-peg_table-6.0"
  | "schell_table-peg_table-7.0"
  | "schell_table-peg_table-8.0"
  | "schell_table-peg_table-9.0"
  | "schell_table-peg_table-10.0"
  | "schell_table-peg_table-11.0"
  | "schell_table-peg_table-11.1"
  | "schell_table-peg_table-12.0"
  | "schell_table-peg_table-13.0"
  | "schell_table-peg_table-14.0"
  | "schell_table-2.0";
type LegacyOpponent =
  | "ras-table-1.0"
  | "ras-table-peg-1.1"
  | "ras-table-peg_table-1.2"
  | "schell-table-1.0"
  | "schell-table-peg-1.1"
  | "schell-table-peg_table-1.2"
  | "expert"
  | "expert-1.1"
  | "expert-peg-1.2"
  | "expert_ras-table-1.0"
  | "expert_ras-table-peg-1.1"
  | "expert_schell-table-peg-1.1"
  | "expert_schell-table-peg_table-1.2"
  | "expert_ras_table-2.0"
  | "expert_ras_table-peg-3.0"
  | "expert_schell_table-peg-3.0"
  | "expert_schell_table-peg_table-4.0"
  | "expert-peg_table-1.3"
  | "expert-2.0-ras-tables"
  | "expert-peg-2.1"
  | "expert-peg_table-2.2"
  | "expert-peg-2.2"
  | "expert-peg_table-2.3";
type StoredOpponent = Opponent | LegacyOpponent;
export const DEFAULT_OPPONENT: Opponent = "schell_table-peg_table-12.0";
export type Phase =
  | "cut_for_deal"
  | "discard"
  | "ai_discarding"
  | "pegging"
  | "pegging_complete"
  | "score_pone"
  | "score_dealer"
  | "score_crib"
  | "game_over";

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_ASCII = ["d", "c", "h", "s"];
const SUIT_NAMES = ["diamonds", "clubs", "hearts", "spades"];
const SUIT_SYMBOLS = ["♦", "♣", "♥", "♠"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const RUN_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const ENGINE_LABELS: Record<Opponent, string> = {
  "original-1.1": "Original 1.1",
  "original_exhaustive_peg-1.2": "Original Exhaustive Peg 1.2",
  "ras_table-2.0": "Ras Table 2.0",
  "ras_table-peg-3.0": "Ras Table + Peg 3.0",
  "ras_table-peg_table-4.0": "Ras Table + Peg Table 4.0",
  "schell_table-2.0": "Schell Table 2.0",
  "schell_table-peg-3.0": "Schell Table + Peg 3.0",
  "schell_table-peg_table-4.0": "Schell Table + Peg Table 4.0",
  "schell_table-peg_table-5.0": "Schell Table + Peg Table 5.0",
  "schell_table-peg_table-6.0": "Schell Table + Peg Table 6.0",
  "schell_table-peg_table-7.0": "Schell Table + Peg Table 7.0",
  "schell_table-peg_table-8.0": "Schell Table + Peg Table 8.0",
  "schell_table-peg_table-9.0": "Schell Table + Peg Table 9.0",
  "schell_table-peg_table-10.0": "Schell Table + Peg Table 10.0",
  "schell_table-peg_table-11.0": "Schell Table + Peg Table 11.0",
  "schell_table-peg_table-11.1": "Schell Table + Peg Table 11.1",
  "schell_table-peg_table-12.0": "Schell Table + Peg Table 12.0",
  "schell_table-peg_table-13.0": "Schell Table + Peg Table 13.0",
  "schell_table-peg_table-14.0": "Schell Table + Peg Table 14.0",
};
const CRIB_FLUSH_BONUS_BY_SUIT_COUNT = cribFlushBonusBySuitCount as number[];
const HAND_RANK_SCORE_BY_KEEP_CUT = (handRankScoreByKeepCut as {
  table: Record<string, Array<number | null>>;
}).table;
const CRIB_RANK_SCORE_BY_DISCARD_CUT = (cribRankScoreByDiscardCut as {
  table: Record<"dealer" | "pone", Record<string, Array<number | null>>>;
}).table;
type CribHistogramEntry = {
  totalWeight: number;
  histogram: Record<string, number>;
  opponentDiscards: Array<{ ranks: string; weight: number; rankScore: number }>;
};
type CribPolicy = "ev" | "on" | "off";
type CribTripolicyPolicyEntry = {
  average: number;
  opponentDiscards: Array<{ ranks: string; weight: number; rankScore: number }>;
};
type CribTripolicyTable = {
  pairKeys: string[];
  pairIndexByKey: Map<string, number>;
  directory: DataView;
  records: DataView;
  directoryRecordBytes: number;
  opponentRecordBytes: number;
  entryCount: number;
};
type CribTripolicyManifest = {
  pairKeys: string[];
  binaryFormat?: {
    magic?: string;
    policies?: CribPolicy[];
  };
};
const CRIB_SCORE_HISTOGRAM_BY_DISCARD_CUT = (cribScoreHistogramByDiscardCut as unknown as {
  table: Record<"dealer" | "pone", Record<string, Array<CribHistogramEntry | null>>>;
}).table;
const CRIB_RANK_COMPONENTS_BY_DISCARD_CUT = (cribRankComponentsByDiscardCut as {
  table: Record<"dealer" | "pone", Record<string, Array<number[] | null>>>;
}).table;
type DiscardTableEngine = Exclude<Opponent, "original-1.1" | "original_exhaustive_peg-1.2">;
type CribTable = { own: number[][]; opponent: number[][] };
const DISCARD_TABLES: Record<string, CribTable> = {
  "ras_table-2.0": {
    own: [
      [5.51, 4.35, 4.69, 5.42, 5.38, 3.98, 4.05, 3.77, 3.49, 3.51, 3.57, 3.50, 3.36],
      [4.35, 5.82, 7.14, 4.64, 5.54, 4.15, 3.78, 3.82, 3.91, 3.71, 4.05, 3.86, 3.57],
      [4.69, 7.13, 6.08, 5.13, 5.97, 4.05, 3.33, 4.13, 4.09, 3.51, 4.07, 3.65, 3.89],
      [5.41, 4.63, 5.12, 5.54, 6.53, 3.95, 3.61, 3.77, 3.82, 3.60, 3.98, 3.63, 3.61],
      [5.38, 5.53, 5.97, 6.53, 8.88, 6.81, 6.01, 5.56, 5.43, 6.70, 7.09, 6.59, 6.73],
      [3.97, 4.15, 4.05, 3.95, 6.80, 5.76, 5.14, 4.63, 5.11, 3.31, 3.45, 3.73, 3.21],
      [4.05, 3.77, 3.33, 3.61, 6.00, 5.14, 5.87, 6.44, 4.06, 3.59, 3.83, 3.39, 3.47],
      [3.76, 3.82, 4.13, 3.77, 5.56, 4.63, 6.44, 5.50, 4.77, 3.72, 3.93, 3.19, 3.04],
      [3.49, 3.90, 4.08, 3.82, 5.43, 5.11, 4.06, 4.76, 5.21, 4.40, 4.01, 2.99, 3.07],
      [3.50, 3.71, 3.51, 3.60, 6.69, 3.31, 3.59, 3.72, 4.39, 4.72, 4.76, 3.17, 2.84],
      [3.56, 4.05, 4.06, 3.98, 7.08, 3.45, 3.83, 3.92, 4.01, 4.75, 5.28, 4.83, 3.92],
      [3.50, 3.85, 3.64, 3.63, 6.59, 3.73, 3.38, 3.19, 2.99, 3.16, 4.82, 4.93, 3.48],
      [3.36, 3.56, 3.89, 3.61, 6.72, 3.20, 3.46, 3.04, 3.07, 2.83, 3.92, 3.48, 4.30],
    ],
    opponent: [
      [5.59, 5.17, 4.96, 5.62, 5.81, 4.97, 4.81, 4.84, 4.34, 4.54, 4.64, 4.24, 4.33],
      [5.17, 6.19, 7.52, 5.21, 5.79, 4.79, 4.80, 4.90, 4.57, 4.54, 4.61, 4.58, 4.45],
      [4.95, 7.52, 6.11, 5.74, 6.72, 4.81, 4.85, 5.20, 5.18, 4.58, 4.71, 4.61, 4.43],
      [5.61, 5.20, 5.74, 6.00, 6.44, 5.06, 5.00, 4.94, 4.57, 4.58, 5.14, 4.50, 4.36],
      [5.81, 5.79, 6.72, 6.43, 9.09, 6.87, 7.08, 6.39, 6.06, 7.22, 8.14, 7.10, 7.13],
      [4.96, 4.79, 4.81, 5.05, 6.86, 6.30, 6.18, 5.86, 6.20, 4.22, 4.53, 4.14, 4.08],
      [4.81, 4.80, 4.84, 4.99, 7.08, 6.17, 6.93, 6.67, 5.10, 4.17, 4.69, 4.24, 4.25],
      [4.84, 4.90, 5.19, 4.93, 6.39, 5.86, 6.67, 7.91, 5.89, 5.59, 4.58, 4.30, 4.15],
      [4.33, 4.57, 5.17, 4.57, 6.06, 6.20, 5.10, 5.89, 6.52, 5.30, 4.86, 4.12, 3.94],
      [4.54, 4.53, 4.57, 4.57, 7.21, 4.22, 4.17, 5.58, 5.29, 6.19, 5.95, 4.64, 3.85],
      [4.64, 4.61, 4.70, 5.14, 8.13, 4.53, 4.69, 4.57, 4.86, 5.95, 5.64, 5.46, 4.63],
      [4.23, 4.57, 4.61, 4.50, 7.10, 4.14, 4.24, 4.29, 4.11, 4.63, 5.46, 5.36, 4.52],
      [4.33, 4.45, 4.43, 4.36, 7.12, 4.07, 4.24, 4.15, 3.93, 3.84, 4.62, 4.51, 5.59],
    ],
  },
  "schell_table-2.0": {
    own: [
      [5.38, 4.23, 4.52, 5.43, 5.45, 3.85, 3.85, 3.80, 3.40, 3.42, 3.65, 3.42, 3.41],
      [4.23, 5.72, 7.00, 4.52, 5.45, 3.93, 3.81, 3.66, 3.71, 3.55, 3.84, 3.58, 3.52],
      [4.52, 7.00, 5.94, 4.91, 5.97, 3.81, 3.58, 3.92, 3.78, 3.57, 3.90, 3.59, 3.67],
      [5.43, 4.52, 4.91, 5.63, 6.48, 3.85, 3.72, 3.83, 3.72, 3.59, 3.88, 3.59, 3.60],
      [5.45, 5.45, 5.97, 6.48, 8.79, 6.63, 6.01, 5.48, 5.43, 6.66, 7.00, 6.63, 6.66],
      [3.85, 3.93, 3.81, 3.85, 6.63, 5.76, 4.98, 4.63, 5.13, 3.17, 3.41, 3.23, 3.13],
      [3.85, 3.81, 3.58, 3.72, 6.01, 4.98, 5.92, 6.53, 4.04, 3.23, 3.53, 3.23, 3.26],
      [3.80, 3.66, 3.92, 3.83, 5.48, 4.63, 6.53, 5.45, 4.72, 3.80, 3.52, 3.19, 3.16],
      [3.40, 3.71, 3.78, 3.72, 5.43, 5.13, 4.04, 4.72, 5.16, 4.29, 3.97, 2.99, 3.06],
      [3.42, 3.55, 3.57, 3.59, 6.66, 3.17, 3.23, 3.80, 4.29, 4.76, 4.61, 3.31, 2.84],
      [3.65, 3.84, 3.90, 3.88, 7.00, 3.41, 3.53, 3.52, 3.97, 4.61, 5.33, 4.81, 3.96],
      [3.42, 3.58, 3.59, 3.59, 6.63, 3.23, 3.23, 3.19, 2.99, 3.31, 4.81, 4.79, 3.46],
      [3.41, 3.52, 3.67, 3.60, 6.66, 3.13, 3.26, 3.16, 3.06, 2.84, 3.96, 3.46, 4.58],
    ],
    opponent: [
      [6.02, 5.07, 5.07, 5.72, 6.01, 4.91, 4.89, 4.85, 4.55, 4.48, 4.68, 4.33, 4.30],
      [5.07, 6.38, 7.33, 5.33, 6.11, 4.97, 4.97, 4.94, 4.70, 4.59, 4.81, 4.56, 4.45],
      [5.07, 7.33, 6.68, 5.96, 6.78, 4.87, 5.01, 5.05, 4.87, 4.63, 4.86, 4.59, 4.48],
      [5.72, 5.33, 5.96, 6.53, 7.26, 5.34, 4.88, 4.94, 4.68, 4.53, 4.85, 4.46, 4.36],
      [6.01, 6.11, 6.78, 7.26, 9.37, 7.47, 7.00, 6.30, 6.15, 7.41, 7.76, 7.34, 7.25],
      [4.91, 4.97, 4.87, 5.34, 7.47, 7.08, 6.42, 5.86, 6.26, 4.31, 4.57, 4.22, 4.14],
      [4.89, 4.97, 5.01, 4.88, 7.00, 6.42, 7.14, 7.63, 5.26, 4.31, 4.68, 4.32, 4.27],
      [4.85, 4.94, 5.05, 4.94, 6.30, 5.86, 7.63, 6.82, 5.83, 5.10, 4.59, 4.31, 4.20],
      [4.55, 4.70, 4.87, 4.68, 6.15, 6.26, 5.26, 5.83, 6.39, 5.43, 4.96, 4.11, 4.03],
      [4.48, 4.59, 4.63, 4.53, 7.41, 4.31, 4.31, 5.10, 5.43, 6.08, 5.63, 4.61, 3.88],
      [4.68, 4.81, 4.86, 4.85, 7.76, 4.57, 4.68, 4.59, 4.96, 5.63, 6.42, 5.46, 4.77],
      [4.33, 4.56, 4.59, 4.46, 7.34, 4.22, 4.32, 4.31, 4.11, 4.61, 5.46, 5.79, 4.49],
      [4.30, 4.45, 4.48, 4.36, 7.25, 4.14, 4.27, 4.20, 4.03, 3.88, 4.77, 4.49, 5.65],
    ],
  },
};
DISCARD_TABLES["ras_table-peg-3.0"] = DISCARD_TABLES["ras_table-2.0"];
DISCARD_TABLES["ras_table-peg_table-4.0"] = DISCARD_TABLES["ras_table-2.0"];
DISCARD_TABLES["schell_table-peg-3.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-4.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-5.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-6.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-7.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-8.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-9.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-10.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-11.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-11.1"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-12.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-13.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-14.0"] = DISCARD_TABLES["schell_table-2.0"];

export class WinGame extends Error {}

export class Card {
  id: number;
  rank: number;
  suit: number;
  value: number;
  runVal: number;
  rankStr: string;
  ascii: string;

  constructor(id: number) {
    if (!Number.isInteger(id) || id < 0 || id >= 52) {
      throw new Error("Card id must be an integer from 0 to 51.");
    }
    this.id = id;
    this.rank = id % 13;
    this.suit = Math.floor(id / 13);
    this.value = VALUES[this.rank];
    this.runVal = RUN_VALUES[this.rank];
    this.rankStr = RANKS[this.rank];
    this.ascii = `${this.rankStr}${SUIT_ASCII[this.suit]}`;
  }
}

interface PlayerState {
  key: PlayerKey;
  name: string;
  hand: Card[];
  table: Card[];
  crib: Card[];
  score: number;
}

export interface SerializedCard {
  index: number | null;
  id: number;
  rank: string;
  suit: string;
  symbol: string;
  value: number;
  label: string;
  owner?: string;
}

export interface AnalyticsScoreComponents {
  total: number;
  fifteens?: number;
  thirtyOne?: number;
  pairs?: number;
  runs?: number;
  flush?: number;
  knobs?: number;
  go?: number;
  lastCard?: number;
  heels?: number;
}

export interface GameState {
  phase: Phase;
  message: string;
  log: string[];
  result: string[];
  handNumber: number;
  scores: Record<PlayerKey, number>;
  pegPositions: Record<PlayerKey, [number | string, number | string]>;
  dealer: string;
  firstDealer: string;
  cribOwner: string;
  turn: string | null;
  count: number;
  turnCard: SerializedCard | null;
  plays: SerializedCard[];
  completedPlays: SerializedCard[][];
  peggingResetPending: boolean;
  humanHand: SerializedCard[];
  aiHandCount: number;
  humanTable: SerializedCard[];
  aiTable: SerializedCard[];
  legalCardIds: number[];
  canGo: boolean;
  scoring: {
    stage: "pone" | "dealer" | "crib";
    title: string;
    owner: string;
    cards: SerializedCard[];
    points: number;
    components: AnalyticsScoreComponents;
    nextLabel: string;
  } | null;
  cutForDeal: {
    human: SerializedCard | null;
    ai: SerializedCard | null;
    prompt: string;
  } | null;
  analyticsEvents: AnalyticsEvent[];
}

type ScoringReview = NonNullable<GameState["scoring"]> & { rawCards: Card[] };

export type AnalyticsRole = "dealer" | "pone";
export type AnalyticsScoreCategory = "pegging" | "hand" | "crib";
export type AnalyticsGameResult = "regular" | "skunk" | "double-skunk";
export interface AnalyticsDecisionReview {
  model: Opponent;
  selected: string[];
  recommended: string[];
  selectedEv: number;
  recommendedEv: number;
  delta: number;
  selectedWinProbability?: number;
  recommendedWinProbability?: number;
  winProbabilityDelta?: number;
  components?: {
    selected: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
    recommended: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
    delta: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
  };
}
export type AnalyticsEvComponents = Record<string, number>;
export type AnalyticsEvent =
  | {
      id: string;
      at: string;
      type: "game";
      action: "start" | "end";
      gameId: string;
      opponent: StoredOpponent;
      winner?: PlayerKey;
      loser?: PlayerKey;
      result?: AnalyticsGameResult;
      finalScores?: Record<PlayerKey, number>;
    }
  | {
      id: string;
      at: string;
      type: "hand";
      action: "start" | "end";
      gameId: string;
      handNumber: number;
      dealer: PlayerKey;
      pone: PlayerKey;
      turnCard?: string;
      dealtHands?: Record<PlayerKey, string[]>;
      crib?: string[];
      tables?: Record<PlayerKey, string[]>;
      scores: Record<PlayerKey, number>;
    }
  | {
      id: string;
      at: string;
      type: "discard";
      gameId: string;
      handNumber: number;
      player: PlayerKey;
      role: AnalyticsRole;
      cards: string[];
      cribOwner: PlayerKey;
      cribAfterDiscard: string[];
      remainingHand: string[];
      handBeforeDiscard?: string[];
      scores?: Record<PlayerKey, number>;
      dealer?: PlayerKey;
      model?: Opponent;
      selectedEv?: number;
      selectedEvComponents?: AnalyticsEvComponents;
      review?: AnalyticsDecisionReview;
    }
  | {
      id: string;
      at: string;
      type: "pegging";
      action: "play" | "go" | "reset" | "analysis";
      gameId: string;
      handNumber: number;
      player?: PlayerKey;
      role?: AnalyticsRole;
      card?: string;
      hand?: string[];
      playedCards?: string[];
      completedPlayGroups?: string[][];
      cutCard?: string;
      countBefore?: number;
      scoresBefore?: Record<PlayerKey, number>;
      count: number;
      points?: number;
      scores?: Record<PlayerKey, number>;
      message: string;
      model?: Opponent;
      selectedEv?: number;
      selectedEvComponents?: AnalyticsEvComponents;
      scoreComponents?: AnalyticsScoreComponents;
      review?: AnalyticsDecisionReview;
      durationMs?: number;
    }
  | {
      id: string;
      at: string;
      type: "score";
      gameId: string;
      handNumber: number;
      player: PlayerKey;
      role: AnalyticsRole;
      category: AnalyticsScoreCategory;
      points: number;
      reason: string;
      totalScore: number;
      scores: Record<PlayerKey, number>;
      cards: string[];
      turnCard?: string;
      card?: string;
      count?: number;
      scoreComponents?: AnalyticsScoreComponents;
    };
type NewAnalyticsEvent = AnalyticsEvent extends infer Event
  ? Event extends AnalyticsEvent
    ? Omit<Event, "id" | "at" | "gameId">
    : never
  : never;

interface PlayerSnapshot {
  hand: number[];
  table: number[];
  crib: number[];
  score: number;
}

export interface GameSnapshot {
  version: 1;
  gameId?: string;
  analyticsCounter?: number;
  analyticsEvents?: AnalyticsEvent[];
  opponent: StoredOpponent;
  deal: 0 | 1;
  firstDeal: 0 | 1;
  handNumber?: number;
  human: PlayerSnapshot;
  ai: PlayerSnapshot;
  turnCard: number;
  crib: number[];
  cutDeck?: number[];
  cutCards?: {
    human?: number | null;
    ai?: number | null;
  };
  plays: number[];
  playOwners: PlayerKey[];
  completedPlays: number[][];
  completedPlayOwners: PlayerKey[][];
  peggingResetPending?: boolean;
  count: number;
  turn: 0 | 1;
  goPlayer: PlayerKey | null;
  lastPlayer: PlayerKey | null;
  scoringReview: {
    stage: "pone" | "dealer" | "crib";
    title: string;
    owner: string;
    rawCards: number[];
    points: number;
    components?: AnalyticsScoreComponents;
    nextLabel: string;
  } | null;
  phase: Phase;
  message: string;
  log: string[];
  result: string[];
  pegPositions: Record<PlayerKey, [number | string, number | string]>;
  pegTableLeads?: Record<PlayerKey, number | null>;
  pendingPeggingReviews?: PendingPeggingReview[];
}

interface PendingPeggingReview {
  eventId: string;
  player: PlayerKey;
  cardId: number;
  snapshot: GameSnapshot;
}

export function cardFromString(input: string): Card {
  const rankText = input.slice(0, -1);
  const suitText = input.slice(-1);
  const rank = RANKS.indexOf(rankText);
  const suit = SUIT_ASCII.indexOf(suitText);
  if (rank === -1 || suit === -1) throw new Error(`Unknown card: ${input}`);
  return new Card(suit * 13 + rank);
}

export function cardsFromString(input: string): Card[] {
  return input.trim().split(/\s+/).filter(Boolean).map(cardFromString);
}

const handScoreCache = new Map<string, number>();

function shouldLogScoreComponents(): boolean {
  return (globalThis as { __CRIBBAGE_LOG_SCORE_COMPONENTS?: boolean }).__CRIBBAGE_LOG_SCORE_COMPONENTS === true;
}

export function scoreHand(hand: Card[], turnCard: Card, crib = false): number {
  const key = `${crib ? "crib" : "hand"}:${[...hand, turnCard]
    .map((card) => card.id)
    .sort((a, b) => a - b)
    .join(",")}`;
  const cached = handScoreCache.get(key);
  if (cached !== undefined) return cached;
  const score = (
    scoreFifteens(hand, turnCard) +
    scoreSets(hand, turnCard) +
    scoreRuns(hand, turnCard) +
    scoreFlushAndRightJack(hand, turnCard, crib)
  );
  handScoreCache.set(key, score);
  return score;
}

export function scoreHandComponents(hand: Card[], turnCard: Card, crib = false): AnalyticsScoreComponents {
  const fifteens = scoreFifteens(hand, turnCard);
  const pairs = scoreSets(hand, turnCard);
  const runs = scoreRuns(hand, turnCard);
  let flush = 0;
  let knobs = 0;
  for (const card of hand) {
    if (card.rankStr === "J" && card.suit === turnCard.suit) knobs += 1;
  }
  const handSuits = new Set(hand.map((card) => card.suit));
  if (handSuits.size === 1) {
    const suit = hand[0]?.suit;
    if (suit === turnCard.suit) flush = 5;
    else if (!crib) flush = 4;
  }
  return {
    total: fifteens + pairs + runs + flush + knobs,
    fifteens,
    pairs,
    runs,
    flush,
    knobs,
  };
}

export function scoreFifteens(hand: Card[], turnCard: Card): number {
  let points = 0;
  for (const combo of combinations([...hand, turnCard], 2, 5)) {
    if (combo.reduce((total, card) => total + card.value, 0) === 15) points += 2;
  }
  return points;
}

export function scoreSets(hand: Card[], turnCard: Card): number {
  let points = 0;
  const cards = [...hand, turnCard];
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      if (cards[i].rank === cards[j].rank) points += 2;
    }
  }
  return points;
}

export function scoreRuns(hand: Card[], turnCard: Card): number {
  const counts = new Map<number, number>();
  for (const card of [...hand, turnCard]) {
    counts.set(card.runVal, (counts.get(card.runVal) ?? 0) + 1);
  }

  const runs: number[][] = [];
  let run: number[] = [];
  for (const value of [...counts.keys()].sort((a, b) => a - b)) {
    if (run.length === 0 || value === run[run.length - 1] + 1) {
      run.push(value);
    } else {
      if (run.length >= 3) runs.push(run);
      run = [value];
    }
  }
  if (run.length >= 3) runs.push(run);
  if (runs.length === 0) return 0;

  const longest = runs.reduce((best, candidate) =>
    candidate.length > best.length ? candidate : best,
  );
  return longest.length * longest.reduce((product, value) => product * (counts.get(value) ?? 1), 1);
}

export function scoreFlushAndRightJack(hand: Card[], turnCard: Card, crib = false): number {
  let points = 0;
  for (const card of hand) {
    if (card.rankStr === "J" && card.suit === turnCard.suit) points += 1;
  }
  const handSuits = new Set(hand.map((card) => card.suit));
  if (handSuits.size === 1) {
    const suit = hand[0]?.suit;
    if (suit === turnCard.suit) points += 5;
    else if (!crib) points += 4;
  }
  return points;
}

export function scoreCount(plays: Card[]): number {
  return scoreCountComponents(plays).total;
}

export function scoreCountComponents(plays: Card[]): AnalyticsScoreComponents {
  const components: AnalyticsScoreComponents = { total: 0, fifteens: 0, thirtyOne: 0, pairs: 0, runs: 0 };
  if (plays.length < 2) return components;
  const count = plays.reduce((total, card) => total + card.value, 0);
  if (count === 15) components.fifteens = 2;
  if (count === 31) components.thirtyOne = 2;

  let sameRankCount = 1;
  for (let i = plays.length - 2; i >= 0; i -= 1) {
    if (plays[i].rank !== plays[plays.length - 1].rank) break;
    sameRankCount += 1;
  }
  components.pairs = new Map([
    [2, 2],
    [3, 6],
    [4, 12],
  ]).get(sameRankCount) ?? 0;

  for (let runLen = plays.length; runLen >= 3; runLen -= 1) {
    const vals = plays.slice(-runLen).map((card) => card.runVal);
    const unique = new Set(vals);
    const sorted = [...vals].sort((a, b) => a - b);
    if (
      unique.size === runLen &&
      sorted[sorted.length - 1] - sorted[0] + 1 === runLen
    ) {
      components.runs = runLen;
      break;
    }
  }
  components.total = (components.fifteens ?? 0) +
    (components.thirtyOne ?? 0) +
    (components.pairs ?? 0) +
    (components.runs ?? 0);
  return components;
}

export class CribbageGame {
  human: PlayerState;
  ai: PlayerState;
  opponent: StoredOpponent;
  playerEngines: Record<PlayerKey, Opponent>;
  deal: 0 | 1;
  firstDeal: 0 | 1;
  dealer!: PlayerState;
  pone!: PlayerState;
  turnCard!: Card;
  cutDeck: Card[] = [];
  cutCards: Partial<Record<PlayerKey, Card | null>> = {};
  crib: Card[] = [];
  plays: Card[] = [];
  playOwners: PlayerKey[] = [];
  completedPlays: Card[][] = [];
  completedPlayOwners: PlayerKey[][] = [];
  handNumber = 1;
  count = 0;
  turn: 0 | 1 = 0;
  goPlayer: PlayerState | null = null;
  lastPlayer: PlayerState | null = null;
  peggingResetPending = false;
  scoringReview: ScoringReview | null = null;
  phase: Phase = "discard";
  message = "";
  log: string[] = [];
  result: string[] = [];
  gameId = createAnalyticsId("game");
  analyticsCounter = 0;
  analyticsEvents: AnalyticsEvent[] = [];
  pegPositions: Record<PlayerKey, [number | string, number | string]> = {
    human: ["start-back", "start-front"],
    ai: ["start-back", "start-front"],
  };
  pegTableLeads: Record<PlayerKey, number | null> = {
    human: null,
    ai: null,
  };
  pegDecisionEvs: Record<PlayerKey, { cardId: number; model: Opponent; ev: number } | null> = {
    human: null,
    ai: null,
  };
  pendingPeggingReviews: PendingPeggingReview[] = [];

  constructor(
    opponent: StoredOpponent = DEFAULT_OPPONENT,
    humanEngine: StoredOpponent = opponent,
    options: { dealMode?: "random" | "cut" } = {},
  ) {
    this.opponent = normalizeOpponent(opponent);
    this.playerEngines = {
      human: normalizeOpponent(humanEngine),
      ai: this.opponent,
    };
    this.human = { key: "human", name: "User", hand: [], table: [], crib: [], score: 0 };
    this.ai = { key: "ai", name: "AI", hand: [], table: [], crib: [], score: 0 };
    this.deal = Math.random() < 0.5 ? 0 : 1;
    this.firstDeal = this.deal;
    this.turnCard = new Card(0);
    this.recordAnalytics({
      type: "game",
      action: "start",
      opponent: this.opponent,
    });
    if (options.dealMode === "cut") this.startDealCut();
    else this.startHand();
  }

  static restore(snapshot: GameSnapshot): CribbageGame {
    if (snapshot.version !== 1) throw new Error("Unsupported saved game version.");
    const game = new CribbageGame();
    game.gameId = snapshot.gameId ?? createAnalyticsId("game");
    game.analyticsCounter = snapshot.analyticsCounter ?? 0;
    game.analyticsEvents = snapshot.analyticsEvents ? [...snapshot.analyticsEvents] : [];
    game.opponent = normalizeOpponent(snapshot.opponent);
    game.playerEngines = {
      human: game.opponent,
      ai: game.opponent,
    };
    game.deal = snapshot.deal;
    game.firstDeal = snapshot.firstDeal;
    game.cutDeck = (snapshot.cutDeck ?? []).map((id) => new Card(id));
    game.cutCards = {
      human: snapshot.cutCards?.human === undefined || snapshot.cutCards.human === null ? null : new Card(snapshot.cutCards.human),
      ai: snapshot.cutCards?.ai === undefined || snapshot.cutCards.ai === null ? null : new Card(snapshot.cutCards.ai),
    };
    game.human.hand = snapshot.human.hand.map((id) => new Card(id));
    game.human.table = snapshot.human.table.map((id) => new Card(id));
    game.human.crib = snapshot.human.crib.map((id) => new Card(id));
    game.human.score = snapshot.human.score;
    game.ai.hand = snapshot.ai.hand.map((id) => new Card(id));
    game.ai.table = snapshot.ai.table.map((id) => new Card(id));
    game.ai.crib = snapshot.ai.crib.map((id) => new Card(id));
    game.ai.score = snapshot.ai.score;
    game.handNumber = Math.max(snapshot.handNumber ?? 1, game.inferHandNumber(snapshot.phase));
    game.dealer = [game.human, game.ai][game.deal];
    game.pone = [game.human, game.ai][game.deal ^ 1];
    game.turnCard = new Card(snapshot.turnCard);
    game.crib = snapshot.crib.map((id) => new Card(id));
    game.plays = snapshot.plays.map((id) => new Card(id));
    game.playOwners = [...snapshot.playOwners];
    game.completedPlays = snapshot.completedPlays.map((group) => group.map((id) => new Card(id)));
    game.completedPlayOwners = snapshot.completedPlayOwners.map((group) => [...group]);
    game.peggingResetPending = snapshot.peggingResetPending ?? false;
    game.count = snapshot.count;
    game.turn = snapshot.turn;
    game.goPlayer = snapshot.goPlayer ? game.playerByKey(snapshot.goPlayer) : null;
    game.lastPlayer = snapshot.lastPlayer ? game.playerByKey(snapshot.lastPlayer) : null;
    game.scoringReview = snapshot.scoringReview
      ? {
          stage: snapshot.scoringReview.stage,
          title: snapshot.scoringReview.title,
          owner: snapshot.scoringReview.owner,
          rawCards: snapshot.scoringReview.rawCards.map((id) => new Card(id)),
          cards: snapshot.scoringReview.rawCards.map((id) => game.serializeCard(new Card(id))),
          points: snapshot.scoringReview.points,
          components: snapshot.scoringReview.components ??
            scoreHandComponents(
              snapshot.scoringReview.rawCards.map((id) => new Card(id)),
              new Card(snapshot.turnCard),
              snapshot.scoringReview.stage === "crib",
            ),
          nextLabel: snapshot.scoringReview.nextLabel,
        }
      : null;
    game.phase = snapshot.phase;
    game.message = snapshot.message;
    game.log = [...snapshot.log];
    game.result = [...snapshot.result];
    game.pegPositions = {
      human: [...snapshot.pegPositions.human],
      ai: [...snapshot.pegPositions.ai],
    };
    game.pegTableLeads = {
      human: snapshot.pegTableLeads?.human ?? null,
      ai: snapshot.pegTableLeads?.ai ?? null,
    };
    game.pendingPeggingReviews = [...snapshot.pendingPeggingReviews ?? []];
    return game;
  }

  snapshot(): GameSnapshot {
    return {
      version: 1,
      gameId: this.gameId,
      analyticsCounter: this.analyticsCounter,
      analyticsEvents: [...this.analyticsEvents],
      opponent: this.opponent,
      deal: this.deal,
      firstDeal: this.firstDeal,
      handNumber: this.handNumber,
      human: this.playerSnapshot(this.human),
      ai: this.playerSnapshot(this.ai),
      turnCard: this.turnCard.id,
      crib: this.crib.map((card) => card.id),
      cutDeck: this.cutDeck.map((card) => card.id),
      cutCards: {
        human: this.cutCards.human?.id ?? null,
        ai: this.cutCards.ai?.id ?? null,
      },
      plays: this.plays.map((card) => card.id),
      playOwners: [...this.playOwners],
      completedPlays: this.completedPlays.map((group) => group.map((card) => card.id)),
      completedPlayOwners: this.completedPlayOwners.map((group) => [...group]),
      peggingResetPending: this.peggingResetPending,
      count: this.count,
      turn: this.turn,
      goPlayer: this.goPlayer?.key ?? null,
      lastPlayer: this.lastPlayer?.key ?? null,
      scoringReview: this.scoringReview
        ? {
            stage: this.scoringReview.stage,
            title: this.scoringReview.title,
            owner: this.scoringReview.owner,
            rawCards: this.scoringReview.rawCards.map((card) => card.id),
            points: this.scoringReview.points,
            components: this.scoringReview.components,
            nextLabel: this.scoringReview.nextLabel,
          }
        : null,
      phase: this.phase,
      message: this.message,
      log: [...this.log],
      result: [...this.result],
      pegPositions: {
        human: [...this.pegPositions.human],
        ai: [...this.pegPositions.ai],
      },
      pegTableLeads: { ...this.pegTableLeads },
      pendingPeggingReviews: [...this.pendingPeggingReviews],
    };
  }

  private reviewSnapshot(): GameSnapshot {
    return {
      ...this.snapshot(),
      analyticsEvents: [],
      pendingPeggingReviews: [],
    };
  }

  startHand(): void {
    this.dealer = [this.human, this.ai][this.deal];
    this.pone = [this.human, this.ai][this.deal ^ 1];
    const deck = shuffledDeck();
    this.dealer.hand = deck.splice(0, 6);
    this.pone.hand = deck.splice(0, 6);
    this.dealer.table = [];
    this.pone.table = [];
    this.dealer.crib = [];
    this.pone.crib = [];
    this.turnCard = deck.shift()!;
    this.crib = [];
    this.plays = [];
    this.playOwners = [];
    this.completedPlays = [];
    this.completedPlayOwners = [];
    this.count = 0;
    this.turn = 0;
    this.goPlayer = null;
    this.lastPlayer = null;
    this.peggingResetPending = false;
    this.pegTableLeads = { human: null, ai: null };
    this.scoringReview = null;
    this.phase = "discard";
    this.recordAnalytics({
      type: "hand",
      action: "start",
      handNumber: this.handNumber,
      dealer: this.dealer.key,
      pone: this.pone.key,
      turnCard: this.cardLabel(this.turnCard),
      dealtHands: {
        human: this.cardLabels(this.human.hand),
        ai: this.cardLabels(this.ai.hand),
      },
      scores: { human: this.human.score, ai: this.ai.score },
    });
  }

  startDealCut(): void {
    this.phase = "cut_for_deal";
    this.cutDeck = shuffledDeck();
    this.cutCards = { human: null, ai: null };
    this.human.hand = [];
    this.ai.hand = [];
    this.human.table = [];
    this.ai.table = [];
    this.human.crib = [];
    this.ai.crib = [];
    this.crib = [];
    this.plays = [];
    this.playOwners = [];
    this.completedPlays = [];
    this.completedPlayOwners = [];
    this.count = 0;
    this.turn = 0;
    this.goPlayer = null;
    this.lastPlayer = null;
    this.peggingResetPending = false;
    this.scoringReview = null;
    this.message = "Tap the deck to cut for first deal. Low card deals.";
    this.log = [this.message];
    this.result = [this.message];
  }

  cutForDeal(): void {
    if (this.phase !== "cut_for_deal") throw new Error("It is not time to cut for deal.");
    if (this.cutDeck.length < 2) this.cutDeck = shuffledDeck();
    const humanCut = this.cutDeck.shift()!;
    const aiCut = this.cutDeck.shift()!;
    this.cutCards = { human: humanCut, ai: aiCut };
    if (humanCut.rank === aiCut.rank) {
      this.message = `User cut ${this.cardLabel(humanCut)}. AI cut ${this.cardLabel(aiCut)}. Tie. Tap to cut again.`;
      this.logEvent(this.message);
      this.cutDeck = shuffledDeck();
      return;
    }
    this.deal = humanCut.rank < aiCut.rank ? 0 : 1;
    this.firstDeal = this.deal;
    this.message = `User cut ${this.cardLabel(humanCut)}. AI cut ${this.cardLabel(aiCut)}. ${this.name([this.human, this.ai][this.deal])} deals first.`;
    this.logEvent(this.message);
    this.startHand();
  }

  startTroublePeggingPosition(): void {
    this.opponent = "schell_table-peg_table-13.0";
    this.playerEngines = { human: "schell_table-peg_table-13.0", ai: "schell_table-peg_table-13.0" };
    this.deal = 1;
    this.firstDeal = 1;
    this.dealer = this.ai;
    this.pone = this.human;
    this.handNumber = 1;
    this.human.score = 72;
    this.ai.score = 72;
    this.human.hand = [new Card(0), new Card(4), new Card(6), new Card(12)];
    this.ai.hand = [new Card(14), new Card(15), new Card(28), new Card(16)];
    this.human.table = [];
    this.ai.table = [];
    this.crib = [new Card(8), new Card(21), new Card(34), new Card(47)];
    this.dealer.crib = [...this.crib];
    this.pone.crib = [];
    this.turnCard = new Card(44);
    this.plays = [];
    this.playOwners = [];
    this.completedPlays = [];
    this.completedPlayOwners = [];
    this.count = 0;
    this.turn = 0;
    this.goPlayer = null;
    this.lastPlayer = null;
    this.phase = "pegging";
    this.message = "";
    this.log = [];
    this.result = [];
    this.pegPositions = { human: [71, 72], ai: [71, 72] };
    this.pegTableLeads = { human: null, ai: null };
    this.pendingPeggingReviews = [];
    this.recordAnalytics({
      type: "hand",
      action: "start",
      handNumber: this.handNumber,
      dealer: this.dealer.key,
      pone: this.pone.key,
      turnCard: this.cardLabel(this.turnCard),
      dealtHands: {
        human: this.cardLabels(this.human.hand),
        ai: this.cardLabels(this.ai.hand),
      },
      scores: { human: this.human.score, ai: this.ai.score },
    });
    this.logEvent("Trouble game: User turn.");
  }

  state(): GameState {
    const current = this.phase === "pegging" ? this.currentPlayer() : null;
    const legalIds = new Set(this.legalCards(this.human).map((card) => card.id));
    const humanHand = this.phase === "discard" ? sortedCards(this.human.hand) : this.human.hand;
    return {
      phase: this.phase,
      message: this.message,
      log: this.log,
      result: this.result,
      handNumber: this.handNumber,
      scores: { human: this.human.score, ai: this.ai.score },
      pegPositions: this.pegPositions,
      dealer: this.phase === "cut_for_deal" ? "-" : this.name(this.dealer),
      firstDealer: this.phase === "cut_for_deal" ? "-" : this.name([this.human, this.ai][this.firstDeal]),
      cribOwner: this.phase === "cut_for_deal" ? "-" : this.name(this.dealer),
      turn: current ? this.name(current) : null,
      count: this.count,
      turnCard: this.phase === "cut_for_deal" || this.phase === "discard" || this.phase === "ai_discarding"
        ? null
        : this.serializeCard(this.turnCard),
      plays: this.plays.map((card, index) => this.serializeCard(card, null, this.playOwners[index])),
      completedPlays: this.completedPlays.map((group, groupIndex) =>
        group.map((card, cardIndex) =>
          this.serializeCard(card, null, this.completedPlayOwners[groupIndex]?.[cardIndex]),
        ),
      ),
      peggingResetPending: this.peggingResetPending,
      humanHand: humanHand.map((card, index) => this.serializeCard(card, index)),
      aiHandCount: this.ai.hand.length,
      humanTable: this.human.table.map((card) => this.serializeCard(card)),
      aiTable: this.ai.table.map((card) => this.serializeCard(card)),
      legalCardIds: [...legalIds],
      canGo: this.phase === "pegging" && current === this.human && legalIds.size === 0,
      scoring: this.scoringReview
        ? {
            stage: this.scoringReview.stage,
            title: this.scoringReview.title,
            owner: this.scoringReview.owner,
            cards: this.scoringReview.rawCards.map((card) => this.serializeCard(card)),
            points: this.scoringReview.points,
            components: this.scoringReview.components,
            nextLabel: this.scoringReview.nextLabel,
          }
        : null,
      cutForDeal: this.phase === "cut_for_deal"
        ? {
            human: this.cutCards.human ? this.serializeCard(this.cutCards.human) : null,
            ai: this.cutCards.ai ? this.serializeCard(this.cutCards.ai) : null,
            prompt: this.message || "Tap the deck to cut for first deal. Low card deals.",
          }
        : null,
      analyticsEvents: [...this.analyticsEvents],
    };
  }

  discard(ids: number[]): void {
    this.beginInteraction();
    if (this.phase !== "discard") throw new Error("It is not discard time.");
    const discards = this.selectedCards(sortedCards(this.human.hand), ids, 2);
    const handBeforeDiscard = [...this.human.hand];
    removeCards(this.human.hand, discards);
    this.crib.push(...discards);
    this.recordDiscard(this.human, discards, handBeforeDiscard);
    this.logEvent("User discarded two cards to the crib.");
    if (this.ai.hand.length === 6) {
      this.phase = "ai_discarding";
      this.logEvent("Waiting for AI to discard.");
      return;
    }
    this.beginPegging();
  }

  finishDiscard(): void {
    if (this.phase !== "ai_discarding") throw new Error("AI is not waiting to discard.");
    this.aiDiscard();
    this.beginPegging();
  }

  recommendAiDiscard(): { cards: SerializedCard[]; cardIds: number[] } {
    if (this.phase !== "ai_discarding") throw new Error("AI is not waiting to discard.");
    const discards = this.chooseDiscards(this.ai, this.dealer === this.ai);
    return {
      cards: discards.map((card) => this.serializeCard(card)),
      cardIds: discards.map((card) => card.id),
    };
  }

  finishDiscardWithAiCards(ids: number[]): void {
    if (this.phase !== "ai_discarding") throw new Error("AI is not waiting to discard.");
    const handBeforeDiscard = [...this.ai.hand];
    const discards = this.selectedCards(this.ai.hand, ids, 2);
    removeCards(this.ai.hand, discards);
    this.crib.push(...discards);
    this.recordDiscard(this.ai, discards, handBeforeDiscard);
    this.logEvent("AI discarded two cards to the crib.");
    this.beginPegging();
  }

  play(cardId: number): void {
    this.beginInteraction();
    if (this.peggingResetPending) throw new Error("Acknowledge the pegging reset before continuing.");
    if (this.phase !== "pegging" || this.currentPlayer() !== this.human) {
      throw new Error("It is not your turn to play.");
    }
    const legal = this.legalCards(this.human);
    if (legal.length === 0) {
      this.sayGo(this.human);
      this.advanceUntilHuman();
      return;
    }
    const card = this.selectedCards(this.human.hand, [cardId], 1)[0];
    if (!legal.includes(card)) throw new Error("That card would take the count over 31.");
    this.playCard(this.human, card, true);
    this.advanceUntilHuman();
  }

  playHumanPeggingCard(cardId: number): void {
    this.beginInteraction();
    if (this.peggingResetPending) throw new Error("Acknowledge the pegging reset before continuing.");
    if (this.phase !== "pegging" || this.currentPlayer() !== this.human) {
      throw new Error("It is not your turn to play.");
    }
    const legal = this.legalCards(this.human);
    if (legal.length === 0) {
      this.sayGo(this.human);
      return;
    }
    const card = this.selectedCards(this.human.hand, [cardId], 1)[0];
    if (!legal.includes(card)) throw new Error("That card would take the count over 31.");
    this.playCard(this.human, card, true);
  }

  go(): void {
    this.beginInteraction();
    if (this.peggingResetPending) throw new Error("Acknowledge the pegging reset before continuing.");
    if (this.phase !== "pegging" || this.currentPlayer() !== this.human) {
      throw new Error("It is not your turn.");
    }
    if (this.legalCards(this.human).length > 0) throw new Error("User has a legal card to play.");
    this.sayGo(this.human);
    this.advanceUntilHuman();
  }

  humanPeggingGo(): void {
    if (this.peggingResetPending) throw new Error("Acknowledge the pegging reset before continuing.");
    if (this.phase !== "pegging" || this.currentPlayer() !== this.human) {
      throw new Error("It is not your turn.");
    }
    if (this.legalCards(this.human).length > 0) throw new Error("User has a legal card to play.");
    this.sayGo(this.human);
  }

  advancePeggingToHuman(): void {
    this.advanceUntilHuman();
  }

  acknowledgePeggingReset(): void {
    if (!this.peggingResetPending) return;
    this.peggingResetPending = false;
    this.clearCurrentPeggingSeries();
    this.otherTurn();
    this.completePeggingIfNoCards();
  }

  recommendAiPeggingAction(): { action: "go" } | { action: "play"; card: SerializedCard; cardId: number; ev?: number } {
    if (this.phase !== "pegging" || this.currentPlayer() !== this.ai) {
      throw new Error("It is not AI's turn to play.");
    }
    const legal = this.legalCards(this.ai);
    if (!legal.length) return { action: "go" };
    const card = this.choosePlay(this.ai);
    const decision = this.pegDecisionEvs.ai;
    return {
      action: "play",
      card: this.serializeCard(card),
      cardId: card.id,
      ev: decision?.cardId === card.id ? decision.ev : undefined,
    };
  }

  playAiPeggingCard(cardId: number): void {
    if (this.peggingResetPending) throw new Error("Acknowledge the pegging reset before continuing.");
    if (this.phase !== "pegging" || this.currentPlayer() !== this.ai) {
      throw new Error("It is not AI's turn to play.");
    }
    const legal = this.legalCards(this.ai);
    if (!legal.length) {
      this.sayGo(this.ai);
      return;
    }
    const card = this.selectedCards(this.ai.hand, [cardId], 1)[0];
    if (!legal.includes(card)) throw new Error("That card would take the count over 31.");
    this.playCard(this.ai, card);
  }

  aiPeggingGo(): void {
    if (this.peggingResetPending) throw new Error("Acknowledge the pegging reset before continuing.");
    if (this.phase !== "pegging" || this.currentPlayer() !== this.ai) {
      throw new Error("It is not AI's turn.");
    }
    if (this.legalCards(this.ai).length > 0) throw new Error("AI has a legal card to play.");
    this.sayGo(this.ai);
  }

  prepareModel13Pegging(): void {
    const engine = normalizeOpponent(this.opponent);
    if (!usesModel13LivePegging(engine) || this.phase !== "pegging") return;
    if (this.currentPlayer() === this.ai) {
      if (
        engine === "schell_table-peg_table-14.0" &&
        this.ai === this.pone &&
        this.turn === 0 &&
        this.count === 0 &&
        this.plays.length === 0 &&
        this.ai.hand.length === 4
      ) {
        return;
      }
      const legal = this.legalCards(this.ai);
      if (legal.length) this.chooseExhaustivePegPlay(this.ai, legal);
      return;
    }
    if (
      this.dealer !== this.ai ||
      this.turn !== 0 ||
      this.count !== 0 ||
      this.plays.length !== 0 ||
      this.human.hand.length !== 4
    ) {
      return;
    }
    for (const lead of orderedModel13PoneLeadCards(this.human.hand, this.legalCards(this.human), engine)) {
      const warmGame = CribbageGame.restore(this.snapshot());
      try {
        warmGame.playHumanPeggingCard(lead.id);
        if (warmGame.phase !== "pegging" || warmGame.currentPlayer() !== warmGame.ai) continue;
        const legal = warmGame.legalCards(warmGame.ai);
        if (legal.length) warmGame.chooseExhaustivePegPlay(warmGame.ai, legal);
      } catch {
        continue;
      }
    }
  }

  recordAiPeggingThinkTime(durationMs: number): void {
    if (durationMs < 1) return;
    this.recordAnalytics({
      type: "pegging",
      action: "analysis",
      handNumber: this.handNumber,
      player: "ai",
      role: this.roleFor(this.ai),
      count: this.count,
      scores: { human: this.human.score, ai: this.ai.score },
      message: `AI pegging analysis took ${Math.round(durationMs)} ms.`,
      model: this.playerEngines.ai,
      durationMs: Math.round(durationMs),
    });
  }

  completePendingDecisionReviews(): number {
    let completed = 0;
    const remaining: PendingPeggingReview[] = [];
    for (const pending of this.pendingPeggingReviews) {
      const event = this.analyticsEvents.find((candidate) => candidate.id === pending.eventId);
      if (!event || event.type !== "pegging" || event.action !== "play") continue;
      try {
        const reviewGame = CribbageGame.restore(pending.snapshot);
        const player = reviewGame.playerByKey(pending.player);
        event.review = reviewGame.reviewPegPlay(player, new Card(pending.cardId));
        completed += 1;
      } catch {
        remaining.push(pending);
      }
    }
    this.pendingPeggingReviews = remaining;
    return completed;
  }

  autoPlayToEnd(maxHands = 200): void {
    let guard = 0;
    while (this.phase !== "game_over") {
      guard += 1;
      if (guard > maxHands * 16) throw new Error("Autoplay exceeded expected game length.");
      try {
        if (this.phase === "discard") {
          this.autoDiscardHuman();
        } else if (this.phase === "ai_discarding") {
          this.finishDiscard();
        } else if (this.phase === "pegging") {
          if (this.peggingResetPending) this.acknowledgePeggingReset();
          this.autoPegging();
        } else if (
          this.phase === "pegging_complete" ||
          this.phase === "score_pone" ||
          this.phase === "score_dealer" ||
          this.phase === "score_crib"
        ) {
          this.continueScoring();
        } else {
          throw new Error(`Cannot autoplay phase: ${this.phase}`);
        }
      } catch (error) {
        if (error instanceof WinGame) return;
        throw error;
      }
    }
  }

  continueScoring(): void {
    this.beginInteraction();
    if (this.phase === "pegging_complete") {
      this.clearCurrentPeggingSeries();
      this.startScoring();
    }
    else if (this.phase === "score_pone") this.showScoreStage("dealer");
    else if (this.phase === "score_dealer") this.showScoreStage("crib");
    else if (this.phase === "score_crib") {
      this.recordAnalytics({
        type: "hand",
        action: "end",
        handNumber: this.handNumber,
        dealer: this.dealer.key,
        pone: this.pone.key,
        turnCard: this.cardLabel(this.turnCard),
        crib: this.cardLabels(this.dealer.crib),
        tables: {
          human: this.cardLabels(this.human.table),
          ai: this.cardLabels(this.ai.table),
        },
        scores: { human: this.human.score, ai: this.ai.score },
      });
      this.scoringReview = null;
      this.deal = (this.deal ^ 1) as 0 | 1;
      this.handNumber += 1;
      this.startHand();
    } else {
      throw new Error("There is no hand score to continue.");
    }
  }

  private playerSnapshot(player: PlayerState): PlayerSnapshot {
    return {
      hand: player.hand.map((card) => card.id),
      table: player.table.map((card) => card.id),
      crib: player.crib.map((card) => card.id),
      score: player.score,
    };
  }

  private playerByKey(key: PlayerKey): PlayerState {
    return key === "human" ? this.human : this.ai;
  }

  private inferHandNumber(phase: Phase): number {
    if (
      this.human.score > 0 &&
      this.ai.score > 0 &&
      ["discard", "ai_discarding", "pegging"].includes(phase)
    ) {
      return 2;
    }
    return 1;
  }

  private selectedCards(hand: Card[], ids: number[], expectedCount: number): Card[] {
    if (ids.length !== expectedCount) {
      throw new Error(`Choose exactly ${expectedCount} card${expectedCount === 1 ? "" : "s"}.`);
    }
    if (new Set(ids).size !== expectedCount) throw new Error("Card selection contains duplicates.");
    const byId = new Map(hand.map((card) => [card.id, card]));
    return ids.map((id) => {
      const card = byId.get(id);
      if (!card) throw new Error("Card selection is out of range.");
      return card;
    });
  }

  private aiDiscard(): void {
    const handBeforeDiscard = [...this.ai.hand];
    const discards = this.chooseDiscards(this.ai, this.dealer === this.ai);
    removeCards(this.ai.hand, discards);
    this.crib.push(...discards);
    this.recordDiscard(this.ai, discards, handBeforeDiscard);
    this.logEvent("AI discarded two cards to the crib.");
  }

  private autoDiscardHuman(): void {
    this.beginInteraction();
    if (this.phase !== "discard") throw new Error("It is not discard time.");
    const discards = this.chooseDiscards(this.human, this.dealer === this.human);
    const handBeforeDiscard = [...this.human.hand];
    removeCards(this.human.hand, discards);
    this.crib.push(...discards);
    this.recordDiscard(this.human, discards, handBeforeDiscard, false);
    this.logEvent("User discarded two cards to the crib.");
    if (this.ai.hand.length === 6) {
      this.phase = "ai_discarding";
      this.logEvent("Waiting for AI to discard.");
      return;
    }
    this.beginPegging();
  }

  private chooseDiscards(player: PlayerState, myCrib: boolean): Card[] {
    const engine = this.playerEngines[player.key];
    const analysis = analyzeDiscardChoice(player.hand, player.hand.slice(0, 2), myCrib, engine, { game: this, player });
    this.pegTableLeads[player.key] = analysis.recommendedPegTableLead;
    return analysis.recommended;
  }

  private beginPegging(): void {
    this.phase = "pegging";
    this.peggingResetPending = false;
    this.dealer.crib = [...this.crib];
    this.logEvent(`Turn card is ${this.cardLabel(this.turnCard)}.`);
    if (this.turnCard.rankStr === "J") {
      this.recordScore(
        this.dealer,
        "pegging",
        2,
        "his heels",
        this.turnCard,
        undefined,
        shouldLogScoreComponents() ? { total: 2, heels: 2 } : undefined,
      );
      this.peg(this.dealer, 2);
      this.logEvent(`${this.name(this.dealer)} pegged 2 for his heels.`);
    }
    this.advanceUntilHuman();
  }

  private advanceUntilHuman(): void {
    while (this.phase === "pegging") {
      if (this.peggingResetPending) return;
      if (this.dealer.hand.length + this.pone.hand.length === 0) {
        this.finishPegging();
        this.phase = "pegging_complete";
        return;
      }
      const player = this.currentPlayer();
      if (player === this.human) {
        if (this.legalCards(player).length === 0) {
          this.sayGo(player);
          continue;
        }
        this.logEvent("User turn.");
        return;
      }
      if (this.legalCards(player).length === 0) {
        this.sayGo(player);
        continue;
      }
      this.playCard(player, this.choosePlay(player));
    }
  }

  private autoPegging(): void {
    while (this.phase === "pegging") {
      if (this.peggingResetPending) return;
      if (this.dealer.hand.length + this.pone.hand.length === 0) {
        this.finishPegging();
        this.phase = "pegging_complete";
        return;
      }
      const player = this.currentPlayer();
      if (this.legalCards(player).length === 0) {
        this.sayGo(player);
        continue;
      }
      this.playCard(player, this.choosePlay(player));
    }
  }

  private finishPegging(): void {
    if (this.lastPlayer && this.count !== 0) {
      this.recordScore(
        this.lastPlayer,
        "pegging",
        1,
        "last card",
        undefined,
        this.count,
        shouldLogScoreComponents() ? { total: 1, lastCard: 1 } : undefined,
      );
      this.peg(this.lastPlayer, 1);
      this.logEvent(`${this.name(this.lastPlayer)} pegged 1 for last card.`);
    }
  }

  private completePeggingIfNoCards(): void {
    if (this.phase !== "pegging") return;
    if (this.dealer.hand.length + this.pone.hand.length !== 0) return;
    this.finishPegging();
    if (this.phase === "pegging") this.phase = "pegging_complete";
  }

  private choosePlay(player: PlayerState): Card {
    const legal = this.legalCards(player);
    const engine = this.playerEngines[player.key];
    const outcomeLead = choosePeggingOutcomeLead(this, player, legal, engine);
    if (outcomeLead) {
      this.pegDecisionEvs[player.key] = {
        cardId: outcomeLead.card.id,
        model: engine,
        ev: roundEv(outcomeLead.ev),
      };
      return outcomeLead.card;
    }
    const pegTableLead = choosePegTableLead(player.hand, legal, this.pegTableLeads[player.key], {
      engine,
      isPone: player === this.pone,
      count: this.count,
      plays: this.plays,
    });
    if (pegTableLead) {
      this.pegDecisionEvs[player.key] = {
        cardId: pegTableLead.id,
        model: engine,
        ev: roundEv(peggingPlayEv(this, player, pegTableLead, engine, this.pegTableLeads[player.key])),
      };
      return pegTableLead;
    }
    if (usesExhaustivePegging(engine)) {
      const decision = this.chooseExhaustivePegPlay(player, legal);
      this.pegDecisionEvs[player.key] = { cardId: decision.card.id, model: engine, ev: roundEv(decision.ev) };
      return decision.card;
    }
    const card = legal.reduce((best, candidate) => {
      const bestKey = [scoreCount([...this.plays, best]), best.runVal];
      const cardKey = [scoreCount([...this.plays, candidate]), candidate.runVal];
      return compareTuple(cardKey, bestKey) > 0 ? candidate : best;
    });
    this.pegDecisionEvs[player.key] = {
      cardId: card.id,
      model: engine,
      ev: roundEv(peggingPlayEv(this, player, card, engine, this.pegTableLeads[player.key])),
    };
    return card;
  }

  private chooseExhaustivePegPlay(player: PlayerState, legal: Card[]): { card: Card; ev: number } {
    const opponent = player === this.human ? this.ai : this.human;
    const engine = this.playerEngines[player.key];
    const cacheKey = usesModel13LivePegging(engine)
      ? model13PeggingDecisionCacheKey(this, player)
      : null;
    const cached = cacheKey ? MODEL13_PEGGING_DECISION_CACHE.get(cacheKey) : null;
    if (cached) {
      const cachedCard = legal.find((card) => card.id === cached.cardId);
      if (cachedCard) return { card: cachedCard, ev: cached.ev };
    }
    const knownCards = [
      ...player.hand,
      ...player.table,
      ...opponent.table,
      ...this.crib,
      this.turnCard,
    ];
    const rankCounts = remainingRankCounts(knownCards);
    const opponentHands = opponentRankHandsForEngine(
      rankCounts,
      opponent.hand.length,
      opponent,
      opponent === this.dealer ? "dealer" : "pone",
      engine,
    );
    let bestCard = legal[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const card of legal) {
      const decision = exhaustivePeggingCandidateScore(this, player, card, opponentHands, engine);
      const key = [decision.choiceScore, scoreCount([...this.plays, card]), card.runVal];
      const bestKey = [
        bestScore,
        scoreCount([...this.plays, bestCard]),
        bestCard.runVal,
      ];
      if (compareTuple(key, bestKey) > 0) {
        bestScore = decision.choiceScore;
        bestCard = card;
      }
    }
    const decision = {
      card: bestCard,
      ev: exhaustivePeggingPointEv(this, player, bestCard, opponentHands),
    };
    if (cacheKey) {
      MODEL13_PEGGING_DECISION_CACHE.set(cacheKey, { cardId: decision.card.id, ev: decision.ev });
      trimModel13PeggingDecisionCache();
    }
    return decision;
  }

  private playCard(player: PlayerState, card: Card, reviewDecision = false): void {
    const pendingReviewSnapshot = reviewDecision && player === this.human ? this.reviewSnapshot() : null;
    const engine = this.playerEngines[player.key];
    const pendingEv = this.pegDecisionEvs[player.key];
    const selectedEv = pendingEv?.cardId === card.id && pendingEv.model === engine
      ? pendingEv.ev
      : roundEv(peggingPlayEv(this, player, card, engine, this.pegTableLeads[player.key]));
    const selectedEvComponents = shouldLogScoreComponents()
      ? peggingPlayEvComponents(this, player, card, engine)
      : undefined;
    this.pegDecisionEvs[player.key] = null;
    const handBeforePlay = this.cardLabels(player.hand);
    const playedCardsBefore = this.cardLabels(this.plays);
    const completedPlayGroupsBefore = this.completedPlays.map((group) => this.cardLabels(group));
    const countBefore = this.count;
    const scoresBefore = { human: this.human.score, ai: this.ai.score };
    player.table.push(card);
    removeCards(player.hand, [card]);
    this.plays.push(card);
    this.playOwners.push(player.key);
    this.count += card.value;
    this.lastPlayer = player;
    const playScoreComponents = shouldLogScoreComponents() ? scoreCountComponents(this.plays) : undefined;
    const points = playScoreComponents?.total ?? scoreCount(this.plays);
    const scoreAfterPlay = points
      ? {
          human: this.human.score + (player === this.human ? points : 0),
          ai: this.ai.score + (player === this.ai ? points : 0),
        }
      : { human: this.human.score, ai: this.ai.score };
    const event = this.recordAnalytics({
      type: "pegging",
      action: "play",
      handNumber: this.handNumber,
      player: player.key,
      role: this.roleFor(player),
      card: this.cardLabel(card),
      hand: handBeforePlay,
      playedCards: playedCardsBefore,
      completedPlayGroups: completedPlayGroupsBefore,
      cutCard: this.cardLabel(this.turnCard),
      countBefore,
      scoresBefore,
      count: this.count,
      points,
      scores: scoreAfterPlay,
      message: `${this.name(player)} played ${this.cardLabel(card)}: ${this.count}`,
      model: engine,
      selectedEv,
      selectedEvComponents,
      scoreComponents: playScoreComponents,
    });
    if (pendingReviewSnapshot) {
      this.pendingPeggingReviews.push({
        eventId: event.id,
        player: player.key,
        cardId: card.id,
        snapshot: pendingReviewSnapshot,
      });
    }
    if (points) this.recordScore(player, "pegging", points, "count", card, this.count, playScoreComponents);
    if (points) this.peg(player, points);
    this.logEvent(
      `${this.name(player)} played ${this.cardLabel(card)}: ${this.count}` +
        (points ? ` and pegged ${points}.` : "."),
    );
    if (this.count === 31) {
      this.recordAnalytics({
        type: "pegging",
        action: "reset",
        handNumber: this.handNumber,
        count: this.count,
        scores: { human: this.human.score, ai: this.ai.score },
        message: "Count hit 31 and resets.",
      });
      this.logEvent("Count hit 31 and resets.");
      this.peggingResetPending = true;
    } else if (!this.goPlayer) {
      this.otherTurn();
    }
    if (!this.peggingResetPending) this.completePeggingIfNoCards();
  }

  private sayGo(player: PlayerState): void {
    if (this.goPlayer) {
      if (this.lastPlayer && this.count !== 31) {
        this.recordScore(
          this.lastPlayer,
          "pegging",
          1,
          "go",
          undefined,
          this.count,
          shouldLogScoreComponents() ? { total: 1, go: 1 } : undefined,
        );
        this.peg(this.lastPlayer, 1);
        this.logEvent(`${this.name(this.lastPlayer)} pegged 1 for go.`);
      }
      this.recordAnalytics({
        type: "pegging",
        action: "reset",
        handNumber: this.handNumber,
        count: this.count,
        scores: { human: this.human.score, ai: this.ai.score },
        message: "Count resets to 0.",
      });
      this.logEvent("Count resets to 0.");
      this.peggingResetPending = true;
    } else {
      this.goPlayer = player;
      this.recordAnalytics({
        type: "pegging",
        action: "go",
        handNumber: this.handNumber,
        player: player.key,
        role: this.roleFor(player),
        count: this.count,
        scores: { human: this.human.score, ai: this.ai.score },
        message: `${this.name(player)} says go.`,
      });
      this.logEvent(`${this.name(player)} says go.`);
      this.otherTurn();
    }
  }

  private startScoring(): void {
    this.showScoreStage("pone");
  }

  private showScoreStage(stage: "pone" | "dealer" | "crib"): void {
    let player: PlayerState;
    let cards: Card[];
    let points: number;
    let title: string;
    let nextLabel: string;
    let scoreComponents: AnalyticsScoreComponents;

    if (stage === "pone") {
      player = this.pone;
      cards = this.pone.table;
      scoreComponents = scoreHandComponents(cards, this.turnCard);
      points = scoreComponents.total;
      title = `${this.name(player)} hand`;
      nextLabel = "Show dealer hand";
      this.phase = "score_pone";
    } else if (stage === "dealer") {
      player = this.dealer;
      cards = this.dealer.table;
      scoreComponents = scoreHandComponents(cards, this.turnCard);
      points = scoreComponents.total;
      title = `${this.name(player)} hand`;
      nextLabel = "Show crib";
      this.phase = "score_dealer";
    } else {
      player = this.dealer;
      cards = this.dealer.crib;
      scoreComponents = scoreHandComponents(cards, this.turnCard, true);
      points = scoreComponents.total;
      title = `${this.name(player)} crib`;
      nextLabel = "Next hand";
      this.phase = "score_crib";
    }

    this.scoringReview = {
      stage,
      title,
      owner: this.name(player),
      rawCards: [...cards],
      cards: cards.map((card) => this.serializeCard(card)),
      points,
      components: scoreComponents,
      nextLabel,
    };
    this.recordScore(
      player,
      stage === "crib" ? "crib" : "hand",
      points,
      title,
      undefined,
      undefined,
      shouldLogScoreComponents() ? scoreComponents : undefined,
    );
    this.peg(player, points);
    this.logEvent(`${title} scored ${points}.`);
  }

  private legalCards(player: PlayerState): Card[] {
    return player.hand.filter((card) => this.count + card.value <= 31);
  }

  private currentPlayer(): PlayerState {
    return this.turn === 0 ? this.pone : this.dealer;
  }

  private otherTurn(): void {
    this.turn = (this.turn ^ 1) as 0 | 1;
  }

  private peg(player: PlayerState, points: number): void {
    if (points <= 0) return;
    const oldFront = this.pegPositions[player.key][1];
    player.score = Math.min(player.score + points, 121);
    this.pegPositions[player.key] = [oldFront, player.score];
    if (player.score >= 121) {
      this.phase = "game_over";
      const message = `${this.name(player)} won.`;
      this.recordAnalytics({
        type: "hand",
        action: "end",
        handNumber: this.handNumber,
        dealer: this.dealer.key,
        pone: this.pone.key,
        turnCard: this.cardLabel(this.turnCard),
        crib: this.cardLabels(this.dealer.crib),
        tables: {
          human: this.cardLabels(this.human.table),
          ai: this.cardLabels(this.ai.table),
        },
        scores: { human: this.human.score, ai: this.ai.score },
      });
      this.recordAnalytics({
        type: "game",
        action: "end",
        opponent: this.opponent,
        winner: player.key,
        loser: player === this.human ? "ai" : "human",
        result: this.gameResultFor(player),
        finalScores: { human: this.human.score, ai: this.ai.score },
      });
      this.logEvent(message);
      throw new WinGame(message);
    }
  }

  private recordScore(
    player: PlayerState,
    category: AnalyticsScoreCategory,
    points: number,
    reason: string,
    card?: Card,
    count?: number,
    scoreComponents?: AnalyticsScoreComponents,
  ): void {
    if (points <= 0) return;
    this.recordAnalytics({
      type: "score",
      handNumber: this.handNumber,
      player: player.key,
      role: this.roleFor(player),
      category,
      points,
      reason,
      totalScore: Math.min(player.score + points, 121),
      scores: {
        human: this.human.score + (player === this.human ? points : 0),
        ai: this.ai.score + (player === this.ai ? points : 0),
      },
      cards: category === "crib"
        ? this.cardLabels(this.dealer.crib)
        : category === "hand"
          ? this.cardLabels(player.table)
          : this.cardLabels(this.plays),
      turnCard: category === "hand" || category === "crib" || reason === "his heels"
        ? this.cardLabel(this.turnCard)
        : undefined,
      card: card ? this.cardLabel(card) : undefined,
      count,
      scoreComponents,
    });
  }

  private gameResultFor(winner: PlayerState): AnalyticsGameResult {
    const loser = winner === this.human ? this.ai : this.human;
    if (loser.score <= 60) return "double-skunk";
    if (loser.score <= 90) return "skunk";
    return "regular";
  }

  private recordDiscard(
    player: PlayerState,
    cards: Card[],
    handBeforeDiscard: Card[] = player.hand,
    reviewDecision = player === this.human,
  ): void {
    const engine = this.playerEngines[player.key];
    const analysis = analyzeDiscardChoice(handBeforeDiscard, cards, player === this.dealer, engine, { game: this, player });
    this.pegTableLeads[player.key] = analysis.selectedPegTableLead;
    const selectedEvComponents = shouldLogScoreComponents()
      ? selectedDiscardEvComponents(handBeforeDiscard, cards, player === this.dealer, engine)
      : undefined;
    const review = reviewDecision && player === this.human
      ? this.reviewDiscard(player, cards, handBeforeDiscard)
      : undefined;
    this.recordAnalytics({
      type: "discard",
      handNumber: this.handNumber,
      player: player.key,
      role: this.roleFor(player),
      cards: this.cardLabels(cards),
      cribOwner: this.dealer.key,
      cribAfterDiscard: this.cardLabels(this.crib),
      remainingHand: this.cardLabels(player.hand),
      handBeforeDiscard: this.cardLabels(handBeforeDiscard),
      scores: { human: this.human.score, ai: this.ai.score },
      dealer: this.dealer.key,
      model: engine,
      selectedEv: roundEv(analysis.selectedEv),
      selectedEvComponents,
      review,
    });
  }

  private reviewDiscard(
    player: PlayerState,
    cards: Card[],
    handBeforeDiscard: Card[],
  ): AnalyticsDecisionReview | undefined {
    const analysis = analyzeDiscardChoice(handBeforeDiscard, cards, player === this.dealer, DEFAULT_OPPONENT, { game: this, player });
    this.pegTableLeads[player.key] = analysis.selectedPegTableLead;
    const selectedWinProbability = analysis.selectedWinProbability ?? discardChoiceWinProbability(
      this,
      player,
      analysis.selectedComponents,
      DEFAULT_OPPONENT,
    );
    const recommendedWinProbability = analysis.recommendedWinProbability ?? discardChoiceWinProbability(
      this,
      player,
      analysis.recommendedComponents,
      DEFAULT_OPPONENT,
    );
    return {
      model: DEFAULT_OPPONENT,
      selected: this.cardLabels(cards),
      recommended: this.cardLabels(analysis.recommended),
      selectedEv: roundEv(analysis.selectedEv),
      recommendedEv: roundEv(analysis.recommendedEv),
      delta: roundEv(analysis.recommendedEv - analysis.selectedEv),
      selectedWinProbability: roundProbability(selectedWinProbability),
      recommendedWinProbability: roundProbability(recommendedWinProbability),
      winProbabilityDelta: roundProbability(recommendedWinProbability - selectedWinProbability),
      components: decisionComponents(analysis.selectedComponents, analysis.recommendedComponents),
    };
  }

  private reviewPegPlay(player: PlayerState, card: Card): AnalyticsDecisionReview | undefined {
    const recommended = this.choosePlayForEngine(player, DEFAULT_OPPONENT);
    const selected = peggingPlayReviewValues(this, player, card, DEFAULT_OPPONENT);
    const recommendedValues = peggingPlayReviewValues(this, player, recommended, DEFAULT_OPPONENT);
    return {
      model: DEFAULT_OPPONENT,
      selected: [this.cardLabel(card)],
      recommended: [this.cardLabel(recommended)],
      selectedEv: roundEv(selected.pointEv),
      recommendedEv: roundEv(recommendedValues.pointEv),
      delta: roundEv(recommendedValues.pointEv - selected.pointEv),
      selectedWinProbability: roundProbability(selected.winProbability),
      recommendedWinProbability: roundProbability(recommendedValues.winProbability),
      winProbabilityDelta: roundProbability(recommendedValues.winProbability - selected.winProbability),
      components: decisionComponents(
        { [player === this.dealer ? "peggingDealer" : "peggingPone"]: selected.pointEv },
        { [player === this.dealer ? "peggingDealer" : "peggingPone"]: recommendedValues.pointEv },
      ),
    };
  }

  private choosePlayForEngine(player: PlayerState, engine: Opponent): Card {
    const legal = this.legalCards(player);
    const outcomeLead = choosePeggingOutcomeLead(this, player, legal, engine);
    if (outcomeLead) return outcomeLead.card;
    const pegTableLead = choosePegTableLead(player.hand, legal, this.pegTableLeads[player.key], {
      engine,
      isPone: player === this.pone,
      count: this.count,
      plays: this.plays,
    });
    if (pegTableLead) return pegTableLead;
    if (usesExhaustivePegging(engine)) {
      return this.chooseExhaustivePegPlay(player, legal).card;
    }
    return bestImmediatePegPlay(this.plays, legal);
  }

  private recordAnalytics(
    event: NewAnalyticsEvent,
  ): AnalyticsEvent {
    this.analyticsCounter += 1;
    const analyticsEvent = {
      ...event,
      id: `${this.gameId}-${this.analyticsCounter}`,
      at: new Date().toISOString(),
      gameId: this.gameId,
    } as AnalyticsEvent;
    this.analyticsEvents.push(analyticsEvent);
    return analyticsEvent;
  }

  private roleFor(player: PlayerState): AnalyticsRole {
    return player === this.dealer ? "dealer" : "pone";
  }

  private archivePlays(): void {
    if (this.plays.length) {
      this.completedPlays.push([...this.plays]);
      this.completedPlayOwners.push([...this.playOwners]);
    }
  }

  private clearCurrentPeggingSeries(): void {
    this.archivePlays();
    this.plays = [];
    this.playOwners = [];
    this.count = 0;
    this.goPlayer = null;
    this.lastPlayer = null;
  }

  private logEvent(message: string): void {
    this.message = message;
    this.log.unshift(message);
    this.log = this.log.slice(0, 12);
    this.result.push(message);
  }

  private beginInteraction(): void {
    this.result = [];
  }

  private name(player: PlayerState): string {
    return player === this.human ? "User" : "AI";
  }

  private cardLabel(card: Card): string {
    return card.ascii;
  }

  private cardLabels(cards: Card[]): string[] {
    return cards.map((card) => this.cardLabel(card));
  }

  private serializeCard(card: Card, index: number | null = null, owner?: PlayerKey): SerializedCard {
    return {
      index,
      id: card.id,
      rank: card.rankStr,
      suit: SUIT_NAMES[card.suit],
      symbol: SUIT_SYMBOLS[card.suit],
      value: card.value,
      label: this.cardLabel(card),
      owner,
    };
  }
}

function fullDeck(): Card[] {
  return Array.from({ length: 52 }, (_, id) => new Card(id));
}

function shuffledDeck(): Card[] {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function sortedCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.id - b.id);
}

function removeCards(hand: Card[], cards: Card[]): void {
  for (const card of cards) {
    const index = hand.findIndex((candidate) => candidate.id === card.id);
    if (index !== -1) hand.splice(index, 1);
  }
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function combinations<T>(items: T[], minSize: number, maxSize = minSize): T[][] {
  const result: T[][] = [];
  const selected: T[] = [];
  function visit(start: number, size: number): void {
    if (selected.length === size) {
      result.push([...selected]);
      return;
    }
    for (let i = start; i <= items.length - (size - selected.length); i += 1) {
      selected.push(items[i]);
      visit(i + 1, size);
      selected.pop();
    }
  }
  for (let size = minSize; size <= maxSize; size += 1) {
    visit(0, size);
  }
  return result;
}

function compareTuple(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

type RankCounts = number[];
type WeightedRankHand = { ranks: RankCounts; weight: number };
type PeggingHoldPrefix = {
  samples: number;
  remainingHands: Record<string, number | undefined>;
};
type PeggingHoldTable = {
  ranks: string[];
  roles: Record<"dealer" | "pone", Record<string, { prefixes: Record<string, PeggingHoldPrefix | undefined> } | undefined>>;
};
type Model13HoldManifest = {
  ranks: string[];
  handKeys: string[];
  prefixKeys: string[];
};
type PegSimulationState = {
  hands: Record<PlayerKey, RankCounts>;
  plays: number[];
  count: number;
  current: PlayerKey;
  goPlayer: PlayerKey | null;
  lastPlayer: PlayerKey | null;
  perspective: PlayerKey;
};
type OptimalPegSimulationState = PegSimulationState & {
  scores: Record<PlayerKey, number>;
  rootScores: Record<PlayerKey, number>;
  perspectiveRole: "dealer" | "pone";
  postPeggingContext: PostPeggingWinContext;
};
type ScoreDistribution = Array<[number, number]>;
type DiscardWinBaseOutcome = [number, number, number];
type PostPeggingWinContext = {
  key: string;
  perspectiveRole: "dealer" | "pone";
  poneIsPerspective: boolean;
  dealerIsPerspective: boolean;
  poneHand: ScoreDistribution;
  dealerHand: ScoreDistribution;
  crib: ScoreDistribution;
  memo: Map<string, number>;
};
type WeightedScore = { total: number; weight: number };
type WeightedPegComponents = { components: AnalyticsEvComponents; weight: number };
type PegTableEvTuple = [number, number, number | null];
type PegTableEv = {
  myPeggingEv: number;
  opponentPeggingEv: number;
  netPeggingEv: number;
  bestLead: number | null;
};
type PegTablePolicy = { pegEvs: Record<string, PegTableEvTuple | undefined> };
export type ScorePhase = "peggingPone" | "peggingDealer" | "handPone" | "handDealer" | "crib";
type ScorePhaseStats = {
  average: number;
  variance: number;
  standardDeviation: number;
  min: number;
  max: number;
};
type BoardPositionStats = { global: Record<ScorePhase, ScorePhaseStats> };
type PeggingOutcomeDistribution = {
  outcomes: Map<number, number>;
  totalWeight: number;
};
type PeggingOutcomeSummary = {
  totalWeight: number;
  myEv: number;
  opponentEv: number;
  hist: Array<[number, number, number]>;
};
type PeggingOutcomePolicy = "ev" | "on" | "off";
type PeggingPairwiseManifest = {
  keepKeys: string[];
};
type PeggingPairwiseTable = {
  format: "word32" | "packed49" | "aligned7";
  keepKeys: string[];
  keepRanks: RankCounts[];
  keepIdByKey: Map<string, number>;
  dealerOffsets: Uint32Array;
  poneOffsets: Uint32Array;
  dealerRecords?: Uint32Array;
  poneRecords?: Uint32Array;
  dealerPackedRecords?: Uint8Array;
  ponePackedRecords?: Uint8Array;
  dealerAlignedRecords?: Uint8Array;
  poneAlignedRecords?: Uint8Array;
  recordBits: number;
  recordBytes: number;
};
type PoneLeadFrequencyTable = {
  version: number;
  ranks: string[];
  totals: {
    compactHandsSeen: number;
    poneHandsSeen: number;
    poneHandsWithLead: number;
    keepBuckets: number;
  };
  table: Record<string, {
    samples: number;
    order: Array<{ rank: string; count: number; probability: number }>;
  }>;
};
type Model13LeadManifest = {
  ranks: string[];
  keepKeys: string[];
};

const pegCardCache = Array.from({ length: 13 }, (_, rank) => new Card(rank));
const PEG_TABLE_POLICIES: Partial<Record<Opponent, PegTablePolicy>> = {};
const PEGGING_HOLD_TABLES: Partial<Record<Opponent, PeggingHoldTable>> = {};
const PEGGING_PAIRWISE_TABLES: Partial<Record<Opponent, PeggingPairwiseTable>> = {};
const PONE_LEAD_FREQUENCY_TABLES: Partial<Record<Opponent, PoneLeadFrequencyTable>> = {};
const CRIB_TRIPOLICY_TABLES: Partial<Record<Opponent, CribTripolicyTable>> = {};
const CRIB_TRIPOLICY_POLICY_INDEX: Record<CribPolicy, number> = { ev: 0, on: 1, off: 2 };
const DISCARD_WIN_BASE_OUTCOME_CACHE = new Map<string, DiscardWinBaseOutcome[]>();
const DISCARD_WIN_BASE_OUTCOME_CACHE_LIMIT = 1500;
const PAIRWISE_PEGGING_OUTCOME_CACHE = new Map<string, PeggingOutcomeSummary | null>();
const PAIRWISE_PEGGING_OUTCOME_CACHE_LIMIT = 5000;
const OPPONENT_RANK_HANDS_CACHE = new Map<string, WeightedRankHand[]>();
const OPPONENT_RANK_HANDS_CACHE_LIMIT = 10000;
const MODEL13_PEGGING_DECISION_CACHE = new Map<string, { cardId: number; ev: number }>();
const MODEL13_PEGGING_DECISION_CACHE_LIMIT = 500;
const MODEL13_OPTIMAL_PEGGING_TREE_CACHE = new Map<string, PeggingOutcomeDistribution>();
const MODEL13_OPTIMAL_PEGGING_TREE_CACHE_LIMIT = model13TreeCacheLimit();
const BOARD_POSITION_STATS = boardPositionStats as BoardPositionStats;
const SCORE_PHASES: ScorePhase[] = ["peggingPone", "peggingDealer", "handPone", "handDealer", "crib"];
const SCORE_PHASE_DISTRIBUTIONS: Record<ScorePhase, Array<[number, number]>> = Object.fromEntries(
  SCORE_PHASES.map((phase) => [phase, scorePhaseDistribution(BOARD_POSITION_STATS.global[phase])]),
) as Record<ScorePhase, Array<[number, number]>>;
const PEG_TABLE_POLICY_LOADERS: Partial<Record<Opponent, () => Promise<PegTablePolicy>>> = {
  "schell_table-peg_table-4.0": () =>
    import("./models/schell_table-peg_table-4.0/peg-table-policy.json").then((module) => module.default as unknown as PegTablePolicy),
  "ras_table-peg_table-4.0": () =>
    import("./models/schell_table-peg_table-4.0/peg-table-policy.json").then((module) => module.default as unknown as PegTablePolicy),
  "schell_table-peg_table-5.0": () =>
    import("./models/schell_table-peg_table-5.0/peg-table-policy.json").then((module) => module.default as unknown as PegTablePolicy),
  "schell_table-peg_table-6.0": () =>
    import("./models/schell_table-peg_table-6.0/peg-table-policy.json").then((module) => module.default as unknown as PegTablePolicy),
  "schell_table-peg_table-7.0": () =>
    import("./models/schell_table-peg_table-6.0/peg-table-policy.json").then((module) => module.default as unknown as PegTablePolicy),
  "schell_table-peg_table-8.0": () =>
    import("./models/schell_table-peg_table-8.0/peg-table-policy.json").then((module) => module.default as unknown as PegTablePolicy),
  "schell_table-peg_table-9.0": () =>
    import("./models/schell_table-peg_table-9.0/peg-table-policy.json").then((module) => module.default as unknown as PegTablePolicy),
  "schell_table-peg_table-10.0": () =>
    import("./models/schell_table-peg_table-10.0/peg-table-policy.json").then((module) => module.default as unknown as PegTablePolicy),
  "schell_table-peg_table-11.0": () =>
    import("./models/schell_table-peg_table-11.0/peg-table-policy.json").then((module) => module.default as unknown as PegTablePolicy),
  "schell_table-peg_table-11.1": () =>
    import("./models/schell_table-peg_table-11.1/peg-table-policy.json").then((module) => module.default as unknown as PegTablePolicy),
};
const PEGGING_HOLD_TABLE_LOADERS: Partial<Record<Opponent, () => Promise<PeggingHoldTable>>> = {
  "schell_table-peg_table-9.0": () =>
    import("./models/schell_table-peg_table-9.0/pegging-remaining-hand-distribution.json").then((module) => module.default as unknown as PeggingHoldTable),
  "schell_table-peg_table-10.0": () =>
    import("./models/schell_table-peg_table-10.0/pegging-remaining-hand-distribution.json").then((module) => module.default as unknown as PeggingHoldTable),
  "schell_table-peg_table-11.0": () =>
    import("./models/schell_table-peg_table-11.0/pegging-remaining-hand-distribution.json").then((module) => module.default as unknown as PeggingHoldTable),
  "schell_table-peg_table-11.1": () =>
    import("./models/schell_table-peg_table-11.1/pegging-remaining-hand-distribution.json").then((module) => module.default as unknown as PeggingHoldTable),
  "schell_table-peg_table-12.0": () =>
    import("./models/schell_table-peg_table-11.1/pegging-remaining-hand-distribution.json").then((module) => module.default as unknown as PeggingHoldTable),
  "schell_table-peg_table-13.0": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-14.0": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
};
const PEGGING_PAIRWISE_TABLE_LOADERS: Partial<Record<Opponent, () => Promise<PeggingPairwiseTable>>> = {
  "schell_table-peg_table-12.0": () =>
    loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-13.0": () =>
    loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.0": () =>
    loadPairwisePeggingTable(peggingPairwise14Url, peggingPairwise14Manifest as PeggingPairwiseManifest),
};
const PONE_LEAD_FREQUENCY_LOADERS: Partial<Record<Opponent, () => Promise<PoneLeadFrequencyTable>>> = {
  "schell_table-peg_table-13.0": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.0": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
};
const CRIB_TRIPOLICY_LOADERS: Partial<Record<Opponent, () => Promise<CribTripolicyTable>>> = {
  "schell_table-peg_table-14.0": () =>
    loadTripolicyCribTable(cribTripolicy14Url, cribTripolicy14Manifest as CribTripolicyManifest),
};

export function hasLoadedOpponentResources(opponent: StoredOpponent): boolean {
  const engine = normalizeOpponent(opponent);
  const hasPegTable = !PEG_TABLE_POLICY_LOADERS[engine] || Boolean(PEG_TABLE_POLICIES[engine]);
  const hasHoldTable = !PEGGING_HOLD_TABLE_LOADERS[engine] || Boolean(PEGGING_HOLD_TABLES[engine]);
  const hasOutcomeTable = !PEGGING_PAIRWISE_TABLE_LOADERS[engine] || Boolean(PEGGING_PAIRWISE_TABLES[engine]);
  const hasLeadTable = !PONE_LEAD_FREQUENCY_LOADERS[engine] || Boolean(PONE_LEAD_FREQUENCY_TABLES[engine]);
  const hasCribTripolicyTable = !CRIB_TRIPOLICY_LOADERS[engine] || Boolean(CRIB_TRIPOLICY_TABLES[engine]);
  return hasPegTable && hasHoldTable && hasOutcomeTable && hasLeadTable && hasCribTripolicyTable;
}

export async function loadOpponentResources(opponent: StoredOpponent): Promise<void> {
  const engine = normalizeOpponent(opponent);
  const sharedPegTablePolicy = sharedPegTablePolicyEngine(engine);
  if (sharedPegTablePolicy && PEG_TABLE_POLICIES[sharedPegTablePolicy]) {
    PEG_TABLE_POLICIES[engine] = PEG_TABLE_POLICIES[sharedPegTablePolicy];
  }
  const loader = PEG_TABLE_POLICY_LOADERS[engine];
  const holdTableLoader = PEGGING_HOLD_TABLE_LOADERS[engine];
  const outcomeTableLoader = PEGGING_PAIRWISE_TABLE_LOADERS[engine];
  const leadTableLoader = PONE_LEAD_FREQUENCY_LOADERS[engine];
  const cribTripolicyLoader = CRIB_TRIPOLICY_LOADERS[engine];
  const loadPegTable = loader && !PEG_TABLE_POLICIES[engine]
    ? loader().then((policy) => {
        PEG_TABLE_POLICIES[engine] = policy;
        if (sharedPegTablePolicy) PEG_TABLE_POLICIES[sharedPegTablePolicy] = policy;
      })
    : Promise.resolve();
  const loadHoldTable = holdTableLoader && !PEGGING_HOLD_TABLES[engine]
    ? holdTableLoader().then((table) => {
        PEGGING_HOLD_TABLES[engine] = table;
      })
    : Promise.resolve();
  const loadOutcomeTable = outcomeTableLoader && !PEGGING_PAIRWISE_TABLES[engine]
    ? outcomeTableLoader().then((table) => {
        PEGGING_PAIRWISE_TABLES[engine] = table;
      })
    : Promise.resolve();
  const loadLeadTable = leadTableLoader && !PONE_LEAD_FREQUENCY_TABLES[engine]
    ? leadTableLoader().then((table) => {
        PONE_LEAD_FREQUENCY_TABLES[engine] = table;
      })
    : Promise.resolve();
  const loadCribTripolicyTable = cribTripolicyLoader && !CRIB_TRIPOLICY_TABLES[engine]
    ? cribTripolicyLoader().then((table) => {
        CRIB_TRIPOLICY_TABLES[engine] = table;
      })
    : Promise.resolve();
  await Promise.all([loadPegTable, loadHoldTable, loadOutcomeTable, loadLeadTable, loadCribTripolicyTable]);
}

function sharedPegTablePolicyEngine(engine: Opponent): Opponent | null {
  if (engine === "schell_table-peg_table-6.0") return "schell_table-peg_table-7.0";
  if (engine === "schell_table-peg_table-7.0") return "schell_table-peg_table-6.0";
  return null;
}

function usesExhaustivePegging(engine: Opponent): boolean {
  return engine === "original_exhaustive_peg-1.2" ||
    engine.includes("-peg-") ||
    engine.includes("-peg_table-");
}

function usesPegTableDiscard(engine: Opponent): boolean {
  return engine.includes("-peg_table-");
}

function usesCribFlushAdjustment(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-7.0" ||
    engine === "schell_table-peg_table-8.0" ||
    engine === "schell_table-peg_table-9.0" ||
    engine === "schell_table-peg_table-10.0" ||
    engine === "schell_table-peg_table-11.0" ||
    engine === "schell_table-peg_table-11.1" ||
    engine === "schell_table-peg_table-12.0" ||
    usesModel13LivePegging(engine);
}

function usesWinProbabilityPegging(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-10.0" ||
    engine === "schell_table-peg_table-11.0" ||
    engine === "schell_table-peg_table-11.1" ||
    engine === "schell_table-peg_table-12.0" ||
    engine === "schell_table-peg_table-13.0" ||
    engine === "schell_table-peg_table-14.0";
}

function usesRankCutDiscardTables(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-11.0" ||
    engine === "schell_table-peg_table-11.1" ||
    engine === "schell_table-peg_table-12.0" ||
    engine === "schell_table-peg_table-13.0" ||
    engine === "schell_table-peg_table-14.0";
}

function usesDiscardWinProbability(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-11.1" ||
    engine === "schell_table-peg_table-12.0" ||
    engine === "schell_table-peg_table-13.0" ||
    engine === "schell_table-peg_table-14.0";
}

function usesPeggingOutcomeTables(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-12.0" ||
    engine === "schell_table-peg_table-13.0" ||
    engine === "schell_table-peg_table-14.0";
}

function usesModel13LivePegging(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-13.0" ||
    engine === "schell_table-peg_table-14.0";
}

function pegTableEv(
  hand: Card[],
  discard: Card[],
  role: "dealer" | "pone",
  engine: Opponent,
): PegTableEv {
  if (!usesPegTableDiscard(engine)) return {
    myPeggingEv: 0,
    opponentPeggingEv: 0,
    netPeggingEv: 0,
    bestLead: null,
  };
  const handRanks = rankCountsForCards(hand);
  const discardRanks = rankCountsForCards(discard);
  const policy = PEG_TABLE_POLICIES[engine];
  if (!policy) return {
    myPeggingEv: 0,
    opponentPeggingEv: 0,
    netPeggingEv: 0,
    bestLead: null,
  };
  const entry = policy.pegEvs[
    `${handRanks.join("")}:${discardRanks.join("")}:${role}`
  ];
  if (!entry) return {
    myPeggingEv: 0,
    opponentPeggingEv: 0,
    netPeggingEv: 0,
    bestLead: null,
  };
  const [myPeggingEv, opponentPeggingEv, bestLead] = entry;
  return {
    myPeggingEv,
    opponentPeggingEv,
    netPeggingEv: myPeggingEv - opponentPeggingEv,
    bestLead,
  };
}

function choosePegTableLead(
  hand: Card[],
  legal: Card[],
  bestLead: number | null,
  context: { engine: Opponent; isPone: boolean; count: number; plays: Card[] },
): Card | null {
  if (
    bestLead === null ||
    !usesPegTableDiscard(context.engine) ||
    !context.isPone ||
    context.count !== 0 ||
    context.plays.length !== 0 ||
    hand.length !== 4
  ) {
    return null;
  }
  return legal.find((card) => card.rank === bestLead) ?? null;
}

async function loadPairwisePeggingTable(url: string, manifest: PeggingPairwiseManifest): Promise<PeggingPairwiseTable> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load pairwise pegging table: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "P12P" && magic !== "P13P" && magic !== "P14C" && magic !== "P14A") throw new Error(`Unexpected pairwise pegging table magic: ${magic}`);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`Unsupported pairwise pegging table version: ${version}`);
  const keepCount = view.getUint16(6, true);
  const dealerRecordCount = view.getUint32(8, true);
  const poneRecordCount = view.getUint32(12, true);
  const recordBits = magic === "P14C" ? view.getUint16(16, true) : 32;
  const recordBytes = magic === "P14A" ? view.getUint16(16, true) : 4;
  if (keepCount !== manifest.keepKeys.length) {
    throw new Error(`Pairwise pegging table keep count mismatch: ${keepCount} vs ${manifest.keepKeys.length}`);
  }
  let offset = 20;
  const dealerOffsets = new Uint32Array(buffer, offset, keepCount + 1);
  offset += (keepCount + 1) * 4;
  const poneOffsets = new Uint32Array(buffer, offset, (keepCount * 13) + 1);
  offset += ((keepCount * 13) + 1) * 4;
  const keepRanks = manifest.keepKeys.map((key) => key.split("").map((digit) => Number.parseInt(digit, 10)) as RankCounts);
  const base = {
    keepKeys: manifest.keepKeys,
    keepRanks,
    keepIdByKey: new Map(manifest.keepKeys.map((key, index) => [key, index])),
    dealerOffsets,
    poneOffsets,
    recordBits,
    recordBytes,
  };
  if (magic === "P14C") {
    if (recordBits !== 49) throw new Error(`Unsupported P14C record width: ${recordBits}`);
    const dealerBytes = Math.ceil((dealerRecordCount * recordBits) / 8);
    const dealerPackedRecords = new Uint8Array(buffer, offset, dealerBytes);
    offset += dealerBytes;
    const poneBytes = Math.ceil((poneRecordCount * recordBits) / 8);
    const ponePackedRecords = new Uint8Array(buffer, offset, poneBytes);
    return {
      ...base,
      format: "packed49",
      dealerPackedRecords,
      ponePackedRecords,
    };
  }
  if (magic === "P14A") {
    if (recordBytes !== 7) throw new Error(`Unsupported P14A record width: ${recordBytes}`);
    const dealerBytes = dealerRecordCount * recordBytes;
    const dealerAlignedRecords = new Uint8Array(buffer, offset, dealerBytes);
    offset += dealerBytes;
    const poneBytes = poneRecordCount * recordBytes;
    const poneAlignedRecords = new Uint8Array(buffer, offset, poneBytes);
    return {
      ...base,
      format: "aligned7",
      dealerAlignedRecords,
      poneAlignedRecords,
    };
  }
  const dealerRecords = new Uint32Array(buffer, offset, dealerRecordCount);
  offset += dealerRecordCount * 4;
  const poneRecords = new Uint32Array(buffer, offset, poneRecordCount);
  return {
    ...base,
    format: "word32",
    dealerRecords,
    poneRecords,
  };
}

async function loadTripolicyCribTable(url: string, manifest: CribTripolicyManifest): Promise<CribTripolicyTable> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load 14.0 crib table: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "C14B") throw new Error(`Unexpected 14.0 crib table magic: ${magic}`);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`Unsupported 14.0 crib table version: ${version}`);
  const pairCount = view.getUint16(6, true);
  const entryCount = view.getUint32(8, true);
  const directoryOffset = view.getUint32(16, true);
  const recordsOffset = view.getUint32(20, true);
  const directoryRecordBytes = view.getUint16(24, true);
  const opponentRecordBytes = view.getUint16(26, true);
  if (pairCount !== manifest.pairKeys.length) {
    throw new Error(`14.0 crib table pair count mismatch: ${pairCount} vs ${manifest.pairKeys.length}`);
  }
  if (entryCount !== 2 * pairCount * 13 * 3) {
    throw new Error(`14.0 crib table entry count mismatch: ${entryCount}`);
  }
  if (directoryRecordBytes !== 10 || opponentRecordBytes !== 9) {
    throw new Error(`Unsupported 14.0 crib record widths: ${directoryRecordBytes}/${opponentRecordBytes}`);
  }
  return {
    pairKeys: manifest.pairKeys,
    pairIndexByKey: new Map(manifest.pairKeys.map((key, index) => [key, index])),
    directory: new DataView(buffer, directoryOffset, recordsOffset - directoryOffset),
    records: new DataView(buffer, recordsOffset),
    directoryRecordBytes,
    opponentRecordBytes,
    entryCount,
  };
}

async function loadModel13LeadTable(url: string, manifest: Model13LeadManifest): Promise<PoneLeadFrequencyTable> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load 13.0 lead table: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "P13L") throw new Error(`Unexpected 13.0 lead table magic: ${magic}`);
  const version = view.getUint16(4, true);
  const recordBytes = view.getUint16(6, true);
  const entryCount = view.getUint32(8, true);
  const recordsOffset = view.getUint32(12, true);
  if (version !== 1 || recordBytes !== 18 || entryCount !== manifest.keepKeys.length) {
    throw new Error(`Invalid 13.0 lead table header: v${version}, ${recordBytes} bytes, ${entryCount} entries`);
  }
  const table: PoneLeadFrequencyTable["table"] = {};
  for (let index = 0; index < entryCount; index += 1) {
    const offset = recordsOffset + (index * recordBytes);
    const samples = view.getUint32(offset, true);
    const count = view.getUint8(offset + 4);
    const order: Array<{ rank: string; count: number; probability: number }> = [];
    for (let orderIndex = 0; orderIndex < Math.min(13, count); orderIndex += 1) {
      const rank = view.getUint8(offset + 5 + orderIndex);
      if (rank < manifest.ranks.length) order.push({ rank: manifest.ranks[rank], count: 0, probability: 0 });
    }
    table[manifest.keepKeys[index]] = { samples, order };
  }
  return {
    version: 1,
    ranks: manifest.ranks,
    totals: {
      compactHandsSeen: 0,
      poneHandsSeen: 0,
      poneHandsWithLead: 0,
      keepBuckets: entryCount,
    },
    table,
  };
}

async function loadModel13HoldTable(url: string, manifest: Model13HoldManifest): Promise<PeggingHoldTable> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load 13.0 hold table: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "P13H") throw new Error(`Unexpected 13.0 hold table magic: ${magic}`);
  const version = view.getUint16(4, true);
  const contextBytes = view.getUint16(6, true);
  const contextCount = view.getUint32(8, true);
  const recordCount = view.getUint32(12, true);
  const contextOffset = view.getUint32(16, true);
  const recordsOffset = view.getUint32(20, true);
  const recordBytes = view.getUint16(24, true);
  if (version !== 1 || contextBytes !== 16 || recordBytes !== 6) {
    throw new Error(`Invalid 13.0 hold table header: v${version}, ${contextBytes}/${recordBytes}`);
  }
  const roles: PeggingHoldTable["roles"] = {
    dealer: {},
    pone: {},
  };
  for (const role of ["dealer", "pone"] as const) {
    for (const length of ["0", "1", "2", "3"]) roles[role][length] = { prefixes: {} };
  }
  for (let index = 0; index < contextCount; index += 1) {
    const offset = contextOffset + (index * contextBytes);
    const role = view.getUint8(offset) === 0 ? "dealer" : "pone";
    const prefixLength = String(view.getUint8(offset + 1));
    const prefixKey = manifest.prefixKeys[view.getUint16(offset + 2, true)] ?? "";
    const samples = view.getUint32(offset + 4, true);
    const firstRecord = view.getUint32(offset + 8, true);
    const contextRecordCount = view.getUint16(offset + 12, true);
    const remainingHands: Record<string, number> = {};
    for (let recordIndex = 0; recordIndex < contextRecordCount; recordIndex += 1) {
      const recordOffset = recordsOffset + ((firstRecord + recordIndex) * recordBytes);
      if (firstRecord + recordIndex >= recordCount) break;
      const handKey = manifest.handKeys[view.getUint16(recordOffset, true)];
      if (!handKey) continue;
      remainingHands[handKey] = view.getUint32(recordOffset + 2, true);
    }
    roles[role][prefixLength] ??= { prefixes: {} };
    roles[role][prefixLength]!.prefixes[prefixKey] = { samples, remainingHands };
  }
  return {
    ranks: manifest.ranks,
    roles,
  };
}

function peggingOutcomeTableEv(
  keep: Card[],
  role: "dealer" | "pone",
  engine: Opponent,
  knownCards: Card[],
): PegTableEv | null {
  const summary = bestPeggingOutcomeSummary(keep, role, engine, knownCards);
  if (!summary) return null;
  return {
    myPeggingEv: summary.myEv,
    opponentPeggingEv: summary.opponentEv,
    netPeggingEv: summary.myEv - summary.opponentEv,
    bestLead: summary.bestLead,
  };
}

function peggingOutcomeHistogram(
  keep: Card[],
  role: "dealer" | "pone",
  engine: Opponent,
  knownCards: Card[],
): Array<[number, number, number]> | null {
  return bestPeggingOutcomeSummary(keep, role, engine, knownCards)?.hist ?? null;
}

function peggingOutcomeDiscardOptions(
  keep: Card[],
  role: "dealer" | "pone",
  engine: Opponent,
  knownCards: Card[],
): Array<PegTableEv & {
  hist: Array<[number, number, number]> | null;
  policy: PeggingOutcomePolicy | "fallback";
}> {
  if (engine === "schell_table-peg_table-14.0" && PEGGING_PAIRWISE_TABLES[engine]) {
    const options: Array<PegTableEv & { hist: Array<[number, number, number]>; policy: PeggingOutcomePolicy }> = [];
    for (const policy of ["ev", "on", "off"] as PeggingOutcomePolicy[]) {
      if (role === "dealer") {
        const summary = aggregatePairwisePeggingOutcomes(keep, "dealer", engine, knownCards, null, policy);
        if (summary) options.push(peggingOptionFromSummary(summary, null, policy));
        continue;
      }
      for (const lead of legalPegRanks(rankCountsForCards(keep), 0)) {
        const summary = aggregatePairwisePeggingOutcomes(keep, "pone", engine, knownCards, lead, policy);
        if (summary) options.push(peggingOptionFromSummary(summary, lead, policy));
      }
    }
    if (options.length) return options;
  }
  const summary = bestPeggingOutcomeSummary(keep, role, engine, knownCards);
  if (summary) return [peggingOptionFromSummary(summary, summary.bestLead, "ev")];
  return [];
}

function peggingOptionFromSummary(
  summary: PeggingOutcomeSummary,
  bestLead: number | null,
  policy: PeggingOutcomePolicy,
): PegTableEv & { hist: Array<[number, number, number]>; policy: PeggingOutcomePolicy } {
  return {
    myPeggingEv: summary.myEv,
    opponentPeggingEv: summary.opponentEv,
    netPeggingEv: summary.myEv - summary.opponentEv,
    bestLead,
    hist: summary.hist,
    policy,
  };
}

function bestPeggingOutcomeSummary(
  keep: Card[],
  role: "dealer" | "pone",
  engine: Opponent,
  knownCards: Card[],
): (PeggingOutcomeSummary & { bestLead: number | null }) | null {
  if (!usesPeggingOutcomeTables(engine)) return null;
  if (role === "dealer") {
    const summary = aggregatePairwisePeggingOutcomes(keep, "dealer", engine, knownCards, null);
    return summary ? { ...summary, bestLead: null } : null;
  }
  let best: (PeggingOutcomeSummary & { bestLead: number }) | null = null;
  for (const lead of legalPegRanks(rankCountsForCards(keep), 0)) {
    const summary = aggregatePairwisePeggingOutcomes(keep, "pone", engine, knownCards, lead);
    if (!summary) continue;
    if (!best || compareLeadSummary(summary, best, lead) > 0) best = { ...summary, bestLead: lead };
  }
  return best;
}

function compareLeadSummary(candidate: PeggingOutcomeSummary, current: PeggingOutcomeSummary, candidateRank: number): number {
  const candidateNet = candidate.myEv - candidate.opponentEv;
  const currentNet = current.myEv - current.opponentEv;
  if (candidateNet !== currentNet) return candidateNet - currentNet;
  if (candidate.myEv !== current.myEv) return candidate.myEv - current.myEv;
  return -VALUES[candidateRank];
}

function aggregatePairwisePeggingOutcomes(
  keep: Card[],
  role: "dealer" | "pone",
  engine: Opponent,
  knownCards: Card[],
  leadRank: number | null,
  policy: PeggingOutcomePolicy = "ev",
): PeggingOutcomeSummary | null {
  const table = PEGGING_PAIRWISE_TABLES[engine];
  if (!table) return null;
  const keepKey = rankCountsForCards(keep).join("");
  const keepId = table.keepIdByKey.get(keepKey);
  if (keepId === undefined) return null;
  const available = remainingRankCounts(knownCards);
  const cacheKey = `${engine}:${role}:${leadRank ?? "-"}:${policy}:${keepKey}:${available.join("")}`;
  if (PAIRWISE_PEGGING_OUTCOME_CACHE.has(cacheKey)) {
    return PAIRWISE_PEGGING_OUTCOME_CACHE.get(cacheKey) ?? null;
  }
  const records = role === "dealer" ? table.dealerRecords : table.poneRecords;
  const packedRecords = role === "dealer" ? table.dealerPackedRecords : table.ponePackedRecords;
  const alignedRecords = role === "dealer" ? table.dealerAlignedRecords : table.poneAlignedRecords;
  const start = role === "dealer"
    ? table.dealerOffsets[keepId]
    : table.poneOffsets[(keepId * 13) + (leadRank ?? 0)];
  const end = role === "dealer"
    ? table.dealerOffsets[keepId + 1]
    : table.poneOffsets[(keepId * 13) + (leadRank ?? 0) + 1];
  if (end <= start) {
    boundedCacheSet(PAIRWISE_PEGGING_OUTCOME_CACHE, cacheKey, null, PAIRWISE_PEGGING_OUTCOME_CACHE_LIMIT);
    return null;
  }
  const hist = new Map<string, number>();
  let totalWeight = 0;
  let myTotal = 0;
  let opponentTotal = 0;
  for (let index = start; index < end; index += 1) {
    const record = table.format === "aligned7"
      ? unpackAlignedPairwiseRecord(alignedRecords, index, policy)
      : table.format === "packed49"
        ? unpackPackedPairwiseRecord(packedRecords, index, policy)
        : unpackPairwiseRecord(records?.[index] ?? 0);
    const opponentRanks = table.keepRanks[record.opponentKeepId];
    const weight = opponentKeepWeight(available, opponentRanks);
    if (!weight) continue;
    const key = `${record.myPegging},${record.opponentPegging}`;
    hist.set(key, (hist.get(key) ?? 0) + weight);
    totalWeight += weight;
    myTotal += record.myPegging * weight;
    opponentTotal += record.opponentPegging * weight;
  }
  if (!totalWeight) {
    boundedCacheSet(PAIRWISE_PEGGING_OUTCOME_CACHE, cacheKey, null, PAIRWISE_PEGGING_OUTCOME_CACHE_LIMIT);
    return null;
  }
  const summary = {
    totalWeight,
    myEv: myTotal / totalWeight,
    opponentEv: opponentTotal / totalWeight,
    hist: [...hist.entries()]
      .map(([key, weight]) => {
        const [my, opponent] = key.split(",").map((value) => Number.parseInt(value, 10));
        return [my, opponent, weight] as [number, number, number];
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  };
  boundedCacheSet(PAIRWISE_PEGGING_OUTCOME_CACHE, cacheKey, summary, PAIRWISE_PEGGING_OUTCOME_CACHE_LIMIT);
  return summary;
}

function unpackPairwiseRecord(record: number): { opponentKeepId: number; myPegging: number; opponentPegging: number; weight: number } {
  return {
    opponentKeepId: record & 0x7ff,
    myPegging: (record >>> 11) & 0x1f,
    opponentPegging: (record >>> 16) & 0x1f,
    weight: ((record >>> 21) & 0xff) + 1,
  };
}

function unpackPackedPairwiseRecord(
  records: Uint8Array | undefined,
  index: number,
  policy: PeggingOutcomePolicy,
): { opponentKeepId: number; myPegging: number; opponentPegging: number; weight: number } {
  if (!records) return { opponentKeepId: 0, myPegging: 0, opponentPegging: 0, weight: 0 };
  const value = readPackedBits(records, BigInt(index) * 49n, 49);
  const opponentKeepId = Number(value & 0x7ffn);
  const weight = Number((value >> 11n) & 0xffn) + 1;
  const offset = policy === "ev" ? 19n : policy === "on" ? 29n : 39n;
  return {
    opponentKeepId,
    myPegging: Number((value >> offset) & 0x1fn),
    opponentPegging: Number((value >> (offset + 5n)) & 0x1fn),
    weight,
  };
}

function unpackAlignedPairwiseRecord(
  records: Uint8Array | undefined,
  index: number,
  policy: PeggingOutcomePolicy,
): { opponentKeepId: number; myPegging: number; opponentPegging: number; weight: number } {
  if (!records) return { opponentKeepId: 0, myPegging: 0, opponentPegging: 0, weight: 0 };
  const offset = index * 7;
  const lo = (records[offset] |
    (records[offset + 1] << 8) |
    (records[offset + 2] << 16) |
    (records[offset + 3] << 24)) >>> 0;
  const hi = records[offset + 4] |
    (records[offset + 5] << 8) |
    (records[offset + 6] << 16);
  const opponentKeepId = lo & 0x7ff;
  const weight = ((lo >>> 11) & 0xff) + 1;
  if (policy === "ev") {
    return {
      opponentKeepId,
      weight,
      myPegging: (lo >>> 19) & 0x1f,
      opponentPegging: (lo >>> 24) & 0x1f,
    };
  }
  if (policy === "on") {
    return {
      opponentKeepId,
      weight,
      myPegging: ((lo >>> 29) & 0x7) | ((hi & 0x3) << 3),
      opponentPegging: (hi >>> 2) & 0x1f,
    };
  }
  return {
    opponentKeepId,
    weight,
    myPegging: (hi >>> 7) & 0x1f,
    opponentPegging: (hi >>> 12) & 0x1f,
  };
}

function readPackedBits(records: Uint8Array, bitOffset: bigint, bitLength: number): bigint {
  let value = 0n;
  for (let bit = 0n; bit < BigInt(bitLength); bit += 1n) {
    const absolute = bitOffset + bit;
    const byteIndex = Number(absolute >> 3n);
    const bitIndex = Number(absolute & 7n);
    if (records[byteIndex] & (1 << bitIndex)) value |= 1n << bit;
  }
  return value;
}

function opponentKeepWeight(available: RankCounts, opponentRanks: RankCounts): number {
  let weight = 1;
  for (let rank = 0; rank < 13; rank += 1) {
    const count = opponentRanks[rank];
    if (!count) continue;
    if (available[rank] < count) return 0;
    weight *= choose(available[rank], count);
  }
  return weight;
}

function choosePeggingOutcomeLead(
  game: CribbageGame,
  player: PlayerState,
  legal: Card[],
  engine: Opponent,
): { card: Card; ev: number } | null {
  if (
    (usesModel13LivePegging(engine) && engine !== "schell_table-peg_table-14.0") ||
    !usesPeggingOutcomeTables(engine) ||
    player !== game.pone ||
    game.count !== 0 ||
    game.plays.length !== 0 ||
    player.hand.length !== 4
  ) {
    return null;
  }
  const opponent = player === game.human ? game.ai : game.human;
  const knownCards = [
    ...player.hand,
    ...player.table,
    ...opponent.table,
    ...game.crib,
    game.turnCard,
  ];
  let best: { card: Card; ev: number; score: number } | null = null;
  for (const card of legal) {
    const policies = engine === "schell_table-peg_table-14.0"
      ? ["ev", "on", "off"] as PeggingOutcomePolicy[]
      : ["ev"] as PeggingOutcomePolicy[];
    for (const policy of policies) {
      const summary = aggregatePairwisePeggingOutcomes(player.hand, "pone", engine, knownCards, card.rank, policy);
      if (!summary) continue;
      const score = peggingOutcomeWinProbability(game, player, summary.hist);
      const ev = summary.myEv - summary.opponentEv;
      if (
        !best ||
        score > best.score ||
        (score === best.score && ev > best.ev) ||
        (score === best.score && ev === best.ev && VALUES[card.rank] < VALUES[best.card.rank])
      ) {
        best = { card, ev, score };
      }
    }
  }
  return best ? { card: best.card, ev: best.ev } : null;
}

function peggingOutcomeWinProbability(
  game: CribbageGame,
  player: PlayerState,
  hist: Array<[number, number, number]>,
): number {
  const opponent = player === game.human ? game.ai : game.human;
  const perspectiveRole = player === game.pone ? "pone" : "dealer";
  let total = 0;
  let totalWeight = 0;
  for (const [myPegging, opponentPegging, weight] of hist) {
    total += weight * approximateFutureWinProbability(
      player.score + myPegging,
      opponent.score + opponentPegging,
      perspectiveRole,
      "handPone",
    );
    totalWeight += weight;
  }
  return totalWeight ? total / totalWeight : 0.5;
}

function rankCountsForCards(cards: Card[]): RankCounts {
  const ranks = emptyRankCounts();
  for (const card of cards) ranks[card.rank] += 1;
  return ranks;
}

function otherPlayerKey(player: PlayerKey): PlayerKey {
  return player === "human" ? "ai" : "human";
}

function perspectiveScore(perspective: PlayerKey, scorer: PlayerKey, points: number): number {
  return scorer === perspective ? points : -points;
}

function remainingRankCounts(knownCards: Card[]): RankCounts {
  const counts = Array.from({ length: 13 }, () => 4);
  for (const card of knownCards) {
    counts[card.rank] -= 1;
  }
  return counts.map((count) => Math.max(0, count));
}

function ranksAfterPlaying(hand: Card[], played: Card): RankCounts {
  const ranks = emptyRankCounts();
  for (const card of hand) ranks[card.rank] += 1;
  ranks[played.rank] -= 1;
  return ranks;
}

function emptyRankCounts(): RankCounts {
  return Array.from({ length: 13 }, () => 0);
}

function enumerateRankHands(available: RankCounts, size: number): WeightedRankHand[] {
  const hands: WeightedRankHand[] = [];
  const ranks = emptyRankCounts();

  function visit(rank: number, remaining: number, weight: number): void {
    if (rank === 13) {
      if (remaining === 0) hands.push({ ranks: [...ranks], weight });
      return;
    }
    const maxUse = Math.min(available[rank], remaining);
    for (let used = 0; used <= maxUse; used += 1) {
      ranks[rank] = used;
      visit(rank + 1, remaining - used, weight * choose(available[rank], used));
    }
    ranks[rank] = 0;
  }

  visit(0, size, 1);
  return hands;
}

function opponentRankHandsForEngine(
  available: RankCounts,
  size: number,
  opponent: PlayerState,
  opponentRole: "dealer" | "pone",
  engine: Opponent,
): WeightedRankHand[] {
  const prefixRanks = opponent.table.slice(0, 3).map((card) => card.rank);
  const prefixKey = rankPrefixKey(prefixRanks);
  const cacheKey = `${engine}:${opponentRole}:${size}:${available.join("")}:${prefixRanks.length}:${prefixKey}`;
  const cached = OPPONENT_RANK_HANDS_CACHE.get(cacheKey);
  if (cached) return cached;
  const hands = enumerateRankHands(available, size);
  const holdTable = PEGGING_HOLD_TABLES[engine];
  if (!holdTable || hands.length === 0) {
    boundedCacheSet(OPPONENT_RANK_HANDS_CACHE, cacheKey, hands, OPPONENT_RANK_HANDS_CACHE_LIMIT);
    return hands;
  }
  const context = holdTable.roles[opponentRole]?.[String(prefixRanks.length)]?.prefixes[prefixKey];
  if (!context) {
    boundedCacheSet(OPPONENT_RANK_HANDS_CACHE, cacheKey, hands, OPPONENT_RANK_HANDS_CACHE_LIMIT);
    return hands;
  }

  const empiricalHands = hands
    .map((hand) => ({
      ranks: hand.ranks,
      weight: context.remainingHands[rankCountKey(hand.ranks)] ?? 0,
    }))
    .filter((hand) => hand.weight > 0);
  boundedCacheSet(OPPONENT_RANK_HANDS_CACHE, cacheKey, empiricalHands, OPPONENT_RANK_HANDS_CACHE_LIMIT);
  return empiricalHands;
}

function postPeggingWinContext(game: CribbageGame, perspective: PlayerState, engine: Opponent): PostPeggingWinContext {
  const poneHand = upcomingHandScoreDistribution(game, perspective, game.pone, engine);
  const dealerHand = upcomingHandScoreDistribution(game, perspective, game.dealer, engine);
  const crib = upcomingCribScoreDistribution(game);
  return {
    key: [
      engine,
      perspective.key,
      perspective === game.pone ? "pone" : "dealer",
      game.turnCard.id,
      idsKey(game.crib),
      idsKey(game.pone.table),
      idsKey(game.pone.hand),
      idsKey(game.dealer.table),
      idsKey(game.dealer.hand),
      scoreDistributionKey(poneHand),
      scoreDistributionKey(dealerHand),
      scoreDistributionKey(crib),
    ].join("|"),
    perspectiveRole: perspective === game.pone ? "pone" : "dealer",
    poneIsPerspective: game.pone === perspective,
    dealerIsPerspective: game.dealer === perspective,
    poneHand,
    dealerHand,
    crib,
    memo: new Map(),
  };
}

function upcomingHandScoreDistribution(
  game: CribbageGame,
  perspective: PlayerState,
  scorer: PlayerState,
  engine: Opponent,
): ScoreDistribution {
  if (scorer === perspective) {
    return [[scoreHand([...scorer.table, ...scorer.hand], game.turnCard), 1]];
  }
  const knownCards = [
    ...perspective.hand,
    ...perspective.table,
    ...scorer.table,
    ...game.crib,
    game.turnCard,
  ];
  const knownIds = cardIds(knownCards);
  const availableCards = fullDeck().filter((card) => !knownIds.has(card.id));
  const rankCounts = remainingRankCounts(knownCards);
  const opponentHands = opponentRankHandsForEngine(
    rankCounts,
    scorer.hand.length,
    scorer,
    scorer === game.dealer ? "dealer" : "pone",
    engine,
  );
  const outcomes = new Map<number, number>();
  let totalWeight = 0;
  const suitedHandCache = new Map<string, Card[][]>();
  for (const hand of opponentHands) {
    const key = rankCountKey(hand.ranks);
    let suitedHands = suitedHandCache.get(key);
    if (!suitedHands) {
      suitedHands = cardsForRankCounts(availableCards, hand.ranks);
      suitedHandCache.set(key, suitedHands);
    }
    if (!suitedHands.length) continue;
    const suitedWeight = hand.weight / suitedHands.length;
    for (const suitedHand of suitedHands) {
      const score = scoreHand([...scorer.table, ...suitedHand], game.turnCard);
      outcomes.set(score, (outcomes.get(score) ?? 0) + suitedWeight);
      totalWeight += suitedWeight;
    }
  }
  if (!totalWeight) {
    return [[scorePhaseAverage(scorer === game.dealer ? "handDealer" : "handPone"), 1]];
  }
  return [...outcomes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([score, weight]) => [score, weight / totalWeight]);
}

function scorePhaseAverage(phase: ScorePhase): number {
  return BOARD_POSITION_STATS.global[phase]?.average ?? 0;
}

function upcomingCribScoreDistribution(game: CribbageGame): ScoreDistribution {
  const crib = game.dealer.crib.length === 4 ? game.dealer.crib : game.crib;
  if (crib.length === 4) return [[scoreHand(crib, game.turnCard, true), 1]];
  return SCORE_PHASE_DISTRIBUTIONS.crib ?? [[scorePhaseAverage("crib"), 1]];
}

function scoreDistributionKey(distribution: ScoreDistribution): string {
  return distribution.map(([score, weight]) => `${score}:${Math.round(weight * 1_000_000)}`).join(",");
}

function postPeggingWinProbability(
  context: PostPeggingWinContext,
  myScore: number,
  opponentScore: number,
): number {
  if (myScore >= 121) return 1;
  if (opponentScore >= 121) return 0;
  const key = `${Math.round(myScore)}:${Math.round(opponentScore)}`;
  const cached = context.memo.get(key);
  if (cached !== undefined) return cached;
  let total = 0;
  let totalWeight = 0;
  for (const [poneScore, poneWeight] of context.poneHand) {
    const afterPoneMy = myScore + (context.poneIsPerspective ? poneScore : 0);
    const afterPoneOpponent = opponentScore + (context.poneIsPerspective ? 0 : poneScore);
    if (afterPoneMy >= 121) {
      total += poneWeight;
      totalWeight += poneWeight;
      continue;
    }
    if (afterPoneOpponent >= 121) {
      totalWeight += poneWeight;
      continue;
    }
    for (const [dealerScore, dealerWeight] of context.dealerHand) {
      const afterDealerMy = afterPoneMy + (context.dealerIsPerspective ? dealerScore : 0);
      const afterDealerOpponent = afterPoneOpponent + (context.dealerIsPerspective ? 0 : dealerScore);
      if (afterDealerMy >= 121) {
        total += poneWeight * dealerWeight;
        totalWeight += poneWeight * dealerWeight;
        continue;
      }
      if (afterDealerOpponent >= 121) {
        totalWeight += poneWeight * dealerWeight;
        continue;
      }
      for (const [cribScore, cribWeight] of context.crib) {
        const afterCribMy = afterDealerMy + (context.dealerIsPerspective ? cribScore : 0);
        const afterCribOpponent = afterDealerOpponent + (context.dealerIsPerspective ? 0 : cribScore);
        const weight = poneWeight * dealerWeight * cribWeight;
        if (afterCribMy >= 121) {
          total += weight;
        } else if (afterCribOpponent < 121) {
          total += weight * approximateFutureWinProbability(
            afterCribMy,
            afterCribOpponent,
            nextPerspectiveRole(context.perspectiveRole, "crib"),
            nextScorePhase("crib"),
          );
        }
        totalWeight += weight;
      }
    }
  }
  const probability = totalWeight ? total / totalWeight : approximateFutureWinProbability(myScore, opponentScore, context.perspectiveRole, "handPone");
  context.memo.set(key, probability);
  return probability;
}

function model13PeggingDecisionCacheKey(game: CribbageGame, player: PlayerState): string {
  const opponent = player === game.human ? game.ai : game.human;
  return [
    game.playerEngines[player.key],
    player.key,
    player === game.dealer ? "dealer" : "pone",
    game.human.score,
    game.ai.score,
    game.count,
    game.turn,
    game.goPlayer?.key ?? "-",
    game.lastPlayer?.key ?? "-",
    game.turnCard.id,
    idsKey(game.crib),
    idsKey(player.hand),
    idsKey(player.table),
    idsKey(opponent.table),
    ranksKey(game.plays),
    game.playOwners.join(""),
  ].join("|");
}

function model13TreeCacheLimit(): number {
  const configured = (globalThis as unknown as { __CRIBBAGE_MODEL13_TREE_CACHE_LIMIT?: unknown }).__CRIBBAGE_MODEL13_TREE_CACHE_LIMIT;
  const parsed = typeof configured === "number"
    ? configured
    : typeof configured === "string"
      ? Number.parseInt(configured, 10)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 10000;
}

function idsKey(cards: Card[]): string {
  return cards.map((card) => card.id).sort((a, b) => a - b).join(",");
}

function ranksKey(cards: Card[]): string {
  return cards.map((card) => card.rank).join(",");
}

function trimModel13PeggingDecisionCache(): void {
  while (MODEL13_PEGGING_DECISION_CACHE.size > MODEL13_PEGGING_DECISION_CACHE_LIMIT) {
    const oldest = MODEL13_PEGGING_DECISION_CACHE.keys().next().value;
    if (oldest === undefined) return;
    MODEL13_PEGGING_DECISION_CACHE.delete(oldest);
  }
}

function orderedModel13PoneLeadCards(hand: Card[], legal: Card[], engine: Opponent = "schell_table-peg_table-13.0"): Card[] {
  const table = PONE_LEAD_FREQUENCY_TABLES[engine] ?? PONE_LEAD_FREQUENCY_TABLES["schell_table-peg_table-13.0"];
  const entry = table?.table[rankCountsForCards(hand).join("")];
  if (!entry) return [...legal];
  const rankOrder = new Map(entry.order.map((item, index) => [RANKS.indexOf(item.rank), index]));
  return [...legal].sort((a, b) => {
    const aRank = rankOrder.get(a.rank);
    const bRank = rankOrder.get(b.rank);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return 0;
  });
}

function rankPrefixKey(ranks: number[]): string {
  return [...ranks].sort((a, b) => a - b).map((rank) => RANKS[rank]).join(",");
}

function rankCountKey(ranks: RankCounts): string {
  return ranks.join("");
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

function simulatePegging(state: PegSimulationState): WeightedScore {
  const memo = new Map<string, WeightedScore>();
  return simulatePeggingFuture(state, memo);
}

function simulatePeggingFuture(
  state: PegSimulationState,
  memo: Map<string, WeightedScore>,
): WeightedScore {
  const key = pegSimulationKey(state);
  const cached = memo.get(key);
  if (cached) return cached;

  const remainingCards = rankCountTotal(state.hands.human) + rankCountTotal(state.hands.ai);
  if (remainingCards === 0) {
    const lastPoint = state.lastPlayer && state.count !== 0
      ? perspectiveScore(state.perspective, state.lastPlayer, 1)
      : 0;
    const terminal = { total: lastPoint, weight: 1 };
    memo.set(key, terminal);
    return terminal;
  }

  const legalRanks = legalPegRanks(state.hands[state.current], state.count);
  if (legalRanks.length === 0) {
    if (state.goPlayer) {
      const goPoint = state.lastPlayer && state.count !== 31
        ? perspectiveScore(state.perspective, state.lastPlayer, 1)
        : 0;
      const future = simulatePeggingFuture({
        ...state,
        plays: [],
        count: 0,
        current: otherPlayerKey(state.current),
        goPlayer: null,
        lastPlayer: null,
      }, memo);
      const result = { total: (goPoint * future.weight) + future.total, weight: future.weight };
      memo.set(key, result);
      return result;
    }
    const result = simulatePeggingFuture({
      ...state,
      current: otherPlayerKey(state.current),
      goPlayer: state.current,
    }, memo);
    memo.set(key, result);
    return result;
  }

  let total = 0;
  let weight = 0;
  for (const rank of legalRanks) {
    const branchWeight = state.hands[state.current][rank];
    const hands = {
      human: [...state.hands.human],
      ai: [...state.hands.ai],
    };
    hands[state.current][rank] -= 1;
    const plays = [...state.plays, rank];
    const points = scoreCount(plays.map((playedRank) => pegCardCache[playedRank]));
    const nextCount = state.count + pegCardCache[rank].value;
    const nextState: PegSimulationState = nextCount === 31
      ? {
          ...state,
          hands,
          plays: [],
          count: 0,
          current: otherPlayerKey(state.current),
          goPlayer: null,
          lastPlayer: null,
        }
      : {
          ...state,
          hands,
          plays,
          count: nextCount,
          current: otherPlayerKey(state.current),
          goPlayer: null,
          lastPlayer: state.current,
        };
    const future = simulatePeggingFuture(nextState, memo);
    const signedPoints = perspectiveScore(state.perspective, state.current, points);
    total += branchWeight * ((signedPoints * future.weight) + future.total);
    weight += branchWeight * future.weight;
  }

  const result = { total, weight };
  memo.set(key, result);
  return result;
}

function simulatePeggingComponentFuture(
  state: PegSimulationState,
  memo: Map<string, WeightedPegComponents>,
): WeightedPegComponents {
  const key = pegSimulationKey(state);
  const cached = memo.get(key);
  if (cached) return cached;

  const remainingCards = rankCountTotal(state.hands.human) + rankCountTotal(state.hands.ai);
  if (remainingCards === 0) {
    const components: AnalyticsEvComponents = {};
    if (state.lastPlayer && state.count !== 0) {
      addSignedPegComponents(components, { total: 1, lastCard: 1 }, state.lastPlayer === state.perspective ? 1 : -1, 1);
    }
    const terminal = { components, weight: 1 };
    memo.set(key, terminal);
    return terminal;
  }

  const legalRanks = legalPegRanks(state.hands[state.current], state.count);
  if (legalRanks.length === 0) {
    if (state.goPlayer) {
      const future = simulatePeggingComponentFuture({
        ...state,
        plays: [],
        count: 0,
        current: otherPlayerKey(state.current),
        goPlayer: null,
        lastPlayer: null,
      }, memo);
      const components = scaleEvComponents(future.components, 1);
      if (state.lastPlayer && state.count !== 31) {
        addSignedPegComponents(components, { total: 1, go: 1 }, state.lastPlayer === state.perspective ? 1 : -1, future.weight);
      }
      const result = { components, weight: future.weight };
      memo.set(key, result);
      return result;
    }
    const result = simulatePeggingComponentFuture({
      ...state,
      current: otherPlayerKey(state.current),
      goPlayer: state.current,
    }, memo);
    memo.set(key, result);
    return result;
  }

  const components: AnalyticsEvComponents = {};
  let weight = 0;
  for (const rank of legalRanks) {
    const branchWeight = state.hands[state.current][rank];
    const hands = {
      human: [...state.hands.human],
      ai: [...state.hands.ai],
    };
    hands[state.current][rank] -= 1;
    const plays = [...state.plays, rank];
    const scoreComponents = scoreCountComponents(plays.map((playedRank) => pegCardCache[playedRank]));
    const nextCount = state.count + pegCardCache[rank].value;
    const nextState: PegSimulationState = nextCount === 31
      ? {
          ...state,
          hands,
          plays: [],
          count: 0,
          current: otherPlayerKey(state.current),
          goPlayer: null,
          lastPlayer: null,
        }
      : {
          ...state,
          hands,
          plays,
          count: nextCount,
          current: otherPlayerKey(state.current),
          goPlayer: null,
          lastPlayer: state.current,
        };
    const future = simulatePeggingComponentFuture(nextState, memo);
    mergeEvComponents(components, future.components, branchWeight);
    addSignedPegComponents(
      components,
      scoreComponents,
      state.current === state.perspective ? 1 : -1,
      branchWeight * future.weight,
    );
    weight += future.weight * branchWeight;
  }

  const result = { components, weight };
  memo.set(key, result);
  return result;
}

function scaleEvComponents(components: AnalyticsEvComponents, scale: number): AnalyticsEvComponents {
  return Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value * scale]));
}

function mergeEvComponents(target: AnalyticsEvComponents, source: AnalyticsEvComponents, scale: number): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + (value * scale);
  }
}

function addSignedPegComponents(
  target: AnalyticsEvComponents,
  source: AnalyticsScoreComponents,
  sign: 1 | -1,
  scale: number,
): void {
  const mapping: Array<[keyof AnalyticsScoreComponents, string]> = [
    ["fifteens", "pegFifteens"],
    ["thirtyOne", "pegThirtyOne"],
    ["pairs", "pegPairs"],
    ["runs", "pegRuns"],
    ["go", "pegGo"],
    ["lastCard", "pegLastCard"],
    ["heels", "pegHeels"],
  ];
  for (const [sourceKey, targetKey] of mapping) {
    const value = source[sourceKey] ?? 0;
    if (value) target[targetKey] = (target[targetKey] ?? 0) + (sign * value * scale);
  }
}

function legalPegRanks(ranks: RankCounts, count: number): number[] {
  const legal: number[] = [];
  for (let rank = 0; rank < ranks.length; rank += 1) {
    if (ranks[rank] > 0 && count + pegCardCache[rank].value <= 31) legal.push(rank);
  }
  return legal;
}

function rankCountTotal(ranks: RankCounts): number {
  return ranks.reduce((total, count) => total + count, 0);
}

function pegSimulationKey(state: PegSimulationState): string {
  return [
    state.hands.human.join(""),
    state.hands.ai.join(""),
    state.plays.join(","),
    state.count,
    state.current,
    state.goPlayer ?? "-",
    state.lastPlayer ?? "-",
    state.perspective,
  ].join("|");
}

function exhaustivePeggingCandidateScore(
  game: CribbageGame,
  player: PlayerState,
  card: Card,
  opponentHands: WeightedRankHand[],
  engine: Opponent,
): { choiceScore: number; pointEv: number } {
  if (usesModel13LivePegging(engine)) {
    const distribution = optimalPeggingOutcomeDistributionForCandidate(game, player, card, opponentHands);
    return {
      choiceScore: expectedWinProbabilityAfterPegging(game, player, distribution),
      pointEv: peggingDistributionPointEv(distribution),
    };
  }
  const pointEv = exhaustivePeggingPointEv(game, player, card, opponentHands);
  if (!usesWinProbabilityPegging(engine)) return { choiceScore: pointEv, pointEv };
  const distribution = peggingOutcomeDistributionForCandidate(game, player, card, opponentHands);
  const winProbability = expectedWinProbabilityAfterPegging(game, player, distribution);
  return { choiceScore: winProbability, pointEv };
}

function exhaustivePeggingPointEv(
  game: CribbageGame,
  player: PlayerState,
  card: Card,
  opponentHands: WeightedRankHand[],
): number {
  const ownRanks = ranksAfterPlaying(player.hand, card);
  let weightedTotal = 0;
  let totalWeight = 0;
  const immediateScore = scoreCount([...game.plays, card]);
  const countAfterPlay = game.count + card.value;
  for (const possibleOpponentHand of opponentHands) {
    const result = simulatePegging({
      hands: player === game.human
        ? { human: ownRanks, ai: possibleOpponentHand.ranks }
        : { human: possibleOpponentHand.ranks, ai: ownRanks },
      plays: countAfterPlay === 31 ? [] : [...game.plays, card].map((playedCard) => playedCard.rank),
      count: countAfterPlay === 31 ? 0 : countAfterPlay,
      current: otherPlayerKey(player.key),
      goPlayer: null,
      lastPlayer: countAfterPlay === 31 ? null : player.key,
      perspective: player.key,
    });
    weightedTotal += ((immediateScore * result.weight) + result.total) * possibleOpponentHand.weight;
    totalWeight += result.weight * possibleOpponentHand.weight;
  }
  return totalWeight ? weightedTotal / totalWeight : immediateScore;
}

function peggingPlayEvComponents(
  game: CribbageGame,
  player: PlayerState,
  card: Card,
  engine: Opponent,
): AnalyticsEvComponents {
  if (!usesExhaustivePegging(engine)) {
    return roundEvComponents(immediatePeggingEvComponents(game.plays, card));
  }
  const opponent = player === game.human ? game.ai : game.human;
  const knownCards = [
    ...player.hand,
    ...player.table,
    ...opponent.table,
    ...game.crib,
    game.turnCard,
  ];
  const rankCounts = remainingRankCounts(knownCards);
  const opponentHands = opponentRankHandsForEngine(
    rankCounts,
    opponent.hand.length,
    opponent,
    opponent === game.dealer ? "dealer" : "pone",
    engine,
  );
  const ownRanks = ranksAfterPlaying(player.hand, card);
  const immediateComponents = scoreCountComponents([...game.plays, card]);
  const countAfterPlay = game.count + card.value;
  const memo = new Map<string, WeightedPegComponents>();
  const totals: AnalyticsEvComponents = {};
  let totalWeight = 0;
  for (const possibleOpponentHand of opponentHands) {
    const result = simulatePeggingComponentFuture({
      hands: player === game.human
        ? { human: ownRanks, ai: possibleOpponentHand.ranks }
        : { human: possibleOpponentHand.ranks, ai: ownRanks },
      plays: countAfterPlay === 31 ? [] : [...game.plays, card].map((playedCard) => playedCard.rank),
      count: countAfterPlay === 31 ? 0 : countAfterPlay,
      current: otherPlayerKey(player.key),
      goPlayer: null,
      lastPlayer: countAfterPlay === 31 ? null : player.key,
      perspective: player.key,
    }, memo);
    mergeEvComponents(totals, result.components, possibleOpponentHand.weight);
    addSignedPegComponents(totals, immediateComponents, 1, result.weight * possibleOpponentHand.weight);
    totalWeight += result.weight * possibleOpponentHand.weight;
  }
  if (!totalWeight) return roundEvComponents(immediatePeggingEvComponents(game.plays, card));
  return roundEvComponents(scaleEvComponents(totals, 1 / totalWeight));
}

function immediatePeggingEvComponents(plays: Card[], card: Card): AnalyticsEvComponents {
  const components: AnalyticsEvComponents = {};
  addSignedPegComponents(components, scoreCountComponents([...plays, card]), 1, 1);
  return components;
}

function peggingOutcomeDistributionForCandidate(
  game: CribbageGame,
  player: PlayerState,
  card: Card,
  opponentHands: WeightedRankHand[],
): PeggingOutcomeDistribution {
  const ownRanks = ranksAfterPlaying(player.hand, card);
  const immediateScore = scoreCount([...game.plays, card]);
  const countAfterPlay = game.count + card.value;
  const memo = new Map<string, PeggingOutcomeDistribution>();
  const outcomes = new Map<number, number>();
  let totalWeight = 0;

  for (const possibleOpponentHand of opponentHands) {
    const result = simulatePeggingDistribution({
      hands: player === game.human
        ? { human: ownRanks, ai: possibleOpponentHand.ranks }
        : { human: possibleOpponentHand.ranks, ai: ownRanks },
      plays: countAfterPlay === 31 ? [] : [...game.plays, card].map((playedCard) => playedCard.rank),
      count: countAfterPlay === 31 ? 0 : countAfterPlay,
      current: otherPlayerKey(player.key),
      goPlayer: null,
      lastPlayer: countAfterPlay === 31 ? null : player.key,
      perspective: player.key,
    }, memo);
    for (const [key, weight] of result.outcomes) {
      const [my, opponent] = parseOutcomeKey(key);
      addOutcome(outcomes, my + immediateScore, opponent, weight * possibleOpponentHand.weight);
    }
    totalWeight += result.totalWeight * possibleOpponentHand.weight;
  }
  return { outcomes, totalWeight };
}

function optimalPeggingOutcomeDistributionForCandidate(
  game: CribbageGame,
  player: PlayerState,
  card: Card,
  opponentHands: WeightedRankHand[],
): PeggingOutcomeDistribution {
  const opponent = player === game.human ? game.ai : game.human;
  const engine = game.playerEngines[player.key];
  const winContext = postPeggingWinContext(game, player, engine);
  const ownRanks = ranksAfterPlaying(player.hand, card);
  const immediateScore = scoreCount([...game.plays, card]);
  const countAfterPlay = game.count + card.value;
  const rootScores = { human: game.human.score, ai: game.ai.score };
  const outcomes = new Map<number, number>();
  let totalWeight = 0;

  if (rootScores[player.key] + immediateScore >= 121) {
    addOutcomeForPlayer(outcomes, player.key, player.key, immediateScore, 1);
    return { outcomes, totalWeight: 1 };
  }

  for (const possibleOpponentHand of opponentHands) {
    const scores = {
      ...rootScores,
      [player.key]: rootScores[player.key] + immediateScore,
    };
    const result = simulateOptimalPeggingDistribution({
      hands: player === game.human
        ? { human: ownRanks, ai: possibleOpponentHand.ranks }
        : { human: possibleOpponentHand.ranks, ai: ownRanks },
      plays: countAfterPlay === 31 ? [] : [...game.plays, card].map((playedCard) => playedCard.rank),
      count: countAfterPlay === 31 ? 0 : countAfterPlay,
      current: otherPlayerKey(player.key),
      goPlayer: null,
      lastPlayer: countAfterPlay === 31 ? null : player.key,
      perspective: player.key,
      scores,
      rootScores,
      perspectiveRole: player === game.pone ? "pone" : "dealer",
      postPeggingContext: winContext,
    });
    for (const [key, weight] of result.outcomes) {
      const [my, opponentPoints] = parseOutcomeKey(key);
      addOutcome(outcomes, my, opponentPoints, weight * possibleOpponentHand.weight);
    }
    totalWeight += result.totalWeight * possibleOpponentHand.weight;
  }
  return { outcomes, totalWeight };
}

function simulateOptimalPeggingDistribution(state: OptimalPegSimulationState): PeggingOutcomeDistribution {
  const key = optimalPegSimulationKey(state);
  const cached = MODEL13_OPTIMAL_PEGGING_TREE_CACHE.get(key);
  if (cached) return cached;

  const remainingCards = rankCountTotal(state.hands.human) + rankCountTotal(state.hands.ai);
  if (remainingCards === 0) {
    const scores = { ...state.scores };
    if (state.lastPlayer && state.count !== 0) scores[state.lastPlayer] += 1;
    const result = outcomeFromScores(state.rootScores, scores, state.perspective);
    cacheModel13OptimalPeggingTree(key, result);
    return result;
  }

  const legalRanks = legalPegRanks(state.hands[state.current], state.count);
  if (legalRanks.length === 0) {
    if (state.goPlayer) {
      const scores = { ...state.scores };
      if (state.lastPlayer && state.count !== 31) {
        scores[state.lastPlayer] += 1;
        if (scores[state.lastPlayer] >= 121) {
          const result = outcomeFromScores(state.rootScores, scores, state.perspective);
          cacheModel13OptimalPeggingTree(key, result);
          return result;
        }
      }
      const result = simulateOptimalPeggingDistribution({
        ...state,
        scores,
        plays: [],
        count: 0,
        current: otherPlayerKey(state.current),
        goPlayer: null,
        lastPlayer: null,
      });
      cacheModel13OptimalPeggingTree(key, result);
      return result;
    }
    const result = simulateOptimalPeggingDistribution({
      ...state,
      current: otherPlayerKey(state.current),
      goPlayer: state.current,
    });
    cacheModel13OptimalPeggingTree(key, result);
    return result;
  }

  let best: PeggingOutcomeDistribution | null = null;
  let bestScore = state.current === state.perspective ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let bestPointEv = Number.NEGATIVE_INFINITY;
  for (const rank of legalRanks) {
    const candidate = optimalPeggingBranch(state, rank);
    const score = expectedWinProbabilityForDistribution(
      state.rootScores,
      state.perspective,
      state.perspectiveRole,
      candidate,
      state.postPeggingContext,
    );
    const pointEv = peggingDistributionPointEv(candidate);
    const isBetter = state.current === state.perspective
      ? score > bestScore || (score === bestScore && pointEv > bestPointEv)
      : score < bestScore || (score === bestScore && pointEv < bestPointEv);
    if (!best || isBetter) {
      best = candidate;
      bestScore = score;
      bestPointEv = pointEv;
    }
  }
  const result = best ?? { outcomes: new Map([[outcomeKey(0, 0), 1]]), totalWeight: 1 };
  cacheModel13OptimalPeggingTree(key, result);
  return result;
}

function optimalPeggingBranch(state: OptimalPegSimulationState, rank: number): PeggingOutcomeDistribution {
  const hands = {
    human: [...state.hands.human],
    ai: [...state.hands.ai],
  };
  hands[state.current][rank] -= 1;
  const plays = [...state.plays, rank];
  const points = scoreCount(plays.map((playedRank) => pegCardCache[playedRank]));
  const nextCount = state.count + pegCardCache[rank].value;
  const scores = { ...state.scores };
  scores[state.current] += points;
  if (scores[state.current] >= 121) return outcomeFromScores(state.rootScores, scores, state.perspective);
  const nextState: OptimalPegSimulationState = nextCount === 31
    ? {
        ...state,
        hands,
        scores,
        plays: [],
        count: 0,
        current: otherPlayerKey(state.current),
        goPlayer: null,
        lastPlayer: null,
      }
    : {
        ...state,
        hands,
        scores,
        plays,
        count: nextCount,
        current: otherPlayerKey(state.current),
        goPlayer: null,
        lastPlayer: state.current,
      };
  return simulateOptimalPeggingDistribution(nextState);
}

function outcomeFromScores(
  rootScores: Record<PlayerKey, number>,
  scores: Record<PlayerKey, number>,
  perspective: PlayerKey,
): PeggingOutcomeDistribution {
  const opponent = otherPlayerKey(perspective);
  return {
    outcomes: new Map([[outcomeKey(
      Math.max(0, scores[perspective] - rootScores[perspective]),
      Math.max(0, scores[opponent] - rootScores[opponent]),
    ), 1]]),
    totalWeight: 1,
  };
}

function expectedWinProbabilityForDistribution(
  rootScores: Record<PlayerKey, number>,
  perspective: PlayerKey,
  perspectiveRole: "dealer" | "pone",
  distribution: PeggingOutcomeDistribution,
  postPeggingContext?: PostPeggingWinContext,
): number {
  if (!distribution.totalWeight) return 0;
  const opponent = otherPlayerKey(perspective);
  let total = 0;
  for (const [outcomeKey, weight] of distribution.outcomes) {
    const [myPegging, opponentPegging] = parseOutcomeKey(outcomeKey);
    const myScore = rootScores[perspective] + myPegging;
    const opponentScore = rootScores[opponent] + opponentPegging;
    total += weight * (postPeggingContext
      ? postPeggingWinProbability(postPeggingContext, myScore, opponentScore)
      : approximateFutureWinProbability(myScore, opponentScore, perspectiveRole, "handPone"));
  }
  return total / distribution.totalWeight;
}

function peggingDistributionPointEv(distribution: PeggingOutcomeDistribution): number {
  if (!distribution.totalWeight) return 0;
  let total = 0;
  for (const [key, weight] of distribution.outcomes) {
    const [my, opponent] = parseOutcomeKey(key);
    total += (my - opponent) * weight;
  }
  return total / distribution.totalWeight;
}

function optimalPegSimulationKey(state: OptimalPegSimulationState): string {
  return [
    pegSimulationKey(state),
    state.scores.human,
    state.scores.ai,
    state.rootScores.human,
    state.rootScores.ai,
    state.perspectiveRole,
    state.postPeggingContext.key,
  ].join("|");
}

function cacheModel13OptimalPeggingTree(key: string, result: PeggingOutcomeDistribution): void {
  MODEL13_OPTIMAL_PEGGING_TREE_CACHE.set(key, result);
  while (MODEL13_OPTIMAL_PEGGING_TREE_CACHE.size > MODEL13_OPTIMAL_PEGGING_TREE_CACHE_LIMIT) {
    const oldest = MODEL13_OPTIMAL_PEGGING_TREE_CACHE.keys().next().value;
    if (oldest === undefined) return;
    MODEL13_OPTIMAL_PEGGING_TREE_CACHE.delete(oldest);
  }
}

function simulatePeggingDistribution(
  state: PegSimulationState,
  memo: Map<string, PeggingOutcomeDistribution>,
): PeggingOutcomeDistribution {
  const key = pegSimulationKey(state);
  const cached = memo.get(key);
  if (cached) return cached;

  const remainingCards = rankCountTotal(state.hands.human) + rankCountTotal(state.hands.ai);
  if (remainingCards === 0) {
    const outcomes = new Map<number, number>();
    if (state.lastPlayer && state.count !== 0) {
      addOutcomeForPlayer(outcomes, state.perspective, state.lastPlayer, 1, 1);
    } else {
      addOutcome(outcomes, 0, 0, 1);
    }
    const terminal = { outcomes, totalWeight: 1 };
    memo.set(key, terminal);
    return terminal;
  }

  const legalRanks = legalPegRanks(state.hands[state.current], state.count);
  if (legalRanks.length === 0) {
    if (state.goPlayer) {
      const future = simulatePeggingDistribution({
        ...state,
        plays: [],
        count: 0,
        current: otherPlayerKey(state.current),
        goPlayer: null,
        lastPlayer: null,
      }, memo);
      const outcomes = new Map<number, number>();
      const goPlayer = state.lastPlayer && state.count !== 31 ? state.lastPlayer : null;
      for (const [futureKey, weight] of future.outcomes) {
        const [my, opponent] = parseOutcomeKey(futureKey);
        if (goPlayer) {
          const goForPerspective = goPlayer === state.perspective;
          addOutcome(outcomes, my + (goForPerspective ? 1 : 0), opponent + (goForPerspective ? 0 : 1), weight);
        } else {
          addOutcome(outcomes, my, opponent, weight);
        }
      }
      const result = { outcomes, totalWeight: future.totalWeight };
      memo.set(key, result);
      return result;
    }
    const result = simulatePeggingDistribution({
      ...state,
      current: otherPlayerKey(state.current),
      goPlayer: state.current,
    }, memo);
    memo.set(key, result);
    return result;
  }

  const outcomes = new Map<number, number>();
  let totalWeight = 0;
  for (const rank of legalRanks) {
    const branchWeight = state.hands[state.current][rank];
    const hands = {
      human: [...state.hands.human],
      ai: [...state.hands.ai],
    };
    hands[state.current][rank] -= 1;
    const plays = [...state.plays, rank];
    const points = scoreCount(plays.map((playedRank) => pegCardCache[playedRank]));
    const nextCount = state.count + pegCardCache[rank].value;
    const nextState: PegSimulationState = nextCount === 31
      ? {
          ...state,
          hands,
          plays: [],
          count: 0,
          current: otherPlayerKey(state.current),
          goPlayer: null,
          lastPlayer: null,
        }
      : {
          ...state,
          hands,
          plays,
          count: nextCount,
          current: otherPlayerKey(state.current),
          goPlayer: null,
          lastPlayer: state.current,
        };
    const future = simulatePeggingDistribution(nextState, memo);
    for (const [futureKey, weight] of future.outcomes) {
      const [my, opponent] = parseOutcomeKey(futureKey);
      const scoreForPerspective = state.current === state.perspective;
      addOutcome(
        outcomes,
        my + (scoreForPerspective ? points : 0),
        opponent + (scoreForPerspective ? 0 : points),
        weight * branchWeight,
      );
    }
    totalWeight += future.totalWeight * branchWeight;
  }

  const result = { outcomes, totalWeight };
  memo.set(key, result);
  return result;
}

function expectedWinProbabilityAfterPegging(
  game: CribbageGame,
  player: PlayerState,
  distribution: PeggingOutcomeDistribution,
): number {
  if (!distribution.totalWeight) return 0;
  const opponent = player === game.human ? game.ai : game.human;
  const winContext = postPeggingWinContext(game, player, game.playerEngines[player.key]);
  let total = 0;
  for (const [key, weight] of distribution.outcomes) {
    const [myPegging, opponentPegging] = parseOutcomeKey(key);
    const myScore = player.score + myPegging;
    const opponentScore = opponent.score + opponentPegging;
    total += weight * postPeggingWinProbability(winContext, myScore, opponentScore);
  }
  return total / distribution.totalWeight;
}

function discardChoiceWinProbability(
  game: CribbageGame,
  player: PlayerState,
  components: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>,
  engine: Opponent,
): number {
  if (!usesWinProbabilityPegging(engine)) return 0.5;
  const opponent = player === game.human ? game.ai : game.human;
  const netPegging = player === game.dealer
    ? components.peggingDealer ?? 0
    : components.peggingPone ?? 0;
  const myPegging = Math.max(0, netPegging);
  const opponentPegging = Math.max(0, -netPegging);
  const myHand = player === game.dealer
    ? components.handDealer ?? 0
    : components.handPone ?? 0;
  const myCrib = player === game.dealer ? components.crib ?? 0 : 0;
  const opponentCrib = player === game.pone ? -(components.crib ?? 0) : 0;
  const myScore = player.score + myPegging + myHand + myCrib;
  const opponentScore = opponent.score + opponentPegging + opponentCrib;
  const nextRole = player === game.dealer ? "pone" : "dealer";
  return approximateFutureWinProbability(myScore, opponentScore, nextRole, "peggingPone");
}

function peggingPlayReviewValues(
  game: CribbageGame,
  player: PlayerState,
  card: Card,
  engine: Opponent,
): { pointEv: number; winProbability: number } {
  if (!usesExhaustivePegging(engine)) {
    const pointEv = peggingPlayEv(game, player, card, engine, game.pegTableLeads[player.key]);
    const pointScore = Math.max(0, pointEv);
    const myScore = player.score + pointScore;
    const opponent = player === game.human ? game.ai : game.human;
    return {
      pointEv,
      winProbability: approximateFutureWinProbability(
        myScore,
        opponent.score,
        player === game.pone ? "pone" : "dealer",
        "handPone",
      ),
    };
  }
  const opponent = player === game.human ? game.ai : game.human;
  const knownCards = [
    ...player.hand,
    ...player.table,
    ...opponent.table,
    ...game.crib,
    game.turnCard,
  ];
  const rankCounts = remainingRankCounts(knownCards);
  const opponentHands = opponentRankHandsForEngine(
    rankCounts,
    opponent.hand.length,
    opponent,
    opponent === game.dealer ? "dealer" : "pone",
    engine,
  );
  const distribution = usesModel13LivePegging(engine)
    ? optimalPeggingOutcomeDistributionForCandidate(game, player, card, opponentHands)
    : peggingOutcomeDistributionForCandidate(game, player, card, opponentHands);
  const pointEv = usesModel13LivePegging(engine)
    ? peggingDistributionPointEv(distribution)
    : exhaustivePeggingPointEv(game, player, card, opponentHands);
  return {
    pointEv,
    winProbability: expectedWinProbabilityAfterPegging(game, player, distribution),
  };
}

const WIN_PROBABILITY_MEMO = new Map<string, number>();

export function approximateFutureWinProbability(
  myScore: number,
  opponentScore: number,
  perspectiveRole: "dealer" | "pone",
  phase: ScorePhase,
): number {
  const my = Math.min(121, Math.max(0, Math.round(myScore)));
  const opponent = Math.min(121, Math.max(0, Math.round(opponentScore)));
  if (my >= 121) return 1;
  if (opponent >= 121) return 0;
  if (my < 90 && opponent < 90) return heuristicWinProbability(my, opponent, perspectiveRole);
  const key = `${my}:${opponent}:${perspectiveRole}:${phase}`;
  const cached = WIN_PROBABILITY_MEMO.get(key);
  if (cached !== undefined) return cached;
  WIN_PROBABILITY_MEMO.set(key, 0.5);

  const scorerRole = phase === "peggingPone" || phase === "handPone" ? "pone" : "dealer";
  const perspectiveScores = perspectiveRole === scorerRole;
  const distribution = SCORE_PHASE_DISTRIBUTIONS[phase];
  let probability = 0;
  for (const [points, weight] of distribution) {
    if (perspectiveScores) {
      const nextMy = my + points;
      probability += weight * (nextMy >= 121
        ? 1
        : approximateFutureWinProbability(nextMy, opponent, nextPerspectiveRole(perspectiveRole, phase), nextScorePhase(phase)));
    } else {
      const nextOpponent = opponent + points;
      probability += weight * (nextOpponent >= 121
        ? 0
        : approximateFutureWinProbability(my, nextOpponent, nextPerspectiveRole(perspectiveRole, phase), nextScorePhase(phase)));
    }
  }
  WIN_PROBABILITY_MEMO.set(key, probability);
  return probability;
}

function heuristicWinProbability(
  myScore: number,
  opponentScore: number,
  perspectiveRole: "dealer" | "pone",
): number {
  const roleBonus = perspectiveRole === "dealer" ? 2.4 : -1.2;
  const scoreEdge = myScore - opponentScore + roleBonus;
  return Math.max(0.02, Math.min(0.98, 0.5 + scoreEdge / 80));
}

function nextScorePhase(phase: ScorePhase): ScorePhase {
  if (phase === "peggingPone") return "peggingDealer";
  if (phase === "peggingDealer") return "handPone";
  if (phase === "handPone") return "handDealer";
  if (phase === "handDealer") return "crib";
  return "peggingPone";
}

function nextPerspectiveRole(role: "dealer" | "pone", phase: ScorePhase): "dealer" | "pone" {
  if (phase !== "crib") return role;
  return role === "dealer" ? "pone" : "dealer";
}

function scorePhaseDistribution(stats: ScorePhaseStats | undefined): Array<[number, number]> {
  if (!stats) return [[0, 1]];
  const min = Math.max(0, Math.floor(stats.min));
  const max = Math.max(min, Math.ceil(stats.max));
  if (stats.standardDeviation <= 0) return [[Math.round(stats.average), 1]];
  const values: Array<[number, number]> = [];
  let total = 0;
  for (let points = min; points <= max; points += 1) {
    const low = points - 0.5;
    const high = points + 0.5;
    const probability = normalCdf(high, stats.average, stats.standardDeviation) -
      normalCdf(low, stats.average, stats.standardDeviation);
    if (probability > 0) {
      values.push([points, probability]);
      total += probability;
    }
  }
  return values.map(([points, probability]) => [points, probability / total]);
}

function normalCdf(value: number, meanValue: number, standardDeviation: number): number {
  return 0.5 * (1 + erf((value - meanValue) / (standardDeviation * Math.SQRT2)));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function outcomeKey(my: number, opponent: number): number {
  return (Math.max(0, Math.round(my)) * 64) + Math.max(0, Math.round(opponent));
}

function addOutcome(outcomes: Map<number, number>, my: number, opponent: number, weight: number): void {
  const key = outcomeKey(my, opponent);
  outcomes.set(key, (outcomes.get(key) ?? 0) + weight);
}

function addOutcomeForPlayer(
  outcomes: Map<number, number>,
  perspective: PlayerKey,
  player: PlayerKey,
  points: number,
  weight: number,
): void {
  addOutcome(outcomes, player === perspective ? points : 0, player === perspective ? 0 : points, weight);
}

function parseOutcomeKey(key: number): [number, number] {
  return [Math.floor(key / 64), key % 64];
}

function expectedCribScore(
  discard: Card[],
  deck: Card[],
  myCrib: boolean,
  engine: Opponent,
  cribFlushBonusBySuit: number[] | null,
): number {
  const table = DISCARD_TABLES[engine as DiscardTableEngine];
  if (table) {
    const ranks = discard.map((card) => card.rank).sort((a, b) => a - b);
    const baseScore = (myCrib ? table.own : table.opponent)[ranks[0]][ranks[1]];
    return baseScore + (usesCribFlushAdjustment(engine) ? expectedCribFlushBonus(discard, cribFlushBonusBySuit) : 0);
  }
  let cribTotal = 0;
  let cribCount = 0;
  for (const pot of combinations(deck, 3, 3)) {
    cribTotal += scoreHand([...discard, pot[0], pot[1]], pot[2], true);
    cribCount += 1;
  }
  return cribTotal / cribCount;
}

function cribFlushBonusesBySuit(hand: Card[]): number[] {
  const suitCounts = Array.from({ length: 4 }, () => 0);
  for (const card of hand) suitCounts[card.suit] += 1;
  return suitCounts.map((count) => CRIB_FLUSH_BONUS_BY_SUIT_COUNT[count] ?? 0);
}

function expectedCribFlushBonus(discard: Card[], cribFlushBonusBySuit: number[] | null): number {
  if (discard.length !== 2 || discard[0].suit !== discard[1].suit) return 0;
  return cribFlushBonusBySuit?.[discard[0].suit] ?? 0;
}

function averageHandEvComponents(keep: Card[], deck: Card[]): AnalyticsEvComponents {
  const totals: AnalyticsEvComponents = {
    handFifteens: 0,
    handPairs: 0,
    handRuns: 0,
    handFlush: 0,
    handKnobs: 0,
  };
  for (const cut of deck) {
    const components = scoreHandComponents(keep, cut);
    totals.handFifteens += components.fifteens ?? 0;
    totals.handPairs += components.pairs ?? 0;
    totals.handRuns += components.runs ?? 0;
    totals.handFlush += components.flush ?? 0;
    totals.handKnobs += components.knobs ?? 0;
  }
  const count = deck.length || 1;
  for (const key of Object.keys(totals)) totals[key] = totals[key] / count;
  return totals;
}

function expectedCribEvComponents(
  discard: Card[],
  deck: Card[],
  role: "dealer" | "pone",
  sign: 1 | -1,
  cribFlushBonusBySuit: number[] | null,
): AnalyticsEvComponents {
  const totals: AnalyticsEvComponents = {
    cribFifteens: 0,
    cribPairs: 0,
    cribRuns: 0,
    cribFlush: expectedCribFlushBonus(discard, cribFlushBonusBySuit),
    cribKnobs: 0,
  };
  const discardKey = rankCountsForCards(discard).join("");
  for (const cut of deck) {
    const row = CRIB_RANK_COMPONENTS_BY_DISCARD_CUT[role]?.[discardKey]?.[cut.rank];
    if (!row) continue;
    totals.cribFifteens += row[0];
    totals.cribPairs += row[1];
    totals.cribRuns += row[2];
    if (discard.some((card) => card.rankStr === "J" && card.suit === cut.suit)) {
      totals.cribKnobs += 1;
    }
  }
  const count = deck.length || 1;
  totals.cribFifteens /= count;
  totals.cribPairs /= count;
  totals.cribRuns /= count;
  totals.cribKnobs /= count;
  for (const key of Object.keys(totals)) totals[key] *= sign;
  return totals;
}

function selectedDiscardEvComponents(
  hand: Card[],
  discard: Card[],
  myCrib: boolean,
  engine: Opponent,
): AnalyticsEvComponents {
  const deck = fullDeck().filter((card) => !hand.some((held) => held.id === card.id));
  const keep = hand.filter((card) => !discard.includes(card));
  const role = myCrib ? "dealer" : "pone";
  const cribFlushBonusBySuit = usesCribFlushAdjustment(engine) ? cribFlushBonusesBySuit(hand) : null;
  const components = {
    ...averageHandEvComponents(keep, deck),
    ...expectedCribEvComponents(discard, deck, role, myCrib ? 1 : -1, cribFlushBonusBySuit),
  };
  const pegging = peggingOutcomeTableEv(keep, role, engine, hand) ?? pegTableEv(hand, discard, role, engine);
  components.pegging = pegging.netPeggingEv;
  return roundEvComponents(components);
}

function roundEvComponents(components: AnalyticsEvComponents): AnalyticsEvComponents {
  return Object.fromEntries(Object.entries(components).map(([key, value]) => [key, roundEv(value)]));
}

function rankCutHandScore(keep: Card[], cut: Card): number {
  const keepKey = rankCountsForCards(keep).join("");
  return HAND_RANK_SCORE_BY_KEEP_CUT[keepKey]?.[cut.rank] ?? scoreHandRankOnly(keep, cut);
}

function tripolicyCribPolicyEntry(
  discard: Card[],
  role: "dealer" | "pone",
  cut: Card,
  engine: Opponent,
  policy: CribPolicy,
): CribTripolicyPolicyEntry | null {
  if (engine !== "schell_table-peg_table-14.0") return null;
  const table = CRIB_TRIPOLICY_TABLES[engine];
  if (!table) return null;
  const discardKey = rankCountsForCards(discard).join("");
  const pairIndex = table.pairIndexByKey.get(discardKey);
  if (pairIndex === undefined) return null;
  const roleIndex = role === "dealer" ? 0 : 1;
  const policyIndex = CRIB_TRIPOLICY_POLICY_INDEX[policy];
  const entryIndex = ((roleIndex * table.pairKeys.length + pairIndex) * 13 + cut.rank) * 3 + policyIndex;
  if (entryIndex < 0 || entryIndex >= table.entryCount) return null;
  const directoryOffset = entryIndex * table.directoryRecordBytes;
  const average = table.directory.getFloat32(directoryOffset, true);
  const recordOffset = table.directory.getUint32(directoryOffset + 4, true);
  const recordCount = table.directory.getUint16(directoryOffset + 8, true);
  const opponentDiscards: CribTripolicyPolicyEntry["opponentDiscards"] = [];
  for (let index = 0; index < recordCount; index += 1) {
    const offset = (recordOffset + index) * table.opponentRecordBytes;
    const opponentPairIndex = table.records.getUint8(offset);
    opponentDiscards.push({
      ranks: table.pairKeys[opponentPairIndex],
      weight: table.records.getUint32(offset + 1, true),
      rankScore: table.records.getFloat32(offset + 5, true),
    });
  }
  return { average, opponentDiscards };
}

function rankCutCribScore(
  discard: Card[],
  role: "dealer" | "pone",
  cut: Card,
  engine: Opponent = DEFAULT_OPPONENT,
  policy: CribPolicy = "ev",
): number {
  const tripolicyScore = tripolicyCribPolicyEntry(discard, role, cut, engine, policy)?.average;
  if (typeof tripolicyScore === "number" && Number.isFinite(tripolicyScore)) return tripolicyScore;
  const discardKey = rankCountsForCards(discard).join("");
  return CRIB_RANK_SCORE_BY_DISCARD_CUT[role]?.[discardKey]?.[cut.rank] ?? 0;
}

function cardIds(cards: Card[]): Set<number> {
  return new Set(cards.map((card) => card.id));
}

function cardsForRankCounts(available: Card[], ranks: RankCounts): Card[][] {
  const byRank = Array.from({ length: 13 }, () => [] as Card[]);
  for (const card of available) byRank[card.rank].push(card);
  const groups = ranks
    .map((count, rank) => ({ rank, count }))
    .filter((entry) => entry.count > 0);
  if (!groups.length) return [[]];
  let hands: Card[][] = [[]];
  for (const { rank, count } of groups) {
    const options = combinations(byRank[rank], count, count);
    if (!options.length) return [];
    const next: Card[][] = [];
    for (const hand of hands) {
      for (const option of options) next.push([...hand, ...option]);
    }
    hands = next;
  }
  return hands;
}

function cribSuitBonus(discard: Card[], opponentDiscard: Card[], cut: Card): number {
  const crib = [...discard, ...opponentDiscard];
  let points = 0;
  for (const card of crib) {
    if (card.rankStr === "J" && card.suit === cut.suit) points += 1;
  }
  if (crib.every((card) => card.suit === cut.suit)) points += 5;
  return points;
}

function cribScoreOutcomesForCut(
  discard: Card[],
  cut: Card,
  role: "dealer" | "pone",
  seenCards: Card[],
  suitedDiscardCache: Map<string, Card[][]>,
  engine: Opponent = DEFAULT_OPPONENT,
  policy: CribPolicy = "ev",
): Array<[number, number]> {
  const discardKey = rankCountsForCards(discard).join("");
  const entry = tripolicyCribPolicyEntry(discard, role, cut, engine, policy) ??
    CRIB_SCORE_HISTOGRAM_BY_DISCARD_CUT[role]?.[discardKey]?.[cut.rank];
  if (!entry) {
    const fallback = rankCutCribScore(discard, role, cut, engine, policy) + scoreFlushAndRightJack(discard, cut, true);
    return [[fallback, 1]];
  }
  const seen = cardIds(seenCards);
  const available = fullDeck().filter((card) => !seen.has(card.id));
  const seenKey = [...seen].sort((a, b) => a - b).join(",");
  const outcomes = new Map<number, number>();
  let totalWeight = 0;
  for (const opponentDiscard of entry.opponentDiscards) {
    const ranks = opponentDiscard.ranks.split("").map((digit) => Number.parseInt(digit, 10));
    const cacheKey = `${seenKey}:${opponentDiscard.ranks}`;
    let suitedDiscards = suitedDiscardCache.get(cacheKey);
    if (!suitedDiscards) {
      suitedDiscards = cardsForRankCounts(available, ranks);
      suitedDiscardCache.set(cacheKey, suitedDiscards);
    }
    if (!suitedDiscards.length) continue;
    const suitedWeight = opponentDiscard.weight / suitedDiscards.length;
    for (const suitedDiscard of suitedDiscards) {
      const score = opponentDiscard.rankScore + cribSuitBonus(discard, suitedDiscard, cut);
      outcomes.set(score, (outcomes.get(score) ?? 0) + suitedWeight);
      totalWeight += suitedWeight;
    }
  }
  if (!totalWeight) {
    const fallback = rankCutCribScore(discard, role, cut, engine, policy) + scoreFlushAndRightJack(discard, cut, true);
    return [[fallback, 1]];
  }
  return [...outcomes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([score, weight]) => [score, weight / totalWeight]);
}

function scoreHandRankOnly(hand: Card[], turnCard: Card): number {
  return scoreFifteens(hand, turnCard) + scoreSets(hand, turnCard) + scoreRuns(hand, turnCard);
}

function rankCutDiscardScores(
  keep: Card[],
  discard: Card[],
  deck: Card[],
  role: "dealer" | "pone",
  cribFlushBonusBySuit: number[] | null,
  engine: Opponent = DEFAULT_OPPONENT,
  cribPolicy: CribPolicy = "ev",
): { handScore: number; cribScore: number } {
  let handTotal = 0;
  let cribTotal = 0;
  for (const cut of deck) {
    handTotal += rankCutHandScore(keep, cut) + scoreFlushAndRightJack(keep, cut, false);
    cribTotal += rankCutCribScore(discard, role, cut, engine, cribPolicy);
  }
  const count = deck.length || 1;
  return {
    handScore: handTotal / count,
    cribScore: (cribTotal / count) + expectedCribFlushBonus(discard, cribFlushBonusBySuit),
  };
}

function discardCandidateWinProbability(
  game: CribbageGame,
  player: PlayerState,
  fullHand: Card[],
  keep: Card[],
  discard: Card[],
  deck: Card[],
  myCrib: boolean,
  pegging: PegTableEv,
  peggingHist: Array<[number, number, number]> | null,
  suitedDiscardCache: Map<string, Card[][]>,
  cribPolicy: CribPolicy = "ev",
  baseOutcomeCache?: Map<string, DiscardWinBaseOutcome[]>,
): number {
  const opponent = player === game.human ? game.ai : game.human;
  const opponentHandPhase: ScorePhase = myCrib ? "handPone" : "handDealer";
  const opponentHandDistribution = SCORE_PHASE_DISTRIBUTIONS[opponentHandPhase] ?? [[0, 1]];
  const nextRole = myCrib ? "pone" : "dealer";
  let total = 0;
  let totalWeight = 0;
  const peggingOutcomes = peggingHist?.length
    ? peggingHist
    : [[pegging.myPeggingEv, pegging.opponentPeggingEv, 1] as [number, number, number]];
  const peggingWeightTotal = peggingOutcomes.reduce((sum, outcome) => sum + outcome[2], 0) || 1;
  const cacheKey = baseOutcomeCache
    ? [
        game.playerEngines[player.key],
        myCrib ? "dealer" : "pone",
        cardSetKey(fullHand),
        cardSetKey(keep),
        cardSetKey(discard),
        cribPolicy,
        deck.map((card) => card.id).join(","),
      ].join(":")
    : "";
  let baseOutcomes = cacheKey ? baseOutcomeCache?.get(cacheKey) : undefined;
  if (!baseOutcomes) {
    const baseMap = new Map<string, number>();
    for (const cut of deck) {
      const ownHandScore = rankCutHandScore(keep, cut) + scoreFlushAndRightJack(keep, cut, false);
      const cribOutcomes = cribScoreOutcomesForCut(
        discard,
        cut,
        myCrib ? "dealer" : "pone",
        [...fullHand, cut],
        suitedDiscardCache,
        game.playerEngines[player.key],
        cribPolicy,
      );
      const cutWeight = 1 / (deck.length || 1);
      for (const [cribScore, cribWeight] of cribOutcomes) {
        for (const [opponentHandScore, opponentHandWeight] of opponentHandDistribution) {
          const myBase = ownHandScore + (myCrib ? cribScore : 0);
          const opponentBase = opponentHandScore + (myCrib ? 0 : cribScore);
          const weight = cutWeight * cribWeight * opponentHandWeight;
          const key = `${Math.round(myBase)}:${Math.round(opponentBase)}`;
          baseMap.set(key, (baseMap.get(key) ?? 0) + weight);
        }
      }
    }
    baseOutcomes = [...baseMap.entries()].map(([key, weight]) => {
      const [myBase, opponentBase] = key.split(":").map(Number);
      return [myBase, opponentBase, weight] as DiscardWinBaseOutcome;
    });
    if (cacheKey && baseOutcomeCache) {
      boundedCacheSet(baseOutcomeCache, cacheKey, baseOutcomes, DISCARD_WIN_BASE_OUTCOME_CACHE_LIMIT);
    }
  }
  for (const [myPegging, opponentPegging, peggingWeight] of peggingOutcomes) {
    const normalizedPeggingWeight = peggingWeight / peggingWeightTotal;
    for (const [myBase, opponentBase, baseWeight] of baseOutcomes) {
      const myScore = player.score + myPegging + myBase;
      const opponentScore = opponent.score + opponentPegging + opponentBase;
      const weight = normalizedPeggingWeight * baseWeight;
      total += weight * approximateFutureWinProbability(myScore, opponentScore, nextRole, "peggingPone");
      totalWeight += weight;
    }
  }
  return totalWeight ? total / totalWeight : 0.5;
}

function analyzeDiscardChoice(
  hand: Card[],
  selected: Card[],
  myCrib: boolean,
  engine: Opponent,
  context?: { game: CribbageGame; player: PlayerState },
): {
  selectedEv: number;
  recommendedEv: number;
  recommended: Card[];
  selectedPegTableLead: number | null;
  recommendedPegTableLead: number | null;
  selectedWinProbability?: number;
  recommendedWinProbability?: number;
  selectedComponents: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
  recommendedComponents: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
} {
  const deck = fullDeck().filter((card) => !hand.some((held) => held.id === card.id));
  const role = myCrib ? "dealer" : "pone";
  let recommendedEv = Number.NEGATIVE_INFINITY;
  let recommendedScore = Number.NEGATIVE_INFINITY;
  let recommended = hand.slice(0, 2);
  let selectedEv = Number.NEGATIVE_INFINITY;
  let selectedWinProbability: number | undefined;
  let recommendedWinProbability: number | undefined;
  let selectedPegTableLead: number | null = null;
  let recommendedPegTableLead: number | null = null;
  let selectedComponents: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>> = {};
  let recommendedComponents: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>> = {};
  const selectedKey = cardSetKey(selected);
  const cribFlushBonusBySuit = usesCribFlushAdjustment(engine) ? cribFlushBonusesBySuit(hand) : null;
  const suitedDiscardCache = new Map<string, Card[][]>();

  for (const discard of combinations(hand, 2, 2)) {
    const keep = hand.filter((card) => !discard.includes(card));
    const strategyPolicies = engine === "schell_table-peg_table-14.0" && CRIB_TRIPOLICY_TABLES[engine]
      ? ["ev", "on", "off"] as CribPolicy[]
      : ["ev"] as CribPolicy[];
    const baseCutJoinedScores = usesRankCutDiscardTables(engine)
      ? rankCutDiscardScores(keep, discard, deck, role, cribFlushBonusBySuit, engine, "ev")
      : null;
    const handScore = baseCutJoinedScores?.handScore ?? mean(deck.map((cut) => scoreHand(keep, cut)));
    const peggingOptions = peggingOutcomeDiscardOptions(keep, role, engine, hand);
    if (!peggingOptions.length) peggingOptions.push({ ...pegTableEv(hand, discard, role, engine), hist: null, policy: "fallback" });
    let bestDiscardOption: {
      pegging: PegTableEv & { hist: Array<[number, number, number]> | null; policy: PeggingOutcomePolicy | "fallback" };
      cribPolicy: CribPolicy;
      total: number;
      winProbability?: number;
      choiceScore: number;
      components: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
    } | null = null;
    for (const strategyPolicy of strategyPolicies) {
      const cutJoinedScores = strategyPolicy === "ev"
        ? baseCutJoinedScores
        : usesRankCutDiscardTables(engine)
          ? rankCutDiscardScores(keep, discard, deck, role, cribFlushBonusBySuit, engine, strategyPolicy)
          : null;
      const cribScore = cutJoinedScores?.cribScore ?? expectedCribScore(discard, deck, myCrib, engine, cribFlushBonusBySuit);
      const strategyPeggingOptions = engine === "schell_table-peg_table-14.0"
        ? peggingOptions.filter((option) => option.policy === strategyPolicy || option.policy === "fallback")
        : peggingOptions;
      for (const pegging of strategyPeggingOptions) {
        const total = (myCrib ? handScore + cribScore : handScore - cribScore) + pegging.netPeggingEv;
        const components: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>> = {
          [myCrib ? "handDealer" : "handPone"]: handScore,
          [myCrib ? "peggingDealer" : "peggingPone"]: pegging.netPeggingEv,
          crib: myCrib ? cribScore : -cribScore,
        };
        const winProbability = usesDiscardWinProbability(engine) && context
          ? discardCandidateWinProbability(
              context.game,
              context.player,
              hand,
              keep,
              discard,
              deck,
              myCrib,
              pegging,
              pegging.hist,
              suitedDiscardCache,
              strategyPolicy,
              DISCARD_WIN_BASE_OUTCOME_CACHE,
            )
          : undefined;
        const choiceScore = winProbability ?? total;
        if (
          !bestDiscardOption ||
          choiceScore > bestDiscardOption.choiceScore ||
          (choiceScore === bestDiscardOption.choiceScore && total > bestDiscardOption.total)
        ) {
          bestDiscardOption = { pegging, cribPolicy: strategyPolicy, total, winProbability, choiceScore, components };
        }
      }
    }
    if (!bestDiscardOption) continue;
    if (cardSetKey(discard) === selectedKey) {
      selectedEv = bestDiscardOption.total;
      selectedWinProbability = bestDiscardOption.winProbability;
      selectedPegTableLead = bestDiscardOption.pegging.bestLead;
      selectedComponents = bestDiscardOption.components;
    }
    if (
      bestDiscardOption.choiceScore > recommendedScore ||
      (bestDiscardOption.choiceScore === recommendedScore && bestDiscardOption.total > recommendedEv)
    ) {
      recommendedEv = bestDiscardOption.total;
      recommendedScore = bestDiscardOption.choiceScore;
      recommendedWinProbability = bestDiscardOption.winProbability;
      recommended = discard;
      recommendedPegTableLead = bestDiscardOption.pegging.bestLead;
      recommendedComponents = bestDiscardOption.components;
    }
  }

  return {
    selectedEv,
    recommendedEv,
    recommended,
    selectedPegTableLead,
    recommendedPegTableLead,
    selectedWinProbability,
    recommendedWinProbability,
    selectedComponents,
    recommendedComponents,
  };
}

function peggingPlayEv(
  game: CribbageGame,
  player: PlayerState,
  card: Card,
  engine: Opponent,
  _bestLead: number | null,
): number {
  if (usesExhaustivePegging(engine)) {
    return exhaustivePeggingPlayEv(game, player, card, engine);
  }
  return scoreCount([...game.plays, card]) + card.runVal / 100;
}

function exhaustivePeggingPlayEv(game: CribbageGame, player: PlayerState, card: Card, engine: Opponent = game.playerEngines[player.key]): number {
  const opponent = player === game.human ? game.ai : game.human;
  const knownCards = [
    ...player.hand,
    ...player.table,
    ...opponent.table,
    ...game.crib,
    game.turnCard,
  ];
  const rankCounts = remainingRankCounts(knownCards);
  const opponentHands = opponentRankHandsForEngine(
    rankCounts,
    opponent.hand.length,
    opponent,
    opponent === game.dealer ? "dealer" : "pone",
    engine,
  );
  return exhaustivePeggingPointEv(game, player, card, opponentHands);
}

function bestImmediatePegPlay(plays: Card[], legal: Card[]): Card {
  return legal.reduce((best, card) => {
    const bestKey = [scoreCount([...plays, best]), best.runVal];
    const cardKey = [scoreCount([...plays, card]), card.runVal];
    return compareTuple(cardKey, bestKey) > 0 ? card : best;
  });
}

function cardSetKey(cards: Card[]): string {
  return cards.map((card) => card.id).sort((a, b) => a - b).join(",");
}

function boundedCacheSet<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function roundEv(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundProbability(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function decisionComponents(
  selected: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>,
  recommended: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>,
): AnalyticsDecisionReview["components"] {
  const selectedRounded: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>> = {};
  const recommendedRounded: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>> = {};
  const deltaRounded: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>> = {};
  const keys = new Set([...Object.keys(selected), ...Object.keys(recommended)] as Array<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib">);
  for (const key of keys) {
    const selectedValue = selected[key] ?? 0;
    const recommendedValue = recommended[key] ?? 0;
    selectedRounded[key] = roundEv(selectedValue);
    recommendedRounded[key] = roundEv(recommendedValue);
    deltaRounded[key] = roundEv(recommendedValue - selectedValue);
  }
  return {
    selected: selectedRounded,
    recommended: recommendedRounded,
    delta: deltaRounded,
  };
}

function createAnalyticsId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeOpponent(opponent: StoredOpponent): Opponent {
  if (opponent === "ras-table-1.0") return "ras_table-2.0";
  if (opponent === "ras-table-peg-1.1") return "ras_table-peg-3.0";
  if (opponent === "ras-table-peg_table-1.2") return "ras_table-peg_table-4.0";
  if (opponent === "schell-table-1.0") return "schell_table-2.0";
  if (opponent === "schell-table-peg-1.1") return "schell_table-peg-3.0";
  if (opponent === "schell-table-peg_table-1.2") return "schell_table-peg_table-4.0";
  if (opponent === "expert") return DEFAULT_OPPONENT;
  if (opponent === "expert-1.1") return "original-1.1";
  if (opponent === "expert-peg-1.2") return "original_exhaustive_peg-1.2";
  if (
    opponent === "expert-2.0-ras-tables" ||
    opponent === "expert_ras-table-1.0" ||
    opponent === "expert_ras_table-2.0"
  ) return "ras_table-2.0";
  if (
    opponent === "expert-peg-2.1" ||
    opponent === "expert_ras-table-peg-1.1" ||
    opponent === "expert_ras_table-peg-3.0"
  ) return "ras_table-peg-3.0";
  if (opponent === "expert-peg_table-2.2") return "ras_table-peg_table-4.0";
  if (
    opponent === "expert-peg-2.2" ||
    opponent === "expert_schell-table-peg-1.1" ||
    opponent === "expert_schell_table-peg-3.0"
  ) return "schell_table-peg-3.0";
  if (
    opponent === "expert-peg_table-1.3" ||
    opponent === "expert-peg_table-2.3" ||
    opponent === "expert_schell-table-peg_table-1.2" ||
    opponent === "expert_schell_table-peg_table-4.0"
  ) return "schell_table-peg_table-4.0";
  if (opponent === "schell_table-peg_table-14.0") return "schell_table-peg_table-14.0";
  if (opponent === "schell_table-peg_table-13.0") return "schell_table-peg_table-13.0";
  if (opponent === "schell_table-peg_table-12.0") return "schell_table-peg_table-12.0";
  if (opponent === "schell_table-peg_table-11.1") return "schell_table-peg_table-11.1";
  if (opponent === "schell_table-peg_table-11.0") return "schell_table-peg_table-11.0";
  if (opponent === "schell_table-peg_table-10.0") return "schell_table-peg_table-10.0";
  return opponent;
}
