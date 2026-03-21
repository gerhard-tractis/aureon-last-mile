-- =============================================================
-- Spec-12: Distribution Sectorization tables, enums, triggers
-- =============================================================

-- Step 1: Add new values to package_status_enum
-- MUST run outside transaction block
ALTER TYPE package_status_enum ADD VALUE IF NOT EXISTS 'sectorizado';
ALTER TYPE package_status_enum ADD VALUE IF NOT EXISTS 'retenido';

-- Step 2: New enums
DO $$ BEGIN
  CREATE TYPE batch_status_enum AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dock_scan_result_enum AS ENUM ('accepted', 'rejected', 'wrong_zone', 'unmapped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 3: dock_zones table
CREATE TABLE IF NOT EXISTS public.dock_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id),
  name VARCHAR NOT NULL,
  code VARCHAR NOT NULL,
  is_consolidation BOOLEAN NOT NULL DEFAULT false,
  comunas TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- One consolidation zone per operator
CREATE UNIQUE INDEX IF NOT EXISTS idx_dock_zones_one_consolidation
  ON public.dock_zones (operator_id)
  WHERE is_consolidation = true AND deleted_at IS NULL;

-- Unique code per operator
CREATE UNIQUE INDEX IF NOT EXISTS idx_dock_zones_operator_code
  ON public.dock_zones (operator_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dock_zones_operator_id ON public.dock_zones(operator_id);
CREATE INDEX IF NOT EXISTS idx_dock_zones_deleted_at ON public.dock_zones(deleted_at);

-- Step 4: dock_batches table
CREATE TABLE IF NOT EXISTS public.dock_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id),
  dock_zone_id UUID NOT NULL REFERENCES public.dock_zones(id),
  status batch_status_enum NOT NULL DEFAULT 'open',
  created_by UUID NOT NULL REFERENCES public.users(id),
  closed_at TIMESTAMPTZ,
  package_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dock_batches_operator_id ON public.dock_batches(operator_id);
CREATE INDEX IF NOT EXISTS idx_dock_batches_dock_zone_id ON public.dock_batches(dock_zone_id);
CREATE INDEX IF NOT EXISTS idx_dock_batches_created_by ON public.dock_batches(created_by);
CREATE INDEX IF NOT EXISTS idx_dock_batches_deleted_at ON public.dock_batches(deleted_at);

-- Step 5: dock_scans table
CREATE TABLE IF NOT EXISTS public.dock_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id),
  batch_id UUID NOT NULL REFERENCES public.dock_batches(id),
  package_id UUID REFERENCES public.packages(id),
  barcode TEXT NOT NULL,
  scan_result dock_scan_result_enum NOT NULL,
  scanned_by UUID NOT NULL REFERENCES public.users(id),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dock_scans_unique_package_batch
  ON public.dock_scans (operator_id, batch_id, package_id)
  WHERE deleted_at IS NULL AND package_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dock_scans_operator_id ON public.dock_scans(operator_id);
CREATE INDEX IF NOT EXISTS idx_dock_scans_batch_id ON public.dock_scans(batch_id);
CREATE INDEX IF NOT EXISTS idx_dock_scans_package_id ON public.dock_scans(package_id);
CREATE INDEX IF NOT EXISTS idx_dock_scans_deleted_at ON public.dock_scans(deleted_at);

-- Step 6: Add dock_zone_id to packages
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS dock_zone_id UUID REFERENCES public.dock_zones(id);

CREATE INDEX IF NOT EXISTS idx_packages_dock_zone_id ON public.packages(dock_zone_id);

-- Step 7: RLS policies
ALTER TABLE public.dock_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dock_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dock_scans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY dock_zones_tenant_isolation ON public.dock_zones
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY dock_batches_tenant_isolation ON public.dock_batches
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY dock_scans_tenant_isolation ON public.dock_scans
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 8: Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dock_zones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dock_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dock_scans TO authenticated;
GRANT ALL ON public.dock_zones TO service_role;
GRANT ALL ON public.dock_batches TO service_role;
GRANT ALL ON public.dock_scans TO service_role;
REVOKE ALL ON public.dock_zones FROM anon;
REVOKE ALL ON public.dock_batches FROM anon;
REVOKE ALL ON public.dock_scans FROM anon;

-- Step 9: Audit + set_updated_at triggers (idempotent)
DO $$ BEGIN
  CREATE TRIGGER audit_dock_zones
    AFTER INSERT OR UPDATE OR DELETE ON public.dock_zones
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_dock_zones_updated_at
    BEFORE UPDATE ON public.dock_zones
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_dock_batches
    AFTER INSERT OR UPDATE OR DELETE ON public.dock_batches
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_dock_batches_updated_at
    BEFORE UPDATE ON public.dock_batches
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_dock_scans
    AFTER INSERT OR UPDATE OR DELETE ON public.dock_scans
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_dock_scans_updated_at
    BEFORE UPDATE ON public.dock_scans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 10: Domain trigger — advance package status on scan
