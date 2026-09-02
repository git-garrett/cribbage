import type { GameState } from "./api-types";

export type AceAdviceAction = "discard" | "play";

export interface AceRecommendation {
  kind: "discard" | "play" | "go";
  cardIds: number[];
}

export function isAceAdviceOpponent(opponent: string | undefined): boolean {
  return opponent === "myrmidon-5"
    || opponent === "schell_table-peg_table-9.1"
    || opponent === "schell_table-peg_table-9.11";
}

function canonicalCardIds(cardIds: readonly number[]): string {
  return [...cardIds].sort((a, b) => a - b).join(",");
}

export function aceAdviceDecisionKey(gameId: string | undefined, game: GameState): string {
  return [
    gameId ?? "game",
    game.handNumber,
    game.phase,
    game.count,
    game.completedPlays.length,
    game.plays.map((card) => card.id).join(","),
    canonicalCardIds(game.humanHand.map((card) => card.id)),
    canonicalCardIds(game.legalCardIds),
  ].join(":");
}

export function choiceDiffersFromAce(
  action: AceAdviceAction,
  selectedCardIds: readonly number[],
  recommendation: AceRecommendation,
): boolean {
  if (recommendation.kind !== action) return false;
  return canonicalCardIds(selectedCardIds) !== canonicalCardIds(recommendation.cardIds);
}
