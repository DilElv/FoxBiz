# Deployment FoxBiz — foxbiz.bikinsaas.com

Target rilis: source Sprint 0–6, versi aplikasi `0.1.0`. Poin 7–8 dalam rencana percakapan berarti deployment dan dokumentasi rilis; bukan implementasi modul fitur Sprint 7/8 pada backlog produk. Backup dan staging dilewati atas arahan pengguna.

## Infrastruktur

- Host: `203.194.115.231`, Ubuntu, Nginx, Node.js 20.20.2 dan npm 10.8.2.
- Domain: `foxbiz.bikinsaas.com`; record A harus menunjuk ke IP host di DNS Rumahweb.
- Web: `127.0.0.1:3500`, API: `127.0.0.1:4500`; diakses melalui Nginx dan proxy same-origin Next.js.
- Database terpisah: `foxbiz_production`, role `foxbiz_app`, PostgreSQL 16 lokal port 5432. Gate development memakai PostgreSQL 17; kompatibilitas production harus dikonfirmasi lewat migrasi dan smoke host aktual.
- Release: `/opt/foxbiz/releases/sprint6-20261118`, symlink aktif `/opt/foxbiz/current`.
- Service: `foxbiz-api.service` dan `foxbiz-web.service`, user sistem `foxbiz`, restart otomatis saat gagal.
- Konfigurasi privat: `/etc/foxbiz/production.env` (root:foxbiz, mode 640). Jangan salin ke Git.

## Urutan rilis

1. Periksa situs aktif, resource, port dan konflik direktori; gunakan database/service FoxBiz tersendiri.
2. Upload source tanpa `.env`, `.local`, dependency/build lokal, lalu `npm ci --include=dev` di host Linux.
3. Generate Prisma, build web/API, jalankan `npm run db:migrate` lalu `npm run db:status` dengan environment production.
4. Jalankan `scripts/bootstrap-production.cjs` secara eksplisit dengan `FOXBIZ_BOOTSTRAP_FILE` privat. Skrip menolak tenant yang sudah ada, membuat owner/role/outlet tanpa produk atau transaksi demo.
5. Aktifkan symlink dan service; periksa API langsung serta halaman web lokal.
6. Pasang virtual host HTTP hanya untuk ACME. Setelah DNS benar, terbitkan sertifikat Let's Encrypt, pasang konfigurasi HTTPS dan jalankan `nginx -t` sebelum reload.
7. Jalankan smoke production pada tenant fixture tersendiri, verifikasi cleanup, dan periksa status service/log. Tidak ada UAT operasional atau uji perangkat fisik dalam rilis ini.

Template service dan Nginx ada di `infra/production/`. Template HTTP mengembalikan 503 sampai HTTPS siap. Jangan aktifkan template HTTPS sebelum sertifikat tersedia. Pengujian aplikasi sebelum propagasi DNS dapat menggunakan override resolusi klien; ini bukan bukti domain publik sudah aktif.

## Operasi

```bash
systemctl status foxbiz-api foxbiz-web --no-pager
journalctl -u foxbiz-api -u foxbiz-web --since '15 minutes ago' --no-pager
curl --fail http://127.0.0.1:4500/api/v1/health
curl --fail https://foxbiz.bikinsaas.com/healthz
nginx -t
systemctl status certbot.timer --no-pager
```

Nginx menulis `/var/log/nginx/foxbiz-access.log` dan `/var/log/nginx/foxbiz-error.log`; service menulis journal. Ini menyediakan log lokal dan pemulihan proses, belum termasuk layanan alert eksternal. Certbot harus memiliki renewal hook untuk reload Nginx sesudah sertifikat diperbarui.

## Penghentian dan pemulihan

Rilis pertama belum memiliki versi production sebelumnya. Jika smoke gagal, hentikan service FoxBiz atau tampilkan maintenance pada virtual host FoxBiz; jangan menyentuh service/database aplikasi lain. Untuk rilis berikutnya, symlink dapat dikembalikan ke release sebelumnya setelah kompatibilitas schema diperiksa. Migrasi SQL tidak otomatis dibalik. Backup tidak dibuat pada rilis ini atas arahan pengguna, sehingga pemulihan data sebelum migrasi tidak tersedia dari proses deployment ini.

