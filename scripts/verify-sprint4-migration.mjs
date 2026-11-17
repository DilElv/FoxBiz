import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
config({ quiet: true });
const prisma = new PrismaClient({ errorFormat: 'minimal' });
try {
  const migration = await readFile('apps/api/prisma/migrations/20261117040000_sprint4_purchasing/migration.sql', 'utf8');
  const upgrades = migration.slice(migration.indexOf('UPDATE roles SET')).split(';').map((sql) => sql.trim()).filter(Boolean);
  const inventory = ['catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold', 'inventory.adjust', 'inventory.receive', 'inventory.transfer.send', 'inventory.transfer.receive'];
  const manager = ['organization.read', 'catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold', 'pos.read', 'pos.checkout', 'pos.edc.confirm', 'pos.hold', 'inventory.adjust', 'inventory.receive', 'inventory.transfer.send', 'inventory.transfer.receive'];
  const purchasing = ['purchasing.read', 'purchasing.suppliers.write', 'purchasing.orders.write', 'purchasing.orders.order', 'purchasing.orders.cancel', 'purchasing.receive'];
  const scenarios = [['owner', ['pos.read']], ['manager', manager], ['manager', [...manager, 'audit.read']], ['inventory', inventory], ['inventory', inventory.slice(1)], ['cashier', ['pos.read']]];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE roles (code text, permissions text[]) ON COMMIT DROP');
    for (const [code, permissions] of scenarios) await tx.$executeRaw`INSERT INTO pg_temp.roles (code, permissions) VALUES (${code}, ${permissions}::text[])`;
    for (const sql of upgrades) await tx.$executeRawUnsafe(sql);
    const rows = await tx.$queryRaw`SELECT code, permissions FROM pg_temp.roles`;
    assert.ok(rows.some((row) => row.code === 'owner' && purchasing.every((permission) => row.permissions.includes(permission))));
    assert.ok(rows.some((row) => row.code === 'manager' && purchasing.every((permission) => row.permissions.includes(permission))));
    assert.ok(rows.some((row) => row.code === 'manager' && JSON.stringify(row.permissions) === JSON.stringify([...manager, 'audit.read'])));
    assert.ok(rows.some((row) => row.code === 'inventory' && row.permissions.includes('purchasing.read') && row.permissions.includes('purchasing.receive') && !row.permissions.includes('purchasing.orders.write')));
    assert.ok(rows.some((row) => row.code === 'inventory' && JSON.stringify(row.permissions) === JSON.stringify(inventory.slice(1))));
    assert.ok(rows.some((row) => row.code === 'cashier' && JSON.stringify(row.permissions) === JSON.stringify(['pos.read'])));
  });
  const applied = await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261117040000_sprint4_purchasing' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(applied.length, 1);
  const result = { verifiedAt: new Date().toISOString(), applied: true, ownerUpgrade: true, defaultManagerUpgrade: true, defaultInventoryReadReceiveOnly: true, customizedRolesPreserved: true, cashierUnchanged: true, method: 'Exact migration UPDATE statements against transaction-local temporary roles table; actual role data unchanged.' };
  await writeFile('docs/SPRINT_4_MIGRATION_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
