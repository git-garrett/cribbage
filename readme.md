Cribbage for your command line
============================== 

Implementation of [cribbage][1] for two players. Text-based GUI for use on your 
command line (so you can appear to be working). Several kinds of opponents. 

[1]: https://www.pagat.com/adders/crib6.html

Opponents
---------

- **Random**. This opponent plays a random legal move

- **Expert**. This opponent uses an enumerative strategy to determine the move
  with the greatest possible reward (points), and takes that move. The author
  wrote the optimal policy 

- **Student**. This opponent is a deep neural network that has been trained 
  via self-play using Google [Keras][2] and OpenAI [Gym][3] (see `/train` for details)
  to execute an optimal policy 

[2]: https://keras.io
[3]: https://gym.openai.com

Installation 
------------

Install using `pip`

```
pip install cribbage 
```

Or install from the source (for development, to run the tests)  

```
git clone git@github.com:dacarlin/cribbage.git
cd cribbage
pip install . 
pytest  
```


How to use 
----------

From the command line, specify the kinds of players you want in the game 

```
cribbage human random 
```

You can also name the players  

```
cribbage human random --name1 Osha --name2 Otto
```

If you would like to try playing one of the AI opponents, you can run with the
following

```
cribbage human expert --name1 Alne --name2 Arin
```

Both the **Student** and the **Expert** players achieve performance that is 
better than most humans.   


Help
---- 

Run `cribbage --help`  for an explanation of the command line arguments 


Web UI
------

This checkout also includes a small local browser UI that drives the same
cribbage engine one action at a time.

```
PYTHONPATH=src python3 webapp.py
```

Then open http://127.0.0.1:8765. Select two cards to discard, then click cards
to peg. The board shows both scores with peg dots.

Rust release and benchmark builds
-------------------------------

Native Mac builds automatically generate and validate PGO profiles through
`npm run build:deploy` and `npm run build:benchmark`. See
[Mac PGO builds](docs/mac-pgo-builds.md) for training models and build tooling.

Model 20.4 contains the retained optimizations developed after the latest 20.3
benchmark restart. Model 20.3 preserves its benchmark-era execution choices;
production Ace remains 13.23. See [the version boundary](docs/research/model204-version-boundary.md).
Model 20.5 is frozen for benchmark comparison. Further optimization starts in
[Model 20.6](docs/research/model206-version-boundary.md), which adds decision-local
direct maximum-utility root bounds and validated empirical root ordering while
preserving the 20.5 policy and values.

Model 20.5 adds [reusable packed continuation bases](docs/research/model205-continuation-bases.md)
and [fewer outer-rollout allocations](docs/research/model205-outer-rollout.md).
The separate experimental [20.5.pegging](docs/research/model205-pegging.md) model
uses posterior-weighted knowledge buckets to optimize the acting player's
remaining pegging choices against the existing legal-information opponent policy.
The [20.5.pegging2](docs/research/model205-pegging2.md) experiment recursively
optimizes both players' continuations with each actor's own posterior, retaining
20.5's live and inner valuation paths. The requested single backward traversal
over grouped continuations is not yet implemented.
The [root preparation](docs/research/model205-root-preparation.md),
[invariant evidence](docs/research/model205-invariant-evidence.md),
[early weight rejection](docs/research/model205-early-weight-rejection.md),
[incremental history](docs/research/model205-incremental-history.md), and
[prepared empirical rows](docs/research/model205-empirical-layout.md) prototypes were not retained.
The [20.4 versus 20.3 benchmark](docs/research/model204-vs-model203-benchmark.md) uses a separate frozen build.

Model 20.7 (`schell_table-peg_table-20.7`) retains final 20.6 policy and assets,
with the accepted allocation-free legal-rank predicate in batched WP decisions.
Historical models and the production Ace alias retain their versioned behavior.
See `docs/research/model207-version-boundary.md` for scope and verification.
