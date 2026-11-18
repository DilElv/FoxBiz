'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Input, Modal } from '@foxbiz/ui';
import { ClipboardList, Minus, Package, Pause, Plus, RefreshCw, Search, ShoppingCart, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { AppShell } from './app-shell';
import { useSession } from './session-provider';
import { Notice, PageTitle, Pager, PermissionDenied, selectClass } from './workspace-ui';

type Product = { id: string; name: string; sku: string; unit: string; sellingPrice: string; available: string };
type Customer = { id: string; name: string; phone: string };
type CartItem = { productId: string; name: string; quantity: string; expectedPrice: string };
type Quote = { items: { productId: string; name: string; sku: string; unit: string; quantity: string; unitPrice: string; lineTotal: string; available: string; priceChanged: boolean }[]; subtotal: string; discount: string; tax: string; total: string };
type Hold = { id: string; label: string; version: number; createdAt: string; customer: Customer | null };
type Checkout = { outletId: string; items: { productId: string; quantity: string; expectedPrice: string }[]; idempotencyKey: string; method: string; tendered: string; manualConfirmed: boolean; holdId?: string; holdVersion?: number; customerId?: string };
type Sale = { id: string; receiptNo: string; createdAt: string; total: string; subtotal: string; discount: string; tax: string; receiptSnapshot: { business: string; outlet: string; address: string; cashier: string; timezone: string; customer?: { name: string } }; items: Quote['items']; payment: { method: string; status: string; tendered: string; change: string } };
const money = (value: string) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 }).format(Number(value));
const incrementQuantity = (value: string) => { const [whole, fraction = ''] = value.split('.'); return `${Number(whole || 0) + 1}${fraction ? `.${fraction}` : ''}`; };

