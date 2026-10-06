#!/usr/bin/env python3
"""Verify completed offline reviews and produce an auditable, account-scoped import."""
from __future__ import annotations

import argparse
import collections
import copy
import datetime
import json
import math
from pathlib import Path
import sqlite3

from history_review_inputs import RANKS, SUITS, REVIEW_MODELS
from review_player_history import LATEST, digest, encode, iso


def loss(record, result):
    if result.get('forced'):
        return 0.0
    review = result['review']
    selected, recommended = review['selected'], review['recommended']
    a, b = selected.get('winProbability'), recommended.get('winProbability')
    if a is None or b is None:
        # Identical recommended action proves zero regret without inventing WP.
        if sorted(selected['cardIds']) == sorted(recommended['cardIds']):
            return 0.0
        return None
    if not all(math.isfinite(x) and 0 <= x <= 1 for x in (a, b)):
        raise ValueError('invalid win probability: ' + record['id'])
    return b - a


def wins_on_play(record):
    f = record['fields']
    if f['kind'] != 'peg':
        return False
    ranks = [c % 13 for c in f['plays'] + record['selected']]
    count = sum(min(r + 1, 10) for r in ranks)
    points = 2 if count in (15, 31) else 0
    same = 1
    for r in reversed(ranks[:-1]):
        if r != ranks[-1]:
            break
        same += 1
    points += same * (same - 1)
    for size in range(len(ranks), 2, -1):
        tail = ranks[-size:]
        if len(set(tail)) == size and max(tail) - min(tail) == size - 1:
            points += size
            break
    return f['aiScore'] + points >= 121


def hand_boundaries(gid, events, session):
    if session:
        return (session['game']['hand_number'],
                {e['hand_number']: iso(e['at']) for e in session['score_events'] if e['category'] == 'Crib'},
                {e['hand_number'] for e in session.get('help_events', [])})
    native = gid.startswith(('rust-', 'human-game-'))
    hand = 0
    times, assisted = {}, set()
    for event in events:
        if event.get('type') == 'hand' and event.get('action') == 'start':
            hand = event.get('handNumber', hand + 1) if native else hand + 1
        elif native:
            hand = max(hand, event.get('handNumber', 0))
        if event.get('type') == 'score' and event.get('category') == 'crib':
            times[hand] = iso(event['at'])
        if event.get('type') == 'help':
            assisted.add(hand)
    return hand, times, assisted


def ewma(values, half_life):
    value = None
    alpha = 1 - .5 ** (1 / half_life)
    for sample in values:
        value = sample if value is None else value + alpha * (sample - value)
    return value


def summarize(cycles, lengths, game_results):
    cycle_mean = ewma([-c['sample']['total_regret'] for c in cycles], 18 * 4.516)
    personal_length = ewma([g['cyclesPerGame'] for g in lengths], 18)
    length = personal_length if len(lengths) >= 6 else 4.516
    full = [g for g in game_results if g['complete']]
    return {
        'wpPerGame': cycle_mean * length if cycle_mean is not None else None,
        'cycles': len(cycles), 'gamesWithCycles': len({c['gameId'] for c in cycles}),
        'cyclesPerGame': length, 'ewmaCycleHandicap': cycle_mean,
        'lengthGames': len(lengths), 'ewmaCyclesPerGame': personal_length,
        'completeGames': len(full),
        'partialGames': sum(not g['complete'] and g['reviewed'] > 0 for g in game_results),
        'unavailableGames': sum(g['reviewed'] == 0 for g in game_results),
        'meanGameWp': sum(g['wp'] for g in full) / len(full) if full else None,
        'last5MeanWp': sum(g['wp'] for g in full[-5:]) / len(full[-5:]) if full else None,
        'last10MeanWp': sum(g['wp'] for g in full[-10:]) / len(full[-10:]) if full else None,
    }


