# Spec-31: Conversations Monitoring Tab

> **Related:** [spec-24-customer-communication-agent.md](spec-24-customer-communication-agent.md) — WISMO agent that produces the conversations being monitored here.

**Status:** backlog

_Date: 2026-04-09_

---

## Goal

A dedicated tab in the operator dashboard that lets admins and customer service agents monitor all conversations between customers and the WISMO agent in real time, and send WhatsApp replies to escalated conversations directly from the UI.

**Success criteria:**
- Operators can see all customer sessions (active, escalated, closed) filtered by status, date, customer name, or order number
- New messages and status changes appear without page refresh (Supabase Realtime)
- Authorized users can send a WhatsApp reply to an escalated session from the tab
- Escalated sessions are visually prominent and sortable to the top

---

## Prerequisites

- spec-24 (customer_sessions, customer_session_messages tables and WISMO agent must be live)
- spec-10c (WhatsApp webhook routing — needed to dispatch operator replies)

---

## Permissions

Add `customer_service` to the operator permissions enum.

| Role | Can view tab | Can send replies |
|---|---|---|
| `admin` | yes | yes |
| `operations_manager` | yes | yes |
| `customer_service` | yes | yes |
| All others | no | no |

---

## Schema Changes

### 1. Add `customer_service` permission

```sql
-- Add customer_service to the existing permissions enum
-- Note: verify the enum name in production schema before running (spec-10b defines it)
ALTER TYPE operator_permission ADD VALUE IF NOT EXISTS 'customer_service';
```

### 2. Add `operator` role to `customer_session_messages`

The existing `chk_session_message_role` constraint only allows `('user', 'system')`. Operator replies need a distinct third value so they can be rendered differently in the UI without a separate column.

```sql
-- Drop old constraint, recreate with 'operator' added
ALTER TABLE public.customer_session_messages
  DROP CONSTRAINT chk_session_message_role;

ALTER TABLE public.customer_session_messages
  ADD CONSTRAINT chk_session_message_role
    CHECK (role IN ('user', 'system', 'operator'));
```

---

## Architecture

Follows the existing unidirectional dependency: `page → components → hooks → lib → Supabase`.

### File Structure

```
app/(dashboard)/conversations/
  page.tsx                          ← layout shell, permission gate

components/conversations/
  ConversationList.tsx              ← left panel: filters + session cards
  ConversationSessionCard.tsx       ← single session row in the list
  ConversationThread.tsx            ← right panel: message bubbles + header
  MessageBubble.tsx                 ← individual message (inbound/outbound/system)
  ReplyBox.tsx                      ← textarea + send button (escalated + authorized only)

hooks/
  useConversationSessions.ts        ← TanStack Query + Realtime on customer_sessions
  useConversationMessages.ts        ← TanStack Query + Realtime on customer_session_messages
  useSendReply.ts                   ← server action mutation

lib/conversations/
  actions.ts                        ← server action: insert message + enqueue WhatsApp dispatch
  queries.ts                        ← typed Supabase queries for sessions and messages
```

---

## UI Design

### Layout

Two-column split (WhatsApp Web style):

- **Left panel (340px fixed):** filterable scrollable session list
- **Right panel (flex):** full message thread with reply box at the bottom
- No URL navigation — selecting a session updates local Zustand state in-place

### Left Panel — Session List

- Search input (debounced 300ms): matches `customer_name` or order number
- Status filter pills: All / Escalated / Active / Closed (multi-select, togglable)
- Date range picker: from/to inputs, defaults to "Hoy" shortcut
- Session cards sorted by `updated_at DESC`
- Escalated sessions: amber left border, visually prominent
- Unread dot badge on sessions with new messages since last viewed (Zustand, reset on select)
- Avatar initials from customer name, color-coded by status

### Right Panel — Conversation Thread

- **Header:** customer name, phone number, order number, status badge, "Resolver" button (authorized + escalated only → sets `status: 'closed'`)
- **Messages:**
  - Customer messages (role: `user`) → left-aligned, dark bubble
  - Agent messages (role: `system`) → right-aligned, blue bubble
  - Operator replies (role: `operator`) → right-aligned, purple bubble
  - System events (session opened, escalated, closed) → centered timestamp banners
  - `wa_status` icon on outbound bubbles: ✓ sent, ✓✓ delivered, ✓✓ (blue) read, ✗ failed
