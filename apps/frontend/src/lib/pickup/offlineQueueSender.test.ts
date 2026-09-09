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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPickupQueueSender, createLazyPickupQueueSender } from './offlineQueueSender';
import { db } from '@/lib/db';
import type { PickupQueueEntry } from '@/lib/db';

beforeEach(async () => {
  await db.pickup_queue.clear();
});

afterEach(async () => {
  await db.pickup_queue.clear();
});

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
    const send = createPickupQueueSender(supabase, db);

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
    const send = createPickupQueueSender(supabase, db);

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
    const send = createPickupQueueSender(supabase, db);

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
      const send = createPickupQueueSender(supabase, db);

      const result = await send(closeManifestEntry());

      expect(result).toEqual({ outcome: 'sent' });
      expect(abortSignal).not.toHaveBeenCalled();
    } finally {
      AbortSignal.timeout = original;
    }
  });

  // Costura 1, ronda 4 de review del PR #679 — `offline` deja de colapsar en
  // `'retry'`. El hook (`useOfflineQueue.ts`) necesitaba distinguir "el
  // servidor devolvió algo raro" (transient, cuenta para MAX_RETRY_ATTEMPTS)
  // de "el operario está en un sótano" (offline, no debe agotar el techo de
  // reintentos) — el sender ya clasificaba las dos formas por separado
  // (`classifyCloseManifestError`); colapsarlas aquí en el mismo `'retry'`
  // era donde esa información se perdía. Medido por el reviewer: 149s de
  // backoff real (~10 intentos) bastan para que una caída de señal de 3
  // minutos en el muelle mate el manifiesto entero vía `manifestHasDeadEntry`
  // — y ese bloqueo es permanente, sin nada que lo reabra.
  it('reports offline (not retry) on the postgrest-js network-fallback shape', async () => {
    const { rpc } = rpcMock({
      error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
      data: null,
    });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase, db);

    const result = await send(closeManifestEntry());

    expect(result.outcome).toBe('offline');
  });

  it('reports offline (not retry, not dead or sent) when its own timeout aborts the request', async () => {
    // What postgrest-js actually resolves with when AbortSignal.timeout()
    // fires — same fetch-catch fallback as a real network failure (B1/B4),
    // just with an Abort/Timeout-named DOMException behind the message.
    const { rpc } = rpcMock({
      error: { message: 'TimeoutError: signal timed out', details: '', hint: '', code: '' },
      data: null,
    });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase, db);

    const result = await send(closeManifestEntry());

    expect(result.outcome).toBe('offline');
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
    const send = createPickupQueueSender(supabase, db);

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
    const send = createPickupQueueSender(supabase, db);

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
    const send = createPickupQueueSender(supabase, db);

    const result = await send(closeManifestEntry());

    expect(result.outcome).toBe('retry');
  });

  it('reports retry for an unrecognized pickup_scan entry instead of throwing (no producer enqueues these yet)', async () => {
    const rpc = vi.fn();
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createPickupQueueSender(supabase, db);

    const result = await send(closeManifestEntry({ type: 'pickup_scan', payload: { barcode: 'X' } }));

    expect(result.outcome).toBe('retry');
    expect(rpc).not.toHaveBeenCalled();
  });

  // spec-81 fase 5 — el mismo sender ahora despacha `manifest_photo` a
  // `sendManifestPhoto` (`lib/offline/photos.ts`) en vez de caer al
  // `'retry'` genérico de "tipo no reconocido" de arriba. Comportamiento
  // completo de `sendManifestPhoto` (subida, insert, huérfano imposible,
  // idempotencia) cubierto en `lib/offline/photos.test.ts`; aquí sólo se
  // verifica el enrutamiento.
  function manifestPhotoSupabaseStub() {
    const rpc = vi.fn();
    const upload = vi.fn(async () => ({ data: { path: 'x' }, error: null }));
    const insert = vi.fn(async () => ({ data: [{}], error: null }));
    const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const supabase = {
      rpc,
      auth: { getSession },
      storage: { from: vi.fn(() => ({ upload, remove })) },
      from: vi.fn(() => ({ insert })),
    } as unknown as Parameters<typeof createPickupQueueSender>[0];
    return { supabase, rpc, upload, insert, getSession, remove };
  }

  it('dispatches a manifest_photo entry to the storage/insert path instead of close_manifest', async () => {
    const { supabase, rpc, upload } = manifestPhotoSupabaseStub();
    const send = createPickupQueueSender(supabase, db);

    const result = await send(
      closeManifestEntry({
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: new Blob(['x'], { type: 'image/jpeg' }),
      }),
    );

    expect(rpc).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'sent' });
  });

  // B-2, ronda 3 de review del PR #712 (bloqueante) — `AppLayout.tsx` usa
  // este gancho para invalidar `useManifestDocuments` cuando el drenador
  // confirma una foto offline; sin este test, un futuro refactor del
  // enrutamiento podía dejar de llamarlo sin que ningún test lo notara.
  // Renombrado en la ronda 4 (de `onManifestPhotoSent`): `sendManifestPhoto`
  // también lo dispara al renumerar tras una colisión — ver el test de más
  // abajo y `photos.test.ts` para el detalle de esa rama.
  it('calls onManifestDocumentsChanged only when the outcome is sent', async () => {
    const { supabase } = manifestPhotoSupabaseStub();
    const onManifestDocumentsChanged = vi.fn();
    const send = createPickupQueueSender(supabase, db, { onManifestDocumentsChanged });
    const entry = closeManifestEntry({
      type: 'manifest_photo',
      payload: { sheetNumber: 1 },
      blob: new Blob(['x'], { type: 'image/jpeg' }),
    });

    await send(entry);

    expect(onManifestDocumentsChanged).toHaveBeenCalledTimes(1);
    expect(onManifestDocumentsChanged).toHaveBeenCalledWith(entry);
  });

  it('does not call onManifestDocumentsChanged when the manifest_photo send does not succeed', async () => {
    const { supabase } = manifestPhotoSupabaseStub();
    supabase.storage.from = vi.fn(() => ({
      upload: vi.fn(async () => ({ data: null, error: { name: 'StorageApiError', message: 'nope' } })),
      remove: vi.fn(),
    })) as unknown as typeof supabase.storage.from;
    const onManifestDocumentsChanged = vi.fn();
    const send = createPickupQueueSender(supabase, db, { onManifestDocumentsChanged });

    await send(
      closeManifestEntry({
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: new Blob(['x'], { type: 'image/jpeg' }),
      }),
    );

    expect(onManifestDocumentsChanged).not.toHaveBeenCalled();
  });

  it('does not call onManifestDocumentsChanged for a close_manifest send', async () => {
    const { rpc } = rpcMock({ error: null, data: null });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const onManifestDocumentsChanged = vi.fn();
    const send = createPickupQueueSender(supabase, db, { onManifestDocumentsChanged });

    await send(closeManifestEntry());

    expect(onManifestDocumentsChanged).not.toHaveBeenCalled();
  });

  // Menor, ronda 4 de review del PR #712 — un renumerado por colisión
  // (`outcome: 'retry'`) también dispara el gancho, a través del mismo
  // enrutamiento sin inspección de `outcome` que el test de arriba verifica.
  it('calls onManifestDocumentsChanged when a collision is discovered and renumbered', async () => {
    const { supabase, insert } = manifestPhotoSupabaseStub();
    let insertCalls = 0;
    insert.mockImplementation(async () => {
      insertCalls += 1;
      if (insertCalls === 1) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      return { data: [{}], error: null };
    });
    const select = vi.fn(() => {
      let usedOrder = false;
      const chain = {
        eq: vi.fn(() => chain),
        is: vi.fn(() => chain),
        order: vi.fn(() => {
          usedOrder = true;
          return chain;
        }),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () =>
          usedOrder
            ? { data: { sheet_number: 5 }, error: null }
            : { data: { storage_path: 'someone-else/other-manifest/sheet-1-different-client-op.jpg' }, error: null },
        ),
      };
      return chain;
    });
    supabase.from = vi.fn(() => ({ insert, select })) as unknown as typeof supabase.from;
    const onManifestDocumentsChanged = vi.fn();
    const send = createPickupQueueSender(supabase, db, { onManifestDocumentsChanged });

    const result = await send(
      closeManifestEntry({
        id: 1,
        type: 'manifest_photo',
        payload: { sheetNumber: 1 },
        blob: new Blob(['x'], { type: 'image/jpeg' }),
      }),
    );

    expect(result.outcome).toBe('retry');
    expect(onManifestDocumentsChanged).toHaveBeenCalledTimes(1);
  });
});

