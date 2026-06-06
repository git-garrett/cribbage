import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from random import choice
from urllib.parse import urlparse

from cribbage.card import Deck
from cribbage.players import Player, RandomPlayer, EnumerativeAIPlayer, WinGame
from cribbage.score import score_count, score_hand


ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"


class BrowserPlayer(Player):
    pass


class WebCribbageGame:
    def __init__(self, opponent="expert"):
        self.human = BrowserPlayer("You")
        self.ai = self._make_ai(opponent)
        self.deal = choice((0, 1))
        self.dealer = None
        self.pone = None
        self.turn_card = None
        self.crib = []
        self.plays = []
        self.completed_plays = []
        self.count = 0
        self.turn = 0
        self.go_has_been_said = False
        self.last_player = None
        self.phase = "new"
        self.message = ""
        self.log = []
        self.peg_positions = {
            "human": ["start-back", "start-front"],
            "ai": ["start-back", "start-front"],
        }
        self.start_hand()

    def _make_ai(self, opponent):
        if opponent == "random":
            return RandomPlayer("DCarlin Random")
        return EnumerativeAIPlayer("DCarlin Expert")

    def start_hand(self):
        self.dealer = [self.human, self.ai][self.deal]
        self.pone = [self.human, self.ai][self.deal ^ 1]
        deck = Deck()
        self.dealer.hand = list(deck.draw(6))
        self.pone.hand = list(deck.draw(6))
        self.dealer.table = []
        self.pone.table = []
        self.dealer.crib = []
        self.pone.crib = []
        self.turn_card = next(deck.draw(1))
        self.crib = []
        self.plays = []
        self.count = 0
        self.turn = 0
        self.go_has_been_said = False
        self.last_player = None
        self.phase = "discard"
        self.log_event(
            f"New hand. Dealer and crib: {self.name(self.dealer)}. "
            f"{self.name(self.pone)} pegs first."
        )
        if self.dealer is self.ai:
            self.ai_discard()

    def log_event(self, message):
        self.message = message
        self.log.insert(0, message)
        self.log = self.log[:12]

    def name(self, player):
        return "You" if player is self.human else "DCarlin"

    def player_key(self, player):
        return "human" if player is self.human else "ai"

    def peg(self, player, points):
        if points <= 0:
            return
        key = self.player_key(player)
        old_front = self.peg_positions[key][1]
        player.score = min(player.score + points, 121)
        self.peg_positions[key] = [old_front, player.score]
        self.check_winner()

    def ai_discard(self):
        discards = self.choose_discards(self.ai, self.dealer is self.ai)
        self.remove_cards(self.ai.hand, discards)
        self.crib.extend(discards)
        self.log_event(f"DCarlin discarded two cards to the crib.")

    def choose_discards(self, player, my_crib):
        try:
            return player.ask_for_discards(my_crib=my_crib)
        except TypeError:
            return player.ask_for_discards()

    def discard(self, indexes):
        if self.phase != "discard":
            raise ValueError("It is not discard time.")
        if len(indexes) != 2:
            raise ValueError("Choose exactly two cards.")
        hand = self.human.sorted_hand
        if any(index < 0 or index >= len(hand) for index in indexes):
            raise ValueError("Discard selection is out of range.")
        discards = [hand[index] for index in indexes]
        self.remove_cards(self.human.hand, discards)
        self.crib.extend(discards)
        if self.dealer is self.human:
            self.ai_discard()
        self.dealer.crib = list(self.crib)
        self.phase = "pegging"
        self.log_event(f"Turn card is {self.card_label(self.turn_card)}.")
        if self.turn_card.rank_str == "J":
            self.peg(self.dealer, 2)
            self.log_event(f"{self.name(self.dealer)} pegged 2 for his heels.")
        self.advance_until_human()

    def play(self, index):
        if self.phase != "pegging" or self.current_player() is not self.human:
            raise ValueError("It is not your turn to play.")
        legal = self.legal_cards(self.human)
        if not legal:
            self.say_go(self.human)
            self.advance_until_human()
            return
        if index < 0 or index >= len(self.human.hand):
            raise ValueError("Card selection is out of range.")
        card = self.human.hand[index]
        if card not in legal:
            raise ValueError("That card would take the count over 31.")
        self.play_card(self.human, card)
        self.advance_until_human()

    def current_player(self):
        return {0: self.pone, 1: self.dealer}[self.turn]

    def other_turn(self):
        self.turn = self.turn ^ 1

    def legal_cards(self, player):
        return [card for card in player.hand if self.count + card.value <= 31]

    def advance_until_human(self):
        while self.phase == "pegging":
            if len(self.dealer.hand) + len(self.pone.hand) == 0:
                self.score_hands()
                return
            player = self.current_player()
            if player is self.human:
                if not self.legal_cards(player):
                    self.say_go(player)
                    continue
                self.log_event("Your turn.")
                return
            if not self.legal_cards(player):
                self.say_go(player)
                continue
            card = self.choose_play(player)
            self.play_card(player, card)

    def choose_play(self, player):
        legal = self.legal_cards(player)
        try:
            card = player.ask_for_play(self.plays)
            if card in legal:
                return card
        except Exception:
            pass
        return max(legal, key=lambda card: score_count(self.plays + [card]))

    def say_go(self, player):
        if self.go_has_been_said:
            if self.last_player and self.count != 31:
                self.peg(self.last_player, 1)
                self.log_event(f"{self.name(self.last_player)} pegged 1 for go.")
            self.archive_plays()
            self.plays = []
            self.count = 0
            self.go_has_been_said = False
            self.last_player = None
            self.log_event("Count resets to 0.")
        else:
            self.go_has_been_said = True
            self.log_event(f"{self.name(player)} says go.")
            self.other_turn()

    def play_card(self, player, card):
        player.update_after_play(card)
        self.plays.append(card)
        self.count += card.value
        self.last_player = player
        self.go_has_been_said = False
        points = score_count(self.plays)
        if points:
            self.peg(player, points)
        self.log_event(
            f"{self.name(player)} played {self.card_label(card)}: {self.count}"
            + (f" and pegged {points}." if points else ".")
        )
        if self.count == 31:
            self.archive_plays()
            self.plays = []
            self.count = 0
            self.go_has_been_said = False
            self.last_player = None
            self.log_event("Count hit 31 and resets.")
        self.other_turn()

    def score_hands(self):
        pone_points = score_hand(self.pone.table, self.turn_card)
        self.peg(self.pone, pone_points)
        dealer_points = score_hand(self.dealer.table, self.turn_card)
        self.peg(self.dealer, dealer_points)
        crib_points = score_hand(self.dealer.crib, self.turn_card)
        self.peg(self.dealer, crib_points)
        self.log_event(
            f"Hand scored: pone {pone_points}, dealer {dealer_points}, crib {crib_points}."
        )
        self.deal = self.deal ^ 1
        self.start_hand()

    def archive_plays(self):
        if self.plays:
            self.completed_plays.append(list(self.plays))

    def check_winner(self):
        if self.human.score >= 121 or self.ai.score >= 121:
            winner = self.human if self.human.score >= 121 else self.ai
            self.phase = "game_over"
            raise WinGame(f"{self.name(winner)} won.")

    @staticmethod
    def remove_cards(hand, cards):
        for card in cards:
            hand.remove(card)

    @staticmethod
    def card_label(card):
        return f"{card.rank_str}{card.ascii_str[-1]}"

    def serialize_card(self, card, index=None):
        suit_names = ["diamonds", "clubs", "hearts", "spades"]
        suit_symbols = ["♦", "♣", "♥", "♠"]
        return {
            "index": index,
            "id": card.index,
            "rank": str(card.rank_str),
            "suit": suit_names[card.suit],
            "symbol": suit_symbols[card.suit],
            "value": card.value,
            "label": self.card_label(card),
        }

    def state(self):
        player = self.current_player() if self.phase == "pegging" else None
        legal_ids = {card.index for card in self.legal_cards(self.human)}
        human_hand = self.human.sorted_hand if self.phase == "discard" else self.human.hand
        return {
            "phase": self.phase,
            "message": self.message,
            "log": self.log,
            "scores": {"human": self.human.score, "ai": self.ai.score},
            "pegPositions": self.peg_positions,
            "dealer": self.name(self.dealer),
            "cribOwner": self.name(self.dealer),
            "turn": self.name(player) if player else None,
            "count": self.count,
            "turnCard": None if self.phase == "discard" else self.serialize_card(self.turn_card),
            "plays": [self.serialize_card(card) for card in self.plays],
            "completedPlays": [
                [self.serialize_card(card) for card in group]
                for group in self.completed_plays
            ],
            "humanHand": [
                self.serialize_card(card, index) for index, card in enumerate(human_hand)
            ],
            "aiHandCount": len(self.ai.hand),
            "humanTable": [self.serialize_card(card) for card in self.human.table],
            "aiTable": [self.serialize_card(card) for card in self.ai.table],
            "legalCardIds": list(legal_ids),
            "canGo": self.phase == "pegging" and player is self.human and not legal_ids,
        }


