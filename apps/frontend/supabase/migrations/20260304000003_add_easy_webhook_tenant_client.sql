-- Migration: Add Easy WMS Webhook tenant_client row for Story 3A.7
-- Created: 2026-03-04
-- Story: 3A.7 - Implement Easy WMS Webhook Receiver
-- Purpose: Add easy-webhook connector row so n8n workflow can reference tenant_client_id
--          and jobs table can track ingestion runs.
-- Note: easy-webhook is a separate row from 'easy' (csv_email). Both remain active.
--       easy-webhook = primary (real-time, full carton data)
--       easy (csv_email) = fallback (daily email, no package-level data)

DO $$
DECLARE
  v_musan_operator_id UUID;
BEGIN
  SELECT id INTO v_musan_operator_id
  FROM public.operators
  WHERE slug = 'transportes-musan';

  IF v_musan_operator_id IS NULL THEN
    RAISE EXCEPTION 'Migration failed: Transportes Musan operator not found. Run 20260223000001 first.';
  END IF;

  INSERT INTO public.tenant_clients (operator_id, name, slug, connector_type, connector_config)
  VALUES (
    v_musan_operator_id,
    'Easy WMS Webhook (Cencosud)',
    'easy-webhook',
    'api',
    '{
      "webhook_api_key": "ENCRYPTED:easy_wms_webhook_api_key",
      "staging_url": "https://n8n.tractis.ai/webhook-test/easy-wms",
      "production_url": "https://n8n.tractis.ai/webhook/easy-wms",
      "source": "Easy WMS (Cencosud) — direct dispatch webhook",
      "contact": "cesar.cancino@cencosud.cl"
    }'::jsonb
  )
  ON CONFLICT (operator_id, slug) DO NOTHING;

  RAISE NOTICE 'easy-webhook tenant_client inserted (or already existed) for operator %', v_musan_operator_id;
END $$;
