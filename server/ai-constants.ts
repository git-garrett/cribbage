import type { Opponent } from "../web/src/engine";

export const MODEL: Opponent = "schell_table-peg_table-14.3";
export const MODEL_13: Opponent = "schell_table-peg_table-13.0";
export const MODEL_14_3: Opponent = "schell_table-peg_table-14.3";

export function modelForGameStart(date = new Date()): Opponent {
  return date.getHours() % 2 === 0 ? MODEL_14_3 : MODEL_13;
}
