import { describe, expect, it } from "vitest";

import {
  handScoreNoticeParts,
  peggingScoreNoticeParts,
  shouldAnnounceScoreEvent,
  type ScoreNoticeEvent,
} from "./score-notice-policy";

function score(overrides: Partial<ScoreNoticeEvent> = {}): ScoreNoticeEvent {
  return {
    handNumber: 1,
    player: "human",
    category: "pegging",
    points: 0,
    ...overrides,
  };
}

describe("score notification policy", () => {
  it("suppresses zero-point pegging opportunities", () => {
    const event = score();
    expect(shouldAnnounceScoreEvent(event, [event])).toBe(false);
  });

  it("keeps literal zero hands and cribs", () => {
    const hand = score({ category: "hand" });
    const crib = score({ category: "crib", player: "ai" });
    expect(shouldAnnounceScoreEvent(hand, [hand])).toBe(true);
    expect(shouldAnnounceScoreEvent(crib, [crib])).toBe(true);
  });

  it("suppresses the provisional zero when the same hand or crib scored points", () => {
    const zeroHand = score({ category: "hand" });
    const scoredHand = score({ category: "hand", points: 8 });
    expect(shouldAnnounceScoreEvent(zeroHand, [zeroHand, scoredHand])).toBe(false);
  });

  it("does not confuse another player, category, or hand with the same scoring opportunity", () => {
    const zeroCrib = score({ category: "crib" });
    const otherScores = [
      score({ category: "crib", player: "ai", points: 4 }),
      score({ category: "hand", points: 4 }),
      score({ category: "crib", handNumber: 2, points: 4 }),
    ];
    expect(shouldAnnounceScoreEvent(zeroCrib, [zeroCrib, ...otherScores])).toBe(true);
  });

  it("keeps every positive score", () => {
    const event = score({ points: 1 });
    expect(shouldAnnounceScoreEvent(event, [event])).toBe(true);
  });

  it("orders hand-count bubbles as fifteens, runs, pairs, knobs, then flush", () => {
    expect(handScoreNoticeParts(score({
      category: "hand",
      points: 15,
      scoreComponents: { total: 15, fifteens: 4, runs: 3, pairs: 4, flush: 3, knobs: 1 },
    }))).toEqual([
      { label: "Fifteens", points: 4 },
      { label: "Runs", points: 3 },
      { label: "Pairs", points: 4 },
      { label: "Knobs", points: 1 },
      { label: "Flush", points: 3 },
    ]);
  });

  it("does not split literal zero hands", () => {
    expect(handScoreNoticeParts(score({ points: 0, category: "crib", scoreComponents: { total: 0 } }))).toBeNull();
  });

  it("names pegging runs and each pair tier", () => {
    expect(peggingScoreNoticeParts(score({
      points: 10,
      scoreComponents: { total: 10, runs: 3, pairs: 2, lastCard: 1, fifteens: 2, thirtyOne: 2 },
    }))).toEqual([
      { label: "Fifteen", points: 2 },
      { label: "Thirty-one", points: 2 },
      { label: "Run", points: 3 },
      { label: "Pair", points: 2 },
      { label: "Last card", points: 1 },
    ]);
    expect(peggingScoreNoticeParts(score({
      points: 6,
      scoreComponents: { total: 6, pairs: 6 },
    }))).toEqual([{ label: "Pair Royal", points: 6 }]);
    expect(peggingScoreNoticeParts(score({
      points: 12,
      scoreComponents: { total: 12, pairs: 12 },
    }))).toEqual([{ label: "Double Pair Royal", points: 12 }]);
  });
});
