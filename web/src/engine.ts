export type PlayerKey = "human" | "ai";
export type Opponent = "expert" | "random";
export type Phase =
  | "discard"
  | "ai_discarding"
  | "pegging"
  | "pegging_complete"
  | "score_pone"
  | "score_dealer"
  | "score_crib"
  | "game_over";

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_ASCII = ["d", "c", "h", "s"];
const SUIT_NAMES = ["diamonds", "clubs", "hearts", "spades"];
const SUIT_SYMBOLS = ["♦", "♣", "♥", "♠"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const RUN_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export class WinGame extends Error {}

export class Card {
  id: number;
  rank: number;
  suit: number;
  value: number;
  runVal: number;
  rankStr: string;
  ascii: string;

  constructor(id: number) {
    if (!Number.isInteger(id) || id < 0 || id >= 52) {
      throw new Error("Card id must be an integer from 0 to 51.");
    }
    this.id = id;
    this.rank = id % 13;
    this.suit = Math.floor(id / 13);
    this.value = VALUES[this.rank];
    this.runVal = RUN_VALUES[this.rank];
    this.rankStr = RANKS[this.rank];
    this.ascii = `${this.rankStr}${SUIT_ASCII[this.suit]}`;
  }
}

interface PlayerState {
  key: PlayerKey;
  name: string;
  hand: Card[];
  table: Card[];
  crib: Card[];
  score: number;
}

export interface SerializedCard {
  index: number | null;
  id: number;
  rank: string;
  suit: string;
  symbol: string;
  value: number;
  label: string;
  owner?: string;
}

export interface GameState {
  phase: Phase;
  message: string;
  log: string[];
  result: string[];
  handNumber: number;
  scores: Record<PlayerKey, number>;
  pegPositions: Record<PlayerKey, [number | string, number | string]>;
  dealer: string;
  firstDealer: string;
  cribOwner: string;
  turn: string | null;
  count: number;
  turnCard: SerializedCard | null;
  plays: SerializedCard[];
  completedPlays: SerializedCard[][];
  humanHand: SerializedCard[];
  aiHandCount: number;
  humanTable: SerializedCard[];
  aiTable: SerializedCard[];
  legalCardIds: number[];
  canGo: boolean;
  scoring: {
    stage: "pone" | "dealer" | "crib";
    title: string;
    owner: string;
    cards: SerializedCard[];
    points: number;
    nextLabel: string;
  } | null;
  analyticsEvents: AnalyticsEvent[];
}

type ScoringReview = NonNullable<GameState["scoring"]> & { rawCards: Card[] };

export type AnalyticsRole = "dealer" | "pone";
export type AnalyticsScoreCategory = "pegging" | "hand" | "crib";
export type AnalyticsEvent =
  | {
      id: string;
      at: string;
      type: "game";
      action: "start" | "end";
      gameId: string;
      opponent: Opponent;
      winner?: PlayerKey;
      finalScores?: Record<PlayerKey, number>;
    }
  | {
      id: string;
      at: string;
      type: "hand";
      action: "start" | "end";
      gameId: string;
      handNumber: number;
      dealer: PlayerKey;
      pone: PlayerKey;
      turnCard?: string;
      scores: Record<PlayerKey, number>;
    }
  | {
      id: string;
      at: string;
      type: "pegging";
      action: "play" | "go" | "reset";
      gameId: string;
      handNumber: number;
      player?: PlayerKey;
      role?: AnalyticsRole;
      card?: string;
      count: number;
      message: string;
    }
  | {
      id: string;
      at: string;
      type: "score";
      gameId: string;
      handNumber: number;
      player: PlayerKey;
      role: AnalyticsRole;
      category: AnalyticsScoreCategory;
      points: number;
      reason: string;
      totalScore: number;
      card?: string;
      count?: number;
    };
type NewAnalyticsEvent = AnalyticsEvent extends infer Event
  ? Event extends AnalyticsEvent
    ? Omit<Event, "id" | "at" | "gameId">
    : never
  : never;

interface PlayerSnapshot {
  hand: number[];
  table: number[];
  crib: number[];
  score: number;
}

export interface GameSnapshot {
  version: 1;
  gameId?: string;
  analyticsCounter?: number;
  analyticsEvents?: AnalyticsEvent[];
  opponent: Opponent;
  deal: 0 | 1;
  firstDeal: 0 | 1;
  handNumber?: number;
  human: PlayerSnapshot;
  ai: PlayerSnapshot;
  turnCard: number;
  crib: number[];
  plays: number[];
  playOwners: PlayerKey[];
  completedPlays: number[][];
  completedPlayOwners: PlayerKey[][];
  count: number;
  turn: 0 | 1;
  goPlayer: PlayerKey | null;
  lastPlayer: PlayerKey | null;
  scoringReview: {
    stage: "pone" | "dealer" | "crib";
    title: string;
    owner: string;
    rawCards: number[];
    points: number;
    nextLabel: string;
  } | null;
  phase: Phase;
  message: string;
  log: string[];
  result: string[];
  pegPositions: Record<PlayerKey, [number | string, number | string]>;
}

export function cardFromString(input: string): Card {
  const rankText = input.slice(0, -1);
  const suitText = input.slice(-1);
  const rank = RANKS.indexOf(rankText);
  const suit = SUIT_ASCII.indexOf(suitText);
  if (rank === -1 || suit === -1) throw new Error(`Unknown card: ${input}`);
  return new Card(suit * 13 + rank);
}

export function cardsFromString(input: string): Card[] {
  return input.trim().split(/\s+/).filter(Boolean).map(cardFromString);
}

export function scoreHand(hand: Card[], turnCard: Card, crib = false): number {
  return (
    scoreFifteens(hand, turnCard) +
    scoreSets(hand, turnCard) +
    scoreRuns(hand, turnCard) +
    scoreFlushAndRightJack(hand, turnCard, crib)
  );
}

export function scoreFifteens(hand: Card[], turnCard: Card): number {
  let points = 0;
  for (const combo of combinations([...hand, turnCard], 2, 5)) {
    if (combo.reduce((total, card) => total + card.value, 0) === 15) points += 2;
  }
  return points;
}

export function scoreSets(hand: Card[], turnCard: Card): number {
  let points = 0;
  const cards = [...hand, turnCard];
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      if (cards[i].rank === cards[j].rank) points += 2;
    }
  }
  return points;
}

