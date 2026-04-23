# Spec-16b: Android Tablet PWA — Pickup Tablet Features

**Status:** completed

_Date: 2026-03-24_

---

## Goal

Add two pickup-specific features for the tablet: client filtering (show only Paris or Easy manifests) and browser camera intake (create manifests via tablet camera, triggering the INTAKE agent).

## Prerequisites

- Spec-16a (tablet shell) — viewport hook, i18n, tablet layout
- Spec-10d (INTAKE agent) — backend for camera intake

## Out of Scope

- PWA manifest consolidation (spec-16c)
- ConnectionStatusBanner changes (spec-16c)
- Non-pickup workflows

## Deliverables

### 1. Client Filter Component

**New:** `src/components/pickup/ClientFilter.tsx` + test

Horizontal pill buttons: "Todos | Paris | Easy | ..." derived from distinct `retailer_name` values in pending manifests (client-side extraction, no new RPC). Uses `t('pickup.all')` for "Todos".

### 2. Client Filter Integration

**Modify:** `src/app/app/pickup/page.tsx`

- Extract page content into a child component wrapped in `<Suspense fallback={null}>` (required by `useSearchParams` in Next.js App Router)
- Add `useSearchParams` for `?client=Paris` state
- Filter both pending and completed manifests by selected client
- No hook changes — filtering is client-side after data fetch

### 3. Camera Intake Hook

**New:** `src/hooks/pickup/useCameraIntake.ts` + test

Hook managing the full intake flow:
- `submit(file, generatorId)` — upload to Supabase Storage, insert `intake_submissions` row, subscribe to Realtime
- States: `idle | uploading | processing | success | error`
- Returns: `{ submit, reset, status, result, error }`
- `useEffect` cleanup to unsubscribe Realtime channel on unmount
- `operator_id` from `useOperatorId()`

**Backend prerequisites (verify, not build):**
- `manifests` Supabase Storage bucket must exist and allow authenticated uploads
- `intake_submissions` RLS must allow INSERT with matching `operator_id`
- Supabase Realtime enabled for `intake_submissions`

### 4. Camera Intake Component

**New:** `src/components/pickup/CameraIntake.tsx` + test

Modal UI with:
- Generator selector (query `generators` table, list active generators)
- `<input type="file" accept="image/*" capture="environment">` to trigger Android camera
- Processing state (spinner + "Procesando manifiesto...")
- Success state (order count + close button)
- Error state (message + retry button)
- All strings via `t()` calls

### 5. Pickup Page Integration

**Modify:** `src/app/app/pickup/page.tsx`

- "Nuevo Manifiesto" button in header (opens CameraIntake modal)
- Modal overlay with CameraIntake component
- Generator ID passed from generator selector within the modal (not empty string)

## Exit Criteria

- [ ] Client filter pills show distinct retailer names from manifest data
- [ ] "Todos" shows all manifests, selecting a client filters the list
- [ ] Filter state persists in URL `?client=Paris`
- [ ] Filter applies to both Active and Completed tabs
- [ ] "Nuevo Manifiesto" opens camera on Android tablet
- [ ] Photo → upload → INTAKE agent processes → orders created
- [ ] Generator selector lists active generators before camera opens
- [ ] Success state shows order count
- [ ] Error state allows retry
- [ ] All new files under 300 lines with collocated tests
- [ ] `operator_id` enforced on every query
