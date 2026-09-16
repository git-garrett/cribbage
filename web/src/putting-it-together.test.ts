import { describe, expect, it } from "vitest";
import { PUTTING_IT_TOGETHER } from "./putting-it-together";

describe("Putting It All Together", () => {
  it("follows one complete cribbage progression", () => {
    expect(PUTTING_IT_TOGETHER.steps.map((step) => step.action)).toEqual([
      "cut", "deal", "discard", "peg", "count", "alternate", "win",
    ]);
    expect(PUTTING_IT_TOGETHER.introduction).toContain("121");
    expect(PUTTING_IT_TOGETHER.completion).toContain("Easy");
  });
});
