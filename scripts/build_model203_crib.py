#!/usr/bin/env python3
"""Refresh attributable discard-rank evidence and pack indexed Model 20.3 crib scores."""
import argparse
from collections import Counter
from datetime import datetime
from functools import lru_cache
import gzip
import itertools
import json
import math
from pathlib import Path
import sqlite3
import struct

from build_model203_hold import STRONG_VERSIONS, canonical, digest, file_digest, keys, rank_key
from learning_model_policy import model_version

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'rust/cribbage-shadow-engine/assets'
LEGACY = ASSETS / 'crib-score-histogram-by-discard-cut.json'
LEGACY_SHA = '2aaff0c74543750618555d40daedd2d0f1eecdc2f728c6e9da14d7a77c06dbc0'
EVIDENCE = ROOT / 'training/model203-crib-evidence.json.gz'
OUTPUT = ASSETS / 'model203-crib.bin'
CALIBRATION = ROOT / 'training/model203-crib-calibration.json'
ROLES = ('dealer', 'pone')  # Role of the player DISCARDING the empirical pair.
PAIRS = keys(2)
MAGIC = b'M203CR01'
CUTOFF = '2026-06-15T20:26:16.388Z'
HAND_FIELDS = ('hand_number', 'dealer', 'start_left_score', 'start_right_score',
               'cut_card', 'left_dealt', 'right_dealt', 'left_keep', 'right_keep')


def eligible(engine):
    return model_version(engine) in STRONG_VERSIONS


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def bootstrap():
    data = LEGACY.read_bytes()
    if digest(data) != LEGACY_SHA:
        raise ValueError('unverified historical crib source')
    source = json.loads(data)
    counts = {}
    for own_role, opponent_role in zip(ROLES, reversed(ROLES)):
        row = {}
        for cuts in source['table'][own_role].values():
            for entry in cuts:
                for discard in entry['opponentDiscards']:
                    key, n = discard['ranks'], discard['weight']
                    if key not in PAIRS or type(n) is not int or n <= 0:
                        raise ValueError('invalid historical evidence')
                    if key in row and row[key] != n:
                        raise ValueError('inconsistent historical frequency')
                    row[key] = n
        if set(row) != set(PAIRS) or sum(row.values()) != 358676:
            raise ValueError('incomplete historical evidence')
        counts[opponent_role] = row
    return {'schemaVersion': 1, 'baselineCounts': counts, 'countsByModel': {}, 'games': {},
            'sources': [], 'legacyCutoff': CUTOFF,
            'baseline': {'asset': LEGACY.name, 'sha256': LEGACY_SHA,
                         'reportedSourceGames': source['sourceGameCount'],
                         'observations': source['sourceDiscardCount'],
                         'models': ['7.0', '8.0', '9.0', '10.0'],
                         'builderCommit': '71486d9eafa00d357fe2565b568870ee22d98c56'},
            'reservedValidationSeeds': [],
            'gameIdentity': 'run,matchup,index,id,left_engine,right_engine'}


def validate(value):
    if value['schemaVersion'] != 1 or value['baseline']['sha256'] != LEGACY_SHA:
        raise ValueError('unsupported crib evidence')
    expected = bootstrap()
    if value['baselineCounts'] != expected['baselineCounts'] or value['baseline'] != expected['baseline']:
        raise ValueError('historical evidence changed')
    if value['legacyCutoff'] != CUTOFF or value['gameIdentity'] != expected['gameIdentity']:
        raise ValueError('unsupported evidence identity/cutoff')
    for engine, roles in value['countsByModel'].items():
        if not eligible(engine):
            raise ValueError(f'ineligible inherited actor: {engine}')
        for role, row in roles.items():
            if role not in ROLES or any(k not in PAIRS or type(n) is not int or n <= 0 for k, n in row.items()):
                raise ValueError('invalid discard evidence')


def actor_discard(hand, side):
    name = ('left', 'right')[side]
    dealt, keep = bytes(hand[name + '_dealt'] or b''), bytes(hand[name + '_keep'] or b'')
    if (len(dealt) != 6 or len(set(dealt)) != 6 or any(c >= 52 for c in dealt)
            or len(keep) != 4 or len(set(keep)) != 4 or not set(keep) <= set(dealt)):
        raise ValueError('invalid deal/keep')
    if hand['dealer'] not in (0, 1):
        raise ValueError('invalid dealer')
    return ('dealer' if hand['dealer'] == side else 'pone', rank_key(sorted(set(dealt) - set(keep))))


def game_hands(db, game_id):
    return [dict(h) for h in db.execute('SELECT ' + ','.join(HAND_FIELDS) +
            ' FROM compact_hands WHERE game_id=? ORDER BY hand_number', (game_id,))]


