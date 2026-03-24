# Android Tablet PWA Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the existing Next.js desktop app as a PWA on Android tablets with a role-based home screen, 4 workflow entry points (Pickup, Reception, Distribution, Dispatch), client filtering for pickup, browser camera intake, Spanish UI, and tablet layout optimizations.

**Architecture:** The desktop Next.js app becomes the tablet app via PWA — no React Native. A viewport-aware routing layer redirects tablet users (≤1024px) to a role-based home screen. Workflow screens render full-width without the sidebar. A minimal Spanish translation dictionary replaces hardcoded English strings. Camera intake uses the browser's native `<input capture>` to trigger the existing INTAKE agent backend.

**Tech Stack:** Next.js (App Router), Vitest + React Testing Library, Tailwind CSS (design tokens), Supabase (auth, storage, realtime), Serwist (service worker), Dexie (IndexedDB)

**Spec:** `docs/specs/spec-16-android-tablet-pwa.md`

## ⚠️ Review Errata — MUST apply during implementation

The plan below was reviewed and the following corrections are required. The implementing agent MUST apply these instead of the plan's original code where they conflict.

### E1. Breakpoint alignment (Task 1)
The old `useIsMobile` used `(max-width: 768px)`. To avoid a 1px behavioral regression:
- `MOBILE_QUERY` must be `'(max-width: 768px)'` (not `767px`)
- `TABLET_QUERY` must be `'(min-width: 769px) and (max-width: 1023px)'` (not `768px`)
- Update tests to match these queries

### E2. Test mock patterns (Tasks 6, 8, 12)
**`vi.mocked(await import(...))` does NOT work in Vitest.** Replace all occurrences with the codebase pattern:
```ts
// Module-level mutable state
let mockPermissions: string[] = ['pickup', 'reception', 'distribution', 'dispatch'];
let mockRole = 'admin';
let mockPush = vi.fn();

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({ user: { email: 'picker@musan.cl' }, permissions: mockPermissions, role: mockRole }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/app/pickup',
}));

// Then in individual tests:
it('hides cards for missing permissions', () => {
  mockPermissions = ['pickup'];
  mockRole = 'pickup_crew';
  render(<Component />);
  // assertions...
});
```
See `apps/frontend/src/components/AppLayout.test.tsx` for the canonical pattern.

### E3. AppLayout test updates (Task 7)
After modifying `AppLayout.tsx`, you MUST also update `AppLayout.test.tsx`:
- Add mock for `@/hooks/useViewport`: `vi.mock('@/hooks/useViewport', () => ({ useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }) }))`
- Add test cases for tablet viewport (mock `isTablet: true, isDesktop: false`)
- Fix `CapacityAlertBell` tests: the plan adds `&& isDesktop` guard — existing tests that expect the bell to render must mock `isDesktop: true`

### E4. `useSearchParams` requires Suspense (Task 10)
In `pickup/page.tsx`, do NOT call `useSearchParams()` directly in the page component. Instead:
1. Extract the search-params-dependent filter logic into a child component (e.g., `PickupContent`)
2. Wrap it in `<Suspense fallback={null}>` inside the page
3. Pattern: see how `apps/frontend/src/app/app/dashboard/page.tsx` handles this

### E5. Manifest URL change (Task 14)
Next.js App Router serves `src/app/manifest.json` at `/manifest.webmanifest`, NOT `/manifest.json`. After deleting `public/manifest.json`:
- Verify the PWA manifest is accessible at `/manifest.webmanifest`
- If existing installations depend on `/manifest.json`, add a rewrite in `next.config.ts`: `{ source: '/manifest.json', destination: '/manifest.webmanifest' }`
- Update test assertion to check `/manifest.webmanifest`

### E6. Dispatch directory already exists (Task 13)
Spec-15 may have already created `src/app/app/dispatch/`. Before creating files:
- Check if `dispatch/layout.tsx` and `dispatch/page.tsx` already exist
- If `layout.tsx` exists, MODIFY it to add the `dispatch` permission guard (it may currently check a different permission)
- If `page.tsx` exists with real dispatch content from spec-15, do NOT overwrite — skip the placeholder

### E7. CameraIntake generatorId (Task 12, Step 5)
Do NOT pass `generatorId=""`. Instead:
- Add a generator selector step to the CameraIntake modal (similar to `apps/mobile/app/(app)/intake.tsx` lines 192-214 which lists generators)
- Create a hook or inline query: `supabase.from('generators').select('id, name, code').eq('is_active', true).is('deleted_at', null)`
- Pass the selected generator ID to the `submit()` call

### E8. Realtime subscription cleanup (Task 11)
Add a `useEffect` cleanup in `useCameraIntake`:
```ts
useEffect(() => {
  return () => { channelRef.current?.unsubscribe(); };
}, []);
```

### E9. Migration file number (Task 4)
File Map says `20260325000001` but Task 4 body says `20260325000002`. Use whatever is the next available number at execution time. Check: `ls packages/database/supabase/migrations/ | tail -3`

### E10. canPerformDispatch test (Task 3)
The spec requires a test for `canPerformDispatch`. Add one:
```ts
// In auth.types.test.ts or a new file
describe('canPerformDispatch', () => {
  it('returns true for LOADING_CREW', () => {
    expect(RolePermissions.canPerformDispatch(UserRole.LOADING_CREW)).toBe(true);
  });
  it('returns true for ADMIN', () => {
    expect(RolePermissions.canPerformDispatch(UserRole.ADMIN)).toBe(true);
  });
  it('returns false for PICKUP_CREW', () => {
    expect(RolePermissions.canPerformDispatch(UserRole.PICKUP_CREW)).toBe(false);
  });
});
```

### E11. Use i18n `t()` calls in new components
Replace hardcoded strings with `t()` calls in: `ClientFilter` ("Todos" → `t('pickup.all')`), dispatch placeholder page, TabletTopBar ("Inicio" → `t('common.home')`).

### E12. Design tokens for workflow card colors (Task 8)
Replace hardcoded Tailwind colors (`bg-blue-500/10 text-blue-600`) with design tokens (`bg-accent-muted text-accent`) or use the `status-*` tokens. Follow the pattern in the codebase's existing components.

### E13. ConnectionStatusBanner test file (Task 15)
Create `apps/frontend/src/components/ConnectionStatusBanner.test.tsx` with basic tests verifying Spanish strings and design token class names. Preserve `console.error` logging from the original component.

