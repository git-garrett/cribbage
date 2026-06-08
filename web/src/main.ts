import {
  CribbageGame,
  DEFAULT_OPPONENT,
  type AnalyticsEvent,
  type AnalyticsScoreCategory,
  type AnalyticsRole,
  type GameSnapshot,
  type GameState,
  type Opponent,
  type PlayerKey,
  WinGame,
} from "./engine";
import aiBaseline from "./ai-baseline.json";

type BaselineScoreTotals = Pick<
  AnalyticsTotals,
  | "wins"
  | "losses"
  | "skunks"
  | "skunked"
  | "doubleSkunks"
  | "doubleSkunked"
  | "peggingDealer"
  | "peggingPone"
  | "handDealer"
  | "handPone"
  | "crib"
>;

interface AiBaselineSource {
  version: number;
  source?: string;
  games?: number;
  opponent?: string;
  aiTotals?: Partial<BaselineScoreTotals>;
  opportunities?: Partial<Record<ScoreKey, number>>;
  models?: Record<string, {
    games?: number;
    aiTotals?: Partial<BaselineScoreTotals>;
    opportunities?: Partial<Record<ScoreKey, number>>;
  }>;
  benchmarks?: Array<{
    source?: string;
    games?: number;
    models?: Record<string, {
      games?: number;
      aiTotals?: Partial<BaselineScoreTotals>;
      opportunities?: Partial<Record<ScoreKey, number>>;
    }>;
  }>;
}

const state: {
  game: GameState | null;
  selected: Set<number>;
  pending: boolean;
  resultOverride: string[] | null;
  analyticsOpen: boolean;
} = {
  game: null,
  selected: new Set(),
  pending: false,
  resultOverride: null,
  analyticsOpen: false,
};

const els = {
  app: document.querySelector(".app") as HTMLElement,
  board: document.querySelector("#board") as HTMLElement,
  menuToggle: document.querySelector("#menu-toggle") as HTMLButtonElement,
  settingsPanel: document.querySelector("#settings-panel") as HTMLElement,
  analyticsOpen: document.querySelector("#analytics-open") as HTMLButtonElement,
  analyticsClose: document.querySelector("#analytics-close") as HTMLButtonElement,
  analyticsPage: document.querySelector("#analytics-page") as HTMLElement,
  analyticsSummary: document.querySelector("#analytics-summary") as HTMLElement,
  analyticsTotals: document.querySelector("#analytics-totals") as HTMLElement,
  analyticsGames: document.querySelector("#analytics-games") as HTMLElement,
  analyticsHands: document.querySelector("#analytics-hands") as HTMLElement,
  analyticsScores: document.querySelector("#analytics-scores") as HTMLElement,
  analyticsPegging: document.querySelector("#analytics-pegging") as HTMLElement,
  result: document.querySelector("#result") as HTMLElement,
  scoringResult: document.querySelector("#scoring-result") as HTMLElement,
  humanScore: document.querySelector("#human-score") as HTMLElement,
  humanDealer: document.querySelector("#human-dealer") as HTMLElement,
  scoreCut: document.querySelector("#score-cut") as HTMLElement,
  aiScore: document.querySelector("#ai-score") as HTMLElement,
  aiDealer: document.querySelector("#ai-dealer") as HTMLElement,
  dealer: document.querySelector("#dealer") as HTMLElement,
  turn: document.querySelector("#turn") as HTMLElement,
  count: document.querySelector("#count") as HTMLElement,
  turnCard: document.querySelector("#turn-card") as HTMLElement,
  playAreaTitle: document.querySelector("#play-area-title") as HTMLElement,
  plays: document.querySelector("#plays") as HTMLElement,
  userHandTitle: document.querySelector("#user-hand-title") as HTMLElement,
  aiStrip: document.querySelector(".ai-strip") as HTMLElement,
  humanHand: document.querySelector("#human-hand") as HTMLElement,
  aiHand: document.querySelector("#ai-hand") as HTMLElement,
  discard: document.querySelector("#discard") as HTMLButtonElement,
  play: document.querySelector("#play") as HTMLButtonElement,
  go: document.querySelector("#go") as HTMLButtonElement,
  newGame: document.querySelector("#new-game") as HTMLButtonElement,
  opponent: document.querySelector("#opponent") as HTMLSelectElement,
  scoringReview: document.querySelector("#scoring-review") as HTMLElement,
  scoringTitle: document.querySelector("#scoring-title") as HTMLElement,
  scoringCards: document.querySelector("#scoring-cards") as HTMLElement,
  scoringPoints: document.querySelector("#scoring-points") as HTMLElement,
  continueScoring: document.querySelector("#continue-scoring") as HTMLButtonElement,
  continuePegging: document.querySelector("#continue-pegging") as HTMLButtonElement,
};

const SHARED_PAR_HOLES = [17, 33, 43, 59, 69, 85, 95];
const SAVE_KEY = "strong-cribbage.game.v1";
const ANALYTICS_KEY = "strong-cribbage.analytics.v1";

interface AnalyticsStore {
  version: 1;
  events: AnalyticsEvent[];
}

interface AnalyticsTotals {
  games: number;
  wins: number;
  losses: number;
  skunks: number;
  skunked: number;
  doubleSkunks: number;
  doubleSkunked: number;
  peggingDealer: number;
  peggingPone: number;
  handDealer: number;
  handPone: number;
  crib: number;
  peggingDealerHands: number;
  peggingPoneHands: number;
  handDealerHands: number;
  handPoneHands: number;
  cribHands: number;
  baselineGames?: number;
  baselineSources?: string[];
}

type ScoreKey = "peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib";

function loadSavedGame(): CribbageGame {
  const saved = localStorage.getItem(SAVE_KEY);
  if (!saved) return new CribbageGame(DEFAULT_OPPONENT);
  try {
    return CribbageGame.restore(JSON.parse(saved) as GameSnapshot);
  } catch {
    localStorage.removeItem(SAVE_KEY);
    return new CribbageGame(DEFAULT_OPPONENT);
  }
}

