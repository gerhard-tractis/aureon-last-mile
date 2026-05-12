# spec-44a — Devoluciones a Remitente · Stage Foundation

**Status:** backlog

> **For agentic workers:** Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development` if subagents are available) to implement this plan once `writing-plans` has appended the chunked task list.

**Goal:** Add an 8th Ops Control stage — "Devoluciones a Remitente" — that surfaces orders which must be shipped back to the original sender (`tenant_client`) after failed deliveries or after a customer-initiated Devolución pickup. Includes the data model, two inflow rules (Reingresos auto-promotion under a per-tenant policy, Reception Hub routing for Devolución pickups), the Ops Control panel UI, an interim manual exit, and a minimal admin config surface.

**Architecture:** New columns on `orders` and `tenant_clients`; three new RPCs (`promote_order_to_return_to_sender`, `confirm_return_to_sender`, `mark_returned_to_sender`); one branch added to the existing Reception Hub reception RPC; new `returns_to_sender` array on the `get_ops_control_snapshot` payload; new `ReturnToSenderPanel` Ops Control panel reusing `StagePanel` / `OrderTable` primitives; new card slot in `StageStrip`; minimal radio + numeric input added to the existing tenant/client admin form (spec-33).

**Tech Stack:** Next.js 15 App Router, React, TanStack Query v5, Supabase Postgres + RPCs, shadcn/ui, Tailwind CSS, Vitest + Testing Library.

---

## Background

Operators currently have two stages for reverse flow:

- **Reingresos** (`returns`) — orders returned to the warehouse the same day after a failed delivery attempt; visible while a retry is still in scope.
- **Cambios y Devoluciones** (`reverse`) — placeholder for customer-initiated cambios (damaged-product exchanges) and devoluciones (customer cancels and we pick the product up at their home).

Neither covers the **outbound back-to-sender** pile: orders we have given up trying to deliver (per the sender's commercial agreement) plus the products picked up via a Devolución home-pickup that must now be physically returned to the remitente. There is no system of record for these orders today, no per-sender policy for when to give up, and no operational view for the team that loads the return truck.

Spec-44a delivers the stage, its data model, and its entry rules. Spec-44b (separate) delivers the Despacho return-tab and the documentation/evidence bundle.

## Scope

**In:**

- New per-`tenant_clients` columns: `return_policy` (`auto_after_attempts` | `require_confirmation`, default `require_confirmation`) and `return_attempts_threshold` (int, default `3`, only used under `auto_after_attempts`).
- New `orders.return_to_sender_state` column: `null` | `pending_confirmation` | `ready_to_return` | `returned`.
- Check constraint preventing an order from being both in a non-null `return_to_sender_state ∈ {pending_confirmation, ready_to_return}` and on an active route at the same time.
- `promote_order_to_return_to_sender(p_order_id, p_operator_id)` RPC — idempotent, called from the existing failed-delivery code path; reads tenant policy and writes the right state.
- Reception Hub reception RPC: branch for inbound orders whose pickup type is `devolucion` → set `return_to_sender_state = 'ready_to_return'`.
- `confirm_return_to_sender(p_order_id, p_operator_id)` and `mark_returned_to_sender(p_order_id, p_operator_id)` RPCs — operator-scoped state transitions with invalid-transition guards. All three RPCs accept `p_operator_id` explicitly for symmetry and so that callers asserting on it cannot be silently bypassed.
- `get_ops_control_snapshot` returns a new `returns_to_sender` array (orders where state ∈ {`pending_confirmation`, `ready_to_return`}, scoped by operator). **Orders included in `returns_to_sender` MUST be excluded from every other stage array in the snapshot** (pickups, reception, consolidation, docks, delivery, routes, returns), and **excluded from the at-risk aging RPC** — they are no longer in the active delivery pipeline.
- New `STAGE_KEYS` entry: singular key `'return_to_sender'`, inserted at index 6 (between `'returns'` and `'reverse'`) so `StageStrip` renders the 8th card in the correct position. Label: `"Devoluciones a Remitente"`. The snapshot array name remains plural (`returns_to_sender`); `getItemsForStage('return_to_sender', snapshot)` reads `snapshot.returns_to_sender`. Health buckets by *age in this stage*: `at_risk` ≥ 7 days, `late` ≥ 14 days.
- New `ReturnToSenderPanel.tsx` Ops Control panel:
  - 4 KPIs: pendientes de confirmación, listos para retornar, remitentes con órdenes, antigüedad media (días).
  - Two sub-tabs: "Pendiente confirmación" and "Listo para retornar."
  - Row action **"Confirmar retorno"** in the pending sub-tab → `confirm_return_to_sender`.
  - Row action **"Marcar devuelto"** in the ready sub-tab → `mark_returned_to_sender` (interim manual exit; deprecated by spec-44b).
  - "Agrupar por remitente" toggle that collapses rows by `tenant_client`.
- Minimal admin config: a radio (`return_policy`) and a numeric input (`return_attempts_threshold`, visible only when policy = `auto_after_attempts`) added to the existing tenant/client admin form.

**Out:**

- The Despacho return-shipment tab, return-truck loading, and documentation/evidence PDF bundle — owned by **spec-44b**.
- Customer / remitente notifications (email or WhatsApp) when orders are ready for collection.
- Automated re-attempt scheduling between failed deliveries — already handled by the existing delivery flow.
- Any redesign of the existing Reingresos or Cambios y Devoluciones stages.
- Mobile/tablet panel layout — desktop Ops Control only (matches existing stage panels).
- Bulk actions in the panel beyond the per-row buttons (deferred).

---

## Data model

### `tenant_clients` (modified)

| Column | Type | Default | Notes |
|---|---|---|---|
| `return_policy` | enum `return_policy_kind` | `'require_confirmation'` | New enum: `auto_after_attempts`, `require_confirmation`. |
| `return_attempts_threshold` | int | `3` | Honored only when policy = `auto_after_attempts`. Must be ≥ 1. |

### `orders` (modified)

| Column | Type | Default | Notes |
|---|---|---|---|
| `return_to_sender_state` | enum `return_to_sender_state` | `null` | New enum: `pending_confirmation`, `ready_to_return`, `returned`. |

**Active-route mutual-exclusion invariant.** When `return_to_sender_state ∈ ('pending_confirmation', 'ready_to_return')`, the order MUST NOT also reference an active route (active = route status in dispatching/in-progress, per the existing routes schema). Postgres CHECK constraints are row-local and cannot cross-table, so this is enforced via **two paired triggers**:

- `orders_return_state_route_guard` — BEFORE INSERT/UPDATE on `orders`: when `return_to_sender_state` is being set to an active value, raise if an active route assignment exists for the order.
- `route_stops_return_state_guard` — BEFORE INSERT/UPDATE on `route_stops` (or the route-assignment table in this schema): when assigning an order to a route, raise if that order's `return_to_sender_state` is already in an active value.

The `attempts` counter referenced by `promote_order_to_return_to_sender` reads from the existing `delivery_attempts` table (see `20260303000001_add_delivery_attempts_unique_index.sql`); the increment is owned by the failed-delivery code path *upstream* of the promotion call, not by the promotion RPC itself.

---

## Data flow

```
                            ┌──────────────────────────────┐
                            │ tenant_clients.return_policy │
                            └──────────────┬───────────────┘
                                           │ read by RPC
                                           ▼
  failed delivery attempt ──► promote_order_to_return_to_sender(order, operator)
                                           │
                       ┌───────────────────┴────────────────────┐
                       │                                        │
              auto_after_attempts                       require_confirmation
              & attempts ≥ threshold                            │
                       │                                        │
                       ▼                                        ▼
              state = ready_to_return                state = pending_confirmation
                                                                │
                                                operator clicks Confirmar
                                                                │
                                                                ▼
                                                       state = ready_to_return

  Devolución home-pickup received at Reception Hub ──► state = ready_to_return (direct)

  Operator clicks "Marcar devuelto" ──► state = returned  (interim exit, replaced by 44b)
