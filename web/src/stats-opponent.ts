import type { AnalyticsEvent } from "./api-types";

export type StatsOpponent = "master" | "human" | "easy" | "tough" | "grandmaster" | "dynamic";

export function statsOpponentForModel(model: string): StatsOpponent {
  const normalized = model.trim().toLowerCase();
  if (normalized === "myrmidon-5") return "easy";
  if (normalized === "schell_table-peg_table-9.1" || normalized === "schell_table-peg_table-9.11") return "tough";
  if (normalized === "human" || normalized.startsWith("human:")) return "human";
  if (normalized.includes("grandmaster")) return "grandmaster";
  if (normalized.includes("dynamic")) return "dynamic";
  return "master";
}

export function analyticsForStatsOpponent(
  events: AnalyticsEvent[],
  opponent: StatsOpponent,
): AnalyticsEvent[] {
  const matchingGameIds = new Set(
    events
      .filter((event): event is Extract<AnalyticsEvent, { type: "game" }> => event.type === "game")
      .filter((event) => statsOpponentForModel(event.opponent) === opponent)
      .map((event) => event.gameId),
  );
  return events.filter((event) => matchingGameIds.has(event.gameId));
}
