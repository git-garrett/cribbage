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
      scoringGames: 123,
      humanScoring: {
        peggingDealer: 240,
        peggingPone: 225,
        handDealer: 710,
        handPone: 680,
        crib: 390,
        peggingDealerHands: 60,
        peggingPoneHands: 61,
        handDealerHands: 60,
        handPoneHands: 61,
        cribHands: 60,
      },
      aiScoring: {
        peggingDealer: 250,
        peggingPone: 230,
        handDealer: 700,
        handPone: 690,
        crib: 360,
        peggingDealerHands: 61,
        peggingPoneHands: 60,
        handDealerHands: 61,
        handPoneHands: 60,
        cribHands: 61,
      },
    }];

    expect(mergedLifetimeResults("garrett", players, local)).toMatchObject({
      player: "Garrett",
      human: {
        games: 137,
        wins: 67,
        losses: 70,
        skunks: 7,
        skunked: 10,
        peggingDealer: 240,
        peggingDealerHands: 60,
        crib: 390,
        cribHands: 60,
      },
      ai: {
        games: 137,
        wins: 70,
        losses: 67,
        skunks: 10,
        skunked: 7,
        peggingDealer: 250,
        peggingDealerHands: 61,
        crib: 360,
        cribHands: 61,
      },
      source: "server",
      scoringGames: 123,
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
