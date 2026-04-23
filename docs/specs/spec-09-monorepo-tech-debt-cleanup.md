# Monorepo Structure & Technical Debt Cleanup

**Date:** 2026-03-18
**Status:** completed
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

---
---

# Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the repo from 3 independent apps into a proper npm workspaces monorepo with Turborepo, shared DB types, and cleanup of dead artifacts.

**Architecture:** Create a root `package.json` with npm workspaces, add `packages/database/` for shared Supabase types/migrations/edge functions, wire Turborepo for cached parallel builds, consolidate CI, and clean dead weight.

**Tech Stack:** npm workspaces, Turborepo 2, TypeScript, Supabase CLI, GitHub Actions

---

## Chunk 1: Foundation — Root Package, Renames, Turborepo

### Task 1: Create root `package.json` with workspaces

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create root package.json**

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
    "test:run": "turbo run test:run",
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

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add root package.json with npm workspaces and Turborepo"
```

---

### Task 2: Rename app packages

**Files:**
- Modify: `apps/frontend/package.json` (line 2: `"name"`)
- Modify: `apps/mobile/package.json` (line 2: `"name"`)

- [ ] **Step 1: Rename frontend**

In `apps/frontend/package.json`, change line 2:
```json
"name": "@aureon/frontend",
```

- [ ] **Step 2: Rename mobile**

In `apps/mobile/package.json`, change line 2:
```json
"name": "@aureon/mobile",
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/package.json apps/mobile/package.json
git commit -m "chore: rename packages to @aureon/frontend, @aureon/mobile"
```

---

### Task 3: Harmonize script names across apps

**Files:**
- Modify: `apps/worker/package.json` (rename `typecheck` → `type-check`, add `lint`)
- Modify: `apps/mobile/package.json` (add `type-check`, `test`, `test:run`)

- [ ] **Step 1: Fix worker scripts**

In `apps/worker/package.json`, in `"scripts"`:
- Rename `"typecheck"` to `"type-check"`
- Add `"lint": "echo 'no linter configured'"`
- Add `"test:run": "vitest run"`

Result:
```json
"scripts": {
  "build": "tsc",
  "start": "node dist/index.js",
  "dev": "ts-node src/index.ts",
  "type-check": "tsc --noEmit",
  "lint": "echo 'no linter configured'",
  "test": "vitest run",
  "test:run": "vitest run",
  "test:watch": "vitest --watch"
}
```

- [ ] **Step 2: Add missing mobile scripts**

In `apps/mobile/package.json`, add to `"scripts"`:
```json
"type-check": "tsc --noEmit",
"test": "echo 'no tests configured'",
"test:run": "echo 'no tests configured'"
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/package.json apps/mobile/package.json
git commit -m "chore: harmonize script names across all apps for Turborepo"
```

---

### Task 4: Create `turbo.json`

**Files:**
- Create: `turbo.json`

- [ ] **Step 1: Create turbo.json**

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

- [ ] **Step 2: Add `.turbo` to `.gitignore`**

Append to `.gitignore`:
```
# Turborepo
.turbo
```

- [ ] **Step 3: Commit**

```bash
git add turbo.json .gitignore
git commit -m "chore: add Turborepo config"
```

---

### Task 5: Clean lock files and install from root

**Files:**
- Delete: `apps/frontend/package-lock.json`
- Delete: `apps/mobile/package-lock.json`
- Delete: `apps/worker/package-lock.json`
- Create: `package-lock.json` (root, auto-generated)

- [ ] **Step 1: Delete all per-app lock files and node_modules**

```bash
rm -rf apps/frontend/package-lock.json apps/mobile/package-lock.json apps/worker/package-lock.json
rm -rf node_modules apps/frontend/node_modules apps/mobile/node_modules apps/worker/node_modules
```

- [ ] **Step 2: Install from root**

```bash
npm install
```

Expected: single `package-lock.json` at root, single `node_modules/` at root with symlinks for workspace packages.

- [ ] **Step 3: Verify Turborepo works**

```bash
npx turbo run type-check
```

Expected: runs `type-check` for frontend, mobile, and worker in parallel.

- [ ] **Step 4: Commit**

```bash
git add package-lock.json
git rm apps/frontend/package-lock.json apps/mobile/package-lock.json apps/worker/package-lock.json 2>/dev/null || true
git commit -m "chore: consolidate to single root package-lock.json"
```

---

## Chunk 2: Shared Database Package

### Task 6: Create `packages/database/` scaffold

**Files:**
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/src/index.ts`
- Create: `packages/database/src/enums.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@aureon/database",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "generate-types": "supabase gen types typescript --project-id $SUPABASE_PROJECT_REF > src/database.types.ts",
    "build": "tsc --noEmit",
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "supabase": "^2.76.6",
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "supabase"]
}
```

