// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("Concept B mobile playing UI", () => {
  it("shows the live provisional handicap below the Dynamic calibration marker", () => {
    expect(html).toMatch(/id="dynamic-calibration-status"[^>]*>[\s\S]*<strong>CALIBRATING<\/strong>[\s\S]*id="dynamic-calibration-handicap"/s);
    expect(mainSource).toContain("dynamicProvisionalHandicapCopy(calibration)");
    expect(css).toMatch(/\.dynamic-calibration-status\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*order:\s*3[^}]*display:\s*grid[^}]*justify-items:\s*center/s);
    expect(css).toMatch(/\.dynamic-calibration-status span\s*\{[^}]*white-space:\s*nowrap/s);
  });

  it("does not surface an AI-thinking bubble during normal play", () => {
    expect(mainSource).toContain("els.modelThinking.hidden = !showModelLoadingUi");
    expect(mainSource).toContain("els.thinkingOverlay.hidden = !showModelLoadingUi");
    expect(mainSource).not.toContain("els.thinkingOverlay.hidden = !state.aiThinking");
  });

  it("uses the scalable dark lockup and a pathway-style parent control in the header", () => {
    expect(html).toMatch(/class="app-brand-logo" src="\/brand\/strong-cribbage-lockup-dark\.svg"/);
    expect(html).toMatch(/<picture class="splash-logo">[\s\S]*?lockup-dark\.svg[\s\S]*?lockup-light\.svg[\s\S]*?<\/picture>/);
    expect(html).toMatch(/id="app-back" class="pathway-back app-back"/);
    expect(html).not.toMatch(/id="hand-number"/);
    expect(html).not.toMatch(/id="new-game"/);
    expect(mainSource).toMatch(/els\.appBack\.addEventListener\("click", \(\) => \{[\s\S]*leaveActivePathwayGame\("play"\)/);
  });

  it("moves the text-size selector inside the hamburger menu", () => {
    expect(html).toMatch(/id="settings-panel"[^>]*>[\s\S]*class="font-size-control"[\s\S]*id="font-size-select"/);
  });

  it("uses the circular track for normal mobile without changing the desktop lanes", () => {
    expect(css).toMatch(/body\[data-font-size="normal"\] \.board > \.lane\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/body\[data-font-size="normal"\] \.circular-board\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.circular-board\s*\{[^}]*display:\s*none/s);
  });

  it("keeps a disabled play prompt visible until a card is selected, then names that card", () => {
    const visibilityRule = mainSource.match(/els\.play\.hidden = ([^;]*);/)?.[1] ?? "";
    expect(visibilityRule).toContain('game.phase === "pegging"');
    expect(visibilityRule).toContain('game.turn === "User"');
    expect(visibilityRule).not.toContain("selectedPlay");
    expect(mainSource).toMatch(/els\.play\.disabled = [^;]*game\.phase === "pegging"[^;]*game\.turn === "User" && selectedPlay/);
    expect(mainSource).toMatch(/els\.play\.textContent = selectedPlay \? `Play \$\{selectedPlay\.rank\}\$\{selectedPlay\.symbol\}` : "Play selected"/);
  });

  it("keeps a player's hand above an overlapping crib tray", () => {
    expect(css).toMatch(/\.app\[data-view="game"\] \.user-panel\s*\{[^}]*position:\s*relative[^}]*z-index:\s*8/s);
    expect(css).toMatch(/\.crib-tray\s*\{[^}]*z-index:\s*7/s);
  });

  it("anchors a miniature, captioned crib below its dealer marker on mobile", () => {
    expect(html).toMatch(/id="human-score-panel" class="score"/);
    expect(html).toMatch(/id="ai-score-panel" class="score ai"/);
    expect(mainSource).toContain('humanScorePanel: document.querySelector("#human-score-panel")');
    expect(mainSource).toContain('aiScorePanel: document.querySelector("#ai-score-panel")');
    expect(mainSource).toMatch(/const cribParent = usesMobileGameplayLayout\(\)[\s\S]*game\.cribOwner === "User" \? els\.humanScorePanel : els\.aiScorePanel/s);
    expect(css).toMatch(/\.score > \.crib-tray\s*\{[^}]*top:\s*calc\(100% \+ var\(--score-meta-small-font\) \+ 20px\)[^}]*z-index:\s*4/s);
    expect(css).toMatch(/#human-score-panel > \.crib-tray\s*\{[^}]*left:\s*0/s);
    expect(css).toMatch(/\.score\.ai > \.crib-tray\s*\{[^}]*right:\s*0/s);
    expect(css).toMatch(/\.score > \.crib-tray \.crib-tray-stack\s*\{[^}]*width:\s*22px[^}]*height:\s*32px/s);
    expect(css).toMatch(/\.score > \.crib-tray,[\s\S]*flex-direction:\s*column-reverse/s);
    expect(mainSource).toMatch(/function cribFlightDestination\(\)[\s\S]*els\.cribTrayStack\.getBoundingClientRect\(\)/);
  });

  it("balances the mobile cut card between the viewport and track until space forces overlap", () => {
    expect(mainSource).toMatch(/const cutParent = usesMobileGameplayLayout\(\) \? els\.scoreboard : els\.played;/);
    expect(css).toMatch(/\.scoreboard > \.board\s*\{[^}]*z-index:\s*2/s);
    expect(css).toMatch(/\.scoreboard > \.score-cut\s*\{[^}]*left:\s*max\(8px, calc\(25% - var\(--game-track-half-radius\) - 24\.5px\)\)[^}]*z-index:\s*1[^}]*width:\s*49px[^}]*height:\s*70px/s);
    expect(css).toMatch(/\.scoreboard > \.score-cut > span:first-child\s*\{[^}]*grid-row:\s*2/s);
    expect(css).toMatch(/body\[data-font-size="normal"\][\s\S]*\.scoreboard > \.score-cut \.card:not\(\.back\)[\s\S]*grid-template-rows:\s*auto auto[\s\S]*align-content:\s*center/s);
  });

  it("balances labeled Hint and Error medallions to the right of the track", () => {
    expect(html).toMatch(/id="ask-master"[\s\S]*board-tool-symbol[^>]*>\?<[^]*board-tool-label[^>]*>Hint</);
    expect(html).toMatch(/id="ace-mistake"[\s\S]*board-tool-symbol[^>]*>!<[^]*board-tool-label[^>]*>Error</);
    expect(mainSource).toContain("const hintParent = usesMobileGameplayLayout() ? els.aceTools : els.actions;");
    expect(mainSource).toContain("const mistakeParent = isDiscardMistakeOnTurnCut()");
    expect(mainSource).toContain(": usesMobileGameplayLayout() ? els.aceTools : els.scoreCut;");
    expect(css).toMatch(/\.scoreboard > \.ace-tools\s*\{[^}]*right:\s*max\(8px, calc\(25% - var\(--game-track-half-radius\) - 24\.5px\)\)[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.scoreboard > \.board\s*\{[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.scoreboard > \.ace-tools \.board-tool-symbol\s*\{[^}]*width:\s*var\(--board-tool-size\)[^}]*border-radius:\s*50%/s);
    expect(css).toMatch(/body\[data-font-size="x-large"\][^{]*\.scoreboard > \.ace-tools\s*\{[^}]*top:\s*calc\(var\(--game-score-size\) \+ 83px\)/s);
  });

  it("mirrors the mobile score alignment at the outside edges", () => {
    expect(css).toMatch(/#human-score-panel\s*\{[^}]*justify-self:\s*stretch[^}]*justify-items:\s*start[^}]*text-align:\s*left/s);
    expect(css).toMatch(/\.score\.ai\s*\{[^}]*justify-self:\s*stretch[^}]*justify-items:\s*end[^}]*text-align:\s*right/s);
  });

  it("uses a separate Crib marker while leaving the dealer names unpossessive", () => {
    expect(html).toMatch(/id="human-name" class="player-name">Player<\/span><\/span>\s*<span id="human-dealer" class="dealer-button score-crib-marker"/s);
    expect(html).toMatch(/id="ai-name" class="player-name">Ace<\/span><\/span>\s*<span id="ai-dealer" class="dealer-button score-crib-marker"/s);
    expect(mainSource).toContain("setPlayerIdentity(els.humanName, playerDisplayName());");
    expect(mainSource).toContain('els.aiName.textContent = playerName("ai");');
    expect(css).toMatch(/\.app\[data-view="game"\] \.score-crib-marker\s*\{[^}]*position:\s*absolute[^}]*top:\s*calc\(100% \+ 9px\)/s);
    expect(css).toMatch(/#human-score-panel > \.score-crib-marker\s*\{[^}]*left:\s*0/s);
    expect(css).toMatch(/\.score\.ai > \.score-crib-marker\s*\{[^}]*right:\s*0/s);
  });

  it("never exposes an uninitialized gameplay shell behind navigation", () => {
    expect(css).toMatch(/\.app:not\(\[data-phase\]\) > \.scoreboard,[\s\S]*\.app:not\(\[data-phase\]\) > \.table\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/\.pathway-page:not\(\[hidden\]\) ~ \.app,[\s\S]*\.human-table-page:not\(\[hidden\]\) ~ \.app\s*\{[^}]*display:\s*none/s);
  });

  it("uses one centered header system for pathway and gameplay views", () => {
    expect(html).toMatch(/id="pathway-header-home"[^>]*>[\s\S]*Home/);
    expect(html).toMatch(/id="mobile-header-reveal"[^>]*aria-label="Show navigation"/);
    expect(mainSource).toMatch(/function syncMobileGameplayHeaderPlacement\(\)[\s\S]*els\.topbar\.append\(els\.peoplePresence\)[\s\S]*els\.pathwayBrandbar\.append\(els\.peoplePresence\)/s);
    expect(mainSource).toMatch(/function showMobileGameplayHeader\([\s\S]*scheduleMobileGameplayHeaderHide/s);
    expect(mainSource).toMatch(/mobileHeaderTouchStartY = touch\.clientY;[\s\S]*touch\.clientY - mobileHeaderTouchStartY >= 46/s);
    expect(mainSource).not.toMatch(/touch\.clientY <= 42/);
    expect(css).toMatch(/\.app\[data-view="game"\] > \.topbar\s*\{[^}]*position:\s*fixed[^}]*grid-template-columns:\s*minmax\(58px, 1fr\) minmax\(0, auto\) minmax\(70px, 1fr\)[^}]*min-height:\s*68px/s);
    expect(css).toMatch(/\.app-back\s*\{[^}]*grid-column:\s*1/s);
    expect(css).toMatch(/\.app-brand\s*\{[^}]*grid-column:\s*2/s);
    expect(css).toMatch(/\.people-presence\s*\{[^}]*grid-column:\s*3/s);
    expect(css).toMatch(/\.mobile-game-header-hidden\s*\{[^}]*translateY\(-100%\)/s);
    expect(css).toMatch(/\.mobile-header-reveal\s*\{[^}]*position:\s*absolute[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.mobile-game-header-hidden \.mobile-header-reveal\s*\{[^}]*pointer-events:\s*auto/s);
    expect(css).not.toMatch(/mobile-game-header-active[^{]*\.people-presence-pegs\s*\{[^}]*display:\s*none/s);
  });

  it("drops the redundant dealer and opponent-card metadata on mobile", () => {
    expect(mainSource).toMatch(/const showHandMeta = !usesMobileGameplayLayout\(\) &&/);
  });

  it("keeps mobile pegging cards in one overlapped ownership ribbon", () => {
    expect(css).toMatch(/#plays \.played-active\.pegging-row\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.played-active\.pegging-row \.pegging-overflow-card\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/\.played-active\.pegging-row \.card\s*\{[^}]*width:\s*48px\s*!important[^}]*height:\s*68px\s*!important[^}]*margin-left:\s*-26px\s*!important/s);
    expect(css).toMatch(/\.card\[data-owner="human"\]\s*\{[^}]*translateY\(7px\)/s);
    expect(css).toMatch(/\.card\[data-owner="ai"\]\s*\{[^}]*translateY\(-7px\)/s);
    expect(css).toMatch(/\.played-active\.pegging-row \.card \.corner\s*\{[^}]*display:\s*grid\s*!important/s);
    expect(mainSource).toMatch(/for \(const \[index, card\] of compact\.visible\.entries\(\)\)[\s\S]*index === compact\.visible\.length - 1[\s\S]*"pegging-card-exposed"[\s\S]*"pegging-card-covered"/s);
    expect(css).toMatch(/\.card\.pegging-card-exposed:not\(\.back\)[\s\S]*grid-template-rows:\s*auto auto[\s\S]*align-content:\s*center/s);
    expect(css).toMatch(/\.card\.pegging-card-exposed > \.rank,[\s\S]*display:\s*block !important/s);
  });

  it("does not clip a lifted discard card at the top of the play area", () => {
    expect(css).toMatch(/\.app\[data-view="game"\] #plays\s*\{[^}]*overflow:\s*visible/s);
  });

  it("does not render an empty result box beneath counted cards", () => {
    expect(html).not.toContain('id="scoring-result"');
    expect(mainSource).not.toContain("scoringResult:");
  });
});
