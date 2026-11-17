import { Request } from 'express';

export type AuthenticatedUser = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  tenantName: string;
  role: { id: string; code: string; name: string } | null;
  permissions: string[];
  allOutlets: boolean;
  outletIds: string[];
};

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };
