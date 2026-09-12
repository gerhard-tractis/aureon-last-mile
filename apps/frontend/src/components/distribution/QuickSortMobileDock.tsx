'use client';

import { ScanField } from '@/components/scan/ScanField';
import { DistributionMobileHeader } from './DistributionMobileHeader';
import { getDockCapacityStatus, type DockCapacityTone } from '@/lib/distribution/dock-capacity';
import { cn } from '@/lib/utils';
import type { ZoneMatchResult } from '@/lib/distribution/sectorization-engine';
import type { QuickSortPackageInfo, QuickSortScanEvent } from '@/hooks/distribution/useQuickSortFlow';

/**
 * spec-68 Fase 5.3/5.4 — `4h`/`4j`/`4i`, quicksort step 2, below `lg`.
 *
 * Decisión 4, verbatim: "`4j` queda como la variante del paso 2 con
 * contexto de orden incompleta y capacidad del andén" and "`4i` es esa
 * misma pantalla con la tarjeta de destino en paleta de error y el campo
 * re-armado. Tres artboards, un componente con tres estados — no tres
 * componentes que se van a desincronizar al primer cambio de copy."
 *
 * So this is ONE component, not `QuickSortMobileDock` +
 * `QuickSortMobileRejected` — `rejectedCode` (from `useQuickSortFlow`)
 * being non-null is what flips the destination card into the ERROR
 * variant (`4i`); everything else (capacity block, incomplete-order
 * notice, armed field, últimos escaneos) renders in both variants because
 * the field genuinely is re-armed on rejection, not reset to a new screen.
 *
 * Order matches the spec top-to-bottom: destination card → incomplete-
 * order warning → capacity block → armed field → últimos escaneos.
 *
 * spec-96 Fase 1, Task 1.1 (`4h`/`4i`) — the screen used to render no
 * visible header at all (an `sr-only` `<h1>` only). Both artboards draw a
 * real header row — back arrow, title "Confirmar andén", subtitle, status
 * chip ("LEÍDO"/"RECHAZADO") — so this now reuses `DistributionMobileHeader`
 * (titled variant), the same component step 1 (`QuickSortMobile`) already
 * uses. One shared header shape across all four scan states, rather than
 * a second bespoke header that can drift from the first.
 */
export interface QuickSortMobileDockProps {
  /** Titled header's subtitle line — same operator name step 1 shows. */
  operatorName: string | null;
  destination: ZoneMatchResult;
  currentPackage: QuickSortPackageInfo | null;
  siblingsPending: number;
  /** Current package count in the destination zone — from
   *  `useSectorizedByZone`, keyed by `destination.zone_id`. */
  zoneCount: number;
  /** Null when the zone has no capacity configured — `DockCapacityBar`
   *  renders nothing in that case (Decisión 5). */
  zoneCapacity: number | null;
  /** Set by `useQuickSortFlow` on a wrong-dock rejection — the code that
   *  was actually scanned. Non-null flips this component into `4i`. */
  rejectedCode: string | null;
  scans: QuickSortScanEvent[];
  onScanAnden: (code: string) => void;
  /** `4i` footer — "Marcar excepción y seguir". */
  onMarkException: () => void;
  isMarkingException: boolean;
  /** Review fix (finding #1) — set when `markException`'s write itself
   *  failed (RLS, a bad FK). Surfaced so the operator knows the exception
   *  was NOT recorded, rather than silently landing back on step 1. */
  exceptionError: string | null;
  /** Footer — "Enviar a consolidación" jumps straight to scanning the
   *  consolidation code; kept as a convenience alongside the physical
   *  scan, not a replacement for it. */
  onSendToConsolidation: () => void;
  /** Footer — "Cancelar y volver al paso 1". */
  onCancel: () => void;
}

