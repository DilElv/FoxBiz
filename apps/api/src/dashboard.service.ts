import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from './auth.types';
import { found } from './domain-utils';
import { requireOutlet } from './permissions';
import { PrismaService } from './prisma.service';

const PERIODS = ['today', 'week', 'month'] as const;
type Period = typeof PERIODS[number];

function addDays(day: string, delta: number) {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000);
}
function weekday(day: string) { return new Date(`${day}T00:00:00.000Z`).getUTCDay(); }
function localDay(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
function offsetMs(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(value);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - value.getTime();
}
function zonedMidnight(day: string, timeZone: string) {
  const [year, month, date] = day.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, date);
  return new Date(guess - offsetMs(new Date(guess), timeZone));
}
function percent(current: number, previous: number) {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
function dayLabel(day: string) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(`${day}T00:00:00.000Z`));
}
function hourLabel(hour: number) { return `${String(hour).padStart(2, '0')}.00`; }
function number(value: Prisma.Decimal | null | undefined) { return Number(value ?? 0); }

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private range(day: string, period: Period) {
    if (period === 'today') {
      return { from: day, to: day, previousFrom: addDays(day, -1), previousTo: addDays(day, -1) };
    }
    if (period === 'week') {
      const from = addDays(day, -((weekday(day) + 6) % 7));
      const span = daysBetween(from, day);
      const previousFrom = addDays(from, -7);
      return { from, to: day, previousFrom, previousTo: addDays(previousFrom, span) };
    }
    const from = `${day.slice(0, 7)}-01`;
    const span = daysBetween(from, day);
    const previousTo = addDays(from, -1);
    const previousFrom = `${previousTo.slice(0, 7)}-01`;
    return { from, to: day, previousFrom, previousTo: addDays(previousFrom, Math.min(span, daysBetween(previousFrom, previousTo))) };
  }

  private async salesWindow(user: AuthenticatedUser, outletId: string, from: string, to: string, timeZone: string) {
    const period = {
      gte: zonedMidnight(from, timeZone),
      lt: zonedMidnight(addDays(to, 1), timeZone),
    };
    const where: Prisma.SaleWhereInput = {
      tenantId: user.tenantId,
      outletId,
      status: 'paid',
      createdAt: period,
      payment: { is: { OR: [{ method: 'cash', status: 'received' }, { method: 'edc', status: 'manually_confirmed' }] } },
    };
    const [totals, items] = await this.prisma.$transaction([
      this.prisma.sale.aggregate({ where, _sum: { total: true }, _count: { _all: true } }),
      this.prisma.saleItem.aggregate({ where: { tenantId: user.tenantId, sale: where }, _sum: { quantity: true } }),
    ]);
    return {
      sales: number(totals._sum.total),
      transactions: totals._count._all,
      items: number(items._sum.quantity),
    };
  }

  private async series(user: AuthenticatedUser, outletId: string, from: string, to: string, timeZone: string, period: Period) {
    const bucket = period === 'today'
      ? Prisma.sql`to_char(s.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'HH24')`
      : Prisma.sql`to_char(s.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`;
    const rows = await this.prisma.$queryRaw<{ bucket: string; amount: Prisma.Decimal }[]>(Prisma.sql`
      SELECT ${bucket} AS bucket, SUM(s.total) AS amount
      FROM sales s
      JOIN payments p ON p.tenant_id = s.tenant_id AND p.sale_id = s.id
      WHERE s.tenant_id = ${user.tenantId}::uuid AND s.outlet_id = ${outletId}::uuid AND s.status = 'paid'
        AND ((p.method = 'cash' AND p.status = 'received') OR (p.method = 'edc' AND p.status = 'manually_confirmed'))
        AND s.created_at >= (${from}::date::timestamp AT TIME ZONE ${timeZone} AT TIME ZONE 'UTC')
        AND s.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE ${timeZone} AT TIME ZONE 'UTC')
      GROUP BY bucket ORDER BY bucket`);
    const amounts = new Map(rows.map((row) => [row.bucket, row.amount.toString()]));
    if (period === 'today') {
      return Array.from({ length: 24 }, (_, hour) => ({
        key: String(hour).padStart(2, '0'),
        label: hourLabel(hour),
        amount: amounts.get(String(hour).padStart(2, '0')) ?? '0',
      }));
    }
    return Array.from({ length: daysBetween(from, to) + 1 }, (_, index) => {
      const day = addDays(from, index);
      return { key: day, label: dayLabel(day), amount: amounts.get(day) ?? '0' };
    });
  }

  private async alerts(user: AuthenticatedUser, outletId: string, today: string, capabilities: Record<string, boolean>) {
    const [lowStock, lowStockItems, pendingPurchaseOrders, attendance] = await Promise.all([
      capabilities.inventory
        ? this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
            SELECT COUNT(*)::int AS count
            FROM stock_balances sb
            JOIN products p ON p.tenant_id = sb.tenant_id AND p.id = sb.product_id
            WHERE sb.tenant_id = ${user.tenantId}::uuid AND sb.outlet_id = ${outletId}::uuid
              AND p.status = 'active' AND sb.quantity <= sb.low_stock_threshold`)
        : Promise.resolve([{ count: 0 }]),
      capabilities.inventory
        ? this.prisma.$queryRaw<{ name: string; sku: string; quantity: Prisma.Decimal; threshold: Prisma.Decimal }[]>(Prisma.sql`
            SELECT p.name, p.sku, sb.quantity, sb.low_stock_threshold AS threshold
            FROM stock_balances sb
            JOIN products p ON p.tenant_id = sb.tenant_id AND p.id = sb.product_id
            WHERE sb.tenant_id = ${user.tenantId}::uuid AND sb.outlet_id = ${outletId}::uuid
              AND p.status = 'active' AND sb.quantity <= sb.low_stock_threshold
            ORDER BY (sb.quantity - sb.low_stock_threshold) ASC, p.name ASC
            LIMIT 5`)
        : Promise.resolve([]),
      capabilities.purchasing
        ? this.prisma.purchaseOrder.count({ where: { tenantId: user.tenantId, outletId, status: { in: ['draft', 'ordered', 'partially_received'] } } })
        : Promise.resolve(0),
      capabilities.hris ? this.attendance(user, outletId, today) : Promise.resolve({ active: 0, present: 0, absent: 0, working: 0, absentNames: [] as string[] }),
    ]);
    return {
      lowStock: lowStock[0]?.count ?? 0,
      lowStockItems: lowStockItems.map((item) => ({ name: item.name, sku: item.sku, quantity: item.quantity.toString(), threshold: item.threshold.toString() })),
      pendingPurchaseOrders,
      attendance,
    };
  }

  private async attendance(user: AuthenticatedUser, outletId: string, today: string) {
    const employees = await this.prisma.employee.findMany({
      where: { tenantId: user.tenantId, status: 'active', OR: [{ allOutlets: true }, { outlets: { some: { tenantId: user.tenantId, outletId } } }] },
      select: { id: true, name: true, code: true }, orderBy: { name: 'asc' },
    });
    const records = await this.prisma.attendance.findMany({ where: { tenantId: user.tenantId, outletId, workDate: today }, select: { employeeId: true, clockOutAt: true } });
    const present = new Set(records.map((record) => record.employeeId));
    const absent = employees.filter((employee) => !present.has(employee.id));
    return {
      active: employees.length,
      present: present.size,
      absent: absent.length,
      working: records.filter((record) => !record.clockOutAt).length,
      absentNames: absent.slice(0, 5).map((employee) => employee.name),
    };
  }

  async summary(user: AuthenticatedUser, outletId: string, period = 'today') {
    if (!PERIODS.includes(period as Period)) throw new BadRequestException('Periode dashboard tidak valid.');
    requireOutlet(user, outletId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { timezone: true, currency: true } });
    const outlet = found(await this.prisma.outlet.findFirst({ where: { tenantId: user.tenantId, id: outletId, status: 'active' }, select: { id: true, name: true } }));
    const today = localDay(new Date(), tenant.timezone);
    const range = this.range(today, period as Period);
    const capabilities = {
      sales: user.permissions.includes('pos.read'),
      inventory: user.permissions.includes('inventory.read'),
      purchasing: user.permissions.includes('purchasing.read'),
      customers: user.permissions.includes('crm.read'),
      hris: user.permissions.includes('hris.read'),
    };
    const [current, previous, series, newCustomers, previousCustomers, alerts] = await Promise.all([
      capabilities.sales ? this.salesWindow(user, outletId, range.from, range.to, tenant.timezone) : Promise.resolve({ sales: 0, transactions: 0, items: 0 }),
      capabilities.sales ? this.salesWindow(user, outletId, range.previousFrom, range.previousTo, tenant.timezone) : Promise.resolve({ sales: 0, transactions: 0, items: 0 }),
      capabilities.sales ? this.series(user, outletId, range.from, range.to, tenant.timezone, period as Period) : Promise.resolve([]),
      capabilities.customers ? this.prisma.customer.count({ where: { tenantId: user.tenantId, createdAt: { gte: zonedMidnight(range.from, tenant.timezone), lt: zonedMidnight(addDays(range.to, 1), tenant.timezone) } } }) : Promise.resolve(0),
      capabilities.customers ? this.prisma.customer.count({ where: { tenantId: user.tenantId, createdAt: { gte: zonedMidnight(range.previousFrom, tenant.timezone), lt: zonedMidnight(addDays(range.previousTo, 1), tenant.timezone) } } }) : Promise.resolve(0),
      this.alerts(user, outletId, today, capabilities),
    ]);
    return {
      outletId, outletName: outlet.name, period, from: range.from, to: range.to, today, timezone: tenant.timezone, currency: tenant.currency,
      capabilities,
      summary: {
        sales: current.sales.toFixed(2), transactions: current.transactions, items: current.items.toFixed(3), newCustomers,
        previous: { sales: previous.sales.toFixed(2), transactions: previous.transactions, items: previous.items.toFixed(3), newCustomers: previousCustomers },
        trends: {
          sales: percent(current.sales, previous.sales),
          transactions: percent(current.transactions, previous.transactions),
          items: percent(current.items, previous.items),
          newCustomers: percent(newCustomers, previousCustomers),
        },
      },
      series,
      alerts,
    };
  }
}
