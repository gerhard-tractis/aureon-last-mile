'use client';

import { useRef, useState } from 'react';
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
  // MEDIUM (adversarial review) — a plain `isSealing` boolean read by the
  // caller is a guard the CALLER can still race: two taps dispatched in the
  // same synchronous handler both read `isSealing === false` before either
  // `setState` call commits (React batches the re-render). This ref is
  // checked and set synchronously inside `seal` itself, so a second call in
  // the same tick is refused here, not merely discouraged by a disabled
  // button upstream — same pattern as `useDispatchRouteToDT`'s own
  // `inFlight` ref (spec-77 Fase 2, item 12).
  const inFlight = useRef(false);

  const seal = async (routeId: string, force?: SealForceInput): Promise<SealOutcome> => {
    if (inFlight.current) {
      return { ok: false, code: null, message: 'Ya se está cerrando' };
    }
    inFlight.current = true;
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
      inFlight.current = false;
      setIsSealing(false);
    }
  };

  return { seal, isSealing };
}
