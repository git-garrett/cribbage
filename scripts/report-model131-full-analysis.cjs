#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  buildReport,
  renderMarkdown: renderBenchmarkMarkdown,
} = require("./report-model131-benchmark.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_ROOT = "benchmarks/model131/evaluation-20260828/13.0-vs-13.1-discard-only-legal-leads-10k";
const ORIENTATIONS = [
  { label: "13.1-left", runId: "model131-13.1-left" },
  { label: "13.0-left", runId: "model131-13.0-left" },
];

function usage() {
  return "usage: node scripts/report-model131-full-analysis.cjs [--root BENCHMARK_ROOT] [--format markdown|json]";
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  let format = "markdown";
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root") {
      root = argv[index + 1];
      index += 1;
    } else if (value === "--format") {
      format = argv[index + 1];
      index += 1;
    } else if (value === "--help" || value === "-h") {
      return { help: true };
    } else {
      throw new Error(`unexpected argument: ${value}\n${usage()}`);
    }
  }
  if (!root) throw new Error(`missing benchmark root\n${usage()}`);
  if (format !== "markdown" && format !== "json") {
    throw new Error(`unsupported format ${format}; expected markdown or json`);
  }
  return { root: path.resolve(root), format, help: false };
}

function analyzerArguments(root, orientation, json) {
  const args = [
    "--no-warnings",
    path.join(__dirname, "analyze-ai-run.cjs"),
    orientation.runId,
    "--db",
    path.join(root, orientation.label, "games.db"),
  ];
  if (json) args.push("--json");
  return args;
}

function runAnalyzer(root, orientation, json, displayRoot = root) {
  const result = spawnSync(process.execPath, analyzerArguments(root, orientation, json), {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `phase analyzer failed for ${orientation.label}: ${result.stderr.trim() || `exit ${result.status}`}`,
    );
  }
  const displayDatabase = path.join(displayRoot, orientation.label, "games.db");
  if (json) {
    const report = JSON.parse(result.stdout);
    report.dbPath = path.relative(REPO_ROOT, displayDatabase);
    return report;
  }
  return result.stdout.trimEnd().replace(
    /^DB: .*$/m,
    `DB: ${path.relative(REPO_ROOT, displayDatabase)}`,
  );
}

function sqliteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function snapshotDatabase(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec(`VACUUM INTO ${sqliteLiteral(destination)}`);
  } finally {
    db.close();
  }
}

function createSnapshotRoot(root) {
  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), "model131-report-"));
  try {
    for (const orientation of ORIENTATIONS) {
      snapshotDatabase(
        path.join(root, orientation.label, "games.db"),
        path.join(snapshotRoot, orientation.label, "games.db"),
      );
    }
    return snapshotRoot;
  } catch (error) {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

function removeSnapshotRoot(snapshotRoot) {
  if (snapshotRoot && path.basename(snapshotRoot).startsWith("model131-report-")) {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
  }
}

function normalizeBenchmarkPaths(benchmark, root) {
  for (const orientation of benchmark.orientations) {
    orientation.database = path.join(root, orientation.label, "games.db");
  }
  return benchmark;
}

function buildFullReport(options, databaseRoot = options.root) {
  const benchmark = normalizeBenchmarkPaths(buildReport({
    root: options.root,
    format: options.format,
    model131LeftPath: path.join(databaseRoot, "13.1-left", "games.db"),
    model130LeftPath: path.join(databaseRoot, "13.0-left", "games.db"),
  }), options.root);
  const phaseCalibration = Object.fromEntries(
    ORIENTATIONS.map((orientation) => [
      orientation.label,
      runAnalyzer(databaseRoot, orientation, true, options.root),
    ]),
  );
  return { benchmark, phaseCalibration };
}

function renderMarkdown(options, benchmark, databaseRoot = options.root) {
  const sections = [renderBenchmarkMarkdown(benchmark).trimEnd()];
  for (const orientation of ORIENTATIONS) {
    sections.push(
      `# Detailed phase, EV, and win-probability analysis: ${orientation.label}\n\n${runAnalyzer(databaseRoot, orientation, false, options.root)}`,
    );
  }
  return `${sections.join("\n\n")}\n`;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const snapshotRoot = createSnapshotRoot(options.root);
    try {
      if (options.format === "json") {
        process.stdout.write(`${JSON.stringify(buildFullReport(options, snapshotRoot), null, 2)}\n`);
        return;
      }
      const benchmark = normalizeBenchmarkPaths(buildReport({
        root: options.root,
        format: options.format,
        model131LeftPath: path.join(snapshotRoot, "13.1-left", "games.db"),
        model130LeftPath: path.join(snapshotRoot, "13.0-left", "games.db"),
      }), options.root);
      process.stdout.write(renderMarkdown(options, benchmark, snapshotRoot));
    } finally {
      removeSnapshotRoot(snapshotRoot);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_ROOT,
  ORIENTATIONS,
  analyzerArguments,
  buildFullReport,
  createSnapshotRoot,
  parseArgs,
  removeSnapshotRoot,
  renderMarkdown,
};
