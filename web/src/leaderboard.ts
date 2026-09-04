export interface RankedLeaderboardWin {
  margin: number;
  endedAt: string;
  player: string;
}

export interface RankedLeaderboardPlayer {
  player: string;
  wins: number;
  losses: number;
  skunks: number;
  skunked: number;
  avgMargin?: number;
}

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

export function rankLeaderboardWins<T extends RankedLeaderboardWin>(wins: readonly T[]): T[] {
  return [...wins].sort((left, right) =>
    right.margin - left.margin
    || left.endedAt.localeCompare(right.endedAt)
    || left.player.localeCompare(right.player),
  );
}
