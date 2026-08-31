/**
 * Wire types for the Rust API. These deliberately contain no game rules or
 * model imports: browser clients receive state from the Rust service.
 */
export type PlayerKey = "human" | "ai";
export type Opponent =
  | "myrmidon-5"
  | "schell_table-peg_table-9.1"
  | "schell_table-peg_table-13.0"
  | "schell_table-peg_table-14.3"
  | "schell_table-peg_table-14.8"
  | "schell_table-peg_table-14.8.1"
  | "schell_table-peg_table-15.0"
  | "schell_table-peg_table-15.1"
  | "schell_table-peg_table-15.2"
  | "schell_table-peg_table-16.0"
  | "schell_table-peg_table-16.1"
  | "schell_table-peg_table-16.3";
export type StoredOpponent = Opponent;
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
export type ScorePhase = "peggingPone" | "peggingDealer" | "handPone" | "handDealer" | "crib";

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

export type AnalyticsRole = "dealer" | "pone";
export type AnalyticsScoreCategory = "pegging" | "hand" | "crib";
export type AnalyticsGameResult = "regular" | "skunk" | "double-skunk";
export type AnalyticsEvComponents = Record<string, number>;
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
    selected: Partial<Record<ScorePhase, number>>;
    recommended: Partial<Record<ScorePhase, number>>;
    delta: Partial<Record<ScorePhase, number>>;
  };
}

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
  turnCardRevealed: boolean;
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
  turnCard: number | null;
  turnCardRevealed: boolean;
  crib: number[];
  cutDeck?: number[];
  cutCards?: { human?: number | null; ai?: number | null };
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
  pendingDiscardReviews?: unknown[];
  pendingPeggingReviews?: unknown[];
}
