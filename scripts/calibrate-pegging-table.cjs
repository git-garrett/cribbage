const { performance } = require("node:perf_hooks");

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const DEFAULT_SAMPLE_ROWS = 300;
const sampleRows = Number.parseInt(process.argv[2] || String(DEFAULT_SAMPLE_ROWS), 10);
const stride = Number.parseInt(process.argv[3] || "997", 10);
const memoWindowRows = Number.parseInt(process.argv[4] || "25", 10);

if (!Number.isInteger(sampleRows) || sampleRows <= 0) {
  throw new Error("Sample row count must be a positive integer.");
}
if (!Number.isInteger(stride) || stride <= 0) {
  throw new Error("Stride must be a positive integer.");
}
if (!Number.isInteger(memoWindowRows) || memoWindowRows <= 0) {
  throw new Error("Memo window row count must be a positive integer.");
}

let stateMemo = new Map();
const opponentHandMemo = new Map();
const allRows = enumerateTableRows();
const sampledRows = sampleDeterministic(allRows, Math.min(sampleRows, allRows.length), stride);

let weightedEvTotal = 0;
let opponentHandsTotal = 0;
const rowTimes = [];
const startedAt = performance.now();
let maxStateMemoEntries = 0;

for (let index = 0; index < sampledRows.length; index += 1) {
  const rowStarted = performance.now();
  const row = sampledRows[index];
  const result = peggingEvForRow(row);
  rowTimes.push(performance.now() - rowStarted);
  weightedEvTotal += result.ev;
  opponentHandsTotal += result.opponentHands;
  maxStateMemoEntries = Math.max(maxStateMemoEntries, stateMemo.size);

  if ((index + 1) % 25 === 0 || index + 1 === sampledRows.length) {
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    const rowsPerSecond = (index + 1) / elapsedSeconds;
    process.stdout.write(
      `Sampled ${index + 1}/${sampledRows.length} rows ` +
        `(${rowsPerSecond.toFixed(2)} rows/sec, memo ${stateMemo.size})\n`,
    );
  }
  if ((index + 1) % memoWindowRows === 0) {
    stateMemo = new Map();
  }
}

const elapsedSeconds = (performance.now() - startedAt) / 1000;
const rowsPerSecond = sampledRows.length / elapsedSeconds;
const fullRows = allRows.length;
const estimatedSeconds = fullRows / rowsPerSecond;
const sortedTimes = [...rowTimes].sort((a, b) => a - b);

