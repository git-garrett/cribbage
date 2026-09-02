import {
  handScoringCombinations,
  scoringEmphasisCardIds,
  type HandScoreComponent,
  type ScoringEmphasisCard,
} from "./scoring-card-emphasis";

export interface ScoreNoticeEvent {
  handNumber: number;
  player: string;
  category: string;
  points: number;
  reason?: string;
  scoreComponents?: {
    total: number;
    fifteens?: number;
    thirtyOne?: number;
    runs?: number;
    pairs?: number;
    flush?: number;
    knobs?: number;
    lastCard?: number;
  };
}

export interface ScoreNoticePart {
  label: string;
  points: number;
  cardIds?: number[];
}

export function scoreNoticeEmphasisCardIds(
  event: ScoreNoticeEvent,
  part: ScoreNoticePart,
  hand: readonly ScoringEmphasisCard[] | undefined,
  turnCard: ScoringEmphasisCard | null,
): number[] {
  if (part.cardIds) return part.cardIds;
  if (event.reason === "Heels") return turnCard ? [turnCard.id] : [];
  if (!hand) return [];
  const category = event.category === "hand" || event.category === "crib"
    ? event.category
    : "pegging";
  return scoringEmphasisCardIds(hand, turnCard, category, part.label);
}

export function shouldAnnounceScoreEvent(
  event: ScoreNoticeEvent,
  events: readonly ScoreNoticeEvent[],
): boolean {
  if (event.points !== 0) return true;
  if (event.category !== "hand" && event.category !== "crib") return false;
  return !events.some((candidate) =>
    candidate.points > 0 &&
    candidate.handNumber === event.handNumber &&
    candidate.player === event.player &&
    candidate.category === event.category
  );
}

export function handScoreNoticeParts(
  event: ScoreNoticeEvent,
  hand?: readonly ScoringEmphasisCard[],
  turnCard: ScoringEmphasisCard | null = null,
): ScoreNoticePart[] | null {
  if (event.points <= 0 || (event.category !== "hand" && event.category !== "crib")) return null;
  if (!event.scoreComponents) return null;
  const ordered: Array<[HandScoreComponent, string]> = [
    ["fifteens", "Fifteens"],
    ["runs", "Runs"],
    ["pairs", "Pairs"],
    ["knobs", "Knobs"],
    ["flush", "Flush"],
  ];
  const combinations = hand
    ? handScoringCombinations(hand, turnCard, event.category)
    : [];
  const parts = ordered.flatMap(([key, label]) => {
    const points = event.scoreComponents?.[key];
    if (typeof points !== "number" || points <= 0) return [];
    const exact = combinations.filter((combination) => combination.component === key);
    const exactPoints = exact.reduce((total, combination) => total + combination.points, 0);
    if (exact.length && exactPoints === points) {
      return exact.map((combination) => ({
        label: combination.label,
        points: combination.points,
        cardIds: combination.cardIds,
      }));
    }
    return [{ label, points }];
  });
  return parts.length ? parts : null;
}

export function peggingScoreNoticeParts(event: ScoreNoticeEvent): ScoreNoticePart[] | null {
  if (event.points <= 0 || event.category !== "pegging" || !event.scoreComponents) return null;
  const components = event.scoreComponents;
  const pairLabel = components.pairs === 6
    ? "Pair Royal"
    : components.pairs === 12
      ? "Double Pair Royal"
      : "Pair";
  const ordered: Array<[number | undefined, string]> = [
    [components.fifteens, "Fifteen"],
    [components.thirtyOne, "Thirty-one"],
    [components.runs, "Run"],
    [components.pairs, pairLabel],
    [components.lastCard, "Last card"],
  ];
  const parts = ordered.flatMap(([points, label]) =>
    typeof points === "number" && points > 0 ? [{ label, points }] : []
  );
  return parts.length ? parts : null;
}
