import { parentPort } from "node:worker_threads";
import {
  handleGameAction,
  hasDefaultModelLoaded,
  recommendAiDiscard,
  recommendAiPeg,
} from "./ai-actions";

type JsonRecord = Record<string, unknown>;

interface AiWorkerRequest {
  id: number;
  kind: "game-action" | "ai-discard" | "ai-peg" | "model-status";
  requestBody: JsonRecord;
}

if (!parentPort) throw new Error("AI worker requires a parent port.");

parentPort.on("message", (message: AiWorkerRequest) => {
  void (async () => {
    try {
      let payload: JsonRecord;
      if (message.kind === "game-action") {
        payload = await handleGameAction(message.requestBody);
      } else if (message.kind === "ai-discard") {
        payload = await recommendAiDiscard(message.requestBody);
      } else if (message.kind === "ai-peg") {
        payload = await recommendAiPeg(message.requestBody);
      } else {
        payload = { loaded: hasDefaultModelLoaded() };
      }
      parentPort.postMessage({ id: message.id, ok: true, payload });
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      });
    }
  })();
});
