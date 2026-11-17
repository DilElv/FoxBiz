# Sprint 2 — POS checkout end-to-end

Tanggal: 17 November 2026. Acuan: PRD, Technical Architecture & ERD, Design System dan Sprint Plan di `docs/`. Backend tetap NestJS/Node.js. Status: cakupan Sprint 2 selesai dan quality gates lokal lulus dengan batas operasional di bawah; belum merupakan persetujuan UAT atau deployment produksi.

## Implementasi

- POS terautentikasi per outlet: pencarian nama/SKU/barcode, filter kategori aktif, pagination produk, keranjang dan kuantitas pecahan, quote server serta tinjauan pembayaran.
- Tunai: validasi nominal diterima dan kembalian. EDC eksternal: pilihan hanya bagi kasir berizin, checkbox konfirmasi manual wajib, actor/waktu/audit tersimpan. Sistem tidak memverifikasi terminal/bank otomatis dan tidak membuat penjualan EDC belum lunas.
- `sales`, `sale_items`, `payments`, `held_carts` memakai relasi tenant komposit, unique idempotency/payment dan constraint nilai/status. Satu transaksi database mencatat sale, snapshot item/pembayaran, pengurangan saldo, ledger stok dan audit. Kegagalan membatalkan seluruhnya.
- Advisory lock per tenant/key mencegah checkout ganda. Payload Decimal dinormalisasi; key sama/payload sama mengembalikan sale lama, key berbeda isi/kasir ditolak. Product/outlet locks dan ordered stock locks memvalidasi ulang status, harga serta stok saat commit.
- Recovery menyimpan payload/key tetap dalam sessionStorage sebelum request. Setelah respons tidak pasti atau reload, kasir dapat memeriksa status dan mengirim ulang dengan key sama. UI mengingatkan agar pembayaran di terminal tidak diulang. Recovery dibatasi kasir/outlet/tenant yang sama.
- Hold menyimpan item, label, kasir/outlet dan versi. Resume memeriksa harga/status ulang, checkout menyelesaikan hold satu kali. Hold tidak memesan stok.
- Struk berisi snapshot identitas bisnis/outlet/alamat/zona waktu/kasir, item/harga/kuantitas, subtotal/pajak/diskon/total dan metode/nominal/kembalian. Riwayat per outlet, baca struk diaudit, cetak ulang berlabel salinan. Browser print memakai area isi 72 mm sebagai baseline; belum tersambung printer fisik.
- Permission server/UI: `pos.read`, `pos.checkout`, `pos.edc.confirm`, `pos.hold`. Migration menambah tiga izin baru ke owner dan manager/cashier default yang belum dikustomisasi; role khusus dipertahankan.

## Baseline bisnis dan batas operasional

| Area | Baseline Sprint 2 |
| --- | --- |
| Pajak/diskon | Rp0; konfigurasi, tarif, otorisasi dan urutan belum disepakati |
| Kuantitas/pembulatan | Maksimum tiga desimal; total per baris HALF_UP dua desimal, dijumlah server dengan Decimal |
| Hold | Kasir/outlet yang sama, tanpa reservasi stok atau expiry; belum ada hapus/batal/sharing |
| Pembayaran | Satu pembayaran penuh tunai atau EDC manual; tanpa split/pending/otomatis |
| Gangguan jaringan | Periksa status/retry key sama; sessionStorage hanya bertahan pada sesi tab browser, bukan penyimpanan lintas perangkat |
| Printer | Browser print/PDF; ukuran printer, driver, kegagalan perangkat dan printer 58/80 mm belum divalidasi |
| Histori | Snapshot tetap; outlet nonaktif/akses dicabut menolak operasi, perlu pemulihan akses untuk pemeriksaan status |

Shift, refund/void setelah lunas, offline checkout, varian, inventory adjustment/receiving/transfer dan dashboard aktual mengikuti roadmap berikutnya. Katalog mengizinkan harga pecahan Rupiah sesuai baseline sebelumnya; kebijakan pembulatan tunai operasional belum ditentukan. UI mempertahankan tokens Blue/White/teal, Inter dan Foxi sumber; tidak diklaim pixel-perfect. Dashboard masih menampilkan data demo.

## Verifikasi

- Production build Next.js (14 halaman/proxy) dan NestJS: PASS setelah penambahan kategori POS. Build web diulang setelah perbaikan CSS print: PASS.
- Lint tanpa warning, unit test 2/2 dan typecheck web/API: PASS. Audit dependency runtime (`npm audit --omit=dev`): 0 vulnerabilities.
- Integration setelah filter kategori: 24/24 PASS. Mencakup permission, tenant/outlet forgery, isolasi/filter kategori, malformed/duplicate lines, Decimal/change, retry bersamaan, payload mismatch, recovery, snapshot, EDC manual, stok terakhir, forced rollback pada mutasi kedua, hold/reprice/version dan outlet nonaktif.
- Migration `20261117020000_sprint2_pos` sudah diterapkan. SQL upgrade role diuji terhadap tabel sementara dalam transaksi: owner/default cashier/default manager ter-upgrade, customized cashier/manager dipertahankan. Bukti: `SPRINT_2_MIGRATION_RESULTS.json`; jalankan ulang dengan `node scripts/verify-pos-migration.mjs`.
- `npm run db:status`: tiga migration current, schema database up to date.
- PDF struk setelah perbaikan CSS print: PASS, satu halaman dengan isi lengkap dan nol halaman kosong; background aplikasi tidak ikut tercetak. Bukti: `SPRINT_2_PRINT_RESULTS.json`, `screenshots/pos-receipt.pdf` dan `screenshots/pos-pdf-preview.png`. Kertas PDF mengikuti default browser; printer thermal belum diuji.
- Browser smoke POS final (`npm run smoke:pos`): PASS pada 1440×900, 1024×768, 390×844 dan 360×800. Kategori/barcode, hold/resume, tunai/EDC manual, histori/cetak ulang, respons hilang setelah commit lalu reload/recovery, permission UI, akses tombol cetak lewat scroll dan isolasi layout print lulus. Tidak ada page overflow atau console error di alur yang diuji. Bukti: `SPRINT_2_UI_RESULTS.json` (17 November 2026 04:28:52 UTC) dan `screenshots/pos-{cart,cash,edc,receipt}-*.png`. Fixture tenant dibersihkan setelah tes.
- Tinjauan visual sampel: keranjang desktop/mobile360, pembayaran tablet, EDC mobile360, struk mobile360 dan render PDF terbaca. Modal struk mobile memakai scroll internal; akses tombol cetak juga diperiksa skrip.

Deployment/TLS, distributed rate limiting, rotasi/cleanup sesi, retensi audit, bootstrap tenant dan backup/restore tetap memerlukan hardening produksi. Workspace belum memiliki repository Git.