GAME = None


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean_path = urlparse(path).path
        if clean_path == "/":
            clean_path = "/index.html"
        return str(WEB_ROOT / clean_path.lstrip("/"))

    def do_GET(self):
        if self.path.startswith("/api/state"):
            self.send_json(current_state())
            return
        super().do_GET()

    def do_POST(self):
        try:
            payload = self.read_json()
            if self.path == "/api/new":
                new_game(payload.get("opponent", "expert"))
                self.send_json(current_state())
            elif self.path == "/api/discard":
                GAME.discard(payload.get("indexes", []))
                self.send_json(current_state())
            elif self.path == "/api/play":
                GAME.play(payload.get("index"))
                self.send_json(current_state())
            elif self.path == "/api/go":
                if GAME.phase != "pegging" or GAME.current_player() is not GAME.human:
                    raise ValueError("It is not your turn.")
                if GAME.legal_cards(GAME.human):
                    raise ValueError("You have a legal card to play.")
                GAME.say_go(GAME.human)
                GAME.advance_until_human()
                self.send_json(current_state())
            else:
                self.send_error(404)
        except WinGame as error:
            GAME.phase = "game_over"
            GAME.log_event(str(error))
            self.send_json(current_state())
        except Exception as error:
            self.send_json({"error": str(error), "state": current_state()}, status=400)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def new_game(opponent="expert"):
    global GAME
    GAME = WebCribbageGame(opponent)


def current_state():
    global GAME
    if GAME is None:
        new_game("expert")
    return GAME.state()


if __name__ == "__main__":
    new_game("expert")
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("Cribbage web UI: http://127.0.0.1:8765")
    server.serve_forever()
