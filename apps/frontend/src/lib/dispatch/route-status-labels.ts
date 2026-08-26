// apps/frontend/src/lib/dispatch/route-status-labels.ts
//
// spec-70 phase 4. Extracted from RouteListTile.tsx so RouteBuilder's header
// badge and RouteListTile's tile badge cannot drift into two different labels
// for the same RouteStatus — the exact class of bug spec-70 phase 1 shipped
// once already (see OPEN_ROUTE_STATUSES's doc comment in types.ts).
import type { BadgeVariant } from '@/components/StatusBadge';
import type { RouteStatus } from './types';

// Exhaustive over RouteStatus by construction: a status added to the enum
// without a chip here is a type error, not a blank badge on the tile.
export const ROUTE_STATUS_CONFIG: Record<RouteStatus, { label: string; variant: BadgeVariant }> = {
  draft:       { label: 'Borrador',    variant: 'neutral' },
  planned:     { label: 'Planificada', variant: 'info' },
  loading:     { label: 'Cargando',    variant: 'info' },
  loaded:      { label: 'Cargada',     variant: 'info' },
  dispatched:  { label: 'Despachada',  variant: 'warning' },
  in_transit:  { label: 'En ruta',     variant: 'warning' },
  in_progress: { label: 'En ruta',     variant: 'warning' },
  completed:   { label: 'Completada',  variant: 'success' },
  cancelled:   { label: 'Cancelada',   variant: 'error' },
};
