'use client';

import Image from 'next/image';
import { useState, type FormEvent } from 'react';
import { Button, Card, Input } from '@foxbiz/ui';
import { api } from '../../lib/api';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      await api('auth/login', { method: 'POST', body: { tenantSlug: String(fields.get('tenantSlug')).trim().toLowerCase(), email: String(fields.get('email')).trim(), password: fields.get('password') } });
      window.location.assign('/');
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return <main className="grid min-h-dvh place-items-center px-4 py-10"><div className="w-full max-w-md"><div className="mb-7 text-center"><Image src="/foxi-mascot.png" alt="Foxi, maskot FoxBiz" width={146} height={102} priority className="mx-auto"/><p className="mt-3 text-3xl font-bold">Fox<span className="text-fox-info">Biz</span></p><p className="mt-2 text-sm text-fox-secondary">Satu tempat untuk mengelola bisnis Anda.</p></div><Card className="p-6 sm:p-8"><h1 className="text-xl font-bold">Masuk ke FoxBiz</h1><p className="mb-6 mt-2 text-sm text-fox-secondary">Gunakan akun yang diberikan pengelola bisnis.</p><form onSubmit={login} className="space-y-4"><label className="block text-sm font-medium">Kode bisnis<Input name="tenantSlug" required pattern={'[a-z0-9\\-]{1,80}'} maxLength={80} autoComplete="organization" placeholder="contoh: toko-anda" className="mt-2"/></label><label className="block text-sm font-medium">Email<Input name="email" type="email" required maxLength={254} autoComplete="username" className="mt-2"/></label><label className="block text-sm font-medium">Password<Input name="password" type="password" required minLength={8} maxLength={72} autoComplete="current-password" className="mt-2"/></label>{error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-fox-danger">{error}</p>}<Button disabled={busy} type="submit" className="w-full">{busy ? 'Memproses...' : 'Masuk'}</Button></form></Card><p className="mt-5 text-center text-xs text-fox-muted">Hubungi pengelola bisnis untuk bantuan akun.</p></div></main>;
}
