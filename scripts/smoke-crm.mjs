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
const tenantId = randomUUID(), slug = `crm-ui-${tenantId}`, password = randomBytes(18).toString('hex');
const browser = await chromium.launch({ channel: 'chromium' }), reports = [];
await mkdir('docs/screenshots', { recursive: true });
try {
  await prisma.tenant.create({ data: { id: tenantId, slug, name: 'FoxBiz CRM Verification' } });
  const passwordHash = await hash(password, 12);
  const users = {};
  for (const [code, permissions] of [['manager', ['crm.read', 'crm.customers.write', 'pos.read', 'pos.checkout', 'pos.hold']], ['viewer', ['crm.read']], ['cashier', ['pos.read', 'pos.checkout', 'pos.hold']], ['none', []]]) {
    const role = await prisma.role.create({ data: { tenantId, name: code, code, permissions } });
    users[code] = await prisma.user.create({ data: { tenantId, name: code, email: `${code}@test.local`, passwordHash, roleId: role.id, allOutlets: true } });
  }
  const outlet = await prisma.outlet.create({ data: { tenantId, name: 'Toko Utama', code: 'MAIN' } });
  const product = await prisma.product.create({ data: { tenantId, sku: 'CRM-COFFEE', name: 'Kopi CRM', sellingPrice: '18000.50' } });
  await prisma.stockBalance.create({ data: { tenantId, outletId: outlet.id, productId: product.id, quantity: '100', openedAt: new Date() } });
  async function login(page, role = 'manager') {
    page.setDefaultNavigationTimeout(60000);
    await page.goto(`${base}/login`); await page.getByLabel('Kode bisnis').fill(slug); await page.getByLabel('Email', { exact: true }).fill(`${role}@test.local`); await page.getByLabel('Password', { exact: true }).fill(password);
    const response = page.waitForResponse((res) => res.url().endsWith('/api/v1/auth/login') && res.request().method() === 'POST', { timeout: 60000 });
    await page.getByRole('button', { name: 'Masuk', exact: true }).click(); expect((await response).status()).toBe(201);
    await page.waitForURL(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  async function createCustomer(page, name, phone) {
    await page.getByRole('button', { name: 'Tambah pelanggan', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByLabel('Nama pelanggan', { exact: true }).fill(name); await dialog.getByLabel('Nomor telepon pelanggan', { exact: true }).fill(phone);
    await dialog.getByLabel('Email pelanggan', { exact: true }).fill('crm@example.com'); await dialog.getByLabel('Catatan pelanggan', { exact: true }).fill('Kontak verifikasi');
  }
  async function pay(page) {
    await page.getByRole('button', { name: 'Tinjau pembayaran', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByLabel('Uang diterima (Rp)', { exact: true }).fill('20000'); await dialog.getByRole('button', { name: 'Catat pembayaran', exact: true }).click();
  }
  for (const [index, viewport] of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 1024, height: 768 }, { name: 'mobile390', width: 390, height: 844 }, { name: 'mobile360', width: 360, height: 800 }].entries()) {
    console.log(`Verifikasi CRM ${viewport.name}...`);
    const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [], overflow = {};
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) errors.push(message.text()); });
    const check = async (name) => { overflow[name] = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); expect(overflow[name], name).toBe(false); };
    await login(page); await page.goto(`${base}/crm`);
    await expect(page.getByRole('heading', { name: 'CRM Pelanggan', exact: true })).toBeVisible();
    if (!index) await expect(page.getByText('Belum ada pelanggan yang cocok.', { exact: false })).toBeVisible();
    if (!index) {
      for (const [label, days, phone] of [['Perhatian', 60, '081299990001'], ['Tidak Aktif', 120, '081299990002']]) {
        const customer = await prisma.customer.create({ data: { tenantId, name: `Segmen ${label}`, phone } });
        await prisma.sale.create({ data: { tenantId, outletId: outlet.id, cashierId: users.manager.id, customerId: customer.id, receiptNo: `CRM-${randomUUID()}`, idempotencyKey: randomUUID(), requestHash: 'ui-segment-fixture', subtotal: '100', total: '100', receiptSnapshot: {}, createdAt: new Date(Date.now() - days * 86400000) } });
      }
      await page.reload();
      await expect(page.getByTestId('crm-attention')).toHaveText('1'); await expect(page.getByTestId('crm-inactive')).toHaveText('1');
      await page.getByLabel('Filter segmen', { exact: true }).selectOption('attention'); await expect(page.getByRole('table', { name: 'Daftar pelanggan', exact: true })).toContainText('Segmen Perhatian');
      await page.getByLabel('Filter segmen', { exact: true }).selectOption('inactive'); await expect(page.getByRole('table', { name: 'Daftar pelanggan', exact: true })).toContainText('Segmen Tidak Aktif');
      await page.getByLabel('Filter segmen', { exact: true }).selectOption('');
    }
    const name = `Pelanggan ${viewport.name}`, updated = `${name} Baru`, phone = `08123456000${index}`;
    await createCustomer(page, name, phone); await check('form'); await page.screenshot({ path: `docs/screenshots/crm-form-${viewport.name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Simpan pelanggan', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    const table = page.getByRole('table', { name: 'Daftar pelanggan', exact: true });
    await expect(table).toContainText(name);
    await createCustomer(page, 'Duplikat', phone); await page.getByRole('button', { name: 'Simpan pelanggan', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Nomor telepon sudah dipakai'); await page.getByRole('button', { name: 'Tutup dialog', exact: true }).click();
    await table.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Ubah', exact: true }).click(); await page.getByLabel('Nama pelanggan', { exact: true }).fill(updated); await page.getByRole('button', { name: 'Simpan pelanggan', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByLabel('Cari pelanggan', { exact: true }).fill(updated); await expect(table.getByRole('row')).toHaveCount(2);
    await table.getByRole('button', { name: 'Profil', exact: true }).click(); await expect(page.getByText('Belum ada transaksi lunas untuk pelanggan ini', { exact: false })).toBeVisible();
    await check('emptyProfile'); await page.getByRole('button', { name: 'Tutup dialog', exact: true }).click();
    // Close while both profile requests are paused; late responses must not reopen it.
    if (!index) {
      const customer = await prisma.customer.findFirstOrThrow({ where: { tenantId, phone } });
      let release, requested; const gate = new Promise((resolve) => { release = resolve; }), started = new Promise((resolve) => { requested = resolve; });
      await page.route(`**/api/v1/crm/customers/${customer.id}**`, async (route) => { requested(); await gate; await route.continue().catch(() => {}); });
      await table.getByRole('button', { name: 'Profil', exact: true }).click(); await started; await page.getByRole('button', { name: 'Tutup dialog', exact: true }).click(); release();
      await page.unroute(`**/api/v1/crm/customers/${customer.id}**`); await expect(page.getByRole('dialog')).toBeHidden();
    }
    await page.goto(`${base}/pos`); const selector = page.getByTestId('pos-customer');
    await selector.getByRole('button', { name: 'Pilih pelanggan', exact: true }).click(); await expect(page.getByText('Ketik minimal dua karakter', { exact: false })).toBeVisible();
    await page.getByLabel('Cari pelanggan POS', { exact: true }).fill('Tidak ditemukan'); await expect(page.getByText('Tidak ada pelanggan yang cocok.', { exact: true })).toBeVisible();
    await page.getByLabel('Cari pelanggan POS', { exact: true }).fill(updated); await page.getByRole('dialog').getByRole('button').filter({ hasText: updated }).click(); await expect(selector).toContainText(updated);
    await page.reload(); await expect(selector).toContainText(updated);
    await page.getByRole('button', { name: 'Tambah Kopi CRM', exact: true }).click(); await page.getByRole('button', { name: 'Tahan keranjang', exact: true }).click();
    await page.getByLabel('Nama keranjang', { exact: true }).fill(`Hold ${viewport.name}`); await page.getByRole('button', { name: 'Simpan hold', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Lanjutkan', exact: true }).click(); await expect(selector).toContainText(updated); await expect(selector.getByRole('button', { name: 'Ganti', exact: true })).toBeDisabled(); await expect(selector.getByRole('button', { name: 'Hapus', exact: true })).toBeDisabled();
    await check('posHold'); await page.screenshot({ path: `docs/screenshots/crm-pos-hold-${viewport.name}.png`, fullPage: true });
    // Lose a committed checkout response; recovery must retain the customer and one sale.
    let resolveDropped, rejectDropped; const dropped = new Promise((resolve, reject) => { resolveDropped = resolve; rejectDropped = reject; });
    await page.route('**/api/v1/sales', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      try { const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); resolveDropped(); } catch (error) { rejectDropped(error); }
    }, { times: 1 });
    const before = await prisma.sale.count({ where: { tenantId } }); await pay(page); await dropped;
    await expect(page.getByRole('heading', { name: 'Periksa status pembayaran', exact: true })).toBeVisible(); await page.reload(); await page.getByRole('button', { name: 'Kirim ulang aman', exact: true }).click();
    await expect(page.locator('#foxbiz-receipt')).toContainText(`Pelanggan: ${updated}`); await expect(page.locator('#foxbiz-receipt')).not.toContainText(phone); expect(await prisma.sale.count({ where: { tenantId } })).toBe(before + 1);
    await check('receipt'); await page.screenshot({ path: `docs/screenshots/crm-receipt-${viewport.name}.png`, fullPage: true }); await page.getByRole('button', { name: 'Tutup dialog', exact: true }).click();
    await expect(selector).toContainText('Checkout tanpa pelanggan'); await page.getByRole('button', { name: 'Tambah Kopi CRM', exact: true }).click(); await pay(page); await expect(page.locator('#foxbiz-receipt')).toBeVisible(); await expect(page.locator('#foxbiz-receipt')).not.toContainText('Pelanggan:'); await page.getByRole('button', { name: 'Tutup dialog', exact: true }).click();
    await page.goto(`${base}/crm`); await page.getByLabel('Cari pelanggan', { exact: true }).fill(updated); await page.getByLabel('Filter segmen', { exact: true }).selectOption('active'); await expect(table).toContainText(updated);
    await expect(table.getByRole('row')).toHaveCount(2); await table.getByRole('row').filter({ hasText: updated }).getByRole('button', { name: 'Profil', exact: true }).click(); await expect(page.getByRole('table', { name: 'Riwayat transaksi pelanggan', exact: true })).toContainText('18.000,5'); await expect(page.getByRole('dialog')).toContainText('1 transaksi');
    await check('profile'); await page.screenshot({ path: `docs/screenshots/crm-profile-${viewport.name}.png`, fullPage: true }); await page.getByRole('button', { name: 'Tutup dialog', exact: true }).click();
    await page.getByLabel('Filter segmen', { exact: true }).selectOption('never'); await expect(page.getByText('Belum ada pelanggan yang cocok.', { exact: false })).toBeVisible();
    await page.getByLabel('Filter segmen', { exact: true }).selectOption(''); await page.getByLabel('Cari pelanggan', { exact: true }).fill(''); await check('list'); await page.screenshot({ path: `docs/screenshots/crm-list-${viewport.name}.png`, fullPage: true });
    await page.route('**/api/v1/crm/customers?**', (route) => route.abort('failed'), { times: 1 }); await page.getByLabel('Cari pelanggan', { exact: true }).fill('offline'); await expect(page.getByRole('alert').filter({ hasText: 'Tidak dapat memuat data pelanggan' })).toBeVisible(); await page.getByRole('button', { name: 'Coba lagi', exact: true }).click(); await expect(page.getByText('Belum ada pelanggan yang cocok.', { exact: false })).toBeVisible();
    const unexpected = errors.filter((message) => !message.includes('409 (Conflict)')); expect(unexpected).toEqual([]);
    reports.push({ viewport: viewport.name, createEditUniquePhone: true, searchSegmentFilter: true, emptyAndPaidProfile: true, optionalCustomerSelection: true, selectionReload: true, holdResumeCustomerLocked: true, lostResponseCustomerRecoverySingleSale: true, nameOnlyReceipt: true, checkoutWithoutCustomer: true, offlineRetry: true, closedProfileStaysClosed: index === 0 ? true : 'checked on desktop', overflow, errors: unexpected }); await context.close();
  }
  for (const role of ['viewer', 'cashier', 'none']) {
    const context = await browser.newContext(), page = await context.newPage(); await login(page, role); await page.goto(`${base}/crm`);
    if (role === 'viewer') { await expect(page.getByRole('table', { name: 'Daftar pelanggan', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Tambah pelanggan', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Ubah', exact: true })).toHaveCount(0); }
    else await expect(page.getByText('Akses dibatasi', { exact: true })).toBeVisible();
    if (role === 'cashier') { await page.goto(`${base}/pos`); await page.getByRole('button', { name: 'Pilih pelanggan', exact: true }).click(); await page.getByLabel('Cari pelanggan POS', { exact: true }).fill('Pelanggan'); await expect(page.getByRole('dialog').getByRole('button').filter({ hasText: 'Pelanggan desktop Baru' })).toBeVisible(); }
    reports.push({ role, permissionUI: true, cashierLookupWithoutCrmAccess: role === 'cashier' }); await context.close();
  }
  const result = { verifiedAt: new Date().toISOString(), reports }; await writeFile('docs/SPRINT_6_UI_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) { await page.screenshot({ path: 'docs/screenshots/crm-failure.png', fullPage: true }).catch(() => {}); console.error(await page.locator('body').innerText().catch(() => 'Unavailable')); }
  throw error;
} finally {
  await browser.close();
  await prisma.$transaction(async (tx) => {
    for (const table of ['session', 'auditLog', 'payment', 'saleItem', 'sale', 'heldCart', 'customer', 'stockMovement', 'stockBalance', 'userOutlet', 'product', 'user', 'role', 'outlet']) await tx[table].deleteMany({ where: { tenantId } });
    await tx.tenant.deleteMany({ where: { id: tenantId } });
  }, { timeout: 15000 });
  const remainingTenants = await prisma.tenant.count({ where: { id: tenantId } });
  await writeFile('docs/SPRINT_6_CLEANUP_RESULTS.json', JSON.stringify({ verifiedAt: new Date().toISOString(), smokeTenantId: tenantId, remainingTenants, transactionCleanup: remainingTenants === 0 }, null, 2)); await prisma.$disconnect();
}
