const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runId = `top-three-10k-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outDir = path.resolve(process.argv[2] || path.join(root, "benchmarks", "ai-smoke", runId));
const gamesPerMatchup = Number.parseInt(process.argv[3] || "10000", 10);
const batchGames = Number.parseInt(process.argv[4] || "25", 10);
const progressEvery = Number.parseInt(process.argv[5] || "10", 10);

const jobs = [
  {
    id: "schell-pt-vs-ras-pt",
    models: ["schell_table-peg_table-4.0", "ras_table-peg_table-4.0"],
    label: "Schell Peg Table 4.0 vs Ras Peg Table 4.0",
    workers: 4,
    oldMb: 768,
  },
  {
    id: "schell-pt-vs-schell-peg",
    models: ["schell_table-peg_table-4.0", "schell_table-peg-3.0"],
    label: "Schell Peg Table 4.0 vs Schell Peg 3.0",
    workers: 6,
    oldMb: 384,
  },
  {
    id: "ras-pt-vs-schell-peg",
    models: ["ras_table-peg_table-4.0", "schell_table-peg-3.0"],
    label: "Ras Peg Table 4.0 vs Schell Peg 3.0",
    workers: 4,
    oldMb: 384,
  },
];

const statusPath = path.join(outDir, "status.json");
const summaryPath = path.join(outDir, "summary.json");
const logPath = path.join(outDir, "runner.log");

if (!Number.isInteger(gamesPerMatchup) || gamesPerMatchup <= 0) {
  throw new Error("gamesPerMatchup must be a positive integer.");
}
if (!Number.isInteger(batchGames) || batchGames <= 0) {
  throw new Error("batchGames must be a positive integer.");
}

function gitCommit() {
  try {
    return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function appendLog(message) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
}

function childStatus(job) {
  const childStatusPath = path.join(outDir, job.id, "status.json");
  if (!fs.existsSync(childStatusPath)) return null;
  try {
    return readJson(childStatusPath);
  } catch {
    return null;
  }
}

function childSummary(job) {
  const childSummaryPath = path.join(outDir, job.id, "summary.json");
  if (!fs.existsSync(childSummaryPath)) return null;
  try {
    return readJson(childSummaryPath);
  } catch {
    return null;
  }
}

const state = {
  version: 1,
  runId,
  status: "running",
  pid: process.pid,
  command: [process.execPath, ...process.argv.slice(1)].join(" "),
  gitCommit: gitCommit(),
  outDir,
  gamesPerMatchup,
  totalGames: gamesPerMatchup * jobs.length,
  batchGames,
  progressEvery,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: null,
  jobs: jobs.map((job) => ({
    ...job,
    status: "pending",
    outDir: path.join(outDir, job.id),
    logPath: path.join(outDir, `${job.id}.log`),
  })),
};

function writeStatus() {
  let savedGames = 0;
  let completedGames = 0;
  for (const job of state.jobs) {
    const status = childStatus(job);
    if (job.status === "complete") {
      savedGames += gamesPerMatchup;
      completedGames += gamesPerMatchup;
      job.childStatus = {
        ...(job.childStatus || {}),
        status: "complete",
        savedGames: gamesPerMatchup,
        completedGames: gamesPerMatchup,
        totalGames: gamesPerMatchup,
        progressPercent: 100,
        updatedAt: job.completedAt,
      };
    } else if (status) {
      job.childStatus = {
        status: status.status,
        savedGames: status.savedGames ?? status.completedGames ?? 0,
        completedGames: status.completedGames ?? 0,
        totalGames: status.totalGames ?? gamesPerMatchup,
        progressPercent: status.progressPercent ?? 0,
        gamesPerSecond: status.gamesPerSecond ?? 0,
        estimatedRemainingSeconds: status.estimatedRemainingSeconds ?? null,
        updatedAt: status.updatedAt,
      };
      savedGames += job.childStatus.savedGames;
      completedGames += job.childStatus.completedGames;
    }
  }
  state.savedGames = Math.min(state.totalGames, savedGames);
  state.completedGames = Math.min(state.totalGames, completedGames);
  state.progressPercent = state.totalGames ? (state.completedGames / state.totalGames) * 100 : 100;
  state.updatedAt = new Date().toISOString();
  const elapsedSeconds = (Date.now() - Date.parse(state.startedAt)) / 1000;
  state.elapsedSeconds = elapsedSeconds;
  state.gamesPerSecond = elapsedSeconds > 0 ? state.completedGames / elapsedSeconds : 0;
  const remaining = Math.max(0, state.totalGames - state.completedGames);
  state.estimatedRemainingSeconds = state.gamesPerSecond > 0 ? remaining / state.gamesPerSecond : null;
  writeJson(statusPath, state);
}

async function runJob(job) {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  writeStatus();
  appendLog(`Starting ${job.id}: ${job.label}, ${gamesPerMatchup} games, workers=${job.workers}, oldMb=${job.oldMb}`);

  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(root, "scripts", "smoke-four-model-ai.cjs"),
        job.outDir,
        String(gamesPerMatchup),
        String(job.workers),
        String(job.oldMb),
        String(batchGames),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          AI_SMOKE_MODELS: job.models.join(","),
          AI_SMOKE_PROGRESS_EVERY: String(progressEvery),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    job.pid = child.pid;
    const logStream = fs.createWriteStream(job.logPath, { flags: "a" });
    const heartbeat = setInterval(writeStatus, 5000);
    child.stdout.on("data", (chunk) => {
      logStream.write(chunk);
      writeStatus();
    });
    child.stderr.on("data", (chunk) => {
      logStream.write(chunk);
      writeStatus();
    });
    child.once("error", (error) => {
      clearInterval(heartbeat);
      logStream.end();
      reject(error);
    });
    child.once("close", (code) => {
      clearInterval(heartbeat);
      logStream.end();
      job.completedAt = new Date().toISOString();
      if (code === 0) {
        job.status = "complete";
        appendLog(`Completed ${job.id}`);
        writeStatus();
        resolve();
      } else {
        job.status = "failed";
        job.exitCode = code;
        writeStatus();
        reject(new Error(`${job.id} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, "");
  writeStatus();
  appendLog(`Run ${runId} started with PID ${process.pid}`);

  for (const job of state.jobs) {
    await runJob(job);
  }

  const summaries = Object.fromEntries(state.jobs.map((job) => [job.id, childSummary(job)]));
  state.status = "complete";
  state.completedAt = new Date().toISOString();
  writeStatus();
  writeJson(summaryPath, {
    version: 1,
    runId,
    generatedAt: new Date().toISOString(),
    outDir,
    gamesPerMatchup,
    totalGames: gamesPerMatchup * jobs.length,
    batchGames,
    progressEvery,
    jobs: state.jobs,
    summaries,
  });
  appendLog(`Run ${runId} complete`);
}

main().catch((error) => {
  state.status = "failed";
  state.error = error instanceof Error ? error.stack || error.message : String(error);
  state.completedAt = new Date().toISOString();
  writeStatus();
  appendLog(`Run ${runId} failed: ${state.error}`);
  process.exitCode = 1;
});
