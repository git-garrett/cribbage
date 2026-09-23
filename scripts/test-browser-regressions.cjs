#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { chromium, webkit, expect } = require("@playwright/test");

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
  const user = { id: 2, username: "Garrett", displayName: "Garrett", email: "garrett@example.test" };
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
    if (apiPath === "/api/game/history") return route.fulfill({ json: { events: [] } });
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
  await page.locator('body[data-ready="true"][data-auth="signed-in"]').waitFor({ timeout: 5000 });
  return page;
}

async function installPathwayFixture(page, user = { id: 1, username: "qa-player", displayName: "QA Player", email: "qa@example.test" }) {
  const directory = { onlineCount: 1, players: [], incomingChallenges: [], outgoingChallenges: [], activeTable: null };
  await page.route("**/api/**", async (route) => {
    const apiPath = new URL(route.request().url()).pathname;
    if (apiPath === "/api/auth/session") return route.fulfill({ json: { authenticated: true, user } });
    if (apiPath === "/api/game/history") return route.fulfill({ json: { events: [] } });
    if (apiPath === "/api/people/me") {
      return route.fulfill({ json: { profile: { ...user, online: true, lookingForGame: false, isSelf: true } } });
    }
    if (apiPath === "/api/people/presence" || apiPath === "/api/people/online") {
      return route.fulfill({ json: directory });
    }
    if (apiPath === "/api/people/challenges/watch") return route.abort();
    if (apiPath === "/api/leaderboard") {
      return route.fulfill({
        json: {
          generatedAt: "2026-09-05T12:00:00.000Z",
          games: 0,
          playerStats: [],
          playerStatsByOpponent: { master: [] },
          playerStatsByWindow: { daily: [], weekly: [], monthly: [], allTime: [] },
          playerHandicaps: {
            "Production calibration": {
              wpPerGame: -0.061050096,
              cycles: 8,
              cyclesPerGame: 4.516,
              evaluatorVersion: "schell_table-peg_table-13.0",
            },
          },
          bestWins: [],
          mostSkunks: [],
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: `Unhandled QA route: ${apiPath}` } });
  });
}

async function readyPathwayPage(browser, baseUrl, route = "home") {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await installStaticBuild(page);
  await installPathwayFixture(page);
  const query = route === "home" ? "" : `?pathwayView=${route}`;
  await page.goto(`${baseUrl}/${query}`, { waitUntil: "domcontentloaded" });
  await page.locator('body[data-ready="true"][data-auth="signed-in"]').waitFor({ timeout: 5000 });
  return page;
}

async function assertPathwayRoute(page, route) {
  const expected = route === "home" ? "[data-pathway-view='home']" : `[data-pathway-view='${route}']`;
  try {
    await page.locator(expected).waitFor({ state: "visible", timeout: 5000 });
  } catch {
    const state = await page.evaluate(() => ({
      url: location.href,
      pathwayHidden: document.querySelector("#pathway-page").hidden,
      pathwayView: document.querySelector("#pathway-page").dataset.view,
      visibleViews: [...document.querySelectorAll("[data-pathway-view]")]
        .filter((element) => !element.hidden)
        .map((element) => element.dataset.pathwayView),
    }));
    throw new Error(`Expected visible ${route} route: ${JSON.stringify(state)}`);
  }
  const actual = new URL(page.url()).searchParams.get("pathwayView") || "home";
  if (actual !== route) throw new Error(`Expected ${route} route, received ${actual}.`);
}

async function testPathwayParentNavigation(browser, baseUrl) {
  let page = await readyPathwayPage(browser, baseUrl, "leaderboard");
  await page.locator("#leaderboard-page").waitFor({ state: "visible" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('body[data-ready="true"]').waitFor({ timeout: 5000 });
  await page.locator("#leaderboard-page").waitFor({ state: "visible" });
  if (await page.locator("#app-back-label").innerText() !== "Home") {
    throw new Error("Leaderboard back did not identify Home as its parent.");
  }
  await page.locator("#app-back").click();
  await assertPathwayRoute(page, "home");
  await page.close();

  page = await readyPathwayPage(browser, baseUrl);
  await page.locator("#pathway-statistics").click();
  await page.locator("#analytics-page").waitFor({ state: "visible" });
  if (await page.locator("#app-back-label").innerText() !== "Home") {
    throw new Error("Statistics back did not identify Home as its parent.");
  }
  await page.locator("#app-back").click();
  await assertPathwayRoute(page, "home");
  await page.close();

  for (const [route, parent] of [
    ["play", "home"],
    ["human", "play"],
    ["tutorial", "home"],
    ["settings", "home"],
  ]) {
    page = await readyPathwayPage(browser, baseUrl, route);
    await assertPathwayRoute(page, route);
    const localBack = page.locator(`[data-pathway-view='${route}'] [data-pathway-back]`);
    if (await localBack.isVisible()) await localBack.click();
    else await page.locator("#pathway-header-home").click();
    await assertPathwayRoute(page, parent);
    await page.close();
  }

  for (const route of ["gameplay", "sounds"]) {
    page = await readyPathwayPage(browser, baseUrl, route);
    await page.locator("[data-pathway-view='settings']").waitFor({ state: "visible" });
    await page.locator(`#${route}-dialog`).waitFor({ state: "visible" });
    const actual = new URL(page.url()).searchParams.get("pathwayView");
    if (actual !== route) throw new Error(`Expected ${route} modal route, received ${actual}.`);
    await page.locator(`#${route}-dialog-close`).click();
    await assertPathwayRoute(page, "settings");
    await page.close();
  }

  return { leaderboardRefresh: true, utilityParents: true, pathwayParents: true };
}

async function testLeaderboardTourneyInfoTap(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await installStaticBuild(page);
  await installPathwayFixture(page);
  await page.goto(`${baseUrl}/?pathwayView=leaderboard`, { waitUntil: "domcontentloaded" });
  await page.locator('body[data-ready="true"][data-auth="signed-in"]').waitFor({ timeout: 5000 });
  const headerHeight = await page.locator("#leaderboard-page .analytics-header").evaluate(
    (header) => header.getBoundingClientRect().height,
  );
  const info = page.getByRole("button", { name: "About Tourney Points per Game" });
  await info.tap();
  await page.waitForTimeout(250);
  const metricTabs = page.locator("#leaderboard-metric-tabs");
  const infoState = {
    expanded: await info.getAttribute("aria-expanded"),
    bounds: await info.boundingBox(),
    tooltip: await page.locator("#leaderboard-points-help").evaluate((tooltip) => {
      const bounds = tooltip.getBoundingClientRect();
      return { opacity: getComputedStyle(tooltip).opacity, top: bounds.top, bottom: bounds.bottom };
    }),
  };
  const metricBounds = await metricTabs.boundingBox();
  const leaderboardListTop = await page.locator("#leaderboard-list").evaluate(
    (list) => list.getBoundingClientRect().top,
  );
  const scrollStates = await page.locator(".leaderboard-tabs").evaluateAll((tabLists) => tabLists.map((tabList) => {
    const style = getComputedStyle(tabList);
    tabList.scrollTop = 20;
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollbarWidth: style.scrollbarWidth,
      clientHeight: tabList.clientHeight,
      scrollHeight: tabList.scrollHeight,
      scrollTop: tabList.scrollTop,
    };
  }));
  const metricStates = [];
  for (const metric of ["handicap", "pointsPerGame", "winPercentage", "pointDifferential", "totalPoints", "totalWins"]) {
    await page.locator(`[data-leaderboard-metric="${metric}"]`).tap();
    const dimensions = await metricTabs.evaluate((tabList) => ({
      clientHeight: tabList.clientHeight,
      scrollHeight: tabList.scrollHeight,
    }));
    metricStates.push({
      metric,
      ...dimensions,
      windowTabsHidden: await page.locator("#leaderboard-window-tabs").getAttribute("hidden") !== null,
    });
  }
  const horizontalScroll = await metricTabs.evaluate((tabList) => {
    tabList.scrollLeft = 80;
    return { clientWidth: tabList.clientWidth, scrollWidth: tabList.scrollWidth, scrollLeft: tabList.scrollLeft };
  });
  const failures = [];
  if (infoState.expanded !== "true" || infoState.tooltip.opacity !== "1" || !infoState.bounds || infoState.bounds.width < 44 || infoState.bounds.height < 44) {
    failures.push(`info ${JSON.stringify(infoState)}`);
  }
  const tooltipGap = metricBounds ? infoState.tooltip.top - (metricBounds.y + metricBounds.height) : -1;
  if (!metricBounds || tooltipGap < 7 || tooltipGap > 12 || infoState.tooltip.bottom > leaderboardListTop || infoState.tooltip.bottom > 844) {
    failures.push(`tooltip placement ${JSON.stringify({ metricBounds, tooltip: infoState.tooltip, tooltipGap, leaderboardListTop })}`);
  }
  if (scrollStates.some((state) => state.overflowX !== "auto" || state.overflowY !== "hidden" || state.scrollbarWidth !== "none" || state.scrollTop !== 0 || state.scrollHeight !== state.clientHeight)) {
    failures.push(`tab scrolling ${JSON.stringify(scrollStates)}`);
  }
  if (metricStates.some((state) => state.clientHeight > 54 || state.scrollHeight !== state.clientHeight || state.windowTabsHidden !== (state.metric === "handicap"))) {
    failures.push(`metric heights ${JSON.stringify(metricStates)}`);
  }
  if (horizontalScroll.scrollWidth <= horizontalScroll.clientWidth || horizontalScroll.scrollLeft <= 0) {
    failures.push(`horizontal scrolling ${JSON.stringify(horizontalScroll)}`);
  }
  if (headerHeight > 140) {
    failures.push(`stretched header ${headerHeight}`);
  }
  if (failures.length) {
    throw new Error(`Leaderboard mobile controls failed: ${failures.join("; ")}`);
  }
  await page.close();
  return { touchTapOpensTooltip: true, compactMetricRows: true, horizontalScrollOnly: true, scrollbarsHidden: true };
}

async function installLeaderboardBackfillApiFixture(page) {
  const uploads = [];
  const user = { id: 1, username: "qa-player", displayName: "QA Player", email: "qa@example.test" };
  await page.route("**/api/**", async (route) => {
    const apiPath = new URL(route.request().url()).pathname;
    if (apiPath === "/api/auth/session") return route.fulfill({ json: { authenticated: true, user } });
    if (apiPath === "/api/game/history") return route.fulfill({ json: { events: [] } });
    if (apiPath === "/api/people/me") {
      return route.fulfill({ json: { profile: { ...user, online: true, lookingForGame: false, isSelf: true } } });
    }
    if (apiPath === "/api/people/presence" || apiPath === "/api/people/online") {
      return route.fulfill({ json: { onlineCount: 1, players: [], incomingChallenges: [], outgoingChallenges: [], activeTable: null } });
    }
    if (apiPath === "/api/people/challenges/watch") return route.abort();
    if (apiPath === "/api/games") {
      uploads.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, updated: false } });
    }
    return route.fulfill({ status: 404, json: { error: `Unhandled QA route: ${apiPath}` } });
  });
  return uploads;
}

