'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Input, Modal, TableShell } from '@foxbiz/ui';
import { api, ApiError } from '../lib/api';

export type Row = Record<string, unknown> & { id: string };
export type Field = { key: string; label: string; type?: string; required?: boolean; options?: { value: string; label: string }[]; min?: string; step?: string; pattern?: string; help?: string };
export function text(value: unknown): string { return value == null ? '—' : String(value); }
export const selectClass = 'h-11 w-full rounded-lg border border-fox-border bg-white px-3 text-sm';
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <p role={error ? 'alert' : 'status'} className={`my-4 rounded-lg p-3 text-sm ${error ? 'bg-rose-50 text-fox-danger' : 'bg-fox-soft text-fox-info'}`}>{children}</p>; }
export function PermissionDenied() { return <Card className="p-6"><h1 className="text-xl font-bold">Akses dibatasi</h1><p className="mt-3 text-sm text-fox-secondary">Hubungi pengelola bisnis untuk mendapatkan izin modul ini.</p></Card>; }
export function PageTitle({ title, description }: { title: string; description: string }) { return <div className="mb-6"><h1 className="text-2xl font-bold">{title}</h1><p className="mt-2 text-sm text-fox-secondary">{description}</p></div>; }
export function Pager({ page, total, setPage }: { page: number; total: number; setPage: (page: number) => void }) { return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><span>{total} data · Halaman {page}</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button><Button variant="secondary" disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>Berikutnya</Button></div></div>; }

export function ResourcePanel({ title, endpoint, fields, columns, writable, paginated = false, searchable = false, defaults = {}, transform = (value) => value, onSaved }: {
  title: string; endpoint: string; fields: Field[]; columns: { label: string; render: (row: Row) => ReactNode }[]; writable: boolean; paginated?: boolean; searchable?: boolean;
  defaults?: Record<string, unknown>; transform?: (value: Record<string, unknown>) => unknown; onSaved?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<Row | 'new' | null>(null), [values, setValues] = useState<Record<string, unknown>>({}), [busy, setBusy] = useState(false), [formError, setFormError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<Row[] | { items: Row[]; total: number }>(`${endpoint}?page=${page}&search=${encodeURIComponent(search)}`, { signal: controller.signal })
      .then((data) => { setRows(Array.isArray(data) ? data : data.items); setTotal(Array.isArray(data) ? data.length : data.total); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof ApiError && err.status === 403 ? 'Anda tidak memiliki akses ke data ini.' : err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, page, search, revision]);
  function edit(row: Row | 'new') { setValues(row === 'new' ? defaults : { ...row, outletIds: Array.isArray(row.outlets) ? (row.outlets as { outletId: string }[]).map((item) => item.outletId) : [], password: '' }); setEditing(row); setFormError(''); }
  async function save() {
    setBusy(true); setFormError('');
    try { await api(`${endpoint}${editing === 'new' ? '' : `/${(editing as Row).id}`}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: transform(Object.fromEntries(fields.map((field) => [field.key, values[field.key] ?? (field.type === 'checkbox' ? false : field.type === 'multiselect' ? [] : '')]))) }); setEditing(null); setSuccess('Perubahan berhasil disimpan.'); setRevision((value) => value + 1); onSaved?.(); }
    catch (err) { setFormError((err as Error).message); } finally { setBusy(false); }
  }
  return <Card className="min-w-0 p-4 sm:p-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2>{writable && <Button onClick={() => edit('new')}>Tambah {title.toLowerCase()}</Button>}</div>{searchable && <Input aria-label={`Cari ${title.toLowerCase()}`} placeholder="Cari nama, SKU, atau barcode..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}/>} {success && <Notice>{success}</Notice>}{error ? <><Notice error>{error}</Notice><Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>Coba lagi</Button></> : loading ? <Notice>Memuat data...</Notice> : <><TableShell caption={title} columns={[...columns.map((column) => column.label), ...(writable ? ['Aksi'] : [])]}>{rows.map((row) => <tr key={row.id}>{columns.map((column) => <td className="px-4 py-3" key={column.label}>{column.render(row)}</td>)}{writable && <td className="px-4 py-3"><Button variant="ghost" aria-label={`Ubah ${text(row.name)}`} onClick={() => edit(row)}>Ubah</Button></td>}</tr>)}</TableShell>{!rows.length && <Notice>Belum ada data yang cocok. {writable ? 'Tambahkan data untuk memulai.' : ''}</Notice>}{paginated && <Pager page={page} total={total} setPage={setPage}/>}</>}
    <Modal open={editing !== null} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }} title={`${editing === 'new' ? 'Tambah' : 'Ubah'} ${title.toLowerCase()}`} description="Periksa data sebelum menyimpan.">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="space-y-4">{fields.map((field) => <ResourceField key={field.key} field={field} value={values[field.key]} creating={editing === 'new'} onChange={(value) => setValues({ ...values, [field.key]: value })}/>)}</fieldset>
        {formError && <Notice error>{formError}</Notice>}<Button disabled={busy} type="submit">{busy ? 'Menyimpan...' : 'Simpan'}</Button>
      </form>
    </Modal>
  </Card>;
}

function ResourceField({ field, value, creating, onChange }: { field: Field; value: unknown; creating: boolean; onChange: (value: unknown) => void }) {
  const id = `resource-${field.key}`;
  const describedBy = field.help ? `${id}-help` : undefined;
  return <div className="text-sm font-medium">
    {field.type === 'multiselect' ? <fieldset className="rounded-lg border border-fox-border p-3"><legend>{field.label}</legend>{field.options?.map((option) => <label key={option.value} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={(value as string[] ?? []).includes(option.value)} onChange={(event) => { const selected = value as string[] ?? []; onChange(event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value)); }}/>{option.label}</label>)}</fieldset>
      : field.type === 'checkbox' ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5"/>{field.label}</label>
      : <><label htmlFor={id}>{field.label}</label>{field.options ? <select id={id} aria-describedby={describedBy} required={field.required} className={`${selectClass} mt-2`} value={text(value ?? '')} onChange={(event) => onChange(event.target.value)}>{!field.required && <option value="">Tanpa pilihan</option>}{field.required && <option value="" disabled>Pilih...</option>}{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <Input id={id} aria-describedby={describedBy} className="mt-2" type={field.type ?? 'text'} value={text(value ?? '')} required={field.key === 'password' ? creating : field.required} minLength={field.key === 'password' ? 12 : undefined} autoComplete={field.key === 'password' ? 'new-password' : undefined} min={field.min} step={field.step} pattern={field.pattern} onChange={(event) => onChange(event.target.value)}/>}</>}
    {field.help && <p id={describedBy} className="mt-1 text-xs font-normal text-fox-secondary">{field.help}</p>}
  </div>;
}
