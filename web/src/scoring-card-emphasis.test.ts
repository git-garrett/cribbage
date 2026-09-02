import { describe, expect, it } from "vitest";
import {
  handScoringCombinations,
  scoringEmphasisCardIds,
  type ScoringEmphasisCard,
} from "./scoring-card-emphasis";

function card(id: number, rank: string, suit: string, value: number): ScoringEmphasisCard {
  return { id, rank, suit, value };
}

describe("scoring card emphasis", () => {
  it("marks every card participating in at least one fifteen", () => {
    const hand = [
      card(1, "5", "hearts", 5),
      card(2, "Q", "clubs", 10),
      card(3, "2", "spades", 2),
      card(4, "3", "diamonds", 3),
    ];
    expect(scoringEmphasisCardIds(hand, card(5, "4", "clubs", 4), "hand", "Fifteens"))
      .toEqual([1, 2, 3, 4]);
  });

  it("marks duplicate ranks and every card in the longest run", () => {
    const hand = [
      card(1, "3", "hearts", 3),
      card(2, "3", "clubs", 3),
      card(3, "4", "spades", 4),
      card(4, "9", "diamonds", 9),
    ];
    expect(scoringEmphasisCardIds(hand, card(5, "5", "clubs", 5), "hand", "Runs"))
      .toEqual([1, 2, 3, 5]);
  });

  it("marks every card in a pair royal", () => {
    const hand = [
      card(1, "7", "hearts", 7),
      card(2, "7", "clubs", 7),
      card(3, "7", "spades", 7),
      card(4, "K", "diamonds", 10),
    ];
    expect(scoringEmphasisCardIds(hand, card(5, "2", "clubs", 2), "hand", "Pairs"))
      .toEqual([1, 2, 3]);
  });

  it("marks the jack responsible for knobs and its matching cut card", () => {
    const hand = [
      card(1, "J", "hearts", 10),
      card(2, "J", "clubs", 10),
      card(3, "4", "spades", 4),
      card(4, "9", "diamonds", 9),
    ];
    expect(scoringEmphasisCardIds(hand, card(5, "2", "hearts", 2), "hand", "Knobs"))
      .toEqual([1, 5]);
  });

  it("includes a matching cut card in a flush and requires it for a crib flush", () => {
    const hand = [
      card(1, "A", "hearts", 1),
      card(2, "4", "hearts", 4),
      card(3, "8", "hearts", 8),
      card(4, "K", "hearts", 10),
    ];
    expect(scoringEmphasisCardIds(hand, card(5, "2", "hearts", 2), "hand", "Flush"))
      .toEqual([1, 2, 3, 4, 5]);
    expect(scoringEmphasisCardIds(hand, card(6, "2", "clubs", 2), "crib", "Flush"))
      .toEqual([]);
  });
});

