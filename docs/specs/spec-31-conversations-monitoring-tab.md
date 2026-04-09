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

Add `customer_service` to the operator permissions (stored as `TEXT[]` on the `users` table — there is no SQL enum).

| Role | Can view tab | Can send replies |
|---|---|---|
| `admin` | yes | yes |
| `operations_manager` | yes | yes |
| `customer_service` | yes | yes |
| All others | no | no |

---

## Schema Changes

### 1. Add `customer_service` permission

Permissions are stored as `TEXT[]` on `public.users` (see migration `20260310100001_add_permissions_to_users.sql`). No schema migration needed — `customer_service` is simply a new string value added to the array via `UPDATE users SET permissions = array_append(permissions, 'customer_service')` for the relevant users. The frontend already reads permissions from JWT claims via `useGlobal().permissions`.

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
src/app/app/conversations/
  page.tsx                              ← layout shell, permission gate

src/app/api/conversations/
  reply/route.ts                        ← POST: insert operator message + send WhatsApp
  close/route.ts                        ← POST: close escalated session

src/components/conversations/
  ConversationList.tsx                  ← left panel: filters + session cards
  ConversationSessionCard.tsx           ← single session row in the list
  ConversationThread.tsx                ← right panel: message bubbles + header
  MessageBubble.tsx                     ← individual message (inbound/outbound/system)
  ReplyBox.tsx                          ← textarea + send button (escalated + authorized only)

src/hooks/conversations/
  useConversationSessions.ts            ← TanStack Query + Realtime on customer_sessions
  useConversationMessages.ts            ← TanStack Query + Realtime on customer_session_messages
  useSendReply.ts                       ← mutation calling POST /api/conversations/reply
  useCloseSession.ts                    ← mutation calling POST /api/conversations/close

src/lib/conversations/
  queries.ts                            ← typed Supabase queries for sessions and messages
  types.ts                              ← shared TypeScript types

src/lib/stores/
  conversationStore.ts                  ← Zustand: selected session, unread tracking
```

All paths relative to `apps/frontend/`. Follows existing pattern: pages in `app/app/`, components in `components/`, hooks in `hooks/`.

**Why API routes instead of server actions:** The codebase does not use Next.js server actions. Existing patterns call Supabase directly from hooks, or use API routes for server-side operations. The reply endpoint needs WhatsApp API credentials (server-only env vars), so an API route is required.

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
- Filters: `status[]`, `date_from`, `date_to`, `search` — search matches `customer_name` (on `customer_sessions`) or `orders.order_number` (VARCHAR(50) on the joined `orders` table via `customer_sessions.order_id`)
- Sorted by `updated_at DESC`
- Supabase Realtime subscription on `customer_sessions` for the operator — live status changes re-sort the list automatically

### `useConversationMessages(sessionId)`

- Fetches all `customer_session_messages` for the selected session, ordered `created_at ASC`
- Supabase Realtime subscription filtered by `session_id` — new messages appear instantly
- Includes: `role`, `body`, `wa_status`, `action_taken`, `created_at`

### `useSendReply(sessionId)`

- Calls `POST /api/conversations/reply` (Next.js API route)
- API route (server-side, has access to WA credentials):
  1. Validates user session and permissions via Supabase auth
  2. Validates the session exists, belongs to the operator, and is escalated
  3. Calls WhatsApp Business API directly via `sendWhatsAppMessage()` (same pattern as WISMO agent's `send_customer_message` tool)
  4. On WhatsApp success: inserts row into `customer_session_messages` with `role: 'operator'`, `wa_status: 'sent'`, `external_message_id`
  5. On WhatsApp failure: returns error to client, no DB row inserted
- Optimistic update on client: message appears immediately; rolled back on API error
- **Env vars needed (server-only):** `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN` (same values as `apps/agents/.env`)

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

- `POST /api/conversations/reply`: inserts message row with correct fields; calls WhatsApp API; returns error when session not escalated
- `POST /api/conversations/close`: updates session status; rejects unauthorized users

---

## Nav Item

Add to `navItems` in `AppLayout.tsx`:

```ts
// AppLayout.tsx already defines: const isAdminOrManager = role === 'admin' || role === 'operations_manager';
// Icon: MessageSquare from lucide-react (add to existing import)
{ href: '/app/conversations', label: 'Conversaciones', icon: MessageSquare,
  show: isAdminOrManager || permissions.includes('customer_service') },
```

The `"Resolver"` button calls `POST /api/conversations/close` which sets `customer_sessions.status = 'closed'` and `closed_at = now()`. It is distinct from `useSendReply`. No WhatsApp notification is sent to the customer — this is an internal operator action only.

---

## Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WhatsApp-style conversations monitoring tab that displays customer ↔ WISMO agent sessions with live updates and operator reply capability.

**Architecture:** Two-column page (session list + message thread). TanStack Query hooks fetch from Supabase, Supabase Realtime pushes live updates, API routes handle WhatsApp reply dispatch. Zustand manages selected-session and unread state.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + Realtime), TanStack Query v5, Zustand, lucide-react, vitest, @testing-library/react

**All paths relative to `apps/frontend/src/`.**

---

## Chunk 1: Foundation (Migration + Types + Store)

### Task 1: Database Migration — add `operator` role

**Files:**
- Create: `packages/database/supabase/migrations/20260409000001_spec31_operator_message_role.sql`

- [ ] **Step 1: Write migration**

```sql
-- spec-31: Allow operator replies in customer_session_messages
-- Adds 'operator' to the allowed role values so operator replies
-- are distinguished from WISMO agent messages ('system').

