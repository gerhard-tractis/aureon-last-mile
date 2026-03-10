# Aureon Last Mile — Architecture Reference

> **For Claude:** Read this document before starting any implementation task.
> All code must comply with the rules in this document. No exceptions.

_Last updated: 2026-03-10_

---

## Hard Rules (non-negotiable)

| Rule | Detail |
|------|--------|
| **File size limit** | No file may exceed 300 lines. Split into focused modules when approaching this limit. |
| **TDD always** | Write a failing test before any production code. No exceptions. Use `superpowers:test-driven-development`. |
| **Unidirectional dependencies** | `ui → hooks → services → db`. No reverse imports. No circular dependencies. |
| **Monorepo structure** | All apps share the same git repo. Cross-app imports are forbidden — use shared packages only. |
| **Multi-tenant isolation** | Every table has `operator_id`. All queries filter by `operator_id`. RLS enforced at DB layer. |
| **Soft deletes** | Never hard-delete rows. Use `deleted_at` timestamp. |

---

## Monorepo Structure

```
apps/
  frontend/          ← Next.js 15 app (Vercel)
    src/
      app/           ← Next.js App Router pages
      components/    ← UI components (max 300 lines each)
      hooks/         ← TanStack Query + Zustand hooks
      lib/           ← Utility functions, Supabase client
    supabase/
      migrations/    ← SQL migration files
      functions/     ← Edge Functions (Deno)
packages/            ← Shared packages (types, utils) — not yet created
```

**Dependency direction (strictly enforced):**
```
app (pages)
  ↓
components
  ↓
hooks (TanStack Query, Zustand)
  ↓
lib (Supabase client, utils)
  ↓
Supabase (DB, Auth, Storage, Realtime)
```

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | Next.js 15, App Router, TypeScript | Deployed on Vercel |
| **Styling** | Tailwind CSS | No CSS modules |
| **UI Components** | shadcn/ui + Radix UI | Accessible, headless |
| **Server state** | TanStack Query v5 | 30s stale, 60s refetch |
| **Client state** | Zustand | UI state, filters, offline queue |
| **Database** | Supabase (PostgreSQL) | RLS enabled on all tables |
| **Auth** | Supabase Auth | JWT + RBAC, 24h expiry |
| **Realtime** | Supabase Realtime | WebSockets |
| **Edge Functions** | Supabase Edge Functions (Deno) | Webhooks, integrations |
| **Migrations** | Supabase CLI | SQL files in `supabase/migrations/` |
| **Integration worker** | n8n 2.x | Self-hosted on VPS, São Paulo |
| **PWA** | Serwist | Service worker, offline support |
| **Offline storage** | IndexedDB (Dexie) | Scan queue, manifests |
| **Error tracking** | Sentry | 5K events/month free |
| **Uptime monitoring** | BetterStack | n8n + VPS |
| **CI/CD** | GitHub Actions | test → typecheck → lint → build → deploy |
| **Deployment** | Vercel (frontend) + Supabase (DB/functions) + VPS (n8n) | Auto on merge to main |

---

## Data Modeling Rules

- `operator_id UUID NOT NULL` on every table (multi-tenant isolation)
- `created_at TIMESTAMPTZ DEFAULT NOW()` on every table
- `updated_at TIMESTAMPTZ DEFAULT NOW()` on every table (trigger-updated)
- `deleted_at TIMESTAMPTZ` for soft deletes
- `raw_data JSONB` for integration payloads (resilience against API changes)
- Audit logs: append-only, 7-year retention (Chilean commercial law)

---

## Component Design Rules

### Size limit
- **Max 300 lines per file.** If a component grows beyond this, split it:
  - Extract sub-components into separate files
  - Extract hooks into `hooks/` directory
  - Extract utility functions into `lib/`

### Component anatomy
```
ComponentName.tsx          ← main component (< 300 lines)
ComponentName.test.tsx     ← tests (collocated)
ComponentName.types.ts     ← types if complex (optional)
```

### Hook rules
- One concern per hook (e.g. `useOtifMetrics`, not `useDashboardEverything`)
- Always return `{ data, isLoading, isError }` shape from TanStack Query hooks
- Zustand stores: one store per domain (e.g. `useFilterStore`, not one global store)

---

## Testing Rules

- **Test file location:** Collocated with the component (`ComponentName.test.tsx`)
- **Test runner:** Vitest + React Testing Library
- **Coverage target:** All new code must have tests before implementation (TDD)
- **Mock strategy:** Mock at the hook level, not the component level
- **E2E tests:** Playwright (in `apps/frontend/e2e/`)

---

## Error Handling

- **Format:** `{ code, message, details, field, timestamp, request_id }`
- **Display:** Toast (transient errors), inline validation (form errors), error boundary (fatal)
- **Never** expose raw Supabase errors to the UI — map to user-friendly messages

---

## Caching Strategy

| Layer | Strategy |
|-------|---------|
| TanStack Query | `staleTime: 30_000`, `refetchInterval: 60_000` |
| Vercel CDN | Static assets: forever (hash filenames) |
| Service Worker | App shell, manifests, scan queue |

---

## Deployment

Merge to `main` triggers auto-deploy:
1. Supabase migrations run
2. Edge Functions deployed
3. Vercel frontend deployed
4. VPS n8n workflows updated (if changed)

See `docs/runbooks/` for manual operations.
