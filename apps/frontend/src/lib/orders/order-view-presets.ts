/**
 * spec-65 Task 4 — the seven fixed Pedidos tabs, and URL <-> filter-state
 * serialization for them.
 *
 * Spec-65 Decision 2 rules out persisted per-user saved views: the tabs are
 * a fixed set, and "Guardar vista" just copies the current URL. That makes
 * this module — not a `saved_views` table — the entire feature.
 *
 * Preset ids are URL-facing (`?vista=<id>`) and therefore a stable contract:
 * people paste these links to each other. Do not rename one.
 *
 * `sla-en-riesgo`'s filter is deliberately identical to what
 * `get_nav_counts.orders` counts (20260822000004) — the sidebar badge and
 * this tab's result count must never disagree. Do not change one without
 * the other.
 */

import type { OrdersListFilters } from '@/hooks/useOrdersList';

export type OrderViewPresetId =
  | 'sla-en-riesgo'
  | 'todas'
  | 'en-reparto'
  | 'excepciones'
  | 'pendientes-pod'
  | 'reingresos'
  | 'entregadas-hoy';

/** A partial `OrdersListFilters` — only the keys the preset pins are present. */
export type PresetFilters = Partial<OrdersListFilters>;

export interface OrderViewPreset {
  id: OrderViewPresetId;
  label: string;
  /**
   * Constant filters for this preset. For `entregadas-hoy` this is the
   * status-only part — the date range is resolved separately by
   * `resolvePreset`, because "today" cannot be a module-level constant
   * without freezing the clock in tests or letting server and client
   * disagree about the date.
   */
  filters: PresetFilters;
  /** True only for the one preset whose effective filters depend on "today". */
  isDateDependent?: boolean;
}

export const ORDER_VIEW_PRESETS: readonly OrderViewPreset[] = [
  { id: 'sla-en-riesgo', label: 'SLA en riesgo', filters: { sla: ['late', 'at_risk'] } },
  { id: 'todas', label: 'Todas', filters: {} },
  { id: 'en-reparto', label: 'En reparto', filters: { statuses: ['en_ruta'] } },
  {
    id: 'excepciones',
    label: 'Excepciones',
    filters: { statuses: ['cancelado', 'parcialmente_entregado'] },
  },
  {
    id: 'pendientes-pod',
    label: 'Pendientes de POD',
    filters: { statuses: ['entregado'], hasPod: false },
  },
  { id: 'reingresos', label: 'Reingresos', filters: { statuses: ['en_retorno'] } },
  {
    id: 'entregadas-hoy',
    label: 'Entregadas hoy',
    filters: { statuses: ['entregado'] },
    isDateDependent: true,
  },
] as const;

export const DEFAULT_ORDER_VIEW_PRESET_ID: OrderViewPresetId = 'sla-en-riesgo';

const PRESET_IDS = new Set<string>(ORDER_VIEW_PRESETS.map((p) => p.id));

function isPresetId(value: string): value is OrderViewPresetId {
  return PRESET_IDS.has(value);
}

/** An unknown id is a bug in the caller, not something a pasted URL should hit — use `resolvePreset`/`searchParamsToState` for user-facing input. */
export function getPresetById(id: OrderViewPresetId): OrderViewPreset {
  const preset = ORDER_VIEW_PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`Unknown order view preset id: ${id}`);
  }
  return preset;
}

/**
 * Resolves a preset id (possibly untrusted, e.g. from a URL) to a complete
 * filter object, injecting `today` for the one date-dependent preset rather
 * than calling `new Date()` here.
 *
 * Unknown ids fall back to `todas` (no filters) instead of throwing —
 * these strings arrive from user-pasted links.
 */
export function resolvePreset(id: OrderViewPresetId | string, today: string): PresetFilters {
  const preset = isPresetId(id) ? getPresetById(id) : getPresetById('todas');
  if (!preset.isDateDependent) {
    return preset.filters;
  }
  return { ...preset.filters, dateFrom: today, dateTo: today };
}

// ---------------------------------------------------------------------------
// URL serialization
// ---------------------------------------------------------------------------

