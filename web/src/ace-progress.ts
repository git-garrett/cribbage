export interface AceProgressPosition {
  gameId: string;
  handNumber: number;
  played: number;
}

export interface AceProgress {
  completed: number;
  total: number;
  state: "running" | "ready" | "failed";
}

export function aceProgressPercent(progress: AceProgress | null): number | null {
  if (!progress || progress.state === "failed") return null;
  if (progress.state === "ready") return 100;
  if (!Number.isFinite(progress.total) || progress.total <= 0 ||
      !Number.isFinite(progress.completed) || progress.completed < 0) return null;
  // Search may finish its last batch before the move itself is ready.
  return Math.min(99, Math.floor(100 * progress.completed / progress.total));
}

/** Poll only the visible wait. One request at a time; no game rerenders. */
export class AceProgressPoller {
  private active: { key: string; controller: AbortController; timer?: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly read: (position: AceProgressPosition, signal: AbortSignal) => Promise<AceProgress | null>,
    private readonly show: (percent: number | null) => void,
  ) {}

  watch(position: AceProgressPosition | null): void {
    const key = position ? JSON.stringify(position) : null;
    if (this.active?.key === key) return;
    if (this.active) {
      this.active.controller.abort();
      clearTimeout(this.active.timer);
    }
    this.active = null;
    this.show(null);
    if (!position || !key) return;
    const active = { key, controller: new AbortController(), timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.active = active;
    const poll = async (): Promise<void> => {
      let finished = false;
      try {
        const progress = await this.read(position, active.controller.signal);
        if (this.active !== active) return;
        this.show(aceProgressPercent(progress));
        finished = progress?.state === "ready" || progress?.state === "failed";
      } catch {
        // The game action owns errors/retries. A lost progress request must not disrupt play.
      }
      if (this.active === active && !finished) active.timer = setTimeout(() => void poll(), 500);
    };
    void poll();
  }
}
