# Frozen Model 20.4 versus 20.3 benchmark

The previous 20.3 versus 20.2 benchmark was stopped at the user's request on
2026-09-29 UTC, with 4,568 completed games (2,281 with 20.3 left; 2,287 with 20.2
left). Every completed index and game ID was retained. Both databases passed
SQLite integrity checks and their durable archive hashes match the stopped
runtime copies. Partial results remain under
`benchmarks/model20/evaluation-20260927/20.3-vs-20.2-10k`.

The replacement is a fresh 10,000-game paired benchmark: 5,000 games in each
orientation, candidate `schell_table-peg_table-20.4` and opponent
`schell_table-peg_table-20.3`. Both engines use the same frozen executable, built
from `6786501b7fb05f29932da92157f1d1928075180f`, with fresh Mac PGO training for both
models and no native CPU tuning flags. These are execution-strategy versions of
the same learned model; no strength improvement is assumed.

- Job: `model204-vs-model203-10k-20260929-v1`.
- Runtime: `/private/tmp/cribbage-model204-vs-model203-10k-20260929-v1`.
- Seed: `1012436448`; game seeds are base plus index 0–4999 in each orientation.
- Smoke seed: `1012441448`; smoke games are excluded from scored tables.
- Workers: six total, three per orientation, reusing the prior measured setting.
- Durable results: `benchmarks/model20/evaluation-20260929/20.4-vs-20.3-10k`.
- Supervisor: the versioned `job-v1.json` in the runtime directory.

The seed interval was checked against retained benchmark reservations. The old
experiment contributes no games to the new target. The supervisor separately
builds, freezes/hashes inputs, runs smoke games, plays games, validates full index
intervals and provenance, generates reports, and verifies durable sync. Resume
uses missing index ranges rather than row counts. Frozen input hashes are
verified before starting each orientation and final validation.

The reporter is the retained version with pone/dealer first-decision and
whole-hand pegging timings. Model 20.5 research is isolated from this snapshot;
editing or building it does not change the ongoing benchmark.
