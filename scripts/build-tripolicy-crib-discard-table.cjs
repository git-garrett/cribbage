#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const root = path.resolve(__dirname, "..");
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const ROLES = ["dealer", "pone"];
const POLICIES = ["ev", "on", "off"];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const outDir = path.resolve(root, args.outDir || path.join("benchmarks", "crib-discard", `tripolicy-crib-discard-${dateSlug()}`));
  const outputPath = path.resolve(root, args.output || path.join(outDir, "crib-score-histogram-tripolicy-by-discard-cut.json"));
  const checkpointDir = path.join(outDir, "checkpoints");
  const statusPath = path.join(outDir, "status.json");
  const workerCount = positiveInt(args.workers, Math.max(1, Math.min(os.cpus().length - 2, 6)));
  const oldMb = positiveInt(args.oldMb, 1024);
  const memoLimit = positiveInt(args.memoLimit, 100000);
  const roots = buildRoots({
    startRoot: positiveInt(args.startRoot, 0),
    limit: positiveInt(args.limit, 0),
  });
  fs.mkdirSync(checkpointDir, { recursive: true });

  let stopping = false;
  const startedAt = Date.now();
  let lastCompletedRoots = 0;
  let lastCompletedAt = Date.now();
  const writeStatus = (status = "running") => {
    const completedRoots = countCompleted(roots, checkpointDir);
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const deltaRoots = completedRoots - lastCompletedRoots;
    const deltaSeconds = Math.max(0.001, (Date.now() - lastCompletedAt) / 1000);
    const recentRootsPerSecond = deltaRoots / deltaSeconds;
    if (deltaRoots > 0) {
      lastCompletedRoots = completedRoots;
      lastCompletedAt = Date.now();
    }
    const rootsPerSecond = completedRoots / Math.max(0.001, elapsedSeconds);
    const pendingRoots = roots.length - completedRoots;
    const estimateRate = recentRootsPerSecond > 0 ? recentRootsPerSecond : rootsPerSecond;
    const estimatedRemainingSeconds = estimateRate > 0 ? Math.round(pendingRoots / estimateRate) : null;
    writeJsonAtomic(statusPath, {
      status,
      runId: path.basename(outDir),
      kind: "tripolicy-crib-discard-synthetic",
      outDir: path.relative(root, outDir),
      checkpointDir: path.relative(root, checkpointDir),
      outputPath: path.relative(root, outputPath),
      workers: Math.min(workerCount, Math.max(1, roots.length)),
      oldMb,
      memoLimit,
      totalRoots: roots.length,
      completedRoots,
      pendingRoots,
      progressPercent: roots.length ? round((completedRoots / roots.length) * 100, 3) : 100,
      rootsPerSecond: round(rootsPerSecond, 4),
      recentRootsPerSecond: round(recentRootsPerSecond, 4),
      estimatedRemainingSeconds,
      expectedCompletionAt: estimatedRemainingSeconds === null ? null : new Date(Date.now() + estimatedRemainingSeconds * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };
  const stop = () => {
    stopping = true;
    writeStatus("stopping");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  writeStatus();
  const interval = setInterval(() => writeStatus(stopping ? "stopping" : "running"), 10000);
  const pending = roots.filter((job) => !fs.existsSync(checkpointPath(checkpointDir, job.id)));
  const workers = Math.max(1, Math.min(workerCount, pending.length || 1));
  const chunks = makeBalancedChunks(pending, workers);

  try {
    await Promise.all(chunks.map((chunk, workerIndex) => runChunk({ chunk, checkpointDir, oldMb, memoLimit, workerIndex })));
  } finally {
    clearInterval(interval);
  }

  const completedRoots = countCompleted(roots, checkpointDir);
  if (stopping || completedRoots < roots.length) {
    writeStatus("stopped");
    console.log(JSON.stringify({
      status: "stopped",
      completedRoots,
      totalRoots: roots.length,
      statusPath: path.relative(root, statusPath),
    }, null, 2));
    return;
  }

  writeStatus("assembling");
  const summary = assemble({ roots, checkpointDir, outputPath, startedAt, workerCount, oldMb, memoLimit });
  writeStatus("complete");
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--out-dir") args.outDir = next();
    else if (arg === "--output") args.output = next();
    else if (arg === "--workers") args.workers = next();
    else if (arg === "--old-mb") args.oldMb = next();
    else if (arg === "--memo-limit") args.memoLimit = next();
    else if (arg === "--limit") args.limit = next();
    else if (arg === "--start-root") args.startRoot = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/build-tripolicy-crib-discard-table.cjs [options]

Builds a restartable synthetic crib-discard table. For each perspective role,
own discard rank pair, and cut rank, it enumerates compatible opponent six-card
rank holdings and chooses the opponent discard under three policies:
  ev  = maximize hand EV +/- crib EV
  on  = maximize own directly affected scoring
  off = minimize opponent directly affected scoring

Options:
  --out-dir <path>
  --output <path>
  --workers <n>
  --old-mb <n>
  --memo-limit <n>  Per-worker memo limit for discard-choice and EV caches
  --limit <n>       Build only N roots, for calibration
  --start-root <n>  Start at root index, for calibration
`);
}

function buildRoots({ startRoot, limit }) {
  const pairs = generateRankSets(2);
  const roots = [];
  let id = 0;
  for (const role of ROLES) {
    for (const discard of pairs) {
      for (let cut = 0; cut < 13; cut += 1) {
        const cutCounts = emptyRanks();
        cutCounts[cut] = 1;
        if (isPossible(discard, cutCounts)) {
          roots.push({ id, role, discard, discardKey: ranksKey(discard), cut });
        }
        id += 1;
      }
    }
  }
  return roots.slice(startRoot, limit > 0 ? Math.min(roots.length, startRoot + limit) : roots.length);
}

function runChunk({ chunk, checkpointDir, oldMb, memoLimit, workerIndex }) {
  return new Promise((resolve, reject) => {
    if (!chunk.length) {
      resolve();
      return;
    }
    const worker = new Worker(__filename, {
      workerData: { chunk, checkpointDir, memoLimit, workerIndex },
      resourceLimits: oldMb > 0 ? { maxOldGenerationSizeMb: oldMb } : {},
    });
    worker.on("message", (message) => {
      if (message?.type === "complete") resolve();
      else if (message?.type === "error") reject(new Error(message.message));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code) reject(new Error(`Worker ${workerIndex} exited with code ${code}`));
    });
  });
}

async function runWorker({ chunk, checkpointDir, memoLimit, workerIndex }) {
  const sixHands = generateRankSets(6);
  const choiceMemo = new LimitedMemo(memoLimit);
  const handEvMemo = new LimitedMemo(memoLimit);
  const cribEvMemo = new LimitedMemo(memoLimit);
  const availabilityMemo = new LimitedMemo(memoLimit);
  const rankScoreMemo = new LimitedMemo(memoLimit);
  for (const job of chunk) {
    const outPath = checkpointPath(checkpointDir, job.id);
    if (fs.existsSync(outPath)) continue;
    const startedAt = Date.now();
    const checkpoint = buildRootCheckpoint({ job, sixHands, choiceMemo, handEvMemo, cribEvMemo, availabilityMemo, rankScoreMemo });
    checkpoint.workerIndex = workerIndex;
    checkpoint.elapsedMs = Date.now() - startedAt;
    checkpoint.memoHighWater = Math.max(choiceMemo.highWater, handEvMemo.highWater, cribEvMemo.highWater, availabilityMemo.highWater, rankScoreMemo.highWater);
    writeJsonAtomic(outPath, checkpoint);
  }
  parentPort.postMessage({ type: "complete" });
}

function buildRootCheckpoint({ job, sixHands, choiceMemo, handEvMemo, cribEvMemo, availabilityMemo, rankScoreMemo }) {
  const cutCounts = emptyRanks();
  cutCounts[job.cut] = 1;
  const policyMaps = Object.fromEntries(POLICIES.map((policy) => [policy, new Map()]));
  const discarderRole = job.role === "dealer" ? "pone" : "dealer";
  let candidateHands = 0;
  let totalRankWeight = 0;

  for (const opponentHand of sixHands) {
    if (!isPossible(job.discard, cutCounts, opponentHand)) continue;
    const handWeight = rankSetWeightWithDeadCards(opponentHand, addCounts(job.discard, cutCounts));
    if (!handWeight) continue;
    candidateHands += 1;
    totalRankWeight += handWeight;
    const choices = chooseDiscardsForHand({
      hand: opponentHand,
      role: discarderRole,
      choiceMemo,
      handEvMemo,
      cribEvMemo,
      availabilityMemo,
      rankScoreMemo,
    });
    for (const policy of POLICIES) {
      const choice = choices[policy];
      const cribRanks = [
        ...rankListFromCounts(job.discard),
        ...rankListFromCounts(choice.discard),
        job.cut,
      ];
      const components = scoreRankComponents(cribRanks);
      addPolicyOutcome(policyMaps[policy], choice.discardKey, handWeight, components);
    }
  }

  return {
    version: 1,
    id: job.id,
    role: job.role,
    discardKey: job.discardKey,
    cut: job.cut,
    candidateHands,
    totalRankWeight,
    policies: Object.fromEntries(POLICIES.map((policy) => [policy, serializePolicyMap(policyMaps[policy])])),
  };
}

function chooseDiscardsForHand({ hand, role, choiceMemo, handEvMemo, cribEvMemo, availabilityMemo, rankScoreMemo }) {
  const key = `${ranksKey(hand)}:${role}`;
  const cached = choiceMemo.get(key);
  if (cached) return cached;
  const candidates = [];
  for (const discard of discardPairsFromHand(hand)) {
    const keep = subtractCounts(hand, discard);
    const handEv = expectedHandScore(keep, hand, handEvMemo, rankScoreMemo);
    const cribEv = expectedCribScoreForDiscard(discard, hand, cribEvMemo, availabilityMemo, rankScoreMemo);
    const netEv = handEv + (role === "dealer" ? cribEv : -cribEv);
    candidates.push({
      discard,
      discardKey: ranksKey(discard),
      handEv,
      cribEv,
      netEv,
    });
  }
  const result = {
    ev: chooseBest(candidates, (entry) => [entry.netEv, entry.handEv, role === "dealer" ? entry.cribEv : -entry.cribEv, -discardTieValue(entry.discard)]),
    on: chooseBest(candidates, (entry) => [entry.handEv + (role === "dealer" ? entry.cribEv : 0), entry.netEv, -discardTieValue(entry.discard)]),
    off: chooseBest(candidates, (entry) => [role === "dealer" ? 0 : -entry.cribEv, entry.netEv, -discardTieValue(entry.discard)]),
  };
  choiceMemo.set(key, result);
  return result;
}

function expectedHandScore(keep, originalSix, memo, rankScoreMemo) {
  const key = `${ranksKey(keep)}:${ranksKey(originalSix)}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  let total = 0;
  let weight = 0;
  for (let cut = 0; cut < 13; cut += 1) {
    const available = 4 - originalSix[cut];
    if (available <= 0) continue;
    total += available * scoreRankOnlyMemo([...rankListFromCounts(keep), cut], rankScoreMemo);
    weight += available;
  }
  const value = weight ? total / weight : 0;
  memo.set(key, value);
  return value;
}

function expectedCribScoreForDiscard(discard, originalSix, memo, availabilityMemo, rankScoreMemo) {
  const key = `${ranksKey(discard)}:${ranksKey(originalSix)}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const available = originalSix.map((count) => 4 - count);
  let total = 0;
  let weight = 0;
  for (const partner of rankSetsFromAvailabilityMemo(2, available, availabilityMemo)) {
    const partnerWeight = rankSetWeight(partner, available);
    if (!partnerWeight) continue;
    const afterPartner = subtractCounts(available, partner);
    for (let cut = 0; cut < 13; cut += 1) {
      const cutWeight = afterPartner[cut];
      if (cutWeight <= 0) continue;
      const cribRanks = [
        ...rankListFromCounts(discard),
        ...rankListFromCounts(partner),
        cut,
      ];
      const combinedWeight = partnerWeight * cutWeight;
      total += combinedWeight * scoreRankOnlyMemo(cribRanks, rankScoreMemo);
      weight += combinedWeight;
    }
  }
  const value = weight ? total / weight : 0;
  memo.set(key, value);
  return value;
}

function chooseBest(entries, utility) {
  let best = null;
  let bestUtility = null;
  for (const entry of entries) {
    const current = utility(entry);
    if (!best || compareTuple(current, bestUtility) > 0) {
      best = entry;
      bestUtility = current;
    }
  }
  return best;
}

function addPolicyOutcome(map, discardKey, weight, components) {
  const current = map.get(discardKey) ?? {
    ranks: discardKey,
    weight: 0,
    rankScoreTotal: 0,
    components: { fifteens: 0, pairs: 0, runs: 0 },
    histogram: new Map(),
  };
  current.weight += weight;
  current.rankScoreTotal += components.total * weight;
  current.components.fifteens += components.fifteens * weight;
  current.components.pairs += components.pairs * weight;
  current.components.runs += components.runs * weight;
  current.histogram.set(components.total, (current.histogram.get(components.total) ?? 0) + weight);
  map.set(discardKey, current);
}

function serializePolicyMap(map) {
  let totalWeight = 0;
  const histogram = new Map();
  const componentTotal = { fifteens: 0, pairs: 0, runs: 0 };
  const opponentDiscards = [...map.values()]
    .sort((a, b) => a.ranks.localeCompare(b.ranks))
    .map((entry) => {
      totalWeight += entry.weight;
      for (const [score, weight] of entry.histogram) histogram.set(score, (histogram.get(score) ?? 0) + weight);
      componentTotal.fifteens += entry.components.fifteens;
      componentTotal.pairs += entry.components.pairs;
      componentTotal.runs += entry.components.runs;
      return {
        ranks: entry.ranks,
        weight: entry.weight,
        rankScore: round(entry.rankScoreTotal / entry.weight, 5),
      };
    });
  return {
    totalWeight,
    average: totalWeight ? round([...histogram.entries()].reduce((sum, [score, weight]) => sum + score * weight, 0) / totalWeight, 5) : null,
    components: totalWeight
      ? [
          round(componentTotal.fifteens / totalWeight, 5),
          round(componentTotal.pairs / totalWeight, 5),
          round(componentTotal.runs / totalWeight, 5),
        ]
      : null,
    histogram: totalWeight
      ? Object.fromEntries([...histogram.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([score, weight]) => [score, round(weight / totalWeight, 8)]))
      : {},
    opponentDiscards,
  };
}

function assemble({ roots, checkpointDir, outputPath, startedAt, workerCount, oldMb, memoLimit }) {
  const table = { dealer: {}, pone: {} };
  for (const role of ROLES) {
    for (const pair of generateRankSets(2)) table[role][ranksKey(pair)] = Array.from({ length: 13 }, () => null);
  }
  let candidateHands = 0;
  let totalRankWeight = 0;
  let memoHighWater = 0;
  for (const job of roots) {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath(checkpointDir, job.id), "utf8"));
    candidateHands += checkpoint.candidateHands;
    totalRankWeight += checkpoint.totalRankWeight;
    memoHighWater = Math.max(memoHighWater, checkpoint.memoHighWater || 0);
    table[checkpoint.role][checkpoint.discardKey][checkpoint.cut] = {
      candidateHands: checkpoint.candidateHands,
      totalRankWeight: checkpoint.totalRankWeight,
      policies: checkpoint.policies,
    };
  }
  const artifact = {
    version: 1,
    generatedAt: new Date().toISOString(),
    kind: "synthetic rank-only crib discard table with EV, player-on, and player-off opponent discard policies",
    note: "Rank-only table excludes flushes and right jack; app can layer suit-sensitive adjustments from policy-specific opponent discard contributors.",
    policySemantics: {
      ev: "opponent discard maximizes rank-only hand EV plus own crib EV or minus opponent crib EV",
      on: "opponent discard maximizes its own directly affected points: hand plus crib if dealer, hand only if pone",
      off: "opponent discard minimizes the other player's directly affected points: opponent crib if pone; dealer has no directly affected opponent score, so EV tie-breaks",
    },
    ranks: RANKS,
    roots: roots.length,
    candidateHands,
    totalRankWeight,
    workerCount,
    oldMb,
    memoLimit,
    memoHighWater,
    histogramSemantics: "Each role/discard/cut/policy entry stores the crib score histogram resulting from compatible opponent six-card rank holdings choosing one discard by that policy.",
    table,
  };
  writeJsonAtomic(outputPath, artifact);
  return {
    status: "complete",
    outputPath: path.relative(root, outputPath),
    roots: roots.length,
    candidateHands,
    totalRankWeight,
    memoHighWater,
    bytes: fs.statSync(outputPath).size,
    elapsedSeconds: round((Date.now() - startedAt) / 1000, 3),
  };
}

function scoreRankOnly(rankList) {
  return scoreRankFifteens(rankList) + scoreRankSets(rankList) + scoreRankRuns(rankList);
}

function scoreRankOnlyMemo(rankList, memo) {
  const key = rankList.slice().sort((a, b) => a - b).join(",");
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const value = scoreRankOnly(rankList);
  memo.set(key, value);
  return value;
}

function scoreRankComponents(rankList) {
  const fifteens = scoreRankFifteens(rankList);
  const pairs = scoreRankSets(rankList);
  const runs = scoreRankRuns(rankList);
  return { fifteens, pairs, runs, total: fifteens + pairs + runs };
}

function scoreRankFifteens(rankList) {
  let points = 0;
  const n = rankList.length;
  for (let mask = 1; mask < (1 << n); mask += 1) {
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) total += VALUES[rankList[i]];
    }
    if (total === 15) points += 2;
  }
  return points;
}

function scoreRankSets(rankList) {
  const counts = emptyRanks();
  for (const rank of rankList) counts[rank] += 1;
  let points = 0;
  for (const count of counts) {
    if (count === 2) points += 2;
    else if (count === 3) points += 6;
    else if (count === 4) points += 12;
  }
  return points;
}

function scoreRankRuns(rankList) {
  const counts = emptyRanks();
  for (const rank of rankList) counts[rank] += 1;
  let best = 0;
  for (let start = 0; start < 13; start += 1) {
    let length = 0;
    let multiplier = 1;
    for (let rank = start; rank < 13 && counts[rank] > 0; rank += 1) {
      length += 1;
      multiplier *= counts[rank];
      if (length >= 3) best = Math.max(best, length * multiplier);
    }
  }
  return best;
}

function discardPairsFromHand(hand) {
  const pairs = [];
  for (let first = 0; first < 13; first += 1) {
    if (!hand[first]) continue;
    hand[first] -= 1;
    for (let second = first; second < 13; second += 1) {
      if (!hand[second]) continue;
      const pair = emptyRanks();
      pair[first] += 1;
      pair[second] += 1;
      pairs.push(pair);
    }
    hand[first] += 1;
  }
  return pairs;
}

function generateRankSets(size) {
  const result = [];
  const counts = emptyRanks();
  function visit(rank, remaining) {
    if (rank === 13) {
      if (remaining === 0) result.push(counts.slice());
      return;
    }
    for (let used = 0; used <= Math.min(4, remaining); used += 1) {
      counts[rank] = used;
      visit(rank + 1, remaining - used);
    }
    counts[rank] = 0;
  }
  visit(0, size);
  return result;
}

function generateRankSetsFromAvailability(size, availability) {
  const result = [];
  const counts = emptyRanks();
  function visit(rank, remaining) {
    if (rank === 13) {
      if (remaining === 0) result.push(counts.slice());
      return;
    }
    for (let used = 0; used <= Math.min(availability[rank], remaining); used += 1) {
      counts[rank] = used;
      visit(rank + 1, remaining - used);
    }
    counts[rank] = 0;
  }
  visit(0, size);
  return result;
}

function rankSetsFromAvailabilityMemo(size, availability, memo) {
  const key = `${size}:${availability.join("")}`;
  const cached = memo.get(key);
  if (cached) return cached;
  const value = generateRankSetsFromAvailability(size, availability);
  memo.set(key, value);
  return value;
}

function emptyRanks() {
  return Array.from({ length: 13 }, () => 0);
}

function ranksKey(counts) {
  return counts.join("");
}

function rankListFromCounts(counts) {
  const list = [];
  counts.forEach((count, rank) => {
    for (let i = 0; i < count; i += 1) list.push(rank);
  });
  return list;
}

function addCounts(a, b) {
  return a.map((count, index) => count + b[index]);
}

function subtractCounts(a, b) {
  return a.map((count, index) => count - b[index]);
}

function isPossible(...rankSets) {
  const total = emptyRanks();
  for (const ranks of rankSets) {
    for (let index = 0; index < 13; index += 1) total[index] += ranks[index];
  }
  return total.every((count) => count <= 4);
}

function rankSetWeight(counts, availability) {
  let weight = 1;
  for (let rank = 0; rank < 13; rank += 1) {
    if (counts[rank] > availability[rank]) return 0;
    weight *= choose(availability[rank], counts[rank]);
  }
  return weight;
}

function rankSetWeightWithDeadCards(counts, deadCards) {
  let weight = 1;
  for (let rank = 0; rank < 13; rank += 1) {
    const available = 4 - deadCards[rank];
    if (counts[rank] > available) return 0;
    weight *= choose(available, counts[rank]);
  }
  return weight;
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

function discardTieValue(discard) {
  return discard.reduce((sum, count, rank) => sum + count * VALUES[rank], 0);
}

function compareTuple(a, b) {
  if (!b) return 1;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function checkpointPath(checkpointDir, id) {
  return path.join(checkpointDir, `${String(id).padStart(4, "0")}.json`);
}

function countCompleted(roots, checkpointDir) {
  let count = 0;
  for (const job of roots) {
    if (fs.existsSync(checkpointPath(checkpointDir, job.id))) count += 1;
  }
  return count;
}

function makeBalancedChunks(items, workers) {
  return Array.from({ length: workers }, (_, worker) =>
    items.filter((_, index) => index % workers === worker));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function dateSlug() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

class LimitedMemo {
  constructor(limit) {
    this.limit = limit;
    this.map = new Map();
    this.highWater = 0;
  }

  get(key) {
    return this.map.get(key);
  }

  set(key, value) {
    if (this.limit > 0 && this.map.size >= this.limit && !this.map.has(key)) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
    this.map.set(key, value);
    if (this.map.size > this.highWater) this.highWater = this.map.size;
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  runWorker(workerData).catch((error) => {
    parentPort.postMessage({ type: "error", message: error.stack || error.message });
  });
}
