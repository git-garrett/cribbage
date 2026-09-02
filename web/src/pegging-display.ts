export interface PeggingDisplayState<Card> {
  plays: Card[];
  completedPlays: Card[][];
  peggingResetPending: boolean;
}

export interface PeggingDisplaySeries<Card> {
  cards: Card[];
  current: boolean;
}

export interface RecentPeggingCards<Card> {
  hidden: Card[];
  visible: Card[];
}

export function peggingDisplayCardLimit(viewportWidth: number): number {
  return viewportWidth <= 640 ? 7 : 4;
}

export function recentPeggingCards<Card>(cards: Card[], visibleLimit: number): RecentPeggingCards<Card> {
  const cutoff = Math.max(0, cards.length - Math.max(0, visibleLimit));
  return {
    hidden: cards.slice(0, cutoff),
    visible: cards.slice(cutoff),
  };
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
