export type DealCutRevealStage = "cutting" | "human" | "ai" | null;
export type TurnCutRevealStage =
  | "user-cut"
  | "user-cutting"
  | "ai-cutting"
  | "user-turn"
  | "ai-turn"
  | "revealed"
  | null;

export interface TurnCutPresentation {
  label: string;
  action: { buttonLabel: string; ariaLabel: string } | null;
}

export function shouldShowStrategicGuides(
  preferenceEnabled: boolean,
  publicGameMode: boolean,
): boolean {
  return preferenceEnabled && !publicGameMode;
}

export function shouldRevealCribOwner(
  phase: string,
  dealCutRevealStage: DealCutRevealStage,
): boolean {
  return phase !== "cut_for_deal" && dealCutRevealStage === null;
}

export function shouldShowDecisionSnapshotCut(
  decisionType: "discard" | "pegging",
  cutCard: string | undefined,
): boolean {
  return decisionType === "pegging" && Boolean(cutCard);
}

export function shouldOfferMasterHint(
  eligibleOpponent: boolean,
  phase: string,
  turn: string | null,
  legalCardCount: number,
  peggingResetPending: boolean,
  interactionBlocked: boolean,
): boolean {
  if (!eligibleOpponent || interactionBlocked) return false;
  if (phase === "discard") return true;
  return phase === "pegging" && turn === "User" && !peggingResetPending && legalCardCount > 0;
}

export function turnCutPresentation(stage: TurnCutRevealStage): TurnCutPresentation | null {
  switch (stage) {
    case "user-cut":
      return {
        label: "Cut the deck for AI",
        action: { buttonLabel: "Cut deck", ariaLabel: "Cut deck" },
      };
    case "user-cutting":
      return { label: "Cutting the deck", action: null };
    case "ai-cutting":
      return { label: "AI cuts the deck", action: null };
    case "user-turn":
      return {
        label: "Turn the cut card",
        action: { buttonLabel: "Turn cut card", ariaLabel: "Turn cut card" },
      };
    case "ai-turn":
      return { label: "AI turns the cut card", action: null };
    case "revealed":
      return {
        label: "Cut card",
        action: { buttonLabel: "OK", ariaLabel: "Continue to pegging" },
      };
    default:
      return null;
  }
}
