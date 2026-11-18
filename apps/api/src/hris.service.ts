import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Attendance, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AttendancePhotoService } from './attendance-photo.service';
import { AuthenticatedUser } from './auth.types';
import { audit, domainWrite, found, pageArgs } from './domain-utils';
import { AttendanceEventDto, EmployeeDto } from './hris.dto';
import { hashPassword, verifyPassword } from './password';
import { requireOutlet, requireTenantScope } from './permissions';
import { PrismaService } from './prisma.service';

const employeeSelect = {
  id: true, code: true, name: true, position: true, phone: true, status: true, allOutlets: true, pinHash: true, createdAt: true,
  outlets: { select: { outletId: true } },
} as const;
const attendanceInclude = { employee: { select: { id: true, name: true, code: true } } } as const;
type MonthlyRow = { employee: { id: string; name: string; code: string }; days: number; minutes: number; firstIn: Date | null; lastOut: Date | null; open: number };

function date(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2100-12-31') throw new BadRequestException('Tanggal harus YYYY-MM-DD antara tahun 2000–2100.');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new BadRequestException('Tanggal tidak valid.');
  return value;
}
function localDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
function minutes(value: number) { return Math.max(0, Math.round(value / 60000)); }
function pinKey(user: AuthenticatedUser, employeeId: string) { return `${user.tenantId}:${employeeId}`; }
function employeeView<T extends { pinHash: string | null }>(employee: T) {
  const { pinHash, ...rest } = employee;
  return { ...rest, hasPin: Boolean(pinHash) };
}
function attendanceAudit(value: Attendance) {
  return {
    id: value.id, tenantId: value.tenantId, employeeId: value.employeeId, outletId: value.outletId,
    workDate: value.workDate, clockInAt: value.clockInAt, clockOutAt: value.clockOutAt,
    clockInLatitude: value.clockInLatitude, clockInLongitude: value.clockInLongitude, clockInAccuracy: value.clockInAccuracy,
    clockOutLatitude: value.clockOutLatitude, clockOutLongitude: value.clockOutLongitude, clockOutAccuracy: value.clockOutAccuracy,
    source: value.source, recordedBy: value.recordedBy, createdAt: value.createdAt, updatedAt: value.updatedAt,
    photoIn: Boolean(value.clockInPhoto), photoOut: Boolean(value.clockOutPhoto),
  };
}

