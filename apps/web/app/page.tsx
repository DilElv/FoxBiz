'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpRight, CheckCircle2, ChevronRight, CreditCard, FileBarChart, PackagePlus, RefreshCw, ShoppingBag, ShoppingCart, Users, Wallet } from 'lucide-react';
import { Badge, Button, Card, StatCard } from '@foxbiz/ui';
import { AppShell } from '../components/app-shell';
import { useSession } from '../components/session-provider';
import { api } from '../lib/api';
import { Notice } from '../components/workspace-ui';

const periods = [
  { value: 'today', label: 'Hari ini' },
  { value: 'week', label: 'Minggu ini' },
  { value: 'month', label: 'Bulan ini' },
] as const;
type Period = typeof periods[number]['value'];
type Dashboard = {
  outletId: string; outletName: string; period: Period; from: string; to: string; today: string; timezone: string; currency: string;
  capabilities: { sales: boolean; inventory: boolean; purchasing: boolean; customers: boolean; hris: boolean };
  summary: {
    sales: string; transactions: number; items: string; newCustomers: number;
    previous: { sales: string; transactions: number; items: string; newCustomers: number };
    trends: { sales: number | null; transactions: number | null; items: number | null; newCustomers: number | null };
  };
  series: { key: string; label: string; amount: string }[];
  alerts: {
    lowStock: number; lowStockItems: { name: string; sku: string; quantity: string; threshold: string }[];
    pendingPurchaseOrders: number;
    attendance: { active: number; present: number; absent: number; working: number; absentNames: string[] };
  };
};
const quickAccess = [
  { label: 'Penjualan baru', href: '/pos', icon: ShoppingCart },
  { label: 'Tambah produk', href: '/products', icon: PackagePlus },
  { label: 'Terima stok', href: '/inventory', icon: ArrowDownToLine },
  { label: 'Buat PO', href: '/purchasing', icon: ShoppingBag },
  { label: 'Catat pengeluaran', href: '/finance', icon: Wallet },
  { label: 'Laporan', href: '/reports', icon: FileBarChart },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 19) return 'Selamat sore';
  return 'Selamat malam';
}
function money(value: string, currency: string) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value));
}
function count(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits }).format(value);
}
function compact(value: number) {
  return new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
function trend(value: number | null) {
  if (value === null || !Number.isFinite(value)) return undefined;
  return `${value > 0 ? '+' : ''}${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)}%`;
}
function rangeLabel(from: string, to: string) {
  const format = (day: string) => new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(`${day}T00:00:00.000Z`));
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}
function chartPaths(values: number[]) {
  const maximum = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 500;
    const y = 140 - (value / maximum) * 130;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return { line: points || 'M0 140 L500 140', area: `${points || 'M0 140 L500 140'} L500 150 L0 150Z`, maximum };
}
function tickIndexes(length: number) {
  if (length <= 6) return Array.from({ length }, (_, index) => index);
  return [...new Set(Array.from({ length: 6 }, (_, index) => Math.round((index * (length - 1)) / 5)))];
}

export default function DashboardPage() {
  return <AppShell><Dashboard/></AppShell>;
}

