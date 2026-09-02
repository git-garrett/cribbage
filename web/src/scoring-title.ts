export function scoringTitle(playerName: string, category: "hand" | "crib"): string {
  const possessive = playerName.endsWith("s") ? `${playerName}'` : `${playerName}'s`;
  const countedCards = category === "crib" ? "Crib" : "Hand";
  return `${possessive} ${countedCards}`;
}
