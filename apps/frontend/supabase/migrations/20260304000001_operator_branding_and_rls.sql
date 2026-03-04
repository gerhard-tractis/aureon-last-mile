-- Migration: Operator branding schema documentation + RLS + Musan seed
-- Story: 3A.4 - Customer Branding Configuration on Dashboard

-- 1. Enable RLS on operators table
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

-- 2. SELECT policy: authenticated users can read their own operator row
CREATE POLICY "operators_read_own"
  ON public.operators
  FOR SELECT
  USING (
    id = (
      current_setting('request.jwt.claims', true)::jsonb
      -> 'claims' ->> 'operator_id'
    )::uuid
  );

-- 3. Document expected settings.branding JSONB shape
COMMENT ON COLUMN public.operators.settings IS
  'JSONB configuration. Expected shape includes:
  {
    "branding": {
      "logo_url": "string | null — External URL for sidebar logo",
      "favicon_url": "string | null — External URL (stored for future use)",
      "company_name": "string | null — Overrides product name in sidebar",
      "primary_color": "string | null — CSS hex color (#rrggbb) for primary theme",
      "secondary_color": "string | null — CSS hex color (#rrggbb) for secondary theme"
    }
  }';

-- 4. Seed Musan operator with initial branding config
UPDATE public.operators
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{branding}',
  '{
    "company_name": "Musan Logistics",
    "logo_url": null,
    "favicon_url": null,
    "primary_color": null,
    "secondary_color": null
  }'::jsonb
)
WHERE id = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';
