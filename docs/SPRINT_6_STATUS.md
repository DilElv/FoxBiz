# Sprint 6 — CRM

Tanggal: 17 November 2026. Status: implementasi selesai dan seluruh gate lokal lulus. Backend NestJS/Node.js, frontend Next.js/TypeScript, identitas Blue/White dengan aksen teal dan aset Foxi dipertahankan.

## Implementasi dan aturan bisnis

- Halaman `/crm` menyediakan daftar pelanggan, pencarian nama/telepon/email, filter empat segmen, pagination 25 data, ringkasan, tambah/ubah pelanggan, profil dan riwayat transaksi berhalaman. Daftar kontak dipaginasi di database; profil hanya mengagregasi penjualan pelanggan yang dibuka. Respons profil dibatalkan ketika dialog ditutup atau profil lain diminta.
- Nama wajib 2–80 karakter; telepon wajib 7–15 digit, boleh diawali + dan unik per tenant setelah spasi/tanda pemisah dihapus. Email opsional maksimal 254 karakter dan dinormalisasi huruf kecil; catatan maksimal 500 karakter. Tidak ada hapus/merge pelanggan. Normalisasi telepon tidak menyamakan awalan lokal `08` dengan `+62`.
- Segmen memakai tanggal kalender lokal tenant dan penjualan berstatus paid: Belum bertransaksi, Aktif ≤30 hari, Perlu perhatian 31–90 hari, Tidak aktif >90 hari. Statistik/riwayat hanya menghitung outlet dalam akses pengguna; pilihan outlet aktif tidak mempersempit CRM lebih jauh. Kontak pelanggan berada di tingkat tenant.
- Permission server `crm.read` dan `crm.customers.write`; navigasi/tindakan UI mengikuti izin. Kasir dapat mencari pelanggan melalui `GET /pos/customers` dengan izin POS tanpa mendapat akses modul CRM. Lookup memerlukan minimal dua karakter, maksimal 20 hasil dan hanya mengembalikan id/nama/telepon.
- Checkout tetap dapat dilakukan tanpa pelanggan. Jika dipilih, `customerId` ikut payload immutable dan hash idempotency; payload tanpa pelanggan mempertahankan hash lama. Hold/resume mempertahankan pelanggan, dan pelanggan yang sudah terikat pada hold dikunci saat dilanjutkan. Hold tanpa pelanggan tetap dapat ditambah pelanggan sebelum checkout. Struk menyimpan snapshot nama saja, tanpa telepon/email/catatan.
- Pilihan pelanggan dan payload checkout disimpan per pengguna/outlet dalam sessionStorage. Pemulihan checkout memakai key/payload yang sama; penyelesaian transaksi membersihkan pilihan pelanggan. sessionStorage dibatasi sesi tab browser, tetapi memuat PII operasional nama/telepon.
- Create/update pelanggan dan audit atomik. Audit mencatat nama field yang berubah tanpa menyalin nilai kontak. Relasi pelanggan penjualan/hold dilindungi composite foreign key tenant. Constraint database memvalidasi nama, telepon, email dan panjang catatan.
- Migration additive `20261117060000_sprint6_crm` menambah tabel customers, kolom customer_id nullable pada sales/held_carts dan indeks pencarian/riwayat. Owner dan manager dengan set izin default persis mendapat CRM; role manager khusus, inventory, cashier dan role lain dipertahankan. Batas izin RoleDto mengikuti katalog izin agar role penuh tetap dapat disimpan.

## Verifikasi

| Gate | Hasil |
| --- | --- |
| Build web/API | Lulus; smoke memakai web hasil production build |
| Lint | Lulus, maksimum 0 warning |
| Typecheck web/API | Lulus |
| Unit | 3/3 lulus, termasuk seluruh katalog permission |
| Integrasi lengkap | 54/54 lulus, tanpa gagal, batal atau skip; termasuk 6 tes CRM (parent dan 5 subtes) |
| Smoke CRM | Desktop 1440×900, tablet 1024×768, mobile 390×844 dan 360×800 lulus |
| Regresi POS | Keempat viewport lulus: tunai, EDC manual, hold/resume, riwayat/cetak ulang dan recovery respons hilang |
| Migration/database | 7 migration sesuai; upgrade role, constraint pelanggan, relasi tenant dan indeks terverifikasi |
| Cleanup | 0 tenant fixture CRM/POS dan 0 trigger/function audit CRM tersisa |
| Audit dependensi | 0 kerentanan |

Smoke CRM mencakup tambah/ubah, nomor duplikat, pencarian/filter, profil kosong/bertransaksi, pemilihan pelanggan yang bertahan setelah reload, pelanggan hold terkunci, checkout dengan/tanpa pelanggan, struk nama saja, serta retry saat koneksi gagal. Respons checkout yang sengaja dibuang tetap menghasilkan tepat satu penjualan setelah recovery. Viewer tidak mendapat aksi tulis; kasir dapat memakai lookup POS namun ditolak dari CRM; role tanpa izin juga ditolak. Tidak terdeteksi overflow halaman atau error konsol yang tidak diharapkan. Tabel pada layar sempit dapat digeser horizontal di dalam panel, dan dialog panjang dapat digulir. Screenshot desktop dan mobile telah ditinjau.

Percobaan awal smoke menerima 503 saat API belum siap. Suite integrasi awal juga terkena timeout pembukaan transaksi Finance saat beberapa gate berjalan bersamaan; tes void berikutnya ikut gagal karena fixture sebelumnya belum terbentuk. Setelah API sehat dan smoke selesai, seluruh suite dijalankan ulang dan lulus tanpa mengubah aturan transaksi Finance. Selector smoke diperbaiki agar menunggu hasil pencarian dan hanya memilih pesan error CRM, bukan elemen pengumuman bawaan Next.js.

Bukti tersedia di [rekap gate](SPRINT_6_VERIFICATION_RESULTS.json), [smoke CRM](SPRINT_6_UI_RESULTS.json), [regresi POS](SPRINT_6_POS_REGRESSION_RESULTS.json), [migration](SPRINT_6_MIGRATION_RESULTS.json) dan [cleanup](SPRINT_6_CLEANUP_RESULTS.json). Log berada di `.local/sprint6-*.log`, screenshot pada `docs/screenshots/crm-*.png`. `node scripts/verify-sprint6-results.mjs` memeriksa bukti tersebut sebelum menulis rekap lulus; pemeriksaan cleanup memerlukan hasil smoke dan semua tes sudah selesai.

## Batas cakupan

Tidak mencakup AI, WhatsApp, payment gateway, loyalty/points, harga khusus pelanggan, kredit/piutang, impor/ekspor, portal pelanggan, penghapusan/merge kontak atau otomasi kampanye. Agregasi segmen masih berjalan per pelanggan yang pernah bertransaksi dalam tenant/akses outlet; kapasitas data besar dan performa produksi belum diukur.

Gate lokal tidak mencakup UAT operasional, perangkat fisik atau deployment produksi, dan tidak menyatakan pixel-perfect. Dashboard masih demo; HRIS dan dashboard aktual memerlukan sprint tersendiri. Workspace lokal belum memiliki Git repository; perubahan belum dikomit/push.
