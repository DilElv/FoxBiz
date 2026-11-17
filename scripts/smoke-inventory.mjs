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
const tenantId = randomUUID(), slug = `inventory-ui-${tenantId}`, password = randomBytes(18).toString('hex');
const browser = await chromium.launch({ channel: 'chromium' });
const reports = [];
await mkdir('docs/screenshots', { recursive: true });

async function resetStock(mainId, branchId, productId) {
  await prisma.stockDocumentItem.deleteMany({ where: { tenantId } });
  await prisma.stockDocument.deleteMany({ where: { tenantId } });
  await prisma.stockMovement.deleteMany({ where: { tenantId } });
  await prisma.stockBalance.deleteMany({ where: { tenantId } });
  await prisma.stockBalance.createMany({ data: [
    { tenantId, outletId: mainId, productId, quantity: '10', openedAt: new Date() },
    { tenantId, outletId: branchId, productId, quantity: '0', openedAt: new Date() },
  ] });
}

try {
  await prisma.tenant.create({ data: { id: tenantId, slug, name: 'FoxBiz Inventory Verification' } });
  const managerRole = await prisma.role.create({ data: { tenantId, name: 'Inventory Manager', code: 'manager', permissions: ['catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold', 'inventory.adjust', 'inventory.receive', 'inventory.transfer.send', 'inventory.transfer.receive'] } });
  const viewerRole = await prisma.role.create({ data: { tenantId, name: 'Stock Viewer', code: 'viewer', permissions: ['inventory.read'] } });
  const noAccessRole = await prisma.role.create({ data: { tenantId, name: 'No Access', code: 'none', permissions: [] } });
  const passwordHash = await hash(password, 12);
  const manager = await prisma.user.create({ data: { tenantId, email: 'manager@test.local', name: 'Manajer Verifikasi', passwordHash, roleId: managerRole.id, allOutlets: true } });
  await prisma.user.createMany({ data: [
    { tenantId, email: 'viewer@test.local', name: 'Viewer Stok', passwordHash, roleId: viewerRole.id, allOutlets: true },
    { tenantId, email: 'none@test.local', name: 'Tanpa Akses', passwordHash, roleId: noAccessRole.id, allOutlets: true },
  ] });
  const main = await prisma.outlet.create({ data: { tenantId, name: 'Toko Utama', code: 'MAIN', address: 'Jalan Verifikasi 1' } });
  const branch = await prisma.outlet.create({ data: { tenantId, name: 'Cabang Selatan', code: 'BRANCH', address: 'Jalan Verifikasi 2' } });
  const product = await prisma.product.create({ data: { tenantId, sku: 'INV-COFFEE', barcode: '899000222', name: 'Kopi Verifikasi', sellingPrice: '18000', unit: 'pcs' } });

  async function login(page, email) {
    await page.goto(`${base}/login`);
    await page.getByLabel('Kode bisnis').fill(slug);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await page.waitForURL(base + '/');
  }

  async function switchOutlet(page, outletId, mobile) {
    if (!mobile) {
      await page.getByLabel('Outlet aktif').selectOption(outletId);
    } else {
      await page.getByRole('button', { name: 'Buka profil' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Pilih outlet profil').selectOption(outletId);
      await dialog.getByRole('button', { name: 'Tutup dialog' }).click();
      await expect(dialog).toBeHidden();
    }
    await expect(page.getByRole('heading', { name: 'Inventori', exact: true })).toBeVisible();
  }

  async function addLine(dialog, productId, quantity) {
    await dialog.getByLabel('Pilih produk').selectOption(productId);
    await dialog.getByLabel('Kuantitas produk').fill(quantity);
    await dialog.getByRole('button', { name: 'Tambah baris' }).click();
  }

  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 1024, height: 768 }, { name: 'mobile390', width: 390, height: 844 }, { name: 'mobile360', width: 360, height: 800 }]) {
    console.log(`Verifying inventory ${viewport.name}...`);
    await resetStock(main.id, branch.id, product.id);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [], overflow = {};
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) errors.push(message.text()); });
    const check = async (name) => { overflow[name] = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); expect(overflow[name], name).toBe(false); };
    await login(page, manager.email);
    await page.goto(`${base}/inventory`);
    await expect(page.getByRole('heading', { name: 'Inventori', exact: true })).toBeVisible();
    const balanceTable = page.getByRole('table', { name: 'Saldo stok per outlet' });
    const documentTable = page.getByRole('table', { name: 'Dokumen stok' });
    const movementTable = page.getByRole('table', { name: 'Riwayat mutasi stok' });
    await expect(balanceTable).toContainText('Kopi Verifikasi');
    await expect(balanceTable).toContainText('10 pcs');
    await check('balances');

    await page.getByRole('button', { name: 'Penyesuaian', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await addLine(dialog, product.id, '-2');
    await dialog.getByLabel('Alasan dokumen').fill('Koreksi stok opname otomatis');
    await dialog.getByLabel('Referensi eksternal').fill('OPNAME-UI');
    await dialog.getByRole('button', { name: 'Catat penyesuaian' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Dokumen penyesuaian berhasil dicatat.')).toBeVisible();
    await expect(balanceTable).toContainText('8 pcs');
    await expect(documentTable).toContainText('Penyesuaian');

    await page.getByRole('button', { name: 'Penerimaan', exact: true }).click();
    dialog = page.getByRole('dialog');
    await addLine(dialog, product.id, '5');
    await dialog.getByLabel('Alasan dokumen').fill('Penerimaan barang verifikasi');
    await dialog.getByRole('button', { name: 'Catat penerimaan' }).click();
    await expect(dialog).toBeHidden();
    await expect(balanceTable).toContainText('13 pcs');

    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Outlet tujuan').selectOption(branch.id);
    await addLine(dialog, product.id, '3');
    await dialog.getByLabel('Alasan dokumen').fill('Kirim ke cabang verifikasi');
    await dialog.getByRole('button', { name: 'Kirim transfer' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Transfer berhasil dikirim dan menunggu penerimaan outlet tujuan.')).toBeVisible();
    await expect(balanceTable).toContainText('10 pcs');
    await expect(documentTable).toContainText('Dikirim');
    await check('transfer');
    await page.screenshot({ path: `docs/screenshots/inventory-transfer-${viewport.name}.png`, fullPage: true });

    await switchOutlet(page, branch.id, viewport.width < 640);
    await expect(balanceTable).toContainText('0 pcs');
    await expect(documentTable).toContainText('Perlu diterima');
    await page.getByRole('button', { name: 'Terima', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Konfirmasi transfer masuk');
    await dialog.getByRole('button', { name: 'Konfirmasi penerimaan' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Transfer masuk telah dikonfirmasi dan stok tujuan diperbarui.')).toBeVisible();
    await expect(balanceTable).toContainText('3 pcs');
    await expect(documentTable).toContainText('Diterima');
    await check('received');
    await page.screenshot({ path: `docs/screenshots/inventory-received-${viewport.name}.png`, fullPage: true });

    await switchOutlet(page, main.id, viewport.width < 640);
    await expect(balanceTable).toContainText('10 pcs');
    await expect(movementTable).toContainText('Penyesuaian');
    await expect(movementTable).toContainText('Penerimaan');
    await expect(movementTable).toContainText('Transfer keluar');

    const before = await prisma.stockDocument.count({ where: { tenantId } });
    let responseDropped;
    const dropped = new Promise((resolve, reject) => { responseDropped = { resolve, reject }; });
    await page.route('**/api/v1/inventory/documents', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      try { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); responseDropped.resolve(); }
      catch (error) { responseDropped.reject(error); }
    }, { times: 1 });
    await page.getByRole('button', { name: 'Penerimaan', exact: true }).click();
    dialog = page.getByRole('dialog');
    await addLine(dialog, product.id, '1');
    await dialog.getByLabel('Alasan dokumen').fill('Uji respons penerimaan hilang');
    await dialog.getByRole('button', { name: 'Catat penerimaan' }).click();
    await dropped;
    expect(await prisma.stockDocument.count({ where: { tenantId } })).toBe(before + 1);
    await expect(dialog.getByText('Dokumen penerimaan belum terkonfirmasi')).toBeVisible();
    await check('pending');
    await page.screenshot({ path: `docs/screenshots/inventory-pending-${viewport.name}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Periksa status', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Dokumen penerimaan berhasil dicatat.')).toBeVisible();
    expect(await prisma.stockDocument.count({ where: { tenantId } })).toBe(before + 1);
    await expect(balanceTable).toContainText('11 pcs');
    expect(errors).toEqual([]);
    reports.push({ viewport: viewport.name, adjustment: true, receiving: true, transferSend: true, transferReceive: true, lostResponseRecovery: true, movementHistory: true, mobileOutletSwitch: viewport.width < 640, overflow, errors });
    await context.close();
  }

  const viewerContext = await browser.newContext(); const viewerPage = await viewerContext.newPage(); await login(viewerPage, 'viewer@test.local'); await viewerPage.goto(`${base}/inventory`);
  await expect(viewerPage.getByRole('table', { name: 'Saldo stok per outlet' })).toBeVisible();
  await expect(viewerPage.getByRole('button', { name: 'Penyesuaian', exact: true })).toHaveCount(0);
  await expect(viewerPage.getByRole('button', { name: 'Penerimaan', exact: true })).toHaveCount(0);
  await expect(viewerPage.getByRole('button', { name: 'Transfer', exact: true })).toHaveCount(0);
  reports.push({ permissionUI: true, readOnlyViewer: true, documentActionsHidden: true }); await viewerContext.close();
  const noneContext = await browser.newContext(); const nonePage = await noneContext.newPage(); await login(nonePage, 'none@test.local'); await nonePage.goto(`${base}/inventory`);
  await expect(nonePage.getByText('Akses dibatasi')).toBeVisible(); reports.push({ noAccessUI: true }); await noneContext.close();
  const result = { verifiedAt: new Date().toISOString(), reports }; await writeFile('docs/SPRINT_3_UI_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) { await page.screenshot({ path: 'docs/screenshots/inventory-failure.png', fullPage: true }).catch(() => {}); console.error(await page.locator('body').innerText().catch(() => 'Unavailable')); }
  throw error;
} finally {
  await browser.close();
  for (const table of ['session', 'auditLog', 'stockDocumentItem', 'stockDocument', 'stockMovement', 'stockBalance', 'userOutlet', 'product', 'user', 'role', 'outlet']) await prisma[table].deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } }); await prisma.$disconnect();
}
