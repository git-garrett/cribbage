import { describe, expect, it } from "vitest";
import type { AnalyticsEvent } from "./api-types";
import { analyticsForStatsOpponent, statsOpponentForModel } from "./stats-opponent";

function game(id: string, opponent: string): AnalyticsEvent {
  return {
    id: `${id}-start`,
    at: "2026-09-02T00:00:00Z",
    type: "game",
    action: "start",
    gameId: id,
    opponent: opponent as Extract<AnalyticsEvent, { type: "game" }>["opponent"],
  };
}

describe("statistics opponent scopes", () => {
  it("maps the playable model families to their statistics tabs", () => {
    expect(statsOpponentForModel("myrmidon-5")).toBe("easy");
    expect(statsOpponentForModel("schell_table-peg_table-9.1")).toBe("tough");
    expect(statsOpponentForModel("schell_table-peg_table-9.11")).toBe("tough");
    expect(statsOpponentForModel("schell_table-peg_table-13.0")).toBe("master");
    expect(statsOpponentForModel("schell_table-peg_table-13.215")).toBe("master");
    expect(statsOpponentForModel("schell_table-peg_table-16.3")).toBe("master");
    expect(statsOpponentForModel("human:table-1")).toBe("human");
  });

  it("keeps all events for games played against the selected opponent", () => {
    const events = [
      game("easy-game", "myrmidon-5"),
      game("tough-game", "schell_table-peg_table-9.11"),
      {
        id: "easy-hand",
        at: "2026-09-02T00:01:00Z",
        type: "hand",
        action: "start",
        gameId: "easy-game",
        handNumber: 1,
        dealer: "human",
        pone: "ai",
        scores: { human: 0, ai: 0 },
      },
    ] satisfies AnalyticsEvent[];

    expect(analyticsForStatsOpponent(events, "easy").map((event) => event.id)).toEqual([
      "easy-game-start",
      "easy-hand",
    ]);
    expect(analyticsForStatsOpponent(events, "tough").map((event) => event.id)).toEqual([
      "tough-game-start",
    ]);
  });
});
