import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuthenticatedUser } from './auth.types';
import { OrganizationDto, OutletDto } from './sprint1.dto';
import { requireTenantScope } from './permissions';
import { audit, domainWrite, found, pageArgs } from './domain-utils';

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}
  profile(user: AuthenticatedUser) { return this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { id: true, name: true, slug: true, address: true, timezone: true, currency: true } }); }
  async saveProfile(user: AuthenticatedUser, dto: OrganizationDto) {
    requireTenantScope(user);
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
      const after = await tx.tenant.update({ where: { id: user.tenantId }, data: dto });
      await audit(tx, user, 'organization.update', 'tenant', user.tenantId, before, after);
      return after;
    }));
  }
  outlets(user: AuthenticatedUser) {
    return this.prisma.outlet.findMany({ where: { tenantId: user.tenantId, ...(user.allOutlets ? {} : { id: { in: user.outletIds }, status: 'active' }) }, orderBy: { name: 'asc' } });
  }
  async saveOutlet(user: AuthenticatedUser, dto: OutletDto, id?: string) {
    requireTenantScope(user);
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      const before = id ? found(await tx.outlet.findFirst({ where: { id, tenantId: user.tenantId } })) : null;
      const after = before ? await tx.outlet.update({ where: { id: before.id }, data: dto }) : await tx.outlet.create({ data: { ...dto, tenantId: user.tenantId } });
      await audit(tx, user, before ? 'outlet.update' : 'outlet.create', 'outlet', after.id, before ?? undefined, after);
      return after;
    }));
  }
  async logs(user: AuthenticatedUser, page?: string) {
    requireTenantScope(user);
    const where = { tenantId: user.tenantId };
    const [items, total] = await this.prisma.$transaction([this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(page) }), this.prisma.auditLog.count({ where })]);
    return { items, total };
  }
}