function Dashboard() {
  const { user, outlets, outletId } = useSession();
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const outlet = outlets.find((item) => item.id === outletId);
  useEffect(() => {
    if (!outletId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    api<Dashboard>(`dashboard?outletId=${outletId}&period=${period}`, { signal: controller.signal })
      .then((result) => { setData(result); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [outletId, period, revision]);
  const salesVisible = data?.capabilities.sales ?? false;
  const values = (data?.series ?? []).map((item) => Number(item.amount));
  const { line, area, maximum } = chartPaths(values);
  const ticks = tickIndexes(data?.series.length ?? 0);
  const alertEntries: { text: string; href: string }[] = [];
  if (data?.capabilities.inventory && data.alerts.lowStock > 0) alertEntries.push({ text: `Stok menipis (${count(data.alerts.lowStock)})`, href: '/inventory' });
  if (data?.capabilities.purchasing && data.alerts.pendingPurchaseOrders > 0) alertEntries.push({ text: `PO menunggu (${count(data.alerts.pendingPurchaseOrders)})`, href: '/purchasing' });
  if (data?.capabilities.hris && data.alerts.attendance.absent > 0) alertEntries.push({ text: `Karyawan belum absen (${count(data.alerts.attendance.absent)})`, href: '/hris' });
  if (data?.capabilities.hris && data.alerts.attendance.working > 0) alertEntries.push({ text: `Belum absen pulang (${count(data.alerts.attendance.working)})`, href: '/hris' });
  const periodLabel = periods.find((item) => item.value === period)?.label.toLowerCase() ?? 'hari ini';
  return <>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{greeting()}, {user.name}! <span aria-hidden>👋</span></h1>
        <p className="mt-1 text-sm text-fox-secondary">{data ? `${rangeLabel(data.from, data.to)} · ${outlet?.name ?? data.outletName}` : 'Ringkasan bisnis aktual untuk outlet yang Anda pilih.'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{outlet?.name ?? data?.outletName ?? 'Outlet'}</Badge>
        <Button variant="secondary" onClick={() => setRevision((value) => value + 1)} disabled={loading}><RefreshCw size={16}/>Muat ulang</Button>
      </div>
    </div>
    {error && <Notice error>{error}</Notice>}
    {loading && !data ? <Notice>Memuat ringkasan bisnis...</Notice> : data && <>
      {salesVisible ? <section aria-label="Ringkasan penjualan" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label={`Penjualan ${periodLabel}`} value={money(data.summary.sales, data.currency)} trend={trend(data.summary.trends.sales)} trendTone={(data.summary.trends.sales ?? 0) < 0 ? 'negative' : 'positive'} icon={<ShoppingCart size={19}/>}/>
        <StatCard label="Transaksi" value={count(data.summary.transactions)} trend={trend(data.summary.trends.transactions)} trendTone={(data.summary.trends.transactions ?? 0) < 0 ? 'negative' : 'positive'} icon={<CreditCard size={19}/>}/>
        <StatCard label="Item terjual" value={count(Number(data.summary.items), 1)} trend={trend(data.summary.trends.items)} trendTone={(data.summary.trends.items ?? 0) < 0 ? 'negative' : 'positive'} icon={<ShoppingBag size={19}/>}/>
        <StatCard label="Pelanggan baru" value={count(data.summary.newCustomers)} trend={data.capabilities.customers ? trend(data.summary.trends.newCustomers) : undefined} trendTone={(data.summary.trends.newCustomers ?? 0) < 0 ? 'negative' : 'positive'} icon={<Users size={19}/>}/>
      </section> : <Card className="p-4 sm:p-5"><h2 className="text-sm font-bold">Ringkasan penjualan</h2><p className="mt-2 text-sm text-fox-secondary">Peran Anda tidak memiliki akses ke data penjualan. Ringkasan stok, pembelian, dan absensi tetap tersedia di bawah.</p></Card>}
      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(230px,1fr)]">
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold">Ringkasan Penjualan</h2>
            {salesVisible && <div className="flex rounded-lg bg-fox-subtle p-1" aria-label="Periode grafik">{periods.map(({ value, label }) => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)} className={`min-h-11 rounded-md px-2 text-xs sm:px-3 ${period === value ? 'bg-fox-soft font-semibold text-fox-info' : 'text-fox-secondary'}`}>{label}</button>)}</div>}
          </div>
          {salesVisible ? <>
            <div className="mt-4 flex gap-3">
              <div className="flex h-[184px] shrink-0 flex-col justify-between pb-5 text-[10px] tabular-nums text-fox-muted">{Array.from({ length: 5 }, (_, index) => <span key={index}>{index === 0 ? compact(maximum) : compact(maximum * ((4 - index) / 4))}</span>)}</div>
              <div className="min-w-0 flex-1">
                <svg role="img" aria-label={`Grafik penjualan ${periods.find((item) => item.value === period)?.label.toLowerCase()} sebesar ${money(data.summary.sales, data.currency)}`} viewBox="0 0 500 150" preserveAspectRatio="none" className="h-40 w-full overflow-visible">
                  <defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1689ED" stopOpacity=".3"/><stop offset="1" stopColor="#1689ED" stopOpacity=".025"/></linearGradient></defs>
                  {[0, 37.5, 75, 112.5, 150].map((y) => <line key={y} x1="0" x2="500" y1={y} y2={y} stroke="#E3EDF4" strokeDasharray="3 4"/>)}
                  <path d={area} fill="url(#sales-fill)"/>
                  <path d={line} fill="none" stroke="#1689ED" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
                </svg>
                <div className="mt-3 flex justify-between gap-1 text-[10px] text-fox-muted">{ticks.map((index) => <span key={data.series[index].key}>{data.series[index].label}</span>)}</div>
              </div>
            </div>
            <p className="mt-3 text-xs text-fox-secondary">Total {count(data.summary.transactions)} transaksi · {count(Number(data.summary.items), 1)} item · waktu server {data.timezone}.</p>
          </> : <p className="mt-3 text-sm text-fox-secondary">Grafik penjualan hanya tersedia untuk peran dengan izin POS.</p>}
        </Card>
        <Card className="flex flex-col items-center justify-center bg-fox-subtle p-5 text-center"><Image src="/foxi-mascot.png" alt="Foxi, maskot rubah FoxBiz" width={144} height={104} className="h-24 w-36 object-contain"/><h2 className="mt-2 text-lg font-bold">Terus semangat!</h2><p className="mt-2 max-w-[220px] text-xs leading-5 text-fox-secondary">Kelola bisnis dengan mudah bersama FoxBiz.</p><span className="mt-3 inline-flex items-center gap-1 text-xs text-fox-info"><ArrowUpRight size={15}/>Satu langkah untuk bisnis Anda</span></Card>
      </section>
      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(230px,1fr)]">
        <Card className="p-4 sm:p-5"><h2 className="text-sm font-bold">Akses Cepat</h2><div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">{quickAccess.map(({ label, href, icon: Icon }, index) => <Link href={href} key={label} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-transparent px-1 py-3 text-center text-xs text-fox-secondary hover:border-fox-border hover:bg-fox-subtle"><span className={`grid h-10 w-10 place-items-center rounded-lg ${index % 2 ? 'bg-teal-50 text-fox-success' : 'bg-fox-soft text-fox-info'}`}><Icon size={21} strokeWidth={1.6}/></span>{label}</Link>)}</div></Card>
        <Card className="p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">Tugas &amp; Peringatan {alertEntries.length > 0 && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-xs text-fox-danger">{alertEntries.length}</span>}</h2>
          {alertEntries.length ? <ul className="mt-3">{alertEntries.map(({ text, href }) => <li key={text}><Link href={href} className="flex min-h-11 items-center gap-2 text-xs text-fox-secondary hover:text-fox-info"><AlertTriangle size={14} className="shrink-0 text-fox-danger"/>{text}<ChevronRight size={14} className="ml-auto"/></Link></li>)}</ul> : <p className="mt-3 flex items-center gap-2 text-xs text-fox-secondary"><CheckCircle2 size={15} className="text-fox-success"/>Tidak ada peringatan yang perlu ditindaklanjuti.</p>}
          {data && <p className="mt-3 text-[11px] text-fox-muted">{data.capabilities.hris ? `${data.alerts.attendance.present} dari ${data.alerts.attendance.active} karyawan aktif sudah absen hari ini.` : 'Data absensi tersedia untuk peran dengan izin HRIS.'}</p>}
        </Card>
      </section>
    </>}
    <p className="mt-5 text-center text-xs text-fox-muted">FoxBiz · POS &amp; Business Management System</p>
  </>;
}
