# Spec 34 — Delete Route Button + Docks Panel Fix

**Status:** completed

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Andenes (docks) panel to show orders instead of routes, and add a delete button for draft/planned routes.

**Architecture:** Two independent changes: (1) one-line filter fix in `useStageBreakdown.ts`, (2) new DELETE API endpoint + UI buttons on `RouteListTile` and `RoutePanel` with AlertDialog confirmation. Soft-delete only (set `deleted_at`). Reset associated packages to `asignado`.

**Tech Stack:** Next.js App Router, Supabase, React Query, shadcn AlertDialog, Lucide icons

---

## Chunk 1: Docks Panel Fix + Delete Route API + UI

### Task 1: Fix Docks Panel to show orders instead of routes

Already done in current branch — `useStageBreakdown.ts` line 49 changed from `snapshot.routes` to `snapshot.orders`.

**Files:**
- Modified: `apps/frontend/src/hooks/ops-control/useStageBreakdown.ts:49`

- [x] **Step 1: Fix filter** — Change `snapshot.routes` to `snapshot.orders` in the `docks` case.

---

### Task 2: Create DELETE /api/dispatch/routes/[id] endpoint

**Files:**
- Create: `apps/frontend/src/app/api/dispatch/routes/[id]/route.ts`

- [ ] **Step 1: Create the API route handler**

```typescript
import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const { id: routeId } = await params;

    // Fetch route — verify ownership and status
    const { data: route } = await supabase
      .from('routes')
      .select('id, status')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();

    if (!route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    if (route.status !== 'draft' && route.status !== 'planned') {
      return NextResponse.json(
        { code: 'ALREADY_DISPATCHED', message: 'Solo se pueden eliminar rutas en borrador o planificadas.' },
        { status: 403 },
      );
    }

    // 1. Get dispatches for this route to find affected orders
    const { data: dispatches } = await supabase
      .from('dispatches')
      .select('id, order_id')
      .eq('route_id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null);

    // 2. Soft-delete dispatches
    if (dispatches && dispatches.length > 0) {
      const dispatchIds = dispatches.map((d) => d.id);
      await supabase
        .from('dispatches')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', dispatchIds)
        .eq('operator_id', operatorId);

      // 3. Reset packages back to 'asignado'
      const orderIds = dispatches.map((d) => d.order_id).filter(Boolean);
      if (orderIds.length > 0) {
        await supabase
          .from('packages')
          .update({ status: 'asignado' })
          .in('order_id', orderIds)
          .eq('operator_id', operatorId)
          .eq('status', 'en_carga');
      }
    }

    // 4. Soft-delete the route
    const { error: delError } = await supabase
      .from('routes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', routeId)
      .eq('operator_id', operatorId);

    if (delError) throw delError;

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[dispatch/routes DELETE]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/api/dispatch/routes/\[id\]/route.ts
git commit -m "feat(dispatch): add DELETE /api/dispatch/routes/[id] endpoint — soft-delete draft/planned routes"
```

---

### Task 3: Add delete button to RouteListTile

**Files:**
- Modify: `apps/frontend/src/components/dispatch/RouteListTile.tsx`
- Modify: `apps/frontend/src/app/app/dispatch/page.tsx`

- [ ] **Step 1: Add `onDelete` prop and trash icon to `RouteListTile`**

Add a `Trash2` icon button that appears only for `draft`/`planned` routes. Wrap in an `AlertDialog` for confirmation. The button uses `e.stopPropagation()` to prevent navigating into the route.

Props change: add `onDelete?: () => void` to the `Props` interface.

- [ ] **Step 2: Wire up `onDelete` in `DispatchPage`**

In `dispatch/page.tsx`, add a `handleDeleteRoute` function that calls `DELETE /api/dispatch/routes/{id}`, then invalidates the dispatch queries. Pass it to each `RouteListTile` in the "Abiertas" tab.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/dispatch/RouteListTile.tsx apps/frontend/src/app/app/dispatch/page.tsx
git commit -m "feat(dispatch): add delete button to RouteListTile for draft/planned routes"
```

---

### Task 4: Add delete button to RoutePanel (detail view)

**Files:**
- Modify: `apps/frontend/src/components/dispatch/RoutePanel.tsx`
- Modify: `apps/frontend/src/components/dispatch/RouteBuilder.tsx`

- [ ] **Step 1: Add `onDelete` prop and "Eliminar Ruta" button to `RoutePanel`**

Add a destructive-variant button with AlertDialog confirmation below the existing action buttons. Only render when `canDelete` prop is true.

Props change: add `canDelete?: boolean` and `onDelete?: () => void`.

- [ ] **Step 2: Wire up `handleDelete` in `RouteBuilder`**

Add `handleDelete` that calls `DELETE /api/dispatch/routes/{routeId}`, then navigates to `/app/dispatch`. Pass `canDelete={!routeClosed}` and `onDelete={handleDelete}` to `RoutePanel`.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/dispatch/RoutePanel.tsx apps/frontend/src/components/dispatch/RouteBuilder.tsx
git commit -m "feat(dispatch): add delete button to RoutePanel for draft/planned routes"
```

---

### Task 5: Final commit — docks panel fix + all changes

- [ ] **Step 1: Commit the docks panel fix together with any remaining changes**

```bash
git add apps/frontend/src/hooks/ops-control/useStageBreakdown.ts
git commit -m "fix(ops-control): docks panel shows orders (en_carga/listo) instead of routes"
```

- [ ] **Step 2: Push and create PR**

```bash
git push origin fix/remove-operator-id-from-user-form
gh pr create --title "fix(ops-control): docks panel + delete route button" --body "..."
gh pr merge --auto --squash
```
