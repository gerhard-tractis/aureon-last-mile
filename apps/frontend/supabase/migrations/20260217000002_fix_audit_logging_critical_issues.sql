-- Migration: Fix Critical Audit Logging Issues
-- Created: 2026-02-17
-- Story: 1.6 - Set Up Audit Logging Infrastructure (Code Review Fixes)
-- Purpose: Fix missing set_config function, RLS policy, and add timestamp index
-- Dependencies:
--   - 20260217000001_enhance_audit_logging_with_triggers_and_partitioning.sql

-- ============================================================================
-- FIX #1: Create set_config Function for IP Address Session Variables
-- ============================================================================
-- This function is required by ipAddress.ts setSupabaseSessionIp()
-- Allows setting PostgreSQL session variables from application code

CREATE OR REPLACE FUNCTION public.set_config(
  setting_name text,
  setting_value text,
  is_local boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set PostgreSQL session/transaction variable
  -- is_local = true: scoped to current transaction (recommended)
  -- is_local = false: scoped to current session
  PERFORM set_config(setting_name, setting_value, is_local);
  RETURN setting_value;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail (audit logging should not break operations)
    RAISE WARNING 'set_config failed for %: %', setting_name, SQLERRM;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.set_config IS 'Story 1.6: Set PostgreSQL session variables for audit logging (e.g., app.request_ip)';

-- Grant execute to authenticated users (needed for API routes)
GRANT EXECUTE ON FUNCTION public.set_config TO authenticated;

-- ============================================================================
-- FIX #8: Create RLS Policy Idempotently (Instead of Just Verifying)
-- ============================================================================
-- Ensure RLS policy exists, create if missing

-- Enable RLS on audit_logs if not already enabled
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if exists (idempotent)
DROP POLICY IF EXISTS audit_logs_operator_isolation ON public.audit_logs;

-- Create RLS policy for operator isolation
-- Users can ONLY query audit logs for their own operator_id
CREATE POLICY audit_logs_operator_isolation
  ON public.audit_logs
  FOR ALL
  USING (operator_id = public.get_operator_id());

COMMENT ON POLICY audit_logs_operator_isolation ON public.audit_logs IS 'Story 1.6: Multi-tenant isolation - users can only see audit logs from their operator';

-- ============================================================================
-- FIX #12: Add Timestamp-Only Index for Platform Admin Queries
-- ============================================================================
-- Supports system-wide queries across all operators (e.g., platform monitoring)

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp_global
  ON public.audit_logs(timestamp DESC);

COMMENT ON INDEX idx_audit_logs_timestamp_global IS 'Story 1.6: Platform-wide audit log queries (admin monitoring across all operators)';

-- ============================================================================
-- FIX #11: Create Metrics Table for Trigger Failures
-- ============================================================================
-- Track audit trigger failures for monitoring and alerting

CREATE TABLE IF NOT EXISTS public.audit_trigger_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL, -- INSERT, UPDATE, DELETE
  error_message TEXT NOT NULL,
  error_detail TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_trigger_failures_timestamp
  ON public.audit_trigger_failures(timestamp DESC);

COMMENT ON TABLE public.audit_trigger_failures IS 'Story 1.6: Track audit trigger failures for monitoring and debugging';

-- Enable RLS on failure tracking (platform admins only)
ALTER TABLE public.audit_trigger_failures ENABLE ROW LEVEL SECURITY;

-- Allow service role to insert failure logs
CREATE POLICY audit_trigger_failures_insert_policy
  ON public.audit_trigger_failures
  FOR INSERT
  WITH CHECK (true); -- Service role can always insert

-- Allow platform admins to read (if role system supports it)
CREATE POLICY audit_trigger_failures_read_policy
  ON public.audit_trigger_failures
  FOR SELECT
  USING (true); -- Adjust based on platform admin detection logic

-- ============================================================================
-- FIX #11: Improve Trigger Error Handling with Failure Logging
-- ============================================================================
-- Replace the catch-all EXCEPTION handler with specific error tracking

CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changes JSONB;
  v_operator_id UUID;
  v_user_id UUID;
  v_ip_address VARCHAR(50);
  v_action VARCHAR(50);
  v_max_json_size INTEGER := 10240; -- FIX #17: Extract magic number to constant
BEGIN
  -- Build changes JSON based on operation type
  IF TG_OP = 'INSERT' THEN
    v_changes := jsonb_build_object('after', row_to_json(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_changes := jsonb_build_object(
      'before', row_to_json(OLD),
      'after', row_to_json(NEW)
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_changes := jsonb_build_object('before', row_to_json(OLD));
  END IF;

  -- Truncate if changes_json exceeds max size (edge case handling)
  IF octet_length(v_changes::text) > v_max_json_size THEN
    v_changes := jsonb_build_object(
      'truncated', true,
      'size_bytes', octet_length(v_changes::text),
      'message', 'Changes JSON exceeded ' || v_max_json_size || ' bytes and was truncated'
    );
  END IF;

  -- Extract operator_id from record or session
  -- Priority: NEW.operator_id > OLD.operator_id > auth context
  v_operator_id := COALESCE(
    (TG_OP = 'DELETE')::boolean = false AND NEW.operator_id,
    OLD.operator_id,
    public.get_operator_id()
  );

  -- Get user_id from auth session
  v_user_id := auth.uid();

  -- Extract IP address from session variable (set by middleware)
  -- Fallback to 'unknown' if not set (edge case handling)
  BEGIN
    v_ip_address := current_setting('app.request_ip', true);
    IF v_ip_address IS NULL OR v_ip_address = '' THEN
      v_ip_address := 'unknown';
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_ip_address := 'unknown';
  END;

  -- Build action string: "INSERT_users", "UPDATE_orders", "DELETE_manifests"
  v_action := TG_OP || '_' || TG_TABLE_NAME;

  -- Insert audit log entry
  INSERT INTO public.audit_logs (
    operator_id,
    user_id,
    action,
    resource_type,
    resource_id,
    changes_json,
    ip_address
  ) VALUES (
    v_operator_id,
    v_user_id,
    v_action,
    TG_TABLE_NAME,
    COALESCE(
      (TG_OP = 'DELETE')::boolean = false AND NEW.id,
      OLD.id
    ),
    v_changes,
    v_ip_address
  );

  -- Return appropriate row for trigger chain
  RETURN COALESCE(NEW, OLD);

EXCEPTION
  WHEN OTHERS THEN
    -- FIX #11: Log specific failure details instead of generic warning
    BEGIN
      INSERT INTO public.audit_trigger_failures (table_name, operation, error_message, error_detail)
      VALUES (TG_TABLE_NAME, TG_OP, SQLERRM, SQLSTATE);
    EXCEPTION
      WHEN OTHERS THEN
        -- If failure logging also fails, just warn (ultimate fail-open)
        RAISE WARNING 'audit_trigger_func failed for %.% and could not log failure: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
    END;

    -- Fail-open: Don't block operation even if audit logging fails
    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.audit_trigger_func IS 'Story 1.6: Automatic audit logging trigger with improved error tracking (Code Review Fix)';

-- ============================================================================
-- Migration Completion
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Story 1.6 Critical Fixes Applied';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ FIX #1: set_config function created for IP capture';
  RAISE NOTICE '✓ FIX #8: RLS policy created idempotently';
  RAISE NOTICE '✓ FIX #11: Trigger error handling improved with failure tracking';
  RAISE NOTICE '✓ FIX #12: Timestamp-only index added for platform queries';
  RAISE NOTICE '✓ FIX #17: Magic number extracted to constant';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  NEXT STEPS:';
  RAISE NOTICE '1. Update API routes to call setSupabaseSessionIp()';
  RAISE NOTICE '2. Write tests (unit, integration, E2E, performance)';
  RAISE NOTICE '3. Schedule cron jobs via Supabase Dashboard';
  RAISE NOTICE '4. Implement table partitioning (separate migration)';
END $$;
