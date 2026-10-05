import itertools
import json
import math
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import benchmark_workbench as workbench
from benchmark_workbench_stats import PairedRatio, Z95, confidence_sequence, log_capital, metric_histories, paired_history
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
        jobs = workbench.list_jobs(self.root / 'runtime', self.root / 'supervisors')
        self.assertEqual(jobs[0]['candidate'], 'A')
        self.assertEqual(self.report()['saved'], 0)
        self.assertEqual(self.report()['remainingSeconds'], 100)

    def test_discovery_finds_new_supervisors_without_registration_or_writes(self):
        supervisors = self.root / 'supervisors'
        for identifier in ('paired-test', 'another-run'):
            directory = supervisors / identifier
            directory.mkdir(parents=True)
            spec = {**self.spec, 'jobId': identifier}
            (directory / 'job.json').write_text(json.dumps(spec))
        before = sorted(p.name for p in (self.root / 'runtime/jobs').iterdir())
        jobs = workbench.list_jobs(self.root / 'runtime', supervisors)
        self.assertEqual({j['id'] for j in jobs}, {'paired-test', 'another-run'})
        self.assertEqual(len(jobs), 2)  # Registered and discovered copies deduplicate.
        self.assertEqual(before, sorted(p.name for p in (self.root / 'runtime/jobs').iterdir()))
        (supervisors / 'another-run/job.json').write_text('invalid JSON')
        self.assertEqual(len(workbench.list_jobs(self.root / 'runtime', supervisors)), 1)

    def test_archive_checks_do_not_replace_the_live_database_root(self):
        self.spec['stages'].append({'name': 'sync', 'completionChecks': [
            {'table': 'compact_games', 'path': str(self.root / 'archive' / label / 'games.db')}
            for label in ('left', 'right')]})
        self.assertEqual(workbench.benchmark_root(self.spec), self.root)
        self.spec['stages'][0]['completionChecks'][1]['path'] = str(self.root / 'different/right/games.db')
        self.assertIsNone(workbench.benchmark_root(self.spec))

    def test_missing_status_is_not_a_pending_active_job(self):
        (self.root / 'status.json').unlink()
        jobs = workbench.list_jobs(self.root / 'runtime', self.root / 'supervisors')
        self.assertEqual(jobs[0]['state'], 'unavailable')
        self.assertEqual(self.report()['state'], 'unavailable')

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
        server.metric_cache = {}
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


class WorkbenchAccessTests(unittest.TestCase):
    def test_host_guard_accepts_configured_lan_name_and_rejects_rebinding(self):
        handler = object.__new__(workbench.Handler)
        handler.server = SimpleNamespace(allowed_hosts={
            '127.0.0.1:8766', 'localhost:8766', 'test-mac.local:8766'})
        handler.path = '/health'
        for host in ('127.0.0.1:8766', 'localhost:8766', 'Test-Mac.local:8766'):
            handler.headers = {'Host': host}
            handler.respond = mock.Mock()
            handler.do_GET()
            self.assertEqual(handler.respond.call_args.args[0]['service'], 'cribbage-benchmark-workbench')
        for host in ('evil.example:8766', 'test-mac.local.evil.example:8766',
                     'test-mac.local:8767', 'test-mac.local:8766@evil.example', ''):
            handler.headers = {'Host': host}
            handler.respond = mock.Mock()
            handler.do_GET()
            self.assertEqual(handler.respond.call_args.args[1], 403)

    def test_lan_is_enabled_only_with_a_valid_bonjour_name(self):
        for arguments, address, name in [([], '127.0.0.1', None),
                                         (['--lan-hostname', 'test-mac.local'], '0.0.0.0', 'test-mac.local')]:
            with mock.patch.object(sys, 'argv', ['workbench', 'serve', *arguments]), \
                 mock.patch.object(workbench.os, 'nice'), mock.patch.object(workbench, 'WorkbenchServer') as server:
                workbench.main()
                server.assert_called_once_with((address, 8766), lan_hostname=name)
        with mock.patch.object(sys, 'argv', ['workbench', 'serve', '--lan-hostname', 'evil.example']), \
             mock.patch.object(workbench.os, 'nice'), mock.patch('sys.stderr'), \
             mock.patch.object(workbench, 'WorkbenchServer') as server:
            with self.assertRaises(SystemExit):
                workbench.main()
            server.assert_not_called()


