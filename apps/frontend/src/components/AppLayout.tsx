"use client";

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
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
import TabletTopBar from '@/components/tablet/TabletTopBar';
import { useViewport } from '@/hooks/useViewport';

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
  const { isTablet } = useViewport();
  const pathname = usePathname();

  const isAdminOrManager = role === 'admin' || role === 'operations_manager';
  const isTabletHome = pathname === '/app/tablet-home';

  const navItems = [
    { href: '/app/dashboard',          label: 'Dashboard',    icon: LayoutDashboard, show: true },
    { href: '/app/operations-control', label: 'Ops Control',  icon: Radio,           show: isAdminOrManager },
    { href: '/app/pickup',             label: 'Pickup',       icon: CheckSquare,     show: permissions.includes('pickup') },
    { href: '/app/reception',          label: 'Recepción',    icon: ArrowUpDown,     show: permissions.includes('reception') },
    { href: '/app/distribution',       label: 'Distribución', icon: Layers,          show: permissions.includes('distribution') },
    { href: '/app/dispatch',           label: 'Despacho',     icon: Truck,           show: permissions.includes('dispatch') || permissions.includes('admin') },
    { href: '/app/capacity-planning',  label: 'Capacidad',    icon: Calendar,        show: isAdminOrManager },
    { href: '/app/audit-logs',         label: 'Auditoría',    icon: FileText,        show: isAdminOrManager },
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

        {/* Main */}
        <div className={`flex-1 transition-all duration-200 ${pinned ? 'lg:ml-[200px]' : 'lg:ml-14'}`}>
          {/* Mobile hamburger — hidden on tablet and above */}
          {!isTablet && (
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
          )}

          {/* Tablet top bar — shown on tablet, not on tablet-home */}
          {isTablet && !isTabletHome && <TabletTopBar />}

          {/* Main content */}
          <div className="relative">
            {/* CapacityAlertBell — desktop only */}
            {isAdminOrManager && !isTablet && (
              <div className="absolute top-3 right-4 z-10">
                <CapacityAlertBell operatorId={operatorId} />
              </div>
            )}
            <main>{children}</main>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
