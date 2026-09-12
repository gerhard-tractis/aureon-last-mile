import { EmptyState } from '@/components/EmptyState';
import { CheckCircle2 } from 'lucide-react';

/**
 * spec-96 fase 4 — `4a`'s right-rail "Incidencias de sectorización" panel.
 *
 * Purely presentational: it takes three independently-sourced counts as
 * props and owns no queries, per the phase's own instruction. Each row is a
 * distinct predicate (unrecognised comuna, comuna resolves but no dock
 * covers it, wrong dock scanned) and must never be collapsed into a single
 * total — that is exactly the bug the artboard's round 2 answer closed.
 *
 * `wrongDockCount` is optional and stays `undefined` — never `0` — when its
 * source isn't wired yet, per the phase's ban on a placeholder zero that
 * would misread as "no wrong-dock incidents" rather than "not sourced".
 * When omitted, the row does not render at all.
 *
 * `isLoading` guards the SAME failure by a different route (review fix):
 * every count defaults to 0 while its query resolves, so with no loading
 * state at all this rendered a green "Sin incidencias" for a beat on
 * every load with a real backlog. Only gates the empty-state branch —
 * once real counts are known (`hasIncidents`), a background refetch must
 * not flash a skeleton over rows the floor lead is already reading.
 *
 * `onResolve` (`distribution/page.tsx` wires it to `/settings`) is only
 * correct for row 1: unrecognised comuna is fixed at `/settings`
 * (`UnmatchedComunasPanel`, the alias-mapping UI). Row 2 ("comuna
 * resolves, no andén covers it") is actually acted on from
 * `/app/distribution/pendientes` — a single footer action can't serve
 * both, so this deliberately serves row 1's. Per-row destinations are a
 * later phase's work, declared here rather than silently serving one type.
 *
 * Review fix — row tones now match `4a`: row 1 (unrecognised comuna) is
 * `error` (`:298`), rows 2 and 3 are `warning` (`:305`, `:312`). All
 * three rendered `error` before this fix, an undeclared diff. Not
 * covered by a test — the repo's own rule is that colour is verified by
 * eye against the artboard, not asserted.
 */
interface IncidentRowSpec {
  testId: string;
  title: string;
  description: string;
  count: number;
  tone: 'error' | 'warning';
}

interface SectorizationIncidentsPanelProps {
  unmatchedComunaCount: number;
  noDockCount: number;
  /** Undefined when not sourced — omits the row rather than showing 0. */
  wrongDockCount?: number;
  onResolve: () => void;
  /** True while any of the counts' sources hasn't resolved yet. */
  isLoading?: boolean;
}

export function SectorizationIncidentsPanel({
  unmatchedComunaCount,
  noDockCount,
  wrongDockCount,
  onResolve,
  isLoading = false,
}: SectorizationIncidentsPanelProps) {
  const rows: IncidentRowSpec[] = [
    {
      testId: 'incident-unmatched-comuna',
      title: 'Comuna no reconocida',
      description: 'el texto de comuna no resuelve a ningún registro',
      count: unmatchedComunaCount,
      tone: 'error',
    },
    {
      testId: 'incident-no-dock',
      title: 'Sin andén asignado',
      description: 'la comuna resuelve pero ningún andén la cubre',
      count: noDockCount,
      tone: 'warning',
    },
    ...(wrongDockCount !== undefined
      ? [
          {
            testId: 'incident-wrong-dock',
            title: 'Andén incorrecto',
            description: 'el andén escaneado no es el que calculó el motor',
            count: wrongDockCount,
            tone: 'warning' as const,
          },
        ]
      : []),
  ];

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const hasIncidents = total > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-status-error-border bg-surface">
      <div className="flex flex-none items-center gap-2 border-b border-border px-3.5 py-3">
        <span className="font-heading text-[12.5px] font-semibold text-text">
          Incidencias de sectorización
        </span>
        {total > 0 && (
          <span className="ml-auto rounded bg-status-error-bg px-1.5 py-1 font-mono text-[10.5px] font-semibold leading-none text-status-error-text">
            {total}
          </span>
        )}
      </div>

      {isLoading && !hasIncidents ? (
        <div data-testid="incident-panel-loading" className="flex-1 animate-pulse p-4">
          <div className="h-4 w-2/3 rounded bg-surface-raised" />
        </div>
      ) : !hasIncidents ? (
        <div data-testid="incident-panel-empty" className="flex-1">
          <EmptyState
            icon={CheckCircle2}
            title="Sin incidencias"
            description="No hay comunas sin resolver, andenes sin asignar ni escaneos a un andén incorrecto."
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {rows.map((row) => (
              <div
                key={row.testId}
                data-testid={row.testId}
                className="flex flex-none items-center gap-2.5 border-b border-border-strong/20 px-3.5 py-2.5"
              >
                <span
                  className={
                    'flex h-6.5 w-6.5 flex-none items-center justify-center rounded-md border font-mono text-[10.5px] font-bold ' +
                    (row.tone === 'error'
                      ? 'border-status-error-border bg-status-error-bg text-status-error-text'
                      : 'border-status-warning-border bg-status-warning-bg text-status-warning-text')
                  }
                >
                  {row.count}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11.5px] font-semibold leading-none text-text">
                    {row.title}
                  </span>
                  <span className="text-[10.5px] leading-none text-text-muted">
                    {row.description}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-testid="incident-panel-resolve"
            onClick={onResolve}
            className="flex-none border-t border-border px-3.5 py-3 text-center text-[11.5px] font-semibold text-status-error-text"
          >
            Resolver incidencias
          </button>
        </div>
      )}
    </div>
  );
}
