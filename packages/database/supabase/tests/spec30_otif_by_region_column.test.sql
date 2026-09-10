-- Regresión: get_dashboard_otif_by_region referenciaba cc.region_name, que NO
-- existe en public.chile_comunas (sus columnas son `region` y `region_num`,
-- 20260321000001:9-17). La función se creó igualmente porque su migración pone
-- `SET LOCAL check_function_bodies = off`, así que el cuerpo nunca se validó —
-- y como es LANGUAGE sql STABLE, el error sólo aparece al INVOCARLA.
--
-- El frontend la llama (useOtifChapter.ts:42) y sus tests mockean la RPC, así
-- que ninguna capa la ejercitaba de verdad.
BEGIN;
SELECT plan(3);

-- La columna que la función usaba NO existe...
SELECT hasnt_column('public', 'chile_comunas', 'region_name',
  'chile_comunas no tiene region_name — la funcion referenciaba una columna inexistente');

-- ...y la que debe usar, sí.
SELECT has_column('public', 'chile_comunas', 'region',
  'chile_comunas.region es la columna real');

-- Lo que de verdad cierra el bug: invocarla no revienta. Sin el arreglo esto
-- falla con 42703 (column cc.region_name does not exist), que es exactamente
-- lo que veia el usuario al abrir el capitulo OTIF del dashboard.
SELECT lives_ok(
  $$ SELECT * FROM public.get_dashboard_otif_by_region(
       gen_random_uuid(), CURRENT_DATE - 30, CURRENT_DATE) $$,
  'get_dashboard_otif_by_region se puede invocar sin error de columna'
);

SELECT * FROM finish();
ROLLBACK;
