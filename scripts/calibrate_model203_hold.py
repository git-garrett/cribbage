#!/usr/bin/env python3
"""Choose smoothing strengths on separate games; report a second, untouched split."""
import argparse
from collections import Counter, defaultdict
import gzip
import json
import math
from pathlib import Path
import sqlite3

import build_model203_hold as hold


def score(rows, evidence, length):
    loss, n, zero = 0.0, 0, 0
    for (role, prefix), row in evidence.items():
        if sum(hold.counts(prefix)) != length:
            continue
        probabilities = rows.get((role, prefix), {})
        for hand, count in row.items():
            p = probabilities.get(hand, 0)
            n += count
            if p <= 0:
                zero += count
            else:
                loss -= count * math.log(p)
    return {"observations": n, "zeroProbabilityObservations": zero,
            "meanNegativeLogLikelihood": loss / n if n and not zero else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    value = json.loads(gzip.decompress(hold.EVIDENCE.read_bytes()))
    prior = json.loads((hold.ASSETS / "model132-keep-prior.json").read_bytes())
    splits = [defaultdict(Counter), defaultdict(Counter)]
    games_by_split = [[], []]
    with sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        for game in db.execute("SELECT * FROM compact_games WHERE game_index<1000 "
                               "AND included_in_tables=1 AND winner IN (0,1) ORDER BY game_index"):
            split = int(game["game_index"] >= 500)
            games_by_split[split].append(game["game_id"])
            for hand in hold.game_hands(db, game["game_id"]):
                for side, field in enumerate(("left_engine", "right_engine")):
                    if not hold.eligible(game[field]):
                        continue
                    try:
                        observations = hold.observations(hand, side)
                    except ValueError:
                        continue
                    for role, prefix, remaining in observations:
                        splits[split][role, prefix][remaining] += 1
    grid = [10, 100, 1000, 10000, 100000, 1000000, 10000000]
    strengths = [100.0] * 4
    tuning = []
    # Opening strength affects the backoff of every conditional row. Select
    # it first, then each conditional strength, without using validation games.
    for length in range(4):
        options = []
        for strength in grid:
            candidate = strengths.copy()
            candidate[length] = strength
            rows = hold.distributions(value, prior, candidate)
            metrics = score(rows, splits[0], length)
            options.append({"strength": strength, **metrics})
        if not options[0]["observations"]:
            raise ValueError(f"no calibration observations for prefix length {length}")
        best = min(options, key=lambda r: r["meanNegativeLogLikelihood"])
        strengths[length] = best["strength"]
        tuning.append({"prefixLength": length, "options": options})
    rows = hold.distributions(value, prior, strengths)
    default_rows = hold.distributions(value, prior, [100.0] * 4)
    raw = {(role, prefix): hold.normalized(row) for role, prefixes in hold.merged_counts(value).items()
           for prefix, row in prefixes.items() if row}
    report = {"database": str(args.database.resolve()), "databaseSha256": hold.file_digest(args.database),
              "trainingEvidenceSha256": hold.digest(hold.EVIDENCE.read_bytes()),
              "split": "game indices 0..499 tune, 500..999 validate; one orientation only",
              "gamesBySplit": games_by_split, "strengths": strengths, "tuning": tuning,
              "validation": [{"prefixLength": n, "raw": score(raw, splits[1], n),
                              "strength100": score(default_rows, splits[1], n),
                              "smoothed": score(rows, splits[1], n)} for n in range(4)],
              "scope": "prefix/role prediction only; no claims of playing-strength improvement"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, sort_keys=True, indent=2) + "\n")
    hold.CONFIG.write_text(json.dumps({"schemaVersion": 1,
                                     "smoothingStrengthByPrefixLength": strengths,
                                     "calibrationReport": str(args.output.resolve().relative_to(hold.ROOT)),
                                     "calibrationReportSha256": hold.digest(args.output.read_bytes()),
                                     "physicalPriorMixture": 0.001}, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"strengths": strengths, "games": list(map(len, games_by_split)),
                      "validation": report["validation"]}))


if __name__ == "__main__":
    main()
