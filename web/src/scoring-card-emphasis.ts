export interface ScoringEmphasisCard {
  id: number;
  rank: string;
  suit: string;
  value: number;
}

type ScoringCategory = "pegging" | "hand" | "crib";
export type HandScoreComponent = "fifteens" | "runs" | "pairs" | "knobs" | "flush";

export interface HandScoringCombination {
  component: HandScoreComponent;
  label: "Fifteen" | "Run" | "Pair" | "Pair Royal" | "Double Pair Royal" | "Knobs" | "Flush";
  points: number;
  cardIds: number[];
}

function rankValue(rank: string): number {
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return Number(rank);
}

function fifteenCombinations(cards: readonly ScoringEmphasisCard[]): HandScoringCombination[] {
  const combinations: HandScoringCombination[] = [];
  for (let mask = 1; mask < (1 << cards.length); mask += 1) {
    let total = 0;
    const cardIds: number[] = [];
    for (let index = 0; index < cards.length; index += 1) {
      if (!(mask & (1 << index))) continue;
      total += cards[index].value;
      cardIds.push(cards[index].id);
    }
    if (total === 15) combinations.push({ component: "fifteens", label: "Fifteen", points: 2, cardIds });
  }
  return combinations;
}

interface RankGroup {
  rank: number;
  cards: ScoringEmphasisCard[];
}

function rankGroups(cards: readonly ScoringEmphasisCard[]): RankGroup[] {
  const grouped = new Map<number, ScoringEmphasisCard[]>();
  for (const card of cards) {
    const rank = rankValue(card.rank);
    const group = grouped.get(rank) ?? [];
    group.push(card);
    grouped.set(rank, group);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rank, groupedCards]) => ({ rank, cards: groupedCards }));
}

function longestRunGroups(cards: readonly ScoringEmphasisCard[]): RankGroup[][] {
  const spans: RankGroup[][] = [];
  let current: RankGroup[] = [];
  for (const group of rankGroups(cards)) {
    if (!current.length || group.rank === current[current.length - 1].rank + 1) current.push(group);
    else {
      spans.push(current);
      current = [group];
    }
  }
  if (current.length) spans.push(current);
  const longest = Math.max(0, ...spans.map((span) => span.length));
  return longest >= 3 ? spans.filter((span) => span.length === longest) : [];
}

function runCombinations(cards: readonly ScoringEmphasisCard[]): HandScoringCombination[] {
  const combinations: HandScoringCombination[] = [];
  for (const run of longestRunGroups(cards)) {
    let selections: ScoringEmphasisCard[][] = [[]];
    for (const group of run) {
      selections = selections.flatMap((selection) =>
        group.cards.map((card) => [...selection, card])
      );
    }
    for (const selection of selections) {
      combinations.push({
        component: "runs",
        label: "Run",
        points: run.length,
        cardIds: selection.map((card) => card.id),
      });
    }
  }
  return combinations;
}

function pairCombinations(cards: readonly ScoringEmphasisCard[]): HandScoringCombination[] {
  const combinations: HandScoringCombination[] = [];
  for (const group of rankGroups(cards)) {
    if (group.cards.length < 2) continue;
    const label = group.cards.length === 3
      ? "Pair Royal"
      : group.cards.length === 4
        ? "Double Pair Royal"
        : "Pair";
    const points = group.cards.length * (group.cards.length - 1);
    combinations.push({
      component: "pairs",
      label,
      points,
      cardIds: group.cards.map((card) => card.id),
    });
  }
  return combinations;
}

function knobsCombination(
  hand: readonly ScoringEmphasisCard[],
  turnCard: ScoringEmphasisCard | null,
): HandScoringCombination[] {
  if (!turnCard) return [];
  const jack = hand.find((card) => card.rank === "J" && card.suit === turnCard.suit);
  return jack
    ? [{ component: "knobs", label: "Knobs", points: 1, cardIds: [jack.id, turnCard.id] }]
    : [];
}

function flushCombination(
  hand: readonly ScoringEmphasisCard[],
  turnCard: ScoringEmphasisCard | null,
  category: ScoringCategory,
): HandScoringCombination[] {
  if (!hand.length || !hand.every((card) => card.suit === hand[0].suit)) return [];
  const turnMatches = Boolean(turnCard && turnCard.suit === hand[0].suit);
  if (category === "crib" && !turnMatches) return [];
  const cardIds = [
    ...hand.map((card) => card.id),
    ...(turnMatches && turnCard ? [turnCard.id] : []),
  ];
  return [{ component: "flush", label: "Flush", points: cardIds.length, cardIds }];
}

