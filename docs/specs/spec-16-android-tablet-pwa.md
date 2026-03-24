# Spec-16: Android Tablet PWA — Warehouse Operations App

**Status:** backlog — split into sub-specs

_Date: 2026-03-24_

---

## Split

This spec has been split into three sub-specs for easier implementation:

1. **[Spec-16a: Tablet Shell](spec-16a-tablet-shell.md)** — viewport detection, i18n, tablet layout, home screen, dispatch permission
2. **[Spec-16b: Pickup Tablet Features](spec-16b-pickup-tablet-features.md)** — client filter, browser camera intake
3. **[Spec-16c: PWA Polish](spec-16c-pwa-polish.md)** — manifest consolidation, ConnectionStatusBanner, offline verification

Implementation order: 16a → 16b and 16c (16b and 16c can run in parallel after 16a).

The original spec below is kept as the full design reference.

---

## Goal

Ship the existing Next.js desktop app as a PWA on Android tablets for four warehouse roles: Pickup, Receptionist, Distribution, and Dispatch. One codebase, one deploy, instant updates. No React Native — the desktop app IS the tablet app.

## Context

The desktop app already has complete workflows for Pickup (manifest list → barcode scan → review → handoff), Reception (incoming trucks → scan → confirm), and Distribution (sectorization → batch/quick-sort scanning → zone assignment). These use a wired/Bluetooth HID barcode scanner that sends keyboard events — works identically in a browser.

The React Native app (`apps/mobile`) has only one production feature (camera intake from spec-10d) and placeholder screens for everything else. Rather than port 30+ tested components and 14+ hooks to React Native, we make the desktop app tablet-friendly and deliver via PWA.

Dispatch is being implemented in spec-15 in a parallel session. This spec builds the shell (home screen card, route, permission gate) but Dispatch screens depend on spec-15 landing first. Spec-16 creates the placeholder `dispatch/page.tsx` and `dispatch/layout.tsx`. When spec-15 implements the actual screens, it replaces the placeholder `page.tsx` but keeps the `layout.tsx` permission guard.

## Prerequisites

- Spec-13d (hub reception) — merged
- Spec-12 (distribution/sectorization) — merged
- Existing PWA infrastructure (Serwist, IndexedDB, background sync) — from Epic 1.5 / Epic 4

## Out of Scope

- Phone-sized (≤600px) responsive layouts — tablet only
- Offline-first for non-scanning workflows (reception, distribution, dispatch)
- Push notifications
- App store publishing (Play Store / APK distribution)
- Changes to `apps/mobile` — stays dormant

## What Already Exists

### PWA Infrastructure (fully built)
- `next.config.ts` — Serwist plugin configured
- `src/lib/sw.ts` — service worker with precaching, runtime caching strategies, background sync listener for `pickup-scans-sync` tag
- `src/lib/db.ts` — IndexedDB via Dexie (`aureon_offline` DB, `scan_queue` table)
- `src/lib/sync-manager.ts` — SyncManager class, exponential backoff, batch sync to `/api/pickup/scans/bulk`
- `src/components/ServiceWorkerRegistration.tsx` — SW registration on app load
- `src/components/ConnectionStatusBanner.tsx` — online/offline/syncing status banner (currently English strings, hardcoded colors — needs Spanish + design tokens)
- Two manifest files: `public/manifest.json` and `src/app/manifest.json` — need consolidation (see Deliverable 7)

### Workflows (fully built, tested)
- **Pickup:** `/app/pickup` → `/app/pickup/scan/[id]` → `/app/pickup/review/[id]` → `/app/pickup/complete/[id]` → `/app/pickup/handoff/[id]`. 14 components, 3 hooks.
- **Reception:** `/app/reception` → `/app/reception/scan/[receptionId]` → `/app/reception/complete/[receptionId]`. 7 components, 4 hooks.
- **Distribution:** `/app/distribution` → batch mode (`/app/distribution/batch/[batchId]`) or quick-sort (`/app/distribution/quicksort`). 10+ components, 6+ hooks.

### Auth & Permissions (fully built)
- 5 roles: `PICKUP_CREW`, `WAREHOUSE_STAFF`, `LOADING_CREW`, `OPERATIONS_MANAGER`, `ADMIN`
- 7 permissions: `pickup`, `warehouse`, `loading`, `operations`, `admin`, `reception`, `distribution`
- `dispatch` permission does **not** exist yet — needs to be added (see Deliverable 6)
- Route-level guards in `reception/layout.tsx`, `distribution/layout.tsx`, `pickup/layout.tsx`
- `useGlobal()` → `{ user, operatorId, role, permissions }`

### Responsive Layout (partially built)
- `AppLayout.tsx` — sidebar hidden <1024px, hamburger menu via Sheet
- `useIsMobile()` — detects ≤768px

