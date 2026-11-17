# FoxBiz Sprint 0 — Status Report

Tanggal verifikasi: 17 November 2026

## Status ringkas

Sprint 0 **selesai pada tingkat implementasi foundation dan quality gate lokal**. Artinya: repository, web shell responsif, dashboard shell, entry point POS, API NestJS, session/tenant baseline, PostgreSQL/Prisma, design tokens, komponen reusable, automated checks, dan dokumentasi sudah berjalan serta diuji.

Status ini **bukan** klaim production-ready. Laporan ini merekam hasil Sprint 0; perkembangan berikutnya tersedia di `SPRINT_1_STATUS.md`.

Keputusan stack terbaru: backend tetap **NestJS 11 di Node.js 20**. Rencana migrasi ke Golang dibatalkan.

## Scope yang diselesaikan

- Monorepo npm workspaces: `apps/web`, `apps/api`, `packages/ui`, `infra/docker`, `scripts`, `docs`.
- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, font Inter.
- App shell responsif: sidebar desktop, drawer tablet, bottom navigation khusus mobile, topbar, dan dialog navigasi.
- Dashboard shell: empat KPI, grafik periode yang dapat diganti, kartu Foxi, Quick Access, Tasks & Alerts.
- Entry point POS dan route placeholder untuk Products, Inventory, Purchasing, Finance, HRIS, CRM, Reports, Settings.
- Design tokens terpusat dan primitive UI: Button, Input, Card, Badge, StatCard, SidebarItem, TableShell, Modal.
- API NestJS: health dengan cek database, login/logout/me, outlet foundation, session guard, validasi DTO, origin check, rate-limit baseline, request-id logging, dan error filter konsisten.
- PostgreSQL 17 + Prisma 6.19.3: tenant, outlet, user, session, product; migration `20261117000000_sprint0_foundation`.
- Auth baseline: cookie `foxbiz_session` HttpOnly, token disimpan sebagai hash SHA-256, password bcrypt, tenant selalu berasal dari sesi tervalidasi; header `x-tenant-id` yang tidak cocok ditolak `403`.
- Dokumen UI/UX resmi, screenshot bukti visual, README developer, dan laporan ini.

## Yang tidak termasuk Sprint 0

- Checkout POS, pembayaran tunai/EDC, dan konfirmasi pembayaran manual.
- Stok atomic, transfer/negative stock, purchasing, finance, HRIS, CRM, reports, dan settings lanjutan.
- Login UI lengkap dan seed user demo.
- RBAC/role-permission domain penuh.
- Deployment, hosting, observability produksi, dan hardeningsession produksi.

## Implementasi teknis

### Web

- `apps/web/app/page.tsx`: dashboard shell dengan data demo berlabel.
- `apps/web/components/app-shell.tsx`: shell responsif, navigasi modul, drawer, bottom nav, dialog.
- `apps/web/app/[module]/page.tsx`: entry point modul; POS menampilkan status entry point, bukan checkout.
- Loading, error, not-found, favicon, dan aset Foxi tersedia.
- Breakpoint: sidebar tetap pada `xl`, drawer pada tablet, bottom navigation hanya di bawah `md`.

### API dan keamanan

- `GET /api/v1/health`: status service dan koneksi database.
- `POST /api/v1/auth/login`: body `{ tenantSlug, email, password }`.
- `POST /api/v1/auth/logout`: revoke sesi aktif.
- `GET /api/v1/me`: profil dan tenant dari sesi.
- `GET /api/v1/foundation/outlets`: outlet aktif milik tenant sesi.
- Validasi environment, CORS/origin, DTO validation, rate limit login in-memory, request-id, dan error response konsisten.
- Integration test membuktikan sesi terisolasi per tenant, token tidak disimpan mentah, sesi kedaluwarsa gagal tertutup, logout mencabut sesi, dan email yang sama dapat hidup di dua tenant berbeda.

### Database

- PostgreSQL development terisolasi di `127.0.0.1:55432`, cluster `.local/postgres`.
- Prisma schema dan migration sudah diterapkan.
- `prisma migrate status`: 1 migration ditemukan, schema up to date.
- Tidak ada data bisnis produksi; dashboard memakai data demo.

### Dokumen UI/UX resmi

- Path: `docs/03_UIUX_Design_System_FoxBiz_Blue_White_v2.0_FINAL.docx`.
- Ukuran: 537.924 byte.
- Struktur: 164 paragraf, 16 tabel, 6 gambar tertanam, daftar isi eksplisit, halaman cover dan TOC terpisah, 17 page break.
- Validasi paket DOCX/ZIP: PASS, tidak ada member rusak.
- Cakupan: identitas Blue & White, aksen teal, maskot Foxi oranye/krem, tipografi Inter, kartu rounded, border/shadow halus, token warna, komponen, state loading/error/empty/success, spesifikasi responsif, implementasi, checklist kualitas, dan mockup modul utama.
- Pembayaran didokumentasikan sebagai tunai atau EDC eksternal dengan konfirmasi manual; tidak ada klaim verifikasi otomatis.

### Aksesibilitas dan konsistensi visual

- Teks muted `#5E6F84` dan success `#116B49` dipakai untuk memenuhi kontras teks kecil pada latar terang.
- Menu aktif dan bottom nav memakai `text-fox-info` (`#166FB2`), bukan biru primer pada latar biru muda.
- Semua gambar dekoratif memakai `alt` yang sesuai; kontrol interaktif memiliki accessible name.
- Fokus keyboard terlihat; dialog mobile bisa dibuka dan ditutup dengan Escape.
- Tidak ada overflow horizontal pada empat viewport yang diuji.

