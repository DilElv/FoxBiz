import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/password';
import { DEFAULT_ROLES } from '../src/permissions';

type Dashboard = {
  outletId: string; outletName: string; period: string; from: string; to: string; today: string; timezone: string; currency: string;
  capabilities: { sales: boolean; inventory: boolean; purchasing: boolean; customers: boolean; hris: boolean };
  summary: {
    sales: string; transactions: number; items: string; newCustomers: number;
    previous: { sales: string; transactions: number; items: string; newCustomers: number };
    trends: { sales: number | null; transactions: number | null; items: number | null; newCustomers: number | null };
  };
  series: { key: string; label: string; amount: string }[];
  alerts: {
    lowStock: number; lowStockItems: { name: string; sku: string; quantity: string; threshold: string }[];
    pendingPurchaseOrders: number;
    attendance: { active: number; present: number; absent: number; working: number; absentNames: string[] };
  };
};

function todayIn(timeZone = 'Asia/Jakarta') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

test('Sprint 7: dashboard aggregates real sales, customers, stock, purchasing and attendance', async (t) => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`, prisma = app.get(PrismaService);
  const tenantId = randomUUID(), foreignTenantId = randomUUID(), ids = { in: [tenantId, foreignTenantId] };
  const password = 'dashboard-test-password-123', passwordHash = await hashPassword(password);
  try {
    await prisma.tenant.createMany({ data: [tenantId, foreignTenantId].map((id) => ({ id, name: 'Dashboard test', slug: `dashboard-${id}`, timezone: 'Asia/Jakarta' })) });
    await prisma.role.createMany({ data: [tenantId, foreignTenantId].flatMap((id) => DEFAULT_ROLES.map((role) => ({ ...role, tenantId: id }))) });
    const main = await prisma.outlet.create({ data: { tenantId, name: 'Toko Utama', code: 'MAIN' } });
    const branch = await prisma.outlet.create({ data: { tenantId, name: 'Cabang', code: 'BRANCH' } });
    const foreignOutlet = await prisma.outlet.create({ data: { tenantId: foreignTenantId, name: 'Foreign', code: 'FOREIGN' } });
    const roles = await prisma.role.findMany({ where: { tenantId } });
    const role = (code: string) => roles.find((item) => item.code === code)!.id;
    async function user(name: string, roleId: string, allOutlets = true) {
      return prisma.user.create({ data: { tenantId, name, email: `${name}-${tenantId}@dashboard.test`, passwordHash, roleId, allOutlets } });
    }
    const manager = await user('manager', role('manager'));
    const cashier = await user('cashier', role('cashier'));
    const scoped = await user('scoped', role('manager'), false);
    await prisma.userOutlet.create({ data: { tenantId, userId: scoped.id, outletId: main.id } });
    const foreignRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: foreignTenantId, code: 'owner' } } });
    const foreign = await prisma.user.create({ data: { tenantId: foreignTenantId, name: 'foreign', email: `foreign-${foreignTenantId}@dashboard.test`, passwordHash, roleId: foreignRole.id, allOutlets: true } });
    async function login(email: string, tenant = tenantId) {
      const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug: `dashboard-${tenant}`, email, password }) });
      assert.equal(response.status, 201, await response.clone().text());
      return response.headers.get('set-cookie')!.split(';')[0];
    }
    const cookie = await login(manager.email), cashierCookie = await login(cashier.email), scopedCookie = await login(scoped.email), foreignCookie = await login(foreign.email, foreignTenantId);
    const request = (path: string, auth = cookie) => fetch(`${base}/${path}`, { headers: { Cookie: auth } });
    async function json<T>(response: Response, status = 200): Promise<T> { assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<T>; }

    const product = await prisma.product.create({ data: { tenantId, sku: 'DASH-1', name: 'Produk Laris', sellingPrice: '50000' } });
    const low = await prisma.product.create({ data: { tenantId, sku: 'DASH-LOW', name: 'Produk Menipis', sellingPrice: '10000' } });
    await prisma.stockBalance.createMany({ data: [
      { tenantId, outletId: main.id, productId: product.id, quantity: '10', lowStockThreshold: '2' },
      { tenantId, outletId: main.id, productId: low.id, quantity: '3', lowStockThreshold: '5' },
    ] });
    const today = todayIn(), yesterday = new Date(Date.now() - 86400000);
    async function sale(total: string, quantity: string, createdAt: Date, method = 'cash') {
      const id = randomUUID();
      return prisma.sale.create({ data: {
        id, tenantId, outletId: main.id, cashierId: manager.id, receiptNo: `FB-DASH-${id}`, idempotencyKey: randomUUID(), requestHash: id, status: 'paid',
        subtotal: total, total, createdAt, receiptSnapshot: { business: 'Dashboard test' },
        items: { create: [{ productId: product.id, name: product.name, sku: product.sku, unit: 'pcs', quantity, unitPrice: '50000', lineTotal: total }] },
        payment: { create: { method, status: method === 'cash' ? 'received' : 'manually_confirmed', amount: total, tendered: total, change: '0', confirmedAt: createdAt, ...(method === 'edc' ? { manualConfirmedBy: manager.id } : {}) } },
      } });
    }
    await sale('100000', '2', new Date());
    await sale('150000', '3', new Date(), 'edc');
    await sale('50000', '1', yesterday);
    const unpaidId = randomUUID();
    await prisma.sale.create({ data: {
      id: unpaidId, tenantId, outletId: main.id, cashierId: manager.id, receiptNo: `FB-DASH-${unpaidId}`, idempotencyKey: randomUUID(), requestHash: unpaidId, status: 'paid',
      subtotal: '450000', total: '450000', receiptSnapshot: { business: 'Dashboard test' },
      items: { create: [{ productId: product.id, name: product.name, sku: product.sku, unit: 'pcs', quantity: '9', unitPrice: '50000', lineTotal: '450000' }] },
    } });
    await prisma.customer.create({ data: { tenantId, name: 'Pelanggan Baru', phone: '081200000001' } });
    await prisma.customer.create({ data: { tenantId, name: 'Pelanggan Lama', phone: '081200000002', createdAt: yesterday } });
    const supplier = await prisma.supplier.create({ data: { tenantId, name: 'Supplier Dashboard' } });
    await prisma.purchaseOrder.create({ data: {
      tenantId, outletId: main.id, supplierId: supplier.id, supplierName: supplier.name, createdBy: manager.id,
      poNo: 'PO-DASH-1', idempotencyKey: randomUUID(), requestHash: 'dash', status: 'ordered', total: '75000', orderedAt: new Date(),
    } });
    const employeeA = await prisma.employee.create({ data: { tenantId, code: 'DSH01', name: 'Karyawan Hadir', allOutlets: true } });
    await prisma.employee.create({ data: { tenantId, code: 'DSH02', name: 'Karyawan Belum', allOutlets: true } });
    await prisma.attendance.create({ data: { tenantId, employeeId: employeeA.id, outletId: main.id, workDate: today, clockInAt: new Date(), source: 'kiosk', recordedBy: manager.id } });

    await t.test('aggregates today sales, previous period trend and hourly series', async () => {
      const data = await json<Dashboard>(await request(`dashboard?outletId=${main.id}&period=today`));
      assert.equal(data.outletName, 'Toko Utama'); assert.equal(data.timezone, 'Asia/Jakarta'); assert.equal(data.currency, 'IDR');
      assert.deepEqual(data.capabilities, { sales: true, inventory: true, purchasing: true, customers: true, hris: true });
      assert.equal(data.summary.sales, '250000.00'); assert.equal(data.summary.transactions, 2); assert.equal(Number(data.summary.items), 5);
      assert.equal(data.summary.newCustomers, 1);
      assert.equal(data.summary.previous.sales, '50000.00'); assert.equal(data.summary.previous.transactions, 1);
      assert.equal(data.summary.trends.sales, 400); assert.equal(data.summary.trends.transactions, 100);
      assert.equal(data.series.length, 24); assert.equal(data.series.reduce((sum, item) => sum + Number(item.amount), 0), 250000);
      assert.equal(data.alerts.lowStock, 1); assert.equal(data.alerts.lowStockItems[0].name, 'Produk Menipis'); assert.equal(data.alerts.lowStockItems[0].quantity, '3');
      assert.equal(data.alerts.pendingPurchaseOrders, 1);
      assert.equal(data.alerts.attendance.active, 2); assert.equal(data.alerts.attendance.present, 1); assert.equal(data.alerts.attendance.absent, 1); assert.equal(data.alerts.attendance.working, 1);
      assert.deepEqual(data.alerts.attendance.absentNames, ['Karyawan Belum']);
    });

    await t.test('honours outlet scope and period validation', async () => {
      const week = await json<Dashboard>(await request(`dashboard?outletId=${main.id}&period=week`));
      assert.equal(week.from, dataWeekStart(today)); assert.equal(week.to, today); assert.equal(week.series.length, diffDays(week.from, week.to) + 1);
      const month = await json<Dashboard>(await request(`dashboard?outletId=${main.id}&period=month`));
      assert.equal(month.from, `${today.slice(0, 7)}-01`); assert.equal(month.to, today); assert.equal(month.series.length, Number(today.slice(8)));
      assert.equal((await request(`dashboard?outletId=${main.id}&period=year`)).status, 400);
      assert.equal((await request(`dashboard?outletId=${main.id}`, foreignCookie)).status, 404);
      assert.equal((await request(`dashboard?outletId=${foreignOutlet.id}`)).status, 404);
      assert.equal((await request(`dashboard?outletId=${branch.id}`, scopedCookie)).status, 403);
      assert.equal((await json<Dashboard>(await request(`dashboard?outletId=${main.id}`, scopedCookie))).outletName, 'Toko Utama');
    });

    await t.test('hides restricted metrics from roles without permission', async () => {
      const data = await json<Dashboard>(await request(`dashboard?outletId=${main.id}`, cashierCookie));
      assert.deepEqual(data.capabilities, { sales: true, inventory: true, purchasing: false, customers: false, hris: false });
      assert.equal(data.summary.sales, '250000.00');
      assert.equal(data.summary.newCustomers, 0);
      assert.equal(data.alerts.lowStock, 1); assert.equal(data.alerts.pendingPurchaseOrders, 0); assert.equal(data.alerts.attendance.active, 0);
    });
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.attendance.deleteMany({ where: { tenantId: ids } });
      await tx.employeeOutlet.deleteMany({ where: { tenantId: ids } });
      await tx.employee.deleteMany({ where: { tenantId: ids } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId: ids } });
      await tx.supplier.deleteMany({ where: { tenantId: ids } });
      await tx.saleItem.deleteMany({ where: { tenantId: ids } });
      await tx.payment.deleteMany({ where: { tenantId: ids } });
      await tx.sale.deleteMany({ where: { tenantId: ids } });
      await tx.customer.deleteMany({ where: { tenantId: ids } });
      await tx.stockMovement.deleteMany({ where: { tenantId: ids } });
      await tx.stockBalance.deleteMany({ where: { tenantId: ids } });
      await tx.product.deleteMany({ where: { tenantId: ids } });
      await tx.session.deleteMany({ where: { tenantId: ids } });
      await tx.auditLog.deleteMany({ where: { tenantId: ids } });
      await tx.userOutlet.deleteMany({ where: { tenantId: ids } });
      await tx.user.deleteMany({ where: { tenantId: ids } });
      await tx.role.deleteMany({ where: { tenantId: ids } });
      await tx.outlet.deleteMany({ where: { tenantId: ids } });
      await tx.tenant.deleteMany({ where: { id: ids } });
    }, { timeout: 15000 });
    await app.close();
  }
});

function dataWeekStart(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function diffDays(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000);
}
