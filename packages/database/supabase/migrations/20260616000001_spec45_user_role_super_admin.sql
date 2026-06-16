-- spec-45 — Add super_admin to user_role ENUM
-- super_admin is a cross-tenant role held by Aureon internal users only.
-- Cross-tenant access happens exclusively through SECURITY DEFINER RPCs
-- (no RLS or JWT-claims-hook changes needed).

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'super_admin';
