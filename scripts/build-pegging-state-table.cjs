#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "benchmarks", "pegging-state-table", "rank-pegging-state-table.bin");
let completedRoots = 0;

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  runWorker(workerData);
}

async function main() {
  const outputPath = path.resolve(root, process.argv[2] || defaultOutput);
  const workerCount = Number.parseInt(process.argv[3] || "", 10) || Math.max(1, Math.min(os.cpus().length - 2, 8));
  const keepLimit = Number.parseInt(process.argv[4] || "", 10) || 0;
  const oldMb = Number.parseInt(process.argv[5] || "", 10) || 0;
  const memoLimit = Number.parseInt(process.argv[6] || "", 10) || 250000;
  const statusPath = process.env.PEGGING_STATE_STATUS_PATH
    ? path.resolve(root, process.env.PEGGING_STATE_STATUS_PATH)
    : outputPath.replace(/\.bin$/i, ".status.json");
  const checkpointDir = process.env.PEGGING_STATE_CHECKPOINT_DIR
    ? path.resolve(root, process.env.PEGGING_STATE_CHECKPOINT_DIR)
    : outputPath.replace(/\.bin$/i, ".checkpoints");

  const keeps = enumerateKeeps().map((keep, id) => ({ ...keep, id }));
  const activeKeeps = keepLimit > 0 ? keeps.slice(0, keepLimit) : keeps;
  if (process.env.PEGGING_STATE_GLOBAL === "1") {
    const startedAt = Date.now();
    const calibrationOnly = process.env.PEGGING_STATE_CALIBRATE_ONLY === "1";
    const assembled = buildGlobalGraph(activeKeeps, keeps, statusPath, { calibrationOnly });
    const calibration = summarizeGlobalBuild({ activeKeeps, keeps, assembled, startedAt, outputPath });
    if (calibrationOnly) {
      writeStatusFile(statusPath, { status: "calibration-complete", ...calibration });
      console.log(JSON.stringify(calibration, null, 2));
      return;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    writeBinaryTable(outputPath, assembled);
    const manifestPath = outputPath.replace(/\.bin$/i, ".manifest.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      kind: "rank-only pegging canonical state transition table",
      buildMode: "global-canonical",
      ranks: RANKS,
      rootKeepCount: activeKeeps.length,
      stateCount: assembled.states.length,
      transitionCount: assembled.transitions.length,
      binaryPath: path.basename(outputPath),
    }, null, 2)}\n`);
    writeStatusFile(statusPath, { status: "complete", ...calibration, binaryBytes: fs.statSync(outputPath).size });
    console.log(JSON.stringify({
      outputPath: path.relative(root, outputPath),
      manifestPath: path.relative(root, manifestPath),
      buildMode: "global-canonical",
      rootKeepCount: activeKeeps.length,
      stateCount: assembled.states.length,
      transitionCount: assembled.transitions.length,
      binaryBytes: fs.statSync(outputPath).size,
      elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    }, null, 2));
    return;
  }
  fs.mkdirSync(checkpointDir, { recursive: true });
  completedRoots = activeKeeps.filter((keep) => fs.existsSync(rootCheckpointPath(checkpointDir, keep.id))).length;
  const pendingKeeps = activeKeeps.filter((keep) => !fs.existsSync(rootCheckpointPath(checkpointDir, keep.id)));
  const workers = Math.max(1, Math.min(workerCount, Math.max(1, pendingKeeps.length)));
  const chunks = makeBalancedChunks(pendingKeeps, workers);
  const startedAt = Date.now();

  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const writeStatus = (status = "running") => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = completedRoots / Math.max(elapsed, 0.001);
    const remaining = activeKeeps.length - completedRoots;
    const estimatedRemainingSeconds = rate ? Math.round(remaining / rate) : null;
    fs.writeFileSync(statusPath, `${JSON.stringify({
      status,
      outputPath: path.relative(root, outputPath),
      checkpointDir: path.relative(root, checkpointDir),
      completedRoots,
      totalRoots: activeKeeps.length,
      pendingRoots: remaining,
      workers,
      oldMb,
      memoLimit,
      rootsPerSecond: Number(rate.toFixed(4)),
      estimatedRemainingSeconds,
      expectedCompletionAt: estimatedRemainingSeconds === null ? null : new Date(Date.now() + estimatedRemainingSeconds * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
  };
  writeStatus();
  const interval = setInterval(() => {
    writeStatus();
    process.stderr.write(`${fs.readFileSync(statusPath, "utf8").trim()}\n`);
  }, 30000);

  await Promise.all(chunks.map((chunk) => runChunk(chunk, keeps, oldMb, memoLimit, checkpointDir)));
  clearInterval(interval);

  const assembled = assembleCheckpoints({ keeps, activeKeeps, checkpointDir });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeBinaryTable(outputPath, assembled);
  const manifestPath = outputPath.replace(/\.bin$/i, ".manifest.json");
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    kind: "rank-only pegging canonical state transition table",
    ranks: RANKS,
    rootKeepCount: activeKeeps.length,
    stateCount: assembled.states.length,
    transitionCount: assembled.transitions.length,
    binaryPath: path.basename(outputPath),
    binaryFormat: {
      endian: "little",
      header: "magic P13S, version u16, stateCount u32, transitionCount u32",
      stateRecord: "aRanks uint32, bRanks uint32, stackRanks uint32, count u8, stackLength u8, current u8, goPlayerPlusOne u8, lastPlayerPlusOne u8, transitionOffset u32, transitionCount u16",
      transitionRecord: "rank u8, points u8, nextStateId u32",
    },
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeStatus("complete");
  console.log(JSON.stringify({
    outputPath: path.relative(root, outputPath),
    manifestPath: path.relative(root, manifestPath),
    checkpointDir: path.relative(root, checkpointDir),
    workerCount: workers,
    oldMb,
    memoLimit,
    rootKeepCount: activeKeeps.length,
    stateCount: assembled.states.length,
    transitionCount: assembled.transitions.length,
    binaryBytes: fs.statSync(outputPath).size,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
  }, null, 2));
}

function buildGlobalGraph(activeKeeps, keeps, statusPath, options = {}) {
  const states = new Map();
  const transitions = new Map();
  const touchOrder = [];
  const startedAt = Date.now();
  let completedRoots = 0;
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  const writeStatus = () => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = completedRoots / Math.max(elapsed, 0.001);
    const remaining = activeKeeps.length - completedRoots;
    const estimatedRemainingSeconds = rate ? Math.round(remaining / rate) : null;
    fs.writeFileSync(statusPath, `${JSON.stringify({
      status: "running",
      buildMode: "global-canonical",
      completedRoots,
      totalRoots: activeKeeps.length,
      pendingRoots: remaining,
      stateCount: states.size,
      transitionStateCount: transitions.size,
      rootsPerSecond: Number(rate.toFixed(4)),
      estimatedRemainingSeconds,
      expectedCompletionAt: estimatedRemainingSeconds === null ? null : new Date(Date.now() + estimatedRemainingSeconds * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
  };
  writeStatus();
  for (const ownKeep of activeKeeps) {
    for (const opponentKeep of keeps) {
      if (!isValidPair(ownKeep.ranks, opponentKeep.ranks)) continue;
      visit({
        hands: [opponentKeep.ranks, ownKeep.ranks],
        plays: [],
        count: 0,
        current: 0,
        goPlayer: -1,
        lastPlayer: -1,
      }, states, transitions, touchOrder, 0);
      visit({
        hands: [ownKeep.ranks, opponentKeep.ranks],
        plays: [],
        count: 0,
        current: 0,
        goPlayer: -1,
        lastPlayer: -1,
      }, states, transitions, touchOrder, 0);
    }
    completedRoots += 1;
    if (completedRoots % 5 === 0) writeStatus();
  }
  writeStatus();
  if (options.calibrationOnly) {
    let transitionCount = 0;
    for (const records of transitions.values()) transitionCount += records.length;
    return {
      keeps,
      states: [],
      transitions: [],
      rawStateCount: states.size,
      rawTransitionCount: transitionCount,
      rootsCompleted: completedRoots,
    };
  }
  const stateList = [...states.keys()];
  const idByKey = new Map(stateList.map((key, index) => [key, index]));
  const parsedStates = stateList.map(parseStateKey);
  const flatTransitions = [];
  const stateTransitionOffset = new Uint32Array(parsedStates.length);
  const stateTransitionCount = new Uint16Array(parsedStates.length);
  for (let id = 0; id < stateList.length; id += 1) {
    const records = transitions.get(stateList[id]) ?? [];
    stateTransitionOffset[id] = flatTransitions.length;
    stateTransitionCount[id] = records.length;
    for (const record of records) {
      flatTransitions.push({
        rank: record.rank,
        points: record.points,
        nextStateId: idByKey.get(record.next),
      });
    }
  }
  return {
    keeps,
    states: parsedStates,
    transitions: flatTransitions,
    stateTransitionOffset,
    stateTransitionCount,
    rawStateCount: stateList.length,
    rootsCompleted: completedRoots,
  };
}

function summarizeGlobalBuild({ activeKeeps, keeps, assembled, startedAt, outputPath }) {
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const sampleRoots = activeKeeps.length;
  const totalRoots = keeps.length;
  const stateCount = assembled.rawStateCount ?? assembled.states.length;
  const transitionCount = assembled.rawTransitionCount ?? assembled.transitions?.length ?? 0;
  const sampleBinaryBytes = estimateBinaryBytes(stateCount, transitionCount);
  const linearScale = totalRoots / Math.max(1, sampleRoots);
  return {
    outputPath: path.relative(root, outputPath),
    buildMode: "global-canonical",
    sampleRoots,
    totalRoots,
    stateCount,
    transitionCount,
    sampleBinaryBytes,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    rootsPerSecond: Number((sampleRoots / Math.max(elapsedSeconds, 0.001)).toFixed(4)),
    linearEstimate: {
      stateCount: Math.round(stateCount * linearScale),
      transitionCount: Math.round(transitionCount * linearScale),
      binaryBytes: Math.round(sampleBinaryBytes * linearScale),
      elapsedSeconds: Math.round(elapsedSeconds * linearScale),
      expectedCompletionAt: new Date(Date.now() + elapsedSeconds * linearScale * 1000).toISOString(),
    },
  };
}

function estimateBinaryBytes(stateCount, transitionCount) {
  return 16 + stateCount * 28 + transitionCount * 8;
}

function writeStatusFile(statusPath, status) {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

function runChunk(chunk, keeps, oldMb, memoLimit, checkpointDir) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { chunk, keeps, memoLimit, checkpointDir },
      resourceLimits: oldMb > 0 ? { maxOldGenerationSizeMb: oldMb } : {},
    });
    worker.on("message", (message) => {
      if (message?.type === "progress") {
        completedRoots += message.completedRoots;
        return;
      }
      resolve(message);
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

function runWorker({ chunk, keeps, memoLimit, checkpointDir }) {
  for (const keep of chunk) {
    const checkpointPath = rootCheckpointPath(checkpointDir, keep.id);
    if (!fs.existsSync(checkpointPath)) {
      const graph = buildRootGraph(keep, keeps, memoLimit);
      writeJsonAtomic(checkpointPath, graph);
    }
    parentPort.postMessage({ type: "progress", completedRoots: 1 });
  }
  parentPort.postMessage({ done: true });
}

function buildRootGraph(ownKeep, keeps, memoLimit) {
  const states = new Map();
  const transitions = new Map();
  const roots = [];
  const touchOrder = [];

  for (const opponentKeep of keeps) {
    if (!isValidPair(ownKeep.ranks, opponentKeep.ranks)) continue;
    roots.push(visit({
      hands: [opponentKeep.ranks, ownKeep.ranks],
      plays: [],
      count: 0,
      current: 0,
      goPlayer: -1,
      lastPlayer: -1,
    }, states, transitions, touchOrder, memoLimit));
    roots.push(visit({
      hands: [ownKeep.ranks, opponentKeep.ranks],
      plays: [],
      count: 0,
      current: 0,
      goPlayer: -1,
      lastPlayer: -1,
    }, states, transitions, touchOrder, memoLimit));
  }

  return {
    version: 1,
    rootKeepId: ownKeep.id,
    roots,
    states: [...states.keys()],
    transitions: Object.fromEntries(transitions),
  };
}

function visit(state, states, transitions, touchOrder, memoLimit) {
  const key = stateKey(state);
  if (states.has(key)) return key;
  states.set(key, true);
  touchOrder.push(key);

  const remaining = rankTotal(state.hands[0]) + rankTotal(state.hands[1]);
  if (remaining === 0) {
    if (state.lastPlayer !== -1 && state.count !== 0) {
      const terminal = cloneState(state);
      const terminalKey = stateKey({ ...terminal, lastPlayer: -1, count: 0, plays: [] });
      if (!states.has(terminalKey)) states.set(terminalKey, true);
      transitions.set(key, [{ rank: 255, points: 1, next: terminalKey }]);
    } else {
      transitions.set(key, []);
    }
    return key;
  }

  const legal = legalRanks(state.hands[state.current], state.count);
  const records = [];
  if (!legal.length) {
    if (state.goPlayer !== -1) {
      const next = cloneState(state);
      let points = 0;
      if (next.lastPlayer !== -1 && next.count !== 31) {
        points = 1;
      }
      next.plays = [];
      next.count = 0;
      next.current = 1 - next.current;
      next.goPlayer = -1;
      next.lastPlayer = -1;
      records.push({ rank: 254, points, next: visit(next, states, transitions, touchOrder, memoLimit) });
    } else {
      const next = cloneState(state);
      next.current = 1 - next.current;
      next.goPlayer = state.current;
      records.push({ rank: 253, points: 0, next: visit(next, states, transitions, touchOrder, memoLimit) });
    }
    transitions.set(key, records);
    return key;
  }

  for (const rank of legal) {
    const next = cloneState(state);
    next.hands[next.current][rank] -= 1;
    next.plays.push(rank);
    const points = scoreCountRanks(next.plays);
    next.count += VALUES[rank];
    next.lastPlayer = next.current;
    next.goPlayer = -1;
    if (next.count === 31) {
      next.plays = [];
      next.count = 0;
      next.lastPlayer = -1;
    }
    next.current = 1 - next.current;
    records.push({ rank, points, next: visit(next, states, transitions, touchOrder, memoLimit) });
  }
  transitions.set(key, records);
  return key;
}

function assembleCheckpoints({ keeps, activeKeeps, checkpointDir }) {
  const idByKey = new Map();
  const states = [];
  const transitionKeys = new Map();
  for (const keep of activeKeeps) {
    const checkpoint = JSON.parse(fs.readFileSync(rootCheckpointPath(checkpointDir, keep.id), "utf8"));
    for (const key of checkpoint.states) {
      if (!idByKey.has(key)) {
        idByKey.set(key, states.length);
        states.push(parseStateKey(key));
      }
    }
    for (const [key, records] of Object.entries(checkpoint.transitions)) {
      transitionKeys.set(key, records);
    }
  }
  const transitions = [];
  const stateTransitionOffset = new Uint32Array(states.length);
  const stateTransitionCount = new Uint16Array(states.length);
  for (const [key, id] of idByKey) {
    const records = transitionKeys.get(key) ?? [];
    stateTransitionOffset[id] = transitions.length;
    stateTransitionCount[id] = records.length;
    for (const record of records) {
      transitions.push({
        rank: record.rank,
        points: record.points,
        nextStateId: idByKey.get(record.next),
      });
    }
  }
  return { keeps, states, transitions, stateTransitionOffset, stateTransitionCount };
}

function writeBinaryTable(outputPath, table) {
  const headerBytes = 16;
  const stateBytes = table.states.length * 28;
  const transitionBytes = table.transitions.length * 8;
  const buffer = Buffer.alloc(headerBytes + stateBytes + transitionBytes);
  let offset = 0;
  buffer.write("P13S", offset, "ascii");
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(0, offset);
  offset += 2;
  buffer.writeUInt32LE(table.states.length, offset);
  offset += 4;
  buffer.writeUInt32LE(table.transitions.length, offset);
  offset += 4;
  for (let index = 0; index < table.states.length; index += 1) {
    const state = table.states[index];
    buffer.writeUInt32LE(packRanks(state.hands[0]), offset);
    offset += 4;
    buffer.writeUInt32LE(packRanks(state.hands[1]), offset);
    offset += 4;
    buffer.writeUInt32LE(packStack(state.plays), offset);
    offset += 4;
    buffer.writeUInt8(state.count, offset++);
    buffer.writeUInt8(state.plays.length, offset++);
    buffer.writeUInt8(state.current, offset++);
    buffer.writeUInt8(state.goPlayer + 1, offset++);
    buffer.writeUInt8(state.lastPlayer + 1, offset++);
    buffer.writeUInt8(0, offset++);
    buffer.writeUInt8(0, offset++);
    buffer.writeUInt8(0, offset++);
    buffer.writeUInt32LE(table.stateTransitionOffset[index], offset);
    offset += 4;
    buffer.writeUInt16LE(table.stateTransitionCount[index], offset);
    offset += 2;
    buffer.writeUInt16LE(0, offset);
    offset += 2;
  }
  for (const transition of table.transitions) {
    buffer.writeUInt8(transition.rank, offset++);
    buffer.writeUInt8(transition.points, offset++);
    buffer.writeUInt16LE(0, offset);
    offset += 2;
    buffer.writeUInt32LE(transition.nextStateId ?? 0xffffffff, offset);
    offset += 4;
  }
  fs.writeFileSync(outputPath, buffer);
}

function stateKey(state) {
  return [
    state.hands[0].join(""),
    state.hands[1].join(""),
    state.plays.join(","),
    state.count,
    state.current,
    state.goPlayer,
    state.lastPlayer,
  ].join("|");
}

function parseStateKey(key) {
  const [a, b, plays, count, current, goPlayer, lastPlayer] = key.split("|");
  return {
    hands: [a.split("").map(Number), b.split("").map(Number)],
    plays: plays ? plays.split(",").filter(Boolean).map(Number) : [],
    count: Number(count),
    current: Number(current),
    goPlayer: Number(goPlayer),
    lastPlayer: Number(lastPlayer),
  };
}

function cloneState(state) {
  return {
    hands: [state.hands[0].slice(), state.hands[1].slice()],
    plays: state.plays.slice(),
    count: state.count,
    current: state.current,
    goPlayer: state.goPlayer,
    lastPlayer: state.lastPlayer,
  };
}

function makeBalancedChunks(activeKeeps, workers) {
  const chunks = Array.from({ length: workers }, () => []);
  activeKeeps.forEach((keep, index) => chunks[index % workers].push(keep));
  return chunks.filter((chunk) => chunk.length > 0);
}

function rootCheckpointPath(checkpointDir, keepId) {
  return path.join(checkpointDir, `${String(keepId).padStart(4, "0")}.json`);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value)}\n`);
  fs.renameSync(tempPath, filePath);
}

function enumerateKeeps() {
  const keeps = [];
  function visit(rank, remaining, counts) {
    if (rank === 13) {
      if (remaining === 0) keeps.push({ key: counts.join(""), ranks: counts.slice() });
      return;
    }
    for (let count = 0; count <= Math.min(4, remaining); count += 1) {
      counts[rank] = count;
      visit(rank + 1, remaining - count, counts);
    }
    counts[rank] = 0;
  }
  visit(0, 4, Array(13).fill(0));
  return keeps;
}

function isValidPair(a, b) {
  for (let rank = 0; rank < 13; rank += 1) {
    if (a[rank] + b[rank] > 4) return false;
  }
  return true;
}

function legalRanks(ranks, count) {
  const legal = [];
  for (let rank = 0; rank < ranks.length; rank += 1) {
    if (ranks[rank] > 0 && count + VALUES[rank] <= 31) legal.push(rank);
  }
  return legal;
}

function rankTotal(ranks) {
  return ranks.reduce((sum, count) => sum + count, 0);
}

function scoreCountRanks(plays) {
  let points = 0;
  const total = plays.reduce((sum, rank) => sum + VALUES[rank], 0);
  if (total === 15 || total === 31) points += 2;
  const last = plays[plays.length - 1];
  let same = 0;
  for (let index = plays.length - 1; index >= 0 && plays[index] === last; index -= 1) same += 1;
  if (same === 2) points += 2;
  else if (same === 3) points += 6;
  else if (same === 4) points += 12;
  for (let length = Math.min(plays.length, 7); length >= 3; length -= 1) {
    const slice = plays.slice(-length);
    const sorted = [...slice].sort((a, b) => a - b);
    let run = true;
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] !== sorted[index - 1] + 1) {
        run = false;
        break;
      }
    }
    if (run) {
      points += length;
      break;
    }
  }
  return points;
}

function packRanks(ranks) {
  let packed = 0;
  for (let rank = 0; rank < 13; rank += 1) packed |= (ranks[rank] & 0x7) << (rank * 3);
  return packed >>> 0;
}

function packStack(plays) {
  let packed = 0;
  for (let index = 0; index < Math.min(8, plays.length); index += 1) packed |= (plays[index] & 0xf) << (index * 4);
  return packed >>> 0;
}
