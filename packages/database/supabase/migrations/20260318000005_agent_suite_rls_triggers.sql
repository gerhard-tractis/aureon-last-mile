-- =============================================================================
-- Migration: 20260318000005_agent_suite_rls_triggers.sql
-- Description: Agent Suite — RLS policies, updated_at triggers, audit triggers
--
-- RLS applied to all tables (both mutable and immutable, with differing policies)
-- updated_at trigger applied to tables WITH updated_at column:
--   generators, intake_submissions, drivers, driver_availabilities, assignments,
--   conversations, wismo_notifications, settlement_periods, settlement_line_items,
--   settlement_documents, exceptions, operator_config
-- audit trigger applied to all mutable tables (NOT agent_events, agent_tool_calls,
--   conversation_messages which are immutable/append-only):
--   generators, intake_submissions, drivers, driver_availabilities, assignments,
--   conversations, wismo_notifications, settlement_periods, settlement_line_items,
--   settlement_documents, exceptions, operator_config, agent_commands
-- =============================================================================


-- ============================================================================
-- set_updated_at FUNCTION (idempotent)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;


-- ============================================================================
-- RLS POLICIES
-- Pattern per mutable table:
--   1. Enable RLS
--   2. service_role bypass policy (agent process writes)
--   3. authenticated read-own-operator-data policy
--
-- For immutable tables (agent_events, agent_tool_calls, conversation_messages):
--   1. Enable RLS
--   2. service_role bypass
--   3. authenticated read-own-operator-data only (no write policy for authenticated)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- generators
-- ----------------------------------------------------------------------------
ALTER TABLE public.generators ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "generators_service_role" ON public.generators
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "generators_authenticated_read" ON public.generators
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.generators TO authenticated;
REVOKE ALL ON public.generators FROM anon;
GRANT ALL ON public.generators TO service_role;

-- ----------------------------------------------------------------------------
-- intake_submissions
-- ----------------------------------------------------------------------------
ALTER TABLE public.intake_submissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "intake_submissions_service_role" ON public.intake_submissions
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "intake_submissions_authenticated_read" ON public.intake_submissions
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.intake_submissions TO authenticated;
REVOKE ALL ON public.intake_submissions FROM anon;
GRANT ALL ON public.intake_submissions TO service_role;

-- ----------------------------------------------------------------------------
-- drivers
-- ----------------------------------------------------------------------------
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "drivers_service_role" ON public.drivers
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "drivers_authenticated_read" ON public.drivers
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drivers TO authenticated;
REVOKE ALL ON public.drivers FROM anon;
GRANT ALL ON public.drivers TO service_role;

-- ----------------------------------------------------------------------------
-- driver_availabilities
-- ----------------------------------------------------------------------------
ALTER TABLE public.driver_availabilities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "driver_availabilities_service_role" ON public.driver_availabilities
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "driver_availabilities_authenticated_read" ON public.driver_availabilities
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_availabilities TO authenticated;
REVOKE ALL ON public.driver_availabilities FROM anon;
GRANT ALL ON public.driver_availabilities TO service_role;

-- ----------------------------------------------------------------------------
-- assignments
-- ----------------------------------------------------------------------------
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "assignments_service_role" ON public.assignments
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "assignments_authenticated_read" ON public.assignments
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments TO authenticated;
REVOKE ALL ON public.assignments FROM anon;
GRANT ALL ON public.assignments TO service_role;

-- ----------------------------------------------------------------------------
-- conversations
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "conversations_service_role" ON public.conversations
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "conversations_authenticated_read" ON public.conversations
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
REVOKE ALL ON public.conversations FROM anon;
GRANT ALL ON public.conversations TO service_role;

-- ----------------------------------------------------------------------------
-- conversation_messages (immutable — no write policy for authenticated)
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "conversation_messages_service_role" ON public.conversation_messages
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "conversation_messages_authenticated_read" ON public.conversation_messages
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON public.conversation_messages TO authenticated;
GRANT INSERT ON public.conversation_messages TO authenticated;
REVOKE ALL ON public.conversation_messages FROM anon;
GRANT ALL ON public.conversation_messages TO service_role;

