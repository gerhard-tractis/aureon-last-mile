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

-- 4. Seed Musan operator with branding config
UPDATE public.operators
SET settings = jsonb_set(
  COALESCE(settings, '{}'::jsonb),
  '{branding}',
  '{
    "company_name": "Transportes Musan",
    "logo_url": "https://transportesmusan.com/wp-content/uploads/2022/03/logo-1.png",
    "favicon_url": "https://transportesmusan.com/wp-content/uploads/2022/03/cropped-png-32x32.png",
    "primary_color": "#001269",
    "secondary_color": "#001a99"
  }'::jsonb
)
WHERE id = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';
