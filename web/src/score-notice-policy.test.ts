import { describe, expect, it } from "vitest";

import {
  handScoreNoticeParts,
  peggingScoreNoticeParts,
  scoreNoticeEmphasisCardIds,
  shouldAnnounceScoreEvent,
  type ScoreNoticeEvent,
} from "./score-notice-policy";
import type { ScoringEmphasisCard } from "./scoring-card-emphasis";

function card(id: number, rank: string, suit: string, value: number): ScoringEmphasisCard {
  return { id, rank, suit, value };
}

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

  it("splits QQAA into an individually animated pair for each rank", () => {
    const hand = [
      card(1, "Q", "hearts", 10),
      card(2, "Q", "clubs", 10),
      card(3, "A", "spades", 1),
      card(4, "A", "diamonds", 1),
    ];
    expect(handScoreNoticeParts(score({
      category: "hand",
      points: 4,
      scoreComponents: { total: 4, pairs: 4 },
    }), hand, card(5, "9", "clubs", 9))).toEqual([
      { label: "Pair", points: 2, cardIds: [3, 4] },
      { label: "Pair", points: 2, cardIds: [1, 2] },
    ]);
  });

  it("presents three of a kind as one pair royal bubble", () => {
    const hand = [
      card(1, "7", "hearts", 7),
      card(2, "7", "clubs", 7),
      card(3, "7", "spades", 7),
      card(4, "K", "diamonds", 10),
    ];
    expect(handScoreNoticeParts(score({
      category: "hand",
      points: 6,
      scoreComponents: { total: 6, pairs: 6 },
    }), hand, card(5, "2", "clubs", 2))).toEqual([
      { label: "Pair Royal", points: 6, cardIds: [1, 2, 3] },
    ]);
  });

  it("animates both the matching jack and the cut card for knobs", () => {
    const hand = [
      card(1, "J", "hearts", 10),
      card(2, "4", "clubs", 4),
      card(3, "7", "spades", 7),
      card(4, "9", "diamonds", 9),
    ];
    expect(handScoreNoticeParts(score({
      category: "hand",
      points: 1,
      scoreComponents: { total: 1, knobs: 1 },
    }), hand, card(5, "2", "hearts", 2))).toEqual([
      { label: "Knobs", points: 1, cardIds: [1, 5] },
    ]);
  });

  it("animates the cut card when heels is counted", () => {
    const cut = card(5, "J", "hearts", 10);
    expect(scoreNoticeEmphasisCardIds(
      { ...score({ category: "pegging", points: 2 }), reason: "Heels" },
      { label: "Heels", points: 2 },
      undefined,
      cut,
    )).toEqual([5]);
  });

  it("splits double-double runs and pairs into their individual scores", () => {
    const hand = [
      card(1, "3", "hearts", 3),
      card(2, "3", "clubs", 3),
      card(3, "4", "spades", 4),
      card(4, "4", "diamonds", 4),
    ];
    const parts = handScoreNoticeParts(score({
      category: "hand",
      points: 20,
      scoreComponents: { total: 20, fifteens: 4, runs: 12, pairs: 4 },
    }), hand, card(5, "5", "clubs", 5));
    expect(parts?.filter((part) => part.label === "Run")).toEqual([
      { label: "Run", points: 3, cardIds: [1, 3, 5] },
      { label: "Run", points: 3, cardIds: [1, 4, 5] },
      { label: "Run", points: 3, cardIds: [2, 3, 5] },
      { label: "Run", points: 3, cardIds: [2, 4, 5] },
    ]);
    expect(parts?.filter((part) => part.label === "Pair")).toEqual([
      { label: "Pair", points: 2, cardIds: [1, 2] },
      { label: "Pair", points: 2, cardIds: [3, 4] },
    ]);
  });

  it("falls back to the authoritative aggregate when card decomposition disagrees", () => {
    const hand = [
      card(1, "A", "hearts", 1),
      card(2, "2", "clubs", 2),
      card(3, "3", "spades", 3),
      card(4, "4", "diamonds", 4),
    ];
    expect(handScoreNoticeParts(score({
      category: "hand",
      points: 6,
      scoreComponents: { total: 6, runs: 6 },
    }), hand, card(5, "5", "clubs", 5))).toEqual([
      { label: "Runs", points: 6 },
    ]);
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
