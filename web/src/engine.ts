import cribFlushBonusBySuitCount from "./models/schell_table-peg_table-7.0/crib-flush-bonus.json";
import boardPositionStats from "./models/flush-aware-board-position-stats.json";
import cribRankComponentsByDiscardCut from "./models/rank-crib-discard/crib-rank-components-by-discard-cut.json";
import cribRankScoreByDiscardCut from "./models/rank-crib-discard/crib-rank-score-by-discard-cut.json";
import cribScoreHistogramByDiscardCut from "./models/rank-crib-discard/crib-score-histogram-by-discard-cut.json";
import empiricalDiscardKeep148 from "./models/rank-crib-discard/empirical-discard-keep-14.8.json";
import handRankScoreByKeepCut from "./models/rank-crib-discard/hand-rank-score-by-keep-cut.json";
import sixCardDiscardPolicyManifest from "./models/rank-crib-discard/six-card-discard-policy.manifest.json";
import sixCardDiscardPolicyUrl from "./models/rank-crib-discard/six-card-discard-policy.bin?url";
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
import peggingBounded144Manifest from "./models/schell_table-peg_table-14.4/pegging-outcome-bounded-overrides.manifest.json";
import peggingBounded144Url from "./models/schell_table-peg_table-14.4/pegging-outcome-bounded-overrides.bin?url";
import cribBounded144Manifest from "./models/schell_table-peg_table-14.4/crib-score-histogram-bounded-tripolicy-by-discard-cut.manifest.json";
import cribBounded144Url from "./models/schell_table-peg_table-14.4/crib-score-histogram-bounded-tripolicy-by-discard-cut.bin?url";
import peggingFrontier145Manifest from "./models/schell_table-peg_table-14.5/pegging-outcome-frontier-overrides.manifest.json";
import peggingFrontier145Url from "./models/schell_table-peg_table-14.5/pegging-outcome-frontier-overrides.bin?url";
import cribFrontier145Manifest from "./models/schell_table-peg_table-14.5/crib-score-histogram-frontier-by-discard-cut.manifest.json";
import cribFrontier145Url from "./models/schell_table-peg_table-14.5/crib-score-histogram-frontier-by-discard-cut.bin?url";
import cribFullFrontier146Manifest from "./models/schell_table-peg_table-14.6/crib-score-histogram-full-frontier-by-discard-cut.manifest.json";
import cribFullFrontier146Url from "./models/schell_table-peg_table-14.6/crib-score-histogram-full-frontier-by-discard-cut.bin?url";

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
  | "schell_table-peg_table-14.1"
  | "schell_table-peg_table-14.2"
  | "schell_table-peg_table-14.3"
  | "schell_table-peg_table-14.4"
  | "schell_table-peg_table-14.4.1"
  | "schell_table-peg_table-14.5"
  | "schell_table-peg_table-14.6"
  | "schell_table-peg_table-14.7"
  | "schell_table-peg_table-14.8"
  | "schell_table-peg_table-14.8.1"
  | "schell_table-peg_table-15.0"
  | "schell_table-peg_table-15.1"
  | "schell_table-peg_table-15.2"
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
export const DEFAULT_OPPONENT: Opponent = "schell_table-peg_table-15.1";
export const REVIEW_OPPONENT: Opponent = "schell_table-peg_table-15.1";
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
  "schell_table-peg_table-14.1": "Schell Table + Peg Table 14.1",
  "schell_table-peg_table-14.2": "Schell Table + Peg Table 14.2",
  "schell_table-peg_table-14.3": "Schell Table + Peg Table 14.3",
  "schell_table-peg_table-14.4": "Schell Table + Peg Table 14.4",
  "schell_table-peg_table-14.4.1": "Schell Table + Peg Table 14.4.1",
  "schell_table-peg_table-14.5": "Schell Table + Peg Table 14.5",
  "schell_table-peg_table-14.6": "Schell Table + Peg Table 14.6",
  "schell_table-peg_table-14.7": "Schell Table + Peg Table 14.7",
  "schell_table-peg_table-14.8": "Schell Table + Peg Table 14.8",
  "schell_table-peg_table-14.8.1": "Schell Table + Peg Table 14.8.1",
  "schell_table-peg_table-15.0": "Schell Table + Peg Table 15.0",
  "schell_table-peg_table-15.1": "Schell Table + Peg Table 15.1",
  "schell_table-peg_table-15.2": "Schell Table + Peg Table 15.2",
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
type FrontierPolicy = "frontier-on" | "frontier-off" | `frontier:${number}`;
type CribPolicy = "ev" | "on" | "off" | FrontierPolicy;
type CribTripolicyPolicyEntry = {
  average: number;
  opponentDiscards: Array<{ ranks: string; weight: number; rankScore: number }>;
  direct?: [number, number];
};
type CribTripolicyTable = {
  pairKeys: string[];
  pairIndexByKey: Map<string, number>;
  policyIndexByName: Map<string, number>;
  policyCount: number;
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
    policies?: string[];
  };
};
type CribFrontierTable = {
  table: Record<"dealer" | "pone", Record<string, Array<{
    ev?: CribTripolicyPolicyEntry | null;
    frontier?: Array<{ lambda: number | string; entry: CribTripolicyPolicyEntry }>;
  } | null>>>;
  maxFrontierEntries: number;
};
type SixCardDiscardPolicyManifest = {
  roles: Array<"dealer" | "pone">;
  pairKeys: string[];
  sixHandKeys: string[];
};
type SixCardDiscardPolicyChoice = {
  discardKey: string;
  discard: RankCounts;
  weight: number;
};
type SixCardDiscardPolicyTable = {
  manifest: SixCardDiscardPolicyManifest;
  choices(role: "dealer" | "pone", handKey: string): SixCardDiscardPolicyChoice[];
};
type DiscardChoiceAnalysis = {
  selectedEv: number;
  recommendedEv: number;
  recommended: Card[];
  selectedPegTableLead: number | null;
  recommendedPegTableLead: number | null;
  selectedWinProbability?: number;
  recommendedWinProbability?: number;
  selectedComponents: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
  recommendedComponents: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
};
type DiscardSelection = {
  cards: Card[];
  analysis: DiscardChoiceAnalysis;
};
type SixCardDiscardProfileGlobal = typeof globalThis & {
  __CRIBBAGE_PROFILE_SIX_CARD_DISCARD?: boolean;
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
DISCARD_TABLES["schell_table-peg_table-14.1"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-14.2"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-14.3"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-14.4"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-14.4.1"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-14.5"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-14.6"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-14.7"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-14.8"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-14.8.1"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-15.0"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-15.1"] = DISCARD_TABLES["schell_table-2.0"];
DISCARD_TABLES["schell_table-peg_table-15.2"] = DISCARD_TABLES["schell_table-2.0"];

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
  aiLegalCardIds: number[];
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
      selectedWinProbability?: number;
      recommendedWinProbability?: number;
      winProbabilityDelta?: number;
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
      selectedWinProbability?: number;
      legalCount?: number;
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
  rngState?: number;
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
  pendingDiscardReviews?: PendingDiscardReview[];
  pendingPeggingReviews?: PendingPeggingReview[];
}

interface PendingDiscardReview {
  eventId: string;
  player: PlayerKey;
  cardIds: number[];
  snapshot: GameSnapshot;
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
  private rngState = createRandomState();
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
  pegDecisionEvs: Record<PlayerKey, { cardId: number; model: Opponent; ev: number; winProbability?: number } | null> = {
    human: null,
    ai: null,
  };
  pendingDiscardReviews: PendingDiscardReview[] = [];
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
    this.deal = this.random() < 0.5 ? 0 : 1;
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
    game.rngState = normalizeRngState(snapshot.rngState);
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
    game.pendingDiscardReviews = [...snapshot.pendingDiscardReviews ?? []];
    game.pendingPeggingReviews = [...snapshot.pendingPeggingReviews ?? []];
    return game;
  }

  snapshot(): GameSnapshot {
    return {
      version: 1,
      gameId: this.gameId,
      rngState: this.rngState,
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
      pendingDiscardReviews: [...this.pendingDiscardReviews],
      pendingPeggingReviews: [...this.pendingPeggingReviews],
    };
  }

  private reviewSnapshot(): GameSnapshot {
    return {
      ...this.snapshot(),
      analyticsEvents: [],
      pendingDiscardReviews: [],
      pendingPeggingReviews: [],
    };
  }

  startHand(): void {
    this.dealer = [this.human, this.ai][this.deal];
    this.pone = [this.human, this.ai][this.deal ^ 1];
    const deck = this.shuffledDeck();
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
    this.cutDeck = this.shuffledDeck();
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
    if (this.cutDeck.length < 2) this.cutDeck = this.shuffledDeck();
    const humanCut = this.cutDeck.shift()!;
    const aiCut = this.cutDeck.shift()!;
    this.cutCards = { human: humanCut, ai: aiCut };
    if (humanCut.rank === aiCut.rank) {
      this.message = `User cut ${this.cardLabel(humanCut)}. AI cut ${this.cardLabel(aiCut)}. Tie. Tap to cut again.`;
      this.logEvent(this.message);
      this.cutDeck = this.shuffledDeck();
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
    const aiLegalIds = this.phase === "pegging" && current === this.ai
      ? this.legalCards(this.ai).map((card) => card.id)
      : [];
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
      turnCard: this.phase === "cut_for_deal" || this.phase === "discard"
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
      aiLegalCardIds: aiLegalIds,
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
      cutForDeal: this.phase === "cut_for_deal" || this.cutCards.human || this.cutCards.ai
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
    const pendingReviewSnapshot = this.reviewSnapshot();
    removeCards(this.human.hand, discards);
    this.crib.push(...discards);
    this.recordDiscard(this.human, discards, handBeforeDiscard, true, undefined, pendingReviewSnapshot);
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

  recommendAiDiscard(): { cards: SerializedCard[]; cardIds: number[]; bestLead: number | null } {
    if (this.phase !== "discard" && this.phase !== "ai_discarding") throw new Error("AI is not waiting to discard.");
    if (this.ai.hand.length !== 6) throw new Error("AI does not have a discard decision available.");
    const selection = this.chooseDiscards(this.ai, this.dealer === this.ai);
    const discards = selection.cards;
    return {
      cards: discards.map((card) => this.serializeCard(card)),
      cardIds: discards.map((card) => card.id),
      bestLead: this.pegTableLeads.ai,
    };
  }

  finishDiscardWithAiCards(ids: number[], bestLead: number | null = null): void {
    if (this.phase !== "ai_discarding") throw new Error("AI is not waiting to discard.");
    const handBeforeDiscard = [...this.ai.hand];
    const discards = this.selectedCards(this.ai.hand, ids, 2);
    removeCards(this.ai.hand, discards);
    this.pegTableLeads.ai = bestLead;
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

  advanceForcedPeggingToHumanOrDecision(): boolean {
    while (this.phase === "pegging") {
      if (this.peggingResetPending) return false;
      if (this.dealer.hand.length + this.pone.hand.length === 0) {
        this.finishPegging();
        this.phase = "pegging_complete";
        return false;
      }
      const player = this.currentPlayer();
      const legal = this.legalCards(player);
      if (player === this.human) {
        if (legal.length === 0) {
          this.sayGo(player);
          continue;
        }
        this.logEvent("User turn.");
        return false;
      }
      if (legal.length === 0) {
        this.sayGo(player);
        continue;
      }
      if (legal.length === 1) {
        this.playCard(player, legal[0]);
        continue;
      }
      return true;
    }
    return false;
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
        usesTripolicyDiscardModel(engine) &&
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

  completePendingDecisionReviews(limit = Number.POSITIVE_INFINITY): number {
    const maxReviews = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : Number.POSITIVE_INFINITY;
    let completed = 0;
    let attempted = 0;
    const remainingDiscards: PendingDiscardReview[] = [];
    for (const pending of this.pendingDiscardReviews) {
      if (attempted >= maxReviews) {
        remainingDiscards.push(pending);
        continue;
      }
      attempted += 1;
      const event = this.analyticsEvents.find((candidate) => candidate.id === pending.eventId);
      if (!event || event.type !== "discard") continue;
      try {
        const reviewGame = CribbageGame.restore(pending.snapshot);
        const player = reviewGame.playerByKey(pending.player);
        const cards = pending.cardIds.map((id) => new Card(id));
        event.review = reviewGame.reviewDiscard(player, cards, [...player.hand]);
        completed += 1;
      } catch {
        remainingDiscards.push(pending);
      }
    }
    this.pendingDiscardReviews = remainingDiscards;

    const remaining: PendingPeggingReview[] = [];
    for (const pending of this.pendingPeggingReviews) {
      if (attempted >= maxReviews) {
        remaining.push(pending);
        continue;
      }
      attempted += 1;
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
    const selection = this.chooseDiscards(this.ai, this.dealer === this.ai);
    const discards = selection.cards;
    removeCards(this.ai.hand, discards);
    this.crib.push(...discards);
    this.recordDiscard(this.ai, discards, handBeforeDiscard, false, selection.analysis);
    this.logEvent("AI discarded two cards to the crib.");
  }

  private autoDiscardHuman(): void {
    this.beginInteraction();
    if (this.phase !== "discard") throw new Error("It is not discard time.");
    const selection = this.chooseDiscards(this.human, this.dealer === this.human);
    const discards = selection.cards;
    const handBeforeDiscard = [...this.human.hand];
    removeCards(this.human.hand, discards);
    this.crib.push(...discards);
    this.recordDiscard(this.human, discards, handBeforeDiscard, false, selection.analysis);
    this.logEvent("User discarded two cards to the crib.");
    if (this.ai.hand.length === 6) {
      this.phase = "ai_discarding";
      this.logEvent("Waiting for AI to discard.");
      return;
    }
    this.beginPegging();
  }

  private chooseDiscards(player: PlayerState, myCrib: boolean): DiscardSelection {
    const engine = this.playerEngines[player.key];
    const analysis = analyzeDiscardChoice(player.hand, player.hand.slice(0, 2), myCrib, engine, { game: this, player });
    this.pegTableLeads[player.key] = analysis.recommendedPegTableLead;
    return {
      cards: analysis.recommended,
      analysis: {
        ...analysis,
        selectedEv: analysis.recommendedEv,
        selectedPegTableLead: analysis.recommendedPegTableLead,
        selectedWinProbability: analysis.recommendedWinProbability,
        selectedComponents: analysis.recommendedComponents,
      },
    };
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
    if (legal.length === 1) {
      const card = legal[0];
      const engine = this.playerEngines[player.key];
      this.pegDecisionEvs[player.key] = {
        cardId: card.id,
        model: engine,
        ev: roundEv(scoreCount([...this.plays, card])),
      };
      return card;
    }
    const engine = this.playerEngines[player.key];
    const outcomeLead = choosePeggingOutcomeLead(this, player, legal, engine);
    if (outcomeLead) {
      this.pegDecisionEvs[player.key] = {
        cardId: outcomeLead.card.id,
        model: engine,
        ev: roundEv(outcomeLead.ev),
        winProbability: roundProbability(outcomeLead.winProbability),
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
      this.pegDecisionEvs[player.key] = {
        cardId: decision.card.id,
        model: engine,
        ev: roundEv(decision.ev),
        winProbability: decision.winProbability === undefined ? undefined : roundProbability(decision.winProbability),
      };
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

  private chooseExhaustivePegPlay(player: PlayerState, legal: Card[]): { card: Card; ev: number; winProbability?: number } {
    const opponent = player === this.human ? this.ai : this.human;
    const engine = this.playerEngines[player.key];
    const cacheKey = usesModel13LivePegging(engine)
      ? model13PeggingDecisionCacheKey(this, player)
      : null;
    const cached = cacheKey ? MODEL13_PEGGING_DECISION_CACHE.get(cacheKey) : null;
    if (cached) {
      const cachedCard = legal.find((card) => card.id === cached.cardId);
      if (cachedCard) return { card: cachedCard, ev: cached.ev, winProbability: cached.winProbability };
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
    let bestDecision: ReturnType<typeof exhaustivePeggingCandidateScore> | null = null;
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
        bestDecision = decision;
      }
    }
    if (!bestDecision) bestDecision = exhaustivePeggingCandidateScore(this, player, bestCard, opponentHands, engine);
    const decision = {
      card: bestCard,
      ev: bestDecision.pointEv,
      winProbability: bestDecision.winProbability,
    };
    if (cacheKey) {
      MODEL13_PEGGING_DECISION_CACHE.set(cacheKey, {
        cardId: decision.card.id,
        ev: decision.ev,
        winProbability: decision.winProbability,
      });
      trimModel13PeggingDecisionCache();
    }
    return decision;
  }

  private playCard(player: PlayerState, card: Card, reviewDecision = false): void {
    const pendingReviewSnapshot = reviewDecision && player === this.human ? this.reviewSnapshot() : null;
    const engine = this.playerEngines[player.key];
    const pendingEv = this.pegDecisionEvs[player.key];
    const legalCount = this.legalCards(player).length;
    const selectedEv = pendingEv?.cardId === card.id && pendingEv.model === engine
      ? pendingEv.ev
      : roundEv(peggingPlayEv(this, player, card, engine, this.pegTableLeads[player.key]));
    const selectedWinProbability = pendingEv?.cardId === card.id &&
        pendingEv.model === engine &&
        pendingEv.winProbability !== undefined
      ? pendingEv.winProbability
      : legalCount > 1
        ? roundProbability(peggingPlayReviewValues(this, player, card, engine).winProbability)
        : undefined;
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
      selectedWinProbability,
      legalCount,
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
    discardAnalysis?: DiscardChoiceAnalysis,
    pendingReviewSnapshot?: GameSnapshot,
  ): void {
    const engine = this.playerEngines[player.key];
    const shouldDeferHumanReview = reviewDecision && player === this.human && pendingReviewSnapshot;
    const analysis = discardAnalysis ?? (shouldDeferHumanReview
      ? undefined
      : analyzeDiscardChoice(handBeforeDiscard, cards, player === this.dealer, engine, { game: this, player }));
    if (analysis) this.pegTableLeads[player.key] = analysis.selectedPegTableLead;
    const selectedWinProbability = analysis
      ? analysis.selectedWinProbability ?? discardChoiceWinProbability(
        this,
        player,
        analysis.selectedComponents,
        engine,
      )
      : undefined;
    const recommendedWinProbability = analysis
      ? analysis.recommendedWinProbability ?? discardChoiceWinProbability(
        this,
        player,
        analysis.recommendedComponents,
        engine,
      )
      : undefined;
    const selectedEvComponents = analysis && shouldLogScoreComponents()
      ? selectedDiscardEvComponents(handBeforeDiscard, cards, player === this.dealer, engine)
      : undefined;
    const event = this.recordAnalytics({
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
      selectedEv: analysis ? roundEv(analysis.selectedEv) : undefined,
      selectedWinProbability: selectedWinProbability === undefined ? undefined : roundProbability(selectedWinProbability),
      recommendedWinProbability: recommendedWinProbability === undefined ? undefined : roundProbability(recommendedWinProbability),
      winProbabilityDelta: selectedWinProbability === undefined || recommendedWinProbability === undefined
        ? undefined
        : roundProbability(recommendedWinProbability - selectedWinProbability),
      selectedEvComponents,
    });
    if (shouldDeferHumanReview) {
      this.pendingDiscardReviews.push({
        eventId: event.id,
        player: player.key,
        cardIds: cards.map((card) => card.id),
        snapshot: pendingReviewSnapshot,
      });
    }
  }

  private reviewDiscard(
    player: PlayerState,
    cards: Card[],
    handBeforeDiscard: Card[],
  ): AnalyticsDecisionReview | undefined {
    const analysis = analyzeDiscardChoice(handBeforeDiscard, cards, player === this.dealer, REVIEW_OPPONENT, { game: this, player });
    this.pegTableLeads[player.key] = analysis.selectedPegTableLead;
    const selectedWinProbability = analysis.selectedWinProbability ?? discardChoiceWinProbability(
      this,
      player,
      analysis.selectedComponents,
      REVIEW_OPPONENT,
    );
    const recommendedWinProbability = analysis.recommendedWinProbability ?? discardChoiceWinProbability(
      this,
      player,
      analysis.recommendedComponents,
      REVIEW_OPPONENT,
    );
    return {
      model: REVIEW_OPPONENT,
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
    const recommended = this.choosePlayForEngine(player, REVIEW_OPPONENT);
    const selected = peggingPlayReviewValues(this, player, card, REVIEW_OPPONENT);
    const recommendedValues = peggingPlayReviewValues(this, player, recommended, REVIEW_OPPONENT);
    return {
      model: REVIEW_OPPONENT,
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
    if (legal.length === 1) return legal[0];
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

  private random(): number {
    this.rngState = (Math.imul(1664525, this.rngState) + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private shuffledDeck(): Card[] {
    return shuffledDeck(() => this.random());
  }
}

function fullDeck(): Card[] {
  return Array.from({ length: 52 }, (_, id) => new Card(id));
}

function createRandomState(): number {
  const value = Math.floor(Math.random() * 0x100000000) >>> 0;
  return value || 0x9e3779b9;
}

function normalizeRngState(value: unknown): number {
  if (Number.isFinite(value)) {
    const normalized = Number(value) >>> 0;
    if (normalized) return normalized;
  }
  return createRandomState();
}

function shuffledDeck(random: () => number = Math.random): Card[] {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
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
  postPeggingContext?: PostPeggingWinContext;
};
type ScoreDistribution = Array<[number, number]>;
type DiscardWinBaseOutcome = [number, number, number];
type SixCardOpponentPolicyChoice = {
  discard: RankCounts;
  discardKey: string;
  keep: RankCounts;
  keepKey: string;
  probability: number;
  scoringCards: Card[];
};
type SixCardOpponentContext = {
  hand: WeightedRankHand;
  cutAvailability: RankCounts;
  choices: SixCardOpponentPolicyChoice[];
};
type SixCardDiscardEvaluationMemo = {
  ownHandScore: Map<string, number>;
  opponentHandSuitBonus: Map<string, number>;
  cribSuitBonus: Map<string, number>;
  peggingOptions: Map<string, Array<{ leadRank: number | null; ownPegging: number; opponentPegging: number }>>;
};
type EmpiricalDiscardKeepJsonEntry = {
  count: number;
  suitedCount?: number;
  suitedRate?: number;
};
type EmpiricalDiscardKeepJsonRole = {
  discardTotal: number;
  keepTotal: number;
  suitedDiscardRate: number;
  distinctSuitedDiscardRate: number;
  discards: Record<string, EmpiricalDiscardKeepJsonEntry>;
  keeps: Record<string, number>;
};
type EmpiricalDiscardKeepJson = {
  roles: Record<"dealer" | "pone", EmpiricalDiscardKeepJsonRole>;
};
type EmpiricalRuntimeEntry = {
  key: string;
  ranks: RankCounts;
  count: number;
  fullCombinationCount: number;
  scoringCards: Card[];
  suitedRate?: number;
};
type EmpiricalRuntimeRole = {
  suitedDiscardRate: number;
  distinctSuitedDiscardRate: number;
  discards: EmpiricalRuntimeEntry[];
  keeps: EmpiricalRuntimeEntry[];
};
type EmpiricalDiscardKeepRuntimeTable = {
  roles: Record<"dealer" | "pone", EmpiricalRuntimeRole>;
};
type EmpiricalWeightedEntry = EmpiricalRuntimeEntry & {
  weight: number;
};
type EmpiricalDiscardCandidate = {
  discard: Card[];
  keep: Card[];
};
type EmpiricalDiscardCandidateGroup = EmpiricalDiscardCandidate & {
  candidates: EmpiricalDiscardCandidate[];
};
type EmpiricalDiscardEvaluationMemo = SixCardDiscardEvaluationMemo & {
  adjustedDiscards: Map<string, EmpiricalWeightedEntry[]>;
  adjustedKeeps: Map<string, EmpiricalWeightedEntry[]>;
  ownHandScoreOutcomes: Map<string, { outcomes: Array<[number, number]>; average: number }>;
  cribScoreOutcomes: Map<string, { outcomes: Array<[number, number]>; average: number }>;
  opponentHandScoreOutcomes: Map<string, Array<[number, number]>>;
};
type CutRankOption = {
  rank: number;
  card: Card;
  cards: Card[];
  weight: number;
};
type PostPeggingWinContext = {
  key: string;
  engine: Opponent;
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
type PeggingOutcomePolicy = "ev" | "on" | "off" | FrontierPolicy;
type PeggingPairwiseManifest = {
  keepKeys: string[];
};
type PeggingPairwiseTable = {
  format: "word32" | "packed49" | "aligned7" | "sparse14" | "frontier45";
  keepKeys: string[];
  keepRanks: RankCounts[];
  keepIdByKey: Map<string, number>;
  dealerOffsets: Uint32Array;
  poneOffsets: Uint32Array;
  baseTable?: PeggingPairwiseTable;
  dealerRecords?: Uint32Array;
  poneRecords?: Uint32Array;
  dealerPackedRecords?: Uint8Array;
  ponePackedRecords?: Uint8Array;
  dealerAlignedRecords?: Uint8Array;
  poneAlignedRecords?: Uint8Array;
  dealerSparseRecords?: Uint8Array;
  poneSparseRecords?: Uint8Array;
  dealerFrontierRecords?: DataView;
  poneFrontierRecords?: DataView;
  frontierOutcomes?: Uint16Array;
  maxFrontierOutcomes?: number;
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
const CRIB_FRONTIER_TABLES: Partial<Record<Opponent, CribFrontierTable>> = {};
const SIX_CARD_DISCARD_POLICY_TABLES: Partial<Record<Opponent, SixCardDiscardPolicyTable>> = {};
const DISCARD_WIN_BASE_OUTCOME_CACHE = new Map<string, DiscardWinBaseOutcome[]>();
const DISCARD_WIN_BASE_OUTCOME_CACHE_LIMIT = 1500;
const DISCARD_OPPONENT_HAND_SCORE_CACHE = new Map<string, ScoreDistribution>();
const DISCARD_OPPONENT_HAND_SCORE_CACHE_LIMIT = 2000;
const PAIRWISE_PEGGING_OUTCOME_CACHE = new Map<string, PeggingOutcomeSummary | null>();
const PAIRWISE_PEGGING_OUTCOME_CACHE_LIMIT = 5000;
const OPPONENT_RANK_HANDS_CACHE = new Map<string, WeightedRankHand[]>();
const OPPONENT_RANK_HANDS_CACHE_LIMIT = 10000;
const MODEL13_PEGGING_DECISION_CACHE = new Map<string, { cardId: number; ev: number; winProbability?: number }>();
const MODEL13_PEGGING_DECISION_CACHE_LIMIT = 500;
const MODEL13_OPTIMAL_PEGGING_TREE_CACHE = new Map<string, PeggingOutcomeDistribution>();
const MODEL13_OPTIMAL_PEGGING_TREE_CACHE_LIMIT = model13TreeCacheLimit();
const BOARD_POSITION_STATS = boardPositionStats as BoardPositionStats;
const SCORE_PHASES: ScorePhase[] = ["peggingPone", "peggingDealer", "handPone", "handDealer", "crib"];
const SCORE_PHASE_DISTRIBUTIONS: Record<ScorePhase, Array<[number, number]>> = Object.fromEntries(
  SCORE_PHASES.map((phase) => [phase, scorePhaseDistribution(BOARD_POSITION_STATS.global[phase])]),
) as Record<ScorePhase, Array<[number, number]>>;
const EMPIRICAL_DISCARD_KEEP_TABLE_14_8 = normalizeEmpiricalDiscardKeepTable(
  empiricalDiscardKeep148 as EmpiricalDiscardKeepJson,
);
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
  "schell_table-peg_table-14.1": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-14.2": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-14.3": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-14.4": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-14.4.1": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-14.5": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-14.6": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-14.7": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-14.8": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-14.8.1": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-15.0": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-15.1": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
  "schell_table-peg_table-15.2": () =>
    loadModel13HoldTable(model13HoldUrl, model13HoldManifest as Model13HoldManifest),
};
const PEGGING_PAIRWISE_TABLE_LOADERS: Partial<Record<Opponent, () => Promise<PeggingPairwiseTable>>> = {
  "schell_table-peg_table-12.0": () =>
    loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-13.0": () =>
    loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.0": () =>
    loadPairwisePeggingTable(peggingPairwise14Url, peggingPairwise14Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.1": () =>
    loadPairwisePeggingTable(peggingPairwise14Url, peggingPairwise14Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.2": () =>
    loadPairwisePeggingTable(peggingPairwise14Url, peggingPairwise14Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.3": () =>
    loadPairwisePeggingTable(peggingPairwise14Url, peggingPairwise14Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.4": () =>
    loadSparseBoundedPeggingTable(peggingBounded144Url, peggingBounded144Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.4.1": () =>
    loadSparseBoundedPeggingTable(peggingBounded144Url, peggingBounded144Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.5": () =>
    loadFrontierPeggingTable(peggingFrontier145Url, peggingFrontier145Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.6": () =>
    loadFrontierPeggingTable(peggingFrontier145Url, peggingFrontier145Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.7": () =>
    loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.8": () =>
    loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-14.8.1": () =>
    loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-15.0": () =>
    loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-15.1": () =>
    loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest),
  "schell_table-peg_table-15.2": () =>
    loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest),
};
const PONE_LEAD_FREQUENCY_LOADERS: Partial<Record<Opponent, () => Promise<PoneLeadFrequencyTable>>> = {
  "schell_table-peg_table-13.0": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.0": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.1": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.2": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.3": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.4": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.4.1": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.5": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.6": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.7": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.8": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-14.8.1": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-15.0": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-15.1": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
  "schell_table-peg_table-15.2": () =>
    loadModel13LeadTable(model13LeadUrl, model13LeadManifest as Model13LeadManifest),
};
const CRIB_TRIPOLICY_LOADERS: Partial<Record<Opponent, () => Promise<CribTripolicyTable>>> = {
  "schell_table-peg_table-14.0": () =>
    loadTripolicyCribTable(cribTripolicy14Url, cribTripolicy14Manifest as CribTripolicyManifest),
  "schell_table-peg_table-14.1": () =>
    loadTripolicyCribTable(cribTripolicy14Url, cribTripolicy14Manifest as CribTripolicyManifest),
  "schell_table-peg_table-14.2": () =>
    loadTripolicyCribTable(cribTripolicy14Url, cribTripolicy14Manifest as CribTripolicyManifest),
  "schell_table-peg_table-14.3": () =>
    loadTripolicyCribTable(cribTripolicy14Url, cribTripolicy14Manifest as CribTripolicyManifest),
  "schell_table-peg_table-14.4": () =>
    loadTripolicyCribTable(cribBounded144Url, cribBounded144Manifest as CribTripolicyManifest),
  "schell_table-peg_table-14.4.1": () =>
    loadTripolicyCribTable(cribBounded144Url, cribBounded144Manifest as CribTripolicyManifest),
  "schell_table-peg_table-14.5": () =>
    loadTripolicyCribTable(cribFrontier145Url, cribFrontier145Manifest as CribTripolicyManifest),
  "schell_table-peg_table-14.6": () =>
    loadTripolicyCribTable(cribFullFrontier146Url, cribFullFrontier146Manifest as CribTripolicyManifest),
};
const CRIB_FRONTIER_LOADERS: Partial<Record<Opponent, () => Promise<CribFrontierTable>>> = {};
const SIX_CARD_DISCARD_POLICY_LOADERS: Partial<Record<Opponent, () => Promise<SixCardDiscardPolicyTable>>> = {
  "schell_table-peg_table-14.7": () =>
    loadSixCardDiscardPolicyTable(sixCardDiscardPolicyUrl, sixCardDiscardPolicyManifest as SixCardDiscardPolicyManifest),
};

export function hasLoadedOpponentResources(opponent: StoredOpponent): boolean {
  const engine = normalizeOpponent(opponent);
  const hasPegTable = !PEG_TABLE_POLICY_LOADERS[engine] || Boolean(PEG_TABLE_POLICIES[engine]);
  const hasHoldTable = !PEGGING_HOLD_TABLE_LOADERS[engine] || Boolean(PEGGING_HOLD_TABLES[engine]);
  const hasOutcomeTable = !PEGGING_PAIRWISE_TABLE_LOADERS[engine] || Boolean(PEGGING_PAIRWISE_TABLES[engine]);
  const hasLeadTable = !PONE_LEAD_FREQUENCY_LOADERS[engine] || Boolean(PONE_LEAD_FREQUENCY_TABLES[engine]);
  const hasCribTripolicyTable = !CRIB_TRIPOLICY_LOADERS[engine] || Boolean(CRIB_TRIPOLICY_TABLES[engine]);
  const hasCribFrontierTable = !CRIB_FRONTIER_LOADERS[engine] || Boolean(CRIB_FRONTIER_TABLES[engine]);
  const hasSixCardDiscardPolicy = !SIX_CARD_DISCARD_POLICY_LOADERS[engine] || Boolean(SIX_CARD_DISCARD_POLICY_TABLES[engine]);
  return hasPegTable && hasHoldTable && hasOutcomeTable && hasLeadTable && hasCribTripolicyTable && hasCribFrontierTable && hasSixCardDiscardPolicy;
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
  const cribFrontierLoader = CRIB_FRONTIER_LOADERS[engine];
  const sixCardDiscardPolicyLoader = SIX_CARD_DISCARD_POLICY_LOADERS[engine];
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
  const loadCribFrontierTable = cribFrontierLoader && !CRIB_FRONTIER_TABLES[engine]
    ? cribFrontierLoader().then((table) => {
        CRIB_FRONTIER_TABLES[engine] = table;
      })
    : Promise.resolve();
  const loadSixCardDiscardPolicy = sixCardDiscardPolicyLoader && !SIX_CARD_DISCARD_POLICY_TABLES[engine]
    ? sixCardDiscardPolicyLoader().then((table) => {
        SIX_CARD_DISCARD_POLICY_TABLES[engine] = table;
      })
    : Promise.resolve();
  await Promise.all([
    loadPegTable,
    loadHoldTable,
    loadOutcomeTable,
    loadLeadTable,
    loadCribTripolicyTable,
    loadCribFrontierTable,
    loadSixCardDiscardPolicy,
  ]);
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

function isModel14OrLater(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-14.0" ||
    engine === "schell_table-peg_table-14.1" ||
    engine === "schell_table-peg_table-14.2" ||
    engine === "schell_table-peg_table-14.3" ||
    engine === "schell_table-peg_table-14.4" ||
    engine === "schell_table-peg_table-14.4.1" ||
    engine === "schell_table-peg_table-14.5" ||
    engine === "schell_table-peg_table-14.6" ||
    engine === "schell_table-peg_table-14.7" ||
    engine === "schell_table-peg_table-14.8" ||
    engine === "schell_table-peg_table-14.8.1" ||
    engine === "schell_table-peg_table-15.0" ||
    engine === "schell_table-peg_table-15.1" ||
    engine === "schell_table-peg_table-15.2";
}

function usesSixCardDiscardModel(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-14.7";
}

function usesEmpiricalDiscardKeepModel(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-14.8" ||
    engine === "schell_table-peg_table-14.8.1" ||
    engine === "schell_table-peg_table-15.0" ||
    engine === "schell_table-peg_table-15.1" ||
    engine === "schell_table-peg_table-15.2";
}

function usesEmpiricalDiscardCandidateGrouping(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-14.8.1" ||
    engine === "schell_table-peg_table-15.0" ||
    engine === "schell_table-peg_table-15.1" ||
    engine === "schell_table-peg_table-15.2";
}

function usesWinProbabilityPegging(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-10.0" ||
    engine === "schell_table-peg_table-11.0" ||
    engine === "schell_table-peg_table-11.1" ||
    engine === "schell_table-peg_table-12.0" ||
    engine === "schell_table-peg_table-13.0" ||
    isModel14OrLater(engine);
}

function usesRankCutDiscardTables(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-11.0" ||
    engine === "schell_table-peg_table-11.1" ||
    engine === "schell_table-peg_table-12.0" ||
    engine === "schell_table-peg_table-13.0" ||
    isModel14OrLater(engine);
}

function usesDiscardWinProbability(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-11.1" ||
    engine === "schell_table-peg_table-12.0" ||
    engine === "schell_table-peg_table-13.0" ||
    isModel14OrLater(engine);
}

function usesPeggingOutcomeTables(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-12.0" ||
    engine === "schell_table-peg_table-13.0" ||
    isModel14OrLater(engine);
}

function usesModel13LivePegging(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-13.0" ||
    isModel14OrLater(engine);
}

function usesTripolicyDiscardModel(engine: Opponent): boolean {
  return isModel14OrLater(engine) && !usesSixCardDiscardModel(engine) && !usesEmpiricalDiscardKeepModel(engine);
}

function usesNineWayTripolicyDiscardModel(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-14.2" ||
    engine === "schell_table-peg_table-14.3" ||
    engine === "schell_table-peg_table-14.4.1" ||
    engine === "schell_table-peg_table-14.6";
}

function usesCorrectedDiscardWinProbability(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-14.1" ||
    engine === "schell_table-peg_table-14.2" ||
    engine === "schell_table-peg_table-14.3" ||
    engine === "schell_table-peg_table-14.4" ||
    engine === "schell_table-peg_table-14.4.1" ||
    engine === "schell_table-peg_table-14.5" ||
    engine === "schell_table-peg_table-14.6" ||
    engine === "schell_table-peg_table-14.7" ||
    engine === "schell_table-peg_table-14.8" ||
    engine === "schell_table-peg_table-14.8.1" ||
    engine === "schell_table-peg_table-15.0" ||
    engine === "schell_table-peg_table-15.1" ||
    engine === "schell_table-peg_table-15.2";
}

function usesRankOnlyDiscardWinProbabilityApproximation(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-14.3" ||
    engine === "schell_table-peg_table-14.4" ||
    engine === "schell_table-peg_table-14.4.1" ||
    engine === "schell_table-peg_table-14.5" ||
    engine === "schell_table-peg_table-14.6" ||
    engine === "schell_table-peg_table-14.7" ||
    engine === "schell_table-peg_table-14.8" ||
    engine === "schell_table-peg_table-14.8.1" ||
    engine === "schell_table-peg_table-15.0" ||
    engine === "schell_table-peg_table-15.1" ||
    engine === "schell_table-peg_table-15.2";
}

function usesKnownCardPostPeggingWinProbability(engine: Opponent): boolean {
  return isModel14OrLater(engine);
}

function usesFrontierPolicyModel(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-14.5" ||
    engine === "schell_table-peg_table-14.6";
}

function usesIndexedFrontierPolicyModel(engine: Opponent): boolean {
  return engine === "schell_table-peg_table-14.6";
}

function frontierPolicyIndex(policy: CribPolicy | PeggingOutcomePolicy): number | null {
  if (!policy.startsWith("frontier:")) return null;
  const value = Number.parseInt(policy.slice("frontier:".length), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function peggingOutcomePolicies(engine: Opponent): PeggingOutcomePolicy[] {
  if (usesSixCardDiscardModel(engine) || usesEmpiricalDiscardKeepModel(engine)) return ["ev"];
  if (usesIndexedFrontierPolicyModel(engine)) {
    const max = PEGGING_PAIRWISE_TABLES[engine]?.maxFrontierOutcomes ?? 0;
    return ["ev", ...Array.from({ length: max }, (_, index) => `frontier:${index}` as const)];
  }
  if (usesFrontierPolicyModel(engine)) {
    return ["ev", "frontier-on", "frontier-off"];
  }
  return usesTripolicyDiscardModel(engine)
    ? ["ev", "on", "off"]
    : ["ev"];
}

function cribPolicies(engine: Opponent): CribPolicy[] {
  if (usesSixCardDiscardModel(engine) || usesEmpiricalDiscardKeepModel(engine)) return ["ev"];
  if (usesIndexedFrontierPolicyModel(engine)) {
    const policyCount = CRIB_TRIPOLICY_TABLES[engine]?.policyCount ?? 1;
    return ["ev", ...Array.from({ length: Math.max(0, policyCount - 1) }, (_, index) => `frontier:${index}` as const)];
  }
  if (usesFrontierPolicyModel(engine)) {
    return CRIB_TRIPOLICY_TABLES[engine]
      ? ["ev", "frontier-on", "frontier-off"]
      : ["ev"];
  }
  return CRIB_TRIPOLICY_TABLES[engine]
    ? ["ev", "on", "off"]
    : ["ev"];
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

async function loadSixCardDiscardPolicyTable(
  url: string,
  manifest: SixCardDiscardPolicyManifest,
): Promise<SixCardDiscardPolicyTable> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load six-card discard policy table: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "D6P1") throw new Error(`Unexpected six-card discard policy magic: ${magic}`);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`Unsupported six-card discard policy version: ${version}`);
  const recordBytes = view.getUint16(6, true);
  const rootCount = view.getUint32(8, true);
  const recordCount = view.getUint32(12, true);
  const rootOffsetCount = view.getUint32(16, true);
  const rootOffsetsOffset = view.getUint32(20, true);
  const recordsOffset = view.getUint32(24, true);
  const pairCount = view.getUint16(28, true);
  if (recordBytes !== 8) throw new Error(`Unsupported six-card discard policy record width: ${recordBytes}`);
  if (rootOffsetCount !== rootCount + 1) throw new Error("Invalid six-card discard policy root offset count");
  if (pairCount !== manifest.pairKeys.length) throw new Error(`Six-card discard policy pair count mismatch: ${pairCount}`);
  const rootOffsets = new Uint32Array(buffer, rootOffsetsOffset, rootOffsetCount);
  const pairRanks = manifest.pairKeys.map(rankCountsFromKey);
  const rootIndexByKey = new Map<string, number>();
  for (let roleIndex = 0; roleIndex < manifest.roles.length; roleIndex += 1) {
    for (let handIndex = 0; handIndex < manifest.sixHandKeys.length; handIndex += 1) {
      rootIndexByKey.set(
        `${manifest.roles[roleIndex]}:${manifest.sixHandKeys[handIndex]}`,
        (roleIndex * manifest.sixHandKeys.length) + handIndex,
      );
    }
  }
  return {
    manifest,
    choices(role, handKey) {
      const rootIndex = rootIndexByKey.get(`${role}:${handKey}`);
      if (rootIndex === undefined || rootIndex >= rootCount) return [];
      const start = rootOffsets[rootIndex];
      const end = rootOffsets[rootIndex + 1];
      const choices: SixCardDiscardPolicyChoice[] = [];
      for (let recordIndex = start; recordIndex < end; recordIndex += 1) {
        if (recordIndex >= recordCount) throw new Error(`Six-card discard policy record index out of range: ${recordIndex}`);
        const offset = recordsOffset + (recordIndex * recordBytes);
        const pairIndex = view.getUint16(offset, true);
        choices.push({
          discardKey: manifest.pairKeys[pairIndex],
          discard: pairRanks[pairIndex],
          weight: view.getUint32(offset + 2, true),
        });
      }
      return choices;
    },
  };
}

async function loadBasePairwise12Table(): Promise<PeggingPairwiseTable> {
  const existing = PEGGING_PAIRWISE_TABLES["schell_table-peg_table-12.0"];
  if (existing) return existing;
  const table = await loadPairwisePeggingTable(peggingPairwise12Url, peggingPairwise12Manifest as PeggingPairwiseManifest);
  PEGGING_PAIRWISE_TABLES["schell_table-peg_table-12.0"] = table;
  return table;
}

async function loadSparseBoundedPeggingTable(url: string, manifest: PeggingPairwiseManifest): Promise<PeggingPairwiseTable> {
  const [baseTable, response] = await Promise.all([loadBasePairwise12Table(), fetch(url)]);
  if (!response.ok) throw new Error(`Unable to load bounded pegging table: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "P14S") throw new Error(`Unexpected bounded pegging table magic: ${magic}`);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`Unsupported bounded pegging table version: ${version}`);
  const keepCount = view.getUint16(6, true);
  const dealerRecordCount = view.getUint32(8, true);
  const poneRecordCount = view.getUint32(12, true);
  const recordBytes = view.getUint16(16, true);
  if (keepCount !== manifest.keepKeys.length || keepCount !== baseTable.keepKeys.length) {
    throw new Error(`Bounded pegging table keep count mismatch: ${keepCount}`);
  }
  if (recordBytes !== 6) throw new Error(`Unsupported bounded pegging record width: ${recordBytes}`);
  let offset = 20;
  const dealerOffsets = new Uint32Array(buffer, offset, keepCount + 1);
  offset += (keepCount + 1) * 4;
  const poneOffsets = new Uint32Array(buffer, offset, (keepCount * 13) + 1);
  offset += ((keepCount * 13) + 1) * 4;
  const dealerSparseRecords = new Uint8Array(buffer, offset, dealerRecordCount * recordBytes);
  offset += dealerRecordCount * recordBytes;
  const poneSparseRecords = new Uint8Array(buffer, offset, poneRecordCount * recordBytes);
  return {
    ...baseTable,
    format: "sparse14",
    baseTable,
    dealerOffsets,
    poneOffsets,
    dealerSparseRecords,
    poneSparseRecords,
    recordBits: 0,
    recordBytes,
  };
}

async function loadFrontierPeggingTable(url: string, manifest: PeggingPairwiseManifest): Promise<PeggingPairwiseTable> {
  const [baseTable, response] = await Promise.all([loadBasePairwise12Table(), fetch(url)]);
  if (!response.ok) throw new Error(`Unable to load frontier pegging table: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "P45F") throw new Error(`Unexpected frontier pegging table magic: ${magic}`);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`Unsupported frontier pegging table version: ${version}`);
  const keepCount = view.getUint16(6, true);
  const dealerRecordCount = view.getUint32(8, true);
  const poneRecordCount = view.getUint32(12, true);
  const outcomeCount = view.getUint32(16, true);
  const recordBytes = view.getUint16(20, true);
  const outcomeBytes = view.getUint16(22, true);
  if (keepCount !== manifest.keepKeys.length || keepCount !== baseTable.keepKeys.length) {
    throw new Error(`Frontier pegging table keep count mismatch: ${keepCount}`);
  }
  if (recordBytes !== 8 || outcomeBytes !== 2) {
    throw new Error(`Unsupported frontier pegging record widths: ${recordBytes}/${outcomeBytes}`);
  }
  let offset = 32;
  const dealerOffsets = new Uint32Array(buffer, offset, keepCount + 1);
  offset += (keepCount + 1) * 4;
  const poneOffsets = new Uint32Array(buffer, offset, (keepCount * 13) + 1);
  offset += ((keepCount * 13) + 1) * 4;
  const dealerFrontierRecords = new DataView(buffer, offset, dealerRecordCount * recordBytes);
  offset += dealerRecordCount * recordBytes;
  const poneFrontierRecords = new DataView(buffer, offset, poneRecordCount * recordBytes);
  offset += poneRecordCount * recordBytes;
  const frontierOutcomes = new Uint16Array(buffer, offset, outcomeCount);
  let maxFrontierOutcomes = 0;
  for (let index = 0; index < dealerRecordCount; index += 1) {
    maxFrontierOutcomes = Math.max(maxFrontierOutcomes, dealerFrontierRecords.getUint16((index * recordBytes) + 6, true));
  }
  for (let index = 0; index < poneRecordCount; index += 1) {
    maxFrontierOutcomes = Math.max(maxFrontierOutcomes, poneFrontierRecords.getUint16((index * recordBytes) + 6, true));
  }
  return {
    ...baseTable,
    format: "frontier45",
    baseTable,
    dealerOffsets,
    poneOffsets,
    dealerFrontierRecords,
    poneFrontierRecords,
    frontierOutcomes,
    maxFrontierOutcomes,
    recordBits: 0,
    recordBytes,
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
  const policies = manifest.binaryFormat?.policies ?? ["ev", "on", "off"];
  if (entryCount !== 2 * pairCount * 13 * policies.length) {
    throw new Error(`14.0 crib table entry count mismatch: ${entryCount}`);
  }
  if (directoryRecordBytes !== 10 || opponentRecordBytes !== 9) {
    throw new Error(`Unsupported 14.0 crib record widths: ${directoryRecordBytes}/${opponentRecordBytes}`);
  }
  return {
    pairKeys: manifest.pairKeys,
    pairIndexByKey: new Map(manifest.pairKeys.map((key, index) => [key, index])),
    policyIndexByName: new Map(policies.map((policy, index) => [policy, index])),
    policyCount: policies.length,
    directory: new DataView(buffer, directoryOffset, recordsOffset - directoryOffset),
    records: new DataView(buffer, recordsOffset),
    directoryRecordBytes,
    opponentRecordBytes,
    entryCount,
  };
}

async function loadFrontierCribTable(url: string): Promise<CribFrontierTable> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load 14.5 crib frontier table: ${response.status}`);
  const source = await response.json() as {
    table: CribFrontierTable["table"];
  };
  let maxFrontierEntries = 0;
  for (const role of ["dealer", "pone"] as const) {
    for (const cuts of Object.values(source.table?.[role] ?? {})) {
      for (const entry of cuts ?? []) {
        maxFrontierEntries = Math.max(maxFrontierEntries, entry?.frontier?.length ?? 0);
      }
    }
  }
  return {
    table: source.table,
    maxFrontierEntries,
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
  if (usesTripolicyDiscardModel(engine) && PEGGING_PAIRWISE_TABLES[engine]) {
    const options: Array<PegTableEv & { hist: Array<[number, number, number]>; policy: PeggingOutcomePolicy }> = [];
    for (const policy of peggingOutcomePolicies(engine)) {
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
  if (table.format === "sparse14") return aggregateSparseBoundedPeggingOutcomes(keep, role, engine, knownCards, leadRank, policy);
  if (table.format === "frontier45") return aggregateFrontierPeggingOutcomes(keep, role, engine, knownCards, leadRank, policy);
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

function aggregateSparseBoundedPeggingOutcomes(
  keep: Card[],
  role: "dealer" | "pone",
  engine: Opponent,
  knownCards: Card[],
  leadRank: number | null,
  policy: PeggingOutcomePolicy = "ev",
): PeggingOutcomeSummary | null {
  const table = PEGGING_PAIRWISE_TABLES[engine];
  const base = table?.baseTable;
  if (!table || !base) return null;
  if (policy !== "ev" && policy !== "on" && policy !== "off") return null;
  const keepKey = rankCountsForCards(keep).join("");
  const keepId = base.keepIdByKey.get(keepKey);
  if (keepId === undefined) return null;
  const available = remainingRankCounts(knownCards);
  const cacheKey = `${engine}:${role}:${leadRank ?? "-"}:${policy}:${keepKey}:${available.join("")}`;
  if (PAIRWISE_PEGGING_OUTCOME_CACHE.has(cacheKey)) {
    return PAIRWISE_PEGGING_OUTCOME_CACHE.get(cacheKey) ?? null;
  }
  const baseStart = role === "dealer"
    ? base.dealerOffsets[keepId]
    : base.poneOffsets[(keepId * 13) + (leadRank ?? 0)];
  const baseEnd = role === "dealer"
    ? base.dealerOffsets[keepId + 1]
    : base.poneOffsets[(keepId * 13) + (leadRank ?? 0) + 1];
  const overrideStart = role === "dealer"
    ? table.dealerOffsets[keepId]
    : table.poneOffsets[(keepId * 13) + (leadRank ?? 0)];
  const overrideEnd = role === "dealer"
    ? table.dealerOffsets[keepId + 1]
    : table.poneOffsets[(keepId * 13) + (leadRank ?? 0) + 1];
  const overrideRecords = role === "dealer" ? table.dealerSparseRecords : table.poneSparseRecords;
  const hist = new Map<string, number>();
  let totalWeight = 0;
  let myTotal = 0;
  let opponentTotal = 0;
  let overrideCursor = overrideStart;
  for (let index = baseStart; index < baseEnd; index += 1) {
    const ev = unpackBasePairwiseRecord(base, role, index, "ev");
    while (overrideCursor < overrideEnd) {
      const candidate = unpackSparseBoundedRecord(overrideRecords, overrideCursor);
      if (candidate.opponentKeepId >= ev.opponentKeepId) break;
      overrideCursor += 1;
    }
    const override = overrideCursor < overrideEnd
      ? unpackSparseBoundedRecord(overrideRecords, overrideCursor)
      : null;
    const pair = override?.opponentKeepId === ev.opponentKeepId
      ? sparseBoundedPairForPolicy(override, policy)
      : null;
    const record = pair
      ? { ...ev, myPegging: pair.myPegging, opponentPegging: pair.opponentPegging }
      : ev;
    const opponentRanks = base.keepRanks[record.opponentKeepId];
    const weight = opponentKeepWeight(available, opponentRanks);
    if (!weight) continue;
    addPeggingSummaryRecord(hist, record.myPegging, record.opponentPegging, weight);
    totalWeight += weight;
    myTotal += record.myPegging * weight;
    opponentTotal += record.opponentPegging * weight;
  }
  const summary = summarizePeggingHist(hist, totalWeight, myTotal, opponentTotal);
  boundedCacheSet(PAIRWISE_PEGGING_OUTCOME_CACHE, cacheKey, summary, PAIRWISE_PEGGING_OUTCOME_CACHE_LIMIT);
  return summary;
}

function aggregateFrontierPeggingOutcomes(
  keep: Card[],
  role: "dealer" | "pone",
  engine: Opponent,
  knownCards: Card[],
  leadRank: number | null,
  policy: PeggingOutcomePolicy = "ev",
): PeggingOutcomeSummary | null {
  const table = PEGGING_PAIRWISE_TABLES[engine];
  const base = table?.baseTable;
  if (!table || !base) return null;
  const frontierIndex = frontierPolicyIndex(policy);
  if (policy !== "ev" && policy !== "frontier-on" && policy !== "frontier-off" && frontierIndex === null) return null;
  const keepKey = rankCountsForCards(keep).join("");
  const keepId = base.keepIdByKey.get(keepKey);
  if (keepId === undefined) return null;
  const available = remainingRankCounts(knownCards);
  const cacheKey = `${engine}:${role}:${leadRank ?? "-"}:${policy}:${keepKey}:${available.join("")}`;
  if (PAIRWISE_PEGGING_OUTCOME_CACHE.has(cacheKey)) {
    return PAIRWISE_PEGGING_OUTCOME_CACHE.get(cacheKey) ?? null;
  }
  const baseStart = role === "dealer"
    ? base.dealerOffsets[keepId]
    : base.poneOffsets[(keepId * 13) + (leadRank ?? 0)];
  const baseEnd = role === "dealer"
    ? base.dealerOffsets[keepId + 1]
    : base.poneOffsets[(keepId * 13) + (leadRank ?? 0) + 1];
  const frontierStart = role === "dealer"
    ? table.dealerOffsets[keepId]
    : table.poneOffsets[(keepId * 13) + (leadRank ?? 0)];
  const frontierEnd = role === "dealer"
    ? table.dealerOffsets[keepId + 1]
    : table.poneOffsets[(keepId * 13) + (leadRank ?? 0) + 1];
  const frontierRecords = role === "dealer" ? table.dealerFrontierRecords : table.poneFrontierRecords;
  const outcomes = table.frontierOutcomes;
  const hist = new Map<string, number>();
  let totalWeight = 0;
  let myTotal = 0;
  let opponentTotal = 0;
  let frontierCursor = frontierStart;
  for (let index = baseStart; index < baseEnd; index += 1) {
    const ev = unpackBasePairwiseRecord(base, role, index, "ev");
    while (frontierCursor < frontierEnd) {
      const candidate = unpackFrontierRecord(frontierRecords, frontierCursor);
      if (candidate.opponentKeepId >= ev.opponentKeepId) break;
      frontierCursor += 1;
    }
    const frontier = frontierCursor < frontierEnd
      ? unpackFrontierRecord(frontierRecords, frontierCursor)
      : null;
    const pair = frontier?.opponentKeepId === ev.opponentKeepId && policy !== "ev"
      ? frontierPairForPolicy(outcomes, frontier, policy)
      : null;
    const record = pair
      ? { ...ev, myPegging: pair.myPegging, opponentPegging: pair.opponentPegging }
      : ev;
    const opponentRanks = base.keepRanks[record.opponentKeepId];
    const weight = opponentKeepWeight(available, opponentRanks);
    if (!weight) continue;
    addPeggingSummaryRecord(hist, record.myPegging, record.opponentPegging, weight);
    totalWeight += weight;
    myTotal += record.myPegging * weight;
    opponentTotal += record.opponentPegging * weight;
  }
  const summary = summarizePeggingHist(hist, totalWeight, myTotal, opponentTotal);
  boundedCacheSet(PAIRWISE_PEGGING_OUTCOME_CACHE, cacheKey, summary, PAIRWISE_PEGGING_OUTCOME_CACHE_LIMIT);
  return summary;
}

function addPeggingSummaryRecord(hist: Map<string, number>, myPegging: number, opponentPegging: number, weight: number): void {
  const key = `${myPegging},${opponentPegging}`;
  hist.set(key, (hist.get(key) ?? 0) + weight);
}

function summarizePeggingHist(
  hist: Map<string, number>,
  totalWeight: number,
  myTotal: number,
  opponentTotal: number,
): PeggingOutcomeSummary | null {
  if (!totalWeight) return null;
  return {
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
}

function unpackPairwiseRecord(record: number): { opponentKeepId: number; myPegging: number; opponentPegging: number; weight: number } {
  return {
    opponentKeepId: record & 0x7ff,
    myPegging: (record >>> 11) & 0x1f,
    opponentPegging: (record >>> 16) & 0x1f,
    weight: ((record >>> 21) & 0xff) + 1,
  };
}

function unpackBasePairwiseRecord(
  table: PeggingPairwiseTable,
  role: "dealer" | "pone",
  index: number,
  policy: PeggingOutcomePolicy,
): { opponentKeepId: number; myPegging: number; opponentPegging: number; weight: number } {
  if (table.format === "aligned7") {
    return unpackAlignedPairwiseRecord(role === "dealer" ? table.dealerAlignedRecords : table.poneAlignedRecords, index, policy);
  }
  if (table.format === "packed49") {
    return unpackPackedPairwiseRecord(role === "dealer" ? table.dealerPackedRecords : table.ponePackedRecords, index, policy);
  }
  const records = role === "dealer" ? table.dealerRecords : table.poneRecords;
  return unpackPairwiseRecord(records?.[index] ?? 0);
}

function unpackSparseBoundedRecord(
  records: Uint8Array | undefined,
  index: number,
): { opponentKeepId: number; onPair: number; offPair: number } {
  if (!records) return { opponentKeepId: 0, onPair: 0xffff, offPair: 0xffff };
  const offset = index * 6;
  return {
    opponentKeepId: records[offset] | (records[offset + 1] << 8),
    onPair: records[offset + 2] | (records[offset + 3] << 8),
    offPair: records[offset + 4] | (records[offset + 5] << 8),
  };
}

function sparseBoundedPairForPolicy(
  record: { onPair: number; offPair: number },
  policy: PeggingOutcomePolicy,
): { myPegging: number; opponentPegging: number } | null {
  const pair = policy === "on"
    ? record.onPair
    : policy === "off"
      ? record.offPair
      : 0xffff;
  return pair === 0xffff ? null : unpackPointPair(pair);
}

function unpackPointPair(pair: number): { myPegging: number; opponentPegging: number } {
  return {
    myPegging: pair & 0x1f,
    opponentPegging: (pair >>> 5) & 0x1f,
  };
}

function unpackFrontierRecord(
  records: DataView | undefined,
  index: number,
): { opponentKeepId: number; outcomeOffset: number; outcomeCount: number } {
  if (!records) return { opponentKeepId: 0, outcomeOffset: 0, outcomeCount: 0 };
  const offset = index * 8;
  return {
    opponentKeepId: records.getUint16(offset, true),
    outcomeOffset: records.getUint32(offset + 2, true),
    outcomeCount: records.getUint16(offset + 6, true),
  };
}

function frontierPairAt(
  outcomes: Uint16Array | undefined,
  record: { outcomeOffset: number; outcomeCount: number },
  index: number,
): { myPegging: number; opponentPegging: number } | null {
  if (!outcomes || index < 0 || index >= record.outcomeCount) return null;
  return unpackPointPair(outcomes[record.outcomeOffset + index]);
}

function frontierPairForPolicy(
  outcomes: Uint16Array | undefined,
  record: { outcomeOffset: number; outcomeCount: number },
  policy: PeggingOutcomePolicy,
): { myPegging: number; opponentPegging: number } | null {
  const frontierIndex = frontierPolicyIndex(policy);
  if (frontierIndex !== null) return frontierPairAt(outcomes, record, frontierIndex);
  if (!outcomes || record.outcomeCount <= 0) return null;
  let best: { myPegging: number; opponentPegging: number } | null = null;
  let bestScore: [number, number] | null = null;
  for (let index = 0; index < record.outcomeCount; index += 1) {
    const pair = frontierPairAt(outcomes, record, index);
    if (!pair) continue;
    const score: [number, number] = policy === "frontier-on"
      ? [pair.myPegging, -pair.opponentPegging]
      : [-pair.opponentPegging, pair.myPegging];
    if (!bestScore || score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
      best = pair;
      bestScore = score;
    }
  }
  return best;
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
): { card: Card; ev: number; winProbability: number } | null {
  if (
    (usesModel13LivePegging(engine) && !usesTripolicyDiscardModel(engine) && !usesSixCardDiscardModel(engine)) ||
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
    const policies = peggingOutcomePolicies(engine);
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
  return best ? { card: best.card, ev: best.ev, winProbability: best.score } : null;
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
  const engine = game.playerEngines[player.key];
  for (const [myPegging, opponentPegging, weight] of hist) {
    total += weight * approximateFutureWinProbabilityForEngine(
      engine,
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

function rankCombinationCount(ranks: RankCounts, available: RankCounts): number {
  return ranks.reduce((total, count, rank) => total * choose(available[rank] ?? 0, count), 1);
}

function fullDeckRankCombinationCount(ranks: RankCounts): number {
  return rankCombinationCount(ranks, Array.from({ length: 13 }, () => 4));
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
      weight: (context.remainingHands[rankCountKey(hand.ranks)] ?? 0) *
        (usesCorrectedDiscardWinProbability(engine)
          ? rankCombinationCount(hand.ranks, available) / (fullDeckRankCombinationCount(hand.ranks) || 1)
          : 1),
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
    engine,
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
          total += weight * approximateFutureWinProbabilityForEngine(
            context.engine,
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
  const probability = totalWeight
    ? total / totalWeight
    : approximateFutureWinProbabilityForEngine(context.engine, myScore, opponentScore, context.perspectiveRole, "handPone");
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

function rankCountsFromKey(key: string): RankCounts {
  return key.split("").map((digit) => Number.parseInt(digit, 10));
}

function addRankCounts(a: RankCounts, b: RankCounts): RankCounts {
  return a.map((count, rank) => count + b[rank]);
}

function subtractRankCounts(a: RankCounts, b: RankCounts): RankCounts {
  return a.map((count, rank) => count - b[rank]);
}

function rankCountsSubset(part: RankCounts, whole: RankCounts): boolean {
  return part.every((count, rank) => count <= whole[rank]);
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
): { choiceScore: number; pointEv: number; winProbability?: number } {
  if (usesModel13LivePegging(engine)) {
    const distribution = optimalPeggingOutcomeDistributionForCandidate(game, player, card, opponentHands);
    const winProbability = expectedWinProbabilityAfterPegging(game, player, distribution);
    return {
      choiceScore: winProbability,
      pointEv: peggingDistributionPointEv(distribution),
      winProbability,
    };
  }
  const pointEv = exhaustivePeggingPointEv(game, player, card, opponentHands);
  if (!usesWinProbabilityPegging(engine)) return { choiceScore: pointEv, pointEv };
  const distribution = peggingOutcomeDistributionForCandidate(game, player, card, opponentHands);
  const winProbability = expectedWinProbabilityAfterPegging(game, player, distribution);
  return { choiceScore: winProbability, pointEv, winProbability };
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
  const winContext = usesKnownCardPostPeggingWinProbability(engine)
    ? postPeggingWinContext(game, player, engine)
    : undefined;
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
    state.postPeggingContext?.key ?? "historic-phase",
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
  const engine = game.playerEngines[player.key];
  const winContext = usesKnownCardPostPeggingWinProbability(engine)
    ? postPeggingWinContext(game, player, engine)
    : undefined;
  let total = 0;
  for (const [key, weight] of distribution.outcomes) {
    const [myPegging, opponentPegging] = parseOutcomeKey(key);
    const myScore = player.score + myPegging;
    const opponentScore = opponent.score + opponentPegging;
    total += weight * (winContext
      ? postPeggingWinProbability(winContext, myScore, opponentScore)
      : approximateFutureWinProbabilityForEngine(
        engine,
        myScore,
        opponentScore,
        player === game.pone ? "pone" : "dealer",
        "handPone",
      ));
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
  return approximateFutureWinProbabilityForEngine(engine, myScore, opponentScore, nextRole, "peggingPone");
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
      winProbability: approximateFutureWinProbabilityForEngine(
        engine,
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
const WIN_PROBABILITY_MEMO_15_1 = new Map<string, number>();

function approximateFutureWinProbabilityForEngine(
  engine: Opponent,
  myScore: number,
  opponentScore: number,
  perspectiveRole: "dealer" | "pone",
  phase: ScorePhase,
): number {
  if (engine === "schell_table-peg_table-15.1" || engine === "schell_table-peg_table-15.2") {
    return approximateFutureWinProbability15_1(myScore, opponentScore, perspectiveRole, phase);
  }
  return approximateFutureWinProbability(myScore, opponentScore, perspectiveRole, phase);
}

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

function approximateFutureWinProbability15_1(
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
  const cached = WIN_PROBABILITY_MEMO_15_1.get(key);
  if (cached !== undefined) return cached;
  WIN_PROBABILITY_MEMO_15_1.set(key, 0.5);

  if (phase === "peggingPone") {
    let probability = 0;
    for (const [ponePoints, poneWeight] of SCORE_PHASE_DISTRIBUTIONS.peggingPone) {
      for (const [dealerPoints, dealerWeight] of SCORE_PHASE_DISTRIBUTIONS.peggingDealer) {
        const nextMy = my + (perspectiveRole === "pone" ? ponePoints : dealerPoints);
        const nextOpponent = opponent + (perspectiveRole === "pone" ? dealerPoints : ponePoints);
        const myOut = nextMy >= 121;
        const opponentOut = nextOpponent >= 121;
        const outcome = myOut && opponentOut
          ? 0.5
          : myOut
            ? 1
            : opponentOut
              ? 0
              : approximateFutureWinProbability15_1(nextMy, nextOpponent, perspectiveRole, "handPone");
        probability += poneWeight * dealerWeight * outcome;
      }
    }
    WIN_PROBABILITY_MEMO_15_1.set(key, probability);
    return probability;
  }

  const scorerRole = phase === "handPone" ? "pone" : "dealer";
  const perspectiveScores = perspectiveRole === scorerRole;
  const distribution = SCORE_PHASE_DISTRIBUTIONS[phase];
  let probability = 0;
  for (const [points, weight] of distribution) {
    if (perspectiveScores) {
      const nextMy = my + points;
      probability += weight * (nextMy >= 121
        ? 1
        : approximateFutureWinProbability15_1(nextMy, opponent, nextPerspectiveRole(perspectiveRole, phase), nextScorePhase(phase)));
    } else {
      const nextOpponent = opponent + points;
      probability += weight * (nextOpponent >= 121
        ? 0
        : approximateFutureWinProbability15_1(my, nextOpponent, nextPerspectiveRole(perspectiveRole, phase), nextScorePhase(phase)));
    }
  }
  WIN_PROBABILITY_MEMO_15_1.set(key, probability);
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
  if (!usesTripolicyDiscardModel(engine)) return null;
  const table = CRIB_TRIPOLICY_TABLES[engine];
  if (!table) return null;
  const discardKey = rankCountsForCards(discard).join("");
  const pairIndex = table.pairIndexByKey.get(discardKey);
  if (pairIndex === undefined) return null;
  const roleIndex = role === "dealer" ? 0 : 1;
  const policyIndex = table.policyIndexByName.get(policy);
  if (policyIndex === undefined) return null;
  const entryIndex = ((roleIndex * table.pairKeys.length + pairIndex) * 13 + cut.rank) * table.policyCount + policyIndex;
  if (entryIndex < 0 || entryIndex >= table.entryCount) return null;
  const directoryOffset = entryIndex * table.directoryRecordBytes;
  const average = table.directory.getFloat32(directoryOffset, true);
  const recordOffset = table.directory.getUint32(directoryOffset + 4, true);
  const recordCount = table.directory.getUint16(directoryOffset + 8, true);
  if (recordCount === 0 && frontierPolicyIndex(policy) !== null) return null;
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

function frontierCribPolicyEntry(
  discard: Card[],
  role: "dealer" | "pone",
  cut: Card,
  engine: Opponent,
  policy: CribPolicy,
): CribTripolicyPolicyEntry | null {
  const table = CRIB_FRONTIER_TABLES[engine];
  if (!table) return null;
  const discardKey = rankCountsForCards(discard).join("");
  const root = table.table[role]?.[discardKey]?.[cut.rank] ?? null;
  if (!root) return null;
  if (policy === "ev") return root.ev ?? null;
  if (policy === "frontier-on" || policy === "frontier-off") {
    let best: CribTripolicyPolicyEntry | null = null;
    let bestScore: [number, number] | null = null;
    for (const frontier of root.frontier ?? []) {
      const direct = frontier.entry.direct ?? [frontier.entry.average, 0];
      const score: [number, number] = policy === "frontier-on"
        ? [direct[0], -direct[1]]
        : [-direct[1], direct[0]];
      if (!bestScore || score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
        best = frontier.entry;
        bestScore = score;
      }
    }
    return best;
  }
  const frontierIndex = frontierPolicyIndex(policy);
  if (frontierIndex === null) return null;
  return root.frontier?.[frontierIndex]?.entry ?? null;
}

function cribPolicyEntry(
  discard: Card[],
  role: "dealer" | "pone",
  cut: Card,
  engine: Opponent,
  policy: CribPolicy,
): CribTripolicyPolicyEntry | null {
  const entry = frontierCribPolicyEntry(discard, role, cut, engine, policy) ??
    tripolicyCribPolicyEntry(discard, role, cut, engine, policy);
  if (entry) return entry;
  return frontierPolicyIndex(policy) !== null
    ? tripolicyCribPolicyEntry(discard, role, cut, engine, "ev")
    : null;
}

function rankCutCribScore(
  discard: Card[],
  role: "dealer" | "pone",
  cut: Card,
  engine: Opponent = DEFAULT_OPPONENT,
  policy: CribPolicy = "ev",
): number {
  const tripolicyScore = cribPolicyEntry(discard, role, cut, engine, policy)?.average;
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

function cardsForRankCountsForScoring(ranks: RankCounts): Card[] {
  const cards: Card[] = [];
  ranks.forEach((count, rank) => {
    for (let index = 0; index < count; index += 1) cards.push(pegCardCache[rank]);
  });
  return cards;
}

function cutRankOptions(deck: Card[]): CutRankOption[] {
  const byRank = Array.from({ length: 13 }, () => [] as Card[]);
  for (const card of deck) byRank[card.rank].push(card);
  const total = deck.length || 1;
  return byRank
    .map((cards, rank) => ({ rank, card: pegCardCache[rank], cards, weight: cards.length / total }))
    .filter((option) => option.cards.length > 0);
}

function suitProbability(cards: Card[], suit: number): number {
  if (!cards.length) return 0;
  return cards.filter((card) => card.suit === suit).length / cards.length;
}

function expectedKnownHandSuitBonusForCutRank(hand: Card[], cut: CutRankOption, crib = false): number {
  let points = 0;
  for (const card of hand) {
    if (card.rankStr === "J") points += suitProbability(cut.cards, card.suit);
  }
  const handSuits = new Set(hand.map((card) => card.suit));
  if (handSuits.size === 1) {
    const suit = hand[0]?.suit;
    const matchProbability = suitProbability(cut.cards, suit);
    if (crib) points += 5 * matchProbability;
    else points += 4 + matchProbability;
  }
  return points;
}

function rankSuitCountsExcluding(availableCards: Card[], excluded: Card): number[][] {
  const counts = Array.from({ length: 13 }, () => Array.from({ length: 4 }, () => 0));
  for (const card of availableCards) {
    if (card.id === excluded.id) continue;
    counts[card.rank][card.suit] += 1;
  }
  return counts;
}

function rankTotalsFromSuitCounts(counts: number[][]): RankCounts {
  return counts.map((suits) => suits.reduce((sum, count) => sum + count, 0));
}

function sameSuitRankHandProbability(ranks: RankCounts, suit: number, suitCounts: number[][], rankTotals: RankCounts): number {
  let probability = 1;
  for (let rank = 0; rank < ranks.length; rank += 1) {
    const count = ranks[rank];
    if (!count) continue;
    if (count > 1) return 0;
    const total = rankTotals[rank] || 0;
    if (!total) return 0;
    probability *= (suitCounts[rank][suit] || 0) / total;
  }
  return probability;
}

function expectedRankHandSuitBonusForCutRank(ranks: RankCounts, cut: CutRankOption, availableCards: Card[]): number {
  let total = 0;
  for (const cutCard of cut.cards) {
    const suitCounts = rankSuitCountsExcluding(availableCards, cutCard);
    const rankTotals = rankTotalsFromSuitCounts(suitCounts);
    let points = 0;
    const jackCount = ranks[10] || 0;
    if (jackCount) {
      points += jackCount * ((suitCounts[10][cutCard.suit] || 0) / (rankTotals[10] || 1));
    }
    for (let suit = 0; suit < 4; suit += 1) {
      const flushProbability = sameSuitRankHandProbability(ranks, suit, suitCounts, rankTotals);
      points += flushProbability * (suit === cutCard.suit ? 5 : 4);
    }
    total += points;
  }
  return total / (cut.cards.length || 1);
}

function expectedCribSuitBonusForCutRank(
  discard: Card[],
  opponentRanks: RankCounts,
  cut: CutRankOption,
  availableCards: Card[],
): number {
  let total = 0;
  for (const cutCard of cut.cards) {
    const suitCounts = rankSuitCountsExcluding(availableCards, cutCard);
    const rankTotals = rankTotalsFromSuitCounts(suitCounts);
    let points = 0;
    for (const card of discard) {
      if (card.rankStr === "J" && card.suit === cutCard.suit) points += 1;
    }
    const opponentJackCount = opponentRanks[10] || 0;
    if (opponentJackCount) {
      points += opponentJackCount * ((suitCounts[10][cutCard.suit] || 0) / (rankTotals[10] || 1));
    }
    if (discard.length === 2 && discard[0].suit === cutCard.suit && discard[1].suit === cutCard.suit) {
      points += 5 * sameSuitRankHandProbability(opponentRanks, cutCard.suit, suitCounts, rankTotals);
    }
    total += points;
  }
  return total / (cut.cards.length || 1);
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
  const entry = cribPolicyEntry(discard, role, cut, engine, policy) ??
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
    const availabilityScale = usesCorrectedDiscardWinProbability(engine)
      ? suitedDiscards.length / (fullDeckRankCombinationCount(ranks) || 1)
      : 1;
    const adjustedWeight = opponentDiscard.weight * availabilityScale;
    const suitedWeight = adjustedWeight / suitedDiscards.length;
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

function cribScoreOutcomesForCutRank(
  discard: Card[],
  cut: CutRankOption,
  role: "dealer" | "pone",
  seenCards: Card[],
  engine: Opponent = DEFAULT_OPPONENT,
  policy: CribPolicy = "ev",
): Array<[number, number]> {
  const discardKey = rankCountsForCards(discard).join("");
  const entry = cribPolicyEntry(discard, role, cut.card, engine, policy) ??
    CRIB_SCORE_HISTOGRAM_BY_DISCARD_CUT[role]?.[discardKey]?.[cut.rank];
  if (!entry) {
    const fallback = rankCutCribScore(discard, role, cut.card, engine, policy) +
      expectedKnownHandSuitBonusForCutRank(discard, cut, true);
    return [[fallback, 1]];
  }
  const seen = cardIds(seenCards);
  const availableCards = fullDeck().filter((card) => !seen.has(card.id));
  const availableRanks = remainingRankCounts(seenCards);
  availableRanks[cut.rank] = Math.max(0, availableRanks[cut.rank] - 1);
  const outcomes = new Map<number, number>();
  let totalWeight = 0;
  for (const opponentDiscard of entry.opponentDiscards) {
    const ranks = opponentDiscard.ranks.split("").map((digit) => Number.parseInt(digit, 10));
    const availabilityScale = usesCorrectedDiscardWinProbability(engine)
      ? rankCombinationCount(ranks, availableRanks) / (fullDeckRankCombinationCount(ranks) || 1)
      : 1;
    const adjustedWeight = opponentDiscard.weight * availabilityScale;
    if (adjustedWeight <= 0) continue;
    const score = opponentDiscard.rankScore +
      expectedCribSuitBonusForCutRank(discard, ranks, cut, availableCards);
    outcomes.set(score, (outcomes.get(score) ?? 0) + adjustedWeight);
    totalWeight += adjustedWeight;
  }
  if (!totalWeight) {
    const fallback = rankCutCribScore(discard, role, cut.card, engine, policy) +
      expectedKnownHandSuitBonusForCutRank(discard, cut, true);
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

function opponentUpcomingHandScoreDistributionForDiscard(
  fullHand: Card[],
  cut: Card,
  opponentRole: "dealer" | "pone",
  engine: Opponent,
): ScoreDistribution {
  if (!usesCorrectedDiscardWinProbability(engine) || !PEGGING_HOLD_TABLES[engine]) {
    return SCORE_PHASE_DISTRIBUTIONS[opponentRole === "dealer" ? "handDealer" : "handPone"] ??
      [[scorePhaseAverage(opponentRole === "dealer" ? "handDealer" : "handPone"), 1]];
  }
  const cacheKey = [
    engine,
    opponentRole,
    cardSetKey(fullHand),
    cut.id,
  ].join(":");
  const cached = DISCARD_OPPONENT_HAND_SCORE_CACHE.get(cacheKey);
  if (cached) return cached;

  const knownCards = [...fullHand, cut];
  const knownIds = cardIds(knownCards);
  const availableCards = fullDeck().filter((card) => !knownIds.has(card.id));
  const rankCounts = remainingRankCounts(knownCards);
  const prefixFreeOpponent: PlayerState = {
    key: "ai",
    name: "opponent",
    hand: [],
    table: [],
    crib: [],
    score: 0,
  };
  const opponentHands = opponentRankHandsForEngine(rankCounts, 4, prefixFreeOpponent, opponentRole, engine);
  const outcomes = new Map<number, number>();
  const suitedHandCache = new Map<string, Card[][]>();
  let totalWeight = 0;

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
      const score = scoreHand(suitedHand, cut);
      outcomes.set(score, (outcomes.get(score) ?? 0) + suitedWeight);
      totalWeight += suitedWeight;
    }
  }

  const distribution = totalWeight
    ? [...outcomes.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([score, weight]) => [score, weight / totalWeight] as [number, number])
    : [[scorePhaseAverage(opponentRole === "dealer" ? "handDealer" : "handPone"), 1] as [number, number]];
  boundedCacheSet(
    DISCARD_OPPONENT_HAND_SCORE_CACHE,
    cacheKey,
    distribution,
    DISCARD_OPPONENT_HAND_SCORE_CACHE_LIMIT,
  );
  return distribution;
}

function opponentUpcomingHandScoreDistributionForDiscardRank(
  fullHand: Card[],
  cut: CutRankOption,
  opponentRole: "dealer" | "pone",
  engine: Opponent,
): ScoreDistribution {
  if (!usesCorrectedDiscardWinProbability(engine) || !PEGGING_HOLD_TABLES[engine]) {
    return SCORE_PHASE_DISTRIBUTIONS[opponentRole === "dealer" ? "handDealer" : "handPone"] ??
      [[scorePhaseAverage(opponentRole === "dealer" ? "handDealer" : "handPone"), 1]];
  }
  const cacheKey = [
    "rank-cut",
    engine,
    opponentRole,
    cardSetKey(fullHand),
    cut.rank,
    cut.cards.map((card) => card.id).join(","),
  ].join(":");
  const cached = DISCARD_OPPONENT_HAND_SCORE_CACHE.get(cacheKey);
  if (cached) return cached;

  const knownIds = cardIds(fullHand);
  const availableCards = fullDeck().filter((card) => !knownIds.has(card.id));
  const rankCounts = remainingRankCounts(fullHand);
  rankCounts[cut.rank] = Math.max(0, rankCounts[cut.rank] - 1);
  const prefixFreeOpponent: PlayerState = {
    key: "ai",
    name: "opponent",
    hand: [],
    table: [],
    crib: [],
    score: 0,
  };
  const opponentHands = opponentRankHandsForEngine(rankCounts, 4, prefixFreeOpponent, opponentRole, engine);
  const outcomes = new Map<number, number>();
  let totalWeight = 0;

  for (const hand of opponentHands) {
    const rankOnlyHand = cardsForRankCountsForScoring(hand.ranks);
    const score = scoreHandRankOnly(rankOnlyHand, cut.card) +
      expectedRankHandSuitBonusForCutRank(hand.ranks, cut, availableCards);
    outcomes.set(score, (outcomes.get(score) ?? 0) + hand.weight);
    totalWeight += hand.weight;
  }

  const distribution = totalWeight
    ? [...outcomes.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([score, weight]) => [score, weight / totalWeight] as [number, number])
    : [[scorePhaseAverage(opponentRole === "dealer" ? "handDealer" : "handPone"), 1] as [number, number]];
  boundedCacheSet(
    DISCARD_OPPONENT_HAND_SCORE_CACHE,
    cacheKey,
    distribution,
    DISCARD_OPPONENT_HAND_SCORE_CACHE_LIMIT,
  );
  return distribution;
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
  const engine = game.playerEngines[player.key];
  const opponent = player === game.human ? game.ai : game.human;
  const opponentRole = myCrib ? "pone" : "dealer";
  const nextRole = myCrib ? "pone" : "dealer";
  let total = 0;
  let totalWeight = 0;
  const peggingOutcomes = peggingHist?.length
    ? peggingHist
    : [[pegging.myPeggingEv, pegging.opponentPeggingEv, 1] as [number, number, number]];
  const peggingWeightTotal = peggingOutcomes.reduce((sum, outcome) => sum + outcome[2], 0) || 1;
  const cacheKey = baseOutcomeCache
    ? [
        engine,
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
    if (usesRankOnlyDiscardWinProbabilityApproximation(engine)) {
      for (const cut of cutRankOptions(deck)) {
        const ownHandScore = rankCutHandScore(keep, cut.card) +
          expectedKnownHandSuitBonusForCutRank(keep, cut, false);
        const opponentHandDistribution = opponentUpcomingHandScoreDistributionForDiscardRank(
          fullHand,
          cut,
          opponentRole,
          engine,
        );
        const cribOutcomes = cribScoreOutcomesForCutRank(
          discard,
          cut,
          myCrib ? "dealer" : "pone",
          fullHand,
          engine,
          cribPolicy,
        );
        for (const [cribScore, cribWeight] of cribOutcomes) {
          for (const [opponentHandScore, opponentHandWeight] of opponentHandDistribution) {
            const myBase = ownHandScore + (myCrib ? cribScore : 0);
            const opponentBase = opponentHandScore + (myCrib ? 0 : cribScore);
            const weight = cut.weight * cribWeight * opponentHandWeight;
            const key = `${Math.round(myBase)}:${Math.round(opponentBase)}`;
            baseMap.set(key, (baseMap.get(key) ?? 0) + weight);
          }
        }
      }
    } else {
      for (const cut of deck) {
        const ownHandScore = rankCutHandScore(keep, cut) + scoreFlushAndRightJack(keep, cut, false);
        const opponentHandDistribution = opponentUpcomingHandScoreDistributionForDiscard(
          fullHand,
          cut,
          opponentRole,
          engine,
        );
        const cribOutcomes = cribScoreOutcomesForCut(
          discard,
          cut,
          myCrib ? "dealer" : "pone",
          [...fullHand, cut],
          suitedDiscardCache,
          engine,
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
      total += weight * approximateFutureWinProbabilityForEngine(
        engine,
        myScore,
        opponentScore,
        nextRole,
        "peggingPone",
      );
      totalWeight += weight;
    }
  }
  return totalWeight ? total / totalWeight : 0.5;
}

function analyzeSixCardDiscardChoice(
  hand: Card[],
  selected: Card[],
  myCrib: boolean,
  engine: Opponent,
  context: { game: CribbageGame; player: PlayerState },
): DiscardChoiceAnalysis | null {
  const policy = SIX_CARD_DISCARD_POLICY_TABLES[engine];
  const pairwise = PEGGING_PAIRWISE_TABLES[engine];
  if (!policy || !pairwise) return null;

  const deck = fullDeck().filter((card) => !hand.some((held) => held.id === card.id));
  const role = myCrib ? "dealer" : "pone";
  const opponentRole = myCrib ? "pone" : "dealer";
  const nextRole = myCrib ? "pone" : "dealer";
  const player = context.player;
  const opponent = player === context.game.human ? context.game.ai : context.game.human;
  const fullHandRanks = rankCountsForCards(hand);
  const profile = Boolean((globalThis as SixCardDiscardProfileGlobal).__CRIBBAGE_PROFILE_SIX_CARD_DISCARD);
  const profileStart = profile ? performance.now() : 0;
  const opponentContexts = sixCardOpponentContexts(
    enumerateRankHands(remainingRankCounts(hand), 6),
    opponentRole,
    fullHandRanks,
    policy,
  );
  if (profile) {
    console.error(
      `six-card-discard contexts player=${player.key} role=${role} hand=${hand.map((card) => card.rankStr).join(" ")} contexts=${opponentContexts.length} ms=${(performance.now() - profileStart).toFixed(1)}`,
    );
  }
  const cutOptionsByRank = new Map(cutRankOptions(deck).map((cut) => [cut.rank, cut]));
  const selectedKey = cardSetKey(selected);
  const memo: SixCardDiscardEvaluationMemo = {
    ownHandScore: new Map(),
    opponentHandSuitBonus: new Map(),
    cribSuitBonus: new Map(),
    peggingOptions: new Map(),
  };
  let selectedEvaluation: ReturnType<typeof evaluateSixCardDiscardCandidate> | null = null;
  let recommendedEvaluation: ReturnType<typeof evaluateSixCardDiscardCandidate> | null = null;
  let recommended = hand.slice(0, 2);

  let candidateIndex = 0;
  for (const discard of combinations(hand, 2, 2)) {
    candidateIndex += 1;
    const candidateStart = profile ? performance.now() : 0;
    const keep = hand.filter((card) => !discard.includes(card));
    const evaluation = evaluateSixCardDiscardCandidate({
      keep,
      discard,
      engine,
      role,
      nextRole,
      opponentContexts,
      pairwise,
      cutOptionsByRank,
      deck,
      playerScore: player.score,
      opponentScore: opponent.score,
      memo,
    });
    if (profile) {
      console.error(
        `six-card-discard candidate ${candidateIndex}/15 discard=${discard.map((card) => card.rankStr).join(" ")} ms=${(performance.now() - candidateStart).toFixed(1)} totalMs=${(performance.now() - profileStart).toFixed(1)}`,
      );
    }
    if (!evaluation) continue;
    if (cardSetKey(discard) === selectedKey) selectedEvaluation = evaluation;
    if (
      !recommendedEvaluation ||
      evaluation.winProbability > recommendedEvaluation.winProbability ||
      (
        evaluation.winProbability === recommendedEvaluation.winProbability &&
        evaluation.totalEv > recommendedEvaluation.totalEv
      )
    ) {
      recommendedEvaluation = evaluation;
      recommended = discard;
    }
  }

  if (!recommendedEvaluation) return null;
  const selectedResult = selectedEvaluation ?? recommendedEvaluation;
  return {
    selectedEv: selectedResult.totalEv,
    recommendedEv: recommendedEvaluation.totalEv,
    recommended,
    selectedPegTableLead: selectedResult.bestLead,
    recommendedPegTableLead: recommendedEvaluation.bestLead,
    selectedWinProbability: selectedResult.winProbability,
    recommendedWinProbability: recommendedEvaluation.winProbability,
    selectedComponents: selectedResult.components,
    recommendedComponents: recommendedEvaluation.components,
  };
}

function sixCardOpponentContexts(
  opponentSixHands: WeightedRankHand[],
  opponentRole: "dealer" | "pone",
  fullHandRanks: RankCounts,
  policy: SixCardDiscardPolicyTable,
): SixCardOpponentContext[] {
  const contexts: SixCardOpponentContext[] = [];
  const fullDeckRanks = Array.from({ length: 13 }, () => 4);
  for (const hand of opponentSixHands) {
    const rawChoices = policy.choices(opponentRole, rankCountKey(hand.ranks));
    const totalChoiceWeight = rawChoices.reduce((sum, choice) => sum + choice.weight, 0);
    if (!totalChoiceWeight) continue;
    const choices: SixCardOpponentPolicyChoice[] = [];
    for (const choice of rawChoices) {
      if (!rankCountsSubset(choice.discard, hand.ranks)) continue;
      const keep = subtractRankCounts(hand.ranks, choice.discard);
      choices.push({
        discard: choice.discard,
        discardKey: rankCountKey(choice.discard),
        keep,
        keepKey: rankCountKey(keep),
        probability: choice.weight / totalChoiceWeight,
        scoringCards: cardsForRankCountsForScoring(choice.discard),
      });
    }
    if (!choices.length) continue;
    contexts.push({
      hand,
      cutAvailability: subtractRankCounts(fullDeckRanks, addRankCounts(fullHandRanks, hand.ranks)),
      choices,
    });
  }
  return contexts;
}

function evaluateSixCardDiscardCandidate({
  keep,
  discard,
  engine,
  role,
  nextRole,
  opponentContexts,
  pairwise,
  cutOptionsByRank,
  deck,
  playerScore,
  opponentScore,
  memo,
}: {
  keep: Card[];
  discard: Card[];
  engine: Opponent;
  role: "dealer" | "pone";
  nextRole: "dealer" | "pone";
  opponentContexts: SixCardOpponentContext[];
  pairwise: PeggingPairwiseTable;
  cutOptionsByRank: Map<number, CutRankOption>;
  deck: Card[];
  playerScore: number;
  opponentScore: number;
  memo: SixCardDiscardEvaluationMemo;
}): {
  winProbability: number;
  totalEv: number;
  bestLead: number | null;
  components: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
} | null {
  const keepRanks = rankCountsForCards(keep);
  const keepKey = rankCountKey(keepRanks);
  const discardKey = cardSetKey(discard);
  const leadEvaluations = new Map<number, {
    totalWeight: number;
    winProbabilityOutcomes: Map<number, number>;
    ownHandTotal: number;
    opponentHandTotal: number;
    cribTotal: number;
    ownPeggingTotal: number;
    opponentPeggingTotal: number;
  }>();

  const availableCardsAfterOwnHand = deck;
  for (const opponentContext of opponentContexts) {
    for (const opponentChoice of opponentContext.choices) {
      const peggingOptionsKey = `${role}:${keepKey}:${opponentChoice.keepKey}`;
      const peggingOptions = memo.peggingOptions.get(peggingOptionsKey) ??
        pairwisePeggingOptionsForKeeps(pairwise, keepRanks, role, opponentChoice.keep);
      memo.peggingOptions.set(peggingOptionsKey, peggingOptions);
      if (!peggingOptions.length) continue;

      for (let cutRank = 0; cutRank < 13; cutRank += 1) {
        const cutWeight = opponentContext.cutAvailability[cutRank];
        if (cutWeight <= 0) continue;
        const cut = cutOptionsByRank.get(cutRank);
        if (!cut) continue;
        const baseWeight = opponentContext.hand.weight * opponentChoice.probability * cutWeight;
        const ownHandScoreKey = `${keepKey}:${cutRank}`;
        const ownHandScore = memo.ownHandScore.get(ownHandScoreKey) ??
          (
            rankCutHandScore(keep, cut.card) +
            expectedKnownHandSuitBonusForCutRank(keep, cut, false)
          );
        memo.ownHandScore.set(ownHandScoreKey, ownHandScore);
        const opponentSuitBonusKey = `${opponentChoice.keepKey}:${cutRank}`;
        const opponentSuitBonus = memo.opponentHandSuitBonus.get(opponentSuitBonusKey) ??
          expectedRankHandSuitBonusForCutRank(opponentChoice.keep, cut, availableCardsAfterOwnHand);
        memo.opponentHandSuitBonus.set(opponentSuitBonusKey, opponentSuitBonus);
        const opponentHandScore = handRankScoreForRanks(opponentChoice.keepKey, opponentChoice.keep, cut) +
          opponentSuitBonus;
        const cribSuitBonusKey = `${discardKey}:${opponentChoice.discardKey}:${cutRank}`;
        const cribSuitBonus = memo.cribSuitBonus.get(cribSuitBonusKey) ??
          expectedCribSuitBonusForCutRank(
            discard,
            opponentChoice.discard,
            cut,
            availableCardsAfterOwnHand,
          );
        memo.cribSuitBonus.set(cribSuitBonusKey, cribSuitBonus);
        const cribScore = scoreHandRankOnly([
          ...discard,
          ...opponentChoice.scoringCards,
        ], cut.card) + cribSuitBonus;
        for (const pegging of peggingOptions) {
          const leadKey = pegging.leadRank ?? -1;
          const accumulator = leadEvaluations.get(leadKey) ?? {
            totalWeight: 0,
            winProbabilityOutcomes: new Map<number, number>(),
            ownHandTotal: 0,
            opponentHandTotal: 0,
            cribTotal: 0,
            ownPeggingTotal: 0,
            opponentPeggingTotal: 0,
          };
          const ownRoundScore = pegging.ownPegging + ownHandScore + (role === "dealer" ? cribScore : 0);
          const opponentRoundScore = pegging.opponentPegging + opponentHandScore + (role === "dealer" ? 0 : cribScore);
          accumulator.totalWeight += baseWeight;
          const futureScoreKey = roundedScorePairKey(playerScore + ownRoundScore, opponentScore + opponentRoundScore);
          accumulator.winProbabilityOutcomes.set(
            futureScoreKey,
            (accumulator.winProbabilityOutcomes.get(futureScoreKey) ?? 0) + baseWeight,
          );
          accumulator.ownHandTotal += ownHandScore * baseWeight;
          accumulator.opponentHandTotal += opponentHandScore * baseWeight;
          accumulator.cribTotal += cribScore * baseWeight;
          accumulator.ownPeggingTotal += pegging.ownPegging * baseWeight;
          accumulator.opponentPeggingTotal += pegging.opponentPegging * baseWeight;
          leadEvaluations.set(leadKey, accumulator);
        }
      }
    }
  }

  let best: {
    leadRank: number;
    winProbability: number;
    totalEv: number;
    components: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
  } | null = null;
  for (const [leadRank, accumulator] of leadEvaluations) {
    if (!accumulator.totalWeight) continue;
    const handScore = accumulator.ownHandTotal / accumulator.totalWeight;
    const cribScore = accumulator.cribTotal / accumulator.totalWeight;
    const netPegging = (accumulator.ownPeggingTotal - accumulator.opponentPeggingTotal) / accumulator.totalWeight;
    const totalEv = (role === "dealer" ? handScore + cribScore : handScore - cribScore) + netPegging;
    let winProbabilityTotal = 0;
    for (const [scoreKey, weight] of accumulator.winProbabilityOutcomes) {
      const [myScore, futureOpponentScore] = roundedScorePairFromKey(scoreKey);
      winProbabilityTotal += weight * approximateFutureWinProbabilityForEngine(
        engine,
        myScore,
        futureOpponentScore,
        nextRole,
        "peggingPone",
      );
    }
    const winProbability = winProbabilityTotal / accumulator.totalWeight;
    const components: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>> = {
      [role === "dealer" ? "handDealer" : "handPone"]: handScore,
      [role === "dealer" ? "peggingDealer" : "peggingPone"]: netPegging,
      crib: role === "dealer" ? cribScore : -cribScore,
    };
    if (
      !best ||
      winProbability > best.winProbability ||
      (winProbability === best.winProbability && totalEv > best.totalEv) ||
      (
        winProbability === best.winProbability &&
        totalEv === best.totalEv &&
        leadTieValue(leadRank) < leadTieValue(best.leadRank)
      )
    ) {
      best = { leadRank, winProbability, totalEv, components };
    }
  }
  return best
    ? {
        winProbability: best.winProbability,
        totalEv: best.totalEv,
        bestLead: best.leadRank >= 0 ? best.leadRank : null,
        components: best.components,
      }
    : null;
}

function handRankScoreForRanks(keepKey: string, ranks: RankCounts, cut: CutRankOption): number {
  const tableScore = HAND_RANK_SCORE_BY_KEEP_CUT[keepKey]?.[cut.rank];
  if (typeof tableScore === "number") return tableScore;
  return scoreHandRankOnly(cardsForRankCountsForScoring(ranks), cut.card);
}

function leadTieValue(leadRank: number): number {
  return leadRank >= 0 ? VALUES[leadRank] : -1;
}

function roundedScorePairKey(myScore: number, opponentScore: number): number {
  const mine = Math.min(121, Math.max(0, Math.round(myScore)));
  const opponent = Math.min(121, Math.max(0, Math.round(opponentScore)));
  return (mine * 122) + opponent;
}

function roundedScorePairFromKey(key: number): [number, number] {
  return [Math.floor(key / 122), key % 122];
}

function pairwisePeggingOptionsForKeeps(
  table: PeggingPairwiseTable,
  ownKeep: RankCounts,
  role: "dealer" | "pone",
  opponentKeep: RankCounts,
): Array<{ leadRank: number | null; ownPegging: number; opponentPegging: number }> {
  const ownKeepId = table.keepIdByKey.get(rankCountKey(ownKeep));
  const opponentKeepId = table.keepIdByKey.get(rankCountKey(opponentKeep));
  if (ownKeepId === undefined || opponentKeepId === undefined) return [];
  if (role === "dealer") {
    const record = findPairwisePeggingRecord(
      table,
      "dealer",
      table.dealerOffsets[ownKeepId],
      table.dealerOffsets[ownKeepId + 1],
      opponentKeepId,
    );
    return record ? [{ leadRank: null, ownPegging: record.myPegging, opponentPegging: record.opponentPegging }] : [];
  }
  const options: Array<{ leadRank: number; ownPegging: number; opponentPegging: number }> = [];
  for (const leadRank of legalPegRanks(ownKeep, 0)) {
    const start = table.poneOffsets[(ownKeepId * 13) + leadRank];
    const end = table.poneOffsets[(ownKeepId * 13) + leadRank + 1];
    const record = findPairwisePeggingRecord(table, "pone", start, end, opponentKeepId);
    if (record) options.push({ leadRank, ownPegging: record.myPegging, opponentPegging: record.opponentPegging });
  }
  return options;
}

function findPairwisePeggingRecord(
  table: PeggingPairwiseTable,
  role: "dealer" | "pone",
  start: number,
  end: number,
  opponentKeepId: number,
): { opponentKeepId: number; myPegging: number; opponentPegging: number; weight: number } | null {
  for (let index = start; index < end; index += 1) {
    const record = unpackBasePairwiseRecord(table, role, index, "ev");
    if (record.opponentKeepId === opponentKeepId) return record;
    if (record.opponentKeepId > opponentKeepId) break;
  }
  return null;
}

function normalizeEmpiricalDiscardKeepTable(source: EmpiricalDiscardKeepJson): EmpiricalDiscardKeepRuntimeTable {
  const normalizeDiscard = ([key, entry]: [string, EmpiricalDiscardKeepJsonEntry]): EmpiricalRuntimeEntry => {
    const ranks = rankCountsFromKey(key);
    return {
      key,
      ranks,
      count: entry.count,
      fullCombinationCount: fullDeckRankCombinationCount(ranks) || 1,
      scoringCards: cardsForRankCountsForScoring(ranks),
      suitedRate: entry.suitedRate ?? (entry.count ? (entry.suitedCount ?? 0) / entry.count : 0),
    };
  };
  const normalizeKeep = ([key, count]: [string, number]): EmpiricalRuntimeEntry => {
    const ranks = rankCountsFromKey(key);
    return {
      key,
      ranks,
      count,
      fullCombinationCount: fullDeckRankCombinationCount(ranks) || 1,
      scoringCards: cardsForRankCountsForScoring(ranks),
    };
  };
  return {
    roles: {
      dealer: {
        suitedDiscardRate: source.roles.dealer.suitedDiscardRate,
        distinctSuitedDiscardRate: source.roles.dealer.distinctSuitedDiscardRate,
        discards: Object.entries(source.roles.dealer.discards).map(normalizeDiscard),
        keeps: Object.entries(source.roles.dealer.keeps).map(normalizeKeep),
      },
      pone: {
        suitedDiscardRate: source.roles.pone.suitedDiscardRate,
        distinctSuitedDiscardRate: source.roles.pone.distinctSuitedDiscardRate,
        discards: Object.entries(source.roles.pone.discards).map(normalizeDiscard),
        keeps: Object.entries(source.roles.pone.keeps).map(normalizeKeep),
      },
    },
  };
}

function adjustedEmpiricalEntries(
  entries: EmpiricalRuntimeEntry[],
  availableRanks: RankCounts,
  cache: Map<string, EmpiricalWeightedEntry[]>,
  cacheKey: string,
  fallbackSize: number,
  fallbackSuitedRate = 0,
): EmpiricalWeightedEntry[] {
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  let adjusted = entries
    .map((entry) => {
      const availableCombinations = rankCombinationCount(entry.ranks, availableRanks);
      const weight = entry.count * (availableCombinations / entry.fullCombinationCount);
      return { ...entry, weight };
    })
    .filter((entry) => entry.weight > 0);
  if (!adjusted.length) {
    adjusted = enumerateRankHands(availableRanks, fallbackSize)
      .map((hand) => {
        const key = rankCountKey(hand.ranks);
        return {
          key,
          ranks: hand.ranks,
          count: 0,
          fullCombinationCount: fullDeckRankCombinationCount(hand.ranks) || 1,
          scoringCards: cardsForRankCountsForScoring(hand.ranks),
          suitedRate: fallbackSize === 2 ? fallbackSuitedRate : undefined,
          weight: hand.weight,
        };
      })
      .filter((entry) => entry.weight > 0);
  }
  cache.set(cacheKey, adjusted);
  return adjusted;
}

function rankPairCanBeSuited(ranks: RankCounts): boolean {
  return ranks.reduce((sum, count) => sum + count, 0) === 2 && ranks.every((count) => count <= 1);
}

function normalizedScoreOutcomes(outcomes: Map<number, number>, totalWeight: number): Array<[number, number]> {
  return [...outcomes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([score, weight]) => [score, weight / totalWeight]);
}

function scoreOutcomeResult(outcomes: Map<number, number>, totalWeight: number): {
  outcomes: Array<[number, number]>;
  average: number;
} {
  if (!totalWeight) return { outcomes: [], average: 0 };
  let total = 0;
  for (const [score, weight] of outcomes) total += score * weight;
  return {
    outcomes: normalizedScoreOutcomes(outcomes, totalWeight),
    average: total / totalWeight,
  };
}

function rankHandSuitBonusOutcomesForCutCard(
  ranks: RankCounts,
  cutCard: Card,
  availableCards: Card[],
): Array<[number, number]> {
  const suitCounts = rankSuitCountsExcluding(availableCards, cutCard);
  const rankTotals = rankTotalsFromSuitCounts(suitCounts);
  const outcomes = new Map<number, number>();
  const totalHandCombinations = rankCombinationCount(ranks, rankTotals);
  if (!totalHandCombinations) return [];

  const jackCount = ranks[10] || 0;
  let knobProbability = 0;
  if (jackCount > 0) {
    const totalJacks = rankTotals[10] || 0;
    const cutSuitJackAvailable = suitCounts[10]?.[cutCard.suit] || 0;
    const jackDenominator = choose(totalJacks, jackCount);
    if (cutSuitJackAvailable && jackDenominator) {
      knobProbability = choose(totalJacks - 1, jackCount - 1) / jackDenominator;
    }
  }

  const flushBySuit = [0, 0, 0, 0];
  if (ranks.reduce((sum, count) => sum + count, 0) === 4 && ranks.every((count) => count <= 1)) {
    for (let suit = 0; suit < 4; suit += 1) {
      flushBySuit[suit] = sameSuitRankHandProbability(ranks, suit, suitCounts, rankTotals);
    }
  }

  const flushCutProbability = flushBySuit[cutCard.suit] || 0;
  const flushOtherProbability = flushBySuit.reduce(
    (sum, probability, suit) => sum + (suit === cutCard.suit ? 0 : probability),
    0,
  );
  const flushCutIncludesKnob = jackCount > 0 ? flushCutProbability : 0;
  const knobOnlyProbability = Math.max(0, knobProbability - flushCutIncludesKnob);
  const noBonusProbability = Math.max(
    0,
    1 - flushCutProbability - flushOtherProbability - knobOnlyProbability,
  );

  if (noBonusProbability > 0) outcomes.set(0, noBonusProbability);
  if (knobOnlyProbability > 0) outcomes.set(1, (outcomes.get(1) ?? 0) + knobOnlyProbability);
  if (flushOtherProbability > 0) outcomes.set(4, (outcomes.get(4) ?? 0) + flushOtherProbability);
  if (flushCutProbability > 0) {
    const bonus = 5 + (jackCount > 0 ? 1 : 0);
    outcomes.set(bonus, (outcomes.get(bonus) ?? 0) + flushCutProbability);
  }

  const totalWeight = [...outcomes.values()].reduce((sum, weight) => sum + weight, 0);
  return totalWeight ? normalizedScoreOutcomes(outcomes, totalWeight) : [];
}

function empiricalOwnHandScoreOutcomesForCutRank(
  keep: Card[],
  keepKey: string,
  cut: CutRankOption,
  memo: EmpiricalDiscardEvaluationMemo,
): { outcomes: Array<[number, number]>; average: number } {
  const cacheKey = `${keepKey}:${cut.rank}:${cut.cards.map((card) => card.id).join(",")}`;
  const cached = memo.ownHandScoreOutcomes.get(cacheKey);
  if (cached) return cached;
  const outcomes = new Map<number, number>();
  for (const cutCard of cut.cards) {
    const score = rankCutHandScore(keep, cutCard) + scoreFlushAndRightJack(keep, cutCard, false);
    outcomes.set(score, (outcomes.get(score) ?? 0) + 1);
  }
  const result = scoreOutcomeResult(outcomes, cut.cards.length);
  memo.ownHandScoreOutcomes.set(cacheKey, result);
  return result;
}

function empiricalSuitedSplitWeights(
  entry: EmpiricalWeightedEntry,
  roleTable: EmpiricalRuntimeRole,
  suited: Card[][],
  unsuited: Card[][],
): { suited: number; unsuited: number } {
  if (!rankPairCanBeSuited(entry.ranks) || !suited.length) return { suited: 0, unsuited: entry.weight };
  if (!unsuited.length) return { suited: entry.weight, unsuited: 0 };
  const suitedRate = Math.max(
    0,
    Math.min(1, entry.suitedRate ?? roleTable.distinctSuitedDiscardRate ?? roleTable.suitedDiscardRate),
  );
  return {
    suited: entry.weight * suitedRate,
    unsuited: entry.weight * (1 - suitedRate),
  };
}

function empiricalCribScoreOutcomesForCutCard({
  discard,
  opponentRole,
  cutCard,
  availableRanks,
  availableCards,
  table,
  memo,
}: {
  discard: Card[];
  opponentRole: "dealer" | "pone";
  cutCard: Card;
  availableRanks: RankCounts;
  availableCards: Card[];
  table: EmpiricalDiscardKeepRuntimeTable;
  memo: EmpiricalDiscardEvaluationMemo;
}): { outcomes: Array<[number, number]>; average: number } {
  const cacheKey = `${opponentRole}:${cardSetKey(discard)}:${cutCard.id}:${idsKey(availableCards)}`;
  const cached = memo.cribScoreOutcomes.get(cacheKey);
  if (cached) return cached;
  const roleTable = table.roles[opponentRole];
  const entries = adjustedEmpiricalEntries(
    roleTable.discards,
    availableRanks,
    memo.adjustedDiscards,
    `${opponentRole}:${availableRanks.join("")}`,
    2,
    roleTable.distinctSuitedDiscardRate || roleTable.suitedDiscardRate,
  );
  const outcomes = new Map<number, number>();
  let totalWeight = 0;
  let total = 0;
  for (const entry of entries) {
    const rankScore = scoreHandRankOnly([...discard, ...entry.scoringCards], cutCard);
    const suitedDiscards = cardsForRankCounts(availableCards, entry.ranks);
    if (!suitedDiscards.length) continue;
    const suited: Card[][] = [];
    const unsuited: Card[][] = [];
    for (const suitedDiscard of suitedDiscards) {
      const suits = new Set(suitedDiscard.map((card) => card.suit));
      if (rankPairCanBeSuited(entry.ranks) && suits.size === 1) suited.push(suitedDiscard);
      else unsuited.push(suitedDiscard);
    }
    const split = empiricalSuitedSplitWeights(entry, roleTable, suited, unsuited);
    for (const [group, groupWeight] of [[suited, split.suited], [unsuited, split.unsuited]] as const) {
      if (!group.length || groupWeight <= 0) continue;
      const suitedWeight = groupWeight / group.length;
      for (const opponentDiscard of group) {
        const score = rankScore + cribSuitBonus(discard, opponentDiscard, cutCard);
        outcomes.set(score, (outcomes.get(score) ?? 0) + suitedWeight);
        total += score * suitedWeight;
        totalWeight += suitedWeight;
      }
    }
  }
  const result = totalWeight
    ? {
        outcomes: normalizedScoreOutcomes(outcomes, totalWeight),
        average: total / totalWeight,
      }
    : { outcomes: [], average: 0 };
  memo.cribScoreOutcomes.set(cacheKey, result);
  return result;
}

function empiricalCribScoreOutcomesForCutRank({
  discard,
  opponentRole,
  cut,
  availableRanks,
  availableCards,
  table,
  memo,
}: {
  discard: Card[];
  opponentRole: "dealer" | "pone";
  cut: CutRankOption;
  availableRanks: RankCounts;
  availableCards: Card[];
  table: EmpiricalDiscardKeepRuntimeTable;
  memo: EmpiricalDiscardEvaluationMemo;
}): { outcomes: Array<[number, number]>; average: number } {
  const cacheKey = `${opponentRole}:${cardSetKey(discard)}:rank:${cut.rank}:${cut.cards
    .map((card) => card.id)
    .join(",")}:${availableRanks.join("")}:${idsKey(availableCards)}`;
  const cached = memo.cribScoreOutcomes.get(cacheKey);
  if (cached) return cached;
  const outcomes = new Map<number, number>();
  const cutCardWeight = 1 / (cut.cards.length || 1);
  let totalWeight = 0;
  for (const cutCard of cut.cards) {
    const cardResult = empiricalCribScoreOutcomesForCutCard({
      discard,
      opponentRole,
      cutCard,
      availableRanks,
      availableCards: availableCards.filter((card) => card.id !== cutCard.id),
      table,
      memo,
    });
    for (const [score, weight] of cardResult.outcomes) {
      const adjustedWeight = weight * cutCardWeight;
      outcomes.set(score, (outcomes.get(score) ?? 0) + adjustedWeight);
      totalWeight += adjustedWeight;
    }
  }
  const result = scoreOutcomeResult(outcomes, totalWeight);
  memo.cribScoreOutcomes.set(cacheKey, result);
  return result;
}

function empiricalScoreOutcomeSignature(outcomes: Array<[number, number]>): string {
  return outcomes.map(([score, weight]) => `${score}:${weight}`).join(",");
}

function empiricalDiscardCandidateEquivalenceKey({
  keep,
  discard,
  opponentRole,
  cutOptionsByRank,
  deck,
  baseAvailableRanks,
  table,
  memo,
}: {
  keep: Card[];
  discard: Card[];
  opponentRole: "dealer" | "pone";
  cutOptionsByRank: Map<number, CutRankOption>;
  deck: Card[];
  baseAvailableRanks: RankCounts;
  table: EmpiricalDiscardKeepRuntimeTable;
  memo: EmpiricalDiscardEvaluationMemo;
}): string {
  const keepRanks = rankCountsForCards(keep);
  const keepKey = rankCountKey(keepRanks);
  const discardKey = rankCountKey(rankCountsForCards(discard));
  const parts = [`keep=${keepKey}`, `discard=${discardKey}`];
  for (const cut of cutOptionsByRank.values()) {
    if ((baseAvailableRanks[cut.rank] || 0) <= 0) continue;
    const availableRanks = [...baseAvailableRanks];
    availableRanks[cut.rank] = Math.max(0, availableRanks[cut.rank] - 1);
    const ownHand = empiricalOwnHandScoreOutcomesForCutRank(keep, keepKey, cut, memo);
    const crib = empiricalCribScoreOutcomesForCutRank({
      discard,
      opponentRole,
      cut,
      availableRanks,
      availableCards: deck,
      table,
      memo,
    });
    parts.push(
      `${cut.rank}:own=${empiricalScoreOutcomeSignature(ownHand.outcomes)};crib=${empiricalScoreOutcomeSignature(crib.outcomes)}`,
    );
  }
  return parts.join("|");
}

function empiricalDiscardCandidateGroups({
  hand,
  opponentRole,
  cutOptionsByRank,
  deck,
  table,
  memo,
  groupEquivalentCandidates,
}: {
  hand: Card[];
  opponentRole: "dealer" | "pone";
  cutOptionsByRank: Map<number, CutRankOption>;
  deck: Card[];
  table: EmpiricalDiscardKeepRuntimeTable;
  memo: EmpiricalDiscardEvaluationMemo;
  groupEquivalentCandidates: boolean;
}): EmpiricalDiscardCandidateGroup[] {
  const groups = new Map<string, EmpiricalDiscardCandidateGroup>();
  const baseAvailableRanks = remainingRankCounts(hand);
  for (const discard of combinations(hand, 2, 2)) {
    const keep = hand.filter((card) => !discard.includes(card));
    const key = groupEquivalentCandidates
      ? empiricalDiscardCandidateEquivalenceKey({
          keep,
          discard,
          opponentRole,
          cutOptionsByRank,
          deck,
          baseAvailableRanks,
          table,
          memo,
        })
      : cardSetKey(discard);
    const existing = groups.get(key);
    const candidate = { discard, keep };
    if (existing) {
      existing.candidates.push(candidate);
    } else {
      groups.set(key, { ...candidate, candidates: [candidate] });
    }
  }
  return [...groups.values()];
}

function empiricalOpponentHandScoreOutcomes(
  entry: EmpiricalWeightedEntry,
  cutCard: Card,
  availableCards: Card[],
  memo: EmpiricalDiscardEvaluationMemo,
): Array<[number, number]> {
  const cacheKey = `${entry.key}:${cutCard.id}:${idsKey(availableCards)}`;
  const cached = memo.opponentHandScoreOutcomes.get(cacheKey);
  if (cached) return cached;
  const outcomes = new Map<number, number>();
  const rankScore = handRankScoreForRanks(entry.key, entry.ranks, {
    rank: cutCard.rank,
    card: cutCard,
    cards: [cutCard],
    weight: 1,
  });
  const suitBonuses = rankHandSuitBonusOutcomesForCutCard(entry.ranks, cutCard, availableCards);
  for (const [bonus, weight] of suitBonuses) {
    outcomes.set(rankScore + bonus, (outcomes.get(rankScore + bonus) ?? 0) + weight);
  }
  const result = suitBonuses.length
    ? normalizedScoreOutcomes(outcomes, 1)
    : [];
  memo.opponentHandScoreOutcomes.set(cacheKey, result);
  return result;
}

function empiricalOpponentHandScoreOutcomesForCutRank(
  entry: EmpiricalWeightedEntry,
  cut: CutRankOption,
  availableCards: Card[],
  memo: EmpiricalDiscardEvaluationMemo,
): Array<[number, number]> {
  const cacheKey = `${entry.key}:rank:${cut.rank}:${cut.cards
    .map((card) => card.id)
    .join(",")}:${idsKey(availableCards)}`;
  const cached = memo.opponentHandScoreOutcomes.get(cacheKey);
  if (cached) return cached;
  const outcomes = new Map<number, number>();
  const cutCardWeight = 1 / (cut.cards.length || 1);
  let totalWeight = 0;
  for (const cutCard of cut.cards) {
    const cardOutcomes = empiricalOpponentHandScoreOutcomes(
      entry,
      cutCard,
      availableCards.filter((card) => card.id !== cutCard.id),
      memo,
    );
    for (const [score, weight] of cardOutcomes) {
      const adjustedWeight = weight * cutCardWeight;
      outcomes.set(score, (outcomes.get(score) ?? 0) + adjustedWeight);
      totalWeight += adjustedWeight;
    }
  }
  const result = totalWeight ? normalizedScoreOutcomes(outcomes, totalWeight) : [];
  memo.opponentHandScoreOutcomes.set(cacheKey, result);
  return result;
}

function empiricalKeepLeadOutcomesForCutRank({
  keepRanks,
  keepKey,
  role,
  opponentRole,
  cut,
  availableRanks,
  availableCards,
  ownHandOutcomes,
  pairwise,
  table,
  memo,
}: {
  keepRanks: RankCounts;
  keepKey: string;
  role: "dealer" | "pone";
  opponentRole: "dealer" | "pone";
  cut: CutRankOption;
  availableRanks: RankCounts;
  availableCards: Card[];
  ownHandOutcomes: Array<[number, number]>;
  pairwise: PeggingPairwiseTable;
  table: EmpiricalDiscardKeepRuntimeTable;
  memo: EmpiricalDiscardEvaluationMemo;
}): Map<number, {
  totalWeight: number;
  baseOutcomes: Map<string, number>;
  ownHandTotal: number;
  opponentHandTotal: number;
  ownPeggingTotal: number;
  opponentPeggingTotal: number;
}> {
  const roleTable = table.roles[opponentRole];
  const entries = adjustedEmpiricalEntries(
    roleTable.keeps,
    availableRanks,
    memo.adjustedKeeps,
    `${opponentRole}:${availableRanks.join("")}`,
    4,
  );
  const leadOutcomes = new Map<number, {
    totalWeight: number;
    baseOutcomes: Map<string, number>;
    ownHandTotal: number;
    opponentHandTotal: number;
    ownPeggingTotal: number;
    opponentPeggingTotal: number;
  }>();
  for (const entry of entries) {
    const opponentHandOutcomes = empiricalOpponentHandScoreOutcomesForCutRank(entry, cut, availableCards, memo);
    if (!opponentHandOutcomes.length) continue;
    const peggingOptionsKey = `${role}:${keepKey}:${entry.key}`;
    const peggingOptions = memo.peggingOptions.get(peggingOptionsKey) ??
      pairwisePeggingOptionsForKeeps(pairwise, keepRanks, role, entry.ranks);
    memo.peggingOptions.set(peggingOptionsKey, peggingOptions);
    if (!peggingOptions.length) continue;
    for (const pegging of peggingOptions) {
      const leadKey = pegging.leadRank ?? -1;
      const accumulator = leadOutcomes.get(leadKey) ?? {
        totalWeight: 0,
        baseOutcomes: new Map<string, number>(),
        ownHandTotal: 0,
        opponentHandTotal: 0,
        ownPeggingTotal: 0,
        opponentPeggingTotal: 0,
      };
      for (const [opponentHandScore, opponentHandWeight] of opponentHandOutcomes) {
        for (const [ownHandScore, ownHandWeight] of ownHandOutcomes) {
          const weight = entry.weight * opponentHandWeight * ownHandWeight;
          const ownBase = ownHandScore + pegging.ownPegging;
          const opponentBase = opponentHandScore + pegging.opponentPegging;
          const baseKey = `${ownBase}:${opponentBase}`;
          accumulator.baseOutcomes.set(baseKey, (accumulator.baseOutcomes.get(baseKey) ?? 0) + weight);
          accumulator.totalWeight += weight;
          accumulator.ownHandTotal += ownHandScore * weight;
          accumulator.opponentHandTotal += opponentHandScore * weight;
          accumulator.ownPeggingTotal += pegging.ownPegging * weight;
          accumulator.opponentPeggingTotal += pegging.opponentPegging * weight;
        }
      }
      leadOutcomes.set(leadKey, accumulator);
    }
  }
  return leadOutcomes;
}

function analyzeEmpiricalDiscardChoice(
  hand: Card[],
  selected: Card[],
  myCrib: boolean,
  engine: Opponent,
  context: { game: CribbageGame; player: PlayerState },
): DiscardChoiceAnalysis | null {
  const pairwise = PEGGING_PAIRWISE_TABLES[engine];
  if (!pairwise) return null;
  const deck = fullDeck().filter((card) => !hand.some((held) => held.id === card.id));
  const role = myCrib ? "dealer" : "pone";
  const opponentRole = myCrib ? "pone" : "dealer";
  const nextRole = myCrib ? "pone" : "dealer";
  const player = context.player;
  const opponent = player === context.game.human ? context.game.ai : context.game.human;
  const cutOptionsByRank = new Map(cutRankOptions(deck).map((cut) => [cut.rank, cut]));
  const selectedKey = cardSetKey(selected);
  const memo: EmpiricalDiscardEvaluationMemo = {
    ownHandScore: new Map(),
    opponentHandSuitBonus: new Map(),
    cribSuitBonus: new Map(),
    peggingOptions: new Map(),
    adjustedDiscards: new Map(),
    adjustedKeeps: new Map(),
    ownHandScoreOutcomes: new Map(),
    cribScoreOutcomes: new Map(),
    opponentHandScoreOutcomes: new Map(),
  };
  let selectedEvaluation: ReturnType<typeof evaluateEmpiricalDiscardCandidate> | null = null;
  let recommendedEvaluation: ReturnType<typeof evaluateEmpiricalDiscardCandidate> | null = null;
  let recommended = hand.slice(0, 2);
  const candidateGroups = empiricalDiscardCandidateGroups({
    hand,
    opponentRole,
    cutOptionsByRank,
    deck,
    table: EMPIRICAL_DISCARD_KEEP_TABLE_14_8,
    memo,
    groupEquivalentCandidates: usesEmpiricalDiscardCandidateGrouping(engine),
  });

  for (const group of candidateGroups) {
    const evaluation = evaluateEmpiricalDiscardCandidate({
      fullHand: hand,
      keep: group.keep,
      discard: group.discard,
      engine,
      role,
      opponentRole,
      nextRole,
      pairwise,
      cutOptionsByRank,
      deck,
      playerScore: player.score,
      opponentScore: opponent.score,
      table: EMPIRICAL_DISCARD_KEEP_TABLE_14_8,
      memo,
    });
    if (!evaluation) continue;
    if (group.candidates.some((candidate) => cardSetKey(candidate.discard) === selectedKey)) {
      selectedEvaluation = evaluation;
    }
    if (
      !recommendedEvaluation ||
      evaluation.winProbability > recommendedEvaluation.winProbability ||
      (
        evaluation.winProbability === recommendedEvaluation.winProbability &&
        evaluation.totalEv > recommendedEvaluation.totalEv
      )
    ) {
      recommendedEvaluation = evaluation;
      recommended = group.discard;
    }
  }

  if (!recommendedEvaluation) return null;
  const selectedResult = selectedEvaluation ?? recommendedEvaluation;
  return {
    selectedEv: selectedResult.totalEv,
    recommendedEv: recommendedEvaluation.totalEv,
    recommended,
    selectedPegTableLead: selectedResult.bestLead,
    recommendedPegTableLead: recommendedEvaluation.bestLead,
    selectedWinProbability: selectedResult.winProbability,
    recommendedWinProbability: recommendedEvaluation.winProbability,
    selectedComponents: selectedResult.components,
    recommendedComponents: recommendedEvaluation.components,
  };
}

function evaluateEmpiricalDiscardCandidate({
  fullHand,
  keep,
  discard,
  engine,
  role,
  opponentRole,
  nextRole,
  pairwise,
  cutOptionsByRank,
  deck,
  playerScore,
  opponentScore,
  table,
  memo,
}: {
  fullHand: Card[];
  keep: Card[];
  discard: Card[];
  engine: Opponent;
  role: "dealer" | "pone";
  opponentRole: "dealer" | "pone";
  nextRole: "dealer" | "pone";
  pairwise: PeggingPairwiseTable;
  cutOptionsByRank: Map<number, CutRankOption>;
  deck: Card[];
  playerScore: number;
  opponentScore: number;
  table: EmpiricalDiscardKeepRuntimeTable;
  memo: EmpiricalDiscardEvaluationMemo;
}): {
  winProbability: number;
  totalEv: number;
  bestLead: number | null;
  components: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
} | null {
  const keepRanks = rankCountsForCards(keep);
  const keepKey = rankCountKey(keepRanks);
  const baseAvailableRanks = remainingRankCounts(fullHand);
  const leadEvaluations = new Map<number, {
    totalWeight: number;
    winProbabilityOutcomes: Map<number, number>;
    ownHandTotal: number;
    opponentHandTotal: number;
    cribTotal: number;
    ownPeggingTotal: number;
    opponentPeggingTotal: number;
  }>();

  for (const cut of cutOptionsByRank.values()) {
    if ((baseAvailableRanks[cut.rank] || 0) <= 0) continue;
    const availableRanks = [...baseAvailableRanks];
    availableRanks[cut.rank] = Math.max(0, availableRanks[cut.rank] - 1);
    const availableCards = deck;
    const ownHand = empiricalOwnHandScoreOutcomesForCutRank(keep, keepKey, cut, memo);
    if (!ownHand.outcomes.length) continue;
    const crib = empiricalCribScoreOutcomesForCutRank({
      discard,
      opponentRole,
      cut,
      availableRanks,
      availableCards,
      table,
      memo,
    });
    if (!crib.outcomes.length) continue;
    const leadCutOutcomes = empiricalKeepLeadOutcomesForCutRank({
      keepRanks,
      keepKey,
      role,
      opponentRole,
      cut,
      availableRanks,
      availableCards,
      ownHandOutcomes: ownHand.outcomes,
      pairwise,
      table,
      memo,
    });
    for (const [leadRank, leadCut] of leadCutOutcomes) {
      if (!leadCut.totalWeight) continue;
      const accumulator = leadEvaluations.get(leadRank) ?? {
        totalWeight: 0,
        winProbabilityOutcomes: new Map<number, number>(),
        ownHandTotal: 0,
        opponentHandTotal: 0,
        cribTotal: 0,
        ownPeggingTotal: 0,
        opponentPeggingTotal: 0,
      };
      accumulator.totalWeight += leadCut.totalWeight * cut.weight;
      accumulator.ownHandTotal += leadCut.ownHandTotal * cut.weight;
      accumulator.opponentHandTotal += leadCut.opponentHandTotal * cut.weight;
      accumulator.cribTotal += crib.average * leadCut.totalWeight * cut.weight;
      accumulator.ownPeggingTotal += leadCut.ownPeggingTotal * cut.weight;
      accumulator.opponentPeggingTotal += leadCut.opponentPeggingTotal * cut.weight;
      for (const [baseKey, baseWeight] of leadCut.baseOutcomes) {
        const [ownBase, opponentBase] = baseKey.split(":").map(Number);
        for (const [cribScore, cribWeight] of crib.outcomes) {
          const ownRoundScore = ownBase + (role === "dealer" ? cribScore : 0);
          const opponentRoundScore = opponentBase + (role === "dealer" ? 0 : cribScore);
          const scenarioWeight = baseWeight * cribWeight * cut.weight;
          const futureScoreKey = roundedScorePairKey(playerScore + ownRoundScore, opponentScore + opponentRoundScore);
          accumulator.winProbabilityOutcomes.set(
            futureScoreKey,
            (accumulator.winProbabilityOutcomes.get(futureScoreKey) ?? 0) + scenarioWeight,
          );
        }
      }
      leadEvaluations.set(leadRank, accumulator);
    }
  }

  let best: {
    leadRank: number;
    winProbability: number;
    totalEv: number;
    components: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>>;
  } | null = null;
  for (const [leadRank, accumulator] of leadEvaluations) {
    if (!accumulator.totalWeight) continue;
    const handScore = accumulator.ownHandTotal / accumulator.totalWeight;
    const cribScore = accumulator.cribTotal / accumulator.totalWeight;
    const netPegging = (accumulator.ownPeggingTotal - accumulator.opponentPeggingTotal) / accumulator.totalWeight;
    const totalEv = (role === "dealer" ? handScore + cribScore : handScore - cribScore) + netPegging;
    let winProbabilityTotal = 0;
    for (const [scoreKey, weight] of accumulator.winProbabilityOutcomes) {
      const [myScore, futureOpponentScore] = roundedScorePairFromKey(scoreKey);
      winProbabilityTotal += weight * approximateFutureWinProbabilityForEngine(
        engine,
        myScore,
        futureOpponentScore,
        nextRole,
        "peggingPone",
      );
    }
    const winProbability = winProbabilityTotal / accumulator.totalWeight;
    const components: Partial<Record<"peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib", number>> = {
      [role === "dealer" ? "handDealer" : "handPone"]: handScore,
      [role === "dealer" ? "peggingDealer" : "peggingPone"]: netPegging,
      crib: role === "dealer" ? cribScore : -cribScore,
    };
    if (
      !best ||
      winProbability > best.winProbability ||
      (winProbability === best.winProbability && totalEv > best.totalEv) ||
      (
        winProbability === best.winProbability &&
        totalEv === best.totalEv &&
        leadTieValue(leadRank) < leadTieValue(best.leadRank)
      )
    ) {
      best = { leadRank, winProbability, totalEv, components };
    }
  }
  return best
    ? {
        winProbability: best.winProbability,
        totalEv: best.totalEv,
        bestLead: best.leadRank >= 0 ? best.leadRank : null,
        components: best.components,
      }
    : null;
}

function analyzeDiscardChoice(
  hand: Card[],
  selected: Card[],
  myCrib: boolean,
  engine: Opponent,
  context?: { game: CribbageGame; player: PlayerState },
): DiscardChoiceAnalysis {
  if (usesSixCardDiscardModel(engine) && context) {
    const sixCardAnalysis = analyzeSixCardDiscardChoice(hand, selected, myCrib, engine, context);
    if (sixCardAnalysis) return sixCardAnalysis;
  }
  if (usesEmpiricalDiscardKeepModel(engine) && context) {
    const empiricalAnalysis = analyzeEmpiricalDiscardChoice(hand, selected, myCrib, engine, context);
    if (empiricalAnalysis) return empiricalAnalysis;
  }
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
    const strategyPolicies = cribPolicies(engine);
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
      const strategyPeggingOptions = usesTripolicyDiscardModel(engine) && !usesNineWayTripolicyDiscardModel(engine)
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
  if (opponent === "schell_table-peg_table-15.2") return "schell_table-peg_table-15.2";
  if (opponent === "schell_table-peg_table-15.1") return "schell_table-peg_table-15.1";
  if (opponent === "schell_table-peg_table-15.0") return "schell_table-peg_table-15.0";
  if (opponent === "schell_table-peg_table-14.8.1") return "schell_table-peg_table-14.8.1";
  if (opponent === "schell_table-peg_table-14.8") return "schell_table-peg_table-14.8";
  if (opponent === "schell_table-peg_table-14.7") return "schell_table-peg_table-14.7";
  if (opponent === "schell_table-peg_table-14.6") return "schell_table-peg_table-14.6";
  if (opponent === "schell_table-peg_table-14.5") return "schell_table-peg_table-14.5";
  if (opponent === "schell_table-peg_table-14.4.1") return "schell_table-peg_table-14.4.1";
  if (opponent === "schell_table-peg_table-14.4") return "schell_table-peg_table-14.4";
  if (opponent === "schell_table-peg_table-14.3") return "schell_table-peg_table-14.3";
  if (opponent === "schell_table-peg_table-14.2") return "schell_table-peg_table-14.2";
  if (opponent === "schell_table-peg_table-14.1") return "schell_table-peg_table-14.1";
  if (opponent === "schell_table-peg_table-14.0") return "schell_table-peg_table-14.0";
  if (opponent === "schell_table-peg_table-13.0") return "schell_table-peg_table-13.0";
  if (opponent === "schell_table-peg_table-12.0") return "schell_table-peg_table-12.0";
  if (opponent === "schell_table-peg_table-11.1") return "schell_table-peg_table-11.1";
  if (opponent === "schell_table-peg_table-11.0") return "schell_table-peg_table-11.0";
  if (opponent === "schell_table-peg_table-10.0") return "schell_table-peg_table-10.0";
  return opponent;
}
