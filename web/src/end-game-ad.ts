import { Capacitor, registerPlugin } from "@capacitor/core";

export const END_GAME_INTERSTITIAL_AD_UNIT_ID = "ca-app-pub-1499137290535823/2491804063";
export const ATTEMPTED_END_GAME_AD_STORAGE_KEY = "strong-cribbage.attemptedEndGameAdId";

export interface EndGameInterstitialProvider {
  prepare(options: { adUnitId: string }): Promise<{ ready: boolean; reason?: string }>;
  show(options: { adUnitId: string }): Promise<{ shown: boolean; reason?: string }>;
}

interface AttemptStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const nativeAdMobInterstitial = registerPlugin<EndGameInterstitialProvider>("AdMobInterstitial");

export class EndGameAdGate {
  private preparedGameId: string | null = null;
  private attemptedGameId: string | null;
  private pending: { gameId: string; promise: Promise<void> } | null = null;

  constructor(
    private readonly provider: EndGameInterstitialProvider | null,
    private readonly storage: AttemptStore | null,
  ) {
    this.attemptedGameId = this.readAttemptedGameId();
  }

  prepare(gameId: string): void {
    if (!this.provider || !gameId || this.attemptedGameId === gameId || this.preparedGameId === gameId) return;
    this.preparedGameId = gameId;
    void this.provider.prepare({ adUnitId: END_GAME_INTERSTITIAL_AD_UNIT_ID }).catch(() => {
      if (this.preparedGameId === gameId) this.preparedGameId = null;
    });
  }

  showBeforeReport(gameId: string): Promise<void> {
    if (!this.provider || !gameId) return Promise.resolve();
    if (this.pending?.gameId === gameId) return this.pending.promise;
    if (this.attemptedGameId === gameId) return Promise.resolve();

    this.recordAttempt(gameId);
    const promise = this.provider
      .show({ adUnitId: END_GAME_INTERSTITIAL_AD_UNIT_ID })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        if (this.pending?.gameId === gameId) this.pending = null;
      });
    this.pending = { gameId, promise };
    return promise;
  }

  private readAttemptedGameId(): string | null {
    try {
      return this.storage?.getItem(ATTEMPTED_END_GAME_AD_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private recordAttempt(gameId: string): void {
    this.attemptedGameId = gameId;
    try {
      this.storage?.setItem(ATTEMPTED_END_GAME_AD_STORAGE_KEY, gameId);
    } catch {
      // The in-memory guard still prevents duplicate presentation this session.
    }
  }
}

function defaultProvider(): EndGameInterstitialProvider | null {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" ? nativeAdMobInterstitial : null;
}

const defaultStorage = typeof window === "undefined" ? null : window.localStorage;

export const endGameAds = new EndGameAdGate(defaultProvider(), defaultStorage);
