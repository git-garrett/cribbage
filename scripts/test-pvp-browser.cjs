#!/usr/bin/env node
// Exercise the built client with responses produced by the real PvP API tests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium, webkit, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cribbage-pvp-browser-'));
const base = 'https://strong-cribbage.test';
const clone = (value) => JSON.parse(JSON.stringify(value));

async function prepare(page, seat, read, act, subscribe) {
  await page.route(`${base}/**`, async (route) => {
    const requested = new URL(route.request().url()).pathname;
    const target = path.resolve(root, 'dist', requested === '/' ? 'index.html' : requested.slice(1));
    if (!target.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(target)) return route.abort();
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg' };
    return route.fulfill({ path: target, contentType: mime[path.extname(target)] || 'application/octet-stream' });
  });
  const players = ['Garrett', 'Kurt'].map((name) => ({ username: name, displayName: name, email: `${name}@example.test`, online: true, lookingForGame: false, avatarDataUrl: null }));
  const table = { id: 't', phase: read().state.phase === 'game_over' ? 'complete' : 'playing', viewerSeat: seat === 0 ? 'challenger' : 'challenged', challenger: players[0], challenged: players[1], challengerCut: null, challengedCut: null, dealerUsername: 'Garrett' };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()).pathname;
    const data = route.request().postDataJSON() || {};
    if (url === '/api/auth/session') return route.fulfill({ json: { authenticated: true, user: players[seat] } });
    if (url === '/api/people/me') return route.fulfill({ json: { profile: { ...players[seat], isSelf: true } } });
    if (url === '/api/people/presence' || url === '/api/people/online') return route.fulfill({ json: { players, onlineCount: 2, incomingChallenges: [], outgoingChallenges: [], activeTable: table } });
    if (url === '/api/people/table') return route.fulfill({ json: { table } });
    if (url === '/api/people/table/game') return route.fulfill({ json: read() });
    if (url === '/api/people/table/game/action') {
      assert.equal(data.payload.handNumber, read().state.handNumber);
      assert.equal(data.payload.phase, read().state.phase);
      const response = act(data);
      response.acknowledgment = { actionId: data.actionId, appliedRevision: response.revision, alreadyApplied: false };
      return route.fulfill({ json: response });
    }
    if (url === '/api/people/table/game/watch') {
      if (read().revision <= data.afterRevision) await new Promise((resolve) => subscribe(resolve));
      return route.fulfill({ json: read() }).catch(() => {});
    }
    if (url.endsWith('/watch')) return route.abort();
    return route.fulfill({ json: {} });
  });
  await page.goto(`${base}/?table=t`, { waitUntil: 'domcontentloaded' });
  await page.locator('body[data-ready="true"][data-auth="signed-in"]').waitFor();
  await expect(page.locator('main.app')).toBeVisible();
}

async function count(page) {
  await expect(page.locator('#skip-counting')).toBeVisible();
  await page.locator('#skip-counting').click();
  await expect(page.locator('#continue-scoring')).toBeVisible();
  await expect(page.locator('#continue-scoring')).toHaveText('Next');
  await page.locator('#continue-scoring').click();
}

