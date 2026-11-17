from pathlib import Path
from PIL import Image
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import zipfile

ROOT = Path(__file__).parent
ASSETS = ROOT / 'design-reference'
ASSETS.mkdir(exist_ok=True)
source_path = ROOT / 'docs' / 'design-reference' / 'preview.webp'
if not source_path.exists():
    source_path = Path(r'C:\Users\DILO\Downloads\preview.webp')
source = Image.open(source_path).convert('RGB')
# Preserve the source artwork; remove only the black letterbox surrounding it.
bounds = source.point(lambda x: 255 if x > 35 else 0).getbbox()
reference = source.crop(bounds)
reference.save(ASSETS / 'FoxBiz-reference.png')
w, h = reference.size
regions = {'dashboard': (.247,.025,.781,.57), 'pos': (.222,.585,.666,.962),
           'mobile': (.675,.585,.786,.97), 'design-system': (.797,.425,.985,.78),
           'modules': (.797,.025,.987,.41)}
for name, box in regions.items():
    reference.crop(tuple(round(v * (w if i % 2 == 0 else h)) for i,v in enumerate(box))).save(ASSETS / f'{name}.png')

doc = Document()
section = doc.sections[0]
section.page_width, section.page_height = Inches(8.27), Inches(11.69)
section.top_margin = section.bottom_margin = Inches(.68)
section.left_margin = section.right_margin = Inches(.7)
styles = doc.styles
for name in ['Normal', 'Body Text', 'List Bullet', 'List Number']:
    styles[name].font.name = 'Calibri'
    styles[name].font.size = Pt(10)
    styles[name].paragraph_format.space_after = Pt(6)
for name in ['Title', 'Heading 1', 'Heading 2', 'Heading 3']:
    styles[name].font.name = 'Calibri'
    styles[name].font.color.rgb = RGBColor.from_string('142344')
styles['Title'].font.size = Pt(30)
styles['Heading 1'].font.size = Pt(19)
styles['Heading 2'].font.size = Pt(13)
header = section.header.paragraphs[0]
header.text = 'FOX BIZ  /  BLUE & WHITE                                               UI/UX DESIGN SYSTEM'
header.style = 'Caption'
footer = section.footer.paragraphs[0]
footer.text = 'FoxBiz  •  v2.0 FINAL  |  Spesifikasi desain                                       '
field = OxmlElement('w:fldSimple'); field.set(qn('w:instr'), 'PAGE'); footer._p.append(field)

def p(text, style=None): doc.add_paragraph(text, style)
def heading(text, level=1): doc.add_heading(text, level)
def bullets(items):
    for item in items: p(item, 'List Bullet')
def table(headers, rows):
    t = doc.add_table(rows=1, cols=len(headers)); t.style = 'Light Shading Accent 1'
    for c,s in zip(t.rows[0].cells, headers): c.text=s
    t.rows[0]._tr.get_or_add_trPr().append(OxmlElement('w:tblHeader'))
    for row in rows:
        cells=t.add_row().cells
        for c,s in zip(cells,row): c.text=str(s)
    for row in t.rows:
        pr = row._tr.get_or_add_trPr(); pr.append(OxmlElement('w:cantSplit'))
    p('')
    return t
def image(name, width, caption):
    doc.add_picture(str(ASSETS / name), width=Inches(width)); p(caption, 'Caption')
def page(title): doc.add_page_break(); heading(title)

p('FOX BIZ', 'Subtitle')
heading('UI/UX Design System\nBlue & White', 0)
p('03  /  FULL POS & BUSINESS MANAGEMENT SYSTEM', 'Subtitle')
p('Versi 2.0 FINAL • 16 November 2026')
image('FoxBiz-reference.png',6.85,'Referensi visual utama: artwork pengguna, dipotong hanya pada area hitam di luar desain.')
p('Dokumen pegangan desain dan pengembangan untuk dashboard, kasir POS, dan seluruh modul operasional FoxBiz. Tampilan mengikuti referensi Blue & White dengan maskot Foxi, permukaan putih, aksen biru–turquoise, dan komponen membulat.')
p('Status FINAL merupakan versi dokumen. Kesamaan piksel hasil aplikasi belum diverifikasi. Gambar referensi dipertahankan; angka token dan ukuran adalah baseline implementasi hasil interpretasi visual, bukan nilai dari file desain asli.')
page('Daftar Isi')
for item in [
    '01 / Sumber, cakupan, dan aturan acuan',
    '02 / Identitas dan anatomi visual',
    '03 / Design tokens — warna',
    '04 / Typography, ukuran, dan elevasi',
    '05 / App shell dan responsive layout',
    '06 / Pustaka komponen',
    '07 / Dashboard — spesifikasi layar',
    '08 / POS — komposisi dan interaksi',
    '09 / POS — status, kegagalan, dan mobile',
    '10 / Spesifikasi modul operasional',
    '11 / Autentikasi, permission, dan form',
    '12 / Bahasa, aksesibilitas, dan feedback',
    '13 / Handoff implementasi dan kontrak data',
    '14 / Traceability dan prioritas delivery',
    '15 / Acceptance criteria visual dan fungsional',
    'Lampiran / Referensi visual lengkap',
]: p(item, 'List Number')
p('Daftar isi ini dibuat eksplisit agar dapat dibaca konsisten pada Word tanpa bergantung pada field TOC yang belum diperbarui oleh aplikasi pembuka.')

