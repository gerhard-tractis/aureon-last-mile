-- =============================================================================
-- spec-55 — Carton Expansion: minting Aureon CTN IDs for undeclared boxes
-- =============================================================================
-- Ingest sends one CARTON_ID per manifest line. Some retailers ship a product
-- that physically occupies several boxes and still send a single ID — those
-- extra boxes have no packages row, no barcode, no status, and are invisible
-- to reception/distribution/dispatch/billing counts.
--
-- This migration lets the pickup crew mint additional Aureon carton IDs on the
-- spot, on OBSERVED reality rather than the retailer's declaration:
--
--   CTN001 stays box 1 (the parent). Siblings CTN001-2, CTN001-3, ... are
--   ordinary `packages` rows riding the exact same state-engine trigger chain
--   (20260812000002_spec52_package_state_engine.sql) as every other package —
--   no scanner, no validator, no downstream flow needs to change.
--
-- Two RPCs:
--   expand_carton(p_package_id, p_additional_boxes, p_reason)
--     Mints N sibling packages, recomputes declared_box_count/package_number
--     across the whole family, recomputes manifests.total_packages, and
--     writes an audit row. SECURITY DEFINER, operator-scoped via
--     public.get_operator_id() (the JWT, not a trusted client argument).
--
--   delete_minted_carton(p_package_id, p_reason)
--     Soft-deletes a single minted sibling (undo), only while still at
--     'ingresado'. The parent can never be deleted this way.
--
-- New column: packages.created_by_user_id — who minted this carton. NULL for
-- every ingest-created row; expansion changes what the tenant is billed for,
-- so it needs a name against it.
--
-- New table: carton_expansion_audit — append-only, independent of the
-- soft-deletable packages rows, modelled on operator_module_audit
-- (20260616000003_spec45_module_activation_tables.sql).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. packages.created_by_user_id
-- -----------------------------------------------------------------------------
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id);

COMMENT ON COLUMN public.packages.created_by_user_id IS
'Who minted this carton via expand_carton (spec-55). NULL for every
ingest-created row. Expansion changes what the tenant is billed for; it needs
a name against it.';

-- -----------------------------------------------------------------------------
-- 2. carton_expansion_audit — append-only
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carton_expansion_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  package_id    UUID NOT NULL REFERENCES public.packages(id),
  parent_label  VARCHAR(100) NOT NULL,
  boxes_added   INT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  reason        TEXT NOT NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.carton_expansion_audit IS
'Append-only audit log of carton_expansion actions (spec-55): a human
overriding retailer-declared box counts, directly affecting billing. No
updates, no deletes. boxes_added is positive for expand_carton, negative for
delete_minted_carton (undo).';

CREATE INDEX IF NOT EXISTS idx_carton_expansion_audit_operator_at
  ON public.carton_expansion_audit (operator_id, at DESC);

ALTER TABLE public.carton_expansion_audit ENABLE ROW LEVEL SECURITY;
-- No policies = no direct access for any role except SECURITY DEFINER
-- functions below (same pattern as operator_module_audit).

