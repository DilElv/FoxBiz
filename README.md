# FoxBiz

Panduan rilis production: [deployment foxbiz.bikinsaas.com](docs/PRODUCTION_DEPLOYMENT.md).

FoxBiz adalah Full POS & Business Management System dengan arah visual Blue & White dan maskot Foxi. Workspace ini berisi fondasi Sprint 0, Sprint 1 (login/RBAC, organisasi/outlet, katalog dan inventori dasar), **Sprint 2 POS** dengan checkout tunai/EDC manual, stok atomik, recovery pembayaran, hold/resume dan struk, **Sprint 3 Inventori** dengan penyesuaian stok, penerimaan sederhana dan transfer antar-outlet, **Sprint 4 Purchasing** dengan supplier, PO dan penerimaan parsial, **Sprint 5 Finance** dengan pemasukan/pengeluaran tunai manual, void beralasan dan laporan kas per outlet/periode, serta **Sprint 6 CRM** dengan data/profil pelanggan, riwayat transaksi, segmentasi dasar dan pelanggan opsional pada POS.

## Stack

- **Web**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, pola komponen shadcn/ui.
- **API**: NestJS 11 di Node.js 20, REST `api/v1`, class-validator.
- **Database**: PostgreSQL 17 + Prisma 6.
- **UI bersama**: `packages/ui` (design tokens dan primitive Button, Input, Card, Badge, StatCard, SidebarItem, TableShell, Modal).
- **Monorepo**: npm workspaces.

## Struktur

```text
apps/web                 Next.js app shell, dashboard, entry point modul
apps/api                 NestJS API, auth/session, tenant scope, health
apps/api/prisma          Schema, migration, dan konfigurasi Prisma
packages/ui              Design tokens dan komponen reusable
infra/docker             PostgreSQL development via Docker
scripts                  Setup env, PostgreSQL lokal, smoke test UI
docs                     Dokumen resmi, referensi visual, status dan bukti verifikasi tiap sprint
design-reference         Crop referensi visual sumber
```

## Prasyarat

- Node.js 20+
- npm 10+
- PostgreSQL 17 **atau** Docker

## Setup

```bash
npm install
npm run setup:env
```

`setup:env` membuat `.env` lokal dengan password database acak. Jangan commit `.env`.

### Database

Opsi A — PostgreSQL lokal (Windows, PostgreSQL 17 terpasang):

```bash
powershell -ExecutionPolicy Bypass -File scripts/start-postgres.ps1
```

Cluster development terisolasi dibuat di `.local/postgres` pada `127.0.0.1:55432`. Gunakan alamat tersebut pada `DATABASE_URL` agar sesuai dengan listener IPv4 lokal.

Opsi B — Docker:

```bash
docker compose -f infra/docker/compose.yml up -d
```

Sesuaikan `DATABASE_URL` di `.env` dengan kredensial Docker.

Terapkan migration:

```bash
npm run db:migrate
npm run db:status
```

Migration tersedia: `20261117000000_sprint0_foundation`, `20261117010000_sprint1_identity_catalog_inventory`, `20261117020000_sprint2_pos`, `20261117030000_sprint3_inventory`, `20261117040000_sprint4_purchasing`, `20261117050000_sprint5_finance`, dan `20261117060000_sprint6_crm`. Migration Sprint 1 bersifat additive; pengguna lama tetap tanpa izin sampai role dan cakupan outlet ditetapkan secara eksplisit. Sprint 2 menambah tabel/constraint POS dan izin checkout/EDC/hold ke owner serta role manager/cashier default yang belum dikustomisasi; role khusus dipertahankan. Sprint 3 menambah dokumen stok, snapshot mutasi, constraint transisi status, serta izin adjustment/receiving/transfer. Sprint 4 menambah supplier, PO dan goods receipt dengan foreign key tenant serta constraint jumlah/status. Sprint 5 menambah `finance_entries`, constraint nominal/kategori/status, foreign key tenant, serta permission Finance untuk owner dan manager bawaan; manager yang sudah dikustomisasi dan role lain dipertahankan. Sprint 6 menambah pelanggan, relasi pelanggan opsional pada penjualan/hold, dan permission CRM untuk owner serta manager default persis. Backup dan periksa duplikasi barcode sebelum menerapkan pada database selain development.

Siapkan data development:

```bash
npm run prisma:generate
npm run db:seed
```

