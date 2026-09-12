# Generated training drills

`easy-drills.json` is generated from completed game uploads. It deliberately omits
player tags, game IDs, timestamps, scores, and review metadata.

Regenerate it whenever completed-game data grows:

```sh
npm run build:training-drills
```

An easy discard has one unique four-card keep with the highest made score before
the cut, leads the runner-up by at least four points, and matches the reviewed
recommendation or computer's recorded play. An easy scoring play has at least
two legal choices, exactly one card that scores immediately, and no other legal
card that scores.

The web client treats each generated list as a randomized cycle. Correctly
solved drill IDs are stored locally and remain out of rotation until the whole
list has been completed. Content added by a later regeneration automatically
joins the pool.
