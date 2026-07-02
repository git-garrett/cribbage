#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const root = path.resolve(__dirname, "..");
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const ROLES = ["dealer", "pone"];
const DEFAULT_PAIRWISE_PATH = path.join(root, "web", "src", "models", "schell_table-peg_table-12.0", "pegging-outcome-pairwise.bin");
const DEFAULT_PAIRWISE_MANIFEST_PATH = path.join(root, "web", "src", "models", "schell_table-peg_table-12.0", "pegging-outcome-pairwise.manifest.json");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const outDir = path.resolve(root, args.outDir || path.join("benchmarks", "discard-frontier", `six-card-discard-frontier-${dateSlug()}`));
  const outputPath = path.resolve(root, args.output || path.join(outDir, "six-card-discard-frontier.json"));
  const checkpointDir = path.join(outDir, "checkpoints");
  const statusPath = path.join(outDir, "status.json");
  const pairwisePath = path.resolve(root, args.pairwisePath || DEFAULT_PAIRWISE_PATH);
  const pairwiseManifestPath = path.resolve(root, args.pairwiseManifest || DEFAULT_PAIRWISE_MANIFEST_PATH);
  const workerCount = positiveInt(args.workers, Math.max(1, Math.min(os.cpus().length - 2, 6)));
  const oldMb = positiveInt(args.oldMb, 1024);
  const memoLimit = positiveInt(args.memoLimit, 100000);
  const maxOpponentHands = positiveInt(args.maxOpponentHands, 0);
  const partialOpponentInterval = positiveInt(args.partialOpponentInterval, 250);
  const roots = buildRoots({
    startRoot: positiveInt(args.startRoot, 0),
    limit: positiveInt(args.limit, 0),
  });

  fs.mkdirSync(checkpointDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  let stopping = false;
  const startedAt = Date.now();
  let lastCompletedRoots = countCompleted(roots, checkpointDir);
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
      kind: "six-card-discard-frontier",
      outDir: path.relative(root, outDir),
      checkpointDir: path.relative(root, checkpointDir),
      outputPath: path.relative(root, outputPath),
      pairwisePath: path.relative(root, pairwisePath),
      pairwiseManifestPath: path.relative(root, pairwiseManifestPath),
      workers: Math.min(workerCount, Math.max(1, roots.length)),
      oldMb,
      memoLimit,
      maxOpponentHands,
      partialOpponentInterval,
      totalRoots: roots.length,
      completedRoots,
      pendingRoots,
      progressPercent: roots.length ? round((completedRoots / roots.length) * 100, 3) : 100,
      rootsPerSecond: round(rootsPerSecond, 4),
      recentRootsPerSecond: round(recentRootsPerSecond, 4),
      estimatedRemainingSeconds,
      expectedCompletionAt: estimatedRemainingSeconds === null ? null : new Date(Date.now() + estimatedRemainingSeconds * 1000).toISOString(),
      aggregateStats: collectAggregateStats(roots, checkpointDir),
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
    await Promise.all(chunks.map((chunk, workerIndex) => runChunk({
      chunk,
      checkpointDir,
      oldMb,
      memoLimit,
      workerIndex,
      pairwisePath,
      pairwiseManifestPath,
      maxOpponentHands,
      partialOpponentInterval,
    })));
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
      resumeCommand: [
        "node scripts/build-six-card-discard-frontier-table.cjs",
        `--out-dir ${path.relative(root, outDir)}`,
        `--workers ${workerCount}`,
        `--old-mb ${oldMb}`,
        `--memo-limit ${memoLimit}`,
        `--max-opponent-hands ${maxOpponentHands}`,
        `--partial-opponent-interval ${partialOpponentInterval}`,
      ].join(" "),
    }, null, 2));
    return;
  }

  writeStatus("assembling");
  const summary = assemble({
    roots,
    checkpointDir,
    outputPath,
    startedAt,
    workerCount,
      oldMb,
      memoLimit,
      partialOpponentInterval,
    maxOpponentHands,
    pairwisePath,
    pairwiseManifestPath,
  });
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
    else if (arg === "--pairwise-path") args.pairwisePath = next();
    else if (arg === "--pairwise-manifest") args.pairwiseManifest = next();
    else if (arg === "--max-opponent-hands") args.maxOpponentHands = next();
    else if (arg === "--partial-opponent-interval") args.partialOpponentInterval = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/build-six-card-discard-frontier-table.cjs [options]

