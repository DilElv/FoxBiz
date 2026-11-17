import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from './auth.types';

export function found<T>(value: T | null): T {
  if (!value) throw new NotFoundException('Data tidak ditemukan di bisnis Anda.');
  return value;
}
export function pageArgs(page = '1') {
  if (!/^[1-9]\d{0,5}$/.test(page)) throw new BadRequestException('Nomor halaman tidak valid.');
  return { skip: (Number(page) - 1) * 25, take: 25 };
}
export async function audit(tx: Prisma.TransactionClient, user: AuthenticatedUser, action: string, entityType: string, entityId: string, before?: object, after?: object) {
  await tx.auditLog.create({ data: { tenantId: user.tenantId, actorUserId: user.id, action, entityType, entityId,
    ...(before ? { beforeData: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonObject } : {}), ...(after ? { afterData: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonObject } : {}) } });
}
export async function domainWrite<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P2002', 'P2034'].includes(error.code)) throw new ConflictException('Kode/data sudah dipakai atau diperbarui bersamaan. Muat ulang dan coba lagi.');
      if (error.code === 'P2025') throw new NotFoundException('Data tidak ditemukan.');
      if (error.code === 'P2003') throw new BadRequestException('Relasi data tidak valid.');
    }
    throw error;
  }
}
