import { Box, CreditCard, FileBarChart, Heart, Home, Package, Settings, ShoppingBag, Users, Wallet } from 'lucide-react';

export const modules = [
  { slug: '', label: 'Dashboard', icon: Home },
  { slug: 'pos', label: 'POS', icon: CreditCard },
  { slug: 'products', label: 'Produk', icon: Package },
  { slug: 'inventory', label: 'Inventori', icon: Box },
  { slug: 'purchasing', label: 'Pembelian', icon: ShoppingBag },
  { slug: 'finance', label: 'Keuangan', icon: Wallet },
  { slug: 'hris', label: 'HRIS', icon: Users },
  { slug: 'crm', label: 'CRM', icon: Heart },
  { slug: 'reports', label: 'Laporan', icon: FileBarChart },
  { slug: 'settings', label: 'Pengaturan', icon: Settings },
] as const;
