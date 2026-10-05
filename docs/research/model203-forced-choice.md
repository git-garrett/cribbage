# Model 20.3 forced-rank action selection

Based on `567ff4f0570faea537a2f257df2cacf4494d5b24`. Retain a separate live
action-only API for Model 20.3. It avoids forecasting when every playable card
has the same rank, choosing the same first physical card as the full evaluator.
This is a narrow live latency improvement, not a general opening speedup.

## Scope and behavior

`choose_peg_for_side_with_caches` returns `PegAction`, which cannot contain EV or
win probability. Only Model 20.3 uses the forced-rank shortcut; all other models
and nonforced choices delegate to the existing valued recommendation function.
Go and single-card choices also bypass preparation on this action-only path.
Equality is by rank, not pegging value: ten, jack, queen, and king remain
distinct choices. The hand's original physical-card order is preserved.

Both the API's direct AI play and its prepared opening job use this interface.
These consumers previously discarded recommendation values. Benchmark, review,
hint, and calibration callers still use the existing recommendation interface.
Its calculations, serialized EV/WP outputs, and stored benchmark values are
unchanged. No cache, asset, continuation policy, posterior arithmetic, or
simulated action changes. No benchmark restart or deployment was performed.

This does not speed up an ordinary opening by skipping its later forced moves:
the internal rollout already enumerates distinct rank actions and directly
applies a sole action without reconstructing an observation or invoking the
policy (`model1323::rollout_candidate`). It must still advance and score that
action to value the earlier nonforced choice. The new shortcut closes the gap
at the live physical-card interface, whose former fast path counted cards,
not distinct ranks.

## Frequency

A read-only snapshot across both benchmark orientations contained 2,072 completed
games and 90,660 Model 20.3 pegging turns, including go. Reconstructing remaining
hands identified 2,635 turns with multiple playable physical cards but one rank:
2.91% of all turns, or 5.08% of the 51,903 multiple-card turns.

- 2,423 had two playable copies; 201 had three; 11 had four.
- Pone: 1,102 matching turns, including only 2 of 9,395 first decisions.
- Dealer: 1,533 matching turns, including 9 of 9,389 first decisions.

The rare opening cases are four-of-a-kind keeps. These frequencies are a sample
of this benchmark's play distribution, not a universal frequency estimate.

## Performance method

A separate release probe called the actual typed engine APIs using the frozen
speed-v4 assets. CPU time is reported because the existing six-worker benchmark
continued running. Assets were warmed before timing. Ten diverse recorded forced
positions were compared three times with rotating order: frozen baseline valued
worker, candidate valued API, and candidate action-only API. All outputs required
by each API matched. The candidate valued and action-only modes used separate
hand caches. An additional eighteen nonforced regression positions and ten
endgame/reordered-hand cases were compared against the frozen worker.

The following are mean candidate-valued CPU times over three repetitions. The
action-only path took less than 0.01 ms per call in every forced case. Batches of
100,000 calls per fixture averaged 0.091–0.097 microseconds per call, including
the probe's small JSON-value construction, but excluding request parsing,
networking, background-thread startup, and UI rendering. These tiny timings are
not end-to-end UI latency claims.

| Forced position | Full valuation CPU | Action-only CPU |
| --- | ---: | ---: |
| Pone, two copies, count 22 | 7.827 ms | <0.01 ms |
| Dealer, two copies, count 9 | 0.051 ms | <0.01 ms |
| Dealer, two copies, new count | 0.052 ms | <0.01 ms |
| Dealer, two playable copies among three cards, count 28 | 8.701 ms | <0.01 ms |
| Pone, two copies, new count | 0.053 ms | <0.01 ms |
| Dealer, three copies, count 17 | 9.954 ms | <0.01 ms |
| Pone, three copies, count 13 | 88.745 ms | <0.01 ms |
| Dealer first decision, four copies | 288.325 ms | <0.01 ms |
| Dealer, three copies, new count | 9.730 ms | <0.01 ms |
| Pone first decision, four copies | 1,611.316 ms | <0.01 ms |

The first nonforced timing pass overlapped the full Rust test suite and showed
substantial variation on expensive openings. Those timings are retained in the
raw artifacts but are not used to establish a regression or a gain. A separate
confirmation pass after QA compares the same two candidate API paths in reversed
orders, with the benchmark still running.

The confirmation included two expensive pone openings, one dealer reply, and
one cheap later decision, each twice with reversed order. Aggregate CPU was
43.405618 seconds valued versus 43.362793 seconds action-only, a 0.10% difference.
The two orders differed by 0.14% and 0.06%. Treat these as effectively unchanged,
not a speedup of nonforced decisions.

The ordinary-opening hand with a later forced pair was also repeated twice
after QA, with fresh separate caches and reversed order. Mean CPU milliseconds:

| Process | Valued | Action-only |
| --- | ---: | ---: |
| Pone first decision | 9,950.134 | 9,934.141 |
| Pone whole-hand pegging | 10,177.994 | 10,157.199 |
| Dealer first decision | 1,271.659 | 1,265.632 |
| Dealer whole-hand pegging | 1,307.670 | 1,299.743 |

The unchanged openings show the size of timing variation. These selected hands
do not establish a population-wide throughput improvement. Their purpose is to
check that avoiding valuation does not defer enough preparation to erase the
benefit or change a later decision. No systematic nonforced slowdown was found.

## Playing behavior and verification

- All 2,635 recorded forced positions selected exactly the recorded physical
  card through the new API, with an intentionally nonexistent asset root.
- All 58 initial paired fixture comparisons matched action/card; the valued
  candidate also matched the frozen worker's serialized EV/WP exactly.
- Three complete pegging hands were compared twice using separate per-side,
  per-mode caches. Every action matched. These include a normal opening followed
  by duplicate pairs, a three-copy later play, and a four-of-a-kind opening.
  Complete-hand comparisons check that skipping a forecast does not change
  later decisions through different cache preparation.
- The two additional hand confirmations bring the total to eight paired hand
  executions and 84 identical action comparisons. The eight additional
  nonforced confirmation comparisons also matched exactly.
- New unit tests cover all ranks, one through four copies, count boundaries,
  physical-card order, go, mixed ten-valued ranks, and hidden-card independence.
- An API integration test covers both prepared and direct opening execution,
  identical resulting game state, and the next forced turn, without assets.
- The asset-free regression test failed before the shortcut: the previous path
  attempted to load the Model 20.3 hold asset. It passed after the change.
- `npm test`: 418 tests passed across 21 targets. The ignored correction asset
  was linked from the frozen snapshot after the fresh worktree initially lacked
  it. Existing compiler warnings concern `WeightedEntry` fields and test-build
  `send_feedback`; no new warnings were introduced.

## Reproduction artifacts

`/private/tmp/cribbage-203-forced-choice-probe` contains the standalone Rust probe,
`extract.py`, `measure.py`, `confirm.py`, `replay-all-forced.py`, frozen extracted
fixtures, frequency counts, per-comparison timings, whole-hand traces, QA output,
and provenance hashes. `measurements.json` retains the initial noisy nonforced
pass; `confirmation.json` records the later confirmation separately.

The running benchmark retains its frozen binary and valued interface. Restarting
it solely for this change would not improve its throughput.
