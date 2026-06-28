# Schell Table + Peg Table 14.5

14.5 keeps the 14.3 framework and replaces fixed on/off choices with frontier alternatives.

## Discarding

14.5 evaluates three paired strategy families: EV, frontier-on, and frontier-off. Each frontier entry represents a distinct point-pair outcome that survived the bounded on/off search. Rows that collapse to EV are omitted, so missing frontier entries fall back to EV.

At discard time the engine scores each paired strategy by current-board win probability, then chooses the best discard by win probability with net EV as the tie-breaker.

## Pegging

14.5 uses the same live model-13 pegging tree for actual pegging play. Its frontier pegging table improves discard-time pegging forecasts and pone lead shortcuts where non-EV alternatives exist.

## Purpose

This model tests whether preserving multiple useful on/off alternatives is better than reducing them to one bounded on and one bounded off option.