```

Snapshot pipeline:

```
get_ops_control_snapshot(operator_id)
  └─ returns_to_sender: orders WHERE return_to_sender_state IN
                                  ('pending_confirmation', 'ready_to_return')
                                AND operator_id = $1
useOpsControlSnapshot
  └─ snapshot.returns_to_sender
OpsControlDesktop.getItemsForStage('return_to_sender', snapshot)
  └─ snapshot.returns_to_sender
ReturnToSenderPanel
  └─ uses useStageBreakdown('return_to_sender', operatorId, page)
```

---

## File structure

```
NEW
  packages/database/supabase/migrations/
    YYYYMMDDhhmmss_spec44a_return_to_sender.sql
      - enum return_policy_kind
      - enum return_to_sender_state
      - alter tenant_clients add return_policy, return_attempts_threshold
      - alter orders add return_to_sender_state
      - paired triggers `orders_return_state_route_guard` + `route_stops_return_state_guard`
      - function promote_order_to_return_to_sender
      - function confirm_return_to_sender
      - function mark_returned_to_sender
      - update get_ops_control_snapshot to add returns_to_sender array
      - branch in reception RPC for pickup_type = 'devolucion'
      - pgTAP tests alongside (per repo convention)

  apps/frontend/src/app/app/operations-control/components/stage-panels/
    ReturnToSenderPanel.tsx
    ReturnToSenderPanel.test.tsx

  apps/frontend/src/hooks/ops-control/
    useConfirmReturnToSender.ts
    useConfirmReturnToSender.test.ts
    useMarkReturnedToSender.ts
    useMarkReturnedToSender.test.ts

