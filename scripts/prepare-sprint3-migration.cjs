const fs = require('node:fs');
const cp = require('node:child_process');

const schema = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');
const baseline = schema
  .replace(/model (StockDocument|StockDocumentItem) \{[\s\S]*?\n\}/g, '')
  .replace(/^\s*stockDocuments StockDocument\[\]\r?\n/gm, '')
  .replace(/^\s*stockDocuments StockDocument\[\] @relation\("StockSource"\)\r?\n/gm, '')
  .replace(/^\s*incomingTransfers StockDocument\[\] @relation\("StockDestination"\)\r?\n/gm, '')
  .replace(/^\s*stockDocuments StockDocument\[\] @relation\("StockCreator"\)\r?\n/gm, '')
  .replace(/^\s*receivedTransfers StockDocument\[\] @relation\("StockReceiver"\)\r?\n/gm, '')
  .replace(/^\s*stockDocumentItems StockDocumentItem\[\]\r?\n/gm, '')
  .replace(/^\s*note String @default\(""\)\r?\n/gm, '')
  .replace(/^\s*beforeQuantity Decimal\? @map\("before_quantity"\) @db\.Decimal\(14, 3\)\r?\n/gm, '')
  .replace(/^\s*afterQuantity Decimal\? @map\("after_quantity"\) @db\.Decimal\(14, 3\)\r?\n/gm, '');

if (/StockDocument|stockDocument|beforeQuantity|afterQuantity/.test(baseline)) throw new Error('Baseline still references Sprint 3 schema objects.');
fs.writeFileSync('.local/pre-sprint3-schema.prisma', baseline);

const result = cp.spawnSync(process.execPath, [
  'node_modules/prisma/build/index.js', 'migrate', 'diff',
  '--from-schema-datamodel', '.local/pre-sprint3-schema.prisma',
  '--to-schema-datamodel', 'apps/api/prisma/schema.prisma',
  '--script',
], { encoding: 'utf8' });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status || 1); }

const folder = 'apps/api/prisma/migrations/20261117030000_sprint3_inventory';
const file = `${folder}/migration.sql`;
if (fs.existsSync(file)) throw new Error(`${file} already exists; refusing to overwrite manual constraints.`);
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(file, result.stdout);
console.log(`Generated ${file}. Append manual invariants and role upgrades before applying.`);
