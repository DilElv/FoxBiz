'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, ChevronRight, CreditCard, FileBarChart, PackagePlus, ShoppingBag, ShoppingCart, Users, Wallet } from 'lucide-react';
import { Badge, Card, StatCard } from '@foxbiz/ui';
import { AppShell } from '../components/app-shell';

const periods = ['Hari ini', 'Minggu ini', 'Bulan ini'] as const;
const demo = [
  { sales: 'Rp3.842.000', transactions: '128', items: '356', customers: '24', path: 'M0 116 C30 110 42 95 66 101 S103 67 130 79 S161 91 190 60 S218 67 247 75 S278 50 308 58 S339 52 369 29 S402 51 432 31 S463 45 500 13' },
  { sales: 'Rp24.580.000', transactions: '864', items: '2.318', customers: '126', path: 'M0 118 C35 116 50 80 90 91 S140 53 180 66 S240 81 280 43 S330 61 370 35 S440 46 500 9' },
  { sales: 'Rp98.720.000', transactions: '3.462', items: '9.108', customers: '482', path: 'M0 128 C35 95 70 120 110 89 S180 99 220 61 S280 80 320 42 S400 61 440 22 S480 35 500 4' },
];
const quickAccess = [
  { label: 'Penjualan baru', href: '/pos', icon: ShoppingCart },
  { label: 'Tambah produk', href: '/products', icon: PackagePlus },
  { label: 'Terima stok', href: '/inventory', icon: ArrowDownToLine },
  { label: 'Buat PO', href: '/purchasing', icon: ShoppingBag },
  { label: 'Catat pengeluaran', href: '/finance', icon: Wallet },
  { label: 'Laporan', href: '/reports', icon: FileBarChart },
];

export default function DashboardPage() {
  const [period, setPeriod] = useState(0);
  const values = demo[period];
  return <AppShell>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight">Selamat pagi, Alex! <span aria-hidden>👋</span></h1><p className="mt-1 text-sm text-fox-secondary">Lihat ringkasan bisnis Anda hari ini.</p></div><Badge>Data demo · Sprint 0</Badge></div>
    <p className="mb-4 text-xs text-fox-muted">Seluruh angka, grafik, dan peringatan di bawah adalah contoh tampilan.</p>
    <section aria-label="Ringkasan bisnis demo" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatCard label={period === 0 ? 'Penjualan hari ini' : 'Penjualan periode ini'} value={values.sales} trend="12,5%" icon={<ShoppingCart size={19}/>}/>
      <StatCard label="Transaksi" value={values.transactions} trend="8,2%" icon={<CreditCard size={19}/>}/>
      <StatCard label="Item terjual" value={values.items} trend="5,4%" icon={<ShoppingBag size={19}/>}/>
      <StatCard label="Pelanggan baru" value={values.customers} trend="18,6%" icon={<Users size={19}/>}/>
    </section>
    <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(230px,1fr)]">
      <Card className="p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-bold">Ringkasan Penjualan</h2><div className="flex rounded-lg bg-fox-subtle p-1" aria-label="Periode grafik">{periods.map((label, index) => <button key={label} aria-pressed={period === index} onClick={() => setPeriod(index)} className={`min-h-11 rounded-md px-2 text-xs sm:px-3 ${period === index ? 'bg-fox-soft font-semibold text-fox-info' : 'text-fox-secondary'}`}>{label}</button>)}</div></div>
        <div className="mt-4 flex gap-3"><div className="flex h-[184px] shrink-0 flex-col justify-between pb-5 text-[10px] tabular-nums text-fox-muted"><span>4 jt</span><span>3 jt</span><span>2 jt</span><span>1 jt</span><span>0</span></div><div className="min-w-0 flex-1"><svg role="img" aria-label={`Grafik contoh penjualan ${periods[period].toLowerCase()}, total ${values.sales}`} viewBox="0 0 500 150" preserveAspectRatio="none" className="h-40 w-full overflow-visible"><defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1689ED" stopOpacity=".3"/><stop offset="1" stopColor="#1689ED" stopOpacity=".025"/></linearGradient></defs>{[0,37.5,75,112.5,150].map((y) => <line key={y} x1="0" x2="500" y1={y} y2={y} stroke="#E3EDF4" strokeDasharray="3 4"/>)}<path d={`${values.path} L500 150 L0 150Z`} fill="url(#sales-fill)"/><path d={values.path} fill="none" stroke="#1689ED" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/></svg><div className="mt-3 flex justify-between text-[10px] text-fox-muted">{['08.00','10.00','12.00','14.00','16.00','18.00'].map((value) => <span key={value}>{value}</span>)}</div></div></div><p className="sr-only">Grafik demonstrasi, bukan penjualan aktual.</p>
      </Card>
      <Card className="flex flex-col items-center justify-center bg-fox-subtle p-5 text-center"><Image src="/foxi-mascot.png" alt="Foxi, maskot rubah FoxBiz dari referensi asli" width={144} height={104} className="h-24 w-36 object-contain"/><h2 className="mt-2 text-lg font-bold">Terus semangat!</h2><p className="mt-2 max-w-[220px] text-xs leading-5 text-fox-secondary">Kelola bisnis dengan mudah bersama FoxBiz.</p><span className="mt-3 inline-flex items-center gap-1 text-xs text-fox-info"><ArrowUpRight size={15}/>Satu langkah untuk bisnis Anda</span></Card>
    </section>
    <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(230px,1fr)]">
      <Card className="p-4 sm:p-5"><h2 className="text-sm font-bold">Akses Cepat</h2><div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">{quickAccess.map(({ label, href, icon: Icon }, index) => <Link href={href} key={label} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-transparent px-1 py-3 text-center text-xs text-fox-secondary hover:border-fox-border hover:bg-fox-subtle"><span className={`grid h-10 w-10 place-items-center rounded-lg ${index % 2 ? 'bg-teal-50 text-fox-success' : 'bg-fox-soft text-fox-info'}`}><Icon size={21} strokeWidth={1.6}/></span>{label}</Link>)}</div></Card>
      <Card className="p-4 sm:p-5"><h2 className="flex items-center gap-2 text-sm font-bold">Tugas &amp; Peringatan <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-xs text-fox-danger">3</span></h2><ul className="mt-3">{[{ text: 'Stok menipis (3)', href: '/inventory' }, { text: 'PO menunggu (2)', href: '/purchasing' }, { text: 'Pengajuan cuti (1)', href: '/hris' }].map(({ text, href }) => <li key={text}><Link href={href} className="flex min-h-11 items-center gap-2 text-xs text-fox-secondary hover:text-fox-info"><span className="h-1.5 w-1.5 rounded-full bg-fox-danger"/>{text}<ChevronRight size={14} className="ml-auto"/></Link></li>)}</ul></Card>
    </section>
    <p className="mt-5 text-center text-xs text-fox-muted">FoxBiz · POS &amp; Business Management System</p>
  </AppShell>;
}
