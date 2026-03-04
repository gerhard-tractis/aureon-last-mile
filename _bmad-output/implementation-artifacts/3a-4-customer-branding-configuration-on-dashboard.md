# Story 3A.4: Customer Branding Configuration on Dashboard

Status: review

## Dependencies

Depends on: Story 3A.3 (Tractis branding — done). The `.theme-tractis` CSS class, CSS variable system, and `NEXT_PUBLIC_THEME` pattern established in 3A.3 is the foundation. No dependency on 3A.1/3A.2 (data pipeline).

## Story

As a platform operator,
I want to configure per-customer branding (logo, colors, company name) for the dashboard,
so that each customer sees their own branding when using the platform.

## Acceptance Criteria

1. **AC1: Branding Schema in operators.settings** — A Supabase migration adds a documented JSONB structure to the existing `operators.settings` column for branding configuration:

   ```jsonc
   {
     "branding": {
       "logo_url": "https://example.com/logo.png",  // External URL, displayed in sidebar
       "favicon_url": "https://example.com/fav.png", // External URL (stored for future use, not dynamically applied yet)
       "company_name": "Musan Logistics",            // Overrides NEXT_PUBLIC_PRODUCTNAME in sidebar
       "primary_color": "#1e40af",                   // CSS hex color for primary theme
       "secondary_color": "#475569"                  // CSS hex color for secondary theme
     }
   }
   ```

   The migration:
   - Adds a CHECK constraint or comment documenting the expected `settings.branding` shape
   - Does NOT create a new table — uses the existing `settings JSONB` column on `operators`
   - Seeds Musan operator with initial branding config (logo_url can be NULL initially)

2. **AC2: Branding Provider Context** — A new `BrandingProvider` React context loads the operator's branding config on login and makes it available app-wide:

   - Reads `operator_id` from JWT claims at `session.user.app_metadata.claims.operator_id` (same pattern as `useOperatorId()` in `useDashboardMetrics.ts`)
   - Fetches `operators.settings` from Supabase for the user's operator using the **service role key** or a Supabase RPC, because the `operators` table currently has **NO RLS policies** (see Dev Notes). Alternatively, add a SELECT RLS policy as part of this story's migration.
   - Exposes `{ logoUrl, companyName, primaryColor, secondaryColor, isLoading }` via `useBranding()` hook
   - Caches with TanStack Query (`staleTime: 5 * 60 * 1000` — branding rarely changes)
   - Falls back to Tractis defaults when no branding config exists or on error

3. **AC3: Dynamic CSS Variable Override** — When operator has custom `primary_color` and/or `secondary_color`:

   - The `BrandingProvider` generates a CSS color ramp from the base hex color (programmatic generation of 50-950 shades using HSL manipulation)
   - Applies as inline `style` on the `<body>` element, overriding the `.theme-tractis` CSS variables
   - This means the ENTIRE app automatically re-themes (buttons, links, nav active states, charts, etc.) with zero component changes
   - If no custom colors are set, the default `.theme-tractis` gold theme applies unchanged
   - When `secondary_color` is provided, generate a secondary ramp (`--color-secondary-50` through `--color-secondary-950`) using the same HSL approach
   - Must include a `useEffect` cleanup function that removes inline CSS variables from `document.body.style` when the provider unmounts or operator changes

   **Color ramp generation approach:**
   ```ts
   // Given a base hex like "#1e40af", generate:
   // --color-primary-50 through --color-primary-950
   // Using HSL: keep H constant, vary S and L
   function generateColorRamp(prefix: string, baseHex: string): Record<string, string> { ... }
   // Call for both primary and secondary when configured
   ```

4. **AC4: Customer Logo in Dashboard Sidebar** — The `AppLayout.tsx` sidebar header displays the operator's logo:

   - If `logoUrl` is set: render `<img>` (NOT `next/image` — external URLs require `remotePatterns` config) with max-height: 40px, max-width: 160px, object-contain, replacing the text-only product name
   - If `companyName` is set but no logo: render `companyName` as the `<span>` text (instead of `NEXT_PUBLIC_PRODUCTNAME`)
   - If neither is set: fall back to current behavior (`NEXT_PUBLIC_PRODUCTNAME` text)
   - Logo `<img>` has `onError` handler that falls back to text display (no broken image icons)

