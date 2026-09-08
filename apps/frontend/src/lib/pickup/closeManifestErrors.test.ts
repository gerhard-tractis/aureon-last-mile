import { describe, it, expect } from 'vitest';
import { mapCloseManifestError, classifyCloseManifestError } from './closeManifestErrors';

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

describe('classifyCloseManifestError (spec-81 fase 2 — checklist item 5)', () => {
  // The failure mode this exists for: a fetch() with no signal rejects
  // with a native TypeError, not a Postgrest error object. Chrome says
  // "Failed to fetch", Firefox "NetworkError when attempting to fetch
  // resource.", Safari "Load failed" — none carry a sentinel prefix or a
  // Postgrest `code`.
  it('classifies a TypeError with no sentinel and no Postgrest code as offline — queue and continue', () => {
    const result = classifyCloseManifestError(new TypeError('Failed to fetch'));
    expect(result.kind).toBe('offline');
    expect(result.message).toMatch(/sin conexión|sin señal/i);
  });

  it('classifies a sentinel-prefixed business rejection as business — stop and ask for help', () => {
    const result = classifyCloseManifestError({
      message: 'MANIFEST_NOT_CLOSABLE: manifest is not in a closable state (status: pending)',
    });
    expect(result.kind).toBe('business');
    expect(result.message).toMatch(/no está listo para cerrarse/i);
  });

  it('classifies an unrecognized Postgrest-shaped error (has a code) as business, not offline', () => {
    // A real anomaly (RLS denial, constraint violation) still isn't the
    // network — retrying without connectivity context would be wrong.
    const result = classifyCloseManifestError({
      message: 'permission denied for table manifests',
      code: '42501',
    });
    expect(result.kind).toBe('business');
  });

  it('classifies a non-object / message-less error as business (safe default: stop, do not silently queue)', () => {
    const result = classifyCloseManifestError(null);
    expect(result.kind).toBe('business');
  });

  it('offline classification carries a distinct message from every business one', () => {
    const offline = classifyCloseManifestError(new TypeError('Failed to fetch'));
    const business = classifyCloseManifestError({
      message: 'MANIFEST_NOT_CLOSABLE: not closable',
    });
    expect(offline.message).not.toBe(business.message);
  });

  // B1, review round 1 of PR #679: this is the shape supabase.rpc() ACTUALLY
  // resolves with when there's no connectivity — postgrest-js@1.21.4
  // (PostgrestBuilder.ts:218-229) catches the fetch rejection and resolves
  // (never rejects) with a plain object carrying an EMPTY `code`, not a raw
  // TypeError. `complete/[loadId]/page.tsx:127` does `if (error) throw error`
  // on that plain object, so this — not `new TypeError(...)` — is the form
  // classifyCloseManifestError must recognize.
  it('classifies the real postgrest-js network-fallback shape (code: "") as offline, not business', () => {
    const result = classifyCloseManifestError({
      message: 'TypeError: Failed to fetch',
      details: 'TypeError: Failed to fetch\n    at fetch (...)',
      hint: '',
      code: '',
    });
    expect(result.kind).toBe('offline');
  });

  it('classifies a Firefox-shaped network-fallback message (code: "") as offline', () => {
    const result = classifyCloseManifestError({
      message: 'TypeError: NetworkError when attempting to fetch resource.',
      details: '',
      hint: '',
      code: '',
    });
    expect(result.kind).toBe('offline');
  });

  it('classifies a Safari-shaped network-fallback message (code: "") as offline', () => {
    const result = classifyCloseManifestError({
      message: 'TypeError: Load failed',
      details: '',
      hint: '',
      code: '',
    });
    expect(result.kind).toBe('offline');
  });

  it('does not classify an empty-code error with no fetch/network wording as offline', () => {
    // Guards against widening the empty-code branch into a catch-all: an
    // empty `code` alone isn't sufficient, the message must still look like
    // the fetch-rejection shape.
    const result = classifyCloseManifestError({
      message: 'something else entirely',
      details: '',
      hint: '',
      code: '',
    });
    expect(result.kind).toBe('business');
  });
});
