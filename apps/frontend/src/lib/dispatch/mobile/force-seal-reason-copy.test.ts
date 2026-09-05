import { describe, it, expect } from 'vitest';
import { FORCE_SEAL_REASON_CODES } from '@/lib/dispatch/force-seal-reasons';
import { FORCE_SEAL_REASON_LABELS, requiresNote } from './force-seal-reason-copy';

describe('FORCE_SEAL_REASON_LABELS', () => {
  it('has a Spanish label for every code in the real vocabulary', () => {
    for (const code of FORCE_SEAL_REASON_CODES) {
      expect(FORCE_SEAL_REASON_LABELS[code]).toBeTruthy();
    }
  });

  it('offers exactly the vocabulary the server accepts — no invented reason', () => {
    expect(Object.keys(FORCE_SEAL_REASON_LABELS).sort()).toEqual([...FORCE_SEAL_REASON_CODES].sort());
  });
});

describe('requiresNote', () => {
  it('only "otro" requires a note, per the server (400 without one)', () => {
    expect(requiresNote('otro')).toBe(true);
    expect(requiresNote('paquete_no_ubicado')).toBe(false);
    expect(requiresNote('turno_terminado')).toBe(false);
    expect(requiresNote('vehiculo_lleno')).toBe(false);
    expect(requiresNote('paquete_dañado_en_anden')).toBe(false);
  });
});
