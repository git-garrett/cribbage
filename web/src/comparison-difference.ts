export function formatDifference(
  player: number | null,
  ai: number | null,
  decimalPlaces = 0,
): string {
  if (player === null || ai === null) return "—";
  const rounded = Number((player - ai).toFixed(decimalPlaces));
  const magnitude = Math.abs(rounded).toFixed(decimalPlaces);
  if (rounded > 0) return `+${magnitude}`;
  if (rounded < 0) return `−${magnitude}`;
  return magnitude;
}
