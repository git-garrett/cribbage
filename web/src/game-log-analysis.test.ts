// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../rust/cribbage-api/main.rs", import.meta.url), "utf8");

describe("game log decision analysis", () => {
  it("offers per-game and bulk incremental analysis", () => {
    expect(html).toContain('id="game-log-analyze-all"');
    expect(source).toContain('className = "game-log-item-analyze"');
    expect(source).toContain("function analyzeGameDecisionReviews");
    expect(source).toContain("function analyzeAllLoggedGames");
    expect(source).toContain('serverJson<ServerGameActionResponse>("/api/game/review"');
    expect(apiSource).toContain('("POST", "/api/game/review") => review_game');
  });

  it("retains review access when a report was opened from the log", () => {
    expect(source).toMatch(/function singleGameDecisionReview[\s\S]*analyzeGameDecisionReviews\(end\.gameId\)/);
    expect(source).not.toContain("canAnalyzeCurrentGameDecisionReviews");
  });

  it("stores live reviews and Ace help instead of repeating completed work", () => {
    expect(source.match(/storeLiveDecisionReview\(currentSnapshot\.gameId\)/g)).toHaveLength(3);
    expect(source).toContain('await api("/api/record-help", { decisionKey: preparation.key })');
    expect(apiSource).toContain('"record-help" =>');
    expect(apiSource).toMatch(/find\(\|review\| review\.completed\.is_none\(\)\)/);
  });

  it("adds a browsable error ledger beneath the Game Log tab", () => {
    expect(html).toContain('data-game-log-view="errors"');
    expect(html).toContain('id="game-log-errors-list"');
    expect(source).toContain("function renderGameLogErrors");
    expect(source).toContain("openLoggedGameReport(game.gameId, error.id)");
  });
});
