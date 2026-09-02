import { formatDifference, type ComparisonTone } from "./comparison-difference";

export interface SingleGameReportTotals {
  wins: number;
  losses: number;
  skunks: number;
  skunked: number;
  doubleSkunks: number;
  doubleSkunked: number;
  analyzedGames: number;
  errors: number;
  helps: number;
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

export interface SingleGameReportRow {
  label: string;
  player: string;
  ai: string;
  difference: string;
  playerTone?: ComparisonTone;
  aiTone?: ComparisonTone;
}

function average(points: number, opportunities: number): number | null {
  return opportunities ? points / opportunities : null;
}

function averageRow(
  label: string,
  playerPoints: number,
  playerOpportunities: number,
  aiPoints: number,
  aiOpportunities: number,
): SingleGameReportRow {
  const player = average(playerPoints, playerOpportunities);
  const ai = average(aiPoints, aiOpportunities);
  return {
    label,
    player: player === null ? "-" : player.toFixed(2),
    ai: ai === null ? "-" : ai.toFixed(2),
    difference: formatDifference(player, ai, 2),
  };
}

function specialResult(won: number, lost: number): { value: string; tone?: ComparisonTone } {
  if (won) return { value: "1", tone: "good" };
  if (lost) return { value: "1", tone: "bad" };
  return { value: "—" };
}

function fullCycleAverage(totals: SingleGameReportTotals): number | null {
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

function fullCycleRow(player: SingleGameReportTotals, ai: SingleGameReportTotals): SingleGameReportRow {
  const playerCycle = fullCycleAverage(player);
  const aiCycle = fullCycleAverage(ai);
  return {
    label: "Avg full cycle",
    player: playerCycle === null ? "-" : playerCycle.toFixed(2),
    ai: aiCycle === null ? "-" : aiCycle.toFixed(2),
    difference: formatDifference(playerCycle, aiCycle, 2),
  };
}

export function singleGameReportRows(
  player: SingleGameReportTotals,
  ai: SingleGameReportTotals,
): SingleGameReportRow[] {
  const rows: SingleGameReportRow[] = [
    {
      label: "Result",
      player: player.wins ? "Win" : "Loss",
      ai: ai.wins ? "Win" : "Loss",
      difference: "—",
    },
    averageRow("Avg peg as dealer", player.peggingDealer, player.peggingDealerHands, ai.peggingDealer, ai.peggingDealerHands),
    averageRow("Avg peg as pone", player.peggingPone, player.peggingPoneHands, ai.peggingPone, ai.peggingPoneHands),
    averageRow("Avg hand as dealer", player.handDealer, player.handDealerHands, ai.handDealer, ai.handDealerHands),
    averageRow("Avg hand as pone", player.handPone, player.handPoneHands, ai.handPone, ai.handPoneHands),
    averageRow("Avg crib", player.crib, player.cribHands, ai.crib, ai.cribHands),
    fullCycleRow(player, ai),
    {
      label: "Ace helps",
      player: String(player.helps),
      ai: "—",
      difference: "—",
    },
  ];

  if (player.skunks || player.skunked || ai.skunks || ai.skunked) {
    const playerResult = specialResult(player.skunks, player.skunked);
    const aiResult = specialResult(ai.skunks, ai.skunked);
    rows.push({
      label: "Skunk",
      player: playerResult.value,
      ai: aiResult.value,
      difference: "—",
      playerTone: playerResult.tone,
      aiTone: aiResult.tone,
    });
  }
  if (player.doubleSkunks || player.doubleSkunked || ai.doubleSkunks || ai.doubleSkunked) {
    const playerResult = specialResult(player.doubleSkunks, player.doubleSkunked);
    const aiResult = specialResult(ai.doubleSkunks, ai.doubleSkunked);
    rows.push({
      label: "Double skunk",
      player: playerResult.value,
      ai: aiResult.value,
      difference: "—",
      playerTone: playerResult.tone,
      aiTone: aiResult.tone,
    });
  }
  return rows;
}
