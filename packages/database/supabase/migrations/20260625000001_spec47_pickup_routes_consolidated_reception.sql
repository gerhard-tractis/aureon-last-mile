-- =============================================================================
-- spec-47 — Pickup Routes + Consolidated Hub Reception
-- =============================================================================
-- Replaces per-manifest hub handoff with a route-level handoff:
--   • new table  pickup_routes      (driver-side trip wrapping N manifests)
--   • new table  route_receptions   (hub-side consolidated reception session)
--   • manifests gets pickup_route_id FK
--   • reception_scans.reception_id is repointed to route_receptions(id)
--   • hub_receptions is dropped after a one-shot backfill into route_receptions
--
-- Everything runs in one transaction. If any step fails the migration aborts.
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 1 — Enum
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE pickup_route_status_enum AS ENUM
    ('draft','in_progress','in_transit','received','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON TYPE pickup_route_status_enum IS 'Lifecycle for a driver pickup-route trip (spec-47).';

-- =============================================================================
-- PART 2 — pickup_routes table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.pickup_routes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  driver_id       UUID NOT NULL REFERENCES public.users(id),
  vehicle_label   TEXT,
  status          pickup_route_status_enum NOT NULL DEFAULT 'in_progress',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  in_transit_at   TIMESTAMPTZ,
  received_at     TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
COMMENT ON TABLE  public.pickup_routes IS 'Driver pickup trip wrapping ≥1 manifest (spec-47).';
COMMENT ON COLUMN public.pickup_routes.code IS 'Human-typable route code, format PR-YYYY-NNNN. Unique per operator.';

CREATE INDEX IF NOT EXISTS idx_pickup_routes_operator_id
  ON public.pickup_routes(operator_id);
CREATE INDEX IF NOT EXISTS idx_pickup_routes_status
  ON public.pickup_routes(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_pickup_routes_driver
  ON public.pickup_routes(driver_id);
CREATE INDEX IF NOT EXISTS idx_pickup_routes_deleted_at
  ON public.pickup_routes(deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pickup_routes_operator_code
  ON public.pickup_routes(operator_id, code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pickup_routes_one_active_per_driver
  ON public.pickup_routes(operator_id, driver_id)
  WHERE status IN ('draft','in_progress') AND deleted_at IS NULL;

-- Code generator sequence
CREATE SEQUENCE IF NOT EXISTS pickup_routes_code_seq;

-- =============================================================================
-- PART 3 — route_receptions table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.route_receptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_route_id     UUID NOT NULL REFERENCES public.pickup_routes(id),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  received_by         UUID REFERENCES public.users(id),
  delivered_by        UUID NOT NULL REFERENCES public.users(id),
  status              hub_reception_status_enum NOT NULL DEFAULT 'pending',
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  expected_count      INT NOT NULL DEFAULT 0,
  received_count      INT NOT NULL DEFAULT 0,
  discrepancy_notes   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);
COMMENT ON TABLE  public.route_receptions IS 'Consolidated hub reception session for a pickup route (spec-47).';

CREATE INDEX IF NOT EXISTS idx_route_receptions_operator_id
  ON public.route_receptions(operator_id);
CREATE INDEX IF NOT EXISTS idx_route_receptions_status
  ON public.route_receptions(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_route_receptions_deleted_at
  ON public.route_receptions(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_receptions_pickup_route
  ON public.route_receptions(pickup_route_id) WHERE deleted_at IS NULL;

-- =============================================================================
-- PART 4 — manifests.pickup_route_id
-- =============================================================================
ALTER TABLE public.manifests
  ADD COLUMN IF NOT EXISTS pickup_route_id UUID REFERENCES public.pickup_routes(id);
CREATE INDEX IF NOT EXISTS idx_manifests_pickup_route
  ON public.manifests(pickup_route_id) WHERE pickup_route_id IS NOT NULL;

-- =============================================================================
-- PART 5 — RLS, audit, set_updated_at, grants
-- =============================================================================
ALTER TABLE public.pickup_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_receptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "pickup_routes_tenant_isolation" ON public.pickup_routes
    FOR ALL USING (operator_id = public.get_operator_id())
           WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "pickup_routes_tenant_select" ON public.pickup_routes
    FOR SELECT USING (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "route_receptions_tenant_isolation" ON public.route_receptions
    FOR ALL USING (operator_id = public.get_operator_id())
           WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "route_receptions_tenant_select" ON public.route_receptions
    FOR SELECT USING (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON public.pickup_routes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.route_receptions TO authenticated;
REVOKE ALL ON public.pickup_routes FROM anon;
REVOKE ALL ON public.route_receptions FROM anon;
GRANT ALL ON public.pickup_routes TO service_role;
GRANT ALL ON public.route_receptions TO service_role;
GRANT USAGE ON SEQUENCE pickup_routes_code_seq TO authenticated, service_role;

DO $$ BEGIN
  CREATE TRIGGER audit_pickup_routes_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.pickup_routes
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER audit_route_receptions_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.route_receptions
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_pickup_routes_updated_at
    BEFORE UPDATE ON public.pickup_routes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER set_route_receptions_updated_at
    BEFORE UPDATE ON public.route_receptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- PART 6 — Triggers (domain)
-- =============================================================================

-- 6.1 — pickup_routes status transitions
CREATE OR REPLACE FUNCTION public.trg_pickup_routes_set_manifest_reception_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected INT;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'in_transit' THEN
    -- Flip linked manifests to awaiting_reception
    UPDATE public.manifests
       SET reception_status = 'awaiting_reception'
     WHERE pickup_route_id = NEW.id;

    -- Compute expected_count = distinct verified package_ids across linked manifests
    SELECT COUNT(DISTINCT ps.package_id) INTO v_expected
      FROM public.pickup_scans ps
      JOIN public.manifests m ON m.id = ps.manifest_id
     WHERE m.pickup_route_id = NEW.id
       AND ps.scan_result = 'verified'
       AND ps.package_id IS NOT NULL;

    -- Create the route_receptions row (idempotent on pickup_route_id)
    INSERT INTO public.route_receptions
      (pickup_route_id, operator_id, delivered_by, status, expected_count)
    VALUES
      (NEW.id, NEW.operator_id, NEW.driver_id, 'pending', COALESCE(v_expected, 0))
    ON CONFLICT (pickup_route_id) WHERE deleted_at IS NULL DO NOTHING;

  ELSIF NEW.status = 'received' THEN
    UPDATE public.manifests
       SET reception_status = 'received'
     WHERE pickup_route_id = NEW.id;

  ELSIF NEW.status = 'cancelled' THEN
    -- Detach manifests and clear reception_status this route may have set
    UPDATE public.manifests
       SET pickup_route_id = NULL,
           reception_status = NULL
     WHERE pickup_route_id = NEW.id;
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.trg_pickup_routes_set_manifest_reception_status
  IS 'Sync manifest reception_status + create/mutate route_receptions on pickup_routes status change (spec-47).';

DROP TRIGGER IF EXISTS trg_pickup_routes_status_sync ON public.pickup_routes;
CREATE TRIGGER trg_pickup_routes_status_sync
  AFTER UPDATE OF status ON public.pickup_routes
  FOR EACH ROW EXECUTE FUNCTION public.trg_pickup_routes_set_manifest_reception_status();

-- 6.2 — route_receptions status transitions cascade
CREATE OR REPLACE FUNCTION public.trg_route_receptions_status_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'in_progress' THEN
    IF NEW.started_at IS NULL THEN
      NEW.started_at := NOW();
    END IF;
    UPDATE public.manifests
       SET reception_status = 'reception_in_progress'
     WHERE pickup_route_id = NEW.pickup_route_id;

  ELSIF NEW.status = 'completed' THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := NOW();
    END IF;
    UPDATE public.manifests
       SET reception_status = 'received'
     WHERE pickup_route_id = NEW.pickup_route_id;
    UPDATE public.pickup_routes
       SET status = 'received', received_at = NOW()
     WHERE id = NEW.pickup_route_id
       AND status <> 'received';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.trg_route_receptions_status_sync
  IS 'Cascade route_receptions status to manifests and pickup_routes (spec-47).';

DROP TRIGGER IF EXISTS trg_route_receptions_status_sync ON public.route_receptions;
CREATE TRIGGER trg_route_receptions_status_sync
  BEFORE UPDATE OF status ON public.route_receptions
  FOR EACH ROW EXECUTE FUNCTION public.trg_route_receptions_status_sync();

-- 6.3 — reception_scans bump received_count + promote status
CREATE OR REPLACE FUNCTION public.trg_reception_scans_route_received_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.scan_result = 'received' THEN
    UPDATE public.route_receptions
       SET received_count = received_count + 1,
           status = CASE WHEN status = 'pending' THEN 'in_progress'::hub_reception_status_enum
                         ELSE status END,
           started_at = COALESCE(started_at, NOW())
     WHERE id = NEW.reception_id;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.trg_reception_scans_route_received_count
  IS 'On received reception_scan, bump route_receptions.received_count and promote pending→in_progress (spec-47).';

DROP TRIGGER IF EXISTS trg_reception_scans_route_count ON public.reception_scans;
CREATE TRIGGER trg_reception_scans_route_count
  AFTER INSERT ON public.reception_scans
  FOR EACH ROW EXECUTE FUNCTION public.trg_reception_scans_route_received_count();

-- =============================================================================
-- PART 7 — RPCs
-- =============================================================================

-- 7.1 — start_pickup_route
CREATE OR REPLACE FUNCTION public.start_pickup_route(
  p_vehicle_label TEXT DEFAULT NULL
) RETURNS public.pickup_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_driver   UUID;
  v_year     INT := EXTRACT(YEAR FROM NOW())::INT;
  v_code     TEXT;
  v_row      public.pickup_routes;
BEGIN
  v_operator := public.get_operator_id();
  v_driver   := NULLIF(auth.jwt() ->> 'sub','')::UUID;
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;
  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'no driver (sub) in JWT' USING ERRCODE = '42501';
  END IF;

  -- Build code; uniqueness enforced by partial unique index per operator.
  -- Retry up to 3x on collision.
  FOR i IN 1..3 LOOP
    v_code := 'PR-' || v_year || '-' || lpad(nextval('pickup_routes_code_seq')::TEXT, 4, '0');
    BEGIN
      INSERT INTO public.pickup_routes (operator_id, code, driver_id, vehicle_label, status)
      VALUES (v_operator, v_code, v_driver, p_vehicle_label, 'in_progress')
      RETURNING * INTO v_row;
      RETURN v_row;
    EXCEPTION
      WHEN unique_violation THEN
        -- The single-active-route partial index also lives here; surface a cleaner
        -- error in that case by re-checking.
        IF EXISTS (
          SELECT 1 FROM public.pickup_routes
           WHERE operator_id = v_operator
             AND driver_id = v_driver
             AND status IN ('draft','in_progress')
             AND deleted_at IS NULL
        ) THEN
          RAISE EXCEPTION 'driver already has an active pickup route'
            USING ERRCODE = '23505';
        END IF;
        -- otherwise it was a code collision: retry
    END;
  END LOOP;
  RAISE EXCEPTION 'could not allocate pickup route code after 3 attempts';
END $$;

COMMENT ON FUNCTION public.start_pickup_route(TEXT)
  IS 'Create a new in_progress pickup_routes row for the caller (driver) (spec-47).';

-- 7.2 — add_manifest_to_route
CREATE OR REPLACE FUNCTION public.add_manifest_to_route(
  p_route_id    UUID,
  p_manifest_id UUID
) RETURNS public.manifests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator   UUID;
  v_route      public.pickup_routes;
  v_manifest   public.manifests;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_route FROM public.pickup_routes
   WHERE id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL;
  IF v_route.id IS NULL THEN
    RAISE EXCEPTION 'pickup route % not found', p_route_id;
  END IF;
  IF v_route.status <> 'in_progress' THEN
    RAISE EXCEPTION 'pickup route % is not in_progress (status=%)', p_route_id, v_route.status;
  END IF;

  SELECT * INTO v_manifest FROM public.manifests
   WHERE id = p_manifest_id AND operator_id = v_operator;
  IF v_manifest.id IS NULL THEN
    RAISE EXCEPTION 'manifest % not found', p_manifest_id;
  END IF;
  IF v_manifest.pickup_route_id IS NOT NULL AND v_manifest.pickup_route_id <> p_route_id THEN
    RAISE EXCEPTION 'manifest % already linked to another route %',
      p_manifest_id, v_manifest.pickup_route_id;
  END IF;

  UPDATE public.manifests
     SET pickup_route_id = p_route_id
   WHERE id = p_manifest_id
  RETURNING * INTO v_manifest;
  RETURN v_manifest;
END $$;

COMMENT ON FUNCTION public.add_manifest_to_route(UUID, UUID)
  IS 'Link a manifest to an in_progress pickup route (spec-47).';

-- 7.3 — close_pickup_route
CREATE OR REPLACE FUNCTION public.close_pickup_route(
  p_route_id UUID
) RETURNS public.route_receptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator      UUID;
  v_verified_cnt  INT;
  v_route         public.pickup_routes;
  v_rr            public.route_receptions;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_route FROM public.pickup_routes
   WHERE id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL;
  IF v_route.id IS NULL THEN
    RAISE EXCEPTION 'pickup route % not found', p_route_id;
  END IF;
  IF v_route.status <> 'in_progress' THEN
    RAISE EXCEPTION 'pickup route % is not in_progress', p_route_id;
  END IF;

  SELECT COUNT(*) INTO v_verified_cnt
    FROM public.pickup_scans ps
    JOIN public.manifests m ON m.id = ps.manifest_id
   WHERE m.pickup_route_id = p_route_id
     AND ps.scan_result = 'verified'
     AND ps.package_id IS NOT NULL;
  IF v_verified_cnt = 0 THEN
    RAISE EXCEPTION 'cannot close route % with zero verified scans', p_route_id;
  END IF;

  -- Flip status — trigger creates the route_receptions row
  UPDATE public.pickup_routes
     SET status = 'in_transit', in_transit_at = NOW()
   WHERE id = p_route_id;

  SELECT * INTO v_rr FROM public.route_receptions
   WHERE pickup_route_id = p_route_id;
  RETURN v_rr;
END $$;

COMMENT ON FUNCTION public.close_pickup_route(UUID)
  IS 'Close an in_progress pickup route → in_transit and return the route_receptions row (spec-47).';

-- 7.4 — cancel_pickup_route
CREATE OR REPLACE FUNCTION public.cancel_pickup_route(
  p_route_id UUID,
  p_reason   TEXT
) RETURNS public.pickup_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_route    public.pickup_routes;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_route FROM public.pickup_routes
   WHERE id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL;
  IF v_route.id IS NULL THEN
    RAISE EXCEPTION 'pickup route % not found', p_route_id;
  END IF;
  IF v_route.status NOT IN ('draft','in_progress') THEN
    RAISE EXCEPTION 'cannot cancel route in status %', v_route.status;
  END IF;

  UPDATE public.pickup_routes
     SET status = 'cancelled', cancelled_at = NOW()
   WHERE id = p_route_id
  RETURNING * INTO v_route;

  -- p_reason stored only via audit_trigger_func / could be appended to a future
  -- discrepancy_notes field on pickup_routes if needed.
  RETURN v_route;
END $$;

COMMENT ON FUNCTION public.cancel_pickup_route(UUID, TEXT)
  IS 'Cancel a draft/in_progress pickup route; trigger detaches its manifests (spec-47).';

-- 7.5 — get_route_reception_snapshot
CREATE OR REPLACE FUNCTION public.get_route_reception_snapshot(
  p_route_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_route    JSONB;
  v_rr       JSONB;
  v_manifests JSONB;
  v_packages JSONB;
  v_scans    JSONB;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(pr.*) INTO v_route
    FROM public.pickup_routes pr
   WHERE pr.id = p_route_id AND pr.operator_id = v_operator AND pr.deleted_at IS NULL;
  IF v_route IS NULL THEN
    RAISE EXCEPTION 'pickup route % not found', p_route_id;
  END IF;

  SELECT to_jsonb(rr.*) INTO v_rr
    FROM public.route_receptions rr
   WHERE rr.pickup_route_id = p_route_id AND rr.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(m.*)), '[]'::jsonb) INTO v_manifests
    FROM public.manifests m
   WHERE m.pickup_route_id = p_route_id;

  -- Packages grouped via verified pickup_scans, with order context for the UI
  SELECT COALESCE(jsonb_agg(row_to_json(p)::jsonb), '[]'::jsonb) INTO v_packages
    FROM (
      SELECT DISTINCT
             pk.id            AS package_id,
             pk.label         AS label,
             pk.order_id      AS order_id,
             o.order_number   AS order_number,
             o.customer_name  AS customer_name,
             o.retailer_name  AS retailer_name,
             ps.manifest_id   AS manifest_id
        FROM public.pickup_scans ps
        JOIN public.manifests m ON m.id = ps.manifest_id
        JOIN public.packages  pk ON pk.id = ps.package_id
        JOIN public.orders    o  ON o.id = pk.order_id
       WHERE m.pickup_route_id = p_route_id
         AND ps.scan_result = 'verified'
         AND ps.package_id IS NOT NULL
    ) p;

  SELECT COALESCE(jsonb_agg(to_jsonb(rs.*)), '[]'::jsonb) INTO v_scans
    FROM public.reception_scans rs
    JOIN public.route_receptions rr ON rr.id = rs.reception_id
   WHERE rr.pickup_route_id = p_route_id;

  RETURN jsonb_build_object(
    'route',     v_route,
    'reception', v_rr,
    'manifests', v_manifests,
    'packages',  v_packages,
    'scans',     v_scans
  );
END $$;

COMMENT ON FUNCTION public.get_route_reception_snapshot(UUID)
  IS 'Single-roundtrip snapshot for the consolidated reception page (spec-47).';

-- 7.6 — complete_route_reception
CREATE OR REPLACE FUNCTION public.complete_route_reception(
  p_route_id            UUID,
  p_discrepancy_notes   TEXT DEFAULT NULL
) RETURNS public.route_receptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_rr       public.route_receptions;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rr FROM public.route_receptions
   WHERE pickup_route_id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL;
  IF v_rr.id IS NULL THEN
    RAISE EXCEPTION 'route_reception for route % not found', p_route_id;
  END IF;

  IF v_rr.received_count < v_rr.expected_count
     AND (p_discrepancy_notes IS NULL OR length(trim(p_discrepancy_notes)) = 0) THEN
    RAISE EXCEPTION 'discrepancy_notes required when received (%) < expected (%)',
      v_rr.received_count, v_rr.expected_count;
  END IF;

  UPDATE public.route_receptions
     SET status = 'completed',
         completed_at = NOW(),
         discrepancy_notes = COALESCE(p_discrepancy_notes, discrepancy_notes)
   WHERE id = v_rr.id
  RETURNING * INTO v_rr;
  RETURN v_rr;
END $$;

COMMENT ON FUNCTION public.complete_route_reception(UUID, TEXT)
  IS 'Finalize a route reception; trigger cascades manifest + pickup_route status (spec-47).';

GRANT EXECUTE ON FUNCTION public.start_pickup_route(TEXT)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_manifest_to_route(UUID, UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_pickup_route(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pickup_route(UUID, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_route_reception_snapshot(UUID)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_route_reception(UUID, TEXT)  TO authenticated;

-- =============================================================================
-- PART 8 — Backfill: legacy in-flight manifests/hub_receptions → pickup_routes
-- =============================================================================
-- For every manifest with reception_status set and no pickup_route_id, synthesize
-- a PR-LEGACY-<seq> pickup_routes row (one per manifest). Copy any matching
-- hub_receptions row into route_receptions (1:1) and repoint reception_scans.

DO $$
DECLARE
  v_has_hub_receptions BOOLEAN;
  v_manifest RECORD;
  v_pickup_id UUID;
  v_route_recep_id UUID;
  v_legacy_seq INT := 0;
  v_legacy_driver UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'hub_receptions'
  ) INTO v_has_hub_receptions;

  -- Need a fallback driver per operator to satisfy NOT NULL driver_id when the
  -- legacy manifest has no assignee. Use the manifest's assigned_to_user_id if
  -- present; otherwise pick any user in the operator (deterministic ORDER BY).
  FOR v_manifest IN
    SELECT m.*
      FROM public.manifests m
     WHERE m.reception_status IS NOT NULL
       AND m.pickup_route_id IS NULL
       AND m.deleted_at IS NULL
     ORDER BY m.created_at
  LOOP
    v_legacy_seq := v_legacy_seq + 1;

    v_legacy_driver := v_manifest.assigned_to_user_id;
    IF v_legacy_driver IS NULL THEN
      SELECT id INTO v_legacy_driver
        FROM public.users
       WHERE operator_id = v_manifest.operator_id
         AND deleted_at IS NULL
       ORDER BY created_at
       LIMIT 1;
    END IF;
    -- If still null skip this manifest — schema invariant requires a driver.
    IF v_legacy_driver IS NULL THEN
      RAISE NOTICE 'skipping legacy backfill for manifest % — no driver available', v_manifest.id;
      CONTINUE;
    END IF;

    INSERT INTO public.pickup_routes
      (operator_id, code, driver_id, status, in_transit_at, received_at, created_at)
    VALUES (
      v_manifest.operator_id,
      'PR-LEGACY-' || lpad(v_legacy_seq::TEXT, 6, '0'),
      v_legacy_driver,
      CASE v_manifest.reception_status
        WHEN 'received'              THEN 'received'::pickup_route_status_enum
        WHEN 'reception_in_progress' THEN 'in_transit'::pickup_route_status_enum
        ELSE                              'in_transit'::pickup_route_status_enum  -- awaiting_reception
      END,
      COALESCE(v_manifest.completed_at, NOW()),
      CASE WHEN v_manifest.reception_status = 'received'
           THEN COALESCE(v_manifest.completed_at, NOW())
           ELSE NULL END,
      COALESCE(v_manifest.created_at, NOW())
    )
    RETURNING id INTO v_pickup_id;

    -- Detach trigger side-effects by using a direct UPDATE bypassing the route status
    -- (status didn't change since we inserted at terminal state; UPDATE of pickup_route_id
    --  on manifests does not fire pickup_routes triggers).
    UPDATE public.manifests
       SET pickup_route_id = v_pickup_id
     WHERE id = v_manifest.id;

    IF v_has_hub_receptions THEN
      -- Copy matching hub_receptions row(s) into route_receptions (1:1 if exists)
      INSERT INTO public.route_receptions (
        pickup_route_id, operator_id, received_by, delivered_by,
        status, started_at, completed_at, expected_count, received_count,
        discrepancy_notes, created_at, updated_at, deleted_at
      )
      SELECT
        v_pickup_id,
        hr.operator_id,
        hr.received_by,
        COALESCE(hr.delivered_by, v_legacy_driver),
        hr.status,
        hr.started_at,
        hr.completed_at,
        hr.expected_count,
        hr.received_count,
        hr.discrepancy_notes,
        hr.created_at,
        hr.updated_at,
        hr.deleted_at
      FROM public.hub_receptions hr
      WHERE hr.manifest_id = v_manifest.id
      LIMIT 1
      RETURNING id INTO v_route_recep_id;

      -- Repoint reception_scans.reception_id from the old hub_receptions.id
      -- to the new route_receptions.id (column type unchanged).
      IF v_route_recep_id IS NOT NULL THEN
        UPDATE public.reception_scans rs
           SET reception_id = v_route_recep_id
          FROM public.hub_receptions hr
         WHERE hr.manifest_id = v_manifest.id
           AND rs.reception_id = hr.id;
      END IF;
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- PART 9 — Repoint reception_scans FK and drop hub_receptions
-- =============================================================================
-- Drop the old FK constraint (it points to hub_receptions) and create a new one
-- to route_receptions.

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT tc.constraint_name INTO v_constraint
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
   WHERE tc.constraint_type = 'FOREIGN KEY'
     AND tc.table_schema = 'public'
     AND tc.table_name = 'reception_scans'
     AND kcu.column_name = 'reception_id'
     AND ccu.table_name = 'hub_receptions'
   LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reception_scans DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

ALTER TABLE public.reception_scans
  ADD CONSTRAINT reception_scans_reception_id_fkey
  FOREIGN KEY (reception_id) REFERENCES public.route_receptions(id);

DROP TABLE IF EXISTS public.hub_receptions CASCADE;

-- =============================================================================
-- PART 10 — Validation
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pickup_route_status_enum') THEN
    RAISE EXCEPTION 'pickup_route_status_enum missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='pickup_routes') THEN
    RAISE EXCEPTION 'pickup_routes table missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='route_receptions') THEN
    RAISE EXCEPTION 'route_receptions table missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='hub_receptions') THEN
    RAISE EXCEPTION 'hub_receptions should be dropped';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='manifests' AND column_name='pickup_route_id'
  ) THEN
    RAISE EXCEPTION 'manifests.pickup_route_id missing';
  END IF;
  RAISE NOTICE '✓ spec-47 migration validation passed';
END $$;

COMMIT;
