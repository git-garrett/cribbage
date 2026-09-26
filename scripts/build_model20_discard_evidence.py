#!/usr/bin/env python3
"""Recover original discard counts and append deduplicated, completed quality games."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime
import gzip
import hashlib
import itertools
import json
from pathlib import Path
import sqlite3

from build_model1322_discard_histograms import infer_keep_discard, normalize, sha256_file
from learning_model_policy import discard_cohort, model_version

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "training/model20-opponent-discard-evidence.json.gz"
LEGACY = ROOT / "rust/cribbage-shadow-engine/assets/model1322-opponent-discard-histograms.json"
ROLES = ("dealer", "pone")


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def read_evidence(path):
    value = json.loads(gzip.decompress(path.read_bytes()))
    if value["schemaVersion"] != 1:
        raise ValueError("unsupported discard evidence")
    for engine in value["countsByModel"]:
        if discard_cohort(engine, historical=True) is None:
            raise ValueError(f"ineligible inherited evidence: {engine}")
    return value


def strict_discard(dealt, keep):
    dealt, keep = bytes(dealt or b""), bytes(keep or b"")
    if len(set(dealt)) != 6 or len(set(keep)) != 4 or not set(keep) <= set(dealt):
        raise ValueError("duplicate cards or keep not contained in deal")
    return infer_keep_discard(dealt, keep)


def add_database(value, path, historical=False):
    """Inputs must be immutable SQLite snapshots; read only and detect concurrent changes."""
    wal = Path(str(path) + "-wal")
    if wal.exists() and wal.stat().st_size:
        raise ValueError(f"supply a SQLite backup without pending WAL data: {path}")
    before = sha256_file(path)
    if any(source["sha256"] == before for source in value["sources"]):
        return
    seen_contents = set(value["games"].values())
    statistics = Counter()
    models = Counter()
    included_games = {}
    endings = []
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        games = {row["game_id"]: dict(row) for row in connection.execute(
            "SELECT * FROM compact_games WHERE included_in_tables=1 AND reproducible=1 "
            "AND winner IN (0,1) AND (final_left_score>=121 OR final_right_score>=121) "
            "AND ended_at IS NOT NULL AND ended_at!=''"
        )}
        rows = connection.execute(
            "SELECT game_id,hand_number,dealer,start_left_score,start_right_score,cut_card,"
            "left_dealt,right_dealt,left_keep,right_keep FROM compact_hands "
            "ORDER BY game_id,hand_number"
        )
        for game_id, hand_group in itertools.groupby(rows, lambda row: row["game_id"]):
            hands = list(hand_group)
            game = games.get(game_id)
            if game is None:
                statistics["incompleteOrExcludedGames"] += 1
                continue
            if not historical and timestamp(game["ended_at"]) <= timestamp(value["baselineEndedAt"]):
                statistics["gamesBeforeCutoff"] += 1
                continue
            engines = [game["left_engine"], game["right_engine"]]
            eligible = [discard_cohort(engine, historical) for engine in engines]
            if not any(eligible):
                statistics["ineligibleGames"] += 1
                continue
            # Identity catches changed re-exports; content catches copies/replays with new IDs.
            identity = hashlib.sha256(game_id.encode()).hexdigest()
            content = hashlib.sha256(json.dumps([
                engines, game["random_seed"], game["final_left_score"], game["final_right_score"],
                [[v.hex() if isinstance(v, bytes) else v for v in tuple(hand)[1:]] for hand in hands],
            ], separators=(",", ":")).encode()).hexdigest()
            if identity in value["games"] and value["games"][identity] != content:
                raise ValueError(f"conflicting completed game identity: {game_id}")
            if identity in value["games"] or content in seen_contents:
                statistics["duplicateGames"] += 1
                continue
            observations = []
            for hand in hands:
                if hand["dealer"] not in (0, 1):
                    raise ValueError(f"invalid dealer in {game_id}")
                for side, engine in enumerate(engines):
                    if eligible[side] is None:
                        statistics["ineligibleActorDecisions"] += 1
                        continue
                    prefix = ("left", "right")[side]
                    try:
                        keep, discard = strict_discard(hand[prefix + "_dealt"], hand[prefix + "_keep"])
                    except ValueError:
                        statistics["invalidDecisions"] += 1
                        continue
                    role = "dealer" if hand["dealer"] == side else "pone"
                    observations.append((engine, role, keep, discard))
            if not observations:
                statistics["gamesWithoutUsableDecisions"] += 1
                continue
            for engine, role, keep, discard in observations:
                counts = value["countsByModel"].setdefault(engine, {role: {} for role in ROLES})
                row = counts[role].setdefault(keep, {})
                row[discard] = row.get(discard, 0) + 1
                models[engine] += 1
            value["games"][identity] = content
            seen_contents.add(content)
            statistics["gamesAdded"] += 1
            statistics["decisionsAdded"] += len(observations)
            endings.append(game["ended_at"])
            run_key = (game["run_id"], game["matchup_id"], *engines)
            run = included_games.setdefault(run_key, {
                "runId": game["run_id"], "matchupId": game["matchup_id"],
                "leftEngine": engines[0], "rightEngine": engines[1], "gameIndices": [],
            })
            run["gameIndices"].append(game["game_index"])
    finally:
        connection.close()
    if sha256_file(path) != before:
        raise ValueError(f"database changed during ingestion; supply a SQLite backup: {path}")
    value["sources"].append({
        "path": str(path.resolve()), "sha256": before, "historical": historical,
        "statistics": dict(statistics), "observationsByModel": dict(models),
        "latestGameEndedAt": max(endings, key=timestamp) if endings else None,
        "includedGames": [{**run, "gameIndices": sorted(run["gameIndices"])}
                          for _, run in sorted(included_games.items())],
    })


def histograms(value):
    cohorts = {cohort: {role: defaultdict(Counter) for role in ROLES}
               for cohort in ("historical-9.x", "quality")}
    for engine, roles in value["countsByModel"].items():
        cohort = discard_cohort(engine, historical=True)
        if cohort is None:
            raise ValueError(f"ineligible inherited evidence: {engine}")
        for role, rows in roles.items():
            for keep, row in rows.items():
                cohorts[cohort][role][keep].update(row)
    result = {"schemaVersion": 1, "modelVersion": "20.0", "roles": {}, "fallbackByRole": {}}
    for role in ROLES:
        blended, fallback = defaultdict(Counter), Counter()
        for roles in cohorts.values():
            marginal = Counter()
            for keep, counts in roles[role].items():
                blended[keep].update(normalize(counts))
                marginal.update(counts)
            fallback.update(normalize(marginal))
        result["roles"][role] = dict(blended)
        result["fallbackByRole"][role] = dict(fallback)
    result.update({key: value[key] for key in ("baselineEndedAt", "sources", "blend", "eligibility")})
    result["sourceGameCount"] = len(value["games"])
    result["observationsByModel"] = {
        model_version(engine): sum(sum(row.values()) for rows in roles.values() for row in rows.values())
        for engine, roles in value["countsByModel"].items()
    }
    return result


def density(value):
    from pack_model20_opponent_discards import rank_keys
    keeps, pairs = rank_keys(4), rank_keys(2)
    result = {}
    for role in ROLES:
        counts = defaultdict(Counter)
        for roles in value["countsByModel"].values():
            for keep, row in roles[role].items():
                counts[keep].update(row)
        totals = sorted(sum(row.values()) for row in counts.values())
        cells = [count for row in counts.values() for count in row.values()]
        legal = sum(all(int(k) + int(d) <= 4 for k, d in zip(keep, pair))
                    for keep in keeps for pair in pairs)
        result[role] = {
            "observations": sum(totals), "observedKeeps": len(totals), "possibleKeeps": len(keeps),
            "observedCells": len(cells), "legalCells": legal,
            "cellCoveragePercent": len(cells) * 100 / legal,
            "singletonCells": cells.count(1), "cellsAtLeast10": sum(n >= 10 for n in cells),
            "keepsBelow10IncludingMissing": len(keeps) - sum(n >= 10 for n in totals),
            "keepsBelow30IncludingMissing": len(keeps) - sum(n >= 30 for n in totals),
            "medianObservedKeepCount": (totals[(len(totals)-1)//2] + totals[len(totals)//2])/2,
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-database", action="append", type=Path, default=[])
    parser.add_argument("--database", action="append", type=Path, default=[])
    parser.add_argument("--evidence", type=Path, default=EVIDENCE)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.baseline_database:
        original = json.loads(LEGACY.read_bytes())
        if {sha256_file(path) for path in args.baseline_database} != {s["sha256"] for s in original["sources"]}:
            raise ValueError("baseline must be exactly the six recorded historical databases")
        value = {"schemaVersion": 1, "countsByModel": {}, "games": {}, "sources": [],
                 "blend": "Equal normalized historical-9.x and quality cohorts within role/keep; "
                          "quality pools original 13.x and new eligible observations by raw count.",
                 "eligibility": "ADR-0002: exclude all 15.x/16.x; new decisions require 13.x, 14.x or 20.x; "
                                "retain original 9.x evidence only; completed reproducible games after baseline cutoff."}
        for path in args.baseline_database:
            add_database(value, path, historical=True)
        value["baselineEndedAt"] = max((s["latestGameEndedAt"] for s in value["sources"]), key=timestamp)
        recovered = histograms(value)
        for key in ("roles", "fallbackByRole"):
            if recovered[key] != original[key]:
                raise ValueError("recovered baseline does not reproduce historical weights")
    else:
        value = read_evidence(args.evidence)
    before, games_before = density(value), len(value["games"])
    for path in args.database:
        add_database(value, path)
    encoded = gzip.compress(json.dumps(value, sort_keys=True, separators=(",", ":")).encode(), mtime=0)
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.evidence.with_suffix(".tmp")
    temporary.write_bytes(encoded)
    temporary.replace(args.evidence)
    report = {"gamesBefore": games_before, "gamesAdded": len(value["games"]) - games_before,
              "gamesAfter": len(value["games"]), "before": before, "after": density(value),
              "observationsByModel": histograms(value)["observationsByModel"], "sources": value["sources"]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(f"Discard evidence: addedGames={report['gamesAdded']} totalGames={report['gamesAfter']} report={args.report}")


if __name__ == "__main__":
    main()
