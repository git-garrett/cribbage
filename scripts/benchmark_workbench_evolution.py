"""Cumulative inference for the changing Model 29 policy, never latest-state inference.

Howard et al., https://arxiv.org/pdf/1810.08240, Theorem 4 and eq. (24).
The predictable forecast is always 1/2. Thus V=sum((X-1/2)^2) is one quarter
of the number of sweeps, and X is the current player's win fraction per seed
pair. This empirical-Bernstein confidence sequence allows changing conditional
means and repeated inspection. Do not intersect successive intervals: their
targets change. Constants and the start at the first checkpoint are fixed.
"""
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path

from benchmark_workbench_comparisons import comparison_games, comparison_snapshots


METHOD = 'paired empirical-Bernstein confidence sequence v1'
SOURCE = 'https://arxiv.org/pdf/1810.08240'


def evolving_bounds(counts):
    """Two-sided, time-uniform 95% bounds on the average conditional win rate."""
    losses, splits, wins = counts
    if any(type(n) is not int or n < 0 for n in counts):
        raise ValueError('Invalid reciprocal pair counts')
    n = sum(counts)
    if not n:
        return [0., 1.]
    variance = max(1., (losses+wins)/4)
    loglog = math.log(math.log(2*variance))
    radius = (1.7*math.sqrt(variance*(loglog+3.8)) + 3.4*loglog + 13)/n
    mean = (wins+splits/2)/n
    return [max(0., mean-radius), min(1., mean+radius)]


@lru_cache(maxsize=256)
def checkpoint_evidence(root, checkpoint, receipt_text):
    receipt = json.loads(receipt_text)
    games, digest = comparison_games(Path(root), checkpoint, receipt, include_hands=False)
    manifest, snapshots = comparison_snapshots(receipt, games[0]+games[1])
    counts = [0, 0, 0]
    for a, b in zip(*games):
        counts[int(a['winner'] == 0)+int(b['winner'] == 1)] += 1
    return dict(seeds=[g['seed'] for g in games[0]], counts=counts,
                generation=manifest['generation'], originalSnapshot=snapshots[1],
                candidateSnapshot=snapshots[0], evidenceSha256=digest)


def evolution_report(root):
    root = Path(root).resolve()
    # Use the complete receipt directory, not the UI's rolling 60-checkpoint list.
    receipts = tuple((int(p.stem), p.read_text())
                     for p in sorted((root/'assessments').glob('[0-9]*.json')))
    return _evolution_report(str(root), receipts)


@lru_cache(maxsize=8)
def _evolution_report(root, receipts):
    counts = [0, 0, 0]; seeds = set(); history = []; baseline = None
    digest = hashlib.sha256()
    for epoch, (checkpoint, text) in enumerate(receipts, 1):
        # This experiment contracts one complete 1k-game panel every 5k training
        # games. Never silently omit a checkpoint or reuse a seed as new evidence.
        if checkpoint != epoch*5000:
            raise ValueError('Missing or out-of-order cumulative checkpoint')
        evidence = checkpoint_evidence(root, checkpoint, text)
        if len(evidence['seeds']) != 500:
            raise ValueError('Cumulative checkpoint requires 500 reciprocal seed pairs')
        if seeds.intersection(evidence['seeds']):
            raise ValueError('Repeated evaluation seeds across cumulative checkpoints')
        seeds.update(evidence['seeds'])
        if baseline is not None and evidence['originalSnapshot'] != baseline:
            raise ValueError('Original opponent changed across cumulative checkpoints')
        baseline = evidence['originalSnapshot']
        counts = [a+b for a,b in zip(counts,evidence['counts'])]
        pairs = sum(counts); wins = 2*counts[2]+counts[1]
        bounds = evolving_bounds(counts)
        history.append(dict(trainingGames=checkpoint, generation=evidence['generation'],
            checkpoints=epoch, pairs=pairs, games=2*pairs, wins=wins, winRate=wins/(2*pairs),
            confidence95=bounds, candidateSweeps=counts[2], splits=counts[1], originalSweeps=counts[0],
            status='superior' if bounds[0] > .5 else 'inferior' if bounds[1] < .5 else 'inconclusive'))
        digest.update(json.dumps([checkpoint, text, evidence],sort_keys=True).encode())
    return dict(status='complete' if history else 'pending', method=METHOD, source=SOURCE,
        confidenceLevel=.95, target='Average performance across all evaluated branch states',
        latest=history[-1] if history else None, history=history,
        integrity=dict(status='passed' if history else 'pending', uniqueSeeds=len(seeds),
                       originalSnapshot=baseline, evidenceSha256=digest.hexdigest()),
        notes=['Every completed checkpoint is included from the first; each contributes 500 fresh reciprocal seed pairs.',
               '95% bounds remain valid across repeated inspection and changing performance; better-than-original requires a lower bound above 50%.',
               'The target is average conditional performance under the declared rolling-cache policy. It does not establish latest-state strength, future strength, or monotonic improvement.',
               'Evidence can weaken after poor results. Bounds are not intersected or forced to narrow.',
               'No extra games, changes to training, or automatic promotion.'])
