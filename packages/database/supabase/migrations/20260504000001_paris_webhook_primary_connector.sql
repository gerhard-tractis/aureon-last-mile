-- Migration: Update Paris tenant_client connector_type to reflect webhook as primary
-- Date: 2026-05-04
--
-- Paris DispatchTrack now sends real-time webhooks as the primary data source.
-- Switches connector_type from 'browser' to 'api' to reflect the actual primary integration.
-- Browser scraping (beetrack-excel-import workflow) remains available as a fallback.

UPDATE public.tenant_clients
SET connector_type = 'api',
    connector_config = jsonb_build_object(
      'dispatchtrack_url', 'https://paris.dispatchtrack.com',
      'webhook_url', 'https://n8n.tractis.ai/webhook/paris-dispatchtrack',
      'report_email_to', 'contacto@transportesmusan.com'
    ),
    updated_at = NOW()
WHERE slug = 'paris'
  AND is_active = true;