export function scoreRuns(hand: Card[], turnCard: Card): number {
  const counts = new Map<number, number>();
  for (const card of [...hand, turnCard]) {
    counts.set(card.runVal, (counts.get(card.runVal) ?? 0) + 1);
  }

  const runs: number[][] = [];
  let run: number[] = [];
  for (const value of [...counts.keys()].sort((a, b) => a - b)) {
    if (run.length === 0 || value === run[run.length - 1] + 1) {
      run.push(value);
    } else {
      if (run.length >= 3) runs.push(run);
      run = [value];
    }
  }
  if (run.length >= 3) runs.push(run);
  if (runs.length === 0) return 0;

  const longest = runs.reduce((best, candidate) =>
    candidate.length > best.length ? candidate : best,
  );
  return longest.length * longest.reduce((product, value) => product * (counts.get(value) ?? 1), 1);
}

export function scoreFlushAndRightJack(hand: Card[], turnCard: Card, crib = false): number {
  let points = 0;
  for (const card of hand) {
    if (card.rankStr === "J" && card.suit === turnCard.suit) points += 1;
  }
  const handSuits = new Set(hand.map((card) => card.suit));
  if (handSuits.size === 1) {
    const suit = hand[0]?.suit;
    if (suit === turnCard.suit) points += 5;
    else if (!crib) points += 4;
  }
  return points;
}

export function scoreCount(plays: Card[]): number {
  if (plays.length < 2) return 0;
  let score = 0;
  const count = plays.reduce((total, card) => total + card.value, 0);
  if (count === 15 || count === 31) score += 2;

  let sameRankCount = 1;
  for (let i = plays.length - 2; i >= 0; i -= 1) {
    if (plays[i].rank !== plays[plays.length - 1].rank) break;
    sameRankCount += 1;
  }
  score += new Map([
    [2, 2],
    [3, 6],
    [4, 12],
  ]).get(sameRankCount) ?? 0;

  for (let runLen = plays.length; runLen >= 3; runLen -= 1) {
    const vals = plays.slice(-runLen).map((card) => card.runVal);
    const unique = new Set(vals);
    const sorted = [...vals].sort((a, b) => a - b);
    if (
      unique.size === runLen &&
      sorted[sorted.length - 1] - sorted[0] + 1 === runLen
    ) {
      score += runLen;
      break;
    }
  }
  return score;
}

