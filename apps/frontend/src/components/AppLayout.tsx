"use client";

import React, { useState, useEffect } from 'react';
import { Menu, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useBranding } from '@/providers/BrandingProvider';
import { ModuleKey } from '@/lib/modules/registry';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useSidebarPin } from './sidebar/useSidebarPin';
import { SidebarNavItem } from './sidebar/SidebarNavItem';
import { SidebarBrand } from './sidebar/SidebarBrand';
import { SidebarUserMenu } from './sidebar/SidebarUserMenu';
import { buildNavSections } from './sidebar/navigation';
import { useNavCounts, navCountTone } from '@/hooks/useNavCounts';
import TopBar from './TopBar';
import { InspectorSearchPalette } from './inspector/InspectorSearchPalette';
import { OrderInspector } from './inspector/OrderInspector';

/**
 * spec-54 phase 2 — the application shell.
 *
 * Two changes from the previous flat layout:
 *   1. The 10-item nav list is grouped into OPERACIÓN / GESTIÓN, and the
 *      operation items carry queue counters, so the sidebar answers "where is
 *      the work" and not only "where can I go".
 *   2. Global controls move out of a floating overlay into a real 56px topbar,
 *      present at every breakpoint. That is what makes the theme toggle
 *      reachable on mobile.
 *
 * Visibility rules (role, permission, spec-45 module activation) are unchanged
 * and now live in ./sidebar/navigation.ts.
 */

export default function AppLayout({
  children,
  enabledModules = [],
}: {
  children: React.ReactNode;
  enabledModules?: ReadonlyArray<ModuleKey>;
}) {
  const { role, permissions, operatorId } = useGlobal();
  const { logoUrl, companyName } = useBranding();
  const { pinned, togglePin } = useSidebarPin();
  const [logoError, setLogoError] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [inspectorOrderId, setInspectorOrderId] = useState<string | null>(null);

  const isAdminOrManager = role === 'admin' || role === 'operations_manager';

  const sections = buildNavSections({ role, permissions, enabledModules });
  const counts = useNavCounts(operatorId);

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

  function SidebarInner({ mobilePinned = false }: { mobilePinned?: boolean }) {
    const ep = mobilePinned || pinned;
    return (
      <div className="flex flex-col h-full bg-sidebar">
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-sidebar-border overflow-hidden">
          <SidebarBrand
            logoUrl={logoError ? null : logoUrl}
            companyName={companyName}
            pinned={ep}
            onLogoError={() => setLogoError(true)}
          />
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3.5">
          {sections.map((section) => (
            <div key={section.title} className="mb-1 last:mb-0">
              {/* The heading is dropped in the icon rail — a tracked-out label
                  in a 56px column would wrap into noise. */}
              {ep && (
                <div className="px-2.5 pb-2 pt-3 font-mono text-[9.5px] font-medium uppercase leading-none tracking-[.13em] text-sidebar-section first:pt-1.5">
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const count = item.countKey ? counts[item.countKey] : undefined;
                  return (
                    <SidebarNavItem
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      pinned={ep}
                      count={count}
                      countTone={item.countKey ? navCountTone(item.countKey, count ?? null) : 'neutral'}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-2 py-2 border-t border-sidebar-border space-y-1">
          <SidebarUserMenu pinned={ep} />
          {!mobilePinned && (
            <div className={`flex items-center ${ep ? 'justify-end' : 'justify-center'} px-1`}>
              <button
                data-pin-toggle
                onClick={togglePin}
                className="p-2 rounded-md text-sidebar-text hover:bg-sidebar-hover transition-colors"
                aria-label={pinned ? 'Contraer barra lateral' : 'Fijar barra lateral'}
              >
                {pinned ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
              </button>
            </div>
          )}
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
          className={`hidden lg:flex flex-col fixed inset-y-0 left-0 transition-all duration-200 z-30 border-r border-sidebar-border ${pinned ? 'w-[216px]' : 'w-14'}`}
        >
          <SidebarInner />
        </aside>

        {/* Main — min-w-0 lets wide children (tables, code blocks) scroll inside
            their own overflow containers instead of stretching this column past
            the viewport and revealing the body bg behind AppLayout. */}
        {/* min-h-dvh + flex-col so <main> below can actually stretch. Without a
            height on this chain every screen's `flex-1 min-h-0` had nothing to
            fill against, and the rebuilt full-height layouts rendered as short
            blocks with a large void underneath. */}
        <div
          className={`flex min-h-dvh flex-1 min-w-0 flex-col transition-all duration-200 ${pinned ? 'lg:ml-[216px]' : 'lg:ml-14'}`}
        >
          <TopBar
            showOpsTools={isAdminOrManager}
            operatorId={operatorId}
            onOpenSearch={() => setIsPaletteOpen(true)}
            menuSlot={
              <div className="flex lg:hidden">
                <Sheet>
                  <SheetTrigger asChild>
                    <button
                      className="-ml-1 p-1 text-text-secondary"
                      aria-label="Abrir barra lateral"
                    >
                      <Menu className="h-5 w-5" />
                    </button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[216px] p-0 bg-sidebar border-sidebar-border">
                    <SidebarInner mobilePinned />
                  </SheetContent>
                </Sheet>
              </div>
            }
          />

          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
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
              packageLabelsEnabled={enabledModules.includes(ModuleKey.PACKAGE_LABELS)}
            />
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
