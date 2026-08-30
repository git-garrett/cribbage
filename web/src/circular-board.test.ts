// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { GameState } from "./api-types";
import { circularBoardPresentation, circularTrackPoint } from "./circular-board";

const source = readFileSync(new URL("./circular-board.ts", import.meta.url), "utf8");

describe("circular cribbage track", () => {
  it("renders each peg as a dot centered on its occupied hole", () => {
    expect(source).toMatch(/setAttribute\("transform", `translate\(/);
    expect(source).not.toMatch(/setAttribute\([\s\S]*rotate\(\$\{point\.rotation/);
    expect(source).toMatch(/<circle cx="0" cy="0" r="\$\{pegRadius\}"/);
    expect(source).not.toMatch(/<rect/);
  });

  it("places the finish at the top and keeps the two player lanes distinct", () => {
    const outerFinish = circularTrackPoint(121, 114);
    const innerFinish = circularTrackPoint(121, 101);

    expect(outerFinish.x).toBeCloseTo(130, 5);
    expect(outerFinish.y).toBeCloseTo(16, 5);
    expect(innerFinish.y).toBeCloseTo(29, 5);
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
});