page('01 / Sumber, cakupan, dan aturan acuan')
table(['Sumber','Peran'],[
('01_Master_PRD_Full_POS_Business_Management_v1.0.docx','Kebutuhan produk, aktor, FR-01–FR-14, aturan pembayaran dan konsistensi transaksi.'),
('02_Technical_Architecture_ERD_Full_POS_v1.0.docx','Next.js/React/TypeScript/Tailwind/shadcn/ui; kontrak data, tenant, permission, dan endpoint awal.'),
('04_Development_Backlog_Sprint_Plan_Full_POS_v1.0.docx','Sprint 0 untuk fondasi desain; roadmap modul selanjutnya.'),
('preview.webp / gambar yang diberikan pengguna','Sumber visual utama dashboard, POS, mobile, core modules, design system, dan Foxi.')])
p('Urutan acuan: PRD mengatur perilaku bisnis; gambar mengatur arah visual; arsitektur mengatur kontrak implementasi; backlog mengatur tahap delivery. Jika gambar menampilkan bahasa Inggris dan dolar, produk menggunakan Bahasa Indonesia dan Rupiah sesuai PRD sambil mempertahankan hierarki tampilannya.')
heading('Makna kesamaan desain',2)
bullets(['Pertahankan komposisi, proporsi relatif, warna dominan, bentuk komponen, posisi navigasi, ikon outline, dan karakter Foxi yang terlihat.',
'Poster adalah papan presentasi beberapa layar. Kolom promosi, kartu Core Modules, dan kartu Design System bukan panel tambahan di dalam dashboard aplikasi.',
'Screenshot asli berukuran %s × %s piksel; area artwork setelah letterbox dibuang berukuran %s × %s piksel. Pembesaran tidak menambahkan detail asli.' % (*source.size,*reference.size),
'Tidak tersedia sumber Figma, aset vektor, atau ukuran komponen asli. HEX, ukuran, dan breakpoint di dokumen ini merupakan baseline yang harus dicocokkan secara visual.',
'Halaman yang tidak ditampilkan pada gambar adalah turunan desain. Jangan menyebut halaman tersebut sebagai salinan tampilan yang sudah ada di referensi.'])
heading('Cakupan dokumen',2)
p('Fondasi visual; komponen; app shell; dashboard; POS; mobile; spesifikasi seluruh modul; alur dan status; aksesibilitas; mapping teknis; acceptance criteria dan handoff. Dokumen ini tidak memulai implementasi sprint aplikasi.')

page('02 / Identitas dan anatomi visual')
image('dashboard.png',6.85,'Detail dashboard dari sumber asli. Teks kecil mengikuti keterbatasan resolusi sumber.')
bullets(['Logo FoxBiz terletak di kiri atas sidebar; gunakan wordmark dan kepala rubah secara konsisten.',
'Sidebar vertikal ramping, ikon outline, label kecil, area bantuan dengan Foxi di bagian bawah.',
'Topbar ringan: sapaan di area konten, pencarian, notifikasi, avatar; outlet aktif ditampilkan jelas pada konteks transaksi.',
'Empat KPI sejajar: penjualan, transaksi, item terjual, pelanggan baru; angka paling menonjol, tren sebagai informasi sekunder.',
'Grafik area berwarna biru di kiri; kartu motivasi Foxi di kanan; quick access dan to-do berada di baris bawah.',
'Foxi menggunakan oranye, krem, dan outline gelap. Maskot tidak mengambil perhatian dari total transaksi dan tombol pembayaran.'])
heading('Penggunaan aset',2)
p('Potongan gambar di folder design-reference adalah bukti referensi, bukan aset UI produksi yang sudah bersih. Gunakan logo/Foxi asli beresolusi tinggi apabila tersedia. Jangan mengganti Foxi dengan emoji rubah atau ikon generik. Jangan meregangkan aset, mengubah proporsi wajah, atau menambahkan gaya ilustrasi baru.')

page('03 / Design tokens — warna')
p('Baseline perkiraan visual. Warna perlu ditinjau pada ukuran layar sebenarnya; tidak diklaim sebagai hasil pengukuran warna asli desain.')
colors=[('brand.primary','#1689ED','Tombol utama, menu aktif, link, garis grafik'),('brand.primaryHover','#0875D1','Hover tombol utama'),('brand.primarySoft','#E7F3FF','Latar menu aktif dan badge informatif'),('brand.teal','#12B8C4','CTA pembayaran dan aksen transaksi'),('brand.tealSoft','#DFF8F7','Latar aksen turquoise'),('surface.canvas','#F2FAFD','Latar area aplikasi'),('surface.card','#FFFFFF','Kartu, tabel, modal'),('surface.subtle','#F8FBFE','Input, panel sekunder'),('border.default','#E3EDF4','Pemisah, border kartu dan input'),('text.primary','#15213F','Judul dan angka utama'),('text.secondary','#526176','Isi pendukung'),('text.muted','#5E6F84','Metadata'),('status.success','#116B49','Teks sukses pada #E7F7EF'),('status.warning','#936006','Teks perhatian pada #FFF5DE'),('status.danger','#C63D58','Teks gagal pada #FDEDF1'),('status.info','#166FB2','Teks informasi pada #E8F3FF'),('fox.orange','#F5A24C','Identitas Foxi; bukan warna tombol utama')]
t=table(['Token','HEX','Penggunaan'],colors)
for row, item in zip(t.rows[1:], colors):
    shade=OxmlElement('w:shd'); shade.set(qn('w:fill'),item[1][1:]); row.cells[0]._tc.get_or_add_tcPr().append(shade)
