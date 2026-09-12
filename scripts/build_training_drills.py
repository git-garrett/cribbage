#!/usr/bin/env python3
"""Build reusable beginner drill catalogs from completed production games."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import re
import sqlite3
from pathlib import Path


RANKS = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")
SUITS = ("c", "d", "h", "s")
CARD_PATTERN = re.compile(r"^(A|[2-9]|10|J|Q|K)([cdhs♣♦♥♠])$")
SUIT_ALIASES = {"♣": "c", "♦": "d", "♥": "h", "♠": "s"}
RANK_INDEX = {rank: index for index, rank in enumerate(RANKS)}


def parse_card(label: str) -> tuple[int, str, str]:
    if not isinstance(label, str):
        raise ValueError("card label must be a string")
    match = CARD_PATTERN.fullmatch(label)
    if match is None:
        raise ValueError(f"unrecognized card label {label!r}")
    rank, suit = match.groups()
    suit = SUIT_ALIASES.get(suit, suit)
    return RANK_INDEX[rank], suit, f"{rank}{suit}"


def card_sort_key(label: str) -> tuple[int, int]:
    rank, suit, _ = parse_card(label)
    return rank, SUITS.index(suit)


def normalized_cards(labels: list[str], expected: int | None = None) -> list[str]:
    if expected is not None and len(labels) != expected:
        raise ValueError(f"expected {expected} cards, found {len(labels)}")
    cards = [parse_card(label)[2] for label in labels]
    if len(set(cards)) != len(cards):
        raise ValueError("cards contain a duplicate physical card")
    return sorted(cards, key=card_sort_key)


def card_value(label: str) -> int:
    rank, _, _ = parse_card(label)
    return min(rank + 1, 10)


def score_ranks(labels: list[str]) -> dict[str, int]:
    """Score fifteens, pairs and runs for a set or ordered pegging suffix."""
    ranks = [parse_card(label)[0] for label in labels]
    values = [min(rank + 1, 10) for rank in ranks]
    fifteens = sum(
        2
        for size in range(2, len(labels) + 1)
        for indexes in itertools.combinations(range(len(labels)), size)
        if sum(values[index] for index in indexes) == 15
    )
    pairs = sum(2 for left, right in itertools.combinations(ranks, 2) if left == right)

    counts = {rank: ranks.count(rank) for rank in set(ranks)}
    run = 0
    if counts:
        ordered = sorted(counts)
        start = 0
        for index in range(1, len(ordered) + 1):
            if index == len(ordered) or ordered[index] != ordered[index - 1] + 1:
                span = ordered[start:index]
                if len(span) >= 3:
                    run = max(run, len(span) * product(counts[rank] for rank in span))
                start = index
    return {"fifteens": fifteens, "pairs": pairs, "runs": run}


def product(values) -> int:
    result = 1
    for value in values:
        result *= value
    return result


def score_visible_keep(labels: list[str]) -> tuple[int, dict[str, int]]:
    cards = normalized_cards(labels, expected=4)
    components = score_ranks(cards)
    suits = [parse_card(card)[1] for card in cards]
    components["flush"] = 4 if len(set(suits)) == 1 else 0
    return sum(components.values()), components


def score_pegging_play(played_cards: list[str], card: str, count_before: int) -> tuple[int, dict[str, int]]:
    series = [parse_card(label)[2] for label in played_cards]
    candidate = parse_card(card)[2]
    if not isinstance(count_before, int) or count_before < 0 or count_before + card_value(candidate) > 31:
        raise ValueError("illegal pegging play")

    ending = series + [candidate]
    rank = parse_card(candidate)[0]
    matching = 1
    for previous in reversed(series):
        if parse_card(previous)[0] != rank:
            break
        matching += 1
    pairs = {2: 2, 3: 6, 4: 12}.get(matching, 0)

    run = 0
    for length in range(len(ending), 2, -1):
        suffix_ranks = [parse_card(label)[0] for label in ending[-length:]]
        if len(set(suffix_ranks)) == length and max(suffix_ranks) - min(suffix_ranks) == length - 1:
            run = length
            break

    total = count_before + card_value(candidate)
    components = {
        "fifteen": 2 if total == 15 else 0,
        "thirtyOne": 2 if total == 31 else 0,
        "pairs": pairs,
        "run": run,
    }
    return sum(components.values()), components


def stable_id(prefix: str, key: object) -> str:
    encoded = json.dumps(key, sort_keys=True, separators=(",", ":")).encode()
    return f"{prefix}-{hashlib.sha256(encoded).hexdigest()[:16]}"


def select_easy_discards(events: list[dict], minimum_margin: int = 4) -> list[dict]:
    selected: dict[str, dict] = {}
    for event in events:
        try:
            player = event.get("player")
            if event.get("type") != "discard" or player not in ("human", "ai"):
                continue
            hand = normalized_cards(event["handBeforeDiscard"], expected=6)
            recommendation = (
                event.get("review", {}).get("recommended")
                if player == "human"
                else event.get("cards")
            )
            recommended = normalized_cards(recommendation, expected=2)
            owner = event.get("cribOwner")
            if owner not in ("human", "ai"):
                continue

            candidates = []
            for discarded in itertools.combinations(hand, 2):
                discarded_set = set(discarded)
                kept = [card for card in hand if card not in discarded_set]
                points, components = score_visible_keep(kept)
                candidates.append((points, list(discarded), kept, components))
            candidates.sort(key=lambda item: (-item[0], [card_sort_key(card) for card in item[1]]))
            best, runner_up = candidates[0], candidates[1]
            if best[0] == runner_up[0] or best[0] - runner_up[0] < minimum_margin:
                continue
            if best[1] != recommended:
                continue

            crib_owner = "player" if owner == player else "opponent"
            key = {"hand": hand, "cribOwner": crib_owner, "answer": recommended}
            identifier = stable_id("discard", key)
            selected[identifier] = {
                "id": identifier,
                "hand": hand,
                "cribOwner": crib_owner,
                "answer": recommended,
                "keptCards": best[2],
                "madePoints": best[0],
                "scoreComponents": best[3],
                "runnerUpMadePoints": runner_up[0],
                "madePointMargin": best[0] - runner_up[0],
            }
        except (KeyError, TypeError, ValueError):
            continue
    return [selected[key] for key in sorted(selected)]


def select_easy_scoring_plays(events: list[dict]) -> list[dict]:
    selected: dict[str, dict] = {}
    for event in events:
        try:
            if event.get("type") != "pegging" or event.get("action") != "play":
                continue
            hand = normalized_cards(event["hand"])
            played = [parse_card(card)[2] for card in event["playedCards"]]
            count_before = event["countBefore"]
            if not 2 <= len(hand) <= 4 or not isinstance(count_before, int):
                continue
            legal = [card for card in hand if count_before + card_value(card) <= 31]
            if len(legal) < 2:
                continue
            scored = []
            for card in legal:
                points, components = score_pegging_play(played, card, count_before)
                scored.append((card, points, components))
            winners = [candidate for candidate in scored if candidate[1] > 0]
            if len(winners) != 1:
                continue
            winner = winners[0]

            # Pegging suits are immaterial, so collapse suit variants of the same puzzle.
            key = {
                "handRanks": sorted(parse_card(card)[0] for card in hand),
                "playedRanks": [parse_card(card)[0] for card in played],
                "countBefore": count_before,
            }
            identifier = stable_id("scoring", key)
            selected.setdefault(identifier, {
                "id": identifier,
                "hand": hand,
                "playedCards": played,
                "countBefore": count_before,
                "answer": winner[0],
                "points": winner[1],
                "scoreComponents": winner[2],
                "handSize": len(hand),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return [selected[key] for key in sorted(selected)]


def load_completed_events(path: Path) -> tuple[list[dict], dict]:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    games: dict[str, list[dict]] = {}
    source_counts = {"legacyCompletedGames": 0, "currentCompletedGames": 0}
    try:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "game_uploads" in tables:
            for row in connection.execute("SELECT game_id, events_json FROM game_uploads ORDER BY game_id"):
                parsed = json.loads(row["events_json"])
                if isinstance(parsed, list):
                    games[row["game_id"]] = parsed
                    source_counts["legacyCompletedGames"] += 1
        if "cribbage_completed_game_uploads" in tables:
            for row in connection.execute(
                "SELECT game_id, payload_json FROM cribbage_completed_game_uploads ORDER BY game_id"
            ):
                payload = json.loads(row["payload_json"])
                parsed = payload.get("events", []) if isinstance(payload, dict) else []
                if isinstance(parsed, list):
                    games[row["game_id"]] = parsed
                    source_counts["currentCompletedGames"] += 1
    finally:
        connection.close()
    events = [event for game_id in sorted(games) for event in games[game_id] if isinstance(event, dict)]
    return events, {**source_counts, "distinctCompletedGames": len(games), "events": len(events)}


def build_catalog(database: Path, discard_margin: int = 4) -> dict:
    events, source = load_completed_events(database)
    discards = select_easy_discards(events, discard_margin)
    scoring = select_easy_scoring_plays(events)
    return {
        "schemaVersion": 1,
        "criteria": {
            "easyDiscard": {
                "description": "One unique highest-scoring four-card keep before the cut, with the reviewed or computer play agreeing on the discard.",
                "minimumMadePointMargin": discard_margin,
            },
            "easyScoringPlay": {
                "description": "Exactly one legal card scores immediately and every other legal card scores zero.",
                "minimumLegalChoices": 2,
            },
        },
        "source": {
            **source,
            "privacy": "Player tags, game identifiers, timestamps, scores, and review metadata are omitted.",
        },
        "counts": {"discardDrills": len(discards), "scoringPlayDrills": len(scoring)},
        "discardDrills": discards,
        "scoringPlayDrills": scoring,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("data/cribbage-server.sqlite"))
    parser.add_argument("--output", type=Path, default=Path("resources/training/easy-drills.json"))
    parser.add_argument("--discard-margin", type=int, default=4)
    args = parser.parse_args()
    if args.discard_margin < 1:
        parser.error("--discard-margin must be at least 1")
    catalog = build_catalog(args.database, args.discard_margin)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n")
    print(json.dumps(catalog["counts"], sort_keys=True))


if __name__ == "__main__":
    main()
