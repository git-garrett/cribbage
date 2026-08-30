export interface LifetimePlayerStats {
  player: string;
  games: number;
  wins: number;
  losses: number;
  skunks?: number;
  skunked?: number;
  scoringGames?: number;
  analyzedGames?: number;
  errors?: number;
  humanScoring?: LifetimeScoringStats;
  aiScoring?: LifetimeScoringStats;
}

export interface LifetimeScoringStats {
  peggingDealer: number;
  peggingPone: number;
  handDealer: number;
  handPone: number;
  crib: number;
  peggingDealerHands: number;
  peggingPoneHands: number;
  handDealerHands: number;
  handPoneHands: number;
  cribHands: number;
}

export interface ResultTotals {
  games: number;
  wins: number;
  losses: number;
  skunks?: number;
  skunked?: number;
}

export interface MergedLifetimeResults {
  player: string;
  human: Required<ResultTotals> & Partial<LifetimeScoringStats & LifetimeAnalysisStats>;
  ai: Required<ResultTotals> & Partial<LifetimeScoringStats>;
  source: "server" | "local";
  scoringGames?: number;
}

export interface LifetimeAnalysisStats {
  analyzedGames: number;
  errors: number;
}

function normalizedPlayerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function completeResults(totals: ResultTotals): Required<ResultTotals> {
  return {
    games: totals.games,
    wins: totals.wins,
    losses: totals.losses,
    skunks: totals.skunks ?? 0,
    skunked: totals.skunked ?? 0,
  };
}

/**
 * The server row is already deduplicated across devices and historical aliases,
 * so it replaces rather than adds to local results. Local analytics remain the
 * fallback until the leaderboard request completes.
 */
export function mergedLifetimeResults(
  playerName: string,
  players: LifetimePlayerStats[],
  local: { human: ResultTotals; ai: ResultTotals },
): MergedLifetimeResults {
  const normalized = normalizedPlayerName(playerName);
  const server = normalized
    ? players.find((player) => normalizedPlayerName(player.player) === normalized)
    : undefined;
  if (!server) {
    return {
      player: playerName.trim() || "User",
      human: completeResults(local.human),
      ai: completeResults(local.ai),
      source: "local",
    };
  }
  const human = completeResults(server);
  const analysis = typeof server.analyzedGames === "number" && typeof server.errors === "number"
    ? { analyzedGames: server.analyzedGames, errors: server.errors }
    : {};
  return {
    player: server.player,
    human: { ...human, ...server.humanScoring, ...analysis },
    ai: {
      games: human.games,
      wins: human.losses,
      losses: human.wins,
      skunks: human.skunked,
      skunked: human.skunks,
      ...server.aiScoring,
    },
    source: "server",
    scoringGames: server.scoringGames,
  };
}
