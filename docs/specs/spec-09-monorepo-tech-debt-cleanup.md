# Monorepo Structure & Technical Debt Cleanup

**Date:** 2026-03-18
**Status:** draft
**Epic:** Infrastructure
**Stories:** N/A (structural, no user-facing features)
**Depends on:** Nothing — can be done independently of any feature work

## Problem

The repository contains 3 independent apps (`apps/frontend`, `apps/mobile`, `apps/worker`) that all depend on the same Supabase database but share no code, no types, and no tooling. Each app has its own `node_modules/`, its own TypeScript types for the same DB tables, and its own CI pipeline. There is no root `package.json` and no workspace configuration.

This causes:
1. **Silent type drift** — when a DB column changes, frontend types are updated but mobile types remain stale. No compile error warns you. The bug surfaces at runtime.
2. **Duplicated installs** — `npm install` must be run in each app independently. Shared dependencies (React, TypeScript) are installed 3 times.
3. **No unified scripts** — there's no way to lint, test, or type-check all apps from the root. CI runs everything regardless of what changed.
4. **Dead weight** — `_bmad-output/` (legacy planning artifacts) is tracked in git but referenced by nothing. Template names (`sasstemplate`, `supabase-expo-template`) remain from scaffolding.
5. **Misplaced DB ownership** — Supabase migrations live in `apps/frontend/supabase/` even though the database serves all 3 apps equally.

## Solution

Convert the repo to a proper npm workspaces monorepo with Turborepo, a shared `packages/database/` package, and cleanup of dead artifacts.

### Key Design Decisions

1. **npm workspaces** (not yarn/pnpm) — the repo already uses npm and `package-lock.json`. No reason to change package managers for this migration.
2. **One shared package** (`packages/database/`) — holds Supabase migrations, auto-generated types, and shared enums/constants. A separate `packages/shared/` was considered but the shared business logic is too thin to justify a second package. Can be split later if needed.
3. **Turborepo for task orchestration** — cached builds, parallel execution, `--affected` flag in CI. This is the industry standard for JavaScript monorepos.
4. **Supabase migrations move to `packages/database/`** — makes explicit that the DB is shared infrastructure, not owned by frontend.
5. **No code logic changes** — this spec is purely structural. No feature behavior changes, no API changes, no UI changes.

---

## Part 1: Root Package & Workspaces

### Root `package.json`

Create at repo root:

```json
{
  "name": "@aureon/root",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check",
    "dev:frontend": "turbo run dev --filter=@aureon/frontend",
    "dev:mobile": "turbo run dev --filter=@aureon/mobile"
  },
  "devDependencies": {
    "turbo": "^2"
  }
}
```

### Package Renames

| App | Current `name` | New `name` |
|-----|---------------|------------|
| `apps/frontend` | `sasstemplate` | `@aureon/frontend` |
| `apps/mobile` | `supabase-expo-template` | `@aureon/mobile` |
| `apps/worker` | `@aureon/worker` | `@aureon/worker` (already correct) |

Frontend and mobile add `@aureon/database` as a dependency:

```json
"dependencies": {
  "@aureon/database": "*"
}
```

The `"*"` version means "resolve from the workspace" — npm follows the symlink to `packages/database/`.

**Worker dependency is optional.** The worker uses raw `pg` (PostgreSQL client) with no `@supabase/supabase-js`. It can import shared enums from `@aureon/database` (e.g., status constants), but does not need the generated Supabase types. Add the dependency only when the worker actually needs shared types.

### Script Name Harmonization

Standardize script names across all apps so Turborepo can run them uniformly:

| Script | Frontend | Mobile | Worker | Action needed |
|--------|----------|--------|--------|---------------|
| `build` | `next build` | N/A | `tsc` | None |
| `test` | `vitest` | (missing) | `vitest run` | Add placeholder to mobile |
| `test:run` | `vitest run` | (missing) | (missing) | Add to worker |
| `lint` | `next lint` | `expo lint` | (missing) | Add to worker |
| `type-check` | `tsc --noEmit` | (missing) | `typecheck` → rename | Rename worker script, add to mobile |

Worker's `"typecheck"` must be renamed to `"type-check"` to match Turborepo's task name. Mobile needs placeholder `"type-check": "tsc --noEmit"` and `"test": "echo 'no tests configured'"` so Turborepo doesn't silently skip it.

### Expo `app.json` Cleanup

`apps/mobile/app.json` still has template names (`"name": "RAZ Supabase Expo Template"`, `"slug": "supabase-expo-template"`, etc.). Update:

| Field | Current | New |
|-------|---------|-----|
| `name` | `RAZ Supabase Expo Template` | `Aureon Last Mile` |
| `slug` | `supabase-expo-template` | `aureon-last-mile` |
| `scheme` | `supabase-expo-template` | `aureon` |
| `ios.bundleIdentifier` | `com.razikus.supabase-expo-template` | `com.tractis.aureon` |
| `android.package` | `com.razikus.supabase_expo_template` | `com.tractis.aureon` |

---

## Part 2: `packages/database/`

### Structure

```
packages/database/
  supabase/
    migrations/              ← moved from apps/frontend/supabase/migrations/
    functions/               ← moved from apps/frontend/supabase/functions/
      beetrack-webhook/      ← Supabase Edge Function
      dispatchtrack-route-poll/ ← Supabase Edge Function
    config.toml              ← moved from apps/frontend/supabase/config.toml
    seed.sql                 ← moved if exists
  src/
    database.types.ts        ← auto-generated: supabase gen types typescript
    enums.ts                 ← shared status codes, roles, constants
    index.ts                 ← barrel export
  package.json
  tsconfig.json
```

**Note on Edge Functions:** `functions/beetrack-webhook/` and `functions/dispatchtrack-route-poll/` are Supabase Edge Functions deployed via `supabase functions deploy`. They live alongside migrations because they are Supabase-managed serverside code, not app code. They move with the rest of `supabase/`.

### `package.json`

```json
{
  "name": "@aureon/database",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "generate-types": "supabase gen types typescript --project-id $SUPABASE_PROJECT_REF > src/database.types.ts",
    "build": "tsc --noEmit"
  },
  "devDependencies": {
    "supabase": "^2.76.6",
    "typescript": "^5"
  }
}
```

### `enums.ts`

Consolidate scattered string literals into typed constants:

```typescript
export const ORDER_STATUSES = [
  'ingresado',
  'verificado',
  'en_bodega',
  'despachado',
  'en_ruta',
  'entregado',
  'no_entregado',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const USER_ROLES = [
  'admin',
  'operations_manager',
  'warehouse_operator',
  'driver',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CONNECTOR_TYPES = ['csv_email', 'browser', 'api'] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
```

### Migration of Supabase Folder

Move `apps/frontend/supabase/` → `packages/database/supabase/`.

Update any references:
- `apps/frontend/package.json` scripts that reference `supabase` CLI commands
- `.github/workflows/` CI files that run migrations
- `supabase/config.toml` internal paths (if any)

Leave a symlink or update the Supabase CLI `--workdir` flag so `supabase` commands still work from the root:

```bash
# From repo root:
npx supabase --workdir packages/database db push
```

---

## Part 3: Turborepo

### `turbo.json`

Create at repo root:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "test:run": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "type-check": {
      "dependsOn": ["^build"]
    }
  }
}
```

- `"^build"` — build dependencies before the current package
- `"cache": false` on `dev` — dev servers are long-running, never cached
- `"persistent": true` on `dev` — tells Turborepo the process stays alive
- `"outputs"` — what Turborepo caches (`.next/` for frontend, `dist/` for worker)

### `.gitignore` additions

```
.turbo
```

Turborepo stores local cache in `.turbo/` — this must not be committed.

---

## Part 4: CI Updates

### GitHub Actions

Update the existing CI workflow to use Turborepo:

```yaml
- name: Install dependencies
  run: npm ci

- name: Lint
  run: npx turbo run lint

- name: Type check
  run: npx turbo run type-check

- name: Test
  run: npx turbo run test:run
```

Key changes:
- **One `npm ci`** at the root instead of per-app installs
- **Turborepo runs tasks** — it handles parallelism and caching
- Remove any per-app `cd apps/frontend && npm ci && npm test` patterns
- **Merge `ci.yml` and `test.yml`** into a single workflow — currently both run frontend tests independently. Consolidate into one Turborepo-driven pipeline.

### `deploy.yml` Updates

The deploy workflow has two jobs that use `working-directory: apps/frontend` for Supabase commands:
- `deploy-supabase` (runs `supabase db push`)
- `deploy-edge-functions` (runs `supabase functions deploy`)

Both must be updated to `working-directory: packages/database` after the migration:

```yaml
deploy-supabase:
  defaults:
    run:
      working-directory: packages/database  # was: apps/frontend

deploy-edge-functions:
  defaults:
    run:
      working-directory: packages/database  # was: apps/frontend
