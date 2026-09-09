/**
 * M-2, review del PR #712 (mayor) — extraído de `hooks/useOfflineQueue.ts`.
 * Antes, `lib/offline/photos.ts` importaba esta constante desde ese hook —
 * el ÚNICO import de un VALOR `lib → hooks` en todo el frontend de
 * producción, arrastrando un módulo `'use client'` con React a un
 * `lib/offline/*` que fase 1 mantuvo deliberadamente sin DOM y sin React
 * (ver el docstring de `queue.ts`). Vive aquí, en `lib/`, para que tanto
 * `useOfflineQueue.ts` (el suscriptor) como `lib/offline/photos.ts` (uno de
 * los productores, junto a `complete/[loadId]/page.tsx`) lo importen desde
 * el mismo nivel de capa — `hooks/useOfflineQueue.ts` sigue re-exportando
 * este símbolo para que `complete/[loadId]/page.tsx` no tenga que cambiar su
 * import.
 *
 * "Hay trabajo nuevo que intentar ahora, no esperes al próximo backoff" sin
 * fingir que la red volvió — a diferencia de `online` (evento GLOBAL con
 * siete suscriptores reales: React Query, `useSyncQueue`, `scanStore`…),
 * este `CustomEvent` propio tiene exactamente un suscriptor real
 * (`useOfflineQueue`). Ver el docstring completo en `useOfflineQueue.ts`
 * donde se suscribe, para el razonamiento de por qué no reutiliza `online`.
 */
export const PICKUP_QUEUE_WAKE_EVENT = 'aureon:pickup-queue-wake';
