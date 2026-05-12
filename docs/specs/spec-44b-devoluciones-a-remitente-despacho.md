# spec-44b — Devoluciones a Remitente · Despacho Return Tab

**Status:** backlog

> **For agentic workers:** Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development` if subagents are available) to implement this plan once `writing-plans` has appended the chunked task list.
>
> **Depends on:** **spec-44a** (Devoluciones a Remitente · Stage Foundation) must be merged and deployed before this spec can be implemented. Spec-44b removes 44a's interim manual exit (`mark_returned_to_sender` + "Marcar devuelto" button) and replaces it with the truck-loading flow described here.

**Goal:** Add a 5th Despacho tab — "Devoluciones" — for building multi-stop return shipments by scanning package labels, generating a per-sender manifest PDF, dispatching the route through DispatchTrack with one stop per remitente, and auto-flipping orders to `returned` when DT marks the route completed.

**Architecture:** Reuse the existing `routes` table with a new `route_type` enum (`delivery` | `return`). A return shipment is a route with `route_type = 'return'`, scanned via the same `ScanZone` primitive as normal dispatch, pushed to DT with stops geocoded from each sender's new `return_pickup_address`. A Supabase Edge Function generates one manifest PDF per sender into Storage; a DB trigger flips order state on route completion. The 44a active-route mutual-exclusion triggers are amended to ignore return-type routes; a new trigger keeps return-type routes scoped to `ready_to_return` orders.

**Tech Stack:** Next.js 15 App Router, React, TanStack Query v5, shadcn/ui, Tailwind CSS, Supabase Postgres + RPCs + Edge Functions + Storage, DispatchTrack webhook integration (existing), Vitest + Testing Library, pgTAP.

---

## Background

Spec-44a delivers the Ops Control stage and the entry rules that put orders into `ready_to_return`. Its exit is a single-button "Marcar devuelto" action that simply flips state — useful for testing the stage in isolation, but not a real workflow. Operators actually need to:

1. Build a physical return shipment by scanning package labels off the warehouse floor.
2. Group those orders by sender automatically.
3. Hand the driver a signed manifest per sender (legal/audit document).
4. Track the truck via the same DispatchTrack pipeline the delivery routes already use.
5. Have order state auto-flip to `returned` when DT marks the return route completed — without manual reconciliation.

Spec-44b delivers that workflow, and removes 44a's interim manual exit in the same migration.

## Scope

**In:**

- New `routes.route_type` enum (`delivery` | `return`, default `delivery`).
- New `tenant_clients.return_pickup_address` (nullable jsonb: `{ line1, line2, city, region, postal_code, lat, lng }`).
- New `return_route_manifests` table: `(route_id, tenant_client_id, pdf_path, signed_by, signed_at, created_at)`. Composite primary key `(route_id, tenant_client_id)`.
- Migration amends 44a's `orders_return_state_route_guard` and `route_stops_return_state_guard` triggers to add `AND r.route_type = 'delivery'` to the active-route subquery — orders in `ready_to_return` may now be on `route_type='return'` routes.
- New trigger `route_stops_return_only_tg`: rejects assigning a non-`ready_to_return` order to a `route_type='return'` route.
- New trigger `routes_return_completion_tg`: when a `route_type='return'` route transitions to `status='completed'`, sets every linked order's `return_to_sender_state = 'returned'` and writes audit rows.
- New RPC `mark_return_manifest_signed(p_route_id, p_tenant_client_id, p_operator_id, p_signed_by)`: writes `signed_by` + `signed_at`. Idempotent.
- Removal of 44a's `mark_returned_to_sender` RPC (callers are deleted in this spec — no production callers other than the to-be-removed UI button).
- New Edge Function `generate-return-manifests` (Deno): consumes `route_id`, builds one PDF per sender, uploads to Supabase storage at `return-manifests/<route_id>/<tenant_client_id>.pdf`, inserts `return_route_manifests` rows.
- Despacho page: new 5th tab "Devoluciones." KPI strip gains one card: "Pendientes de devolución" = count of `ready_to_return` orders not yet on any route.
- Devoluciones tab body: a "Nueva Devolución" button + two sub-sections (Abiertas, Despachadas) — Abiertas lists `route_type='return'` routes in `draft`/`planned`; Despachadas lists `in_progress`/`completed` from the last 14 days.
- `ReturnRouteBuilder` component at `/app/dispatch/<routeId>` when `routes.route_type='return'`: scan zone, validation (state + sender address + uniqueness), group-by-sender display with un-scan, truck selector, "Close & Dispatch" that triggers manifest generation + DT push.
- `ReturnToSenderPanel` (from 44a) updates: the "Marcar devuelto" button is removed. Rows scanned into a return route show a read-only badge "En devolución (Ruta #N)" linking to the route detail page.
- DispatchTrack push payload mapper: one DT "stop" per sender, geocoded from `return_pickup_address`, `customer_name = tenant_clients.name`, `reference` = comma-joined order IDs. **Implementation pre-step:** read the existing DT push mapper (find via `grep -ri 'DispatchTrack\|dispatch_track' apps/frontend/src/app/api/dispatch`) and confirm exact field names + any length limit on the `reference` field; if DT truncates references, fall back to writing the order-ID list into a structured "notes" field. Do not lock the payload shape until this check is done.
- DT webhook handler (existing route status handler) extended to recognise `route_type='return'` and let the new completion trigger fire normally.

**Out:**

- Threshold or cron-triggered automatic return-shipment creation — manual on-demand only in this spec.
- Tiered evidence bundles (per-attempt photo/timestamp/driver detail) — minimal manifest only.
- Sender e-signature capture (manifest is signed by hand on arrival).
- Stop sequencing optimisation (DT owns it).
- Truck volume / capacity estimation in the builder.
- Re-routing or partial-delivery semantics on return routes (a return either completes or is cancelled wholesale).
- Mobile/tablet builder layout — desktop dispatch only (matches existing builder).

---

## Data model

### `routes` (modified)

| Column | Type | Default | Notes |
|---|---|---|---|
| `route_type` | enum `route_type_kind` | `'delivery'` | New enum: `delivery`, `return`. |

### `tenant_clients` (modified)

| Column | Type | Default | Notes |
|---|---|---|---|
| `return_pickup_address` | jsonb | `null` | Required (non-null) before that sender's orders can be scanned into a return route. Shape: `{ line1, line2 (nullable), city, region, postal_code, lat, lng }`. |

### `return_route_manifests` (new)

| Column | Type | Notes |
|---|---|---|
| `route_id` | uuid | FK → `routes.id`, ON DELETE CASCADE |
| `tenant_client_id` | uuid | FK → `tenant_clients.id` |
| `operator_id` | uuid | FK → `operators.id` (RLS scoping) |
| `pdf_path` | text | `return-manifests/<route_id>/<tenant_client_id>.pdf` |
| `signed_by` | text | nullable — sender's signatory name |
| `signed_at` | timestamptz | nullable |
| `created_at` | timestamptz | default `now()` |

Composite primary key `(route_id, tenant_client_id)`. Index on `(operator_id, route_id)` for RLS scans. RLS policy follows the repo's standard pattern (operator scoping via `auth.uid()` → operator_id, matching the surrounding tables). The Edge Function runs with service-role credentials and writes `operator_id` explicitly from the source `routes.operator_id`.

**Regeneration semantics:** `generate-return-manifests` is idempotent — re-running it overwrites the PDFs at the same storage paths but inserts manifest rows with `ON CONFLICT (route_id, tenant_client_id) DO NOTHING`. This intentionally preserves any prior `signed_by` / `signed_at` values on the existing rows, so a regeneration triggered after the manifest has been signed does not erase the audit trail.

### Trigger amendments

- **`orders_return_state_route_guard`** (44a, amended): add `AND r.route_type = 'delivery'` to the EXISTS subquery so a `ready_to_return` order may be on a `route_type='return'` route.
- **`route_stops_return_state_guard`** (44a, amended): same `route_type = 'delivery'` filter so the symmetric check only fires for delivery routes.
- **`route_stops_return_only_tg`** (new): BEFORE INSERT/UPDATE on `route_stops`; when the target route has `route_type='return'`, raise unless the order's `return_to_sender_state = 'ready_to_return'`.
- **`routes_return_completion_tg`** (new): AFTER UPDATE OF status on `routes`; when NEW.route_type = 'return' AND NEW.status = 'completed' AND OLD.status <> 'completed', set `return_to_sender_state = 'returned'` ONLY for linked orders whose **current** state is `ready_to_return` (guards against accidentally overwriting `null` or already-`returned` rows linked via stale stops). Write `audit_logs` rows for every order actually mutated.

---

## Data flow

```
Operator clicks "Nueva Devolución"
  └─ POST /api/dispatch/routes  ──► routes row, route_type='return', status='draft'
                                    redirect to /app/dispatch/<id>

