'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Badge, Button, Card, Input, Modal, TableShell } from '@foxbiz/ui';
import { Camera, CheckCircle2, Clock3, Download, MapPin, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { api, apiUpload, ApiError } from '../lib/api';
import { AppShell } from './app-shell';
import { useSession } from './session-provider';
import { Notice, PageTitle, Pager, PermissionDenied, selectClass } from './workspace-ui';

type Employee = {
  id: string; code: string; name: string; position: string; phone: string; status: string;
  allOutlets: boolean; hasPin: boolean; createdAt: string; outlets: { outletId: string }[];
};
type KioskEmployee = Employee & {
  status: 'not_started' | 'working' | 'done';
  attendance: { id: string; clockInAt: string; clockOutAt: string | null; outletId: string } | null;
};
type KioskData = { today: string; timezone: string; outletId: string; employees: KioskEmployee[] };
type Attendance = {
  id: string; employeeId: string; outletId: string; workDate: string; clockInAt: string; clockOutAt: string | null;
  employee: { id: string; name: string; code: string };
  clockInLatitude: number | null; clockInLongitude: number | null; clockInAccuracy: number | null;
  clockOutLatitude: number | null; clockOutLongitude: number | null; clockOutAccuracy: number | null;
  duration: string; photoIn: boolean; photoOut: boolean;
};
type DailyData = { items: Attendance[]; total: number; absent: { id: string; name: string; code: string }[]; timezone: string; from: string; to: string };
type MonthlyRow = { employee: { id: string; name: string; code: string }; days: number; minutes: number; firstIn: string | null; lastOut: string | null; open: number };
type MonthlyData = { rows: MonthlyRow[]; timezone: string; from: string; to: string };
type Location = { latitude: number; longitude: number; accuracy: number };
type Tab = 'kiosk' | 'employees' | 'recap';

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function formatDate(value: string | null, timezone: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function formatTime(value: string | null, timezone: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
}
function km(value: number) { return value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`; }
function coordinates(latitude: number | null, longitude: number | null) {
  return latitude === null || longitude === null ? '—' : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export function HrisWorkspace() { return <AppShell><Hris/></AppShell>; }

function Hris() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('kiosk');
  if (!can('hris.read')) return <PermissionDenied/>;
  const tabs: { code: Tab; label: string; show: boolean }[] = [
    { code: 'kiosk', label: 'Kiosk Absensi', show: can('hris.attendance.kiosk') },
    { code: 'employees', label: 'Karyawan', show: true },
    { code: 'recap', label: 'Rekap & Ekspor', show: true },
  ];
  const visible = tabs.filter((item) => item.show);
  const active = visible.some((item) => item.code === tab) ? tab : 'employees';
  return <>
    <PageTitle title="HRIS & Absensi" description="Satu akun pengelola untuk banyak karyawan. Karyawan memilih namanya di kiosk, memasukkan PIN 6 digit, lalu mengambil foto masuk atau pulang. Foto diberi watermark server dan disimpan 180 hari."/>
    <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Bagian HRIS">
      {visible.map((item) => <Button key={item.code} role="tab" aria-selected={active === item.code} variant={active === item.code ? 'primary' : 'secondary'} onClick={() => setTab(item.code)}>{item.label}</Button>)}
    </div>
    {active === 'kiosk' && <KioskPanel/>}
    {active === 'employees' && <EmployeePanel/>}
    {active === 'recap' && <RecapPanel/>}
  </>;
}

function KioskPanel() {
  const { outletId, outlets } = useSession();
  const [data, setData] = useState<KioskData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<KioskEmployee | null>(null);
  const outlet = outlets.find((item) => item.id === outletId);
  useEffect(() => {
    if (!outletId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    api<KioskData>(`hris/kiosk?outletId=${outletId}`, { signal: controller.signal })
      .then((result) => { setData(result); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof ApiError && err.status === 403 ? 'Anda tidak memiliki akses kiosk untuk outlet ini.' : err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [outletId, revision]);
  if (!outletId) return <Notice error>Belum ada outlet yang dapat diakses. Tambahkan outlet terlebih dahulu di Pengaturan.</Notice>;
  const working = data?.employees.filter((employee) => employee.status === 'working').length ?? 0;
  const done = data?.employees.filter((employee) => employee.status === 'done').length ?? 0;
  return <>
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">Kiosk {outlet?.name ?? 'outlet'}</h2><Badge>{data?.today ?? today()}</Badge></div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-fox-secondary">Pilih nama karyawan, masukkan PIN, dan ambil foto. Satu perangkat kiosk dapat dipakai bergantian oleh seluruh karyawan outlet ini.</p>
        </div>
        <Button variant="secondary" onClick={() => setRevision((value) => value + 1)} disabled={loading}><RefreshCw size={16}/>Muat ulang</Button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-fox-subtle p-3"><p className="text-xs text-fox-secondary">Karyawan aktif</p><p className="mt-1 text-xl font-bold">{data?.employees.length ?? 0}</p></div>
        <div className="rounded-lg bg-[#FFF7E6] p-3"><p className="text-xs text-fox-secondary">Sedang bekerja</p><p className="mt-1 text-xl font-bold">{working}</p></div>
        <div className="rounded-lg bg-[#E7F7EF] p-3"><p className="text-xs text-fox-secondary">Sudah pulang</p><p className="mt-1 text-xl font-bold">{done}</p></div>
      </div>
    </Card>
    {error && <Notice error>{error}</Notice>}
    {loading && !data ? <Notice>Memuat karyawan kiosk...</Notice> : data && <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.employees.map((employee) => <EmployeeCard key={employee.id} employee={employee} onClick={() => setSelected(employee)}/>)}
      </div>
      {!data.employees.length && <Notice>Belum ada karyawan aktif untuk outlet ini. Tambahkan karyawan dan aktifkan akses seluruh outlet atau outlet ini.</Notice>}
    </>}
    {selected && <AttendanceModal employee={selected} outletId={outletId} timezone={data?.timezone ?? 'Asia/Jakarta'} onClose={() => setSelected(null)} onSaved={() => setRevision((value) => value + 1)}/>}
  </>;
}

function EmployeeCard({ employee, onClick }: { employee: KioskEmployee; onClick: () => void }) {
  const disabled = employee.status === 'done' || !employee.hasPin;
  const status = employee.status === 'working' ? 'Sedang bekerja' : employee.status === 'done' ? 'Sudah pulang' : 'Belum absen';
  const badge = employee.status === 'working' ? 'bg-[#FFF7E6] text-[#9A6700]' : employee.status === 'done' ? 'bg-[#E7F7EF] text-fox-success' : '';
  return <button type="button" onClick={onClick} disabled={disabled} className="flex min-h-24 items-center gap-3 rounded-xl border border-fox-border bg-white p-4 text-left shadow-card transition hover:border-fox-blue disabled:cursor-not-allowed disabled:opacity-60">
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-fox-soft text-lg font-bold text-fox-info">{employee.name.slice(0, 1).toUpperCase()}</span>
    <span className="min-w-0 flex-1">
      <span className="block truncate font-semibold">{employee.name}</span>
      <span className="mt-0.5 block truncate text-xs text-fox-secondary">{employee.code}{employee.position ? ` · ${employee.position}` : ''}</span>
      <span className="mt-2 flex flex-wrap items-center gap-2"><Badge className={badge}>{status}</Badge>{!employee.hasPin && <Badge className="bg-rose-50 text-fox-danger">PIN belum diatur</Badge>}{employee.status !== 'not_started' && employee.attendance && <span className="text-[11px] text-fox-secondary">Masuk {new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(employee.attendance.clockInAt))}</span>}</span>
    </span>
  </button>;
}

function AttendanceModal({ employee, outletId, timezone, onClose, onSaved }: { employee: KioskEmployee; outletId: string; timezone: string; onClose: () => void; onSaved: () => void }) {
  const kind = employee.status === 'working' ? 'out' : 'in';
  const [pin, setPin] = useState('');
  const [location, setLocation] = useState<Location | null>(null);
  const [gpsError, setGpsError] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [captured, setCaptured] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Attendance | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const locate = useCallback(() => {
    if (!navigator.geolocation) { setGpsError('Perangkat ini tidak mendukung GPS. Absen tetap dapat dikirim tanpa lokasi.'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }); setGpsError(''); setGpsLoading(false); },
      (reason) => { setGpsError(reason.code === reason.PERMISSION_DENIED ? 'Izin lokasi ditolak. Absen tetap dapat dikirim tanpa GPS.' : 'Lokasi belum didapat. Periksa sinyal atau coba lagi.'); setGpsLoading(false); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }, []);
  useEffect(() => {
    let active = true;
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kamera tidak didukung perangkat ini.');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
        setCameraReady(true);
      } catch { if (active) setCameraError('Kamera tidak dapat dibuka. Izinkan akses kamera atau unggah foto dari perangkat.'); }
    }
    void start();
    return () => { active = false; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
  }, []);
  useEffect(() => { locate(); }, [locate]);
  useEffect(() => {
    if (!captured) { setPreview(''); return; }
    const url = URL.createObjectURL(captured);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [captured]);
  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) { setError('Kamera belum siap. Tunggu sebentar atau unggah foto.'); return; }
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) { setError('Foto gagal diambil. Coba lagi.'); return; }
    setCaptured(blob);
    setError('');
  }
  function chooseFile(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Ukuran foto maksimal 5 MB.'); return; }
    setCaptured(file);
    setError('');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(pin)) { setError('Masukkan PIN 6 digit.'); return; }
    if (!captured) { setError('Ambil foto terlebih dahulu. Foto wajib untuk absen masuk dan pulang.'); return; }
    const form = new FormData();
    form.append('employeeId', employee.id);
    form.append('outletId', outletId);
    form.append('pin', pin);
    if (location) { form.append('latitude', String(location.latitude)); form.append('longitude', String(location.longitude)); form.append('accuracy', String(location.accuracy)); }
    form.append('photo', captured, 'absensi.jpg');
    setBusy(true);
    try {
      const record = await apiUpload<Attendance>(`hris/attendance/${kind === 'in' ? 'clock-in' : 'clock-out'}`, form);
      setResult(record);
      onSaved();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const title = kind === 'in' ? 'Absen Masuk' : 'Absen Pulang';
  return <Modal open onOpenChange={(open) => { if (!open && !busy) onClose(); }} title={`${title} · ${employee.name}`} description={`${employee.code}${employee.position ? ` · ${employee.position}` : ''}. Foto akan diberi watermark nama bisnis, outlet, karyawan, waktu server, ID absensi, dan GPS.`}>
    {result ? <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl bg-[#E7F7EF] p-4 text-sm text-fox-success"><CheckCircle2 size={22} className="mt-0.5 shrink-0"/><div><p className="font-semibold">{title} berhasil dicatat.</p><p className="mt-1">Waktu server {formatDate(kind === 'in' ? result.clockInAt : result.clockOutAt, timezone)} ({timezone}).</p></div></div>
      <div className="flex flex-wrap gap-2"><a className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-fox-action px-4 text-sm font-semibold text-white hover:brightness-90" href={`/api/v1/hris/attendance/${result.id}/photo/${kind}`} target="_blank" rel="noreferrer"><Camera size={16}/>Lihat foto</a><a className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-fox-border bg-white px-4 text-sm font-semibold text-fox-navy hover:bg-fox-subtle" href={`/api/v1/hris/attendance/${result.id}/photo/${kind}?download=1`}><Download size={16}/>Unduh JPG</a></div>
      <Button onClick={onClose}>Selesai</Button>
    </div> : <form className="space-y-5" onSubmit={submit}>
      <div className="rounded-xl border border-fox-border bg-fox-subtle p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Status hari ini</span><Badge>{employee.status === 'working' ? 'Sudah masuk, belum pulang' : 'Belum absen masuk'}</Badge></div>{employee.attendance && <p className="mt-2 text-xs text-fox-secondary">Masuk pukul {formatTime(employee.attendance.clockInAt, timezone)} WIB</p>}</div>
      <div>
        <p className="mb-2 text-sm font-medium">Foto absensi <span className="text-fox-danger">*</span></p>
        <div className="relative overflow-hidden rounded-xl bg-fox-navy">
          {preview ? <Image src={preview} alt={`Pratinjau foto absen ${employee.name}`} width={1280} height={960} unoptimized className="aspect-[4/3] w-full object-cover"/> : <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full scale-x-[-1] object-cover"/>}
          {!preview && !cameraError && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[11px] text-white">{cameraReady ? 'Kamera siap — arahkan wajah ke kamera' : 'Membuka kamera...'}</span>}
          {!preview && cameraError && <div className="grid aspect-[4/3] place-items-center p-5 text-center text-sm text-white">{cameraError}</div>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {preview ? <Button type="button" variant="secondary" onClick={() => { setCaptured(null); setError(''); }}>Ulangi foto</Button> : <Button type="button" variant="secondary" onClick={capture} disabled={!cameraReady}><Camera size={16}/>Ambil foto</Button>}
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-fox-border bg-white px-4 text-sm font-semibold text-fox-navy hover:bg-fox-subtle">Unggah foto<input type="file" accept="image/*" capture="user" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])}/></label>
        </div>
      </div>
      <div className="rounded-xl border border-fox-border p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 font-medium"><MapPin size={16}/>Lokasi GPS</span><Button type="button" variant="ghost" className="min-h-9 px-2 text-xs" onClick={locate} disabled={gpsLoading}><RefreshCw size={14}/>{gpsLoading ? 'Mencari...' : 'Perbarui'}</Button></div>
        {location ? <p className="mt-1 text-xs text-fox-secondary">{coordinates(location.latitude, location.longitude)} · akurasi ±{km(location.accuracy)}</p> : <p className="mt-1 text-xs text-fox-secondary">{gpsError || 'Meminta izin lokasi...'}</p>}
      </div>
      <div><label htmlFor="kiosk-pin" className="text-sm font-medium">PIN karyawan</label><Input id="kiosk-pin" className="mt-2" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="off" required value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 digit PIN"/><p className="mt-1 text-xs text-fox-secondary">PIN dipakai untuk memastikan absensi dilakukan oleh karyawan yang dipilih.</p></div>
      {error && <Notice error>{error}</Notice>}
      <Button type="submit" disabled={busy}>{busy ? 'Menyimpan absensi...' : kind === 'in' ? 'Simpan absen masuk' : 'Simpan absen pulang'}</Button>
    </form>}
  </Modal>;
}

function EmployeePanel() {
  const { can, outlets } = useSession();
  const writable = can('hris.employees.write');
  const [rows, setRows] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', code: '', position: '', phone: '', pin: '', status: 'active', allOutlets: true, outletIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<{ items: Employee[]; total: number }>(`hris/employees?search=${encodeURIComponent(search)}&page=${page}`, { signal: controller.signal })
      .then((result) => { setRows(result.items); setTotal(result.total); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, page, revision]);
  function open(row: Employee | 'new') {
    setEditing(row);
    setFormError('');
    setForm(row === 'new' ? { name: '', code: '', position: '', phone: '', pin: '', status: 'active', allOutlets: true, outletIds: [] } : { name: row.name, code: row.code, position: row.position, phone: row.phone, pin: '', status: row.status, allOutlets: row.allOutlets, outletIds: row.outlets.map((item) => item.outletId) });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setFormError('');
    try {
      await api(`hris/employees${editing === 'new' ? '' : `/${(editing as Employee).id}`}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: { ...form, code: form.code.toUpperCase(), pin: form.pin || undefined } });
      setEditing(null); setRevision((value) => value + 1);
    } catch (err) { setFormError((err as Error).message); } finally { setBusy(false); }
  }
  return <>
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Karyawan</h2><p className="mt-1 text-sm text-fox-secondary">Karyawan tidak memerlukan akun login. Mereka absen melalui kiosk dengan PIN masing-masing.</p></div>{writable && <Button onClick={() => open('new')}>Tambah karyawan</Button>}</div>
      <div className="mt-4"><Input aria-label="Cari karyawan" placeholder="Cari nama atau kode karyawan..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}/></div>
      {error && <Notice error>{error}</Notice>}
      {loading ? <Notice>Memuat karyawan...</Notice> : <>
        <div className="mt-4"><TableShell caption="Daftar karyawan" columns={['Karyawan', 'Kode', 'Akses outlet', 'PIN', 'Status', ...(writable ? ['Aksi'] : [])]}>
          {rows.map((row) => <tr key={row.id}>
            <td className="px-4 py-3"><b>{row.name}</b><span className="mt-1 block text-xs text-fox-secondary">{row.position || 'Tanpa jabatan'}{row.phone ? ` · ${row.phone}` : ''}</span></td>
            <td className="px-4 py-3">{row.code}</td>
            <td className="px-4 py-3">{row.allOutlets ? 'Seluruh outlet' : row.outlets.length ? row.outlets.map((item) => outlets.find((outlet) => outlet.id === item.outletId)?.name ?? 'Outlet').join(', ') : 'Belum ada outlet'}</td>
            <td className="px-4 py-3">{row.hasPin ? <Badge className="bg-[#E7F7EF] text-fox-success">Aktif</Badge> : <Badge className="bg-rose-50 text-fox-danger">Belum diatur</Badge>}</td>
            <td className="px-4 py-3">{row.status === 'active' ? 'Aktif' : 'Nonaktif'}</td>
            {writable && <td className="px-4 py-3"><Button variant="ghost" onClick={() => open(row)} aria-label={`Ubah ${row.name}`}>Ubah</Button></td>}
          </tr>)}
        </TableShell></div>
        {!rows.length && <Notice>Belum ada karyawan yang cocok.</Notice>}
        <Pager page={page} total={total} setPage={setPage}/>
      </>}
    </Card>
    <Modal open={editing !== null} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }} title={`${editing === 'new' ? 'Tambah' : 'Ubah'} karyawan`} description="PIN 6 digit dipakai karyawan saat absen di kiosk. Akses seluruh outlet otomatis mencakup outlet baru.">
      <form className="space-y-4" onSubmit={save}>
        <fieldset disabled={busy} className="space-y-4">
          <div><label htmlFor="employee-name" className="text-sm font-medium">Nama karyawan</label><Input id="employee-name" className="mt-2" required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></div>
          <div><label htmlFor="employee-code" className="text-sm font-medium">Kode karyawan</label><Input id="employee-code" className="mt-2" required pattern="[A-Za-z0-9_-]{1,30}" maxLength={30} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="Contoh: KSR01"/><p className="mt-1 text-xs text-fox-secondary">Unik per bisnis. Huruf kapital, angka, garis bawah, atau tanda hubung.</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="employee-position" className="text-sm font-medium">Jabatan</label><Input id="employee-position" className="mt-2" maxLength={80} value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} placeholder="Kasir, staf gudang..."/></div><div><label htmlFor="employee-phone" className="text-sm font-medium">Telepon</label><Input id="employee-phone" className="mt-2" maxLength={30} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}/></div></div>
          <div><label htmlFor="employee-pin" className="text-sm font-medium">PIN 6 digit {editing === 'new' ? <span className="text-fox-danger">*</span> : '(kosongkan jika tidak diubah)'}</label><Input id="employee-pin" className="mt-2" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} required={editing === 'new'} value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="6 digit angka"/></div>
          <div><label htmlFor="employee-status" className="text-sm font-medium">Status</label><select id="employee-status" className={selectClass + ' mt-2'} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-5 w-5" checked={form.allOutlets} onChange={(event) => setForm({ ...form, allOutlets: event.target.checked })}/>Akses seluruh outlet, termasuk outlet baru</label>
          {!form.allOutlets && <fieldset className="rounded-lg border border-fox-border p-3"><legend className="px-1 text-sm font-medium">Pilih outlet</legend>{outlets.map((outlet) => <label key={outlet.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={form.outletIds.includes(outlet.id)} onChange={(event) => setForm({ ...form, outletIds: event.target.checked ? [...form.outletIds, outlet.id] : form.outletIds.filter((id) => id !== outlet.id) })}/>{outlet.name}</label>)}{!outlets.length && <p className="text-xs text-fox-secondary">Belum ada outlet.</p>}</fieldset>}
        </fieldset>
        {formError && <Notice error>{formError}</Notice>}
        <Button type="submit" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan karyawan'}</Button>
      </form>
    </Modal>
  </>;
}

