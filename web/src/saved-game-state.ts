import type { GameState } from "./api-types";

type ResumableGameState = Pick<GameState, "phase" | "humanHand" | "aiHandCount" | "cutForDeal">;

export function isCoherentSavedGameState(game: ResumableGameState): boolean {
  if (game.phase === "cut_for_deal") {
    return game.humanHand.length === 6 && Boolean(game.cutForDeal?.human && game.cutForDeal.ai);
  }
  if (game.phase === "discard") {
    return game.humanHand.length === 6 && game.aiHandCount === 6;
  }
  if (game.phase === "ai_discarding") {
    return game.humanHand.length === 4 && game.aiHandCount === 6;
  }
  return true;
}
