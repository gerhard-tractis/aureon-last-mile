'use client';

// apps/frontend/src/hooks/dispatch/mobile/useRouteScanSession.ts
//
// spec-76 phase 4 (2e/2f) — orchestrates the continuous scan loop. Reuses
// `useScanPackage` (the SAME mutation RouteBuilder desktop already calls —
// same endpoint, same cache invalidation) rather than a second copy of the
// fetch, and layers client-only session history on top: neither the
// endpoint nor `dock_scans` records a REJECTED scan (verified against
// route.ts and scan-validator.ts), so `history`/`rejectionCount`/
// `rejectionTally` are this tab's own memory only — gone on refresh.
import { useRef, useState } from 'react';
import { useScanPackage } from '@/hooks/dispatch/useScanPackage';
import { useRoutePackages } from '@/hooks/dispatch/useRoutePackages';
import { useRouteScanOrderContext } from './useRouteScanOrderContext';
import { routeCode } from '@/lib/dispatch/mobile/crew-board';
import { refocusPackageField } from '@/lib/scan/refocus-package-field';
import {
  buildAcceptedEntry,
  buildRejectedEntry,
  countRejections,
  tallyRejections,
  insertByAtIso,
  latestEntry,
  countAcceptedForOrder,
  type ScanHistoryEntry,
} from '@/lib/dispatch/mobile/scan-session';
import type { ScanRejectionCode } from '@/lib/dispatch/mobile/scan-rejection-copy';
import { ALL_REJECTION_CODES } from '@/lib/dispatch/mobile/scan-rejection-copy';

interface ScanFailure {
  code?: string;
  message?: string;
  conflictingRouteId?: string | null;
}

function isRejectionCode(code: string | undefined): code is ScanRejectionCode {
  return !!code && (ALL_REJECTION_CODES as readonly string[]).includes(code);
}

export function useRouteScanSession(routeId: string, operatorId: string) {
  const scanMutation = useScanPackage(routeId, operatorId);
  const { data: packages = [] } = useRoutePackages(routeId, operatorId);
  const { data: orderContext } = useRouteScanOrderContext(routeId, operatorId);
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const nextId = useRef(0);

  // spec-76 review Important #4 — a double Zebra trigger-pull re-submits
  // the SAME code while the first request is still in flight.
  // stage-dispatch.ts's write guard (`.or('loaded_at.is.null,
  // load_inferred.eq.true')`) throws on zero matched rows once the first
  // request already landed, surfacing as a 500 -> QUERY_FAILED -> a red
  // "FALLO DE RED" card and a permanent tally entry for a box that loaded
  // fine — a classic Zebra failure mode. A repeat of a code still in
  // flight is caught here instead: never sent a second time.
  const inFlightCodesRef = useRef<Set<string>>(new Set());

  // spec-76 review Important #3 — captured ONCE per order, the first time
  // THIS session scans it, from whatever useRoutePackages held at that
  // moment (accurate then — this session has not touched that order yet).
  // Combined with countAcceptedForOrder (this session's own running count,
  // read fresh from `history` at apply time) below, "paquete N de M" stays
  // correct regardless of when the query's cache-invalidation refetch
  // lands: a second box of the same order scanned before that refetch no
  // longer reads the same stale "+1" the first box did, and a refetch that
  // DOES land mid-session cannot double-count what this session already
  // added, because the baseline is never re-read after this first capture.
  const orderBaselineRef = useRef<Map<string, { loaded: number; total: number }>>(new Map());

  const packagesLoaded = packages.reduce((sum, p) => sum + p.boxesLoaded, 0);
  const packagesTotal = packages.reduce((sum, p) => sum + p.boxesTotal, 0);
  const percent = packagesTotal > 0 ? Math.round((packagesLoaded / packagesTotal) * 100) : 0;

  // Not wrapped in useCallback: `scanMutation` (useScanPackage's return
  // value) is a fresh object every render regardless, so a memoised
  // wrapper around it recreated on every dependency change bought nothing
  // — it is redefined every render either way. Nothing downstream needs
  // this function's identity to stay stable (ScanField/DispatchManualCode
  // Sheet just call whatever they were last handed).
  function submitScan(code: string) {
    const id = `scan-${nextId.current++}`;
    const atIso = new Date().toISOString();

    if (inFlightCodesRef.current.has(code)) {
      setHistory((h) =>
        insertByAtIso(
          h,
          buildRejectedEntry({
            id,
            code,
            atIso,
            failure: { code: 'ALREADY_STAGED', message: 'Paquete ya cargado en esta ruta' },
          }),
        ),
      );
      refocusPackageField();
      return;
    }
    inFlightCodesRef.current.add(code);

    scanMutation.mutate(code, {
      onSuccess: (response) => {
        inFlightCodesRef.current.delete(code);
        const orderId = response.order_id;
        if (!orderBaselineRef.current.has(orderId)) {
          const priorBoxes = packages.find((p) => p.order_id === orderId);
          if (priorBoxes) {
            orderBaselineRef.current.set(orderId, { loaded: priorBoxes.boxesLoaded, total: priorBoxes.boxesTotal });
          }
        }
        const baseline = orderBaselineRef.current.get(orderId);
        const context = orderContext?.get(orderId);
        setHistory((h) => {
          const acceptedSoFarForOrder = countAcceptedForOrder(h, orderId);
          const entry = buildAcceptedEntry({
            id,
            code,
            atIso,
            response,
            orderContext: context,
            boxes: baseline
              ? { loaded: baseline.loaded + acceptedSoFarForOrder + 1, total: baseline.total }
              : undefined,
          });
          return insertByAtIso(h, entry);
        });
        // Lesson (spec-71 QA finding, refocus-package-field.ts): a
        // scanner gun types into whatever holds focus. ScanField
        // normally keeps its own focus, but 2f renders a NEW ScanResult
        // card in place on every read (decision 5 — no screen change),
        // so this is defence in depth against any DOM churn stealing it.
        refocusPackageField();
      },
      onError: (err: unknown) => {
        inFlightCodesRef.current.delete(code);
        const failure = err as ScanFailure;
        const failureCode: ScanRejectionCode = isRejectionCode(failure.code) ? failure.code : 'QUERY_FAILED';
        const conflictingRouteId = failure.conflictingRouteId ?? null;
        const entry = buildRejectedEntry({
          id,
          code,
          atIso,
          failure: {
            code: failureCode,
            message: failure.message ?? 'No se pudo validar el código',
            conflictingRouteId,
          },
          conflictingRouteCode: conflictingRouteId ? routeCode(conflictingRouteId) : null,
        });
        setHistory((h) => insertByAtIso(h, entry));
        refocusPackageField();
      },
    });
  }

  return {
    submitScan,
    // spec-76 review Important #2 — the greatest atIso, not history[0]:
    // insertByAtIso already keeps the array sorted newest-first, but
    // deriving this by value (not array position) keeps it correct even
    // under a future change to how history is accumulated.
    lastEntry: latestEntry(history),
    history,
    rejectionCount: countRejections(history),
    rejectionTally: tallyRejections(history),
    packagesLoaded,
    packagesTotal,
    percent,
  };
}