Builds a restartable six-card discard-decision frontier artifact. Rows are
keyed by six-card rank hand and role. Each row keeps local discard candidates
and joint outcome distributions instead of exposing model-wide frontier labels.

Options:
  --out-dir <path>
  --output <path>
  --workers <n>
  --old-mb <n>
  --memo-limit <n>
  --limit <n>                Build only N roots for calibration
  --start-root <n>           Start root index for calibration
  --pairwise-path <path>     Pairwise pegging binary; defaults to 12.0
  --pairwise-manifest <path> Pairwise pegging manifest; defaults to 12.0
  --max-opponent-hands <n>   Calibration cap per discard candidate; 0 means all
  --partial-opponent-interval <n>
                             Save active-candidate progress every N opponent
                             six-card hands; defaults to 250
`);
}

function buildRoots({ startRoot, limit }) {
  const sixHands = generateRankSets(6);
  const roots = [];
  let id = 0;
  for (const role of ROLES) {
    for (const hand of sixHands) {
      roots.push({
        id,
        role,
        hand,
        handKey: ranksKey(hand),
        handLabel: rankLabel(hand),
      });
      id += 1;
    }
  }
  return roots.slice(startRoot, limit > 0 ? Math.min(roots.length, startRoot + limit) : roots.length);
}

function runChunk({ chunk, checkpointDir, oldMb, memoLimit, workerIndex, pairwisePath, pairwiseManifestPath, maxOpponentHands, partialOpponentInterval }) {
  return new Promise((resolve, reject) => {
    if (!chunk.length) {
      resolve();
      return;
    }
    const worker = new Worker(__filename, {
      workerData: { chunk, checkpointDir, memoLimit, workerIndex, pairwisePath, pairwiseManifestPath, maxOpponentHands, partialOpponentInterval },
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

async function runWorker({ chunk, checkpointDir, memoLimit, workerIndex, pairwisePath, pairwiseManifestPath, maxOpponentHands, partialOpponentInterval }) {
  const sixHands = generateRankSets(6).map((hand, id) => ({
    id,
    hand,
    key: ranksKey(hand),
  }));
  const pairwise = loadPairwiseTable(pairwisePath, pairwiseManifestPath);
  const memos = {
    discard: new LimitedMemo(memoLimit),
    handEv: new LimitedMemo(memoLimit),
    cribEv: new LimitedMemo(memoLimit),
    availability: new LimitedMemo(memoLimit),
    rankScore: new LimitedMemo(memoLimit),
    peg: new LimitedMemo(memoLimit),
  };

  for (const job of chunk) {
    const outPath = checkpointPath(checkpointDir, job.id);
    if (fs.existsSync(outPath)) continue;
    const partialPath = partialCheckpointPath(checkpointDir, job.id);
    const startedAt = Date.now();
    const checkpoint = buildRootCheckpoint({
      job,
      sixHands,
      pairwise,
      memos,
      maxOpponentHands,
      partialPath,
      partialOpponentInterval,
    });
    checkpoint.workerIndex = workerIndex;
    checkpoint.elapsedMs = Date.now() - startedAt;
    checkpoint.memoHighWater = Math.max(...Object.values(memos).map((memo) => memo.highWater));
    writeJsonAtomic(outPath, checkpoint);
    if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
  }
  parentPort.postMessage({ type: "complete" });
}

function buildRootCheckpoint({ job, sixHands, pairwise, memos, maxOpponentHands, partialPath, partialOpponentInterval }) {
  const opponentRole = job.role === "dealer" ? "pone" : "dealer";
  const partial = readPartialCheckpoint(partialPath, job);
  const candidates = partial?.candidates ?? [];
  const stats = partial?.stats ?? {
    candidateCount: 0,
    opponentHandsConsidered: 0,
    opponentHandWeight: 0,
    outcomeRows: 0,
    sampled: false,
  };
  const discardPairs = discardPairsFromHand(job.hand);

  for (let discardIndex = partial?.nextDiscardIndex ?? 0; discardIndex < discardPairs.length; discardIndex += 1) {
    const discard = discardPairs[discardIndex];
    const keep = subtractCounts(job.hand, discard);
    const active = partial?.activeCandidate?.discardIndex === discardIndex ? partial.activeCandidate : null;
    const outcomeMap = active ? jointOutcomesToMap(active.outcomes) : new Map();
    let opponentHandsForCandidate = active?.opponentHandsConsidered ?? 0;
    let opponentWeightForCandidate = active?.opponentHandWeight ?? 0;
    let sampled = active?.sampled ?? false;

    for (let opponentIndex = active?.nextOpponentIndex ?? 0; opponentIndex < sixHands.length; opponentIndex += 1) {
      const opponent = sixHands[opponentIndex];
      if (!isPossible(job.hand, opponent.hand)) continue;
      const opponentHandWeight = rankSetWeightWithDeadCards(opponent.hand, job.hand);
      if (!opponentHandWeight) continue;
      if (maxOpponentHands > 0 && opponentHandsForCandidate >= maxOpponentHands) {
        sampled = true;
        break;
      }
      opponentHandsForCandidate += 1;
      opponentWeightForCandidate += opponentHandWeight;

      const opponentChoices = discardDistributionForHand({
        hand: opponent.hand,
        role: opponentRole,
        memos,
      });
      const cutAvailability = subtractCounts(Array.from({ length: 13 }, () => 4), addCounts(job.hand, opponent.hand));
      for (const opponentChoice of opponentChoices) {
        const opponentKeep = subtractCounts(opponent.hand, opponentChoice.discard);
        const ownKeepRanks = rankListFromCounts(keep);
        const ownDiscardRanks = rankListFromCounts(discard);
        const opponentKeepRanks = rankListFromCounts(opponentKeep);
        const opponentDiscardRanks = rankListFromCounts(opponentChoice.discard);
        const pegOptions = pairwisePeggingOptions({
          pairwise,
          ownKeep: keep,
          role: job.role,
          opponentKeep,
          memo: memos.peg,
        });
        if (!pegOptions.length) continue;
        for (let cut = 0; cut < 13; cut += 1) {
          const cutWeight = cutAvailability[cut];
          if (cutWeight <= 0) continue;
          const baseWeight = opponentHandWeight * opponentChoice.weight * cutWeight;
          const ownHandScore = scoreRankOnlyMemo([...ownKeepRanks, cut], memos.rankScore);
          const opponentHandScore = scoreRankOnlyMemo([...opponentKeepRanks, cut], memos.rankScore);
          const cribScore = scoreRankOnlyMemo([
            ...ownDiscardRanks,
            ...opponentDiscardRanks,
            cut,
          ], memos.rankScore);
          for (const peg of pegOptions) {
            addJointOutcome(outcomeMap, {
              cut,
              leadRank: peg.leadRank,
              ownHandScore,
              opponentHandScore,
              cribScore,
              ownPegging: peg.ownPegging,
              opponentPegging: peg.opponentPegging,
              weight: baseWeight,
            });
          }
        }
      }
      if (partialOpponentInterval > 0 && opponentHandsForCandidate % partialOpponentInterval === 0) {
        writeJsonAtomic(partialPath, {
          version: 1,
          partial: true,
          id: job.id,
          role: job.role,
          handKey: job.handKey,
          handLabel: job.handLabel,
          nextDiscardIndex: discardIndex,
          totalDiscardCandidates: discardPairs.length,
          candidates,
          stats,
          activeCandidate: {
            discardIndex,
            discardKey: ranksKey(discard),
            discardLabel: rankLabel(discard),
            keepKey: ranksKey(keep),
            keepLabel: rankLabel(keep),
            nextOpponentIndex: opponentIndex + 1,
            opponentHandsConsidered: opponentHandsForCandidate,
            opponentHandWeight: opponentWeightForCandidate,
            sampled,
            outcomes: serializeJointOutcomes(outcomeMap),
          },
          updatedAt: new Date().toISOString(),
        });
      }
    }

    const outcomes = serializeJointOutcomes(outcomeMap);
    const candidate = {
      discardKey: ranksKey(discard),
      discardLabel: rankLabel(discard),
      keepKey: ranksKey(keep),
      keepLabel: rankLabel(keep),
      opponentHandsConsidered: opponentHandsForCandidate,
      opponentHandWeight: opponentWeightForCandidate,
      sampled,
      outcomes,
    };
    candidates.push(candidate);
    stats.candidateCount += 1;
    stats.opponentHandsConsidered += opponentHandsForCandidate;
    stats.opponentHandWeight += opponentWeightForCandidate;
    stats.outcomeRows += outcomes.length;
    if (sampled) stats.sampled = true;
    writeJsonAtomic(partialPath, {
      version: 1,
      partial: true,
      id: job.id,
      role: job.role,
      handKey: job.handKey,
      handLabel: job.handLabel,
      nextDiscardIndex: discardIndex + 1,
      totalDiscardCandidates: discardPairs.length,
      candidates,
      stats,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    version: 1,
    id: job.id,
    role: job.role,
    handKey: job.handKey,
    handLabel: job.handLabel,
    totalDiscardCandidates: discardPairs.length,
    candidates,
    stats,
  };
}

function readPartialCheckpoint(partialPath, job) {
  if (!fs.existsSync(partialPath)) return null;
  try {
    const partial = JSON.parse(fs.readFileSync(partialPath, "utf8"));
    if (partial.id !== job.id || partial.role !== job.role || partial.handKey !== job.handKey) return null;
    return partial;
  } catch {
    return null;
  }
}

function discardDistributionForHand({ hand, role, memos }) {
  const key = `${ranksKey(hand)}:${role}`;
  const cached = memos.discard.get(key);
  if (cached) return cached;
  const candidates = [];
  for (const discard of discardPairsFromHand(hand)) {
    const keep = subtractCounts(hand, discard);
    const handEv = expectedHandScore(keep, hand, memos.handEv, memos.rankScore);
    const cribEv = expectedCribScoreForDiscard(discard, hand, memos.cribEv, memos.availability, memos.rankScore);
    const netEv = handEv + (role === "dealer" ? cribEv : -cribEv);
    candidates.push({
      discard,
      discardKey: ranksKey(discard),
      handEv,
      cribEv,
      netEv,
      direct: directScoresForDiscard(role, handEv, cribEv),
    });
  }
  const best = chooseBest(candidates, (entry) => [
    entry.netEv,
    entry.direct.own,
    -entry.direct.opponent,
    -discardTieValue(entry.discard),
  ]);
  const result = best ? [{ ...best, weight: 1 }] : [];
  memos.discard.set(key, result);
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

function directScoresForDiscard(role, handEv, cribEv) {
  return role === "dealer"
    ? { own: handEv + cribEv, opponent: 0 }
    : { own: handEv, opponent: cribEv };
}

function addJointOutcome(map, outcome) {
  const key = [
    outcome.cut,
    outcome.leadRank ?? -1,
    outcome.ownHandScore,
    outcome.opponentHandScore,
    outcome.cribScore,
    outcome.ownPegging,
    outcome.opponentPegging,
  ].join(",");
  map.set(key, (map.get(key) || 0) + outcome.weight);
}

function serializeJointOutcomes(map) {
  return [...map.entries()]
    .map(([key, weight]) => key.split(",").map((value) => Number.parseInt(value, 10)).concat(weight))
    .sort((a, b) => {
      for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
      }
      return 0;
    });
}

function jointOutcomesToMap(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    const key = row.slice(0, 7).join(",");
    map.set(key, row[7] || 0);
  }
  return map;
}

function pairwisePeggingOptions({ pairwise, ownKeep, role, opponentKeep, memo }) {
  const key = `${role}:${ranksKey(ownKeep)}:${ranksKey(opponentKeep)}`;
  const cached = memo.get(key);
  if (cached) return cached;
  const ownKeepId = pairwise.keepIdByKey.get(ranksKey(ownKeep));
  const opponentKeepId = pairwise.keepIdByKey.get(ranksKey(opponentKeep));
  if (ownKeepId === undefined || opponentKeepId === undefined) return [];
  const options = [];
  if (role === "dealer") {
    const record = findPairwiseRecord(
      pairwise.dealerRecords,
      pairwise.dealerOffsets[ownKeepId],
      pairwise.dealerOffsets[ownKeepId + 1],
      opponentKeepId,
    );
    if (record) {
      options.push({
        leadRank: -1,
        ownPegging: record.myPegging,
        opponentPegging: record.opponentPegging,
      });
    }
  } else {
    for (const leadRank of legalPegRanks(ownKeep, 0)) {
      const start = pairwise.poneOffsets[(ownKeepId * 13) + leadRank];
      const end = pairwise.poneOffsets[(ownKeepId * 13) + leadRank + 1];
      const record = findPairwiseRecord(pairwise.poneRecords, start, end, opponentKeepId);
      if (record) {
        options.push({
          leadRank,
          ownPegging: record.myPegging,
          opponentPegging: record.opponentPegging,
        });
      }
    }
  }
  memo.set(key, options);
  return options;
}

function findPairwiseRecord(records, start, end, opponentKeepId) {
  for (let index = start; index < end; index += 1) {
    const record = unpackPairwiseRecord(records[index]);
    if (record.opponentKeepId === opponentKeepId) return record;
    if (record.opponentKeepId > opponentKeepId) break;
  }
  return null;
}

function unpackPairwiseRecord(record) {
  return {
    opponentKeepId: record & 0x7ff,
    myPegging: (record >>> 11) & 0x1f,
    opponentPegging: (record >>> 16) & 0x1f,
    weight: ((record >>> 21) & 0xff) + 1,
  };
}

function legalPegRanks(ranks, count) {
  const legal = [];
  for (let rank = 0; rank < 13; rank += 1) {
    if (ranks[rank] > 0 && count + VALUES[rank] <= 31) legal.push(rank);
  }
  return legal;
}

function assemble({ roots, checkpointDir, outputPath, startedAt, workerCount, oldMb, memoLimit, maxOpponentHands, partialOpponentInterval, pairwisePath, pairwiseManifestPath }) {
  const table = { dealer: {}, pone: {} };
  const stats = emptyAggregateStats();
  let memoHighWater = 0;
  for (const job of roots) {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath(checkpointDir, job.id), "utf8"));
    table[checkpoint.role][checkpoint.handKey] = {
      handLabel: checkpoint.handLabel,
      candidates: checkpoint.candidates,
    };
    mergeAggregateStats(stats, checkpoint.stats);
    memoHighWater = Math.max(memoHighWater, checkpoint.memoHighWater || 0);
  }
  const artifact = {
    version: 1,
    generatedAt: new Date().toISOString(),
    kind: "six-card rank discard frontier decision table",
    note: "Initial artifact format is validation JSON. It is intended to be packed into a compact binary only after sample validation.",
    currentLimitations: [
      "Opponent discard distribution is currently deterministic rank-only board-neutral 13.0-style EV selection; suit-shape aggregation is not yet emitted.",
      "Hand and crib scores are rank-only. Runtime or a later builder pass must add flush and knobs adjustments from actual suits.",
      "Pegging outcomes come from the configured pairwise pegging table; default is the 12.0/13.0 discard-layer table.",
    ],
    opponentDiscardSemantics: "For each possible opponent six-card rank hand, the builder currently chooses one rank-only discard by hand EV plus own crib EV as dealer or hand EV minus opponent crib EV as pone.",
    ranks: RANKS,
    roles: ROLES,
    sourcePairwise: path.relative(root, pairwisePath),
    sourcePairwiseManifest: path.relative(root, pairwiseManifestPath),
    rootCount: roots.length,
    workerCount,
    oldMb,
    memoLimit,
    maxOpponentHands,
    partialOpponentInterval,
    memoHighWater,
    stats,
    rowSemantics: "Each role/hand row stores local discard candidates. Candidate outcomes are joint [cutRank, leadRankOrMinusOne, ownHandScore, opponentHandScore, cribScore, ownPegging, opponentPegging, weight] rows.",
    table,
  };
  writeJsonAtomic(outputPath, artifact);
  return {
    status: "complete",
    outputPath: path.relative(root, outputPath),
    roots: roots.length,
    stats,
    memoHighWater,
    bytes: fs.statSync(outputPath).size,
    elapsedSeconds: round((Date.now() - startedAt) / 1000, 3),
  };
}

function emptyAggregateStats() {
  return {
    candidateCount: 0,
    opponentHandsConsidered: 0,
    opponentHandWeight: 0,
    outcomeRows: 0,
    sampledRoots: 0,
  };
}

function mergeAggregateStats(target, source = {}) {
  target.candidateCount += source.candidateCount || 0;
  target.opponentHandsConsidered += source.opponentHandsConsidered || 0;
  target.opponentHandWeight += source.opponentHandWeight || 0;
  target.outcomeRows += source.outcomeRows || 0;
  if (source.sampled) target.sampledRoots += 1;
  return target;
}

function collectAggregateStats(roots, checkpointDir) {
  const stats = emptyAggregateStats();
  let completedRootsWithStats = 0;
  let partialRootsWithStats = 0;
  let activeCandidates = 0;
  let completedDiscardCandidatesInPartialRoots = 0;
  for (const job of roots) {
    const outPath = checkpointPath(checkpointDir, job.id);
    if (fs.existsSync(outPath)) {
      try {
        const checkpoint = JSON.parse(fs.readFileSync(outPath, "utf8"));
        mergeAggregateStats(stats, checkpoint.stats);
        completedRootsWithStats += 1;
      } catch {
        // Ignore a checkpoint being written between stat and read.
      }
      continue;
    }
    const partialPath = partialCheckpointPath(checkpointDir, job.id);
    if (fs.existsSync(partialPath)) {
      try {
        const partial = JSON.parse(fs.readFileSync(partialPath, "utf8"));
        partialRootsWithStats += 1;
        activeCandidates += partial.activeCandidate ? 1 : 0;
        completedDiscardCandidatesInPartialRoots += partial.nextDiscardIndex || 0;
      } catch {
        // Ignore a partial checkpoint being written between stat and read.
      }
    }
  }
  stats.completedRootsWithStats = completedRootsWithStats;
  stats.partialRootsWithStats = partialRootsWithStats;
  stats.activeCandidates = activeCandidates;
  stats.completedDiscardCandidatesInPartialRoots = completedDiscardCandidatesInPartialRoots;
  return stats;
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

function discardPairsFromHand(hand) {
  const pairs = [];
  const mutable = hand.slice();
  for (let first = 0; first < 13; first += 1) {
    if (!mutable[first]) continue;
    mutable[first] -= 1;
    for (let second = first; second < 13; second += 1) {
      if (!mutable[second]) continue;
      const pair = emptyRanks();
      pair[first] += 1;
      pair[second] += 1;
      pairs.push(pair);
    }
    mutable[first] += 1;
  }
  return pairs;
}

function rankListFromCounts(counts) {
  const list = [];
  counts.forEach((count, rank) => {
    for (let index = 0; index < count; index += 1) list.push(rank);
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
  for (let index = 1; index <= k; index += 1) {
    result = (result * (n - k + index)) / index;
  }
  return result;
}

function emptyRanks() {
  return Array.from({ length: 13 }, () => 0);
}

function ranksKey(counts) {
  return counts.join("");
}

function rankLabel(counts) {
  const ranks = [];
  counts.forEach((count, rank) => {
    for (let index = 0; index < count; index += 1) ranks.push(RANKS[rank]);
  });
  return ranks.join(" ");
}

function loadPairwiseTable(binPath, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const buffer = fs.readFileSync(binPath);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "P12P" && magic !== "P13P") throw new Error(`Unsupported pairwise table magic for this builder: ${magic}`);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`Unsupported pairwise table version: ${version}`);
  const keepCount = view.getUint16(6, true);
  const dealerRecordCount = view.getUint32(8, true);
  const poneRecordCount = view.getUint32(12, true);
  if (keepCount !== manifest.keepKeys.length) {
    throw new Error(`Pairwise keep count mismatch: ${keepCount} vs ${manifest.keepKeys.length}`);
  }
  let offset = 20;
  const dealerOffsets = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, keepCount + 1);
  offset += (keepCount + 1) * 4;
  const poneOffsets = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, (keepCount * 13) + 1);
  offset += ((keepCount * 13) + 1) * 4;
  const dealerRecords = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, dealerRecordCount);
  offset += dealerRecordCount * 4;
  const poneRecords = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, poneRecordCount);
  return {
    keepKeys: manifest.keepKeys,
    keepIdByKey: new Map(manifest.keepKeys.map((key, index) => [key, index])),
    dealerOffsets,
    poneOffsets,
    dealerRecords,
    poneRecords,
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

function scoreRankFifteens(rankList) {
  let points = 0;
  const n = rankList.length;
  for (let mask = 1; mask < (1 << n); mask += 1) {
    let total = 0;
    for (let index = 0; index < n; index += 1) {
      if (mask & (1 << index)) total += VALUES[rankList[index]];
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

function compareTuple(a, b) {
  if (!b) return 1;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function discardTieValue(discard) {
  return discard.reduce((sum, count, rank) => sum + count * VALUES[rank], 0);
}

function checkpointPath(checkpointDir, id) {
  return path.join(checkpointDir, `${String(id).padStart(5, "0")}.json`);
}

function partialCheckpointPath(checkpointDir, id) {
  return path.join(checkpointDir, `${String(id).padStart(5, "0")}.partial.json`);
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
    this.highWater = Math.max(this.highWater, this.map.size);
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
