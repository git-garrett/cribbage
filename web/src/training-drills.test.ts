import { describe, expect, it } from "vitest";
import { BEGINNER_DRILLS } from "./training-drills";

describe("beginner training drills", () => {
  it("sets up the dummy scoring play around a played six and a playable nine", () => {
    const drill = BEGINNER_DRILLS["find-scoring-play"];

    expect(drill.played.map((card) => card.rank)).toEqual(["6"]);
    expect(drill.hand).toHaveLength(4);
    expect(drill.hand.some((card) => card.rank === "9")).toBe(true);
    expect(drill.hand.some((card) => card.rank === "6")).toBe(false);
    expect(drill.requiredSelections).toBe(1);
  });

  it("sets up the dummy six-card discard with the user's crib", () => {
    const drill = BEGINNER_DRILLS.discard;

    expect(drill.hand.map((card) => card.rank)).toEqual(["4", "4", "5", "6", "Q", "K"]);
    expect(drill.cribOwner).toBe("User");
    expect(drill.requiredSelections).toBe(2);
  });
});
