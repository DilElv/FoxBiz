const fs = require('node:fs');
const cp = require('node:child_process');
const file = 'apps/api/prisma/migrations/20261117040000_sprint4_purchasing/migration.sql';
if (fs.existsSync(file)) throw new Error('Refusing to overwrite existing migration.');
const result = cp.spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-schema-datamodel', '.local/pre-sprint4-schema.prisma', '--to-schema-datamodel', 'apps/api/prisma/schema.prisma', '--script'], { encoding: 'utf8' });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status || 1); }
fs.mkdirSync('apps/api/prisma/migrations/20261117040000_sprint4_purchasing', { recursive: true });
fs.writeFileSync(file, result.stdout);
console.log(`Generated ${file}; append invariants and role upgrades before applying.`);
