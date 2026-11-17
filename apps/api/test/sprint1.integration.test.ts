import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/password';
import { DEFAULT_ROLES, PERMISSIONS } from '../src/permissions';

test('Sprint 1: identity, tenant/outlet authorization, catalog and atomic opening ledger', async (t) => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`, prisma = app.get(PrismaService);
  const tenantA = randomUUID(), tenantB = randomUUID(), tenantId = { in: [tenantA, tenantB] };
  const password = randomBytes(18).toString('hex'), passwordHash = await hashPassword(password);
  try {
    await prisma.tenant.createMany({ data: [{ id: tenantA, slug: `a-${tenantA}`, name: 'Alpha' }, { id: tenantB, slug: `b-${tenantB}`, name: 'Beta' }] });
    await prisma.role.createMany({ data: [tenantA, tenantB].flatMap((tenantId) => DEFAULT_ROLES.map((role) => ({ ...role, tenantId }))) });
    const ownerRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantA, code: 'owner' } } });
    const cashierRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantA, code: 'cashier' } } });
    const inventoryRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantA, code: 'inventory' } } });
    const otherRole = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantB, code: 'owner' } } });
    const owner = await prisma.user.create({ data: { tenantId: tenantA, email: 'owner@test.local', name: 'Owner', passwordHash, roleId: ownerRole.id, allOutlets: true } });
    const outletA = await prisma.outlet.create({ data: { tenantId: tenantA, code: 'A', name: 'Outlet A' } });
    const outletA2 = await prisma.outlet.create({ data: { tenantId: tenantA, code: 'A2', name: 'Outlet A2' } });
    const outletB = await prisma.outlet.create({ data: { tenantId: tenantB, code: 'B', name: 'Outlet B' } });
    const cashier = await prisma.user.create({ data: { tenantId: tenantA, email: 'cashier@test.local', name: 'Cashier', passwordHash, roleId: cashierRole.id } });
    const staff = await prisma.user.create({ data: { tenantId: tenantA, email: 'stock@test.local', name: 'Stock', passwordHash, roleId: inventoryRole.id } });
    await prisma.userOutlet.createMany({ data: [cashier, staff].map((user) => ({ tenantId: tenantA, userId: user.id, outletId: outletA.id })) });
    const categoryB = await prisma.category.create({ data: { tenantId: tenantB, name: 'Other' } });
    const productB = await prisma.product.create({ data: { tenantId: tenantB, name: 'Other', sku: 'OTHER', sellingPrice: 10 } });
    async function login(email: string) { const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug: `a-${tenantA}`, email, password }) }); assert.equal(response.status, 201); return response.headers.get('set-cookie')!.split(';')[0]; }
    const ownerCookie = await login(owner.email), cashierCookie = await login(cashier.email), staffCookie = await login(staff.email);
    const request = (path: string, cookie = ownerCookie, method = 'GET', body?: unknown) => fetch(`${base}/${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const productDto = { name: 'Kopi', sku: 'KOPI', barcode: '12345678', unit: 'gelas', sellingPrice: '18000.50', status: 'active' };
    let productId = '';
    await t.test('permission gates reject direct requests and scope outlet lists', async () => {
      assert.equal((await request('products', cashierCookie, 'POST', productDto)).status, 403);
      assert.equal((await request('users', cashierCookie)).status, 403);
      const outlets = await (await request('foundation/outlets', cashierCookie)).json() as { outlets: { id: string }[] };
      assert.deepEqual(outlets.outlets.map((outlet) => outlet.id), [outletA.id]);
      for (const outlet of [outletA2, outletB]) assert.equal((await request(`inventory/balances?outletId=${outlet.id}`, staffCookie)).status, 403);
    });
    await t.test('catalog validates tenant references, decimal prices, unique SKU/barcode and search', async () => {
      assert.equal((await request('products', ownerCookie, 'POST', { ...productDto, categoryId: categoryB.id })).status, 404);
      const created = await request('products', ownerCookie, 'POST', productDto); assert.equal(created.status, 201); productId = (await created.json() as { id: string }).id;
      assert.equal((await request('products', ownerCookie, 'POST', { ...productDto, barcode: 'other' })).status, 409);
      assert.equal((await request('products', ownerCookie, 'POST', { ...productDto, sku: 'OTHER' })).status, 400);
      assert.equal((await request(`products/${productB.id}`, ownerCookie, 'PATCH', productDto)).status, 404);
      assert.equal((await request('products', ownerCookie, 'POST', { ...productDto, sellingPrice: '-1' })).status, 400);
      const result = await (await request('products?search=kopi')).json() as { items: { sellingPrice: string }[]; total: number };
      assert.equal(result.total, 1); assert.equal(result.items[0].sellingPrice, '18000.5');
      assert.equal((await request('products?categoryId=invalid')).status, 400);
    });
    await t.test('organization and outlet updates persist with audit', async () => {
      assert.equal((await request('organization', ownerCookie, 'PATCH', { name: 'Alpha Updated', address: 'Jakarta', timezone: 'Asia/Jakarta' })).status, 200);
      assert.equal((await request(`outlets/${outletB.id}`, ownerCookie, 'PATCH', { name: 'Forged', code: 'FORGED', address: '', status: 'active' })).status, 404);
      const logs = await (await request('audit-logs')).json() as { items: { action: string }[] };
      assert.ok(logs.items.some((log) => log.action === 'organization.update'));
    });
    await t.test('opening balances reject negative/cross-tenant values and concurrent duplicates', async () => {
      const dto = { outletId: outletA.id, productId, quantity: '10.125', note: 'Initial counted stock' };
      assert.equal((await request('inventory/opening', cashierCookie, 'POST', dto)).status, 403);
      assert.equal((await request('inventory/opening', staffCookie, 'POST', { ...dto, outletId: outletA2.id })).status, 403);
      assert.equal((await request('inventory/opening', ownerCookie, 'POST', { ...dto, productId: productB.id })).status, 404);
      assert.equal((await request('inventory/opening', ownerCookie, 'POST', { ...dto, quantity: '-1' })).status, 400);
      const responses = await Promise.all([request('inventory/opening', staffCookie, 'POST', dto), request('inventory/opening', staffCookie, 'POST', dto)]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      const balance = await prisma.stockBalance.findFirstOrThrow({ where: { tenantId: tenantA, outletId: outletA.id, productId } });
      assert.equal(balance.quantity.toString(), '10.125'); assert.equal(await prisma.stockMovement.count({ where: { tenantId: tenantA, productId } }), 1);
      assert.equal((await request('inventory/threshold', staffCookie, 'PATCH', { outletId: outletA.id, productId, lowStockThreshold: '20' })).status, 200);
      const data = await (await request(`inventory/balances?outletId=${outletA.id}`)).json() as { items: { lowStock: boolean }[] };
      assert.equal(data.items[0].lowStock, true);
      const other = await (await request(`inventory/balances?outletId=${outletA2.id}`)).json() as { items: { quantity: string }[] };
      assert.equal(other.items[0].quantity, '0');
    });
    await t.test('last owner protection, tenant references and user responses exclude secrets', async () => {
      const dto = { name: owner.name, email: owner.email, roleId: cashierRole.id, allOutlets: true, outletIds: [], status: 'active' };
      assert.equal((await request(`users/${owner.id}`, ownerCookie, 'PATCH', dto)).status, 409);
      assert.equal((await request('users', ownerCookie, 'POST', { ...dto, email: 'new@test.local', password, roleId: otherRole.id })).status, 404);
      assert.equal((await request('users', ownerCookie, 'POST', { ...dto, email: 'new@test.local', password, allOutlets: false, outletIds: [outletB.id] })).status, 400);
      const response = await request('users'); assert.equal(response.status, 200); const body = await response.text(); assert.ok(!body.includes('passwordHash')); assert.ok(!body.includes(passwordHash));
      assert.equal((await request(`roles/${ownerRole.id}`, ownerCookie, 'PATCH', { name: 'Owner', permissions: [] })).status, 400);
      assert.equal((await request('roles', ownerCookie, 'POST', { name: 'Unknown permission', permissions: ['unknown'] })).status, 400);
    });
    await t.test('role permission changes affect existing sessions and user disable revokes them', async () => {
      assert.equal((await request(`roles/${inventoryRole.id}`, ownerCookie, 'PATCH', { name: inventoryRole.name, permissions: ['catalog.read'] })).status, 200);
      assert.equal((await request(`inventory/balances?outletId=${outletA.id}`, staffCookie)).status, 403);
      assert.equal((await request(`users/${cashier.id}`, ownerCookie, 'PATCH', { name: cashier.name, email: cashier.email, roleId: cashierRole.id, allOutlets: false, outletIds: [outletA.id], status: 'inactive' })).status, 200);
      assert.equal((await request('me', cashierCookie)).status, 401);
      assert.deepEqual(ownerRole.permissions, [...PERMISSIONS]);
    });
    await t.test('database rejects cross-tenant memberships and unauthorized origins', async () => {
      await assert.rejects(prisma.userOutlet.create({ data: { tenantId: tenantA, userId: owner.id, outletId: outletB.id } }));
      const response = await fetch(`${base}/organization`, { method: 'PATCH', headers: { Cookie: ownerCookie, Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Forged', address: '', timezone: 'UTC' }) }); assert.equal(response.status, 403);
    });
  } finally {
    await prisma.session.deleteMany({ where: { tenantId } }); await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.stockMovement.deleteMany({ where: { tenantId } }); await prisma.stockBalance.deleteMany({ where: { tenantId } });
    await prisma.userOutlet.deleteMany({ where: { tenantId } }); await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.category.deleteMany({ where: { tenantId } }); await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.role.deleteMany({ where: { tenantId } }); await prisma.outlet.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } }); await app.close();
  }
});
