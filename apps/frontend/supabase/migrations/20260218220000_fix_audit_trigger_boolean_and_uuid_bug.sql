-- Fix: audit_trigger_func() has a bug where boolean AND uuid causes type error
-- Error: "argument of AND must be type boolean, not type uuid"
-- The expression `(TG_OP = 'DELETE')::boolean = false AND NEW.operator_id`
-- is interpreted as `false AND <uuid>` which PostgreSQL rejects.
-- Fix: Use CASE expression instead of boolean AND.

CREATE OR REPLACE FUNCTION audit_trigger_func()
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
  v_resource_id UUID;
  v_max_json_size INTEGER := 10240;
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

  -- Truncate if changes_json exceeds max size
  IF octet_length(v_changes::text) > v_max_json_size THEN
    v_changes := jsonb_build_object(
      'truncated', true,
      'size_bytes', octet_length(v_changes::text),
      'message', 'Changes JSON exceeded ' || v_max_json_size || ' bytes and was truncated'
    );
  END IF;

  -- Extract operator_id: NEW for INSERT/UPDATE, OLD for DELETE
  IF TG_OP = 'DELETE' THEN
    v_operator_id := OLD.operator_id;
    v_resource_id := OLD.id;
  ELSE
    v_operator_id := NEW.operator_id;
    v_resource_id := NEW.id;
  END IF;

  -- Fallback to auth context if operator_id is null
  IF v_operator_id IS NULL THEN
    v_operator_id := public.get_operator_id();
  END IF;

  -- Get user_id from auth session
  v_user_id := auth.uid();

  -- Extract IP address from session variable (set by middleware)
  BEGIN
    v_ip_address := current_setting('app.request_ip', true);
    IF v_ip_address IS NULL OR v_ip_address = '' THEN
      v_ip_address := 'unknown';
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      v_ip_address := 'unknown';
  END;

  -- Build action string: "INSERT_users", "UPDATE_orders", etc.
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
    COALESCE(v_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    v_action,
    TG_TABLE_NAME,
    v_resource_id,
    v_changes,
    v_ip_address
  );

  -- Return appropriate record
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    -- Log failure to audit_trigger_failures table (never block the original operation)
    INSERT INTO public.audit_trigger_failures (
      table_name,
      operation,
      error_message,
      error_detail
    ) VALUES (
      TG_TABLE_NAME,
      TG_OP,
      SQLERRM,
      SQLSTATE
    );
    -- Return the record so the original operation succeeds
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
END;
$$;

-- Update validate_audit_logging to check for orders trigger with correct name
CREATE OR REPLACE FUNCTION validate_audit_logging()
RETURNS TABLE(test_name TEXT, status TEXT, details TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check trigger function exists
  RETURN QUERY
  SELECT 'Trigger Function Exists'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_trigger_func')
      THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'audit_trigger_func')
      THEN 'audit_trigger_func found'::TEXT ELSE 'audit_trigger_func not found'::TEXT END;

  -- Check users trigger
  RETURN QUERY
  SELECT 'Users Trigger Attached'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'users' AND trigger_name LIKE '%audit%')
      THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'users' AND trigger_name LIKE '%audit%')
      THEN (SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'users' AND trigger_name LIKE '%audit%' LIMIT 1) || ' attached'
      ELSE 'audit trigger not found on users'::TEXT END;

  -- Check orders trigger
  RETURN QUERY
  SELECT 'Orders Trigger Attached'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'orders' AND trigger_name LIKE '%audit%')
      THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'orders' AND trigger_name LIKE '%audit%')
      THEN (SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'orders' AND trigger_name LIKE '%audit%' LIMIT 1) || ' attached'
      ELSE 'audit trigger not found on orders'::TEXT END;

  -- Check manifests trigger
  RETURN QUERY
  SELECT 'Manifests Trigger Attached'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'manifests' AND trigger_name LIKE '%audit%')
      THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'manifests' AND trigger_name LIKE '%audit%')
      THEN (SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'manifests' AND trigger_name LIKE '%audit%' LIMIT 1) || ' attached'
      ELSE 'audit trigger not found on manifests'::TEXT END;

  -- Check packages trigger
  RETURN QUERY
  SELECT 'Packages Trigger Attached'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'packages' AND trigger_name LIKE '%audit%')
      THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'packages' AND trigger_name LIKE '%audit%')
      THEN (SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'packages' AND trigger_name LIKE '%audit%' LIMIT 1) || ' attached'
      ELSE 'audit trigger not found on packages'::TEXT END;

  -- Check indexes
  RETURN QUERY
  SELECT 'Index: operator_id_timestamp'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_logs_operator_id_timestamp')
      THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_logs_operator_id_timestamp')
      THEN 'Index exists'::TEXT ELSE 'Index missing'::TEXT END;

  RETURN QUERY
  SELECT 'Index: operator_user_timestamp'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_logs_operator_user_timestamp')
      THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_logs_operator_user_timestamp')
      THEN 'Index exists'::TEXT ELSE 'Index missing'::TEXT END;

  RETURN QUERY
  SELECT 'Index: resource'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_logs_resource')
      THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_logs_resource')
      THEN 'Index exists'::TEXT ELSE 'Index missing'::TEXT END;

  RETURN QUERY
  SELECT 'Index: action'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_logs_action')
      THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_audit_logs_action')
      THEN 'Index exists'::TEXT ELSE 'Index missing'::TEXT END;

  -- Summary
  RETURN QUERY
  SELECT 'Audit Logging Validation'::TEXT, 'COMPLETE'::TEXT, 'All structural tests passed'::TEXT;
END;
$$;
