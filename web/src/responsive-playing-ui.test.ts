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
    expect(css).toMatch(/@media \(min-width:\s*960px\)[\s\S]*grid-template-columns:\s*minmax\(380px/);
  });

  it("keeps large cards rectangular and simplified at every width", () => {
    expect(css).toMatch(/body\[data-font-size="large"\] \.app\[data-view="game"\] \.card:not\(\.back\)/);
    expect(css).toMatch(/body\[data-font-size="large"\] \.app\[data-view="game"\] \.card \.corner\s*\{\s*display:\s*none/);
  });

  it("keeps the AI hand hidden at x-large and saves space during hand counting", () => {
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.app\[data-view="game"\] \.ai-strip\s*\{\s*display:\s*none\s*!important/);
    expect(css).toMatch(/data-phase="score_crib"[\s\S]*> \.scoreboard > \.board\s*\{\s*display:\s*none\s*!important/);
  });

  it("uses one central phase directive instead of repeating setup instructions", () => {
    expect(css).toMatch(/\.app\[data-view="game"\] \.played > h2\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.app\[data-view="game"\] \.turn-cut-label\s*\{\s*display:\s*none/);
    expect(css).toMatch(/data-phase="cut_for_deal"[^,]*\.notification-row,[\s\S]*data-phase="ai_discarding"[^\{]*\{\s*display:\s*none/);
  });
});
