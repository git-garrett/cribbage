import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import model284_sequential_stage as s


class PairedSequentialInference(unittest.TestCase):
    def test_no_completed_checkpoint_has_no_evidence(self):
        initial = s.decision([0, 0, 0], 5000)
        self.assertEqual(initial['anytime95'], [0, 1])
        self.assertFalse(initial['finished'])

    def test_pilot_is_not_a_sequential_significance_result(self):
        result = s.decision([41, 423, 48], 5000)
        self.assertLess(result['anytime95'][0], .5)
        self.assertGreater(result['anytime95'][1], .5)
        self.assertFalse(result['finished'])

    def test_clear_win_loss_and_inconclusive_cap(self):
        self.assertEqual(s.decision([0, 0, 100], 5000)['winner'], 'candidate')
        self.assertEqual(s.decision([100, 0, 0], 5000)['winner'], 'opponent')
        cap = s.decision([0, 5000, 0], 5000)
        self.assertTrue(cap['finished'])
        self.assertEqual(cap['reason'], 'game_cap')
        self.assertIsNone(cap['winner'])

    def test_refuses_gapped_unpaired_or_undecided_games(self):
        a = [dict(game_index=0, random_seed='7', winner=0)]
        self.assertEqual(s.outcome_counts(a, a, 1), [0, 1, 0])
        for bad in ([], [dict(a[0], game_index=1)], [dict(a[0], random_seed='8')],
                    [dict(a[0], winner=None)]):
            with self.assertRaises(ValueError):
                s.outcome_counts(a, bad, 1)


class CheckpointLifecycle(unittest.TestCase):
    def test_terminal_look_replays_after_interruption_and_skips_further_games(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cfg = dict(maximumPairs=5000, batchPairs=100, workersPerOrientation=3,
                method=s.METHOD, bets=list(s.BETS), alpha=.05, candidate='C', opponent='O',
                seed=77, engineSourceCommit='source', runnerSha256='runner',
                beliefsManifestSha256='beliefs', jobId='job', orchestratorSourceCommit='orchestrator')
            (root/'experiment.json').write_text(json.dumps(cfg))
            (root/'frozen-inputs.json').write_text('{}')
            for number, label in enumerate(s.LABELS):
                folder = root/'output/benchmark'/label
                folder.mkdir(parents=True)
                left, right = ('C', 'O') if number == 0 else ('O', 'C')
                run_id = 'model284-seq-'+label
                metadata = dict(sourceCommit='source', runnerSha256='runner',
                    segmentedBeliefsManifestSha256='beliefs', left=left, right=right, workers=3)
                with sqlite3.connect(folder/'games.db') as db:
                    db.execute('CREATE TABLE ai_runs (run_id,git_commit,run_seed,metadata_json)')
                    db.execute('INSERT INTO ai_runs VALUES (?,?,?,?)',
                               (run_id, 'source', '77', json.dumps(metadata)))
                    db.execute('CREATE TABLE compact_games (game_index,random_seed,left_engine,right_engine,winner,reproducible,included_in_tables,run_id,matchup_id)')
                    db.executemany('INSERT INTO compact_games VALUES (?,?,?,?,?,?,?,?,?)',
                        [(i, str(77+i), left, right, number, 1, 1, run_id, 'job') for i in range(100)])
            def run(mode):
                with patch.object(sys, 'argv', ['stage', str(root), mode]):
                    s.main()
            run('look-000100')
            latest = root/'output/benchmark/sequential.json'
            before = latest.read_bytes()
            self.assertEqual(json.loads(before)['winner'], 'candidate')
            # Simulate interruption after latest inference but before the step receipt.
            (root/'output/steps/look-000100.json').unlink()
            run('look-000100')
            self.assertEqual(latest.read_bytes(), before)
            with patch.object(s.subprocess, 'run', side_effect=AssertionError('must not launch games')):
                run('games-000200')
                run('look-000200')
            run('verify')
            proof = json.loads((root/'output/verified.json').read_bytes())
            self.assertEqual(proof['games'], 200)
            self.assertEqual(proof['contiguousIndices'], [0, 99])


if __name__ == '__main__':
    unittest.main()
