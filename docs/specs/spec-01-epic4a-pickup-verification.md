# Spec 01 — Epic 4A: Pickup Verification (Core Scanning Flow)

> **Status:** Approved
> **Date:** 2026-03-10
> **Scope:** Stories 4.0, 4.1, 4.2, 4.3, 4.4, 4.7a, 4.7b
> **Deferred to Epic 4B:** Offline sync (4.5, 4.6), PDF receipts (4.8)

---

## Overview

Pickup crews verify 300+ packages at retailer distribution centers using hardware barcode scanners (Bluetooth/USB) connected to tablets. The app validates scans against pre-ingested order data, tracks discrepancies, and captures digital signatures as legal proof of custody transfer.

The manifest is a **client-provided document** that lists orders the operator must pick up. Signing the manifest transfers legal liability — from that moment, the operator is responsible for the goods. Discrepancies (missing packages) must be documented with notes that appear on the receipt for future dispute resolution.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Manifest grouping | `orders.external_load_id` | Already exists on orders — no junction table needed |
| Scan unit | `packages.label` (fallback: `orders.order_number`) | Packages are the physical scannable units |
| Barcode input | Hardware scanner (BT/USB) → focused text input | Phone cameras are not efficient for high-volume scanning |
| Manifest lifecycle | Auto-derived from orders, lazily created on first tap | No pre-population needed — manifests appear as orders are ingested |
| Manifest visibility | All unconsumed manifests (no date filter) | Crew sees open work regardless of when orders arrived |
| Discrepancy tracking | Scan-centric (Approach A) — compare scans vs expected packages | Simple append-only scans, missing = LEFT JOIN |
| Signatures | Operator (required) + Client (optional) | Both seen in practice |
| Permissions | Migrate from single role → permissions array | Same person may pickup + load + dispatch |

---

## Data Model

### `manifests` table

```sql
id UUID PK DEFAULT gen_random_uuid()
operator_id UUID NOT NULL FK → operators
external_load_id VARCHAR(100) NOT NULL
retailer_name VARCHAR(50)
pickup_location TEXT
total_orders INT
total_packages INT
assigned_to_user_id UUID FK → users (nullable)
status manifest_status_enum ('pending', 'in_progress', 'completed', 'cancelled')
signature_operator TEXT              -- URL to signature PNG in Supabase Storage
signature_operator_name VARCHAR(255)
signature_client TEXT                -- URL to signature PNG in Supabase Storage, nullable
signature_client_name VARCHAR(255)   -- nullable
started_at TIMESTAMPTZ (nullable)
completed_at TIMESTAMPTZ (nullable)
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
deleted_at TIMESTAMPTZ (nullable)

UNIQUE (operator_id, external_load_id)
```

### `pickup_scans` table

```sql
id UUID PK DEFAULT gen_random_uuid()
operator_id UUID NOT NULL FK → operators
manifest_id UUID NOT NULL FK → manifests
package_id UUID FK → packages (nullable — null for 'not_found')
barcode_scanned VARCHAR(100) NOT NULL
scan_result scan_result_enum ('verified', 'not_found', 'duplicate')
scanned_by_user_id UUID FK → users
scanned_at TIMESTAMPTZ NOT NULL
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
deleted_at TIMESTAMPTZ (nullable)
```

### `discrepancy_notes` table

```sql
id UUID PK DEFAULT gen_random_uuid()
operator_id UUID NOT NULL FK → operators
manifest_id UUID NOT NULL FK → manifests
package_id UUID NOT NULL FK → packages
note TEXT NOT NULL
created_by_user_id UUID FK → users
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
deleted_at TIMESTAMPTZ (nullable)
```

### Standard infrastructure (all 3 tables)

Each table follows the established migration template:
- **RLS** enabled with tenant isolation policy via `get_operator_id()`
- **Audit trigger** via `audit_trigger_func()`
- **`set_updated_at` trigger** for automatic `updated_at` management
- **Indexes** on: `operator_id` (RLS performance), all FK columns, `deleted_at`
- **GRANT/REVOKE**: SELECT/INSERT/UPDATE/DELETE to `authenticated`, REVOKE ALL from `anon`
- **No `raw_data` column** — manifests are derived from orders (which already have `raw_data`), not ingested from external sources