export class CribbageGame {
  human: PlayerState;
  ai: PlayerState;
  opponent: Opponent;
  deal: 0 | 1;
  firstDeal: 0 | 1;
  dealer!: PlayerState;
  pone!: PlayerState;
  turnCard!: Card;
  crib: Card[] = [];
  plays: Card[] = [];
  playOwners: PlayerKey[] = [];
  completedPlays: Card[][] = [];
  completedPlayOwners: PlayerKey[][] = [];
  handNumber = 1;
  count = 0;
  turn: 0 | 1 = 0;
  goPlayer: PlayerState | null = null;
  lastPlayer: PlayerState | null = null;
  scoringReview: ScoringReview | null = null;
  phase: Phase = "discard";
  message = "";
  log: string[] = [];
  result: string[] = [];
  gameId = createAnalyticsId("game");
  analyticsCounter = 0;
  analyticsEvents: AnalyticsEvent[] = [];
  pegPositions: Record<PlayerKey, [number | string, number | string]> = {
    human: ["start-back", "start-front"],
    ai: ["start-back", "start-front"],
  };

  constructor(opponent: Opponent = "expert") {
    this.opponent = opponent;
    this.human = { key: "human", name: "User", hand: [], table: [], crib: [], score: 0 };
    this.ai = { key: "ai", name: "AI", hand: [], table: [], crib: [], score: 0 };
    this.deal = Math.random() < 0.5 ? 0 : 1;
    this.firstDeal = this.deal;
    this.recordAnalytics({
      type: "game",
      action: "start",
      opponent: this.opponent,
    });
    this.startHand();
  }

  static restore(snapshot: GameSnapshot): CribbageGame {
    if (snapshot.version !== 1) throw new Error("Unsupported saved game version.");
    const game = new CribbageGame(snapshot.opponent);
    game.gameId = snapshot.gameId ?? createAnalyticsId("game");
    game.analyticsCounter = snapshot.analyticsCounter ?? 0;
    game.analyticsEvents = snapshot.analyticsEvents ? [...snapshot.analyticsEvents] : [];
    game.opponent = snapshot.opponent;
    game.deal = snapshot.deal;
    game.firstDeal = snapshot.firstDeal;
    game.human.hand = snapshot.human.hand.map((id) => new Card(id));
    game.human.table = snapshot.human.table.map((id) => new Card(id));
    game.human.crib = snapshot.human.crib.map((id) => new Card(id));
    game.human.score = snapshot.human.score;
    game.ai.hand = snapshot.ai.hand.map((id) => new Card(id));
    game.ai.table = snapshot.ai.table.map((id) => new Card(id));
    game.ai.crib = snapshot.ai.crib.map((id) => new Card(id));
    game.ai.score = snapshot.ai.score;
    game.handNumber = Math.max(snapshot.handNumber ?? 1, game.inferHandNumber(snapshot.phase));
    game.dealer = [game.human, game.ai][game.deal];
    game.pone = [game.human, game.ai][game.deal ^ 1];
    game.turnCard = new Card(snapshot.turnCard);
    game.crib = snapshot.crib.map((id) => new Card(id));
    game.plays = snapshot.plays.map((id) => new Card(id));
    game.playOwners = [...snapshot.playOwners];
    game.completedPlays = snapshot.completedPlays.map((group) => group.map((id) => new Card(id)));
    game.completedPlayOwners = snapshot.completedPlayOwners.map((group) => [...group]);
    game.count = snapshot.count;
    game.turn = snapshot.turn;
    game.goPlayer = snapshot.goPlayer ? game.playerByKey(snapshot.goPlayer) : null;
    game.lastPlayer = snapshot.lastPlayer ? game.playerByKey(snapshot.lastPlayer) : null;
    game.scoringReview = snapshot.scoringReview
      ? {
          stage: snapshot.scoringReview.stage,
          title: snapshot.scoringReview.title,
          owner: snapshot.scoringReview.owner,
          rawCards: snapshot.scoringReview.rawCards.map((id) => new Card(id)),
          cards: snapshot.scoringReview.rawCards.map((id) => game.serializeCard(new Card(id))),
          points: snapshot.scoringReview.points,
          nextLabel: snapshot.scoringReview.nextLabel,
        }
      : null;
    game.phase = snapshot.phase;
    game.message = snapshot.message;
    game.log = [...snapshot.log];
    game.result = [...snapshot.result];
    game.pegPositions = {
      human: [...snapshot.pegPositions.human],
      ai: [...snapshot.pegPositions.ai],
    };
    return game;
  }

