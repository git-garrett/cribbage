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
      "sounds",
    ]) {
      expect(html).toContain(`data-pathway-destination="${destination}"`);
    }
    expect(html).toContain("Adapts to your play and plays back at your skill.");
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

  it("keeps pathway navigation in browser history", () => {
    expect(source).toContain('const PATHWAY_VIEW_PARAM = "pathwayView"');
    expect(source).toContain("window.history.pushState(pathwayHistoryState(route), \"\", pathwayUrl(route))");
    expect(source).toMatch(/window\.addEventListener\("popstate"[\s\S]*applyPathwayRoute\(pathwayRouteFromLocation\(\)\)/);
    expect(source).toMatch(/pathwayStatsReturn[\s\S]*window\.history\.back\(\)/);
  });

  it("provides responsive, keyboard-visible, reduced-motion-aware styling", () => {
    expect(css).toContain("--pathway-green: #0b5b43");
    expect(css).toContain("--pathway-navy: #071f38");
    expect(css).toMatch(/\.pathway-card:focus-visible/);
    expect(css).toMatch(/@media \(min-width: 960px\)[\s\S]*\.pathway-home/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("keeps the dense Play hand swipeable on touch and fully visible without swiping elsewhere", () => {
    expect(html).toContain('class="pathway-choice-grid pathway-choice-grid-play" tabindex="0" role="group" aria-label="Play options"');
    expect(css).toMatch(/\.pathway-choice-grid:not\(\.pathway-choice-grid-play\)\s*{[\s\S]*flex-direction: column/);
    expect(css).toMatch(/\.pathway-choice-grid-play\s*{[\s\S]*grid-auto-flow: column;[\s\S]*overflow-x: auto;[\s\S]*scroll-snap-type: inline mandatory/);
    expect(css).toMatch(/\.pathway-choice-grid-play \.pathway-choice\s*{[\s\S]*scroll-snap-align: start/);
    expect(css).toMatch(/@media \(min-width: 600px\) and \(max-width: 849px\)[\s\S]*grid-auto-columns: min\(39vw, 300px\)/);
    expect(css).toMatch(/@media \(min-width: 850px\), \(any-hover: hover\) and \(any-pointer: fine\)[\s\S]*grid-auto-flow: row;[\s\S]*overflow: visible;[\s\S]*scroll-snap-type: none/);
    expect(css).toMatch(/@media \(min-width: 720px\) and \(any-hover: hover\) and \(any-pointer: fine\),[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).not.toMatch(/@media \(min-width: 1180px\)[\s\S]*grid-template-columns: repeat\(6/);
    expect(source).toMatch(/pathwayView\.dataset\.pathwayView === view[\s\S]*\.pathway-choice-grid[\s\S]*scrollTo\(\{ left: 0 \}\)/);
  });

  it("keeps suit marks legible over the brass hover medallion", () => {
    expect(css).toContain("--pathway-suit-dark-rich: #101714");
    expect(css).toContain("--pathway-suit-red-rich: #a71927");
    expect(css).toMatch(/\.pathway-card:not\(:disabled\):hover::after,[\s\S]*background: radial-gradient\([\s\S]*color: var\(--pathway-suit-dark-rich\)/);
    expect(css).toMatch(/hover:nth-child\(4n \+ 2\)::after,[\s\S]*color: var\(--pathway-suit-red-rich\)/);
  });

  it("leads with playable opponents and marks future modes as unavailable", () => {
    for (const destination of [
      "dynamic",
      "grandmaster",
      "tutorial-beginner",
      "tutorial-intermediate",
      "tutorial-expert",
      "sounds",
    ]) {
      expect(html).toMatch(new RegExp(`data-pathway-destination="${destination}" disabled[\\s\\S]*?Coming soon`));
    }
    for (const destination of ["easy", "tough", "master", "human", "size"]) {
      expect(html).not.toMatch(new RegExp(`data-pathway-destination="${destination}" disabled`));
    }
    expect(css).toMatch(/\.pathway-choice:disabled\s*{[\s\S]*background: color-mix[\s\S]*cursor: not-allowed/);
    expect(css).toContain(".pathway-coming-soon");
  });

  it("requires an account for Statistics, human games, and Master", () => {
    expect(html.match(/Sign in required/g)).toHaveLength(3);
    expect(source).toMatch(/opponent === DEFAULT_OPPONENT && !authenticatedUser[\s\S]*kind: "master"/);
    expect(source).toMatch(/destination === "human"[\s\S]*kind: "human"/);
    expect(source).toMatch(/pathwayStatistics\.addEventListener\("click"[\s\S]*kind: "statistics"/);
  });

  it("protects a saved Master game before switching to a lower opponent", () => {
    expect(html).toContain('id="master-session-dialog"');
    expect(html).toContain('id="master-session-save"');
    expect(html).toContain('id="master-session-forfeit"');
    expect(source).toContain("function findRemoteActiveGameSession");
    expect(source).toMatch(/opponent !== DEFAULT_OPPONENT[\s\S]*findRemoteActiveGameSession\(DEFAULT_OPPONENT\)/);
    expect(source).toContain('action: "forfeit"');
    expect(source).toContain("allowActiveReplacement: true");
    expect(css).toContain(".master-session-dialog");
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
