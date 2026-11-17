const fs = require('node:fs');
const cp = require('node:child_process');
const schema = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');
const baseline = schema.replace(/model (Sale|SaleItem|Payment|HeldCart) \{[\s\S]*?\n\}/g, '').replace(/^\s*(sales Sale\[\]|heldCarts HeldCart\[\]|saleItems SaleItem\[\])\r?\n/gm, '');
fs.writeFileSync('.local/pre-pos-schema.prisma', baseline);
const result = cp.spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-schema-datamodel', '.local/pre-pos-schema.prisma', '--to-schema-datamodel', 'apps/api/prisma/schema.prisma', '--script'], { encoding: 'utf8' });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status || 1); }
fs.mkdirSync('apps/api/prisma/migrations/20261117020000_sprint2_pos', { recursive: true });
fs.writeFileSync('apps/api/prisma/migrations/20261117020000_sprint2_pos/migration.sql', result.stdout);
console.log('Additive POS migration generated from schema files.');
