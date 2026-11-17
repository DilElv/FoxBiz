import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
config({ quiet: true });
const prisma = new PrismaClient({ errorFormat: 'minimal' });
try {
  const tenants = await prisma.$queryRaw`SELECT id, slug FROM tenants WHERE slug ~ '^(fin|finance-ui)-[0-9a-f-]{36}$' ORDER BY slug`;
  const triggers = await prisma.$queryRaw`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'fin_fail_%' AND NOT tgisinternal ORDER BY tgname`;
  const functions = await prisma.$queryRaw`SELECT proname FROM pg_proc WHERE proname LIKE 'fin_fail_%' ORDER BY proname`;
  const existing = JSON.parse(await readFile('docs/SPRINT_5_CLEANUP_RESULTS.json', 'utf8').catch(() => '{}'));
  const result = {
    ...existing,
    verifiedAt: new Date().toISOString(),
    remainingFinanceFixtureTenants: tenants.length,
    remainingFinanceFixtureSlugs: tenants.map((tenant) => tenant.slug),
    remainingFinanceAuditTriggers: triggers.map((trigger) => trigger.tgname),
    remainingFinanceAuditFunctions: functions.map((fn) => fn.proname),
    cleanupPass: existing.transactionCleanup === true && tenants.length === 0 && triggers.length === 0 && functions.length === 0,
  };
  await writeFile('docs/SPRINT_5_CLEANUP_RESULTS.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.cleanupPass) process.exitCode = 1;
} finally { await prisma.$disconnect(); }
