import { describe, expect, it } from "vitest";

import { shouldLoadAdSense } from "./adsense";

const gameplay = {
  hostname: "cribbage.strongcribbage.com",
  isNativePlatform: false,
  authenticated: true,
  splashOpen: false,
};

describe("shouldLoadAdSense", () => {
  it("allows ads on authenticated web gameplay", () => {
    expect(shouldLoadAdSense(gameplay)).toBe(true);
  });

  it("excludes the apex homepage", () => {
    expect(shouldLoadAdSense({ ...gameplay, hostname: "strongcribbage.com" })).toBe(false);
  });

  it("excludes login and the signed-in splash homepage", () => {
    expect(shouldLoadAdSense({ ...gameplay, authenticated: false })).toBe(false);
    expect(shouldLoadAdSense({ ...gameplay, splashOpen: true })).toBe(false);
  });

  it("excludes the native app", () => {
    expect(shouldLoadAdSense({ ...gameplay, isNativePlatform: true })).toBe(false);
  });
});
