/**
 * spec-81 fase 2, B2 (ronda 1 de review del PR #679) — sin este módulo
 * montado en algún sitio de producción, `useOfflineQueue` era un drenador
 * que nadie llamaba. Este es el `OfflineQueueSender` real contra Supabase:
 * hoy solo sabe enviar `close_manifest` (el único tipo que algún productor
 * de producción encola — ver `complete/[loadId]/page.tsx`); `pickup_scan`
 * se deja para cuando exista un productor real, sin romper el drenador.
 *
 * B4, misma ronda de review — el sender impone su propio
 * `AbortSignal.timeout(...)` sobre la llamada, en vez de fiarse del timeout
 * por defecto del navegador (~300s, muy por encima de lo que
 * `RECLAIM_STALE_MS` puede esperar sin producir envíos duplicados). Los
 * mocks de `rpc` de aquí en adelante devuelven el builder encadenable real
 * (`.abortSignal(signal)` → promesa), no una promesa directa.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPickupQueueSender } from './offlineQueueSender';
import type { PickupQueueEntry } from '@/lib/db';

function closeManifestEntry(overrides: Partial<PickupQueueEntry> = {}): PickupQueueEntry {
  return {
    id: 1,
    clientOperationId: 'client-op-1',
    operatorId: 'operator-a',
    manifestId: 'manifest-1',
    type: 'close_manifest',
    payload: {
      manifestId: 'manifest-1',
      signatures: {
        operator_signature: 'data:image/png;base64,AAA',
        client_signature: null,
        client_name: null,
      },
    },
    status: 'sending',
    retryCount: 0,
    claimToken: 'token-1',
    lastAttemptAt: null,
    nextAttemptAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Mimics the real postgrest-js chain: `supabase.rpc(...).abortSignal(signal)`
 * — AND `supabase.rpc(...)` awaited directly, no `.abortSignal()` call at
 * all. Real `PostgrestFilterBuilder` is thenable at every step (m8, ronda 2
 * de review del PR #679): the sender falls back to this second shape when
 * `AbortSignal.timeout` is unsupported, instead of imposing its own limit.
 */
function rpcMock(result: { error: unknown; data: unknown }) {
  const abortSignal = vi.fn(async (_signal: AbortSignal) => result);
  const rpc = vi.fn(() => ({
    abortSignal,
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  }));
  return { rpc, abortSignal };
}

