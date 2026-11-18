# Sprint 7 — HRIS Absensi dan Dashboard Aktual

Tanggal: 18 November 2026. Status: implementasi selesai, seluruh gate lokal lulus, dan rilis production terpasang di `foxbiz.bikinsaas.com`. Backend NestJS/Node.js, frontend Next.js/TypeScript, identitas Blue/White dengan aksen teal dan aset Foxi dipertahankan.

## Implementasi dan aturan bisnis

- Karyawan adalah entitas `Employee` terpisah dari akun login. Satu akun manager/owner dapat dipakai banyak karyawan pada kiosk absensi; kasir POS tetap memakai akun pengguna sendiri. PIN karyawan 6 digit di-hash bcrypt dan tidak pernah dikembalikan API.
- Setiap karyawan memiliki kode unik per tenant, status aktif/nonaktif, dan akses outlet. Karyawan dengan akses seluruh outlet otomatis tersedia di kiosk outlet baru tanpa pengaturan ulang.
- Absensi disimpan satu record per karyawan per hari kerja: jam masuk/pulang, outlet, dua foto, hash foto, GPS/akurasi, sumber kiosk, dan pembuat record. Constraint database mencegah duplikasi dan absen pulang ganda.
- Foto masuk dan pulang wajib, maksimal 5 MB, minimal 320×320 piksel, format JPG/PNG/WEBP. Server menormalkan ukuran, memutar orientasi, dan menambahkan watermark: nama bisnis, outlet, nama/kode karyawan, jenis absen, timestamp server dengan zona waktu tenant, ID absensi, serta koordinat GPS atau "GPS tidak tersedia".
- Foto disimpan di `/var/lib/foxbiz/attendance` dengan nama per tenant/tanggal/ID absensi dan diunduh sebagai JPG melalui endpoint terautentikasi. Retensi file foto 180 hari dijalankan timer harian; metadata absensi tetap tersimpan.
- Rekap harian menampilkan kehadiran dan daftar karyawan yang belum absen; rekap bulanan mengagregasi hari hadir, menit kerja, dan absensi terbuka. Keduanya dapat diekspor PDF. Semua query dibatasi tenant dan outlet yang boleh diakses pengguna.
- Permission baru `hris.read`, `hris.employees.write`, `hris.attendance.kiosk`, dan `hris.attendance.manage`; role bawaan manager/hr mendapat izin sesuai tugas dan owner selalu mendapat seluruh katalog.
- Dashboard memakai data aktual per outlet dan periode `today|week|month`: penjualan, transaksi, item terjual, pelanggan baru, grafik per jam/hari, tren terhadap periode sebelumnya, stok menipis, PO menunggu, dan status absensi hari ini. Metrik difilter berdasarkan izin peran; data dari outlet lain tidak dapat diakses.
- UI baru mencakup tab Kiosk Absensi, Karyawan, serta Rekap & Ekspor di halaman `/hris`. Navigasi sidebar dan Pusat bantuan mengikuti izin pengguna.

## Verifikasi

| Gate | Hasil |
| --- | --- |
| Build web/API | Lulus; Next.js production build dan TypeScript API selesai |
| Lint | Lulus, maksimum 0 warning |
| Typecheck web/API | Lulus |
| Unit | 3/3 lulus |
| Integrasi | 64/64 lulus: tenant 7, Sprint 1 8, POS 9, stok 8, purchasing 9, finance 7, CRM 6, HRIS 6, dashboard 4 |
| Migration | 8 migration sesuai; `20261118103815_sprint7_hris` diterapkan pada `foxbiz_production` |
| Backup pra-migrasi | `/var/backups/foxbiz/foxbiz_production-20261118-192002.dump` (165 KB) dan salinan lokal; dump diverifikasi dengan `pg_restore -l` |
| Smoke production | 15/15 lulus melalui HTTPS: login, sesi, outlet, dashboard, buat karyawan, kiosk, absen masuk berfoto, rekap, unduh JPG, ekspor PDF, absen pulang |
| Watermark production | Foto hasil server diperiksa: area watermark memuat 3.636 piksel terang dan 4.441 warna berbeda, teks watermark benar-benar dirender |
| Retensi production | Unit purge dijalankan manual: `Result=success`, `removedFiles=0`, metadata/foto uji bersih |
| Cleanup | 0 karyawan/absensi/foto fixture tersisa; cache font service dibuat agar log bersih |
| Service | `foxbiz-api` dan `foxbiz-web` aktif; timer purge aktif dan dijadwalkan 02.19 WIB |

Semua file integrasi dijalankan satu per satu karena runner multi-file pada lingkungan ini menggantung setelah beberapa suite. Log tersedia di `.local/sprint7-*.log`, ringkasan smoke di `.local/sprint7-smoke.json`, dan foto watermark uji di `.local/sprint7-watermark.jpg`. Kredensial, backup, dan file uji tidak disimpan di Git.

## Deployment

- Release: `/opt/foxbiz/releases/sprint7-20261118`; symlink `/opt/foxbiz/current` diarahkan ke release ini.
- Paket: `foxbiz-sprint7-20261118.tar.gz`, 278.878 byte, SHA-256 `7c13a7e429c84b33a45f8244d5c577cce22fec1a4f2725f61b973d59c5ab0469`; build web production ID `OK0_YKjUZ_y14JLtDghxq7`.
- Nginx HTTPS mengizinkan unggahan 8 MB. `client_max_body_size 8m` terpasang dan `nginx -t` lulus.
- `ATTENDANCE_DIR=/var/lib/foxbiz/attendance` dan `ATTENDANCE_RETENTION_DAYS=180` ditambahkan ke `/etc/foxbiz/production.env`.
- Service API memakai `StateDirectory=foxbiz/attendance`, `CacheDirectory=foxbiz`, dan `XDG_CACHE_HOME=/var/cache/foxbiz`; direktori foto dimiliki `foxbiz:foxbiz`.
- Timer `foxbiz-attendance-purge.timer` aktif, berjalan 02.15 dengan toleransi acak 5 menit. Unit manual berhasil dijalankan pada 18 November 2026.

## Batas cakupan

Tidak mencakup penggajian, lembur, shift/scheduling, cuti, verifikasi wajah, absensi offline, atau integrasi mesin sidik jari. Kiosk memerlukan koneksi internet, kamera, dan izin lokasi browser. Retensi menghapus file foto saja; metadata absensi tetap ada. Dashboard menampilkan satu outlet aktif; kapasitas data besar dan performa produksi belum diukur. UAT operasional toko dan uji perangkat fisik belum dilakukan.
