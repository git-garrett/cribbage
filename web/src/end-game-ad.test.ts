import { describe, expect, it, vi } from "vitest";

import {
  ATTEMPTED_END_GAME_AD_STORAGE_KEY,
  END_GAME_INTERSTITIAL_AD_UNIT_ID,
  EndGameAdGate,
  type EndGameInterstitialProvider,
} from "./end-game-ad";

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function provider() {
  return {
    prepare: vi.fn<EndGameInterstitialProvider["prepare"]>().mockResolvedValue({ ready: true }),
    show: vi.fn<EndGameInterstitialProvider["show"]>().mockResolvedValue({ shown: true }),
  };
}

describe("EndGameAdGate", () => {
  it("is a no-op when no platform provider is available", async () => {
    const gate = new EndGameAdGate(null, memoryStore());

    gate.prepare("game-1");
    await gate.showBeforeReport("game-1");
  });

  it("prepares one production interstitial for each game", () => {
    const native = provider();
    const gate = new EndGameAdGate(native, memoryStore());

    gate.prepare("game-1");
    gate.prepare("game-1");
    gate.prepare("game-2");

    expect(native.prepare).toHaveBeenCalledTimes(2);
    expect(native.prepare).toHaveBeenCalledWith({ adUnitId: END_GAME_INTERSTITIAL_AD_UNIT_ID });
  });

  it("records the attempt before presentation and shares concurrent calls", async () => {
    let finishShow: (() => void) | undefined;
    const native = provider();
    native.show.mockImplementation(() => new Promise((resolve) => {
      finishShow = () => resolve({ shown: true });
    }));
    const storage = memoryStore();
    const gate = new EndGameAdGate(native, storage);

    const first = gate.showBeforeReport("game-1");
    const second = gate.showBeforeReport("game-1");

    expect(storage.getItem(ATTEMPTED_END_GAME_AD_STORAGE_KEY)).toBe("game-1");
    expect(native.show).toHaveBeenCalledTimes(1);
    finishShow?.();
    await Promise.all([first, second]);
  });

  it("falls through after a native failure and never retries that game", async () => {
    const native = provider();
    native.show.mockRejectedValue(new Error("native bridge unavailable"));
    const gate = new EndGameAdGate(native, memoryStore());

    await expect(gate.showBeforeReport("game-1")).resolves.toBeUndefined();
    await expect(gate.showBeforeReport("game-1")).resolves.toBeUndefined();

    expect(native.show).toHaveBeenCalledTimes(1);
  });

  it("does not repeat an attempted ad after a page reload", async () => {
    const native = provider();
    const storage = memoryStore({ [ATTEMPTED_END_GAME_AD_STORAGE_KEY]: "game-1" });
    const gate = new EndGameAdGate(native, storage);

    gate.prepare("game-1");
    await gate.showBeforeReport("game-1");

    expect(native.prepare).not.toHaveBeenCalled();
    expect(native.show).not.toHaveBeenCalled();
  });
});
