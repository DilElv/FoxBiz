import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

config({ quiet: true });
const prisma = new PrismaClient({ errorFormat: 'minimal' });
try {
  const migration = await readFile('apps/api/prisma/migrations/20261117020000_sprint2_pos/migration.sql', 'utf8');
  const upgrades = migration.slice(migration.indexOf('UPDATE roles SET')).split(';').map((sql) => sql.trim()).filter(Boolean);
  const oldCashier = ['catalog.read', 'inventory.read', 'pos.read'];
  const oldManager = ['organization.read', 'catalog.read', 'catalog.write', 'inventory.read', 'inventory.opening', 'inventory.threshold', 'pos.read'];
  const pos = ['pos.checkout', 'pos.edc.confirm', 'pos.hold'];
  await prisma.$transaction(async (tx) => {
    // Shadow only the unqualified migration target for this connection/transaction.
    await tx.$executeRawUnsafe('CREATE TEMP TABLE roles (code text, permissions text[]) ON COMMIT DROP');
    for (const [code, permissions] of [['owner', ['pos.read']], ['cashier', oldCashier], ['manager', oldManager], ['cashier', ['pos.read']], ['manager', [...oldManager, 'audit.read']]]) {
      await tx.$executeRaw`INSERT INTO pg_temp.roles (code, permissions) VALUES (${code}, ${permissions}::text[])`;
    }
    for (const sql of upgrades) await tx.$executeRawUnsafe(sql);
    const rows = await tx.$queryRaw`SELECT code, permissions FROM pg_temp.roles`;
    for (const code of ['owner', 'cashier', 'manager']) assert.ok(rows.some((row) => row.code === code && pos.every((permission) => row.permissions.includes(permission))));
    assert.ok(rows.some((row) => row.code === 'cashier' && JSON.stringify(row.permissions) === JSON.stringify(['pos.read'])));
    assert.ok(rows.some((row) => row.code === 'manager' && JSON.stringify(row.permissions) === JSON.stringify([...oldManager, 'audit.read'])));
  });
  const applied = await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261117020000_sprint2_pos' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(applied.length, 1);
  const result = { verifiedAt: new Date().toISOString(), applied: true, ownerUpgrade: true, defaultCashierUpgrade: true, defaultManagerUpgrade: true, customizedRolesPreserved: true, method: 'Exact migration UPDATE statements against transaction-local temporary roles table; real role data unchanged.' };
  await writeFile('docs/SPRINT_2_MIGRATION_RESULTS.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
