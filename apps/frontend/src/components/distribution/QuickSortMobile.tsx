'use client';

import { ScanLine } from 'lucide-react';
import { DistributionMobileHeader, useIsOnline } from './DistributionMobileHeader';
import { DockCapacityBar } from './DockCapacityBar';
import { QuickSortDestinationCard } from './QuickSortDestinationCard';
import { QuickSortModeToggle } from './QuickSortModeToggle';
import { ScanField } from '@/components/scan/ScanField';
import { ScanResult } from '@/components/scan/ScanResult';
import { SealPositionCard } from '@/components/distribution/SealPositionCard';
import { getDockCapacityStatus, type DockCapacityTone } from '@/lib/distribution/dock-capacity';
import { cn } from '@/lib/utils';
import type { ZoneMatchResult } from '@/lib/distribution/sectorization-engine';
import type {
  QuickSortFlowMode,
  QuickSortPackageInfo,
  QuickSortScanEvent,
} from '@/hooks/distribution/useQuickSortFlow';

// spec-96 Fase 1, Task 1.3 (4h/4j) — the same tone-to-class mapping
// QuickSortMobileDock uses for its own capacity block; kept local rather
// than shared because it's three lines and the two components already
// don't share a base.
const CAPACITY_BLOCK_TONE_CLASS: Record<DockCapacityTone, string> = {
  neutral: 'border-border bg-surface',
  warning: 'border-status-warning-border bg-status-warning-bg',
  error: 'border-status-error-border bg-status-error-bg',
};

/**
 * spec-68 Fase 5.2 — `4g`, quicksort step 1, below `lg`. Header (SECT/ESTIB
 * toggle in its title row) → either the plain first-visit panel + counter,
 * or `4j`'s destination/capacity context (`confirmed` set — see its own
 * doc below) → ÚLTIMOS ESCANEOS → footer. "N escaneos hoy" reads
 * `sessionCount`, the same counter `useQuickSortFlow` tracks — no
 * server-side query for it, same as turnos not existing (Decisión 9).
 */
export interface QuickSortMobileProps {
  operatorName: string | null;
  sessionCount: number;
  scans: QuickSortScanEvent[];
  error: string | null;
  onScan: (code: string) => void;
  onBack: () => void;
  /** Injectable for tests; defaults to `navigator.onLine` via
   *  `useIsOnline` (review fix #3 — was a hardcoded 'EN LÍNEA'). */
  isOnline?: boolean;
  /** Footer "Ingresar código" — focuses the scan field for manual keyboard
   *  entry (the field IS a text input; scanning it into the DOM is what a
   *  scanner gun already does). No separate keypad in this codebase. */
  onEnterCode: () => void;
  /** Footer "Cerrar lote" — ends the session and returns to Distribución. */
  onCloseBatch: () => void;
  /** Defaults to `'sectorize'` — unchanged behaviour when omitted. */
  mode?: QuickSortFlowMode;
  /** Renders the Sectorizar/Estibar toggle when provided. */
  onModeChange?: (mode: QuickSortFlowMode) => void;
  /**
   * spec-96 Fase 1 review finding #1 (`4j`) — set only when
   * `useQuickSortFlow`'s state is `'confirmed'` AND `mode === 'sectorize'`
   * (round 2 must-fix: without the mode check this leaked a dock's
   * context across a switch to ESTIB). `undefined` by default — every
   * other caller renders exactly as before.
   */
  confirmed?: {
    destination: ZoneMatchResult;
    currentPackage: QuickSortPackageInfo | null;
    siblingsPending: number;
    zoneCount: number;
    zoneCapacity: number | null;
  };
}

