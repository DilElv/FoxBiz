import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/password';
import { DEFAULT_ROLES } from '../src/permissions';

type OrderResponse = {
  id: string;
  version: number;
  status: string;
  poNo: string;
  total: string;
  orderedAt?: string;
};
type ReceiptResponse = {
  id: string;
  receivedBy: string;
  stockDocumentId: string;
  items: Array<{ qtyReceived: string }>;
};

test('Sprint 4: purchasing lifecycle, atomic receipts and scoped access', async (t) => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`, prisma = app.get(PrismaService);
  const tenantA = randomUUID(), tenantB = randomUUID(), tenantId = { in: [tenantA, tenantB] };
  const password = randomBytes(18).toString('hex'), passwordHash = await hashPassword(password);
  const cleanupSql: string[] = [];
  try {
    await prisma.tenant.createMany({ data: [tenantA, tenantB].map((id) => ({ id, name: 'Purchasing test', slug: `buy-${id}` })) });
    await prisma.role.createMany({ data: [tenantA, tenantB].flatMap((id) => DEFAULT_ROLES.map((role) => ({ ...role, tenantId: id }))) });
    const roles = await prisma.role.findMany({ where: { tenantId: tenantA } });
    const main = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Main', code: 'MAIN' } });
    const branch = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Branch', code: 'BRANCH' } });
    const foreignOutlet = await prisma.outlet.create({ data: { tenantId: tenantB, name: 'Foreign', code: 'FOREIGN' } });
    async function user(name: string, role: string, allOutlets = false) { return prisma.user.create({ data: { tenantId: tenantA, name, email: `${name}@buy.test`, passwordHash, roleId: roles.find((item) => item.code === role)!.id, allOutlets } }); }
    const manager = await user('manager', 'manager', true), manager2 = await user('manager2', 'manager', true), staff = await user('staff', 'inventory'), cashier = await user('cashier', 'cashier');
    await prisma.userOutlet.createMany({ data: [staff, cashier].map((entry) => ({ tenantId: tenantA, userId: entry.id, outletId: main.id })) });
    const foreignRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantB, code: 'manager' } } });
    const foreignUser = await prisma.user.create({ data: { tenantId: tenantB, email: 'foreign@buy.test', name: 'foreign', passwordHash, roleId: foreignRole.id, allOutlets: true } });
    const p1 = await prisma.product.create({ data: { tenantId: tenantA, sku: 'BUY-A', name: 'Beans', unit: 'kg', sellingPrice: '200' } });
    const p2 = await prisma.product.create({ data: { tenantId: tenantA, sku: 'BUY-B', name: 'Tea', unit: 'kg', sellingPrice: '300' } });
    const pForeign = await prisma.product.create({ data: { tenantId: tenantB, sku: 'FOREIGN', name: 'Foreign', sellingPrice: '1' } });
    const foreignSupplier = await prisma.supplier.create({ data: { tenantId: tenantB, name: 'Foreign supplier' } });
    async function login(email: string, tenant = tenantA) { const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug: `buy-${tenant}`, email, password }) }); assert.equal(response.status, 201); return response.headers.get('set-cookie')!.split(';')[0]; }
    const cookie = await login(manager.email), secondCookie = await login(manager2.email), staffCookie = await login(staff.email), cashierCookie = await login(cashier.email), foreignCookie = await login(foreignUser.email, tenantB);
    const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}/${path}`, { method, headers: { Cookie: auth, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    async function json<T = unknown>(response: Response, status = 201): Promise<T> { assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<T>; }
    const item = (productId = p1.id, qtyOrdered = '10', unitCost = '1.25') => ({ productId, qtyOrdered, unitCost });
    let supplierId = '', orderId = '', orderKey = '', receiptKey = '', receiptId = '';
    const po = (items = [item()], extra: Record<string, unknown> = {}) => ({ idempotencyKey: randomUUID(), outletId: main.id, supplierId, note: 'Pesanan test', items, ...extra });
    const receipt = (purchaseOrderId: string, qtyReceived = '1', extra: Record<string, unknown> = {}) => ({ idempotencyKey: randomUUID(), outletId: main.id, purchaseOrderId, note: 'Barang fisik diperiksa', externalReference: 'SJ-TEST', items: [{ productId: p1.id, qtyReceived }], ...extra });
    const getOrder = (id: string) => prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
    const balance = async (id = p1.id) => (await prisma.stockBalance.findUnique({ where: { tenantId_outletId_productId: { tenantId: tenantA, outletId: main.id, productId: id } } }))?.quantity.toString() ?? '0';
    async function ordered(items = [item()]) { const order = await json<OrderResponse>(await request('purchase-orders', 'POST', po(items))); return json<OrderResponse>(await request(`purchase-orders/${order.id}/order`, 'POST', { version: order.version })); }

    await t.test('supplier master, permissions and malformed/foreign inputs', async () => {
      supplierId = (await json<{ id: string }>(await request('suppliers', 'POST', { name: 'Supplier A', contact: '0812', status: 'active' }))).id;
      assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA, action: 'supplier.create' } }), 1);
      assert.equal((await request('suppliers', 'POST', { name: 'Supplier A', contact: '', status: 'active' })).status, 409);
      assert.equal((await request('suppliers', 'POST', { name: '   ', contact: '', status: 'active' })).status, 400);
      assert.equal((await request('suppliers', 'POST', { name: 'Denied', contact: '', status: 'active' }, staffCookie)).status, 403);
      assert.equal((await request('suppliers', 'GET', undefined, cashierCookie)).status, 403);
      assert.equal((await request(`suppliers/${foreignSupplier.id}`, 'PATCH', { name: 'Forged', contact: '', status: 'active' })).status, 404);
      assert.equal((await request('purchase-orders', 'POST', po(), staffCookie)).status, 403);
      assert.equal((await request('purchase-orders', 'POST', po([item(pForeign.id)]))).status, 404);
      assert.equal((await request('purchase-orders', 'POST', po([item()], { supplierId: foreignSupplier.id }))).status, 404);
      for (const items of [[item(p1.id, '0')], [item(), item()], [item(p1.id, '-1')], [item(p1.id, '1.0001')], [item(p1.id, '1', '-1')], [item(p1.id, '1', '0.001')], [item(p1.id, '99999999999', '999999999999')]]) assert.equal((await request('purchase-orders', 'POST', po(items))).status, 400);
      assert.equal((await request('purchase-orders', 'POST', po([item()], { outletId: branch.id }), staffCookie)).status, 403);
    });
    await t.test('draft totals use Decimal HALF_UP, versioned editing and immutable ordered lines', async () => {
      const body = po([item(p1.id, '0.005', '1'), item(p2.id, '2', '2.25')]); orderKey = body.idempotencyKey;
      const draft = await json<OrderResponse>(await request('purchase-orders', 'POST', body)); orderId = draft.id;
      assert.equal(draft.total, '4.51'); assert.equal(draft.status, 'draft'); assert.ok(draft.poNo.startsWith('PO-'));
      const replay = await json<OrderResponse>(await request('purchase-orders', 'POST', body)); assert.equal(replay.id, draft.id);
      assert.equal((await request('purchase-orders', 'POST', { ...body, note: 'different' })).status, 409);
      assert.equal((await request('purchase-orders', 'POST', body, secondCookie)).status, 409);
      assert.equal((await request('goods-receipts', 'POST', receipt(orderId))).status, 409);
      const edit = { version: 1, supplierId, note: 'Revised', items: [item(), item(p2.id, '2', '0')] };
      const revised = await json<OrderResponse>(await request(`purchase-orders/${draft.id}`, 'PATCH', edit), 200); assert.equal(revised.version, 2); assert.equal(revised.total, '12.5');
      assert.equal((await request(`purchase-orders/${draft.id}`, 'PATCH', edit)).status, 409);
      const ordered = await json<OrderResponse>(await request(`purchase-orders/${draft.id}/order`, 'POST', { version: 2 })); assert.equal(ordered.status, 'ordered'); assert.ok(ordered.orderedAt);
      assert.equal((await request(`purchase-orders/${draft.id}`, 'PATCH', { ...edit, version: ordered.version })).status, 409);
      await json(await request(`purchase-orders/${draft.id}/order`, 'POST', { version: 2 }));
      assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA, entityId: draft.id, action: 'purchase_order.order' } }), 1);
      assert.equal(await balance(), '0');
    });
    await t.test('partial receipt atomically updates one stock ledger, audit and PO; replay adds nothing', async () => {
      const body = receipt(orderId, '4'); receiptKey = body.idempotencyKey;
      const gr = await json<ReceiptResponse>(await request('goods-receipts', 'POST', body, staffCookie)); receiptId = gr.id;
      assert.equal(gr.receivedBy, staff.id); assert.equal(gr.items[0].qtyReceived, '4'); assert.equal(await balance(), '4');
      const order = await getOrder(orderId); assert.equal(order.status, 'partially_received'); assert.equal(order.items.find((entry) => entry.productId === p1.id)!.qtyReceived.toString(), '4');
      const doc = await prisma.stockDocument.findUniqueOrThrow({ where: { id: gr.stockDocumentId }, include: { items: true } }); assert.equal(doc.kind, 'receiving'); assert.equal(doc.items[0].quantity.toString(), '4');
      const movement = await prisma.stockMovement.findFirstOrThrow({ where: { tenantId: tenantA, reference: `stock:${doc.id}` } }); assert.equal(movement.movementType, 'purchase_receipt'); assert.equal(movement.beforeQuantity!.toString(), '0'); assert.equal(movement.afterQuantity!.toString(), '4');
      assert.equal((await json<ReceiptResponse>(await request('goods-receipts', 'POST', body, staffCookie))).id, gr.id); assert.equal(await balance(), '4');
      assert.equal((await request('goods-receipts', 'POST', { ...body, note: 'changed' }, staffCookie)).status, 409);
      assert.equal((await request('goods-receipts', 'POST', body)).status, 409);
      assert.equal(await prisma.auditLog.count({ where: { tenantId: tenantA, entityId: gr.id, action: 'goods_receipt.create' } }), 1);
      assert.equal((await request(`purchase-orders/${orderId}/cancel`, 'POST', { version: order.version, reason: 'Cannot cancel' })).status, 409);
    });
    await t.test('over-receipt, duplicate/foreign products and invalid quantity leave no changes', async () => {
      const before = await prisma.goodsReceipt.count({ where: { tenantId: tenantA } });
      for (const body of [receipt(orderId, '7'), receipt(orderId, '0'), receipt(orderId, '-1'), receipt(orderId, '1.0001'), receipt(orderId, '1', { note: '   ' }), receipt(orderId, '1', { items: [{ productId: pForeign.id, qtyReceived: '1' }] }), receipt(orderId, '1', { items: [{ productId: p1.id, qtyReceived: '1' }, { productId: p1.id, qtyReceived: '1' }] })]) assert.ok([400, 409].includes((await request('goods-receipts', 'POST', body)).status));
      assert.equal(await prisma.goodsReceipt.count({ where: { tenantId: tenantA } }), before); assert.equal(await balance(), '4');
      const body = receipt(orderId, '6', { items: [{ productId: p1.id, qtyReceived: '6' }, { productId: p2.id, qtyReceived: '2' }] });
      await json(await request('goods-receipts', 'POST', body)); assert.equal((await getOrder(orderId)).status, 'received'); assert.equal(await balance(), '10'); assert.equal(await balance(p2.id), '2');
      assert.equal((await request('goods-receipts', 'POST', receipt(orderId))).status, 409);
    });
    await t.test('concurrent receipts serialize against remaining quantity and same-key replay is single-posted', async () => {
      const order = await ordered([item(p1.id, '5')]);
      const responses = await Promise.all([request('goods-receipts', 'POST', receipt(order.id, '4')), request('goods-receipts', 'POST', receipt(order.id, '4'))]);
      assert.deepEqual(responses.map((entry) => entry.status).sort(), [201, 409]); assert.equal(await balance(), '14');
      const body = receipt(order.id, '1'); const replays = await Promise.all([request('goods-receipts', 'POST', body), request('goods-receipts', 'POST', body)]);
      assert.deepEqual(replays.map((entry) => entry.status), [201, 201]); const replayBodies = await Promise.all(replays.map((entry) => json<{ id: string }>(entry))); assert.equal(replayBodies[0].id, replayBodies[1].id); assert.equal(await balance(), '15'); assert.equal((await getOrder(order.id)).status, 'received');
    });
    await t.test('cancellation and inactive supplier/product policy enforce lifecycle', async () => {
      const draft = await json<OrderResponse>(await request('purchase-orders', 'POST', po()));
      assert.equal((await request(`purchase-orders/${draft.id}/cancel`, 'POST', { version: 1, reason: 'x' })).status, 400);
      await json(await request(`purchase-orders/${draft.id}/cancel`, 'POST', { version: 1, reason: 'Duplicate order' }));
      assert.equal((await request(`purchase-orders/${draft.id}/order`, 'POST', { version: 2 })).status, 409);
      assert.equal((await request('goods-receipts', 'POST', receipt(draft.id))).status, 409);
      const order = await ordered([item(p1.id, '1')]);
      await json(await request(`suppliers/${supplierId}`, 'PATCH', { name: 'Renamed supplier', contact: '', status: 'inactive' }), 200);
      assert.equal((await request('purchase-orders', 'POST', po())).status, 404);
      await prisma.product.update({ where: { id: p1.id }, data: { status: 'inactive' } });
      await json(await request('goods-receipts', 'POST', receipt(order.id)));
      assert.equal((await getOrder(order.id)).supplierName, 'Supplier A');
      await prisma.product.update({ where: { id: p1.id }, data: { status: 'active' } });
      await json(await request(`suppliers/${supplierId}`, 'PATCH', { name: 'Supplier A', contact: '', status: 'active' }), 200);
    });
    await t.test('injected ledger failure rolls back PO quantities, receipt, stock document, balances and audits', async () => {
      const order = await ordered([item(p1.id, '2'), item(p2.id, '2')]);
      const counts = async () => Promise.all([prisma.goodsReceipt.count({ where: { tenantId: tenantA } }), prisma.stockDocument.count({ where: { tenantId: tenantA } }), prisma.stockMovement.count({ where: { tenantId: tenantA } }), prisma.auditLog.count({ where: { tenantId: tenantA } }), balance(), balance(p2.id)]);
      const before = await counts(), functionName = `buy_fail_${randomUUID().replaceAll('-', '')}`;
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id = '${tenantA}'::uuid AND NEW.product_id = '${p2.id}'::uuid AND NEW.movement_type = 'purchase_receipt' THEN RAISE EXCEPTION 'injected purchasing rollback'; END IF; RETURN NEW; END $$`);
      cleanupSql.push(`DROP TRIGGER IF EXISTS ${functionName} ON stock_movements`, `DROP FUNCTION IF EXISTS ${functionName}()`);
      try {
        await prisma.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
        assert.equal((await request('goods-receipts', 'POST', receipt(order.id, '1', { items: [{ productId: p1.id, qtyReceived: '1' }, { productId: p2.id, qtyReceived: '1' }] }))).status, 500);
        assert.deepEqual(await counts(), before); const after = await getOrder(order.id); assert.equal(after.status, 'ordered'); assert.ok(after.items.every((entry) => entry.qtyReceived.isZero()));
      } finally { for (const sql of cleanupSql.splice(0)) await prisma.$executeRawUnsafe(sql); }
    });
    await t.test('tenant/outlet/creator scoping, recovery, role denial and inactive outlet', async () => {
      assert.equal((await request(`purchase-orders/by-key/${orderKey}?outletId=${main.id}`)).status, 200);
      assert.equal((await request(`purchase-orders/by-key/${orderKey}?outletId=${main.id}`, 'GET', undefined, secondCookie)).status, 404);
      assert.equal((await request(`goods-receipts/by-key/${receiptKey}?outletId=${main.id}`, 'GET', undefined, staffCookie)).status, 200);
      assert.equal((await request(`goods-receipts/by-key/${receiptKey}?outletId=${main.id}`)).status, 404);
      assert.equal((await request(`purchase-orders/${orderId}?outletId=${branch.id}`)).status, 404);
      assert.equal((await request(`purchase-orders?outletId=${branch.id}`, 'GET', undefined, staffCookie)).status, 403);
      assert.equal((await request('goods-receipts', 'POST', receipt(orderId), cashierCookie)).status, 403);
      assert.equal((await request(`purchase-orders/${orderId}/order`, 'POST', { version: 1 }, staffCookie)).status, 403);
      assert.equal((await request(`purchase-orders/${orderId}?outletId=${foreignOutlet.id}`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`goods-receipts/by-key/${receiptKey}?outletId=${foreignOutlet.id}`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`purchase-orders?outletId=${main.id}`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`goods-receipts?outletId=${main.id}`)).status, 200);
      assert.equal(await prisma.goodsReceipt.count({ where: { id: receiptId } }), 1);
      await prisma.outlet.update({ where: { id: main.id }, data: { status: 'inactive' } });
      assert.equal((await request(`purchase-orders?outletId=${main.id}`, 'GET', undefined, staffCookie)).status, 403);
      assert.equal((await request(`purchase-orders?outletId=${main.id}`)).status, 404);
      assert.equal((await request(`goods-receipts/by-key/${receiptKey}?outletId=${main.id}`, 'GET', undefined, staffCookie)).status, 403);
    });
  } finally {
    for (const sql of cleanupSql) await prisma.$executeRawUnsafe(sql).catch(() => {});
    await prisma.session.deleteMany({ where: { tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.goodsReceiptItem.deleteMany({ where: { tenantId } });
    await prisma.goodsReceipt.deleteMany({ where: { tenantId } });
    await prisma.purchaseOrderItem.deleteMany({ where: { tenantId } });
    await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
    await prisma.supplier.deleteMany({ where: { tenantId } });
    await prisma.stockDocumentItem.deleteMany({ where: { tenantId } });
    await prisma.stockDocument.deleteMany({ where: { tenantId } });
    await prisma.stockMovement.deleteMany({ where: { tenantId } });
    await prisma.stockBalance.deleteMany({ where: { tenantId } });
    await prisma.userOutlet.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.role.deleteMany({ where: { tenantId } });
    await prisma.outlet.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } }); await app.close();
  }
});
