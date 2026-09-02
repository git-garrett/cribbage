#!/usr/bin/env node

// Deterministic, snapshot-based report for a side-swapped benchmark, including
// partial runs.  Per-orientation phase analysis comes from analyze-ai-run.cjs.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const Z95 = 1.959963984540054;

function usage() {
  return "usage: node scripts/report-paired-live-benchmark.cjs --root ROOT --candidate MODEL --opponent MODEL --candidate-left LABEL --opponent-left LABEL [--candidate-left-run-id ID] [--opponent-left-run-id ID] [--format json|markdown]";
}

function parseArgs(argv) {
  const values = { format: "json" };
  const names = {
    "--root": "root",
    "--candidate": "candidate",
    "--opponent": "opponent",
    "--candidate-left": "candidateLeft",
    "--opponent-left": "opponentLeft",
    "--candidate-left-run-id": "candidateLeftRunId",
    "--opponent-left-run-id": "opponentLeftRunId",
    "--format": "format",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    const name = names[argument];
    if (!name || !argv[index + 1]) throw new Error(usage());
    values[name] = argv[index + 1];
    index += 1;
  }
  for (const name of ["root", "candidate", "opponent", "candidateLeft", "opponentLeft"]) {
    if (!values[name]) throw new Error(`missing --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}\n${usage()}`);
  }
  if (!["json", "markdown"].includes(values.format)) throw new Error(`unsupported format\n${usage()}`);
  values.root = path.resolve(values.root);
  values.candidateLeftRunId ||= values.candidateLeft;
  values.opponentLeftRunId ||= values.opponentLeft;
  return values;
}

