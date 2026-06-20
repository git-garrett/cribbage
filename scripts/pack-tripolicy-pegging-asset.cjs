#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const RECORD_BITS = 49n;
const MAGIC_IN = "P14P";
const MAGIC_OUT = "P14C";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/pack-tripolicy-pegging-asset.cjs --input <P14P.bin> --output <P14C.bin> [--manifest <json>]

Packs 64-bit P14P tripolicy records into 49-bit P14C records and verifies
sampled and boundary records by unpacking them back to the original fields.
`);
  process.exit(0);
}

const inputPath = path.resolve(root, args.input || "web/src/models/schell_table-peg_table-14.0/pegging-outcome-tripolicy.bin");
const outputPath = path.resolve(root, args.output || inputPath.replace(/\.bin$/i, "-packed.bin"));
const manifestPath = args.manifest
  ? path.resolve(root, args.manifest)
  : outputPath.replace(/\.bin$/i, ".manifest.json");
const sourceManifestPath = args.sourceManifest
  ? path.resolve(root, args.sourceManifest)
  : inputPath.replace(/\.bin$/i, ".manifest.json");

const startedAt = Date.now();
const source = readP14P(inputPath);
const sourceManifest = fs.existsSync(sourceManifestPath)
  ? JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"))
  : {};
const packedDealer = packRecordSection(source.dealerWords, source.dealerRecordCount);
const packedPone = packRecordSection(source.poneWords, source.poneRecordCount);
writeP14C(outputPath, source, packedDealer, packedPone);
const verification = verifyPacked(source, outputPath);
const manifest = {
  version: 1,
  model: "schell_table-peg_table-14.0",
  generatedAt: new Date().toISOString(),
  sourceBinaryPath: path.relative(root, inputPath),
  binaryPath: path.basename(outputPath),
  policy: "compact 49-bit tripolicy pegging table: EV rows reused from 12.0 plus generated player-on and player-off outcomes",
  policyModes: ["ev", "on", "off"],
  binaryFormat: {
    magic: MAGIC_OUT,
    endian: "little",
    header: "magic P14C, version u16, keepCount u16, dealerRecordCount u32, poneRecordCount u32, recordBits u16, reserved u16",
    sections: [
      "dealerOffsets uint32[keepCount + 1]",
      "poneOffsets uint32[keepCount * 13 + 1]",
      "dealerRecords packed 49-bit records",
      "poneRecords packed 49-bit records",
    ],
    recordBits: 49,
    fields: [
      "bits 0-10 opponentKeepId",
      "bits 11-18 weightMinusOne",
      "bits 19-23 evMyPeggingPoints",
      "bits 24-28 evOpponentPeggingPoints",
      "bits 29-33 onMyPeggingPoints",
      "bits 34-38 onOpponentPeggingPoints",
      "bits 39-43 offMyPeggingPoints",
      "bits 44-48 offOpponentPeggingPoints",
    ],
  },
  keepCount: source.keepCount,
  dealerRecordCount: source.dealerRecordCount,
  poneRecordCount: source.poneRecordCount,
  sourceBytes: fs.statSync(inputPath).size,
  packedBytes: fs.statSync(outputPath).size,
  savedBytes: fs.statSync(inputPath).size - fs.statSync(outputPath).size,
  keepKeys: sourceManifest.keepKeys ?? [],
  verification,
  elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
};
writeJsonAtomic(manifestPath, manifest);
console.log(JSON.stringify({
  outputPath: path.relative(root, outputPath),
  manifestPath: path.relative(root, manifestPath),
  sourceBytes: manifest.sourceBytes,
  packedBytes: manifest.packedBytes,
  savedBytes: manifest.savedBytes,
  savedMiB: Number((manifest.savedBytes / 1024 / 1024).toFixed(2)),
  verification,
  elapsedSeconds: manifest.elapsedSeconds,
}, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--input") parsed.input = next();
    else if (arg === "--output") parsed.output = next();
    else if (arg === "--manifest") parsed.manifest = next();
    else if (arg === "--source-manifest") parsed.sourceManifest = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readP14P(filePath) {
  const buffer = fs.readFileSync(filePath);
  const magic = buffer.subarray(0, 4).toString("ascii");
  if (magic !== MAGIC_IN) throw new Error(`Expected ${MAGIC_IN}, found ${magic}`);
  const version = buffer.readUInt16LE(4);
  if (version !== 1) throw new Error(`Unsupported P14P version: ${version}`);
  const keepCount = buffer.readUInt16LE(6);
  const dealerRecordCount = buffer.readUInt32LE(8);
  const poneRecordCount = buffer.readUInt32LE(12);
  let offset = 20;
  const dealerOffsets = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, keepCount + 1);
  offset += (keepCount + 1) * 4;
  const poneOffsets = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, (keepCount * 13) + 1);
  offset += ((keepCount * 13) + 1) * 4;
  const dealerWords = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, dealerRecordCount * 2);
  offset += dealerRecordCount * 2 * 4;
  const poneWords = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, poneRecordCount * 2);
  return {
    keepCount,
    dealerRecordCount,
    poneRecordCount,
    dealerOffsets: new Uint32Array(dealerOffsets),
    poneOffsets: new Uint32Array(poneOffsets),
    dealerWords: new Uint32Array(dealerWords),
    poneWords: new Uint32Array(poneWords),
  };
}

function packRecordSection(words, recordCount) {
  const output = Buffer.alloc(Number((BigInt(recordCount) * RECORD_BITS + 7n) / 8n));
  for (let index = 0; index < recordCount; index += 1) {
    writeBits(output, BigInt(index) * RECORD_BITS, encodeRecord(words[index * 2], words[(index * 2) + 1]), Number(RECORD_BITS));
  }
  return output;
}

function encodeRecord(evWord, policyWord) {
  const opponentKeepId = evWord & 0x7ff;
  const evMy = (evWord >>> 11) & 0x1f;
  const evOpponent = (evWord >>> 16) & 0x1f;
  const weightMinusOne = (evWord >>> 21) & 0xff;
  const onMy = policyWord & 0x1f;
  const onOpponent = (policyWord >>> 5) & 0x1f;
  const offMy = (policyWord >>> 10) & 0x1f;
  const offOpponent = (policyWord >>> 15) & 0x1f;
  return BigInt(opponentKeepId) |
    (BigInt(weightMinusOne) << 11n) |
    (BigInt(evMy) << 19n) |
    (BigInt(evOpponent) << 24n) |
    (BigInt(onMy) << 29n) |
    (BigInt(onOpponent) << 34n) |
    (BigInt(offMy) << 39n) |
    (BigInt(offOpponent) << 44n);
}

function decodeRecord(value) {
  const opponentKeepId = Number(value & 0x7ffn);
  const weightMinusOne = Number((value >> 11n) & 0xffn);
  const evMy = Number((value >> 19n) & 0x1fn);
  const evOpponent = Number((value >> 24n) & 0x1fn);
  const onMy = Number((value >> 29n) & 0x1fn);
  const onOpponent = Number((value >> 34n) & 0x1fn);
  const offMy = Number((value >> 39n) & 0x1fn);
  const offOpponent = Number((value >> 44n) & 0x1fn);
  return {
    evWord: opponentKeepId | (evMy << 11) | (evOpponent << 16) | (weightMinusOne << 21),
    policyWord: onMy | (onOpponent << 5) | (offMy << 10) | (offOpponent << 15),
  };
}

function writeP14C(outputPath, source, packedDealer, packedPone) {
  const headerBytes = 20;
  const dealerOffsetBytes = source.dealerOffsets.length * 4;
  const poneOffsetBytes = source.poneOffsets.length * 4;
  const buffer = Buffer.alloc(headerBytes + dealerOffsetBytes + poneOffsetBytes + packedDealer.length + packedPone.length);
  let offset = 0;
  buffer.write(MAGIC_OUT, offset, "ascii");
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(source.keepCount, offset);
  offset += 2;
  buffer.writeUInt32LE(source.dealerRecordCount, offset);
  offset += 4;
  buffer.writeUInt32LE(source.poneRecordCount, offset);
  offset += 4;
  buffer.writeUInt16LE(Number(RECORD_BITS), offset);
  offset += 2;
  buffer.writeUInt16LE(0, offset);
  offset += 2;
  for (const value of source.dealerOffsets) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  for (const value of source.poneOffsets) {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  }
  packedDealer.copy(buffer, offset);
  offset += packedDealer.length;
  packedPone.copy(buffer, offset);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

function verifyPacked(source, outputPath) {
  const packed = fs.readFileSync(outputPath);
  const magic = packed.subarray(0, 4).toString("ascii");
  if (magic !== MAGIC_OUT) throw new Error(`Expected ${MAGIC_OUT}, found ${magic}`);
  const keepCount = packed.readUInt16LE(6);
  const dealerRecordCount = packed.readUInt32LE(8);
  const poneRecordCount = packed.readUInt32LE(12);
  const recordBits = packed.readUInt16LE(16);
  if (keepCount !== source.keepCount || dealerRecordCount !== source.dealerRecordCount || poneRecordCount !== source.poneRecordCount || recordBits !== Number(RECORD_BITS)) {
    throw new Error("Packed header mismatch");
  }
  let offset = 20;
  offset += (source.keepCount + 1) * 4;
  offset += ((source.keepCount * 13) + 1) * 4;
  const dealerByteOffset = offset;
  const dealerBytes = Number((BigInt(source.dealerRecordCount) * RECORD_BITS + 7n) / 8n);
  const poneByteOffset = dealerByteOffset + dealerBytes;
  const checkedDealer = verifySection(packed, dealerByteOffset, source.dealerWords, source.dealerRecordCount);
  const checkedPone = verifySection(packed, poneByteOffset, source.poneWords, source.poneRecordCount);
  return { checkedDealer, checkedPone };
}

function verifySection(buffer, byteOffset, words, recordCount) {
  const indexes = verificationIndexes(recordCount);
  for (const index of indexes) {
    const decoded = decodeRecord(readBits(buffer, (BigInt(byteOffset) * 8n) + (BigInt(index) * RECORD_BITS), Number(RECORD_BITS)));
    const evWord = words[index * 2];
    const policyWord = words[(index * 2) + 1];
    if (decoded.evWord !== evWord || decoded.policyWord !== policyWord) {
      throw new Error(`Packed verification failed at record ${index}: ${decoded.evWord}/${decoded.policyWord} vs ${evWord}/${policyWord}`);
    }
  }
  return indexes.length;
}

function verificationIndexes(recordCount) {
  const indexes = new Set([0, 1, 2, recordCount - 3, recordCount - 2, recordCount - 1].filter((value) => value >= 0 && value < recordCount));
  let seed = 0x12345678;
  for (let i = 0; i < 2048 && indexes.size < recordCount; i += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    indexes.add(seed % recordCount);
  }
  return [...indexes].sort((a, b) => a - b);
}

function writeBits(buffer, bitOffset, value, bitLength) {
  for (let bit = 0n; bit < BigInt(bitLength); bit += 1n) {
    if (((value >> bit) & 1n) === 0n) continue;
    const absolute = bitOffset + bit;
    const byteIndex = Number(absolute >> 3n);
    const bitIndex = Number(absolute & 7n);
    buffer[byteIndex] |= 1 << bitIndex;
  }
}

function readBits(buffer, bitOffset, bitLength) {
  let value = 0n;
  for (let bit = 0n; bit < BigInt(bitLength); bit += 1n) {
    const absolute = bitOffset + bit;
    const byteIndex = Number(absolute >> 3n);
    const bitIndex = Number(absolute & 7n);
    if (buffer[byteIndex] & (1 << bitIndex)) value |= 1n << bit;
  }
  return value;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}