---

## Deliverables

### 1. Role-Based Home Screen

**New route:** `/app` on tablet viewports redirects to `/app/tablet-home`

**New page:** `src/app/app/tablet-home/page.tsx`

When a user on a tablet-sized viewport (≤1024px) navigates to `/app`, redirect to `/app/tablet-home` — a full-screen home with 4 large workflow cards:

```
┌─────────────────────────────────────┐
│         Aureon Last Mile            │
│         [operator logo]             │
│                                     │
│   ┌──────────┐  ┌──────────┐       │
│   │  📦      │  │  🏭      │       │
│   │ Pickup   │  │ Recepción│       │
│   └──────────┘  └──────────┘       │
│   ┌──────────┐  ┌──────────┐       │
│   │  🔀      │  │  🚚      │       │
│   │Distribuc.│  │ Despacho │       │
│   └──────────┘  └──────────┘       │
│                                     │
│   [user name]         [Cerrar sesión]│
└─────────────────────────────────────┘
```

- Each card is shown only if the user has the corresponding permission (`pickup`, `reception`, `distribution`, `dispatch`)
- Tapping a card navigates to the workflow route
- Dispatch card shows but navigates to "Próximamente" placeholder until spec-15 lands
- Desktop users (>1024px) see the existing sidebar layout — no change

**Routing architecture:**
- `src/app/app/page.tsx` (existing) — add client-side redirect: if viewport ≤1024px, `router.replace('/app/tablet-home')`
- `src/app/app/tablet-home/page.tsx` — the home screen. Does NOT use `AppLayout` sidebar. Has its own minimal layout.
- `src/app/app/tablet-home/layout.tsx` — renders `{children}` without `AppLayout` wrapper (or `AppLayout` detects this route and hides sidebar)
- Workflow pages (`/app/pickup`, `/app/reception`, etc.) on tablet: `AppLayout` hides the sidebar, shows a simplified top bar with a "← Inicio" back button to `/app/tablet-home`

**Modify:** `src/components/AppLayout.tsx`
- Detect tablet viewport (≤1024px) AND not on `/app/tablet-home`
- Hide sidebar, show simplified top bar with back-to-home button
- Desktop (>1024px) behavior unchanged

**Tests:**
- Renders 4 cards when user has all permissions
- Hides cards for missing permissions
- Dispatch card navigates to placeholder
- Redirect from `/app` triggers on tablet viewport
- Back button navigates to tablet-home

### 2. Pickup — Client Filter

**Modify:** `src/app/app/pickup/page.tsx`

Add a client/generator filter above the manifest list. When a picker is going to Paris, they select "Paris" and only see Paris manifests.

**Data source:** Extract distinct `retailer_name` values client-side from the manifest list already returned by `usePendingManifests`. No new RPC needed — the data is already there.

**UX:**
- Horizontal segmented control (pill buttons) above the tabs: `Todos | Paris | Easy | ...`
- Derived from `pendingManifests.map(m => m.retailer_name)` → unique, sorted
- Default: "Todos" (show all)
- Filter state persisted in URL search params (`?client=Paris`)
- Applied to both Active and Completed tabs (filter `completedManifests` client-side too)
- `useCompletedManifests` already returns all completed manifests when the tab is active — filter client-side

**Modify hooks:** No hook changes needed — filtering is applied in the page component after data is fetched.

**Tests:**
- Renders filter pills for each distinct retailer
- "Todos" shows all manifests
- Selecting a client filters the list
- Filter persists in URL search params
- Filter applies to both tabs

### 3. Pickup — Browser Camera Intake

**New component:** `src/components/pickup/CameraIntake.tsx`

Browser-native camera capture for creating new manifests:

```tsx
<input
  type="file"
  accept="image/*"
  capture="camera"
  onChange={handlePhotoCapture}
/>
```

On Android tablet, this opens the native camera app. On photo capture:
1. Upload photo to Supabase Storage (`manifests/{user_id}/{timestamp}.jpg`)
2. Insert `intake_submissions` row (`status: received`, `channel: manual`, `raw_file_url`, `raw_payload: { source: 'tablet_camera' }`)
3. Subscribe to Supabase Realtime for status updates on the submission
4. Show processing state → success (order count, matched customer) → error with retry

This is the same backend flow as spec-10d — the INTAKE agent picks up the submission from the `intake.ingest` queue.

**Integration:** Add a "Nuevo Manifiesto" button on the pickup page that opens the camera intake flow as a modal dialog.

**Backend prerequisites (verify, not build):**
- `manifests` Supabase Storage bucket must exist and allow authenticated uploads. If missing, create the bucket with `public: false` policy.
- `intake_submissions` table RLS must allow INSERT from authenticated users with `operator_id` matching their claims. Spec-10b created these tables with RLS — verify the frontend Supabase client can insert.
- Supabase Realtime subscription on `intake_submissions` table must be enabled (Realtime is already used for other tables).
- If any of these are missing, add them as part of this deliverable — they are configuration, not schema changes.

