# Story 2.5: Implement Easy CSV/Email Connector

**Epic:** 2 - Order Data Ingestion & Automation Worker
**Story ID:** 2.5
**Status:** in-progress
**Created:** 2026-02-23

---

## Story

**As an** operations manager at Transportes Musan,
**I want** the system to automatically parse Easy's daily CSV manifests received via email,
**So that** orders from Easy/Cencosud are imported without manual intervention.

---

## Acceptance Criteria

### AC1: IMAP Email Polling
```gherkin
Given n8n is running on the VPS (Docker at https://n8n.tractis.ai)
When the IMAP trigger polls every 10 minutes
Then new emails are detected in the configured mailbox
And only emails matching sender address (from connector_config.email_filter.from) are processed
And only emails with subject containing "Manifiesto" (from connector_config.email_filter.subject_contains) are processed
```

### AC2: CSV Attachment Extraction & Storage
```gherkin
Given a matching email is detected with a CSV attachment
When the attachment is extracted
Then the CSV file is uploaded to Supabase Storage bucket "raw-files"
And the storage path follows: raw-files/{operator_slug}/{client_slug}/{YYYY-MM-DD}/{original_filename} (for Easy: raw-files/transportes-musan/easy/{YYYY-MM-DD}/{filename})
And a raw_files record is created with operator_id, client_id, job_id, file_name, storage_path, file_size_bytes
```

### AC3: CSV Parsing with Correct Encoding
```gherkin
Given a CSV file is extracted from the email
When the CSV is parsed
Then encoding is Latin-1 (from connector_config.csv_encoding)
And delimiter is semicolon ";" (from connector_config.csv_delimiter)
And columns are mapped via connector_config.column_map (DB stores as {db_field: "CSV Header"}):
  - order_number ← "N° CARGA" (also maps to external_load_id)
  - customer_name ← "NOMBRE CLIENTE"
  - customer_phone ← "TELEFONO"
  - delivery_address ← "DIRECCION ENTREGA"
  - comuna ← "COMUNA"
  - delivery_date ← "FECHA ENTREGA"
  - service_type ← "TIPO SERVICIO"
  - total_weight_kg ← "PESO KG"
And the correct iteration pattern is: for (const [dbField, csvHeader] of Object.entries(column_map)) { mapped[dbField] = row[csvHeader]; }
```

### AC4: Order Upsert with Cumulative CSV Logic
```gherkin
Given CSV rows are parsed and mapped
When orders are inserted into the database
Then UPSERT uses ON CONFLICT (operator_id, order_number) DO UPDATE SET ...
And each order has: imported_via = 'EMAIL', retailer_name = 'Easy'
And raw_data = original CSV row as JSON object
And source_file = original CSV filename
And tenant_client_id = Easy's tenant_client UUID
And operator_id = Transportes Musan's operator UUID
And cumulative CSVs are handled correctly (later CSV updates existing orders)
```

### AC5: Job Tracking
```gherkin
Given the workflow processes emails
When processing begins, a job record is created in the jobs table
Then job has: operator_id, client_id (Easy), job_type = 'csv_email', status = 'running'
And on success: status = 'completed', result JSONB = {rows_processed, orders_upserted, errors: []}
And on failure: status = 'failed', error_message populated
```

### AC6: Audit Logging
```gherkin
Given orders are upserted
When the existing audit_trigger_func fires on INSERT/UPDATE
Then audit_logs entries are created automatically with action = 'INSERT' or 'UPDATE'
And no manual audit log insertion is needed — the trigger handles it
Note: The trigger logs TG_OP ('INSERT'/'UPDATE'), not 'EMAIL_IMPORT'. The source_file and imported_via fields on the order itself identify email imports.
```

### AC7: Error Handling
```gherkin
Given a processing error occurs
When the error is caught
Then the job is marked as 'failed' with error_message
And the error is logged to Sentry (via n8n Error Trigger or HTTP node)
And a notification is sent (email or n8n notification workflow)
```

### AC8: Duplicate Email Prevention
```gherkin
Given an email has already been processed
When the same email is encountered again
Then processing is skipped (n8n IMAP marks emails as read after processing)
And no duplicate job records are created
Note: IMAP read-flag approach chosen for simplicity over email ID tracking (mentioned in epics.md). Risk: if another mail client marks messages unread, duplicates may occur. Mitigation: the UPSERT is idempotent — re-processing produces the same result.
```

