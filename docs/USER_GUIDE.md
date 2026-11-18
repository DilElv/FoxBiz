# Panduan Penggunaan FoxBiz

## Masuk

1. Buka `https://foxbiz.bikinsaas.com/login`.
2. Masukkan kode bisnis dari administrator (misalnya `foxbiz` atau kode bisnis Anda), email, dan password dari file kredensial privat yang diberikan administrator.
3. Simpan file kredensial di tempat privat. UI saat ini belum menyediakan penggantian password; minta administrator merotasi password secara aman sebelum akun dipakai rutin. Jangan gunakan ulang password di layanan lain atau mengirim kredensial di grup/chat publik.

## Persiapan toko

1. Periksa nama bisnis dan zona waktu pada Pengaturan.
2. Tambahkan outlet, kategori, produk, dan pengguna. Isi SKU unik serta harga jual; tetapkan peran dan cakupan outlet sesuai tugas.
3. Tambahkan saldo awal stok setiap produk/outlet sebelum mulai menjual. Akun production baru hanya berisi outlet `Toko Utama`; tidak ada barang, pelanggan, atau transaksi demo.
4. Pastikan setiap staf memakai akun sendiri. Jangan berbagi akun owner.

## Operasional POS

1. Buka **Kasir/POS**, pilih outlet yang menjadi cakupan pengguna, cari produk, lalu masukkan ke keranjang.
2. Pemilihan pelanggan bersifat opsional. Kasir dapat mencari pelanggan yang sudah terdaftar atau lanjut tanpa pelanggan.
3. Pilih tahan keranjang untuk menyimpan transaksi belum dibayar. Stok tidak dicadangkan oleh hold.
4. Untuk tunai, masukkan uang diterima dan catat pembayaran. Untuk EDC manual, gunakan hanya setelah pembayaran dikonfirmasi pada terminal fisik; aplikasi tidak menghubungi bank.
5. Jika respons jaringan hilang, gunakan **Periksa status/Kirim ulang aman** pada transaksi yang sama. Jangan menagih kartu lagi di terminal.
6. Cetak struk dari dialog struk melalui printer/browser yang sudah dikonfigurasi.

## Produk, stok, dan pembelian

- **Produk/Katalog**: buat kategori dan produk, periksa SKU, satuan, harga, dan status aktif.
- **Stok**: penyesuaian memerlukan alasan. Penerimaan menambah stok. Transfer mengurangi stok saat dikirim dan baru menambah tujuan setelah outlet penerima mengonfirmasi.
- **Pembelian**: tambahkan supplier, buat PO, pesan, lalu catat jumlah barang yang benar-benar diterima. Penerimaan PO memperbarui stok secara atomik.
- Periksa riwayat dokumen dan mutasi untuk menelusuri perubahan. Jangan membuat penyesuaian stok untuk menyamarkan transaksi kas.

## Finance dan CRM

- **Finance**: laporan kas memilih outlet dan periode. Pemasukan/pengeluaran manual harus memakai kategori, tanggal, nominal, dan catatan yang sesuai. Koreksi entri tercatat dilakukan dengan void beralasan; transaksi POS tidak dicatat ulang sebagai pemasukan.
- **CRM**: tambahkan pelanggan dengan nama dan telepon unik per bisnis. Email dan catatan opsional. Buka profil untuk melihat segmen dan transaksi pada outlet yang diizinkan. Jangan menyimpan informasi sensitif yang tidak dibutuhkan pada catatan.

## HRIS dan absensi

1. Buka **HRIS**, tab **Karyawan**, lalu tambahkan karyawan dengan nama, kode unik, jabatan, telepon, dan PIN 6 digit. Karyawan tidak memerlukan akun login terpisah.
2. Atur akses outlet karyawan. Pilihan **akses seluruh outlet** otomatis mencakup outlet baru yang dibuat kemudian.
3. Buka tab **Kiosk Absensi**, pilih outlet, lalu pilih nama karyawan. Karyawan memasukkan PIN dan mengambil foto masuk atau pulang. Foto wajib; server menambahkan watermark berisi nama bisnis, outlet, nama/kode karyawan, jenis absen, waktu server, ID absensi, dan GPS bila diizinkan.
4. Satu perangkat kiosk boleh dipakai bergantian oleh banyak karyawan pada akun pengelola yang sama. Kasir POS tetap memakai akun pengguna sendiri dan tidak otomatis menjadi karyawan kiosk.
5. Tab **Rekap & Ekspor** menampilkan rekap harian (termasuk karyawan yang belum absen) dan rekap bulanan. Unduh foto JPG dari tautan foto atau rekap PDF dari tombol Unduh PDF.
6. Foto absensi disimpan maksimal 180 hari. Setelah itu file foto dibersihkan otomatis oleh timer server, sedangkan metadata absensi tetap tersimpan untuk laporan. Unduh JPG atau PDF sebelum masa retensi berakhir bila diperlukan.

## Dashboard

Dashboard menampilkan data aktual outlet yang dipilih: penjualan, transaksi, item terjual, pelanggan baru, grafik penjualan, stok menipis, PO menunggu, dan status absensi hari ini. Angka dan peringatan mengikuti izin peran Anda; peran tanpa izin POS tidak melihat ringkasan penjualan, dan peran tanpa izin HRIS tidak melihat status absensi.

## Hak akses dan keamanan akun

- Owner/manager mengelola data sesuai permission; viewer hanya membaca; kasir menjalankan POS dan pencarian pelanggan tanpa akses halaman CRM.
- Gunakan hak akses minimum dan cakupan outlet paling sempit yang sesuai pekerjaan.
- Keluar dari sesi setelah memakai perangkat bersama. Admin dapat menonaktifkan pengguna atau mengganti password untuk mencabut sesi lama.
- Laporkan perangkat hilang, akses tidak dikenal, atau selisih stok/kas kepada pengelola segera.

## Kondisi awal dan batasan

Database production awalnya hanya berisi tenant `foxbiz`. Setiap bisnis baru dibuat tanpa produk, pelanggan, atau transaksi demo dan hanya berisi akun owner, role bawaan, serta outlet `Toko Utama`. Admin perlu menambah produk dan saldo awal stok sebelum kasir dapat bertransaksi. Sistem belum mencakup settlement EDC otomatis, perangkat printer khusus yang tervalidasi, refund pascalunas, loyalty, integrasi WhatsApp, penggajian/lembur HRIS, atau verifikasi wajah. Uji operasional toko nyata dan perangkat fisik belum dilakukan.

## Bantuan admin

Status service diperiksa oleh admin melalui `systemctl status foxbiz-api foxbiz-web`; health API berada di `/api/v1/health`. Buat akun staf individual dan jangan mengirim file kredensial owner bersama dokumentasi umum.
