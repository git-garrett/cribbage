export interface ScoringEmphasisCard {
  id: number;
  rank: string;
  suit: string;
  value: number;
}

type ScoringCategory = "pegging" | "hand" | "crib";

function rankValue(rank: string): number {
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return Number(rank);
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
    ids = new Set(turnCard
      ? hand.filter((card) => card.rank === "J" && card.suit === turnCard.suit).map((card) => card.id)
      : []);
  } else if (normalizedLabel === "flush") ids = flushCardIds(hand, turnCard, category);
  else ids = new Set();
  return allCards.filter((card) => ids.has(card.id)).map((card) => card.id);
}
