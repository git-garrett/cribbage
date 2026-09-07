export interface RankedLeaderboardWin {
  margin: number;
  endedAt: string;
  player: string;
}

export interface RankedLeaderboardPlayer {
  player: string;
  games?: number;
  wins: number;
  losses: number;
  skunks: number;
  skunked: number;
  avgMargin?: number;
  leaderboardPoints?: number;
  cribbagePointsScored?: number;
  cribbagePointsAgainst?: number;
  pointDifferential?: number;
}

export type LeaderboardMetric =
  | "handicap"
  | "pointsPerGame"
  | "winPercentage"
  | "pointDifferential"
  | "totalPoints"
  | "totalWins";

export type LeaderboardWindow = "daily" | "weekly" | "monthly" | "allTime";

export function leaderboardScore(player: RankedLeaderboardPlayer): number {
  const weightedWins = player.wins + player.skunks;
  const weightedResults = weightedWins + player.losses + player.skunked;
  return weightedResults > 0 ? weightedWins / weightedResults : 0;
}

export function rankLeaderboardPlayers<T extends RankedLeaderboardPlayer>(players: readonly T[]): T[] {
  return [...players].sort((left, right) =>
    leaderboardScore(right) - leaderboardScore(left)
    || right.wins / Math.max(1, right.wins + right.losses)
      - left.wins / Math.max(1, left.wins + left.losses)
    || (right.avgMargin ?? 0) - (left.avgMargin ?? 0)
    || left.player.localeCompare(right.player),
  );
}

export function leaderboardMetricValue(player: RankedLeaderboardPlayer, metric: Exclude<LeaderboardMetric, "handicap">): number {
  if (metric === "pointsPerGame") return leaderboardScore(player);
  if (metric === "winPercentage") return player.wins / Math.max(1, player.games ?? player.wins + player.losses);
  if (metric === "pointDifferential") {
    const games = Math.max(1, player.games ?? player.wins + player.losses);
    return (player.pointDifferential ?? (player.avgMargin ?? 0) * games) / games;
  }
  if (metric === "totalPoints") return player.cribbagePointsScored ?? 0;
  return player.wins;
}

/**
 * Every board uses the selected metric first, then sample size, win rate,
 * average margin, and finally the player name. The final name comparison is
 * deliberately stable so equal rows never jump between refreshes.
 */
export function rankLeaderboardMetricPlayers<T extends RankedLeaderboardPlayer>(
  players: readonly T[],
  metric: Exclude<LeaderboardMetric, "handicap">,
): T[] {
  return [...players].sort((left, right) =>
    leaderboardMetricValue(right, metric) - leaderboardMetricValue(left, metric)
    || (right.games ?? 0) - (left.games ?? 0)
    || right.wins / Math.max(1, right.games ?? right.wins + right.losses)
      - left.wins / Math.max(1, left.games ?? left.wins + left.losses)
    || (right.avgMargin ?? 0) - (left.avgMargin ?? 0)
    || left.player.localeCompare(right.player),
  );
}

export interface RankedHandicap {
  player: string;
  wpPerGame: number;
  cycles: number;
}

/** A smaller absolute handicap means the player's decisions are closer to Ace. */
export function rankLeaderboardHandicaps<T extends RankedHandicap>(handicaps: readonly T[]): T[] {
  return [...handicaps].sort((left, right) =>
    Math.abs(left.wpPerGame) - Math.abs(right.wpPerGame)
    || right.cycles - left.cycles
    || left.player.localeCompare(right.player),
  );
}

export function rankLeaderboardWins<T extends RankedLeaderboardWin>(wins: readonly T[]): T[] {
  return [...wins].sort((left, right) =>
    right.margin - left.margin
    || left.endedAt.localeCompare(right.endedAt)
    || left.player.localeCompare(right.player),
  );
}
