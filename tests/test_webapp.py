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


def test_webapp_awards_last_card_after_final_play():
    game = WebCribbageGame(opponent="random")
    game.phase = "pegging"
    game.pone = game.human
    game.dealer = game.ai
    game.turn = 1
    game.human.score = 0
    game.ai.score = 0
    game.human.hand = []
    game.ai.hand = cards_from_str("Ks")
    game.human.table = cards_from_str("Ad 6c 8h Qs")
    game.ai.table = cards_from_str("Kh")
    game.turn_card = cards_from_str("2d")[0]
    game.plays = cards_from_str("Kh")
    game.count = 10
    game.last_player = game.ai

    game.advance_until_human()

    assert game.ai.score == 3
    assert "DCarlin pegged 1 for last card." in game.log
    assert game.phase == "score_pone"


def test_webapp_first_dealer_stays_stable_when_dealer_alternates():
    game = WebCribbageGame(opponent="random")
    game.deal = 0
    game.first_deal = 0
    game.start_hand()
    assert game.state()["dealer"] == "You"
    assert game.state()["firstDealer"] == "You"

    game.deal = game.deal ^ 1
    game.start_hand()

    assert game.state()["dealer"] == "DCarlin"
    assert game.state()["firstDealer"] == "You"


def test_webapp_discards_selected_card_ids_not_display_positions():
    game = WebCribbageGame(opponent="random")
    game.phase = "discard"
    game.dealer = game.human
    game.crib = []
    game.human.hand = cards_from_str("Ks 2d 9h Ac 5s 3c")

    game.discard(ids=[card.index for card in cards_from_str("2d Ac")])

    assert {card.ascii_str for card in game.crib} == {"2d", "Ac"}
    assert {card.ascii_str for card in game.human.hand} == {"Ks", "9h", "5s", "3c"}


def test_webapp_plays_selected_card_id_not_display_position():
    game = WebCribbageGame(opponent="random")
    game.phase = "pegging"
    game.turn = 0
    game.pone = game.human
    game.dealer = game.ai
    game.human.hand = cards_from_str("Ks 2d 9h Ac")
    game.ai.hand = []
    game.count = 0

    game.play(card_id=cards_from_str("9h")[0].index)

    assert [card.ascii_str for card in game.human.table] == ["9h"]
    assert {card.ascii_str for card in game.human.hand} == {"Ks", "2d", "Ac"}
