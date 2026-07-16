# Rust runner operations

The Node background launchers and status reporter were retired with the Node
gameplay engine. Do not use old `scripts/launch-background.cjs`,
`scripts/report-background-status.cjs`, or `npm run status:background`
commands.

Run and inspect new simulation work through the Rust workspace instead:

```sh
cargo run --release --manifest-path rust/cribbage-runner/Cargo.toml -- --help
```

The runner writes its declared output directory and SQLite data. For a running
job, inspect the saved `status.json`, SQLite file, and its PID directly. The
current production service is separate: check it with
`systemctl status cribbage` on the Nanode and `https://cribbage.strongcribbage.com/health`.
