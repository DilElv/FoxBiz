import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const allowed = /^(auth\/(login|logout)|me|foundation\/outlets|organization|outlets(?:\/[a-f0-9-]{36})?|users(?:\/[a-f0-9-]{36})?|roles(?:\/[a-f0-9-]{36})?|permissions|categories(?:\/[a-f0-9-]{36})?|products(?:\/[a-f0-9-]{36})?|inventory\/(balances|movements|opening|threshold|destinations|documents(?:\/by-key\/[a-f0-9-]{36}|\/[a-f0-9-]{36}(?:\/receive)?)?)|audit-logs|pos\/(categories|products|quote|holds(?:\/[a-f0-9-]{36})?)|sales(?:\/(?:[a-f0-9-]{36}|by-key\/[a-f0-9-]{36}))?)$/;

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  const purchasingAllowed = /^(suppliers(?:\/[a-f0-9-]{36})?|purchasing\/products|purchase-orders(?:\/by-key\/[a-f0-9-]{36}|\/[a-f0-9-]{36}(?:\/(order|cancel))?)?|goods-receipts(?:\/by-key\/[a-f0-9-]{36})?)$/;
  const financeAllowed = /^finance\/(metadata|report|entries(?:\/by-key\/[a-f0-9-]{36}|\/[a-f0-9-]{36}\/void)?)$/;
  const crmAllowed = /^crm\/customers(?:\/[a-f0-9-]{36}(?:\/sales)?)?$/;
  const posCustomerAllowed = /^pos\/customers$/;
  if (!allowed.test(path) && !purchasingAllowed.test(path) && !financeAllowed.test(path) && !crmAllowed.test(path) && !posCustomerAllowed.test(path)) return NextResponse.json({ error: { message: 'Endpoint tidak ditemukan.' } }, { status: 404 });
  if (request.method !== 'GET') {
    if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ error: { message: 'Origin tidak diizinkan.' } }, { status: 403 });
    if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: { message: 'Gunakan JSON.' } }, { status: 415 });
  }
  const headers = new Headers({ 'Content-Type': 'application/json', Origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('Cookie', cookie);
  const tenantHeader = request.headers.get('x-tenant-id');
  if (tenantHeader) headers.set('x-tenant-id', tenantHeader);
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'}/api/v1/${path}${request.nextUrl.search}`, {
      method: request.method, headers, body: request.method === 'GET' ? undefined : await request.text(), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const result = new NextResponse(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const session = response.headers.get('set-cookie');
    if (session) result.headers.set('Set-Cookie', session);
    const requestId = response.headers.get('x-request-id');
    if (requestId) result.headers.set('X-Request-Id', requestId);
    return result;
  } catch {
    return NextResponse.json({ error: { message: 'API belum tersedia. Coba lagi sebentar.' } }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