export function handScoringCombinations(
  hand: readonly ScoringEmphasisCard[],
  turnCard: ScoringEmphasisCard | null,
  category: "hand" | "crib",
): HandScoringCombination[] {
  const allCards = turnCard ? [...hand, turnCard] : [...hand];
  return [
    ...fifteenCombinations(allCards),
    ...runCombinations(allCards),
    ...pairCombinations(allCards),
    ...knobsCombination(hand, turnCard),
    ...flushCombination(hand, turnCard, category),
  ];
}

function fifteenCardIds(cards: readonly ScoringEmphasisCard[]): Set<number> {
  const ids = new Set<number>();
  for (let mask = 1; mask < (1 << cards.length); mask += 1) {
    let total = 0;
    for (let index = 0; index < cards.length; index += 1) {
      if (mask & (1 << index)) total += cards[index].value;
    }
    if (total !== 15) continue;
    for (let index = 0; index < cards.length; index += 1) {
      if (mask & (1 << index)) ids.add(cards[index].id);
    }
  }
  return ids;
}

function runCardIds(cards: readonly ScoringEmphasisCard[]): Set<number> {
  const ranks = [...new Set(cards.map((card) => rankValue(card.rank)))].sort((left, right) => left - right);
  const runs: number[][] = [];
  let current: number[] = [];
  for (const rank of ranks) {
    if (!current.length || rank === current[current.length - 1] + 1) current.push(rank);
    else {
      if (current.length >= 3) runs.push(current);
      current = [rank];
    }
  }
  if (current.length >= 3) runs.push(current);
  const longest = Math.max(0, ...runs.map((run) => run.length));
  const scoringRanks = new Set(runs.filter((run) => run.length === longest).flat());
  return new Set(cards.filter((card) => scoringRanks.has(rankValue(card.rank))).map((card) => card.id));
}

function pairCardIds(cards: readonly ScoringEmphasisCard[]): Set<number> {
  const rankCounts = new Map<number, number>();
  for (const card of cards) {
    const rank = rankValue(card.rank);
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
  }
  return new Set(cards.filter((card) => (rankCounts.get(rankValue(card.rank)) ?? 0) >= 2).map((card) => card.id));
}

function flushCardIds(
  hand: readonly ScoringEmphasisCard[],
  turnCard: ScoringEmphasisCard | null,
  category: ScoringCategory,
): Set<number> {
  if (!hand.length || !hand.every((card) => card.suit === hand[0].suit)) return new Set();
  const turnMatches = Boolean(turnCard && turnCard.suit === hand[0].suit);
  if (category === "crib" && !turnMatches) return new Set();
  return new Set([
    ...hand.map((card) => card.id),
    ...(turnMatches && turnCard ? [turnCard.id] : []),
  ]);
}

export function scoringEmphasisCardIds(
  hand: readonly ScoringEmphasisCard[],
  turnCard: ScoringEmphasisCard | null,
  category: ScoringCategory,
  scoreLabel: string,
): number[] {
  if (category !== "hand" && category !== "crib") return [];
  const allCards = turnCard ? [...hand, turnCard] : [...hand];
  const normalizedLabel = scoreLabel.toLowerCase();
  let ids: Set<number>;
  if (normalizedLabel.startsWith("fifteen")) ids = fifteenCardIds(allCards);
  else if (normalizedLabel.startsWith("run")) ids = runCardIds(allCards);
  else if (normalizedLabel.startsWith("pair")) ids = pairCardIds(allCards);
  else if (normalizedLabel === "knobs") {
    const matchingJacks = turnCard
      ? hand.filter((card) => card.rank === "J" && card.suit === turnCard.suit)
      : [];
    ids = new Set([
      ...matchingJacks.map((card) => card.id),
      ...(matchingJacks.length && turnCard ? [turnCard.id] : []),
    ]);
  } else if (normalizedLabel === "flush") ids = flushCardIds(hand, turnCard, category);
  else ids = new Set();
  return allCards.filter((card) => ids.has(card.id)).map((card) => card.id);
}
