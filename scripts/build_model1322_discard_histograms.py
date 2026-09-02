#!/usr/bin/env python3
"""Build role/keep-conditioned opponent discard histograms for Model 13.22."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

COHORTS = ("model-9.x", "model-13.x")
ROLES = ("pone", "dealer")
NORMALIZED_WEIGHT = 1_000_000_000


def cohort_for_engine(engine: str) -> str | None:
    if engine.startswith("schell_table-peg_table-9."):
        return "model-9.x"
    if engine.startswith("schell_table-peg_table-13."):
        return "model-13.x"
    return None


def rank_counts(blob: bytes | None, expected: int) -> tuple[int, ...]:
    cards = bytes(blob or b"")
    if len(cards) != expected:
        raise ValueError(f"card blob contains {len(cards)} cards; expected {expected}")
    counts = [0] * 13
    for card in cards:
        if card >= 52:
            raise ValueError(f"compact card id {card} is outside the deck")
        counts[card // 4] += 1
    return tuple(counts)


def rank_key(counts: tuple[int, ...]) -> str:
    return "".join(str(count) for count in counts)


def infer_keep_discard(dealt: bytes | None, keep: bytes | None) -> tuple[str, str]:
    six = rank_counts(dealt, 6)
    four = rank_counts(keep, 4)
    discard = tuple(left - right for left, right in zip(six, four))
    if min(discard) < 0 or sum(discard) != 2:
        raise ValueError("four-card keep is not contained in six-card deal")
    return rank_key(four), rank_key(discard)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize(counter: Counter[str]) -> dict[str, int]:
    total = sum(counter.values())
    if total == 0:
        return {}
    return {
        key: max(1, round(value * NORMALIZED_WEIGHT / total))
        for key, value in sorted(counter.items())
    }


def tally_database(
    path: Path,
    counts: dict[str, dict[str, dict[str, Counter[str]]]],
    fallbacks: dict[str, dict[str, Counter[str]]],
) -> dict[str, object]:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    accepted = Counter()
    try:
        rows = connection.execute(
            """
            SELECT g.left_engine, g.right_engine, h.dealer,
                   h.left_dealt, h.right_dealt, h.left_keep, h.right_keep
            FROM compact_hands h
            JOIN compact_games g ON g.game_id = h.game_id
            WHERE g.included_in_tables = 1
            """
        )
        for row in rows:
            for side, engine_column, dealt_column, keep_column, side_code in (
                ("left", "left_engine", "left_dealt", "left_keep", 0),
                ("right", "right_engine", "right_dealt", "right_keep", 1),
            ):
                cohort = cohort_for_engine(row[engine_column])
                if cohort is None:
                    continue
                role = "dealer" if row["dealer"] == side_code else "pone"
                try:
                    keep, discard = infer_keep_discard(
                        row[dealt_column], row[keep_column]
                    )
                except ValueError:
                    accepted[f"rejected:{cohort}:{side}:{role}"] += 1
                    continue
                counts[cohort][role][keep][discard] += 1
                fallbacks[cohort][role][discard] += 1
                accepted[f"accepted:{cohort}:{side}:{role}"] += 1
    finally:
        connection.close()
    return {
        "path": str(path),
        "adapter": "compact-six-minus-keep",
        "sha256": sha256_file(path),
        "observations": dict(sorted(accepted.items())),
    }


def build(databases: list[Path]) -> dict[str, object]:
    counts = {
        cohort: {
            role: defaultdict(Counter)
            for role in ROLES
        }
        for cohort in COHORTS
    }
    fallbacks = {
        cohort: {role: Counter() for role in ROLES}
        for cohort in COHORTS
    }
    sources = [tally_database(path, counts, fallbacks) for path in databases]
    roles: dict[str, dict[str, dict[str, int]]] = {}
    fallback_rows: dict[str, dict[str, int]] = {}
    cohort_stats = []
    for role in ROLES:
        blended: dict[str, Counter[str]] = defaultdict(Counter)
        fallback = Counter()
        for cohort in COHORTS:
            for keep, histogram in counts[cohort][role].items():
                blended[keep].update(normalize(histogram))
            fallback.update(normalize(fallbacks[cohort][role]))
        roles[role] = {
            keep: dict(sorted(histogram.items()))
            for keep, histogram in sorted(blended.items())
        }
        fallback_rows[role] = dict(sorted(fallback.items()))
    for cohort in COHORTS:
        cohort_stats.append(
            {
                "name": cohort,
                "observations": {
                    role: sum(
                        sum(histogram.values())
                        for histogram in counts[cohort][role].values()
                    )
                    for role in ROLES
                },
                "keeps": {role: len(counts[cohort][role]) for role in ROLES},
                "jointCells": {
                    role: sum(
                        len(histogram) for histogram in counts[cohort][role].values()
                    )
                    for role in ROLES
                },
            }
        )
    for role in ROLES:
        if not roles[role] or not fallback_rows[role]:
            raise ValueError(f"no {role} discard histograms were produced")
    return {
        "schemaVersion": 1,
        "modelVersion": "13.22",
        "cardEncoding": "compact rank-major card id: rank = floor(id / 4)",
        "conditioning": "P(opponent discard ranks | opponent four-card keep, role)",
        "blend": (
            "Each model cohort is normalized independently within each role/keep; "
            "the normalized cohort histograms are then summed."
        ),
        "cohorts": cohort_stats,
        "sources": sources,
        "fallbackByRole": fallback_rows,
        "roles": roles,
    }


def atomic_write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", action="append", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    databases = list(dict.fromkeys(path.resolve() for path in args.database))
    value = build(databases)
    atomic_write(args.output.resolve(), value)
    print(
        f"state=complete dealerKeeps={len(value['roles']['dealer'])} "
        f"poneKeeps={len(value['roles']['pone'])} output={args.output.resolve()}"
    )


if __name__ == "__main__":
    main()