-- ----------------------------------------------------------------------------
-- wismo_notifications
-- ----------------------------------------------------------------------------
ALTER TABLE public.wismo_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "wismo_notifications_service_role" ON public.wismo_notifications
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "wismo_notifications_authenticated_read" ON public.wismo_notifications
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wismo_notifications TO authenticated;
REVOKE ALL ON public.wismo_notifications FROM anon;
GRANT ALL ON public.wismo_notifications TO service_role;

-- ----------------------------------------------------------------------------
-- settlement_periods
-- ----------------------------------------------------------------------------
ALTER TABLE public.settlement_periods ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "settlement_periods_service_role" ON public.settlement_periods
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "settlement_periods_authenticated_read" ON public.settlement_periods
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.settlement_periods TO authenticated;
REVOKE ALL ON public.settlement_periods FROM anon;
GRANT ALL ON public.settlement_periods TO service_role;

-- ----------------------------------------------------------------------------
-- settlement_line_items
-- ----------------------------------------------------------------------------
ALTER TABLE public.settlement_line_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "settlement_line_items_service_role" ON public.settlement_line_items
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "settlement_line_items_authenticated_read" ON public.settlement_line_items
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.settlement_line_items TO authenticated;
REVOKE ALL ON public.settlement_line_items FROM anon;
GRANT ALL ON public.settlement_line_items TO service_role;

-- ----------------------------------------------------------------------------
-- settlement_documents
-- ----------------------------------------------------------------------------
ALTER TABLE public.settlement_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "settlement_documents_service_role" ON public.settlement_documents
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "settlement_documents_authenticated_read" ON public.settlement_documents
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.settlement_documents TO authenticated;
REVOKE ALL ON public.settlement_documents FROM anon;
GRANT ALL ON public.settlement_documents TO service_role;

-- ----------------------------------------------------------------------------
-- exceptions
-- ----------------------------------------------------------------------------
ALTER TABLE public.exceptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "exceptions_service_role" ON public.exceptions
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "exceptions_authenticated_read" ON public.exceptions
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exceptions TO authenticated;
REVOKE ALL ON public.exceptions FROM anon;
GRANT ALL ON public.exceptions TO service_role;

-- ----------------------------------------------------------------------------
-- agent_events (immutable — service_role writes, authenticated reads only)
-- ----------------------------------------------------------------------------
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "agent_events_service_role" ON public.agent_events
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "agent_events_authenticated_read" ON public.agent_events
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON public.agent_events TO authenticated;
GRANT INSERT ON public.agent_events TO authenticated;
REVOKE ALL ON public.agent_events FROM anon;
GRANT ALL ON public.agent_events TO service_role;

-- ----------------------------------------------------------------------------
-- agent_tool_calls (immutable — same pattern as agent_events)
-- ----------------------------------------------------------------------------
ALTER TABLE public.agent_tool_calls ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "agent_tool_calls_service_role" ON public.agent_tool_calls
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "agent_tool_calls_authenticated_read" ON public.agent_tool_calls
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON public.agent_tool_calls TO authenticated;
GRANT INSERT ON public.agent_tool_calls TO authenticated;
REVOKE ALL ON public.agent_tool_calls FROM anon;
GRANT ALL ON public.agent_tool_calls TO service_role;

-- ----------------------------------------------------------------------------
-- operator_config
-- ----------------------------------------------------------------------------
ALTER TABLE public.operator_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "operator_config_service_role" ON public.operator_config
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "operator_config_authenticated_read" ON public.operator_config
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_config TO authenticated;
REVOKE ALL ON public.operator_config FROM anon;
GRANT ALL ON public.operator_config TO service_role;

-- ----------------------------------------------------------------------------
-- agent_commands
-- ----------------------------------------------------------------------------
ALTER TABLE public.agent_commands ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "agent_commands_service_role" ON public.agent_commands
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "agent_commands_authenticated_read" ON public.agent_commands
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE auth_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_commands TO authenticated;
REVOKE ALL ON public.agent_commands FROM anon;
GRANT ALL ON public.agent_commands TO service_role;


