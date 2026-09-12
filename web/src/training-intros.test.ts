import { describe, expect, it } from "vitest";
import { TRAINING_INTROS } from "./training-intros";

describe("beginner training intros", () => {
  it("teaches pegging scoring in order before the scoring drill", () => {
    expect(TRAINING_INTROS.pegging.steps.map((step) => step.id)).toEqual(["pair", "fifteen", "run-three", "run-four"]);
    expect(TRAINING_INTROS.pegging.steps.every((step) => step.playedCard && step.selected.length === 0)).toBe(true);
    expect(TRAINING_INTROS.pegging.drillRoute).toBe("drill-scoring-play");
  });

  it("teaches the full beginner discard sequence before discard drills", () => {
    expect(TRAINING_INTROS.discard.steps.map((step) => step.id)).toEqual([
      "pair", "fifteen", "run-three", "run-four", "double-run", "flush", "crib-flush", "nobs",
    ]);
    expect(TRAINING_INTROS.discard.steps.every((step) => step.selected.length === 2)).toBe(true);
    expect(TRAINING_INTROS.discard.drillRoute).toBe("drill-discard");
  });
});
