#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const modelDir = path.join(root, "web/src/models/schell_table-peg_table-13.0");
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("Usage: node scripts/pack-model13-support-assets.cjs [--dir <model13-dir>]");
  process.exit(0);
}

const outDir = path.resolve(root, args.dir || modelDir);
packLeadTable(outDir);
packHoldTable(outDir);

function packLeadTable(dir) {
  const inputPath = path.join(dir, "pone-lead-frequency.json");
  const outputPath = path.join(dir, "pone-lead-frequency.bin");
  const manifestPath = path.join(dir, "pone-lead-frequency.manifest.json");
  const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const keepKeys = Object.keys(source.table).sort();
  const recordBytes = 18;
  const buffer = Buffer.alloc(16 + (keepKeys.length * recordBytes));
  let offset = 0;
  buffer.write("P13L", offset, "ascii");
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(recordBytes, offset);
  offset += 2;
  buffer.writeUInt32LE(keepKeys.length, offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset);
  offset += 4;
  for (const keepKey of keepKeys) {
    const entry = source.table[keepKey];
    buffer.writeUInt32LE(entry.samples ?? 0, offset);
    offset += 4;
    const order = entry.order ?? [];
    buffer.writeUInt8(Math.min(13, order.length), offset);
    offset += 1;
    for (let index = 0; index < 13; index += 1) {
      const rank = order[index]?.rank;
      buffer.writeUInt8(rank ? source.ranks.indexOf(rank) : 255, offset);
      offset += 1;
    }
  }
  fs.writeFileSync(outputPath, buffer);
  writeJson(manifestPath, {
    version: 1,
    model: "schell_table-peg_table-13.0",
    generatedAt: new Date().toISOString(),
    sourceJsonPath: path.relative(root, inputPath),
    binaryPath: path.basename(outputPath),
    binaryFormat: {
      magic: "P13L",
      header: "magic P13L, version u16, recordBytes u16, entryCount u32, recordsOffset u32",
      record: "samples u32, orderCount u8, rankOrder u8[13] using 255 as empty",
    },
    ranks: source.ranks,
    keepKeys,
    sourceBytes: fs.statSync(inputPath).size,
    packedBytes: fs.statSync(outputPath).size,
  });
  console.log(`Packed ${path.relative(root, inputPath)} -> ${path.relative(root, outputPath)}`);
}

function packHoldTable(dir) {
  const inputPath = path.join(dir, "pegging-remaining-hand-distribution.json");
  const outputPath = path.join(dir, "pegging-remaining-hand-distribution.bin");
  const manifestPath = path.join(dir, "pegging-remaining-hand-distribution.manifest.json");
  const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const handKeys = new Set();
  const prefixKeys = new Set();
  const contexts = [];
  const records = [];
  for (const role of ["dealer", "pone"]) {
    for (const length of ["0", "1", "2", "3"]) {
      const prefixes = source.roles?.[role]?.[length]?.prefixes ?? {};
      for (const [prefixKey, context] of Object.entries(prefixes)) {
        prefixKeys.add(prefixKey);
        const recordOffset = records.length;
        for (const [handKey, weight] of Object.entries(context.remainingHands ?? {})) {
          handKeys.add(handKey);
          records.push({ handKey, weight });
        }
        contexts.push({
          role,
          length: Number.parseInt(length, 10),
          prefixKey,
          samples: context.samples ?? 0,
          recordOffset,
          recordCount: records.length - recordOffset,
        });
      }
    }
  }
  const handKeyList = [...handKeys].sort();
  const prefixKeyList = [...prefixKeys].sort();
  const handIndex = new Map(handKeyList.map((key, index) => [key, index]));
  const prefixIndex = new Map(prefixKeyList.map((key, index) => [key, index]));
  const contextBytes = 16;
  const recordBytes = 6;
  const headerBytes = 32;
  const contextOffset = headerBytes;
  const recordsOffset = contextOffset + (contexts.length * contextBytes);
  const buffer = Buffer.alloc(recordsOffset + (records.length * recordBytes));
  let offset = 0;
  buffer.write("P13H", offset, "ascii");
  offset += 4;
  buffer.writeUInt16LE(1, offset);
  offset += 2;
  buffer.writeUInt16LE(contextBytes, offset);
  offset += 2;
  buffer.writeUInt32LE(contexts.length, offset);
  offset += 4;
  buffer.writeUInt32LE(records.length, offset);
  offset += 4;
  buffer.writeUInt32LE(contextOffset, offset);
  offset += 4;
  buffer.writeUInt32LE(recordsOffset, offset);
  offset += 4;
  buffer.writeUInt16LE(recordBytes, offset);
  offset += 2;
  buffer.writeUInt16LE(0, offset);
  offset += 2;
  buffer.writeUInt32LE(0, offset);
  offset += 4;
  for (const context of contexts) {
    buffer.writeUInt8(context.role === "dealer" ? 0 : 1, offset);
    offset += 1;
    buffer.writeUInt8(context.length, offset);
    offset += 1;
    buffer.writeUInt16LE(prefixIndex.get(context.prefixKey), offset);
    offset += 2;
    buffer.writeUInt32LE(context.samples, offset);
    offset += 4;
    buffer.writeUInt32LE(context.recordOffset, offset);
    offset += 4;
    buffer.writeUInt16LE(context.recordCount, offset);
    offset += 2;
    buffer.writeUInt16LE(0, offset);
    offset += 2;
  }
  for (const record of records) {
    buffer.writeUInt16LE(handIndex.get(record.handKey), offset);
    offset += 2;
    buffer.writeUInt32LE(record.weight, offset);
    offset += 4;
  }
  fs.writeFileSync(outputPath, buffer);
  writeJson(manifestPath, {
    version: 1,
    model: "schell_table-peg_table-13.0",
    generatedAt: new Date().toISOString(),
    sourceJsonPath: path.relative(root, inputPath),
    binaryPath: path.basename(outputPath),
    binaryFormat: {
      magic: "P13H",
      header: "magic P13H, version u16, contextBytes u16, contextCount u32, recordCount u32, contextOffset u32, recordsOffset u32, recordBytes u16, reserved",
      context: "role u8, prefixLength u8, prefixKeyIndex u16, samples u32, recordOffset u32, recordCount u16, reserved u16",
      record: "handKeyIndex u16, weight u32",
    },
    ranks: source.ranks,
    handKeys: handKeyList,
    prefixKeys: prefixKeyList,
    contextCount: contexts.length,
    recordCount: records.length,
    sourceBytes: fs.statSync(inputPath).size,
    packedBytes: fs.statSync(outputPath).size,
  });
  console.log(`Packed ${path.relative(root, inputPath)} -> ${path.relative(root, outputPath)}`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--dir") parsed.dir = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
