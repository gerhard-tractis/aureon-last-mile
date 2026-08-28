'use client';

import { ScanField } from '@/components/scan/ScanField';
import { cn } from '@/lib/utils';
import type { ExpectedLoadPosition } from '@/lib/dispatch/expected-load-position';
import type { QuickSortPackageInfo, QuickSortScanEvent } from '@/hooks/distribution/useQuickSortFlow';

/**
 * spec-71 phase 3 mobile — quicksort step 2, `mode: 'stage'`, below `lg`.
 *
 * The staging pass's analogue of `QuickSortMobileDock`: destination shown
 * and the confirming field armed in the same step, reject state on a
 * mismatched scan instead of a state transition. Same visual shape
 * (dashed-accent scan panel, visually-hidden `<h1>`, últimos escaneos,
 * fixed footer) — a sibling to `QuickSortMobileDock`, not a fork of the
 * scan machinery, which stays entirely in `useQuickSortFlow`.
 *
 * Deliberately NOT a branch inside `QuickSortMobileDock` itself: that
 * component's `destination`/`zoneCount`/`zoneCapacity`/consolidation props
 * are all `dock_zones` concepts a `load_positions` destination has no
 * equivalent for, and it was already at this repo's 300-line file ceiling.
 * `QuickSortMobileView` picks between the two by `flow.state`, exactly as
 * it already picks between `QuickSortMobile` and `QuickSortMobileDock`.
 *
 * Deliberately narrower than `QuickSortMobileDock`'s footer: no "Marcar
 * excepción" (`markException` requires the sectorize-mode dock batch —
 * `useQuickSortFlow` never creates one in stage mode, so the write would
 * silently no-op) and no consolidation fallback (positions have none) —
 * "Cancelar y volver al paso 1" is the only way off a rejected scan here.
 */
export interface QuickSortMobileStagePositionProps {
  positionDestination: ExpectedLoadPosition;
  currentPackage: QuickSortPackageInfo | null;
  rejectedCode: string | null;
  scans: QuickSortScanEvent[];
  onScanPosition: (code: string) => void;
  onCancel: () => void;
}

function timeLabel(at: Date): string {
  return at.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function QuickSortMobileStagePosition({
  positionDestination,
  currentPackage,
  rejectedCode,
  scans,
  onScanPosition,
  onCancel,
}: QuickSortMobileStagePositionProps) {
  const rejected = rejectedCode !== null;

  return (
    <div className="flex min-h-0 flex-col gap-5 px-5 py-[22px] pb-[104px]">
      {/* Same accessibility-sweep contract as QuickSortMobileDock (spec-68
          Fase 6.3): this screen has no visible title by design, but it is
          the route's only content whenever `scan_position` is showing, so
          it still needs exactly one top-level heading. */}
      <h1 className="sr-only">
        {rejected
          ? `Posición incorrecta — se esperaba ${positionDestination.positionCode}`
          : `Escanear posición — llevar a ${positionDestination.positionCode}`}
      </h1>

      {rejected ? (
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
          <p className="font-heading text-[15px] font-semibold text-status-error-text">
            Posición incorrecta
          </p>
          <p className="text-[12.5px] leading-[1.4] text-status-error-text">
            Esperado {positionDestination.positionCode}
          </p>
          <p className="text-[12.5px] leading-[1.4] text-status-error-text">
            {currentPackage?.label ?? 'El paquete'} sigue sin asignar · no se movió nada en el sistema
          </p>
          <div className="mt-1 rounded-lg border border-status-error-border/60 bg-surface px-3 py-2">
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.1em] text-text-muted">
              Llevar a
            </span>
            <p className="font-mono text-[26px] font-bold leading-none text-text">
              {positionDestination.positionCode}
            </p>
            {positionDestination.positionLabel && (
              <p className="text-[12px] text-text-secondary">{positionDestination.positionLabel}</p>
            )}
          </div>
        </div>
      ) : (
        <div
          data-testid="quicksort-destination-card"
          data-tone="ok"
          className="flex flex-col gap-1.5 rounded-2xl border-2 border-status-success-border bg-status-success-bg px-5 py-5"
        >
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.12em] text-status-success-text">
            LLEVAR A
          </span>
          <span className="font-mono text-[62px] font-bold leading-none tracking-tight text-status-success-text">
            {positionDestination.positionCode}
          </span>
          {positionDestination.positionLabel && (
            <p className="text-[13px] text-status-success-text">{positionDestination.positionLabel}</p>
          )}
          {currentPackage && (
            <p className="mt-1 text-[12px] text-status-success-text">
              {currentPackage.label} · orden {currentPackage.orderNumber}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2.5 rounded-2xl border-2 border-dashed border-accent bg-accent-muted px-5 py-6">
        <span className="text-center font-mono text-[9.5px] font-semibold uppercase tracking-[.12em] text-accent">
          AHORA ESCANEA LA POSICIÓN
        </span>
        <ScanField ariaLabel="Escanear posición" size="sm" onScan={onScanPosition} />
        <p className="text-center text-[11.5px] leading-[1.4] text-text-secondary">
          Solo acepta {positionDestination.positionCode} · sin escaneo no queda asignado
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

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-border bg-surface px-4 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-[56px] flex-1 items-center justify-center rounded-xl border border-border bg-surface text-[14px] font-medium text-text transition-colors active:bg-surface-raised"
        >
          Cancelar y volver al paso 1
        </button>
      </div>
    </div>
  );
}
