import { describe, expect, it } from "vitest";

import {
  DYNAMIC_CALIBRATED_COPY,
  DYNAMIC_CALIBRATING_LABEL,
  DYNAMIC_CALIBRATION_INVITE,
  dynamicCardCopy,
  dynamicProvisionalHandicapCopy,
  isDynamicCalibrating,
  playerHandicapCopy,
} from "./dynamic-calibration";

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

  it("formats the live provisional handicap in percentage points", () => {
    expect(dynamicProvisionalHandicapCopy({
      started: true,
      completeCycles: 2,
      minimumCycles: 6,
      complete: false,
      provisionalHandicap: -0.0125,
    })).toBe("Provisional Handicap: 1.25");
    expect(dynamicProvisionalHandicapCopy({
      started: true,
      completeCycles: 0,
      minimumCycles: 6,
      complete: false,
      provisionalHandicap: 0,
    })).toBe("Provisional Handicap: 0.00");
    expect(playerHandicapCopy({ wpPerDecision: -0.0125 })).toBe("(1.25)");
  });
});