**New hook:** `src/hooks/pickup/useCameraIntake.ts`
- `uploadPhoto(file: File)` → Supabase Storage upload
- `createSubmission(generatorId, fileUrl)` → insert `intake_submissions` row
- `subscribeToSubmission(id)` → Realtime listener for status changes
- States: `idle | uploading | processing | success | error`
- Returns: `{ submit, status, result, error, reset }`

**Tests:**
- Upload triggers Supabase Storage call
- Insert creates `intake_submissions` row with correct fields
- Realtime subscription fires on status change
- Success state shows order count
- Error state shows retry option
- `operator_id` included in insert

### 4. Spanish-Only UI (Tablet Viewport)

**No i18n library exists in `apps/frontend`.** Rather than add `react-i18next` or `next-intl` for a single locale, create a minimal translation dictionary.

**New files:**
- `src/lib/i18n/es.ts` — flat dictionary of all Spanish strings, organized by section
- `src/lib/i18n/useTranslation.ts` — minimal hook: `const { t } = useTranslation()` → `t('pickup.manifests')` returns the Spanish string

**Pattern:**
```ts
// src/lib/i18n/es.ts
export const es = {
  home: { pickup: 'Pickup', reception: 'Recepción', distribution: 'Distribución', dispatch: 'Despacho', logout: 'Cerrar sesión' },
  pickup: { manifests: 'Manifiestos', newManifest: 'Nuevo Manifiesto', all: 'Todos', ... },
  connection: { offline: 'Sin conexión', syncing: 'Sincronizando...', queued: '{n} escaneos en cola' },
  // ...
} as const

// src/lib/i18n/useTranslation.ts
export function useTranslation() {
  return { t: (key: string) => getNestedValue(es, key) ?? key }
}
```

**Scope of string replacement:**
- All new components (tablet-home, CameraIntake, client filter)
- `ConnectionStatusBanner.tsx` — replace hardcoded English strings, migrate colors to design tokens
- Existing workflow screens that already use Spanish strings — leave as-is
- Existing workflow screens with English strings — replace with `t()` calls
- Root layout `lang` attribute — set to `"es"` when tablet viewport detected (via a `<html lang>` update in the root layout or via a client-side effect)

**Tests:**
- `t('home.pickup')` returns 'Pickup'
- Missing keys return the key string as fallback
- ConnectionStatusBanner shows Spanish strings

### 5. Tablet Layout Optimizations

A 10" Android tablet in portrait is ~800px wide. It falls between `useIsMobile` (≤768px) and the sidebar breakpoint (1024px).

**Modify:** `tailwind.config.ts` — add custom screen:
```ts
screens: { tablet: '768px' }
```

**Modify:** `src/hooks/useIsMobile.ts` → rename to `src/hooks/useViewport.ts`:
```ts
export function useViewport() {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)')
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  return { isMobile, isTablet, isDesktop }
}
// Keep useIsMobile as a re-export for backward compatibility
export function useIsMobile() { return useViewport().isMobile }
```

**Layout rules for tablet:**
- No sidebar — simplified top bar with "← Inicio" back button
- Workflow screens: full-width, single-column
- Scan input: large touch target, prominent visual feedback
- Touch targets: minimum 48x48px for all interactive elements
- Font sizes: body 16px, headers 20-24px

**Tests:**
- `useViewport()` returns correct values at each breakpoint
- `useIsMobile()` backward compatibility maintained
- AppLayout hides sidebar on tablet
- Back button visible on tablet workflow screens

### 6. Dispatch Permission & Placeholder

**The `dispatch` permission does not exist.** This deliverable adds it.

**Modify:** `src/lib/types/auth.types.ts`
- Add `'dispatch'` to the `Permission` union type
- Add `canPerformDispatch(role)` to `RolePermissions` — returns true for `LOADING_CREW`, `OPERATIONS_MANAGER`, `ADMIN`

**New Supabase migration:** `supabase/migrations/XXXXXX_add_dispatch_permission.sql`
- Update the `custom_access_token_hook` function to map `LOADING_CREW` → includes `dispatch` permission in JWT claims
- `OPERATIONS_MANAGER` and `ADMIN` already get all permissions — verify they include `dispatch`
- Use the **latest** migration's definition of the hook as template (per architecture rules)

**New page:** `src/app/app/dispatch/page.tsx`
- Shows "Despacho — Próximamente" centered with an icon
- Spec-15 will replace this page when it lands

**New layout:** `src/app/app/dispatch/layout.tsx`
- Permission guard: `hasPermission(permissions, 'dispatch')` → redirect to `/app` if missing
- Spec-15 keeps this layout guard

