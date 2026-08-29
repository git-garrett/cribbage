#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const MODEL130 = "schell_table-peg_table-13.0";
const MODEL131 = "schell_table-peg_table-13.1";
const Z95 = 1.959963984540054;

function usage() {
  return [
    "usage:",
    "  node scripts/report-model131-benchmark.cjs --root BENCHMARK_ROOT [--format json|markdown]",
    "  node scripts/report-model131-benchmark.cjs MODEL131_LEFT_DB MODEL130_LEFT_DB [--format json|markdown]",
  ].join("\n");
}

function parseArgs(argv) {
  let format = "json";
  let root = null;
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--format") {
      format = argv[index + 1];
      index += 1;
    } else if (value === "--root") {
      root = argv[index + 1];
      index += 1;
    } else if (value === "--help" || value === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else {
      positional.push(value);
    }
  }
  if (format !== "json" && format !== "markdown") {
    throw new Error(`unsupported format ${format}; expected json or markdown`);
  }
  if (root && positional.length) {
    throw new Error("use either --root or two database paths, not both");
  }
  if (root) {
    return {
      format,
      root,
      model131LeftPath: path.join(root, "13.1-left", "games.db"),
      model130LeftPath: path.join(root, "13.0-left", "games.db"),
    };
  }
  if (positional.length !== 2) throw new Error(usage());
  return {
    format,
    root: path.dirname(path.dirname(positional[0])),
    model131LeftPath: positional[0],
    model130LeftPath: positional[1],
  };
}

function readKeyValueFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseIndexSet(value) {
  if (!value) return new Set();
  return new Set(value.split(",").filter(Boolean).map(Number));
}

function modelSide(game, model) {
  if (game.left_engine === model) return 0;
  if (game.right_engine === model) return 1;
  throw new Error(`${model} is absent from game ${game.game_index}`);
}

function timingPhase(gameIndex, resumeIndex, repairIndexes) {
  if (repairIndexes.has(gameIndex)) return "optimized";
  if (resumeIndex !== null && gameIndex >= resumeIndex) return "optimized";
  return resumeIndex === null ? "all" : "original";
}

function aggregateTiming(rows, resumeIndex, repairIndexes) {
  const aggregates = new Map();
  for (const row of rows) {
    const phase = timingPhase(Number(row.game_index), resumeIndex, repairIndexes);
    const key = `${phase}\u0000${row.model}`;
    const current = aggregates.get(key) || {
      phase,
      model: row.model,
      decisions: 0,
      totalUs: 0,
    };
    current.decisions += 1;
    current.totalUs += Number(row.elapsed_us);
    aggregates.set(key, current);
  }
  return [...aggregates.values()]
    .map(({ totalUs, ...value }) => ({
      ...value,
      averageUs: totalUs / value.decisions,
    }))
    .sort((left, right) =>
      left.phase.localeCompare(right.phase) || left.model.localeCompare(right.model),
    );
}

function readDatabase(label, databasePath, resumeIndex, repairIndexes) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const games = db.prepare(
    "SELECT game_index, random_seed, left_engine, right_engine, winner, final_left_score, final_right_score FROM compact_games ORDER BY game_index",
  ).all();
  const discardRows = db.prepare(
    "SELECT g.game_index, d.model, d.decision_elapsed_us elapsed_us FROM compact_discards d JOIN compact_games g ON g.game_id = d.game_id WHERE d.model IS NOT NULL AND d.decision_elapsed_us IS NOT NULL",
  ).all();
  const pegRows = db.prepare(
    "SELECT g.game_index, p.model, p.decision_elapsed_us elapsed_us FROM compact_peg_plays p JOIN compact_games g ON g.game_id = p.game_id WHERE p.model IS NOT NULL AND p.decision_elapsed_us IS NOT NULL",
  ).all();
  db.close();

  const indexes = games.map((game) => Number(game.game_index));
  const indexSet = new Set(indexes);
  const maximumIndex = indexes.length ? Math.max(...indexes) : -1;
  const missingThroughMaximum = [];
  for (let index = 0; index <= maximumIndex; index += 1) {
    if (!indexSet.has(index)) missingThroughMaximum.push(index);
  }
  let contiguousPrefixGames = 0;
  while (indexSet.has(contiguousPrefixGames)) contiguousPrefixGames += 1;

  return {
    label,
    path: databasePath,
    games,
    integrity: {
      databaseGames: games.length,
      minimumIndex: indexes.length ? Math.min(...indexes) : null,
      maximumIndex: maximumIndex >= 0 ? maximumIndex : null,
      contiguousPrefixGames,
      missingThroughMaximum,
      duplicateIndexes: indexes.length - indexSet.size,
    },
    timing: {
      discards: aggregateTiming(discardRows, resumeIndex, repairIndexes),
      pegs: aggregateTiming(pegRows, resumeIndex, repairIndexes),
    },
  };
}

