// @ts-expect-error The app intentionally omits Node typings; Vitest runs this file in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DYNAMIC_CALIBRATED_COPY,
  DYNAMIC_CALIBRATING_LABEL,
  DYNAMIC_CALIBRATION_INVITE,
  dynamicCardCopy,
  freshestDynamicCalibration,
  dynamicProvisionalHandicapCopy,
  isDynamicCalibrating,
  playerHandicapCopy,
} from "./dynamic-calibration";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("Dynamic calibration presentation", () => {
  it("invites a player who has never started Dynamic", () => {
    expect(dynamicCardCopy(null, false)).toBe(DYNAMIC_CALIBRATION_INVITE);
    expect(dynamicCardCopy({
      started: false,
      completeCycles: 8,
      minimumCycles: 6,
      complete: true,
    }, false)).toBe(DYNAMIC_CALIBRATION_INVITE);
  });

  it("switches to calibrating as soon as the first game starts", () => {
    expect(dynamicCardCopy(null, true)).toBe(DYNAMIC_CALIBRATING_LABEL);
    expect(isDynamicCalibrating({
      started: true,
      completeCycles: 5,
      minimumCycles: 6,
      complete: false,
    })).toBe(true);
  });

  it("restores the descriptive copy at the minimum evidence threshold", () => {
    const calibration = {
      started: true,
      completeCycles: 6,
      minimumCycles: 6,
      complete: true,
    };
    expect(isDynamicCalibrating(calibration)).toBe(false);
    expect(dynamicCardCopy(calibration, true)).toBe(DYNAMIC_CALIBRATED_COPY);
  });

  it("formats the live provisional handicap as a per-game total", () => {
    expect(dynamicProvisionalHandicapCopy({
      started: true,
      completeCycles: 2,
      minimumCycles: 6,
      complete: false,
      provisionalHandicapPerGame: -0.125,
    })).toBe("Provisional Handicap: 12.50 WP pts/game");
    expect(dynamicProvisionalHandicapCopy({
      started: true,
      completeCycles: 0,
      minimumCycles: 6,
      complete: false,
      provisionalHandicapPerGame: 0,
    })).toBe("Provisional Handicap: 0.00 WP pts/game");
    expect(playerHandicapCopy({ wpPerGame: -0.125 })).toBe("(12.50)");
  });

  it("adopts each newly reviewed cycle without letting a stale review response rewind progress", () => {
    const firstCycle = {
      started: true,
      completeCycles: 1,
      minimumCycles: 6,
      complete: false,
      provisionalHandicapPerGame: -0.04,
    };
    const secondCycle = {
      ...firstCycle,
      completeCycles: 2,
      provisionalHandicapPerGame: -0.07,
    };

    expect(freshestDynamicCalibration(firstCycle, secondCycle)).toBe(secondCycle);
    expect(freshestDynamicCalibration(secondCycle, firstCycle)).toBe(secondCycle);
    expect(mainSource).toContain("mergeReviewedDynamicCalibration(gameId, response.state.dynamicCalibration)");
  });
});
