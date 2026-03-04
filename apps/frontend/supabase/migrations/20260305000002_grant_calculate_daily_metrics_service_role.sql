-- Grant EXECUTE on calculate_daily_metrics to service_role so n8n can trigger
-- a metrics refresh immediately after each XLSX import via PostgREST RPC.
-- The function is SECURITY DEFINER (runs as postgres) — safe to expose to service_role
-- since service_role is trusted server-side only and never exposed to end users.

GRANT EXECUTE ON FUNCTION public.calculate_daily_metrics(DATE) TO service_role;
