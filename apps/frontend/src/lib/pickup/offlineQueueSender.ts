import type { SupabaseClient } from '@supabase/supabase-js';
import type { PickupQueueEntry } from '@/lib/db';
import type { PickupQueueStore } from '@/lib/offline/queue-claims';
import type { OfflineQueueOutcome, OfflineQueueSender } from '@/hooks/useOfflineQueue';
import { classifyCloseManifestError } from '@/lib/pickup/closeManifestErrors';
import { sendManifestPhoto } from '@/lib/offline/photos';

/**
 * B-2, ronda 3 de review del PR #712 (bloqueante) — `useManifestDocuments`
 * (`hooks/pickup/useManifestDocuments.ts`) sólo se invalida en
 * `useUploadManifestDocument.onSuccess`, la ruta ONLINE. La ruta offline no
 * invalida nada: cuando el drenador sube una foto y la marca `sent`, la tira
 * de `ManifestPhotoStrip` sigue mostrando la lista vieja, `nextSheetNumber`
 * vuelve a proponer el mismo número (que `purgeConfirmed` ya borró de la
 * cola local, así que B3 tampoco lo ve venir) y llega un 23505 nuevo — un
 * conductor con un solo teléfono y señal intermitente, más probable que el
 * residual de dos dispositivos. `onManifestPhotoSent` es el gancho que le
 * permite a `AppLayout.tsx` (que sí tiene `useQueryClient()`, un componente
 * React) invalidar `['pickup','manifest-documents', manifestId]` cuando el
 * envío offline tenga éxito — este módulo de `lib/` no puede llamar a
 * React Query directamente (capas: `lib` no depende de `hooks`/React).
 */
export interface PickupQueueSenderOptions {
  onManifestPhotoSent?: (entry: PickupQueueEntry) => void;
}

/**
 * spec-81 fase 2, B2 (ronda 1 de review del PR #679) — el `OfflineQueueSender`
 * real, contra Supabase, que `useOfflineQueue` necesita para dejar de ser un
 * drenador sin nadie que lo llame. Se monta una única vez en `AppLayout`
 * (ver ese fichero) con el cliente Supabase del navegador.
 *
 * Sabe enviar `close_manifest` y, desde spec-81 fase 5, `manifest_photo`
 * (delegado en `sendManifestPhoto`, `lib/offline/photos.ts`) — los dos tipos
 * que algún productor de producción encola hoy (`complete/[loadId]/page.tsx`
 * para el cierre; el escritor de fotos que use `enqueueManifestPhoto` queda
 * fuera de esta fase, ver `photos.ts`). `pickup_scan` no tiene todavía
 * ningún productor (el escritor de escaneos offline queda diferido,
 * coordinación con fase 3 documentada en `useOfflineQueue.ts`); si alguna
 * vez aparece uno antes de que este sender lo sepa enviar, la entrada
 * reintenta con retroceso en vez de tirar el drenador entero.
 */
/**
 * B4, ronda 1 de review del PR #679 — `postgrest-js` no fija ningún timeout
 * propio; sin `abortSignal`, `close_manifest` corre contra el timeout por
 * defecto del `fetch` del navegador (~300s), muy por encima de lo que
 * `RECLAIM_STALE_MS` (`useOfflineQueue.ts`) puede esperar antes de reclamar
 * la entrada como huérfana y reenviarla — el envío duplicado que ese umbral
 * existe para evitar. Imponer el timeout aquí, en el sender, hace que el
 * contrato "RECLAIM_STALE_MS > timeout_http de la petición" se cumpla por
 * construcción, en vez de depender de un valor por defecto de la plataforma
 * que ni está documentado como estable ni este código controla.
 *
 * 60s: más que suficiente para dos firmas base64 (~150 KB) en 2G/EDGE (el
 * escenario de mayor riesgo declarado en el spec), y aun así muy por debajo
 * de `RECLAIM_STALE_MS`.
 */
const CLOSE_MANIFEST_TIMEOUT_MS = 60_000;

/**
 * m8, ronda 2 de review del PR #679 — este es el primer uso de
 * `AbortSignal.timeout` en el navegador (los otros dos del repo,
 * `dt-list-routes.ts`, son server-side). En un WebView sin soporte
 * (Chrome <103 / Safari <16) es `undefined`; llamarlo directamente lanzaría
 * un `TypeError` DENTRO del sender — ese `TypeError`, sin `code` de
 * Postgrest, se clasificaría `offline` y reintentaría para siempre sin que
 * el cierre se enviara jamás, en silencio. Sin soporte, se envía sin
 * imponer el límite propio (el default del `fetch` del navegador sigue
 * aplicando) en vez de lanzar.
 */
function closeManifestTimeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(CLOSE_MANIFEST_TIMEOUT_MS)
    : undefined;
}

