# Sprint 5 — Finance

Tanggal: 17 November 2026. Acuan: PRD, Technical Architecture & ERD, Design System dan Sprint Plan di `docs/`. Backend tetap NestJS/Node.js. Status: implementasi selesai dan seluruh quality gate lokal yang tercantum lulus; UAT dan deployment produksi terpisah.

## Implementasi dan aturan bisnis

- Halaman `/finance` menyediakan entri pemasukan/pengeluaran tunai manual, filter tanggal/jenis/status, pagination 25 data, ringkasan kas, laporan harian dan laporan kategori per outlet. Identitas Blue/White dengan aksen teal dan shell Foxi dipertahankan.
- Nominal positif Decimal(14,2), maksimal dua desimal; tanggal bisnis valid tahun 2000–2100; catatan wajib 3–200 karakter. Kategori pemasukan: setoran pemilik dan pemasukan lainnya. Kategori pengeluaran: operasional, utilitas, perlengkapan, transportasi dan pengeluaran lainnya. Kategori harus sesuai jenis entri.
- Entri tersimpan tidak memiliki operasi edit/delete. Koreksi melalui void beralasan dan audit. Void mengecualikan nominal dari laporan periode asal; riwayat, pencatat, pemberi void dan alasan tetap tersedia.
- Penjualan POS dihitung otomatis dari pembayaran yang sudah diterima/dikonfirmasi manual. Tunai menggunakan `payments.amount`, bukan uang diserahkan sebelum kembalian. Arus kas bersih = penjualan tunai + pemasukan manual − pengeluaran manual. EDC adalah informasi non-tunai, tidak menambah kas bersih.
- Laporan memakai tanggal bisnis dan zona waktu tenant, rentang maksimal 366 hari inklusif, dengan batas POS midnight lokal inklusif–eksklusif. Pembacaan agregat memakai transaksi Repeatable Read; hari tanpa transaksi tetap tampil dengan nol.
- Create memakai UUID idempotency key, hash payload ternormalisasi, pembuat dan advisory transaction lock. Entri dan audit disimpan atomik. Recovery hanya untuk pembuat/outlet yang sama. UI menyimpan payload/key di sessionStorage sebelum request dan mempertahankannya setelah reload untuk pemeriksaan status atau retry identik.
- Void memakai row lock; retry dari pengguna dengan alasan sama mengembalikan hasil yang sama tanpa audit duplikat. Permintaan berbeda terhadap entri yang sudah void menghasilkan konflik. Gagal menulis audit membatalkan create/void.
- Permission server: `finance.read`, `finance.entries.write`, `finance.void`. Scope tenant/outlet berasal dari sesi; outlet nonaktif ditolak. Navigasi dan tindakan UI mengikuti izin. Proxy Next.js mengizinkan endpoint Finance secara terbatas serta mempertahankan origin, JSON dan cookie sesi HttpOnly.
- Migration additive `20261117050000_sprint5_finance` menambah tabel, constraint nominal/kategori/status/catatan dan foreign key tenant. Owner dan manager bawaan mendapat izin Finance; manager khusus, inventory, cashier dan role lain dipertahankan.

## Verifikasi

- Build production web dan API PASS (`.local/sprint5-build-final.log`); server hasil build dipakai untuk smoke, bukan dev server. Lint `eslint apps packages --max-warnings=0` PASS; typecheck web/API PASS; unit 2/2 PASS (`.local/sprint5-unit-final.log`).
- Seluruh integration suite 48/48 PASS, 0 gagal/dilewati/dibatalkan, termasuk suite Finance 7/7 PASS (`.local/sprint5-integration-final.log`, `.local/sprint5-finance-integration-final.log`). Cakupan Finance mencakup validasi, permission terpisah, concurrent create/void, recovery, perubahan zona waktu, batas hari POS nyata, kembalian, EDC, filter/pagination, isolasi tenant/outlet dan rollback audit.
- Smoke UI Finance PASS pada desktop, tablet, mobile390 dan mobile360, serta role viewer/writer/voider/none: pemasukan/pengeluaran, ringkasan Decimal, recovery setelah respons hilang dengan key yang sama, satu entri/audit, void, filter, validasi periode, periode kosong dan pindah outlet. Tidak ada overflow atau error console; pesan pemulihan offline tampil. Hasil aktual di `SPRINT_5_UI_RESULTS.json`, screenshot di `docs/screenshots/finance-*.png`, log di `.local/sprint5-smoke-final.log`.
- Verifikasi migration PASS; hasil di `SPRINT_5_MIGRATION_RESULTS.json`. SQL upgrade role diuji pada tabel sementara dalam transaksi dan constraint database diperiksa. `db:status` menunjukkan 6 migration dan schema up to date.
- Cleanup PASS: tidak ada fixture tenant Finance, trigger atau function pengujian tersisa; hasil di `SPRINT_5_CLEANUP_RESULTS.json`. `npm audit --audit-level=high` menemukan 0 vulnerability dan Prisma Client 6.19.3 berhasil digenerate ulang. Ringkasan seluruh gate ada di `SPRINT_5_VERIFICATION_RESULTS.json`.
- Gate lokal ini tidak mencakup UAT operasional, pengujian perangkat fisik atau deployment produksi.

## Batas cakupan

Kas bersih merupakan perubahan kas periode, belum merupakan saldo awal, saldo kas fisik atau tutup shift. Tidak ada CRUD kategori, posting otomatis PO/receipt sebagai expense, akuntansi formal, pajak, COGS, utang/piutang, settlement EDC, rekonsiliasi bank, ekspor atau dashboard transaksi aktual. Semua penjualan tetap dicatat melalui POS; terminal EDC/QR eksternal dikonfirmasi kasir secara manual tanpa API pembayaran.

UAT operasional, perangkat EDC/printer fisik, hardening dan deployment produksi belum dilakukan. Dashboard masih demo; CRM, HRIS dan dashboard aktual mengikuti sprint berikutnya. Workspace lokal belum memiliki Git repository; perubahan belum dikomit/push.