function saveGame(): void {
  const snapshot = localGame.snapshot();
  localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
  syncAnalytics(snapshot.analyticsEvents ?? []);
}

let localGame = loadSavedGame();
saveGame();

function loadAnalytics(): AnalyticsStore {
  const fallback: AnalyticsStore = { version: 1, events: [] };
  const saved = localStorage.getItem(ANALYTICS_KEY);
  if (!saved) return fallback;
  try {
    const parsed = JSON.parse(saved) as AnalyticsStore;
    if (parsed.version !== 1 || !Array.isArray(parsed.events)) return fallback;
    return parsed;
  } catch {
    localStorage.removeItem(ANALYTICS_KEY);
    return fallback;
  }
}

function saveAnalytics(store: AnalyticsStore): void {
  localStorage.setItem(ANALYTICS_KEY, JSON.stringify(store));
}

function syncAnalytics(events: AnalyticsEvent[]): void {
  if (!events.length) return;
  const store = loadAnalytics();
  const known = new Set(store.events.map((event) => event.id));
  for (const event of events) {
    if (!known.has(event.id)) {
      store.events.push(event);
      known.add(event.id);
    }
  }
  store.events.sort((a, b) => a.at.localeCompare(b.at));
  store.events = store.events.slice(-8000);
  saveAnalytics(store);
}

function buildBoard(): void {
  els.board.innerHTML = "";
  for (const player of ["human", "ai"] as const) {
    const lane = document.createElement("div");
    lane.className = `lane ${player}`;

    const label = document.createElement("div");
    label.className = "lane-label";
    label.textContent = player === "human" ? "User" : "AI";
    lane.append(label);

    const track = document.createElement("div");
    track.className = "track";

    track.append(holeElement("start-back", true, 1, 1));
    track.append(holeElement("start-front", true, 2, 1));
    for (let i = 1; i <= 60; i += 1) track.append(holeElement(i, false, outboundColumn(i), 1));
    for (let i = 61; i <= 120; i += 1) track.append(holeElement(i, false, returnColumn(i), 2));
    track.append(holeElement(121, false, 2, 2));
    track.append(paceSvg());

    lane.append(track);
    els.board.append(lane);
  }
}

function outboundColumn(holeNumber: number): number {
  return 3 + holeNumber + Math.floor((holeNumber - 1) / 5);
}

function returnColumn(holeNumber: number): number {
  const hole60Column = outboundColumn(60);
  const offset = holeNumber - 61;
  return hole60Column - offset - Math.floor(offset / 5);
}

function holeElement(position: number | string, start: boolean, column: number, row: number): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "hole-wrap";
  wrap.dataset.position = String(position);
  wrap.dataset.row = String(row);
  wrap.style.gridColumn = String(column);
  wrap.style.gridRow = String(row);

  const hole = document.createElement("span");
  hole.className = "hole";
  hole.dataset.position = String(position);
  if (start) hole.classList.add("start");
  if (!start && Number(position) % 5 === 0 && Number(position) !== 120) wrap.classList.add("group-end");
  if (Number(position) === 121) hole.classList.add("finish");
  wrap.append(hole);

  if (!start && Number(position) % 5 === 0 && Number(position) !== 120) {
    const label = document.createElement("span");
    label.className = "hole-number";
    label.textContent = String(position);
    wrap.append(label);
  }

  return wrap;
}