ALTER TABLE public.customer_session_messages
  DROP CONSTRAINT chk_session_message_role;

ALTER TABLE public.customer_session_messages
  ADD CONSTRAINT chk_session_message_role
    CHECK (role IN ('user', 'system', 'operator'));
```

- [ ] **Step 2: Verify migration applies locally**

Run: `npx supabase db reset` (from `packages/database/`)
Expected: Migration applies without error.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260409000001_spec31_operator_message_role.sql
git commit -m "feat(db): add operator role to customer_session_messages (spec-31)"
```

---

### Task 2: TypeScript Types

**Files:**
- Create: `src/lib/conversations/types.ts`

- [ ] **Step 1: Write types**

```ts
// src/lib/conversations/types.ts

export type SessionStatus = 'active' | 'escalated' | 'closed';
export type MessageRole = 'user' | 'system' | 'operator';
export type WaStatus = 'sent' | 'delivered' | 'read' | 'failed' | null;

export interface ConversationSession {
  id: string;
  operator_id: string;
  order_id: string;
  customer_phone: string;
  customer_name: string | null;
  status: SessionStatus;
  escalated_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  // joined from orders
  order_number: string;
}

export interface SessionMessage {
  id: string;
  operator_id: string;
  session_id: string;
  role: MessageRole;
  body: string;
  external_message_id: string | null;
  wa_status: WaStatus;
  wa_status_at: string | null;
  template_name: string | null;
  action_taken: string | null;
  created_at: string;
}

export interface ConversationFilters {
  statuses: SessionStatus[];
  dateFrom: string | null;
  dateTo: string | null;
  search: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/conversations/types.ts
git commit -m "feat(conversations): add TypeScript types (spec-31)"
```

---

### Task 3: Zustand Store — conversation UI state

**Files:**
- Create: `src/lib/stores/conversationStore.ts`
- Create: `src/lib/stores/conversationStore.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/stores/conversationStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useConversationStore } from './conversationStore';

describe('conversationStore', () => {
  beforeEach(() => {
    useConversationStore.setState(useConversationStore.getInitialState());
  });

  it('starts with no selected session', () => {
    expect(useConversationStore.getState().selectedSessionId).toBeNull();
  });

  it('selects a session and clears its unread', () => {
    const store = useConversationStore.getState();
    store.markUnread('sess-1');
    store.selectSession('sess-1');
    const state = useConversationStore.getState();
    expect(state.selectedSessionId).toBe('sess-1');
    expect(state.unreadSessionIds.has('sess-1')).toBe(false);
  });

  it('tracks unread sessions', () => {
    useConversationStore.getState().markUnread('sess-2');
    expect(useConversationStore.getState().unreadSessionIds.has('sess-2')).toBe(true);
  });

  it('deselects session', () => {
    const store = useConversationStore.getState();
    store.selectSession('sess-1');
    store.selectSession(null);
    expect(useConversationStore.getState().selectedSessionId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/lib/stores/conversationStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// src/lib/stores/conversationStore.ts
import { create } from 'zustand';

interface ConversationStoreState {
  selectedSessionId: string | null;
  unreadSessionIds: Set<string>;
  selectSession: (id: string | null) => void;
  markUnread: (id: string) => void;
}

export const useConversationStore = create<ConversationStoreState>()((set, get) => ({
  selectedSessionId: null,
  unreadSessionIds: new Set(),

  selectSession: (id) =>
    set((state) => {
      const next = new Set(state.unreadSessionIds);
      if (id) next.delete(id);
      return { selectedSessionId: id, unreadSessionIds: next };
    }),

  markUnread: (id) =>
    set((state) => {
      if (state.selectedSessionId === id) return state;
      const next = new Set(state.unreadSessionIds);
      next.add(id);
      return { unreadSessionIds: next };
    }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/lib/stores/conversationStore.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/conversationStore.ts src/lib/stores/conversationStore.test.ts
git commit -m "feat(conversations): add Zustand store for UI state (spec-31)"
```

---

## Chunk 2: Data Layer (Queries + Hooks)

### Task 4: Supabase Queries

**Files:**
- Create: `src/lib/conversations/queries.ts`

- [ ] **Step 1: Write queries**

```ts
// src/lib/conversations/queries.ts
import { createSPAClient } from '@/lib/supabase/client';
import type { ConversationSession, SessionMessage, ConversationFilters } from './types';

export async function fetchSessions(
  operatorId: string,
  filters: ConversationFilters,
): Promise<ConversationSession[]> {
  const supabase = createSPAClient();

  let query = supabase
    .from('customer_sessions')
    .select('*, orders!inner(order_number)')
    .eq('operator_id', operatorId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (filters.statuses.length > 0) {
    query = query.in('status', filters.statuses);
  }
  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo + 'T23:59:59Z');
  }
  if (filters.search) {
    query = query.or(
      `customer_name.ilike.%${filters.search}%,orders.order_number.ilike.%${filters.search}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    order_number: (row.orders as { order_number: string })?.order_number ?? '',
  })) as ConversationSession[];
}

