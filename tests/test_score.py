import pytest

from cribbage.card import Deck, cards_from_str
from cribbage.score import (
    score_hand,
    score_count,
    score_runs,
    score_fifteens,
    score_sets,
    score_flush_and_right_jack,
)


def test_score_fifteens():
    cases = [(4, "Ad 2d 5d 5h 10d"), (0, "Ad As Ac Ah 5s")]
    for expected, hand_str in cases:
        *hand, turn_card = cards_from_str(hand_str)
        score = score_fifteens(hand, turn_card)
        assert expected == score


def test_score_sets():
    cases = [(2, "Ad 2d 3d 4d 4h"), (6, "Ad 2d 4d 4h 4s")]
    for expected, hand_str in cases:
        *hand, turn_card = cards_from_str(hand_str)
        score = score_sets(hand, turn_card)
        assert expected == score


def test_score_runs():
    deck = Deck(shuffled=False)
    hand = list(deck.draw(4))
    turn_card = list(deck.draw(1))[0]
    # that's Ad 2d 3d 4d | 5d
    # should be a 5-card run worth 5 points
    assert 5 == score_runs(hand, turn_card)


def test_score_double_run_of_four():
    *hand, turn_card = cards_from_str("Ad 2c 3h 4s 3d")
    assert 8 == score_runs(hand, turn_card)
    assert 10 == score_hand(hand, turn_card)


def test_score_double_double_run():
    *hand, turn_card = cards_from_str("Ad 2c 3h 3s 2d")
    assert 12 == score_runs(hand, turn_card)
    assert 16 == score_hand(hand, turn_card)


def test_score_of_a_hand():
    deck = Deck(shuffled=False)
    hand = list(deck.draw(4))
    turn_card = list(deck.draw(1))[0]

    for c in hand + [turn_card]:
        print(c)

    # K♠
    # Q♠
    # J♠
    # 10♠

    # 9♠ (turn)

    # run of 5 for 5
    # plus the flush for 5
    # plus the right jack for 1
    # for a total of 11 points
    assert 11 == score_hand(hand, turn_card)


def test_right_jack():
    *hand, turn_card = cards_from_str("As Ac Ah Jd Ad")
    assert 1 == score_flush_and_right_jack(hand, turn_card) 


def test_non_crib_four_card_flush():
    *hand, turn_card = cards_from_str("Ah 7h 8h 10h Ks")
    assert 4 == score_flush_and_right_jack(hand, turn_card)
    assert 6 == score_hand(hand, turn_card)


def test_crib_needs_five_card_flush():
    *hand, turn_card = cards_from_str("Ah 7h 8h 10h Ks")
    assert 0 == score_flush_and_right_jack(hand, turn_card, crib=True)
    assert 2 == score_hand(hand, turn_card, crib=True)


def test_perfect_hand():
    *hand, turn_card = cards_from_str("Jh 5d 5c 5s 5h")
    assert 29 == score_hand(hand, turn_card)


def test_score_count_run():
    plays = cards_from_str("3d 4h 5s")
    assert 3 == score_count(plays)


def test_score_count_run_out_of_order():
    plays = cards_from_str("4h 3d 5s")
    assert 3 == score_count(plays)


def test_score_count_triple():
    plays = cards_from_str("8d 8h 8s")
    assert 6 == score_count(plays)


def test_score_count_31():
    plays = cards_from_str("10d 9h 7s 5c")
    assert 2 == score_count(plays)
