#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

async function main() {
  const root = path.resolve(__dirname, "..");
  const evidence = require("../artifact-archive/model1323/correction-20260913-v2/verification.json");
  const asset = path.join(root, "rust/cribbage-shadow-engine/assets/model1323-corrections.bin");
  if (!fs.existsSync(asset)) {
    throw new Error("Missing production Ace asset: install the verified model1323-corrections.bin from benchmarks/model1323/correction-20260913-v2/work/merged/ before packaging.");
  }
  if (fs.statSync(asset).size !== evidence.bytes) throw new Error("Production Ace asset size mismatch.");
  const digest = createHash("sha256");
  for await (const block of fs.createReadStream(asset)) digest.update(block);
  if (digest.digest("hex") !== evidence.assetSha256) throw new Error("Production Ace asset SHA-256 mismatch.");
  console.log("Production Ace asset verified: Model 13.23.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
