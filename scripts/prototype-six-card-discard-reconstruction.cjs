#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const {
  RANKS,
  addCounts,
  discardPairsFromHand,
  generateRankSets,
  isPossible,
  loadPairwiseTable,
  nonNegativeInt,
  pairwisePeggingOptions,
  parseRankLabel,
  parseRanksKey,
  positiveInt,
  rankLabel,
  rankListFromCounts,
  rankSetWeightWithDeadCards,
  ranksKey,
  round,
  scoreRankOnly,
  subtractCounts,
  writeJsonAtomic,
} = require("./lib/six-card-rank-utils.cjs");

const root = path.resolve(__dirname, "..");
const DEFAULT_POLICY_BIN = path.join(root, "web", "src", "models", "rank-crib-discard", "six-card-discard-policy.bin");
const DEFAULT_POLICY_MANIFEST = path.join(root, "web", "src", "models", "rank-crib-discard", "six-card-discard-policy.manifest.json");
const DEFAULT_HAND_SCORE_PATH = path.join(root, "web", "src", "models", "rank-crib-discard", "hand-rank-score-by-keep-cut.json");
const DEFAULT_PAIRWISE_PATH = path.join(root, "web", "src", "models", "schell_table-peg_table-12.0", "pegging-outcome-pairwise.bin");
const DEFAULT_PAIRWISE_MANIFEST = path.join(root, "web", "src", "models", "schell_table-peg_table-12.0", "pegging-outcome-pairwise.manifest.json");
const DEFAULT_OUTPUT = path.join(root, "benchmarks", "discard-frontier", "six-card-reconstruction-prototype", "reconstruction.json");

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const role = args.role || "dealer";
  if (role !== "dealer" && role !== "pone") throw new Error(`Invalid role: ${role}`);
  const hand = readHand(args);
  const handKey = ranksKey(hand);
  if (rankListFromCounts(hand).length !== 6) throw new Error(`Expected a six-card rank hand, got ${rankLabel(hand)}`);

  const outputPath = path.resolve(root, args.output || DEFAULT_OUTPUT);
  const statusPath = path.resolve(root, args.status || outputPath.replace(/\.json$/i, ".status.json"));
  const maxOpponentHands = nonNegativeInt(args.maxOpponentHands, 0);
  const outcomeSampleLimit = nonNegativeInt(args.outcomeSample, 25);
  const writeOutcomes = Boolean(args.writeOutcomes);
  const policy = loadSixCardPolicyTable(
    path.resolve(root, args.policyBin || DEFAULT_POLICY_BIN),
    path.resolve(root, args.policyManifest || DEFAULT_POLICY_MANIFEST),
  );
  const handScoreTable = JSON.parse(fs.readFileSync(path.resolve(root, args.handScores || DEFAULT_HAND_SCORE_PATH), "utf8")).table;
  const pairwise = loadPairwiseTable(
    path.resolve(root, args.pairwisePath || DEFAULT_PAIRWISE_PATH),
    path.resolve(root, args.pairwiseManifest || DEFAULT_PAIRWISE_MANIFEST),
  );
  const sixHands = generateRankSets(6).map((ranks, id) => ({
    id,
    ranks,
    key: ranksKey(ranks),
    label: rankLabel(ranks),
  }));
  const startedAt = Date.now();
  const context = {
    hand,
    handKey,
    role,
    opponentRole: role === "dealer" ? "pone" : "dealer",
    policy,
    pairwise,
    handScoreTable,
    sixHands,
    maxOpponentHands,
    outcomeSampleLimit,
    writeOutcomes,
    statusPath,
    startedAt,
  };
  writeStatus(context, "running", { completedCandidates: 0 });
  const result = reconstructHand(context);
  writeJsonAtomic(outputPath, result);
  writeStatus(context, "complete", {
    completedCandidates: result.candidateCount,
    outputPath: path.relative(root, outputPath),
  });
  console.log(JSON.stringify({
    status: "complete",
    outputPath: path.relative(root, outputPath),
    role,
    handKey,
    handLabel: rankLabel(hand),
    candidateCount: result.candidateCount,
    outcomeRows: result.stats.outcomeRows,
    sampled: result.stats.sampled,
    elapsedSeconds: result.elapsedSeconds,
  }, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--role") args.role = next();
    else if (arg === "--hand-key") args.handKey = next();
    else if (arg === "--hand") args.hand = next();
    else if (arg === "--policy-bin") args.policyBin = next();
    else if (arg === "--policy-manifest") args.policyManifest = next();
    else if (arg === "--hand-scores") args.handScores = next();
    else if (arg === "--pairwise-path") args.pairwisePath = next();
    else if (arg === "--pairwise-manifest") args.pairwiseManifest = next();
    else if (arg === "--max-opponent-hands") args.maxOpponentHands = next();
    else if (arg === "--outcome-sample") args.outcomeSample = next();
    else if (arg === "--write-outcomes") args.writeOutcomes = true;
    else if (arg === "--output") args.output = next();
    else if (arg === "--status") args.status = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/prototype-six-card-discard-reconstruction.cjs [options]

Reconstructs local discard-candidate outcome distributions for one six-card
rank hand from component tables instead of reading a fully joined artifact.

Options:
  --role dealer|pone
  --hand-key <13-digit rank-count key>
  --hand "A 2 3 4 5 6"       Defaults to A 2 3 4 5 6
  --policy-bin <path>         Defaults to rank-crib-discard/six-card-discard-policy.bin
  --policy-manifest <path>
  --hand-scores <path>        Defaults to hand-rank-score-by-keep-cut.json
  --pairwise-path <path>      Defaults to 12.0 pairwise pegging table
  --pairwise-manifest <path>
  --max-opponent-hands <n>    Calibration cap per discard candidate; 0 means all
  --outcome-sample <n>        Stored sample rows per candidate; defaults to 25
  --write-outcomes            Store full reconstructed rows in JSON
  --output <path>
  --status <path>
`);
}

function readHand(args) {
  if (args.handKey) return parseRanksKey(args.handKey);
  return parseRankLabel(args.hand || "A 2 3 4 5 6");
}

function reconstructHand(context) {
  const {
    hand,
    handKey,
    role,
    opponentRole,
    policy,
    pairwise,
    handScoreTable,
    sixHands,
    maxOpponentHands,
    outcomeSampleLimit,
    writeOutcomes,
    statusPath,
    startedAt,
  } = context;
  const pegMemo = new Map();
  const candidates = [];
  const stats = {
    candidateCount: 0,
    opponentHandsConsidered: 0,
    opponentHandWeight: 0,
    policyChoiceRows: 0,
    outcomeRows: 0,
    sampled: false,
  };
  const discardPairs = discardPairsFromHand(hand);
  for (let discardIndex = 0; discardIndex < discardPairs.length; discardIndex += 1) {
    const discard = discardPairs[discardIndex];
    const keep = subtractCounts(hand, discard);
    const ownKeepRanks = rankListFromCounts(keep);
    const ownDiscardRanks = rankListFromCounts(discard);
    const ownKeepKey = ranksKey(keep);
    const outcomeMap = new Map();
    let opponentHandsConsidered = 0;
    let opponentHandWeight = 0;
    let policyChoiceRows = 0;
    let sampled = false;

    for (const opponent of sixHands) {
      if (!isPossible(hand, opponent.ranks)) continue;
      const opponentWeight = rankSetWeightWithDeadCards(opponent.ranks, hand);
      if (!opponentWeight) continue;
      if (maxOpponentHands > 0 && opponentHandsConsidered >= maxOpponentHands) {
        sampled = true;
        break;
      }
      const opponentChoices = policy.choices(opponentRole, opponent.key);
      const opponentChoiceWeightTotal = opponentChoices.reduce((sum, choice) => sum + choice.weight, 0);
      if (!opponentChoiceWeightTotal) continue;
      opponentHandsConsidered += 1;
      opponentHandWeight += opponentWeight;
      policyChoiceRows += opponentChoices.length;

      const cutAvailability = subtractCounts(Array.from({ length: 13 }, () => 4), addCounts(hand, opponent.ranks));
      for (const opponentChoice of opponentChoices) {
        const opponentDiscard = opponentChoice.discard;
        const opponentKeep = subtractCounts(opponent.ranks, opponentDiscard);
        const opponentKeepRanks = rankListFromCounts(opponentKeep);
        const opponentDiscardRanks = rankListFromCounts(opponentDiscard);
        const normalizedChoiceWeight = opponentChoice.weight / opponentChoiceWeightTotal;
        const pegOptions = pairwisePeggingOptions({
          pairwise,
          ownKeep: keep,
          role,
          opponentKeep,
          memo: pegMemo,
        });
        if (!pegOptions.length) continue;
        for (let cut = 0; cut < 13; cut += 1) {
          const cutWeight = cutAvailability[cut];
          if (cutWeight <= 0) continue;
          const baseWeight = opponentWeight * normalizedChoiceWeight * cutWeight;
          const ownHandScore = handScoreForKeepCut(handScoreTable, ownKeepKey, ownKeepRanks, cut);
          const opponentHandScore = handScoreForKeepCut(handScoreTable, ranksKey(opponentKeep), opponentKeepRanks, cut);
          const cribScore = scoreRankOnly([...ownDiscardRanks, ...opponentDiscardRanks, cut]);
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
    }

    const outcomes = serializeJointOutcomes(outcomeMap);
    const candidate = {
      discardKey: ranksKey(discard),
      discardLabel: rankLabel(discard),
      keepKey: ownKeepKey,
      keepLabel: rankLabel(keep),
      opponentHandsConsidered,
      opponentHandWeight,
      policyChoiceRows,
      sampled,
      outcomeRows: outcomes.length,
      totalWeight: outcomes.reduce((sum, row) => sum + row[7], 0),
      leadSummaries: summarizeByLead(outcomes),
      outcomeSample: outcomes.slice(0, outcomeSampleLimit),
    };
    if (writeOutcomes) candidate.outcomes = outcomes;
    candidates.push(candidate);
    stats.candidateCount += 1;
    stats.opponentHandsConsidered += opponentHandsConsidered;
    stats.opponentHandWeight += opponentHandWeight;
    stats.policyChoiceRows += policyChoiceRows;
    stats.outcomeRows += outcomes.length;
    if (sampled) stats.sampled = true;
    writeJsonAtomic(statusPath, {
      status: "running",
      role,
      handKey,
      handLabel: rankLabel(hand),
      completedCandidates: discardIndex + 1,
      totalCandidates: discardPairs.length,
      elapsedSeconds: round((Date.now() - startedAt) / 1000, 3),
      latestCandidate: {
        discardKey: candidate.discardKey,
        outcomeRows: candidate.outcomeRows,
        opponentHandsConsidered,
        sampled,
      },
      updatedAt: new Date().toISOString(),
    });
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    kind: "six-card discard componentized reconstruction prototype",
    semantics: "Rows are reconstructed for one six-card rank hand and role using the compact opponent discard-policy table, hand-rank keep+cut scores, exact rank-only crib scoring, and the pairwise pegging table.",
    currentLimitations: [
      "Rank-only crib scores are computed live; no exact discard-pair + discard-pair + cut crib table is stored yet.",
      "Suit-shape adjustments are not modeled in this prototype output.",
      "For pone rows, leadRank remains a decision dimension rather than a probability distribution over leads.",
    ],
    role,
    opponentRole,
    handKey,
    handLabel: rankLabel(hand),
    maxOpponentHands,
    sampled: stats.sampled,
    candidateCount: candidates.length,
    stats,
    elapsedSeconds: round((Date.now() - startedAt) / 1000, 3),
    candidates,
  };
}

function handScoreForKeepCut(table, keepKey, keepRanks, cut) {
  const tableValue = table?.[keepKey]?.[cut];
  if (tableValue !== null && tableValue !== undefined) return tableValue;
  return scoreRankOnly([...keepRanks, cut]);
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

function summarizeByLead(outcomes) {
  const byLead = new Map();
  for (const row of outcomes) {
    const [cut, leadRank, ownHandScore, opponentHandScore, cribScore, ownPegging, opponentPegging, weight] = row;
    const summary = byLead.get(leadRank) ?? {
      leadRank,
      rowCount: 0,
      totalWeight: 0,
      ownHandTotal: 0,
      opponentHandTotal: 0,
      cribTotal: 0,
      ownPeggingTotal: 0,
      opponentPeggingTotal: 0,
      cutCounts: Array.from({ length: 13 }, () => 0),
    };
    summary.rowCount += 1;
    summary.totalWeight += weight;
    summary.ownHandTotal += ownHandScore * weight;
    summary.opponentHandTotal += opponentHandScore * weight;
    summary.cribTotal += cribScore * weight;
    summary.ownPeggingTotal += ownPegging * weight;
    summary.opponentPeggingTotal += opponentPegging * weight;
    summary.cutCounts[cut] += weight;
    byLead.set(leadRank, summary);
  }
  return [...byLead.values()]
    .sort((a, b) => a.leadRank - b.leadRank)
    .map((summary) => ({
      leadRank: summary.leadRank,
      leadLabel: summary.leadRank >= 0 ? RANKS[summary.leadRank] : null,
      rowCount: summary.rowCount,
      totalWeight: summary.totalWeight,
      averages: {
        ownHandScore: round(summary.ownHandTotal / summary.totalWeight, 5),
        opponentHandScore: round(summary.opponentHandTotal / summary.totalWeight, 5),
        cribScore: round(summary.cribTotal / summary.totalWeight, 5),
        ownPegging: round(summary.ownPeggingTotal / summary.totalWeight, 5),
        opponentPegging: round(summary.opponentPeggingTotal / summary.totalWeight, 5),
      },
    }));
}

function loadSixCardPolicyTable(binPath, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const buffer = fs.readFileSync(binPath);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "D6P1") throw new Error(`Unsupported six-card policy table magic: ${magic}`);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`Unsupported six-card policy table version: ${version}`);
  const recordBytes = view.getUint16(6, true);
  const rootCount = view.getUint32(8, true);
  const recordCount = view.getUint32(12, true);
  const rootOffsetCount = view.getUint32(16, true);
  const rootOffsetsOffset = view.getUint32(20, true);
  const recordsOffset = view.getUint32(24, true);
  const pairCount = view.getUint16(28, true);
  if (recordBytes !== 8) throw new Error(`Unsupported six-card policy record width: ${recordBytes}`);
  if (rootOffsetCount !== rootCount + 1) throw new Error("Invalid six-card policy root offset count");
  if (pairCount !== manifest.pairKeys.length) throw new Error(`Policy pair count mismatch: ${pairCount}`);
  const rootOffsets = new Uint32Array(buffer.buffer, buffer.byteOffset + rootOffsetsOffset, rootOffsetCount);
  const pairRanks = manifest.pairKeys.map(parseRanksKey);
  const rootIndexByKey = new Map();
  if (manifest.rootEntries) {
    manifest.rootEntries.forEach((entry, index) => {
      rootIndexByKey.set(`${entry.role}:${entry.handKey}`, index);
    });
  } else {
    const sixHandKeys = manifest.sixHandKeys ?? generateRankSets(6).map(ranksKey);
    for (let roleIndex = 0; roleIndex < manifest.roles.length; roleIndex += 1) {
      for (let handIndex = 0; handIndex < sixHandKeys.length; handIndex += 1) {
        rootIndexByKey.set(`${manifest.roles[roleIndex]}:${sixHandKeys[handIndex]}`, (roleIndex * sixHandKeys.length) + handIndex);
      }
    }
  }
  return {
    manifest,
    choices(role, handKey) {
      const rootIndex = rootIndexByKey.get(`${role}:${handKey}`);
      if (rootIndex === undefined || rootIndex >= rootCount) return [];
      const start = rootOffsets[rootIndex];
      const end = rootOffsets[rootIndex + 1];
      const choices = [];
      for (let recordIndex = start; recordIndex < end; recordIndex += 1) {
        if (recordIndex >= recordCount) throw new Error(`Six-card policy record index out of range: ${recordIndex}`);
        const offset = recordsOffset + (recordIndex * recordBytes);
        const pairIndex = view.getUint16(offset, true);
        const weight = view.getUint32(offset + 2, true);
        choices.push({
          pairIndex,
          discardKey: manifest.pairKeys[pairIndex],
          discard: pairRanks[pairIndex],
          weight,
        });
      }
      return choices;
    },
  };
}

function writeStatus(context, status, extra) {
  writeJsonAtomic(context.statusPath, {
    status,
    role: context.role,
    handKey: context.handKey,
    handLabel: rankLabel(context.hand),
    maxOpponentHands: context.maxOpponentHands,
    elapsedSeconds: round((Date.now() - context.startedAt) / 1000, 3),
    ...extra,
    updatedAt: new Date().toISOString(),
  });
}

main();