ReturnRouteBuilder (scan loop)
  └─ scan package label
       └─ validate:
            • package.order.return_to_sender_state = 'ready_to_return'
            • tenant_clients.return_pickup_address IS NOT NULL
            • not already on another open return route
       └─ insert route_stops row (or update if sender's stop already exists)
       └─ trigger route_stops_return_only_tg enforces invariant

Operator clicks "Close & Dispatch"
  ├─ POST /api/dispatch/routes/:id/dispatch  (existing endpoint, route_type-aware)
  │    └─ call DispatchTrack with payload: one stop per sender
  │         (customer_name = tenant.name; address = return_pickup_address;
  │          reference = order IDs joined)
  │    └─ on success: routes.status = 'planned'
  └─ invoke Edge Function generate-return-manifests(route_id)
       └─ for each sender on the route:
            • build PDF (table of orders, header, footer, signature block)
            • upload to Supabase storage at return-manifests/<route_id>/<tenant>.pdf
            • insert return_route_manifests row

DT webhook: route.status = 'in_progress' ──► routes.status = 'in_progress' (existing handler)
DT webhook: route.status = 'completed'  ──► routes.status = 'completed'
                                          └─ trigger routes_return_completion_tg
                                                └─ orders.return_to_sender_state = 'returned'
                                                └─ audit_logs row per order

(Optional, post-arrival) Ops clicks "Marcar firmado" per sender row
  └─ RPC mark_return_manifest_signed(route_id, tenant_client_id, operator_id, signed_by)
       └─ return_route_manifests.signed_by + signed_at populated
```

---

## File structure

```
NEW
  packages/database/supabase/migrations/
    <ts>_spec44b_route_type_and_return_pickup.sql
      - enum route_type_kind
      - routes.route_type column + default
      - tenant_clients.return_pickup_address column
      - return_route_manifests table + RLS
      - amend 44a triggers (orders_return_state_route_guard, route_stops_return_state_guard)
      - new trigger route_stops_return_only_tg
      - new trigger routes_return_completion_tg
      - drop function mark_returned_to_sender (44a's deprecated exit)
      - function mark_return_manifest_signed
      - pgTAP tests alongside (per repo convention)

  supabase/functions/generate-return-manifests/
    index.ts                        Deno Edge Function: build PDFs, upload, insert rows
    pdf.ts                          PDF rendering (use pdf-lib or similar)
    index.test.ts                   unit tests with fixture routes

  apps/frontend/src/components/dispatch/return/
    ReturnRouteBuilder.tsx          builder shell when route_type='return'
    ReturnRouteBuilder.test.tsx
    ReturnScanZone.tsx              thin wrapper around ScanZone with return-specific validators
    ReturnScanZone.test.tsx
    ReturnSenderGroup.tsx           collapsible group of scanned orders per sender
    ReturnSenderGroup.test.tsx
    DevolucionesTab.tsx             5th Despacho tab body (Abiertas + Despachadas sections)
    DevolucionesTab.test.tsx
    ReturnRouteTile.tsx             tile card for return routes (variant of RouteListTile)
    ReturnRouteTile.test.tsx

  apps/frontend/src/hooks/dispatch/return/
    useCreateReturnRoute.ts
    useCreateReturnRoute.test.ts
    useDispatchReturnRoute.ts       wraps dispatch endpoint + manifest Edge Function call
    useDispatchReturnRoute.test.ts
    useReturnRoutes.ts              fetches routes filtered by route_type='return' + status
    useReturnRoutes.test.ts
    useMarkManifestSigned.ts
    useMarkManifestSigned.test.ts

MODIFIED
  apps/frontend/src/app/app/dispatch/
    page.tsx                        add 5th tab "Devoluciones", KPI card, route_type-aware new-route handler
    page.test.tsx                   coverage for new tab + KPI + new-route flow

  apps/frontend/src/app/app/dispatch/[routeId]/
    page.tsx                        branch render on route_type — delivery uses existing builder, return uses ReturnRouteBuilder

  apps/frontend/src/app/api/dispatch/
    routes/route.ts                 POST accepts optional `route_type` (default 'delivery')
    routes/[id]/dispatch/route.ts   on dispatch, if route_type='return', invoke generate-return-manifests after DT push succeeds

  apps/frontend/src/hooks/dispatch/
    useDispatchKPIs.ts              add "Pendientes de devolución" count
    useDispatchKPIs.test.ts

  apps/frontend/src/app/app/operations-control/components/stage-panels/
    ReturnToSenderPanel.tsx         remove "Marcar devuelto" button; add "En devolución (Ruta #N)" badge linking to return route
    ReturnToSenderPanel.test.tsx    update tests for badge + removal of action

  apps/frontend/src/lib/types.ts    Route type gains route_type; TenantClient gains return_pickup_address

REMOVED (deprecated 44a artifacts)
  apps/frontend/src/hooks/ops-control/useMarkReturnedToSender.ts
  apps/frontend/src/hooks/ops-control/useMarkReturnedToSender.test.ts
```

All new files stay under 300 lines. `ReturnRouteBuilder` delegates to `ReturnScanZone`, `ReturnSenderGroup`, and the existing `StagePanel`/dispatch primitives.

---

## Error handling & edge cases

- **Scan of an order not in `ready_to_return`** → toast `"Orden no está lista para devolución"`; scan rejected; nothing inserted (also caught by `route_stops_return_only_tg` as a defence-in-depth).
- **Scan of an order whose sender has no `return_pickup_address`** → toast `"Remitente <name> sin dirección de retiro. Configurar en admin antes de despachar."`; scan rejected. The check runs client-side at scan time and is re-asserted server-side at dispatch time.
- **Scan of a package already on another open return route** → toast `"Paquete ya está en devolución #N"`; scan rejected.
- **Un-scan after dispatch** → blocked at UI and API. The freeze gate is `routes.status != 'draft'`, **not** manifest-row presence. Once the operator clicks "Close & Dispatch" and the route advances out of `draft`, scans and un-scans are rejected regardless of whether the manifest Edge Function has succeeded yet. Only full route cancellation is allowed thereafter.
- **DT push fails** → route stays in `draft`; manifest Edge Function is NOT invoked; error surfaced via toast; operator can retry. Idempotency: the dispatch endpoint detects duplicate DT route IDs and short-circuits.
- **Manifest Edge Function fails after DT push succeeded** → route stays in `planned`, manifest rows missing; a `dispatch_warnings` audit row is written. An ops-only "Regenerar manifiestos" button on the route detail re-invokes the function. The state-flip trigger does NOT depend on manifest rows existing — manifests are documentation, not a state gate.
- **DT webhook arrives but a manifest row is missing** → completion trigger fires anyway; warning logged in `audit_logs`.
- **Return route cancelled mid-flight** (DT cancellation or operator action) → no order state change; orders remain `ready_to_return` and reappear in the unscanned bucket for the next shipment. `return_route_manifests` rows are kept for audit (not deleted).
- **Sender's `return_pickup_address` changes after route push** → DT push payload was a snapshot; the in-flight route keeps its original address. The new address applies to future routes only. Documented; no live update.
- **Order in `pending_confirmation`** is scanned → rejected (only `ready_to_return` is scannable).
- **Concurrent `Close & Dispatch` on the same route** → `routes.status` UPDATE is row-locked; second caller observes `status != 'draft'` and aborts.

### Backwards compatibility with 44a

- 44a's `mark_returned_to_sender` RPC is dropped in this spec's migration. No production callers other than the to-be-removed UI button. A removal note is included at the top of the migration explaining the deprecation.
- 44a's "Marcar devuelto" button is removed from `ReturnToSenderPanel`. Tests are updated to assert the button is absent and the new badge appears for orders linked to a return route.

---

## Testing strategy

TDD per CLAUDE.md. Tests written first, then implementation.

- **Migration / DB**
  - Enum `route_type_kind` exists with `delivery`, `return`.
  - `routes.route_type` default `delivery`; existing rows backfilled.
  - `tenant_clients.return_pickup_address` nullable jsonb.
  - `return_route_manifests` table + composite PK + RLS policy enforcing operator scoping.
  - 44a triggers amended: regression test asserts a `ready_to_return` order CAN be on a `route_type='return'` route in **`draft`** (the builder state), `planned`, and `in_progress`, and CANNOT be on a `route_type='delivery'` route in any of those statuses. The `draft` case specifically exercises the scan-while-building flow.
  - `route_stops_return_only_tg` rejects non-`ready_to_return` orders on return routes.
  - `routes_return_completion_tg`: flipping `route.status` to `completed` on a return route flips every linked order's `return_to_sender_state` to `returned` and writes audit rows; the same transition on a delivery route does NOT flip any return state.
  - `mark_returned_to_sender` is dropped (function not present).

- **RPC: `mark_return_manifest_signed`**
  - Happy path writes `signed_by` + `signed_at`.
  - Idempotent on repeat calls.
  - Operator scoping rejects cross-operator calls.
  - Raises if `return_route_manifests` row does not exist.

- **Edge Function `generate-return-manifests`**
  - Fixture route with 3 senders → 3 PDFs uploaded at the expected storage paths, 3 manifest rows inserted.
  - Sender with missing `return_pickup_address` → function raises before any PDF is generated (defensive — pre-dispatch validation should have caught it).
  - PDF golden snapshot for: header values, order rows, totals, signature block.
  - Idempotency: calling the function twice for the same route overwrites PDFs and `INSERT ... ON CONFLICT DO NOTHING` for manifest rows.

- **DispatchTrack push mapper**
  - Return route with 3 senders × 5 orders builds a 3-stop payload with the right addresses and references.
  - Sender's `return_pickup_address.lat/lng` flows into the DT stop coordinates.
  - Delivery routes are unchanged (regression).

- **Frontend: `useDispatchKPIs`**
  - Returns `pendientesDeDevolucion` = count of orders in `ready_to_return` not on any route (left-join `route_stops` where the route is non-cancelled).

- **Frontend: Devoluciones tab**
  - Renders sections "Abiertas" and "Despachadas" with the right route filters.
  - "Nueva Devolución" creates a `route_type='return'` route and navigates.
  - Header chip / badge shows "Devolución" on return routes.

- **Frontend: `ReturnRouteBuilder`**
  - Scan validates state + sender address + uniqueness; rejected scans show the right toast.
  - Successful scan adds the package and groups by sender.
  - Un-scan removes the package; if it was the last package for a sender, removes the stop.
  - "Close & Dispatch" calls the dispatch endpoint then the Edge Function; on success the route is in `planned` and the page shows manifest links per sender.
  - Manifest generation failure path: surfaces a warning + "Regenerar manifiestos" button.

- **Frontend: `ReturnToSenderPanel` (44a regression)**
  - "Marcar devuelto" button is absent.
  - Orders linked to an open return route show "En devolución (Ruta #N)" with a working link.

- **DT webhook handler**
  - Completion webhook on a return route triggers the DB trigger and the orders become `returned`.
  - Cancellation webhook on a return route leaves orders in `ready_to_return`.

---

## Open questions

None at brainstorming time. All known questions resolved in the brainstorming dialogue:

- Operational model (hybrid: full truck, multi-stop, periodic) — **resolved**.
- Build mechanism (manual scan-to-build) — **resolved**.
- DT integration (hybrid: DT for transit, manifest PDF for documentation) — **resolved**.
- Manifest depth (minimal manifest, signature at the bottom) — **resolved**.
- State machine (no new intermediate state; route completion flips order state via trigger) — **resolved**.

---

## Out-of-scope follow-ups

- Threshold/cron auto-suggested return shipments (Q2 options B/C/D).
- Tiered evidence bundles with per-attempt detail + photos (Q4 options B/C).
- Sender e-signature capture (kiosk or driver tablet).
- Capacity / volume estimation in the builder.

---

## Implementation plan

> Steps use checkbox (`- [ ]`) syntax. Each task is bite-sized (≈2–5 min). TDD throughout: failing test → minimal implementation → green → commit. Use `superpowers:subagent-driven-development` (parallel) or `superpowers:executing-plans` (sequential) to execute.

### Conventions

- Migrations: `packages/database/supabase/migrations/<ts>_spec44b_<slug>.sql`. Use current UTC timestamp. Follow the style of `20260506000001_fix_dock_scan_status_cast.sql`. Always template a `CREATE OR REPLACE FUNCTION` from the **latest** existing definition (per CLAUDE.md rule).
- Edge Functions live at `packages/database/supabase/functions/<name>/index.ts` (e.g. existing `dispatchtrack-route-poll`). Mirror that structure for `generate-return-manifests`.
- DT integration lives at `apps/frontend/src/lib/dispatchtrack-api.ts` — the **only** place that talks to DT. All new return-route payload construction goes here.
- Frontend tests: Vitest + RTL, colocated `*.test.tsx`/`*.test.ts`. Run with `pnpm -F frontend test <path>`.
- DB tests: pgTAP, `pnpm -F database test`.
- One commit per task. Conventional commits: `feat(spec-44b): …`, `test(spec-44b): …`.

---

## Chunk 1 — DB foundation + trigger amendments

**Files:**
- Create: `packages/database/supabase/migrations/<ts>_spec44b_route_type_and_manifests.sql`

### Task 1.1 — Enum, columns, manifest table

- [ ] **Step 1: Add enum and columns.**
  ```sql
  create type public.route_type_kind as enum ('delivery', 'return');

  alter table public.routes
    add column route_type public.route_type_kind not null default 'delivery';

  alter table public.tenant_clients
    add column return_pickup_address jsonb null;
  ```
- [ ] **Step 2: Create manifest table + RLS.**
  ```sql
  create table public.return_route_manifests (
    route_id          uuid not null references public.routes(id) on delete cascade,
    tenant_client_id  uuid not null references public.tenant_clients(id),
    operator_id       uuid not null references public.operators(id),
    pdf_path          text not null,
    signed_by         text null,
    signed_at         timestamptz null,
    created_at        timestamptz not null default now(),
    primary key (route_id, tenant_client_id)
  );
  create index return_route_manifests_operator_route_idx
    on public.return_route_manifests (operator_id, route_id);
  alter table public.return_route_manifests enable row level security;
  -- RLS policy mirrors surrounding tables; copy the policy template from
  -- the most recent migration that adds RLS to an operator-scoped table.
  ```
- [ ] **Step 3: Failing pgTAP tests:** enum exists; `routes.route_type` default `'delivery'`; backfill applied to existing routes; `return_pickup_address` nullable jsonb; manifest table + composite PK + index + RLS enabled.
- [ ] **Step 4: Run tests, verify pass.** `pnpm -F database test`
- [ ] **Step 5: Commit.** `feat(spec-44b): route_type enum, return_pickup_address, manifest table`

### Task 1.2 — Amend 44a active-route guards

- [ ] **Step 1: Locate latest definitions** of `orders_return_state_route_guard` and `route_stops_return_state_guard`. Grep `packages/database/supabase/migrations/` for the function names; pick the lexicographically last file. Copy those `CREATE OR REPLACE FUNCTION` bodies as the template (per CLAUDE.md).
- [ ] **Step 2: Failing pgTAP regression tests:**
  - A `ready_to_return` order CAN be on a `route_type='return'` route in `draft`, `planned`, and `in_progress`.
  - A `ready_to_return` order CANNOT be on a `route_type='delivery'` route in any of those statuses (cross-table guard still fires).
  - The `draft` case specifically uses the scan-while-building flow (insert into `route_stops` while route is still `draft`).
- [ ] **Step 3: Implement** by appending `CREATE OR REPLACE` of both functions to the migration. In each, add `AND r.route_type = 'delivery'` to the EXISTS subquery that walks `routes`.
- [ ] **Step 4: Run tests.** **Step 5: Commit.** `feat(spec-44b): scope 44a active-route guards to delivery routes`

### Task 1.3 — `route_stops_return_only_tg` (return-route invariant)

- [ ] **Step 1: Failing pgTAP tests:** inserting a `route_stops` row for a `route_type='return'` route where the order is NOT in `return_to_sender_state = 'ready_to_return'` raises. The same insert for a `route_type='delivery'` route is unaffected.
- [ ] **Step 2: Implement:**
  ```sql
  create or replace function public.route_stops_return_only_guard()
    returns trigger language plpgsql as $$
  declare
    v_route_type public.route_type_kind;
    v_state public.return_to_sender_state;
  begin
    select route_type into v_route_type from public.routes where id = NEW.route_id;
    if v_route_type <> 'return' then return NEW; end if;

    select return_to_sender_state into v_state from public.orders where id = NEW.order_id;
    if v_state is distinct from 'ready_to_return' then
      raise exception 'order % not in ready_to_return — cannot add to return route %', NEW.order_id, NEW.route_id
        using errcode = 'check_violation';
    end if;
    return NEW;
  end $$;
  create trigger route_stops_return_only_tg
    before insert or update of order_id, route_id on public.route_stops
    for each row execute function public.route_stops_return_only_guard();
  ```
  (Confirm `route_stops` table + columns; if the assignment table differs, substitute.)
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): return route stops require ready_to_return`

### Task 1.4 — `routes_return_completion_tg` (state flip on completion)

- [ ] **Step 1: Failing pgTAP tests:**
  - Updating a `route_type='return'` route from `in_progress` → `completed` flips `return_to_sender_state` to `'returned'` for every linked order **currently** in `ready_to_return`.
  - Orders linked to the route with state NULL or already `returned` are NOT mutated.
  - Audit log row is written per actually-mutated order.
  - Same status transition on a `route_type='delivery'` route does NOT touch any return state.
  - Status transitions other than `→ completed` (e.g., `planned → in_progress`) do NOT flip state.
- [ ] **Step 2: Implement** as AFTER UPDATE OF status:
  ```sql
  create or replace function public.routes_return_completion_guard()
    returns trigger language plpgsql security definer as $$
  begin
    if NEW.route_type <> 'return' then return NEW; end if;
    if NEW.status <> 'completed' or OLD.status = 'completed' then return NEW; end if;

    with flipped as (
      update public.orders o
        set return_to_sender_state = 'returned'
        from public.route_stops rs
        where rs.route_id = NEW.id
          and rs.order_id = o.id
          and o.return_to_sender_state = 'ready_to_return'
      returning o.id, o.operator_id
    )
    insert into public.audit_logs (operator_id, entity_type, entity_id, action, metadata)
    select operator_id, 'order', id, 'return_to_sender.completed',
           jsonb_build_object('route_id', NEW.id)
    from flipped;
    return NEW;
  end $$;
  create trigger routes_return_completion_tg
    after update of status on public.routes
    for each row execute function public.routes_return_completion_guard();
  ```
  Confirm `audit_logs` schema (columns + types) by reading the most recent audit-related migration before locking the insert column list.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): route completion flips orders to returned`

### Task 1.5 — Drop 44a's `mark_returned_to_sender`

- [ ] **Step 1: Failing pgTAP test:** asserting the function does NOT exist after the migration (via `pg_proc` lookup). Initially fails because the function is still present.
- [ ] **Step 2: Implement.**
  ```sql
  -- spec-44b deprecates 44a's interim manual exit; route completion is
  -- now the authoritative state transition (see routes_return_completion_tg).
  drop function if exists public.mark_returned_to_sender(uuid, uuid);
  ```
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): drop mark_returned_to_sender (deprecated by route completion trigger)`

---

## Chunk 2 — `mark_return_manifest_signed` RPC

**Files:**
- Create: `packages/database/supabase/migrations/<ts>_spec44b_mark_manifest_signed.sql` (separate, small migration)

### Task 2.1 — RPC

- [ ] **Step 1: Failing pgTAP tests:**
  - Writes `signed_by` + `signed_at` for an existing manifest row.
  - Idempotent: second call with same args overwrites with the new `signed_at` (or no-ops — pin in the test; recommendation: overwrite, so re-signing is captured).
  - Operator-scoping: cross-operator call raises.
  - Raises if `return_route_manifests` row does not exist.
- [ ] **Step 2: Implement.**
  ```sql
  create or replace function public.mark_return_manifest_signed(
    p_route_id          uuid,
    p_tenant_client_id  uuid,
    p_operator_id       uuid,
    p_signed_by         text
  ) returns void language plpgsql security definer
  set search_path = public, pg_temp as $$
  begin
    update public.return_route_manifests
      set signed_by = p_signed_by,
          signed_at = now()
      where route_id = p_route_id
        and tenant_client_id = p_tenant_client_id
        and operator_id = p_operator_id;
    if not found then
      raise exception 'manifest not found for route % / tenant %', p_route_id, p_tenant_client_id;
    end if;
  end $$;
  grant execute on function public.mark_return_manifest_signed(uuid, uuid, uuid, text) to authenticated;
  ```
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): mark_return_manifest_signed RPC`

---

## Chunk 3 — DispatchTrack payload mapper

**Files:**
- Modify: `apps/frontend/src/lib/dispatchtrack-api.ts` + `dispatchtrack-api.test.ts`

### Task 3.1 — Verify DT field shape

- [ ] **Step 1: Read `dispatchtrack-api.ts`** end-to-end. Identify: the function that builds the stop payload for a delivery route, the field names DT actually expects, and any length limits or shape constraints on `reference` / `customer_name` / `address`.
- [ ] **Step 2: Document findings inline** (a `// @return-route-payload-notes:` comment block at the top of the file, ≤ 10 lines, listing the field names, types, and any DT quirks). This becomes the contract for Task 3.2.
- [ ] **Step 3: Commit.** `docs(spec-44b): document DT payload contract for return routes`