  snapshot(): GameSnapshot {
    return {
      version: 1,
      gameId: this.gameId,
      analyticsCounter: this.analyticsCounter,
      analyticsEvents: [...this.analyticsEvents],
      opponent: this.opponent,
      deal: this.deal,
      firstDeal: this.firstDeal,
      handNumber: this.handNumber,
      human: this.playerSnapshot(this.human),
      ai: this.playerSnapshot(this.ai),
      turnCard: this.turnCard.id,
      crib: this.crib.map((card) => card.id),
      plays: this.plays.map((card) => card.id),
      playOwners: [...this.playOwners],
      completedPlays: this.completedPlays.map((group) => group.map((card) => card.id)),
      completedPlayOwners: this.completedPlayOwners.map((group) => [...group]),
      count: this.count,
      turn: this.turn,
      goPlayer: this.goPlayer?.key ?? null,
      lastPlayer: this.lastPlayer?.key ?? null,
      scoringReview: this.scoringReview
        ? {
            stage: this.scoringReview.stage,
            title: this.scoringReview.title,
            owner: this.scoringReview.owner,
            rawCards: this.scoringReview.rawCards.map((card) => card.id),
            points: this.scoringReview.points,
            nextLabel: this.scoringReview.nextLabel,
          }
        : null,
      phase: this.phase,
      message: this.message,
      log: [...this.log],
      result: [...this.result],
      pegPositions: {
        human: [...this.pegPositions.human],
        ai: [...this.pegPositions.ai],
      },
    };
  }

  startHand(): void {
    this.dealer = [this.human, this.ai][this.deal];
    this.pone = [this.human, this.ai][this.deal ^ 1];
    const deck = shuffledDeck();
    this.dealer.hand = deck.splice(0, 6);
    this.pone.hand = deck.splice(0, 6);
    this.dealer.table = [];
    this.pone.table = [];
    this.dealer.crib = [];
    this.pone.crib = [];
    this.turnCard = deck.shift()!;
    this.crib = [];
    this.plays = [];
    this.playOwners = [];
    this.completedPlays = [];
    this.completedPlayOwners = [];
    this.count = 0;
    this.turn = 0;
    this.goPlayer = null;
    this.lastPlayer = null;
    this.scoringReview = null;
    this.phase = "discard";
    this.logEvent(
      `Dealer: ${this.name(this.dealer)}. ${this.name(this.pone)} pegs first.`,
    );
    this.recordAnalytics({
      type: "hand",
      action: "start",
      handNumber: this.handNumber,
      dealer: this.dealer.key,
      pone: this.pone.key,
      scores: { human: this.human.score, ai: this.ai.score },
    });
    if (this.dealer === this.ai) this.aiDiscard();
  }

