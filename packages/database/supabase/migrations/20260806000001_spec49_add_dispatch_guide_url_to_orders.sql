-- Migration: spec-49 — orders.dispatch_guide_url + null-overwrite guard
--
-- Easy (Cencosud) posts a per-despacho `url_guia` — the only URL that prints
-- the dispatch guide. It must be stored on public.orders exactly as
-- received. The mapping always sends `dispatch_guide_url` (null when the
-- retailer omits it, per PostgREST's uniform-keys requirement for bulk
-- upserts), so a webhook re-delivery without url_guia would otherwise wipe a
-- previously stored URL. A BEFORE UPDATE trigger preserves the old value
-- whenever the incoming one is null.
--
-- Accepted trade-off (docs/specs/spec-49-easy-webhook-dispatch-guide-url.md
-- Design §1): the trigger is table-wide — no client can clear a stored URL
-- back to null via a normal UPDATE. Deliberate clearing requires a direct
-- SQL path.
--
-- No index (never filtered on, only read per-order). No RLS change — the
-- column inherits the existing operator-scoped policies on public.orders.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dispatch_guide_url TEXT;

COMMENT ON COLUMN public.orders.dispatch_guide_url IS
  'Retailer-provided URL to the printable dispatch guide PDF (e.g. Easy url_guia). Stored verbatim as received — never normalized, trimmed, or re-encoded.';

CREATE OR REPLACE FUNCTION public.preserve_dispatch_guide_url()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.dispatch_guide_url := COALESCE(NEW.dispatch_guide_url, OLD.dispatch_guide_url);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.preserve_dispatch_guide_url IS
  'BEFORE UPDATE guard on public.orders: an incoming NULL dispatch_guide_url never overwrites a previously stored value (spec-49). A non-null incoming value still overwrites normally.';

DROP TRIGGER IF EXISTS trg_preserve_dispatch_guide_url ON public.orders;
CREATE TRIGGER trg_preserve_dispatch_guide_url
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.preserve_dispatch_guide_url();

-- ============================================================================
-- Validation
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'orders'
       AND column_name = 'dispatch_guide_url'
       AND data_type = 'text'
       AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'public.orders.dispatch_guide_url missing or has the wrong shape after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_preserve_dispatch_guide_url'
       AND tgrelid = 'public.orders'::regclass
  ) THEN
    RAISE EXCEPTION 'trg_preserve_dispatch_guide_url trigger missing on public.orders';
  END IF;
END $$;
