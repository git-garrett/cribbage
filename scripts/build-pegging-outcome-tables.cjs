#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "web", "src", "models", "schell_table-peg_table-12.0", "pegging-outcome-pairwise.bin");
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
  const keeps = enumerateKeeps().map((keep, id) => ({ ...keep, id }));
  const activeKeeps = keepLimit > 0 ? keeps.slice(0, keepLimit) : keeps;
  const workers = Math.max(1, Math.min(workerCount, activeKeeps.length));
  const chunkSize = Math.ceil(activeKeeps.length / workers);
  const chunks = Array.from({ length: workers }, (_, index) =>
    activeKeeps.slice(index * chunkSize, (index + 1) * chunkSize)).filter((chunk) => chunk.length > 0);
  const startedAt = Date.now();
  const interval = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = completedKeeps / Math.max(elapsed, 0.001);
    const remaining = activeKeeps.length - completedKeeps;
    process.stderr.write(JSON.stringify({
      status: "running",
      completedKeeps,
      totalKeeps: activeKeeps.length,
      keepsPerSecond: Number(rate.toFixed(3)),
      estimatedRemainingSeconds: rate ? Math.round(remaining / rate) : null,
    }) + "\n");
  }, 30000);

  const results = await Promise.all(chunks.map((chunk) => runChunk(chunk, keeps)));
  clearInterval(interval);

  const dealerOffsets = new Uint32Array(activeKeeps.length + 1);
  const poneOffsets = new Uint32Array((activeKeeps.length * 13) + 1);
  let validPairCount = 0;
  const dealerRecords = [];
  const poneRecords = [];
  for (const result of results.sort((a, b) => a.startKeepId - b.startKeepId)) {
    validPairCount += result.validPairCount;
    const localDealerOffsets = new Uint32Array(result.dealerOffsets);
    const localPoneOffsets = new Uint32Array(result.poneOffsets);
    const localDealerRecords = new Uint32Array(result.dealerRecords);
    const localPoneRecords = new Uint32Array(result.poneRecords);
    const keepBase = result.startKeepId;
    const dealerBase = dealerRecords.length;
    const poneBase = poneRecords.length;
    for (let index = 0; index < localDealerRecords.length; index += 1) dealerRecords.push(localDealerRecords[index]);
    for (let index = 0; index < localPoneRecords.length; index += 1) poneRecords.push(localPoneRecords[index]);
    for (let index = 0; index < localDealerOffsets.length - 1; index += 1) {
      dealerOffsets[keepBase + index] = dealerBase + localDealerOffsets[index];
    }
    dealerOffsets[keepBase + localDealerOffsets.length - 1] = dealerBase + localDealerOffsets[localDealerOffsets.length - 1];
    for (let index = 0; index < localPoneOffsets.length - 1; index += 1) {
      poneOffsets[(keepBase * 13) + index] = poneBase + localPoneOffsets[index];
    }
    poneOffsets[(keepBase * 13) + localPoneOffsets.length - 1] = poneBase + localPoneOffsets[localPoneOffsets.length - 1];
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
    model: "schell_table-peg_table-12.0",
    generatedAt: new Date().toISOString(),
    policy: "rank-only perfect-information recursive pegging policy; app dynamically aggregates pairwise outcomes by known-card opponent keep weights",
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
  console.log(JSON.stringify({
    outputPath: path.relative(root, outputPath),
    manifestPath: path.relative(root, manifestPath),
    workerCount: workers,
    keepCount: keeps.length,
    emittedKeepCount: activeKeeps.length,
    validPairCount,
    dealerRecordCount: dealerRecordArray.length,
    poneRecordCount: poneRecordArray.length,
    binaryBytes: fs.statSync(outputPath).size,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
  }, null, 2));
}

function runChunk(chunk, keeps) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { chunk, keeps } });
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

function runWorker({ chunk, keeps }) {
  const dealerOffsets = [0];
  const poneOffsets = [0];
  const dealerRecords = [];
  const poneRecords = [];
  let validPairCount = 0;
  let completedKeeps = 0;
  for (const ownKeep of chunk) {
    const legalLeadSet = new Set(legalRanks(ownKeep.ranks, 0));
    const leadRecords = Array.from({ length: 13 }, () => []);
    for (const opponentKeep of keeps) {
      if (!isValidPair(ownKeep.ranks, opponentKeep.ranks)) continue;
      const weight = opponentWeight(ownKeep.ranks, opponentKeep.ranks);
      if (!weight) continue;
      validPairCount += 1;
      const pairMemo = new Map();

      const dealerOutcome = optimalPegging({
        hands: [opponentKeep.ranks, ownKeep.ranks],
        plays: [],
        count: 0,
        current: 0,
        goPlayer: -1,
        lastPlayer: -1,
      }, pairMemo);
      dealerRecords.push(packRecord(opponentKeep.id, dealerOutcome.points[1], dealerOutcome.points[0], weight));

      for (const lead of legalLeadSet) {
        const afterLead = ownKeep.ranks.slice();
        afterLead[lead] -= 1;
        const outcome = optimalPegging({
          hands: [afterLead, opponentKeep.ranks],
          plays: [lead],
          count: VALUES[lead],
          current: 1,
          goPlayer: -1,
          lastPlayer: 0,
        }, pairMemo);
        leadRecords[lead].push(packRecord(opponentKeep.id, outcome.points[0], outcome.points[1], weight));
      }
    }
    dealerOffsets.push(dealerRecords.length);
    for (let lead = 0; lead < 13; lead += 1) {
      if (legalLeadSet.has(lead)) {
        for (const record of leadRecords[lead]) poneRecords.push(record);
      }
      poneOffsets.push(poneRecords.length);
    }
    completedKeeps += 1;
    if (completedKeeps % 5 === 0) parentPort.postMessage({ type: "progress", completedKeeps: 5 });
  }
  if (completedKeeps % 5) parentPort.postMessage({ type: "progress", completedKeeps: completedKeeps % 5 });
  parentPort.postMessage({
    startKeepId: chunk[0]?.id ?? 0,
    dealerOffsets: Uint32Array.from(dealerOffsets).buffer,
    poneOffsets: Uint32Array.from(poneOffsets).buffer,
    dealerRecords: Uint32Array.from(dealerRecords).buffer,
    poneRecords: Uint32Array.from(poneRecords).buffer,
    validPairCount,
  });
}

