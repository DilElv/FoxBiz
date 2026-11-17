import { chromium, expect as playwrightExpect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { config } from 'dotenv';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
config({ quiet: true });
const expect = playwrightExpect.configure({ timeout: 30000 });
const base = process.env.WEB_URL ?? 'http://localhost:3000';
const prisma = new PrismaClient({ errorFormat: 'minimal' });
const tenantId = randomUUID(), slug = `finance-ui-${tenantId}`, password = randomBytes(18).toString('hex');
const browser = await chromium.launch({ channel: 'chromium' }), reports = [];
await mkdir('docs/screenshots', { recursive: true });
try {
  await prisma.tenant.create({ data: { id: tenantId, slug, name: 'FoxBiz Finance Verification' } });
  const passwordHash = await hash(password, 12);
  for (const [code, permissions] of [['manager', ['finance.read', 'finance.entries.write', 'finance.void']], ['viewer', ['finance.read']], ['writer', ['finance.read', 'finance.entries.write']], ['voider', ['finance.read', 'finance.void']], ['none', []]]) {
    const role = await prisma.role.create({ data: { tenantId, name: code, code, permissions } });
    await prisma.user.create({ data: { tenantId, name: code, email: `${code}@test.local`, passwordHash, roleId: role.id, allOutlets: true } });
  }
  const main = await prisma.outlet.create({ data: { tenantId, name: 'Toko Utama', code: 'MAIN' } });
  const branch = await prisma.outlet.create({ data: { tenantId, name: 'Cabang Selatan', code: 'BRANCH' } });
  async function login(page, role = 'manager') {
    await page.goto(`${base}/login`); await page.getByLabel('Kode bisnis').fill(slug); await page.getByLabel('Email', { exact: true }).fill(`${role}@test.local`); await page.getByLabel('Password', { exact: true }).fill(password);
    const response = page.waitForResponse((res) => res.url().endsWith('/api/v1/auth/login') && res.request().method() === 'POST', { timeout: 60000 });
    await page.getByRole('button', { name: 'Masuk', exact: true }).click(); expect((await response).status()).toBe(201);
    await page.waitForURL(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  async function switchOutlet(page, id, mobile) {
    if (!mobile) await page.getByLabel('Outlet aktif').selectOption(id);
    else { await page.getByRole('button', { name: 'Buka profil' }).click(); const dialog = page.getByRole('dialog'); await dialog.getByLabel('Pilih outlet profil').selectOption(id); await dialog.getByRole('button', { name: 'Tutup dialog' }).click(); await expect(dialog).toBeHidden(); }
  }
  async function fillEntry(page, kind, amount, note) {
    await page.getByRole('button', { name: 'Catat kas', exact: true }).click(); const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Jenis kas', { exact: true }).selectOption(kind);
    await dialog.getByLabel('Nominal kas', { exact: true }).fill(amount); await dialog.getByLabel('Catatan kas', { exact: true }).fill(note);
  }
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 1024, height: 768 }, { name: 'mobile390', width: 390, height: 844 }, { name: 'mobile360', width: 360, height: 800 }]) {
    console.log(`Verifying finance ${viewport.name}...`);
    await prisma.$transaction([prisma.auditLog.deleteMany({ where: { tenantId } }), prisma.financeEntry.deleteMany({ where: { tenantId } })]);
    const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [], overflow = {};
    page.setDefaultNavigationTimeout(60000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) errors.push(message.text()); });
    const check = async (name) => { overflow[name] = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); expect(overflow[name], name).toBe(false); };
    await login(page); await page.goto(`${base}/finance`);
    await expect(page.getByRole('heading', { name: 'Keuangan', exact: true })).toBeVisible();
    await expect(page.getByText('Belum ada entri kas yang cocok pada outlet dan periode ini.')).toBeVisible();
    await fillEntry(page, 'income', '250000.10', 'Setoran modal verifikasi');
    await check('form'); await page.screenshot({ path: `docs/screenshots/finance-form-${viewport.name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Simpan kas', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('manualIncome')).toContainText('250.000,1');
    await fillEntry(page, 'expense', '50000.05', 'Biaya operasional verifikasi'); await page.getByRole('button', { name: 'Simpan kas', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('netCash')).toContainText('200.000,05');
    const before = await prisma.financeEntry.count({ where: { tenantId } });
    let resolveDropped, rejectDropped; const dropped = new Promise((resolve, reject) => { resolveDropped = resolve; rejectDropped = reject; });
    await page.route('**/api/v1/finance/entries', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      try { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); resolveDropped(); } catch (error) { rejectDropped(error); }
    }, { times: 1 });
    await fillEntry(page, 'expense', '10000', 'Transport verifikasi'); await page.getByRole('button', { name: 'Simpan kas', exact: true }).click(); await dropped;
    await expect(page.getByText('Entri kas belum terkonfirmasi', { exact: true })).toBeVisible(); await expect(page.getByText('Entri mungkin sudah tersimpan', { exact: false })).toBeVisible(); await check('pending'); await page.screenshot({ path: `docs/screenshots/finance-pending-${viewport.name}.png`, fullPage: true });
    await page.reload(); await expect(page.getByText('Entri kas belum terkonfirmasi', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Kirim ulang', exact: true }).click(); await expect(page.getByText('Entri kas belum terkonfirmasi', { exact: true })).toHaveCount(0);
    expect(await prisma.financeEntry.count({ where: { tenantId } })).toBe(before + 1);
    const recovered = await prisma.financeEntry.findFirstOrThrow({ where: { tenantId, note: 'Transport verifikasi' } });
    expect(await prisma.auditLog.count({ where: { tenantId, entityId: recovered.id, action: 'finance_entry.create' } })).toBe(1);
    await expect(page.getByTestId('netCash')).toContainText('190.000,05');
    const table = page.getByRole('table', { name: 'Entri kas manual', exact: true });
    await table.getByRole('row').filter({ hasText: 'Transport verifikasi' }).getByRole('button', { name: 'Void', exact: true }).click();
    let dialog = page.getByRole('dialog'); await dialog.getByLabel('Alasan void', { exact: true }).fill('Entri duplikat verifikasi'); await dialog.getByRole('button', { name: 'Konfirmasi void', exact: true }).click(); await expect(dialog).toBeHidden();
    await expect(page.getByTestId('netCash')).toContainText('200.000,05'); await expect(table).toContainText('Entri duplikat verifikasi');
    await page.getByLabel('Filter status entri', { exact: true }).selectOption('voided'); await expect(table.getByRole('row')).toHaveCount(2);
    await page.getByLabel('Filter status entri', { exact: true }).selectOption(''); await page.getByLabel('Filter jenis entri', { exact: true }).selectOption('income'); await expect(table.getByRole('row')).toHaveCount(2);
    await page.getByLabel('Filter jenis entri', { exact: true }).selectOption(''); await expect(table.getByRole('row')).toHaveCount(4);
    // Invalid period produces an explicit error; retry retains the chosen valid period afterwards.
    const from = await page.getByLabel('Dari tanggal', { exact: true }).inputValue(), to = await page.getByLabel('Sampai tanggal', { exact: true }).inputValue();
    await page.getByLabel('Dari tanggal', { exact: true }).fill('2020-01-01'); await page.getByRole('button', { name: 'Terapkan periode', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'maksimal 366 hari' })).toBeVisible();
    await page.getByLabel('Dari tanggal', { exact: true }).fill(from); await page.getByRole('button', { name: 'Terapkan periode', exact: true }).click(); await expect(table).toBeVisible();
    // Deliberate HTTP 400 is expected and is excluded from browser console failures.
    const unexpected = errors.filter((message) => !message.includes('400 (Bad Request)')); expect(unexpected).toEqual([]);
    await check('report'); await page.screenshot({ path: `docs/screenshots/finance-report-${viewport.name}.png`, fullPage: true });
    await switchOutlet(page, branch.id, viewport.width < 640); await expect(page.getByText('Belum ada entri kas yang cocok pada outlet dan periode ini.')).toBeVisible(); await expect(page.getByTestId('netCash')).toContainText('0');
    await switchOutlet(page, main.id, viewport.width < 640); await expect(table).toContainText('Setoran modal verifikasi');
    await page.getByLabel('Dari tanggal', { exact: true }).fill('2026-01-01'); await page.getByLabel('Sampai tanggal', { exact: true }).fill('2026-01-02'); await page.getByRole('button', { name: 'Terapkan periode', exact: true }).click(); await expect(page.getByText('Belum ada entri kas yang cocok pada outlet dan periode ini.')).toBeVisible(); await expect(page.getByTestId('netCash')).toContainText('0');
    await page.getByLabel('Dari tanggal', { exact: true }).fill(from); await page.getByLabel('Sampai tanggal', { exact: true }).fill(to); await page.getByRole('button', { name: 'Terapkan periode', exact: true }).click(); await expect(table).toContainText('Setoran modal verifikasi');
    const finalErrors = errors.filter((message) => !message.includes('400 (Bad Request)')); expect(finalErrors).toEqual([]);
    await check('complete'); reports.push({ viewport: viewport.name, incomeExpense: true, decimalSummary: true, lostResponseReloadSameKeyRetry: true, singleEntryAudit: true, void: true, filters: true, invalidPeriod: true, emptyPeriod: true, outletSwitch: true, overflow, errors: finalErrors }); await context.close();
  }
  for (const role of ['viewer', 'writer', 'voider', 'none']) {
    const context = await browser.newContext(), page = await context.newPage(); page.setDefaultNavigationTimeout(60000); await login(page, role); await page.goto(`${base}/finance`);
    if (role === 'none') await expect(page.getByText('Akses dibatasi', { exact: true })).toBeVisible();
    else {
      await expect(page.getByRole('table', { name: 'Entri kas manual', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Catat kas', exact: true })).toHaveCount(role === 'writer' ? 1 : 0);
      if (role !== 'voider') await expect(page.getByRole('button', { name: 'Void', exact: true })).toHaveCount(0);
      else await expect(page.getByRole('button', { name: 'Void', exact: true }).first()).toBeVisible();
    }
    reports.push({ role, permissionUI: true }); await context.close();
  }
  const result = { verifiedAt: new Date().toISOString(), reports }; await writeFile('docs/SPRINT_5_UI_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) { await page.screenshot({ path: 'docs/screenshots/finance-failure.png', fullPage: true }).catch(() => {}); console.error(await page.locator('body').innerText().catch(() => 'Unavailable')); }
  throw error;
} finally {
  await browser.close();
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { tenantId } }); await tx.auditLog.deleteMany({ where: { tenantId } }); await tx.financeEntry.deleteMany({ where: { tenantId } }); await tx.userOutlet.deleteMany({ where: { tenantId } }); await tx.user.deleteMany({ where: { tenantId } }); await tx.role.deleteMany({ where: { tenantId } }); await tx.outlet.deleteMany({ where: { tenantId } }); await tx.tenant.deleteMany({ where: { id: tenantId } });
  });
  const remainingTenants = await prisma.tenant.count({ where: { id: tenantId } });
  await writeFile('docs/SPRINT_5_CLEANUP_RESULTS.json', JSON.stringify({ verifiedAt: new Date().toISOString(), smokeTenantId: tenantId, remainingTenants, transactionCleanup: remainingTenants === 0 }, null, 2));
  await prisma.$disconnect();
}