def event_review(record, result):
    labels = lambda ids: [RANKS[x % 13] + SUITS[x // 13] for x in ids]
    value = loss(record, result)
    if value is None:
        return None
    if result.get('forced'):
        return {'model': LATEST, 'selected': labels(record['selected']),
                'recommended': labels(record['selected']),
                'delta': 0, 'winProbabilityDelta': 0}
    a, b = result['review']['selected'], result['review']['recommended']
    review = {'model': LATEST, 'selected': labels(a['cardIds']), 'recommended': labels(b['cardIds']),
              'selectedEv': a['ev'], 'recommendedEv': b['ev'], 'delta': b['ev'] - a['ev'],
              'winProbabilityDelta': value}
    if a.get('winProbability') is not None and b.get('winProbability') is not None:
        review.update(selectedWinProbability=a['winProbability'], recommendedWinProbability=b['winProbability'])
    return review


def report(database, source_path):
    c = sqlite3.connect(f'file:{database}?mode=ro', uri=True)
    metadata = {k: json.loads(v) for k, v in c.execute('SELECT key,value FROM metadata')}
    if metadata['source']['sha256'] != digest(source_path):
        raise ValueError('source archive changed')
    statuses = dict(c.execute('SELECT status,count(*) FROM reviews GROUP BY status'))
    if set(statuses) != {'complete'}:
        raise ValueError(f'review queue is incomplete: {statuses}')
    source = json.loads(source_path.read_text())
    sessions = {r['session_id']: json.loads(r['session_json']) for r in source['sessions']}
    payloads = {r['game_id']: json.loads(r['payload_json']) for r in source['uploads']}
    cycles = {'historical': [], 'latest': []}
    game_results = {'historical': [], 'latest': []}
    lengths, reviewed_payloads = [], []
    for gid, meta_text, events_text in c.execute('SELECT * FROM games'):
        meta, events = json.loads(meta_text), json.loads(events_text)
        records = {r['id']: r for (text,) in c.execute('SELECT record_json FROM decisions WHERE game_id=?', (gid,)) for r in [json.loads(text)]}
        reviews = {(i, m): json.loads(r) for i, m, r in c.execute('SELECT r.id,r.model,r.result_json FROM reviews r JOIN decisions d ON d.id=r.id WHERE d.game_id=?', (gid,))}
        hands, completed, assisted = hand_boundaries(gid, events, sessions.get(gid))
        # A final heels win can have no recorded decision; include that deal in length.
        hands = max(hands, meta['hands'])
        final_scores = meta['finalScores'] or {}
        if not meta['forfeited'] and max(final_scores.values(), default=0) >= 121 and hands:
            lengths.append({'gameId': gid, 'at': meta['endedAt'], 'cyclesPerGame': hands / 2})
        for track, model in [('historical', meta['opponent']), ('latest', LATEST)]:
            losses = {}
            for i, record in records.items():
                result = reviews.get((i, model))
                if result:
                    if result.get('id') != i or result.get('model') != model or not result.get('ok'):
                        raise ValueError('review identity mismatch: ' + i)
                    losses[i] = loss(record, result)
            available = [v for v in losses.values() if v is not None]
            game_results[track].append({'gameId': gid, 'at': meta['endedAt'], 'opponent': meta['opponent'],
                                       'wp': -sum(max(0, v) for v in available), 'reviewed': len(available),
                                       'decisions': len(records) + len(meta['unavailable']),
                                       'complete': bool(records) and len(available) == len(records) and not meta['unavailable']})
            for first in range(1, hands + 1, 2):
                pair = {first, first + 1}
                if not pair <= completed.keys() or pair & assisted:
                    continue
                choices = [r for r in records.values() if r['hand'] in pair]
                if not choices or any(x['hand'] in pair for x in meta['unavailable']):
                    continue
                if any(losses.get(r['id']) is None for r in choices):
                    continue
                # Fully observed role-balanced cycles require one discard in each hand.
                if any(sum(r['hand'] == hand and r['fields']['kind'] == 'discard' for r in choices) != 1 for hand in pair):
                    continue
                buckets = collections.defaultdict(list)
                for r in choices:
                    value = losses[r['id']]
                    if r['forced'] or wins_on_play(r) or value < -2.220446049250313e-16:
                        continue
                    kind = 'discard' if r['fields']['kind'] == 'discard' else 'pegging'
                    buckets[r['fields']['role'] + '_' + kind].append(max(0, value))
                if len(buckets) != 4:
                    continue
                sample = {k + '_regret': sum(v) / len(v) for k, v in buckets.items()}
                sample['total_regret'] = sum(sum(v) for v in buckets.values())
                cycles[track].append({'gameId': gid, 'firstHand': first, 'at': completed[first + 1], 'model': model, 'sample': sample})
        for event in events:
            event['at'] = iso(event['at'])
            if event.get('type') == 'game':
                event['opponent'] = meta['opponent']
            if event.get('player') == 'human' and (event.get('type') == 'discard' or event.get('type') == 'pegging' and event.get('action') == 'play'):
                event.pop('review', None)
                record = records.get(event['id'])
                result = reviews.get((event['id'], LATEST))
                review = event_review(record, result) if record and result else None
                if review:
                    event['review'] = review
                    event.pop('reviewUnavailable', None)
                else:
                    event['reviewUnavailable'] = True
        payload = copy.deepcopy(payloads[gid])
        payload.update(events=events, model=meta['opponent'])
        reviewed_payloads.append({'gameId': gid, 'payload': payload})
    lengths.sort(key=lambda g: (g['at'], g['gameId']))
    summary = {'through': source['capturedAt'], 'games': len(reviewed_payloads)}
    for track in cycles:
        cycles[track].sort(key=lambda r: (r['at'], r['gameId'], r['firstHand']))
        game_results[track].sort(key=lambda r: (r['at'], r['gameId']))
        summary[track] = summarize(cycles[track], lengths, game_results[track])
    summary['latest']['model'] = LATEST
    historical = summary['historical']
    if historical['wpPerGame'] is None:
        raise ValueError('no historical handicap evidence')
    original_profile = next(r for r in source['profiles'] if r['evaluator_version'] == 'player-history')
    return {'schemaVersion': 1, 'status': 'complete', 'sourceSha256': digest(source_path),
            'worker': metadata['worker'], 'expectedProfile': original_profile, 'summary': summary,
            'profilePatch': {'handicap_cycles': historical['cycles'],
                             'ewma_cycle_handicap': historical['ewmaCycleHandicap'],
                             'length_games': historical['lengthGames'],
                             'ewma_cycles_per_game': historical['ewmaCyclesPerGame']},
            'cycles': cycles, 'gameLengths': lengths, 'games': game_results,
            'reviewedGames': reviewed_payloads}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = report(args.database, args.source)
    args.output.write_text(encode(result) + '\n')
    print(encode(result['summary']))


if __name__ == '__main__':
    main()
