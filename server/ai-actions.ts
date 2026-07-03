import { performance } from "node:perf_hooks";
import {
  CribbageGame,
  WinGame,
  hasLoadedOpponentResources,
  loadOpponentResources,
  type GameSnapshot,
  type Opponent,
} from "../web/src/engine";
import { MODEL, MODEL_13 } from "./ai-constants";
import { installProtectedAssetFetch } from "./protected-assets";

installProtectedAssetFetch();

type JsonRecord = Record<string, unknown>;

function gamePayload(game: CribbageGame): JsonRecord {
  return {
    state: game.state(),
    snapshot: game.snapshot(),
  };
}

let modelPromise: Promise<void> | null = null;

export function hasDefaultModelLoaded(): boolean {
  return hasLoadedOpponentResources(MODEL);
}

export async function ensureModel(): Promise<void> {
  if (hasLoadedOpponentResources(MODEL)) return;
  modelPromise ??= loadOpponentResources(MODEL).finally(() => {
    modelPromise = null;
  });
  await modelPromise;
}

async function ensureOpponentModel(opponent: Opponent): Promise<void> {
  if (hasLoadedOpponentResources(opponent)) return;
  await loadOpponentResources(opponent);
}

export async function handleGameAction(requestBody: JsonRecord): Promise<JsonRecord> {
  const action = String(requestBody.action || "");
  const payload = (requestBody.payload && typeof requestBody.payload === "object"
    ? requestBody.payload
    : {}) as JsonRecord;
  let game: CribbageGame;
  try {
    if (action === "new") {
      const opponent = (typeof payload.opponent === "string" && payload.opponent
        ? payload.opponent
        : MODEL_13) as Opponent;
      game = new CribbageGame(opponent, undefined, { dealMode: "cut" });
      return gamePayload(game);
    }
    if (action === "trouble-game") {
      game = new CribbageGame(MODEL);
      game.startTroublePeggingPosition();
      return gamePayload(game);
    }
    if (!requestBody.snapshot) throw new Error("Missing game snapshot.");
    game = CribbageGame.restore(requestBody.snapshot as GameSnapshot);
    switch (action) {
      case "state":
        break;
      case "cut-for-deal":
        game.cutForDeal();
        break;
      case "prepare-cut-for-deal": {
        if (game.phase !== "cut_for_deal") throw new Error("It is not time to cut for deal.");
        game.cutForDeal();
        let recommendation: { cards: unknown[]; cardIds: number[]; bestLead: number | null } | null = null;
        if (game.phase === "discard") {
          await ensureOpponentModel(game.opponent as Opponent);
          recommendation = game.recommendAiDiscard();
        }
        return {
          state: game.state(),
          snapshot: game.snapshot(),
          recommendation,
        };
      }
      case "discard":
        game.discard((payload.ids as number[]) || []);
        break;
      case "prepare-ai-discard": {
        await ensureOpponentModel(game.opponent as Opponent);
        const recommendation = game.recommendAiDiscard();
        return {
          state: game.state(),
          snapshot: game.snapshot(),
          recommendation,
        };
      }
      case "prepare-next-hand-ai-discard": {
        if (!["score_pone", "score_dealer", "score_crib"].includes(game.phase)) {
          throw new Error("The next hand is not ready to prepare.");
        }
        while (game.phase !== "discard" && game.phase !== "game_over") {
          try {
            game.continueScoring();
          } catch (error) {
            if (error instanceof WinGame) break;
            throw error;
          }
        }
        if (game.phase === "game_over") throw new Error("Game ends before the next hand.");
        await ensureOpponentModel(game.opponent as Opponent);
        const recommendation = game.recommendAiDiscard();
        return {
          state: game.state(),
          snapshot: game.snapshot(),
          recommendation,
        };
      }
      case "finish-discard":
        if (game.phase !== "ai_discarding") break;
        await ensureOpponentModel(game.opponent as Opponent);
        game.finishDiscard();
        break;
      case "finish-discard-with-cards":
        if (game.phase !== "ai_discarding") break;
        await ensureOpponentModel(game.opponent as Opponent);
        game.finishDiscardWithAiCards((payload.ids as number[]) || [], typeof payload.bestLead === "number" ? payload.bestLead : null);
        break;
      case "play":
        game.play(payload.id as number);
        break;
      case "play-human":
        game.playHumanPeggingCard(payload.id as number);
        break;
      case "go":
        game.go();
        break;
      case "go-human":
        game.humanPeggingGo();
        break;
      case "advance-pegging": {
        const startedAt = performance.now();
        const needsAiDecision = game.advanceForcedPeggingToHumanOrDecision();
        if (needsAiDecision) {
          await ensureOpponentModel(game.opponent as Opponent);
          game.advancePeggingToHuman();
          game.recordAiPeggingThinkTime(performance.now() - startedAt);
        }
        break;
      }
      case "acknowledge-pegging-reset":
        game.acknowledgePeggingReset();
        break;
      case "complete-decision-reviews":
        await ensureModel();
        game.completePendingDecisionReviews();
        break;
      case "continue-scoring":
        game.continueScoring();
        break;
      default:
        throw new Error(`Unknown game action: ${action}`);
    }
    return gamePayload(game);
  } catch (error) {
    if (error instanceof WinGame && game!) return gamePayload(game);
    throw error;
  }
}

export async function recommendAiDiscard(requestBody: JsonRecord): Promise<JsonRecord> {
  await ensureModel();
  const game = CribbageGame.restore(requestBody.snapshot as GameSnapshot);
  const recommendation = game.recommendAiDiscard();
  return { ...recommendation, model: MODEL };
}

export async function recommendAiPeg(requestBody: JsonRecord): Promise<JsonRecord> {
  await ensureModel();
  const game = CribbageGame.restore(requestBody.snapshot as GameSnapshot);
  const action = game.recommendAiPeggingAction();
  return { ...action, model: MODEL };
}
