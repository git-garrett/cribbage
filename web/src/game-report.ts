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
}

function average(points: number, opportunities: number): string {
  return opportunities ? (points / opportunities).toFixed(2) : "-";
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
    { label: "Result", player: player.wins ? "Win" : "Loss", ai: ai.wins ? "Win" : "Loss" },
    {
      label: "Avg peg as dealer",
      player: average(player.peggingDealer, player.peggingDealerHands),
      ai: average(ai.peggingDealer, ai.peggingDealerHands),
    },
    {
      label: "Avg peg as pone",
      player: average(player.peggingPone, player.peggingPoneHands),
      ai: average(ai.peggingPone, ai.peggingPoneHands),
    },
    {
      label: "Avg hand as dealer",
      player: average(player.handDealer, player.handDealerHands),
      ai: average(ai.handDealer, ai.handDealerHands),
    },
    {
      label: "Avg hand as pone",
      player: average(player.handPone, player.handPoneHands),
      ai: average(ai.handPone, ai.handPoneHands),
    },
    {
      label: "Avg crib",
      player: average(player.crib, player.cribHands),
      ai: average(ai.crib, ai.cribHands),
    },
  ];

  if (player.skunks || player.skunked || ai.skunks || ai.skunked) {
    rows.push({
      label: "Skunk",
      player: specialResult(player.skunks, player.skunked),
      ai: specialResult(ai.skunks, ai.skunked),
    });
  }
  if (player.doubleSkunks || player.doubleSkunked || ai.doubleSkunks || ai.doubleSkunked) {
    rows.push({
      label: "Double skunk",
      player: specialResult(player.doubleSkunks, player.doubleSkunked),
      ai: specialResult(ai.doubleSkunks, ai.doubleSkunked),
    });
  }
  return rows;
}
