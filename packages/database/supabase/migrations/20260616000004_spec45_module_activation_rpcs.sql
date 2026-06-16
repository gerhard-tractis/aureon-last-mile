-- spec-45 — Module Activation RPCs. All SECURITY DEFINER.
-- Authorization is enforced by reading auth.jwt() inside each function.
--
-- JWT structure (set by custom_access_token_hook):
--   auth.jwt()->>'operator_id'                            (top-level, merged by hook)
--   auth.jwt()->'app_metadata'->'claims'->>'role'         (actual user role)
--   auth.jwt()->>'role'                                   (always 'authenticated' in prod)
--
-- For test simulation via `SET LOCAL request.jwt.claims = '{"role":"super_admin",...}'`,
-- we also accept role at the JWT root.

-- ── Helper: is current JWT a super-admin? ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' -> 'claims' ->> 'role') = 'super_admin'
    OR (auth.jwt() ->> 'role') = 'super_admin',
    FALSE
  );
$$;

-- ── Helper: caller's operator_id from JWT ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.spec45_caller_operator_id()
RETURNS UUID
LANGUAGE SQL STABLE
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' -> 'claims' ->> 'operator_id', '')::UUID,
    NULLIF(auth.jwt() ->> 'operator_id', '')::UUID
  );
$$;

-- ── get_enabled_modules_for_operator ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_enabled_modules_for_operator(
  p_operator_id UUID
) RETURNS TEXT[]
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  caller_operator UUID;
BEGIN
  caller_operator := public.spec45_caller_operator_id();
  IF NOT public.is_super_admin() AND caller_operator IS DISTINCT FROM p_operator_id THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(
    (SELECT array_agg(module_key)
       FROM public.operator_enabled_modules
      WHERE operator_id = p_operator_id AND disabled_at IS NULL),
    ARRAY[]::TEXT[]
  );
END $$;

-- ── enable_module_for_operator ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enable_module_for_operator(
  p_operator_id UUID,
  p_module_key  TEXT,
  p_reason      TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor UUID;
  already_active BOOLEAN;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  actor := NULLIF(auth.jwt() ->> 'sub','')::UUID;
  IF actor IS NULL THEN
    RAISE EXCEPTION 'no actor in JWT';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.operator_enabled_modules
     WHERE operator_id = p_operator_id
       AND module_key = p_module_key
       AND disabled_at IS NULL
  ) INTO already_active;

  IF NOT already_active THEN
    INSERT INTO public.operator_enabled_modules (operator_id, module_key, enabled_by)
    VALUES (p_operator_id, p_module_key, actor);
  END IF;

  -- Audit row is always written (including idempotent re-attempts) so the
  -- log reflects every super-admin action.
  INSERT INTO public.operator_module_audit
    (operator_id, module_key, action, actor_user_id, reason)
  VALUES (p_operator_id, p_module_key, 'enable', actor, p_reason);
END $$;

-- ── disable_module_for_operator ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.disable_module_for_operator(
  p_operator_id UUID,
  p_module_key  TEXT,
  p_reason      TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  actor := NULLIF(auth.jwt() ->> 'sub','')::UUID;
  IF actor IS NULL THEN
    RAISE EXCEPTION 'no actor in JWT';
  END IF;

  UPDATE public.operator_enabled_modules
     SET disabled_at = NOW(), disabled_by = actor
   WHERE operator_id = p_operator_id
     AND module_key = p_module_key
     AND disabled_at IS NULL;

  INSERT INTO public.operator_module_audit
    (operator_id, module_key, action, actor_user_id, reason)
  VALUES (p_operator_id, p_module_key, 'disable', actor, p_reason);
END $$;

-- ── list_operators_with_module_state (super-admin only) ────────────────────
CREATE OR REPLACE FUNCTION public.list_operators_with_module_state()
RETURNS TABLE (
  operator_id UUID,
  operator_name TEXT,
  operator_slug TEXT,
  enabled_modules TEXT[]
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name::TEXT,
    o.slug::TEXT,
    COALESCE(
      (SELECT array_agg(oem.module_key)
         FROM public.operator_enabled_modules oem
        WHERE oem.operator_id = o.id AND oem.disabled_at IS NULL),
      ARRAY[]::TEXT[]
    )
  FROM public.operators o
  WHERE o.is_active = TRUE
  ORDER BY o.name;
END $$;

-- ── get_module_audit_for_operator ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_module_audit_for_operator(
  p_operator_id UUID
) RETURNS TABLE (
  id            UUID,
  module_key    TEXT,
  action        TEXT,
  actor_user_id UUID,
  at            TIMESTAMPTZ,
  reason        TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.module_key, a.action, a.actor_user_id, a.at, a.reason
    FROM public.operator_module_audit a
   WHERE a.operator_id = p_operator_id
   ORDER BY a.at DESC;
END $$;

-- Grant execute to authenticated; the functions themselves enforce authz.
GRANT EXECUTE ON FUNCTION public.get_enabled_modules_for_operator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enable_module_for_operator(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disable_module_for_operator(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_operators_with_module_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_module_audit_for_operator(UUID) TO authenticated;
