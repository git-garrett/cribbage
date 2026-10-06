"""Recover legal player observations from saved sessions or completed-game logs.

This is offline review evidence, never a policy cache. Missing observations fail
explicitly; another evaluator or an opponent's private cards are not substitutes.
"""
from __future__ import annotations

import re

RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
SUITS = 'dchs'
ALIASES = {'♦': 'd', '♣': 'c', '♥': 'h', '♠': 's'}
REVIEW_MODELS = {f'schell_table-peg_table-{v}' for v in ('13.0', '13.215', '13.23', '28.3', '28.3.fast')}


def card_id(card):
    if isinstance(card, dict):
        card = card['id']
    if isinstance(card, int) and not isinstance(card, bool) and 0 <= card < 52:
        return card
    if isinstance(card, str):
        match = re.fullmatch(r'(A|[2-9]|10|J|Q|K)([cdhsCDHS♣♦♥♠])', card)
        if match:
            rank, suit = match.groups()
            return SUITS.index(ALIASES.get(suit, suit.lower())) * 13 + RANKS.index(rank)
    raise ValueError('invalid saved card')


def cards(values):
    result = [card_id(x) for x in values]
    if len(set(result)) != len(result):
        raise ValueError('duplicate physical card')
    return result


def actual_opponent(events, fallback=None):
    for action in ('start', 'end'):
        for event in events:
            if event.get('type') == 'game' and event.get('action') == action and event.get('opponent'):
                return event['opponent']
    return fallback


def input_text(fields, model):
    fields = dict(fields, model=model)
    return ';'.join(f'{key}={",".join(map(str, value)) if isinstance(value, list) else value}'
                    for key, value in fields.items())


def validate(fields, selected):
    hand = fields['aiHand']
    if fields['role'] not in ('dealer', 'pone'):
        raise ValueError('missing player role')
    if not set(selected) <= set(hand) or len(set(selected)) != len(selected):
        raise ValueError('saved selection is not in the player hand')
    if fields['kind'] == 'discard':
        if len(hand) != 6 or len(selected) != 2:
            raise ValueError('discard requires the original six cards and selected pair')
        return False
    if len(selected) != 1 or not 1 <= len(hand) <= 4:
        raise ValueError('invalid pegging hand or selection')
    count = fields['count']
    if sum(min(x % 13 + 1, 10) for x in fields['plays']) != count:
        raise ValueError('incomplete current pegging series')
    legal = [x for x in hand if count + min(x % 13 + 1, 10) <= 31]
    if selected[0] not in legal:
        raise ValueError('saved pegging choice is illegal')
    if len(fields['ownDiscards']) != 2:
        raise ValueError('private discard context is missing')
    if not 0 <= fields['humanHandCount'] <= 4:
        raise ValueError('invalid opponent card count')
    known = hand + fields['ownDiscards'] + fields['aiTable'] + fields['humanTable'] + [fields['turnCard']]
    if len(known) != len(set(known)):
        raise ValueError('saved legal observation duplicates a physical card')
    return len(legal) <= 1


def native_review(review, side='Left'):
    game = review['game']
    index = 0 if side == 'Left' else 1
    own, other = game['players'][index], game['players'][1-index]
    discard = review['kind'] == 'Discard'
    mapped = lambda value: '-' if value is None else ('ai' if value == side else 'human')
    history = []
    if not discard:
        for event in game.get('pegging_history', []):
            if event == 'Reset':
                history.append('r')
            elif 'Play' in event:
                play = event['Play']
                history.append(('s' if play['side'] == side else 'o') + str(play['rank']))
            elif 'Go' in event:
                history.append('sg' if event['Go']['side'] == side else 'og')
            else:
                raise ValueError('unrecognized public pegging event')
    fields = dict(kind='discard' if discard else 'peg', player='ai',
                  role='dealer' if game['dealer'] == side else 'pone',
                  aiScore=own['score'], humanScore=other['score'], aiHand=cards(own['hand']))
    if not discard:
        fields.update(aiTable=cards(own['table']), humanTable=cards(other['table']),
                      humanHandCount=len(other['hand']), ownDiscards=cards(own['discarded_to_crib']),
                      turnCard=card_id(game['turn_card']), count=game['count'], turn='ai',
                      go=mapped(game['go_player']), last=mapped(game['last_player']),
                      plays=cards(game['plays']), pegHistory=history)
    selected = cards(review['selected_card_ids'])
    forced = validate(fields, selected)
    return dict(id=review['id'], at=review['at'], hand=game['hand_number'], fields=fields,
                selected=selected, forced=forced,
                analyses=[x for x in [review.get('completed'), *review.get('prior_analyses', [])] if x])


