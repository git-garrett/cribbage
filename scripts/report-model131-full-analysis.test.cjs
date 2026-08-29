const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_ROOT,
  ORIENTATIONS,
  analyzerArguments,
  parseArgs,
} = require("./report-model131-full-analysis.cjs");

test("defaults to the legal-lead benchmark and detailed markdown", () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.format, "markdown");
  assert.equal(parsed.root, path.resolve(DEFAULT_ROOT));
});

test("builds an analyzer invocation for each reciprocal orientation", () => {
  for (const orientation of ORIENTATIONS) {
    const args = analyzerArguments("/benchmark", orientation, true);
    assert.deepEqual(args.slice(-4), [
      orientation.runId,
      "--db",
      path.join("/benchmark", orientation.label, "games.db"),
      "--json",
    ]);
  }
});

test("rejects unsupported output formats", () => {
  assert.throws(() => parseArgs(["--format", "csv"]), /unsupported format/);
});