MODIFIED
  apps/frontend/src/app/app/operations-control/
    lib/labels.es.ts                    add 'return_to_sender' key + label
    lib/health.ts                       age-based health buckets for new stage
    components/OpsControlDesktop.tsx    wire new stage into switch + getItemsForStage
    components/StageStrip.tsx           render 8th card (likely already array-driven; verify)
    page.test.tsx                       coverage for new stage rendering

  apps/frontend/src/hooks/ops-control/
    useOpsControlSnapshot.ts            expose snapshot.returns_to_sender
    useStageBreakdown.ts                handle 'return_to_sender' key

  apps/frontend/src/lib/types.ts        OpsSnapshot adds returns_to_sender
                                        Order type gains return_to_sender_state

  apps/frontend/src/app/app/admin/...   tenant/client admin form gains
                                        return_policy radio + threshold input
```

All new files stay under 300 lines. `ReturnToSenderPanel` delegates table rendering to the existing `OrderTable` and KPI rendering to `computeOrderKpis` (extended with a thin adapter for the four panel-specific KPIs).

---

## Error handling & edge cases

- **Idempotency.** All three RPCs no-op when the order is already in a terminal state for that transition (`pending_confirmation → pending_confirmation` etc.). No errors raised.
- **Missing tenant policy.** Defaults applied at column level guarantee non-null; orphaned orders without a tenant fall back to `require_confirmation`. We never auto-return without explicit configuration.
- **Operator scoping.** Every RPC verifies `auth.uid()` resolves to the same `operator_id` as the order; mismatch raises (matches existing repo pattern for ops RPCs).
- **Devolución pickup for unknown order.** Reception RPC creates the order record with `return_to_sender_state = 'ready_to_return'` directly — no Reingresos detour.
- **Conflicting active route.** Paired triggers prevent an order being on an active route while in this stage. Promotion RPC refuses (raises) if such a conflict exists at promotion time — caller (the failed-attempt path) must close the route first.
- **Policy change mid-flight.** Existing orders keep their current state; only *new* failed attempts evaluate the updated policy. Documented; not a runtime guard.
- **Successful delivery after promotion.** Cannot happen — an order in `pending_confirmation` / `ready_to_return` is excluded from active routing by the paired triggers. Asserted in tests.

---

## Testing strategy

TDD per CLAUDE.md. Tests written first, then implementation.

- **Migration / DB**
  - Schema additions present.
  - Enum values correct.
  - Defaults applied to existing rows.
  - `orders_return_state_route_guard` blocks setting `return_to_sender_state` to an active value when an active route assignment exists.
  - `route_stops_return_state_guard` blocks assigning an order to a route when its `return_to_sender_state` is already active.
- **RPC: `promote_order_to_return_to_sender`**
  - Auto-policy below threshold → no-op.
  - Auto-policy at/above threshold → `ready_to_return`.
  - Confirmation policy → `pending_confirmation`.
  - Already promoted → no-op, no error.
  - Operator scoping rejects cross-operator order.
- **RPC: `confirm_return_to_sender`**
  - `pending_confirmation → ready_to_return`.
  - Any other source state → error.
- **RPC: `mark_returned_to_sender`**
  - `ready_to_return → returned`.
  - Any other source state → error.
- **Reception RPC branch**
  - Devolución pickup sets `ready_to_return`; unrelated pickups untouched.
- **`get_ops_control_snapshot`**
  - Returns new `returns_to_sender` array, filtered by operator and state set.
  - Orders present in `returns_to_sender` do NOT appear in any other stage array of the same snapshot (covered by a fixture with an order that previously lived in `returns`).
  - At-risk aging RPC excludes orders in active `return_to_sender_state`.
- **Frontend hooks**
  - `useOpsControlSnapshot` exposes the new array.
  - `useConfirmReturnToSender` / `useMarkReturnedToSender` call RPCs with the right args and invalidate the snapshot query.
- **`ReturnToSenderPanel`**
  - Renders both sub-tabs; defaults to "Pendiente confirmación."
  - Row actions trigger the right hooks.
  - "Agrupar por remitente" toggle groups rows by `tenant_client.name`.
  - KPIs compute correctly for fixtures.
- **`OpsControlDesktop`**
  - `getItemsForStage('return_to_sender', …)` returns the snapshot array.
  - Switch wires the new panel.
- **`StageStrip`**
  - 8th card renders with correct label, count, and age-bucketed health.
- **Admin config form**
  - Reads/writes `return_policy` and `return_attempts_threshold` per tenant.
  - Threshold input hidden when policy = `require_confirmation`.
  - Validation: `return_attempts_threshold ≥ 1` is enforced both client-side and at the DB level.

---

## Open questions

None at brainstorming time. All known questions resolved in the brainstorming dialogue:

- Per-tenant policy needed because some senders demand confirmation before return — **resolved** (data model handles both).
- Position in stage strip — **resolved** (after Reingresos, before Cambios y Devoluciones).
- Exit semantics — **resolved** (interim manual `mark_returned_to_sender`; replaced by 44b's truck-loading flow).

---

## Out-of-scope follow-ups

- **spec-44b** — Despacho return-shipment tab: group by remitente, build manifest, attach failed-attempt evidence PDF, mark batch as `returned` via batch RPC (replaces the manual `mark_returned_to_sender` button as the real exit).
- Future: remitente notifications when batches are ready for hand-off.
- Future: bulk row actions in the panel.

---

## Implementation plan

> Steps use checkbox (`- [ ]`) syntax for tracking. Each task is bite-sized (≈2–5 min). TDD throughout: failing test → minimal implementation → green → commit. Use `superpowers:subagent-driven-development` (parallel) or `superpowers:executing-plans` (sequential) to execute.

### Conventions

- Migrations live in `packages/database/supabase/migrations/`. Naming: `YYYYMMDDhhmmss_<slug>.sql`. Use the current UTC timestamp at creation. Same file holds DDL + RPCs + pgTAP tests in `-- TEST:` blocks where the repo follows that pattern; otherwise add a sibling `*.test.sql`. Match the most recent migration's style (`20260506000001_fix_dock_scan_status_cast.sql`).
- Frontend tests use Vitest + React Testing Library, colocated as `*.test.tsx`/`*.test.ts`.
- Run frontend tests: `pnpm -F frontend test <path>`.
- Run DB tests: `pnpm -F database test` (or the existing script — check `packages/database/package.json`).
- TypeScript: keep `OpsSnapshot` and `StageKey` updates in lock-step; the build catches mismatches.
- One commit per task. Conventional commits: `feat(spec-44a): …`, `test(spec-44a): …`.

---

## Chunk 1 — Database foundation (enums, columns, triggers)

**Files:**
- Create: `packages/database/supabase/migrations/<ts>_spec44a_return_to_sender_foundation.sql`

### Task 1.1 — Enums + tenant config columns

- [ ] **Step 1: Add enum types.** In the new migration:
  ```sql
  create type public.return_policy_kind as enum (
    'auto_after_attempts', 'require_confirmation'
  );
  create type public.return_to_sender_state as enum (
    'pending_confirmation', 'ready_to_return', 'returned'
  );
  ```
- [ ] **Step 2: Alter `tenant_clients`.**
  ```sql
  alter table public.tenant_clients
    add column return_policy public.return_policy_kind
      not null default 'require_confirmation',
    add column return_attempts_threshold int
      not null default 3
      check (return_attempts_threshold >= 1);
  ```
- [ ] **Step 3: Alter `orders`.**
  ```sql
  alter table public.orders
    add column return_to_sender_state public.return_to_sender_state null,
    add column entered_return_to_sender_at timestamptz null;
  create index orders_return_to_sender_state_idx
    on public.orders (operator_id, return_to_sender_state)
    where return_to_sender_state is not null;
  ```
  The `entered_return_to_sender_at` timestamp is the single source of truth for stage age (consumed by Task 6.2 health bucketing). The promotion / confirm RPCs in Chunks 2–3 set it; do not derive age from `updated_at`.
- [ ] **Step 4: Write pgTAP tests** asserting: enums exist, columns exist with correct defaults, threshold check rejects `0`, partial index exists.
- [ ] **Step 5: Run tests, verify pass.** `pnpm -F database test`
- [ ] **Step 6: Commit.** `test+feat(spec-44a): enums and config columns`

### Task 1.2 — Active-route mutual-exclusion triggers

- [ ] **Step 1: Identify route-assignment table.** Read `packages/database/supabase/migrations/20260306000001_add_routes_dispatches_fleet_tables.sql` to confirm the table name (likely `route_stops` or `route_orders`). Lock in the column that links an order to a route. If the schema differs from `route_stops`, substitute the actual table name in all references below. Active route statuses confirmed: `route_status_enum` values are `'planned', 'in_progress', 'completed', 'cancelled'`. Active = `('planned', 'in_progress')`.
- [ ] **Step 2: Write failing pgTAP tests** for the invariant:
  - Setting `return_to_sender_state` to `'pending_confirmation'` on an order currently assigned to an active route raises.
  - Assigning an order with active `return_to_sender_state` to a new active route raises.
  - Transitions on inactive routes (completed/cancelled) are allowed.
- [ ] **Step 3: Write `orders_return_state_route_guard`:**
  ```sql
  create or replace function public.orders_return_state_route_guard()
    returns trigger language plpgsql as $$
  begin
    if NEW.return_to_sender_state in ('pending_confirmation','ready_to_return')
       and exists (
         select 1 from public.route_stops rs
         join public.routes r on r.id = rs.route_id
         where rs.order_id = NEW.id
           and r.status in ('draft','planned','in_progress')
       )
    then
      raise exception 'order % cannot enter return_to_sender_state while on active route', NEW.id
        using errcode = 'check_violation';
    end if;
    return NEW;
  end $$;
  create trigger orders_return_state_route_guard_tg
    before insert or update of return_to_sender_state on public.orders
    for each row execute function public.orders_return_state_route_guard();
  ```
- [ ] **Step 4: Write `route_stops_return_state_guard`** (mirror image, raises when assigning an order whose state is already active).
- [ ] **Step 5: Run tests, verify pass.**
- [ ] **Step 6: Commit.** `feat(spec-44a): paired route-state guard triggers`

---

## Chunk 2 — Promotion RPC

**Files:**
- Modify: `packages/database/supabase/migrations/<ts>_spec44a_return_to_sender_foundation.sql` (append) **or** create a follow-up migration `<ts+1>_spec44a_promote_rpc.sql` — prefer follow-up to keep migrations small.

### Task 2.1 — `promote_order_to_return_to_sender`

- [ ] **Step 1: Write failing pgTAP tests covering all branches:**
  - Policy `require_confirmation` → state becomes `pending_confirmation`.
  - Policy `auto_after_attempts` with `delivery_attempts.count < threshold` → no-op (state stays null).
  - Policy `auto_after_attempts` with `count >= threshold` → state becomes `ready_to_return`.
  - Idempotency: calling again with state already set → no-op, no exception.
  - Cross-operator call → raises.
  - Active-route conflict → raises (trigger fires).
- [ ] **Step 2: Implement the RPC:**
  ```sql
  create or replace function public.promote_order_to_return_to_sender(
    p_order_id uuid,
    p_operator_id uuid
  )
  returns public.return_to_sender_state
  language plpgsql security definer
  set search_path = public, pg_temp
  as $$
  declare
    v_policy public.return_policy_kind;
    v_threshold int;
    v_attempts int;
    v_tenant uuid;
    v_current public.return_to_sender_state;
  begin
    select o.tenant_client_id, o.return_to_sender_state
      into v_tenant, v_current
      from public.orders o
      where o.id = p_order_id and o.operator_id = p_operator_id
      for update;
    if not found then raise exception 'order not found or operator mismatch'; end if;
    if v_current is not null then return v_current; end if;

    select tc.return_policy, tc.return_attempts_threshold
      into v_policy, v_threshold
      from public.tenant_clients tc where tc.id = v_tenant;

    if v_policy = 'require_confirmation' then
      update public.orders
        set return_to_sender_state = 'pending_confirmation',
            entered_return_to_sender_at = now()
        where id = p_order_id;
      return 'pending_confirmation';
    end if;

    select count(*) into v_attempts
      from public.delivery_attempts da
      where da.order_id = p_order_id
        and da.deleted_at is null
        and <FAILED_CLAUSE>;
    if v_attempts >= v_threshold then
      update public.orders
        set return_to_sender_state = 'ready_to_return',
            entered_return_to_sender_at = now()
        where id = p_order_id;
      return 'ready_to_return';
    end if;
    return null;
  end $$;
  grant execute on function public.promote_order_to_return_to_sender(uuid, uuid) to authenticated;
  ```
  - **Step 0 (before tests):** open `packages/database/supabase/migrations/` and grep for `CREATE TABLE.*delivery_attempts` to find the original schema migration. Read the table definition and identify the column + value that represents a failed attempt (commonly `status = 'failed'` or `outcome = 'failed'` — but **do not guess**). Replace `<FAILED_CLAUSE>` in the snippet above with the actual predicate (e.g., `da.status = 'failed'`) before writing the tests. Note the partial-index pattern `WHERE deleted_at IS NULL` from `20260303000001_add_delivery_attempts_unique_index.sql` is already mirrored in the query.
- [ ] **Step 3: Run tests, verify pass.**
- [ ] **Step 4: Commit.** `feat(spec-44a): promote_order_to_return_to_sender RPC`

---

## Chunk 3 — State-transition RPCs

### Task 3.1 — `confirm_return_to_sender`

- [ ] **Step 1: Failing pgTAP tests:** `pending_confirmation → ready_to_return`; any other source state (including already `ready_to_return`, `returned`, or `null`) raises with `'invalid transition for order %'`; operator scoping enforced (cross-operator call raises). Idempotency is **not** offered — a second call on the same already-confirmed order raises.
- [ ] **Step 2: Implement.**
  ```sql
  create or replace function public.confirm_return_to_sender(
    p_order_id uuid, p_operator_id uuid
  ) returns void language plpgsql security definer
  set search_path = public, pg_temp as $$
  begin
    update public.orders
      set return_to_sender_state = 'ready_to_return'
      where id = p_order_id and operator_id = p_operator_id
        and return_to_sender_state = 'pending_confirmation';
    if not found then
      raise exception 'invalid transition for order %', p_order_id;
    end if;
  end $$;
  grant execute on function public.confirm_return_to_sender(uuid, uuid) to authenticated;
  ```
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): confirm_return_to_sender RPC`

