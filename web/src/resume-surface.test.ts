import { describe, expect, it } from "vitest";

import { shouldRestoreSavedGameSurface } from "./resume-surface";

describe("saved-game surface restoration", () => {
  it("preserves an explicit authenticated Stats route when an active game also exists", () => {
    expect(shouldRestoreSavedGameSurface({ route: "statistics", activeGame: true })).toBe(false);
  });

  it("restores an active game only when the URL does not identify another surface", () => {
    expect(shouldRestoreSavedGameSurface({ route: null, activeGame: true })).toBe(true);
    expect(shouldRestoreSavedGameSurface({ route: "home", activeGame: true })).toBe(false);
    expect(shouldRestoreSavedGameSurface({ route: "play", activeGame: true })).toBe(false);
  });

  it("never restores a game that is no longer active", () => {
    expect(shouldRestoreSavedGameSurface({ route: null, activeGame: false })).toBe(false);
  });
});
