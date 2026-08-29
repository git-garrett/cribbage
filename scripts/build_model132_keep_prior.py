#!/usr/bin/env python3
"""Build Model 13.2's role-specific empirical four-card keep prior."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import tempfile
from collections import Counter
from pathlib import Path


COHORTS = ("model-9.x", "model-13.x", "human")
ROLES = ("pone", "dealer")
NORMALIZED_COHORT_WEIGHT = 1_000_000_000
RANK_LABELS = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")


def cohort_for_engine(engine: str) -> str | None:
    if engine.startswith("schell_table-peg_table-9."):
        return "model-9.x"
    if engine.startswith("schell_table-peg_table-13."):
        return "model-13.x"
    if engine == "human" or engine.startswith("human-"):
        return "human"
    return None


def keep_key(blob: bytes) -> str:
    if len(blob) != 4:
        raise ValueError(f"keep contains {len(blob)} cards; expected four")
    counts = [0] * 13
    for card in blob:
        if card >= 52:
            raise ValueError(f"compact card id {card} is outside the deck")
        counts[card // 4] += 1
    return "".join(str(count) for count in counts)


def labeled_keep_key(labels: list[str]) -> str:
    if len(labels) != 4:
        raise ValueError(f"labeled keep contains {len(labels)} cards; expected four")
    counts = [0] * 13
    for card in labels:
        rank = next((index for index, label in enumerate(RANK_LABELS) if card.startswith(label)), None)
        if rank is None:
            raise ValueError(f"unrecognized card label {card!r}")
        counts[rank] += 1
        if counts[rank] > 4:
            raise ValueError(f"labeled keep contains more than four {RANK_LABELS[rank]} cards")
    return "".join(str(count) for count in counts)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tally_compact_database(path: Path, counts: dict[str, dict[str, Counter]]) -> dict:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT g.left_engine, g.right_engine, h.dealer,
                   h.left_keep, h.right_keep
            FROM compact_hands h
            JOIN compact_games g ON g.game_id = h.game_id
            WHERE g.included_in_tables = 1
            """
        )
        hands = 0
        accepted = Counter()
        for row in rows:
            hands += 1
            for side, engine_column, keep_column, side_code in (
                ("left", "left_engine", "left_keep", 0),
                ("right", "right_engine", "right_keep", 1),
            ):
                cohort = cohort_for_engine(row[engine_column])
                if cohort is None:
                    continue
                role = "dealer" if row["dealer"] == side_code else "pone"
                blob = bytes(row[keep_column] or b"")
                if len(blob) != 4:
                    accepted[f"rejected-incomplete:{cohort}:{side}:{role}:{len(blob)}"] += 1
                    continue
                counts[cohort][role][keep_key(blob)] += 1
                accepted[f"{cohort}:{side}:{role}"] += 1
        return {
            "path": str(path),
            "adapter": "compact-benchmark",
            "sha256": sha256_file(path),
            "compactHands": hands,
            "acceptedPlayerHands": dict(sorted(accepted.items())),
        }
    finally:
        connection.close()


def record_human_keep(
    observed: dict[tuple[str, int], tuple[str, str]],
    game_id: str,
    hand_number: int,
    role: str,
    keep: str,
) -> bool:
    if role not in ROLES:
        raise ValueError(f"invalid human keep role {role!r}")
    key = (game_id, hand_number)
    existing = observed.get(key)
    if existing is None:
        observed[key] = (role, keep)
        return True
    if existing != (role, keep):
        raise ValueError(f"conflicting human keep for {game_id} hand {hand_number}")
    return False


def human_keep_from_event(event: dict) -> tuple[int, str, str] | None:
    if event.get("type") != "discard" or event.get("player") != "human":
        return None
    role = event.get("role")
    remaining = event.get("remainingHand")
    hand_number = event.get("handNumber")
    if role not in ROLES or not isinstance(remaining, list) or not isinstance(hand_number, int):
        return None
    return hand_number, role, labeled_keep_key(remaining)