### Task 3.2 — `mark_returned_to_sender`

- [ ] **Step 1: Failing pgTAP tests:** `ready_to_return → returned`; from `pending_confirmation` raises; operator scoping enforced.
- [ ] **Step 2: Implement** (mirror of confirm; source state `ready_to_return`, target `returned`).
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): mark_returned_to_sender RPC`

---

## Chunk 4 — Snapshot + reception integration

### Task 4.1 — Extend `get_ops_control_snapshot`

**Files:** new migration `<ts>_spec44a_snapshot_returns_to_sender.sql` that uses `CREATE OR REPLACE FUNCTION` based on the **latest** existing definition (per CLAUDE.md rule). Locate the template with:
```
Grep pattern: get_ops_control_snapshot
Path: packages/database/supabase/migrations/
```
Pick the **lexicographically last** matching file (filenames sort by timestamp, so last = newest). Copy its `CREATE OR REPLACE FUNCTION public.get_ops_control_snapshot(...)` body verbatim as the starting point — then add the new array and the exclusion clauses.

- [ ] **Step 1: Failing test:** call the RPC with fixtures (one order in `pending_confirmation`, one in `ready_to_return`, one in `returned`, one in `null`) and assert:
  - `returns_to_sender` returns exactly the first two.
  - That same `pending_confirmation` order does NOT also appear in the `orders` array (snapshot-exclusion rule).
  - At-risk aging RPC (`get_at_risk_orders` or equivalent) excludes orders in active return state. Read the at-risk RPC migration to confirm name + WHERE clause; the new test asserts the additional `AND return_to_sender_state IS NULL` (or equivalent) clause.
- [ ] **Step 2: Implement** by editing the new migration:
  - Add a `returns_to_sender` jsonb array to the returned object: select orders WHERE `return_to_sender_state IN ('pending_confirmation','ready_to_return') AND operator_id = p_operator_id AND deleted_at IS NULL`.
  - Add `AND (return_to_sender_state IS NULL)` to **every** other order-selection clause in the function. Explicit checklist of buckets that need the exclusion clause (each bucket gets its own SELECT in the existing function — patch all of them):
    1. `orders` array (the generic non-terminal orders bucket)
    2. `pickups` / `manifests` array (where it joins through orders)
    3. `reception` selection (if a separate select exists; otherwise filtered downstream by `orderStage`)
    4. `consolidation`
    5. `docks` (orders side; routes side has no return state)
    6. `delivery` (orders side)
    7. `returns` array (Reingresos)
  - Patch the at-risk aging RPC the same way: append `AND return_to_sender_state IS NULL` to the WHERE clause. The at-risk RPC is callable as `get_at_risk_orders` — confirm exact name via Grep on the migrations folder before editing; if the actual function name differs, use the file you found.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): snapshot returns_to_sender + exclusion`

