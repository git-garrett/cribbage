import { describe, expect, it } from "vitest";
import {
  correctTrainingIntroChoice,
  randomizedTrainingHand,
  TRAINING_INTROS,
  trainingIntroAnswer,
  trainingIntroRequiredSelections,
} from "./training-intros";

describe("beginner training intros", () => {
  const rank = (card: string) => card.slice(0, -1);
  const suit = (card: string) => card.slice(-1);
  const keptCards = (hand: string[], selected: string[]) => hand.filter((card) => !selected.includes(card));

  it("teaches pegging scoring in order before the scoring drill", () => {
    expect(TRAINING_INTROS.pegging.steps.map((step) => step.id)).toEqual(["pair", "fifteen", "run-three", "run-four"]);
    expect(TRAINING_INTROS.pegging.steps.every((step) => step.playedCard && step.selected.length === 0)).toBe(true);
    expect(TRAINING_INTROS.pegging.drillRoute).toBe("drill-scoring-play");
  });

  it("teaches the full beginner discard sequence before discard drills", () => {
    expect(TRAINING_INTROS.discard.steps.map((step) => step.id)).toEqual([
      "pair", "fifteen", "run-three", "run-four", "double-run", "flush", "crib-flush",
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

  it("accepts any discard that preserves the instructed scoring cards", () => {
    const pair = TRAINING_INTROS.discard.steps.find((step) => step.id === "pair")!;
    expect(correctTrainingIntroChoice(pair, "discard", ["6s", "9h"])).toBe(true);
    expect(correctTrainingIntroChoice(pair, "discard", ["4c", "9h"])).toBe(false);

    const run = TRAINING_INTROS.discard.steps.find((step) => step.id === "run-three")!;
    expect(correctTrainingIntroChoice(run, "discard", ["9h", "Qc"])).toBe(true);
    expect(correctTrainingIntroChoice(run, "discard", ["5s", "Qc"])).toBe(false);

    const cribFlush = TRAINING_INTROS.discard.steps.find((step) => step.id === "crib-flush")!;
    expect(correctTrainingIntroChoice(cribFlush, "discard", ["Ah", "4h"])).toBe(true);
    expect(correctTrainingIntroChoice(cribFlush, "discard", ["6c", "8d"])).toBe(false);
  });

  it("randomizes each hand without putting a correct choice first", () => {
    for (const intro of Object.values(TRAINING_INTROS)) {
      for (const step of intro.steps) {
        for (const situation of [step, step.challenge]) {
          const answer = trainingIntroAnswer(situation, intro.kind);
          const randomized = randomizedTrainingHand(situation.hand, answer, () => 0.999);
          expect(randomized).toHaveLength(situation.hand.length);
          expect([...randomized].sort()).toEqual([...situation.hand].sort());
          expect(answer).not.toContain(randomized[0]);
        }
      }
    }
  });

  it("adds a distinct transfer situation after every guided practice", () => {
    for (const intro of Object.values(TRAINING_INTROS)) {
      for (const step of intro.steps) {
        expect(step.challenge.hand).not.toEqual(step.hand);
        expect(trainingIntroAnswer(step.challenge, intro.kind)).toHaveLength(trainingIntroRequiredSelections(intro.kind));
        expect(correctTrainingIntroChoice(step.challenge, intro.kind, trainingIntroAnswer(step.challenge, intro.kind))).toBe(true);
        if (intro.kind === "pegging" && step.challenge.playedCard) {
          const values: Record<string, number> = { A: 1, J: 10, Q: 10, K: 10 };
          const rank = step.challenge.playedCard.slice(0, -1);
          expect(step.challenge.countBefore + (values[rank] ?? Number(rank))).toBeLessThanOrEqual(31);
        }
      }
    }
  });

  it("uses a different scoring combination in every transfer situation", () => {
    for (const step of TRAINING_INTROS.pegging.steps) {
      const exampleRanks = [...step.played, step.playedCard!].map(rank).sort();
      const challengeRanks = [...step.challenge.played, step.challenge.playedCard!].map(rank).sort();
      expect(challengeRanks).not.toEqual(exampleRanks);
    }

    const discardSteps = Object.fromEntries(TRAINING_INTROS.discard.steps.map((step) => [step.id, step]));
    const keptRanks = (id: string, challenge = false) => {
      const step = discardSteps[id];
      const situation = challenge ? step.challenge : step;
      return keptCards(situation.hand, situation.selected).map(rank).sort();
    };
    for (const id of ["pair", "fifteen", "run-three", "run-four", "double-run"]) {
      expect(keptRanks(id, true)).not.toEqual(keptRanks(id));
    }

    const flush = discardSteps.flush;
    expect(suit(keptCards(flush.challenge.hand, flush.challenge.selected)[0])).not.toBe(suit(keptCards(flush.hand, flush.selected)[0]));
    const cribFlush = discardSteps["crib-flush"];
    expect(suit(cribFlush.challenge.selected[0])).not.toBe(suit(cribFlush.selected[0]));
  });
});