class MetricIntervalTests(unittest.TestCase):
    def test_signed_wp_intervals_preserve_negative_means_and_full_difference_domain(self):
        for sign in (1, -1):
            pairs = []
            for miss in (.8, 1):
                samples = [[sign * miss, 1], [-sign * miss, 1]]
                left = dict(final_left_score=121, final_right_score=100,
                            metrics={'wp_pegging_pone': samples})
                right = dict(final_left_score=100, final_right_score=121,
                             metrics={'wp_pegging_pone': samples[::-1]})
                pairs.append((left, right))
            result = metric_histories(pairs)['wp_pegging_pone'][-1]
            self.assertAlmostEqual(result['candidate'], sign * .9)
            self.assertAlmostEqual(result['opponent'], -sign * .9)
            self.assertAlmostEqual(result['delta'], sign * 1.8)
            negative = result['opponent95' if sign == 1 else 'candidate95']
            positive = result['candidate95' if sign == 1 else 'opponent95']
            self.assertEqual(negative[0], -1)
            self.assertLess(negative[1], 0)
            self.assertGreater(positive[0], 0)
            self.assertEqual(positive[1], 1)
            if sign == 1:
                self.assertGreater(result['fixed95'][0], 1)
                self.assertEqual(result['fixed95'][1], 2)
            else:
                self.assertEqual(result['fixed95'][0], -2)
                self.assertLess(result['fixed95'][1], -1)

    def test_pooled_miss_equals_observed_minus_predicted_with_cancellation(self):
        accumulator = PairedRatio()
        accumulator.add([.75, 1, .25, 1], [-.5, 2, .5, 0])
        accumulator.add([-1.5, 2, 1.5, 0], [.75, 1, .25, 1])
        result = accumulator.snapshot(2)
        for side in ('candidate', 'opponent'):
            self.assertAlmostEqual(result[side], result[side + 'Actual'] - result[side + 'Predicted'])
        self.assertAlmostEqual(result['candidate'], -.25)
        self.assertAlmostEqual(result['opponent'], .25 / 3)

    def test_matches_paired_mean_interval_and_preserves_covariance(self):
        accumulator = PairedRatio()
        differences = [2, -1, 3, 0]
        for base, delta in zip((10, 20, 30, 40), differences):
            accumulator.add([base + delta, 1], [base, 1])
        result = accumulator.snapshot(4)
        expected_error = Z95 * math.sqrt(sum((d - 1) ** 2 for d in differences) / 3 / 4)
        self.assertEqual(result['delta'], 1)
        self.assertAlmostEqual(result['fixed95'][0], 1 - expected_error)
        self.assertAlmostEqual(result['fixed95'][1], 1 + expected_error)

    def test_repeating_correlated_calls_does_not_invent_independent_samples(self):
        first, repeated = PairedRatio(), PairedRatio()
        samples = [([2, 1], [6, 2]), ([21, 3], [5, 1]), ([6, 2], [8, 4])]
        for a, b in samples:
            first.add(a, b)
            repeated.add([v * 100 for v in a], [v * 100 for v in b])
        x, y = first.snapshot(3), repeated.snapshot(3)
        self.assertAlmostEqual(x['candidate'], 29 / 6)
        self.assertAlmostEqual(x['opponent'], 19 / 7)
        self.assertEqual(y['clusters'], 3)
        self.assertEqual(y['candidateN'], 600)
        for key in ('candidate95', 'opponent95', 'fixed95'):
            for left, right in zip(x[key], y[key]):
                self.assertAlmostEqual(left, right)

    def test_single_cluster_and_missing_samples_do_not_get_a_confidence_band(self):
        accumulator = PairedRatio()
        self.assertIsNone(accumulator.snapshot(0))
        accumulator.add([100, 100], [200, 100])
        result = accumulator.snapshot(1)
        self.assertIsNone(result['fixed95'])
        self.assertIsNone(result['candidate95'])
        accumulator.add([0, 0], [0, 0])
        self.assertEqual(accumulator.snapshot(2)['clusters'], 1)

    def test_shared_fluctuations_cancel_in_difference(self):
        accumulator = PairedRatio()
        for value in (10, 40, 90):
            accumulator.add([value, 1], [value, 1])
        result = accumulator.snapshot(3)
        self.assertAlmostEqual(result['fixed95'][0], 0)
        self.assertAlmostEqual(result['fixed95'][1], 0)
        self.assertLess(result['candidate95'][0], result['candidate95'][1])

    def test_missing_opponent_does_not_hide_measured_candidate(self):
        accumulator = PairedRatio()
        accumulator.add([2, 1], [0, 0])
        accumulator.add([4, 1], [0, 0])
        result = accumulator.snapshot(2)
        self.assertEqual(result['candidate'], 3)
        self.assertEqual(result['candidateN'], 2)
        self.assertIsNotNone(result['candidate95'])
        self.assertIsNone(result['opponent'])
        self.assertIsNone(result['opponent95'])
        self.assertIsNone(result['delta'])
        self.assertIsNone(result['fixed95'])

    def test_each_model_needs_two_contributing_pairs_for_its_interval(self):
        accumulator = PairedRatio()
        accumulator.add([2, 1], [0, 0])
        accumulator.add([0, 0], [3, 1])
        result = accumulator.snapshot(2)
        self.assertEqual(result['delta'], -1)
        for key in ('candidate95', 'opponent95', 'fixed95'):
            self.assertIsNone(result[key])
        accumulator.add([4, 1], [0, 0])
        result = accumulator.snapshot(3)
        self.assertIsNotNone(result['candidate95'])
        self.assertIsNone(result['opponent95'])
        self.assertIsNone(result['fixed95'])
        accumulator.add([0, 0], [5, 1])
        self.assertIsNotNone(accumulator.snapshot(4)['fixed95'])

    def test_score_history_matches_original_graph_and_reverses_seats(self):
        pairs = []
        for i in range(7):
            left = dict(winner=i % 2, final_left_score=121, final_right_score=80 + i,
                        metrics={'pone_open': [[10, 2], [21, 3]]})
            right = dict(winner=(i + 1) % 2, final_left_score=100 + i, final_right_score=121,
                         metrics={'pone_open': [[14, 2], [5, 1]]})
            pairs.append((left, right))
        old, new = paired_history(pairs), metric_histories(pairs)
        for before, after in zip(old, new['final_score']):
            self.assertAlmostEqual(before['scoreDelta'], after['delta'])
            if before['score95']:
                for a, b in zip(before['score95'], after['fixed95']):
                    self.assertAlmostEqual(a, b)
        latest = new['pone_open'][-1]
        self.assertEqual((latest['candidate'], latest['opponent']), (5, 7))
        self.assertEqual((latest['candidateN'], latest['opponentN']), (21, 35))


class MetricTelemetryTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          CREATE TABLE compact_hands (game_id TEXT, hand_number INTEGER, dealer INTEGER,
            left_pegging_points INTEGER, right_pegging_points INTEGER,
            left_hand_points INTEGER, right_hand_points INTEGER, crib_points INTEGER,
            PRIMARY KEY (game_id, hand_number));
          CREATE TABLE compact_discards (game_id TEXT, player INTEGER, role INTEGER,
            model TEXT, selected_win_probability REAL);
          CREATE TABLE compact_peg_plays (game_id TEXT, hand_number INTEGER, sequence INTEGER,
            player INTEGER, role INTEGER, model TEXT, action INTEGER, legal_count INTEGER,
            selected_win_probability REAL, decision_elapsed_us INTEGER,
            PRIMARY KEY (game_id, hand_number, sequence));
        ''')

    def game(self, identifier='g'):
        return dict(game_id=identifier, game_index=0, left_engine='A', right_engine='B', winner=0)

    def peg(self, hand, sequence, player, role, model, elapsed, prediction=.75, legal=2, action=0):
        self.db.execute('INSERT INTO compact_peg_plays VALUES (?,?,?,?,?,?,?,?,?,?)',
                        ('g', hand, sequence, player, role, model, action, legal, prediction, elapsed))

    def test_scoring_roles_partial_hands_and_missing_phases(self):
        self.db.execute("INSERT INTO compact_hands VALUES ('g',0,1,4,6,8,10,12)")
        self.db.execute("INSERT INTO compact_hands VALUES ('g',1,0,2,3,0,0,0)")
        game = self.game()
        workbench.game_metrics(self.db, [game], {})
        metrics = game['metrics']
        self.assertEqual(metrics['peg_pone'][0][:2], [4, 1])
        self.assertEqual(metrics['peg_pone'][1][:2], [3, 1])
        self.assertEqual(metrics['hand_dealer'][0][:2], [0, 1])
        self.assertEqual(metrics['crib'][1][:2], [12, 1])

    def test_first_card_excludes_forced_and_missing_openings_not_later_decisions(self):
        self.peg(0, 0, 0, 0, 'A', None, prediction=None, legal=1)
        self.peg(0, 2, 0, 0, 'A', 9000000)
        self.peg(1, 0, 0, 0, None, None, prediction=None, legal=1)
        self.peg(1, 2, 0, 0, 'A', 8000000)
        self.peg(2, 0, 0, 0, 'A', 3000000)
        self.peg(2, 2, 0, 0, 'A', 7000000)
        self.peg(3, 0, 0, 1, 'A', 99000000)  # Dealer is not pone.
        self.peg(4, 0, 0, 0, 'A', 0)  # A measured zero is a valid sample.
        self.peg(5, 0, 0, 0, 'A', 1000, legal=1)  # Forced, even if legacy data times it.
        self.peg(5, 2, 0, 0, 'A', 20000000)
        game = self.game()
        workbench.game_metrics(self.db, [game], {})
        self.assertEqual(game['metrics']['pone_open'][0][:2], [3, 2])

    def test_wp_uses_actor_outcome_and_excludes_forced_actions_and_missing_predictions(self):
        self.peg(0, 0, 0, 0, 'A', 1000, prediction=.75)
        self.peg(0, 1, 1, 1, 'B', 1000, prediction=.25)
        self.peg(0, 2, 0, 0, 'A', None, prediction=.5, legal=1)
        self.peg(0, 3, 0, 0, 'A', None, prediction=.5, action=1)
        self.peg(0, 4, 0, 0, 'A', None, prediction=None)
        self.db.execute("INSERT INTO compact_discards VALUES ('g',1,0,'B',.2)")
        game = self.game()
        workbench.game_metrics(self.db, [game], {})
        self.assertEqual(game['metrics']['wp_pegging_pone'][0], [.25, 1, .75, 1])
        self.assertEqual(game['metrics']['wp_pegging_dealer'][1], [-.25, 1, .25, 0])
        self.assertAlmostEqual(game['metrics']['wp_discard_pone'][1][0], -.2)

    def test_cache_reads_only_new_games_and_invalidates_changed_metadata(self):
        self.peg(0, 0, 0, 0, 'A', 3000000)
        cache = {}
        workbench.game_metrics(self.db, [self.game()], cache)
        queries = []
        self.db.set_trace_callback(queries.append)
        game = self.game()
        workbench.game_metrics(self.db, [game], cache)
        self.assertFalse(any(q.startswith('SELECT') for q in queries))
        self.assertEqual(game['metrics']['pone_open'][0][:2], [3, 1])
        queries.clear()
        workbench.game_metrics(self.db, [self.game(), self.game('new')], cache)
        selects = [q for q in queries if q.startswith('SELECT')]
        self.assertTrue(selects)
        self.assertTrue(all("IN ('new')" in q for q in selects))
        game = self.game()
        game['winner'] = 1
        workbench.game_metrics(self.db, [game], cache)
        self.assertEqual(game['metrics']['wp_pegging_pone'][0][0], -.75)
        self.assertNotIn('new', cache)

    def test_negative_timing_is_still_rejected(self):
        self.peg(0, 0, 0, 0, 'A', -1000)
        with self.assertRaisesRegex(ValueError, 'Invalid pone_open telemetry'):
            workbench.game_metrics(self.db, [self.game()], {})

    def test_missing_schema_has_no_samples_and_mismatched_models_fail_closed(self):
        self.db.execute('DROP TABLE compact_discards')
        self.db.execute('DROP TABLE compact_hands')
        game = self.game()
        workbench.game_metrics(self.db, [game], {})
        self.assertEqual(game['metrics']['crib'][0][:2], [0, 0])
        self.peg(0, 0, 0, 0, 'unexpected', 1000)
        with self.assertRaisesRegex(ValueError, 'engine mismatch'):
            workbench.game_metrics(self.db, [self.game()], {})


if __name__ == '__main__':
    unittest.main()