function paceSvg(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("pace-lines");
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

function fallbackPegPositions(scores: GameState["scores"]): GameState["pegPositions"] {
  return {
    human: ["start-front", Math.min(scores.human, 121)],
    ai: ["start-front", Math.min(scores.ai, 121)],
  };
}

function renderBoard(
  scores: GameState["scores"],
  pegPositions: GameState["pegPositions"] = fallbackPegPositions(scores),
  firstDealer: string | null = null,
  phase: GameState["phase"] = "discard",
  handNumber = 1,
): void {
  const fallback = fallbackPegPositions(scores);
  const firstDealerPlayer = firstDealer === "User" ? "human" : "ai";
  const completedHands = completedHandCount(phase, handNumber);
  const projections = projectedCourse(scores, firstDealerPlayer, completedHands);
  for (const lane of els.board.querySelectorAll(".lane")) {
    const player = lane.classList.contains("human") ? "human" : "ai";
    const positions = pegPositions[player] || fallback[player];
    const projectedPositions = projections[player];
    for (const hole of lane.querySelectorAll<HTMLElement>(".hole")) {
      const wrap = hole.closest<HTMLElement>(".hole-wrap");
      if (!wrap) continue;
      hole.classList.remove("peg", "back-peg", "front-peg");
      wrap.classList.remove("expected-human", "expected-ai", "ringed", "ring-short", "ring-long");
      wrap.removeAttribute("title");
      applyRingMarker(wrap, Number(hole.dataset.position), player, firstDealerPlayer);
      const projection = projectedPositions.get(hole.dataset.position || "");
      if (projection) {
        wrap.classList.add(player === "human" ? "expected-human" : "expected-ai");
        wrap.title = `${player === "human" ? "User" : "AI"} expected after hand ${projection.hand}: ${projection.score.toFixed(1)}`;
      }
      if (String(positions[0]) === hole.dataset.position) hole.classList.add("peg", "back-peg");
      if (String(positions[1]) === hole.dataset.position) hole.classList.add("peg", "front-peg");
    }
  }
  requestAnimationFrame(() => renderPaceLines(pegPositions, projections, firstDealerPlayer, completedHands));
}

function applyRingMarker(
  wrap: HTMLElement,
  position: number,
  player: "human" | "ai",
  firstDealerPlayer: "human" | "ai",
): void {
  if (!Number.isFinite(position)) return;
  const parHoles = parHolesFor(player, firstDealerPlayer);
  const index = parHoles.indexOf(position);
  if (index === -1 || index === parHoles.length - 1) return;
  wrap.classList.add("ringed");
  const nextHole = parHoles[index + 1];
  wrap.classList.add(nextHole - position <= 12 ? "ring-short" : "ring-long");
}

function renderPaceLines(
  pegPositions: GameState["pegPositions"],
  projections: Record<"human" | "ai", Map<string, { hand: number; score: number }>>,
  firstDealerPlayer: "human" | "ai",
  completedHands: number,
): void {
  for (const lane of els.board.querySelectorAll<HTMLElement>(".lane")) {
    const player = lane.classList.contains("human") ? "human" : "ai";
    const track = lane.querySelector<HTMLElement>(".track");
    const svg = lane.querySelector<SVGSVGElement>(".pace-lines");
    if (!track || !svg) continue;
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${track.clientWidth} ${track.clientHeight}`);
    const parHoles = parHolesFor(player, firstDealerPlayer);
    const currentParIndex = completedHands - 1;
    let lineIndex = 0;
    if (currentParIndex >= 0) {
      addPaceLine(
        svg,
        track,
        pegPositions[player]?.[1],
        parHoles[currentParIndex],
        player,
        lineSide(lineIndex),
        completedHands,
      );
      lineIndex += 1;
    }
    for (const [hole, projection] of projections[player]) {
      const parHole = parHoles[currentParIndex + projection.hand];
      if (parHole) {
        addPaceLine(
          svg,
          track,
          parHole,
          hole,
          player,
          lineSide(lineIndex),
          completedHands + projection.hand,
        );
        lineIndex += 1;
      }
    }
  }
}

function lineSide(index: number): "outside" | "inside" {
  return index % 2 === 0 ? "outside" : "inside";
}

type LinePoint = { x: number; y: number };

function addPaceLine(
  svg: SVGSVGElement,
  track: HTMLElement,
  fromPosition: number | string | undefined,
  toPosition: number | string | undefined,
  player: "human" | "ai",
  side: "outside" | "inside",
  label: number,
): void {
  if (fromPosition === undefined || toPosition === undefined) return;
  const start = holeLinePoint(track, fromPosition, side);
  const end = holeLinePoint(track, toPosition, side);
  if (!start || !end) return;

  const points: LinePoint[] = [{ x: start.x, y: start.y }];
  if (start.row === end.row) {
    points.push({ x: end.x, y: end.y });
  } else {
    const turnX = uTurnLineX(track);
    points.push({ x: turnX, y: start.y }, { x: turnX, y: end.y }, { x: end.x, y: end.y });
  }

  const totalLength = polylineLength(points);
  const labelGap = Math.min(16, Math.max(10, totalLength * 0.34));
  const labelCenter = pointAtPolylineDistance(points, totalLength / 2);
  const gapStart = Math.max(0, totalLength / 2 - labelGap / 2);
  const gapEnd = Math.min(totalLength, totalLength / 2 + labelGap / 2);
  appendPacePath(svg, player, subPolyline(points, 0, gapStart));
  appendPacePath(svg, player, subPolyline(points, gapEnd, totalLength));

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.classList.add("pace-label", `pace-label-${player}`);
  text.textContent = String(label);
  text.setAttribute("x", labelCenter.x.toFixed(2));
  text.setAttribute("y", labelCenter.y.toFixed(2));
  text.setAttribute("text-anchor", "middle");
  svg.append(text);
}

function appendPacePath(svg: SVGSVGElement, player: "human" | "ai", points: LinePoint[]): void {
  if (points.length < 2) return;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData(points));
  path.classList.add("pace-line", `pace-${player}`);
  svg.append(path);
}

function pathData(points: LinePoint[]): string {
  const [first, ...rest] = points;
  return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${rest
    .map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ")}`;
}

function subPolyline(points: LinePoint[], fromDistance: number, toDistance: number): LinePoint[] {
  if (toDistance <= fromDistance) return [];
  const result = [pointAtPolylineDistance(points, fromDistance)];
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = pointDistance(previous, current);
    const segmentStart = walked;
    const segmentEnd = walked + length;
    if (segmentEnd > fromDistance && segmentEnd < toDistance) result.push(current);
    walked = segmentEnd;
  }
  result.push(pointAtPolylineDistance(points, toDistance));
  return result;
}

function pointAtPolylineDistance(points: LinePoint[], targetDistance: number): LinePoint {
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const length = pointDistance(previous, current);
    if (walked + length >= targetDistance) {
      const ratio = length === 0 ? 0 : (targetDistance - walked) / length;
      return {
        x: previous.x + (current.x - previous.x) * ratio,
        y: previous.y + (current.y - previous.y) * ratio,
      };
    }
    walked += length;
  }
  return points[points.length - 1];
}

function polylineLength(points: LinePoint[]): number {
  return points.reduce((total, point, index) => (
    index === 0 ? 0 : total + pointDistance(points[index - 1], point)
  ), 0);
}

