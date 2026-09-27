#!/usr/bin/env python3
"""Rebuild attributable decline evidence and calibrate positive beta-binomial rates."""
import argparse
from collections import Counter, defaultdict
from functools import lru_cache
import gzip
import json
import math
from pathlib import Path
import sqlite3

from build_model203_hold import STRONG_VERSIONS, canonical, digest, file_digest
from learning_model_policy import model_version
from build_model1322_decline_factors import completion, atomic_write

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'rust/cribbage-shadow-engine/assets'
LEGACY = ASSETS / 'model1322-decline-factors.json'
LEGACY_SHA = '4dfb1b8c20f612153a6b0d57496fd77c5219a8a2ba7e01acb8909b862d5418dc'
CATEGORIES = ('threeCardRun', 'fourPlusCardRun', 'pair', 'pairRoyalAfterPair',
              'fourOfAKindAfterPairRoyal', 'safePair', 'safePairRoyal')
ORDINALS = ('first', 'second', 'third')
VALUES = tuple(min(r + 1, 10) for r in range(13))
IDENTITY = 'run,matchup,index,id,left_engine,right_engine'
SOURCE_POLICIES = json.loads((ROOT / 'training/model203-decline-source-policies.json').read_text())['sources']
# Asset-specific: historical overall strength does not qualify a pegging policy.
QUALIFIED_VERSIONS = frozenset(('13.0', '13.2', '13.21', '13.215', '13.23',
                              '20.0', '20.1', '20.2', '20.3'))
CORRECTED_131_SOURCES = frozenset((
    'b69daf6e0dc1037d67c08af07250a5b267f5013b31fce8e06fc2030af404a755',
    'e233acd82e00fd361712a8953556dd768205d0a6effbea2d9adec4cd17a59409'))
EXCLUDED_LEAD_SOURCES = frozenset((
    'd1b08e7245f1734e51874b32621e391e26702b275191ed946bc6ec0dbfb44edb',
    '5d6818407df2b5f427b5ad5a056415bbb7d53e91ee4a11403d01e417a4f055bf'))
SELECTION = {'id': 'strategic-pegging-v1', 'qualifiedVersions': sorted(QUALIFIED_VERSIONS),
             'corrected131SourceHashes': sorted(CORRECTED_131_SOURCES),
             'excludedPreCutLeadSourceHashes': sorted(EXCLUDED_LEAD_SOURCES),
             'humanAggregate': 'excluded: unclassified pegging strength'}


def eligible(engine):
    # Broad eligibility remains available to reproduce the archived audit.
    return model_version(engine) in STRONG_VERSIONS


def qualified(engine, source_sha):
    if source_sha not in SOURCE_POLICIES or source_sha in EXCLUDED_LEAD_SOURCES:
        return False
    version = model_version(engine)
    return (version in QUALIFIED_VERSIONS or
            (version == '13.1' and source_sha in CORRECTED_131_SOURCES))


def empty_counts():
    # accepted, declined while held, declined while absent; all are RAW counts.
    return [[0, 0, 0] for _ in range(21)]


def add_counts(target, source):
    for a, b in zip(target, source):
        for i in range(3):
            a[i] += b[i]


@lru_cache(maxsize=65536)
def completions(series):
    mapping = {'threeCardRun': 0, 'fourPlusCardRun': 1, 'pair': 2,
               'threeOfAKind': 3, 'fourOfAKind': 4}
    return tuple(mapping.get(completion(list(series), r)) for r in range(13))


