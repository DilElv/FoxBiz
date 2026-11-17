'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, CurrentUser, Outlet, ApiError } from '../lib/api';
import { Button, Card } from '@foxbiz/ui';

type Session = { user: CurrentUser; outlets: Outlet[]; outletId: string; setOutletId: (value: string) => void; can: (permission: string) => boolean };
const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider dibutuhkan.');
  return session;
}
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ user: CurrentUser; outlets: Outlet[] } | null>(null);
  const [outletId, setOutlet] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api<{ user: CurrentUser }>('me', { signal: controller.signal }), api<{ outlets: Outlet[] }>('foundation/outlets', { signal: controller.signal })])
      .then(([{ user }, { outlets }]) => {
        const stored = localStorage.getItem(`foxbiz-outlet:${user.id}`);
        setOutlet(outlets.some((item) => item.id === stored) ? stored! : outlets[0]?.id ?? '');
        setSession({ user, outlets });
      }).catch((err) => { if (!controller.signal.aborted && !(err instanceof ApiError && err.status === 401)) setError(err.message); });
    return () => controller.abort();
  }, []);
  if (error) return <main className="mx-auto max-w-lg p-8"><Card className="p-6"><h1 className="text-xl font-bold">Koneksi belum tersedia</h1><p role="alert" className="my-4 text-sm text-fox-danger">{error}</p><Button onClick={() => window.location.reload()}>Coba lagi</Button></Card></main>;
  if (!session) return <main className="grid min-h-dvh place-items-center"><p role="status" className="text-sm text-fox-secondary">Memeriksa sesi...</p></main>;
  return <SessionContext.Provider value={{ ...session, outletId, setOutletId: (value) => { if (session.outlets.some((outlet) => outlet.id === value)) { setOutlet(value); localStorage.setItem(`foxbiz-outlet:${session.user.id}`, value); } }, can: (permission) => session.user.permissions.includes(permission) }}>{children}</SessionContext.Provider>;
}