Seed membuat bisnis `foxbiz-demo`, owner `owner@foxbiz.test`, dua outlet, enam role baseline, dan dua produk. Password acak tersimpan di `.local/development-login.json` (gitignored). Buka file tersebut untuk login di `/login`. Seed ulang mempertahankan password dan perubahan data yang sudah ada; seed ditolak saat `NODE_ENV=production`.

## Menjalankan

Terminal terpisah:

```bash
npm run dev:web
npm run dev:api
```

Atau jalankan hasil build:

```bash
npm run build
npm run start:web
npm run start:api
```

- Web: `http://localhost:3000`
- API health: `GET http://127.0.0.1:4000/api/v1/health`

## Endpoint fondasi

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/api/v1/health` | Status API dan koneksi database |
| POST | `/api/v1/auth/login` | Login; body `{ tenantSlug, email, password }` |
| POST | `/api/v1/auth/logout` | Revoke sesi (butuh sesi aktif) |
| GET | `/api/v1/me` | Profil dan tenant dari sesi (butuh sesi aktif) |
| GET | `/api/v1/foundation/outlets` | Outlet aktif milik tenant sesi |

Login membuat cookie `foxbiz_session` (HttpOnly, SameSite=Lax). Token disimpan sebagai hash SHA-256; password memakai bcrypt. Tenant selalu berasal dari sesi tervalidasi. Header `x-tenant-id` yang tidak cocok dengan sesi ditolak `403`.

Browser memakai proxy same-origin `/api/v1/*` di Next.js sehingga cookie tetap HttpOnly. `API_INTERNAL_URL` opsional (default `http://127.0.0.1:4000`); atur pada proses web bila API berada di host lain. `WEB_ORIGIN` harus sesuai origin publik web di kedua proses. Semua operasi tulis browser memerlukan origin yang cocok dan JSON.

Endpoint Sprint 1: `organization` (GET/PATCH), `outlets`, `users`, `roles`, `categories`, `products` (GET/POST/PATCH `/:id`), `permissions` (GET), `inventory/balances`, `inventory/movements` (GET dengan `outletId`), `inventory/opening` (POST), `inventory/threshold` (PATCH), `audit-logs` (GET). Permission dicek server; izin tenant dan outlet berasal dari sesi. Daftar produk/pengguna/stok/mutasi/audit memakai halaman 25 data.

Endpoint Sprint 2: `pos/categories`, `pos/products` (GET dengan `outletId`; produk mendukung search/category/page), `pos/quote` (POST), `sales` (POST checkout, GET riwayat per outlet), `sales/by-key/:key` (GET recovery kasir/outlet yang sama), `sales/:id` (GET struk), `pos/holds` (GET/POST), `pos/holds/:id` (GET resume). Izin: `pos.read`, `pos.checkout`, `pos.edc.confirm`, `pos.hold`.

Endpoint Sprint 3: `inventory/destinations` (GET), `inventory/documents` (POST, GET per outlet dengan filter `kind`/`status`), `inventory/documents/by-key/:key` (GET recovery), `inventory/documents/:id` (GET), `inventory/documents/:id/receive` (POST konfirmasi transfer masuk). Izin: `inventory.adjust`, `inventory.receive`, `inventory.transfer.send`, `inventory.transfer.receive`.

Endpoint Sprint 4: `suppliers` (GET/POST/PATCH `/:id`), `purchasing/products` (GET pencarian produk aktif), `purchase-orders` (GET per outlet/POST), `purchase-orders/:id` (GET/PATCH draft dengan `version`), `purchase-orders/:id/order` dan `purchase-orders/:id/cancel` (POST dengan `version`, pembatalan memerlukan `reason`), `goods-receipts` (GET per outlet/POST penerimaan aktual). PO dan goods receipt menyediakan `by-key/:key` untuk recovery pembuat/outlet yang sama. Izin: `purchasing.read`, `purchasing.suppliers.write`, `purchasing.orders.write`, `purchasing.orders.order`, `purchasing.orders.cancel`, `purchasing.receive`.

Endpoint Sprint 5: `finance/metadata` (GET kategori, zona waktu dan tanggal bisnis), `finance/entries` (GET per outlet/periode dengan pagination dan filter jenis/status; POST entri manual), `finance/entries/by-key/:key` (GET recovery pembuat/outlet yang sama), `finance/entries/:id/void` (POST dengan `outletId` dan `reason`), serta `finance/report` (GET ringkasan, laporan harian dan kategori). Query laporan memakai `outletId`, `from`, `to` (YYYY-MM-DD, maksimal 366 hari inklusif). Izin: `finance.read`, `finance.entries.write`, `finance.void`.

Entri kas memakai nominal positif hingga dua desimal, tanggal bisnis, kategori terkontrol dan catatan wajib. Entri tersimpan tidak dapat diedit; koreksi memakai void beralasan yang mengeluarkan nilainya dari periode asal. Create/void dan audit atomik, dengan recovery key yang sama setelah respons hilang. Arus kas bersih = penjualan tunai POS (nilai pembayaran setelah kembalian) + pemasukan manual − pengeluaran manual. Penjualan POS dihitung otomatis; jangan dicatat ulang. EDC ditampilkan terpisah sebagai non-tunai. Laporan mengikuti zona waktu bisnis dan belum mencakup saldo awal/laci, settlement EDC, COGS, utang/piutang atau akuntansi formal. PO/receipt tidak otomatis menjadi pengeluaran kas.

PO mengikuti `draft → ordered → partially_received → received`; pembatalan sebelum penerimaan. Partial receipt didukung dan over-receipt ditolak. Biaya per item dan total dihitung Decimal HALF_UP per baris, tanpa perubahan harga jual/cost master, valuasi atau posting Finance. Setiap penerimaan PO terhubung satu-ke-satu dengan dokumen stok Sprint 3 dan memakai ledger yang sama; receipt, saldo, ledger, audit dan status PO tersimpan atomik. Payload/key disimpan sebelum request; pemulihan memakai pemeriksaan status atau retry key yang sama.

Penyesuaian stok memakai kuantitas bertanda dan alasan wajib; saldo tidak boleh negatif. Penerimaan sederhana menambah stok tanpa supplier/PO. Transfer mengurangi stok sumber saat dikirim dan baru menambah stok tujuan setelah staf berizin di outlet tujuan mengonfirmasi penerimaan; konfirmasi ulang bersifat idempotent. Setiap dokumen, mutasi dan audit dicatat dalam satu transaksi dengan idempotency key tenant. Jika respons hilang, UI menyimpan payload/key di sessionStorage dan menyediakan pemeriksaan status/retry dengan key yang sama.

Checkout menerima idempotency key UUID dan payload tetap; server menghitung total Decimal, memeriksa harga/stok ulang, serta menyimpan penjualan/pembayaran/stok/audit dalam satu transaksi. Tunai mencatat kembalian. EDC eksternal hanya dicatat setelah kasir berizin mengonfirmasi manual; tidak ada verifikasi bank otomatis. Jika respons hilang, halaman menyimpan payload di sessionStorage, menyediakan pemeriksaan status dan retry dengan key yang sama. Jangan menagih ulang di terminal. Pajak/diskon sementara Rp0; hold milik kasir/outlet, tanpa reservasi stok atau expiry. Struk memakai snapshot dan browser print; perangkat printer fisik belum diuji.

Endpoint Sprint 6: `crm/customers` (GET pencarian/segmen/page, POST pelanggan), `crm/customers/:id` (GET/PATCH profil), `crm/customers/:id/sales` (GET riwayat berhalaman), serta `pos/customers` (GET pencarian nama/telepon dengan `outletId`, minimal dua karakter, maksimal 20 hasil). Izin CRM: `crm.read`, `crm.customers.write`; kasir memakai lookup POS tanpa akses modul CRM. Telepon wajib 7–15 digit, boleh diawali +, dinormalisasi dengan menghapus spasi/tanda pemisah, dan unik per tenant. Email opsional; kontak diperlakukan sebagai PII dan audit hanya mencatat nama field yang berubah.

Migration additive `20261117060000_sprint6_crm` menambah `customers`, relasi tenant customer pada `sales`/`held_carts` yang nullable, serta izin CRM untuk owner dan manager bawaan persis; role khusus dipertahankan. Segmen: belum bertransaksi, aktif ≤30 hari, perlu perhatian 31–90 hari, tidak aktif >90 hari. Statistik dan riwayat hanya memakai penjualan lunas pada outlet yang dapat diakses, berdasarkan tanggal lokal tenant. Checkout tanpa pelanggan tetap tersedia dan hash payload lama dipertahankan. Hold mempertahankan pelanggan; pelanggan yang sudah terikat pada hold tidak dapat diganti/dihapus saat dilanjutkan. Struk menyimpan snapshot nama pelanggan saja. Tidak ada loyalty, pricing pelanggan, kredit/piutang, impor/ekspor, portal, AI atau integrasi WhatsApp.

## Quality gates

```bash
npm run build
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run prisma:generate
npm run db:status
npm run smoke:ui
npm run smoke:sprint1
npm run smoke:pos
npm run smoke:inventory
npm run smoke:purchasing
npm run smoke:finance
npm run smoke:crm
node scripts/verify-pos-migration.mjs
node scripts/verify-sprint3-migration.mjs
node scripts/verify-sprint4-migration.mjs
node scripts/verify-sprint5-migration.mjs
node scripts/verify-sprint6-migration.mjs
node scripts/verify-sprint6-cleanup.mjs
node scripts/verify-sprint6-results.mjs
npm audit
```

Hasil dicatat di [`docs/SPRINT_0_STATUS.md`](docs/SPRINT_0_STATUS.md), [`docs/SPRINT_1_STATUS.md`](docs/SPRINT_1_STATUS.md), [`docs/SPRINT_2_STATUS.md`](docs/SPRINT_2_STATUS.md), [`docs/SPRINT_3_STATUS.md`](docs/SPRINT_3_STATUS.md), [`docs/SPRINT_4_STATUS.md`](docs/SPRINT_4_STATUS.md), [`docs/SPRINT_5_STATUS.md`](docs/SPRINT_5_STATUS.md), dan [`docs/SPRINT_6_STATUS.md`](docs/SPRINT_6_STATUS.md). Smoke test memerlukan web/API aktif dan Playwright Chromium (`npx playwright install chromium`). `smoke:ui` memakai akun development; smoke modul membuat fixture tenant terisolasi lalu membersihkannya. Hasil JSON dan screenshot tersedia di `docs/` dan `docs/screenshots/`. Pemeriksaan migration menguji SQL upgrade role dengan tabel sementara dalam transaksi, tanpa mengubah data role operasional.

## Cakupan saat ini

Tersedia: fondasi repo, web shell responsif, dashboard demo, login/logout UI, user management, role/permission, outlet scope, profil bisnis, outlet, kategori/produk/SKU/barcode/harga/satuan, saldo awal dan mutasi stok, batas stok minimum, audit perubahan, POS tunai/EDC manual, hold/resume, recovery idempotent, struk/riwayat/cetak ulang, penyesuaian stok beralasan, penerimaan sederhana, transfer kirim/terima antar-outlet, riwayat mutasi dengan snapshot saldo, supplier, draft/ordered/cancelled PO, biaya pembelian, penerimaan PO parsial/lengkap terintegrasi stok, pemasukan/pengeluaran kas manual, void beralasan, ringkasan tunai/EDC dan laporan kas harian/kategori, CRM pelanggan/profil/riwayat/segmentasi dasar, pelanggan opsional pada POS, serta automated checks.

Belum tersedia: dashboard berbasis transaksi nyata, konfigurasi pajak/diskon, shift/refund, split payment, pembatalan/expiry/sharing hold, varian, approval PO berjenjang, retur pembelian/void receipt, utang/pembayaran supplier, valuasi persediaan/COGS, akuntansi formal dan rekonsiliasi bank/EDC, HRIS, loyalty dan otomasi CRM, modul laporan lintas bisnis, offline checkout, serta deployment produksi. Saldo awal hanya sekali per produk/outlet, bernilai nonnegatif, dan dicatat atomik dengan ledger/audit. Penerimaan sederhana Sprint 3 tetap tersedia secara independen; barang berdasarkan PO diterima melalui modul Pembelian.

## Dokumen

- `docs/01_Master_PRD_Full_POS_Business_Management_v1.0.docx`
- `docs/02_Technical_Architecture_ERD_Full_POS_v1.0.docx`
- `docs/03_UIUX_Design_System_FoxBiz_Blue_White_v2.0_FINAL.docx`
- `docs/04_Development_Backlog_Sprint_Plan_Full_POS_v1.0.docx`

## Keamanan

- Jangan commit `.env` atau secret.
- Origin login diperiksa terhadap `WEB_ORIGIN`.
- Rate limit login in-memory merupakan baseline development, bukan solusi produksi multi-instance.
- Session store berada di PostgreSQL; strategi produksi (rotasi, cleanup terjadwal) masih keputusan terbuka.
- Tenant isolation diterapkan pada query; setiap endpoint domain baru wajib melanjutkan pola ini.
