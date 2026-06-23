import { describe, expect, test } from "vitest";
import {
  CribbageGame,
  DEFAULT_OPPONENT,
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
  test("defaults to the production expert peg table engine", () => {
    expect(DEFAULT_OPPONENT).toBe("schell_table-peg_table-14.3");
    expect(new CribbageGame().opponent).toBe("schell_table-peg_table-14.3");
  });

  test("keeps first dealer stable while current dealer alternates", () => {
    const game = new CribbageGame();
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
    const game = new CribbageGame();
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
    const game = new CribbageGame();
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

  test("completes pegging when user plays the final card through granular play", () => {
    const game = new CribbageGame();
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.score = 0;
    game.ai.score = 0;
    game.human.hand = cardsFromString("7c");
    game.ai.hand = [];
    game.human.table = cardsFromString("Ad 6c 8h");
    game.ai.table = cardsFromString("Kh 4d 2s 9c");
    game.turnCard = cardsFromString("2d")[0];
    game.plays = cardsFromString("5c");
    game.count = 5;
    game.lastPlayer = game.ai;

    game.playHumanPeggingCard(game.human.hand[0].id);

    expect(game.phase).toBe("pegging_complete");
    expect(game.log).toContain("User pegged 1 for last card.");
    expect(game.state().turn).toBeNull();
    expect(game.state().legalCardIds).toEqual([]);
    expect(game.state().canGo).toBe(false);
  });

  test("keeps AI final scoring play before last-card message", () => {
    const game = new CribbageGame();
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 1;
    game.human.score = 0;
    game.ai.score = 0;
    game.human.hand = [];
    game.ai.hand = cardsFromString("10d");
    game.human.table = cardsFromString("5d 2c 3h 4s");
    game.ai.table = cardsFromString("Ad 6c 8h");
    game.turnCard = cardsFromString("2d")[0];
    game.plays = cardsFromString("5d");
    game.playOwners = ["human"];
    game.count = 5;
    game.lastPlayer = game.human;

    game.playAiPeggingCard(game.ai.hand[0].id);

    expect(game.phase).toBe("pegging_complete");
    expect(game.ai.score).toBe(3);
    expect(game.state().result).toContain("AI played 10d: 15 and pegged 2.");
    expect(game.state().result).toContain("AI pegged 1 for last card.");
    expect(game.state().peggingResetPending).toBe(false);
    expect(game.state().count).toBe(15);
    expect(game.state().plays.map((card) => card.label)).toEqual(["5d", "10d"]);
    expect(game.state().completedPlays.at(-1)).toBeUndefined();

    game.continueScoring();

    expect(game.state().plays).toEqual([]);
    expect(game.state().completedPlays.at(-1)?.map((card) => card.label)).toEqual(["5d", "10d"]);
  });

  test("pauses after count reset until acknowledged", () => {
    const game = new CribbageGame();
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.score = 0;
    game.ai.score = 0;
    game.human.hand = cardsFromString("10d 4c");
    game.ai.hand = cardsFromString("2h");
    game.turnCard = cardsFromString("2d")[0];
    game.plays = cardsFromString("5d 6c 10h");
    game.playOwners = ["human", "ai", "human"];
    game.count = 21;
    game.lastPlayer = game.ai;

    game.playHumanPeggingCard(game.human.hand[0].id);

    expect(game.state().peggingResetPending).toBe(true);
    expect(game.state().count).toBe(31);
    expect(game.state().turn).toBe("User");
    expect(game.state().plays.map((card) => card.label)).toEqual(["5d", "6c", "10h", "10d"]);
    expect(() => game.playHumanPeggingCard(game.human.hand[0].id)).toThrow(/Acknowledge/);

    game.acknowledgePeggingReset();

    expect(game.state().peggingResetPending).toBe(false);
    expect(game.state().count).toBe(0);
    expect(game.state().turn).toBe("AI");
    expect(game.state().plays).toEqual([]);
    expect(game.state().completedPlays.at(-1)?.map((card) => card.label)).toEqual(["5d", "6c", "10h", "10d"]);
  });

  test("pauses after go reset until acknowledged", () => {
    const game = new CribbageGame();
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.score = 0;
    game.ai.score = 0;
    game.human.hand = cardsFromString("10d");
    game.ai.hand = [];
    game.turnCard = cardsFromString("2d")[0];
    game.plays = cardsFromString("9d 8c 8h");
    game.playOwners = ["human", "ai", "human"];
    game.count = 25;
    game.goPlayer = game.ai;
    game.lastPlayer = game.human;

    game.humanPeggingGo();

    expect(game.state().peggingResetPending).toBe(true);
    expect(game.state().count).toBe(25);
    expect(game.state().turn).toBe("User");
    expect(game.state().plays.map((card) => card.label)).toEqual(["9d", "8c", "8h"]);
    expect(game.human.score).toBe(1);

    game.acknowledgePeggingReset();

    expect(game.state().peggingResetPending).toBe(false);
    expect(game.state().count).toBe(0);
    expect(game.state().turn).toBe("AI");
    expect(game.state().plays).toEqual([]);
    expect(game.state().completedPlays.at(-1)?.map((card) => card.label)).toEqual(["9d", "8c", "8h"]);
  });

  test("keeps user pegging score messages through automatic pegging continuations", () => {
    const game = new CribbageGame();
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.score = 0;
    game.ai.score = 0;
    game.human.hand = cardsFromString("7c");
    game.ai.hand = [];
    game.human.table = cardsFromString("6c");
    game.ai.table = cardsFromString("5c");
    game.turnCard = cardsFromString("2d")[0];
    game.plays = cardsFromString("6c 5c");
    game.playOwners = ["human", "ai"];
    game.count = 11;

    game.playHumanPeggingCard(cardsFromString("7c")[0].id);
    (game as any).advancePeggingToHuman();

    expect(game.human.score).toBeGreaterThanOrEqual(3);
    expect(game.state().result).toContain("User played 7c: 18 and pegged 3.");
    expect(game.state().result).toContain("User pegged 1 for last card.");
  });

  test("keeps prior pegging messages when automatic user go is recorded", () => {
    const game = new CribbageGame();
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.hand = cardsFromString("2d");
    game.ai.hand = cardsFromString("3c");
    game.turnCard = cardsFromString("4h")[0];
    game.plays = cardsFromString("Kh Qs Jd");
    game.playOwners = ["ai", "human", "ai"];
    game.count = 30;
    game.result = ["AI played Jd: 30."];

    game.humanPeggingGo();

    expect(game.state().result).toEqual(["AI played Jd: 30.", "User says go."]);
  });

  test("restores a saved game snapshot", () => {
    const game = new CribbageGame();
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
    const game = new CribbageGame();
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
    const game = new CribbageGame();
    game.human.score = 18;
    game.ai.score = 7;
    game.phase = "discard";
    const snapshot = game.snapshot();
    snapshot.handNumber = 1;

    const restored = CribbageGame.restore(snapshot);

    expect(restored.state().handNumber).toBe(2);
  });

  test("tracks analytics for pegging and hand scoring by role", () => {
    const game = new CribbageGame();
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

  test("records enough analytics detail to reconstruct a hand", () => {
    const game = new CribbageGame();
    game.deal = 0;
    game.firstDeal = 0;
    game.startHand();
    game.human.hand = cardsFromString("Ad 2c 3h 4s 9d 10c");
    game.ai.hand = cardsFromString("5d 6c 7h 8s Jd Qc");
    game.turnCard = cardsFromString("Ks")[0];
    game.analyticsEvents = [];
    game.analyticsCounter = 0;
    game.startHand();
    game.human.hand = cardsFromString("Ad 2c 3h 4s 9d 10c");
    game.ai.hand = cardsFromString("5d 6c 7h 8s Jd Qc");
    game.turnCard = cardsFromString("Ks")[0];
    game.analyticsEvents = [];

    // Re-record a deterministic hand-start event after overriding the deal.
    (game as any).recordAnalytics({
      type: "hand",
      action: "start",
      handNumber: game.handNumber,
      dealer: game.dealer.key,
      pone: game.pone.key,
      turnCard: game.turnCard.ascii,
      dealtHands: {
        human: game.human.hand.map((card) => card.ascii),
        ai: game.ai.hand.map((card) => card.ascii),
      },
      scores: { human: game.human.score, ai: game.ai.score },
    });

    game.discard(cardsFromString("9d 10c").map((card) => card.id));
    game.finishDiscard();
    game.phase = "pegging_complete";
    game.human.table = cardsFromString("Ad 2c 3h 4s");
    game.ai.table = cardsFromString("5d 6c 7h 8s");
    game.ai.crib = [...game.crib];
    game.continueScoring();
    game.continueScoring();
    game.continueScoring();
    game.continueScoring();

    const events = game.state().analyticsEvents;
    const handStart = events.find((event) => event.type === "hand" && event.action === "start");
    const userDiscard = events.find((event) => event.type === "discard" && event.player === "human");
    const handScore = events.find(
      (event) => event.type === "score" && event.category === "hand" && event.player === "human",
    );
    const handEnd = [...events].reverse().find((event) => event.type === "hand" && event.action === "end");

    expect(handStart).toMatchObject({
      turnCard: "Ks",
      dealtHands: {
        human: ["Ad", "2c", "3h", "4s", "9d", "10c"],
        ai: ["5d", "6c", "7h", "8s", "Jd", "Qc"],
      },
    });
    expect(userDiscard).toMatchObject({
      cards: ["9d", "10c"],
      cribOwner: "human",
      cribAfterDiscard: ["9d", "10c"],
      remainingHand: ["Ad", "2c", "3h", "4s"],
    });
    expect(handScore).toMatchObject({
      cards: ["Ad", "2c", "3h", "4s"],
      turnCard: "Ks",
      scores: { human: expect.any(Number), ai: expect.any(Number) },
    });
    expect(handEnd).toMatchObject({
      crib: expect.arrayContaining(["9d", "10c"]),
      tables: {
        human: ["Ad", "2c", "3h", "4s"],
        ai: ["5d", "6c", "7h", "8s"],
      },
    });
  });

  test("records game outcome totals including skunks", () => {
    const game = new CribbageGame();
    game.human.score = 119;
    game.ai.score = 60;
    game.analyticsEvents = [];

    expect(() => (game as any).peg(game.human, 2)).toThrow();

    const gameEnd = game.state().analyticsEvents.find(
      (event) => event.type === "game" && event.action === "end",
    );
    expect(gameEnd).toMatchObject({
      winner: "human",
      loser: "ai",
      result: "double-skunk",
      finalScores: { human: 121, ai: 60 },
    });
  });

  test("autoplays AI versus AI games to completion", () => {
    const game = new CribbageGame("ras_table-2.0");

    game.autoPlayToEnd();

    const gameEnd = game.state().analyticsEvents.find(
      (event) => event.type === "game" && event.action === "end",
    );
    expect(game.phase).toBe("game_over");
    expect(gameEnd).toMatchObject({
      winner: expect.stringMatching(/human|ai/),
      loser: expect.stringMatching(/human|ai/),
      finalScores: expect.objectContaining({ human: expect.any(Number), ai: expect.any(Number) }),
    });
  });

  test("exhaustive peg variants choose legal plays", () => {
    const game = new CribbageGame("ras_table-peg-3.0");
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.hand = cardsFromString("5d 6c");
    game.ai.hand = cardsFromString("4d");
    game.human.table = [];
    game.ai.table = [];
    game.crib = cardsFromString("2d 3c Jh Qh");
    game.turnCard = cardsFromString("As")[0];
    game.plays = cardsFromString("10c");
    game.playOwners = ["ai"];
    game.count = 10;

    const play = (game as any).choosePlay(game.human);

    expect(["5d", "6c"]).toContain(play.ascii);
    expect(game.count + play.value).toBeLessThanOrEqual(31);
  });

  test("simple peg tiebreaker favors higher rank", () => {
    const game = new CribbageGame("schell_table-2.0");
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.hand = cardsFromString("10d Qc Ks");
    game.ai.hand = [];
    game.plays = [];
    game.count = 0;

    const play = (game as any).choosePlay(game.human);

    expect(play.ascii).toBe("Ks");
  });

  test("exhaustive peg tiebreaker favors higher rank", () => {
    const game = new CribbageGame("schell_table-peg_table-4.0");
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.hand = cardsFromString("Qc Ks");
    game.ai.hand = [];
    game.human.table = [];
    game.ai.table = [];
    game.crib = cardsFromString("2d 3c 4h 5s");
    game.turnCard = cardsFromString("As")[0];
    game.plays = [];
    game.count = 0;

    const play = (game as any).choosePlay(game.human);

    expect(play.ascii).toBe("Ks");
  });

  test("peg table variants use generated discard policy", () => {
    const game = new CribbageGame("schell_table-peg_table-4.0");
    game.human.hand = cardsFromString("As 2d 3c 4h 5s 6d");

    const discards = (game as any).chooseDiscards(game.human, false);

    expect(discards.map((card: any) => card.ascii).sort()).toEqual(["2d", "As"]);
  });

  test("peg table variants use generated best pone lead", () => {
    const game = new CribbageGame("schell_table-peg_table-4.0");
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.hand = cardsFromString("As 2d 3c 4h 5s 6d");
    const discards = (game as any).chooseDiscards(game.human, false);
    game.human.hand = game.human.hand.filter((card: any) => !discards.includes(card));
    game.ai.hand = cardsFromString("7d 8c 9h 10s");
    game.plays = [];
    game.count = 0;

    const play = (game as any).choosePlay(game.human);

    expect(play.ascii).toBe("3c");
  });

  test("records discard review against the current best model", () => {
    const game = new CribbageGame("schell_table-peg_table-4.0");
    game.phase = "discard";
    game.dealer = game.ai;
    game.pone = game.human;
    game.crib = [];
    game.human.hand = cardsFromString("As 2d 3c 4h 5s 6d");
    game.ai.hand = cardsFromString("7d 8c 9h 10s Jd Qc");

    game.discard(cardsFromString("5s 6d").map((card) => card.id));

    const discard = game.state().analyticsEvents.find(
      (event) => event.type === "discard" && event.player === "human",
    );
    expect(discard).toMatchObject({
      cards: ["5s", "6d"],
      review: {
        model: DEFAULT_OPPONENT,
        selected: ["5s", "6d"],
        recommended: ["As", "2d"],
        delta: expect.any(Number),
        winProbabilityDelta: expect.any(Number),
      },
    });
    expect((discard as any).review.delta).toBeGreaterThan(0);
    expect((discard as any).review.recommendedEv).toEqual(expect.any(Number));
  });

  test("defers pegging review against the current best model", () => {
    const game = new CribbageGame("schell_table-peg_table-4.0");
    game.phase = "pegging";
    game.pone = game.human;
    game.dealer = game.ai;
    game.turn = 0;
    game.human.hand = cardsFromString("5d 10c");
    game.ai.hand = cardsFromString("Kh");
    game.human.table = [];
    game.ai.table = [];
    game.crib = cardsFromString("2d 3c 4h 9s");
    game.turnCard = cardsFromString("As")[0];
    game.plays = cardsFromString("10d");
    game.playOwners = ["ai"];
    game.count = 10;

    game.play(cardsFromString("10c")[0].id);

    const pegging = game.state().analyticsEvents.find(
      (event) => event.type === "pegging" && event.action === "play" && event.player === "human",
    );
    expect(pegging).toMatchObject({
      card: "10c",
    });
    expect((pegging as any).review).toBeUndefined();

    expect(game.completePendingDecisionReviews()).toBe(1);
    expect(pegging).toMatchObject({
      review: {
        model: DEFAULT_OPPONENT,
        selected: ["10c"],
        recommended: ["5d"],
        selectedEv: expect.any(Number),
        recommendedEv: expect.any(Number),
        winProbabilityDelta: expect.any(Number),
      },
    });
  });
});