function pointDistance(a: LinePoint, b: LinePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function holeLinePoint(
  track: HTMLElement,
  position: number | string,
  side: "outside" | "inside",
): { x: number; y: number; row: 1 | 2 } | null {
  const wrap = track.querySelector<HTMLElement>(`.hole-wrap[data-position="${position}"]`);
  if (!wrap) return null;
  const trackRect = track.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const row = wrap.dataset.row === "2" ? 2 : 1;
  const centerY = wrapRect.top - trackRect.top + 2;
  const tangentOffset = 5;
  const outside = row === 1 ? centerY - tangentOffset : centerY + tangentOffset;
  const inside = row === 1 ? centerY + tangentOffset : centerY - tangentOffset;
  const y = side === "outside" ? outside : inside;
  return {
    x: wrapRect.left - trackRect.left + wrapRect.width / 2,
    y,
    row,
  };
}

function uTurnLineX(track: HTMLElement): number {
  const wrap60 = track.querySelector<HTMLElement>('.hole-wrap[data-position="60"]');
  if (!wrap60) return track.clientWidth;
  const trackRect = track.getBoundingClientRect();
  const wrapRect = wrap60.getBoundingClientRect();
  return wrapRect.left - trackRect.left + wrapRect.width / 2 + 5;
}

function completedHandCount(phase: GameState["phase"], handNumber: number): number {
  if (["pegging_complete", "score_pone", "score_dealer", "score_crib"].includes(phase)) {
    return handNumber;
  }
  return Math.max(0, handNumber - 1);
}

function parHolesFor(player: "human" | "ai", firstDealerPlayer: "human" | "ai"): number[] {
  return player === firstDealerPlayer
    ? [7, ...SHARED_PAR_HOLES, 111, 121]
    : [...SHARED_PAR_HOLES, 111, 121];
}

function projectedCourse(
  scores: GameState["scores"],
  firstDealerPlayer: "human" | "ai",
  completedHands: number,
): Record<"human" | "ai", Map<string, { hand: number; score: number }>> {
  const result = {
    human: new Map<string, { hand: number; score: number }>(),
    ai: new Map<string, { hand: number; score: number }>(),
  };
  if (completedHands <= 0) return result;
  const projections = {
    human: projectedPlayerCourse("human", scores.human, firstDealerPlayer, completedHands),
    ai: projectedPlayerCourse("ai", scores.ai, firstDealerPlayer, completedHands),
  };
  const winningHand = Math.min(
    ...Object.values(projections)
      .flat()
      .filter((projection) => projection.score >= 121)
      .map((projection) => projection.hand),
    Number.POSITIVE_INFINITY,
  );
  for (const player of ["human", "ai"] as const) {
    for (const projection of projections[player]) {
      if (projection.hand > winningHand) continue;
      result[player].set(String(projection.position), { hand: projection.hand, score: projection.score });
    }
  }
  return result;
}

function projectedPlayerCourse(
  player: "human" | "ai",
  score: number,
  firstDealerPlayer: "human" | "ai",
  completedHands: number,
): Array<{ hand: number; position: number; score: number }> {
  const result: Array<{ hand: number; position: number; score: number }> = [];
  const parHoles = parHolesFor(player, firstDealerPlayer);
  const currentParIndex = completedHands - 1;
  const currentPar = parHoles[currentParIndex];
  if (!currentPar) return result;
  const offset = score - currentPar;
  for (let index = currentParIndex + 1; index < parHoles.length; index += 1) {
    const projectedScore = Math.min(121, Math.max(1, parHoles[index] + offset));
    result.push({
      hand: index - currentParIndex,
      position: Math.min(121, Math.max(1, Math.round(projectedScore))),
      score: projectedScore,
    });
  }
  return result;
}

async function api(path: string, body: Record<string, unknown> | null = null): Promise<GameState> {
  try {
    if (path === "/api/state") return localGame.state();
    if (path === "/api/new") {
      localGame = new CribbageGame((body?.opponent as Opponent) || DEFAULT_OPPONENT);
      saveGame();
      return localGame.state();
    }
    if (path === "/api/discard") {
      localGame.discard((body?.ids as number[]) || []);
      saveGame();
      return localGame.state();
    }
    if (path === "/api/finish-discard") {
      localGame.finishDiscard();
      saveGame();
      return localGame.state();
    }
    if (path === "/api/play") {
      localGame.play(body?.id as number);
      saveGame();
      return localGame.state();
    }
    if (path === "/api/go") {
      localGame.go();
      saveGame();
      return localGame.state();
    }
    if (path === "/api/continue-scoring") {
      localGame.continueScoring();
      saveGame();
      return localGame.state();
    }
    throw new Error("Unknown local action.");
  } catch (error) {
    if (error instanceof WinGame) {
      saveGame();
      return localGame.state();
    }
    render(localGame.state());
    throw error;
  }
}

function cardElement(card: GameState["humanHand"][number], options: { clickable?: boolean; disabled?: boolean } = {}): HTMLElement {
  const button = document.createElement(options.clickable ? "button" : "div");
  button.className = `card ${card.suit}`;
  button.dataset.index = String(card.index);
  button.dataset.id = String(card.id);
  if (card.owner) button.dataset.owner = card.owner;
  if (state.selected.has(card.id)) button.classList.add("selected");
  if (options.disabled && button instanceof HTMLButtonElement) button.disabled = true;
  if (options.clickable && button instanceof HTMLButtonElement) {
    button.type = "button";
    button.addEventListener("click", () => onCardClick(card));
  }
  button.innerHTML = `
    <span class="corner">
      <span>${card.rank}</span>
      <span>${card.symbol}</span>
    </span>
    <span class="rank">${card.rank}</span>
    <span class="suit">${card.symbol}</span>
  `;
  return button;
}

function cardBack(): HTMLElement {
  const card = document.createElement("div");
  card.className = "card back";
  return card;
}

function onCardClick(card: GameState["humanHand"][number]): void {
  if (state.pending) return;
  const game = state.game;
  if (!game) return;
  if (game.phase === "discard") {
    if (state.selected.has(card.id)) state.selected.delete(card.id);
    else if (state.selected.size < 2) state.selected.add(card.id);
    state.resultOverride = [];
    render(game);
    return;
  }
  if (game.phase === "pegging" && game.turn === "User") {
    if (!game.legalCardIds.includes(card.id)) return;
    if (state.selected.has(card.id)) state.selected.delete(card.id);
    else {
      state.selected.clear();
      state.selected.add(card.id);
    }
    state.resultOverride = [];
    render(game);
  }
}

function renderCards(container: HTMLElement, cards: GameState["humanHand"], options = {}): void {
  container.innerHTML = "";
  for (const card of cards) container.append(cardElement(card, options));
}

function renderPlayedCards(
  activeCards: GameState["plays"],
  completedGroups: GameState["completedPlays"] = [],
): void {
  els.plays.innerHTML = "";
  const active = document.createElement("div");
  active.className = "cards played-active pegging-row";
  for (const card of activeCards) active.append(cardElement(card));
  els.plays.append(active);
  for (const group of [...completedGroups].reverse()) {
    const archived = document.createElement("div");
    archived.className = "cards played-archive pegging-row";
    for (const card of group) archived.append(cardElement(card));
    els.plays.append(archived);
  }
}

function renderCutCard(card: GameState["turnCard"]): void {
  els.turnCard.innerHTML = "";
  els.turnCard.className = "cut-card";
  els.scoreCut.hidden = !card;
  els.turnCard.hidden = !card;
  if (card) els.turnCard.append(cardElement(card));
}

function selectedPlayableCard(game: GameState): GameState["humanHand"][number] | undefined {
  return game.humanHand.find((card) => state.selected.has(card.id) && game.legalCardIds.includes(card.id));
}

function renderScoring(scoring: GameState["scoring"]): void {
  els.scoringReview.hidden = !scoring;
  if (!scoring) {
    els.scoringCards.innerHTML = "";
    els.scoringResult.innerHTML = "";
    return;
  }
  els.scoringTitle.textContent = scoring.title;
  els.scoringPoints.textContent = `${scoring.points} point${scoring.points === 1 ? "" : "s"}`;
  els.continueScoring.textContent = scoring.nextLabel;
  renderCards(els.scoringCards, scoring.cards);
}

function renderResult(game: GameState): void {
  const lines = (state.resultOverride ?? (game.result.length ? game.result : [game.message])).filter(
    (line) => line !== "User turn.",
  );
  const target = game.scoring ? els.scoringResult : els.result;
  const other = game.scoring ? els.result : els.scoringResult;
  other.innerHTML = "";
  target.innerHTML = "";
  for (const line of [...lines].reverse().filter(Boolean)) {
    const item = document.createElement("div");
    item.textContent = line;
    target.append(item);
  }
}

function renderAnalytics(): void {
  const events = loadAnalytics().events;
  const scoreEvents = events.filter((event): event is Extract<AnalyticsEvent, { type: "score" }> =>
    event.type === "score"
  );
  const gameEvents = events.filter((event): event is Extract<AnalyticsEvent, { type: "game" }> =>
    event.type === "game"
  );
  const handEvents = events.filter((event): event is Extract<AnalyticsEvent, { type: "hand" }> =>
    event.type === "hand"
  );
  const peggingEvents = events.filter((event): event is Extract<AnalyticsEvent, { type: "pegging" }> =>
    event.type === "pegging"
  );

  const completedGames = gameEvents.filter((event) => event.action === "end").length;
  const startedHands = handEvents.filter((event) => event.action === "start").length;
  els.analyticsSummary.textContent = `${completedGames} completed game${completedGames === 1 ? "" : "s"}; ${startedHands} hand${startedHands === 1 ? "" : "s"} logged.`;

  renderAnalyticsTotals(scoreEvents, gameEvents);
  renderAnalyticsRows(
    els.analyticsGames,
    [...gameEvents].reverse().slice(0, 40).map((event) =>
      event.action === "start"
        ? [`Game started`, `Engine: ${engineName(event.opponent)}`, shortDate(event.at)]
        : [
            `${playerName(event.winner)} won${event.result && event.result !== "regular" ? ` by ${event.result}` : ""}`,
            `Final ${event.finalScores?.human ?? 0}-${event.finalScores?.ai ?? 0}`,
            shortDate(event.at),
          ],
    ),
  );
  renderAnalyticsRows(
    els.analyticsHands,
    [...handEvents].reverse().slice(0, 80).map((event) => [
      `Hand ${event.handNumber} ${event.action}`,
      `Dealer: ${playerName(event.dealer)}; Pone: ${playerName(event.pone)}`,
      `Score ${event.scores.human}-${event.scores.ai}${event.turnCard ? `; Cut ${event.turnCard}` : ""}`,
    ]),
  );
  renderAnalyticsRows(
    els.analyticsScores,
    [...scoreEvents].reverse().slice(0, 120).map((event) => [
      `Hand ${event.handNumber}: ${playerName(event.player)} +${event.points}`,
      `${scoreLabel(event.category, event.role)}: ${event.reason}`,
      `Total ${event.totalScore}${event.card ? `; Card ${event.card}` : ""}${event.count ? `; Count ${event.count}` : ""}`,
    ]),
  );
  renderAnalyticsRows(
    els.analyticsPegging,
    [...peggingEvents].reverse().slice(0, 160).map((event) => [
      `Hand ${event.handNumber}: ${event.action}`,
      event.player ? `${playerName(event.player)} as ${event.role}` : "Count",
      event.message,
    ]),
  );
}

function renderAnalyticsTotals(
  scoreEvents: Extract<AnalyticsEvent, { type: "score" }>[],
  gameEvents: Extract<AnalyticsEvent, { type: "game" }>[],
): void {
  const humanTotals = emptyAnalyticsTotals();
  const aiAllTotals = emptyAnalyticsTotals();
  const aiByModel = new Map<Opponent, AnalyticsTotals>();
  const gameEngines = engineByGame(gameEvents);
  const opportunities = new Map<AnalyticsTotals, Record<ScoreKey, Set<string>>>();
  const ensureOpportunities = (totals: AnalyticsTotals): Record<ScoreKey, Set<string>> => {
    const existing = opportunities.get(totals);
    if (existing) return existing;
    const next = emptyOpportunitySets();
    opportunities.set(totals, next);
    return next;
  };
  const modelTotals = (engine: Opponent): AnalyticsTotals => {
    const existing = aiByModel.get(engine);
    if (existing) return existing;
    const next = emptyAnalyticsTotals();
    aiByModel.set(engine, next);
    return next;
  };

  for (const event of scoreEvents) {
    const key = scoreKey(event.category, event.role);
    const handKey = `${event.gameId}:${event.handNumber}`;
    if (event.player === "human") {
      humanTotals[key] += event.points;
      ensureOpportunities(humanTotals)[key].add(handKey);
    } else {
      const engine = gameEngines.get(event.gameId) ?? DEFAULT_OPPONENT;
      const perModel = modelTotals(engine);
      aiAllTotals[key] += event.points;
      perModel[key] += event.points;
      ensureOpportunities(aiAllTotals)[key].add(handKey);
      ensureOpportunities(perModel)[key].add(handKey);
    }
  }
  for (const event of gameEvents) {
    if (event.action !== "end" || !event.winner) continue;
    const loser = event.loser ?? (event.winner === "human" ? "ai" : "human");
    const result = event.result ?? gameResultFromScores(event.winner, event.finalScores);
    humanTotals.games += 1;
    aiAllTotals.games += 1;
    const engine = gameEngines.get(event.gameId) ?? normalizeAnalyticsEngine(event.opponent);
    const perModel = modelTotals(engine);
    perModel.games += 1;
    const winnerTotals = event.winner === "human" ? humanTotals : aiAllTotals;
    const loserTotals = loser === "human" ? humanTotals : aiAllTotals;
    winnerTotals.wins += 1;
    loserTotals.losses += 1;
    if (event.winner === "ai") perModel.wins += 1;
    else perModel.losses += 1;
    if (result === "skunk" || result === "double-skunk") {
      winnerTotals.skunks += 1;
      loserTotals.skunked += 1;
      if (event.winner === "ai") perModel.skunks += 1;
      else perModel.skunked += 1;
    }
    if (result === "double-skunk") {
      winnerTotals.doubleSkunks += 1;
      loserTotals.doubleSkunked += 1;
      if (event.winner === "ai") perModel.doubleSkunks += 1;
      else perModel.doubleSkunked += 1;
    }
  }
  applyOpportunityCounts(humanTotals, ensureOpportunities(humanTotals));
  applyOpportunityCounts(aiAllTotals, ensureOpportunities(aiAllTotals));
  for (const totals of aiByModel.values()) applyOpportunityCounts(totals, ensureOpportunities(totals));
  addAiBaselineTotals(aiAllTotals, aiByModel);
  els.analyticsTotals.innerHTML = "";
  els.analyticsTotals.append(
    analyticsTotalCard("User", humanTotals, "human"),
    analyticsTotalCard("All AI", aiAllTotals, "ai"),
  );
  for (const [engine, totals] of [...aiByModel.entries()].sort((a, b) => engineName(a[0]).localeCompare(engineName(b[0])))) {
    els.analyticsTotals.append(analyticsTotalCard(engineName(engine), totals, "ai"));
  }
}

function renderAnalyticsRows(container: HTMLElement, rows: string[][]): void {
  container.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "analytics-empty";
    empty.textContent = "No records yet.";
    container.append(empty);
    return;
  }
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "analytics-row";
    for (const value of row) {
      const span = document.createElement("span");
      span.textContent = value;
      item.append(span);
    }
    container.append(item);
  }
}

