# Model 9 table provenance and replacement options

Date: 2026-08-26

Scope: repository source, retained artifacts, and Git history only. This note
does not use or report the active Model 9 versus Model 13 benchmark.

## Executive conclusion

- Model 9's Schell crib lookup is two fixed 13-by-13 rank-pair matrices: one
  for throwing to one's own crib and one for throwing to the opponent's crib.
  The repository records when these numbers were hardcoded, but contains no
  generator, source citation, sample size, or explanation of Schell's original
  methodology. It would be inaccurate to invent that provenance.
- Model 11.0 is the first direct in-repo replacement for the Schell lookup. It
  conditions crib value on the player's discard, role, and cut rank and weights
  exact rank-only crib scores by observed opponent discard frequencies. Model
  11.1 adds the full crib-score distribution and live suit/right-jack handling.
  Model 14.8 and every retained later strength model use an even richer
  empirical discard/keep population rather than the literal Schell matrices.
- Model 9's "iteration-2 peg table" has 330,590 rows, one for every legal
  six-card rank multiset, discard-rank pair, and role. Each row stores expected
  own pegging points, expected opponent pegging points, and (for pone) a best
  opening lead. Its weakness is that continuation play is averaged across
  legal ranks, weighted by rank multiplicity; it is not optimal strategic
  continuation.
- Model 12.0's retained pairwise table is already a materially better EV
  replacement: exact rank-only keep-versus-keep recursive play in which both
  players optimize net pegging points, preserving paired own/opponent outcomes
  and allowing known-card reweighting. The current repository has that asset,
  richer empirical priors, historical builders, and at least 44,008 completed
  modern games with compact discard/hand/peg logs. We therefore have enough to
  build a better pure-EV successor to Model 9 now.

## 1. Schell crib-value table

### Representation and Model 9 use

The table entered the repository in commit
`a5ba6c680851f0b5c4efb074332dbd008fd87e51` (`Add table discard engines`,
2026-06-08). That commit adds a `CribTable` containing `own` and `opponent`
13-by-13 floating-point matrices directly to `web/src/engine.ts`. The rank order
is A through K. The table duplicates symmetric cells rather than storing only
one triangle.

The key contains only the two discard ranks and crib ownership. It does not
condition on suits, the other four cards in the six-card hand, the cut rank,
dead-card availability, opponent strategy, or board score. `own` estimates the
points placed in the evaluating player's crib; `opponent` estimates points
placed in the other player's crib. These are separate matrices, not one matrix
whose sign is merely flipped.

In final historical Model 9, the model aliases the same Schell matrices used by
the earlier Schell model. For each of the 15 possible two-card discards it
computes:

```text
dealer total = expected hand score + Schell own-crib value + net pegging EV
pone total   = expected hand score - Schell opponent-crib value + net pegging EV
```

It then takes the maximum. A separate seven-entry suited-discard adjustment
adds the modeled crib-flush effect; it does not alter the Schell matrix. Actual
crib counting uses the normal exact hand scorer, so the Schell values affect
discard choice only.

Primary sources:

- Original hardcoding: commit `a5ba6c680851f0b5c4efb074332dbd008fd87e51`,
  `web/src/engine.ts`.
- Final Model 9 implementation: commit
  `bbe0bb5c69116c6e68b3665c62bb529aa7b24146`, `web/src/engine.ts`, especially
  the matrix declarations and `expectedCribScore` / `analyzeDiscardChoice`.
- Model 9 definition: commit
  `2a91cb6eb2fa48617e84dfdf190e297f61e370b6`,
  `web/src/models/schell_table-peg_table-9.0/model.md`.
- Suited-discard formula and asset move: commits
  `b85433657226003193fd5a889f023cb576895082` and
  `27e2ee98ec732e9dc5eae52d022b80fe07f632d2`.

### How the Schell values were made

The repository does not say. The original commit supplies all 338 numeric
cells as literals, but no generator, import, URL, bibliographic note, upstream
dataset, sample size, or derivation. Git blame attributes every numeric row to
the same hardcoding commit. Later documentation calls them "Schell crib
values" and describes separate own/opponent tables, but adds no upstream
provenance.

The strongest conclusion supported by primary repository evidence is therefore:
the values were manually imported into this codebase and labeled Schell. Their
ultimate method of production cannot be reconstructed from this repository.

### Better replacements in later models

Yes. Model 10 still keeps Model 9's Schell-based discard layer. Model 11.0,
commit `cfa1543a7050213ec8b68215aa3cca87fd9329d8`, replaces it with generated,
cut-conditioned data:

- exact rank-only hand score by four-card keep and cut rank;
- exact rank-only crib score by own discard, role, opponent discard, and cut;
- opponent discard weights measured from included flush-aware Model 7+ games.

The shipped table was built from 135,679 games and 717,352 observed discards.
It excludes flush and right-jack points in the rank base, which the runtime
layers on separately. The retained files are
[crib-rank-score-by-discard-cut.json](../../rust/cribbage-shadow-engine/assets/crib-rank-score-by-discard-cut.json)
and
[crib-score-histogram-by-discard-cut.json](../../rust/cribbage-shadow-engine/assets/crib-score-histogram-by-discard-cut.json).
The historical builder is
`cfa1543a7050213ec8b68215aa3cca87fd9329d8:scripts/build-rank-crib-discard-tables.cjs`.

Model 11.1, commit `71486d9eafa00d357fe2565b568870ee22d98c56`,
keeps the complete crib-score histogram and its contributing opponent discard
buckets. This permits known-card filtering and live suit/right-jack outcomes
instead of treating the crib as a single rank-pair mean.

Models 14.8/14.8.1 go farther. Their empirical role table was built from
211,303 included games and 2,079,994 usable discard/remaining-hand rows. It
stores role-specific discard frequencies, four-card keep frequencies, and
suited-discard rates. Current Models 14.8 through 16.3 use the empirical table
with exact scoring and known-card availability scaling; the literal Schell
matrices are no longer present in the worktree. See the dispatcher and
candidate evaluator in [model.rs](../../rust/cribbage-shadow-engine/model.rs)
and the current runtime assets in
[assets/README.md](../../rust/cribbage-shadow-engine/assets/README.md).

Historical sources for the empirical table are commit
`4e8611ca69e41849df37c39da9790bdb43249439`,
`scripts/build-empirical-discard-keep-table.cjs` and
`web/src/models/rank-crib-discard/empirical-discard-keep-14.8.json`.

## 2. Iteration-2 net-pegging table

### Representation

Model 8 introduced the table Model 9 later reused unchanged. The JSON metadata
identifies source `clean-recursion-20260611-0000/iteration-2.rows.jsonl`, version
2, and 330,590 rows. A row key is:

```text
<13 rank counts for the six-card hand>:<13 rank counts for discard>:<dealer|pone>
```

Its compact value is:

```text
[expected own pegging points, expected opponent pegging points, best pone lead or null]
```

At runtime Model 9 subtracts the second expectation from the first and adds the
result to hand-plus-signed-crib EV. The model-owned asset and use are at commit
`23b9316c2ac5413bce3a1f339f769c36bee2e0a1`,
`web/src/models/schell_table-peg_table-8.0/peg-table-policy.json`, and commit
`bbe0bb5c69116c6e68b3665c62bb529aa7b24146`, `web/src/engine.ts`.

### How it was built

The generator was introduced in commit
`5e98e11f73c1273f15b43f4d700ca92f043e44b8` as
`scripts/generate-iterative-pegging-table.cjs`; the final pre-migration version
is available at commit `97de8860ef1e702dc6910e456f543365286ad342`.

For every legal six-card rank multiset, every legal two-rank discard, and both
roles, it performs the following calculation:

1. Enumerate every possible opponent six-card rank hand from the 46 unseen
   cards, weighted by its number of suit realizations.
2. Choose the opponent's discard with the prior iteration's derived discard
   policy. With no prior policy, use expected rank-only hand score plus or minus
   the hardcoded Schell crib value.
3. Aggregate the resulting opponent four-card keeps and their weights.
4. Recursively enumerate pegging from the candidate own keep against those
   possible opponent keeps, including 15/31, pairs, runs, go, last-card, and
   count reset scoring.
5. Average own and opponent pegging points and derive a new discard policy from
   `hand EV +/- Schell crib EV + (own pegging EV - opponent pegging EV)`.
6. Feed that derived discard policy into the next iteration. Iteration 2 is the
   third such pass (iterations 0, 1, and 2).

