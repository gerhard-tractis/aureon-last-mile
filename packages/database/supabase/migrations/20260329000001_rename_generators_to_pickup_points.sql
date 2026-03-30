-- 20260329000001_rename_generators_to_pickup_points.sql
-- Renames generators table to pickup_points and updates all FK columns.
-- Part of spec-23: OCR Agent + Camera Intake Multi-Photo.

-- 1. Rename the table
ALTER TABLE public.generators RENAME TO pickup_points;

-- 2. Rename table-level indexes
ALTER INDEX IF EXISTS idx_generators_operator_id RENAME TO idx_pickup_points_operator_id;
ALTER INDEX IF EXISTS idx_generators_tenant_client_id RENAME TO idx_pickup_points_tenant_client_id;

-- 3. Rename RLS policies (DROP + CREATE because ALTER POLICY only changes USING/WITH CHECK)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pickup_points' AND policyname = 'generators_service_role') THEN
    DROP POLICY generators_service_role ON public.pickup_points;
    CREATE POLICY pickup_points_service_role ON public.pickup_points FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pickup_points' AND policyname = 'generators_tenant_read') THEN
    DROP POLICY generators_tenant_read ON public.pickup_points;
    CREATE POLICY pickup_points_tenant_read ON public.pickup_points FOR SELECT TO authenticated
      USING (operator_id = public.get_operator_id());
  END IF;
END $$;

-- 4. Rename FK columns on referencing tables
ALTER TABLE public.intake_submissions RENAME COLUMN generator_id TO pickup_point_id;
ALTER INDEX IF EXISTS idx_intake_submissions_generator_id RENAME TO idx_intake_submissions_pickup_point_id;

ALTER TABLE public.orders RENAME COLUMN generator_id TO pickup_point_id;
ALTER INDEX IF EXISTS idx_orders_generator_id RENAME TO idx_orders_pickup_point_id;

ALTER TABLE public.exceptions RENAME COLUMN generator_id TO pickup_point_id;

-- 5. Rename updated_at trigger if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_generators_updated_at') THEN
    ALTER TRIGGER set_generators_updated_at ON public.pickup_points RENAME TO set_pickup_points_updated_at;
  END IF;
END $$;

-- Note: FK constraints auto-follow the table rename (PostgreSQL tracks by OID).