describe('createPickupQueueSender — close_manifest', () => {
  it('calls close_manifest with the queued manifest id and signatures, and reports sent on success', async () => {
    const { rpc } = rpcMock({ error: null, data: null });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry());

    expect(rpc).toHaveBeenCalledWith('close_manifest', {
      p_manifest_id: 'manifest-1',
      p_signatures: {
        operator_signature: 'data:image/png;base64,AAA',
        client_signature: null,
        client_name: null,
      },
    });
    expect(result).toEqual({ outcome: 'sent' });
  });

  it('imposes its own AbortSignal.timeout on the rpc call, not the browser default', async () => {
    const { rpc, abortSignal } = rpcMock({ error: null, data: null });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    await send(closeManifestEntry());

    expect(abortSignal).toHaveBeenCalledTimes(1);
    const signal = abortSignal.mock.calls[0][0];
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  // m7, ronda 2 de review del PR #679 — hasta ahora sólo se afirmaba
  // `toBeInstanceOf(AbortSignal)`; ningún test fijaba el valor real
  // (60_000). Precedente: `dt-list-routes.test.ts:360` espía
  // `AbortSignal.timeout` en vez de sólo comprobar el tipo del resultado.
  it('pins the timeout at exactly 60_000ms', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const { rpc } = rpcMock({ error: null, data: null });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    await send(closeManifestEntry());

    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    timeoutSpy.mockRestore();
  });

  // m8, ronda 2 de review del PR #679 — este es el primer uso de
  // `AbortSignal.timeout` en el navegador (los otros dos, `dt-list-routes.ts`,
  // son server-side). En un WebView sin soporte (Chrome <103 / Safari <16)
  // `AbortSignal.timeout` es `undefined`; llamarlo lanzaría un `TypeError`
  // dentro del sender, y ese `TypeError` — sin `code` de Postgrest — se
  // clasificaría `offline` y reintentaría para siempre sin que el cierre se
  // enviara jamás. Detección de característica: sin soporte, se envía sin
  // límite propio en vez de lanzar.
  it('does not throw when AbortSignal.timeout is unsupported (older WebView) — sends without imposing its own limit', async () => {
    const original = AbortSignal.timeout;
    // @ts-expect-error — simulating a runtime without AbortSignal.timeout
    delete AbortSignal.timeout;
    try {
      const { rpc, abortSignal } = rpcMock({ error: null, data: null });
      const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
      const send = createPickupQueueSender(supabase);

      const result = await send(closeManifestEntry());

      expect(result).toEqual({ outcome: 'sent' });
      expect(abortSignal).not.toHaveBeenCalled();
    } finally {
      AbortSignal.timeout = original;
    }
  });

  it('reports retry (not dead) on the postgrest-js network-fallback shape', async () => {
    const { rpc } = rpcMock({
      error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
      data: null,
    });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry());

    expect(result.outcome).toBe('retry');
  });

  it('reports retry (not dead or sent) when its own timeout aborts the request', async () => {
    // What postgrest-js actually resolves with when AbortSignal.timeout()
    // fires — same fetch-catch fallback as a real network failure (B1/B4),
    // just with an Abort/Timeout-named DOMException behind the message.
    const { rpc } = rpcMock({
      error: { message: 'TimeoutError: signal timed out', details: '', hint: '', code: '' },
      data: null,
    });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry());

    expect(result.outcome).toBe('retry');
  });

  it('reports dead on an irrecoverable business rejection (MANIFEST_NOT_CLOSABLE)', async () => {
    const { rpc } = rpcMock({
      error: {
        message: 'MANIFEST_NOT_CLOSABLE: manifest is not in a closable state (status: pending)',
        details: '',
        hint: '',
        code: 'P0001',
      },
      data: null,
    });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry());

    expect(result.outcome).toBe('dead');
  });

  // B1, ronda 2 de review del PR #679 (bloqueante): un reintento de un
  // cierre que SÍ se aplicó — la respuesta se perdió en un túnel, o el
  // propio AbortSignal.timeout del sender la abortó tras el commit — vuelve
  // a chocar contra `signature_operator IS NOT NULL` y produce este 409.
  // La migración lo llama "an idempotent 409"; debe reportarse `sent`, no
  // `dead` — matar el manifiesto aquí convierte un envío exitoso en un
  // conteo permanentemente corto.
  it('reports sent (not dead) when the retry collides with its own prior successful close (MANIFEST_ALREADY_SIGNED)', async () => {
    const { rpc } = rpcMock({
      error: {
        message: 'MANIFEST_ALREADY_SIGNED: manifest already has an operator signature',
        details: '',
        hint: '',
        code: '23505',
      },
      data: null,
    });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry());

    expect(result).toEqual({ outcome: 'sent' });
  });

  // B2, ronda 2 de review del PR #679 (bloqueante): cuatro errores
  // transitorios verificados contra el sender real — los cuatro
  // recuperables reintentando, los cuatro mataban el manifiesto de forma
  // permanente bajo la clasificación "todo lo business es dead".
  it.each([
    ['expired JWT after an offline night', { message: 'JWT expired', code: 'PGRST301' }],
    ['a Kong 502 with no Postgrest code', { message: '<html>...502 Bad Gateway...</html>' }],
    [
      'a statement timeout',
      { message: 'canceling statement due to statement timeout', code: '57014' },
    ],
    ['a deadlock', { message: 'deadlock detected', code: '40P01' }],
  ])('reports retry (not dead) for a transient error: %s', async (_label, errorShape) => {
    const { rpc } = rpcMock({ error: errorShape, data: null });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry());

    expect(result.outcome).toBe('retry');
  });

  it('reports retry for an unrecognized pickup_scan entry instead of throwing (no producer enqueues these yet)', async () => {
    const rpc = vi.fn();
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase);

    const result = await send(closeManifestEntry({ type: 'pickup_scan', payload: { barcode: 'X' } }));

    expect(result.outcome).toBe('retry');
    expect(rpc).not.toHaveBeenCalled();
  });
});