function timeLabel(at: Date): string {
  return at.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function QuickSortMobile({
  operatorName,
  sessionCount,
  scans,
  error,
  onScan,
  onBack,
  onEnterCode,
  onCloseBatch,
  isOnline: isOnlineOverride,
  mode = 'sectorize',
  onModeChange,
  confirmed,
}: QuickSortMobileProps) {
  const isOnline = useIsOnline(isOnlineOverride);
  const confirmedCapacity = confirmed
    ? getDockCapacityStatus(confirmed.zoneCount, confirmed.zoneCapacity)
    : null;

  // spec-96 Fase 1 review round 2, "Also fix" #4 — extracted to
  // `QuickSortModeToggle.tsx`; see its own doc comment for findings #2/#3.
  const modeToggle = onModeChange && (
    <QuickSortModeToggle mode={mode} onModeChange={onModeChange} />
  );

  return (
    <div className="flex min-h-0 flex-col gap-5 px-5 py-[22px] pb-[104px]">
      <DistributionMobileHeader
        variant="titled"
        title={mode === 'stage' ? 'Carga a posición' : 'Clasificación en andén'}
        subtitle={`${operatorName ?? 'Operario'} · paso 1 de 2 · ${sessionCount} escaneos hoy`}
        onBack={onBack}
        titleControl={modeToggle}
        statusChip={
          isOnline
            ? { label: 'EN LÍNEA', tone: 'success' }
            : { label: 'SIN CONEXIÓN', tone: 'error' }
        }
      />

      {confirmed ? (
        // spec-96 Fase 1 review round 2, "Also fix" #1 (4j) — header →
        // destination card (incomplete-order INSIDE it) → capacity block
        // → últimos escaneos, no dashed panel and no counter row here.
        // Both moved to `4g`-only below; the count already lives in the
        // header subtitle.
        <div data-testid="quicksort-confirmed-context" className="flex flex-col gap-3">
          <QuickSortDestinationCard
            destination={confirmed.destination}
            currentPackage={confirmed.currentPackage}
          >
            {confirmed.siblingsPending > 0 && (
              <p
                data-testid="quicksort-confirmed-incomplete-order"
                className="mt-1 rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-[12px] leading-[1.4] text-status-warning-text"
              >
                Falta {confirmed.siblingsPending}{' '}
                {confirmed.siblingsPending === 1 ? 'paquete' : 'paquetes'} de esta orden · sale
                incompleta si cierras el andén
              </p>
            )}
          </QuickSortDestinationCard>

          {confirmedCapacity?.configured && confirmedCapacity.tone && (
            <div
              data-testid="quicksort-confirmed-capacity"
              data-tone={confirmedCapacity.tone}
              className={cn(
                'rounded-lg border px-4 py-3',
                CAPACITY_BLOCK_TONE_CLASS[confirmedCapacity.tone],
              )}
            >
              <DockCapacityBar count={confirmed.zoneCount} capacity={confirmed.zoneCapacity} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-accent-muted px-5 py-8 text-center">
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.12em] text-accent">
            PASO 1 · PAQUETE
          </span>
          <ScanLine className="h-9 w-9 text-accent" aria-hidden="true" />
          <p className="font-heading text-[17px] font-semibold leading-tight text-text">
            Escanea el paquete
          </p>
          <p className="text-[12.5px] leading-[1.4] text-text-secondary">
            {mode === 'stage'
              ? 'El sistema te dirá a qué posición va antes de que lo muevas'
              : 'El sistema te dirá a qué andén va antes de que lo muevas'}
          </p>
          <ScanField
            ariaLabel="Escanear paquete"
            size="sm"
            onScan={onScan}
            className="w-full"
          />
        </div>
      )}

      {/* spec-71 phase 4 — the position seal, reachable from stage mode's
          step 1 only (positions have nothing to seal until packages are
          staged into them). Same component desktop uses — not a fork.
          Review fix #1 — the card collapses on its own after a seal or a
          cancel; `onCollapse` hands focus back to the package field above,
          the same `querySelector` pattern `QuickSortMobileView`'s
          `onEnterCode` already uses (this component owns no ref to a
          field it does not render itself). */}
      {mode === 'stage' && (
        <SealPositionCard
          onCollapse={() => {
            document
              .querySelector<HTMLInputElement>('input[aria-label="Escanear paquete"]')
              ?.focus();
          }}
        />
      )}

      {error && <ScanResult status="error" title={error} />}

      {/* spec-96 Fase 1 review round 2, "Also fix" #1 — `4g`-only; `4j`'s
          count already lives in the header subtitle ("N escaneos hoy"),
          and keeping this row too was part of why the screen scrolled. */}
      {!confirmed && (
        <div
          data-testid="quicksort-session-counter"
          className="flex items-center justify-between rounded-lg border border-border bg-surface px-3.5 py-2.5"
        >
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.08em] text-text-muted">
            En esta sesión
          </span>
          <span className="font-mono text-[15px] font-bold text-text">{sessionCount}</span>
        </div>
      )}

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

      {/* review round 2 — #1: 4j's compact armed field lives here, not the
          dashed panel above. #3: Cerrar lote stays the second action in
          every state — a permanently disabled Marcar excepción (no target
          action `useQuickSortFlow` supports) would displace the only live
          control on the screen shown after EVERY correct scan; declared
          deferred instead, not shipped disabled. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2.5 border-t border-border bg-surface px-4 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
        {confirmed && (
          <div data-testid="quicksort-confirmed-scan-field" className="[&_input]:text-[15px]">
            <ScanField
              ariaLabel="Escanear paquete"
              size="sm"
              onScan={onScan}
              placeholder="Escanea el siguiente paquete…"
            />
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onEnterCode}
            className="flex h-[56px] flex-1 items-center justify-center rounded-xl border border-border bg-surface text-[14px] font-medium text-text transition-colors active:bg-surface-raised"
          >
            Ingresar código
          </button>
          <button
            type="button"
            onClick={onCloseBatch}
            className="flex h-[56px] flex-1 items-center justify-center rounded-xl bg-accent-light text-[14px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
          >
            Cerrar lote
          </button>
        </div>
      </div>
    </div>
  );
}