function emptyAnalyticsTotals(): AnalyticsTotals {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    skunks: 0,
    skunked: 0,
    doubleSkunks: 0,
    doubleSkunked: 0,
    peggingDealer: 0,
    peggingPone: 0,
    handDealer: 0,
    handPone: 0,
    crib: 0,
    peggingDealerHands: 0,
    peggingPoneHands: 0,
    handDealerHands: 0,
    handPoneHands: 0,
    cribHands: 0,
  };
}

function emptyOpportunitySets(): Record<ScoreKey, Set<string>> {
  return {
    peggingDealer: new Set<string>(),
    peggingPone: new Set<string>(),
    handDealer: new Set<string>(),
    handPone: new Set<string>(),
    crib: new Set<string>(),
  };
}

function applyOpportunityCounts(
  totals: AnalyticsTotals,
  opportunities: Record<ScoreKey, Set<string>>,
): void {
  totals.peggingDealerHands += opportunities.peggingDealer.size;
  totals.peggingPoneHands += opportunities.peggingPone.size;
  totals.handDealerHands += opportunities.handDealer.size;
  totals.handPoneHands += opportunities.handPone.size;
  totals.cribHands += opportunities.crib.size;
}

function engineByGame(gameEvents: Extract<AnalyticsEvent, { type: "game" }>[]): Map<string, Opponent> {
  const engines = new Map<string, Opponent>();
  for (const event of gameEvents) engines.set(event.gameId, normalizeAnalyticsEngine(event.opponent));
  return engines;
}

