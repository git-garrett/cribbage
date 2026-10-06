import copy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from import_player_history import apply_report
from report_player_history import ewma, hand_boundaries, loss, summarize, wins_on_play


class HistoryReportTest(unittest.TestCase):
    def test_wp_and_half_life(self):
        self.assertAlmostEqual(ewma([.1] + [.2] * 18, 18), .15)
        cycles = [{'gameId': 'g', 'sample': {'total_regret': .02}}]
        lengths = [{'cyclesPerGame': 5} for _ in range(6)]
        value = summarize(cycles, lengths, [{'complete': True, 'reviewed': 10, 'wp': -.12}])
        self.assertAlmostEqual(value['wpPerGame'], -.1)
        self.assertAlmostEqual(value['meanGameWp'], -.12)

    def test_missing_wp_is_not_a_zero_error(self):
        result = {'review': {'selected': {'cardIds': [0]}, 'recommended': {'cardIds': [1]}}}
        self.assertIsNone(loss({'id': 'x'}, result))
        result['review']['recommended']['cardIds'] = [0]
        self.assertEqual(loss({'id': 'x'}, result), 0)
        result['review']['selected']['winProbability'] = .9
        result['review']['recommended']['winProbability'] = 2
        with self.assertRaisesRegex(ValueError, 'invalid win probability'):
            loss({'id': 'x'}, result)

    def test_only_explicit_crib_score_completes_a_cycle(self):
        events = [dict(type='hand', action='start', handNumber=1),
                  dict(type='score', category='crib', at='2026-01-01T00:00:00Z', handNumber=2),
                  dict(type='hand', action='end', handNumber=2),
                  dict(type='hand', action='start', handNumber=3),
                  dict(type='hand', action='end', handNumber=3)]
        hands, complete, _ = hand_boundaries('legacy', events, None)
        self.assertEqual(hands, 2)
        self.assertEqual(set(complete), {1})

    def test_winning_play_is_excluded_from_cycle_regret(self):
        record = {'fields': {'kind': 'peg', 'plays': [9], 'aiScore': 119}, 'selected': [4]}
        self.assertTrue(wins_on_play(record))
        record['fields']['aiScore'] = 118
        self.assertFalse(wins_on_play(record))


class HistoryImportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'data.sqlite'
        self.backup = Path(self.temp.name) / 'backup.sqlite'
        with sqlite3.connect(self.path) as c:
            c.executescript('''PRAGMA journal_mode=WAL;
              CREATE TABLE auth_users(id INTEGER PRIMARY KEY, username TEXT);
              CREATE TABLE dynamic_player_profiles(user_id INTEGER,evaluator_version TEXT,profile_json TEXT,updated_at TEXT);
              CREATE TABLE cribbage_completed_game_uploads(game_id TEXT,payload_json TEXT);
              CREATE TABLE player_history_reassessments(user_id INTEGER PRIMARY KEY,summary_json TEXT,source_sha256 TEXT,applied_at TEXT);
              CREATE TABLE player_reviewed_games(user_id INTEGER,game_id TEXT PRIMARY KEY,payload_json TEXT);
              CREATE TABLE dynamic_profile_cycles(user_id INTEGER,evaluator_version TEXT,session_id TEXT,first_hand_number INTEGER,sample_json TEXT,applied_at TEXT);
              CREATE TABLE dynamic_profile_games(user_id INTEGER,evaluator_version TEXT,session_id TEXT,sample_json TEXT,applied_at TEXT);
              INSERT INTO auth_users VALUES(1,'example');
              INSERT INTO cribbage_completed_game_uploads VALUES('g','{"tag":"example","events":[]}');''')
            self.profile = json.dumps({'strength': 120, 'complete_cycles': 92, 'handicap_cycles': 92})
            c.execute('INSERT INTO dynamic_player_profiles VALUES(1,?,?,?)', ('player-history', self.profile, 'before'))
        self.report = {'schemaVersion': 1, 'status': 'complete', 'sourceSha256': 'sha',
                       'expectedProfile': {'profile_json': self.profile, 'evaluator_version': 'player-history', 'updated_at': 'before'},
                       'profilePatch': {'handicap_cycles': 100, 'ewma_cycle_handicap': -.02, 'length_games': 10, 'ewma_cycles_per_game': 5},
                       'summary': {'historical': {'wpPerGame': -.1}},
                       'reviewedGames': [{'gameId': 'g', 'payload': {'events': [{'id': 'reviewed'}]}}],
                       'cycles': {'historical': [{'gameId': 'g', 'model': 'original', 'firstHand': 1, 'sample': {}, 'at': 'at'}]},
                       'gameLengths': [{'gameId': 'g', 'cyclesPerGame': 5, 'at': 'at'}]}

    def test_apply_preserves_originals_and_strength_and_creates_backup(self):
        result = apply_report(self.path, self.report, 1, 'example', self.backup, True)
        self.assertTrue(result['applied'])
        self.assertTrue(self.backup.exists())
        with sqlite3.connect(self.path) as c:
            p = json.loads(c.execute('SELECT profile_json FROM dynamic_player_profiles').fetchone()[0])
            self.assertEqual(p['strength'], 120)
            self.assertEqual(p['complete_cycles'], 92)
            self.assertEqual(p['handicap_cycles'], 100)
            original = json.loads(c.execute('SELECT payload_json FROM cribbage_completed_game_uploads').fetchone()[0])
            self.assertEqual(original['events'], [])
            self.assertEqual(c.execute('SELECT count(*) FROM player_reviewed_games').fetchone()[0], 1)
        with sqlite3.connect(self.backup) as c:
            self.assertEqual(c.execute('SELECT profile_json FROM dynamic_player_profiles').fetchone()[0], self.profile)

    def test_dry_run_has_no_writes(self):
        self.assertFalse(apply_report(self.path, self.report, 1, 'example', self.backup)['applied'])
        self.assertFalse(self.backup.exists())
        with sqlite3.connect(self.path) as c:
            self.assertEqual(c.execute('SELECT count(*) FROM player_reviewed_games').fetchone()[0], 0)

    def test_changed_profile_and_new_games_block_import(self):
        changed = copy.deepcopy(self.report)
        changed['expectedProfile']['updated_at'] = 'stale'
        with self.assertRaisesRegex(ValueError, 'profile changed'):
            apply_report(self.path, changed, 1, 'example', self.backup)
        with sqlite3.connect(self.path) as c:
            c.execute('INSERT INTO cribbage_completed_game_uploads VALUES(?,?)', ('new', '{"tag":"example"}'))
        with self.assertRaisesRegex(ValueError, 'new completed games'):
            apply_report(self.path, self.report, 1, 'example', self.backup)


if __name__ == '__main__':
    unittest.main()
