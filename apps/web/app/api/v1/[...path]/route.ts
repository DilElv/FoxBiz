import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const allowed = /^(auth\/(login|logout)|me|foundation\/outlets|dashboard|organization|outlets(?:\/[a-f0-9-]{36})?|users(?:\/[a-f0-9-]{36})?|roles(?:\/[a-f0-9-]{36})?|permissions|categories(?:\/[a-f0-9-]{36})?|products(?:\/[a-f0-9-]{36})?|inventory\/(balances|movements|opening|threshold|destinations|documents(?:\/by-key\/[a-f0-9-]{36}|\/[a-f0-9-]{36}(?:\/receive)?)?)|audit-logs|pos\/(categories|products|quote|holds(?:\/[a-f0-9-]{36})?)|sales(?:\/(?:[a-f0-9-]{36}|by-key\/[a-f0-9-]{36}))?)$/;
const hrisAllowed = /^hris\/(employees(?:\/[a-f0-9-]{36})?|kiosk|attendance(?:\/monthly|\/export)?|attendance\/(?:clock-in|clock-out)|attendance\/[a-f0-9-]{36}\/photo\/(?:in|out))$/;

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  const purchasingAllowed = /^(suppliers(?:\/[a-f0-9-]{36})?|purchasing\/products|purchase-orders(?:\/by-key\/[a-f0-9-]{36}|\/[a-f0-9-]{36}(?:\/(order|cancel))?)?|goods-receipts(?:\/by-key\/[a-f0-9-]{36})?)$/;
  const financeAllowed = /^finance\/(metadata|report|entries(?:\/by-key\/[a-f0-9-]{36}|\/[a-f0-9-]{36}\/void)?)$/;
  const crmAllowed = /^crm\/customers(?:\/[a-f0-9-]{36}(?:\/sales)?)?$/;
  const posCustomerAllowed = /^pos\/customers$/;
  if (!allowed.test(path) && !purchasingAllowed.test(path) && !financeAllowed.test(path) && !crmAllowed.test(path) && !posCustomerAllowed.test(path) && !hrisAllowed.test(path)) return NextResponse.json({ error: { message: 'Endpoint tidak ditemukan.' } }, { status: 404 });
  const contentType = request.headers.get('content-type') ?? '';
  const multipart = contentType.startsWith('multipart/form-data');
  if (request.method !== 'GET') {
    if (request.headers.get('origin') !== (process.env.WEB_ORIGIN ?? request.nextUrl.origin)) return NextResponse.json({ error: { message: 'Origin tidak diizinkan.' } }, { status: 403 });
    if (!multipart && !contentType.startsWith('application/json')) return NextResponse.json({ error: { message: 'Gunakan JSON atau unggahan foto.' } }, { status: 415 });
  }
  const headers = new Headers({ Origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  if (multipart) headers.set('Content-Type', contentType);
  else headers.set('Content-Type', 'application/json');
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('Cookie', cookie);
  const tenantHeader = request.headers.get('x-tenant-id');
  if (tenantHeader) headers.set('x-tenant-id', tenantHeader);
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'}/api/v1/${path}${request.nextUrl.search}`, {
      method: request.method, headers, body: request.method === 'GET' ? undefined : Buffer.from(await request.arrayBuffer()), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    const body = Buffer.from(await response.arrayBuffer());
    const result = new NextResponse(body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/json',
        'Cache-Control': response.headers.get('cache-control') ?? 'no-store',
      },
    });
    const disposition = response.headers.get('content-disposition');
    if (disposition) result.headers.set('Content-Disposition', disposition);
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
