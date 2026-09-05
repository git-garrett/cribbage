// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("local pathway navigation", () => {
  it("offers the requested primary and sub-navigation choices", () => {
    expect(html).toContain('id="pathway-page"');
    expect(html).toContain('data-pathway-target="play"');
    expect(html).toContain('data-pathway-target="tutorial"');
    expect(html).toContain('id="pathway-statistics"');
    expect(html).toContain('data-pathway-target="settings"');
    for (const destination of [
      "human",
      "easy",
      "tough",
      "master",
      "grandmaster",
      "dynamic",
      "tutorial-beginner",
      "tutorial-intermediate",
      "tutorial-expert",
      "size",
      "gameplay",
      "sounds",
    ]) {
      expect(html).toContain(`data-pathway-destination="${destination}"`);
    }
    expect(html).toContain('id="dynamic-card-copy">Calibrate and get a handicap!</small>');
    expect(html).toContain("Find a Human Opponent");
    expect(html).toContain("Good for Learners");
    expect(html).toContain("Challenges Most Players");
    expect(html).toContain("Challenges the Best Players");
    expect(html).toContain("Better than Most Humans");
    expect(html).toContain("Expert Strategies");
    expect(html).toContain("←</span> Home");
  });

  it("uses the pathway language and grouping requested for the revised lobby", () => {
    expect(html).toContain("Play, learn, review your progress, or adjust settings.");
    expect(html).toContain("<strong>Training</strong>");
    expect(html).toContain("Whether you're a beginner or want strategies for mastering the game.");
    expect(html).toMatch(/data-pathway-target="tutorial"[\s\S]*?<strong>Training<\/strong>[\s\S]*?<em class="pathway-coming-soon">Coming soon<\/em>/);
    expect(html).toContain('<span class="pathway-card-kicker">Track your game</span>');
    expect(html).not.toContain("pathway-pill");
    expect(html).not.toContain('<i class="active"></i>');
    expect(html).not.toContain("Play thoughtfully.");
    expect(css).not.toContain(".pathway-footer");
    expect(css).not.toContain(".pathway-rail i.active");

    const easy = html.indexOf('data-pathway-destination="easy"');
    const tough = html.indexOf('data-pathway-destination="tough"');
    const master = html.indexOf('data-pathway-destination="master"');
    const human = html.indexOf('data-pathway-destination="human"');
    const dynamic = html.indexOf('data-pathway-destination="dynamic"');
    const grandmaster = html.indexOf('data-pathway-destination="grandmaster"');
    expect(easy).toBeGreaterThan(-1);
    expect(tough).toBeGreaterThan(easy);
    expect(master).toBeGreaterThan(tough);
    expect(human).toBeGreaterThan(master);
    expect(dynamic).toBeGreaterThan(human);
    expect(grandmaster).toBeGreaterThan(dynamic);
  });

  it("uses the pathway entry across web and mobile and connects Statistics to My Stats", () => {
    expect(source).toContain('const PATHWAY_NAV_ENABLED = SIMPLE_NETWORK_MODE');
    expect(source).toMatch(/pathwayStatistics\.addEventListener\("click"[\s\S]*navigatePathway\("statistics"\)/);
    expect(source).toMatch(/route === "statistics"[\s\S]*openAnalytics\("my"\)/);
    expect(source).toMatch(/analyticsClose\.addEventListener\("click"[\s\S]*showPathwayView\("home"\)/);
  });

  it("shares the parent link, centered logo, and online-pill header arrangement away from home", () => {
    expect(html).toMatch(/<header class="pathway-brandbar">[\s\S]*id="pathway-header-home"[\s\S]*class="pathway-logo"/);
    expect(css).toMatch(/\.pathway-brandbar\s*\{[^}]*grid-template-columns:\s*minmax\(58px, 1fr\) minmax\(0, auto\) minmax\(70px, 1fr\)[^}]*min-height:\s*68px/s);
    expect(css).toMatch(/\.pathway-logo\s*\{[^}]*grid-column:\s*2[^}]*width:\s*min\(168px, 43vw\)/s);
    expect(css).toMatch(/\.pathway-brandbar > \.people-presence\s*\{[^}]*grid-column:\s*3/s);
  });

  it("links both persistent logos to the pathway home", () => {
    expect(html).toMatch(/<a id="pathway-logo-home" class="pathway-logo" href="\/" aria-label="Strong Cribbage home">/);
    expect(html).toMatch(/<a id="app-brand-home" class="app-brand" href="\/" aria-label="Strong Cribbage home">/);
    expect(source).toMatch(/pathwayLogoHome\.addEventListener\("click"[\s\S]*navigatePathway\("home"\)/s);
    expect(source).toMatch(/appBrandHome\.addEventListener\("click"[\s\S]*leaveActivePathwayGame\("home"\)/s);
  });

  it("removes the redundant Home control on the app home and aligns logo left, online right", () => {
    expect(source).toContain("const parent = pathwayParentRoute(view)");
    expect(css).toMatch(/\.pathway-page\[data-view="home"\] \.pathway-brandbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, auto\) minmax\(70px, 1fr\)/s);
    expect(css).toMatch(/\.pathway-page\[data-view="home"\] \.pathway-logo\s*\{[^}]*grid-column:\s*1[^}]*justify-self:\s*start/s);
    expect(css).toMatch(/\.pathway-page\[data-view="home"\] \.pathway-brandbar > \.people-presence\s*\{[^}]*grid-column:\s*2/s);
  });

  it("keeps pathway navigation in browser history", () => {
    expect(source).toContain('const PATHWAY_VIEW_PARAM = "pathwayView"');
    expect(source).toContain("window.history.pushState(pathwayHistoryState(route), \"\", pathwayUrl(route))");
    expect(source).toMatch(/window\.addEventListener\("popstate"[\s\S]*applyPathwayRoute\(pathwayRouteFromLocation\(\)\)/);
    expect(source).toMatch(/pathwayStatsReturn[\s\S]*window\.history\.back\(\)/);
    expect(source).toMatch(/function openAnalytics[\s\S]*pushState\(pathwayHistoryState\("statistics"\)/);
  });

  it("provides responsive, keyboard-visible, reduced-motion-aware styling", () => {
    expect(css).toContain("--pathway-green: #0b5b43");
    expect(css).toContain("--pathway-navy: #071f38");
    expect(css).toMatch(/\.pathway-card:focus-visible/);
    expect(css).toMatch(/@media \(min-width: 960px\)[\s\S]*\.pathway-home/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("keeps Play stacked on mobile and uses separate AI and alternate desktop fans", () => {
    expect(html).toContain('class="pathway-choice-hands"');
    expect(html).toContain('class="pathway-choice-grid pathway-choice-grid-play pathway-choice-grid-play-ai" role="group" aria-label="AI opponents"');
    expect(html).toContain('class="pathway-choice-grid pathway-choice-grid-play pathway-choice-grid-play-secondary" role="group" aria-label="Other ways to play"');
    expect(html).toMatch(/data-pathway-destination="master"[\s\S]*?<\/button>\s*<\/div>\s*<div class="pathway-choice-grid pathway-choice-grid-play pathway-choice-grid-play-secondary"[\s\S]*data-pathway-destination="human"/);
    expect(css).toMatch(/\.pathway-primary-grid,\s*\.pathway-choice-grid\s*{[\s\S]*display: flex;[\s\S]*flex-direction: column/);
    expect(css).toMatch(/\.pathway-choice-grid-play\s*{[\s\S]*width: min\(100%, 620px\);[\s\S]*margin-right: auto;[\s\S]*margin-left: auto/);
    expect(css).toMatch(/@media \(min-width: 1000px\)[\s\S]*\.pathway-choice-hands\s*{[\s\S]*display: grid[\s\S]*width: min\(100%, 1040px\)[\s\S]*padding-bottom: 24px/s);
    expect(css).toMatch(/@media \(min-width: 1000px\)[\s\S]*\.pathway-choice-grid-play\s*{[\s\S]*flex-direction: row[\s\S]*min-height: 216px/s);
    expect(css).toMatch(/\.pathway-choice-grid-play > :nth-child\(1\)\s*{[\s\S]*--pathway-rest-rotate: -5\.5deg/s);
    expect(css).not.toContain("grid-auto-flow: column");
    expect(css).not.toContain("scroll-snap-type: inline mandatory");
  });

  it("keeps suit marks legible over the brass hover medallion", () => {
    expect(css).toContain("--pathway-suit-dark-rich: #101714");
    expect(css).toContain("--pathway-suit-red-rich: #a71927");
    expect(css).toMatch(/\.pathway-card:not\(:disabled\):hover::after,[\s\S]*background: radial-gradient\([\s\S]*color: var\(--pathway-suit-dark-rich\)/);
    expect(css).toMatch(/hover:nth-child\(4n \+ 2\)::after,[\s\S]*color: var\(--pathway-suit-red-rich\)/);
  });

  it("leads with playable opponents and marks future modes as unavailable", () => {
    for (const destination of [
      "grandmaster",
      "tutorial-beginner",
      "tutorial-intermediate",
      "tutorial-expert",
      "sounds",
    ]) {
      expect(html).toMatch(new RegExp(`data-pathway-destination="${destination}" disabled[\\s\\S]*?Coming soon`));
    }
    for (const destination of ["easy", "tough", "master", "dynamic", "human", "size", "gameplay"]) {
      expect(html).not.toMatch(new RegExp(`data-pathway-destination="${destination}" disabled`));
    }
    expect(css).toMatch(/\.pathway-choice:disabled\s*{[\s\S]*background: color-mix[\s\S]*cursor: not-allowed/);
    expect(css).toContain(".pathway-coming-soon");
  });

  it("highlights the active opponent card as a resumable seat", () => {
    expect(html.match(/class="pathway-resume-status" hidden>Resume<\/em>/g)).toHaveLength(5);
    expect(source).toContain("syncPathwayResumePresentation()");
    expect(source).toContain('button.classList.toggle("pathway-choice-resumable", active)');
    expect(css).toMatch(/@media \(min-width: 1000px\)[\s\S]*\.pathway-choice-grid-play \.pathway-resume-status\s*{[\s\S]*top: 50%;[\s\S]*right: 78px/s);
    expect(source).toMatch(/button\.dataset\.resumable === "true"[\s\S]*resumeGameFromSplash\(opponent\)/);
    expect(css).toMatch(/\.pathway-choice-resumable\s*\{[^}]*border-color:\s*var\(--pathway-gold-deep\)/s);
    expect(css).toMatch(/\.pathway-resume-status\s*\{[^}]*top:\s*18px[^}]*right:\s*20px[^}]*left:\s*auto/s);
  });

  it("shows Dynamic calibration status on the card and playing surface", () => {
    expect(html).toContain('id="dynamic-calibration-status"');
    expect(html).toContain("<strong>CALIBRATING</strong>");
    expect(html).toContain('id="dynamic-calibration-handicap"');
    expect(source).toContain("function renderDynamicCalibrationStatus");
    expect(source).toContain("dynamicCardCopy(calibration, hasStartedGame)");
    expect(css).toContain(".dynamic-calibration-status");
    expect(css).toContain('#dynamic-card-copy[data-state="calibrating"]');
  });

  it("requires an account for Statistics, human games, Ace, and Dynamic", () => {
    expect(html.match(/Sign in required/g)).toHaveLength(4);
    expect(source).toMatch(/opponent === DEFAULT_OPPONENT && !authenticatedUser[\s\S]*kind: "master"/);
    expect(source).toMatch(/opponent === PATHWAY_OPPONENTS\.dynamic && !authenticatedUser[\s\S]*kind: "dynamic"/);
    expect(source).toMatch(/destination === "human"[\s\S]*kind: "human"/);
    expect(source).toMatch(/pathwayStatistics\.addEventListener\("click"[\s\S]*kind: "statistics"/);
  });

  it("protects an active Ace game when leaving its table, not when choosing the next opponent", () => {
    expect(html).toContain('id="master-session-dialog"');
    expect(html).toContain('id="master-session-save"');
    expect(html).toContain('id="master-session-forfeit"');
    expect(source).toMatch(/appBack\.addEventListener\("click"[\s\S]*leaveActivePathwayGame\("play"\)/);
    expect(source).toMatch(/function leaveActivePathwayGame[\s\S]*currentSnapshot\?\.opponent === DEFAULT_OPPONENT[\s\S]*masterSessionDialog\.hidden = false/);
    expect(source).not.toMatch(/function launchPathwayOpponent[\s\S]*findRemoteActiveGameSession\(DEFAULT_OPPONENT\)[\s\S]*function dismissMasterSessionDialog/);
    expect(source).toMatch(/function suspendActiveGameForPathway[\s\S]*state\.pending = false[\s\S]*resetTransientGameUi\(\)/);
    expect(source).toContain('action: "forfeit"');
    expect(source).toMatch(/function clearForfeitedLocalGame[\s\S]*safeLocalStorageRemove\(SAVE_KEY\)/);
    expect(css).toContain(".master-session-dialog");
  });

  it("keeps Play Now blocking dialogs above the pathway surface", () => {
    const pathwayZ = Number(css.match(/\.pathway-page\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
    const sessionDialogZ = Number(css.match(/\.master-session-dialog\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
    const serverBusyZ = Number(css.match(/\.server-busy-alert\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
    expect(sessionDialogZ).toBeGreaterThan(pathwayZ);
    expect(serverBusyZ).toBeGreaterThan(pathwayZ);
  });

  it("opens a persistent accessibility size chooser from Settings", () => {
    expect(html).toContain('id="size-dialog"');
    for (const size of ["normal", "large", "x-large"]) {
      expect(html).toContain(`name="pathway-size" value="${size}"`);
    }
    expect(source).toMatch(/destination === "size"[\s\S]*openSizeDialog/);
    expect(source).toContain('safeLocalStorageSet(FONT_SIZE_STORAGE_KEY, state.fontSize)');
    expect(source).toContain('"/api/people/preferences"');
    expect(css).toContain('body[data-font-size="large"]');
    expect(css).toContain('body[data-font-size="x-large"]');
  });

  it("opens Gameplay as a history-backed Settings subpage", () => {
    expect(html).toContain('data-pathway-view="gameplay"');
    expect(html).toContain('data-pathway-back="settings"');
    expect(source).toMatch(/destination === "gameplay"[\s\S]*navigatePathway\("gameplay"\)/);
    expect(source).toMatch(/dataset\.pathwayBack[\s\S]*pathwayParentRoute\(view\)[\s\S]*"home"/);
  });

  it("links every view to its immediate parent in the pathway hierarchy", () => {
    expect(html).toMatch(/id="pathway-header-parent-label"[^>]*>Home<\/span>/);
    expect(html).toMatch(/data-pathway-view="human"[\s\S]*?data-pathway-back="play"[\s\S]*?←<\/span> Play/);
    expect(html).toMatch(/id="app-back"[\s\S]*?←<\/span> Play/);
    expect(source).toMatch(/function pathwayParentRoute[\s\S]*route === "human"[\s\S]*return "play"[\s\S]*route === "gameplay"[\s\S]*return "settings"/);
    expect(source).toMatch(/pathwayHeaderHome\.addEventListener[\s\S]*pathwayParentRoute/);
  });

  it("uses a restrained staggered deal with an explicit reduced-motion fallback", () => {
    expect(css).toMatch(/@keyframes pathway-card-deal[\s\S]*translate: 0 34px;[\s\S]*translate: 0 0/);
    expect(css).toMatch(/nth-child\(6\)[\s\S]*animation-delay: 220ms/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important/);
    expect(css).not.toContain("pathway-card-slide-in");
  });

  it("gives every enabled pathway card the same gentle relative tilt", () => {
    expect(css).not.toContain("@keyframes pathway-card-rock");
    expect(css).toMatch(/\.pathway-card:not\(:disabled\):hover,[\s\S]*\.pathway-choice:not\(:disabled\):hover[\s\S]*calc\(var\(--pathway-rest-y\) - 5px\)[\s\S]*rotate: var\(--pathway-hover-rotate\)/);
    expect(css).toMatch(/\.pathway-primary-grid > \.pathway-card,[\s\S]*\.pathway-choice-grid:not\(\.pathway-choice-grid-play\) > \.pathway-choice[\s\S]*translateY\(var\(--pathway-rest-y\)\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.pathway-card:not\(:disabled\):hover,[\s\S]*animation: none/);
    expect(css).toMatch(/\.pathway-choice-human\s*{[\s\S]*var\(--pathway-featured\)[\s\S]*color: var\(--pathway-ivory\)/);
  });

  it("uses one CSS transition owner for an uninterrupted card return", () => {
    expect(source).not.toContain("pathwayMotionPoses");
    expect(source).not.toContain("easePathwayCardExit");
    expect(css).not.toContain("pathway-card-returning");
    expect(css).toMatch(/\.pathway-card,[\s\S]*\.pathway-choice\s*{[\s\S]*transform 900ms cubic-bezier\(0\.18, 0\.72, 0\.24, 1\),[\s\S]*rotate 1080ms cubic-bezier\(0\.18, 0\.72, 0\.24, 1\)/);
    expect(css).toMatch(/\.pathway-card:not\(:disabled\):hover,[\s\S]*rotate: var\(--pathway-hover-rotate\)[\s\S]*transition:[\s\S]*transform 600ms cubic-bezier\(0\.16, 0\.74, 0\.24, 1\),[\s\S]*rotate 720ms cubic-bezier\(0\.16, 0\.74, 0\.24, 1\)/);
  });

  it("keeps the default Play and Easy choices neutral and scales Home with accessibility text size", () => {
    expect(html).toContain('<button class="pathway-card" type="button" data-pathway-target="play">');
    expect(html).not.toContain('<button class="pathway-card pathway-card-featured" type="button" data-pathway-target="play">');
    expect(html).toContain('<button class="pathway-choice" type="button" data-pathway-destination="easy">');
    expect(html).not.toContain('<button class="pathway-choice pathway-choice-featured" type="button" data-pathway-destination="easy">');
    expect(css).toMatch(/\.pathway-back\s*{[\s\S]*min-height: max\(38px, calc\(var\(--access-body\) \* 2\.35\)\)[\s\S]*font-size: var\(--access-body\)/);
    expect(css).toMatch(/\.pathway-back span\s*{\s*font-size: 1\.2em/);
  });

  it("has no development-only pathway variant switcher in the production entry", () => {
    expect(html).not.toContain("pathway-prototype");
    expect(css).not.toContain("pathway-prototype");
    expect(source).not.toContain("pathway-prototype");
  });
});
