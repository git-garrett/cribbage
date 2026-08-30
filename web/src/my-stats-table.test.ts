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
    ...overrides,
  };
}

describe("myStatsTableRows", () => {
  it("builds one player-versus-AI comparison with scoring averages", () => {
    const rows = myStatsTableRows(totals(), totals({ wins: 5, losses: 7, crib: 20 }), 10);

    expect(rows).toContainEqual({ label: "Wins", player: "7", ai: "5" });
    expect(rows).toContainEqual({ label: "Total scoring", player: "135", ai: "130" });
    expect(rows).toContainEqual({ label: "Avg scoring", player: "13.50", ai: "13.00" });
    expect(rows).toContainEqual({ label: "Pegging", player: "30", ai: "30" });
  });

  it("shows a dash when no detailed scoring games are available", () => {
    const row = myStatsTableRows(totals(), totals(), 0).find((candidate) => candidate.label === "Avg scoring");

    expect(row).toEqual({ label: "Avg scoring", player: "-", ai: "-" });
  });
});
