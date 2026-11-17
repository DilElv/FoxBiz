import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AuthenticatedUser } from './auth.types';
import { PrismaService } from './prisma.service';
import { StockDocumentDto } from './stock.dto';
import { audit, domainWrite, found, pageArgs } from './domain-utils';
import { Permission, requireOutlet } from './permissions';

const include = { items: { orderBy: { sku: 'asc' as const } }, outlet: { select: { id: true, name: true } }, destinationOutlet: { select: { id: true, name: true } }, creator: { select: { id: true, name: true } }, receiver: { select: { id: true, name: true } }, goodsReceipt: { select: { id: true, purchaseOrder: { select: { id: true, poNo: true } } } } };
const maximum = new Prisma.Decimal('99999999999.999');
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}
  private permission(user: AuthenticatedUser, permission: Permission) { if (!user.permissions.includes(permission)) throw new ForbiddenException('Anda tidak memiliki izin untuk tindakan ini.'); }
  private async outlet(user: AuthenticatedUser, id: string, tx: Prisma.TransactionClient = this.prisma) {
    requireOutlet(user, id);
    return found(await tx.outlet.findFirst({ where: { tenantId: user.tenantId, id, status: 'active' } }));
  }
  async destinations(user: AuthenticatedUser, outletId: string) {
    await this.outlet(user, outletId);
    // Senders may choose any active outlet in their tenant; receiving still requires destination access.
    return this.prisma.outlet.findMany({ where: { tenantId: user.tenantId, status: 'active', id: { not: outletId } }, select: { id: true, name: true, code: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  }
  async list(user: AuthenticatedUser, outletId: string, page?: string, kind?: string, status?: string) {
    await this.outlet(user, outletId);
    if (kind && !['adjustment', 'receiving', 'transfer'].includes(kind)) throw new BadRequestException('Jenis dokumen tidak valid.');
    if (status && !['posted', 'sent', 'received'].includes(status)) throw new BadRequestException('Status dokumen tidak valid.');
    const where: Prisma.StockDocumentWhereInput = { tenantId: user.tenantId, OR: [{ outletId }, { destinationOutletId: outletId }], ...(kind ? { kind } : {}), ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.stockDocument.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(page) }), this.prisma.stockDocument.count({ where })]);
    return { items, total };
  }
  async detail(user: AuthenticatedUser, id: string, outletId: string) {
    await this.outlet(user, outletId);
    return found(await this.prisma.stockDocument.findFirst({ where: { tenantId: user.tenantId, id, OR: [{ outletId }, { destinationOutletId: outletId }] }, include }));
  }
  async byKey(user: AuthenticatedUser, key: string, outletId: string) {
    await this.outlet(user, outletId);
    return found(await this.prisma.stockDocument.findFirst({ where: { tenantId: user.tenantId, idempotencyKey: key, outletId, createdBy: user.id }, include }));
  }
  private async lockOutlets(tx: Prisma.TransactionClient, tenantId: string, ids: string[]) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM outlets WHERE tenant_id = ${tenantId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
  }
  private async lockProducts(tx: Prisma.TransactionClient, tenantId: string, ids: string[]) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE tenant_id = ${tenantId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
  }
  private async move(tx: Prisma.TransactionClient, user: AuthenticatedUser, outletId: string, productId: string, delta: Prisma.Decimal, movementType: string, reference: string, note: string) {
    const key = { tenantId: user.tenantId, outletId, productId };
    await tx.stockBalance.upsert({ where: { tenantId_outletId_productId: key }, create: key, update: {} });
    await tx.$queryRaw`SELECT id FROM stock_balances WHERE tenant_id = ${user.tenantId}::uuid AND outlet_id = ${outletId}::uuid AND product_id = ${productId}::uuid FOR UPDATE`;
    const before = await tx.stockBalance.findUniqueOrThrow({ where: { tenantId_outletId_productId: key } });
    const quantity = before.quantity.add(delta);
    if (quantity.lt(0)) throw new ConflictException('Stok tidak cukup. Mutasi tidak boleh menghasilkan stok negatif.');
    if (quantity.gt(maximum)) throw new BadRequestException('Saldo stok melampaui batas penyimpanan.');
    await tx.stockBalance.update({ where: { id: before.id }, data: { quantity, openedAt: before.openedAt ?? new Date() } });
    await tx.stockMovement.create({ data: { ...key, quantity: delta, movementType, reference, createdBy: user.id, note, beforeQuantity: before.quantity, afterQuantity: quantity } });
  }
  // Called only inside Purchasing's transaction after the PO, outlet and products are locked.
  async postPurchaseReceipt(tx: Prisma.TransactionClient, user: AuthenticatedUser, outletId: string, poNo: string, note: string, externalReference: string, requestHash: string, items: { productId: string; name: string; sku: string; unit: string; quantity: Prisma.Decimal }[]) {
    const document = await tx.stockDocument.create({ data: { tenantId: user.tenantId, outletId, createdBy: user.id, idempotencyKey: randomUUID(), requestHash, kind: 'receiving', status: 'posted', note, externalReference: externalReference || poNo, items: { create: items } } });
    for (const item of items) await this.move(tx, user, outletId, item.productId, item.quantity, 'purchase_receipt', `stock:${document.id}`, note);
    await audit(tx, user, 'inventory.purchase_receipt', 'stock_document', document.id, undefined, { outletId, poNo, items });
    return document;
  }
  async create(user: AuthenticatedUser, dto: StockDocumentDto) {
    const permission: Permission = dto.kind === 'adjustment' ? 'inventory.adjust' : dto.kind === 'receiving' ? 'inventory.receive' : 'inventory.transfer.send';
    this.permission(user, permission);
    await this.outlet(user, dto.outletId);
    if (dto.kind === 'transfer') {
      if (!dto.destinationOutletId || dto.destinationOutletId === dto.outletId) throw new BadRequestException('Pilih outlet tujuan yang berbeda.');
    } else if (dto.destinationOutletId) throw new BadRequestException('Outlet tujuan hanya berlaku untuk transfer.');
    if (dto.note.trim().length < 3) throw new BadRequestException('Alasan minimal tiga karakter.');
    if (new Set(dto.items.map((item) => item.productId)).size !== dto.items.length) throw new BadRequestException('Produk duplikat pada dokumen.');
    const normalized = { outletId: dto.outletId, kind: dto.kind, destinationOutletId: dto.destinationOutletId ?? null, note: dto.note.trim(), externalReference: dto.externalReference?.trim() ?? '', items: [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId)).map((item) => ({ productId: item.productId, quantity: new Prisma.Decimal(item.quantity).toString() })) };
    for (const item of normalized.items) if (new Prisma.Decimal(item.quantity).isZero() || (dto.kind !== 'adjustment' && new Prisma.Decimal(item.quantity).lt(0))) throw new BadRequestException('Kuantitas wajib bukan nol; penerimaan dan transfer wajib positif.');
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId + ':stock:' + dto.idempotencyKey}, 0))::text`;
      const previous = await tx.stockDocument.findUnique({ where: { tenantId_idempotencyKey: { tenantId: user.tenantId, idempotencyKey: dto.idempotencyKey } }, include });
      if (previous) {
        if (previous.requestHash !== requestHash || previous.createdBy !== user.id) throw new ConflictException('Key dokumen sudah digunakan untuk permintaan berbeda.');
        return previous;
      }
      await this.lockOutlets(tx, user.tenantId, [dto.outletId, ...(dto.destinationOutletId ? [dto.destinationOutletId] : [])]);
      await this.outlet(user, dto.outletId, tx);
      if (dto.destinationOutletId) found(await tx.outlet.findFirst({ where: { tenantId: user.tenantId, id: dto.destinationOutletId, status: 'active' } }));
      const ids = normalized.items.map((item) => item.productId);
      await this.lockProducts(tx, user.tenantId, ids);
      const products = await tx.product.findMany({ where: { tenantId: user.tenantId, id: { in: ids }, status: 'active' } });
      if (products.length !== ids.length) found(null);
      const document = await tx.stockDocument.create({ data: { tenantId: user.tenantId, outletId: dto.outletId, destinationOutletId: dto.destinationOutletId, createdBy: user.id, idempotencyKey: dto.idempotencyKey, requestHash, kind: dto.kind, status: dto.kind === 'transfer' ? 'sent' : 'posted', note: normalized.note, externalReference: normalized.externalReference,
        items: { create: normalized.items.map((item) => { const product = products.find((product) => product.id === item.productId)!; return { productId: product.id, name: product.name, sku: product.sku, unit: product.unit, quantity: item.quantity }; }) },
      }, include });
      for (const item of normalized.items) await this.move(tx, user, dto.outletId, item.productId, new Prisma.Decimal(item.quantity).mul(dto.kind === 'transfer' ? -1 : 1), dto.kind === 'transfer' ? 'transfer_out' : dto.kind, `stock:${document.id}`, normalized.note);
      await audit(tx, user, `inventory.${dto.kind === 'transfer' ? 'transfer.send' : dto.kind}`, 'stock_document', document.id, undefined, { outletId: dto.outletId, destinationOutletId: dto.destinationOutletId, status: document.status, note: normalized.note, items: normalized.items });
      return document;
    }, { timeout: 15000 }));
  }
  async receive(user: AuthenticatedUser, id: string) {
    this.permission(user, 'inventory.transfer.receive');
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stock_documents WHERE tenant_id = ${user.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const document = found(await tx.stockDocument.findFirst({ where: { tenantId: user.tenantId, id, kind: 'transfer' }, include }));
      await this.lockOutlets(tx, user.tenantId, [document.destinationOutletId!]);
      await this.outlet(user, document.destinationOutletId!, tx);
      if (document.status === 'received') return document;
      if (document.status !== 'sent') throw new ConflictException('Transfer tidak dalam status dikirim.');
      const items = [...document.items].sort((a, b) => a.productId.localeCompare(b.productId));
      await this.lockProducts(tx, user.tenantId, items.map((item) => item.productId));
      for (const item of items) await this.move(tx, user, document.destinationOutletId!, item.productId, item.quantity, 'transfer_in', `stock:${id}`, document.note);
      const after = await tx.stockDocument.update({ where: { id }, data: { status: 'received', receivedBy: user.id, receivedAt: new Date() }, include });
      await audit(tx, user, 'inventory.transfer.receive', 'stock_document', id, { status: 'sent' }, { status: 'received', outletId: document.destinationOutletId });
      return after;
    }, { timeout: 15000 }));
  }
}