5. **AC5: Company Name in Browser Title** — When `companyName` is set in branding:

   - Update the browser `<title>` to include the company name: `"{companyName} — Aureon Last Mile"` or `"{companyName} Dashboard"`
   - Use Next.js `metadata` API or a `useEffect` to update `document.title`
   - Falls back to `"Aureon Last Mile"` when no company name is configured

6. **AC6: Auth Pages Remain Tractis-Branded** — Auth pages (login, register, etc.) are NOT affected by per-operator branding:

   - Auth layout continues to show Tractis/Aureon branding (T-symbol, gold theme, "Powered by Tractis")
   - Rationale: Users are not yet authenticated at login, so operator_id is unknown. The platform is always "Powered by Tractis"
   - Per-operator branding only applies AFTER login, inside the authenticated `/app` routes

7. **AC7: Graceful Degradation** — The branding system degrades gracefully:

   - No branding config → Tractis defaults (current behavior)
   - Partial config (e.g., only `company_name`, no colors) → company name applied, default theme colors
   - Invalid color values → ignored, default theme applies
   - Logo URL fails to load → falls back to text company name
   - Network error fetching operator settings → cached value or Tractis defaults

## Tasks / Subtasks

- [x] Task 1: Supabase migration for branding schema + RLS (AC: #1, #2)
  - [x] 1.1: Write migration `20260304000001_operator_branding_and_rls.sql`
  - [x] 1.2: Enable RLS on `operators` table: `ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;`
  - [x] 1.3: Add SELECT policy: users can read their own operator row (match `operator_id` from JWT claims)
  - [x] 1.4: Add SQL comment documenting expected `settings.branding` JSONB shape
  - [x] 1.5: Seed Musan operator branding: `company_name: 'Musan Logistics'`, `favicon_url: null`, `logo_url: null`

- [x] Task 2: Create BrandingProvider context and useBranding hook (AC: #2)
  - [x] 2.1: Create `src/providers/BrandingProvider.tsx` with React context
  - [x] 2.2: Implement operator settings fetch using TanStack Query
  - [x] 2.3: Extract branding from `settings.branding` JSONB with type safety
  - [x] 2.4: Define `BrandingConfig` TypeScript interface
  - [x] 2.5: Add fallback defaults (Tractis gold, "Aureon Last Mile")
  - [x] 2.6: Wire into app layout provider tree (inside auth boundary, NOT on auth pages)

- [x] Task 3: Dynamic CSS variable override (AC: #3)
  - [x] 3.1: Implement `generateColorRamp(baseHex)` utility — HSL-based shade generation
  - [x] 3.2: Apply generated CSS variables to `document.body.style` when branding has custom colors
  - [x] 3.3: Implement secondary color ramp generation when `secondary_color` is set
  - [x] 3.4: Add `useEffect` cleanup that removes all inline CSS variables from `document.body.style` on unmount/operator change
  - [x] 3.5: Clean up overrides when operator has no custom colors (revert to theme class)
  - [x] 3.6: Test with various color inputs (blue, red, green) to verify ramp quality

- [x] Task 4: Customer logo in sidebar (AC: #4)
  - [x] 4.1: Update `AppLayout.tsx` sidebar header to consume `useBranding()`
  - [x] 4.2: Conditional render: logo image vs company name text vs default product name
  - [x] 4.3: Add `onError` fallback for broken logo URLs
  - [x] 4.4: Style logo with `max-h-10 max-w-40 object-contain`

- [x] Task 5: Browser title update (AC: #5)
  - [x] 5.1: Add `useEffect` in BrandingProvider or AppLayout to set `document.title`
  - [x] 5.2: Format: `"{companyName} — Aureon Last Mile"` or fallback to `"Aureon Last Mile"`

- [x] Task 6: Tests
  - [x] 6.1: Unit tests for `generateColorRamp()` utility
  - [x] 6.2: Tests for `BrandingProvider` context (default fallback, custom branding, partial config)
  - [x] 6.3: Tests for `AppLayout` logo rendering (logo URL, company name, fallback)
  - [x] 6.4: Verify existing test suite passes

## Dev Notes

### Critical Architecture Constraints

- **CSS variables drive everything** — The entire theme is CSS-variable based (`.theme-tractis` in `globals.css`). Per-operator overrides via inline `style` on `<body>` will cascade correctly because inline styles have higher specificity than class-based variables.
- **Multi-tenant isolation** — All data access is RLS-enforced via `operator_id`. The branding fetch uses the same `operator_id` from JWT claims.
- **TanStack Query is the caching layer** — All server state uses TanStack Query (established in Story 3.8). Branding config should follow the same pattern.
- **No admin UI in this story** — Branding is configured via Supabase Studio or direct SQL for now. An admin branding UI can be added in a future story if needed.
- **operators table has NO RLS policies** — The `operators` table was created in a `.bak` migration and RLS policies were never applied in active migrations. The branding fetch WILL fail silently with Supabase client (anon/authenticated key) unless either: (a) an RLS SELECT policy is added allowing users to read their own operator, or (b) the fetch uses a server-side API route with the service role key. **Recommended: Add RLS policy in this story's migration** — `CREATE POLICY "operators_read_own" ON public.operators FOR SELECT USING (id = (current_setting('request.jwt.claims', true)::jsonb -> 'claims' ->> 'operator_id')::uuid);` along with `ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;`

### Existing Code to Modify

| File | Change |
|---|---|
| `src/components/AppLayout.tsx` | Consume `useBranding()`, render logo/company name in sidebar header |
| `src/app/layout.tsx` | No change — theme class stays as-is, BrandingProvider overrides at runtime |

### New Files

| File | Purpose |
|---|---|
| `src/providers/BrandingProvider.tsx` | React context + TanStack Query hook for operator branding |
| `src/utils/generateColorRamp.ts` | HSL-based color ramp generation from single hex |
| `supabase/migrations/20260303000002_document_operator_branding_settings.sql` | Schema documentation + Musan seed |

### Key Pattern: useOperatorId() + TanStack Query

The existing `useOperatorId()` hook in `src/hooks/useDashboardMetrics.ts` (lines 17-31) reads `operator_id` from `session.user.app_metadata.claims.operator_id`. The `BrandingProvider` should follow the same pattern but also fetch the operator's `settings` row.

Existing dashboard query pattern to follow (`DASHBOARD_QUERY_OPTIONS` at line 11-15):
```ts
const DASHBOARD_QUERY_OPTIONS = {
  staleTime: 30000,
  refetchInterval: 60000,
  placeholderData: keepPreviousData,
} as const;
```

Branding query example:
```ts
const { data: branding } = useQuery({
  queryKey: ['branding', operatorId],
  queryFn: async () => {
    const supabase = createSPAClient();
    const { data } = await supabase
      .from('operators')
      .select('settings, name')
      .eq('id', operatorId)
      .single();
    return data?.settings?.branding ?? null;
  },
  enabled: !!operatorId,
  staleTime: 5 * 60 * 1000,  // Branding rarely changes
  gcTime: 30 * 60 * 1000,
});
```

### Current Sidebar Code (AppLayout.tsx, line ~80-91)

```tsx
<div className="h-16 flex items-center justify-between px-4 border-b">
    <span className="text-xl font-semibold text-primary-600">{productName}</span>
    <button onClick={toggleSidebar} className="lg:hidden text-gray-500 hover:text-gray-700">
        <X className="h-6 w-6" />
    </button>
</div>
```

Replace `{productName}` with conditional logo/name from `useBranding()`.

### Color Ramp Generation Strategy

Given a base hex color (e.g., `#1e40af`):
1. Convert to HSL
2. Keep Hue constant
3. Generate shades by varying Saturation and Lightness:
   - 50: L=97%, S=base×0.3
   - 100: L=93%, S=base×0.5
   - 200: L=85%, S=base×0.6
   - 300: L=75%, S=base×0.7
   - 400: L=60%, S=base×0.85
   - 500: L=50%, S=base (the input color ≈ 500)
   - 600: L=42%, S=base
   - 700: L=35%, S=base×0.9
   - 800: L=28%, S=base×0.8
   - 900: L=20%, S=base×0.7
   - 950: L=12%, S=base×0.6

This is a simplified approach. The dev should visually verify and adjust if needed.

### Auth Pages NOT Affected

The `BrandingProvider` must be placed INSIDE the authenticated app layout (`/app` routes), NOT wrapping auth pages. Auth pages continue using the static `.theme-tractis` class from `NEXT_PUBLIC_THEME`.

### Provider Tree

The BrandingProvider goes inside `src/app/app/layout.tsx` (the authenticated app layout):

```tsx
// src/app/app/layout.tsx (CURRENT)
<GlobalProvider>
  <Providers>          {/* ← TanStack QueryClientProvider */}
    <AppLayout>{children}</AppLayout>
    <Toaster />
  </Providers>
</GlobalProvider>

// src/app/app/layout.tsx (AFTER)
<GlobalProvider>
  <Providers>
    <BrandingProvider>   {/* ← NEW: inside Providers (needs QueryClient), inside GlobalProvider */}
      <AppLayout>{children}</AppLayout>
    </BrandingProvider>
    <Toaster />
  </Providers>
</GlobalProvider>
```

Note: Theme class is on `<body>` (set in `src/app/layout.tsx:38`). Inline CSS variable overrides on `document.body.style` will have higher specificity than the `.theme-tractis` class variables, so they win automatically.

### Previous Story Intelligence

**From Story 3A.3 (Tractis Branding):**
- `.theme-tractis` CSS class with gold primary + slate secondary established
- Auth layout has T-symbol SVG, "Powered by Tractis" footer, Spanish feature cards
- `NEXT_PUBLIC_THEME=theme-tractis` in `.env.local`
- All components use `primary-*` CSS variable tokens — theme override will cascade cleanly
- SSOButtons hardcoded `text-blue-600` was fixed to `text-primary-600`
- 550 tests passing after branding changes

**From Story 3.8 (TanStack Query Caching):**
- TanStack Query is configured with `QueryClientProvider` in the app
- `staleTime` and `gcTime` patterns established
- Use `useQuery` with typed query keys

### Operators Table Current State

```sql
operators (
  id UUID PK,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  country_code VARCHAR(2) DEFAULT 'CL',
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  settings JSONB DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ
)
```

The `settings` JSONB column is the right place for `branding` config — no schema migration needed beyond documentation and seeding.

### References

- [Source: apps/frontend/src/components/AppLayout.tsx] — sidebar header (logo placement)
- [Source: apps/frontend/src/app/globals.css] — CSS variable theme system
- [Source: apps/frontend/src/hooks/useDashboardMetrics.ts:17-31] — useOperatorId() pattern
- [Source: apps/frontend/src/app/layout.tsx:28-38] — theme class application
- [Source: apps/frontend/supabase/migrations/20260209_multi_tenant_rls.sql.bak] — operators table schema
- [Source: _bmad-output/implementation-artifacts/3a-3-tractis-branding-on-auth-pages.md] — Story 3A.3 learnings
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-03-03.md] — Epic 3A definition

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- BrandingProvider test initially failed because `useOperatorId` uses async `getSession()` — fixed by mocking `useOperatorId` directly for synchronous operator ID in tests.

### Completion Notes List

- Task 1: Migration `20260304000001_operator_branding_and_rls.sql` — enables RLS on operators, adds SELECT policy for own-operator reads, documents branding JSONB shape, seeds Musan branding.
- Task 2: `BrandingProvider` context with TanStack Query (5min staleTime), `useBranding()` hook, wired into `/app` layout only (auth pages unaffected per AC6).
- Task 3: `generateColorRamp()` utility generates 11 HSL-based shades (50-950), applied via `document.body.style` inline overrides with cleanup on unmount.
- Task 4: AppLayout sidebar conditionally renders logo img (with onError fallback) → company name → default product name.
- Task 5: `document.title` updated via useEffect in BrandingProvider — `"{companyName} — Aureon Last Mile"` or default.
- Task 6: 20 new tests (9 generateColorRamp, 7 BrandingProvider, 4 AppLayout). Full suite: 560 passing, 0 regressions.

### Change Log

- 2026-03-04: Story 3A.4 implemented — customer branding configuration (migration, provider, color ramp, sidebar logo, browser title, 20 tests)

### File List

- `apps/frontend/supabase/migrations/20260304000001_operator_branding_and_rls.sql` (new)
- `apps/frontend/src/utils/generateColorRamp.ts` (new)
- `apps/frontend/src/utils/generateColorRamp.test.ts` (new)
- `apps/frontend/src/providers/BrandingProvider.tsx` (new)
- `apps/frontend/src/providers/BrandingProvider.test.tsx` (new)
- `apps/frontend/src/components/AppLayout.tsx` (modified)
- `apps/frontend/src/components/AppLayout.test.tsx` (new)
- `apps/frontend/src/app/app/layout.tsx` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/3a-4-customer-branding-configuration-on-dashboard.md` (modified)
