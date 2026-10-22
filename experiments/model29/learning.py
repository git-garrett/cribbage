"""Evidence extraction and one-prior updates. Games, never replay cells, identify evidence."""
import hashlib
import json
import math
import shutil
import struct
from collections import Counter, defaultdict
from pathlib import Path
from forecast import ordinary_cohorts, scoring_inputs
import forecast291
import forecast292
from formats import (DI, KI, PAIRS, canonical, key, replace, update_crib,
                     update_declines, update_hold)

ASSETS = Path('rust/cribbage-shadow-engine/assets')
FILES = {'wp': 'model202-board-win-matrix.bin', 'crib': 'model203-crib.bin',
         'holds': 'model203-hold.bin', 'discards': 'model203-opponent-discards.bin',
         'declines': 'model203-decline-factors.json'}
PHASES = (*FILES, 'forecast')
FORECAST = 'model29-forecasts.json'


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
    if m['model'] not in ('29.0','29.1','29.2') or m['schemaVersion'] != 1:
        raise ValueError('invalid generation')
    required = set(FILES.values()) | {'model1323-corrections.bin'}
    if m['model']=='29.1': required.add(forecast291.FILE)
    if m['model']=='29.2': required.add(forecast292.FILE)
    if not required <= m['assets'].keys():
        raise ValueError('missing required assets')
    for name, expected in m['assets'].items():
        if Path(name).name != name or name.startswith('.') or sha(Path(root) / ASSETS / name) != expected:
            raise ValueError('generation asset changed: ' + name)
    return m


