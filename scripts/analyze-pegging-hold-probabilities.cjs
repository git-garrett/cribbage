#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const root = path.resolve(__dirname, "..");
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const ROLE_LABELS = ["pone", "dealer"];
const PLAYER_LABELS = ["left", "right"];
const PLAY_ACTION = 0;
const DEFAULT_MODELS = ["schell_table-peg_table-7.0", "schell_table-peg_table-8.0"];

function parseArgs(argv) {
  const args = {
    db: path.join(root, "benchmarks", "ai-db", "cribbage-games.sqlite"),
    out: path.join(root, "benchmarks", "ai-inference", "pegging-hold-rank-probabilities.flush-models.json"),
    status: "",
    workers: Math.max(1, Math.min(6, os.cpus().length - 2 || 1)),
    limit: 0,
    models: DEFAULT_MODELS,
    includeExcluded: false,
    statusSnapshotRows: 50000,
    stabilityMinSamples: 500,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--db") args.db = path.resolve(root, next());
    else if (arg === "--out") args.out = path.resolve(root, next());
    else if (arg === "--status") args.status = path.resolve(root, next());
    else if (arg === "--workers") args.workers = Number.parseInt(next(), 10);
    else if (arg === "--limit") args.limit = Number.parseInt(next(), 10);
    else if (arg === "--models") args.models = next().split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--status-snapshot-rows") args.statusSnapshotRows = Number.parseInt(next(), 10);
    else if (arg === "--stability-min-samples") args.stabilityMinSamples = Number.parseInt(next(), 10);
    else if (arg === "--include-excluded") args.includeExcluded = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node --experimental-sqlite scripts/analyze-pegging-hold-probabilities.cjs [options]

Options:
  --db <path>          SQLite compact game DB
  --out <path>         Output JSON path
  --status <path>      Status JSON path
  --workers <n>        Worker threads for parallel DB scans
  --limit <n>          Sample at most n compact_hands rows, for calibration
  --models <csv>       Included engines; default is 7.0 and 8.0 only
  --status-snapshot-rows <n>
                       Emit convergence snapshots from each worker every n rows
  --stability-min-samples <n>
                       Minimum prefix samples included in stability deltas
  --include-excluded   Include games marked included_in_tables = 0
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.workers) || args.workers < 1) args.workers = 1;
  args.workers = Math.floor(args.workers);
  if (!Number.isFinite(args.limit) || args.limit < 0) args.limit = 0;
  if (!Number.isFinite(args.statusSnapshotRows) || args.statusSnapshotRows < 1) args.statusSnapshotRows = 50000;
  if (!Number.isFinite(args.stabilityMinSamples) || args.stabilityMinSamples < 1) args.stabilityMinSamples = 500;
  return args;
}

function cardRank(byte) {
  return Number.isInteger(byte) && byte >= 0 && byte < 52 ? Math.floor(byte / 4) : null;
}

function rankCounts(blob) {
  const counts = Array(13).fill(0);
  if (!blob) return counts;
  for (const byte of Buffer.from(blob)) {
    const rank = cardRank(byte);
    if (rank !== null) counts[rank] += 1;
  }
  return counts;
}

function playedRanksForPlayer(blob, player) {
  const ranks = [];
  if (!blob) return ranks;
  const bytes = Buffer.from(blob);
  for (let offset = 0; offset + 4 < bytes.length; offset += 5) {
    const action = bytes[offset];
    const playPlayer = bytes[offset + 1];
    const card = bytes[offset + 2];
    if (action !== PLAY_ACTION || playPlayer !== player) continue;
    const rank = cardRank(card);
    if (rank !== null) ranks.push(rank);
    if (ranks.length >= 3) break;
  }
  return ranks;
}

function newPrefixStats() {
  return { samples: 0, present: Array(13).fill(0), counts: Array(13).fill(0) };
}

