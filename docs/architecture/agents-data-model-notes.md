# Agent Suite Data Model — Design Notes

## Design Decisions & Notes

**1. generators vs. tenant_clients**: `tenant_clients` already exists and represents the connector configuration (how to fetch data). `generators` extends this by adding agent-specific intake rules, parsing config, SLA config, and pickup locations. A tenant_client (e.g., "Easy") can have multiple generators (e.g., "Easy Maipu", "Easy Puente Alto") with different pickup locations and SLA rules.

**2. drivers table separate from fleet_vehicles**: The existing `fleet_vehicles` table tracks vehicles from routing providers. `drivers` is a people-centric table. A driver may use different vehicles on different days. The `default_vehicle_id` FK links them, but assignments track which vehicle was actually used via the `route_id` link.

**3. Unified assignment state machine**: Rather than separate state machines for own vs. external drivers, there is one `assignment_status_enum` with states that external drivers pass through (offered, negotiating, rejected, expired) that own drivers skip. The application layer enforces which transitions are valid per fleet type.

**4. Immutable event tables**: `agent_events` and `agent_tool_calls` have no `updated_at` or `deleted_at`. They are append-only by design. No audit trigger is needed (they ARE the audit trail). `conversation_messages` is also effectively immutable.

**5. JSONB for flexible config, ENUMs for queryable state**: Following the brief's guidance, all config that varies per entity uses JSONB (intake_config, parsing_rules, pay_config, sla_config, etc.). Everything that gets filtered/grouped in queries uses ENUMs or normalized columns.

**6. Chilean compliance**: All financial amounts are in CLP (Chilean Pesos) with NUMERIC(12,2). Settlement documents include SII folio tracking and IVA (19% VAT) columns. Driver RUT (Chilean national ID) is stored for tax compliance.

**7. GIN indexes**: `drivers.zones` and `conversations.context_order_ids` use GIN indexes for efficient containment queries (`@>` operator).

**8. Partial unique indexes**: Used for "one active X per Y" constraints (e.g., one active assignment per order, one settlement per driver per day) that allow re-creation after soft delete or cancellation.
