'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Input, Modal, TableShell } from '@foxbiz/ui';
import { api, ApiError } from '../lib/api';
import { AppShell } from './app-shell';
import { useSession } from './session-provider';
import { Notice, PageTitle, Pager, PermissionDenied, selectClass } from './workspace-ui';

type Category = { code: string; kind: string; label: string };
type Metadata = { today: string; timezone: string; currency: string; categories: Category[] };
type Entry = { id: string; kind: string; category: string; amount: string; businessDate: string; note: string; status: string; createdAt: string; creator: { name: string }; voidReason: string | null; voidedAt: string | null; voider: { name: string } | null };
type Amounts = { cashSales: string; edcSales: string; manualIncome: string; manualExpense: string; netCash: string };
type Report = { summary: Amounts & { cashSaleCount: number; edcSaleCount: number }; daily: (Amounts & { day: string })[]; categories: { kind: string; category: string; amount: string; count: number }[]; timezone: string; currency: string };
type Pending = { idempotencyKey: string; outletId: string; kind: string; category: string; amount: string; businessDate: string; note: string };
const offlineMessage = 'Respons tidak diterima. Periksa koneksi lalu coba lagi.';
const pendingOfflineMessage = 'Respons tidak diterima. Entri mungkin sudah tersimpan; periksa status sebelum mengirim ulang.';
const describe = (error: unknown, fallback = offlineMessage) => error instanceof ApiError ? error.message : fallback;

