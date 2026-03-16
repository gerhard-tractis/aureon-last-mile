# Pickup Scanning Improvements — Design Spec

**Date:** 2026-03-15
**Status:** in progress
**Epic:** 4A — Pickup Verification
**Scope:** Two improvements to the pickup scanning screen

---

## 1. Problem

The scanning page (`/app/pickup/scan/[loadId]`) has two usability gaps:

1. **No back navigation.** Once a user taps a manifest, the only way back to manifest selection is the browser back button.
2. **No manifest detail view.** The operator sees scan counts but cannot see the actual orders and packages in the load. They need this for visual cross-checking and for manually verifying packages that cannot be scanned (damaged label, etc.).

## 2. Requirements

### 2.1 Back Arrow
- Add a back arrow icon to the scanning page header, left of the title.
- Navigates to `/app/pickup` (manifest selection).
- No confirmation dialog — all scan data is persisted to DB on each scan, so nothing is lost.

### 2.2 Orders & Packages Detail List
- Display below the "Recent Scans" card on the scanning page.
- Orders grouped as collapsible accordion cards.
- Each order shows: order number, customer name, comuna, delivery address, package progress badge.
- Each package row shows: label, package number, SKU summary, declared weight, scan status, and a "Mark Verified" button for unverified packages.

### 2.3 Manual Verification
- "Mark Verified" button on unverified packages triggers the existing `useScanMutation` with the package label as barcode.
- The existing `validateScan` logic matches the label, creates a proper `pickup_scans` record.
- After verification, the button disappears and a checkmark shows.
- Query invalidation updates all counts (progress bar, verified/not-found stats).

## 3. Design

### 3.1 Back Arrow

Current header:
```
Scanning: CARGA-00123          clock 03:45
```

New header:
```
[<-]  Scanning: CARGA-00123    clock 03:45
```

- `ArrowLeft` lucide icon button.
- `router.push('/app/pickup')` on click.
- Inline change to `scan/[loadId]/page.tsx`.

### 3.2 Manifest Detail List — UI Structure

```
Orders & Packages                    12/18 verified
─────────────────────────────────────────────────────
[v] ORD-12345 — Juan Perez, Providencia    2/3 verified
    ┌─────────────────────────────────────────────┐
    │ CTN001  |  1 of 3  |  2 SKUs  |  1.5kg  [x]│
    │ CTN002  |  2 of 3  |  1 SKU   |  0.8kg  [ ]│  [Mark Verified]
    │ CTN003  |  3 of 3  |  1 SKU   |  2.1kg  [x]│
    └─────────────────────────────────────────────┘
[>] ORD-67890 — Maria Lopez, Las Condes     0/1 verified
```

**Badge colors:**
- Green: all packages verified
- Yellow: partially verified
- Gray: none verified

### 3.3 Data Flow

1. Scanning page loads existing queries (manifest metadata + scans).
2. New `useManifestOrders` hook fetches orders + packages using Supabase embedded relations:
   ```ts
   supabase
     .from('orders')
     .select('*, packages(*)')
     .eq('operator_id', operatorId)
     .eq('external_load_id', loadId)
     .is('deleted_at', null)
   ```
   The `packages(*)` syntax uses PostgREST's foreign-key detection (`packages.order_id → orders.id`). Packages are also filtered with `.is('deleted_at', null)` via a nested filter modifier. This follows the project convention of explicit `operator_id` + `deleted_at` filtering on every query (defense-in-depth on top of RLS).
3. Verified status derived client-side by cross-referencing the already-loaded `scans` array — a package is verified if any scan with `scan_result = 'verified'` references its `package_id`. **Important:** verification is checked by `package_id`, not by `barcode_scanned`, to avoid double-counting when a package was verified via order-number scan (where `barcode_scanned` is the order number, not the package label).
4. "Mark Verified" calls `scanMutation.mutate({ barcode: packageLabel, manifestId, operatorId, externalLoadId, userId })` (where `scanMutation` is the return value of `useScanMutation()`). The existing `validateScan` matches the label and creates a scan record. Query invalidation updates everything.

### 3.4 Manual Verification — No Schema Changes

Manual verification reuses the existing scan pipeline entirely:
- `validateScan` matches the package label (step 2 in its logic).
- A `pickup_scans` row is created with `scan_result = 'verified'`.
- No new columns, no new tables, no migration needed.
- Manual vs scanned is not distinguished at the DB level (both are verified scans). This is intentional — the discrepancy review and completion screens treat all verified packages the same.

### 3.5 Duplicate/Double-Count Prevention