p('Untuk teks kecil di tombol gunakan varian primary yang lebih gelap (#0875D1) dan teal gelap (#087F89) jika pasangan warna dasar tidak mencapai kontras 4.5:1. Target nonteks/fokus 3:1. Uji kontras pada pasangan warna final; warna merek tetap dapat dipakai pada ikon dekoratif, chart, dan permukaan.')
image('design-system.png',2.7,'Panel Design System dari referensi: palet, Inter, tombol, badge, input, toggle.')

page('04 / Typography, ukuran, dan elevasi')
p('Font produk: Inter, fallback system-ui, sans-serif. Font dokumen: Calibri untuk kompatibilitas pembacaan DOCX; ini bukan pengganti token font produk.')
table(['Token','Ukuran / line-height','Weight / penggunaan'],[('display','28 / 36 px','700 / heading utama'),('page-title','24 / 32 px','700 / judul halaman'),('section-title','18 / 26 px','600 / judul panel'),('card-title','14 / 20 px','600 / label utama'),('body','14 / 20 px','400 / isi dan tabel'),('small','12 / 18 px','400–500 / metadata'),('kpi-value','26 / 34 px','700 / angka ringkasan'),('pos-total','24 / 32 px','700 / total bayar')])
table(['Kategori','Baseline implementasi'],[('Spacing','4, 8, 12, 16, 20, 24, 32, 40, 48 px; padding kartu 16–24 px.'),('Radius','Input/tombol 8 px; kartu 12 px; panel besar/modal 16 px; pill 999 px.'),('Border','1 px solid border.default. Hindari border gelap tebal pada kartu.'),('Shadow kartu','0 2px 8px rgba(29,74,110,.06).'),('Shadow panel','0 8px 24px rgba(29,74,110,.10).'),('Shadow modal','0 16px 48px rgba(21,33,63,.18).'),('Ikon','Outline konsisten 1.5–2 px; 18–20 px navigasi; 24 px quick access.'),('Kontrol','Tinggi desktop 40 px; target sentuh minimal 44 × 44 px; jarak kontrol 8 px.'),('Gerak','Transisi 120–180 ms; hormati prefers-reduced-motion; tanpa animasi dekoratif terus menerus.'),('Layer','Konten 0; sticky 10; dropdown 30; drawer 40; modal 50; toast 60.')])
p('Nominal memakai angka tabular dan rata kanan pada tabel/keranjang. Jangan mengecilkan ukuran teks agar seluruh isi muat; gunakan wrap, kolom adaptif, atau scrolling yang jelas.')

page('05 / App shell dan responsive layout')
table(['Viewport','Perilaku'],[('Desktop ≥1280 px','Sidebar 192–216 px; topbar 64 px; padding konten 24 px; grid 12 kolom gap 16–24 px.'),('Tablet 768–1279 px','Sidebar ikon 64–72 px atau drawer; padding 16 px; KPI 2 × 2; panel kanan dapat turun ke bawah.'),('Mobile <768 px','Topbar ringkas; padding 12–16 px; bottom navigation 64 px + safe area; kartu disusun vertikal; modul lengkap lewat menu Lainnya.')])
p('Urutan menu desktop: Dashboard, POS, Produk, Inventori, Pembelian, Keuangan, HRIS, CRM, Laporan, Pengaturan. Menu aktif memakai latar biru muda, teks/ikon biru, dan aria-current. Logo tetap di atas; bantuan/Foxi di bawah bila ruang cukup.')
p('Bottom navigation mobile baseline: Beranda, POS, Produk, Lainnya. Ini merupakan pemetaan fungsional karena teks ikon pada referensi terlalu kecil untuk dipastikan. Lainnya membuka daftar modul yang diizinkan.')
p('Tenant aktif berasal dari sesi; outlet aktif terlihat di topbar/POS. Saat pindah outlet dengan keranjang berisi, tampilkan dialog Simpan transaksi / Batalkan perpindahan. Harga dan stok harus dimuat ulang untuk outlet tujuan.')
heading('Pola halaman umum',2)
p('Header halaman berisi judul, deskripsi pendek, dan satu CTA dominan. Toolbar berisi pencarian dan filter. Konten utama berupa tabel atau kartu. Filter outlet, periode, dan status tetap terlihat setelah diterapkan. Pagination dan jumlah hasil ditempatkan di bawah tabel.')
heading('Responsif tanpa kehilangan fungsi',2)
p('Tabel lebar memakai scroll horizontal dalam kontainer berlabel atau ringkasan kartu; jangan memotong tombol aksi. Modal lebar menjadi layar penuh pada mobile. Panel sticky tidak menutup konten terakhir. Grafik menjaga label terbaca dan menyediakan ringkasan nilai tekstual.')

