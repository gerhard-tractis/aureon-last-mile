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
import { useCallback, useRef, useState } from 'react';
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

  const packagesLoaded = packages.reduce((sum, p) => sum + p.boxesLoaded, 0);
  const packagesTotal = packages.reduce((sum, p) => sum + p.boxesTotal, 0);
  const percent = packagesTotal > 0 ? Math.round((packagesLoaded / packagesTotal) * 100) : 0;

  const submitScan = useCallback(
    (code: string) => {
      const id = `scan-${nextId.current++}`;
      const atIso = new Date().toISOString();

      scanMutation.mutate(code, {
        onSuccess: (response) => {
          const context = orderContext?.get(response.order_id);
          // The box count this order had BEFORE this scan — `packages` is
          // stale until useRoutePackages' cache-invalidation refetch lands,
          // which is exactly what makes "+1" the right number for the box
          // the crew is holding right now, not a guess.
          const priorBoxes = packages.find((p) => p.order_id === response.order_id);
          const entry = buildAcceptedEntry({
            id,
            code,
            atIso,
            response,
            orderContext: context,
            boxes: priorBoxes ? { loaded: priorBoxes.boxesLoaded + 1, total: priorBoxes.boxesTotal } : undefined,
          });
          setHistory((h) => [entry, ...h]);
          // Lesson (spec-71 QA finding, refocus-package-field.ts): a
          // scanner gun types into whatever holds focus. ScanField
          // normally keeps its own focus, but 2f renders a NEW ScanResult
          // card in place on every read (decision 5 — no screen change),
          // so this is defence in depth against any DOM churn stealing it.
          refocusPackageField();
        },
        onError: (err: unknown) => {
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
          setHistory((h) => [entry, ...h]);
          refocusPackageField();
        },
      });
    },
    [scanMutation, orderContext, packages],
  );

  return {
    submitScan,
    isSubmitting: scanMutation.isPending,
    lastEntry: history[0] ?? null,
    history,
    rejectionCount: countRejections(history),
    rejectionTally: tallyRejections(history),
    packagesLoaded,
    packagesTotal,
    percent,
  };
}
