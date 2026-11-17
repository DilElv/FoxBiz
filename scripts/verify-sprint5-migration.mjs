import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
config({ quiet: true });
const prisma = new PrismaClient({ errorFormat: 'minimal' });
try {
  const migration = await readFile('apps/api/prisma/migrations/20261117050000_sprint5_finance/migration.sql', 'utf8');
  const upgrades = migration.slice(migration.indexOf('UPDATE roles SET')).split(';').map((sql) => sql.trim()).filter(Boolean);
  const manager = ['organization.read', 'catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold', 'pos.read', 'pos.checkout', 'pos.edc.confirm', 'pos.hold', 'inventory.adjust', 'inventory.receive', 'inventory.transfer.send', 'inventory.transfer.receive', 'purchasing.read', 'purchasing.suppliers.write', 'purchasing.orders.write', 'purchasing.orders.order', 'purchasing.orders.cancel', 'purchasing.receive'];
  const finance = ['finance.read', 'finance.entries.write', 'finance.void'];
  const scenarios = [['owner', ['pos.read']], ['manager', manager], ['manager', [...manager, 'audit.read']], ['manager', manager.slice(1)], ['inventory', ['purchasing.read', 'purchasing.receive']], ['cashier', ['pos.read']], ['custom', ['finance.read']]];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE roles (scenario integer, code text, permissions text[]) ON COMMIT DROP');
    for (const [index, [code, permissions]] of scenarios.entries()) await tx.$executeRaw`INSERT INTO pg_temp.roles (scenario, code, permissions) VALUES (${index}, ${code}, ${permissions}::text[])`;
    for (const sql of upgrades) await tx.$executeRawUnsafe(sql);
    const rows = await tx.$queryRaw`SELECT scenario, code, permissions FROM pg_temp.roles ORDER BY scenario`;
    assert.ok(finance.every((permission) => rows[0].permissions.includes(permission)));
    assert.ok(finance.every((permission) => rows[1].permissions.includes(permission)));
    for (let index = 2; index < rows.length; index++) assert.deepEqual(rows[index].permissions, scenarios[index][1]);
    // Running the upgrade again must not duplicate or remove permissions.
    for (const sql of upgrades) await tx.$executeRawUnsafe(sql);
    const replay = await tx.$queryRaw`SELECT scenario, code, permissions FROM pg_temp.roles ORDER BY scenario`;
    for (let index = 0; index < rows.length; index++) assert.deepEqual([...replay[index].permissions].sort(), [...rows[index].permissions].sort());
  });
  const applied = await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261117050000_sprint5_finance' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(applied.length, 1);
  const constraints = await prisma.$queryRaw`SELECT conname FROM pg_constraint WHERE conrelid = 'finance_entries'::regclass`;
  for (const name of ['finance_entries_amount_check', 'finance_entries_note_check', 'finance_entries_category_check', 'finance_entries_status_check', 'finance_entries_tenant_id_outlet_id_fkey', 'finance_entries_tenant_id_created_by_fkey', 'finance_entries_tenant_id_voided_by_fkey']) assert.ok(constraints.some((entry) => entry.conname === name));
  const result = { verifiedAt: new Date().toISOString(), applied: true, ownerUpgrade: true, defaultManagerUpgrade: true, customizedRolesPreserved: true, inventoryCashierUnchanged: true, repeatableUpgrade: true, databaseConstraints: true, method: 'Exact migration UPDATE statements against transaction-local temporary roles table; actual role data unchanged. Catalog inspection confirms checks and tenant foreign keys.' };
  await writeFile('docs/SPRINT_5_MIGRATION_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
