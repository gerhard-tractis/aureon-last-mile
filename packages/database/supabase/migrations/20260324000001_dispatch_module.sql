-- packages/database/supabase/migrations/20260324000001_dispatch_module.sql

-- 1. Add 'draft' to route_status_enum (before 'planned')
-- NOTE: PostgreSQL does not support BEFORE/AFTER in ADD VALUE for all versions.
-- We add it and accept it will appear after existing values in pg_enum ordering.
-- The application code uses explicit string values, not ordinal positions.
ALTER TYPE public.route_status_enum ADD VALUE IF NOT EXISTS 'draft';

-- 2. Rename 'listo' → 'listo_para_despacho' in both enums
-- IMPORTANT: Only run if no rows carry 'listo' in production.
ALTER TYPE public.order_status_enum RENAME VALUE 'listo' TO 'listo_para_despacho';
ALTER TYPE public.package_status_enum RENAME VALUE 'listo' TO 'listo_para_despacho';
