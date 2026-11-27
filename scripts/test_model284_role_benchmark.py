import sys
import json
import sqlite3
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from model284_role_benchmark_stage import missing_ranges, check_existing_provenance


class ResumeCoverage(unittest.TestCase):
    def test_resume_rejects_old_assets_before_runner_can_relabel_them(self):
        expected = dict(sourceCommit='new-source', runnerSha256='new-binary',
                        segmentedBeliefsManifestSha256='new-beliefs')
        with sqlite3.connect(':memory:') as db:
            db.execute('CREATE TABLE ai_runs (run_id,git_commit,run_seed,metadata_json)')
            db.execute('CREATE TABLE compact_games (run_id,matchup_id)')
            db.execute('INSERT INTO compact_games VALUES (?,?)', ('run', 'matchup'))
            db.execute('INSERT INTO ai_runs VALUES (?,?,?,?)',
                       ('run', 'new-source', '284', json.dumps(expected)))
            check_existing_provenance(db, 'run', 'matchup', 284, expected)
            for key in expected:
                stale = dict(expected, **{key: 'old'})
                db.execute('UPDATE ai_runs SET metadata_json=?', (json.dumps(stale),))
                with self.assertRaises(ValueError):
                    check_existing_provenance(db, 'run', 'matchup', 284, expected)
            db.execute('UPDATE ai_runs SET metadata_json=?', (json.dumps(expected),))
            with self.assertRaises(ValueError):
                check_existing_provenance(db, 'another-run', 'matchup', 284, expected)
            with self.assertRaises(ValueError):
                check_existing_provenance(db, 'run', 'another-matchup', 284, expected)

    def test_out_of_order_commits_preserve_every_completed_index(self):
        self.assertEqual(missing_ranges([5, 0, 2], 6), [[1, 2], [3, 5]])

    def test_complete_and_empty_contracts(self):
        self.assertEqual(missing_ranges([0, 1, 2], 3), [])
        self.assertEqual(missing_ranges([], 3), [[0, 3]])

    def test_refuses_indices_from_another_contract(self):
        for indices in ([-1], [3]):
            with self.assertRaises(ValueError):
                missing_ranges(indices, 3)


if __name__ == '__main__':
    unittest.main()
