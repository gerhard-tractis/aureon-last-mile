# Superpowers Workflow Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace BMAD's heavy framework with a superpowers-driven workflow, migrate planning artifacts to `docs/`, and enforce architectural rules via CLAUDE.md.

**Architecture:** All changes are documentation and configuration only — zero production code touched. The `_bmad-output/` folder is preserved as a frozen archive. New artifacts live in `docs/`.

**Tech Stack:** Git, Markdown, YAML

---

### Task 1: Create feature branch

**Step 1: Create branch**
```bash
git checkout -b chore/superpowers-migration
```

**Step 2: Verify**
```bash
git branch --show-current
```
Expected: `chore/superpowers-migration`

---

### Task 2: Delete `_bmad/` framework directory

**Files:**
- Delete: `_bmad/` (entire directory — prompt templates only, no production code)

**Step 1: Verify directory contains only framework files (no production code)**
```bash
ls _bmad/
```
Expected: only `bmm/` and `_memory/` subdirectories

**Step 2: Delete the directory**
```bash
rm -rf _bmad/
```

**Step 3: Verify deletion**
```bash
ls _bmad/ 2>&1
```
Expected: `ls: cannot access '_bmad/': No such file or directory`

**Step 4: Commit**
```bash
git add -A
git commit -m "chore: delete _bmad framework directory (replaced by superpowers)"
```

---

### Task 3: Create new `docs/` subdirectories

**Files:**
- Create: `docs/stories/.gitkeep`
- Create: `docs/adr/.gitkeep`

**Step 1: Create directories**
```bash
mkdir -p docs/stories docs/adr
touch docs/stories/.gitkeep docs/adr/.gitkeep
```

**Step 2: Verify**
```bash
ls docs/stories/ docs/adr/
```
Expected: `.gitkeep` in each

---

### Task 4: Move `sprint-status.yaml` to `docs/`

**Files:**
- Move: `_bmad-output/implementation-artifacts/sprint-status.yaml` → `docs/sprint-status.yaml`
- Modify: `docs/sprint-status.yaml` (update `story_location` field)

**Step 1: Copy file**
```bash
cp _bmad-output/implementation-artifacts/sprint-status.yaml docs/sprint-status.yaml
```

**Step 2: Update `story_location` field**

In `docs/sprint-status.yaml`, change:
```yaml
story_location: _bmad-output/implementation-artifacts
```
To:
```yaml
story_location: docs/stories
```

Also update the top comment:
```yaml
# generated: 2026-03-03
```
To:
```yaml
# migrated: 2026-03-10
# story_location updated: docs/stories (was _bmad-output/implementation-artifacts)
```

**Step 3: Verify the change**
```bash
grep "story_location" docs/sprint-status.yaml
```
Expected: `story_location: docs/stories`

**Step 4: Commit**
```bash
git add docs/sprint-status.yaml
git commit -m "chore: move sprint-status.yaml to docs/, update story_location"
```

---

### Task 5: Move `epics.md` to `docs/`

**Files:**
- Copy: `_bmad-output/planning-artifacts/epics.md` → `docs/epics.md`

**Step 1: Copy file**
```bash
cp _bmad-output/planning-artifacts/epics.md docs/epics.md
```

**Step 2: Remove the BMAD frontmatter** (the `---` block at the top referencing old input documents)

Delete lines 1–11 (the YAML frontmatter block) from `docs/epics.md` and replace with:
```markdown
---
# maintained: manually (superpowers workflow)
# sprint-status: docs/sprint-status.yaml
# last-updated: 2026-03-10
---
```

**Step 3: Verify**
```bash
head -6 docs/epics.md
```
Expected: the new frontmatter header

**Step 4: Commit**
```bash
git add docs/epics.md
git commit -m "chore: move epics.md to docs/, clean up BMAD frontmatter"
```

---

### Task 6: Move ADRs to `docs/adr/`

**Files:**
- Copy: `_bmad-output/architectural-decisions/*.md` → `docs/adr/`

**Step 1: Copy all ADR files**
```bash
cp _bmad-output/architectural-decisions/*.md docs/adr/
```

**Step 2: Verify**
```bash
ls docs/adr/
```
Expected: `ADR-001-pwa-library-selection.md`, `ADR-002-multi-tenant-isolation-strategy.md`, `ADR-003-offline-storage-design.md`, `ADR-004-monorepo-structure.md`, `ADR-005-cicd-deployment-strategy.md`, `ADR-006-railway-backend-deferral.md`, `.gitkeep`

**Step 3: Commit**
```bash
git add docs/adr/
git commit -m "chore: move ADRs to docs/adr/"
```

---

### Task 7: Create `docs/architecture.md` (the living map)

**Files:**
- Create: `docs/architecture.md`

This is the most important artifact — the reference Claude reads before every implementation task.

**Step 1: Create the file with the following content:**

```markdown
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
```

**Step 2: Verify the file was created**
```bash
wc -l docs/architecture.md
```
Expected: under 130 lines

**Step 3: Commit**
```bash
git add docs/architecture.md
git commit -m "docs: add living architecture.md with hard rules (300-line limit, TDD, unidirectional deps)"
```

