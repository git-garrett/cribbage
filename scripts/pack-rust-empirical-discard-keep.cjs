#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "web", "src", "models", "rank-crib-discard", "empirical-discard-keep-14.8.json");
const outputPath = path.join(root, "web", "src", "models", "rank-crib-discard", "empirical-discard-keep-14.8.bin");
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const chunks = [];

function pushBuffer(buffer) {
  chunks.push(buffer);
}

function pushU8(value) {
  const buffer = Buffer.allocUnsafe(1);
  buffer.writeUInt8(value);
  pushBuffer(buffer);
}

function pushU16(value) {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value);
  pushBuffer(buffer);
}

function pushU32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value);
  pushBuffer(buffer);
}

function pushF64(value) {
  const buffer = Buffer.allocUnsafe(8);
  buffer.writeDoubleLE(value);
  pushBuffer(buffer);
}

function pushKey(key) {
  if (!/^[0-4]{13}$/.test(key)) throw new Error(`Invalid rank-count key: ${key}`);
  pushBuffer(Buffer.from(key, "ascii"));
}

pushBuffer(Buffer.from("EDK1", "ascii"));
pushU16(1);
pushU16(2);

for (const [roleIndex, roleName] of ["dealer", "pone"].entries()) {
  const role = source.roles[roleName];
  const discards = Object.entries(role.discards);
  const keeps = Object.entries(role.keeps);
  pushU8(roleIndex);
  pushU16(discards.length);
  pushU16(keeps.length);
  pushF64(role.suitedDiscardRate);
  pushF64(role.distinctSuitedDiscardRate);
  for (const [key, entry] of discards) {
    pushKey(key);
    pushU32(entry.count);
    pushF64(entry.suitedRate ?? (entry.count ? (entry.suitedCount ?? 0) / entry.count : 0));
  }
  for (const [key, count] of keeps) {
    pushKey(key);
    pushU32(count);
  }
}

const output = Buffer.concat(chunks);
fs.writeFileSync(outputPath, output);
console.log(`Wrote ${path.relative(root, outputPath)} (${output.length} bytes)`);
