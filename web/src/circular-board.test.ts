// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { GameState } from "./api-types";
import { circularBoardPresentation, circularTrackPoint, circularTurnCutPresentation } from "./circular-board";

const source = readFileSync(new URL("./circular-board.ts", import.meta.url), "utf8");

describe("circular cribbage track", () => {
  it("renders each peg as a dot centered on its occupied hole", () => {
    expect(source).toMatch(/setAttribute\("transform", `translate\(/);
    expect(source).not.toMatch(/setAttribute\([\s\S]*rotate\(\$\{point\.rotation/);
    expect(source).toMatch(/<circle cx="0" cy="0" r="\$\{pegRadius\}"/);
    expect(source).not.toMatch(/<rect/);
  });

  it("leaves a clear top gap between the finish and start", () => {
    const outerFinish = circularTrackPoint(121, 114);
    const innerFinish = circularTrackPoint(121, 101);
    const outerStart = circularTrackPoint("start-back", 114);

    expect(outerFinish.x).toBeLessThan(130);
    expect(outerStart.x).toBeGreaterThan(130);
    expect(Math.hypot(outerStart.x - outerFinish.x, outerStart.y - outerFinish.y)).toBeGreaterThan(18);
    expect(innerFinish.y).toBeGreaterThan(outerFinish.y);
  });

  it("marks the skunk line with an S between the hole-90 lanes", () => {
    const outer = circularTrackPoint(90, 114);
    const inner = circularTrackPoint(90, 101);
    const marker = circularTrackPoint(90, (114 + 101) / 2);

    expect(marker.x).toBeCloseTo((outer.x + inner.x) / 2, 5);
    expect(marker.y).toBeCloseTo((outer.y + inner.y) / 2, 5);
    expect(source).toMatch(/circular-track-skunk-label/);
    expect(source).toMatch(/skunkLabel\.textContent = "S"/);
  });

  it("shows live pegging count and turn in the center", () => {
    const game = {
      phase: "pegging",
      count: 22,
      turn: "User",
      peggingResetPending: false,
    } as GameState;

    expect(circularBoardPresentation(game)).toEqual({
      eyebrow: "Count",
      value: "22",
      detail: "Your turn",
    });
  });

  it("puts the discard instruction in the center without relying on duplicate chrome", () => {
    const game = {
      phase: "discard",
      handNumber: 4,
      cribOwner: "AI",
    } as GameState;

    expect(circularBoardPresentation(game)).toEqual({
      eyebrow: "Hand",
      value: "4",
      detail: "Choose 2 · AI crib",
    });
  });

  it("keeps the first-deal prompt compact enough for the x-large circular core", () => {
    const game = { phase: "cut_for_deal" } as GameState;

    expect(circularBoardPresentation(game)).toEqual({
      eyebrow: "First deal",
      value: "CUT",
      detail: "Tap deck",
    });
  });

  it("replaces stale AI-discard copy while the user is turning the cut card", () => {
    expect(circularTurnCutPresentation("user-turn")).toEqual({
      eyebrow: "Turn",
      value: "CARD",
      detail: "Tap deck",
    });
    expect(circularTurnCutPresentation(null)).toBeNull();
  });
});
