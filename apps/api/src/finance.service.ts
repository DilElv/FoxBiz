import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuthenticatedUser } from './auth.types';
import { audit, domainWrite, found, pageArgs } from './domain-utils';
import { FINANCE_CATEGORIES, FinanceEntryDto, VoidFinanceDto } from './finance.dto';
import { requireOutlet } from './permissions';
import { PrismaService } from './prisma.service';

const include = { creator: { select: { id: true, name: true } }, voider: { select: { id: true, name: true } } };
const decimal = (value?: Prisma.Decimal | null) => value ?? new Prisma.Decimal(0);
function date(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2100-12-31') throw new BadRequestException('Tanggal harus YYYY-MM-DD antara tahun 2000–2100.');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new BadRequestException('Tanggal tidak valid.');
  return result;
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}
  private async outlet(user: AuthenticatedUser, id: string, tx: Prisma.TransactionClient = this.prisma) {
    requireOutlet(user, id);
    return found(await tx.outlet.findFirst({ where: { tenantId: user.tenantId, id, status: 'active' } }));
  }
  async metadata(user: AuthenticatedUser) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { timezone: true, currency: true } });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tenant.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return { ...tenant, today, categories: FINANCE_CATEGORIES };
  }
  private period(from?: string, to?: string) {
    const start = date(from), end = date(to);
    if (end < start || end.getTime() - start.getTime() > 365 * 86400000) throw new BadRequestException('Periode harus berurutan dan maksimal 366 hari.');
    return { gte: start, lte: end };
  }
  async entries(user: AuthenticatedUser, outletId: string, from?: string, to?: string, page?: string, kind?: string, status?: string) {
    await this.outlet(user, outletId);
    if (kind && !['income', 'expense'].includes(kind)) throw new BadRequestException('Jenis entri tidak valid.');
    if (status && !['posted', 'voided'].includes(status)) throw new BadRequestException('Status entri tidak valid.');
    const where = { tenantId: user.tenantId, outletId, businessDate: this.period(from, to), ...(kind ? { kind } : {}), ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.financeEntry.findMany({ where, include, orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(page) }), this.prisma.financeEntry.count({ where })], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items, total };
  }
  async byKey(user: AuthenticatedUser, key: string, outletId: string) {
    await this.outlet(user, outletId);
    return found(await this.prisma.financeEntry.findFirst({ where: { tenantId: user.tenantId, outletId, createdBy: user.id, idempotencyKey: key }, include }));
  }
  async create(user: AuthenticatedUser, dto: FinanceEntryDto) {
    await this.outlet(user, dto.outletId);
    const businessDate = date(dto.businessDate), amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0) || !FINANCE_CATEGORIES.some((item) => item.code === dto.category && item.kind === dto.kind) || dto.note.trim().length < 3) throw new BadRequestException('Nominal harus positif, kategori sesuai jenis, dan catatan minimal tiga karakter.');
    const normalized = { outletId: dto.outletId, kind: dto.kind, category: dto.category, amount: amount.toString(), businessDate: dto.businessDate, note: dto.note.trim() };
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId + ':finance:' + dto.idempotencyKey}, 0))::text`;
      const previous = await tx.financeEntry.findUnique({ where: { tenantId_idempotencyKey: { tenantId: user.tenantId, idempotencyKey: dto.idempotencyKey } }, include });
      if (previous) {
        if (previous.requestHash !== requestHash || previous.createdBy !== user.id) throw new ConflictException('Key entri sudah dipakai untuk permintaan berbeda.');
        return previous;
      }
      await tx.$queryRaw`SELECT id FROM outlets WHERE tenant_id = ${user.tenantId}::uuid AND id = ${dto.outletId}::uuid FOR SHARE`;
      await this.outlet(user, dto.outletId, tx);
      const entry = await tx.financeEntry.create({ data: { ...normalized, businessDate, tenantId: user.tenantId, createdBy: user.id, idempotencyKey: dto.idempotencyKey, requestHash }, include });
      await audit(tx, user, 'finance_entry.create', 'finance_entry', entry.id, undefined, entry);
      return entry;
    }));
  }
  async void(user: AuthenticatedUser, id: string, dto: VoidFinanceDto) {
    if (dto.reason.trim().length < 3) throw new BadRequestException('Alasan void minimal tiga karakter.');
    await this.outlet(user, dto.outletId);
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM finance_entries WHERE tenant_id = ${user.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const before = found(await tx.financeEntry.findFirst({ where: { tenantId: user.tenantId, outletId: dto.outletId, id }, include }));
      await tx.$queryRaw`SELECT id FROM outlets WHERE tenant_id = ${user.tenantId}::uuid AND id = ${dto.outletId}::uuid FOR SHARE`;
      await this.outlet(user, dto.outletId, tx);
      if (before.status === 'voided') {
        if (before.voidReason !== dto.reason.trim() || before.voidedBy !== user.id) throw new ConflictException('Entri sudah di-void oleh permintaan lain. Muat ulang.');
        return before;
      }
      const after = await tx.financeEntry.update({ where: { id }, data: { status: 'voided', voidReason: dto.reason.trim(), voidedBy: user.id, voidedAt: new Date() }, include });
      await audit(tx, user, 'finance_entry.void', 'finance_entry', id, before, after);
      return after;
    }));
  }
  async report(user: AuthenticatedUser, outletId: string, from?: string, to?: string) {
    await this.outlet(user, outletId);
    const period = this.period(from, to);
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { timezone: true, currency: true } });
      // Convert local midnight to UTC in PostgreSQL so POS grouping follows the business timezone.
      const payments = await tx.$queryRaw<{ day: string; method: string; amount: Prisma.Decimal; count: bigint }[]>(Prisma.sql`
        SELECT to_char(s.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tenant.timezone}, 'YYYY-MM-DD') AS day,
          p.method, SUM(p.amount) AS amount, COUNT(*) AS count
        FROM sales s JOIN payments p ON p.tenant_id = s.tenant_id AND p.sale_id = s.id
        WHERE s.tenant_id = ${user.tenantId}::uuid AND s.outlet_id = ${outletId}::uuid AND s.status = 'paid'
          AND ((p.method = 'cash' AND p.status = 'received') OR (p.method = 'edc' AND p.status = 'manually_confirmed'))
          AND s.created_at >= (${from}::date::timestamp AT TIME ZONE ${tenant.timezone} AT TIME ZONE 'UTC')
          AND s.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${tenant.timezone} AT TIME ZONE 'UTC')
        GROUP BY day, p.method ORDER BY day, p.method`);
      const manual = await tx.financeEntry.groupBy({ by: ['businessDate', 'kind', 'category'], where: { tenantId: user.tenantId, outletId, status: 'posted', businessDate: period }, _sum: { amount: true }, _count: true });
      const days = new Map<string, { day: string; cashSales: Prisma.Decimal; edcSales: Prisma.Decimal; manualIncome: Prisma.Decimal; manualExpense: Prisma.Decimal }>();
      const row = (day: string) => { if (!days.has(day)) days.set(day, { day, cashSales: decimal(), edcSales: decimal(), manualIncome: decimal(), manualExpense: decimal() }); return days.get(day)!; };
      for (let time = period.gte.getTime(); time <= period.lte.getTime(); time += 86400000) row(new Date(time).toISOString().slice(0, 10));
      let cashSaleCount = 0, edcSaleCount = 0;
      for (const payment of payments) { row(payment.day)[payment.method === 'cash' ? 'cashSales' : 'edcSales'] = payment.amount; if (payment.method === 'cash') cashSaleCount += Number(payment.count); else edcSaleCount += Number(payment.count); }
      const categories = new Map<string, { kind: string; category: string; amount: Prisma.Decimal; count: number }>();
      for (const entry of manual) {
        const field = entry.kind === 'income' ? 'manualIncome' : 'manualExpense', amount = decimal(entry._sum.amount), daily = row(entry.businessDate.toISOString().slice(0, 10));
        daily[field] = daily[field].add(amount);
        const category = categories.get(entry.category) ?? { kind: entry.kind, category: entry.category, amount: decimal(), count: 0 };
        category.amount = category.amount.add(amount); category.count += entry._count; categories.set(entry.category, category);
      }
      const daily = [...days.values()].map((entry) => ({ ...entry, netCash: entry.cashSales.add(entry.manualIncome).sub(entry.manualExpense) }));
      const sum = (field: 'cashSales' | 'edcSales' | 'manualIncome' | 'manualExpense' | 'netCash') => daily.reduce((total, entry) => total.add(entry[field]), decimal());
      return { outletId, from, to, ...tenant, summary: { cashSales: sum('cashSales'), edcSales: sum('edcSales'), manualIncome: sum('manualIncome'), manualExpense: sum('manualExpense'), netCash: sum('netCash'), cashSaleCount, edcSaleCount }, daily, categories: [...categories.values()] };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
