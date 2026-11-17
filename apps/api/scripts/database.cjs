const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { config } = require('dotenv');

config({ path: join(__dirname, '../../../.env'), quiet: true });
const action = process.argv[2];
if (!['deploy', 'status'].includes(action)) throw new Error('Expected deploy or status.');
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', action, '--schema', 'prisma/schema.prisma'], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