def import_database(value, path):
    path = path.resolve()
    wal = Path(str(path) + '-wal')
    if wal.exists() and wal.stat().st_size:
        raise ValueError('supply an immutable SQLite backup without pending WAL')
    before = file_digest(path)
    if any(s['sha256'] == before for s in value['sources']):
        return
    stats, by_model, imported = Counter(), Counter(), []
    seen = set(value['games'].values())
    reserved = set(value['reservedValidationSeeds'])
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        games = db.execute('SELECT * FROM compact_games WHERE included_in_tables=1 AND reproducible=1 '
                           'AND winner IN (0,1) AND (final_left_score>=121 OR final_right_score>=121) '
                           "AND ended_at IS NOT NULL AND ended_at!='' ORDER BY game_index,game_id")
        for game in games:
            if timestamp(game['ended_at']) <= timestamp(value['legacyCutoff']):
                stats['historicalOverlapSkipped'] += 1
                continue
            if str(game['random_seed']) in reserved:
                stats['reservedValidationGames'] += 1
                continue
            engines = [game['left_engine'], game['right_engine']]
            if not any(eligible(e) for e in engines):
                stats['ineligibleGames'] += 1
                continue
            hands = game_hands(db, game['game_id'])
            identity = digest(canonical([game['run_id'], game['matchup_id'], game['game_index'], game['game_id'], *engines]))
            content = digest(canonical([engines, game['random_seed'], game['final_left_score'], game['final_right_score'],
                       [{k: v.hex() if isinstance(v, bytes) else v for k, v in h.items()} for h in hands]]))
            if identity in value['games'] and value['games'][identity] != content:
                raise ValueError(f"conflicting completed game: {game['game_id']} in {path}")
            if identity in value['games'] or content in seen:
                stats['duplicateGames'] += 1
                continue
            added = 0
            for hand in hands:
                for side, engine in enumerate(engines):
                    if not eligible(engine):
                        stats['ineligibleActors'] += 1
                        continue
                    try:
                        role, pair = actor_discard(hand, side)
                    except ValueError:
                        stats['invalidActorHands'] += 1
                        continue
                    row = value['countsByModel'].setdefault(engine, {}).setdefault(role, {})
                    row[pair] = row.get(pair, 0) + 1
                    by_model[engine] += 1
                    added += 1
            if added:
                value['games'][identity] = content
                seen.add(content)
                stats['gamesAdded'] += 1
                stats['discardsAdded'] += added
                imported.append({'gameId': game['game_id'], 'runId': game['run_id'],
                                 'matchupId': game['matchup_id'], 'gameIndex': game['game_index'],
                                 'seed': game['random_seed'], 'engines': engines})
    if file_digest(path) != before:
        raise ValueError('database changed during import')
    value['sources'].append({'path': str(path), 'sha256': before, 'statistics': dict(stats),
                             'discardsByModel': dict(by_model), 'includedGames': imported})


def merged_counts(value):
    result = {role: Counter(value['baselineCounts'][role]) for role in ROLES}
    for roles in value['countsByModel'].values():
        for role, row in roles.items():
            result[role].update(row)
    return result


def probabilities(row, strength):
    if not math.isfinite(strength) or strength <= 0:
        raise ValueError('positive finite smoothing strength required')
    total = sum(row.values())
    # Physical two-card prior: 6 combinations for pairs, 16 for distinct ranks.
    return {k: (row.get(k, 0) + strength * (6 if '2' in k else 16) / 1326) / (total + strength) for k in PAIRS}


def heldout(database):
    splits = [{role: Counter() for role in ROLES} for _ in range(2)]
    games, seeds = [[], []], []
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        for game in db.execute('SELECT * FROM compact_games WHERE game_index<1000 AND included_in_tables=1 '
                               'AND reproducible=1 AND winner IN (0,1) ORDER BY game_index'):
            split = int(game['game_index'] >= 500)
            games[split].append(game['game_id']);seeds.append(str(game['random_seed']))
            for hand in game_hands(db, game['game_id']):
                for side, field in enumerate(('left_engine', 'right_engine')):
                    if eligible(game[field]):
                        try:
                            role, pair = actor_discard(hand, side)
                        except ValueError:
                            continue
                        splits[split][role][pair] += 1
    if [len(g) for g in games] != [500, 500]:
        raise ValueError('expected 500 tuning and 500 validation games')
    return splits, games, sorted(set(seeds))


def nll(row, probs):
    n = sum(row.values())
    return sum(-count * math.log(probs[pair]) for pair, count in row.items()) / n


def calibrate(value, database):
    splits, games, seeds = heldout(database)
    if seeds != sorted(value['reservedValidationSeeds']):
        raise ValueError('validation reservation differs from imported evidence')
    counts, strengths, report = merged_counts(value), {}, {}
    for role in ROLES:
        options = [{'strength': s, 'tuningNll': nll(splits[0][role], probabilities(counts[role], s))}
                   for s in (1, 10, 100, 1000, 10000, 100000)]
        strengths[role] = min(options, key=lambda r: r['tuningNll'])['strength']
        total = sum(counts[role].values())
        report[role] = {'options': options, 'strength': strengths[role],
                        'validationObservations': sum(splits[1][role].values()),
                        'rawValidationNll': nll(splits[1][role], {k: n/total for k,n in counts[role].items()}),
                        'smoothedValidationNll': nll(splits[1][role], probabilities(counts[role], strengths[role]))}
    return {'schemaVersion': 1, 'database': str(database.resolve()), 'databaseSha256': file_digest(database),
            'evidenceSha256': digest(canonical(value)), 'gamesBySplit': games, 'roles': report,
            'scope': 'Global role/rank prediction, not playing strength; historical aggregate has no seed ledger.'}


