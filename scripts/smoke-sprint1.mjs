import { chromium, expect as playwrightExpect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { config } from 'dotenv';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

config({ quiet: true });
const expect = playwrightExpect.configure({ timeout: 20000 });
const base = process.env.WEB_URL ?? 'http://localhost:3000';
const readiness = await fetch(`${process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1'}/health`, { signal: AbortSignal.timeout(15000) });
if (!readiness.ok || (await readiness.json()).database !== 'connected') throw new Error(`Web/API/database readiness failed (${readiness.status}). Start both services before running this smoke test.`);
const fixtureDatabaseUrl = new URL(process.env.DATABASE_URL);
if (!fixtureDatabaseUrl.searchParams.has('connect_timeout')) fixtureDatabaseUrl.searchParams.set('connect_timeout', '20');
const prisma = new PrismaClient({ datasourceUrl: fixtureDatabaseUrl.toString(), errorFormat: 'minimal' });
await prisma.$connect();
const tenantId = randomUUID(), slug = `ui-${tenantId}`, password = randomBytes(18).toString('hex');
const permissions = ['organization.read', 'organization.write', 'users.read', 'users.write', 'roles.read', 'roles.write', 'catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold', 'audit.read', 'pos.read'];
const browser = await chromium.launch({ channel: 'chromium' });
const reports = [];
await mkdir('docs/screenshots', { recursive: true });
try {
  await prisma.tenant.create({ data: { id: tenantId, slug, name: 'FoxBiz UI Verification' } });
  const ownerRole = await prisma.role.create({ data: { tenantId, name: 'Business Owner', code: 'owner', permissions } });
  const cashierRole = await prisma.role.create({ data: { tenantId, name: 'Cashier', code: 'cashier', permissions: ['catalog.read', 'inventory.read', 'pos.read'] } });
  const passwordHash = await hash(password, 12);
  await prisma.user.create({ data: { tenantId, email: 'owner@test.local', name: 'Owner Verification', passwordHash, roleId: ownerRole.id, allOutlets: true } });
  const outlet = await prisma.outlet.create({ data: { tenantId, name: 'Toko Utama', code: 'MAIN' } });
  const otherOutlet = await prisma.outlet.create({ data: { tenantId, name: 'Cabang Selatan', code: 'BRANCH' } });
  const cashier = await prisma.user.create({ data: { tenantId, email: 'cashier@test.local', name: 'Cashier Verification', passwordHash, roleId: cashierRole.id } });
  await prisma.userOutlet.create({ data: { tenantId, userId: cashier.id, outletId: outlet.id } });
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 1024, height: 768 }, { name: 'mobile390', width: 390, height: 844 }, { name: 'mobile360', width: 360, height: 800 }]) {
    console.log(`Verifying ${viewport.name} (${viewport.width}x${viewport.height})...`);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(); const errors = [];
    const overflowByPage = {};
    const checkOverflow = async (name) => {
      overflowByPage[name] = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      expect(overflowByPage[name], `${name} overflows at ${viewport.width}px`).toBe(false);
    };
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(`${base}/login`); await expect(page.getByRole('heading', { name: 'Masuk ke FoxBiz' })).toBeVisible();
    await checkOverflow('login');
    await page.screenshot({ path: `docs/screenshots/sprint1-login-${viewport.name}.png`, fullPage: true });
    await page.getByLabel('Kode bisnis').fill(slug); await page.getByLabel('Email', { exact: true }).fill('owner@test.local'); await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click(); await page.waitForURL(base + '/');
    await page.goto(`${base}/products`); await expect(page.getByRole('heading', { name: 'Produk & Kategori' })).toBeVisible();
    await page.getByRole('button', { name: 'Tambah produk', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nama produk').fill(`Kopi ${viewport.name}`); await dialog.getByLabel('SKU', { exact: true }).fill(`UI-${viewport.name.toUpperCase()}`); await dialog.getByLabel('Harga jual (Rp)').fill('18000.50');
    await dialog.getByRole('button', { name: 'Simpan', exact: true }).click(); await expect(dialog).toBeHidden();
    await expect(page.getByText(`Kopi ${viewport.name}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ has: page.getByText(`Kopi ${viewport.name}`, { exact: true }) })).toContainText('18.000,5');
    await checkOverflow('products');
    await page.screenshot({ path: `docs/screenshots/sprint1-products-${viewport.name}.png`, fullPage: true });
    await page.goto(`${base}/inventory`); await expect(page.getByRole('heading', { name: 'Inventori', exact: true })).toBeVisible();
    await page.getByLabel('Cari stok').fill(`UI-${viewport.name.toUpperCase()}`);
    await expect(page.getByText(`Kopi ${viewport.name}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Saldo awal', exact: true }).click();
    await dialog.getByLabel('Jumlah saldo awal').fill('10.125'); await dialog.getByLabel('Catatan', { exact: true }).fill('UI verification');
    await dialog.getByRole('button', { name: 'Simpan', exact: true }).click(); await expect(dialog).toBeHidden();
    await expect(page.getByText('10.125 pcs', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Batas minimum', exact: true }).click(); await dialog.getByLabel('Batas minimum', { exact: true }).fill('20'); await dialog.getByRole('button', { name: 'Simpan', exact: true }).click(); await expect(dialog).toBeHidden();
    await expect(page.getByText('Stok rendah', { exact: true })).toBeVisible();
    await page.screenshot({ path: `docs/screenshots/sprint1-inventory-${viewport.name}.png`, fullPage: true });
    await checkOverflow('inventory');
    await page.getByRole('button', { name: 'Buka profil', exact: true }).click();
    const currentOutletId = await dialog.getByLabel('Pilih outlet profil').inputValue();
    await dialog.getByLabel('Pilih outlet profil').selectOption(currentOutletId === outlet.id ? otherOutlet.id : outlet.id); await page.keyboard.press('Escape');
    await expect(page.getByRole('row').filter({ has: page.getByText(`Kopi ${viewport.name}`, { exact: true }) }).getByText('0 pcs', { exact: true })).toBeVisible();
    await page.goto(`${base}/settings`); await expect(page.getByRole('heading', { name: 'Profil bisnis' })).toBeVisible();
    await page.getByRole('button', { name: 'Pengguna', exact: true }).click(); await expect(page.getByText('Owner Verification', { exact: true })).toBeVisible();
    if (viewport.name === 'desktop') {
      await page.getByRole('button', { name: 'Tambah pengguna', exact: true }).click();
      await dialog.getByLabel('Nama', { exact: true }).fill('New Team Member'); await dialog.getByLabel('Email', { exact: true }).fill('new@test.local'); await dialog.getByLabel('Password', { exact: true }).fill(password);
      await dialog.getByLabel('Role', { exact: true }).selectOption(cashierRole.id); await dialog.getByRole('checkbox', { name: 'Toko Utama', exact: true }).check();
      await dialog.getByRole('button', { name: 'Simpan', exact: true }).click(); await expect(dialog).toBeHidden(); await expect(page.getByText('New Team Member', { exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Role & izin', exact: true }).click(); await expect(page.getByText('Business Owner', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Audit aktivitas', exact: true }).click(); await expect(page.getByText('inventory.opening', { exact: true }).first()).toBeVisible();
    await checkOverflow('settings');
    await page.screenshot({ path: `docs/screenshots/sprint1-settings-${viewport.name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Buka profil', exact: true }).click(); await dialog.getByRole('button', { name: 'Keluar', exact: true }).click(); await page.waitForURL(`${base}/login`);
    expect(errors).toEqual([]); reports.push({ viewport: viewport.name, width: viewport.width, height: viewport.height, login: true, productCreate: true, opening: true, threshold: true, outletSwitch: true, settings: true, userCreate: viewport.name === 'desktop', logout: true, overflowByPage, errors }); await context.close();
  }
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto(`${base}/products`); await page.waitForURL(`${base}/login`);
  await page.getByLabel('Kode bisnis').fill(slug); await page.getByLabel('Email', { exact: true }).fill('cashier@test.local'); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Masuk', exact: true }).click(); await page.waitForURL(base + '/');
  await page.goto(`${base}/products`); await expect(page.getByRole('heading', { name: 'Produk & Kategori' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Tambah produk', exact: true })).toHaveCount(0);
  await page.goto(`${base}/settings`); await expect(page.getByRole('heading', { name: 'Akses dibatasi' })).toBeVisible();
  reports.push({ permissionUI: true, protectedRedirect: true }); await context.close();
  const result = { verifiedAt: new Date().toISOString(), reports };
  await writeFile('docs/SPRINT_1_UI_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: 'docs/screenshots/sprint1-failure.png', fullPage: true }).catch(() => {});
    console.error('Failure page:', await page.locator('main').innerText().catch(() => 'Page unavailable'));
  }
  throw error;
} finally {
  await browser.close();
  for (const table of ['session', 'auditLog', 'stockMovement', 'stockBalance', 'userOutlet', 'product', 'category', 'user', 'role', 'outlet']) await prisma[table].deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } }); await prisma.$disconnect();
}
