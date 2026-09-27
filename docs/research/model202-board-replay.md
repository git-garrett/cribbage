# Model 20.2: complete-series board replay

Model 20.2 replaces the board win-probability asset used by Model 20.1. Discard
selection, selected-move review, root pegging evaluation, and the WP continuation
policy all select the same pinned `model202-board-win-matrix.bin`. The old
`board-win-matrix.bin` and its verified loader remain frozen for older models.
Model 20.2 retains 20.1's continuation probability semantics and optimizations,
and the existing EV-built `model1323-corrections.bin`; it does not activate the
separate normalized discard-correction builder.

The old board builder independently rebased every phase suffix and admitted a
cell only when both actors could reach 121 within that suffix. It therefore
excluded outcomes whose first winner was already known. The new builder starts
each complete recorded sequence at **discard** at each of the 14,641 score
pairs, stops at that replay's first winner, and counts only phase/score positions
visited before that winner. Winner labels follow the dealer of the visited hand.
No later suffix becomes an independent starting sequence.

The range accumulator is mathematically equivalent to direct replay: cumulative
scores between the start and a phase boundary define the rectangle of starting
boards which survive to it; ordered score-event crossing times determine its
winner. This avoids billions of individual replay loops. The reconstruction
helper is shared with the historical builder without changing its old behavior.

The source is 40,000 completed trajectories from 10,000 original seed clusters:
30,000 Model 9.0 / 9.0-crib13 / 9.0-crib148 round-robin games and 10,000 Model
9.1 versus 9.11 games. The exporter requires identifiable approved model labels;
15.x and 16.x cannot enter this build. All 585,640,000 starting-board replays
resolve using the existing saved sequences. No newly extended trajectories are
used. Fixed recorded moves are not reoptimized for hypothetical scores.

Coverage in the pooled matrix:

| Phase | Supported cells / 14,641 | Observations per cell, including gaps |
| --- | ---: | ---: |
| Discard | 14,641 | 40,000–360,202 |
| After discard | 14,641 | 36,766–359,984 |
| After pegging | 14,520 | 0–351,872 |
| After pone count | 14,519 | 0–336,829 |

The 243 unsupported cells retain zero observations and NULL empirical probability
in SQLite. The dense runtime format requires a numeric entry, so packing uses an
explicitly documented, count-weighted average from the nearest supported
Manhattan ring. Those entries do not create observations. They are listed in the
asset provenance. The entire dealer-score-zero row is unreachable after pegging;
after-pone 1–0 is also unobserved in this corpus. Some other low-score phase cells
are sparse, so retain approximate original-seed clustered confidence intervals.
With a single contributing seed, the interval is [0, 1]. Otherwise use the
envelope of the cluster sandwich interval and a Wilson interval with Kish
effective cluster count; unanimous sparse observations cannot imply an exact
probability. These
are visit-conditioned empirical frequencies; different cells can mix different
hands and histories. Monotonicity across such mixtures is diagnostic rather than
a mandatory correctness invariant.

Validation includes exact agreement with direct event-by-event replay on every
starting board of one legacy and one native series (29,282 replays; all 58,564
phase-cell counts checked), synthetic winner-order and role tests, rejection of
unresolved starts, complete shape/count/probability checks, source winner checks
at 0–0 for every game, and binary-to-database verification. Runtime tests require
one pinned matrix for root and continuation, cache/review consistency in both
roles, and unchanged older-model results after sharing a cache.

Build artifacts, source checksums, per-cell evidence, verification reports, and
exact input game sequences are retained under
`benchmarks/model20/board-rebuild-20260926`. The runtime asset is 468,528 bytes,
SHA-256 `9e658a77bd98d59ada0c363a0c27e68b01c1f5865a850896d790fe68367c696c`.
The controlled benchmark is 10,000 games of 20.2 versus the separately frozen
20.0 engine, 5,000 per orientation, with fresh paired seeds and immutable inputs.
