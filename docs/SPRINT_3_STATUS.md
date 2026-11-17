# Sprint 3 — Inventory documents and stock control

Tanggal: 17 November 2026. Acuan: PRD, Technical Architecture & ERD, Design System dan Sprint Plan di `docs/`. Backend tetap NestJS/Node.js. Status: cakupan Sprint 3 selesai dan quality gates lokal lulus dengan batas operasional di bawah; belum merupakan persetujuan UAT atau deployment produksi.

## Implementasi

- Dokumen stok terpusat pada `stock_documents` dan `stock_document_items` dengan `kind` `adjustment|receiving|transfer` dan status `posted|sent|received`. Item menyimpan snapshot nama/SKU/satuan dan kuantitas Decimal.
- Penyesuaian stok memakai kuantitas bertanda (positif menambah, negatif mengurangi), alasan wajib 3–200 karakter, referensi eksternal opsional maksimal 100 karakter, maksimal tiga desimal, dan tidak boleh membuat saldo negatif. Penyesuaian pada produk yang belum memiliki saldo dapat mencatat saldo awal dan mengisi `openedAt`.
- Penerimaan sederhana hanya menerima kuantitas positif. Alur ini independen dari supplier, purchase order, harga beli dan dokumen pembelian; integrasi pembelian mengikuti Sprint 4.
- Transfer memerlukan outlet tujuan aktif yang berbeda. Stok sumber langsung dikurangi saat transfer dikirim (`transfer_out`); stok tujuan baru ditambah setelah pengguna berizin di outlet tujuan mengonfirmasi penerimaan (`transfer_in`), dengan `receivedBy`/`receivedAt` dan audit. Konfirmasi ulang mengembalikan dokumen yang sama tanpa menambah stok lagi. Transfer tanpa konfirmasi tetap berstatus `sent`.
- Setiap dokumen diproses dalam satu transaksi database: validasi produk/outlet, penguncian saldo terurut, perubahan saldo, ledger `stock_movements`, audit, dan dokumen. Kegagalan pada langkah mana pun membatalkan seluruhnya. Ledger mencatat kuantitas bertanda, `note`, `beforeQuantity`, `afterQuantity` dan referensi dokumen. Saldo tidak pernah negatif; dua transfer bersamaan yang memperebutkan stok terakhir menghasilkan satu sukses dan satu `409`.
- Idempotency key UUID unik per tenant dengan `requestHash`. Advisory lock per tenant + key mencegah pemrosesan ganda. Key, payload dan pembuat yang sama mengembalikan dokumen lama; payload atau pembuat berbeda ditolak `409`. Recovery `by-key` hanya untuk pembuat dan cakupan outlet yang sama.
- Permission server/UI: `inventory.adjust`, `inventory.receive`, `inventory.transfer.send`, `inventory.transfer.receive`. Migration meng-upgrade owner serta role manager/inventory default yang belum dikustomisasi; role khusus dan cashier dipertahankan.
- UI inventori mencakup saldo per outlet, form penyesuaian/penerimaan/transfer multi-baris dengan pencarian produk, pemilihan outlet tujuan, riwayat dokumen dan rincian, modal konfirmasi terima, riwayat mutasi dengan snapshot saldo, serta panel pemulihan respons tidak pasti. Proxy same-origin mengizinkan endpoint dokumen yang diperlukan.
- Respons tidak pasti: payload/key disimpan di `sessionStorage` sebelum request. Pengguna dapat memeriksa status atau mengirim ulang dengan key sama; menutup panel tidak membatalkan dokumen yang sudah tersimpan di server.

## Baseline bisnis dan batas operasional