page('06 / Pustaka komponen')
table(['Komponen','Anatomi dan aturan'],[
('Button','Primary biru; bayar teal; secondary putih dengan border; ghost untuk aksi ringan; danger untuk koreksi berisiko. Label kata kerja, ikon opsional, spinner saat proses.'),
('Input & Search','Label permanen, placeholder contoh, helper/error di bawah. Ikon search di kiri, clear di kanan. Scanner barcode tetap mempertahankan fokus pencarian POS.'),
('Select & Combobox','Pilihan aktif jelas; search untuk daftar panjang; loading dan hasil kosong; navigasi panah/Enter/Escape.'),
('Checkbox / Radio / Toggle','Checkbox untuk banyak pilihan, radio satu pilihan, toggle preferensi langsung. Jangan pakai toggle untuk konfirmasi pembayaran.'),
('Card / KPI','Label, ikon dalam latar pastel, angka utama, tren berlabel. Tren tidak dibedakan lewat warna saja.'),
('Badge','Teks status pendek dengan latar lembut. Status tunai/EDC bukan pengganti status pembayaran.'),
('Data table','Header konsisten, sort jelas, nominal rata kanan, aksi per baris berlabel, pagination. Bulk action hanya untuk operasi yang diizinkan.'),
('Tabs / Category chips','Tab aktif biru; tab POS kategori boleh scroll horizontal. Tidak mengubah keranjang saat kategori berganti.'),
('Dialog / Drawer','Judul spesifik, isi, cancel dan aksi utama; trap focus; Escape untuk dismiss bila aman; restore focus setelah ditutup.'),
('Toast / Inline alert','Toast untuk hasil singkat nonkritis. Error pembayaran tetap inline sampai ditangani; gunakan aria-live tanpa mengulang pengumuman.'),
('Chart','Garis biru, area transparan, grid tipis, tooltip jelas, filter periode, ringkasan teks; label rupiah mengikuti skala.'),
('Product card','Foto dengan object-fit contain, nama maksimal dua baris, harga, status stok; seluruh kartu bisa dipilih lewat keyboard.'),
('Cart row','Nama, harga satuan, kuantitas +/−, total baris, hapus. Edit diskon hanya bila berizin.'),
('Receipt','Nama bisnis/outlet, nomor, waktu, kasir, item, diskon, pajak, total, metode, status, uang diterima dan kembalian untuk tunai.')])
heading('State wajib',2)
p('Setiap kontrol interaktif memiliki default, hover, focus-visible, pressed, disabled, dan loading yang relevan. Setiap halaman data memiliki loading/skeleton, empty, success, error/retry, dan akses ditolak. Tombol proses mencegah klik ganda; UI saja tidak menggantikan idempotency backend.')
heading('Spesifikasi implementasi komponen Sprint 0',2)
table(['Komponen','Visual / perilaku','Panduan implementasi'],[
('Button','Radius 8 px; target sentuh 44 px; primary, secondary, ghost, danger. Loading memakai label tetap dan spinner.','Elemen button type yang eksplisit; disabled saat proses; label ikon via aria-label. Primary teks putih memakai primaryHover agar kontras memadai.'),
('Input','Tinggi 44 px, border 1 px; error di bawah field; fokus jelas.','Label terhubung id; aria-invalid dan aria-describedby untuk error/helper; jangan menghilangkan outline tanpa pengganti.'),
('Card / StatCard','Putih, radius 12 px, padding 16–24 px, shadow kartu. Nilai KPI tabular, label dan tren tekstual.','Komposisi reusable; setiap KPI demo diberi konteks demo; tidak memakai nilai nol untuk kegagalan request.'),
('Badge','Pill, teks 12 px, latar pastel; status selalu memiliki label.','Span semantik; bukan tombol kecuali interaktif. Pilih pasangan teks/latar yang mencapai kontras.'),
('SidebarItem','Tinggi minimal 44 px, ikon outline 18 px, aktif latar biru muda.','Link URL nyata dengan aria-current=page; drawer keyboard pada tablet/mobile.'),
('TableShell','Header lembut, border tipis, nominal rata kanan; lebar dibatasi kontainer.','Table/caption/th scope=col; overflow horizontal di kontainer, bukan halaman; render empty state dalam tbody.'),
('Modal / Dialog','Panel putih radius 16 px, overlay navy transparan; judul, deskripsi dan close 44 px.','Radix Dialog mengikuti pola shadcn/ui; trap dan restore focus; Escape; konten dapat scroll pada viewport kecil.')])

