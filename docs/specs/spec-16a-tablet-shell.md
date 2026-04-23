# Spec-16a: Android Tablet PWA — Tablet Shell

**Status:** completed

_Date: 2026-03-24_

---

## Goal

Make the existing Next.js desktop app usable on Android tablets by adding a role-based home screen, tablet-aware layout (no sidebar), and the foundational infrastructure (viewport detection, Spanish i18n, dispatch permission).

This is the first of three specs that together deliver the full tablet experience:
- **16a (this):** Tablet shell — viewport, i18n, layout, home screen
- **16b:** Pickup tablet features — client filter, camera intake
- **16c:** PWA polish — manifest consolidation, ConnectionStatusBanner, offline verification

## Prerequisites

- Spec-13d (hub reception) — merged
- Spec-12 (distribution/sectorization) — merged

## Out of Scope

- Pickup client filter and camera intake (spec-16b)
- PWA manifest consolidation, ConnectionStatusBanner changes (spec-16c)
- Phone-sized layouts (≤600px)
- Changes to `apps/mobile`

## Deliverables

### 1. Viewport Detection Hook

**New:** `src/hooks/useViewport.ts` + test

Hook returning `{ isMobile, isTablet, isDesktop }` using `matchMedia`. Breakpoints:
- Mobile: `(max-width: 768px)` — matches existing `useIsMobile` behavior
- Tablet: `(min-width: 769px) and (max-width: 1023px)`
- Desktop: `(min-width: 1024px)`

**Modify:** `src/hooks/useIsMobile.ts` — re-export `useIsMobile` from `useViewport.ts` for backward compatibility.

### 2. Spanish Translation Dictionary

**New:** `src/lib/i18n/es.ts` + `src/lib/i18n/useTranslation.ts` + test

Minimal flat dictionary of Spanish strings. `useTranslation()` returns `{ t }` where `t(key, vars?)` resolves a dotted key path and interpolates `{n}` placeholders. Falls back to key string if not found. No i18n library — just a dictionary and a hook.

### 3. Tailwind Tablet Breakpoint

**Modify:** `tailwind.config.ts` — add `screens: { tablet: '769px' }` in `theme.extend`.

### 4. Dispatch Permission

**Modify:** `src/lib/types/auth.types.ts`
- Add `'dispatch'` to `Permission` union type
- Add `canPerformDispatch(role)` → true for `LOADING_CREW`, `OPERATIONS_MANAGER`, `ADMIN`
- Add unit test for `canPerformDispatch`

**New migration:** `packages/database/supabase/migrations/XXXXXX_add_dispatch_permission.sql`
- `UPDATE public.users SET permissions = array_append(permissions, 'dispatch')` for loading_crew/ops_manager/admin users who don't already have it.

### 5. TabletTopBar Component

**New:** `src/components/tablet/TabletTopBar.tsx` + test

Simplified top bar for tablet workflow screens. Shows "← Inicio" back button (navigates to `/app/tablet-home`), centered operator logo/name. Uses design tokens. Min 48x48px touch targets.

### 6. AppLayout Tablet Mode

**Modify:** `src/components/AppLayout.tsx`

On tablet viewport (769-1023px):
- Hide the desktop sidebar (already hidden by CSS `lg:flex`)
- Hide the mobile hamburger menu (replace with nothing)
- Show `TabletTopBar` on workflow pages (not on `/app/tablet-home`)
- Hide `CapacityAlertBell` (only shown on desktop)

**Modify:** `src/components/AppLayout.test.tsx` — add mock for `useViewport`, add test cases for tablet viewport, fix `CapacityAlertBell` tests.

### 7. Tablet Home Screen

**New:** `src/app/app/tablet-home/page.tsx` + `layout.tsx` + test

Full-screen page with 4 large workflow cards (Pickup, Recepción, Distribución, Despacho). Each card permission-gated. User email + "Cerrar sesión" at bottom. Uses design tokens for card colors, `t()` for all strings.

### 8. Tablet Redirect

**Modify:** `src/app/app/page.tsx`

On tablet viewport, redirect to `/app/tablet-home`. Use `dynamic(() => import('./TabletRedirect'), { ssr: false })` to avoid hydration mismatch.

### 9. Dispatch Placeholder Page

**New or Modify:** `src/app/app/dispatch/page.tsx` + `layout.tsx`

Check if spec-15 has already created these files. If `layout.tsx` exists, modify to add `dispatch` permission guard. If `page.tsx` exists with real content from spec-15, skip the placeholder. Otherwise, create a "Despacho — Próximamente" page.

## Exit Criteria

- [ ] `useViewport()` returns correct values at mobile/tablet/desktop breakpoints
- [ ] `useIsMobile()` backward compatibility maintained
- [ ] `t('home.pickup')` returns 'Pickup', missing keys fall back to key string
- [ ] Tablet viewport (769-1023px): no sidebar, TabletTopBar with back button
- [ ] Tablet home screen shows only permitted workflow cards
- [ ] Desktop (≥1024px) sees no visual changes
- [ ] `dispatch` permission in auth types, migration adds to existing users
- [ ] Dispatch placeholder renders on tablet
- [ ] All new files under 300 lines with collocated tests
- [ ] `operator_id` enforced on every query
