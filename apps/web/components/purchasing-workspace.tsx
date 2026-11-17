'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Input, Modal, TableShell } from '@foxbiz/ui';
import { api, ApiError } from '../lib/api';
import { AppShell } from './app-shell';
import { useSession } from './session-provider';
import { Notice, PageTitle, Pager, PermissionDenied, ResourcePanel, selectClass, text } from './workspace-ui';

type Product = { id: string; name: string; sku: string; unit: string };
type Supplier = { id: string; name: string; contact: string; status: string };
type Line = { productId: string; name: string; sku: string; unit: string; qtyOrdered: string; unitCost: string; qtyReceived?: string };
type Receipt = { id: string; stockDocumentId: string; receivedAt: string; note: string; externalReference: string; receiver: { name: string }; purchaseOrder: { id: string; poNo: string }; items: { productId: string; qtyReceived: string }[] };
type Order = { id: string; poNo: string; supplierId: string; supplierName: string; status: string; total: string; note: string; version: number; createdAt: string; cancelReason: string | null; items: Line[]; receipts: Receipt[] };
type Pending = { endpoint: 'purchase-orders' | 'goods-receipts'; body: { idempotencyKey: string; outletId: string; [key: string]: unknown } };
const labels: Record<string, string> = { draft: 'Draft', ordered: 'Dipesan', partially_received: 'Diterima sebagian', received: 'Selesai', cancelled: 'Dibatalkan' };
const money = (value: string) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 }).format(Number(value));

export function PurchasingWorkspace() { return <AppShell><OutletPurchasing/></AppShell>; }
function OutletPurchasing() { const { outletId } = useSession(); return <Purchasing key={outletId}/>; }