page('07 / Dashboard — spesifikasi layar')
image('dashboard.png',6.85,'Komposisi dashboard harus mengikuti gambar ini; ukuran implementasi di bawah adalah baseline.')
table(['Area','Konten dan perilaku'],[('Header','“Selamat pagi, [Nama]”; ringkasan singkat, pencarian, notifikasi dan profil.'),('KPI','Penjualan hari ini, Transaksi, Item terjual, Pelanggan baru. Desktop empat kolom; tablet/mobile dua kolom bila masih terbaca.'),('Grafik utama','Ringkasan penjualan dengan Hari ini / Minggu ini / Bulan ini; lebar sekitar dua pertiga baris.'),('Foxi insight','Sekitar sepertiga baris, Foxi dan pesan berdasarkan aturan/data tersimpan; bukan fitur AI. Jangan membuat insight fiktif.'),('Quick access','Penjualan baru, Tambah produk, Terima stok, Buat PO, Catat pengeluaran, Laporan; tampil sesuai permission.'),('Tugas & peringatan','Stok menipis, PO menunggu, pengajuan cuti; badge jumlah dan tautan ke daftar terfilter.')])
p('Filter outlet/periode berlaku konsisten pada data terkait. Saat gagal memuat satu panel, panel lainnya tetap dapat dipakai. Nilai nol ditampilkan sebagai 0/Rp0 dengan pesan yang sesuai; nilai belum dimuat tidak ditampilkan sebagai nol.')
p('Sprint 0: kartu dan grafik boleh memakai contoh, wajib menampilkan badge “Data demo”. Dashboard operasional memakai data transaksi tersimpan. Perubahan persen tanpa periode pembanding valid ditampilkan “Belum ada pembanding”.')

page('08 / POS — komposisi dan interaksi')
image('pos.png',6.85,'Referensi layar kasir: katalog kiri, current sale kanan, CTA pembayaran turquoise.')
p('Desktop: sidebar ringkas 64–88 px; katalog memakai sisa ruang; keranjang 320–380 px. Header menampilkan POS — Penjualan Baru, outlet aktif dan pengguna. Search tetap mudah dijangkau. Kategori horizontal di atas grid produk 3–5 kolom sesuai ruang.')
p('Keranjang memuat pelanggan opsional, daftar item scroll independen, subtotal, diskon, pajak, total, Tahan, Lainnya, dan tombol “Bayar Rp…” yang sticky di bawah. Total dan CTA tidak tertutup daftar item. Kartu contoh kopi/pastry pada gambar merupakan contoh kategori bisnis, bukan pembatasan katalog.')
heading('Wireflow penjualan',2)
bullets(['Pilih/cari/scan produk → tambah ke keranjang → sesuaikan kuantitas → terapkan diskon sesuai izin → cek total.',
'Bayar → pilih Tunai atau EDC manual → lakukan alur metode → kirim proses → tampilkan hasil transaksi → Cetak / Unduh struk / Transaksi baru.',
'Jika harga atau stok berubah, tampilkan detail perubahan dan minta kasir meninjau total sebelum mengirim ulang.',
'Tahan transaksi menyimpan draft yang dapat dilanjutkan; daftar transaksi ditahan memuat nomor, waktu, kasir, pelanggan bila ada, total dan outlet. Model penyimpanan hold/resume perlu ditambahkan ke kontrak teknis karena ERD awal belum merincinya.'])
heading('Tunai',2)
p('Tampilkan total, input uang diterima, pilihan nominal cepat dan kembalian. Jika nominal kurang, tampilkan kekurangan dan nonaktifkan konfirmasi. Setelah sukses, tampilkan nomor struk dan status Lunas. Nilai total yang ditetapkan server menjadi acuan akhir.')
heading('EDC manual',2)
p('Tampilkan pesan “Proses pembayaran di mesin EDC, lalu konfirmasi hasilnya di sini.” Sebelum dikonfirmasi, status “Menunggu konfirmasi EDC”. Tombol berizin “Konfirmasi EDC berhasil” menampilkan ringkasan nominal sebelum dikirim. Simpan petugas dan waktu. Jangan menampilkan klaim “Terverifikasi otomatis”, input PIN/CVV, atau nomor kartu lengkap.')

page('09 / POS — status, kegagalan, dan mobile')
table(['Status UX','Perilaku'],[('Keranjang kosong','Ilustrasi ringan dan petunjuk memilih produk; Bayar nonaktif.'),('Transaksi ditahan','Tersedia untuk dilanjutkan pada outlet yang sesuai; bukan transaksi lunas.'),('Sedang diproses','Tombol loading, kirim ganda dicegah, total tetap terlihat.'),('Menunggu EDC','Belum lunas; kasir dapat menyelesaikan konfirmasi sesuai izin.'),('Lunas','Nomor struk, metode, total, cetak/unduh, mulai transaksi baru.'),('Gagal validasi','Pertahankan keranjang; sorot item/input yang perlu diperbaiki.'),('Koneksi putus / hasil tidak diketahui','Jangan menyatakan gagal atau lunas tanpa kepastian. Periksa status transaksi memakai identitas request yang sama sebelum retry.'),('Koreksi / pembatalan final','Gunakan proses tercatat sesuai permission; rincian void/refund masih keputusan bisnis terbuka.')])
p('Nama status di atas adalah label UX, bukan enum database yang sudah disepakati. Kontrak status, endpoint pemeriksaan hasil, dan penyimpanan transaksi ditahan harus dipastikan sebelum implementasi POS penuh. Jangan membangun asumsi transaksi offline; offline selling belum termasuk kebutuhan.')
image('mobile.png',2.1,'Referensi mobile menampilkan dashboard ringkas dan navigasi bawah; layar POS mobile tidak ditampilkan dalam sumber.')
p('Turunan POS mobile: katalog dua kolom jika lebar cukup; tombol sticky “Keranjang • n item • Rp…” membuka drawer/layer penuh. Ringkasan total dan Bayar tetap tersedia. Pengguna dapat kembali ke katalog tanpa kehilangan isi keranjang. Keyboard virtual tidak menutup input nominal atau CTA aktif.')

