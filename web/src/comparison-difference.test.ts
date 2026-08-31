import { describe, expect, it } from "vitest";

import { comparisonTone } from "./comparison-difference";

describe("comparisonTone", () => {
  it("marks positive differences as good and negative differences as bad", () => {
    expect(comparisonTone("+1.00")).toBe("good");
    expect(comparisonTone("−1.00")).toBe("bad");
  });

  it("leaves zero and unavailable differences neutral", () => {
    expect(comparisonTone("0.00")).toBeUndefined();
    expect(comparisonTone("—")).toBeUndefined();
  });
});