def seal(root, generation, parent, evidence, policy, model='29.0'):
    directory = Path(root) / ASSETS
    value = dict(schemaVersion=1, model=model, base={'29.2':'29.1','29.1':'29.0'}.get(model,'28.3'), arithmetic='f64',
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
    def copy(src, dst):
        import subprocess
        result = subprocess.run(['/bin/cp','-c',str(src),str(dst)],capture_output=True)
        if result.returncode:
            shutil.copy2(src,dst)
        return dst
    shutil.copytree(Path(source) / ASSETS, Path(target) / ASSETS, copy_function=copy,
                    ignore=shutil.ignore_patterns('model29-generation.json'))


def bootstrap(source, target, policy):
    audit = json.loads((Path(__file__).parent / 'baseline.json').read_text())
    for name, row in audit['assets'].items():
        if sha(Path(source) / ASSETS / name) != row['sha256']:
            raise ValueError('inherited asset differs from audited 28.3 baseline: ' + name)
    clone(source, target)
    atomic(Path(target)/ASSETS/FORECAST,dict(prior_mass=32.,rows={}))
    return seal(target, 0, None, {'inheritedAudit': audit}, policy)


def inherit(source, target, policy, model='29.1'):
    old=verify(source)
    clone(source,target)
    assets=Path(target)/ASSETS
    state_path=assets/'model29-state.json'
    if state_path.exists():
        state=json.loads(state_path.read_text())
        for phase in state.values():phase['applied']=[]
        state.pop('forecast',None)
        atomic(state_path,state)
    if model=='29.1':atomic(assets/forecast291.FILE,forecast291.empty())
    if model=='29.2':
        for obsolete in (FORECAST,forecast291.FILE,forecast292.FILE):
            (assets/obsolete).unlink(missing_ok=True)
        forecast292.write(assets/forecast292.FILE,forecast292.empty())
    return seal(target,0,sha(Path(source)/ASSETS/'model29-generation.json'),
        dict(inheritedModel=old['model'],inheritedGeneration=old['generation'],
             sourceSnapshot=str(source)),policy,model)


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
    if game['trajectory']:
        raise ValueError('transposed trajectories are not Model 29 training evidence')
    events, markers = series(game)
    prefix = [[0, 0]]
    for i, (actor, points) in enumerate(events):
        total = prefix[-1].copy(); total[actor] += points
        prefix.append(total)
    result = defaultdict(lambda: [0., 0])
    if game['winner'] not in (0, 1):
        raise ValueError('missing winner')
    for offset, phase, dealer in markers:
        if phase != 0:
            continue
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
        if game.get('candidateSide') is not None or game['model'] not in ('29.0','29.1','29.2'):
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
                interpretation='actual start-of-hand visits and first-winner outcomes; no transposition')


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
    if phase == 'forecast':
        holds,discards,suits,hands = None,None,None,[]
    else:
        holds,discards,suits,hands = observations(games)
    clone(source,target); dst = Path(target)/ASSETS
    name = ({'29.2':forecast292.FILE,'29.1':forecast291.FILE}.get(old['model'],FORECAST)) if phase == 'forecast' else FILES[phase]
    counts = phase_state['counts']; details = {}
    if phase == 'wp':
        details = update_board(src/name,dst/name,games,mass,counts)
    elif phase == 'holds':
        details['rows'] = update_hold(src/name,dst/name,holds,mass,counts)
    elif phase == 'crib':
        update_crib(src/name,dst/name,discards,mass,counts)
    elif phase == 'discards':
        update_discards(src/name,dst/name,discards,suits,mass,counts)
    elif phase == 'declines':
        details['observations'] = update_declines(src/name,dst/name,hands,mass,counts,repo,old['policy'])
    else:
        data = forecast292.read(src/name) if old['model']=='29.2' else json.loads((src/name).read_text()) if (src/name).exists() else dict(prior_mass=32.,rows={})
        scoring_worlds={}
        shared = old['model']=='29.1'; board_cache={}; changed_rows=set()
        worlds = {}; ordinary = 0; rejected = 0
        # Admit the observed choice first; suit-equivalent alternatives in the
        # same physical world must not multiply that row's effective evidence.
        for identity in sorted(selected, key=lambda k: (not k.startswith('train:'), k)):
            game = selected[identity]
            cohorts = ordinary_cohorts(identity,game) if identity.startswith('train:') else [game]
            for cohort in cohorts:
                kind = cohort.get('evidenceKind', 'legacy-counterfactual')
                expected = {'ordinary': 1, 'rejected': 14, 'legacy-counterfactual': 15}.get(kind)
                if cohort['model'] not in ('29.0','29.1','29.2') or len(cohort['outcomes']) != expected:
                    raise ValueError('invalid counterfactual cohort')
                world = (cohort['sourceGame'],cohort['hand'],cohort['actor']) if kind != 'legacy-counterfactual' else (identity,)
                world_keys = worlds.setdefault(world,set())
                for row in cohort['outcomes']:
                    scores=row['scores']
                    if len(scores)!=2 or any(type(s)is not int or not 0<=s<=121 for s in scores) or scores==[121,121]:
                        raise ValueError('invalid terminal hand outcome')
                    if row['key'] in world_keys:
                        continue
                    world_keys.add(row['key'])
                    if old['model']=='29.2':
                        if not row.get('scoring'):row=dict(row,scoring=scoring_inputs(cohort).get(row['key']))
                        forecast292.add(data,cohort,row,scoring_worlds)
                    elif shared:
                        changed_rows.add(forecast291.add(data,cohort,row,board_cache))
                    else:
                        data['rows'].setdefault(row['key'],[]).append(scores)
                ordinary += int(kind == 'ordinary')
                rejected += len(cohort['outcomes']) if kind != 'ordinary' else 0
        if shared: forecast291.finish(data,changed_rows)
        if old['model']=='29.2':
            details.update(forecast292.finish(data,scoring_worlds))
            forecast292.write(dst/name,data)
        else:atomic(dst/name,data)
        details.update(contextKeepRows=len(data['rows']),sampledHands=ordinary+rejected,
            ordinaryHands=ordinary,rejectedDiscardRollouts=rejected,sourceWorlds=len(worlds),
            forecastRepresentation='joint pegging points by exact hand and learned board region' if old['model']=='29.2' else 'exact-hand tempo correction' if shared else 'exact-board outcomes',
            interpretation='scoring distributions before WP; 32 legacy prior samples; exact cards; censored lower-bound likelihood' if old['model']=='29.2' else 'exact-hand opponent-tempo WP corrections; source-board targets; no similar-hand pooling' if shared else 'exact-context terminal hand outcomes')
    phase_state['applied'] = sorted(seen|selected.keys())
    atomic(dst/'model29-state.json',state)
    evidence = dict(phase=phase,games=len(games),hands=len(hands),priorEffectiveSamples=mass,
                    identities=sorted(selected),**details)
    fingerprint = seal(target,old['generation']+1,sha(src/'model29-generation.json'),evidence,old['policy'],old['model'])
    new = verify(target)
    changed = [name for name in (*FILES.values(),FORECAST,forecast291.FILE,forecast292.FILE) if old['assets'].get(name) != new['assets'].get(name)]
    expected_name = ({'29.2':forecast292.FILE,'29.1':forecast291.FILE}.get(old['model'],FORECAST)) if phase == 'forecast' else FILES[phase]
    if any(name != expected_name for name in changed):
        raise ValueError('non-target prior changed')
    return dict(snapshot=fingerprint,changed=changed,**evidence)
