import { describe, expect, it } from "vitest";
import type { GameState } from "./api-types";
import { isCoherentSavedGameState } from "./saved-game-state";

function state(overrides: Partial<GameState>): GameState {
  return {
    phase: "discard",
    message: "",
    log: [],
    result: [],
    handNumber: 1,
    scores: { human: 0, ai: 0 },
    pegPositions: { human: [0, 0], ai: [0, 0] },
    dealer: "AI",
    firstDealer: "AI",
    cribOwner: "AI",
    turn: null,
    count: 0,
    turnCard: null,
    turnCardRevealed: false,
    plays: [],
    completedPlays: [],
    peggingResetPending: false,
    humanHand: [],
    aiHandCount: 0,
    humanTable: [],
    aiTable: [],
    legalCardIds: [],
    aiLegalCardIds: [],
    canGo: false,
    scoring: null,
    cutForDeal: null,
    analyticsEvents: [],
    ...overrides,
  };
}

describe("isCoherentSavedGameState", () => {
  it("rejects the dead Easy screen with a discard phase and no cards", () => {
    expect(isCoherentSavedGameState(state({ phase: "discard", humanHand: [], aiHandCount: 0 }))).toBe(false);
  });

  it("accepts a complete discard hand", () => {
    const cards = Array.from({ length: 6 }, (_, id) => ({
      index: id,
      id,
      rank: "A",
      suit: "clubs",
      symbol: "♣",
      value: 1,
      label: "Ac",
    }));
    expect(isCoherentSavedGameState(state({ humanHand: cards, aiHandCount: 6 }))).toBe(true);
  });

  it("requires both revealed deal-cut cards before resuming the cut screen", () => {
    expect(isCoherentSavedGameState(state({ phase: "cut_for_deal", humanHand: [], cutForDeal: null }))).toBe(false);
  });
});
