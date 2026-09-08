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