page('10 / Spesifikasi modul operasional')
p('Layar berikut merupakan pengembangan pola visual dashboard/POS untuk cakupan PRD; tidak ada screenshot sumber untuk setiap layar.')
table(['Modul','Layar, data utama, tindakan dan state'],[
('Produk','Daftar: nama/foto, SKU, barcode, kategori, satuan, harga, status. Cari/filter; Tambah, Edit, Nonaktifkan sesuai izin. Form wajib menampilkan error SKU/barcode duplikat. Varian menunggu keputusan bisnis.'),
('Inventori','Saldo per produk/outlet, stok minimum, histori mutasi. Detail menampilkan sumber, waktu dan petugas. Penyesuaian memerlukan alasan dan konfirmasi jumlah. Transfer/stok negatif mengikuti keputusan bisnis.'),
('Pembelian','Supplier, daftar PO, detail item/qty/biaya, penerimaan aktual dan histori. Penerimaan parsial harus menampilkan dipesan, sudah diterima, sisa; aturan toleransi penerimaan perlu disepakati.'),
('Keuangan','Ringkasan kas, pemasukan/pengeluaran, kategori dan rekonsiliasi manual. Form nominal, tanggal, outlet, kategori, keterangan. Label sumber membedakan transaksi penjualan dan pencatatan manual.'),
('HRIS','Daftar/profil karyawan, kehadiran, pengajuan cuti/izin. Detail tanggal, alasan, status dan approver. Aksi setujui/tolak sesuai izin; hindari menampilkan data pegawai di peran tanpa akses.'),
('CRM','Daftar/profil pelanggan, kontak minimum, histori transaksi, segmentasi berbasis aturan eksplisit. Pelanggan tidak wajib untuk checkout. Tampilkan keadaan belum ada transaksi.'),
('Laporan','Jenis laporan, periode, outlet dan filter relevan; ringkasan, tabel, ekspor. Ekspor mencerminkan filter dan permission; format file final perlu ditetapkan.'),
('Pengaturan','Profil bisnis, outlet, pengguna, role/permission, pajak, metode pembayaran, preferensi. Simpan dengan feedback; peringatkan perubahan belum tersimpan saat pindah halaman.'),
('Audit log','Daftar aktor, waktu, aksi, entitas, ringkasan perubahan; filter dan detail read-only sesuai permission. Jangan tampilkan secret/data kartu sensitif.'),
('Platform owner','Pengelolaan tenant merupakan konteks platform terpisah dari navigasi bisnis. Layout mengikuti shell; detail pengelolaan platform belum dirinci PRD.')])

page('11 / Autentikasi, permission, dan form')
heading('Login dan sesi',2)
p('Login menggunakan panel putih membulat, wordmark FoxBiz, judul “Masuk ke FoxBiz”, identitas bisnis (slug) bila email bersifat tenant-scoped, email, password dengan kontrol tampil/sembunyi, dan tombol Masuk. Foxi sebagai ilustrasi pendamping. Identitas bisnis membantu resolusi kredensial; tenant aktif tetap berasal dari sesi tervalidasi, bukan header client. Error kredensial bersifat umum. Sesi berakhir mengarahkan ke login dengan pesan yang jelas; pemulihan draft bergantung kontrak penyimpanan yang ditetapkan.')
table(['Peran','Fokus pengalaman'],[('Business Owner','Ringkasan bisnis, laporan, konfigurasi dan kontrol akses.'),('Admin / Manager','Operasional lintas modul sesuai permission.'),('Cashier','POS, transaksi ditahan, pembayaran dan struk.'),('Inventory Staff','Stok, penerimaan, penyesuaian dan histori.'),('HR Staff','Karyawan, kehadiran, pengajuan dan persetujuan yang diizinkan.'),('Employee','Profil dan layanan mandiri yang diberikan.'),('Platform Owner','Tenant dan konfigurasi lingkup platform.')])
p('Menu/aksi yang tidak diizinkan tidak ditawarkan. Akses lewat URL tetap harus ditolak backend; halaman menampilkan “Anda tidak memiliki akses” dengan tautan kembali. Tombol yang sementara tidak bisa dipakai diberi alasan, misalnya “Tambahkan produk untuk melanjutkan”.')
heading('Form dan validasi',2)
bullets(['Label selalu terlihat; required dinyatakan konsisten; contoh format berada di helper text.',
'Validasi lokal membantu pengguna, validasi server menentukan hasil akhir. Error ditautkan ke field dan fokus menuju error pertama setelah submit.',
'Form panjang dikelompokkan menjadi bagian kecil. Status menyimpan terlihat; perubahan dipertahankan jika request gagal.',
'Tindakan koreksi sensitif memuat entitas, nominal/kuantitas, dampak dan alasan sesuai kebutuhan bisnis.'])

