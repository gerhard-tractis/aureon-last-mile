-- =============================================================================
-- spec-86 fase 3, seguimiento (#715) — get_discrepancies_ops_control:
-- documentar el canje de coste de total_count, sin cambiar la lógica
-- =============================================================================
-- Plantilla: la ÚLTIMA definición de get_discrepancies_ops_control es
-- 20260925000001 (verificado con
-- `git grep -l 'FUNCTION public.get_discrepancies_ops_control' packages/database/supabase/migrations/`
-- — un solo hit además de este archivo). El cuerpo de la función es
-- BYTE-A-BYTE idéntico al de esa migración; esta migración sólo reemplaza el
-- COMMENT ON FUNCTION. No hay cambio de comportamiento, así que un
-- CREATE OR REPLACE plano basta -- el tipo de retorno no cambia (a
-- diferencia de 20260925000001, que sí necesitó DROP FUNCTION por añadir
-- total_count).
--
-- Qué se documenta y por qué (revisión de seguimiento de #715, "anotar, no
-- arreglar"):
--
--   1. COUNT(*) OVER() convierte LIMIT 500 en un tope de TRANSFERENCIA, no
--      de COSTE. Que total_count dé 600 con LIMIT 500 sólo es posible si
--      Postgres materializó las 600 filas antes de aplicar el LIMIT — es
--      correcto y es justamente lo que hace funcionar el aviso "500 de 617"
--      del frontend, pero cada fila operation_type='reception' corre su
--      propio LATERAL (el escaneo de pickup_scans/manifests que deriva
--      carga), así que ese coste es O(total de filas que matchean el
--      filtro), no O(500), sobre una cola que hoy sólo crece (nada mueve una
--      discrepancy fuera de 'open' a escala — fase 2a `[pending]`, spec-85
--      fase 3b `[parked]`, resolve_discrepancy es fila a fila). No es un bug
--      — es el canje consciente que hace honesto el conteo — pero el
--      comentario anterior vendía total_count sin mencionar ese canje.
--
--   2. Los KPIs del panel mezclan denominadores bajo truncamiento: "Sin
--      resolver 617" junto a "De recogida 250" + "De recepción 250" = 500,
--      no 617 — el desglose por operación se calcula sobre las filas
--      REALMENTE recibidas (post-LIMIT), mientras que "Sin resolver" usa
--      total_count (pre-LIMIT). Es la versión benigna del defecto de la
--      ronda 1 (dos números que no cuadran en la misma pantalla) — benigna
--      porque el cuarto KPI ("Mostradas: 500 de 617") y el tile explican al
--      lado por qué no cuadran, así que la señal de truncamiento existe y es
--      visible, a diferencia de la ronda 1 donde no había ninguna señal.
--      Ver apps/frontend/.../DiscrepancyTable.tsx, computeDiscrepancyKpis,
--      para el mismo comentario del lado del frontend.
-- =============================================================================

BEGIN;

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
  LEFT JOIN public.manifests pm
    ON pm.id = d.manifest_id AND pm.operator_id = public.get_operator_id()
  LEFT JOIN public.pickup_routes prp
    ON prp.id = pm.pickup_route_id AND prp.operator_id = public.get_operator_id()
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
     OR (p_status = 'open' AND d.status <> 'resolved')
     OR (p_status <> 'open' AND d.status = p_status)
   )
 ORDER BY d.detected_at DESC
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
20260917000002/spec-83, reafirmada en #715 B1). p_status=''resolved'' o
p_status=''lost'' sí son igualdad literal. NULL devuelve todos los estados.
No expone route_receptions.expected_count/received_count: ver comentario de
cabecera de 20260925000001 sobre por qué esta vista no compara un agregado
que puede desincronizarse de las filas reales de discrepancies. SECURITY
INVOKER: discrepancies y cada tabla unida aquí ya tienen RLS + GRANT SELECT
a authenticated; el filtro por operator_id en cada join es defensa en
profundidad, mismo patrón que get_discrepancies (20260913000003).
total_count (#715 M3) es el total ANTES de LIMIT 500 -- COUNT(*) OVER() se
computa antes de aplicar LIMIT, así que refleja el total real aunque las
filas devueltas estén truncadas. Canje de coste (#715 seguimiento): esto
convierte LIMIT 500 en un tope de TRANSFERENCIA, no de coste -- Postgres
materializa TODAS las filas que matchean el filtro antes de aplicar el
LIMIT, y cada fila operation_type=''reception'' corre su propio LATERAL
(pickup_scans/manifests). El coste es O(total), no O(500), sobre una cola
que hoy sólo crece (nada mueve una discrepancy fuera de ''open'' a escala
todavía). Es el canje consciente que hace honesto el conteo, no un error.';

REVOKE ALL ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) TO authenticated;
REVOKE ALL ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) FROM anon;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_src TEXT;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_discrepancies_ops_control';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'get_discrepancies_ops_control not found';
  END IF;
  IF v_src NOT LIKE '%COUNT(*) OVER()%' THEN
    RAISE EXCEPTION 'get_discrepancies_ops_control lost its total_count window function';
  END IF;
  IF v_src NOT LIKE '%d.status <> ''resolved''%' THEN
    RAISE EXCEPTION 'get_discrepancies_ops_control lost its B1 open-includes-lost semantics';
  END IF;

  RAISE NOTICE '✓ spec-86 fase 3 seguimiento (#715): cost-tradeoff comment added, no behaviour change';
END $$;

COMMIT;
