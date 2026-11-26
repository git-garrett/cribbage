"""Verify real Ace updates preserve the WP produced by self-play for both families."""
from pathlib import Path
import os
import shutil
import sqlite3
import subprocess
import sys

from hybrid import latest32, publish32, read, save
from selfplay import sha


def run(setup, live):
    setup, live = Path(setup), Path(live)
    source = setup / 'pilot'
    root = setup / 'handoff-pilot'
    root.mkdir(exist_ok=True)
    state = read(source / 'gpu-state.json')
    shutil.copy2(setup / 'payload/hybrid.py', root / 'hybrid.py')
    teacher = root / 'teacher'
    teacher.mkdir(exist_ok=True)
    db_path = teacher / 'labels.sqlite'
    if not db_path.exists():
        with sqlite3.connect((live / 'teacher/labels.sqlite').as_uri() + '?mode=ro', uri=True) as db, sqlite3.connect(db_path) as target:
            target.execute('CREATE TABLE labels (key TEXT, role INTEGER, split INTEGER, payload TEXT)')
            # Keep original row IDs; each trainer reads only a few later rows.
            selected = {}
            for model in [31, 32]:
                for role, cursor in enumerate(state[str(model)]['cursors']):
                    for row in db.execute('SELECT rowid,key,role,split,payload FROM labels WHERE role=? AND split=0 AND rowid>? ORDER BY rowid LIMIT 4', (role, cursor)):
                        selected[row[0]] = row
            target.executemany('INSERT INTO labels(rowid,key,role,split,payload) VALUES(?,?,?,?,?)', selected.values())
    reports = []
    for model in [31, 32]:
        model_root = root / f'model{model}'
        model_root.mkdir(exist_ok=True)
        for name in ['source', 'build', 'cargo-target']:
            src = live / f'model{model}' / name
            if src.exists() and not (model_root / name).exists():
                (model_root / name).symlink_to(src.resolve(), target_is_directory=True)
        cfg_name = 'config.json' if model == 31 else 'campaign-config.json'
        shutil.copy2(live / f'model{model}' / cfg_name, model_root / cfg_name)
        shutil.copy2(setup / 'payload' / f'model{model}_train.py', model_root / 'train.py')
        if model == 31:
            parent = source / 'model31/data' / read(source / 'model31/data/current.json')['folder']
        else:
            parent = latest32(source, state['32']['round'])
        initial = model_root / 'data/input'
        if not initial.exists():
            initial.parent.mkdir(exist_ok=True)
            shutil.copytree(parent, initial, copy_function=os.link)
        number = state[str(model)]['round'] + 1
        if model == 31:
            if not (model_root / 'data/current.json').exists():
                save(model_root / 'data/current.json', dict(round=number-1, folder='input'))
            for name in ['data/heldout-frozen.json', 'baseline-result.json']:
                shutil.copy2(live / 'model31' / name, model_root / name)
            # The copied heldout receipt avoids evaluation; only train rows enter.
            rows = []
            with sqlite3.connect(db_path) as db:
                import json
                for role, cursor in enumerate(state['31']['cursors']):
                    rows += [dict(json.loads(payload), rowId=row_id) for row_id, payload in db.execute(
                        'SELECT rowid,payload FROM labels WHERE role=? AND rowid>? ORDER BY rowid LIMIT 4', (role, cursor))]
            selection = model_root / 'data' / f'labels-{number}.json'
            save(selection, dict(rows=rows))
            save(selection.with_suffix('.sha256.json'), dict(sha256=sha(selection)))
            wp_name = 'wp-state.npz'
        else:
            if not (root / 'hybrid-model32.json').exists():
                publish32(root, number-1, initial, 'self-play')
            cfg = read(live / 'model32/ace-config.json')
            cfg.update(database=str(db_path), labelsPerRole=4)
            save(model_root / 'ace-config.json', cfg)
            baseline = model_root / 'data/model32/baseline'
            baseline.mkdir(parents=True, exist_ok=True)
            for name in ['report.json', 'heldout.json']:
                shutil.copy2(live / 'model32/data/model32/baseline' / name, baseline / name)
            wp_name = 'wp.npz'
        before_wp = sha(initial / wp_name)
        python = read(live / 'checkpoint-config.json')['python']
        subprocess.run([python, str(model_root / 'train.py'), str(model_root), str(number)], check=True)
        if model == 31:
            after = model_root / 'data' / read(model_root / 'data/current.json')['folder']
            cursors = read(after / 'ace-teacher-state.json')['cursor']
        else:
            receipt = read(model_root / f'model32-round-{number}.json')
            after = Path(receipt['checkpoint'])
            cursors = receipt['cursors']
        assert before_wp == sha(after / wp_name), 'Ace ingestion reset or changed the latest self-play WP'
        assert all(a > b for a, b in zip(cursors, state[str(model)]['cursors']))
        reports.append(dict(model=model, status='complete', latestSelfplayWpPreserved=True, aceCursorsAdvanced=True))
    save(setup / 'handoff-pilot.json', dict(status='complete', reports=reports))


if __name__ == '__main__':
    run(Path(sys.argv[1]), Path(sys.argv[2]))
