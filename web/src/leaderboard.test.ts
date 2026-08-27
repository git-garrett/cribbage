import { describe, expect, it } from "vitest";

import { rankLeaderboardWins } from "./leaderboard";

describe("rankLeaderboardWins", () => {
  it("keeps a newly received two-point win below 48- and 45-point wins", () => {
    const wins = [
      { player: "Garrett", margin: 2, endedAt: "2026-08-26T03:00:00Z" },
      { player: "Shane", margin: 48, endedAt: "2026-08-01T03:00:00Z" },
      { player: "Garrett", margin: 45, endedAt: "2026-08-02T03:00:00Z" },
    ];

    expect(rankLeaderboardWins(wins).map((win) => win.margin)).toEqual([48, 45, 2]);
    expect(wins.map((win) => win.margin)).toEqual([2, 48, 45]);
  });

  it("uses the server tie breakers without changing the input", () => {
    const wins = [
      { player: "Zoe", margin: 45, endedAt: "2026-08-02T03:00:00Z" },
      { player: "Garrett", margin: 45, endedAt: "2026-08-01T03:00:00Z" },
      { player: "Amy", margin: 45, endedAt: "2026-08-02T03:00:00Z" },
    ];

    expect(rankLeaderboardWins(wins).map((win) => win.player)).toEqual(["Garrett", "Amy", "Zoe"]);
    expect(wins.map((win) => win.player)).toEqual(["Zoe", "Garrett", "Amy"]);
  });
});
