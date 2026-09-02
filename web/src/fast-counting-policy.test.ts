// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldAnimateScoringCards, shouldShowScoreBubble } from "./fast-counting-policy";

const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("fast counting", () => {
  it("skips hand and crib bubbles without suppressing pegging feedback", () => {
    expect(shouldShowScoreBubble(true, "hand")).toBe(false);
    expect(shouldShowScoreBubble(true, "crib")).toBe(false);
    expect(shouldShowScoreBubble(true, "pegging")).toBe(true);
    expect(shouldShowScoreBubble(false, "hand")).toBe(true);
  });

  it("disables scoring-card transitions whenever fast counting is enabled", () => {
    expect(shouldAnimateScoringCards(true, false)).toBe(false);
    expect(shouldAnimateScoringCards(false, true)).toBe(false);
    expect(shouldAnimateScoringCards(false, false)).toBe(true);
  });

  it("persists an accessible Gameplay setting and opens summaries directly", () => {
    expect(htmlSource).toContain('class="pathway-settings-card"');
    expect(htmlSource).toContain('id="fast-counting"');
    expect(htmlSource).toContain('role="switch"');
    expect(mainSource).toContain("FAST_COUNTING_STORAGE_KEY");
    expect(mainSource).toContain("shouldShowScoreBubble(state.fastCounting, event.category)");
    expect(mainSource).toContain("if (state.fastCounting) return;");
  });
});