The existing `validateScan` checks duplicates by `barcode_scanned`. This means a package verified via order-number scan (where `barcode_scanned` = order number) would not be caught as a duplicate if manually verified by label. To prevent double-counting:
- The `verifiedCount` in the scanning page must count **unique verified package_ids**, not total scan records. Update: `scans.filter(s => s.scan_result === 'verified')` → deduplicate by `package_id` before counting.
- The manifest detail list derives verified status by `package_id` (Section 3.3 point 3), so it is already correct.
- The `validateScan` function should add a `package_id`-based duplicate check before creating a new scan. This is a small addition to the existing function: after the barcode-based duplicate check, also check if any verified scan exists for the matched `package_id`.

### 3.6 Props Threading

The scanning page owns `manifestId`, `operatorId`, `externalLoadId`, `userId`, and `scanMutation`. These are passed to `ManifestDetailList` as props, which passes the verify callback down:
- `ManifestDetailList` receives: `orders`, `scans`, `onManualVerify(packageLabel: string)`
- `OrderCard` receives: `order`, `scans` (filtered to this order's packages), `onManualVerify`
- `PackageRow` receives: `package`, `isVerified`, `onManualVerify`

The `onManualVerify` callback is created at the page level, wrapping `scanMutation.mutate`. This avoids prop-drilling raw mutation/state — components only know about a simple callback.

## 4. File Plan

All files under 300 lines.

| File | Type | Purpose |
|------|------|---------|
| `src/hooks/pickup/useManifestOrders.ts` | New | Fetch orders + packages for a load ID |
| `src/components/pickup/ManifestDetailList.tsx` | New | Accordion container with summary badge |
| `src/components/pickup/OrderCard.tsx` | New | Collapsible order header with progress |
| `src/components/pickup/PackageRow.tsx` | New | Package info + verify button |
| `src/lib/pickup/scan-validator.ts` | Edit | Add `package_id`-based duplicate check (Section 3.5) |
| `src/app/app/pickup/scan/[loadId]/page.tsx` | Edit | Add back arrow, `<ManifestDetailList>`, fix `verifiedCount` to deduplicate by `package_id` (Section 3.5) |

## 5. Testing Plan

| Test file | What it covers |
|-----------|----------------|
| `useManifestOrders.test.ts` | Fetches and structures orders + packages; handles empty state |
| `ManifestDetailList.test.tsx` | Renders orders; summary badge shows correct counts |
| `OrderCard.test.tsx` | Expand/collapse; badge color logic (green/yellow/gray) |
| `PackageRow.test.tsx` | Displays package info; verify button calls mutation; button hidden after verification |
| `scan/[loadId]/page.test.tsx` | Back arrow navigates to `/app/pickup`; ManifestDetailList renders |

## 6. Loading & Error States

- **Loading:** Show skeleton cards (same pattern as manifest selection page) while `useManifestOrders` is loading.
- **Error:** Show a subtle error banner: "Failed to load manifest details" with a retry button.
- **0 orders for load:** Show "No orders found for this load" — possible if manifest was created before order ingestion completed.

## 7. Edge Cases

- **Order with 0 packages:** Render order card with "No packages" empty state.
- **All packages verified:** Green badge, no verify buttons shown.
- **Manual verify on already-verified package:** `validateScan` checks `package_id` duplicate (Section 3.5), returns `duplicate`, plays duplicate feedback, no double-counting.
- **Order-number scan while detail list is open:** Query invalidation updates package checkmarks in real time.
- **Package verified via order-number scan then manual verify by label:** Prevented by `package_id`-based duplicate check in `validateScan` (Section 3.5).

## 8. Out of Scope

- Distinguishing manual vs scanner verification in the DB.
- Filtering or searching within the manifest detail list.
- Reordering orders or packages.
- Any changes to the discrepancy review or completion screens.

---

# Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add back navigation and a manifest detail list with manual verification to the pickup scanning page.

**Architecture:** New `useManifestOrders` hook fetches orders+packages via Supabase embedded relations. Three new presentational components (`ManifestDetailList`, `OrderCard`, `PackageRow`) render the accordion. Manual verification reuses existing `useScanMutation`. A small edit to `validateScan` adds `package_id`-based duplicate prevention.

**Tech Stack:** Next.js 15, React, TanStack Query, Supabase JS, Vitest, Testing Library, lucide-react

---

## Chunk 1: Foundation (scan-validator fix + hook)

### Task 1: Add package_id duplicate check to validateScan

**Files:**
- Modify: `apps/frontend/src/lib/pickup/scan-validator.ts`
- Modify: `apps/frontend/src/lib/pickup/scan-validator.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/lib/pickup/scan-validator.test.ts`:

```ts
it('returns duplicate when package_id already verified (different barcode)', async () => {
  // First call: barcode duplicate check → no match (different barcode was used)
  // Second call: package label match → finds package
  // Third call: order match → confirms order belongs to load
  // But we need to simulate that a verified scan already exists for this package_id
  // The new package_id duplicate check should catch this
  queryResponses = {
    pickup_scans: [],  // No barcode duplicate
    packages: [{ id: 'pkg-1', label: 'CTN001', order_id: 'order-1' }],
    orders: [{ id: 'order-1' }],
  };

  // Override the module-level mock to return different data per pickup_scans call:
  // First call (barcode check) → empty, second call (package_id check) → found
  let pickupScansCallCount = 0;
  const origQueryResponses = { ...queryResponses };
  queryResponses = new Proxy({} as Record<string, unknown[]>, {
    get(_target, table: string) {
      if (table === 'pickup_scans') {
        pickupScansCallCount++;
        return pickupScansCallCount === 1 ? [] : [{ id: 'scan-1' }];
      }
      return origQueryResponses[table] ?? [];
    },
  }) as Record<string, unknown[]>;

  const result = await validateScan('CTN001', 'manifest-1', 'op-1', 'LOAD-1');
  expect(result.scanResult).toBe('duplicate');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/lib/pickup/scan-validator.test.ts --reporter=verbose`
Expected: FAIL — the new test expects `duplicate` but gets `verified` because the `package_id` check doesn't exist yet.

- [ ] **Step 3: Implement the package_id duplicate check**

In `apps/frontend/src/lib/pickup/scan-validator.ts`, after a successful package match (after the order verification at line 54), add a `package_id` duplicate check before returning `verified`:

```ts
// After line 53 (if orderMatch && orderMatch.length > 0):
// 2b. Check if this package_id already has a verified scan
const { data: pkgDuplicate } = await supabase
  .from('pickup_scans')
  .select('id')
  .eq('manifest_id', manifestId)
  .eq('package_id', packageMatch[0].id)
  .eq('scan_result', 'verified')
  .is('deleted_at', null)
  .limit(1);

if (pkgDuplicate && pkgDuplicate.length > 0) {
  return { scanResult: 'duplicate', packageId: packageMatch[0].id, packageIds: [], packageLabel: packageMatch[0].label };
}
```

Similarly, after the order-number scan match (after line 82 where packages are fetched), add a check for any already-verified packages in that order:

```ts
// After fetching orderPackages, filter out already-verified ones
const unverifiedPkgs: typeof pkgs = [];
for (const pkg of pkgs) {
  const { data: existingScan } = await supabase
    .from('pickup_scans')
    .select('id')
    .eq('manifest_id', manifestId)
    .eq('package_id', pkg.id)
    .eq('scan_result', 'verified')
    .is('deleted_at', null)
    .limit(1);
  if (!existingScan || existingScan.length === 0) {
    unverifiedPkgs.push(pkg);
  }
}

if (unverifiedPkgs.length === 0) {
  return { scanResult: 'duplicate', packageId: pkgs[0]?.id ?? null, packageIds: [], packageLabel: pkgs[0]?.label ?? barcode };
}

return {
  scanResult: 'verified',
  packageId: unverifiedPkgs[0]?.id ?? null,
  packageIds: unverifiedPkgs.map(p => p.id),
  packageLabel: unverifiedPkgs[0]?.label ?? barcode,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/lib/pickup/scan-validator.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/pickup/scan-validator.ts apps/frontend/src/lib/pickup/scan-validator.test.ts
git commit -m "fix: add package_id duplicate check to validateScan to prevent double-counting"
```

---

### Task 2: Create useManifestOrders hook

**Files:**
- Create: `apps/frontend/src/hooks/pickup/useManifestOrders.ts`
- Create: `apps/frontend/src/hooks/pickup/useManifestOrders.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/hooks/pickup/useManifestOrders.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useManifestOrders } from './useManifestOrders';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: mockFrom,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function mockChain(data: unknown[], error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

describe('useManifestOrders', () => {
  it('does not fetch when operatorId is null', () => {
    renderHook(() => useManifestOrders('LOAD-1', null), { wrapper: createWrapper() });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not fetch when loadId is null', () => {
    renderHook(() => useManifestOrders(null, 'op-1'), { wrapper: createWrapper() });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('fetches orders with embedded packages', async () => {
    const mockData = [
      {
        id: 'order-1',
        order_number: 'ORD-001',
        customer_name: 'Juan Perez',
        comuna: 'Providencia',
        delivery_address: 'Av. Providencia 123',
        packages: [
          { id: 'pkg-1', label: 'CTN001', package_number: '1 of 2', sku_items: [{ sku: 'SKU1', description: 'Widget', quantity: 1 }], declared_weight_kg: 1.5 },
          { id: 'pkg-2', label: 'CTN002', package_number: '2 of 2', sku_items: [], declared_weight_kg: null },
        ],
      },
    ];
    mockFrom.mockReturnValue(mockChain(mockData));

    const { result } = renderHook(() => useManifestOrders('LOAD-1', 'op-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockFrom).toHaveBeenCalledWith('orders');
  });

  it('returns empty array when no orders found', async () => {
    mockFrom.mockReturnValue(mockChain([]));

    const { result } = renderHook(() => useManifestOrders('LOAD-1', 'op-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('handles errors', async () => {
    mockFrom.mockReturnValue(mockChain(null, { message: 'fail' }));

    const { result } = renderHook(() => useManifestOrders('LOAD-1', 'op-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/hooks/pickup/useManifestOrders.test.ts --reporter=verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement useManifestOrders**

Create `apps/frontend/src/hooks/pickup/useManifestOrders.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ManifestPackage {
  id: string;
  label: string;
  package_number: string | null;
  sku_items: Array<{ sku: string; description: string; quantity: number }>;
  declared_weight_kg: number | null;
}

export interface ManifestOrder {
  id: string;
  order_number: string;
  customer_name: string;
  comuna: string;
  delivery_address: string;
  packages: ManifestPackage[];
}

export function useManifestOrders(
  externalLoadId: string | null,
  operatorId: string | null
) {
  return useQuery({
    queryKey: ['pickup', 'manifest-orders', externalLoadId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, customer_name, comuna, delivery_address, packages(id, label, package_number, sku_items, declared_weight_kg, deleted_at)')
        .eq('operator_id', operatorId!)
        .eq('external_load_id', externalLoadId!)
        .is('deleted_at', null)
        .order('order_number', { ascending: true });
      if (error) throw error;
      // Filter out soft-deleted packages client-side
      // (PostgREST nested filters don't support .is on embedded resources in all versions)
      const orders = (data as ManifestOrder[]).map(order => ({
        ...order,
        packages: (order.packages ?? []).filter((p: ManifestPackage & { deleted_at?: string | null }) => !p.deleted_at),
      }));
      return orders;
    },
    enabled: !!externalLoadId && !!operatorId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/hooks/pickup/useManifestOrders.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/pickup/useManifestOrders.ts apps/frontend/src/hooks/pickup/useManifestOrders.test.ts
git commit -m "feat: add useManifestOrders hook to fetch orders+packages for a load"
```

---

## Chunk 2: UI Components

### Task 3: Create PackageRow component

**Files:**
- Create: `apps/frontend/src/components/pickup/PackageRow.tsx`
- Create: `apps/frontend/src/components/pickup/PackageRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/pickup/PackageRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PackageRow } from './PackageRow';

describe('PackageRow', () => {
  const defaultProps = {
    pkg: {
      id: 'pkg-1',
      label: 'CTN001',
      package_number: '1 of 3',
      sku_items: [{ sku: 'SKU1', description: 'Widget', quantity: 2 }],
      declared_weight_kg: 1.5,
    },
    isVerified: false,
    onManualVerify: vi.fn(),
  };

  it('renders package label', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByText('CTN001')).toBeInTheDocument();
  });

  it('renders package number', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('renders SKU count', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByText(/1 SKU/)).toBeInTheDocument();
  });

  it('renders declared weight', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByText(/1.5\s*kg/)).toBeInTheDocument();
  });

  it('shows Mark Verified button when not verified', () => {
    render(<PackageRow {...defaultProps} />);
    expect(screen.getByRole('button', { name: /mark verified/i })).toBeInTheDocument();
  });

  it('calls onManualVerify with label when button clicked', () => {
    const onManualVerify = vi.fn();
    render(<PackageRow {...defaultProps} onManualVerify={onManualVerify} />);
    fireEvent.click(screen.getByRole('button', { name: /mark verified/i }));
    expect(onManualVerify).toHaveBeenCalledWith('CTN001');
  });

  it('shows checkmark and hides button when verified', () => {
    render(<PackageRow {...defaultProps} isVerified={true} />);
    expect(screen.queryByRole('button', { name: /mark verified/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('verified-icon')).toBeInTheDocument();
  });

  it('handles null package_number', () => {
    render(<PackageRow {...defaultProps} pkg={{ ...defaultProps.pkg, package_number: null }} />);
    expect(screen.queryByText('1 of 3')).not.toBeInTheDocument();
  });

  it('handles null weight', () => {
    render(<PackageRow {...defaultProps} pkg={{ ...defaultProps.pkg, declared_weight_kg: null }} />);
    expect(screen.queryByText(/kg/)).not.toBeInTheDocument();
  });

  it('handles empty SKU items', () => {
    render(<PackageRow {...defaultProps} pkg={{ ...defaultProps.pkg, sku_items: [] }} />);
    expect(screen.getByText(/0 SKUs/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/pickup/PackageRow.test.tsx --reporter=verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement PackageRow**

Create `apps/frontend/src/components/pickup/PackageRow.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';
import type { ManifestPackage } from '@/hooks/pickup/useManifestOrders';

interface PackageRowProps {
  pkg: ManifestPackage;
  isVerified: boolean;
  onManualVerify: (label: string) => void;
}

export function PackageRow({ pkg, isVerified, onManualVerify }: PackageRowProps) {
  const skuCount = pkg.sku_items.length;

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-md text-sm">
      <span className="font-mono font-medium flex-shrink-0">{pkg.label}</span>

      {pkg.package_number && (
        <span className="text-gray-500 flex-shrink-0">{pkg.package_number}</span>
      )}

      <span className="text-gray-500">
        {skuCount} {skuCount === 1 ? 'SKU' : 'SKUs'}
      </span>

      {pkg.declared_weight_kg != null && (
        <span className="text-gray-500">{pkg.declared_weight_kg} kg</span>
      )}

      <div className="ml-auto flex-shrink-0">
        {isVerified ? (
          <CheckCircle className="h-5 w-5 text-green-500" data-testid="verified-icon" />
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onManualVerify(pkg.label)}
            aria-label="Mark verified"
          >
            Mark Verified
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/pickup/PackageRow.test.tsx --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/pickup/PackageRow.tsx apps/frontend/src/components/pickup/PackageRow.test.tsx
git commit -m "feat: add PackageRow component with manual verification button"
```

---

### Task 4: Create OrderCard component

**Files:**
- Create: `apps/frontend/src/components/pickup/OrderCard.tsx`
- Create: `apps/frontend/src/components/pickup/OrderCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/pickup/OrderCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderCard } from './OrderCard';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';

describe('OrderCard', () => {
  const mockOrder = {
    id: 'order-1',
    order_number: 'ORD-001',
    customer_name: 'Juan Perez',
    comuna: 'Providencia',
    delivery_address: 'Av. Providencia 123',
    packages: [
      { id: 'pkg-1', label: 'CTN001', package_number: '1 of 2', sku_items: [], declared_weight_kg: 1.5 },
      { id: 'pkg-2', label: 'CTN002', package_number: '2 of 2', sku_items: [], declared_weight_kg: null },
    ],
  };

  const scansWithOneVerified: ScanRecord[] = [
    { id: 's1', barcode_scanned: 'CTN001', scan_result: 'verified', scanned_at: '2026-03-15T10:00:00Z', package_id: 'pkg-1' },
  ];

  const defaultProps = {
    order: mockOrder,
    scans: scansWithOneVerified,
    onManualVerify: vi.fn(),
  };

  it('renders order number and customer name', () => {
    render(<OrderCard {...defaultProps} />);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText(/Juan Perez/)).toBeInTheDocument();
  });

  it('renders comuna', () => {
    render(<OrderCard {...defaultProps} />);
    expect(screen.getByText(/Providencia/)).toBeInTheDocument();
  });

  it('shows verified count badge', () => {
    render(<OrderCard {...defaultProps} />);
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('starts collapsed — packages not visible', () => {
    render(<OrderCard {...defaultProps} />);
    expect(screen.queryByText('CTN001')).not.toBeInTheDocument();
  });

  it('expands on click — shows packages', () => {
    render(<OrderCard {...defaultProps} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('CTN001')).toBeInTheDocument();
    expect(screen.getByText('CTN002')).toBeInTheDocument();
  });

  it('collapses on second click', () => {
    render(<OrderCard {...defaultProps} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('CTN001')).not.toBeInTheDocument();
  });

  it('shows green badge when all packages verified', () => {
    const allScans: ScanRecord[] = [
      { id: 's1', barcode_scanned: 'CTN001', scan_result: 'verified', scanned_at: '2026-03-15T10:00:00Z', package_id: 'pkg-1' },
      { id: 's2', barcode_scanned: 'CTN002', scan_result: 'verified', scanned_at: '2026-03-15T10:01:00Z', package_id: 'pkg-2' },
    ];
    render(<OrderCard {...defaultProps} scans={allScans} />);
    expect(screen.getByTestId('badge').className).toContain('green');
  });

  it('shows yellow badge when partially verified', () => {
    render(<OrderCard {...defaultProps} />);
    expect(screen.getByTestId('badge').className).toContain('yellow');
  });

  it('shows gray badge when none verified', () => {
    render(<OrderCard {...defaultProps} scans={[]} />);
    expect(screen.getByTestId('badge').className).toContain('gray');
  });

  it('shows empty state for order with 0 packages', () => {
    render(<OrderCard {...defaultProps} order={{ ...mockOrder, packages: [] }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/No packages/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/pickup/OrderCard.test.tsx --reporter=verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement OrderCard**

Create `apps/frontend/src/components/pickup/OrderCard.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { PackageRow } from './PackageRow';
import type { ManifestOrder } from '@/hooks/pickup/useManifestOrders';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';

interface OrderCardProps {
  order: ManifestOrder;
  scans: ScanRecord[];
  onManualVerify: (label: string) => void;
}

function getBadgeColor(verified: number, total: number): string {
  if (total === 0) return 'gray';
  if (verified === total) return 'green';
  if (verified > 0) return 'yellow';
  return 'gray';
}

const BADGE_CLASSES: Record<string, string> = {
  green: 'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  gray: 'bg-gray-100 text-gray-600',
};

export function OrderCard({ order, scans, onManualVerify }: OrderCardProps) {
  const [expanded, setExpanded] = useState(false);

  const verifiedPackageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const scan of scans) {
      if (scan.scan_result === 'verified' && scan.package_id) {
        ids.add(scan.package_id);
      }
    }
    return ids;
  }, [scans]);

  const orderPackageIds = new Set(order.packages.map(p => p.id));
  const verifiedCount = [...verifiedPackageIds].filter(id => orderPackageIds.has(id)).length;
  const totalCount = order.packages.length;
  const badgeColor = getBadgeColor(verifiedCount, totalCount);

  return (
    <Card>
      <div
        className="flex items-center gap-3 p-3 cursor-pointer select-none"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded); }}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-gray-900 truncate">{order.order_number}</p>
          <p className="text-xs text-gray-500 truncate">
            {order.customer_name}, {order.comuna}
          </p>
        </div>

        <span
          data-testid="badge"
          className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${BADGE_CLASSES[badgeColor]}`}
        >
          {verifiedCount}/{totalCount}
        </span>
      </div>

      {expanded && (
        <CardContent className="pt-0 pb-3 px-3 space-y-1">
          <p className="text-xs text-gray-400 mb-2 truncate">{order.delivery_address}</p>
          {order.packages.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-2">No packages</p>
          ) : (
            order.packages.map(pkg => (
              <PackageRow
                key={pkg.id}
                pkg={pkg}
                isVerified={verifiedPackageIds.has(pkg.id)}
                onManualVerify={onManualVerify}
              />
            ))
          )}
        </CardContent>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/pickup/OrderCard.test.tsx --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/pickup/OrderCard.tsx apps/frontend/src/components/pickup/OrderCard.test.tsx
git commit -m "feat: add OrderCard component with expand/collapse and verified badge"
```

---

### Task 5: Create ManifestDetailList component

**Files:**
- Create: `apps/frontend/src/components/pickup/ManifestDetailList.tsx`
- Create: `apps/frontend/src/components/pickup/ManifestDetailList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/pickup/ManifestDetailList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ManifestDetailList } from './ManifestDetailList';
import type { ManifestOrder } from '@/hooks/pickup/useManifestOrders';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';

describe('ManifestDetailList', () => {
  const mockOrders: ManifestOrder[] = [
    {
      id: 'order-1',
      order_number: 'ORD-001',
      customer_name: 'Juan Perez',
      comuna: 'Providencia',
      delivery_address: 'Av. Providencia 123',
      packages: [
        { id: 'pkg-1', label: 'CTN001', package_number: null, sku_items: [], declared_weight_kg: null },
        { id: 'pkg-2', label: 'CTN002', package_number: null, sku_items: [], declared_weight_kg: null },
      ],
    },
    {
      id: 'order-2',
      order_number: 'ORD-002',
      customer_name: 'Maria Lopez',
      comuna: 'Las Condes',
      delivery_address: 'Av. Las Condes 456',
      packages: [
        { id: 'pkg-3', label: 'CTN003', package_number: null, sku_items: [], declared_weight_kg: null },
      ],
    },
  ];

  const scans: ScanRecord[] = [
    { id: 's1', barcode_scanned: 'CTN001', scan_result: 'verified', scanned_at: '2026-03-15T10:00:00Z', package_id: 'pkg-1' },
  ];

  const defaultProps = {
    orders: mockOrders,
    scans: scans,
    onManualVerify: vi.fn(),
    isLoading: false,
    isError: false,
    onRetry: vi.fn(),
  };

  it('renders section title', () => {
    render(<ManifestDetailList {...defaultProps} />);
    expect(screen.getByText('Orders & Packages')).toBeInTheDocument();
  });

  it('renders summary badge with correct counts', () => {
    render(<ManifestDetailList {...defaultProps} />);
    expect(screen.getByText('1/3 verified')).toBeInTheDocument();
  });

  it('renders all order cards', () => {
    render(<ManifestDetailList {...defaultProps} />);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
  });

  it('shows loading skeletons when loading', () => {
    render(<ManifestDetailList {...defaultProps} isLoading={true} orders={[]} />);
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument();
    // Skeletons render placeholder divs
    expect(screen.getByTestId('manifest-detail-loading')).toBeInTheDocument();
  });

  it('shows error state with retry button', () => {
    const onRetry = vi.fn();
    render(<ManifestDetailList {...defaultProps} isError={true} orders={[]} onRetry={onRetry} />);
    expect(screen.getByText(/Failed to load/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows empty state when no orders', () => {
    render(<ManifestDetailList {...defaultProps} orders={[]} />);
    expect(screen.getByText(/No orders found/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/pickup/ManifestDetailList.test.tsx --reporter=verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ManifestDetailList**

Create `apps/frontend/src/components/pickup/ManifestDetailList.tsx`:

```tsx
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { OrderCard } from './OrderCard';
import type { ManifestOrder } from '@/hooks/pickup/useManifestOrders';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';

interface ManifestDetailListProps {
  orders: ManifestOrder[];
  scans: ScanRecord[];
  onManualVerify: (label: string) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function ManifestDetailList({
  orders,
  scans,
  onManualVerify,
  isLoading,
  isError,
  onRetry,
}: ManifestDetailListProps) {
  const totalPackages = useMemo(
    () => orders.reduce((sum, o) => sum + o.packages.length, 0),
    [orders]
  );

  const verifiedCount = useMemo(() => {
    const allPackageIds = new Set(orders.flatMap(o => o.packages.map(p => p.id)));
    const verifiedIds = new Set(
      scans
        .filter(s => s.scan_result === 'verified' && s.package_id)
        .map(s => s.package_id!)
    );
    return [...verifiedIds].filter(id => allPackageIds.has(id)).length;
  }, [orders, scans]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Orders & Packages</CardTitle>
          {!isLoading && !isError && orders.length > 0 && (
            <span className="text-xs text-gray-500">
              {verifiedCount}/{totalPackages} verified
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && (
          <div data-testid="manifest-detail-loading" className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        )}

        {isError && (
          <div className="text-center py-4">
            <p className="text-sm text-red-500 mb-2">Failed to load manifest details</p>
            <Button size="sm" variant="outline" onClick={onRetry} aria-label="Retry">
              Retry
            </Button>
          </div>
        )}

        {!isLoading && !isError && orders.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">No orders found for this load</p>
        )}

        {!isLoading && !isError && orders.map(order => (
          <OrderCard
            key={order.id}
            order={order}
            scans={scans}
            onManualVerify={onManualVerify}
          />
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/components/pickup/ManifestDetailList.test.tsx --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/pickup/ManifestDetailList.tsx apps/frontend/src/components/pickup/ManifestDetailList.test.tsx
git commit -m "feat: add ManifestDetailList component with loading/error/empty states"
```

---

## Chunk 3: Page Integration

### Task 6: Integrate back arrow, ManifestDetailList, and verifiedCount fix into scanning page

**Files:**
- Modify: `apps/frontend/src/app/app/pickup/scan/[loadId]/page.tsx`
- Create: `apps/frontend/src/app/app/pickup/scan/[loadId]/page.test.tsx`

- [ ] **Step 1: Write the failing page tests**

Create `apps/frontend/src/app/app/pickup/scan/[loadId]/page.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock next/navigation
const mockPush = vi.fn();
const mockParams = { loadId: 'CARGA-001' };
vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
  useRouter: () => ({ push: mockPush }),
}));

// Mock hooks
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'manifest-1', total_packages: 10 } }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  }),
}));

