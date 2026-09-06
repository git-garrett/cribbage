export type RestoredPathwayRoute = "home" | "play" | "human" | "tutorial" | "settings" | "gameplay" | "statistics" | "leaderboard";

export function shouldRestoreSavedGameSurface(options: {
  route: RestoredPathwayRoute | null;
  activeGame: boolean;
}): boolean {
  return options.activeGame && options.route === null;
}