### Task 3.2 — Return-route stop mapper

- [ ] **Step 1: Failing tests** in `dispatchtrack-api.test.ts`:
  - `buildReturnRouteStops(orders[])` groups orders by `tenant_client_id`.
  - Each group → one DT stop with: `customer_name = tenant_clients.name`, `address` and `lat/lng` from `tenant_clients.return_pickup_address`, `reference` = comma-joined order IDs (or whatever Task 3.1 found DT accepts; if `reference` is length-limited, the test asserts overflow into a secondary `notes` field).
  - A sender without `return_pickup_address` raises `MissingReturnAddressError` with the sender's name.
  - 50 orders across 3 senders produces 3 stops, not 50.
- [ ] **Step 2: Implement** `buildReturnRouteStops(orders)` exporting a typed mapper. Keep delivery-stop construction untouched; export the new function alongside.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): DT return-route stop mapper`

---

## Chunk 4 — Edge Function `generate-return-manifests`

**Files:**
- Create: `packages/database/supabase/functions/generate-return-manifests/index.ts`
- Create: `packages/database/supabase/functions/generate-return-manifests/pdf.ts`
- Create: `packages/database/supabase/functions/generate-return-manifests/index.test.ts`

### Task 4.1 — Scaffold function shell

- [ ] **Step 1: Read** `packages/database/supabase/functions/dispatchtrack-route-poll/index.ts` to learn the project's Edge Function conventions (CORS, auth, service-role client, error envelope).
- [ ] **Step 2: Failing test:** POST to the function with a fake `route_id` returns `400` for missing param and `404` when the route doesn't exist.
- [ ] **Step 3: Implement** the request handler skeleton mirroring `dispatchtrack-route-poll`. No PDF logic yet.
- [ ] **Step 4: Run tests.** **Step 5: Commit.** `feat(spec-44b): generate-return-manifests scaffold`

### Task 4.2 — PDF rendering

- [ ] **Step 1: Pick a PDF library compatible with Deno.** Primary choice: `pdf-lib` via `npm:pdf-lib@1.17.1` (Deno supports `npm:` specifiers). Fallback if the `npm:` specifier fails in the Supabase Deno runtime: `https://esm.sh/pdf-lib@1.17.1` (the import map should reference whichever works). After the first deploy, manually verify cold-start time is under ~2s; if exceeded, defer PDF generation to a queue (out of scope for 44b, but flag in `audit_logs` if observed).
- [ ] **Step 2: Failing test** in `pdf.ts.test.ts` (or co-located inside `index.test.ts`):
  - `renderManifestPdf({ routeId, tenant, orders })` produces a PDF byte array.
  - Header contains `tenant.name` and the route ID.
  - Each order appears as a row with `order_id`, `customer_name`, `package_count`, `reason_code`.
  - Footer has totals (orders, packages) and a signature block with the labels "Firma" / "Nombre" / "Fecha".
