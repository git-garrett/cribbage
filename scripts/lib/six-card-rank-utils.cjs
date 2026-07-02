const fs = require("node:fs");
const path = require("node:path");

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
const ROLES = ["dealer", "pone"];

function emptyRanks() {
  return Array.from({ length: 13 }, () => 0);
}

function ranksKey(counts) {
  return counts.join("");
}

function parseRanksKey(key) {
  if (!/^[0-4]{13}$/.test(key)) throw new Error(`Invalid rank key: ${key}`);
  const counts = key.split("").map((digit) => Number.parseInt(digit, 10));
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total > 52) throw new Error(`Invalid rank key card count: ${key}`);
  return counts;
}

function rankLabel(counts) {
  const ranks = [];
  counts.forEach((count, rank) => {
    for (let index = 0; index < count; index += 1) ranks.push(RANKS[rank]);
  });
  return ranks.join(" ");
}

function parseRankLabel(label) {
  const rankByLabel = new Map(RANKS.map((rank, index) => [rank.toUpperCase(), index]));
  rankByLabel.set("T", 9);
  const counts = emptyRanks();
  const tokens = String(label || "").trim().split(/[\s,]+/).filter(Boolean);
  for (const token of tokens) {
    const rank = rankByLabel.get(token.toUpperCase());
    if (rank === undefined) throw new Error(`Unknown rank in hand label: ${token}`);
    counts[rank] += 1;
    if (counts[rank] > 4) throw new Error(`Too many ${RANKS[rank]} ranks in hand label: ${label}`);
  }
  return counts;
}

function rankListFromCounts(counts) {
  const list = [];
  counts.forEach((count, rank) => {
    for (let index = 0; index < count; index += 1) list.push(rank);
  });
  return list;
}

function rankTotal(counts) {
  return counts.reduce((sum, count) => sum + count, 0);
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

function expectedHandScore(keep, originalSix, memo, rankScoreMemo) {
  const key = `${ranksKey(keep)}:${ranksKey(originalSix)}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  let total = 0;
  let weight = 0;
  const keepRanks = rankListFromCounts(keep);
  for (let cut = 0; cut < 13; cut += 1) {
    const available = 4 - originalSix[cut];
    if (available <= 0) continue;
    total += available * scoreRankOnlyMemo([...keepRanks, cut], rankScoreMemo);
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
  const discardRanks = rankListFromCounts(discard);
  let total = 0;
  let weight = 0;
  for (const partner of rankSetsFromAvailabilityMemo(2, available, availabilityMemo)) {
    const partnerWeight = rankSetWeight(partner, available);
    if (!partnerWeight) continue;
    const partnerRanks = rankListFromCounts(partner);
    const afterPartner = subtractCounts(available, partner);
    for (let cut = 0; cut < 13; cut += 1) {
      const cutWeight = afterPartner[cut];
      if (cutWeight <= 0) continue;
      const combinedWeight = partnerWeight * cutWeight;
      total += combinedWeight * scoreRankOnlyMemo([...discardRanks, ...partnerRanks, cut], rankScoreMemo);
      weight += combinedWeight;
    }
  }
  const value = weight ? total / weight : 0;
  memo.set(key, value);
  return value;
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
      discardLabel: rankLabel(discard),
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

function createDiscardMemos(limit) {
  return {
    discard: new LimitedMemo(limit),
    handEv: new LimitedMemo(limit),
    cribEv: new LimitedMemo(limit),
    availability: new LimitedMemo(limit),
    rankScore: new LimitedMemo(limit),
  };
}

function directScoresForDiscard(role, handEv, cribEv) {
  return role === "dealer"
    ? { own: handEv + cribEv, opponent: 0 }
    : { own: handEv, opponent: cribEv };
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

function legalPegRanks(ranks, count) {
  const legal = [];
  for (let rank = 0; rank < 13; rank += 1) {
    if (ranks[rank] > 0 && count + VALUES[rank] <= 31) legal.push(rank);
  }
  return legal;
}

function loadPairwiseTable(binPath, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const buffer = fs.readFileSync(binPath);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "P12P" && magic !== "P13P") throw new Error(`Unsupported pairwise table magic: ${magic}`);
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
    keepRanks: manifest.keepKeys.map(parseRanksKey),
    keepIdByKey: new Map(manifest.keepKeys.map((key, index) => [key, index])),
    dealerOffsets,
    poneOffsets,
    dealerRecords,
    poneRecords,
  };
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

function nonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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

module.exports = {
  RANKS,
  VALUES,
  ROLES,
  LimitedMemo,
  addCounts,
  choose,
  compareTuple,
  createDiscardMemos,
  discardDistributionForHand,
  discardPairsFromHand,
  emptyRanks,
  expectedCribScoreForDiscard,
  expectedHandScore,
  generateRankSets,
  generateRankSetsFromAvailability,
  isPossible,
  legalPegRanks,
  loadPairwiseTable,
  nonNegativeInt,
  pairwisePeggingOptions,
  parseRankLabel,
  parseRanksKey,
  positiveInt,
  rankLabel,
  rankListFromCounts,
  rankSetWeight,
  rankSetWeightWithDeadCards,
  rankTotal,
  ranksKey,
  round,
  scoreRankOnly,
  scoreRankOnlyMemo,
  subtractCounts,
  writeJsonAtomic,
};