def tally_production_database(path: Path, counts: dict[str, dict[str, Counter]]) -> dict:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    observed: dict[tuple[str, int], tuple[str, str]] = {}
    accepted = Counter()
    try:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if "game_uploads" in tables:
            for row in connection.execute("SELECT game_id, events_json FROM game_uploads"):
                events = json.loads(row["events_json"])
                for event in events:
                    parsed = human_keep_from_event(event)
                    if parsed is None:
                        continue
                    hand_number, role, keep = parsed
                    if record_human_keep(observed, row["game_id"], hand_number, role, keep):
                        accepted["legacy-completed-upload"] += 1
        if "cribbage_completed_game_uploads" in tables:
            rows = connection.execute(
                "SELECT game_id, payload_json FROM cribbage_completed_game_uploads"
            )
            for row in rows:
                payload = json.loads(row["payload_json"])
                for event in payload.get("events", []):
                    parsed = human_keep_from_event(event)
                    if parsed is None:
                        continue
                    hand_number, role, keep = parsed
                    if record_human_keep(observed, row["game_id"], hand_number, role, keep):
                        accepted["current-completed-upload"] += 1
        if "cribbage_game_events" in tables:
            rows = connection.execute(
                "SELECT session_id, game_json FROM cribbage_game_events WHERE action='discard'"
            )
            for row in rows:
                game = json.loads(row["game_json"])
                hand_number = game.get("hand_number")
                players = game.get("players")
                if not isinstance(hand_number, int) or not isinstance(players, list) or not players:
                    continue
                human = players[0]
                cards = human.get("hand") if isinstance(human, dict) else None
                if not isinstance(cards, list) or len(cards) != 4:
                    continue
                ranks = [card.get("rank") for card in cards if isinstance(card, dict)]
                if len(ranks) != 4 or any(not isinstance(rank, int) or not 0 <= rank < 13 for rank in ranks):
                    continue
                rank_counts = [0] * 13
                for rank in ranks:
                    rank_counts[rank] += 1
                keep = "".join(str(count) for count in rank_counts)
                role = "dealer" if game.get("dealer") == "Left" else "pone"
                if record_human_keep(observed, row["session_id"], hand_number, role, keep):
                    accepted["authoritative-session-event"] += 1

        for role, keep in observed.values():
            counts["human"][role][keep] += 1
        return {
            "path": str(path),
            "adapter": "production-human-games",
            "sha256": sha256_file(path),
            "acceptedHumanHands": len(observed),
            "acceptedBySource": dict(sorted(accepted.items())),
            "privacy": "Only role and four-card rank multiset counts enter the prior.",
        }
    finally:
        connection.close()


def tally_database(path: Path, counts: dict[str, dict[str, Counter]]) -> dict:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        connection.close()
    if {"compact_games", "compact_hands"}.issubset(tables):
        return tally_compact_database(path, counts)
    if tables.intersection({"game_uploads", "cribbage_completed_game_uploads", "cribbage_game_events"}):
        return tally_production_database(path, counts)
    raise ValueError(f"{path} is not a supported keep-prior database")


def normalized_counts(counts: Counter) -> dict[str, int]:
    total = sum(counts.values())
    if total == 0:
        return {}
    return {
        key: max(1, round(count * NORMALIZED_COHORT_WEIGHT / total))
        for key, count in sorted(counts.items())
    }


def build_prior(databases: list[Path]) -> dict:
    counts = {
        cohort: {role: Counter() for role in ROLES}
        for cohort in COHORTS
    }
    sources = [tally_database(path, counts) for path in databases]
    normalized = {
        cohort: {role: normalized_counts(counts[cohort][role]) for role in ROLES}
        for cohort in COHORTS
    }
    roles: dict[str, dict[str, int]] = {}
    for role in ROLES:
        blended = Counter()
        for cohort in COHORTS:
            blended.update(normalized[cohort][role])
        roles[role] = dict(sorted(blended.items()))

    cohorts = []
    for cohort in COHORTS:
        role_samples = {role: sum(counts[cohort][role].values()) for role in ROLES}
        cohorts.append(
            {
                "name": cohort,
                "included": any(role_samples.values()),
                "normalizationWeightPerRole": (
                    NORMALIZED_COHORT_WEIGHT if any(role_samples.values()) else 0
                ),
                "samples": role_samples,
                "distinctKeeps": {
                    role: len(counts[cohort][role]) for role in ROLES
                },
            }
        )

    for required in ("model-9.x", "model-13.x"):
        cohort = next(item for item in cohorts if item["name"] == required)
        if not cohort["included"]:
            raise ValueError(f"no {required} keeps were found")
    for role in ROLES:
        if not roles[role]:
            raise ValueError(f"no {role} keep weights were produced")

    return {
        "version": 1,
        "cardEncoding": "compact rank-major card id: rank=floor(id/4)",
        "blend": (
            "Each nonempty cohort is normalized independently to equal total "
            "weight per role, then cohort weights are summed."
        ),
        "cohorts": cohorts,
        "sources": sources,
        "roles": roles,
    }


def atomic_write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
            json.dump(value, destination, indent=2, sort_keys=True)
            destination.write("\n")
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", action="append", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    databases = list(dict.fromkeys(path.resolve() for path in args.database))
    missing = [str(path) for path in databases if not path.is_file()]
    if missing:
        raise SystemExit(f"missing keep-prior database(s): {', '.join(missing)}")
    prior = build_prior(databases)
    atomic_write_json(args.output.resolve(), prior)
    print(
        f"state=complete databases={len(databases)} "
        f"poneKeeps={len(prior['roles']['pone'])} "
        f"dealerKeeps={len(prior['roles']['dealer'])} output={args.output.resolve()}"
    )


if __name__ == "__main__":
    main()
