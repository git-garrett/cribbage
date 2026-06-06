export type PlayerKey = "human" | "ai";
export type Opponent = "expert" | "random";
export type Phase =
  | "discard"
  | "ai_discarding"
  | "pegging"
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
}

export interface GameState {
  phase: Phase;
  message: string;
  log: string[];
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
}

type ScoringReview = NonNullable<GameState["scoring"]> & { rawCards: Card[] };

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
  completedPlays: Card[][] = [];
  count = 0;
  turn: 0 | 1 = 0;
  goPlayer: PlayerState | null = null;
  lastPlayer: PlayerState | null = null;
  scoringReview: ScoringReview | null = null;
  phase: Phase = "discard";
  message = "";
  log: string[] = [];
  pegPositions: Record<PlayerKey, [number | string, number | string]> = {
    human: ["start-back", "start-front"],
    ai: ["start-back", "start-front"],
  };

  constructor(opponent: Opponent = "expert") {
    this.opponent = opponent;
    this.human = { key: "human", name: "You", hand: [], table: [], crib: [], score: 0 };
    this.ai = { key: "ai", name: "DCarlin", hand: [], table: [], crib: [], score: 0 };
    this.deal = Math.random() < 0.5 ? 0 : 1;
    this.firstDeal = this.deal;
    this.startHand();
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
    this.completedPlays = [];
    this.count = 0;
    this.turn = 0;
    this.goPlayer = null;
    this.lastPlayer = null;
    this.scoringReview = null;
    this.phase = "discard";
    this.logEvent(
      `New hand. Dealer and crib: ${this.name(this.dealer)}. ${this.name(this.pone)} pegs first.`,
    );
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
      plays: this.plays.map((card) => this.serializeCard(card)),
      completedPlays: this.completedPlays.map((group) =>
        group.map((card) => this.serializeCard(card)),
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
    };
  }

  discard(ids: number[]): void {
    if (this.phase !== "discard") throw new Error("It is not discard time.");
    const discards = this.selectedCards(sortedCards(this.human.hand), ids, 2);
    removeCards(this.human.hand, discards);
    this.crib.push(...discards);
    if (this.dealer === this.human) {
      this.phase = "ai_discarding";
      this.logEvent("Waiting for DCarlin to discard.");
      return;
    }
    this.beginPegging();
  }

  finishDiscard(): void {
    if (this.phase !== "ai_discarding") throw new Error("DCarlin is not waiting to discard.");
    this.aiDiscard();
    this.beginPegging();
  }

  play(cardId: number): void {
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
    if (this.phase !== "pegging" || this.currentPlayer() !== this.human) {
      throw new Error("It is not your turn.");
    }
    if (this.legalCards(this.human).length > 0) throw new Error("You have a legal card to play.");
    this.sayGo(this.human);
    this.advanceUntilHuman();
  }

  continueScoring(): void {
    if (this.phase === "score_pone") this.showScoreStage("dealer");
    else if (this.phase === "score_dealer") this.showScoreStage("crib");
    else if (this.phase === "score_crib") {
      this.scoringReview = null;
      this.deal = (this.deal ^ 1) as 0 | 1;
      this.startHand();
    } else {
      throw new Error("There is no hand score to continue.");
    }
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
    this.logEvent("DCarlin discarded two cards to the crib.");
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
      this.peg(this.dealer, 2);
      this.logEvent(`${this.name(this.dealer)} pegged 2 for his heels.`);
    }
    this.advanceUntilHuman();
  }

  private advanceUntilHuman(): void {
    while (this.phase === "pegging") {
      if (this.dealer.hand.length + this.pone.hand.length === 0) {
        this.finishPegging();
        this.startScoring();
        return;
      }
      const player = this.currentPlayer();
      if (player === this.human) {
        if (this.legalCards(player).length === 0) {
          this.sayGo(player);
          continue;
        }
        this.logEvent("Your turn.");
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
      this.peg(this.lastPlayer, 1);
      this.logEvent(`${this.name(this.lastPlayer)} pegged 1 for last card.`);
      this.archivePlays();
      this.plays = [];
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
    this.count += card.value;
    this.lastPlayer = player;
    const points = scoreCount(this.plays);
    if (points) this.peg(player, points);
    this.logEvent(
      `${this.name(player)} played ${this.cardLabel(card)}: ${this.count}` +
        (points ? ` and pegged ${points}.` : "."),
    );
    if (this.count === 31) {
      this.archivePlays();
      this.plays = [];
      this.count = 0;
      this.goPlayer = null;
      this.lastPlayer = null;
      this.logEvent("Count hit 31 and resets.");
      this.otherTurn();
    } else if (!this.goPlayer) {
      this.otherTurn();
    }
  }

  private sayGo(player: PlayerState): void {
    if (this.goPlayer) {
      if (this.lastPlayer && this.count !== 31) {
        this.peg(this.lastPlayer, 1);
        this.logEvent(`${this.name(this.lastPlayer)} pegged 1 for go.`);
      }
      this.archivePlays();
      this.plays = [];
      this.count = 0;
      this.goPlayer = null;
      this.lastPlayer = null;
      this.logEvent("Count resets to 0.");
      this.otherTurn();
    } else {
      this.goPlayer = player;
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
      this.logEvent(message);
      throw new WinGame(message);
    }
  }

  private archivePlays(): void {
    if (this.plays.length) this.completedPlays.push([...this.plays]);
  }

  private logEvent(message: string): void {
    this.message = message;
    this.log.unshift(message);
    this.log = this.log.slice(0, 12);
  }

  private name(player: PlayerState): string {
    return player === this.human ? "You" : "DCarlin";
  }

  private cardLabel(card: Card): string {
    return card.ascii;
  }

  private serializeCard(card: Card, index: number | null = null): SerializedCard {
    return {
      index,
      id: card.id,
      rank: card.rankStr,
      suit: SUIT_NAMES[card.suit],
      symbol: SUIT_SYMBOLS[card.suit],
      value: card.value,
      label: this.cardLabel(card),
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
