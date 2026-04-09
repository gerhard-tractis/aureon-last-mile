/**
 * Spanish UI copy for the Aureon dashboard.
 * All strings are in es-CL Spanish. No English copy.
 * Pure const exports — no logic, no I/O.
 */

// ---------------------------------------------------------------------------
// Chapter titles and annotations
// ---------------------------------------------------------------------------
export const CHAPTER_LABELS = {
  cpo: 'CPO',
  otif: 'OTIF',
  nps: 'NPS / CSAT',
  cpoAnnotation: 'CAPÍTULO 01',
  otifAnnotation: 'CAPÍTULO 02',
  npsAnnotation: 'CAPÍTULO 03',
} as const;

// ---------------------------------------------------------------------------
// North Star KPI labels (used in the top strip)
// ---------------------------------------------------------------------------
export const NORTH_STAR_LABELS = {
  orders: 'Órdenes',
  otif: 'OTIF',
  cpo: 'CPO',
  nps: 'NPS · CSAT',
} as const;

// ---------------------------------------------------------------------------
// Tactical metrics labels (used in chapter cards)
// ---------------------------------------------------------------------------
export const TACTICAL_LABELS = {
  fadr: 'FADR — Tasa de entrega al primer intento',
  avgKmPerRoute: 'Promedio km por ruta',
  gas: 'Combustible consumido',
  costPerKm: 'Costo por km',
  driversActive: 'Conductores activos',
  routesCompleted: 'Rutas completadas',
  avgStopsPerRoute: 'Paradas promedio por ruta',
  lateDeliveries: 'Entregas tardías',
  failedDeliveries: 'Entregas fallidas',
  onTimeRate: 'Tasa de puntualidad',
  inFullRate: 'Tasa de completitud',
} as const;

// ---------------------------------------------------------------------------
// Drill dimension labels
// ---------------------------------------------------------------------------
export const DRILL_LABELS = {
  late_reasons: 'Motivos de atraso',
  region: 'Región',
  customer: 'Cliente',
  driver: 'Conductor',
  time_of_day: 'Franja horaria',
  vehicle_type: 'Tipo de vehículo',
  route: 'Ruta',
} as const;

// ---------------------------------------------------------------------------
// Period preset labels (used in the period selector)
// ---------------------------------------------------------------------------
export const PERIOD_PRESET_LABELS = {
  month: 'Mes',
  quarter: 'Trimestre',
  ytd: 'YTD',
  custom: 'Personalizado',
} as const;

// ---------------------------------------------------------------------------
// Placeholder copy — shown when a metric is not yet available
// ---------------------------------------------------------------------------
export const PLACEHOLDER_COPY = {
  cpo: 'Para mostrar el CPO real se requiere configurar el modelo de costos de tu operación.',
  nps: 'Activa la recopilación de feedback de clientes para ver tu NPS y CSAT aquí.',
  gas: 'Conecta el registro de combustible para ver el consumo y costo por km de tu flota.',
} as const;
