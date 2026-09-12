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
  const rankValue = (card: string) => ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(rank(card)) + 1;
  const cardValue = (card: string) => Math.min(rankValue(card), 10);
  const keptCards = (hand: string[], selected: string[]) => hand.filter((card) => !selected.includes(card));
  const combinations = <T>(items: T[], size: number): T[][] => {
    if (size === 0) return [[]];
    return items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));
  };
  const sameCards = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  const isRun = (cards: string[]) => {
    const ranks = cards.map(rankValue).sort((left, right) => left - right);
    return new Set(ranks).size === cards.length && ranks.at(-1)! - ranks[0] === cards.length - 1;
  };

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

  it("offers only one combination of the score type each situation teaches", () => {
    for (const step of TRAINING_INTROS.pegging.steps) {
      for (const situation of [step, step.challenge]) {
        const scoringChoices = situation.hand.filter((card) => {
          if (step.id === "pair") return rank(card) === rank(situation.played.at(-1)!);
          if (step.id === "fifteen") return situation.countBefore + cardValue(card) === 15;
          return isRun([...situation.played, card]);
        });
        expect(scoringChoices).toEqual([situation.playedCard]);
      }
    }

    for (const step of TRAINING_INTROS.discard.steps) {
      for (const situation of [step, step.challenge]) {
        let matches: string[][];
        if (step.id === "pair") {
          matches = combinations(situation.hand, 2).filter(([left, right]) => rank(left) === rank(right));
        } else if (step.id === "fifteen") {
          matches = situation.hand.flatMap((_, index) => combinations(situation.hand, index + 1))
            .filter((cards) => cards.reduce((sum, card) => sum + cardValue(card), 0) === 15);
        } else if (step.id === "run-three") {
          matches = combinations(situation.hand, 3).filter(isRun);
        } else if (step.id === "run-four") {
          matches = combinations(situation.hand, 4).filter(isRun);
        } else if (step.id === "double-run") {
          matches = combinations(situation.hand, 4).filter((cards) => {
            const ranks = cards.map(rankValue).sort((left, right) => left - right);
            return new Set(ranks).size === 3 && ranks.at(-1)! - ranks[0] === 2;
          });
        } else if (step.id === "flush") {
          matches = combinations(situation.hand, 4).filter((cards) => new Set(cards.map(suit)).size === 1);
        } else {
          matches = [situation.hand.filter((card) => suit(card) === suit(situation.cutCard!))];
        }
        const intended = step.id === "crib-flush" ? situation.selected : situation.requiredKeepCards!;
        expect(matches).toHaveLength(1);
        expect(sameCards(matches[0], intended)).toBe(true);
      }
    }
  });
});
