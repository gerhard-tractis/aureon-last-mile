'use client';

import { StatusBadge } from '@/components/StatusBadge';
import type { CrewMember } from '@/hooks/dispatch/useLoadingMonitor';
import { STALL_THRESHOLD_MINUTES } from '@/lib/dispatch/loading-monitor';

interface Props {
  crew: CrewMember[];
  /** Epoch ms, ticked by the parent — same single tick that drives every
   *  LoadingRouteCard's freshness text (rule 8/9). */
  now: number;
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/**
 * EN RITMO / DETENIDA reuses the exact same STALL_THRESHOLD_MINUTES the
 * route cards use for the derived DETENIDA route state (loading-monitor.ts)
 * — one person scanning within the window is "in rhythm" by the same
 * definition that keeps their route out of the stalled bucket; there is no
 * separate per-person threshold to invent.
 */
function isInRhythm(lastScanAtIso: string, now: number): boolean {
  return (now - new Date(lastScanAtIso).getTime()) / 60_000 < STALL_THRESHOLD_MINUTES;
}

/**
 * spec-75 phase 3 — "Cuadrillas activas": one row per distinct
 * `packages.loaded_by` seen across today's open routes (see
 * aggregateCrew in loading-monitor-aggregate.ts). There is no shift/
 * "turno" concept anywhere in the schema (checked: no shift/turno table,
 * and pickup_route_crew is a different domain — inbound pickup trips, not
 * dock loading), so this shows the real scanning identity (name, andén,
 * pace) instead of a fabricated "Turno A/B" label the design's mock uses
 * as illustrative copy.
 */
export function ActiveCrewPanel({ crew, now }: Props) {
  if (crew.length === 0) return null;

  return (
    <div className="rounded-xl border-[1.5px] border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">Cuadrillas activas</h3>
      <ul className="flex flex-col gap-2">
        {crew.map((member) => {
          const inRhythm = isInRhythm(member.lastScanAtIso, now);
          return (
            <li key={member.userId} className="flex items-center gap-3 text-xs">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-raised font-mono text-[11px] font-bold text-text">
                {initials(member.fullName)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-text">{member.fullName}</span>
              {member.loadPositionLabel && (
                <span className="text-text-secondary">{member.loadPositionLabel}</span>
              )}
              <span className="font-mono text-text-secondary">{member.scanCount}</span>
              <StatusBadge
                status={inRhythm ? 'en_ritmo' : 'detenida'}
                label={inRhythm ? 'EN RITMO' : 'DETENIDA'}
                variant={inRhythm ? 'success' : 'error'}
                size="sm"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
