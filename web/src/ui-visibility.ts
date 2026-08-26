export type DealCutRevealStage = "cutting" | "human" | "ai" | null;

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
