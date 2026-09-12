export type RestoredPathwayRoute =
  | "home"
  | "play"
  | "human"
  | "tutorial"
  | "drills"
  | "drills-beginner"
  | "intro-pegging"
  | "intro-discard"
  | "drill-scoring-play"
  | "drill-discard"
  | "settings"
  | "gameplay"
  | "sounds"
  | "statistics"
  | "leaderboard";

export function shouldRestoreSavedGameSurface(options: {
  route: RestoredPathwayRoute | null;
  activeGame: boolean;
}): boolean {
  return options.activeGame && options.route === null;
}