async function testIndexedDbLeaderboardBackfill(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await installStaticBuild(page);
  await page.goto(`${baseUrl}/coming-soon.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const start = {
      id: "recovery-game-start",
      at: "2026-09-01T00:00:00.000Z",
      type: "game",
      action: "start",
      gameId: "recovery-game",
      opponent: "schell_table-peg_table-13.0",
    };
    const end = {
      id: "recovery-game-end",
      at: "2026-09-01T00:30:00.000Z",
      type: "game",
      action: "end",
      gameId: "recovery-game",
      opponent: "schell_table-peg_table-13.0",
      winner: "human",
      loser: "ai",
      result: "regular",
      finalScores: { human: 121, ai: 110 },
    };
    localStorage.setItem("strong-cribbage.analytics.v1:user-1", JSON.stringify({ version: 1, events: [start] }));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("cribbage-game-log:user-1", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("events", { keyPath: "id" });
        request.result.createObjectStore("games", { keyPath: "gameId" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("events", "readwrite");
        transaction.objectStore("events").put(start);
        transaction.objectStore("events").put(end);
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => {
          request.result.close();
          resolve();
        };
      };
    });
  });

  const uploads = await installLeaderboardBackfillApiFixture(page);

  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.locator('body[data-ready="true"][data-auth="signed-in"]').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => localStorage.getItem("strong-cribbage.serverUploadBackfill.v2:user-1") !== null);
  if (uploads.length !== 1 || !uploads[0].events.some((event) => event.id === "recovery-game-end")) {
    throw new Error(`IndexedDB leaderboard history was not backfilled: ${JSON.stringify(uploads)}`);
  }
  await page.close();
  return { indexedDbOnlyCompletionUploaded: true };
}

async function testBlockedIndexedDbLeavesBackfillPending(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await installStaticBuild(page);
  await page.goto(`${baseUrl}/coming-soon.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const events = [
      {
        id: "blocked-db-game-start",
        at: "2026-09-02T00:00:00.000Z",
        type: "game",
        action: "start",
        gameId: "blocked-db-game",
        opponent: "schell_table-peg_table-13.0",
      },
      {
        id: "blocked-db-game-end",
        at: "2026-09-02T00:30:00.000Z",
        type: "game",
        action: "end",
        gameId: "blocked-db-game",
        opponent: "schell_table-peg_table-13.0",
        winner: "human",
        loser: "ai",
        result: "regular",
        finalScores: { human: 121, ai: 110 },
      },
    ];
    localStorage.setItem("strong-cribbage.analytics.v1:user-1", JSON.stringify({ version: 1, events }));
  });
  await page.addInitScript(() => {
    Object.defineProperty(window.indexedDB, "open", {
      configurable: true,
      value() {
        throw new DOMException("IndexedDB is temporarily unavailable.", "InvalidStateError");
      },
    });
  });

  const uploads = await installLeaderboardBackfillApiFixture(page);

  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  await page.locator('body[data-ready="true"][data-auth="signed-in"]').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => localStorage.getItem("strong-cribbage.serverUploadedGames.v1:user-1") !== null);
  const marker = await page.evaluate(() => localStorage.getItem("strong-cribbage.serverUploadBackfill.v2:user-1"));
  if (uploads.length !== 1) {
    throw new Error(`LocalStorage history was not uploaded while IndexedDB was blocked: ${JSON.stringify(uploads)}`);
  }
  if (marker !== null) {
    throw new Error(`Blocked IndexedDB was incorrectly marked as inspected: ${marker}`);
  }
  await page.close();
  return { localStorageUploaded: true, backfillStillPending: true };
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
  if (await tooltip.innerText() !== "Handicap is a skill-only (no chance or cards component) measure of cribbage skill.") {
    throw new Error("Handicap help copy did not match the product copy.");
  }
  if ((await tooltip.innerText()).includes("Learn More")) {
    throw new Error("Handicap help exposed Learn More before the explanation page is active.");
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

function engagementFixture(filters = {}) {
  const breakdown = [{ label: "QA signal", events: 3, sessions: 2, visitors: 2 }];
  const daily = [
    { period: "2026-08-06", activeVisitors: 17, sessions: 17, events: 17, gameStarts: 0, gameCompletions: 0, gameForfeits: 0, bounces: 0, errorEvents: 0, frictionEvents: 0, abandonmentCandidates: 0 },
    { period: "2026-09-03", activeVisitors: 1, sessions: 1, events: 4, gameStarts: 1, gameCompletions: 0, gameForfeits: 0, bounces: 0, errorEvents: 0, frictionEvents: 0, abandonmentCandidates: 0 },
    { period: "2026-09-04", activeVisitors: 2, sessions: 2, events: 8, gameStarts: 1, gameCompletions: 1, gameForfeits: 0, bounces: 1, errorEvents: 1, frictionEvents: 1, abandonmentCandidates: 0 },
    { period: "2026-09-05", activeVisitors: 2, sessions: 3, events: 12, gameStarts: 2, gameCompletions: 1, gameForfeits: 0, bounces: 0, errorEvents: 0, frictionEvents: 1, abandonmentCandidates: 1 },
  ];
  return {
    range: {
      days: filters.days ?? 30,
      label: `Last ${filters.days ?? 30} days`,
      from: "2026-09-03T10:00:00Z",
      to: "2026-09-05T12:00:00Z",
      environment: filters.environment ?? "all",
      audience: filters.audience ?? "all",
    },
    totals: {
      activeVisitors: 2, registeredUsers: 2, anonymousSessions: 0, signedInSessions: 3,
      sessions: 3, returningUsers: 1, events: 24, pageViews: 8, interactions: 6,
      activeNow: 1, activeLast24Hours: 2, gameStarts: 4, observedGames: 4,
      gameResumes: 1, gameCompletions: 2, gameForfeits: 0, gameAbandons: 1,
      completionPercent: 50, bounceSessions: 1, bouncePercent: 33.3,
      errorEvents: 1, errorSessions: 1, frictionEvents: 2, frictionSessions: 1,
      averageExitSeconds: 180,
    },
    comparison: { activeVisitors: 100, sessions: 50, gameStarts: 33.3, completionPercent: 5, bouncePercent: -2, errorSessions: 0 },
    definitions: { activeVisitors: "Distinct visitors.", completionPercent: "Completed distinct games divided by observed distinct games." },
    funnel: [
      { label: "Sessions started", sessions: 3, conversionPercent: 100, dropOff: null, denominator: "sessions" },
      { label: "Reached home", sessions: 3, conversionPercent: 100, dropOff: 0, denominator: "sessions" },
      { label: "Reached Play Now", sessions: 2, conversionPercent: 66.7, dropOff: 1, denominator: "sessions" },
      { label: "Started a game", sessions: 2, conversionPercent: 66.7, dropOff: 0, denominator: "sessions" },
      { label: "Completed a game", sessions: 1, conversionPercent: 33.3, dropOff: 1, denominator: "sessions" },
    ],
    pathways: breakdown,
    opponents: [{ label: "Dynamic", events: 4, sessions: 3, visitors: 2 }],
    devices: breakdown,
    clients: breakdown,
    environments: breakdown,
    locations: breakdown,
    surfaces: breakdown,
    eventTypes: breakdown,
    states: [{ label: "Visibility · Hidden", events: 2, sessions: 1, visitors: 1 }],
    interactions: breakdown,
    errors: [{ label: "Client · QA error", events: 1, sessions: 1, visitors: 1 }],
    users: [{
      username: "Garrett", displayName: "Garrett", lastActive: "2026-09-05T12:00:00Z",
      activeDays: 3, sessions: 3, events: 20, pageViews: 7, gameStarts: 4,
      observedGames: 4, gameCompletions: 2, errors: 1, frictionEvents: 2,
      primaryClient: "Desktop · Chromium",
    }],
    recentActivity: [{ at: "2026-09-05T12:00:00Z", person: "Garrett", username: "Garrett", event: "game_complete", detail: "Dynamic", environment: "prod", client: "Desktop · Chromium" }],
    daily,
    hourly: daily.map((point, index) => ({ ...point, period: `2026-09-05T${String(10 + index).padStart(2, "0")}` })),
    csv: "date,events\n2026-09-05,12\n",
  };
}

async function testEngagementDashboard(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  await installStaticBuild(page);
  const user = { id: 2, username: "Garrett", displayName: "Garrett", email: "garrett@example.test", engagementAdmin: true };
  const profile = { ...user, avatarDataUrl: null, online: true, lookingForGame: false, isSelf: true, textSize: "normal" };
  const engagementRequests = [];
  await page.route("**/api/**", async (route) => {
    const apiPath = new URL(route.request().url()).pathname;
    if (apiPath === "/api/auth/session") return route.fulfill({ json: { authenticated: true, user } });
    if (apiPath === "/api/game/history") return route.fulfill({ json: { events: [] } });
    if (apiPath === "/api/people/me") return route.fulfill({ json: { profile } });
    if (apiPath === "/api/people/presence" || apiPath === "/api/people/online") {
      return route.fulfill({ json: { players: [], incomingChallenges: [], outgoingChallenges: [], onlineCount: 1 } });
    }
    if (apiPath === "/api/people/challenges/watch") return route.abort();
    if (apiPath === "/api/admin/engagement") {
      const filters = route.request().postDataJSON();
      engagementRequests.push(filters);
      return route.fulfill({ json: engagementFixture(filters) });
    }
    if (apiPath === "/api/activity") return route.fulfill({ json: { ok: true } });
    return route.fulfill({ status: 404, json: { error: `Unhandled QA route: ${apiPath}` } });
  });

  await page.goto(`${baseUrl}/?engagement=1`, { waitUntil: "domcontentloaded" });
  await page.locator('#engagement-content:not([hidden])').waitFor();
  const activityChart = page.locator("#engagement-activity-chart");
  await activityChart.locator("svg path.engagement-chart-line").first().waitFor();
  const chartPointTitles = await activityChart.locator("circle title").allTextContents();
  if (!chartPointTitles.some((title) => title.includes("Visitors: 17 · Aug 6"))) {
    throw new Error("Engagement chart omitted the oldest partial reporting bucket.");
  }
  const legend = activityChart.locator(".engagement-chart-legend button").first();
  const pressedBefore = await legend.getAttribute("aria-pressed");
  await legend.click();
  const pressedAfter = await legend.getAttribute("aria-pressed");
  if (pressedBefore === pressedAfter) throw new Error("Engagement chart legend did not toggle its line.");

  const overviewTab = page.locator('[data-engagement-tab="overview"]');
  await overviewTab.focus();
  await overviewTab.press("ArrowRight");
  if (await page.locator('[data-engagement-tab="people"]').getAttribute("aria-selected") !== "true") {
    throw new Error("Engagement keyboard tab navigation did not select People.");
  }
  if (!await page.locator("#engagement-users").getByText("Garrett", { exact: true }).first().isVisible()) {
    throw new Error("Engagement account activity did not render.");
  }

  await page.locator('[data-engagement-tab="experience"]').click();
  await page.locator("#engagement-experience-chart svg").waitFor({ state: "visible" });
  await page.locator('[data-engagement-tab="data"]').click();
  await page.locator("#engagement-states").getByText("Visibility · Hidden", { exact: true }).waitFor();
  await page.getByText("What the current data cannot answer", { exact: true }).waitFor();

  await page.locator("#engagement-environment").selectOption("prod");
  await page.waitForFunction(() => document.querySelector("#engagement-summary")?.textContent?.includes("prod"));
  if (!engagementRequests.some((request) => request.environment === "prod")) {
    throw new Error("Engagement environment filter did not reach the reporting API.");
  }
  await page.close();
  return { lineChart: true, oldestPartialBucket: true, legendToggle: true, keyboardTabs: true, people: true, experience: true, states: true, serverFilter: true };
}

async function testTrainingFeedbackBackground(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await installStaticBuild(page);
  await installPathwayFixture(page);
  await page.goto(`${baseUrl}/?pathwayView=intro-pegging`, { waitUntil: "networkidle" });
  await page.locator("[data-training-intro-next]").click();
  await page.locator("[data-training-intro-dialog] button[type='submit']").click();
  const action = page.locator("[data-training-intro-continue]");
  await action.filter({ hasText: "Try it yourself" }).click();
  await page.locator('[data-training-intro-game][data-dealing="false"]').waitFor();

  // Hold the feedback's dismissal timer so each screenshot samples the visible
  // animation, even on slower machines. Exercise real incorrect/correct answers.
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 100);
  const feedback = page.locator("[data-training-intro-feedback]");
  for (const [state, card, mark] of [["failure", "9c", "×"], ["success", "6d", "✓"]]) {
    await page.locator(`[data-training-intro-hand] [data-training-card="${card}"]`).click();
    await action.click();
    if (!await feedback.isVisible() || await feedback.getAttribute("data-state") !== state
      || await feedback.locator(".drill-feedback-mark").textContent() !== mark) {
      throw new Error(`Missing ${state} training feedback.`);
    }
    await feedback.locator(".drill-feedback-mark").evaluate((element) => {
      for (const animation of element.getAnimations()) {
        animation.pause();
        animation.currentTime = 350;
      }
    });
    const box = await feedback.boundingBox();
    // The edge of the lower table is felt, clear of the centered mark and label.
    const clip = { x: Math.ceil(box.x + 5), y: Math.ceil(box.y + box.height * 0.8), width: 2, height: 2 };
    const during = await page.screenshot({ clip });
    // Compare with the same layout beneath the overlay, keeping card moves and
    // score updates identical so this catches a background flash specifically.
    await feedback.evaluate((element) => { element.hidden = true; });
    const uncovered = await page.screenshot({ clip });
    await feedback.evaluate((element) => { element.hidden = false; });
    if (!during.equals(uncovered)) throw new Error(`${state} feedback changes the table background.`);
    await page.clock.runFor(1200);
    if (await feedback.isVisible()) throw new Error(`${state} feedback did not dismiss.`);
  }
  await page.close();
  return { success: true, failure: true, backgroundStable: true };
}

