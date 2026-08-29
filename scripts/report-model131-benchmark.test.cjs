const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const {
  buildReport,
  exactSweepSignTest,
  parseArgs,
  standardErrorForProportion,
  wilson95,
} = require("./report-model131-benchmark.cjs");

const MODEL130 = "schell_table-peg_table-13.0";
const MODEL131 = "schell_table-peg_table-13.1";

function writeFixtureDatabase(databasePath, candidateOnLeft) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE compact_games (
      game_id TEXT PRIMARY KEY,
      game_index INTEGER,
      random_seed TEXT,
      left_engine TEXT,
      right_engine TEXT,
      winner INTEGER,
      final_left_score INTEGER,
      final_right_score INTEGER
    );
    CREATE TABLE compact_discards (
      game_id TEXT,
      model TEXT,
      decision_elapsed_us INTEGER
    );
    CREATE TABLE compact_peg_plays (
      game_id TEXT,
      model TEXT,
      decision_elapsed_us INTEGER
    );
  `);
  const insertGame = db.prepare(
    "INSERT INTO compact_games VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDiscard = db.prepare(
    "INSERT INTO compact_discards VALUES (?, ?, ?)",
  );
  const insertPeg = db.prepare(
    "INSERT INTO compact_peg_plays VALUES (?, ?, ?)",
  );
  const left = candidateOnLeft ? MODEL131 : MODEL130;
  const right = candidateOnLeft ? MODEL130 : MODEL131;
  for (let gameIndex = 0; gameIndex < 2; gameIndex += 1) {
    const gameId = `game-${candidateOnLeft ? "candidate-left" : "baseline-left"}-${gameIndex}`;
    const candidateWins = gameIndex === 0;
    const winner = candidateWins
      ? candidateOnLeft ? 0 : 1
      : candidateOnLeft ? 1 : 0;
    const leftScore = winner === 0 ? 121 : 110;
    const rightScore = winner === 1 ? 121 : 110;
    insertGame.run(
      gameId,
      gameIndex,
      String(100 + gameIndex),
      left,
      right,
      winner,
      leftScore,
      rightScore,
    );
    insertDiscard.run(gameId, MODEL131, 100 + gameIndex);
    insertDiscard.run(gameId, MODEL130, 200 + gameIndex);
    insertPeg.run(gameId, MODEL131, 300 + gameIndex);
    insertPeg.run(gameId, MODEL130, 400 + gameIndex);
  }
  db.close();
}

test("statistical helpers return stable known values", () => {
  assert.equal(standardErrorForProportion(50, 100), 0.05);
  assert.ok(Math.abs(exactSweepSignTest(0, 3) - 0.25) < 1e-12);
  assert.equal(exactSweepSignTest(1, 1), 1);
  const interval = wilson95(50, 100);
  assert.ok(Math.abs(interval.lower - 0.4038315303659956) < 1e-12);
  assert.ok(Math.abs(interval.upper - 0.5961684696340044) < 1e-12);
});

test("report is deterministic and keeps phase, error, pairing, timing, and integrity", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "model131-report-"));
  try {
    for (const label of ["13.1-left", "13.0-left"]) {
      fs.mkdirSync(path.join(root, label));
    }
    writeFixtureDatabase(path.join(root, "13.1-left", "games.db"), true);
    writeFixtureDatabase(path.join(root, "13.0-left", "games.db"), false);
    fs.writeFileSync(
      path.join(root, "manifest.txt"),
      [
        "gamesPerOrientation=2",
        "totalGames=4",
        "experiment=fixture",
        "optimizedResumeAt=2026-01-01T00:00:00Z",
        "optimizedResume131LeftIndex=1",
        "optimizedResume130LeftIndex=1",
        "optimizedRepair131LeftIndexes=",
        "optimizedRepair130LeftIndexes=",
        "",
      ].join("\n"),
    );
    const status = {
      status: "complete",
      updatedAt: "2026-01-01T01:00:00Z",
      completedGames: 2,
      gamesPerSecond: 1,
      estimatedRemainingSeconds: 0,
    };
    fs.writeFileSync(
      path.join(root, "13.1-left", "status.json"),
      `${JSON.stringify(status)}\n`,
    );
    fs.writeFileSync(
      path.join(root, "13.0-left", "status.json"),
      `${JSON.stringify(status)}\n`,
    );
    const options = parseArgs(["--root", root]);
    const first = buildReport(options);
    const second = buildReport(options);

    assert.deepEqual(first, second);
    assert.equal(first.progress.phase, "complete");
    assert.equal(first.combined.games, 4);
    assert.equal(first.combined.model131Wins, 2);
    assert.equal(first.combined.model131WinRate, 0.5);
    assert.equal(first.paired.completePairs, 2);
    assert.equal(first.paired.model131WonBoth, 1);
    assert.equal(first.paired.model130WonBoth, 1);
    assert.equal(first.paired.split, 0);
    assert.equal(first.integrity.errors.length, 0);
    assert.equal(first.integrity.warnings.length, 0);
    assert.deepEqual(
      first.timing.discards.map((row) => row.phase),
      ["optimized", "optimized", "original", "original"],
    );
    assert.equal(Object.hasOwn(first, "generatedAt"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
