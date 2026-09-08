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
-- M-4 (ronda 2 de review): la fase 2 (otra rama, PR #679) NO trata todo 409
-- como éxito ya resuelto — el docstring de `OfflineQueueSender` en
-- `useOfflineQueue.ts` (revisión del PR #678, 2026-09-08) dice lo contrario:
-- un sender contra `pickup_scans` que reciba 409 debe releer cuántas filas
-- hay para ese `client_operation_id` antes de devolver `'sent'`, porque un
-- lote de N filas bajo un único `client_operation_id` puede devolver 409 en
-- su PRIMER envío por chocar consigo mismo (ver M-3 abajo), no por ser un
-- reintento — tratar ESE 409 como `'sent'` marcaría resuelto un escaneo que
-- nunca se guardó. El acuerdo entre las dos mitades no es "409 = ya
-- resuelto"; es más estrecho: el servidor SIEMPRE devuelve 409/23505 ante
-- cualquier colisión de la clave (retiro idempotente o auto-colisión de
-- lote — no las distingue, no puede), y es la fase 2 quien decide, releyendo
-- el estado real, si ESE 409 concreto corresponde a una operación ya
-- completa o a un lote que falló a medias. Que el servidor devolviera 200
-- silenciosamente en el duplicado escondería, para cualquier OTRO
-- consumidor de este INSERT que no sea la cola offline (un futuro import,
-- un script de soporte), que dos peticiones distintas de verdad no crearon
-- dos filas — eso es lo que un `INSERT ... ON CONFLICT DO NOTHING` con
-- retorno vacío haría mal: parecería un éxito normal sin decir que no pasó
-- nada. Un 23505 explícito no permite esa ambigüedad; sólo la cola offline,
-- releyendo el estado real, tiene motivo para tratarlo como resuelto.
--
-- Residual (M-4, ronda 2 de review): un 409 causado por un lote INCOMPLETO
-- (M-2 abajo — N-1 filas sobreviven un soft-delete parcial, o cualquier otra
-- causa de que el lote quede corto) hace que un sender correcto (el descrito
-- arriba) nunca vea el conteo esperado y siga devolviendo `'retry'`
-- indefinidamente — `drainManifest` (useOfflineQueue.ts) no tiene transición
-- a `'dead'` por `retryCount`, sólo el sender puede devolver `'dead'`. Sin
-- que el sender implemente ese corte, la entrada queda en bucle con
-- retroceso exponencial topado en 30s, para siempre. No se resuelve en esta
-- fase — es una decisión de la fase 2 (o de una fase futura), documentada
-- aquí y en `docs/specs/spec-81-recogida-cola-offline.md` para que quien
-- escriba el sender real lo tenga presente.
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
-- UNIQUE (operator_id, client_operation_id, package_id) NULLS NOT DISTINCT
-- WHERE client_operation_id IS NOT NULL AND deleted_at IS NULL.
--
-- Ronda 1 de review (B1, bloqueante): la clave original era sólo
-- (operator_id, client_operation_id) — un escaneo por NÚMERO DE PEDIDO
-- (scan-validator.ts's packageIds[]) hace que usePickupScans.ts inserte N
-- filas — una por bulto — en un ÚNICO `.insert(rows)`, y las N comparten el
-- MISMO client_operation_id: fase 1 estampa uno por entrada de cola
-- (lib/offline/queue.ts), no uno por fila física. Con la clave de dos
-- columnas, ese lote colisionaba consigo mismo dentro del propio statement,
-- en el PRIMER intento, no en el reintento — reventaba el flujo que esta
-- migración existe para proteger. package_id en la clave lo arregla: cada
-- fila del lote tiene un package_id distinto, así que las N conviven, y un
-- reintento del MISMO lote (mismas ternas) vuelve a colisionar correctamente
-- fila por fila.
--
-- NULLS NOT DISTINCT es necesario porque package_id es NULL en un escaneo
-- not_found/duplicate (no resolvió a un paquete) — sin el modificador,
-- Postgres trata NULL <> NULL, así que el reintento de ESE escaneo (misma
-- terna operator_id/coid/NULL) no colisionaría con el original y se
-- insertaría una segunda fila en silencio, precisamente el caso que
-- client_operation_id existe para impedir.
--
-- m-5 (ronda 2 de review): NULLS NOT DISTINCT lo soporta PG 15 en adelante.
-- La imagen del harness local (`scripts/pgtap-local.sh`) es 15.8; producción
-- y QA corren PG 17 (`packages/database/supabase/config.toml`'s
-- `major_version = 17`, `infra/supabase-qa/docker-compose.yml`'s
-- `supabase/postgres:17.6.1.136`) — ningún ambiente corre 15.8 salvo el
-- harness de test. Sin impacto funcional aquí (el modificador se comporta
-- igual en 15-17, verificado también contra `postgres:17.10`), pero la
-- única prueba de esta migración corre en un major distinto al de destino —
-- vale decirlo, no restringirse a features de 15/16 por error de lectura de
-- este comentario.
--
-- operator_id en la clave por la regla no negociable del repo — sin él, dos
-- operadores generando por azar el mismo UUID (o dos dispositivos de
-- operadores distintos) colisionarían entre sí, que es un fallo cruzado de
-- tenant, no una idempotencia real. Parcial por dos razones, mismo patrón
-- que spec-85 fase 1 (uniq_open_discrepancy_per_package/_per_barcode,
-- 20260913000001):
--   - client_operation_id IS NOT NULL: las filas existentes (todas, hoy) no
--     tienen valor. Este predicado SÍ es necesario con NULLS NOT DISTINCT
--     activo, a diferencia de la primera versión de esta migración, donde
--     era honesto pero redundante bajo el comportamiento por defecto de
--     Postgres (NULLS DISTINCT): NULLS NOT DISTINCT aplica a TODO el índice,
--     no columna por columna — sin este predicado, cualquier fila futura que
--     omita client_operation_id colisionaría con cualquier otra que también
--     lo omita (y comparta operator_id/package_id), lo cual no es la
--     semántica que se quiere para escrituras fuera de la cola offline.
--   - deleted_at IS NULL: un escaneo es evidencia (spec-85's discrepancies
--     header aplica el mismo principio) — se soft-deletea, no se borra. Sin
--     este predicado, el id de una fila soft-deleteada quedaría bloqueado
--     para siempre y una corrección legítima (borrar el escaneo erróneo y
--     dejar que la cola reintente con el MISMO id, porque fase 1 nunca lo
--     regenera) no podría reinsertarse.
--
--     M-2 (ronda 2 de review): esa frase es correcta SOLO para un escaneo
--     1:1 (una fila, un client_operation_id). El INSERT de un lote (N filas,
--     un client_operation_id, ver decisión de índice abajo) es un único
--     statement atómico: si se soft-deletea SÓLO una de las N filas y la
--     cola reintenta el LOTE ENTERO, el reintento choca contra las N-1 filas
--     que siguen vivas y el INSERT completo se rechaza — la fila borrada
--     NUNCA se reinserta, y el manifiesto queda corto exactamente en el
--     número que el cliente firma. Probado contra la base: lote de 2 filas,
--     soft-delete de 1, reintento del lote completo → 23505 sobre la fila
--     viva restante, 1 fila viva tras el reintento rechazado, no 2. Mitigado
--     hoy (m6, sin cambios en esta fase) porque no hay ningún camino de
--     soft-delete de `pickup_scans` desde el frontend — sólo aplicaría a una
--     corrección manual por SQL de soporte, y esa corrección tendría que
--     borrar las N filas del lote a la vez para no perder un bulto.
--
-- Con este cambio, 23505 en pickup_scans YA NO tiene dos causas
-- indistinguibles PARA UN ESCANEO 1:1 (reintento idempotente vs.
-- auto-colisión de un lote de una sola fila dentro del mismo statement — que
-- no existe cuando N=1): el discriminador limpio que la decisión 2 de arriba
-- asume vale para ese caso.
--
-- M-3 (ronda 2 de review): para N>1, la auto-colisión NO desaparece, se
-- desplaza al carril NULL — un statement que inserte dos o más filas
-- compartiendo el mismo client_operation_id CON package_id IS NULL en TODAS
-- ellas vuelve a colisionar consigo mismo en el primer intento (probado
-- contra la base: 2 filas, mismo client_operation_id, ambas not_found →
-- 23505 en el primer INSERT). Esto NO ocurre hoy a través de
-- usePickupScans.ts: scan-validator.ts sólo produce packageIds con longitud
-- > 1 en la rama de escaneo por número de pedido, cuyos ids vienen todos de
-- packages.id (NOT NULL) — nunca de un resultado not_found/duplicate, que
-- siempre devuelve packageIds: [] — y la rama 1:1 nunca batchea. Es una
-- premisa sobre las FORMAS DE ESCRITURA DE HOY, no una propiedad general del
-- índice; un futuro writer que agrupe varios resultados not_found bajo un
-- único client_operation_id la rompe en silencio. Ver
-- spec81_fase3_pickup_scans_idempotency.test.sql TEST 14 (SQL, general) y
-- scan-validator.test.ts (frontend, congela la premisa de hoy).
--
-- n-8 (ronda 2 de review): la razón real por la que no hace falta
-- CONCURRENTLY no es "esta migración no mezcla DDL con un backfill" —
-- `CREATE UNIQUE INDEX` dentro de `BEGIN` SÍ toma un lock `SHARE` sobre
-- `pickup_scans` y escanea la tabla para construir el índice, bloqueando
-- escrituras (INSERT/UPDATE/DELETE, no SELECT) mientras dura, exactamente
-- lo que CONCURRENTLY existe para evitar. Es seguro sin CONCURRENTLY porque
-- `pickup_scans` no está en la lista de tablas grandes del repo
-- (packages/orders/dispatches/routes, ver scripts/check-migration-safety.mjs)
-- — hoy son pocas filas, así que el escaneo y el lock son breves — no porque
-- no haya backfill. La ausencia de backfill es la razón de por qué no hace
-- falta la regla 2 del script (COUNT(*)-guard), un punto distinto.
--
-- n7 (ronda 1 de review): check-migration-safety.mjs SÍ emite un warning
-- (::warning::, no bloqueante) sobre este archivo — su regla 3, "CREATE
-- UNIQUE INDEX sobre tabla existente sin un COUNT(*) condicional
-- precediéndolo". Es un falso positivo legítimo: el predicado parcial
-- (client_operation_id IS NOT NULL) excluye TODAS las filas existentes de
-- pickup_scans (ninguna tiene esta columna todavía), así que no hace falta
-- el patrón COUNT(*)-guard que esa regla busca — el equivalente al de
-- 20260911000002 (h5c) sería redundante aquí, no protector.
-- =============================================================================

BEGIN;

ALTER TABLE public.pickup_scans
  ADD COLUMN IF NOT EXISTS client_operation_id UUID;

COMMENT ON COLUMN public.pickup_scans.client_operation_id IS
  'spec-81 fase 3. UUID v4 generado por el dispositivo al encolar el escaneo
(fase 1, apps/frontend/src/lib/offline/queue.ts) — UNO por entrada de cola,
compartido por TODAS las filas de un escaneo por número de pedido (N bultos,
un solo INSERT, ver usePickupScans.ts) — y NUNCA regenerado en el reintento.
NULL en cualquier fila anterior a esta migración o escrita por un camino que
no pase por la cola offline. Junto con el índice único parcial de abajo,
sobre (operator_id, client_operation_id, package_id), es lo que hace que un
reintento de la cola tras un 200 perdido reciba 23505 (unique_violation, 409
bajo PostgREST) en vez de duplicar el escaneo y descuadrar el conteo que
close_manifest reporta para 5f/5i.';

-- DROP + CREATE, no ALTER: esta migración no ha mergeado a main todavía
-- (ronda 1 de review, en curso en la misma rama) — el DROP es sólo para que
-- reaplicar este archivo en un entorno local que ya corrió la versión previa
-- dentro de este mismo PR sea idempotente. Ver la decisión 3 arriba para el
-- porqué de cada parte de la clave y del predicado.
DROP INDEX IF EXISTS public.uniq_pickup_scans_client_operation_id;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pickup_scans_client_operation_id
  ON public.pickup_scans (operator_id, client_operation_id, package_id)
  NULLS NOT DISTINCT
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
