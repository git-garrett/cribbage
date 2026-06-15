const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const defaultDbPath = path.join(root, "benchmarks", "ai-db", "cribbage-games.sqlite");
const defaultOutDir = path.join(root, "web", "src", "models", "rank-crib-discard");
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const flushAwareModels = new Set([
  "schell_table-peg_table-7.0",
  "schell_table-peg_table-8.0",
  "schell_table-peg_table-9.0",
  "schell_table-peg_table-10.0",
]);

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(root, args.db || defaultDbPath);
const outDir = path.resolve(root, args.out || defaultOutDir);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db") parsed.db = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--help") {
      process.stdout.write(`Usage: node --experimental-sqlite scripts/build-rank-crib-discard-tables.cjs [--db path] [--out dir]\n`);
      process.exit(0);
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function emptyRanks() {
  return Array.from({ length: 13 }, () => 0);
}

function ranksKey(counts) {
  return counts.join("");
}

function pairCounts(a, b) {
  const counts = emptyRanks();
  counts[a] += 1;
  counts[b] += 1;
  return counts;
}

function ranksFromBlob(blob) {
  return [...Buffer.from(blob)].map((id) => Math.floor(id / 4));
}

function addCounts(a, b) {
  return a.map((count, index) => count + b[index]);
}

function isPossible(...rankSets) {
  const total = emptyRanks();
  for (const ranks of rankSets) {
    for (let i = 0; i < 13; i += 1) total[i] += ranks[i];
  }
  return total.every((count) => count <= 4);
}

function rankSetFromList(list) {
  const counts = emptyRanks();
  for (const rank of list) counts[rank] += 1;
  return counts;
}

function scoreRankOnly(rankList) {
  return scoreRankFifteens(rankList) + scoreRankSets(rankList) + scoreRankRuns(rankList);
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
      if (mask & (1 << i)) total += values[rankList[i]];
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

function rankListFromCounts(counts) {
  const list = [];
  counts.forEach((count, rank) => {
    for (let i = 0; i < count; i += 1) list.push(rank);
  });
  return list;
}

function generateRankSets(size) {
  const result = [];
  const counts = emptyRanks();
  function visit(rank, remaining) {
    if (rank === 13) {
      if (remaining === 0) result.push([...counts]);
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

function loadDiscardFrequencies() {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  const placeholders = [...flushAwareModels].map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT d.role, d.cards
    FROM compact_discards d
    JOIN compact_games g ON g.game_id = d.game_id
    WHERE g.included_in_tables = 1
      AND g.left_engine IN (${placeholders})
      AND g.right_engine IN (${placeholders})
      AND d.cards IS NOT NULL
  `).all(...flushAwareModels, ...flushAwareModels);

  const byRole = {
    pone: {},
    dealer: {},
  };
  const totals = {
    pone: 0,
    dealer: 0,
  };
  for (const row of rows) {
    const role = row.role === 1 ? "dealer" : "pone";
    const counts = rankSetFromList(ranksFromBlob(row.cards));
    const key = ranksKey(counts);
    byRole[role][key] = (byRole[role][key] ?? 0) + 1;
    totals[role] += 1;
  }
  const gameRow = db.prepare(`
    SELECT count(*) AS games
    FROM compact_games
    WHERE included_in_tables = 1
      AND left_engine IN (${placeholders})
      AND right_engine IN (${placeholders})
  `).get(...flushAwareModels, ...flushAwareModels);
  db.close();
  return {
    generatedAt: new Date().toISOString(),
    source: "compact SQLite included games where both engines are flush-aware 7.0+ models",
    sourceGameCount: gameRow.games,
    sourceDiscardCount: rows.length,
    roles: byRole,
    totals,
  };
}

function buildHandRankScores() {
  const table = {};
  for (const keep of generateRankSets(4)) {
    const cuts = Array.from({ length: 13 }, () => null);
    for (let cut = 0; cut < 13; cut += 1) {
      const cutCounts = pairCounts(cut, cut);
      cutCounts[cut] = 1;
      if (!isPossible(keep, cutCounts)) continue;
      cuts[cut] = scoreRankOnly([...rankListFromCounts(keep), cut]);
    }
    table[ranksKey(keep)] = cuts;
  }
  return table;
}

function buildCribRankScores(frequencies) {
  const table = { dealer: {}, pone: {} };
  const components = { dealer: {}, pone: {} };
  const histograms = { dealer: {}, pone: {} };
  const pairs = generateRankSets(2);
  for (const myRole of ["dealer", "pone"]) {
    const opponentRole = myRole === "dealer" ? "pone" : "dealer";
    const opponentFrequencies = Object.entries(frequencies.roles[opponentRole]);
    for (const discard of pairs) {
      const cuts = Array.from({ length: 13 }, () => null);
      const componentCuts = Array.from({ length: 13 }, () => null);
      const histogramCuts = Array.from({ length: 13 }, () => null);
      for (let cut = 0; cut < 13; cut += 1) {
        const cutCounts = emptyRanks();
        cutCounts[cut] = 1;
        if (!isPossible(discard, cutCounts)) continue;
        let total = 0;
        const componentTotal = { fifteens: 0, pairs: 0, runs: 0 };
        const histogram = {};
        const opponentDiscards = [];
        let weight = 0;
        for (const [opponentKey, count] of opponentFrequencies) {
          const opponentDiscard = opponentKey.split("").map((digit) => Number.parseInt(digit, 10));
          if (!isPossible(discard, cutCounts, opponentDiscard)) continue;
          const cribRanks = [
            ...rankListFromCounts(discard),
            ...rankListFromCounts(opponentDiscard),
            cut,
          ];
          const score = scoreRankComponents(cribRanks);
          total += score.total * count;
          componentTotal.fifteens += score.fifteens * count;
          componentTotal.pairs += score.pairs * count;
          componentTotal.runs += score.runs * count;
          histogram[score.total] = (histogram[score.total] ?? 0) + count;
          opponentDiscards.push({
            ranks: opponentKey,
            weight: count,
            rankScore: score.total,
          });
          weight += count;
        }
        cuts[cut] = weight ? Number((total / weight).toFixed(5)) : null;
        componentCuts[cut] = weight
          ? [
              Number((componentTotal.fifteens / weight).toFixed(5)),
              Number((componentTotal.pairs / weight).toFixed(5)),
              Number((componentTotal.runs / weight).toFixed(5)),
            ]
          : null;
        histogramCuts[cut] = weight
          ? {
              totalWeight: weight,
              histogram: Object.fromEntries(Object.entries(histogram)
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([score, scoreWeight]) => [score, Number((scoreWeight / weight).toFixed(8))])),
              opponentDiscards,
            }
          : null;
      }
      table[myRole][ranksKey(discard)] = cuts;
      components[myRole][ranksKey(discard)] = componentCuts;
      histograms[myRole][ranksKey(discard)] = histogramCuts;
    }
  }
  return { table, components, histograms };
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const frequencies = loadDiscardFrequencies();
  const handRankScores = buildHandRankScores();
  const cribRankScores = buildCribRankScores(frequencies);
  const meta = {
    version: 1,
    ranks,
    generatedAt: new Date().toISOString(),
    note: "Rank-only tables exclude flushes and right jack; app layers suit-sensitive adjustments separately.",
    sourceGameCount: frequencies.sourceGameCount,
    sourceDiscardCount: frequencies.sourceDiscardCount,
  };
  fs.writeFileSync(path.join(outDir, "discard-frequency.json"), `${JSON.stringify({ ...meta, ...frequencies })}\n`);
  fs.writeFileSync(path.join(outDir, "hand-rank-score-by-keep-cut.json"), `${JSON.stringify({ ...meta, table: handRankScores })}\n`);
  fs.writeFileSync(path.join(outDir, "crib-rank-score-by-discard-cut.json"), `${JSON.stringify({ ...meta, table: cribRankScores.table })}\n`);
  fs.writeFileSync(path.join(outDir, "crib-rank-components-by-discard-cut.json"), `${JSON.stringify({ ...meta, componentKeys: ["fifteens", "pairs", "runs"], table: cribRankScores.components })}\n`);
  fs.writeFileSync(path.join(outDir, "crib-score-histogram-by-discard-cut.json"), `${JSON.stringify({
    ...meta,
    histogramSemantics: "Each role/discard/cut entry stores a normalized rank-only crib score histogram plus the opponent discard rank contributors and empirical weights used to build it. Runtime code can recompute suit-sensitive crib outcomes from the contributors and currently seen cards.",
    table: cribRankScores.histograms,
  })}\n`);
  process.stdout.write(`Wrote ${path.relative(root, outDir)} from ${frequencies.sourceGameCount} games and ${frequencies.sourceDiscardCount} discards\n`);
}

main();
