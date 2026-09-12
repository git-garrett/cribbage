export type TrainingIntroKind = "pegging" | "discard";

export interface TrainingIntroStep {
  id: string;
  title: string;
  explanation: string;
  hand: string[];
  selected: string[];
  played: string[];
  playedCard: string | null;
  cutCard: string | null;
  countBefore: number;
  points: number;
}

export interface TrainingIntro {
  kind: TrainingIntroKind;
  title: string;
  eyebrow: string;
  introduction: string;
  steps: TrainingIntroStep[];
  completionTitle: string;
  completion: string;
  drillRoute: "drill-scoring-play" | "drill-discard";
}

export function trainingIntroAnswer(step: TrainingIntroStep, kind: TrainingIntroKind): string[] {
  return kind === "pegging"
    ? [step.playedCard].filter((card): card is string => Boolean(card))
    : [...step.selected];
}

export function trainingIntroRequiredSelections(kind: TrainingIntroKind): number {
  return kind === "pegging" ? 1 : 2;
}

export function correctTrainingIntroChoice(step: TrainingIntroStep, kind: TrainingIntroKind, chosen: string[]): boolean {
  return JSON.stringify([...chosen].sort()) === JSON.stringify(trainingIntroAnswer(step, kind).sort());
}

export const TRAINING_INTROS: Record<TrainingIntroKind, TrainingIntro> = {
  pegging: {
    kind: "pegging",
    title: "Pegging Intro",
    eyebrow: "Beginner · Pegging",
    introduction: "Pegging happens after both players discard. You take turns playing one card without letting the running count pass 31. You move your pegs when your card makes a pair, reaches 15 or 31, or completes a run.",
    steps: [
      { id: "pair", title: "Pair", explanation: "Play the same rank as the card just played. A pair scores 2 points. Here, your 6 joins the 6 already on the table.", hand: ["6d", "9c", "Jh", "Qs"], selected: [], played: ["6c"], playedCard: "6d", cutCard: "8h", countBefore: 6, points: 2 },
      { id: "fifteen", title: "Fifteen", explanation: "Make the running count exactly 15 to score 2 points. The count is 10, so playing your 5 makes 15.", hand: ["5h", "7c", "9d", "Ks"], selected: [], played: ["10s"], playedCard: "5h", cutCard: "3d", countBefore: 10, points: 2 },
      { id: "run-three", title: "Run of three", explanation: "The most recent cards can form a run even when they arrive out of order. Playing 4 after 3 and 5 makes 3–4–5 and scores 3 points.", hand: ["4h", "8c", "9s", "Qd"], selected: [], played: ["3c", "5d"], playedCard: "4h", cutCard: "Jc", countBefore: 8, points: 3 },
      { id: "run-four", title: "Run of four", explanation: "Add the next rank to a three-card run to score 4 points. Playing 5 after 2, 4, and 3 makes 2–3–4–5.", hand: ["5s", "7h", "9c", "Kd"], selected: [], played: ["2c", "4d", "3h"], playedCard: "5s", cutCard: "Qc", countBefore: 9, points: 4 },
    ],
    completionTitle: "You understand beginner pegging.",
    completion: "You can now spot pairs, fifteens, and short runs while the count builds. The drills will give you one clear scoring play at a time.",
    drillRoute: "drill-scoring-play",
  },
  discard: {
    kind: "discard",
    title: "Discard Intro",
    eyebrow: "Beginner · Discarding",
    introduction: "At the start of each hand, choose two of your six cards for the crib. The other four become your hand. Begin by keeping cards that already work together—pairs, fifteens, runs, and flushes—while remembering whose crib receives the two discards.",
    steps: [
      { id: "pair", title: "Pair", explanation: "A pair scores 2 points. Discard the queen and king here to keep the two 4s together in your four-card hand.", hand: ["4c", "4d", "6s", "9h", "Qc", "Kd"], selected: ["Qc", "Kd"], played: [], playedCard: null, cutCard: "2h", countBefore: 0, points: 2 },
      { id: "fifteen", title: "Fifteen", explanation: "Any combination totaling 15 scores 2 points. Discard the queen and king to keep 5 and 10 together.", hand: ["5c", "10d", "2s", "8h", "Qc", "Kd"], selected: ["Qc", "Kd"], played: [], playedCard: null, cutCard: "3h", countBefore: 0, points: 2 },
      { id: "run-three", title: "Run of three", explanation: "Three consecutive ranks score 3 points. Discard the queen and king to keep 3–4–5.", hand: ["3c", "4d", "5s", "9h", "Qc", "Kd"], selected: ["Qc", "Kd"], played: [], playedCard: null, cutCard: "Ah", countBefore: 0, points: 3 },
      { id: "run-four", title: "Run of four", explanation: "Four consecutive ranks score 4 points. Discard the queen and king to keep 3–4–5–6 intact.", hand: ["3c", "4d", "5s", "6h", "Qc", "Kd"], selected: ["Qc", "Kd"], played: [], playedCard: null, cutCard: "9h", countBefore: 0, points: 4 },
      { id: "double-run", title: "Double run", explanation: "A repeated rank can make the same run twice. Keeping 3, 3, 4, 5 creates two runs of three plus a pair, for 8 points before the turn card.", hand: ["3c", "3d", "4s", "5h", "Qc", "Kd"], selected: ["Qc", "Kd"], played: [], playedCard: null, cutCard: "9c", countBefore: 0, points: 8 },
      { id: "flush", title: "Flush", explanation: "Four cards of one suit in your hand score 4 points. A turn card of that suit would make it 5. Discard the off-suit 3 and queen here.", hand: ["2h", "5h", "9h", "Kh", "3c", "Qd"], selected: ["3c", "Qd"], played: [], playedCard: null, cutCard: "7s", countBefore: 0, points: 4 },
      { id: "crib-flush", title: "Flush in the crib", explanation: "A crib flush is stricter: all four crib cards and the turn card must share a suit. Sending two hearts to your crib creates the possibility, but the other cards and turn must also be hearts. Crib details will return later in training.", hand: ["Ah", "4h", "6c", "8d", "Qs", "Kc"], selected: ["Ah", "4h"], played: [], playedCard: null, cutCard: "9h", countBefore: 0, points: 0 },
      { id: "nobs", title: "Jack matching the turn", explanation: "A jack in your hand that matches the turn card’s suit scores 1 point. This is often called nobs. Here, the jack of hearts matches the heart turn card.", hand: ["Jh", "2c", "5d", "8s", "Qc", "Kd"], selected: ["Qc", "Kd"], played: [], playedCard: null, cutCard: "7h", countBefore: 0, points: 1 },
    ],
    completionTitle: "You understand beginner discarding.",
    completion: "You can now preserve pairs, fifteens, runs, and flushes, and recognize double runs and a matching jack. The drills will let you practice choosing the two cards to send away.",
    drillRoute: "drill-discard",
  },
};
