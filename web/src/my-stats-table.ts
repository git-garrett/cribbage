export interface MyStatsTableTotals {
  games: number;
  wins: number;
  losses: number;
  skunks: number;
  skunked: number;
  peggingDealer: number;
  peggingPone: number;
  handDealer: number;
  handPone: number;
  crib: number;
}

export interface MyStatsTableRow {
  label: string;
  player: string;
  ai: string;
}

function scoringTotal(totals: MyStatsTableTotals): number {
  return totals.peggingDealer + totals.peggingPone + totals.handDealer + totals.handPone + totals.crib;
}

function average(total: number, games: number): string {
  return games > 0 ? (total / games).toFixed(2) : "-";
}

export function myStatsTableRows(
  player: MyStatsTableTotals,
  ai: MyStatsTableTotals,
  scoringGames: number,
): MyStatsTableRow[] {
  const playerPegging = player.peggingDealer + player.peggingPone;
  const aiPegging = ai.peggingDealer + ai.peggingPone;
  const playerHands = player.handDealer + player.handPone;
  const aiHands = ai.handDealer + ai.handPone;
  const playerScoring = scoringTotal(player);
  const aiScoring = scoringTotal(ai);

  return [
    { label: "Games", player: String(player.games), ai: String(ai.games) },
    { label: "Wins", player: String(player.wins), ai: String(ai.wins) },
    { label: "Losses", player: String(player.losses), ai: String(ai.losses) },
    { label: "Skunks", player: String(player.skunks), ai: String(ai.skunks) },
    { label: "Skunked", player: String(player.skunked), ai: String(ai.skunked) },
    { label: "Total scoring", player: String(playerScoring), ai: String(aiScoring) },
    { label: "Avg scoring", player: average(playerScoring, scoringGames), ai: average(aiScoring, scoringGames) },
    { label: "Pegging", player: String(playerPegging), ai: String(aiPegging) },
    { label: "Hands", player: String(playerHands), ai: String(aiHands) },
    { label: "Crib", player: String(player.crib), ai: String(ai.crib) },
  ];
}
