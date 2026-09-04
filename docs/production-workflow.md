# Production workflow

`master` is the production branch. Each unrelated request gets its own branch
from the current `origin/master`; keep unrelated changes out of that branch.

## Start work

From a clean, synchronized checkout:

```bash
git switch master
git pull --ff-only origin master
git switch -c work/SHORT-DESCRIPTION
```

If another checkout has uncommitted or concurrent work, leave it untouched and
use an isolated worktree:

```bash
git fetch origin master
git worktree add -b work/SHORT-DESCRIPTION /private/tmp/cribbage-SHORT-DESCRIPTION origin/master
```

## Review and merge

1. Verify the change in proportion to its risk and commit it on the work branch.
   Run the full Rust suite with `npm test`; successful runs print one summary,
   while failures print the complete Cargo log.
2. Push the branch and open a pull request targeting `master`.
3. Run the repository code-review workflow against `master`, resolve every
   blocking finding, and wait for required GitHub checks.
4. Merge the reviewed pull request. The GitHub `master` ruleset requires this
   PR path and a passing Quality check; direct pushes are reserved for
   repository recovery.
5. Synchronize a clean local `master` with `origin/master`.

## Deploy

Deploy only from that synchronized `master` checkout:

```bash
scripts/deploy-nanode.sh check
scripts/deploy-nanode.sh deploy
```

The deploy command resolves local credentials relative to the repository's main
checkout, even when run from a linked worktree. It then enforces the branch,
clean-tree, and remote-synchronization checks, runs the Python/TypeScript/Rust
test and build suite, compiles the exact Git commit into the server binary, and
accepts production health only when both the host-local and public APIs report
that commit.
