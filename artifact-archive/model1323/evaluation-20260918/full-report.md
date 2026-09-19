# schell_table-peg_table-13.23 vs schell_table-peg_table-13.215

- Experiment: model1323-joint-wp-vs-model13215-board-matrix
- Seed pairing: same-seed-and-game-index-with-model-sides-swapped

## Progress and result

- Progress: 10000/10000
- ETA: Both game orientations are complete.
- ETA covers both game orientations; final reports, verification, and sync follow.
- 13.23: 5129 wins; 13.215: 4871 wins.
- 13.23 raw win rate: 51.29%; Wilson 95% 50.31% to 52.27%.
- 13.23 score advantage: 0.625 points/game; normal 95% 0.232 to 1.018.
- Paired 13.23 win rate: 51.29%; paired-cluster 95% 50.69% to 51.89%.
- Pair outcomes: 542 13.23 sweeps, 4045 splits, 413 13.215 sweeps.

## Runner status

| Orientation | Status | Saved | Rate | Remaining | Updated |
| --- | --- | --- | --- | --- | --- |
| 13.23-left | complete | 5000/5000 | 0.081 games/s | 0h 0m 0s | 2026-09-18T19:37:50Z |
| 13.215-left | complete | 5000/5000 | 0.081 games/s | 0h 0m 0s | 2026-09-18T19:42:41Z |

## Reciprocal orientations

| Orientation | Games | 13.23 wins | 13.215 wins | 13.23 rate | Score delta |
| --- | --- | --- | --- | --- | --- |
| candidate-left | 5000 | 2559 | 2441 | 51.18% | 0.422 |
| opponent-left | 5000 | 2570 | 2430 | 51.40% | 0.828 |

Paired score delta (13.23 − 13.215): 0.625 points/game across 5000 matched indexes.

## Realized scoring (13.23 − 13.215)

| Phase | 13.23 | 13.215 | Delta | N |
| --- | --- | --- | --- | --- |
| Final score | 113.032 | 112.407 | 0.625 | 10000/10000 |
| Margin | 0.625 | -0.625 | 1.250 | 10000/10000 |
| Peg dealer | 3.621 | 3.485 | 0.136 | 45175/45159 |
| Peg pone | 2.238 | 2.155 | 0.083 | 45159/45175 |
| Hand dealer | 7.326 | 7.308 | 0.018 | 45175/45159 |
| Hand pone | 7.648 | 7.744 | -0.096 | 45159/45175 |
| Crib | 4.192 | 4.196 | -0.004 | 45175/45159 |

## Available-event scoring (13.23 − 13.215)

| Phase | 13.23 | 13.215 | Delta | N |
| --- | --- | --- | --- | --- |
| Available peg dealer | 3.627 | 3.493 | 0.134 | 45175/45159 |
| Available peg pone | 2.244 | 2.163 | 0.082 | 45159/45175 |
| Available hand dealer | 7.397 | 7.372 | 0.025 | 45175/45159 |
| Available hand pone | 7.815 | 7.903 | -0.088 | 45159/45175 |
| Available crib | 4.260 | 4.260 | -0.000 | 45175/45159 |

## EV calibration

Final-hand decisions are excluded. `discard_total` is total discard EV, not separate hand, crib, and pegging EV. Pegging rows include future-net predictions only; forced plays and legacy immediate-score telemetry are excluded.

| Decision | Role | Model | N | EV | Realized | Realized − EV | MAE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| discard_total | dealer | 13.215 | 40175 | 13.811 | 13.706 | -0.105 | 3.689 |
| discard_total | dealer | 13.23 | 40159 | 14.073 | 13.960 | -0.113 | 3.699 |
| discard_total | pone | 13.215 | 40159 | 1.623 | 1.961 | 0.338 | 3.927 |
| discard_total | pone | 13.23 | 40175 | 1.974 | 2.112 | 0.138 | 3.877 |
| peg_future | dealer | 13.215 | 110322 | 1.598 | 1.337 | -0.261 | 1.495 |
| peg_future | dealer | 13.23 | 107973 | 1.825 | 1.567 | -0.258 | 1.443 |
| peg_future | pone | 13.215 | 113912 | -1.191 | -0.980 | 0.211 | 1.783 |
| peg_future | pone | 13.23 | 113326 | -0.630 | -0.715 | -0.085 | 1.661 |

## Win-probability calibration

| Decision | Role | Model | N | Predicted | Actual | Miss | Brier | MAE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| discard | dealer | 13.215 | 45159 | 0.499 | 0.492 | -0.006 | 0.171 | 0.346 |
| discard | dealer | 13.23 | 45175 | 0.515 | 0.516 | 0.001 | 0.171 | 0.348 |
| discard | pone | 13.215 | 45175 | 0.487 | 0.484 | -0.003 | 0.171 | 0.346 |
| discard | pone | 13.23 | 45159 | 0.505 | 0.508 | 0.003 | 0.171 | 0.347 |
| pegging | dealer | 13.215 | 123247 | 0.503 | 0.492 | -0.011 | 0.164 | 0.333 |
| pegging | dealer | 13.23 | 120598 | 0.519 | 0.517 | -0.003 | 0.164 | 0.332 |
| pegging | pone | 13.215 | 127511 | 0.493 | 0.484 | -0.009 | 0.164 | 0.332 |
| pegging | pone | 13.23 | 126897 | 0.515 | 0.509 | -0.006 | 0.163 | 0.332 |

## Decision timing

Rust model decision calls only; forced no-model rows are excluded.

| Decision | Role | Model | N | Average | Total |
| --- | --- | --- | --- | --- | --- |
| discard | dealer | 13.215 | 45159 | 214.478 ms | 4842.818 s |
| discard | dealer | 13.23 | 45175 | 223.652 ms | 5051.743 s |
| discard | pone | 13.215 | 45175 | 219.415 ms | 4956.042 s |
| discard | pone | 13.23 | 45159 | 219.430 ms | 4954.639 s |
| pegging | dealer | 13.215 | 123247 | 14.784 ms | 911.030 s |
| pegging | dealer | 13.23 | 120598 | 467.001 ms | 28159.627 s |
| pegging | pone | 13.215 | 127511 | 207.886 ms | 13253.864 s |
| pegging | pone | 13.23 | 126897 | 4697.817 ms | 298069.307 s |

## Integrity

- Engine mismatches: none
- Paired seed mismatches: none
- Complete paired indexes: 5000

