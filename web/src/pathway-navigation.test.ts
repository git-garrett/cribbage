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
    expect(html).not.toContain("The clubhouse");
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

  it("keeps the pathway entry local and connects Statistics to My Stats", () => {
    expect(source).toContain('const PATHWAY_NAV_ENABLED = LOCAL_NETWORK_MODE');
    expect(source).toMatch(/pathwayStatistics\.addEventListener\("click"[\s\S]*openAnalytics\("my"\)/);
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

  it("keeps the dense Play hand swipeable while sparse hands remain fully visible", () => {
    expect(html).toContain('class="pathway-choice-grid pathway-choice-grid-play" tabindex="0" role="group" aria-label="Play options"');
    expect(css).toMatch(/\.pathway-choice-grid:not\(\.pathway-choice-grid-play\)\s*{[\s\S]*flex-direction: column/);
    expect(css).toMatch(/\.pathway-choice-grid-play\s*{[\s\S]*grid-auto-flow: column;[\s\S]*overflow-x: auto;[\s\S]*scroll-snap-type: inline mandatory/);
    expect(css).toMatch(/\.pathway-choice-grid-play \.pathway-choice\s*{[\s\S]*scroll-snap-align: start/);
    expect(css).toMatch(/@media \(min-width: 600px\) and \(max-width: 849px\)[\s\S]*grid-auto-columns: min\(39vw, 300px\)/);
    expect(css).toMatch(/@media \(min-width: 850px\)[\s\S]*grid-auto-columns: clamp\(245px, 27%, 305px\)/);
    expect(source).toMatch(/pathwayView\.dataset\.pathwayView === view[\s\S]*\.pathway-choice-grid[\s\S]*scrollTo\(\{ left: 0 \}\)/);
  });

  it("leads with playable opponents and marks future modes as unavailable", () => {
    for (const destination of ["human", "dynamic", "grandmaster"]) {
      expect(html).toMatch(new RegExp(`data-pathway-destination="${destination}" disabled[\\s\\S]*?Coming soon`));
    }
    for (const destination of ["easy", "tough", "master"]) {
      expect(html).not.toMatch(new RegExp(`data-pathway-destination="${destination}" disabled`));
    }
    expect(css).toMatch(/\.pathway-choice:disabled\s*{[\s\S]*background: color-mix[\s\S]*cursor: not-allowed/);
    expect(css).toContain(".pathway-coming-soon");
  });

  it("uses a restrained staggered deal with an explicit reduced-motion fallback", () => {
    expect(css).toMatch(/@keyframes pathway-card-deal[\s\S]*translate: 0 34px;[\s\S]*translate: 0 0/);
    expect(css).toMatch(/nth-child\(6\)[\s\S]*animation-delay: 220ms/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important/);
    expect(css).not.toContain("pathway-card-slide-in");
  });

  it("has no development-only pathway variant switcher in the production entry", () => {
    expect(html).not.toContain("pathway-prototype");
    expect(css).not.toContain("pathway-prototype");
    expect(source).not.toContain("pathway-prototype");
  });
});
