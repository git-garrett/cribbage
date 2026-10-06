import copy
import unittest
from scripts.history_review_inputs import actual_opponent, card_id, legacy_reviews, native_review


def native(kind='Peg'):
    def hand(labels):
        return [{'id': card_id(x)} for x in labels]
    game = dict(hand_number=1, dealer='Right', turn_card={'id':card_id('Ks')}, count=1,
                go_player=None,last_player='Right',plays=hand(['Ah']),
                pegging_history=[{'Play':{'side':'Right','rank':0}}],
                players=[dict(score=10,hand=hand(['2d','3c','4h','5s']),table=[],discarded_to_crib=hand(['9d','10c'])),
                         dict(score=20,hand=hand(['2s','6s','7s']),table=hand(['Ah']),discarded_to_crib=hand(['Qd','Jd']))])
    selected = [card_id('2d')]
    if kind == 'Discard':
        game['players'][0]['hand'] += hand(['9d','10c'])
        selected = [card_id('9d'),card_id('10c')]
    return dict(id='choice',at='2026-01-01T00:00:00Z',kind=kind,game=game,selected_card_ids=selected)


class InputsTest(unittest.TestCase):
    def test_hidden_opponent_cards_do_not_enter_native_observation(self):
        review = native()
        expected = native_review(review)
        changed = copy.deepcopy(review)
        changed['game']['players'][1]['hand'] = [{'id':i} for i in [5,7,8]]
        changed['game']['players'][1]['discarded_to_crib'] = [{'id':9},{'id':10}]
        self.assertEqual(native_review(changed),expected)

    def test_unrevealed_cut_and_other_cards_do_not_enter_discard_observation(self):
        review = native('Discard')
        expected = native_review(review)
        changed = copy.deepcopy(review)
        changed['game']['turn_card'] = {'id':0}
        changed['game']['pegging_history'] = []
        self.assertEqual(native_review(changed),expected)
        self.assertNotIn('turnCard',expected['fields'])

    def test_original_opponent_wins_over_a_later_upload_label(self):
        self.assertEqual(actual_opponent([{'type':'game','action':'start','opponent':'original'}],'new-label'),'original')

    def test_truncated_legacy_logs_are_unavailable_instead_of_guessed(self):
        reviews,missing=legacy_reviews([dict(type='pegging',action='play',id='partial',at='now',
                                           handNumber=9,player='human',role='pone',card='2d',count=2)])
        self.assertEqual(reviews,[])
        self.assertEqual(len(missing),1)

    def test_legacy_reset_recovers_unlogged_second_go(self):
        base = dict(handNumber=1, at='now')
        events = [dict(base, type='hand', action='start', dealer='human', turnCard='8d', scores={'human':0,'ai':0}),
                  dict(base, type='discard', player='human', role='dealer', id='d',
                       cards=['10d','9s'], remainingHand=['6s','5d','7d','6h'])]
        for actor, card in [('ai','10h'),('human','5d'),('ai','8c'),('human','7d')]:
            events.append(dict(base, type='pegging',action='play',player=actor,card=card,id=card))
        events.extend([dict(base,type='pegging',action='go',player='ai'),
                       dict(base,type='pegging',action='reset'),
                       dict(base,type='pegging',action='play',player='ai',card='Jd'),
                       dict(base,type='pegging',action='play',player='human',card='6s',id='p')])
        events[-1]['handNumber'] = 2  # Old client counter drift during pegging.
        results, missing = legacy_reviews(events)
        self.assertEqual(missing, [])
        self.assertEqual(results[-1]['hand'], 1)
        self.assertEqual(results[-1]['fields']['pegHistory'], ['o9','s4','o7','s6','og','sg','r','o10'])
        self.assertEqual(results[-1]['fields']['humanHandCount'], 1)

    def test_compact_replay_rejects_a_go_when_player_can_play(self):
        from scripts.history_review_inputs import compact_review
        event = dict(id='p',at='now',handNumber=1,role='pone',
                     completedPlayGroups=[],playedCards=['10h'],hand=['2d','3d','4d','5d'],
                     scoresBefore={'human':0,'ai':0},cutCard='Ks',countBefore=10,card='2d')
        with self.assertRaisesRegex(ValueError, 'illegal player Go'):
            compact_review(event,{'remainingHand':event['hand'],'cards':['9d','10c']})


if __name__ == '__main__':
    unittest.main()
