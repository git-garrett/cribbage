# Continuous Ace and self-play training

Local experiment-runtime update for Models 31 and 32. User request: consume Ace
labels when ready, train with self-play while waiting, maximize Ace workers as
system capacity allows, and restore WP learning with greater weight on recent
games. This changes the local coordinator, not the production web service.

The coordinator checks Ace first, completes any pending transaction, then
alternates bounded self-play chunks between the models when neither has enough
new labels. Each chunk uses 32 exploratory and 32 greedy games, immutable input,
fresh globally reserved seeds, and the existing native C++ GPU trainers and Rust
rules. Model 31 fits exploratory rows; Model 32 retains its original behavior of
fitting exploratory and greedy rows. Only greedy evidence updates WP.

Both WP implementations use exponential decay with a 2,000,000-game half-life:
old evidence is multiplied by `2 ** (-new_greedy_games / 2_000_000)` before new
wins and visits are added. The existing prior remains. Weights, Adam state and
WP publish at a completed chunk boundary. Self-play never advances Ace cursors.
Ace ingestion and periodic checkpoint snapshots both follow the latest complete
checkpoint, including self-play updates. The 6-hour checkpoint cadence and held
10k benchmark are unchanged.

Ace uses available shared CPU reservations, leaving one core for responsiveness.
The old fixed ceiling of eight is removed. Warning memory pressure caps the
budget at four, recent swapping at two, and critical memory/thermal pressure
parks work. Normal capacity is reconsidered each chunk and native teaching call.

`hybrid-state.json` journals the active chunk and alternation. A receipt makes
publication idempotent after a crash. Partial native batches and learning
journals resume against immutable inputs. Only measured resource pauses retry;
integrity errors fail the existing one-shot supervisor and existing failure
email monitor. Self-play traces, evidence and training rows are hash-verified
on the archive before local staging and superseded self-play checkpoints are
released. Full model snapshots remain in the existing periodic archive.

This bundle targets the existing persistent runtime
`ace-continuous-model31-d32-v1`. Native libraries and source dependencies remain
frozen there; no model/kernel rebuild or Python learning implementation is added.
`model31_train.py` and `model32_train.py` are installed as each model's `train.py`.
`pilot.py` runs isolated native GPU checks against immutable periodic snapshots.
`install.py` requires its successful receipt, cooperatively pauses both jobs,
backs up the payload/configuration, verifies writer locks and cursors, installs,
and resumes through the established one-shot supervisor. A failed installation
restores the prior bundle and resumes it.

Validation:

```sh
scripts/run-quiet.sh 'Hybrid coordinator checks' python3 -m unittest discover -s experiments/ace_continuous -p test_hybrid.py
```

Native pilot: gradients and Adam steps advance for both models; WP advances by
the exact greedy-game count with the expected recency decay; Ace cursors stay
unchanged; repeating a completed transaction makes no additional updates.

The frozen Ace Rust teacher also originally rejected requests above eight
workers. `native_teacher.py` changes that validation/default to the machine's
CPU count, leaving the frozen game rules, policy and assets intact. It builds
and tests through persistent one-shot stages and verifies identical discard and
pegging actions against the original executable. `upgrade_teacher.py` waits for
the collector's committed boundary, exercises the full parallel budget, records
the new executable hash and resumes collection while GPU training continues.
Startup also probes the backend with empty teacher requests, so an older binary
safely retains its supported worker limit instead of crashing at its first
larger batch. Unexpected native errors still fail and notify.
