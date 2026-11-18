'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Bell, ChevronDown, LayoutGrid, Menu, Search } from 'lucide-react';
import { Button, Input, Modal, SidebarItem } from '@foxbiz/ui';
import { modules } from './modules';
import { SessionProvider, useSession } from './session-provider';
import { api } from '../lib/api';

export function AppShell({ children }: { children: ReactNode }) {
  return <SessionProvider><Shell>{children}</Shell></SessionProvider>;
}

function Shell({ children }: { children: ReactNode }) {
  const { user, outlets, outletId, setOutletId, can } = useSession();
  const path = usePathname();
  const [dialog, setDialog] = useState<'menu' | 'search' | 'notifications' | 'profile' | 'help' | null>(null);
  const [search, setSearch] = useState('');
  const title = { menu: 'Semua modul', search: 'Cari modul', notifications: 'Notifikasi', profile: 'Profil Anda', help: 'Pusat bantuan' };
  const visibleModules = modules.filter((item) => {
    const permission = ({ products: 'catalog.read', inventory: 'inventory.read', pos: 'pos.read', purchasing: 'purchasing.read', finance: 'finance.read', crm: 'crm.read', hris: 'hris.read' } as Record<string, string>)[item.slug];
    if (item.slug === 'settings') return ['organization.read', 'users.read', 'roles.read', 'audit.read'].some(can);
    return !permission || can(permission);
  });
  const links = visibleModules.filter((item) => item.label.toLowerCase().includes(search.toLowerCase()));
  function open(value: typeof dialog) { setSearch(''); setDialog(value); }
  return <div className="flex min-h-dvh">
    <aside className="sticky top-0 hidden h-dvh w-[208px] shrink-0 flex-col border-r border-fox-border bg-white p-3 xl:flex">
      <Link href="/" className="mb-6 flex h-14 items-center gap-2 px-2" aria-label="FoxBiz — Dashboard"><Image src="/foxi-mascot.png" alt="" width={44} height={32} className="h-8 w-11 object-contain"/><span><b className="text-xl tracking-tight">Fox<span className="text-fox-blue">Biz</span></b><span className="mt-0.5 block text-[8px] text-fox-secondary">POS &amp; Business Management System</span></span></Link>
      <nav aria-label="Navigasi utama" className="space-y-1">{visibleModules.map(({ slug, label, icon: Icon }) => <SidebarItem key={slug} href={`/${slug}`} active={path === `/${slug}`}><Icon size={17} strokeWidth={1.7}/>{label}</SidebarItem>)}</nav>
      <div className="mt-auto flex items-center gap-2 rounded-xl bg-fox-subtle p-3"><Image src="/foxi-mascot.png" alt="" width={56} height={40} className="h-10 w-14 shrink-0 object-contain"/><div><p className="text-xs font-semibold">Butuh bantuan?</p><button onClick={() => open('help')} className="min-h-11 text-xs text-fox-info underline underline-offset-2">Buka panduan</button></div></div>
    </aside>
    <div className="min-w-0 flex-1">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-fox-border bg-white/90 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2"><Button variant="ghost" className="w-11 shrink-0 px-0 xl:hidden" aria-label="Buka menu" onClick={() => open('menu')}><Menu size={20}/></Button><span className="hidden text-lg font-bold min-[420px]:inline xl:hidden">Fox<span className="text-fox-blue">Biz</span></span><select aria-label="Outlet aktif" value={outletId} onChange={(event) => setOutletId(event.target.value)} className="h-11 min-w-0 max-w-36 rounded-lg border border-fox-border bg-white px-2 text-xs sm:max-w-64">{outlets.length ? outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name} · {outlet.code}</option>) : <option value="">Belum ada akses outlet</option>}</select></div>
        <div className="flex items-center gap-1 sm:gap-3"><Button variant="secondary" className="px-3 text-fox-secondary" onClick={() => open('search')} aria-label="Cari modul"><Search size={16}/><span className="hidden md:inline">Cari modul...</span></Button><Button variant="ghost" className="relative w-11 px-0" onClick={() => open('notifications')} aria-label="Buka notifikasi"><Bell size={19}/></Button><Button variant="ghost" className="px-1" onClick={() => open('profile')} aria-label="Buka profil"><span className="grid h-8 w-8 place-items-center rounded-full bg-fox-soft text-fox-info">{user.name[0]}</span><ChevronDown size={13}/></Button></div>
      </header>
      <div className="mx-auto max-w-[1600px] px-4 py-5 pb-24 sm:px-6 md:pb-6 xl:p-6">{children}</div>
      <nav aria-label="Navigasi mobile" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-fox-border bg-white pb-[env(safe-area-inset-bottom)] md:hidden">{visibleModules.slice(0,3).map(({ slug, label, icon: Icon }) => <Link key={slug} href={`/${slug}`} aria-current={path === `/${slug}` ? 'page' : undefined} className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs ${path === `/${slug}` ? 'font-semibold text-fox-info' : 'text-fox-secondary'}`}><Icon size={20}/>{label === 'Dashboard' ? 'Beranda' : label}</Link>)}<button onClick={() => open('menu')} className="flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-fox-secondary"><LayoutGrid size={20}/>Lainnya</button></nav>
    </div>
    <Modal open={dialog !== null} onOpenChange={(value) => { if (!value) setDialog(null); }} title={dialog ? title[dialog] : ''} description={dialog === 'menu' || dialog === 'search' ? 'Pilih modul FoxBiz yang ingin dibuka.' : user.tenantName}>
      {(dialog === 'search' || dialog === 'menu') && <><Input aria-label="Cari nama modul" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari modul..."/><nav className="mt-3 space-y-1" aria-label="Daftar modul">{links.map(({ slug, label, icon: Icon }) => <Link onClick={() => setDialog(null)} key={slug} href={`/${slug}`} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-fox-soft"><Icon size={17}/>{label}</Link>)}{links.length === 0 && <p className="py-4 text-sm text-fox-muted">Modul tidak ditemukan.</p>}</nav></>}
      {dialog === 'notifications' && <p className="rounded-xl bg-fox-subtle p-4 text-sm text-fox-secondary">Lihat Tugas &amp; Peringatan di dashboard untuk stok, pembelian, dan absensi pada outlet aktif.</p>}
      {dialog === 'profile' && <div className="space-y-4 text-sm"><p><b>{user.name}</b> · {user.role?.name ?? 'Belum ada role'}</p><p className="text-fox-secondary">{user.email}</p><label className="block">Outlet aktif<select aria-label="Pilih outlet profil" value={outletId} onChange={(event) => setOutletId(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-fox-border bg-white px-3">{outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name} · {outlet.code}</option>)}{!outlets.length && <option value="">Belum ada akses outlet</option>}</select></label><Button variant="secondary" onClick={async () => { await api('auth/logout', { method: 'POST', body: {} }); window.location.assign('/login'); }}>Keluar</Button></div>}
      {dialog === 'help' && <div className="space-y-3 text-sm leading-6 text-fox-secondary"><p><b className="text-fox-navy">Absensi HRIS.</b> Buka menu HRIS, pilih tab Kiosk Absensi, lalu pilih nama karyawan. Karyawan memasukkan PIN 6 digit dan mengambil foto masuk atau pulang. Foto wajib dan diberi watermark server.</p><p><b className="text-fox-navy">Karyawan dan outlet.</b> Tambah karyawan dari tab Karyawan. Karyawan dengan akses seluruh outlet otomatis muncul di kiosk outlet baru. Outlet dan produk baru tetap dapat ditambahkan dari Pengaturan dan Produk.</p><p><b className="text-fox-navy">Rekap.</b> Tab Rekap &amp; Ekspor menyediakan rekap harian, rekap bulanan, tautan foto JPG, dan unduhan PDF. Foto disimpan 180 hari.</p><p>Untuk modul lain, gunakan menu navigasi atau tombol Cari modul.</p></div>}
    </Modal>
  </div>;
}
