# Deployment FoxBiz — foxbiz.bikinsaas.com

Rilis aktif Sprint 8 (`0.1.0`) menambahkan pendaftaran bisnis mandiri, login dengan kode bisnis opsional, pemilihan outlet yang langsung diperbarui, dan tampilan POS dengan katalog serta keranjang di sisi kanan pada layar lebar. Alur HRIS per outlet mencakup kiosk PIN, foto masuk dan pulang, unduhan JPG, dan rekap PDF.

## Infrastruktur

- Host `203.194.115.231` menjalankan Ubuntu, Nginx, Node.js 20.20.2, dan npm 10.8.2. Record A `foxbiz.bikinsaas.com` dikelola di DNS Rumahweb.
- Web `127.0.0.1:3500` dan API `127.0.0.1:4500` diakses melalui Nginx dan proxy same-origin Next.js. Nginx menyediakan HTTPS dan mengizinkan unggahan hingga 8 MB untuk foto absensi dengan batas aplikasi 5 MB.
- Database `foxbiz_production` menggunakan PostgreSQL 16 pada loopback port 5432 dengan role aplikasi `foxbiz_app`.
- Symlink `/opt/foxbiz/current` menunjuk ke `/opt/foxbiz/releases/sprint8-20261118`. Service `foxbiz-api.service` dan `foxbiz-web.service` berjalan sebagai user sistem `foxbiz`.
- File foto ada di `/var/lib/foxbiz/attendance`. Timer `foxbiz-attendance-purge.timer` berjalan pukul 02.15 waktu server dengan toleransi acak hingga 5 menit. Retensi 180 hari berlaku pada file foto. Metadata absensi tetap tersimpan.
- Konfigurasi privat ada di `/etc/foxbiz/production.env` dengan pemilik `root:foxbiz` dan mode `640`. Setel `ATTENDANCE_DIR=/var/lib/foxbiz/attendance` dan `ATTENDANCE_RETENTION_DAYS=180`. Simpan kredensial di luar repositori.

## Urutan rilis

1. Siapkan direktori rilis baru di `/opt/foxbiz/releases/`. Unggah source tanpa `.env`, `.local`, dependency, atau build lokal. Jalankan `npm ci --include=dev`, `npm run prisma:generate`, dan `npm run build` di host Linux dengan konfigurasi production.
2. Sebelum migrasi, buat backup database dengan `pg_dump -Fc` di `/var/backups/foxbiz/`. Periksa arsip dengan `pg_restore --list` dan catat SHA-256.
3. Jalankan `npm run db:migrate` dan `npm run db:status` dari direktori rilis baru dengan environment production. `scripts/bootstrap-production.cjs` hanya digunakan jika administrator perlu membuat tenant awal melalui provisioning privat. Pendaftaran dari `/register` tersedia untuk tenant baru.
4. Catat target symlink lama, alihkan `/opt/foxbiz/current` secara atomik, lalu restart service API dan web. Periksa health API, halaman login, dan timer purge. Aktivasi Sprint 8 mengembalikan symlink dan me-restart service secara otomatis jika health check setelah aktivasi gagal.
5. Periksa health publik, login, registrasi, outlet kedua, kiosk, foto absensi, dan ekspor di tenant fixture. Hapus fixture dan verifikasi nol baris tenant, sesi, dan absensi fixture serta direktori fotonya sudah hilang.

Template service, timer, dan Nginx tersedia di `infra/production/`. Untuk pemasangan domain baru, aktifkan template HTTP untuk ACME, pastikan DNS mengarah ke server, terbitkan sertifikat Let's Encrypt, lalu periksa konfigurasi dengan `nginx -t` sebelum me-reload Nginx dengan HTTPS.

## Operasi