  state(): GameState {
    const current = this.phase === "pegging" ? this.currentPlayer() : null;
    const legalIds = new Set(this.legalCards(this.human).map((card) => card.id));
    const humanHand = this.phase === "discard" ? sortedCards(this.human.hand) : this.human.hand;
    return {
      phase: this.phase,
      message: this.message,
      log: this.log,
      result: this.result,
      handNumber: this.handNumber,
      scores: { human: this.human.score, ai: this.ai.score },
      pegPositions: this.pegPositions,
      dealer: this.name(this.dealer),
      firstDealer: this.name([this.human, this.ai][this.firstDeal]),
      cribOwner: this.name(this.dealer),
      turn: current ? this.name(current) : null,
      count: this.count,
      turnCard: this.phase === "discard" || this.phase === "ai_discarding"
        ? null
        : this.serializeCard(this.turnCard),
      plays: this.plays.map((card, index) => this.serializeCard(card, null, this.playOwners[index])),
      completedPlays: this.completedPlays.map((group, groupIndex) =>
        group.map((card, cardIndex) =>
          this.serializeCard(card, null, this.completedPlayOwners[groupIndex]?.[cardIndex]),
        ),
      ),
      humanHand: humanHand.map((card, index) => this.serializeCard(card, index)),
      aiHandCount: this.ai.hand.length,
      humanTable: this.human.table.map((card) => this.serializeCard(card)),
      aiTable: this.ai.table.map((card) => this.serializeCard(card)),
      legalCardIds: [...legalIds],
      canGo: this.phase === "pegging" && current === this.human && legalIds.size === 0,
      scoring: this.scoringReview
        ? {
            stage: this.scoringReview.stage,
            title: this.scoringReview.title,
            owner: this.scoringReview.owner,
            cards: this.scoringReview.rawCards.map((card) => this.serializeCard(card)),
            points: this.scoringReview.points,
            nextLabel: this.scoringReview.nextLabel,
          }
        : null,
      analyticsEvents: [...this.analyticsEvents],
    };
  }

  discard(ids: number[]): void {
    this.beginInteraction();
    if (this.phase !== "discard") throw new Error("It is not discard time.");
    const discards = this.selectedCards(sortedCards(this.human.hand), ids, 2);
    removeCards(this.human.hand, discards);
    this.crib.push(...discards);
    this.logEvent("User discarded two cards to the crib.");
    if (this.dealer === this.human) {
      this.phase = "ai_discarding";
      this.logEvent("Waiting for AI to discard.");
      return;
    }
    this.beginPegging();
  }

  finishDiscard(): void {
    this.beginInteraction();
    if (this.phase !== "ai_discarding") throw new Error("AI is not waiting to discard.");
    this.aiDiscard();
    this.beginPegging();
  }

  play(cardId: number): void {
    this.beginInteraction();
    if (this.phase !== "pegging" || this.currentPlayer() !== this.human) {
      throw new Error("It is not your turn to play.");
    }
    const legal = this.legalCards(this.human);
    if (legal.length === 0) {
      this.sayGo(this.human);
      this.advanceUntilHuman();
      return;
    }
    const card = this.selectedCards(this.human.hand, [cardId], 1)[0];
    if (!legal.includes(card)) throw new Error("That card would take the count over 31.");
    this.playCard(this.human, card);
    this.advanceUntilHuman();
  }

  go(): void {
    this.beginInteraction();
    if (this.phase !== "pegging" || this.currentPlayer() !== this.human) {
      throw new Error("It is not your turn.");
    }
    if (this.legalCards(this.human).length > 0) throw new Error("User has a legal card to play.");
    this.sayGo(this.human);
    this.advanceUntilHuman();
  }

  continueScoring(): void {
    this.beginInteraction();
    if (this.phase === "pegging_complete") this.startScoring();
    else if (this.phase === "score_pone") this.showScoreStage("dealer");
    else if (this.phase === "score_dealer") this.showScoreStage("crib");
    else if (this.phase === "score_crib") {
      this.recordAnalytics({
        type: "hand",
        action: "end",
        handNumber: this.handNumber,
        dealer: this.dealer.key,
        pone: this.pone.key,
        turnCard: this.cardLabel(this.turnCard),
        scores: { human: this.human.score, ai: this.ai.score },
      });
      this.scoringReview = null;
      this.deal = (this.deal ^ 1) as 0 | 1;
      this.handNumber += 1;
      this.startHand();
    } else {
      throw new Error("There is no hand score to continue.");
    }
  }

  private playerSnapshot(player: PlayerState): PlayerSnapshot {
    return {
      hand: player.hand.map((card) => card.id),
      table: player.table.map((card) => card.id),
      crib: player.crib.map((card) => card.id),
      score: player.score,
    };
  }

