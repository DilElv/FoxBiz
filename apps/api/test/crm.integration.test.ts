import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/password';
import { DEFAULT_ROLES } from '../src/permissions';

type Customer = {
  id: string; name: string; phone: string; email: string | null; notes: string; saleCount: number; totalSpend: string;
  lastSaleAt: string | null; lastSaleDate: string | null; segment: string; segmentLabel: string;
};
type List = { items: Customer[]; total: number; summary: { total: number; never: number; active: number; attention: number; inactive: number }; segments: { code: string; label: string }[]; timezone: string; currency: string };
type Sale = { id: string; customerId: string | null; requestHash: string; receiptSnapshot: { customer?: { name: string } } };
type Hold = { id: string; version: number; status: string; customerId: string | null; customer: { id: string; name: string; phone: string } | null };

function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
function atJakarta(date: string, time = '12:00:00') { return new Date(`${date}T${time}+07:00`); }
function segmentAt(value: string | Date, timeZone: string) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const today = todayIn(timeZone);
  const age = Math.round((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${day}T00:00:00.000Z`)) / 86400000);
  return age <= 30 ? 'active' : age <= 90 ? 'attention' : 'inactive';
}

test('Sprint 6: tenant-safe CRM, explicit segments, scoped history and optional POS customer', async (t) => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`, prisma = app.get(PrismaService);
  const tenantA = randomUUID(), tenantB = randomUUID(), tenantId = { in: [tenantA, tenantB] };
  const password = randomBytes(18).toString('hex'), passwordHash = await hashPassword(password);
  const cleanupSql: string[] = [];
  try {
    await prisma.tenant.createMany({ data: [tenantA, tenantB].map((id) => ({ id, name: 'CRM test', slug: `crm-${id}`, timezone: 'Asia/Jakarta' })) });
    await prisma.role.createMany({ data: [tenantA, tenantB].flatMap((id) => DEFAULT_ROLES.map((role) => ({ ...role, tenantId: id }))) });
    const roles = await prisma.role.findMany({ where: { tenantId: tenantA } });
    const viewerRole = await prisma.role.create({ data: { tenantId: tenantA, code: 'crm_viewer', name: 'CRM viewer', permissions: ['crm.read'] } });
    const writerRole = await prisma.role.create({ data: { tenantId: tenantA, code: 'crm_writer', name: 'CRM writer', permissions: ['crm.read', 'crm.customers.write'] } });
    const main = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Main', code: 'MAIN' } });
    const branch = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Branch', code: 'BRANCH' } });
    async function user(tenant: string, name: string, roleId: string, allOutlets = false) { return prisma.user.create({ data: { tenantId: tenant, name, email: `${name}@crm.test`, passwordHash, roleId, allOutlets } }); }
    const managerRole = roles.find((role) => role.code === 'manager')!.id;
    const manager = await user(tenantA, 'manager', managerRole, true), scoped = await user(tenantA, 'scoped', managerRole), viewer = await user(tenantA, 'viewer', viewerRole.id), writer = await user(tenantA, 'writer', writerRole.id), cashier = await user(tenantA, 'cashier', roles.find((role) => role.code === 'cashier')!.id);
    await prisma.userOutlet.createMany({ data: [scoped, viewer, writer, cashier].map((entry) => ({ tenantId: tenantA, userId: entry.id, outletId: main.id })) });
    const foreignRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantB, code: 'manager' } } });
    const foreign = await user(tenantB, 'foreign', foreignRole.id, true);
    async function login(email: string, tenant = tenantA) { const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug: `crm-${tenant}`, email, password }) }); assert.equal(response.status, 201); return response.headers.get('set-cookie')!.split(';')[0]; }
    const cookie = await login(manager.email), scopedCookie = await login(scoped.email), viewerCookie = await login(viewer.email), writerCookie = await login(writer.email), cashierCookie = await login(cashier.email), foreignCookie = await login(foreign.email, tenantB);
    const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}/${path}`, { method, headers: { Cookie: auth, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    async function json<T>(response: Response, status = 200): Promise<T> { assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<T>; }
    const list = (query = '') => request(`crm/customers${query ? `?${query}` : ''}`).then((res) => json<List>(res, 200));
    const createBody = (extra: Record<string, unknown> = {}) => ({ name: 'Budi Santoso', phone: '+62 812-3456-7890', email: 'BUDI@Example.com', notes: 'Pelanggan utama', ...extra });
    let budi: Customer;

    await t.test('creates normalized customers, enforces tenant permissions and unique phone, minimizes PII audit', async () => {
      assert.equal((await request('crm/customers', 'GET', undefined, cashierCookie)).status, 403);
      assert.equal((await request('crm/customers', 'POST', createBody(), viewerCookie)).status, 403);
      assert.equal((await request('crm/customers', 'POST', createBody(), cashierCookie)).status, 403);
      for (const extra of [{ name: 'A' }, { phone: '123' }, { phone: '1234567abc' }, { email: 'not-an-email' }, { notes: 'x'.repeat(501) }, { customerId: randomUUID() }, { tenantId: tenantB }]) assert.equal((await request('crm/customers', 'POST', createBody(extra))).status, 400, JSON.stringify(extra));
      budi = await json<Customer>(await request('crm/customers', 'POST', createBody()), 201);
      assert.equal(budi.name, 'Budi Santoso'); assert.equal(budi.phone, '+6281234567890'); assert.equal(budi.email, 'budi@example.com'); assert.equal(budi.saleCount, 0); assert.equal(budi.totalSpend, '0'); assert.equal(budi.segment, 'never'); assert.equal(budi.segmentLabel, 'Belum bertransaksi');
      assert.equal((await request('crm/customers', 'POST', createBody({ email: null, notes: '' }))).status, 409);
      const foreignCustomer = await json<Customer>(await request('crm/customers', 'POST', createBody({ name: 'Foreign customer' }), foreignCookie), 201);
      assert.equal(foreignCustomer.phone, '+6281234567890');
      assert.equal((await request(`crm/customers/${budi.id}`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await list(`search=${encodeURIComponent('Foreign customer')}`)).total, 0);
      const log = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: tenantA, entityId: budi.id, action: 'customer.create' } });
      const serialized = JSON.stringify(log.afterData);
      assert.ok(!serialized.includes('6281234567890')); assert.ok(!serialized.includes('budi@example.com')); assert.ok(!serialized.includes('Budi Santoso'));
      assert.deepEqual((log.afterData as { fields: string[] }).fields, ['name', 'phone', 'email', 'notes']);
      assert.equal((await list(`search=${encodeURIComponent('812-3456')}`)).total, 1);
      assert.equal((await list(`search=${encodeURIComponent('BUDI@example')}`)).total, 1);
      budi = await json<Customer>(await request(`crm/customers/${budi.id}`, 'PATCH', { name: 'Budi Santoso Baru', phone: '+62 811 2222 3333', email: null, notes: 'Diperbarui' }, writerCookie), 200);
      assert.equal(budi.phone, '+6281122223333'); assert.equal(budi.email, null); assert.equal(budi.notes, 'Diperbarui');
      assert.equal((await request(`crm/customers/${budi.id}`, 'PATCH', { phone: '+62 812-3456-7890' }, viewerCookie)).status, 403);
      assert.equal((await request(`crm/customers/${budi.id}`, 'PATCH', { name: 'A' })).status, 400);
      assert.equal((await request(`crm/customers/${budi.id}`, 'PATCH', { tenantId: tenantB })).status, 400);
      assert.equal((await request(`crm/customers/${budi.id}`, 'PATCH', { name: budi.name })).status, 200);
      const updateLog = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: tenantA, entityId: budi.id, action: 'customer.update' } });
      const updateSerialized = JSON.stringify(updateLog.afterData);
      assert.ok(!updateSerialized.includes('6281122223333')); assert.ok(!updateSerialized.includes('Diperbarui')); assert.ok(!updateSerialized.includes('Budi Santoso Baru'));
      assert.deepEqual((updateLog.afterData as { fields: string[] }).fields, ['name', 'phone', 'email', 'notes']);
    });

    await t.test('computes explicit segments in tenant timezone and scopes stats/history to accessible outlets', async () => {
      const today = todayIn('Asia/Jakarta');
      const dates = { today, d30: addDays(today, -30), d31: addDays(today, -31), d90: addDays(today, -90), d91: addDays(today, -91) };
      await json<Customer>(await request('crm/customers', 'POST', createBody({ name: 'Pelanggan Baru', phone: '081200000001', email: null, notes: '' })), 201);
      const fixtures: { name: string; phone: string; date: string; time?: string }[] = [
        { name: 'Pelanggan Hari Ini', phone: '081200000002', date: dates.today },
        { name: 'Pelanggan Tiga Puluh', phone: '081200000003', date: dates.d30, time: '00:30:00' },
        { name: 'Pelanggan Tiga Puluh Satu', phone: '081200000004', date: dates.d31 },
        { name: 'Pelanggan Sembilan Puluh', phone: '081200000005', date: dates.d90 },
        { name: 'Pelanggan Sembilan Puluh Satu', phone: '081200000006', date: dates.d91 },
      ];
      const customers = new Map<string, Customer>();
      for (const fixture of fixtures) {
        const customer = await prisma.customer.create({ data: { tenantId: tenantA, name: fixture.name, phone: fixture.phone } });
        await prisma.sale.create({ data: { tenantId: tenantA, outletId: main.id, cashierId: manager.id, customerId: customer.id, receiptNo: `CRM-${randomUUID()}`, idempotencyKey: randomUUID(), requestHash: 'segment-fixture', subtotal: '100', total: '100', receiptSnapshot: {}, createdAt: atJakarta(fixture.date, fixture.time) } });
        customers.set(fixture.name, { ...(await json<Customer>(await request(`crm/customers/${customer.id}`))) });
      }
      assert.equal(customers.get('Pelanggan Hari Ini')!.segment, 'active');
      assert.equal(customers.get('Pelanggan Tiga Puluh')!.segment, 'active');
      assert.equal(customers.get('Pelanggan Tiga Puluh Satu')!.segment, 'attention');
      assert.equal(customers.get('Pelanggan Sembilan Puluh')!.segment, 'attention');
      assert.equal(customers.get('Pelanggan Sembilan Puluh Satu')!.segment, 'inactive');
      assert.deepEqual((await list()).summary, { total: 7, never: 2, active: 2, attention: 2, inactive: 1 });
      for (const [code, expected] of [['never', 2], ['active', 2], ['attention', 2], ['inactive', 1]] as const) {
        const filtered = await list(`segment=${code}`);
        assert.equal(filtered.total, expected);
        assert.ok(filtered.items.every((customer) => customer.segment === code));
        assert.deepEqual(filtered.summary, { total: 7, never: 2, active: 2, attention: 2, inactive: 1 });
      }
      const history = await json<{ items: { receiptNo: string; outlet: { name: string }; cashier: { name: string }; total: string }[]; total: number }>(await request(`crm/customers/${customers.get('Pelanggan Tiga Puluh')!.id}/sales`));
      assert.equal(history.total, 1); assert.equal(history.items[0].outlet.name, 'Main'); assert.equal(history.items[0].cashier.name, 'manager'); assert.equal(history.items[0].total, '100');
      await prisma.tenant.update({ where: { id: tenantA }, data: { timezone: 'UTC' } });
      const jCodes = ['active', 'active', 'attention', 'attention', 'inactive'];
      const uCodes = fixtures.map((fixture) => segmentAt(atJakarta(fixture.date, fixture.time), 'UTC'));
      const utcSummary: Record<string, number> = { total: 7, never: 2, active: 0, attention: 0, inactive: 0 };
      for (const code of uCodes) utcSummary[code] += 1;
      assert.notDeepEqual(uCodes, jCodes);
      assert.deepEqual((await list()).summary, utcSummary);
      assert.equal((await json<Customer>(await request(`crm/customers/${customers.get('Pelanggan Tiga Puluh')!.id}`))).segment, segmentAt(atJakarta(dates.d30, '00:30:00'), 'UTC'));
      await prisma.tenant.update({ where: { id: tenantA }, data: { timezone: 'Asia/Jakarta' } });

      const scopedCustomer = await json<Customer>(await request('crm/customers', 'POST', createBody({ name: 'Scoped Only', phone: '081200000007', email: null, notes: '' })), 201);
      await prisma.sale.create({ data: { tenantId: tenantA, outletId: branch.id, cashierId: manager.id, customerId: scopedCustomer.id, receiptNo: `CRM-${randomUUID()}`, idempotencyKey: randomUUID(), requestHash: 'scope-fixture', subtotal: '200', total: '200', receiptSnapshot: {}, createdAt: atJakarta(today) } });
      assert.equal((await json<List>(await request('crm/customers?search=Scoped%20Only'))).items[0].segment, 'active');
      const scopedList = await json<List>(await request('crm/customers?search=Scoped%20Only', 'GET', undefined, scopedCookie));
      assert.equal(scopedList.items[0].segment, 'never'); assert.equal(scopedList.items[0].saleCount, 0);
      assert.equal((await json<{ total: number }>(await request(`crm/customers/${scopedCustomer.id}/sales`, 'GET', undefined, scopedCookie))).total, 0);
      assert.equal((await json<{ total: number }>(await request(`crm/customers/${scopedCustomer.id}/sales`))).total, 1);
      assert.equal((await request(`crm/customers/${scopedCustomer.id}/sales`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`crm/customers?page=0`)).status, 400);
      assert.equal((await request(`crm/customers?segment=unknown`)).status, 400);
      assert.equal((await request(`crm/customers?search=${'x'.repeat(161)}`)).status, 400);
    });

    await t.test('pages customer list and keeps POS lookup separate from CRM writes', async () => {
      await prisma.customer.createMany({ data: Array.from({ length: 26 }, (_, index) => ({ tenantId: tenantA, name: `Page ${String(index + 1).padStart(2, '0')}`, phone: `0813000${String(index).padStart(4, '0')}` })) });
      const first = await list(`search=Page&page=1`), second = await list(`search=Page&page=2`);
      assert.equal(first.items.length, 25); assert.equal(second.items.length, 1); assert.equal(first.total, 26);
      assert.ok(!first.items.some((entry) => entry.id === second.items[0].id));
      assert.equal((await request('pos/customers?outletId=' + main.id + '&search=Page', 'GET', undefined, cashierCookie)).status, 200);
      const limited = await json<{ id: string }[]>(await request('pos/customers?outletId=' + main.id + '&search=Page', 'GET', undefined, cashierCookie));
      assert.equal(limited.length, 20);
    });

    await t.test('POS customer lookup is limited, optional checkout is backward compatible and hold customer survives', async () => {
      const product = await prisma.product.create({ data: { tenantId: tenantA, sku: 'CRM-POS', name: 'CRM product', sellingPrice: '50' } });
      await prisma.stockBalance.create({ data: { tenantId: tenantA, outletId: main.id, productId: product.id, quantity: '20', openedAt: new Date() } });
      const customers = await Promise.all([
        prisma.customer.create({ data: { tenantId: tenantA, name: 'POS Satu', phone: '081400000001', email: 'pos1@example.com' } }),
        prisma.customer.create({ data: { tenantId: tenantA, name: 'POS Dua', phone: '081400000002' } }),
      ]);
      const lookup = await json<{ id: string; name: string; phone: string; email?: string }[]>(await request(`pos/customers?outletId=${main.id}&search=POS`, 'GET', undefined, cashierCookie));
      assert.equal(lookup.length, 2); assert.equal(lookup[0].email, undefined); assert.equal(Object.keys(lookup[0]).sort().join(','), 'id,name,phone');
      assert.deepEqual(await json<unknown[]>(await request(`pos/customers?outletId=${main.id}&search=P`, 'GET', undefined, cashierCookie)), []);
      assert.equal((await request(`pos/customers?outletId=${branch.id}&search=POS`, 'GET', undefined, scopedCookie)).status, 403);
      const items = [{ productId: product.id, quantity: '1', expectedPrice: '50' }];
      const legacy = { outletId: main.id, items, method: 'cash', tendered: '100', manualConfirmed: false, holdId: null, holdVersion: null };
      const legacyHash = createHash('sha256').update(JSON.stringify(legacy)).digest('hex');
      const noCustomer = await json<Sale>(await request('sales', 'POST', { idempotencyKey: randomUUID(), ...legacy }, cashierCookie), 201);
      assert.equal(noCustomer.customerId, null); assert.equal(noCustomer.requestHash, legacyHash); assert.equal(noCustomer.receiptSnapshot.customer, undefined);
      const withCustomerPayload = { idempotencyKey: randomUUID(), outletId: main.id, items, method: 'cash', tendered: '100', manualConfirmed: false, customerId: customers[0].id };
      const withCustomer = await json<Sale>(await request('sales', 'POST', withCustomerPayload, cashierCookie), 201);
      assert.equal(withCustomer.customerId, customers[0].id); assert.equal(withCustomer.receiptSnapshot.customer?.name, 'POS Satu');
      assert.notEqual(withCustomer.requestHash, legacyHash);
      assert.equal((await json<Sale>(await request('sales', 'POST', withCustomerPayload, cashierCookie), 201)).id, withCustomer.id);
      assert.equal((await request('sales', 'POST', { ...withCustomerPayload, customerId: customers[1].id }, cashierCookie)).status, 409);
      assert.equal((await request('sales', 'POST', { idempotencyKey: randomUUID(), outletId: main.id, items, method: 'cash', tendered: '100', manualConfirmed: false, customerId: randomUUID() }, cashierCookie)).status, 404);
      const foreignCustomer = await prisma.customer.findFirstOrThrow({ where: { tenantId: tenantB } });
      assert.equal((await request('sales', 'POST', { idempotencyKey: randomUUID(), outletId: main.id, items, method: 'cash', tendered: '100', manualConfirmed: false, customerId: foreignCustomer.id }, cashierCookie)).status, 404);

      const hold = await json<Hold>(await request('pos/holds', 'POST', { outletId: main.id, label: 'POS hold', items, customerId: customers[0].id }, cashierCookie), 201);
      assert.equal(hold.customer?.name, 'POS Satu');
      const holds = await json<Hold[]>(await request(`pos/holds?outletId=${main.id}`, 'GET', undefined, cashierCookie));
      assert.equal(holds[0].customer?.name, 'POS Satu');
      const resumed = await json<{ hold: Hold; quote: { total: string } }>(await request(`pos/holds/${hold.id}`, 'GET', undefined, cashierCookie));
      assert.equal(resumed.hold.customerId, customers[0].id); assert.equal(resumed.quote.total, '50');
      assert.equal((await request('sales', 'POST', { idempotencyKey: randomUUID(), outletId: main.id, items, method: 'cash', tendered: '100', manualConfirmed: false, holdId: hold.id, holdVersion: hold.version, customerId: customers[1].id }, cashierCookie)).status, 409);
      assert.equal((await request('sales', 'POST', { idempotencyKey: randomUUID(), outletId: main.id, items, method: 'cash', tendered: '100', manualConfirmed: false, holdId: hold.id, holdVersion: hold.version }, cashierCookie)).status, 409);
      assert.equal((await prisma.heldCart.findUniqueOrThrow({ where: { id: hold.id } })).status, 'held');
      const completed = await json<Sale>(await request('sales', 'POST', { idempotencyKey: randomUUID(), outletId: main.id, items, method: 'cash', tendered: '100', manualConfirmed: false, holdId: hold.id, holdVersion: hold.version, customerId: customers[0].id }, cashierCookie), 201);
      assert.equal(completed.customerId, customers[0].id);
      assert.equal((await prisma.heldCart.findUniqueOrThrow({ where: { id: hold.id } })).status, 'completed');
      const history = await json<{ items: { id: string }[]; total: number }>(await request(`crm/customers/${customers[0].id}/sales`));
      assert.equal(history.total, 2); assert.ok(history.items.some((sale) => sale.id === withCustomer.id)); assert.ok(history.items.some((sale) => sale.id === completed.id));
    });

    await t.test('audit failure rolls back customer creation and retry succeeds', async () => {
      const fn = `crm_fail_${randomUUID().replaceAll('-', '')}`;
      cleanupSql.push(`DROP TRIGGER IF EXISTS ${fn} ON audit_logs`, `DROP FUNCTION IF EXISTS ${fn}()`);
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id = '${tenantA}'::uuid AND NEW.entity_type = 'customer' THEN RAISE EXCEPTION 'injected crm rollback'; END IF; RETURN NEW; END $$`);
      const count = await prisma.customer.count({ where: { tenantId: tenantA } });
      const payload = createBody({ name: 'Rollback Customer', phone: '081500000001', email: null, notes: '' });
      try {
        await prisma.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
        assert.equal((await request('crm/customers', 'POST', payload)).status, 500);
        assert.equal(await prisma.customer.count({ where: { tenantId: tenantA } }), count);
      } finally { for (const sql of cleanupSql.splice(0)) await prisma.$executeRawUnsafe(sql); }
      await json<Customer>(await request('crm/customers', 'POST', payload), 201);
    });
  } finally {
    for (const sql of cleanupSql) await prisma.$executeRawUnsafe(sql).catch(() => {});
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { tenantId } });
      await tx.auditLog.deleteMany({ where: { tenantId } });
      await tx.heldCart.deleteMany({ where: { tenantId } });
      await tx.payment.deleteMany({ where: { tenantId } });
      await tx.saleItem.deleteMany({ where: { tenantId } });
      await tx.sale.deleteMany({ where: { tenantId } });
      await tx.customer.deleteMany({ where: { tenantId } });
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