function optimalPegging(state, memo) {
  const key = stateKey(state);
  const cached = memo.get(key);
  if (cached) return cached;

  const remaining = rankTotal(state.hands[0]) + rankTotal(state.hands[1]);
  if (remaining === 0) {
    const points = [0, 0];
    if (state.lastPlayer !== -1 && state.count !== 0) points[state.lastPlayer] += 1;
    const terminal = { points };
    memo.set(key, terminal);
    return terminal;
  }

  const legal = legalRanks(state.hands[state.current], state.count);
  if (legal.length === 0) {
    if (state.goPlayer !== -1) {
      const future = optimalPegging({
        ...state,
        plays: [],
        count: 0,
        current: 1 - state.current,
        goPlayer: -1,
        lastPlayer: -1,
      }, memo);
      const points = future.points.slice();
      if (state.lastPlayer !== -1 && state.count !== 31) points[state.lastPlayer] += 1;
      const result = { points };
      memo.set(key, result);
      return result;
    }
    const result = optimalPegging({
      ...state,
      current: 1 - state.current,
      goPlayer: state.current,
    }, memo);
    memo.set(key, result);
    return result;
  }

  let best = null;
  for (const rank of legal) {
    const hands = [state.hands[0].slice(), state.hands[1].slice()];
    hands[state.current][rank] -= 1;
    const plays = [...state.plays, rank];
    const points = scoreCountRanks(plays);
    const nextCount = state.count + VALUES[rank];
    const future = optimalPegging(nextCount === 31
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
    const outcome = { points: future.points.slice(), rank };
    outcome.points[state.current] += points;
    if (!best || compareOutcomeForPlayer(outcome, best, state.current) > 0) best = outcome;
  }
  const result = { points: best.points };
  memo.set(key, result);
  return result;
}

function compareOutcomeForPlayer(a, b, player) {
  const aNet = a.points[player] - a.points[1 - player];
  const bNet = b.points[player] - b.points[1 - player];
  if (aNet !== bNet) return aNet - bNet;
  if (a.points[player] !== b.points[player]) return a.points[player] - b.points[player];
  return VALUES[b.rank] - VALUES[a.rank];
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
  const dealerOffsetBytes = table.dealerOffsets.length * 4;
  const poneOffsetBytes = table.poneOffsets.length * 4;
  const dealerRecordBytes = table.dealerRecords.length * 4;
  const poneRecordBytes = table.poneRecords.length * 4;
  const buffer = Buffer.alloc(headerBytes + dealerOffsetBytes + poneOffsetBytes + dealerRecordBytes + poneRecordBytes);
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
      if (remaining === 0) keeps.push({
        key: counts.join(""),
        ranks: counts.slice(),
        rankLabels: expandRanks(counts).map((value) => RANKS[value]),
        suitCombinations: rankSuitCombinations(counts),
      });
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

function opponentWeight(own, opponent) {
  let weight = 1;
  for (let rank = 0; rank < 13; rank += 1) {
    weight *= choose(4 - own[rank], opponent[rank]);
  }
  return weight;
}

function rankSuitCombinations(ranks) {
  let weight = 1;
  for (let rank = 0; rank < 13; rank += 1) weight *= choose(4, ranks[rank]);
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

function addHist(hist, my, opponent, weight) {
  const key = `${my},${opponent}`;
  hist.set(key, (hist.get(key) ?? 0) + weight);
}

function summarizeHist(hist) {
  const entries = [...hist.entries()]
    .map(([key, weight]) => {
      const [my, opponent] = key.split(",").map((value) => Number.parseInt(value, 10));
      return [my, opponent, weight];
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const totalWeight = entries.reduce((sum, entry) => sum + entry[2], 0);
  let myTotal = 0;
  let opponentTotal = 0;
  for (const [my, opponent, weight] of entries) {
    myTotal += my * weight;
    opponentTotal += opponent * weight;
  }
  return {
    totalWeight,
    myEv: totalWeight ? myTotal / totalWeight : 0,
    opponentEv: totalWeight ? opponentTotal / totalWeight : 0,
    hist: entries,
  };
}

function expandRanks(ranks) {
  const expanded = [];
  for (let rank = 0; rank < ranks.length; rank += 1) {
    for (let index = 0; index < ranks[rank]; index += 1) expanded.push(rank);
  }
  return expanded;
}