async function testDiscardIntroDemonstration(browser, baseUrl) {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion });
    await installStaticBuild(page);
    await installPathwayFixture(page);
    await page.goto(`${baseUrl}/?pathwayView=intro-discard`, { waitUntil: "networkidle" });
    await page.locator("[data-training-intro-next]").click();
    await page.locator("[data-training-intro-dialog] button[type='submit']").click();
    await page.locator('[data-training-intro-game][data-dealing="false"]').waitFor();
    const hand = page.locator("[data-training-intro-hand]");
    const action = page.locator("[data-training-intro-continue]");
    const selected = await hand.locator(".card.selected").evaluateAll((cards) => cards.map((card) => card.dataset.trainingCard).sort());
    if (JSON.stringify(selected) !== JSON.stringify(["Kd", "Qc"]) || await hand.locator(".card").count() !== 6) {
      throw new Error("Discard example must first show all six cards with the queen and king selected.");
    }
    await page.waitForTimeout(200);
    if (await action.isVisible() || await hand.locator(".card").count() !== 6) {
      throw new Error("Discard example must pause on the selection before removing the cards.");
    }
    if (reducedMotion === "no-preference") {
      const flight = page.locator(".discard-flight-layer");
      await flight.waitFor();
      const discards = await flight.locator(".card").evaluateAll((cards) => cards.map((card) => card.dataset.trainingCard).sort());
      if (JSON.stringify(discards) !== JSON.stringify(selected)) throw new Error("The two selected cards must fly to the crib.");
    }
    await action.filter({ hasText: "Try it yourself" }).waitFor();
    const kept = await hand.locator(".card").evaluateAll((cards) => cards.map((card) => card.dataset.trainingCard).sort());
    if (JSON.stringify(kept) !== JSON.stringify(["4c", "4d", "6s", "9h"])) {
      throw new Error(`Discard demonstration left the wrong hand: ${kept}`);
    }
    for (const card of await hand.locator(".card").all()) {
      if (!await card.isVisible()) throw new Error("Each kept card must remain visible.");
    }
    if (await page.locator(".discard-flight-layer").count() !== 0
      || await page.locator("[data-training-intro-crib]").getAttribute("data-fill") !== "partial") {
      throw new Error("Discard demonstration must clean up the flight and fill the crib.");
    }
    await action.click();
    await page.locator('[data-training-intro-game][data-dealing="false"]').waitFor();
    if (await hand.locator("button.card").count() !== 6
      || await page.locator("[data-training-intro-crib]").getAttribute("data-fill") !== "empty") {
      throw new Error("Practice must restore six selectable cards and an empty crib.");
    }
    await page.close();
  }
  return { selectionPause: true, discardFlight: true, fourKeptCards: true, reducedMotion: true, practiceReset: true };
}

