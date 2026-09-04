#!/usr/bin/env node

const baseUrl = (process.argv[2] || "https://cribbage.strongcribbage.com").replace(/\/$/, "");
const retainedClientAssets = [
  { path: "/assets/index-qekK-Boi.js", contentType: "javascript" },
  { path: "/assets/index-Cl_2-xf9.css", contentType: "text/css" },
];

async function main() {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const root = await fetch(`${baseUrl}/`, { redirect: "error" });
  const html = await root.text();
  const rootCache = root.headers.get("cache-control") || "";
  check(root.ok, `root returned ${root.status}`);
  check(/no-store|no-cache/.test(rootCache), `root is cacheable: ${rootCache || "no Cache-Control header"}`);

  const scriptPath = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  check(scriptPath, "root did not reference a JavaScript bundle");
  const script = scriptPath ? await fetch(`${baseUrl}${scriptPath}`, { redirect: "error" }) : null;
  if (script) {
    check(script.ok, `current JavaScript bundle returned ${script.status}`);
    check((script.headers.get("content-type") || "").includes("javascript"), "current JavaScript bundle has the wrong content type");
  }

  const missingPath = `/assets/index-cache-contract-missing-${Date.now()}.js`;
  const missing = await fetch(`${baseUrl}${missingPath}`, { redirect: "error" });
  const missingType = missing.headers.get("content-type") || "";
  check(missing.status === 404, `missing JavaScript bundle returned ${missing.status}`);
  check(!missingType.includes("html"), `missing JavaScript bundle returned HTML (${missingType})`);

  const retainedResults = [];
  for (const asset of retainedClientAssets) {
    const response = await fetch(`${baseUrl}${asset.path}`, { redirect: "error" });
    const contentType = response.headers.get("content-type") || "";
    const prefix = (await response.text()).slice(0, 64);
    retainedResults.push({ path: asset.path, status: response.status, contentType });
    check(response.ok, `retained client asset ${asset.path} returned ${response.status}`);
    check(contentType.includes(asset.contentType), `retained client asset ${asset.path} has the wrong content type (${contentType || "none"})`);
    check(!/^\s*<!doctype html/i.test(prefix), `retained client asset ${asset.path} returned HTML`);
  }

  console.log(JSON.stringify({
    rootStatus: root.status,
    rootCache,
    scriptPath,
    scriptStatus: script?.status ?? null,
    missingStatus: missing.status,
    missingType,
    retainedAssets: retainedResults,
  }));
  if (failures.length) throw new Error(failures.join("; "));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
