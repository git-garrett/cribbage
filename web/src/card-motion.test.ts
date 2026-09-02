// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("physical card motion", () => {
  it("deals from the deck to alternating opponent-upper-left and player-lower-left destinations", () => {
    expect(mainSource).toMatch(/const poneOrder = index \* 2;[\s\S]*const dealerOrder = poneOrder \+ 1;/s);
    expect(mainSource).toContain('pone.dataset.owner = state.dealAnimation.pone === "AI" ? "ai" : "human"');
    expect(mainSource).toContain('dealer.dataset.owner = state.dealAnimation.dealer === "AI" ? "ai" : "human"');
    expect(mainSource).toContain('els.app.dataset.dealAnimationActive = state.dealAnimation ? "true" : "false"');
    expect(mainSource).toMatch(/--deal-from-x[\s\S]*--deal-from-y[\s\S]*deal-animation-ready/s);
    expect(mainSource).toMatch(/closest<HTMLElement>\("\.deal-animation-hand"\)\?\.dataset\.owner[\s\S]*owner === "ai" \? -1 : 1/s);
    expect(css).toMatch(/\.deal-animation\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.deal-animation\s*\{[^}]*justify-items:\s*start/s);
    expect(css).toMatch(/\.deal-animation-deck\s*\{[^}]*justify-self:\s*center/s);
    expect(css).toMatch(/\.deal-animation-hand\s*\{[^}]*justify-content:\s*flex-start[^}]*justify-self:\s*start/s);
    expect(css).toMatch(/\.deal-animation-hand\[data-owner="ai"\]\s*\{[^}]*grid-row:\s*1/s);
    expect(css).toMatch(/\.deal-animation-hand\[data-owner="human"\]\s*\{[^}]*grid-row:\s*3/s);
    expect(css).not.toMatch(/\.deal-animation-pone\s*\{[^}]*grid-column:\s*1/s);
    expect(css).not.toMatch(/\.deal-animation-dealer\s*\{[^}]*grid-column:\s*3/s);
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

  it("lifts a full-size top packet and flips the turn card from the lower deck", () => {
    expect(css).toMatch(/\.pegging-row \.turn-cut-deck-cutting::after,[\s\S]*height:\s*calc\(100% \+ 2px\)/s);
    expect(css).toMatch(/@keyframes deck-cut-slide[\s\S]*translate3d\(-38%, -24%, 0\) rotate\(-6deg\)/s);
    expect(mainSource).toMatch(/function prepareTurnCardReveal[\s\S]*deckRect\.bottom - cardRect\.bottom[\s\S]*turn-card-reveal-ready/s);
    expect(css).toMatch(/\.turn-card-reveal-animated \.card[^}]*transform-origin:\s*center bottom/s);
    expect(css).toMatch(/@keyframes turn-card-from-bottom[\s\S]*var\(--turn-card-from-x\)[\s\S]*rotateX\(-88deg\)[\s\S]*rotateX\(0deg\)/s);
  });
});
