import type { AnalyticsEvent, GameState } from "./api-types";

type PeggingEvent = Extract<AnalyticsEvent, { type: "pegging" }>;
type OpponentGoState = Pick<
  GameState,
  "phase" | "turn" | "legalCardIds" | "peggingResetPending" | "analyticsEvents"
>;

export function opponentGoEvent(game: OpponentGoState): PeggingEvent | null {
  if (
    game.phase !== "pegging" ||
    game.turn !== "User" ||
    game.legalCardIds.length === 0 ||
    game.peggingResetPending
  ) return null;

  const latestAction = [...game.analyticsEvents]
    .reverse()
    .find((event): event is PeggingEvent => event.type === "pegging" && event.action !== "analysis");
  if (latestAction?.action !== "go" || latestAction.player !== "ai") return null;
  return latestAction;
}