  private playerByKey(key: PlayerKey): PlayerState {
    return key === "human" ? this.human : this.ai;
  }

  private inferHandNumber(phase: Phase): number {
    if (
      this.human.score > 0 &&
      this.ai.score > 0 &&
      ["discard", "ai_discarding", "pegging"].includes(phase)
    ) {
      return 2;
    }
    return 1;
  }

  private selectedCards(hand: Card[], ids: number[], expectedCount: number): Card[] {
    if (ids.length !== expectedCount) {
      throw new Error(`Choose exactly ${expectedCount} card${expectedCount === 1 ? "" : "s"}.`);
    }
    if (new Set(ids).size !== expectedCount) throw new Error("Card selection contains duplicates.");
    const byId = new Map(hand.map((card) => [card.id, card]));
    return ids.map((id) => {
      const card = byId.get(id);
      if (!card) throw new Error("Card selection is out of range.");
      return card;
    });
  }

  private aiDiscard(): void {
    const discards = this.chooseDiscards(this.ai, this.dealer === this.ai);
    removeCards(this.ai.hand, discards);
    this.crib.push(...discards);
    this.logEvent("AI discarded two cards to the crib.");
  }

  private chooseDiscards(player: PlayerState, myCrib: boolean): Card[] {
    if (this.opponent === "random") return player.hand.slice(0, 2);
    const deck = fullDeck().filter((card) => !player.hand.some((held) => held.id === card.id));
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestDiscard = player.hand.slice(0, 2);

    for (const discard of combinations(player.hand, 2, 2)) {
      const keep = player.hand.filter((card) => !discard.includes(card));
      const handScore = mean(deck.map((cut) => scoreHand(keep, cut)));
      let cribTotal = 0;
      let cribCount = 0;
      for (const pot of combinations(deck, 3, 3)) {
        cribTotal += scoreHand([...discard, pot[0], pot[1]], pot[2], true);
        cribCount += 1;
      }
      const cribScore = cribTotal / cribCount;
      const total = myCrib ? handScore + cribScore : handScore - cribScore;
      if (total > bestScore) {
        bestScore = total;
        bestDiscard = discard;
      }
    }
    return bestDiscard;
  }

  private beginPegging(): void {
    this.phase = "pegging";
    this.dealer.crib = [...this.crib];
    this.logEvent(`Turn card is ${this.cardLabel(this.turnCard)}.`);
    if (this.turnCard.rankStr === "J") {
      this.recordScore(this.dealer, "pegging", 2, "his heels", this.turnCard);
      this.peg(this.dealer, 2);
      this.logEvent(`${this.name(this.dealer)} pegged 2 for his heels.`);
    }
    this.advanceUntilHuman();
  }

  private advanceUntilHuman(): void {
    while (this.phase === "pegging") {
      if (this.dealer.hand.length + this.pone.hand.length === 0) {
        this.finishPegging();
        this.phase = "pegging_complete";
        return;
      }
      const player = this.currentPlayer();
      if (player === this.human) {
        if (this.legalCards(player).length === 0) {
          this.sayGo(player);
          continue;
        }
        this.logEvent("User turn.");
        return;
      }
      if (this.legalCards(player).length === 0) {
        this.sayGo(player);
        continue;
      }
      this.playCard(player, this.choosePlay(player));
    }
  }

  private finishPegging(): void {
    if (this.lastPlayer && this.count !== 0) {
      this.recordScore(this.lastPlayer, "pegging", 1, "last card", undefined, this.count);
      this.peg(this.lastPlayer, 1);
      this.logEvent(`${this.name(this.lastPlayer)} pegged 1 for last card.`);
      this.archivePlays();
      this.plays = [];
      this.playOwners = [];
      this.count = 0;
      this.goPlayer = null;
      this.lastPlayer = null;
    }
  }

  private choosePlay(player: PlayerState): Card {
    const legal = this.legalCards(player);
    if (this.opponent === "random") return legal[Math.floor(Math.random() * legal.length)];
    return legal.reduce((best, card) => {
      const bestKey = [scoreCount([...this.plays, best]), -best.value, -best.runVal];
      const cardKey = [scoreCount([...this.plays, card]), -card.value, -card.runVal];
      return compareTuple(cardKey, bestKey) > 0 ? card : best;
    });
  }

