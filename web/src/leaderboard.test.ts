import { describe, expect, it } from "vitest";

import { leaderboardScore, rankLeaderboardPlayers, rankLeaderboardWins } from "./leaderboard";

describe("rankLeaderboardPlayers", () => {
  it("ranks by (wins + skunks) / (wins + skunks + losses + skunked)", () => {
    const players = [
      { player: "Skunk split", wins: 1, skunks: 1, losses: 1, skunked: 1 },
      { player: "Two of three", wins: 2, skunks: 0, losses: 1, skunked: 0 },
    ];

    expect(leaderboardScore(players[0])).toBe(0.5);
    expect(leaderboardScore(players[1])).toBeCloseTo(2 / 3);
    expect(rankLeaderboardPlayers(players).map((player) => player.player)).toEqual([
      "Two of three",
      "Skunk split",
    ]);
  });
});

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