```bash
systemctl status foxbiz-api foxbiz-web foxbiz-attendance-purge.timer --no-pager
systemctl list-timers foxbiz-attendance-purge.timer --no-pager
journalctl -u foxbiz-api -u foxbiz-web --since '15 minutes ago' --no-pager
journalctl -u foxbiz-attendance-purge --since '7 days ago' --no-pager
readlink -f /opt/foxbiz/current
curl --fail http://127.0.0.1:4500/api/v1/health
curl --fail https://foxbiz.bikinsaas.com/healthz
nginx -t
systemctl status certbot.timer --no-pager
```

Nginx mencatat akses dan error di `/var/log/nginx/foxbiz-access.log` dan `/var/log/nginx/foxbiz-error.log`. Timer menjalankan `apps/api/scripts/purge-attendance.cjs`. Hook pembaruan sertifikat memuat ulang Nginx setelah sertifikat diperbarui.

Jika rilis perlu dikembalikan, periksa kompatibilitas schema lalu alihkan symlink ke rilis sebelumnya dan restart hanya service FoxBiz. Migrasi SQL tetap berlaku setelah symlink dikembalikan. Pemulihan database dari backup memerlukan penghentian penulisan dan penilaian dampak terhadap data yang dibuat setelah backup. Backup `pg_dump` mencakup database.

## Hasil Sprint 8

Pada 18 November 2026 pukul 23.31 WIB, service API dan web aktif, timer purge aktif dan enabled, serta health API mengonfirmasi database terhubung. Sembilan migrasi tercatat dan Prisma menyatakan schema mutakhir. `/healthz`, `/login`, dan `/register` merespons HTTP 200 melalui HTTPS publik dengan sertifikat yang tervalidasi.

- Backup pramigrasi `/var/backups/foxbiz/foxbiz_production-sprint8-20261118-223147.dump` lolos `pg_restore --list`. SHA-256 `9b490fb920bde58491d06cb86eb45c6ab504c63141526fa793de51f045c585bf`.
- Paket `foxbiz-sprint8-20261118.tar.gz` memiliki SHA-256 `785e9962840356f428bc6261f87140bfae5d7754e9cde10db11e2ff1497c5ae5`. ID build web aktif `BNN6vBgyunAG5Ps8wPCwc`. Source aplikasi cocok dengan paket rilis. Beberapa skrip smoke di repositori diperbarui sesudah paket dibuat.
- Tes unit 3/3 dan integrasi API 73/73 lulus. Integrasi dijalankan satu suite per proses pada database development. Lint, typecheck, build lokal, dan build production lulus.
- Smoke browser auth lulus di desktop dan mobile 360 px. Smoke POS lulus di desktop, tablet, mobile 390 px, serta mobile 360 px. Hasil tercatat di [SPRINT_8_AUTH_UI_RESULTS.json](SPRINT_8_AUTH_UI_RESULTS.json) dan [SPRINT_8_POS_UI_RESULTS.json](SPRINT_8_POS_UI_RESULTS.json).
- Smoke publik production mencatat 19 pemeriksaan lulus. Pemeriksaan pasca-cleanup menemukan nol tenant, sesi, dan baris absensi fixture serta mengonfirmasi direktori foto fixture sudah hilang. Bukti tercatat di [SPRINT_8_PRODUCTION_SMOKE.json](SPRINT_8_PRODUCTION_SMOKE.json).

Panduan operasional ada di [USER_GUIDE.md](USER_GUIDE.md). Catatan rilis sebelumnya tersimpan di [PRODUCTION_RELEASE_RESULTS.json](PRODUCTION_RELEASE_RESULTS.json).

## Batasan

- Rate limit per identitas klien adalah 5 permintaan registrasi dan 10 login per menit. Penghitung ada di memori proses API dan akan ter-reset ketika proses dimulai ulang. Jika API dijalankan di beberapa proses, setiap proses memiliki penghitung sendiri.
- Verifikasi email, reset password mandiri, dan unggah foto produk belum tersedia.
- HRIS belum mencakup payroll, lembur, shift, cuti, verifikasi wajah, penggunaan offline, atau integrasi perangkat biometrik.
- UAT toko, pengujian perangkat fisik, dan pengujian beban production belum dilakukan.
