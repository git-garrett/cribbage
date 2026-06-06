from cribbage.card import cards_from_str
from webapp import WebCribbageGame


def test_webapp_scores_double_run_show_stage():
    game = WebCribbageGame(opponent="random")
    *hand, turn_card = cards_from_str("Ad 2c 3h 4s 3d")
    game.pone = game.human
    game.dealer = game.ai
    game.human.table = hand
    game.turn_card = turn_card

    game.show_score_stage("pone")

    assert game.scoring_review["points"] == 10
    assert game.human.score == 10


def test_webapp_scores_crib_flush_with_crib_rules():
    game = WebCribbageGame(opponent="random")
    *crib, turn_card = cards_from_str("Ah 7h 8h 10h Ks")
    game.dealer = game.human
    game.human.crib = crib
    game.turn_card = turn_card

    game.show_score_stage("crib")

    assert game.scoring_review["points"] == 2
    assert game.human.score == 2
