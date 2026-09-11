-- =============================================================================
-- spec-86 fase 3 — get_discrepancies_ops_control: la vista de Discrepancias
-- en Ops Control
-- =============================================================================
-- Fase 1 (20260920000001) hizo que complete_route_reception abriera una fila
-- por paquete faltante en public.discrepancies (operation_type='reception');
-- spec-80 fase 2 (20260916000001) hace lo mismo para close_manifest
-- (operation_type='pickup'). get_discrepancies (spec-85 fase 2,
-- 20260913000003) ya lee esa tabla, pero devuelve las columnas crudas de
-- discrepancies — sin orden, sin paquete, sin carga, sin ruta, sin quién
-- cerró. Ops Control necesita esas cinco cosas en una fila (ver spec-86,
-- fase 3, y docs/specs/spec-86-discrepancias-de-recepcion.md "Criterios de
-- aceptación" #3), así que esta función las adjunta con LEFT JOINs en vez de
-- forzar al frontend a hacer N llamadas por fila.
--
-- Plantilla de firma y ACL: get_discrepancies (20260913000003) — SQL STABLE,
-- SECURITY INVOKER (no DEFINER: discrepancies y todas las tablas que se unen
-- aquí ya tienen RLS + GRANT SELECT a authenticated, así que una consulta
-- plana ya queda correctamente acotada por tenant sola). El filtro explícito
-- por operator_id en CADA join de abajo es defensa en profundidad, no lo
-- único que separa esta consulta de otro tenant — mismo comentario que
-- get_discrepancies.
--
-- "Carga" y "ruta" no se derivan igual para las dos operaciones, porque
-- discrepancies no las guarda igual (spec-85, discrepancy_source_matches_operation):
--   - pickup:    manifest_id vive EN LA FILA. carga = manifests.external_load_id,
--                ruta = pickup_routes.code vía manifests.pickup_route_id.
--   - reception: route_reception_id vive en la fila, pero NINGÚN manifest --
--                una route_reception consolida varias cargas. La carga se
--                deriva del pickup_scan 'verified' del propio paquete, en el
--                MISMO pickup_route que esta reception (no cualquier scan
--                histórico del paquete): es exactamente el conjunto contra el
--                que complete_route_reception decide "falta" (fase 1,
--                20260920000001). La ruta sale directo de
--                route_receptions.pickup_route_id -- no necesita ese join.
--
-- El hueco conocido (spec-86 fase 1, "El hueco... route_receptions.
-- expected_count y get_route_reception_snapshot no filtran borrados, y fase 1
-- sí"): esta vista NO expone expected_count/received_count de route_receptions
-- a propósito. Son un número que puede no cuadrar con las filas reales de
-- discrepancies (el snapshot ya está declarado desincronizado en QA). Mostrar
-- ambos aquí invitaría a comparar "el cierre dijo N, discrepancias dice M" en
-- la MISMA pantalla -- esta vista sólo enseña lo que discrepancies sabe con
-- certeza, fila por paquete, no un recuento agregado que puede contradecirla.
--
-- Ronda 2 de review (#715), B1 -- p_status='open' significa "status <>
-- 'resolved'", NO una igualdad literal. 20260917000002 (spec-83,
-- get_completed_manifests) ya tomó y documentó esta decisión de producto el
-- 2026-09-08: "Filtering on `= 'open'` instead ... would have made the panel
-- go GREEN the moment an ops manager marks a real loss as 'lost' -- the
-- worst possible outcome painted as a clean close." 'lost' es el disparador
-- de indemnización (spec-85), no un cierre limpio -- sigue siendo una acción
-- pendiente para Ops hasta que exista el flujo de indemnización, así que la
-- cola de "abiertas" de este RPC lo incluye. p_status='resolved' o
-- p_status='lost' siguen siendo igualdad literal -- sólo 'open' se reinterpreta,
-- porque es el único valor que el frontend usa para pedir "la cola de lo que
-- falta actuar" en vez de un estado exacto.
--
-- Ronda 2 (#715), B3/menores -- ps.deleted_at IS NULL y u.deleted_at IS NULL
-- añadidos (soft-deletes es no-negociable en toda consulta nueva, y el hueco
-- de fase 1 en el primero no se hereda aquí sin más). LATERAL gana ORDER BY +
-- LIMIT 1 determinista (scan verificado más reciente primero, desempatado por
-- id) -- nada en el esquema impide dos scans 'verified' del mismo paquete en
-- la misma ruta, y sin desempate la fila devuelta dependía del plan. La
-- COALESCE(pm, rm) se reemplaza por un CASE explícito sobre operation_type:
-- pm y rm nunca son ambos no-NULL a la vez (discrepancy_source_matches_operation
-- ya lo garantiza), así que el orden de la COALESCE era un mutante
-- estructuralmente imposible de matar con un test -- el CASE lo hace
-- imposible de confundir en vez de imposible de probar.
--
-- Ronda 3 (#715), M3 -- LIMIT 500 sin visibilidad era "una fecha, no un
-- límite": con la cola creciendo monótona (nada saca una discrepancia de
-- 'open' a escala hoy -- fase 2a `[pending]`, spec-85 fase 3b `[parked]`,
-- resolve_discrepancy es fila a fila), lo que se caía con ORDER BY
-- detected_at DESC eran justo las más VIEJAS -- las que "Abierta hace" existe
-- para destacar. total_count = COUNT(*) OVER() se computa ANTES del LIMIT
-- (Postgres aplica funciones de ventana antes de LIMIT/OFFSET en su pipeline
-- de ejecución), así que refleja el total real aunque LIMIT 500 trunque las
-- filas devueltas. El frontend compara total_count contra el número de filas
-- recibidas para decidir si avisa "500 de 617".
--
-- Ronda 3, menor -- por qué `<> 'resolved'` y no una lista explícita de
-- estados: cualquier valor NUEVO que el enum discrepancy_status_enum llegue
-- a tener (hoy sólo open/resolved/lost, spec-85) cae del lado permisivo --
-- se sigue mostrando en la cola de acción pendiente en vez de desaparecer en
-- silencio. Es la misma elección que 20260917000002:10 ya hizo para
-- get_completed_manifests, por la misma razón: una cola de acción que se
-- equivoca mostrando de más es más segura que una que se equivoca ocultando.
--
-- Ronda 3, menor -- los buckets de p_status se solapan a propósito, no por
-- descuido: p_status='open' (open+lost) y p_status='lost' (sólo lost) NO son
-- disjuntos -- una fila 'lost' aparece en los dos. Sumar sus conteos cuenta
-- esa fila dos veces. Quien construya la vista de histórico que este
-- comentario prometía (arriba) necesita saberlo antes de sumar buckets.
-- =============================================================================

BEGIN;

-- Ronda 3 (#715, M3) added total_count to the RETURNS TABLE -- a return-type
-- change, which CREATE OR REPLACE rejects outright ("cannot change return
-- type of existing function... Use DROP FUNCTION first"). Same pattern as
-- 20260920000001 (spec-86 fase 1) for complete_route_reception's parameter
-- change. This migration is not yet on main as of this edit (still on this
-- PR's branch), so DROP + CREATE here replaces the function within its own
-- migration rather than adding a second one.
DROP FUNCTION IF EXISTS public.get_discrepancies_ops_control(public.discrepancy_status_enum);

CREATE OR REPLACE FUNCTION public.get_discrepancies_ops_control(
  p_status public.discrepancy_status_enum DEFAULT 'open'
) RETURNS TABLE (
  id             UUID,
  kind           public.discrepancy_kind_enum,
  operation_type public.discrepancy_operation_enum,
  status         public.discrepancy_status_enum,
  detected_at    TIMESTAMPTZ,
  note           TEXT,
  order_number   VARCHAR,
  package_label  VARCHAR,
  carga          TEXT,
  ruta           TEXT,
  closed_by_name VARCHAR,
  -- Ronda 3 (#715, M3): total de filas que matchean el filtro ANTES del
  -- LIMIT 500 de abajo -- igual en cada fila devuelta (misma window), así el
  -- frontend no necesita una segunda llamada para saber si lo que ve es todo.
  total_count    BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT
    d.id,
    d.kind,
    d.operation_type,
    d.status,
    d.detected_at,
    d.note,
    o.order_number,
    p.label AS package_label,
    CASE d.operation_type
      WHEN 'pickup'    THEN pm.external_load_id
      WHEN 'reception' THEN rm.external_load_id
    END AS carga,
    CASE d.operation_type
      WHEN 'pickup'    THEN prp.code
      WHEN 'reception' THEN prr.code
    END AS ruta,
    u.full_name AS closed_by_name,
    COUNT(*) OVER() AS total_count
  FROM public.discrepancies d
  LEFT JOIN public.packages p
    ON p.id = d.package_id AND p.operator_id = public.get_operator_id()
  LEFT JOIN public.orders o
    ON o.id = p.order_id AND o.operator_id = public.get_operator_id()
  -- pickup: manifest_id ya está en la fila.
  LEFT JOIN public.manifests pm
    ON pm.id = d.manifest_id AND pm.operator_id = public.get_operator_id()
  LEFT JOIN public.pickup_routes prp
    ON prp.id = pm.pickup_route_id AND prp.operator_id = public.get_operator_id()
  -- reception: la ruta sale directo de route_reception_id; la carga se
  -- deriva abajo vía LATERAL.
  LEFT JOIN public.route_receptions rr
    ON rr.id = d.route_reception_id AND rr.operator_id = public.get_operator_id()
  LEFT JOIN public.pickup_routes prr
    ON prr.id = rr.pickup_route_id AND prr.operator_id = public.get_operator_id()
  LEFT JOIN LATERAL (
    SELECT m.external_load_id
      FROM public.pickup_scans ps
      JOIN public.manifests m
        ON m.id = ps.manifest_id AND m.operator_id = public.get_operator_id()
     WHERE ps.operator_id = public.get_operator_id()
       AND ps.deleted_at IS NULL
       AND ps.package_id = d.package_id
       AND ps.scan_result = 'verified'
       AND m.pickup_route_id = rr.pickup_route_id
     -- Desempate determinista: nada en el esquema impide dos scans
     -- 'verified' del mismo paquete en la misma ruta (un rescaneo). El más
     -- reciente gana; scanned_at empatado se rompe por id para que el
     -- resultado no dependa del plan.
     ORDER BY ps.scanned_at DESC, ps.id DESC
     LIMIT 1
  ) rm ON d.operation_type = 'reception'
  LEFT JOIN public.users u
    ON u.id = d.detected_by_user_id
   AND u.operator_id = public.get_operator_id()
   AND u.deleted_at IS NULL
 WHERE d.operator_id = public.get_operator_id()
   AND d.deleted_at IS NULL
   AND (
     p_status IS NULL
     -- 'open' pedido por el caller es "la cola de lo que falta actuar", no
     -- una igualdad literal -- ver comentario de cabecera, B1 de #715.
     OR (p_status = 'open' AND d.status <> 'resolved')
     OR (p_status <> 'open' AND d.status = p_status)
   )
 ORDER BY d.detected_at DESC
 -- Ronda 2 (#715, menor): no hay paginación real (page={1} pageCount={1} en
 -- el panel, sin p_page/p_page_size aquí) -- prod son ~112k despachos/~61k
 -- bultos y esta cola no está acotada por fecha ni por operación. Un LIMIT
 -- fijo es un tope de seguridad, NO la solución: sólo evita que una cola sin
 -- resolver crezca sin límite y tumbe al navegador; una cola real con más de
 -- 500 filas seguiría estando incompleta en pantalla sin que nada lo avise.
 -- Paginación de verdad (p_page/p_page_size + total_count) queda declarada
 -- como trabajo pendiente, no resuelta aquí.
 LIMIT 500;
$$;

COMMENT ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) IS
'spec-86 fase 3. Lectura enriquecida de public.discrepancies para el panel
Discrepancias de Ops Control: orden, paquete, carga, ruta y quién cerró la
operación que las detectó, además de las columnas propias de la tabla.
p_status=''open'' (el default) NO es una igualdad literal: devuelve
status <> ''resolved'' -- incluye ''lost'', que sigue siendo una acción
pendiente de Ops (el disparador de indemnización, spec-85) hasta que exista
ese flujo, no un cierre limpio (decisión de producto ya tomada en
20260917000002/spec-83, reafirmada aquí en #715 B1). p_status=''resolved'' o
p_status=''lost'' sí son igualdad literal. NULL devuelve todos los estados.
No expone route_receptions.expected_count/received_count: ver comentario de
cabecera de este archivo sobre por qué esta vista no compara un agregado que
puede desincronizarse de las filas reales de discrepancies. SECURITY
INVOKER: discrepancies y cada tabla unida aquí ya tienen RLS + GRANT SELECT
a authenticated; el filtro por operator_id en cada join es defensa en
profundidad, mismo patrón que get_discrepancies (20260913000003).
total_count (#715 M3) es el total ANTES de LIMIT 500 -- COUNT(*) OVER() se
computa antes de aplicar LIMIT, así que refleja el total real aunque las
filas devueltas estén truncadas; igual en cada fila, permite al frontend
avisar "500 de 617" sin una segunda llamada.';

REVOKE ALL ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) TO authenticated;
REVOKE ALL ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) FROM anon;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_discrepancies_ops_control'
  ) THEN
    RAISE EXCEPTION 'get_discrepancies_ops_control not created';
  END IF;

  RAISE NOTICE '✓ spec-86 fase 3 get_discrepancies_ops_control migration complete';
END $$;

COMMIT;
