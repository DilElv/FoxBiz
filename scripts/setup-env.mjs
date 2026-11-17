import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(path)) {
  console.log('.env already exists; preserved.');
} else {
  const password = randomBytes(24).toString('hex');
  writeFileSync(path, `NODE_ENV=development\nAPI_PORT=4000\nWEB_ORIGIN=http://localhost:3000\nDATABASE_URL=postgresql://foxbiz:${password}@127.0.0.1:55432/foxbiz_sprint0?schema=public\nSESSION_TTL_HOURS=8\n`, { mode: 0o600 });
  console.log('Created local .env with a generated database password.');
}