## Quality gate evidence

Semua perintah dijalankan di workspace `D:\PROJECTS\FoxBitz` pada 17 November 2026.

| Gate | Perintah | Hasil |
| --- | --- | --- |
| Build penuh | `npm run build` | PASS. Web mengompilasi 13 route; API `tsc -p tsconfig.build.json` selesai. |
| Lint | `npm run lint` | PASS. 0 error, 0 warning (`--max-warnings=0`). |
| Typecheck | `npm run typecheck` | PASS untuk web dan API. |
| Unit test | `npm test` | PASS 2/2 (password hashing, validasi startup). |
| Integration test | `npm run test:integration` | PASS 7/7 (sesi, tenant, origin, DTO, expiry, logout, health DB). |
| Prisma Client | `npm run prisma:generate` | PASS. Prisma Client 6.19.3. API harus dihentikan sementara karena engine DLL terkunci proses berjalan. |
| Database status | `npm run db:status` | PASS. 1 migration, “Database schema is up to date!”. |
| Dependency audit | `npm audit --omit=dev` | PASS. 0 vulnerability. |
| UI smoke test | `npm run smoke:ui` | PASS 4/4 viewport. |
| DOCX validation | Pemeriksaan `python-docx` + ZIP | PASS. 164 paragraf, 16 tabel, 6 gambar, TOC ada, ZIP valid. |

### Hasil UI smoke per viewport

| Viewport | Status | Overflow | KPI | Foxi | Console/request | Dialog mobile |
| --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | 200 | Tidak | 4 | Termuat | Bersih | n/a |
| 1024×768 | 200 | Tidak | 4 | Termuat | Bersih | n/a |
| 390×844 | 200 | Tidak | 4 | Termuat | Bersih | Buka/tutup Escape |
| 360×800 | 200 | Tidak | 4 | Termuat | Bersih | Buka/tutup Escape |

Smoke test juga memeriksa label `Data demo`, pemilihan periode grafik, accessible name, `alt` gambar, dan keberadaan entry point POS.

## Bukti visual

Screenshot aktual tersimpan di `docs/screenshots/`:

- `dashboard-desktop-1440.png`, `dashboard-desktop-1440-viewport.png`
- `dashboard-tablet-1024.png`, `dashboard-tablet-1024-viewport.png`
- `dashboard-mobile-390.png`, `dashboard-mobile-390-viewport.png`
- `dashboard-mobile-360.png`, `dashboard-mobile-360-viewport.png`
- `menu-mobile-390.png`, `menu-mobile-360.png`
- `pos-desktop-1440.png`, `pos-tablet-1024.png`, `pos-mobile-390.png`, `pos-mobile-360.png`

Screenshot dibuat dengan Playwright Chromium 1255, bukan pengujian perangkat fisik.

## Batasan dan hal yang belum diverifikasi

- Rendering visual DOCX di Microsoft Word/LibreOffice belum diperiksa. Validasi yang dilakukan bersifat struktural (python-docx dan ZIP); belum ada jaminan tata letak halaman identik di setiap versi Word.
- Tidak ada sumber Figma/vektor resmi. Maskot Foxi dan logo mark diambil dari crop mockup yang diberikan; tidak ada klaim pixel-perfect atau aset brand final.
- Dashboard memakai data demo. Belum ada API dashboard, transaksi, atau data bisnis nyata.
- Belum ada seed user demo dan belum ada halaman login UI. Alur auth diverifikasi lewat integration test HTTP.
- RBAC penuh, audit trail domain, dan permission UI belum diimplementasikan.
- Rate limit login masih in-memory, belum cocok untuk multi-instance produksi.
- Rotasi dan cleanup sesi terjadwal, serta strategi session produksi, masih terbuka.
- UI smoke hanya memakai Chromium headless pada empat ukuran viewport, bukan Safari/Firefox atau perangkat nyata.
- Workspace belum merupakan Git repository; seluruh perubahan masih berupa file lokal yang belum di-commit.
- `.env` bersifat lokal dan tidak boleh dibagikan; password database tidak dicantumkan di laporan ini.

## Keputusan yang masih terbuka

- Pajak/service charge dan aturan pembulatan.
- Shift kasir dan rekonsiliasi kas.
- Detail refund/void dan otorisasi.
- Varian produk, transfer antar-outlet, dan kebijakan negative stock.
- Format struk dan printer yang didukung.
- Approval workflow purchasing/finance.
- Format export laporan.
- Retensi audit log.
- Hosting, deployment, dan strategi observability produksi.

## Langkah berikutnya

1. Seed tenant/user development dan bangun halaman login UI di atas endpoint auth yang sudah ada.
2. Finalisasi matriks RBAC dan audit trail sebelum modul domain.
3. Jalankan Sprint 1 sesuai backlog: Identity & RBAC, Organization, Catalog, Inventory foundation, dan POS discovery. Checkout end-to-end berada di Sprint 2. Implementasi lanjutan dicatat di `SPRINT_1_STATUS.md`.
4. Tetapkan keputusan pajak, pembulatan, shift, refund/void, dan struk sebelum implementasi transaksi.
5. Siapkan environment staging dan pipeline deployment.
