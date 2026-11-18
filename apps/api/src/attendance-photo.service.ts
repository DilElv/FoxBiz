import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import sharp from 'sharp';

export type AttendancePhotoInput = {
  tenantId: string;
  attendanceId: string;
  businessName: string;
  outletName: string;
  employeeName: string;
  employeeCode: string;
  kind: 'in' | 'out';
  at: Date;
  timezone: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  photo: Buffer;
};
export type SavedPhoto = { path: string; hash: string };

const zoneLabels: Record<string, string> = { 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT', UTC: 'UTC' };

function clip(value: string, max: number) { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
function escapeXml(value: string) { return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!); }
function timestamp(value: Date, timezone: string) {
  const formatted = new Intl.DateTimeFormat('id-ID', { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value);
  return `${formatted} ${zoneLabels[timezone] ?? timezone}`;
}

@Injectable()
export class AttendancePhotoService {
  private readonly root = resolve(process.env.ATTENDANCE_DIR || (process.env.NODE_ENV === 'production' ? '/var/lib/foxbiz/attendance' : join(process.cwd(), '.local', 'attendance')));

  async save(input: AttendancePhotoInput): Promise<SavedPhoto> {
    let original: Buffer;
    try {
      original = await sharp(input.photo, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata().then(() => input.photo);
    } catch {
      throw new BadRequestException('File foto tidak valid. Ambil ulang foto.');
    }
    const image = sharp(original, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
    const metadata = await image.metadata();
    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) throw new BadRequestException('Foto harus berformat JPG, PNG, atau WEBP.');
    if ((metadata.width ?? 0) < 320 || (metadata.height ?? 0) < 320) throw new BadRequestException('Foto terlalu kecil. Ambil foto ulang.');
    const resized = await image.jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const width = resized.info.width, height = resized.info.height;
    const titleSize = Math.max(20, Math.round(width * 0.021));
    const bodySize = Math.max(15, Math.round(width * 0.0165));
    const pad = Math.max(14, Math.round(width * 0.025));
    const line = Math.max(21, Math.round(bodySize * 1.55));
    const band = Math.min(Math.round(height * 0.48), pad * 2 + titleSize + line * 4 + 8);
    const coordinates = input.latitude !== undefined && input.longitude !== undefined
      ? `GPS ${input.latitude.toFixed(6)}, ${input.longitude.toFixed(6)}${input.accuracy !== undefined ? ` ±${Math.round(input.accuracy)} m` : ''}`
      : 'GPS tidak tersedia';
    const lines = [
      `${input.businessName} · ${input.outletName}`,
      `${input.kind === 'in' ? 'ABSEN MASUK' : 'ABSEN PULANG'} · ${input.employeeName} (${input.employeeCode})`,
      timestamp(input.at, input.timezone),
      coordinates,
      `ID ${input.attendanceId}`,
    ];
    const watermark = Buffer.from(`<svg width="${width}" height="${band}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${band}" fill="rgba(6, 26, 45, 0.84)"/>
      <rect x="0" y="0" width="${width}" height="6" fill="#1689ED"/>
      ${lines.map((text, index) => `<text x="${pad}" y="${pad + titleSize + index * line}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${index === 0 ? titleSize : bodySize}" font-weight="${index < 2 ? 'bold' : 'normal'}" fill="#FFFFFF">${escapeXml(clip(text, index === 0 ? 70 : 95))}</text>`).join('')}
    </svg>`);
    const output = await sharp(resized.data).composite([{ input: watermark, top: height - band, left: 0 }]).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
    const date = input.at.toISOString().slice(0, 10).split('-');
    const relative = join(input.tenantId, date[0], date[1], `${input.attendanceId}-${input.kind}.jpg`);
    const file = this.resolve(relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, output, { mode: 0o640 });
    return { path: relative.split(sep).join('/'), hash: createHash('sha256').update(output).digest('hex') };
  }

  async file(relative: string) {
    const full = this.resolve(relative);
    try { await stat(full); } catch { throw new NotFoundException('Foto absensi tidak tersedia atau sudah dihapus.'); }
    return createReadStream(full);
  }

  async remove(relative?: string | null) {
    if (!relative) return;
    await unlink(this.resolve(relative)).catch(() => undefined);
  }

  private resolve(relative: string) {
    if (!relative || relative.includes('\0') || relative.startsWith('/') || relative.includes('..')) throw new NotFoundException('Foto absensi tidak ditemukan.');
    const full = resolve(this.root, relative);
    if (full !== this.root && !full.startsWith(`${this.root}${sep}`)) throw new NotFoundException('Foto absensi tidak ditemukan.');
    return full;
  }
}
