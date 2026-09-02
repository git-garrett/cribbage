import type { Opponent, Phase } from "./api-types";

export type ResumablePathwayDestination = "easy" | "tough" | "master" | "human";

function modelDestination(opponent: Opponent | undefined): ResumablePathwayDestination | null {
  if (opponent === "myrmidon-5") return "easy";
  if (opponent === "schell_table-peg_table-9.1" || opponent === "schell_table-peg_table-9.11") return "tough";
  if (opponent === "schell_table-peg_table-13.0") return "master";
  return null;
}

export function resumablePathwayDestinations(options: {
  opponent?: Opponent;
  phase?: Phase;
  modelGameActive: boolean;
  humanGameActive: boolean;
}): ResumablePathwayDestination[] {
  const destinations: ResumablePathwayDestination[] = [];
  if (options.modelGameActive && options.phase !== "game_over") {
    const destination = modelDestination(options.opponent);
    if (destination) destinations.push(destination);
  }
  if (options.humanGameActive) destinations.push("human");
  return destinations;
}
