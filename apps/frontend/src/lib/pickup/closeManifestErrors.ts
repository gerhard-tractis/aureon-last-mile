/**
 * spec-80 fase 1, fix round 2 (F3). close_manifest raises in English with a
 * sentinel prefix — the repo's own pattern for a Postgres error a client
 * needs to discriminate on (see app/api/dispatch/routes/[id]/blocks/route.ts:
 * `rpcError.code === 'P0002' && message.startsWith('ROUTE_NOT_FOUND')`).
 * complete/[loadId]/page.tsx is the first caller of that RPC to render the
 * raw message directly to an end user rather than mapping it in a Next.js
 * API route first — this is that mapping, done client-side instead.
 *
 * Unrecognized errors — cross-tenant "MANIFEST_NOT_FOUND", "NO_OPERATOR_IN_JWT"
 * (both now sentinel-prefixed too, spec-80 fase 1b, for consistency with the
 * rest of the RPC's errors and with record_discrepancies' equivalent causes)
 * — fall back to a generic message on purpose: those are anomalies the
 * operator cannot act on, not business-flow rejections worth explaining.
 */

const SENTINEL_MESSAGES: Record<string, string> = {
  MANIFEST_ALREADY_SIGNED:
    'Este manifiesto ya fue firmado. Actualiza la pantalla para ver el estado actual.',
  MANIFEST_NOT_CLOSABLE:
    'Este manifiesto no está listo para cerrarse. Verifica su estado en la lista de Recogida.',
  OPERATOR_SIGNATURE_REQUIRED: 'Falta tu firma. Fírmala antes de continuar.',
};

const FALLBACK_MESSAGE = 'No se pudo completar el manifiesto';

export function mapCloseManifestError(err: unknown): string {
  const rawMessage =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : '';

  const sentinel = Object.keys(SENTINEL_MESSAGES).find((prefix) =>
    rawMessage.startsWith(prefix)
  );

  return sentinel ? SENTINEL_MESSAGES[sentinel] : FALLBACK_MESSAGE;
}

/**
 * spec-81 fase 2, checklist item 5 — distingue la rama "sin conexión" del
 * rechazo de negocio irrecuperable. Vino de un hallazgo de la ronda 3 de
 * review de spec-80 fase 1: `mapCloseManifestError` daba **el mismo texto**
 * a un `TypeError: Failed to fetch` y a un `MANIFEST_NOT_CLOSABLE`, y en
 * ambos casos re-habilitaba el mismo botón. Un operario sin señal que
 * reintenta un rechazo de negocio indefinidamente no tiene forma de saber
 * que su caso es distinto — "encolar y seguir" (offline) contra "detente y
 * pide ayuda" (rechazo de negocio) necesitan mensajes y afordancias
 * distintos, no el mismo fallback.
 *
 * `offline`: un fallo de red — `fetch` rechaza con un `TypeError` nativo
 * ("Failed to fetch" en Chrome, "NetworkError..." en Firefox, "Load failed"
 * en Safari), sin `code` de Postgrest y sin ninguno de los prefijos
 * sentinela. El caller debe encolar la operación y dejar seguir al operario
 * — es exactamente el entorno que este spec existe para cubrir.
 *
 * `business`: todo lo demás, incluido lo desconocido. Un rechazo real
 * (sentinela reconocido, un `code` de Postgrest como una denegación RLS, o
 * un error sin forma reconocible) nunca debe tratarse como "reintentable
 * sin más" — el valor por defecto seguro es detenerse, no encolar a ciegas
 * algo que el servidor puede seguir rechazando para siempre.
 */
export interface ClassifiedCloseManifestError {
  kind: 'offline' | 'business';
  message: string;
}

const OFFLINE_MESSAGE =
  'Sin conexión. Tu firma se guardó en el dispositivo y el cierre se enviará solo al volver la señal.';

export function classifyCloseManifestError(err: unknown): ClassifiedCloseManifestError {
  const isPostgrestShaped =
    typeof err === 'object' && err !== null && 'code' in err;
  const rawMessage =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : '';
  const hasSentinel = Object.keys(SENTINEL_MESSAGES).some((prefix) =>
    rawMessage.startsWith(prefix)
  );

  const looksOffline =
    !isPostgrestShaped &&
    !hasSentinel &&
    err instanceof Error &&
    (err instanceof TypeError || /fetch|network/i.test(err.message));

  if (looksOffline) {
    return { kind: 'offline', message: OFFLINE_MESSAGE };
  }

  return { kind: 'business', message: mapCloseManifestError(err) };
}
