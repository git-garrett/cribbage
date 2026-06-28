import { readFile } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";

const ROOT = process.cwd();
const STATIC_DIR = resolve(process.env.CRIBBAGE_STATIC_DIR || join(ROOT, "dist"));
const PROTECTED_MODEL_ASSET_DIR = resolve(ROOT, "web/src/models");

export function protectedModelAssetPath(assetUrl: string): string | null {
  const assetName = assetUrl.split("/").pop() || "";
  const isProtectedAsset = assetName.endsWith(".bin");
  if (!isProtectedAsset) return null;
  const modelByAsset: Record<string, string> = {
    "pegging-outcome-pairwise.bin": "schell_table-peg_table-12.0",
    "pegging-remaining-hand-distribution.bin": "schell_table-peg_table-13.0",
    "pone-lead-frequency.bin": "schell_table-peg_table-13.0",
    "pegging-outcome-tripolicy-aligned.bin": "schell_table-peg_table-14.0",
    "crib-score-histogram-tripolicy-by-discard-cut.bin": "schell_table-peg_table-14.0",
    "pegging-outcome-bounded-overrides.bin": "schell_table-peg_table-14.4",
    "crib-score-histogram-bounded-tripolicy-by-discard-cut.bin": "schell_table-peg_table-14.4",
    "pegging-outcome-frontier-overrides.bin": "schell_table-peg_table-14.5",
    "crib-score-histogram-frontier-by-discard-cut.bin": "schell_table-peg_table-14.5",
  };
  const sourceName = Object.keys(modelByAsset).find((name) => {
    const prefix = name.slice(0, -".bin".length);
    return assetName === name || assetName.startsWith(`${prefix}-`);
  });
  if (!sourceName) return null;
  const modelDir = modelByAsset[sourceName];
  if (!modelDir) return null;
  const filePath = normalize(join(PROTECTED_MODEL_ASSET_DIR, modelDir, sourceName));
  return filePath.startsWith(PROTECTED_MODEL_ASSET_DIR) ? filePath : null;
}

const nativeFetch = globalThis.fetch.bind(globalThis);
let installed = false;

export function installProtectedAssetFetch(): void {
  if (installed) return;
  installed = true;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const value = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (value.startsWith("/assets/")) {
      const protectedPath = protectedModelAssetPath(value);
      if (protectedPath) {
        const body = await readFile(protectedPath);
        return new Response(body);
      }
      const filePath = normalize(join(STATIC_DIR, value));
      if (!filePath.startsWith(STATIC_DIR)) return new Response("Forbidden", { status: 403 });
      const body = await readFile(filePath);
      return new Response(body);
    }
    return nativeFetch(input, init);
  };
}