export function FinanceWorkspace() { return <AppShell><OutletFinance/></AppShell>; }
function OutletFinance() { const { outletId } = useSession(); return <Finance key={outletId}/>; }
function Finance() {
  const { outletId, outlets, user, can } = useSession(), allowed = can('finance.read');
  const [meta, setMeta] = useState<Metadata | null>(null), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null), [report, setReport] = useState<Report | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [kindFilter, setKindFilter] = useState(''), [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [success, setSuccess] = useState(''), [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false), [kind, setKind] = useState('expense'), [category, setCategory] = useState('operational'), [amount, setAmount] = useState(''), [businessDate, setBusinessDate] = useState(''), [note, setNote] = useState('');
  const [voiding, setVoiding] = useState<Entry | null>(null), [reason, setReason] = useState(''), [formError, setFormError] = useState(''), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null), [pendingError, setPendingError] = useState('');
  const storage = `foxbiz-finance-pending:${user.id}:${outletId}`;
  useEffect(() => {
    if (!allowed || !outletId) return;
    const controller = new AbortController();
    api<Metadata>('finance/metadata', { signal: controller.signal }).then((data) => { setMeta(data); const start = `${data.today.slice(0, 7)}-01`; setFrom((value) => value || start); setTo((value) => value || data.today); setPeriod((value) => value ?? { from: start, to: data.today }); }).catch((err) => { if (!controller.signal.aborted) { setError(describe(err, 'Tidak dapat memuat data keuangan. Periksa koneksi lalu coba lagi.')); setLoading(false); } });
    return () => controller.abort();
  }, [allowed, outletId, revision]);
  useEffect(() => { try { const raw = sessionStorage.getItem(storage); setPending(raw ? JSON.parse(raw) as Pending : null); } catch { setPendingError('Pemeriksaan entri tersimpan tidak dapat dibaca.'); } }, [storage]);
  useEffect(() => {
    if (!allowed || !outletId || !period) return;
    const controller = new AbortController(); setLoading(true);
    const query = new URLSearchParams({ outletId, ...period });
    Promise.all([api<Report>(`finance/report?${query}`, { signal: controller.signal }), api<{ items: Entry[]; total: number }>(`finance/entries?${query}&page=${page}&kind=${kindFilter}&status=${statusFilter}`, { signal: controller.signal })])
      .then(([data, list]) => { setReport(data); setEntries(list.items); setTotal(list.total); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(describe(err, 'Tidak dapat memuat data keuangan. Periksa koneksi lalu coba lagi.')); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, outletId, period, page, kindFilter, statusFilter, revision]);
  const money = (value: string) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: meta?.currency ?? 'IDR', maximumFractionDigits: 2 }).format(Number(value));
  const label = (code: string) => meta?.categories.find((entry) => entry.code === code)?.label ?? code;
  if (!allowed) return <PermissionDenied/>;
  if (!outletId) return <><PageTitle title="Keuangan" description="Kas tunai dan laporan dasar."/><Notice>Belum ada outlet aktif dalam akses Anda.</Notice></>;
  function clearPending() { sessionStorage.removeItem(storage); setPending(null); setPendingError(''); }
  function completed() { clearPending(); setEditing(false); setPage(1); setSuccess('Entri kas berhasil dicatat. Periksa periode bila tanggal entri berada di luar filter.'); setPeriod(period ? { ...period } : null); }
  async function post(value: Pending) {
    setBusy(true); setFormError(''); setPendingError('');
    try { sessionStorage.setItem(storage, JSON.stringify(value)); }
    catch { setFormError('Aktifkan penyimpanan browser agar entri dapat diperiksa saat koneksi terputus.'); setBusy(false); return; }
    setPending(value);
    try { await api('finance/entries', { method: 'POST', body: value }); completed(); }
    catch (err) {
      if (err instanceof ApiError && [400, 403, 404, 422].includes(err.status)) { clearPending(); setFormError(err.message); }
      else setPendingError(describe(err, pendingOfflineMessage));
    } finally { setBusy(false); }
  }
  async function checkPending() {
    if (!pending) return;
    setBusy(true); setPendingError('');
    try { await api(`finance/entries/by-key/${pending.idempotencyKey}?outletId=${outletId}`); completed(); }
    catch (err) { setPendingError(err instanceof ApiError && err.status === 404 ? 'Entri belum ditemukan. Kirim ulang data yang sama atau periksa riwayat.' : describe(err)); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || note.trim().length < 3) { setFormError('Isi nominal positif hingga dua desimal dan catatan minimal tiga karakter.'); return; }
    await post({ idempotencyKey: crypto.randomUUID(), outletId, kind, category, amount, businessDate, note });
  }
  async function confirmVoid() {
    if (!voiding) return;
    setBusy(true); setFormError('');
    try { await api(`finance/entries/${voiding.id}/void`, { method: 'POST', body: { outletId, reason } }); setVoiding(null); setSuccess('Entri di-void. Nilainya dikeluarkan dari laporan periode asal.'); setPeriod(period ? { ...period } : null); }
    catch (err) { setFormError(describe(err)); }
    finally { setBusy(false); }
  }
  const pendingPanel = pending && <div className="my-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold">Entri kas belum terkonfirmasi</p><p className="mt-2">Periksa status atau kirim ulang data yang sama agar kas tidak tercatat ganda.</p>{pendingError && <Notice error>{pendingError}</Notice>}<div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void checkPending()}>Periksa status</Button>{can('finance.entries.write') && <Button disabled={busy} onClick={() => void post(pending)}>Kirim ulang</Button>}<Button variant="ghost" disabled={busy} onClick={clearPending}>Tutup pemeriksaan</Button></div><p className="mt-2 text-xs">Menutup pemeriksaan tidak membatalkan entri yang sudah tersimpan. Periksa riwayat sebelum membuat entri baru.</p></div>;
  return <><PageTitle title="Keuangan" description={`Ringkasan kas · ${outlets.find((outlet) => outlet.id === outletId)?.name ?? ''}`}/>
    <Card className="p-4 sm:p-6"><form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setPage(1); setPeriod({ from, to }); }}><label className="min-w-0 text-sm font-medium">Dari tanggal<Input aria-label="Dari tanggal" type="date" min="2000-01-01" max="2100-12-31" required value={from} onChange={(event) => setFrom(event.target.value)} className="mt-2"/></label><label className="min-w-0 text-sm font-medium">Sampai tanggal<Input aria-label="Sampai tanggal" type="date" min={from || '2000-01-01'} max="2100-12-31" required value={to} onChange={(event) => setTo(event.target.value)} className="mt-2"/></label><Button type="submit" disabled={!meta}>Terapkan periode</Button></form><p className="mt-3 text-xs text-fox-secondary">Maksimal 366 hari · Zona waktu bisnis: {meta?.timezone ?? 'memuat...'}. Penjualan POS tercatat otomatis; jangan dicatat ulang sebagai pemasukan manual.</p></Card>
    {success && <Notice>{success}</Notice>}{!editing && pendingPanel}{!pending && pendingError && <Notice error>{pendingError}</Notice>}
    {error ? <><Notice error>{error}</Notice><Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>Coba lagi</Button></> : loading ? <Notice>Memuat keuangan...</Notice> : report && <>
      <div className="my-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{([['cashSales', 'Penjualan tunai'], ['manualIncome', 'Pemasukan manual'], ['manualExpense', 'Pengeluaran tunai'], ['netCash', 'Arus kas bersih'], ['edcSales', 'Penjualan EDC']] as const).map(([field, title]) => <Card key={field} className={`min-w-0 p-5 ${field === 'netCash' ? 'border-teal-200 bg-teal-50' : ''}`}><h2 className="text-sm text-fox-secondary">{title}</h2><p className="mt-3 break-words text-xl font-bold tabular-nums" data-testid={field}>{money(report.summary[field])}</p><p className="mt-2 text-xs text-fox-secondary">{field === 'edcSales' ? `${report.summary.edcSaleCount} transaksi · non-tunai` : field === 'cashSales' ? `${report.summary.cashSaleCount} transaksi POS` : field === 'netCash' ? 'Tunai POS + pemasukan − pengeluaran' : 'Entri aktif dalam periode'}</p></Card>)}</div>
      <p className="mb-6 text-sm text-fox-secondary">Arus kas bersih adalah perubahan kas selama periode, belum termasuk saldo awal atau kas fisik laci. EDC tidak menambah kas tunai. Entri void dikecualikan dari seluruh ringkasan.</p>
      <Card className="min-w-0 p-4 sm:p-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Entri kas manual</h2>{can('finance.entries.write') && <Button disabled={Boolean(pending) || !meta} onClick={() => { setEditing(true); setKind('expense'); setCategory('operational'); setAmount(''); setBusinessDate(meta?.today ?? ''); setNote(''); setFormError(''); }}>Catat kas</Button>}</div><div className="mb-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Jenis entri<select aria-label="Filter jenis entri" className={`${selectClass} mt-2`} value={kindFilter} onChange={(event) => { setKindFilter(event.target.value); setPage(1); }}><option value="">Semua jenis</option><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option></select></label><label className="text-sm font-medium">Status entri<select aria-label="Filter status entri" className={`${selectClass} mt-2`} value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="">Semua status</option><option value="posted">Aktif</option><option value="voided">Void</option></select></label></div><TableShell caption="Entri kas manual" columns={['Tanggal / Pencatat', 'Jenis / Kategori', 'Nominal', 'Catatan', 'Status / Aksi']}>{entries.map((entry) => <tr key={entry.id}><td className="whitespace-nowrap px-4 py-3">{entry.businessDate.slice(0, 10)}<span className="block text-xs text-fox-secondary">{entry.creator.name}</span></td><td className="px-4 py-3"><Badge>{entry.kind === 'income' ? 'Pemasukan' : 'Pengeluaran'}</Badge><span className="mt-1 block text-xs text-fox-secondary">{label(entry.category)}</span></td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(entry.amount)}</td><td className="max-w-80 break-words px-4 py-3">{entry.note}{entry.voidReason && <p className="mt-2 text-xs text-fox-danger">Alasan void: {entry.voidReason} · {entry.voider?.name}</p>}</td><td className="px-4 py-3"><Badge>{entry.status === 'posted' ? 'Aktif' : 'Void'}</Badge>{entry.status === 'posted' && can('finance.void') && <Button className="mt-2" variant="ghost" onClick={() => { setVoiding(entry); setReason(''); setFormError(''); }}>Void</Button>}</td></tr>)}</TableShell>{!entries.length && <Notice>Belum ada entri kas yang cocok pada outlet dan periode ini.</Notice>}<Pager page={page} total={total} setPage={setPage}/></Card>
      <Card className="mt-6 min-w-0 p-4 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Laporan harian</h2><TableShell caption="Laporan kas harian" columns={['Tanggal', 'POS tunai', 'Pemasukan', 'Pengeluaran', 'Arus kas bersih', 'EDC (non-tunai)']}>{report.daily.map((day) => <tr key={day.day}><td className="whitespace-nowrap px-4 py-3">{day.day}</td>{(['cashSales', 'manualIncome', 'manualExpense', 'netCash', 'edcSales'] as const).map((field) => <td className="whitespace-nowrap px-4 py-3 tabular-nums" key={field}>{money(day[field])}</td>)}</tr>)}</TableShell></Card>
      <Card className="mt-6 min-w-0 p-4 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Kas manual per kategori</h2><TableShell caption="Laporan kategori kas" columns={['Kategori', 'Jenis', 'Jumlah entri', 'Nominal']}>{report.categories.map((entry) => <tr key={entry.category}><td className="px-4 py-3">{label(entry.category)}</td><td className="px-4 py-3">{entry.kind === 'income' ? 'Pemasukan' : 'Pengeluaran'}</td><td className="px-4 py-3">{entry.count}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(entry.amount)}</td></tr>)}</TableShell>{!report.categories.length && <Notice>Belum ada entri aktif untuk laporan kategori.</Notice>}</Card>
    </>}
    <Modal open={editing} onOpenChange={(open) => { if (!busy) setEditing(open); }} title="Catat kas tunai" description="Pemasukan atau pengeluaran di luar penjualan POS.">{pending ? pendingPanel : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}><fieldset disabled={busy} className="space-y-4"><label className="block text-sm font-medium">Jenis kas<select aria-label="Jenis kas" className={`${selectClass} mt-2`} value={kind} onChange={(event) => { setKind(event.target.value); setCategory(event.target.value === 'income' ? 'owner_funding' : 'operational'); }}><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></select></label><label className="block text-sm font-medium">Kategori kas<select aria-label="Kategori kas" className={`${selectClass} mt-2`} value={category} onChange={(event) => setCategory(event.target.value)}>{meta?.categories.filter((entry) => entry.kind === kind).map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}</select></label><label className="block text-sm font-medium">Nominal (Rp)<Input aria-label="Nominal kas" className="mt-2" type="number" min="0.01" max="999999999999.99" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)}/></label><label className="block text-sm font-medium">Tanggal kas<Input aria-label="Tanggal kas" className="mt-2" type="date" min="2000-01-01" max="2100-12-31" required value={businessDate} onChange={(event) => setBusinessDate(event.target.value)}/></label><label className="block text-sm font-medium">Catatan kas<Input aria-label="Catatan kas" className="mt-2" minLength={3} maxLength={200} required value={note} onChange={(event) => setNote(event.target.value)}/></label></fieldset><p className="text-xs text-fox-secondary">Entri tersimpan tidak dapat diedit. Gunakan void dengan alasan untuk koreksi.</p>{formError && <Notice error>{formError}</Notice>}<Button type="submit" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan kas'}</Button></form>}</Modal>
    <Modal open={voiding !== null} onOpenChange={(open) => { if (!open && !busy) setVoiding(null); }} title="Void entri kas" description={voiding ? `${voiding.note} · ${money(voiding.amount)}` : ''}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void confirmVoid(); }}><Notice>Void mengeluarkan nilai dari laporan periode asal. Riwayat dan alasan tetap tersimpan.</Notice><label className="block text-sm font-medium">Alasan void<Input aria-label="Alasan void" className="mt-2" minLength={3} maxLength={200} required disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)}/></label>{formError && <Notice error>{formError}</Notice>}<Button type="submit" disabled={busy}>{busy ? 'Memproses...' : 'Konfirmasi void'}</Button></form></Modal>
  </>;
}
