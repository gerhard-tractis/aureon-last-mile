-- =============================================================================
-- Migration: 20260318000004_agent_suite_tables.sql
-- Description: Agent Suite — all table definitions
--   Tables from agents-data-model.sql (14 tables):
--     1.  generators
--     2.  intake_submissions
--     3.  drivers
--     4.  driver_availabilities
--     5.  assignments
--     6.  conversations
--     7.  conversation_messages
--     8.  wismo_notifications
--     9.  settlement_periods
--     10. settlement_line_items
--     11. settlement_documents
--     12. exceptions
--     13. agent_events
--     14. agent_tool_calls
--   ALTER TABLE extensions on existing orders table
--   2 additional tables from spec-10b:
--     15. operator_config
--     16. agent_commands
-- =============================================================================


-- ============================================================================
-- TABLE 1: generators
-- Bounded Context: Generators
-- Purpose: Cargo generator configuration — how each client sends orders.
--          Extends tenant_clients with agent-specific intake configuration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.generators (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  tenant_client_id    UUID NOT NULL REFERENCES public.tenant_clients(id) ON DELETE CASCADE,

  -- Identity
  name                VARCHAR(255) NOT NULL,   -- Display name (e.g., "Easy Maipú")
  code                VARCHAR(50) NOT NULL,     -- Short code for agents (e.g., "EASY-MAIPU")

  -- Intake configuration
  intake_method       intake_method_enum NOT NULL,
  -- JSONB config varies per intake_method:
  -- email:    {from_filter, subject_filter, attachment_types, csv_encoding, csv_delimiter, column_map}
  -- whatsapp: {phone_number, expected_format, ocr_enabled, glm_model}
  -- portal:   {upload_url, allowed_formats, max_file_size_mb}
  -- api:      {endpoint_url, auth_method, api_key_ref, payload_schema}
  -- manual:   {form_template, required_fields}
  intake_config       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Parsing rules (how to extract orders from raw payload)
  -- {field_mappings, validation_rules, default_values, transformation_functions}
  parsing_rules       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Default values applied to orders from this generator
  -- {comuna, delivery_window_start, delivery_window_end, service_type, cargo_type}
  order_defaults      JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Confirmation workflow
  -- {auto_confirm: bool, confirm_via: "whatsapp"|"email"|"portal", confirm_template_id}
  confirmation_config JSONB NOT NULL DEFAULT '{"auto_confirm": false}'::jsonb,

  -- SLA configuration
  -- {max_delivery_hours, pickup_cutoff_time, delivery_window, penalty_per_failure_clp}
  sla_config          JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Pickup location(s) for this generator
  -- [{name, address, comuna, lat, lng, contact_name, contact_phone, operating_hours}]
  pickup_locations    JSONB NOT NULL DEFAULT '[]'::jsonb,

  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT unique_generator_code_per_operator UNIQUE (operator_id, code)
);

COMMENT ON TABLE  public.generators IS 'Cargo generator configuration. Each generator defines how a specific client/location sends orders and the rules for processing them.';
COMMENT ON COLUMN public.generators.tenant_client_id IS 'FK to tenant_clients — the parent client. One client can have multiple generators (e.g., Easy Maipú, Easy Puente Alto).';
COMMENT ON COLUMN public.generators.intake_config IS 'JSONB intake configuration. Shape varies by intake_method. Credentials use ENCRYPTED: prefix.';
COMMENT ON COLUMN public.generators.parsing_rules IS 'JSONB rules for extracting structured orders from raw payloads. Used by intake agent.';
COMMENT ON COLUMN public.generators.order_defaults IS 'Default field values applied to orders when generator does not provide them.';
COMMENT ON COLUMN public.generators.sla_config IS 'Service level agreement parameters. Used by exception agent for SLA breach detection.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_generators_operator_id ON public.generators(operator_id);
CREATE INDEX IF NOT EXISTS idx_generators_tenant_client_id ON public.generators(tenant_client_id);
CREATE INDEX IF NOT EXISTS idx_generators_intake_method ON public.generators(operator_id, intake_method);
CREATE INDEX IF NOT EXISTS idx_generators_active ON public.generators(operator_id, is_active) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_generators_deleted_at ON public.generators(deleted_at);


-- ============================================================================
-- TABLE 2: intake_submissions
-- Bounded Context: Intake
-- Purpose: Track every inbound payload (email, WhatsApp photo, API call)
--          through parsing and confirmation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.intake_submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  generator_id        UUID NOT NULL REFERENCES public.generators(id) ON DELETE CASCADE,

  -- Source tracking
  channel             intake_method_enum NOT NULL,
  external_ref        VARCHAR(255),             -- Email message-id, WhatsApp message WAM ID, etc.

  -- Processing
  status              intake_status_enum NOT NULL DEFAULT 'received',
  raw_payload         JSONB NOT NULL,           -- Original payload (email body, image URL, API body)
  parsed_data         JSONB,                    -- Extracted structured data after parsing
  orders_extracted    INT DEFAULT 0,            -- How many orders were extracted
  orders_created      INT DEFAULT 0,            -- How many orders were actually created (after dedup)
  validation_errors   JSONB DEFAULT '[]'::jsonb,-- [{field, row, message}]

  -- Agent tracking
  processed_by_agent  VARCHAR(100),             -- Agent name that processed this (e.g., "intake-agent")
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  confirmed_by        UUID REFERENCES public.users(id), -- Human who confirmed (NULL if auto-confirmed)
  confirmed_at        TIMESTAMPTZ,

  -- Storage
  raw_file_url        TEXT,                     -- Supabase Storage URL for raw file/image
  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.intake_submissions IS 'Every inbound order payload tracked from receipt through parsing and confirmation. One submission may yield many orders.';