page('12 / Bahasa, aksesibilitas, dan feedback')
table(['Konteks','Microcopy'],[('Cari produk','Cari nama produk, SKU, atau barcode…'),('Produk kosong','Belum ada produk. Tambahkan produk pertama untuk mulai berjualan.'),('Hasil pencarian kosong','Produk tidak ditemukan. Coba kata kunci atau barcode lain.'),('Stok berubah','Stok berubah. Tinjau jumlah produk sebelum melanjutkan.'),('EDC pending','Menunggu konfirmasi manual dari petugas.'),('Pembayaran sukses','Pembayaran berhasil dicatat.'),('Hasil belum pasti','Status transaksi belum dapat dipastikan. Periksa status sebelum mencoba lagi.'),('Gagal muat','Data belum berhasil dimuat. Coba lagi.'),('Demo','Data demo — contoh tampilan, bukan transaksi bisnis Anda.')])
bullets(['Gunakan Bahasa Indonesia konsisten; Rupiah ditampilkan misalnya Rp125.000; angka desimal mengikuti kebutuhan unit bisnis, bukan floating point untuk uang.',
'Tanggal contoh 16 Nov 2026, waktu 14.30; zona waktu mengikuti bisnis dan ditampilkan pada laporan bila relevan.',
'Keyboard dapat mengakses semua kontrol; urutan Tab mengikuti alur visual; Enter mengirim form yang jelas, bukan otomatis mengesahkan pembayaran dari konteks sembarang.',
'Focus ring 2 px dengan offset; teks normal minimal kontras 4.5:1, teks besar 3:1; informasi status selalu mempunyai label teks.',
'Touch target minimal 44 px; tombol ikon mempunyai accessible name; gambar produk mempunyai alt yang sesuai; Foxi dekoratif diberi alt kosong.',
'Modal trap focus dan restore focus. Loading menggunakan aria-busy; hasil aksi diumumkan secukupnya lewat live region.',
'Hormati reduced motion; jangan gunakan animasi flash. Pada zoom 200%, konten dan tindakan utama harus tetap dapat diakses.'])

page('13 / Handoff implementasi dan kontrak data')
table(['Area','Panduan'],[('Tokens','Simpan warna, radius, spacing dan shadow dalam CSS custom properties lalu petakan ke Tailwind. Hindari nilai warna tersebar di halaman.'),('Komponen','Gunakan primitive shadcn/ui dengan token FoxBiz; AppShell, SidebarItem, StatCard, ProductCard, CartPanel dan PaymentDialog sebagai komposisi bersama.'),('Data','Next.js/React mengonsumsi REST NestJS. Format nilai uang untuk tampilan; jangan menjadikan kalkulasi frontend sebagai sumber akhir checkout.'),('Tenant','Gunakan tenant context sesi tervalidasi. Outlet selector hanya menawarkan outlet yang diizinkan.'),('Pembayaran','Request kritis memakai identitas idempotency. Retry untuk hasil yang sama mengikuti kontrak backend; klik ganda tidak menghasilkan penjualan ganda.'),('State data','Loading/empty/error/forbidden dibedakan. Skeleton menjaga struktur; jangan menyamarkan data gagal muat sebagai angka nol.')])
table(['Layar','Endpoint awal dari arsitektur'],[('Profil dan permission','GET /api/v1/me'),('Login','POST /api/v1/auth/login'),('Dashboard','GET /api/v1/dashboard/summary?period=today'),('Produk','GET/POST /api/v1/products'),('Checkout','POST /api/v1/sales'),('Pembayaran','POST /api/v1/sales/{id}/payments'),('EDC manual','POST /api/v1/payments/{id}/confirm-manual'),('Saldo stok','GET /api/v1/inventory/balances'),('PO / penerimaan','POST /api/v1/purchase-orders ; POST /api/v1/goods-receipts'),('Laporan penjualan','GET /api/v1/reports/sales')])
p('Endpoint tersebut baseline sumber, bukan bukti API sudah tersedia. Endpoint edit/detail, hold/resume, status recovery, ekspor, CRM/HRIS/Finance dan setting perlu dirinci pada sprint terkait. Token respons, enum status, pembulatan dan aturan diskon/pajak harus disepakati lintas frontend/backend.')

