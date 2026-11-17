'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Input, Modal, TableShell } from '@foxbiz/ui';
import { api, ApiError } from '../lib/api';
import { AppShell } from './app-shell';
import { useSession } from './session-provider';
import { Notice, PageTitle, Pager, PermissionDenied, selectClass } from './workspace-ui';

type Segment = 'never' | 'active' | 'attention' | 'inactive';
type Customer = {
  id: string; name: string; phone: string; email: string | null; notes: string; createdAt: string; updatedAt: string;
  saleCount: number; totalSpend: string; lastSaleAt: string | null; lastSaleDate: string | null; segment: Segment; segmentLabel: string;
};
type Summary = { total: number; never: number; active: number; attention: number; inactive: number };
type List = { items: Customer[]; total: number; summary: Summary; segments: { code: Segment; label: string }[]; timezone: string; currency: string };
type Sale = {
  id: string; receiptNo: string; subtotal: string; total: string; createdAt: string;
  outlet: { id: string; name: string }; cashier: { id: string; name: string };
  payment: { method: string; status: string } | null; _count: { items: number };
};
type Form = { name: string; phone: string; email: string; notes: string };
const emptyForm: Form = { name: '', phone: '', email: '', notes: '' };
const offline = 'Tidak dapat memuat data pelanggan. Periksa koneksi lalu coba lagi.';
const describe = (error: unknown, fallback = offline) => error instanceof ApiError ? error.message : fallback;
const segmentStyle: Record<Segment, string> = {
  never: 'bg-slate-100 text-slate-600', active: 'bg-teal-50 text-teal-700',
  attention: 'bg-amber-50 text-amber-700', inactive: 'bg-rose-50 text-rose-700',
};