async function testTrainingPeggingAnimations(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, reducedMotion: "no-preference" });
  await installStaticBuild(page);
  await installPathwayFixture(page);
  const flight = page.locator(".pegging-play-flight-layer .pegging-flying-card");
  const assertFlight = async () => {
    await flight.waitFor();
    const timing = await flight.evaluate((card) => card.getAnimations()[0].effect.getTiming());
    if (timing.duration !== 480 || timing.easing !== "cubic-bezier(0.22, 0.72, 0.24, 1)") throw new Error("Training must use live pegging flight timing.");
    await flight.waitFor({ state: "detached" });
  };
  await page.goto(`${baseUrl}/?pathwayView=intro-pegging`, { waitUntil: "networkidle" });
  await page.locator("[data-training-intro-next]").click();
  await page.locator("[data-training-intro-dialog] button[type='submit']").click();
  await assertFlight();
  const action = page.locator("[data-training-intro-continue]");
  await action.filter({ hasText: "Try it yourself" }).click();
  await page.locator('[data-training-intro-game][data-dealing="false"]').waitFor();
  await page.locator('[data-training-card="6d"]').click();
  await action.click();
  await assertFlight();
  await action.filter({ hasText: "Find another pair" }).click();
  await page.locator('[data-training-intro-game][data-dealing="false"]').waitFor();
  await page.locator('[data-training-card="8d"]').click();
  await action.click();
  await assertFlight();
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto(`${baseUrl}/?pathwayView=drill-scoring-play`, { waitUntil: "networkidle" });
  const surface = page.locator('[data-drill-surface="find-scoring-play"]');
  await surface.locator('[data-drill-hand] .card').first().waitFor();
  await page.locator('[data-drill-surface="find-scoring-play"][data-dealing="false"]').waitFor();
  const drill = JSON.parse(fs.readFileSync(path.join(__dirname, "../resources/training/easy-drills.json"), "utf8")).scoringPlayDrills[0];
  await surface.locator(`[data-card="${drill.answer}"]`).click();
  await surface.locator("[data-drill-submit]").click();
  await assertFlight();
  await page.close();
  return { example: true, practice: true, challenge: true, scoringDrill: true };
}

