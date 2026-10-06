export interface HistoryReviewSummary {
  through: string;
  games: number;
  historical: {
    wpPerGame: number | null;
    gamesWithCycles: number;
    cycles: number;
  };
  latest: {
    model: string;
    wpPerGame: number | null;
    meanGameWp: number | null;
    completeGames: number;
    partialGames: number;
    unavailableGames: number;
  };
}

export function historyReviewCopy(review: HistoryReviewSummary): string {
  const wp = (value: number | null) => value === null ? "unavailable" : `${(value * 100).toFixed(2)} WP/game`;
  const model = review.latest.model.replace("schell_table-peg_table-", "Ace ").replace(".fast", "");
  const date = new Date(review.through).toLocaleDateString();
  return `History reviewed through ${date}: handicap against original opponents ${wp(review.historical.wpPerGame)} `
    + `(${review.historical.gamesWithCycles} of ${review.games} games with usable cycles). `
    + `Against ${model}: ${wp(review.latest.wpPerGame)} moving average; ${wp(review.latest.meanGameWp)} average across `
    + `${review.latest.completeGames} fully reviewed games. `
    + `${review.latest.partialGames} partially reviewed; ${review.latest.unavailableGames} unavailable.`;
}
