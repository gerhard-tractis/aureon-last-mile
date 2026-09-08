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

  it('classifies a sentinel-prefixed genuinely irrecoverable rejection as permanent — stop and ask for help', () => {
    const result = classifyCloseManifestError({
      message: 'MANIFEST_NOT_CLOSABLE: manifest is not in a closable state (status: pending)',
    });
    expect(result.kind).toBe('permanent');
    expect(result.message).toMatch(/no está listo para cerrarse/i);
  });

  // B2, ronda 2 de review del PR #679: un `code` de Postgrest genuino que no
  // coincide con ninguno de los centinelas irrecuperables de close_manifest
  // no es, por sí solo, motivo para matar el manifiesto para siempre — un
  // drenador de fondo debe reservar `permanent` a lo que la propia función
  // declara irrecuperable, y tratar cualquier otra cosa como reintentable.
  it('classifies an unrecognized Postgrest-shaped error (has a code, no known sentinel) as transient — retry, not dead', () => {
    const result = classifyCloseManifestError({
      message: 'permission denied for table manifests',
      code: '42501',
    });
    expect(result.kind).toBe('transient');
  });

  it('classifies a non-object / message-less error as transient (safe default for a background drainer: retry, do not kill the manifest on something unrecognized)', () => {
    const result = classifyCloseManifestError(null);
    expect(result.kind).toBe('transient');
  });

  it('offline classification carries a distinct message from a permanent one', () => {
    const offline = classifyCloseManifestError(new TypeError('Failed to fetch'));
    const permanent = classifyCloseManifestError({
      message: 'MANIFEST_NOT_CLOSABLE: not closable',
    });
    expect(offline.message).not.toBe(permanent.message);
  });

  // B1, ronda 2 de review del PR #679 (bloqueante): un reintento de un
  // cierre que SÍ se aplicó en el servidor (la respuesta se pierde en un
  // túnel, o el propio AbortSignal.timeout del sender la corta) vuelve a
  // chocar con `signature_operator IS NOT NULL` → 23505
  // MANIFEST_ALREADY_SIGNED. La migración lo llama explícitamente "an
  // idempotent 409" — tratarlo como `permanent`/`dead` convierte un envío
  // que SÍ funcionó en un manifiesto muerto para siempre. Debe ser
  // `idempotent`: la operación ya está aplicada, que es justo lo que
  // `OfflineQueueSender`'s `'sent'` significa por contrato
  // (`useOfflineQueue.ts`).
  it('classifies MANIFEST_ALREADY_SIGNED as idempotent — the close already applied, not a rejection to retry or kill', () => {
    const result = classifyCloseManifestError({
      message: 'MANIFEST_ALREADY_SIGNED: manifest already has an operator signature',
      details: '',
      hint: '',
      code: '23505',
    });
    expect(result.kind).toBe('idempotent');
  });

  it('classifies OPERATOR_SIGNATURE_REQUIRED as permanent', () => {
    const result = classifyCloseManifestError({
      message: 'OPERATOR_SIGNATURE_REQUIRED: operator signature is required',
      code: 'P0001',
    });
    expect(result.kind).toBe('permanent');
  });

  it('classifies cross-tenant MANIFEST_NOT_FOUND (42501) as permanent', () => {
    const result = classifyCloseManifestError({
      message: 'MANIFEST_NOT_FOUND: manifest not found',
      code: '42501',
    });
    expect(result.kind).toBe('permanent');
  });

  it('classifies cross-tenant NO_OPERATOR_IN_JWT (42501) as permanent', () => {
    const result = classifyCloseManifestError({
      message: 'NO_OPERATOR_IN_JWT: no operator in JWT',
      code: '42501',
    });
    expect(result.kind).toBe('permanent');
  });

  // B2, ronda 2 de review — cuatro errores transitorios probados por el
  // reviewer contra el sender real, los cuatro recuperables reintentando,
  // los cuatro mataban el manifiesto para siempre bajo la clasificación
  // anterior (todo lo `business` → `dead`).
  it('classifies an expired-JWT rejection (PGRST301) as transient, not permanent', () => {
    const result = classifyCloseManifestError({ message: 'JWT expired', code: 'PGRST301' });
    expect(result.kind).toBe('transient');
  });

  it('classifies a Kong 502 with no Postgrest code as transient', () => {
    const result = classifyCloseManifestError({
      message: '<html><body><h1>502 Bad Gateway</h1></body></html>',
    });
    expect(result.kind).toBe('transient');
  });

  it('classifies a statement-timeout rejection (57014) as transient', () => {
    const result = classifyCloseManifestError({
      message: 'canceling statement due to statement timeout',
      code: '57014',
    });
    expect(result.kind).toBe('transient');
  });

  it('classifies a deadlock rejection (40P01) as transient', () => {
    const result = classifyCloseManifestError({ message: 'deadlock detected', code: '40P01' });
    expect(result.kind).toBe('transient');
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

  // B4, ronda 1 de review del PR #679: el sender ahora impone su propio
  // `AbortSignal.timeout(...)` sobre `supabase.rpc('close_manifest', …)`
  // (offlineQueueSender.ts) — el mismo catch-y-resuelve de postgrest-js que
  // produce la forma 2 para un fallo de red produce TAMBIÉN esta forma para
  // un abort deliberado: `code: ''`, y el mensaje trae el `name` de una
  // `DOMException` de abort ("AbortError" en runtimes antiguos, "TimeoutError"
  // en los que ya implementan `AbortSignal.timeout` según spec), no las
  // palabras "fetch"/"network"/"load failed". Debe clasificarse offline igual
  // que un fallo de red real — desde la perspectiva del operario ES un fallo
  // de red: el servidor pudo no responder a tiempo por la misma causa (2G en
  // el andén) que produce el `TypeError` directo.
  it('classifies an AbortError-shaped timeout (code: "") as offline', () => {
    const result = classifyCloseManifestError({
      message: 'AbortError: The operation was aborted',
      details: '',
      hint: '',
      code: '',
    });
    expect(result.kind).toBe('offline');
  });

  it('classifies a TimeoutError-shaped timeout (code: "") as offline', () => {
    const result = classifyCloseManifestError({
      message: 'TimeoutError: signal timed out',
      details: '',
      hint: '',
      code: '',
    });
    expect(result.kind).toBe('offline');
  });

  it('treats ANY empty-code Postgrest-shaped error as offline — a real Postgrest code is never empty', () => {
    // A genuine `close_manifest`/RLS/constraint rejection always carries a
    // 5-char SQLSTATE (see the migration's `RAISE EXCEPTION … USING
    // ERRCODE`; Postgres never emits a blank one) — so an empty `code` can
    // only be postgrest-js's own fetch-catch fallback (B1/B4), regardless of
    // what wording the underlying browser/runtime error happens to use.
    // Superseded by the AbortError/TimeoutError cases above the earlier,
    // narrower version of this test asserted the opposite.
    const result = classifyCloseManifestError({
      message: 'something else entirely',
      details: '',
      hint: '',
      code: '',
    });
    expect(result.kind).toBe('offline');
  });

  it('a real Postgrest error with a non-empty code and no recognized sentinel is never offline, and defaults to transient (retry)', () => {
    const result = classifyCloseManifestError({
      message: 'permission denied for table manifests',
      details: '',
      hint: '',
      code: '42501',
    });
    expect(result.kind).not.toBe('offline');
    expect(result.kind).toBe('transient');
  });
});
