// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const renderResultSource = mainSource.slice(
  mainSource.indexOf("function renderResult"),
  mainSource.indexOf("function scoreSummaryForEvent"),
);

describe("contextual game notifications", () => {
  it("uses a non-interactive live layer instead of a dedicated notification row", () => {
    expect(html).toMatch(/id="result" class="game-notifications" role="status" aria-live="polite" aria-atomic="true"/);
    expect(html).not.toContain("notification-row");
    expect(html).not.toContain("notice-back");
    expect(html).not.toContain("notice-forward");
  });

  it("turns unseen active-game scores into player-colored score bubbles", () => {
    expect(mainSource).toMatch(/function newScoreNotices[\s\S]*collectNewScoreEvents\(state\.scoreNoticeCursor, gameId, game\.analyticsEvents\)/s);
    expect(mainSource).toMatch(/for \(const event of collectNewScoreEvents[\s\S]*if \(!shouldAnnounceScoreEvent\(event, events\)\) continue;/s);
    expect(mainSource).toMatch(/bubble\.dataset\.player = notice\.player/);
    expect(mainSource).toMatch(/points\.textContent = `\+\$\{notice\.points\}`/);
    expect(mainSource).toContain("player.textContent = playerName(notice.player)");
    expect(mainSource).toMatch(/event\.reason === "Heels"\) return "Heels"/);
  });

  it("uses the larger branded bubble scale for every scoring category", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.game-notification-score\s*\{[^}]*width:\s*clamp\(106px,[^,]+,\s*180px\)/s);
    expect(css).toMatch(/\.game-notification-points\s*\{[^}]*font-size:\s*max\(46px,/s);
    expect(css).toMatch(/\.game-notification-player\s*\{[^}]*font-size:\s*max\(12px,/s);
  });

  it("does not turn general game status copy into transient bubbles", () => {
    expect(renderResultSource).toContain("enqueueNotices(newScoreNotices(game))");
    expect(renderResultSource).not.toContain('kind: "status"');
    expect(renderResultSource).not.toContain("game.result");
    expect(renderResultSource).not.toContain("game.message");
  });

  it("waits for score bubbles to finish before opening the hand or crib summary", () => {
    expect(html).toMatch(/id="score-summary-dialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
    expect(html).toMatch(/id="score-summary-items"/);
    expect(html).toMatch(/id="continue-scoring"[^>]*>Next</);
    expect(mainSource).toMatch(/if \(!notice\) \{\s*maybeOpenScoreSummary\(\);/s);
    expect(mainSource).toMatch(/scoreSummaryQueue\.push\(summary\)/);
  });

  it("names the next dealer hand and crib on scoring-summary actions", () => {
    expect(mainSource).toMatch(/scoring\.stage === "pone"\) return `\$\{playerPossessive\(dealer\)\} Hand Next`/);
    expect(mainSource).toMatch(/scoring\.stage === "dealer"\) return `\$\{playerPossessive\(dealer\)\} Crib Next`/);
    expect(mainSource).toContain("els.continueScoring.textContent = summary.nextLabel");
  });

  it("renders deal cutting as a clickable row with localized player and opponent reveals", () => {
    expect(mainSource).toContain("const DEAL_CUT_CARD_COUNT = 52");
    expect(mainSource).toMatch(/for \(let index = 0; index < DEAL_CUT_CARD_COUNT; index \+= 1\)/);
    expect(mainSource).toMatch(/slot\.setAttribute\("role", "button"\)[\s\S]*Cut at card \$\{index \+ 1\} of \$\{DEAL_CUT_CARD_COUNT\}/s);
    expect(mainSource).toContain('state.dealCutRevealStage = "human"');
    expect(mainSource).toContain('state.dealCutRevealStage = "ai"');
  });

  it("anchors pegging, cut, and hand scores to the action that produced them", () => {
    expect(mainSource).toMatch(/notice\.anchor === "scoring"[\s\S]*scoringCards\.querySelector\("\.card:last-child"\)/s);
    expect(mainSource).toMatch(/notice\.anchor === "cut"[\s\S]*turnCard\.querySelector\("\.card"\)/s);
    expect(mainSource).toMatch(/notice\.anchor === "play"[\s\S]*played-active \.card:last-child/s);
  });
});
