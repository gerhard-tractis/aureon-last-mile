'use client';

import Link from 'next/link';
import { ChevronRight, Layers, PackageSearch, ScanLine, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatTile } from '@/components/StatTile';
import { Skeleton } from '@/components/ui/skeleton';
import { DistributionMobileHeader } from './DistributionMobileHeader';
import { countLeavingSoon } from '@/lib/distribution/leaving-soon';
import type { DistributionKPIs } from '@/hooks/distribution/useDistributionKPIs';
import type { ConsolidationPackage } from '@/hooks/distribution/useConsolidation';
import type { UnmatchedComunaRow } from '@/hooks/distribution/useUnmatchedComunas';

/**
 * spec-68 Fase 2 — `4c`, home de la nave, below `lg`.
 *
 * Top to bottom: the greeting header, a dominant "TU TAREA AHORA" card that
 * is the one primary action on this screen, three KPI tiles, the three
 * PROCESOS DE LA NAVE rows, and — only when it has something to say — a
 * warning banner for comunas with no andén match.
 *
 * Decisión 1 — this tree never mounts the desktop KPI grid,
 * `ActiveSortersPanel` or `ConsolidationPanel`. Not hidden with CSS: not
 * rendered. That is the floor-lead's sitting screen, not this one.
 *
 * Decisión 2 — no bottom tab bar here. The mock draws its own (Hoy ·
 * Clasificar · Andenes · Perfil); the global `MobileTabBar` wins instead,
 * so this component renders nothing below the last section and the page
 * shell supplies navigation.
 *
 * Decisión 3 — "Andenes" in PROCESOS DE LA NAVE links to
 * `/app/distribution/andenes`, a route this phase does not build. The row
 * exists now so the destination can land later without touching this file.
 *
 * Decisión 9 — no "turno 14:00" anywhere (see DistributionMobileHeader) and
 * SALEN YA is computed here, client-side, from `consolidationPackages` —
 * no new hook, no new column.
 */
export interface DistributionMobileViewProps {
  userName: string | null;
  kpis: DistributionKPIs | undefined;
  consolidationPackages: ConsolidationPackage[];
  unmatchedComunas: UnmatchedComunaRow[];
  isLoading: boolean;
  /** Injectable for tests; defaults to the real current time. */
  now?: Date;
}

function todayISOFrom(now: Date): string {
  return now.toISOString().split('T')[0];
}

export function DistributionMobileView({
  userName,
  kpis,
  consolidationPackages,
  unmatchedComunas,
  isLoading,
  now,
}: DistributionMobileViewProps) {
  const clock = now ?? new Date();
  const pending = kpis?.pending ?? 0;
  const consolidation = kpis?.consolidation ?? 0;
  const leavingSoon = countLeavingSoon(consolidationPackages, todayISOFrom(clock));

  return (
    <div className="flex flex-col gap-4">
      <DistributionMobileHeader variant="greeting" userName={userName} />

      {isLoading ? (
        <div
          data-testid="distribution-mobile-hero-skeleton"
          className="rounded-2xl border-2 border-border bg-surface-raised p-5"
        >
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-[30px] w-48" />
          <Skeleton className="mt-4 h-14 w-full rounded-xl" />
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-border bg-surface-raised p-5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[.1em] text-text-secondary">
            TU TAREA AHORA
          </p>
          <p className="mt-2 font-heading text-[26px] font-semibold leading-[1.1] tracking-[-.01em] text-text">
            {pending} {pending === 1 ? 'paquete sin sectorizar' : 'paquetes sin sectorizar'}
          </p>
          <Link
            href="/app/distribution/quicksort"
            className="mt-4 flex min-h-[56px] items-center justify-center gap-2 rounded-xl bg-accent-light px-4 text-[15px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
          >
            <ScanLine className="h-5 w-5" />
            Escanear y clasificar
          </Link>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <StatTile label="Pendientes" value={pending} tone={pending > 0 ? 'warning' : 'neutral'} />
        <StatTile label="Consolid." value={consolidation} />
        <StatTile label="Salen ya" value={leavingSoon} tone={leavingSoon > 0 ? 'warning' : 'neutral'} />
      </div>

      <section className="flex flex-col gap-2">
        <p className="font-mono text-xs tracking-[.1em] text-text-secondary">PROCESOS DE LA NAVE</p>

        <ProcessRow
          href="/app/distribution/pendientes"
          icon={PackageSearch}
          title="Pendientes de sectorizar"
          subtitle="Agrupados por andén"
          count={pending}
        />
        <ProcessRow
          href="/app/distribution/consolidacion"
          icon={Layers}
          title="Consolidación"
          subtitle="Selección múltiple"
          count={consolidation}
        />
        <ProcessRow
          href="/app/distribution/andenes"
          icon={Layers}
          title="Andenes"
          subtitle="Ocupación por zona"
        />
      </section>

      {unmatchedComunas.length > 0 && (
        <section className="flex items-center gap-3 rounded-xl border border-status-warning-border bg-status-warning-bg p-3.5">
          <TriangleAlert className="h-5 w-5 flex-none text-status-warning-text" aria-hidden="true" />
          <p className="text-[13px] font-semibold text-status-warning-text">
            {unmatchedComunas.length}{' '}
            {unmatchedComunas.length === 1
              ? 'comuna sin andén asignado'
              : 'comunas sin andén asignado'}
          </p>
        </section>
      )}
    </div>
  );
}

interface ProcessRowProps {
  href: string;
  icon: typeof Layers;
  title: string;
  subtitle: string;
  count?: number;
}

function ProcessRow({ href, icon: Icon, title, subtitle, count }: ProcessRowProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-[64px] items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5',
        'transition-colors active:bg-surface-raised',
      )}
    >
      <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-surface-raised">
        <Icon className="h-[18px] w-[18px] text-text-secondary" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-text">{title}</span>
        <span className="block truncate text-[12px] text-text-secondary">{subtitle}</span>
      </span>
      {count !== undefined && (
        <span className="flex-none font-mono text-[15px] font-bold text-text">{count}</span>
      )}
      <ChevronRight className="h-4 w-4 flex-none text-text-muted" aria-hidden="true" />
    </Link>
  );
}
