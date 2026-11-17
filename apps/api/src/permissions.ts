import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest, AuthenticatedUser } from './auth.types';

export const PERMISSIONS = [
  'finance.read', 'finance.entries.write', 'finance.void',
  'crm.read', 'crm.customers.write',
  'organization.read', 'organization.write', 'users.read', 'users.write',
  'roles.read', 'roles.write', 'catalog.read', 'catalog.write',
  'inventory.read', 'inventory.opening', 'inventory.threshold', 'audit.read', 'pos.read',
  'pos.checkout', 'pos.edc.confirm', 'pos.hold',
  'inventory.adjust', 'inventory.receive', 'inventory.transfer.send', 'inventory.transfer.receive',
  'purchasing.read', 'purchasing.suppliers.write', 'purchasing.orders.write', 'purchasing.orders.order', 'purchasing.orders.cancel', 'purchasing.receive',
] as const;
export type Permission = typeof PERMISSIONS[number];
export const RequirePermission = (permission: Permission) => SetMetadata('permission', permission);
export const DEFAULT_ROLES = [
  { code: 'owner', name: 'Business Owner', permissions: [...PERMISSIONS] },
  { code: 'manager', name: 'Admin / Manager', permissions: ['finance.read', 'finance.entries.write', 'finance.void', 'crm.read', 'crm.customers.write', 'organization.read', 'catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold', 'pos.read', 'pos.checkout', 'pos.edc.confirm', 'pos.hold', 'inventory.adjust', 'inventory.receive', 'inventory.transfer.send', 'inventory.transfer.receive', 'purchasing.read', 'purchasing.suppliers.write', 'purchasing.orders.write', 'purchasing.orders.order', 'purchasing.orders.cancel', 'purchasing.receive'] },
  { code: 'cashier', name: 'Cashier', permissions: ['catalog.read', 'inventory.read', 'pos.read', 'pos.checkout', 'pos.edc.confirm', 'pos.hold'] },
  { code: 'inventory', name: 'Inventory Staff', permissions: ['catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold', 'inventory.adjust', 'inventory.receive', 'inventory.transfer.send', 'inventory.transfer.receive', 'purchasing.read', 'purchasing.receive'] },
  { code: 'hr', name: 'HR Staff', permissions: [] },
  { code: 'employee', name: 'Employee', permissions: [] },
];

export function can(user: AuthenticatedUser, permission: Permission) { return user.permissions.includes(permission); }
export function requireTenantScope(user: AuthenticatedUser) {
  if (!user.allOutlets) throw new ForbiddenException('Aksi ini membutuhkan akses seluruh outlet bisnis.');
}
export function requireOutlet(user: AuthenticatedUser, outletId: string) {
  if (!user.allOutlets && !user.outletIds.includes(outletId)) throw new ForbiddenException('Outlet tidak termasuk akses Anda.');
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const permission = this.reflector.getAllAndOverride<Permission>('permission', [context.getHandler(), context.getClass()]);
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!permission || !user || !can(user, permission)) throw new ForbiddenException('Anda tidak memiliki izin untuk tindakan ini.');
    return true;
  }
}