def compact_review(event, discard):
    """Recover omitted Go events from native turn rules and public card groups.

    Card ownership follows from the player's known original keep. No opponent
    hidden card or future card is read. Check the recovered hand against the
    independent saved hand before accepting the observation.
    """
    own = cards(discard['remainingHand'])
    keep = set(own)
    own_table, other_table, history = [], [], []
    turn = 'ai' if event['role'] == 'pone' else 'human'
    go = last = None
    count = 0
    flip = lambda p: 'human' if p == 'ai' else 'ai'

    def say_go():
        nonlocal turn, go
        if turn == 'ai' and any(count + min(card % 13 + 1, 10) <= 31 for card in own):
            raise ValueError('public history would require an illegal player Go')
        history.append('sg' if turn == 'ai' else 'og')
        if go is not None:
            return True
        go = turn
        turn = flip(turn)
        return False

    groups = [cards(x) for x in event['completedPlayGroups']] + [cards(event['playedCards'])]
    for index, group in enumerate(groups):
        for card in group:
            actor = 'ai' if card in keep else 'human'
            if turn != actor:
                if say_go():
                    raise ValueError('missing count reset in public card groups')
            if turn != actor or count + min(card % 13 + 1, 10) > 31:
                raise ValueError('invalid public card order')
            history.append(('s' if actor == 'ai' else 'o') + str(card % 13))
            if actor == 'ai':
                own.remove(card)
                own_table.append(card)
            else:
                other_table.append(card)
            count += min(card % 13 + 1, 10)
            last = actor
            if count != 31 and go is None:
                turn = flip(turn)
        if index < len(groups) - 1:
            if count < 31:
                if not say_go():
                    assert say_go()
            history.append('r')
            count, go, last = 0, None, None
            turn = flip(turn)
    if turn != 'ai' and say_go():
        raise ValueError('root decision should follow a count reset')
    if set(own) != set(cards(event['hand'])):
        raise ValueError('public history disagrees with remaining player cards')
    scores = event['scoresBefore']
    fields = dict(kind='peg', player='ai', role=event['role'], aiScore=scores['human'],
                  humanScore=scores['ai'], aiHand=cards(event['hand']), aiTable=own_table,
                  humanTable=other_table, humanHandCount=4-len(other_table),
                  ownDiscards=cards(discard['cards']), turnCard=card_id(event['cutCard']),
                  count=count, turn='ai', go=go or '-', last=last or '-',
                  plays=cards(event['playedCards']), pegHistory=history)
    if count != event['countBefore']:
        raise ValueError('public groups disagree with saved count')
    selected = [card_id(event['card'])]
    forced = validate(fields, selected)
    return dict(id=event['id'], at=event['at'], hand=event['handNumber'], fields=fields,
                selected=selected, forced=forced, eventReview=event.get('review'))