### E14. Tablet redirect SSR hydration (Task 9)
The `useViewport` check in the `/app` page will cause a brief SSR/hydration mismatch. Add `suppressHydrationWarning` to the wrapper div, or use `dynamic(() => import('./TabletRedirect'), { ssr: false })` for the redirect logic.

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/hooks/useViewport.ts` | Viewport detection: isMobile/isTablet/isDesktop |
| `src/hooks/useViewport.test.ts` | Tests for viewport hook |
| `src/lib/i18n/es.ts` | Spanish translation dictionary |
| `src/lib/i18n/useTranslation.ts` | Minimal `t()` hook wrapping the dictionary |
| `src/lib/i18n/useTranslation.test.ts` | Tests for translation hook |
| `src/app/app/tablet-home/page.tsx` | Role-based home screen (4 workflow cards) |
| `src/app/app/tablet-home/page.test.tsx` | Tests for home screen |
| `src/app/app/tablet-home/layout.tsx` | Minimal layout bypassing AppLayout sidebar |
| `src/components/tablet/TabletTopBar.tsx` | Simplified top bar with back button for tablet workflow screens |
| `src/components/tablet/TabletTopBar.test.tsx` | Tests for top bar |
| `src/components/pickup/ClientFilter.tsx` | Pickup client/retailer filter pills |
| `src/components/pickup/ClientFilter.test.tsx` | Tests for client filter |
| `src/components/pickup/CameraIntake.tsx` | Browser camera intake modal |
| `src/components/pickup/CameraIntake.test.tsx` | Tests for camera intake |
| `src/hooks/pickup/useCameraIntake.ts` | Camera intake hook (upload, submit, realtime) |
| `src/hooks/pickup/useCameraIntake.test.ts` | Tests for camera intake hook |
| `src/app/app/dispatch/page.tsx` | Dispatch placeholder ("Próximamente") |
| `src/app/app/dispatch/layout.tsx` | Dispatch permission guard |
| `src/app/app/dispatch/page.test.tsx` | Tests for dispatch placeholder |
| `packages/database/supabase/migrations/20260325000001_add_dispatch_permission.sql` | Add dispatch permission to JWT hook |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/types/auth.types.ts` | Add `'dispatch'` to Permission type + `canPerformDispatch()` |
| `src/hooks/useIsMobile.ts` | Re-export from `useViewport.ts` for backward compat |
| `src/components/AppLayout.tsx` | Tablet viewport: hide sidebar, show TabletTopBar |
| `src/app/app/page.tsx` | Redirect tablet viewport to `/app/tablet-home` |
| `src/app/app/pickup/page.tsx` | Add ClientFilter + CameraIntake button |
| `src/components/ConnectionStatusBanner.tsx` | Spanish strings + design tokens |
| `src/app/manifest.json` | Fix orientation, shortcuts, background_color |
| `src/app/layout.tsx` | Remove hardcoded `manifest` link, set `lang="es"` |
| `tailwind.config.ts` | Add `tablet` screen breakpoint |
| `public/manifest.json` | DELETE this file (consolidate to `src/app/manifest.json`) |

---

## Chunk 1: Foundation (Viewport, i18n, Auth Types)

### Task 1: Viewport Detection Hook

**Files:**
- Create: `apps/frontend/src/hooks/useViewport.ts`
- Create: `apps/frontend/src/hooks/useViewport.test.ts`
- Modify: `apps/frontend/src/hooks/useIsMobile.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/frontend/src/hooks/useViewport.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock window.matchMedia before importing
let mediaQueryMatches: Record<string, boolean> = {};
const listeners: Record<string, ((e: { matches: boolean }) => void)[]> = {};

vi.stubGlobal('matchMedia', (query: string) => ({
  matches: mediaQueryMatches[query] ?? false,
  media: query,
  addEventListener: (event: string, handler: (e: { matches: boolean }) => void) => {
    if (!listeners[query]) listeners[query] = [];
    listeners[query].push(handler);
  },
  removeEventListener: (event: string, handler: (e: { matches: boolean }) => void) => {
    listeners[query] = (listeners[query] || []).filter((h) => h !== handler);
  },
}));

import { useViewport, useIsMobile } from './useViewport';

describe('useViewport', () => {
  beforeEach(() => {
    mediaQueryMatches = {};
    Object.keys(listeners).forEach((k) => { listeners[k] = []; });
  });

  it('returns isDesktop true when width >= 1024px', () => {
    mediaQueryMatches['(min-width: 1024px)'] = true;
    const { result } = renderHook(() => useViewport());
    expect(result.current.isDesktop).toBe(true);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.isMobile).toBe(false);
  });

  it('returns isTablet true when width is 768-1023px', () => {
    mediaQueryMatches['(min-width: 768px) and (max-width: 1023px)'] = true;
    const { result } = renderHook(() => useViewport());
    expect(result.current.isTablet).toBe(true);
    expect(result.current.isDesktop).toBe(false);
    expect(result.current.isMobile).toBe(false);
  });

  it('returns isMobile true when width < 768px', () => {
    mediaQueryMatches['(max-width: 767px)'] = true;
    const { result } = renderHook(() => useViewport());
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isDesktop).toBe(false);
    expect(result.current.isTablet).toBe(false);
  });
});

describe('useIsMobile (backward compat)', () => {
  it('returns boolean matching isMobile', () => {
    mediaQueryMatches['(max-width: 767px)'] = true;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/hooks/useViewport.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useViewport hook**

```ts
// apps/frontend/src/hooks/useViewport.ts
import { useState, useEffect } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';
const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)';
const DESKTOP_QUERY = '(min-width: 1024px)';

function useMediaMatch(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export function useViewport() {
  const isMobile = useMediaMatch(MOBILE_QUERY);
  const isTablet = useMediaMatch(TABLET_QUERY);
  const isDesktop = useMediaMatch(DESKTOP_QUERY);
  return { isMobile, isTablet, isDesktop };
}

/** Backward-compatible re-export */
export function useIsMobile(): boolean {
  return useViewport().isMobile;
}
```

- [ ] **Step 4: Update old useIsMobile.ts to re-export**

```ts
// apps/frontend/src/hooks/useIsMobile.ts
export { useIsMobile } from './useViewport';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/hooks/useViewport.test.ts`
Expected: PASS

- [ ] **Step 6: Verify no existing tests break**

Run: `cd apps/frontend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All passing (useIsMobile consumers still work via re-export)

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/hooks/useViewport.ts apps/frontend/src/hooks/useViewport.test.ts apps/frontend/src/hooks/useIsMobile.ts
git commit -m "feat(spec-16): add useViewport hook with tablet detection"
```

---

### Task 2: Spanish Translation Dictionary + Hook

**Files:**
- Create: `apps/frontend/src/lib/i18n/es.ts`
- Create: `apps/frontend/src/lib/i18n/useTranslation.ts`
- Create: `apps/frontend/src/lib/i18n/useTranslation.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/frontend/src/lib/i18n/useTranslation.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTranslation } from './useTranslation';

