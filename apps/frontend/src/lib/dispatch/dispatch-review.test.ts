import { describe, it, expect } from 'vitest';
import { DISPATCH_EFFECTS, NO_VEHICLE_REASON, canDispatch, dispatchErrorCopy } from './dispatch-review';

describe('canDispatch — item 10', () => {
  it('is false with no vehicle identifier', () => {
    expect(canDispatch(null)).toBe(false);
  });

  it('is true with a vehicle identifier', () => {
    expect(canDispatch('RTHK-72')).toBe(true);
  });
});

describe('NO_VEHICLE_REASON — item 10', () => {
  it('names the real reason: DispatchTrack requires the vehicle identifier', () => {
    expect(NO_VEHICLE_REASON).toMatch(/dispatchtrack/i);
    expect(NO_VEHICLE_REASON).toMatch(/cami[oó]n/i);
  });
});

describe('DISPATCH_EFFECTS — item 11', () => {
  it('enumerates exactly the four effects decision 5 names', () => {
    expect(DISPATCH_EFFECTS).toHaveLength(4);
    expect(DISPATCH_EFFECTS.join(' ')).toMatch(/dispatchtrack/i);
    expect(DISPATCH_EFFECTS.join(' ')).toMatch(/en_ruta|en ruta/i);
    expect(DISPATCH_EFFECTS.join(' ')).toMatch(/no se edita/i);
    expect(DISPATCH_EFFECTS.join(' ')).toMatch(/si el env[ií]o falla, nada cambia/i);
  });
});

describe('dispatchErrorCopy — the codes must not flatten (spec-79 review finding 3, decision 6)', () => {
  it('EMPTY_ROUTE is not retryable from here', () => {
    expect(dispatchErrorCopy('EMPTY_ROUTE').retryable).toBe(false);
  });

  it('EMPTY_MANIFEST surfaces the server message (per-stop count) verbatim', () => {
    const info = dispatchErrorCopy('EMPTY_MANIFEST', '2 parada(s) de la ruta no tienen bultos cargados; no se puede despachar.');
    expect(info.text).toBe('2 parada(s) de la ruta no tienen bultos cargados; no se puede despachar.');
    expect(info.retryable).toBe(false);
  });

  it('QUERY_FAILED is retryable — DT was never contacted', () => {
    const info = dispatchErrorCopy('QUERY_FAILED');
    expect(info.retryable).toBe(true);
  });

  it('DT_API_ERROR says nothing was created and is retryable (decision 6, first state)', () => {
    const info = dispatchErrorCopy('DT_API_ERROR');
    expect(info.text).toMatch(/no se cre[oó] nada/i);
    expect(info.retryable).toBe(true);
  });

  it('DT_ACCEPTED_LOCAL_FAILED never offers a plain retry (decision 6, second state)', () => {
    const info = dispatchErrorCopy('DT_ACCEPTED_LOCAL_FAILED');
    expect(info.text).toMatch(/ya recibi[oó] la ruta/i);
    expect(info.retryable).toBe(false);
  });

  it('an unknown/missing code still gets a message, never blank', () => {
    const info = dispatchErrorCopy(null);
    expect(info.text.length).toBeGreaterThan(0);
    expect(info.retryable).toBe(true);
  });

  it('DT_API_ERROR and DT_ACCEPTED_LOCAL_FAILED never collapse to the same text (the flattening this exists to prevent)', () => {
    expect(dispatchErrorCopy('DT_API_ERROR').text).not.toBe(dispatchErrorCopy('DT_ACCEPTED_LOCAL_FAILED').text);
  });

  /**
   * spec-79 H1 (review round 7): DT_OUTCOME_UNKNOWN is the ambiguous throw
   * from route.ts's outer catch (network failure/timeout, unparsable body —
   * anything that is NOT a definite DTRejectedError). It must never say "DT
   * rejected" — that would invite a retry of a dispatch DT may have accepted.
   */
  it('DT_OUTCOME_UNKNOWN never claims DT rejected the dispatch — the outcome is unknown, not a "no"', () => {
    const info = dispatchErrorCopy('DT_OUTCOME_UNKNOWN');
    expect(info.text).not.toMatch(/rechaz/i);
    expect(info.text).not.toMatch(/no se cre[oó] nada/i);
  });

  it('DT_API_ERROR and DT_OUTCOME_UNKNOWN never collapse to the same text', () => {
    expect(dispatchErrorCopy('DT_API_ERROR').text).not.toBe(dispatchErrorCopy('DT_OUTCOME_UNKNOWN').text);
  });

  /**
   * spec-79 round 8 H-2 (surviving mutant): renaming the DT_OUTCOME_UNKNOWN
   * case label (so it falls through to `default`) left every existing test
   * passing — `default` already returns `primaryAction: 'verify'`,
   * `primaryLabel: 'Verificar'`, `showChecklist: false`, and a
   * `whatChanged` containing "No sabemos", identical to the real branch on
   * every field the other tests check. Only `.text` differs between the
   * two, and it was only ever compared against DT_API_ERROR's — also true
   * of `default`. Pinned against the actual copy, and specifically against
   * `default`'s DIFFERENT text ("no llegó respuesta del servidor" — the
   * generic network-failure case, not the DT-round-trip-specific one) so
   * the fallthrough mutation is caught.
   */
  it('DT_OUTCOME_UNKNOWN has its own real copy, not the generic default fallback text', () => {
    const info = dispatchErrorCopy('DT_OUTCOME_UNKNOWN');
    expect(info.text).toBe(
      'No se pudo confirmar si DispatchTrack recibió la ruta. Tocá «Verificar» — vuelve a intentarlo de forma segura, sin duplicar la ruta.',
    );
    expect(info.text).not.toBe(dispatchErrorCopy('UNRECOGNISED_CODE_XYZ').text);
  });

  /**
   * spec-79 M-1 (round 8 mediums). Every surface that renders
   * DT_OUTCOME_UNKNOWN wires its "Verificar" button to `primaryAction ===
   * 'verify'`, which every consumer implements as exactly the same
   * `POST .../dispatch` request `retry`/`complete` send (see
   * DispatchRouteError.tsx, RoutePanel.tsx, DispatchTabletActionBar.tsx —
   * none of them implement a distinct read-only verification call). The
   * copy must never instruct the crew not to press the button whose only
   * implemented behaviour is the exact thing the text forbids.
   */
  it('M-1: does NOT tell the crew not to retry — pressing "Verificar" IS the retry request on every surface that renders it', () => {
    const info = dispatchErrorCopy('DT_OUTCOME_UNKNOWN');
    expect(info.text).not.toMatch(/no reintentes/i);
  });
});

