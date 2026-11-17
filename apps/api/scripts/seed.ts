import { config } from 'dotenv';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/password';
import { DEFAULT_ROLES } from '../src/permissions';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const prisma = new PrismaClient();
const file = resolve(__dirname, '../../../.local/development-login.json');
async function seed() {
  if (process.env.NODE_ENV === 'production') throw new Error('Development seed is disabled in production.');
  let login: { tenantId: string; tenantSlug: string; email: string; password: string };
  try { login = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    login = { tenantId: '446f8d2a-9ed6-4d25-bac5-2ad77601c661', tenantSlug: 'foxbiz-demo', email: 'owner@foxbiz.test', password: randomBytes(18).toString('base64url') };
    if (await prisma.tenant.findFirst({ where: { OR: [{ id: login.tenantId }, { slug: login.tenantSlug }] } })) throw new Error('Demo tenant exists without its local credentials file; refusing to overwrite.');
    await mkdir(resolve(__dirname, '../../../.local'), { recursive: true });
    await writeFile(file, JSON.stringify(login, null, 2), { flag: 'wx' });
  }
  const passwordHash = await hashPassword(login.password);
  await prisma.$transaction(async (tx) => {
    await tx.tenant.upsert({ where: { id: login.tenantId }, create: { id: login.tenantId, slug: login.tenantSlug, name: 'FoxBiz Demo' }, update: {} });
    for (const role of DEFAULT_ROLES) await tx.role.upsert({ where: { tenantId_code: { tenantId: login.tenantId, code: role.code } }, create: { ...role, tenantId: login.tenantId }, update: {} });
    const role = await tx.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: login.tenantId, code: 'owner' } } });
    await tx.user.upsert({ where: { tenantId_email: { tenantId: login.tenantId, email: login.email } }, create: { tenantId: login.tenantId, name: 'Owner Demo', email: login.email, passwordHash, roleId: role.id, allOutlets: true }, update: {} });
    for (const [code, name] of [['MAIN', 'Toko Utama'], ['BRANCH', 'Cabang Selatan']]) await tx.outlet.upsert({ where: { tenantId_code: { tenantId: login.tenantId, code } }, create: { tenantId: login.tenantId, code, name }, update: {} });
    const category = await tx.category.upsert({ where: { tenantId_name: { tenantId: login.tenantId, name: 'Minuman' } }, create: { tenantId: login.tenantId, name: 'Minuman' }, update: {} });
    for (const product of [{ sku: 'DEMO-KOPI', name: 'Kopi Susu', sellingPrice: '18000' }, { sku: 'DEMO-TEH', name: 'Teh Lemon', sellingPrice: '12000' }]) await tx.product.upsert({ where: { tenantId_sku: { tenantId: login.tenantId, sku: product.sku } }, create: { ...product, tenantId: login.tenantId, categoryId: category.id, unit: 'gelas' }, update: {} });
  });
  console.log('Development seed ready. Login details: .local/development-login.json (gitignored). Existing data and passwords are preserved.');
}
seed().finally(() => prisma.$disconnect()).catch((error) => { console.error(error.message); process.exitCode = 1; });