- [ ] **Step 3: Implement** `renderManifestPdf` using pdf-lib's page + text APIs. Keep the file under 200 lines; if it bloats, extract the table renderer.
- [ ] **Step 4: Run tests.** **Step 5: Commit.** `feat(spec-44b): manifest PDF rendering`

### Task 4.3 — Storage upload + manifest row insert (idempotent)

- [ ] **Step 1: Failing test:** read `packages/database/supabase/functions/dispatchtrack-route-poll/index.test.ts` first to learn the project's Supabase-client mocking pattern (likely `createMockSupabaseClient` or similar). Use the same pattern here — do NOT spin up a real storage backend. Test asserts: with a fixture route + 3 senders, `storage.from('return-manifests').upload` is called 3× with the expected paths, and `db.from('return_route_manifests').insert` is called 3× with the expected rows. Re-running the function with the same `route_id` calls `upload` again (overwrite via `upsert: true`) and inserts manifest rows that no-op on conflict (assert by inspecting the call options).
- [ ] **Step 2: Failing test:** if any sender lacks `return_pickup_address`, the function raises `MissingReturnAddressError` BEFORE any PDF is generated (no partial state).
- [ ] **Step 3: Implement** the orchestration loop:
  ```ts
  // pseudo:
  for (const senderGroup of groupBySender(orders)) {
    if (!senderGroup.tenant.return_pickup_address) throw new MissingReturnAddressError(senderGroup.tenant.name);
  }
  for (const senderGroup of groupBySender(orders)) {
    const pdf = await renderManifestPdf(senderGroup);
    await storage.from('return-manifests').upload(path, pdf, { upsert: true });
    await db.from('return_route_manifests').insert({...}).onConflictDoNothing();
  }
  ```