- Auto-scrolls to bottom on new messages

### Reply Box

- Only rendered when: `session.status === 'escalated'` AND user is `admin`, `operations_manager`, or `customer_service`
- Textarea grows up to 4 lines, then scrolls
- Send button disabled when empty or mutation in flight
- `Ctrl+Enter` submits
- Shows "Enviando..." state while pending
- On error: inline error message below textarea with retry; message text preserved

---

## Data & Real-time

### `useConversationSessions(filters)`

- Fetches `customer_sessions` filtered by `operator_id` + active filters
- Filters: `status[]`, `date_from`, `date_to`, `search` — search matches `customer_name` (on `customer_sessions`) or `orders.number` (string field on the joined `orders` table via `customer_sessions.order_id`)
- Sorted by `updated_at DESC`
- Supabase Realtime subscription on `customer_sessions` for the operator — live status changes re-sort the list automatically

### `useConversationMessages(sessionId)`

- Fetches all `customer_session_messages` for the selected session, ordered `created_at ASC`
- Supabase Realtime subscription filtered by `session_id` — new messages appear instantly
- Includes: `role`, `body`, `wa_status`, `action_taken`, `created_at`

### `useSendReply(sessionId)`

- Calls `lib/conversations/actions.ts` server action
- Server action:
  1. Validates user has permission (server-side)
  2. Inserts row into `customer_session_messages` with `role: 'operator'`; receives the new `message_id`
  3. Enqueues a `operator-reply` job on the existing WISMO BullMQ queue:
     ```ts
     // Job type: 'operator-reply'
     {
       type: 'operator-reply',
       session_id: string,
       message_id: string,   // customer_session_messages.id — for wa_status update
       operator_id: string,
       customer_phone: string,
       body: string,
     }
     ```
  4. WISMO worker handles this job type: calls `sendWhatsAppMessage`, then updates `wa_status` on the message row
  5. On queue enqueue failure: the message insert is rolled back (transaction)
- Optimistic update: message appears immediately with `wa_status: 'sent'`; rolled back on error

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Reply send failure | Inline error below ReplyBox; message text preserved; retry button |
| Realtime subscription drops | "Conexión interrumpida" banner; falls back to 30s polling via TanStack Query `refetchInterval` |
| Session not found | Empty state in right panel: "Conversación no disponible" |
| Unauthorized access to tab | Redirect to dashboard (existing permission gate in AppLayout) |

---

## Testing

All tests written before implementation (TDD).

### Unit Tests

- `useConversationSessions`: filter logic (status, date, search); Realtime update re-sorts list correctly
- `useConversationMessages`: messages ordered by `created_at`; optimistic insert appears before server confirms; rolled back on error
- `useSendReply`: server action called with correct payload; optimistic update rolled back on failure
- `queries.ts`: session query filters by `operator_id`; message query filters by `session_id`

### Component Tests

- `ConversationThread`: ReplyBox hidden when session not escalated; hidden when user lacks permission
- `ReplyBox`: submit disabled when empty; `Ctrl+Enter` triggers submit; error state shows retry; "Enviando..." shown during pending
- `ConversationSessionCard`: escalated sessions render amber border; unread dot badge shown/hidden correctly
- `ConversationList`: search input debounce; status filter pills toggle correctly

### Integration Tests (Node env)

- `actions.ts`: inserts message row with correct fields; enqueues BullMQ job; rolls back message insert on queue failure
- Permission check: server action rejects users without `customer_service`/`admin`/`operations_manager` role

---

## Nav Item

Add to `navItems` in `AppLayout.tsx`:

```ts
// AppLayout.tsx already defines: const isAdminOrManager = role === 'admin' || role === 'operations_manager';
{ href: '/app/conversations', label: 'Conversaciones', icon: MessageSquareIcon,
  show: isAdminOrManager || permissions.includes('customer_service') },
```

The `"Resolver"` button calls a separate server action `lib/conversations/actions.ts → closeSession(sessionId)` that sets `customer_sessions.status = 'closed'` and `closed_at = now()`. It is distinct from `useSendReply`. No WhatsApp notification is sent to the customer — this is an internal operator action only.

---

## Implementation Plan

_To be filled in by writing-plans skill._
