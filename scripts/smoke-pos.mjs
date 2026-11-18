import { chromium, expect as playwrightExpect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { config } from 'dotenv';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

config({ quiet: true });
const expect = playwrightExpect.configure({ timeout: 25000 });
const base = process.env.WEB_URL ?? 'http://localhost:3000';
const prisma = new PrismaClient({ errorFormat: 'minimal' });
const tenantId = randomUUID(), slug = `pos-ui-${tenantId}`, password = randomBytes(18).toString('hex');
const browser = await chromium.launch({ channel: 'chromium' });
const reports = [];
await mkdir('docs/screenshots', { recursive: true });
try {
  await prisma.tenant.create({ data: { id: tenantId, slug, name: 'FoxBiz POS Verification' } });
  const role = await prisma.role.create({ data: { tenantId, name: 'Cashier', code: 'cashier', permissions: ['pos.read', 'pos.checkout', 'pos.edc.confirm', 'pos.hold'] } });
  const readRole = await prisma.role.create({ data: { tenantId, name: 'Viewer', code: 'viewer', permissions: ['pos.read'] } });
  const passwordHash = await hash(password, 12);
  const user = await prisma.user.create({ data: { tenantId, email: 'cashier@test.local', name: 'Kasir Verifikasi', passwordHash, roleId: role.id, allOutlets: true } });
  await prisma.user.create({ data: { tenantId, email: 'viewer@test.local', name: 'Viewer', passwordHash, roleId: readRole.id, allOutlets: true } });
  const outlet = await prisma.outlet.create({ data: { tenantId, name: 'Toko Utama', code: 'MAIN', address: 'Jalan Verifikasi 1' } });
  const category = await prisma.category.create({ data: { tenantId, name: 'Minuman' } });
  const emptyCategory = await prisma.category.create({ data: { tenantId, name: 'Makanan' } });
  const product = await prisma.product.create({ data: { tenantId, categoryId: category.id, sku: 'POS-COFFEE', barcode: '899000111', name: 'Kopi Susu', sellingPrice: '18000.50' } });
  const customer = await prisma.customer.create({ data: { tenantId, name: 'Pelanggan Verifikasi', phone: '081234567890' } });
  await prisma.stockBalance.create({ data: { tenantId, outletId: outlet.id, productId: product.id, quantity: '100', openedAt: new Date() } });
  async function login(page, email = user.email) {
    page.setDefaultNavigationTimeout(60000);
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: 'Gunakan kode bisnis (opsional)' }).click();
    await page.locator('input[name=tenantSlug]').fill(slug); await page.getByLabel('Email', { exact: true }).fill(email); await page.locator('input[name=password]').fill(password);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click(); await page.waitForURL(base + '/');
    await page.goto(`${base}/pos`); await expect(page.getByRole('heading', { name: 'Point of Sale', exact: true })).toBeVisible();
  }
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 1024, height: 768 }, { name: 'mobile390', width: 390, height: 844 }, { name: 'mobile360', width: 360, height: 800 }]) {
    console.log(`Verifying POS ${viewport.name}...`);
    const context = await browser.newContext({ viewport }); const page = await context.newPage(); const errors = [], overflow = {};
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) errors.push(message.text()); });
    const check = async (name) => { overflow[name] = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); expect(overflow[name], name).toBe(false); };
    await login(page);
    await page.getByRole('group', { name: 'Filter kategori POS' }).getByRole('button', { name: emptyCategory.name, exact: true }).click();
    await expect(page.getByText('Tidak ada produk aktif yang cocok.')).toBeVisible();
    await page.getByRole('group', { name: 'Filter kategori POS' }).getByRole('button', { name: category.name, exact: true }).click();
    await page.getByLabel('Cari produk POS').fill('899000111');
    await page.getByRole('button', { name: 'Tambah Kopi Susu', exact: true }).click();
    await page.getByLabel('Kuantitas Kopi Susu').fill('1.125');
    await page.getByRole('button', { name: 'Tambah satu Kopi Susu', exact: true }).click();
    await expect(page.getByLabel('Kuantitas Kopi Susu')).toHaveValue('2.125');
    await page.getByRole('button', { name: 'Kurangi Kopi Susu', exact: true }).click();
    await expect(page.getByLabel('Kuantitas Kopi Susu')).toHaveValue('1.125');
    await page.getByRole('button', { name: 'Pilih pelanggan', exact: true }).click();
    await page.getByLabel('Cari pelanggan POS').fill(customer.phone);
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(customer.name) }).click();
    await expect(page.getByTestId('pos-customer')).toContainText(customer.name);
    await check('cart'); await page.screenshot({ path: `docs/screenshots/pos-cart-${viewport.name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Tahan keranjang', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nama keranjang').fill(`Pesanan ${viewport.name}`); await dialog.getByRole('button', { name: 'Simpan hold' }).click(); await expect(dialog).toBeHidden();
    await expect(page.getByText(`Pesanan ${viewport.name}`, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Lanjutkan', exact: true }).click(); await expect(page.getByLabel('Kuantitas Kopi Susu')).toHaveValue('1.125');
    await expect(page.getByTestId('pos-customer')).toContainText(customer.name);
    await page.getByRole('button', { name: 'Tinjau pembayaran', exact: true }).click();
    await expect(dialog).toContainText('20.250,56'); await dialog.getByLabel('Uang diterima (Rp)').fill('25000');
    await check('cash'); await page.screenshot({ path: `docs/screenshots/pos-cash-${viewport.name}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Catat pembayaran' }).click(); await expect(page.locator('#foxbiz-receipt')).toBeVisible();
    await expect(page.locator('#foxbiz-receipt')).toContainText('4.749,44'); await check('receipt');
    await expect(page.locator('#foxbiz-receipt')).toContainText(`Pelanggan: ${customer.name}`);
    await page.screenshot({ path: `docs/screenshots/pos-receipt-${viewport.name}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Cetak struk' }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: 'Cetak struk' })).toBeInViewport();
    if (viewport.name === 'desktop') {
      await page.emulateMedia({ media: 'print' });
      await expect(page.getByRole('heading', { name: 'Point of Sale', exact: true })).toBeHidden();
      await expect(dialog.getByRole('button', { name: 'Cetak struk' })).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await page.screenshot({ path: 'docs/screenshots/pos-print-desktop.png', fullPage: true });
      await page.pdf({ path: 'docs/screenshots/pos-receipt.pdf', printBackground: true });
      await page.emulateMedia({ media: 'screen' });
    }
    await dialog.getByRole('button', { name: 'Tutup dialog' }).click();
    await page.getByRole('button', { name: 'Riwayat & struk' }).click(); await dialog.getByRole('button', { name: 'Buka struk' }).first().click();
    await expect(page.locator('#foxbiz-receipt')).toContainText('SALINAN / CETAK ULANG'); await dialog.getByRole('button', { name: 'Tutup dialog' }).click();
    await page.getByRole('button', { name: 'Tambah Kopi Susu', exact: true }).click(); await page.getByRole('button', { name: 'Tinjau pembayaran', exact: true }).click();
    await dialog.getByLabel('Metode pembayaran').selectOption('edc'); await expect(dialog.getByRole('button', { name: 'Catat pembayaran' })).toBeDisabled();
    await dialog.getByRole('checkbox').check(); await check('edc'); await page.screenshot({ path: `docs/screenshots/pos-edc-${viewport.name}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Catat pembayaran' }).click(); await expect(page.locator('#foxbiz-receipt')).toContainText('EDC dikonfirmasi manual');
    await dialog.getByRole('button', { name: 'Tutup dialog' }).click();
    // Drop the response after the server committed, then reload the page and recover.
    let responseDropped;
    const dropped = new Promise((resolve, reject) => { responseDropped = { resolve, reject }; });
    await page.route('**/api/v1/sales', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      try { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); responseDropped.resolve(); }
      catch (error) { responseDropped.reject(error); }
    }, { times: 1 });
    await page.getByRole('button', { name: 'Tambah Kopi Susu', exact: true }).click(); await page.getByRole('button', { name: 'Tinjau pembayaran', exact: true }).click();
    await dialog.getByLabel('Uang diterima (Rp)').fill('20000'); await dialog.getByRole('button', { name: 'Catat pembayaran' }).click();
    await dropped;
    expect(await prisma.sale.count({ where: { tenantId } })).toBe((reports.length + 1) * 3);
    await expect(page.getByRole('heading', { name: 'Periksa status pembayaran' })).toBeVisible();
    await page.reload(); await expect(page.getByRole('heading', { name: 'Periksa status pembayaran' })).toBeVisible();
    await page.getByRole('button', { name: 'Periksa status', exact: true }).click(); await expect(page.locator('#foxbiz-receipt')).toBeVisible();
    expect(await prisma.sale.count({ where: { tenantId } })).toBe((reports.length + 1) * 3);
    expect(errors).toEqual([]);
    reports.push({ viewport: viewport.name, categoryFilter: true, barcodeSearch: true, quantityButtons: true, customerSelection: true, customerHoldReceipt: true, cash: true, manualEdc: true, holdResume: true, historyReprint: true, lostResponseRecovery: true, overflow, errors }); await context.close();
  }
  const context = await browser.newContext(); const page = await context.newPage(); await login(page, 'viewer@test.local');
  await expect(page.getByRole('button', { name: 'Tinjau pembayaran' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Tahan keranjang', exact: true })).toHaveCount(0);
  reports.push({ permissionUI: true }); await context.close();
  const result = { verifiedAt: new Date().toISOString(), reports }; await writeFile(process.env.POS_RESULTS_PATH ?? 'docs/SPRINT_8_POS_UI_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) { await page.screenshot({ path: 'docs/screenshots/pos-failure.png', fullPage: true }).catch(() => {}); console.error(await page.locator('body').innerText().catch(() => 'Unavailable')); }
  throw error;
} finally {
  await browser.close();
  for (const table of ['session', 'auditLog', 'payment', 'saleItem', 'sale', 'heldCart', 'customer', 'stockMovement', 'stockBalance', 'userOutlet', 'product', 'category', 'user', 'role', 'outlet']) await prisma[table].deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } }); await prisma.$disconnect();
}
