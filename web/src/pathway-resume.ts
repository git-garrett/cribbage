import type { Opponent, Phase } from "./api-types";

export type ResumablePathwayDestination = "easy" | "tough" | "master" | "dynamic" | "human";

export interface ResumableModelGame {
  opponent?: Opponent;
  phase?: Phase;
}

function modelDestination(opponent: Opponent | undefined): ResumablePathwayDestination | null {
  if (opponent === "myrmidon-5") return "easy";
  if (opponent === "schell_table-peg_table-9.1" || opponent === "schell_table-peg_table-9.11") return "tough";
  if (opponent === "schell_table-peg_table-13.0") return "master";
  if (opponent === "dynamic") return "dynamic";
  return null;
}

export function resumablePathwayDestinations(options: {
  modelGames: ResumableModelGame[];
  humanGameActive: boolean;
}): ResumablePathwayDestination[] {
  const destinations: ResumablePathwayDestination[] = [];
  for (const game of options.modelGames) {
    if (game.phase === "game_over") continue;
    const destination = modelDestination(game.opponent);
    if (destination && !destinations.includes(destination)) destinations.push(destination);
  }
  if (options.humanGameActive) destinations.push("human");
  return destinations;
}
