# Story 3.8: Set Up TanStack Query Caching for Dashboard Performance

Status: done

## Dependencies

Depends on: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7 — all dashboard hooks must exist in `useDashboardMetrics.ts` before caching configuration is applied. Story 3.7 must be merged first.

## Story

As a business owner,
I want the dashboard to load quickly and not spam the API with redundant requests,
so that I have a smooth user experience even when switching between tabs.

## Acceptance Criteria

1. **AC1: QueryClient Configuration Enhancement** — The global `QueryClient` in `Providers.tsx` is updated with:
   - `retry: 3` with explicit exponential backoff (`retryDelay: (attempt) => [1000, 2000, 4000][attempt] ?? 4000`)
   - `refetchOnWindowFocus: true` (changed from current `false`)
   - `refetchOnReconnect: true` for offline recovery
   - Existing `staleTime: 30000` and `gcTime: 300000` unchanged

2. **AC2: Query Key Format** — Current flat query key format `['dashboard', operatorId, 'sla', startDate, endDate]` is retained. Prefix-based invalidation via `queryKey: ['dashboard']` works with flat format. Changing to object format (`{startDate, endDate}`) would require updating all 16 hooks + tests for no functional benefit. **Decision: keep flat format** (architecture spec's object format is aspirational, not required for correct invalidation).

3. **AC3: Skeleton Loaders** — All dashboard loading states use skeleton loaders (not spinners). Audit confirms existing components already comply (`HeroSLASkeleton`, `MetricsCardSkeleton`, `CustomerPerformanceTableSkeleton`). Verify no regressions.

4. **AC4: Error States with Cached Fallback** — Standardize the existing partial error handling into a consistent pattern across all dashboard components. Add `sonner` toast notifications on query errors. Ensure all components show last cached data with staleness indicator when errored. This AC fulfills the staleness indicator requirement deferred from Story 3.3.

5. **AC5: Optimistic Date Range Changes** — When user changes date range, old data displays immediately while new data loads via `placeholderData: keepPreviousData` (v5 API). Components show a subtle `opacity-60` overlay + small `Loader2` spinner icon when `isPlaceholderData` is true — do NOT use skeleton loaders for this state (skeletons hide data, which defeats the purpose).

6. **AC6: Query Invalidation Rules**:
   - Creating/updating orders invalidates dashboard queries (`queryKey: ['dashboard']`)
   - Export actions do NOT invalidate (read-only)
   - Background job completion invalidation and admin "Clear Cache" are out of scope for this story — they require Supabase Realtime integration (deferred to Epic 5, Story 5.9)

7. **AC7: DevTools Integration** — `@tanstack/react-query-devtools` installed as dev dependency. `ReactQueryDevtools` rendered in `Providers.tsx` (which is already a `'use client'` component) with `initialIsOpen={false}`, conditionally loaded in development only.

8. **AC8: Offline Resilience** — When network is offline, show last cached data with an "Offline" banner. Configure TanStack Query's `onlineManager` to pause queries when offline and resume on reconnect. Note: full Service Worker + IndexedDB offline persistence is deferred to Epic 4 (Pickup Verification PWA). For the dashboard, in-memory TanStack Query cache is sufficient — dashboard users are desktop/broadband, not warehouse crew on spotty mobile connections.

9. **AC9: Multi-Tab Cache Sharing** — Shared cache across browser tabs via `BroadcastChannel` API. All data passed through BroadcastChannel must be serialized via `JSON.stringify`/`JSON.parse` to avoid corrupting non-serializable types (Date objects, undefined values, Supabase response prototypes).

10. **AC10: Cache Size Management** — TanStack Query has no native size-based eviction (the epics spec's ">50MB" threshold cannot be directly implemented). Implementation: set `gcTime: 300000` (5min — already configured) to auto-prune inactive queries, and add a `queryCache` event listener that calls `queryClient.removeQueries()` for queries exceeding a configurable max count (default: 100 inactive queries). This is a pragmatic approximation of size-based eviction.

11. **AC11: Per-Resource Stale Time Tiers** — Configure differentiated stale times per architecture spec:
    - Dashboard metrics: 30s stale (already in `DASHBOARD_QUERY_OPTIONS`)
    - Customer lists (`useUsers`): 5min stale (already 60s — update to 300000)
    - Order details: 1min stale (60000)
    - Note: `useUsers` already has `staleTime: 60000` — evaluate whether increasing to 300000 per architecture spec is appropriate or if current 60s is intentional

12. **AC12: refetchInterval Update** — Change `DASHBOARD_QUERY_OPTIONS.refetchInterval` from 30000 (30s) to 60000 (60s) per architecture spec. Note: Story 3.2 AC specified "30s background refetch" — this change is an intentional architecture-level override. Architecture doc supersedes individual story ACs for infrastructure decisions.

## Tasks / Subtasks

- [ ] Task 1: Update QueryClient configuration (AC: #1, #11)
  - [ ] 1.1 Add retry with explicit backoff delays:
    ```typescript
    retry: 3,
    retryDelay: (attempt) => [1000, 2000, 4000][attempt] ?? 4000,
    ```
  - [ ] 1.2 Change `refetchOnWindowFocus` from `false` to `true`
  - [ ] 1.3 Add `refetchOnReconnect: true`
  - [ ] 1.4 Add `refetchOnWindowFocus: false` override to `useUsers` hook (60s stale data should not refetch on every tab switch)
  - [ ] 1.5 Audit other non-dashboard hooks (`useAuditLogs`) — `useAuditLogs` already has `refetchOnWindowFocus: true` so no change needed there

- [ ] Task 2: Update DASHBOARD_QUERY_OPTIONS (AC: #12, #5)
  - [ ] 2.1 Change `refetchInterval` from `30000` to `60000`
  - [ ] 2.2 Add `placeholderData: keepPreviousData` — requires explicit import:
    ```typescript
    import { useQuery, keepPreviousData } from '@tanstack/react-query';

    const DASHBOARD_QUERY_OPTIONS = {
      staleTime: 30000,
      refetchInterval: 60000,
      placeholderData: keepPreviousData,
    } as const;
    ```

- [ ] Task 3: Install and configure DevTools (AC: #7)
  - [ ] 3.1 Install `@tanstack/react-query-devtools` as dev dependency
  - [ ] 3.2 Add `ReactQueryDevtools` in `Providers.tsx` — this file already has `'use client'` directive:
    ```typescript
    import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
    // Inside return:
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} position="bottom" />
      )}
    </QueryClientProvider>
    ```

- [ ] Task 4: Standardize error states with cached fallback (AC: #4)
  - [ ] 4.1 Create reusable `DashboardErrorBanner` component with warning icon, "Los datos pueden estar desactualizados" text, and retry button that calls `queryClient.refetchQueries({ queryKey: ['dashboard'], type: 'active' })`
  - [ ] 4.2 **Do NOT delete existing inline error handling** — existing components already have partial implementations:
    - `MetricsCard.tsx`: has `isStale` prop with amber `⚠️` icon — keep this
    - `HeroSLA.tsx`: has Alert banner with stale warning — refactor to use `DashboardErrorBanner`
    - `FailedDeliveriesAnalysis.tsx`: has error banner + "Reintentar" button — refactor to use `DashboardErrorBanner`
    - `CustomerPerformanceTable.tsx`: has error banner + "Reintentar" button + stale text — refactor to use `DashboardErrorBanner`
    - `PrimaryMetricsGrid.tsx`: has stale icons but NO retry button — add retry via `DashboardErrorBanner`
    - `SecondaryMetricsGrid.tsx`: has stale icons but NO retry button — add retry via `DashboardErrorBanner`
  - [ ] 4.3 Add `sonner` toast notification on query error (the only genuinely missing piece)
  - [ ] 4.4 Ensure existing tests still pass — `SecondaryMetricsGrid.test.tsx` line 149 asserts stale indicator rendering

- [ ] Task 5: Implement `isPlaceholderData` visual feedback (AC: #5)
  - [ ] 5.1 In dashboard container components, when `isPlaceholderData` is true: apply `opacity-60` to data container and show small `Loader2` icon in top-right corner
  - [ ] 5.2 Do NOT show skeleton loaders for placeholder state — data must remain visible

- [ ] Task 6: Implement query invalidation on order mutations (AC: #6)
  - [ ] 6.1 In `useOrders.ts` `useCreateManualOrder` `onSuccess`, add `queryClient.invalidateQueries({ queryKey: ['dashboard'] })` alongside existing `['orders']` invalidation
  - [ ] 6.2 Verify export flows (Story 3.7's export modal) do NOT call invalidateQueries on dashboard keys

- [ ] Task 7: Add offline resilience (AC: #8)
  - [ ] 7.1 Create `OfflineBanner` component that renders when `navigator.onLine` is false (use `useSyncExternalStore` with `navigator.onLine` + `online`/`offline` window events)
  - [ ] 7.2 Configure TanStack Query's `onlineManager` to pause queries when offline and auto-resume on reconnect
  - [ ] 7.3 Add `OfflineBanner` to dashboard `page.tsx`

- [ ] Task 8: Implement multi-tab cache sharing (AC: #9)
  - [ ] 8.1 Create `apps/frontend/src/lib/queryBroadcast.ts`:
    - Open `BroadcastChannel('tanstack-query-sync')`
    - Subscribe to `queryClient.getQueryCache().subscribe()` for `updated` events
    - On update: `channel.postMessage(JSON.stringify({ queryKey, data }))`
    - On receive: `queryClient.setQueryData(JSON.parse(event.data).queryKey, JSON.parse(event.data).data)`
    - **All data must go through `JSON.stringify`/`JSON.parse`** — raw postMessage will corrupt Date objects and Supabase response prototypes
  - [ ] 8.2 Initialize in `Providers.tsx` with cleanup on unmount
  - [ ] 8.3 Handle `BroadcastChannel` not available (Safari private browsing) — graceful no-op

- [ ] Task 9: Implement cache size management (AC: #10)
  - [ ] 9.1 Add a `queryCache` subscriber in `Providers.tsx` that monitors inactive query count
  - [ ] 9.2 When inactive queries exceed 100, call `queryClient.removeQueries({ type: 'inactive', predicate: (query) => /* oldest first */ })`
  - [ ] 9.3 Keep the `gcTime: 300000` (5min) as the primary eviction mechanism

- [ ] Task 10: Audit skeleton loaders (AC: #3)
  - [ ] 10.1 Verify all dashboard components use skeleton loaders for `isLoading` state — confirmed already compliant
  - [ ] 10.2 Fix any non-compliant components if found

- [ ] Task 11: Write tests
  - [ ] 11.1 `Providers.test.tsx`: Test QueryClient config — retry: 3, retryDelay returns [1000, 2000, 4000], `refetchOnWindowFocus: true`, `staleTime: 30000`, `gcTime: 300000`
  - [ ] 11.2 `DashboardErrorBanner.test.tsx`: Integration test — pre-seed QueryClient cache with data, configure query to fail, verify component renders stale data AND error banner simultaneously, verify retry button calls `refetchQueries`
  - [ ] 11.3 Test `placeholderData` behavior — old data visible with `opacity-60` during refetch
  - [ ] 11.4 `OfflineBanner.test.tsx`: Test banner appears when offline, hidden when online
  - [ ] 11.5 Test order mutation invalidates `['dashboard']` queries
  - [ ] 11.6 Test DevTools only renders when `NODE_ENV === 'development'`
  - [ ] 11.7 `queryBroadcast.test.ts`: Mock `BroadcastChannel` (jsdom does not implement it — use `globalThis.BroadcastChannel = MockBroadcastChannel` in test setup), simulate cache update, verify receiving instance calls `setQueryData` with correct key and deserialized data
  - [ ] 11.8 Test `DASHBOARD_QUERY_OPTIONS.refetchInterval === 60000` and `staleTime === 30000` — regression test for the 30s → 60s change
  - [ ] 11.9 Test `useUsers` has `refetchOnWindowFocus: false` override

## Dev Notes

### Current State Analysis

- **`@tanstack/react-query` v5.90.21** — uses v5 API (`gcTime` not `cacheTime`, `keepPreviousData` is a function import not a boolean)
- **QueryClient** in `Providers.tsx`: `staleTime: 30000`, `gcTime: 300000`, `refetchOnWindowFocus: false`
- **`DASHBOARD_QUERY_OPTIONS`** in `useDashboardMetrics.ts`: `staleTime: 30000`, `refetchInterval: 30000` — spread into all 16 dashboard hooks
- **All hooks gated** by `enabled: !!operatorId`
- **Existing error handling** is partial — `MetricsCard` has `isStale` prop, `HeroSLA`/`FailedDeliveriesAnalysis`/`CustomerPerformanceTable` have inline error banners with retry, but `PrimaryMetricsGrid`/`SecondaryMetricsGrid` only have stale icons without retry. No `sonner` toast notifications on errors anywhere.

### What ALREADY Works (Do NOT Break)

- 16 dashboard hooks in `useDashboardMetrics.ts` all using `DASHBOARD_QUERY_OPTIONS` spread
- `useUsers` has its own `staleTime: 60000` and `refetchInterval: 300000` — add `refetchOnWindowFocus: false` override only
- `useAuditLogs` has `refetchOnWindowFocus: true` — aligns with new global default, no change needed
- `useCreateManualOrder` already invalidates `['orders']` — add `['dashboard']` alongside
- `createSPAClient()` is always called inside `queryFn`, never at module level — maintain this pattern
- `SecondaryMetricsGrid.test.tsx` asserts stale indicator rendering — do not break this test
- The `QueryClient` instance in `Providers.tsx` is created inside `useState(() => new QueryClient())` — this is correct. NEVER move it to a bare `const` inside the component body (causes re-creation on every render)

### Critical Code Patterns

**v5 `keepPreviousData` import (NOT a boolean like v4):**
```typescript
import { useQuery, keepPreviousData } from '@tanstack/react-query';

const DASHBOARD_QUERY_OPTIONS = {
  staleTime: 30000,
  refetchInterval: 60000,
  placeholderData: keepPreviousData,
} as const;
```

**Retry delay function (exact spec values):**
```typescript
retryDelay: (attempt: number) => [1000, 2000, 4000][attempt] ?? 4000,
```

**BroadcastChannel serialization (MANDATORY):**
```typescript
// SEND — always serialize
channel.postMessage(JSON.stringify({ queryKey, data }));

// RECEIVE — always deserialize
channel.onmessage = (event) => {
  const { queryKey, data } = JSON.parse(event.data);
  queryClient.setQueryData(queryKey, data);
};
```

### Architecture Constraints

- **Performance SLA**: Dashboard initial load ≤2 seconds on 10 Mbps
- **API p95**: ≤200ms for reads, ≤2s for BI aggregations
- **State management**: Zustand for local/UI state, TanStack Query for ALL server state — never duplicate with `useState`/`useEffect`
- **No raw Radix imports** — always use shadcn wrappers from `@/components/ui/`
- **Charts are recharts** v2.15.0, NOT Chart.js
- **Supabase client**: always `createSPAClient()` inside `queryFn`
- **Future Realtime integration** (Epic 5, Story 5.9) will call `queryClient.setQueryData` on Supabase channel events. The query key structure established here must remain compatible with that pattern.

### File Locations

Files to modify:
- `apps/frontend/src/components/Providers.tsx` — QueryClient config + DevTools + BroadcastChannel init
- `apps/frontend/src/hooks/useDashboardMetrics.ts` — `DASHBOARD_QUERY_OPTIONS` (refetchInterval 60s + placeholderData)
- `apps/frontend/src/hooks/useOrders.ts` — Add `['dashboard']` invalidation
- `apps/frontend/src/hooks/useUsers.ts` — Add `refetchOnWindowFocus: false` override
- `apps/frontend/src/app/app/dashboard/page.tsx` — Add OfflineBanner
- `apps/frontend/src/components/dashboard/HeroSLA.tsx` — Refactor to use DashboardErrorBanner
- `apps/frontend/src/components/dashboard/FailedDeliveriesAnalysis.tsx` — Refactor to use DashboardErrorBanner
- `apps/frontend/src/components/dashboard/CustomerPerformanceTable.tsx` — Refactor to use DashboardErrorBanner
- `apps/frontend/src/components/dashboard/PrimaryMetricsGrid.tsx` — Add retry via DashboardErrorBanner
- `apps/frontend/src/components/dashboard/SecondaryMetricsGrid.tsx` — Add retry via DashboardErrorBanner

Files to create:
- `apps/frontend/src/components/dashboard/DashboardErrorBanner.tsx`
- `apps/frontend/src/components/dashboard/DashboardErrorBanner.test.tsx`
- `apps/frontend/src/components/dashboard/OfflineBanner.tsx`
- `apps/frontend/src/components/dashboard/OfflineBanner.test.tsx`
- `apps/frontend/src/components/Providers.test.tsx`
- `apps/frontend/src/lib/queryBroadcast.ts`
- `apps/frontend/src/lib/queryBroadcast.test.ts`

Files to NOT modify:
- `MetricsCard.tsx`, `MetricsCardSkeleton.tsx` — keep existing `isStale` prop as-is
- `useAuditLogs.ts` — already has correct config
- Any Supabase/database files or n8n workflow files

### Project Structure Notes

- All dashboard hooks live in `useDashboardMetrics.ts` — extend, do NOT create new hook files
- New dashboard components go in `apps/frontend/src/components/dashboard/`
- Utility files go in `apps/frontend/src/lib/` (confirmed: `lib/supabase/client.ts` and `lib/utils/ipAddress.ts` already exist there)
- Tests are co-located with components (`.test.tsx` alongside `.tsx`)

### Previous Story Learnings (from 3.6)

- Always call `createSPAClient()` inside `queryFn`, never at module level
- Use `MetricsCardSkeleton` for loading states, not spinners
- Guard against `undefined` vs `null` — `data === undefined` means query is disabled, `null` means no data
- When extracting shared helpers, ensure computed values are exposed from hook data to prevent component/hook divergence
- Suppress trend indicators when change is exactly 0%

### Testing Notes

- jsdom does NOT implement `BroadcastChannel` — mock it in test setup: `globalThis.BroadcastChannel = MockBroadcastChannel`
- Integration tests for error+stale state: pre-seed `QueryClient` cache with data, configure query to fail after one attempt, verify both stale data and error banner render simultaneously
- `isPlaceholderData` tests: verify `opacity-60` class applied and `Loader2` icon visible, NOT skeleton

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.8 — Lines 1331-1354]
- [Source: _bmad-output/planning-artifacts/architecture.md#TanStack Query — Lines 798-816]
- [Source: _bmad-output/planning-artifacts/architecture.md#Caching Strategy — Lines 873-899]
- [Source: _bmad-output/planning-artifacts/architecture.md#Performance NFRs — NFR-P1 to NFR-P5]
- [Source: apps/frontend/src/components/Providers.tsx — QueryClient config]
- [Source: apps/frontend/src/hooks/useDashboardMetrics.ts — DASHBOARD_QUERY_OPTIONS, 16 hooks]
- [Source: apps/frontend/src/hooks/useOrders.ts — Mutation invalidation]
- [Source: apps/frontend/src/hooks/useUsers.ts — staleTime 60s, refetchInterval 5min]
- [Source: apps/frontend/src/components/dashboard/MetricsCard.tsx — isStale prop]
- [Source: apps/frontend/package.json — @tanstack/react-query ^5.90.21]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
