import type { SerializedCard } from "./api-types";

export type BeginnerDrillId = "find-scoring-play" | "discard";

export interface BeginnerDrill {
  id: BeginnerDrillId;
  hand: readonly SerializedCard[];
  played: readonly SerializedCard[];
  cribOwner: "User" | null;
  requiredSelections: 1 | 2;
}

function card(id: number, rank: string, suit: string, symbol: string, value: number): SerializedCard {
  return {
    id,
    index: null,
    rank,
    suit,
    symbol,
    value,
    label: `${rank}${symbol}`,
    owner: "User",
  };
}

export const BEGINNER_DRILLS: Record<BeginnerDrillId, BeginnerDrill> = {
  "find-scoring-play": {
    id: "find-scoring-play",
    hand: [
      card(1001, "2", "hearts", "♥", 2),
      card(1002, "5", "diamonds", "♦", 5),
      card(1003, "9", "spades", "♠", 9),
      card(1004, "K", "clubs", "♣", 10),
    ],
    played: [card(1000, "6", "clubs", "♣", 6)],
    cribOwner: null,
    requiredSelections: 1,
  },
  discard: {
    id: "discard",
    hand: [
      card(1101, "4", "clubs", "♣", 4),
      card(1102, "4", "diamonds", "♦", 4),
      card(1103, "5", "hearts", "♥", 5),
      card(1104, "6", "spades", "♠", 6),
      card(1105, "Q", "clubs", "♣", 10),
      card(1106, "K", "diamonds", "♦", 10),
    ],
    played: [],
    cribOwner: "User",
    requiredSelections: 2,
  },
};
