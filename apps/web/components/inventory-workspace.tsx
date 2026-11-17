'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Input, Modal, TableShell } from '@foxbiz/ui';
import { api, ApiError } from '../lib/api';
import { AppShell } from './app-shell';
import { useSession } from './session-provider';
import { Notice, PageTitle, Pager, PermissionDenied, Row, selectClass, text } from './workspace-ui';

type Kind = 'adjustment' | 'receiving' | 'transfer';
type Balance = { product: Row; quantity: string; lowStockThreshold: string; openedAt: string | null; lowStock: boolean };
type StockItem = { id: string; productId: string; name: string; sku: string; unit: string; quantity: string };
type StockDoc = { id: string; kind: Kind; status: 'posted' | 'sent' | 'received'; note: string; externalReference: string; createdAt: string; receivedAt: string | null; items: StockItem[]; outlet: { id: string; name: string }; destinationOutlet: { id: string; name: string } | null; creator: { id: string; name: string }; receiver: { id: string; name: string } | null; goodsReceipt?: { id: string; purchaseOrder: { id: string; poNo: string } } | null };
type Destination = { id: string; name: string; code: string };
type DraftLine = { productId: string; quantity: string; name: string; sku: string; unit: string };
type Draft = { idempotencyKey: string; outletId: string; kind: Kind; destinationOutletId?: string; note: string; externalReference: string; items: { productId: string; quantity: string }[] };

const kindLabels: Record<Kind, string> = { adjustment: 'Penyesuaian', receiving: 'Penerimaan', transfer: 'Transfer' };
const statusLabels: Record<StockDoc['status'], string> = { posted: 'Tercatat', sent: 'Dikirim', received: 'Diterima' };
const movementLabels: Record<string, string> = { opening: 'Saldo awal', sale: 'Penjualan', adjustment: 'Penyesuaian', receiving: 'Penerimaan', purchase_receipt: 'Penerimaan PO', transfer_out: 'Transfer keluar', transfer_in: 'Transfer masuk' };

export function InventoryWorkspace() { return <AppShell><OutletInventory/></AppShell>; }
function OutletInventory() { const { outletId } = useSession(); return <Inventory key={outletId}/>; }

