// apps/frontend/src/lib/dispatch/loading-monitor-labels.ts
//
// spec-75 phase 3. The En carga monitor's four card labels are its own
// vocabulary, distinct from ROUTE_STATUS_CONFIG (route-status-labels.ts):
// that map speaks the STORED enum ("Cargando", "Cargada") for badges
// elsewhere in the app; this one speaks the DESIGN's four derived states
// (LoadState from loading-monitor.ts), including `stalled`, which has no
// stored status at all. Kept separate on purpose — folding them into one
// map would make ROUTE_STATUS_CONFIG's badge text drift to match this
// screen's copy, or vice versa, the same class of drift
// ROUTE_STATUS_CONFIG's own header comment warns about.
import type { BadgeVariant } from '@/components/StatusBadge';
import type { LoadState } from './loading-monitor';

export const LOAD_STATE_LABEL: Record<LoadState, { label: string; variant: BadgeVariant }> = {
  stalled: { label: 'DETENIDA', variant: 'error' },
  loading: { label: 'EN CARGA', variant: 'info' },
  ready:   { label: 'LISTA PARA DESPACHO', variant: 'success' },
  draft:   { label: 'BORRADOR', variant: 'neutral' },
};
