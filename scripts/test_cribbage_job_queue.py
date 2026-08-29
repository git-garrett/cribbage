#!/usr/bin/env python3

import importlib.util
import json
import plistlib
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("cribbage_job_queue.py")
SPEC = importlib.util.spec_from_file_location("cribbage_job_queue", MODULE_PATH)
queue = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(queue)


class CribbageJobQueueTests(unittest.TestCase):
    def spec(self, root: Path, stages: list[dict]) -> dict:
        return {
            "schemaVersion": 1,
            "jobId": "test-job",
            "jobRoot": str(root),
            "stages": stages,
        }

    def write_spec(self, root: Path, value: dict) -> Path:
        path = root / "spec.json"
        path.write_text(json.dumps(value))
        return path

    def test_completed_stage_is_not_repeated(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "marker"
            command = ["/usr/bin/touch", str(marker)]
            spec = self.spec(
                root,
                [
                    {
                        "name": "one",
                        "command": command,
                        "completionChecks": [
                            {"type": "file_exists", "path": str(marker)}
                        ],
                    }
                ],
            )
            path = self.write_spec(root, spec)
            self.assertEqual(queue.run_job(path), 0)
            first_mtime = marker.stat().st_mtime_ns
            self.assertEqual(queue.run_job(path), 0)
            self.assertEqual(marker.stat().st_mtime_ns, first_mtime)

    def test_failed_stage_blocks_queued_stage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "must-not-exist"
            spec = self.spec(
                root,
                [
                    {"name": "fail", "command": ["/usr/bin/false"]},
                    {
                        "name": "blocked",
                        "command": ["/usr/bin/touch", str(marker)],
                    },
                ],
            )
            path = self.write_spec(root, spec)
            self.assertNotEqual(queue.run_job(path), 0)
            self.assertFalse(marker.exists())

    def test_plist_is_one_shot_and_internal(self):
        spec = {
            "schemaVersion": 1,
            "jobId": "test-job",
            "stages": [{"name": "one", "command": ["/usr/bin/true"]}],
        }
        plist = queue.make_plist(
            spec,
            Path("/private/tmp/cribbage-jobs/test-job/runner.py"),
            Path("/private/tmp/cribbage-jobs/test-job/job.json"),
        )
        encoded = plistlib.dumps(plist)
        decoded = plistlib.loads(encoded)
        self.assertFalse(decoded["KeepAlive"])
        self.assertEqual(decoded["ProcessType"], "Standard")
        self.assertTrue(decoded["RunAtLoad"])
        self.assertTrue(decoded["ProgramArguments"][1].startswith("/private/tmp/"))

    def test_sqlite_completion_check(self):
        with tempfile.TemporaryDirectory() as temporary:
            database_path = Path(temporary) / "games.db"
            import sqlite3

            with sqlite3.connect(database_path) as database:
                database.execute("CREATE TABLE compact_games (id INTEGER)")
                database.executemany(
                    "INSERT INTO compact_games VALUES (?)", [(1,), (2,)]
                )
            passed, _ = queue.check_completion(
                {
                    "type": "sqlite_count",
                    "path": str(database_path),
                    "table": "compact_games",
                    "equals": 2,
                }
            )
            self.assertTrue(passed)

    def test_sqlite_contiguous_indices_detects_a_gap(self):
        with tempfile.TemporaryDirectory() as temporary:
            database_path = Path(temporary) / "games.db"
            import sqlite3

            with sqlite3.connect(database_path) as database:
                database.execute("CREATE TABLE compact_games (game_index INTEGER)")
                database.executemany(
                    "INSERT INTO compact_games VALUES (?)", [(0,), (1,), (3,)]
                )
            check = {
                "type": "sqlite_contiguous_indices",
                "path": str(database_path),
                "table": "compact_games",
                "column": "game_index",
                "start": 0,
                "count": 4,
            }
            passed, _ = queue.check_completion(check)
            self.assertFalse(passed)
            with sqlite3.connect(database_path) as database:
                database.execute("INSERT INTO compact_games VALUES (2)")
            passed, _ = queue.check_completion(check)
            self.assertTrue(passed)

    def test_changed_spec_cannot_reuse_status(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = self.spec(root, [{"name": "one", "command": ["/usr/bin/true"]}])
            first_path = self.write_spec(root, first)
            self.assertEqual(queue.run_job(first_path), 0)

            changed = self.spec(root, [{"name": "different", "command": ["/usr/bin/true"]}])
            changed_path = self.write_spec(root, changed)
            with self.assertRaisesRegex(ValueError, "different job specification"):
                queue.read_status(queue.load_spec(changed_path))


if __name__ == "__main__":
    unittest.main()
