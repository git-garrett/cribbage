// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("standalone leaderboard pathway", () => {
  it("opens from its own home card and no longer belongs to My Stats", () => {
    expect(html).toContain('id="pathway-leaderboard"');
    expect(source).toContain('navigatePathway("leaderboard")');
    expect(html).not.toContain('data-stats-view="leaderboard"');
    expect(html).not.toContain('id="stats-leaderboard"');
    expect(html).not.toContain('id="leaderboard-close"');
    expect(source).toMatch(/state\.leaderboardOpen[\s\S]*route === "leaderboard"[\s\S]*pathwayParentRoute\(route\)/);
  });

  it("defaults to current Handicap without time-window controls", () => {
    expect(source).toContain('leaderboardMetric: "handicap"');
    expect(source).toContain('leaderboardWindow: "monthly"');
    expect(html).toMatch(/data-leaderboard-metric="handicap" aria-selected="true"/);
    expect(html).toMatch(/data-leaderboard-window="monthly" aria-selected="true"/);
    expect(html).toMatch(/id="leaderboard-window-tabs"[^>]*hidden/);
    expect(source).toMatch(/const handicap = state\.leaderboardMetric === "handicap";[\s\S]*leaderboardWindowTabs\.hidden = handicap/);
  });

  it("offers all result metrics and rolling time windows as keyboard tabs", () => {
    for (const metric of ["handicap", "pointsPerGame", "winPercentage", "pointDifferential", "totalPoints", "totalWins"]) {
      expect(html).toContain(`data-leaderboard-metric="${metric}"`);
    }
    expect(html).toContain('data-leaderboard-metric="totalPoints" aria-selected="false">Points scored</button>');
    for (const window of ["daily", "weekly", "monthly", "allTime"]) {
      expect(html).toContain(`data-leaderboard-window="${window}"`);
    }
    expect(source).toMatch(/bindLeaderboardTabs[\s\S]*ArrowLeft[\s\S]*ArrowRight/);
    expect(css).toMatch(/\.leaderboard-tabs button:focus-visible/);
  });
});
