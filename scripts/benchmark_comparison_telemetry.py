"""Calibration and timing with the standard analyze-ai-run.cjs conventions."""
from collections import defaultdict
import math


def telemetry_report(games, hand_scores):
    ev, wp, bins, timing = (defaultdict(list) for _ in range(4))
    excluded = dict(discardFinalHand=0, pegFinalHand=0, pegForcedPlay=0,
                    pegLegacyImmediate=0, pegUnknownEvKind=0)
    recorded = 0
    recorders = set()
    for game in games:
        data = game.get('benchmark')
        if data is None:
            continue
        if data.get('schemaVersion') != 1:
            raise ValueError('Unsupported comparison telemetry')
        recorded += 1
        if data.get('recorderSha256'): recorders.add(data['recorderSha256'])
        hands = {h['number']: h for h in game['hands']}
        final = max(hands)
        played = [h for h in hands.values() if all(len(k) == 4 for k in h['keeps'])]
        expected_discards = {(h['number'], s) for h in played for s in (0, 1)}
        if len(data['discards']) != len(expected_discards) or {(d['hand'], d['actor']) for d in data['discards']} != expected_discards:
            raise ValueError('Missing or duplicate discard telemetry')
        grouped = defaultdict(list)
        for p in data['plays']: grouped[p['hand']].append(p)
        if set(grouped)-set(hands): raise ValueError('Unknown telemetry hand')
        for number, h in hands.items():
            rows = grouped[number]
            if len(rows) != len(h['plays']) or len({p['sequence'] for p in rows}) != len(rows):
                raise ValueError('Missing or duplicate pegging telemetry')
            if rows != sorted(rows, key=lambda p:p['sequence']): raise ValueError('Unordered pegging telemetry')
            for p, original in zip(rows, h['plays']):
                if any(p[k] != original[k] for k in ('actor','action','card','before','after','points','scores')):
                    raise ValueError('Pegging telemetry differs from saved game')

        def identity(row):
            actor = row['actor']; h = hands[row['hand']]
            if actor not in (0,1): raise ValueError('Invalid telemetry actor')
            role = 'dealer' if actor == h['dealer'] else 'pone'
            candidate = actor == game['candidateSide']
            model = 'schell_table-peg_table-29.0' if candidate else 'schell_table-peg_table-28.3'
            if row['role'] != role or row['model'] != model:
                raise ValueError('Telemetry model or role mismatch')
            for field in ('ev','wp','micros'):
                v = row[field]
                if v is not None and (not isinstance(v,(int,float)) or not math.isfinite(v)):
                    raise ValueError('Nonfinite telemetry value')
            if row['micros'] is not None and row['micros'] < 0: raise ValueError('Negative decision duration')
            return role, 'current' if candidate else 'original'

        def probability(kind, row, key):
            if row['wp'] is None: return
            p = min(1., max(0., row['wp'])); actual = int(game['winner'] == row['actor'])
            wp[(kind,*key)].append((p,actual))
            b = min(9, int(p*10)); bins[(kind,*key,f'{b/10:.1f}-{(b+1)/10:.1f}')].append((p,actual))

        for d in data['discards']:
            key = identity(d)
            if d['micros'] is not None: timing[('discard',*key)].append(d['micros'])
            probability('discard',d,key)
            if d['ev'] is None: continue
            if d['hand'] == final:
                excluded['discardFinalHand'] += 1; continue
            h = hands[d['hand']]; endpoint = game['hands'][game['hands'].index(h)+1]['start']
            real,_ = hand_scores(h,endpoint); s = d['actor']; dealer = h['dealer']
            own_peg = real[s]['Peg dealer' if s == dealer else 'Peg pone']
            other_peg = real[1-s]['Peg dealer' if 1-s == dealer else 'Peg pone']
            own_hand = real[s]['Hand dealer' if s == dealer else 'Hand pone']
            realized = own_hand + own_peg-other_peg + (1 if s == dealer else -1)*real[dealer]['Crib']
            ev[('discard_total',*key)].append((d['ev'],realized))

        for number, rows in grouped.items():
            # Match canonical future-net EV: card points plus Go/last-card
            # awards at reset/end. Heels precede pegging decisions.
            awards = []; last = None; count = 0
            for p in rows:
                if p['action'] == 0:
                    if p['points']: awards.append((p['sequence'],p['actor'],p['points']))
                    last = p['actor']; count = p['after']
                elif p['action'] == 1: count = p['after']
                elif p['action'] == 2:
                    if last is not None and count not in (0,31): awards.append((p['sequence'],last,1))
                    last = None; count = 0
            if last is not None and count not in (0,31): awards.append((rows[-1]['sequence']+1,last,1))
            by_actor = defaultdict(list)
            for p in rows:
                if p['actor'] is None: continue
                key = identity(p); by_actor[p['actor']].append(p)
                if p['action'] != 0: continue
                if p['legalCount'] > 1: probability('pegging',p,key)
                if p['ev'] is None: continue
                if p['legalCount'] == 1: excluded['pegForcedPlay'] += 1; continue
                if p['evKind'] != 'future_net': excluded['pegUnknownEvKind'] += 1; continue
                if number == final: excluded['pegFinalHand'] += 1; continue
                realized = sum(points*(1 if actor == p['actor'] else -1)
                               for seq,actor,points in awards if seq >= p['sequence'])
                ev[('peg_future',*key)].append((p['ev'],realized))
            for rows in by_actor.values():
                key = identity(rows[0])
                opening = next((p for p in rows if p['action'] == 0),None)
                if opening is not None and opening['micros'] is not None:
                    timing[('peg_opening',*key)].append(opening['micros'])
                if all(p['micros'] is not None or p['legalCount'] in (0,1) for p in rows):
                    timing[('peg_hand',*key)].append(sum(p['micros'] or 0 for p in rows))

    def summarize(groups, probability=False):
        rows = []
        for key, values in sorted(groups.items()):
            n = len(values); predicted = sum(p for p,a in values)/n; actual = sum(a for p,a in values)/n
            row = dict(kind=key[0],role=key[1],model=key[2],rows=n,meanAbsError=sum(abs(a-p) for p,a in values)/n)
            if probability:
                row.update(avgPredicted=predicted,actualWinRate=actual,miss=actual-predicted,brier=sum((a-p)**2 for p,a in values)/n)
                if len(key) == 4: row['bucket'] = key[3]
            else: row.update(avgEv=predicted,avgRealized=actual,avgError=actual-predicted)
            rows.append(row)
        return rows
    times = []
    for (kind,role,model), values in sorted(timing.items()):
        values.sort(); n = len(values)
        times.append(dict(kind=kind,role=role,model=model,rows=n,avgMs=sum(values)/n/1000,
            p50Ms=values[math.ceil(n*.5)-1]/1000,p90Ms=values[math.ceil(n*.9)-1]/1000,
            maxMs=values[-1]/1000,totalSeconds=sum(values)/1e6))
    status = 'complete' if recorded == len(games) else 'partial' if recorded else 'not recorded'
    coverage = dict(status=status,recordedGames=recorded,totalGames=len(games))
    missing = 'Not recorded by this run. Saved game outcomes cannot recover decision predictions or computation times.'
    return dict(evCalibration=dict(**coverage,rows=summarize(ev),excluded=excluded,
                    note='Total discard EV and remaining net pegging EV; terminal hands excluded.' if recorded else missing),
                winProbabilityCalibration=dict(**coverage,rows=summarize(wp,True),buckets=summarize(bins,True),
                    note='Predicted probability versus eventual winner, from the acting player’s perspective.' if recorded else missing),
                timing=dict(**coverage,rows=times,note='Model computation only. Opening means each player’s first card; forced openings are excluded. Whole-hand totals include forced actions as zero, across all resets, including terminal partial hands. Missing non-forced totals are excluded.' if recorded else missing),
                telemetry=dict(**coverage,recorderSha256=sorted(recorders)))
