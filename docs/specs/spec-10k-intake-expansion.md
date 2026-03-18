# Spec-10k: INTAKE Expansion — Email + Dashboard Upload (Phase 10)

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> Architecture: `docs/architecture/agents-api-design.md` §6

_Date: 2026-03-18_

---

## Goal

Add two remaining intake channels to the existing INTAKE agent: email (IMAP) and dashboard file upload. Both reuse the customer matching and order creation pipeline from Phase 3.

## Prerequisites

- Phase 3 (INTAKE agent with camera channel, customer matching, order creation)

## Path A — Email (IMAP)

### Flow

```
BullMQ repeatable (every 15 min) → intake.ingest { type: 'email_parse' }
  → INTAKE agent:
      1. Connect to IMAP (credentials from tenant_clients.connector_config)
      2. Fetch unread emails from known senders
      3. Download attachments → Supabase Storage
      4. Per attachment:
         ├── CSV/XLSX → parse_excel() → structured rows
         └── PDF/Image → parse_with_vision() → GLM-OCR
      5. match_customer() → same pipeline as camera (Phase 3)
      6. create_order() per row
      7. confirm_to_sender() → reply email with order count summary
      8. Mark email as read in IMAP
```

### New Tools

- `parse_excel` tool (`src/agents/intake/intake-tools.ts`):
  - Accepts CSV/XLSX buffer
  - Uses column mapping from `tenant_clients.connector_config` (existing pattern from `apps/worker`)
  - Returns structured order rows
- `confirm_to_sender` tool:
  - Sends reply to original email
  - Summary: "X pedidos creados, Y necesitan revisión"
- `geocode_address` tool (`src/tools/supabase/geocoding.ts`):
  - Takes address string → returns lat/lng coordinates
  - Required for OR-Tools input (Phase 5 ASSIGNMENT needs lat/lng per order)
  - Uses geocoding API (Google Maps or Nominatim)
  - Caches results in DB to avoid redundant API calls
- `get_connector_config` tool (`src/tools/supabase/intake.ts`):
  - Reads `tenant_clients.connector_config` for IMAP credentials
  - Decrypts `ENCRYPTED:` fields using `lib/crypto.ts`

### IMAP Integration

- Read from `tenant_clients.connector_config`:
  - `imap_host`, `imap_port`, `imap_user`, `ENCRYPTED:imap_password`
  - `sender_filter` (list of known sender emails)
  - `column_map` (maps spreadsheet columns to order fields)
- One IMAP connection per operator per poll cycle
- Mark processed emails as read (no re-processing)

## Path C — Dashboard File Upload

### Flow

```
Dashboard: operator uploads file → POST /api/orders/bulk-import
  → Upload file to Supabase Storage
  → Insert intake_submissions row (status: received, source: dashboard_upload)
  → Insert agent_commands { type: 'retry_intake', submission_id }
  → Command listener → intake.ingest queue
  → INTAKE agent: same pipeline as camera/email
  → Dashboard sees result via Supabase Realtime on intake_submissions
```

### Frontend Changes (apps/frontend)

- Bulk import endpoint: `POST /api/orders/bulk-import`
  - Accept: CSV, XLSX, PDF, image files
  - Upload to Supabase Storage
  - Create `intake_submissions` record
  - Insert `agent_commands` row
- Upload UI: file picker with drag-and-drop
- Processing indicator (same Realtime subscription pattern as mobile)
- Results view: order count, matched customers, needs_review items

## Shared Infrastructure

Both channels reuse from Phase 3:
- `match_customer()` — customer matching pipeline
- `create_order()` — order creation with audit
- `flag_parsing_error()` — error handling
- `intake-fallback.ts` — LLM down → `needs_review`

## Exit Criteria

- Email with Excel attachment → orders created + confirmation reply sent
- Email with PDF/image attachment → OCR → orders created
- IMAP credentials decrypted correctly from connector_config
- Processed emails marked as read (no duplicate processing)
- Dashboard file upload → agent processes → orders created
- Dashboard shows processing status via Realtime
- Both channels use same customer matching as camera
- `operator_id` on every query, audit events for every action
- All files under 300 lines with collocated tests
