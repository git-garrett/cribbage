from itertools import combinations
from random import shuffle

try:
    import numpy as np
except ModuleNotFoundError:
    class _Array(list):
        def mean(self):
            return sum(self) / len(self)

    class _NumpyFallback:
        @staticmethod
        def array(items):
            return _Array(items)

        @staticmethod
        def argmax(items):
            return max(range(len(items)), key=items.__getitem__)

        @staticmethod
        def argmin(items):
            return min(range(len(items)), key=items.__getitem__)

    np = _NumpyFallback()

from .score import score_hand, score_count
from .card import Deck


class WinGame(Exception):
    pass


class Player:
    """
    Here we define a base class for the various kinds of players in the 
    cribbage game. To define your own player, inherit from this class and 
    implement ``ask_for_input`` and ``ask_for_discards``
    """

    def __init__(self, name=None):
        self.name = name
        self.hand = []  # cards in player's hand
        self.table = [] # cards on table in front of player
        self.crib = []  # cards in player's crib
        self.score = 0

    # Discards

    def ask_for_discards(self):
        """Should return two cards from the player"""
        raise Exception("You need to implement `ask_for_discards` yourself")


    def update_after_discards(self, discards):
        for discard in discards:
            self.hand.remove(discard)


    def discards(self):
        cards = self.ask_for_discards()
        self.update_after_discards(cards)
        return cards


    # Counting plays

    def ask_for_play(self, plays):
        """Should return a single card from the player

        Private method"""
        raise Exception("You need to implement `ask_for_play` yourself")


    def update_after_play(self, play):
        """Private method"""
        
        self.table.append(play)
        self.hand.remove(play)


    def play(self, count, plays):
        """Public method"""
        if not self.hand:
            print('>>> I have no cards', self)
            return "No cards!"
        elif all(count + card.value > 31 for card in self.hand):
            print(">>>", self, self.hand, "I have to say 'go' on that one")
            return "Go!"
        while True:
            print(plays)
            card = self.ask_for_play(plays)  # subclasses (that is, actual players) must implement this
            #print("Nominated card", card)
            if sum((pp.value for pp in plays)) + card.value < 32:
                self.update_after_play(card)
                return card
            else: 
                # `self.ask_for_play` has returned a card that would put the 
                # score above 31 but the player's hand contains at least one
                # card that could be legally played (you're not allowed to say
                # "go" here if you can legally play). How the code knows that 
                # the player has a legal move is beyond me
                print('>>> You nominated', card, 'but that is not a legal play given your hand. You must play if you can')


    # Scoring

    def peg(self, points):
        self.score += points
        if self.score > 120:
            self.win_game()


    def count_hand(self, turn_card):
        """Count the hand (which should be on the table)"""
        score = score_hand(self.table, turn_card)
        self.peg(score)
        return score 


    def count_crib(self, turn_card):
        """Count crib, with side effect of pegging the score"""
        score = score_hand(self.crib, turn_card, crib=True)
        self.peg(score)
        return score 


    def win_game(self):
        raise WinGame(f"""Game was won by {self}  """
                      f"""{self.score} {self.table}""")


    @property
    def sorted_hand(self):
        return sorted(self.hand, key=lambda c: c.index)

    def __repr__(self):
        if self.name:
            return self.name + f'(score={self.score})'
        return str(self.__class__) + f'(score={self.score})'


class RandomPlayer(Player):
    """
    A player who plays randomly
    """

    def ask_for_play(self, plays):
        shuffle(self.hand) # this handles a case when 0 is not a legal play
        return self.hand[0]


    def ask_for_discards(self):
        # and isn't needed here 
        return self.hand[0:2]


NondeterministicAIPlayer = RandomPlayer


class HumanPlayer(Player):
    """
    A human player. This class implements scene rendering and taking input from
    the command line 
    """


    def ask_for_play(self, plays):
        """Ask a human for a card during counting"""
        
        d = dict(enumerate(self.hand, 1))
        print(f">>> Your hand ({self}):", " ".join([str(c) for c in self.hand]))

        while True:
            inp = input(">>> Card number to play: ") or "1"
            if len(inp) > 0 and int(inp) in d.keys():
                card = d[int(inp)]
                return card


    def ask_for_discards(self):
        """After deal, ask a human for two cards to discard to crib"""

        d = dict(enumerate(self.sorted_hand, 1))

        print('>>> Please nominate two cards to discard to the crib')
        print(f'>>> {d[1]} {d[2]} {d[3]} {d[4]} {d[5]} {d[6]}')
        discard_prompt = ">>> "

        while True:
            inp = input(discard_prompt) or "12"
            cards = [d[int(i)] for i in inp.replace(" ", "").replace(",", "")]
            if len(cards) == 2:
                print(f">>> Discarded {cards[0]} {cards[1]}")
                return cards


class EnumerativeAIPlayer(Player):
    """
    "Expert systems" style AI player that systematically
    enumerates possible moves and chooses the move that
    maximizes its score after the move
    """

    def ask_for_discards(self, my_crib=True, choose='mean'):
        """
        For each possible discard, score the expected kept hand value and
        expected crib value, then select the highest scoring move.

        Parameters
        ----------
        my_crib: bool
            Is it my crib?
        choose: str
            Choose the discard with either the best `"mean"` expected score or the
            best `"max"` possible score given the six cards in my hand
        """

        #print("cribbage: {} is choosing discards".format(self))
        deck = list(Deck().draw(52))
        potential_cards = [n for n in deck if n not in self.hand]
        assert 6 == len(self.hand)
        assert 52 - 6 == len(potential_cards)

        scored_discards = []
        for discard in combinations(self.hand, 2):  # 6 choose 2 == 15
            keep = [card for card in self.hand if card not in discard]
            hand_scores = [score_hand(keep, cut) for cut in potential_cards]

            crib_scores = [
                score_hand([*discard, *crib_cards], cut, crib=True)
                for *crib_cards, cut in combinations(potential_cards, 3)
            ]

            if choose == 'mean':
                hand_score = sum(hand_scores) / len(hand_scores)
                crib_score = sum(crib_scores) / len(crib_scores)
            elif choose == 'max':
                hand_score = max(hand_scores)
                crib_score = max(crib_scores)
            else:
                raise ValueError(f"Unknown discard strategy: {choose}")

            total_score = hand_score + crib_score if my_crib else hand_score - crib_score
            scored_discards.append((total_score, discard))

        _, discard = max(scored_discards, key=lambda item: item[0])
        return list(discard)


    def ask_for_play(self, plays):
        """
        Calculate points for each possible play in your hand
        and choose the one that maximizes the points
        """

        count = sum(card.value for card in plays)
        legal = [card for card in self.hand if count + card.value <= 31]
        candidates = legal or list(self.hand)

        return max(
            candidates,
            key=lambda card: (score_count(plays + [card]), -card.value, -card.run_val),
        )


class StudentAIPlayer(Player):

    def __init__(self):
        self.model = lambda x: self.hand[:2]

    def ask_for_discards(self):
        return self._ask_model_for_discards()

    def ask_for_play(self, plays):
        return self._ask_model_for_play()

    def _ask_model_for_discards(self):
        return self.model(self.hand)

    def _ask_model_for_play(self):
        return self.model(self.table)
