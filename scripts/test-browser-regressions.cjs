#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { chromium, webkit } = require("@playwright/test");

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
  await page.locator('body[data-ready="true"][data-auth="signed-in"]').waitFor({ timeout: 5000 });
  return page;
}

async function installPathwayFixture(page) {
  const user = { username: "qa-player", displayName: "QA Player", email: "qa@example.test" };
  const directory = { onlineCount: 1, players: [], incomingChallenges: [], outgoingChallenges: [], activeTable: null };
  await page.route("**/api/**", async (route) => {
    const apiPath = new URL(route.request().url()).pathname;
    if (apiPath === "/api/auth/session") return route.fulfill({ json: { authenticated: true, user } });
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
    ["gameplay", "settings"],
  ]) {
    page = await readyPathwayPage(browser, baseUrl, route);
    await assertPathwayRoute(page, route);
    const localBack = page.locator(`[data-pathway-view='${route}'] [data-pathway-back]`);
    if (await localBack.isVisible()) await localBack.click();
    else await page.locator("#pathway-header-home").click();
    await assertPathwayRoute(page, parent);
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
  const info = page.getByRole("button", { name: "About Tourney Points per Game" });
  await info.tap();
  await page.waitForTimeout(250);
  const infoState = {
    expanded: await info.getAttribute("aria-expanded"),
    bounds: await info.boundingBox(),
    opacity: await page.locator("#leaderboard-points-help").evaluate(
      (tooltip) => getComputedStyle(tooltip).opacity,
    ),
  };
  const scrollStates = await page.locator(".leaderboard-tabs").evaluateAll((tabLists) => tabLists.map((tabList) => {
    const style = getComputedStyle(tabList);
    tabList.scrollTop = 20;
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollbarWidth: style.scrollbarWidth,
      scrollTop: tabList.scrollTop,
    };
  }));
  const failures = [];
  if (infoState.expanded !== "true" || infoState.opacity !== "1" || !infoState.bounds || infoState.bounds.width < 44 || infoState.bounds.height < 44) {
    failures.push(`info ${JSON.stringify(infoState)}`);
  }
  if (scrollStates.some((state) => state.overflowX !== "auto" || state.overflowY !== "hidden" || state.scrollbarWidth !== "none" || state.scrollTop !== 0)) {
    failures.push(`tab scrolling ${JSON.stringify(scrollStates)}`);
  }
  if (failures.length) {
    throw new Error(`Leaderboard mobile controls failed: ${failures.join("; ")}`);
  }
  await page.close();
  return { touchTapOpensTooltip: true, horizontalScrollOnly: true, scrollbarsHidden: true };
}

async function installLeaderboardBackfillApiFixture(page) {
  const uploads = [];
  const user = { username: "qa-player", displayName: "QA Player", email: "qa@example.test" };
  await page.route("**/api/**", async (route) => {
    const apiPath = new URL(route.request().url()).pathname;
    if (apiPath === "/api/auth/session") return route.fulfill({ json: { authenticated: true, user } });
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
    localStorage.setItem("strong-cribbage.analytics.v1", JSON.stringify({ version: 1, events: [start] }));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("cribbage-game-log", 1);
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
  await page.waitForFunction(() => localStorage.getItem("strong-cribbage.serverUploadBackfill.v2") !== null);
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
    localStorage.setItem("strong-cribbage.analytics.v1", JSON.stringify({ version: 1, events }));
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
  await page.waitForFunction(() => localStorage.getItem("strong-cribbage.serverUploadedGames.v1") !== null);
  const marker = await page.evaluate(() => localStorage.getItem("strong-cribbage.serverUploadBackfill.v2"));
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
  const user = { username: "Garrett", displayName: "Garrett", email: "garrett@example.test", engagementAdmin: true };
  const profile = { ...user, avatarDataUrl: null, online: true, lookingForGame: false, isSelf: true, textSize: "normal" };
  const engagementRequests = [];
  await page.route("**/api/**", async (route) => {
    const apiPath = new URL(route.request().url()).pathname;
    if (apiPath === "/api/auth/session") return route.fulfill({ json: { authenticated: true, user } });
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

async function main() {
  if (!fs.existsSync(path.join(root, "index.html"))) {
    throw new Error("Missing dist/index.html; run npm run build first.");
  }
  const browserType = process.env.BROWSER_ENGINE === "webkit" ? webkit : chromium;
  const browser = await browserType.launch({ headless: true });
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
    const pathwayNavigation = await testPathwayParentNavigation(browser, baseUrl);
    const leaderboardInfo = await testLeaderboardTourneyInfoTap(browser, baseUrl);
    const leaderboardBackfill = await testIndexedDbLeaderboardBackfill(browser, baseUrl);
    const blockedIndexedDb = await testBlockedIndexedDbLeavesBackfillPending(browser, baseUrl);
    const people = await testPeopleInteractions(browser, baseUrl);
    const engagement = await testEngagementDashboard(browser, baseUrl);
    console.log(JSON.stringify({ authenticationRecovery: state, pathwayNavigation, leaderboardInfo, leaderboardBackfill, blockedIndexedDb, people, engagement }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
