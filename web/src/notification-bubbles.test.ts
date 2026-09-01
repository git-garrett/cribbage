// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("contextual game notifications", () => {
  it("uses a non-interactive live layer instead of a dedicated notification row", () => {
    expect(html).toMatch(/id="result" class="game-notifications" role="status" aria-live="polite" aria-atomic="true"/);
    expect(html).not.toContain("notification-row");
    expect(html).not.toContain("notice-back");
    expect(html).not.toContain("notice-forward");
  });

  it("turns unseen scoring events into player-colored score bubbles", () => {
    expect(mainSource).toMatch(/function newScoreNotices[\s\S]*event\.type === "score"[\s\S]*seenScoreNoticeIds/s);
    expect(mainSource).toMatch(/bubble\.dataset\.player = notice\.player/);
    expect(mainSource).toMatch(/points\.textContent = `\+\$\{notice\.points\}`/);
  });

  it("anchors pegging, cut, and hand scores to the action that produced them", () => {
    expect(mainSource).toMatch(/notice\.anchor === "scoring"[\s\S]*scoringCards\.querySelector\("\.card:last-child"\)/s);
    expect(mainSource).toMatch(/notice\.anchor === "cut"[\s\S]*turnCard\.querySelector\("\.card"\)/s);
    expect(mainSource).toMatch(/notice\.anchor === "play"[\s\S]*played-active \.card:last-child/s);
  });
});