| Area | Baseline Sprint 3 |
| --- | --- |
| Penyesuaian | Kuantitas bertanda, alasan wajib, referensi opsional, maksimal tiga desimal; saldo akhir minimal nol; saldo awal produk/outlet yang belum dibuka dapat dibuat melalui penyesuaian |
| Penerimaan | Hanya kuantitas positif; tanpa supplier/PO/harga beli; tidak ada penerimaan parsial, selisih, atau dokumen pembelian |
| Transfer | Sumber berkurang saat kirim, tujuan bertambah saat diterima; tujuan harus aktif dan berbeda; belum ada batal/tolak/expiry atau pengembalian otomatis |
| Idempotency | Key UUID unik per tenant; key+payload+pembuat sama mengembalikan dokumen; kombinasi berbeda `409`; recovery dibatasi pembuat/outlet |
| Konkurensi | Advisory lock per tenant/key dan row lock saldo; stok tidak negatif; transaksi gagal penuh atau sukses penuh |
| Permission | Empat izin baru; owner selalu mendapatkannya; role manager/inventory default di-upgrade, role khusus/cashier tidak diubah paksa |
| Audit/ledger | Setiap dokumen menghasilkan audit; setiap item menghasilkan mutasi dengan kuantitas, catatan dan snapshot saldo bila tersedia |
| Outlet/tenant | Outlet nonaktif `403` untuk pengguna ter-scope dan `404` untuk pengguna semua outlet; data tenant lain `404` |
| Batasan UI | Meja lebar memakai scroll horizontal di dalam kartu pada layar kecil; pemilihan outlet melalui header (desktop) atau profil (mobile) |

Belum termasuk Sprint 3: supplier/purchase order, harga beli dan valuasi persediaan, stock opname session, batch/serial/expiry, approval berjenjang, pembatalan transfer, cetak surat jalan, dan pemindaian barcode khusus dokumen stok. Shift, refund/void, offline checkout, varian, dashboard aktual dan modul roadmap lain tetap di luar cakupan. UI mempertahankan tokens Blue/White/teal, Inter dan Foxi sumber; tidak diklaim pixel-perfect.

## Verifikasi

- Production build Next.js (14 route termasuk proxy dinamis) dan NestJS: PASS.
- Lint tanpa warning, unit test 2/2 dan typecheck web/API: PASS. Audit dependency runtime (`npm audit --omit=dev`): 0 vulnerabilities.
- Integration final: 32/32 PASS, termasuk suite Sprint 1, Sprint 2 dan Sprint 3. Suite stok Sprint 3 lulus 8/8 (7 subtest + parent): permission dan outlet tujuan, validasi/forgery tenant, penyesuaian bertanda + replay + saldo negatif, penerimaan tanpa supplier, transfer kirim/terima sekali, dua transfer bersamaan, rollback paksa pada mutasi kedua, serta isolasi dokumen/recovery/outlet nonaktif.
- Migration `20261117030000_sprint3_inventory` sudah diterapkan. `npm run db:status`: empat migration current, schema database up to date. SQL upgrade role diuji dengan tabel sementara dalam transaksi; hasil owner/default manager/default inventory upgrade, role Sprint 1/2 manager, role khusus dan cashier: PASS. Bukti: `SPRINT_3_MIGRATION_RESULTS.json`; jalankan ulang dengan `node scripts/verify-sprint3-migration.mjs`.
- Browser smoke inventori (`npm run smoke:inventory`): PASS pada 1440×900, 1024×768, 390×844 dan 360×800. Penyesuaian, penerimaan, transfer, penerimaan di outlet tujuan, riwayat mutasi, respons hilang lalu pemeriksaan status, permission UI read-only, akses ditolak, dan pemilihan outlet mobile lulus. Tidak ada page overflow atau console error pada alur yang diuji. Bukti: `SPRINT_3_UI_RESULTS.json` (17 November 2026 06:43:44 UTC) dan `screenshots/inventory-{transfer,received,pending}-*.png`. Fixture tenant dibersihkan setelah tes.
- Tinjauan visual sampel: transfer desktop dan penerimaan mobile360 terbaca; tabel lebar memakai scroll horizontal di dalam kartu, modal memakai scroll internal pada layar kecil. Ini pemeriksaan sampel, bukan verifikasi pixel-perfect seluruh mockup.
- Regression Sprint 1/2 dipertahankan: migration lama tetap current, seluruh integration test lama lulus, dan alur POS tidak diubah selain penambahan snapshot mutasi stok.

Deployment/TLS, distributed rate limiting, rotasi/cleanup sesi, retensi audit, bootstrap tenant, backup/restore dan UAT operasional tetap memerlukan hardening produksi. Workspace belum memiliki repository Git.
