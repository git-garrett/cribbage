import { describe, expect, it } from "vitest";

import { mergedLifetimeResults } from "./my-stats";

describe("mergedLifetimeResults", () => {
  it("uses the server's already-merged player row without double-counting local anonymous games", () => {
    const local = {
      human: { games: 4, wins: 3, losses: 1 },
      ai: { games: 4, wins: 1, losses: 3 },
    };
    const players = [{
      player: "Garrett",
      games: 137,
      wins: 67,
      losses: 70,
      skunks: 7,
      skunked: 10,
    }];

    expect(mergedLifetimeResults("garrett", players, local)).toEqual({
      player: "Garrett",
      human: { games: 137, wins: 67, losses: 70, skunks: 7, skunked: 10 },
      ai: { games: 137, wins: 70, losses: 67, skunks: 10, skunked: 7 },
      source: "server",
    });
  });

  it("falls back to local results before the leaderboard is available", () => {
    const local = {
      human: { games: 4, wins: 3, losses: 1 },
      ai: { games: 4, wins: 1, losses: 3 },
    };

    expect(mergedLifetimeResults("Garrett", [], local)).toEqual({
      player: "Garrett",
      human: { games: 4, wins: 3, losses: 1, skunks: 0, skunked: 0 },
      ai: { games: 4, wins: 1, losses: 3, skunks: 0, skunked: 0 },
      source: "local",
    });
  });
});