export async function fetchMessages(sessionId: string): Promise<SessionMessage[]> {
  const supabase = createSPAClient();
  const { data, error } = await supabase
    .from('customer_session_messages')
    .select('*')
    .eq('session_id', sessionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as SessionMessage[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/conversations/queries.ts
git commit -m "feat(conversations): add Supabase query functions (spec-31)"
```

---

### Task 5: `useConversationSessions` Hook

**Files:**
- Create: `src/hooks/conversations/useConversationSessions.ts`
- Create: `src/hooks/conversations/useConversationSessions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/hooks/conversations/useConversationSessions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useConversationSessions } from './useConversationSessions';

const mockFetchSessions = vi.fn();

vi.mock('@/lib/conversations/queries', () => ({
  fetchSessions: (...args: unknown[]) => mockFetchSessions(...args),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const FILTERS = { statuses: [], dateFrom: null, dateTo: null, search: '' };

describe('useConversationSessions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useConversationSessions(null, FILTERS), { wrapper: createWrapper() });
    expect(mockFetchSessions).not.toHaveBeenCalled();
  });

  it('fetches sessions when operatorId is provided', async () => {
    const sessions = [{ id: 's1', status: 'active', updated_at: '2026-04-09T12:00:00Z' }];
    mockFetchSessions.mockResolvedValue(sessions);
    const { result } = renderHook(
      () => useConversationSessions('op-1', FILTERS),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sessions);
    expect(mockFetchSessions).toHaveBeenCalledWith('op-1', FILTERS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/hooks/conversations/useConversationSessions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// src/hooks/conversations/useConversationSessions.ts
import { useQuery } from '@tanstack/react-query';
import { fetchSessions } from '@/lib/conversations/queries';
import type { ConversationFilters } from '@/lib/conversations/types';

export function useConversationSessions(
  operatorId: string | null,
  filters: ConversationFilters,
) {
  return useQuery({
    queryKey: ['conversations', 'sessions', operatorId, filters],
    queryFn: () => fetchSessions(operatorId!, filters),
    enabled: !!operatorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/hooks/conversations/useConversationSessions.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/conversations/useConversationSessions.ts src/hooks/conversations/useConversationSessions.test.ts
git commit -m "feat(conversations): add useConversationSessions hook (spec-31)"
```

---

### Task 6: `useConversationMessages` Hook

**Files:**
- Create: `src/hooks/conversations/useConversationMessages.ts`
- Create: `src/hooks/conversations/useConversationMessages.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/hooks/conversations/useConversationMessages.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useConversationMessages } from './useConversationMessages';

const mockFetchMessages = vi.fn();

vi.mock('@/lib/conversations/queries', () => ({
  fetchMessages: (...args: unknown[]) => mockFetchMessages(...args),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useConversationMessages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fetch when sessionId is null', () => {
    renderHook(() => useConversationMessages(null), { wrapper: createWrapper() });
    expect(mockFetchMessages).not.toHaveBeenCalled();
  });

  it('fetches messages ordered by created_at', async () => {
    const msgs = [
      { id: 'm1', role: 'system', body: 'Hola', created_at: '2026-04-09T12:00:00Z' },
      { id: 'm2', role: 'user', body: 'Gracias', created_at: '2026-04-09T12:01:00Z' },
    ];
    mockFetchMessages.mockResolvedValue(msgs);
    const { result } = renderHook(
      () => useConversationMessages('sess-1'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(msgs);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/hooks/conversations/useConversationMessages.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write implementation**

```ts
// src/hooks/conversations/useConversationMessages.ts
import { useQuery } from '@tanstack/react-query';
import { fetchMessages } from '@/lib/conversations/queries';

export function useConversationMessages(sessionId: string | null) {
  return useQuery({
    queryKey: ['conversations', 'messages', sessionId],
    queryFn: () => fetchMessages(sessionId!),
    enabled: !!sessionId,
    staleTime: 10_000,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/hooks/conversations/useConversationMessages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/conversations/useConversationMessages.ts src/hooks/conversations/useConversationMessages.test.ts
git commit -m "feat(conversations): add useConversationMessages hook (spec-31)"
```

---

### Task 7: Realtime Subscriptions

**Files:**
- Create: `src/hooks/conversations/useRealtimeConversations.ts`

Follow the pattern from `src/hooks/useRealtimeOrders.ts`.

- [ ] **Step 1: Write implementation**

```ts
// src/hooks/conversations/useRealtimeConversations.ts
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useConversationStore } from '@/lib/stores/conversationStore';

/**
 * Subscribes to Realtime changes on customer_sessions and customer_session_messages
 * for the given operator. Invalidates TanStack Query caches on change.
 */
export function useRealtimeConversations(operatorId: string | null) {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();

    const channel = supabase
      .channel(`operator:${operatorId}:conversations`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'customer_sessions',
        filter: `operator_id=eq.${operatorId}`,
      }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['conversations', 'sessions'] });
        }, 1000);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'customer_session_messages',
        filter: `operator_id=eq.${operatorId}`,
      }, (payload) => {
        const sessionId = (payload.new as { session_id?: string }).session_id;
        if (sessionId) {
          queryClient.invalidateQueries({ queryKey: ['conversations', 'messages', sessionId] });
          useConversationStore.getState().markUnread(sessionId);
        }
      })
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [operatorId, queryClient]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/conversations/useRealtimeConversations.ts
git commit -m "feat(conversations): add Realtime subscription hook (spec-31)"
```

---

## Chunk 3: Reply + Close Actions

### Task 8: API Route — `POST /api/conversations/reply`

**Files:**
- Create: `src/app/api/conversations/reply/route.ts`

This route handles operator → customer WhatsApp reply. It needs WA credentials as server-only env vars.

- [ ] **Step 1: Write implementation**

```ts
// src/app/api/conversations/reply/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const WA_API_VERSION = 'v18.0';
const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`;

async function sendWhatsApp(phone: string, body: string) {
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID!;
  const accessToken = process.env.WA_ACCESS_TOKEN!;

  const res = await fetch(`${WA_BASE_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: { body },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.messages?.[0]?.id as string;
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  );

  // 1. Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 2. Permission check
  const claims = user.app_metadata?.claims;
  const role = claims?.role as string | undefined;
  const permissions = (claims?.permissions ?? []) as string[];
  const allowed =
    role === 'admin' ||
    role === 'operations_manager' ||
    permissions.includes('customer_service');
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // 3. Parse body
  const { session_id, body: msgBody } = await req.json();
  if (!session_id || !msgBody) {
    return NextResponse.json({ error: 'session_id and body are required' }, { status: 400 });
  }

  // 4. Validate session
  const { data: session, error: sessErr } = await supabase
    .from('customer_sessions')
    .select('id, operator_id, customer_phone, status')
    .eq('id', session_id)
    .eq('operator_id', claims?.operator_id)
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.status !== 'escalated') {
    return NextResponse.json({ error: 'Session is not escalated' }, { status: 422 });
  }

  // 5. Send via WhatsApp
  let externalMessageId: string;
  try {
    externalMessageId = await sendWhatsApp(session.customer_phone, msgBody);
  } catch (err) {
    return NextResponse.json(
      { error: `WhatsApp send failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  // 6. Insert message row
  const { data: msg, error: msgErr } = await supabase
    .from('customer_session_messages')
    .insert({
      operator_id: claims?.operator_id,
      session_id,
      role: 'operator',
      body: msgBody,
      external_message_id: externalMessageId,
      wa_status: 'sent',
    })
    .select('id, created_at')
    .single();

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  return NextResponse.json({ message_id: msg.id, created_at: msg.created_at });
}
```

- [ ] **Step 2: Add env vars to `.env.local` template**

Add to `apps/frontend/.env.local.example` (or document in spec):
```
WA_PHONE_NUMBER_ID=   # same as apps/agents/.env
WA_ACCESS_TOKEN=       # same as apps/agents/.env
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/conversations/reply/route.ts
git commit -m "feat(conversations): add reply API route with WhatsApp dispatch (spec-31)"
```

---

### Task 9: API Route — `POST /api/conversations/close`

**Files:**
- Create: `src/app/api/conversations/close/route.ts`

- [ ] **Step 1: Write implementation**

```ts
// src/app/api/conversations/close/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const claims = user.app_metadata?.claims;
  const role = claims?.role as string | undefined;
  const permissions = (claims?.permissions ?? []) as string[];
  const allowed =
    role === 'admin' ||
    role === 'operations_manager' ||
    permissions.includes('customer_service');
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { session_id } = await req.json();
  if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  const { error } = await supabase
    .from('customer_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', session_id)
    .eq('operator_id', claims?.operator_id)
    .eq('status', 'escalated');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/conversations/close/route.ts
git commit -m "feat(conversations): add close-session API route (spec-31)"
```

---

### Task 10: `useSendReply` + `useCloseSession` Hooks

**Files:**
- Create: `src/hooks/conversations/useSendReply.ts`
- Create: `src/hooks/conversations/useCloseSession.ts`
- Create: `src/hooks/conversations/useSendReply.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/hooks/conversations/useSendReply.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useSendReply } from './useSendReply';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useSendReply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls POST /api/conversations/reply with correct payload', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message_id: 'm1', created_at: '2026-04-09T12:00:00Z' }),
    });
    const { result } = renderHook(() => useSendReply(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ session_id: 's1', body: 'Hola' });
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/conversations/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', body: 'Hola' }),
    });
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Session is not escalated' }),
    });
    const { result } = renderHook(() => useSendReply(), { wrapper: createWrapper() });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ session_id: 's1', body: 'Hola' });
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/hooks/conversations/useSendReply.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write implementations**

```ts
// src/hooks/conversations/useSendReply.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface ReplyPayload {
  session_id: string;
  body: string;
}

export function useSendReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ReplyPayload) => {
      const res = await fetch('/api/conversations/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reply failed');
      return data as { message_id: string; created_at: string };
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'messages', vars.session_id] });
    },
  });
}
```

```ts
// src/hooks/conversations/useCloseSession.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function useCloseSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch('/api/conversations/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Close failed');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'sessions'] });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/hooks/conversations/useSendReply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/conversations/useSendReply.ts src/hooks/conversations/useCloseSession.ts src/hooks/conversations/useSendReply.test.ts
git commit -m "feat(conversations): add reply and close mutation hooks (spec-31)"
```

---

## Chunk 4: Presentational Components

### Task 11: `MessageBubble` Component

**Files:**
- Create: `src/components/conversations/MessageBubble.tsx`
- Create: `src/components/conversations/MessageBubble.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/conversations/MessageBubble.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageBubble } from './MessageBubble';
import type { SessionMessage } from '@/lib/conversations/types';

const base: SessionMessage = {
  id: 'm1', operator_id: 'op1', session_id: 's1',
  role: 'user', body: 'Hola, dónde está mi paquete?',
  external_message_id: null, wa_status: null, wa_status_at: null,
  template_name: null, action_taken: null, created_at: '2026-04-09T12:00:00Z',
};

describe('MessageBubble', () => {
  it('renders customer message left-aligned', () => {
    render(<MessageBubble message={base} />);
    expect(screen.getByText(/Hola, dónde/)).toBeInTheDocument();
    expect(screen.getByTestId('bubble-m1').className).toContain('items-start');
  });

  it('renders agent message right-aligned in blue', () => {
    render(<MessageBubble message={{ ...base, id: 'm2', role: 'system', body: 'En camino' }} />);
    expect(screen.getByTestId('bubble-m2').className).toContain('items-end');
  });

  it('renders operator message right-aligned in purple', () => {
    render(<MessageBubble message={{ ...base, id: 'm3', role: 'operator', body: 'Disculpe' }} />);
    const bubble = screen.getByTestId('bubble-m3');
    expect(bubble.className).toContain('items-end');
  });

  it('shows wa_status icon for outbound messages', () => {
    render(<MessageBubble message={{ ...base, role: 'system', wa_status: 'delivered' }} />);
    expect(screen.getByText('✓✓')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/conversations/MessageBubble.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write implementation**

```tsx
// src/components/conversations/MessageBubble.tsx
'use client';

import type { SessionMessage } from '@/lib/conversations/types';

const WA_STATUS_ICONS: Record<string, string> = {
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓',
  failed: '✗',
};

interface MessageBubbleProps {
  message: SessionMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.role === 'system' || message.role === 'operator';
  const time = new Date(message.created_at).toLocaleTimeString('es-CL', {
    hour: '2-digit', minute: '2-digit',
  });

  const bubbleColor =
    message.role === 'operator'
      ? 'bg-purple-600'
      : message.role === 'system'
        ? 'bg-sky-600'
        : 'bg-slate-800';

  const label =
    message.role === 'operator' ? 'Operador' : message.role === 'system' ? 'Agente' : null;

  return (
    <div
      data-testid={`bubble-${message.id}`}
      className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
    >
      <div className={`max-w-[65%] rounded-xl px-3 py-2 ${bubbleColor}`}>
        <p className="text-sm text-white whitespace-pre-wrap">{message.body}</p>
        <div className={`flex items-center gap-1 mt-1 text-xs ${isOutbound ? 'justify-end' : ''}`}>
          <span className="text-slate-300">{time}</span>
          {label && <span className="text-slate-300">· {label}</span>}
          {isOutbound && message.wa_status && (
            <span className={message.wa_status === 'read' ? 'text-sky-400' : message.wa_status === 'failed' ? 'text-red-400' : 'text-slate-400'}>
              {WA_STATUS_ICONS[message.wa_status] ?? ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/conversations/MessageBubble.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/conversations/MessageBubble.tsx src/components/conversations/MessageBubble.test.tsx
git commit -m "feat(conversations): add MessageBubble component (spec-31)"
```

---

### Task 12: `ConversationSessionCard` Component

**Files:**
- Create: `src/components/conversations/ConversationSessionCard.tsx`
- Create: `src/components/conversations/ConversationSessionCard.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/conversations/ConversationSessionCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConversationSessionCard } from './ConversationSessionCard';
import type { ConversationSession } from '@/lib/conversations/types';

const session: ConversationSession = {
  id: 's1', operator_id: 'op1', order_id: 'ord1',
  customer_phone: '+56911111111', customer_name: 'Maria López',
  status: 'escalated', escalated_at: '2026-04-09T16:30:00Z',
  closed_at: null, created_at: '2026-04-09T12:00:00Z',
  updated_at: '2026-04-09T16:30:00Z', order_number: '4521',
};

describe('ConversationSessionCard', () => {
  it('renders customer name and order number', () => {
    render(<ConversationSessionCard session={session} isSelected={false} isUnread={false} onClick={() => {}} />);
    expect(screen.getByText('Maria López')).toBeInTheDocument();
    expect(screen.getByText(/#4521/)).toBeInTheDocument();
  });

  it('shows escalated badge with amber border', () => {
    const { container } = render(
      <ConversationSessionCard session={session} isSelected={false} isUnread={false} onClick={() => {}} />,
    );
    expect(container.firstChild).toHaveClass('border-l-amber-500');
  });

  it('shows unread dot when isUnread is true', () => {
    render(<ConversationSessionCard session={session} isSelected={false} isUnread={true} onClick={() => {}} />);
    expect(screen.getByTestId('unread-dot')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<ConversationSessionCard session={session} isSelected={false} isUnread={false} onClick={onClick} />);
    fireEvent.click(screen.getByText('Maria López'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/conversations/ConversationSessionCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write implementation**

```tsx
// src/components/conversations/ConversationSessionCard.tsx
'use client';

import type { ConversationSession, SessionStatus } from '@/lib/conversations/types';

const STATUS_COLORS: Record<SessionStatus, string> = {
  escalated: 'bg-amber-500/10 text-amber-500',
  active: 'bg-emerald-500/10 text-emerald-500',
  closed: 'bg-slate-500/10 text-slate-500',
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  escalated: 'ESCALADO',
  active: 'ACTIVO',
  closed: 'CERRADO',
};

const BORDER_COLORS: Record<SessionStatus, string> = {
  escalated: 'border-l-amber-500',
  active: 'border-l-emerald-500',
  closed: 'border-l-slate-600',
};

interface Props {
  session: ConversationSession;
  isSelected: boolean;
  isUnread: boolean;
  onClick: () => void;
}

export function ConversationSessionCard({ session, isSelected, isUnread, onClick }: Props) {
  const initials = (session.customer_name ?? '??')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const time = new Date(session.updated_at).toLocaleTimeString('es-CL', {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex gap-3 items-start px-3 py-3 border-l-4 ${BORDER_COLORS[session.status]} ${
        isSelected ? 'bg-slate-800' : 'hover:bg-slate-800/50'
      } transition-colors`}
    >
      <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-300 shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-semibold text-slate-100 truncate">{session.customer_name ?? 'Sin nombre'}</span>
          <span className="text-xs text-slate-500 shrink-0 ml-2">{time}</span>
        </div>
        <div className="text-xs text-slate-400 truncate">#{session.order_number}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_COLORS[session.status]}`}>
            {STATUS_LABELS[session.status]}
          </span>
          {isUnread && (
            <span data-testid="unread-dot" className="w-2 h-2 rounded-full bg-sky-500" />
          )}
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/conversations/ConversationSessionCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/conversations/ConversationSessionCard.tsx src/components/conversations/ConversationSessionCard.test.tsx
git commit -m "feat(conversations): add ConversationSessionCard component (spec-31)"
```

---

### Task 13: `ReplyBox` Component

**Files:**
- Create: `src/components/conversations/ReplyBox.tsx`
- Create: `src/components/conversations/ReplyBox.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/conversations/ReplyBox.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReplyBox } from './ReplyBox';

describe('ReplyBox', () => {
  it('renders textarea and send button', () => {
    render(<ReplyBox onSend={() => {}} isPending={false} error={null} />);
    expect(screen.getByPlaceholderText(/Escribir respuesta/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('send button is disabled when textarea is empty', () => {
    render(<ReplyBox onSend={() => {}} isPending={false} error={null} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('send button is disabled when pending', () => {
    render(<ReplyBox onSend={() => {}} isPending={true} error={null} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('calls onSend with message text and clears textarea', () => {
    const onSend = vi.fn();
    render(<ReplyBox onSend={onSend} isPending={false} error={null} />);
    const textarea = screen.getByPlaceholderText(/Escribir respuesta/);
    fireEvent.change(textarea, { target: { value: 'Hola' } });
    fireEvent.click(screen.getByRole('button'));
    expect(onSend).toHaveBeenCalledWith('Hola');
  });

  it('submits on Ctrl+Enter', () => {
    const onSend = vi.fn();
    render(<ReplyBox onSend={onSend} isPending={false} error={null} />);
    const textarea = screen.getByPlaceholderText(/Escribir respuesta/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith('Test');
  });

  it('shows error message when error is set', () => {
    render(<ReplyBox onSend={() => {}} isPending={false} error="WhatsApp send failed" />);
    expect(screen.getByText(/WhatsApp send failed/)).toBeInTheDocument();
  });

  it('shows "Enviando..." when pending', () => {
    render(<ReplyBox onSend={() => {}} isPending={true} error={null} />);
    expect(screen.getByText(/Enviando/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/conversations/ReplyBox.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write implementation**

```tsx
// src/components/conversations/ReplyBox.tsx
'use client';

import { useState, useRef } from 'react';
import { Send } from 'lucide-react';

interface ReplyBoxProps {
  onSend: (message: string) => void;
  isPending: boolean;
  error: string | null;
}

export function ReplyBox({ onSend, isPending, error }: ReplyBoxProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = text.trim().length > 0 && !isPending;

  const handleSend = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-slate-800 px-4 py-3">
      {isPending && <p className="text-xs text-slate-400 mb-1">Enviando...</p>}
      {error && <p className="text-xs text-red-400 mb-1">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribir respuesta al cliente vía WhatsApp..."
          rows={1}
          className="flex-1 resize-none bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600 max-h-24 overflow-y-auto"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="w-10 h-10 rounded-full bg-sky-600 flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sky-500 transition-colors shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/conversations/ReplyBox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/conversations/ReplyBox.tsx src/components/conversations/ReplyBox.test.tsx
git commit -m "feat(conversations): add ReplyBox component (spec-31)"
```

---

## Chunk 5: Container Components + Page + Nav

### Task 14: `ConversationThread` Component

**Files:**
- Create: `src/components/conversations/ConversationThread.tsx`
- Create: `src/components/conversations/ConversationThread.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/conversations/ConversationThread.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ConversationThread } from './ConversationThread';
import type { ConversationSession } from '@/lib/conversations/types';

vi.mock('@/hooks/conversations/useConversationMessages', () => ({
  useConversationMessages: () => ({
    data: [
      { id: 'm1', role: 'system', body: 'Hola', wa_status: 'sent', created_at: '2026-04-09T12:00:00Z',
        operator_id: 'op1', session_id: 's1', external_message_id: null, wa_status_at: null,
        template_name: null, action_taken: null },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/hooks/conversations/useSendReply', () => ({
  useSendReply: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('@/hooks/conversations/useCloseSession', () => ({
  useCloseSession: () => ({ mutate: vi.fn(), isPending: false }),
}));

const session: ConversationSession = {
  id: 's1', operator_id: 'op1', order_id: 'ord1',
  customer_phone: '+56911111111', customer_name: 'Maria López',
  status: 'escalated', escalated_at: '2026-04-09T16:30:00Z',
  closed_at: null, created_at: '2026-04-09T12:00:00Z',
  updated_at: '2026-04-09T16:30:00Z', order_number: '4521',
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, ui);
}

describe('ConversationThread', () => {
  it('shows reply box when session is escalated and user has permission', () => {
    render(wrap(<ConversationThread session={session} canReply={true} />));
    expect(screen.getByPlaceholderText(/Escribir respuesta/)).toBeInTheDocument();
  });

  it('hides reply box when user lacks permission', () => {
    render(wrap(<ConversationThread session={session} canReply={false} />));
    expect(screen.queryByPlaceholderText(/Escribir respuesta/)).toBeNull();
  });

  it('hides reply box when session is not escalated', () => {
    render(wrap(<ConversationThread session={{ ...session, status: 'active' }} canReply={true} />));
    expect(screen.queryByPlaceholderText(/Escribir respuesta/)).toBeNull();
  });

  it('renders messages', () => {
    render(wrap(<ConversationThread session={session} canReply={true} />));
    expect(screen.getByText('Hola')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify fail, write implementation**

```tsx
// src/components/conversations/ConversationThread.tsx
'use client';

import { useRef, useEffect } from 'react';
import { CheckCircle } from 'lucide-react';
import type { ConversationSession } from '@/lib/conversations/types';
import { useConversationMessages } from '@/hooks/conversations/useConversationMessages';
import { useSendReply } from '@/hooks/conversations/useSendReply';
import { useCloseSession } from '@/hooks/conversations/useCloseSession';
import { MessageBubble } from './MessageBubble';
import { ReplyBox } from './ReplyBox';

interface Props {
  session: ConversationSession;
  canReply: boolean;
}

export function ConversationThread({ session, canReply }: Props) {
  const { data: messages, isLoading } = useConversationMessages(session.id);
  const reply = useSendReply();
  const close = useCloseSession();
  const bottomRef = useRef<HTMLDivElement>(null);

  const showReplyBox = canReply && session.status === 'escalated';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            {session.customer_name ?? 'Sin nombre'}
          </h2>
          <p className="text-xs text-slate-500">
            #{session.order_number} · {session.customer_phone}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-1 rounded ${
            session.status === 'escalated' ? 'bg-amber-500/10 text-amber-500' :
            session.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' :
            'bg-slate-500/10 text-slate-500'
          }`}>
            {session.status === 'escalated' ? 'ESCALADO' : session.status === 'active' ? 'ACTIVO' : 'CERRADO'}
          </span>
          {showReplyBox && (
            <button
              onClick={() => close.mutate(session.id)}
              disabled={close.isPending}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              <CheckCircle className="w-3 h-3" /> Resolver
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading && <p className="text-center text-sm text-slate-500">Cargando mensajes...</p>}
        {messages?.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      {showReplyBox && (
        <ReplyBox
          onSend={(body) => reply.mutate({ session_id: session.id, body })}
          isPending={reply.isPending}
          error={reply.error?.message ?? null}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/components/conversations/ConversationThread.tsx src/components/conversations/ConversationThread.test.tsx
git commit -m "feat(conversations): add ConversationThread component (spec-31)"
```

---

### Task 15: `ConversationList` Component

**Files:**
- Create: `src/components/conversations/ConversationList.tsx`
- Create: `src/components/conversations/ConversationList.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/conversations/ConversationList.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConversationList } from './ConversationList';
import type { ConversationSession, ConversationFilters } from '@/lib/conversations/types';

const sessions: ConversationSession[] = [
  { id: 's1', operator_id: 'op1', order_id: 'o1', customer_phone: '+56911111111',
    customer_name: 'Maria López', status: 'escalated', escalated_at: '2026-04-09T16:30:00Z',
    closed_at: null, created_at: '2026-04-09T12:00:00Z', updated_at: '2026-04-09T16:30:00Z',
    order_number: '4521' },
  { id: 's2', operator_id: 'op1', order_id: 'o2', customer_phone: '+56922222222',
    customer_name: 'Juan Pérez', status: 'active', escalated_at: null,
    closed_at: null, created_at: '2026-04-09T11:00:00Z', updated_at: '2026-04-09T14:27:00Z',
    order_number: '4498' },
];

describe('ConversationList', () => {
  it('renders session cards', () => {
    render(
      <ConversationList
        sessions={sessions} isLoading={false}
        selectedId={null} unreadIds={new Set()}
        onSelect={() => {}} filters={{ statuses: [], dateFrom: null, dateTo: null, search: '' }}
        onFiltersChange={() => {}}
      />,
    );
    expect(screen.getByText('Maria López')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(
      <ConversationList
        sessions={[]} isLoading={false}
        selectedId={null} unreadIds={new Set()}
        onSelect={() => {}} filters={{ statuses: [], dateFrom: null, dateTo: null, search: '' }}
        onFiltersChange={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText(/Buscar/)).toBeInTheDocument();
  });

  it('toggles status filter on click', () => {
    const onChange = vi.fn();
    render(
      <ConversationList
        sessions={[]} isLoading={false}
        selectedId={null} unreadIds={new Set()}
        onSelect={() => {}} filters={{ statuses: [], dateFrom: null, dateTo: null, search: '' }}
        onFiltersChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Escalado'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['escalated'] }));
  });
});
```

- [ ] **Step 2: Run test, verify fail, write implementation**

```tsx
// src/components/conversations/ConversationList.tsx
'use client';

import { Search } from 'lucide-react';
import type { ConversationSession, ConversationFilters, SessionStatus } from '@/lib/conversations/types';
import { ConversationSessionCard } from './ConversationSessionCard';

const STATUS_OPTIONS: { value: SessionStatus; label: string }[] = [
  { value: 'escalated', label: 'Escalado' },
  { value: 'active', label: 'Activo' },
  { value: 'closed', label: 'Cerrado' },
];

interface Props {
  sessions: ConversationSession[];
  isLoading: boolean;
  selectedId: string | null;
  unreadIds: Set<string>;
  onSelect: (id: string) => void;
  filters: ConversationFilters;
  onFiltersChange: (f: ConversationFilters) => void;
}

export function ConversationList({
  sessions, isLoading, selectedId, unreadIds, onSelect, filters, onFiltersChange,
}: Props) {
  const toggleStatus = (status: SessionStatus) => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    onFiltersChange({ ...filters, statuses: next });
  };

  return (
    <div className="flex flex-col h-full w-[340px] min-w-[340px] border-r border-slate-800 bg-slate-950">
      {/* Search + filters */}
      <div className="p-3 border-b border-slate-800 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            placeholder="Buscar cliente u orden..."
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => toggleStatus(opt.value)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filters.statuses.includes(opt.value)
                  ? opt.value === 'escalated' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                    : opt.value === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                    : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
                  : 'bg-slate-800 text-slate-500 border-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="text-center text-sm text-slate-500 py-8">Cargando...</p>}
        {!isLoading && sessions.length === 0 && (
          <p className="text-center text-sm text-slate-500 py-8">No hay conversaciones</p>
        )}
        {sessions.map((s) => (
          <ConversationSessionCard
            key={s.id}
            session={s}
            isSelected={s.id === selectedId}
            isUnread={unreadIds.has(s.id)}
            onClick={() => onSelect(s.id)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run test, verify pass, commit**

```bash
git add src/components/conversations/ConversationList.tsx src/components/conversations/ConversationList.test.tsx
git commit -m "feat(conversations): add ConversationList component (spec-31)"
```

---

### Task 16: Conversations Page + Nav Item

**Files:**
- Create: `src/app/app/conversations/page.tsx`
- Modify: `src/components/AppLayout.tsx` (lines 5-17 imports, lines 72-81 navItems)

- [ ] **Step 1: Write page**

```tsx
// src/app/app/conversations/page.tsx
'use client';

import { Suspense, useState, useCallback } from 'react';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useConversationSessions } from '@/hooks/conversations/useConversationSessions';
import { useRealtimeConversations } from '@/hooks/conversations/useRealtimeConversations';
import { useConversationStore } from '@/lib/stores/conversationStore';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { MessageSquare } from 'lucide-react';
import type { ConversationFilters } from '@/lib/conversations/types';

function ConversationsContent() {
  const { operatorId, role, permissions } = useGlobal();
  const { selectedSessionId, selectSession, unreadSessionIds } = useConversationStore();

  const [filters, setFilters] = useState<ConversationFilters>({
    statuses: [], dateFrom: null, dateTo: null, search: '',
  });

  const { data: sessions, isLoading } = useConversationSessions(operatorId, filters);
  useRealtimeConversations(operatorId);

  const isAdminOrManager = role === 'admin' || role === 'operations_manager';
  const canReply = isAdminOrManager || permissions.includes('customer_service');

  const selectedSession = sessions?.find((s) => s.id === selectedSessionId) ?? null;

  const handleSelect = useCallback((id: string) => selectSession(id), [selectSession]);

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <ConversationList
        sessions={sessions ?? []}
        isLoading={isLoading}
        selectedId={selectedSessionId}
        unreadIds={unreadSessionIds}
        onSelect={handleSelect}
        filters={filters}
        onFiltersChange={setFilters}
      />
      <div className="flex-1 bg-slate-950">
        {selectedSession ? (
          <ConversationThread session={selectedSession} canReply={canReply} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <MessageSquare className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">Selecciona una conversación</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={null}>
      <ConversationsContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Add nav item to AppLayout.tsx**

In `src/components/AppLayout.tsx`:

Add `MessageSquare` to the lucide-react import (line ~5):
```ts
import { ..., MessageSquare } from 'lucide-react';
```

Add to the `navItems` array (after the audit-logs entry, before `].filter`):
```ts
{ href: '/app/conversations', label: 'Conversaciones', icon: MessageSquare,
  show: isAdminOrManager || permissions.includes('customer_service') },
```

- [ ] **Step 3: Smoke test locally**

Run: `cd apps/frontend && npm run dev`
Navigate to `http://localhost:3000/app/conversations` — should see the two-column layout with empty session list and "Selecciona una conversación" placeholder.

- [ ] **Step 4: Commit**

```bash
git add src/app/app/conversations/page.tsx src/components/AppLayout.tsx
git commit -m "feat(conversations): add page and nav item (spec-31)"
```

---

### Task 17: Final Integration — run all tests

- [ ] **Step 1: Run all conversation tests**

Run: `cd apps/frontend && npx vitest run --reporter=verbose src/**/*onversation*.test.* src/lib/stores/conversationStore.test.ts`
Expected: All tests PASS.

- [ ] **Step 2: Run full test suite to check for regressions**

Run: `cd apps/frontend && npx vitest run`
Expected: No regressions.

- [ ] **Step 3: Final commit if any lint/type fixes needed**

```bash
git add -A && git commit -m "fix(conversations): lint and type fixes (spec-31)"
```
