// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameState } from "./api-types";
import {
  aceAdviceDecisionKey,
  choiceDiffersFromAce,
  isAceAdviceOpponent,
  mistakeAdviceForChoice,
} from "./ace-advice";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function decision(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: "pegging",
    message: "",
    log: [],
    result: [],
    handNumber: 1,
    scores: { human: 0, ai: 0 },
    pegPositions: { human: [0, 0], ai: [0, 0] },
    dealer: "AI",
    firstDealer: "AI",
    cribOwner: "AI",
    turn: "User",
    count: 10,
    turnCard: null,
    turnCardRevealed: true,
    plays: [],
    completedPlays: [],
    peggingResetPending: false,
    humanHand: [],
    aiHandCount: 4,
    humanTable: [],
    aiTable: [],
    legalCardIds: [1, 2],
    aiLegalCardIds: [],
    canGo: false,
    scoring: null,
    cutForDeal: null,
    analyticsEvents: [],
    ...overrides,
  };
}

describe("Ace advice preparation", () => {
  it("is available only against Easy and Tough", () => {
    expect(isAceAdviceOpponent("myrmidon-5")).toBe(true);
    expect(isAceAdviceOpponent("schell_table-peg_table-9.1")).toBe(true);
    expect(isAceAdviceOpponent("schell_table-peg_table-9.11")).toBe(true);
    expect(isAceAdviceOpponent("schell_table-peg_table-13.0")).toBe(false);
    expect(isAceAdviceOpponent("schell_table-peg_table-13.215")).toBe(false);
    expect(isAceAdviceOpponent("schell_table-peg_table-16.3")).toBe(false);
    expect(isAceAdviceOpponent(undefined)).toBe(false);
  });

  it("treats discard order as irrelevant while detecting a different pair", () => {
    const recommendation = { kind: "discard" as const, cardIds: [4, 9] };

    expect(choiceDiffersFromAce("discard", [9, 4], recommendation)).toBe(false);
    expect(choiceDiffersFromAce("discard", [4, 10], recommendation)).toBe(true);
  });

  it("detects a different pegging play but ignores advice for another action", () => {
    expect(choiceDiffersFromAce("play", [8], { kind: "play", cardIds: [7] })).toBe(true);
    expect(choiceDiffersFromAce("play", [8], { kind: "discard", cardIds: [7, 8] })).toBe(false);
  });

  it("retains an intentional error comparison while Ace advice is still pending", async () => {
    let finishAdvice!: (advice: { kind: "play"; cardIds: number[] }) => void;
    const pendingAdvice = new Promise<{ kind: "play"; cardIds: number[] }>((resolve) => {
      finishAdvice = resolve;
    });
    const review = mistakeAdviceForChoice("play", [8], pendingAdvice);

    finishAdvice({ kind: "play", cardIds: [7] });

    await expect(review).resolves.toEqual({ kind: "play", cardIds: [7] });
  });

  it("suppresses a pending error after the user makes a subsequent play", async () => {
    let finishAdvice!: (advice: { kind: "play"; cardIds: number[] }) => void;
    const pendingAdvice = new Promise<{ kind: "play"; cardIds: number[] }>((resolve) => {
      finishAdvice = resolve;
    });
    let choiceRevision = 1;
    const review = mistakeAdviceForChoice(
      "play",
      [9],
      pendingAdvice,
      () => choiceRevision === 1,
    );

    choiceRevision = 2;
    finishAdvice({ kind: "play", cardIds: [7] });

    await expect(review).resolves.toBeNull();
  });

  it("keys advice to the exact pegging decision", () => {
    const before = decision({ count: 10, legalCardIds: [1, 2] });
    const after = decision({ count: 15, legalCardIds: [2] });

    expect(aceAdviceDecisionKey("game-1", before)).not.toBe(aceAdviceDecisionKey("game-1", after));
  });

  it("prepares eligible advice before a click and retains a pending comparison", () => {
    expect(mainSource).toContain("startAceAdvicePreparation(game)");
    expect(mainSource).toMatch(/if \(!game \|\| !preparation\) return;/);
    expect(mainSource).toContain("preparation.advice ?? preparation.promise");
    expect(mainSource).toContain('reviewUserChoiceWithAce(state.game, "discard", selectedIds)');
    expect(mainSource).toContain('reviewUserChoiceWithAce(state.game, "play", [card.id])');
  });

  it("expires the prior Error notice when a new user play is reviewed", () => {
    expect(mainSource).toMatch(/function reviewUserChoiceWithAce[\s\S]*const choiceRevision = \+\+aceMistakeChoiceRevision;[\s\S]*state\.aceMistake = null;/s);
    expect(mainSource).toMatch(/mistakeAdviceForChoice\([\s\S]*\(\) => aceMistakeChoiceRevision === choiceRevision/s);
  });

  it("places an accessible review badge on the cut interface as soon as a discard error is known", () => {
    expect(htmlSource).toMatch(/id="turn-card"[\s\S]*id="ace-mistake"/);
    expect(htmlSource).toContain('aria-label="Error: review your last choice with Ace"');
    expect(stylesSource).toContain(".ace-mistake:focus-visible");
    expect(stylesSource).toMatch(/\.ace-mistake \{[\s\S]*border-radius: 50%/);
    expect(mainSource).toMatch(/function isDiscardMistakeOnTurnCut\(\)[\s\S]*state\.turnCutRevealStage[\s\S]*advice\.kind === "discard"/s);
    expect(mainSource).toMatch(/function renderAceMistakeBadge[\s\S]*isDiscardMistakeOnTurnCut\(\)/s);
    expect(mainSource).toMatch(/function renderTurnCut[\s\S]*turn-cut-error-slot[\s\S]*append\(els\.aceMistake\)/s);
    expect(stylesSource).toMatch(/\.turn-cut-row \.turn-cut-error-slot \.ace-mistake\s*\{[\s\S]*position: relative/);
  });

  it("lets players independently disable hints and error notices", () => {
    expect(htmlSource).toContain('id="hints-enabled"');
    expect(htmlSource).toContain('id="error-notices-enabled"');
    expect(mainSource).toContain("HINTS_ENABLED_STORAGE_KEY");
    expect(mainSource).toContain("ERROR_NOTICES_ENABLED_STORAGE_KEY");
    expect(mainSource).toMatch(/masterAdviceAvailable = state\.hintsEnabled && aceAdviceEligible/);
    expect(mainSource).toMatch(/state\.errorNoticesEnabled &&[\s\S]*state\.aceMistake/);
    expect(mainSource).toMatch(/!state\.hintsEnabled && !state\.errorNoticesEnabled[\s\S]*return null/);
  });
});
