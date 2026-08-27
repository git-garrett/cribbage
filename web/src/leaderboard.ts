export interface RankedLeaderboardWin {
  margin: number;
  endedAt: string;
  player: string;
}

export function rankLeaderboardWins<T extends RankedLeaderboardWin>(wins: readonly T[]): T[] {
  return [...wins].sort((left, right) =>
    right.margin - left.margin
    || left.endedAt.localeCompare(right.endedAt)
    || left.player.localeCompare(right.player),
  );
}
