'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Building2, Check, Eye, EyeOff, Store, Users } from 'lucide-react';
import { Button, Card, Input } from '@foxbiz/ui';
import { api, ApiError } from '../lib/api';

export function AuthForm({ register = false }: { register?: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [businessCode, setBusinessCode] = useState(false);
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get('password'));
    if (new TextEncoder().encode(password).length > 72) { setError('Password maksimum 72 byte. Gunakan password yang lebih pendek.'); return; }
    if (register && password !== fields.get('confirmPassword')) { setError('Konfirmasi password belum sama.'); return; }
    setBusy(true);
    try {
      await api(`auth/${register ? 'register' : 'login'}`, { method: 'POST', body: register ? {
        name: String(fields.get('name')).trim(), email: String(fields.get('email')).trim().toLowerCase(), password,
        businessName: String(fields.get('businessName')).trim(), tenantSlug: slug,
        outletName: String(fields.get('outletName')).trim(), outletCode: String(fields.get('outletCode')).trim().toUpperCase(),
      } : {
        email: String(fields.get('email')).trim().toLowerCase(), password,
        ...(businessCode && fields.get('tenantSlug') ? { tenantSlug: String(fields.get('tenantSlug')).trim().toLowerCase() } : {}),
      } });
      window.location.assign('/');
    } catch (err) {
      if (!register && err instanceof ApiError && err.status === 409) setBusinessCode(true);
      setError((err as Error).message); setBusy(false);
    }
  }

  return <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(440px,1fr)]">
    <section className="hidden flex-col justify-between bg-fox-navy p-12 text-white lg:flex xl:p-16">
      <Link href="/login" className="flex w-fit items-center gap-3"><Image src="/foxi-mascot.png" alt="" width={66} height={46} priority/><span className="text-3xl font-bold">Fox<span className="text-sky-300">Biz</span></span></Link>
      <div className="my-16 max-w-lg"><p className="mb-4 text-sm font-medium text-sky-300">RUANG KERJA BISNIS ANDA</p><h2 className="text-4xl font-bold leading-tight xl:text-5xl">Satu akun.<br/>Semua outlet Anda.</h2><p className="mt-6 leading-7 text-slate-300">Kelola penjualan, stok, dan kehadiran tim dari satu tempat. Mulai dari satu outlet, tambah cabang kapan pun bisnis Anda berkembang.</p><div className="mt-10 space-y-6">{[
        { icon: Building2, title: 'Bisnis milik Anda', detail: 'Akun owner dengan data bisnis yang terpisah.' },
        { icon: Store, title: 'Banyak outlet, kode berbeda', detail: 'Pindah outlet tanpa berganti akun.' },
        { icon: Users, title: 'Satu kiosk, banyak karyawan', detail: 'Absensi PIN dan foto sesuai outlet karyawan.' },
      ].map(({ icon: Icon, title, detail }) => <div key={title} className="flex gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10"><Icon size={21}/></span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-slate-300">{detail}</p></div></div>)}</div></div>
      <p className="text-xs text-slate-400">FoxBiz · POS &amp; Business Management System</p>
    </section>
    <section className="flex items-center justify-center px-4 py-10 sm:px-8"><div className={`w-full ${register ? 'max-w-xl' : 'max-w-md'}`}>
      <Link href="/login" className="mb-7 flex items-center justify-center gap-2 lg:hidden"><Image src="/foxi-mascot.png" alt="" width={58} height={40} priority/><span className="text-3xl font-bold">Fox<span className="text-fox-info">Biz</span></span></Link>
      <Card className="p-6 sm:p-8"><h1 className="text-2xl font-bold">{register ? 'Daftarkan bisnis Anda' : 'Masuk ke FoxBiz'}</h1><p className="mb-7 mt-2 text-sm leading-6 text-fox-secondary">{register ? 'Buat akun owner dan outlet pertama. Data bisnis baru dimulai kosong, siap diisi oleh Anda.' : 'Selamat datang kembali. Masuk untuk mengelola bisnis dan outlet Anda.'}</p>
        <form onSubmit={submit} className="space-y-5"><fieldset disabled={busy} className="space-y-5">
          {register && <label className="block text-sm font-medium">Nama lengkap<Input name="name" required minLength={2} maxLength={120} autoComplete="name" className="mt-2"/></label>}
          <label className="block text-sm font-medium">Email<Input name="email" type="email" required maxLength={254} autoComplete="username" placeholder="nama@bisnis.com" className="mt-2"/></label>
          <label className="block text-sm font-medium">Password<span className="relative mt-2 block"><Input name="password" type={showPassword ? 'text' : 'password'} required minLength={register ? 12 : 8} maxLength={72} autoComplete={register ? 'new-password' : 'current-password'} className="pr-12"/><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-fox-secondary">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span>{register && <span className="mt-2 block text-xs font-normal text-fox-secondary">Minimal 12 karakter, maksimum 72 byte.</span>}</label>
          {register ? <>
            <label className="block text-sm font-medium">Konfirmasi password<Input name="confirmPassword" type={showPassword ? 'text' : 'password'} required minLength={12} maxLength={72} autoComplete="new-password" className="mt-2"/></label>
            <div className="border-t border-fox-border pt-5"><h2 className="mb-4 font-semibold">Bisnis &amp; outlet pertama</h2><div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium sm:col-span-2">Nama bisnis<Input name="businessName" required minLength={2} maxLength={120} autoComplete="organization" className="mt-2" onChange={(event) => { if (!slugEdited) setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)); }}/></label>
              <label className="block text-sm font-medium sm:col-span-2">Kode bisnis<Input name="tenantSlug" required minLength={3} maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value.toLowerCase()); }} placeholder="contoh: kopi-nusantara" className="mt-2"/><span className="mt-2 block text-xs font-normal text-fox-secondary">Kode unik bisnis Anda. Setiap outlet juga memiliki kode tersendiri.</span></label>
              <label className="block text-sm font-medium">Nama outlet<Input name="outletName" required minLength={2} maxLength={120} placeholder="Outlet Pusat" className="mt-2"/></label>
              <label className="block text-sm font-medium">Kode outlet<Input name="outletCode" required maxLength={30} pattern="[A-Za-z0-9_\-]{1,30}" placeholder="PUSAT" className="mt-2 uppercase"/><span className="mt-2 block text-xs font-normal text-fox-secondary">Huruf, angka, tanda - atau _.</span></label>
            </div></div><p className="flex items-start gap-2 rounded-lg bg-fox-subtle p-3 text-xs leading-5 text-fox-secondary"><Check size={16} className="mt-0.5 shrink-0"/>Anda menjadi owner dan otomatis mendapat akses ke seluruh outlet yang ditambahkan.</p>
          </> : <>
            <button type="button" className="min-h-11 text-sm text-fox-info underline underline-offset-4" aria-expanded={businessCode} onClick={() => setBusinessCode(!businessCode)}>Gunakan kode bisnis (opsional)</button>
            {businessCode && <label className="block text-sm font-medium">Kode bisnis<Input name="tenantSlug" pattern="[a-z0-9\-]{1,80}" maxLength={80} autoComplete="organization" placeholder="Kode dari pengelola bisnis" className="mt-2"/><span className="mt-2 block text-xs font-normal text-fox-secondary">Isi jika email Anda digunakan untuk akun di beberapa bisnis.</span></label>}
          </>}
        </fieldset>{error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-fox-danger">{error}</p>}<Button disabled={busy} type="submit" className="w-full">{busy ? 'Memproses...' : register ? 'Daftar & mulai kelola bisnis' : 'Masuk'}</Button></form>
        <p className="mt-6 text-center text-sm text-fox-secondary">{register ? 'Sudah punya akun? ' : 'Belum punya akun? '}<Link href={register ? '/login' : '/register'} className="font-semibold text-fox-info underline underline-offset-4">{register ? 'Masuk' : 'Daftarkan bisnis'}</Link></p>
      </Card><p className="mt-5 text-center text-xs leading-5 text-fox-muted">{register ? 'Akun kasir dibuat oleh owner melalui Pengaturan → Pengguna.' : 'Karyawan melakukan absensi melalui kiosk outlet dengan PIN masing-masing.'}</p>
    </div></section>
  </main>;
}
