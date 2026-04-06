export const STAGE_KEYS = [
  'pickup',
  'reception',
  'consolidation',
  'docks',
  'delivery',
  'returns',
  'reverse',
] as const;

export type StageKey = typeof STAGE_KEYS[number];

export const STAGE_LABELS: Record<StageKey, string> = {
  pickup:        'Recogida',
  reception:     'Recepción',
  consolidation: 'Consolidación',
  docks:         'Andenes',
  delivery:      'Reparto',
  returns:       'Devoluciones',
  reverse:       'Logística Inversa',
};

export const REASON_LABELS: Record<string, string> = {
  no_driver:           'Sin conductor',
  stuck_at_reception:  'Atascado en recepción',
  inactive_route:      'Ruta inactiva',
  unassigned:          'Sin asignar',
  pending_return:      'Devolución pendiente',
  sla_no_config:       'SLA no configurado',
};

export const STATUS_LABELS: Record<string, string> = {
  late:    'Atrasado',
  at_risk: 'En riesgo',
  ok:      'En tiempo',
  none:    '—',
};
