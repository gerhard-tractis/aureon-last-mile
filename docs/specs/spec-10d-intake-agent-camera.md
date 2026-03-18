# Spec-10d: INTAKE Agent — Camera-First (Phase 3)

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> Architecture: `docs/architecture/agents.md` §3 (intake)
> API design: `docs/architecture/agents-api-design.md` §2, §6

_Date: 2026-03-18_

---

## Goal

Mobile camera → OCR → customer matching → order creation. Single intake channel: mobile app camera from the pickup module.

## Prerequisites

- Phase 2 (orchestration layer — `intake.ingest` queue active)

## Flow

```
Picker at generator → "Crear nuevo Manifiesto" → Camera → "Aceptar"
  → Upload photo to Supabase Storage
  → Insert intake_submissions row (status: received, source: mobile_camera)
  → Mobile shows animated processing icon + "Procesando manifiesto..."
  → INTAKE agent:
      1. parse_with_vision() → GLM-OCR extracts structured data from photo
      2. match_customer() → query tenant's customers (WHERE operator_id),
         Groq fuzzy-matches OCR text against known customers
      3. create_order() per row (linked to matched customer)
  → Update intake_submissions: received → parsing → parsed
  → Mobile receives Supabase Realtime update → success screen
```

## Deliverables

### Agent Core (`src/agents/intake/`)

- `intake-agent.ts` — agent definition:
  - Model: Groq Llama 3.3 70B (`groq:llama-3.3-70b`)
  - System prompt: Chilean logistics domain, Spanish language, manifest parsing context
  - Tools: `parse_with_vision`, `match_customer`, `create_order`, `flag_parsing_error`
  - maxSteps: 10
- `intake-tools.ts` — tool definitions with Zod input schemas
- `intake-fallback.ts` — LLM unavailable → mark submission as `needs_review`

### Customer Matching

Two-step process (GLM-OCR cannot reason — it only extracts text):

1. **GLM-OCR** extracts: company names, RUTs, addresses, phone numbers, line items
2. **INTAKE agent (Groq)** receives extracted data + calls `match_customer` tool:
   - Tool queries `tenant_clients` / customers `WHERE operator_id = $operator_id`
   - Returns customer list to agent
   - Agent fuzzy-matches OCR text against customers:
     - RUT exact match (highest confidence)
     - Company name similarity ("Easy S.A." ↔ "Easy SpA")
     - Address/phone correlation
   - Confident match → auto-link customer to orders
   - Ambiguous (multiple candidates or low confidence) → `needs_review` flag

### Shared Tools

- `src/tools/supabase/orders.ts` — `upsert_order`, `get_order`, `update_order_status`
- `src/tools/supabase/packages.ts` — `upsert_package`
- `src/tools/supabase/customers.ts` — `get_customers_by_operator` (returns customer list for matching)
- `src/tools/supabase/events.ts` — `log_agent_event` (audit trail)
- `src/tools/ocr/extract-document.ts` — GLM-OCR API call, returns structured JSON

### Mobile Integration (apps/mobile)

- **Pickup module:** "Crear nuevo Manifiesto" button
- **Camera:** native camera via Expo Camera/ImagePicker
- **Preview:** photo preview with "Aceptar" / "Cancelar" buttons
- **Upload:** photo → Supabase Storage bucket
- **Submission:** insert `intake_submissions` row with:
  - `operator_id` from session
  - `source`: `mobile_camera`
  - `generator_id`: from current pickup session context (picker knows which generator they're at)
  - `raw_file_url`: Supabase Storage path
  - `status`: `received`
- **Processing state:** animated icon + "Procesando manifiesto..."
- **Realtime subscription:** listen to `intake_submissions` row status changes
- **Success screen:** order count, matched customer name, link to review orders
- **Error state:** "Error al procesar" with retry option

### Deferred to Phase 10

- Path A: Email (IMAP) intake
- Path C: Dashboard file upload intake
- `parse_excel` tool (CSV/XLSX)
- `geocode_address` tool
- `confirm_to_sender` tool

## Exit Criteria

- Photo of a test manifest → GLM-OCR extraction → customer matched → orders created in DB
- Picker sees processing animation → result in <30s
- Customer matching: RUT exact match works, name fuzzy match works
- Ambiguous customers flagged as `needs_review`
- Fallback tested: LLM down → all submissions marked `needs_review`
- `operator_id` enforced on every query
- Audit events written to `agent_events` for every tool call
- All files under 300 lines with collocated tests
