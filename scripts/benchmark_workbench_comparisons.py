"""Read-only benchmark reports from completed Model 29 comparison evidence."""
from collections import defaultdict
from contextlib import closing
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import sqlite3

from benchmark_workbench_stats import PairedRatio, normal_interval, paired_history
from report_paired_benchmark import build_report


PHASES = ('Peg pone', 'Peg dealer', 'Hand pone', 'Hand dealer', 'Crib')
ASSETS = Path('rust/cribbage-shadow-engine/assets')
MISSING = 'Not recorded by this run. Saved game outcomes cannot recover decision predictions or computation times.'


def hand_scores(hand, endpoint=None):
    """Recover the native realized/available-event conventions, including heels."""
    scores = list(hand['start']); dealer = hand['dealer']; pone = 1-dealer
    realized = [defaultdict(int), defaultdict(int)]
    available = [defaultdict(int), defaultdict(int)]
    peg = lambda side: 'Peg dealer' if side == dealer else 'Peg pone'
    if hand['cut'] % 13 == 10:
        points = min(2, 121-scores[dealer]); scores[dealer] += points
        realized[dealer][peg(dealer)] += points
        available[dealer][peg(dealer)] += 2
    played = 0
    for play in hand['plays']:
        after = play['scores']; delta = [after[s]-scores[s] for s in (0,1)]
        if min(delta) < 0 or sum(v > 0 for v in delta) > 1 or max(scores) >= 121:
            raise ValueError('Invalid scoring event in comparison evidence')
        if play['action'] == 0:
            played += 1
            side = play['actor']; raw = play['points']
            last = sum(delta) > raw or (played == 8 and max(after) < 121 and play['after'] > 0)
            available[side][peg(side)] += raw + int(last)
        elif play['action'] == 1:
            for side in (0,1):
                if delta[side]: available[side][peg(side)] += 1
        elif any(delta):
            raise ValueError('Unexpected scoring reset in comparison evidence')
        for side in (0,1): realized[side][peg(side)] += delta[side]
        scores = list(after)
    for side, phase, raw in ((pone, 'Hand pone', hand['handPoints'][pone]),
                             (dealer, 'Hand dealer', hand['handPoints'][dealer]),
                             (dealer, 'Crib', hand['cribPoints'])):
        if max(scores) >= 121:
            if raw: raise ValueError('Unplayed counting event was recorded')
            continue
        points = min(raw,121-scores[side]); scores[side] += points
        realized[side][phase] += points; available[side][phase] += raw
    if scores != (hand['end'] if endpoint is None else endpoint):
        raise ValueError('Reconstructed phase scores differ from saved hand endpoint')
    return realized, available


def samples(game):
    result = [{kind:defaultdict(list) for kind in ('realized','available')} for _ in (0,1)]
    previous = game['start']
    for index,hand in enumerate(game['hands']):
        if hand['start'] != previous: raise ValueError('Discontinuous hand scores')
        next_start = game['hands'][index+1]['start'] if index+1 < len(game['hands']) else game['scores']
        # The frozen runner advances to the next hand before filling some
        # nonterminal end fields. The next recorded start is its exact endpoint.
        endpoint = next_start if hand['end'] == [None,None] else hand['end']
        if endpoint != next_start: raise ValueError('Hand end differs from the next recorded score')
        if any(len(keep) != 4 for keep in hand['keeps']):
            if endpoint != game['scores']: raise ValueError('Unexpected unplayed hand')
            continue
        real, available = hand_scores(hand,endpoint)
        for side in (0,1):
            phases = ('Peg dealer','Hand dealer','Crib') if side == hand['dealer'] else ('Peg pone','Hand pone')
            for phase in phases:
                result[side]['realized'][phase].append(real[side][phase])
                result[side]['available'][phase].append(available[side][phase])
        previous = endpoint
    if previous != game['scores']: raise ValueError('Game endpoint differs from its hand records')
    for side in (0,1):
        result[side]['realized']['Final score'].append(game['scores'][side])
        result[side]['realized']['Margin'].append(game['scores'][side]-game['scores'][1-side])
    return result


def scoring_rows(games, paired=True):
    accumulators = {kind:{phase:PairedRatio() for phase in phases} for kind,phases in (
        ('realized',('Final score','Margin',*PHASES)),('available',PHASES))}
    # Each cluster is one reciprocal seed pair, retaining covariance across sides.
    groups = zip(games[0],games[1]) if paired else ((game,) for game in games)
    count = 0
    for group in groups:
        count += 1
        for kind, rows in accumulators.items():
            for phase, acc in rows.items():
                values = [[],[]]
                for game in group:
                    c = game['candidateSide']
                    for model,side in ((0,c),(1,1-c)):
                        values[model].extend(game['_samples'][side][kind][phase])
                acc.add(*[(sum(v),len(v)) for v in values])
    return {kind:[dict(label=phase,**acc.snapshot(count)) for phase,acc in rows.items()
                  if acc.snapshot(count) is not None] for kind,rows in accumulators.items()}


def comparison_report(root, checkpoint):
    root = Path(root)
    if type(checkpoint) is not int or checkpoint <= 0:
        raise ValueError('Invalid comparison checkpoint')
    receipt = (root/'assessments'/f'{checkpoint:09d}.json').read_text()
    return _completed_report(str(root.resolve()), checkpoint, receipt)


