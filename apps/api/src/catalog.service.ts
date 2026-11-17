import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AuthenticatedUser } from './auth.types';
import { CategoryDto, ProductDto } from './sprint1.dto';
import { audit, domainWrite, found, pageArgs } from './domain-utils';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}
  categories(user: AuthenticatedUser) { return this.prisma.category.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: 'asc' } }); }
  async saveCategory(user: AuthenticatedUser, dto: CategoryDto, id?: string) {
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      const before = id ? found(await tx.category.findFirst({ where: { tenantId: user.tenantId, id } })) : null;
      const after = before ? await tx.category.update({ where: { id: before.id }, data: dto }) : await tx.category.create({ data: { ...dto, tenantId: user.tenantId } });
      await audit(tx, user, before ? 'category.update' : 'category.create', 'category', after.id, before ?? undefined, after);
      return after;
    }));
  }
  async products(user: AuthenticatedUser, query: { search?: string; categoryId?: string; status?: string; page?: string }) {
    if (query.categoryId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.categoryId)) throw new BadRequestException('ID kategori tidak valid.');
    if (query.search && query.search.length > 160) throw new BadRequestException('Pencarian maksimum 160 karakter.');
    if (query.status && !['active', 'inactive'].includes(query.status)) throw new BadRequestException('Status tidak valid.');
    const where: Prisma.ProductWhereInput = { tenantId: user.tenantId, ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { OR: ['name', 'sku', 'barcode'].map((field) => ({ [field]: { contains: query.search, mode: 'insensitive' } })) } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.product.findMany({ where, include: { category: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageArgs(query.page) }), this.prisma.product.count({ where })]);
    return { items, total };
  }
  async saveProduct(user: AuthenticatedUser, dto: ProductDto, id?: string) {
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      const before = id ? found(await tx.product.findFirst({ where: { tenantId: user.tenantId, id } })) : null;
      if (dto.categoryId) found(await tx.category.findFirst({ where: { tenantId: user.tenantId, id: dto.categoryId, status: 'active' } }));
      if (dto.barcode) {
        const duplicate = await tx.product.findFirst({ where: { tenantId: user.tenantId, barcode: dto.barcode, ...(id ? { id: { not: id } } : {}) } });
        if (duplicate) throw new BadRequestException('Barcode sudah dipakai produk lain.');
      }
      const data = { ...dto, barcode: dto.barcode ?? null, categoryId: dto.categoryId ?? null, sellingPrice: new Prisma.Decimal(dto.sellingPrice) };
      const after = before ? await tx.product.update({ where: { id: before.id }, data }) : await tx.product.create({ data: { ...data, tenantId: user.tenantId } });
      await audit(tx, user, before ? 'product.update' : 'product.create', 'product', after.id, before ? JSON.parse(JSON.stringify(before)) : undefined, JSON.parse(JSON.stringify(after)));
      return after;
    }));
  }
}
