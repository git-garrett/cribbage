#!/usr/bin/env python3
"""Freeze complete scoring series and their ordered phase boundaries for replay."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys

spec = importlib.util.spec_from_file_location('board_source', Path(__file__).with_name('build-board-win-matrix.py'))
source = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = source
spec.loader.exec_module(source)
APPROVED = {'schell_table-peg_table-' + v for v in ('9.0', '9.0-crib13', '9.0-crib148', '9.1', '9.11')}

class ReadOnlyConnections(source.ConnectionCache):
    def get(self, path):
        if path not in self.connections:
            db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
            db.row_factory = sqlite3.Row
            self.connections[path] = db
        return self.connections[path]

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', action='append', required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--limit-clusters', type=int)
    args = p.parse_args()
    pairs = source.parse_inputs(args.input)
    clusters = source.load_games(pairs)
    connections = ReadOnlyConnections()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    counts = {}; games = 0; unresolved = {s: 0 for s in source.SEAMS}
    with args.output.open('w') as out:
        for i, ((cohort, seed), members) in enumerate(sorted(clusters.items())):
            if args.limit_clusters is not None and i >= args.limit_clusters:
                break
            for game in members:
                identity = connections.get(game.source_db).execute('SELECT left_engine,right_engine,winner FROM compact_games WHERE game_id=?', (game.game_id,)).fetchone()
                if not identity or not set(identity[:2]) <= APPROVED:
                    raise ValueError(f'unapproved learning source {game.game_id}: {identity}')
                events, seams = source.game_trajectory(game, connections)
                # Stable within a hand even when zero-point phases share an offset.
                # Group by hand, not global phase order: adjacent zero-score hands
                # can otherwise put a later discard before an earlier after-pone.
                markers = [(seams[seam][hand][0], phase, seams[seam][hand][1]) for hand in range(len(seams['discard'])) for phase,seam in enumerate(source.SEAMS)]
                if any(a[0] > b[0] for a,b in zip(markers,markers[1:])):
                    raise ValueError('phase order diverges')
                prefix = [[0,0]]
                for actor,points in events:
                    scores = prefix[-1].copy(); scores[actor] += points; prefix.append(scores)
                winner = next(actor for j,(actor,points) in enumerate(events) if prefix[j+1][actor] >= 121)
                if winner != identity[2]:
                    raise ValueError(f'zero-start winner mismatch: {game.game_id}')
                for offset, phase, dealer in markers[:4]:
                    if max(prefix[-1][a] - prefix[offset][a] for a in (0,1)) < 121:
                        unresolved[source.SEAMS[phase]] += 1
                row = dict(cluster=cohort + ':' + seed, cohort=cohort, seed=seed, game=game.game_id, models=list(identity[:2]), originalWinner=winner, events=events, markers=markers)
                out.write(json.dumps(row, separators=(',', ':')) + '\n')
                games += 1; counts[cohort] = counts.get(cohort,0) + 1
            if (i+1)%1000 == 0:
                print(f'exported {games} games in {i+1} clusters', flush=True)
    connections.close()
    report = dict(status='complete', games=games, clusters=min(len(clusters), args.limit_clusters or len(clusters)), cohorts=counts, unresolvedFirstPhaseStarts=unresolved, outputSha256=digest(args.output), inputs=[dict(cohort=p.cohort,source=str(p.source_db),sourceSha256=digest(p.source_db),trajectory=str(p.trajectory_db),trajectorySha256=digest(p.trajectory_db)) for p in pairs])
    args.output.with_suffix('.provenance.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ('status','games','clusters','unresolvedFirstPhaseStarts')}))

if __name__ == '__main__': main()
