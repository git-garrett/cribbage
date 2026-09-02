import type { AnalyticsScoreCategory } from "./api-types";

export function shouldShowScoreBubble(
  fastCounting: boolean,
  category: AnalyticsScoreCategory,
): boolean {
  return !fastCounting || (category !== "hand" && category !== "crib");
}

export function shouldAnimateScoringCards(
  fastCounting: boolean,
  motionAlreadyDisabled: boolean,
): boolean {
  return !fastCounting && !motionAlreadyDisabled;
}
