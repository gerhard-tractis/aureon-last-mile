# Spec-36: WISMO Agent Test Console

> **Related:** [spec-24-customer-communication-agent.md](spec-24-customer-communication-agent.md)
> Architecture: `docs/architecture/agents.md`

**Status:** backlog

_Date: 2026-04-23_

---

## Goal

A dev-only frontend console that lets an operator simulate the full lifecycle of customer events the WISMO agent reacts to, observe what the agent does, and inspect the resulting database state — without touching real WhatsApp infrastructure or live customer orders. The primary use case is **iterating on agent behavior**: confirming proactive triggers, testing reactive intent classification, comparing how different OpenRouter models perform on the same scenarios, and catching mismatches between what the agent says and what it writes to the database.

This is a **development tool**, not a customer-facing or operator-facing production feature.

## Prerequisites

- spec-24 (WISMO agent — proactive/reactive flows, tools, schema). **Spec-24 is marked `completed`**; this spec retrofits two small opt-in parameters onto `processWismoJob` (see "Agent changes" section). This is acknowledged scope touching a completed spec and is expected.
- spec-25 (agents deploy pipeline — `apps/agents` running locally or against a dev environment)
- spec-33 (admin/maintainer role — used for page gating)

**Prior art to follow:** `apps/frontend/src/app/app/ocr-test/` (spec-27) — same pattern of admin-gated dev page with a client component and collocated tests. Use its structure as the starting template.

**Pre-implementation verification:** Before starting Chunk 2, confirm that `processWismoJob(opts)` is exported from `apps/agents/src/agents/wismo/wismo-agent.ts` and is the exact function invoked by `createWismoHandler` (the BullMQ handler factory). If production logic has drifted into a closure that only the worker sees, refactor it into `processWismoJob` first so the test console exercises the same code path as production.

## Non-Goals (V1)

- Real WhatsApp / Meta API testing (Meta business number not yet validated)
- Real Telegram bot or any other live channel — chat is mocked in-page
- BullMQ queue path testing (calls `processWismoJob` directly, bypassing Redis)
- Loading or replaying past real customer sessions
- Saving multi-step "scenario presets" that fire a sequence of events automatically
- Side-by-side comparison of two models on the same input (operator switches model and re-runs manually)
- Exporting transcripts
- Capacity-aware test order seeding
- Token cost data sourced live from OpenRouter (cost readout uses a hardcoded local pricing table)

---

## Architecture

```
┌────────────────────────────────────────────────────┐
│ Frontend: apps/frontend/src/app/app/dev/wismo-test │
│   - Admin/maintainer-gated page                     │
│   - Three-panel layout: events | chat | activity    │
│   - Calls Next.js /api/dev/wismo-test/* proxies     │
└──────────┬─────────────────────────────────────────┘
           │ HTTP (with X-Dev-Token, server-side only)
           ↓
┌────────────────────────────────────────────────────┐
│ apps/agents: /dev/* (only registered in non-prod)  │
│   POST /dev/test-orders            create test order│
│   GET  /dev/test-orders            list test orders │
│   POST /dev/test-orders/purge      soft-delete all  │
│   GET  /dev/test-orders/:id/snapshot                │
│   POST /dev/test-orders/:id/state  raw DB edit      │
│   POST /dev/simulate-event         invoke agent     │
└────────────────────────────────────────────────────┘
```

**Execution model:**
- `/dev/simulate-event` calls `processWismoJob` **synchronously** (no BullMQ, no Redis). Returns a snapshot diff in the response. Frontend updates panels from the response — no polling, no realtime subscription.
- The WISMO agent's `send_customer_message` tool gets a `channel` parameter. When `channel === 'mock'`, the WhatsApp send is short-circuited: the message is still appended to `customer_session_messages` (so the chat panel renders it), but no Meta API call is made. A synthetic `external_message_id = 'MOCK-<uuid>'` is returned.
- The WISMO agent gets a `modelOverride` parameter. When set, the agent uses `openrouter(modelOverride)` instead of the default model constant. Default behavior unchanged for production.

**Production safety — fail-closed defense in depth:**

Three independent conditions must all hold for `/dev/*` routes to be reachable. Each alone is sufficient to block.

