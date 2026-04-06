# Code Quality & Technical Debt Cleanup

**Status:** in progress

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the highest-impact technical debt identified in the March 2026 audit — dead code, oversized files, duplicate components, and missing test coverage — without changing any user-visible behavior.

**Architecture:** This is a pure refactor sprint. No new features, no API changes, no schema changes. Every chunk is independently deployable (no inter-dependencies between chunks). CI must stay green throughout. Where refactors touch imports, the barrel re-export pattern preserves backward compatibility.

**Tech Stack:** TypeScript, Next.js 15 App Router, Vitest, TanStack Query v5, Supabase, BullMQ

---

## Scope (from spec-28 audit, 2026-03-30)

Items included:

| ID | Item | Files |
|----|------|-------|
| H1 | `lib/types.ts` is a 1702-line Supabase-generated duplicate; `packages/database` already has the source of truth | `src/lib/types.ts` |
| H2 | `useDashboardMetrics.ts` (649 lines) bundles 12+ unrelated hooks | `src/hooks/useDashboardMetrics.ts` |
| H3 | `wa-routing.test.ts` cross-app import (forbidden by architecture rules) | `apps/agents/src/orchestration/wa-routing.test.ts` |
| H4 | `extract-document.ts` stub self-documents it should be deleted | `apps/agents/src/tools/ocr/extract-document.ts` |
| H5 | `workers-handlers.test.ts` has no implementation counterpart | `apps/agents/src/orchestration/workers-handlers.test.ts` |
| M1 | `groq.ts`, `claude.ts` providers unreachable; `@ai-sdk/anthropic`, `@ai-sdk/groq` installed but unused | `apps/agents/src/providers/` |
| M2 | Duplicate `AuditLogFilters` + `AuditLogTable` in `components/admin/` and `components/audit/` | `src/components/admin/`, `src/components/audit/` |
| M5 | 5 hooks have zero test coverage | `src/hooks/` |
| M7 | Compiled JS/TS `.d.ts`/`.js.map` artifacts in source control | `supabase/functions/whatsapp-webhook/` |
| L1 | `src/utils/` and `src/stores/` exist alongside `src/lib/utils/` and `src/lib/stores/` | `src/utils/`, `src/stores/` |
| L7 | 19 orphaned git worktrees on disk | `.worktrees/` |

Items explicitly excluded (not worth the churn): M3/M4 borderline file sizes, L2 TypeScript `any`, L3 eslint-disable, L4 agents linter, L5 hardcoded constants, L6 offline sync stub, L8 Slack notification stub.

---

## File Map

### Chunk 1 — Dead Code & Quick Wins

| Action | Path |
|--------|------|
| DELETE | `apps/agents/src/tools/ocr/extract-document.ts` |
| DELETE | `apps/agents/src/orchestration/workers-handlers.test.ts` |
| DELETE | `apps/agents/src/providers/groq.ts` |
| DELETE | `apps/agents/src/providers/groq.test.ts` |
| DELETE | `apps/agents/src/providers/claude.ts` |
| DELETE | `apps/agents/src/providers/claude.test.ts` |
| MODIFY | `apps/agents/src/providers/provider-registry.ts` — remove groq/claude imports and switch cases |
| MODIFY | `apps/agents/src/providers/provider-registry.test.ts` — remove groq/claude test cases |
| MODIFY | `apps/agents/src/config.ts` — remove `ANTHROPIC_API_KEY` and `GROQ_API_KEY` |
| MODIFY | `apps/agents/src/config.test.ts` — remove tests for removed keys |
| MODIFY | `apps/agents/package.json` — remove `@ai-sdk/anthropic`, `@ai-sdk/groq` |
| MODIFY | `apps/frontend/supabase/functions/whatsapp-webhook/.gitignore` (create) — ignore compiled artifacts |
| MODIFY | `.gitignore` (root) — add pattern for supabase function compiled output |
| DELETE | `apps/agents/src/orchestration/wa-routing.test.ts` (cross-app import; see note) |
| SHELL | `git worktree remove` for each stale worktree in `.worktrees/` |

> **wa-routing.test.ts note:** The test cross-imports `apps/frontend/supabase/functions/whatsapp-webhook/routing.ts`, which violates the monorepo cross-app import rule. The routing logic is already tested by Deno's own edge function test context. Delete the agents-side test rather than copying the logic, since it adds no coverage beyond what the edge function tests already provide.

### Chunk 2 — Type File Re-routing (H1)

`packages/database/src/` already exports `Database` and `Json` via `@aureon/database`. The fix is to:
1. Confirm `packages/database/src/database.types.ts` is the source of truth
2. Replace `apps/frontend/src/lib/types.ts` (1702 lines, auto-generated copy) with a 2-line re-export barrel pointing at `@aureon/database`
3. Verify all files importing from `@/lib/types` still compile (barrel re-export means no import changes needed)

| Action | Path |
|--------|------|
| OVERWRITE | `apps/frontend/src/lib/types.ts` → 2-line re-export barrel |
| VERIFY | `apps/frontend/src/app/app/table/page.tsx` |
| VERIFY | `apps/frontend/src/hooks/useDashboardMetrics.ts` |
| VERIFY | `apps/frontend/src/hooks/useOrders.ts` |
| VERIFY | `apps/frontend/src/lib/supabase/client.ts` |
| VERIFY | `apps/frontend/src/lib/supabase/server.ts` |
| VERIFY | `apps/frontend/src/lib/supabase/serverAdminClient.ts` |
| VERIFY | `apps/frontend/src/lib/supabase/unified.ts` |

### Chunk 3 — Dashboard Metrics Hook Split (H2)

Split `useDashboardMetrics.ts` (649 lines, 12+ hooks) into domain files. Barrel re-export preserves all existing import paths.

| Action | Path | Contents |
|--------|------|----------|
| CREATE | `src/hooks/dashboard/useSlaMetrics.ts` | `useSlaMetric`, `useSlaPreviousPeriod` |
| CREATE | `src/hooks/dashboard/useFadrMetrics.ts` | `useFadrMetric`, `useFadrSummary`, `useFadrDailySeries`, `useFadrPreviousPeriod` |
| CREATE | `src/hooks/dashboard/useOrdersMetrics.ts` | `usePerformanceMetricsSummary`, `useShortageClaimsMetric`, `useAvgDeliveryTimeMetric`, `useDailyMetricsSeries`, `useClaimsPreviousPeriod`, `useDeliveryTimePreviousPeriod` + shared types |
| CREATE | `src/hooks/dashboard/useCustomerPerformance.ts` | `useCustomerPerformance`, `CustomerPerformanceRow` |
| CREATE | `src/hooks/dashboard/useSecondaryMetrics.ts` | `useSecondaryMetrics`, `useSecondaryMetricsPreviousPeriod`, `SecondaryMetrics`, `fetchSecondaryMetrics` |
| CREATE | `src/hooks/dashboard/useFailureReasons.ts` | `useFailureReasons`, `FailureReasonRow` |
| CREATE | `src/hooks/dashboard/useExportData.ts` | `useExportData`, `DashboardExportData` |
| CREATE | `src/hooks/dashboard/constants.ts` | `DASHBOARD_QUERY_OPTIONS`, `DAILY_CAPACITY`, `OPERATIONAL_HOURS` |
| OVERWRITE | `src/hooks/useDashboardMetrics.ts` | Barrel re-export of all above (preserves existing imports) |

