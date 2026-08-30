import { formatDifference } from "./comparison-difference";

export interface SingleGameReportTotals {
  wins: number;
  losses: number;
  skunks: number;
  skunked: number;
  doubleSkunks: number;
  doubleSkunked: number;
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

function specialResult(won: number, lost: number): string {
  if (won) return "Won";
  if (lost) return "Lost";
  return "—";
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
  ];

  if (player.skunks || player.skunked || ai.skunks || ai.skunked) {
    rows.push({
      label: "Skunk",
      player: specialResult(player.skunks, player.skunked),
      ai: specialResult(ai.skunks, ai.skunked),
      difference: "—",
    });
  }
  if (player.doubleSkunks || player.doubleSkunked || ai.doubleSkunks || ai.doubleSkunked) {
    rows.push({
      label: "Double skunk",
      player: specialResult(player.doubleSkunks, player.doubleSkunked),
      ai: specialResult(ai.doubleSkunks, ai.doubleSkunked),
      difference: "—",
    });
  }
  return rows;
}
