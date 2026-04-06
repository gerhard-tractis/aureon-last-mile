export type HealthStatus = 'ok' | 'warn' | 'crit' | 'neutral';

export interface StageHealthResult {
  status: HealthStatus;
  /** Human-readable Spanish micro-status line */
  delta: string;
  /** Maps order/item id to a reason key string */
  reasonsByOrder: Map<string, string>;
}

type Item = Record<string, unknown>;

function num(item: Item, key: string): number {
  return (item[key] as number) ?? 0;
}

function bool(item: Item, key: string): boolean {
  return !!(item[key]);
}

// ── Stage handlers ────────────────────────────────────────────────────────────

function pickup(items: Item[]): StageHealthResult {
  let maxOverdue = 0;
  for (const item of items) {
    const v = num(item, 'overdue_minutes');
    if (v > maxOverdue) maxOverdue = v;
  }
  if (maxOverdue > 120) return { status: 'crit', delta: `Recogida atrasada ${maxOverdue}m`, reasonsByOrder: new Map() };
  if (maxOverdue > 30)  return { status: 'warn', delta: `Recogida atrasada ${maxOverdue}m`, reasonsByOrder: new Map() };
  return { status: 'ok', delta: 'Sin incidencias', reasonsByOrder: new Map() };
}

function reception(items: Item[]): StageHealthResult {
  let maxDwell = 0;
  for (const item of items) {
    const v = num(item, 'dwell_minutes');
    if (v > maxDwell) maxDwell = v;
  }
  if (maxDwell > 360) return { status: 'crit', delta: `${Math.round(maxDwell / 60)}h en recepción`, reasonsByOrder: new Map() };
  if (maxDwell > 240) return { status: 'warn', delta: `${Math.round(maxDwell / 60)}h en recepción`, reasonsByOrder: new Map() };
  return { status: 'ok', delta: 'Sin incidencias', reasonsByOrder: new Map() };
}

function consolidation(items: Item[]): StageHealthResult {
  let maxAge = 0;
  for (const item of items) {
    if (bool(item, 'missed_dock_window')) {
      return { status: 'crit', delta: 'Ventana de muelle perdida', reasonsByOrder: new Map() };
    }
    const v = num(item, 'age_minutes');
    if (v > maxAge) maxAge = v;
  }
  if (maxAge >= 120) return { status: 'warn', delta: `Antigüedad ${Math.round(maxAge / 60)}h`, reasonsByOrder: new Map() };
  return { status: 'ok', delta: 'Sin incidencias', reasonsByOrder: new Map() };
}

function docks(items: Item[]): StageHealthResult {
  let maxIdle = 0;
  for (const item of items) {
    const v = num(item, 'idle_minutes');
    if (v > maxIdle) maxIdle = v;
  }
  if (maxIdle >= 60) return { status: 'crit', delta: `Ruta inactiva ${maxIdle}m`, reasonsByOrder: new Map() };
  if (maxIdle >= 30) return { status: 'warn', delta: `Ruta inactiva ${maxIdle}m`, reasonsByOrder: new Map() };
  return { status: 'ok', delta: 'Sin incidencias', reasonsByOrder: new Map() };
}

function delivery(items: Item[]): StageHealthResult {
  let maxBehind = 0;
  let maxNoGps = 0;
  for (const item of items) {
    const behind = num(item, 'behind_plan_minutes');
    const noGps  = num(item, 'no_gps_minutes');
    if (behind > maxBehind) maxBehind = behind;
    if (noGps  > maxNoGps)  maxNoGps  = noGps;
  }
  if (maxNoGps > 30)   return { status: 'crit', delta: `Sin GPS ${maxNoGps}m`, reasonsByOrder: new Map() };
  if (maxBehind > 60)  return { status: 'warn', delta: `Ruta atrasada ${maxBehind}m`, reasonsByOrder: new Map() };
  return { status: 'ok', delta: 'Sin incidencias', reasonsByOrder: new Map() };
}

function returns(items: Item[]): StageHealthResult {
  const DEFAULT_SLA_HOURS = 24;
  let worst: HealthStatus = 'ok';
  let worstDelta = 'Sin incidencias';

  for (const item of items) {
    const ageMin  = num(item, 'age_minutes');
    const slaHrs  = (item['sla_hours'] as number | undefined) ?? DEFAULT_SLA_HOURS;
    const slaMins = slaHrs * 60;
    const pct     = ageMin / slaMins;

    if (pct > 1) {
      worst      = 'crit';
      worstDelta = `Devolución SLA vencido`;
      break; // crit is the highest — exit early
    }
    if (pct >= 0.8 && worst !== 'crit') {
      worst      = 'warn';
      worstDelta = `Devolución al ${Math.round(pct * 100)}% del SLA`;
    }
  }

  return { status: worst, delta: worstDelta, reasonsByOrder: new Map() };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function computeStageHealth(
  stageKey: string,
  items: Item[],
  _now: Date,
): StageHealthResult {
  switch (stageKey) {
    case 'pickup':        return pickup(items);
    case 'reception':     return reception(items);
    case 'consolidation': return consolidation(items);
    case 'docks':         return docks(items);
    case 'delivery':      return delivery(items);
    case 'returns':       return returns(items);
    case 'reverse':
    default:
      return { status: 'neutral', delta: '—', reasonsByOrder: new Map() };
  }
}
