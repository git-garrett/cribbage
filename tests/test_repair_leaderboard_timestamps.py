from dataclasses import replace
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from scripts.repair_leaderboard_timestamps import (
    LedgerRow,
    load_exact_timestamps,
    repair_ledger,
    repair_rows,
)


def ledger_row(game_id: str, ended_at: str) -> LedgerRow:
    return LedgerRow(
        game_id=game_id,
        player="Garrett",
        winner="human",
        result="regular",
        human_score=121,
        ai_score=119,
        model="schell_table-peg_table-13.0",
        ended_at=ended_at,
    )


class RepairLeaderboardTimestampsTest(unittest.TestCase):
    def test_repair_prefers_exact_completion_time_from_upload_history(self):
        row = ledger_row("game-mqw4gr42-a76tvpv", "1785707034004Z")

        repaired, stats = repair_rows(
            {row.game_id: row},
            {row.game_id: "2026-06-27T09:12:34.567Z"},
        )

        self.assertEqual(
            repaired[row.game_id],
            replace(row, ended_at="2026-06-27T09:12:34.567Z"),
        )
        self.assertEqual(stats.exact, 1)
        self.assertEqual(stats.approximated, 0)

    def test_exact_history_also_normalizes_legacy_millisecond_format(self):
        row = ledger_row("rust-game", "1785707034004Z")

        repaired, stats = repair_rows(
            {row.game_id: row},
            {row.game_id: "2026-08-02T21:43:54.004Z"},
        )

        self.assertEqual(
            repaired[row.game_id],
            replace(row, ended_at="2026-08-02T21:43:54.004Z"),
        )
        self.assertEqual(stats.exact, 1)

    def test_repair_approximates_legacy_receipt_time_from_game_id(self):
        row = ledger_row("game-mqw4gr42-a76tvpv", "1785707034004Z")

        repaired, stats = repair_rows({row.game_id: row}, {})

        self.assertEqual(
            repaired[row.game_id],
            replace(row, ended_at="2026-06-27T08:52:48.578Z"),
        )
        self.assertEqual(stats.exact, 0)
        self.assertEqual(stats.approximated, 1)

    def test_loads_exact_end_times_from_both_upload_history_tables(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "cribbage-server.sqlite"
            connection = sqlite3.connect(database)
            connection.execute(
                "CREATE TABLE game_uploads (game_id TEXT, final_result_json TEXT)"
            )
            connection.execute(
                "CREATE TABLE cribbage_completed_game_uploads (game_id TEXT, payload_json TEXT)"
            )
            connection.execute(
                "INSERT INTO game_uploads VALUES (?, ?)",
                (
                    "legacy-game",
                    json.dumps({"at": "2026-06-20T10:11:12.345Z"}),
                ),
            )
            connection.execute(
                "INSERT INTO cribbage_completed_game_uploads VALUES (?, ?)",
                (
                    "rust-game",
                    json.dumps(
                        {"finalResult": {"at": "2026-07-20T11:12:13.456Z"}}
                    ),
                ),
            )
            connection.commit()
            connection.close()

            exact = load_exact_timestamps(database)

            self.assertEqual(exact["legacy-game"], "2026-06-20T10:11:12.345Z")
            self.assertEqual(exact["rust-game"], "2026-07-20T11:12:13.456Z")

    def test_ledger_repair_is_dry_run_first_and_backup_protected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "cribbage-server.sqlite"
            sqlite3.connect(database).close()
            ledger = root / "leaderboard-games.tsv"
            original = (
                "game-mqw4gr42-a76tvpv\tGarrett\thuman\tregular\t121\t119\t"
                "schell_table-peg_table-13.0\t1785707034004Z\tv1\n"
            )
            ledger.write_text(original, encoding="utf-8")
            backups = root / "backups"

            preview = repair_ledger(database, ledger, backups, dry_run=True)

            self.assertEqual(preview["approximated"], 1)
            self.assertEqual(ledger.read_text(encoding="utf-8"), original)
            self.assertFalse(backups.exists())

            applied = repair_ledger(database, ledger, backups, dry_run=False)

            self.assertEqual(applied, preview)
            self.assertIn("2026-06-27T08:52:48.578Z", ledger.read_text(encoding="utf-8"))
            backup_files = list(backups.iterdir())
            self.assertEqual(len(backup_files), 1)
            self.assertEqual(backup_files[0].read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