@lru_cache(None)
def rank_score(cards):
    points = 2 * sum(sum(min(r+1, 10) for r in subset) == 15 for n in range(1, 6)
                     for subset in itertools.combinations(cards, n))
    points += 2 * sum(a == b for a, b in itertools.combinations(cards, 2))
    for n in (5, 4, 3):
        runs = sum(len(set(s)) == n and max(s)-min(s) == n-1 for s in itertools.combinations(cards, n))
        if runs:
            return points + n*runs
    return points


def score_cube():
    result = bytearray()
    cards = {k: tuple(i for i,c in enumerate(k) for _ in range(int(c))) for k in PAIRS}
    for own in PAIRS:
        for cut in range(13):
            for other in PAIRS:
                ranks = tuple(sorted(cards[own] + cards[other] + (cut,)))
                result.append(255 if max(Counter(ranks).values()) > 4 else rank_score(ranks))
    return bytes(result)


def pack(value, calibration):
    counts = merged_counts(value)
    metadata = {'schemaVersion': 1, 'modelVersion': '20.3', 'baseline': value['baseline'],
                'importedGames': len(value['games']), 'observationsByRole': {r:sum(counts[r].values()) for r in ROLES},
                'observationsByModel': {m:sum(sum(row.values()) for row in roles.values()) for m,roles in value['countsByModel'].items()},
                'evidenceSha256': digest(canonical(value)), 'calibrationSha256': digest(canonical(calibration)),
                'smoothing': {r:calibration['roles'][r]['strength'] for r in ROLES},
                'roleSemantics': 'Empirical pair weights indexed by discarding actor role; use opposite of own role.',
                'pairOrder': 'lexicographic thirteen-rank count keys',
                'scoreOrder': 'ownPair,cutRank,opponentPair; 255 means impossible',
                'probabilities': 'Dirichlet posterior mean with physical two-card prior; raw counts retained separately'}
    meta = canonical(metadata)
    payload = bytearray(meta)
    for role in ROLES:
        probs = probabilities(counts[role], calibration['roles'][role]['strength'])
        for pair in PAIRS:
            payload += struct.pack('<Qd', counts[role][pair], probs[pair])
    payload += score_cube()
    return struct.pack('<8s6I32s', MAGIC, 1, 2, 91, 13, len(meta), len(payload), bytes.fromhex(digest(payload))) + payload, metadata


def save_evidence(value, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(gzip.compress(canonical(value), mtime=0))
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, default=EVIDENCE)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--sources', type=Path)
    parser.add_argument('--calibration-database', type=Path)
    parser.add_argument('--calibration', type=Path, default=CALIBRATION)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    value = json.loads(gzip.decompress(args.evidence.read_bytes())) if args.evidence.exists() else bootstrap()
    validate(value)
    if args.sources:
        if args.check or not args.calibration_database:
            parser.error('--sources requires --calibration-database and cannot accompany --check')
        _, _, reserved = heldout(args.calibration_database)
        if value['games'] and value['reservedValidationSeeds'] != reserved:
            raise ValueError('cannot change reserved games after import')
        value['reservedValidationSeeds'] = reserved
        for path in json.loads(args.sources.read_text()):
            import_database(value, Path(path))
            save_evidence(value, args.evidence)
            print(json.dumps({'database': path, 'importedGames': len(value['games'])}), flush=True)
    if args.calibration_database:
        calibration = calibrate(value, args.calibration_database)
    else:
        calibration = json.loads(args.calibration.read_bytes())
    if calibration['evidenceSha256'] != digest(canonical(value)):
        raise ValueError('stale smoothing calibration')
    packed, metadata = pack(value, calibration)
    if args.check:
        if args.output.read_bytes() != packed:
            raise ValueError('crib binary is not reproducible')
    else:
        save_evidence(value, args.evidence)
        args.calibration.parent.mkdir(parents=True, exist_ok=True)
        args.calibration.write_text(json.dumps(calibration, sort_keys=True, indent=2)+'\n')
        args.output.write_bytes(packed)
        args.output.with_suffix('.provenance.json').write_text(json.dumps(metadata, sort_keys=True, indent=2)+'\n')
    print(json.dumps({'bytes': len(packed), 'sha256': digest(packed), 'games': len(value['games']),
                      'observations': metadata['observationsByRole'], 'smoothing': metadata['smoothing']}))


if __name__ == '__main__':
    main()
