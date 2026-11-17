import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const base = process.env.WEB_URL ?? 'http://localhost:3000';
const apiBase = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const output = join(process.cwd(), 'docs', 'screenshots');
await mkdir(output, { recursive: true });

const viewports = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-360', width: 360, height: 800 },
];

const healthResponse = await fetch(`${apiBase}/health`);
const health = await healthResponse.json();

const browser = await chromium.launch({ channel: 'chromium' });
const reports = [];
const login = JSON.parse(await readFile('.local/development-login.json', 'utf8'));
let failed = false;

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const signedIn = await context.request.post(`${base}/api/v1/auth/login`, { headers: { Origin: new URL(base).origin }, data: { tenantSlug: login.tenantSlug, email: login.email, password: login.password } });
  if (!signedIn.ok()) throw new Error(`Login failed: ${signedIn.status()}`);
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  const response = await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(
    () => [...document.images]
      .filter((image) => image.src.includes('foxi-mascot.png') && image.getClientRects().length > 0)
      .every((image) => image.complete && image.naturalWidth > 0),
    null,
    { timeout: 10000 },
  ).catch(() => {});
  const screenshotPath = join(output, `dashboard-${viewport.name}.png`);
  await page.screenshot({ path: join(output, `dashboard-${viewport.name}-viewport.png`) });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const metrics = await page.evaluate(() => {
    const accessibleName = (element) =>
      (element.getAttribute('aria-label') ?? element.textContent ?? element.getAttribute('title') ?? '').trim();
    return {
      title: document.title,
      htmlLang: document.documentElement.lang,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      pageWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      hasDemoLabel: document.body.innerText.includes('Data demo'),
      kpiCards: document.querySelectorAll('section[aria-label="Ringkasan bisnis demo"] article').length,
      navLinks: document.querySelectorAll('nav a').length,
      h1: document.querySelector('h1')?.textContent?.trim() ?? null,
      foxiLoaded: [...document.images].filter((image) => image.src.includes('foxi-mascot.png') && image.getClientRects().length > 0).every((image) => image.complete && image.naturalWidth > 0),
      imagesMissingAlt: [...document.images].filter((image) => !image.hasAttribute('alt')).length,
      unnamedInteractive: [...document.querySelectorAll('button, a')].filter((element) => !accessibleName(element)).length,
    };
  });

  const weeklySelection = await page.getByRole('button', { name: 'Minggu ini' }).click()
    .then(() => page.getByText('Rp24.580.000').first().isVisible())
    .catch(() => false);

  let mobileDialog = null;
  if (viewport.width < 768) {
    await page.getByRole('button', { name: 'Lainnya' }).click();
    const opened = await page.getByRole('dialog').isVisible();
    await page.screenshot({ path: join(output, `menu-${viewport.name}.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    mobileDialog = { opened, closedWithEscape: !(await page.getByRole('dialog').isVisible()) };
  }

  await page.goto(`${base}/pos`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(output, `pos-${viewport.name}.png`), fullPage: true });
  const posEntry = await page.getByText('Entry point kasir siap ditinjau').isVisible();

  const status = response?.status() ?? 0;
  const ok =
    status === 200 &&
    metrics.htmlLang === 'id' &&
    !metrics.horizontalOverflow &&
    metrics.hasDemoLabel &&
    metrics.kpiCards === 4 &&
    metrics.foxiLoaded &&
    metrics.imagesMissingAlt === 0 &&
    metrics.unnamedInteractive === 0 &&
    weeklySelection &&
    posEntry &&
    consoleErrors.length === 0 &&
    failedRequests.length === 0;
  if (!ok) failed = true;
  reports.push({
    viewport: viewport.name,
    status,
    ...metrics,
    weeklySelection,
    mobileDialog,
    posEntry,
    consoleErrors,
    failedRequests,
    ok,
    screenshotPath,
  });
  await context.close();
}

await browser.close();
const result = { verifiedAt: new Date().toISOString(), api: { status: healthResponse.status, health }, reports };
await writeFile('docs/UI_SMOKE_RESULTS.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failed) process.exitCode = 1;
