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

/**
 * Compact duration for the stage-card micro-status. The inputs are raw
 * EXTRACT(EPOCH)/60 floats from the snapshot RPC — never print them as-is
 * ("Ruta inactiva 2969.0869358m"). Scale picks the coarsest readable unit:
 * minutes under an hour, whole hours under two days, then days + hours.
 */
export function formatMinutes(rawMinutes: number): string {
  const min = Math.round(rawMinutes);
  if (min < 60) return `${min}m`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

// ── Stage handlers ────────────────────────────────────────────────────────────

function pickup(items: Item[]): StageHealthResult {
  let maxOverdue = 0;
  for (const item of items) {
    const v = num(item, 'overdue_minutes');
    if (v > maxOverdue) maxOverdue = v;
  }
  if (maxOverdue > 120) return { status: 'crit', delta: `Recogida atrasada ${formatMinutes(maxOverdue)}`, reasonsByOrder: new Map() };
  if (maxOverdue > 30)  return { status: 'warn', delta: `Recogida atrasada ${formatMinutes(maxOverdue)}`, reasonsByOrder: new Map() };
  return { status: 'ok', delta: 'Sin incidencias', reasonsByOrder: new Map() };
}

function reception(items: Item[]): StageHealthResult {
  let maxDwell = 0;
  for (const item of items) {
    const v = num(item, 'dwell_minutes');
    if (v > maxDwell) maxDwell = v;
  }
  if (maxDwell > 360) return { status: 'crit', delta: `${formatMinutes(maxDwell)} en recepción`, reasonsByOrder: new Map() };
  if (maxDwell > 240) return { status: 'warn', delta: `${formatMinutes(maxDwell)} en recepción`, reasonsByOrder: new Map() };
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
  if (maxAge >= 120) return { status: 'warn', delta: `Antigüedad ${formatMinutes(maxAge)}`, reasonsByOrder: new Map() };
  return { status: 'ok', delta: 'Sin incidencias', reasonsByOrder: new Map() };
}

function docks(items: Item[]): StageHealthResult {
  let maxIdle = 0;
  for (const item of items) {
    const v = num(item, 'idle_minutes');
    if (v > maxIdle) maxIdle = v;
  }
  if (maxIdle >= 60) return { status: 'crit', delta: `Ruta inactiva ${formatMinutes(maxIdle)}`, reasonsByOrder: new Map() };
  if (maxIdle >= 30) return { status: 'warn', delta: `Ruta inactiva ${formatMinutes(maxIdle)}`, reasonsByOrder: new Map() };
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
  if (maxNoGps > 30)   return { status: 'crit', delta: `Sin GPS ${formatMinutes(maxNoGps)}`, reasonsByOrder: new Map() };
  if (maxBehind > 60)  return { status: 'warn', delta: `Ruta atrasada ${formatMinutes(maxBehind)}`, reasonsByOrder: new Map() };
  return { status: 'ok', delta: 'Sin incidencias', reasonsByOrder: new Map() };
}

function returns(items: Item[]): StageHealthResult {
  const DEFAULT_SLA_HOURS = 24;
  let worst = 'ok' as HealthStatus;
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
