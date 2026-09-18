const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { summarizeProgress, summarizeGames, renderMarkdown } = require("./report-paired-live-benchmark.cjs");

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paired-eta-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const orientations = [
    { label: "candidate-left", runId: "candidate-run", savedGames: 400 },
    { label: "opponent-left", runId: "opponent-run", savedGames: 200 },
  ];
  for (const orientation of orientations) {
    fs.mkdirSync(path.join(root, orientation.label));
    const status = {
      runId: orientation.runId,
      status: "running",
      updatedAt: "2026-09-18T19:00:00Z",
      // Deliberately stale range counters and ETA: the snapshot counts win.
      savedGames: 10,
      totalGames: 5000,
      gamesPerSecond: 1,
      estimatedRemainingSeconds: 99999,
      ...overrides[orientation.label],
    };
    fs.writeFileSync(path.join(root, orientation.label, "status.json"), JSON.stringify(status));
  }
  return { root, orientations };
}

test("overall ETA uses the later finish and actual snapshot counts", (t) => {
  const { root, orientations } = fixture(t, {
    "opponent-left": { updatedAt: "2026-09-18T19:10:00Z", gamesPerSecond: 2 },
  });
  const progress = summarizeProgress(root, orientations, 1000);
  assert.equal(progress.statuses[0].savedGames, 400);
  assert.equal(progress.statuses[0].estimatedRemainingSeconds, 600);
  assert.equal(progress.eta.estimatedCompletionAt, "2026-09-18T19:16:40.000Z");
  assert.equal(progress.eta.estimatedRemainingSeconds, 400);
  assert.equal(progress.eta.asOf, "2026-09-18T19:10:00.000Z");
  assert.deepEqual(summarizeProgress(root, orientations, 1000), progress);
});

test("uses the selected root's status files and detects a stopped orientation", (t) => {
  const { root, orientations } = fixture(t, { "opponent-left": { status: "failed" } });
  const progress = summarizeProgress(root, orientations, 1000);
  assert.equal(progress.statuses[1].status, "failed");
  assert.equal(progress.eta.estimatedCompletionAt, null);
  assert.match(progress.eta.reason, /opponent-left.*failed/);
});

test("missing or mismatched runner status cannot produce an ETA", (t) => {
  const { root, orientations } = fixture(t, { "candidate-left": { runId: "old-run" } });
  fs.unlinkSync(path.join(root, "opponent-left", "status.json"));
  const progress = summarizeProgress(root, orientations, 1000);
  assert.equal(progress.eta.state, "unavailable");
  assert.equal(progress.eta.estimatedCompletionAt, null);
});

test("invalid status and a zero rate report ETA unavailable", (t) => {
  const { root, orientations } = fixture(t, { "opponent-left": { gamesPerSecond: 0 } });
  fs.writeFileSync(path.join(root, "candidate-left", "status.json"), "null");
  const progress = summarizeProgress(root, orientations, 1000);
  assert.equal(progress.eta.state, "unavailable");
  assert.ok(progress.statuses.every((status) => status.estimatedRemainingSeconds === null));
});

test("finished orientation does not block ETA; both finished means complete", (t) => {
  const { root, orientations } = fixture(t, { "candidate-left": { status: "complete", gamesPerSecond: 0 } });
  orientations[0].savedGames = 1000;
  assert.equal(summarizeProgress(root, orientations, 1000).eta.state, "running");
  orientations[1].savedGames = 1000;
  const eta = summarizeProgress(root, orientations, 1000).eta;
  assert.equal(eta.state, "complete");
  assert.equal(eta.estimatedRemainingSeconds, 0);
});

test("runner completion cannot override an incomplete database snapshot", (t) => {
  const { root, orientations } = fixture(t, {
    "candidate-left": { status: "complete" },
    "opponent-left": { status: "complete" },
  });
  orientations[0].savedGames = 999;
  orientations[1].savedGames = 1000;
  const progress = summarizeProgress(root, orientations, 1000);
  assert.equal(progress.statuses[0].status, "snapshot incomplete");
  assert.equal(progress.eta.state, "unavailable");
  assert.equal(progress.eta.estimatedRemainingSeconds, null);
  assert.match(progress.eta.reason, /candidate-left.*snapshot incomplete/);
});

test("a zero game target cannot establish benchmark completion", (t) => {
  const { root, orientations } = fixture(t, {
    "candidate-left": { status: "complete", totalGames: 0 },
    "opponent-left": { status: "complete", totalGames: 0 },
  });
  assert.equal(summarizeProgress(root, orientations, null).eta.state, "unavailable");
});

test("markdown includes a prominent Pacific completion time and remaining duration", (t) => {
  const { root, orientations } = fixture(t);
  const progress = { observedGames: 600, expectedGames: 2000, ...summarizeProgress(root, orientations, 1000) };
  const report = {
    candidate: "candidate", opponent: "opponent", manifest: {}, progress,
    results: summarizeGames([], [], "candidate", "opponent"),
    orientationAnalysis: {}, phaseScoring: [], availableEventScoring: [],
    evCalibration: [], winProbabilityCalibration: [], timing: [],
    evTelemetry: { legacyImmediatePegModels: [] },
    integrity: { invalidEngineIndexes: [], pairedSeedMismatchIndexes: [] },
  };
  const markdown = renderMarkdown(report);
  assert.match(markdown, /- ETA: \*\*.*Sep 18, 2026.*12:13.*PM PDT.*\*\*.*0h 13m 20s remaining/);
  assert.ok(markdown.indexOf("- ETA:") < markdown.indexOf("## Runner status"));
});
