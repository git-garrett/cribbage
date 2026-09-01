// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("physical card motion", () => {
  it("deals from the deck to alternating pone and dealer destinations", () => {
    expect(mainSource).toMatch(/const poneOrder = index \* 2;[\s\S]*const dealerOrder = poneOrder \+ 1;/s);
    expect(mainSource).toMatch(/--deal-from-x[\s\S]*--deal-from-y[\s\S]*deal-animation-ready/s);
    expect(css).toMatch(/\.deal-animation-ready \.deal-animation-card\.card[\s\S]*animation:\s*deal-card-travel 500ms/s);
    expect(css).toMatch(/@keyframes deal-card-travel[\s\S]*translate\(var\(--deal-from-x\), var\(--deal-from-y\)\)[\s\S]*translate\(0, 0\)/s);
  });

  it("flies both player and opponent discards into the crib", () => {
    expect(mainSource).toMatch(/playDiscardToCribAnimation\(state\.game, "human", selectedIds\)/);
    expect(mainSource).toMatch(/playDiscardToCribAnimation\(optimisticNext, "ai"\)/);
    expect(mainSource).toMatch(/function cribFlightDestination[\s\S]*\.circular-board-core/s);
    expect(mainSource).toMatch(/source\.card\.animate\(\[[\s\S]*translate3d\(\$\{dx\}px, \$\{dy\}px/s);
    expect(css).toMatch(/\.discard-crib-stack\s*\{[^}]*linear-gradient[\s\S]*#284f86/s);
  });
});
