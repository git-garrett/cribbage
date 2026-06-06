import { CribbageGame, type GameState, type Opponent, WinGame } from "./engine";

const state: {
  game: GameState | null;
  selected: Set<number>;
  pending: boolean;
} = {
  game: null,
  selected: new Set(),
  pending: false,
};

const els = {
  board: document.querySelector("#board") as HTMLElement,
  message: document.querySelector("#message") as HTMLElement,
  humanScore: document.querySelector("#human-score") as HTMLElement,
  aiScore: document.querySelector("#ai-score") as HTMLElement,
  dealer: document.querySelector("#dealer") as HTMLElement,
  turn: document.querySelector("#turn") as HTMLElement,
  count: document.querySelector("#count") as HTMLElement,
  turnCard: document.querySelector("#turn-card") as HTMLElement,
  plays: document.querySelector("#plays") as HTMLElement,
  humanHand: document.querySelector("#human-hand") as HTMLElement,
  aiHand: document.querySelector("#ai-hand") as HTMLElement,
  log: document.querySelector("#log") as HTMLOListElement,
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
};

const RINGED_HOLES = new Set([17, 33, 43, 59, 69, 85, 95]);
let localGame = new CribbageGame("expert");

function buildBoard(): void {
  els.board.innerHTML = "";
  for (const player of ["human", "ai"] as const) {
    const lane = document.createElement("div");
    lane.className = `lane ${player}`;

    const label = document.createElement("div");
    label.className = "lane-label";
    label.textContent = player === "human" ? "You" : "DCarlin";
    lane.append(label);

    const track = document.createElement("div");
    track.className = "track";

    track.append(holeElement("start-back", true, 1, 1));
    track.append(holeElement("start-front", true, 2, 1));
    for (let i = 1; i <= 60; i += 1) track.append(holeElement(i, false, outboundColumn(i), 1));
    for (let i = 61; i <= 120; i += 1) track.append(holeElement(i, false, returnColumn(i), 2));
    track.append(holeElement(121, false, 2, 2));

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
  wrap.style.gridColumn = String(column);
  wrap.style.gridRow = String(row);

  const hole = document.createElement("span");
  hole.className = "hole";
  hole.dataset.position = String(position);
  if (start) hole.classList.add("start");
  if (!start && Number(position) % 5 === 0 && Number(position) !== 120) wrap.classList.add("group-end");
  if (Number(position) === 121) hole.classList.add("finish");
  if (RINGED_HOLES.has(Number(position))) wrap.classList.add("ringed");
  wrap.append(hole);

  if (!start && Number(position) % 5 === 0 && Number(position) !== 120) {
    const label = document.createElement("span");
    label.className = "hole-number";
    label.textContent = String(position);
    wrap.append(label);
  }

  return wrap;
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
): void {
  const fallback = fallbackPegPositions(scores);
  const firstDealerPlayer = firstDealer === "You" ? "human" : "ai";
  for (const lane of els.board.querySelectorAll(".lane")) {
    const player = lane.classList.contains("human") ? "human" : "ai";
    const positions = pegPositions[player] || fallback[player];
    for (const hole of lane.querySelectorAll<HTMLElement>(".hole")) {
      const wrap = hole.closest<HTMLElement>(".hole-wrap");
      if (!wrap) continue;
      hole.classList.remove("peg", "back-peg", "front-peg");
      if (hole.dataset.position === "7") wrap.classList.toggle("ringed", player === firstDealerPlayer);
      if (hole.dataset.position === "111") wrap.classList.toggle("ringed", player !== firstDealerPlayer);
      if (String(positions[0]) === hole.dataset.position) hole.classList.add("peg", "back-peg");
      if (String(positions[1]) === hole.dataset.position) hole.classList.add("peg", "front-peg");
    }
  }
}

async function api(path: string, body: Record<string, unknown> | null = null): Promise<GameState> {
  try {
    if (path === "/api/state") return localGame.state();
    if (path === "/api/new") {
      localGame = new CribbageGame((body?.opponent as Opponent) || "expert");
      return localGame.state();
    }
    if (path === "/api/discard") {
      localGame.discard((body?.ids as number[]) || []);
      return localGame.state();
    }
    if (path === "/api/finish-discard") {
      localGame.finishDiscard();
      return localGame.state();
    }
    if (path === "/api/play") {
      localGame.play(body?.id as number);
      return localGame.state();
    }
    if (path === "/api/go") {
      localGame.go();
      return localGame.state();
    }
    if (path === "/api/continue-scoring") {
      localGame.continueScoring();
      return localGame.state();
    }
    throw new Error("Unknown local action.");
  } catch (error) {
    if (error instanceof WinGame) return localGame.state();
    render(localGame.state());
    throw error;
  }
}

function cardElement(card: GameState["humanHand"][number], options: { clickable?: boolean; disabled?: boolean } = {}): HTMLElement {
  const button = document.createElement(options.clickable ? "button" : "div");
  button.className = `card ${card.suit}`;
  button.dataset.index = String(card.index);
  button.dataset.id = String(card.id);
  if (state.selected.has(card.id)) button.classList.add("selected");
  if (options.disabled && button instanceof HTMLButtonElement) button.disabled = true;
  if (options.clickable && button instanceof HTMLButtonElement) {
    button.type = "button";
    button.addEventListener("click", () => onCardClick(card));
  }
  button.innerHTML = `
    <span class="rank">${card.rank}</span>
    <span class="suit">${card.symbol}</span>
    <span class="corner">${card.rank}${card.symbol}</span>
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
    render(game);
    return;
  }
  if (game.phase === "pegging" && game.turn === "You") {
    if (!game.legalCardIds.includes(card.id)) return;
    if (state.selected.has(card.id)) state.selected.delete(card.id);
    else {
      state.selected.clear();
      state.selected.add(card.id);
    }
    render(game);
  }
}

function renderCards(container: HTMLElement, cards: GameState["humanHand"], options = {}): void {
  container.innerHTML = "";
  for (const card of cards) container.append(cardElement(card, options));
}

function renderPlayedCards(activeCards: GameState["plays"], completedGroups: GameState["completedPlays"] = []): void {
  els.plays.innerHTML = "";
  for (const group of completedGroups) {
    const archived = document.createElement("div");
    archived.className = "cards small played-archive";
    for (const card of group) archived.append(cardElement(card));
    els.plays.append(archived);
  }

  const active = document.createElement("div");
  active.className = "cards played-active";
  for (const card of activeCards) active.append(cardElement(card));
  els.plays.append(active);
}

function renderCutCard(card: GameState["turnCard"]): void {
  els.turnCard.innerHTML = "";
  els.turnCard.className = "cut-card";
  els.turnCard.append(card ? cardElement(card) : cardBack());
}

function selectedPlayableCard(game: GameState): GameState["humanHand"][number] | undefined {
  return game.humanHand.find((card) => state.selected.has(card.id) && game.legalCardIds.includes(card.id));
}

function renderScoring(scoring: GameState["scoring"]): void {
  els.scoringReview.hidden = !scoring;
  if (!scoring) {
    els.scoringCards.innerHTML = "";
    return;
  }
  els.scoringTitle.textContent = scoring.title;
  els.scoringPoints.textContent = `${scoring.points} point${scoring.points === 1 ? "" : "s"}`;
  els.continueScoring.textContent = scoring.nextLabel;
  renderCards(els.scoringCards, scoring.cards);
}

function render(game: GameState | null): void {
  if (!game) return;
  state.game = game;
  els.message.textContent = game.message;
  els.humanScore.textContent = String(game.scores.human);
  els.aiScore.textContent = String(game.scores.ai);
  els.dealer.textContent = game.dealer;
  els.turn.textContent = game.turn || "-";
  els.count.textContent = String(game.count);
  renderCutCard(game.turnCard);
  renderScoring(game.scoring);
  renderBoard(game.scores, game.pegPositions, game.firstDealer);
  renderPlayedCards(game.plays, game.completedPlays);
  renderCards(els.humanHand, game.humanHand, {
    clickable: game.phase === "discard" || (game.phase === "pegging" && game.turn === "You"),
  });

  els.aiHand.innerHTML = "";
  for (let i = 0; i < game.aiHandCount; i += 1) els.aiHand.append(cardBack());

  els.discard.disabled = !(game.phase === "discard" && state.selected.size === 2);
  els.play.disabled = !(game.phase === "pegging" && game.turn === "You" && selectedPlayableCard(game));
  els.go.disabled = !game.canGo;
  els.continueScoring.disabled = !game.scoring;
  if (state.pending) {
    els.discard.disabled = true;
    els.play.disabled = true;
    els.go.disabled = true;
    els.newGame.disabled = true;
    els.continueScoring.disabled = true;
  } else {
    els.newGame.disabled = false;
  }

  els.log.innerHTML = "";
  for (const entry of game.log) {
    const item = document.createElement("li");
    item.textContent = entry;
    els.log.append(item);
  }
}

els.discard.addEventListener("click", async () => {
  if (state.pending) return;
  state.pending = true;
  render(state.game);
  try {
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
    const next = await api("/api/new", { opponent: els.opponent.value });
    render(next);
  } finally {
    state.pending = false;
    render(state.game);
  }
});

async function finishDiscardInBackground(): Promise<void> {
  try {
    const next = await api("/api/finish-discard", {});
    render(next);
  } catch (error) {
    els.message.textContent = error instanceof Error ? error.message : "Request failed";
  }
}

buildBoard();
api("/api/state").then(render).catch((error) => {
  els.message.textContent = error instanceof Error ? error.message : "Request failed";
});