- [ ] **Step 4: Run tests.** **Step 5: Commit.** `feat(spec-44b): generate-return-manifests upload + idempotent row insert`

---

## Chunk 5 — Dispatch API extensions

### Task 5.1 — `POST /api/dispatch/routes` accepts `route_type`

**Files:** `apps/frontend/src/app/api/dispatch/routes/route.ts` + `route.test.ts`

- [ ] **Step 1: Failing test:** `POST` with body `{ route_type: 'return' }` creates a `routes` row with `route_type='return'`, `status='draft'`. No body → defaults to `delivery` (regression test).
- [ ] **Step 2: Implement** by reading the body, validating against the enum, and forwarding to the existing insert.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): dispatch route POST supports route_type`

### Task 5.2 — Dispatch endpoint branches on `route_type`

**Files:** `apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts` + test

- [ ] **Step 1: Failing tests:**
  - Dispatching a `route_type='return'` route calls `buildReturnRouteStops` (from Task 3.2), pushes to DT, and after a successful DT push invokes the `generate-return-manifests` Edge Function with the route ID.
  - DT push failure → `routes.status` stays `'draft'`, Edge Function NOT invoked, error surfaced.
  - Edge Function failure after a successful DT push → `routes.status` advances (manifest is not a state gate per design), but an `audit_logs` warning row is written with `entity_type='route'`, `entity_id = route.id`, `action='manifest_generation_failed'`, `operator_id = route.operator_id`, `metadata = jsonb_build_object('error', <error.message>, 'route_id', route.id)`. Mirror the `audit_logs` insert shape from Task 1.4.
- [ ] **Step 2: Implement.** Pseudocode:
  ```ts
  if (route.route_type === 'return') {
    const stops = buildReturnRouteStops(orders);
    await dispatchTrack.pushRoute({ route, stops });
    await db.from('routes').update({ status: 'planned' }).eq('id', route.id);
    try {
      await invokeEdgeFunction('generate-return-manifests', { route_id });
    } catch (err) {
      await writeAuditWarning(route.id, err);
    }
  } else {
    /* existing delivery flow */
  }
  ```
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): dispatch endpoint branches on route_type`

