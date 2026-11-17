'use client';

import type { ReactNode } from 'react';
import { useSession } from './session-provider';
import { PermissionDenied } from './workspace-ui';

export function PermissionBoundary({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useSession();
  return can(permission) ? children : <PermissionDenied/>;
}
