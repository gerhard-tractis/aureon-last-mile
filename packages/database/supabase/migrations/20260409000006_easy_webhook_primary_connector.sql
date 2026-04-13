-- Migration: Update Easy tenant_client connector_type to reflect webhook as primary
-- Date: 2026-04-09
--
-- Easy WMS now sends real-time webhooks as the primary data source.
-- The CSV email import remains as a daily fallback.
-- Update connector_type from 'csv_email' to 'api' to reflect the actual primary integration.

UPDATE public.tenant_clients
SET connector_type = 'api',
    updated_at = NOW()
WHERE slug = 'easy'
  AND is_active = true;
