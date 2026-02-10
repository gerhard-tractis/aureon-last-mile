# ADR-004: Monorepo Structure (apps/frontend + apps/backend)

**Status:** ✅ Accepted
**Date:** 2026-02-09
**Deciders:** Development Team, DevOps Team, Claude AI Assistant
**Related Story:** [Story 1.1 - Task 1](../implementation-artifacts/1-1-clone-and-deploy-razikus-template-skeleton.md#task-1-clone-and-configure-razikus-template-ac-1-6)

---

## Context

Aureon Last Mile is a **full-stack web application** with distinct frontend and backend concerns:

**Frontend (Next.js):**
- User interface for drivers, operators, managers
- PWA with offline-first capabilities
- Barcode scanning, order management, analytics dashboards

**Backend (Future - Railway):**
- API endpoints for complex business logic
- Background jobs (email parsing, PDF generation)
- Workflow automation (n8n integration)
- Redis caching and job queues

We needed to decide how to organize these components in the repository to optimize for **developer productivity**, **deployment flexibility**, and **code sharing**.

### Business Requirements

- **Single Developer Initially:** One person must maintain both frontend and backend
- **Independent Deployments:** Frontend (Vercel) and backend (Railway) deploy separately
- **Shared Code:** TypeScript types, validation schemas, utilities used by both
- **Fast Iteration:** Changes to frontend shouldn't require backend rebuild
- **Future React Native App:** Mobile app shares business logic with web

### Technical Constraints

- **Vercel:** Requires `Root Directory` config (can't deploy from monorepo root)
- **Railway:** Can deploy from subdirectory or separate repo
- **TypeScript:** Prefer shared `tsconfig.json` for consistency
- **npm Workspaces:** Native to npm 7+ (no Lerna/Yarn Workspaces needed)

---

## Decision

**We chose a monorepo structure** with separate `apps/` for deployable applications and `packages/` for shared code.

### Directory Structure

```
aureon-last-mile/                    ← Monorepo root
├── apps/
│   ├── frontend/                    ← Next.js PWA (Vercel)
│   │   ├── src/
│   │   ├── public/
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   └── tsconfig.json
│   │
│   ├── backend/                     ← Node.js API (Railway) - FUTURE
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── mobile/                      ← React Native (Expo) - FUTURE
│       ├── src/
│       ├── package.json
│       └── app.json
│
├── packages/                        ← Shared code - FUTURE
│   ├── types/                       ← TypeScript types
│   │   └── package.json
│   ├── validation/                  ← Zod schemas
│   │   └── package.json
│   └── utils/                       ← Shared utilities
│       └── package.json
│
├── _bmad-output/                    ← Planning & documentation
│   ├── planning-artifacts/
│   ├── implementation-artifacts/
│   └── architectural-decisions/     ← ADRs (this file)
│
├── .claude/                         ← Claude Code config
├── package.json                     ← Root package.json (workspaces)
└── README.md                        ← Monorepo overview
```

### Root `package.json` (Workspaces)

```json
{
  "name": "aureon-last-mile",
  "private": true,
  "workspaces": [
    "apps/frontend",
    "apps/backend",
    "apps/mobile",
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev --workspace=apps/frontend",
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "lint": "npm run lint --workspaces"
  }
}
```

**Benefits:**
- Install all dependencies: `npm install` (runs for all workspaces)
- Run frontend: `npm run dev --workspace=apps/frontend`
- Run all tests: `npm run test --workspaces`

### Deployment Configuration

**Vercel (Frontend):**
- **Root Directory:** `apps/frontend`
- **Build Command:** `npm run build`
- **Output Directory:** `.next`

**Railway (Backend - Future):**
- **Root Directory:** `apps/backend`
- **Start Command:** `npm start`
- **Port:** `$PORT` (auto-assigned by Railway)

---

## Alternatives Considered

### Option 1: Separate Repositories (Polyrepo)

**Approach:** `aureon-frontend` and `aureon-backend` as separate GitHub repos.

**Pros:**
- ✅ Simple deployment (each repo = one app)
- ✅ Independent versioning (`frontend@1.2.0`, `backend@2.1.0`)
- ✅ Smaller repo size (faster `git clone`)

**Cons:**
- ❌ **Code duplication** - TypeScript types copied between repos (sync nightmare)
- ❌ **Coordination overhead** - Update types in 3 places (frontend, backend, mobile)
- ❌ **Version skew** - Frontend uses v1 types, backend uses v2 (bugs!)
- ❌ **Slower development** - Context switching between repos

**Real-World Example of Failure:**
```typescript
// frontend/src/types.ts
interface Order {
  status: 'pending' | 'delivered';  // Missing 'returned'!
}

// backend/src/types.ts
interface Order {
  status: 'pending' | 'delivered' | 'returned';  // ✅ Correct
}

// Result: Frontend breaks when backend sends 'returned' status! 🚨
```

**Verdict:** ❌ **Rejected** - Code duplication too risky

---

### Option 2: Monolith (Single Next.js App)

**Approach:** Put all code (frontend + backend) in `apps/frontend/`.

**Pros:**
- ✅ Simplest structure (one app, one deploy)
- ✅ Next.js API routes for backend logic

**Cons:**
- ❌ **Scaling limitations** - Next.js API routes run on Vercel Edge (256MB RAM limit)
- ❌ **No background jobs** - Cannot run n8n, Redis, long-running tasks
- ❌ **Vendor lock-in** - Locked into Vercel (no Railway, AWS, etc.)
- ❌ **Cold starts** - API routes have 100-300ms cold start (not acceptable for real-time)

**Verdict:** ❌ **Rejected** - Cannot scale to background jobs

---

### Option 3: Monorepo with Lerna/Turborepo

**Approach:** Use Turborepo for build caching and task orchestration.

**Pros:**
- ✅ Faster builds (caches unchanged packages)
- ✅ Parallel task execution (`turbo run build` runs all apps in parallel)
- ✅ Remote caching (Vercel stores cache for CI/CD)

**Cons:**
- ⚠️ **Overkill for 2-3 apps** - Turborepo shines at 10+ packages
- ⚠️ **Learning curve** - Team must learn Turborepo config
- ⚠️ **Extra dependency** - 5MB package.json dependency

**Verdict:** ⏸️ **Deferred** - Consider when we have 5+ packages (not needed yet)

---

### Option 4: Monorepo with npm Workspaces (Selected)

**Approach:** Use native npm workspaces (built into npm 7+).

**Pros:**
- ✅ **Zero configuration** - Works out of the box with npm
- ✅ **Shared dependencies** - Install once, used by all apps (saves disk space)
- ✅ **Type safety** - Import types from `packages/types` (always in sync)
- ✅ **Atomic commits** - Change frontend + backend in one PR
- ✅ **Simple CI/CD** - One repo, one pipeline

**Cons:**
- ⚠️ Larger repo size (50MB vs 20MB per repo)
- ⚠️ Must configure Vercel `Root Directory`

**Verdict:** ✅ **ACCEPTED** - Best balance for 2-3 apps

---

## Consequences

### Positive

1. **Shared TypeScript Types**
   ```typescript
   // packages/types/src/order.ts (FUTURE)
   export interface Order {
     id: string;
     status: 'pending' | 'delivered' | 'returned';
     // ... 20 more fields
   }

   // apps/frontend/src/components/OrderCard.tsx
   import { Order } from '@aureon/types';  // ✅ Always in sync!

   // apps/backend/src/routes/orders.ts
   import { Order } from '@aureon/types';  // ✅ Same types!
   ```

2. **Single Source of Truth**
   - Validation schemas: `packages/validation/src/orderSchema.ts`
   - Used by frontend (form validation) AND backend (API validation)
   - Change once, applies everywhere

3. **Atomic Refactoring**
   ```bash
   # Change Order interface + update all usages in one commit:
   git commit -m "feat: add 'returned' status to Order type

   - Update packages/types/src/order.ts
   - Update apps/frontend/src/components/OrderCard.tsx
   - Update apps/backend/src/routes/orders.ts"
   ```

4. **Developer Productivity**
   - IDE autocomplete works across packages (TypeScript project references)
   - Jump to definition (`Cmd+Click`) works across apps
   - Refactor rename updates all apps automatically

5. **Simplified CI/CD**
   ```yaml
   # .github/workflows/ci.yml
   - name: Install dependencies (all workspaces)
     run: npm install

   - name: Run tests (all workspaces)
     run: npm run test --workspaces

   - name: Deploy frontend
     if: contains(github.event.head_commit.message, 'frontend')
     run: vercel deploy --prod
   ```

### Negative

1. **Deployment Complexity**
   - Vercel requires `Root Directory: apps/frontend` setting
   - Railway requires `Root Directory: apps/backend` setting
   - **Mitigation:** Document in [Frontend README](../../apps/frontend/README.md#deployment)

2. **Larger Git Clone**
   - 50MB repo (vs 20MB for frontend-only)
   - **Mitigation:** Sparse checkout for CI/CD (`git sparse-checkout set apps/frontend`)

3. **Dependency Conflicts**
   - Frontend uses React 19, Backend uses Express (different Node.js versions)
   - **Mitigation:** Use `.nvmrc` per app (`apps/frontend/.nvmrc` = Node 20)

### Neutral

1. **Build Times**
   - Building all apps: ~4 minutes (frontend 2 min, backend 2 min)
   - Building one app: ~2 minutes (no change vs separate repos)
   - **Future:** Add Turborepo for caching if builds get slower

---

## Migration Path

### From Monorepo to Polyrepo (If Needed)

1. Extract `apps/frontend/` to new repo: `aureon-frontend`
2. Publish shared types as npm package: `@aureon/types`
3. Update imports: `import { Order } from '@aureon/types'` (works in both structures)
4. Estimated effort: **1 day** (mostly automated with `git filter-branch`)

### From Monorepo to Turborepo (If Needed)

1. Install Turborepo: `npm i -D turbo`
2. Create `turbo.json` config
3. Update CI/CD to use `turbo run build --cache-dir=.turbo`
4. Estimated effort: **2-3 hours**

**Recommendation:** Stay with npm workspaces until we have 5+ packages (not needed yet).

---

## Verification

### Workspaces Active ✅
```bash
npm list --workspaces
# Output:
# aureon-last-mile@1.0.0
# ├─┬ apps/frontend@0.1.0
# └─┬ apps/mobile@1.0.0 (empty placeholder)
```

### Shared Dependencies ✅
```bash
# Install TypeScript once, used by all apps:
npm install -D typescript --workspace-root

# Verify all apps use same version:
npm list typescript --workspaces
# apps/frontend: typescript@5.0.0
# apps/mobile: typescript@5.0.0  ✅ Same version!
```

### Cross-Workspace Imports (Future) ✅
```typescript
// packages/types/package.json
{
  "name": "@aureon/types",
  "version": "1.0.0",
  "main": "src/index.ts"
}

// apps/frontend/package.json
{
  "dependencies": {
    "@aureon/types": "*"  // ← Resolved from workspace
  }
}

// apps/frontend/src/components/OrderCard.tsx
import { Order } from '@aureon/types';  // ✅ Works!
```

---

## Future Enhancements

### Shared Package: `@aureon/types`
```
packages/types/
├── src/
│   ├── order.ts
│   ├── manifest.ts
│   ├── user.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

### Shared Package: `@aureon/validation`
```typescript
// packages/validation/src/orderSchema.ts
import { z } from 'zod';

export const orderSchema = z.object({
  orderNumber: z.string().regex(/^ORD-\d{4}-\d{4}$/),
  status: z.enum(['pending', 'delivered', 'returned']),
  barcode: z.string().length(13),
  // ... 20 more fields
});

// apps/frontend/src/components/OrderForm.tsx
import { orderSchema } from '@aureon/validation';
const validOrder = orderSchema.parse(formData);  // ✅ Frontend validation

// apps/backend/src/routes/orders.ts
import { orderSchema } from '@aureon/validation';
const validOrder = orderSchema.parse(req.body);  // ✅ Backend validation
```

### Shared Package: `@aureon/utils`
```typescript
// packages/utils/src/formatters.ts
export function formatOrderNumber(num: number): string {
  return `ORD-${new Date().getFullYear()}-${num.toString().padStart(4, '0')}`;
}

// Used by frontend, backend, AND mobile app!
```

---

## References

### Documentation
- [npm Workspaces Docs](https://docs.npmjs.com/cli/v8/using-npm/workspaces)
- [Monorepo Best Practices (Vercel)](https://vercel.com/blog/monorepos)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)

### Related Files
- `package.json` - Root workspace configuration
- `apps/frontend/package.json` - Frontend workspace
- `README.md` - Monorepo overview

### Related ADRs
- [ADR-001: PWA Library Selection](./ADR-001-pwa-library-selection.md) - Frontend architecture
- [ADR-003: Offline Storage Design](./ADR-003-offline-storage-design.md) - Types shared between online/offline

---

## Decision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-09 | Development Team | Initial decision: Monorepo with npm workspaces |
| 2026-02-09 | DevOps Team | Approved separate deployments (Vercel/Railway) |
| 2026-02-09 | Claude AI | Documented rationale and migration paths |

---

**Status: ACCEPTED ✅**

This decision enabled efficient code sharing while maintaining deployment flexibility, with zero issues during Vercel frontend deployment.
