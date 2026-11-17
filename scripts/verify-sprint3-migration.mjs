import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

config({ quiet: true });
const prisma = new PrismaClient({ errorFormat: 'minimal' });
try {
  const migration = await readFile('apps/api/prisma/migrations/20261117030000_sprint3_inventory/migration.sql', 'utf8');
  const upgrades = migration.slice(migration.indexOf('UPDATE roles SET')).split(';').map((sql) => sql.trim()).filter(Boolean);
  const sprint1Manager = ['organization.read', 'catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold', 'pos.read'];
  const sprint2Manager = [...sprint1Manager, 'pos.checkout', 'pos.edc.confirm', 'pos.hold'];
  const oldInventory = ['catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold'];
  const sprint3 = ['inventory.adjust', 'inventory.receive', 'inventory.transfer.send', 'inventory.transfer.receive'];
  const scenarios = [
    ['owner', ['pos.read']],
    ['manager', sprint1Manager],
    ['manager', sprint2Manager],
    ['manager', [...sprint2Manager, 'audit.read']],
    ['inventory', oldInventory],
    ['inventory', oldInventory.filter((permission) => permission !== 'inventory.threshold')],
    ['cashier', ['catalog.read', 'inventory.read', 'pos.read', 'pos.checkout', 'pos.edc.confirm', 'pos.hold']],
  ];
  await prisma.$transaction(async (tx) => {
    // Shadow only the unqualified migration target for this connection/transaction.
    await tx.$executeRawUnsafe('CREATE TEMP TABLE roles (code text, permissions text[]) ON COMMIT DROP');
    for (const [code, permissions] of scenarios) await tx.$executeRaw`INSERT INTO pg_temp.roles (code, permissions) VALUES (${code}, ${permissions}::text[])`;
    for (const sql of upgrades) await tx.$executeRawUnsafe(sql);
    const rows = await tx.$queryRaw`SELECT code, permissions FROM pg_temp.roles`;
    const has = (code, permissions) => rows.some((row) => row.code === code && permissions.every((permission) => row.permissions.includes(permission)));
    assert.ok(has('owner', sprint3));
    assert.ok(rows.filter((row) => row.code === 'manager' && !row.permissions.includes('audit.read')).every((row) => sprint3.every((permission) => row.permissions.includes(permission))));
    assert.ok(rows.some((row) => row.code === 'manager' && JSON.stringify(row.permissions) === JSON.stringify([...sprint2Manager, 'audit.read'])));
    assert.ok(has('inventory', sprint3));
    assert.ok(rows.some((row) => row.code === 'inventory' && JSON.stringify(row.permissions) === JSON.stringify(oldInventory.filter((permission) => permission !== 'inventory.threshold'))));
    assert.ok(!rows.some((row) => row.code === 'cashier' && sprint3.some((permission) => row.permissions.includes(permission))));
  });
  const applied = await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261117030000_sprint3_inventory' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(applied.length, 1);
  const result = { verifiedAt: new Date().toISOString(), applied: true, ownerUpgrade: true, defaultManagerUpgrade: true, sprint1AndSprint2ManagerUpgrade: true, defaultInventoryUpgrade: true, customizedRolesPreserved: true, cashierUnchanged: true, method: 'Exact migration UPDATE statements against transaction-local temporary roles table; real role data unchanged.' };
  await writeFile('docs/SPRINT_3_MIGRATION_RESULTS.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
