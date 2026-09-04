#!/usr/bin/env python3

import importlib.util
import io
import json
import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest import mock


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

    def test_summary_reports_database_progress_without_reading_logs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database_path = root / "games.db"
            import sqlite3

            with sqlite3.connect(database_path) as database:
                database.execute("CREATE TABLE compact_games (id INTEGER)")
                database.executemany(
                    "INSERT INTO compact_games VALUES (?)", [(1,), (2,)]
                )
            spec = self.spec(
                root,
                [
                    {
                        "name": "benchmark",
                        "command": ["/usr/bin/true"],
                        "completionChecks": [
                            {
                                "type": "sqlite_count",
                                "path": str(database_path),
                                "table": "compact_games",
                                "equals": 10,
                            }
                        ],
                    }
                ],
            )
            status = {
                "state": "running",
                "stages": [{"name": "benchmark", "state": "running"}],
                "updatedAt": "2026-09-04T12:00:00Z",
            }

            summary = queue.summary_text(spec, status)

            self.assertEqual(
                summary,
                "test-job running stage=benchmark rows=2/10 (20.0%) "
                "updated=2026-09-04T12:00:00Z",
            )

    def test_summary_only_names_a_log_for_a_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            spec = self.spec(
                root,
                [{"name": "benchmark", "command": ["/usr/bin/false"]}],
            )
            path = self.write_spec(root, spec)
            status = queue.read_status(spec)
            status.update(
                {
                    "state": "failed",
                    "stages": [
                        {
                            "name": "benchmark",
                            "state": "failed",
                            "logPath": str(root / "benchmark.log"),
                        }
                    ],
                }
            )
            queue.atomic_json(queue.status_path(spec), status)

            output = io.StringIO()
            with mock.patch("sys.stdout", output):
                self.assertEqual(queue.print_summary(path), 0)

            self.assertEqual(
                output.getvalue().strip(),
                f"test-job failed stage=benchmark stages=0/1 "
                f"log={root / 'benchmark.log'}",
            )

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

    def test_install_supports_an_explicit_persistent_job_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "persistent-job"
            root.mkdir()
            spec = self.spec(
                root,
                [{"name": "one", "command": ["/usr/bin/true"]}],
            )
            path = self.write_spec(Path(temporary), spec)
            completed = queue.subprocess.CompletedProcess([], 0)
            with mock.patch.object(queue.subprocess, "run", return_value=completed):
                self.assertEqual(queue.install_job(path), 0)

            self.assertTrue((root / "cribbage_job_queue.py").is_file())
            self.assertTrue((root / "job.json").is_file())
            self.assertTrue(
                (root / "com.strongcribbage.job.test-job.plist").is_file()
            )

    def test_install_supports_separate_persistent_launchd_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            temporary_root = Path(temporary)
            root = temporary_root / "persistent-job"
            launcher = temporary_root / "LaunchAgents" / "test.plist"
            log = temporary_root / "Logs" / "test.log"
            spec = self.spec(
                root,
                [{"name": "one", "command": ["/usr/bin/true"]}],
            )
            spec["launchdPlistPath"] = str(launcher)
            spec["supervisorLogPath"] = str(log)
            path = self.write_spec(temporary_root, spec)
            completed = queue.subprocess.CompletedProcess([], 0)
            with mock.patch.object(queue.subprocess, "run", return_value=completed):
                self.assertEqual(queue.install_job(path), 0)

            decoded = plistlib.loads(launcher.read_bytes())
            self.assertEqual(decoded["StandardOutPath"], str(log))
            self.assertEqual(decoded["StandardErrorPath"], str(log))

    def test_relative_job_root_is_rejected(self):
        spec = {
            "schemaVersion": 1,
            "jobId": "test-job",
            "jobRoot": "relative/job",
            "stages": [{"name": "one", "command": ["/usr/bin/true"]}],
        }
        with self.assertRaisesRegex(ValueError, "jobRoot must be an absolute path"):
            queue.validate_spec(spec)

    def test_external_volume_job_root_is_rejected(self):
        spec = {
            "schemaVersion": 1,
            "jobId": "test-job",
            "jobRoot": "/Volumes/RemoteWorkspace/jobs/test-job",
            "stages": [{"name": "one", "command": ["/usr/bin/true"]}],
        }
        with self.assertRaisesRegex(ValueError, "jobRoot must be on the internal disk"):
            queue.validate_spec(spec)

    def test_stop_falls_back_to_the_supervisor_process_group(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            spec = self.spec(root, [{"name": "one", "command": ["/usr/bin/true"]}])
            path = self.write_spec(root, spec)
            status = queue.read_status(spec)
            status.update({"pid": 4321, "state": "running", "stages": []})
            queue.atomic_json(queue.status_path(spec), status)

            bootout_failure = queue.subprocess.CompletedProcess([], 5)
            with (
                mock.patch.object(queue.subprocess, "run", return_value=bootout_failure),
                mock.patch.object(queue.os, "getpgid", return_value=4321),
                mock.patch.object(queue.os, "killpg") as killpg,
            ):
                self.assertEqual(queue.stop_job(path), 0)

            killpg.assert_called_once_with(4321, queue.signal.SIGTERM)
            self.assertEqual(queue.read_status(spec)["state"], "stopped")


if __name__ == "__main__":
    unittest.main()
