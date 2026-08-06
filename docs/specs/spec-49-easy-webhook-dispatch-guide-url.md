# Spec 49 — Easy WMS Webhook: Store `url_guia` (Dispatch Guide URL) Verbatim

**Status:** backlog

## Problem

Easy (Cencosud) is about to activate their WMS webhook as the live integration channel for
Transportes Musan. Each `despacho` in their JSON payload carries `url_guia` — a Paperless PDF
link (`http://cencosud.paperless.cl:80/Facturacion/PDFServlet?docId=<token>`). This URL is the
**only** way to print the dispatch guide, so it must be stored in our DB exactly as received.

Two defects currently prevent that:

1. **The webhook silently fails on real payloads.** Easy posts JSON with a
   `application/x-www-form-urlencoded` content type. n8n's webhook node form-parses the body
   into a single `{"<json-up-to-first-=>": "<rest>"}` pair — the split lands inside the
   `url_guia` query string. `body.despachos` is `undefined`, the Map & Validate node returns
   early with "Empty despachos array", and the workflow still responds 200 OK. Evidence in
   prod: raw payload files exist in storage for many dates (2026-03-04 → 2026-04-17), yet only
   2 orders were ever imported via API; all 1,000 Easy orders came via the EMAIL CSV fallback,
   which has no `url_guia`.
2. **`url_guia` is dropped by the mapping.** Even when parsing succeeds, Map & Validate maps no
   dispatch guide field; the URL survives only inside `orders.raw_data`.

Form-decoding is also lossy: a `+` inside a `docId` token would decode to a space. Observed
tokens contain `/` and `(…)` so the charset cannot be assumed safe. Exactness therefore
requires reading the **raw request body**, never the form-parsed one.

## Decision (Approach A — approved 2026-08-06)

Fix inside the existing n8n workflow. No dependency on Easy changing their Content-Type
(we may still ask them to send `application/json` as belt-and-suspenders). No backfill of
existing EMAIL-imported orders — the webhook was never live.

## Design

### 1. Data model

New nullable column on `public.orders`:

```sql
alter table public.orders
  add column if not exists dispatch_guide_url text;

comment on column public.orders.dispatch_guide_url is
  'Retailer-provided URL to the printable dispatch guide PDF (e.g. Easy url_guia). Stored verbatim as received — never normalized, trimmed, or re-encoded.';
```

- Nullable: EMAIL/CSV imports have no URL.
- No index: never filtered on, only read per-order.
- Migration file: `packages/database/supabase/migrations/<YYYYMMDDHHMMSS>_spec49_add_dispatch_guide_url_to_orders.sql`
  (spec number embedded, matching the spec-45/47 migration naming).
- No RLS change needed — column inherits the orders table policies (operator-scoped).
- **Null-overwrite guard:** PostgREST bulk upserts require uniform keys, so every mapped order
  carries `dispatch_guide_url` (null when absent) — a webhook re-delivery without `url_guia`
  would otherwise wipe a previously stored URL. The same migration adds a `BEFORE UPDATE`
  trigger on `public.orders` that preserves the old value when the incoming one is null:
  `new.dispatch_guide_url := coalesce(new.dispatch_guide_url, old.dispatch_guide_url)`.
  A later non-null URL still updates normally.
  **Accepted trade-off:** the trigger is table-wide — no client (admin UI, future connector)
  can clear a stored URL back to null via a normal UPDATE. Deliberate clearing requires a
  direct SQL path (e.g. `set session_replication_role = replica` or dropping/re-creating the
  trigger). Story 2's pgTAP test pins this behavior for a non-webhook UPDATE too.

### 2. Tested re-implementation of the Code node logic

The Map & Validate logic lives only inside
[easy-wms-webhook.json](../../apps/worker/n8n/workflows/easy-wms-webhook.json), which is
untestable. Follow the existing precedent set by
[beetrack-map.test.ts](../../apps/worker/src/connectors/beetrack-map.test.ts): a test file
containing a TypeScript re-implementation of the Code node's functions, with a header comment
in both files warning that the two copies must be kept in sync. No exported module is added
(nothing in the worker imports it; it exists to make the logic testable).

- `apps/worker/src/connectors/easy-wms-map.test.ts` — contains and tests:
  - `parseEasyWmsBody(rawBody: string | undefined, parsedBody: unknown)` — resolution order:
    1. If a raw body string is available → `JSON.parse(rawBody)`. **This is the only
       lossless path.**
    2. Else if `parsedBody` is an object with a `despachos` array → use as-is
       (correct Content-Type case).
    3. Else if `parsedBody` is a non-empty object whose first key starts with `{` (the
       mangled form-parse shape) → reconstruct by joining **all** entries:
       `Object.entries(parsedBody).map(([k, v]) => v === '' ? k : k + '=' + v).join('&')`,
       then `JSON.parse`. This covers both the single-key case (no `&` in the JSON) and the
       multi-key case (literal `&` inside a JSON string value, e.g. an address). Set a
       `reconstructed: true` flag — this path is lossy for `+` (decoded to space) and `%xx`
       sequences, and `''`-valued keys are ambiguous (a trailing `=` cannot be distinguished
       from none).
    4. Else → throw (workflow error path marks the job failed).
  - `mapDespachos(payload, ctx)` — existing mapping plus, per order:
    `dispatch_guide_url: despacho.url_guia || null` — assigned verbatim, no `.trim()`, no
    `encodeURI`, no URL constructor round-trip. Note `|| null` deliberately coerces an
    empty-string `url_guia` to null (an empty string is not a usable URL); this is the only
    permitted transformation.

### 3. n8n workflow changes (`easy-wms-webhook.json` + live workflow `nhYC230w1ncOTo6e`)