### Chunk 4 — AuditLog Component Consolidation (M2)

Two parallel AuditLog implementations exist. Consolidate `admin/` versions to use `audit/` components.

| Action | Path |
|--------|------|
| READ & DIFF | `src/components/admin/AuditLogFilters.tsx` vs `src/components/audit/AuditLogFilters.tsx` |
| READ & DIFF | `src/components/admin/AuditLogTable.tsx` vs `src/components/audit/AuditLogTable.tsx` |
| MODIFY | `src/app/admin/audit-logs/AuditLogsPageClient.tsx` — switch imports to `audit/` |
| DELETE | `src/components/admin/AuditLogFilters.tsx` |
| DELETE | `src/components/admin/AuditLogTable.tsx` |

### Chunk 5 — Missing Hook Tests (M5)

Five hooks have zero test coverage, violating TDD rules.

| Action | Path |
|--------|------|
| CREATE | `src/hooks/dispatch/useRoutePackages.test.ts` |
| CREATE | `src/hooks/pickup/useDiscrepancies.test.ts` |
| CREATE | `src/hooks/useAuditLogs.test.ts` |
| CREATE | `src/hooks/useDashboardDates.test.ts` |
| CREATE | `src/hooks/useOperatorId.test.ts` |

### Chunk 6 — Directory Structure Cleanup (L1)

| Action | Path |
|--------|------|
| MOVE | `src/utils/generateColorRamp.ts` → `src/lib/utils/generateColorRamp.ts` |
| MOVE | `src/utils/generateColorRamp.test.ts` → `src/lib/utils/generateColorRamp.test.ts` |
| DELETE | `src/utils/` directory (now empty) |
| MOVE | `src/stores/adminStore.ts` → `src/lib/stores/adminStore.ts` |
| MOVE | `src/stores/useOpsControlFilterStore.ts` → `src/lib/stores/useOpsControlFilterStore.ts` |
| MOVE | `src/stores/useOpsControlFilterStore.test.ts` → `src/lib/stores/useOpsControlFilterStore.test.ts` |
| DELETE | `src/stores/` directory (now empty) |
| GREP & FIX | All files importing from `@/utils/` or `@/stores/` |

---

## Chunk 1: Dead Code & Quick Wins

### Task 1: Delete extract-document.ts stub (H4)

**Files:**
- Delete: `apps/agents/src/tools/ocr/extract-document.ts`

- [ ] **Step 1: Confirm no imports**

```bash
grep -rn "extract-document" apps/agents/src --include="*.ts" | grep -v ".test."
```

Expected output: no lines (the file is imported by nothing live).

- [ ] **Step 2: Delete the file**

```bash
rm apps/agents/src/tools/ocr/extract-document.ts
```

- [ ] **Step 3: Run agents tests to confirm nothing broke**

```bash
cd apps/agents && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(agents): delete extract-document.ts stub — replaced by extract-manifest"
```

---

### Task 2: Delete workers-handlers.test.ts orphan (H5)

**Files:**
- Delete: `apps/agents/src/orchestration/workers-handlers.test.ts`

- [ ] **Step 1: Confirm no implementation file exists**

```bash
ls apps/agents/src/orchestration/workers-handlers.ts 2>&1
```

Expected: `No such file or directory`

- [ ] **Step 2: Delete the orphan test**

```bash
rm apps/agents/src/orchestration/workers-handlers.test.ts
```

- [ ] **Step 3: Run agents tests**

```bash
cd apps/agents && npm test
```

Expected: all tests pass (one fewer test file in suite).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(agents): delete orphaned workers-handlers.test.ts (no implementation)"
```

---

### Task 3: Delete cross-app wa-routing.test.ts (H3)

**Files:**
- Delete: `apps/agents/src/orchestration/wa-routing.test.ts`

**Rationale:** This test cross-imports `apps/frontend/supabase/functions/whatsapp-webhook/routing.ts` using a `// @ts-ignore` comment — a direct violation of the monorepo cross-app import rule. The routing helpers are already covered by their co-located edge-function tests (Deno runtime). Deleting removes the violation without losing coverage.

- [ ] **Step 1: Verify nothing else references this file**

```bash
grep -rn "wa-routing" apps/agents/src --include="*.ts" | grep -v "wa-routing.test.ts"
```

Expected: no output. If any file imports from `wa-routing.test.ts`, stop and investigate before deleting.

- [ ] **Step 2: Delete the file**

```bash
rm apps/agents/src/orchestration/wa-routing.test.ts
```

- [ ] **Step 2: Run agents tests**

```bash
cd apps/agents && npm test
```

Expected: all remaining tests pass.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(agents): delete wa-routing.test.ts — cross-app import violation, coverage belongs to edge function"
```

---

### Task 4: Remove dead Groq and Claude providers (M1)

**Files:**
- Read first: `apps/agents/src/providers/provider-registry.ts`
- Read first: `apps/agents/src/providers/provider-registry.test.ts`
- Read first: `apps/agents/src/config.ts`
- Read first: `apps/agents/src/config.test.ts`
- Delete: `apps/agents/src/providers/groq.ts`
- Delete: `apps/agents/src/providers/claude.ts`
- Modify: `apps/agents/src/providers/provider-registry.ts`
- Modify: `apps/agents/src/providers/provider-registry.test.ts`
- Modify: `apps/agents/src/config.ts`
- Modify: `apps/agents/src/config.test.ts`

**Context:** Memory confirms decision to use OpenRouter-only for all agents. `GroqProvider` and `ClaudeProvider` are registered in `provider-registry.ts` but no real agent ever calls them with `"groq:*"` or `"claude:*"` model strings. `ANTHROPIC_API_KEY` and `GROQ_API_KEY` are optional in config but referenced by nothing real.

- [ ] **Step 1: Verify nothing uses groq or claude prefixes in real agent code**

```bash
grep -rn "\"groq:\|\"claude:" apps/agents/src --include="*.ts" | grep -v ".test." | grep -v "provider-registry"
```

Expected: no output.

- [ ] **Step 2: Read provider-registry.ts and its test**

Read both files to understand what to change.

- [ ] **Step 3: Update provider-registry.ts**

Remove the `ClaudeProvider` and `GroqProvider` imports, and their `case` blocks. Updated file should look like:

```typescript
// src/providers/provider-registry.ts
import { OpenRouterProvider } from './openrouter';
import type { LLMProvider } from './types';

