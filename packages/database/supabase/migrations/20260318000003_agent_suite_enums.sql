-- =============================================================================
-- Migration: 20260318000003_agent_suite_enums.sql
-- Description: Agent Suite — all ENUM type definitions
--   - 13 enum types from agents-data-model.sql
--   - 2 additions to existing enums (mobile_camera, needs_review)
--   - 2 new enums from spec-10b (exception_category_enum, command_status_enum)
-- =============================================================================


-- ============================================================================
-- ENUM TYPES (from agents-data-model.sql)
-- ============================================================================

-- Generator intake methods
DO $$ BEGIN
  CREATE TYPE intake_method_enum AS ENUM (
    'email',        -- Email with CSV/PDF attachment
    'whatsapp',     -- WhatsApp message/photo
    'portal',       -- Self-service upload portal
    'api',          -- REST API / webhook
    'manual'        -- Operator manual entry
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE intake_method_enum IS 'How a generator/client sends orders to the operator';

-- Intake submission processing status
DO $$ BEGIN
  CREATE TYPE intake_status_enum AS ENUM (
    'received',     -- Raw payload captured
    'parsing',      -- OCR/CSV/NLP parsing in progress
    'parsed',       -- Successfully parsed, orders extracted
    'confirmed',    -- Operator confirmed extracted orders
    'failed',       -- Parsing or validation failed
    'rejected'      -- Operator rejected submission
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE intake_status_enum IS 'Intake submission processing lifecycle';

-- Driver fleet type
DO $$ BEGIN
  CREATE TYPE fleet_type_enum AS ENUM (
    'own',          -- Operator-employed driver (fixed schedule, salary)
    'external'      -- Freelance/contracted driver (per-job, negotiated)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE fleet_type_enum IS 'Own fleet vs external/freelance driver distinction';

-- Driver status
DO $$ BEGIN
  CREATE TYPE driver_status_enum AS ENUM (
    'active',       -- Available for assignments
    'inactive',     -- Temporarily unavailable (vacation, sick)
    'suspended',    -- Suspended due to performance/compliance
    'terminated'    -- No longer with operator (soft delete equivalent)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE driver_status_enum IS 'Driver lifecycle status';

-- Assignment states — unified state machine for own + external
DO $$ BEGIN
  CREATE TYPE assignment_status_enum AS ENUM (
    -- Common states
    'pending',          -- Created, awaiting driver action
    -- External-only states
    'offered',          -- Offer sent to external driver via WhatsApp
    'negotiating',      -- Driver counter-offered, negotiation in progress
    'rejected',         -- Driver rejected the assignment
    'expired',          -- Offer expired without response
    -- Common post-acceptance states
    'accepted',         -- Driver accepted
    'pickup_pending',   -- En route to pickup point
    'picked_up',        -- Cargo collected from generator
    'in_transit',       -- Delivering
    'delivered',        -- All deliveries completed
    'partially_done',   -- Some deliveries completed, some failed
    'failed',           -- Assignment failed entirely
    -- Settlement
    'settled',          -- Payment reconciled
    -- Cancellation
    'cancelled'         -- Cancelled by operator or system
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE assignment_status_enum IS 'Assignment state machine. Own drivers skip offered/negotiating/rejected/expired states.';

-- Conversation channel
DO $$ BEGIN
  CREATE TYPE conversation_channel_enum AS ENUM (
    'whatsapp',     -- WhatsApp Business API
    'sms',          -- SMS fallback
    'portal'        -- In-app messaging (future)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE conversation_channel_enum IS 'Communication channel for conversations';

-- Conversation participant type
DO $$ BEGIN
  CREATE TYPE participant_type_enum AS ENUM (
    'driver',       -- Driver coordination conversations
    'client',       -- WISMO / client-facing conversations
    'generator'     -- Generator/retailer communication
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE participant_type_enum IS 'Who the operator is talking to in this conversation';

-- Message direction
DO $$ BEGIN
  CREATE TYPE message_direction_enum AS ENUM (
    'inbound',      -- From participant to operator/agent
    'outbound'      -- From operator/agent to participant
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE message_direction_enum IS 'Message direction relative to the operator';

-- Message sender type
DO $$ BEGIN
  CREATE TYPE message_sender_enum AS ENUM (
    'agent',        -- AI agent sent this message
    'human',        -- Human operator sent this message
    'participant',  -- External participant (driver/client) sent this
    'system'        -- System-generated (template, notification)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE message_sender_enum IS 'Who authored this message';

-- WISMO notification type
DO $$ BEGIN
  CREATE TYPE wismo_type_enum AS ENUM (
    'proactive_eta',        -- Proactive ETA notification
    'proactive_dispatched', -- "Your order is on its way"
    'proactive_delivered',  -- "Your order was delivered"
    'proactive_failed',     -- "Delivery attempt failed"
    'proactive_rescheduled',-- "Your delivery has been rescheduled"
    'reactive_status',      -- Client asked "where is my order?"
    'reactive_reschedule',  -- Client requested reschedule
    'reactive_cancel',      -- Client requested cancellation
    'reactive_other'        -- Other client-initiated inquiry
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE wismo_type_enum IS 'WISMO notification classification (proactive vs reactive)';

-- WISMO delivery status
DO $$ BEGIN
  CREATE TYPE wismo_delivery_status_enum AS ENUM (
    'pending',      -- Notification queued
    'sent',         -- Sent to channel
    'delivered',    -- Confirmed delivered to device
    'read',         -- Read receipt received
    'failed'        -- Delivery failed
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE wismo_delivery_status_enum IS 'Notification delivery lifecycle';

-- Settlement period status
DO $$ BEGIN
  CREATE TYPE settlement_status_enum AS ENUM (
    'open',           -- Accumulating line items during the day
    'calculating',    -- End-of-day calculation in progress
    'pending_review', -- Awaiting human review
    'approved',       -- Approved by operations manager
    'paid',           -- Payment issued to driver
    'disputed'        -- Driver or operator disputed amounts
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE settlement_status_enum IS 'End-of-day settlement lifecycle';

-- Driver pay model
DO $$ BEGIN
  CREATE TYPE pay_model_enum AS ENUM (
    'per_delivery',   -- Paid per successful delivery
    'per_km',         -- Paid per kilometer driven
    'fixed_daily',    -- Fixed daily rate
    'per_package',    -- Paid per package delivered
    'hybrid'          -- Combination (base + per-delivery bonus)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE pay_model_enum IS 'Driver compensation model';

-- Exception severity
DO $$ BEGIN
  CREATE TYPE exception_severity_enum AS ENUM (
    'low',          -- Informational, auto-resolved
    'medium',       -- Requires attention but not urgent
    'high',         -- Urgent, needs prompt resolution
    'critical'      -- Immediate action required, SLA breach risk
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE exception_severity_enum IS '4-level exception severity for escalation routing';

-- Exception status
DO $$ BEGIN
  CREATE TYPE exception_status_enum AS ENUM (
    'open',             -- Detected, not yet addressed
    'auto_resolving',   -- Agent attempting auto-resolution
    'auto_resolved',    -- Agent successfully resolved
    'escalated',        -- Escalated to human
    'human_resolved',   -- Human resolved
    'dismissed'         -- False positive or no action needed
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE exception_status_enum IS 'Exception resolution lifecycle';

-- Agent event actor type
DO $$ BEGIN
  CREATE TYPE actor_type_enum AS ENUM (
    'agent',        -- AI agent
    'human',        -- Human operator
    'driver',       -- Driver action (via WhatsApp)
    'client',       -- Client action (via WISMO)
    'system',       -- System/cron/scheduler
    'webhook'       -- External webhook
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON TYPE actor_type_enum IS 'Who or what triggered this event';


-- ============================================================================
-- ENUM ADDITIONS from spec-10b (additions to existing enums + 2 new enums)
-- ============================================================================

-- Add mobile_camera to existing intake_method_enum
ALTER TYPE intake_method_enum ADD VALUE IF NOT EXISTS 'mobile_camera';

-- Add needs_review to existing intake_status_enum (between parsed and confirmed)
ALTER TYPE intake_status_enum ADD VALUE IF NOT EXISTS 'needs_review' BEFORE 'confirmed';

-- New: exception_category_enum
DO $$ BEGIN
  CREATE TYPE exception_category_enum AS ENUM (
    'late_delivery', 'driver_no_show', 'missing_pod', 'wrong_address',
    'data_quality', 'customer_complaint', 'safety_incident',
    'duplicate_submission', 'amount_mismatch', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- New: command_status_enum
DO $$ BEGIN
  CREATE TYPE command_status_enum AS ENUM ('pending', 'processed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
