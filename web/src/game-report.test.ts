import { describe, expect, it } from "vitest";

import { singleGameReportRows, type SingleGameReportTotals } from "./game-report";

const totals = (overrides: Partial<SingleGameReportTotals> = {}): SingleGameReportTotals => ({
  wins: 0,
  losses: 1,
  skunks: 0,
  skunked: 0,
  doubleSkunks: 0,
  doubleSkunked: 0,
  analyzedGames: 0,
  errors: 0,
  peggingDealer: 0,
  peggingPone: 0,
  handDealer: 0,
  handPone: 0,
  crib: 0,
  peggingDealerHands: 0,
  peggingPoneHands: 0,
  handDealerHands: 0,
  handPoneHands: 0,
  cribHands: 0,
  ...overrides,
});

describe("singleGameReportRows", () => {
  it("compares player and AI values without opportunity counts after averages", () => {
    const rows = singleGameReportRows(
      totals({ wins: 1, losses: 0, peggingDealer: 12, peggingDealerHands: 2, crib: 7, cribHands: 1 }),
      totals({ peggingDealer: 5, peggingDealerHands: 1, crib: 0, cribHands: 0 }),
    );

    expect(rows).toContainEqual({ label: "Result", player: "Win", ai: "Loss", difference: "—" });
    expect(rows).toContainEqual({ label: "Avg peg as dealer", player: "6.00", ai: "5.00", difference: "+1.00" });
    expect(rows).toContainEqual({ label: "Avg crib", player: "7.00", ai: "-", difference: "—" });
    expect(rows.every((row) => !row.player.includes("(") && !row.ai.includes("("))).toBe(true);
    expect(rows.some((row) => row.label === "Skunk")).toBe(false);
  });

  it("adds skunk rows only when they apply", () => {
    const rows = singleGameReportRows(
      totals({ wins: 1, losses: 0, skunks: 1, doubleSkunks: 1 }),
      totals({ skunked: 1, doubleSkunked: 1 }),
    );

    expect(rows).toContainEqual({ label: "Skunk", player: "Won", ai: "Lost", difference: "—" });
    expect(rows).toContainEqual({ label: "Double skunk", player: "Won", ai: "Lost", difference: "—" });
  });

  it("shows analysis errors and a complete scoring cycle when available", () => {
    const rows = singleGameReportRows(
      totals({
        wins: 1,
        losses: 0,
        analyzedGames: 1,
        errors: 2,
        peggingDealer: 4,
        peggingDealerHands: 1,
        peggingPone: 3,
        peggingPoneHands: 1,
        handDealer: 8,
        handDealerHands: 1,
        handPone: 7,
        handPoneHands: 1,
        crib: 5,
        cribHands: 1,
      }),
      totals({
        peggingDealer: 5,
        peggingDealerHands: 1,
        peggingPone: 2,
        peggingPoneHands: 1,
        handDealer: 6,
        handDealerHands: 1,
        handPone: 6,
        handPoneHands: 1,
        crib: 4,
        cribHands: 1,
      }),
    );

    expect(rows).toContainEqual({ label: "Errors, total", player: "2", ai: "—", difference: "—" });
    expect(rows).toContainEqual({ label: "Errors / game", player: "2.00", ai: "—", difference: "—" });
    expect(rows).toContainEqual({ label: "Avg full cycle", player: "27.00", ai: "23.00", difference: "+4.00" });
  });
});
