"""Evidence extraction and one-prior updates. Games, never replay cells, identify evidence."""
import hashlib
import json
import math
import shutil
import struct
from collections import Counter, defaultdict
from pathlib import Path
from formats import (DI, KI, PAIRS, canonical, key, replace, update_crib,
                     update_declines, update_hold)

ASSETS = Path('rust/cribbage-shadow-engine/assets')
FILES = {'wp': 'model202-board-win-matrix.bin', 'crib': 'model203-crib.bin',
         'holds': 'model203-hold.bin', 'discards': 'model203-opponent-discards.bin',
         'declines': 'model203-decline-factors.json'}
PHASES = tuple(FILES)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    replace(path, canonical(value) + b'\n')


def manifest(root):
    return json.loads((Path(root) / ASSETS / 'model29-generation.json').read_text())


def verify_source(config):
    path = Path(config['repo']).parent/'source-manifest.json'
    if sha(path) != config['sourceManifestSha256']:
        raise ValueError('frozen source manifest changed')
    value = json.loads(path.read_text())
    for name,expected in value['files'].items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or sha(Path(config['repo'])/relative) != expected:
            raise ValueError('frozen source changed: '+name)


def verify(root):
    m = manifest(root)
    if m['model'] != '29.0' or m['schemaVersion'] != 1:
        raise ValueError('invalid generation')
    required = set(FILES.values()) | {'model1323-corrections.bin'}
    if not required <= m['assets'].keys():
        raise ValueError('missing required assets')
    for name, expected in m['assets'].items():
        if Path(name).name != name or name.startswith('.') or sha(Path(root) / ASSETS / name) != expected:
            raise ValueError('generation asset changed: ' + name)
    return m


def seal(root, generation, parent, evidence, policy):
    directory = Path(root) / ASSETS
    value = dict(schemaVersion=1, model='29.0', base='28.3', arithmetic='f64',
                 generation=generation, parent=parent, evidence=evidence, policy=policy,
                 assets={p.name: sha(p) for p in sorted(directory.iterdir())
                         if p.is_file() and p.name != 'model29-generation.json'})
    atomic(directory / 'model29-generation.json', value)
    return sha(directory / 'model29-generation.json')


def clone(source, target):
    if Path(target).exists():
        raise ValueError('snapshot target already exists')
    # Copy-on-write clones where supported, ordinary independent copies elsewhere.
    # No writable hard links to ancestors or production assets.
    shutil.copytree(Path(source) / ASSETS, Path(target) / ASSETS,
                    ignore=shutil.ignore_patterns('model29-generation.json'))


def bootstrap(source, target, policy):
    audit = json.loads((Path(__file__).parent / 'baseline.json').read_text())
    for name, row in audit['assets'].items():
        if sha(Path(source) / ASSETS / name) != row['sha256']:
            raise ValueError('inherited asset differs from audited 28.3 baseline: ' + name)
    clone(source, target)
    return seal(target, 0, None, {'inheritedAudit': audit}, policy)


def series(game):
    """Ordered scoring events plus phase boundaries; counting never swaps order."""
    events, markers = [], []
    def add(actor, points):
        if points < 0:
            raise ValueError('negative score event')
        if points:
            events.append((actor, points))
    for h in game['hands']:
        if any(len(k) != 4 for k in h['keeps']):
            break  # a trailing newly dealt hand has not started
        d = h['dealer']; p = 1-d
        markers.append((len(events), 0, d))
        heels = 2 * int(h['cut'] % 13 == 10)
        add(d, heels)
        markers.append((len(events), 1, d))
        previous = h['start'].copy(); previous[d] += heels
        for play in h['plays']:
            # Raw `points` omits go/last-card awards, and a go can score for
            # the other actor. The recorded score deltas include every award.
            delta = [play['scores'][i]-previous[i] for i in range(2)]
            if min(delta) < 0 or sum(v > 0 for v in delta) > 1:
                raise ValueError('ambiguous or decreasing scoring event')
            for actor,points in enumerate(delta):
                add(actor,points)
            previous = play['scores']
        if sum(x['action'] == 0 for x in h['plays']) < 8:
            break
        markers.append((len(events), 2, d))
        add(p, h['handPoints'][p])
        markers.append((len(events), 3, d))
        add(d, h['handPoints'][d]); add(d, h['cribPoints'])
    return events, markers


