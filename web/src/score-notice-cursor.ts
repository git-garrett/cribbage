import type { AnalyticsEvent, GameState } from "./api-types";

export type ScoreEvent = Extract<AnalyticsEvent, { type: "score" }>;

export interface ScoreNoticeCursor {
  initialized: boolean;
  gameId: string | null;
  seenIds: Set<string>;
}

export function createScoreNoticeCursor(): ScoreNoticeCursor {
  return { initialized: false, gameId: null, seenIds: new Set() };
}

export function scoreEventsForGame(
  gameId: string | null,
  analyticsEvents: readonly AnalyticsEvent[],
): ScoreEvent[] {
  if (!gameId) return [];
  return analyticsEvents.filter(
    (event): event is ScoreEvent => event.type === "score" && event.gameId === gameId,
  );
}

export function baselineScoreEvents(
  cursor: ScoreNoticeCursor,
  gameId: string | null,
  analyticsEvents: readonly AnalyticsEvent[],
): void {
  cursor.seenIds = new Set(scoreEventsForGame(gameId, analyticsEvents).map((event) => event.id));
  cursor.initialized = true;
  cursor.gameId = gameId;
}

export function collectNewScoreEvents(
  cursor: ScoreNoticeCursor,
  gameId: string | null,
  analyticsEvents: readonly AnalyticsEvent[],
): ScoreEvent[] {
  const events = scoreEventsForGame(gameId, analyticsEvents);
  if (!cursor.initialized || cursor.gameId !== gameId) {
    baselineScoreEvents(cursor, gameId, analyticsEvents);
    return [];
  }
  const unseen: ScoreEvent[] = [];
  for (const event of events) {
    if (cursor.seenIds.has(event.id)) continue;
    cursor.seenIds.add(event.id);
    unseen.push(event);
  }
  return unseen;
}

export interface CurrentScoringContext {
  handNumber: number;
  scoring: {
    stage: "pone" | "dealer" | "crib";
    owner: string;
    points: number;
  } | null;
  analyticsEvents: readonly AnalyticsEvent[];
}

export function currentScoringScoreEvent(
  gameId: string | null,
  game: CurrentScoringContext,
): ScoreEvent | null {
  const scoring = game.scoring;
  if (!scoring) return null;
  const category = scoring.stage === "crib" ? "crib" : "hand";
  const player = scoring.owner === "User" ? "human" : scoring.owner === "AI" ? "ai" : null;
  if (!player) return null;
  const events = scoreEventsForGame(gameId, game.analyticsEvents);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event.handNumber === game.handNumber &&
      event.category === category &&
      event.player === player
    ) {
      return event;
    }
  }
  return null;
}

export function scoreboardStateForScoringConfirmation(
  game: Pick<GameState, "scores" | "pegPositions">,
  event: ScoreEvent | null,
  confirmedSummaryKey: string | null,
): Pick<GameState, "scores" | "pegPositions"> {
  if (!event || event.id === confirmedSummaryKey) {
    return { scores: game.scores, pegPositions: game.pegPositions };
  }
  const player = event.player;
  const scoreBeforeCount = Math.max(0, game.scores[player] - event.points);
  return {
    scores: { ...game.scores, [player]: scoreBeforeCount },
    pegPositions: {
      ...game.pegPositions,
      [player]: [scoreBeforeCount, scoreBeforeCount],
    },
  };
}