/**
 * Hallazgo del coordinador, 2026-09-08 (revisión del PR #679 tras la ronda
 * 4) — `AppLayout.tsx` monta el sender con
 * `useMemo(() => createPickupQueueSender(createSPAClient()), [])`.
 * `AppLayout` es `"use client"`, pero Next.js ejecuta el cuerpo del
 * componente durante el prerender/SSR, y `useMemo` corre en esa pasada.
 * `createSPAClient()` exige `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` en ese
 * momento — sin ellas (el entorno de build de Vercel Preview para este PR)
 * lanza `@supabase/ssr: Your project's URL and API key are required`
 * prerenderizando cualquier ruta bajo `AppLayout` (`/admin/audit-logs`,
 * medido), rompiendo el build entero.
 *
 * `createLazyPickupQueueSender` resuelve las dos exigencias en tensión:
 * identidad ESTABLE del sender (`useOfflineQueue` mete `send` en las deps de
 * su efecto — un sender nuevo en cada render reiniciaría la cadena de
 * reintentos programados), pero SIN construir el cliente Supabase en tiempo
 * de render. El cliente se crea perezosamente en el primer envío real y se
 * cachea — en SSR nunca se envía nada, así que nunca se construye.
 */
describe('createLazyPickupQueueSender', () => {
  it('does not call the client factory at construction time', () => {
    const getClient = vi.fn();

    createLazyPickupQueueSender(getClient, db);

    expect(getClient).not.toHaveBeenCalled();
  });

  it('calls the client factory on the first real send, not before', async () => {
    const { rpc } = rpcMock({ error: null, data: null });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const getClient = vi.fn(() => supabase);

    const send = createLazyPickupQueueSender(getClient, db);
    expect(getClient).not.toHaveBeenCalled();

    await send(closeManifestEntry());

    expect(getClient).toHaveBeenCalledTimes(1);
  });

  it('caches the client — a second send does not call the factory again', async () => {
    const { rpc } = rpcMock({ error: null, data: null });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const getClient = vi.fn(() => supabase);

    const send = createLazyPickupQueueSender(getClient, db);
    await send(closeManifestEntry());
    await send(closeManifestEntry());

    expect(getClient).toHaveBeenCalledTimes(1);
  });

  it('delegates to the real sender behavior once the client is built', async () => {
    const { rpc } = rpcMock({
      error: { message: 'MANIFEST_NOT_CLOSABLE: manifest is not in a closable state (status: pending)', details: '', hint: '', code: 'P0001' },
      data: null,
    });
    const supabase = { rpc } as unknown as Parameters<typeof createPickupQueueSender>[0];
    const send = createLazyPickupQueueSender(() => supabase, db);

    const result = await send(closeManifestEntry());

    expect(result.outcome).toBe('dead');
  });
});
