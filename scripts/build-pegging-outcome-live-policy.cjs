#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "benchmarks", "pegging-table", "live-policy-12.0", "pegging-outcome-pairwise-live.bin");
let completedKeeps = 0;

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
  const manifestPath = outputPath.replace(/\.bin$/i, ".manifest.json");
  const workerCount = Number.parseInt(process.argv[3] || "", 10) || Math.max(1, Math.min(os.cpus().length - 2, 8));
  const keepLimit = Number.parseInt(process.argv[4] || "", 10) || 0;
  const oldMb = Number.parseInt(process.argv[5] || "", 10) || 0;
  const pairLimit = Number.parseInt(process.argv[6] || "", 10) || 0;
  const statusPath = process.env.PEGGING_OUTCOME_STATUS_PATH
    ? path.resolve(root, process.env.PEGGING_OUTCOME_STATUS_PATH)
    : outputPath.replace(/\.bin$/i, ".status.json");
  const checkpointDir = process.env.PEGGING_OUTCOME_CHECKPOINT_DIR
    ? path.resolve(root, process.env.PEGGING_OUTCOME_CHECKPOINT_DIR)
    : outputPath.replace(/\.bin$/i, ".checkpoints");
  const keeps = enumerateKeeps().map((keep, id) => ({ ...keep, id }));
  const activeKeeps = keepLimit > 0 ? keeps.slice(0, keepLimit) : keeps;
  fs.mkdirSync(checkpointDir, { recursive: true });
  completedKeeps = activeKeeps.filter((keep) => fs.existsSync(checkpointPath(checkpointDir, keep.id))).length;
  const pendingKeeps = activeKeeps.filter((keep) => !fs.existsSync(checkpointPath(checkpointDir, keep.id)));
  const workers = Math.max(1, Math.min(workerCount, activeKeeps.length));
  const chunks = makeBalancedChunks(pendingKeeps, workers);
  const startedAt = Date.now();
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });

  const writeStatus = (status = "running") => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = completedKeeps / Math.max(elapsed, 0.001);
    const remaining = activeKeeps.length - completedKeeps;
    const estimatedRemainingSeconds = rate ? Math.round(remaining / rate) : null;
    fs.writeFileSync(statusPath, `${JSON.stringify({
      status,
      outputPath: path.relative(root, outputPath),
      checkpointDir: path.relative(root, checkpointDir),
      completedKeeps,
      totalKeeps: activeKeeps.length,
      pendingKeeps: Math.max(0, activeKeeps.length - completedKeeps),
      workers,
      oldMb,
      pairLimit,
      keepsPerSecond: Number(rate.toFixed(4)),
      estimatedRemainingSeconds,
      expectedCompletionAt: estimatedRemainingSeconds === null
        ? null
        : new Date(Date.now() + (estimatedRemainingSeconds * 1000)).toISOString(),
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
  };
  writeStatus();
  const interval = setInterval(() => {
    writeStatus();
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    process.stderr.write(`${JSON.stringify(status)}\n`);
  }, 30000);

  const results = await Promise.all(chunks.map((chunk) => runChunk(chunk, keeps, oldMb, pairLimit, checkpointDir)));
  clearInterval(interval);

  const dealerOffsets = new Uint32Array(keeps.length + 1);
  const poneOffsets = new Uint32Array((keeps.length * 13) + 1);
  let validPairCount = 0;
  const dealerRecords = [];
  const poneRecords = [];
  for (const keep of activeKeeps) {
    const checkpoint = readKeepCheckpoint(checkpointPath(checkpointDir, keep.id));
    validPairCount += checkpoint.validPairCount;
    const dealerBase = dealerRecords.length;
    const poneBase = poneRecords.length;
    dealerOffsets[keep.id] = dealerBase;
    for (const record of checkpoint.dealerRecords) dealerRecords.push(record);
    dealerOffsets[keep.id + 1] = dealerRecords.length;
    for (let index = 0; index < checkpoint.poneOffsets.length; index += 1) {
      poneOffsets[(keep.id * 13) + index] = poneBase + checkpoint.poneOffsets[index];
    }
    for (const record of checkpoint.poneRecords) poneRecords.push(record);
  }

  const dealerRecordArray = Uint32Array.from(dealerRecords);
  const poneRecordArray = Uint32Array.from(poneRecords);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeBinaryTable(outputPath, {
    keepCount: keeps.length,
    dealerOffsets,
    poneOffsets,
    dealerRecords: dealerRecordArray,
    poneRecords: poneRecordArray,
  });

  const manifest = {
    version: 1,
    model: "schell_table-peg_table-12.0-live-policy-candidate",
    generatedAt: new Date().toISOString(),
    policy: "rank-only imperfect-information live pegging policy; each actual turn chooses by exhaustive expected point EV over legal opponent rank hands from public information, then records the realized pair outcome",
    ranks: RANKS,
    keepCount: keeps.length,
    emittedKeepCount: activeKeeps.length,
    validPairCount,
    binaryPath: path.basename(outputPath),
    binaryFormat: {
      endian: "little",
      header: "magic P12P, version u16, keepCount u16, dealerRecordCount u32, poneRecordCount u32",
      sections: [
        "dealerOffsets uint32[keepCount + 1]",
        "poneOffsets uint32[keepCount * 13 + 1]",
        "dealerRecords uint32[dealerRecordCount]",
        "poneRecords uint32[poneRecordCount]",
      ],
      record: "bits 0-10 opponentKeepId, 11-15 myPeggingPoints, 16-20 opponentPeggingPoints, 21-28 weightMinusOne",
    },
    dealerRecordCount: dealerRecordArray.length,
    poneRecordCount: poneRecordArray.length,
    keepKeys: keeps.map((keep) => keep.key),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  writeStatus("complete");
  console.log(JSON.stringify({
    outputPath: path.relative(root, outputPath),
    manifestPath: path.relative(root, manifestPath),
    statusPath: path.relative(root, statusPath),
    checkpointDir: path.relative(root, checkpointDir),
    workerCount: workers,
    oldMb,
    pairLimit,
    keepCount: keeps.length,
    emittedKeepCount: activeKeeps.length,
    validPairCount,
    dealerRecordCount: dealerRecordArray.length,
    poneRecordCount: poneRecordArray.length,
    binaryBytes: fs.statSync(outputPath).size,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
  }, null, 2));
}

function makeBalancedChunks(activeKeeps, workers) {
  const chunks = Array.from({ length: workers }, () => []);
  activeKeeps.forEach((keep, index) => chunks[index % workers].push(keep));
  return chunks.filter((chunk) => chunk.length > 0);
}

function runChunk(chunk, keeps, oldMb, pairLimit, checkpointDir) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { chunk, keeps, pairLimit, checkpointDir },
      resourceLimits: oldMb > 0 ? { maxOldGenerationSizeMb: oldMb } : {},
    });
    worker.on("message", (message) => {
      if (message?.type === "progress") {
        completedKeeps += message.completedKeeps;
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

function runWorker({ chunk, keeps, pairLimit, checkpointDir }) {
  let completedKeeps = 0;
  for (const ownKeep of chunk) {
    const keepCheckpointPath = checkpointPath(checkpointDir, ownKeep.id);
    if (fs.existsSync(keepCheckpointPath)) {
      completedKeeps += 1;
      parentPort.postMessage({ type: "progress", completedKeeps: 1 });
      continue;
    }
    const poneOffsets = [0];
    const dealerRecords = [];
    const poneRecords = [];
    let validPairCount = 0;
    const legalLeadSet = new Set(legalRanks(ownKeep.ranks, 0));
    const leadRecords = Array.from({ length: 13 }, () => []);
    let emittedPairsForKeep = 0;
    for (const opponentKeep of keeps) {
      if (!isValidPair(ownKeep.ranks, opponentKeep.ranks)) continue;
      const weight = opponentWeight(ownKeep.ranks, opponentKeep.ranks);
      if (!weight) continue;
      if (pairLimit > 0 && emittedPairsForKeep >= pairLimit) continue;
      validPairCount += 1;
      emittedPairsForKeep += 1;

      const dealerOutcome = playLivePolicyPegging({
        ownInitial: ownKeep.ranks,
        opponentInitial: opponentKeep.ranks,
        ownRole: "dealer",
        forcedLead: null,
      });
      dealerRecords.push(packRecord(opponentKeep.id, dealerOutcome.own, dealerOutcome.opponent, weight));

      for (const lead of legalLeadSet) {
        const poneOutcome = playLivePolicyPegging({
          ownInitial: ownKeep.ranks,
          opponentInitial: opponentKeep.ranks,
          ownRole: "pone",
          forcedLead: lead,
        });
        leadRecords[lead].push(packRecord(opponentKeep.id, poneOutcome.own, poneOutcome.opponent, weight));
      }
    }
    for (let lead = 0; lead < 13; lead += 1) {
      if (legalLeadSet.has(lead)) {
        for (const record of leadRecords[lead]) poneRecords.push(record);
      }
      poneOffsets.push(poneRecords.length);
    }
    writeKeepCheckpoint(keepCheckpointPath, {
      keepId: ownKeep.id,
      validPairCount,
      poneOffsets: Uint32Array.from(poneOffsets),
      dealerRecords: Uint32Array.from(dealerRecords),
      poneRecords: Uint32Array.from(poneRecords),
    });
    completedKeeps += 1;
    parentPort.postMessage({ type: "progress", completedKeeps: 1 });
  }
  parentPort.postMessage({ completedKeeps });
}

function checkpointPath(checkpointDir, keepId) {
  return path.join(checkpointDir, `${String(keepId).padStart(4, "0")}.p12k`);
}

function writeKeepCheckpoint(filePath, checkpoint) {
  const headerBytes = 32;
  const poneOffsetBytes = checkpoint.poneOffsets.length * 4;
  const dealerRecordBytes = checkpoint.dealerRecords.length * 4;
  const poneRecordBytes = checkpoint.poneRecords.length * 4;
  const buffer = Buffer.alloc(headerBytes + poneOffsetBytes + dealerRecordBytes + poneRecordBytes);
  let offset = 0;
  buffer.write("P12K", offset, "ascii");
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(checkpoint.keepId, offset);
  offset += 2;
  buffer.writeUInt32LE(checkpoint.validPairCount, offset);
  offset += 4;
  buffer.writeUInt32LE(checkpoint.poneOffsets.length, offset);
  offset += 4;
  buffer.writeUInt32LE(checkpoint.dealerRecords.length, offset);
  offset += 4;
  buffer.writeUInt32LE(checkpoint.poneRecords.length, offset);
  offset += 4;
  buffer.writeUInt32LE(0, offset);
  offset += 4;
  buffer.writeUInt32LE(0, offset);
  offset += 4;
  offset = writeUint32Array(buffer, offset, checkpoint.poneOffsets);
  offset = writeUint32Array(buffer, offset, checkpoint.dealerRecords);
  offset = writeUint32Array(buffer, offset, checkpoint.poneRecords);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, filePath);
}

function readKeepCheckpoint(filePath) {
  const buffer = fs.readFileSync(filePath);
  const magic = buffer.toString("ascii", 0, 4);
  if (magic !== "P12K") throw new Error(`Unexpected keep checkpoint magic in ${filePath}: ${magic}`);
  let offset = 4;
  const version = buffer.readUInt16LE(offset);
  offset += 2;
  const keepId = buffer.readUInt16LE(offset);
  offset += 2;
  const validPairCount = buffer.readUInt32LE(offset);
  offset += 4;
  const poneOffsetCount = buffer.readUInt32LE(offset);
  offset += 4;
  const dealerRecordCount = buffer.readUInt32LE(offset);
  offset += 4;
  const poneRecordCount = buffer.readUInt32LE(offset);
  offset += 4;
  offset += 8;
  if (version !== 1) throw new Error(`Unsupported keep checkpoint version in ${filePath}: ${version}`);
  const poneOffsets = readUint32Array(buffer, offset, poneOffsetCount);
  offset += poneOffsetCount * 4;
  const dealerRecords = readUint32Array(buffer, offset, dealerRecordCount);
  offset += dealerRecordCount * 4;
  const poneRecords = readUint32Array(buffer, offset, poneRecordCount);
  return {
    keepId,
    validPairCount,
    poneOffsets,
    dealerRecords,
    poneRecords,
  };
}

function readUint32Array(buffer, offset, count) {
  const values = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) {
    values[index] = buffer.readUInt32LE(offset);
    offset += 4;
  }
  return values;
}

function playLivePolicyPegging({ ownInitial, opponentInitial, ownRole, forcedLead }) {
  const hands = [ownInitial.slice(), opponentInitial.slice()];
  const playedByPlayer = [[], []];
  const roles = ownRole === "dealer" ? ["dealer", "pone"] : ["pone", "dealer"];
  let current = ownRole === "dealer" ? 1 : 0;
  let count = 0;
  let plays = [];
  let goPlayer = -1;
  let lastPlayer = -1;
  const points = [0, 0];

  if (forcedLead !== null) {
    hands[0][forcedLead] -= 1;
    playedByPlayer[0].push(forcedLead);
    plays = [forcedLead];
    count = VALUES[forcedLead];
    points[0] += scoreCountRanks(plays);
    current = 1;
    lastPlayer = 0;
  }

  while (rankTotal(hands[0]) + rankTotal(hands[1]) > 0) {
    const legal = legalRanks(hands[current], count);
    if (!legal.length) {
      if (goPlayer !== -1) {
        if (lastPlayer !== -1 && count !== 31) points[lastPlayer] += 1;
        plays = [];
        count = 0;
        goPlayer = -1;
        lastPlayer = -1;
        current = 1 - current;
      } else {
        goPlayer = current;
        current = 1 - current;
      }
      continue;
    }

    const rank = chooseLivePolicyRank({
      player: current,
      hands,
      playedByPlayer,
      roles,
      plays,
      count,
      legal,
    });
    hands[current][rank] -= 1;
    playedByPlayer[current].push(rank);
    plays.push(rank);
    count += VALUES[rank];
    points[current] += scoreCountRanks(plays);
    lastPlayer = current;
    goPlayer = -1;
    if (count === 31) {
      plays = [];
      count = 0;
      lastPlayer = -1;
    }
    current = 1 - current;
  }

  if (lastPlayer !== -1 && count !== 0) points[lastPlayer] += 1;
  return { own: points[0], opponent: points[1] };
}

function chooseLivePolicyRank({ player, hands, playedByPlayer, roles, plays, count, legal }) {
  let bestRank = legal[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const rank of legal) {
    const score = livePolicyPointEv({ player, hands, playedByPlayer, roles, plays, count, rank });
    const bestTuple = [bestScore, scoreCountRanks([...plays, bestRank]), VALUES[bestRank]];
    const tuple = [score, scoreCountRanks([...plays, rank]), VALUES[rank]];
    if (compareTuple(tuple, bestTuple) > 0) {
      bestScore = score;
      bestRank = rank;
    }
  }
  return bestRank;
}

function livePolicyPointEv({ player, hands, playedByPlayer, roles, plays, count, rank }) {
  const ownAfter = hands[player].slice();
  ownAfter[rank] -= 1;
  const immediateScore = scoreCountRanks([...plays, rank]);
  const countAfterPlay = count + VALUES[rank];
  const available = Array.from({ length: 13 }, () => 4);
  for (const playedRank of playedByPlayer[0]) available[playedRank] -= 1;
  for (const playedRank of playedByPlayer[1]) available[playedRank] -= 1;
  for (let i = 0; i < 13; i += 1) available[i] -= hands[player][i];
  const opponentHands = enumerateRankHands(available.map((value) => Math.max(0, value)), rankTotal(hands[1 - player]));
  let weightedTotal = 0;
  let totalWeight = 0;
  const memo = new Map();
  for (const opponentHand of opponentHands) {
    const result = simulatePegging({
      hands: player === 0
        ? [ownAfter, opponentHand.ranks]
        : [opponentHand.ranks, ownAfter],
      plays: countAfterPlay === 31 ? [] : [...plays, rank],
      count: countAfterPlay === 31 ? 0 : countAfterPlay,
      current: 1 - player,
      goPlayer: -1,
      lastPlayer: countAfterPlay === 31 ? -1 : player,
      perspective: player,
      roles,
    }, memo);
    weightedTotal += ((immediateScore * result.weight) + result.total) * opponentHand.weight;
    totalWeight += result.weight * opponentHand.weight;
  }
  return totalWeight ? weightedTotal / totalWeight : immediateScore;
}

function simulatePegging(state, memo) {
  const key = simulationKey(state);
  const cached = memo.get(key);
  if (cached) return cached;

  const remaining = rankTotal(state.hands[0]) + rankTotal(state.hands[1]);
  if (remaining === 0) {
    const terminal = {
      total: state.lastPlayer !== -1 && state.count !== 0
        ? perspectiveScore(state.perspective, state.lastPlayer, 1)
        : 0,
      weight: 1,
    };
    memo.set(key, terminal);
    return terminal;
  }

  const legal = legalRanks(state.hands[state.current], state.count);
  if (!legal.length) {
    if (state.goPlayer !== -1) {
      const goPoint = state.lastPlayer !== -1 && state.count !== 31
        ? perspectiveScore(state.perspective, state.lastPlayer, 1)
        : 0;
      const future = simulatePegging({
        ...state,
        plays: [],
        count: 0,
        current: 1 - state.current,
        goPlayer: -1,
        lastPlayer: -1,
      }, memo);
      const result = { total: (goPoint * future.weight) + future.total, weight: future.weight };
      memo.set(key, result);
      return result;
    }
    const result = simulatePegging({
      ...state,
      current: 1 - state.current,
      goPlayer: state.current,
    }, memo);
    memo.set(key, result);
    return result;
  }

  let total = 0;
  let weight = 0;
  for (const rank of legal) {
    const branchWeight = state.hands[state.current][rank];
    const hands = [state.hands[0].slice(), state.hands[1].slice()];
    hands[state.current][rank] -= 1;
    const plays = [...state.plays, rank];
    const points = scoreCountRanks(plays);
    const nextCount = state.count + VALUES[rank];
    const future = simulatePegging(nextCount === 31
      ? {
          ...state,
          hands,
          plays: [],
          count: 0,
          current: 1 - state.current,
          goPlayer: -1,
          lastPlayer: -1,
        }
      : {
          ...state,
          hands,
          plays,
          count: nextCount,
          current: 1 - state.current,
          goPlayer: -1,
          lastPlayer: state.current,
        }, memo);
    total += branchWeight * ((perspectiveScore(state.perspective, state.current, points) * future.weight) + future.total);
    weight += branchWeight * future.weight;
  }
  const result = { total, weight };
  memo.set(key, result);
  return result;
}

function simulationKey(state) {
  return [
    state.hands[0].join(""),
    state.hands[1].join(""),
    state.plays.join(","),
    state.count,
    state.current,
    state.goPlayer,
    state.lastPlayer,
    state.perspective,
  ].join("|");
}

function perspectiveScore(perspective, scorer, points) {
  return scorer === perspective ? points : -points;
}

function packRecord(opponentKeepId, myPoints, opponentPoints, weight) {
  if (opponentKeepId < 0 || opponentKeepId > 2047) throw new Error(`Opponent keep id out of range: ${opponentKeepId}`);
  if (myPoints < 0 || myPoints > 31) throw new Error(`My pegging points out of range: ${myPoints}`);
  if (opponentPoints < 0 || opponentPoints > 31) throw new Error(`Opponent pegging points out of range: ${opponentPoints}`);
  if (weight < 1 || weight > 256) throw new Error(`Weight out of range: ${weight}`);
  return opponentKeepId |
    (myPoints << 11) |
    (opponentPoints << 16) |
    ((weight - 1) << 21);
}

function writeBinaryTable(outputPath, table) {
  const headerBytes = 20;
  const buffer = Buffer.alloc(
    headerBytes +
    (table.dealerOffsets.length * 4) +
    (table.poneOffsets.length * 4) +
    (table.dealerRecords.length * 4) +
    (table.poneRecords.length * 4),
  );
  let offset = 0;
  buffer.write("P12P", offset, "ascii");
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(table.keepCount, offset);
  offset += 2;
  buffer.writeUInt32LE(table.dealerRecords.length, offset);
  offset += 4;
  buffer.writeUInt32LE(table.poneRecords.length, offset);
  offset += 4;
  buffer.writeUInt32LE(0, offset);
  offset += 4;
  offset = writeUint32Array(buffer, offset, table.dealerOffsets);
  offset = writeUint32Array(buffer, offset, table.poneOffsets);
  offset = writeUint32Array(buffer, offset, table.dealerRecords);
  offset = writeUint32Array(buffer, offset, table.poneRecords);
  fs.writeFileSync(outputPath, buffer);
}

function writeUint32Array(buffer, offset, values) {
  for (let index = 0; index < values.length; index += 1) {
    buffer.writeUInt32LE(values[index], offset);
    offset += 4;
  }
  return offset;
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

function enumerateRankHands(available, size) {
  const hands = [];
  const ranks = Array(13).fill(0);
  function visit(rank, remaining, weight) {
    if (rank === 13) {
      if (remaining === 0) hands.push({ ranks: ranks.slice(), weight });
      return;
    }
    const maxUse = Math.min(available[rank], remaining);
    for (let used = 0; used <= maxUse; used += 1) {
      ranks[rank] = used;
      visit(rank + 1, remaining - used, weight * choose(available[rank], used));
    }
    ranks[rank] = 0;
  }
  visit(0, size, 1);
  return hands;
}

function isValidPair(a, b) {
  for (let rank = 0; rank < 13; rank += 1) {
    if (a[rank] + b[rank] > 4) return false;
  }
  return true;
}

function opponentWeight(own, opponent) {
  let weight = 1;
  for (let rank = 0; rank < 13; rank += 1) {
    weight *= choose(4 - own[rank], opponent[rank]);
  }
  return weight;
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - k + index)) / index;
  return result;
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

function compareTuple(a, b) {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}
