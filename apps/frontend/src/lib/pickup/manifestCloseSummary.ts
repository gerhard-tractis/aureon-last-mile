/**
 * spec-80 fase 5 — pure helpers for `5i` ("carga cerrada").
 *
 * Kept out of the page component, same reasoning as reviewCloseGate.ts
 * (fase 2): a route's pending count and "next" manifest is a plain
 * filter/pick over data other hooks already fetch (`useActivePickupRoute`,
 * `useRouteManifests`) — no reason to make it depend on React or Supabase to
 * be testable.
 */

export interface PendingRouteManifest {
  id: string;
  status?: string | null;
  retailer_name: string | null;
}

export interface PendingRouteSummary {
  pendingCount: number;
  /** The retailer of the first manifest still pending — null when there is
   *  none left, or the next one has no retailer_name recorded yet. */
  nextManifestLabel: string | null;
}

/**
 * `closedManifestId` is excluded explicitly, not just by status — a
 * manifest whose `close_manifest` write has not reached this screen's
 * `useRouteManifests` cache yet must not count itself as still pending.
 *
 * Correction: an earlier version of this comment claimed the close
 * "invalidates" that query. It does not — nothing in `complete/[loadId]/
 * page.tsx` calls `queryClient.invalidateQueries` for `['pickup',
 * 'route-manifests', routeId]` on close. This `id !== closedManifestId`
 * filter is the ONLY thing standing between a stale cache and a wrong
 * count; there is no invalidation backing it up. Whoever removes this
 * filter assuming the cache is fresh by the time this renders is wrong —
 * `staleTime: 10_000` on that query means it usually is not.
 *
 * `useRouteManifests` already orders its result oldest-attached-first (see
 * that hook's own comment) — the first manifest left pending in that order
 * is "next" in the same sense `NextManifestCard` already uses on the active
 * route screen.
 */
/**
 * "3 cargas pendientes" / "1 carga pendiente" — same singular/singular-noun
 * concordance rule fase 2 already applied to "Falta 1 paquete" (never
 * "Faltan 1 paquetes"). `n` is never rendered for 0 — the caller omits the
 * whole "Sigue en PR-…" block in that case (an empty route has nothing to
 * "sigue en").
 */
export function pendingLoadsLabel(n: number): string {
  return n === 1 ? '1 carga pendiente' : `${n} cargas pendientes`;
}

/**
 * Seguimiento de spec-80 fase 6 (PR #736) — la fila "Respaldo" de `5i`
 * (`ManifestClosedSummary`) leía `documents.length` con un `= []` de
 * respaldo en `complete/[loadId]/page.tsx`: cuando `useManifestDocuments`
 * queda en pausa (`networkMode:'online'`, el default del repo — un 500 o
 * un RLS transitorio al montar, o simplemente sin señal), `documents` es
 * `undefined` y ese `= []` lo convertía en "0 fotos" — una afirmación falsa
 * sobre la custodia de la prueba, en la pantalla que existe para
 * garantizarla. Mismo defecto que la ronda 4 del PR #736 ya corrigió en
 * `ManifestPhotoStrip` (su propio `manifest-photo-count`); esto es el
 * mismo `undefined`, leído por el OTRO consumidor de la misma query.
 *
 * `serverPhotosCount: number | null` — `null` es "no se sabe", nunca 0.
 * `queuedPhotosCount` no puede colapsar al mismo `null`: sale de
 * IndexedDB (`queuedManifestPhotoCount`, `lib/offline/photos.ts`), no de
 * la red, así que siempre se conoce. Con servidor ilegible pero algo en
 * cola, la pantalla dice lo que sabe en vez de un guion a secas.
 *
 * Ronda 2 de review del PR #743 — dos huecos conocidos, ninguno cerrado
 * aquí:
 * - Este número puede diferir del `manifest-photo-count` de `5f`
 *   (`ManifestPhotoStrip`), que a propósito pinta SÓLO el conteo del
 *   servidor (decisión de la ronda 2 de #736, `ManifestPhotoStrip.tsx`) —
 *   con 3 confirmadas + 2 encoladas, `5f` dice "3" y esto suma "5". Cada
 *   uno correcto para lo que mide; ver spec-80 fase 6 para la nota
 *   completa.
 * - `photos-send.ts` dispara `onManifestDocumentsChanged` justo tras el
 *   `insert` en `manifest_documents`, ANTES de marcar la entrada local
 *   `sent`: si el poll de `queuedManifestPhotoCount` cae ahí, esta suma
 *   cuenta la misma foto dos veces durante ≤2s. Miente por exceso, no por
 *   defecto — se autocorrige en el siguiente tick.
 */
