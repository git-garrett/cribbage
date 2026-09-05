import { describe, expect, it } from "vitest";

import { peggingDisplayCardLimit, peggingDisplaySeries, recentPeggingCards } from "./pegging-display";

describe("peggingDisplaySeries", () => {
  const card = (id: number, owner: "human" | "ai") => ({ id, owner });

  it("keeps completed series visible as prior series and marks only the live series current", () => {
    expect(peggingDisplaySeries({
      plays: [card(3, "human"), card(4, "ai")],
      completedPlays: [[card(1, "human"), card(2, "ai")]],
      peggingResetPending: false,
    })).toEqual([
      { cards: [card(1, "human"), card(2, "ai")], current: false },
      { cards: [card(3, "human"), card(4, "ai")], current: true },
    ]);
  });

  it("does not duplicate the just-completed series while reset acknowledgement is pending", () => {
    const finished = [card(1, "human"), card(2, "ai")];
    expect(peggingDisplaySeries({
      plays: [],
      completedPlays: [finished],
      peggingResetPending: true,
    })).toEqual([{ cards: finished, current: true }]);
  });

  it("keeps only the newest requested cards in the compact pegging window", () => {
    expect(recentPeggingCards([1, 2, 3, 4, 5, 6, 7], 5)).toEqual({
      hidden: [1, 2],
      visible: [3, 4, 5, 6, 7],
    });
    expect(recentPeggingCards([1, 2, 3], 5)).toEqual({ hidden: [], visible: [1, 2, 3] });
  });

  it("keeps every possible card in a desktop series and compacts mobile", () => {
    expect(peggingDisplayCardLimit(390)).toBe(7);
    expect(peggingDisplayCardLimit(640)).toBe(7);
    expect(peggingDisplayCardLimit(641)).toBe(8);
    expect(peggingDisplayCardLimit(1440)).toBe(8);
  });
});