describe('useTranslation', () => {
  it('returns Spanish string for valid key', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('home.pickup')).toBe('Pickup');
  });

  it('returns Spanish string for nested key', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('connection.offline')).toBe('Sin conexión');
  });

  it('returns key string as fallback for missing key', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('interpolates {n} placeholder', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('connection.queued', { n: 5 })).toBe('5 escaneos en cola');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/lib/i18n/useTranslation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the Spanish dictionary**

```ts
// apps/frontend/src/lib/i18n/es.ts
export const es = {
  home: {
    pickup: 'Pickup',
    reception: 'Recepción',
    distribution: 'Distribución',
    dispatch: 'Despacho',
    logout: 'Cerrar sesión',
    welcome: 'Bienvenido',
    comingSoon: 'Próximamente',
  },
  pickup: {
    title: 'Pickup',
    manifests: 'Manifiestos',
    newManifest: 'Nuevo Manifiesto',
    all: 'Todos',
    active: 'Activos',
    completed: 'Completados',
    noManifests: 'Sin manifiestos pendientes',
    noCompleted: 'Sin manifiestos completados',
    processing: 'Procesando manifiesto...',
    processingHint: 'Esto puede tomar hasta 30 segundos',
    processed: '¡Manifiesto procesado!',
    ordersCreated: '{n} pedido(s) creado(s)',
    processError: 'Error al procesar el manifiesto',
    retry: 'Reintentar',
    capturePhoto: 'Capturar foto del manifiesto',
    needsReview: 'El manifiesto requiere revisión manual',
  },
  reception: {
    title: 'Recepción',
  },
  distribution: {
    title: 'Distribución',
  },
  dispatch: {
    title: 'Despacho',
    comingSoon: 'Despacho — Próximamente',
    comingSoonDesc: 'Este módulo está en desarrollo',
  },
  connection: {
    online: 'En línea',
    offline: 'Sin conexión',
    syncing: 'Sincronizando...',
    queued: '{n} escaneos en cola',
    onlineQueued: 'En línea — {n} escaneos pendientes de sincronización',
  },
  common: {
    back: 'Volver',
    home: 'Inicio',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    loading: 'Cargando...',
    error: 'Error',
  },
} as const;

export type TranslationKey = string;
```

- [ ] **Step 4: Create the useTranslation hook**

```ts
// apps/frontend/src/lib/i18n/useTranslation.ts
import { es } from './es';

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

export function useTranslation() {
  return {
    t: (key: string, vars?: Record<string, string | number>): string => {
      const value = getNestedValue(es as unknown as Record<string, unknown>, key);
      if (value === undefined) return key;
      return vars ? interpolate(value, vars) : value;
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/lib/i18n/useTranslation.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/i18n/
git commit -m "feat(spec-16): add minimal Spanish i18n dictionary and useTranslation hook"
```

---

### Task 3: Add `dispatch` Permission to Auth Types

**Files:**
- Modify: `apps/frontend/src/lib/types/auth.types.ts`

- [ ] **Step 1: Add `dispatch` to Permission type**

In `apps/frontend/src/lib/types/auth.types.ts` at line 188, change:
```ts
export type Permission = 'pickup' | 'warehouse' | 'loading' | 'operations' | 'admin' | 'reception' | 'distribution';
```
to:
```ts
export type Permission = 'pickup' | 'warehouse' | 'loading' | 'operations' | 'admin' | 'reception' | 'distribution' | 'dispatch';
```

- [ ] **Step 2: Add `canPerformDispatch` helper**

After `canPerformLoadingOps` (line 171), add:
```ts
  canPerformDispatch(role: UserRole): boolean {
    return (
      role === UserRole.LOADING_CREW ||
      role === UserRole.ADMIN ||
      role === UserRole.OPERATIONS_MANAGER
    );
  },
```

- [ ] **Step 3: Run type check to verify compilation**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/lib/types/auth.types.ts
git commit -m "feat(spec-16): add dispatch permission type and canPerformDispatch helper"
```

---

### Task 4: Dispatch Permission Database Migration

**Files:**
- Create: `packages/database/supabase/migrations/20260325000002_add_dispatch_permission.sql`

Note: `20260325000001` is taken by spec-15's dispatch module migration. Use `20260325000002`.

- [ ] **Step 1: Write the migration**

The migration updates `custom_access_token_hook` to include `'dispatch'` in the permissions array for `LOADING_CREW`, `OPERATIONS_MANAGER`, and `ADMIN`. Use the latest hook definition from `20260312190110_fix_hook_role_overwrite.sql` as template.

```sql
-- Migration: Add dispatch permission to JWT claims
-- Created: 2026-03-25
-- Adds 'dispatch' to permissions for loading_crew, operations_manager, admin roles

-- The permissions array is stored in the users table directly.
-- This migration adds a convenience comment; actual permission assignment
-- happens when creating/updating users via the admin UI.
-- The custom_access_token_hook already reads permissions[] from users table
-- and injects them into JWT claims — no hook change needed.
--
-- To grant dispatch permission to existing loading_crew users:
UPDATE public.users
SET permissions = array_append(permissions, 'dispatch')
WHERE role IN ('loading_crew', 'operations_manager', 'admin')
  AND deleted_at IS NULL
  AND NOT ('dispatch' = ANY(permissions));
```

- [ ] **Step 2: Verify migration is syntactically correct**

Run: `cd packages/database && npx supabase migration list 2>&1 | tail -5`
Expected: New migration appears in list

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260325000002_add_dispatch_permission.sql
git commit -m "feat(spec-16): add dispatch permission to loading_crew/admin/ops_manager users"
```

---

### Task 5: Tailwind Tablet Breakpoint

**Files:**
- Modify: `apps/frontend/tailwind.config.ts`

- [ ] **Step 1: Add tablet screen breakpoint**

In the `theme.extend` section of `tailwind.config.ts`, add:
```ts
screens: {
  tablet: '768px',
},
```

Place it alongside the existing `extend` entries (after `fontFamily` or `borderRadius`).

- [ ] **Step 2: Verify Tailwind compiles**

Run: `cd apps/frontend && npx tailwindcss --help > /dev/null 2>&1 && echo "ok"`
Expected: ok

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/tailwind.config.ts
git commit -m "feat(spec-16): add tablet Tailwind breakpoint at 768px"
```

---

## Chunk 2: Tablet Layout (AppLayout, Home Screen, Top Bar)

### Task 6: TabletTopBar Component

**Files:**
- Create: `apps/frontend/src/components/tablet/TabletTopBar.tsx`
- Create: `apps/frontend/src/components/tablet/TabletTopBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/frontend/src/components/tablet/TabletTopBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabletTopBar } from './TabletTopBar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/app/pickup',
}));

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({ user: { email: 'picker@musan.cl' } }),
}));

vi.mock('@/providers/BrandingProvider', () => ({
  useBranding: () => ({ logoUrl: null, companyName: 'Musan' }),
}));

