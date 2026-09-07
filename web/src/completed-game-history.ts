import type { AnalyticsEvent } from "./api-types";

function hasDecisionReview(event: AnalyticsEvent): boolean {
  return "review" in event && Boolean(event.review);
}

export function preferredAnalyticsEvent(
  existing: AnalyticsEvent,
  incoming: AnalyticsEvent,
): AnalyticsEvent {
  if (hasDecisionReview(existing) && !hasDecisionReview(incoming)) return existing;
  return incoming;
}

export function mergeStoredAnalyticsEvents(
  localStorageEvents: AnalyticsEvent[],
  indexedDbEvents: AnalyticsEvent[],
): AnalyticsEvent[] {
  const eventsById = new Map<string, AnalyticsEvent>();
  for (const event of localStorageEvents) eventsById.set(event.id, event);
  for (const event of indexedDbEvents) {
    const existing = eventsById.get(event.id);
    eventsById.set(event.id, existing ? preferredAnalyticsEvent(existing, event) : event);
  }
  return [...eventsById.values()].sort((left, right) => left.at.localeCompare(right.at));
}

export function completedGameIds(events: AnalyticsEvent[]): string[] {
  return [...new Set(
    events
      .filter((event) => event.type === "game" && event.action === "end")
      .map((event) => event.gameId),
  )];
}
