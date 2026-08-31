import { formatDifference } from "./comparison-difference";

export interface MyStatsTableTotals {
  games: number;
  wins: number;
  skunks: number;
  doubleSkunks: number;
  analyzedGames: number;
  errors: number;
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

export interface MyStatsTableRow {
  label: string;
  player: string;
  ai: string;
  difference: string;
}

function comparisonRow(
  label: string,
  player: number,
  ai: number,
  showDifference = true,
): MyStatsTableRow {
  return {
    label,
    player: String(player),
    ai: String(ai),
    difference: showDifference ? formatDifference(player, ai) : "—",
  };
}

function averageRow(
  label: string,
  playerTotal: number,
  playerHands: number,
  aiTotal: number,
  aiHands: number,
): MyStatsTableRow {
  const player = playerHands > 0 ? playerTotal / playerHands : null;
  const ai = aiHands > 0 ? aiTotal / aiHands : null;
  return {
    label,
    player: player === null ? "-" : player.toFixed(2),
    ai: ai === null ? "-" : ai.toFixed(2),
    difference: formatDifference(player, ai, 2),
  };
}

function fullCycleAverage(totals: MyStatsTableTotals): number | null {
  const phases = [
    [totals.peggingDealer, totals.peggingDealerHands],
    [totals.handDealer, totals.handDealerHands],
    [totals.crib, totals.cribHands],
    [totals.peggingPone, totals.peggingPoneHands],
    [totals.handPone, totals.handPoneHands],
  ] as const;
  if (phases.some(([, hands]) => hands <= 0)) return null;
  return phases.reduce((sum, [points, hands]) => sum + points / hands, 0);
}

function fullCycleRow(player: MyStatsTableTotals, ai: MyStatsTableTotals): MyStatsTableRow {
  const playerCycle = fullCycleAverage(player);
  const aiCycle = fullCycleAverage(ai);
  return {
    label: "Avg full cycle",
    player: playerCycle === null ? "-" : playerCycle.toFixed(2),
    ai: aiCycle === null ? "-" : aiCycle.toFixed(2),
    difference: formatDifference(playerCycle, aiCycle, 2),
  };
}

export function myStatsTableRows(
  player: MyStatsTableTotals,
  ai: MyStatsTableTotals,
): MyStatsTableRow[] {
  return [
    comparisonRow("Games", player.games, ai.games, false),
    comparisonRow("Wins", player.wins, ai.wins),
    comparisonRow("Skunks", player.skunks, ai.skunks),
    comparisonRow("Double skunks", player.doubleSkunks, ai.doubleSkunks),
    averageRow(
      "Avg peg as dealer",
      player.peggingDealer,
      player.peggingDealerHands,
      ai.peggingDealer,
      ai.peggingDealerHands,
    ),
    averageRow(
      "Avg peg as pone",
      player.peggingPone,
      player.peggingPoneHands,
      ai.peggingPone,
      ai.peggingPoneHands,
    ),
    averageRow(
      "Avg hand as dealer",
      player.handDealer,
      player.handDealerHands,
      ai.handDealer,
      ai.handDealerHands,
    ),
    averageRow(
      "Avg hand as pone",
      player.handPone,
      player.handPoneHands,
      ai.handPone,
      ai.handPoneHands,
    ),
    averageRow("Avg crib", player.crib, player.cribHands, ai.crib, ai.cribHands),
    fullCycleRow(player, ai),
  ];
}
