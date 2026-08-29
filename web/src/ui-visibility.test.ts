import { describe, expect, it } from "vitest";
import {
  shouldRevealCribOwner,
  shouldShowDecisionSnapshotCut,
  shouldShowStrategicGuides,
  shouldShowTurnCutPlayTitle,
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

describe("shouldShowTurnCutPlayTitle", () => {
  it("hides the play-area title after the turn card is revealed", () => {
    expect(shouldShowTurnCutPlayTitle("revealed")).toBe(false);
  });

  it("keeps the title during the interactive turn-cut steps", () => {
    expect(shouldShowTurnCutPlayTitle("user-turn")).toBe(true);
    expect(shouldShowTurnCutPlayTitle(null)).toBe(true);
  });
});
