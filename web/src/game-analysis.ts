import type { AnalyticsEvent } from "./api-types";

export type ReviewableDecision = Extract<AnalyticsEvent, { type: "discard" | "pegging" }>;

export interface GameAnalysisProgress {
  total: number;
  reviewed: number;
  pending: number;
  complete: boolean;
}

export function isReviewableUserDecision(event: AnalyticsEvent): event is ReviewableDecision {
  return (event.type === "discard" && event.player === "human") ||
    (event.type === "pegging" && event.action === "play" && event.player === "human");
}

export function gameAnalysisProgress(events: AnalyticsEvent[], gameId: string): GameAnalysisProgress {
  const reviewsBothPlayers = events.some((event) =>
    event.type === "game" && event.action === "start" && event.gameId === gameId && event.opponent === "human"
  );
  const decisions = events
    .filter((event): event is ReviewableDecision =>
      (event.type === "discard" && (event.player === "human" || (reviewsBothPlayers && event.player === "ai"))) ||
      (event.type === "pegging" && event.action === "play" &&
        (event.player === "human" || (reviewsBothPlayers && event.player === "ai")))
    )
    .filter((event) => event.gameId === gameId);
  const reviewed = decisions.filter((event) => Boolean(event.review)).length;
  return {
    total: decisions.length,
    reviewed,
    pending: decisions.length - reviewed,
    complete: decisions.length > 0 && reviewed === decisions.length,
  };
}

export function helpCountForGame(events: AnalyticsEvent[], gameId: string): number {
  return events.filter((event) => event.gameId === gameId && event.type === "help").length;
}

export function pendingAnalysisGameIds(events: AnalyticsEvent[], gameIds: string[]): string[] {
  return gameIds.filter((gameId) => gameAnalysisProgress(events, gameId).pending > 0);
}
