import { describe, expect, it } from "vitest";
import type { AnalyticsEvent, GameState } from "./api-types";
import { opponentGoEvent } from "./pegging-presentation";

function peggingEvent(
  id: string,
  action: "play" | "go" | "reset" | "analysis",
  player: "human" | "ai",
): Extract<AnalyticsEvent, { type: "pegging" }> {
  return {
    id,
    at: "2026-09-02T12:00:00.000Z",
    type: "pegging",
    action,
    gameId: "game-1",
    handNumber: 1,
    player,
    count: 20,
    message: action,
  };
}

function goState(
  analyticsEvents: AnalyticsEvent[],
  overrides: Partial<Pick<GameState, "phase" | "turn" | "legalCardIds" | "peggingResetPending">> = {},
): Pick<GameState, "phase" | "turn" | "legalCardIds" | "peggingResetPending" | "analyticsEvents"> {
  return {
    phase: "pegging",
    turn: "User",
    legalCardIds: [7],
    peggingResetPending: false,
    analyticsEvents,
    ...overrides,
  };
}

describe("opponent Go presentation", () => {
  it("returns the opponent's latest Go when the player can continue", () => {
    const event = peggingEvent("go-1", "go", "ai");
    expect(opponentGoEvent(goState([event]))).toEqual(event);
  });

  it("does not prompt when the player must also say Go", () => {
    const event = peggingEvent("go-1", "go", "ai");
    expect(opponentGoEvent(goState([event], { legalCardIds: [] }))).toBeNull();
  });

  it("does not replay an old Go after another pegging action", () => {
    const events = [
      peggingEvent("go-1", "go", "ai"),
      peggingEvent("play-1", "play", "human"),
      peggingEvent("analysis-1", "analysis", "human"),
    ];
    expect(opponentGoEvent(goState(events))).toBeNull();
  });
});