COMMENT ON COLUMN public.intake_submissions.raw_payload IS 'Original payload as received. Preserved for audit and re-processing.';
COMMENT ON COLUMN public.intake_submissions.parsed_data IS 'Structured data extracted by parsing agent. NULL until parsing completes.';
COMMENT ON COLUMN public.intake_submissions.validation_errors IS 'Array of validation issues found during parsing. Empty array = clean parse.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_intake_submissions_operator_id ON public.intake_submissions(operator_id);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_generator_id ON public.intake_submissions(generator_id);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_status ON public.intake_submissions(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_channel ON public.intake_submissions(operator_id, channel);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_created_at ON public.intake_submissions(operator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_deleted_at ON public.intake_submissions(deleted_at);


-- ============================================================================
-- EXTEND TABLE: orders
-- Bounded Context: Orders
-- Purpose: Add agent-suite columns to existing orders table.
-- ============================================================================

-- Generator FK (which generator produced this order)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS generator_id UUID REFERENCES public.generators(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.orders.generator_id IS 'FK to generators: which generator configuration produced this order. NULL for legacy/manual orders.';

-- Intake submission FK (which submission this order came from)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS intake_submission_id UUID REFERENCES public.intake_submissions(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.orders.intake_submission_id IS 'FK to intake_submissions: which inbound payload produced this order. NULL for legacy orders.';

-- Origin/destination structured addresses (for OR-Tools routing)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS origin_address JSONB;
COMMENT ON COLUMN public.orders.origin_address IS 'Structured pickup address: {street, number, comuna, city, region, lat, lng, contact_name, contact_phone}';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS destination_address JSONB;
COMMENT ON COLUMN public.orders.destination_address IS 'Structured delivery address: {street, number, comuna, city, region, lat, lng, contact_name, contact_phone}. Parsed from delivery_address text.';

-- Cargo classification
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cargo_type VARCHAR(50);
COMMENT ON COLUMN public.orders.cargo_type IS 'Cargo type classification (e.g., electrodomesticos, ropa, alimentos). Affects vehicle requirements.';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS requires_signature BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.orders.requires_signature IS 'Whether delivery requires recipient signature (SLA-driven).';

-- SLA tracking
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sla_deadline_at TIMESTAMPTZ;
COMMENT ON COLUMN public.orders.sla_deadline_at IS 'Absolute deadline for delivery. Derived from generator SLA config + order creation time.';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sla_breached BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.orders.sla_breached IS 'True if sla_deadline_at has passed without successful delivery. Set by exception agent.';

-- Priority (for assignment optimization)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 5;
COMMENT ON COLUMN public.orders.priority IS 'Assignment priority 1-10. Higher = more urgent. Influenced by SLA proximity, cargo type, client tier.';

-- Agent processing metadata
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS agent_metadata JSONB DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.orders.agent_metadata IS 'Agent-managed metadata: {last_agent, geocoded_at, geocode_confidence, zone_id, cluster_id, ...}';

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_orders_generator_id ON public.orders(generator_id) WHERE generator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_intake_submission_id ON public.orders(intake_submission_id) WHERE intake_submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_sla_deadline ON public.orders(operator_id, sla_deadline_at) WHERE sla_breached = false AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_priority ON public.orders(operator_id, priority DESC) WHERE deleted_at IS NULL;


-- ============================================================================
-- TABLE 3: drivers
-- Bounded Context: Resources
-- Purpose: Unified driver registry for own + external fleet.
--          Separate from fleet_vehicles (a driver may use different vehicles).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.drivers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,

  -- Identity
  fleet_type          fleet_type_enum NOT NULL,
  full_name           VARCHAR(255) NOT NULL,
  rut                 VARCHAR(20),              -- Chilean national ID (RUT) — unique within operator
  phone               VARCHAR(20) NOT NULL,     -- Primary phone (WhatsApp-reachable)
  phone_secondary     VARCHAR(20),              -- Backup phone
  email               VARCHAR(255),

  -- Status
  status              driver_status_enum NOT NULL DEFAULT 'active',

  -- Vehicle association (current default vehicle)
  default_vehicle_id  UUID REFERENCES public.fleet_vehicles(id) ON DELETE SET NULL,

  -- Capacity
  max_deliveries_per_day INT,                   -- Soft cap on daily assignments
  max_weight_kg       DECIMAL(10,2),            -- Vehicle weight limit
  max_volume_m3       DECIMAL(10,4),            -- Vehicle volume limit

  -- Operating zones (array of comuna names or zone codes)
  zones               JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["Maipú", "Pudahuel", "Cerrillos"]

  -- Performance scoring
  score               DECIMAL(5,2) DEFAULT 5.0, -- 0.0-10.0, updated by settlement agent
  total_deliveries    INT NOT NULL DEFAULT 0,
  successful_deliveries INT NOT NULL DEFAULT 0,
  on_time_rate        DECIMAL(5,2),             -- 0.00-100.00 percentage

  -- Compensation (for settlement)
  pay_model           pay_model_enum NOT NULL DEFAULT 'per_delivery',
  pay_config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- per_delivery: {rate_clp: 3500, bonus_first_attempt_clp: 500}
  -- per_km:       {rate_per_km_clp: 150, min_daily_clp: 25000}
  -- fixed_daily:  {daily_rate_clp: 45000}
  -- per_package:  {rate_per_package_clp: 800}
  -- hybrid:       {base_daily_clp: 20000, per_delivery_clp: 2000}

  -- WhatsApp state
  whatsapp_opted_in   BOOLEAN NOT NULL DEFAULT false,
  whatsapp_opted_in_at TIMESTAMPTZ,
  last_seen_at        TIMESTAMPTZ,              -- Last WhatsApp activity
  last_location       JSONB,                    -- {lat, lng, accuracy, timestamp}

  -- Linked user (if driver also has app login)
  user_id             UUID REFERENCES public.users(id) ON DELETE SET NULL,

  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT unique_driver_phone_per_operator UNIQUE (operator_id, phone),
  CONSTRAINT unique_driver_rut_per_operator UNIQUE (operator_id, rut)
);

COMMENT ON TABLE  public.drivers IS 'Unified driver registry. Own fleet drivers have fixed schedules and salary. External drivers are freelance, negotiated per-job.';
COMMENT ON COLUMN public.drivers.rut IS 'Chilean RUT (Rol Unico Tributario). Required for settlement/tax compliance. Unique within operator.';
COMMENT ON COLUMN public.drivers.zones IS 'JSONB array of comuna names or zone codes the driver covers. Used by assignment optimizer.';
COMMENT ON COLUMN public.drivers.score IS 'Performance score 0-10. Factors: on-time rate, first-attempt rate, damage rate, response time. Updated after each settlement.';
COMMENT ON COLUMN public.drivers.pay_config IS 'JSONB compensation configuration. Shape varies by pay_model. All amounts in CLP.';
COMMENT ON COLUMN public.drivers.last_location IS 'Last known GPS location from WhatsApp or app. {lat, lng, accuracy_m, captured_at}';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_drivers_operator_id ON public.drivers(operator_id);
CREATE INDEX IF NOT EXISTS idx_drivers_fleet_type ON public.drivers(operator_id, fleet_type);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON public.drivers(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_drivers_phone ON public.drivers(operator_id, phone);
CREATE INDEX IF NOT EXISTS idx_drivers_score ON public.drivers(operator_id, score DESC) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_drivers_user_id ON public.drivers(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drivers_default_vehicle ON public.drivers(default_vehicle_id) WHERE default_vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drivers_deleted_at ON public.drivers(deleted_at);
-- GIN index for zone-based assignment queries (contains check on JSONB array)
CREATE INDEX IF NOT EXISTS idx_drivers_zones ON public.drivers USING GIN (zones);


-- ============================================================================
-- TABLE 4: driver_availabilities
-- Bounded Context: Resources
-- Purpose: Daily availability windows. Agents check this before assignment.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.driver_availabilities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  driver_id           UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,

  availability_date   DATE NOT NULL,
  available_from      TIME NOT NULL,            -- Start of availability window
  available_until     TIME NOT NULL,            -- End of availability window
  is_available        BOOLEAN NOT NULL DEFAULT true, -- False = explicitly unavailable this day

  -- Capacity for this day (overrides driver defaults)
  max_deliveries      INT,
  max_weight_kg       DECIMAL(10,2),

  -- Source of this availability record
  source              VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'schedule', 'whatsapp', 'agent')),
  -- manual:    Operator set it
  -- schedule:  Generated from recurring schedule template
  -- whatsapp:  Driver reported via WhatsApp
  -- agent:     AI agent inferred from patterns

  notes               TEXT,
  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.driver_availabilities IS 'Per-day driver availability windows. Assignment agent queries this to find eligible drivers.';
COMMENT ON COLUMN public.driver_availabilities.source IS 'How this availability was set. Agent can infer from WhatsApp "I am available tomorrow 8-17".';

-- Partial unique: one active availability per driver per date
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_avail_unique_active
  ON public.driver_availabilities(operator_id, driver_id, availability_date)
  WHERE deleted_at IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_driver_avail_operator_id ON public.driver_availabilities(operator_id);
CREATE INDEX IF NOT EXISTS idx_driver_avail_driver_id ON public.driver_availabilities(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_avail_date ON public.driver_availabilities(operator_id, availability_date);
CREATE INDEX IF NOT EXISTS idx_driver_avail_available ON public.driver_availabilities(operator_id, availability_date, is_available)
  WHERE is_available = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_driver_avail_deleted_at ON public.driver_availabilities(deleted_at);


-- ============================================================================
-- TABLE 5: assignments
-- Bounded Context: Assignment
-- Purpose: Order-to-driver binding with full state machine.
--          State transitions differ by fleet_type (own skips negotiation states).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  order_id            UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  driver_id           UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,

  -- Route context (may be assigned as part of a route)
  route_id            UUID REFERENCES public.routes(id) ON DELETE SET NULL,
  dispatch_id         UUID REFERENCES public.dispatches(id) ON DELETE SET NULL,
  sequence_number     INT,                      -- Position in driver's delivery sequence

  -- State machine
  status              assignment_status_enum NOT NULL DEFAULT 'pending',
  previous_status     assignment_status_enum,   -- For state transition tracking

  -- Negotiation (external drivers only)
  offered_at          TIMESTAMPTZ,
  offer_expires_at    TIMESTAMPTZ,              -- Auto-expire if no response
  offered_rate_clp    NUMERIC(12,2),            -- Initial offer amount
  negotiated_rate_clp NUMERIC(12,2),            -- Final agreed amount (may differ from offer)
  rejection_reason    TEXT,                      -- Why driver rejected

  -- Execution tracking
  accepted_at         TIMESTAMPTZ,
  pickup_at           TIMESTAMPTZ,
  in_transit_at       TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  failure_reason      VARCHAR(255),

  -- Proof of delivery
  pod_photo_url       TEXT,                     -- Supabase Storage URL
  pod_signature_url   TEXT,                     -- Supabase Storage URL
  pod_recipient_name  VARCHAR(255),
  pod_notes           TEXT,

  -- GPS at key moments
  pickup_location     JSONB,                    -- {lat, lng, captured_at}
  delivery_location   JSONB,                    -- {lat, lng, captured_at}

  -- Agent that created/managed this assignment
  created_by_agent    VARCHAR(100),
  managed_by_agent    VARCHAR(100),

  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,

  -- An order can only have one active assignment at a time
  CONSTRAINT unique_active_assignment_per_order UNIQUE (operator_id, order_id) -- see partial index below
);

COMMENT ON TABLE  public.assignments IS 'Order-to-driver binding. State machine tracks from assignment through delivery to settlement. Own drivers auto-accept; external drivers go through offer/negotiation.';
COMMENT ON COLUMN public.assignments.offered_rate_clp IS 'Initial pay offer for external drivers. CLP amount. NULL for own fleet (use driver.pay_config).';
COMMENT ON COLUMN public.assignments.negotiated_rate_clp IS 'Final agreed rate after negotiation. May equal offered_rate_clp if accepted as-is.';
COMMENT ON COLUMN public.assignments.sequence_number IS 'Delivery order within driver route. Set by OR-Tools optimizer or manual override.';

-- Drop the simple unique constraint and use a partial index instead
-- (allows reassignment after cancellation)
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS unique_active_assignment_per_order;
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignment_active_per_order
  ON public.assignments(operator_id, order_id)
  WHERE status NOT IN ('cancelled', 'failed', 'rejected', 'expired') AND deleted_at IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_assignments_operator_id ON public.assignments(operator_id);
CREATE INDEX IF NOT EXISTS idx_assignments_order_id ON public.assignments(order_id);
CREATE INDEX IF NOT EXISTS idx_assignments_driver_id ON public.assignments(driver_id);
CREATE INDEX IF NOT EXISTS idx_assignments_route_id ON public.assignments(route_id) WHERE route_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assignments_status ON public.assignments(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_assignments_driver_status ON public.assignments(operator_id, driver_id, status);
CREATE INDEX IF NOT EXISTS idx_assignments_driver_date ON public.assignments(operator_id, driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_offer_expiry ON public.assignments(offer_expires_at)
  WHERE status = 'offered' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assignments_deleted_at ON public.assignments(deleted_at);


-- ============================================================================
-- TABLE 6: conversations
-- Bounded Context: Coordination + WISMO
-- Purpose: WhatsApp thread registry. Each conversation is with one participant
--          (driver or client) about one or more orders.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,

  -- Participant
  participant_type    participant_type_enum NOT NULL,
  participant_phone   VARCHAR(20) NOT NULL,     -- WhatsApp phone number
  participant_name    VARCHAR(255),

  -- Link to driver or end-customer (mutually exclusive based on participant_type)
  driver_id           UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  -- No FK for client — clients are order.customer_phone, not a separate table

  -- Channel
  channel             conversation_channel_enum NOT NULL DEFAULT 'whatsapp',
  external_thread_id  VARCHAR(255),             -- WhatsApp conversation ID / thread reference

  -- Context (what this conversation is about)
  -- A conversation may relate to multiple orders over time
  context_order_ids   UUID[] DEFAULT '{}',      -- Array of related order IDs
  context_assignment_id UUID REFERENCES public.assignments(id) ON DELETE SET NULL,

  -- State
  is_active           BOOLEAN NOT NULL DEFAULT true,
  last_message_at     TIMESTAMPTZ,
  message_count       INT NOT NULL DEFAULT 0,
  unread_count        INT NOT NULL DEFAULT 0,   -- Unread inbound messages

  -- Agent ownership
  assigned_agent      VARCHAR(100),             -- Which agent is handling this conversation
  requires_human      BOOLEAN NOT NULL DEFAULT false, -- Escalated to human operator

  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.conversations IS 'WhatsApp conversation threads. Each thread links an operator to one participant (driver or client). Agents manage these conversations autonomously.';
COMMENT ON COLUMN public.conversations.context_order_ids IS 'Array of order UUIDs this conversation relates to. Updated as conversation evolves.';
COMMENT ON COLUMN public.conversations.assigned_agent IS 'Agent currently handling this conversation (e.g., "coordination-agent", "wismo-agent").';
COMMENT ON COLUMN public.conversations.requires_human IS 'True when agent cannot handle the situation and escalated to human operator.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_operator_id ON public.conversations(operator_id);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_phone ON public.conversations(operator_id, participant_phone);
CREATE INDEX IF NOT EXISTS idx_conversations_driver_id ON public.conversations(driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_participant_type ON public.conversations(operator_id, participant_type);
CREATE INDEX IF NOT EXISTS idx_conversations_active ON public.conversations(operator_id, is_active, last_message_at DESC)
  WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_requires_human ON public.conversations(operator_id, requires_human)
  WHERE requires_human = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_assignment_id ON public.conversations(context_assignment_id) WHERE context_assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at ON public.conversations(deleted_at);
-- GIN index for order_id array containment queries
CREATE INDEX IF NOT EXISTS idx_conversations_order_ids ON public.conversations USING GIN (context_order_ids);


-- ============================================================================
-- TABLE 7: conversation_messages
-- Bounded Context: Coordination + WISMO
-- Purpose: Individual messages within a conversation.
--          NLP intent classification stored per message.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  conversation_id     UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,

  -- Message content
  direction           message_direction_enum NOT NULL,
  sender_type         message_sender_enum NOT NULL,
  content_type        VARCHAR(20) NOT NULL DEFAULT 'text'
    CHECK (content_type IN ('text', 'image', 'audio', 'document', 'location', 'template', 'interactive')),
  body                TEXT,                     -- Text content or caption
  media_url           TEXT,                     -- Supabase Storage URL for media
  media_mime_type     VARCHAR(100),

  -- WhatsApp message tracking
  external_message_id VARCHAR(255),             -- WhatsApp message ID (wamid)
  wa_status           VARCHAR(20),              -- sent, delivered, read, failed
  wa_status_at        TIMESTAMPTZ,

  -- Template (for outbound template messages)
  template_name       VARCHAR(100),
  template_params     JSONB,                    -- Template variable values

  -- NLP / Intent classification (populated by agent)
  intent              VARCHAR(100),             -- Classified intent (e.g., "confirm_delivery", "report_problem", "ask_eta")
  intent_confidence   DECIMAL(5,4),             -- 0.0000-1.0000
  entities            JSONB DEFAULT '{}'::jsonb,-- Extracted entities {order_number, address, time, reason, ...}
  sentiment           VARCHAR(20),              -- positive, neutral, negative, urgent

  -- Agent processing
  processed_by_agent  VARCHAR(100),
  processed_at        TIMESTAMPTZ,
  agent_action_taken  TEXT,                     -- What the agent did in response

  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
  -- NOTE: No updated_at — messages are immutable once created
);

COMMENT ON TABLE  public.conversation_messages IS 'Individual messages in a conversation. Inbound messages have NLP intent classification. Outbound messages may be agent-generated or human-sent.';
COMMENT ON COLUMN public.conversation_messages.intent IS 'NLP-classified intent. Common values: confirm_delivery, report_problem, ask_eta, request_reschedule, send_location, accept_offer, reject_offer, counter_offer.';
COMMENT ON COLUMN public.conversation_messages.entities IS 'NLP-extracted entities from message text. Shape varies by intent.';
COMMENT ON COLUMN public.conversation_messages.agent_action_taken IS 'Description of what the agent did after processing this message.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conv_messages_operator_id ON public.conversation_messages(operator_id);
CREATE INDEX IF NOT EXISTS idx_conv_messages_conversation_id ON public.conversation_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_messages_external_id ON public.conversation_messages(external_message_id) WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_messages_intent ON public.conversation_messages(operator_id, intent) WHERE intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_messages_created_at ON public.conversation_messages(operator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_messages_deleted_at ON public.conversation_messages(deleted_at);


-- ============================================================================
-- TABLE 8: wismo_notifications
-- Bounded Context: WISMO (Where Is My Order)
-- Purpose: Proactive and reactive client communication tracking.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wismo_notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  order_id            UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  -- Notification type
  notification_type   wismo_type_enum NOT NULL,

  -- Delivery tracking
  channel             conversation_channel_enum NOT NULL DEFAULT 'whatsapp',
  recipient_phone     VARCHAR(20) NOT NULL,
  recipient_name      VARCHAR(255),
  delivery_status     wismo_delivery_status_enum NOT NULL DEFAULT 'pending',

  -- Content
  template_name       VARCHAR(100),             -- WhatsApp template used
  template_params     JSONB,                    -- Template variable values
  message_body        TEXT,                     -- Actual sent content (for audit)
  external_message_id VARCHAR(255),             -- WhatsApp message ID

  -- Conversation link (if this triggered or is part of a conversation)
  conversation_id     UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  conversation_message_id UUID REFERENCES public.conversation_messages(id) ON DELETE SET NULL,

  -- Scheduling
  scheduled_at        TIMESTAMPTZ,              -- When to send (NULL = immediate)
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  failure_reason      VARCHAR(255),

  -- Agent tracking
  triggered_by        VARCHAR(100),             -- Agent or event that triggered this notification
  triggered_by_event_id UUID,                   -- FK to agent_events (added after agent_events table)

  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.wismo_notifications IS 'Client-facing notifications. Proactive (ETA, dispatched, delivered) and reactive (status inquiry responses). Tracked for delivery confirmation and audit.';
COMMENT ON COLUMN public.wismo_notifications.notification_type IS 'Classifies whether this was operator-initiated (proactive) or client-initiated (reactive).';
COMMENT ON COLUMN public.wismo_notifications.triggered_by IS 'Agent or event name that caused this notification (e.g., "wismo-agent", "dispatch_webhook").';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wismo_operator_id ON public.wismo_notifications(operator_id);
CREATE INDEX IF NOT EXISTS idx_wismo_order_id ON public.wismo_notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_wismo_recipient ON public.wismo_notifications(operator_id, recipient_phone);
CREATE INDEX IF NOT EXISTS idx_wismo_status ON public.wismo_notifications(operator_id, delivery_status);
CREATE INDEX IF NOT EXISTS idx_wismo_type ON public.wismo_notifications(operator_id, notification_type);
CREATE INDEX IF NOT EXISTS idx_wismo_scheduled ON public.wismo_notifications(scheduled_at)
  WHERE delivery_status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wismo_conversation_id ON public.wismo_notifications(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wismo_deleted_at ON public.wismo_notifications(deleted_at);


-- ============================================================================
-- TABLE 9: settlement_periods
-- Bounded Context: Settlement
-- Purpose: End-of-day reconciliation container. One period per driver per day.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.settlement_periods (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  driver_id           UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,

  -- Period
  settlement_date     DATE NOT NULL,
  status              settlement_status_enum NOT NULL DEFAULT 'open',

  -- Pay model snapshot (captured at settlement time, not live from driver)
  pay_model           pay_model_enum NOT NULL,
  pay_config_snapshot JSONB NOT NULL,           -- Snapshot of driver.pay_config at settlement time

  -- Totals (calculated from line items)
  total_deliveries    INT NOT NULL DEFAULT 0,
  successful_deliveries INT NOT NULL DEFAULT 0,
  failed_deliveries   INT NOT NULL DEFAULT 0,
  total_km            DECIMAL(10,2) DEFAULT 0,
  total_packages      INT NOT NULL DEFAULT 0,

  -- Financial
  gross_pay_clp       NUMERIC(12,2) NOT NULL DEFAULT 0,   -- Total before deductions
  deductions_clp      NUMERIC(12,2) NOT NULL DEFAULT 0,   -- Damage, shortage claims, advances
  bonuses_clp         NUMERIC(12,2) NOT NULL DEFAULT 0,   -- Performance bonuses
  net_pay_clp         NUMERIC(12,2) NOT NULL DEFAULT 0,   -- gross - deductions + bonuses
  operator_revenue_clp NUMERIC(12,2) NOT NULL DEFAULT 0,  -- What operator charged clients
  operator_margin_clp  NUMERIC(12,2) NOT NULL DEFAULT 0,  -- revenue - net_pay

  -- Approval
  calculated_at       TIMESTAMPTZ,
  reviewed_by         UUID REFERENCES public.users(id),
  reviewed_at         TIMESTAMPTZ,
  approved_by         UUID REFERENCES public.users(id),
  approved_at         TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  payment_reference   VARCHAR(255),             -- Bank transfer reference, etc.

  -- Dispute
  disputed_at         TIMESTAMPTZ,
  dispute_reason      TEXT,
  dispute_resolved_at TIMESTAMPTZ,
  dispute_resolved_by UUID REFERENCES public.users(id),

  notes               TEXT,
  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.settlement_periods IS 'End-of-day settlement per driver. Contains financial totals calculated from line items. Goes through review/approval workflow.';
COMMENT ON COLUMN public.settlement_periods.pay_config_snapshot IS 'Frozen copy of driver pay config at settlement time. Ensures historical accuracy if rates change.';
COMMENT ON COLUMN public.settlement_periods.operator_margin_clp IS 'Operator profit margin = client charges - driver pay. May be negative for loss-making deliveries.';

-- One active settlement per driver per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_unique_active
  ON public.settlement_periods(operator_id, driver_id, settlement_date)
  WHERE deleted_at IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_settlement_periods_operator_id ON public.settlement_periods(operator_id);
CREATE INDEX IF NOT EXISTS idx_settlement_periods_driver_id ON public.settlement_periods(driver_id);
CREATE INDEX IF NOT EXISTS idx_settlement_periods_date ON public.settlement_periods(operator_id, settlement_date);
CREATE INDEX IF NOT EXISTS idx_settlement_periods_status ON public.settlement_periods(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_settlement_periods_pending ON public.settlement_periods(operator_id, status)
  WHERE status IN ('pending_review', 'disputed') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_settlement_periods_deleted_at ON public.settlement_periods(deleted_at);


-- ============================================================================
-- TABLE 10: settlement_line_items
-- Bounded Context: Settlement
-- Purpose: Individual pay lines within a settlement period.
--          One line per delivery, plus adjustments (bonuses, deductions).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.settlement_line_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  settlement_id       UUID NOT NULL REFERENCES public.settlement_periods(id) ON DELETE CASCADE,

  -- What this line item is for
  line_type           VARCHAR(30) NOT NULL
    CHECK (line_type IN ('delivery', 'failed_attempt', 'km_charge', 'daily_base', 'bonus', 'deduction', 'adjustment')),

  -- Order/assignment reference (NULL for non-delivery lines like daily_base)
  order_id            UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  assignment_id       UUID REFERENCES public.assignments(id) ON DELETE SET NULL,

  -- Description
  description         VARCHAR(500) NOT NULL,    -- Human-readable description

  -- Financial
  quantity            DECIMAL(10,2) NOT NULL DEFAULT 1,  -- e.g., km driven, packages
  unit_rate_clp       NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Rate per unit
  amount_clp          NUMERIC(12,2) NOT NULL DEFAULT 0,  -- quantity * unit_rate (or override)
  is_credit           BOOLEAN NOT NULL DEFAULT true,      -- true = payment to driver, false = deduction

  -- Client billing (what operator charges the client for this delivery)
  client_charge_clp   NUMERIC(12,2) DEFAULT 0,

  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.settlement_line_items IS 'Individual pay lines in a settlement. Delivery lines, km charges, bonuses, deductions, adjustments.';
COMMENT ON COLUMN public.settlement_line_items.is_credit IS 'True = money owed to driver (delivery pay, bonus). False = money deducted from driver (damage, advance repayment).';
COMMENT ON COLUMN public.settlement_line_items.client_charge_clp IS 'What the operator bills the client for this line. Used for margin calculation.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sli_operator_id ON public.settlement_line_items(operator_id);
CREATE INDEX IF NOT EXISTS idx_sli_settlement_id ON public.settlement_line_items(settlement_id);
CREATE INDEX IF NOT EXISTS idx_sli_order_id ON public.settlement_line_items(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sli_assignment_id ON public.settlement_line_items(assignment_id) WHERE assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sli_line_type ON public.settlement_line_items(settlement_id, line_type);
CREATE INDEX IF NOT EXISTS idx_sli_deleted_at ON public.settlement_line_items(deleted_at);


-- ============================================================================
-- TABLE 11: settlement_documents
-- Bounded Context: Settlement
-- Purpose: Attached invoices, receipts, proof documents.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.settlement_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  settlement_id       UUID NOT NULL REFERENCES public.settlement_periods(id) ON DELETE CASCADE,

  document_type       VARCHAR(50) NOT NULL
    CHECK (document_type IN ('invoice', 'receipt', 'boleta', 'guia_despacho', 'payment_proof', 'other')),
  file_name           VARCHAR(500) NOT NULL,
  storage_path        TEXT NOT NULL,             -- Supabase Storage path
  file_size_bytes     BIGINT,
  mime_type           VARCHAR(100),

  -- Chilean tax document specifics
  folio_number        VARCHAR(50),               -- SII document folio
  net_amount_clp      NUMERIC(12,2),
  iva_amount_clp      NUMERIC(12,2),             -- 19% IVA
  total_amount_clp    NUMERIC(12,2),

  uploaded_by         UUID REFERENCES public.users(id),
  notes               TEXT,

  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.settlement_documents IS 'Documents attached to settlements. Chilean tax documents (boleta, guia de despacho), invoices, payment proofs.';
COMMENT ON COLUMN public.settlement_documents.folio_number IS 'SII (Servicio de Impuestos Internos) document folio for Chilean tax compliance.';
COMMENT ON COLUMN public.settlement_documents.iva_amount_clp IS 'Chilean IVA (19% VAT) amount in CLP.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sdocs_operator_id ON public.settlement_documents(operator_id);
CREATE INDEX IF NOT EXISTS idx_sdocs_settlement_id ON public.settlement_documents(settlement_id);
CREATE INDEX IF NOT EXISTS idx_sdocs_document_type ON public.settlement_documents(settlement_id, document_type);
CREATE INDEX IF NOT EXISTS idx_sdocs_deleted_at ON public.settlement_documents(deleted_at);


-- ============================================================================
-- TABLE 12: exceptions
-- Bounded Context: Exceptions
-- Purpose: Deviation tracking at 4 severity levels with auto-resolution.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.exceptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,

  -- Classification
  exception_type      VARCHAR(100) NOT NULL,     -- e.g., "sla_breach", "driver_no_response", "address_not_found"
  severity            exception_severity_enum NOT NULL,
  status              exception_status_enum NOT NULL DEFAULT 'open',

  -- Context (what entity is affected — polymorphic references)
  order_id            UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  assignment_id       UUID REFERENCES public.assignments(id) ON DELETE SET NULL,
  driver_id           UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  generator_id        UUID REFERENCES public.generators(id) ON DELETE SET NULL,
  conversation_id     UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  settlement_id       UUID REFERENCES public.settlement_periods(id) ON DELETE SET NULL,

  -- Description
  title               VARCHAR(500) NOT NULL,
  description         TEXT,                     -- Detailed description of the deviation
  context_data        JSONB NOT NULL DEFAULT '{}'::jsonb, -- Structured context for the exception

  -- Resolution
  auto_resolution_strategy VARCHAR(100),        -- e.g., "reassign_driver", "extend_sla", "send_reminder", "escalate"
  auto_resolution_attempted BOOLEAN NOT NULL DEFAULT false,
  auto_resolution_result JSONB,                 -- {success: bool, action_taken, details}
  escalation_target   VARCHAR(100),             -- Who to escalate to: "operations_manager", "admin", "client_manager"
  escalated_at        TIMESTAMPTZ,

  -- Human resolution
  resolved_by         UUID REFERENCES public.users(id),
  resolved_at         TIMESTAMPTZ,
  resolution_notes    TEXT,

  -- Agent tracking
  detected_by_agent   VARCHAR(100),             -- Agent that detected this exception
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.exceptions IS 'Deviations from expected operations at 4 severity levels. Low = auto-resolved. Critical = immediate human escalation.';
COMMENT ON COLUMN public.exceptions.exception_type IS 'Classification string. Common types: sla_breach, driver_no_response, address_not_found, capacity_exceeded, missing_package, client_complaint, payment_dispute, vehicle_breakdown.';
COMMENT ON COLUMN public.exceptions.auto_resolution_strategy IS 'Strategy the agent should attempt before escalating. NULL means no auto-resolution configured.';
COMMENT ON COLUMN public.exceptions.escalation_target IS 'Role or person to escalate to when auto-resolution fails or severity is high/critical.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exceptions_operator_id ON public.exceptions(operator_id);
CREATE INDEX IF NOT EXISTS idx_exceptions_type ON public.exceptions(operator_id, exception_type);
CREATE INDEX IF NOT EXISTS idx_exceptions_severity ON public.exceptions(operator_id, severity);
CREATE INDEX IF NOT EXISTS idx_exceptions_status ON public.exceptions(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_exceptions_open ON public.exceptions(operator_id, severity DESC, created_at)
  WHERE status IN ('open', 'auto_resolving', 'escalated') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exceptions_order_id ON public.exceptions(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exceptions_driver_id ON public.exceptions(driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exceptions_assignment_id ON public.exceptions(assignment_id) WHERE assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exceptions_detected_at ON public.exceptions(operator_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_exceptions_deleted_at ON public.exceptions(deleted_at);


-- ============================================================================
-- TABLE 13: agent_events
-- Bounded Context: Events
-- Purpose: Immutable append-only audit trail for all agent actions.
--          This is the CQRS event store. Never updated, never deleted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,

  -- Event identity
  event_type          VARCHAR(200) NOT NULL,     -- Hierarchical: "intake.submission.parsed", "assignment.offer.sent"
  event_version       INT NOT NULL DEFAULT 1,    -- Schema version for this event type

  -- Actor
  actor_type          actor_type_enum NOT NULL,
  actor_id            VARCHAR(255) NOT NULL,     -- Agent name, user UUID, driver UUID, "system", webhook source

  -- Aggregate references (which entity this event is about)
  aggregate_type      VARCHAR(100) NOT NULL,     -- "order", "assignment", "conversation", "settlement", "exception", "driver"
  aggregate_id        UUID NOT NULL,             -- ID of the entity

  -- Correlation (link related events across bounded contexts)
  correlation_id      UUID,                      -- Groups related events (e.g., all events from one intake submission)
  causation_id        UUID,                      -- The event that caused this event

  -- Payload (event-specific data)
  payload             JSONB NOT NULL,            -- Event-specific structured data
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb, -- {agent_model, latency_ms, tokens_used, tool_calls_count}

  -- Timestamp (event time, not insert time)
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NOTE: No updated_at, no deleted_at — events are IMMUTABLE
);

COMMENT ON TABLE  public.agent_events IS 'Immutable event store. Append-only. Never updated, never deleted. 7-year retention (Chilean compliance). This is the source of truth for what happened.';
COMMENT ON COLUMN public.agent_events.event_type IS 'Hierarchical event type. Convention: {context}.{aggregate}.{action}. Examples: intake.submission.received, assignment.offer.accepted, coordination.message.sent';
COMMENT ON COLUMN public.agent_events.correlation_id IS 'Groups causally-related events. Example: all events from processing one intake submission share a correlation_id.';
COMMENT ON COLUMN public.agent_events.causation_id IS 'The agent_events.id that directly caused this event. Enables causal chain reconstruction.';
COMMENT ON COLUMN public.agent_events.payload IS 'Event-specific data. Schema varies by event_type. Versioned via event_version column.';
COMMENT ON COLUMN public.agent_events.metadata IS 'Operational metadata: {agent_model, llm_provider, latency_ms, tokens_input, tokens_output, tool_calls_count, cost_usd}';

-- Indexes (optimized for event sourcing query patterns)
CREATE INDEX IF NOT EXISTS idx_agent_events_operator_id ON public.agent_events(operator_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_type ON public.agent_events(operator_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_aggregate ON public.agent_events(operator_id, aggregate_type, aggregate_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_actor ON public.agent_events(operator_id, actor_type, actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_correlation ON public.agent_events(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_events_causation ON public.agent_events(causation_id) WHERE causation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_events_occurred_at ON public.agent_events(operator_id, occurred_at DESC);


-- ============================================================================
-- TABLE 14: agent_tool_calls
-- Bounded Context: Events
-- Purpose: Individual tool invocations by agents. Linked to agent_events.
--          Tracks what tools agents called, with what args, and what happened.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_tool_calls (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  event_id            UUID NOT NULL REFERENCES public.agent_events(id) ON DELETE CASCADE,

  -- Tool identity
  agent_name          VARCHAR(100) NOT NULL,     -- Which agent made the call
  tool_name           VARCHAR(200) NOT NULL,     -- Tool function name (e.g., "assign_driver", "send_whatsapp")
  tool_version        VARCHAR(20),               -- Tool version if applicable

  -- Input/Output
  input_args          JSONB NOT NULL,            -- Arguments passed to the tool
  output_result       JSONB,                     -- Tool return value (NULL if still running or failed)
  error_message       TEXT,                      -- Error message if tool call failed

  -- Execution
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'success', 'failed', 'timeout')),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  duration_ms         INT,                       -- Execution time in milliseconds

  -- Cost tracking (for LLM-backed tools)
  tokens_input        INT,
  tokens_output       INT,
  cost_usd            DECIMAL(10,6),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NOTE: No updated_at, no deleted_at — tool calls are immutable records
);

COMMENT ON TABLE  public.agent_tool_calls IS 'Individual tool invocations by agents. Each agent event may have multiple tool calls. Immutable.';
COMMENT ON COLUMN public.agent_tool_calls.tool_name IS 'Function name the agent invoked. Convention: {verb}_{noun} (e.g., assign_driver, send_whatsapp, create_exception, calculate_settlement).';
COMMENT ON COLUMN public.agent_tool_calls.input_args IS 'Arguments the agent passed to the tool. Sensitive values (API keys) should be redacted.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tool_calls_operator_id ON public.agent_tool_calls(operator_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_event_id ON public.agent_tool_calls(event_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_agent_name ON public.agent_tool_calls(operator_id, agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON public.agent_tool_calls(operator_id, tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_status ON public.agent_tool_calls(status) WHERE status IN ('pending', 'running');


-- ============================================================================
-- DEFERRED FK: wismo_notifications.triggered_by_event_id -> agent_events.id
-- (Deferred because agent_events is defined after wismo_notifications)
-- ============================================================================

ALTER TABLE public.wismo_notifications
  ADD CONSTRAINT fk_wismo_triggered_by_event
  FOREIGN KEY (triggered_by_event_id) REFERENCES public.agent_events(id) ON DELETE SET NULL;


-- ============================================================================
-- TABLE 15: operator_config (spec-10b addition)
-- Bounded Context: Configuration
-- Purpose: Per-operator agent suite configuration and feature flags.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.operator_config (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id             UUID NOT NULL UNIQUE REFERENCES public.operators(id) ON DELETE CASCADE,
  timezone                VARCHAR DEFAULT 'America/Santiago',
  business_hours          JSONB DEFAULT '{"start":"07:00","end":"19:00"}'::jsonb,
  whatsapp_enabled        BOOLEAN DEFAULT false,
  auto_assignment_enabled BOOLEAN DEFAULT true,
  escalation_email        VARCHAR,
  wismo_response_language VARCHAR DEFAULT 'es-CL',
  agent_overrides         JSONB DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_config_operator_id ON public.operator_config(operator_id);


-- ============================================================================
-- TABLE 16: agent_commands (spec-10b addition)
-- Bounded Context: Commands
-- Purpose: Inbound commands from external sources (webhooks, UI, scheduled jobs)
--          queued for processing by the agent runtime.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_commands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  command_type    VARCHAR NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          command_status_enum DEFAULT 'pending',
  source          VARCHAR NOT NULL,
  processed_at    TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_commands_operator_id ON public.agent_commands(operator_id);
CREATE INDEX IF NOT EXISTS idx_agent_commands_status ON public.agent_commands(operator_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_agent_commands_created_at ON public.agent_commands(operator_id, created_at DESC);
