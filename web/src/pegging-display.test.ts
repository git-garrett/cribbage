import { describe, expect, it } from "vitest";

import { peggingDisplaySeries } from "./pegging-display";

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
});
