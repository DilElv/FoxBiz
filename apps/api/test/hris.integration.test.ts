import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createApp } from '../src/create-app';
import { PrismaService } from '../src/prisma.service';
import { hashPassword } from '../src/password';
import { DEFAULT_ROLES } from '../src/permissions';

const attendanceDir = join(tmpdir(), `foxbiz-attendance-${randomUUID()}`);
process.env.ATTENDANCE_DIR = attendanceDir;

type Employee = { id: string; code: string; name: string; position: string; status: string; allOutlets: boolean; hasPin: boolean; outlets: { outletId: string }[] };
type Kiosk = { today: string; timezone: string; employees: (Employee & { status: string; attendance: { id: string } | null })[] };
type Attendance = { id: string; workDate: string; clockInAt: string; clockOutAt: string | null; duration: string; photoIn: boolean; photoOut: boolean; clockInLatitude: number | null; clockInLongitude: number | null; employee: { id: string; name: string; code: string } };
type Recap = { items: Attendance[]; total: number; absent: { id: string; name: string; code: string }[]; timezone: string; from: string; to: string };

function todayIn(timeZone = 'Asia/Jakarta') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
async function photo(color: { r: number; g: number; b: number }, width = 800, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 88 }).toBuffer();
}

test('Sprint 7: HRIS kiosk attendance, photo watermark, tenant isolation, recap and PDF', async (t) => {
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`, prisma = app.get(PrismaService);
  const tenantA = randomUUID(), tenantB = randomUUID(), tenantId = { in: [tenantA, tenantB] };
  const password = 'hris-test-password-123', passwordHash = await hashPassword(password);
  try {
    await prisma.tenant.createMany({ data: [tenantA, tenantB].map((id) => ({ id, name: 'HRIS test', slug: `hris-${id}`, timezone: 'Asia/Jakarta' })) });
    await prisma.role.createMany({ data: [tenantA, tenantB].flatMap((id) => DEFAULT_ROLES.map((role) => ({ ...role, tenantId: id }))) });
    const roles = await prisma.role.findMany({ where: { tenantId: tenantA } });
    const main = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Toko Utama', code: 'MAIN' } });
    const branch = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Cabang', code: 'BRANCH' } });
    const foreignOutlet = await prisma.outlet.create({ data: { tenantId: tenantB, name: 'Foreign', code: 'FOREIGN' } });
    async function user(tenant: string, name: string, roleId: string, allOutlets = true) { return prisma.user.create({ data: { tenantId: tenant, name, email: `${name}-${tenant}@hris.test`, passwordHash, roleId, allOutlets } }); }
    const ownerRoleB = await prisma.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenantB, code: 'owner' } } });
    const manager = await user(tenantA, 'manager', roles.find((role) => role.code === 'manager')!.id);
    const scoped = await user(tenantA, 'scoped', roles.find((role) => role.code === 'manager')!.id, false);
    const hr = await user(tenantA, 'hr', roles.find((role) => role.code === 'hr')!.id);
    const foreign = await user(tenantB, 'foreign', ownerRoleB.id);
    await prisma.userOutlet.create({ data: { tenantId: tenantA, userId: scoped.id, outletId: main.id } });
    async function login(email: string, tenant = tenantA) { const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug: `hris-${tenant}`, email, password }) }); assert.equal(response.status, 201); return response.headers.get('set-cookie')!.split(';')[0]; }
    const cookie = await login(manager.email), scopedCookie = await login(scoped.email), hrCookie = await login(hr.email), foreignCookie = await login(foreign.email, tenantB);
    const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${base}/${path}`, { method, headers: { Cookie: auth, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    async function json<T>(response: Response, status = 200): Promise<T> { assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<T>; }
    function multipart(path: string, fields: Record<string, string>, image?: Buffer, auth = cookie) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      if (image) form.append('photo', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), 'absensi.jpg');
      return fetch(`${base}/${path}`, { method: 'POST', headers: { Cookie: auth }, body: form });
    }
    const body = (name: string, code: string, pin: string, extra: Record<string, unknown> = {}) => ({ name, code, position: 'Kasir', phone: '081200000000', pin, allOutlets: true, outletIds: [], status: 'active', ...extra });
    let alpha: Employee, beta: Employee, gamma: Employee, delta: Employee, locked: Employee, inactive: Employee, foreignEmployee: Employee;
    let alphaAttendance: Attendance, gammaAttendance: Attendance;

    await t.test('creates employees with PIN, validates tenant scope and hides PIN hashes', async () => {
      assert.equal((await request('hris/employees', 'POST', body('Tanpa PIN', 'NOPIN', ''), scopedCookie)).status, 403);
      assert.equal((await request('hris/employees', 'POST', { ...body('Tanpa PIN', 'NOPIN', ''), pin: undefined })).status, 400);
      assert.equal((await request('hris/employees', 'POST', body('PIN Pendek', 'SHORT', '12345'))).status, 400);
      assert.equal((await request('hris/employees', 'POST', body('Kode salah', 'abc', '123456'))).status, 400);
      assert.equal((await request('hris/employees', 'POST', body('Outlet kosong', 'EMPTY', '123456', { allOutlets: false, outletIds: [] }))).status, 400);
      assert.equal((await request('hris/employees', 'POST', body('Outlet asing', 'FOREIGN', '123456', { allOutlets: false, outletIds: [foreignOutlet.id] }))).status, 400);
      assert.equal((await request('hris/employees', 'POST', { ...body('Ekstra', 'EXTRA', '123456'), tenantId: tenantB })).status, 400);
      alpha = await json<Employee>(await request('hris/employees', 'POST', body('Alpha Karyawan', 'EMP01', '123456', { phone: '0812 1111 2222' })), 201);
      assert.equal(alpha.code, 'EMP01'); assert.equal(alpha.hasPin, true); assert.equal(alpha.allOutlets, true); assert.ok(!('pinHash' in alpha)); assert.ok(!('pin' in alpha));
      beta = await json<Employee>(await request('hris/employees', 'POST', body('Beta Karyawan', 'EMP02', '654321', { allOutlets: false, outletIds: [main.id] })), 201);
      gamma = await json<Employee>(await request('hris/employees', 'POST', body('Gamma Karyawan', 'EMP03', '111111')), 201);
      delta = await json<Employee>(await request('hris/employees', 'POST', body('Delta Karyawan', 'EMP04', '222222')), 201);
      locked = await json<Employee>(await request('hris/employees', 'POST', body('Locked Karyawan', 'EMP05', '333333')), 201);
      inactive = await json<Employee>(await request('hris/employees', 'POST', body('Inactive Karyawan', 'EMP06', '444444', { status: 'inactive' })), 201);
      assert.equal((await request('hris/employees', 'POST', body('Duplikat', 'EMP01', '555555'))).status, 409);
      foreignEmployee = await json<Employee>(await request('hris/employees', 'POST', body('Foreign Employee', 'EMP01', '123456'), foreignCookie), 201);
      const list = await json<{ items: Employee[]; total: number }>(await request('hris/employees?search=Karyawan'));
      assert.equal(list.total, 6); assert.ok(!JSON.stringify(list).includes('pinHash')); assert.ok(!list.items.some((employee) => employee.id === foreignEmployee.id));
      assert.equal((await json<{ total: number }>(await request('hris/employees', 'GET', undefined, hrCookie))).total, 6);
      assert.equal((await request('hris/employees', 'GET', undefined, scopedCookie)).status, 403);
      const foreignList = await json<{ items: Employee[]; total: number }>(await request('hris/employees', 'GET', undefined, foreignCookie));
      assert.equal(foreignList.total, 1); assert.equal(foreignList.items[0].id, foreignEmployee.id);
      const hashBefore = (await prisma.employee.findUniqueOrThrow({ where: { id: alpha.id } })).pinHash;
      const updated = await json<Employee>(await request(`hris/employees/${alpha.id}`, 'PATCH', body('Alpha Baru', 'EMP01', '', { phone: '' })));
      assert.equal(updated.hasPin, true); assert.ok(!('pinHash' in updated));
      assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: alpha.id } })).pinHash, hashBefore);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: tenantA, entityType: 'employee', action: 'employee.update', entityId: alpha.id } });
      assert.ok(!JSON.stringify(audit).includes('pinHash')); assert.ok(!JSON.stringify(audit).includes(hashBefore!));
      assert.equal((await request(`hris/employees/${alpha.id}`, 'PATCH', body('Alpha Baru', 'EMP01', '999999'))).status, 200);
    });

    await t.test('kiosk shows all-outlet employees at new outlets and enforces outlet access', async () => {
      const kiosk = await json<Kiosk>(await request(`hris/kiosk?outletId=${main.id}`));
      assert.equal(kiosk.timezone, 'Asia/Jakarta'); assert.equal(kiosk.today, todayIn());
      assert.deepEqual(kiosk.employees.map((employee) => employee.code).sort(), ['EMP01', 'EMP02', 'EMP03', 'EMP04', 'EMP05']);
      assert.ok(!kiosk.employees.some((employee) => employee.id === inactive.id));
      assert.ok(!JSON.stringify(kiosk).includes('pinHash'));
      const branchKiosk = await json<Kiosk>(await request(`hris/kiosk?outletId=${branch.id}`));
      assert.deepEqual(branchKiosk.employees.map((employee) => employee.code).sort(), ['EMP01', 'EMP03', 'EMP04', 'EMP05']);
      const newOutlet = await prisma.outlet.create({ data: { tenantId: tenantA, name: 'Outlet Baru', code: 'NEW' } });
      const newKiosk = await json<Kiosk>(await request(`hris/kiosk?outletId=${newOutlet.id}`));
      assert.deepEqual(newKiosk.employees.map((employee) => employee.code).sort(), ['EMP01', 'EMP03', 'EMP04', 'EMP05']);
      assert.equal((await request(`hris/kiosk?outletId=${branch.id}`, 'GET', undefined, scopedCookie)).status, 403);
      assert.equal((await request(`hris/kiosk?outletId=${foreignOutlet.id}`)).status, 404);
      const scopedKiosk = await json<Kiosk>(await request(`hris/kiosk?outletId=${main.id}`, 'GET', undefined, scopedCookie));
      assert.equal(scopedKiosk.employees.length, 5);
    });

    await t.test('records watermarked clock-in/out photos, GPS and tenant-scoped downloads', async () => {
      const image = await photo({ r: 120, g: 140, b: 160 });
      assert.equal((await multipart('hris/attendance/clock-in', { employeeId: alpha.id, outletId: main.id, pin: '123456' })).status, 400);
      assert.equal((await multipart('hris/attendance/clock-in', { employeeId: alpha.id, outletId: main.id, pin: '123456' }, image)).status, 403);
      alphaAttendance = await json<Attendance>(await multipart('hris/attendance/clock-in', { employeeId: alpha.id, outletId: main.id, pin: '999999', latitude: '-6.200000', longitude: '106.816666', accuracy: '12' }, image), 201);
      assert.equal(alphaAttendance.employee.code, 'EMP01'); assert.equal(alphaAttendance.clockOutAt, null); assert.equal(alphaAttendance.photoIn, true); assert.equal(alphaAttendance.photoOut, false);
      assert.equal(alphaAttendance.clockInLatitude, -6.2); assert.equal(alphaAttendance.clockInLongitude, 106.816666); assert.equal(alphaAttendance.duration, '—');
      assert.ok(!('clockInPhoto' in alphaAttendance)); assert.ok(!('clockInPhotoHash' in alphaAttendance));
      assert.equal((await multipart('hris/attendance/clock-in', { employeeId: alpha.id, outletId: main.id, pin: '999999' }, image)).status, 409);
      assert.equal((await multipart('hris/attendance/clock-in', { employeeId: beta.id, outletId: branch.id, pin: '654321' }, image)).status, 404);
      assert.equal((await multipart('hris/attendance/clock-in', { employeeId: foreignEmployee.id, outletId: main.id, pin: '123456' }, image)).status, 404);
      assert.equal((await multipart('hris/attendance/clock-in', { employeeId: gamma.id, outletId: main.id, pin: '111111', latitude: '-6.2' }, image)).status, 400);
      assert.equal((await multipart('hris/attendance/clock-in', { employeeId: gamma.id, outletId: main.id, pin: '111111' }, await photo({ r: 1, g: 2, b: 3 }, 200, 200))).status, 400);
      gammaAttendance = await json<Attendance>(await multipart('hris/attendance/clock-in', { employeeId: gamma.id, outletId: branch.id, pin: '111111' }, await photo({ r: 80, g: 90, b: 100 })), 201);
      for (let index = 0; index < 5; index += 1) assert.equal((await multipart('hris/attendance/clock-in', { employeeId: locked.id, outletId: main.id, pin: '000000' }, image)).status, 403);
      assert.equal((await multipart('hris/attendance/clock-in', { employeeId: locked.id, outletId: main.id, pin: '000000' }, image)).status, 429);

      const stored = await prisma.attendance.findUniqueOrThrow({ where: { id: alphaAttendance.id } });
      assert.ok(stored.clockInPhoto); assert.ok(stored.clockInPhotoHash); assert.equal(stored.source, 'kiosk'); assert.equal(stored.recordedBy, manager.id);
      const file = join(attendanceDir, stored.clockInPhoto!);
      const bytes = await fs.readFile(file);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), stored.clockInPhotoHash);
      const imageMeta = await sharp(bytes).metadata();
      assert.equal(imageMeta.format, 'jpeg'); assert.ok((imageMeta.width ?? 0) >= 800);
      const raw = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const brightness = (fromY: number, toY: number) => {
        let sum = 0, count = 0;
        for (let y = fromY; y < toY; y += 2) for (let x = 0; x < raw.info.width; x += 4) {
          const index = (y * raw.info.width + x) * raw.info.channels;
          sum += (raw.data[index] + raw.data[index + 1] + raw.data[index + 2]) / 3; count += 1;
        }
        return sum / count;
      };
      assert.ok(brightness(raw.info.height - 20, raw.info.height) < 80); assert.ok(brightness(10, 30) > 100);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: tenantA, action: 'attendance.clock_in', entityId: alphaAttendance.id } });
      assert.ok(!JSON.stringify(audit).includes('clock_in_photo')); assert.ok(!JSON.stringify(audit.afterData).includes(stored.clockInPhotoHash!));

      const inline = await request(`hris/attendance/${alphaAttendance.id}/photo/in`);
      assert.equal(inline.status, 200); assert.equal(inline.headers.get('content-type'), 'image/jpeg'); assert.match(inline.headers.get('content-disposition') ?? '', /^inline/);
      assert.deepEqual(Buffer.from(await inline.arrayBuffer()), bytes);
      const download = await request(`hris/attendance/${alphaAttendance.id}/photo/in?download=1`);
      assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition') ?? '', /^attachment/);
      assert.equal((await request(`hris/attendance/${alphaAttendance.id}/photo/out`)).status, 404);
      assert.equal((await request(`hris/attendance/${alphaAttendance.id}/photo/in`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`hris/attendance/${gammaAttendance.id}/photo/in`, 'GET', undefined, scopedCookie)).status, 403);
      assert.equal((await request(`hris/attendance/${alphaAttendance.id}/photo/unknown`)).status, 404);

      assert.equal((await multipart('hris/attendance/clock-out', { employeeId: alpha.id, outletId: main.id, pin: '999999' })).status, 400);
      const outImage = await photo({ r: 40, g: 60, b: 80 });
      const clockOut = await json<Attendance>(await multipart('hris/attendance/clock-out', { employeeId: alpha.id, outletId: main.id, pin: '999999', latitude: '-6.201', longitude: '106.817', accuracy: '8' }, outImage), 201);
      assert.ok(clockOut.clockOutAt); assert.equal(clockOut.photoOut, true); assert.notEqual(clockOut.duration, '—');
      assert.equal((await multipart('hris/attendance/clock-out', { employeeId: alpha.id, outletId: main.id, pin: '999999' }, outImage)).status, 409);
      const finished = await json<Kiosk>(await request(`hris/kiosk?outletId=${main.id}`));
      assert.equal(finished.employees.find((employee) => employee.id === alpha.id)?.status, 'done');
      assert.equal((await request(`hris/attendance/${alphaAttendance.id}/photo/out`)).status, 200);
    });

    await t.test('reports daily/monthly recap and exports PDF scoped to tenant and outlet', async () => {
      const day = todayIn();
      const alphaRecord = await prisma.attendance.findUniqueOrThrow({ where: { id: alphaAttendance.id } });
      await prisma.attendance.update({ where: { id: alphaAttendance.id }, data: { clockOutAt: new Date(alphaRecord.clockInAt.getTime() + 90 * 60000) } });
      const recap = await json<Recap>(await request(`hris/attendance?outletId=${main.id}&from=${day}&to=${day}`));
      assert.equal(recap.total, 1); assert.equal(recap.items[0].id, alphaAttendance.id); assert.ok(recap.items[0].clockOutAt); assert.equal(recap.items[0].duration, '1j 30m');
      assert.deepEqual(recap.absent.map((employee) => employee.code).sort(), ['EMP02', 'EMP03', 'EMP04', 'EMP05']);
      const branchRecap = await json<Recap>(await request(`hris/attendance?outletId=${branch.id}&from=${day}&to=${day}`));
      assert.equal(branchRecap.total, 1); assert.equal(branchRecap.items[0].employee.code, 'EMP03');
      const monthStart = `${day.slice(0, 8)}01`;
      const monthly = await json<{ rows: { employee: { code: string }; days: number; minutes: number; open: number }[] }>(await request(`hris/attendance/monthly?outletId=${main.id}&from=${monthStart}&to=${day}`));
      const alphaRow = monthly.rows.find((row) => row.employee.code === 'EMP01')!;
      assert.equal(alphaRow.days, 1); assert.equal(alphaRow.minutes, 90); assert.equal(alphaRow.open, 0);
      assert.equal(monthly.rows.find((row) => row.employee.code === 'EMP02')!.days, 0);
      assert.equal((await request(`hris/attendance?outletId=${main.id}&from=${day}&to=invalid`)).status, 400);
      assert.equal((await request(`hris/attendance?outletId=${main.id}&from=${day}&to=${day}&page=0`)).status, 400);
      assert.equal((await request(`hris/attendance?outletId=${main.id}&from=2020-01-01&to=${day}`)).status, 400);
      assert.equal((await request(`hris/attendance?outletId=${main.id}&from=${day}&to=${day}`, 'GET', undefined, foreignCookie)).status, 404);
      assert.equal((await request(`hris/attendance?outletId=${foreignOutlet.id}&from=${day}&to=${day}`)).status, 404);
      for (const mode of ['daily', 'monthly']) {
        const pdf = await request(`hris/attendance/export?outletId=${main.id}&from=${monthStart}&to=${day}&mode=${mode}`);
        assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.match(pdf.headers.get('content-disposition') ?? '', /^attachment/);
        const buffer = Buffer.from(await pdf.arrayBuffer());
        assert.ok(buffer.length > 500); assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
      }
    });

    await t.test('purges photos older than 180 days while keeping attendance metadata', async () => {
      const old = new Date(Date.now() - 181 * 86400000);
      await prisma.attendance.update({ where: { id: alphaAttendance.id }, data: { clockInAt: old, clockOutAt: new Date(old.getTime() + 8 * 3600000) } });
      const current = await json<Attendance>(await multipart('hris/attendance/clock-in', { employeeId: delta.id, outletId: main.id, pin: '222222' }, await photo({ r: 20, g: 40, b: 60 })), 201);
      const before = await prisma.attendance.findUniqueOrThrow({ where: { id: alphaAttendance.id } });
      const oldFiles = [before.clockInPhoto!, before.clockOutPhoto!];
      const output = execFileSync(process.execPath, ['scripts/purge-attendance.cjs'], { cwd: join(__dirname, '..'), env: { ...process.env, ATTENDANCE_DIR: attendanceDir }, encoding: 'utf8' });
      assert.match(output, /attendance_photos_purged/);
      for (const relative of oldFiles) await assert.rejects(fs.access(join(attendanceDir, relative)));
      const after = await prisma.attendance.findUniqueOrThrow({ where: { id: alphaAttendance.id } });
      assert.equal(after.clockInPhoto, null); assert.equal(after.clockOutPhoto, null); assert.equal(after.clockInPhotoHash, null); assert.ok(after.clockInAt); assert.equal(after.clockInLatitude, -6.2);
      assert.equal((await request(`hris/attendance/${alphaAttendance.id}/photo/in`)).status, 404);
      const stillThere = await prisma.attendance.findUniqueOrThrow({ where: { id: current.id } });
      assert.ok(stillThere.clockInPhoto); await fs.access(join(attendanceDir, stillThere.clockInPhoto!));
      assert.equal((await request(`hris/attendance/${current.id}/photo/in`)).status, 200);
    });
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.attendance.deleteMany({ where: { tenantId } });
      await tx.employeeOutlet.deleteMany({ where: { tenantId } });
      await tx.employee.deleteMany({ where: { tenantId } });
      await tx.session.deleteMany({ where: { tenantId } });
      await tx.auditLog.deleteMany({ where: { tenantId } });
      await tx.userOutlet.deleteMany({ where: { tenantId } });
      await tx.user.deleteMany({ where: { tenantId } });
      await tx.role.deleteMany({ where: { tenantId } });
      await tx.outlet.deleteMany({ where: { tenantId } });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
    }, { timeout: 15000 });
    await fs.rm(attendanceDir, { recursive: true, force: true });
    await app.close();
  }
});
