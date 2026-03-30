-- =============================================================================
-- Migration: 20260330000001_spec24_customer_communication.sql
-- Description: Spec-24 — Customer Communication Agent (WISMO Expanded)
--   Table order:
--   1. orders            — 3 nullable reschedule columns
--   2. customer_sessions — one session per order (customer context)
--   3. customer_session_messages — per-message conversational record
--   4. order_reschedules — append-only audit log (FK to customer_session_messages)
--   5. wismo_type_enum   — 2 new values
--   6. trigger           — sync denormalised reschedule fields on orders
--   7. RLS + updated_at triggers for new tables
-- =============================================================================

-- ============================================================================
-- 1. EXTEND orders
-- ============================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rescheduled_delivery_date  DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_window_start   TIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_window_end     TIME DEFAULT NULL;

COMMENT ON COLUMN public.orders.rescheduled_delivery_date IS
  'Latest customer-requested delivery date. NULL = no reschedule. Updated by order_reschedules trigger.';
COMMENT ON COLUMN public.orders.rescheduled_window_start IS
  'Latest customer-requested window start. NULL = no time reschedule.';
COMMENT ON COLUMN public.orders.rescheduled_window_end IS
  'Latest customer-requested window end. NULL = no time reschedule.';

-- ============================================================================
-- 2. CREATE customer_sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customer_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID NOT NULL REFERENCES public.operators(id),
  order_id          UUID NOT NULL REFERENCES public.orders(id),

  customer_phone    VARCHAR(20) NOT NULL,
  customer_name     VARCHAR(255),

  status            VARCHAR(20) NOT NULL DEFAULT 'active',
  escalated_at      TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,

  CONSTRAINT uq_active_session_per_order
    UNIQUE (operator_id, order_id)
    WHERE deleted_at IS NULL,
  CONSTRAINT chk_session_status
    CHECK (status IN ('active', 'closed', 'escalated')),
  CONSTRAINT chk_session_escalated_at
    CHECK (status != 'escalated' OR escalated_at IS NOT NULL),
  CONSTRAINT chk_session_closed_at
    CHECK (status != 'closed' OR closed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_operator ON public.customer_sessions(operator_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_order    ON public.customer_sessions(order_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_phone    ON public.customer_sessions(operator_id, customer_phone)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.customer_sessions IS
  'One session per active order. Agent conversational memory for customer-facing WISMO interactions.';

-- ============================================================================
-- 3. CREATE customer_session_messages
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customer_session_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id),
  session_id          UUID NOT NULL REFERENCES public.customer_sessions(id),

  role                VARCHAR(10) NOT NULL,
  body                TEXT NOT NULL,

  -- WhatsApp delivery tracking
  external_message_id VARCHAR(255),
  wa_status           VARCHAR(20),
  wa_status_at        TIMESTAMPTZ,

  -- Media
  media_url           TEXT,
  media_type          VARCHAR(50),

  -- Agent metadata (system messages only)
  template_name       VARCHAR(100),
  action_taken        VARCHAR(100),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT chk_session_message_role CHECK (role IN ('user', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_session_messages_session  ON public.customer_session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_session_messages_operator ON public.customer_session_messages(operator_id);

COMMENT ON TABLE public.customer_session_messages IS
  'Conversational record for agent memory. Inbound customer messages and outbound agent messages per session.';

-- ============================================================================
-- 4. CREATE order_reschedules
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_reschedules (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id               UUID NOT NULL REFERENCES public.operators(id),
  order_id                  UUID NOT NULL REFERENCES public.orders(id),

  -- What the customer requested (only changed fields are set)
  requested_date            DATE,
  requested_window_start    TIME,
  requested_window_end      TIME,
  requested_address         TEXT,

  -- Why
  reason                    VARCHAR(50) NOT NULL,
  customer_note             TEXT,

  -- Traceability
  session_message_id        UUID REFERENCES public.customer_session_messages(id) ON DELETE SET NULL,
  triggered_by              VARCHAR(50) NOT NULL DEFAULT 'wismo_agent',

  -- Operator lifecycle
  status                    VARCHAR(20) NOT NULL DEFAULT 'pending',
  operator_notes            TEXT,
  acknowledged_at           TIMESTAMPTZ,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ,

  CONSTRAINT chk_reschedule_status CHECK (status IN ('pending', 'acknowledged', 'applied', 'rejected')),
  CONSTRAINT chk_reschedule_reason CHECK (reason IN ('not_home', 'time_preference', 'address_change', 'early_delivery', 'other')),
  CONSTRAINT chk_reschedule_has_change CHECK (
    requested_date IS NOT NULL OR
    requested_window_start IS NOT NULL OR
    requested_address IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_reschedules_operator ON public.order_reschedules(operator_id);
CREATE INDEX IF NOT EXISTS idx_reschedules_order    ON public.order_reschedules(order_id);
CREATE INDEX IF NOT EXISTS idx_reschedules_pending  ON public.order_reschedules(operator_id)
  WHERE deleted_at IS NULL AND status = 'pending';

COMMENT ON TABLE public.order_reschedules IS
  'Append-only audit log of every customer reschedule request. orders.rescheduled_* are denormalised copies.';

-- ============================================================================
-- 5. EXTEND wismo_type_enum
-- ============================================================================
ALTER TYPE public.wismo_type_enum ADD VALUE IF NOT EXISTS 'proactive_early_arrival';
ALTER TYPE public.wismo_type_enum ADD VALUE IF NOT EXISTS 'proactive_pickup_confirmed';

-- ============================================================================
-- 6. INSERT TRIGGER — sync denormalised reschedule fields on orders
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sync_order_reschedule_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.orders
  SET
    rescheduled_delivery_date = CASE
      WHEN NEW.requested_date IS NOT NULL THEN NEW.requested_date
      ELSE rescheduled_delivery_date
    END,
    rescheduled_window_start = CASE
      WHEN NEW.requested_window_start IS NOT NULL THEN NEW.requested_window_start
      ELSE rescheduled_window_start
    END,
    rescheduled_window_end = CASE
      WHEN NEW.requested_window_end IS NOT NULL THEN NEW.requested_window_end
      ELSE rescheduled_window_end
    END
  WHERE id = NEW.order_id AND operator_id = NEW.operator_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_reschedule_fields ON public.order_reschedules;
CREATE TRIGGER trg_sync_order_reschedule_fields
  AFTER INSERT ON public.order_reschedules
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_reschedule_fields();

-- ============================================================================
-- 7a. RLS — customer_sessions
-- ============================================================================
ALTER TABLE public.customer_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "customer_sessions_service_role" ON public.customer_sessions
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "customer_sessions_authenticated_read" ON public.customer_sessions
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_sessions TO authenticated;
REVOKE ALL ON public.customer_sessions FROM anon;
GRANT ALL ON public.customer_sessions TO service_role;

-- ============================================================================
-- 7b. RLS — customer_session_messages
-- ============================================================================
ALTER TABLE public.customer_session_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "customer_session_messages_service_role" ON public.customer_session_messages
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "customer_session_messages_authenticated_read" ON public.customer_session_messages
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_session_messages TO authenticated;
REVOKE ALL ON public.customer_session_messages FROM anon;
GRANT ALL ON public.customer_session_messages TO service_role;

-- ============================================================================
-- 7c. RLS — order_reschedules
-- ============================================================================
ALTER TABLE public.order_reschedules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "order_reschedules_service_role" ON public.order_reschedules
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "order_reschedules_authenticated_read" ON public.order_reschedules
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_reschedules TO authenticated;
REVOKE ALL ON public.order_reschedules FROM anon;
GRANT ALL ON public.order_reschedules TO service_role;

-- ============================================================================
-- 7d. updated_at TRIGGERS — customer_sessions, order_reschedules
-- ============================================================================
DROP TRIGGER IF EXISTS set_updated_at_customer_sessions ON public.customer_sessions;
CREATE TRIGGER set_updated_at_customer_sessions
  BEFORE UPDATE ON public.customer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_order_reschedules ON public.order_reschedules;
CREATE TRIGGER set_updated_at_order_reschedules
  BEFORE UPDATE ON public.order_reschedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- NOTE: customer_session_messages is append-only — no updated_at column or trigger.
