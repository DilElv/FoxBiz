const { PrismaClient } = require('@prisma/client');
const { promises: fs } = require('node:fs');
const { join, resolve, sep } = require('node:path');

try { require('dotenv').config({ path: join(__dirname, '../../../.env'), quiet: true }); } catch { /* production supplies environment variables */ }

const retentionDays = Number(process.env.ATTENDANCE_RETENTION_DAYS || 180);
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error('ATTENDANCE_RETENTION_DAYS must be an integer between 1 and 3650.');
const root = resolve(process.env.ATTENDANCE_DIR || (process.env.NODE_ENV === 'production' ? '/var/lib/foxbiz/attendance' : join(process.cwd(), '.local', 'attendance')));
const cutoff = new Date(Date.now() - retentionDays * 86400000);
const prisma = new PrismaClient();

function filePath(relative) {
  if (!relative || relative.includes('\0') || relative.startsWith('/') || relative.includes('..')) return null;
  const full = resolve(root, relative);
  if (full !== root && !full.startsWith(`${root}${sep}`)) return null;
  return full;
}
async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
async function remove(file) {
  try { await fs.unlink(file); return true; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

async function main() {
  let removedFiles = 0, clearedRecords = 0, skipped = 0;
  for (;;) {
    const records = await prisma.attendance.findMany({
      where: { clockInAt: { lt: cutoff }, OR: [{ clockInPhoto: { not: null } }, { clockOutPhoto: { not: null } }] },
      select: { id: true, clockInPhoto: true, clockOutPhoto: true },
      orderBy: { clockInAt: 'asc' }, take: 200,
    });
    if (!records.length) break;
    for (const record of records) {
      const paths = [record.clockInPhoto, record.clockOutPhoto].filter(Boolean).map(filePath);
      if (paths.some((file) => !file)) { skipped += 1; continue; }
      let deleted = 0;
      for (const file of paths) { if (await exists(file)) { await remove(file); deleted += 1; } }
      await prisma.attendance.update({ where: { id: record.id }, data: { clockInPhoto: null, clockOutPhoto: null, clockInPhotoHash: null, clockOutPhotoHash: null } });
      removedFiles += deleted;
      clearedRecords += 1;
    }
  }
  console.log(JSON.stringify({ event: 'attendance_photos_purged', retentionDays, cutoff: cutoff.toISOString(), root, clearedRecords, removedFiles, skipped }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