/** Query keys are short and Spanish, matching the rest of the Pedidos URL vocabulary. */
const PARAM_KEYS = {
  preset: 'vista',
  dateFrom: 'desde',
  dateTo: 'hasta',
  statuses: 'estado',
  sla: 'sla',
  routeIds: 'ruta',
  driver: 'conductor',
  client: 'cliente',
  comunas: 'comuna',
  hasPod: 'pod',
  minAttempts: 'intentos',
  search: 'q',
} as const;

const ARRAY_FILTER_KEYS: ReadonlyArray<keyof OrdersListFilters> = [
  'statuses',
  'sla',
  'routeIds',
  'comunas',
];

/**
 * Serializes `(preset, filters)` to `URLSearchParams`, omitting anything at
 * its default so the URL for the default view with no extra filters is
 * empty, not a wall of null keys.
 */
export function filtersToSearchParams(
  preset: OrderViewPresetId,
  filters: OrdersListFilters,
): URLSearchParams {
  const params = new URLSearchParams();

  if (preset !== DEFAULT_ORDER_VIEW_PRESET_ID) {
    params.set(PARAM_KEYS.preset, preset);
  }

  for (const key of ARRAY_FILTER_KEYS) {
    const value = filters[key] as string[] | null;
    if (value && value.length > 0) {
      params.set(PARAM_KEYS[key], value.join(','));
    }
  }

  if (filters.dateFrom) params.set(PARAM_KEYS.dateFrom, filters.dateFrom);
  if (filters.dateTo) params.set(PARAM_KEYS.dateTo, filters.dateTo);
  if (filters.driver) params.set(PARAM_KEYS.driver, filters.driver);
  if (filters.client) params.set(PARAM_KEYS.client, filters.client);
  if (filters.hasPod !== null && filters.hasPod !== undefined) {
    params.set(PARAM_KEYS.hasPod, String(filters.hasPod));
  }
  if (filters.minAttempts !== null && filters.minAttempts !== undefined) {
    params.set(PARAM_KEYS.minAttempts, String(filters.minAttempts));
  }
  if (filters.search) params.set(PARAM_KEYS.search, filters.search);

  return params;
}

function parseArrayParam(raw: string | null): string[] | null {
  if (!raw) return null;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return values.length > 0 ? values : null;
}

function parseBooleanParam(raw: string | null): boolean | null {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Anything else (including a typo like "maybe") is dropped, not thrown.
  return null;
}

function parseIntParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed;
}

/**
 * Inverse of `filtersToSearchParams`. Never throws: an unknown/malformed
 * preset id falls back to `todas`, and an individual unparseable filter
 * value is dropped while the rest of the state is kept — these strings
 * arrive from user-pasted URLs.
 */
export function searchParamsToState(params: URLSearchParams): {
  preset: OrderViewPresetId;
  filters: OrdersListFilters;
} {
  const rawPreset = params.get(PARAM_KEYS.preset);
  // No `vista` param at all → the default preset (matches the empty-URL
  // encoding filtersToSearchParams produces). A `vista` param present but
  // not a known id → `todas`, per the brief's fallback rule.
  const resolvedPreset: OrderViewPresetId = !rawPreset
    ? DEFAULT_ORDER_VIEW_PRESET_ID
    : isPresetId(rawPreset)
      ? rawPreset
      : 'todas';

  const filters: OrdersListFilters = {
    dateFrom: params.get(PARAM_KEYS.dateFrom) || null,
    dateTo: params.get(PARAM_KEYS.dateTo) || null,
    statuses: parseArrayParam(params.get(PARAM_KEYS.statuses)),
    sla: parseArrayParam(params.get(PARAM_KEYS.sla)),
    routeIds: parseArrayParam(params.get(PARAM_KEYS.routeIds)),
    driver: params.get(PARAM_KEYS.driver) || null,
    client: params.get(PARAM_KEYS.client) || null,
    comunas: parseArrayParam(params.get(PARAM_KEYS.comunas)),
    hasPod: parseBooleanParam(params.get(PARAM_KEYS.hasPod)),
    minAttempts: parseIntParam(params.get(PARAM_KEYS.minAttempts)),
    search: params.get(PARAM_KEYS.search) || null,
  };

  return { preset: resolvedPreset, filters };
}