```

### Vercel Build

**Pre-migration verification:** Confirm in the Vercel dashboard that the project has **Root Directory** set to `apps/frontend`. This is required for Vercel to find the correct `next.config.js` in a monorepo. If not set, the build will fail after migration.

Vercel auto-detects monorepos. It runs `npm install` at the monorepo root (installing all workspaces) and then builds from the Root Directory.

### Next.js `transpilePackages`

`apps/frontend/next.config.js` must add `transpilePackages` so Next.js can import raw TypeScript from the workspace package:

```js
transpilePackages: ['@aureon/database'],
```

Without this, Next.js will fail to compile `@aureon/database` source files since they are `.ts` not `.js`.

---

## Part 5: Cleanup

### Delete `_bmad-output/`

Remove the entire folder. It contains:
- `architectural-decisions/` — legacy planning artifacts
- `implementation-artifacts/` — legacy planning artifacts
- `planning-artifacts/` — legacy planning artifacts

No code, no script, no CI step references this folder. The repo already has `docs/specs/` for specs and `docs/architecture/` for architecture docs.

### Audit unused dependencies

Review and remove if unused:
- `@paddle/paddle-js` and `@paddle/paddle-node-sdk` in `apps/frontend` — payment SDK from template. Verify if Aureon uses Paddle payments. If not, remove.
- Any other template-specific dependencies that aren't imported anywhere.

### Clean merged git branches

One-time local cleanup:

```bash
git branch --merged main | grep -v main | xargs git branch -d
```

This only affects local branches. Remote branches are cleaned automatically by GitHub after PR merges.

---

## File Map — Final Structure

```
aureon-last-mile/
  package.json                    ← NEW: root workspace config
  turbo.json                      ← NEW: Turborepo config
  package-lock.json               ← regenerated for all workspaces
  node_modules/                   ← single install for all apps

  apps/
    frontend/                     ← @aureon/frontend (renamed)
      package.json                ← depends on @aureon/database
      src/                        ← unchanged
      (supabase/ removed)         ← moved to packages/database/
    mobile/                       ← @aureon/mobile (renamed)
      package.json                ← depends on @aureon/database
    worker/                       ← @aureon/worker (unchanged)
      package.json                ← @aureon/database optional (uses raw pg)

  packages/
    database/                     ← NEW: shared DB types & migrations
      supabase/
        migrations/               ← moved from apps/frontend/supabase/
        functions/                ← edge functions (beetrack-webhook, etc.)
        config.toml
      src/
        database.types.ts         ← auto-generated
        enums.ts                  ← shared constants
        index.ts

  docs/                           ← unchanged
  scripts/                        ← unchanged
  .github/                        ← CI updated to use turbo

  (_bmad-output/ deleted)
```

---

## What Does NOT Change

- **App logic** — no feature code is modified
- **Deployment targets** — frontend → Vercel, mobile → Expo, worker → VPS
- **Supabase project** — same project ID, same RLS policies, same migrations
- **Test suites** — each app keeps its own test config and test files
- **Git history** — use `git mv` for moves to preserve blame

---

## Edge Cases

- **Expo and workspaces** — Expo (React Native) has known issues with npm workspaces because Metro bundler doesn't follow symlinks by default. No `metro.config.js` exists in the mobile app today. Create one that sets `watchFolders` to include the monorepo root and `nodeModulesPaths` to resolve from root `node_modules/`. For Expo SDK 54:
  ```js
  const { getDefaultConfig } = require('expo/metro-config');
  const path = require('path');
  const projectRoot = __dirname;
  const monorepoRoot = path.resolve(projectRoot, '../..');
  const config = getDefaultConfig(projectRoot);
  config.watchFolders = [monorepoRoot];
  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(monorepoRoot, 'node_modules'),
  ];
  module.exports = config;
  ```
  Without this, the mobile app will fail to resolve `@aureon/database`. Must be tested before merging.
- **Supabase CLI workdir** — After moving migrations, the Supabase CLI needs `--workdir packages/database` or a root-level `supabase/config.toml` symlink. Test `supabase db push` and `supabase gen types` after the move.
- **Vercel Root Directory** — Verify Vercel project settings point to `apps/frontend` as Root Directory. Workspaces monorepos need this to deploy the correct app.
- **Lock file regeneration** — After migration, delete ALL `node_modules/` directories (root + all apps) and ALL `package-lock.json` files (`apps/frontend/package-lock.json`, `apps/mobile/package-lock.json`, `apps/worker/package-lock.json`), then run `npm install` once from root to generate a single clean lock file. Commit the new root `package-lock.json`.
- **Worker deploys via SSH** — The VPS deploy script (`apps/worker/scripts/deploy.sh`) may reference paths relative to the worker directory. Verify it still works after the monorepo migration.

---

## Dependencies

- **Requires:** Nothing — this is infrastructure work independent of any feature
- **Blocks:** Nothing — apps continue to work during and after migration
- **Risk:** Low — structural changes only, no logic changes. Revertible by reverting the PR.