-- -----------------------------------------------------------------------------
-- 3. expand_carton
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expand_carton(
  p_package_id       UUID,
  p_additional_boxes INT,
  p_reason           TEXT
) RETURNS TABLE (
  out_id                 UUID,
  out_label              TEXT,
  out_package_number     TEXT,
  out_declared_box_count INT,
  out_parent_label       TEXT,
  out_is_generated_label BOOLEAN,
  out_order_id           UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator        UUID;
  v_actor           UUID;
  v_target          public.packages%ROWTYPE;
  v_root            public.packages%ROWTYPE;
  v_base_label      TEXT;
  v_existing_count  INT;
  v_new_total       INT;
  v_next_suffix     INT;
  v_candidate_label TEXT;
  v_new_ids         UUID[] := ARRAY[]::UUID[];
  v_new_id          UUID;
  v_external_load   VARCHAR(100);
  i                 INT;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  v_actor := NULLIF(auth.jwt() ->> 'sub', '')::UUID;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'no actor in JWT';
  END IF;

  -- Rule 1: ownership + soft-delete. Locked here so two concurrent expansions
  -- of the same carton cannot race the suffix search below.
  SELECT * INTO v_target
    FROM public.packages
   WHERE id = p_package_id
     AND operator_id = v_operator
     AND deleted_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package not found' USING ERRCODE = '42501';
  END IF;

  -- Rule 2: 1..20. A fat-fingered 300 fails loudly rather than minting 300
  -- cartons. The ceiling is arbitrary and documented as such (spec-55).
  IF p_additional_boxes IS NULL OR p_additional_boxes < 1 OR p_additional_boxes > 20 THEN
    RAISE EXCEPTION 'p_additional_boxes must be between 1 and 20, got %', p_additional_boxes;
  END IF;

  -- Rule 4: mandatory reason — mirrors enable_module_for_operator.
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  -- CTN001 always stays box 1. If the crew tapped a minted sibling instead of
  -- the parent row, walk back to the root so every expansion of a family
  -- shares one label sequence.
  IF v_target.is_generated_label THEN
    SELECT * INTO v_root
      FROM public.packages
     WHERE operator_id = v_operator
       AND label = v_target.parent_label
       AND deleted_at IS NULL
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent carton not found for %', v_target.parent_label;
    END IF;
  ELSE
    v_root := v_target;
  END IF;

  -- Rule 3: once a package is in the warehouse, expanding it silently changes
  -- counts under flows already in motion. Only ingresado/verificado allowed.
  IF v_root.status::TEXT NOT IN ('ingresado', 'verificado') THEN
    RAISE EXCEPTION 'cannot expand a carton once it has moved past verificado (current status: %)', v_root.status;
  END IF;

  v_base_label := v_root.label;

  -- Rule 5/6: next free suffix + new family total. Never assume
  -- declared_box_count is the high-water mark — a carton may be expanded
  -- twice, or a previous sibling may have been soft-deleted (its label stays
  -- reserved by unique_label_per_operator, which is not partial).
  SELECT COUNT(*) INTO v_existing_count
    FROM public.packages
   WHERE operator_id = v_operator
     AND deleted_at IS NULL
     AND (id = v_root.id OR parent_label = v_base_label);

  v_new_total := v_existing_count + p_additional_boxes;

  -- Denominator refresh on the parent and every live sibling. The numerator
  -- is derived from each row's own label suffix (never touched once minted),
  -- not parsed back out of the old package_number text.
  UPDATE public.packages
     SET declared_box_count = v_new_total,
         package_number     = '1 de ' || v_new_total
   WHERE id = v_root.id;

  UPDATE public.packages
     SET declared_box_count = v_new_total,
         package_number     = (substring(label FROM length(v_base_label) + 2)) || ' de ' || v_new_total
   WHERE operator_id = v_operator
     AND deleted_at IS NULL
     AND parent_label = v_base_label
     AND id <> v_root.id;

  v_next_suffix := 2;
  FOR i IN 1..p_additional_boxes LOOP
    LOOP
      v_candidate_label := v_base_label || '-' || v_next_suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.packages
         WHERE operator_id = v_operator AND label = v_candidate_label
      );
      v_next_suffix := v_next_suffix + 1;
    END LOOP;

    INSERT INTO public.packages (
      operator_id, order_id, label, package_number, declared_box_count,
      is_generated_label, parent_label, sku_items, status, raw_data,
      created_by_user_id
    ) VALUES (
      v_operator, v_root.order_id, v_candidate_label,
      v_next_suffix || ' de ' || v_new_total, v_new_total,
      TRUE, v_base_label, '[]'::jsonb, 'ingresado', '{}'::jsonb,
      v_actor
    )
    RETURNING packages.id INTO v_new_id;

    v_new_ids := array_append(v_new_ids, v_new_id);
    v_next_suffix := v_next_suffix + 1;
  END LOOP;

  -- Rule 7: manifests.total_packages is denormalised and read by the scan
  -- screen's progress denominator; a stale value shows 3/1.
  SELECT o.external_load_id INTO v_external_load
    FROM public.orders o
   WHERE o.id = v_root.order_id;

  IF v_external_load IS NOT NULL THEN
    UPDATE public.manifests m
       SET total_packages = (
         SELECT COUNT(*)
           FROM public.packages p
           JOIN public.orders o2 ON o2.id = p.order_id
          WHERE o2.operator_id = v_operator
            AND o2.external_load_id = m.external_load_id
            AND o2.deleted_at IS NULL
            AND p.deleted_at IS NULL
       )
     WHERE m.operator_id = v_operator
       AND m.external_load_id = v_external_load
       AND m.deleted_at IS NULL;
  END IF;

  INSERT INTO public.carton_expansion_audit
    (operator_id, package_id, parent_label, boxes_added, actor_user_id, reason)
  VALUES (v_operator, v_root.id, v_base_label, p_additional_boxes, v_actor, p_reason);

  RETURN QUERY
  SELECT p.id, p.label::TEXT, p.package_number::TEXT, p.declared_box_count,
         p.parent_label::TEXT, p.is_generated_label, p.order_id
    FROM public.packages p
   WHERE p.id = ANY(v_new_ids)
   ORDER BY p.label;
