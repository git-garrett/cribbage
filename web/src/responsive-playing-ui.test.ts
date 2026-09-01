// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("branded responsive playing UI", () => {
  it("uses the circular track and retires the legacy lanes throughout the game view", () => {
    expect(css).toMatch(/\.app\[data-view="game"\] \.board > \.lane\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.app\[data-view="game"\] \.circular-board\s*\{[\s\S]*display:\s*grid/);
  });

  it("adapts the playing table at tablet and desktop breakpoints", () => {
    expect(css).toMatch(/@media \(min-width:\s*641px\)[\s\S]*--game-track-size:\s*300px/);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*grid-template-columns:\s*minmax\(520px/);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*> \.table\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*2/);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*> \.scoreboard\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*2/);
  });

  it("uses full hand-size card backs and a stacked AI label on desktop", () => {
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*\.app\[data-view="game"\] \.ai-strip\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*\.app\[data-view="game"\] \.ai-strip \.card,[\s\S]*\.app\[data-view="game"\] \.deal-animation-deck,[\s\S]*\.app\[data-view="game"\] \.pegging-row \.turn-cut-deck[\s\S]*\{[^}]*width:\s*max\(var\(--game-card-width\),\s*82px\)[^}]*height:\s*max\(var\(--game-card-height\),\s*116px\)/s);
  });

  it("keeps the desktop pegging stack centered when the AI hand disappears", () => {
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*data-phase="pegging"\] > \.table,[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto[^}]*align-content:\s*stretch/s);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*data-phase="pegging"\] \.played,[\s\S]*grid-row:\s*2[^}]*align-self:\s*center/s);
  });

  it("keeps the desktop hand and play slots fixed when pegging completes", () => {
    expect(css).toMatch(/data-phase="pegging"\] > \.table,[\s\S]*data-phase="pegging_complete"\] > \.table\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/s);
    expect(css).toMatch(/data-phase="pegging"\] \.played,[\s\S]*data-phase="pegging_complete"\] \.played\s*\{[^}]*grid-row:\s*2[^}]*align-self:\s*center/s);
    expect(css).toMatch(/data-phase="pegging"\] \.user-panel,[\s\S]*data-phase="pegging_complete"\] \.user-panel\s*\{[^}]*grid-row:\s*3/s);
  });

  it("uses the current pill treatment for scoring and gameplay actions", () => {
    expect(css).toMatch(/\.app\[data-view="game"\] \.actions button,[\s\S]*\.app\[data-view="game"\] \.scoring-summary button\s*\{[^}]*border-radius:\s*999px/s);
  });

  it("uses one fixed right-center anchor for every desktop turn-cut state", () => {
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*\.app\[data-view="game"\] > \.table\s*\{[^}]*position:\s*relative/s);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*data-phase="pegging"\] #plays \.played-active\.pegging-row\s*\{[^}]*padding-right:\s*160px/s);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*\.played > \.score-cut,[\s\S]*\.turn-cut-row \.cut-slot-human,[\s\S]*\.turn-cut-row \.cut-slot-ai,[\s\S]*\.turn-cut-row \.turn-cut-deck\s*\{[^}]*position:\s*absolute[^}]*top:\s*50%[^}]*right:\s*120px[^}]*transform:\s*translate\(50%,\s*-50%\)/s);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*\.played > \.score-cut\s*\{[^}]*width:\s*var\(--game-played-card-width\)[^}]*height:\s*var\(--game-played-card-height\)/s);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*\.played > \.score-cut #turn-card\s*\{[^}]*position:\s*absolute[^}]*top:\s*50%[^}]*left:\s*50%[^}]*transform:\s*translate\(-50%,\s*-50%\)/s);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*\.app\[data-view="game"\] \.pegging-row \.turn-cut-deck[\s\S]*\{[^}]*width:\s*max\(var\(--game-card-width\),\s*82px\)[^}]*height:\s*max\(var\(--game-card-height\),\s*116px\)/s);
    expect(css).toMatch(/\.game-notifications\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*pointer-events:\s*none/s);
  });

  it("keeps large cards rectangular and simplified at every width", () => {
    expect(css).toMatch(/body\[data-font-size="large"\] \.app\[data-view="game"\] \.card:not\(\.back\)/);
    expect(css).toMatch(/body\[data-font-size="large"\] \.app\[data-view="game"\] \.card \.corner\s*\{\s*display:\s*none/);
  });

  it("keeps the AI hand hidden at x-large and saves space during hand counting", () => {
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.app\[data-view="game"\] \.ai-strip\s*\{\s*display:\s*none\s*!important/);
    expect(css).toMatch(/data-phase="score_crib"[\s\S]*> \.scoreboard > \.board\s*\{\s*display:\s*none\s*!important/);
  });

  it("uses one central phase directive without reserving a notification row", () => {
    expect(css).toMatch(/The table speaks through one calm, persistent phase label[\s\S]*\.app\[data-view="game"\] \.played > h2\s*\{[^}]*display:\s*block/s);
    expect(css).toMatch(/\.app\[data-view="game"\] \.played > h2\[hidden\]\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.app\[data-view="game"\] \.turn-cut-label\s*\{\s*display:\s*none/);
    expect(css).not.toContain(".notification-row");
  });
});
