# Story 1.1: Clone and Deploy Razikus Template Skeleton

**Epic:** 1 - Platform Foundation & Multi-Tenant SaaS Setup
**Status:** ready-for-dev
**Story ID:** 1.1
**Story Key:** 1-1-clone-and-deploy-razikus-template-skeleton

---

## Story

As an **Aureon DevOps engineer**,
I want to **clone the Razikus Supabase-Next.js template and deploy the base application to Vercel, Railway, and Supabase**,
So that **we have a working multi-tenant foundation with authentication already configured**.

---

## Business Context

This is the **foundational story for the entire Aureon Last Mile platform**. It establishes:
- Multi-tenant SaaS architecture supporting 5-50 Chilean last-mile logistics operators
- Security-first approach with PostgreSQL Row-Level Security (RLS) for data isolation
- Rapid deployment capability targeting <4 weeks from contract to production
- Template-based onboarding enabling ≤4 hour new tenant provisioning

**Critical Success Factors:**
- First customer secured for beta testing during MVP
- Platform must support 99.9% uptime SLA (max 43 min downtime/month)
- AI-accelerated development velocity required (single developer initially)
- Must handle 4x peak load spikes (Cyberdays, Black Friday) without manual intervention

---

## Acceptance Criteria

### Given
- ✅ Access to Razikus template repository (https://github.com/Razikus/supabase-nextjs-template)
- ✅ GitHub account with repository creation permissions
- ✅ Vercel account linked to GitHub for auto-deployments
- ✅ Railway account for backend hosting
- ✅ Supabase account for database/auth services

### When
- ✅ Clone template and configure environment variables
- ✅ Set up multi-tenant database schema with RLS policies
- ✅ Configure CI/CD pipeline with GitHub Actions

### Then
- ✅ **Next.js 14/15 frontend deploys successfully to Vercel** with automatic HTTPS
- ✅ **Application connects to Supabase project** (PostgreSQL + Auth + Storage)
- ✅ **Base authentication flow works** (sign up, login, logout)
- ✅ **Environment variables configured:**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_KEY` (server-side only, NEVER in client code)
- ✅ **GitHub repository created** with main branch protected (requires PR for merges)
- ✅ **Deployed application accessible** at custom Vercel URL
- ✅ **PWA capabilities added** (Serwist service worker, IndexedDB offline storage)
- ✅ **Multi-tenant RLS policies verified** (operator data isolation tested)
- ✅ **GitHub Actions CI/CD pipeline passing** (test → type-check → lint → build)
- ✅ **Monitoring tools connected** (Sentry error tracking, BetterStack uptime monitoring)

### Edge Cases
- ❌ **Supabase project creation fails** → Retry with error logging, check account quota limits
- ❌ **Vercel deployment fails** → Check build logs and environment variables, verify Node.js version compatibility
- ❌ **Template has breaking changes** → Pin to specific commit hash for stability (recommended: latest stable release)
- ❌ **RLS policies don't enforce isolation** → Run integration tests verifying cross-tenant access blocked

---

## Tasks / Subtasks

### Task 1: Clone and Configure Razikus Template (AC: 1-6)
- [ ] **1.1** Clone Razikus template from GitHub
  - Repository: https://github.com/Razikus/supabase-nextjs-template
  - Pin to latest stable commit or release tag
- [ ] **1.2** Create new GitHub repository: `aureon-last-mile`
  - Enable branch protection on `main` (require PR reviews)
  - Configure GitHub Actions permissions
- [ ] **1.3** Install dependencies
  - Node.js v18+ required
  - Run `npm install` (or `yarn install`)
- [ ] **1.4** Configure Supabase project
  - Create new Supabase project (region: LATAM or Chile preferred)
  - Copy project URL and anon key
  - Generate service role key (store securely, server-side only)
- [ ] **1.5** Set up environment variables
  - Create `.env.local` (NEVER commit this file)
  - Add to `.gitignore` verification
  - Configure Vercel environment variables in dashboard
  - Configure Railway environment variables in dashboard

### Task 2: Add PWA Enhancement Layer (AC: 7)
- [ ] **2.1** Install Serwist packages
  - `npm i @serwist/next && npm i -D serwist`
- [ ] **2.2** Configure `next.config.mjs` with Serwist
  - Set `swSrc: 'app/sw.ts'`
  - Set `swDest: 'public/sw.js'`
- [ ] **2.3** Create service worker file `app/sw.ts`
  - Import `defaultCache` from `@serwist/next/worker`
  - Configure precaching, runtime caching, offline fallback
- [ ] **2.4** Update `tsconfig.json` for service worker types
  - Add `"@serwist/next/typings"` to types array
  - Add `"webworker"` to lib array
- [ ] **2.5** Create PWA manifest file `app/manifest.json`
  - Configure app name, icons, theme colors, start URL
- [ ] **2.6** Set up IndexedDB schema with Dexie
  - Install: `npm i dexie`
  - Create offline storage schema for scan queue
  - Define data models for offline-first operations

### Task 3: Configure Multi-Tenant RLS Policies (AC: 8)
- [ ] **3.1** Create database migration for tenant isolation
  - Add `operator_id UUID NOT NULL` to all tenant-scoped tables
  - Create indexes on `operator_id` for performance
- [ ] **3.2** Implement RLS policies for data isolation
  - Policy template: `CREATE POLICY "tenant_isolation" ON table_name FOR ALL USING (operator_id = auth.operator_id())`
  - Apply to all tables: orders, manifests, scans, users, audit_logs
- [ ] **3.3** Configure JWT claims for multi-tenancy
  - Ensure JWT includes `operator_id` claim
  - Set up session variable handling
- [ ] **3.4** Test RLS isolation
  - Create test users for different operators
  - Verify cross-tenant queries return empty results
  - Confirm application bugs cannot bypass RLS

### Task 4: Deploy to Vercel (Frontend) (AC: 6)
- [ ] **4.1** Connect GitHub repository to Vercel
  - Import project from GitHub
  - Configure automatic deployments on push
- [ ] **4.2** Configure Vercel environment variables
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_API_URL` (Railway backend URL)
- [ ] **4.3** Configure custom domain (optional)
  - Set up DNS records
  - Enable automatic HTTPS
- [ ] **4.4** Verify deployment
  - Check build logs for errors
  - Test application at Vercel URL
  - Verify authentication flow works

### Task 5: Deploy to Railway (Backend) (AC: 9)
- [ ] **5.1** Create Railway project
  - Connect GitHub repository
  - Configure automatic deployments
- [ ] **5.2** Set up Redis for caching and job queue
  - Add Redis service to Railway
  - Configure connection string
- [ ] **5.3** Set up n8n for workflow automation
  - Deploy n8n instance on Railway
  - Configure webhook URLs for email parsing
- [ ] **5.4** Configure Railway environment variables
  - `SUPABASE_SERVICE_KEY` (secret, never in client)
  - `N8N_WEBHOOK_URL`
  - Database connection string

### Task 6: Set Up CI/CD Pipeline (AC: 9)
- [ ] **6.1** Create `.github/workflows/test.yml`
  - Run on push and pull_request events
  - Steps: npm install, type-check, lint, test, build
- [ ] **6.2** Create `.github/workflows/deploy.yml`
  - Trigger on main branch merge
  - Deploy to Vercel production
  - Deploy to Railway production
  - Run smoke tests on deployed environment
- [ ] **6.3** Configure GitHub branch protection
  - Require passing CI checks before merge
  - Require code review approvals
- [ ] **6.4** Test CI/CD pipeline
  - Create test PR to verify preview deployments
  - Merge to main to verify production deployments

### Task 7: Set Up Monitoring and Alerting (AC: 10)
- [ ] **7.1** Configure Sentry error tracking
  - Sign up for Sentry (free tier: 5K events/month)
  - Add `SENTRY_DSN` to environment variables
  - Install Sentry SDK: `npm i @sentry/nextjs`
  - Configure error capture in `sentry.client.config.ts`
- [ ] **7.2** Set up BetterStack uptime monitoring
  - Create uptime monitor for Vercel URL
  - Configure alerts for downtime (email/Slack)
  - Set up status page (optional)
- [ ] **7.3** Enable Vercel Analytics
  - Enable in Vercel dashboard
  - Monitor page load times and Core Web Vitals
- [ ] **7.4** Configure Railway Dashboard monitoring
  - Monitor CPU, memory, disk usage
  - Set up alerts for resource thresholds

### Task 8: Documentation and Validation (AC: All)
- [ ] **8.1** Create `README.md` with setup instructions
  - Local development setup steps
  - Environment variables documentation
  - Deployment instructions
  - Architecture overview
- [ ] **8.2** Create `.env.example` template
  - List all required environment variables
  - Include example values (no secrets)
- [ ] **8.3** Document architectural decisions
  - Multi-tenant RLS approach
  - PWA offline-first strategy
  - Deployment architecture
- [ ] **8.4** Run final validation checklist
  - All tests passing (>70% coverage)
  - TypeScript compilation successful (strict mode, zero errors)
  - ESLint passing (naming conventions enforced)
  - Build succeeds in <3 minutes
  - Authentication flow verified
  - Multi-tenant isolation verified
  - Service worker registered and caching assets
  - Monitoring tools receiving data

---

## Dev Notes

### 🏗️ Architecture Patterns and Constraints

**CRITICAL: Follow these patterns to prevent developer mistakes across all future stories!**

#### 1. Naming Conventions (Enforced via ESLint)

| Context | Pattern | Example |
|---------|---------|---------|
| Database Tables | `snake_case`, plural | `orders`, `barcode_scans`, `audit_logs` |
| Database Columns | `snake_case` | `user_id`, `created_at`, `operator_id` |
| Foreign Keys | `referenced_table_singular_id` | `user_id REFERENCES users(id)` |
| Indexes | `idx_table_column[_column]` | `idx_orders_operator_id` |
| API Endpoints | `/api/resource` (plural, lowercase) | `/api/orders`, `/api/manifests/:id/sign` |
| TypeScript Components | `PascalCase` | `UserCard.tsx`, `DashboardMetrics.tsx` |
| TypeScript Functions | `camelCase` | `getUserData()`, `fetchOrders()` |
| TypeScript Variables | `camelCase` | `userId`, `orderCount`, `isLoading` |
| TypeScript Constants | `SCREAMING_SNAKE_CASE` | `API_BASE_URL`, `MAX_RETRY_ATTEMPTS` |
| Zustand Stores | `use` + `ResourceName` + `Store` | `useScanStore`, `useAuthStore` |

#### 2. API Response Formats (MANDATORY)

**Success (200-299):**
```typescript
// Single resource (direct, no wrapper)
{ "id": "order-123", "order_number": "FAL-001", "status": "pending" }

// Collection (array)
[ { "id": "order-1", ... }, { "id": "order-2", ... } ]
```

**Errors (400-599):**
```typescript
{
  "error": {
    "code": "BARCODE_NOT_FOUND",
    "message": "Código de barras no encontrado",
    "details": "Barcode '7804123456789' not in manifest",
    "field": "barcode",
    "timestamp": "2026-02-07T14:30:00Z",
    "request_id": "req_abc123"
  }
}
```

**Dates:** ISO 8601 strings ONLY
```typescript
{ "created_at": "2026-02-07T14:30:00Z", "updated_at": "2026-02-07T15:45:00Z" }
```

#### 3. State Management Patterns

**Zustand (Local/UI State) - Immutable Updates ALWAYS:**
```typescript
// ✅ Correct
addScan: (barcode) => set((state) => ({
  scans: [...state.scans, newScan]  // Spread operator
}))

// ❌ Incorrect (mutation)
addScan: (barcode) => set((state) => {
  state.scans.push(newScan)  // FORBIDDEN - mutates state
})
```

**TanStack Query (Server State):**
```typescript
const { data, isLoading, isError } = useQuery({
  queryKey: ['orders'],
  queryFn: fetchOrders,
  staleTime: 30000,        // 30s fresh
  refetchInterval: 60000   // 60s background refresh
})
```

#### 4. Multi-Tenant Security Requirements

**CRITICAL - Data Isolation Enforcement:**
- Every table MUST include `operator_id UUID NOT NULL`
- RLS policies MUST enforce `operator_id = auth.operator_id()`
- Never trust frontend tenant context without DB verification
- JWT tokens MUST include `operator_id` claim
- Test cross-tenant access blocked at database level

**RLS Policy Template:**
```sql
CREATE POLICY "tenant_isolation" ON table_name
  FOR ALL USING (operator_id = auth.operator_id());
```

**Audit Logging (7-year retention):**
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  operator_id UUID NOT NULL,
  user_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,       -- 'SCAN_ORDER', 'SIGN_MANIFEST'
  resource_type VARCHAR(50),         -- 'order', 'manifest'
  resource_id UUID,
  changes_json JSONB,                -- Before/after state
  ip_address VARCHAR(50),
  timestamp TIMESTAMP DEFAULT NOW()
);
```

#### 5. Error Handling Requirements

- **API Routes:** Try-catch with structured logging + request_id
- **React Components:** Error boundaries for component crashes
- **Forms:** Inline validation + toast notifications
- **All Responses:** Include `request_id` for tracing

#### 6. Performance Requirements

- **BI Dashboard initial load:** ≤2 seconds
- **API responses:** ≤200ms p95 (reads), ≤500ms p95 (writes)
- **Barcode scan processing:** ≤100ms per scan
- **Offline sync on reconnection:** ≤30 seconds for 500 records

---

### 📂 Source Tree Components to Touch

**Files to Create/Modify:**

```
aureon-last-mile/
├── .github/
│   └── workflows/
│       ├── test.yml                    # CREATE - CI pipeline
│       └── deploy.yml                  # CREATE - CD pipeline
│
├── src/
│   ├── app/
│   │   ├── sw.ts                       # CREATE - Serwist service worker
│   │   ├── manifest.json               # CREATE - PWA manifest
│   │   └── layout.tsx                  # MODIFY - Add PWA meta tags
│   │
│   ├── lib/
│   │   ├── db/
│   │   │   └── supabase.ts             # REVIEW - Verify RLS config
│   │   ├── stores/
│   │   │   └── scanStore.ts            # CREATE - Offline queue (Zustand)
│   │   └── offline/
│   │       └── indexedDB.ts            # CREATE - Dexie schema
│   │
│   └── middleware.ts                   # REVIEW - Verify auth middleware
│
├── supabase/
│   ├── migrations/
│   │   └── 20260207_initial_schema.sql # CREATE - RLS policies
│   └── config.toml                     # REVIEW - Verify settings
│
├── next.config.mjs                     # MODIFY - Add Serwist config
├── tsconfig.json                       # MODIFY - Add webworker types
├── .env.local                          # CREATE - Local env vars (DO NOT COMMIT)
├── .env.example                        # CREATE - Template for env vars
├── package.json                        # MODIFY - Add dependencies
└── README.md                           # CREATE - Setup documentation
```

---

### 🧪 Testing Standards Summary

**Unit Tests (Jest):**
- Test utilities, stores, data transformations
- Mock Supabase client for isolation
- Target >70% coverage for Story 1.1

**Integration Tests:**
- Verify RLS policies block cross-tenant access
- Test authentication flows (signup, login, logout)
- Validate API endpoint security

**E2E Tests (Playwright):**
- Critical user flows (deferred to later stories)
- PWA installation and offline capability

**Type Tests:**
- TypeScript strict mode enabled
- Zero `any` types allowed
- Run `npm run type-check` in CI

---

### 🌐 Latest Technical Information

**Razikus Template (2026):**
- **Repository:** https://github.com/Razikus/supabase-nextjs-template
- **Version:** Next.js 15 (backwards compatible with Next.js 14)
- **Status:** Actively maintained (last update: January 2025)
- **Features:** Auth, RLS, file storage, task management, React Native mobile app
- **Live Demo:** https://basicsass.razikus.com
- **Documentation:** Pre-built themes, i18n support (EN/PL/ZH - Spanish can be added)

**Serwist PWA Setup (2026):**
- **Official Docs:** https://serwist.pages.dev/docs/next/getting-started
- **Installation:** `npm i @serwist/next && npm i -D serwist`
- **Next.js Compatibility:** Supports Next.js 14+ (replaces deprecated next-pwa)
- **Key Features:** Offline caching, background sync, push notifications support
- **Configuration:** Update `next.config.mjs`, create `app/sw.ts`, update `tsconfig.json`

**Supabase RLS Best Practices (2026):**
- **Official Docs:** https://supabase.com/docs/guides/database/postgres/row-level-security
- **Multi-Tenant Pattern:** Shared database with `tenant_id` column + RLS policies
- **Performance:** Always index `operator_id` column, keep policies simple
- **Security:** NEVER use `service_role` key in client code (bypasses RLS)
- **JWT Claims:** Store `operator_id` in JWT to avoid heavy subqueries in policies
- **Testing:** Enable RLS from day one, test by connecting as different users

**Critical Security Warning:**
- Do NOT rely on `user_metadata` claim in RLS policies (users can modify this)
- Use `operator_id` from JWT claims (set server-side during authentication)

---

### 📚 References

All technical details cited with source paths and sections:

**Epic and Story Definition:**
- [Source: _bmad-output/planning-artifacts/epics.md - Epic 1: Platform Foundation & Multi-Tenant SaaS Setup]
- [Source: _bmad-output/planning-artifacts/epics.md - Story 1.1: Clone and Deploy Razikus Template Skeleton]

**Architecture Specifications:**
- [Source: _bmad-output/planning-artifacts/architecture.md - Technical Stack]
- [Source: _bmad-output/planning-artifacts/architecture.md - Project Structure]
- [Source: _bmad-output/planning-artifacts/architecture.md - Multi-Tenant RLS Policies]
- [Source: _bmad-output/planning-artifacts/architecture.md - Naming Conventions]
- [Source: _bmad-output/planning-artifacts/architecture.md - State Management Patterns]

**Product Requirements:**
- [Source: _bmad-output/planning-artifacts/prd.md - Platform Foundation Requirements]
- [Source: _bmad-output/planning-artifacts/prd.md - Multi-Tenant SaaS Requirements]
- [Source: _bmad-output/planning-artifacts/prd.md - Deployment Requirements]
- [Source: _bmad-output/planning-artifacts/prd.md - Security & Compliance]

**Database Schema:**
- [Source: _bmad-output/planning-artifacts/database-schema.md - Multi-Tenant Tables]
- [Source: _bmad-output/planning-artifacts/database-schema.md - Audit Logging]

**External References:**
- [GitHub - Razikus/supabase-nextjs-template](https://github.com/Razikus/supabase-nextjs-template)
- [Serwist Next.js PWA Setup Guide](https://serwist.pages.dev/docs/next/getting-started)
- [Supabase Row Level Security Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Multi-Tenant RLS Best Practices](https://dev.to/blackie360/-enforcing-row-level-security-in-supabase-a-deep-dive-into-lockins-multi-tenant-architecture-4hd2)

---

## Dev Agent Record

### Agent Model Used

_To be filled by Dev Agent_

### Debug Log References

_To be filled by Dev Agent_

### Completion Notes List

_To be filled by Dev Agent after implementation_

### File List

_To be filled by Dev Agent with all files created/modified_

---

## 🎯 Success Criteria Checklist

**Deployment:**
- [ ] Vercel shows green status (no build errors)
- [ ] Railway backend running without errors
- [ ] Supabase database connected and accessible
- [ ] GitHub Actions pipeline passing all checks

**Functionality:**
- [ ] Template app accessible at `https://<project>.vercel.app`
- [ ] Login/register flow works (Supabase Auth)
- [ ] Multi-tenant RLS policies verified (operator data isolation)
- [ ] Service worker registered and caching assets
- [ ] IndexedDB storage working in browser dev tools
- [ ] Offline mode indicator displayed

**Code Quality:**
- [ ] TypeScript: Zero errors (strict mode)
- [ ] ESLint: All rules passing (naming conventions enforced)
- [ ] Tests: Passing (>70% coverage for skeleton)
- [ ] Build: Succeeds in <3 minutes

**Documentation:**
- [ ] README.md with local setup instructions
- [ ] Environment variables documented (.env.example)
- [ ] Architecture decisions documented
- [ ] Deployment instructions clear

---

**🚀 This comprehensive story file prevents common LLM developer mistakes by providing:**
- ✅ Complete context from PRD, Architecture, and Epic specifications
- ✅ Latest 2026 technical information for Razikus, Serwist, and Supabase
- ✅ Mandatory naming conventions and patterns to follow
- ✅ Security-critical multi-tenant RLS implementation guidance
- ✅ Performance requirements with specific metrics
- ✅ Complete task breakdown with acceptance criteria mapping
- ✅ File-by-file guidance on what to create/modify
- ✅ Testing requirements and validation checklist

**Developer: You have everything needed for flawless implementation. No guessing required!**