vi.mock('@/hooks/pickup/usePickupScans', () => ({
  usePickupScans: () => ({ data: [] }),
  useScanMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/pickup/useManifestOrders', () => ({
  useManifestOrders: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/components/pickup/ManifestDetailList', () => ({
  ManifestDetailList: () => <div data-testid="manifest-detail-list" />,
}));

import ScanningPage from './page';

describe('ScanningPage', () => {
  it('renders back arrow that navigates to /app/pickup', () => {
    render(<ScanningPage />);
    const backButton = screen.getByLabelText('Back to manifests');
    fireEvent.click(backButton);
    expect(mockPush).toHaveBeenCalledWith('/app/pickup');
  });

  it('renders ManifestDetailList', () => {
    render(<ScanningPage />);
    expect(screen.getByTestId('manifest-detail-list')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/app/pickup/scan/\\[loadId\\]/page.test.tsx --reporter=verbose`
Expected: FAIL — back arrow and ManifestDetailList don't exist yet in the page.

- [ ] **Step 3: Add back arrow to header**

In `apps/frontend/src/app/app/pickup/scan/[loadId]/page.tsx`:

Add `ArrowLeft` to the lucide import (line 14):
```ts
import { CheckCircle, XCircle, Clock, ArrowLeft } from 'lucide-react';
```

Replace the header `<div>` (lines 96-104):
```tsx
<div className="flex items-center justify-between">
  <div className="flex items-center gap-2">
    <button
      onClick={() => router.push('/app/pickup')}
      className="p-1 rounded-md hover:bg-gray-100 transition-colors"
      aria-label="Back to manifests"
    >
      <ArrowLeft className="h-5 w-5 text-gray-600" />
    </button>
    <h1 className="text-xl font-bold text-gray-900">
      Scanning: {loadId}
    </h1>
  </div>
  <div className="flex items-center gap-1 text-sm text-gray-500">
    <Clock className="h-4 w-4" />
    {elapsed}
  </div>
</div>
```

- [ ] **Step 4: Fix verifiedCount to deduplicate by package_id**

Replace the `verifiedCount` useMemo (lines 63-66):
```ts
const verifiedCount = useMemo(
  () => {
    const verifiedPkgIds = new Set(
      scans
        .filter((s) => s.scan_result === 'verified' && s.package_id)
        .map((s) => s.package_id!)
    );
    return verifiedPkgIds.size;
  },
  [scans]
);
```

- [ ] **Step 5: Add useManifestOrders and ManifestDetailList**

Add imports at the top:
```ts
import { useManifestOrders } from '@/hooks/pickup/useManifestOrders';
import { ManifestDetailList } from '@/components/pickup/ManifestDetailList';
```

After the existing `usePickupScans` call (~line 60), add:
```ts
const {
  data: orders = [],
  isLoading: ordersLoading,
  isError: ordersError,
  refetch: refetchOrders,
} = useManifestOrders(loadId, operatorId);
```

Create the manual verify callback after `handleScan`. Note: manual verify uses a known package label, so `not_found` should not happen — no popup needed:
```ts
const handleManualVerify = useCallback(
  (packageLabel: string) => {
    if (!manifestId || !operatorId || !userId) return;
    scanMutation.mutate(
      { barcode: packageLabel, manifestId, operatorId, externalLoadId: loadId, userId }
    );
  },
  [manifestId, operatorId, userId, loadId, scanMutation]
);
```

Add the `ManifestDetailList` **after the "Recent Scans" card (line ~137) and before the "Complete Pickup" button**:
```tsx
<ManifestDetailList
  orders={orders}
  scans={scans}
  onManualVerify={handleManualVerify}
  isLoading={ordersLoading}
  isError={ordersError}
  onRetry={() => refetchOrders()}
/>
```

- [ ] **Step 6: Run all pickup tests**

Run: `cd apps/frontend && npx vitest run src/ --reporter=verbose`
Expected: ALL PASS (including the new page tests from Step 1)

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/app/app/pickup/scan/[loadId]/page.tsx apps/frontend/src/app/app/pickup/scan/[loadId]/page.test.tsx
git commit -m "feat: add back arrow, manifest detail list, and fix verifiedCount deduplication"
```

---

### Task 7: Run full test suite and verify

- [ ] **Step 1: Run all tests**

Run: `cd apps/frontend && npx vitest run --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `cd apps/frontend && npx next lint`
Expected: No errors

- [ ] **Step 4: Final commit if any lint/type fixes needed**

```bash
git add -A
git commit -m "fix: address lint/type issues from pickup scanning improvements"
```

- [ ] **Step 5: Create PR with auto-merge**

```bash
git push origin HEAD
gh pr create --title "feat: pickup scanning improvements — back arrow + manifest detail list" --body "## Summary
- Add back arrow navigation to scanning page
- Add orders & packages detail list with manual verification
- Fix verifiedCount to deduplicate by package_id
- Add package_id-based duplicate check to validateScan

Spec: docs/plans/spec-07-pickup-scanning-improvements.md

## Test plan
- [ ] Back arrow navigates to /app/pickup
- [ ] Orders load and display in accordion
- [ ] Package rows show label, SKU count, weight, verification status
- [ ] Mark Verified button creates scan record and updates counts
- [ ] Duplicate manual verify is caught and prevented
- [ ] Loading/error/empty states display correctly"
gh pr merge --auto --squash
```
