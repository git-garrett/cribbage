// Post-deployment check. The private credential file is never printed or uploaded.
const { webkit, chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const origin = 'https://workbench.strongcribbage.com';
let passwordForRedaction = '';

async function verify() {
  if (!process.argv[2]) throw new Error('Usage: node verify-browser.cjs PRIVATE_ACCESS_JSON');
  let account;
  try {
    account = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  } catch {
    throw new Error('Could not read valid private credential JSON.');
  }
  assert.equal(typeof account.username, 'string');
  assert.equal(typeof account.password, 'string');
  passwordForRedaction = account.password;
  for (const engine of [webkit, chromium]) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      let challenges = 0;
      page.on('response', response => {
        if (response.status() === 401 || response.headers()['www-authenticate']) challenges += 1;
      });
      await page.goto(origin, { waitUntil: 'networkidle', timeout: 15000 });
      assert.equal(new URL(page.url()).pathname, '/login');
      assert.equal(await page.title(), 'Sign in');
      assert(!/workbench|cribbage|benchmark|gpu/i.test(await page.locator('body').innerText()));
      await page.getByLabel('Username').fill(account.username);
      await page.getByLabel('Password', { exact: true }).fill('deliberately-wrong');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Check your username and password' }).waitFor();
      await page.getByLabel('Username').fill(account.username);
      await page.getByLabel('Password', { exact: true }).fill(account.password);
      const start = Date.now();
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(origin + '/', { waitUntil: 'networkidle', timeout: 15000 });
      await page.locator('#connection').filter({ hasText: 'Live' }).waitFor({ timeout: 15000 });
      const seconds = (Date.now() - start) / 1000;
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(new URL(page.url()).pathname, '/');
      const cookie = (await context.cookies()).find(value => value.name === '__Host-access');
      assert(cookie && cookie.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
      assert.equal(challenges, 0);
      assert(seconds < 10, 'Sign-in took more than ten seconds');
      console.log(`${engine.name()}: form, wrong/correct password, live content, refresh and secure session passed (${seconds.toFixed(2)}s)`);
    } finally {
      await browser.close();
    }
  }
}
verify().catch(error => {
  const message = passwordForRedaction ? error.message.split(passwordForRedaction).join('<redacted>') : error.message;
  console.error(message);
  process.exitCode = 1;
});
