'use client';

import { Check, Package } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { isLeavingSoon } from '@/lib/distribution/leaving-soon';
import { formatRelativeDeliveryDate } from '@/lib/distribution/relative-date';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';
import type { ConsolidationPackage } from '@/hooks/distribution/useConsolidation';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

/**
 * spec-68 Fase 4 — `4f`, consolidación, below `lg`.
 *
 * Two sections — URGENTES (hoy/mañana/vencidos, `isLeavingSoon` from Fase
 * 2) and PRÓXIMOS — each package a multi-select row. The header
 * ("Consolidación", "N bultos retenidos · zona CNS", "N SALEN YA" chip)
 * and the fixed action footer live in the route (mirrors `pendientes`'s
 * page.tsx/PendingMobileList split), not here — this component owns the
 * list and the selection UI only.
 *
 * "comuna → andén" resolves the DESTINATION andén, not
 * `pkg.dock_zone_id` — every retenido package's `dock_zone_id` already
 * points at the CONSOLIDATION zone itself (that's what put it here; see
 * migration 20260504000002), so it can't answer "where does this go".
 * `matchZoneByComuna` below does a comuna-only match, deliberately
 * skipping `determineDockZone`'s date gate: a próximos package is
 * future-dated on purpose, and `determineDockZone` would just say
 * "consolidación" back — useless as a destination label. The date gate
 * only decides WHEN a package leaves consolidation, never WHERE it goes.
 */
export interface ConsolidationMobileViewProps {
  packages: ConsolidationPackage[];
  zones: DockZoneRecord[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

function matchZoneByComuna(comunaId: string | null, zones: DockZoneRecord[]): DockZoneRecord | null {
  if (!comunaId) return null;
  return (
    zones.find((z) => !z.is_consolidation && z.is_active && z.comunas.some((c) => c.id === comunaId)) ?? null
  );
}

export function ConsolidationMobileView({
  packages,
  zones,
  selectedIds,
  onToggleSelect,
  now,
}: ConsolidationMobileViewProps) {
  if (packages.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Sin paquetes en consolidación"
        description="Los paquetes que necesiten consolidarse antes de despacho aparecerán aquí."
      />
    );
  }

  const today = todayISOInTimezone(now);
  const urgent: ConsolidationPackage[] = [];
  const upcoming: ConsolidationPackage[] = [];
  for (const pkg of packages) {
    (isLeavingSoon(pkg.delivery_date, today) ? urgent : upcoming).push(pkg);
  }

  return (
    <div className="flex flex-col gap-5">
      {selectedIds.size > 0 && (
        <div
          data-testid="consolidation-selection-count"
          className="rounded-lg border border-accent bg-accent-muted px-3 py-2 text-center font-mono text-[12.5px] font-semibold uppercase tracking-[.08em] text-accent"
        >
          {selectedIds.size} {selectedIds.size === 1 ? 'SELECCIONADO' : 'SELECCIONADOS'}
        </div>
      )}

      {urgent.length > 0 && (
        <Section
          testId="consolidation-section-urgentes"
          label="URGENTES · HOY Y MAÑANA"
          count={urgent.length}
          tone="warning"
          packages={urgent}
          zones={zones}
          today={today}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
        />
      )}

      {upcoming.length > 0 && (
        <Section
          testId="consolidation-section-proximos"
          label="PRÓXIMOS"
          count={upcoming.length}
          tone="neutral"
          packages={upcoming}
          zones={zones}
          today={today}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
        />
      )}
    </div>
  );
}

function Section({
  testId,
  label,
  count,
  tone,
  packages,
  zones,
  today,
  selectedIds,
  onToggleSelect,
}: {
  testId: string;
  label: string;
  count: number;
  tone: 'warning' | 'neutral';
  packages: ConsolidationPackage[];
  zones: DockZoneRecord[];
  today: string;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  return (
    <section data-testid={testId}>
      <header className="flex items-baseline gap-2 px-1 pb-2">
        <span
          className={cn(
            'font-mono text-[12px] font-bold uppercase tracking-[.1em]',
            tone === 'warning' ? 'text-status-warning-text' : 'text-text-secondary',
          )}
        >
          {label}
        </span>
        <span className="ml-auto flex-none font-mono text-[12.5px] tabular-nums text-text-secondary">
          {count}
        </span>
      </header>

      <div className="flex flex-col gap-2">
        {packages.map((pkg) => (
          <PackageRow
            key={pkg.id}
            pkg={pkg}
            urgent={tone === 'warning'}
            zones={zones}
            today={today}
            selected={selectedIds.has(pkg.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
    </section>
  );
}

function PackageRow({
  pkg,
  urgent,
  zones,
  today,
  selected,
  onToggleSelect,
}: {
  pkg: ConsolidationPackage;
  urgent: boolean;
  zones: DockZoneRecord[];
  today: string;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const destination = matchZoneByComuna(pkg.comunaId, zones);
  // SIN ANDÉN: the order's comuna itself is unmatched (`comunaId` null —
  // the same "flagged=false but still unmapped" case Decisión 9 calls out
  // for usePendingSectorization), or a comuna we DO have but no active
  // andén claims it.
  const noZone = destination === null;
  const { label: dateLabel } = formatRelativeDeliveryDate(pkg.delivery_date, today);

  const tag = noZone ? 'SIN ANDÉN' : dateLabel.toUpperCase();
  const comunaLabel = pkg.comunaName ?? 'Sin comuna';
  const zoneLabel = destination?.code ?? '—';

  return (
    <label
      data-testid={`consolidation-row-${pkg.id}`}
      data-tone={noZone ? 'error' : urgent ? 'warning' : 'neutral'}
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3.5 py-2.5',
        urgent ? 'min-h-[60px]' : 'min-h-[52px]',
        noZone
          ? 'border-status-error-border bg-status-error-bg'
          : urgent
            ? 'border-status-warning-border bg-status-warning-bg'
            : 'border-border bg-surface',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(pkg.id)}
        aria-label={`Seleccionar ${pkg.label}`}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'grid h-[22px] w-[22px] flex-none place-items-center rounded border-2 transition-colors',
          selected ? 'border-accent bg-accent' : 'border-border-strong bg-surface',
        )}
      >
        {selected && <Check className="h-3.5 w-3.5 text-accent-light-foreground" strokeWidth={3.4} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[13.5px] font-semibold text-text">{pkg.label}</span>
        <span
          className={cn(
            'block truncate text-[12px]',
            noZone ? 'text-status-error-text' : urgent ? 'text-status-warning-text' : 'text-text-secondary',
          )}
        >
          {comunaLabel} → {zoneLabel} · entrega {dateLabel}
        </span>
      </span>

      <span
        className={cn(
          'flex-none rounded-sm border px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[.08em]',
          noZone
            ? 'border-status-error-border bg-status-error-bg text-status-error-text'
            : urgent
              ? 'border-status-warning-border bg-status-warning-bg text-status-warning-text'
              : 'border-border bg-surface-raised text-text-secondary',
        )}
      >
        {tag}
      </span>
    </label>
  );
}
