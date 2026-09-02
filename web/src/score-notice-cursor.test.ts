import { describe, expect, it } from "vitest";
import type { AnalyticsEvent } from "./api-types";
import {
  baselineScoreEvents,
  collectNewScoreEvents,
  createScoreNoticeCursor,
  currentScoringScoreEvent,
  scoreboardStateForScoringConfirmation,
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

  it("recovers the current crib score after restore without treating it as a new notice", () => {
    const cursor = createScoreNoticeCursor();
    const cribScore = score("crib-1", "game-a");
    cribScore.category = "crib";
    cribScore.points = 4;
    cribScore.player = "human";

    expect(collectNewScoreEvents(cursor, "game-a", [cribScore])).toEqual([]);
    expect(currentScoringScoreEvent("game-a", {
      handNumber: 1,
      scoring: { stage: "crib", owner: "User", points: 4 },
      analyticsEvents: [cribScore],
    })).toEqual(cribScore);
  });

  it("does not recover a stale score from another scoring stage, player, hand, or game", () => {
    const events = [
      score("other-game", "game-b"),
      score("prior-hand", "game-a"),
      score("opponent-crib", "game-a"),
      score("dealer-hand", "game-a"),
    ];
    events[1].handNumber = 0;
    events[1].category = "crib";
    events[2].category = "crib";
    events[2].player = "ai";
    events[3].category = "hand";

    expect(currentScoringScoreEvent("game-a", {
      handNumber: 1,
      scoring: { stage: "crib", owner: "User", points: 2 },
      analyticsEvents: events,
    })).toBeNull();
  });

  it("matches a game-winning hand event even when only the points needed to win were pegged", () => {
    const winningScore = score("winning-hand", "game-a");
    winningScore.category = "hand";
    winningScore.points = 2;
    winningScore.totalScore = 121;
    winningScore.scores.human = 121;

    expect(currentScoringScoreEvent("game-a", {
      handNumber: 1,
      scoring: { stage: "pone", owner: "User", points: 8 },
      analyticsEvents: [winningScore],
    })).toEqual(winningScore);
  });

  it("holds the current hand score and pegs until its summary is confirmed", () => {
    const handScore = score("hand-1", "game-a");
    handScore.category = "hand";
    handScore.points = 8;
    const game: Pick<import("./api-types").GameState, "scores" | "pegPositions"> = {
      scores: { human: 38, ai: 31 },
      pegPositions: { human: [38, 38], ai: [31, 31] },
    };

    expect(scoreboardStateForScoringConfirmation(game, handScore, null)).toEqual({
      scores: { human: 30, ai: 31 },
      pegPositions: { human: [30, 30], ai: [31, 31] },
    });
    expect(scoreboardStateForScoringConfirmation(game, handScore, "hand-1")).toEqual(game);
  });
});
