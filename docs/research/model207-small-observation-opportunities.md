# Small observation and policy-path opportunities

2026-10-01. Investigation complete; no retained engine or model-version changes.
The current 20.6-versus-Ace benchmark is unchanged. Any retained implementation
belongs to 20.7 and must preserve the historical version routes.

Unlike regrouping the observation fields, the following changes remove specific
work from the existing path. The first three have a small, unintegrated patch:
23 added lines and 37 removed lines across two engine files. That patch is a
screening candidate, **not compiled, not tested as a changed engine, and not a
versioned release**. Version routing and integration tests are additional work.

## Recommended first screen

### 1. Avoid building legal-action vectors for a yes/no question

`model91.rs:1098`, in `choose_actions_by_wp`, constructs `legal_ranks(...): Vec`
only to test whether its length is at most one. Once a query proceeds to its
evidence group, the actual legal ranks are collected again.

Extract the existing rank iterator behind the existing collecting helper. Use
`nth(1).is_none()` for this question. This stops after finding two distinct legal
ranks, needs no vector, retains the exact existing eligibility predicate, and
leaves rank enumeration and tie order unchanged where the actual list is needed.
Multiple physical copies of one rank still count as a single legal rank.

The final PGO executable confirms the temporary vector has not been optimized
away. Its batch-policy code allocates at `0x100014654`, fills a byte vector, and
compares its length with two at `0x100014718`. These addresses identify the
archived executable only, not a stable source interface.

### 2. Reuse rank-only scoring for immediate tie-breaking points

Three WP paths in `model91.rs` (lines 939, 1166, 1249) collect
`current_series + candidate_rank` into a vector. `score_count_for_ranks` then
materializes a second vector of `Card` values before scoring it.

Use a small shared `immediate_rank_score` helper with a nine-byte stack buffer
(eight supported input ranks plus the proposed rank), calling the existing
`cards::score_count_ranks`. This removes repeated vector/conversion expressions
and reuses a scoring implementation already used by modern rollout transitions.
It does not change the WP calculation, final tie rule, candidate order, or
floating-point addition order. The historical EV scoring paths need not be
rewritten as part of this candidate.

The compiled `score_count_for_ranks` still calls a Vec construction routine and
then `score_count_components`; this is not just a source-level appearance of
extra work. Its scalar body and the inlined batch call sites are archived.

The existing exhaustive legal rank-series comparison through length five, plus
longer series cases, passes against card scoring. An integrated candidate still
needs coverage of the new append helper, all supported lengths, ties, endgame
positions, and exact physical-card/EV/WP parity.

### 3. Let applying a selected action perform its legality check

`model1323_rollout.rs:105` and `:115` first call `RankPegState::allows`, which
builds a mask by inspecting all 13 ranks. They then call
`apply_without_temporary_vectors`, which checks the selected action again.

`apply_play` already checks the rank, possession and count before mutation.
`apply_go` already checks that no rank can be played before mutation. The common
entry point checks terminal state. Use these existing checks and map rejected
actions to the current batch/scalar error messages. This deletes the preceding
scan without deleting the rules check or adding a trusted-state interface.

The proposed scalar edit applies the action before reclaiming observation
buffers, so an invalid result retains the pending observations for the existing
recovery path. This detail must be tested explicitly; merely deleting the first
check and reclaiming buffers before a failed apply would alter error recovery.

Existing transition coverage already compares `allows`, legal-action lists and
both apply paths across randomized hands and invalid actions. A changed-engine
screen must also compare post-error storage and speculative-batch fallback.

These changes occur inside the worlds simulated during pone-opening analysis;
they are not confined to the cost of the actual later card played on screen.
Their aggregate contribution to a full opening is still unmeasured.

## Additional narrow candidates

### 4. Validate cache misses, rather than revalidating exact action-cache hits

Both `choose_action_by_wp` and `choose_actions_by_wp` validate the compact
observation before probing `wp_decisions`. The three insertion sites are reached
only after validation. The full equality key contains every observation field,
likelihood array and both board scores; hashing is not used as equality.