export interface ProviderRegistryConfig {
  openrouterApiKey: string;
}

export class ProviderRegistry {
  private readonly config: ProviderRegistryConfig;
  private readonly cache = new Map<string, LLMProvider>();

  constructor(config: ProviderRegistryConfig) {
    this.config = config;
  }

  getProvider(modelName: string): LLMProvider {
    if (this.cache.has(modelName)) {
      return this.cache.get(modelName)!;
    }

    const colonIndex = modelName.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Unknown provider prefix in model name: "${modelName}"`);
    }

    const prefix = modelName.slice(0, colonIndex);
    const model = modelName.slice(colonIndex + 1);

    let provider: LLMProvider;
    switch (prefix) {
      case 'openrouter':
        provider = new OpenRouterProvider(this.config.openrouterApiKey, model);
        break;
      default:
        throw new Error(`Unknown provider prefix: "${prefix}". Supported: openrouter`);
    }

    this.cache.set(modelName, provider);
    return provider;
  }
}
```

- [ ] **Step 4: Update provider-registry.test.ts**

Remove all test cases for groq/claude prefixes. Keep openrouter tests and the "unknown prefix" error test.

- [ ] **Step 5: Run tests to confirm the registry still works**

```bash
cd apps/agents && npm test -- --reporter=verbose 2>&1 | grep "provider-registry"
```

Expected: provider-registry tests pass.

- [ ] **Step 6: Update config.ts — remove optional legacy keys**

Remove `ANTHROPIC_API_KEY` and `GROQ_API_KEY` from the Zod schema and the `ProviderRegistryConfig`. Updated relevant portion:

```typescript
const configSchema = z.object({
  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  SENTRY_DSN: z.string().min(1),
  BETTERSTACK_HEARTBEAT_URL: z.string().optional(),
  WA_PHONE_NUMBER_ID: z.string().optional(),
  WA_ACCESS_TOKEN: z.string().optional(),
  WA_VERIFY_TOKEN: z.string().optional(),
  WA_APP_SECRET: z.string().optional(),
});
```

- [ ] **Step 7: Update config.test.ts**

Remove test assertions for `ANTHROPIC_API_KEY` and `GROQ_API_KEY`.

- [ ] **Step 8: Delete groq.ts, claude.ts, and their test files**

```bash
rm apps/agents/src/providers/groq.ts apps/agents/src/providers/groq.test.ts
rm apps/agents/src/providers/claude.ts apps/agents/src/providers/claude.test.ts
```

- [ ] **Step 9: Run full agents test suite**

```bash
cd apps/agents && npm test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore(agents): remove dead groq/claude providers — openrouter-only per project decision"
```

---

### Task 5: Remove unused @ai-sdk/anthropic and @ai-sdk/groq deps (M1 cont.)

**Files:**
- Modify: `apps/agents/package.json`

- [ ] **Step 1: Remove the packages**

```bash
cd apps/agents && npm uninstall @ai-sdk/anthropic @ai-sdk/groq
```

- [ ] **Step 2: Verify build still compiles**

```bash
cd apps/agents && npm run type-check
```

Expected: exits 0, no errors.

- [ ] **Step 3: Run tests**

```bash
cd apps/agents && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/agents/package.json apps/agents/package-lock.json
git commit -m "chore(agents): uninstall @ai-sdk/anthropic and @ai-sdk/groq — unused since OpenRouter migration"
```

---

### Task 6: Fix .gitignore for compiled supabase function artifacts (M7)

**Files:**
- Create: `apps/frontend/supabase/functions/whatsapp-webhook/.gitignore`

The git status shows `routing.js`, `routing.js.map`, `routing.d.ts`, `routing.d.ts.map` as untracked files. These are TypeScript compilation artifacts that must never be committed.

- [ ] **Step 1: Create the .gitignore**

Create `apps/frontend/supabase/functions/whatsapp-webhook/.gitignore`:

```
# Compiled TypeScript output from routing.ts — never commit these
# Using specific filenames (not *.js) to avoid accidentally ignoring hand-authored .d.ts files
routing.js
routing.js.map
routing.d.ts
routing.d.ts.map
```

- [ ] **Step 2: Verify the files are now ignored**

```bash
git status apps/frontend/supabase/functions/whatsapp-webhook/
```

Expected: only `routing.ts` and `index.ts` shown as tracked or untracked; `.js`/`.map`/`.d.ts` files are ignored.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/supabase/functions/whatsapp-webhook/.gitignore
git commit -m "chore: gitignore compiled artifacts in whatsapp-webhook edge function"
```

---

### Task 7: Clean up orphaned git worktrees (L7)

- [ ] **Step 1: Discover actual worktrees on disk**

```bash
git worktree list
```

If the output shows only the main working tree (no `.worktrees/` paths), this task is a no-op — skip to Step 4. Git worktrees may already have been pruned in a previous session.

If worktrees do appear, note each path. Do NOT assume the paths listed in the audit are still present.

- [ ] **Step 2: Check each worktree for uncommitted changes before removal**

For each worktree path shown by `git worktree list` (excluding the main tree and any active feature branch):

```bash
git -C <worktree-path> status
```

Expected: `nothing to commit, working tree clean`. If a worktree has uncommitted changes, confirm those changes are already pushed to the remote branch before removing.

- [ ] **Step 3: Remove confirmed-safe orphaned worktrees**

For each worktree confirmed clean in Step 2:

```bash
git worktree remove <worktree-path> --force
```

> Note: the command is `git worktree` (no trailing `s`). Run once per orphaned path.

- [ ] **Step 4: Prune stale metadata**

```bash
git worktree prune
git worktree list
```

Expected: only the main working tree (and any active feature worktree) remain. No commit needed — `git worktree prune` only modifies `.git/` internals.

---

## Chunk 2: Type File Re-routing (H1)

### Task 8: Replace lib/types.ts with a re-export barrel

**Files:**
- Read: `packages/database/src/database.types.ts` (first 20 lines — verify it has `Database` and `Json`)
- Read: `packages/database/src/index.ts`
- Overwrite: `apps/frontend/src/lib/types.ts`

**Context:** `lib/types.ts` (1702 lines) is an auto-generated Supabase types file — a copy of what already lives in `packages/database/src/database.types.ts`. The `packages/database` package is already declared as a dependency in `apps/frontend/package.json` and transpiled in `next.config.ts`. The fix is to replace the 1702-line duplicate with a 2-line barrel that re-exports from the source of truth.

- [ ] **Step 1: Verify packages/database exports what we need**

```bash
grep -n "Database\|Json" packages/database/src/index.ts
grep -c "export type" packages/database/src/database.types.ts
```

Expected: `index.ts` exports `Database` and `Json`; `database.types.ts` has many exported types.

- [ ] **Step 2: Discover all files importing from @/lib/types**

```bash
grep -rn "from '@/lib/types'" apps/frontend/src --include="*.ts" --include="*.tsx"
```

Note the full list. The barrel re-export means no import changes are required — all existing `@/lib/types` imports will continue to resolve through the barrel. Expected importers include: `table/page.tsx`, `useDashboardMetrics.ts`, `useOrders.ts`, and the supabase client files (`client.ts`, `server.ts`, `serverAdminClient.ts`, `unified.ts`). If additional importers appear, they are also fine — no changes needed.

- [ ] **Step 3: Overwrite lib/types.ts with a re-export barrel**

Replace the entire 1702-line file with:

```typescript
// Re-exports from @aureon/database — source of truth for all Supabase types.
// This file exists for backward compatibility with legacy `@/lib/types` import paths.
// Prefer importing directly from `@aureon/database` in new code.
export type { Database, Json } from '@aureon/database';
```

- [ ] **Step 4: Run TypeScript type-check**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: exits 0 with no errors.

- [ ] **Step 5: Run frontend tests**

```bash
cd apps/frontend && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/types.ts
git commit -m "refactor(frontend): replace 1702-line duplicate types.ts with re-export barrel from @aureon/database"
```

---

## Chunk 3: Dashboard Metrics Hook Split (H2)

### Task 9: Create the hooks/dashboard/ directory structure

**Files:**
- Create: `src/hooks/dashboard/constants.ts`
- Create: `src/hooks/dashboard/useSlaMetrics.ts`
- Create: `src/hooks/dashboard/useFadrMetrics.ts`
- Create: `src/hooks/dashboard/useOrdersMetrics.ts`
- Create: `src/hooks/dashboard/useCustomerPerformance.ts`
- Create: `src/hooks/dashboard/useSecondaryMetrics.ts`
- Create: `src/hooks/dashboard/useFailureReasons.ts`
- Create: `src/hooks/dashboard/useExportData.ts`
- Overwrite: `src/hooks/useDashboardMetrics.ts` (barrel re-export)
- Modify: `src/hooks/useDashboardMetrics.test.ts` (update import path if needed)

**TDD anchor:** This is a pure code movement (no logic changes). The existing `useDashboardMetrics.test.ts` is the failing-test anchor — it will break the moment you overwrite `useDashboardMetrics.ts` in Step 10. The correct flow is: create all domain files (Steps 2–9) → overwrite barrel (Step 10) → run tests (Step 12). Do NOT overwrite the barrel before the domain files exist.

**Before starting:** Read the full `useDashboardMetrics.ts` to understand boundaries between hooks. The file uses `// === Story X.X hooks ===` comments as natural split points.

- [ ] **Step 1: Read the full current useDashboardMetrics.ts**

Read `apps/frontend/src/hooks/useDashboardMetrics.ts` (all 649 lines).

- [ ] **Step 2: Create constants.ts**

```typescript
// src/hooks/dashboard/constants.ts
import { keepPreviousData } from '@tanstack/react-query';

export const DASHBOARD_QUERY_OPTIONS = {
  staleTime: 30000,
  refetchInterval: 60000,
  placeholderData: keepPreviousData,
} as const;

export const DAILY_CAPACITY = 1000; // TODO: make configurable via settings (spec-28 L5)
export const OPERATIONAL_HOURS = 10; // TODO: make configurable via settings (spec-28 L5)
```

- [ ] **Step 3: Create useSlaMetrics.ts**

Move `useSlaMetric` and `useSlaPreviousPeriod` here. Both use `SlaArgs` from `Database['public']['Functions']`.

```typescript
// src/hooks/dashboard/useSlaMetrics.ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@aureon/database';
import { DASHBOARD_QUERY_OPTIONS } from './constants';

type SlaArgs = Database['public']['Functions']['calculate_sla']['Args'];

export function useSlaMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'sla', startDate, endDate],
    queryFn: async () => {
      const args: SlaArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_sla', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useSlaPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'sla-prev', startDate, endDate],
    queryFn: async () => {
      const args: SlaArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_sla', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
```

- [ ] **Step 4: Create useFadrMetrics.ts**

Move `useFadrMetric`, `useFadrSummary`, `useFadrDailySeries`, `useFadrPreviousPeriod`.

```typescript
// src/hooks/dashboard/useFadrMetrics.ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@aureon/database';
import { DASHBOARD_QUERY_OPTIONS } from './constants';
import type { DailyMetricPoint } from './useOrdersMetrics';

type FadrArgs = Database['public']['Functions']['calculate_fadr']['Args'];

export function useFadrMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'fadr', startDate, endDate],
    queryFn: async () => {
      const args: FadrArgs = { p_operator_id: operatorId!, p_start_date: startDate, p_end_date: endDate };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_fadr', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrSummary(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'fadr-summary', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('first_attempt_deliveries, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const rows = data as { first_attempt_deliveries: number; total_orders: number }[];
      const totalFa = rows.reduce((sum, r) => sum + (r.first_attempt_deliveries ?? 0), 0);
      const totalOrders = rows.reduce((sum, r) => sum + (r.total_orders ?? 0), 0);
      return { firstAttempt: totalFa, total: totalOrders };
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrDailySeries(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'daily-series', 'fadr-pct', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('metric_date, first_attempt_deliveries, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null)
        .order('metric_date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => {
        const fa = (row.first_attempt_deliveries as number) ?? 0;
        const total = (row.total_orders as number) ?? 0;
        return { date: row.metric_date as string, value: total > 0 ? (fa / total) * 100 : 0 };
      }) as DailyMetricPoint[];
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useFadrPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'fadr-prev', startDate, endDate],
    queryFn: async () => {
      const args: FadrArgs = { p_operator_id: operatorId!, p_start_date: startDate, p_end_date: endDate };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('calculate_fadr', args);
      if (error) throw error;
      return data as number | null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
```

- [ ] **Step 5: Create useOrdersMetrics.ts**

Move `usePerformanceMetricsSummary`, `useShortageClaimsMetric`, `useAvgDeliveryTimeMetric`, `useDailyMetricsSeries`, `useClaimsPreviousPeriod`, `useDeliveryTimePreviousPeriod` and their types.

```typescript
// src/hooks/dashboard/useOrdersMetrics.ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { DASHBOARD_QUERY_OPTIONS } from './constants';

export type MetricsSummary = {
  totalOrders: number;
  deliveredOrders: number;
  failedDeliveries: number;
} | null;

export type ShortageClaimsMetric = {
  count: number;
  amount: number;
} | null;

export type DailyMetricPoint = {
  date: string;
  value: number;
};

const ALLOWED_METRIC_COLUMNS = [
  'first_attempt_deliveries',
  'shortage_claims_count',
  'shortage_claims_amount_clp',
  'avg_delivery_time_minutes',
  'total_orders',
  'delivered_orders',
  'failed_deliveries',
] as const;

type MetricColumn = (typeof ALLOWED_METRIC_COLUMNS)[number];

export function usePerformanceMetricsSummary(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'performance', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('total_orders, delivered_orders, failed_deliveries')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return (data as { total_orders: number; delivered_orders: number; failed_deliveries: number }[])
        .reduce<NonNullable<MetricsSummary>>(
          (acc, row) => ({
            totalOrders: acc.totalOrders + (row.total_orders ?? 0),
            deliveredOrders: acc.deliveredOrders + (row.delivered_orders ?? 0),
            failedDeliveries: acc.failedDeliveries + (row.failed_deliveries ?? 0),
          }),
          { totalOrders: 0, deliveredOrders: 0, failedDeliveries: 0 }
        );
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useShortageClaimsMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'claims', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('shortage_claims_count, shortage_claims_amount_clp')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return (data as { shortage_claims_count: number; shortage_claims_amount_clp: number }[]).reduce(
        (acc, row) => ({
          count: acc.count + (row.shortage_claims_count ?? 0),
          amount: acc.amount + (row.shortage_claims_amount_clp ?? 0),
        }),
        { count: 0, amount: 0 }
      ) as ShortageClaimsMetric;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useAvgDeliveryTimeMetric(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'avg-delivery-time', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('avg_delivery_time_minutes, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const rows = data as { avg_delivery_time_minutes: number | null; total_orders: number }[];
      let totalTime = 0;
      let totalOrders = 0;
      for (const row of rows) {
        if (row.avg_delivery_time_minutes != null && row.total_orders > 0) {
          totalTime += row.avg_delivery_time_minutes * row.total_orders;
          totalOrders += row.total_orders;
        }
      }
      return totalOrders > 0 ? totalTime / totalOrders : null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useDailyMetricsSeries(
  operatorId: string | null,
  startDate: string,
  endDate: string,
  metricColumn: MetricColumn
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'daily-series', metricColumn, startDate, endDate],
    queryFn: async () => {
      if (!ALLOWED_METRIC_COLUMNS.includes(metricColumn)) {
        throw new Error(`Invalid metric column: ${metricColumn}`);
      }
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select(`metric_date, ${metricColumn}`)
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null)
        .order('metric_date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        date: row.metric_date as string,
        value: (row[metricColumn] as number) ?? 0,
      })) as DailyMetricPoint[];
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useClaimsPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'claims-prev', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('shortage_claims_count, shortage_claims_amount_clp')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return (data as { shortage_claims_count: number; shortage_claims_amount_clp: number }[]).reduce(
        (acc, row) => ({
          count: acc.count + (row.shortage_claims_count ?? 0),
          amount: acc.amount + (row.shortage_claims_amount_clp ?? 0),
        }),
        { count: 0, amount: 0 }
      ) as ShortageClaimsMetric;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useDeliveryTimePreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'avg-delivery-time-prev', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('avg_delivery_time_minutes, total_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const rows = data as { avg_delivery_time_minutes: number | null; total_orders: number }[];
      let totalTime = 0;
      let totalOrders = 0;
      for (const row of rows) {
        if (row.avg_delivery_time_minutes != null && row.total_orders > 0) {
          totalTime += row.avg_delivery_time_minutes * row.total_orders;
          totalOrders += row.total_orders;
        }
      }
      return totalOrders > 0 ? totalTime / totalOrders : null;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
```

- [ ] **Step 6: Create useCustomerPerformance.ts**

```typescript
// src/hooks/dashboard/useCustomerPerformance.ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { DASHBOARD_QUERY_OPTIONS } from './constants';

export type CustomerPerformanceRow = {
  retailer_name: string;
  total_orders: number;
  delivered_orders: number;
  first_attempt_deliveries: number;
  failed_deliveries: number;
  sla_pct: number | null;
  fadr_pct: number | null;
};

export function useCustomerPerformance(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'customer-performance', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('retailer_name, total_orders, delivered_orders, first_attempt_deliveries, failed_deliveries')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .not('retailer_name', 'is', null);
      if (error) throw error;

      type RawRow = { retailer_name: string | null; total_orders: number; delivered_orders: number; first_attempt_deliveries: number; failed_deliveries: number };
      const byRetailer = new Map<string, CustomerPerformanceRow>();
      for (const row of (data ?? []) as RawRow[]) {
        const key = row.retailer_name!;
        const existing = byRetailer.get(key) ?? {
          retailer_name: key,
          total_orders: 0,
          delivered_orders: 0,
          first_attempt_deliveries: 0,
          failed_deliveries: 0,
          sla_pct: null,
          fadr_pct: null,
        };
        existing.total_orders += row.total_orders ?? 0;
        existing.delivered_orders += row.delivered_orders ?? 0;
        existing.first_attempt_deliveries += row.first_attempt_deliveries ?? 0;
        existing.failed_deliveries += row.failed_deliveries ?? 0;
        byRetailer.set(key, existing);
      }

      return Array.from(byRetailer.values()).map(r => ({
        ...r,
        sla_pct: r.total_orders > 0 ? Math.round((r.delivered_orders / r.total_orders) * 1000) / 10 : null,
        fadr_pct: r.total_orders > 0 ? Math.round((r.first_attempt_deliveries / r.total_orders) * 1000) / 10 : null,
      }));
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
```

- [ ] **Step 7: Create useSecondaryMetrics.ts**

Move `SecondaryMetrics`, `fetchSecondaryMetrics`, `useSecondaryMetrics`, `useSecondaryMetricsPreviousPeriod`.

```typescript
// src/hooks/dashboard/useSecondaryMetrics.ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { DASHBOARD_QUERY_OPTIONS, DAILY_CAPACITY, OPERATIONAL_HOURS } from './constants';

export type SecondaryMetrics = {
  capacityPct: number | null;
  capacityTarget: number;
  ordersPerHour: number | null;
  totalOrders: number;
  totalDelivered: number;
  daysInPeriod: number;
  operationalHours: number;
};

async function fetchSecondaryMetrics(
  operatorId: string,
  startDate: string,
  endDate: string
): Promise<SecondaryMetrics> {
  const { data, error } = await createSPAClient()
    .from('performance_metrics')
    .select('total_orders, delivered_orders')
    .eq('operator_id', operatorId)
    .gte('metric_date', startDate)
    .lte('metric_date', endDate)
    .is('retailer_name', null);
  if (error) throw error;

  const totals = (data ?? []).reduce(
    (acc, row) => ({
      totalOrders: acc.totalOrders + ((row as { total_orders: number }).total_orders ?? 0),
      totalDelivered: acc.totalDelivered + ((row as { delivered_orders: number }).delivered_orders ?? 0),
    }),
    { totalOrders: 0, totalDelivered: 0 }
  );

  const daysInPeriod = data?.length || 1;

  return {
    capacityPct: totals.totalOrders > 0
      ? Math.round((totals.totalOrders / (daysInPeriod * DAILY_CAPACITY)) * 1000) / 10
      : null,
    capacityTarget: DAILY_CAPACITY,
    ordersPerHour: totals.totalOrders > 0
      ? Math.round((totals.totalOrders / (daysInPeriod * OPERATIONAL_HOURS)) * 10) / 10
      : null,
    totalOrders: totals.totalOrders,
    totalDelivered: totals.totalDelivered,
    daysInPeriod,
    operationalHours: OPERATIONAL_HOURS,
  };
}

export function useSecondaryMetrics(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'secondary-metrics', startDate, endDate],
    queryFn: () => fetchSecondaryMetrics(operatorId!, startDate, endDate),
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

export function useSecondaryMetricsPreviousPeriod(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'secondary-metrics-prev', startDate, endDate],
    queryFn: () => fetchSecondaryMetrics(operatorId!, startDate, endDate),
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
```

- [ ] **Step 8: Create useFailureReasons.ts**

```typescript
// src/hooks/dashboard/useFailureReasons.ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { Database } from '@aureon/database';
import { DASHBOARD_QUERY_OPTIONS } from './constants';

type FailureReasonsArgs = Database['public']['Functions']['get_failure_reasons']['Args'];

export type FailureReasonRow = {
  reason: string;
  count: number;
  percentage: number;
};

export function useFailureReasons(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'failure-reasons', startDate, endDate],
    queryFn: async () => {
      const args: FailureReasonsArgs = {
        p_operator_id: operatorId!,
        p_start_date: startDate,
        p_end_date: endDate,
      };
      const { data, error } = await (createSPAClient().rpc as CallableFunction)('get_failure_reasons', args);
      if (error) throw error;
      return data as FailureReasonRow[];
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
```

- [ ] **Step 9: Create useExportData.ts**

```typescript
// src/hooks/dashboard/useExportData.ts
import { useSlaMetric, useSlaPreviousPeriod } from './useSlaMetrics';
import { useFadrSummary, useFadrPreviousPeriod } from './useFadrMetrics';
import {
  usePerformanceMetricsSummary,
  useShortageClaimsMetric,
  useAvgDeliveryTimeMetric,
  useClaimsPreviousPeriod,
  useDeliveryTimePreviousPeriod,
} from './useOrdersMetrics';
import { useCustomerPerformance, type CustomerPerformanceRow } from './useCustomerPerformance';
import { useSecondaryMetrics, useSecondaryMetricsPreviousPeriod, type SecondaryMetrics } from './useSecondaryMetrics';
import { useFailureReasons, type FailureReasonRow } from './useFailureReasons';

export type DashboardExportData = {
  sla: { value: number | null; prevValue: number | null; totalOrders: number; deliveredOrders: number };
  primary: {
    fadrValue: number | null;
    fadrPrev: number | null;
    fadrFirstAttempt: number;
    fadrTotal: number;
    claimsCount: number;
    claimsAmount: number;
    claimsPrevCount: number;
    claimsPrevAmount: number;
    avgDeliveryTime: number | null;
    prevAvgDeliveryTime: number | null;
  };
  customers: CustomerPerformanceRow[];
  failures: FailureReasonRow[];
  secondary: SecondaryMetrics | null;
  prevSecondary: SecondaryMetrics | null;
};

export function useExportData(
  operatorId: string | null,
  startDate: string,
  endDate: string,
  prevStartDate: string,
  prevEndDate: string,
  enabled: boolean
) {
  const gatedOperatorId = enabled ? operatorId : null;

  const sla = useSlaMetric(gatedOperatorId, startDate, endDate);
  const slaPrev = useSlaPreviousPeriod(gatedOperatorId, prevStartDate, prevEndDate);
  const perf = usePerformanceMetricsSummary(gatedOperatorId, startDate, endDate);
  const fadrSummary = useFadrSummary(gatedOperatorId, startDate, endDate);
  const fadrPrev = useFadrPreviousPeriod(gatedOperatorId, prevStartDate, prevEndDate);
  const claims = useShortageClaimsMetric(gatedOperatorId, startDate, endDate);
  const claimsPrev = useClaimsPreviousPeriod(gatedOperatorId, prevStartDate, prevEndDate);
  const avgTime = useAvgDeliveryTimeMetric(gatedOperatorId, startDate, endDate);
  const avgTimePrev = useDeliveryTimePreviousPeriod(gatedOperatorId, prevStartDate, prevEndDate);
  const customers = useCustomerPerformance(gatedOperatorId, startDate, endDate);
  const failures = useFailureReasons(gatedOperatorId, startDate, endDate);
  const secondary = useSecondaryMetrics(gatedOperatorId, startDate, endDate);
  const secondaryPrev = useSecondaryMetricsPreviousPeriod(gatedOperatorId, prevStartDate, prevEndDate);

  const isLoading =
    sla.isLoading || slaPrev.isLoading || perf.isLoading || fadrSummary.isLoading ||
    fadrPrev.isLoading || claims.isLoading || claimsPrev.isLoading || avgTime.isLoading ||
    avgTimePrev.isLoading || customers.isLoading || failures.isLoading ||
    secondary.isLoading || secondaryPrev.isLoading;

  const isError =
    sla.isError || perf.isError || fadrSummary.isError || claims.isError ||
    avgTime.isError || customers.isError || failures.isError || secondary.isError;

  const data: DashboardExportData | null =
    !enabled || isLoading
      ? null
      : {
          sla: {
            value: sla.data ?? null,
            prevValue: slaPrev.data ?? null,
            totalOrders: perf.data?.totalOrders ?? 0,
            deliveredOrders: perf.data?.deliveredOrders ?? 0,
          },
          primary: {
            fadrValue: fadrSummary.data && fadrSummary.data.total > 0
              ? Math.round((fadrSummary.data.firstAttempt / fadrSummary.data.total) * 1000) / 10
              : null,
            fadrPrev: fadrPrev.data ?? null,
            fadrFirstAttempt: fadrSummary.data?.firstAttempt ?? 0,
            fadrTotal: fadrSummary.data?.total ?? 0,
            claimsCount: claims.data?.count ?? 0,
            claimsAmount: claims.data?.amount ?? 0,
            claimsPrevCount: claimsPrev.data?.count ?? 0,
            claimsPrevAmount: claimsPrev.data?.amount ?? 0,
            avgDeliveryTime: avgTime.data ?? null,
            prevAvgDeliveryTime: avgTimePrev.data ?? null,
          },
          customers: customers.data ?? [],
          failures: failures.data ?? [],
          secondary: secondary.data ?? null,
          prevSecondary: secondaryPrev.data ?? null,
        };

  return { data, isLoading, isError };
}
```

- [ ] **Step 10: Overwrite useDashboardMetrics.ts as a barrel re-export**

```typescript
// src/hooks/useDashboardMetrics.ts
// Barrel re-export — all hooks moved to hooks/dashboard/ subdirectory (spec-28 H2).
// This file preserved for backward compatibility with existing import paths.
export { useOperatorId } from './useOperatorId';
export * from './dashboard/useSlaMetrics';
export * from './dashboard/useFadrMetrics';
export * from './dashboard/useOrdersMetrics';
export * from './dashboard/useCustomerPerformance';
export * from './dashboard/useSecondaryMetrics';
export * from './dashboard/useFailureReasons';
export * from './dashboard/useExportData';
```

- [ ] **Step 11: Run TypeScript type-check**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 12: Run all frontend tests**

```bash
cd apps/frontend && npm test
```

Expected: all tests pass, including `useDashboardMetrics.test.ts`.

- [ ] **Step 13: Commit**

```bash
git add apps/frontend/src/hooks/
git commit -m "refactor(frontend): split useDashboardMetrics (649 lines) into hooks/dashboard/ subdirectory"
```

---

## Chunk 4: AuditLog Component Consolidation (M2)

### Task 10: Investigate and consolidate duplicate AuditLog components

**Files:**
- Read: `src/components/admin/AuditLogFilters.tsx` (225 lines)
- Read: `src/components/audit/AuditLogFilters.tsx` (195 lines)
- Read: `src/components/admin/AuditLogTable.tsx` (245 lines)
- Read: `src/components/audit/AuditLogTable.tsx` (257 lines)
- Read: `src/app/admin/audit-logs/AuditLogsPageClient.tsx`
- Read: `src/app/app/audit-logs/page.tsx`

**Context:**
- `components/admin/` variants are used by the `/admin/audit-logs` route (admin-only)
- `components/audit/` variants are used by the `/app/audit-logs` route (operator user)
- These may have diverged in features over time. Consolidation is safe only if the differences are additive (i.e., the `audit/` version is a superset), or if missing features can be merged.

- [ ] **Step 1: Read all four component files**

Read each of the four files in full. Take note of:
- Props interface differences
- Filter field differences
- Table column differences
- Any role-specific logic

- [ ] **Step 2: Determine consolidation strategy**

After reading, choose one:

**Case A — `audit/` is a superset:** Replace `admin/` imports with `audit/` imports directly. Delete `admin/` components.

**Case B — The two have different features:** Merge missing features from `admin/` into `audit/` components, then switch the admin page to use `audit/`, then delete `admin/`.

**Case C — They are fundamentally different (different props, rendering logic):** Do NOT consolidate. Document why in a code comment. Remove this task from scope.

- [ ] **Step 3 (Case A or B): Update AuditLogsPageClient.tsx**

Change the imports from `admin/AuditLogFilters` and `admin/AuditLogTable` to `audit/AuditLogFilters` and `audit/AuditLogTable`.

Verify the props used by the admin page are compatible with the `audit/` component interfaces.

- [ ] **Step 4: Run TypeScript type-check**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 5: Delete the now-unused admin/ variants**

```bash
rm apps/frontend/src/components/admin/AuditLogFilters.tsx
rm apps/frontend/src/components/admin/AuditLogTable.tsx
```

- [ ] **Step 6: Run frontend tests**

```bash
cd apps/frontend && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/
git commit -m "refactor(frontend): consolidate duplicate AuditLog components — admin/ now uses audit/"
```

---

## Chunk 5: Missing Hook Tests (M5)

**Prerequisite:** Read each hook file before writing its tests. Understanding what the hook does drives test design.

### Task 11: Tests for useRoutePackages

**Files:**
- Read: `src/hooks/dispatch/useRoutePackages.ts`
- Create: `src/hooks/dispatch/useRoutePackages.test.ts`

- [ ] **Step 1: Read the hook**

Read `apps/frontend/src/hooks/dispatch/useRoutePackages.ts` in full.

- [ ] **Step 2: Write the failing test**

Follow the mock-at-hook-level pattern from existing test files (see `useDispatchRoutes.test.ts` for reference):

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useRoutePackages } from './useRoutePackages';

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(),
}));

