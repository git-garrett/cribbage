import { describe, expect, it } from "vitest";
import { scoringEmphasisCardIds, type ScoringEmphasisCard } from "./scoring-card-emphasis";

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

  it("marks only the jack responsible for knobs", () => {
    const hand = [
      card(1, "J", "hearts", 10),
      card(2, "J", "clubs", 10),
      card(3, "4", "spades", 4),
      card(4, "9", "diamonds", 9),
    ];
    expect(scoringEmphasisCardIds(hand, card(5, "2", "hearts", 2), "hand", "Knobs"))
      .toEqual([1]);
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
