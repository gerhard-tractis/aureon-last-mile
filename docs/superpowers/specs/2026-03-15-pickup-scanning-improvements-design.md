# Pickup Scanning Improvements — Design Spec

**Date:** 2026-03-15
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
4. "Mark Verified" calls `useScanMutation({ barcode: packageLabel, manifestId, operatorId, externalLoadId, userId })`. The existing `validateScan` matches the label and creates a scan record. Query invalidation updates everything.

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
| `src/app/app/pickup/scan/[loadId]/page.tsx` | Edit | Add back arrow + `<ManifestDetailList>` |

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