function wilson95(wins, games) {
  if (!games) return { lower: null, upper: null };
  const proportion = wins / games;
  const denominator = 1 + (Z95 * Z95) / games;
  const center = (proportion + (Z95 * Z95) / (2 * games)) / denominator;
  const margin = Z95 * Math.sqrt(
    (proportion * (1 - proportion)) / games +
      (Z95 * Z95) / (4 * games * games),
  ) / denominator;
  return { lower: center - margin, upper: center + margin };
}

function standardErrorForProportion(wins, games) {
  if (!games) return null;
  const proportion = wins / games;
  return Math.sqrt((proportion * (1 - proportion)) / games);
}

function sampleMean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardErrorForMean(values) {
  if (values.length < 2) return null;
  const mean = sampleMean(values);
  const variance = values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  ) / (values.length - 1);
  return Math.sqrt(variance / values.length);
}

function normal95(mean, standardError) {
  if (mean === null || standardError === null) return { lower: null, upper: null };
  return {
    lower: mean - Z95 * standardError,
    upper: mean + Z95 * standardError,
  };
}

function exactSweepSignTest(model131Sweeps, model130Sweeps) {
  const trials = model131Sweeps + model130Sweeps;
  if (!trials) return 1;
  const tail = Math.min(model131Sweeps, model130Sweeps);
  const logs = [];
  for (let successes = 0; successes <= tail; successes += 1) {
    let logCombination = 0;
    for (let value = 1; value <= successes; value += 1) {
      logCombination += Math.log(trials - successes + value) - Math.log(value);
    }
    logs.push(logCombination - trials * Math.log(2));
  }
  const maximum = Math.max(...logs);
  const oneTail = Math.exp(maximum) * logs.reduce(
    (sum, value) => sum + Math.exp(value - maximum),
    0,
  );
  return Math.min(1, 2 * oneTail);
}

function summarizeOrientation(database) {
  let model131Wins = 0;
  let model131Score = 0;
  let model130Score = 0;
  const margins = [];
  for (const game of database.games) {
    const candidateSide = modelSide(game, MODEL131);
    if (Number(game.winner) === candidateSide) model131Wins += 1;
    const candidateScore = Number(
      candidateSide === 0 ? game.final_left_score : game.final_right_score,
    );
    const baselineScore = Number(
      candidateSide === 0 ? game.final_right_score : game.final_left_score,
    );
    model131Score += candidateScore;
    model130Score += baselineScore;
    margins.push(candidateScore - baselineScore);
  }
  const games = database.games.length;
  const winRate = games ? model131Wins / games : null;
  const winRateStandardError = standardErrorForProportion(model131Wins, games);
  const averageScoreAdvantage = sampleMean(margins);
  const scoreAdvantageStandardError = standardErrorForMean(margins);
  return {
    label: database.label,
    database: database.path,
    model131Side: database.games[0] && modelSide(database.games[0], MODEL131) === 0
      ? "left"
      : "right",
    games,
    model131Wins,
    model130Wins: games - model131Wins,
    model131WinRate: winRate,
    model131WinRateDifferenceFromEven: winRate === null ? null : winRate - 0.5,
    model131WinRateStandardError: winRateStandardError,
    model131Wilson95: wilson95(model131Wins, games),
    model131AverageScore: games ? model131Score / games : null,
    model130AverageScore: games ? model130Score / games : null,
    model131AverageScoreAdvantage: averageScoreAdvantage,
    model131ScoreAdvantageStandardError: scoreAdvantageStandardError,
    model131ScoreAdvantageNormal95: normal95(
      averageScoreAdvantage,
      scoreAdvantageStandardError,
    ),
    integrity: database.integrity,
  };
}