### Scan validation logic (in order)

All lookups are scoped to the manifest's `operator_id` for tenant isolation.

1. **Duplicate check first** — search `pickup_scans` WHERE `manifest_id` = current manifest AND `barcode_scanned` = input AND `scan_result = 'verified'` → if found = `duplicate`
2. Search `packages.label` WHERE order's `external_load_id` = manifest's `external_load_id` AND `operator_id` = manifest's `operator_id` → match = `verified`
3. Search `orders.order_number` WHERE `external_load_id` = manifest's `external_load_id` AND `operator_id` = manifest's `operator_id` → match = mark all order's packages as `verified`
4. No match → `not_found`

### "What's missing" query

```sql
SELECT p.* FROM packages p
JOIN orders o ON p.order_id = o.id
WHERE o.external_load_id = :load_id
  AND o.operator_id = :operator_id
  AND p.deleted_at IS NULL
  AND p.id NOT IN (
    SELECT package_id FROM pickup_scans
    WHERE manifest_id = :manifest_id
      AND scan_result = 'verified'
      AND deleted_at IS NULL
  )
```

---

## Screen Flow

```
Screen 1: Manifest List (/pickup)
    ↓ tap card
Screen 2: Scanning (/pickup/scan/[external_load_id])
    ↓ "Complete Pickup"
Screen 3: Discrepancy Review (/pickup/review/[external_load_id])
    ↓ all notes filled → "Proceed to Sign"
Screen 4: Signature & Completion (/pickup/complete/[external_load_id])
    ↓ sign + complete
Back to Screen 1
```

### Screen 1: Manifest List

- Shows all unconsumed manifests via Supabase RPC:
  ```sql
  SELECT o.external_load_id, o.retailer_name,
         COUNT(DISTINCT o.id) as order_count,
         COUNT(p.id) as package_count
  FROM orders o
  LEFT JOIN packages p ON p.order_id = o.id AND p.deleted_at IS NULL
  WHERE o.operator_id = get_operator_id()
    AND o.external_load_id IS NOT NULL
    AND o.deleted_at IS NULL
    AND o.external_load_id NOT IN (
      SELECT m.external_load_id FROM manifests m
      WHERE m.operator_id = get_operator_id()
        AND m.status = 'completed'
        AND m.deleted_at IS NULL
    )
  GROUP BY o.external_load_id, o.retailer_name
  ```
- Two tabs: "Active" (default) and "Completed" (read-only history)
- Each card shows: retailer name, order count, package count
- Tapping creates/resumes a manifest record (upsert on `operator_id + external_load_id`)

### Screen 2: Scanning

- Auto-focused text input captures hardware scanner keystrokes (Enter = submit)
- Progress bar: packages scanned / total packages (color: red <50%, yellow 50-90%, green ≥90%)
- Counters: verified, not found, time elapsed
- Scan history: last ~5 scans with status icons
- Audio feedback (Web Audio API):
  - Verified: single beep, 800Hz, 150ms + 1 haptic pulse
  - Not found: triple beep, 400Hz, 200ms each + 3 haptic pulses + error popup
  - Duplicate: double beep, 600Hz, 200ms each + 2 haptic pulses (no popup)
- Error popup: "Package Not Included" — auto-dismisses in 5 seconds or tap to dismiss
- "Complete Pickup" button always visible at bottom

### Screen 3: Discrepancy Review

- Summary cards: verified / missing / not-in-manifest counts
- Each missing package listed with required note textarea
- "Proceed to Sign" button disabled until all missing packages have notes
- "Not in manifest" scans shown separately (informational)
- "Back to Scanning" button to resume if needed

### Screen 4: Signature & Completion

- Summary stats: verified, missing (noted), precision %, time elapsed
- Legal custody transfer notice
- Operator signature pad (required) — shows logged-in user name
- Client signature pad (optional toggle) + client name input
- "Complete & Generate Receipt" button:
  - Saves signatures to manifests record
  - Updates status to `completed`, sets `completed_at`
  - Navigates back to manifest list

---

## Permissions Migration (Story 4.0)

**Current:** `users.role` = single enum (`pickup_crew`, `warehouse_staff`, etc.)
**Current JWT claims shape:** `{ operator_id: string, role: string }` via `CustomClaims` in `auth.types.ts`

