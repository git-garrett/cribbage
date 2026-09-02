import { describe, expect, it } from "vitest";
import type { AnalyticsEvent } from "./api-types";
import {
  baselineScoreEvents,
  collectNewScoreEvents,
  createScoreNoticeCursor,
} from "./score-notice-cursor";

function score(id: string, gameId: string): Extract<AnalyticsEvent, { type: "score" }> {
  return {
    id,
    at: "2026-01-01T00:00:00Z",
    type: "score",
    gameId,
    handNumber: 1,
    player: "human",
    role: "pone",
    category: "pegging",
    points: 2,
    reason: "Pair",
    totalScore: 2,
    scores: { human: 2, ai: 0 },
    cards: ["5h", "5s"],
  };
}

describe("score notification cursor", () => {
  it("treats the first snapshot as a silent baseline", () => {
    const cursor = createScoreNoticeCursor();
    expect(collectNewScoreEvents(cursor, "game-a", [score("a-1", "game-a")])).toEqual([]);
  });

  it("returns only later score events from the active game", () => {
    const cursor = createScoreNoticeCursor();
    collectNewScoreEvents(cursor, "game-a", [score("a-1", "game-a")]);
    expect(collectNewScoreEvents(cursor, "game-a", [score("a-1", "game-a"), score("a-2", "game-a")]))
      .toEqual([score("a-2", "game-a")]);
  });

  it("silently baselines existing scores when the active game changes", () => {
    const cursor = createScoreNoticeCursor();
    collectNewScoreEvents(cursor, "game-a", [score("a-1", "game-a")]);
    expect(collectNewScoreEvents(cursor, "game-b", [score("b-1", "game-b"), score("b-2", "game-b")]))
      .toEqual([]);
  });

  it("ignores score history belonging to another game", () => {
    const cursor = createScoreNoticeCursor();
    collectNewScoreEvents(cursor, "game-a", []);
    expect(collectNewScoreEvents(cursor, "game-a", [score("old-1", "game-old"), score("a-1", "game-a")]))
      .toEqual([score("a-1", "game-a")]);
  });

  it("silently advances the baseline when the same game is restored with more history", () => {
    const cursor = createScoreNoticeCursor();
    collectNewScoreEvents(cursor, "game-a", [score("a-1", "game-a")]);
    baselineScoreEvents(cursor, "game-a", [score("a-1", "game-a"), score("a-2", "game-a")]);

    expect(collectNewScoreEvents(cursor, "game-a", [score("a-1", "game-a"), score("a-2", "game-a")]))
      .toEqual([]);
    expect(collectNewScoreEvents(cursor, "game-a", [
      score("a-1", "game-a"),
      score("a-2", "game-a"),
      score("a-3", "game-a"),
    ])).toEqual([score("a-3", "game-a")]);
  });
});