function RecapPanel() {
  const { outletId, outlets } = useSession();
  const [mode, setMode] = useState<'daily' | 'monthly'>('daily');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [page, setPage] = useState(1);
  const [daily, setDaily] = useState<DailyData | null>(null);
  const [monthly, setMonthly] = useState<MonthlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!outletId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const path = mode === 'daily'
      ? `hris/attendance?outletId=${outletId}&from=${from}&to=${to}&page=${page}`
      : `hris/attendance/monthly?outletId=${outletId}&from=${from}&to=${to}`;
    api<DailyData | MonthlyData>(path, { signal: controller.signal })
      .then((result) => { if (mode === 'daily') setDaily(result as DailyData); else setMonthly(result as MonthlyData); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [outletId, mode, from, to, page]);
  function switchMode(next: 'daily' | 'monthly') { setMode(next); setPage(1); if (next === 'monthly') { setFrom(`${today().slice(0, 8)}01`); setTo(today()); } else { setFrom(today()); setTo(today()); } }
  const timezone = daily?.timezone ?? monthly?.timezone ?? 'Asia/Jakarta';
  const exportUrl = `/api/v1/hris/attendance/export?outletId=${outletId}&from=${from}&to=${to}&mode=${mode}`;
  const outlet = outlets.find((item) => item.id === outletId);
  if (!outletId) return <Notice error>Belum ada outlet yang dapat diakses.</Notice>;
  return <>
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Rekap absensi</h2><p className="mt-1 text-sm text-fox-secondary">Rekap harian menampilkan setiap absensi dan karyawan yang belum absen. Rekap bulanan merangkum hari hadir dan total jam.</p></div><Button onClick={() => window.location.assign(exportUrl)} disabled={!from || !to}><Download size={16}/>Unduh PDF</Button></div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div><label htmlFor="recap-mode" className="text-xs font-medium text-fox-secondary">Jenis rekap</label><select id="recap-mode" className={selectClass + ' mt-1'} value={mode} onChange={(event) => switchMode(event.target.value as 'daily' | 'monthly')}><option value="daily">Harian</option><option value="monthly">Bulanan</option></select></div>
        <div><label htmlFor="recap-from" className="text-xs font-medium text-fox-secondary">Dari tanggal</label><Input id="recap-from" type="date" className="mt-1" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }}/></div>
        <div><label htmlFor="recap-to" className="text-xs font-medium text-fox-secondary">Sampai tanggal</label><Input id="recap-to" type="date" className="mt-1" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }}/></div>
        <Badge className="mb-1">{outlet?.name ?? 'Outlet'}</Badge>
      </div>
      {error && <Notice error>{error}</Notice>}
      {loading ? <Notice>Memuat rekap absensi...</Notice> : mode === 'daily' && daily ? <>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-fox-subtle p-3"><p className="text-xs text-fox-secondary">Total absensi periode</p><p className="mt-1 text-xl font-bold">{daily.total}</p></div>
          <div className="rounded-lg bg-[#FFF7E6] p-3"><p className="text-xs text-fox-secondary">Belum absen {daily.from === daily.to ? 'hari ini' : ''}</p><p className="mt-1 text-xl font-bold">{daily.absent.length}</p></div>
          <div className="rounded-lg bg-[#E7F7EF] p-3"><p className="text-xs text-fox-secondary">Zona waktu</p><p className="mt-1 text-sm font-bold">{daily.timezone}</p></div>
        </div>
        <div className="mt-4"><TableShell caption="Rekap absensi harian" columns={['Karyawan', 'Tanggal', 'Masuk', 'Pulang', 'Durasi', 'GPS masuk', 'Foto']}>
          {daily.items.map((row) => <tr key={row.id}>
            <td className="px-4 py-3"><b>{row.employee.name}</b><span className="mt-1 block text-xs text-fox-secondary">{row.employee.code}</span></td>
            <td className="px-4 py-3">{row.workDate}</td>
            <td className="px-4 py-3">{formatTime(row.clockInAt, timezone)}</td>
            <td className="px-4 py-3">{row.clockOutAt ? formatTime(row.clockOutAt, timezone) : <Badge className="bg-[#FFF7E6] text-[#9A6700]">Belum pulang</Badge>}</td>
            <td className="px-4 py-3">{row.duration}</td>
            <td className="px-4 py-3"><span className="block text-xs">{coordinates(row.clockInLatitude, row.clockInLongitude)}</span>{row.clockInAccuracy !== null && <span className="text-[11px] text-fox-secondary">±{km(row.clockInAccuracy)}</span>}</td>
            <td className="px-4 py-3"><span className="flex flex-wrap gap-2">{row.photoIn && <a className="text-xs font-semibold text-fox-info underline" href={`/api/v1/hris/attendance/${row.id}/photo/in`} target="_blank" rel="noreferrer">Masuk</a>}{row.photoOut && <a className="text-xs font-semibold text-fox-info underline" href={`/api/v1/hris/attendance/${row.id}/photo/out`} target="_blank" rel="noreferrer">Pulang</a>}{!row.photoIn && !row.photoOut && '—'}</span></td>
          </tr>)}
        </TableShell></div>
        {!daily.items.length && <Notice>Belum ada absensi pada periode ini.</Notice>}
        <Pager page={page} total={daily.total} setPage={setPage}/>
        <div className="mt-5 rounded-xl border border-fox-border p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Users size={16}/>Karyawan aktif yang belum absen {daily.from === daily.to ? 'pada tanggal ini' : ''}</h3>{daily.absent.length ? <ul className="mt-2 flex flex-wrap gap-2">{daily.absent.map((employee) => <li key={employee.id}><Badge>{employee.name} · {employee.code}</Badge></li>)}</ul> : <p className="mt-2 text-sm text-fox-secondary">{daily.from === daily.to ? 'Semua karyawan aktif sudah absen.' : 'Daftar ini hanya tersedia untuk rekap satu hari.'}</p>}</div>
      </> : mode === 'monthly' && monthly ? <>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-fox-subtle p-3"><p className="text-xs text-fox-secondary">Karyawan dalam rekap</p><p className="mt-1 text-xl font-bold">{monthly.rows.length}</p></div>
          <div className="rounded-lg bg-[#FFF7E6] p-3"><p className="text-xs text-fox-secondary">Total hari hadir</p><p className="mt-1 text-xl font-bold">{monthly.rows.reduce((sum, row) => sum + row.days, 0)}</p></div>
          <div className="rounded-lg bg-[#E7F7EF] p-3"><p className="text-xs text-fox-secondary">Total jam kerja</p><p className="mt-1 text-xl font-bold">{(monthly.rows.reduce((sum, row) => sum + row.minutes, 0) / 60).toFixed(1)} jam</p></div>
        </div>
        <div className="mt-4"><TableShell caption="Rekap absensi bulanan" columns={['Karyawan', 'Kode', 'Hari hadir', 'Total jam', 'Masuk pertama', 'Pulang terakhir', 'Belum pulang']}>
          {monthly.rows.map((row) => <tr key={row.employee.id}>
            <td className="px-4 py-3"><b>{row.employee.name}</b></td>
            <td className="px-4 py-3">{row.employee.code}</td>
            <td className="px-4 py-3">{row.days}</td>
            <td className="px-4 py-3">{(row.minutes / 60).toFixed(1)} jam</td>
            <td className="px-4 py-3">{formatDate(row.firstIn, timezone)}</td>
            <td className="px-4 py-3">{formatDate(row.lastOut, timezone)}</td>
            <td className="px-4 py-3">{row.open ? <Badge className="bg-[#FFF7E6] text-[#9A6700]">{row.open} absensi</Badge> : '—'}</td>
          </tr>)}
        </TableShell></div>
        {!monthly.rows.length && <Notice>Belum ada karyawan pada outlet ini.</Notice>}
      </> : null}
    </Card>
    <Card className="mt-5 p-4"><div className="flex items-start gap-3 text-sm text-fox-secondary"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-fox-info"/><p>Foto absensi disimpan maksimal 180 hari, lalu file foto dibersihkan otomatis. Metadata absensi tetap tersimpan untuk laporan. Unduh JPG melalui tautan foto atau tombol PDF untuk rekap.</p></div></Card>
    <div className="mt-3 flex items-center gap-2 text-xs text-fox-secondary"><Clock3 size={14}/>Waktu absensi memakai jam server, bukan jam perangkat kiosk.</div>
  </>;
}
