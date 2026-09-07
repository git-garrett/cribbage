import type { AnalyticsEvent } from "./api-types";

export function mergeStoredAnalyticsEvents(
  localStorageEvents: AnalyticsEvent[],
  indexedDbEvents: AnalyticsEvent[],
): AnalyticsEvent[] {
  const eventsById = new Map<string, AnalyticsEvent>();
  for (const event of localStorageEvents) eventsById.set(event.id, event);
  for (const event of indexedDbEvents) eventsById.set(event.id, event);
  return [...eventsById.values()].sort((left, right) => left.at.localeCompare(right.at));
}

export function completedGameIds(events: AnalyticsEvent[]): string[] {
  return [...new Set(
    events
      .filter((event) => event.type === "game" && event.action === "end")
      .map((event) => event.gameId),
  )];
}