1. **Webhook Trigger**: enable *Raw Body* (`options.rawBody: true`).
2. **Map & Validate**: read the raw body with
   `await this.helpers.getBinaryDataBuffer(0, 'data')` and decode as UTF-8 — this helper works
   in both n8n binary-data modes (`default` in-memory base64 and `filesystem`), unlike reading
   `binary.data.data` directly, which breaks under `N8N_DEFAULT_BINARY_DATA_MODE=filesystem`.
   Then run `parseEasyWmsBody(rawBodyString, $input.first().json.body)` and `mapDespachos`.
   Keep `raw_data: despacho` per order (now clean JSON). Pass the raw string through as
   `raw_body_string`, and the `reconstructed` flag into the job result.
   **Verification step (do not assume):** before finalizing Story 3, confirm on the actual
   n8n instance (a) which binary-data mode it runs, and (b) whether `json.body` is still
   populated alongside the raw body for this webhook node version — the fallback chain in
   `parseEasyWmsBody` tolerates either answer, but the test send must confirm the wiring.
3. **Upload Raw Payload**: upload `raw_body_string` byte-for-byte. If the raw body was
   unavailable and the payload came from reconstruction (path 3), upload the reconstructed
   string instead and record `raw_body_reconstructed: true` in the job result so the archive
   is never silently presented as pristine.
4. Everything else (job record, upserts, error path, 200 responses) unchanged.

The repo JSON is a sanitized backup; the live n8n workflow on the VPS must be updated by hand
to match. That step is deployment and happens only on the user's go-ahead.

### 4. Replay verification script

`scripts/replay-easy-webhook.mjs` — posts a stored raw payload file to a given webhook URL
with `Content-Type: application/x-www-form-urlencoded` (reproducing Easy's real behavior),
then queries orders and asserts each `dispatch_guide_url` is byte-identical to the `url_guia`
in the source file. Conventions (matching `scripts/backfill-dispatches.mjs`):

- Supabase URL and service-role key from `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars.
- Payload file path and target webhook URL are CLI args — pointed at QA/test n8n first, prod
  only on explicit instruction.
- Order matching: `order_number = entrega` **and** `operator_id = MUSAN_OPERATOR_ID`
  (`92dc5797-047d-458d-bbdb-63f18c0dd1e7`) — operator scoping is mandatory on every query.

## Error handling

- Unparseable body → throw in Map & Validate → existing error path (job `failed`, 200
  "processing error logged" response). No behavior change, but the failure is now *recorded*
  instead of a silent empty-despachos success.
- Missing `url_guia` on a despacho → order imported with `dispatch_guide_url = null`, warning
  appended to the job result (mirrors existing warning pattern). Never blocks the import.
- Multiple despachos per entrega: observed data is 1:1. If duplicates ever appear, the
  **first** despacho wins for `dispatch_guide_url` and all other order fields (matches the
  existing first-wins `raw_data` behavior); a warning is logged when a later despacho for the
  same entrega carries a *different* `url_guia`.
- Re-delivery without `url_guia`: the DB trigger (Design §1) preserves the previously stored
  URL — an incoming null never wipes a stored value.

## Stories (TDD order)

1. **Story 1 — Tested Code-node logic.** Write `easy-wms-map.test.ts` first: fixtures for
   (a) clean JSON body, (b) mangled single-key form shape taken from a real stored payload,
   (c) mangled multi-key shape (JSON containing a literal `&` in a string value), (d) raw
   string with wrong content type, (e) missing `url_guia` (order imported, null URL, warning),
   (f) empty-string `url_guia` (coerced to null), (g) duplicate entrega with differing URLs —
   assert first-URL-wins plus warning, (h) empty despachos. Assert `dispatch_guide_url`
   byte-equality against fixture source. Then implement the functions in the same file until
   green (test-only re-implementation, per beetrack-map precedent).
2. **Story 2 — Migration.** Schema test (pgTAP, `packages/database/supabase/tests/`) asserting
   the column exists, is `text`, nullable, and that an UPDATE with null `dispatch_guide_url`
   preserves an existing value (trigger behavior). Then the migration.
3. **Story 3 — Workflow JSON.** Update `easy-wms-webhook.json`: rawBody option, new Code node
   body pasted from the tested functions, raw-string storage upload. Update the `_comment`.
   Includes the live-instance verification step from Design §3.2 (binary-data mode and
   `json.body` availability).
4. **Story 4 — Replay script + end-to-end verification.** **Dependency:** requires a non-prod
   n8n target — either the spec-48 QA environment (not yet built) or a temporary test webhook
   path on the live instance. Stories 1–3 are complete and mergeable without Story 4; Story 4
   runs when a target exists, and the prod live-workflow update happens only on user
   instruction.

## Acceptance criteria

- A payload posted with `application/x-www-form-urlencoded` (real Easy behavior) imports all
  despachos as orders — no silent empty run.
- On the raw-body path (expected normal case), `orders.dispatch_guide_url` is byte-identical
  to the payload's `url_guia` for every order (empty string → null being the sole exception).
  On the reconstructed fallback path, values are best-effort and the job result carries
  `raw_body_reconstructed: true`.
- A payload posted with `application/json` behaves identically.
- When the raw body is available (expected normal case), raw payload files in storage are
  valid JSON, byte-identical to what Easy sent. When only the reconstructed fallback was
  possible, the file is valid JSON and the job result carries `raw_body_reconstructed: true`.
- All existing worker tests and DB schema tests still pass.

## Out of scope

- Frontend surfacing / print button (separate spec when needed).
- Backfill of existing EMAIL-imported orders.
- Asking Easy to fix their Content-Type (ops conversation, not code).
- Beetrack/Paris workflows.
