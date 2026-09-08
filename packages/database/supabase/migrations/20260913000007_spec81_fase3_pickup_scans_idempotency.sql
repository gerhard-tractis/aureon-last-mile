-- =============================================================================
-- spec-81 fase 3 — Idempotencia en el servidor para la cola offline de
-- Recogida.
-- =============================================================================
-- Fase 1 (frontend, en apps/frontend/src/lib/offline/queue.ts, rama
-- distinta) da a cada entrada encolada un client_operation_id (UUID v4)
-- generado al encolar y NUNCA regenerado en el reintento. Fase 2 (el
-- drenador) reenvía esa entrada si el 200 se perdió. Sin una clave estable
-- en el servidor, ese reintento duplica el escaneo y descuadra el conteo
-- que 5f pone delante del cliente para firmar. Esta migración cierra esa
-- mitad — el servidor.
--
-- ── Decisión 1: qué tablas llevan la columna ────────────────────────────────
--
-- SÓLO public.pickup_scans. Las otras dos candidatas ya tienen su propia
-- idempotencia, por una llave de negocio distinta a client_operation_id, y
-- añadir la columna ahí sería un segundo mecanismo duplicando al primero:
--
--   - public.manifests (close_manifest, spec-80): un manifiesto se firma
--     UNA vez en toda su vida — esa es la llave, no un id de operación.
--     close_manifest (20260913000004) ya rechaza un segundo cierre con
--     `signature_operator IS NOT NULL` -> 23505 MANIFEST_ALREADY_SIGNED.
--     Reintentar close_manifest(manifest_id, signatures) tras un 200
--     perdido cae en la MISMA rama sin importar si el reintento lleva el
--     mismo client_operation_id o uno nuevo — el id de operación no
--     distingue nada que manifest_id + "¿ya firmado?" no distinga ya. Ver
--     spec81_fase3_close_manifest_idempotency.test.sql, que prueba esto
--     DESDE FUERA sin tocar la función.
--   - public.discrepancies (spec-85): record_discrepancies ya es
--     idempotente por los dos índices únicos parciales de fase 1
--     (uniq_open_discrepancy_per_package, uniq_open_discrepancy_per_barcode,
--     20260913000001) + ON CONFLICT DO NOTHING — y el comentario de esos
--     índices ya cita a spec-81 por nombre como el motivo. Añadir
--     client_operation_id aquí sería un tercer mecanismo sobre una llave
--     que YA existe y ya se probó (spec85_discrepancies_rpcs.test.sql).
--
-- pickup_scans es distinta: se escribe con un INSERT directo del cliente
-- (usePickupScans.ts, RLS ALL sin RPC de por medio, a diferencia de
-- close_manifest/record_discrepancies), y NO tiene ninguna llave de negocio
-- natural — un rescan legítimo del mismo barcode en el mismo manifiesto es
-- una fila nueva a propósito (scan_result 'duplicate'/'not_found' repetido,
-- ver 20260913000004's comentario H3). Sin client_operation_id no hay forma
-- de distinguir "el operario escaneó otra vez" de "la cola reintentó el
-- mismo escaneo".
--
-- ── Decisión 2: qué hace el servidor ante un duplicado ──────────────────────
--
-- Error 23505 (unique_violation), NO éxito silencioso, y NO P0002. Mismo
-- idioma que close_manifest y record_discrepancies ya usan para "esto ya
-- pasó" (spec-80/spec-85, ambos migrados de P0002 tras dos bloqueos de
-- review esta semana): P0002 es no_data_found, PostgREST lo mapea a 404, y
-- la cola offline (fase 2) leería un 404 como "el ítem no existe" y lo
-- descartaría en vez de resolverlo — justo el bug que esta migración existe
-- para no reintroducir.
--
-- La fase 2 (frontend, checklist propio) decide tratar un 409 idempotente
-- como éxito ya resuelto — "un 409 idempotente SÍ la marca resuelta". Esto
-- no contradice que el servidor devuelva un error: el contrato queda más
-- claro exactamente así, con las dos mitades de acuerdo en el CÓDIGO
-- (23505/409) y en desacuerdo a propósito en la INTERPRETACIÓN (el servidor
-- lo cuenta como conflicto porque la fila ya existe; el cliente lo cuenta
-- como éxito porque su intención ya se cumplió). Que el servidor devolviera
-- 200 silenciosamente en el duplicado escondería, para cualquier OTRO
-- consumidor de este INSERT que no sea la cola offline (un futuro import,
-- un script de soporte), que dos peticiones distintas de verdad no crearon
-- dos filas — eso es lo que un `INSERT ... ON CONFLICT DO NOTHING` con
-- retorno vacío haría mal: parecería un éxito normal sin decir que no pasó
-- nada. Un 23505 explícito no permite esa ambigüedad; sólo la cola offline,
-- que YA sabe que está reintentando, tiene motivo para tratarlo como
-- resuelto.
--
-- pickup_scans no pasa por una RPC, así que este 23505 no lleva un prefijo
-- centinela en el mensaje (RAISE EXCEPTION '...' USING ERRCODE) — es el
-- unique_violation crudo de Postgres sobre una restricción de tabla. Eso es
-- SUFICIENTE aquí: el ÚNICO discriminador que la cola offline necesita es
-- el ERRCODE 23505 en sí (mapeado a 409), no un mensaje que distinguir de
-- otras causas — a diferencia de close_manifest, que comparte 42501 entre
-- tres causas distintas y por eso SÍ necesita el prefijo para que el
-- frontend las separe.
--
-- ── Decisión 3: el índice único parcial ──────────────────────────────────────
--
-- UNIQUE (operator_id, client_operation_id) WHERE client_operation_id IS
-- NOT NULL AND deleted_at IS NULL. operator_id en la clave por la regla no
-- negociable del repo — sin él, dos operadores generando por azar el mismo
-- UUID (o dos dispositivos de operadores distintos) colisionarían entre sí,
-- que es un fallo cruzado de tenant, no una idempotencia real. Parcial por
-- dos razones, mismo patrón que spec-85 fase 1
-- (uniq_open_discrepancy_per_package/_per_barcode, 20260913000001):
--   - client_operation_id IS NOT NULL: las filas existentes (todas, hoy) no
--     tienen valor — sin el predicado, todas esas NULL colisionarían entre
--     sí bajo NULLS NOT DISTINCT o, sin ese modificador (comportamiento por
--     defecto de Postgres, el que se usa aquí), simplemente el índice
--     dejaría pasar cualquier cantidad de NULL sin más — el predicado deja
--     explícito que NULL nunca participa, en vez de depender del
--     comportamiento por defecto de un lector que no lo sepa.
--   - deleted_at IS NULL: un escaneo es evidencia (spec-85's discrepancies
--     header aplica el mismo principio) — se soft-deletea, no se borra. Sin
--     este predicado, el id de una fila soft-deleteada quedaría bloqueado
--     para siempre y una corrección legítima (borrar el escaneo erróneo y
--     dejar que la cola reintente con el MISMO id, porque fase 1 nunca lo
--     regenera) no podría reinsertarse.
--
-- Sin CONCURRENTLY: pickup_scans no está en la lista de tablas grandes del
-- repo (packages/orders/dispatches/routes, ver
-- scripts/check-migration-safety.mjs) y esta migración no mezcla DDL con un
-- backfill — no hace falta rellenar client_operation_id en filas
-- existentes: son NULL, y el predicado parcial de arriba ya las excluye del
-- índice sin tocarlas.
-- =============================================================================