### Task 4.2 — Reception Hub Devolución branch

- [ ] **Step 1: Locate the reception RPC.** Search `packages/database/supabase/migrations/` for `reception` / `receive_order` / similar. Identify the function and the parameter that indicates pickup type.
- [ ] **Step 2: Failing pgTAP test:** receiving an order whose pickup type is `'devolucion'` sets `return_to_sender_state = 'ready_to_return'` and does NOT advance the order's `status` along the normal reception path. Receiving a normal pickup is unchanged.
- [ ] **Step 3: Implement** by `CREATE OR REPLACE` of the reception RPC (template = latest existing definition). Branch on pickup type before the normal reception update.
- [ ] **Step 4: Run tests.** **Step 5: Commit.** `feat(spec-44a): reception RPC routes devolucion pickups to return-to-sender`

---

## Chunk 5 — Frontend types and hooks

### Task 5.1 — Types

**Files:** `apps/frontend/src/lib/types.ts`

- [ ] **Step 1: Find existing `Order` / `OpsSnapshot` type definitions** (`grep -n 'OpsSnapshot\|type Order' apps/frontend/src/lib/types.ts`).
- [ ] **Step 2: Add `return_to_sender_state` to the order type:** union of the three string literals + `null`.
- [ ] **Step 3: Extend `OpsSnapshot`-shaped types as needed** (the runtime hook holds the field name; tests will catch drift).
- [ ] **Step 4: Run typecheck.** `pnpm -F frontend typecheck`
- [ ] **Step 5: Commit.** `feat(spec-44a): order + snapshot types`