1. **Positive opt-in flag:** `process.env.ENABLE_DEV_ENDPOINTS === 'true'` — must be explicitly set. Absent or any other value = routes not registered. This is the primary gate. Must never be set on the production VPS.
2. **Environment guard:** `process.env.NODE_ENV !== 'production'` — defense in depth if someone copy-pastes env vars.
3. **Shared token:** `X-Dev-Token` header matching `process.env.AGENTS_DEV_TOKEN`.

If any of the three fails, the route is not registered (for 1 and 2, at boot time) or returns 404 (for 3, at request time). The router is built at boot; the routes literally do not exist on the production worker. Startup logs a warning if `ENABLE_DEV_ENDPOINTS=true` is combined with `NODE_ENV=production` and refuses to register the routes.

**Additional guards:**
- The test page UI is gated to `role IN ('admin', 'maintainer')` and returns 404 (not 403) for non-admins.
- Frontend never holds the dev token in client code. Browser → Next.js route handler → `apps/agents`. The route handler injects the header server-side.
- The Next.js proxy route extracts the authenticated user's `operator_id` from their session and forwards it as `X-Operator-Id`. `apps/agents` dev endpoints scope all Supabase queries to this operator_id. Maintainers with access to multiple operators must select the active operator in the top bar (see Layout); the selection is sent on every proxy call.

---

## Schema Changes

**No new tables.** Two minimal additions:

### 1. Dev seed — NOT a production migration

The dev retailer and dev driver must **not** leak into production UIs (they would appear in retailer/driver dropdowns as "DEV Test Retailer" etc.). Two options, pick one:

**Option A (preferred):** Place the SQL in `packages/database/supabase/seed/dev_test_seed.sql` — Supabase seed files run only on `supabase db reset` and local dev, never on production migrations. This keeps the rows out of prod entirely.

**Option B (fallback):** If the seed path is not available, place the migration in `packages/database/supabase/migrations/` but insert the rows with `deleted_at = now()` so they are soft-deleted by default. All normal queries filter `WHERE deleted_at IS NULL`, so production UIs never see them. The `/dev/test-orders` endpoints bypass the soft-delete filter to resurrect the rows when seeding test orders.

Inserts one `retailers` row and one `drivers` row per existing operator with deterministic UUIDs derived from `operator_id` (so the IDs are predictable across environments) and `name LIKE 'DEV Test %'`. Uses `ON CONFLICT DO NOTHING`.

Chunk 1 implementation must confirm which option is feasible for this codebase and document the choice.

### 2. Test data tagging convention (no schema change)

Test orders are identified by `external_id LIKE 'TEST-%'`. All `/dev/*` reads and writes scope to this tag. The existing `external_id` column is reused — no schema migration needed.

---

## Backend: dev endpoints in `apps/agents`

All endpoints under `/dev/*`. All require `X-Dev-Token` header. All disabled in production.

| Method & path | Body | Returns |
|---|---|---|
| `POST /dev/test-orders` | `{ customer_name, customer_phone, delivery_date, delivery_window_start, delivery_window_end }` | `{ order_id, snapshot }` |
| `GET  /dev/test-orders` | — | `{ orders: [{ id, customer_name, customer_phone, delivery_date, status, created_at }] }` |
| `POST /dev/test-orders/purge` | — | `{ deleted_count }` — soft-deletes orders + all related rows (assignments, dispatches, customer_sessions, customer_session_messages, order_reschedules, wismo_notifications) AND `agent_events` scoped by order_id. Soft-delete ordering is bottom-up (children first, order last) to avoid orphaned rows breaking FK checks during concurrent reads. |
| `GET  /dev/test-orders/:id/snapshot` | — | `{ order, assignment, dispatch, session, messages, reschedules, recent_agent_events }` |
| `POST /dev/test-orders/:id/state` | `{ table: 'orders'\|'assignments'\|'dispatches'\|'reset_session', fields }` | `{ snapshot }` |
| `POST /dev/simulate-event` | `{ order_id, event_type, model?, payload? }` | `{ snapshot, new_messages, new_agent_events, model_used, estimated_cost_usd }` |

### `event_type` values