function readManifest(root) {
  const result = {};
  const manifest = path.join(root, "manifest.txt");
  if (!fs.existsSync(manifest)) return result;
  for (const line of fs.readFileSync(manifest, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

function snapshotDatabase(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
}

function analyze(snapshotRoot, label, runId) {
  const script = path.join(__dirname, "analyze-ai-run.cjs");
  const database = path.join(snapshotRoot, label, "games.db");
  const result = spawnSync(process.execPath, ["--no-warnings", script, runId, "--db", database, "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `analysis failed for ${label}`);
  return JSON.parse(result.stdout);
}

function readGames(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare("SELECT game_index, random_seed, left_engine, right_engine, winner, final_left_score, final_right_score FROM compact_games WHERE included_in_tables = 1 ORDER BY game_index").all();
  } finally {
    database.close();
  }
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardError(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance / values.length);
}

function interval(average, error) {
  return average === null || error === null ? { lower: null, upper: null } : { lower: average - Z95 * error, upper: average + Z95 * error };
}

function wilson(wins, games) {
  if (!games) return { lower: null, upper: null };
  const probability = wins / games;
  const denominator = 1 + Z95 ** 2 / games;
  const half = Z95 * Math.sqrt(probability * (1 - probability) / games + Z95 ** 2 / (4 * games ** 2)) / denominator;
  const center = (probability + Z95 ** 2 / (2 * games)) / denominator;
  return { lower: center - half, upper: center + half };
}

function summarizeGames(candidateGames, opponentGames, candidate, opponent) {
  const all = [
    ...candidateGames.map((game) => ({ game, candidateSide: 0, orientation: "candidate-left" })),
    ...opponentGames.map((game) => ({ game, candidateSide: 1, orientation: "opponent-left" })),
  ];
  const invalidEngines = all.filter(({ game, candidateSide }) => game.left_engine !== (candidateSide === 0 ? candidate : opponent) || game.right_engine !== (candidateSide === 1 ? candidate : opponent)).map(({ game }) => game.game_index);
  const margins = all.map(({ game, candidateSide }) => (candidateSide === 0 ? 1 : -1) * (game.final_left_score - game.final_right_score));
  const wins = all.filter(({ game, candidateSide }) => game.winner === candidateSide).length;
  const candidateByIndex = new Map(candidateGames.map((game) => [game.game_index, game]));
  const opponentByIndex = new Map(opponentGames.map((game) => [game.game_index, game]));
  const indexes = [...candidateByIndex.keys()].filter((index) => opponentByIndex.has(index)).sort((left, right) => left - right);
  const pairMargins = [];
  let candidateSweeps = 0;
  let opponentSweeps = 0;
  let splits = 0;
  const seedMismatches = [];
  for (const index of indexes) {
    const left = candidateByIndex.get(index);
    const right = opponentByIndex.get(index);
    if (left.random_seed !== right.random_seed) seedMismatches.push(index);
    const pairWins = Number(left.winner === 0) + Number(right.winner === 1);
    if (pairWins === 2) candidateSweeps += 1;
    else if (pairWins === 0) opponentSweeps += 1;
    else splits += 1;
    pairMargins.push(((left.final_left_score - left.final_right_score) + (right.final_right_score - right.final_left_score)) / 2);
  }
  const pairFractions = Array.from({ length: candidateSweeps }, () => 1).concat(Array.from({ length: splits }, () => 0.5), Array.from({ length: opponentSweeps }, () => 0));
  return {
    observedGames: all.length,
    candidateWins: wins,
    opponentWins: all.length - wins,
    candidateWinRate: all.length ? wins / all.length : null,
    candidateWilson95: wilson(wins, all.length),
    candidateMeanMargin: mean(margins),
    candidateMarginStandardError: standardError(margins),
    candidateMarginNormal95: interval(mean(margins), standardError(margins)),
    orientations: [
      { label: "candidate-left", games: candidateGames.length, candidateWins: candidateGames.filter((game) => game.winner === 0).length },
      { label: "opponent-left", games: opponentGames.length, candidateWins: opponentGames.filter((game) => game.winner === 1).length },
    ],
    paired: {
      completePairs: indexes.length,
      candidateSweeps,
      opponentSweeps,
      splits,
      candidateWinRate: mean(pairFractions),
      candidateWinRateStandardError: standardError(pairFractions),
      candidateWinRateNormal95: interval(mean(pairFractions), standardError(pairFractions)),
      candidateMeanMargin: mean(pairMargins),
      seedMismatches,
    },
    invalidEngines,
  };
}

function modelName(model) {
  return model;
}

function combineRows(analyses, rowsFor, fields) {
  const groups = new Map();
  for (const analysis of analyses) {
    for (const row of rowsFor(analysis)) {
      const key = [row.kind || row.label, row.role || "", modelName(row.model || "")].join("\u0000");
      const group = groups.get(key) || { kind: row.kind || row.label, role: row.role || null, model: row.model || null, rows: 0 };
      const weight = row.rows;
      group.rows += weight;
      for (const field of fields) group[field] = (group[field] || 0) + row[field] * weight;
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => {
    for (const field of fields) group[field] /= group.rows;
    return group;
  });
}

function combineScoring(analyses, rowsFor, candidate, opponent) {
  const groups = new Map();
  for (const analysis of analyses) for (const row of rowsFor(analysis)) {
    const group = groups.get(row.label) || { label: row.label, candidate: { total: 0, rows: 0 }, opponent: { total: 0, rows: 0 } };
    const leftModel = analysis.matchup.leftModel;
    for (const [model, value, rows] of [[leftModel, row.leftMean, row.leftN], [analysis.matchup.rightModel, row.rightMean, row.rightN]]) {
      const side = model === candidate ? group.candidate : model === opponent ? group.opponent : null;
      if (!side) throw new Error(`unexpected model ${model}`);
      side.total += value * rows;
      side.rows += rows;
    }
    groups.set(row.label, group);
  }
  return [...groups.values()].map((group) => ({ label: group.label, candidateMean: group.candidate.total / group.candidate.rows, opponentMean: group.opponent.total / group.opponent.rows, difference: group.candidate.total / group.candidate.rows - group.opponent.total / group.opponent.rows, candidateRows: group.candidate.rows, opponentRows: group.opponent.rows }));
}

function buildReport(options) {
  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cribbage-paired-report-"));
  try {
    for (const label of [options.candidateLeft, options.opponentLeft]) snapshotDatabase(path.join(options.root, label, "games.db"), path.join(snapshotRoot, label, "games.db"));
    const candidateAnalysis = analyze(snapshotRoot, options.candidateLeft, options.candidateLeftRunId);
    const opponentAnalysis = analyze(snapshotRoot, options.opponentLeft, options.opponentLeftRunId);
    const analyses = [candidateAnalysis, opponentAnalysis];
    const games = summarizeGames(readGames(path.join(snapshotRoot, options.candidateLeft, "games.db")), readGames(path.join(snapshotRoot, options.opponentLeft, "games.db")), options.candidate, options.opponent);
    const manifest = readManifest(options.root);
    const legacyImmediatePegModels = [...new Set(
      analyses.flatMap((analysis) => analysis.ev.legacyImmediatePegModels || []),
    )].sort();
    const evExcluded = analyses.reduce((totals, analysis) => {
      for (const [key, value] of Object.entries(analysis.ev.excluded || {})) {
        totals[key] = (totals[key] || 0) + Number(value || 0);
      }
      return totals;
    }, {});
    return {
      schemaVersion: 1,
      benchmarkRoot: options.root,
      candidate: options.candidate,
      opponent: options.opponent,
      manifest,
      progress: {
        observedGames: games.observedGames,
        expectedGames: Number(manifest.totalGames) || null,
        statuses: analyses.map((analysis) => ({ label: analysis.status.left === options.candidate ? options.candidateLeft : options.opponentLeft, status: analysis.status.status, updatedAt: analysis.status.updatedAt, savedGames: analysis.status.savedGames, totalGames: analysis.status.totalGames, gamesPerSecond: analysis.status.gamesPerSecond, estimatedRemainingSeconds: analysis.status.estimatedRemainingSeconds })),
      },
      results: games,
      phaseScoring: combineScoring(analyses, (analysis) => analysis.scoring, options.candidate, options.opponent),
      availableEventScoring: combineScoring(analyses, (analysis) => analysis.availableEventScoring.rows, options.candidate, options.opponent),
      evCalibration: combineRows(analyses, (analysis) => analysis.ev.rows, ["avgEv", "avgRealized", "avgError", "meanAbsError"]),
      evTelemetry: { legacyImmediatePegModels, excluded: evExcluded },
      winProbabilityCalibration: combineRows(analyses, (analysis) => analysis.winProbability.rows, ["avgPredicted", "actualWinRate", "miss", "brier", "meanAbsError"]),
      timing: combineRows(analyses, (analysis) => analysis.timing.rows, ["avgMs", "totalSeconds"]),
      orientationAnalysis: { [options.candidateLeft]: candidateAnalysis, [options.opponentLeft]: opponentAnalysis },
      integrity: { errors: [], warnings: [], invalidEngineIndexes: games.invalidEngines, pairedSeedMismatchIndexes: games.paired.seedMismatches },
    };
  } finally {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
  }
}

function renderMarkdown(report) {
  const number = (value, digits = 3) => value === null || value === undefined ? "n/a" : Number(value).toFixed(digits);
  const percent = (value, digits = 2) => value === null || value === undefined ? "n/a" : `${(Number(value) * 100).toFixed(digits)}%`;
  const duration = (seconds) => {
    if (!Number.isFinite(seconds)) return "n/a";
    const rounded = Math.max(0, Math.round(seconds));
    return `${Math.floor(rounded / 3600)}h ${Math.floor((rounded % 3600) / 60)}m ${rounded % 60}s`;
  };
  const table = (headers, rows) => [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
  const candidateShort = report.candidate.replace("schell_table-peg_table-", "");
  const opponentShort = report.opponent.replace("schell_table-peg_table-", "");
  const orientationRows = report.results.orientations.map((orientation) => {
    const candidateRate = orientation.games ? orientation.candidateWins / orientation.games : null;
    const analysis = Object.values(report.orientationAnalysis).find((value) => (
      (orientation.label === "candidate-left" && value.matchup.leftModel === report.candidate) ||
      (orientation.label === "opponent-left" && value.matchup.rightModel === report.candidate)
    ));
    const score = analysis?.scoring.find((row) => row.label === "Final score");
    const scoreDelta = score
      ? (analysis.matchup.leftModel === report.candidate ? score.leftMean - score.rightMean : score.rightMean - score.leftMean)
      : null;
    return [orientation.label, orientation.games, orientation.candidateWins, orientation.games - orientation.candidateWins, percent(candidateRate), number(scoreDelta)];
  });
  const phaseRows = report.phaseScoring.map((row) => [row.label, number(row.candidateMean), number(row.opponentMean), number(row.difference), `${row.candidateRows}/${row.opponentRows}`]);
  const availableRows = report.availableEventScoring.map((row) => [row.label, number(row.candidateMean), number(row.opponentMean), number(row.difference), `${row.candidateRows}/${row.opponentRows}`]);
  const evRows = report.evCalibration.map((row) => [row.kind, row.role, row.model === report.candidate ? candidateShort : opponentShort, row.rows, number(row.avgEv), number(row.avgRealized), number(row.avgError), number(row.meanAbsError)]);
  const probabilityRows = report.winProbabilityCalibration.map((row) => [row.kind, row.role, row.model === report.candidate ? candidateShort : opponentShort, row.rows, number(row.avgPredicted), number(row.actualWinRate), number(row.miss), number(row.brier), number(row.meanAbsError)]);
  const timingRows = report.timing.map((row) => [row.kind, row.role, row.model === report.candidate ? candidateShort : opponentShort, row.rows, `${number(row.avgMs)} ms`, `${number(row.totalSeconds)} s`]);
  const lines = [
    `# ${report.candidate} vs ${report.opponent}`,
    "",
    `- Experiment: ${report.manifest.experiment || "n/a"}`,
    `- Seed pairing: ${report.manifest.orientationPairing || "n/a"}`,
    "",
    "## Progress and result",
    "",
    `- Progress: ${report.progress.observedGames}/${report.progress.expectedGames || "?"}`,
    `- ${candidateShort}: ${report.results.candidateWins} wins; ${opponentShort}: ${report.results.opponentWins} wins.`,
    `- ${candidateShort} raw win rate: ${percent(report.results.candidateWinRate)}; Wilson 95% ${percent(report.results.candidateWilson95.lower)} to ${percent(report.results.candidateWilson95.upper)}.`,
    `- ${candidateShort} score advantage: ${number(report.results.candidateMeanMargin)} points/game; normal 95% ${number(report.results.candidateMarginNormal95.lower)} to ${number(report.results.candidateMarginNormal95.upper)}.`,
    `- Paired ${candidateShort} win rate: ${percent(report.results.paired.candidateWinRate)}; paired-cluster 95% ${percent(report.results.paired.candidateWinRateNormal95.lower)} to ${percent(report.results.paired.candidateWinRateNormal95.upper)}.`,
    `- Pair outcomes: ${report.results.paired.candidateSweeps} ${candidateShort} sweeps, ${report.results.paired.splits} splits, ${report.results.paired.opponentSweeps} ${opponentShort} sweeps.`,
    "",
    "## Runner status",
    "",
    ...table(["Orientation", "Status", "Saved", "Rate", "Remaining", "Updated"], report.progress.statuses.map((status) => [status.label, status.status, `${status.savedGames}/${status.totalGames}`, `${number(status.gamesPerSecond)} games/s`, duration(status.estimatedRemainingSeconds), status.updatedAt || "n/a"])),
    "",
    "## Reciprocal orientations",
    "",
    ...table(["Orientation", "Games", `${candidateShort} wins`, `${opponentShort} wins`, `${candidateShort} rate`, "Score delta"], orientationRows),
    "",
    `Paired score delta (${candidateShort} − ${opponentShort}): ${number(report.results.paired.candidateMeanMargin)} points/game across ${report.results.paired.completePairs} matched indexes.`,
    "",
    `## Realized scoring (${candidateShort} − ${opponentShort})`,
    "",
    ...table(["Phase", candidateShort, opponentShort, "Delta", "N"], phaseRows),
    "",
    `## Available-event scoring (${candidateShort} − ${opponentShort})`,
    "",
    ...table(["Phase", candidateShort, opponentShort, "Delta", "N"], availableRows),
    "",
    "## EV calibration",
    "",
    "Final-hand decisions are excluded. `discard_total` is total discard EV, not separate hand, crib, and pegging EV. Pegging rows include future-net predictions only; forced plays and legacy immediate-score telemetry are excluded.",
    ...(report.evTelemetry.legacyImmediatePegModels.length
      ? [`Legacy immediate-score pegging telemetry excluded for: ${report.evTelemetry.legacyImmediatePegModels.join(", ")}.`]
      : []),
    "",
    ...table(["Decision", "Role", "Model", "N", "EV", "Realized", "Realized − EV", "MAE"], evRows),
    "",
    "## Win-probability calibration",
    "",
    ...table(["Decision", "Role", "Model", "N", "Predicted", "Actual", "Miss", "Brier", "MAE"], probabilityRows),
    "",
    "## Decision timing",
    "",
    "Rust model decision calls only; forced no-model rows are excluded.",
    "",
    ...table(["Decision", "Role", "Model", "N", "Average", "Total"], timingRows),
    "",
    "## Integrity",
    "",
    `- Engine mismatches: ${report.integrity.invalidEngineIndexes.length ? report.integrity.invalidEngineIndexes.join(", ") : "none"}`,
    `- Paired seed mismatches: ${report.integrity.pairedSeedMismatchIndexes.length ? report.integrity.pairedSeedMismatchIndexes.join(", ") : "none"}`,
    `- Complete paired indexes: ${report.results.paired.completePairs}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) return process.stdout.write(`${usage()}\n`);
    const report = buildReport(options);
    process.stdout.write(options.format === "markdown" ? renderMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { buildReport, parseArgs, summarizeGames };