### Task 5.2 — `useOpsControlSnapshot` exposes new field

**Files:** `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.ts` + `useOpsControlSnapshot.test.ts` (create if missing).

- [ ] **Step 0: Confirm the realtime channel exists.** Read `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.ts` lines ~128–189 (the `useEffect` with `client.channel(...)` subscriptions on `orders` and `routes`). If absent, skip the realtime-routing sub-step in Step 2 and rely on `invalidateQueries` from the action hooks (Task 5.4) for freshness.
- [ ] **Step 1: Failing test:** mock `client.rpc('get_ops_control_snapshot', ...)` to return a payload containing `returns_to_sender`; assert `snapshot.returnsToSender` is populated. If the realtime branch is present, also assert: a realtime `UPDATE` to an `orders` row that sets `return_to_sender_state = 'pending_confirmation'` adds the row to `returnsToSender` and removes it from `orders`.
- [ ] **Step 2: Implement:**
  - Add `returns_to_sender` to `OpsSnapshot`: `returnsToSender: OrderRow[]`.
  - Read it from the RPC result: `returnsToSender: (result?.returns_to_sender ?? []) as OrderRow[]`.
  - (Only if Step 0 confirmed the realtime branch.) In the realtime `orders` channel handler, if the incoming row has `return_to_sender_state ∈ {pending_confirmation, ready_to_return}`, route to `returnsToSender` (upsert there, remove from `orders`); if `returned` or `null`, remove from `returnsToSender`.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): snapshot hook exposes returnsToSender`

### Task 5.3 — `useStageBreakdown` adds new key

**Files:** `apps/frontend/src/hooks/ops-control/useStageBreakdown.ts` + test

- [ ] **Step 1: Failing test:** `useStageBreakdown('return_to_sender', operatorId, 1)` returns the snapshot's `returnsToSender` array sorted by stage age (oldest first), with health bucketed by age.
- [ ] **Step 2: Implement:**
  - Add `'return_to_sender'` to the `StageKey` union.
  - Extend `getItems` with `case 'return_to_sender': return snapshot.returnsToSender;`
  - Extend `sortItems` with the age sort.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): useStageBreakdown supports return_to_sender`

