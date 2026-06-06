import { describe, expect, test } from "vitest";
import {
  CribbageGame,
  cardsFromString,
  scoreCount,
  scoreFlushAndRightJack,
  scoreHand,
  scoreRuns,
} from "./engine";

describe("scoring", () => {
  test("scores a double run of four", () => {
    const cards = cardsFromString("Ad 2c 3h 4s 3d");
    const hand = cards.slice(0, 4);
    const cut = cards[4];

    expect(scoreRuns(hand, cut)).toBe(8);
    expect(scoreHand(hand, cut)).toBe(10);
  });

  test("scores a double double run", () => {
    const cards = cardsFromString("Ad 2c 3h 3s 2d");
    expect(scoreRuns(cards.slice(0, 4), cards[4])).toBe(12);
    expect(scoreHand(cards.slice(0, 4), cards[4])).toBe(16);
  });

  test("uses proper crib flush rules", () => {
    const cards = cardsFromString("Ah 7h 8h 10h Ks");
    expect(scoreFlushAndRightJack(cards.slice(0, 4), cards[4])).toBe(4);
    expect(scoreFlushAndRightJack(cards.slice(0, 4), cards[4], true)).toBe(0);
    expect(scoreHand(cards.slice(0, 4), cards[4], true)).toBe(2);
  });

  test("scores pegging runs and triples", () => {
    expect(scoreCount(cardsFromString("3d 4h 5s"))).toBe(3);
    expect(scoreCount(cardsFromString("4h 3d 5s"))).toBe(3);
    expect(scoreCount(cardsFromString("8d 8h 8s"))).toBe(6);
  });
});

describe("game state", () => {
  test("keeps first dealer stable while current dealer alternates", () => {
    const game = new CribbageGame("random");
    game.deal = 0;
    game.firstDeal = 0;
    game.startHand();
    expect(game.state().dealer).toBe("You");
    expect(game.state().firstDealer).toBe("You");

    game.deal = 1;
    game.startHand();
    expect(game.state().dealer).toBe("DCarlin");
    expect(game.state().firstDealer).toBe("You");
  });

  test("discards selected card ids instead of display positions", () => {
    const game = new CribbageGame("random");
    game.phase = "discard";
    game.dealer = game.human;
    game.crib = [];
    game.human.hand = cardsFromString("Ks 2d 9h Ac 5s 3c");

    game.discard(cardsFromString("2d Ac").map((card) => card.id));

    expect(new Set(game.crib.map((card) => card.ascii))).toEqual(new Set(["2d", "Ac"]));
    expect(new Set(game.human.hand.map((card) => card.ascii))).toEqual(
      new Set(["Ks", "9h", "5s", "3c"]),
    );
  });

  test("awards last card before show scoring", () => {
    const game = new CribbageGame("random");
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 1;
    game.human.score = 0;
    game.ai.score = 0;
    game.human.hand = [];
    game.ai.hand = cardsFromString("Ks");
    game.human.table = cardsFromString("Ad 6c 8h Qs");
    game.ai.table = cardsFromString("Kh");
    game.turnCard = cardsFromString("2d")[0];
    game.plays = cardsFromString("Kh");
    game.count = 10;
    game.lastPlayer = game.ai;

    // The AI's final king scores the pair, then the engine awards last card.
    (game as any).advanceUntilHuman();

    expect(game.ai.score).toBe(3);
    expect(game.log).toContain("DCarlin pegged 1 for last card.");
    expect(game.phase).toBe("score_pone");
  });
});