def board_observations(game):
    events, markers = series(game)
    prefix = [[0, 0]]
    crossings = [[math.inf] * 122 for _ in range(2)]
    for i, (actor, points) in enumerate(events):
        total = prefix[-1].copy(); total[actor] += points
        for need in range(prefix[-1][actor]+1, min(121,total[actor])+1):
            crossings[actor][need] = i
        prefix.append(total)
    result = defaultdict(lambda: [0., 0])
    if game['trajectory']:
        if any(n < 121 for n in prefix[-1]):
            raise ValueError('incomplete two-sided trajectory')
        # A single initial board is translated; later tails are not independent
        # starts. Accumulate only visits occurring before the translated winner.
        for offset, phase, dealer in markers:
            pone = 1-dealer
            for d in range(prefix[offset][dealer], 121):
                d_event = crossings[dealer][121-(d-prefix[offset][dealer])]
                for p in range(prefix[offset][pone], 121):
                    p_event = crossings[pone][121-(p-prefix[offset][pone])]
                    row = result[phase, d, p]
                    row[0] += int(d_event < p_event); row[1] += 1
    else:
        if game['winner'] not in (0, 1):
            raise ValueError('missing winner')
        for offset, phase, dealer in markers:
            score = [game['start'][i]+prefix[offset][i] for i in range(2)]
            if max(score) >= 121:
                continue
            row = result[phase, score[dealer], score[1-dealer]]
            row[0] += int(game['winner'] == dealer); row[1] += 1
    return result


def natural_hands(game):
    """Use the standard game's prefix; continuation after the first winner is synthetic."""
    for original in game['hands']:
        if max(original['start']) >= 121 or any(len(k) != 4 for k in original['keeps']):
            break
        h = dict(original); h['plays'] = []
        after_cut = original['start'].copy()
        after_cut[h['dealer']] += 2*int(h['cut']%13 == 10)
        if max(after_cut) < 121:
            for play in original['plays']:
                h['plays'].append(play)
                if max(play['scores']) >= 121:
                    break
        yield h
        # The containing hand can have ended in heels, pegging, or counting.
        end = original['end']
        if any(v is not None and v >= 121 for v in end):
            break


