# Sprint Change Proposal — Easy WMS Webhook Integration
**Date:** 2026-03-04
**Prepared by:** Bob (Scrum Master)
**Status:** Pending Approval

---

## Section 1: Issue Summary

**Trigger:** Stakeholder meeting with Cesar Cancino (Cencosud/Easy WMS) on 2026-03-04.

**Problem statement:** The current Easy order ingestion (Story 2.5) uses n8n IMAP polling to parse daily CSV manifests sent via email. This approach has two limitations:

1. **Delayed ingestion** — orders arrive only when Easy sends the email, not in real-time
2. **Missing package/carton data** — the CSV does not include item-level detail (SKU, barcode, carton label, volume), so the `packages` table remains unpopulated for Easy orders

Easy WMS (Cencosud) now offers a **direct webhook** that pushes order data to us per load dispatch event. The payload includes full carton-level detail per order, enabling `packages` table population and real-time ingestion.

**Evidence:** Email from Cesar Cancino (cesar.cancino@cencosud.cl) dated 2026-03-04 + JSON payload sample (`json.json`) with 20 real orders across load `CARGACL30038696`, each with complete item/carton detail.

**Note on data consistency:** The existing n8n CSV workflow already uses `Entrega` as `order_number` and `Nro Carga` as `external_load_id` — consistent with the webhook mapping. The DB `connector_config.column_map` seed had stale values but the workflow code was correct. No historical data inconsistency.

---

## Section 2: Impact Analysis

### Epic Impact
- **Epic 2** (`done`): No impact. Story 2.5 (email connector) stays done. The new webhook is additive — email remains as fallback.
- **Epic 3A** (`in-progress`): New story `3a-7` added. No existing stories affected.
- **Epics 4 & 5** (`backlog`): Positive impact. Epic 4 (manifest scanning) depends on `packages` table being populated — the webhook directly enables this. Epic 5 (order tracking) benefits from real-time ingestion and richer data fields (`fecha_compromiso`, `url_guia`, `numero_guia`).

### Story Impact
| Story | Impact |
|-------|--------|
| Story 2.5 (Easy CSV/Email) | Downgraded to **fallback** — remains active but no longer primary. Documented limitation: populates orders only, no packages |
| **Story 3a-7 (NEW)** | Implement Easy WMS Webhook Receiver — primary ingestion path going forward |

### Artifact Conflicts
- **PRD**: FR10 explicitly states "ingest order data from retailer APIs via real-time webhooks" — this change **fulfills** the PRD as intended. No conflict.
- **Architecture**: New integration point — n8n Webhook node (staging + production URL). API key stored as n8n credential + `connector_config` in DB. No structural change.
- **Data Model**: No schema migrations required. All webhook fields map to existing columns. `packages` table already designed for this data.
- **connector_type_enum**: Already has `'api'` value — use for the new Easy webhook connector entry.

### Technical Impact
- Easy `tenant_client` in DB: add new row with `connector_type = 'api'` and `webhook_api_key` in `connector_config`
- n8n: new workflow `easy-wms-webhook.json` with Webhook node (Header Auth: `Token`)
- Old n8n `easy-csv-import` workflow: keep active as fallback. It already populates packages via `Cartón` column. Webhook is preferred as it provides more structured, reliable carton data. No changes needed to the CSV workflow.
- New VPS env var: `EASY_WMS_WEBHOOK_API_KEY` (staging + production values)

---

## Section 3: Recommended Approach

**Option 1 — Direct Adjustment** ✅ Selected

Add story `3a-7` to Epic 3A. No rollback, no scope reduction. The email connector stays active as fallback with documented limitations.

**Rationale:**
- Zero risk — purely additive change, nothing breaks
- Directly fulfills PRD FR10
- Unblocks Epic 4 by populating `packages` table with real carton data
- Effort: Medium (n8n workflow + DB entry + env vars + tests)
- The email fallback provides resilience if Easy WMS webhook goes down

---

## Section 4: Detailed Change Proposals

### Change 1: New Story in Epic 3A

**ADD:** Story `3a-7` — Implement Easy WMS Webhook Receiver

See full story spec in Section 4a below.

### Change 2: Update sprint-status.yaml

```yaml
# ADD under epic-3a section:
3a-7-implement-easy-wms-webhook-receiver: backlog
```

### Change 3: Update Easy tenant_client connector_config (migration)

Add new `tenant_clients` row for Easy Webhook (keep existing `easy` csv_email row):

```sql
INSERT INTO public.tenant_clients (operator_id, name, slug, connector_type, connector_config)
VALUES (
  '<musan_operator_id>',
  'Easy WMS Webhook (Cencosud)',
  'easy-webhook',
  'api',
  '{
    "webhook_api_key": "ENCRYPTED:easy_wms_webhook_api_key",
    "staging_url": "https://n8n.tractis.ai/webhook-test/easy-wms",
    "production_url": "https://n8n.tractis.ai/webhook/easy-wms"
  }'::jsonb
)
ON CONFLICT (operator_id, slug) DO NOTHING;
```

---

## Section 4a: Story 3a-7 — Easy WMS Webhook Receiver

### Story

