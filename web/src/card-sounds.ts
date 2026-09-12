export const CARD_SOUND_FILES = {
  shuffle: "/brand/card-fan-1.mp3",
  deal: "/brand/card-fan-2.mp3",
  cut: "/brand/card-place-1.mp3",
  play: "/brand/card-place-2.mp3",
  discard: "/brand/card-place-3.mp3",
} as const;

type RecordedCardSound = keyof typeof CARD_SOUND_FILES;
type SynthesizedUiSound = "tick" | "chime" | "success" | "failure";
export type CardSound = RecordedCardSound | SynthesizedUiSound;
const SCORE_CHIME_LEVEL = 0.7;

function isRecordedCardSound(sound: CardSound): sound is RecordedCardSound {
  return Object.prototype.hasOwnProperty.call(CARD_SOUND_FILES, sound);
}

function synthesizedSoundBuffer(context: AudioContext, sound: SynthesizedUiSound): AudioBuffer {
  const duration = sound === "tick" ? 0.035 : sound === "chime" ? 0.22 : sound === "success" ? 0.46 : 0.3;
  const length = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / context.sampleRate;
    if (sound === "tick") {
      const envelope = Math.exp(-time * 105);
      samples[index] = envelope * (
        (Math.sin(2 * Math.PI * 1_650 * time) * 0.16) +
        (Math.sin(2 * Math.PI * 2_450 * time) * 0.07)
      );
    } else if (sound === "chime") {
      const attack = Math.min(1, time / 0.008);
      const envelope = attack * Math.exp(-time * 14);
      samples[index] = SCORE_CHIME_LEVEL * envelope * (
        (Math.sin(2 * Math.PI * 880 * time) * 0.19) +
        (Math.sin(2 * Math.PI * 1_320 * time) * 0.055)
      );
    } else if (sound === "success") {
      const secondNote = time >= 0.14;
      const noteTime = secondNote ? time - 0.14 : time;
      const frequency = secondNote ? 880 : 660;
      const envelope = Math.min(1, noteTime / 0.008) * Math.exp(-noteTime * 7.5);
      samples[index] = envelope * (
        (Math.sin(2 * Math.PI * frequency * noteTime) * 0.2) +
        (Math.sin(2 * Math.PI * frequency * 1.5 * noteTime) * 0.045)
      );
    } else {
      const frequency = 230 - (80 * (time / duration));
      const envelope = Math.min(1, time / 0.006) * Math.exp(-time * 10);
      samples[index] = envelope * (
        (Math.sin(2 * Math.PI * frequency * time) * 0.18) +
        (Math.sin(2 * Math.PI * frequency * 0.5 * time) * 0.06)
      );
    }
  }
  return buffer;
}

/** Optional table feedback: playback must never hold up a game action. */
export class CardSounds {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffers = new Map<CardSound, AudioBuffer>();
  private encoded = new Map<RecordedCardSound, Promise<ArrayBuffer>>();
  private loading = new Map<RecordedCardSound, Promise<void>>();
  private resuming: Promise<void> | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private generation = 0;
  private enabled = true;
  private volume = 0.5;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.5;
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /** Start network loading without creating an AudioContext before user input. */
  preload(): void {
    if (!this.enabled) return;
    for (const sound of Object.keys(CARD_SOUND_FILES) as RecordedCardSound[]) {
      void this.encodedSound(sound).catch(() => undefined);
    }
  }

  // Call synchronously from a click/key event, before any network awaits.
  unlock(): void {
    if (!this.enabled) return;
    try {
      this.preload();
      if (!this.context) {
        this.context = new AudioContext();
        this.gain = this.context.createGain();
        this.gain.gain.value = this.volume;
        this.gain.connect(this.context.destination);
        this.buffers.set("tick", synthesizedSoundBuffer(this.context, "tick"));
        this.buffers.set("chime", synthesizedSoundBuffer(this.context, "chime"));
        this.buffers.set("success", synthesizedSoundBuffer(this.context, "success"));
        this.buffers.set("failure", synthesizedSoundBuffer(this.context, "failure"));
      }
      void this.resumeContext();
      for (const sound of Object.keys(CARD_SOUND_FILES) as RecordedCardSound[]) {
        void this.loadSound(sound).catch(() => undefined);
      }
    } catch {
      // Audio is optional on browsers/devices where it is unavailable.
    }
  }

  play(sound: CardSound, delaySeconds = 0): void {
    if (!this.enabled || document.hidden || !this.context) return;
    const generation = this.generation;
    const requestedAt = performance.now();
    if (this.context.state === "running" && this.buffers.has(sound)) {
      this.startSound(sound, delaySeconds, generation, requestedAt);
      return;
    }
    const soundReady = this.buffers.has(sound) || !isRecordedCardSound(sound)
      ? Promise.resolve()
      : this.loadSound(sound);
    void Promise.all([this.resumeContext(), soundReady]).then(() => {
      this.startSound(sound, delaySeconds, generation, requestedAt);
    }).catch(() => undefined);
  }

  playScore(points: number): void {
    const count = Math.max(0, Math.floor(points));
    for (let index = 0; index < count; index += 1) this.play("chime", index * 0.1);
  }

  stop(): void {
    this.generation += 1;
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
  }

  private startSound(sound: CardSound, delaySeconds: number, generation: number, requestedAt: number): void {
    if (generation !== this.generation || !this.enabled || document.hidden) return;
    // Discard late effects rather than playing an old action after loading.
    if (performance.now() - requestedAt > 1000) return;
    const context = this.context;
    const buffer = this.buffers.get(sound);
    if (!context || context.state !== "running" || !this.gain || !buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    this.sources.add(source);
    source.start(context.currentTime + delaySeconds);
  }

  private encodedSound(sound: RecordedCardSound): Promise<ArrayBuffer> {
    const existing = this.encoded.get(sound);
    if (existing) return existing;
    const request = fetch(CARD_SOUND_FILES[sound])
      .then(async (response) => {
        if (!response.ok) throw new Error("Sound unavailable");
        return response.arrayBuffer();
      })
      .catch((error) => {
        this.encoded.delete(sound);
        throw error;
      });
    this.encoded.set(sound, request);
    return request;
  }

  private loadSound(sound: RecordedCardSound): Promise<void> {
    if (this.buffers.has(sound)) return Promise.resolve();
    const existing = this.loading.get(sound);
    if (existing) return existing;
    const context = this.context;
    if (!context) return Promise.resolve();
    const loading = this.encodedSound(sound)
      .then((encoded) => context.decodeAudioData(encoded.slice(0)))
      .then((buffer) => { this.buffers.set(sound, buffer); })
      .catch((error) => {
        this.encoded.delete(sound);
        throw error;
      })
      .finally(() => { this.loading.delete(sound); });
    this.loading.set(sound, loading);
    return loading;
  }

  private resumeContext(): Promise<void> {
    const context = this.context;
    if (!context || context.state === "running") return Promise.resolve();
    if (!this.resuming) {
      this.resuming = context.resume()
        .catch(() => undefined)
        .finally(() => { this.resuming = null; });
    }
    return this.resuming;
  }
}

export const cardSounds = new CardSounds();
