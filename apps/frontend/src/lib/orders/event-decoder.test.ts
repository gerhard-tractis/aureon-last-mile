import { describe, it, expect } from 'vitest';
import { decodeEvent } from './event-decoder';
import type { DispatchEventSource } from './event-decoder';

function source(overrides: Partial<DispatchEventSource> = {}): DispatchEventSource {
  return {
    substatus: null,
    substatus_code: null,
    raw_data: {},
    ...overrides,
  };
}

describe('decodeEvent — MOTIVO', () => {
  it('renders substatus verbatim, in Spanish, with no translation', () => {
    const decoded = decodeEvent(source({ substatus: 'Recibido por familiar', substatus_code: '09' }));
    expect(decoded.motivo).toBe('Recibido por familiar');
  });

  it('does not show the code beside a real substatus', () => {
    const decoded = decodeEvent(source({ substatus: 'Recibido por familiar', substatus_code: '09' }));
    expect(decoded.motivoCode).toBeNull();
  });

  it('falls back to "sin motivo informado" plus the code when substatus is null', () => {
    const decoded = decodeEvent(source({ substatus: null, substatus_code: '07' }));
    expect(decoded.motivo).toBe('sin motivo informado');
    expect(decoded.motivoCode).toBe('07');
  });

  it('falls back to "sin motivo informado" when substatus is an empty string, not just null', () => {
    const decoded = decodeEvent(source({ substatus: '', substatus_code: '' }));
    expect(decoded.motivo).toBe('sin motivo informado');
    // substatus_code can ALSO be an empty string, not just null — guard both.
    expect(decoded.motivoCode).toBeNull();
  });

  it('shows no code when both substatus and substatus_code are null', () => {
    const decoded = decodeEvent(source({ substatus: null, substatus_code: null }));
    expect(decoded.motivoCode).toBeNull();
  });
});

describe('decodeEvent — INTENTO', () => {
  it('reports raw_data.attempt when present', () => {
    const decoded = decodeEvent(source({ raw_data: { attempt: 2 } }));
    expect(decoded.intento).toBe('2');
  });

  it('omits the field entirely when attempt is absent — not a dash, not zero', () => {
    const decoded = decodeEvent(source({ raw_data: {} }));
    expect(decoded.intento).toBeNull();
  });
});

describe('decodeEvent — UBICACIÓN', () => {
  it('formats accuracy_m as "a N m de la dirección"', () => {
    const decoded = decodeEvent(source({ raw_data: { accuracy_m: 42 } }));
    expect(decoded.ubicacion).toBe('a 42 m de la dirección');
  });

  it('omits the field entirely when accuracy_m is absent', () => {
    const decoded = decodeEvent(source({ raw_data: {} }));
    expect(decoded.ubicacion).toBeNull();
  });
});

describe('decodeEvent — RESPALDO', () => {
  it('reports photo yes / signature no', () => {
    const decoded = decodeEvent(source({ raw_data: { photo_url: 'https://x/y.jpg', signature: null } }));
    expect(decoded.respaldo).toBe('Foto sí · firma no');
  });

  it('reports photo no / signature yes', () => {
    const decoded = decodeEvent(source({ raw_data: { photo_url: null, signature: 'data:...' } }));
    expect(decoded.respaldo).toBe('Foto no · firma sí');
  });

  it('reports photo no / signature no — the QA-observed default (0 of 751 rows have a photo)', () => {
    const decoded = decodeEvent(source({ raw_data: {} }));
    expect(decoded.respaldo).toBe('Foto no · firma no');
  });
});
