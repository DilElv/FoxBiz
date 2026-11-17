import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/password';

test('HTTP sessions, tenant isolation, expiration, logout and validation', async (t) => {
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  const prisma = app.get(PrismaService);
  const tenantA = randomUUID(), tenantB = randomUUID();
  const slugA = `test-${tenantA}`, slugB = `test-${tenantB}`;
  const email = 'same-email@example.test';
  const password = randomBytes(20).toString('hex');
  const passwordHash = await hashPassword(password);
  try {
    await prisma.tenant.createMany({ data: [{ id: tenantA, name: 'Test A', slug: slugA }, { id: tenantB, name: 'Test B', slug: slugB }] });
    await prisma.user.createMany({ data: [{ tenantId: tenantA, name: 'User A', email, passwordHash, allOutlets: true }, { tenantId: tenantB, name: 'User B', email, passwordHash }] });
    await prisma.outlet.createMany({ data: [{ tenantId: tenantA, name: 'Outlet A', code: 'A' }, { tenantId: tenantB, name: 'Outlet B', code: 'B' }] });
    const login = (slug: string, pass = password) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug: slug, email, password: pass }) });
    await t.test('unauthenticated and forged tenant access is rejected', async () => {
      assert.equal((await fetch(`${base}/me`, { headers: { 'x-tenant-id': tenantA } })).status, 401);
      assert.equal((await fetch(`${base}/me`, { headers: { Authorization: 'Bearer forged-token' } })).status, 401);
    });
    await t.test('invalid credentials, DTO and origin are rejected', async () => {
      assert.equal((await login(slugA, 'incorrect-password')).status, 401);
      assert.equal((await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
      assert.equal((await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: JSON.stringify({ tenantSlug: slugA, email, password }) })).status, 403);
    });
    const response = await login(slugA);
    assert.equal(response.status, 201);
    const setCookie = response.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(';')[0];
    const rawToken = cookie.split('=')[1];
    await t.test('session storage is hashed and tenant scope comes from session', async () => {
      const stored = await prisma.session.findFirstOrThrow({ where: { tenantId: tenantA } });
      assert.notEqual(stored.tokenHash, rawToken);
      assert.equal(stored.tokenHash.length, 64);
      const me = await fetch(`${base}/me`, { headers: { Cookie: cookie } });
      const body = await me.json() as { tenantId: string; user: { name: string } };
      assert.equal(body.tenantId, tenantA);
      assert.equal(body.user.name, 'User A');
      assert.equal((await fetch(`${base}/me`, { headers: { Cookie: cookie, 'x-tenant-id': tenantB } })).status, 403);
      const outlets = await (await fetch(`${base}/foundation/outlets`, { headers: { Cookie: cookie } })).json() as { outlets: { name: string }[] };
      assert.deepEqual(outlets.outlets.map((item) => item.name), ['Outlet A']);
    });
    await t.test('same email in another business resolves to its own tenant', async () => {
      const other = await login(slugB);
      const body = await other.json() as { user: { tenantId: string; name: string } };
      assert.equal(body.user.tenantId, tenantB);
      assert.equal(body.user.name, 'User B');
    });
    await t.test('expired sessions fail closed and logout revokes sessions', async () => {
      await prisma.session.updateMany({ where: { tenantId: tenantA }, data: { expiresAt: new Date(0) } });
      assert.equal((await fetch(`${base}/me`, { headers: { Cookie: cookie } })).status, 401);
      const fresh = await login(slugA);
      const freshCookie = fresh.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: freshCookie } })).status, 201);
      assert.equal((await fetch(`${base}/me`, { headers: { Cookie: freshCookie } })).status, 401);
    });
    await t.test('health checks the database', async () => {
      const health = await fetch(`${base}/health`);
      assert.equal(health.status, 200);
      assert.equal((await health.json() as { database: string }).database, 'connected');
    });
  } finally {
    // Only remove the two uniquely identified test fixtures created by this test.
    const tenantId = { in: [tenantA, tenantB] };
    await prisma.session.deleteMany({ where: { tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.outlet.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app.close();
  }
});