---

## Edge Cases

- **Cumulative CSVs:** Easy sends CSV at 12:00 with load 0001, then at 13:00 with loads 0001+0002. UPSERT handles this — always process the most recent email, earlier orders get updated.
- **No attachment:** Log warning in job result, mark job as completed with rows_processed=0.
- **Corrupt/unreadable CSV:** Mark job as failed, log to Sentry with attachment details.
- **Latin-1 encoding issues:** The CSV uses `;` delimiter and Latin-1 encoding (Spanish characters like ñ, á). n8n must handle this explicitly.
- **Empty CSV (headers only):** Complete job with rows_processed=0, no error.
- **Extremely large CSV (>10MB):** Process normally — Supabase Storage handles it, but log file_size_bytes for monitoring.

---

## Tasks / Subtasks

### Task 1: Create n8n IMAP Credentials (AC: #1)
- [ ] In n8n UI (https://n8n.tractis.ai), create IMAP credentials for Easy's email inbox
- [ ] Configure: host, port (993 for SSL), user, password
- [ ] Actual credentials from the VPS `.env` or provided by Gerhard — NOT from connector_config (those are `ENCRYPTED:` placeholders)
- [ ] Test connection in n8n
> **⚠️ MANUAL:** Requires n8n UI access with actual email credentials from Gerhard

### Task 2: Create n8n Supabase Credentials (AC: #2, #4, #5)
- [ ] In n8n UI, create Supabase credentials using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from VPS `.env`
- [ ] In n8n UI, create PostgreSQL credentials using `SUPABASE_DB_*` variables from VPS `.env` (for direct DB access — needed for UPSERT/ON CONFLICT)
- [ ] Test both connections
> **⚠️ MANUAL:** Requires n8n UI access with VPS `.env` credentials

### Task 3: Build n8n Workflow — Email Trigger + Filter (AC: #1, #8)
- [x] Add Email Trigger (IMAP) node: poll every 10 min, download attachments = true
- [x] Add IF node to filter: check sender matches email_filter.from, subject contains "Manifiesto"
- [x] Emails that don't match → no further processing (n8n marks as read)

### Task 4: Build n8n Workflow — Extract Attachment + Upload to Storage (AC: #2)
- [x] Add node to extract binary attachment from email
- [x] Add Supabase node (or HTTP Request to Supabase Storage API) to upload file
- [x] Storage path: `raw-files/transportes-musan/easy/{YYYY-MM-DD}/{filename}`
- [x] Create a job record in jobs table: `operator_id`, `client_id` (Easy's tenant_client UUID), `job_type='csv_email'`, `status='running'`
- [x] Create a raw_files record with: `operator_id`, `client_id` (Easy UUID), `job_id`, `file_name`, `storage_path`, `file_size_bytes`

### Task 5: Build n8n Workflow — Parse CSV (AC: #3)
- [x] Add Spreadsheet File node (or Code node) to parse CSV binary
- [x] Handle Latin-1 encoding: n8n's built-in CSV parser may default to UTF-8 — use a Code node with `Buffer.from(binary, 'latin1')` if needed
- [x] Set delimiter to `;`
- [x] Output: array of JSON objects with original column names

### Task 5b: Validate Mapped Row Data (AC: #3, #4)
- [x] In the Code node (after column mapping, before upsert), validate each row:
  - **Phone format:** Apply Chilean phone validation (reuse Story 2.2 logic: +56 prefix, 9 digits). Invalid → add to errors[] array, skip row.
  - **Date format:** Parse `FECHA ENTREGA` to `YYYY-MM-DD`. Accept `DD/MM/YYYY` and `YYYY-MM-DD` formats. Unparseable → add to errors[], skip row.
  - **Comuna:** Log warning for unknown comunas but do NOT block import (comuna list may be incomplete).
  - **Required fields:** `order_number` and `delivery_address` must be non-empty. Missing → add to errors[], skip row.
- [x] Track validation errors in job result: `{rows_processed, rows_valid, rows_skipped, errors: [{row, field, reason}]}`

### Task 6: Build n8n Workflow — Column Mapping + Upsert (AC: #3, #4)
- [x] Add Code node or Set node to map columns per connector_config.column_map
- [x] For each row, construct the order object:
  ```json
  {
    "operator_id": "<musan_operator_uuid>",
    "order_number": "<N° CARGA>",
    "customer_name": "<NOMBRE CLIENTE>",
    "customer_phone": "<TELEFONO>",
    "delivery_address": "<DIRECCION ENTREGA>",
    "comuna": "<COMUNA>",
    "delivery_date": "<FECHA ENTREGA parsed to YYYY-MM-DD>",
    "external_load_id": "<N° CARGA>",
    "service_type": "<TIPO SERVICIO>",
    "total_weight_kg": "<PESO KG as decimal>",
    "retailer_name": "Easy",
    "imported_via": "EMAIL",
    "raw_data": "<entire original CSV row as JSON>",
    "source_file": "<filename>",
    "tenant_client_id": "<easy_tenant_client_uuid>"
  }
  ```
- [x] Use PostgreSQL node (NOT Supabase node — it doesn't support ON CONFLICT) for UPSERT:
  ```sql
  INSERT INTO public.orders (operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, external_load_id, service_type,
    total_weight_kg, retailer_name, imported_via, raw_data, source_file, tenant_client_id,
    imported_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
  ON CONFLICT (operator_id, order_number) DO UPDATE SET
    customer_name = EXCLUDED.customer_name,
    customer_phone = EXCLUDED.customer_phone,
    delivery_address = EXCLUDED.delivery_address,
    comuna = EXCLUDED.comuna,
    delivery_date = EXCLUDED.delivery_date,
    external_load_id = EXCLUDED.external_load_id,
    service_type = EXCLUDED.service_type,
    total_weight_kg = EXCLUDED.total_weight_kg,
    raw_data = EXCLUDED.raw_data,
    source_file = EXCLUDED.source_file,
    imported_at = NOW()
  ```
  **CRITICAL:** `imported_at` is NOT NULL with no default — MUST be included in INSERT. Do NOT include `status` in ON CONFLICT UPDATE — cumulative re-imports must not reset order status that may have been updated downstream (e.g., 'dispatched', 'delivered').
- [x] Track: rows_processed count, orders_upserted count, errors array

### Task 7: Build n8n Workflow — Job Completion + Error Handling (AC: #5, #6, #7)
- [x] On success: update job record → status='completed', result={rows_processed, orders_upserted, errors}
- [x] On failure: update job → status='failed', error_message=error details
- [x] Add Error Trigger or try/catch pattern in n8n for failure path
- [x] On failure: HTTP Request node to Sentry API (or use n8n Sentry node if available)
- [x] Audit logging is automatic via existing `audit_trigger_func` trigger on orders table — no manual audit insert needed

### Task 8: Export n8n Workflow JSON (AC: all)
- [x] Export workflow from n8n UI as JSON
- [x] Save to: `apps/worker/n8n/workflows/easy-csv-import.json`
- [ ] Commit to git for version control / disaster recovery
- [x] NOTE: n8n workflows run inside Docker on VPS — the JSON in git is for backup, not deployment

### Task 9: Create Supabase Storage Bucket (AC: #2)
- [ ] Verify `raw-files` bucket exists in Supabase Storage (should already exist from Story 2.3)
- [ ] If not, create it: private bucket, no public access
- [ ] Ensure service_role key has write access (it does by default)
> **⚠️ MANUAL:** Requires Supabase dashboard verification

### Task 10: End-to-End Test (AC: all)
- [ ] Send a test email matching Easy's format (sender, subject "Manifiesto", CSV attachment with `;` delimiter and Latin-1 encoding)
- [ ] Verify: email detected → attachment uploaded to Storage → CSV parsed → orders upserted → job completed
- [ ] Verify: duplicate email not re-processed
- [ ] Verify: order UPSERT works (send second email with overlapping + new orders)
- [ ] Verify: raw_files record created with correct storage_path
- [ ] Verify: orders have correct imported_via, raw_data, source_file, tenant_client_id
> **⚠️ MANUAL:** Requires live email + n8n + Supabase access

---

## Dev Notes

### Architecture Context

**System topology:**
```
Email (IMAP) → n8n (Docker on VPS) → Supabase (DB + Storage)
```

n8n connects to Supabase two ways:
1. **Supabase REST API** (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) — for Storage uploads, simple reads
2. **PostgreSQL direct** (`SUPABASE_DB_*`) — for UPSERT with ON CONFLICT, bulk operations. **Use this for order upserts.**

n8n runs as Docker container on VPS 187.77.48.107. Web UI at https://n8n.tractis.ai. Owner credentials already configured.

### Database Schema (Story 2.4 — already applied)

**Key tables used by this story:**

| Table | Purpose | Key Fields |
|---|---|---|
| `orders` | Target for upserted orders | `(operator_id, order_number)` unique constraint, `imported_via` ENUM, `raw_data` JSONB |
| `jobs` | Job tracking | `status` ENUM, `result` JSONB, `client_id` FK to tenant_clients |
| `raw_files` | File tracking | `storage_path`, `job_id` FK |
| `tenant_clients` | Client config | Easy: `slug='easy'`, `connector_type='csv_email'`, `connector_config` JSONB |

**Seed data already present:**
- Transportes Musan operator (slug: `transportes-musan`)
- Easy tenant_client (slug: `easy`, connector_type: `csv_email`)
- connector_config has column_map, csv_encoding, csv_delimiter, email_filter

**Orders unique constraint:** `UNIQUE (operator_id, order_number)` — this is the UPSERT conflict key.

**RLS:** All tables use `operator_id = public.get_operator_id()`. The n8n workflow uses `service_role` key which **bypasses RLS** — this is correct for server-side automation.

### Easy CSV Format Details

- **Encoding:** Latin-1 (ISO-8859-1) — NOT UTF-8
- **Delimiter:** Semicolon `;`
- **Cumulative behavior:** Each email's CSV contains ALL orders for the day so far. The 13:00 CSV includes orders from the 12:00 CSV plus new ones. UPSERT handles this naturally.
- **Key columns:** `N° CARGA` (order number), `NOMBRE CLIENTE`, `TELEFONO`, `DIRECCION ENTREGA`, `COMUNA`, `FECHA ENTREGA`, `TIPO SERVICIO`, `PESO KG`

### n8n Specific Notes

- **IMAP Trigger node:** Polls at configured interval, marks emails as read after processing (prevents re-processing). Set "Download Attachments" = true.
- **Spreadsheet File node:** Can parse CSV but may not support Latin-1 encoding natively. If encoding issues arise, use a **Code node** with `Buffer.from()` to convert Latin-1 to UTF-8 before parsing.
- **PostgreSQL node:** Required for UPSERT (ON CONFLICT). The Supabase node only supports basic CRUD — no ON CONFLICT support.
- **Supabase node:** Use for Storage uploads (binary upload to bucket).
- **Error Trigger node:** Catches workflow errors. Use it to update job status and send Sentry notification.

### Previous Story Intelligence (Story 2.4)

**Learnings from Story 2.4 (automation worker DB schema):**
- Migration file: `apps/frontend/supabase/migrations/20260223000001_create_automation_worker_schema.sql`
- All tables have RLS + audit triggers
- `connector_config` credentials use `ENCRYPTED:` prefix — decrypted at runtime by worker. For n8n, actual IMAP credentials are configured directly in n8n's credential store (not from connector_config).
- `set_updated_at()` trigger exists on tenant_clients and jobs tables
- Code review added `order_status_enum` for orders.status field
- The column_map in connector_config is the source of truth for CSV→orders field mapping

**Key files from recent work:**
- `apps/frontend/supabase/migrations/20260223000001_create_automation_worker_schema.sql` — schema reference
- `apps/worker/n8n/workflows/.gitkeep` — target location for workflow JSON
- `apps/worker/.env.example` — all VPS environment variables documented
- `apps/worker/README.md` — n8n setup and export procedures

### Git Intelligence

Recent commits show:
- Story 2.4 complete (automation worker schema) — `65d8929`
- Story 2.3 complete (VPS + n8n infrastructure) — `abef5ac`
- CI/CD pipeline tested and working — `5657df7`
- Code review patterns established: adversarial review with H/M/L severity

### What NOT To Do

- **Do NOT** use the Supabase node for order upserts — it doesn't support ON CONFLICT. Use PostgreSQL node with direct DB credentials.
- **Do NOT** try to read connector_config ENCRYPTED values from the database for IMAP credentials — configure IMAP credentials directly in n8n's credential manager.
- **Do NOT** modify SSH config, UFW, or fail2ban on the VPS.
- **Do NOT** bypass RLS concerns — service_role key correctly bypasses RLS for server-side automation.
- **Do NOT** create a new Supabase migration for this story — the schema is already complete from Story 2.4.
- **Do NOT** create a Node.js worker process — this story is entirely n8n workflow-based. The Node.js worker is Story 2.7.
- **Do NOT** include `status` in the ON CONFLICT DO UPDATE SET clause — cumulative CSV re-imports must not overwrite order status that may have been updated downstream (e.g., 'dispatched', 'delivered').
- **Do NOT** forget `imported_at` in the INSERT — it's NOT NULL with no default and will cause constraint violations.
- **Do NOT** iterate column_map as `{csvHeader: dbField}` — the DB stores it as `{dbField: "CSV Header"}`. Iterate: `for (const [dbField, csvHeader] of Object.entries(column_map))`.

### Project Structure Notes

```
apps/worker/
├── n8n/workflows/easy-csv-import.json  ← NEW: exported n8n workflow
├── .env.example                         ← reference for VPS env vars
├── README.md                            ← update with n8n workflow documentation
└── ...
```

No frontend code changes. No Supabase migrations. This is purely an n8n workflow + configuration story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5] — acceptance criteria and technical requirements
- [Source: _bmad-output/planning-artifacts/architecture.md] — n8n workflow pattern, system topology
- [Source: _bmad-output/implementation-artifacts/2-4-create-automation-worker-database-schema.md] — DB schema, connector_config, seed data
- [Source: apps/frontend/supabase/migrations/20260223000001_create_automation_worker_schema.sql] — migration reference
- [Source: apps/worker/.env.example] — VPS environment variables
- [Source: apps/worker/README.md] — n8n setup/export procedures

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Fixed node ordering bug: "Create Job Record" moved before "Has Attachment?" check so the no-attachment path has a valid job_id reference
- Added "Notify Sentry" HTTP node after "Update Job: Failed" for AC7 compliance
- Updated "Has Attachment?" binary check to reference email trigger explicitly: `$('Email Trigger (IMAP)').first().binary`
- **CRITICAL FIX:** connector_config.column_map was wrong — actual Easy CSV headers differ from what was specified in story/seed data
- **CRITICAL FIX:** Each CSV row = 1 carton/package, NOT 1 order. Workflow rebuilt to group by `Entrega` (order) and insert into both `orders` + `packages`
- **CRITICAL FIX:** `Entrega` is the real order number, `Nro Carga` is the load/manifest number (not the order key)
- Actual CSV columns: Anden, CD, Nro Carga, Entrega, Fecha Entrega, Tipo Orden, Cartón, Comuna, Región, Producto, Descripcion, Unid, Bultos, Nombre, Direccion, Telefono, Correo, Compl, Cant
- No PESO KG column in actual CSV — weight not available from Easy manifest
- Customer email (Correo) stored in orders.metadata since no customer_email column exists on orders table
- CSV has a metadata header row (row 0) before actual column headers (row 1) — parser auto-detects and skips it

### Completion Notes List

- ✅ Tasks 3-7: n8n workflow JSON fully rebuilt with correct Easy CSV structure — dual insert into `orders` (grouped by Entrega) + `packages` (one per carton row) with UPSERT for both tables
- ✅ Task 8: Workflow JSON saved to `apps/worker/n8n/workflows/easy-csv-import.json`
- ⏳ Tasks 1-2: Require manual n8n UI credential setup (IMAP + Supabase/PostgreSQL)
- ⏳ Task 9: Requires manual Supabase Storage bucket verification
- ⏳ Task 10: Requires live E2E test with real email
- ⚠️ connector_config.column_map in DB seed data is stale — workflow uses hardcoded correct column names from real CSV sample. Seed data should be updated in a future story.

### File List

- `apps/worker/n8n/workflows/easy-csv-import.json` — n8n workflow JSON (fully rebuilt: correct CSV columns, dual orders+packages insert, Sentry notification)
- `_bmad-output/implementation-artifacts/2-5-implement-easy-csv-email-connector.md` — story file (updated status + task checkboxes + debug log)