async function testReviews(browser, fixture, viewport, label) {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  let revision = 0;
  const positions = [-1, -1];
  const watchers = [];
  const errors = [];
  const read = (seat) => {
    let response = positions.every((position) => position === 3)
      ? seat === 0 ? fixture.next : fixture.slow[3]
      : positions[seat] < 0 ? seat === 0 ? fixture.initial : fixture.otherInitial
        : (seat === 0 ? fixture.fast : fixture.slow)[positions[seat]];
    response = clone(response);
    response.revision = revision;
    response.snapshot.analyticsCounter = revision;
    return response;
  };
  const publish = () => watchers.splice(0).forEach((resolve) => resolve());
  for (const seat of [0, 1]) {
    pages[seat].on('pageerror', (error) => errors.push(error.message));
    await prepare(pages[seat], seat, () => read(seat), (data) => {
      assert.equal(data.action, 'continue-scoring');
      positions[seat] += 1;
      revision += 1;
      const response = read(seat);
      publish();
      return response;
    }, (resolve) => watchers.push(resolve));
  }
  await pages[0].locator('#continue-pegging').click();
  await expect(pages[1].locator('main.app')).toHaveAttribute('data-phase', 'pegging_complete');
  for (let stage = 0; stage < 3; stage += 1) await count(pages[0]);
  await expect(pages[0].locator('#human-waiting-notice')).toHaveText('Waiting for Kurt to review');
  await expect(pages[0].locator('#continue-scoring')).toBeHidden();
  await expect(pages[0].locator('#skip-counting')).toBeHidden();
  await pages[0].reload({ waitUntil: 'domcontentloaded' });
  await expect(pages[0].locator('#human-waiting-notice')).toBeVisible();
  await expect(pages[0].locator('#score-summary-dialog')).toBeHidden();
  await pages[0].screenshot({ path: path.join(fixtureDir, `${label}-review-wait.png`) });
  await pages[1].locator('#continue-pegging').click();
  for (let stage = 0; stage < 3; stage += 1) await count(pages[1]);
  for (const page of pages) {
    await expect(page.locator('main.app')).toHaveAttribute('data-phase', 'discard');
    await expect(page.locator('#human-waiting-notice')).toBeHidden();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  assert.deepEqual(errors, []);
  await Promise.all(contexts.map((context) => context.close()));
  publish();
}

async function testDiscardAndReports(browser, fixture, reports, viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const watchers = [];
  let current = clone(fixture.discard[1]);
  await prepare(page, 0, () => clone(current), () => { throw new Error('Unexpected action'); }, (resolve) => watchers.push(resolve));
  await expect(page.locator('#human-waiting-notice')).toHaveText('Waiting for Kurt to discard');
  await page.screenshot({ path: path.join(fixtureDir, `${label}-discard-wait.png`) });
  current = clone(fixture.discard[2]);
  watchers.splice(0).forEach((resolve) => resolve());
  await expect(page.locator('#human-waiting-notice')).toBeHidden();
  await expect(page.locator('main.app')).toHaveAttribute('data-phase', 'pegging');
  await context.close();
  watchers.splice(0).forEach((resolve) => resolve());
  const values = [];
  for (const seat of [0, 1]) {
    const reportContext = await browser.newContext({ viewport });
    const reportPage = await reportContext.newPage();
    await prepare(reportPage, seat, () => clone(reports[seat]), () => { throw new Error('Unexpected report action'); }, () => {});
    await reportPage.locator('#game-over-close').click();
    const report = reportPage.locator('#single-game-report');
    await expect(report).toBeVisible();
    const rows = [];
    for (const label of ['Avg peg as dealer', 'Avg peg as pone', 'Avg full cycle']) {
      const row = report.locator('tr').filter({ hasText: label });
      await expect(row).toHaveCount(1);
      const cells = await row.locator('td').allTextContents();
      assert.match(cells[0], /^\d+\.\d{2}$/);
      assert.match(cells[1], /^\d+\.\d{2}$/);
      rows.push(cells.slice(0, 2));
    }
    values.push(rows);
    await reportPage.screenshot({ path: path.join(fixtureDir, `${label}-report-${seat}.png`), fullPage: true });
    await reportContext.close();
  }
  assert.deepEqual(values[0], values[1].map(([own, other]) => [other, own]));
}

async function main() {
  execFileSync(path.join(root, 'scripts/run-quiet.sh'), ['PvP API fixtures', 'cargo', 'test', '--manifest-path', path.join(root, 'rust/Cargo.toml'), '-p', 'cribbage-api', 'people::tests'], { cwd: root, env: { ...process.env, CRIBBAGE_PVP_BROWSER_FIXTURES: fixtureDir }, stdio: 'pipe' });
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'counting.json')));
  const reports = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'report.json')));
  for (const [engine, viewport, label] of [[chromium, { width: 1280, height: 900 }, 'desktop'], [webkit, { width: 390, height: 844 }, 'mobile']]) {
    const browser = await engine.launch({ headless: true });
    try {
      await testReviews(browser, fixture, viewport, label);
      await testDiscardAndReports(browser, fixture, reports, viewport, label);
    } finally { await browser.close(); }
  }
  console.log(`PvP browser QA passed: independent reviews, reconnect, waiting bubbles, next deal, and both reports in Chromium and WebKit. Screenshots: ${fixtureDir}`);
}
main().catch((error) => {
  console.error(error.stdout?.toString() || error.stderr?.toString() || error);
  console.error(`QA artifacts: ${fixtureDir}`);
  process.exitCode = 1;
});