page('14 / Traceability dan prioritas delivery')
table(['Kebutuhan sumber','Bagian UI/UX','Tahap'],[('FR-01–02 • autentikasi/tenant','Login, sesi, permission, outlet selector','Fondasi S0; lengkap S1'),('FR-03 • dashboard','KPI, chart, quick access, alerts','Shell S0; data riil sesuai roadmap'),('FR-04 • produk','Daftar, detail, form produk','S1'),('FR-05–06 • POS/pembayaran','Katalog, cart, hold, tunai, EDC manual, struk','Discovery S1; end-to-end S2'),('FR-07 • stok','Saldo, mutasi, penyesuaian, transfer bila ditetapkan','Fondasi S1; lengkap S3'),('FR-08 • pembelian','Supplier, PO, penerimaan','S4'),('FR-09 • keuangan','Kas, pemasukan/pengeluaran, rekonsiliasi','S5'),('FR-10 • HRIS','Karyawan, kehadiran, pengajuan','S7'),('FR-11 • CRM','Pelanggan dan histori','S6'),('FR-12 • laporan','Filter, tabel, ekspor','S8'),('FR-13–14 • audit/settings','Audit, konfigurasi, role/permission','Fondasi dan sprint domain terkait')])
heading('Sprint 0 — keluaran desain yang wajib',2)
bullets(['S0-10: token warna, typography, spacing, radius, shadow dan state terpusat.',
'S0-11: button, input, card, badge, sidebar item, table shell dan dialog dasar.',
'S0-12: responsive app shell desktop/tablet/mobile.',
'S0-13: dashboard shell, KPI demo berlabel, chart shell, quick access dan alerts.',
'POS entry point tersedia sesuai definition of done; checkout bisnis penuh masuk sprint berikutnya.',
'Review visual dan smoke test mencatat viewport, hasil aktual dan temuan. Dokumen ini tidak membuktikan build aplikasi atau tes bisnis sudah dijalankan.'])

page('15 / Acceptance criteria visual dan fungsional')
table(['Pemeriksaan','Kriteria penerimaan'],[('Referensi','Gunakan artwork yang disertakan sebagai pembanding; pisahkan dashboard/POS dari elemen poster.'),('Struktur desktop','Sidebar kiri, KPI empat kolom, grafik kiri dan Foxi kanan, quick access serta alerts pada posisi sesuai referensi.'),('POS','Grid katalog kiri, keranjang kanan, total jelas dan CTA teal; tidak mengubah struktur menjadi halaman tabel kasir.'),('Identitas','Biru-putih dominan, typography Inter pada produk, ikon outline, radius dan shadow halus, Foxi konsisten.'),('Visual comparison','Ambil screenshot viewport yang sama, sejajarkan crop dengan referensi, bandingkan overlay 50%; catat selisih posisi, ukuran, warna dan aset. Ini prosedur usulan, belum dijalankan pada aplikasi.'),('Responsive','Periksa 1440×900, 1024×768, 768×1024, 390×844 dan 360×800; tidak ada konten/CTA penting tertutup atau overflow halaman.'),('State','Loading, empty, error, forbidden, disabled, processing dan success dapat ditinjau.'),('Pembayaran','Tunai menghitung kembalian; EDC pending tidak tampil lunas; konfirmasi manual jelas; hasil tak pasti tidak memicu pembayaran ganda.'),('Aksesibilitas','Keyboard, fokus, label, kontras, touch target dan zoom diperiksa.'),('Data','Bahasa Indonesia/Rupiah; demo diberi label; outlet/periode konsisten; total server menjadi acuan.')])
heading('Keputusan yang tetap terbuka dari sumber',2)
p('Jenis bisnis awal; varian; pajak/service charge dan pembulatan; shift kasir; detail refund/void; transfer dan stok negatif; format/printer struk; kebijakan approval; format ekspor; endpoint hold/resume dan recovery. Desain rinci bagian ini tidak boleh dianggap keputusan bisnis final hanya karena dokumen desain berlabel FINAL.')
heading('Batas klaim kesamaan',2)
p('Gambar dalam dokumen berasal dari referensi pengguna yang sama. Spesifikasi visual mengunci arah dan komposisinya, tetapi kesamaan 100% piksel aplikasi tidak dapat dinyatakan sebelum implementasi dibandingkan dengan sumber resolusi penuh. Tidak ada mockup baru yang diklaim sebagai hasil render aplikasi.')

page('Lampiran / Referensi visual lengkap')
image('FoxBiz-reference.png',6.85,'Master visual Blue & White — sumber gambar pengguna.')
image('modules.png',2.6,'Core Modules dalam poster: daftar cakupan, bukan layout dashboard tambahan.')
p('Berkas pendamping: design-reference/FoxBiz-reference.png, dashboard.png, pos.png, mobile.png, design-system.png, modules.png. Pemotongan mempertahankan konten visual sumber tanpa menggambar ulang aset.')

doc.core_properties.title = 'FoxBiz UI/UX Design System Blue & White v2.0 FINAL'
doc.core_properties.subject = 'Dokumen 03 — Full POS & Business Management System'
doc.core_properties.author = 'FoxBiz'
out = ROOT / 'docs' / '03_UIUX_Design_System_FoxBiz_Blue_White_v2.0_FINAL.docx'
out.parent.mkdir(exist_ok=True)
doc.save(out)
check = Document(out)
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    media = [n for n in z.namelist() if n.startswith('word/media/')]
assert len(check.tables) >= 15 and len(media) >= 5
assert '15 / Acceptance criteria visual dan fungsional' in [p.text for p in check.paragraphs]
print(f'Created: {out}\nSize: {out.stat().st_size:,} bytes\nParagraphs: {len(check.paragraphs)}\nTables: {len(check.tables)}\nEmbedded images: {len(media)}\nReference: {reference.size}\nDOCX package validation: PASS')