function addAiBaselineTotals(aiAllTotals: AnalyticsTotals, aiByModel: Map<Opponent, AnalyticsTotals>): void {
  const baseline = aiBaseline as unknown as AiBaselineSource;
  if (baseline.version !== 1) return;
  const addModel = (
    engineValue: string | undefined,
    games: number | undefined,
    totals: Partial<BaselineScoreTotals> | undefined,
    opportunities: Partial<Record<ScoreKey, number>> | undefined,
    sourceLabel: string,
  ): void => {
    if (!totals) return;
    const engine = normalizeAnalyticsEngine(engineValue);
    const perModel = aiByModel.get(engine) ?? emptyAnalyticsTotals();
    aiByModel.set(engine, perModel);
    addBaselineStats(aiAllTotals, games, totals, opportunities, sourceLabel);
    addBaselineStats(perModel, games, totals, opportunities, sourceLabel);
  };

  addModel(
    baseline.opponent,
    baseline.games,
    baseline.aiTotals,
    baseline.opportunities,
    benchmarkLabel(baseline.source, baseline.games),
  );
  for (const [engine, model] of Object.entries(baseline.models ?? {})) {
    addModel(engine, model.games, model.aiTotals, model.opportunities, benchmarkLabel(baseline.source, model.games));
  }
  for (const benchmark of baseline.benchmarks ?? []) {
    const label = benchmarkLabel(benchmark.source, benchmark.games);
    for (const [engine, model] of Object.entries(benchmark.models ?? {})) {
      addModel(engine, model.games ?? benchmark.games, model.aiTotals, model.opportunities, label);
    }
  }
}

