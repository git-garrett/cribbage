#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const MAGIC_IN = "P14C";
const MAGIC_OUT = "P14A";
const RECORD_BITS_IN = 49n;
const RECORD_BYTES_OUT = 7;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/align-tripolicy-pegging-asset.cjs --input <P14C.bin> --output <P14A.bin> [--manifest <json>]

Converts compact 49-bit P14C tripolicy pegging records into byte-aligned
7-byte P14A records. The data is larger but avoids BigInt bit walking in
hot runtime loops.
`);
  process.exit(0);
}

const inputPath = path.resolve(root, args.input || "web/src/models/schell_table-peg_table-14.0/pegging-outcome-tripolicy-packed.bin");
const outputPath = path.resolve(root, args.output || "web/src/models/schell_table-peg_table-14.0/pegging-outcome-tripolicy-aligned.bin");
const manifestPath = args.manifest
  ? path.resolve(root, args.manifest)
  : outputPath.replace(/\.bin$/i, ".manifest.json");
const sourceManifestPath = args.sourceManifest
  ? path.resolve(root, args.sourceManifest)
  : inputPath.replace(/\.bin$/i, ".manifest.json");

const startedAt = Date.now();
const source = readP14C(inputPath);
const sourceManifest = fs.existsSync(sourceManifestPath)
  ? JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"))
  : {};
writeP14A(outputPath, source);
const verification = verifyAligned(source, outputPath);
const manifest = {
  version: 1,
  model: "schell_table-peg_table-14.0",
  generatedAt: new Date().toISOString(),
  sourceBinaryPath: path.relative(root, inputPath),
  binaryPath: path.basename(outputPath),
  policy: "byte-aligned 7-byte tripolicy pegging table: same records as P14C with faster runtime decoding",
  policyModes: ["ev", "on", "off"],
  binaryFormat: {
    magic: MAGIC_OUT,
    endian: "little",
    header: "magic P14A, version u16, keepCount u16, dealerRecordCount u32, poneRecordCount u32, recordBytes u16, reserved u16",
    sections: [
      "dealerOffsets uint32[keepCount + 1]",
      "poneOffsets uint32[keepCount * 13 + 1]",
      "dealerRecords 7-byte records",
      "poneRecords 7-byte records",
    ],
    recordBytes: RECORD_BYTES_OUT,
    fields: sourceManifest.binaryFormat?.fields ?? [
      "bits 0-10 opponentKeepId",
      "bits 11-18 weightMinusOne",
      "bits 19-23 evMyPeggingPoints",
      "bits 24-28 evOpponentPeggingPoints",
      "bits 29-33 onMyPeggingPoints",
      "bits 34-38 onOpponentPeggingPoints",
      "bits 39-43 offMyPeggingPoints",
      "bits 44-48 offOpponentPeggingPoints",
      "bits 49-55 unused",
    ],
  },
  keepCount: source.keepCount,
  dealerRecordCount: source.dealerRecordCount,
  poneRecordCount: source.poneRecordCount,
  sourceBytes: fs.statSync(inputPath).size,
  alignedBytes: fs.statSync(outputPath).size,
  addedBytes: fs.statSync(outputPath).size - fs.statSync(inputPath).size,
  keepKeys: sourceManifest.keepKeys ?? [],
  verification,
  elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
};
writeJsonAtomic(manifestPath, manifest);
console.log(JSON.stringify({
  outputPath: path.relative(root, outputPath),
  manifestPath: path.relative(root, manifestPath),
  sourceBytes: manifest.sourceBytes,
  alignedBytes: manifest.alignedBytes,
  addedBytes: manifest.addedBytes,
  addedMiB: Number((manifest.addedBytes / 1024 / 1024).toFixed(2)),
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

function readP14C(filePath) {
  const buffer = fs.readFileSync(filePath);
  const magic = buffer.subarray(0, 4).toString("ascii");
  if (magic !== MAGIC_IN) throw new Error(`Expected ${MAGIC_IN}, found ${magic}`);
  const version = buffer.readUInt16LE(4);
  if (version !== 1) throw new Error(`Unsupported P14C version: ${version}`);
  const keepCount = buffer.readUInt16LE(6);
  const dealerRecordCount = buffer.readUInt32LE(8);
  const poneRecordCount = buffer.readUInt32LE(12);
  const recordBits = buffer.readUInt16LE(16);
  if (recordBits !== Number(RECORD_BITS_IN)) throw new Error(`Unsupported P14C record bits: ${recordBits}`);
  let offset = 20;
  const dealerOffsets = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, keepCount + 1);
  offset += (keepCount + 1) * 4;
  const poneOffsets = new Uint32Array(buffer.buffer, buffer.byteOffset + offset, (keepCount * 13) + 1);
  offset += ((keepCount * 13) + 1) * 4;
  const dealerByteOffset = offset;
  const dealerBytes = Number((BigInt(dealerRecordCount) * RECORD_BITS_IN + 7n) / 8n);
  offset += dealerBytes;
  const poneByteOffset = offset;
  return {
    buffer,
    keepCount,
    dealerRecordCount,
    poneRecordCount,
    dealerOffsets: new Uint32Array(dealerOffsets),
    poneOffsets: new Uint32Array(poneOffsets),
    dealerByteOffset,
    poneByteOffset,
  };
}

function writeP14A(outputPath, source) {
  const headerBytes = 20;
  const dealerOffsetBytes = source.dealerOffsets.length * 4;
  const poneOffsetBytes = source.poneOffsets.length * 4;
  const dealerBytes = source.dealerRecordCount * RECORD_BYTES_OUT;
  const poneBytes = source.poneRecordCount * RECORD_BYTES_OUT;
  const buffer = Buffer.alloc(headerBytes + dealerOffsetBytes + poneOffsetBytes + dealerBytes + poneBytes);
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
  buffer.writeUInt16LE(RECORD_BYTES_OUT, offset);
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
  writeAlignedSection(source.buffer, source.dealerByteOffset, source.dealerRecordCount, buffer, offset);
  offset += dealerBytes;
  writeAlignedSection(source.buffer, source.poneByteOffset, source.poneRecordCount, buffer, offset);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

function writeAlignedSection(sourceBuffer, sourceByteOffset, recordCount, output, outputOffset) {
  for (let index = 0; index < recordCount; index += 1) {
    const value = readBits(sourceBuffer, (BigInt(sourceByteOffset) * 8n) + (BigInt(index) * RECORD_BITS_IN), Number(RECORD_BITS_IN));
    writeSevenByteRecord(output, outputOffset + (index * RECORD_BYTES_OUT), value);
  }
}

function writeSevenByteRecord(buffer, offset, value) {
  for (let byte = 0; byte < RECORD_BYTES_OUT; byte += 1) {
    buffer[offset + byte] = Number((value >> BigInt(byte * 8)) & 0xffn);
  }
}

function verifyAligned(source, outputPath) {
  const output = fs.readFileSync(outputPath);
  const magic = output.subarray(0, 4).toString("ascii");
  if (magic !== MAGIC_OUT) throw new Error(`Expected ${MAGIC_OUT}, found ${magic}`);
  const keepCount = output.readUInt16LE(6);
  const dealerRecordCount = output.readUInt32LE(8);
  const poneRecordCount = output.readUInt32LE(12);
  const recordBytes = output.readUInt16LE(16);
  if (keepCount !== source.keepCount || dealerRecordCount !== source.dealerRecordCount || poneRecordCount !== source.poneRecordCount || recordBytes !== RECORD_BYTES_OUT) {
    throw new Error("Aligned header mismatch");
  }
  let offset = 20;
  offset += (source.keepCount + 1) * 4;
  offset += ((source.keepCount * 13) + 1) * 4;
  const dealerByteOffset = offset;
  const poneByteOffset = dealerByteOffset + (source.dealerRecordCount * RECORD_BYTES_OUT);
  const checkedDealer = verifySection(source.buffer, source.dealerByteOffset, output, dealerByteOffset, source.dealerRecordCount);
  const checkedPone = verifySection(source.buffer, source.poneByteOffset, output, poneByteOffset, source.poneRecordCount);
  return { checkedDealer, checkedPone };
}

function verifySection(sourceBuffer, sourceByteOffset, output, outputByteOffset, recordCount) {
  const indexes = verificationIndexes(recordCount);
  for (const index of indexes) {
    const sourceValue = readBits(sourceBuffer, (BigInt(sourceByteOffset) * 8n) + (BigInt(index) * RECORD_BITS_IN), Number(RECORD_BITS_IN));
    const outputValue = readSevenByteRecord(output, outputByteOffset + (index * RECORD_BYTES_OUT));
    if (sourceValue !== outputValue) {
      throw new Error(`Aligned verification failed at record ${index}: ${outputValue} vs ${sourceValue}`);
    }
  }
  return indexes.length;
}

function readSevenByteRecord(buffer, offset) {
  let value = 0n;
  for (let byte = 0; byte < RECORD_BYTES_OUT; byte += 1) {
    value |= BigInt(buffer[offset + byte]) << BigInt(byte * 8);
  }
  return value;
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
