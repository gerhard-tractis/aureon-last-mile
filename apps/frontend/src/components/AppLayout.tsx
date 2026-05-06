"use client";

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Radio,
  CheckSquare,
  ArrowUpDown,
  Calendar,
  FileText,
  Menu,
  PanelLeftClose,
  PanelLeft,
  Layers,
  Truck,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useBranding } from '@/providers/BrandingProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useSidebarPin } from './sidebar/useSidebarPin';
import { SidebarNavItem } from './sidebar/SidebarNavItem';
import { SidebarUserMenu } from './sidebar/SidebarUserMenu';
import ThemeToggle from './ThemeToggle';
import CapacityAlertBell from './capacity/CapacityAlertBell';
import { InspectorSearchPalette } from './inspector/InspectorSearchPalette';
import { OrderInspector } from './inspector/OrderInspector';

function SidebarBrand({
  logoUrl,
  companyName,
  pinned,
  onLogoError,
}: {
  logoUrl: string | null;
  companyName: string | null;
  pinned: boolean;
  onLogoError: () => void;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={companyName || 'Logo'}
        className={`max-h-10 object-contain transition-all ${pinned ? 'max-w-[140px]' : 'max-w-8'}`}
        onError={onLogoError}
      />
    );
  }
  return (
    <>
      <div className={pinned ? 'hidden' : 'h-5 w-5 rounded bg-sidebar-active'} />
      <span className={pinned ? 'text-sm font-semibold text-sidebar-active' : 'sr-only'}>
        {companyName || 'Aureon'}
      </span>
    </>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { role, permissions, operatorId } = useGlobal();
  const { logoUrl, companyName } = useBranding();
  const { pinned, togglePin } = useSidebarPin();
  const [logoError, setLogoError] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [inspectorOrderId, setInspectorOrderId] = useState<string | null>(null);

  const isAdminOrManager = role === 'admin' || role === 'operations_manager';

  useEffect(() => {
    if (!isAdminOrManager) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setIsPaletteOpen(true);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isAdminOrManager]);

  const navItems = [
    { href: '/app/dashboard',          label: 'Dashboard',    icon: LayoutDashboard, show: true },
    { href: '/app/operations-control', label: 'Ops Control',  icon: Radio,           show: isAdminOrManager },
    { href: '/app/pickup',             label: 'Pickup',       icon: CheckSquare,     show: permissions.includes('pickup') },
    { href: '/app/reception',          label: 'Recepción',    icon: ArrowUpDown,     show: permissions.includes('reception') },
    { href: '/app/distribution',       label: 'Distribución', icon: Layers,          show: permissions.includes('distribution') },
    { href: '/app/dispatch',           label: 'Despacho',     icon: Truck,           show: permissions.includes('dispatch') || permissions.includes('admin') },
    { href: '/app/capacity-planning',  label: 'Capacidad',    icon: Calendar,        show: isAdminOrManager },
    { href: '/app/audit-logs',         label: 'Auditoría',    icon: FileText,        show: isAdminOrManager },
    { href: '/app/conversations',       label: 'Conversaciones', icon: MessageSquare, show: isAdminOrManager || permissions.includes('customer_service') },
    { href: '/admin',                   label: 'Admin',          icon: ShieldCheck,   show: role === 'admin' },
  ].filter((item) => item.show);

  function SidebarInner({ mobilePinned = false }: { mobilePinned?: boolean }) {
    const ep = mobilePinned || pinned;
    return (
      <div className="flex flex-col h-full bg-sidebar">
        <div className="h-14 flex items-center px-3 border-b border-sidebar-border overflow-hidden">
          <SidebarBrand
            logoUrl={logoError ? null : logoUrl}
            companyName={companyName}
            pinned={ep}
            onLogoError={() => setLogoError(true)}
          />
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <SidebarNavItem key={item.href} href={item.href} label={item.label} icon={item.icon} pinned={ep} />
          ))}
        </nav>
        <div className="px-2 py-2 border-t border-sidebar-border space-y-1">
          <SidebarUserMenu pinned={ep} />
          <div className={`flex items-center ${ep ? 'justify-between' : 'justify-center'} px-1`}>
            <ThemeToggle compact={!ep} />
            {!mobilePinned && (
              <button
                data-pin-toggle
                onClick={togglePin}
                className="p-2 rounded-md text-sidebar-text hover:bg-sidebar-hover transition-colors"
                aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
              >
                {pinned ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-dvh flex bg-surface">
        {/* Desktop sidebar */}
        <aside
          data-sidebar
          data-pinned={pinned}
          className={`hidden lg:flex flex-col fixed inset-y-0 left-0 transition-all duration-200 z-30 border-r border-sidebar-border ${pinned ? 'w-[200px]' : 'w-14'}`}
        >
          <SidebarInner />
        </aside>

        {/* Main — min-w-0 lets wide children (tables, code blocks) scroll inside
            their own overflow containers instead of stretching this column past
            the viewport and revealing the body bg behind AppLayout. */}
        <div className={`flex-1 min-w-0 transition-all duration-200 ${pinned ? 'lg:ml-[200px]' : 'lg:ml-14'}`}>
          {/* Mobile/tablet hamburger — sidebar accessible at every viewport <lg */}
          <div className="flex lg:hidden items-center h-12 px-4 bg-sidebar border-b border-sidebar-border">
            <Sheet>
              <SheetTrigger asChild>
                <button className="text-sidebar-text" aria-label="Open sidebar">
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[200px] p-0 bg-sidebar border-sidebar-border">
                <SidebarInner mobilePinned />
              </SheetContent>
            </Sheet>
          </div>

          {/* Main content */}
          <div className="relative">
            {isAdminOrManager && (
              <div className="absolute top-3 right-4 z-10 flex items-center gap-2">
                <button
                  aria-label="Buscar orden o paquete"
                  onClick={() => setIsPaletteOpen(true)}
                  className="hidden lg:inline-flex items-center gap-2 text-xs text-text-muted bg-surface-raised border border-border rounded-lg px-3 py-1.5 hover:bg-surface-elev transition-colors"
                >
                  <span>Buscar orden…</span>
                  <kbd className="font-mono bg-surface border border-border rounded px-1 text-[10px]">/</kbd>
                </button>
                <CapacityAlertBell operatorId={operatorId} />
              </div>
            )}
            <main>{children}</main>
          </div>
        </div>

        {isAdminOrManager && (
          <>
            <InspectorSearchPalette
              isOpen={isPaletteOpen}
              onClose={() => setIsPaletteOpen(false)}
              onSelectOrder={(id) => {
                setInspectorOrderId(id);
                setIsPaletteOpen(false);
              }}
            />
            <OrderInspector
              orderId={inspectorOrderId}
              onClose={() => setInspectorOrderId(null)}
            />
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
