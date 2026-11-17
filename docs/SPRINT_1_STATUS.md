# Sprint 1 — Identity, Organization, Catalog, Inventory foundation

Tanggal: 17 November 2026. Acuan: empat dokumen resmi dalam `docs/`. Backend tetap NestJS/Node.js. Checkout end-to-end berada di Sprint 2.

## Implementasi

- Login/logout UI dan sesi HttpOnly melalui proxy same-origin; halaman operasional menunggu validasi sesi. Akun development memakai password acak di `.local/development-login.json`.
- Role/permission berbasis tenant, pengguna aktif/nonaktif, perubahan password, cakupan seluruh outlet atau daftar outlet. Role owner dilindungi dan owner aktif terakhir tidak dapat diturunkan/dinonaktifkan. Perubahan user mencabut sesi user; perubahan permission dibaca ulang pada request berikutnya.
- Profil bisnis (nama/alamat/zona waktu/IDR), outlet aktif/nonaktif, kategori, produk aktif/nonaktif, SKU/barcode unik per tenant, satuan dan harga Decimal. Harga katalog menampilkan hingga dua angka desimal tanpa membulatkan nilai pecahan ke Rupiah penuh. Tidak ada hard-delete dari UI.
- Saldo per outlet, saldo awal sekali per produk/outlet, mutasi opening, batas stok minimum, indikator stok rendah. Row lock, transaksi dan unique reference mencegah saldo awal ganda. Saldo/threshold nonnegatif juga dibatasi SQL.
- Audit login dan perubahan organisasi/outlet/user/role/katalog/stok. Password/token tidak dimasukkan ke audit/response user. Daftar yang berpotensi besar memakai pagination.
- State loading, kosong, error/retry, sukses, dan akses dibatasi. UI mempertahankan tokens Blue/White, Foxi dari crop sumber, komponen shared, serta navigasi desktop/tablet/mobile.
- Rancangan alur checkout, hold/resume, pembayaran tunai/EDC manual, pajak/diskon, struk, idempotency dan stock concurrency di `POS_DISCOVERY_SPRINT_1.md`.

## Baseline bisnis yang masih berupa asumsi

| Area | Implementasi baseline |
| --- | --- |
| Owner | Semua 13 permission Sprint 1 dan seluruh outlet; role dilindungi |
| Admin / Manager | Baca organisasi, baca/tulis katalog, baca/opening/threshold stok, entry POS |
| Cashier | Baca katalog/stok dan entry POS |
| Inventory Staff | Baca/tulis katalog, baca/opening/threshold stok |
| HR Staff / Employee | Belum diberi permission domain Sprint 1 |
| Outlet | Assignment eksplisit; shared catalog berlaku untuk seluruh bisnis; user/role/organisasi write membutuhkan seluruh outlet |
| Produk | SKU huruf kapital dan barcode unik per bisnis; satuan teks; varian belum diterapkan |
| Inventori | Saldo awal nonnegatif sekali; threshold per produk/outlet; transfer/adjustment mengikuti Sprint 3 |

Matriks tersebut adalah rekomendasi development yang dapat dikonfigurasi. Belum ada validasi aturan bisnis final atau aset vector/Figma resmi. UI tidak diklaim pixel-perfect.

## Verifikasi

- Prisma schema valid; migration additive Sprint 1 sudah diterapkan pada PostgreSQL lokal; Prisma Client 6.19.3 berhasil digenerate.
- Build produksi Next.js (14 halaman dan proxy dinamis) + NestJS: PASS.
- Lint: PASS, tanpa warning. Unit test: 2/2 PASS.
- HTTP integration: 15/15 PASS, termasuk auth/expiry/logout, forged tenant, permission langsung, outlet scope, referensi lintas tenant, Decimal/unique SKU/barcode, owner terakhir, revoke sesi, perubahan permission, audit, dan dua request saldo awal bersamaan.
- Typecheck web/API: PASS. `npm audit`: 0 vulnerability.
- Proxy browser: PASS untuk penolakan origin kosong/asing (`403`), write non-JSON (`415`), dan endpoint di luar allowlist (`404`).
- Dashboard/navigation regression (`npm run smoke:ui`): PASS pada 1440×900, 1024×768, 390×844, dan 360×800; tidak ada page overflow, console error, request gagal, gambar tanpa alt, atau kontrol tanpa nama. Hasil tersedia di `UI_SMOKE_RESULTS.json`.
- Verifikasi form Sprint 1 (`npm run smoke:sprint1`): PASS pada 1440×900, 1024×768, 390×844, dan 360×800 setelah perbaikan pola validasi HTML Unicode `v` dan harga pecahan. Login/logout, buat produk, opening/threshold, pindah outlet, pengaturan, permission UI dan redirect terproteksi lulus; pembuatan user diuji di desktop. Tidak ada page overflow atau console error. Bukti di `SPRINT_1_UI_RESULTS.json` dan `screenshots/sprint1-*.png`.
- Tinjauan visual: produk desktop, inventori tablet, login mobile390, produk/pengaturan mobile360 terbaca; tabel audit mobile memakai scroll horizontal dalam kartu. Ini pemeriksaan visual sampel, bukan verifikasi pixel-perfect seluruh mockup.
- Setup PostgreSQL lokal: PASS pada `127.0.0.1:55432`. Alamat IPv4 eksplisit menghindari perbedaan resolusi `localhost` ke `::1`. Migration POS berikutnya dicatat di status Sprint 2.

## Batas operasional

Dashboard masih data demo. POS diteruskan dalam `SPRINT_2_STATUS.md`; modul roadmap lainnya merupakan placeholder. Setelah perubahan daftar outlet/profil/izin, muat ulang halaman agar tampilan sesi/pilihan outlet terbarui; backend memakai izin terkini pada setiap request. Migration Sprint 1 tidak mengangkat izin pengguna lama secara otomatis; migration Sprint 2 menambah izin POS ke owner dan role manager/cashier default yang belum dikustomisasi. Produksi memerlukan keputusan hosting/TLS, rate limiter terdistribusi, rotasi/cleanup sesi, retensi audit dan pengelolaan bootstrap tenant. Tidak ada repository Git di workspace ini.