export function backupPhotosLabel(
  serverPhotosCount: number | null,
  queuedPhotosCount: number,
): string {
  if (serverPhotosCount === null) {
    return queuedPhotosCount > 0
      ? `${queuedPhotosCount} en cola (resto desconocido)`
      : '—';
  }
  const total = serverPhotosCount + queuedPhotosCount;
  return total === 1 ? '1 foto' : `${total} fotos`;
}

/**
 * Ronda 2 de review de spec-95 fase 6 (B3, M1, M2) — el aviso de
 * transferencia de custodia de `5f`, extraído de `page.tsx` para que un
 * test unitario pueda variar las cifras (lo único que mata el hardcodeo de
 * un string fijo — un valor quemado en la página pasaba sus propias
 * pruebas porque siempre veían las mismas dos cifras del `beforeEach`).
 *
 * Concordancia singular/plural con el mismo criterio que
 * `pendingLoadsLabel` / `reviewCloseGate.ts` (`missingHeadingLabel`,
 * `closeButtonLabel`): "1 paquete verificado pasa", no "1 paquetes
 * verificado pasan". El mock (`5f`, 39/3) no cubre el singular ni el cero
 * — se deriva de esa convención ya existente en la app, no del mock.
 *
 * `missingCount === 0` omite la segunda frase entera: es el camino feliz
 * (`reviewCloseGate.ts:83`, "pasa directo a 5f" cuando no falta nada), y
 * "0 faltantes quedan a nombre del local hasta que se resuelvan" no dice
 * nada real.
 */
export function custodyNoticeCopy(
  verifiedCount: number,
  missingCount: number,
): string {
  const verifiedNoun =
    verifiedCount === 1 ? 'paquete verificado' : 'paquetes verificados';
  const verifiedVerb = verifiedCount === 1 ? 'pasa' : 'pasan';
  const verifiedSentence = `Al firmar, ${verifiedCount} ${verifiedNoun} ${verifiedVerb} a custodia de Aureon.`;

  if (missingCount === 0) return verifiedSentence;

  const missingNoun = missingCount === 1 ? 'faltante' : 'faltantes';
  const missingVerb = missingCount === 1 ? 'queda' : 'quedan';
  const missingReflexive = missingCount === 1 ? 'se resuelva' : 'se resuelvan';
  const missingSentence = `${missingCount} ${missingNoun} ${missingVerb} a nombre del local hasta que ${missingReflexive}.`;

  return `${verifiedSentence} ${missingSentence}`;
}

/**
 * spec-95 fase 7, mock `5f2` — la hoja de confirmación irreversible entre
 * `5f` y `5i`. Mismas dos mitades que `custodyNoticeCopy` (verificados que
 * pasan a custodia de Aureon, faltantes que quedan registrados), pero la
 * frase del mock es OTRA: una sola oración de cuenta seguida siempre de
 * "Esta acción es irreversible." — esa cola no depende de si hay faltantes,
 * a diferencia de la segunda oración de `custodyNoticeCopy`, que se omite
 * entera. No se reutiliza `custodyNoticeCopy` tal cual porque el texto no
 * coincide (5f dice "quedan a nombre del local hasta que se resuelvan"; 5f2
 * dice "quedan registrados como faltantes") — mismas cifras, copy distinto
 * del mock, con el mismo criterio de concordancia ya establecido en este
 * fichero (M1/M2 de `custodyNoticeCopy`).
 */
export function custodyConfirmationCopy(
  verifiedCount: number,
  missingCount: number,
): string {
  const verifiedNoun = verifiedCount === 1 ? 'paquete' : 'paquetes';
  const verifiedVerb = verifiedCount === 1 ? 'pasa' : 'pasan';
  const base = `${verifiedCount} ${verifiedNoun} ${verifiedVerb} a custodia de Aureon`;

  if (missingCount === 0) return `${base}. Esta acción es irreversible.`;

  const missingVerb = missingCount === 1 ? 'queda' : 'quedan';
  const missingAdj = missingCount === 1 ? 'registrado' : 'registrados';
  const missingNoun = missingCount === 1 ? 'faltante' : 'faltantes';

  return `${base} y ${missingCount} ${missingVerb} ${missingAdj} como ${missingNoun}. Esta acción es irreversible.`;
}

export function summarizePendingRouteManifests(
  manifests: PendingRouteManifest[],
  closedManifestId: string,
): PendingRouteSummary {
  const pending = manifests.filter(
    (m) => m.id !== closedManifestId && m.status !== 'completed',
  );
  return {
    pendingCount: pending.length,
    nextManifestLabel: pending[0]?.retailer_name ?? null,
  };
}
