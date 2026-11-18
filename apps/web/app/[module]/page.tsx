import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card } from '@foxbiz/ui';
import { AppShell } from '../../components/app-shell';
import { modules } from '../../components/modules';
import { CatalogWorkspace } from '../../components/catalog-workspace';
import { InventoryWorkspace } from '../../components/inventory-workspace';
import { SettingsWorkspace } from '../../components/settings-workspace';
import { PermissionBoundary } from '../../components/permission-boundary';
import { PosWorkspace } from '../../components/pos-workspace';
import { PurchasingWorkspace } from '../../components/purchasing-workspace';
import { FinanceWorkspace } from '../../components/finance-workspace';
import { CrmWorkspace } from '../../components/crm-workspace';
import { HrisWorkspace } from '../../components/hris-workspace';

export function generateStaticParams() { return modules.filter((item) => item.slug).map((item) => ({ module: item.slug })); }

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const slug = (await params).module;
  const moduleInfo = modules.find((item) => item.slug === slug);
  if (!moduleInfo) notFound();
  if (slug === 'products') return <CatalogWorkspace/>;
  if (slug === 'inventory') return <InventoryWorkspace/>;
  if (slug === 'settings') return <SettingsWorkspace/>;
  if (slug === 'pos') return <PosWorkspace/>;
  if (slug === 'purchasing') return <PurchasingWorkspace/>;
  if (slug === 'finance') return <FinanceWorkspace/>;
  if (slug === 'crm') return <CrmWorkspace/>;
  if (slug === 'hris') return <HrisWorkspace/>;
  const Icon = moduleInfo.icon;
  const content = <><div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">{moduleInfo.label}{slug === 'pos' ? ' — Penjualan Baru' : ''}</h1><Badge>Fondasi Sprint 1</Badge></div><Card className="flex min-h-80 flex-col items-center justify-center p-8 text-center"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-fox-soft text-fox-blue"><Icon size={30}/></span><h2 className="mt-5 text-lg font-semibold">{slug === 'pos' ? 'Entry point kasir siap ditinjau' : `Ruang kerja ${moduleInfo.label}`}</h2><p className="mt-3 max-w-lg text-sm leading-6 text-fox-secondary">{slug === 'pos' ? 'Checkout akan dikembangkan pada Sprint 2. Pembayaran mengikuti tunai dan EDC eksternal dengan konfirmasi manual.' : 'Modul ini mengikuti tahap pengembangan pada backlog FoxBiz. Navigasi, komponen, dan layout dasar sudah tersedia.'}</p><Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-fox-soft px-4 text-sm font-semibold text-fox-info">Kembali ke Dashboard</Link></Card></>;
  return <AppShell>{slug === 'pos' ? <PermissionBoundary permission="pos.read">{content}</PermissionBoundary> : content}</AppShell>;
}
