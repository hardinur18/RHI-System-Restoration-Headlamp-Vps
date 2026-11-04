import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

// Requires an SSH SOCKS proxy to the dedicated VPS and private temporary users
// from deploy/smoke-staging.py. Never run against the production hostname.
const base = 'https://rhi.polesheadlamp.id';
const fixtures = JSON.parse(fs.readFileSync('.migration-local/smoke-fixtures.json', 'utf8'));
assert.equal(fixtures.length, 7);
assert.ok(fixtures.every(x => x.email.startsWith('rhi-migration-') && x.email.endsWith('@example.invalid')));
const scenarios = [
  ['Owner', '/users', 'Pengguna'],
  ['Super Admin', '/orders', 'Order'],
  ['Admin PIC', '/schedule', 'Jadwal'],
  ['CS', '/leads', 'Prospek'],
  ['Teknisi', '/technician/mobile', 'Jadwal'],
  ['Finance', '/finance/operational-expenses', 'Biaya Operasional'],
  ['Advertiser', '/ads/daily', 'Iklan'],
];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--proxy-server=socks5://127.0.0.1:19080', '--disable-background-networking'],
});
const selectedRoles = process.env.RHI_SMOKE_ROLES?.split(',');
const reportPath = '.migration-local/browser-smoke.json';
const results = selectedRoles && fs.existsSync(reportPath)
  ? JSON.parse(fs.readFileSync(reportPath, 'utf8')).filter(x => !selectedRoles.includes(x.role)) : [];
try {
  for (const [role, path, expected] of scenarios) {
    if (selectedRoles && !selectedRoles.includes(role)) continue;
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const unexpectedHosts = new Set();
    const serverErrors = [];
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol) ||
          ['rhi.polesheadlamp.id', 'api-rhi.polesheadlamp.id', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname) ||
          (url.hostname === 'upload.wikimedia.org' && request.resourceType() === 'image')) {
        void request.continue();
      } else {
        unexpectedHosts.add(url.hostname);
        void request.abort();
      }
    });
    page.on('response', response => {
      if (response.status() >= 500) {
        const url = new URL(response.url());
        serverErrors.push({ host: url.hostname, path: url.pathname, status: response.status() });
      }
    });
    try {
      const account = fixtures.find(x => x.role === role);
      await page.goto(base + '/login/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#email');
      await page.type('#email', account.email);
      await page.type('#password', account.password);
      await page.click('button[type="submit"]');
      await page.waitForFunction(() => !document.querySelector('#password'), { timeout: 90_000 });
      await page.goto(base + path, { waitUntil: 'networkidle2', timeout: 90_000 });
      await page.waitForFunction(text => document.body?.innerText.toLowerCase().includes(text.toLowerCase()), {}, expected);
      assert.ok(!await page.$('#password'), 'Returned to login');
      assert.equal(new URL(page.url()).pathname.replace(/\/$/, ''), path.replace(/\/$/, ''), 'Unexpected redirect');
      assert.equal(unexpectedHosts.size, 0, 'Unexpected network destination');
      assert.equal(serverErrors.length, 0, 'Server error during navigation');
      results.push({ role, path, passed: true });
      console.log('PASS browser login/navigation:', role, path);
    } catch (error) {
      results.push({ role, path, passed: false, error: error.message,
        unexpectedHosts: [...unexpectedHosts], serverErrors });
      console.log('FAIL browser login/navigation:', role, path, error.message);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), { mode: 0o600 });
}
assert.ok(results.length === scenarios.length && results.every(x => x.passed), 'Some browser checks failed');
