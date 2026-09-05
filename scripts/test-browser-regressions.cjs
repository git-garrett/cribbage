#!/usr/bin/env node
const fs = require("node:fs");
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

async function installStaticBuild(page) {
  await page.route("https://strong-cribbage.test/**", async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const requested = pathname === "/" ? "index.html" : pathname.slice(1);
    let target = path.resolve(root, requested);
    if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      target = path.join(root, "index.html");
    }
    await route.fulfill({
      path: target,
      contentType: contentTypes[path.extname(target)] || "application/octet-stream",
      headers: { "cache-control": "no-store" },
    });
  });
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function holdAndRelease(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Online tap target has no visible bounds.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await delay(450);
  await page.mouse.up();
}

async function installPeopleFixture(page) {
  const user = { username: "Garrett", displayName: "Garrett", email: "garrett@example.test" };
  const shane = {
    username: "Shane",
    displayName: "Shane",
    avatarDataUrl: null,
    online: true,
    lookingForGame: true,
    dynamicHandicap: { wpPerGame: -0.125, cycles: 4, cyclesPerGame: 3.5, evaluatorVersion: "qa" },
  };
  const ownProfile = {
    ...user,
    avatarDataUrl: null,
    online: true,
    lookingForGame: false,
    isSelf: true,
    dynamicHandicap: { wpPerGame: -0.04, cycles: 2, cyclesPerGame: 3.5, evaluatorVersion: "qa" },
  };
  const table = {
    id: "table-online-tap-regression",
    phase: "waiting",
    viewerSeat: "challenger",
    challenger: ownProfile,
    challenged: shane,
    challengerCut: null,
    challengedCut: null,
    dealerUsername: null,
  };
  const directory = {
    onlineCount: 2,
    players: [shane],
    incomingChallenges: [],
    outgoingChallenges: [],
    activeTable: table,
  };
  let directoryCalls = 0;
  await page.route("**/api/**", async (route) => {
    const apiPath = new URL(route.request().url()).pathname;
    if (apiPath === "/api/auth/session") return route.fulfill({ json: { authenticated: true, user } });
    if (apiPath === "/api/people/me") return route.fulfill({ json: { profile: ownProfile } });
    if (apiPath === "/api/people/presence" || apiPath === "/api/people/online") {
      directoryCalls += 1;
      if (directoryCalls > 1) await delay(300);
      return route.fulfill({ json: directory });
    }
    if (apiPath === "/api/people/challenges/watch") return route.abort();
    if (apiPath === "/api/people/profile") {
      return route.fulfill({
        json: {
          profile: {
            ...shane,
            email: "",
            isSelf: false,
            headToHead: {
              games: 1,
              viewerWins: 1,
              profileWins: 0,
              viewerAverageMargin: 3,
              viewerSkunks: 0,
              profileSkunks: 0,
            },
          },
        },
      });
    }
    if (apiPath === "/api/people/table") return route.fulfill({ json: { table } });
    return route.fulfill({ status: 404, json: { error: `Unhandled QA route: ${apiPath}` } });
  });
}

async function readyPeoplePage(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await installStaticBuild(page);
  await installPeopleFixture(page);
  await page.goto(`${baseUrl}/?pathwayView=home`, { waitUntil: "domcontentloaded" });
  await page.locator('body[data-ready="true"][data-auth="signed-in"]').waitFor();
  return page;
}

async function testPeopleInteractions(browser, baseUrl) {
  let page = await readyPeoplePage(browser, baseUrl);
  const startedAt = Date.now();
  await page.locator("#people-presence-toggle").click();
  await page.locator("#people-presence-panel").waitFor({ state: "visible", timeout: 250 });
  const cachedOpenMilliseconds = Date.now() - startedAt;
  if (cachedOpenMilliseconds >= 250) {
    throw new Error(`Cached Online drawer took ${cachedOpenMilliseconds} ms to open.`);
  }

  await page.locator("#auth-account-profile .player-handicap").hover();
  const tooltip = page.locator("#player-handicap-tooltip");
  if (await tooltip.innerText() !== "Handicap measures win probability of cribbage decisions.") {
    throw new Error("Handicap help copy did not match the product copy.");
  }
  const playerRow = page.locator("#people-online-list .people-list-item").first();
  const rowHandicap = playerRow.locator(".player-handicap");
  if (await rowHandicap.getAttribute("tabindex") !== null) {
    throw new Error("The nested Online-row handicap remained focusable.");
  }
  await holdAndRelease(page, playerRow.locator(".people-list-action"));
  await page.locator("#people-profile-page").waitFor({ state: "visible", timeout: 1_000 });
  if (await tooltip.isVisible()) throw new Error("Handicap help survived profile navigation.");
  await page.close();

  page = await readyPeoplePage(browser, baseUrl);
  await page.locator("#people-presence-toggle").click();
  const resume = page.locator("#people-table-list .people-list-action");
  if (await resume.innerText() !== "Resume") throw new Error("Resume action was absent.");
  await holdAndRelease(page, resume);
  await page.locator("#human-table-page").waitFor({ state: "visible", timeout: 1_000 });
  if (!await page.locator("#people-presence-panel").isHidden()) {
    throw new Error("Online drawer remained open after Resume.");
  }
  await page.close();
  return { cachedOpenMilliseconds, farRightProfileTap: true, farRightResumeTap: true };
}

async function main() {
  if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error("Missing dist/index.html; run npm run build first.");
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const baseUrl = "https://strong-cribbage.test";
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installStaticBuild(page);
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
              dynamicHandicap: { wpPerGame: -0.125, cycles: 8, cyclesPerGame: 4.516, evaluatorVersion: "qa" },
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

    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.locator('[data-pathway-target="play"]').click();
    await page.locator('[data-pathway-destination="dynamic"]').click();
    await page.waitForTimeout(150);

    const state = {
      authVisible: await page.locator("#auth-page").isVisible(),
      gameVisible: await page.locator("main.app").isVisible(),
      serverBusyVisible: await page.locator("#server-busy-alert").isVisible(),
    };
    if (!state.authVisible || state.gameVisible || state.serverBusyVisible) {
      throw new Error(`Authentication recovery regression: ${JSON.stringify(state)}`);
    }
    await page.close();
    const people = await testPeopleInteractions(browser, baseUrl);
    console.log(JSON.stringify({ authenticationRecovery: state, people }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