export function PosWorkspace() { return <AppShell><OutletPos/></AppShell>; }
function OutletPos() { const { outletId } = useSession(); return <Pos key={outletId}/>; }
function Pos() {
  const { user, can, outletId, outlets } = useSession();
  const [products, setProducts] = useState<Product[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [search, setSearch] = useState('');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]), [category, setCategory] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]), [quote, setQuote] = useState<Quote | null>(null), [holds, setHolds] = useState<Hold[]>([]), [activeHold, setActiveHold] = useState<Hold | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null), [customerOpen, setCustomerOpen] = useState(false), [customerSearch, setCustomerSearch] = useState(''), [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [revision, setRevision] = useState(0);
  const [payOpen, setPayOpen] = useState(false), [holdOpen, setHoldOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [history, setHistory] = useState<Sale[]>([]), [historyPage, setHistoryPage] = useState(1), [historyTotal, setHistoryTotal] = useState(0);
  const [method, setMethod] = useState('cash'), [tendered, setTendered] = useState(''), [confirmed, setConfirmed] = useState(false), [holdLabel, setHoldLabel] = useState('');
  const [pending, setPending] = useState<Checkout | null>(null), [recoveryLoaded, setRecoveryLoaded] = useState(false), [receipt, setReceipt] = useState<Sale | null>(null), [reprint, setReprint] = useState(false);
  const actionLock = useRef(false);
  const recoveryKey = `foxbiz-checkout:${user.id}:${outletId}`;
  const customerKey = `foxbiz-customer:${user.id}:${outletId}`;
  const allowed = can('pos.read');
  const holdAllowed = can('pos.hold');
  const cartBody = () => ({ outletId, items: cart.map(({ productId, quantity, expectedPrice }) => ({ productId, quantity, expectedPrice })) });
  useEffect(() => {
    try { const stored = sessionStorage.getItem(recoveryKey); if (stored) setPending(JSON.parse(stored)); } catch { setError('Penyimpanan checkout tidak dapat dibaca. Periksa riwayat transaksi sebelum membayar ulang.'); }
    try { const stored = sessionStorage.getItem(customerKey); if (stored) { const value = JSON.parse(stored) as Customer; if (value?.id && value?.name) setCustomer(value); } } catch { /* Pilihan pelanggan dapat dibuat ulang. */ }
    setRecoveryLoaded(true);
  }, [recoveryKey, customerKey]);
  useEffect(() => {
    if (!allowed || !outletId) return;
    const controller = new AbortController();
    api<{ items: Product[]; total: number }>(`pos/products?outletId=${outletId}&page=${page}&search=${encodeURIComponent(search)}${category ? `&categoryId=${category}` : ''}`, { signal: controller.signal })
      .then((data) => { setProducts(data.items); setTotal(data.total); setError(''); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, outletId, page, search, category, revision]);
  useEffect(() => {
    if (!allowed || !outletId) return;
    const controller = new AbortController();
    api<{ id: string; name: string }[]>(`pos/categories?outletId=${outletId}`, { signal: controller.signal }).then(setCategories).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [allowed, outletId, revision]);
  useEffect(() => {
    if (!allowed || !outletId || !holdAllowed) return;
    const controller = new AbortController();
    api<Hold[]>(`pos/holds?outletId=${outletId}`, { signal: controller.signal }).then(setHolds).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [allowed, outletId, revision, holdAllowed]);
  useEffect(() => {
    const query = customerSearch.trim();
    if (!allowed || !outletId || !customerOpen || query.length < 2) { setCustomerResults([]); return; }
    const controller = new AbortController();
    api<Customer[]>(`pos/customers?outletId=${outletId}&search=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then(setCustomerResults).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [allowed, outletId, customerOpen, customerSearch]);
  function chooseCustomer(value: Customer) { setCustomer(value); sessionStorage.setItem(customerKey, JSON.stringify(value)); setCustomerOpen(false); setCustomerSearch(''); setCustomerResults([]); setMessage(`Pelanggan ${value.name} dipilih untuk transaksi ini.`); }
  function clearCustomer() { setCustomer(null); sessionStorage.removeItem(customerKey); setCustomerSearch(''); setCustomerResults([]); }
  // Any edit invalidates the server quote; the next review fetches fresh prices and stock.
  function editCart(items: CartItem[]) { setCart(items); setQuote(null); setConfirmed(false); }
  async function action(work: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    try { await work(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); actionLock.current = false; }
  }
  function complete(sale: Sale) {
    sessionStorage.removeItem(recoveryKey); sessionStorage.removeItem(customerKey); setPending(null); setReceipt(sale); setReprint(false); setCart([]); setQuote(null); setActiveHold(null); setPayOpen(false); setConfirmed(false); setTendered(''); setCustomer(null); setMessage('Penjualan berhasil dicatat.'); setRevision((value) => value + 1);
  }
  async function review() {
    await action(async () => {
      const data = await api<Quote>('pos/quote', { method: 'POST', body: cartBody() });
      setQuote(data); setConfirmed(false); setMethod('cash'); setTendered(''); setPayOpen(true);
      if (data.items.some((item) => item.priceChanged)) setMessage('Harga berubah. Harga terbaru sudah ditampilkan; tinjau total sebelum membayar.');
      setCart(data.items.map((item) => ({ productId: item.productId, name: item.name, quantity: item.quantity, expectedPrice: item.unitPrice })));
    });
  }
  async function pay() {
    if (!quote) return;
    await action(async () => {
      const payload: Checkout = { ...cartBody(), idempotencyKey: crypto.randomUUID(), method, tendered: method === 'edc' ? quote.total : tendered, manualConfirmed: method === 'edc' && confirmed, ...(activeHold ? { holdId: activeHold.id, holdVersion: activeHold.version } : {}), ...(customer ? { customerId: customer.id } : {}) };
      // Persist BEFORE sending; an unknown outcome always keeps the same immutable payload/key.
      sessionStorage.setItem(recoveryKey, JSON.stringify(payload)); setPending(payload);
      try { complete(await api<Sale>('sales', { method: 'POST', body: payload })); }
      catch (err) {
        if (err instanceof ApiError && [400, 403, 404, 409].includes(err.status)) { sessionStorage.removeItem(recoveryKey); setPending(null); setPayOpen(false); setQuote(null); setConfirmed(false); }
        throw err;
      }
    });
  }
  async function recover(retry: boolean) {
    if (!pending) return;
    await action(async () => {
      try { complete(await api<Sale>(`sales/by-key/${pending.idempotencyKey}?outletId=${outletId}`)); }
      catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) throw err;
        if (!retry) { setMessage('Belum ditemukan transaksi untuk key ini. Gunakan Kirim ulang aman untuk melanjutkan dengan pembayaran yang sama.'); return; }
        try { complete(await api<Sale>('sales', { method: 'POST', body: pending })); }
        catch (retryError) {
          if (retryError instanceof ApiError && [400, 403, 404, 409].includes(retryError.status)) {
            sessionStorage.removeItem(recoveryKey); setPending(null); setCart(pending.items.map((item) => ({ ...item, name: products.find((product) => product.id === item.productId)?.name ?? item.productId }))); setMessage('Checkout ditolak. Keranjang dikembalikan untuk ditinjau; periksa terminal sebelum memproses EDC lagi.');
          }
          throw retryError;
        }
      }
    });
  }
  async function saveHold() {
    await action(async () => {
      await api('pos/holds', { method: 'POST', body: { ...cartBody(), label: holdLabel, ...(customer ? { customerId: customer.id } : {}) } }); setHoldOpen(false); setCart([]); setQuote(null); setActiveHold(null); clearCustomer(); setHoldLabel(''); setMessage('Keranjang ditahan. Stok belum dipesan.'); setRevision((value) => value + 1);
    });
  }
  async function resume(id: string) {
    await action(async () => {
      const { hold, quote: data } = await api<{ hold: Hold; quote: Quote }>(`pos/holds/${id}`); setActiveHold(hold); setQuote(null); setCart(data.items.map((item) => ({ productId: item.productId, name: item.name, quantity: item.quantity, expectedPrice: item.unitPrice })));
      setCustomer(hold.customer ?? null); if (hold.customer) sessionStorage.setItem(customerKey, JSON.stringify(hold.customer)); else sessionStorage.removeItem(customerKey);
      setMessage(data.items.some((item) => item.priceChanged) ? 'Hold dilanjutkan dengan harga terbaru. Tinjau perubahan sebelum membayar.' : 'Hold dilanjutkan. Stok diperiksa kembali saat checkout.');
    });
  }
  async function loadHistory(nextPage = 1) {
    await action(async () => { const result = await api<{ items: Sale[]; total: number }>(`sales?outletId=${outletId}&page=${nextPage}`); setHistory(result.items); setHistoryTotal(result.total); setHistoryPage(nextPage); setHistoryOpen(true); });
  }
  if (!allowed) return <PermissionDenied/>;
  if (!outletId) return <><PageTitle title="Point of Sale" description="Penjualan baru"/><Notice>Belum ada outlet aktif dalam akses Anda.</Notice></>;
  const locked = busy || !!pending || !recoveryLoaded;
  const customerLocked = locked || !!activeHold?.customer;
  const cartCount = cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + Math.round((Number(item.quantity) || 0) * Number(item.expectedPrice) * 100) / 100, 0);
  const invalidCart = cart.some((item) => !/^\d+(\.\d{1,3})?$/.test(item.quantity) || Number(item.quantity) <= 0);
  function addProduct(product: Product) {
    const existing = cart.find((item) => item.productId === product.id);
    editCart(existing ? cart.map((item) => item.productId === product.id ? { ...item, quantity: incrementQuantity(item.quantity) } : item) : [...cart, { productId: product.id, name: product.name, quantity: '1', expectedPrice: product.sellingPrice }]);
  }
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3"><PageTitle title="Point of Sale" description={`Penjualan baru · ${outlets.find((outlet) => outlet.id === outletId)?.name ?? ''} · ${outlets.find((outlet) => outlet.id === outletId)?.code ?? ''}`}/><Button variant="secondary" disabled={busy} onClick={() => void loadHistory()}><ClipboardList size={17}/>Riwayat & struk</Button></div>
    {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
    {pending && <Card className="mb-6 border-amber-300 p-4"><h2 className="font-semibold">Periksa status pembayaran</h2><p className="my-3 text-sm text-fox-secondary">Respons checkout belum dipastikan. Periksa status atau kirim ulang permintaan yang sama. Jangan meminta pembayaran ulang di terminal.</p><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void recover(false)}>Periksa status</Button><Button variant="secondary" disabled={busy} onClick={() => void recover(true)}>Kirim ulang aman</Button></div></Card>}
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
      <section aria-label="Katalog POS" className="min-w-0">
        <div className="relative"><Search size={18} className="pointer-events-none absolute left-3 top-3.5 text-fox-secondary"/><Input aria-label="Cari produk POS" placeholder="Cari produk, SKU, atau scan barcode..." maxLength={160} className="bg-white pl-10" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}/></div>
        <div className="my-4 flex flex-wrap gap-2" role="group" aria-label="Filter kategori POS">{[{ id: '', name: 'Semua' }, ...categories].map((item) => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setPage(1); }} className={`min-h-11 max-w-full break-words rounded-full border px-4 py-2 text-xs font-medium transition ${category === item.id ? 'border-fox-blue bg-fox-blue text-white' : 'border-fox-border bg-white text-fox-secondary hover:border-fox-blue'}`}>{item.name}</button>)}</div>
        {loading ? <Notice>Memuat produk...</Notice> : <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{products.map((product) => {
            const selected = cart.find((item) => item.productId === product.id);
            return <button key={product.id} disabled={locked || Number(product.available) <= 0} className={`group flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-white text-left transition hover:-translate-y-0.5 hover:border-fox-blue hover:shadow-sm disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-fox-blue ring-1 ring-fox-blue/20' : 'border-fox-border'}`} aria-label={`Tambah ${product.name}`} onClick={() => addProduct(product)}>
              <span className="relative flex h-28 w-full items-center justify-center bg-fox-subtle text-fox-info sm:h-32"><Package size={40} strokeWidth={1.2}/>{selected && <span className="absolute right-2 top-2 rounded-full bg-fox-blue px-2 py-1 text-xs font-bold text-white">{selected.quantity}</span>}<span className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full border border-fox-border bg-white"><Plus size={16}/></span></span>
              <span className="flex w-full flex-1 flex-col p-3"><b className="break-words text-sm leading-5">{product.name}</b><span className="mt-1 block break-all text-[11px] text-fox-secondary">{product.sku}</span><span className="mt-3 block font-bold text-fox-info">{money(product.sellingPrice)}</span><span className={`mt-1 block text-[11px] ${Number(product.available) <= 0 ? 'text-fox-danger' : 'text-fox-secondary'}`}>{Number(product.available) <= 0 ? 'Stok habis' : `${product.available} ${product.unit} tersedia`}</span></span>
            </button>;
          })}</div>
          {!products.length && <Card className="p-6 text-center"><Package className="mx-auto text-fox-secondary" size={36} strokeWidth={1.2}/><Notice>Tidak ada produk aktif yang cocok.</Notice><p className="text-xs leading-5 text-fox-secondary">Tambahkan produk dan isi stok outlet melalui Produk dan Inventori untuk mulai berjualan.</p></Card>}
          <Pager page={page} total={total} setPage={setPage}/><Button variant="ghost" disabled={busy} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14}/>Muat ulang produk</Button>
        </>}
      </section>
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-5" aria-label="Pesanan saat ini"><Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-fox-border p-4"><h2 className="flex items-center gap-2 font-bold"><ShoppingCart size={19}/>Keranjang <Badge>{cart.length} produk</Badge>{activeHold && <Badge>Hold</Badge>}</h2><Button variant="ghost" disabled={locked || !cart.length} className="text-xs text-fox-danger" onClick={() => { editCart([]); setActiveHold(null); clearCustomer(); }}>Kosongkan</Button></div>
        <div className="p-4"><div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-fox-subtle p-3" data-testid="pos-customer"><div className="min-w-0 text-sm"><p className="text-[11px] text-fox-secondary">Pelanggan (opsional)</p>{customer ? <><b className="mt-1 block break-words">{customer.name}</b><span className="block break-all text-xs text-fox-secondary">{customer.phone}</span></> : <p className="mt-1 text-sm">Pelanggan umum</p>}</div><div className="flex flex-wrap gap-1"><Button variant="secondary" className="text-xs" disabled={customerLocked} onClick={() => setCustomerOpen(true)}>{customer ? 'Ganti' : 'Pilih pelanggan'}</Button>{customer && <Button variant="ghost" disabled={customerLocked} onClick={clearCustomer}>Hapus</Button>}</div>{activeHold?.customer && <p className="text-xs text-fox-secondary">Pelanggan mengikuti keranjang hold ini. Kosongkan keranjang untuk memulai transaksi lain.</p>}</div></div>
        {!cart.length ? <div className="px-5 py-10 text-center"><ShoppingCart size={38} strokeWidth={1.2} className="mx-auto mb-3 text-fox-secondary"/><p className="text-sm font-medium">Keranjang masih kosong</p><p className="mt-2 text-xs leading-5 text-fox-secondary">Pilih produk untuk memulai penjualan.</p></div> : <div className="max-h-[480px] space-y-3 overflow-y-auto px-4 pb-4">{cart.map((item) => <div key={item.productId} className="border-b border-fox-border pb-3 last:border-0"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><b className="break-words text-sm">{item.name}</b><span className="mt-1 block text-xs text-fox-secondary">{money(item.expectedPrice)} / satuan</span></div><Button variant="ghost" disabled={locked} aria-label={`Hapus ${item.name}`} onClick={() => editCart(cart.filter((row) => row.productId !== item.productId))}><Trash2 size={15}/></Button></div><div className="mt-2 flex flex-wrap items-end justify-between gap-2"><div><label htmlFor={`qty-${item.productId}`} className="text-[10px] text-fox-secondary">Kuantitas {item.name}</label><div className="mt-1 flex items-center gap-1"><Button variant="secondary" className="w-9 px-0" disabled={locked || Number(item.quantity) <= 1} aria-label={`Kurangi ${item.name}`} onClick={() => editCart(cart.map((row) => row.productId === item.productId ? { ...row, quantity: String(Math.round((Number(row.quantity) - 1) * 1000) / 1000) } : row))}><Minus size={14}/></Button><Input id={`qty-${item.productId}`} type="number" min="0.001" max="99999999.999" step="0.001" disabled={locked} value={item.quantity} className="w-20 px-2 text-center" onChange={(event) => editCart(cart.map((row) => row.productId === item.productId ? { ...row, quantity: event.target.value } : row))}/><Button variant="secondary" className="w-9 px-0" disabled={locked} aria-label={`Tambah satu ${item.name}`} onClick={() => editCart(cart.map((row) => row.productId === item.productId ? { ...row, quantity: incrementQuantity(row.quantity) } : row))}><Plus size={14}/></Button></div></div><b className="pb-3 text-sm tabular-nums">{money(String((Number(item.quantity) || 0) * Number(item.expectedPrice)))}</b></div></div>)}</div>}
        <div className="border-t border-fox-border bg-fox-subtle p-4"><div className="space-y-2 text-sm"><p className="flex justify-between gap-2 text-fox-secondary"><span>Subtotal · {new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(cartCount)} item</span><span>{money(String(cartSubtotal))}</span></p><p className="flex justify-between text-fox-secondary"><span>Diskon</span><span>{money('0')}</span></p><p className="flex justify-between text-fox-secondary"><span>Pajak</span><span>{money('0')}</span></p><p className="flex justify-between gap-2 border-t border-fox-border pt-3 text-lg font-bold"><span>Perkiraan total</span><span className="text-right text-fox-info">{money(String(cartSubtotal))}</span></p></div><p className="my-3 text-[11px] leading-5 text-fox-secondary">Harga dan stok diperiksa kembali saat pembayaran. Pajak dan diskon belum dikonfigurasi.</p>{can('pos.checkout') && <Button className="w-full" disabled={locked || !cart.length || invalidCart} onClick={() => void review()}>{busy ? 'Memproses...' : 'Tinjau pembayaran'}</Button>}{can('pos.hold') && <Button className="mt-2 w-full" variant="secondary" disabled={locked || !cart.length || invalidCart || !!activeHold} onClick={() => setHoldOpen(true)}><Pause size={15}/>Tahan keranjang</Button>}</div>
      </Card>{can('pos.hold') && <Card className="p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><ClipboardList size={17}/>Daftar pesanan <Badge>{holds.length}</Badge></h2><p className="mt-2 text-xs text-fox-secondary">Keranjang ditahan · milik Anda di outlet ini</p>{!holds.length && <p className="mt-4 text-xs text-fox-secondary">Belum ada keranjang ditahan.</p>}{holds.map((hold) => <div key={hold.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-fox-border pt-3"><span className="min-w-0 break-words text-sm">{hold.label}{hold.customer && <span className="block text-xs text-fox-secondary">{hold.customer.name} · {hold.customer.phone}</span>}</span><Button variant="secondary" disabled={locked || !!cart.length} onClick={() => void resume(hold.id)}>Lanjutkan</Button></div>)}<p className="mt-3 text-[11px] text-fox-secondary">Stok belum dipesan sampai pembayaran dicatat.</p></Card>}</aside>
    </div>
    <Modal open={customerOpen} onOpenChange={(open) => { if (!busy) { setCustomerOpen(open); if (!open) { setCustomerSearch(''); setCustomerResults([]); } } }} title="Pilih pelanggan" description="Pencarian pelanggan bersifat opsional. Checkout tanpa pelanggan tetap dapat dilakukan.">
      <Input aria-label="Cari pelanggan POS" placeholder="Ketik nama atau nomor telepon (minimal 2 karakter)..." maxLength={160} value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)}/>
      <div className="my-4 space-y-2">{customerSearch.trim().length < 2 ? <Notice>Ketik minimal dua karakter untuk mencari pelanggan.</Notice> : customerResults.map((value) => <button key={value.id} type="button" className={`flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm hover:border-fox-blue hover:bg-fox-soft ${customer?.id === value.id ? 'border-fox-blue bg-fox-soft' : 'border-fox-border'}`} onClick={() => chooseCustomer(value)}><span><b className="block break-words">{value.name}</b><span className="break-all text-xs text-fox-secondary">{value.phone}</span></span>{customer?.id === value.id && <Badge>Dipilih</Badge>}</button>)}{customerSearch.trim().length >= 2 && !customerResults.length && <Notice>Tidak ada pelanggan yang cocok.</Notice>}</div>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => { clearCustomer(); setCustomerOpen(false); }}>Checkout tanpa pelanggan</Button><Button type="button" variant="ghost" onClick={() => setCustomerOpen(false)}>Tutup</Button></div>
    </Modal>
    <Modal open={payOpen && !pending} onOpenChange={(open) => { if (!busy) { setPayOpen(open); setConfirmed(false); } }} title="Pembayaran" description="Tinjau jumlah dan metode pembayaran sebelum mencatat penjualan.">
      {quote && <form onSubmit={(event) => { event.preventDefault(); void pay(); }}><div className="space-y-2">{quote.items.map((item) => <div key={item.productId} className="flex justify-between gap-3 text-sm"><span>{item.name} × {item.quantity}{Number(item.available) < Number(item.quantity) && <span className="block text-fox-danger">Stok tidak cukup</span>}</span><b>{money(item.lineTotal)}</b></div>)}<div className="border-t border-fox-border pt-3 text-sm"><p>Subtotal: {money(quote.subtotal)}</p><p>Diskon: {money(quote.discount)} · Pajak: {money(quote.tax)}</p></div><p className="text-xl font-bold">Total {money(quote.total)}</p></div>
        <fieldset disabled={busy} className="my-5 space-y-4"><label className="block text-sm font-medium">Metode pembayaran<select className={`${selectClass} mt-2`} value={method} onChange={(event) => { setMethod(event.target.value); setConfirmed(false); }}><option value="cash">Tunai</option>{can('pos.edc.confirm') && <option value="edc">EDC eksternal · konfirmasi manual</option>}</select></label>{method === 'cash' ? <><label className="block text-sm font-medium">Uang diterima (Rp)<Input type="number" required min={quote.total} max="999999999999.99" step="0.01" value={tendered} onChange={(event) => setTendered(event.target.value)} className="mt-2"/></label><p className="text-sm">Kembalian perkiraan: {money(String(Math.max(0, Number(tendered) - Number(quote.total))))}</p></> : <><Notice>Proses {money(quote.total)} pada terminal EDC eksternal. Setelah terminal menyatakan berhasil, konfirmasikan secara manual di bawah ini.</Notice><label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/>Saya telah memeriksa terminal EDC dan mengonfirmasi pembayaran berhasil secara manual.</label></>}</fieldset>
        <Button type="submit" disabled={busy || quote.items.some((item) => Number(item.available) < Number(item.quantity)) || (method === 'edc' ? !confirmed : !tendered || Number(tendered) < Number(quote.total))}>{busy ? 'Mencatat...' : 'Catat pembayaran'}</Button>
      </form>}
    </Modal>
    <Modal open={holdOpen} onOpenChange={(open) => { if (!busy) setHoldOpen(open); }} title="Tahan keranjang" description="Stok belum dipesan. Harga akan diperiksa saat keranjang dilanjutkan."><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveHold(); }}><label className="block text-sm font-medium">Nama keranjang<Input required maxLength={80} value={holdLabel} onChange={(event) => setHoldLabel(event.target.value)} className="mt-2"/></label><Button type="submit" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan hold'}</Button></form></Modal>
    <Modal open={historyOpen} onOpenChange={setHistoryOpen} title="Riwayat penjualan" description="Penjualan lunas pada outlet aktif.">{history.map((sale) => <div key={sale.id} className="mb-4 rounded-lg border border-fox-border p-3"><p className="break-all text-xs">{sale.receiptNo}</p><p className="my-2 text-sm">{new Date(sale.createdAt).toLocaleString('id-ID')} · {money(sale.total)}</p><Button variant="secondary" disabled={busy} onClick={() => void action(async () => { const data = await api<Sale>(`sales/${sale.id}`); setHistoryOpen(false); setReceipt(data); setReprint(true); })}>Buka struk</Button></div>)}{!history.length && <Notice>Belum ada penjualan di outlet ini.</Notice>}<Pager page={historyPage} total={historyTotal} setPage={(value) => void loadHistory(value)}/></Modal>
    <Modal open={receipt !== null} onOpenChange={(open) => { if (!open) setReceipt(null); }} title="Penjualan berhasil" description="Pembayaran dan pengurangan stok sudah tercatat.">{receipt && <><Receipt sale={receipt} reprint={reprint}/><Button onClick={() => { window.print(); setReprint(true); }}>Cetak struk</Button><p className="mt-3 text-xs text-fox-secondary">Jika printer gagal, buka kembali struk dari riwayat. Penjualan tetap tersimpan.</p></>}</Modal>
  </>;
}
function Receipt({ sale, reprint }: { sale: Sale; reprint: boolean }) {
  const snapshot = sale.receiptSnapshot;
  return <article id="foxbiz-receipt" className="my-4 space-y-3 rounded-lg border border-dashed border-fox-border p-4 text-sm"><header className="text-center"><h2 className="text-lg font-bold">{snapshot.business}</h2><p>{snapshot.outlet}</p><p>{snapshot.address}</p>{reprint && <b>SALINAN / CETAK ULANG</b>}</header><p className="break-all text-xs">{sale.receiptNo}</p><p>{new Date(sale.createdAt).toLocaleString('id-ID', { timeZone: snapshot.timezone })} ({snapshot.timezone})</p><p>Kasir: {snapshot.cashier}</p>{snapshot.customer && <p>Pelanggan: {snapshot.customer.name}</p>}<div className="space-y-3 border-y border-dashed border-fox-border py-3">{sale.items.map((item) => <div key={item.productId}><b>{item.name}</b><p className="text-xs">{item.sku}</p><div className="flex justify-between gap-2"><span>{item.quantity} {item.unit} × {money(item.unitPrice)}</span><span>{money(item.lineTotal)}</span></div></div>)}</div><p>Subtotal: {money(sale.subtotal)}</p><p>Diskon: {money(sale.discount)} · Pajak: {money(sale.tax)}</p><p className="text-lg font-bold">Total: {money(sale.total)}</p><p>{sale.payment.method === 'cash' ? 'Tunai diterima' : 'EDC dikonfirmasi manual'}: {money(sale.payment.tendered)}</p><p>Kembalian: {money(sale.payment.change)}</p><p className="text-center">Terima kasih</p></article>;
}