As an operations manager at Transportes Musan,
I want the system to automatically receive and process order dispatches pushed by Easy WMS via webhook,
So that orders and packages are ingested in real-time with full carton-level detail as soon as Easy dispatches a load.

### Acceptance Criteria

**Given** the n8n webhook endpoint is active and Easy WMS is configured with our URL and API key
**When** Easy WMS sends a POST request to `https://n8n.tractis.ai/webhook/easy-wms` with header `Token: <api_key>`
**Then** n8n validates the `Token` header against the configured API key
**And** returns HTTP 200 immediately upon receiving the request
**And** for each `despacho` in the `despachos[]` array:
  - Upserts one row in `orders` using `(operator_id, order_number)` conflict key where `order_number = entrega`
  - Maps fields: `entrega → order_number`, `id_carga → external_load_id`, `fecha_compromiso → delivery_date`, `direccion → delivery_address`, `comuna → comuna`, `cliente_nombre → customer_name`, `cliente_telefono → customer_phone`
  - Stores full despacho JSON in `raw_data`, sets `imported_via = 'API'`, `tenant_client_id = easy-webhook client ID`
  - For each item in `despacho.items[]`, upserts one row in `packages` where `label = item.carton`, linking to the order via `order_id`
  - Maps package fields: `carton → label`, `bultos → declared_box_count`, `{sku, descripcion, cantidad, codigo_barra, mt3} → sku_items[]`, full item JSON → `raw_data`
**And** a job record is created/updated tracking `orders_upserted` and `packages_upserted` counts
**And** the raw webhook payload is stored to Supabase Storage: `raw-files/{operator_slug}/easy-webhook/{date}/carga-{id_carga}-{timestamp}.json`
**When** the `Token` header is missing or invalid
**Then** n8n returns HTTP 401 and logs the rejected request

**Given** the webhook endpoint receives a `despacho` whose `entrega` already exists in orders
**When** the same load is resent by Easy WMS (e.g., reprint event)
**Then** the existing order is updated (UPSERT) — no duplicate created
**And** packages for that order are also upserted by `(operator_id, label)` conflict key

### Edge Cases
- Invalid or missing `Token` header → HTTP 401, log to Sentry, do not process
- Empty `despachos[]` array → HTTP 200, log warning, job recorded with `orders_upserted = 0`
- `despachos[].items[]` is empty → upsert order only, no packages, log warning
- `latitud`/`longitud` present in payload → store in `raw_data` (no dedicated column yet)
- `cliente_correo` and `cliente_rut` → store in `raw_data` (no dedicated column in orders)
- Supabase upsert fails → log to Sentry, return HTTP 200 to Easy WMS (avoid retrigger storm), create failed job record
- `fecha_compromiso` missing or malformed → fall back to `fecha_carga`, log warning

### Technical Requirements

**n8n workflow:** `apps/worker/n8n/workflows/easy-wms-webhook.json`

Flow: `Webhook Trigger (POST, Header Auth: Token)` → `Validate Payload` → `For Each Despacho` → `Upsert Order (Supabase)` → `For Each Item → Upsert Package (Supabase)` → `Upload Raw Payload to Storage` → `Log Job Record` → `Return 200`

**Endpoints:**
- Staging: `https://n8n.tractis.ai/webhook-test/easy-wms` (n8n test URL)
- Production: `https://n8n.tractis.ai/webhook/easy-wms` (n8n production URL)

**Authentication:** n8n Webhook node Header Auth — credential name: `Easy WMS API Key`, header: `Token`

**DB operations (via Supabase service role key):**
- Orders: `INSERT INTO orders (...) ON CONFLICT (operator_id, order_number) DO UPDATE SET ...`
- Packages: `INSERT INTO packages (...) ON CONFLICT (operator_id, label) DO UPDATE SET ...`

**New VPS env vars:**
- `EASY_WMS_WEBHOOK_API_KEY` — shared with Cencosud for staging
- `EASY_WMS_WEBHOOK_API_KEY_PROD` — production key (rotate after staging validated)

**Migration:** New `tenant_clients` row for `easy-webhook` (connector_type `api`). No schema changes to orders or packages tables.

**Fallback:** `easy-csv-import` workflow stays active as-is — no changes needed. Webhook takes priority for new loads.

**Workflow export:** n8n workflow exported as JSON and committed to `apps/worker/n8n/workflows/easy-wms-webhook.json`

---

## Section 5: Implementation Handoff

**Scope classification: Minor** — Direct implementation by development team.

| Responsibility | Owner |
|---|---|
| Implement n8n webhook workflow | Dev agent |
| Create `easy-webhook` tenant_client DB entry (migration) | Dev agent |
| Configure VPS env vars + share staging URL/key with Cencosud | Gerhard (manual) |
| Validate with Cencosud on staging before production | Gerhard |
| Update epic/sprint tracking | SM (Bob) |

**Success criteria:**
1. Easy WMS can POST to staging URL and orders + packages appear in Supabase
2. Invalid Token returns 401
3. Duplicate `entrega` does not create duplicate orders (UPSERT confirmed)
4. `packages` table has carton-level rows linked to Easy orders
5. n8n workflow exported to repo and CI passes

---

*Prepared by Bob — Scrum Master | Aureon Last Mile | 2026-03-04*
