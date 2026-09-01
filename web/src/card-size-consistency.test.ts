// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("playing-card size consistency", () => {
  it("derives pegging and cut dimensions from the hand-card footprint", () => {
    expect(css).toMatch(/--game-played-card-width:\s*var\(--game-card-width\)/);
    expect(css).toMatch(/--game-played-card-height:\s*var\(--game-card-height\)/);
    expect(css).toMatch(/\.app\[data-view="game"\] \.card\s*\{[^}]*width:\s*var\(--game-card-width\) !important[^}]*height:\s*var\(--game-card-height\) !important/s);
    expect(css).toMatch(/\.app\[data-view="game"\] \.played > \.score-cut\s*\{[^}]*width:\s*var\(--game-card-width\)[^}]*height:\s*var\(--game-card-height\)/s);
  });

  it("uses one card face treatment throughout the game table", () => {
    expect(css).toMatch(/\.app\[data-view="game"\] \.card \.corner\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/\.app\[data-view="game"\] \.card:not\(\.back\) \.rank\s*\{[^}]*font-family:\s*Georgia[^}]*font-size:\s*max\(31px,\s*var\(--app-font\)\) !important/s);
    expect(css).toMatch(/\.app\[data-view="game"\] \.card:not\(\.back\) \.suit\s*\{[^}]*font-size:\s*max\(27px,\s*calc\(var\(--app-font\) \* 0\.9\)\) !important/s);
  });

  it("overlaps full-size pegging, AI-hand, and deal cards instead of shrinking them", () => {
    expect(css).toMatch(/#plays \.played-active\.pegging-row \.card \+ \.card\s*\{[^}]*margin-left:\s*-22px/s);
    expect(css).toMatch(/\.ai-strip \.card \+ \.card\s*\{[^}]*margin-left:\s*calc\(18px - var\(--game-card-width\)\)/s);
    expect(css).toMatch(/\.deal-animation-card\.card,[\s\S]*margin-left:\s*calc\(14px - var\(--game-card-width\)\)/s);
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*\.app\[data-view="game"\] \.played\s*\{[^}]*position:\s*relative/s);
  });

  it("keeps a canonical footprint at each accessibility setting", () => {
    expect(css).toMatch(/body\[data-font-size="large"\] \.app\[data-view="game"\]\s*\{[^}]*--game-card-width:\s*82px[^}]*--game-card-height:\s*116px/s);
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.app\[data-view="game"\]\s*\{[^}]*--game-card-width:\s*48px[^}]*--game-card-height:\s*76px/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*--game-card-width:\s*clamp\(64px,\s*19\.5vw,\s*76px\)[^}]*--game-card-height:\s*clamp\(91px,\s*27\.7vw,\s*108px\)/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*body\[data-font-size="x-large"\] \.app\[data-view="game"\] \.user-hand-meta\s*\{[^}]*display:\s*none/s);
  });
});