-- ============================================================================
-- updated_at TRIGGERS
-- Tables with updated_at column: generators, intake_submissions, drivers,
--   driver_availabilities, assignments, conversations, wismo_notifications,
--   settlement_periods, settlement_line_items, settlement_documents,
--   exceptions, operator_config
-- NOT applied to: agent_events, agent_tool_calls, conversation_messages,
--   agent_commands (no updated_at column — immutable/append-only)
-- ============================================================================

DROP TRIGGER IF EXISTS set_updated_at_generators ON public.generators;
CREATE TRIGGER set_updated_at_generators
  BEFORE UPDATE ON public.generators
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_intake_submissions ON public.intake_submissions;
CREATE TRIGGER set_updated_at_intake_submissions
  BEFORE UPDATE ON public.intake_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_drivers ON public.drivers;
CREATE TRIGGER set_updated_at_drivers
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_driver_availabilities ON public.driver_availabilities;
CREATE TRIGGER set_updated_at_driver_availabilities
  BEFORE UPDATE ON public.driver_availabilities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_assignments ON public.assignments;
CREATE TRIGGER set_updated_at_assignments
  BEFORE UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_conversations ON public.conversations;
CREATE TRIGGER set_updated_at_conversations
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- NOTE: conversation_messages has NO updated_at (immutable)

DROP TRIGGER IF EXISTS set_updated_at_wismo_notifications ON public.wismo_notifications;
CREATE TRIGGER set_updated_at_wismo_notifications
  BEFORE UPDATE ON public.wismo_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_settlement_periods ON public.settlement_periods;
CREATE TRIGGER set_updated_at_settlement_periods
  BEFORE UPDATE ON public.settlement_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_settlement_line_items ON public.settlement_line_items;
CREATE TRIGGER set_updated_at_settlement_line_items
  BEFORE UPDATE ON public.settlement_line_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_settlement_documents ON public.settlement_documents;
CREATE TRIGGER set_updated_at_settlement_documents
  BEFORE UPDATE ON public.settlement_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_exceptions ON public.exceptions;
CREATE TRIGGER set_updated_at_exceptions
  BEFORE UPDATE ON public.exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_operator_config ON public.operator_config;
CREATE TRIGGER set_updated_at_operator_config
  BEFORE UPDATE ON public.operator_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- NOTE: agent_events has NO updated_at (immutable)
-- NOTE: agent_tool_calls has NO updated_at (immutable)
-- NOTE: agent_commands has NO updated_at (append-only)


-- ============================================================================
-- AUDIT TRIGGERS
-- audit_trigger_func() already exists — only creating triggers here.
-- Applied to all mutable tables EXCEPT agent_events, agent_tool_calls,
--   conversation_messages (immutable/append-only).
-- ============================================================================

DO $$ BEGIN
  CREATE TRIGGER audit_generators
    AFTER INSERT OR UPDATE OR DELETE ON public.generators
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_intake_submissions
    AFTER INSERT OR UPDATE OR DELETE ON public.intake_submissions
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_drivers
    AFTER INSERT OR UPDATE OR DELETE ON public.drivers
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_driver_availabilities
    AFTER INSERT OR UPDATE OR DELETE ON public.driver_availabilities
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_assignments
    AFTER INSERT OR UPDATE OR DELETE ON public.assignments
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_conversations
    AFTER INSERT OR UPDATE OR DELETE ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_wismo_notifications
    AFTER INSERT OR UPDATE OR DELETE ON public.wismo_notifications
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_settlement_periods
    AFTER INSERT OR UPDATE OR DELETE ON public.settlement_periods
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_settlement_line_items
    AFTER INSERT OR UPDATE OR DELETE ON public.settlement_line_items
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_settlement_documents
    AFTER INSERT OR UPDATE OR DELETE ON public.settlement_documents
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_exceptions
    AFTER INSERT OR UPDATE OR DELETE ON public.exceptions
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_operator_config
    AFTER INSERT OR UPDATE OR DELETE ON public.operator_config
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_agent_commands
    AFTER INSERT OR UPDATE OR DELETE ON public.agent_commands
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
