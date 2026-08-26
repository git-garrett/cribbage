import { describe, expect, it } from "vitest";
import { shouldRevealCribOwner, shouldShowStrategicGuides } from "./ui-visibility";

describe("shouldShowStrategicGuides", () => {
  it("suppresses a persisted admin preference in the public game", () => {
    expect(shouldShowStrategicGuides(true, true)).toBe(false);
  });

  it("allows an enabled preference in full mode", () => {
    expect(shouldShowStrategicGuides(true, false)).toBe(true);
  });
});

describe("shouldRevealCribOwner", () => {
  it("hides the known crib owner while the deal cut is being revealed", () => {
    expect(shouldRevealCribOwner("discard", "human")).toBe(false);
    expect(shouldRevealCribOwner("discard", "ai")).toBe(false);
  });

  it("hides the crib owner before the cut has resolved", () => {
    expect(shouldRevealCribOwner("cut_for_deal", null)).toBe(false);
  });

  it("reveals the crib owner after the cut reveal is complete", () => {
    expect(shouldRevealCribOwner("discard", null)).toBe(true);
  });
});
