import { chromium, expect as playwrightExpect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

config({ quiet: true });
const expect = playwrightExpect.configure({ timeout: 30000 });
const base = process.env.WEB_URL ?? 'http://localhost:3000';
const prisma = new PrismaClient({ errorFormat: 'minimal' });
const browser = await chromium.launch({ channel: 'chromium' });
const prefix = `signup-ui-${randomUUID()}`, password = 'signup-ui-password-123';
const reports = [];
await mkdir('docs/screenshots', { recursive: true });
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile360', width: 360, height: 800 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(), errors = [];
    page.setDefaultNavigationTimeout(60000);
    page.on('pageerror', (error) => errors.push(error.message));
    const email = `${viewport.name}@${prefix}.test`, slug = `${prefix}-${viewport.name}`;
    const checkOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await page.goto(`${base}/login`);
    await expect(page.locator('input[name=tenantSlug]')).toHaveCount(0);
    await checkOverflow(); await page.screenshot({ path: `docs/screenshots/sprint8-login-${viewport.name}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Daftarkan bisnis', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Daftarkan bisnis Anda' })).toBeVisible();
    await page.locator('input[name=name]').fill('Owner Verifikasi');
    await page.locator('input[name=email]').fill(email);
    await page.locator('input[name=password]').fill(password);
    await page.getByRole('button', { name: 'Tampilkan password' }).click();
    await expect(page.locator('input[name=password]')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Sembunyikan password' }).click();
    await page.locator('input[name=confirmPassword]').fill('different-password');
    await page.locator('input[name=businessName]').fill('Bisnis Verifikasi');
    await expect(page.locator('input[name=tenantSlug]')).toHaveValue('bisnis-verifikasi');
    await page.locator('input[name=tenantSlug]').fill(slug);
    await page.locator('input[name=outletName]').fill('Outlet Pusat');
    await page.locator('input[name=outletCode]').fill('PUSAT');
    await page.getByRole('button', { name: 'Daftar & mulai kelola bisnis' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Konfirmasi password belum sama.' })).toBeVisible();
    await page.locator('input[name=confirmPassword]').fill(password);
    await checkOverflow(); await page.screenshot({ path: `docs/screenshots/sprint8-register-${viewport.name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Daftar & mulai kelola bisnis' }).click();
    await page.waitForURL(base + '/');
    await expect(page.getByRole('heading', { name: /Owner Verifikasi/ })).toBeVisible();
    const me = await (await context.request.get(`${base}/api/v1/me`)).json();
    const tenantId = me.user.tenantId;
    expect(await prisma.product.count({ where: { tenantId } })).toBe(0);
    await page.goto(`${base}/settings`);
    await page.getByRole('button', { name: 'Tambah outlet', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nama outlet', { exact: true }).fill('Outlet Cabang');
    await dialog.getByLabel('Kode outlet', { exact: true }).fill('CABANG-02');
    await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel('Outlet aktif').getByRole('option')).toHaveCount(2);
    const options = await page.getByLabel('Outlet aktif').locator('option').allTextContents();
    expect(options.some((text) => text.includes('CABANG-02'))).toBe(true);
    await page.getByLabel('Outlet aktif').selectOption({ label: options.find((text) => text.includes('CABANG-02')) });
    await page.goto(`${base}/pos`);
    await expect(page.getByRole('heading', { name: 'Point of Sale', exact: true })).toBeVisible();
    await expect(page.getByText('Tidak ada produk aktif yang cocok.')).toBeVisible();
    await checkOverflow(); await page.screenshot({ path: `docs/screenshots/sprint8-empty-pos-${viewport.name}.png`, fullPage: true });
    await context.request.post(`${base}/api/v1/auth/logout`, { headers: { Origin: new URL(base).origin }, data: {} });
    await page.goto(`${base}/login`);
    await page.locator('input[name=email]').fill(email);
    await page.locator('input[name=password]').fill(password);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await page.waitForURL(base + '/');
    await expect(page.getByRole('heading', { name: /Owner Verifikasi/ })).toBeVisible();
    expect(errors).toEqual([]);
    reports.push({ viewport: viewport.name, registration: true, passwordConfirmation: true, emailLogin: true, emptyBusiness: true, outletRefresh: true, outletSwitch: true, errors });
    await context.close();
  }
  const result = { verifiedAt: new Date().toISOString(), reports };
  await writeFile('docs/SPRINT_8_AUTH_UI_RESULTS.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: '.local/sprint8-auth-failure.png', fullPage: true }).catch(() => {});
    console.error(await page.locator('body').innerText().catch(() => 'Unavailable'));
  }
  throw error;
} finally {
  await browser.close();
  const tenants = await prisma.tenant.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } });
  const tenantId = { in: tenants.map((tenant) => tenant.id) };
  for (const model of ['session', 'auditLog', 'userOutlet', 'user', 'role', 'outlet']) await prisma[model].deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } }); await prisma.$disconnect();
}
