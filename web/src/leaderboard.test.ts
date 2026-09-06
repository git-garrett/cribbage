import { describe, expect, it } from "vitest";

import {
  leaderboardMetricValue,
  leaderboardScore,
  rankLeaderboardHandicaps,
  rankLeaderboardMetricPlayers,
  rankLeaderboardPlayers,
  rankLeaderboardWins,
} from "./leaderboard";

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

describe("rankLeaderboardMetricPlayers", () => {
  const players = [
    { player: "Zulu", games: 4, wins: 2, losses: 2, skunks: 1, skunked: 0, leaderboardPoints: 3, pointDifferential: 8, avgMargin: 2 },
    { player: "Alpha", games: 4, wins: 3, losses: 1, skunks: 0, skunked: 0, leaderboardPoints: 3, pointDifferential: 8, avgMargin: 2 },
    { player: "Bravo", games: 2, wins: 2, losses: 0, skunks: 0, skunked: 0, leaderboardPoints: 2, pointDifferential: 4, avgMargin: 2 },
  ];

  it("calculates every persisted-game metric", () => {
    expect(leaderboardMetricValue(players[0], "pointsPerGame")).toBe(0.6);
    expect(leaderboardMetricValue(players[0], "winPercentage")).toBe(0.5);
    expect(leaderboardMetricValue(players[0], "pointDifferential")).toBe(8);
    expect(leaderboardMetricValue(players[0], "totalPoints")).toBe(3);
    expect(leaderboardMetricValue(players[0], "totalWins")).toBe(2);
  });

  it("uses explicit deterministic tie breakers", () => {
    expect(rankLeaderboardMetricPlayers(players, "pointDifferential").map(({ player }) => player))
      .toEqual(["Alpha", "Zulu", "Bravo"]);
    expect(rankLeaderboardMetricPlayers(players, "totalWins").map(({ player }) => player))
      .toEqual(["Alpha", "Zulu", "Bravo"]);
  });

  it("does not mutate the API rows", () => {
    rankLeaderboardMetricPlayers(players, "totalWins");
    expect(players.map(({ player }) => player)).toEqual(["Zulu", "Alpha", "Bravo"]);
  });
});

describe("rankLeaderboardHandicaps", () => {
  it("puts the smallest current handicap first, then uses cycles and name", () => {
    const handicaps = [
      { player: "Zulu", wpPerGame: -0.08, cycles: 9 },
      { player: "Bravo", wpPerGame: -0.04, cycles: 7 },
      { player: "Alpha", wpPerGame: -0.04, cycles: 7 },
    ];
    expect(rankLeaderboardHandicaps(handicaps).map(({ player }) => player))
      .toEqual(["Alpha", "Bravo", "Zulu"]);
  });
});
