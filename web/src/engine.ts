import pegTablePolicy from "./peg-table-policy.json";

export type PlayerKey = "human" | "ai";
export type Opponent =
  | "expert-1.1"
  | "expert-peg-1.2"
  | "expert-peg_table-1.3"
  | "expert-2.0-ras-tables"
  | "expert-peg-2.1"
  | "expert-peg_table-2.2"
  | "expert-peg-2.2"
  | "expert-peg_table-2.3"
  | "ras-table-1.0"
  | "ras-table-peg-1.1"
  | "ras-table-peg_table-1.2"
  | "schell-table-peg-1.1"
  | "schell-table-peg_table-1.2"
  | "schell-table-1.0";
type StoredOpponent = Opponent | "expert";
export const DEFAULT_OPPONENT: Opponent = "expert-peg_table-2.3";
export type Phase =
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
  "expert-1.1": "Expert 1.1",
  "expert-peg-1.2": "Expert Peg 1.2",
  "expert-peg_table-1.3": "Expert Peg Table 1.3",
  "expert-2.0-ras-tables": "Expert 2.0 Ras Tables",
  "expert-peg-2.1": "Expert Peg 2.1",
  "expert-peg_table-2.2": "Expert Peg Table 2.2",
  "expert-peg-2.2": "Expert Peg 2.2",
  "expert-peg_table-2.3": "Expert Peg Table 2.3",
  "ras-table-1.0": "Ras Table 1.0",
  "ras-table-peg-1.1": "Ras Table Peg 1.1",
  "ras-table-peg_table-1.2": "Ras Table Peg Table 1.2",
  "schell-table-1.0": "Schell Table 1.0",
  "schell-table-peg-1.1": "Schell Table Peg 1.1",
  "schell-table-peg_table-1.2": "Schell Table Peg Table 1.2",
};
type DiscardTableEngine = Exclude<Opponent, "expert-1.1" | "expert-peg-1.2">;
type CribTable = { own: number[][]; opponent: number[][] };
const DISCARD_TABLES: Record<string, CribTable> = {
  "ras-table-1.0": {
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
  "schell-table-1.0": {
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
DISCARD_TABLES["expert-2.0-ras-tables"] = DISCARD_TABLES["ras-table-1.0"];
DISCARD_TABLES["expert-peg-2.1"] = DISCARD_TABLES["ras-table-1.0"];
DISCARD_TABLES["expert-peg_table-2.2"] = DISCARD_TABLES["ras-table-1.0"];
DISCARD_TABLES["expert-peg-2.2"] = DISCARD_TABLES["schell-table-1.0"];
DISCARD_TABLES["expert-peg_table-2.3"] = DISCARD_TABLES["schell-table-1.0"];
DISCARD_TABLES["ras-table-peg-1.1"] = DISCARD_TABLES["ras-table-1.0"];
DISCARD_TABLES["ras-table-peg_table-1.2"] = DISCARD_TABLES["ras-table-1.0"];
DISCARD_TABLES["schell-table-peg-1.1"] = DISCARD_TABLES["schell-table-1.0"];
DISCARD_TABLES["schell-table-peg_table-1.2"] = DISCARD_TABLES["schell-table-1.0"];

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
    nextLabel: string;
  } | null;
  analyticsEvents: AnalyticsEvent[];
}

type ScoringReview = NonNullable<GameState["scoring"]> & { rawCards: Card[] };

export type AnalyticsRole = "dealer" | "pone";
export type AnalyticsScoreCategory = "pegging" | "hand" | "crib";
export type AnalyticsGameResult = "regular" | "skunk" | "double-skunk";
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
    }
  | {
      id: string;
      at: string;
      type: "pegging";
      action: "play" | "go" | "reset";
      gameId: string;
      handNumber: number;
      player?: PlayerKey;
      role?: AnalyticsRole;
      card?: string;
      count: number;
      points?: number;
      scores?: Record<PlayerKey, number>;
      message: string;
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
  plays: number[];
  playOwners: PlayerKey[];
  completedPlays: number[][];
  completedPlayOwners: PlayerKey[][];
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
    nextLabel: string;
  } | null;
  phase: Phase;
  message: string;
  log: string[];
  result: string[];
  pegPositions: Record<PlayerKey, [number | string, number | string]>;
  pegTableLeads?: Record<PlayerKey, number | null>;
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
  if (plays.length < 2) return 0;
  let score = 0;
  const count = plays.reduce((total, card) => total + card.value, 0);
  if (count === 15 || count === 31) score += 2;

  let sameRankCount = 1;
  for (let i = plays.length - 2; i >= 0; i -= 1) {
    if (plays[i].rank !== plays[plays.length - 1].rank) break;
    sameRankCount += 1;
  }
  score += new Map([
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
      score += runLen;
      break;
    }
  }
  return score;
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

  constructor(opponent: StoredOpponent = DEFAULT_OPPONENT, humanEngine: StoredOpponent = opponent) {
    this.opponent = normalizeOpponent(opponent);
    this.playerEngines = {
      human: normalizeOpponent(humanEngine),
      ai: this.opponent,
    };
    this.human = { key: "human", name: "User", hand: [], table: [], crib: [], score: 0 };
    this.ai = { key: "ai", name: "AI", hand: [], table: [], crib: [], score: 0 };
    this.deal = Math.random() < 0.5 ? 0 : 1;
    this.firstDeal = this.deal;
    this.recordAnalytics({
      type: "game",
      action: "start",
      opponent: this.opponent,
    });
    this.startHand();
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
      plays: this.plays.map((card) => card.id),
      playOwners: [...this.playOwners],
      completedPlays: this.completedPlays.map((group) => group.map((card) => card.id)),
      completedPlayOwners: this.completedPlayOwners.map((group) => [...group]),
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
    if (this.dealer === this.ai) this.aiDiscard();
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
      dealer: this.name(this.dealer),
      firstDealer: this.name([this.human, this.ai][this.firstDeal]),
      cribOwner: this.name(this.dealer),
      turn: current ? this.name(current) : null,
      count: this.count,
      turnCard: this.phase === "discard" || this.phase === "ai_discarding"
        ? null
        : this.serializeCard(this.turnCard),
      plays: this.plays.map((card, index) => this.serializeCard(card, null, this.playOwners[index])),
      completedPlays: this.completedPlays.map((group, groupIndex) =>
        group.map((card, cardIndex) =>
          this.serializeCard(card, null, this.completedPlayOwners[groupIndex]?.[cardIndex]),
        ),
      ),
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
            nextLabel: this.scoringReview.nextLabel,
          }
        : null,
      analyticsEvents: [...this.analyticsEvents],
    };
  }

  discard(ids: number[]): void {
    this.beginInteraction();
    if (this.phase !== "discard") throw new Error("It is not discard time.");
    const discards = this.selectedCards(sortedCards(this.human.hand), ids, 2);
    removeCards(this.human.hand, discards);
    this.crib.push(...discards);
    this.recordDiscard(this.human, discards);
    this.logEvent("User discarded two cards to the crib.");
    if (this.dealer === this.human) {
      this.phase = "ai_discarding";
      this.logEvent("Waiting for AI to discard.");
      return;
    }
    this.beginPegging();
  }

  finishDiscard(): void {
    this.beginInteraction();
    if (this.phase !== "ai_discarding") throw new Error("AI is not waiting to discard.");
    this.aiDiscard();
    this.beginPegging();
  }

  play(cardId: number): void {
    this.beginInteraction();
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
    this.playCard(this.human, card);
    this.advanceUntilHuman();
  }

  go(): void {
    this.beginInteraction();
    if (this.phase !== "pegging" || this.currentPlayer() !== this.human) {
      throw new Error("It is not your turn.");
    }
    if (this.legalCards(this.human).length > 0) throw new Error("User has a legal card to play.");
    this.sayGo(this.human);
    this.advanceUntilHuman();
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
    if (this.phase === "pegging_complete") this.startScoring();
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
    const discards = this.chooseDiscards(this.ai, this.dealer === this.ai);
    removeCards(this.ai.hand, discards);
    this.crib.push(...discards);
    this.recordDiscard(this.ai, discards);
    this.logEvent("AI discarded two cards to the crib.");
  }

  private autoDiscardHuman(): void {
    this.beginInteraction();
    if (this.phase !== "discard") throw new Error("It is not discard time.");
    const discards = this.chooseDiscards(this.human, this.dealer === this.human);
    removeCards(this.human.hand, discards);
    this.crib.push(...discards);
    this.recordDiscard(this.human, discards);
    this.logEvent("User discarded two cards to the crib.");
    if (this.dealer === this.human) {
      this.phase = "ai_discarding";
      this.logEvent("Waiting for AI to discard.");
      return;
    }
    this.beginPegging();
  }

  private chooseDiscards(player: PlayerState, myCrib: boolean): Card[] {
    const deck = fullDeck().filter((card) => !player.hand.some((held) => held.id === card.id));
    const engine = this.playerEngines[player.key];
    this.pegTableLeads[player.key] = null;
    const role = myCrib ? "dealer" : "pone";

    let bestScore = Number.NEGATIVE_INFINITY;
    let bestDiscard = player.hand.slice(0, 2);
    let bestLead: number | null = null;

    for (const discard of combinations(player.hand, 2, 2)) {
      const keep = player.hand.filter((card) => !discard.includes(card));
      const handScore = mean(deck.map((cut) => scoreHand(keep, cut)));
      const cribScore = expectedCribScore(
        discard,
        deck,
        myCrib,
        usesPegTableDiscard(engine) ? "schell-table-1.0" : engine,
      );
      const pegging = pegTableEv(player.hand, discard, role, engine);
      const total = (myCrib ? handScore + cribScore : handScore - cribScore) + pegging.netPeggingEv;
      if (total > bestScore) {
        bestScore = total;
        bestDiscard = discard;
        bestLead = pegging.bestLead;
      }
    }
    this.pegTableLeads[player.key] = bestLead;
    return bestDiscard;
  }

  private beginPegging(): void {
    this.phase = "pegging";
    this.dealer.crib = [...this.crib];
    this.logEvent(`Turn card is ${this.cardLabel(this.turnCard)}.`);
    if (this.turnCard.rankStr === "J") {
      this.recordScore(this.dealer, "pegging", 2, "his heels", this.turnCard);
      this.peg(this.dealer, 2);
      this.logEvent(`${this.name(this.dealer)} pegged 2 for his heels.`);
    }
    this.advanceUntilHuman();
  }

  private advanceUntilHuman(): void {
    while (this.phase === "pegging") {
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
      this.recordScore(this.lastPlayer, "pegging", 1, "last card", undefined, this.count);
      this.peg(this.lastPlayer, 1);
      this.logEvent(`${this.name(this.lastPlayer)} pegged 1 for last card.`);
      this.archivePlays();
      this.plays = [];
      this.playOwners = [];
      this.count = 0;
      this.goPlayer = null;
      this.lastPlayer = null;
    }
  }

  private choosePlay(player: PlayerState): Card {
    const legal = this.legalCards(player);
    const pegTableLead = choosePegTableLead(player.hand, legal, this.pegTableLeads[player.key], {
      engine: this.playerEngines[player.key],
      isPone: player === this.pone,
      count: this.count,
      plays: this.plays,
    });
    if (pegTableLead) return pegTableLead;
    if (usesExhaustivePegging(this.playerEngines[player.key])) {
      return this.chooseExhaustivePegPlay(player, legal);
    }
    return legal.reduce((best, card) => {
      const bestKey = [scoreCount([...this.plays, best]), best.runVal];
      const cardKey = [scoreCount([...this.plays, card]), card.runVal];
      return compareTuple(cardKey, bestKey) > 0 ? card : best;
    });
  }

  private chooseExhaustivePegPlay(player: PlayerState, legal: Card[]): Card {
    const opponent = player === this.human ? this.ai : this.human;
    const knownCards = [
      ...player.hand,
      ...player.table,
      ...opponent.table,
      ...this.crib,
      this.turnCard,
    ];
    const rankCounts = remainingRankCounts(knownCards);
    const opponentHands = enumerateRankHands(rankCounts, opponent.hand.length);
    let bestCard = legal[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const card of legal) {
      const ownRanks = ranksAfterPlaying(player.hand, card);
      let weightedTotal = 0;
      let totalWeight = 0;
      const immediateScore = scoreCount([...this.plays, card]);
      const countAfterPlay = this.count + card.value;
      for (const possibleOpponentHand of opponentHands) {
        const result = simulatePegging({
          hands: player === this.human
            ? { human: ownRanks, ai: possibleOpponentHand.ranks }
            : { human: possibleOpponentHand.ranks, ai: ownRanks },
          plays: countAfterPlay === 31 ? [] : [...this.plays, card].map((playedCard) => playedCard.rank),
          count: countAfterPlay === 31 ? 0 : countAfterPlay,
          current: otherPlayerKey(player.key),
          goPlayer: null,
          lastPlayer: countAfterPlay === 31 ? null : player.key,
          perspective: player.key,
        });
        weightedTotal += ((immediateScore * result.weight) + result.total) * possibleOpponentHand.weight;
        totalWeight += result.weight * possibleOpponentHand.weight;
      }

      const averageScore = totalWeight ? weightedTotal / totalWeight : immediateScore;
      const key = [averageScore, scoreCount([...this.plays, card]), card.runVal];
      const bestKey = [
        bestScore,
        scoreCount([...this.plays, bestCard]),
        bestCard.runVal,
      ];
      if (compareTuple(key, bestKey) > 0) {
        bestScore = averageScore;
        bestCard = card;
      }
    }
    return bestCard;
  }

  private playCard(player: PlayerState, card: Card): void {
    player.table.push(card);
    removeCards(player.hand, [card]);
    this.plays.push(card);
    this.playOwners.push(player.key);
    this.count += card.value;
    this.lastPlayer = player;
    const points = scoreCount(this.plays);
    const scoreAfterPlay = points
      ? {
          human: this.human.score + (player === this.human ? points : 0),
          ai: this.ai.score + (player === this.ai ? points : 0),
        }
      : { human: this.human.score, ai: this.ai.score };
    this.recordAnalytics({
      type: "pegging",
      action: "play",
      handNumber: this.handNumber,
      player: player.key,
      role: this.roleFor(player),
      card: this.cardLabel(card),
      count: this.count,
      points,
      scores: scoreAfterPlay,
      message: `${this.name(player)} played ${this.cardLabel(card)}: ${this.count}`,
    });
    if (points) this.recordScore(player, "pegging", points, "count", card, this.count);
    if (points) this.peg(player, points);
    this.logEvent(
      `${this.name(player)} played ${this.cardLabel(card)}: ${this.count}` +
        (points ? ` and pegged ${points}.` : "."),
    );
    if (this.count === 31) {
      this.archivePlays();
      this.plays = [];
      this.playOwners = [];
      this.count = 0;
      this.goPlayer = null;
      this.lastPlayer = null;
      this.recordAnalytics({
        type: "pegging",
        action: "reset",
        handNumber: this.handNumber,
        count: 0,
        scores: { human: this.human.score, ai: this.ai.score },
        message: "Count hit 31 and resets.",
      });
      this.logEvent("Count hit 31 and resets.");
      this.otherTurn();
    } else if (!this.goPlayer) {
      this.otherTurn();
    }
  }

  private sayGo(player: PlayerState): void {
    if (this.goPlayer) {
      if (this.lastPlayer && this.count !== 31) {
        this.recordScore(this.lastPlayer, "pegging", 1, "go", undefined, this.count);
        this.peg(this.lastPlayer, 1);
        this.logEvent(`${this.name(this.lastPlayer)} pegged 1 for go.`);
      }
      this.archivePlays();
      this.plays = [];
      this.playOwners = [];
      this.count = 0;
      this.goPlayer = null;
      this.lastPlayer = null;
      this.recordAnalytics({
        type: "pegging",
        action: "reset",
        handNumber: this.handNumber,
        count: 0,
        scores: { human: this.human.score, ai: this.ai.score },
        message: "Count resets to 0.",
      });
      this.logEvent("Count resets to 0.");
      this.otherTurn();
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

    if (stage === "pone") {
      player = this.pone;
      cards = this.pone.table;
      points = scoreHand(cards, this.turnCard);
      title = `${this.name(player)} hand`;
      nextLabel = "Show dealer hand";
      this.phase = "score_pone";
    } else if (stage === "dealer") {
      player = this.dealer;
      cards = this.dealer.table;
      points = scoreHand(cards, this.turnCard);
      title = `${this.name(player)} hand`;
      nextLabel = "Show crib";
      this.phase = "score_dealer";
    } else {
      player = this.dealer;
      cards = this.dealer.crib;
      points = scoreHand(cards, this.turnCard, true);
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
      nextLabel,
    };
    this.recordScore(player, stage === "crib" ? "crib" : "hand", points, title);
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
    });
  }

  private gameResultFor(winner: PlayerState): AnalyticsGameResult {
    const loser = winner === this.human ? this.ai : this.human;
    if (loser.score <= 60) return "double-skunk";
    if (loser.score <= 90) return "skunk";
    return "regular";
  }

  private recordDiscard(player: PlayerState, cards: Card[]): void {
    this.recordAnalytics({
      type: "discard",
      handNumber: this.handNumber,
      player: player.key,
      role: this.roleFor(player),
      cards: this.cardLabels(cards),
      cribOwner: this.dealer.key,
      cribAfterDiscard: this.cardLabels(this.crib),
      remainingHand: this.cardLabels(player.hand),
    });
  }

  private recordAnalytics(
    event: NewAnalyticsEvent,
  ): void {
    this.analyticsCounter += 1;
    this.analyticsEvents.push({
      ...event,
      id: `${this.gameId}-${this.analyticsCounter}`,
      at: new Date().toISOString(),
      gameId: this.gameId,
    } as AnalyticsEvent);
    this.analyticsEvents = this.analyticsEvents.slice(-2000);
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
type PegSimulationState = {
  hands: Record<PlayerKey, RankCounts>;
  plays: number[];
  count: number;
  current: PlayerKey;
  goPlayer: PlayerKey | null;
  lastPlayer: PlayerKey | null;
  perspective: PlayerKey;
};
type WeightedScore = { total: number; weight: number };
type PegTableEvTuple = [number, number, number | null];
type PegTableEv = {
  myPeggingEv: number;
  opponentPeggingEv: number;
  netPeggingEv: number;
  bestLead: number | null;
};

const pegCardCache = Array.from({ length: 13 }, (_, rank) => new Card(rank));

function usesExhaustivePegging(engine: Opponent): boolean {
  return engine.includes("-peg-") || engine.includes("-peg_table-");
}

function usesPegTableDiscard(engine: Opponent): boolean {
  return engine.includes("-peg_table-");
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
  const entry = ((pegTablePolicy.pegEvs as unknown) as Record<string, PegTableEvTuple | undefined>)[
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

function expectedCribScore(
  discard: Card[],
  deck: Card[],
  myCrib: boolean,
  engine: Opponent,
): number {
  const table = DISCARD_TABLES[engine as DiscardTableEngine];
  if (table) {
    const ranks = discard.map((card) => card.rank).sort((a, b) => a - b);
    return (myCrib ? table.own : table.opponent)[ranks[0]][ranks[1]];
  }
  let cribTotal = 0;
  let cribCount = 0;
  for (const pot of combinations(deck, 3, 3)) {
    cribTotal += scoreHand([...discard, pot[0], pot[1]], pot[2], true);
    cribCount += 1;
  }
  return cribTotal / cribCount;
}

function createAnalyticsId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeOpponent(opponent: StoredOpponent): Opponent {
  if (opponent === "expert") return DEFAULT_OPPONENT;
  return opponent;
}
