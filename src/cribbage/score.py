from collections import Counter
from itertools import combinations
from math import prod


def score_hand(hand, turn_card, crib=False) -> int:
    """Score a valid cribbage hand
    
    Parameters
    ----------
    hand: list of cribbage.Card
        Exactly four cards forming a hand 
        
    turn_card: cribbage.Card
        The turn card 
    """

    #if len(hand) != 4:
    #    raise ValueError(
    #        "To score a hand, it must have 4 cards, not {}".format(len(hand))
    #    )

    points = 0
    points += score_fifteens(hand, turn_card)
    points += score_sets(hand, turn_card)
    points += score_runs(hand, turn_card)
    points += score_flush_and_right_jack(hand, turn_card, crib=crib)

    return points


def score_play(plays):
    """Score a play during counting"""
    assert len(plays) > 1
    return score_hand(plays[:-1], plays[-1])


def score_fifteens(hand, turn_card):
    points = 0
    for vector_length in [2, 3, 4, 5]:
        for vector in combinations(hand + [turn_card], vector_length):
            if sum(x.value for x in vector) == 15:
                points += 2

    return points


def score_flush_and_right_jack(hand, turn_card, crib=False):

    points = 0
    hand_suits = []
    for card in hand:
        hand_suits.append(card.suit)
        if card.rank_str == "J" and card.suit == turn_card.suit:
            # the right jack
            points += 1

    # flush
    if len(set(hand_suits)) == 1:
        if hand_suits[0] == turn_card.suit:
            points += 5
        elif not crib:
            points += 4

    return points


def score_sets(hand, turn_card):
    points = 0
    # pairs (not necessary to account for more than pairs for ==)
    for i, j in combinations(hand + [turn_card], 2):
        if i.rank == j.rank:
            points += 2

    return points


def score_runs(hand, turn_card):
    counts = Counter(card.run_val for card in hand + [turn_card])
    run = []
    runs = []

    for value in sorted(counts):
        if not run or value == run[-1] + 1:
            run.append(value)
        else:
            if len(run) >= 3:
                runs.append(run)
            run = [value]
    if len(run) >= 3:
        runs.append(run)

    if not runs:
        return 0

    longest_run = max(runs, key=len)
    return len(longest_run) * prod(counts[value] for value in longest_run)


def score_count(plays):
    """Score a play vector"""

    score = 0
    if len(plays) < 2:
        return score

    count = sum(card.value for card in plays)
    if count == 15 or count == 31:
        score += 2

    same_rank_count = 1
    for card in reversed(plays[:-1]):
        if card.rank != plays[-1].rank:
            break
        same_rank_count += 1
    score += {2: 2, 3: 6, 4: 12}.get(same_rank_count, 0)

    for run_len in range(len(plays), 2, -1):
        vals = [card.run_val for card in plays[-run_len:]]
        if len(set(vals)) == run_len and sorted(vals) == list(range(min(vals), max(vals) + 1)):
            score += run_len
            break

    return score
