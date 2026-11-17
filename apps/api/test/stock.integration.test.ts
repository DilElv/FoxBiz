import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/password';
import { DEFAULT_ROLES } from '../src/permissions';

test('Sprint 3: adjustments, receiving, transfers, audit and stock isolation', async (t) => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`, prisma = app.get(PrismaService);
  const tenantA = randomUUID(), tenantB = randomUUID(), tenantId = { in: [tenantA, tenantB] };
  const password = randomBytes(18).toString('hex'), passwordHash = await hashPassword(password);
  const cleanupSql: string[] = [];
  try {
    await prisma.tenant.createMany({ data: [tenantA, tenantB].map((id) => ({ id, slug: `stock-${id}`, name: `Stock ${id}` })) });
    await prisma.role.createMany({ data: DEFAULT_ROLES.map((role) => ({ ...role, tenantId: tenantA })) });
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantA, code: 'manager' } } });
    const inventoryRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantA, code: 'inventory' } } });
    const cashierRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantA, code: 'cashier' } } });
    const main = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Main Store', code: 'MAIN' } });
    const branch = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Branch Store', code: 'BRANCH' } });
    const third = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Third Store', code: 'THIRD' } });
    const foreignOutlet = await prisma.outlet.create({ data: { tenantId: tenantB, name: 'Foreign Store', code: 'FOREIGN' } });
    const manager = await prisma.user.create({ data: { tenantId: tenantA, name: 'Stock Manager', email: 'manager@stock.test', passwordHash, roleId: managerRole.id, allOutlets: true } });
    const manager2 = await prisma.user.create({ data: { tenantId: tenantA, name: 'Second Manager', email: 'manager2@stock.test', passwordHash, roleId: managerRole.id, allOutlets: true } });
    const mainStaff = await prisma.user.create({ data: { tenantId: tenantA, name: 'Main Staff', email: 'main@stock.test', passwordHash, roleId: inventoryRole.id } });
    const branchStaff = await prisma.user.create({ data: { tenantId: tenantA, name: 'Branch Staff', email: 'branch@stock.test', passwordHash, roleId: inventoryRole.id } });
    const thirdStaff = await prisma.user.create({ data: { tenantId: tenantA, name: 'Third Staff', email: 'third@stock.test', passwordHash, roleId: inventoryRole.id } });
    const cashier = await prisma.user.create({ data: { tenantId: tenantA, name: 'Cashier', email: 'cashier@stock.test', passwordHash, roleId: cashierRole.id } });
    await prisma.userOutlet.createMany({ data: [{ userId: mainStaff.id, outletId: main.id }, { userId: branchStaff.id, outletId: branch.id }, { userId: thirdStaff.id, outletId: third.id }, { userId: cashier.id, outletId: main.id }].map((entry) => ({ ...entry, tenantId: tenantA })) });
    const foreignRole = await prisma.role.create({ data: { tenantId: tenantB, name: 'Manager', code: 'manager', permissions: managerRole.permissions } });
    const foreignUser = await prisma.user.create({ data: { tenantId: tenantB, name: 'Foreign Manager', email: 'manager@stock.test', passwordHash, roleId: foreignRole.id, allOutlets: true } });
    const product = (sku: string, name: string, status = 'active') => prisma.product.create({ data: { tenantId: tenantA, sku, name, sellingPrice: '1000', unit: 'pcs', status } });
    const p1 = await product('SKU-A', 'Coffee beans');
    const p2 = await product('SKU-B', 'Tea leaves');
    const p3 = await product('SKU-C', 'Cups');
    const p4 = await product('SKU-D', 'Never stocked');
    const pRoll = await product('SKU-ROLL', 'Rollback keeper');
    const pFail = await product('SKU-FAIL', 'Rollback trigger');
    const pInactive = await product('SKU-OFF', 'Inactive item', 'inactive');
    const foreignProduct = await prisma.product.create({ data: { tenantId: tenantB, sku: 'SKU-F', name: 'Foreign item', sellingPrice: '1' } });
    await prisma.stockBalance.createMany({ data: [
      { tenantId: tenantA, outletId: main.id, productId: p1.id, quantity: '10', openedAt: new Date() },
      { tenantId: tenantA, outletId: main.id, productId: p2.id, quantity: '5', openedAt: new Date() },
      { tenantId: tenantA, outletId: main.id, productId: p3.id, quantity: '0', openedAt: new Date() },
      { tenantId: tenantA, outletId: main.id, productId: pRoll.id, quantity: '10', openedAt: new Date() },
      { tenantId: tenantA, outletId: main.id, productId: pFail.id, quantity: '10', openedAt: new Date() },
      { tenantId: tenantA, outletId: branch.id, productId: p1.id, quantity: '2', openedAt: new Date() },
    ] });
    async function login(email: string, tenant = tenantA) { const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug: `stock-${tenant}`, email, password }) }); assert.equal(response.status, 201); return response.headers.get('set-cookie')!.split(';')[0]; }
    const cookie = await login(manager.email), manager2Cookie = await login(manager2.email), mainCookie = await login(mainStaff.email), branchCookie = await login(branchStaff.email), thirdCookie = await login(thirdStaff.email), cashierCookie = await login(cashier.email), foreignCookie = await login(foreignUser.email, tenantB);
    const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}/${path}`, { method, headers: { Cookie: auth, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    type Line = { productId: string; quantity: string };
    const draft = (kind: string, items: Line[], extra: Record<string, unknown> = {}) => ({ idempotencyKey: randomUUID(), outletId: main.id, kind, note: `Catatan ${kind}`, externalReference: '', items, ...extra });
    const line = (entry: { id: string }, quantity: string): Line => ({ productId: entry.id, quantity });
    const balance = async (outletId: string, productId: string) => prisma.stockBalance.findUnique({ where: { tenantId_outletId_productId: { tenantId: tenantA, outletId, productId } } });

    await t.test('permissions, destinations, malformed documents and tenant/outlet forgery are rejected', async () => {
      const destinations = await request(`inventory/destinations?outletId=${main.id}`); assert.equal(destinations.status, 200);
      assert.deepEqual((await destinations.json()).map((outlet: { id: string }) => outlet.id).sort(), [branch.id, third.id].sort());
      assert.equal((await request(`inventory/destinations?outletId=${main.id}`, 'GET', undefined, cashierCookie)).status, 403);
      assert.equal((await request('inventory/documents', 'POST', draft('adjustment', [line(p1, '1')]), cashierCookie)).status, 403);
      assert.equal((await request('inventory/documents', 'POST', draft('adjustment', [line(p1, '1')], { outletId: branch.id }), mainCookie)).status, 403);
      assert.equal((await request('inventory/documents', 'POST', draft('transfer', [line(p1, '1')], { destinationOutletId: main.id }))).status, 400);
      assert.equal((await request('inventory/documents', 'POST', draft('transfer', [line(p1, '1')], { destinationOutletId: foreignOutlet.id }))).status, 404);
      assert.equal((await request('inventory/documents', 'POST', draft('adjustment', [line(p1, '0')]))).status, 400);
      assert.equal((await request('inventory/documents', 'POST', draft('adjustment', [line(p1, '1'), line(p1, '2')]))).status, 400);
      assert.equal((await request('inventory/documents', 'POST', draft('adjustment', [line(p1, '1')], { note: 'x' }))).status, 400);
      assert.equal((await request('inventory/documents', 'POST', draft('receiving', [line(p1, '1')], { destinationOutletId: branch.id }))).status, 400);
      assert.equal((await request('inventory/documents', 'POST', draft('receiving', [line(p1, '-1')]))).status, 400);
      assert.equal((await request('inventory/documents', 'POST', draft('receiving', [line(p1, '1')], { externalReference: 'x'.repeat(101) }))).status, 400);
      assert.equal((await request('inventory/documents', 'POST', draft('receiving', [line(foreignProduct, '1')]))).status, 404);
      assert.equal((await request('inventory/documents', 'POST', draft('receiving', [line(pInactive, '1')]))).status, 404);
      assert.equal(await prisma.stockDocument.count({ where: { tenantId: tenantA } }), 0);
      assert.equal((await balance(main.id, p1.id))!.quantity.toString(), '10');
    });

    let adjustmentKey = '', adjustmentId = '';
    await t.test('adjustment is signed, audited, replay-safe and cannot create negative stock', async () => {
      const body = draft('adjustment', [line(p1, '-2.5'), line(p3, '4')], { externalReference: 'OPNAME-1', note: 'Koreksi stok opname' });
      adjustmentKey = body.idempotencyKey;
      const response = await request('inventory/documents', 'POST', body); assert.equal(response.status, 201, await response.clone().text());
      const document = await response.json(); adjustmentId = document.id;
      assert.equal(document.status, 'posted'); assert.equal(document.destinationOutletId, null); assert.equal(document.externalReference, 'OPNAME-1');
      assert.equal((await balance(main.id, p1.id))!.quantity.toString(), '7.5');
      assert.equal((await balance(main.id, p3.id))!.quantity.toString(), '4');
      const movements = await prisma.stockMovement.findMany({ where: { tenantId: tenantA, reference: `stock:${document.id}` } });
      assert.equal(movements.length, 2);
      const movement = movements.find((entry) => entry.productId === p1.id)!;
      assert.equal(movement.quantity.toString(), '-2.5'); assert.equal(movement.beforeQuantity!.toString(), '10'); assert.equal(movement.afterQuantity!.toString(), '7.5'); assert.equal(movement.note, 'Koreksi stok opname');
      assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA, action: 'inventory.adjustment', entityId: document.id } }), 1);
      const replay = await request('inventory/documents', 'POST', body); assert.equal(replay.status, 201); assert.equal((await replay.json()).id, document.id);
      assert.equal((await balance(main.id, p1.id))!.quantity.toString(), '7.5'); assert.equal(await prisma.stockMovement.count({ where: { tenantId: tenantA, reference: `stock:${document.id}` } }), 2);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA, action: 'inventory.adjustment', entityId: document.id } }), 1);
      assert.equal((await request('inventory/documents', 'POST', { ...body, note: 'Payload berbeda' })).status, 409);
      assert.equal((await request('inventory/documents', 'POST', body, mainCookie)).status, 409);
      const documents = await prisma.stockDocument.count({ where: { tenantId: tenantA } });
      assert.equal((await request('inventory/documents', 'POST', draft('adjustment', [line(p1, '-100')], { note: 'Melebihi saldo' }))).status, 409);
      assert.equal(await prisma.stockDocument.count({ where: { tenantId: tenantA } }), documents);
      assert.equal((await balance(main.id, p1.id))!.quantity.toString(), '7.5');
      const created = await request('inventory/documents', 'POST', draft('adjustment', [line(p4, '2')], { note: 'Stok awal opname' })); assert.equal(created.status, 201);
      const opened = (await balance(main.id, p4.id))!; assert.equal(opened.quantity.toString(), '2'); assert.ok(opened.openedAt);
    });

    await t.test('receiving adds stock without supplier integration and rejects unauthorized roles', async () => {
      const response = await request('inventory/documents', 'POST', draft('receiving', [line(p1, '3'), line(p2, '1.25')], { note: 'Terima kiriman supplier', externalReference: 'SJ-1' }), mainCookie);
      assert.equal(response.status, 201, await response.clone().text()); const document = await response.json();
      assert.equal(document.status, 'posted'); assert.equal(document.destinationOutletId, null);
      assert.equal((await balance(main.id, p1.id))!.quantity.toString(), '10.5');
      assert.equal((await balance(main.id, p2.id))!.quantity.toString(), '6.25');
      assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA, action: 'inventory.receiving', entityId: document.id } }), 1);
      assert.equal((await request('inventory/documents', 'POST', draft('receiving', [line(p1, '1')]), cashierCookie)).status, 403);
    });

    let transferId = '';
    await t.test('transfer deducts on send, stays in transit and is received once by destination staff', async () => {
      const body = draft('transfer', [line(p1, '4'), line(p2, '2.25')], { destinationOutletId: branch.id, note: 'Kirim ke cabang', externalReference: 'SJ-TR-1' });
      const response = await request('inventory/documents', 'POST', body); assert.equal(response.status, 201, await response.clone().text());
      const document = await response.json(); transferId = document.id;
      assert.equal(document.status, 'sent'); assert.equal(document.receivedBy, null); assert.equal(document.destinationOutlet.id, branch.id);
      assert.equal((await balance(main.id, p1.id))!.quantity.toString(), '6.5');
      assert.equal((await balance(main.id, p2.id))!.quantity.toString(), '4');
      assert.equal((await balance(branch.id, p1.id))!.quantity.toString(), '2');
      assert.equal(await balance(branch.id, p2.id), null);
      const outbound = await prisma.stockMovement.findMany({ where: { tenantId: tenantA, reference: `stock:${document.id}`, movementType: 'transfer_out' } }); assert.equal(outbound.length, 2);
      const branchDocuments = await request(`inventory/documents?outletId=${branch.id}`, 'GET', undefined, branchCookie);
      assert.equal(branchDocuments.status, 200); assert.equal((await branchDocuments.json()).items[0].id, document.id);
      assert.equal((await request(`inventory/documents?outletId=${branch.id}`, 'GET', undefined, mainCookie)).status, 403);
      assert.equal((await request(`inventory/documents/${document.id}/receive`, 'POST', {}, mainCookie)).status, 403);
      assert.equal((await request(`inventory/documents/${document.id}/receive`, 'POST', {}, cashierCookie)).status, 403);
      const received = await request(`inventory/documents/${document.id}/receive`, 'POST', {}, branchCookie); assert.equal(received.status, 201, await received.clone().text());
      const receivedDocument = await received.json(); assert.equal(receivedDocument.status, 'received'); assert.equal(receivedDocument.receivedBy, branchStaff.id); assert.ok(receivedDocument.receivedAt);
      assert.equal((await balance(branch.id, p1.id))!.quantity.toString(), '6');
      assert.equal((await balance(branch.id, p2.id))!.quantity.toString(), '2.25');
      assert.equal((await balance(main.id, p1.id))!.quantity.toString(), '6.5');
      assert.equal(await prisma.stockMovement.count({ where: { tenantId: tenantA, reference: `stock:${document.id}`, movementType: 'transfer_in' } }), 2);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA, action: 'inventory.transfer.receive', entityId: document.id } }), 1);
      const replay = await request(`inventory/documents/${document.id}/receive`, 'POST', {}, branchCookie); assert.equal(replay.status, 201);
      assert.equal((await replay.json()).status, 'received'); assert.equal((await balance(branch.id, p1.id))!.quantity.toString(), '6');
      assert.equal(await prisma.stockMovement.count({ where: { tenantId: tenantA, reference: `stock:${document.id}`, movementType: 'transfer_in' } }), 2);
      assert.equal((await request('inventory/documents', 'POST', draft('transfer', [line(p3, '10')], { destinationOutletId: branch.id, note: 'Melebihi stok' }))).status, 409);
    });

    await t.test('concurrent transfers of final stock produce one document and never negative stock', async () => {
      const first = draft('transfer', [line(p2, '4')], { destinationOutletId: branch.id, note: 'Transfer final A' });
      const second = draft('transfer', [line(p2, '4')], { destinationOutletId: third.id, note: 'Transfer final B' });
      const responses = await Promise.all([request('inventory/documents', 'POST', first), request('inventory/documents', 'POST', second)]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.equal((await balance(main.id, p2.id))!.quantity.toString(), '0');
      assert.equal(await prisma.stockDocument.count({ where: { tenantId: tenantA, idempotencyKey: { in: [first.idempotencyKey, second.idempotencyKey] } } }), 1);
    });

    await t.test('failure on a later stock movement rolls back document, stock, ledger and audit', async () => {
      const before = { documents: await prisma.stockDocument.count({ where: { tenantId: tenantA } }), movements: await prisma.stockMovement.count({ where: { tenantId: tenantA } }), audits: await prisma.auditLog.count({ where: { tenantId: tenantA } }) };
      const roll = (await balance(main.id, pRoll.id))!.quantity.toString(), fail = (await balance(main.id, pFail.id))!.quantity.toString();
      const suffix = randomUUID().replaceAll('-', ''), functionName = `stock_fail_${suffix}`, triggerName = `stock_fail_${suffix}`;
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id = '${tenantA}'::uuid AND NEW.product_id = '${pFail.id}'::uuid AND NEW.movement_type = 'receiving' THEN RAISE EXCEPTION 'injected stock rollback test'; END IF; RETURN NEW; END $$`);
      cleanupSql.push(`DROP TRIGGER IF EXISTS ${triggerName} ON stock_movements`, `DROP FUNCTION IF EXISTS ${functionName}()`);
      try {
        await prisma.$executeRawUnsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
        assert.equal((await request('inventory/documents', 'POST', draft('receiving', [line(pRoll, '1'), line(pFail, '1')], { note: 'Uji rollback penerimaan' }))).status, 500);
        assert.equal(await prisma.stockDocument.count({ where: { tenantId: tenantA } }), before.documents);
        assert.equal(await prisma.stockMovement.count({ where: { tenantId: tenantA } }), before.movements);
        assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA } }), before.audits);
        assert.equal((await balance(main.id, pRoll.id))!.quantity.toString(), roll);
        assert.equal((await balance(main.id, pFail.id))!.quantity.toString(), fail);
      } finally { for (const sql of cleanupSql.splice(0)) await prisma.$executeRawUnsafe(sql); }
    });

    await t.test('documents, recovery and reports stay tenant/outlet/creator scoped', async () => {
      assert.equal((await request(`inventory/documents/by-key/${adjustmentKey}?outletId=${main.id}`)).status, 200);
      assert.equal((await request(`inventory/documents/by-key/${adjustmentKey}?outletId=${main.id}`, 'GET', undefined, manager2Cookie)).status, 404);
      assert.equal((await request(`inventory/documents/${adjustmentId}?outletId=${main.id}`)).status, 200);
      assert.equal((await request(`inventory/documents/${adjustmentId}?outletId=${third.id}`, 'GET', undefined, thirdCookie)).status, 404);
      assert.equal((await request(`inventory/documents/${adjustmentId}?outletId=${branch.id}`, 'GET', undefined, branchCookie)).status, 404);
      assert.equal((await request(`inventory/documents/${transferId}?outletId=${branch.id}`, 'GET', undefined, branchCookie)).status, 200);
      assert.equal((await request(`inventory/documents/${adjustmentId}?outletId=${foreignOutlet.id}`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`inventory/documents/by-key/${adjustmentKey}?outletId=${foreignOutlet.id}`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`inventory/documents?outletId=${foreignOutlet.id}`, 'GET', undefined, foreignCookie)).status, 200);
      assert.equal((await request(`inventory/documents?outletId=${main.id}`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`inventory/documents?outletId=${main.id}`, 'GET', undefined, cashierCookie)).status, 200);
      await prisma.outlet.update({ where: { id: main.id }, data: { status: 'inactive' } });
      assert.equal((await request(`inventory/documents?outletId=${main.id}`, 'GET', undefined, cashierCookie)).status, 403);
      assert.equal((await request(`inventory/documents?outletId=${main.id}`, 'GET', undefined, cookie)).status, 404);
      const inactiveSend = draft('adjustment', [line(p1, '1')], { note: 'Outlet nonaktif' });
      assert.equal((await request('inventory/documents', 'POST', inactiveSend)).status, 404);
      assert.equal((await request(`inventory/documents/by-key/${adjustmentKey}?outletId=${main.id}`)).status, 404);
    });
  } finally {
    for (const sql of cleanupSql) await prisma.$executeRawUnsafe(sql).catch(() => {});
    await prisma.session.deleteMany({ where: { tenantId } }); await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.stockDocumentItem.deleteMany({ where: { tenantId } }); await prisma.stockDocument.deleteMany({ where: { tenantId } });
    await prisma.stockMovement.deleteMany({ where: { tenantId } }); await prisma.stockBalance.deleteMany({ where: { tenantId } });
    await prisma.userOutlet.deleteMany({ where: { tenantId } }); await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } }); await prisma.role.deleteMany({ where: { tenantId } }); await prisma.outlet.deleteMany({ where: { tenantId } }); await prisma.tenant.deleteMany({ where: { id: tenantId } }); await app.close();
  }
});
