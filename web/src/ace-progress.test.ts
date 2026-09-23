import { afterEach, describe, expect, it, vi } from "vitest";
import { aceProgressPercent, AceProgressPoller, type AceProgress } from "./ace-progress";

const position = { gameId: "game", handNumber: 1, played: 0 };
const tick = () => vi.advanceTimersByTimeAsync(0);

afterEach(() => vi.useRealTimers());

describe("Ace progress", () => {
  it("keeps setup indeterminate and reserves 100% for a ready move", () => {
    expect(aceProgressPercent(null)).toBeNull();
    expect(aceProgressPercent({ completed: 0, total: 0, state: "running" })).toBeNull();
    expect(aceProgressPercent({ completed: 100, total: 100, state: "running" })).toBe(99);
    expect(aceProgressPercent({ completed: 100, total: 100, state: "ready" })).toBe(100);
    expect(aceProgressPercent({ completed: 50, total: 100, state: "failed" })).toBeNull();
  });

  it("polls twice per second without overlapping requests or rerendering the game", async () => {
    vi.useFakeTimers();
    let resolve!: (value: AceProgress) => void;
    const read = vi.fn(() => new Promise<AceProgress>((done) => { resolve = done; }));
    const show = vi.fn();
    const poller = new AceProgressPoller(read, show);
    poller.watch(position);
    poller.watch({ ...position });
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(1);
    resolve({ completed: 40, total: 100, state: "running" });
    await tick();
    expect(show).toHaveBeenLastCalledWith(40);
    await vi.advanceTimersByTimeAsync(499);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    resolve({ completed: 100, total: 100, state: "ready" });
    await tick();
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(show).toHaveBeenLastCalledWith(100);
    poller.watch(null);
  });

  it("aborts hidden waits and ignores late results from a previous position", async () => {
    vi.useFakeTimers();
    const resolvers: ((value: AceProgress) => void)[] = [];
    const signals: AbortSignal[] = [];
    const read = vi.fn((_position, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<AceProgress>((resolve) => resolvers.push(resolve));
    });
    const show = vi.fn();
    const poller = new AceProgressPoller(read, show);
    poller.watch(position);
    poller.watch({ ...position, handNumber: 2 });
    expect(signals[0].aborted).toBe(true);
    resolvers[0]({ completed: 100, total: 100, state: "ready" });
    await tick();
    expect(show).toHaveBeenLastCalledWith(null);
    poller.watch(null);
    expect(signals[1].aborted).toBe(true);
    resolvers[1]({ completed: 100, total: 100, state: "ready" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(show).toHaveBeenLastCalledWith(null);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
