# Model 20.7 conditional pegging-time crib forecast

Authorized on 2026-10-02. Only Model 20.7's pegging-time counting forecast changes.
Discard selection, older model identities, immutable assets, and production Ace
remain unchanged. As before, requests without both known own discards use the
existing generic upcoming-crib fallback.

## Calculation

For each hypothetical remaining opponent hand, reconstruct its original keep by
adding the publicly played opponent cards. Use the same posterior keep weights
already used for the opponent's show forecast. For each keep, use the existing
conditional discard asset, conditioned on the opponent's role, that keep, our
own six cards, and the cut. Normalize the discard distribution **within that
keep**, then sum over the posterior keeps:

`P(discard | observation) = sum_keep P(keep | observation) × P(discard | keep, own six, cut)`.

Score the resulting 91 rank-pair weights with the existing indexed crib scorer
and empirical suit rates. Exclude all known physical cards during suit
allocation. The rank weights have already been depleted; the scorer does not
apply depletion a second time. Recommendation and selected-action review share
this path, and use the current observation at each decision.

Do not derive this mixture from sampled or collapsed rollout worlds. The
existing rollout shortcut retains one discard representative when the opponent
has at most one card, because those private cards no longer affect its rank
choice. Crib scoring still needs every discard possibility, even after all four
opponent cards have been played.

## Scope and interpretation

Only legally available information enters the forecast. An actual opponent's
unplayed cards and discards never enter it. The frozen conditional asset is
reused; this change does not train on the new assessment games.

Hand and crib forecasts remain separate marginals in the existing root counting
calculation. This does not model their joint correlation, change the inner
continuation policy, or condition the root counting forecast on hypothetical
future candidate-specific histories. Empirical suit allocation is unchanged.

Changing crib probabilities intentionally changes WP and can change selected
plays. Exact parity with older models is therefore a regression requirement for
historical model routes and discard-time decisions, not for 20.7 pegging choices.
Forecast calibration is useful evidence but cannot establish playing strength;
that requires a separate paired games assessment.

## Validation

The focused tests cover within-keep normalization, split/zero posterior weights,
invalid weights, both roles, complete late-tail support, go-evidence updates,
shared prepared-posterior equivalence, shared-cache isolation, unchanged discards,
and selected-action review consistency. Independent physical-card scoring checks
weighted crib histograms, including flushes and nobs, for nonuniform rank weights
and both neutral and empirical suit allocation.

The supervised assessment freezes the source, runs the full Rust suite, compares
2,027 real decision contexts from 254 hands and 128 seed clusters against their
actual cribs, and checks historical 20.6 decisions against saved exact results.
Seed and hand selection use fixed hashes without selecting by scores or outcomes.
Both reciprocal game orientations are included where available. Report intervals
resample whole seed clusters, preserving within-hand and paired-game dependence.

Results are recorded under
`benchmarks/model20/evaluation-20261002/model207-conditional-crib/` after verified
foreground synchronization. The measurement runs alongside another chat's CPU
work, so component CPU readings are diagnostic and are not an isolated
pone-opening or whole-hand latency comparison.

## Verified results — 2026-10-02

The full Rust suite passed, including all new focused checks. All 2,027 targets
matched independent physical-card scoring, and every actual crib score retained
positive forecast probability. The 16 saved historical 20.6 decisions retained
exact physical choices and EV/WP bits. For 20.7, 14 of those 16 WP values changed;
none of the 16 physical choices changed. Both independent code reviews found no
issues. The retained Rust source matches the tested snapshot except for its
measurement-only adapter, and all 32 asset hashes match.

| Forecast context | Cases | Brier, 20.6 → 20.7 | Log loss, 20.6 → 20.7 |
|---|---:|---:|---:|
| All | 2,027 | 0.80173 → 0.77922 | 1.86405 → 1.76101 |
| Pone | 1,014 | 0.83986 → 0.82140 | 2.04736 → 1.93133 |
| Dealer | 1,013 | 0.76356 → 0.73699 | 1.68055 → 1.59052 |

Lower is better. Overall Brier error fell 2.81% and log loss fell 5.53%. The
95% seed-cluster bootstrap interval for the Brier difference was
[-0.03194, -0.01401]. Gains increased with revealed opponent cards. Before any
opponent card was played, the Brier change was -0.00123 with interval
[-0.00443, +0.00229], an inconclusive opening-only result.

Counting-forecast construction at the first decision used mean process CPU time
of 0.523 → 2.179 ms as pone and 0.142 → 0.536 ms as dealer (254 contexts each).
These component readings suggest modest added work; they are not whole-decision
or whole-hand timings, and were collected under concurrent CPU load.

The held-out data check exposed zero stored crib scores in games ending before
the crib was counted. Targets were therefore computed from the physical cards
in Python and independently checked against Rust; every nonfinal sampled hand
also matched its stored available crib score. The sampled positions were not
changed or filtered based on these outcomes.

Retain the change in experimental 20.7. Improved prediction and this small
unchanged-choice sample do not establish playing-strength nonregression. A
separate paired games assessment remains necessary before promotion to Ace.
