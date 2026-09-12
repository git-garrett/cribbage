import { describe, expect, it } from "vitest";
import {
  correctTrainingIntroChoice,
  TRAINING_INTROS,
  trainingIntroAnswer,
  trainingIntroRequiredSelections,
} from "./training-intros";

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

  it("turns every example into a matching hands-on practice decision", () => {
    for (const step of TRAINING_INTROS.pegging.steps) {
      expect(trainingIntroRequiredSelections("pegging")).toBe(1);
      expect(trainingIntroAnswer(step, "pegging")).toEqual([step.playedCard]);
      expect(correctTrainingIntroChoice(step, "pegging", [step.playedCard!])).toBe(true);
    }
    for (const step of TRAINING_INTROS.discard.steps) {
      expect(trainingIntroRequiredSelections("discard")).toBe(2);
      expect(trainingIntroAnswer(step, "discard")).toEqual(step.selected);
      expect(correctTrainingIntroChoice(step, "discard", [...step.selected].reverse())).toBe(true);
    }
  });
});
