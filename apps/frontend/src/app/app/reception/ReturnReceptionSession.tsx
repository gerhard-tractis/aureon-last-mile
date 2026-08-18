'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScanField } from '@/components/scan/ScanField';
import { ReturnPackageRow } from '@/components/reception/ReturnPackageRow';
import { StackedProgress } from '@/components/StackedProgress';
import { useReturnReceptionSession } from '@/hooks/reception/useReturnReceptionSession';
import { cn } from '@/lib/utils';

/**
 * spec-54 phase 4.6 — Recepción de reingresos, móvil (mock 1k).
 *
 * Restyle only: scanning, matching and session state all come from
 * useReturnReceptionSession unchanged. See ReturnPackageRow for why the
 * mock's "disposición" (REINTENTO/GESTIÓN) column is omitted, and why the
 * per-row "currently scanning" highlight was removed.
 *
 * THE BUTTON DOES NOT CLOSE ANYTHING. It reads "Volver al listado" and calls
 * `onBack`, which (see apps/frontend/src/app/app/reception/page.tsx) only
 * does `setSelectedReturnRoute(null)` — client-side navigation back to the
 * route list. There is no RPC call, no `return_receptions.status`
 * transition, and nothing in packages/database/supabase/migrations creates
 * an incidencia or a faltante concept for this flow (that machinery —
 * complete_route_reception — belongs to the *other*, spec-52 hub reception,
 * not returns). Do not relabel this "Cerrar reingreso" or reintroduce
 * copy that describes a close/completion consequence unless an actual close
 * RPC lands first — that is feature work, out of scope for this restyle.
 */

interface ReturnReceptionSessionProps {
  operatorId: string | null;
  externalRouteId: string;
  onBack: () => void;
}

type ScanFeedback = 'received' | 'not_found' | 'route_mismatch' | 'duplicate' | null;

const FEEDBACK_LABELS: Record<NonNullable<ScanFeedback>, string> = {
  received: 'Recibido',
  not_found: 'No encontrado',
  route_mismatch: 'Ruta incorrecta',
  duplicate: 'Ya registrado',
};

const FEEDBACK_TONE: Record<NonNullable<ScanFeedback>, string> = {
  received: 'text-status-success-text',
  not_found: 'text-status-error-text',
  route_mismatch: 'text-status-error-text',
  duplicate: 'text-status-warning-text',
};

// 'pending' and 'completed' are carried here for when this screen (or a
// future close flow) can actually produce them, but neither is reachable
// today: find_or_create_return_reception only ever returns or inserts rows
// with status='in_progress', and nothing in this codebase transitions a
// return_receptions row to 'completed'. Do not read the presence of these
// branches as evidence either state occurs in practice.
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: {
    label: 'PENDIENTE',
    className: 'border-border-strong bg-surface-raised text-text-secondary',
  },
  in_progress: {
    label: 'EN CURSO',
    className: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  },
  completed: {
    label: 'CERRADO',
    className: 'border-status-success-border bg-status-success-bg text-status-success-text',
  },
};