function Inventory() {
  const { can, outletId, outlets, user } = useSession();
  const allowed = can('inventory.read'), canSend = can('inventory.transfer.send'), canReceive = can('inventory.transfer.receive');
  const [items, setItems] = useState<Balance[]>([]), [movements, setMovements] = useState<Row[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [movementTotal, setMovementTotal] = useState(0), [movementPage, setMovementPage] = useState(1);
  const [documents, setDocuments] = useState<StockDoc[]>([]), [docTotal, setDocTotal] = useState(0), [docPage, setDocPage] = useState(1), [destinations, setDestinations] = useState<Destination[]>([]);
  const [search, setSearch] = useState(''), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<{ row: Balance; kind: 'opening' | 'threshold'; outletId: string } | null>(null), [balanceBusy, setBalanceBusy] = useState(false), [formError, setFormError] = useState('');
  const [docKind, setDocKind] = useState<Kind | null>(null), [docKey, setDocKey] = useState(''), [docLines, setDocLines] = useState<DraftLine[]>([]), [docProduct, setDocProduct] = useState(''), [docQuantity, setDocQuantity] = useState(''), [docSearch, setDocSearch] = useState(''), [docProducts, setDocProducts] = useState<Balance[]>([]), [docProductsLoading, setDocProductsLoading] = useState(false);
  const [docNote, setDocNote] = useState(''), [externalReference, setExternalReference] = useState(''), [destinationId, setDestinationId] = useState(''), [docBusy, setDocBusy] = useState(false), [docError, setDocError] = useState('');
  const [pending, setPending] = useState<Draft | null>(null), [pendingBusy, setPendingBusy] = useState(false), [pendingError, setPendingError] = useState('');
  const [detail, setDetail] = useState<StockDoc | null>(null), [receiveDoc, setReceiveDoc] = useState<StockDoc | null>(null), [receiveBusy, setReceiveBusy] = useState(false), [receiveError, setReceiveError] = useState('');
  const pendingStorage = outletId ? `foxbiz-stock-pending:${user.id}:${outletId}` : '';

  useEffect(() => {
    if (!allowed || !outletId) return;
    const controller = new AbortController();
    setLoading(true);
    Promise.all([
      api<{ items: Balance[]; total: number }>(`inventory/balances?outletId=${outletId}&page=${page}&search=${encodeURIComponent(search)}`, { signal: controller.signal }),
      api<{ items: Row[]; total: number }>(`inventory/movements?outletId=${outletId}&page=${movementPage}`, { signal: controller.signal }),
      api<{ items: StockDoc[]; total: number }>(`inventory/documents?outletId=${outletId}&page=${docPage}`, { signal: controller.signal }),
    ]).then(([balances, ledger, docs]) => { setItems(balances.items); setTotal(balances.total); setMovements(ledger.items); setMovementTotal(ledger.total); setDocuments(docs.items); setDocTotal(docs.total); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, outletId, search, page, movementPage, docPage, revision]);

  useEffect(() => {
    if (!allowed || !outletId || !canSend) { setDestinations([]); return; }
    const controller = new AbortController();
    api<Destination[]>(`inventory/destinations?outletId=${outletId}`, { signal: controller.signal }).then(setDestinations).catch(() => { if (!controller.signal.aborted) setDestinations([]); });
    return () => controller.abort();
  }, [allowed, outletId, canSend, revision]);

  useEffect(() => {
    if (!pendingStorage) { setPending(null); return; }
    try {
      const raw = sessionStorage.getItem(pendingStorage);
      const parsed = raw ? JSON.parse(raw) as Draft : null;
      setPending(parsed && parsed.outletId === outletId && parsed.idempotencyKey ? parsed : null);
    } catch { setPending(null); }
  }, [pendingStorage, outletId]);

  useEffect(() => {
    if (!docKind || !outletId) return;
    const controller = new AbortController();
    setDocProductsLoading(true);
    api<{ items: Balance[] }>(`inventory/balances?outletId=${outletId}&page=1&search=${encodeURIComponent(docSearch)}`, { signal: controller.signal })
      .then((data) => { setDocProducts(data.items); setDocError(''); })
      .catch((err) => { if (!controller.signal.aborted) setDocError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setDocProductsLoading(false); });
    return () => controller.abort();
  }, [docKind, outletId, docSearch]);

  if (!allowed) return <PermissionDenied/>;
  if (!outletId) return <><PageTitle title="Inventori" description="Saldo dan mutasi stok per outlet."/><Notice>Belum ada outlet aktif dalam akses Anda. Hubungi pengelola bisnis.</Notice></>;

  function saveBalance(form: HTMLFormElement) {
    if (!editing) return;
    setBalanceBusy(true); setFormError(''); const values = new FormData(form);
    api(`inventory/${editing.kind}`, { method: editing.kind === 'opening' ? 'POST' : 'PATCH', body: { outletId: editing.outletId, productId: editing.row.product.id, ...(editing.kind === 'opening' ? { quantity: values.get('quantity'), note: values.get('note') } : { lowStockThreshold: values.get('quantity') }) } })
      .then(() => { setEditing(null); setSuccess('Perubahan stok berhasil dicatat.'); setRevision((value) => value + 1); })
      .catch((err) => setFormError((err as Error).message)).finally(() => setBalanceBusy(false));
  }

  function openDocument(kind: Kind) {
    if (pending) return;
    setDocKind(kind); setDocKey(crypto.randomUUID()); setDocLines([]); setDocProduct(''); setDocQuantity(''); setDocSearch(''); setDocNote(''); setExternalReference(''); setDestinationId(destinations[0]?.id ?? ''); setDocError('');
  }

  function addLine() {
    const product = docProducts.find((row) => row.product.id === docProduct);
    if (!product) { setDocError('Pilih produk terlebih dahulu.'); return; }
    if (docLines.some((line) => line.productId === docProduct)) { setDocError('Produk ini sudah ada pada dokumen.'); return; }
    const quantity = docQuantity.trim(), valid = docKind === 'adjustment' ? /^-?(0|[1-9]\d{0,10})(\.\d{1,3})?$/ : /^(0|[1-9]\d{0,10})(\.\d{1,3})?$/;
    if (!valid.test(quantity) || Number(quantity) === 0) { setDocError(docKind === 'adjustment' ? 'Kuantitas harus bukan nol, maksimal tiga desimal. Gunakan minus untuk mengurangi.' : 'Kuantitas harus lebih dari nol, maksimal tiga desimal.'); return; }
    setDocLines([...docLines, { productId: product.product.id, quantity, name: text(product.product.name), sku: text(product.product.sku), unit: text(product.product.unit) }]); setDocProduct(''); setDocQuantity(''); setDocError('');
  }

  function draft(): Draft | null {
    if (!docKind) return null;
    if (!docLines.length) { setDocError('Tambahkan minimal satu produk.'); return null; }
    if (docNote.trim().length < 3) { setDocError('Alasan wajib diisi minimal tiga karakter.'); return null; }
    if (docKind === 'transfer' && !destinationId) { setDocError('Pilih outlet tujuan transfer.'); return null; }
    return { idempotencyKey: docKey, outletId, kind: docKind, ...(docKind === 'transfer' ? { destinationOutletId: destinationId } : {}), note: docNote.trim(), externalReference: externalReference.trim(), items: docLines.map(({ productId, quantity }) => ({ productId, quantity })) };
  }

  function persistPending(value: Draft) { sessionStorage.setItem(pendingStorage, JSON.stringify(value)); setPending(value); setPendingError(''); }
  function clearPending() { sessionStorage.removeItem(pendingStorage); setPending(null); setPendingError(''); }

  function created(kind: Kind) { clearPending(); setDocKind(null); setDocPage(1); setSuccess(kind === 'transfer' ? 'Transfer berhasil dikirim dan menunggu penerimaan outlet tujuan.' : `Dokumen ${kindLabels[kind].toLowerCase()} berhasil dicatat.`); setRevision((value) => value + 1); }

  async function createDocument() {
    const body = draft(); if (!body) return;
    setDocBusy(true); setDocError(''); persistPending(body);
    try { await api('inventory/documents', { method: 'POST', body }); created(body.kind); }
    catch (err) {
      const message = (err as Error).message;
      if (err instanceof ApiError && [400, 403, 404, 422].includes(err.status)) { setDocError(message); clearPending(); }
      else setPendingError(message);
    }
    finally { setDocBusy(false); }
  }

  async function retryPending() {
    if (!pending) return;
    setPendingBusy(true); setPendingError('');
    try { await api('inventory/documents', { method: 'POST', body: pending }); created(pending.kind); }
    catch (err) { setPendingError((err as Error).message); }
    finally { setPendingBusy(false); }
  }

  async function checkPending() {
    if (!pending) return;
    setPendingBusy(true); setPendingError('');
    try { await api(`inventory/documents/by-key/${pending.idempotencyKey}?outletId=${outletId}`); created(pending.kind); }
    catch (err) { setPendingError(err instanceof ApiError && err.status === 404 ? 'Dokumen belum tercatat di server. Periksa input lalu kirim ulang dengan key yang sama.' : (err as Error).message); }
    finally { setPendingBusy(false); }
  }

  async function confirmReceive() {
    if (!receiveDoc) return;
    setReceiveBusy(true); setReceiveError('');
    try { await api(`inventory/documents/${receiveDoc.id}/receive`, { method: 'POST', body: {} }); setReceiveDoc(null); setSuccess('Transfer masuk telah dikonfirmasi dan stok tujuan diperbarui.'); setRevision((value) => value + 1); }
    catch (err) { setReceiveError((err as Error).message); }
    finally { setReceiveBusy(false); }
  }

  const pendingPanel = pending ? <div className="my-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
    <p className="font-semibold text-amber-900">Dokumen {kindLabels[pending.kind].toLowerCase()} belum terkonfirmasi</p>
    <p className="mt-1 text-amber-800">Respons sebelumnya tidak pasti. Periksa status sebelum mengulang agar stok tidak tercatat ganda.</p>
    <p className="mt-2 break-all text-xs text-amber-700">Key: {pending.idempotencyKey}</p>
    {pendingError && <Notice error>{pendingError}</Notice>}
    <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" disabled={pendingBusy} onClick={() => void checkPending()}>{pendingBusy ? 'Memeriksa...' : 'Periksa status'}</Button><Button disabled={pendingBusy} onClick={() => void retryPending()}>Kirim ulang</Button><Button variant="ghost" disabled={pendingBusy} onClick={clearPending}>Tutup pemeriksaan</Button></div>
    <p className="mt-2 text-xs text-amber-700">Menutup pemeriksaan tidak membatalkan dokumen bila server sempat menyimpannya. Periksa riwayat dokumen.</p>
  </div> : null;

  return <><PageTitle title="Inventori" description={`Saldo, dokumen, dan mutasi stok · ${outlets.find((outlet) => outlet.id === outletId)?.name ?? ''}. Ganti outlet melalui profil atau pilihan di header.`}/>
    <Card className="p-4 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Saldo stok</h2><Input aria-label="Cari stok" placeholder="Cari produk atau SKU..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}/>{success && <Notice>{success}</Notice>}{error ? <><Notice error>{error}</Notice><Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>Coba lagi</Button></> : loading ? <Notice>Memuat stok...</Notice> : <><TableShell caption="Saldo stok per outlet" columns={['Produk', 'Saldo', 'Batas minimum', 'Kondisi', 'Aksi']}>{items.map((row) => <tr key={row.product.id}><td className="px-4 py-3"><b>{text(row.product.name)}</b><span className="block text-xs text-fox-secondary">{text(row.product.sku)}</span></td><td className="px-4 py-3 tabular-nums">{row.quantity} {text(row.product.unit)}</td><td className="px-4 py-3 tabular-nums">{row.lowStockThreshold}</td><td className="px-4 py-3"><Badge>{!row.openedAt ? 'Belum diisi' : row.lowStock ? 'Stok rendah' : 'Tersedia'}</Badge></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2">{can('inventory.opening') && !row.openedAt && <Button variant="secondary" onClick={() => { setEditing({ row, kind: 'opening', outletId }); setFormError(''); }}>Saldo awal</Button>}{can('inventory.threshold') && <Button variant="ghost" onClick={() => { setEditing({ row, kind: 'threshold', outletId }); setFormError(''); }}>Batas minimum</Button>}</div></td></tr>)}</TableShell>{!items.length && <Notice>Belum ada produk aktif yang cocok. Tambahkan produk di katalog terlebih dahulu.</Notice>}<Pager page={page} total={total} setPage={setPage}/></>}</Card>
    <Card className="mt-6 p-4 sm:p-6"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Dokumen stok</h2><p className="mt-1 text-sm text-fox-secondary">Penyesuaian, penerimaan sederhana, dan transfer antar-outlet.</p></div><div className="flex flex-wrap gap-2">{can('inventory.adjust') && <Button variant="secondary" disabled={Boolean(pending)} onClick={() => openDocument('adjustment')}>Penyesuaian</Button>}{can('inventory.receive') && <Button variant="secondary" disabled={Boolean(pending)} onClick={() => openDocument('receiving')}>Penerimaan</Button>}{canSend && <Button variant="secondary" disabled={Boolean(pending)} onClick={() => openDocument('transfer')}>Transfer</Button>}</div></div>{pendingPanel}
      {loading ? <Notice>Memuat dokumen...</Notice> : <><TableShell caption="Dokumen stok" columns={['Waktu', 'Dokumen', 'Rute', 'Status', 'Catatan', 'Aksi']}>{documents.map((doc) => <tr key={doc.id}><td className="whitespace-nowrap px-4 py-3">{new Date(doc.createdAt).toLocaleString('id-ID')}</td><td className="px-4 py-3"><b>{kindLabels[doc.kind]}</b><span className="block max-w-48 truncate text-xs text-fox-secondary">{doc.externalReference || doc.id}</span></td><td className="px-4 py-3">{doc.outlet.name}{doc.destinationOutlet ? ` → ${doc.destinationOutlet.name}` : ''}</td><td className="px-4 py-3"><Badge className={doc.status === 'received' ? 'bg-[#E7F7EF] text-fox-success' : doc.status === 'sent' ? 'bg-amber-50 text-amber-700' : ''}>{statusLabels[doc.status]}</Badge>{doc.kind === 'transfer' && doc.status === 'sent' && doc.destinationOutlet?.id === outletId && <span className="mt-1 block text-xs font-semibold text-amber-700">Perlu diterima</span>}</td><td className="px-4 py-3"><span className="block max-w-56 truncate">{doc.note}</span><span className="block text-xs text-fox-secondary">{doc.items.length} produk</span></td><td className="px-4 py-3"><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setDetail(doc)}>Rincian</Button>{canReceive && doc.kind === 'transfer' && doc.status === 'sent' && doc.destinationOutlet?.id === outletId && <Button variant="secondary" onClick={() => { setReceiveDoc(doc); setReceiveError(''); }}>Terima</Button>}</div></td></tr>)}</TableShell>{!documents.length && <Notice>Belum ada dokumen stok pada outlet ini.</Notice>}<Pager page={docPage} total={docTotal} setPage={setDocPage}/></>}</Card>
    <Card className="mt-6 p-4 sm:p-6"><h2 className="mb-4 text-lg font-semibold">Riwayat mutasi</h2><TableShell caption="Riwayat mutasi stok" columns={['Waktu', 'Produk', 'Jenis', 'Jumlah', 'Stok', 'Catatan']}>{movements.map((row) => <tr key={row.id}><td className="whitespace-nowrap px-4 py-3">{new Date(text(row.createdAt)).toLocaleString('id-ID')}</td><td className="px-4 py-3">{text((row.product as Row).name)}<span className="block text-xs text-fox-secondary">{text((row.product as Row).sku)}</span></td><td className="px-4 py-3">{movementLabels[text(row.movementType)] ?? text(row.movementType)}</td><td className="px-4 py-3 tabular-nums">{text(row.quantity)}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{row.beforeQuantity != null && row.afterQuantity != null ? `${text(row.beforeQuantity)} → ${text(row.afterQuantity)}` : '—'}</td><td className="px-4 py-3"><span className="block max-w-56 truncate">{row.note ? text(row.note) : '—'}</span><span className="block max-w-56 truncate text-xs text-fox-secondary">{text(row.reference)}</span></td></tr>)}</TableShell>{!movements.length && <Notice>Belum ada mutasi tercatat pada outlet ini.</Notice>}<Pager page={movementPage} total={movementTotal} setPage={setMovementPage}/></Card>

    <Modal open={docKind !== null} onOpenChange={(open) => { if (!open && !docBusy) setDocKind(null); }} title={docKind ? `Catat ${kindLabels[docKind].toLowerCase()}` : 'Dokumen stok'} description={docKind ? `${outlets.find((outlet) => outlet.id === outletId)?.name ?? ''}${docKind === 'transfer' ? ' ke outlet tujuan' : ''} · periksa jumlah sebelum menyimpan.` : ''}>
      {pending ? pendingPanel : docKind && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void createDocument(); }}>
        {docKind === 'adjustment' && <Notice>Gunakan kuantitas positif untuk menambah dan negatif untuk mengurangi stok. Stok akhir tidak boleh negatif.</Notice>}
        {docKind === 'receiving' && <Notice>Penerimaan sederhana menambah stok tanpa PO. Untuk barang yang dipesan melalui PO, catat penerimaannya di modul Pembelian.</Notice>}
        {docKind === 'transfer' && <Notice>Stok sumber berkurang saat transfer dikirim. Stok tujuan bertambah setelah pengguna berizin di outlet tujuan mengonfirmasi penerimaan.</Notice>}
        {docKind === 'transfer' && <label className="block text-sm font-medium">Outlet tujuan<select aria-label="Outlet tujuan" className={`${selectClass} mt-2`} value={destinationId} onChange={(event) => setDestinationId(event.target.value)} required><option value="" disabled>Pilih outlet...</option>{destinations.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name} ({outlet.code})</option>)}</select>{!destinations.length && <span className="mt-1 block text-xs text-fox-danger">Belum ada outlet tujuan aktif.</span>}</label>}
        <div className="rounded-xl border border-fox-border p-3"><p className="text-sm font-semibold">Produk</p><div className="mt-3 space-y-3"><Input aria-label="Cari produk dokumen" placeholder="Cari produk atau SKU..." value={docSearch} onChange={(event) => setDocSearch(event.target.value)}/>{docProductsLoading ? <p className="text-xs text-fox-secondary">Memuat produk...</p> : <><label className="block text-sm font-medium">Pilih produk<select aria-label="Pilih produk" className={`${selectClass} mt-2`} value={docProduct} onChange={(event) => setDocProduct(event.target.value)}><option value="">Pilih produk...</option>{docProducts.map((row) => <option key={row.product.id} value={row.product.id}>{text(row.product.name)} · {text(row.product.sku)} · saldo {row.quantity} {text(row.product.unit)}</option>)}</select></label><div className="flex flex-wrap items-end gap-2"><label className="min-w-40 flex-1 text-sm font-medium">Kuantitas<Input aria-label="Kuantitas produk" type="number" min={docKind === 'adjustment' ? undefined : '0.001'} step="0.001" value={docQuantity} onChange={(event) => setDocQuantity(event.target.value)} className="mt-2"/></label><Button variant="secondary" type="button" onClick={addLine}>Tambah baris</Button></div></>}</div>
          {docLines.length > 0 && <ul className="mt-3 divide-y divide-fox-border rounded-lg border border-fox-border">{docLines.map((line) => <li key={line.productId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"><span><b>{line.name}</b><span className="block text-xs text-fox-secondary">{line.sku} · {line.quantity} {line.unit}</span></span><Button variant="ghost" type="button" aria-label={`Hapus ${line.name}`} onClick={() => setDocLines(docLines.filter((entry) => entry.productId !== line.productId))}>Hapus</Button></li>)}</ul>}
        </div>
        <label className="block text-sm font-medium">Alasan / catatan<Input aria-label="Alasan dokumen" value={docNote} onChange={(event) => setDocNote(event.target.value)} minLength={3} maxLength={200} required className="mt-2"/></label>
        <label className="block text-sm font-medium">Referensi eksternal (opsional)<Input aria-label="Referensi eksternal" value={externalReference} onChange={(event) => setExternalReference(event.target.value)} maxLength={100} className="mt-2" placeholder="Nomor surat jalan, dokumen fisik, ..."/></label>
        {docError && <Notice error>{docError}</Notice>}
        <Button disabled={docBusy || !docLines.length || (docKind === 'transfer' && !destinationId)} type="submit">{docBusy ? 'Menyimpan...' : docKind === 'transfer' ? 'Kirim transfer' : docKind === 'receiving' ? 'Catat penerimaan' : 'Catat penyesuaian'}</Button>
      </form>}
    </Modal>

    <Modal open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }} title={detail ? `${kindLabels[detail.kind]} · ${statusLabels[detail.status]}` : 'Rincian dokumen'} description={detail ? `${detail.outlet.name}${detail.destinationOutlet ? ` → ${detail.destinationOutlet.name}` : ''} · ${new Date(detail.createdAt).toLocaleString('id-ID')}` : ''}>
      {detail && <div className="space-y-4 text-sm"><p><b>Alasan:</b> {detail.note}</p>{detail.goodsReceipt && <p className="break-all"><b>Purchase order:</b> {detail.goodsReceipt.purchaseOrder.poNo}</p>}{detail.externalReference && <p><b>Referensi:</b> {detail.externalReference}</p>}<p><b>Dibuat oleh:</b> {detail.creator.name}{detail.receiver ? ` · diterima oleh ${detail.receiver.name}` : ''}</p><TableShell caption="Rincian produk dokumen" columns={['Produk', 'Kuantitas']}>{detail.items.map((item) => <tr key={item.id}><td className="px-4 py-3">{item.name}<span className="block text-xs text-fox-secondary">{item.sku}</span></td><td className="px-4 py-3 tabular-nums">{item.quantity} {item.unit}</td></tr>)}</TableShell></div>}
    </Modal>

    <Modal open={receiveDoc !== null} onOpenChange={(open) => { if (!open && !receiveBusy) setReceiveDoc(null); }} title="Konfirmasi transfer masuk" description={receiveDoc ? `Dari ${receiveDoc.outlet.name} · ${receiveDoc.items.length} produk` : ''}>
      {receiveDoc && <div className="space-y-4 text-sm"><Notice>Stok outlet ini akan bertambah sesuai jumlah di bawah. Konfirmasi hanya setelah barang fisik diperiksa.</Notice><TableShell caption="Produk transfer masuk" columns={['Produk', 'Kuantitas']}>{receiveDoc.items.map((item) => <tr key={item.id}><td className="px-4 py-3">{item.name}<span className="block text-xs text-fox-secondary">{item.sku}</span></td><td className="px-4 py-3 tabular-nums">{item.quantity} {item.unit}</td></tr>)}</TableShell><p><b>Catatan pengirim:</b> {receiveDoc.note}</p>{receiveError && <Notice error>{receiveError}</Notice>}<div className="flex flex-wrap gap-2"><Button disabled={receiveBusy} onClick={() => void confirmReceive()}>{receiveBusy ? 'Memproses...' : 'Konfirmasi penerimaan'}</Button><Button variant="secondary" disabled={receiveBusy} onClick={() => setReceiveDoc(null)}>Batal</Button></div></div>}
    </Modal>

    <Modal open={editing !== null} onOpenChange={(open) => { if (!open && !balanceBusy) setEditing(null); }} title={editing?.kind === 'opening' ? 'Catat saldo awal' : 'Atur batas minimum'} description={`${text(editing?.row.product.name)} · ${outlets.find((outlet) => outlet.id === editing?.outletId)?.name ?? ''}`}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); saveBalance(event.currentTarget); }}><label className="block text-sm font-medium">{editing?.kind === 'opening' ? 'Jumlah saldo awal' : 'Batas minimum'}<Input name="quantity" type="number" min="0" step="0.001" required defaultValue={editing?.kind === 'threshold' ? editing.row.lowStockThreshold : '0'} className="mt-2"/></label>{editing?.kind === 'opening' && <><Notice>Saldo awal hanya dapat dicatat sekali per produk dan outlet. Periksa jumlah sebelum menyimpan.</Notice><label className="block text-sm font-medium">Catatan<Input name="note" minLength={3} maxLength={200} required className="mt-2"/></label></>}{formError && <Notice error>{formError}</Notice>}<Button disabled={balanceBusy} type="submit">{balanceBusy ? 'Menyimpan...' : 'Simpan'}</Button></form></Modal></>;
}