  private playCard(player: PlayerState, card: Card): void {
    player.table.push(card);
    removeCards(player.hand, [card]);
    this.plays.push(card);
    this.playOwners.push(player.key);
    this.count += card.value;
    this.lastPlayer = player;
    const points = scoreCount(this.plays);
    this.recordAnalytics({
      type: "pegging",
      action: "play",
      handNumber: this.handNumber,
      player: player.key,
      role: this.roleFor(player),
      card: this.cardLabel(card),
      count: this.count,
      message: `${this.name(player)} played ${this.cardLabel(card)}: ${this.count}`,
    });
    if (points) this.recordScore(player, "pegging", points, "count", card, this.count);
    if (points) this.peg(player, points);
    this.logEvent(
      `${this.name(player)} played ${this.cardLabel(card)}: ${this.count}` +
        (points ? ` and pegged ${points}.` : "."),
    );
    if (this.count === 31) {
      this.archivePlays();
      this.plays = [];
      this.playOwners = [];
      this.count = 0;
      this.goPlayer = null;
      this.lastPlayer = null;
      this.recordAnalytics({
        type: "pegging",
        action: "reset",
        handNumber: this.handNumber,
        count: 0,
        message: "Count hit 31 and resets.",
      });
      this.logEvent("Count hit 31 and resets.");
      this.otherTurn();
    } else if (!this.goPlayer) {
      this.otherTurn();
    }
  }

  private sayGo(player: PlayerState): void {
    if (this.goPlayer) {
      if (this.lastPlayer && this.count !== 31) {
        this.recordScore(this.lastPlayer, "pegging", 1, "go", undefined, this.count);
        this.peg(this.lastPlayer, 1);
        this.logEvent(`${this.name(this.lastPlayer)} pegged 1 for go.`);
      }
      this.archivePlays();
      this.plays = [];
      this.playOwners = [];
      this.count = 0;
      this.goPlayer = null;
      this.lastPlayer = null;
      this.recordAnalytics({
        type: "pegging",
        action: "reset",
        handNumber: this.handNumber,
        count: 0,
        message: "Count resets to 0.",
      });
      this.logEvent("Count resets to 0.");
      this.otherTurn();
    } else {
      this.goPlayer = player;
      this.recordAnalytics({
        type: "pegging",
        action: "go",
        handNumber: this.handNumber,
        player: player.key,
        role: this.roleFor(player),
        count: this.count,
        message: `${this.name(player)} says go.`,
      });
      this.logEvent(`${this.name(player)} says go.`);
      this.otherTurn();
    }
  }

  private startScoring(): void {
    this.showScoreStage("pone");
  }

  private showScoreStage(stage: "pone" | "dealer" | "crib"): void {
    let player: PlayerState;
    let cards: Card[];
    let points: number;
    let title: string;
    let nextLabel: string;

    if (stage === "pone") {
      player = this.pone;
      cards = this.pone.table;
      points = scoreHand(cards, this.turnCard);
      title = `${this.name(player)} hand`;
      nextLabel = "Show dealer hand";
      this.phase = "score_pone";
    } else if (stage === "dealer") {
      player = this.dealer;
      cards = this.dealer.table;
      points = scoreHand(cards, this.turnCard);
      title = `${this.name(player)} hand`;
      nextLabel = "Show crib";
      this.phase = "score_dealer";
    } else {
      player = this.dealer;
      cards = this.dealer.crib;
      points = scoreHand(cards, this.turnCard, true);
      title = `${this.name(player)} crib`;
      nextLabel = "Next hand";
      this.phase = "score_crib";
    }

    this.scoringReview = {
      stage,
      title,
      owner: this.name(player),
      rawCards: [...cards],
      cards: cards.map((card) => this.serializeCard(card)),
      points,
      nextLabel,
    };
    this.recordScore(player, stage === "crib" ? "crib" : "hand", points, title);
    this.peg(player, points);
    this.logEvent(`${title} scored ${points}.`);
  }

  private legalCards(player: PlayerState): Card[] {
    return player.hand.filter((card) => this.count + card.value <= 31);
  }

