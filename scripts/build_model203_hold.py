#!/usr/bin/env python3
"""Retain hold evidence, ingest completed games once, and pack smoothed beliefs."""

import argparse
from collections import Counter, defaultdict
from functools import lru_cache
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path
import sqlite3
import struct
import subprocess

from learning_model_policy import model_version

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "rust/cribbage-shadow-engine/assets"
EVIDENCE = ROOT / "training/model203-hold-evidence.json.gz"
OUTPUT = ASSETS / "model203-hold.bin"
CONFIG = ROOT / "training/model203-hold-config.json"
ROLES = ("dealer", "pone")
LABELS = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")
ZERO = "0" * 13
LEGACY_REVISION = "58e44d4^"
LEGACY_PATH = "web/src/models/schell_table-peg_table-13.0/pegging-remaining-hand-distribution.json"
LEGACY_SHA = "19beb2b634ff53c889f59bedb67bb0f349a849bdabc868d89032dd305dc0c805"
KEEP_SHA = "ce5f9e6fc81854d5a6cab52a539906298e65c70861afa54ddfaf94eb4c09b4a4"
LEGACY_MODELS = {f"schell_table-peg_table-{v}" for v in ("7.0", "8.0", "9.0", "10.0", "11.0", "11.1", "12.0")}
STRONG_VERSIONS = frozenset(("7.0", "8.0", "9.0", "9.1", "9.11", "10.0", "11.0", "11.1", "12.0",
                           "13.0", "13.1", "13.2", "13.21", "13.215", "13.22", "13.23",
                           "14.3", "14.8", "14.8.1", "20.0", "20.1", "20.2", "20.3"))
SCALE = 10**15  # Probability weights, NEVER evidence counts.
MAGIC = b"M203HB01"
GAME_IDENTITY = "run,matchup,index,id,left_engine,right_engine"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


@lru_cache(None)
def keys(size):
    result = []
    for ranks in itertools.combinations_with_replacement(range(13), size):
        counts = [0] * 13
        for rank in ranks:
            counts[rank] += 1
        result.append("".join(map(str, counts)))
    return sorted(result)


def counts(key):
    if len(key) != 13 or any(c not in "01234" for c in key):
        raise ValueError("invalid rank-count key")
    return tuple(map(int, key))


def physically_valid(prefix, remaining):
    p, r = counts(prefix), counts(remaining)
    return sum(p) <= 3 and sum(p) + sum(r) == 4 and all(a + b <= 4 for a, b in zip(p, r))


def empty_evidence():
    return {"schemaVersion": 1, "baseline": {}, "updatesByModel": {}, "games": {}, "sources": [],
            "gameIdentity": GAME_IDENTITY,
            "legacyCutoff": "2026-06-17T07:44:52.086Z", "legacyRuns": []}


def bootstrap(source_bytes):
    if digest(source_bytes) != LEGACY_SHA:
        raise ValueError("unverified legacy hold source")
    source = json.loads(source_bytes)
    if set(source["filters"]["models"]) != LEGACY_MODELS:
        raise ValueError("unexpected legacy model cohort")
    if any(r[k] not in LEGACY_MODELS for r in source["sourceGames"]["runs"]
           for k in ("left_engine", "right_engine")):
        raise ValueError("unapproved inherited actor")
    value = empty_evidence()
    value["legacyRuns"] = sorted({r["run_id"] for r in source["sourceGames"]["runs"]})
    skipped = Counter()
    for role in ROLES:
        value["baseline"][role] = {}
        for length, entry in source["roles"][role].items():
            for prefix, row in entry["prefixes"].items():
                p = [0] * 13
                for rank in filter(None, prefix.split(",")):
                    p[LABELS.index(rank)] += 1
                prefix_key = "".join(map(str, p))
                if sum(p) != int(length):
                    raise ValueError("legacy prefix length mismatch")
                valid = {}
                for hand, n in row["remainingHands"].items():
                    if physically_valid(prefix_key, hand):
                        valid[hand] = n
                    else:
                        skipped[role] += n
                value["baseline"][role][prefix_key] = valid
    value["sources"].append({"kind": "verified-legacy", "gitRevision": LEGACY_REVISION,
                             "gitPath": LEGACY_PATH, "sha256": LEGACY_SHA,
                             "sourceGames": source["sourceGames"], "filters": source["filters"],
                             "excludedWrongHandSizeObservations": dict(skipped)})
    return value


def eligible(engine):
    return isinstance(engine, str) and (model_version(engine) in STRONG_VERSIONS
                                      or engine == "human" or engine.startswith("human-"))


