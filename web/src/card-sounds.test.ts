import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardSounds } from "./card-sounds";

describe("optional card audio", () => {
  let sounds: CardSounds;
  let sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>;
  let synthesizedBuffers: Float32Array[];
  const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

  beforeEach(() => {
    sources = [];
    synthesizedBuffers = [];
    vi.stubGlobal("document", { hidden: false });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
    vi.stubGlobal("AudioContext", class {
      state = "running";
      currentTime = 10;
      sampleRate = 44_100;
      destination = {};
      createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
      createBuffer(_channels: number, length: number) {
        const samples = new Float32Array(length);
        synthesizedBuffers.push(samples);
        return { duration: length / this.sampleRate, getChannelData: () => samples };
      }
      async decodeAudioData() { return {}; }
      createBufferSource() {
        const source = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), buffer: null, onended: null };
        sources.push(source);
        return source;
      }
    });
    sounds = new CardSounds();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads the chosen clips once and schedules a complete deal sample", async () => {
    sounds.unlock();
    await flush();
    sounds.unlock();
    sounds.play("deal", 0.72);
    await flush();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      "/brand/card-fan-1.wav", "/brand/card-fan-2.wav", "/brand/card-place-1.wav",
      "/brand/card-place-2.wav", "/brand/card-place-3.wav",
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0].start).toHaveBeenCalledWith(10.72);
  });

  it("cancels queued and playing sounds when muted", async () => {
    sounds.unlock();
    await flush();
    sounds.play("shuffle");
    await flush();
    sounds.play("deal", 0.72);
    sounds.setEnabled(false);
    await flush();
    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    sounds.play("cut");
    await flush();
    expect(sources).toHaveLength(2);
  });

  it("can schedule two crib placements for separate card landings", async () => {
    sounds.unlock();
    await flush();
    sounds.play("discard", 0.72);
    sounds.play("discard", 0.85);
    await flush();
    expect(sources).toHaveLength(2);
    expect(sources[0].start).toHaveBeenCalledWith(10.72);
    expect(sources[1].start).toHaveBeenCalledWith(10.85);
  });

  it("synthesizes a short interaction tick without fetching another asset", async () => {
    sounds.unlock();
    sounds.play("tick");
    await flush();
    expect(sources).toHaveLength(1);
    expect(sources[0].start).toHaveBeenCalledWith(10);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5);
  });

  it("starts an unlocked toggle tick before the control can change state", () => {
    sounds.unlock();
    sounds.play("tick");
    expect(sources).toHaveLength(1);
    expect(sources[0].start).toHaveBeenCalledWith(10);
  });

  it("plays one quick chime for every awarded point", async () => {
    sounds.unlock();
    sounds.playScore(3);
    await flush();
    expect(sources).toHaveLength(3);
    expect(sources[0].start).toHaveBeenCalledWith(10);
    expect(sources[1].start).toHaveBeenCalledWith(10.1);
    expect(sources[2].start).toHaveBeenCalledWith(10.2);
  });

  it("renders score chimes at seventy percent of their original level", () => {
    sounds.unlock();
    const peak = synthesizedBuffers[1].reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    expect(peak).toBeCloseTo(0.1453, 3);
  });

  it("discards in-flight loading effects when leaving the table", async () => {
    sounds.unlock();
    sounds.play("cut");
    sounds.stop();
    await flush();
    expect(sources).toHaveLength(0);
  });

  it("stays silent in a hidden tab", async () => {
    sounds.unlock();
    await flush();
    vi.stubGlobal("document", { hidden: true });
    sounds.play("deal");
    await flush();
    expect(sources).toHaveLength(0);
  });

  it("tolerates missing audio and permits a later retry", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    sounds.unlock();
    sounds.play("shuffle");
    await flush();
    expect(sources).toHaveLength(0);
    sounds.unlock();
    await flush();
    sounds.play("shuffle");
    await flush();
    expect(sources).toHaveLength(1);
  });
});