  private currentPlayer(): PlayerState {
    return this.turn === 0 ? this.pone : this.dealer;
  }

  private otherTurn(): void {
    this.turn = (this.turn ^ 1) as 0 | 1;
  }

  private peg(player: PlayerState, points: number): void {
    if (points <= 0) return;
    const oldFront = this.pegPositions[player.key][1];
    player.score = Math.min(player.score + points, 121);
    this.pegPositions[player.key] = [oldFront, player.score];
    if (player.score >= 121) {
      this.phase = "game_over";
      const message = `${this.name(player)} won.`;
      this.recordAnalytics({
        type: "hand",
        action: "end",
        handNumber: this.handNumber,
        dealer: this.dealer.key,
        pone: this.pone.key,
        turnCard: this.cardLabel(this.turnCard),
        scores: { human: this.human.score, ai: this.ai.score },
      });
      this.recordAnalytics({
        type: "game",
        action: "end",
        opponent: this.opponent,
        winner: player.key,
        finalScores: { human: this.human.score, ai: this.ai.score },
      });
      this.logEvent(message);
      throw new WinGame(message);
    }
  }

  private recordScore(
    player: PlayerState,
    category: AnalyticsScoreCategory,
    points: number,
    reason: string,
    card?: Card,
    count?: number,
  ): void {
    if (points <= 0) return;
    this.recordAnalytics({
      type: "score",
      handNumber: this.handNumber,
      player: player.key,
      role: this.roleFor(player),
      category,
      points,
      reason,
      totalScore: Math.min(player.score + points, 121),
      card: card ? this.cardLabel(card) : undefined,
      count,
    });
  }

  private recordAnalytics(
    event: NewAnalyticsEvent,
  ): void {
    this.analyticsCounter += 1;
    this.analyticsEvents.push({
      ...event,
      id: `${this.gameId}-${this.analyticsCounter}`,
      at: new Date().toISOString(),
      gameId: this.gameId,
    } as AnalyticsEvent);
    this.analyticsEvents = this.analyticsEvents.slice(-2000);
  }

  private roleFor(player: PlayerState): AnalyticsRole {
    return player === this.dealer ? "dealer" : "pone";
  }

  private archivePlays(): void {
    if (this.plays.length) {
      this.completedPlays.push([...this.plays]);
      this.completedPlayOwners.push([...this.playOwners]);
    }
  }

  private logEvent(message: string): void {
    this.message = message;
    this.log.unshift(message);
    this.log = this.log.slice(0, 12);
    this.result.push(message);
  }

  private beginInteraction(): void {
    this.result = [];
  }

  private name(player: PlayerState): string {
    return player === this.human ? "User" : "AI";
  }

  private cardLabel(card: Card): string {
    return card.ascii;
  }

  private serializeCard(card: Card, index: number | null = null, owner?: PlayerKey): SerializedCard {
    return {
      index,
      id: card.id,
      rank: card.rankStr,
      suit: SUIT_NAMES[card.suit],
      symbol: SUIT_SYMBOLS[card.suit],
      value: card.value,
      label: this.cardLabel(card),
      owner,
    };
  }
}

function fullDeck(): Card[] {
  return Array.from({ length: 52 }, (_, id) => new Card(id));
}

function shuffledDeck(): Card[] {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function sortedCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.id - b.id);
}

function removeCards(hand: Card[], cards: Card[]): void {
  for (const card of cards) {
    const index = hand.findIndex((candidate) => candidate.id === card.id);
    if (index !== -1) hand.splice(index, 1);
  }
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function combinations<T>(items: T[], minSize: number, maxSize = minSize): T[][] {
  const result: T[][] = [];
  const selected: T[] = [];
  function visit(start: number, size: number): void {
    if (selected.length === size) {
      result.push([...selected]);
      return;
    }
    for (let i = start; i <= items.length - (size - selected.length); i += 1) {
      selected.push(items[i]);
      visit(i + 1, size);
      selected.pop();
    }
  }
  for (let size = minSize; size <= maxSize; size += 1) {
    visit(0, size);
  }
  return result;
}

function compareTuple(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function createAnalyticsId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
