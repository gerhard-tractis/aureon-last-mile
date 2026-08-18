import { StackedProgress } from '@/components/StackedProgress';
import { sumExpected } from '@/lib/pickup/manifestProgress';
import type { RouteManifestRow } from './RouteManifestList';

/**
 * spec-54 phase 4.6 — mobile driver active-route header, against mock 1i.
 *
 * Real domain check: `pickup_routes` has no SLA/deadline field and no
 * estimated-closure timestamp (see the table definition in
 * `20260625000001_spec47_pickup_routes_consolidated_reception.sql`), so the
 * mock's SLA badge and "CIERRE EST." metric are both omitted rather than
 * invented. This screen also has no per-package "failed pickup" outcome —
 * `scan_result_enum` is `verified | not_found | duplicate`, and "not_found"
 * means a scanned barcode did not match the manifest, not that a delivery
 * failed. So the stacked bar carries two segments (verified / remaining)
 * instead of the mock's three (delivered / failed / remaining), and the
 * metrics row is VERIFICADOS / RESTAN / MANIFIESTOS instead of the mock's
 * four — FALLIDAS has no source and is dropped along with CIERRE EST.
 *
 * `total_packages` is nullable (OCR/manual intake does not guarantee it).
 * When ANY linked manifest lacks a total, the route's real total is
 * genuinely unknown — not just partially known — so the denominator, the
 * RESTAN metric and the stacked bar all fall back to an explicit "unknown"
 * state instead of quietly summing only the manifests that do have a total
 * (which would understate the route and could show impossible math like a
 * bar past 100%). A one-line note names how many manifests are missing one.
 */

interface RouteProgressHeaderProps {
  route: {
    code: string;
    started_at: string;
    vehicle: { plate: string } | null;
  };
  manifests: RouteManifestRow[];
  /** True while `useRouteManifests` is still loading. `manifests` is `[]` in
   *  that state, which is indistinguishable from "route genuinely has zero
   *  manifests" unless this is set — without it the header fabricated a
   *  "0/0" and an empty progress bar during the fetch. */
  isLoading?: boolean;
}

function Metric({ testId, label, value }: { testId: string; label: string; value: number | string }) {
  return (
    <div data-testid={testId} className="flex flex-col items-end gap-0.5">
      <span className="font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-text-muted">
        {label}
      </span>
      <span className="font-mono text-[17px] font-bold leading-none text-text">{value}</span>
    </div>
  );
}

export function RouteProgressHeader({ route, manifests, isLoading = false }: RouteProgressHeaderProps) {
  const totalVerified = manifests.reduce((s, m) => s + m.verified_count, 0);
  const { knownExpectedSum, hasUnknownExpected } = sumExpected(manifests);
  const unknownCount = manifests.filter((m) => m.total_packages == null).length;

  const denominatorLabel = hasUnknownExpected ? '—' : String(knownExpectedSum);
  const restanLabel = hasUnknownExpected
    ? '—'
    : Math.max(knownExpectedSum - totalVerified, 0);

  const started = new Date(route.started_at);
  // Built manually rather than via Intl.DateTimeFormat: es-CL's "2-digit"
  // month option does not reliably zero-pad across ICU builds, and this
  // format only needs to be unambiguous, not locale-perfect.
  const dateLabel =
    `${String(started.getDate()).padStart(2, '0')}-` +
    `${String(started.getMonth() + 1).padStart(2, '0')}`;
  const timeLabel = started.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

  return (
    <header className="rounded-lg border border-border bg-surface p-4" data-testid="route-progress-header">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-text">{route.code}</p>
          <p className="text-xs text-text-secondary mt-1">
            Salida {dateLabel} {timeLabel}
            {route.vehicle?.plate ? ` · ${route.vehicle.plate}` : ''}
          </p>
        </div>
        {!isLoading && (
          <span className="font-mono text-sm font-semibold text-text shrink-0">
            {totalVerified}/{denominatorLabel}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="mt-3 text-[11.5px] text-text-secondary" role="status">
          Cargando manifiestos…
        </p>
      ) : hasUnknownExpected ? (
        <p className="mt-3 text-[11.5px] text-text-secondary">
          Total pendiente de definir en {unknownCount}{' '}
          {unknownCount === 1 ? 'manifiesto' : 'manifiestos'} (sin conteo de paquetes en la
          recepción del manifiesto).
        </p>
      ) : (
        <>
          <StackedProgress
            className="mt-3"
            height={8}
            ariaLabel="Progreso de verificación de la ruta"
            segments={[
              { key: 'verified', label: 'Verificados', value: totalVerified, tone: 'success' },
              {
                key: 'remaining',
                label: 'Restantes',
                value: Math.max(knownExpectedSum - totalVerified, 0),
                tone: 'neutral',
              },
            ]}
          />
          {/* StackedProgress's counts live only in its `title` attribute,
              which screen readers do not reliably announce. It is shared
              with other screens (the tower's "Promesa del día"), so rather
              than change its accessibility contract there, this wraps it
              here with a plain, always-rendered sentence carrying the same
              numbers. */}
          <p className="sr-only">
            {totalVerified} de {knownExpectedSum} paquetes verificados.
          </p>
        </>
      )}

      {!isLoading && (
        <div className="mt-3 flex items-center justify-end gap-5">
          <Metric testId="metric-verificados" label="VERIFICADOS" value={totalVerified} />
          <Metric testId="metric-restan" label="RESTAN" value={restanLabel} />
          <Metric testId="metric-manifiestos" label="MANIFIESTOS" value={manifests.length} />
        </div>
      )}
    </header>
  );
}
