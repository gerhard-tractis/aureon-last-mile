-- =============================================================================
-- spec-84 fase 1 — drivers.user_id usable
-- =============================================================================
-- El vínculo public.drivers.user_id -> public.users(id) existe desde
-- 20260318000004_agent_suite_tables.sql:253-254. Esta migración no lo crea:
-- cierra los dos huecos reales que impedían usarlo (spec-84, corrección
-- 2026-09-08):
--   1. El índice de 20260318000004:278 (idx_drivers_user_id) no es UNIQUE.
--      Un SELECT ... WHERE user_id = auth.uid() podía devolver más de una
--      fila.
--   2. No existía ninguna política RLS que permitiera a un rol
--      administrativo escribir drivers.user_id — drivers_authenticated_read
--      (20260318000005) sólo cubre SELECT; el GRANT UPDATE a `authenticated`
--      de esa misma migración es letra muerta sin una policy que lo respalde
--      (RLS deniega por defecto). Sin esto, no hay superficie de admin
--      posible sin bypassear RLS con el service role.
--
-- =============================================================================
-- Decisión de alcance del índice único: GLOBAL, no por (operator_id, user_id)
-- =============================================================================
-- El checklist de la fase sugería "mismo user_id Y mismo operator_id". Se
-- descarta a propósito:
--
-- public.users.operator_id es NOT NULL (20260216170542:35) — una fila de
-- `users` pertenece a un único operador. Por tanto, drivers.user_id, en
-- cuanto se fija, ya trae consigo un tenant: no hace falta que la unicidad
-- lo repita.
--
-- La pregunta real del spec era otra: ¿puede el mismo humano ser conductor
-- de dos operadores en esta plataforma? Sí, pero YA está modelado sin tocar
-- esta columna: como dos cuentas `auth.users`/`public.users` distintas (dos
-- emails, uno por tenant) — exactamente como ya se modela un mismo teléfono
-- o RUT de conductor en dos operadores como dos filas de `drivers` distintas
-- (unique_driver_phone_per_operator / unique_driver_rut_per_operator son
-- scoped por operador porque phone/rut son datos del mundo real que no
-- pertenecen a ningún tenant). `user_id` es distinto: es un login de ESTA
-- plataforma, y esta plataforma ya fuerza un operador por cuenta.
--
-- Permitir que el mismo user_id apareciera en dos filas de `drivers` de dos
-- operadores distintos no habilitaría ningún caso de negocio nuevo (ese
-- humano ya tendría una segunda cuenta para el segundo operador) y sí abriría
-- la ambigüedad exacta que la fase existe para cerrar: qué fila de `drivers`
-- resuelve "soy yo" cuando la home de fase 2 haga
-- `SELECT * FROM drivers WHERE user_id = auth.uid()`. Con unicidad global esa
-- consulta no puede devolver más de una fila jamás, sin depender de que el
-- caller también filtre por operator_id correctamente.
--
-- Parcial en `deleted_at IS NULL`: un conductor dado de baja (soft delete)
-- no debe bloquear que ese mismo user_id se re-vincule a un conductor activo
-- nuevo (p.ej. tras corregir un alta duplicada). Nota: las dos constraints
-- UNIQUE existentes de esta tabla (phone, rut) NO filtran deleted_at — es una
-- inconsistencia preexistente, fuera de alcance de esta fase; el índice
-- nuevo usa el patrón más correcto porque es nuevo, no porque se estén
-- corrigiendo los otros dos aquí.
-- =============================================================================

-- 1. Reemplaza el índice no-único de 20260318000004:278 por uno único, global,
--    parcial sobre filas activas con user_id fijado.
DROP INDEX IF EXISTS public.idx_drivers_user_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_user_id
  ON public.drivers (user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON INDEX public.idx_drivers_user_id IS
  'Unicidad GLOBAL (no por operador) de drivers.user_id — ver razonamiento '
  'en 20260917000001_spec84_fase1_drivers_user_id_usable.sql. Parcial: '
  'excluye user_id NULL y filas soft-deleted.';

-- =============================================================================
-- 2. Política RLS: admin/operations_manager pueden gestionar drivers de su
--    propio operador (incluyendo vincular/desvincular user_id). Sigue el
--    patrón de users_admin_full_access (20260409000009), reutilizando los
--    mismos helpers SECURITY DEFINER para evitar recursión de RLS.
-- =============================================================================
DROP POLICY IF EXISTS "drivers_admin_write" ON public.drivers;

CREATE POLICY "drivers_admin_write" ON public.drivers
  FOR ALL
  TO authenticated
  USING (
    operator_id = public.get_operator_id()
    AND public.get_current_user_role() IN ('admin', 'operations_manager')
  )
  WITH CHECK (
    operator_id = public.get_operator_id()
    AND public.get_current_user_role() IN ('admin', 'operations_manager')
  );

COMMENT ON POLICY "drivers_admin_write" ON public.drivers IS
  'admin/operations_manager pueden gestionar (incl. UPDATE user_id) los '
  'drivers de su propio operador. Sin esta policy, el GRANT UPDATE a '
  'authenticated de 20260318000005 es letra muerta bajo RLS.';

-- Smoke test
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'drivers'
       AND indexname = 'idx_drivers_user_id'
  ) THEN
    RAISE EXCEPTION 'idx_drivers_user_id not found after migration!';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'drivers'
       AND policyname = 'drivers_admin_write'
  ) THEN
    RAISE EXCEPTION 'drivers_admin_write policy not found after migration!';
  END IF;

  RAISE NOTICE '✓ spec-84 fase 1: idx_drivers_user_id is UNIQUE, drivers_admin_write policy created';
END $$;