function addBaselineStats(
  totals: AnalyticsTotals,
  games: number | undefined,
  baselineTotals: Partial<BaselineScoreTotals>,
  opportunities: Partial<Record<ScoreKey, number>> | undefined,
  sourceLabel: string,
): void {
  const baselineTotalKeys = [
    "wins",
    "losses",
    "skunks",
    "skunked",
    "doubleSkunks",
    "doubleSkunked",
    "peggingDealer",
    "peggingPone",
    "handDealer",
    "handPone",
    "crib",
  ] as const;
  for (const key of baselineTotalKeys) {
    totals[key] += Number(baselineTotals[key] ?? 0);
  }
  totals.games += Number(games ?? 0);
  totals.peggingDealerHands += Number(opportunities?.peggingDealer ?? 0);
  totals.peggingPoneHands += Number(opportunities?.peggingPone ?? 0);
  totals.handDealerHands += Number(opportunities?.handDealer ?? 0);
  totals.handPoneHands += Number(opportunities?.handPone ?? 0);
  totals.cribHands += Number(opportunities?.crib ?? 0);
  totals.baselineGames = (totals.baselineGames ?? 0) + Number(games ?? 0);
  if (sourceLabel) totals.baselineSources = [...new Set([...(totals.baselineSources ?? []), sourceLabel])];
}

function analyticsTotalCard(label: string, totals: AnalyticsTotals, kind: "human" | "ai"): HTMLElement {
  const card = document.createElement("div");
  card.className = `analytics-total ${kind}`;
  const benchmarkNote = totals.baselineGames
    ? `Includes benchmarks: ${(totals.baselineSources ?? ["AI baseline"]).join("; ")} (${totals.baselineGames} model-games)`
    : "";
  card.innerHTML = `
    <strong>${label}</strong>
    ${kind === "ai" && benchmarkNote ? `<span class="analytics-baseline-note">${benchmarkNote}</span>` : ""}
    <span>Games: ${totals.games}</span>
    <span>Wins: ${totals.wins}</span>
    <span>Losses: ${totals.losses}</span>
    <span>Skunks: ${totals.skunks}</span>
    <span>Skunked: ${totals.skunked}</span>
    <span>Double skunks: ${totals.doubleSkunks}</span>
    <span>Double skunked: ${totals.doubleSkunked}</span>
    <span>Avg peg as dealer: ${averageLabel(totals.peggingDealer, totals.peggingDealerHands)}</span>
    <span>Avg peg as pone: ${averageLabel(totals.peggingPone, totals.peggingPoneHands)}</span>
    <span>Avg hand as dealer: ${averageLabel(totals.handDealer, totals.handDealerHands)}</span>
    <span>Avg hand as pone: ${averageLabel(totals.handPone, totals.handPoneHands)}</span>
    <span>Avg crib: ${averageLabel(totals.crib, totals.cribHands)}</span>
  `;
  return card;
}

function benchmarkLabel(source: string | undefined, games: number | undefined): string {
  if (source === "ras-v-schell-1000") return "1,000 Ras vs Schell";
  if (source === "three-way-ai-vs-ai-900") return "900 three-way AI vs AI";
  if (source === "three-way-expert-1.1-900") return "900 three-way with Expert 1.1";
  if (source === "ai-vs-ai-baseline") return `${games ?? 0} Expert 1.1 AI baseline`;
  return source || "AI baseline";
}

function averageLabel(points: number, hands: number): string {
  if (!hands) return "-";
  return `${(points / hands).toFixed(2)} (${hands})`;
}

function gameResultFromScores(
  winner: PlayerKey,
  scores: Record<PlayerKey, number> | undefined,
): "regular" | "skunk" | "double-skunk" {
  const loser = winner === "human" ? "ai" : "human";
  const loserScore = scores?.[loser] ?? 121;
  if (loserScore <= 60) return "double-skunk";
  if (loserScore <= 90) return "skunk";
  return "regular";
}

function scoreKey(
  category: AnalyticsScoreCategory,
  role: AnalyticsRole,
): "peggingDealer" | "peggingPone" | "handDealer" | "handPone" | "crib" {
  if (category === "crib") return "crib";
  return `${category}${role === "dealer" ? "Dealer" : "Pone"}`;
}

function scoreLabel(category: AnalyticsScoreCategory, role: AnalyticsRole): string {
  if (category === "crib") return "Crib";
  return `${category === "pegging" ? "Pegging" : "Hand"} as ${role}`;
}

function playerName(player: PlayerKey | undefined): string {
  if (!player) return "-";
  return player === "human" ? "User" : "AI";
}

function engineName(engine: string | undefined): string {
  if (engine === "expert" || engine === "expert-1.1") return "Expert 1.1";
  if (engine === "expert-2.0-ras-tables") return "Expert 2.0 Ras Tables";
  if (engine === "ras-table-1.0") return "Ras Table 1.0";
  if (engine === "schell-table-1.0") return "Schell Table 1.0";
  return engine || "-";
}

function normalizeAnalyticsEngine(engine: string | undefined): Opponent {
  if (engine === "expert") return "expert-1.1";
  if (
    engine === "expert-1.1" ||
    engine === "expert-2.0-ras-tables" ||
    engine === "ras-table-1.0" ||
    engine === "schell-table-1.0"
  ) {
    return engine;
  }
  return DEFAULT_OPPONENT;
}

