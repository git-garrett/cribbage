export const PRODUCTION_ACE_OPPONENT = "schell_table-peg_table-28.3.fast" as const;

export const ACE_OPPONENTS = [
  PRODUCTION_ACE_OPPONENT,
  "schell_table-peg_table-28.3",
  "schell_table-peg_table-13.23",
  "schell_table-peg_table-13.215",
  "schell_table-peg_table-13.0",
] as const;

export function isAceOpponent(opponent: string | undefined): boolean {
  return ACE_OPPONENTS.some((model) => model === opponent);
}