### Task 5.3 — Scan endpoint validates state + uniqueness

**Files:** `apps/frontend/src/app/api/dispatch/routes/[id]/scan/route.ts` + test

- [ ] **Step 1: Failing tests:**
  - Scanning a package on a `route_type='return'` route where the order's `return_to_sender_state != 'ready_to_return'` returns `409` with code `not_ready_for_return`.
  - Scanning a package whose tenant has no `return_pickup_address` returns `409` with code `sender_missing_pickup_address` and the sender name in the body.
  - Scanning a package already on another open `route_type='return'` route returns `409` with code `package_already_in_return` and the conflicting route ID.
  - Delivery-route scan path is unchanged (regression).
- [ ] **Step 2: Implement** the three new checks at the top of the scan handler, gated on `route.route_type === 'return'`. The `route_stops_return_only_tg` trigger from Task 1.3 is the server-side safety net; these checks give clean error codes.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): scan endpoint validates return-route invariants`

---

## Chunk 6 — Frontend types + hooks

### Task 6.1 — Types

**Files:** `apps/frontend/src/lib/types.ts`

- [ ] **Step 1: Failing typecheck:** add a test file (or augment an existing type test) referencing `Route.route_type` and `TenantClient.return_pickup_address`.
- [ ] **Step 2: Implement.** Add `route_type: 'delivery' | 'return'` to the route type. Add `return_pickup_address: { line1: string; line2?: string; city: string; region: string; postal_code: string; lat: number; lng: number } | null` to the tenant client type.
- [ ] **Step 3: Run typecheck.** `pnpm -F frontend typecheck`
- [ ] **Step 4: Commit.** `feat(spec-44b): route_type + return_pickup_address types`

### Task 6.2 — `useCreateReturnRoute`

**Files:**
- Create: `apps/frontend/src/hooks/dispatch/return/useCreateReturnRoute.ts` + test

- [ ] **Step 1: Failing test:** the hook POSTs to `/api/dispatch/routes` with `{ route_type: 'return' }` and returns the created route; on success, invalidates `['dispatch','routes']`.
- [ ] **Step 2: Implement** using TanStack Query `useMutation`. Mirror the existing `useCreateRouteFromSelection` shape if applicable.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): useCreateReturnRoute hook`

