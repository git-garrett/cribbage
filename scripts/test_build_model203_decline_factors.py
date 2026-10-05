import copy
import gzip
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import build_model203_decline_factors as b
import build_model1322_decline_factors as old
from test_build_model20_discard_evidence import create_database
from test_build_model203_hold import add_game


def hand():
    return {'cut_card': 40, 'left_dealt': bytes([0, 16, 17, 48, 18, 24]),
            'left_keep': bytes([0, 16, 17, 48]), 'right_dealt': bytes([19, 4, 8, 12, 20, 28]),
            'right_keep': bytes([19, 4, 8, 12]),
            'plays': [(0, 1, 19, 0, 5, None), (0, 0, 0, 5, 6, None)]}


class DeclineTests(unittest.TestCase):
    def test_qualified_policy_selection_uses_actual_pegging_provenance(self):
        for version in ('7.0', '9.0', '9.1', '9.11', '13.22', '15.0', '15.2', '16.0'):
            self.assertFalse(b.qualified('schell_table-peg_table-' + version, next(iter(b.CORRECTED_131_SOURCES))))
        for version in ('13.0', '13.215', '13.23', '20.0', '20.1', '20.2', '20.3'):
            self.assertTrue(b.qualified('schell_table-peg_table-' + version, next(iter(b.CORRECTED_131_SOURCES))))
        self.assertFalse(b.qualified('schell_table-peg_table-13.0', 'unknown'))
        # Reused 13.1 identifiers require a verified corrected source.
        self.assertFalse(b.qualified('schell_table-peg_table-13.1', 'unknown'))
        self.assertTrue(b.qualified('schell_table-peg_table-13.1', next(iter(b.CORRECTED_131_SOURCES))))
        for source in b.EXCLUDED_LEAD_SOURCES:
            self.assertFalse(b.qualified('schell_table-peg_table-13.0', source))
        self.assertFalse(b.qualified('human', 'unknown'))

    def test_eligibility_and_inherited_evidence(self):
        for version in ('9.11', '13.215', '13.23', '20.2'):
            self.assertTrue(b.eligible('schell_table-peg_table-' + version))
        for version in ('15.0', '15.2', '16.0', '16.9', '20.2-alias'):
            self.assertFalse(b.eligible('schell_table-peg_table-' + version))
        value = b.bootstrap(b.LEGACY, [])
        self.assertEqual(set(value['countsByModel']), set())
        b.validate(value, b.LEGACY)
        value['countsByModel']['schell_table-peg_table-15.2'] = b.empty_counts()
        with self.assertRaisesRegex(ValueError, 'ineligible'):b.validate(value, b.LEGACY)

    def test_smoothing_is_positive_and_preserves_observation_strength(self):
        rows = b.empty_counts()
        rows[13] = [609, 0, 5000]
        rows[14] = [163, 0, 2000]
        rates = b.probabilities(rows, 100)
        self.assertTrue(all(0 < p < 1000000 for p in rates))
        self.assertGreater(rates[14], rates[13])
        more = copy.deepcopy(rows);more[14][0] = 163000
        self.assertLess(b.probabilities(more, 100)[14], rates[14])
        more[14][2] += 1000000
        self.assertEqual(b.probabilities(more, 100)[14], b.probabilities([*more[:14], [163000, 0, 0], *more[15:]], 100)[14])

    def test_events_match_frozen_category_semantics(self):
        actual = b.hand_events(hand())
        counts = old.empty_counts()
        remaining = [0] * 13;remaining[0] = 1;remaining[4] = 2;remaining[12] = 1
        known = [0] * 13;known[4] = 4
        old.observe_action(counts, remaining, 3, known, [4], 5, 0, 1)
        expected = []
        for i, category in enumerate(b.CATEGORIES):
            row = counts[category]['first']
            expected += [(0, None, i * 3, outcome) for outcome, name in enumerate(
                ('accepted', 'declinesWithCardHeld', 'declinesWithoutCardHeld')) for _ in range(row[name])]
        self.assertEqual(actual, expected)
        with self.assertRaisesRegex(ValueError, 'illegal go'):
            invalid = hand();invalid['plays'][1] = (1, 0, None, 5, 5, None);b.hand_events(invalid)

    def test_installed_asset_retains_raw_attributable_evidence(self):
        value = json.loads(gzip.decompress((b.ROOT / 'training/model203-decline-qualified-evidence.json.gz').read_bytes()))
        asset = json.loads((b.ASSETS / 'model203-decline-factors.json').read_text())
        report = json.loads((b.ROOT / 'training/model203-decline-calibration.json').read_text())
        b.validate(value, b.LEGACY)
        self.assertEqual(asset['evidenceSha256'], b.digest(b.canonical(value)))
        self.assertEqual(report['evidenceSha256'], asset['evidenceSha256'])
        reserved = set(value['reservedValidationSeeds'])
        self.assertEqual(len(reserved), 11159)
        self.assertTrue(all(str(g['random_seed']) not in reserved for s in value['sources'] for g in s['includedGames']))
        rows = b.empty_counts()
        for counts in value['countsByModel'].values():b.add_counts(rows, counts)
        expected = b.probabilities(rows, report['strength'])
        self.assertEqual(asset['schemaVersion'], 2)
        self.assertEqual(b.runtime_factors(expected), asset['factors'])
        self.assertEqual(sum(map(len, asset['factors'].values())), 16)
        expanded = b.factor_values(asset)
        self.assertEqual(b.loss(rows, expected), b.loss(rows, expanded))
        for i, category in enumerate(b.CATEGORIES):
            if category in b.FIRST_CARD_CATEGORIES:
                self.assertEqual(expected[i * 3], expanded[i * 3])
            else:
                self.assertIsNone(expanded[i * 3])
                self.assertEqual(rows[i * 3], [0, 0, 0])

    def test_truncated_slots_are_inapplicable_not_zero_probability(self):
        asset = json.loads((b.ASSETS / 'model203-decline-factors.json').read_text())
        values = b.factor_values(asset)
        rows = b.empty_counts();rows[0] = [1, 0, 0]
        with self.assertRaisesRegex(ValueError, 'structurally unavailable'):
            b.loss(rows, values)
        asset['factors']['pair'].pop(0)
        with self.assertRaisesRegex(ValueError, 'invalid decline factor row'):
            b.factor_values(asset)

    def test_import_is_actor_specific_deduplicated_and_reserves_seeds(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'games.db'
            db = create_database(path)
            db.execute("ALTER TABLE compact_hands ADD COLUMN peg_sequence BLOB")
            for name, index, left, right in [('mixed', 0, '13.23', '15.2'), ('reserved', 1, '9.11', '20.2'),
                                            ('excluded', 2, '15.2', '16.0')]:
                add_game(db, name, index, left=left, right=right)
                h = hand()
                db.execute('UPDATE compact_hands SET cut_card=?,left_dealt=?,right_dealt=?,left_keep=?,right_keep=?,peg_sequence=? WHERE game_id=?',
                           (40, h['left_dealt'], h['right_dealt'], h['left_keep'], h['right_keep'],
                            bytes([0, 1, 19, 5, 0, 0, 0, 0, 6, 0]), name))
            db.commit();db.close()
            value = b.bootstrap(b.LEGACY, ['1'])
            with patch.dict(b.SOURCE_POLICIES, {b.file_digest(path): {'path': str(path)}}):
                b.import_database(value, path)
            self.assertEqual(len(value['games']), 1)
            self.assertEqual(set(value['countsByModel']), {'schell_table-peg_table-13.23'})
            self.assertEqual(value['countsByModel']['schell_table-peg_table-13.23'][6], [0, 1, 0])
            before = copy.deepcopy(value)
            with patch.dict(b.SOURCE_POLICIES, {b.file_digest(path): {'path': str(path)}}):
                b.import_database(value, path)
            self.assertEqual(value, before)
            db = sqlite3.connect(path);db.execute("UPDATE compact_games SET final_right_score=99 WHERE game_id='mixed'");db.commit();db.close()
            with patch.dict(b.SOURCE_POLICIES, {b.file_digest(path): {'path': str(path)}}):
                with self.assertRaisesRegex(ValueError, 'conflicting completed game'):b.import_database(value, path)


if __name__ == '__main__':unittest.main()