function shortDate(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function playAreaTitle(game: GameState): string {
  if (game.phase === "discard") {
    return game.cribOwner === "User"
      ? "Select two cards to discard to your crib"
      : "Select two cards to discard to AI's crib";
  }
  if (game.phase === "ai_discarding") return "Waiting for AI to discard";
  if (game.phase === "pegging") return "Current count";
  if (game.phase === "pegging_complete") return "Pegging complete";
  return "Current count";
}

function render(game: GameState | null): void {
  if (!game) return;
  syncAnalytics(game.analyticsEvents);
  state.game = game;
  els.app.dataset.phase = game.phase;
  els.app.dataset.view = state.analyticsOpen ? "analytics" : "game";
  els.analyticsPage.hidden = !state.analyticsOpen;
  if (state.analyticsOpen) renderAnalytics();
  els.humanScore.textContent = String(game.scores.human);
  els.aiScore.textContent = String(game.scores.ai);
  els.humanDealer.hidden = game.dealer !== "User";
  els.aiDealer.hidden = game.dealer !== "AI";
  els.dealer.textContent = game.dealer;
  els.turn.textContent = game.turn || "-";
  els.count.textContent = String(game.count);
  renderCutCard(game.turnCard);
  renderScoring(game.scoring);
  renderResult(game);
  renderBoard(game.scores, game.pegPositions, game.firstDealer, game.phase, game.handNumber);
  els.playAreaTitle.textContent = playAreaTitle(game);
  els.userHandTitle.textContent = game.phase === "pegging" ? "Select card to play" : "User hand";
  if (game.phase === "discard") {
    renderCards(els.plays, game.humanHand, { clickable: true });
  } else if (game.scoring) {
    els.plays.innerHTML = "";
  } else {
    renderPlayedCards(game.plays, game.completedPlays);
  }
  renderCards(els.humanHand, game.humanHand, {
    clickable: game.phase !== "discard" && game.phase === "pegging" && game.turn === "User",
  });

  els.aiHand.innerHTML = "";
  els.aiStrip.hidden = game.aiHandCount === 0;
  for (let i = 0; i < game.aiHandCount; i += 1) els.aiHand.append(cardBack());

  els.discard.hidden = game.phase !== "discard";
  els.play.hidden = !(game.phase === "pegging" && game.turn === "User");
  els.go.hidden = !(game.phase === "pegging" && game.turn === "User" && game.canGo);
  els.discard.disabled = !(game.phase === "discard" && state.selected.size === 2);
  els.play.disabled = !(game.phase === "pegging" && game.turn === "User" && selectedPlayableCard(game));
  els.go.disabled = !game.canGo;
  els.continueScoring.disabled = !game.scoring;
  els.continuePegging.hidden = game.phase !== "pegging_complete";
  if (state.pending) {
    els.discard.disabled = true;
    els.play.disabled = true;
    els.go.disabled = true;
    els.newGame.disabled = true;
    els.continueScoring.disabled = true;
    els.continuePegging.disabled = true;
  } else {
    els.newGame.disabled = false;
    els.continuePegging.disabled = false;
  }

}

els.menuToggle.addEventListener("click", () => {
  const open = els.settingsPanel.hidden;
  els.settingsPanel.hidden = !open;
  els.menuToggle.setAttribute("aria-expanded", String(open));
});

els.analyticsOpen.addEventListener("click", () => {
  state.analyticsOpen = true;
  els.settingsPanel.hidden = true;
  els.menuToggle.setAttribute("aria-expanded", "false");
  render(state.game);
});

els.analyticsClose.addEventListener("click", () => {
  state.analyticsOpen = false;
  render(state.game);
});

els.discard.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  try {
    state.resultOverride = null;
    const next = await api("/api/discard", { ids: Array.from(state.selected) });
    state.selected.clear();
    render(next);
    if (next.phase === "ai_discarding") {
      state.pending = false;
      render(state.game);
      finishDiscardInBackground();
      return;
    }
  } finally {
    state.pending = false;
    render(state.game);
  }
});

els.play.addEventListener("click", async () => {
  if (state.pending) return;
  const card = state.game ? selectedPlayableCard(state.game) : null;
  if (!card) return;
  state.pending = true;
  render(state.game);
  try {
    state.resultOverride = null;
    const next = await api("/api/play", { id: card.id });
    state.selected.clear();
    render(next);
  } finally {
    state.pending = false;
    render(state.game);
  }
});

els.go.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  try {
    state.resultOverride = null;
    const next = await api("/api/go", {});
    render(next);
  } finally {
    state.pending = false;
    render(state.game);
  }
});

els.continueScoring.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  try {
    state.resultOverride = null;
    const next = await api("/api/continue-scoring", {});
    state.selected.clear();
    render(next);
  } finally {
    state.pending = false;
    render(state.game);
  }
});

els.continuePegging.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  try {
    state.resultOverride = null;
    const next = await api("/api/continue-scoring", {});
    state.selected.clear();
    render(next);
  } finally {
    state.pending = false;
    render(state.game);
  }
});

els.newGame.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  state.selected.clear();
  render(state.game);
  try {
    state.resultOverride = null;
    const next = await api("/api/new", { opponent: els.opponent.value });
    els.settingsPanel.hidden = true;
    els.menuToggle.setAttribute("aria-expanded", "false");
    render(next);
  } finally {
    state.pending = false;
    render(state.game);
  }
});

window.addEventListener("resize", () => render(state.game));

async function finishDiscardInBackground(): Promise<void> {
  try {
    state.resultOverride = null;
    const next = await api("/api/finish-discard", {});
    render(next);
  } catch (error) {
    els.result.textContent = error instanceof Error ? error.message : "Request failed";
  }
}

buildBoard();
api("/api/state")
  .then((game) => {
    render(game);
    if (game.phase === "ai_discarding") finishDiscardInBackground();
  })
  .catch((error) => {
    els.result.textContent = error instanceof Error ? error.message : "Request failed";
  });