### Task 6.3 — `useReturnRoutes` (list by status)

**Files:**
- Create: `apps/frontend/src/hooks/dispatch/return/useReturnRoutes.ts` + test

- [ ] **Step 1: Failing test:** `useReturnRoutes(operatorId, ['draft','planned'])` returns only `route_type='return'` routes in those statuses, scoped by operator.
- [ ] **Step 2: Implement** likely as a thin wrapper around `useDispatchRoutesByStatus` with an added `route_type='return'` filter (read that hook first to see how the existing filter shape works — if it doesn't accept `route_type`, extend it; otherwise call it).
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): useReturnRoutes hook`

### Task 6.4 — `useDispatchReturnRoute`

**Files:**
- Create: `apps/frontend/src/hooks/dispatch/return/useDispatchReturnRoute.ts` + test

- [ ] **Step 1: Failing test:** hook POSTs to `/api/dispatch/routes/:id/dispatch` (the same endpoint Task 5.2 extended); on success, invalidates `['dispatch','routes']` and surfaces both DT errors and manifest-generation warnings to the caller.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): useDispatchReturnRoute hook`

### Task 6.5 — `useMarkManifestSigned`

**Files:**
- Create: `apps/frontend/src/hooks/dispatch/return/useMarkManifestSigned.ts` + test

- [ ] **Step 1: Failing test:** hook calls `mark_return_manifest_signed` RPC with the right args; on success, invalidates the route detail query.
- [ ] **Step 2: Implement.** **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): useMarkManifestSigned hook`

---

## Chunk 7 — Despacho tab + KPI

### Task 7.1 — `useDispatchKPIs` adds "Pendientes de devolución"

**Files:** `apps/frontend/src/hooks/dispatch/useDispatchKPIs.ts` + test

- [ ] **Step 1: Failing test:** `kpis.pendientesDeDevolucion` equals the count of orders with `return_to_sender_state = 'ready_to_return'` not on any non-cancelled route.
- [ ] **Step 2: Implement** by adding a count query (RPC or direct table query — match the existing KPI pattern in the file).
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): pendientesDeDevolucion KPI`

### Task 7.2 — Devoluciones tab body

**Files:**
- Create: `apps/frontend/src/components/dispatch/return/DevolucionesTab.tsx` + test
- Create: `apps/frontend/src/components/dispatch/return/ReturnRouteTile.tsx` + test
- Modify: `apps/frontend/src/app/app/dispatch/page.tsx` + `page.test.tsx`

- [ ] **Step 1: Failing tests for `ReturnRouteTile`:** renders a tile with route ID, # orders, # senders, oldest pending day; click handler fires with route ID.
- [ ] **Step 2: Implement** `ReturnRouteTile.tsx` mirroring `RouteListTile.tsx`'s structure.
- [ ] **Step 3: Failing tests for `DevolucionesTab`:** renders "Abiertas" section (returns in `draft`/`planned`) and "Despachadas" section (returns in `in_progress`/`completed` from last 14 days). Empty states for both.
- [ ] **Step 4: Implement `DevolucionesTab.tsx`** using `useReturnRoutes` and `ReturnRouteTile`.
- [ ] **Step 5: Failing tests in `page.test.tsx`:** the page renders a 5th tab labeled "Devoluciones"; clicking it activates the `DevolucionesTab` content; the KPI strip shows "Pendientes de devolución."
- [ ] **Step 6: Implement** the 5th tab and the new KPI card.
- [ ] **Step 7: Run all tests.** **Step 8: Commit.** `feat(spec-44b): Devoluciones tab + KPI`

### Task 7.3 — "Nueva Devolución" handler

- [ ] **Step 1: Failing test:** clicking "Nueva Devolución" button calls `useCreateReturnRoute` and navigates to `/app/dispatch/<id>` for the created route.
- [ ] **Step 2: Implement** the button + handler in `DevolucionesTab` (or in `page.tsx` next to the existing "Nueva Ruta" button — the latter keeps both buttons in one place).
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): Nueva Devolución action`

---

## Chunk 8 — `ReturnRouteBuilder` + scan flow

**Files:**
- Create: `apps/frontend/src/components/dispatch/return/ReturnRouteBuilder.tsx` + test
- Create: `apps/frontend/src/components/dispatch/return/ReturnScanZone.tsx` + test
- Create: `apps/frontend/src/components/dispatch/return/ReturnSenderGroup.tsx` + test
- Modify: `apps/frontend/src/app/app/dispatch/[routeId]/page.tsx` + test

### Task 8.1 — Route detail page branches on `route_type`

- [ ] **Step 1: Failing test in `[routeId]/page.test.tsx`:** when the loaded route has `route_type='return'`, the page renders `ReturnRouteBuilder`; otherwise the existing builder.
- [ ] **Step 2: Implement** the branch (one `if`).
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): route detail branches on route_type`

### Task 8.2 — `ReturnSenderGroup` (collapsible group)

- [ ] **Step 1: Failing tests:** renders `tenant.name`, package count, expand/collapse toggle, list of scanned orders. Un-scan button per order fires a handler with the order ID.
- [ ] **Step 2: Implement** as a presentational component (props only; no hooks).
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): ReturnSenderGroup component`

### Task 8.3 — `ReturnScanZone` (validating wrapper)

- [ ] **Step 1: Failing tests:**
  - Scanning a valid label calls the scan API (Task 5.3); on success, the parent's onScan callback is invoked.
  - Scanning rejected with `not_ready_for_return` → toast `"Orden no está lista para devolución"`.
  - Rejected with `sender_missing_pickup_address` → toast includes the sender name.
  - Rejected with `package_already_in_return` → toast includes the conflicting route ID.
- [ ] **Step 2: Implement** as a thin wrapper around the existing `ScanZone` primitive, mapping API error codes to toast strings.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): ReturnScanZone with error mapping`

