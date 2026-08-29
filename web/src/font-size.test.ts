// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

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
});
