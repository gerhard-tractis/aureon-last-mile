-- spec-47 — post-backfill invariants.
-- 1. hub_receptions table is gone.
-- 2. reception_scans.reception_id FK now points at route_receptions.
-- 3. Every manifests row with reception_status NOT NULL has a non-NULL pickup_route_id.
-- 4. Every reception_scans row's reception_id resolves to a route_receptions row
--    whose pickup_route_id matches the scanned manifest's pickup_route_id.
-- 5. pickup_route_status_enum exists with the right labels.

BEGIN;

-- 1. hub_receptions dropped
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'hub_receptions'
  ) THEN
    RAISE EXCEPTION 'hub_receptions should have been dropped';
  END IF;
END $$;

-- 2. reception_scans.reception_id FK target = route_receptions
DO $$
DECLARE target TEXT;
BEGIN
  SELECT ccu.table_name
    INTO target
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
   WHERE tc.constraint_type = 'FOREIGN KEY'
     AND tc.table_schema = 'public'
     AND tc.table_name = 'reception_scans'
     AND kcu.column_name = 'reception_id'
   LIMIT 1;
  IF target IS DISTINCT FROM 'route_receptions' THEN
    RAISE EXCEPTION 'reception_scans.reception_id FK target should be route_receptions, got %', target;
  END IF;
END $$;

-- 3. Every reception_status-set manifest has pickup_route_id
DO $$
DECLARE bad INT;
BEGIN
  SELECT COUNT(*) INTO bad FROM public.manifests
   WHERE reception_status IS NOT NULL
     AND pickup_route_id IS NULL
     AND deleted_at IS NULL;
  IF bad <> 0 THEN
    RAISE EXCEPTION '% manifests with reception_status set are missing pickup_route_id', bad;
  END IF;
END $$;

-- 4. Every reception_scan resolves to a route_reception that matches the manifest's route.
--    Reception_scans don't carry manifest_id directly; we trace via the package's manifest
--    (best effort) — the spec asserts the route_reception's pickup_route_id matches the
--    pickup_route_id of any manifest holding the scanned package.
DO $$
DECLARE bad INT;
BEGIN
  SELECT COUNT(*) INTO bad
    FROM public.reception_scans rs
    JOIN public.route_receptions rr ON rr.id = rs.reception_id
    LEFT JOIN public.pickup_scans ps ON ps.package_id = rs.package_id
    LEFT JOIN public.manifests m ON m.id = ps.manifest_id
   WHERE rs.package_id IS NOT NULL
     AND m.pickup_route_id IS NOT NULL
     AND m.pickup_route_id IS DISTINCT FROM rr.pickup_route_id;
  IF bad <> 0 THEN
    RAISE EXCEPTION '% reception_scans point to a route_reception that does not match the manifest route', bad;
  END IF;
END $$;

-- 5. Enum sanity
DO $$
DECLARE labels TEXT[];
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE t.typname = 'pickup_route_status_enum';
  IF labels IS NULL THEN
    RAISE EXCEPTION 'pickup_route_status_enum missing';
  END IF;
  IF NOT (labels @> ARRAY['draft','in_progress','in_transit','received','cancelled']) THEN
    RAISE EXCEPTION 'pickup_route_status_enum has unexpected labels: %', labels;
  END IF;
END $$;

ROLLBACK;
