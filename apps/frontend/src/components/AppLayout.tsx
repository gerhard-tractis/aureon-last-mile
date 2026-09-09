"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Menu, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useBranding } from '@/providers/BrandingProvider';
import { ModuleKey } from '@/lib/modules/registry';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { createSPAClient } from '@/lib/supabase/client';
import { db } from '@/lib/db';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { createLazyPickupQueueSender } from '@/lib/pickup/offlineQueueSender';
import { useSidebarPin } from './sidebar/useSidebarPin';
import { SidebarNavItem } from './sidebar/SidebarNavItem';
import { SidebarBrand } from './sidebar/SidebarBrand';
import { SidebarUserMenu } from './sidebar/SidebarUserMenu';
import { buildNavSections, buildMobileTabs, isImmersiveMobileRoute } from './sidebar/navigation';
import { useNavCounts, navCountTone } from '@/hooks/useNavCounts';
import TopBar from './TopBar';
import { MobileTabBar } from './MobileTabBar';
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
  const { role, permissions, operatorId, user } = useGlobal();
  const { logoUrl, companyName } = useBranding();

  // spec-81 fase 2, B2 (ronda 1 de review del PR #679) — el drenador de la
  // cola offline de Recogida (`pickup_queue`) se monta aquí, en el shell
  // global, con el mismo alcance que `SyncChip`/`useSyncQueue` (dentro de
  // `TopBar`, más abajo). Sin esto el hook existía pero nadie lo llamaba en
  // producción: un `close_manifest` encolado sin señal nunca se drenaba, ni
  // al volver la conexión ni al reabrir la PWA.
  //
  // `useMemo` (m5, misma ronda de review) — `useOfflineQueue` mete `send` en
  // las deps de su efecto; un sender nuevo en cada render reiniciaría la
  // cadena de reintentos programados (`scheduleRetry`/`clearTimeout`) en
  // cada montaje de `AppLayout`, así que el sender necesita identidad
  // ESTABLE.
  //
  // Hallazgo del coordinador, revisión del PR #679 tras la ronda 4 de
  // spec-81 fase 2 — `createPickupQueueSender(createSPAClient())` (versión
  // anterior de esta línea) llamaba a `createSPAClient()` en el CUERPO del
  // render. `AppLayout` es `"use client"`, pero Next.js igual ejecuta ese
  // cuerpo durante el prerender/SSR, y `useMemo` corre en esa pasada.
  // `createSPAClient()` exige `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` en ese
  // momento — sin ellas (el build de Vercel Preview de este PR no las
  // tenía), lanza `@supabase/ssr: Your project's URL and API key are
  // required` prerenderizando cualquier ruta bajo `AppLayout`, rompiendo el
  // build entero. `createLazyPickupQueueSender` resuelve las dos exigencias
  // sin elegir entre ellas: identidad estable desde el primer render (lo
  // que `useMemo` memoiza aquí), pero el cliente Supabase se construye
  // perezosamente en el primer envío real — en SSR nunca se envía nada, así
  // que `createSPAClient` nunca se llama.
  //
  // B4, ronda 2 de review del PR #679 (bloqueante) — `operatorId` es la
  // tenencia (`claims.operator_id`), no la persona. Un teléfono de muelle
  // compartido puede tener dos conductores de la MISMA empresa en sesiones
  // sucesivas; sin `userId`, el drenador de quien acaba de iniciar sesión
  // enviaba (y firmaba con su propio nombre, vía `auth.uid()` en el
  // servidor) lo que el conductor anterior había encolado. `user.id` es ese
  // mismo `auth.uid()`.
  //
  // B-2, ronda 3 de review del PR #712 (spec-81 fase 5, bloqueante) — la
  // única invalidación de `['pickup','manifest-documents', manifestId]`
  // (`useManifestDocuments.ts`) vivía en `useUploadManifestDocument.onSuccess`
  // — la ruta ONLINE. Un conductor con un solo teléfono y señal
  // intermitente que sube una foto offline no veía su lista refrescada:
  // `ManifestPhotoStrip` seguía proponiendo el mismo `sheetNumber` que el
  // servidor ya tenía, produciendo un 23505 nuevo en la siguiente captura.
  // `AppLayout` es el único punto de esta cadena con `useQueryClient()`
  // real (`lib/pickup/offlineQueueSender.ts` no puede depender de React
  // Query) — `onManifestDocumentsChanged` (renombrado en la ronda 4: también
  // se dispara al renumerar tras una colisión, no sólo en `sent`) invalida
  // en cuanto el drenador tiene evidencia de que la lista del servidor
  // cambió o quedó desactualizada.
  const queryClient = useQueryClient();
  const pickupQueueSender = useMemo(
    () =>
      createLazyPickupQueueSender(createSPAClient, db, {
        onManifestDocumentsChanged: (entry) => {
          queryClient.invalidateQueries({
            queryKey: ['pickup', 'manifest-documents', entry.manifestId],
          });
        },
      }),
    [queryClient],
  );
  useOfflineQueue(operatorId, user?.id ?? null, pickupQueueSender);
  const { pinned, togglePin } = useSidebarPin();
  const pathname = usePathname();
  const [logoError, setLogoError] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [inspectorOrderId, setInspectorOrderId] = useState<string | null>(null);

  const isAdminOrManager = role === 'admin' || role === 'operations_manager';

  const navCtx = { role, permissions, enabledModules };
  const sections = buildNavSections(navCtx);
  const counts = useNavCounts(operatorId);

  // spec-54 — the bottom tab bar replaces the hamburger for floor/van roles
  // (see buildMobileTabs). It also yields to the hamburger on screens that
  // already own a fixed bottom action bar (isImmersiveMobileRoute) so the
  // two never stack — see MobileTabBar's doc comment for the route list.
  const mobileTabs = buildMobileTabs(navCtx);
  const showMobileTabs = mobileTabs.length > 0 && !isImmersiveMobileRoute(pathname ?? '');

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
              // The hamburger is the fallback for every role the bottom tab
              // bar does not serve — operations_manager, admin, and any role
              // not recognised as a floor/van role (buildMobileTabs returns
              // []) — plus the operations roles themselves whenever they are
              // on a screen that owns its own fixed bottom action bar
              // (isImmersiveMobileRoute), so there is always a way to
              // navigate away from a full-bleed flow.
              !showMobileTabs && (
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
              )
            }
          />

          <main
            className={cn(
              'flex min-h-0 flex-1 flex-col',
              // Reserve exactly the tab bar's own height so the last row of
              // any list can still scroll into view above it.
              showMobileTabs && 'pb-[var(--mobile-tabbar-h)] lg:pb-0',
            )}
          >
            {children}
          </main>
        </div>

        {showMobileTabs && <MobileTabBar ctx={navCtx} />}

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
