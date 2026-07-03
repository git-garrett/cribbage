# Rust 14.8.1 Port Checklist

## Target

Port the current TypeScript `schell_table-peg_table-14.8.1` decision logic to Rust with exact decision parity for:

- AI discard recommendation: `cardIds`, `cards`, `bestLead`
- AI pegging action: `action`, `cardId`, `card`, `ev`

Node remains authoritative while Rust runs in shadow mode until parity is proven.

## Active Background Run

- Run: `14.8.1-vs-13.0-10k-w8-decision-wp`
- Matchup: `schell_table-peg_table-14.8.1` vs `schell_table-peg_table-13.0`
- Status checked: running, 2,127/10,000 games, 8 workers
- Port target: `schell_table-peg_table-14.8.1`

## Scope Rules

- Port only model decision logic, not UI text, static serving, leaderboard code, or analytics reporting.
- Preserve TypeScript tie-break order and rounding behavior.
- Prefer compact binary/runtime tables over parsing large JSON in Rust at request time.
- Keep the existing Node result authoritative until shadow parity is exact.

## Checklist

- [x] Confirm active run/model target.
- [x] Keep production Node server running and Rust shadow feature flag off by default.
- [x] Define a compact Rust decision request/response contract.
- [x] Add Node-side extraction of discard/pegging decision requests for shadow.
- [x] Add a parity harness that compares Rust decision output to Node decision output.
- [x] Port card representation and cribbage scoring primitives.
- [x] Port rank-count/combinatoric helpers.
- [x] Port board-position win probability.
- [x] Port packed pairwise pegging table reader.
- [x] Port empirical discard/keep table reader or packed equivalent.
- [x] Port 14.8.1 empirical discard candidate evaluation.
- [x] Port model-13 live pegging opponent-hand distribution.
- [x] Port model-13 live pegging simulation/choice logic.
- [x] Run discard parity fixtures.
- [x] Run pegging parity fixtures.
- [x] Run shadow QA on production host with Rust enabled on a temporary host build.
- [x] Fix parity/performance issues found in QA.
- [x] Deploy behind production feature flag, still Node-authoritative.

## Current Notes

- Local `rustc`/`cargo` are not installed.
- Production host has `rustc`/`cargo` installed and successfully compiled the 14.8.1 shadow sidecar.
- Deployed `/api/model` reports `rustShadow.enabled:false`, a present Rust binary, and a model allowlist of `schell_table-peg_table-14.8` and `schell_table-peg_table-14.8.1`.
- Deployed sidecar supports 14.8/14.8.1 decisions when Node sends a compact `decision.inputText` shadow payload.
- Shadow requests now include a compact `decision` object and compare `rustResponse.decision` to the Node decision when Rust returns supported output.
- Explicit discard decisions are available from preparation responses and `/api/ai/discard`; explicit pegging decisions are available from `/api/ai/peg`. Production `/api/game/action` pegging via `advance-pegging` now emits an env-gated `pegRecommendation` and decision snapshot only when `CRIBBAGE_RUST_SHADOW=1`, so normal production remains unchanged with the flag off.
- P12P pairwise reader compiles and validates the deployed table/key order on the production host in `/tmp`.
- 14.8.1 discard grouping is not ported as a separate optimization; Rust evaluates all 15 physical discard candidates in TypeScript order. This keeps the decision surface equivalent while avoiding grouping-specific complexity.
- Temporary production-host QA passes: scoring self-test, pairwise self-test, empirical table self-test, model13 hold-table self-test, three discard parity fixtures, and three pegging parity fixtures.
- Deployed production-host sidecar self-tests pass: scoring, pairwise table, empirical discard/keep table, and model13 hold table.