function timeLabel(at: Date): string {
  return at.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

// spec-96 Fase 1 review finding #6 (4h) — `4h` draws capacity as a single
// inline advisory sentence, toned, not the bar+label shape (`4j`'s own
// screen — QuickSortMobile.tsx — keeps that one). `getDockCapacityStatus`'s
// tone drives the palette, same three tokens the tone-block elsewhere in
// this file uses, just applied to a bordered `<p>` instead of a bar's
// wrapper `<div>`.
const CAPACITY_NOTICE_TONE_CLASS: Record<DockCapacityTone, string> = {
  neutral: 'border-border bg-surface text-text-secondary',
  warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  error: 'border-status-error-border bg-status-error-bg text-status-error-text',
};

export function QuickSortMobileDock({
  operatorName,
  destination,
  currentPackage,
  siblingsPending,
  zoneCount,
  zoneCapacity,
  rejectedCode,
  scans,
  onScanAnden,
  onMarkException,
  isMarkingException,
  exceptionError,
  onSendToConsolidation,
  onCancel,
}: QuickSortMobileDockProps) {
  const rejected = rejectedCode !== null;
  const capacityStatus = getDockCapacityStatus(zoneCount, zoneCapacity);

  return (
    <div className="flex min-h-0 flex-col gap-5 px-5 py-[22px] pb-[104px]">
      <DistributionMobileHeader
        variant="titled"
        title="Confirmar andén"
        subtitle={`${operatorName ?? 'Operario'} · paso 2 de 2 · lote abierto`}
        onBack={onCancel}
        statusChip={
          rejected
            ? { label: 'RECHAZADO', tone: 'error' }
            : { label: 'LEÍDO', tone: 'success' }
        }
      />

      <DestinationCard
        destination={destination}
        currentPackage={currentPackage}
        rejected={rejected}
        rejectedCode={rejectedCode}
      />

      {/* Review fix (finding #4) — desktop's QuickSortScanner shows this
          same banner when the comuna has no andén match (determineDockZone
          falls back to consolidación, flagged=true). Mobile was dropping
          it, so an unmapped-comuna package rendered identically to a
          correctly-routed consolidation package and the data problem
          never reached anyone on the floor. */}
      {destination.flagged && (
        <p className="rounded-lg border border-status-warning-border bg-status-warning-bg px-4 py-2.5 text-[12.5px] leading-[1.4] text-status-warning-text">
          Comuna sin andén asignado — redirigiendo a Consolidación
        </p>
      )}

      {siblingsPending > 0 && (
        <p className="rounded-lg border border-status-warning-border bg-status-warning-bg px-4 py-2.5 text-[12.5px] leading-[1.4] text-status-warning-text">
          Falta {siblingsPending} {siblingsPending === 1 ? 'paquete' : 'paquetes'} de esta orden · sale
          incompleta si cierras el andén
        </p>
      )}

      {/* spec-96 Fase 1 review finding #6 — `4i` (rejected) draws no
          capacity notice at all; only `4h` (not yet rejected) does. Before
          this fix the block rendered in both, stacking on top of the
          error card and the incomplete-order warning. */}
      {!rejected && capacityStatus.configured && capacityStatus.tone && (
        <p
          data-testid="quicksort-capacity-notice"
          data-tone={capacityStatus.tone}
          className={cn(
            'rounded-lg border px-4 py-2.5 text-[12.5px] leading-[1.4]',
            CAPACITY_NOTICE_TONE_CLASS[capacityStatus.tone],
          )}
        >
          {destination.zone_code} va en {zoneCount} / {zoneCapacity} · si no cabe, mándalo a
          consolidación
        </p>
      )}

      <div className="flex flex-col gap-2.5 rounded-2xl border-2 border-dashed border-accent bg-accent-muted px-5 py-6">
        <span className="text-center font-mono text-[9.5px] font-semibold uppercase tracking-[.12em] text-accent">
          AHORA ESCANEA EL ANDÉN
        </span>
        <ScanField
          ariaLabel="Escanear andén"
          size="sm"
          onScan={onScanAnden}
        />
        <p className="text-center text-[11.5px] leading-[1.4] text-text-secondary">
          Solo acepta {destination.zone_code} o Consolidación · sin escaneo no queda asignado
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10.5px] font-semibold uppercase leading-none tracking-[.12em] text-text-muted">
          Últimos escaneos
        </h2>

        {scans.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-3.5 py-6 text-center text-[12.5px] text-text-secondary">
            Los escaneos de esta sesión aparecen aquí.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {scans.slice(0, 8).map((scan, i) => (
              <div
                key={`${scan.code}-${i}`}
                data-testid="quicksort-recent-scan"
                className={cn(
                  'flex min-h-[44px] items-center gap-2.5 rounded-lg border px-3 py-2',
                  scan.status === 'error'
                    ? 'border-status-error-border bg-status-error-bg'
                    : 'border-border bg-surface',
                )}
              >
                <span
                  className={cn(
                    'truncate font-mono text-[12px] font-semibold',
                    scan.status === 'error' ? 'text-status-error-text' : 'text-text',
                  )}
                >
                  {scan.code}
                </span>
                {scan.status === 'error' ? (
                  <span className="ml-auto flex-none font-mono text-[10.5px] font-semibold text-status-error-text">
                    {scan.reason ?? 'ERROR'}
                  </span>
                ) : (
                  <span className="ml-auto flex-none font-heading text-[12px] font-semibold text-status-success-text">
                    {scan.zoneCode}
                  </span>
                )}
                <span className="flex-none font-mono text-[10.5px] font-medium text-text-muted">
                  {timeLabel(scan.at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {exceptionError && (
        <p
          data-testid="quicksort-exception-error"
          className="rounded-lg border border-status-error-border bg-status-error-bg px-4 py-2.5 text-[12.5px] leading-[1.4] text-status-error-text"
        >
          {exceptionError}
        </p>
      )}

      {/* spec-96 Fase 1 review finding #7 — the mock stacks the SAME
          primary ("Enviar a consolidación", boxed) above a plain-text
          secondary in BOTH `4h` and `4i`; only the secondary differs
          ("Cancelar…" vs "Marcar excepción…"). Before this fix `4i` had no
          "Enviar a consolidación" at all — the one exit missing on the
          screen where the operator is stuck with a rejected dock. The
          secondary keeps its 44px touch-target floor via `minHeight`/
          `minWidth` (same hit-area pattern as `QuickSortMobile`'s
          SECT/ESTIB, review finding #3), not a visible box the mock
          doesn't draw for it. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2.5 border-t border-border bg-surface px-4 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onSendToConsolidation}
          className="flex h-[56px] items-center justify-center rounded-xl border border-border-strong text-[13.5px] font-semibold text-text transition-colors active:bg-surface-raised"
        >
          Enviar a consolidación
        </button>
        {rejected ? (
          <button
            type="button"
            onClick={onMarkException}
            disabled={isMarkingException}
            style={{ minHeight: '44px' }}
            className="flex items-center justify-center text-[12.5px] font-semibold text-status-error-text disabled:opacity-60"
          >
            Marcar excepción y seguir
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            style={{ minHeight: '44px' }}
            className="flex items-center justify-center text-[12.5px] font-semibold text-text-muted"
          >
            Cancelar y volver al paso 1
          </button>
        )}
      </div>
    </div>
  );
}

function DestinationCard({
  destination,
  currentPackage,
  rejected,
  rejectedCode,
}: {
  destination: ZoneMatchResult;
  currentPackage: QuickSortPackageInfo | null;
  rejected: boolean;
  rejectedCode: string | null;
}) {
  if (rejected) {
    return (
      <div
        data-testid="quicksort-destination-card"
        data-tone="error"
        className="flex flex-col gap-2 rounded-2xl border-2 border-status-error-border bg-status-error-bg px-5 py-5"
      >
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.12em] text-status-error-text">
          ASIGNACIÓN FALLIDA
        </span>
        <span className="font-mono text-[22px] font-bold leading-none text-status-error-text line-through">
          {rejectedCode}
        </span>
        <p className="font-heading text-[15px] font-semibold text-status-error-text">Andén incorrecto</p>
        <p className="text-[12.5px] leading-[1.4] text-status-error-text">
          Esperado {destination.zone_code} o Consolidación
        </p>
        <p className="text-[12.5px] leading-[1.4] text-status-error-text">
          {currentPackage?.label ?? 'El paquete'} sigue sin asignar · no se movió nada en el sistema
        </p>
        <div className="mt-1 rounded-lg border border-status-error-border/60 bg-surface px-3 py-2">
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.1em] text-text-muted">
            Llevar a
          </span>
          <p className="font-mono text-[26px] font-bold leading-none text-text">{destination.zone_code}</p>
          <p className="text-[12px] text-text-secondary">{destination.zone_name}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="quicksort-destination-card"
      data-tone="ok"
      className="flex flex-col gap-1.5 rounded-2xl border-2 border-status-success-border bg-status-success-bg px-5 py-5"
    >
      <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.12em] text-status-success-text">
        LLEVAR A
      </span>
      <span className="font-mono text-[62px] font-bold leading-none tracking-tight text-status-success-text">
        {destination.zone_code}
      </span>
      <p className="text-[13px] text-status-success-text">{destination.zone_name}</p>
      {currentPackage && (
        <p className="mt-1 text-[12px] text-status-success-text">
          {currentPackage.comunaName ?? 'Sin comuna'} · {currentPackage.label} · orden{' '}
          {currentPackage.orderNumber}
        </p>
      )}
    </div>
  );
}
