'use client';

import { useState } from 'react';
import type { ForceSealReasonCode } from '@/lib/dispatch/force-seal-reasons';

/**
 * spec-77 Fase 1 (UI) — the client side of `POST /api/dispatch/routes/[id]/seal`,
 * now that it accepts an optional `{force, reason_code, note}` body
 * (decision 9, phase 1). Same one-shot fetch + loading-state shape as
 * `useAssignVehicleAndDriver.ts`/`useSealLoadPosition.ts` — this is a
 * single button press, not a cached read.
 */
export interface SealForceInput {
  force: true;
  reason_code?: ForceSealReasonCode;
  note?: string;
}

export interface SealOutcome {
  ok: boolean;
  code?: string | null;
  message?: string;
  alreadySealed?: boolean;
  sealedStops?: number;
  ordersClosed?: number;
  forced?: { reason_code: string; note?: string; released_count: number; split_count?: number; split_order_ids?: string[] };
}

export function useSealRoute() {
  const [isSealing, setIsSealing] = useState(false);

  const seal = async (routeId: string, force?: SealForceInput): Promise<SealOutcome> => {
    setIsSealing(true);
    try {
      const res = await fetch(`/api/dispatch/routes/${routeId}/seal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(force ?? {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, code: json.code ?? null, message: json.message ?? 'No se pudo cerrar la ruta' };
      }
      if (json.already_sealed) {
        return { ok: true, alreadySealed: true };
      }
      return {
        ok: true,
        sealedStops: json.sealed_stops,
        ordersClosed: json.orders_closed,
        forced: json.forced,
      };
    } catch {
      return { ok: false, code: null, message: 'Error al cerrar la ruta — intenta de nuevo' };
    } finally {
      setIsSealing(false);
    }
  };

  return { seal, isSealing };
}