export function createPickupQueueSender(
  supabase: SupabaseClient,
  db: PickupQueueStore,
  options: PickupQueueSenderOptions = {},
): OfflineQueueSender {
  return async (entry: PickupQueueEntry): Promise<OfflineQueueOutcome> => {
    // spec-81 fase 5 — `manifest_photo` (blob a subir al bucket `manifests`,
    // ver `lib/offline/photos.ts`) tiene su propio camino de red, distinto
    // del RPC `close_manifest` de abajo.
    if (entry.type === 'manifest_photo') {
      const result = await sendManifestPhoto(supabase, db, entry);
      if (result.outcome === 'sent') {
        options.onManifestPhotoSent?.(entry);
      }
      return result;
    }
    if (entry.type !== 'close_manifest') {
      return {
        outcome: 'retry',
        reason: `no sender implemented for offline queue entry type "${entry.type}"`,
      };
    }
    return sendCloseManifest(supabase, entry);
  };
}

/**
 * Hallazgo del coordinador, 2026-09-08 (revisión del PR #679 tras la ronda
 * 4 de spec-81 fase 2) — `AppLayout.tsx` montaba el sender con
 * `useMemo(() => createPickupQueueSender(createSPAClient()), [])`.
 * `AppLayout` es `"use client"`, pero Next.js ejecuta el cuerpo del
 * componente durante el prerender/SSR, y `useMemo` corre en esa pasada.
 * `createSPAClient()` exige `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` en ese
 * momento — sin ellas (el build de Vercel Preview de este PR no las tenía)
 * lanza `@supabase/ssr: Your project's URL and API key are required`
 * prerenderizando cualquier ruta bajo `AppLayout`, rompiendo el build
 * entero. Medido: `/admin/audit-logs`, pero es cualquier ruta — `AppLayout`
 * es el shell global.
 *
 * Dos exigencias en tensión, no una: `useOfflineQueue` mete `send` en las
 * deps de su efecto (un sender nuevo en cada render de `AppLayout`
 * reiniciaría la cadena de reintentos programados), así que el sender
 * necesita identidad ESTABLE — pero construir el cliente Supabase no puede
 * pasar en tiempo de render. La solución no es elegir entre las dos: es
 * separar "identidad estable" de "cuándo se construye el cliente". Este
 * envoltorio tiene identidad estable desde el primer render (es lo que
 * `useMemo(() => createLazyPickupQueueSender(createSPAClient), [])`
 * memoiza), pero NO llama a `getClient()` hasta el primer envío real — en
 * SSR nunca se envía nada, así que nunca se construye nada.
 */
export function createLazyPickupQueueSender(
  getClient: () => SupabaseClient,
  db: PickupQueueStore,
  options: PickupQueueSenderOptions = {},
): OfflineQueueSender {
  let cached: OfflineQueueSender | null = null;
  return async (entry: PickupQueueEntry): Promise<OfflineQueueOutcome> => {
    if (!cached) {
      cached = createPickupQueueSender(getClient(), db, options);
    }
    return cached(entry);
  };
}

async function sendCloseManifest(
  supabase: SupabaseClient,
  entry: PickupQueueEntry,
): Promise<OfflineQueueOutcome> {
  const payload = entry.payload as {
    manifestId: string;
    signatures: {
      operator_signature: string | null;
      client_signature: string | null;
      client_name: string | null;
    };
  };

  const builder = supabase.rpc('close_manifest', {
    p_manifest_id: payload.manifestId,
    p_signatures: payload.signatures,
  });
  const signal = closeManifestTimeoutSignal();
  const { error } = await (signal ? builder.abortSignal(signal) : builder);

  if (!error) {
    return { outcome: 'sent' };
  }

  const classified = classifyCloseManifestError(error);
  switch (classified.kind) {
    // Costura 1, ronda 4 de review del PR #679 — `offline` deja de colapsar
    // en el mismo `'retry'` que `transient`. El hook (`useOfflineQueue.ts`)
    // aplica `MAX_RETRY_ATTEMPTS` a cualquier `'retry'`; sin esta rama
    // separada, un operario sin señal en el muelle agotaba el techo por
    // pura ausencia de red (~149s medidos, no un rechazo del servidor) y
    // `markDead` bloqueaba el manifiesto entero para siempre —
    // exactamente lo que la promesa "se sube al recuperar señal" (`5f`)
    // dice que no va a pasar. `offline` sigue reintentando con el mismo
    // retroceso exponencial que `transient`; el hook es quien decide no
    // contarlo contra el techo (ver `MAX_RETRY_ATTEMPTS` en
    // `useOfflineQueue.ts`).
    case 'offline':
      return { outcome: 'offline', reason: classified.message };
    case 'transient':
      // B2, ronda 2 de review del PR #679: cualquier cosa que no sea uno
      // de los cuatro rechazos que close_manifest declara explícitamente
      // irrecuperables es reintentable — el valor por defecto seguro para
      // un drenador de fondo es reintentar, no matar el manifiesto.
      return { outcome: 'retry', reason: classified.message };
    case 'idempotent':
      // B1, ronda 2 de review del PR #679: MANIFEST_ALREADY_SIGNED en un
      // reintento significa que el cierre YA se aplicó — es exactamente lo
      // que 'sent' significa por contrato (ver docstring de
      // OfflineQueueSender en useOfflineQueue.ts), no un rechazo.
      return { outcome: 'sent' };
    case 'permanent':
      return { outcome: 'dead', reason: classified.message };
  }
}