- [ ] **Step 3: Create enums.ts**

```typescript
// Shared status and role constants — single source of truth
// These must match the DB enum values exactly.

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

- [ ] **Step 4: Create index.ts**

```typescript
export * from './enums';
// database.types.ts will be added after generating types
```

- [ ] **Step 5: Commit**

```bash
git add packages/database/
git commit -m "feat: create packages/database scaffold with shared enums"
```

---

### Task 7: Move Supabase folder to `packages/database/`

**Files:**
- Move: `apps/frontend/supabase/` → `packages/database/supabase/`

- [ ] **Step 1: Move the entire supabase directory (preserving git history)**

```bash
git mv apps/frontend/supabase packages/database/supabase
```

- [ ] **Step 2: Verify the move**

```bash
ls packages/database/supabase/migrations/ | head -5
ls packages/database/supabase/functions/
ls packages/database/supabase/config.toml
```

Expected: migrations, functions (beetrack-webhook, dispatchtrack-route-poll), and config.toml all present.

- [ ] **Step 3: Update frontend tsconfig.json exclude**

In `apps/frontend/tsconfig.json`, remove `"supabase/functions/**"` from the `exclude` array (the folder no longer exists here).

Change:
```json
"exclude": ["node_modules", "__tests__/**", "**/*.test.ts", "**/*.test.tsx", "supabase/functions/**", "vitest.config.ts", "playwright.config.ts"]
```
To:
```json
"exclude": ["node_modules", "__tests__/**", "**/*.test.ts", "**/*.test.tsx", "vitest.config.ts", "playwright.config.ts"]
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move supabase/ (migrations, functions, config) to packages/database/"
```

---

### Task 8: Generate shared Supabase types

**Files:**
- Create: `packages/database/src/database.types.ts`
- Modify: `packages/database/src/index.ts`

- [ ] **Step 1: Generate types**

```bash
cd packages/database
SUPABASE_PROJECT_REF=wfwlcpnkkxxzdvhvvsxb npx supabase gen types typescript --project-id wfwlcpnkkxxzdvhvvsxb > src/database.types.ts
```

- [ ] **Step 2: Update index.ts to re-export types**

```typescript
export * from './enums';
export type { Database } from './database.types';
```

- [ ] **Step 3: Verify type-check passes**

```bash
cd ../.. && npx turbo run type-check --filter=@aureon/database
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/
git commit -m "feat: generate shared Supabase types in packages/database"
```

---

### Task 9: Wire frontend to use `@aureon/database`

**Files:**
- Modify: `apps/frontend/package.json` (add dependency)
- Modify: `apps/frontend/next.config.ts` (add `transpilePackages`)

- [ ] **Step 1: Add dependency to frontend**

In `apps/frontend/package.json`, add to `"dependencies"`:
```json
"@aureon/database": "*"
```

- [ ] **Step 2: Add `transpilePackages` to next.config.ts**

In `apps/frontend/next.config.ts`, update the `nextConfig` object:

```typescript
const nextConfig: NextConfig = {
  transpilePackages: ['@aureon/database'],
};
```

- [ ] **Step 3: Run npm install to update symlinks**

```bash
npm install
```

- [ ] **Step 4: Verify frontend builds**

```bash
npx turbo run build --filter=@aureon/frontend
```

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/package.json apps/frontend/next.config.ts package-lock.json
git commit -m "feat: wire frontend to import from @aureon/database"
```

---

### Task 10: Wire mobile to use `@aureon/database` + Metro config

**Files:**
- Modify: `apps/mobile/package.json` (add dependency)
- Create: `apps/mobile/metro.config.js`

- [ ] **Step 1: Add dependency to mobile**

In `apps/mobile/package.json`, add to `"dependencies"`:
```json
"@aureon/database": "*"
```

- [ ] **Step 2: Create metro.config.js for workspace support**

Create `apps/mobile/metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the entire monorepo for changes
config.watchFolders = [monorepoRoot];

// Resolve modules from both the app and the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
```

- [ ] **Step 3: Run npm install**

```bash
npm install
```

- [ ] **Step 4: Verify mobile starts (quick smoke test)**

```bash
cd apps/mobile && npx expo start --web --no-open &
sleep 10 && kill %1
```