BEGIN;

ALTER TABLE public.pickup_scans
  ADD COLUMN IF NOT EXISTS client_operation_id UUID;

COMMENT ON COLUMN public.pickup_scans.client_operation_id IS
  'spec-81 fase 3. UUID v4 generado por el dispositivo al encolar el escaneo
(fase 1, apps/frontend/src/lib/offline/queue.ts) y NUNCA regenerado en el
reintento. NULL en cualquier fila anterior a esta migración o escrita por un
camino que no pase por la cola offline. Junto con el índice único parcial de
abajo es lo que hace que un reintento de la cola tras un 200 perdido reciba
23505 (unique_violation, 409 bajo PostgREST) en vez de duplicar el escaneo
y descuadrar el conteo que close_manifest reporta para 5f/5i.';

-- Ver la decisión 3 arriba para el porqué de cada parte del predicado.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pickup_scans_client_operation_id
  ON public.pickup_scans (operator_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'pickup_scans'
       AND column_name = 'client_operation_id'
  ) THEN
    RAISE EXCEPTION 'pickup_scans.client_operation_id was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'pickup_scans'
       AND indexname = 'uniq_pickup_scans_client_operation_id'
  ) THEN
    RAISE EXCEPTION 'uniq_pickup_scans_client_operation_id index was not created';
  END IF;

  RAISE NOTICE '✓ spec-81 fase 3 pickup_scans idempotency migration complete';
END $$;

COMMIT;
