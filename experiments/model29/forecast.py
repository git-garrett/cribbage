"""Forecast evidence from real hands and optional rejected-discard continuations.

A source game/hand/actor identifies one world, not fourteen independent games.
No hidden cards are inputs to the forecast key or to either player's policy.
"""
import itertools
import base64
import json
import zlib

def packed_scoring(value):
    """Compress immutable prior bins in evidence, not in the decision hot path."""
    if value.get("model")!="29.2" and "scoringInputs" not in value:return value
    value=dict(value)
    inputs=value.pop("scoringInputs",{})
    if "outcomes" in value:
        value["outcomes"]=[dict(r) for r in value["outcomes"]]
        for row in value["outcomes"]:
            data=row.pop("scoring",None)
            if data is not None:inputs[row["key"]]=data
    if inputs:value["scoringPacked"]=base64.b64encode(zlib.compress(json.dumps(inputs,separators=(",",":")).encode(),1)).decode()
    return value

def scoring_inputs(value):
    if "scoringPacked" in value:return json.loads(zlib.decompress(base64.b64decode(value["scoringPacked"])))
    return value.get("scoringInputs",{})



def training_mode(config):
    value = config.get('trainingMode', True)
    if type(value) is not bool:
        raise ValueError('trainingMode must be a boolean')
    return value


def key(six, discard, scores, dealer):
    # Match model29_forecast::key, including Rust's debug-array spacing.
    variants = []
    for suits in itertools.permutations(range(4)):
        remap = lambda cards: sorted(13*suits[c//13]+c%13 for c in cards)
        variants.append((remap(six), remap(discard)))
    own, thrown = min(variants)
    return f'{int(dealer)}:{scores[0]}:{scores[1]}:{own}:{thrown}'


def terminal_hand_scores(hand):
    """Reconstruct counting in order; compact hand.end can be [null, null]."""
    scores = list(hand['start'])
    dealer = hand['dealer']
    scores[dealer] += 2*int(hand['cut']%13 == 10)
    if max(scores) < 121:
        for play in hand['plays']:
            following = play['scores']
            if any(following[i] < scores[i] for i in range(2)):
                raise ValueError('decreasing hand score')
            scores = list(following)
            if max(scores) >= 121:
                break
        if max(scores) < 121:
            if sum(p['action'] == 0 for p in hand['plays']) != 8:
                raise ValueError('incomplete ordinary training hand')
            for actor, points in ((1-dealer, hand['handPoints'][1-dealer]),
                                  (dealer, hand['handPoints'][dealer]),
                                  (dealer, hand['cribPoints'])):
                if type(points) is not int or points < 0:
                    raise ValueError('missing or invalid hand counting score')
                scores[actor] += points
                if max(scores) >= 121:
                    break
    if min(scores) < 0 or min(scores) >= 121:
        raise ValueError('invalid first-winner hand outcome')
    return [min(121, s) for s in scores]


def ordinary_cohorts(identity, game):
    if not identity.startswith('train:') or game.get('candidateSide') is not None or game.get('model') not in ('29.0','29.1','29.2') or game.get('trajectory') is not False:
        raise ValueError('forecast requires attributable ordinary training games')
    numbers = set()
    scoring=scoring_inputs(game)
    for hand in game['hands']:
        if max(hand['start']) >= 121 or any(len(k) != 4 for k in hand['keeps']):
            break
        number = hand['number']
        if number in numbers:
            raise ValueError('duplicate hand number')
        numbers.add(number)
        cards = hand['dealt'][0]+hand['dealt'][1]+[hand['cut']]
        if len(cards) != 13 or len(set(cards)) != 13 or any(type(c) is not int or not 0 <= c < 52 for c in cards):
            raise ValueError('invalid physical hand')
        end = terminal_hand_scores(hand)
        after_cut=list(hand['start']);after_cut[hand['dealer']]=min(121,after_cut[hand['dealer']]+2*int(hand['cut']%13==10))
        peg_end=list(hand['plays'][-1]['scores']) if hand['plays'] else after_cut
        complete=max(peg_end)<121 and sum(p['action']==0 for p in hand['plays'])==8
        for actor in (0, 1):
            own = hand['dealt'][actor]
            keep = hand['keeps'][actor]
            discard = sorted(set(own)-set(keep))
            opponent = hand['keeps'][1-actor]+sorted(set(hand['dealt'][1-actor])-set(hand['keeps'][1-actor]))
            if len(set(keep)) != 4 or not set(keep) <= set(own) or len(discard) != 2 or len(opponent) != 6:
                raise ValueError('invalid ordinary discard')
            scores = [hand['start'][actor], hand['start'][1-actor]]
            dealer = int(hand['dealer'] != actor)
            forecast_inputs={}
            option_keys={key(own,p,scores,dealer==0) for p in itertools.combinations(own,2)}
            for pair in itertools.combinations(own,2):
                identity_key=key(own,pair,scores,dealer == 0)
                if identity_key in game.get('forecastInputs',{}):
                    forecast_inputs[identity_key]=game['forecastInputs'][identity_key]
            yield dict(scoringInputs={k:scoring[k] for k in option_keys if k in scoring},model=game['model'], sourceRoot=game.get('sourceRoot'),forecastInputs=forecast_inputs, evidenceKind='ordinary', sourceGame=identity,
                       hand=number, actor=actor, seed=game['seed'], own=own,
                       opponent=opponent, cut=hand['cut'], start=scores, dealer=dealer,
                       selectedDiscard=discard, outcomes=[dict(discard=discard,
                           key=key(own, discard, scores, dealer == 0),
                           scores=[end[actor], end[1-actor]],
                           postCutStart=[after_cut[actor],after_cut[1-actor]],pegEnd=[peg_end[actor],peg_end[1-actor]],pegComplete=complete,
                           scoring=scoring.get(key(own,discard,scores,dealer==0)),
                           forecast=forecast_inputs.get(key(own,discard,scores,dealer == 0)))])
        if max(end) >= 121:
            break


def rejected_requests(records, config):
    if not training_mode(config):
        return []
    requests = []
    for identity, game in records:
        for cohort in ordinary_cohorts(identity, game):
            request = {k: cohort[k] for k in ('sourceGame', 'hand', 'actor', 'seed', 'own',
                        'opponent', 'cut', 'dealer', 'selectedDiscard')}
            request.update(kind='rejected-discards', scores=cohort['start'],forecastInputs=cohort['forecastInputs'],scoringInputs=cohort['scoringInputs'])
            request_id = f"forecast:{identity.removeprefix('train:')}:{cohort['hand']}:{cohort['actor']}"
            requests.append((request_id, request))
    return requests
