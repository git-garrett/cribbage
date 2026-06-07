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
    expect(game.state().dealer).toBe("User");
    expect(game.state().firstDealer).toBe("User");

    game.deal = 1;
    game.startHand();
    expect(game.state().dealer).toBe("AI");
    expect(game.state().firstDealer).toBe("User");
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
    expect(game.state().result).toContain("User discarded two cards to the crib.");
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
    expect(game.log).toContain("AI pegged 1 for last card.");
    expect(game.phase).toBe("pegging_complete");

    game.continueScoring();

    expect(game.phase).toBe("score_pone");
  });

  test("restores a saved game snapshot", () => {
    const game = new CribbageGame("random");
    game.deal = 0;
    game.firstDeal = 0;
    game.startHand();
    game.human.hand = cardsFromString("Ad 2c 3h 4s 9d 10c");
    game.ai.hand = cardsFromString("5d 6c 7h 8s Jd Qc");
    game.turnCard = cardsFromString("Ks")[0];

    game.discard(cardsFromString("9d 10c").map((card) => card.id));
    game.finishDiscard();

    const restored = CribbageGame.restore(game.snapshot());

    expect(restored.state()).toEqual(game.state());
    expect(restored.snapshot()).toEqual(game.snapshot());
  });

  test("restores scoring review without recounting points", () => {
    const game = new CribbageGame("random");
    game.phase = "pegging_complete";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turnCard = cardsFromString("5s")[0];
    game.human.table = cardsFromString("Ad 2c 3h 4s");
    game.ai.table = cardsFromString("Kh Qc 9d 8s");
    game.ai.crib = cardsFromString("6d 7c 8h 9s");
    game.human.score = 10;
    game.ai.score = 20;

    game.continueScoring();
    const scoreAfterCounting = game.human.score;
    const restored = CribbageGame.restore(game.snapshot());

    expect(restored.phase).toBe("score_pone");
    expect(restored.human.score).toBe(scoreAfterCounting);
    expect(restored.state().scoring?.title).toBe("User hand");
    expect(restored.state().scoring?.points).toBe(game.state().scoring?.points);
  });

  test("infers hand number when restoring an older saved game", () => {
    const game = new CribbageGame("random");
    game.human.score = 18;
    game.ai.score = 7;
    game.phase = "discard";
    const snapshot = game.snapshot();
    snapshot.handNumber = 1;

    const restored = CribbageGame.restore(snapshot);

    expect(restored.state().handNumber).toBe(2);
  });

  test("tracks analytics for pegging and hand scoring by role", () => {
    const game = new CribbageGame("random");
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.hand = cardsFromString("5d");
    game.ai.hand = cardsFromString("Kh");
    game.human.table = [];
    game.ai.table = [];
    game.turnCard = cardsFromString("9s")[0];
    game.plays = cardsFromString("10c");
    game.playOwners = ["ai"];
    game.count = 10;

    game.play(cardsFromString("5d")[0].id);
    const peggingScore = game.state().analyticsEvents.find(
      (event) => event.type === "score" && event.category === "pegging",
    );

    expect(peggingScore).toMatchObject({
      player: "human",
      role: "pone",
      category: "pegging",
      points: 2,
      count: 15,
    });

    game.phase = "pegging_complete";
    game.pone = game.human;
    game.dealer = game.ai;
    game.human.table = cardsFromString("Ad 2c 3h 4s");
    game.ai.table = cardsFromString("Kh Qc 9d 8s");
    game.ai.crib = cardsFromString("6d 7c 8h 9s");
    game.turnCard = cardsFromString("5s")[0];
    game.continueScoring();

    const handScore = game.state().analyticsEvents.find(
      (event) => event.type === "score" && event.category === "hand" && event.player === "human",
    );
    expect(handScore).toMatchObject({
      player: "human",
      role: "pone",
      category: "hand",
      points: scoreHand(game.human.table, game.turnCard),
    });
  });
});
