import { describe, expect, it } from "vitest";

import { scoringTitle } from "./scoring-title";

describe("hand and crib counting titles", () => {
  it("uses the participant's possessive name", () => {
    expect(scoringTitle("Garrett", "hand")).toBe("Garrett's Hand");
    expect(scoringTitle("Ace", "crib")).toBe("Ace's Crib");
    expect(scoringTitle("James", "hand")).toBe("James' Hand");
  });
});
