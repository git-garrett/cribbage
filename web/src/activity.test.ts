import { describe, expect, it } from "vitest";

import {
  InteractionBurstDetector,
  activityBrowser,
  activityDeviceType,
  activityEnvironment,
  safeActivityPage,
  shouldRecordAbandonmentCandidate,
  shouldRecordBounce,
} from "./activity";

describe("activity environment", () => {
  it("separates local, LAN, production, and the native iOS app", () => {
    expect(activityEnvironment("localhost", false)).toBe("local");
    expect(activityEnvironment("192.168.1.25", false)).toBe("lan");
    expect(activityEnvironment("cribbage.strongcribbage.com", false)).toBe("prod");
    expect(activityEnvironment("cribbage.strongcribbage.com", true)).toBe("ios");
  });
});

describe("activity client classification", () => {
  const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

  it("recognizes Mobile Safari and the native app separately", () => {
    expect(activityBrowser(iphoneSafari, false)).toBe("mobile_safari");
    expect(activityBrowser(iphoneSafari, true)).toBe("ios_app");
  });

  it("recognizes phones, iPads, and desktop devices", () => {
    expect(activityDeviceType(iphoneSafari, "iPhone", 5, 390, 844)).toBe("phone");
    expect(activityDeviceType("Mozilla/5.0", "MacIntel", 5, 1024, 1366)).toBe("tablet");
    expect(activityDeviceType("Mozilla/5.0", "MacIntel", 0, 1512, 982)).toBe("desktop");
  });
});

describe("safe activity pages", () => {
  it("keeps useful routes without recording secrets or arbitrary query values", () => {
    expect(safeActivityPage("https://example.test/?pathwayView=statistics&invite=secret&tag=Garrett"))
      .toBe("/?pathwayView=statistics");
    expect(safeActivityPage("https://example.test/?invite=secret")).toBe("/");
  });
});

describe("activity symptoms", () => {
  it("classifies short no-interaction exits as bounces", () => {
    expect(shouldRecordBounce(9_999, 0)).toBe(true);
    expect(shouldRecordBounce(10_000, 0)).toBe(false);
    expect(shouldRecordBounce(500, 1)).toBe(false);
  });

  it("only marks exits from visible active gameplay as abandonment candidates", () => {
    const activeGame = { authenticated: true, gameId: "game-1", phase: "pegging", surface: "game" };
    expect(shouldRecordAbandonmentCandidate(activeGame)).toBe(true);
    expect(shouldRecordAbandonmentCandidate({ ...activeGame, surface: "pathway:home" })).toBe(false);
    expect(shouldRecordAbandonmentCandidate({ ...activeGame, phase: "game_over" })).toBe(false);
  });

  it("reports repeated actions and fast rage clicks once per burst", () => {
    const detector = new InteractionBurstDetector();
    expect(detector.record("#play", 0)).toEqual({ repeat: false, rage: false, count: 1 });
    expect(detector.record("#play", 300)).toEqual({ repeat: false, rage: false, count: 2 });
    expect(detector.record("#play", 600)).toEqual({ repeat: true, rage: true, count: 3 });
    expect(detector.record("#play", 700)).toEqual({ repeat: false, rage: false, count: 4 });
    expect(detector.record("#play", 6_000)).toEqual({ repeat: false, rage: false, count: 1 });
  });
});
