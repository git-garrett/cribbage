#!/usr/bin/env python3
"""Build versioned Model 13.22 pegging-decline likelihood factors."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Iterable

VALUES = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10)
LEGACY_CATEGORIES = (
    "threeCardRun",
    "fourPlusCardRun",
    "pair",
    "threeOfAKind",
    "fourOfAKind",
)
PAIR_TACTIC_CATEGORIES = (
    "pairRoyalAfterPair",
    "fourOfAKindAfterPairRoyal",
    "safePair",
    "safePairRoyal",
)
CATEGORIES = LEGACY_CATEGORIES + PAIR_TACTIC_CATEGORIES
CARD_ORDINALS = ("first", "second", "third")
COUNT_FIELDS = (
    "opportunities",
    "accepted",
    "declined",
    "observedDeclines",
    "declinesWithCardHeld",
    "declinesWithoutCardHeld",
)
EXHAUSTIVE_PEGGING_MODELS = frozenset(
    f"schell_table-peg_table-{version}"
    for version in (
        "13.0",
        "13.1",
        "13.2",
        "13.21",
        "14.3",
        "14.8",
        "14.8.1",
        "15.0",
        "15.1",
        "15.2",
    )
)


def completion(series: list[int], candidate: int) -> str | None:
    same = 0
    for rank in reversed(series):
        if rank != candidate:
            break
        same += 1
    if same == 1:
        return "pair"
    if same == 2:
        return "threeOfAKind"
    if same >= 3:
        return "fourOfAKind"
    cards = series + [candidate]
    for length in range(len(cards), 2, -1):
        tail = cards[-length:]
        if len(set(tail)) == length and max(tail) - min(tail) + 1 == length:
            return "threeCardRun" if length == 3 else "fourPlusCardRun"
    return None


def ranks(blob: bytes | None) -> list[int]:
    if blob is None:
        return []
    return [card // 4 for card in bytes(blob)]


def empty_counts() -> dict[str, dict[str, dict[str, int]]]:
    return {
        category: {
            ordinal: {field: 0 for field in COUNT_FIELDS}
            for ordinal in CARD_ORDINALS
        }
        for category in CATEGORIES
    }


def add_outcome(
    counts: dict[str, dict[str, dict[str, int]]],
    category: str,
    card_ordinal: int,
    accepted: bool,
) -> None:
    if not 1 <= card_ordinal <= len(CARD_ORDINALS):
        return
    row = counts[category][CARD_ORDINALS[card_ordinal - 1]]
    row["opportunities"] += 1
    row["accepted" if accepted else "declined"] += 1


def add_decline_observation(
    counts: dict[str, dict[str, dict[str, int]]],
    category: str,
    card_ordinal: int,
    card_held: bool,
) -> None:
    if not 1 <= card_ordinal <= len(CARD_ORDINALS):
        return
    row = counts[category][CARD_ORDINALS[card_ordinal - 1]]
    row["observedDeclines"] += 1
    row[
        "declinesWithCardHeld" if card_held else "declinesWithoutCardHeld"
    ] += 1


def observe_action(
    counts: dict[str, dict[str, dict[str, int]]],
    remaining: list[int],
    opponent_remaining_count: int,
    actor_known: list[int],
    series: list[int],
    count_before: int,
    actual: int,
    card_ordinal: int,
    opponent_said_go: bool = False,
) -> None:
    # Once the opponent has exhausted their hand, a scoring choice no longer
    # reveals how this player behaves against possible retaliation.
    if opponent_remaining_count == 0 or not 1 <= card_ordinal <= 3:
        return
    actual_completion = completion(series, actual)
    actual_is_competing_score = (
        actual_completion is not None
        or count_before + VALUES[actual] in (15, 31)
    )

    def record_candidate(category: str, candidate: int) -> None:
        card_held = remaining[candidate] > 0
        accepted = candidate == actual
        # A different scoring play is a competing choice, not evidence that
        # the player avoids this category. Only a genuinely non-scoring choice
        # supplies a decline observation.
        if accepted:
            if not card_held:
                raise ValueError("played scoring candidate is absent from remaining hand")
            add_outcome(counts, category, card_ordinal, accepted)
        elif not actual_is_competing_score:
            add_decline_observation(counts, category, card_ordinal, card_held)
            if card_held:
                add_outcome(counts, category, card_ordinal, accepted)

    for candidate in range(len(remaining)):
        if count_before + VALUES[candidate] > 31:
            continue
        category = completion(series, candidate)
        if category is not None:
            record_candidate(category, candidate)

    if not series:
        return
    candidate = series[-1]
    if count_before + VALUES[candidate] > 31:
        return
    suffix = 0
    for rank in reversed(series):
        if rank != candidate:
            break
        suffix += 1
    if suffix == 2:
        record_candidate("pairRoyalAfterPair", candidate)
    elif suffix >= 3:
        record_candidate("fourOfAKindAfterPairRoyal", candidate)

    opponent_cannot_retaliate = (
        opponent_said_go
        or
        actor_known[candidate] >= 4
        or count_before + 2 * VALUES[candidate] > 31
    )
    if suffix == 1 and opponent_cannot_retaliate:
        record_candidate("safePair", candidate)
    elif suffix == 2 and opponent_cannot_retaliate:
        record_candidate("safePairRoyal", candidate)


def table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def compact_database_counts(
    path: Path,
    seen_events: set[tuple[str, int, int]] | None = None,
) -> dict[str, dict[str, dict[str, int]]]:
    counts = empty_counts()
    seen_events = seen_events if seen_events is not None else set()
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        hand_columns = table_columns(connection, "compact_hands")
        play_columns = table_columns(connection, "compact_peg_plays")
        if not {"game_id", "hand_number", "left_keep", "right_keep"}.issubset(hand_columns):
            raise ValueError(f"{path}: compact_hands lacks required keep columns")
        dealt_fields = (
            "left_dealt, right_dealt"
            if {"left_dealt", "right_dealt"}.issubset(hand_columns)
            else "NULL AS left_dealt, NULL AS right_dealt"
        )
        cut_field = "cut_card" if "cut_card" in hand_columns else "NULL AS cut_card"
        hands = connection.execute(
            f"SELECT game_id, hand_number, left_keep, right_keep, {dealt_fields}, {cut_field} FROM compact_hands"
        )
        for game_id, hand_number, left_blob, right_blob, left_dealt, right_dealt, cut_card in hands:
            remaining = [[0] * 13 for _ in range(2)]
            for player, blob in enumerate((left_blob, right_blob)):
                for rank in ranks(blob):
                    remaining[player][rank] += 1
            dealt = [ranks(left_dealt) or ranks(left_blob), ranks(right_dealt) or ranks(right_blob)]
            known = [[0] * 13 for _ in range(2)]
            for player in range(2):
                for rank in dealt[player]:
                    known[player][rank] += 1
                if cut_card is not None:
                    known[player][int(cut_card) // 4] += 1
            public_played = [[0] * 13 for _ in range(2)]
            series: list[int] = []
            go_player: int | None = None
            model_field = "model" if "model" in play_columns else "NULL AS model"
            plays = connection.execute(
                f"""
                SELECT sequence, player, action, card, count_before, count_after, {model_field}
                FROM compact_peg_plays
                WHERE game_id = ? AND hand_number = ?
                ORDER BY sequence
                """,
                (game_id, hand_number),
            )
            for sequence, player, action, card, count_before, count_after, model in plays:
                if count_before == 0 and series:
                    series.clear()
                    go_player = None
                if action != 0 or player is None or card is None:
                    if action != 0 and player is not None:
                        go_player = int(player)
                    continue
                actual = int(card) // 4
                actor = int(player)
                event_key = (str(game_id), int(hand_number), int(sequence))
                actor_known = [
                    known[actor][rank] + public_played[1 - actor][rank]
                    for rank in range(13)
                ]
                model_is_allowed = (
                    model is None and "model" not in play_columns
                ) or model in EXHAUSTIVE_PEGGING_MODELS
                if event_key not in seen_events and model_is_allowed:
                    observe_action(
                        counts,
                        remaining[actor],
                        sum(remaining[1 - actor]),
                        actor_known,
                        series,
                        int(count_before),
                        actual,
                        sum(public_played[actor]) + 1,
                        go_player == 1 - actor,
                    )
                    seen_events.add(event_key)
                if remaining[actor][actual] <= 0:
                    raise ValueError(
                        f"{path}: played absent rank {actual} in {game_id} hand {hand_number}"
                    )
                remaining[actor][actual] -= 1
                public_played[actor][actual] += 1
                series.append(actual)
                if count_after == 31:
                    series.clear()
                    go_player = None
    finally:
        connection.close()
    return counts


def cards_ranks(cards: Iterable[dict[str, object]]) -> list[int]:
    return [int(card["rank"]) for card in cards]


def human_database_counts(
    path: Path,
    seen_events: set[tuple[str, int]] | None = None,
) -> dict[str, dict[str, dict[str, int]]]:
    counts = empty_counts()
    seen_events = seen_events if seen_events is not None else set()
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        columns = table_columns(connection, "cribbage_game_events")
        required = {"session_id", "event_sequence", "action", "request_json", "game_json"}
        if not required.issubset(columns):
            raise ValueError(f"{path}: cribbage_game_events lacks required columns")
        events = connection.execute(
            """
            SELECT session_id, event_sequence, request_json, game_json
            FROM cribbage_game_events
            WHERE action = 'play-human'
            ORDER BY session_id, event_sequence
            """
        )
        for session_id, event_sequence, request_json, game_json in events:
            key = (str(session_id), int(event_sequence))
            if key in seen_events:
                continue
            request = json.loads(request_json)
            game = json.loads(game_json)
            players = game.get("players", [])
            plays = game.get("plays", [])
            if len(players) != 2 or not plays:
                continue
            actual_id = int(request.get("payload", {}).get("id"))
            actual_card = plays[-1]
            if int(actual_card["id"]) != actual_id:
                raise ValueError(
                    f"{path}: human event {session_id}/{event_sequence} does not end in requested card"
                )
            actual = int(actual_card["rank"])
            actual_value = int(actual_card["value"])
            human = players[0]
            opponent = players[1]
            remaining = [0] * 13
            for rank in cards_ranks(human.get("hand", [])):
                remaining[rank] += 1
            remaining[actual] += 1
            actor_known = [0] * 13
            for field in ("hand", "table", "discarded_to_crib"):
                for rank in cards_ranks(human.get(field, [])):
                    actor_known[rank] += 1
            turn_card = game.get("turn_card")
            if turn_card is not None:
                actor_known[int(turn_card["rank"])] += 1
            for rank in cards_ranks(opponent.get("table", [])):
                actor_known[rank] += 1
            observe_action(
                counts,
                remaining,
                len(opponent.get("hand", [])),
                actor_known,
                cards_ranks(plays[:-1]),
                int(game["count"]) - actual_value,
                actual,
                len(human.get("table", [])),
                game.get("go_player") == "Right",
            )
            seen_events.add(key)
    finally:
        connection.close()
    return counts


def database_counts(path: Path) -> dict[str, dict[str, dict[str, int]]]:
    """Backward-compatible compact-database adapter used by older callers."""
    return compact_database_counts(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def merge_counts(
    target: dict[str, dict[str, dict[str, int]]],
    source: dict[str, dict[str, dict[str, int]]],
) -> None:
    for category in CATEGORIES:
        for ordinal in CARD_ORDINALS:
            for field in COUNT_FIELDS:
                target[category][ordinal][field] += source[category][ordinal][field]


def probability_row(values: dict[str, int]) -> dict[str, int | None]:
    opportunities = values["opportunities"]
    observed_declines = values["observedDeclines"]
    if observed_declines != (
        values["declinesWithCardHeld"] + values["declinesWithoutCardHeld"]
    ):
        raise ValueError("held and absent decline counts do not sum to observations")
    if values["declined"] != values["declinesWithCardHeld"]:
        raise ValueError("held decline behavior and possession counts disagree")
    return {
        **values,
        "multiplierPpm": (
            round(values["declined"] * 1_000_000 / opportunities)
            if opportunities
            else None
        ),
        "heldGivenDeclinePpm": (
            round(values["declinesWithCardHeld"] * 1_000_000 / observed_declines)
            if observed_declines
            else None
        ),
    }


def factor_rows(
    totals: dict[str, dict[str, dict[str, int]]]
) -> dict[str, dict[str, object]]:
    factors: dict[str, dict[str, object]] = {}
    for category, ordinal_rows in totals.items():
        values = {
            field: sum(ordinal_rows[ordinal][field] for ordinal in CARD_ORDINALS)
            for field in COUNT_FIELDS
        }
        factors[category] = {
            **probability_row(values),
            "byCardOrdinal": {
                ordinal: probability_row(ordinal_rows[ordinal])
                for ordinal in CARD_ORDINALS
            },
        }
    return factors


def build(model_paths: list[Path], human_paths: list[Path] | None = None) -> dict[str, object]:
    human_paths = human_paths or []
    model_totals = empty_counts()
    human_totals = empty_counts()
    sources = []
    seen_model_events: set[tuple[str, int, int]] = set()
    for path in model_paths:
        merge_counts(model_totals, compact_database_counts(path, seen_model_events))
        sources.append({"kind": "exhaustiveModel", "path": str(path), "sha256": sha256(path)})
    seen_human_events: set[tuple[str, int]] = set()
    for path in human_paths:
        merge_counts(human_totals, human_database_counts(path, seen_human_events))
        sources.append({"kind": "human", "path": str(path), "sha256": sha256(path)})
    pooled = empty_counts()
    merge_counts(pooled, model_totals)
    merge_counts(pooled, human_totals)
    factors = factor_rows(pooled)
    for category in CATEGORIES:
        if int(factors[category]["opportunities"]) == 0:
            raise ValueError(f"no empirical opportunities for {category}")
    return {
        "schemaVersion": 3,
        "modelVersion": "13.22",
        "semantics": "Candidate-level evidence for a non-scoring decline when the scoring rank was structurally legal, the opponent still held at least one card, and category/card-ordinal conditions were satisfied; competing scoring plays are excluded",
        "inference": "heldGivenDeclinePpm is P(card held | observed decline); multiplierPpm is P(decline | card held) and reweights card-holding worlds against no-card worlds, for which a noncompeting decline is certain",
        "combination": "independent held-card likelihood multipliers across distinct public decline events",
        "cardEncoding": "compact rank-major card id: rank = floor(id / 4)",
        "modelCohort": {
            "includedPeggingStrategy": "exhaustive",
            "includedModels": sorted(EXHAUSTIVE_PEGGING_MODELS),
        },
        "sources": sources,
        "cohorts": {
            "human": factor_rows(human_totals),
            "exhaustiveModel": factor_rows(model_totals),
            "pooled": factors,
        },
        "factors": factors,
    }


def atomic_write(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(payload, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", action="append", default=[], type=Path,
                        help="legacy alias for --model-database")
    parser.add_argument("--model-database", action="append", default=[], type=Path)
    parser.add_argument("--human-database", action="append", default=[], type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    model_databases = args.database + args.model_database
    if not model_databases and not args.human_database:
        parser.error("at least one model or human database is required")
    payload = build(model_databases, args.human_database)
    atomic_write(args.output, payload)
    print(json.dumps(payload["factors"], sort_keys=True))


if __name__ == "__main__":
    main()