@Injectable()
export class HrisService {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly prisma: PrismaService, private readonly photos: AttendancePhotoService) {}

  private period(from: string, to: string) {
    const start = date(from), end = date(to);
    if (end < start) throw new BadRequestException('Periode harus berurutan.');
    if (new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime() > 366 * 86400000) throw new BadRequestException('Periode maksimal 366 hari.');
    return { from: start, to: end };
  }
  private async range(user: AuthenticatedUser, from?: string, to?: string, monthly = false) {
    const tenant = await this.tenant(user);
    const today = localDate(new Date(), tenant.timezone);
    const fallback = monthly ? `${today.slice(0, 8)}01` : today;
    return { ...this.period(from || fallback, to || today), tenant };
  }
  private async tenant(user: AuthenticatedUser, tx: Prisma.TransactionClient = this.prisma) {
    return tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true, timezone: true, currency: true } });
  }
  private async outlet(user: AuthenticatedUser, id: string, tx: Prisma.TransactionClient = this.prisma) {
    requireOutlet(user, id);
    return found(await tx.outlet.findFirst({ where: { tenantId: user.tenantId, id, status: 'active' } }));
  }
  private verifyPinAllowed(key: string) {
    const entry = this.attempts.get(key);
    if (entry && entry.until > Date.now() && entry.count >= 5) throw new HttpException('Terlalu banyak percobaan PIN. Coba lagi dalam 5 menit.', 429);
  }
  private pinFailed(key: string) {
    const entry = this.attempts.get(key);
    this.attempts.set(key, { count: entry && entry.until > Date.now() ? entry.count + 1 : 1, until: Date.now() + 5 * 60000 });
  }
  private async checkPin(user: AuthenticatedUser, employeeId: string, pin: string, pinHash: string | null) {
    const key = pinKey(user, employeeId);
    this.verifyPinAllowed(key);
    if (!pinHash || !(await verifyPassword(pin, pinHash))) { this.pinFailed(key); throw new ForbiddenException('PIN tidak sesuai.'); }
    this.attempts.delete(key);
  }
  private employeeWhere(user: AuthenticatedUser, outletId: string): Prisma.EmployeeWhereInput {
    return { tenantId: user.tenantId, status: 'active', OR: [{ allOutlets: true }, { outlets: { some: { tenantId: user.tenantId, outletId } } }] };
  }

  async employees(user: AuthenticatedUser, search = '', page?: string) {
    requireTenantScope(user);
    if (search.length > 120) throw new BadRequestException('Pencarian maksimum 120 karakter.');
    const where: Prisma.EmployeeWhereInput = { tenantId: user.tenantId, ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.employee.findMany({ where, select: employeeSelect, orderBy: [{ status: 'asc' }, { name: 'asc' }], ...pageArgs(page) }), this.prisma.employee.count({ where })]);
    return { items: items.map(employeeView), total };
  }

  async saveEmployee(user: AuthenticatedUser, dto: EmployeeDto, id?: string) {
    requireTenantScope(user);
    const code = dto.code.trim().toUpperCase(), name = dto.name.trim(), position = (dto.position ?? '').trim(), phone = (dto.phone ?? '').trim();
    if (dto.pin !== undefined && dto.pin !== '' && !/^\d{6}$/.test(dto.pin)) throw new BadRequestException('PIN harus 6 digit angka.');
    if (!id && !dto.pin) throw new BadRequestException('PIN 6 digit wajib diisi untuk karyawan baru.');
    if (!dto.allOutlets && dto.outletIds.length === 0) throw new BadRequestException('Pilih minimal satu outlet atau aktifkan akses seluruh outlet.');
    const pinHash = dto.pin ? await hashPassword(dto.pin) : undefined;
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${user.tenantId}::uuid FOR UPDATE`;
      const before = id ? found(await tx.employee.findFirst({ where: { id, tenantId: user.tenantId }, include: { outlets: { select: { outletId: true } } } })) : null;
      if (dto.outletIds.length) {
        const outletCount = await tx.outlet.count({ where: { tenantId: user.tenantId, id: { in: dto.outletIds }, status: 'active' } });
        if (outletCount !== dto.outletIds.length) throw new BadRequestException('Outlet tidak valid atau tidak aktif.');
      }
      const data = { code, name, position, phone, status: dto.status, allOutlets: dto.allOutlets, ...(pinHash ? { pinHash } : {}) };
      const saved = before ? await tx.employee.update({ where: { id: before.id }, data, select: employeeSelect }) : await tx.employee.create({ data: { ...data, tenantId: user.tenantId, pinHash: pinHash! }, select: employeeSelect });
      await tx.employeeOutlet.deleteMany({ where: { tenantId: user.tenantId, employeeId: saved.id } });
      if (!dto.allOutlets && dto.outletIds.length) await tx.employeeOutlet.createMany({ data: dto.outletIds.map((outletId) => ({ tenantId: user.tenantId, employeeId: saved.id, outletId })) });
      await audit(tx, user, before ? 'employee.update' : 'employee.create', 'employee', saved.id, before ? employeeView(before) : undefined, employeeView(saved));
      return employeeView(saved);
    }));
  }

  async kiosk(user: AuthenticatedUser, outletId: string) {
    await this.outlet(user, outletId);
    const tenant = await this.tenant(user);
    const today = localDate(new Date(), tenant.timezone);
    const employees = await this.prisma.employee.findMany({
      where: this.employeeWhere(user, outletId),
      select: { ...employeeSelect, attendances: { where: { tenantId: user.tenantId, workDate: today }, select: { id: true, clockInAt: true, clockOutAt: true, outletId: true }, take: 1 } },
      orderBy: [{ name: 'asc' }],
    });
    return {
      today, timezone: tenant.timezone, outletId,
      employees: employees.map(({ attendances, pinHash, ...employee }) => {
        const attendance = attendances[0] ?? null;
        return { ...employee, hasPin: Boolean(pinHash), status: !attendance ? 'not_started' : attendance.clockOutAt ? 'done' : 'working', attendance: attendance ? { id: attendance.id, clockInAt: attendance.clockInAt, clockOutAt: attendance.clockOutAt, outletId: attendance.outletId } : null };
      }),
    };
  }

  async clockIn(user: AuthenticatedUser, dto: AttendanceEventDto, photo: Buffer) {
    const outlet = await this.outlet(user, dto.outletId);
    const tenant = await this.tenant(user);
    const employee = found(await this.prisma.employee.findFirst({ where: { ...this.employeeWhere(user, dto.outletId), id: dto.employeeId } }));
    await this.checkPin(user, employee.id, dto.pin, employee.pinHash);
    this.location(dto);
    const today = localDate(new Date(), tenant.timezone);
    const id = randomUUID();
    const at = new Date();
    const saved = await this.photos.save({ tenantId: user.tenantId, attendanceId: id, businessName: tenant.name, outletName: outlet.name, employeeName: employee.name, employeeCode: employee.code, kind: 'in', at, timezone: tenant.timezone, latitude: dto.latitude, longitude: dto.longitude, accuracy: dto.accuracy, photo });
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId + ':attendance:' + employee.id + ':' + today}, 0))::text`;
        if (await tx.attendance.findUnique({ where: { tenantId_employeeId_workDate: { tenantId: user.tenantId, employeeId: employee.id, workDate: today } } })) throw new ConflictException('Karyawan sudah absen masuk hari ini.');
        const open = await tx.attendance.findFirst({ where: { tenantId: user.tenantId, employeeId: employee.id, clockOutAt: null }, orderBy: { clockInAt: 'desc' } });
        if (open) throw new ConflictException('Masih ada absensi yang belum pulang. Selesaikan absen pulang terlebih dahulu.');
        const attendance = await tx.attendance.create({ data: {
          id, tenantId: user.tenantId, employeeId: employee.id, outletId: outlet.id, workDate: today, clockInAt: at,
          clockInPhoto: saved.path, clockInPhotoHash: saved.hash,
          clockInLatitude: dto.latitude, clockInLongitude: dto.longitude, clockInAccuracy: dto.accuracy,
          source: 'kiosk', recordedBy: user.id,
        }, include: attendanceInclude });
        await audit(tx, user, 'attendance.clock_in', 'attendance', attendance.id, undefined, attendanceAudit(attendance));
        return this.attendanceView(attendance);
      });
    } catch (error) { await this.photos.remove(saved.path); throw error; }
  }

  async clockOut(user: AuthenticatedUser, dto: AttendanceEventDto, photo: Buffer) {
    const outlet = await this.outlet(user, dto.outletId);
    const tenant = await this.tenant(user);
    const employee = found(await this.prisma.employee.findFirst({ where: { ...this.employeeWhere(user, dto.outletId), id: dto.employeeId } }));
    await this.checkPin(user, employee.id, dto.pin, employee.pinHash);
    this.location(dto);
    const open = await this.prisma.attendance.findFirst({ where: { tenantId: user.tenantId, employeeId: employee.id, clockOutAt: null }, orderBy: { clockInAt: 'desc' } });
    if (!open) throw new ConflictException('Tidak ada absensi masuk yang belum pulang.');
    const at = new Date();
    const saved = await this.photos.save({ tenantId: user.tenantId, attendanceId: open.id, businessName: tenant.name, outletName: outlet.name, employeeName: employee.name, employeeCode: employee.code, kind: 'out', at, timezone: tenant.timezone, latitude: dto.latitude, longitude: dto.longitude, accuracy: dto.accuracy, photo });
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM attendances WHERE tenant_id = ${user.tenantId}::uuid AND id = ${open.id}::uuid FOR UPDATE`;
        const before = found(await tx.attendance.findFirst({ where: { id: open.id, tenantId: user.tenantId } }));
        if (before.clockOutAt) throw new ConflictException('Absensi sudah pulang. Muat ulang data.');
        const attendance = await tx.attendance.update({ where: { id: open.id }, data: { clockOutAt: at, clockOutPhoto: saved.path, clockOutPhotoHash: saved.hash, clockOutLatitude: dto.latitude, clockOutLongitude: dto.longitude, clockOutAccuracy: dto.accuracy }, include: attendanceInclude });
        await audit(tx, user, 'attendance.clock_out', 'attendance', attendance.id, attendanceAudit(before), attendanceAudit(attendance));
        return this.attendanceView(attendance);
      });
    } catch (error) { await this.photos.remove(saved.path); throw error; }
  }

  private location(dto: AttendanceEventDto) {
    if ((dto.latitude === undefined) !== (dto.longitude === undefined)) throw new BadRequestException('Latitude dan longitude harus diisi bersama.');
  }

  async recap(user: AuthenticatedUser, outletId: string, from?: string, to?: string, page?: string, all = false) {
    await this.outlet(user, outletId);
    const { from: start, to: end, tenant } = await this.range(user, from, to);
    const where: Prisma.AttendanceWhereInput = { tenantId: user.tenantId, outletId, workDate: { gte: start, lte: end } };
    const [items, total, activeEmployees, present] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({ where, include: attendanceInclude, orderBy: [{ workDate: 'desc' }, { clockInAt: 'desc' }], ...(all ? {} : pageArgs(page)) }),
      this.prisma.attendance.count({ where }),
      this.prisma.employee.findMany({ where: this.employeeWhere(user, outletId), select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      this.prisma.attendance.findMany({ where: { tenantId: user.tenantId, outletId, workDate: start }, select: { employeeId: true } }),
    ]);
    const presentIds = new Set(present.map((item) => item.employeeId));
    const absent = start === end ? activeEmployees.filter((employee) => !presentIds.has(employee.id)) : [];
    return { items: items.map((item) => this.attendanceView(item)), total, absent, timezone: tenant.timezone, from: start, to: end };
  }

  async monthly(user: AuthenticatedUser, outletId: string, from?: string, to?: string) {
    await this.outlet(user, outletId);
    const { from: start, to: end, tenant } = await this.range(user, from, to, true);
    const [records, employees] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({ where: { tenantId: user.tenantId, outletId, workDate: { gte: start, lte: end } }, include: attendanceInclude, orderBy: { clockInAt: 'asc' } }),
      this.prisma.employee.findMany({ where: this.employeeWhere(user, outletId), select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    ]);
    const rows = new Map<string, MonthlyRow>(employees.map((employee) => [employee.id, { employee, days: 0, minutes: 0, firstIn: null, lastOut: null, open: 0 }]));
    for (const record of records) {
      const row = rows.get(record.employeeId) ?? { employee: { id: record.employee.id, name: record.employee.name, code: record.employee.code }, days: 0, minutes: 0, firstIn: null, lastOut: null, open: 0 };
      row.days += 1;
      if (!row.firstIn || record.clockInAt < row.firstIn) row.firstIn = record.clockInAt;
      if (record.clockOutAt) { row.minutes += minutes(record.clockOutAt.getTime() - record.clockInAt.getTime()); if (!row.lastOut || record.clockOutAt > row.lastOut) row.lastOut = record.clockOutAt; }
      else row.open += 1;
      rows.set(record.employeeId, row);
    }
    return { rows: [...rows.values()].sort((a, b) => a.employee.name.localeCompare(b.employee.name)), timezone: tenant.timezone, from: start, to: end };
  }

  async photo(user: AuthenticatedUser, id: string, kind: string) {
    if (!['in', 'out'].includes(kind)) throw new NotFoundException('Foto absensi tidak ditemukan.');
    const attendance = found(await this.prisma.attendance.findFirst({ where: { id, tenantId: user.tenantId } }));
    await this.outlet(user, attendance.outletId);
    const path = kind === 'in' ? attendance.clockInPhoto : attendance.clockOutPhoto;
    if (!path) throw new NotFoundException('Foto absensi tidak tersedia atau sudah dihapus.');
    return { stream: await this.photos.file(path), filename: `absensi-${attendance.workDate}-${kind}.jpg` };
  }

  async exportPdf(user: AuthenticatedUser, outletId: string, from?: string, to?: string, mode = 'daily') {
    await this.outlet(user, outletId);
    const tenant = await this.tenant(user);
    const outlet = await this.prisma.outlet.findUniqueOrThrow({ where: { id: outletId }, select: { name: true } });
    const daily = mode !== 'monthly';
    const dailyData = daily ? await this.recap(user, outletId, from, to, undefined, true) : null;
    const monthlyData = daily ? null : await this.monthly(user, outletId, from, to);
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ size: 'A4', layout: daily ? 'landscape' : 'portrait', margin: 36, info: { Title: `Rekap Absensi ${outlet.name}`, Author: tenant.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    const pageWidth = doc.page.width, left = 36, usable = pageWidth - 72;
    const start = dailyData?.from ?? monthlyData!.from, end = dailyData?.to ?? monthlyData!.to;
    doc.font('Helvetica-Bold').fontSize(16).text(tenant.name, left, 34);
    doc.font('Helvetica').fontSize(10).fillColor('#475569').text(`Rekap Absensi ${daily ? 'Harian' : 'Bulanan'} · ${outlet.name}`, left, 55);
    doc.text(`Periode ${start} s/d ${end} · Zona waktu ${tenant.timezone}`, left, 70);
    if (dailyData) {
      const columns = [['Karyawan', 190], ['Kode', 75], ['Masuk', 115], ['Pulang', 115], ['Durasi', 60], ['GPS', 120]] as const;
      let y = 96;
      const header = () => { doc.font('Helvetica-Bold').fontSize(9).fillColor('#0F172A'); let x = left; for (const [label, width] of columns) { doc.text(label, x, y, { width, ellipsis: true }); x += width; } y += 18; doc.moveTo(left, y - 4).lineTo(left + usable, y - 4).strokeColor('#CBD5E1').stroke(); doc.font('Helvetica').fontSize(8.5).fillColor('#334155'); };
      header();
      for (const item of dailyData.items) {
        if (y > doc.page.height - 70) { doc.addPage(); y = 36; header(); }
        const values = [item.employee.name, item.employee.code, this.format(item.clockInAt, tenant.timezone), item.clockOutAt ? this.format(item.clockOutAt, tenant.timezone) : 'Belum pulang', item.duration, this.coordinates(item.clockInLatitude, item.clockInLongitude)];
        let x = left; for (let index = 0; index < columns.length; index++) { doc.text(String(values[index]), x, y, { width: columns[index][1] - 6, ellipsis: true }); x += columns[index][1]; }
        y += 16;
      }
      if (!dailyData.items.length) doc.text('Belum ada data absensi pada periode ini.', left, y);
      doc.font('Helvetica').fontSize(8).fillColor('#64748B').text(`Total ${dailyData.total} absensi · ${dailyData.absent.length} karyawan belum absen · Foto tersedia 180 hari di aplikasi.`, left, doc.page.height - 40, { width: usable });
    } else if (monthlyData) {
      const columns = [['Karyawan', 180], ['Kode', 80], ['Hari hadir', 70], ['Total jam', 80], ['Masuk pertama', 110], ['Pulang terakhir', 110]] as const;
      let y = 96;
      const header = () => { doc.font('Helvetica-Bold').fontSize(9).fillColor('#0F172A'); let x = left; for (const [label, width] of columns) { doc.text(label, x, y, { width }); x += width; } y += 18; doc.moveTo(left, y - 4).lineTo(left + usable, y - 4).strokeColor('#CBD5E1').stroke(); doc.font('Helvetica').fontSize(8.5).fillColor('#334155'); };
      header();
      for (const row of monthlyData.rows) {
        if (y > doc.page.height - 60) { doc.addPage(); y = 36; header(); }
        const values = [row.employee.name, row.employee.code, String(row.days), `${(row.minutes / 60).toFixed(1)} jam`, row.firstIn ? this.format(row.firstIn, tenant.timezone) : '—', row.lastOut ? this.format(row.lastOut, tenant.timezone) : '—'];
        let x = left; for (let index = 0; index < columns.length; index++) { doc.text(String(values[index]), x, y, { width: columns[index][1] - 6, ellipsis: true }); x += columns[index][1]; }
        y += 16;
      }
      if (!monthlyData.rows.length) doc.text('Belum ada data absensi pada periode ini.', left, y);
      doc.font('Helvetica').fontSize(8).fillColor('#64748B').text('Dokumen ini dihasilkan FoxBiz.', left, doc.page.height - 40, { width: usable });
    }
    doc.end();
    return { buffer: await done, filename: `rekap-absensi-${daily ? 'harian' : 'bulanan'}-${start}-${end}.pdf` };
  }

  private attendanceView(item: Prisma.AttendanceGetPayload<{ include: typeof attendanceInclude }>) {
    return {
      id: item.id, employeeId: item.employeeId, outletId: item.outletId, workDate: item.workDate,
      clockInAt: item.clockInAt, clockOutAt: item.clockOutAt, employee: item.employee,
      clockInLatitude: item.clockInLatitude, clockInLongitude: item.clockInLongitude, clockInAccuracy: item.clockInAccuracy,
      clockOutLatitude: item.clockOutLatitude, clockOutLongitude: item.clockOutLongitude, clockOutAccuracy: item.clockOutAccuracy,
      source: item.source,
      duration: item.clockOutAt ? `${Math.floor(minutes(item.clockOutAt.getTime() - item.clockInAt.getTime()) / 60)}j ${minutes(item.clockOutAt.getTime() - item.clockInAt.getTime()) % 60}m` : '—',
      photoIn: Boolean(item.clockInPhoto), photoOut: Boolean(item.clockOutPhoto),
    };
  }
  private format(value: Date, timeZone: string) { return new Intl.DateTimeFormat('id-ID', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(value); }
  private coordinates(latitude: number | null, longitude: number | null) { return latitude !== null && longitude !== null ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : '—'; }
}