const report = {
  sampleRows: sampledRows.length,
  fullRows,
  elapsedSeconds,
  rowsPerSecond,
  estimatedFullRunSeconds: estimatedSeconds,
  estimatedFullRun: formatDuration(estimatedSeconds),
  meanRowMs: mean(rowTimes),
  p50RowMs: percentile(sortedTimes, 0.5),
  p90RowMs: percentile(sortedTimes, 0.9),
  p99RowMs: percentile(sortedTimes, 0.99),
  averageOpponentRankHands: opponentHandsTotal / sampledRows.length,
  averageSampleEv: weightedEvTotal / sampledRows.length,
  stateMemoEntries: stateMemo.size,
  maxStateMemoEntries,
  opponentHandMemoEntries: opponentHandMemo.size,
  heapUsedMb: process.memoryUsage().heapUsed / 1024 / 1024,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function peggingEvForRow(row) {
  const available = Array.from({ length: 13 }, (_, rank) => 4 - row.hand[rank]);
  const opponentHands = enumerateRankHands(available, 4);
  let total = 0;
  let weight = 0;
  const perspective = row.role === "dealer" ? 1 : 0;
  const current = 0;

  for (const opponent of opponentHands) {
    const hands = row.role === "dealer"
      ? [opponent.ranks, row.keep]
      : [row.keep, opponent.ranks];
    const result = simulatePegging({
      hands,
      plays: [],
      count: 0,
      current,
      goPlayer: -1,
      lastPlayer: -1,
      perspective,
    });
    total += result.total * opponent.weight;
    weight += result.weight * opponent.weight;
  }

  return {
    ev: weight ? total / weight : 0,
    opponentHands: opponentHands.length,
  };
}

function enumerateTableRows() {
  const rows = [];
  const hand = emptyRanks();

  function visitHand(rank, remaining) {
    if (rank === 13) {
      if (remaining === 0) addDiscardRows(hand);
      return;
    }
    const maxUse = Math.min(4, remaining);
    for (let used = 0; used <= maxUse; used += 1) {
      hand[rank] = used;
      visitHand(rank + 1, remaining - used);
    }
    hand[rank] = 0;
  }

  function addDiscardRows(sourceHand) {
    for (let first = 0; first < 13; first += 1) {
      if (sourceHand[first] === 0) continue;
      for (let second = first; second < 13; second += 1) {
        if (sourceHand[second] === 0) continue;
        if (first === second && sourceHand[first] < 2) continue;
        const discard = emptyRanks();
        discard[first] += 1;
        discard[second] += 1;
        const keep = sourceHand.map((count, rank) => count - discard[rank]);
        rows.push({ role: "pone", hand: [...sourceHand], keep, discard });
        rows.push({ role: "dealer", hand: [...sourceHand], keep, discard });
      }
    }
  }

  visitHand(0, 6);
  return rows;
}

function sampleDeterministic(rows, count, step) {
  const sampled = [];
  const seen = new Set();
  let index = 0;
  while (sampled.length < count) {
    if (!seen.has(index)) {
      sampled.push(rows[index]);
      seen.add(index);
    }
    index = (index + step) % rows.length;
  }
  return sampled;
}

function enumerateRankHands(available, size) {
  const key = `${available.join("")}:${size}`;
  const cached = opponentHandMemo.get(key);
  if (cached) return cached;

  const hands = [];
  const ranks = emptyRanks();

  function visit(rank, remaining, weight) {
    if (rank === 13) {
      if (remaining === 0) hands.push({ ranks: [...ranks], weight });
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
  opponentHandMemo.set(key, hands);
  return hands;
}

function simulatePegging(state) {
  const key = stateKey(state);
  const cached = stateMemo.get(key);
  if (cached) return cached;

  const remaining = rankTotal(state.hands[0]) + rankTotal(state.hands[1]);
  if (remaining === 0) {
    const lastPoint = state.lastPlayer !== -1 && state.count !== 0
      ? signedPoints(state.perspective, state.lastPlayer, 1)
      : 0;
    const terminal = { total: lastPoint, weight: 1 };
    stateMemo.set(key, terminal);
    return terminal;
  }

  const legal = legalRanks(state.hands[state.current], state.count);
  if (legal.length === 0) {
    if (state.goPlayer !== -1) {
      const goPoint = state.lastPlayer !== -1 && state.count !== 31
        ? signedPoints(state.perspective, state.lastPlayer, 1)
        : 0;
      const future = simulatePegging({
        ...state,
        plays: [],
        count: 0,
        current: 1 - state.current,
        goPlayer: -1,
        lastPlayer: -1,
      });
      const result = { total: goPoint * future.weight + future.total, weight: future.weight };
      stateMemo.set(key, result);
      return result;
    }
    const result = simulatePegging({
      ...state,
      current: 1 - state.current,
      goPlayer: state.current,
    });
    stateMemo.set(key, result);
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
        });
    const signed = signedPoints(state.perspective, state.current, points);
    total += branchWeight * (signed * future.weight + future.total);
    weight += branchWeight * future.weight;
  }

  const result = { total, weight };
  stateMemo.set(key, result);
  return result;
}

function scoreCountRanks(plays) {
  if (plays.length < 2) return 0;
  let score = 0;
  const count = plays.reduce((total, rank) => total + VALUES[rank], 0);
  if (count === 15 || count === 31) score += 2;

  let sameRankCount = 1;
  for (let i = plays.length - 2; i >= 0; i -= 1) {
    if (plays[i] !== plays[plays.length - 1]) break;
    sameRankCount += 1;
  }
  if (sameRankCount === 2) score += 2;
  else if (sameRankCount === 3) score += 6;
  else if (sameRankCount === 4) score += 12;

  for (let runLen = plays.length; runLen >= 3; runLen -= 1) {
    const vals = plays.slice(-runLen);
    const unique = new Set(vals);
    const sorted = [...vals].sort((a, b) => a - b);
    if (unique.size === runLen && sorted[sorted.length - 1] - sorted[0] + 1 === runLen) {
      score += runLen;
      break;
    }
  }

  return score;
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
    state.perspective,
  ].join("|");
}

function legalRanks(ranks, count) {
  const legal = [];
  for (let rank = 0; rank < 13; rank += 1) {
    if (ranks[rank] > 0 && count + VALUES[rank] <= 31) legal.push(rank);
  }
  return legal;
}

function signedPoints(perspective, scorer, points) {
  return perspective === scorer ? points : -points;
}

function rankTotal(ranks) {
  return ranks.reduce((total, count) => total + count, 0);
}

function emptyRanks() {
  return Array.from({ length: 13 }, () => 0);
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * percentileValue)),
  );
  return sortedValues[index];
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