function newAggregate() {
  return {
    roles: {
      pone: { "1": {}, "2": {}, "3": {} },
      dealer: { "1": {}, "2": {}, "3": {} },
    },
    handsSeen: 0,
    playerHandsSeen: 0,
    playerHandsWithPrefix: { "1": 0, "2": 0, "3": 0 },
  };
}

function prefixKey(ranks) {
  return [...ranks].sort((a, b) => a - b).map((rank) => RANKS[rank]).join(",");
}

function tallyPlayer(aggregate, role, keepBlob, pegSequenceBlob, player) {
  const keepCounts = rankCounts(keepBlob);
  const playedRanks = playedRanksForPlayer(pegSequenceBlob, player);
  aggregate.playerHandsSeen += 1;
  const remaining = [...keepCounts];
  for (let length = 1; length <= Math.min(3, playedRanks.length); length += 1) {
    const rank = playedRanks[length - 1];
    remaining[rank] -= 1;
    if (remaining[rank] < 0) return;
    const key = prefixKey(playedRanks.slice(0, length));
    const bucket = aggregate.roles[role][String(length)];
    bucket[key] ??= newPrefixStats();
    const stats = bucket[key];
    stats.samples += 1;
    aggregate.playerHandsWithPrefix[String(length)] += 1;
    for (let index = 0; index < 13; index += 1) {
      if (remaining[index] > 0) stats.present[index] += 1;
      stats.counts[index] += remaining[index];
    }
  }
}

function mergeStats(target, source) {
  target.samples += source.samples;
  for (let index = 0; index < 13; index += 1) {
    target.present[index] += source.present[index];
    target.counts[index] += source.counts[index];
  }
}

function mergeAggregate(target, source) {
  target.handsSeen += source.handsSeen;
  target.playerHandsSeen += source.playerHandsSeen;
  for (const length of ["1", "2", "3"]) {
    target.playerHandsWithPrefix[length] += source.playerHandsWithPrefix[length];
  }
  for (const role of ROLE_LABELS) {
    for (const length of ["1", "2", "3"]) {
      for (const [key, stats] of Object.entries(source.roles[role][length])) {
        target.roles[role][length][key] ??= newPrefixStats();
        mergeStats(target.roles[role][length][key], stats);
      }
    }
  }
}

function cloneAggregate(source) {
  return JSON.parse(JSON.stringify(source));
}

function stabilityMetrics(previous, current, minSamples) {
  if (!previous || !current) return null;
  let comparedProbabilities = 0;
  let maxDelta = 0;
  let sumDelta = 0;
  let maxDeltaAt = null;
  for (const role of ROLE_LABELS) {
    for (const length of ["1", "2", "3"]) {
      const priorBucket = previous.roles[role][length];
      const currentBucket = current.roles[role][length];
      for (const [key, stats] of Object.entries(currentBucket)) {
        const prior = priorBucket[key];
        if (!prior || stats.samples < minSamples || prior.samples < minSamples) continue;
        for (let rank = 0; rank < 13; rank += 1) {
          const priorProbability = prior.present[rank] / prior.samples;
          const currentProbability = stats.present[rank] / stats.samples;
          const delta = Math.abs(currentProbability - priorProbability);
          comparedProbabilities += 1;
          sumDelta += delta;
          if (delta > maxDelta) {
            maxDelta = delta;
            maxDeltaAt = {
              role,
              prefixLength: Number(length),
              prefix: key,
              rank: RANKS[rank],
              previous: priorProbability,
              current: currentProbability,
              previousSamples: prior.samples,
              currentSamples: stats.samples,
            };
          }
        }
      }
    }
  }
  return {
    minSamples,
    comparedProbabilities,
    maxProbabilityDelta: maxDelta,
    meanProbabilityDelta: comparedProbabilities ? sumDelta / comparedProbabilities : 0,
    maxDeltaAt,
  };
}

function mergeWorkerSnapshots(snapshots) {
  const aggregate = newAggregate();
  for (const snapshot of snapshots.values()) mergeAggregate(aggregate, snapshot);
  return aggregate;
}

