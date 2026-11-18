import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma.service';
import { verifyPassword } from '../src/password';
import { PERMISSIONS } from '../src/permissions';

type Owner = { id: string; tenantId: string; email: string; allOutlets: boolean; permissions: string[]; role: { code: string } };
type Outlet = { id: string; name: string; code: string };

test('Self registration, email login, multi-outlet employees and tenant isolation', async (t) => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`, prisma = app.get(PrismaService);
  const prefix = `signup-${randomUUID()}`, password = 'registration-password-123';
  const dto = (key: string) => ({ name: 'Owner Verifikasi', email: `${key}@${prefix}.test`, password, businessName: 'Bisnis Baru', tenantSlug: `${prefix}-${key}`, outletName: 'Outlet Pusat', outletCode: 'PUSAT' });
  let client = 0;
  const post = (path: string, body: unknown, cookie?: string, ip = `198.51.100.${++client}`) => fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const get = (path: string, cookie: string) => fetch(`${base}/${path}`, { headers: { Cookie: cookie } });
  const json = async <T>(response: Response, status = 200): Promise<T> => { assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<T>; };
  let cookie = '', owner: Owner, main: Outlet, branch: Outlet;
  try {
    await t.test('validates registration and origin before creating business data', async () => {
      for (const extra of [{ password: 'short' }, { password: '😀'.repeat(19) }, { tenantSlug: 'bad code' }, { outletCode: 'bad code' }, { name: '  ' }, { roleId: randomUUID() }]) {
        assert.equal((await post('auth/register', { ...dto('invalid'), ...extra })).status, 400);
      }
      const foreignOrigin = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: JSON.stringify(dto('origin')) });
      assert.equal(foreignOrigin.status, 403);
      assert.equal(await prisma.tenant.count({ where: { slug: { startsWith: prefix } } }), 0);
    });
    await t.test('creates owner, roles, first outlet and a hashed session atomically without demo data', async () => {
      const response = await post('auth/register', { ...dto('owner'), email: ` OWNER@${prefix.toUpperCase()}.TEST ` });
      ({ user: owner } = await json<{ user: Owner }>(response, 201));
      cookie = response.headers.get('set-cookie')!.split(';')[0];
      assert.match(response.headers.get('set-cookie')!, /HttpOnly.*SameSite=Lax/i);
      assert.equal(owner.email, dto('owner').email); assert.equal(owner.role.code, 'owner'); assert.equal(owner.allOutlets, true);
      assert.deepEqual([...owner.permissions].sort(), [...PERMISSIONS].sort());
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      assert.notEqual(stored.passwordHash, password); assert.equal(await verifyPassword(password, stored.passwordHash), true);
      const session = await prisma.session.findFirstOrThrow({ where: { userId: owner.id } });
      assert.notEqual(session.tokenHash, cookie.split('=')[1]); assert.equal(session.tokenHash.length, 64);
      const outlets = await json<{ outlets: Outlet[] }>(await get('foundation/outlets', cookie));
      [main] = outlets.outlets; assert.equal(outlets.outlets.length, 1); assert.equal(main.code, 'PUSAT');
      assert.equal(await prisma.product.count({ where: { tenantId: owner.tenantId } }), 0);
      assert.equal(await prisma.employee.count({ where: { tenantId: owner.tenantId } }), 0);
      const dashboard = await json<{ summary: { transactions: number; sales: string } }>(await get(`dashboard?outletId=${main.id}&period=today`, cookie));
      assert.equal(dashboard.summary.transactions, 0); assert.equal(Number(dashboard.summary.sales), 0);
      assert.equal((await get('me', cookie)).status, 200);
    });
    await t.test('email-only login normalizes email and rejects wrong passwords', async () => {
      assert.equal((await post('auth/login', { email: dto('owner').email, password: 'incorrect-password' })).status, 401);
      const login = await post('auth/login', { email: dto('owner').email.toUpperCase(), password });
      assert.equal((await json<{ user: Owner }>(login, 201)).user.id, owner.id);
    });
    await t.test('rejects duplicate email and business code without partial records', async () => {
      assert.equal((await post('auth/register', { ...dto('duplicate-email'), email: owner.email })).status, 409);
      assert.equal((await post('auth/register', { ...dto('duplicate-code'), tenantSlug: dto('owner').tenantSlug })).status, 409);
      assert.equal(await prisma.tenant.count({ where: { slug: { startsWith: prefix } } }), 1);
    });
    await t.test('serializes concurrent registration for the same email or business code', async () => {
      const sameEmail = await Promise.all([post('auth/register', dto('race-email')), post('auth/register', { ...dto('race-other'), email: dto('race-email').email })]);
      assert.deepEqual(sameEmail.map((r) => r.status).sort(), [201, 409]);
      const sameCode = await Promise.all([post('auth/register', dto('race-code')), post('auth/register', { ...dto('race-code-other'), tenantSlug: dto('race-code').tenantSlug })]);
      assert.deepEqual(sameCode.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await prisma.tenant.count({ where: { slug: { startsWith: prefix } } }), 3);
    });
    await t.test('existing owner session automatically accesses new outlets with distinct codes', async () => {
      branch = await json<Outlet>(await post('outlets', { name: 'Outlet Cabang', code: 'CABANG-02', address: '', status: 'active' }, cookie), 201);
      assert.equal((await post('outlets', { name: 'Duplikat', code: 'PUSAT', address: '', status: 'active' }, cookie)).status, 409);
      const outlets = await json<{ outlets: Outlet[] }>(await get('foundation/outlets', cookie));
      assert.deepEqual(outlets.outlets.map((o) => o.code).sort(), ['CABANG-02', 'PUSAT']);
      assert.equal((await get(`dashboard?outletId=${branch.id}&period=today`, cookie)).status, 200);
    });
    await t.test('many employees share one outlet kiosk while assignments and businesses stay isolated', async () => {
      for (const [code, allOutlets, outletIds] of [['EMP01', false, [main.id]], ['EMP02', false, [main.id]], ['EMP03', false, [branch.id]], ['EMP04', true, []]] as const) {
        await json(await post('hris/employees', { name: `Karyawan ${code}`, code, position: 'Tim', phone: '', pin: '123456', status: 'active', allOutlets, outletIds }, cookie), 201);
      }
      const kiosk = (outlet: string) => get(`hris/kiosk?outletId=${outlet}`, cookie).then((r) => json<{ employees: { code: string }[] }>(r));
      assert.deepEqual((await kiosk(main.id)).employees.map((e) => e.code).sort(), ['EMP01', 'EMP02', 'EMP04']);
      assert.deepEqual((await kiosk(branch.id)).employees.map((e) => e.code).sort(), ['EMP03', 'EMP04']);
      const other = await prisma.tenant.findFirstOrThrow({ where: { slug: dto('race-code').tenantSlug }, include: { outlets: true } });
      assert.equal((await get(`hris/kiosk?outletId=${other.outlets[0].id}`, cookie)).status, 404);
      assert.equal(await prisma.user.count({ where: { tenantId: owner.tenantId } }), 1);
    });
    await t.test('legacy duplicate emails require business code; per-client registration limits apply', async () => {
      const other = await prisma.tenant.findFirstOrThrow({ where: { slug: dto('race-code').tenantSlug } });
      const original = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      await prisma.user.create({ data: { tenantId: other.id, email: owner.email, name: 'Legacy Owner', passwordHash: original.passwordHash, allOutlets: true } });
      assert.equal((await post('auth/login', { email: owner.email, password })).status, 409);
      assert.equal((await post('auth/login', { email: owner.email, password, tenantSlug: dto('owner').tenantSlug })).status, 201);
      for (let i = 0; i < 5; i++) assert.equal((await post('auth/register', { ...dto('limited'), email: owner.email }, undefined, '203.0.113.200')).status, 409);
      assert.equal((await post('auth/register', dto('limited'), undefined, '203.0.113.200')).status, 429);
      assert.equal(await prisma.tenant.count({ where: { slug: dto('limited').tenantSlug } }), 0);
    });
  } finally {
    const tenants = await prisma.tenant.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } });
    const tenantId = { in: tenants.map((tenant) => tenant.id) };
    await prisma.employeeOutlet.deleteMany({ where: { tenantId } });
    await prisma.employee.deleteMany({ where: { tenantId } });
    await prisma.session.deleteMany({ where: { tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.userOutlet.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.role.deleteMany({ where: { tenantId } });
    await prisma.outlet.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app.close();
  }
});
