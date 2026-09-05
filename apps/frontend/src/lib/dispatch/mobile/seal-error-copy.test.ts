import { describe, it, expect } from 'vitest';
import { sealErrorCopy } from './seal-error-copy';

// B2 (adversarial review) — `DispatchRouteScanSession`'s direct-close path
// used to discard every seal refusal (`409 UNSEALED_STOPS`, `422
// EMPTY_ROUTE`, `409 ROUTE_NOT_OPEN`, `500`, the offline message) with no
// `else` branch at all. This module is the copy `2i` surfaces for each of
// those instead — mirrors `dispatch-review.ts`'s `dispatchErrorCopy`, which
// deliberately never flattens distinct codes into one sentence.
describe('sealErrorCopy', () => {
  it('trusts the server message when one is sent, for a code with variable detail', () => {
    // UNSEALED_STOPS's message already names the live pending count.
    expect(sealErrorCopy('UNSEALED_STOPS', 'Faltan 24 parada(s) por estibar.').text).toBe(
      'Faltan 24 parada(s) por estibar.',
    );
  });

  it('falls back to fixed copy per code when the server sent none', () => {
    expect(sealErrorCopy('UNSEALED_STOPS', undefined).text).toMatch(/sin estibar/i);
    expect(sealErrorCopy('EMPTY_ROUTE', undefined).text).toMatch(/sin paradas/i);
    expect(sealErrorCopy('ROUTE_NOT_OPEN', undefined).text).toMatch(/no se puede cerrar/i);
    expect(sealErrorCopy('NOT_FOUND', undefined).text).toMatch(/no se encontró/i);
    expect(sealErrorCopy('QUERY_FAILED', undefined).text).toMatch(/no se pudo verificar/i);
    expect(sealErrorCopy('FORCE_REASON_REQUIRED', undefined).text).toMatch(/motivo/i);
  });

  it('an unrecognised or absent code (offline, network failure) still gets real copy', () => {
    expect(sealErrorCopy(null, 'Error al cerrar la ruta — intenta de nuevo').text).toBe(
      'Error al cerrar la ruta — intenta de nuevo',
    );
    expect(sealErrorCopy(null, undefined).text).toMatch(/no se pudo cerrar/i);
    expect(sealErrorCopy('SOMETHING_NEW', undefined).text).toMatch(/no se pudo cerrar/i);
  });

  it('UNSEALED_STOPS is retryable (scan more, then close again); ROUTE_NOT_OPEN is not', () => {
    expect(sealErrorCopy('UNSEALED_STOPS', undefined).retryable).toBe(true);
    expect(sealErrorCopy('ROUTE_NOT_OPEN', undefined).retryable).toBe(false);
    expect(sealErrorCopy('NOT_FOUND', undefined).retryable).toBe(false);
  });
});