If Expo starts without "Cannot resolve module @aureon/database" errors, it works.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/metro.config.js package-lock.json
git commit -m "feat: wire mobile to @aureon/database with Metro workspace config"
```

---

## Chunk 3: CI Consolidation & Deploy Updates

### Task 11: Consolidate CI workflows

**Files:**
- Modify: `.github/workflows/ci.yml` (rewrite to use Turborepo)
- Delete: `.github/workflows/test.yml` (merged into ci.yml)

- [ ] **Step 1: Rewrite ci.yml**

Replace `.github/workflows/ci.yml` entirely:

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: ['**']

jobs:
  ci:
    name: Lint, Type-Check, Test, Build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npx turbo run lint

      - name: Type check
        run: npx turbo run type-check

      - name: Test
        run: npx turbo run test:run

      - name: Build
        run: npx turbo run build
```

- [ ] **Step 2: Delete test.yml**

```bash
git rm .github/workflows/test.yml
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: consolidate ci.yml + test.yml into single Turborepo pipeline"
```

---

### Task 12: Update deploy.yml working directories

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Update deploy-supabase job**

Change `working-directory` from `apps/frontend` to `packages/database`:

```yaml
  deploy-supabase:
    name: Deploy Supabase Migrations
    runs-on: ubuntu-latest
    timeout-minutes: 5
    defaults:
      run:
        working-directory: packages/database
```

- [ ] **Step 2: Update deploy-edge-functions job**

Same change:

```yaml
  deploy-edge-functions:
    name: Deploy Supabase Edge Functions
    needs: deploy-supabase
    runs-on: ubuntu-latest
    timeout-minutes: 5
    defaults:
      run:
        working-directory: packages/database
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: update deploy.yml to use packages/database for Supabase commands"
```

---

## Chunk 4: Cleanup

### Task 13: Delete `_bmad-output/`

**Files:**
- Delete: `_bmad-output/` (entire directory)

- [ ] **Step 1: Remove from git**

```bash
git rm -r _bmad-output/
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: delete _bmad-output/ legacy planning artifacts"
```

---

### Task 14: Clean up mobile `app.json` template names

**Files:**
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Update all template references**

In `apps/mobile/app.json`, change:
- `"name"`: `"RAZ Supabase Expo Template"` → `"Aureon Last Mile"`
- `"slug"`: `"supabase-expo-template"` → `"aureon-last-mile"`
- `"scheme"`: `"supabaseexpotemplate"` → `"aureon"`
- `"ios.bundleIdentifier"`: `"com.razikus.supabase-expo-template"` → `"com.tractis.aureon"`
- `"android.package"`: `"com.razikus.supabaseexpotemplate"` → `"com.tractis.aureon"`

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app.json
git commit -m "chore: replace template names in mobile app.json with Aureon branding"
```

---

### Task 15: Audit and remove unused dependencies

**Files:**
- Modify: `apps/frontend/package.json` (remove Paddle if unused)

- [ ] **Step 1: Check if Paddle is imported anywhere**

```bash
grep -r "paddle" apps/frontend/src/ --include="*.ts" --include="*.tsx" -l
```

If no results → Paddle is unused. Remove from `apps/frontend/package.json`:
- `"@paddle/paddle-js": "^1.3.3"`
- `"@paddle/paddle-node-sdk": "^2.3.2"`

- [ ] **Step 2: Reinstall**

```bash
npm install
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/package.json package-lock.json
git commit -m "chore: remove unused Paddle payment SDK from frontend"
```

---

### Task 16: Clean merged git branches

- [ ] **Step 1: Delete local branches that are merged into main**

```bash
git branch --merged main | grep -v main | grep -v '\*' | xargs git branch -d
```

This is local-only and safe — these branches are already merged.

---

### Task 17: Final verification

- [ ] **Step 1: Full Turborepo check from root**

```bash
npm run type-check
npm run lint
npm run test:run
npm run build
```

All four must pass.

- [ ] **Step 2: Verify Supabase CLI still works**

```bash
cd packages/database
npx supabase link --project-ref wfwlcpnkkxxzdvhvvsxb
npx supabase db diff
```

Should show no diff (migrations are intact).

- [ ] **Step 3: Push and create PR**

```bash
git push origin <branch-name>
gh pr create --title "refactor: monorepo structure with npm workspaces + Turborepo" --body "Spec: docs/specs/spec-09-monorepo-tech-debt-cleanup.md"
gh pr merge --auto --squash
```

- [ ] **Step 4: Wait for CI to pass and confirm merge**

```bash
gh pr checks <N> --watch
gh pr view <N> --json state,mergedAt
```
