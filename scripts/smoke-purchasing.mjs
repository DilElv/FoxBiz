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
const tenantId = randomUUID(), slug = `purchasing-ui-${tenantId}`, password = randomBytes(18).toString('hex');
const browser = await chromium.launch({ channel: 'chromium' }), reports = [];
await mkdir('docs/screenshots', { recursive: true });
try {
  await prisma.tenant.create({ data: { id: tenantId, slug, name: 'FoxBiz Purchasing Verification' } });
  const permissions = ['purchasing.read', 'purchasing.suppliers.write', 'purchasing.orders.write', 'purchasing.orders.order', 'purchasing.orders.cancel', 'purchasing.receive', 'inventory.read'];
  const managerRole = await prisma.role.create({ data: { tenantId, name: 'Purchasing manager', code: 'manager', permissions } });
  const viewerRole = await prisma.role.create({ data: { tenantId, name: 'Viewer', code: 'viewer', permissions: ['purchasing.read'] } });
  const noneRole = await prisma.role.create({ data: { tenantId, name: 'No access', code: 'none', permissions: [] } });
  const receiverRole = await prisma.role.create({ data: { tenantId, name: 'Receiver', code: 'receiver', permissions: ['purchasing.read', 'purchasing.receive'] } });
  const passwordHash = await hash(password, 12);
  await prisma.user.createMany({ data: [{ email: 'manager@test.local', name: 'Manager', roleId: managerRole.id }, { email: 'viewer@test.local', name: 'Viewer', roleId: viewerRole.id }, { email: 'none@test.local', name: 'No access', roleId: noneRole.id }, { email: 'receiver@test.local', name: 'Receiver', roleId: receiverRole.id }].map((entry) => ({ ...entry, tenantId, passwordHash, allOutlets: true })) });
  const main = await prisma.outlet.create({ data: { tenantId, name: 'Toko Utama', code: 'MAIN' } });
  const branch = await prisma.outlet.create({ data: { tenantId, name: 'Cabang Selatan', code: 'BRANCH' } });
  const product = await prisma.product.create({ data: { tenantId, sku: 'BUY-COFFEE', name: 'Kopi Verifikasi', sellingPrice: '18000', unit: 'pcs' } });
  async function login(page, email) {
    await page.goto(`${base}/login`); await page.getByRole('button', { name: 'Gunakan kode bisnis (opsional)' }).click(); await page.locator('input[name=tenantSlug]').fill(slug); await page.getByLabel('Email', { exact: true }).fill(email); await page.locator('input[name=password]').fill(password); await page.getByRole('button', { name: 'Masuk', exact: true }).click(); await page.waitForURL(base + '/');
  }
  async function switchOutlet(page, id, mobile) {
    if (!mobile) await page.getByLabel('Outlet aktif').selectOption(id);
    else { await page.getByRole('button', { name: 'Buka profil' }).click(); const dialog = page.getByRole('dialog'); await dialog.getByLabel('Pilih outlet profil').selectOption(id); await dialog.getByRole('button', { name: 'Tutup dialog' }).click(); await expect(dialog).toBeHidden(); }
  }
  async function newPo(page, supplierId) {
    await page.getByRole('button', { name: 'Buat PO', exact: true }).click(); const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Supplier PO', { exact: true }).selectOption(supplierId); await dialog.getByLabel('Produk PO', { exact: true }).selectOption(product.id);
    await dialog.getByLabel('Jumlah pesanan', { exact: true }).fill('10'); await dialog.getByLabel('Biaya per unit', { exact: true }).fill('12500'); await dialog.getByRole('button', { name: 'Tambah baris' }).click(); await dialog.getByLabel('Catatan PO', { exact: true }).fill('Pesanan verifikasi'); await dialog.getByRole('button', { name: 'Simpan draft' }).click();
  }
  async function receive(page, quantity) {
    await page.getByRole('button', { name: 'Terima barang', exact: true }).click(); const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Jumlah diterima Kopi Verifikasi', { exact: true }).fill(quantity); await dialog.getByLabel('Catatan penerimaan', { exact: true }).fill('Barang diperiksa sesuai fisik'); await dialog.getByLabel('Referensi surat jalan', { exact: true }).fill('SJ-UI'); await dialog.getByRole('button', { name: 'Catat penerimaan', exact: true }).click();
  }
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 1024, height: 768 }, { name: 'mobile390', width: 390, height: 844 }, { name: 'mobile360', width: 360, height: 800 }]) {
    console.log(`Verifying purchasing ${viewport.name}...`);
    for (const table of ['auditLog', 'goodsReceiptItem', 'goodsReceipt', 'purchaseOrderItem', 'purchaseOrder', 'supplier', 'stockDocumentItem', 'stockDocument', 'stockMovement', 'stockBalance']) await prisma[table].deleteMany({ where: { tenantId } });
    const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [], overflow = {};
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) errors.push(message.text()); });
    const check = async (name) => { overflow[name] = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); expect(overflow[name], name).toBe(false); };
    await login(page, 'manager@test.local'); await page.goto(`${base}/purchasing`);
    await expect(page.getByRole('heading', { name: 'Pembelian', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tambah supplier', exact: true }).click();
    let dialog = page.getByRole('dialog'); await dialog.getByLabel('Nama supplier', { exact: true }).fill('Supplier Verifikasi'); await dialog.getByLabel('Kontak supplier', { exact: true }).fill('081234567'); await dialog.getByRole('button', { name: 'Simpan', exact: true }).click(); await expect(dialog).toBeHidden();
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { tenantId } });
    await newPo(page, supplier.id); await expect(page.getByRole('dialog')).toBeHidden();
    const poTable = page.getByRole('table', { name: 'Purchase order', exact: true }); await expect(poTable).toContainText('Draft'); await expect(poTable).toContainText('125.000');
    await page.getByRole('button', { name: 'Ubah draft', exact: true }).click(); dialog = page.getByRole('dialog'); await dialog.getByLabel('Catatan PO', { exact: true }).fill('Draft diperiksa'); await dialog.getByRole('button', { name: 'Simpan draft' }).click(); await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Pesan', exact: true }).click(); dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click(); await expect(dialog).toBeHidden(); await expect(poTable).toContainText('Dipesan');
    await receive(page, '4'); await expect(page.getByRole('dialog')).toBeHidden(); await expect(poTable).toContainText('Diterima sebagian');
    await check('partial'); await page.screenshot({ path: `docs/screenshots/purchasing-partial-${viewport.name}.png`, fullPage: true });
    const before = await prisma.goodsReceipt.count({ where: { tenantId } });
    let resolveDropped, rejectDropped; const dropped = new Promise((resolve, reject) => { resolveDropped = resolve; rejectDropped = reject; });
    await page.route('**/api/v1/goods-receipts', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      try { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); resolveDropped(); } catch (error) { rejectDropped(error); }
    }, { times: 1 });
    await receive(page, '6'); await dropped; dialog = page.getByRole('dialog'); await expect(dialog.getByText('Dokumen pembelian belum terkonfirmasi')).toBeVisible(); await check('pending'); await page.screenshot({ path: `docs/screenshots/purchasing-pending-${viewport.name}.png`, fullPage: true });
    await page.reload(); await expect(page.getByText('Dokumen pembelian belum terkonfirmasi', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Kirim ulang', exact: true }).click(); await expect(page.getByText('Dokumen pembelian belum terkonfirmasi', { exact: true })).toHaveCount(0);
    await expect(poTable).toContainText('Selesai'); expect(await prisma.goodsReceipt.count({ where: { tenantId } })).toBe(before + 1);
    const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { tenantId_outletId_productId: { tenantId, outletId: main.id, productId: product.id } } }); expect(balance.quantity.toString()).toBe('10');
    expect(await prisma.stockMovement.count({ where: { tenantId, movementType: 'purchase_receipt' } })).toBe(2);
    await page.getByRole('button', { name: 'Rincian', exact: true }).click(); dialog = page.getByRole('dialog'); await expect(dialog.getByRole('table', { name: 'Item PO', exact: true })).toContainText('10'); await expect(dialog).toContainText('SJ-UI'); await check('detail'); await page.screenshot({ path: `docs/screenshots/purchasing-detail-${viewport.name}.png`, fullPage: true }); await dialog.getByRole('button', { name: 'Tutup dialog' }).click();
    await switchOutlet(page, branch.id, viewport.width < 640); await expect(page.getByText('Belum ada PO yang cocok pada outlet ini.')).toBeVisible(); await switchOutlet(page, main.id, viewport.width < 640); await expect(poTable).toContainText('Selesai');
    await newPo(page, supplier.id); await expect(page.getByRole('dialog')).toBeHidden(); await page.getByRole('button', { name: 'Batalkan', exact: true }).click(); dialog = page.getByRole('dialog'); await dialog.getByLabel('Alasan pembatalan', { exact: true }).fill('Pesanan duplikat'); await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click(); await expect(dialog).toBeHidden(); await expect(poTable).toContainText('Dibatalkan');
    await check('complete'); expect(errors).toEqual([]);
    reports.push({ viewport: viewport.name, supplierCreate: true, draftEdit: true, order: true, partialReceipt: true, completeReceipt: true, lostResponseReloadSameKeyRetry: true, singleStockLedger: true, receiptDetail: true, cancellation: true, outletSwitch: true, overflow, errors }); await context.close();
  }
  for (const [email, denied] of [['viewer@test.local', false], ['none@test.local', true], ['receiver@test.local', false]]) {
    const context = await browser.newContext(), page = await context.newPage(); await login(page, email); await page.goto(`${base}/purchasing`);
    if (denied) await expect(page.getByText('Akses dibatasi', { exact: true })).toBeVisible();
    else { await expect(page.getByRole('table', { name: 'Purchase order', exact: true })).toBeVisible(); for (const name of ['Buat PO', 'Tambah supplier', 'Ubah draft', 'Pesan', 'Batalkan']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0); }
    reports.push({ emailRole: email.split('@')[0], denied, permissionUI: true }); await context.close();
  }
  const result = { verifiedAt: new Date().toISOString(), reports }; await writeFile('docs/SPRINT_4_UI_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) { await page.screenshot({ path: 'docs/screenshots/purchasing-failure.png', fullPage: true }).catch(() => {}); console.error(await page.locator('body').innerText().catch(() => 'Unavailable')); }
  throw error;
} finally {
  await browser.close();
  for (const table of ['session', 'auditLog', 'goodsReceiptItem', 'goodsReceipt', 'purchaseOrderItem', 'purchaseOrder', 'supplier', 'stockDocumentItem', 'stockDocument', 'stockMovement', 'stockBalance', 'userOutlet', 'product', 'user', 'role', 'outlet']) await prisma[table].deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } }); await prisma.$disconnect();
}
