import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/password';
import { DEFAULT_ROLES } from '../src/permissions';

type Entry = { id: string; status: string; amount: string; voidReason: string | null };
type Amounts = { cashSales: string; edcSales: string; manualIncome: string; manualExpense: string; netCash: string };
type Report = { summary: Amounts & { cashSaleCount: number; edcSaleCount: number }; daily: (Amounts & { day: string })[]; categories: { category: string; amount: string; count: number }[] };

test('Sprint 5: cash entries, scoped reports, idempotency and atomic void', async (t) => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`, prisma = app.get(PrismaService);
  const tenantA = randomUUID(), tenantB = randomUUID(), tenantId = { in: [tenantA, tenantB] };
  const password = randomBytes(18).toString('hex'), passwordHash = await hashPassword(password);
  const cleanupSql: string[] = [];
  try {
    await prisma.tenant.createMany({ data: [tenantA, tenantB].map((id) => ({ id, name: 'Finance test', slug: `fin-${id}`, timezone: 'Asia/Jakarta' })) });
    await prisma.role.createMany({ data: [tenantA, tenantB].flatMap((id) => DEFAULT_ROLES.map((role) => ({ ...role, tenantId: id }))) });
    const roles = await prisma.role.findMany({ where: { tenantId: tenantA } });
    const viewerRole = await prisma.role.create({ data: { tenantId: tenantA, code: 'viewer', name: 'Finance viewer', permissions: ['finance.read'] } });
    const writerRole = await prisma.role.create({ data: { tenantId: tenantA, code: 'writer', name: 'Finance writer', permissions: ['finance.read', 'finance.entries.write'] } });
    const voidRole = await prisma.role.create({ data: { tenantId: tenantA, code: 'voider', name: 'Finance voider', permissions: ['finance.read', 'finance.void'] } });
    const main = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Main', code: 'MAIN' } });
    const branch = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Branch', code: 'BRANCH' } });
    const foreignOutlet = await prisma.outlet.create({ data: { tenantId: tenantB, name: 'Foreign', code: 'FOREIGN' } });
    async function user(name: string, roleId: string, allOutlets = false) { return prisma.user.create({ data: { tenantId: tenantA, name, email: `${name}@fin.test`, passwordHash, roleId, allOutlets } }); }
    const managerRole = roles.find((role) => role.code === 'manager')!.id;
    const manager = await user('manager', managerRole, true), manager2 = await user('manager2', managerRole, true), scoped = await user('scoped', managerRole), viewer = await user('viewer', viewerRole.id), writer = await user('writer', writerRole.id), voider = await user('voider', voidRole.id), cashier = await user('cashier', roles.find((role) => role.code === 'cashier')!.id);
    await prisma.userOutlet.createMany({ data: [scoped, viewer, writer, voider, cashier].map((entry) => ({ tenantId: tenantA, userId: entry.id, outletId: main.id })) });
    const foreignRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantB, code: 'manager' } } });
    const foreign = await prisma.user.create({ data: { tenantId: tenantB, name: 'Foreign', email: 'foreign@fin.test', passwordHash, roleId: foreignRole.id, allOutlets: true } });
    async function login(email: string, tenant = tenantA) { const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug: `fin-${tenant}`, email, password }) }); assert.equal(response.status, 201); return response.headers.get('set-cookie')!.split(';')[0]; }
    const cookie = await login(manager.email), secondCookie = await login(manager2.email), scopedCookie = await login(scoped.email), viewerCookie = await login(viewer.email), writerCookie = await login(writer.email), voidCookie = await login(voider.email), cashierCookie = await login(cashier.email), foreignCookie = await login(foreign.email, tenantB);
    const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}/${path}`, { method, headers: { Cookie: auth, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    async function json<T>(response: Response, status = 201): Promise<T> { assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<T>; }
    const body = (extra: Record<string, unknown> = {}) => ({ idempotencyKey: randomUUID(), outletId: main.id, kind: 'income', category: 'owner_funding', amount: '100.10', businessDate: '2026-11-17', note: 'Setoran pemilik', ...extra });
    const query = `outletId=${main.id}&from=2026-11-17&to=2026-11-17`;
    const report = () => request(`finance/report?${query}`).then((res) => json<Report>(res, 200));
    let entryId = '', entryKey = '';

    await t.test('validates money, category, dates, periods, unknown fields and separated permissions', async () => {
      const metadata = await json<{ timezone: string; today: string; categories: unknown[] }>(await request('finance/metadata'), 200);
      assert.equal(metadata.timezone, 'Asia/Jakarta'); assert.match(metadata.today, /^\d{4}-\d{2}-\d{2}$/); assert.equal(metadata.categories.length, 7);
      for (const extra of [{ amount: '0' }, { amount: '-1' }, { amount: '0.001' }, { amount: '1e3' }, { amount: 100 }, { amount: '1000000000000' }, { category: 'unknown' }, { category: 'operational' }, { kind: 'sale' }, { businessDate: '2026-02-30' }, { businessDate: '17-11-2026' }, { businessDate: '1999-01-01' }, { note: '   ' }, { status: 'voided' }, { tenantId: tenantB }]) assert.equal((await request('finance/entries', 'POST', body(extra))).status, 400, JSON.stringify(extra));
      for (const suffix of ['from=2026-11-18&to=2026-11-17', 'from=2025-01-01&to=2026-11-17', 'from=2026-11-17', 'from=bad&to=2026-11-17']) assert.equal((await request(`finance/report?outletId=${main.id}&${suffix}`)).status, 400);
      for (const suffix of ['&page=0', '&kind=sale', '&status=deleted']) assert.equal((await request(`finance/entries?${query}${suffix}`)).status, 400);
      assert.equal((await request(`finance/report?${query}`, 'GET', undefined, cashierCookie)).status, 403);
      assert.equal((await request('finance/entries', 'POST', body(), viewerCookie)).status, 403);
      assert.equal((await request('finance/entries', 'POST', body(), voidCookie)).status, 403);
      assert.equal((await request('finance/entries', 'POST', body({ outletId: branch.id }), scopedCookie)).status, 403);
      assert.equal((await request('finance/entries', 'POST', body({ outletId: foreignOutlet.id }))).status, 404);
      assert.equal(await prisma.financeEntry.count({ where: { tenantId: tenantA } }), 0);
    });
    await t.test('concurrent same-key create posts one entry/audit, normalized replay and creator-bound recovery', async () => {
      const payload = body(); entryKey = payload.idempotencyKey;
      const results = await Promise.all([request('finance/entries', 'POST', payload), request('finance/entries', 'POST', payload)]);
      const entries = await Promise.all(results.map((res) => json<Entry>(res))); entryId = entries[0].id;
      assert.equal(entries[1].id, entryId); assert.equal(entries[0].amount, '100.1');
      assert.equal((await json<Entry>(await request('finance/entries', 'POST', { ...payload, amount: '100.1', note: ' Setoran pemilik ' }))).id, entryId);
      assert.equal((await request('finance/entries', 'POST', { ...payload, amount: '101' })).status, 409);
      assert.equal((await request('finance/entries', 'POST', payload, secondCookie)).status, 409);
      assert.equal((await request(`finance/entries/by-key/${entryKey}?outletId=${main.id}`)).status, 200);
      assert.equal((await request(`finance/entries/by-key/${entryKey}?outletId=${main.id}`, 'GET', undefined, secondCookie)).status, 404);
      assert.equal((await request(`finance/entries/by-key/${entryKey}?outletId=${branch.id}`)).status, 404);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA, entityId: entryId, action: 'finance_entry.create' } }), 1);
      assert.equal((await request(`finance/entries/${entryId}`, 'PATCH', payload)).status, 404);
    });
    await t.test('real POS cash uses net payment not tendered; EDC stays separate and local day boundaries apply', async () => {
      const product = await prisma.product.create({ data: { tenantId: tenantA, sku: 'FIN', name: 'Finance product', sellingPrice: '50.25' } });
      await prisma.stockBalance.create({ data: { tenantId: tenantA, outletId: main.id, productId: product.id, quantity: '20', openedAt: new Date() } });
      async function checkout(method: string, createdAt: string, outletId = main.id) {
        const sale = await json<{ id: string }>(await request('sales', 'POST', { idempotencyKey: randomUUID(), outletId, items: [{ productId: product.id, quantity: '1', expectedPrice: '50.25' }], method, tendered: method === 'cash' ? '100' : '50.25', manualConfirmed: method === 'edc' }));
        await prisma.sale.update({ where: { id: sale.id }, data: { createdAt: new Date(createdAt) } }); return sale.id;
      }
      await checkout('cash', '2026-11-16T17:00:00.000Z');
      await checkout('cash', '2026-11-17T16:59:59.999Z');
      await checkout('edc', '2026-11-17T05:00:00.000Z');
      await checkout('cash', '2026-11-16T16:59:59.999Z');
      await checkout('cash', '2026-11-17T17:00:00.000Z');
      await json<Entry>(await request('finance/entries', 'POST', body({ kind: 'expense', category: 'operational', amount: '25.15', note: 'Biaya operasional' }), writerCookie));
      await json<Entry>(await request('finance/entries', 'POST', body({ outletId: branch.id, amount: '999' })));
      await json<Entry>(await request('finance/entries', 'POST', body({ businessDate: '2026-11-18', amount: '888' })));
      const result = await report();
      assert.deepEqual(result.summary, { cashSales: '100.5', edcSales: '50.25', manualIncome: '100.1', manualExpense: '25.15', netCash: '175.45', cashSaleCount: 2, edcSaleCount: 1 });
      assert.equal(result.daily.length, 1); assert.equal(result.daily[0].day, '2026-11-17'); assert.equal(result.daily[0].netCash, '175.45');
      assert.equal(result.categories.find((entry) => entry.category === 'operational')!.amount, '25.15');
      const empty = await json<Report>(await request(`finance/report?outletId=${main.id}&from=2026-10-01&to=2026-10-03`), 200);
      assert.equal(empty.summary.netCash, '0'); assert.equal(empty.daily.length, 3); assert.deepEqual(empty.categories, []);
      await prisma.tenant.update({ where: { id: tenantA }, data: { timezone: 'UTC' } });
      assert.equal((await report()).summary.cashSaleCount, 2);
      await prisma.tenant.update({ where: { id: tenantA }, data: { timezone: 'Asia/Jakarta' } });
    });
    await t.test('void requires permission/reason, serializes retries and removes original-period totals', async () => {
      const payload = { outletId: main.id, reason: 'Duplikat setoran' };
      assert.equal((await request(`finance/entries/${entryId}/void`, 'POST', payload, writerCookie)).status, 403);
      assert.equal((await request(`finance/entries/${entryId}/void`, 'POST', { ...payload, reason: '   ' })).status, 400);
      assert.equal((await request(`finance/entries/${entryId}/void`, 'POST', { ...payload, outletId: branch.id })).status, 404);
      const responses = await Promise.all([request(`finance/entries/${entryId}/void`, 'POST', payload, voidCookie), request(`finance/entries/${entryId}/void`, 'POST', payload, voidCookie)]);
      for (const res of responses) assert.equal((await json<Entry>(res)).status, 'voided');
      assert.equal((await request(`finance/entries/${entryId}/void`, 'POST', { ...payload, reason: 'Different reason' }, voidCookie)).status, 409);
      assert.equal((await request(`finance/entries/${entryId}/void`, 'POST', payload)).status, 409);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA, entityId: entryId, action: 'finance_entry.void' } }), 1);
      const result = await report(); assert.equal(result.summary.manualIncome, '0'); assert.equal(result.summary.netCash, '75.35');
      const list = await json<{ items: Entry[]; total: number }>(await request(`finance/entries?${query}&status=voided&kind=income`), 200); assert.equal(list.total, 1); assert.equal(list.items[0].voidReason, payload.reason);
      assert.equal((await request(`finance/entries/by-key/${entryKey}?outletId=${main.id}`)).status, 200);
    });
    await t.test('audit failure atomically rolls back entry create and void; retry succeeds', async () => {
      const payload = body({ amount: '0.01', note: 'Rollback probe' });
      const target = await json<Entry>(await request('finance/entries', 'POST', payload));
      const fn = `fin_fail_${randomUUID().replaceAll('-', '')}`;
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id = '${tenantA}'::uuid AND NEW.entity_type = 'finance_entry' THEN RAISE EXCEPTION 'injected finance rollback'; END IF; RETURN NEW; END $$`);
      cleanupSql.push(`DROP TRIGGER IF EXISTS ${fn} ON audit_logs`, `DROP FUNCTION IF EXISTS ${fn}()`);
      const count = await prisma.financeEntry.count({ where: { tenantId: tenantA } });
      const failedCreate = body();
      try {
        await prisma.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
        assert.equal((await request('finance/entries', 'POST', failedCreate)).status, 500);
        assert.equal(await prisma.financeEntry.count({ where: { tenantId: tenantA } }), count);
        assert.equal((await request(`finance/entries/${target.id}/void`, 'POST', { outletId: main.id, reason: 'Rollback void' })).status, 500);
        assert.equal((await prisma.financeEntry.findUniqueOrThrow({ where: { id: target.id } })).status, 'posted');
      } finally { for (const sql of cleanupSql.splice(0)) await prisma.$executeRawUnsafe(sql); }
      await json<Entry>(await request('finance/entries', 'POST', failedCreate));
      await json<Entry>(await request(`finance/entries/${target.id}/void`, 'POST', { outletId: main.id, reason: 'Rollback void' }));
    });
    await t.test('pagination, tenant isolation and inactive outlet policy', async () => {
      await prisma.financeEntry.createMany({ data: Array.from({ length: 26 }, (_, index) => ({ tenantId: tenantA, outletId: main.id, createdBy: manager.id, idempotencyKey: randomUUID(), requestHash: 'pagination-fixture', kind: 'income', category: 'other_income', amount: '1', businessDate: new Date('2026-10-01'), note: `Page fixture ${index}` })) });
      const pageQuery = `outletId=${main.id}&from=2026-10-01&to=2026-10-01`;
      const first = await json<{ items: Entry[]; total: number }>(await request(`finance/entries?${pageQuery}`), 200), second = await json<{ items: Entry[]; total: number }>(await request(`finance/entries?${pageQuery}&page=2`), 200);
      assert.equal(first.items.length, 25); assert.equal(second.items.length, 1); assert.equal(first.total, 26); assert.ok(!first.items.some((entry) => entry.id === second.items[0].id));
      for (const path of [`finance/entries?${query}`, `finance/report?${query}`, `finance/entries/by-key/${entryKey}?outletId=${main.id}`]) assert.equal((await request(path, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`finance/entries/${entryId}/void`, 'POST', { outletId: foreignOutlet.id, reason: 'Foreign attempt' }, foreignCookie)).status, 404);
      assert.equal((await request(`finance/report?outletId=${branch.id}&from=2026-11-17&to=2026-11-17`, 'GET', undefined, scopedCookie)).status, 403);
      await prisma.outlet.update({ where: { id: main.id }, data: { status: 'inactive' } });
      assert.equal((await request(`finance/report?${query}`)).status, 404);
      assert.equal((await request(`finance/entries?${query}`, 'GET', undefined, scopedCookie)).status, 403);
      assert.equal((await request('finance/entries', 'POST', body())).status, 404);
      assert.equal((await request(`finance/entries/${entryId}/void`, 'POST', { outletId: main.id, reason: 'Inactive outlet' })).status, 404);
    });
  } finally {
    for (const sql of cleanupSql) await prisma.$executeRawUnsafe(sql).catch(() => {});
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { tenantId } });
      await tx.auditLog.deleteMany({ where: { tenantId } });
      await tx.financeEntry.deleteMany({ where: { tenantId } });
      await tx.payment.deleteMany({ where: { tenantId } });
      await tx.saleItem.deleteMany({ where: { tenantId } });
      await tx.sale.deleteMany({ where: { tenantId } });
      await tx.stockMovement.deleteMany({ where: { tenantId } });
      await tx.stockBalance.deleteMany({ where: { tenantId } });
      await tx.userOutlet.deleteMany({ where: { tenantId } });
      await tx.product.deleteMany({ where: { tenantId } });
      await tx.user.deleteMany({ where: { tenantId } });
      await tx.role.deleteMany({ where: { tenantId } });
      await tx.outlet.deleteMany({ where: { tenantId } });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
    }, { timeout: 15000 });
    await app.close();
  }
});
