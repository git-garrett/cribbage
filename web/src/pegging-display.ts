export interface PeggingDisplayState<Card> {
  plays: Card[];
  completedPlays: Card[][];
  peggingResetPending: boolean;
}

export interface PeggingDisplaySeries<Card> {
  cards: Card[];
  current: boolean;
}

export function peggingDisplaySeries<Card>(
  state: PeggingDisplayState<Card>,
): PeggingDisplaySeries<Card>[] {
  const completed = state.completedPlays.filter((cards) => cards.length > 0);
  if (state.plays.length > 0) {
    return [
      ...completed.map((cards) => ({ cards, current: false })),
      { cards: state.plays, current: true },
    ];
  }
  if (state.peggingResetPending && completed.length > 0) {
    return [
      ...completed.slice(0, -1).map((cards) => ({ cards, current: false })),
      { cards: completed.at(-1)!, current: true },
    ];
  }
  return completed.map((cards) => ({ cards, current: false }));
}