describe('dispatchErrorCopy — item 13, whatChanged names the real route/package state', () => {
  it('DT_API_ERROR: the route stays loaded, packages stay listo_para_despacho', () => {
    const info = dispatchErrorCopy('DT_API_ERROR');
    expect(info.whatChanged).toMatch(/loaded/);
    expect(info.whatChanged).toMatch(/listo_para_despacho/);
  });

  it('QUERY_FAILED: a DB fault before DT was ever contacted — never phrased as a DT rejection', () => {
    const info = dispatchErrorCopy('QUERY_FAILED');
    expect(info.whatChanged).toMatch(/loaded/);
    expect(info.whatChanged).not.toMatch(/rechaz/i);
  });

  it('DT_ACCEPTED_LOCAL_FAILED: what CHANGED (DT has it), never "nada cambió"', () => {
    const info = dispatchErrorCopy('DT_ACCEPTED_LOCAL_FAILED');
    expect(info.whatChanged).toMatch(/dispatchtrack/i);
    expect(info.whatChanged).not.toMatch(/nada cambi/i);
  });
});

describe('dispatchErrorCopy — decision 6, three primary-action states', () => {
  it('DT_API_ERROR: primary action is retry, with the checklist', () => {
    const info = dispatchErrorCopy('DT_API_ERROR');
    expect(info.primaryAction).toBe('retry');
    expect(info.primaryLabel).toMatch(/reintentar/i);
    expect(info.showChecklist).toBe(true);
  });

  it('DT_ACCEPTED_LOCAL_FAILED: primary action is complete, never retry, no checklist', () => {
    const info = dispatchErrorCopy('DT_ACCEPTED_LOCAL_FAILED');
    expect(info.primaryAction).toBe('complete');
    expect(info.primaryLabel).toMatch(/completar/i);
    expect(info.showChecklist).toBe(false);
  });

  it('no response (client network failure, code null) offers verify, degraded retry, no checklist', () => {
    const info = dispatchErrorCopy(null, 'Error de red al despachar — intentá de nuevo');
    expect(info.primaryAction).toBe('verify');
    expect(info.primaryLabel).toMatch(/verificar/i);
    expect(info.showChecklist).toBe(false);
    expect(info.whatChanged).toMatch(/no sabemos/i);
  });

  it('RECONCILIATION_REQUIRED (spec-79 Fase 4 precheck refuse) offers verify, not a plain retry', () => {
    const info = dispatchErrorCopy('RECONCILIATION_REQUIRED');
    expect(info.primaryAction).toBe('verify');
    expect(info.whatChanged).toMatch(/no sabemos/i);
    expect(info.showChecklist).toBe(false);
  });

  it('DT_OUTCOME_UNKNOWN (spec-79 H1, review round 7) offers verify, no checklist, never retry', () => {
    const info = dispatchErrorCopy('DT_OUTCOME_UNKNOWN');
    expect(info.primaryAction).toBe('verify');
    expect(info.showChecklist).toBe(false);
    expect(info.whatChanged).toMatch(/no sabemos/i);
  });

  it('DISPATCH_IN_PROGRESS (spec-79 Fase 4 claim) says wait, never "failed"', () => {
    const info = dispatchErrorCopy('DISPATCH_IN_PROGRESS');
    expect(info.text).not.toMatch(/fall[oó]/i);
    expect(info.whatChanged).toMatch(/en curso/i);
    expect(info.primaryAction).toBe('wait');
  });

  it('a validation refusal (EMPTY_ROUTE) has no primary action and no checklist', () => {
    const info = dispatchErrorCopy('EMPTY_ROUTE');
    expect(info.primaryAction).toBeNull();
    expect(info.showChecklist).toBe(false);
  });
});