async function testPuttingTogetherDiscards(browser, baseUrl, pegCard = "5d", reducedMotion = "no-preference") {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion });
  await installStaticBuild(page);
  await installPathwayFixture(page);
  await page.goto(`${baseUrl}/?pathwayView=intro-discard`, { waitUntil: "networkidle" });
  const action = page.locator("[data-training-intro-continue]");
  const closeExplanation = () => page.locator("[data-training-intro-dialog] button[type='submit']").click();
  await page.locator("[data-training-intro-next]").click();
  await closeExplanation();
  await action.filter({ hasText: "Try it yourself" }).click();
  await page.locator('[data-training-intro-game][data-dealing="false"]').waitFor();
  await page.locator('.mobile-header-reveal:visible').click();
  await page.locator('[data-pathway-back="drills-beginner"]:visible').click();
  await page.locator('[data-pathway-destination="intro-complete"]').click();
  await page.locator("[data-training-intro-next]").click();
  await closeExplanation();
  if (await page.locator("[data-training-intro-played] .deal-cut-choice").count() !== 52
    || await page.locator("[data-training-intro-instruction]").isVisible()) {
    throw new Error("The complete lesson must restore the deck and clear prior practice instructions.");
  }
  await page.getByRole("button", { name: "Cut at card 13 of 52", exact: true }).click();
  if (reducedMotion === "no-preference") {
    await page.locator("[data-training-intro-played] .deal-cut-card-lift").waitFor();
  }
  await action.filter({ hasText: "Next: Deal six cards" }).waitFor();
  if (await page.locator("[data-training-intro-played] .deal-cut-reveal").count() !== 2) throw new Error("Both cut cards must be revealed.");
  const cutFits = await page.locator("[data-training-intro-played] .deal-cut-card").evaluateAll((cards) => cards.every((card) => {
    const rect = card.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth;
  }));
  if (!cutFits) throw new Error("The cut spread must fit the viewport.");
  await action.click();
  await closeExplanation();
  await action.click();
  await action.filter({ hasText: "Next: Discard two" }).click();
  await closeExplanation();
  const hand = page.locator("[data-training-intro-hand]");
  if (!await page.locator("[data-training-intro-player-crib]").isVisible()
    || await page.locator("[data-training-intro-opponent-crib]").isVisible()) {
    throw new Error("The example must send discards to the player's own crib.");
  }
  const options = await hand.locator('[role="button"]').evaluateAll((cards) => cards.map((card) => card.dataset.trainingCard).sort());
  if (JSON.stringify(options) !== JSON.stringify(["6s", "9h"])) throw new Error(`Wrong discard choices: ${options}`);
  for (const card of options) await hand.locator(`[data-training-card="${card}"]`).click();
  await action.click();
  const labels = () => hand.locator(".card").evaluateAll((cards) => cards.map((card) => card.dataset.trainingCard).sort());
  const expected = ["5c", "5d", "Kd", "Qc"];
  if (JSON.stringify(await labels()) !== JSON.stringify(expected)) throw new Error("Discard must keep 5, 5, king, queen.");
  await action.filter({ hasText: "Next: Peg one card" }).click();
  await closeExplanation();
  if (!await page.locator("[data-training-intro-played] .card").isVisible()) {
    throw new Error("The pegging card must remain visible after visiting Discard Intro.");
  }
  if (JSON.stringify(await labels()) !== JSON.stringify(expected)) throw new Error("Pegging must use the kept hand.");
  const pegOptions = await hand.locator('[role="button"]').evaluateAll((cards) => cards.map((card) => card.dataset.trainingCard).sort());
  if (JSON.stringify(pegOptions) !== JSON.stringify(expected)) throw new Error("Every kept card must be playable.");
  await hand.locator('[data-training-card="5c"]').click();
  await hand.locator(`[data-training-card="${pegCard}"]`).click();
  if (pegCard === "5c") await hand.locator('[data-training-card="5c"]').click();
  if (await hand.locator(".selected").count() !== 1) throw new Error("Pegging must select only one card.");
  await action.click();
  if (reducedMotion === "no-preference") {
    const flying = page.locator(".pegging-play-flight-layer .pegging-flying-card");
    await flying.waitFor();
    const duration = await flying.evaluate((card) => card.getAnimations()[0].effect.getTiming().duration);
    if (duration !== 480) throw new Error(`Training flight differs from live human pegging: ${duration}`);
  }
  await action.filter({ hasText: "Next: Count the hand" }).waitFor();
  const expectedCount = pegCard.startsWith("5") ? "15" : "20";
  const expectedPoints = pegCard === "Kd" ? 0 : 2;
  if (await page.locator("[data-training-intro-count]").textContent() !== expectedCount
    || await page.locator("[data-training-intro-player-score]").textContent() !== String(expectedPoints)) {
    throw new Error(`Wrong count or score for ${pegCard}.`);
  }
  if (pegCard !== "5d") { await page.close(); return { pegCard, expectedCount, expectedPoints }; }
  await action.click();
  await closeExplanation();
  if (JSON.stringify(await labels()) !== JSON.stringify(expected)) throw new Error("Counting must restore the same four-card hand.");
  await page.setViewportSize({ width: 1024, height: 844 });
  if (!await page.locator("[data-training-intro-cut] .card").isVisible()) {
    throw new Error("The counting turn card must remain visible after visiting Discard Intro.");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-training-intro-game] > .scoreboard [data-training-intro-cut] .card").waitFor();
  await page.evaluate(() => {
    window.trainingCounts = [];
    const notices = document.querySelector("[data-training-intro-notices]");
    new MutationObserver(() => {
      const bubble = notices.querySelector(".game-notification");
      if (!bubble) return;
      const lifted = [...document.querySelectorAll("[data-training-intro-hand] .score-card-lift")];
      window.trainingCounts.push({
        label: bubble.querySelector(".game-notification-label").textContent,
        points: bubble.querySelector(".game-notification-points").textContent,
        emphasized: lifted.map((card) => card.dataset.id),
        animation: lifted[0] && getComputedStyle(lifted[0]).animationName,
        bubbleAnimation: getComputedStyle(bubble).animationName,
      });
    }).observe(notices, { childList: true });
  });
  await action.click();
  await action.filter({ hasText: "Next: Pass the crib" }).waitFor({ timeout: 20000 });
  const counts = await page.evaluate(() => window.trainingCounts);
  if (JSON.stringify(counts.map((part) => part.label)) !== JSON.stringify(["Fifteen", "Fifteen", "Fifteen", "Fifteen", "Pair"])
    || counts.some((part) => part.points !== "+2" || part.emphasized.length !== 2)
    || new Set(counts.map((part) => [...part.emphasized].sort().join(","))).size !== 5) {
    throw new Error(`Counting did not present each distinct combination: ${JSON.stringify(counts)}`);
  }
  if (reducedMotion === "no-preference" && counts.some((part) => part.animation !== "score-card-lift-cycle" || part.bubbleAnimation !== "game-score-notification-after-lift")) {
    throw new Error(`Counting animations differ from live play: ${JSON.stringify(counts)}`);
  }
  if (await page.locator("[data-training-intro-player-score]").textContent() !== "12") throw new Error("Counting must add ten to pegging points.");
  await action.click();
  await closeExplanation();
  await action.click();
  await action.filter({ hasText: "Next: How the game ends" }).click();
  if (!await page.locator("[data-training-intro-copy]").isVisible()
    || await page.locator("[data-training-intro-game]").isVisible()
    || !(await page.locator("[data-training-intro-body]").textContent()).includes("wins immediately")) throw new Error("Ending must be descriptive.");
  await page.getByRole("button", { name: "Finish beginner training", exact: true }).click();
  await page.getByRole("button", { name: "Play a real game against Easy" }).waitFor();
  await page.close();
  return { ownCrib: true, discardSixNine: true, keepFiveFiveKingQueen: true, peggingAndCounting: true };
}

function acePeggingFixture() {
  const model = "schell_table-peg_table-13.23";
  const card = (id, rank, value) => ({ id, rank, value, suit: "clubs", symbol: "♣", label: `${rank}♣` });
  const hand = [card(0, "A", 1), card(4, "2", 2), card(8, "3", 3), card(12, "4", 4)];
  const lead = { ...card(16, "5", 5), owner: "ai" };
  const snapshot = {
    version: 1, gameId: "qa-ace-lead", opponent: model, deal: 0, firstDeal: 0, handNumber: 1,
    human: { hand: hand.map(c => c.id), table: [], crib: [], score: 0 },
    ai: { hand: [], table: [], crib: [], score: 0 },
    turnCard: 24, turnCardRevealed: true, crib: [], plays: [], playOwners: [],
    completedPlays: [], completedPlayOwners: [], count: 0, turn: 1, goPlayer: null,
    lastPlayer: null, scoringReview: null, phase: "pegging", message: "Ace leads.", log: [], result: [],
    pegPositions: { human: [0, 0], ai: [0, 0] },
  };
  const state = {
    phase: "pegging", message: "Ace leads.", log: [], result: [], handNumber: 1,
    scores: { human: 0, ai: 0 }, pegPositions: snapshot.pegPositions,
    dealer: "User", firstDealer: "User", cribOwner: "User", turn: "AI", count: 0,
    turnCard: card(24, "7", 7), turnCardRevealed: true, plays: [], completedPlays: [],
    peggingResetPending: false, humanHand: hand, aiHandCount: 4, humanTable: [], aiTable: [],
    legalCardIds: [], aiLegalCardIds: [], canGo: false, scoring: null, cutForDeal: null, analyticsEvents: [],
  };
  return { model, hand, lead, snapshot, state };
}

