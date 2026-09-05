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
});
