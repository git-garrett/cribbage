import { formatDifference } from "./comparison-difference";

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
  difference: string;
}

function scoringTotal(totals: MyStatsTableTotals): number {
  return totals.peggingDealer + totals.peggingPone + totals.handDealer + totals.handPone + totals.crib;
}

function comparisonRow(label: string, player: number, ai: number): MyStatsTableRow {
  return {
    label,
    player: String(player),
    ai: String(ai),
    difference: formatDifference(player, ai),
  };
}

function averageRow(label: string, playerTotal: number, aiTotal: number, games: number): MyStatsTableRow {
  const player = games > 0 ? playerTotal / games : null;
  const ai = games > 0 ? aiTotal / games : null;
  return {
    label,
    player: player === null ? "-" : player.toFixed(2),
    ai: ai === null ? "-" : ai.toFixed(2),
    difference: formatDifference(player, ai, 2),
  };
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
    comparisonRow("Games", player.games, ai.games),
    comparisonRow("Wins", player.wins, ai.wins),
    comparisonRow("Losses", player.losses, ai.losses),
    comparisonRow("Skunks", player.skunks, ai.skunks),
    comparisonRow("Skunked", player.skunked, ai.skunked),
    comparisonRow("Total scoring", playerScoring, aiScoring),
    averageRow("Avg scoring", playerScoring, aiScoring, scoringGames),
    comparisonRow("Pegging", playerPegging, aiPegging),
    comparisonRow("Hands", playerHands, aiHands),
    comparisonRow("Crib", player.crib, ai.crib),
  ];
}
