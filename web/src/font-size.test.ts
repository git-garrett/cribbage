// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("Extra Large accessibility typography", () => {
  it("is 25 percent larger than the previous 32px base size", () => {
    const blocks = [...css.matchAll(/body\[data-font-size="x-large"\]\s*\{([^}]*)\}/g)].map((match) => match[1]);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks.every((block) => /--app-font:\s*40px\s*;/.test(block))).toBe(true);
  });

  it("renders rank-over-suit tokens at the Extra Large copy size without a card chassis", () => {
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.card:not\(\.back\)\s*\{[^}]*display:\s*inline-grid/s);
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.card:not\(\.back\)\s*\{[^}]*border:\s*0\s*!important/s);
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.card:not\(\.back\)\s*\{[^}]*background:\s*transparent\s*!important/s);
    expect(css).toMatch(/body\[data-font-size="x-large"\][^{]*\.card \.rank[^{]*\{[^}]*font-size:\s*var\(--app-font\)/s);
    expect(css).toMatch(/body\[data-font-size="x-large"\][^{]*\.card \.suit[^{]*\{[^}]*font-size:\s*var\(--app-font\)/s);
  });

  it("keeps cut and pegging suits in the standard black and red palette", () => {
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.table \.card\.clubs,[^{]*\.table \.card\.spades\s*\{[^}]*color:\s*var\(--card-ink\)/s);
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.table \.card\.hearts,[^{]*\.table \.card\.diamonds\s*\{[^}]*color:\s*var\(--card-red\)/s);
  });

  it("hides prior rows and overflow cards only in the Extra Large mobile pegging stack", () => {
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*body\[data-font-size="x-large"\] #plays \.pegging-row\.played-archive[^{]*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*body\[data-font-size="x-large"\] #plays \.pegging-overflow-card[^{]*\{[^}]*display:\s*none/s);
  });

  it("removes nonessential table furniture at Extra Large", () => {
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.scoreboard \.board,[^{]*body\[data-font-size="x-large"\] \.ai-strip\s*\{[^}]*display:\s*none\s*!important/s);
  });

  it("removes status and notifications from Extra Large hand and crib scoring", () => {
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.app\[data-phase="score_pone"\] \.status,[^{]*body\[data-font-size="x-large"\] \.app\[data-phase="score_dealer"\] \.status,[^{]*body\[data-font-size="x-large"\] \.app\[data-phase="score_crib"\] \.status,[^{]*body\[data-font-size="x-large"\] \.app\[data-phase="score_pone"\] \.notification-row,[^{]*body\[data-font-size="x-large"\] \.app\[data-phase="score_dealer"\] \.notification-row,[^{]*body\[data-font-size="x-large"\] \.app\[data-phase="score_crib"\] \.notification-row\s*\{[^}]*display:\s*none/s);
  });

  it("skips shuffle, deal, and cut motion at Extra Large", () => {
    expect(mainSource).toMatch(/state\.animatedDealKeys\.add\(key\);\s*if \(state\.fontSize === "x-large"\) return;/s);
    expect(mainSource).toMatch(/function waitForTableMotion\(ms: number\)[^{]*\{\s*return waitMs\(state\.fontSize === "x-large" \? 0 : ms\);/s);
    expect(css).toMatch(/body\[data-font-size="x-large"\] \.deal-animation-card\.card,[^{]*body\[data-font-size="x-large"\] \.deal-cut-row \.cut-deck-cutting::after,[^{]*body\[data-font-size="x-large"\] \.pegging-row \.turn-cut-deck-cutting::after,[^{]*body\[data-font-size="x-large"\] \.played-active\.pegging-row \.turn-cut-deck-cutting::after,[^{]*body\[data-font-size="x-large"\] \.turn-card-reveal-animated \.card,[^{]*body\[data-font-size="x-large"\] \.cut-card-reveal \.card\s*\{[^}]*animation:\s*none\s*!important/s);
  });

  it("keeps enlarged mobile actions in document flow so they do not cover cards", () => {
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*body\[data-font-size="large"\] \.actions,[^{]*body\[data-font-size="x-large"\] \.actions\s*\{[^}]*position:\s*static/s);
  });

  it("keeps enlarged mobile settings reachable within the viewport", () => {
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*body\[data-font-size="large"\] \.settings-panel,[^{]*body\[data-font-size="x-large"\] \.settings-panel\s*\{[^}]*max-height:\s*calc\(100svh\s*-\s*142px\)[^}]*overflow-y:\s*auto/s);
  });

  it("uses Large rank-over-suit notation inside the card rectangle on mobile", () => {
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*body\[data-font-size="large"\] \.card:not\(\.back\)\s*\{[^}]*display:\s*inline-grid[^}]*grid-template-rows:\s*auto auto/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*body\[data-font-size="large"\] \.card \.corner\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*body\[data-font-size="large"\] \.card \.rank,[^{]*body\[data-font-size="large"\] \.card \.suit\s*\{[^}]*font-size:\s*var\(--app-font\)\s*!important/s);
  });
});

describe("Mobile notification layout", () => {
  it("places navigation at opposite edges above a full-width message", () => {
    expect(css).toMatch(/\.notification-row\s*\{[^}]*grid-template-columns:\s*var\(--notice-nav-size\) minmax\(0,\s*1fr\) var\(--notice-nav-size\)/s);
    expect(css).toMatch(/\.notice-back\s*\{[^}]*grid-column:\s*1/s);
    expect(css).toMatch(/\.notice-forward\s*\{[^}]*grid-column:\s*3/s);
    expect(css).toMatch(/\.notification-row > \.result\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*grid-row:\s*2/s);
  });
});

describe("Decision review layout", () => {
  it("gives the explanation a full row above a full-width action", () => {
    expect(css).toMatch(/\.decision-review-pending\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.decision-review-analyze\s*\{[^}]*width:\s*100%[^}]*white-space:\s*normal/s);
  });
});