CREATE OR REPLACE FUNCTION public.trg_dock_scan_advance_package_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_consolidation BOOLEAN;
  v_dock_zone_id UUID;
BEGIN
  IF NEW.scan_result = 'accepted' AND NEW.package_id IS NOT NULL THEN
    -- Look up target dock zone via batch
    SELECT dz.id, dz.is_consolidation
    INTO v_dock_zone_id, v_is_consolidation
    FROM public.dock_batches db
    JOIN public.dock_zones dz ON dz.id = db.dock_zone_id
    WHERE db.id = NEW.batch_id;

    -- Update package status and location
    UPDATE public.packages
    SET status = CASE WHEN v_is_consolidation THEN 'retenido' ELSE 'sectorizado' END,
        dock_zone_id = v_dock_zone_id,
        status_updated_at = NOW()
    WHERE id = NEW.package_id;

    -- Increment batch package_count
    UPDATE public.dock_batches
    SET package_count = package_count + 1
    WHERE id = NEW.batch_id;
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_dock_scan_status
    AFTER INSERT ON public.dock_scans
    FOR EACH ROW EXECUTE FUNCTION public.trg_dock_scan_advance_package_status();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 11: Domain trigger — batch close timestamp
CREATE OR REPLACE FUNCTION public.trg_dock_batch_close_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    NEW.closed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_dock_batch_close
    BEFORE UPDATE ON public.dock_batches
    FOR EACH ROW EXECUTE FUNCTION public.trg_dock_batch_close_timestamp();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 12: Update pipeline_position() with new statuses
CREATE OR REPLACE FUNCTION pipeline_position(p_status TEXT)
RETURNS INT AS $$
  SELECT CASE p_status
    WHEN 'ingresado'    THEN 1
    WHEN 'verificado'   THEN 2
    WHEN 'en_bodega'    THEN 3
    WHEN 'sectorizado'  THEN 4
    WHEN 'retenido'     THEN 5
    WHEN 'asignado'     THEN 6
    WHEN 'en_carga'     THEN 7
    WHEN 'listo'        THEN 8
    WHEN 'en_ruta'      THEN 9
    WHEN 'entregado'    THEN 10
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Step 13: Update recalculate_order_status() to handle package-only statuses
CREATE OR REPLACE FUNCTION recalculate_order_status()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id UUID;
  v_min_pos INT;
  v_max_pos INT;
  v_min_status order_status_enum;
  v_max_status order_status_enum;
  v_active_count INT;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  SELECT COUNT(*) INTO v_active_count
  FROM packages
  WHERE order_id = v_order_id
    AND deleted_at IS NULL
    AND pipeline_position(status::text) > 0;

  IF v_active_count = 0 THEN
    UPDATE orders SET
      status = 'cancelado',
      leading_status = 'cancelado',
      status_updated_at = NOW()
    WHERE id = v_order_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    MIN(pipeline_position(p.status::text)),
    MAX(pipeline_position(p.status::text))
  INTO v_min_pos, v_max_pos
  FROM packages p
  WHERE p.order_id = v_order_id
    AND p.deleted_at IS NULL
    AND pipeline_position(p.status::text) > 0;

  -- Map positions back to order_status_enum values
  -- Positions 4 (sectorizado) and 5 (retenido) are package-only;
  -- map them back to 3 (en_bodega) for order-level status
  SELECT CASE
    WHEN v_min_pos <= 3 THEN
      CASE v_min_pos
        WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado' WHEN 3 THEN 'en_bodega'
      END
    WHEN v_min_pos IN (4, 5) THEN 'en_bodega'
    ELSE
      CASE v_min_pos
        WHEN 6 THEN 'asignado' WHEN 7 THEN 'en_carga' WHEN 8 THEN 'listo'
        WHEN 9 THEN 'en_ruta' WHEN 10 THEN 'entregado'
      END
  END::order_status_enum INTO v_min_status;

  SELECT CASE
    WHEN v_max_pos <= 3 THEN
      CASE v_max_pos
        WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado' WHEN 3 THEN 'en_bodega'
      END
    WHEN v_max_pos IN (4, 5) THEN 'en_bodega'
    ELSE
      CASE v_max_pos
        WHEN 6 THEN 'asignado' WHEN 7 THEN 'en_carga' WHEN 8 THEN 'listo'
        WHEN 9 THEN 'en_ruta' WHEN 10 THEN 'entregado'
      END
  END::order_status_enum INTO v_max_status;

  UPDATE orders SET
    status = v_min_status,
    leading_status = v_max_status,
    status_updated_at = NOW()
  WHERE id = v_order_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Step 14: Permission backfill — warehouse and admin users get distribution
UPDATE public.users
SET permissions = array_append(permissions, 'distribution')
WHERE 'warehouse' = ANY(permissions)
  AND NOT ('distribution' = ANY(permissions))
  AND deleted_at IS NULL;

UPDATE public.users
SET permissions = array_append(permissions, 'distribution')
WHERE 'admin' = ANY(permissions)
  AND NOT ('distribution' = ANY(permissions))
  AND deleted_at IS NULL;