The essential limitation is in step 4: after any fixed opening lead, the
recursion branches over every legal next rank and weights branches by the count
of cards of that rank. It averages legal continuations instead of having each
player choose a strategically optimal continuation. The Model 12 documentation
later describes this as the "older averaged-continuation peg table" and notes
that it overestimated pone lead EV against tactical dealer responses.

The final application JSON was produced by
`scripts/build-app-peg-table-policy.cjs`, which rounds the two expectations to
five decimals and retains the best lead. That builder and the full generator
were removed from HEAD by the native migration commit
`95c0ca61b902236f2b37cbd27231e7c7f68d8bcb`, but remain recoverable from Git.

### Better later replacement

Model 12.0 is the cleanest better **EV** replacement. Its pairwise table:

- covers all 1,820 rank-only four-card keeps;
- covers 3,274,375 valid own/opponent keep pairs;
- stores dealer outcomes and pone outcomes by opening lead;
- recursively selects the action maximizing the acting player's net pegging
  points, with own points and a stable rank rule as tie-breakers;
- preserves each `(own points, opponent points, opponent keep, weight)` outcome
  rather than collapsing everything to one mean;
- dynamically reweights opponent keeps against the cards actually known at
  decision time.

The historical manifest is
`97de8860ef1e702dc6910e456f543365286ad342:web/src/models/schell_table-peg_table-12.0/pegging-outcome-pairwise.manifest.json`;
the builder is the same commit's `scripts/build-pegging-outcome-tables.cjs`.
The retained 53 MB artifact is
[model13-pairwise.bin](../../rust/cribbage-shadow-engine/assets/model13-pairwise.bin),
renamed during migration because Model 13 still uses it. The relocation is
recorded in [rust-api-migration-plan.md](../rust-api-migration-plan.md).

Model 14's 93 MB pairwise asset adds EV/on/off policy families. Models 14.8+
combine the Model 12 EV pairwise outcomes with the large empirical opponent
discard/keep population. Current Model 13 also uses the pairwise table and
full paired outcome histogram in discard evaluation; see
[model.rs](../../rust/cribbage-shadow-engine/model.rs), especially
`recommend_discard_model13`, `model13_pegging_discard_options`, and
`aggregate_pairwise_pegging_summary`.

### Do we have enough data to build a better table now?

Yes, in two senses.

First, the superior core pegging result is already built and retained:
`model13-pairwise.bin`. No empirical game sample is required to solve a fixed
rank-only keep-versus-keep pegging matchup under the net-EV policy.

Second, we have substantially better opponent priors than iteration 2 used:

- the Model 14.8 aggregate population from 211,303 games / 2,079,994 discard
  and keep rows is recoverable from Git and retained in packed form as
  [empirical-discard-keep-14.8.bin](../../rust/cribbage-shadow-engine/assets/empirical-discard-keep-14.8.bin);
- completed local compact databases, excluding the active Model 9 benchmark,
  contain at least 44,008 modern games, 795,958 discard rows, 397,979 hand
  rows, and 4,312,029 peg-play rows. These are the 10,000-game 13.0/15.2 run,
  the 30,000-game 15.0/15.2 run, and 4,008 completed Model 16 evaluation games.

A strong pure-EV Model 9 successor should not recreate the old averaged table
verbatim. It should:

1. enumerate all 15 physical discard candidates;
2. use exact hand outcomes and the empirical, cut-conditioned crib histogram;
3. reweight empirical opponent keeps/discards for the known six cards and cut;
4. read the exact pairwise net-EV pegging outcome distribution for each own and
   opponent keep;
5. maximize expected net points only, leaving board win probability out of the
   objective so the experiment remains a true EV model.

That can be emitted as a drop-in 330,590-row table for a controlled Model 9
comparison. Keeping the pairwise representation at runtime is better, however,
because it preserves outcome distributions and known-card reweighting instead
of freezing them back into a single average.

## Source audit commands

```sh
git show a5ba6c6 -- web/src/engine.ts
git blame -L 111,152 bbe0bb5 -- web/src/engine.ts
git show bbe0bb5:web/src/engine.ts
git show 97de8860:scripts/generate-iterative-pegging-table.cjs
git show 97de8860:scripts/build-app-peg-table-policy.cjs
git show 97de8860:scripts/build-pegging-outcome-tables.cjs
git show cfa1543:scripts/build-rank-crib-discard-tables.cjs
git show 4e8611c:scripts/build-empirical-discard-keep-table.cjs
```
