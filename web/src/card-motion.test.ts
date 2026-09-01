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
    expect(mainSource).toMatch(/function cribFlightDestination[\s\S]*cribTrayStack\.getBoundingClientRect/s);
    expect(mainSource).toMatch(/source\.card\.animate\(\[[\s\S]*translate3d\(\$\{dx\}px, \$\{dy\}px/s);
    expect(css).toMatch(/\.crib-tray\[data-owner="ai"\][^}]*top:\s*18px/s);
    expect(css).toMatch(/\.crib-tray\[data-owner="human"\][^}]*bottom:/s);
    expect(css).toMatch(/\.crib-tray\[data-fill="partial"\][\s\S]*linear-gradient[\s\S]*#284f86/s);
  });

  it("keeps the full deal-cut deck in one stable 52-card ribbon", () => {
    expect(mainSource).toContain("const DEAL_CUT_CARD_COUNT = 52");
    expect(mainSource).toContain('els.app.dataset.dealCutActive = showingDealCut ? "true" : "false"');
    expect(mainSource).toContain('els.plays.classList.toggle("deal-cut-active", showingDealCut)');
    expect(css).toMatch(/\.deal-cut-spread\s*\{[^}]*grid-template-columns:\s*repeat\(52,/s);
    expect(css).toMatch(/@keyframes deal-cut-choice-lift[\s\S]*100% \{ opacity: 0\.18; transform: translateY\(0\)/s);
  });
});
