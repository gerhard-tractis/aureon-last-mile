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
 * `offline`: un fallo de red. Hay DOS formas posibles, y hasta la ronda 1 de
 * review del PR #679 esta función solo reconocía una:
 *
 * 1. Un `TypeError` nativo lanzado directamente por `fetch()` — pasa por
 *    aquí cuando el caller no usa `supabase.rpc()` (o usa
 *    `{ shouldThrowOnError: true }`, que sí re-lanza).
 * 2. La forma que `supabase.rpc('close_manifest', …)` produce DE VERDAD:
 *    `postgrest-js@1.21.4` (`PostgrestBuilder.ts:218-229`) **captura** el
 *    rechazo de `fetch` y RESUELVE (nunca rechaza) con un objeto plano
 *    `{ message: "TypeError: Failed to fetch", details: stack, hint: '',
 *    code: '' }`. `complete/[loadId]/page.tsx:127` hace `if (error) throw
 *    error` sobre ESE objeto — así que lo que este módulo recibe en el
 *    99% de los casos reales es la forma 2, con forma de error de
 *    Postgrest (tiene `code`) pero `code` VACÍO, nunca un `TypeError`
 *    real. Tratar "tiene `code`" como sinónimo de "es un rechazo de
 *    negocio" (la implementación original) clasificaba esta forma como
 *    `business` siempre — cero cobertura real de la rama offline.
 *
 * Un `code` de Postgrest genuino (RLS, constraint, el propio
 * `close_manifest` con `RAISE EXCEPTION … USING ERRCODE`) SIEMPRE es un
 * SQLSTATE de 5 caracteres, nunca la cadena vacía — así que `code === ''`
 * combinado con un mensaje con forma de fallo de fetch es una señal segura
 * de la forma 2, no un rechazo de negocio disfrazado.
 *
 * `business`: todo lo demás, incluido lo desconocido. Un rechazo real
 * (sentinela reconocido, un `code` de Postgrest no vacío, o un error sin
 * forma reconocible) nunca debe tratarse como "reintentable sin más" — el
 * valor por defecto seguro es detenerse, no encolar a ciegas algo que el
 * servidor puede seguir rechazando para siempre.
 */
export interface ClassifiedCloseManifestError {
  kind: 'offline' | 'business';
  message: string;
}

const OFFLINE_MESSAGE =
  'Sin conexión. Tu firma se guardó en el dispositivo y el cierre se enviará solo al volver la señal.';

const FETCH_FAILURE_PATTERN = /fetch|network|load failed/i;

export function classifyCloseManifestError(err: unknown): ClassifiedCloseManifestError {
  const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null;
  const code = errObj && 'code' in errObj ? String(errObj.code) : undefined;
  const rawMessage = errObj && 'message' in errObj ? String(errObj.message) : '';
  const hasSentinel = Object.keys(SENTINEL_MESSAGES).some((prefix) =>
    rawMessage.startsWith(prefix)
  );

  const isRealPostgrestError = code !== undefined && code !== '';

  // Forma 2: postgrest-js's fetch-catch fallback. Empty `code` + a message
  // that looks like a fetch rejection (never true for a real Postgres error,
  // whose `code` is always a 5-char SQLSTATE).
  const looksLikeNetworkFallbackShape =
    code === '' && !hasSentinel && FETCH_FAILURE_PATTERN.test(rawMessage);

  // Forma 1: a native TypeError thrown directly (no Postgrest shape at all).
  const looksLikeNativeFetchThrow =
    !isRealPostgrestError &&
    !hasSentinel &&
    err instanceof Error &&
    (err instanceof TypeError || FETCH_FAILURE_PATTERN.test(err.message));

  if (looksLikeNetworkFallbackShape || looksLikeNativeFetchThrow) {
    return { kind: 'offline', message: OFFLINE_MESSAGE };
  }

  return { kind: 'business', message: mapCloseManifestError(err) };
}
