import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AuthenticatedUser } from './auth.types';
import { audit, domainWrite, found, pageArgs } from './domain-utils';
import { requireOutlet } from './permissions';
import { PrismaService } from './prisma.service';
import { GoodsReceiptDto, PurchaseActionDto, PurchaseOrderDto, SupplierDto, UpdatePurchaseOrderDto } from './purchasing.dto';
import { StockService } from './stock.service';

const receiptInclude = { items: true, receiver: { select: { id: true, name: true } }, purchaseOrder: { select: { id: true, poNo: true, outletId: true } } };
const orderInclude = { items: { orderBy: { sku: 'asc' as const } }, outlet: { select: { id: true, name: true } }, creator: { select: { id: true, name: true } }, receipts: { include: receiptInclude, orderBy: { receivedAt: 'desc' as const } } };
const moneyMax = new Prisma.Decimal('999999999999.99');
const hash = (value: object) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class PurchasingService {
  constructor(private readonly prisma: PrismaService, private readonly stock: StockService) {}
  private async outlet(user: AuthenticatedUser, id: string, tx: Prisma.TransactionClient = this.prisma) {
    requireOutlet(user, id);
    return found(await tx.outlet.findFirst({ where: { tenantId: user.tenantId, id, status: 'active' } }));
  }
  private search(search = '') { if (search.length > 160) throw new BadRequestException('Pencarian maksimum 160 karakter.'); return search.trim(); }
  async suppliers(user: AuthenticatedUser, search?: string, page?: string, status?: string) {
    const term = this.search(search);
    if (status && !['active', 'inactive'].includes(status)) throw new BadRequestException('Status supplier tidak valid.');
    const where: Prisma.SupplierWhereInput = { tenantId: user.tenantId, ...(status ? { status } : {}), ...(term ? { name: { contains: term, mode: 'insensitive' } } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.supplier.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(page) }), this.prisma.supplier.count({ where })]);
    return { items, total };
  }
  async saveSupplier(user: AuthenticatedUser, dto: SupplierDto, id?: string) {
    if (!dto.name.trim()) throw new BadRequestException('Nama supplier wajib diisi.');
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      if (id) await tx.$queryRaw`SELECT id FROM suppliers WHERE tenant_id = ${user.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const before = id ? found(await tx.supplier.findFirst({ where: { tenantId: user.tenantId, id } })) : undefined;
      const data = { name: dto.name.trim(), contact: dto.contact.trim(), status: dto.status };
      const after = before ? await tx.supplier.update({ where: { id }, data }) : await tx.supplier.create({ data: { ...data, tenantId: user.tenantId } });
      await audit(tx, user, before ? 'supplier.update' : 'supplier.create', 'supplier', after.id, before, after);
      return after;
    }));
  }
  async products(user: AuthenticatedUser, search?: string, page?: string) {
    const term = this.search(search), where: Prisma.ProductWhereInput = { tenantId: user.tenantId, status: 'active', ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { sku: { contains: term, mode: 'insensitive' } }] } : {}) };
    return { items: await this.prisma.product.findMany({ where, select: { id: true, name: true, sku: true, unit: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(page) }), total: await this.prisma.product.count({ where }) };
  }
  async orders(user: AuthenticatedUser, outletId: string, page?: string, status?: string) {
    await this.outlet(user, outletId);
    if (status && !['draft', 'ordered', 'partially_received', 'received', 'cancelled'].includes(status)) throw new BadRequestException('Status PO tidak valid.');
    const where = { tenantId: user.tenantId, outletId, ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.purchaseOrder.findMany({ where, include: orderInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(page) }), this.prisma.purchaseOrder.count({ where })]);
    return { items, total };
  }
  async detail(user: AuthenticatedUser, id: string, outletId: string) {
    await this.outlet(user, outletId);
    return found(await this.prisma.purchaseOrder.findFirst({ where: { tenantId: user.tenantId, id, outletId }, include: orderInclude }));
  }
  async orderByKey(user: AuthenticatedUser, key: string, outletId: string) {
    await this.outlet(user, outletId);
    return found(await this.prisma.purchaseOrder.findFirst({ where: { tenantId: user.tenantId, outletId, idempotencyKey: key, createdBy: user.id }, include: orderInclude }));
  }
  async receiptByKey(user: AuthenticatedUser, key: string, outletId: string) {
    await this.outlet(user, outletId);
    return found(await this.prisma.goodsReceipt.findFirst({ where: { tenantId: user.tenantId, idempotencyKey: key, receivedBy: user.id, purchaseOrder: { outletId } }, include: receiptInclude }));
  }
  async receipts(user: AuthenticatedUser, outletId: string, page?: string) {
    await this.outlet(user, outletId);
    const where = { tenantId: user.tenantId, purchaseOrder: { outletId } };
    const [items, total] = await this.prisma.$transaction([this.prisma.goodsReceipt.findMany({ where, include: receiptInclude, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], ...pageArgs(page) }), this.prisma.goodsReceipt.count({ where })]);
    return { items, total };
  }
  private normalize(dto: Pick<PurchaseOrderDto, 'supplierId' | 'items' | 'note'>) {
    if (new Set(dto.items.map((item) => item.productId)).size !== dto.items.length) throw new BadRequestException('Produk duplikat pada PO.');
    return { supplierId: dto.supplierId, note: dto.note.trim(), items: [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId)).map((item) => {
      const qtyOrdered = new Prisma.Decimal(item.qtyOrdered), unitCost = new Prisma.Decimal(item.unitCost);
      if (qtyOrdered.lte(0)) throw new BadRequestException('Jumlah pesanan harus positif.');
      return { productId: item.productId, qtyOrdered: qtyOrdered.toString(), unitCost: unitCost.toString() };
    }) };
  }
  private async lockOutlet(tx: Prisma.TransactionClient, user: AuthenticatedUser, outletId: string) {
    await tx.$queryRaw`SELECT id FROM outlets WHERE tenant_id = ${user.tenantId}::uuid AND id = ${outletId}::uuid FOR SHARE`;
    await this.outlet(user, outletId, tx);
  }
  private async orderData(tx: Prisma.TransactionClient, user: AuthenticatedUser, normalized: ReturnType<PurchasingService['normalize']>) {
    await tx.$queryRaw`SELECT id FROM suppliers WHERE tenant_id = ${user.tenantId}::uuid AND id = ${normalized.supplierId}::uuid FOR SHARE`;
    const supplier = found(await tx.supplier.findFirst({ where: { tenantId: user.tenantId, id: normalized.supplierId, status: 'active' } }));
    const ids = normalized.items.map((item) => item.productId);
    await this.lockProducts(tx, user, ids);
    const products = await tx.product.findMany({ where: { tenantId: user.tenantId, id: { in: ids }, status: 'active' } });
    if (products.length !== ids.length) found(null);
    const items = normalized.items.map((item) => {
      const product = products.find((product) => product.id === item.productId)!;
      const lineTotal = new Prisma.Decimal(item.qtyOrdered).mul(item.unitCost).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (lineTotal.gt(moneyMax)) throw new BadRequestException('Nilai item melampaui batas penyimpanan.');
      return { ...item, name: product.name, sku: product.sku, unit: product.unit, lineTotal };
    });
    const total = items.reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0));
    if (total.gt(moneyMax)) throw new BadRequestException('Total PO melampaui batas penyimpanan.');
    return { supplierId: supplier.id, supplierName: supplier.name, note: normalized.note, total, items };
  }
  private async lockProducts(tx: Prisma.TransactionClient, user: AuthenticatedUser, ids: string[]) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE tenant_id = ${user.tenantId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`);
  }
  async createOrder(user: AuthenticatedUser, dto: PurchaseOrderDto) {
    await this.outlet(user, dto.outletId);
    const normalized = { outletId: dto.outletId, ...this.normalize(dto) }, requestHash = hash(normalized);
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId + ':po:' + dto.idempotencyKey}, 0))::text`;
      const previous = await tx.purchaseOrder.findUnique({ where: { tenantId_idempotencyKey: { tenantId: user.tenantId, idempotencyKey: dto.idempotencyKey } }, include: orderInclude });
      if (previous) {
        if (previous.requestHash !== requestHash || previous.createdBy !== user.id) throw new ConflictException('Key PO sudah dipakai untuk permintaan berbeda.');
        return previous;
      }
      await this.lockOutlet(tx, user, dto.outletId);
      const { items, ...data } = await this.orderData(tx, user, normalized);
      const id = randomUUID();
      const order = await tx.purchaseOrder.create({ data: { ...data, id, poNo: `PO-${id.toUpperCase()}`, tenantId: user.tenantId, outletId: dto.outletId, createdBy: user.id, idempotencyKey: dto.idempotencyKey, requestHash, items: { create: items } }, include: orderInclude });
      await audit(tx, user, 'purchase_order.create', 'purchase_order', id, undefined, order);
      return order;
    }, { timeout: 15000 }));
  }
  private async lockedOrder(tx: Prisma.TransactionClient, user: AuthenticatedUser, id: string) {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE tenant_id = ${user.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const order = found(await tx.purchaseOrder.findFirst({ where: { tenantId: user.tenantId, id }, include: orderInclude }));
    await this.lockOutlet(tx, user, order.outletId);
    return order;
  }
  async updateOrder(user: AuthenticatedUser, id: string, dto: UpdatePurchaseOrderDto) {
    const normalized = this.normalize(dto);
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      const before = await this.lockedOrder(tx, user, id);
      if (before.status !== 'draft' || before.version !== dto.version) throw new ConflictException('PO sudah berubah atau bukan draft. Muat ulang.');
      const { items, ...data } = await this.orderData(tx, user, normalized);
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId: user.tenantId, purchaseOrderId: id } });
      const after = await tx.purchaseOrder.update({ where: { id }, data: { ...data, version: { increment: 1 }, items: { create: items } }, include: orderInclude });
      await audit(tx, user, 'purchase_order.update', 'purchase_order', id, before, after);
      return after;
    }, { timeout: 15000 }));
  }
  async action(user: AuthenticatedUser, id: string, action: 'order' | 'cancel', dto: PurchaseActionDto) {
    if (action === 'cancel' && (!dto.reason || dto.reason.trim().length < 3)) throw new BadRequestException('Alasan pembatalan minimal tiga karakter.');
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      const before = await this.lockedOrder(tx, user, id), target = action === 'order' ? 'ordered' : 'cancelled';
      if (before.status === target) return before;
      if (before.version !== dto.version || (action === 'order' ? before.status !== 'draft' : !['draft', 'ordered'].includes(before.status))) throw new ConflictException('Status atau versi PO sudah berubah. Muat ulang.');
      if (action === 'order') await this.orderData(tx, user, this.normalize({ supplierId: before.supplierId, note: before.note, items: before.items.map((item) => ({ productId: item.productId, qtyOrdered: item.qtyOrdered.toString(), unitCost: item.unitCost.toString() })) }));
      const after = await tx.purchaseOrder.update({ where: { id }, data: { status: target, version: { increment: 1 }, ...(action === 'order' ? { orderedAt: new Date() } : { cancelledAt: new Date(), cancelReason: dto.reason!.trim() }) }, include: orderInclude });
      await audit(tx, user, `purchase_order.${action}`, 'purchase_order', id, { status: before.status }, { status: target, reason: dto.reason });
      return after;
    }, { timeout: 15000 }));
  }
  async receive(user: AuthenticatedUser, dto: GoodsReceiptDto) {
    await this.outlet(user, dto.outletId);
    if (dto.note.trim().length < 3 || new Set(dto.items.map((item) => item.productId)).size !== dto.items.length) throw new BadRequestException('Catatan minimal tiga karakter dan produk tidak boleh duplikat.');
    const normalized = { outletId: dto.outletId, purchaseOrderId: dto.purchaseOrderId, note: dto.note.trim(), externalReference: dto.externalReference.trim(), items: [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId)).map((item) => ({ productId: item.productId, qtyReceived: new Prisma.Decimal(item.qtyReceived).toString() })) };
    if (normalized.items.some((item) => new Prisma.Decimal(item.qtyReceived).lte(0))) throw new BadRequestException('Jumlah diterima harus positif.');
    const requestHash = hash(normalized);
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId + ':gr:' + dto.idempotencyKey}, 0))::text`;
      const previous = await tx.goodsReceipt.findUnique({ where: { tenantId_idempotencyKey: { tenantId: user.tenantId, idempotencyKey: dto.idempotencyKey } }, include: receiptInclude });
      if (previous) {
        if (previous.requestHash !== requestHash || previous.receivedBy !== user.id) throw new ConflictException('Key penerimaan sudah dipakai untuk permintaan berbeda.');
        return previous;
      }
      const order = await this.lockedOrder(tx, user, dto.purchaseOrderId);
      if (order.outletId !== dto.outletId) found(null);
      if (!['ordered', 'partially_received'].includes(order.status)) throw new ConflictException('PO belum dipesan, sudah selesai, atau dibatalkan.');
      await this.lockProducts(tx, user, normalized.items.map((item) => item.productId));
      const items = normalized.items.map((item) => {
        const ordered = order.items.find((line) => line.productId === item.productId), quantity = new Prisma.Decimal(item.qtyReceived);
        if (!ordered || ordered.qtyReceived.add(quantity).gt(ordered.qtyOrdered)) throw new ConflictException('Produk tidak ada dalam PO atau jumlah melebihi sisa pesanan.');
        return { productId: item.productId, name: ordered.name, sku: ordered.sku, unit: ordered.unit, quantity };
      });
      // Ordered products may subsequently be inactive; existing commitments can still be received.
      const document = await this.stock.postPurchaseReceipt(tx, user, dto.outletId, order.poNo, normalized.note, normalized.externalReference, requestHash, items);
      const receipt = await tx.goodsReceipt.create({ data: { tenantId: user.tenantId, purchaseOrderId: order.id, stockDocumentId: document.id, receivedBy: user.id, idempotencyKey: dto.idempotencyKey, requestHash, note: normalized.note, externalReference: normalized.externalReference, items: { create: normalized.items.map((item) => ({ qtyReceived: item.qtyReceived, orderItem: { connect: { tenantId_purchaseOrderId_productId: { tenantId: user.tenantId, purchaseOrderId: order.id, productId: item.productId } } } })) } }, include: receiptInclude });
      for (const item of items) await tx.purchaseOrderItem.update({ where: { tenantId_purchaseOrderId_productId: { tenantId: user.tenantId, purchaseOrderId: order.id, productId: item.productId } }, data: { qtyReceived: { increment: item.quantity } } });
      const remaining = await tx.purchaseOrderItem.findMany({ where: { tenantId: user.tenantId, purchaseOrderId: order.id } });
      const status = remaining.every((item) => item.qtyReceived.eq(item.qtyOrdered)) ? 'received' : 'partially_received';
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status, version: { increment: 1 } } });
      await audit(tx, user, 'goods_receipt.create', 'goods_receipt', receipt.id, undefined, { ...receipt, statusAfter: status });
      await audit(tx, user, 'purchase_order.receive', 'purchase_order', order.id, { status: order.status }, { status, goodsReceiptId: receipt.id });
      return receipt;
    }, { timeout: 15000 }));
  }
}