async function testDynamicCalibrationPresentation(browser, baseUrl, established) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await installStaticBuild(page);
  await installPathwayFixture(page);
  const { snapshot, state, hand } = acePeggingFixture();
  const provisional = { started: true, completeCycles: 2, minimumCycles: 6, complete: false, provisionalHandicapPerGame: -0.125 };
  const profile = {
    username: "qa-player", displayName: "QA Player", online: true, lookingForGame: false, isSelf: true,
    dynamicCalibration: established ? { ...provisional, completeCycles: 20, complete: true } : provisional,
    ...(established ? { dynamicHandicap: { wpPerGame: -0.125, cycles: 20, cyclesPerGame: 4.516, evaluatorVersion: "previous-ace" } } : {}),
  };
  const response = {
    snapshot: { ...snapshot, opponent: "dynamic", gameId: "qa-dynamic", deal: 1, turn: 0 },
    state: { ...state, turn: "User", dealer: "AI", cribOwner: "AI", legalCardIds: hand.map(card => card.id), dynamicCalibration: provisional },
  };
  let releaseReview;
  const reviewReady = new Promise(resolve => { releaseReview = resolve; });
  let reviewStarted = false;
  await page.route("**/api/game/review", async route => {
    reviewStarted = true;
    await reviewReady;
    profile.dynamicHandicap = { wpPerGame: -0.166, cycles: 21, cyclesPerGame: 4.516, evaluatorVersion: "current-ace" };
    return route.fulfill({ json: { ...response, handicapUpdated: true } });
  });
  await page.route("**/api/people/me", route => route.fulfill({ json: { profile } }));
  await page.route("**/api/game/session/load", route => route.fulfill({ json: { session: null } }));
  await page.route("**/api/game/action", route => {
    if (["play", "play-human"].includes(route.request().postDataJSON().action)) {
      response.state.humanHand = hand.slice(1);
      response.state.legalCardIds = hand.slice(1).map(card => card.id);
      response.state.analyticsEvents = [{ id: "pending-choice", gameId: "qa-dynamic", at: "2026-09-22T00:00:00Z", type: "discard", player: "human", role: "dealer", handNumber: 1, cards: ["5♣", "6♣"], remainingHand: ["A♣", "2♣", "3♣", "4♣"] }];
    }
    return route.fulfill({ json: response });
  });
  try {
    await page.goto(`${baseUrl}/?pathwayView=play`, { waitUntil: "networkidle" });
    await expect(page.locator("#dynamic-card-copy")).toHaveText(established ? "Adapts to your play and plays back at your skill." : "CALIBRATING");
    await page.locator('[data-pathway-destination="dynamic"]').click();
    await expect(page.locator("#human-hand .card")).toHaveCount(4);
    if (established) {
      await expect(page.locator("#dynamic-calibration-status")).toBeHidden();
      await expect(page.locator("#dynamic-calibration-handicap")).toBeHidden();
      await page.locator("#human-hand .card").first().click();
      await page.locator("#play").click();
      await expect.poll(() => reviewStarted).toBe(true);
      await page.locator(".mobile-header-reveal:visible").click();
      await page.locator("#app-back").click();
      await expect(page.locator("#pathway-page")).toBeVisible();
      releaseReview();
      await expect(page.locator("#auth-account-profile .player-handicap")).toHaveText("(16.60)");
    } else {
      await expect(page.locator("#dynamic-calibration-handicap")).toBeVisible();
      await expect(page.locator("#dynamic-calibration-handicap")).toHaveText("Provisional Handicap: 12.50");
    }
    return { established, correctCalibrationDisplay: true, unitlessHandicap: true };
  } finally { releaseReview(); await page.close(); }
}

async function testFirstDealerCutTap(browser, baseUrl, mode = "touch") {
  const page = await browser.newPage({ viewport: { width: 375, height: 679 }, isMobile: true, hasTouch: true });
  await installStaticBuild(page);
  await installPathwayFixture(page);
  const { snapshot, state, hand } = acePeggingFixture();
  const dealtHand = [...hand, { ...hand[0], id: 16, rank: "5", value: 5, label: "5♣" }, { ...hand[0], id: 20, rank: "6", value: 6, label: "6♣" }];
  const opening = { ...state, phase: "cut_for_deal", message: "Cut the deck for first deal.",
    humanHand: dealtHand, aiHandCount: 6, turn: null, turnCard: null, turnCardRevealed: false };
  const dealt = { ...opening, phase: "discard", message: "Choose two cards for your crib.",
    cutForDeal: { human: hand[0], ai: hand[1], prompt: "User deals first." } };
  const historyDuringTap = mode === "history";
  const actions = [];
  let releaseHistory;
  const historyReady = new Promise(resolve => { releaseHistory = resolve; });
  if (historyDuringTap) await page.route("**/api/game/history", async route => {
    await historyReady;
    await route.fulfill({ json: { events: [] } });
  });
  await page.route("**/api/game/session/load", route => route.fulfill({ json: { session: null } }));
  await page.route("**/api/game/action", async route => {
    const action = route.request().postDataJSON().action;
    actions.push(action);
    if (action === "prepare-cut-for-deal" && mode === "slow") await delay(1500);
    const next = action === "new" || action === "state" ? opening : dealt;
    return route.fulfill({ json: { snapshot: { ...snapshot, phase: next.phase, turnCard: null, turnCardRevealed: false }, state: next,
      recommendation: { cardIds: [16, 20] } } });
  });
  try {
    await page.goto(`${baseUrl}/?pathwayView=play`, { waitUntil: "domcontentloaded" });
    await page.locator('body[data-ready="true"][data-auth="signed-in"]').waitFor();
    await page.locator('[data-pathway-destination="master"]').click();
    const card = page.getByRole("button", { name: "Cut at card 12 of 52", exact: true });
    await expect(card).toBeEnabled();
    if (mode === "timing") {
      // Freeze time only after preparation has finished. This measures deliberate
      // presentation delays, independently of network and machine speed.
      await page.waitForLoadState("networkidle");
      await page.clock.install();
      await page.clock.pauseAt(Date.now());
      // The touch modes below exercise hit testing; activate the native button
      // here so Safari's synthesized-click scheduling is outside this clock.
      await card.evaluate(button => button.click());
      await expect(page.locator(".deal-cut-card-lift")).toHaveCount(1);
      await expect(page.locator("#plays .deal-cut-choice:disabled")).toHaveCount(52);
      await page.clock.runFor(400);
      await expect(page.locator(".deal-cut-reveal-human")).toHaveCount(1);
      await page.clock.runFor(600);
      await expect(page.locator(".deal-cut-reveal-ai")).toHaveCount(1);
      await page.clock.runFor(1000);
      await expect(page.locator('.app[data-deal-animation-active="true"]')).toHaveCount(1);
      await page.clock.runFor(3000);
    } else if (historyDuringTap) {
      const box = await card.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const restored = page.waitForResponse("**/api/game/history");
      releaseHistory();
      await restored;
      await delay(200);
      await page.mouse.up();
    } else if (mode === "keyboard") {
      await card.focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Space");
    } else {
      await card.tap();
      if (mode === "slow") {
        await expect(page.locator(".deal-cut-card-lift")).toBeVisible();
        // A second tap while the prepared response is pending must not restart
        // the cut or submit another action.
        await card.tap({ force: true });
      }
    }
    if (mode !== "timing") await expect(page.locator(".deal-cut-reveal").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#human-hand .card")).toHaveCount(6, { timeout: 10000 });
    expect(actions.filter(action => action === "prepare-cut-for-deal" || action === "cut-for-deal")).toHaveLength(1);
    return { mode, firstTapRevealsCut: true, actions };
  } finally { releaseHistory(); await page.close(); }
}

async function testAceOpeningPlayThrobber(browser, baseUrl, dealer = "User", reducedMotion = "no-preference") {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await installStaticBuild(page);
  await installPathwayFixture(page);
  const { model, hand, lead, snapshot, state } = acePeggingFixture();
  await page.emulateMedia({ reducedMotion });
  const humanLead = { ...hand[0], owner: "human" };
  if (dealer === "AI") {
    Object.assign(snapshot, { deal: 1, turn: 0 });
    Object.assign(state, { dealer, cribOwner: dealer, turn: "User", legalCardIds: hand.map(card => card.id) });
  }
  let releaseLead;
  const leadReady = new Promise(resolve => { releaseLead = resolve; });
  await page.route("**/api/game/session/load", route => {
    const requested = route.request().postDataJSON().opponent;
    return route.fulfill({ json: { session: requested === model ? { gameId: snapshot.gameId, snapshot, state } : null } });
  });
  await page.route("**/api/game/action", async route => {
    const action = route.request().postDataJSON().action;
    if (action === "play-human" && dealer === "AI") {
      return route.fulfill({ json: {
        snapshot: { ...snapshot, plays: [humanLead.id], playOwners: ["human"], turn: 1, count: humanLead.value },
        state: { ...state, plays: [humanLead], humanTable: [humanLead], humanHand: hand.slice(1), turn: "AI", count: humanLead.value, legalCardIds: [] },
      } });
    }
    if (action !== "advance-pegging") throw new Error(`Unexpected Ace action: ${action}`);
    await leadReady;
    return route.fulfill({ json: {
      snapshot: { ...snapshot, plays: dealer === "AI" ? [humanLead.id, lead.id] : [lead.id], playOwners: dealer === "AI" ? ["human", "ai"] : ["ai"], turn: 0, count: dealer === "AI" ? 6 : 5 },
      state: { ...state, plays: dealer === "AI" ? [humanLead, lead] : [lead], humanTable: dealer === "AI" ? [humanLead] : [], humanHand: dealer === "AI" ? hand.slice(1) : hand, aiTable: [lead], aiHandCount: 3, turn: "User", count: dealer === "AI" ? 6 : 5, legalCardIds: (dealer === "AI" ? hand.slice(1) : hand).map(c => c.id) },
    } });
  });
  try {
    await page.goto(`${baseUrl}/?pathwayView=play`, { waitUntil: "networkidle" });
    await page.locator('[data-pathway-destination="master"]').click();
    if (dealer === "AI") {
      await expect(page.locator("#thinking-overlay")).toBeHidden();
      await page.locator(`#human-hand .card[data-id="${humanLead.id}"]`).click();
      await page.locator("#play").click();
    }
    const overlay = page.locator("#thinking-overlay");
    await overlay.waitFor({ state: "visible", timeout: 5000 });
    if (await page.locator("#thinking-overlay-label").textContent() !== "Waiting for Ace to play") {
      throw new Error("Ace opening play did not show its waiting label.");
    }
    if (!await overlay.locator(".throbber").isVisible()) throw new Error("Ace lead throbber is hidden.");
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), `cribbage-ace-wait-${dealer}-${reducedMotion}.png`) });
    releaseLead();
    await overlay.waitFor({ state: "hidden", timeout: 5000 });
    await page.locator('#plays .card[data-owner="ai"]').waitFor({ state: "visible" });
    return { model, dealer, reducedMotion, waitingLabel: true, throbber: true, clearsAfterPlay: true };
  } finally {
    releaseLead();
    await page.close();
  }
}