@lru_cache(maxsize=8)
def _completed_report(root_text, checkpoint, receipt_text):
    root = Path(root_text); receipt = json.loads(receipt_text)
    if receipt['status'] != 'complete' or receipt['trainingGames'] != checkpoint:
        raise ValueError('Comparison is not complete')
    pairs = receipt['assessment']['pairs']
    if not 0 < pairs <= 50000 or receipt['games'] != 2*pairs:
        raise ValueError('Invalid comparison size')
    prefix = f'eval:checkpoint:{checkpoint}:'
    games = [{},{}]; digest = hashlib.sha256()
    # One bounded WAL read transaction; never open a writer or replay games.
    with closing(sqlite3.connect((root/'evidence.db').as_uri()+'?mode=ro',uri=True,timeout=.15)) as db:
        db.execute('pragma query_only=ON'); db.execute('begin')
        rows = db.execute('select id,request,root,result from results where id>=? and id<? order by id limit ?',
                          (prefix,prefix+'\uffff',2*pairs+1))
        for identity, raw_request, saved_root, raw in rows:
            index, side = map(int,identity[len(prefix):].split(':'))
            request = json.loads(raw_request); game = json.loads(raw)
            if not 0 <= index < pairs or side not in (0,1) or index in games[side]:
                raise ValueError('Invalid or duplicate comparison identity')
            if saved_root != receipt['root'] or request.get('candidateSide') != side or game.get('candidateSide') != side:
                raise ValueError('Comparison snapshot or orientation mismatch')
            if (request.get('kind') != 'game' or request.get('scores') != [0,0] or game.get('start') != [0,0]
                    or game.get('trajectory') is not False or game.get('model') != '29.0'
                    or game['seed'] != request['seed'] or game['firstDealer'] != request['firstDealer']):
                raise ValueError('Comparison game differs from its frozen request')
            scores = game['scores']; winner = game['winner']
            if winner not in (0,1) or scores[winner] != 121 or not 0 <= scores[1-winner] < 121:
                raise ValueError('Invalid first-winner outcome')
            if not math.isfinite(game['seconds']) or game['seconds'] < 0: raise ValueError('Invalid game duration')
            digest.update(json.dumps([identity,raw_request,saved_root,raw],separators=(',',':')).encode())
            game['_samples'] = samples(game); games[side][index] = game
    if any(set(rows) != set(range(pairs)) for rows in games): raise ValueError('Missing comparison game indexes')
    games = [[rows[i] for i in range(pairs)] for rows in games]
    if len({g['seed'] for g in games[0]}) != pairs: raise ValueError('Repeated comparison seed')
    for a,b in zip(*games):
        if a['seed'] != b['seed'] or a['firstDealer'] != b['firstDealer']:
            raise ValueError('Reciprocal seed or first-dealer mismatch')
    candidate, opponent = '29.0 current state','29.0 original state'
    def compact(g,index):
        side = g['candidateSide']
        return dict(game_index=index,random_seed=g['seed'],winner=g['winner'],
            left_engine=candidate if side == 0 else opponent,right_engine=opponent if side == 0 else candidate,
            final_left_score=g['scores'][0],final_right_score=g['scores'][1])
    compact_games = [[compact(g,i) for i,g in enumerate(rows)] for rows in games]
    result = build_report(*compact_games,candidate,opponent,pairs)
    result.pop('completedAt',None)  # The saved assessment, not reporting time, identifies the run.
    history = paired_history(list(zip(*compact_games)))
    result['pairedSeeds'].update(winRate95=history[-1]['fixed95'],score95=history[-1]['score95'])
    scores = scoring_rows(games)
    for key,rows in zip(('candidateLeft','opponentLeft'),games):
        result['orientations'][key]['scoring'] = scoring_rows(rows,paired=False)
        result['orientations'][key]['games'] = len(rows)
    all_games = games[0]+games[1]
    margins = [g['scores'][g['candidateSide']]-g['scores'][1-g['candidateSide']] for g in all_games]
    result['candidateMarginNormal95'] = normal_interval(sum(margins),sum(v*v for v in margins),len(margins))
    manifest = json.loads((Path(receipt['root'])/ASSETS/'model29-generation.json').read_text())
    original = Path(receipt['baseline'])/ASSETS/'model29-generation.json'
    snapshot = Path(receipt['root'])/ASSETS/'model29-generation.json'
    result.update(trainingGames=checkpoint,assessment=receipt['assessment'],phaseScoring=scores['realized'],
        availableEventScoring=scores['available'],history=history,
        evCalibration=dict(status='not recorded',note=MISSING,rows=[]),
        winProbabilityCalibration=dict(status='not recorded',note=MISSING,rows=[]),
        timing=dict(status='not recorded',note=MISSING,rows=[]),
        performance=dict(wallSeconds=receipt['seconds'],workerGameSeconds=sum(g['seconds'] for g in all_games),
            gamesPerHour=len(all_games)*3600/receipt['seconds'] if receipt['seconds'] > 0 else None,
            meanGameSeconds=sum(g['seconds'] for g in all_games)/len(all_games)),
        integrity=dict(status='passed',completePairs=pairs,seedMismatches=0,snapshotMismatches=0,
            firstWinnerGames=len(all_games),generation=manifest['generation'],
            candidateSnapshot=hashlib.sha256(snapshot.read_bytes()).hexdigest(),
            originalSnapshot=hashlib.sha256(original.read_bytes()).hexdigest(),
            sourceRevision=manifest['policy']['sourceRevision'],evidenceSha256=digest.hexdigest(),
            firstSeed=games[0][0]['seed'],lastSeed=games[0][-1]['seed']),
        notes=['Realized scoring is capped at 121; available-event scoring includes the complete winning event, excluding later unplayed events.',
               'Pegging includes heels and go/last-card awards, matching the standard benchmark report.',
               'Phase differences use reciprocal-seed clustered 95% intervals. Per-orientation tables use game clusters.',
               'Raw Wilson and paired normal intervals describe this checkpoint only; the assessment interval adjusts across checkpoints.',
               'Full-game durations include both players and scheduling. They are not per-model decision timings.',receipt['policy']])
    return result