import { createSPAClient } from '@/lib/supabase/client';

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useRoutePackages', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns packages for a valid routeId', async () => {
    // Fill in based on what the hook actually fetches — read the hook first
    const mockData = [/* adapt to hook's return shape */];
    (createSPAClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: mockData, error: null }),
    });

    const { result } = renderHook(() => useRoutePackages('route-123'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
  });

  it('is disabled when routeId is null', () => {
    const { result } = renderHook(() => useRoutePackages(null), { wrapper });
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('exposes isError on Supabase failure', async () => {
    (createSPAClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    });

    const { result } = renderHook(() => useRoutePackages('route-123'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

> **Note:** Adapt the mock chain to match the actual Supabase call shape in the hook (read it first). The test above is a template.

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd apps/frontend && npx vitest run src/hooks/dispatch/useRoutePackages.test.ts
```

Expected: FAIL (test file references real hook, mock may need adjustment)

- [ ] **Step 4: Adjust mocks until tests pass**

Run:
```bash
cd apps/frontend && npx vitest run src/hooks/dispatch/useRoutePackages.test.ts --reporter=verbose
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/dispatch/
git commit -m "test(frontend): add missing tests for useRoutePackages"
```

---

### Task 12: Tests for useDiscrepancies

**Files:**
- Read: `src/hooks/pickup/useDiscrepancies.ts`
- Create: `src/hooks/pickup/useDiscrepancies.test.ts`

Follow the same pattern as Task 11. Read the hook first, then write tests that cover: success case (returns expected shape), disabled when identifier is null, error case.

- [ ] **Step 1: Read the hook**
- [ ] **Step 2: Write the failing test** (adapted from the template above)
- [ ] **Step 3: Run to confirm failure**
- [ ] **Step 4: Fix mocks and run until passing**
- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/pickup/
git commit -m "test(frontend): add missing tests for useDiscrepancies"
```

---

### Task 13: Tests for useAuditLogs

**Files:**
- Read: `src/hooks/useAuditLogs.ts`
- Create: `src/hooks/useAuditLogs.test.ts`

- [ ] **Step 1: Read the hook**
- [ ] **Step 2: Write the failing test** (adapted template)
- [ ] **Step 3: Run to confirm failure**
- [ ] **Step 4: Fix mocks and run until passing**
- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/useAuditLogs.test.ts
git commit -m "test(frontend): add missing tests for useAuditLogs"
```

---

### Task 14: Tests for useDashboardDates

**Files:**
- Read: `src/hooks/useDashboardDates.ts`
- Create: `src/hooks/useDashboardDates.test.ts`

Note: this hook likely computes date ranges for dashboard filters. If it is pure (no API calls), tests do not need QueryClient wrappers — test the return values directly.

- [ ] **Step 1: Read the hook** — determine if it makes API calls or is pure
- [ ] **Step 2: Write the failing test**
- [ ] **Step 3: Run to confirm failure**
- [ ] **Step 4: Fix and run until passing**
- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/useDashboardDates.test.ts
git commit -m "test(frontend): add missing tests for useDashboardDates"
```

---

### Task 15: Tests for useOperatorId

**Files:**
- Read: `src/hooks/useOperatorId.ts`
- Create: `src/hooks/useOperatorId.test.ts`

Note: `useOperatorId` is already re-exported from `useDashboardMetrics.ts`. Read the original file to understand what it does (likely reads from auth session or Zustand store).

- [ ] **Step 1: Read the hook**
- [ ] **Step 2: Write the failing test**
- [ ] **Step 3: Run to confirm failure**
- [ ] **Step 4: Fix and run until passing**
- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/useOperatorId.test.ts
git commit -m "test(frontend): add missing tests for useOperatorId"
```

---

## Chunk 6: Directory Structure Cleanup (L1)

### Task 16: Consolidate src/utils/ into src/lib/utils/

**Files:**
- Move: `src/utils/generateColorRamp.ts` → `src/lib/utils/generateColorRamp.ts`
- Move: `src/utils/generateColorRamp.test.ts` → `src/lib/utils/generateColorRamp.test.ts`
- Delete: `src/utils/` directory

- [ ] **Step 1: Find all imports of generateColorRamp**

```bash
grep -rn "from '@/utils/generateColorRamp'\|from '../utils/generateColorRamp'\|from './utils/generateColorRamp'" apps/frontend/src --include="*.ts" --include="*.tsx"
```

Note the import paths that need updating.

- [ ] **Step 2: Move the files**

```bash
mv apps/frontend/src/utils/generateColorRamp.ts apps/frontend/src/lib/utils/generateColorRamp.ts
mv apps/frontend/src/utils/generateColorRamp.test.ts apps/frontend/src/lib/utils/generateColorRamp.test.ts
rmdir apps/frontend/src/utils
```

- [ ] **Step 3: Update imports**

For each file found in Step 1, change `@/utils/generateColorRamp` to `@/lib/utils/generateColorRamp`.

- [ ] **Step 4: Run type-check and tests**

```bash
cd apps/frontend && npx tsc --noEmit && npm test
```

Expected: exits 0, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/
git commit -m "refactor(frontend): move src/utils/ into src/lib/utils/ — consolidate utility directories"
```

---

### Task 17: Consolidate src/stores/ into src/lib/stores/

**Files:**
- Move: `src/stores/adminStore.ts` → `src/lib/stores/adminStore.ts`
- Move: `src/stores/useOpsControlFilterStore.ts` → `src/lib/stores/useOpsControlFilterStore.ts`
- Move: `src/stores/useOpsControlFilterStore.test.ts` → `src/lib/stores/useOpsControlFilterStore.test.ts`
- Delete: `src/stores/` directory

- [ ] **Step 1: Find all imports of these stores**

```bash
grep -rn "from '@/stores/\|from '../stores/" apps/frontend/src --include="*.ts" --include="*.tsx"
```

- [ ] **Step 2: Move the files**

```bash
mv apps/frontend/src/stores/adminStore.ts apps/frontend/src/lib/stores/adminStore.ts
mv apps/frontend/src/stores/useOpsControlFilterStore.ts apps/frontend/src/lib/stores/useOpsControlFilterStore.ts
mv apps/frontend/src/stores/useOpsControlFilterStore.test.ts apps/frontend/src/lib/stores/useOpsControlFilterStore.test.ts
rmdir apps/frontend/src/stores
```

- [ ] **Step 3: Update all import paths found in Step 1**

> **Scale warning:** `useOpsControlFilterStore` alone may be imported in ~20 files. Do NOT manually edit each one. Use a global search-and-replace in your editor, or use `sed`:

```bash
# Update @/stores/ → @/lib/stores/ across the entire frontend src
find apps/frontend/src -name "*.ts" -o -name "*.tsx" | xargs sed -i "s|from '@/stores/|from '@/lib/stores/|g"
find apps/frontend/src -name "*.ts" -o -name "*.tsx" | xargs sed -i 's|from "@/stores/|from "@/lib/stores/|g'
```

Verify the substitution covered all cases:

```bash
grep -rn "from '@/stores/\|from \"@/stores/" apps/frontend/src --include="*.ts" --include="*.tsx"
```

Expected: no output (all paths updated).

- [ ] **Step 4: Run type-check and tests**

```bash
cd apps/frontend && npx tsc --noEmit && npm test
```

Expected: exits 0, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/
git commit -m "refactor(frontend): move src/stores/ into src/lib/stores/ — consolidate store directories"
```

---

## Final Verification

After all chunks are complete:

- [ ] **Run full frontend test suite**

```bash
cd apps/frontend && npm test
```

Expected: all tests pass.

- [ ] **Run full agents test suite**

```bash
cd apps/agents && npm test
```

Expected: all tests pass.

- [ ] **Run TypeScript type-check on both**

```bash
cd apps/frontend && npx tsc --noEmit
cd apps/agents && npm run type-check
```

Expected: both exit 0.

- [ ] **Verify no cross-app imports remain**

```bash
grep -rn "\.\.\/\.\.\/\.\.\/frontend\|\.\.\/\.\.\/frontend" apps/agents/src --include="*.ts"
```

Expected: no output.

- [ ] **Create PR**

```bash
git push origin HEAD
gh pr create --title "chore: spec-28 code quality cleanup — dead code, type split, hook decomposition, missing tests" \
  --body "Closes spec-28. Removes H1-H5 architectural violations, cleans dead code (M1), consolidates duplicate components (M2), adds missing test coverage (M5), fixes gitignore (M7), and consolidates directory structure (L1/L7). Zero behavior changes."
gh pr merge --auto --squash
```
