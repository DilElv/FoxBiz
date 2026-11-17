import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { AuthenticatedUser } from './auth.types';
import { CartDto, CheckoutDto, HoldDto } from './pos.dto';
import { requireOutlet } from './permissions';
import { audit, domainWrite, found, pageArgs } from './domain-utils';

const saleInclude = { items: { orderBy: { sku: 'asc' as const } }, payment: true };
const limit = new Prisma.Decimal('999999999999.99');
@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}
  private async outlet(user: AuthenticatedUser, id: string, tx: Prisma.TransactionClient = this.prisma) {
    requireOutlet(user, id);
    return found(await tx.outlet.findFirst({ where: { tenantId: user.tenantId, id, status: 'active' } }));
  }
  private async customer(user: AuthenticatedUser, id: string, tx: Prisma.TransactionClient = this.prisma) {
    return found(await tx.customer.findFirst({ where: { tenantId: user.tenantId, id } }));
  }
  private async calculate(user: AuthenticatedUser, dto: CartDto, tx: Prisma.TransactionClient = this.prisma) {
    if (new Set(dto.items.map((item) => item.productId)).size !== dto.items.length) throw new BadRequestException('Produk duplikat pada keranjang.');
    const products = await tx.product.findMany({ where: { tenantId: user.tenantId, id: { in: dto.items.map((item) => item.productId) }, status: 'active' }, include: { balances: { where: { tenantId: user.tenantId, outletId: dto.outletId } } } });
    const items = dto.items.map((item) => {
      const product = found(products.find((product) => product.id === item.productId) ?? null);
      const quantity = new Prisma.Decimal(item.quantity);
      if (quantity.lte(0)) throw new BadRequestException('Kuantitas harus lebih dari nol.');
      const lineTotal = product.sellingPrice.mul(quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (lineTotal.gt(limit)) throw new BadRequestException('Nilai transaksi terlalu besar.');
      return { productId: product.id, name: product.name, sku: product.sku, unit: product.unit, quantity, unitPrice: product.sellingPrice, lineTotal, available: product.balances[0]?.quantity ?? new Prisma.Decimal(0), priceChanged: !product.sellingPrice.eq(item.expectedPrice) };
    });
    const subtotal = items.reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0));
    if (subtotal.gt(limit)) throw new BadRequestException('Nilai transaksi terlalu besar.');
    return { items, subtotal, discount: '0', tax: '0', total: subtotal };
  }
  async products(user: AuthenticatedUser, outletId: string, search = '', page?: string, categoryId?: string) {
    await this.outlet(user, outletId);
    if (search.length > 160) throw new BadRequestException('Pencarian maksimum 160 karakter.');
    const where: Prisma.ProductWhereInput = { tenantId: user.tenantId, status: 'active', ...(categoryId ? { categoryId } : {}), ...(search ? { OR: ['name', 'sku', 'barcode'].map((field) => ({ [field]: { contains: search, mode: 'insensitive' } })) } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.product.findMany({ where, include: { balances: { where: { tenantId: user.tenantId, outletId } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(page) }), this.prisma.product.count({ where })]);
    return { items: items.map(({ balances, ...product }) => ({ ...product, available: balances[0]?.quantity.toString() ?? '0' })), total };
  }
  async quote(user: AuthenticatedUser, dto: CartDto) { await this.outlet(user, dto.outletId); return this.calculate(user, dto); }
  async customers(user: AuthenticatedUser, outletId: string, search = '') {
    await this.outlet(user, outletId);
    if (search.length > 160) throw new BadRequestException('Pencarian maksimum 160 karakter.');
    const query = search.trim(), phone = query.replace(/[\s().-]/g, '');
    if (query.length < 2) return [];
    return this.prisma.customer.findMany({
      where: { tenantId: user.tenantId, OR: [{ name: { contains: query, mode: 'insensitive' } }, { phone: { contains: phone || query } }] },
      select: { id: true, name: true, phone: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 20,
    });
  }
  async categories(user: AuthenticatedUser, outletId: string) {
    await this.outlet(user, outletId);
    return this.prisma.category.findMany({ where: { tenantId: user.tenantId, status: 'active' }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  }
  async checkout(user: AuthenticatedUser, dto: CheckoutDto) {
    await this.outlet(user, dto.outletId);
    if (dto.method === 'edc' && (!dto.manualConfirmed || !user.permissions.includes('pos.edc.confirm'))) throw new ForbiddenException('EDC membutuhkan izin dan konfirmasi manual setelah terminal menyatakan berhasil.');
    if (dto.method === 'cash' && dto.manualConfirmed) throw new BadRequestException('Konfirmasi EDC tidak berlaku untuk tunai.');
    if (dto.holdId && !user.permissions.includes('pos.hold')) throw new ForbiddenException('Melanjutkan hold membutuhkan izin hold.');
    const normalized = { outletId: dto.outletId, items: [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId)).map((item) => ({ productId: item.productId, quantity: new Prisma.Decimal(item.quantity).toString(), expectedPrice: new Prisma.Decimal(item.expectedPrice).toString() })), method: dto.method, tendered: new Prisma.Decimal(dto.tendered).toString(), manualConfirmed: dto.manualConfirmed, holdId: dto.holdId ?? null, holdVersion: dto.holdVersion ?? null, ...(dto.customerId ? { customerId: dto.customerId } : {}) };
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId + dto.idempotencyKey}, 0))::text`;
      const previous = await tx.sale.findUnique({ where: { tenantId_idempotencyKey: { tenantId: user.tenantId, idempotencyKey: dto.idempotencyKey } }, include: saleInclude });
      if (previous) {
        if (previous.requestHash !== requestHash || previous.cashierId !== user.id) throw new ConflictException('Key checkout sudah digunakan untuk permintaan berbeda.');
        return previous;
      }
      await tx.$queryRaw`SELECT id FROM outlets WHERE tenant_id = ${user.tenantId}::uuid AND id = ${dto.outletId}::uuid FOR SHARE`;
      const outlet = await this.outlet(user, dto.outletId, tx);
      const ids = normalized.items.map((item) => item.productId);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE tenant_id = ${user.tenantId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
      if (dto.holdId) {
        const held = await tx.heldCart.findFirst({ where: { id: dto.holdId, tenantId: user.tenantId, outletId: dto.outletId, cashierId: user.id, status: 'held' }, select: { customerId: true } });
        if (!held) throw new ConflictException('Hold telah diproses atau bukan milik Anda.');
        if (held.customerId && held.customerId !== dto.customerId) throw new ConflictException('Pelanggan harus sesuai keranjang hold. Gunakan keranjang baru untuk pelanggan lain.');
        const hold = await tx.heldCart.updateMany({ where: { id: dto.holdId, tenantId: user.tenantId, outletId: dto.outletId, cashierId: user.id, status: 'held', version: dto.holdVersion ?? -1 }, data: { status: 'completed', version: { increment: 1 } } });
        if (hold.count !== 1) throw new ConflictException('Hold telah diproses atau versinya tidak sesuai.');
      } else if (dto.holdVersion) throw new BadRequestException('Versi hold membutuhkan ID hold.');
      const customer = dto.customerId ? await this.customer(user, dto.customerId, tx) : null;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM stock_balances WHERE tenant_id = ${user.tenantId}::uuid AND outlet_id = ${dto.outletId}::uuid AND product_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY product_id FOR UPDATE`);
      const quote = await this.calculate(user, dto, tx);
      for (const item of quote.items) {
        if (item.priceChanged) throw new ConflictException(`Harga ${item.name} berubah. Tinjau ulang keranjang.`);
        if (item.available.lt(item.quantity)) throw new ConflictException(`Stok ${item.name} tidak cukup (tersedia ${item.available}).`);
      }
      const tendered = new Prisma.Decimal(dto.tendered);
      if (tendered.lt(quote.total) || (dto.method === 'edc' && !tendered.eq(quote.total))) throw new BadRequestException('Nominal pembayaran tidak sesuai total.');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
      const cashier = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      const id = randomUUID(), now = new Date();
      const sale = await tx.sale.create({ data: { id, tenantId: user.tenantId, outletId: outlet.id, cashierId: user.id, customerId: dto.customerId ?? null, receiptNo: `FB-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${id.toUpperCase()}`, idempotencyKey: dto.idempotencyKey, requestHash, subtotal: quote.subtotal, total: quote.total,
        receiptSnapshot: { business: tenant.name, outlet: outlet.name, address: outlet.address || tenant.address, timezone: tenant.timezone, currency: tenant.currency, cashier: cashier.name, ...(customer ? { customer: { name: customer.name } } : {}) },
        items: { create: quote.items.map((item) => ({ productId: item.productId, name: item.name, sku: item.sku, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal })) },
        payment: { create: { method: dto.method, status: dto.method === 'edc' ? 'manually_confirmed' : 'received', amount: quote.total, tendered, change: tendered.sub(quote.total), confirmedAt: now, manualConfirmedBy: dto.method === 'edc' ? user.id : null } },
      }, include: saleInclude });
      for (const item of quote.items) {
        await tx.stockBalance.update({ where: { tenantId_outletId_productId: { tenantId: user.tenantId, outletId: outlet.id, productId: item.productId } }, data: { quantity: { decrement: item.quantity } } });
        await tx.stockMovement.create({ data: { tenantId: user.tenantId, outletId: outlet.id, productId: item.productId, quantity: item.quantity.negated(), movementType: 'sale', reference: `sale:${id}`, createdBy: user.id, note: 'Penjualan POS', beforeQuantity: item.available, afterQuantity: item.available.sub(item.quantity) } });
      }
      await audit(tx, user, 'pos.checkout', 'sale', id, undefined, { outletId: outlet.id, total: quote.total, method: dto.method, customerId: dto.customerId ?? null });
      if (dto.method === 'edc') await audit(tx, user, 'pos.edc.confirm', 'payment', sale.payment!.id, undefined, { saleId: id, confirmedAt: now });
      return sale;
    }, { timeout: 15000 }));
  }
  async byKey(user: AuthenticatedUser, key: string, outletId: string) {
    await this.outlet(user, outletId);
    return found(await this.prisma.sale.findFirst({ where: { tenantId: user.tenantId, idempotencyKey: key, outletId, cashierId: user.id }, include: saleInclude }));
  }
  async sales(user: AuthenticatedUser, outletId: string, page?: string) {
    await this.outlet(user, outletId);
    const where = { tenantId: user.tenantId, outletId };
    const [items, total] = await this.prisma.$transaction([this.prisma.sale.findMany({ where, include: saleInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(page) }), this.prisma.sale.count({ where })]);
    return { items, total };
  }
  async receipt(user: AuthenticatedUser, id: string) {
    const sale = found(await this.prisma.sale.findFirst({ where: { tenantId: user.tenantId, id }, include: saleInclude }));
    await this.outlet(user, sale.outletId);
    await audit(this.prisma, user, 'pos.receipt.read', 'sale', id);
    return sale;
  }
  async holds(user: AuthenticatedUser, outletId: string) {
    await this.outlet(user, outletId);
    return this.prisma.heldCart.findMany({ where: { tenantId: user.tenantId, outletId, cashierId: user.id, status: 'held' }, include: { customer: { select: { id: true, name: true, phone: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  async hold(user: AuthenticatedUser, dto: HoldDto) {
    await this.outlet(user, dto.outletId);
    await this.calculate(user, dto);
    if (dto.customerId) await this.customer(user, dto.customerId);
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.heldCart.create({ data: { tenantId: user.tenantId, outletId: dto.outletId, cashierId: user.id, customerId: dto.customerId ?? null, label: dto.label, items: JSON.parse(JSON.stringify(dto.items)) as Prisma.InputJsonArray }, include: { customer: { select: { id: true, name: true, phone: true } } } });
      await audit(tx, user, 'pos.hold', 'held_cart', hold.id, undefined, { customerId: dto.customerId ?? null });
      return hold;
    });
  }
  async resume(user: AuthenticatedUser, id: string) {
    const hold = found(await this.prisma.heldCart.findFirst({ where: { tenantId: user.tenantId, id, cashierId: user.id, status: 'held' }, include: { customer: { select: { id: true, name: true, phone: true } } } }));
    const quote = await this.quote(user, { outletId: hold.outletId, items: hold.items as unknown as CartDto['items'] });
    return { hold, quote };
  }
}