async function testPostgameAceAnalysis(browser, baseUrl, analyticsWritable = true, retryOnce = false) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await installStaticBuild(page);
  await installPathwayFixture(page);
  const { model, snapshot, state } = acePeggingFixture();
  if (!analyticsWritable) {
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("strong-cribbage.analytics.v1")) throw new DOMException("Storage full", "QuotaExceededError");
        return setItem.call(this, key, value);
      };
    });
  }
  const gameId = snapshot.gameId;
  const events = [
    { id: "start", at: "2026-09-19T12:00:00Z", gameId, type: "game", action: "start", opponent: model },
    { id: "discard", at: "2026-09-19T12:01:00Z", gameId, type: "discard", handNumber: 1, player: "human", role: "dealer", cards: ["5♣", "6♣"], cribOwner: "human", cribAfterDiscard: ["5♣", "6♣"], remainingHand: ["A♣", "2♣", "3♣", "4♣"] },
    { id: "end", at: "2026-09-19T12:02:00Z", gameId, type: "game", action: "end", opponent: model, winner: "ai", finalScores: { human: 100, ai: 121 }, result: "regular" },
  ];
  const discard = events[1];
  events.splice(1, 1, ...Array.from({ length: 38 }, (_, index) => ({ ...discard, id: `discard-${index}`, handNumber: index + 1 })));
  const finished = { ...state, phase: "game_over", scores: events.at(-1).finalScores, analyticsEvents: events };
  let reviewCalls = 0;
  await page.route("**/api/people/me", route => route.fulfill({ json: { profile: {
    username: "qa-player", displayName: "QA Player", online: true, lookingForGame: false, isSelf: true,
    dynamicCalibration: { started: true, completeCycles: 8, minimumCycles: 6, complete: true },
    dynamicHandicap: { wpPerGame: reviewCalls >= 38 ? -0.166 : -0.0913, cycles: 8, cyclesPerGame: 4.516, evaluatorVersion: model },
  } } }));
  let releaseReview;
  const reviewReady = new Promise(resolve => { releaseReview = resolve; });
  await page.route("**/api/game/session/load", route => route.fulfill({ json: { session: { gameId, snapshot, state } } }));
  await page.route("**/api/game/action", route => route.fulfill({ json: { snapshot: { ...snapshot, phase: "game_over" }, state: finished } }));
  await page.route("**/api/game/review", async route => {
    reviewCalls += 1;
    await reviewReady;
    const completed = reviewCalls - (retryOnce ? 1 : 0);
    const reviewed = events.map((event, index) => event.type === "discard" && index <= completed ? { ...event, review: {
      model, selected: event.cards, recommended: ["A♣", "2♣"], selectedEv: 0, recommendedEv: 1,
      delta: 1, selectedWinProbability: 0.4, recommendedWinProbability: 0.45, winProbabilityDelta: 0.05,
    } } : event);
    await delay(40);
    return route.fulfill({ json: { snapshot: { ...snapshot, phase: "game_over" }, state: { ...finished, analyticsEvents: reviewed }, handicapUpdated: completed === 38 } });
  });
  try {
    await page.goto(`${baseUrl}/?pathwayView=play`, { waitUntil: "networkidle" });
    await page.locator('[data-pathway-destination="master"]').click();
    await page.locator("#game-over-close").click();
    const report = page.locator("#single-game-report");
    const analyze = report.getByRole("button", { name: "Analyze with Ace", exact: true });
    await expect(analyze).toBeVisible();
    if (!analyticsWritable) {
      await expect(report).toContainText("vs Ace");
      await expect(report).toContainText("38 QA Player decisions still need Ace analysis");
    }
    await analyze.click();
    await expect(report.locator(".decision-review-progress progress")).toBeVisible({ timeout: 1500 });
    await expect(report).toContainText("Analyzed 0 of 38");
    releaseReview();
    if (retryOnce) {
      await expect(page.locator("#server-busy-alert")).toBeVisible();
      await expect(report).toContainText("38 QA Player decisions still need Ace analysis");
      await page.locator("#server-busy-retry").click();
      await expect(report.locator(".decision-review-progress progress")).toBeVisible();
    }
    await expect.poll(() => reviewCalls, { timeout: 12000 }).toBe(38 + (retryOnce ? 1 : 0));
    if (analyticsWritable) {
      await expect.poll(() => page.evaluate(() => {
        const events = JSON.parse(localStorage.getItem("strong-cribbage.analytics.v1:user-1")).events;
        return events.filter(event => event.type === "discard" && event.review).length;
      })).toBe(38);
    }
    await expect(report.locator(".decision-review-analyze")).toHaveText("Analysis complete", { timeout: 3000 });
    await expect(report.locator(".decision-review-analyze")).toBeDisabled();
    await expect(report.locator(".decision-review-item")).toHaveCount(38);
    await expect(report).not.toContainText("still need Ace analysis");
    await expect(page.locator("#auth-account-profile .player-handicap")).toHaveText("(16.60)");
    return { reviewCalls, analyticsWritable, retryOnce, updatedReport: true };
  } finally {
    releaseReview();
    await page.close();
  }
}

