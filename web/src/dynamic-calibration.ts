export interface DynamicCalibration {
  started: boolean;
  completeCycles: number;
  minimumCycles: number;
  complete: boolean;
  provisionalHandicapPerGame?: number | null;
}

export const DYNAMIC_CALIBRATION_INVITE = "Calibrate and get a handicap!";
export const DYNAMIC_CALIBRATING_LABEL = "CALIBRATING";
export const DYNAMIC_CALIBRATED_COPY = "Adapts to your play and plays back at your skill.";

export function isDynamicCalibrating(calibration: DynamicCalibration | null | undefined): boolean {
  return Boolean(
    calibration?.started &&
    !calibration.complete &&
    calibration.completeCycles < calibration.minimumCycles,
  );
}

export function dynamicCardCopy(
  calibration: DynamicCalibration | null | undefined,
  hasStartedGame: boolean,
): string {
  if (!calibration?.started && !hasStartedGame) return DYNAMIC_CALIBRATION_INVITE;
  if (!calibration || isDynamicCalibrating(calibration)) return DYNAMIC_CALIBRATING_LABEL;
  return DYNAMIC_CALIBRATED_COPY;
}

export function freshestDynamicCalibration(
  current: DynamicCalibration | null | undefined,
  candidate: DynamicCalibration | null | undefined,
): DynamicCalibration | null | undefined {
  if (!candidate) return current;
  if (!current || candidate.completeCycles > current.completeCycles) return candidate;
  return current;
}

export function dynamicProvisionalHandicapCopy(
  calibration: DynamicCalibration | null | undefined,
): string | null {
  const handicap = calibration?.provisionalHandicapPerGame;
  if (typeof handicap !== "number" || !Number.isFinite(handicap)) return null;
  return `Provisional Handicap: ${dynamicHandicapPointsCopy(handicap)} WP pts/game`;
}

export function dynamicHandicapPointsCopy(handicap: number): string {
  return Math.abs(handicap * 100).toFixed(2);
}

export function playerHandicapCopy(
  handicap: { wpPerGame: number } | null | undefined,
): string | null {
  if (!handicap || !Number.isFinite(handicap.wpPerGame)) return null;
  return `(${dynamicHandicapPointsCopy(handicap.wpPerGame)})`;
}
