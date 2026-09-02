import { describe, expect, it } from "vitest";
import type { AnalyticsEvent, AnalyticsDecisionReview } from "./api-types";
import { gameAnalysisProgress, helpCountForGame, pendingAnalysisGameIds } from "./game-analysis";

const review: AnalyticsDecisionReview = {
  model: "schell_table-peg_table-13.0",
  selected: ["5C"],
  recommended: ["5C"],
  selectedEv: 1,
  recommendedEv: 1,
  delta: 0,
};

function discard(id: string, gameId: string, reviewed = false): AnalyticsEvent {
  return {
    id,
    at: "2026-09-02T00:00:00Z",
    type: "discard",
    gameId,
    handNumber: 1,
    player: "human",
    role: "pone",
    cards: ["5C", "6D"],
    cribOwner: "ai",
    cribAfterDiscard: ["5C", "6D"],
    remainingHand: ["7H", "8S", "9C", "10D"],
    ...(reviewed ? { review } : {}),
  };
}

describe("stored game analysis", () => {
  it("distinguishes complete analysis from a partially reviewed game", () => {
    const events = [discard("one", "game-1", true), discard("two", "game-1")];
    expect(gameAnalysisProgress(events, "game-1")).toEqual({
      total: 2,
      reviewed: 1,
      pending: 1,
      complete: false,
    });

    expect(gameAnalysisProgress([discard("one", "game-1", true)], "game-1").complete).toBe(true);
  });

  it("counts Ace helps and returns only games needing backfill", () => {
    const events = [
      discard("one", "game-1", true),
      discard("two", "game-2"),
      {
        id: "help-1",
        at: "2026-09-02T00:01:00Z",
        type: "help",
        action: "request",
        gameId: "game-2",
        handNumber: 1,
        advisor: "Ace",
      },
    ] satisfies AnalyticsEvent[];

    expect(helpCountForGame(events, "game-2")).toBe(1);
    expect(pendingAnalysisGameIds(events, ["game-1", "game-2"])).toEqual(["game-2"]);
  });
});