def validate_evidence(value):
    if value["schemaVersion"] != 1:
        raise ValueError("unsupported hold evidence")
    if value.get("gameIdentity") != GAME_IDENTITY:
        raise ValueError("unsupported game identity scheme")
    if not value["sources"] or value["sources"][0].get("sha256") != LEGACY_SHA:
        raise ValueError("missing verified historical baseline")
    for engine in value["updatesByModel"]:
        if not eligible(engine):
            raise ValueError(f"ineligible inherited actor: {engine}")
    for roles in [value["baseline"], *value["updatesByModel"].values()]:
        for role, rows in roles.items():
            if role not in ROLES:
                raise ValueError("invalid role")
            for prefix, row in rows.items():
                for hand, n in row.items():
                    if not physically_valid(prefix, hand) or not isinstance(n, int) or n <= 0:
                        raise ValueError("invalid hold evidence cell")


def rank_key(cards):
    result = [0] * 13
    for card in cards:
        result[card // 4] += 1
    return "".join(map(str, result))


def observations(hand, side):
    """Each actor contributes once at opening and after each first three plays."""
    name = ("left", "right")[side]
    dealt, keep = bytes(hand[name + "_dealt"] or b""), bytes(hand[name + "_keep"] or b"")
    if (len(dealt) != 6 or len(set(dealt)) != 6 or any(c >= 52 for c in dealt)
            or len(keep) != 4 or len(set(keep)) != 4 or not set(keep) <= set(dealt)):
        raise ValueError("invalid complete keep/deal")
    role = "dealer" if side == hand["dealer"] else "pone"
    remaining, played = list(keep), []
    result = [(role, ZERO, rank_key(remaining))]
    sequence = bytes(hand["peg_sequence"] or b"")
    if len(sequence) % 5:
        raise ValueError("invalid pegging sequence length")
    for offset in range(0, len(sequence), 5):
        action, actor, card = sequence[offset:offset + 3]
        if action != 0 or actor != side:
            continue
        if card not in remaining:
            raise ValueError("public play absent from keep")
        remaining.remove(card)
        played.append(card)
        if len(played) <= 3:
            result.append((role, rank_key(played), rank_key(remaining)))
    return result


def game_hands(db, game_id):
    rows = [dict(h) for h in db.execute(
        "SELECT hand_number,dealer,start_left_score,start_right_score,cut_card,left_dealt,"
        "right_dealt,left_keep,right_keep,peg_sequence FROM compact_hands WHERE game_id=? "
        "ORDER BY hand_number", (game_id,))]
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='compact_peg_plays'").fetchone():
        sequences = defaultdict(bytearray)
        for play in db.execute("SELECT hand_number,action,player,card FROM compact_peg_plays "
                               "WHERE game_id=? ORDER BY hand_number,sequence", (game_id,)):
            if play["action"] == 0:
                if play["player"] not in (0, 1) or play["card"] is None or not 0 <= play["card"] < 52:
                    raise ValueError("invalid normalized pegging play")
                sequences[play["hand_number"]] += bytes([0, play["player"], play["card"], 0, 0])
        for row in rows:
            if not row["peg_sequence"]:
                row["peg_sequence"] = bytes(sequences[row["hand_number"]])
    return rows


def import_database(value, path, limit=0):
    """Read immutable completed-game snapshots; never invent hidden-card labels."""
    path = path.resolve()
    wal = Path(str(path) + "-wal")
    if wal.exists() and wal.stat().st_size:
        raise ValueError("supply an immutable SQLite backup without pending WAL")
    before = file_digest(path)
    if any(s.get("sha256") == before and not s.get("limit") for s in value["sources"]):
        return
    stats, by_model = Counter(), Counter()
    seen = set(value["games"].values())
    imported = []
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        games = db.execute("SELECT * FROM compact_games WHERE included_in_tables=1 "
                           "AND winner IN (0,1) AND (final_left_score>=121 OR final_right_score>=121) "
                           "AND ended_at IS NOT NULL ORDER BY game_index,game_id")
        for game in games:
            if game["run_id"] in value["legacyRuns"] or game["ended_at"] <= value["legacyCutoff"]:
                stats["historicalOverlapSkipped"] += 1
                continue
            engines = [game["left_engine"], game["right_engine"]]
            if str(game["random_seed"]) in value.get("reservedValidationSeeds", []):
                stats["reservedValidationGames"] += 1
                continue
            if not any(eligible(e) for e in engines):
                stats["ineligibleGames"] += 1
                continue
            hands = game_hands(db, game["game_id"])
            # Some historical experiments reused run/game IDs after changing
            # model versions. Actor identities distinguish those actual games.
            identity = digest(canonical([game["run_id"], game["matchup_id"], game["game_index"],
                                         game["game_id"], *engines]))
            content = digest(canonical([engines, game["random_seed"], game["final_left_score"],
                                       game["final_right_score"], [{k: v.hex() if isinstance(v, bytes) else v
                                                                  for k, v in h.items()} for h in hands]]))
            if identity in value["games"] and value["games"][identity] != content:
                raise ValueError(f"conflicting completed game identity: {game['game_id']} in {path}")
            if identity in value["games"] or content in seen:
                stats["duplicateGames"] += 1
                continue
            added = 0
            for hand in hands:
                if hand["dealer"] not in (0, 1):
                    raise ValueError("invalid dealer")
                for side, engine in enumerate(engines):
                    if not eligible(engine):
                        stats["ineligibleActors"] += 1
                        continue
                    try:
                        rows = observations(hand, side)
                    except ValueError:
                        stats["invalidActorHands"] += 1
                        continue
                    for role, prefix, remaining in rows:
                        counts_by_role = value["updatesByModel"].setdefault(engine, {})
                        row = counts_by_role.setdefault(role, {}).setdefault(prefix, {})
                        row[remaining] = row.get(remaining, 0) + 1
                    by_model[engine] += 1
                    added += 1
            if not added:
                continue
            value["games"][identity] = content
            seen.add(content)
            stats["gamesAdded"] += 1
            stats["actorHandsAdded"] += added
            imported.append({"gameId": game["game_id"], "runId": game["run_id"],
                             "matchupId": game["matchup_id"], "gameIndex": game["game_index"],
                             "seed": game["random_seed"], "engines": engines})
            if limit and stats["gamesAdded"] >= limit:
                break
    if file_digest(path) != before:
        raise ValueError("database changed during import")
    value["sources"].append({"kind": "compact-games", "path": str(path), "sha256": before,
                             "statistics": dict(stats), "actorHandsByModel": dict(by_model),
                             "includedGames": imported, "limit": limit})


def merged_counts(value, older_model_weight=1.0):
    result = {role: defaultdict(Counter) for role in ROLES}
    groups = [(value["baseline"], older_model_weight)]
    for engine, roles in value["updatesByModel"].items():
        version = model_version(engine)
        weight = older_model_weight if version and int(version.split('.')[0]) < 13 else 1.0
        groups.append((roles, weight))
    for roles, weight in groups:
        for role, rows in roles.items():
            for prefix, row in rows.items():
                if weight == 1.0:
                    result[role][prefix].update(row)
                else:
                    result[role][prefix].update({h: n * weight for h, n in row.items()})
    return result


def normalized(weights):
    total = sum(weights.values())
    return {h: w / total for h, w in weights.items()}


def smooth(row, prior, strength):
    total = sum(row.values())
    return {h: (row.get(h, 0) + strength * q) / (total + strength) for h, q in prior.items()}


def distributions(value, keep_prior, strengths, physical_mix=0.001, older_model_weight=1.0):
    """Uninformative play-order backoff; observed prefix rows learn play selection."""
    if not math.isfinite(older_model_weight) or not 0 < older_model_weight <= 1:
        raise ValueError("older model weight must be positive and at most one")
    evidence = merged_counts(value, older_model_weight)
    physical = normalized({h: math.prod(math.comb(4, n) for n in counts(h)) for h in keys(4)})
    result = {}
    for role in ROLES:
        base = normalized(keep_prior["roles"][role])
        prior = {h: (1 - physical_mix) * base.get(h, 0) + physical_mix * p for h, p in physical.items()}
        opening = smooth(evidence[role][ZERO], prior, strengths[0])
        result[(role, ZERO)] = opening
        for length in range(1, 4):
            for prefix in keys(length):
                p = counts(prefix)
                backoff = {}
                for hand in keys(4 - length):
                    r = counts(hand)
                    initial = tuple(a + b for a, b in zip(p, r))
                    if max(initial) > 4:
                        continue
                    key = "".join(map(str, initial))
                    # Probability of this multiset in a uniformly selected subset
                    # of the initial keep; choose(4,length) cancels on normalization.
                    backoff[hand] = opening[key] * math.prod(math.comb(a, b) for a, b in zip(initial, p))
                result[(role, prefix)] = smooth(evidence[role][prefix], normalized(backoff), strengths[length])
    return result


def pack(rows):
    directory, records = bytearray(), bytearray()
    first = 0
    max_error = 0.0
    for role, prefix in sorted(rows):
        row = rows[(role, prefix)]
        weights = {h: max(1, round(p * SCALE)) for h, p in row.items()}
        total = sum(weights.values())
        max_error = max(max_error, max(abs(weights[h] / total - p) for h, p in row.items()))
        directory += struct.pack("<B13BII", ROLES.index(role), *counts(prefix), first, len(row))
        for hand, weight in sorted(weights.items()):
            records += struct.pack("<13BQ", *counts(hand), weight)
        first += len(row)
    return MAGIC + struct.pack("<IIIII", 1, len(rows), first, 22, 21) + directory + records, max_error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, default=EVIDENCE)
    parser.add_argument("--bootstrap", action="store_true")
    parser.add_argument("--legacy-source", type=Path)
    parser.add_argument("--database", action="append", type=Path, default=[])
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--strengths", help="override the calibrated comma-separated strengths")
    parser.add_argument("--config", type=Path, default=CONFIG)
    parser.add_argument("--keep-prior", type=Path, default=ASSETS / "model132-keep-prior.json")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    strengths = ([float(s) for s in args.strengths.split(",")] if args.strengths else
                 config["smoothingStrengthByPrefixLength"])
    physical_mix = config["physicalPriorMixture"]
    if len(strengths) != 4 or any(not math.isfinite(s) or s <= 0 for s in strengths):
        parser.error("four finite positive smoothing strengths required")
    if not math.isfinite(physical_mix) or not 0 < physical_mix <= 1:
        parser.error("physical prior mixture must be positive and at most one")
    if args.bootstrap:
        if args.evidence.exists():
            parser.error("refusing to replace existing evidence during bootstrap")
        source = (args.legacy_source.read_bytes() if args.legacy_source else subprocess.check_output(
            ["git", "show", LEGACY_REVISION + ":" + LEGACY_PATH], cwd=ROOT))
        value = bootstrap(source)
    else:
        value = json.loads(gzip.decompress(args.evidence.read_bytes()))
    validate_evidence(value)
    for path in args.database:
        import_database(value, path)
    validate_evidence(value)
    prior_bytes = args.keep_prior.read_bytes()
    if digest(prior_bytes) != config.get("openingBackoffSha256", KEEP_SHA):
        raise ValueError("opening backoff source changed; audit and version it explicitly")
    older_weight = config.get("olderModelEvidenceWeight", 1.0)
    rows = distributions(value, json.loads(prior_bytes), strengths, physical_mix, older_weight)
    binary, error = pack(rows)
    evidence_bytes = gzip.compress(canonical(value), mtime=0)
    report = {"schemaVersion": 1, "model": "20.3", "sha256": digest(binary),
              "evidenceSha256": digest(evidence_bytes), "openingBackoffSha256": digest(prior_bytes),
              "smoothingStrengthByPrefixLength": strengths, "physicalPriorMixture": physical_mix,
              "probabilityWeightScale": SCALE, "maximumPackingProbabilityError": error,
              "contexts": len(rows), "records": sum(map(len, rows.values())), "bytes": len(binary),
              "openingSupportPerRole": {r: len(rows[r, ZERO]) for r in ROLES},
              "newCompletedGames": len(value["games"]),
              "approvedStrongVersions": sorted(STRONG_VERSIONS),
              "newActorHandsByModel": {engine: sum(sum(rows.get(ZERO, {}).values()) for rows in roles.values())
                                       for engine, roles in value["updatesByModel"].items()},
              "evidenceObservationsByRoleAndPrefixLength": {
                  r: {str(n): sum(sum(row.values()) for p, row in merged_counts(value)[r].items()
                                   if sum(counts(p)) == n) for n in range(4)} for r in ROLES},
              "legacySource": value["sources"][0],
              "recencyWeighting": "none; retained raw counts accumulate once"}
    if "olderModelEvidenceWeight" in config:
        report["olderModelEvidenceWeight"] = older_weight
    report_path = args.output.with_suffix(".json")
    report_bytes = json.dumps(report, sort_keys=True, indent=2).encode() + b"\n"
    if args.check:
        if args.output.read_bytes() != binary or report_path.read_bytes() != report_bytes:
            raise ValueError("packed asset/provenance does not reproduce")
    else:
        args.evidence.parent.mkdir(parents=True, exist_ok=True)
        args.evidence.write_bytes(evidence_bytes)
        args.output.write_bytes(binary)
        report_path.write_bytes(report_bytes)
    print(json.dumps({k: report[k] for k in ("model", "contexts", "records", "bytes", "openingSupportPerRole", "newCompletedGames", "sha256")}))


if __name__ == "__main__":
    main()