function Purchasing() {
  const { can, outletId, outlets, user } = useSession(), allowed = can('purchasing.read');
  const [orders, setOrders] = useState<Order[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [status, setStatus] = useState('');
  const [receipts, setReceipts] = useState<Receipt[]>([]), [receiptTotal, setReceiptTotal] = useState(0), [receiptPage, setReceiptPage] = useState(1);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<Order | 'new' | null>(null), [supplierId, setSupplierId] = useState(''), [supplierSearch, setSupplierSearch] = useState(''), [suppliers, setSuppliers] = useState<Supplier[]>([]), [supplierPage, setSupplierPage] = useState(1), [supplierTotal, setSupplierTotal] = useState(0);
  const [products, setProducts] = useState<Product[]>([]), [productSearch, setProductSearch] = useState(''), [productPage, setProductPage] = useState(1), [productTotal, setProductTotal] = useState(0), [productId, setProductId] = useState(''), [quantity, setQuantity] = useState(''), [cost, setCost] = useState('');
  const [lines, setLines] = useState<Line[]>([]), [note, setNote] = useState(''), [formError, setFormError] = useState(''), [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Order | null>(null), [action, setAction] = useState<{ order: Order; kind: 'order' | 'cancel' } | null>(null), [reason, setReason] = useState('');
  const [receiving, setReceiving] = useState<Order | null>(null), [received, setReceived] = useState<Record<string, string>>({}), [reference, setReference] = useState('');
  const [pending, setPending] = useState<Pending | null>(null), [pendingError, setPendingError] = useState('');
  const storage = `foxbiz-purchasing-pending:${user.id}:${outletId}`;

  useEffect(() => {
    if (!allowed || !outletId) return;
    const controller = new AbortController(); setLoading(true);
    Promise.all([api<{ items: Order[]; total: number }>(`purchase-orders?outletId=${outletId}&page=${page}&status=${status}`, { signal: controller.signal }), api<{ items: Receipt[]; total: number }>(`goods-receipts?outletId=${outletId}&page=${receiptPage}`, { signal: controller.signal })])
      .then(([po, gr]) => { setOrders(po.items); setTotal(po.total); setReceipts(gr.items); setReceiptTotal(gr.total); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, outletId, page, receiptPage, status, revision]);
  useEffect(() => { try { const raw = sessionStorage.getItem(storage); setPending(raw ? JSON.parse(raw) as Pending : null); } catch { setPendingError('Pemeriksaan tersimpan tidak dapat dibaca.'); } }, [storage]);
  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    api<{ items: Supplier[]; total: number }>(`suppliers?status=active&search=${encodeURIComponent(supplierSearch)}&page=${supplierPage}`, { signal: controller.signal }).then((data) => { setSuppliers(data.items); setSupplierTotal(data.total); }).catch((err) => { if (!controller.signal.aborted) setFormError(err.message); });
    return () => controller.abort();
  }, [editing, supplierSearch, supplierPage, revision]);
  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    api<{ items: Product[]; total: number }>(`purchasing/products?search=${encodeURIComponent(productSearch)}&page=${productPage}`, { signal: controller.signal }).then((data) => { setProducts(data.items); setProductTotal(data.total); }).catch((err) => { if (!controller.signal.aborted) setFormError(err.message); });
    return () => controller.abort();
  }, [editing, productSearch, productPage]);

  if (!allowed) return <PermissionDenied/>;
  if (!outletId) return <><PageTitle title="Pembelian" description="Supplier, pesanan pembelian, dan penerimaan barang."/><Notice>Belum ada outlet aktif dalam akses Anda.</Notice></>;
  function refresh(message: string) { setSuccess(message); setRevision((value) => value + 1); }
  function clearPending() { sessionStorage.removeItem(storage); setPending(null); setPendingError(''); }
  function completed() { clearPending(); setEditing(null); setReceiving(null); setPage(1); setReceiptPage(1); refresh('Dokumen pembelian berhasil dicatat.'); }
  async function post(value: Pending) {
    setBusy(true); setFormError(''); setPendingError('');
    try { sessionStorage.setItem(storage, JSON.stringify(value)); }
    catch { setFormError('Browser tidak dapat menyimpan pemeriksaan dokumen. Aktifkan penyimpanan browser lalu coba lagi.'); setBusy(false); return; }
    setPending(value);
    try {
      await api(value.endpoint, { method: 'POST', body: value.body }); completed();
    } catch (err) {
      if (err instanceof ApiError && [400, 403, 404, 422].includes(err.status)) { clearPending(); setFormError(err.message); }
      else { setPendingError((err as Error).message); }
    } finally { setBusy(false); }
  }
  async function checkPending() {
    if (!pending) return;
    setBusy(true); setPendingError('');
    try { await api(`${pending.endpoint}/by-key/${pending.body.idempotencyKey}?outletId=${outletId}`); completed(); }
    catch (err) { setPendingError(err instanceof ApiError && err.status === 404 ? 'Dokumen belum ditemukan. Kirim ulang dengan data yang sama atau tutup pemeriksaan dan periksa riwayat.' : (err as Error).message); }
    finally { setBusy(false); }
  }
  function edit(order: Order | 'new') {
    setEditing(order); setSupplierId(order === 'new' ? '' : order.supplierId); setLines(order === 'new' ? [] : order.items); setNote(order === 'new' ? '' : order.note); setProductSearch(''); setSupplierSearch(''); setProductPage(1); setSupplierPage(1); setProductId(''); setQuantity(''); setCost(''); setFormError('');
  }
  function addLine() {
    const product = products.find((entry) => entry.id === productId);
    if (!product || lines.some((entry) => entry.productId === productId)) { setFormError('Pilih produk yang belum ada di PO.'); return; }
    if (!/^(0|[1-9]\d{0,10})(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(cost)) { setFormError('Jumlah harus positif (maksimal tiga desimal), biaya minimal nol (maksimal dua desimal).'); return; }
    setLines([...lines, { productId, name: product.name, sku: product.sku, unit: product.unit, qtyOrdered: quantity, unitCost: cost }]); setProductId(''); setQuantity(''); setCost(''); setFormError('');
  }
  async function saveOrder() {
    if (!editing || !supplierId || !lines.length) { setFormError('Pilih supplier dan tambahkan minimal satu produk.'); return; }
    const data = { supplierId, note, items: lines.map(({ productId, qtyOrdered, unitCost }) => ({ productId, qtyOrdered, unitCost })) };
    if (editing === 'new') { await post({ endpoint: 'purchase-orders', body: { ...data, outletId, idempotencyKey: crypto.randomUUID() } }); return; }
    setBusy(true); setFormError('');
    try { await api(`purchase-orders/${editing.id}`, { method: 'PATCH', body: { ...data, version: editing.version } }); setEditing(null); refresh('Draft PO berhasil diperbarui.'); }
    catch (err) { setFormError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function confirmAction() {
    if (!action) return;
    setBusy(true); setFormError('');
    try { await api(`purchase-orders/${action.order.id}/${action.kind}`, { method: 'POST', body: { version: action.order.version, ...(action.kind === 'cancel' ? { reason } : {}) } }); setAction(null); refresh(action.kind === 'order' ? 'PO ditandai dipesan. Stok bertambah setelah penerimaan barang.' : 'PO berhasil dibatalkan.'); }
    catch (err) { setFormError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function saveReceipt() {
    if (!receiving) return;
    const items = Object.entries(received).filter(([, value]) => value !== '' && value !== '0').map(([productId, qtyReceived]) => ({ productId, qtyReceived }));
    if (!items.length || items.some((item) => !/^(0|[1-9]\d{0,10})(\.\d{1,3})?$/.test(item.qtyReceived) || Number(item.qtyReceived) <= 0)) { setFormError('Isi minimal satu jumlah penerimaan positif, maksimal tiga desimal.'); return; }
    await post({ endpoint: 'goods-receipts', body: { idempotencyKey: crypto.randomUUID(), outletId, purchaseOrderId: receiving.id, note, externalReference: reference, items } });
  }
  const pendingPanel = pending && <div className="my-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold">Dokumen pembelian belum terkonfirmasi</p><p className="mt-2">Periksa status atau kirim ulang data yang sama agar dokumen dan stok tidak tercatat ganda.</p>{pendingError && <Notice error>{pendingError}</Notice>}<div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void checkPending()}>Periksa status</Button><Button disabled={busy} onClick={() => void post(pending)}>Kirim ulang</Button><Button variant="ghost" disabled={busy} onClick={clearPending}>Tutup pemeriksaan</Button></div><p className="mt-2 text-xs">Menutup pemeriksaan tidak membatalkan dokumen yang sudah tersimpan. Periksa riwayat sebelum membuat dokumen baru.</p></div>;

  return <><PageTitle title="Pembelian" description={`Supplier, PO, dan penerimaan barang · ${outlets.find((outlet) => outlet.id === outletId)?.name ?? ''}`}/>
    {success && <Notice>{success}</Notice>}{!editing && !receiving && pendingPanel}
    <ResourcePanel title="Supplier" endpoint="suppliers" searchable paginated writable={can('purchasing.suppliers.write')} defaults={{ status: 'active', contact: '' }} onSaved={() => setRevision((value) => value + 1)} fields={[{ key: 'name', label: 'Nama supplier', required: true }, { key: 'contact', label: 'Kontak supplier' }, { key: 'status', label: 'Status', required: true, options: [{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }] }]} columns={[{ label: 'Nama', render: (row) => text(row.name) }, { label: 'Kontak', render: (row) => text(row.contact) || '—' }, { label: 'Status', render: (row) => <Badge>{row.status === 'active' ? 'Aktif' : 'Nonaktif'}</Badge> }]}/>
    <Card className="mt-6 p-4 sm:p-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Purchase order</h2>{can('purchasing.orders.write') && <Button disabled={Boolean(pending)} onClick={() => edit('new')}>Buat PO</Button>}</div><label className="block max-w-xs text-sm font-medium">Status PO<select aria-label="Status PO" className={`${selectClass} mt-2`} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Semua status</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {error ? <><Notice error>{error}</Notice><Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>Coba lagi</Button></> : loading ? <Notice>Memuat pembelian...</Notice> : <><TableShell caption="Purchase order" columns={['PO / Supplier', 'Status', 'Total', 'Aksi']}>{orders.map((order) => <tr key={order.id}><td className="px-4 py-3"><b className="block max-w-64 truncate" title={order.poNo}>{order.poNo}</b><span className="block text-sm text-fox-secondary">{order.supplierName}</span></td><td className="px-4 py-3"><Badge>{labels[order.status]}</Badge></td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(order.total)}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={async () => { try { setDetail(await api<Order>(`purchase-orders/${order.id}?outletId=${outletId}`)); } catch (err) { setError((err as Error).message); } }}>Rincian</Button>{order.status === 'draft' && can('purchasing.orders.write') && <Button variant="secondary" disabled={Boolean(pending)} onClick={() => edit(order)}>Ubah draft</Button>}{order.status === 'draft' && can('purchasing.orders.order') && <Button variant="secondary" disabled={Boolean(pending)} onClick={() => { setAction({ order, kind: 'order' }); setFormError(''); }}>Pesan</Button>}{['draft', 'ordered'].includes(order.status) && can('purchasing.orders.cancel') && <Button variant="ghost" disabled={Boolean(pending)} onClick={() => { setAction({ order, kind: 'cancel' }); setReason(''); setFormError(''); }}>Batalkan</Button>}{['ordered', 'partially_received'].includes(order.status) && can('purchasing.receive') && <Button disabled={Boolean(pending)} onClick={() => { setReceiving(order); setReceived({}); setNote(''); setReference(''); setFormError(''); }}>Terima barang</Button>}</div></td></tr>)}</TableShell>{!orders.length && <Notice>Belum ada PO yang cocok pada outlet ini.</Notice>}<Pager page={page} total={total} setPage={setPage}/></>}
    </Card>
    <Card className="mt-6 p-4 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Riwayat penerimaan PO</h2><TableShell caption="Penerimaan PO" columns={['Waktu / PO', 'Penerima', 'Catatan / Referensi', 'Produk']}>{receipts.map((receipt) => <tr key={receipt.id}><td className="px-4 py-3"><span className="whitespace-nowrap">{new Date(receipt.receivedAt).toLocaleString('id-ID')}</span><span className="block max-w-64 truncate text-xs text-fox-secondary">{receipt.purchaseOrder.poNo}</span></td><td className="px-4 py-3">{receipt.receiver.name}</td><td className="px-4 py-3">{receipt.note}<span className="block text-xs text-fox-secondary">{receipt.externalReference || '—'}</span></td><td className="px-4 py-3">{receipt.items.length}</td></tr>)}</TableShell>{!receipts.length && <Notice>Belum ada penerimaan PO.</Notice>}<Pager page={receiptPage} total={receiptTotal} setPage={setReceiptPage}/></Card>

    <Modal open={editing !== null} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }} title={editing === 'new' ? 'Buat PO' : 'Ubah draft PO'} description="PO disimpan sebagai draft. Periksa jumlah dan biaya sebelum menandai dipesan.">
      {pending ? pendingPanel : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveOrder(); }}><fieldset disabled={busy} className="space-y-4">
        <Input aria-label="Cari supplier PO" placeholder="Cari supplier aktif..." value={supplierSearch} onChange={(event) => { setSupplierSearch(event.target.value); setSupplierPage(1); }}/><label className="block text-sm font-medium">Supplier<select aria-label="Supplier PO" className={`${selectClass} mt-2`} required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Pilih supplier...</option>{supplierId && !suppliers.some((supplier) => supplier.id === supplierId) && <option value={supplierId}>{editing && editing !== 'new' ? editing.supplierName : 'Supplier terpilih'}</option>}{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><Pager page={supplierPage} total={supplierTotal} setPage={setSupplierPage}/>
        <div className="space-y-3 rounded-xl border border-fox-border p-3"><Input aria-label="Cari produk PO" placeholder="Cari produk atau SKU..." value={productSearch} onChange={(event) => { setProductSearch(event.target.value); setProductPage(1); }}/><label className="block text-sm font-medium">Produk<select aria-label="Produk PO" className={`${selectClass} mt-2`} value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Pilih produk...</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label><Pager page={productPage} total={productTotal} setPage={setProductPage}/><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Jumlah pesanan<Input aria-label="Jumlah pesanan" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-2"/></label><label className="text-sm font-medium">Biaya per unit (Rp)<Input aria-label="Biaya per unit" type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} className="mt-2"/></label></div><Button type="button" variant="secondary" onClick={addLine}>Tambah baris</Button></div>
        {lines.length > 0 && <ul className="divide-y divide-fox-border rounded-xl border border-fox-border">{lines.map((line) => <li className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm" key={line.productId}><span><b>{line.name}</b><span className="block text-xs text-fox-secondary">{line.qtyOrdered} {line.unit} × {money(line.unitCost)}</span></span><Button type="button" variant="ghost" aria-label={`Hapus ${line.name}`} onClick={() => setLines(lines.filter((entry) => entry.productId !== line.productId))}>Hapus</Button></li>)}</ul>}
        <label className="block text-sm font-medium">Catatan PO<Input aria-label="Catatan PO" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} className="mt-2"/></label></fieldset>{formError && <Notice error>{formError}</Notice>}<Button type="submit" disabled={busy || !lines.length}>{busy ? 'Menyimpan...' : 'Simpan draft'}</Button></form>}
    </Modal>

    <Modal open={action !== null} onOpenChange={(open) => { if (!open && !busy) setAction(null); }} title={action?.kind === 'cancel' ? 'Batalkan PO' : 'Konfirmasi pesanan'} description={action?.order.supplierName ?? ''}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void confirmAction(); }}><Notice>{action?.kind === 'cancel' ? 'PO hanya dapat dibatalkan sebelum ada barang diterima.' : 'Jumlah dan biaya PO dikunci setelah dipesan. Stok baru bertambah saat barang fisik diterima.'}</Notice>{action?.kind === 'cancel' && <label className="block text-sm font-medium">Alasan pembatalan<Input aria-label="Alasan pembatalan" required minLength={3} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2"/></label>}{formError && <Notice error>{formError}</Notice>}<Button type="submit" disabled={busy}>{busy ? 'Memproses...' : 'Konfirmasi'}</Button></form></Modal>

    <Modal open={receiving !== null} onOpenChange={(open) => { if (!open && !busy) setReceiving(null); }} title="Terima barang PO" description={receiving?.supplierName ?? ''}>{pending ? pendingPanel : receiving && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveReceipt(); }}><Notice>Isi jumlah barang yang benar-benar diterima. Kosongkan produk yang belum datang; jumlah tidak boleh melebihi sisa pesanan.</Notice><fieldset disabled={busy} className="space-y-4">{receiving.items.map((line) => { const remaining = Number(line.qtyOrdered) - Number(line.qtyReceived ?? 0); return <label key={line.productId} className="block rounded-xl border border-fox-border p-3 text-sm font-medium">{line.name}<span className="mt-1 block text-xs text-fox-secondary">Dipesan {line.qtyOrdered} · diterima {line.qtyReceived ?? '0'} · sisa {remaining.toFixed(3)} {line.unit}</span>{remaining > 0 && <Input aria-label={`Jumlah diterima ${line.name}`} type="number" min="0" max={remaining.toFixed(3)} step="0.001" value={received[line.productId] ?? ''} onChange={(event) => setReceived({ ...received, [line.productId]: event.target.value })} className="mt-2"/>}</label>; })}<label className="block text-sm font-medium">Catatan penerimaan<Input aria-label="Catatan penerimaan" minLength={3} maxLength={200} required value={note} onChange={(event) => setNote(event.target.value)} className="mt-2"/></label><label className="block text-sm font-medium">Referensi surat jalan<Input aria-label="Referensi surat jalan" maxLength={100} value={reference} onChange={(event) => setReference(event.target.value)} className="mt-2"/></label></fieldset>{formError && <Notice error>{formError}</Notice>}<Button type="submit" disabled={busy}>{busy ? 'Mencatat...' : 'Catat penerimaan'}</Button></form>}</Modal>

    <Modal open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }} title="Rincian PO" description={detail?.poNo ?? ''}>{detail && <div className="space-y-4 text-sm"><p><b>{detail.supplierName}</b> · {labels[detail.status]}</p><p>Total: <b>{money(detail.total)}</b></p><p>{detail.note || 'Tanpa catatan'}</p>{detail.cancelReason && <Notice>Alasan batal: {detail.cancelReason}</Notice>}<TableShell caption="Item PO" columns={['Produk', 'Dipesan', 'Diterima', 'Biaya / unit']}>{detail.items.map((line) => <tr key={line.productId}><td className="px-4 py-3">{line.name}<span className="block text-xs text-fox-secondary">{line.sku}</span></td><td className="px-4 py-3">{line.qtyOrdered} {line.unit}</td><td className="px-4 py-3">{line.qtyReceived}</td><td className="whitespace-nowrap px-4 py-3">{money(line.unitCost)}</td></tr>)}</TableShell><h3 className="font-semibold">Penerimaan terkait</h3>{detail.receipts.map((receipt) => <div key={receipt.id} className="rounded-xl border border-fox-border p-3"><p>{new Date(receipt.receivedAt).toLocaleString('id-ID')} · {receipt.receiver.name}</p><p>{receipt.note} {receipt.externalReference && `· ${receipt.externalReference}`}</p><ul className="mt-2 space-y-1">{receipt.items.map((item) => <li key={item.productId}>{detail.items.find((line) => line.productId === item.productId)?.name} · {item.qtyReceived}</li>)}</ul><p className="mt-2 break-all text-xs text-fox-secondary">Dokumen stok: {receipt.stockDocumentId}</p></div>)}{!detail.receipts.length && <p className="text-fox-secondary">Belum ada penerimaan.</p>}</div>}</Modal>
  </>;
}