describe("individual hand scoring combinations", () => {
  it("returns each fifteen with only the cards in that fifteen", () => {
    const hand = [
      card(1, "5", "hearts", 5),
      card(2, "Q", "clubs", 10),
      card(3, "6", "spades", 6),
      card(4, "9", "diamonds", 9),
    ];
    expect(handScoringCombinations(hand, card(5, "2", "clubs", 2), "hand")
      .filter((combination) => combination.component === "fifteens"))
      .toEqual([
        { component: "fifteens", label: "Fifteen", points: 2, cardIds: [1, 2] },
        { component: "fifteens", label: "Fifteen", points: 2, cardIds: [3, 4] },
      ]);
  });

  it("returns one pair per two-card combination in ascending rank order", () => {
    const hand = [
      card(1, "Q", "hearts", 10),
      card(2, "Q", "clubs", 10),
      card(3, "A", "spades", 1),
      card(4, "A", "diamonds", 1),
    ];
    expect(handScoringCombinations(hand, card(5, "9", "clubs", 9), "hand")
      .filter((combination) => combination.component === "pairs"))
      .toEqual([
        { component: "pairs", label: "Pair", points: 2, cardIds: [3, 4] },
        { component: "pairs", label: "Pair", points: 2, cardIds: [1, 2] },
      ]);
  });

  it("expands a double-double run into its four distinct three-card runs", () => {
    const hand = [
      card(1, "3", "hearts", 3),
      card(2, "3", "clubs", 3),
      card(3, "4", "spades", 4),
      card(4, "4", "diamonds", 4),
    ];
    expect(handScoringCombinations(hand, card(5, "5", "clubs", 5), "hand")
      .filter((combination) => combination.component === "runs"))
      .toEqual([
        { component: "runs", label: "Run", points: 3, cardIds: [1, 3, 5] },
        { component: "runs", label: "Run", points: 3, cardIds: [1, 4, 5] },
        { component: "runs", label: "Run", points: 3, cardIds: [2, 3, 5] },
        { component: "runs", label: "Run", points: 3, cardIds: [2, 4, 5] },
      ]);
  });

  it("scores only the longest runs and never their three-card subruns", () => {
    const hand = [
      card(1, "3", "hearts", 3),
      card(2, "3", "clubs", 3),
      card(3, "4", "spades", 4),
      card(4, "5", "diamonds", 5),
    ];
    expect(handScoringCombinations(hand, card(5, "6", "clubs", 6), "hand")
      .filter((combination) => combination.component === "runs"))
      .toEqual([
        { component: "runs", label: "Run", points: 4, cardIds: [1, 3, 4, 5] },
        { component: "runs", label: "Run", points: 4, cardIds: [2, 3, 4, 5] },
      ]);
  });

  it("keeps a pair royal together as one scoring combination alongside three runs", () => {
    const hand = [
      card(1, "7", "hearts", 7),
      card(2, "7", "clubs", 7),
      card(3, "7", "spades", 7),
      card(4, "8", "diamonds", 8),
    ];
    const combinations = handScoringCombinations(hand, card(5, "9", "clubs", 9), "hand");
    expect(combinations.filter((combination) => combination.component === "runs"))
      .toHaveLength(3);
    expect(combinations.filter((combination) => combination.component === "pairs"))
      .toEqual([
        { component: "pairs", label: "Pair Royal", points: 6, cardIds: [1, 2, 3] },
      ]);
  });

  it("keeps four of a kind together as a double pair royal", () => {
    const hand = [
      card(1, "Q", "hearts", 10),
      card(2, "Q", "clubs", 10),
      card(3, "Q", "spades", 10),
      card(4, "Q", "diamonds", 10),
    ];
    expect(handScoringCombinations(hand, card(5, "2", "clubs", 2), "hand")
      .filter((combination) => combination.component === "pairs"))
      .toEqual([
        { component: "pairs", label: "Double Pair Royal", points: 12, cardIds: [1, 2, 3, 4] },
      ]);
  });

  it("matches cribbage run and pair totals for every five-card rank multiset", () => {
    const hands: number[][] = [];
    const enumerate = (ranks: number[], minimum: number): void => {
      if (ranks.length === 5) {
        hands.push(ranks);
        return;
      }
      for (let rank = minimum; rank <= 13; rank += 1) enumerate([...ranks, rank], rank);
    };
    enumerate([], 1);

    for (const ranks of hands) {
      const cards = ranks.map((rank, index) => card(
        index + 1,
        rank === 1 ? "A" : rank === 11 ? "J" : rank === 12 ? "Q" : rank === 13 ? "K" : String(rank),
        `${index}`,
        Math.min(rank, 10),
      ));
      const combinations = handScoringCombinations(cards.slice(0, 4), cards[4], "hand");
      const actualPairs = combinations
        .filter((combination) => combination.component === "pairs")
        .reduce((total, combination) => total + combination.points, 0);
      const actualRuns = combinations
        .filter((combination) => combination.component === "runs")
        .reduce((total, combination) => total + combination.points, 0);
      const counts = new Map<number, number>();
      for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
      const expectedPairs = [...counts.values()]
        .reduce((total, count) => total + (count * (count - 1)), 0);
      let longestRun = 0;
      let currentRun = 0;
      let currentMultiplier = 1;
      let expectedRuns = 0;
      for (let rank = 1; rank <= 14; rank += 1) {
        const count = counts.get(rank) ?? 0;
        if (count) {
          currentRun += 1;
          currentMultiplier *= count;
          continue;
        }
        if (currentRun >= 3 && currentRun >= longestRun) {
          if (currentRun > longestRun) expectedRuns = 0;
          longestRun = currentRun;
          expectedRuns += currentRun * currentMultiplier;
        }
        currentRun = 0;
        currentMultiplier = 1;
      }
      expect({ ranks, actualPairs, actualRuns }).toEqual({
        ranks,
        actualPairs: expectedPairs,
        actualRuns: expectedRuns,
      });
    }
  });
});