## Status

Status runtime per 18 November 2026:

- Build production Next.js/NestJS lulus di Ubuntu/Node 20.
- Ketujuh migrasi berhasil diterapkan pada database baru `foxbiz_production`; `db:status` menyatakan schema up to date.
- Tenant `foxbiz`, akun owner, role bawaan dan outlet MAIN dibuat tanpa data demo transaksi/produk. Kredensial awal disimpan root-only di `/etc/foxbiz/initial-owner.json`; salinan lokal privat berada di `.local/foxbiz-owner-credentials.json` dan diabaikan Git. Rotasi password dilakukan administrator melalui API karena UI belum mendukungnya; pembaruan pengguna mencabut sesi pengguna tersebut.
- `foxbiz-api.service` dan `foxbiz-web.service` aktif; health API menyatakan database connected. Pengujian lokal melalui proxy lulus untuk login, cookie Secure/HttpOnly, session, CRM list, Finance metadata, POS products/customer lookup, serta logout/revocation. Foreign-origin ditolak 403 setelah perbaikan proxy.
- Situs publik aktif di `https://foxbiz.bikinsaas.com`. Record A `foxbiz` → `203.194.115.231` sudah terlihat di DNS publik dan server; sertifikat Let's Encrypt terbit untuk domain ini dan berlaku sampai 16 Februari 2027. HTTP dialihkan ke HTTPS, HSTS aktif, dan halaman login tampil normal.
- Smoke melalui domain publik lulus: health database connected, penolakan sesi anonim dan origin asing, login owner dengan cookie Secure/HttpOnly/SameSite, akses CRM/Finance/POS, serta logout yang mencabut sesi. Simulasi perpanjangan `certbot renew --dry-run` berhasil; timer certbot aktif dan deploy hook me-reload Nginx.
- Kredensial DNS/SSH tidak disimpan di repository. Backup dan staging dilewati sesuai permintaan. Deployment pertama tidak memiliki release aplikasi atau backup data sebelumnya untuk rollback.

Hasil pemeriksaan dan hash source aplikasi dicatat di `PRODUCTION_RELEASE_RESULTS.json`. Panduan operasional tersedia di [USER_GUIDE.md](USER_GUIDE.md).

## Pengujian dan penilaian keamanan

Tes unit lulus 3/3, integrasi lokal lulus 54/54 pada database development terisolasi `foxbiz_sprint0`, serta lint dan typecheck lulus. Integrasi mencakup sesi, isolasi tenant/outlet, RBAC, POS, stok, purchasing, Finance, dan CRM. Pemeriksaan cleanup setelah tes menemukan nol tenant dengan awalan `test-`; tes integrasi tidak dijalankan pada database production.

Smoke proxy production dan smoke domain publik mengonfirmasi cookie Secure/HttpOnly, penolakan foreign-origin, serta logout/revocation. Pemeriksaan server pukul 03:47 WIB pada 18 November mengonfirmasi service aktif, database connected, port FoxBiz hanya di loopback, file owner mode 600 root:root, dan environment mode 640 root:foxbiz. HTTPS publik dengan sertifikat valid sudah diuji dari luar server pada hari yang sama.

Temuan lanjutan:

- SSH efektif mengizinkan `PermitRootLogin yes` dan `PasswordAuthentication yes`. Administrator server perlu meninjau akses berbasis key dan akun non-root setelah memastikan jalur akses pengganti bekerja. Konfigurasi SSH global tidak diubah dalam deployment ini.
- Aplikasi lain mendengarkan pada alamat wildcard port 3100/3101. Perlu verifikasi kebutuhan akses publik dan aturan firewall bersama pemilik aplikasi; konfigurasi aplikasi lain tidak diubah.
- Pembatasan percobaan login berada dalam memori proses API (10 percobaan per menit per identitas klien). Restart mereset penghitung dan beberapa proses tidak berbagi penghitung; perlindungan ini perlu ditinjau jika runtime diperluas.
- Penilaian ini berdasarkan tes otomatis, smoke, dan pemeriksaan konfigurasi; bukan penetration test menyeluruh. UAT toko, perangkat fisik, dan performa production belum diverifikasi.
