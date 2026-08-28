'use client';

import { useState } from 'react';

/**
 * spec-71 phase 4 — the client side of `POST /api/dispatch/load-positions/seal`.
 * One scan/tap; the endpoint resolves the position and reuses spec-70's
 * route-level seal, so this hook is only the fetch + loading state, the
 * same shape `RouteBuilder`'s own `handleClose` already uses for the
 * route-level seal.
 */
export interface SealLoadPositionOutcome {
  ok: boolean;
  message?: string;
  positionCode?: string;
  alreadySealed?: boolean;
  sealedStops?: number;
}

export function useSealLoadPosition() {
  const [isSealing, setIsSealing] = useState(false);

  const sealPosition = async (positionCode: string): Promise<SealLoadPositionOutcome> => {
    setIsSealing(true);
    try {
      const res = await fetch('/api/dispatch/load-positions/seal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionCode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, message: json.message ?? 'No se pudo sellar la posición' };
      }
      return {
        ok: true,
        positionCode: json.position_code,
        alreadySealed: json.already_sealed === true,
        sealedStops: json.sealed_stops,
      };
    } catch {
      return { ok: false, message: 'Error al sellar — intenta de nuevo' };
    } finally {
      setIsSealing(false);
    }
  };

  return { sealPosition, isSealing };
}
