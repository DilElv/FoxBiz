import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AuthenticatedUser } from './auth.types';
import { OpeningStockDto, ThresholdDto } from './sprint1.dto';
import { requireOutlet } from './permissions';
import { audit, domainWrite, found, pageArgs } from './domain-utils';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}
  private async outlet(user: AuthenticatedUser, outletId: string) {
    requireOutlet(user, outletId);
    return found(await this.prisma.outlet.findFirst({ where: { id: outletId, tenantId: user.tenantId, status: 'active' } }));
  }
  async balances(user: AuthenticatedUser, outletId: string, search?: string, page?: string) {
    await this.outlet(user, outletId);
    if (search && search.length > 160) throw new BadRequestException('Pencarian maksimum 160 karakter.');
    const where: Prisma.ProductWhereInput = { tenantId: user.tenantId, status: 'active', ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [products, total] = await this.prisma.$transaction([this.prisma.product.findMany({ where, include: { balances: { where: { tenantId: user.tenantId, outletId } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(page) }), this.prisma.product.count({ where })]);
    return { items: products.map(({ balances, ...product }) => ({ product, quantity: balances[0]?.quantity.toString() ?? '0', lowStockThreshold: balances[0]?.lowStockThreshold.toString() ?? '0', openedAt: balances[0]?.openedAt ?? null, lowStock: (balances[0]?.quantity ?? new Prisma.Decimal(0)).lte(balances[0]?.lowStockThreshold ?? 0) })), total };
  }
  async movements(user: AuthenticatedUser, outletId: string, page?: string) {
    await this.outlet(user, outletId);
    const where = { tenantId: user.tenantId, outletId };
    const [items, total] = await this.prisma.$transaction([this.prisma.stockMovement.findMany({ where, include: { product: { select: { name: true, sku: true, unit: true } } }, orderBy: { createdAt: 'desc' }, ...pageArgs(page) }), this.prisma.stockMovement.count({ where })]);
    return { items, total };
  }
  async opening(user: AuthenticatedUser, dto: OpeningStockDto) {
    await this.outlet(user, dto.outletId);
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      const product = found(await tx.product.findFirst({ where: { tenantId: user.tenantId, id: dto.productId, status: 'active' } }));
      const key = { tenantId: user.tenantId, outletId: dto.outletId, productId: product.id };
      await tx.stockBalance.upsert({ where: { tenantId_outletId_productId: key }, create: key, update: {} });
      await tx.$queryRaw`SELECT id FROM stock_balances WHERE tenant_id = ${user.tenantId}::uuid AND outlet_id = ${dto.outletId}::uuid AND product_id = ${dto.productId}::uuid FOR UPDATE`;
      const balance = await tx.stockBalance.findUniqueOrThrow({ where: { tenantId_outletId_productId: key } });
      if (balance.openedAt || !balance.quantity.isZero()) throw new ConflictException('Saldo awal produk pada outlet ini sudah dicatat.');
      const after = await tx.stockBalance.update({ where: { id: balance.id }, data: { quantity: new Prisma.Decimal(dto.quantity), openedAt: new Date() } });
      await tx.stockMovement.create({ data: { ...key, quantity: new Prisma.Decimal(dto.quantity), movementType: 'opening', reference: `opening:${product.id}`, createdBy: user.id, note: dto.note, beforeQuantity: new Prisma.Decimal(0), afterQuantity: new Prisma.Decimal(dto.quantity) } });
      await audit(tx, user, 'inventory.opening', 'stock_balance', balance.id, { quantity: balance.quantity.toString() }, { quantity: dto.quantity, note: dto.note, outletId: dto.outletId, productId: product.id });
      return after;
    }));
  }
  async threshold(user: AuthenticatedUser, dto: ThresholdDto) {
    await this.outlet(user, dto.outletId);
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      found(await tx.product.findFirst({ where: { id: dto.productId, tenantId: user.tenantId } }));
      const key = { tenantId: user.tenantId, outletId: dto.outletId, productId: dto.productId };
      const before = await tx.stockBalance.findUnique({ where: { tenantId_outletId_productId: key } });
      const after = await tx.stockBalance.upsert({ where: { tenantId_outletId_productId: key }, create: { ...key, lowStockThreshold: dto.lowStockThreshold }, update: { lowStockThreshold: dto.lowStockThreshold } });
      await audit(tx, user, 'inventory.threshold', 'stock_balance', after.id, { lowStockThreshold: before?.lowStockThreshold.toString() ?? '0' }, { lowStockThreshold: dto.lowStockThreshold });
      return after;
    }));
  }
}
