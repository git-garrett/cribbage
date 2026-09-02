import type { AnalyticsEvent } from "./api-types";

export type ScoreEvent = Extract<AnalyticsEvent, { type: "score" }>;

export interface ScoreNoticeCursor {
  initialized: boolean;
  gameId: string | null;
  seenIds: Set<string>;
}

export function createScoreNoticeCursor(): ScoreNoticeCursor {
  return { initialized: false, gameId: null, seenIds: new Set() };
}

export function scoreEventsForGame(
  gameId: string | null,
  analyticsEvents: readonly AnalyticsEvent[],
): ScoreEvent[] {
  if (!gameId) return [];
  return analyticsEvents.filter(
    (event): event is ScoreEvent => event.type === "score" && event.gameId === gameId,
  );
}

export function baselineScoreEvents(
  cursor: ScoreNoticeCursor,
  gameId: string | null,
  analyticsEvents: readonly AnalyticsEvent[],
): void {
  cursor.seenIds = new Set(scoreEventsForGame(gameId, analyticsEvents).map((event) => event.id));
  cursor.initialized = true;
  cursor.gameId = gameId;
}

export function collectNewScoreEvents(
  cursor: ScoreNoticeCursor,
  gameId: string | null,
  analyticsEvents: readonly AnalyticsEvent[],
): ScoreEvent[] {
  const events = scoreEventsForGame(gameId, analyticsEvents);
  if (!cursor.initialized || cursor.gameId !== gameId) {
    baselineScoreEvents(cursor, gameId, analyticsEvents);
    return [];
  }
  const unseen: ScoreEvent[] = [];
  for (const event of events) {
    if (cursor.seenIds.has(event.id)) continue;
    cursor.seenIds.add(event.id);
    unseen.push(event);
  }
  return unseen;
}
