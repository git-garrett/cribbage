# Model 20.3 hashing and observation overhead

Based on committed scoring-cache revision `7c898a6`, including its selected 1 MiB score memo. Retain both changes below: combined CPU time fell 3.43% across the main regression positions and 3.57% on the held-out subset. The existing long benchmark was not restarted or modified.

## Changes and correctness

`Model91Observation` now hashes its fields in one fixed-length, 67-byte write. Previously, the derived implementation sent many small writes to the hasher. The payload explicitly contains every equality field: all four rank-count arrays, all eight series bytes including inactive slots, role, cut presence and value, active series length, count, go player, and last player. Destructuring lists every field so adding a field requires revisiting the implementation. No struct padding or unsafe memory reads are used.

The existing randomized standard-library hasher and full-key equality remain in place. No key is replaced by a digest, no cache is resized, and the keys' stored representation is unchanged. Hash-table bucket placement changes; cache identity and the order of probability calculations do not. The `Model132Observation` hash used for deterministic diagnostic sampling is unchanged.

The forecast evaluator also keeps two reusable vectors for constructing simulated public observations. Each call still rebuilds the acting player's complete observation, replays its public history in the same order, validates it, calls the policy through the same legal-information boundary, and checks the returned action. Only allocation capacity survives a call. Every field is populated from the current state, including when the actor or simulated world changes. The buffers are local to one forecast and are dropped afterward; there is no stored observation-to-action policy or new persistent cache.

These pegging caches already reside in RAM. Disk files supply model assets and retain benchmark/test artifacts; pegging memo lookups do not use a disk-backed hash store. Caching a precomputed hash is a separate optimization: it could avoid repeated hashing for some lookup/insert pairs, but would require additional key/lifetime handling. This change instead reduces the cost of each hash without adding a stored hash field.

## Method

A fresh sample of the committed baseline still showed substantial time in SipHash writes and allocation associated with observation construction. The sample is saved as `profile.txt` in the artifact directory below.

The candidates were screened separately on six discovery positions, twice in reversed order. Batched hashing reduced CPU by 3.37%; buffer reuse on top reduced it by another 0.90%. These preliminary measurements informed which candidates proceeded to the larger comparison.

The final comparison ran three release workers: committed baseline, hashing only, and hashing plus buffer reuse. All used identical frozen Model 20.3 assets and the same eighteen regression positions (six discovery, twelve held-out validation). Model order rotated between positions and reversed for the second repetition. Workers received the same warm-up. CPU time, rather than elapsed wall time, is reported because the existing six-worker benchmark continued alongside these foreground tests.

## Main results

| Variant | Aggregate CPU over 36 positions | Reduction versus committed baseline |
| --- | ---: | ---: |
| Baseline `7c898a6` | 86.466835 s | reference |
| Batched observation hashing | 83.912239 s | 2.95% |
| Hashing plus reusable observation buffers | 83.503234 s | 3.43% |

Buffer reuse provided a further 0.49% reduction relative to hashing alone. It improved both discovery and validation aggregates by approximately 0.49%, and both role aggregates. Its contribution was smaller in this larger comparison than in the initial screen.

| Group | Combined CPU reduction versus baseline |
| --- | ---: |
| Discovery positions | 3.32% |
| Held-out validation positions | 3.57% |
| Dealer positions | 4.66% |
| Pone positions | 3.21% |
| First execution order | 3.35% |
| Reversed execution order | 3.51% |

These are aggregate CPU measurements for individual decision fixtures. They are not first-play or whole-hand pegging timings, full-game throughput, or a new benchmark ETA.

## Cheap/middle decisions

Six positions received twenty additional three-way repetitions with rotating model order. Excluding each position's first repetition:

| Fixture | Baseline mean CPU | Hashing only | Combined | Combined saving |
| --- | ---: | ---: | ---: | ---: |
| `20.1-left-g0-h1-s3` | 37.507 ms | 35.082 ms | 33.530 ms | 3.977 ms |
| `20.0-left-g0-h1-s4` | 21.917 ms | 19.315 ms | 18.517 ms | 3.401 ms |
| `20.1-left-g1-h1-s2` | 193.627 ms | 172.005 ms | 169.165 ms | 24.462 ms |
| `20.1-left-g1-h1-s7` | 16.207 ms | 13.968 ms | 13.227 ms | 2.980 ms |
| `20.1-left-g1-h6-s3` | 56.244 ms | 50.503 ms | 50.504 ms | 5.740 ms |
| `20.0-left-g1-h6-s4` | 17.576 ms | 15.687 ms | 14.942 ms | 2.635 ms |

The combined reduction ranged from 10% to 18% across these positions. Buffer reuse was effectively tied with hashing alone in the 56 ms baseline case (a 0.001 ms difference); the other five also improved relative to hashing alone. Historical fixture IDs name the source positions; all workers execute Model 20.3.

## Validation and limits

All 36 main three-way comparisons and all 120 cheap/middle three-way comparisons matched exactly for action, card, EV, and WP. Serialized comparisons retain signed zero. Both initial twelve-pair screens also matched. No playing-output regression was observed.

Release tests passed for `model91::`, `model132::`, and `model1323::`, including existing scoring, WP, hidden-information, posterior, and forecast checks. New tests cover:

- Every individual byte value of the observation's array/scalar fields, including inactive series slots, all cut values and presence, and role/go/last alternatives. Distinct equality-field mutations remain distinct in the hash input.
- Full-key lookup under a deliberately constant digest, ensuring collisions cannot substitute another observation.
- Reused versus fresh observations across both actors, different worlds and board scores, complete hands, go/reset events, history shrinking between worlds, invalid inputs, and recovery after errors.

The builds emitted only the pre-existing unused `WeightedEntry` fields warning. Diagnostic timing instrumentation was removed from the source patch. Cache capacities and policy arithmetic are unchanged. The new scratch storage consists only of the two vector capacities retained for one forecast; no new large memory table is introduced. Peak RSS was not separately remeasured for this change.

The timing evidence is finite and specific to this benchmark host. It supports retaining both candidates, but does not establish a speedup for every possible position or another machine.

## Artifacts

`/private/tmp/cribbage-203-key-overhead` contains `profile.py`, `profile.txt`, immutable `reference-worker`, `hash-worker`, and `stack-worker` binaries; `hash-replay.py`, `stack-replay.py`, `final-replay.py`, `tails.py`; their raw result files; `summary.json`, `tails-summary.json`, and `provenance.json`. Provenance records the baseline revision and source/binary hashes. The shared fixture/assets directory remains `/private/tmp/cribbage-model203-vs-model202-10k-20260927-v1`.
