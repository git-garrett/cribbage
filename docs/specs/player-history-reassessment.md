# Player history reassessment

The requested repair is to copy all of Garrett's saved games locally, rebuild his
handicap using the opponent model actually played in each game, then review his
recorded choices against the latest Ace and update his stats to show that
comparison separately.

- Preserve original games, scores, opponent identity, and prior review evidence.
- Recover the original opponent from the native session or original game-start
  record, rather than a model label overwritten by a later browser upload.
- Never substitute latest Ace for an unavailable historical opponent evaluator.
  Mark that historical evidence unavailable. Review recoverable human choices
  against latest Ace even when the original opponent no longer supports WP.
- Use only information available to the human at the time of each choice.
  Hidden opponent cards and future draws must not enter an observation.
- Rebuild the existing 18-game-half-life handicap from chronological, completed,
  unassisted, role-balanced two-hand cycles; retain its game-length normalization.
  Rebuild the handicap fields without altering Dynamic's strength calibration.
- Show a separately labelled latest-Ace moving average, all-game mean, date, and
  complete/partial/unavailable coverage. Update decision reviews and mistake
  stats with the latest comparison; original opponents remain the game labels.
- Keep reviews in an account-scoped server overlay so a stale browser upload
  cannot replace them. Keep source archives and reports private, outside Git.
- Verify identities, source and executable hashes, review completeness, WP bounds,
  and the current profile before importing. Back up the database before writing.
  Refuse to overwrite a profile or omit new games completed since the source copy.

This is a historical reassessment as of the captured date. The labelled comparison
is a snapshot; subsequent live games continue using the application's normal
review and handicap update path.

Offline tools: `review_player_history.py prepare/run`, followed by
`report_player_history.py`, then a dry run and application through
`import_player_history.py`. Run long work with the one-shot job supervisor.
