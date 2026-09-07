import { describe, expect, it } from "vitest";

import type { AnalyticsEvent } from "./api-types";
import { completedGameIds, mergeStoredAnalyticsEvents } from "./completed-game-history";

const start: AnalyticsEvent = {
  id: "game-1-start",
  at: "2026-09-01T00:00:00.000Z",
  type: "game",
  action: "start",
  gameId: "game-1",
  opponent: "schell_table-peg_table-13.0",
};

const end: AnalyticsEvent = {
  id: "game-1-end",
  at: "2026-09-01T00:30:00.000Z",
  type: "game",
  action: "end",
  gameId: "game-1",
  opponent: "schell_table-peg_table-13.0",
  winner: "human",
  loser: "ai",
  result: "regular",
  finalScores: { human: 121, ai: 110 },
};

describe("completed game history recovery", () => {
  it("finds completed games that exist only in IndexedDB", () => {
    const events = mergeStoredAnalyticsEvents([start], [start, end]);

    expect(events).toEqual([start, end]);
    expect(completedGameIds(events)).toEqual(["game-1"]);
  });

  it("uses the IndexedDB copy when the same event exists in both stores", () => {
    const stale = { ...end, finalScores: { human: 0, ai: 0 } };

    expect(mergeStoredAnalyticsEvents([stale], [end])).toEqual([end]);
  });
});
