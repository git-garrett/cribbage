# Ace 28.4: broad priors with a late-game update

This experiment prepares separate dealer/pone probabilities for opponents whose
start-of-hand score is 111–120. The verified broad 20.3 hold/discard snapshot is
the prior and stays byte-identical. No correction asset is rebuilt and no
production dispatch is enabled.

## Estimation and evidence

For each role and hold-prefix/conditional-discard row, use
`p_late = (late_counts + strength * p_broad) / (late_count + strength)`.
Prior strength is a tunable amount of probability mass, not the historical
number of observations behind the broad asset. Empty late rows retain the
broader distribution. Every physically legal outcome stays positive.

Strengths are selected separately by role and hold-prefix length (0–3), and by
role for conditional discards. The tuning grid includes retaining the broader
row unchanged. Actual test labels do not select strengths. Suit/decline factors
are unchanged. This is a score-band experiment, not a general behavioral-profile
refresh.

`training/model284-late-sources.json` identifies ten retained 20.3/20.2,
20.5/20.4, 20.6/13.23, 20.6/20.5, and 28.3/20.6 evaluation databases. Selection
binds recorded source commits, executable hashes, actor identities, and run
metadata hashes. Two small 20.7 probe sources lacking those identities are
excluded. Every database is frozen using SQLite backup, including committed WAL
contents. Snapshot hashes and exact deduplicated game identities are retained.
Excluded 15.x/16.x actors and unknown/suffixed aliases cannot contribute.

All recorded seed groups already represented in the inherited hold, discard,
or suit evidence are excluded from new fitting, tuning, and testing. The broad
snapshot's inherited eligibility and exact bytes are checked. Both orientations
and all hands sharing a stored seed stay in the same train/tune/test partition.
Intervals resample seed groups, not individual hands or repeated observations.

The qualified corpus contains 14,204 completed games: 11,327 training, 1,498
tuning, and 1,379 test games. Late training decisions number 4,156 dealer and
5,740 pone; late test decisions number 547 dealer and 706 pone. These are
observation counts, not independent sample counts.

## Validation contract

The pooled control updates the same broad prior with all novel training scores.
It is tuned against the same late tuning positions. This checks whether a gain
comes from score conditioning rather than simply more contemporary evidence.
Predictive checks use actual held-out board positions and hidden-card labels,
both before and after physical known-card/cut conditioning.

A saved fresh hypothetical seed selects 64 held-out deals and tests four board
assignments per deal, including the 110/111 boundary: 256 probability scenarios.
These check role routing, support, normalization, and depletion. Rebased board
assignments are not labeled as behavioral ground truth. The native Rust readers
independently check the serialized hold/discard calculations against the panel.

Separate native decision scenarios compare the unchanged Ace 28.3 solver with
the candidate beliefs across all ten scores 111–120, three opponent scores,
and both roles (60 bounded late continuations). Four additional cases require
the certain winning 31 at 119 or 120. These test legal choices, finite utilities,
and certain score-outs. They do not supply best-play labels for uncertain
positions or demonstrate a win-rate improvement.

Another 64 positions (32 per role) use different physical deals and legal short
public histories, generated from the saved hypothetical seed. They stop at a
two-card choice and compare both profiles on the identical observation; no
complete hand/game is played. The hand/crib probability panel and these decision
checks serve different purposes.

## Held-out results

After known-card/cut conditioning, negative log likelihood (lower is better):

| Forecast | Role | Broad prior | Late candidate | Delta, 95% seed-group interval |
| --- | --- | ---: | ---: | --- |
| Remaining hand | Dealer | 5.79898 | 5.42979 | −0.36919 [−0.46466, −0.27982] |
| Remaining hand | Pone | 4.98095 | 4.90174 | −0.07921 [−0.11430, −0.04831] |
| Discard given keep | Dealer | 4.95021 | 4.88473 | −0.06548 [−0.11345, −0.02248] |
| Discard given keep | Pone | 4.32908 | 4.30525 | −0.02383 [−0.05417, +0.00037] |

There are 2,008 dealer and 2,733 pone remaining-hand observations, drawn from
547/706 late test hands and 365/423 stored seed groups. Multiple prefixes from
one hand are not independent trials. The pone-discard interval includes zero.

Against the same-data pooled refresh, the dealer remaining-hand improvement
remains clear: delta −0.14354 [−0.21974, −0.07819]. The pone remaining-hand delta
is −0.00150 [−0.03322, +0.02981]; the discard deltas also have intervals spanning
zero. Thus the experiment supports retaining the dealer split, but does not
establish a separate late regime's advantage for every component. Its improving
predictions over the old prior must not all be credited to score conditioning.

The reports retain the full candidate and pooled control for review. Test results
are not used to refit strengths or silently merge individual components.

All 256 probability scenarios and 128 decision scenarios passed. One of the
124 non-oracle decision comparisons changed the chosen card. That difference is
a diagnostic, not proof that the new play is better. The four certain score-out
cases retained the required winning play.

The candidate is only accessible to these offline tests. A future whole-game
adapter must select the distribution for the subject player's score **at hand
start**, retain dealer/pone identity, and bind prepared work to the new input
fingerprints. Crossing 111 during pegging does not retroactively change the
keep/discard prior. Cases where only the opponent is near winning remain pooled.

## Artifacts and reproduction

Candidate directory:
`/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model284/late-beliefs-20261126-v3`.
It contains broad and late hold/discard binaries, a pooled-control pair,
`manifest.json`, frozen sources, raw `evidence.json.gz`, `assessment.json`,
`hypotheticals.json`, and `decision-hypotheticals.json`.

Review copies: [manifest](model284-late-beliefs-manifest.json),
[predictive assessment](model284-late-beliefs-assessment.json),
[decision scenarios](model284-late-beliefs-decisions.json), and
[validation identities](model284-late-beliefs-validation.json).

The builder is `scripts/build_model284_late_beliefs.py`; run it with
`--sources training/model284-late-sources.json --output <candidate-directory>`.
An existing directory reuses its immutable snapshots and saved hypothetical
seed, and rejects changed source selections or tampered snapshot hashes.

`npm run test:late-beliefs` checks evidence selection, seed exclusions, fitting,
positive support, and physical conditioning. The ignored Rust tests
`prepared_late_assets_match_native_conditioning_on_hypotheticals` and
`late_game_hypothetical_decisions_compare_candidate_with_ace` require
`CRIBBAGE_284_LATE_ASSET_ROOT=<candidate-directory>` and run as foreground tests.

Whole-game validation against Ace is deferred until these results are reviewed.
Production Ace remains 28.3.fast.