def observations(games):
    holds, discards, suits, hands = Counter(), Counter(), Counter(), []
    for game in games:
        if game.get('candidateSide') is not None or game['model'] != '29.0':
            raise ValueError('only attributable training games may enter learning')
        for h in natural_hands(game):
            if len(set(h['dealt'][0]+h['dealt'][1]+[h['cut']])) != 13:
                raise ValueError('invalid physical hand')
            hands.append(h)
            for actor in range(2):
                role = int(actor != h['dealer']); keep = h['keeps'][actor]
                discard = sorted(set(h['dealt'][actor])-set(keep))
                if len(discard) != 2:
                    raise ValueError('invalid discard')
                d = DI[key(discard)]
                discards[role, KI[key(keep)], d] += 1
                suits[role,d,'n'] += 1
                suits[role,d,'same'] += int(discard[0]//13 == discard[1]//13)
                left, played = keep.copy(), []
                holds[role,key(played),key(left)] += 1
                for play in h['plays']:
                    if play['action'] == 0 and play['actor'] == actor:
                        left.remove(play['card']); played.append(play['card'])
                        if len(played) < 4:
                            holds[role,key(played),key(left)] += 1
    return holds, discards, suits, hands


def update_board(source, target, games, mass, state):
    data = bytearray(source.read_bytes())
    if data[:4] != b'BWM2' or len(data) != 16+4*121*121*8:
        raise ValueError('invalid board asset')
    # Each independent seed contributes at most one effective observation per
    # cell. Pool repeated visits and paired orientations within that cluster.
    clusters = defaultdict(lambda: defaultdict(lambda: [0.,0]))
    for game in games:
        for cell, (wins,n) in board_observations(game).items():
            row = clusters[game['seed']][cell]; row[0] += wins; row[1] += n
    values = defaultdict(lambda: [0.,0])
    for rows in clusters.values():
        for cell, (wins,n) in rows.items():
            row = values[cell]; row[0] += wins/n; row[1] += 1
    for (phase,d,p), (wins,n) in values.items():
        offset = 16+8*((phase*121+d)*121+p)
        old = struct.unpack_from('<d',data,offset)[0]
        identity = f'{phase},{d},{p}'; previous = state.get(identity,0)
        new = (old*(mass+previous)+wins)/(mass+previous+n)
        struct.pack_into('<d',data,offset,new); state[identity] = previous+n
    replace(target,data)
    return dict(cells=len(values),seedClusters=len(clusters),
                transposedGames=sum(g['trajectory'] for g in games),
                interpretation='fixed-line replay prior plus direct on-policy visits; not unbiased score-conditioned WP')


def update_discards(source, target, counts, suits, mass, state):
    data = source.read_bytes()
    magic, version, ml, roles, nk, nd, size = struct.unpack_from('<8s6I',data)
    if (magic,version,roles,nk,nd) != (b'M203OD01',2,2,1820,91):
        raise ValueError('invalid discard asset')
    meta = json.loads(data[64:64+ml]); payload = bytearray(data[64+ml:])
    suit_size = 2*(16+91*24)
    rows = defaultdict(Counter)
    for (role,keep,discard), n in counts.items():
        rows[role,keep][discard] += n
    for (role,keep), added in rows.items():
        identity = f'{role}:{keep}'; previous = state.get(identity,0); total = sum(added.values())
        for d in range(91):
            offset = suit_size+8*((role*1820+keep)*91+d)
            old = struct.unpack_from('<d',payload,offset)[0]
            if not old and added[d]:
                raise ValueError('observed impossible discard')
            struct.pack_into('<d',payload,offset,(old*(mass+previous)+added[d])/(mass+previous+total))
        state[identity] = previous+total
    for role in range(2):
        offset = role*(16+91*24); rows = []
        for d,pair in enumerate(PAIRS):
            n,same,rate = struct.unpack_from('<QQd',payload,offset+16+d*24)
            n += suits[role,d,'n']; same += suits[role,d,'same']
            rows.append((n,same,'2' not in pair))
        total = sum(n for n,_,_ in rows); same = sum(v for _,v,_ in rows)
        prior = (same+1)/(sum(n for n,_,distinct in rows if distinct)+4)
        smooth = meta['suitedSection']['calibration'][role]['strength']
        meta['suitedSection']['calibration'][role]['priorMean'] = prior
        struct.pack_into('<dd',payload,offset,same/total if total else 0,prior)
        for d,(n,same,distinct) in enumerate(rows):
            struct.pack_into('<QQd',payload,offset+16+d*24,n,same,(prior*smooth+same)/(smooth+n) if distinct else 0.)
    encoded = canonical(meta); packed = encoded+payload
    replace(target,struct.pack('<8s6I',magic,version,len(encoded),roles,nk,nd,len(packed))+hashlib.sha256(packed).digest()+packed)


def update(source, target, phase, records, mass, repo):
    if phase not in PHASES or not math.isfinite(mass) or mass <= 0:
        raise ValueError('invalid phase or prior mass')
    old = verify(source); src = Path(source)/ASSETS
    state_path = src/'model29-state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    phase_state = state.setdefault(phase,{'applied':[],'counts':{}})
    seen = set(phase_state['applied']); selected = {}
    for identity,game in records:
        if identity in selected:
            raise ValueError('duplicate evidence identity')
        if identity not in seen:
            selected[identity] = game
    if not selected:
        raise ValueError('no new observations for '+phase)
    games = [selected[k] for k in sorted(selected)]
    holds,discards,suits,hands = observations(games)
    clone(source,target); dst = Path(target)/ASSETS
    name = FILES[phase]; counts = phase_state['counts']; details = {}
    if phase == 'wp':
        details = update_board(src/name,dst/name,games,mass,counts)
    elif phase == 'holds':
        details['rows'] = update_hold(src/name,dst/name,holds,mass,counts)
    elif phase == 'crib':
        update_crib(src/name,dst/name,discards,mass,counts)
    elif phase == 'discards':
        update_discards(src/name,dst/name,discards,suits,mass,counts)
    else:
        details['observations'] = update_declines(src/name,dst/name,hands,mass,counts,repo,old['policy'])
    phase_state['applied'] = sorted(seen|selected.keys())
    atomic(dst/'model29-state.json',state)
    evidence = dict(phase=phase,games=len(games),hands=len(hands),priorEffectiveSamples=mass,
                    identities=sorted(selected),**details)
    fingerprint = seal(target,old['generation']+1,sha(src/'model29-generation.json'),evidence,old['policy'])
    new = verify(target)
    changed = [name for name in FILES.values() if old['assets'][name] != new['assets'][name]]
    if any(name != FILES[phase] for name in changed):
        raise ValueError('non-target prior changed')
    return dict(snapshot=fingerprint,changed=changed,**evidence)