function finalizeAggregate(aggregate, metadata) {
  const roles = {};
  for (const role of ROLE_LABELS) {
    roles[role] = {};
    for (const length of ["1", "2", "3"]) {
      const prefixes = {};
      for (const [key, stats] of Object.entries(aggregate.roles[role][length]).sort((a, b) => b[1].samples - a[1].samples || a[0].localeCompare(b[0]))) {
        const probabilityHeld = {};
        const expectedCountHeld = {};
        for (let index = 0; index < 13; index += 1) {
          probabilityHeld[RANKS[index]] = stats.samples ? stats.present[index] / stats.samples : 0;
          expectedCountHeld[RANKS[index]] = stats.samples ? stats.counts[index] / stats.samples : 0;
        }
        prefixes[key] = {
          prefix: key.split(",").filter(Boolean),
          samples: stats.samples,
          probabilityHeld,
          expectedCountHeld,
        };
      }
      roles[role][length] = { prefixLength: Number(length), prefixes };
    }
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    ranks: RANKS,
    prefixSemantics: "unordered rank multiset of the player's first N pegging plays; remaining cards are after those N plays",
    probabilitySemantics: "probabilityHeld is P(player has at least one remaining card of rank R | prefix, role); expectedCountHeld is E(count of remaining rank R | prefix, role)",
    filters: metadata.filters,
    sourceGames: metadata.sourceGames,
    totals: {
      compactHandsSeen: aggregate.handsSeen,
      playerHandsSeen: aggregate.playerHandsSeen,
      playerHandsWithPrefix: aggregate.playerHandsWithPrefix,
    },
    roles,
  };
}

function modelPlaceholders(models) {
  return models.map(() => "?").join(",");
}

function rowBounds(db, args) {
  const where = [
    `g.left_engine IN (${modelPlaceholders(args.models)})`,
    `g.right_engine IN (${modelPlaceholders(args.models)})`,
  ];
  const params = [...args.models, ...args.models];
  if (!args.includeExcluded) where.push("g.included_in_tables = 1");
  const sql = `
    SELECT min(h.rowid) AS minRowid, max(h.rowid) AS maxRowid, count(*) AS rows
    FROM compact_hands h
    JOIN compact_games g ON g.game_id = h.game_id
    WHERE ${where.join(" AND ")}
  `;
  return db.prepare(sql).get(...params);
}

function sourceGameManifest(db, args) {
  const where = [
    `left_engine IN (${modelPlaceholders(args.models)})`,
    `right_engine IN (${modelPlaceholders(args.models)})`,
  ];
  const params = [...args.models, ...args.models];
  if (!args.includeExcluded) where.push("included_in_tables = 1");
  const whereSql = where.join(" AND ");
  const runRows = db.prepare(`
    SELECT run_id, matchup_id, left_engine, right_engine, count(*) AS games,
      min(game_index) AS minGameIndex, max(game_index) AS maxGameIndex
    FROM compact_games
    WHERE ${whereSql}
    GROUP BY run_id, matchup_id, left_engine, right_engine
    ORDER BY run_id, matchup_id
  `).all(...params);
  const gameKeys = db.prepare(`
    SELECT run_id, matchup_id, game_index, game_id
    FROM compact_games
    WHERE ${whereSql}
    ORDER BY run_id, matchup_id, game_index, game_id
  `).all(...params).map((row) => [
    row.run_id,
    row.matchup_id,
    row.game_index,
    row.game_id,
  ]);
  return {
    identity: "run_id, matchup_id, game_index, game_id",
    gameCount: gameKeys.length,
    runs: runRows,
    gameKeys,
  };
}

