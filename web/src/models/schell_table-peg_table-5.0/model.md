# Schell Table + Peg Table 5.0

Default Schell peg-table model.

- Discard logic: same structure as 4.0, but with the expanded iteration 0 peg table.
- Crib logic: uses Schell own/opponent crib tables.
- Pegging logic: uses the expanded peg table for more discard situations, with neutral peg EV for remaining missing rows.

Improvement over prior model: adds 23,555 peg-table rows that 4.0 lacked, reducing fallback cases during discard analysis.