### Task 5.4 — Action hooks

**Files:**
- Create: `apps/frontend/src/hooks/ops-control/useConfirmReturnToSender.ts` + test
- Create: `apps/frontend/src/hooks/ops-control/useMarkReturnedToSender.ts` + test

- [ ] **Step 1: Failing tests** for each: hook calls the right RPC with the right args; on success, invalidates `['ops-control', operatorId, 'snapshot']`; surfaces errors.
- [ ] **Step 2: Implement** using TanStack Query `useMutation`. Follow whatever action-hook pattern already exists in the repo (e.g., `apps/frontend/src/hooks/...` — grep for `useMutation` + `client.rpc`).
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): action hooks for confirm + mark returned`

---

## Chunk 6 — Labels, health, stage strip, desktop wiring

### Task 6.1 — Labels

**Files:** `apps/frontend/src/app/app/operations-control/lib/labels.es.ts` + test

- [ ] **Step 1: Failing test:** `STAGE_KEYS[6] === 'return_to_sender'`, `STAGE_LABELS['return_to_sender'] === 'Devoluciones a Remitente'`, the keys list has length 8 with `'reverse'` at index 7.
- [ ] **Step 2: Implement.** Insert at index 6 (between `'returns'` and `'reverse'`).
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): add return_to_sender stage key + label`

### Task 6.2 — Age-based health bucket

**Files:** `apps/frontend/src/app/app/operations-control/lib/health.ts` + test

- [ ] **Step 1: Read** existing `computeStageHealth` and identify the dispatch by stage key.
- [ ] **Step 2: Failing tests:** for stage `'return_to_sender'`, items with `entered_return_to_sender_at ≥ 14 days ago` → `late`; ≥ 7 days → `at_risk`; otherwise `ok`. `delta` returns a count of `at_risk + late`. Stage age reads strictly from `orders.entered_return_to_sender_at` (added in Task 1.1, written by Chunks 2–3 RPCs); never derive from `updated_at`.
- [ ] **Step 3: Implement** the bucketing branch.
- [ ] **Step 4: Run tests.** **Step 5: Commit.** `feat(spec-44a): age-based health for return_to_sender`

### Task 6.3 — `OpsControlDesktop` wiring

**Files:** `apps/frontend/src/app/app/operations-control/components/OpsControlDesktop.tsx` + `page.test.tsx`

