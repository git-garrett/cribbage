import type { GameState, PlayerKey } from "./api-types";

const SVG_NS = "http://www.w3.org/2000/svg";
const TRACK_CENTER = 130;
const TRACK_GROUP_GAP = 0.8;
const TRACK_TOTAL_UNITS = 120 + (24 * TRACK_GROUP_GAP);
const TRACK_RADIUS: Record<PlayerKey, number> = { human: 114, ai: 101 };

type CircularBoardPresentation = {
  eyebrow: string;
  value: string;
  detail: string;
};

export type CircularTrackPoint = {
  x: number;
  y: number;
  rotation: number;
};

export function circularTrackPoint(position: number | string, radius: number): CircularTrackPoint {
  const numericPosition = Number(position);
  let angleDegrees: number;
  if (numericPosition === 121) {
    angleDegrees = -90;
  } else {
    const hole = Number.isFinite(numericPosition)
      ? Math.max(0, Math.min(119, numericPosition - 1))
      : position === "start-back" ? -2.1 : -1.2;
    const groupOffset = hole >= 0 ? Math.floor(hole / 5) * TRACK_GROUP_GAP : 0;
    const units = hole + groupOffset + 0.45;
    angleDegrees = -90 + (units / TRACK_TOTAL_UNITS * 360);
  }
  const angle = angleDegrees * Math.PI / 180;
  return {
    x: TRACK_CENTER + Math.cos(angle) * radius,
    y: TRACK_CENTER + Math.sin(angle) * radius,
    rotation: angleDegrees + 90,
  };
}

export function circularBoardPresentation(game: GameState): CircularBoardPresentation {
  if (game.phase === "pegging") {
    return {
      eyebrow: "Count",
      value: String(game.count),
      detail: game.peggingResetPending
        ? "Series complete"
        : game.turn === "User" ? "Your turn" : game.turn === "AI" ? "AI turn" : "Pegging",
    };
  }
  if (game.phase === "discard" || game.phase === "ai_discarding") {
    return {
      eyebrow: "Hand",
      value: String(game.handNumber),
      detail: game.phase === "ai_discarding" ? "AI choosing" : `${game.cribOwner} crib`,
    };
  }
  if (game.phase === "cut_for_deal") {
    return { eyebrow: "First deal", value: "CUT", detail: "Tap the deck" };
  }
  if (game.phase === "pegging_complete") {
    return { eyebrow: "Pegging", value: "DONE", detail: "Count hands" };
  }
  if (game.phase === "score_pone" || game.phase === "score_dealer" || game.phase === "score_crib") {
    return {
      eyebrow: "Counting",
      value: game.scoring ? String(game.scoring.points) : "—",
      detail: game.scoring?.title || "Hand score",
    };
  }
  return { eyebrow: "Final", value: "121", detail: game.message || "Game over" };
}

export function createCircularBoard(): HTMLElement {
  const board = document.createElement("div");
  board.className = "circular-board";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("circular-track-svg");
  svg.setAttribute("viewBox", "0 0 260 260");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <defs>
      <linearGradient id="circular-track-wood" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#edcf8c"/>
        <stop offset=".48" stop-color="#c79748"/>
        <stop offset="1" stop-color="#946423"/>
      </linearGradient>
    </defs>
    <circle cx="130" cy="130" r="116" fill="none" stroke="#071f38" stroke-width="3"/>
    <circle cx="130" cy="130" r="108" fill="none" stroke="url(#circular-track-wood)" stroke-width="33"/>
    <circle cx="130" cy="130" r="91" fill="none" stroke="#f1d494" stroke-width="1" opacity=".7"/>
  `;
  for (const radius of [TRACK_RADIUS.human, TRACK_RADIUS.ai]) {
    for (let score = 1; score <= 120; score += 1) {
      const point = circularTrackPoint(score, radius);
      const hole = document.createElementNS(SVG_NS, "circle");
      hole.classList.add("circular-track-hole");
      if (score % 5 === 0) hole.classList.add("milestone");
      hole.setAttribute("cx", point.x.toFixed(2));
      hole.setAttribute("cy", point.y.toFixed(2));
      hole.setAttribute("r", score % 5 === 0 ? "2.15" : "1.65");
      svg.append(hole);
    }
    const finishPoint = circularTrackPoint(121, radius);
    const finishHole = document.createElementNS(SVG_NS, "circle");
    finishHole.classList.add("circular-track-hole", "finish");
    finishHole.setAttribute("cx", finishPoint.x.toFixed(2));
    finishHole.setAttribute("cy", finishPoint.y.toFixed(2));
    finishHole.setAttribute("r", "2.65");
    svg.append(finishHole);
  }
  const finishLabel = document.createElementNS(SVG_NS, "text");
  finishLabel.classList.add("circular-track-finish-label");
  finishLabel.setAttribute("x", "130");
  finishLabel.setAttribute("y", "37");
  finishLabel.setAttribute("text-anchor", "middle");
  finishLabel.textContent = "121";
  svg.append(finishLabel);
  board.append(svg);

  const core = document.createElement("div");
  core.className = "circular-board-core";
  core.innerHTML = `
    <span class="circular-board-eyebrow">Count</span>
    <strong class="circular-board-value">0</strong>
    <small class="circular-board-detail">Pegging</small>
  `;
  board.append(core);
  return board;
}

export function updateCircularBoard(container: HTMLElement, game: GameState): void {
  const board = container.querySelector<HTMLElement>(".circular-board");
  const svg = board?.querySelector<SVGSVGElement>(".circular-track-svg");
  const eyebrow = board?.querySelector<HTMLElement>(".circular-board-eyebrow");
  const value = board?.querySelector<HTMLElement>(".circular-board-value");
  const detail = board?.querySelector<HTMLElement>(".circular-board-detail");
  if (!board || !svg || !eyebrow || !value || !detail) return;

  for (const peg of svg.querySelectorAll(".circular-track-peg")) peg.remove();
  for (const player of ["human", "ai"] as const) {
    const positions = game.pegPositions[player] || ["start-back", "start-front"];
    positions.forEach((position, index) => {
      svg.append(createPeg(position, TRACK_RADIUS[player], player, index === 1));
    });
  }

  const presentation = circularBoardPresentation(game);
  eyebrow.textContent = presentation.eyebrow;
  value.textContent = presentation.value;
  value.dataset.compact = presentation.value.length > 2 ? "true" : "false";
  detail.textContent = presentation.detail;
  board.setAttribute(
    "aria-label",
    `Cribbage score track. User ${game.scores.human}, AI ${game.scores.ai}. ${presentation.eyebrow} ${presentation.value}. ${presentation.detail}.`,
  );
}

function createPeg(
  position: number | string,
  radius: number,
  player: PlayerKey,
  current: boolean,
): SVGGElement {
  const point = circularTrackPoint(position, radius);
  const peg = document.createElementNS(SVG_NS, "g");
  peg.classList.add("circular-track-peg", player, current ? "front" : "back");
  peg.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
  const color = player === "human" ? "var(--human)" : "var(--ai)";
  const opacity = current ? "1" : ".74";
  const pegRadius = current ? "4.5" : "3.8";
  const strokeWidth = current ? "1.35" : ".9";
  peg.innerHTML = `
    <circle cx="0" cy="0" r="${pegRadius}" fill="${color}" stroke="#fbf8f0" stroke-width="${strokeWidth}" opacity="${opacity}"/>
  `;
  return peg;
}
