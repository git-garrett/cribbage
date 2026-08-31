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

    const human = html.indexOf('data-pathway-destination="human"');
    const dynamic = html.indexOf('data-pathway-destination="dynamic"');
    const easy = html.indexOf('data-pathway-destination="easy"');
    expect(human).toBeGreaterThan(-1);
    expect(dynamic).toBeGreaterThan(human);
    expect(easy).toBeGreaterThan(dynamic);
  });

  it("keeps the prototype local and connects Statistics to My Stats", () => {
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
});
