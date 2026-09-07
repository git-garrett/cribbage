from dataclasses import replace
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from scripts.repair_leaderboard_scores import (
    load_authoritative_scores,
    repair_ledger,
    repair_rows,
)
from scripts.repair_leaderboard_timestamps import LedgerRow


def ledger_row(game_id: str, human_score: int, ai_score: int) -> LedgerRow:
    return LedgerRow(
        game_id=game_id,
        player="Garrett",
        winner="human",
        result="regular",
        human_score=human_score,
        ai_score=ai_score,
        model="schell_table-peg_table-13.0",
        ended_at="2026-09-06T10:00:00.000Z",
    )


def create_history_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.execute(
        "CREATE TABLE game_uploads (game_id TEXT, final_result_json TEXT)"
    )
    connection.execute(
        "CREATE TABLE cribbage_completed_game_uploads "
        "(game_id TEXT, payload_json TEXT)"
    )
    connection.execute(
        "INSERT INTO game_uploads VALUES (?, ?)",
        (
            "legacy-game",
            json.dumps({"finalScores": {"human": 121, "ai": 111}}),
        ),
    )
    connection.execute(
        "INSERT INTO game_uploads VALUES (?, ?)",
        (
            "updated-game",
            json.dumps({"finalScores": {"human": 110, "ai": 121}}),
        ),
    )
    connection.execute(
        "INSERT INTO cribbage_completed_game_uploads VALUES (?, ?)",
        (
            "updated-game",
            json.dumps(
                {"finalResult": {"finalScores": {"human": 121, "ai": 104}}}
            ),
        ),
    )
    connection.commit()
    connection.close()


class RepairLeaderboardScoresTest(unittest.TestCase):
    def test_production_deploy_previews_then_applies_score_repair(self):
        deploy = (
            Path(__file__).parents[1] / "scripts" / "deploy-nanode.sh"
        ).read_text(encoding="utf-8")

        dry_run = (
            "'$release_dir/scripts/repair_leaderboard_scores.py' --dry-run"
        )
        apply = "'$release_dir/scripts/repair_leaderboard_scores.py'"
        self.assertIn(dry_run, deploy)
        self.assertIn("systemctl stop cribbage", deploy)
        apply_index = deploy.index(apply, deploy.index(dry_run) + len(dry_run))
        self.assertGreater(apply_index, 0)
        self.assertGreater(
            deploy.index("systemctl restart cribbage", apply_index), apply_index
        )

    def test_loads_both_history_tables_with_current_uploads_authoritative(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "cribbage-server.sqlite"
            create_history_database(database)

            scores = load_authoritative_scores(database)

            self.assertEqual(scores["legacy-game"], (121, 111))
            self.assertEqual(scores["updated-game"], (121, 104))

    def test_repairs_mismatched_scores_and_preserves_ledger_only_rows(self):
        broken = ledger_row("broken", 0, 0)
        ledger_only = ledger_row("ledger-only", 121, 118)

        repaired, stats = repair_rows(
            {broken.game_id: broken, ledger_only.game_id: ledger_only},
            {broken.game_id: (121, 95)},
        )

        self.assertEqual(
            repaired[broken.game_id],
            replace(broken, human_score=121, ai_score=95),
        )
        self.assertEqual(repaired[ledger_only.game_id], ledger_only)
        self.assertEqual(stats.repaired, 1)
        self.assertEqual(stats.unchanged, 0)
        self.assertEqual(stats.without_source, 1)

    def test_repair_is_dry_run_first_and_backup_protected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "cribbage-server.sqlite"
            create_history_database(database)
            ledger = root / "leaderboard-games.tsv"
            original = (
                "legacy-game\tGarrett\thuman\tregular\t0\t0\t"
                "schell_table-peg_table-13.0\t2026-09-06T10:00:00.000Z\tv1\n"
                "updated-game\tGarrett\thuman\tregular\t0\t0\t"
                "schell_table-peg_table-13.0\t2026-09-06T10:00:00.000Z\tv1\n"
            )
            ledger.write_text(original, encoding="utf-8")
            backups = root / "backups"

            preview = repair_ledger(database, ledger, backups, dry_run=True)

            self.assertEqual(preview["repaired"], 2)
            self.assertEqual(ledger.read_text(encoding="utf-8"), original)
            self.assertFalse(backups.exists())

            applied = repair_ledger(database, ledger, backups, dry_run=False)

            self.assertEqual(applied, preview)
            contents = ledger.read_text(encoding="utf-8")
            self.assertIn("legacy-game\tGarrett\thuman\tregular\t121\t111", contents)
            self.assertIn("updated-game\tGarrett\thuman\tregular\t121\t104", contents)
            backup_files = list(backups.iterdir())
            self.assertEqual(len(backup_files), 1)
            self.assertEqual(backup_files[0].read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