- [ ] **Step 1: Failing test** asserts that with a snapshot containing two `returns_to_sender` orders, the StageStrip shows the 8th card with label "Devoluciones a Remitente" and count `2`; clicking the card swaps the active panel to `ReturnToSenderPanel`.
- [ ] **Step 2: Implement.**
  - Add `case 'return_to_sender': return snapshot.returnsToSender;` to `getItemsForStage` switch.
  - Import `ReturnToSenderPanel` and add to the panel-rendering switch.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): wire return_to_sender into OpsControlDesktop`

---

## Chunk 7 — `ReturnToSenderPanel` component

**Files:**
- Create: `apps/frontend/src/app/app/operations-control/components/stage-panels/ReturnToSenderPanel.tsx`
- Create: `apps/frontend/src/app/app/operations-control/components/stage-panels/ReturnToSenderPanel.test.tsx`

### Task 7.1 — Sub-tabs + KPIs (no actions yet)

- [ ] **Step 1: Failing tests:**
  - Renders title "Devoluciones a Remitente."
  - 4 KPIs render with correct values: pendientes (count of `pending_confirmation`), listos (count of `ready_to_return`), remitentes (distinct count of `tenant_client_id` across both), antigüedad media in days.
  - Default sub-tab is "Pendiente confirmación"; switching shows the "Listo para retornar" rows.
- [ ] **Step 2: Implement** using `StagePanel` + `OrderTable` primitives. Pull data from `useStageBreakdown('return_to_sender', operatorId, page)`. Sub-tab state via local `useState`.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): ReturnToSenderPanel sub-tabs + KPIs`

### Task 7.2 — Row actions wired to hooks

- [ ] **Step 1: Failing tests:**
  - Clicking **"Confirmar retorno"** on a `pending_confirmation` row calls `useConfirmReturnToSender` with that order id.
  - Clicking **"Marcar devuelto"** on a `ready_to_return` row calls `useMarkReturnedToSender`.
  - Action buttons only show in the correct sub-tab.
  - Optimistic re-render: after success, the snapshot refetch removes the row.
- [ ] **Step 2: Implement** action columns in the table, calling the hooks. Disable button while mutation is in flight.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): ReturnToSenderPanel row actions`

### Task 7.3 — Agrupar por remitente toggle

- [ ] **Step 1: Failing test:** toggling "Agrupar por remitente" groups rows by `tenant_client.name`, with a group header row showing the count.
- [ ] **Step 2: Implement** local state + a small grouping helper (≤ 30 lines) inside the panel file. If grouping logic grows past ~40 lines, extract to a sibling `groupByRemitente.ts`.
- [ ] **Step 3: Run tests.** **Step 4: Commit.** `feat(spec-44a): grouping toggle in ReturnToSenderPanel`

---

## Chunk 8 — Admin config form

**Files:**
- Modify: `apps/frontend/src/components/admin/ClientForm.tsx` + `ClientForm.test.tsx`
- Touch as needed: `apps/frontend/src/components/admin/ClientManagement.tsx` (the table host) and `apps/frontend/src/app/api/clients/[id]/route.ts` (PATCH route — extend payload typing to accept `return_policy` and `return_attempts_threshold`).

### Task 8.1 — Policy radio + threshold input

- [ ] **Step 1: Failing test:** form displays current `return_policy` for the loaded tenant; toggling to `auto_after_attempts` reveals the threshold input (hidden under `require_confirmation`); `threshold` defaults to current DB value; saving calls the existing tenant-update mutation with both fields.
- [ ] **Step 2: Failing test for validation:** submitting `threshold = 0` shows an error and does not call the mutation.
- [ ] **Step 3: Implement** the two fields, the conditional render, and the client-side validation.
- [ ] **Step 4: Run tests.** **Step 5: Commit.** `feat(spec-44a): tenant return-policy admin fields`

---

## Wrap-up

### Final verification

- [ ] **Step 1: Full test suite.** `pnpm test`
- [ ] **Step 2: Typecheck.** `pnpm -F frontend typecheck`
- [ ] **Step 3: Build.** `pnpm -F frontend build`
- [ ] **Step 4: Manual smoke (against local Supabase):**
  - Insert a fixture order with 3 failed attempts under an auto-policy tenant; call `promote_order_to_return_to_sender` directly; confirm Ops Control now shows it in the new stage.
  - Insert a fixture under a `require_confirmation` tenant; promote; click "Confirmar retorno"; row moves to "Listo para retornar"; click "Marcar devuelto"; row disappears from the stage and `return_to_sender_state` is `returned` in the DB.
  - Insert a Devolución pickup via Reception Hub fixtures; confirm it lands directly in "Listo para retornar."
- [ ] **Step 5: Update spec status** at the top of this file from `backlog` to `in progress` upon the first implementation commit, and never to `completed` until the user confirms (per `docs/specs/CLAUDE.md`).
- [ ] **Step 6: PR + auto-merge** per `CLAUDE.md`:
  ```bash
  gh pr create --title "feat(spec-44a): devoluciones a remitente — stage foundation" --body "<summary>"
  gh pr merge --auto --squash
  ```
- [ ] **Step 7: Watch CI to green and confirm merge:**
  ```bash
  gh pr checks <N>
  gh pr view <N> --json state,mergedAt
  ```
  Do not declare done until merged.

### Out-of-scope follow-up

- **spec-44b** — Despacho return-shipment tab with documentation/evidence bundle (replaces the manual `mark_returned_to_sender` button as the real exit).