export function CrmWorkspace() { return <AppShell><Crm/></AppShell>; }
function Crm() {
  const { can } = useSession(), allowed = can('crm.read'), writable = can('crm.customers.write');
  const [data, setData] = useState<List | null>(null), [search, setSearch] = useState(''), [segment, setSegment] = useState('');
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null), [form, setForm] = useState<Form>(emptyForm), [formError, setFormError] = useState(''), [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Customer | null>(null), [history, setHistory] = useState<Sale[]>([]), [historyTotal, setHistoryTotal] = useState(0), [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false), [profileError, setProfileError] = useState('');
  const profileRequest = useRef<AbortController | null>(null);
  useEffect(() => () => profileRequest.current?.abort(), []);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController(), query = new URLSearchParams({ page: String(page), search, segment });
    setLoading(true);
    api<List>(`crm/customers?${query}`, { signal: controller.signal })
      .then((result) => { setData(result); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(describe(err)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, page, search, segment, revision]);
  const money = (value: string) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: data?.currency ?? 'IDR', maximumFractionDigits: 2 }).format(Number(value));
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString('id-ID', { timeZone: data?.timezone ?? 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const moment = (value: string) => new Date(value).toLocaleString('id-ID', { timeZone: data?.timezone ?? 'Asia/Jakarta' });
  if (!allowed) return <PermissionDenied/>;
  function openCreate() { setForm(emptyForm); setFormError(''); setEditing('new'); }
  function closeProfile() { profileRequest.current?.abort(); setViewing(null); }
  function openEdit(customer: Customer) { setForm({ name: customer.name, phone: customer.phone, email: customer.email ?? '', notes: customer.notes }); setFormError(''); setEditing(customer); closeProfile(); }
  async function save() {
    if (form.name.trim().length < 2 || !/^\+?[0-9\s().-]{7,30}$/.test(form.phone.trim())) { setFormError('Isi nama minimal dua karakter dan nomor telepon 7–15 digit.'); return; }
    setBusy(true); setFormError('');
    try {
      const body = { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() || null, notes: form.notes.trim() };
      await api(editing === 'new' ? 'crm/customers' : `crm/customers/${(editing as Customer).id}`, { method: editing === 'new' ? 'POST' : 'PATCH', body });
      setEditing(null); setSuccess(editing === 'new' ? 'Pelanggan baru berhasil ditambahkan.' : 'Data pelanggan berhasil diperbarui.'); setPage(1); setRevision((value) => value + 1);
    } catch (err) { setFormError(describe(err)); }
    finally { setBusy(false); }
  }
  async function loadHistory(customer: Customer, nextPage = 1) {
    profileRequest.current?.abort();
    const controller = new AbortController(); profileRequest.current = controller;
    setHistoryLoading(true); setProfileError('');
    try {
      const [fresh, sales] = await Promise.all([
        api<Customer>(`crm/customers/${customer.id}`, { signal: controller.signal }),
        api<{ items: Sale[]; total: number }>(`crm/customers/${customer.id}/sales?page=${nextPage}`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setViewing(fresh); setHistory(sales.items); setHistoryTotal(sales.total); setHistoryPage(nextPage);
    } catch (err) { if (!controller.signal.aborted) setProfileError(describe(err)); }
    finally { if (!controller.signal.aborted) setHistoryLoading(false); }
  }
  function openProfile(customer: Customer) { setViewing(customer); setHistory([]); setHistoryTotal(0); setHistoryPage(1); void loadHistory(customer); }
  const summary = data?.summary;
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3"><PageTitle title="CRM Pelanggan" description="Data pelanggan, riwayat transaksi, dan segmentasi dasar berdasarkan pembelian lunas."/>{writable && <Button onClick={openCreate}>Tambah pelanggan</Button>}</div>
    {success && <Notice>{success}</Notice>}
    {error ? <><Notice error>{error}</Notice><Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>Coba lagi</Button></> : loading && !data ? <Notice>Memuat pelanggan...</Notice> : data && <>
      <div className="my-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {([
          ['total', 'Total pelanggan', 'Seluruh pelanggan bisnis'],
          ['active', 'Aktif', 'Transaksi ≤30 hari'],
          ['attention', 'Perlu perhatian', '31–90 hari'],
          ['inactive', 'Tidak aktif', '>90 hari'],
          ['never', 'Belum bertransaksi', 'Tanpa pembelian lunas'],
        ] as const).map(([key, title, help]) => <Card key={key} className={`min-w-0 p-5 ${key === 'active' ? 'border-teal-200 bg-teal-50' : ''}`}><h2 className="text-sm text-fox-secondary">{title}</h2><p className="mt-3 text-2xl font-bold tabular-nums" data-testid={`crm-${key}`}>{summary?.[key] ?? 0}</p><p className="mt-2 text-xs text-fox-secondary">{help}</p></Card>)}
      </div>
      <p className="mb-6 text-sm leading-6 text-fox-secondary">Segmen dihitung dari transaksi lunas pada outlet yang dapat Anda akses, mengikuti zona waktu bisnis {data.timezone}. Data kontak hanya untuk operasional bisnis.</p>
      <Card className="min-w-0 p-4 sm:p-6">
        <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]"><label className="text-sm font-medium">Cari pelanggan<Input className="mt-2" aria-label="Cari pelanggan" placeholder="Nama, nomor telepon, atau email..." maxLength={160} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}/></label><label className="text-sm font-medium">Segmen<select aria-label="Filter segmen" className={`${selectClass} mt-2`} value={segment} onChange={(event) => { setSegment(event.target.value); setPage(1); }}><option value="">Semua segmen</option>{data.segments.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label></div>
        {loading && <Notice>Memperbarui daftar pelanggan...</Notice>}
        <TableShell caption="Daftar pelanggan" columns={['Pelanggan', 'Segmen', 'Transaksi', 'Total belanja', 'Aksi']}>{data.items.map((customer) => <tr key={customer.id}>
          <td className="px-4 py-3"><b className="break-words">{customer.name}</b><span className="mt-1 block break-all text-xs text-fox-secondary">{customer.phone}{customer.email ? ` · ${customer.email}` : ''}</span></td>
          <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${segmentStyle[customer.segment]}`}>{customer.segmentLabel}</span></td>
          <td className="whitespace-nowrap px-4 py-3">{customer.saleCount}<span className="block text-xs text-fox-secondary">{customer.lastSaleDate ? date(customer.lastSaleAt) : 'Belum ada'}</span></td>
          <td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(customer.totalSpend)}</td>
          <td className="px-4 py-3"><div className="flex flex-wrap gap-1"><Button variant="ghost" onClick={() => openProfile(customer)}>Profil</Button>{writable && <Button variant="ghost" onClick={() => openEdit(customer)}>Ubah</Button>}</div></td>
        </tr>)}</TableShell>
        {!data.items.length && <Notice>Belum ada pelanggan yang cocok. {writable ? 'Tambahkan pelanggan untuk memulai.' : ''}</Notice>}
        <Pager page={page} total={data.total} setPage={setPage}/>
      </Card>
    </>}
    <Modal open={editing !== null} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }} title={editing === 'new' ? 'Tambah pelanggan' : 'Ubah pelanggan'} description="Nomor telepon wajib dan unik dalam bisnis ini. Email opsional.">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm font-medium">Nama pelanggan<Input aria-label="Nama pelanggan" className="mt-2" required minLength={2} maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>
          <label className="block text-sm font-medium">Nomor telepon<Input aria-label="Nomor telepon pelanggan" className="mt-2" required minLength={7} maxLength={30} inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}/></label>
          <label className="block text-sm font-medium">Email (opsional)<Input aria-label="Email pelanggan" className="mt-2" type="email" maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}/></label>
          <label className="block text-sm font-medium">Catatan (opsional)<Input aria-label="Catatan pelanggan" className="mt-2" maxLength={500} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })}/></label>
        </fieldset>
        <p className="text-xs text-fox-secondary">Pelanggan tidak dapat dihapus. Perbarui data bila terjadi perubahan kontak.</p>
        {formError && <Notice error>{formError}</Notice>}
        <Button type="submit" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan pelanggan'}</Button>
      </form>
    </Modal>
    <Modal open={viewing !== null} onOpenChange={(open) => { if (!open) closeProfile(); }} title={viewing?.name ?? 'Profil pelanggan'} description={viewing ? `${viewing.phone}${viewing.email ? ` · ${viewing.email}` : ''}` : ''}>
      {viewing && <>
        <div className="mb-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-fox-subtle p-4"><p className="text-xs text-fox-secondary">Segmen</p><p className="mt-2 text-sm font-semibold">{viewing.segmentLabel}</p></div><div className="rounded-xl bg-fox-subtle p-4"><p className="text-xs text-fox-secondary">Transaksi lunas</p><p className="mt-2 text-sm font-semibold">{viewing.saleCount} transaksi</p></div><div className="rounded-xl bg-fox-subtle p-4"><p className="text-xs text-fox-secondary">Total belanja</p><p className="mt-2 break-words text-sm font-semibold tabular-nums">{money(viewing.totalSpend)}</p></div></div>
        <div className="space-y-2 text-sm"><p><b>Terakhir bertransaksi:</b> {viewing.lastSaleDate ? date(viewing.lastSaleAt) : 'Belum ada transaksi lunas'}</p><p><b>Catatan:</b> {viewing.notes || '—'}</p><p><b>Terdaftar:</b> {moment(viewing.createdAt)}</p><p><b>Diperbarui:</b> {moment(viewing.updatedAt)}</p></div>
        <div className="my-5 flex flex-wrap gap-2">{writable && <Button variant="secondary" onClick={() => openEdit(viewing)}>Ubah data</Button>}{viewing.email && <a className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-fox-info underline" href={`mailto:${viewing.email}`}>Kirim email</a>}</div>
        <h3 className="text-lg font-semibold">Riwayat transaksi</h3>
        <p className="mb-3 mt-1 text-xs text-fox-secondary">Hanya transaksi lunas pada outlet yang dapat Anda akses.</p>
        {profileError && <><Notice error>{profileError}</Notice><Button variant="secondary" onClick={() => void loadHistory(viewing, historyPage)}>Coba lagi riwayat</Button></>}
        {historyLoading ? <Notice>Memuat riwayat transaksi...</Notice> : <><TableShell caption="Riwayat transaksi pelanggan" columns={['Struk / Tanggal', 'Outlet / Kasir', 'Pembayaran', 'Total']}>{history.map((sale) => <tr key={sale.id}><td className="px-4 py-3"><span className="block break-all text-xs">{sale.receiptNo}</span><span className="text-xs text-fox-secondary">{moment(sale.createdAt)}</span></td><td className="px-4 py-3">{sale.outlet.name}<span className="block text-xs text-fox-secondary">{sale.cashier.name} · {sale._count.items} item</span></td><td className="px-4 py-3"><Badge>{sale.payment?.method === 'edc' ? 'EDC' : 'Tunai'}</Badge></td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(sale.total)}</td></tr>)}</TableShell>{!history.length && <Notice>Belum ada transaksi lunas untuk pelanggan ini pada outlet yang dapat Anda akses.</Notice>}<Pager page={historyPage} total={historyTotal} setPage={(value) => void loadHistory(viewing, value)}/></>}
      </>}
    </Modal>
  </>;
}
