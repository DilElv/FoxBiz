import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { AuthenticatedUser } from './auth.types';
import { CreateCustomerDto, UpdateCustomerDto } from './crm.dto';
import { audit, found, pageArgs } from './domain-utils';
import { PrismaService } from './prisma.service';

export const CUSTOMER_SEGMENTS = [
  { code: 'never', label: 'Belum bertransaksi' },
  { code: 'active', label: 'Aktif (≤30 hari)' },
  { code: 'attention', label: 'Perlu perhatian (31–90 hari)' },
  { code: 'inactive', label: 'Tidak aktif (>90 hari)' },
] as const;
type Segment = typeof CUSTOMER_SEGMENTS[number]['code'];
type Stat = { saleCount: number; totalSpend: Prisma.Decimal; lastSaleAt: Date | null };
const saleHistory = {
  id: true, receiptNo: true, subtotal: true, total: true, createdAt: true,
  outlet: { select: { id: true, name: true } },
  cashier: { select: { id: true, name: true } },
  payment: { select: { method: true, status: true } },
  _count: { select: { items: true } },
} as const;

function localDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
function normalizePhone(value: unknown) {
  if (typeof value !== 'string') throw new BadRequestException('Nomor telepon wajib diisi.');
  const phone = value.replace(/[\s().-]/g, '');
  if (!/^\+?\d{7,15}$/.test(phone)) throw new BadRequestException('Nomor telepon harus 7–15 digit dan boleh diawali +.');
  return phone;
}
function normalizeEmail(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('Email tidak valid.');
  return value.trim().toLowerCase();
}
function normalizeNotes(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BadRequestException('Catatan tidak valid.');
  return value.trim();
}
function normalizeName(value: unknown) {
  if (typeof value !== 'string') throw new BadRequestException('Nama pelanggan wajib diisi.');
  const name = value.trim();
  if (name.length < 2 || name.length > 80) throw new BadRequestException('Nama pelanggan harus 2–80 karakter.');
  return name;
}

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}
  private async stats(user: AuthenticatedUser, customerId?: string) {
    const rows = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: { tenantId: user.tenantId, status: 'paid', customerId: customerId ?? { not: null }, ...(user.allOutlets ? {} : { outletId: { in: user.outletIds } }) },
      _count: { _all: true }, _sum: { total: true }, _max: { createdAt: true },
    });
    const result = new Map<string, Stat>();
    for (const row of rows) if (row.customerId) result.set(row.customerId, { saleCount: row._count._all, totalSpend: row._sum.total ?? new Prisma.Decimal(0), lastSaleAt: row._max.createdAt });
    return result;
  }
  private segment(lastSaleAt: Date | null, timezone: string, today: string): Segment {
    if (!lastSaleAt) return 'never';
    const date = localDate(lastSaleAt, timezone);
    const age = Math.round((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${date}T00:00:00.000Z`)) / 86400000);
    if (age <= 30) return 'active';
    if (age <= 90) return 'attention';
    return 'inactive';
  }
  private decorate(customer: Customer, stats: Map<string, Stat>, timezone: string, today: string) {
    const stat = stats.get(customer.id), segment = this.segment(stat?.lastSaleAt ?? null, timezone, today);
    return { ...customer, saleCount: stat?.saleCount ?? 0, totalSpend: (stat?.totalSpend ?? new Prisma.Decimal(0)).toString(),
      lastSaleAt: stat?.lastSaleAt ?? null, lastSaleDate: stat?.lastSaleAt ? localDate(stat.lastSaleAt, timezone) : null,
      segment, segmentLabel: CUSTOMER_SEGMENTS.find((item) => item.code === segment)!.label };
  }
  private summary(totalCustomers: number, stats: Map<string, Stat>, timezone: string, today: string) {
    const counts: Record<Segment, number> = { never: 0, active: 0, attention: 0, inactive: 0 };
    for (const stat of stats.values()) counts[this.segment(stat.lastSaleAt, timezone, today)] += 1;
    counts.never = Math.max(0, totalCustomers - stats.size);
    return { total: totalCustomers, ...counts };
  }
  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Nomor telepon sudah dipakai pelanggan lain di bisnis ini.');
    throw error;
  }
  async list(user: AuthenticatedUser, search = '', segment = '', page?: string) {
    if (search.length > 160) throw new BadRequestException('Pencarian maksimum 160 karakter.');
    if (segment && !CUSTOMER_SEGMENTS.some((item) => item.code === segment)) throw new BadRequestException('Segmen pelanggan tidak valid.');
    const args = pageArgs(page), query = search.trim(), phoneQuery = query.replace(/[\s().-]/g, '');
    const where: Prisma.CustomerWhereInput = { tenantId: user.tenantId, ...(query ? { OR: [
      { name: { contains: query, mode: 'insensitive' } },
      { phone: { contains: phoneQuery || query } },
      { email: { contains: query, mode: 'insensitive' } },
    ] } : {}) };
    const [tenant, totalCustomers, stats] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { timezone: true, currency: true } }),
      this.prisma.customer.count({ where: { tenantId: user.tenantId } }),
      this.stats(user),
    ]);
    const today = localDate(new Date(), tenant.timezone);
    if (segment) {
      const ids = [...stats.entries()].filter(([, stat]) => segment === 'never' || this.segment(stat.lastSaleAt, tenant.timezone, today) === segment).map(([id]) => id);
      where.id = segment === 'never' ? { notIn: ids } : { in: ids };
    }
    const [customers, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...args }),
      this.prisma.customer.count({ where }),
    ]);
    return { items: customers.map((customer) => this.decorate(customer, stats, tenant.timezone, today)), total,
      summary: this.summary(totalCustomers, stats, tenant.timezone, today), segments: CUSTOMER_SEGMENTS, timezone: tenant.timezone, currency: tenant.currency };
  }
  async create(user: AuthenticatedUser, dto: CreateCustomerDto) {
    const name = normalizeName(dto.name), phone = normalizePhone(dto.phone), email = normalizeEmail(dto.email), notes = normalizeNotes(dto.notes) ?? '';
    if (notes.length > 500) throw new BadRequestException('Catatan maksimum 500 karakter.');
    try {
      const customer = await this.prisma.$transaction(async (tx) => {
        const created = await tx.customer.create({ data: { tenantId: user.tenantId, name, phone, email, notes } });
        await audit(tx, user, 'customer.create', 'customer', created.id, undefined, { fields: ['name', 'phone', ...(email ? ['email'] : []), ...(notes ? ['notes'] : [])], phonePresent: true, emailPresent: Boolean(email) });
        return created;
      });
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { timezone: true } });
      return this.decorate(customer, new Map(), tenant.timezone, localDate(new Date(), tenant.timezone));
    } catch (error) { return this.conflict(error); }
  }
  async get(user: AuthenticatedUser, id: string) {
    const customer = found(await this.prisma.customer.findFirst({ where: { tenantId: user.tenantId, id } }));
    const [tenant, stats] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { timezone: true } }),
      this.stats(user, id),
    ]);
    return this.decorate(customer, stats, tenant.timezone, localDate(new Date(), tenant.timezone));
  }
  async update(user: AuthenticatedUser, id: string, dto: UpdateCustomerDto) {
    const current = found(await this.prisma.customer.findFirst({ where: { tenantId: user.tenantId, id } }));
    const data: Prisma.CustomerUpdateInput = {}, changed: string[] = [];
    if (dto.name !== undefined) { const name = normalizeName(dto.name); if (name !== current.name) { data.name = name; changed.push('name'); } }
    if (dto.phone !== undefined) { const phone = normalizePhone(dto.phone); if (phone !== current.phone) { data.phone = phone; changed.push('phone'); } }
    if (dto.email !== undefined) { const email = normalizeEmail(dto.email); if (email !== current.email) { data.email = email; changed.push('email'); } }
    if (dto.notes !== undefined) { const notes = normalizeNotes(dto.notes)!; if (notes.length > 500) throw new BadRequestException('Catatan maksimum 500 karakter.'); if (notes !== current.notes) { data.notes = notes; changed.push('notes'); } }
    if (!changed.length) return this.get(user, id);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.customer.update({ where: { tenantId_id: { tenantId: user.tenantId, id } }, data });
        await audit(tx, user, 'customer.update', 'customer', id, undefined, { fields: changed });
      });
    } catch (error) { return this.conflict(error); }
    return this.get(user, id);
  }
  async sales(user: AuthenticatedUser, id: string, page?: string) {
    found(await this.prisma.customer.findFirst({ where: { tenantId: user.tenantId, id } }));
    const where = { tenantId: user.tenantId, customerId: id, status: 'paid', ...(user.allOutlets ? {} : { outletId: { in: user.outletIds } }) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({ where, select: saleHistory, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(page) }),
      this.prisma.sale.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items, total };
  }
}
