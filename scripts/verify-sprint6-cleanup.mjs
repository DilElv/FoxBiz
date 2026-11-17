import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
config({ quiet: true });
const prisma = new PrismaClient({ errorFormat: 'minimal' });
try {
  const smoke = JSON.parse(await readFile('docs/SPRINT_6_CLEANUP_RESULTS.json', 'utf8'));
  const tenants = await prisma.tenant.findMany({ where: { OR: [{ slug: { startsWith: 'crm-ui-' } }, { slug: { startsWith: 'crm-' } }, { slug: { startsWith: 'pos-ui-' } }] }, select: { id: true, slug: true } });
  const triggers = await prisma.$queryRaw`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'crm_fail_%'`;
  const functions = await prisma.$queryRaw`SELECT proname FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace WHERE nspname = 'public' AND proname LIKE 'crm_fail_%'`;
  assert.equal(tenants.length, 0); assert.equal(triggers.length, 0); assert.equal(functions.length, 0); assert.equal(smoke.remainingTenants, 0);
  const result = { ...smoke, verifiedAt: new Date().toISOString(), remainingCrmAndPosFixtureTenants: tenants.length, remainingCrmAuditTriggers: triggers.length, remainingCrmAuditFunctions: functions.length, complete: true };
  await writeFile('docs/SPRINT_6_CLEANUP_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
