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
   Follow `docs/compact-output.md` for the canonical commands and output rules.
2. Push the branch and open a pull request targeting `master` from the CLI:

   ```bash
   git push -u origin "$(git branch --show-current)"
   scripts/github-release-pr.sh create "Concise release title" /tmp/pr-body.md
   ```

   The helper uses the existing `github.com` HTTPS credential through
   `git credential fill` and the GitHub API. It does not require `gh`, a browser,
   or a ChatGPT/Codex GitHub connector. Never print the credential or paste it
   into a command response.
3. Run the repository code-review workflow against `master`, resolve every
   blocking finding, then wait for the required GitHub check:

   ```bash
   scripts/github-release-pr.sh wait
   ```

4. Merge the reviewed pull request from the CLI. The helper refuses to merge
   unless the exact PR head has a successful `test` check:

   ```bash
   scripts/github-release-pr.sh merge
   ```

   The GitHub `master` ruleset requires this PR path and a passing Quality
   check; direct pushes are reserved for repository recovery. Do not substitute
   browser automation or connector setup for this credential-backed CLI path.
5. Synchronize a clean local `master` with `origin/master`.

## Deploy

Deploy only from that synchronized `master` checkout:

```bash
scripts/deploy-nanode.sh check
scripts/deploy-nanode.sh deploy
```

If another production deployment is running, stop after preparing the reviewed
feature branch. Do not merge its PR until the active deployment has completed;
then refresh `origin/master`, update the feature branch if needed, rerun review
and Quality, merge, synchronize the dedicated clean `master` worktree, and run
the deployment commands above. Never use the dirty shared `server` checkout for
production.

The deploy command resolves local credentials relative to the repository's main
checkout, even when run from a linked worktree. It then enforces the branch,
clean-tree, and remote-synchronization checks and runs the complete local QA and
browser build. Because the development machine is macOS arm64 and production is
Linux x86-64, the locked Rust source is compiled natively on the server in an
isolated staging workspace while the existing release keeps serving. A shared
Cargo target cache speeds later builds, but only the finished API binary is
copied into each immutable, versioned release. Previously deployed hashed
browser assets are carried into the candidate before the new bundle is overlaid
so in-flight and recently opened clients keep working across the cutover.

After validating the candidate Caddy configuration, deployment atomically moves
the `/opt/cribbage/current` symlink, reloads Caddy, and restarts the API. Caddy
retries upstream connection attempts for five seconds to bridge the short API
restart. Failed local health, public health, or cache-contract checks restore
the prior symlink and service configuration automatically. This is a
near-zero-interruption cutover; a dual-process blue/green deployment is avoided
because active game sessions also live in process memory and overlapping API
instances could briefly diverge.
