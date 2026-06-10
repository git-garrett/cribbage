#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const archiveRoot = path.join(root, "artifact-archive");
const args = process.argv.slice(2);

function usage(exitCode = 1) {
  const out = exitCode === 0 ? console.log : console.error;
  out("Usage: node scripts/promote-artifact.cjs <source-dir> [--type <name>] [--name <archive-name>] [--include-raw] [--force]");
  out("");
  out("Promotes curated outputs from an ignored benchmark/table run into artifact-archive/.");
  process.exit(exitCode);
}

let sourceArg = "";
let typeArg = "";
let nameArg = "";
let includeRaw = false;
let force = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--help" || arg === "-h") usage(0);
  if (arg === "--include-raw") {
    includeRaw = true;
    continue;
  }
  if (arg === "--force") {
    force = true;
    continue;
  }
  if (arg === "--type") {
    typeArg = args[index + 1] || "";
    index += 1;
    continue;
  }
  if (arg === "--name") {
    nameArg = args[index + 1] || "";
    index += 1;
    continue;
  }
  if (arg.startsWith("--")) usage();
  if (sourceArg) usage();
  sourceArg = arg;
}

if (!sourceArg) usage();

const sourceDir = path.resolve(root, sourceArg);
if (!sourceDir.startsWith(`${root}${path.sep}`)) {
  console.error(`Source must be inside this repository: ${sourceDir}`);
  process.exit(1);
}
if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
  console.error(`Source directory does not exist: ${sourceDir}`);
  process.exit(1);
}

function slugify(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}

function inferType(source) {
  const rel = path.relative(root, source).split(path.sep);
  if (rel[0] === "benchmarks" && rel[1]) return rel[1];
  return "misc";
}

function readStatus(source) {
  const statusPath = path.join(source, "status.json");
  if (!fs.existsSync(statusPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch {
    return null;
  }
}

const status = readStatus(sourceDir);
if (!force && status && status.status && !["complete", "completed", "done", "failed"].includes(String(status.status).toLowerCase())) {
  console.error(`Refusing to promote run with status "${status.status}". Use --force to archive it anyway.`);
  process.exit(1);
}

const artifactType = slugify(typeArg || inferType(sourceDir));
const archiveName = slugify(nameArg || path.basename(sourceDir));
const destinationDir = path.join(archiveRoot, artifactType, archiveName);

if (fs.existsSync(destinationDir) && !force) {
  console.error(`Archive destination already exists: ${destinationDir}`);
  console.error("Use --force to replace it.");
  process.exit(1);
}

function removeDir(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function shouldCopy(relativePath, stats) {
  const base = path.basename(relativePath);
  if (stats.isDirectory()) {
    return includeRaw || !base.endsWith(".batches");
  }
  if (includeRaw) return true;
  if (base === "summary.json" || base === "status.json") return true;
  if (base.endsWith(".summary.json") || base.endsWith(".policy.json")) return true;
  if (relativePath.split(path.sep).length === 1 && base.endsWith(".json")) return true;
  return false;
}

const copiedFiles = [];
const skippedFiles = [];

function copySelected(fromDir, toDir, prefix = "") {
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const fromPath = path.join(fromDir, entry.name);
    const relativePath = path.join(prefix, entry.name);
    const stats = fs.statSync(fromPath);
    if (!shouldCopy(relativePath, stats)) {
      if (stats.isFile()) skippedFiles.push(relativePath);
      continue;
    }
    if (stats.isDirectory()) {
      copySelected(fromPath, path.join(toDir, entry.name), relativePath);
      continue;
    }
    fs.mkdirSync(toDir, { recursive: true });
    const toPath = path.join(toDir, entry.name);
    fs.copyFileSync(fromPath, toPath);
    copiedFiles.push(relativePath);
  }
}

removeDir(destinationDir);
fs.mkdirSync(destinationDir, { recursive: true });
copySelected(sourceDir, destinationDir);

const gitCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
const manifest = {
  version: 1,
  promotedAt: new Date().toISOString(),
  source: path.relative(root, sourceDir),
  destination: path.relative(root, destinationDir),
  type: artifactType,
  name: archiveName,
  includeRaw,
  gitCommit: gitCommit.status === 0 ? gitCommit.stdout.trim() : null,
  copiedFiles: copiedFiles.sort(),
  skippedFileCount: skippedFiles.length,
};

fs.writeFileSync(path.join(destinationDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Promoted ${copiedFiles.length} file(s) to ${path.relative(root, destinationDir)}`);
if (skippedFiles.length > 0) {
  console.log(`Skipped ${skippedFiles.length} raw/log/intermediate file(s). Use --include-raw to copy them.`);
}
