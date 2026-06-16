-- spec-45 — Module Activation Layer tables.
-- - operator_enabled_modules: soft-delete current-state table
-- - operator_module_audit:    append-only flip log
-- All direct access denied; RPCs in migration 4 own all reads/writes.

CREATE TABLE IF NOT EXISTS public.operator_enabled_modules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  module_key    TEXT NOT NULL,
  enabled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enabled_by    UUID NOT NULL REFERENCES auth.users(id),
  disabled_at   TIMESTAMPTZ,
  disabled_by   UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE public.operator_enabled_modules IS
  'Per-tenant module enablement (soft-delete). A row with disabled_at IS NULL = module enabled. Re-enabling inserts a fresh row.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_oem_active
  ON public.operator_enabled_modules (operator_id, module_key)
  WHERE disabled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oem_active_by_operator
  ON public.operator_enabled_modules (operator_id)
  WHERE disabled_at IS NULL;

ALTER TABLE public.operator_enabled_modules ENABLE ROW LEVEL SECURITY;
-- No policies = no access for any role except SECURITY DEFINER functions
-- (which run as table owner and bypass RLS).

CREATE TABLE IF NOT EXISTS public.operator_module_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  module_key      TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('enable','disable')),
  actor_user_id   UUID NOT NULL REFERENCES auth.users(id),
  at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason          TEXT
);

COMMENT ON TABLE public.operator_module_audit IS
  'Append-only audit log of module enable/disable actions. No updates, no deletes.';

CREATE INDEX IF NOT EXISTS idx_oma_operator_at
  ON public.operator_module_audit (operator_id, at DESC);

ALTER TABLE public.operator_module_audit ENABLE ROW LEVEL SECURITY;