function scanRows(db, args, minRowid, maxRowid, onProgress) {
  const aggregate = newAggregate();
  const where = [
    `g.left_engine IN (${modelPlaceholders(args.models)})`,
    `g.right_engine IN (${modelPlaceholders(args.models)})`,
    "h.rowid BETWEEN ? AND ?",
  ];
  const params = [...args.models, ...args.models, minRowid, maxRowid];
  if (!args.includeExcluded) where.push("g.included_in_tables = 1");
  const sql = `
    SELECT h.dealer, h.pone, h.left_keep, h.right_keep, h.peg_sequence
    FROM compact_hands h
    JOIN compact_games g ON g.game_id = h.game_id
    WHERE ${where.join(" AND ")}
    ORDER BY h.rowid
  `;
  const rows = db.prepare(sql).all(...params);
  let processed = 0;
  for (const row of rows) {
    aggregate.handsSeen += 1;
    tallyPlayer(aggregate, row.dealer === 0 ? "dealer" : "pone", row.left_keep, row.peg_sequence, 0);
    tallyPlayer(aggregate, row.dealer === 1 ? "dealer" : "pone", row.right_keep, row.peg_sequence, 1);
    processed += 1;
    if (onProgress && processed % 10000 === 0) {
      onProgress(processed, {
        aggregate: processed % args.statusSnapshotRows === 0 ? cloneAggregate(aggregate) : null,
      });
    }
    if (args.limit && processed >= args.limit) break;
  }
  if (onProgress) onProgress(processed, { done: true, aggregate: cloneAggregate(aggregate) });
  return { aggregate, processed };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function expectedCompletionAt(updatedAt, completed, total, startedAtMs) {
  const elapsed = (Date.now() - startedAtMs) / 1000;
  const rate = elapsed > 0 ? completed / elapsed : 0;
  if (rate <= 0) return null;
  return new Date(Date.parse(updatedAt) + ((Math.max(0, total - completed) / rate) * 1000)).toISOString();
}

async function runMain() {
  const { DatabaseSync } = require("node:sqlite");
  const args = parseArgs(process.argv.slice(2));
  const startedAtMs = Date.now();
  const db = new DatabaseSync(args.db, { readOnly: true });
  const bounds = rowBounds(db, args);
  const sourceGames = sourceGameManifest(db, args);
  db.close();
  if (!bounds?.rows) throw new Error("No compact hands matched the selected filters.");

  const totalRows = args.limit ? Math.min(args.limit, bounds.rows) : bounds.rows;
  const span = Math.max(1, bounds.maxRowid - bounds.minRowid + 1);
  const workerCount = Math.max(1, Math.min(args.workers, totalRows));
  const chunks = [];
  for (let index = 0; index < workerCount; index += 1) {
    const start = bounds.minRowid + Math.floor((span * index) / workerCount);
    const end = bounds.minRowid + Math.floor((span * (index + 1)) / workerCount) - 1;
    chunks.push({ minRowid: start, maxRowid: Math.max(start, end) });
  }
  const effectiveChunks = args.limit
    ? chunks.map((chunk) => ({ ...chunk, limit: Math.ceil(args.limit / workerCount) }))
    : chunks;
  const aggregate = newAggregate();
  let completedRows = 0;
  const completedByWorker = new Map();
  const aggregateByWorker = new Map();
  let previousConvergenceAggregate = null;
  let lastConvergence = null;
  const convergenceSnapshots = [];

  const updateConvergence = () => {
    if (!aggregateByWorker.size) return;
    const current = mergeWorkerSnapshots(aggregateByWorker);
    const metrics = stabilityMetrics(previousConvergenceAggregate, current, args.stabilityMinSamples);
    previousConvergenceAggregate = current;
    if (!metrics) return;
    lastConvergence = {
      at: new Date().toISOString(),
      completedRows,
      ...metrics,
    };
    convergenceSnapshots.push(lastConvergence);
    if (convergenceSnapshots.length > 25) convergenceSnapshots.shift();
  };

  const writeStatus = () => {
    if (!args.status) return;
    const updatedAt = new Date().toISOString();
    writeJson(args.status, {
      status: "running",
      updatedAt,
      command: [process.execPath, ...process.argv.slice(1)].join(" "),
      dbPath: args.db,
      outPath: args.out,
      filters: { models: args.models, includeExcluded: args.includeExcluded },
      workers: effectiveChunks.length,
      memoSize: 0,
      memoNote: "No memo cache is used; this is a streaming aggregate over compact hand rows.",
      sourceGameCount: sourceGames.gameCount,
      sourceRuns: sourceGames.runs,
      completedRows,
      totalRows,
      progressPercent: totalRows ? (completedRows / totalRows) * 100 : 100,
      rowsPerSecond: completedRows / Math.max(0.001, (Date.now() - startedAtMs) / 1000),
      expectedCompletionAt: expectedCompletionAt(updatedAt, completedRows, totalRows, startedAtMs),
      convergence: lastConvergence,
      convergenceSnapshots,
    });
  };

  writeStatus();
  const heartbeat = setInterval(writeStatus, 5000);
  const results = await Promise.all(effectiveChunks.map((chunk, workerIndex) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: {
        args: { ...args, limit: chunk.limit || 0 },
        minRowid: chunk.minRowid,
        maxRowid: chunk.maxRowid,
        workerIndex,
      },
    });
    worker.on("message", (message) => {
      if (message.type === "progress") {
        const prior = completedByWorker.get(workerIndex) || 0;
        completedByWorker.set(workerIndex, message.processed);
        completedRows += Math.max(0, message.processed - prior);
        if (message.aggregate) {
          aggregateByWorker.set(workerIndex, message.aggregate);
          updateConvergence();
        }
        writeStatus();
      } else if (message.type === "done") {
        const prior = completedByWorker.get(workerIndex) || 0;
        completedByWorker.set(workerIndex, message.processed);
        completedRows += Math.max(0, message.processed - prior);
        if (message.aggregate) {
          aggregateByWorker.set(workerIndex, message.aggregate);
          updateConvergence();
        }
        writeStatus();
        resolve(message);
      }
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker ${workerIndex} exited with code ${code}`));
    });
  })));
  clearInterval(heartbeat);

  for (const result of results) mergeAggregate(aggregate, result.aggregate);
  completedRows = results.reduce((sum, result) => sum + result.processed, 0);
  const output = finalizeAggregate(aggregate, {
    filters: {
      dbPath: path.relative(root, args.db),
      models: args.models,
      includeExcluded: args.includeExcluded,
      limit: args.limit || null,
      compactHandRowsMatched: bounds.rows,
    },
    sourceGames,
  });
  writeJson(args.out, output);
  if (args.status) {
    writeJson(args.status, {
      status: "complete",
      updatedAt: new Date().toISOString(),
      dbPath: args.db,
      outPath: args.out,
      filters: output.filters,
      workers: effectiveChunks.length,
      memoSize: 0,
      sourceGameCount: sourceGames.gameCount,
      sourceRuns: sourceGames.runs,
      completedRows,
      totalRows,
      progressPercent: 100,
      rowsPerSecond: completedRows / Math.max(0.001, (Date.now() - startedAtMs) / 1000),
      convergence: lastConvergence,
      convergenceSnapshots,
      outputSummary: output.totals,
    });
  }
  console.log(JSON.stringify({
    out: args.out,
    completedRows,
    totalRows,
    workers: effectiveChunks.length,
    totals: output.totals,
  }, null, 2));
}

function runWorker() {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(workerData.args.db, { readOnly: true });
  const result = scanRows(
    db,
    workerData.args,
    workerData.minRowid,
    workerData.maxRowid,
    (processed, detail = {}) => parentPort.postMessage({
      type: "progress",
      processed,
      done: Boolean(detail.done),
      aggregate: detail.aggregate || null,
    }),
  );
  db.close();
  parentPort.postMessage({ type: "done", processed: result.processed, aggregate: result.aggregate });
}

if (isMainThread) {
  runMain().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  runWorker();
}