def legacy_reviews(events):
    """Replay only public play/go/reset events and the player's own discards."""
    results, unavailable = [], []
    hand_number = None
    for event in events:
        kind = event.get('type')
        starts_hand = kind == 'hand' and event.get('action') == 'start'
        # Some early clients incremented handNumber in the middle of pegging.
        # A recorded deal, not that counter, is the boundary between hands.
        if starts_hand or (hand_number is None and event.get('handNumber') is not None):
            hand_number = (hand_number + 1 if hand_number is not None
                           else event.get('handNumber', 1))
            own_hand, own_discards, own_table, other_table, series, history = [], [], [], [], [], []
            original_keep, completed_groups = [], []
            go = last = None
            score = cut = role = None
        number = hand_number
        if kind == 'hand' and event.get('action') == 'start':
            score = event.get('scores')
            cut = event.get('turnCard')
            role = 'dealer' if event.get('dealer') == 'human' else 'pone'
        if kind == 'discard' and event.get('player') == 'human':
            try:
                selected = cards(event['cards'])
                original = cards(event.get('handBeforeDiscard') or event['remainingHand'] + event['cards'])
                scores = event.get('scores') or score
                fields = dict(kind='discard', player='ai', role=event.get('role') or role,
                              aiScore=scores['human'], humanScore=scores['ai'], aiHand=original)
                validate(fields, selected)
                results.append(dict(id=event['id'], at=event['at'], hand=number, fields=fields,
                                    selected=selected, forced=False, eventReview=event.get('review')))
                own_hand = cards(event['remainingHand'])
                original_keep = list(own_hand)
                own_discards = selected
            except (KeyError, TypeError, ValueError) as error:
                unavailable.append(dict(id=event['id'], hand=number, reason=str(error)))
        if kind == 'pegging':
            action, actor = event.get('action'), event.get('player')
            if action == 'play':
                played = card_id(event['card'])
                if actor == 'human':
                    try:
                        scores = event.get('scoresBefore') or score
                        fields = dict(kind='peg', player='ai', role=event.get('role') or role,
                                      aiScore=scores['human'], humanScore=scores['ai'],
                                      aiHand=cards(event.get('hand') or own_hand),
                                      aiTable=list(own_table), humanTable=list(other_table),
                                      humanHandCount=4-len(other_table), ownDiscards=list(own_discards),
                                      turnCard=card_id(event.get('cutCard') or cut),
                                      count=event.get('countBefore', sum(min(x % 13 + 1, 10) for x in series)),
                                      turn='ai', go=go or '-', last=last or '-', plays=list(series),
                                      pegHistory=list(history))
                        if 'playedCards' in event and cards(event['playedCards']) != series:
                            raise ValueError('public event history disagrees with saved series')
                        normalized = dict(event, hand=fields['aiHand'], role=fields['role'],
                                          scoresBefore={'human':fields['aiScore'],'ai':fields['humanScore']},
                                          cutCard=fields['turnCard'], countBefore=fields['count'],
                                          playedCards=fields['plays'], completedPlayGroups=completed_groups,
                                          handNumber=number)
                        results.append(compact_review(normalized, {'remainingHand':original_keep,'cards':own_discards}))
                    except (KeyError, TypeError, ValueError) as error:
                        unavailable.append(dict(id=event['id'], hand=number, reason=str(error)))
                    own_table.append(played)
                    if played in own_hand:
                        own_hand.remove(played)
                elif actor == 'ai':
                    other_table.append(played)
                else:
                    raise ValueError('unrecognized player in public pegging history')
                series.append(played)
                history.append(('s' if actor == 'human' else 'o') + str(played % 13))
                last = 'ai' if actor == 'human' else 'human'
            elif action == 'go':
                go = 'ai' if actor == 'human' else 'human'
                history.append('sg' if actor == 'human' else 'og')
            elif action == 'reset':
                completed_groups.append(list(series))
                series = []
                go = last = None
                history.append('r')
        if isinstance(event.get('scores'), dict):
            score = event['scores']
        elif kind == 'score' and score is not None and event.get('player') in ('human', 'ai'):
            score = dict(score)
            score[event['player']] = event['totalScore']
    return results, unavailable