**Tests:**
- `dispatch` permission type compiles
- `canPerformDispatch` returns correct values per role
- Placeholder page renders on tablet
- Layout redirects without permission

### 7. PWA Manifest Consolidation & Branding

**Problem:** Two manifest files with conflicting values and a dead shortcut (`/app/scan` → should be `/app/pickup`).

**Action:**
- Delete `public/manifest.json` — the root layout already has a `<link rel="manifest">` but Next.js App Router natively serves `src/app/manifest.json`
- Update `src/app/manifest.json`:
  - `orientation: "any"` (tablets may use landscape)
  - `background_color: "#1e2a3a"` (dark slate, matches Tractis branding)
  - Fix shortcut: `/app/scan` → `/app/pickup`
  - Add shortcuts for all 4 workflows: Pickup, Recepción, Distribución, Despacho
  - Verify `display: "standalone"` is set
- Update `src/app/layout.tsx`: remove `<link rel="manifest" href="/manifest.json">` if present (App Router serves it automatically)
- Verify 192x192 and 512x512 Tractis icons render correctly on Android home screen

**Tests:**
- Manifest serves from `/manifest.json` with correct values
- All shortcut URLs resolve to real routes

### 8. Offline Scanning (Verification & Polish)

The offline infrastructure exists. This is verification and gap-fixing, not new feature work.

**Verify on Android Chrome on a real tablet:**
- Service worker caches all workflow pages for offline access
- `scan_queue` IndexedDB table accepts writes when offline
- `pickup-scans-sync` Background Sync tag triggers when connectivity returns
- `ConnectionStatusBanner` renders correctly on tablet viewport with Spanish strings and design tokens
- Scanner input accepts keystrokes when offline — no network-dependent UI blocking
- Manual sync button works when Background Sync API is unavailable

**Modify if needed:** `src/components/ConnectionStatusBanner.tsx`
- Replace hardcoded English strings with `t()` calls
- Replace hardcoded Tailwind colors (`bg-green-500`, `bg-yellow-500`) with design tokens

**Tests:**
- ConnectionStatusBanner renders Spanish strings
- ConnectionStatusBanner uses design token classes
- Offline scan queue stores scans correctly

---

## Intentional Constraints

- **No i18n library** — minimal dictionary + hook, not `react-i18next` or `next-intl`. Keeps the bundle small and avoids premature abstraction for a single locale.
- **No new backend work** — all tables, RLS, storage buckets were created by spec-10b/10d. This spec only verifies frontend access. If verification reveals gaps (missing bucket, RLS too restrictive), fix as configuration — not schema changes.
- **No desktop visual changes** — viewport >1024px must render identically to today. All tablet-specific code is gated behind viewport detection.
- **Dispatch is a shell** — home screen card + placeholder page + permission. Screens come from spec-15.

## What Does NOT Change

- Desktop users (>1024px) see the exact same app they see today
- All existing screens, components, hooks, tests remain untouched (except targeted modifications listed above)
- Backend, Supabase schema, agents — no changes (configuration verification only)
- `apps/mobile` stays in the repo, dormant (not deleted)

## Deployment to Tablets

1. Desktop app deploys to Vercel as usual (CI/CD already configured)
2. On each Android tablet: open Chrome → navigate to app URL → "Add to Home Screen"
3. App appears as full-screen standalone app with Tractis icon
4. Updates are instant — next deploy, tablets get the new version on next load

No app store, no APK, no EAS, no Play Store submission.

## Exit Criteria

- [ ] User logs in on Android tablet → sees role-based home screen with permitted workflow cards
- [ ] Picker taps "Pickup" → sees manifests filtered by client → scans packages with wired scanner → completes handoff
- [ ] Picker taps "Nuevo Manifiesto" → tablet camera opens → photo captured → INTAKE agent processes → manifest created
- [ ] Receptionist taps "Recepción" → sees incoming trucks → scans packages → confirms receipt
- [ ] Distribution user taps "Distribución" → batch or quick-sort scanning → packages assigned to zones
- [ ] Dispatch card visible but shows "Próximamente" placeholder
- [ ] All UI in Spanish on tablet viewport
- [ ] Offline: scanner works without connectivity, scans queue in IndexedDB, sync when online
- [ ] PWA: installs from Chrome, shows Tractis icon on home screen, opens full-screen standalone
- [ ] Desktop users (>1024px) see no visual changes
- [ ] All new files under 300 lines with collocated tests
- [ ] `operator_id` enforced on every query
- [ ] `dispatch` permission added to auth types and JWT claims
- [ ] Single manifest.json with correct shortcuts and orientation
- [ ] ConnectionStatusBanner shows Spanish strings with design tokens
