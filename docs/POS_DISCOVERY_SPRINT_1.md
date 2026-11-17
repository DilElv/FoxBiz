# POS discovery — keluaran Sprint 1

Status historis: rancangan saat penutupan Sprint 1. Implementasi dan hasil verifikasi berikutnya tersedia di `SPRINT_2_STATUS.md`. Acuan: PRD, ERD, dan Sprint Plan v1.0. Aturan yang belum ditentukan merupakan rekomendasi, bukan keputusan bisnis final.

## Alur utama

1. Kasir login dan memilih outlet yang diizinkan. Backend memeriksa tenant, outlet aktif, dan permission pada setiap operasi.
2. Cari produk aktif melalui nama/SKU/barcode; tambahkan kuantitas ke keranjang. Harga dan stok yang ditampilkan hanya perkiraan sampai server memvalidasi checkout.
3. Tinjau barang, subtotal, diskon/pajak bila sudah ditetapkan, total, serta metode pembayaran.
4. Tunai: masukkan uang diterima, tampilkan kembalian. EDC eksternal: kasir menyelesaikan transaksi di terminal, lalu melakukan konfirmasi manual; tidak ada verifikasi otomatis.
5. Kirim checkout dengan idempotency key. Server memvalidasi ulang produk, harga, izin, pembayaran, dan ketersediaan stok pada outlet yang sama.
6. Satu transaksi database menyimpan penjualan, item snapshot, pembayaran, mutasi stok negatif, saldo akhir, serta audit. Kegagalan membatalkan seluruh transaksi.
7. Setelah commit, tampilkan nomor transaksi dan struk yang dapat dicetak ulang. Gangguan printer tidak membatalkan penjualan.

## Hold / resume

Rekomendasi: hold menyimpan keranjang milik tenant/outlet dengan pembuat, waktu, dan versi. Hold tidak memesan stok dan belum menghasilkan pembayaran. Saat resume, server memeriksa ulang harga/status produk dan memperlihatkan perubahan. Hak melihat keranjang kasir lain, masa berlaku, dan kebijakan pindah outlet perlu diputuskan sebelum implementasi.

## Pajak, diskon, dan pembulatan

Belum ditetapkan: pajak inclusive/exclusive, tarif dan urutan diskon, diskon per item/per transaksi, batas kasir dan approval, kuantitas pecahan per satuan, pembulatan Rupiah, serta perlakuan barang non-pajak. Gunakan Decimal di backend dan snapshot per item; hindari perhitungan finansial dengan floating point. Tanpa konfigurasi yang disetujui, jangan mengenakan pajak/diskon secara diam-diam.

## Struk

Minimal yang direkomendasikan: identitas bisnis/outlet, alamat, nomor dan waktu transaksi beserta zona waktu, kasir, item/kuantitas/satuan/harga snapshot, subtotal, diskon/pajak yang berlaku, total, metode pembayaran, uang diterima/kembalian tunai, serta label cetak ulang. Jangan mencetak nomor kartu lengkap. Ukuran printer (58/80 mm), browser printing/integrasi perangkat, logo resmi dan isi footer masih perlu diputuskan.

## Perilaku kegagalan

| Kejadian | Perilaku yang direncanakan |
| --- | --- |
| Stok berubah saat kasir meninjau | Tolak checkout, tampilkan item bermasalah; transaksi belum tercatat |
| Klik bayar dua kali/retry setelah timeout | Idempotency key yang sama mengembalikan transaksi yang sama; payload berbeda ditolak |
| EDC gagal/dibatalkan di terminal | Kasir tidak mengonfirmasi pembayaran; keranjang tetap dapat diperbaiki |
| Konfirmasi EDC manual sudah terjadi, respons timeout | Cek status checkout berdasarkan key sebelum mengulang; jangan meminta pembayaran ulang |
| Sesi habis/izin dicabut/outlet dinonaktifkan | Tolak operasi, arahkan pemulihan sesi dan pemeriksaan status transaksi |
| Printer gagal | Tampilkan transaksi sukses dan opsi cetak ulang |
| API offline | Tampilkan error dan retry aman; penjualan offline belum didukung |

## Kontrak dan acceptance Sprint 2 yang diusulkan

- Tambahkan permission checkout, pembayaran, hold, dan cetak ulang sesuai matriks final; `pos.read` Sprint 1 hanya membuka entry point.
- Endpoint checkout menerima outlet, item ID/quantity, payment intent manual, dan key; tenant/kasir berasal dari sesi. Total akhir dihitung server.
- Lock saldo stok dalam urutan product ID yang stabil; saldo negatif dilarang. Concurrent checkout yang memperebutkan stok terakhir menghasilkan tepat satu penjualan sukses.
- Snapshot harga/nama/SKU/satuan/tax/discount disimpan agar perubahan katalog tidak mengubah histori.
- Uji rollback, idempotency dan payload mismatch, timeout setelah commit, isolasi tenant/outlet, izin, stock race, tunai/kembalian, konfirmasi EDC, dan cetak ulang.
- Shift, split payment, refund/void setelah pembayaran, transfer stok, dan offline checkout tidak boleh diasumsikan tersedia; mengikuti backlog dan keputusan bisnis berikutnya.