def hand_events(hand):
    """Validate an actual hand before returning any behavioral observations."""
    remaining, known = [], []
    cut = hand['cut_card']
    if cut is None or not 0 <= cut < 52:
        raise ValueError('missing cut')
    all_dealt = []
    for name in ('left', 'right'):
        dealt = list(hand[name + '_dealt'] or b'')
        keep = list(hand[name + '_keep'] or b'')
        if (len(dealt) != 6 or len(set(dealt)) != 6 or any(c >= 52 for c in dealt)
                or len(keep) != 4 or len(set(keep)) != 4 or not set(keep) <= set(dealt)):
            raise ValueError('incomplete or invalid deal/keep')
        all_dealt.extend(dealt)
        remaining.append(set(keep))
        known.append(Counter(c // 4 for c in dealt + [cut]))
    if len(set(all_dealt + [cut])) != 13:
        raise ValueError('overlapping physical cards')
    series, played, public, go, events = [], [0, 0], [Counter(), Counter()], None, []
    for action, actor, card, before, after, engine in hand['plays']:
        if action == 2:
            series, go = [], None
            continue
        if actor not in (0, 1) or action not in (0, 1):
            raise ValueError('invalid pegging event')
        if before == 0 and series:
            series, go = [], None
        if before != sum(VALUES[r] for r in series):
            raise ValueError('inconsistent count')
        if action == 1:
            if any(before + VALUES[c // 4] <= 31 for c in remaining[actor]):
                raise ValueError('illegal go')
            go = actor
            continue
        if card not in remaining[actor] or after != before + VALUES[card // 4] or after > 31:
            raise ValueError('illegal play')
        actual, ordinal = card // 4, played[actor]
        if ordinal < 3 and remaining[1 - actor]:
            categories = completions(tuple(series))
            competing = categories[actual] is not None or after in (15, 31)
            held = {c // 4 for c in remaining[actor]}
            for candidate, category in enumerate(categories):
                if category is None or before + VALUES[candidate] > 31:
                    continue
                if actual == candidate:
                    outcome = 0
                elif not competing:
                    outcome = 1 if candidate in held else 2
                else:
                    continue
                events.append((actor, engine, category * 3 + ordinal, outcome))
                # Preserve the frozen builder's safe-pair definition. Aligning
                # this with runtime public-only categories is a separate change.
                safe = (go == 1 - actor or known[actor][candidate] + public[1 - actor][candidate] >= 4
                        or before + 2 * VALUES[candidate] > 31)
                if safe and category in (2, 3):
                    events.append((actor, engine, (category + 3) * 3 + ordinal, outcome))
        remaining[actor].remove(card)
        public[actor][actual] += 1
        played[actor] += 1
        series.append(actual)
        if after == 31:
            series, go = [], None
    return events


def game_hands(db, game_id, normalized, engines):
    fields = ('hand_number', 'dealer', 'cut_card', 'left_dealt', 'right_dealt', 'left_keep', 'right_keep', 'peg_sequence')
    hands = [dict(h) for h in db.execute('SELECT ' + ','.join(fields) +
             ' FROM compact_hands WHERE game_id=? ORDER BY hand_number', (game_id,))]
    plays = defaultdict(list)
    if normalized:
        for p in db.execute('SELECT hand_number,action,player,card,count_before,count_after,model '
                            'FROM compact_peg_plays WHERE game_id=? ORDER BY hand_number,sequence', (game_id,)):
            plays[p['hand_number']].append(tuple(p)[1:])
    for h in hands:
        sequence = bytes(h.pop('peg_sequence') or b'')
        if plays[h['hand_number']]:
            h['plays'] = plays[h['hand_number']]
        else:
            if len(sequence) % 5:
                raise ValueError('invalid compact sequence')
            h['plays'] = []
            for i in range(0, len(sequence), 5):
                action, actor, card, count, points = sequence[i:i + 5]
                before = count - VALUES[card // 4] if action == 0 and card < 52 else count
                h['plays'].append((action, actor, card, before, count, None))
        canonical_plays, count = [], 0
        for a, actor, card, before, after, engine in h['plays']:
            # Some normalized legacy go/reset rows omit counts. They are
            # determined exactly by the preceding public plays, not inferred hands.
            before = count if before is None else before
            after = after if a == 0 else (before if a == 1 else 0)
            canonical_plays.append((a, actor if a != 2 else None, card if a == 0 else None,
                                    before, after, (engine or engines[actor])
                                    if a == 0 and actor in (0, 1) else None))
            count = after
        h['plays'] = canonical_plays
    return hands


def bootstrap(legacy, seeds):
    raw = legacy.read_bytes()
    if digest(raw) != LEGACY_SHA:
        raise ValueError('unverified historical asset')
    return {'schemaVersion': 2, 'gameIdentity': IDENTITY, 'countsByModel': {},
            'selectionPolicy': SELECTION,
            'reservedValidationSeeds': seeds, 'games': {}, 'sources': []}


def validate(value, legacy):
    expected = bootstrap(legacy, value['reservedValidationSeeds'])
    if (value['schemaVersion'] != 2 or value['gameIdentity'] != IDENTITY
            or value['selectionPolicy'] != expected['selectionPolicy']):
        raise ValueError('invalid evidence identity or selection policy')
    for engine, rows in value['countsByModel'].items():
        if model_version(engine) not in QUALIFIED_VERSIONS | {'13.1'}:
            raise ValueError('ineligible inherited actor: ' + engine)
        if len(rows) != 21 or any(len(r) != 3 or any(type(n) is not int or n < 0 for n in r) for r in rows):
            raise ValueError('invalid raw counts')
    totals = {}
    for source in value['sources']:
        for engine, rows in source['countsByModel'].items():
            if not qualified(engine, source['sha256']):
                raise ValueError('source does not qualify actor: ' + engine)
            add_counts(totals.setdefault(engine, empty_counts()), rows)
    if totals != value['countsByModel']:
        raise ValueError('source counts do not reproduce aggregate')


def completed_games(db, suffix=''):
    return db.execute('SELECT * FROM compact_games WHERE included_in_tables=1 AND reproducible=1 '
                      'AND winner IN (0,1) AND (final_left_score>=121 OR final_right_score>=121) '
                      "AND ended_at IS NOT NULL AND ended_at!='' " + suffix + ' ORDER BY game_index,game_id')


def import_database(value, path):
    path = path.resolve()
    if Path(str(path) + '-wal').exists() and Path(str(path) + '-wal').stat().st_size:
        raise ValueError('supply immutable SQLite backup: ' + str(path))
    before = file_digest(path)
    if before not in SOURCE_POLICIES:
        raise ValueError('source hash requires pegging-policy provenance review: ' + before)
    if any(s['sha256'] == before for s in value['sources']):
        return
    stats, imported, source_counts = Counter(), [], {}
    seen, reserved = set(value['games'].values()), set(value['reservedValidationSeeds'])
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        normalized = bool(db.execute("SELECT 1 FROM sqlite_master WHERE name='compact_peg_plays'").fetchone())
        for game in completed_games(db):
            if str(game['random_seed']) in reserved:
                stats['reservedGames'] += 1
                continue
            engines = [game['left_engine'], game['right_engine']]
            if not any(qualified(e, before) for e in engines):
                stats['ineligibleGames'] += 1
                continue
            hands = game_hands(db, game['game_id'], normalized, engines)
            identity = digest(canonical([game[k] for k in ('run_id', 'matchup_id', 'game_index', 'game_id')] + engines))
            content = digest(canonical([engines, game['random_seed'], game['final_left_score'], game['final_right_score'],
                [{k: v.hex() if isinstance(v, bytes) else v for k, v in h.items()} for h in hands]]))
            if identity in value['games'] and value['games'][identity] != content:
                raise ValueError('conflicting completed game: ' + game['game_id'])
            if identity in value['games'] or content in seen:
                stats['duplicateGames'] += 1
                continue
            for hand in hands:
                try:
                    events = hand_events(hand)
                except ValueError:
                    stats['invalidHands'] += 1
                    continue
                stats['validHands'] += 1
                for actor, override, cell, outcome in events:
                    engine = override or engines[actor]
                    if not qualified(engine, before):
                        stats['ineligibleActorEvents'] += 1
                        continue
                    if engine not in value['countsByModel']:
                        value['countsByModel'][engine] = empty_counts()
                    value['countsByModel'][engine][cell][outcome] += 1
                    source_counts.setdefault(engine, empty_counts())[cell][outcome] += 1
                    stats['eventsAdded'] += 1
            value['games'][identity] = content
            seen.add(content)
            stats['gamesAdded'] += 1
            imported.append({k: game[k] for k in ('game_id', 'run_id', 'matchup_id', 'game_index', 'random_seed', 'left_engine', 'right_engine')})
    if file_digest(path) != before:
        raise ValueError('database changed during import')
    value['sources'].append({'path': str(path), 'sha256': before, 'statistics': dict(stats),
                            'qualifiedActors': sorted(source_counts), 'countsByModel': source_counts,
                            'includedGames': imported})
    print(json.dumps({'source': str(path), **stats}), flush=True)


def heldout(path):
    splits, games, seeds = [empty_counts(), empty_counts()], [[], []], []
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        normalized = bool(db.execute("SELECT 1 FROM sqlite_master WHERE name='compact_peg_plays'").fetchone())
        for game in completed_games(db, 'AND game_index<1000'):
            split = int(game['game_index'] >= 500)
            games[split].append(game['game_id'])
            seeds.append(str(game['random_seed']))
            for hand in game_hands(db, game['game_id'], normalized, [game['left_engine'], game['right_engine']]):
                try:
                    events = hand_events(hand)
                except ValueError:
                    continue
                for actor, override, cell, outcome in events:
                    if eligible(override or game[('left_engine', 'right_engine')[actor]]):
                        splits[split][cell][outcome] += 1
    if [len(g) for g in games] != [500, 500]:
        raise ValueError('expected 500 tuning and 500 validation games')
    return splits, games, sorted(set(seeds))


def probabilities(rows, strength):
    if not math.isfinite(strength) or strength < 0:
        raise ValueError('invalid prior strength')
    result = []
    for c in range(7):
        group = rows[c * 3:c * 3 + 3]
        q = (sum(r[1] for r in group) + .5) / (sum(r[0] + r[1] for r in group) + 1)
        for accepted, declined, _ in group:
            n = accepted + declined
            # Weak Beta(1/2,1/2) support plus calibrated category-level pooling.
            p = (declined + .5 + strength * q) / (n + 1 + strength) if n else q
            result.append(max(1, min(999999, round(p * 1_000_000))))
    return result


def loss(rows, ppm):
    n = sum(r[0] + r[1] for r in rows)
    return sum(-a * math.log1p(-p / 1_000_000) - d * math.log(p / 1_000_000)
               for (a, d, _), p in zip(rows, ppm)) / n if n else None


def output(value, splits, games, database, legacy):
    rows = empty_counts()
    for counts in value['countsByModel'].values():
        add_counts(rows, counts)
    options = [{'strength': s, 'tuningNll': loss(splits[0], probabilities(rows, s))}
               for s in (0, 1, 10, 100, 1000, 10000)]
    strength = min(options, key=lambda r: r['tuningNll'])['strength']
    ppm = probabilities(rows, strength)
    old = json.loads(legacy.read_bytes())['factors']
    old_ppm = [max(1, min(999999, old[c]['byCardOrdinal'][o]['multiplierPpm']
                         if old[c]['byCardOrdinal'][o]['multiplierPpm'] is not None else old[c]['multiplierPpm']))
               for c in CATEGORIES for o in ORDINALS]
    report = {'schemaVersion': 1, 'database': str(database.resolve()), 'databaseSha256': file_digest(database),
              'evidenceSha256': digest(canonical(value)), 'gamesBySplit': games, 'options': options,
              'selectionPolicy': value['selectionPolicy'],
              'strength': strength, 'validation': {'opportunities': sum(a + d for a, d, _ in splits[1]),
                  'oldFlooredNll': loss(splits[1], old_ppm), 'jeffreysOnlyNll': loss(splits[1], probabilities(rows, 0)),
                  'smoothedNll': loss(splits[1], ppm)},
              'scope': 'Conditional held-card decline prediction, not posterior-hand calibration or playing strength. '
                       'Both paired orientations of reserved seeds excluded from model training.'}
    asset = {'schemaVersion': 1, 'modelVersion': '20.3', 'smoothing': {'baseAlpha': .5, 'baseBeta': .5,
             'categoryPriorStrength': strength, 'minimumPpm': 1}, 'evidenceSha256': digest(canonical(value)),
             'selectionPolicy': value['selectionPolicy']['id'],
             'factors': {c: ppm[i * 3:i * 3 + 3] for i, c in enumerate(CATEGORIES)}}
    return asset, report


def save_evidence(value, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = gzip.compress(canonical(value), mtime=0)
    temporary = path.with_suffix('.tmp')
    temporary.write_bytes(data)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path)
    parser.add_argument('--calibration-database', type=Path, required=True)
    parser.add_argument('--legacy-asset', type=Path, default=LEGACY)
    parser.add_argument('--evidence', type=Path, default=ROOT / 'training/model203-decline-qualified-evidence.json.gz')
    parser.add_argument('--reserve-seeds', type=Path, default=ROOT / 'training/model203-decline-reserved-seeds.json')
    parser.add_argument('--output', type=Path, default=ASSETS / 'model203-decline-factors.json')
    parser.add_argument('--calibration-output', type=Path, default=ROOT / 'training/model203-decline-calibration.json')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    splits, games, seeds = heldout(args.calibration_database)
    seeds = sorted(set(seeds) | set(json.loads(args.reserve_seeds.read_text())))
    value = json.loads(gzip.decompress(args.evidence.read_bytes())) if args.evidence.exists() else bootstrap(args.legacy_asset, seeds)
    validate(value, args.legacy_asset)
    if value['reservedValidationSeeds'] != seeds:
        raise ValueError('reserved seeds changed')
    if args.sources and not args.check:
        for path in json.loads(args.sources.read_text()):
            import_database(value, Path(path))
            save_evidence(value, args.evidence)
    validate(value, args.legacy_asset)
    asset, report = output(value, splits, games, args.calibration_database, args.legacy_asset)
    if args.check:
        if json.loads(args.output.read_text()) != asset or json.loads(args.calibration_output.read_text()) != report:
            raise ValueError('decline asset/calibration differs from retained evidence')
    else:
        atomic_write(args.output, asset)
        atomic_write(args.calibration_output, report)
        save_evidence(value, args.evidence)
    print(json.dumps({'games': len(value['games']), 'models': sorted(value['countsByModel']),
                      'strength': report['strength'], 'validation': report['validation']}))


if __name__ == '__main__':
    main()