**New:** `users.permissions` = TEXT[] array of permission flags

| Permission | Replaces | Controls |
|---|---|---|
| `pickup` | pickup_crew | /pickup screens |
| `warehouse` | warehouse_staff | warehouse/receiving |
| `loading` | loading_crew | loading dock |
| `operations` | operations_manager | dashboards, reports |
| `admin` | admin | user management, system config |

- Users can have multiple permissions (e.g., `['pickup', 'loading']`)
- `role` column kept for display/backward compat; access checks use `permissions`

### JWT claims changes

**New `CustomClaims` shape:**
```typescript
{ operator_id: string, role: string, permissions: string[] }
```

- `role` stays in JWT for backward compat and display
- `permissions` array added alongside `role`
- The `custom_access_token_hook` Supabase auth function (referenced in `auth.types.ts`) must be updated to read `permissions` from the users table and include it in the JWT payload

### Auth helper migration

- All `canPerformX(role)` helpers in `RolePermissions` class replaced with `hasPermission(permissions, 'x')`
- Navigation and route guards updated to check permissions array

### RLS policy impact

Existing RLS policies use `operator_id` only (via `get_operator_id()`) — no policies depend on the `role` claim. The permissions migration does **not** affect any RLS policies.

### Backfill migration

```sql
UPDATE users SET permissions = CASE role
  WHEN 'pickup_crew' THEN ARRAY['pickup']
  WHEN 'warehouse_staff' THEN ARRAY['warehouse']
  WHEN 'loading_crew' THEN ARRAY['loading']
  WHEN 'operations_manager' THEN ARRAY['operations']
  WHEN 'admin' THEN ARRAY['pickup','warehouse','loading','operations','admin']
END;
```

---

## Component Architecture

```
app/pickup/
  layout.tsx                    → PickupLayout (permission guard)
  page.tsx                      → ManifestListPage
  scan/[loadId]/page.tsx        → ScanningPage
  review/[loadId]/page.tsx      → DiscrepancyReviewPage
  complete/[loadId]/page.tsx    → CompletionPage

components/pickup/
  ManifestCard.tsx
  ScannerInput.tsx
  ScanHistoryList.tsx
  ProgressBar.tsx
  FeedbackManager.tsx
  DiscrepancyItem.tsx
  SignaturePad.tsx
  ScanResultPopup.tsx

hooks/pickup/
  useManifests.ts               → TanStack Query: fetch manifests
  useScanValidation.ts          → validate barcode
  usePickupScans.ts             → scan mutations
  useDiscrepancies.ts           → missing packages + notes
  useFeedback.ts                → audio/haptic orchestration
  useSignature.ts               → signature pad state

lib/pickup/
  audio.ts                      → Web Audio API beep generation
  scan-validator.ts             → barcode → package/order lookup
```

---

## Story Breakdown (Epic 4A)

| Story | Title | Dependencies |
|-------|-------|-------------|
| 4.0 | Migrate RBAC from roles to permissions | None |
| 4.1 | Create manifests, pickup_scans, discrepancy_notes tables | None |
| 4.2 | Screen 1: Manifest list + route protection + nav entry | 4.0, 4.1 |
| 4.3 | Screen 2: Scanning with hardware scanner input | 4.1, 4.2 |
| 4.4 | Feedback system (audio/haptic/visual) | 4.3 |
| 4.7a | Screen 3: Discrepancy review with notes | 4.3 |
| 4.7b | Screen 4: Signature capture + completion | 4.7a |

---

## Deferred (Epic 4B)

| Story | Title |
|-------|-------|
| 4.5 | Offline scan queue with IndexedDB (Dexie already configured) |
| 4.6 | Background sync when connectivity restored (Serwist already configured) |
| 4.8 | PDF receipt generation with audit trail |

---

## Existing Infrastructure (No New Setup Needed)

- **Serwist PWA** with service worker + background sync for `pickup-scans-sync`
- **Dexie IndexedDB** with `scan_queue` table + richer offline schema
- **RBAC** with `pickup_crew` role and `canPerformPickups()` helper
- **shadcn/ui** components (button, card, input, dialog, skeleton)
- **Sonner** for toast notifications
- **Lucide React** for icons
