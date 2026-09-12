'use client';

import { ScanLine } from 'lucide-react';
import { DistributionMobileHeader, useIsOnline } from './DistributionMobileHeader';
import { DockCapacityBar } from './DockCapacityBar';
import { ScanField } from '@/components/scan/ScanField';
import { ScanResult } from '@/components/scan/ScanResult';
import { SealPositionCard } from '@/components/distribution/SealPositionCard';
import { refocusPackageField } from '@/lib/scan/refocus-package-field';
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
 * spec-68 Fase 5.2 — `4g`, quicksort step 1, below `lg`.
 *
 * Top to bottom: titled header (operator · paso 1 de 2 · N escaneos hoy,
 * connection chip), the mode toggle (spec-71 phase 3 mobile), the
 * dashed-accent scan panel, the session counter row, ÚLTIMOS ESCANEOS, and
 * the fixed footer (Ingresar código / Cerrar lote).
 *
 * "N escaneos hoy" reads `sessionCount` — the same session counter
 * `useQuickSortFlow` already tracks. There is no server-side "scans today"
 * query in this codebase (Decisión 9's pattern: don't invent one for a
 * number the session count already answers close enough for), and turnos
 * don't exist in the schema either (Decisión 9, `4c`).
 *
 * spec-71 phase 3 mobile — desktop's entry point into `mode: 'stage'` is a
 * `Tabs` dropped into `/app/distribution/quicksort`'s header row. Two
 * `h-11` (44px) touch targets in a `role="tablist"` matching the semantics
 * `Tabs` gives desktop. Only rendered when `onModeChange` is passed, so
 * every other caller stays unaffected. Mode only switches on step 1 — step
 * 2 has no header for a toggle to live in, and switching mid-scan makes no
 * operational sense.
 *
 * spec-96 Fase 1 (`4g`) — Round 2 of the mock moved this toggle into the
 * titled header's title row, right of "Clasificación en andén" /
 * "Carga a posición", via `DistributionMobileHeader`'s new (additive)
 * `titleControl` prop. It used to render as its own pill row below the
 * whole header.
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
   * spec-96 Fase 1 review finding #1 (`4j`) — present only when
   * `useQuickSortFlow`'s state is `'confirmed'`: the destination, package
   * and sibling-count kept from the andén scan that JUST succeeded, plus
   * the destination zone's live count/capacity for the capacity block.
   * `undefined` by default — every other caller (and `4g`'s own first
   * visit, before any scan) renders exactly as before.
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

  // spec-96 Fase 1 (`4g`) — moved from its own pill row below the header
  // into DistributionMobileHeader's `titleControl` slot, right of the
  // title, matching the artboard.
  //
  // review findings #2/#3 — the artboard's box is ~91×23.5px with `SECT`/
  // `ESTIB` at 9.5px mono, nowhere near 44px. Rather than either shrink the
  // spec-71 touch-target floor to fit the mock or inflate the visual box
  // past it, each `<button>` carries the REAL 44px hit area via inline
  // `minHeight`/`minWidth` (invisible — no border, no background of its
  // own), and an inner `<span>` carries 100% of the artboard's visible
  // styling. The two boxes are deliberately different sizes.
  const modeToggle = onModeChange && (
    <div
      role="tablist"
      aria-label="Modo de escaneo"
      className="flex flex-none items-center gap-0.5 rounded-[7px] border border-border bg-surface-raised p-0.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'sectorize'}
        onClick={() => { onModeChange('sectorize'); refocusPackageField(); }}
        style={{ minHeight: '44px', minWidth: '44px' }}
        className="flex items-center justify-center"
      >
        <span
          className={cn(
            'rounded-[5px] px-2 py-1 font-mono text-[9.5px] transition-colors',
            mode === 'sectorize' ? 'bg-surface font-semibold text-text' : 'font-medium text-text-muted',
          )}
        >
          SECT
        </span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'stage'}
        onClick={() => { onModeChange('stage'); refocusPackageField(); }}
        style={{ minHeight: '44px', minWidth: '44px' }}
        className="flex items-center justify-center"
      >
        <span
          className={cn(
            'rounded-[5px] px-2 py-1 font-mono text-[9.5px] transition-colors',
            mode === 'stage' ? 'bg-surface font-semibold text-text' : 'font-medium text-text-muted',
          )}
        >
          ESTIB
        </span>
      </button>
    </div>
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

      {confirmed && (
        <div data-testid="quicksort-confirmed-context" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 rounded-2xl border-2 border-status-success-border bg-status-success-bg px-5 py-5">
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.12em] text-status-success-text">
              LLEVAR A
            </span>
            <span className="font-mono text-[62px] font-bold leading-none tracking-tight text-status-success-text">
              {confirmed.destination.zone_code}
            </span>
            <p className="text-[13px] text-status-success-text">{confirmed.destination.zone_name}</p>
            {confirmed.currentPackage && (
              <p className="mt-1 text-[12px] text-status-success-text">
                {confirmed.currentPackage.comunaName ?? 'Sin comuna'} · {confirmed.currentPackage.label} · orden{' '}
                {confirmed.currentPackage.orderNumber}
              </p>
            )}
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
          </div>

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
      )}

      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-accent-muted px-5 py-8 text-center">
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.12em] text-accent">
          PASO 1 · PAQUETE
        </span>
        <ScanLine className="h-9 w-9 text-accent" aria-hidden="true" />
        <p className="font-heading text-[17px] font-semibold leading-tight text-text">
          {confirmed ? 'Escanea el siguiente paquete' : 'Escanea el paquete'}
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

      <div
        data-testid="quicksort-session-counter"
        className="flex items-center justify-between rounded-lg border border-border bg-surface px-3.5 py-2.5"
      >
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.08em] text-text-muted">
          En esta sesión
        </span>
        <span className="font-mono text-[15px] font-bold text-text">{sessionCount}</span>
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
          onClick={onEnterCode}
          className="flex h-[56px] flex-1 items-center justify-center rounded-xl border border-border bg-surface text-[14px] font-medium text-text transition-colors active:bg-surface-raised"
        >
          Ingresar código
        </button>
        {confirmed ? (
          // spec-96 Fase 1 review finding #1 (4j) — the mock swaps this
          // slot for "Marcar excepción", but its target action is an open
          // product question: `markException`/`recordQuickSortException`
          // are scoped to a rejected `rejectedCode`, which does not exist
          // once the andén scan already succeeded. Rendered present,
          // disabled, rather than wired to a call that would misrecord or
          // silently no-op — see the phase's spec evidence.
          <button
            type="button"
            disabled
            className="flex h-[56px] flex-1 items-center justify-center rounded-xl border border-status-error-border text-[14px] font-semibold text-status-error-text opacity-60"
          >
            Marcar excepción
          </button>
        ) : (
          <button
            type="button"
            onClick={onCloseBatch}
            className="flex h-[56px] flex-1 items-center justify-center rounded-xl bg-accent-light text-[14px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
          >
            Cerrar lote
          </button>
        )}
      </div>
    </div>
  );
}
