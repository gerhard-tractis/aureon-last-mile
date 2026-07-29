-- Local development seed.
--
-- Runs only on `supabase db reset` (see [db.seed] in config.toml). It never
-- touches production — `supabase db push` does not execute this file.
--
-- config.toml has pointed at ./seed.sql for a long time while the file did not
-- exist, which was one half of why a local reset could not complete. Keep this
-- minimal and idempotent: enough to log in and see the app, nothing more.
--
-- Note: 20260616000002_spec45_internal_operator_seed.sql already seeds the
-- internal Tractis operator as part of the migration chain. This adds a second,
-- clearly-fake tenant so cross-operator isolation is testable locally.

INSERT INTO public.operators (id, name, slug, country_code, is_active, settings)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Demo Chile (local dev)',
  'demo-chile',
  'CL',
  TRUE,
  '{
    "branding": {
      "company_name": "Demo Chile",
      "logo_url": null,
      "favicon_url": null,
      "primary_color": null,
      "secondary_color": null
    }
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- A second tenant. Its only job is to make tenant-isolation bugs visible in
-- local testing: any query that leaks across operators will surface here.
INSERT INTO public.operators (id, name, slug, country_code, is_active, settings)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Demo Norte (local dev, isolation test tenant)',
  'demo-norte',
  'CL',
  TRUE,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