Maps 1:1 to queue job types defined in spec-24. Queue job name → `wismo_type_enum` value mapping is per spec-24 (e.g. `proactive_pickup` job → `proactive_pickup_confirmed` enum value).

- `proactive_early_arrival` — payload: `{}` (derived fields resolved server-side)
- `proactive_pickup` — payload: `{}` (maps to `wismo_type_enum = proactive_pickup_confirmed` per spec-24; `assignment_id` is derived server-side, see below)
- `proactive_eta` — payload: `{ estimated_at: ISO timestamp }`
- `proactive_delivered` — payload: `{}`
- `proactive_failed` — payload: `{ failure_reason: string }`
- `client_message` — payload: `{ body: string }`

**Server-side payload enrichment.** Spec-24 requires specific fields on several job payloads (e.g. `proactive_pickup` carries `assignment_id`; `proactive_delivered`/`proactive_failed` reference the latest assignment). `/dev/simulate-event` derives these by querying the latest non-deleted `assignments` row for the test `order_id` and injecting them into the built job payload. The frontend does not supply them.

### `/dev/simulate-event` flow

1. Validate payload with Zod (per event_type).
2. Build the same job payload BullMQ would carry in production.
3. Read pre-execution snapshot.
4. Call `processWismoJob({ payload, supabase, modelOverride: model, channel: 'mock' })`.
5. Read post-execution snapshot.
6. Diff: `new_messages`, `new_agent_events` (rows whose IDs were not present pre-execution).
7. Compute `estimated_cost_usd` from `agent_events` token usage × the local pricing table for `model_used`.
8. Return.

### Test order seed (one click)

`POST /dev/test-orders` inserts a fully-wired scenario:
- `orders` row — `external_id = 'TEST-' || gen_random_uuid()`, user-supplied customer info, dev `retailer_id` + dev address, `status = 'confirmed'`.
- `assignments` row — `status = 'pending'`, fixed dev `driver_id`.
- `dispatches` row — no `estimated_at` yet (set later via the ETA event or state editor).

Implementation note: a single SQL transaction creates all three rows. Failure rolls back the order.

---

## Frontend: `/app/dev/wismo-test`

Page route: `apps/frontend/src/app/app/dev/wismo-test/page.tsx`. Gated by middleware to `role IN ('admin', 'maintainer')`; returns 404 for everyone else.

### Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Top bar: [Test order selector ▾] [+ New test order] [Clear all test orders] │
│           [Model: meta-llama/llama-3.3-70b-instruct ▾]                       │
├──────────────┬────────────────────────────────────┬──────────────────────────┤
│ EVENTS       │ CHAT                               │ ACTIVITY / DB STATE      │
│              │                                    │                          │
│ Proactive:   │ ┌──────────────────────────────┐   │ ┌── tabs ──────────────┐ │
│  ▶ Early arr │ │ [system] Hola, tu pedido...  │   │ │ Activity │ DB State │ │
│  ▶ Pickup    │ │ [user]   ¿dónde está?        │   │ ├──────────────────────┤ │
│  ▶ ETA (hh)  │ │ [system] Tu pedido va...     │   │ │ ── Activity ──       │ │
│  ▶ Delivered │ │                              │   │ │ 14:22  tool_call     │ │
│  ▶ Failed    │ │                              │   │ │   get_order_status   │ │
│              │ │                              │   │ │ 14:22  tool_call     │ │
│ Reactive:    │ │                              │   │ │   send_customer_msg  │ │
│  [type customer reply...]                    [↵] │ │ Cost: ~$0.0023        │ │
│              │                                    │ │                      │ │
│ State edit:  │                                    │ │ ── DB State ──       │ │
│  ✎ Order     │                                    │ │ orders.row           │ │
│  ✎ Assignmt  │                                    │ │ assignments.row      │ │
│  ✎ Dispatch  │                                    │ │ dispatches.row       │ │
│  ✎ Reset ses │                                    │ │ customer_sessions    │ │
│              │                                    │ │ order_reschedules[]  │ │
└──────────────┴────────────────────────────────────┴──────────────────────────┘
```

### Top bar

- **Operator selector** — only shown if the signed-in user is a maintainer with access to multiple operators. Admins (single-operator) see a static label. Selection drives the `X-Operator-Id` header on every proxy call and scopes test-order reads/writes. Persists in URL (`?operator=...`).
- **Test order selector** — dropdown of `GET /dev/test-orders`. Switching changes the active `order_id` for all panels.
- **+ New test order** — opens `NewOrderModal`: `customer_name`, `customer_phone`, `delivery_date`, `delivery_window_start`, `delivery_window_end`. On submit, calls `POST /dev/test-orders`, refreshes the selector, switches to the new order.
- **Clear all test orders** — calls `POST /dev/test-orders/purge`, refreshes the selector.
- **Model selector** — `ModelSelector` component bound to a curated list (see "Model list"). Selection persists in URL (`?model=...`) so reloads keep state. Used as the `model` field on every `/dev/simulate-event` call.

### Events panel

- **Proactive buttons** — one per `event_type`. ETA shows an inline time-picker; Failed shows a reason dropdown (`not_home`, `no_access`, `customer_unreachable`, `address_invalid`).
- **Reactive input** — text box at the bottom. Submitting fires `POST /dev/simulate-event { event_type: 'client_message', payload: { body } }`.
- **State editors** — each opens a small inline form (`StateEditModal`) that calls `POST /dev/test-orders/:id/state`. No agent invocation.
  - Order: `delivery_date`, `delivery_window_*`, `customer_phone`, `customer_name`
  - Assignment: `status` (any of the assignment status enum values)
  - Dispatch: `estimated_at`, `status`
  - Reset session: soft-deletes the active `customer_sessions` row and its messages

### Chat panel

Renders `customer_session_messages` for the active order's session in chronological order. Customer messages right-aligned, agent messages left-aligned. Auto-scroll on new message. Empty state: "No messages yet — fire a proactive event or type a customer reply."

### Activity / DB panel

Tabbed:

- **Activity tab** — live tail of `agent_events` for this order. Each row shows: timestamp, event type (tool_call, tool_result, model_response), tool name + args + result (expandable). At the bottom: `Cost: ~$X` for the most recent simulate-event call. Older calls' costs persist in the tail.
- **DB State tab** — current row contents of:
  - `orders` (one row)
  - latest `assignments` row
  - latest `dispatches` row
  - active `customer_sessions` row (or "no active session")
  - all `order_reschedules` rows

Both tabs refresh from the simulate-event response — no polling. State-edit endpoint responses also carry a fresh snapshot; the frontend updates panels from it using the same pattern. Switching the active order in the top bar selector triggers `GET /dev/test-orders/:id/snapshot` to load panel state.

---

## Agent changes (`apps/agents/src/agents/wismo/`)

Surgical edits, not a rewrite:

### `wismo-agent.ts` (or wherever `processWismoJob` lives)

```ts
export async function processWismoJob(opts: {
  payload: WismoJobPayload;
  supabase: SupabaseClient;
  modelOverride?: string;       // NEW — undefined = use default
  channel?: 'whatsapp' | 'mock'; // NEW — default 'whatsapp'
}): Promise<WismoJobResult> {
  const channel = opts.channel ?? 'whatsapp';
  const model = opts.modelOverride
    ? openrouter(opts.modelOverride)
    : openrouter(WISMO_DEFAULT_MODEL);
  // ... thread `channel` through tool context (e.g. via createTools({ supabase, channel }))
}
```

### `send_customer_message` tool (`apps/agents/src/tools/whatsapp/send-message.ts`)

This is the tool named `send_customer_message` in spec-24. Its current production behavior writes to both `customer_session_messages` and `wismo_notifications`, then calls Meta. The mock branch preserves both DB writes; only the Meta HTTP call is skipped.

```ts
export async function sendCustomerMessage(args: {
  to: string;
  body: string;
  channel?: 'whatsapp' | 'mock';
  // ... existing args
}) {
  let external_message_id: string;
  let wa_status: string;

  if (args.channel === 'mock') {
    external_message_id = `MOCK-${crypto.randomUUID()}`;
    wa_status = 'sent';
    // Skip the Meta HTTP call only. Continue with normal DB writes below.
  } else {
    // existing Meta API call — unchanged
    ({ external_message_id, wa_status } = await callMetaApi(...));
  }

  // Both branches still:
  //  - insert into customer_session_messages (agent memory)
  //  - insert into wismo_notifications with external_message_id + wa_status
  //    (conversation_id = NULL per spec-24)
  // ...
}
```

**Mock branch side-effects explicitly preserved:**
- `customer_session_messages` insert — yes (required for chat panel rendering and agent memory on next turn)
- `wismo_notifications` insert — yes, with `external_message_id = 'MOCK-<uuid>'`, `wa_status = 'sent'`, `conversation_id = NULL`
- Meta HTTP call — no

The `channel` value is passed through the tool context that `processWismoJob` builds. It is not read from `process.env` and not a global. Production defaults to `'whatsapp'` whenever `processWismoJob` is invoked from the BullMQ worker.

---

## Model list (curated)

`apps/frontend/src/lib/dev/wismo-models.ts`:

```ts
export const WISMO_TEST_MODELS = [
  // Tier 1 — very cheap (~$0.02–0.10/M in)
  { id: 'meta-llama/llama-3.1-8b-instruct',   label: 'Llama 3.1 8B  · ~$0.02/M' },
  { id: 'qwen/qwen-2.5-7b-instruct',          label: 'Qwen 2.5 7B   · ~$0.04/M' },
  { id: 'google/gemini-2.5-flash-lite',       label: 'Gemini 2.5 Flash Lite · ~$0.10/M' },
  { id: 'mistralai/ministral-8b',             label: 'Ministral 8B  · ~$0.10/M' },

  // Tier 2 — mid (~$0.10–0.40/M in)
  { id: 'google/gemini-2.5-flash',            label: 'Gemini 2.5 Flash · ~$0.30/M' },
  { id: 'openai/gpt-4o-mini',                 label: 'GPT-4o mini    · ~$0.15/M' },
  { id: 'meta-llama/llama-3.3-70b-instruct',  label: 'Llama 3.3 70B (default) · ~$0.13/M' },
  { id: 'qwen/qwen-2.5-72b-instruct',         label: 'Qwen 2.5 72B   · ~$0.35/M' },
];
```

**Rationale:** Budget-first. Default stays at Llama 3.3 70B (cheap and strong NLU). Tier 1 lets us validate whether 7B/8B models handle WISMO intents well enough to save ~85% per call. Tier 2 confirms whether spending more buys better Spanish-language reschedule capture. No Claude (per project budget direction). No GPT-4o full. Exact OpenRouter IDs to be verified against the catalog at implementation time.

`apps/frontend/src/lib/dev/wismo-pricing.ts`:

```ts
// Local pricing table, USD per 1M tokens. Update as OpenRouter pricing changes.
// Values reflect input/output prices at spec-write time (2026-04-23).
export const WISMO_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'meta-llama/llama-3.1-8b-instruct':   { input: 0.02, output: 0.05 },
  // ... one entry per model in WISMO_TEST_MODELS
};

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = WISMO_MODEL_PRICING[model];
  if (!p) return 0;
  return (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
}
```

Estimated cost is calculated server-side in `/dev/simulate-event` from `agent_events` token usage and returned in the response.

---

## Auth & access control

| Layer | Guard |
|---|---|
| `/app/dev/wismo-test` page | Middleware checks `role IN ('admin', 'maintainer')`. 404 for non-admins. |
| `/api/dev/wismo-test/*` Next.js route handlers | Server-side; inject `X-Dev-Token` header; never expose token to client. |
| `apps/agents/dev/*` endpoints | `process.env.NODE_ENV !== 'production'` (router-level: routes never registered in prod) AND `X-Dev-Token` header check. |
| `processWismoJob` `channel` param | Defaults to `'whatsapp'`. Production worker never passes `'mock'`. |

---

## File deliverables (≤300 lines each)

```
apps/frontend/src/app/app/dev/wismo-test/
  page.tsx                                ~150  layout shell, panel orchestration
  components/
    EventsPanel.tsx                       ~200  proactive buttons, reactive input, state editors
    ChatPanel.tsx                         ~120
    ActivityPanel.tsx                     ~150  activity tab + cost readout
    DbStatePanel.tsx                      ~150
    NewOrderModal.tsx                     ~120
    StateEditModal.tsx                    ~150
    ModelSelector.tsx                     ~80
  hooks/
    useTestOrders.ts                      ~100
    useSimulateEvent.ts                   ~100
    useOrderSnapshot.ts                   ~80
  *.test.ts(x)                            collocated

apps/frontend/src/lib/dev/
  wismo-models.ts                         ~30   curated list
  wismo-pricing.ts                        ~50   per-token costs

apps/frontend/src/app/api/dev/wismo-test/
  test-orders/route.ts                    ~80   POST/GET proxy
  test-orders/purge/route.ts              ~40
  test-orders/[id]/snapshot/route.ts      ~50
  test-orders/[id]/state/route.ts         ~50
  simulate-event/route.ts                 ~60

apps/agents/src/dev/                            (only registered if NODE_ENV !== 'production')
  index.ts                                ~80   router setup, token guard
  test-orders.ts                          ~200  create/list/purge + snapshot
  simulate-event.ts                       ~200  event_type → job payload → processWismoJob
  state-editor.ts                         ~150  raw row updates with TEST- guard
  __tests__/*.test.ts                     collocated

apps/agents/src/agents/wismo/wismo-agent.ts
  +modelOverride and +channel parameters threaded through

apps/agents/src/tools/whatsapp/send-message.ts
  +channel branch (mock returns synthetic external_message_id)

packages/database/supabase/seed/        (Option A — preferred)
  dev_test_seed.sql                       ~40   idempotent dev retailer + driver
# OR, if Option A infeasible (see "Dev seed" section):
packages/database/supabase/migrations/   (Option B — fallback)
  <ts>_dev_test_seed.sql                  ~40   inserts with deleted_at = now()
```

---

## Exit Criteria

**Test order management**
- [ ] Admin can land on `/app/dev/wismo-test`; non-admin gets 404
- [ ] "+ New test order" creates a fully-wired test order (order + assignment + dispatch) in <2s
- [ ] Test orders are identifiable by `external_id LIKE 'TEST-%'` and visible in the selector
- [ ] "Clear all test orders" soft-deletes every test order plus all related rows (assignments, dispatches, sessions, session_messages, reschedules)

**Event simulation**
- [ ] All 5 proactive event buttons fire successfully and produce a visible system message in the chat panel
- [ ] Typing a customer reply produces an agent response in <30s (per spec-24 SLA)
- [ ] All 4 state editors (order/assignment/dispatch/reset session) update the DB; right-panel snapshot reflects the change after refresh

**Observability**
- [ ] Activity tab shows `agent_events` rows with timestamps, tool name, args, result
- [ ] Activity tab shows `model_used` and `estimated_cost_usd` for the most recent call
- [ ] DB State tab shows current rows for orders, assignment, dispatch, session, reschedules

**Model override**
- [ ] Model dropdown contains all 8 entries from `WISMO_TEST_MODELS`
- [ ] Selecting a model and firing an event uses that model (verified via response `model_used` field)
- [ ] Selection persists across page reloads via URL `?model=...`

**Production safety**
- [ ] `apps/agents` production build does not register `/dev/*` routes (verified by request returning 404 in prod)
- [ ] `processWismoJob` defaults to `channel: 'whatsapp'` when not specified; production BullMQ worker never sets `'mock'`
- [ ] Dev token never sent to the browser; only injected server-side by Next.js route handlers

**Quality**
- [ ] All files ≤300 lines
- [ ] Collocated `*.test.ts` files for every new module
- [ ] TDD discipline followed (tests written first per project rule)
- [ ] `operator_id` present on every Supabase query in new code (per project rule)

---

## Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the WISMO Agent Test Console end-to-end: dev seed migration, agent parameterization (`modelOverride`, `channel`), `apps/agents` `/dev/*` endpoints, Next.js proxy routes, and the three-panel page.

**Tech Stack:** TypeScript, Next.js (App Router), React, Tailwind, Vercel AI SDK 4, Supabase JS 2, Zod 3, Vitest 4. All code in `apps/frontend/`, `apps/agents/`, and `packages/database/`.

**Run tests from:**
- Frontend: `apps/frontend/` → `npm test`
- Agents: `apps/agents/` → `npm test`

---

### Chunk 1 — Dev seed migration

**Files:** `packages/database/supabase/migrations/<ts>_dev_test_seed.sql`

- [ ] **Step 1.** Write idempotent migration that, for each existing operator, inserts a `retailers` row (`name = 'DEV Test Retailer'`, deterministic UUID derived from operator_id) and a `drivers` row (`name = 'DEV Test Driver'`, deterministic UUID). Use `ON CONFLICT DO NOTHING`.
- [ ] **Step 2.** Apply migration locally with `npx supabase db reset` and verify the rows appear for the dev operator.

### Chunk 2 — Agent parameterization

**Files:** `apps/agents/src/agents/wismo/wismo-agent.ts`, `apps/agents/src/tools/whatsapp/send-message.ts`, collocated tests.

- [ ] **Step 1 (test-first).** Write failing test: `processWismoJob` accepts `channel: 'mock'`; the `send_customer_message` tool, when invoked with `channel: 'mock'`, returns `external_message_id` matching `/^MOCK-/`, writes the message to `customer_session_messages` AND `wismo_notifications` (with the mock id, `wa_status = 'sent'`, `conversation_id = NULL`), and does not call Meta.
- [ ] **Step 2.** Implement: thread `channel` through the tool context; add the mock branch in the `send_customer_message` tool (`apps/agents/src/tools/whatsapp/send-message.ts`). Confirm test passes.
- [ ] **Step 3 (test-first).** Write failing test: `processWismoJob` accepts `modelOverride: 'qwen/qwen-2.5-7b-instruct'`; the underlying `streamText`/`generateText` call uses that model.
- [ ] **Step 4.** Implement model override path. Confirm test passes.
- [ ] **Step 5.** Verify production default: with neither parameter set, `channel` defaults to `'whatsapp'` and `model` defaults to the existing constant.

### Chunk 3 — `apps/agents` dev router & test-order endpoints

**Files:** `apps/agents/src/dev/index.ts`, `apps/agents/src/dev/test-orders.ts`, `apps/agents/src/dev/state-editor.ts`, collocated tests.

- [ ] **Step 1 (test-first).** Write failing tests for `/dev/test-orders` POST/GET/purge: creating a test order returns an order with `external_id LIKE 'TEST-%'` plus seeded assignment + dispatch; listing returns only test orders; purge soft-deletes all related rows.
- [ ] **Step 2.** Implement endpoints in `test-orders.ts`. Wire into router in `index.ts`. Token guard + NODE_ENV guard at router level.
- [ ] **Step 3 (test-first).** Write failing tests for `/dev/test-orders/:id/snapshot`: returns the expected shape (`{ order, assignment, dispatch, session, messages, reschedules, recent_agent_events }`).
- [ ] **Step 4.** Implement snapshot endpoint.
- [ ] **Step 5 (test-first).** Write failing tests for `/dev/test-orders/:id/state`: updating each table reflects in the snapshot; `reset_session` soft-deletes the active session and messages.
- [ ] **Step 6.** Implement state-editor endpoint with safety guard: only allows updates on rows whose order has `external_id LIKE 'TEST-%'`. Reject otherwise.

### Chunk 4 — `/dev/simulate-event`

**Files:** `apps/agents/src/dev/simulate-event.ts`, collocated tests.

- [ ] **Step 1 (test-first).** For each `event_type`, write a failing test: posting to `/dev/simulate-event` with that event invokes `processWismoJob` with the correct payload, returns a snapshot diff, and includes `model_used` and `estimated_cost_usd`.
- [ ] **Step 2.** Implement Zod payload validation per event_type.
- [ ] **Step 3.** Implement pre/post snapshot diffing.
- [ ] **Step 4.** Implement cost calculation by reading token usage from `agent_events` and applying the local pricing table.
- [ ] **Step 5.** Wire route into router.

### Chunk 5 — Next.js proxy route handlers

**Files:** `apps/frontend/src/app/api/dev/wismo-test/**/*.ts`, collocated tests.

- [ ] **Step 1 (test-first).** Write failing tests: handlers require admin/maintainer role (401 otherwise); handlers fail loudly if `AGENTS_DEV_TOKEN` or `AGENTS_BASE_URL` env vars are missing; handlers never expose the token to the client; handlers inject `X-Dev-Token` and `X-Operator-Id` headers.
- [ ] **Step 2.** For each `apps/agents` `/dev/*` endpoint, implement a thin Next.js route handler that extracts `operator_id` from the user session, injects both headers, and proxies to the agents URL.
- [ ] **Step 3.** Confirm all tests pass.

### Chunk 6 — Frontend hooks

**Files:** `apps/frontend/src/app/app/dev/wismo-test/hooks/**/*.ts`, collocated tests.

- [ ] **Step 1 (test-first).** `useTestOrders` — fetches list, exposes `create`, `purge`. Test loading/error/refresh.
- [ ] **Step 2 (test-first).** `useOrderSnapshot(orderId)` — fetches snapshot when orderId changes. Test refetch on `refresh()` call.
- [ ] **Step 3 (test-first).** `useSimulateEvent(orderId)` — exposes `simulate(event_type, payload, model)`. Returns `new_messages`, `new_agent_events`, `model_used`, `estimated_cost_usd`. Test the response shape.
- [ ] **Step 4.** Implement all three hooks against the proxy routes.

### Chunk 7 — Frontend components

**Files:** `apps/frontend/src/app/app/dev/wismo-test/components/**/*.tsx`, `apps/frontend/src/lib/dev/wismo-models.ts`, `apps/frontend/src/lib/dev/wismo-pricing.ts`, collocated tests.

- [ ] **Step 0.** Before implementing the model list, hit `https://openrouter.ai/api/v1/models` and confirm each curated OpenRouter ID resolves. Update any IDs that have been renamed (e.g. suffix changes like `-001` or `:free`) and refresh the pricing table from the catalog. Document any substitutions made.
- [ ] **Step 1 (test-first).** Write failing tests for `estimateCost(model, tokensIn, tokensOut)`: returns 0 for unknown model; returns expected USD for known model; handles zero tokens. Then implement `wismo-models.ts` and `wismo-pricing.ts`.
- [ ] **Step 2 (test-first).** `ModelSelector` — renders the curated list, persists selection via `?model=` URL param.
- [ ] **Step 3 (test-first).** `NewOrderModal` — form validation; submits create; on success refreshes selector.
- [ ] **Step 4 (test-first).** `EventsPanel` — renders 5 proactive buttons (ETA with time picker, Failed with reason dropdown), reactive input, 4 state-edit launchers. Each calls the right hook.
- [ ] **Step 5 (test-first).** `ChatPanel` — renders messages chronologically; auto-scroll on new message; empty state.
- [ ] **Step 6 (test-first).** `ActivityPanel` — renders `agent_events` tail + cost readout.
- [ ] **Step 7 (test-first).** `DbStatePanel` — renders snapshot rows.
- [ ] **Step 8 (test-first).** `StateEditModal` — generic form for the 4 state-edit operations.

### Chunk 8 — Page shell & route gating

**Files:** `apps/frontend/src/app/app/dev/wismo-test/page.tsx`, middleware.

- [ ] **Step 1.** Add `role IN ('admin', 'maintainer')` check to middleware for `/app/dev/wismo-test`. Returns 404 (not 403) on fail.
- [ ] **Step 2.** Implement `page.tsx` — top bar + three panels using the hooks and components from Chunks 6–7. Active order_id flows from selector → all panels.
- [ ] **Step 3.** Smoke-test in browser: create test order → fire each event → verify chat updates, activity updates, DB state updates, cost shows.

### Chunk 9 — Verification & polish

- [ ] **Step 1.** Run `npm test` in both `apps/frontend` and `apps/agents`. All tests pass.
- [ ] **Step 2.** Verify production build of `apps/agents` does not register `/dev/*` (set `NODE_ENV=production` and request a dev endpoint; expect 404).
- [ ] **Step 3.** Verify all files ≤300 lines; collocated `*.test.ts` files exist for every new module.
- [ ] **Step 4.** Update `docs/sprint-status.yaml` entry for spec-36 to `in-progress`, and after merge to `completed` only on user confirmation.
- [ ] **Step 5.** Per CLAUDE.md: PR + auto-merge.