---

### Task 8: Create story template at `docs/stories/_template.md`

**Files:**
- Create: `docs/stories/_template.md`

**Step 1: Create the file with the following content:**

```markdown
# [EPIC-ID.STORY-ID] Story Title

> **Status:** backlog | in-progress | review | done
> **Epic:** [Epic name]
> **Branch:** feat/[story-id]-[short-name]

---

## Goal

One sentence: what does this story deliver and why does it matter?

---

## Stack Notes

Relevant architecture constraints for this story:
- Which layers are touched (DB / Edge Function / hook / component)?
- Any new tables or migrations needed?
- Any new dependencies to add?

---

## Acceptance Criteria

- [ ] AC1: [specific, testable outcome]
- [ ] AC2: [specific, testable outcome]
- [ ] AC3: [specific, testable outcome]

---

## Test Plan

> Write this section BEFORE implementation. Tests must be written first (TDD).

| Test | Type | Description |
|------|------|-------------|
| `test name` | unit/integration/e2e | What behavior it verifies |

---

## Constraints Checklist

> Verify before marking story done.

- [ ] All new files < 300 lines
- [ ] No circular dependencies introduced
- [ ] TDD followed — tests written before implementation
- [ ] `operator_id` filter present on all new DB queries
- [ ] Soft deletes used (no hard DELETEs on user data)
- [ ] `docs/sprint-status.yaml` updated to `done`

---

## Implementation Notes

Key decisions made during implementation. Update as you go.

- [Decision 1]
- [Decision 2]
```

**Step 2: Verify**
```bash
cat docs/stories/_template.md | head -5
```
Expected: `# [EPIC-ID.STORY-ID] Story Title`

**Step 3: Commit**
```bash
git add docs/stories/_template.md docs/stories/.gitkeep docs/adr/.gitkeep
git commit -m "docs: add story template and directory structure"
```

---

### Task 9: Update `CLAUDE.md` with architectural rules

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add the following section to `CLAUDE.md` after the existing `## Project` section:**

```markdown
## Architecture Rules (enforced on every task)

**Before any implementation task**, read `docs/architecture.md`.

**Hard rules — no exceptions:**

1. **No file exceeds 300 lines.** If a file approaches this limit, split it into focused modules before continuing.

2. **TDD always.** Write a failing test before writing any production code. Use the `superpowers:test-driven-development` skill. If there is no failing test, there is no implementation.

3. **Unidirectional dependencies.** `app → components → hooks → lib → Supabase`. No reverse imports, no circular dependencies.

4. **Multi-tenant isolation.** Every new DB query must filter by `operator_id`. Every new table must have `operator_id NOT NULL`.

5. **Soft deletes.** Never run `DELETE` on user data. Use `deleted_at = NOW()` instead.

## Workflow (new features)

1. `superpowers:brainstorming` → design approved
2. `superpowers:writing-plans` → creates story file in `docs/stories/`
3. Update `docs/sprint-status.yaml` → story status: `in-progress`
4. `superpowers:executing-plans` → implement (TDD)
5. `superpowers:requesting-code-review` → review
6. Update `docs/sprint-status.yaml` → story status: `done`
```

**Step 2: Verify the section was added correctly**
```bash
grep -n "Architecture Rules" CLAUDE.md
```
Expected: shows the line number of the new section

**Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: add architecture rules and superpowers workflow to CLAUDE.md"
```

---

### Task 10: Push PR and enable auto-merge

**Step 1: Push branch**
```bash
git push origin chore/superpowers-migration
```

**Step 2: Create PR**
```bash
gh pr create --title "chore: migrate to superpowers workflow, add architecture rules" --body "$(cat <<'EOF'
## Summary
- Deletes `_bmad/` framework directory (replaced by superpowers skills)
- Migrates `sprint-status.yaml`, `epics.md`, ADRs to `docs/`
- Creates `docs/architecture.md` — living architecture reference with hard rules (300-line limit, TDD, unidirectional deps)
- Creates `docs/stories/_template.md` — story template (Jira ticket for solopreneur)
- Updates `CLAUDE.md` with architecture rules and superpowers workflow

## What does NOT change
- Zero production code touched
- `_bmad-output/` preserved as frozen archive
- All CI/CD, deployments, Git workflow unchanged

## Test plan
- [ ] `docs/architecture.md` exists and contains hard rules
- [ ] `docs/sprint-status.yaml` has `story_location: docs/stories`
- [ ] `CLAUDE.md` contains architecture rules section
- [ ] `_bmad/` no longer exists
- [ ] All existing CI checks pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3: Enable auto-merge**
```bash
gh pr merge --auto --squash
```

**Step 4: Verify CI passes**
```bash
gh pr checks
```

**Step 5: Confirm merge**
```bash
gh pr view --json state,mergedAt
```
Expected: `"state": "MERGED"`

---

## Done

After merge:
- `docs/` is the single source of truth for all planning artifacts
- Claude reads `docs/architecture.md` before every task
- New stories go in `docs/stories/` using `_template.md`
- `docs/sprint-status.yaml` tracks execution
- `_bmad-output/` is a frozen archive
- `_bmad/` is gone
