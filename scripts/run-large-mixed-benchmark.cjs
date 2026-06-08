const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const runDir = path.join(root, "benchmarks", "large-mixed");
const statusPath = path.join(runDir, "status.json");
const runnerLogPath = path.join(runDir, "runner.log");
const runId = `large-mixed-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const jobs = [
  {
    id: "ras-v-expert-1.1-1000",
    label: "Ras Table 1.0 vs Expert 1.1",
    games: 1000,
    mode: "ras-v-expert-1.1",
    workers: 8,
    workerHeap: { oldMb: 768, youngMb: 128 },
  },
  {
    id: "ras-v-schell-100000",
    label: "Ras Table 1.0 vs Schell Table 1.0",
    games: 100000,
    mode: "ras-v-schell",
    workers: 6,
    workerHeap: { oldMb: 512, youngMb: 64 },
  },
  {
    id: "schell-v-expert-1.1-1000",
    label: "Schell Table 1.0 vs Expert 1.1",
    games: 1000,
    mode: "schell-v-expert-1.1",
    workers: 8,
    workerHeap: { oldMb: 768, youngMb: 128 },
  },
].map((job) => ({
  ...job,
  status: "pending",
  outputPath: path.join(runDir, `${job.id}.json`),
  logPath: path.join(runDir, `${job.id}.log`),
}));

const state = {
  runId,
  status: "running",
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: null,
  pid: process.pid,
  runnerLogPath,
  jobs,
};

function writeStatus() {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(statusPath, `${JSON.stringify(state, null, 2)}\n`);
}

function appendRunnerLog(message) {
  fs.appendFileSync(runnerLogPath, `${new Date().toISOString()} ${message}\n`);
}

function runJob(job) {
  return new Promise((resolve, reject) => {
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.heartbeatAt = job.startedAt;
    job.elapsedSeconds = 0;
    job.completedGames = 0;
    job.progressPercent = 0;
    writeStatus();
    appendRunnerLog(`Starting ${job.id}: ${job.games} games, ${job.workers} workers`);

    const logStream = fs.createWriteStream(job.logPath, { flags: "a" });
    let heartbeat = null;
    let stdoutBuffer = "";
    const updateHeartbeat = () => {
      job.heartbeatAt = new Date().toISOString();
      job.elapsedSeconds = (Date.now() - Date.parse(job.startedAt)) / 1000;
      try {
        job.logBytes = fs.existsSync(job.logPath) ? fs.statSync(job.logPath).size : 0;
        job.outputBytes = fs.existsSync(job.outputPath) ? fs.statSync(job.outputPath).size : 0;
      } catch {
        // Status reporting should not interrupt a benchmark.
      }
      writeStatus();
    };
    const handleProgressLine = (line) => {
      if (!line.startsWith("PROGRESS ")) return;
      try {
        const progress = JSON.parse(line.slice("PROGRESS ".length));
        job.currentMatchup = progress.matchup;
        job.completedGames = progress.completed;
        job.totalGames = progress.total;
        job.progressPercent = progress.percent;
        job.progressAt = new Date().toISOString();
        updateHeartbeat();
      } catch {
        // Keep benchmark logging best-effort; do not interrupt a run for malformed progress.
      }
    };
    const child = spawn(
      process.execPath,
      [
        path.join(root, "scripts", "compare-engines-parallel.cjs"),
        String(job.games),
        job.mode,
        job.outputPath,
        String(job.workers),
      ],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          BENCH_WORKER_OLD_MB: String(job.workerHeap.oldMb),
          BENCH_WORKER_YOUNG_MB: String(job.workerHeap.youngMb),
        },
      },
    );
    job.pid = child.pid;
    writeStatus();

    heartbeat = setInterval(updateHeartbeat, 5000);
    child.stdout.on("data", (chunk) => {
      job.lastOutputAt = new Date().toISOString();
      logStream.write(chunk);
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) handleProgressLine(line);
      updateHeartbeat();
    });
    child.stderr.on("data", (chunk) => {
      job.lastErrorAt = new Date().toISOString();
      logStream.write(chunk);
      updateHeartbeat();
    });

    child.on("error", (error) => {
      if (heartbeat) clearInterval(heartbeat);
      logStream.end();
      reject(error);
    });

    child.on("close", (code) => {
      if (heartbeat) clearInterval(heartbeat);
      if (stdoutBuffer) handleProgressLine(stdoutBuffer);
      updateHeartbeat();
      logStream.end();
      job.completedAt = new Date().toISOString();
      if (code === 0) {
        job.status = "complete";
        appendRunnerLog(`Completed ${job.id}`);
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
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(runnerLogPath, "");
  for (const job of jobs) fs.writeFileSync(job.logPath, "");
  writeStatus();
  appendRunnerLog(`Run ${runId} started with PID ${process.pid}`);
  for (const job of jobs) {
    await runJob(job);
  }
  state.status = "complete";
  state.completedAt = new Date().toISOString();
  writeStatus();
  appendRunnerLog(`Run ${runId} complete`);
}

main().catch((error) => {
  state.status = "failed";
  state.error = error instanceof Error ? error.stack || error.message : String(error);
  state.completedAt = new Date().toISOString();
  writeStatus();
  appendRunnerLog(`Run ${runId} failed: ${state.error}`);
  process.exitCode = 1;
});
