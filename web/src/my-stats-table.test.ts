import { describe, expect, it } from "vitest";

import { myStatsTableRows, type MyStatsTableTotals } from "./my-stats-table";

function totals(overrides: Partial<MyStatsTableTotals> = {}): MyStatsTableTotals {
  return {
    games: 12,
    wins: 7,
    losses: 5,
    skunks: 2,
    skunked: 1,
    peggingDealer: 16,
    peggingPone: 14,
    handDealer: 42,
    handPone: 38,
    crib: 25,
    peggingDealerHands: 0,
    peggingPoneHands: 0,
    handDealerHands: 0,
    handPoneHands: 0,
    cribHands: 0,
    ...overrides,
  };
}

describe("myStatsTableRows", () => {
  it("builds one player-versus-AI comparison with scoring averages per scoring opportunity", () => {
    const player = {
      ...totals(),
      peggingDealerHands: 4,
      peggingPoneHands: 6,
      handDealerHands: 4,
      handPoneHands: 4,
      cribHands: 5,
    };
    const ai = {
      ...totals({ wins: 5, losses: 7, crib: 20 }),
      peggingDealerHands: 3,
      peggingPoneHands: 2,
      handDealerHands: 5,
      handPoneHands: 5,
      cribHands: 4,
    };
    const rows = myStatsTableRows(player, ai);

    expect(rows).toContainEqual({ label: "Wins", player: "7", ai: "5", difference: "+2" });
    expect(rows).toContainEqual({ label: "Losses", player: "5", ai: "7", difference: "−2" });
    expect(rows).toContainEqual({ label: "Avg peg as dealer", player: "4.00", ai: "5.33", difference: "−1.33" });
    expect(rows).toContainEqual({ label: "Avg peg as pone", player: "2.33", ai: "7.00", difference: "−4.67" });
    expect(rows).toContainEqual({ label: "Avg hand as dealer", player: "10.50", ai: "8.40", difference: "+2.10" });
    expect(rows).toContainEqual({ label: "Avg hand as pone", player: "9.50", ai: "7.60", difference: "+1.90" });
    expect(rows).toContainEqual({ label: "Avg crib", player: "5.00", ai: "5.00", difference: "0.00" });
  });

  it("shows a dash when no scoring opportunities are available", () => {
    const empty = {
      ...totals(),
      peggingDealerHands: 0,
      peggingPoneHands: 0,
      handDealerHands: 0,
      handPoneHands: 0,
      cribHands: 0,
    };
    const row = myStatsTableRows(empty, empty).find((candidate) => candidate.label === "Avg crib");

    expect(row).toEqual({ label: "Avg crib", player: "-", ai: "-", difference: "—" });
  });
});
