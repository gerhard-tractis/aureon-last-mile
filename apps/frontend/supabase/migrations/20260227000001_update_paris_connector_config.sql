-- Migration: Update Paris/DispatchTrack connector_config for Story 2.6
-- Switches from login-based to cookie-based session auth
-- Cookies are encrypted with AES-256-GCM via worker's ENCRYPTION_KEY
-- session_cookie + remember_token must be set manually after first login

UPDATE public.tenant_clients
SET connector_config = jsonb_build_object(
  'dispatchtrack_url', 'https://paris.dispatchtrack.com',
  'session_cookie', '',
  'remember_token', '',
  'report_email_to', 'contacto@transportesmusan.com'
),
updated_at = NOW()
WHERE slug = 'paris'
  AND connector_type = 'browser'
  AND operator_id = (SELECT id FROM public.operators WHERE slug = 'transportes-musan');
