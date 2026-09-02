import { describe, expect, it } from "vitest";
import {
  shouldRevealCribOwner,
  shouldOfferMasterHint,
  shouldShowDecisionSnapshotCut,
  shouldShowStrategicGuides,
  turnCutPresentation,
} from "./ui-visibility";

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

describe("shouldShowDecisionSnapshotCut", () => {
  it("hides the cut area for discard decisions before the cut exists", () => {
    expect(shouldShowDecisionSnapshotCut("discard", undefined)).toBe(false);
  });

  it("shows the cut area for pegging decisions with a cut card", () => {
    expect(shouldShowDecisionSnapshotCut("pegging", "Jh")).toBe(true);
  });
});

describe("shouldOfferMasterHint", () => {
  it("hides the hint while the cut card is waiting for confirmation", () => {
    expect(shouldOfferMasterHint(true, "pegging", "User", 4, false, true)).toBe(false);
  });

  it("shows the hint once a lower-level opponent is waiting for a legal user play", () => {
    expect(shouldOfferMasterHint(true, "pegging", "User", 4, false, false)).toBe(true);
  });
});

describe("turnCutPresentation", () => {
  it("owns the primary label and optional action for every turn-cut stage", () => {
    expect(turnCutPresentation(null)).toBeNull();
    expect(turnCutPresentation("user-cut")).toEqual({
      label: "Cut the deck for AI",
      action: { buttonLabel: "Cut deck", ariaLabel: "Cut deck" },
    });
    expect(turnCutPresentation("user-cutting")).toEqual({ label: "Cutting the deck", action: null });
    expect(turnCutPresentation("ai-cutting")).toEqual({ label: "AI cuts the deck", action: null });
    expect(turnCutPresentation("user-turn")).toEqual({
      label: "Turn the cut card",
      action: { buttonLabel: "Turn cut card", ariaLabel: "Turn cut card" },
    });
    expect(turnCutPresentation("ai-turn")).toEqual({ label: "AI turns the cut card", action: null });
    expect(turnCutPresentation("revealed")).toEqual({
      label: "Cut card",
      action: { buttonLabel: "OK", ariaLabel: "Continue to pegging" },
    });
  });
});
