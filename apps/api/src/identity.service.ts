import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { AuthenticatedUser } from './auth.types';
import { RoleDto, UserDto } from './sprint1.dto';
import { requireTenantScope, PERMISSIONS } from './permissions';
import { audit, domainWrite, found, pageArgs } from './domain-utils';
import { hashPassword } from './password';

const safeUser = { id: true, name: true, email: true, status: true, roleId: true, allOutlets: true, role: { select: { id: true, name: true, code: true } }, outlets: { select: { outletId: true } } } as const;

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}
  roles(user: AuthenticatedUser) { requireTenantScope(user); return this.prisma.role.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: 'asc' } }); }
  async users(user: AuthenticatedUser, page?: string) {
    requireTenantScope(user);
    const where = { tenantId: user.tenantId };
    const [items, total] = await this.prisma.$transaction([this.prisma.user.findMany({ where, select: safeUser, orderBy: { createdAt: 'desc' }, ...pageArgs(page) }), this.prisma.user.count({ where })]);
    return { items, total };
  }
  async saveRole(user: AuthenticatedUser, dto: RoleDto, id?: string) {
    requireTenantScope(user);
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${user.tenantId}::uuid FOR UPDATE`;
      const before = id ? found(await tx.role.findFirst({ where: { id, tenantId: user.tenantId } })) : null;
      if (before?.code === 'owner') throw new BadRequestException('Role Business Owner dilindungi.');
      if (before?.permissions.some((permission) => !user.permissions.includes(permission))) throw new BadRequestException('Tidak dapat mengubah role dengan izin melebihi izin Anda.');
      if (dto.permissions.some((permission) => !user.permissions.includes(permission))) throw new BadRequestException('Tidak dapat memberikan izin melebihi izin Anda.');
      const result = before ? await tx.role.update({ where: { id: before.id }, data: dto }) : await tx.role.create({ data: { ...dto, tenantId: user.tenantId, code: `custom-${randomUUID()}` } });
      await audit(tx, user, before ? 'role.update' : 'role.create', 'role', result.id, before ?? undefined, result);
      return result;
    }));
  }
  async saveUser(user: AuthenticatedUser, dto: UserDto, id?: string) {
    requireTenantScope(user);
    if (!id && !dto.password) throw new BadRequestException('Password wajib untuk pengguna baru.');
    if (dto.password && Buffer.byteLength(dto.password, 'utf8') > 72) throw new BadRequestException('Password maksimum 72 byte.');
    const passwordHash = dto.password ? await hashPassword(dto.password) : undefined;
    return domainWrite(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${user.tenantId}::uuid FOR UPDATE`;
      const before = id ? found(await tx.user.findFirst({ where: { id, tenantId: user.tenantId }, select: safeUser })) : null;
      if (before?.roleId) {
        const previousRole = found(await tx.role.findFirst({ where: { id: before.roleId, tenantId: user.tenantId } }));
        if (previousRole.permissions.some((permission) => !user.permissions.includes(permission))) throw new BadRequestException('Tidak dapat mengubah pengguna dengan izin melebihi izin Anda.');
      }
      const role = found(await tx.role.findFirst({ where: { id: dto.roleId, tenantId: user.tenantId } }));
      if (role.permissions.some((permission) => !user.permissions.includes(permission))) throw new BadRequestException('Tidak dapat memberikan role melebihi izin Anda.');
      if (role.code === 'owner' && !dto.allOutlets) throw new BadRequestException('Business Owner membutuhkan seluruh outlet.');
      const outletCount = await tx.outlet.count({ where: { tenantId: user.tenantId, id: { in: dto.outletIds }, status: 'active' } });
      if (outletCount !== dto.outletIds.length) throw new BadRequestException('Outlet tidak valid atau tidak aktif.');
      if (!dto.allOutlets && dto.outletIds.length === 0 && dto.status === 'active') throw new BadRequestException('Pilih minimal satu outlet.');
      if (before?.role?.code === 'owner' && before.status === 'active' && (role.code !== 'owner' || dto.status !== 'active')) {
        const owners = await tx.user.count({ where: { tenantId: user.tenantId, status: 'active', role: { code: 'owner' } } });
        if (owners <= 1) throw new ConflictException('Business Owner aktif terakhir tidak boleh dinonaktifkan atau diganti role.');
      }
      const data = { name: dto.name.trim(), email: dto.email.toLowerCase(), status: dto.status, roleId: dto.roleId, allOutlets: dto.allOutlets, ...(passwordHash ? { passwordHash } : {}) };
      const saved = before ? await tx.user.update({ where: { id: before.id }, data, select: safeUser }) : await tx.user.create({ data: { ...data, tenantId: user.tenantId, passwordHash: passwordHash! }, select: safeUser });
      await tx.userOutlet.deleteMany({ where: { tenantId: user.tenantId, userId: saved.id } });
      if (!dto.allOutlets && dto.outletIds.length) await tx.userOutlet.createMany({ data: dto.outletIds.map((outletId) => ({ tenantId: user.tenantId, userId: saved.id, outletId })) });
      if (before) await tx.session.deleteMany({ where: { tenantId: user.tenantId, userId: saved.id } });
      const after = found(await tx.user.findFirst({ where: { id: saved.id, tenantId: user.tenantId }, select: safeUser }));
      await audit(tx, user, before ? 'user.update' : 'user.create', 'user', saved.id, before ?? undefined, { ...after, passwordChanged: Boolean(passwordHash) });
      return after;
    }));
  }
  permissions() { return PERMISSIONS; }
}
