#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const root = path.resolve(__dirname, "../dist");
const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

function serveBuild(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  let target = path.resolve(root, requested);
  if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(root, "index.html");
  }
  response.writeHead(200, {
    "content-type": contentTypes[path.extname(target)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(target).pipe(response);
}

async function main() {
  if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error("Missing dist/index.html; run npm run build first.");
  }
  const server = http.createServer(serveBuild);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const user = { username: "qa-player", displayName: "QA Player", email: "qa@example.test" };
    await page.route("**/api/**", async (route) => {
      const apiPath = new URL(route.request().url()).pathname;
      if (apiPath === "/api/auth/session") {
        return route.fulfill({ json: { authenticated: true, user } });
      }
      if (apiPath === "/api/people/me") {
        return route.fulfill({
          json: {
            profile: {
              ...user,
              online: true,
              lookingForGame: false,
              isSelf: true,
              textSize: "normal",
              dynamicCalibration: { started: true, completeCycles: 8, minimumCycles: 6, complete: true },
              dynamicHandicap: { wpPerDecision: -0.0125, cycles: 8, evaluatorVersion: "qa" },
            },
          },
        });
      }
      if (apiPath === "/api/people/presence" || apiPath === "/api/people/online") {
        return route.fulfill({ json: { players: [], incomingChallenges: [], outgoingChallenges: [], onlineCount: 1 } });
      }
      if (apiPath === "/api/game/session/load") {
        return route.fulfill({ json: { session: null } });
      }
      if (apiPath === "/api/game/action") {
        return route.fulfill({ status: 401, json: { error: "Sign in to continue." } });
      }
      return route.fulfill({ status: 404, json: { error: `Unhandled QA route: ${apiPath}` } });
    });

    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await page.locator('[data-pathway-target="play"]').click();
    await page.locator('[data-pathway-destination="dynamic"]').click();
    await page.waitForTimeout(150);

    const state = {
      authVisible: await page.locator("#auth-page").isVisible(),
      gameVisible: await page.locator("main.app").isVisible(),
      serverBusyVisible: await page.locator("#server-busy-alert").isVisible(),
    };
    console.log(JSON.stringify(state));
    if (!state.authVisible || state.gameVisible || state.serverBusyVisible) process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