describe('TabletTopBar', () => {
  it('renders back button with "Inicio" text', () => {
    render(<TabletTopBar />);
    expect(screen.getByText('Inicio')).toBeInTheDocument();
  });

  it('renders company name', () => {
    render(<TabletTopBar />);
    expect(screen.getByText('Musan')).toBeInTheDocument();
  });

  it('back button navigates to /app/tablet-home', () => {
    const push = vi.fn();
    vi.mocked(await import('next/navigation')).useRouter = () => ({ push } as any);
    render(<TabletTopBar />);
    fireEvent.click(screen.getByText('Inicio'));
    expect(push).toHaveBeenCalledWith('/app/tablet-home');
  });
});
```

Note: The exact mock patterns should follow how the codebase mocks `next/navigation` (check existing test files for the pattern). Adjust as needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/components/tablet/TabletTopBar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TabletTopBar**

```tsx
// apps/frontend/src/components/tablet/TabletTopBar.tsx
'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useBranding } from '@/providers/BrandingProvider';

export function TabletTopBar() {
  const router = useRouter();
  const { companyName, logoUrl } = useBranding();

  return (
    <div className="flex items-center h-14 px-4 bg-sidebar border-b border-sidebar-border">
      <button
        onClick={() => router.push('/app/tablet-home')}
        className="flex items-center gap-2 text-sidebar-text hover:text-sidebar-active transition-colors min-h-[48px] min-w-[48px]"
        aria-label="Volver al inicio"
      >
        <ArrowLeft className="h-5 w-5" />
        <span className="text-sm font-medium">Inicio</span>
      </button>
      <div className="flex-1 flex justify-center">
        {logoUrl ? (
          <img src={logoUrl} alt={companyName || 'Logo'} className="max-h-8 object-contain" />
        ) : (
          <span className="text-sm font-semibold text-sidebar-active">{companyName || 'Aureon'}</span>
        )}
      </div>
      <div className="w-[72px]" /> {/* Spacer to center logo */}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/components/tablet/TabletTopBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/tablet/
git commit -m "feat(spec-16): add TabletTopBar component with back-to-home navigation"
```

---

### Task 7: Modify AppLayout for Tablet Viewport

**Files:**
- Modify: `apps/frontend/src/components/AppLayout.tsx`

- [ ] **Step 1: Import useViewport and TabletTopBar**

At top of `AppLayout.tsx`, add:
```ts
import { useViewport } from '@/hooks/useViewport';
import { TabletTopBar } from './tablet/TabletTopBar';
import { usePathname } from 'next/navigation';
```

- [ ] **Step 2: Add tablet detection and conditional rendering**

Inside `AppLayout`, after the existing hooks:
```ts
const { isDesktop, isTablet } = useViewport();
const pathname = usePathname();
const isTabletHome = pathname === '/app/tablet-home';
```

Replace the return JSX to conditionally render:
- **Desktop (>= 1024px):** existing sidebar layout (no changes)
- **Tablet (768-1023px) on home page:** just `{children}` (home screen has its own layout)
- **Tablet (768-1023px) on workflow pages:** TabletTopBar + `{children}`, no sidebar

The key change is in the return statement. The desktop sidebar (`hidden lg:flex`) already handles hiding on small screens. For tablet, instead of the hamburger Sheet menu, show the TabletTopBar:

```tsx
return (
  <TooltipProvider>
    <div className="min-h-screen flex bg-surface">
      {/* Desktop sidebar — unchanged */}
      <aside
        data-sidebar
        data-pinned={pinned}
        className={`hidden lg:flex flex-col fixed inset-y-0 left-0 transition-all duration-200 z-30 border-r border-sidebar-border ${pinned ? 'w-[200px]' : 'w-14'}`}
      >
        <SidebarInner />
      </aside>

      {/* Main */}
      <div className={`flex-1 transition-all duration-200 ${pinned ? 'lg:ml-[200px]' : 'lg:ml-14'}`}>
        {/* Mobile hamburger — hide on tablet too */}
        {!isTablet && (
          <div className="flex lg:hidden items-center h-12 px-4 bg-sidebar border-b border-sidebar-border">
            <Sheet>
              <SheetTrigger asChild>
                <button className="text-sidebar-text" aria-label="Open sidebar">
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[200px] p-0 bg-sidebar border-sidebar-border">
                <SidebarInner mobilePinned />
              </SheetContent>
            </Sheet>
          </div>
        )}

        {/* Tablet top bar — show on tablet workflow pages (not home) */}
        {isTablet && !isTabletHome && <TabletTopBar />}

        {/* Main content */}
        <div className="relative">
          {isAdminOrManager && isDesktop && (
            <div className="absolute top-3 right-4 z-10">
              <CapacityAlertBell operatorId={operatorId} />
            </div>
          )}
          <main>{children}</main>
        </div>
      </div>
    </div>
  </TooltipProvider>
);
```

- [ ] **Step 3: Run existing tests**

Run: `cd apps/frontend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All passing

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/AppLayout.tsx
git commit -m "feat(spec-16): AppLayout hides sidebar on tablet, shows TabletTopBar"
```

---

### Task 8: Tablet Home Screen

**Files:**
- Create: `apps/frontend/src/app/app/tablet-home/page.tsx`
- Create: `apps/frontend/src/app/app/tablet-home/page.test.tsx`
- Create: `apps/frontend/src/app/app/tablet-home/layout.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/frontend/src/app/app/tablet-home/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TabletHomePage from './page';

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({
    user: { email: 'picker@musan.cl' },
    permissions: ['pickup', 'reception', 'distribution', 'dispatch'],
    role: 'admin',
  }),
}));