function combineTiming(databases, kind) {
  const aggregates = new Map();
  for (const database of databases) {
    for (const row of database.timing[kind]) {
      const key = `${row.phase}\u0000${row.model}`;
      const current = aggregates.get(key) || {
        phase: row.phase,
        model: row.model,
        decisions: 0,
        totalUs: 0,
      };
      current.decisions += row.decisions;
      current.totalUs += row.averageUs * row.decisions;
      aggregates.set(key, current);
    }
  }
  return [...aggregates.values()]
    .map(({ totalUs, ...value }) => ({
      ...value,
      averageUs: totalUs / value.decisions,
    }))
    .sort((left, right) =>
      left.phase.localeCompare(right.phase) || left.model.localeCompare(right.model),
    );
}

function summarizeProgress(root, orientations, manifest) {
  const statuses = {
    "13.1-left": readJsonFile(path.join(root, "13.1-left", "status.json")),
    "13.0-left": readJsonFile(path.join(root, "13.0-left", "status.json")),
  };
  const totalGames = Number(manifest.totalGames || 10_000);
  const databaseGames = orientations.reduce((sum, item) => sum + item.games, 0);
  const statusValues = Object.values(statuses).filter(Boolean);
  const status = databaseGames >= totalGames
    ? "complete"
    : statusValues.some((value) => value.status === "running")
      ? "running"
      : "partial";
  const snapshotAt = statusValues
    .map((value) => value.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const completionTimes = statusValues
    .filter((value) =>
      value.updatedAt && Number.isFinite(Number(value.estimatedRemainingSeconds)))
    .map((value) =>
      Date.parse(value.updatedAt) + Number(value.estimatedRemainingSeconds) * 1000);
  const estimatedCompletionAt = completionTimes.length
    ? new Date(Math.max(...completionTimes)).toISOString()
    : null;
  const estimatedRemainingSeconds = estimatedCompletionAt && snapshotAt
    ? Math.max(0, (Date.parse(estimatedCompletionAt) - Date.parse(snapshotAt)) / 1000)
    : null;
  return {
    status,
    phase: status === "complete"
      ? "complete"
      : manifest.optimizedResumeAt
        ? "optimized-resume"
        : "initial-run",
    snapshotAt,
    databaseGames,
    totalGames,
    progressFraction: totalGames ? databaseGames / totalGames : null,
    estimatedRemainingSeconds,
    estimatedCompletionAt,
    orientations: Object.fromEntries(orientations.map((orientation) => {
      const value = statuses[orientation.label];
      return [orientation.label, {
        runnerStatus: value?.status || null,
        statusUpdatedAt: value?.updatedAt || null,
        statusCompletedGames: value ? Number(value.completedGames) : null,
        databaseGames: orientation.games,
        gamesPerSecond: value ? Number(value.gamesPerSecond) : null,
        estimatedRemainingSeconds: value
          ? Number(value.estimatedRemainingSeconds)
          : null,
      }];
    })),
  };
}

function buildReport(options) {
  const manifest = readKeyValueFile(path.join(options.root, "manifest.txt"));
  const databaseSpecs = [
    {
      label: "13.1-left",
      databasePath: options.model131LeftPath,
      resumeIndex: manifest.optimizedResume131LeftIndex
        ? Number(manifest.optimizedResume131LeftIndex)
        : null,
      repairIndexes: parseIndexSet(manifest.optimizedRepair131LeftIndexes),
    },
    {
      label: "13.0-left",
      databasePath: options.model130LeftPath,
      resumeIndex: manifest.optimizedResume130LeftIndex
        ? Number(manifest.optimizedResume130LeftIndex)
        : null,
      repairIndexes: parseIndexSet(manifest.optimizedRepair130LeftIndexes),
    },
  ];
  const databases = databaseSpecs.map((spec) => readDatabase(
    spec.label,
    spec.databasePath,
    spec.resumeIndex,
    spec.repairIndexes,
  ));
  const orientations = databases.map(summarizeOrientation);
  const allMargins = [];
  let model131Wins = 0;
  const byIndex = new Map();
  for (const database of databases) {
    for (const game of database.games) {
      const candidateSide = modelSide(game, MODEL131);
      const candidateWon = Number(game.winner) === candidateSide;
      const candidateScore = Number(
        candidateSide === 0 ? game.final_left_score : game.final_right_score,
      );
      const baselineScore = Number(
        candidateSide === 0 ? game.final_right_score : game.final_left_score,
      );
      model131Wins += candidateWon ? 1 : 0;
      allMargins.push(candidateScore - baselineScore);
      const values = byIndex.get(Number(game.game_index)) || [];
      values.push({ candidateWon, margin: candidateScore - baselineScore });
      byIndex.set(Number(game.game_index), values);
    }
  }

  let model131WonBoth = 0;
  let split = 0;
  let model130WonBoth = 0;
  let incompletePairs = 0;
  const pairedWinFractions = [];
  const pairedAverageMargins = [];
  for (const values of byIndex.values()) {
    if (values.length !== 2) {
      incompletePairs += 1;
      continue;
    }
    const wins = values.filter((value) => value.candidateWon).length;
    if (wins === 2) model131WonBoth += 1;
    else if (wins === 0) model130WonBoth += 1;
    else split += 1;
    pairedWinFractions.push(wins / 2);
    pairedAverageMargins.push((values[0].margin + values[1].margin) / 2);
  }

  const games = allMargins.length;
  const winRate = games ? model131Wins / games : null;
  const winRateStandardError = standardErrorForProportion(model131Wins, games);
  const averageScoreAdvantage = sampleMean(allMargins);
  const scoreAdvantageStandardError = standardErrorForMean(allMargins);
  const pairedWinRate = sampleMean(pairedWinFractions);
  const pairedWinRateStandardError = standardErrorForMean(pairedWinFractions);
  const pairedScoreAdvantage = sampleMean(pairedAverageMargins);
  const pairedScoreAdvantageStandardError = standardErrorForMean(pairedAverageMargins);
  const progress = summarizeProgress(options.root, orientations, manifest);
  const warnings = [];
  if (incompletePairs) {
    warnings.push(`${incompletePairs} seed indexes currently have only one completed orientation`);
  }
  for (const orientation of orientations) {
    if (orientation.integrity.missingThroughMaximum.length) {
      warnings.push(
        `${orientation.label} has ${orientation.integrity.missingThroughMaximum.length} in-flight gaps through its current maximum index`,
      );
    }
  }

  return {
    schemaVersion: 2,
    benchmarkRoot: options.root,
    candidate: MODEL131,
    baseline: MODEL130,
    progress,
    design: {
      changedDimension: manifest.experiment || "discard-time-pegging-histogram-only",
      gamesPerOrientation: Number(manifest.gamesPerOrientation || 5_000),
      totalGames: Number(manifest.totalGames || 10_000),
      pairedSeedAcrossOrientations: true,
      alternatingFirstDealWithinOrientation: true,
      openingLeadSelection: manifest.openingLeadSelection || "post-cut-model13.0-live",
    },
    provenance: manifest,
    combined: {
      games,
      model131Wins,
      model130Wins: games - model131Wins,
      model131WinRate: winRate,
      model131WinRateDifferenceFromEven: winRate === null ? null : winRate - 0.5,
      model131WinRateStandardError: winRateStandardError,
      model131Wilson95: wilson95(model131Wins, games),
      model131AverageScoreAdvantage: averageScoreAdvantage,
      model131ScoreAdvantageStandardError: scoreAdvantageStandardError,
      model131ScoreAdvantageNormal95: normal95(
        averageScoreAdvantage,
        scoreAdvantageStandardError,
      ),
    },
    paired: {
      completePairs: pairedWinFractions.length,
      incompletePairs,
      model131WonBoth,
      split,
      model130WonBoth,
      model131WinRate: pairedWinRate,
      model131WinRateStandardError: pairedWinRateStandardError,
      model131WinRateNormal95: normal95(pairedWinRate, pairedWinRateStandardError),
      model131AverageScoreAdvantage: pairedScoreAdvantage,
      model131ScoreAdvantageStandardError: pairedScoreAdvantageStandardError,
      model131ScoreAdvantageNormal95: normal95(
        pairedScoreAdvantage,
        pairedScoreAdvantageStandardError,
      ),
      sweepSignTestTwoSidedP: exactSweepSignTest(model131WonBoth, model130WonBoth),
    },
    orientations,
    timing: {
      discards: combineTiming(databases, "discards"),
      pegs: combineTiming(databases, "pegs"),
    },
    integrity: {
      errors: [],
      warnings,
      orientations: Object.fromEntries(
        orientations.map((orientation) => [orientation.label, orientation.integrity]),
      ),
    },
  };
}

function percentage(value, digits = 2) {
  return value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`;
}

function decimal(value, digits = 3) {
  return value === null ? "n/a" : value.toFixed(digits);
}

function duration(seconds) {
  if (seconds === null || !Number.isFinite(seconds)) return "n/a";
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return `${hours}h ${minutes}m ${remainder}s`;
}

function renderMarkdown(report) {
  const lines = [
    "# Model 13.1 vs Model 13.0 benchmark",
    "",
    `- Phase: ${report.progress.phase} (${report.progress.status})`,
    `- Snapshot: ${report.progress.snapshotAt || "n/a"}`,
    `- Progress: ${report.progress.databaseGames}/${report.progress.totalGames} (${percentage(report.progress.progressFraction)})`,
    `- ETA: ${duration(report.progress.estimatedRemainingSeconds)}; estimated completion ${report.progress.estimatedCompletionAt || "n/a"}`,
    "",
    "## Result and statistical error",
    "",
    `- Model 13.1: ${report.combined.model131Wins} wins; Model 13.0: ${report.combined.model130Wins} wins.`,
    `- Model 13.1 raw win rate: ${percentage(report.combined.model131WinRate)} (difference from 50%: ${percentage(report.combined.model131WinRateDifferenceFromEven)}; binomial SE: ${percentage(report.combined.model131WinRateStandardError)}; Wilson 95%: ${percentage(report.combined.model131Wilson95.lower)} to ${percentage(report.combined.model131Wilson95.upper)}).`,
    `- Average Model 13.1 score advantage: ${decimal(report.combined.model131AverageScoreAdvantage)} points/game (SE ${decimal(report.combined.model131ScoreAdvantageStandardError)}; normal 95% ${decimal(report.combined.model131ScoreAdvantageNormal95.lower)} to ${decimal(report.combined.model131ScoreAdvantageNormal95.upper)}).`,
    `- Paired-seed win rate: ${percentage(report.paired.model131WinRate)} (paired-cluster SE ${percentage(report.paired.model131WinRateStandardError)}; normal 95% ${percentage(report.paired.model131WinRateNormal95.lower)} to ${percentage(report.paired.model131WinRateNormal95.upper)}).`,
    `- Pair outcomes: ${report.paired.model131WonBoth} Model 13.1 sweeps, ${report.paired.split} splits, ${report.paired.model130WonBoth} Model 13.0 sweeps; two-sided sweep sign-test p=${decimal(report.paired.sweepSignTestTwoSidedP, 4)}.`,
    "",
    "## Orientations",
    "",
    "| Orientation | Games | 13.1 wins | 13.0 wins | 13.1 rate | Wilson 95% | Score advantage |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const orientation of report.orientations) {
    lines.push(
      `| ${orientation.label} | ${orientation.games} | ${orientation.model131Wins} | ${orientation.model130Wins} | ${percentage(orientation.model131WinRate)} | ${percentage(orientation.model131Wilson95.lower)}–${percentage(orientation.model131Wilson95.upper)} | ${decimal(orientation.model131AverageScoreAdvantage)} |`,
    );
  }
  lines.push(
    "",
    "## Runner progress",
    "",
    "| Orientation | DB games | Runner status | Rate | Remaining |",
    "| --- | ---: | --- | ---: | ---: |",
  );
  for (const [label, value] of Object.entries(report.progress.orientations)) {
    lines.push(
      `| ${label} | ${value.databaseGames} | ${value.runnerStatus || "n/a"} | ${decimal(value.gamesPerSecond)} games/s | ${duration(value.estimatedRemainingSeconds)} |`,
    );
  }
  lines.push(
    "",
    "## Decision timing by runner phase",
    "",
    "| Decision | Phase | Model | Decisions | Average |",
    "| --- | --- | --- | ---: | ---: |",
  );
  for (const [kind, rows] of Object.entries(report.timing)) {
    for (const row of rows) {
      lines.push(
        `| ${kind} | ${row.phase} | ${row.model} | ${row.decisions} | ${decimal(row.averageUs / 1000)} ms |`,
      );
    }
  }
  lines.push(
    "",
    "## Integrity",
    "",
    `- Errors: ${report.integrity.errors.length ? report.integrity.errors.join("; ") : "none"}`,
    `- Warnings: ${report.integrity.warnings.length ? report.integrity.warnings.join("; ") : "none"}`,
  );
  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = buildReport(options);
    process.stdout.write(
      options.format === "markdown"
        ? renderMarkdown(report)
        : `${JSON.stringify(report, null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildReport,
  exactSweepSignTest,
  normal95,
  parseArgs,
  renderMarkdown,
  standardErrorForMean,
  standardErrorForProportion,
  wilson95,
};