END $$;

COMMENT ON FUNCTION public.expand_carton(UUID, INT, TEXT) IS
'spec-55. Mints p_additional_boxes new packages rows as siblings of the parent
carton (CTN001 stays box 1), on observed reality at the retailer rather than
the retailer''s declared_box_count. Operator-scoped via get_operator_id() —
p_package_id is never trusted as a tenant boundary on its own. Rejects a
parent past verificado, an empty reason, or a box count outside 1..20.';

GRANT EXECUTE ON FUNCTION public.expand_carton(UUID, INT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. delete_minted_carton — undo, soft delete only, sibling only
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_minted_carton(
  p_package_id UUID,
  p_reason     TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator      UUID;
  v_actor         UUID;
  v_pkg           public.packages%ROWTYPE;
  v_base_label    TEXT;
  v_new_total     INT;
  v_external_load VARCHAR(100);
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  v_actor := NULLIF(auth.jwt() ->> 'sub', '')::UUID;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'no actor in JWT';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  SELECT * INTO v_pkg
    FROM public.packages
   WHERE id = p_package_id
     AND operator_id = v_operator
     AND deleted_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package not found' USING ERRCODE = '42501';
  END IF;

  IF NOT v_pkg.is_generated_label THEN
    RAISE EXCEPTION 'the parent carton cannot be deleted, only a minted sibling';
  END IF;

  IF v_pkg.status::TEXT <> 'ingresado' THEN
    RAISE EXCEPTION 'cannot delete a minted carton once it has been scanned (current status: %)', v_pkg.status;
  END IF;

  v_base_label := v_pkg.parent_label;

  UPDATE public.packages SET deleted_at = NOW() WHERE id = v_pkg.id;

  SELECT COUNT(*) INTO v_new_total
    FROM public.packages
   WHERE operator_id = v_operator
     AND deleted_at IS NULL
     AND (label = v_base_label OR parent_label = v_base_label);

  UPDATE public.packages
     SET declared_box_count = v_new_total,
         package_number     = '1 de ' || v_new_total
   WHERE operator_id = v_operator
     AND deleted_at IS NULL
     AND label = v_base_label;

  UPDATE public.packages
     SET declared_box_count = v_new_total,
         package_number     = (substring(label FROM length(v_base_label) + 2)) || ' de ' || v_new_total
   WHERE operator_id = v_operator
     AND deleted_at IS NULL
     AND parent_label = v_base_label;

  SELECT o.external_load_id INTO v_external_load
    FROM public.orders o
   WHERE o.id = v_pkg.order_id;

  IF v_external_load IS NOT NULL THEN
    UPDATE public.manifests m
       SET total_packages = (
         SELECT COUNT(*)
           FROM public.packages p
           JOIN public.orders o2 ON o2.id = p.order_id
          WHERE o2.operator_id = v_operator
            AND o2.external_load_id = m.external_load_id
            AND o2.deleted_at IS NULL
            AND p.deleted_at IS NULL
       )
     WHERE m.operator_id = v_operator
       AND m.external_load_id = v_external_load
       AND m.deleted_at IS NULL;
  END IF;

  INSERT INTO public.carton_expansion_audit
    (operator_id, package_id, parent_label, boxes_added, actor_user_id, reason)
  VALUES (v_operator, v_pkg.id, v_base_label, -1, v_actor, p_reason);
END $$;

COMMENT ON FUNCTION public.delete_minted_carton(UUID, TEXT) IS
'spec-55. Soft-deletes a single minted sibling carton (undo of expand_carton),
only while still at ingresado. The parent (is_generated_label = false) can
never be deleted this way — see docs/specs/spec-55-carton-expansion.md.';

GRANT EXECUTE ON FUNCTION public.delete_minted_carton(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages'
      AND column_name = 'created_by_user_id'
  ) THEN
    RAISE EXCEPTION 'packages.created_by_user_id not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'carton_expansion_audit'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'carton_expansion_audit missing or RLS not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'expand_carton'
  ) THEN
    RAISE EXCEPTION 'expand_carton not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'delete_minted_carton'
  ) THEN
    RAISE EXCEPTION 'delete_minted_carton not created';
  END IF;

  RAISE NOTICE '✓ spec-55 carton expansion migration complete';
END $$;

COMMIT;
