// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("branded utility pages", () => {
  it("covers every legacy full-page utility surface", () => {
    for (const className of [
      "analytics-page",
      "leaderboard-page",
      "model-info-page",
      "decision-review-page",
    ]) {
      expect(html).toContain(`class="${className}`);
      expect(css).toContain(`.${className}`);
    }
    expect(html).toContain('id="stats-game-log"');
    expect(css).toContain(".stats-game-log");
    expect(css).toMatch(/:is\([\s\S]*\.analytics-page,[\s\S]*\.decision-review-page[\s\S]*var\(--entry-panel\)/);
  });

  it("uses the current clubhouse palette and cribbage-track header signature", () => {
    expect(css).toMatch(/\.analytics-header::after[\s\S]*radial-gradient\([\s\S]*var\(--entry-accent\)/);
    expect(css).toMatch(/\.analytics-header h2[\s\S]*Palatino[\s\S]*var\(--access-page-title\)/);
    expect(css).toMatch(/\.analytics-header button[\s\S]*border-radius: 999px;[\s\S]*background: #0b5b43/);
  });

  it("harmonizes tables, cards, filters, reviews, and overlays", () => {
    expect(css).toMatch(/\.my-stats-table-wrap[\s\S]*var\(--entry-panel-soft\)/);
    expect(css).toMatch(/\.my-stats-table thead th[\s\S]*var\(--entry-featured\)/);
    expect(css).toMatch(/\.game-log-item::before[\s\S]*var\(--entry-accent\)/);
    expect(css).toMatch(/\.model-info-item\.selected[\s\S]*var\(--entry-featured\)/);
    expect(css).toMatch(/\.decision-snapshot[\s\S]*backdrop-filter: blur\(7px\)/);
    expect(html).toMatch(/id="app-back" class="pathway-back app-back"/);
    expect(css).toMatch(/\.my-stats-table thead th[\s\S]*overflow-wrap: normal;[\s\S]*word-break: normal/);
  });

  it("keeps Ace review scores above a centered cut card", () => {
    expect(css).toMatch(/\.snapshot-scoreboard > \.score:first-child\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*1/s);
    expect(css).toMatch(/\.snapshot-scoreboard > \.score\.ai\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*1/s);
    expect(css).toMatch(/\.snapshot-scoreboard > \.score-cut\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*grid-row:\s*2[^}]*justify-self:\s*center/s);
  });

  it("retains mobile and reduced-motion treatment", () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.app\[data-view="analytics"\][\s\S]*\.model-info-layout[\s\S]*grid-template-columns: 1fr/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.game-log-item,[\s\S]*\.model-info-item[\s\S]*transition: none/);
  });

  it("renders Statistics even when the user has no active game", () => {
    expect(source).toMatch(/function renderUtilityPages\(\)[\s\S]*if \(state\.analyticsOpen\) renderAnalytics\(\)/);
    expect(source).toMatch(/function render\(game: GameState \| null\)[\s\S]*if \(!game\) \{\s*renderUtilityPages\(\);\s*return;/);
  });

  it("uses the same complete header on statistics and other utility pages", () => {
    expect(css).toMatch(/\.mobile-header-reveal\s*\{[^}]*display:\s*none/s);
    expect(source).toContain("const utilityHeaderActive =");
    expect(source).toMatch(/active \|\| utilityHeaderActive[\s\S]*els\.topbar\.append\(els\.peoplePresence\)/);
    expect(css).toMatch(/\.app\[data-view="analytics"\] > \.topbar[\s\S]*grid-template-columns:\s*minmax\(58px, 1fr\) minmax\(0, auto\) minmax\(70px, 1fr\)/s);
  });
});
