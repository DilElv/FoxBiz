'use client';
import { Button } from '@foxbiz/ui';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main role="alert" className="p-6"><h1 className="text-xl font-bold">Halaman belum berhasil dimuat.</h1><p className="my-4 text-fox-secondary">Coba muat kembali halaman ini.</p><Button onClick={reset}>Coba lagi</Button></main>; }
