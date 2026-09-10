import { describe, it, expect } from 'vitest';
import {
  pendingLoadsLabel,
  summarizePendingRouteManifests,
  backupPhotosLabel,
} from './manifestCloseSummary';

describe('pendingLoadsLabel', () => {
  it('uses singular noun and verb for exactly 1', () => {
    expect(pendingLoadsLabel(1)).toBe('1 carga pendiente');
  });

  it('uses plural for 0, 2 and above', () => {
    expect(pendingLoadsLabel(0)).toBe('0 cargas pendientes');
    expect(pendingLoadsLabel(2)).toBe('2 cargas pendientes');
    expect(pendingLoadsLabel(3)).toBe('3 cargas pendientes');
  });
});

/**
 * spec-80 fase 5, mock `5i` — "Sigue en PR-2026-0148 · 3 cargas pendientes ·
 * Parque Arauco es la próxima". Pure counting so it can be tested without a
 * DOM or a Supabase client, same reasoning as reviewCloseGate.ts (fase 2).
 */
describe('summarizePendingRouteManifests', () => {
  it('excludes the manifest that was just closed, even if its cached status has not caught up yet', () => {
    // Asymmetric fixture: two manifests both `in_progress`, one of them IS
    // the one just closed. If the function only filtered by status (and not
    // also by id), it would count the just-closed manifest as still
    // pending whenever the route-manifests query is a beat behind
    // close_manifest's write — the exact staleness window this function
    // exists to cover.
    const manifests = [
      { id: 'm-closed', status: 'in_progress', retailer_name: 'Falabella' },
      { id: 'm-other', status: 'in_progress', retailer_name: 'Parque Arauco' },
    ];

    const result = summarizePendingRouteManifests(manifests, 'm-closed');

    expect(result.pendingCount).toBe(1);
    expect(result.nextManifestLabel).toBe('Parque Arauco');
  });

  it('does not count a manifest whose status is completed', () => {
    const manifests = [
      { id: 'm-closed', status: 'in_progress', retailer_name: 'Falabella' },
      { id: 'm-done', status: 'completed', retailer_name: 'Ripley' },
    ];

    const result = summarizePendingRouteManifests(manifests, 'm-closed');

    expect(result.pendingCount).toBe(0);
    expect(result.nextManifestLabel).toBeNull();
  });

  it('picks the first pending manifest in array order as "next" — the list is already ordered oldest-first', () => {
    const manifests = [
      { id: 'm-closed', status: 'completed', retailer_name: 'Falabella' },
      { id: 'm-1', status: 'pending', retailer_name: 'Parque Arauco' },
      { id: 'm-2', status: 'in_progress', retailer_name: 'Costanera Center' },
    ];

    const result = summarizePendingRouteManifests(manifests, 'm-closed');

    expect(result.pendingCount).toBe(2);
    expect(result.nextManifestLabel).toBe('Parque Arauco');
  });

  it('is null-safe when the next manifest has no retailer name yet', () => {
    const manifests = [{ id: 'm-1', status: 'pending', retailer_name: null }];

    const result = summarizePendingRouteManifests(manifests, 'm-closed');

    expect(result.pendingCount).toBe(1);
    expect(result.nextManifestLabel).toBeNull();
  });

  it('returns zero pending and a null label for an empty route', () => {
    const result = summarizePendingRouteManifests([], 'm-closed');

    expect(result.pendingCount).toBe(0);
    expect(result.nextManifestLabel).toBeNull();
  });
});

/**
 * Seguimiento de spec-80 fase 6 (PR #736) — `ManifestClosedSummary` recibía
 * `photosCount: number`, que no puede expresar "no lo sé". Cuando
 * `useManifestDocuments` queda en pausa (`networkMode:'online'`, sin señal
 * o con un error transitorio al montar) `documents` es `undefined`, y
 * `complete/[loadId]/page.tsx` lo convertía en 0 con un `= []` — la MISMA
 * mentira que la ronda 4 ya corrigió en `ManifestPhotoStrip` (su propio
 * "manifest-photo-count"), sólo que en el otro lector del mismo dato.
 *
 * `serverPhotosCount: number | null` — `null` es "no se sabe" (servidor
 * ilegible), nunca 0. `queuedPhotosCount` en cambio SIEMPRE se conoce: sale
 * de IndexedDB, no de la red (`queuedManifestPhotoCount`,
 * `lib/offline/photos.ts`) — por eso no puede colapsar al mismo `null` que
 * el servidor. Con servidor ilegible y algo en cola, la pantalla no puede
 * decir menos de lo que le consta.
 */
describe('backupPhotosLabel', () => {
  it('sums server-confirmed and queued-unconfirmed when the server count is known', () => {
    expect(backupPhotosLabel(3, 2)).toBe('5 fotos');
  });

  it('is honest with zero photos', () => {
    expect(backupPhotosLabel(0, 0)).toBe('0 fotos');
  });

  it('renders a dash — not "0 fotos" — when the server count is unknown and nothing is queued', () => {
    expect(backupPhotosLabel(null, 0)).toBe('—');
  });

  it('still says what it knows when the server is unreadable but the queue is not empty', () => {
    expect(backupPhotosLabel(null, 2)).toBe('2 en cola (resto desconocido)');
  });

  // Ronda 2 de review del PR #743 (menor 5) — mismo criterio de
  // concordancia que `pendingLoadsLabel` ya aplica ("1 carga pendiente",
  // no "1 cargas pendientes").
  it('uses the singular noun for exactly 1 known photo', () => {
    expect(backupPhotosLabel(1, 0)).toBe('1 foto');
  });
});