vi.mock('@/providers/BrandingProvider', () => ({
  useBranding: () => ({ logoUrl: null, companyName: 'Musan' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('TabletHomePage', () => {
  it('renders all 4 workflow cards when user has all permissions', () => {
    render(<TabletHomePage />);
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    expect(screen.getByText('Recepción')).toBeInTheDocument();
    expect(screen.getByText('Distribución')).toBeInTheDocument();
    expect(screen.getByText('Despacho')).toBeInTheDocument();
  });

  it('hides cards for missing permissions', () => {
    vi.mocked(await import('@/lib/context/GlobalContext')).useGlobal = () => ({
      user: { email: 'picker@musan.cl' },
      permissions: ['pickup'],
      role: 'pickup_crew',
    } as any);
    render(<TabletHomePage />);
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    expect(screen.queryByText('Recepción')).not.toBeInTheDocument();
  });

  it('renders logout button', () => {
    render(<TabletHomePage />);
    expect(screen.getByText('Cerrar sesión')).toBeInTheDocument();
  });

  it('renders company name', () => {
    render(<TabletHomePage />);
    expect(screen.getByText('Musan')).toBeInTheDocument();
  });
});
```

Note: Adjust mock patterns to match codebase conventions. The tests above show intent — the implementer should align with existing test patterns (e.g., how `useGlobal` is mocked in other test files).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/app/app/tablet-home/page.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create the tablet home layout**

```tsx
// apps/frontend/src/app/app/tablet-home/layout.tsx
export default function TabletHomeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

This layout intentionally does nothing — `AppLayout` detects the `/app/tablet-home` pathname and skips the TabletTopBar (no back button on the home screen itself).

- [ ] **Step 4: Create the tablet home page**

```tsx
// apps/frontend/src/app/app/tablet-home/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useBranding } from '@/providers/BrandingProvider';
import { hasPermission, Permission } from '@/lib/types/auth.types';
import { createSPAClient } from '@/lib/supabase/client';
import { Package, ArrowUpDown, Layers, Truck, LogOut } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface WorkflowCard {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  permission: Permission;
  color: string;
}

const WORKFLOWS: WorkflowCard[] = [
  { id: 'pickup',       label: 'Pickup',        icon: Package,     href: '/app/pickup',       permission: 'pickup',       color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  { id: 'reception',    label: 'Recepción',      icon: ArrowUpDown, href: '/app/reception',    permission: 'reception',    color: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  { id: 'distribution', label: 'Distribución',   icon: Layers,      href: '/app/distribution', permission: 'distribution', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
  { id: 'dispatch',     label: 'Despacho',       icon: Truck,       href: '/app/dispatch',     permission: 'dispatch',     color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
];

export default function TabletHomePage() {
  const router = useRouter();
  const { user, permissions } = useGlobal();
  const { logoUrl, companyName } = useBranding();

  const visibleWorkflows = WORKFLOWS.filter((w) => hasPermission(permissions, w.permission));

  const handleLogout = async () => {
    const supabase = createSPAClient();
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface p-6">
      {/* Header */}
      <div className="flex flex-col items-center mb-12">
        {logoUrl ? (
          <img src={logoUrl} alt={companyName || 'Logo'} className="max-h-16 object-contain mb-4" />
        ) : (
          <h1 className="text-2xl font-bold text-text mb-2">{companyName || 'Aureon Last Mile'}</h1>
        )}
      </div>

      {/* Workflow Cards */}
      <div className="grid grid-cols-2 gap-6 w-full max-w-lg">
        {visibleWorkflows.map((w) => (
          <button
            key={w.id}
            onClick={() => router.push(w.href)}
            className="flex flex-col items-center justify-center gap-4 p-8 rounded-xl border border-border bg-background hover:bg-surface-raised transition-colors min-h-[160px] active:scale-[0.98]"
          >
            <div className={`p-4 rounded-xl ${w.color}`}>
              <w.icon className="h-10 w-10" />
            </div>
            <span className="text-lg font-semibold text-text">{w.label}</span>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-12 flex items-center gap-4">
        <span className="text-sm text-text-muted">{user?.email}</span>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors min-h-[48px] px-4"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/app/app/tablet-home/page.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/app/tablet-home/
git commit -m "feat(spec-16): add role-based tablet home screen with 4 workflow cards"
```

---

### Task 9: Tablet Redirect from /app

**Files:**
- Modify: `apps/frontend/src/app/app/page.tsx`

- [ ] **Step 1: Add tablet redirect logic**

Modify the existing `DashboardContent` component (or add a wrapper) to redirect tablet users:

```tsx
// At top of file, add:
import { useViewport } from '@/hooks/useViewport';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Inside the component, before the existing return:
const { isTablet } = useViewport();
const router = useRouter();

useEffect(() => {
  if (isTablet) {
    router.replace('/app/tablet-home');
  }
}, [isTablet, router]);

if (isTablet) return null;
```

Note: `useRouter` may already be imported; check and avoid duplicate imports.

- [ ] **Step 2: Run existing tests**

Run: `cd apps/frontend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All passing

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/app/app/page.tsx
git commit -m "feat(spec-16): redirect tablet viewport from /app to /app/tablet-home"
```

---

## Chunk 3: Pickup Enhancements (Client Filter, Camera Intake)

### Task 10: Pickup Client Filter

**Files:**
- Create: `apps/frontend/src/components/pickup/ClientFilter.tsx`
- Create: `apps/frontend/src/components/pickup/ClientFilter.test.tsx`
- Modify: `apps/frontend/src/app/app/pickup/page.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/frontend/src/components/pickup/ClientFilter.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientFilter } from './ClientFilter';

describe('ClientFilter', () => {
  const clients = ['Easy', 'Paris', 'Falabella'];

  it('renders "Todos" pill and all client pills', () => {
    render(<ClientFilter clients={clients} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Todos')).toBeInTheDocument();
    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('Falabella')).toBeInTheDocument();
  });

  it('highlights selected client', () => {
    render(<ClientFilter clients={clients} selected="Paris" onSelect={vi.fn()} />);
    const parisBtn = screen.getByText('Paris');
    expect(parisBtn.closest('button')).toHaveClass('bg-accent');
  });

  it('highlights "Todos" when selected is null', () => {
    render(<ClientFilter clients={clients} selected={null} onSelect={vi.fn()} />);
    const todosBtn = screen.getByText('Todos');
    expect(todosBtn.closest('button')).toHaveClass('bg-accent');
  });

  it('calls onSelect with client name when clicked', () => {
    const onSelect = vi.fn();
    render(<ClientFilter clients={clients} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Easy'));
    expect(onSelect).toHaveBeenCalledWith('Easy');
  });

  it('calls onSelect with null when "Todos" clicked', () => {
    const onSelect = vi.fn();
    render(<ClientFilter clients={clients} selected="Easy" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Todos'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('renders nothing when clients list is empty', () => {
    const { container } = render(<ClientFilter clients={[]} selected={null} onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/components/pickup/ClientFilter.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement ClientFilter**

```tsx
// apps/frontend/src/components/pickup/ClientFilter.tsx
'use client';

interface ClientFilterProps {
  clients: string[];
  selected: string | null;
  onSelect: (client: string | null) => void;
}

export function ClientFilter({ clients, selected, onSelect }: ClientFilterProps) {
  if (clients.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Filtrar por cliente">
      <button
        onClick={() => onSelect(null)}
        className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] ${
          selected === null
            ? 'bg-accent text-accent-foreground'
            : 'bg-surface-raised text-text-secondary hover:bg-border'
        }`}
      >
        Todos
      </button>
      {clients.map((client) => (
        <button
          key={client}
          onClick={() => onSelect(client)}
          className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] ${
            selected === client
              ? 'bg-accent text-accent-foreground'
              : 'bg-surface-raised text-text-secondary hover:bg-border'
          }`}
        >
          {client}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/components/pickup/ClientFilter.test.tsx`
Expected: PASS

- [ ] **Step 5: Integrate into pickup page**

Modify `apps/frontend/src/app/app/pickup/page.tsx`:

1. Import `ClientFilter` and `useSearchParams`/`useRouter`:
```ts
import { ClientFilter } from '@/components/pickup/ClientFilter';
import { useSearchParams, useRouter } from 'next/navigation';
```

2. Add state/filtering logic after the existing hooks:
```ts
const searchParams = useSearchParams();
const selectedClient = searchParams.get('client');

// Extract unique retailer names from pending manifests
const clients = [...new Set(
  (pendingManifests ?? []).map((m) => m.retailer_name).filter(Boolean) as string[]
)].sort();

// Filter manifests by selected client
const filteredPending = selectedClient
  ? pendingManifests?.filter((m) => m.retailer_name === selectedClient)
  : pendingManifests;

const filteredCompleted = selectedClient
  ? completedManifests?.filter((m) => m.retailer_name === selectedClient)
  : completedManifests;

const handleClientSelect = (client: string | null) => {
  const params = new URLSearchParams(searchParams.toString());
  if (client) params.set('client', client);
  else params.delete('client');
  router.replace(`/app/pickup?${params.toString()}`);
};
```

3. Add `<ClientFilter>` before the tabs:
```tsx
<ClientFilter clients={clients} selected={selectedClient} onSelect={handleClientSelect} />
```

4. Replace `pendingManifests` with `filteredPending` and `completedManifests` with `filteredCompleted` in the render.

- [ ] **Step 6: Run all pickup tests**

Run: `cd apps/frontend && npx vitest run src/components/pickup/ src/hooks/pickup/ src/app/app/pickup/`
Expected: All passing

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/pickup/ClientFilter.tsx apps/frontend/src/components/pickup/ClientFilter.test.tsx apps/frontend/src/app/app/pickup/page.tsx
git commit -m "feat(spec-16): add client filter pills to pickup manifest list"
```

---

### Task 11: Camera Intake Hook

**Files:**
- Create: `apps/frontend/src/hooks/pickup/useCameraIntake.ts`
- Create: `apps/frontend/src/hooks/pickup/useCameraIntake.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/frontend/src/hooks/pickup/useCameraIntake.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockUpload = vi.fn();
const mockInsert = vi.fn();
const mockChannel = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    auth: { getUser: mockGetUser },
    storage: { from: () => ({ upload: mockUpload }) },
    from: () => ({ insert: () => ({ select: () => ({ single: mockInsert }) }) }),
    channel: () => ({
      on: () => ({ subscribe: mockSubscribe }),
      unsubscribe: mockUnsubscribe,
    }),
  }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-123' }),
}));

import { useCameraIntake } from './useCameraIntake';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useCameraIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('starts in idle status', () => {
    const { result } = renderHook(() => useCameraIntake(), { wrapper: createWrapper() });
    expect(result.current.status).toBe('idle');
  });

  it('uploads photo and creates submission', async () => {
    mockUpload.mockResolvedValue({ error: null });
    mockInsert.mockResolvedValue({ data: { id: 'sub-1' }, error: null });
    mockSubscribe.mockReturnValue({ unsubscribe: mockUnsubscribe });

    const { result } = renderHook(() => useCameraIntake(), { wrapper: createWrapper() });

    const file = new File(['photo'], 'test.jpg', { type: 'image/jpeg' });
    await act(async () => { await result.current.submit(file, 'gen-1'); });

    expect(mockUpload).toHaveBeenCalled();
    expect(result.current.status).toBe('processing');
  });

  it('sets error status on upload failure', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'Upload failed' } });

    const { result } = renderHook(() => useCameraIntake(), { wrapper: createWrapper() });

    const file = new File(['photo'], 'test.jpg', { type: 'image/jpeg' });
    await act(async () => { await result.current.submit(file, 'gen-1'); });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Upload failed');
  });

  it('reset returns to idle', async () => {
    const { result } = renderHook(() => useCameraIntake(), { wrapper: createWrapper() });
    act(() => { result.current.reset(); });
    expect(result.current.status).toBe('idle');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/hooks/pickup/useCameraIntake.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement useCameraIntake hook**

```ts
// apps/frontend/src/hooks/pickup/useCameraIntake.ts
import { useState, useCallback, useRef } from 'react';
import { createSPAClient } from '@/lib/supabase/client';
import { useOperatorId } from '@/hooks/useOperatorId';

type IntakeStatus = 'idle' | 'uploading' | 'processing' | 'success' | 'error';

interface IntakeResult {
  ordersCreated: number;
  status: string;
}

export function useCameraIntake() {
  const { operatorId } = useOperatorId();
  const [status, setStatus] = useState<IntakeStatus>('idle');
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof createSPAClient>['channel']> | null>(null);

  const submit = useCallback(async (file: File, generatorId: string) => {
    setStatus('uploading');
    setError(null);
    setResult(null);

    try {
      const supabase = createSPAClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');

      // Upload photo
      const filename = `manifests/${user.id}/${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from('manifests')
        .upload(filename, file, { contentType: file.type, upsert: false });
      if (uploadErr) throw new Error(uploadErr.message);

      // Create submission
      const { data: sub, error: subErr } = await supabase
        .from('intake_submissions')
        .insert({
          operator_id: operatorId,
          generator_id: generatorId,
          channel: 'manual',
          status: 'received',
          raw_file_url: filename,
          raw_payload: { source: 'tablet_camera', user_id: user.id },
          raw_data: { source: 'tablet_camera' },
        })
        .select('id')
        .single();
      if (subErr) throw new Error(subErr.message);

      setStatus('processing');

      // Subscribe to realtime status updates
      const channel = supabase
        .channel(`intake_${sub.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'intake_submissions', filter: `id=eq.${sub.id}` },
          (payload) => {
            const row = payload.new as { status: string; orders_created?: number };
            if (row.status === 'parsed' || row.status === 'confirmed') {
              setResult({ ordersCreated: row.orders_created ?? 0, status: row.status });
              setStatus('success');
              channel.unsubscribe();
            } else if (row.status === 'failed' || row.status === 'needs_review') {
              setError(
                row.status === 'needs_review'
                  ? 'El manifiesto requiere revisión manual'
                  : 'Error al procesar el manifiesto'
              );
              setStatus('error');
              channel.unsubscribe();
            }
          }
        )
        .subscribe();
      channelRef.current = channel;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setStatus('error');
    }
  }, [operatorId]);

  const reset = useCallback(() => {
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);

  return { submit, reset, status, result, error };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/hooks/pickup/useCameraIntake.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/pickup/useCameraIntake.ts apps/frontend/src/hooks/pickup/useCameraIntake.test.ts
git commit -m "feat(spec-16): add useCameraIntake hook for browser camera manifest submission"
```

---

### Task 12: CameraIntake UI Component

**Files:**
- Create: `apps/frontend/src/components/pickup/CameraIntake.tsx`
- Create: `apps/frontend/src/components/pickup/CameraIntake.test.tsx`
- Modify: `apps/frontend/src/app/app/pickup/page.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/frontend/src/components/pickup/CameraIntake.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CameraIntake } from './CameraIntake';

vi.mock('@/hooks/pickup/useCameraIntake', () => ({
  useCameraIntake: () => ({
    submit: vi.fn(),
    reset: vi.fn(),
    status: 'idle',
    result: null,
    error: null,
  }),
}));

describe('CameraIntake', () => {
  it('renders file input with camera capture', () => {
    render(<CameraIntake generatorId="gen-1" onClose={vi.fn()} />);
    const input = screen.getByTestId('camera-input');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
  });

  it('renders capture button text', () => {
    render(<CameraIntake generatorId="gen-1" onClose={vi.fn()} />);
    expect(screen.getByText('Capturar foto del manifiesto')).toBeInTheDocument();
  });

  it('shows processing state', () => {
    vi.mocked(await import('@/hooks/pickup/useCameraIntake')).useCameraIntake = () => ({
      submit: vi.fn(),
      reset: vi.fn(),
      status: 'processing',
      result: null,
      error: null,
    });
    render(<CameraIntake generatorId="gen-1" onClose={vi.fn()} />);
    expect(screen.getByText('Procesando manifiesto...')).toBeInTheDocument();
  });

  it('shows success state with order count', () => {
    vi.mocked(await import('@/hooks/pickup/useCameraIntake')).useCameraIntake = () => ({
      submit: vi.fn(),
      reset: vi.fn(),
      status: 'success',
      result: { ordersCreated: 5, status: 'parsed' },
      error: null,
    });
    render(<CameraIntake generatorId="gen-1" onClose={vi.fn()} />);
    expect(screen.getByText('¡Manifiesto procesado!')).toBeInTheDocument();
  });

  it('shows error state with retry', () => {
    vi.mocked(await import('@/hooks/pickup/useCameraIntake')).useCameraIntake = () => ({
      submit: vi.fn(),
      reset: vi.fn(),
      status: 'error',
      result: null,
      error: 'Upload failed',
    });
    render(<CameraIntake generatorId="gen-1" onClose={vi.fn()} />);
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByText('Reintentar')).toBeInTheDocument();
  });
});
```

Note: The `vi.mocked(await import(...))` pattern above is pseudocode showing test intent. The implementer should use the actual mock pattern from the codebase (likely `vi.mock` with factory, or `mockReturnValue`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/components/pickup/CameraIntake.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement CameraIntake component**

```tsx
// apps/frontend/src/components/pickup/CameraIntake.tsx
'use client';

import { useRef } from 'react';
import { useCameraIntake } from '@/hooks/pickup/useCameraIntake';
import { Camera, CheckCircle, Loader2, RefreshCw, X } from 'lucide-react';

interface CameraIntakeProps {
  generatorId: string;
  onClose: () => void;
}

export function CameraIntake({ generatorId, onClose }: CameraIntakeProps) {
  const { submit, reset, status, result, error } = useCameraIntake();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) submit(file, generatorId);
  };

  const handleRetry = () => {
    reset();
    inputRef.current?.click();
  };

  if (status === 'processing' || status === 'uploading') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <Loader2 className="h-12 w-12 animate-spin text-accent" />
        <p className="text-lg font-semibold text-text">Procesando manifiesto...</p>
        <p className="text-sm text-text-muted">Esto puede tomar hasta 30 segundos</p>
      </div>
    );
  }

  if (status === 'success' && result) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <CheckCircle className="h-16 w-16 text-status-success" />
        <p className="text-xl font-bold text-text">¡Manifiesto procesado!</p>
        <p className="text-sm text-text-muted">
          {result.ordersCreated} pedido{result.ordersCreated !== 1 ? 's' : ''} creado{result.ordersCreated !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => { reset(); onClose(); }}
          className="mt-4 px-6 py-3 rounded-lg bg-accent text-accent-foreground font-medium min-h-[48px]"
        >
          Cerrar
        </button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <span className="text-4xl">⚠️</span>
        <p className="text-xl font-bold text-text">Error al procesar</p>
        <p className="text-sm text-text-muted">{error}</p>
        <button
          onClick={handleRetry}
          className="flex items-center gap-2 mt-4 px-6 py-3 rounded-lg border border-accent text-accent font-medium min-h-[48px]"
        >
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </button>
      </div>
    );
  }

  // Idle state
  return (
    <div className="flex flex-col items-center justify-center gap-6 p-8">
      <div className="relative">
        <input
          ref={inputRef}
          data-testid="camera-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="absolute inset-0 opacity-0 cursor-pointer min-h-[48px]"
        />
        <button
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center gap-4 p-8 rounded-xl border-2 border-dashed border-border hover:border-accent transition-colors"
        >
          <Camera className="h-16 w-16 text-text-muted" />
          <span className="text-lg font-medium text-text">Capturar foto del manifiesto</span>
        </button>
      </div>
      <button
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-text-muted hover:text-text min-h-[48px]"
      >
        <X className="h-4 w-4" />
        Cancelar
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/components/pickup/CameraIntake.test.tsx`
Expected: PASS

- [ ] **Step 5: Integrate into pickup page**

In `apps/frontend/src/app/app/pickup/page.tsx`, add:

1. Import:
```ts
import { CameraIntake } from '@/components/pickup/CameraIntake';
import { Camera } from 'lucide-react';
import { useState } from 'react';
```

2. State:
```ts
const [showIntake, setShowIntake] = useState(false);
```

3. Button after the title `<h1>`:
```tsx
<div className="flex items-center justify-between">
  <h1 className="text-xl font-bold text-text">Pickup</h1>
  <button
    onClick={() => setShowIntake(true)}
    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium min-h-[44px]"
  >
    <Camera className="h-4 w-4" />
    Nuevo Manifiesto
  </button>
</div>
```

4. Modal/section (above the tabs):
```tsx
{showIntake && (
  <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
    <div className="bg-background rounded-xl max-w-md w-full">
      <CameraIntake generatorId="" onClose={() => setShowIntake(false)} />
    </div>
  </div>
)}
```

Note: `generatorId` will need to be selected or inferred. If the picker's manifests are already scoped to a generator, use the first pending manifest's generator. Otherwise, add a generator selector in the intake flow (similar to the mobile app's `select_generator` step). The implementer should check how generators are referenced in existing data.

- [ ] **Step 6: Run all pickup tests**

Run: `cd apps/frontend && npx vitest run src/components/pickup/ src/hooks/pickup/`
Expected: All passing

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/pickup/CameraIntake.tsx apps/frontend/src/components/pickup/CameraIntake.test.tsx apps/frontend/src/app/app/pickup/page.tsx
git commit -m "feat(spec-16): add browser camera intake with CameraIntake component and modal"
```

---

## Chunk 4: Dispatch Placeholder, Manifest Cleanup, Connection Banner, Final Polish

### Task 13: Dispatch Placeholder Page

**Files:**
- Create: `apps/frontend/src/app/app/dispatch/page.tsx`
- Create: `apps/frontend/src/app/app/dispatch/layout.tsx`
- Create: `apps/frontend/src/app/app/dispatch/page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/frontend/src/app/app/dispatch/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DispatchPage from './page';

describe('DispatchPage', () => {
  it('renders coming soon message in Spanish', () => {
    render(<DispatchPage />);
    expect(screen.getByText('Despacho — Próximamente')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/app/dispatch/page.test.tsx`
Expected: FAIL

- [ ] **Step 3: Create dispatch layout with permission guard**

```tsx
// apps/frontend/src/app/app/dispatch/layout.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { hasPermission } from '@/lib/types/auth.types';

export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { permissions } = useOperatorId();

  useEffect(() => {
    if (permissions.length > 0 && !hasPermission(permissions, 'dispatch')) {
      router.push('/app');
    }
  }, [permissions, router]);

  if (permissions.length > 0 && !hasPermission(permissions, 'dispatch')) {
    return null;
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Create dispatch placeholder page**

```tsx
// apps/frontend/src/app/app/dispatch/page.tsx
import { Truck } from 'lucide-react';

export default function DispatchPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8">
      <div className="p-6 rounded-xl bg-orange-500/10">
        <Truck className="h-16 w-16 text-orange-500" />
      </div>
      <h1 className="text-2xl font-bold text-text">Despacho — Próximamente</h1>
      <p className="text-text-muted text-center max-w-md">
        Este módulo está en desarrollo. Pronto podrás gestionar rutas, asignar conductores y rastrear entregas desde aquí.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/app/app/dispatch/page.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/app/dispatch/
git commit -m "feat(spec-16): add dispatch placeholder page with permission guard"
```

---

### Task 14: PWA Manifest Consolidation

**Files:**
- Modify: `apps/frontend/src/app/manifest.json`
- Delete: `apps/frontend/public/manifest.json`
- Modify: `apps/frontend/src/app/layout.tsx`

- [ ] **Step 1: Update src/app/manifest.json**

```json
{
  "name": "Aureon Last Mile",
  "short_name": "Aureon",
  "description": "Plataforma de gestión de última milla",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1e2a3a",
  "theme_color": "#e6c15c",
  "orientation": "any",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "categories": ["business", "productivity"],
  "shortcuts": [
    {
      "name": "Pickup",
      "short_name": "Pickup",
      "url": "/app/pickup"
    },
    {
      "name": "Recepción",
      "short_name": "Recepción",
      "url": "/app/reception"
    },
    {
      "name": "Distribución",
      "short_name": "Distribución",
      "url": "/app/distribution"
    },
    {
      "name": "Despacho",
      "short_name": "Despacho",
      "url": "/app/dispatch"
    }
  ],
  "prefer_related_applications": false
}
```

- [ ] **Step 2: Delete public/manifest.json**

```bash
rm apps/frontend/public/manifest.json
```

- [ ] **Step 3: Update root layout**

In `apps/frontend/src/app/layout.tsx`:

1. Remove `manifest: "/manifest.json"` from the `metadata` object (Next.js App Router auto-serves `src/app/manifest.json` at `/manifest.webmanifest`).

2. Change `<html lang="en">` to `<html lang="es">`.

- [ ] **Step 4: Run existing tests**

Run: `cd apps/frontend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All passing

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/manifest.json apps/frontend/src/app/layout.tsx
git rm apps/frontend/public/manifest.json
git commit -m "feat(spec-16): consolidate PWA manifest, set lang=es, orientation=any"
```

---

### Task 15: ConnectionStatusBanner — Spanish + Design Tokens

**Files:**
- Modify: `apps/frontend/src/components/ConnectionStatusBanner.tsx`

- [ ] **Step 1: Update the component**

Replace the hardcoded English strings and Tailwind colors:

```tsx
// apps/frontend/src/components/ConnectionStatusBanner.tsx
'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/db';
import { syncManager } from '@/lib/sync-manager';

type ConnectionStatus = 'online' | 'offline' | 'syncing';

export default function ConnectionStatusBanner() {
  const [status, setStatus] = useState<ConnectionStatus>('online');
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    const isOnline = navigator.onLine;
    setStatus(isOnline ? 'online' : 'offline');

    const handleOnline = async () => {
      setStatus('syncing');
      try {
        await syncManager.manualSync();
        setStatus('online');
      } catch {
        setStatus('online');
      }
    };

    const handleOffline = () => setStatus('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    db.scan_queue.filter((scan) => !scan.synced).count().then(setQueueCount).catch(() => {});

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (status === 'online' && queueCount === 0) return;

    const interval = setInterval(async () => {
      try {
        const count = await db.scan_queue.filter((scan) => !scan.synced).count();
        setQueueCount(count);
      } catch {
        // ignore
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [status, queueCount]);

  if (status === 'online' && queueCount === 0) return null;

  return (
    <div
      data-testid="connection-banner"
      className={`
        fixed top-0 left-0 right-0 z-50
        px-4 py-2 text-center text-sm font-medium
        ${
          status === 'online'
            ? 'bg-status-success text-white'
            : status === 'offline'
              ? 'bg-status-warning text-black'
              : 'bg-text-muted text-white'
        }
      `}
    >
      {status === 'online' && queueCount > 0 && (
        <span>En línea — {queueCount} escaneos pendientes de sincronización</span>
      )}
      {status === 'offline' && (
        <span>Sin conexión — {queueCount} escaneos en cola</span>
      )}
      {status === 'syncing' && <span>Sincronizando...</span>}
    </div>
  );
}
```

- [ ] **Step 2: Run existing ConnectionStatusBanner tests (if any)**

Run: `cd apps/frontend && npx vitest run src/components/ConnectionStatusBanner 2>&1 | tail -10`
Expected: PASS (or no tests found — then verify manually)

- [ ] **Step 3: Run full test suite**

Run: `cd apps/frontend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All passing

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/ConnectionStatusBanner.tsx
git commit -m "fix(spec-16): ConnectionStatusBanner — Spanish strings + design token colors"
```

---

### Task 16: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd apps/frontend && npx vitest run --reporter=verbose`
Expected: All passing

- [ ] **Step 2: Run TypeScript type check**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd apps/frontend && npm run lint`
Expected: No errors

- [ ] **Step 4: Build check**

Run: `cd apps/frontend && npm run build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix(spec-16): address lint/type/build issues"
```

- [ ] **Step 6: Create PR**

```bash
gh pr create --title "feat(spec-16): Android tablet PWA — role-based home, client filter, camera intake" --body "$(cat <<'EOF'
## Summary
- Role-based tablet home screen with 4 workflow cards (permission-gated)
- Pickup client filter (Paris, Easy, etc.) with URL persistence
- Browser camera intake for manifest creation (same INTAKE agent backend)
- Spanish-only UI via minimal i18n dictionary
- Tablet layout: no sidebar, TabletTopBar with back navigation
- Dispatch permission + placeholder page (spec-15 fills screens)
- PWA manifest consolidated, orientation=any, shortcuts fixed
- ConnectionStatusBanner: Spanish + design tokens

## Test plan
- [ ] Verify tablet home screen shows only permitted workflow cards
- [ ] Verify pickup client filter shows/hides manifests by retailer
- [ ] Verify camera intake opens native camera on Android tablet
- [ ] Verify INTAKE agent processes the photo and creates orders
- [ ] Verify offline scanning queues in IndexedDB
- [ ] Verify PWA installs from Chrome "Add to Home Screen"
- [ ] Verify desktop (>1024px) sees no changes
- [ ] All tests pass in CI

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```
