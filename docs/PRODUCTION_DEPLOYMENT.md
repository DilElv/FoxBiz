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

Persiapan host dan database telah dilakukan; build/migrasi, aktivasi service, DNS/TLS dan smoke akhir masih harus dikonfirmasi. Hasil aktual akan dicatat di `PRODUCTION_RELEASE_RESULTS.json`.
