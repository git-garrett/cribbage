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

  it("renders card ranks and suits at the same size as Extra Large text on mobile", () => {
    expect(css).toMatch(/body\[data-font-size="x-large"\][^{]*\.card \.rank[^{]*\{[^}]*font-size:\s*var\(--app-font\)/s);
    expect(css).toMatch(/body\[data-font-size="x-large"\][^{]*\.card \.suit[^{]*\{[^}]*font-size:\s*var\(--app-font\)/s);
  });
});
