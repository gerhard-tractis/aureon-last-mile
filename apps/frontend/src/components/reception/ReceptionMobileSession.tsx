'use client';

import { useMemo, useState } from 'react';
import { ScanField } from '@/components/scan/ScanField';
import { ReceptionScanFeedback } from './ReceptionScanFeedback';
import { ManualCodeSheet } from './ManualCodeSheet';
import { DiscrepancyNoteSheet } from './DiscrepancyNoteSheet';
import { finalizeRule } from '@/lib/reception/finalize-rule';
import { timeLabel } from '@/lib/reception/reception-mobile-helpers';
import { cn } from '@/lib/utils';
import type { RouteReceptionSnapshot } from '@/hooks/reception/useRouteReceptionSnapshot';
import type { ReceptionScanValidationResult } from '@/lib/reception/reception-scan-validator';
import type { ConnectionState } from '@/hooks/useSyncQueue';

/**
 * spec-62 chunk 3 (task 18) — the unloading screen itself (mock 3q). An
 * operator at a truck, Zebra gun in hand, scans box after box for as long as
 * it takes to empty it. Nothing here blocks that rhythm: duplicates, ajenos
 * and unknown barcodes are all recorded and the count continues —
 * reconciliation happens once, at Confirmar, not mid-unload.
 *
 * Nothing in this file calls `open_route_reception` — that RPC belongs to
 * arrival, a different screen entirely. This component only ever calls the
 * two callbacks it is handed.
 */
export interface ReceptionMobileSessionProps {
  snapshot: RouteReceptionSnapshot;
  lastScanResult: ReceptionScanValidationResult | null;
  syncStatus: ConnectionState;
  queuedCount: number;
  isScanPending: boolean;
  isFinalizePending: boolean;
  onScan: (barcode: string) => void;
  onFinalize: (note: string | null) => void;
}

