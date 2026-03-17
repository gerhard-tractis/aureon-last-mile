-- Migration: Merge easy-webhook into easy, clean up tenant_client names
-- Date: 2026-03-17
--
-- easy-webhook (api/webhook) and easy (csv_email) represent the same customer (Cencosud/Easy).
-- Both n8n workflows (Easy CSV Email Import + Easy WMS Webhook Receiver) write to the same
-- orders/packages tables. Consolidate to a single tenant_client row.
--
-- Changes:
--   1. Migrate the 1 order linked to easy-webhook → easy
--   2. Deactivate easy-webhook (replaced by easy)
--   3. Remove parenthetical suffixes from tenant_client names for display clarity

-- 1. Migrate orders from easy-webhook to easy
UPDATE public.orders
SET tenant_client_id = 'acf3d096-1ff6-4157-9b69-cab6e6a5789f'  -- Easy (slug: easy)
WHERE tenant_client_id = 'ea9cf587-a031-4e71-b872-c5829f0536f3'; -- Easy WMS Webhook (slug: easy-webhook)

-- 2. Deactivate easy-webhook — n8n workflow updated to use easy's tenant_client_id
UPDATE public.tenant_clients
SET is_active = false,
    updated_at = NOW()
WHERE slug = 'easy-webhook';

-- 3. Clean up display names
UPDATE public.tenant_clients SET name = 'Easy',  updated_at = NOW() WHERE slug = 'easy';
UPDATE public.tenant_clients SET name = 'Paris', updated_at = NOW() WHERE slug = 'paris';