export function ReturnReceptionSession({
  operatorId,
  externalRouteId,
  onBack,
}: ReturnReceptionSessionProps) {
  const {
    expectedCount,
    receivedCount,
    packages,
    status,
    driverName,
    isLoading,
    error,
    packagesError,
    scan,
  } = useReturnReceptionSession({ operatorId, externalRouteId });

  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const [isScanning, setIsScanning] = useState(false);

  const handleScan = async (code: string) => {
    if (isScanning) return;
    setIsScanning(true);
    setFeedback(null);
    try {
      const res = await scan(code);
      setFeedback(res.result as ScanFeedback);
    } finally {
      setIsScanning(false);
    }
  };

  const badge = status ? STATUS_BADGE[status] : null;
  // Single definition of "pending" for the whole screen (bar and footer both
  // read it from here) — packages.length can lag behind expectedCount /
  // receivedCount for a beat after a scan (list refetch vs. session refetch
  // land separately), so deriving "all done" from the list length instead of
  // the counts risks showing a stale "todos recibidos" next to a non-zero
  // counter.
  const pendingCount = Math.max(0, expectedCount - receivedCount);
  // expected_count is recomputed live from retorno_hub state, so a route whose
  // returns a colleague already processed — or one opened by mistake — yields a
  // real 0/0 session. "Todos los paquetes fueron recibidos" would be a false
  // completion claim there: this session received nothing.
  const nothingExpected = expectedCount === 0;

  // Kept apart on purpose. The session RPC failing (not found, RLS denial,
  // advisory-lock timeout) is a different problem from the package list
  // failing, and telling an operator "packages could not be loaded" when the
  // session itself never resolved sends them looking in the wrong place.
  const loadErrorMessage = error
    ? 'No se pudo abrir la sesión de reingreso.'
    : packagesError
      ? 'No se pudieron cargar los paquetes de este reingreso.'
      : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Volver" className="mt-0.5">
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Volver</span>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-semibold leading-none text-text">
              Reingreso {externalRouteId}
            </h2>
            {badge && (
              <span
                className={cn(
                  'flex-none rounded border px-1.5 py-[3px] font-mono text-[9.5px] font-semibold leading-none',
                  badge.className,
                )}
              >
                {badge.label}
              </span>
            )}
          </div>
          {/* Closing time omitted: find_or_create_return_reception does not
              return return_receptions.completed_at, and while the session is
              in_progress the column is null anyway — nothing to render
              honestly until this screen (or a future one) actually closes
              the session. */}
          <p className="mt-1 text-[11px] leading-none text-text-secondary">
            {driverName ?? 'Sin conductor'}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2" data-testid="return-session-loading">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-[62px] w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : loadErrorMessage ? (
        <p className="rounded-lg border border-status-error-border bg-status-error-bg p-3 text-sm text-status-error-text">
          {loadErrorMessage} Intenta de nuevo.
        </p>
      ) : (
        <>
          {/* Progress */}
          <div className="flex items-center gap-3">
            <StackedProgress
              className="flex-1"
              height={8}
              ariaLabel="Progreso de recepción"
              segments={[
                { key: 'received', label: 'Recibidos', value: receivedCount, tone: 'success' },
                { key: 'pending', label: 'Pendientes', value: pendingCount, tone: 'neutral' },
              ]}
            />
            <span className="flex-none font-mono text-[13px] font-semibold leading-none text-text">
              {receivedCount}/{expectedCount}
            </span>
          </div>

          {/* Scanner */}
          <ScanField
            onScan={(code) => void handleScan(code)}
            size="sm"
            placeholder="Escanear código de barras..."
            disabled={isScanning}
          />

          {feedback && (
            <p className={cn('text-sm font-semibold', FEEDBACK_TONE[feedback])}>
              {FEEDBACK_LABELS[feedback]}
            </p>
          )}

          {/* Package list */}
          <div className="space-y-2">
            {packages.map((pkg) => (
              <ReturnPackageRow
                key={pkg.id}
                label={pkg.label}
                orderNumber={pkg.order_number}
                returnReason={pkg.return_reason}
                comuna={pkg.comuna}
                received={pkg.received}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-[11px] leading-[1.45] text-text-secondary">
              {nothingExpected
                ? 'Este reingreso no tiene paquetes pendientes de recepción.'
                : pendingCount > 0
                  ? `Tu progreso queda guardado: ${pendingCount} ${pendingCount === 1 ? 'paquete' : 'paquetes'} sin escanear. Puedes retomar esta sesión más tarde.`
                  : 'Todos los paquetes fueron recibidos.'}
            </p>
            <Button
              variant="outline"
              className="h-auto w-full min-h-[52px] py-[18px] text-[15px] font-semibold"
              onClick={onBack}
            >
              Volver al listado
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
