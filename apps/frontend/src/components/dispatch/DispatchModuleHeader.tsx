'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';

interface DispatchModuleHeaderProps {
  /** Orders still unrouted. Drives both the Pre-ruta tab badge and the SIN
   *  RUTEAR counter — one figure, not two, so the two badges cannot show
   *  the visitor different numbers. */
  unrouted: number;
  /** Routes not yet released to the provider. The `open` tab/URL value and
   *  file names intentionally keep the old "Abiertas" vocabulary — only the
   *  visible label changed to "En carga". */
  enCargaCount?: number;
  /** Routes currently on the road. */
  enRutaCount?: number;
  /** I4 — true when the Pre-ruta board's comuna/andén/cliente/problemas/
   *  búsqueda filters (client-side, not date/ventana) are narrowing what's
   *  on screen. `unrouted` itself never changes for this — it stays the
   *  RPC's own date/ventana total, same as PreRouteFilters' totals line
   *  when nothing is filtered — but a qualifier next to SIN RUTEAR tells
   *  the operator the figure doesn't match what the board is showing them
   *  right now. */
  hasActiveFilters?: boolean;
  onNewRoute: () => void;
}

function TabCount({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return <span className="ml-1.5 text-xs font-normal text-text-secondary">{value}</span>;
}

/**
 * spec-75 task 1 — the module owns its own tab nav now. The 4 tabs used to
 * live inline in page.tsx; this pulls them (plus the SIN RUTEAR badge) into
 * one header component so the tab contents can move out into their own
 * files without page.tsx growing a second header.
 *
 * spec-75 phase 5 (decision 5) keeps all 4 tabs — the canvas draws the same
 * 4-tab strip on `1a`, `1b` and `1d` alike, and phase 1 built it on purpose.
 * "Completadas" stays a tab; what decision 5 rules out is a second
 * *component tree* for it — `DispatchEnRutaTab` and `DispatchCompletadasTab`
 * both render `EnRutaTable`, just with a different (enRuta, completadas)
 * slice, so it is "una tabla con un filtro, no dos tablas" without losing
 * the tab itself. The `1d` mock's own "Completadas hoy" section at the foot
 * of the live table is a separate thing and stays inside `DispatchEnRutaTab`
 * — the two aren't alternatives, the canvas shows both.
 *
 * No breadcrumb here: TopBar (mounted by AppLayout above every /app/*
 * route, including this one) already renders "Operación / Despacho" via
 * sidebar/navigation.ts. A second one here would duplicate it — see the
 * explicit warning against that in PageShell.tsx.
 *
 * This component is deliberately presentational: it takes counts as props
 * rather than calling useDispatchKPIs/usePreRouteSnapshot itself. The
 * pre-ruta snapshot call has to resolve `?date=`/`?window=` through
 * resolvePreRouteWindow to stay in lockstep with PreRouteBoard — a second,
 * independent read of those params here is exactly how the header and the
 * board drifted apart before (see the QA-finding comment in page.tsx).
 *
 * It also renders no Tabs root of its own — `<TabsList>` here relies on a
 * `<Tabs>` ancestor owned by page.tsx (the same root that wraps the
 * TabsContent panels), so triggers and panels share one set of Radix-
 * generated aria ids instead of two independent, unlinked roots.
 */
export function DispatchModuleHeader({
  unrouted,
  enCargaCount,
  enRutaCount,
  hasActiveFilters = false,
  onNewRoute,
}: DispatchModuleHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border bg-surface px-6 py-3.5">
      <TabsList>
        <TabsTrigger value="pre-ruta">
          {/* Space kept on the same line so the accessible name reads
              "Pre-ruta 204", not "Pre-ruta204" — JSX collapses whitespace
              placed on its own line between text and an element. */}
          Pre-ruta <TabCount value={unrouted} />
        </TabsTrigger>
        <TabsTrigger value="open">
          En carga <TabCount value={enCargaCount} />
        </TabsTrigger>
        <TabsTrigger value="in_progress">
          En ruta <TabCount value={enRutaCount} />
        </TabsTrigger>
        <TabsTrigger value="completed">Completadas</TabsTrigger>
      </TabsList>

      <div className="ml-auto flex items-center gap-3">
        {/* font-mono is a spec requirement for this counter, not incidental
            styling — keep the class (and its test assertion) intact. */}
        <span className="font-mono text-[11px] font-medium leading-none text-text-secondary">
          SIN RUTEAR <span className="font-semibold text-text">{unrouted}</span>
          {hasActiveFilters && (
            <span data-testid="unrouted-filtered-qualifier" className="ml-1 font-normal normal-case">
              (filtrado)
            </span>
          )}
        </span>
        <Button onClick={onNewRoute} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Nueva ruta
        </Button>
      </div>
    </div>
  );
}