Moving this validation immediately after a failed cache lookup would remove one
validation pass on a hit without a new data type or unchecked constructor. It
does not remove validation on misses. A mutated invalid observation cannot
match a previously validated full key. Current hashing reads fixed fields and
does not index the series using an untrusted length.

Test invalid variants of every validated field after warming the cache; test
capacity clears, both roles, disabled cache admission, scalar/batch routes and
exact errors. Other outer/conversion validations remain. Do not describe this
as eliminating all repeated validation, or assume the compiler removes it: the
PGO binary retains distinct validation calls in the batch adapter.

### 5. Directly index the likelihood cache's cut buckets

`DeclineLikelihoodCache::by_cut` in `model132.rs:658` is a hash map whose only
valid keys are `None` and the 13 ranks. Every likelihood hit first looks up this
outer map and then looks up the exact public history in an inner map.

Fourteen indexed buckets can remove the first hash lookup while retaining the
existing history keys, exact equality, values and 4,096-entry global clear rule.
Keep `None` distinct from every cut rank. Avoid a new packed-history scheme or
different key semantics. Empty bucket storage costs more fixed inline space;
measure construction/clear cost as well as hits. Resetting all buckets must
preserve the intended memory behavior, rather than silently retaining capacity
in every cut bucket.

The existing cache-versus-uncached test over histories/cut variants passes. That
does not test the proposed array replacement or establish its speed.

### 6. Lock the likelihood cache once per existing batch

The batch adapter locks the inner decision solver once, but calls
`opponent_likelihoods` separately for each observation, acquiring the likelihood
cache mutex each time. A private helper taking the already-locked cache could
serve the batch, while the scalar wrapper retains its existing lock.

Keep per-observation cuts, histories, validation and lookup order. Do not pool
beliefs between observations. This is a small local change but adds a helper
and lock-lifetime concerns; rank it below the changes that simply remove work.
Prior owned-solver results do not establish that these locks are a large cost.

## Changes not recommended for this screen

- Broadly remove observation validation. There are external and shared callers;
  not every check is redundant. The cache-hit case above has a narrower proof.
- Cache a second prepared observation or incremental history per world. That
  restores the extra state and reset complexity rejected in earlier work.
- Rewrite public history keys or replace the entire observation/interface.
- Repeat the root-preparation experiment without a different measured cause;
  its prior full-decision gain did not justify the extra path.
- Move duplicate-query lookup earlier as a standalone first optimization. It
  can avoid work only for aliases; fixing the vector predicate already removes
  much of that work for all queries. Measure remaining alias cost first.
- Claim that shared rank scoring necessarily speeds up recursive continuation
  scoring: that continuation path already has its own compact scorer/memo.
  The newly identified work is immediate tie-breaking scoring in the policy.

## Evidence and next gate

Read the retained source and disassembled the final, normal-PGO decision worker.
Saved its SHA-256, selected function assembly, and matching source snippets.
Reran two focused tests from the existing unchanged final-20.6 test executable:
rank-only/card scoring parity and likelihood-cache/uncached-history parity.
Both passed. No new engine build or comparative timing measurement was run.

First test the first three candidates separately, then stack any winners. Require
exact actions, physical card IDs, EV/WP bits, posterior and outcome order,
terminal results, and invalid-action/error-recovery behavior. Use the normal PGO
build, held-out pone/dealer first decisions and actual whole-hand totals, with
matched P/E-core and frequency checks. Include allocation/work counters to
distinguish a tiny local saving from a material full-opening benefit.

The six-worker scored benchmark and the other chat's three ongoing calculations
were left alone. Comparative timing needs explicit CPU scheduling; this
investigation did not start a competing compiler or timing workload.

Evidence and the unintegrated screen patch:
`benchmarks/model20/evaluation-20261001/model207-small-observation-investigation`.