export function ReceptionMobileSession({
  snapshot,
  lastScanResult,
  syncStatus,
  queuedCount,
  isScanPending,
  isFinalizePending,
  onScan,
  onFinalize,
}: ReceptionMobileSessionProps) {
  // Starts false, deliberately (task-18 finding 1). ScanField's mount effect
  // only fires `onFocusStateChange` when focus genuinely moves and only when
  // it is not disabled — a field that mounted already claiming "ready" would
  // be lying about a trigger pull that has not landed yet. The real mount
  // focus flips this to true almost immediately; nothing here fakes it.
  const [readerReady, setReaderReady] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // The raw code just scanned, tracked independently of the validation
  // result — `not_found` returns `packageLabel: null` (finding 3), so this
  // is the only source left for naming the box the operator is holding.
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);

  const { route, route_reception: reception, scans } = snapshot;
  const { expected_count: expectedCount, received_count: receivedCount, unexpected_count: unexpectedCount } =
    reception;

  const progressPct = expectedCount > 0 ? Math.min(100, Math.round((receivedCount / expectedCount) * 100)) : 0;

  function handleScan(barcode: string) {
    setLastBarcode(barcode);
    onScan(barcode);
  }

  // The barcode that decided the last outcome: the validator's own
  // `packageLabel` when it has one (duplicate returns the barcode itself in
  // that field), the locally-tracked scan otherwise.
  const barcodeInPlay = lastScanResult?.packageLabel ?? lastBarcode;

  // Finding 2 — the duplicate's OWN row (written after the mutation
  // invalidates the snapshot) must never be read as "first scanned at". Only
  // `received` rows count, earliest first.
  const firstScanAt = useMemo(() => {
    if (!lastScanResult || lastScanResult.scanResult !== 'duplicate' || !barcodeInPlay) return null;
    const receivedAts = scans
      .filter((s) => s.barcode === barcodeInPlay && s.scan_result === 'received')
      .map((s) => s.scanned_at)
      .sort();
    return receivedAts[0] ?? null;
  }, [lastScanResult, barcodeInPlay, scans]);

  // Finding 3 — an unknown barcode names nothing on its own; fall back to
  // what was actually scanned so the operator sees it, not a blank result.
  const feedbackResult: ReceptionScanValidationResult | null =
    lastScanResult && lastScanResult.packageLabel === null && lastBarcode
      ? { ...lastScanResult, packageLabel: lastBarcode }
      : lastScanResult;

  const decision = finalizeRule({ expectedCount, receivedCount, unexpectedCount });

  function handleConfirm() {
    if (decision.needsNote) {
      setNoteOpen(true);
      return;
    }
    onFinalize(null);
  }

  function handleNoteConfirm(note: string) {
    onFinalize(note);
    setNoteOpen(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none border-b border-border bg-surface px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-semibold text-text">{route.code}</p>
            <p className="truncate text-[12px] text-text-secondary">{route.driver_name ?? 'Sin conductor'}</p>
          </div>
          <div className="flex flex-none items-baseline gap-1 font-mono text-[26px] font-bold leading-none text-text">
            <span>{receivedCount}</span>
            <span className="text-[16px] font-semibold text-text-secondary">/ {expectedCount}</span>
          </div>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-raised" aria-hidden="true">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      {syncStatus !== 'online' && (
        <div className="mx-4 mt-3 flex-none rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-[12px] leading-[1.4] text-status-warning-text">
          <span className="font-mono font-semibold">{queuedCount}</span>{' '}
          {syncStatus === 'offline'
            ? 'escaneos guardados en el dispositivo — se envían solos al recuperar señal. Puedes seguir contando.'
            : 'escaneos aún en cola — se envían solos apenas terminan de sincronizar.'}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <ScanField
          size="sm"
          ariaLabel="Código de barras"
          disabled={isScanPending}
          onScan={handleScan}
          onFocusStateChange={setReaderReady}
        />

        <div className="mt-2 flex items-center gap-2">
          <p
            className={cn(
              'flex-1 text-[11.5px] font-medium',
              readerReady ? 'text-status-success-text' : 'text-status-warning-text',
            )}
          >
            {readerReady ? 'Lector listo' : 'Toca para reactivar el lector'}
          </p>
          <button
            type="button"
            aria-label="Código manual"
            onClick={() => setManualOpen(true)}
            className="flex h-11 min-w-11 flex-none items-center justify-center rounded-lg border border-border bg-surface px-3 text-[12px] font-semibold text-text transition-colors active:bg-surface-raised"
          >
            Código manual
          </button>
        </div>

        <div className="mt-3" data-testid="scan-feedback">
          <ReceptionScanFeedback
            result={feedbackResult}
            receivedCount={receivedCount}
            firstScanAt={firstScanAt}
          />
        </div>

        {scans.length > 0 && (
          <div className="mt-4 flex flex-col gap-1.5">
            {[...scans].reverse().map((scan) => (
              <ScanHistoryRow key={scan.id} scan={scan} />
            ))}
          </div>
        )}
      </div>

      <footer className="flex flex-none gap-2 border-t border-border bg-surface px-4 py-3">
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="flex h-14 flex-1 items-center justify-center rounded-[12px] border border-border bg-surface text-[13.5px] font-medium text-text transition-colors active:bg-surface-raised"
        >
          Reportar discrepancia
        </button>
        <button
          type="button"
          disabled={isFinalizePending}
          onClick={handleConfirm}
          className="flex h-14 flex-1 items-center justify-center rounded-[12px] bg-accent-light text-[13.5px] font-semibold text-accent-light-foreground transition-opacity disabled:opacity-50"
        >
          Confirmar
        </button>
      </footer>

      <ManualCodeSheet open={manualOpen} onOpenChange={setManualOpen} onSubmit={handleScan} />

      <DiscrepancyNoteSheet
        open={noteOpen}
        onOpenChange={setNoteOpen}
        counts={{ expectedCount, receivedCount, unexpectedCount }}
        isPending={isFinalizePending}
        onConfirm={handleNoteConfirm}
      />
    </div>
  );
}

const SCAN_ROW_CHIP: Record<string, { label: string; className: string } | undefined> = {
  duplicate: { label: 'REPETIDO', className: 'bg-status-warning-bg text-status-warning-text' },
  not_found: { label: 'AJENO', className: 'bg-status-error-bg text-status-error-text' },
  route_mismatch: { label: 'AJENO', className: 'bg-status-error-bg text-status-error-text' },
};

function ScanHistoryRow({ scan }: { scan: RouteReceptionSnapshot['scans'][number] }) {
  const chip = SCAN_ROW_CHIP[scan.scan_result];
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">{scan.barcode}</span>
      {chip && (
        <span
          className={cn(
            'flex-none rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[.04em]',
            chip.className,
          )}
        >
          {chip.label}
        </span>
      )}
      <span className="flex-none font-mono text-[10px] text-text-muted">{timeLabel(scan.scanned_at)}</span>
    </div>
  );
}
