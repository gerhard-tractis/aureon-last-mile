-- ============================================================================
-- Hotfix: get_dashboard_otif_by_region referenciaba una columna inexistente.
--
-- `20260409000003_spec30_dashboard_rpcs.sql:103,117` usaba `cc.region_name`
-- sobre `public.chile_comunas`, cuyas columnas reales son `region` y
-- `region_num` (`20260321000001:9-17`). Ningún ALTER posterior añade
-- `region_name` — verificado sobre todo el corpus de migraciones.
--
-- POR QUE SOBREVIVIO SEIS MESES SIN QUE NADIE LO VIERA
-- ---------------------------------------------------------------------------
-- Tres capas fallaron a la vez, y ninguna es culpa de la siguiente:
--   1. La migración que la creó abre con `SET LOCAL check_function_bodies=off`
--      (a propósito: declara RPCs antes que la tabla de rollup que crea
--      `20260409000007`). Con esa bandera Postgres NO valida el cuerpo, así
--      que la función se creó con una referencia rota.
--   2. Es `LANGUAGE sql STABLE`, no plpgsql: el plan se resuelve al INVOCARLA.
--      Nunca se invocó en ningún test de base de datos.
--   3. El frontend sí la llama (`useOtifChapter.ts:42`), pero sus tests
--      mockean la RPC (`useOtifChapter.test.ts:43,60,85`) — comprueban que se
--      la llama con el nombre correcto, jamás que funcione.
--
-- Síntoma en producción: abrir el capítulo OTIF del dashboard devuelve
-- 42703 `column cc.region_name does not exist`.
--
-- El arreglo es la columna correcta. El nombre de la columna de SALIDA sigue
-- siendo `region_name` — es el contrato que el frontend ya consume
-- (`useOtifChapter.ts`), y cambiarlo rompería la pantalla de verdad.
--
-- `CREATE OR REPLACE` conserva la ACL existente; no se toca el GRANT.
-- Plantilla: la definición de `20260409000003`, que es la más reciente — esta
-- función no se ha redefinido desde entonces (verificado con grep sobre las
-- migraciones).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_otif_by_region(
  p_operator_id UUID,
  p_start       DATE,
  p_end         DATE
)
RETURNS TABLE (
  region_name      TEXT,
  total_orders     BIGINT,
  delivered_orders BIGINT,
  otif_pct         NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE(cc.region, 'Sin región')       AS region_name,
    COUNT(*)::BIGINT                        AS total_orders,
    COUNT(*) FILTER (WHERE d.status = 'delivered')::BIGINT AS delivered_orders,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE d.status = 'delivered') / NULLIF(COUNT(*), 0),
      2
    ) AS otif_pct
  FROM public.dispatches d
  JOIN public.orders o ON o.id = d.order_id
  LEFT JOIN public.chile_comunas cc ON cc.id = o.comuna_id
  WHERE d.operator_id = p_operator_id
    AND d.created_at::DATE BETWEEN p_start AND p_end
    AND d.deleted_at IS NULL
    AND o.deleted_at IS NULL
  GROUP BY cc.region
  ORDER BY total_orders DESC
$$;

COMMENT ON FUNCTION public.get_dashboard_otif_by_region(UUID, DATE, DATE) IS
  'OTIF por región chilena. Agrupa por chile_comunas.region (la columna real); '
  'la columna de salida se sigue llamando region_name por contrato con el frontend.';
