// Run explicitly on the production host after migrations. Never runs the development seed.
const { PrismaClient } = require('@prisma/client');
const { randomBytes } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { hash } = require('bcryptjs');
const { DEFAULT_ROLES } = require('../apps/api/dist/permissions');
const prisma = new PrismaClient({ errorFormat: 'minimal' });

async function main() {
  if (process.env.NODE_ENV !== 'production') throw new Error('Production environment required.');
  const slug = process.env.FOXBIZ_BOOTSTRAP_SLUG || 'foxbiz';
  const file = process.env.FOXBIZ_BOOTSTRAP_FILE;
  if (!file) throw new Error('FOXBIZ_BOOTSTRAP_FILE is required for private credential delivery.');
  if (await prisma.tenant.findFirst({ where: { slug } })) throw new Error('Tenant exists; refusing to overwrite credentials.');
  const login = { tenantSlug: slug, email: 'owner@foxbiz.bikinsaas.com', password: randomBytes(24).toString('base64url') };
  const passwordHash = await hash(login.password, 12);
  // Write the recovery credential before the transaction, never to stdout.
  writeFileSync(file, JSON.stringify(login, null, 2), { flag: 'wx', mode: 0o600 });
  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { slug, name: 'FoxBiz' } });
    for (const role of DEFAULT_ROLES) await tx.role.create({ data: { ...role, tenantId: tenant.id } });
    const role = await tx.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: 'owner' } } });
    await tx.user.create({ data: { tenantId: tenant.id, roleId: role.id, name: 'Owner FoxBiz', email: login.email, passwordHash, allOutlets: true } });
    await tx.outlet.create({ data: { tenantId: tenant.id, code: 'MAIN', name: 'Toko Utama' } });
  }, { timeout: 15000 });
  console.log('Production tenant, owner and MAIN outlet created. Credentials saved privately. No demo products or transactions added.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