async function testAccountGameIsolation(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await installStaticBuild(page);
  const users = Object.fromEntries(["Test", "Garrett"].map((name, index) => [name, { id: index + 1, username: name, displayName: name, email: `${name.toLowerCase()}@example.test` }]));
  let signedIn = users.Test;
  await installPathwayFixture(page, users.Test);
  const events = ["Test", "Garrett"].flatMap(name => [
    { id: `${name}-start`, at: "2026-09-21T12:00:00Z", gameId: `${name}-game`, type: "game", action: "start", opponent: "schell_table-peg_table-13.23", sessionTag: name, tags: [name] },
    { id: `${name}-end`, at: "2026-09-21T12:20:00Z", gameId: `${name}-game`, type: "game", action: "end", opponent: "schell_table-peg_table-13.23", winner: "ai", finalScores: { human: name === "Test" ? 100 : 110, ai: 121 }, result: "regular", sessionTag: name, tags: [name] },
  ]);
  const fixture = acePeggingFixture();
  await page.addInitScript(({ events, fixture }) => {
    if (localStorage.getItem("legacy-seeded")) return;
    localStorage.setItem("legacy-seeded", "true");
    localStorage.setItem("strong-cribbage.analytics.v1", JSON.stringify({ version: 1, events }));
    localStorage.setItem("strong-cribbage.game.v1", JSON.stringify({ snapshot: { ...fixture.snapshot, gameId: "Test-game", phase: "game_over" }, state: { ...fixture.state, phase: "game_over", analyticsEvents: events.filter(event => event.gameId === "Test-game") } }));
    localStorage.setItem("strong-cribbage.playerFirstName.v1", "Test");
  }, { events, fixture });
  await page.route("**/api/auth/session", route => route.fulfill({ json: { authenticated: Boolean(signedIn), user: signedIn } }));
  await page.route("**/api/auth/logout", route => {
    signedIn = null;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/auth/login", route => {
    signedIn = Object.values(users).find(user => user.email === route.request().postDataJSON().email);
    return route.fulfill({ json: { authenticated: true, user: signedIn } });
  });
  await page.route("**/api/game/history", route => route.fulfill({ json: { events: events.filter(event => event.sessionTag === (signedIn?.id === 1 ? "Test" : signedIn?.id === 2 ? "Garrett" : "")) } }));
  await page.route("**/api/people/me", route => route.fulfill({ json: { profile: { ...signedIn, online: true, lookingForGame: false, isSelf: true } } }));
  const uploads = [];
  await page.route("**/api/games", route => {
    uploads.push({ account: signedIn?.id === 1 ? "Test" : "Garrett", ...route.request().postDataJSON() });
    return route.fulfill({ json: { ok: true, updated: false } });
  });
  try {
    await page.goto(`${baseUrl}/?pathwayView=statistics`, { waitUntil: "networkidle" });
    for (const name of ["Test", "Garrett", "Test"]) {
      if (signedIn?.username !== name) {
        await page.locator("#people-presence-toggle").click();
        await page.locator("#auth-logout").click();
        await page.locator("#auth-email").fill(users[name].email);
        await page.locator("#auth-password").fill("test-password");
        await page.locator("#auth-password-submit").click();
        await page.locator('body[data-auth="signed-in"]').waitFor();
        await page.goto(`${baseUrl}/?pathwayView=statistics`, { waitUntil: "networkidle" });
      }
      await page.locator('[data-stats-view="game-log"]').click();
      await expect(page.locator("#game-log-list .game-log-item")).toHaveCount(1);
      await expect(page.locator("#game-log-list")).toContainText(name === "Test" ? "100-121" : "110-121");
      await expect(page.locator("#game-over-alert")).not.toBeVisible();
    }
    if (uploads.some(upload => upload.gameId !== `${upload.account}-game`)) throw new Error("Another account's game was uploaded.");
    // A rename keeps the immutable namespace, even with no server history response.
    await page.route("**/api/game/history", route => route.fulfill({ json: { events: [] } }));
    signedIn = { ...users.Test, username: "Renamed Test", displayName: "Renamed Test" };
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-stats-view="game-log"]').click();
    await expect(page.locator("#game-log-list .game-log-item")).toHaveCount(1);
    await expect(page.locator("#game-log-list")).toContainText("100-121");
    // A different account taking the old username cannot inherit that namespace.
    signedIn = { ...users.Test, id: 99 };
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-stats-view="game-log"]').click();
    await expect(page.locator("#game-log-list .game-log-item")).toHaveCount(0);
    const legacy = await page.evaluate(() => JSON.parse(localStorage.getItem("strong-cribbage.analytics.v1")));
    if (legacy.events.length !== 4) throw new Error("Legacy history was deleted.");
    return { logoutLoginRoundTrip: true, renamedAccountsIsolated: true, isolatedHistory: true, isolatedUploads: true };
  } finally {
    await page.close();
  }
}

async function testRestoredHumanHistory(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await installStaticBuild(page);
  await installPathwayFixture(page);
  const gameId = "shared-human-game";
  const events = [
    { id: `${gameId}-start`, at: "2026-09-21T12:00:00Z", gameId, type: "game", action: "start", opponent: "human", players: { human: "QA Player", ai: "Kurt" } },
    { id: `${gameId}-end`, at: "2026-09-21T12:20:00Z", gameId, type: "game", action: "end", opponent: "human", winner: "ai", finalScores: { human: 100, ai: 121 }, result: "regular" },
  ];
  let uploads = 0;
  await page.route("**/api/game/history", route => route.fulfill({ json: { events } }));
  await page.route("**/api/games", route => {
    uploads += 1;
    return route.fulfill({ json: { ok: true, updated: false } });
  });
  try {
    await page.goto(`${baseUrl}/?pathwayView=statistics`, { waitUntil: "networkidle" });
    await page.locator('[data-stats-view="game-log"]').click();
    await expect(page.locator("#game-log-list .game-log-item")).toHaveCount(1);
    await page.waitForFunction(() => localStorage.getItem("strong-cribbage.serverUploadBackfill.v2:user-1") !== null);
    if (uploads) throw new Error("Restoring a human game re-uploaded a participant's perspective.");
    return { restoredHumanReport: true, uploads };
  } finally {
    await page.close();
  }
}

async function main() {
  if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error("Missing dist/index.html; run npm run build first.");
  }
  const browserType = process.env.BROWSER_ENGINE === "webkit" ? webkit : chromium;
  const browser = await browserType.launch({ headless: true });
  try {
    const baseUrl = "https://strong-cribbage.test";
    if (process.argv.includes("--dynamic-calibration")) {
      console.log(JSON.stringify([await testDynamicCalibrationPresentation(browser, baseUrl, true), await testDynamicCalibrationPresentation(browser, baseUrl, false)]));
      return;
    }
    if (process.argv.includes("--first-cut")) {
      for (const mode of ["timing", "touch", "history", "slow", "keyboard"]) console.log(JSON.stringify(await testFirstDealerCutTap(browser, baseUrl, mode)));
      return;
    }
    if (process.argv.includes("--account-isolation")) {
      console.log(JSON.stringify([await testAccountGameIsolation(browser, baseUrl), await testRestoredHumanHistory(browser, baseUrl)]));
      return;
    }
    if (process.argv.includes("--ace-waiting")) {
      for (const dealer of ["User", "AI"]) {
        console.log(JSON.stringify(await testAceOpeningPlayThrobber(browser, baseUrl, dealer)));
      }
      return;
    }
    if (process.argv.includes("--postgame-analysis")) {
      console.log(JSON.stringify([await testPostgameAceAnalysis(browser, baseUrl), await testPostgameAceAnalysis(browser, baseUrl, false), await testPostgameAceAnalysis(browser, baseUrl, true, true)]));
      return;
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await installStaticBuild(page);
    const user = { id: 1, username: "qa-player", displayName: "QA Player", email: "qa@example.test" };
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
    const dynamicCalibration = [await testDynamicCalibrationPresentation(browser, baseUrl, true), await testDynamicCalibrationPresentation(browser, baseUrl, false)];
    const firstDealerCut = [];
    for (const mode of ["timing", "touch", "history", "slow", "keyboard"]) firstDealerCut.push(await testFirstDealerCutTap(browser, baseUrl, mode));
    const accountIsolation = await testAccountGameIsolation(browser, baseUrl);
    const restoredHumanHistory = await testRestoredHumanHistory(browser, baseUrl);
    const postgameAnalysis = [await testPostgameAceAnalysis(browser, baseUrl), await testPostgameAceAnalysis(browser, baseUrl, false), await testPostgameAceAnalysis(browser, baseUrl, true, true)];
    const aceOpeningPlays = [];
    for (const dealer of ["User", "AI"]) {
      for (const motion of ["no-preference", "reduce"]) {
        aceOpeningPlays.push(await testAceOpeningPlayThrobber(browser, baseUrl, dealer, motion));
      }
    }
    const puttingTogether = [await testPuttingTogetherDiscards(browser, baseUrl)];
    for (const card of ["5c", "Qc", "Kd"]) puttingTogether.push(await testPuttingTogetherDiscards(browser, baseUrl, card, "reduce"));
    const peggingAnimations = await testTrainingPeggingAnimations(browser, baseUrl);
    const discardIntro = await testDiscardIntroDemonstration(browser, baseUrl);
    const trainingFeedback = await testTrainingFeedbackBackground(browser, baseUrl);
    const pathwayNavigation = await testPathwayParentNavigation(browser, baseUrl);
    const leaderboardInfo = await testLeaderboardTourneyInfoTap(browser, baseUrl);
    const leaderboardBackfill = await testIndexedDbLeaderboardBackfill(browser, baseUrl);
    const blockedIndexedDb = await testBlockedIndexedDbLeavesBackfillPending(browser, baseUrl);
    const people = await testPeopleInteractions(browser, baseUrl);
    const engagement = await testEngagementDashboard(browser, baseUrl);
    console.log(JSON.stringify({ authenticationRecovery: state, dynamicCalibration, firstDealerCut, accountIsolation, restoredHumanHistory, postgameAnalysis, aceOpeningPlays, puttingTogether, peggingAnimations, discardIntro, trainingFeedback, pathwayNavigation, leaderboardInfo, leaderboardBackfill, blockedIndexedDb, people, engagement }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
