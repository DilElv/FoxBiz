'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AppShell } from './app-shell';
import { useSession } from './session-provider';
import { Field, Notice, PageTitle, PermissionDenied, ResourcePanel, Row, text } from './workspace-ui';

export const statusField: Field = { key: 'status', label: 'Status', required: true, options: [{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }] };
const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
export function CatalogWorkspace() { return <AppShell><Catalog/></AppShell>; }
function Catalog() {
  const { can } = useSession();
  const allowed = can('catalog.read');
  const [categories, setCategories] = useState<Row[]>([]), [revision, setRevision] = useState(0), [error, setError] = useState('');
  useEffect(() => { if (allowed) api<Row[]>('categories').then(setCategories).catch((err) => setError(err.message)); }, [allowed, revision]);
  if (!can('catalog.read')) return <PermissionDenied/>;
  return <><PageTitle title="Produk & Kategori" description="Kelola katalog bersama untuk seluruh outlet bisnis. Harga menggunakan Rupiah."/>{error && <Notice error>{error}</Notice>}<div className="space-y-6"><ResourcePanel title="Produk" endpoint="products" searchable paginated writable={can('catalog.write')} defaults={{ status: 'active', unit: 'pcs', sellingPrice: '0' }} fields={[
    { key: 'name', label: 'Nama produk', required: true }, { key: 'sku', label: 'SKU', required: true, pattern: '[A-Z0-9._\\-]{1,64}', help: 'Unik per bisnis. Gunakan huruf kapital, angka, titik, garis bawah, atau tanda hubung.' },
    { key: 'barcode', label: 'Barcode' }, { key: 'categoryId', label: 'Kategori', options: categories.filter((row) => row.status === 'active').map((row) => ({ value: row.id, label: text(row.name) })) },
    { key: 'unit', label: 'Satuan', required: true }, { key: 'sellingPrice', label: 'Harga jual (Rp)', type: 'number', min: '0', step: '0.01', required: true }, statusField,
  ]} transform={(values) => ({ ...values, barcode: values.barcode || undefined, categoryId: values.categoryId || undefined })} columns={[{ label: 'Produk', render: (row) => <><b>{text(row.name)}</b><span className="mt-1 block text-xs text-fox-secondary">{text(row.sku)} · {text(row.unit)}</span></> }, { label: 'Kategori', render: (row) => text((row.category as Row | null)?.name) }, { label: 'Harga jual', render: (row) => money.format(Number(row.sellingPrice)) }, { label: 'Status', render: (row) => row.status === 'active' ? 'Aktif' : 'Nonaktif' }]}/>
  <ResourcePanel title="Kategori" endpoint="categories" writable={can('catalog.write')} defaults={{ status: 'active' }} fields={[{ key: 'name', label: 'Nama kategori', required: true }, statusField]} columns={[{ label: 'Nama', render: (row) => text(row.name) }, { label: 'Status', render: (row) => row.status === 'active' ? 'Aktif' : 'Nonaktif' }]} onSaved={() => setRevision((value) => value + 1)}/></div></>;
}
