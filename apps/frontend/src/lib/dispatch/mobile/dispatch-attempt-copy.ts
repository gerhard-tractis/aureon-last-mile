// apps/frontend/src/lib/dispatch/mobile/dispatch-attempt-copy.ts
//
// spec-77 Fase 3, item 14 — the endpoint exposes no attempt count (spec's
// own Fase 0, resolved: this is a CLIENT-side detail, not a server-owned
// fact). Tracked in component state (resets on remount — a fresh page load
// is a fresh count, honestly, since there is nothing server-side to read
// it back from), incremented on every failed dispatch call regardless of
// which `DispatchErrorAction` it produced. This module owns only the copy,
// not the counting.

export const ESCALATION_ATTEMPT_THRESHOLD = 3;

/**
 * `null` before the threshold — the caller shows its normal per-code copy.
 * At and after the threshold, this text replaces the primary action's
 * invitation to keep trying alone: three failed attempts is the point
 * where the crew stops guessing and gets a second person involved.
 */
export function attemptEscalationCopy(attempt: number): string | null {
  if (attempt < ESCALATION_ATTEMPT_THRESHOLD) return null;
  return `Van ${attempt} intentos sin éxito. Avisá a tu jefe de turno antes de seguir intentando.`;
}
