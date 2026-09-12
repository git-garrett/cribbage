import type { SerializedCard } from "./api-types";
import trainingCatalog from "../../resources/training/easy-drills.json";

export type BeginnerDrillId = "find-scoring-play" | "discard";

interface GeneratedDiscardDrill {
  id: string;
  hand: string[];
  cribOwner: "player" | "opponent";
  answer: string[];
}

interface GeneratedScoringPlayDrill {
  id: string;
  hand: string[];
  playedCards: string[];
  cutCard: string;
  countBefore: number;
  answer: string;
  points: number;
  scoreComponents: { fifteen: number; thirtyOne: number; pairs: number; run: number };
}

interface GeneratedTrainingCatalog {
  discardDrills: GeneratedDiscardDrill[];
  scoringPlayDrills: GeneratedScoringPlayDrill[];
}

export interface BeginnerDrill {
  id: string;
  kind: BeginnerDrillId;
  hand: readonly SerializedCard[];
  played: readonly SerializedCard[];
  cutCard: SerializedCard | null;
  countBefore: number;
  cribOwner: "User" | "Opponent" | null;
  answer: readonly string[];
  requiredSelections: 1 | 2;
  opportunity: string | null;
}

export interface DrillProgress { solved: string[]; }

type ProgressStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_PREFIX = "strong-cribbage.drills.completed.v1";
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = {
  c: { suit: "clubs", symbol: "♣" },
  d: { suit: "diamonds", symbol: "♦" },
  h: { suit: "hearts", symbol: "♥" },
  s: { suit: "spades", symbol: "♠" },
} as const;

function serializedCard(label: string, id: number): SerializedCard {
  const match = /^(A|[2-9]|10|J|Q|K)([cdhs])$/.exec(label);
  if (!match) throw new Error(`Invalid training card: ${label}`);
  const [, rank, suitCode] = match;
  const suit = SUITS[suitCode as keyof typeof SUITS];
  return {
    id,
    index: null,
    rank,
    suit: suit.suit,
    symbol: suit.symbol,
    value: Math.min(RANKS.indexOf(rank) + 1, 10),
    label: `${rank}${suit.symbol}`,
    owner: "User",
  };
}

function opportunityFor(drill: GeneratedScoringPlayDrill): string {
  const components = drill.scoreComponents;
  if (components.run > 0) return `a run of ${components.run}`;
  if (components.pairs === 2) return "a pair";
  if (components.pairs === 6) return "three of a kind";
  if (components.pairs === 12) return "four of a kind";
  if (components.fifteen > 0) return "a fifteen";
  if (components.thirtyOne > 0) return "a 31";
  return "a scoring";
}

function scoringPlayDrill(drill: GeneratedScoringPlayDrill, index: number): BeginnerDrill {
  const base = 1_000_000 + (index * 16);
  return {
    id: drill.id,
    kind: "find-scoring-play",
    hand: drill.hand.map((label, cardIndex) => serializedCard(label, base + cardIndex)),
    played: drill.playedCards.map((label, cardIndex) => serializedCard(label, base + 8 + cardIndex)),
    cutCard: serializedCard(drill.cutCard, base + 15),
    countBefore: drill.countBefore,
    cribOwner: null,
    answer: [drill.answer],
    requiredSelections: 1,
    opportunity: opportunityFor(drill),
  };
}

function discardDrill(drill: GeneratedDiscardDrill, index: number): BeginnerDrill {
  const base = 2_000_000 + (index * 8);
  return {
    id: drill.id,
    kind: "discard",
    hand: drill.hand.map((label, cardIndex) => serializedCard(label, base + cardIndex)),
    played: [],
    cutCard: null,
    countBefore: 0,
    cribOwner: drill.cribOwner === "player" ? "User" : "Opponent",
    answer: drill.answer,
    requiredSelections: 2,
    opportunity: null,
  };
}

const generated = trainingCatalog as GeneratedTrainingCatalog;

export const BEGINNER_DRILLS: Record<BeginnerDrillId, readonly BeginnerDrill[]> = {
  "find-scoring-play": generated.scoringPlayDrills.map(scoringPlayDrill),
  discard: generated.discardDrills.map(discardDrill),
};

function readProgress(storage: ProgressStorage | null, kind: BeginnerDrillId): DrillProgress {
  if (!storage) return { solved: [] };
  try {
    const parsed = JSON.parse(storage.getItem(`${STORAGE_PREFIX}.${kind}`) || "null") as Partial<DrillProgress> | null;
    return parsed && Array.isArray(parsed.solved)
      ? { solved: parsed.solved.filter((id): id is string => typeof id === "string") }
      : { solved: [] };
  } catch {
    return { solved: [] };
  }
}

/** Shared no-repeat cycle for every hardcoded drill collection. */
export class DrillProgression {
  constructor(
    private readonly storage: ProgressStorage | null,
    private readonly random: () => number = Math.random,
  ) {}

  progress(kind: BeginnerDrillId): DrillProgress {
    const validIds = new Set(BEGINNER_DRILLS[kind].map((drill) => drill.id));
    const progress = readProgress(this.storage, kind);
    return { solved: [...new Set(progress.solved.filter((id) => validIds.has(id)))] };
  }

  next(kind: BeginnerDrillId, excludeId: string | null = null): BeginnerDrill {
    const drills = BEGINNER_DRILLS[kind];
    if (drills.length === 0) throw new Error(`No ${kind} drills are available`);
    const solved = new Set(this.progress(kind).solved);
    let available = drills.filter((drill) => !solved.has(drill.id));
    if (available.length === 0) {
      solved.clear();
      this.write(kind, solved);
      available = [...drills];
    }
    const withoutPrevious = available.filter((drill) => drill.id !== excludeId);
    if (withoutPrevious.length > 0) available = withoutPrevious;
    const index = Math.min(available.length - 1, Math.floor(this.random() * available.length));
    return available[Math.max(0, index)];
  }

  markSolved(kind: BeginnerDrillId, id: string): { cycleCompleted: boolean } {
    const drills = BEGINNER_DRILLS[kind];
    const solved = new Set(this.progress(kind).solved);
    solved.add(id);
    const cycleCompleted = drills.length > 0 && solved.size >= drills.length;
    this.write(kind, cycleCompleted ? new Set() : solved);
    return { cycleCompleted };
  }

  private write(kind: BeginnerDrillId, solved: Set<string>): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(`${STORAGE_PREFIX}.${kind}`, JSON.stringify({ solved: [...solved].sort() }));
    } catch {
      // Progress persistence is optional when storage is unavailable.
    }
  }
}
