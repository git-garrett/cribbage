import itertools
import json
import math
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import benchmark_workbench as workbench
from benchmark_workbench_stats import confidence_sequence, log_capital, paired_history
import cribbage_job_queue as queue


class ConfidenceSequenceTests(unittest.TestCase):
    def test_empty_extreme_and_symmetric_outcomes(self):
        self.assertEqual(confidence_sequence([0, 0, 0]), [0, 1])
        a = confidence_sequence([27, 409, 51])
        b = confidence_sequence([51, 409, 27])
        self.assertAlmostEqual(a[0], 1 - b[1], places=10)
        self.assertAlmostEqual(a[1], 1 - b[0], places=10)
        self.assertLess(a[0], .5)  # Ordinary interval excludes .5 at this snapshot.
        self.assertEqual(confidence_sequence([0, 0, 1000])[1], 1)
        self.assertEqual(confidence_sequence([1000, 0, 0])[0], 0)

    def test_inverted_endpoints_have_the_prespecified_capital(self):
        counts = [200, 700, 300]
        low, high = confidence_sequence(counts)
        self.assertAlmostEqual(log_capital(counts, low, 1), math.log(40), places=8)
        self.assertAlmostEqual(log_capital(counts, high, -1), math.log(40), places=8)

    def test_mixture_capital_has_unit_expectation_under_the_null(self):
        # Exact enumeration, not a stochastic test: E[K_t(mu)] = 1.
        probabilities = (.1, .6, .3)
        mean = .6
        for direction in (1, -1):
            expectation = 0
            for outcomes in itertools.product(range(3), repeat=6):
                counts = [outcomes.count(i) for i in range(3)]
                probability = math.prod(probabilities[i] for i in outcomes)
                expectation += probability * math.exp(log_capital(counts, mean, direction))
            self.assertAlmostEqual(expectation, 1, places=12)

    def test_repeated_looks_control_total_false_positives(self):
        # Exact dynamic program over all Bernoulli(.5) paths through 200 looks.
        # Absorb a path the FIRST time either tail rejects: this tests peeking.
        alive = {0: 1.0}
        rejected = 0.0
        for n in range(1, 201):
            next_alive = {}
            for wins, probability in alive.items():
                for new_wins in (wins, wins + 1):
                    counts = [n - new_wins, 0, new_wins]
                    if max(log_capital(counts, .5, d) for d in (1, -1)) >= math.log(40):
                        rejected += probability / 2
                    else:
                        next_alive[new_wins] = next_alive.get(new_wins, 0) + probability / 2
            alive = next_alive
        self.assertGreater(rejected, 0)
        self.assertLessEqual(rejected, .05)
        self.assertAlmostEqual(sum(alive.values()) + rejected, 1)


class WorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.spec_path = self.root / 'job.json'
        self.root.joinpath('manifest.txt').write_text(
            'candidate=A\nopponent=B\ncandidateLeft=left\nopponentLeft=right\n'
            'gamesPerOrientation=100\nseed=10\ncandidateLeftRunId=L\nopponentLeftRunId=R\n')
        self.spec = {'schemaVersion': 1, 'jobId': 'paired-test', 'jobRoot': str(self.root),
                     'stages': [{'name': 'benchmark', 'command': ['/usr/bin/true'], 'completionChecks': [
                         {'type': 'sqlite_count', 'table': 'compact_games', 'path': str(self.root / label / 'games.db'), 'equals': 100}
                         for label in ('left', 'right')]}]}
        self.spec_path.write_text(json.dumps(self.spec))
        self.root.joinpath('status.json').write_text(json.dumps({'state': 'running', 'stages': [{'name': 'benchmark', 'state': 'running'}]}))
        for side, label in enumerate(('left', 'right')):
            directory = self.root / label
            directory.mkdir()
            with sqlite3.connect(directory / 'games.db') as db:
                db.execute('CREATE TABLE compact_games (run_id TEXT, game_index INTEGER, random_seed TEXT, left_engine TEXT, right_engine TEXT, winner INTEGER, final_left_score INTEGER, final_right_score INTEGER, started_at TEXT, ended_at TEXT, included_in_tables INTEGER)')
            directory.joinpath('status.json').write_text(json.dumps({'status': 'running', 'runId': ('L', 'R')[side], 'updatedAt': '2026-10-01T00:00:00Z', 'gamesPerSecond': 1, 'workers': 3}))
        self.entry = workbench.register(self.spec_path, self.root / 'runtime')

    def add_game(self, label, index, winner=0, seed=None, run_id=None, engines=None):
        left = label == 'left'
        with sqlite3.connect(self.root / label / 'games.db') as db:
            db.execute('INSERT INTO compact_games VALUES (?,?,?,?,?,?,?,?,?,?,?)', (
                run_id or ('L' if left else 'R'), index, str(index + 10 if seed is None else seed),
                *(engines or (('A', 'B') if left else ('B', 'A'))), winner, 121, 100,
                '2026-09-30T23:59:00Z', '2026-10-01T00:00:00Z', 1))

    def report(self):
        return workbench.build_report(self.entry, now=workbench.timestamp('2026-10-01T00:00:01Z'))

    def test_registration_and_live_status(self):
        self.assertEqual(self.entry['root'], str(self.root))
        jobs = workbench.list_jobs(self.root / 'runtime')
        self.assertEqual(jobs[0]['candidate'], 'A')
        self.assertEqual(self.report()['saved'], 0)
        self.assertEqual(self.report()['remainingSeconds'], 100)

    def test_out_of_order_pairs_do_not_enter_inference_until_gap_fills(self):
        for label in ('left', 'right'):
            self.add_game(label, 0)
            self.add_game(label, 2, 1)
        result = self.report()
        self.assertEqual(result['matchedPairs'], 2)
        self.assertEqual(result['orderedPairs'], 1)
        self.assertEqual(result['pendingPairs'], 1)
        self.add_game('left', 1, 0)
        self.add_game('right', 1, 1)
        result = self.report()
        self.assertEqual(result['orderedPairs'], 3)
        self.assertEqual(result['latest']['winRate'], 2 / 3)
        self.assertEqual(result['latest']['candidateSweeps'], 1)
        self.assertEqual(result['latest']['splits'], 2)
        self.assertEqual(result['pendingPairs'], 0)

    def test_seed_engine_and_duplicate_integrity_fail_closed(self):
        self.add_game('left', 0)
        self.add_game('right', 0, seed=900)
        with self.assertRaisesRegex(ValueError, '[Ss]eed mismatch'):
            self.report()
        with sqlite3.connect(self.root / 'right/games.db') as db:
            db.execute("UPDATE compact_games SET random_seed='10', left_engine='unexpected'")
        with self.assertRaisesRegex(ValueError, 'Engine mismatch'):
            self.report()
        with sqlite3.connect(self.root / 'right/games.db') as db:
            db.execute("UPDATE compact_games SET left_engine='B'")
        self.add_game('right', 0)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.report()

    def test_other_runs_are_excluded_and_read_does_not_mutate_database(self):
        self.add_game('left', 0)
        self.add_game('left', 0, run_id='OTHER')
        before = (self.root / 'left/games.db').read_bytes()
        self.assertEqual(self.report()['saved'], 1)
        self.assertEqual(before, (self.root / 'left/games.db').read_bytes())

    def test_legacy_baseline_manifest_infers_orientation_from_saved_engines(self):
        path = self.root / 'manifest.txt'
        path.write_text('candidate=A\nbaseline=B\ngamesPerOrientation=100\nseed=10\n')
        self.add_game('left', 0, 0)
        self.add_game('right', 0, 1)
        report = self.report()
        self.assertEqual(report['opponent'], 'B')
        self.assertEqual(report['orderedPairs'], 1)
        self.assertEqual([row['label'] for row in report['orientations']], ['left', 'right'])
        self.assertNotIn('candidateLeft', path.read_text())

    def test_stopped_supervisor_overrides_stale_running_status(self):
        self.root.joinpath('status.json').write_text('{"state":"stopped"}')
        report = self.report()
        self.assertEqual(report['state'], 'stopped')
        self.assertIsNone(report['remainingSeconds'])
        self.assertEqual(report['orientations'][0]['state'], 'stopped')

    def test_stale_status_disables_eta(self):
        report = workbench.build_report(self.entry, now=workbench.timestamp('2026-10-02T00:00:00Z'))
        self.assertIsNone(report['remainingSeconds'])
        self.assertEqual(len(report['warnings']), 2)

    def test_manifest_can_be_created_after_registration(self):
        self.root.joinpath('manifest.txt').unlink()
        self.assertIn('waiting', self.report())

    def test_repeated_clients_share_cached_computation(self):
        # No listener needed to test the observer's shared request path.
        server = object.__new__(workbench.WorkbenchServer)
        server.cache = {}
        server.cache_lock = workbench.threading.Lock()
        with mock.patch.object(workbench, 'build_report', return_value={'saved': 1}) as build:
            self.assertEqual(server.report(self.entry), server.report(self.entry))
        build.assert_called_once()

    def test_unrelated_jobs_do_not_open_workbench(self):
        self.spec['stages'][0]['completionChecks'] = []
        with mock.patch.object(queue.subprocess, 'run') as run:
            queue.start_workbench(self.spec, self.spec_path)
            run.assert_not_called()

    def test_observer_failure_cannot_fail_the_benchmark(self):
        failed = mock.Mock(returncode=1, stdout='', stderr='port occupied')
        with mock.patch.object(queue.subprocess, 'run', return_value=failed) as run, mock.patch('sys.stderr'):
            queue.start_workbench(self.spec, self.spec_path)
            self.assertEqual(run.call_args.args[0][2], 'workbench-start')


if __name__ == '__main__':
    unittest.main()
