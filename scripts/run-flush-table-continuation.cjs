const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const outDir = process.argv[2] || "benchmarks/pegging-table/clean-recursion-20260611-0000";
const workerCount = process.argv[3] || "6";
const memoWindowRows = process.argv[4] || "1";
const pollSeconds = Number.parseInt(process.argv[5] || "60", 10);
const statusPath = path.join(outDir, "flush-continuation-status.json");

main().catch((error) => {
  writeStatus({ status: "failed", updatedAt: new Date().toISOString(), error: error.stack || String(error) });
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  writeStatus({
    status: "waiting",
    updatedAt: new Date().toISOString(),
    outDir,
    workerCount: Number(workerCount),
    memoWindowRows: Number(memoWindowRows),
    waitingFor: path.join(outDir, "iteration-2.policy.json"),
  });
  await waitForIterationTwo();
  runFlushIterationTwo();
  runHistogramIterationThree();
  writeStatus({
    status: "complete",
    updatedAt: new Date().toISOString(),
    outDir,
    flushPolicyPath: path.join(outDir, "iteration-2-flush.policy.json"),
    finalPolicyPath: path.join(outDir, "iteration-3.policy.json"),
  });
}

async function waitForIterationTwo() {
  const policyPath = path.join(outDir, "iteration-2.policy.json");
  const summaryPath = path.join(outDir, "iteration-2.summary.json");
  while (!fs.existsSync(policyPath) || !fs.existsSync(summaryPath)) {
    await sleep(Math.max(5, pollSeconds) * 1000);
    writeStatus({
      status: "waiting",
      updatedAt: new Date().toISOString(),
      outDir,
      waitingFor: policyPath,
    });
  }
}

function runFlushIterationTwo() {
  runGenerate({
    phase: "iteration-2-flush",
    priorPolicyPath: path.join(outDir, "iteration-1.policy.json"),
    iteration: "2",
    env: {
      PEG_TABLE_DISCARD_MODE: "schell-flush",
      PEG_TABLE_OUTPUT_SUFFIX: "-flush",
      PEG_TABLE_COLLECT_HISTOGRAMS: "0",
    },
  });
}

function runHistogramIterationThree() {
  runGenerate({
    phase: "iteration-3-histograms",
    priorPolicyPath: path.join(outDir, "iteration-2-flush.policy.json"),
    iteration: "3",
    env: {
      PEG_TABLE_DISCARD_MODE: "schell-flush",
      PEG_TABLE_OUTPUT_SUFFIX: "",
      PEG_TABLE_COLLECT_HISTOGRAMS: "1",
    },
  });
}

function runGenerate({ phase, priorPolicyPath, iteration, env }) {
  writeStatus({
    status: "running",
    phase,
    updatedAt: new Date().toISOString(),
    outDir,
    priorPolicyPath,
    workerCount: Number(workerCount),
    memoWindowRows: Number(memoWindowRows),
    discardMode: env.PEG_TABLE_DISCARD_MODE,
  });
  const args = [
    "--max-old-space-size=8192",
    "scripts/generate-iterative-pegging-table.cjs",
    "generate",
    outDir,
    workerCount,
    memoWindowRows,
    "0",
    "0",
    priorPolicyPath,
    iteration,
    "1",
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PEG_TABLE_WORKER_OLD_MB: process.env.PEG_TABLE_WORKER_OLD_MB || "768",
      PEG_TABLE_WORKER_YOUNG_MB: process.env.PEG_TABLE_WORKER_YOUNG_MB || "64",
      ...env,
    },
  });
  if (result.status !== 0) throw new Error(`${phase} exited with status ${result.status}`);
}

function writeStatus(status) {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
