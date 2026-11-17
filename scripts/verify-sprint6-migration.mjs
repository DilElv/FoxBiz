import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
config({ quiet: true });
const prisma = new PrismaClient({ errorFormat: 'minimal' });
try {
  const migration = await readFile('apps/api/prisma/migrations/20261117060000_sprint6_crm/migration.sql', 'utf8');
  const upgrades = migration.slice(migration.indexOf('UPDATE roles SET')).split(';').map((sql) => sql.trim()).filter(Boolean);
  const manager = ['finance.read', 'finance.entries.write', 'finance.void', 'organization.read', 'catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold', 'pos.read', 'pos.checkout', 'pos.edc.confirm', 'pos.hold', 'inventory.adjust', 'inventory.receive', 'inventory.transfer.send', 'inventory.transfer.receive', 'purchasing.read', 'purchasing.suppliers.write', 'purchasing.orders.write', 'purchasing.orders.order', 'purchasing.orders.cancel', 'purchasing.receive'];
  const crm = ['crm.read', 'crm.customers.write'];
  const scenarios = [['owner', ['pos.read']], ['manager', manager], ['manager', [...manager, 'audit.read']], ['manager', manager.slice(1)], ['inventory', ['purchasing.read', 'purchasing.receive']], ['cashier', ['pos.read']], ['custom', ['crm.read']]];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE roles (scenario integer, code text, permissions text[]) ON COMMIT DROP');
    for (const [index, [code, permissions]] of scenarios.entries()) await tx.$executeRaw`INSERT INTO pg_temp.roles (scenario, code, permissions) VALUES (${index}, ${code}, ${permissions}::text[])`;
    for (const sql of upgrades) await tx.$executeRawUnsafe(sql);
    const rows = await tx.$queryRaw`SELECT scenario, code, permissions FROM pg_temp.roles ORDER BY scenario`;
    for (const index of [0, 1]) assert.ok(crm.every((permission) => rows[index].permissions.includes(permission)));
    for (let index = 2; index < rows.length; index++) assert.deepEqual(rows[index].permissions, scenarios[index][1]);
    for (const sql of upgrades) await tx.$executeRawUnsafe(sql);
    const replay = await tx.$queryRaw`SELECT scenario, code, permissions FROM pg_temp.roles ORDER BY scenario`;
    for (let index = 0; index < rows.length; index++) assert.deepEqual([...replay[index].permissions].sort(), [...rows[index].permissions].sort());
  });
  const applied = await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261117060000_sprint6_crm' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(applied.length, 1);
  const constraints = await prisma.$queryRaw`SELECT conname FROM pg_constraint WHERE conrelid IN ('customers'::regclass, 'sales'::regclass, 'held_carts'::regclass)`;
  for (const name of ['customers_name_check', 'customers_phone_check', 'customers_email_check', 'customers_notes_check', 'customers_tenant_id_fkey', 'sales_tenant_id_customer_id_fkey', 'held_carts_tenant_id_customer_id_fkey']) assert.ok(constraints.some((entry) => entry.conname === name), name);
  const columns = await prisma.$queryRaw`SELECT table_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'customer_id' AND table_name IN ('sales', 'held_carts')`;
  assert.equal(columns.length, 2); assert.ok(columns.every((column) => column.is_nullable === 'YES'));
  const indexes = await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'customers'`;
  assert.ok(indexes.some((index) => index.indexname === 'customers_tenant_id_phone_key'));
  const result = { verifiedAt: new Date().toISOString(), applied: true, ownerUpgrade: true, defaultManagerUpgrade: true, customizedRolesPreserved: true, inventoryCashierUnchanged: true, repeatableUpgrade: true, databaseConstraints: true, optionalCustomerColumns: true, uniqueTenantPhoneIndex: true, method: 'Exact migration role UPDATE statements on a transaction-local temporary table; actual roles unchanged. PostgreSQL catalogs checked for constraints, nullable columns and unique index.' };
  await writeFile('docs/SPRINT_6_MIGRATION_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
