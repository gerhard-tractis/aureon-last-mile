import { describe, it, expect } from 'vitest';
import { mapCloseManifestError } from './closeManifestErrors';

describe('mapCloseManifestError', () => {
  it('maps MANIFEST_ALREADY_SIGNED to Spanish', () => {
    const message = mapCloseManifestError({
      message: 'MANIFEST_ALREADY_SIGNED: manifest already has an operator signature',
    });
    expect(message).not.toContain('MANIFEST_ALREADY_SIGNED');
    expect(message).toMatch(/ya fue firmado/i);
  });

  it('maps MANIFEST_NOT_CLOSABLE to Spanish', () => {
    const message = mapCloseManifestError({
      message: 'MANIFEST_NOT_CLOSABLE: manifest is not in a closable state (status: pending)',
    });
    expect(message).not.toContain('MANIFEST_NOT_CLOSABLE');
    expect(message).toMatch(/no está listo para cerrarse/i);
  });

  it('maps OPERATOR_SIGNATURE_REQUIRED to Spanish', () => {
    const message = mapCloseManifestError({
      message: 'OPERATOR_SIGNATURE_REQUIRED: operator signature is required',
    });
    expect(message).not.toContain('OPERATOR_SIGNATURE_REQUIRED');
    expect(message).toMatch(/falta tu firma/i);
  });

  it('falls back to a generic Spanish message for an unrecognized error', () => {
    expect(mapCloseManifestError({ message: 'manifest not found' })).toBe(
      'No se pudo completar el manifiesto'
    );
  });

  it('falls back to a generic Spanish message for MANIFEST_NOT_FOUND (spec-80 fase 1b: now carries a sentinel prefix, but is still an anomaly the operator cannot act on, not a business-flow rejection worth explaining)', () => {
    expect(mapCloseManifestError({ message: 'MANIFEST_NOT_FOUND: manifest not found' })).toBe(
      'No se pudo completar el manifiesto'
    );
  });

  it('falls back to a generic Spanish message for NO_OPERATOR_IN_JWT (spec-80 fase 1b: now carries a sentinel prefix, same anomaly-not-business-rejection reasoning)', () => {
    expect(mapCloseManifestError({ message: 'NO_OPERATOR_IN_JWT: no operator in JWT' })).toBe(
      'No se pudo completar el manifiesto'
    );
  });

  it('falls back for a non-object / message-less error', () => {
    expect(mapCloseManifestError(null)).toBe('No se pudo completar el manifiesto');
    expect(mapCloseManifestError('boom')).toBe('No se pudo completar el manifiesto');
  });
});
