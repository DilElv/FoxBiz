import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/password';
import { DEFAULT_ROLES } from '../src/permissions';

test('Sprint 2: atomic POS, payment, recovery, holds and receipt isolation', async (t) => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`, prisma = app.get(PrismaService);
  const tenantA = randomUUID(), tenantB = randomUUID(), tenantId = { in: [tenantA, tenantB] };
  const password = randomBytes(18).toString('hex'), passwordHash = await hashPassword(password);
  try {
    await prisma.tenant.createMany({ data: [tenantA, tenantB].map((id) => ({ id, slug: `pos-${id}`, name: `POS ${id}` })) });
    await prisma.role.createMany({ data: DEFAULT_ROLES.map((role) => ({ ...role, tenantId: tenantA })) });
    const cashierRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantA, code: 'cashier' } } });
    const inventoryRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantA, code: 'inventory' } } });
    const outlet = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Main', code: 'MAIN' } });
    const otherOutlet = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Other', code: 'OTHER' } });
    const foreignOutlet = await prisma.outlet.create({ data: { tenantId: tenantB, name: 'Foreign', code: 'FOREIGN' } });
    const cashier = await prisma.user.create({ data: { tenantId: tenantA, name: 'Cashier', email: 'cashier@pos.test', passwordHash, roleId: cashierRole.id } });
    const colleague = await prisma.user.create({ data: { tenantId: tenantA, name: 'Colleague', email: 'colleague@pos.test', passwordHash, roleId: cashierRole.id } });
    const staff = await prisma.user.create({ data: { tenantId: tenantA, name: 'Staff', email: 'staff@pos.test', passwordHash, roleId: inventoryRole.id } });
    await prisma.userOutlet.createMany({ data: [cashier, colleague, staff].map((user) => ({ tenantId: tenantA, userId: user.id, outletId: outlet.id })) });
    const product = await prisma.product.create({ data: { tenantId: tenantA, sku: 'COFFEE', name: 'Coffee snapshot', sellingPrice: '18000.50', unit: 'cup' } });
    const last = await prisma.product.create({ data: { tenantId: tenantA, sku: 'LAST', name: 'Last item', sellingPrice: '10' } });
    const foreignProduct = await prisma.product.create({ data: { tenantId: tenantB, sku: 'FOREIGN', name: 'Foreign', sellingPrice: '1' } });
    await prisma.stockBalance.createMany({ data: [{ tenantId: tenantA, outletId: outlet.id, productId: product.id, quantity: '20', openedAt: new Date() }, { tenantId: tenantA, outletId: outlet.id, productId: last.id, quantity: '1', openedAt: new Date() }] });
    const foreignRole = await prisma.role.create({ data: { tenantId: tenantB, code: 'cashier', name: 'Cashier', permissions: cashierRole.permissions } });
    const foreignUser = await prisma.user.create({ data: { tenantId: tenantB, name: 'Foreign cashier', email: 'foreign@pos.test', passwordHash, roleId: foreignRole.id, allOutlets: true } });
    async function login(email: string, tenant = tenantA) { const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug: `pos-${tenant}`, email, password }) }); assert.equal(response.status, 201); return response.headers.get('set-cookie')!.split(';')[0]; }
    const cookie = await login(cashier.email), colleagueCookie = await login(colleague.email), staffCookie = await login(staff.email);
    const foreignCookie = await login(foreignUser.email, tenantB);
    const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}/${path}`, { method, headers: { Cookie: auth, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const item = { productId: product.id, quantity: '1.125', expectedPrice: '18000.50' };
    const checkout = (extra = {}) => ({ outletId: outlet.id, items: [item], idempotencyKey: randomUUID(), method: 'cash', tendered: '25000', manualConfirmed: false, ...extra });
    let saleId = '', key = '';
    await t.test('reject permissions, tenant/outlet forgery, malformed and duplicate lines', async () => {
      const category = await prisma.category.create({ data: { tenantId: tenantA, name: 'Drinks' } });
      const foreignCategory = await prisma.category.create({ data: { tenantId: tenantB, name: 'Private category' } });
      await prisma.product.update({ where: { id: product.id }, data: { categoryId: category.id } });
      const categories = await request(`pos/categories?outletId=${outlet.id}`); assert.equal(categories.status, 200);
      assert.deepEqual((await categories.json()).map((entry: { id: string }) => entry.id), [category.id]);
      const filtered = await request(`pos/products?outletId=${outlet.id}&categoryId=${category.id}`);
      assert.deepEqual((await filtered.json()).items.map((entry: { id: string }) => entry.id), [product.id]);
      assert.equal((await (await request(`pos/products?outletId=${outlet.id}&categoryId=${foreignCategory.id}`)).json()).total, 0);
      assert.equal((await request('sales', 'POST', checkout(), staffCookie)).status, 403);
      for (const invalidOutlet of [otherOutlet, foreignOutlet]) assert.equal((await request('sales', 'POST', checkout({ outletId: invalidOutlet.id }))).status, 403);
      assert.equal((await request('sales', 'POST', checkout({ items: [{ ...item, productId: foreignProduct.id }] }))).status, 404);
      for (const items of [[{ ...item, quantity: '0' }], [{ ...item, quantity: '-1' }], [{ ...item, quantity: '0.0001' }], [item, item]]) assert.equal((await request('sales', 'POST', checkout({ items }))).status, 400);
      assert.equal(await prisma.sale.count({ where: { tenantId: tenantA } }), 0);
    });
    await t.test('cash checkout rounds per line, records change and deduplicates concurrent retry', async () => {
      const dto = checkout(); key = dto.idempotencyKey;
      const responses = await Promise.all([request('sales', 'POST', dto), request('sales', 'POST', dto)]);
      for (const response of responses) assert.equal(response.status, 201, await response.clone().text());
      const [a, b] = await Promise.all(responses.map((response) => response.json()));
      saleId = a.id; assert.equal(a.id, b.id); assert.equal(a.total, '20250.56'); assert.equal(a.payment.change, '4749.44'); assert.equal(a.status, 'paid');
      assert.equal(await prisma.sale.count({ where: { tenantId: tenantA } }), 1);
      assert.equal(await prisma.payment.count({ where: { tenantId: tenantA } }), 1);
      const balance = await prisma.stockBalance.findFirstOrThrow({ where: { tenantId: tenantA, productId: product.id } }); assert.equal(balance.quantity.toString(), '18.875');
      const ledger = await prisma.stockMovement.findMany({ where: { tenantId: tenantA } }); assert.equal(ledger.length, 1); assert.equal(ledger[0].quantity.toString(), '-1.125');
      assert.equal((await request('sales', 'POST', { ...dto, tendered: '26000' })).status, 409);
      assert.equal((await request('sales', 'POST', dto, colleagueCookie)).status, 409);
    });
    await t.test('recovery after lost response returns committed sale and immutable receipt snapshot', async () => {
      const recovery = await request(`sales/by-key/${key}?outletId=${outlet.id}`); assert.equal(recovery.status, 200); assert.equal((await recovery.json()).id, saleId);
      assert.equal((await request(`sales/by-key/${key}?outletId=${outlet.id}`, 'GET', undefined, colleagueCookie)).status, 404);
      await prisma.product.update({ where: { id: product.id }, data: { name: 'Renamed coffee', sellingPrice: '19000' } });
      const receipt = await (await request(`sales/${saleId}`)).json(); assert.equal(receipt.items[0].name, 'Coffee snapshot'); assert.equal(receipt.items[0].unitPrice, '18000.5');
      assert.ok(!JSON.stringify(receipt).includes(passwordHash));
      assert.equal((await request('sales', 'POST', checkout())).status, 409);
      await prisma.product.update({ where: { id: product.id }, data: { name: 'Coffee snapshot', sellingPrice: '18000.50' } });
    });
    await t.test('unconfirmed or underpaid EDC does not persist; manual confirmation records actor/time/audit', async () => {
      const before = await prisma.sale.count({ where: { tenantId: tenantA } });
      assert.equal((await request('sales', 'POST', checkout({ method: 'edc' }))).status, 403);
      assert.equal((await request('sales', 'POST', checkout({ method: 'edc', manualConfirmed: true, tendered: '1' }))).status, 400);
      assert.equal((await request('sales', 'POST', checkout({ tendered: '1' }))).status, 400);
      assert.equal(await prisma.sale.count({ where: { tenantId: tenantA } }), before);
      const response = await request('sales', 'POST', checkout({ method: 'edc', manualConfirmed: true, tendered: '20250.56' })); assert.equal(response.status, 201, await response.clone().text());
      const sale = await response.json(); assert.equal(sale.payment.status, 'manually_confirmed'); assert.equal(sale.payment.manualConfirmedBy, cashier.id); assert.ok(sale.payment.confirmedAt);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA, action: 'pos.edc.confirm', entityId: sale.payment.id } }), 1);
      await prisma.role.update({ where: { id: cashierRole.id }, data: { permissions: { set: cashierRole.permissions.filter((permission) => permission !== 'pos.edc.confirm') } } });
      assert.equal((await request('sales', 'POST', checkout({ method: 'edc', manualConfirmed: true, tendered: '20250.56' }))).status, 403);
      await prisma.role.update({ where: { id: cashierRole.id }, data: { permissions: { set: cashierRole.permissions } } });
    });
    await t.test('two different checkouts for final stock yield exactly one sale', async () => {
      const dto = { items: [{ productId: last.id, quantity: '1', expectedPrice: '10' }], tendered: '10' };
      const responses = await Promise.all([request('sales', 'POST', checkout(dto)), request('sales', 'POST', checkout(dto))]); assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      const balance = await prisma.stockBalance.findFirstOrThrow({ where: { tenantId: tenantA, productId: last.id } }); assert.equal(balance.quantity.toString(), '0');
      assert.equal(await prisma.stockMovement.count({ where: { tenantId: tenantA, productId: last.id } }), 1);
    });
    await t.test('failure on a later stock movement rolls back sale, payment, earlier stock and audit', async () => {
      const second = await prisma.product.create({ data: { tenantId: tenantA, sku: 'ROLLBACK', name: 'Later rollback item', sellingPrice: '1' } });
      await prisma.stockBalance.create({ data: { tenantId: tenantA, outletId: outlet.id, productId: second.id, quantity: '10' } });
      const before = await prisma.stockBalance.findFirstOrThrow({ where: { tenantId: tenantA, productId: product.id } });
      const saleCount = await prisma.sale.count({ where: { tenantId: tenantA } });
      const movementCount = await prisma.stockMovement.count({ where: { tenantId: tenantA } });
      const auditCount = await prisma.auditLog.count({ where: { tenantId: tenantA } });
      const suffix = randomUUID().replaceAll('-', '');
      const functionName = `pos_fail_${suffix}`, triggerName = `pos_fail_${suffix}`;
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id = '${tenantA}'::uuid AND NEW.product_id = '${second.id}'::uuid AND NEW.movement_type = 'sale' THEN RAISE EXCEPTION 'injected POS rollback test'; END IF; RETURN NEW; END $$`);
      try {
        await prisma.$executeRawUnsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
        assert.equal((await request('sales', 'POST', checkout({ items: [item, { productId: second.id, quantity: '1', expectedPrice: '1' }] }))).status, 500);
        assert.equal(await prisma.sale.count({ where: { tenantId: tenantA } }), saleCount);
        assert.equal(await prisma.payment.count({ where: { tenantId: tenantA } }), saleCount);
        const after = await prisma.stockBalance.findFirstOrThrow({ where: { id: before.id } }); assert.equal(after.quantity.toString(), before.quantity.toString());
        assert.equal((await prisma.stockBalance.findFirstOrThrow({ where: { tenantId: tenantA, productId: second.id } })).quantity.toString(), '10');
        assert.equal(await prisma.stockMovement.count({ where: { tenantId: tenantA } }), movementCount);
        assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA } }), auditCount);
      } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON stock_movements`); await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`); }
    });
    await t.test('hold does not reserve stock, is owner scoped, reprices on resume and completes once', async () => {
      const dto = { outletId: outlet.id, items: [item], label: 'Waiting customer' };
      const response = await request('pos/holds', 'POST', dto); assert.equal(response.status, 201); const hold = await response.json();
      assert.equal((await request(`pos/holds/${hold.id}`, 'GET', undefined, colleagueCookie)).status, 404);
      assert.equal((await (await request(`pos/holds?outletId=${outlet.id}`, 'GET', undefined, colleagueCookie)).json()).length, 0);
      await prisma.product.update({ where: { id: product.id }, data: { sellingPrice: '20000' } });
      const resumed = await (await request(`pos/holds/${hold.id}`)).json(); assert.equal(resumed.quote.items[0].priceChanged, true); assert.equal(resumed.quote.total, '22500');
      const saleDto = checkout({ items: [{ ...item, expectedPrice: '20000' }], holdId: hold.id, holdVersion: hold.version });
      assert.equal((await request('sales', 'POST', saleDto)).status, 201);
      assert.equal((await request('sales', 'POST', { ...saleDto, idempotencyKey: randomUUID() })).status, 409);
      assert.equal((await request(`pos/holds/${hold.id}`)).status, 404);
    });
    await t.test('inactive outlet and cross-tenant receipts are inaccessible', async () => {
      assert.equal((await request(`sales/${saleId}`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`sales/by-key/${key}?outletId=${foreignOutlet.id}`, 'GET', undefined, foreignCookie)).status, 404);
      await prisma.outlet.update({ where: { id: outlet.id }, data: { status: 'inactive' } });
      assert.equal((await request(`sales/${saleId}`)).status, 403);
      assert.equal((await request('sales', 'POST', checkout())).status, 403);
      await prisma.user.update({ where: { id: cashier.id }, data: { allOutlets: true } });
      assert.equal((await request(`sales/${saleId}`)).status, 404);
      assert.equal((await request('sales', 'POST', checkout())).status, 404);
      assert.equal((await request(`sales/${randomUUID()}`)).status, 404);
    });
  } finally {
    await prisma.session.deleteMany({ where: { tenantId } }); await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.payment.deleteMany({ where: { tenantId } }); await prisma.saleItem.deleteMany({ where: { tenantId } }); await prisma.sale.deleteMany({ where: { tenantId } }); await prisma.heldCart.deleteMany({ where: { tenantId } });
    await prisma.stockMovement.deleteMany({ where: { tenantId } }); await prisma.stockBalance.deleteMany({ where: { tenantId } }); await prisma.userOutlet.deleteMany({ where: { tenantId } }); await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.category.deleteMany({ where: { tenantId } }); await prisma.user.deleteMany({ where: { tenantId } }); await prisma.role.deleteMany({ where: { tenantId } }); await prisma.outlet.deleteMany({ where: { tenantId } }); await prisma.tenant.deleteMany({ where: { id: tenantId } }); await app.close();
  }
});