### Task 8.4 — `ReturnRouteBuilder` shell

- [ ] **Step 1: Failing tests:**
  - Header chip shows "Devolución" badge.
  - Scanned orders are grouped by sender (uses `ReturnSenderGroup`).
  - Un-scan removes the order; if it was the last in its sender group, the group disappears.
  - "Close & Dispatch" button is disabled when zero orders scanned; enabled otherwise; clicking it calls `useDispatchReturnRoute`.
  - After successful dispatch, the page navigates back to `/app/dispatch?tab=devoluciones` or shows a success state with manifest links.
  - After dispatch, the scan zone is disabled (route is no longer in `draft`).
- [ ] **Step 2: Implement** the builder composing `ReturnScanZone` + `ReturnSenderGroup` + the dispatch action.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): ReturnRouteBuilder shell`

### Task 8.5 — Manifest links + "Marcar firmado" action

- [ ] **Step 1: Add a server route** for signed URL generation: `apps/frontend/src/app/api/dispatch/return-manifests/[routeId]/[tenantClientId]/url/route.ts`. Failing test: `GET` returns `{ url, expiresAt }` where `url` is the result of `storage.from('return-manifests').createSignedUrl(path, 3600)` (1-hour TTL) for the manifest matching the path params. Operator scoping enforced via the `return_route_manifests.operator_id` RLS policy from Chunk 1.
- [ ] **Step 2: Implement** the server route.
- [ ] **Step 3: Failing tests for the manifest panel inside `ReturnRouteBuilder`:**
  - For a dispatched return route, the builder shows one card per sender with a download link to the manifest PDF. The card fetches the signed URL via the server route from Step 1 on mount (TanStack Query, 50-minute `staleTime` so it refetches before the 1-hour TTL expires).
  - Each card has a "Marcar firmado" button + a `signed_by` input; submitting calls `useMarkManifestSigned`; after success the card shows the signed-by name + signed-at timestamp.
  - "Regenerar manifiestos" button is visible when the route is dispatched AND any manifest row is missing (use the `audit_logs` warning row from Task 5.2 as the signal); clicking it re-invokes the Edge Function via a small POST endpoint or the existing dispatch route handler.
- [ ] **Step 4: Implement** the manifest panel.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): manifest links + sign action + regenerate`

---

## Chunk 9 — 44a panel regression (remove interim exit, add badge)

**Files:**
- Modify: `apps/frontend/src/app/app/operations-control/components/stage-panels/ReturnToSenderPanel.tsx` + test
- Delete: `apps/frontend/src/hooks/ops-control/useMarkReturnedToSender.ts` + test

### Task 9.1 — Remove "Marcar devuelto" button

- [ ] **Step 1: Failing test** asserts the "Marcar devuelto" button is NOT rendered in the "Listo para retornar" sub-tab.
- [ ] **Step 2: Implement** by removing the action column / button + the `useMarkReturnedToSender` import.
- [ ] **Step 3: Delete the hook file + its test** (now unused). Run typecheck to confirm no other callers. `pnpm -F frontend typecheck`
- [ ] **Step 4: Run tests.** **Step 5: Commit.** `feat(spec-44b): remove interim Marcar devuelto button`

### Task 9.2 — Add "En devolución (Ruta #N)" badge

- [ ] **Step 1: Failing test:** orders with a stop on an open `route_type='return'` route show a badge with the route ID. The badge is a link to `/app/dispatch/<route_id>`.
- [ ] **Step 2: Implement.** The panel needs to know which orders are on which return route. Extend the `get_ops_control_snapshot` RPC (the same function 44a amended to add `returns_to_sender`): for each order in the `returns_to_sender` array, include a joined `return_route_id` field populated by a `LEFT JOIN route_stops rs ... JOIN routes r ON r.id = rs.route_id AND r.route_type = 'return' AND r.status IN ('draft','planned','in_progress')`. Run a `Grep` for `get_ops_control_snapshot` in `packages/database/supabase/migrations/`, take the lexicographically last file, and use that body as the `CREATE OR REPLACE` template (per CLAUDE.md). Tests must include a fixture asserting the field is populated when a stop exists and `null` otherwise.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44b): En devolución badge on ReturnToSenderPanel rows`

---

## Wrap-up

### Final verification

- [ ] **Step 1: Full test suite.** `pnpm test`
- [ ] **Step 2: Typecheck.** `pnpm -F frontend typecheck`
- [ ] **Step 3: Build.** `pnpm -F frontend build`
- [ ] **Step 4: Edge Function deploy check.** Confirm `packages/database/supabase/functions/generate-return-manifests/` is registered in the Supabase config / will be deployed by the existing CI step (read `.github/workflows/` for the supabase functions deploy stage if needed).
- [ ] **Step 5: Manual smoke (against local Supabase):**
  - Create a return route via "Nueva Devolución."
  - Scan 3 packages across 2 senders (one with `return_pickup_address`, one without) — confirm rejection for the missing-address case.
  - Configure the missing address, re-scan, click "Close & Dispatch."
  - Confirm DT push payload has 2 stops; manifest PDFs uploaded; manifest rows present.
  - Simulate DT completion webhook → confirm orders transition to `returned` and disappear from the 44a stage.
  - Click "Marcar firmado" on a manifest row → confirm `signed_by`/`signed_at` populated.
- [ ] **Step 6: Update spec status** at the top of this file from `backlog` to `in progress` on first implementation commit, never to `completed` until user confirms.
- [ ] **Step 7: PR + auto-merge** per `CLAUDE.md`:
  ```bash
  gh pr create --title "feat(spec-44b): Devoluciones a Remitente — Despacho return tab" --body "<summary>"
  gh pr merge --auto --squash
  ```
- [ ] **Step 8: Watch CI to green + confirm merge** with `gh pr checks <N>` and `gh pr view <N> --json state,mergedAt`. Do not declare done until merged.

### Out-of-scope follow-ups

- Threshold/cron auto-suggested return shipments.
- Tiered evidence bundles with per-attempt photo + driver detail.
- Sender e-signature capture on driver tablet.
- Capacity / volume estimation in the builder.
