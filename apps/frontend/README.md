# Aureon Last Mile 📦

> **Offline-First Last-Mile Logistics Management Platform**
> Built for Chilean logistics operators with multi-tenant SaaS architecture

[![Live Demo](https://img.shields.io/badge/demo-live-green?style=flat-square)](https://aureon-last-mile.vercel.app/)
[![Test Coverage](https://img.shields.io/badge/coverage-75.78%25-brightgreen?style=flat-square)](apps/frontend/coverage)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

---

## 📖 About This Project

**Aureon Last Mile** is a Progressive Web App (PWA) designed for last-mile logistics operators in Chile. It enables delivery drivers to **scan package barcodes offline** and automatically sync data when connectivity is restored, ensuring zero data loss during daily routes.

### Key Capabilities

- **🔌 Offline-First:** Scan packages without internet connection using service workers and IndexedDB
- **👥 Multi-Tenant SaaS:** Secure operator data isolation via PostgreSQL Row-Level Security (RLS)
- **📱 PWA:** Install on mobile devices, works like a native app with background sync
- **⚡ Real-Time Sync:** Automatic background synchronization when network is restored
- **📊 BI Dashboard:** Real-time metrics for operators, managers, and administrators

### Business Context

- **Target Users:** 5-50 Chilean last-mile logistics operators
- **Scale:** Handles 4x peak load spikes (Cyberdays, Black Friday)
- **SLA:** 99.9% uptime (max 43 minutes downtime/month)
- **Onboarding:** New tenant provisioning in ≤4 hours

---

## 🏗️ Tech Stack

### Frontend
- **Framework:** [Next.js 15](https://nextjs.org/) (App Router, React Server Components)
- **Language:** [TypeScript 5](https://www.typescriptlang.org/) (Strict mode, zero `any` types)
- **Styling:** [Tailwind CSS 3](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **State Management:**
  - [Zustand 5](https://zustand-demo.pmnd.rs/) (Client state, offline queue)
  - [TanStack Query](https://tanstack.com/query) (Server state, caching)

### PWA & Offline
- **Service Worker:** [Serwist 9](https://serwist.pages.dev/) (Next.js 15 compatible, replaces next-pwa)
- **Offline Storage:** [Dexie 4](https://dexie.org/) (IndexedDB wrapper, type-safe)
- **Background Sync:** Native [Background Sync API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)

### Backend & Database
- **Database:** [Supabase PostgreSQL](https://supabase.com/) (Row-Level Security enabled)
- **Authentication:** [Supabase Auth](https://supabase.com/docs/guides/auth) (JWT-based, multi-tenant)
- **Storage:** [Supabase Storage](https://supabase.com/docs/guides/storage) (Signature images, proof of delivery)

### DevOps & Monitoring
- **Hosting:** [Vercel](https://vercel.com/) (Edge runtime, automatic deployments)
- **Testing:** [Vitest 4](https://vitest.dev/) (75.78% coverage, 72 tests)
- **CI/CD:** GitHub Actions (planned)
- **Monitoring:** Sentry + BetterStack (planned)

---

## 🔐 Multi-Tenant Architecture

### Data Isolation Strategy

Aureon uses **PostgreSQL Row-Level Security (RLS)** for database-level tenant isolation. This ensures operators can only access their own data, even if the application layer is compromised.

```sql
-- Every table includes operator_id for tenant isolation
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  operator_id UUID NOT NULL,  -- Foreign key to operators table
  order_number VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  -- ... other columns
);

-- RLS policy enforces operator isolation
CREATE POLICY "tenant_isolation" ON orders
  FOR ALL USING (operator_id = auth.operator_id());
```

### How It Works

1. **User Login:** Supabase Auth issues JWT token with `operator_id` claim
2. **Database Queries:** RLS policies automatically filter rows by `operator_id`
3. **API Calls:** JWT token validated on every request (NEVER trust frontend)
4. **Audit Trail:** All actions logged with `operator_id` for 7-year compliance

### RLS Implementation Files

- **Migration:** [`supabase/migrations/20260209_multi_tenant_rls.sql`](supabase/migrations/20260209_multi_tenant_rls.sql)
- **JWT Claims:** [`supabase/migrations/20260209000003_jwt_claims_fixed.sql`](supabase/migrations/20260209000003_jwt_claims_fixed.sql)
- **Auth Function:** [`supabase/migrations/20260209000001_auth_function.sql`](supabase/migrations/20260209000001_auth_function.sql)

**Tables Protected:**
- ✅ `operators` (tenant master data)
- ✅ `orders` (delivery orders)
- ✅ `manifests` (daily route manifests)
- ✅ `barcode_scans` (scan events)
- ✅ `audit_logs` (compliance trail)
- ✅ `user_profiles` (operator assignments)

---

## 🚀 Getting Started

### Prerequisites

- **Node.js:** v18+ (v20 recommended)
- **npm:** v9+ or yarn/pnpm
- **Supabase Account:** [Sign up free](https://supabase.com/)
- **Git:** For cloning the repository

### 1. Clone the Repository

```bash
git clone https://github.com/gerhard-tractis/aureon-last-mile.git
cd aureon-last-mile/apps/frontend
```

### 2. Install Dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
```

**Installed packages:** 542 packages (includes Vitest, React Testing Library, fake-indexeddb)

### 3. Configure Environment Variables

Create `.env.local` file in `apps/frontend/`:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Supabase credentials:

```env
# Get these from: https://supabase.com/dashboard → Your Project → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # Server-side only!
```

⚠️ **Security Warning:** NEVER commit `.env.local` or expose `SUPABASE_SERVICE_KEY` in client code!

### 4. Apply Database Migrations

**Option A: Using Supabase Dashboard (Recommended)**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Navigate to **SQL Editor**
3. Run each migration file in order:
   - `20260209000001_auth_function.sql`
   - `20260209_multi_tenant_rls.sql`
   - `20260209000002_jwt_claims.sql`
   - `20260209000003_jwt_claims_fixed.sql`

**Option B: Using Supabase CLI**
```bash
# Install Supabase CLI
npm install -D supabase

# Link to your project
npx supabase link --project-ref <your-project-ref>

# Apply migrations
npx supabase db push
```

### 5. Verify Setup

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Expected result:**
- ✅ Login page loads
- ✅ Service worker registers (check DevTools → Application → Service Workers)
- ✅ IndexedDB database created (check DevTools → Application → Storage)

---

## 💻 Development Workflow

### Running Tests

We have **75.78% code coverage** with 72 test cases across 4 critical files.

```bash
# Run all tests (watch mode)
npm test

# Run tests once (CI mode)
npm run test:run

# Generate coverage report
npm run test:coverage

# Open interactive test UI
npm run test:ui
```

**Coverage Breakdown:**
- `offline/page.tsx`: 100% (8 tests)
- `lib/offline/indexedDB.ts`: 100% (25 tests)
- `lib/stores/scanStore.ts`: 83.67% (30 tests)
- `app/sw.ts`: Logic tests (9 tests)

View coverage report: `coverage/index.html`

### Testing Offline Mode

**Method 1: Chrome DevTools**
1. Open DevTools (F12)
2. Go to **Network** tab
3. Select **Offline** from throttling dropdown
4. Test barcode scanning → should queue in IndexedDB
5. Go back **Online** → data syncs automatically

**Method 2: Service Worker Simulation**
1. Navigate to DevTools → **Application** → **Service Workers**
2. Check **Offline** checkbox
3. Reload page → should show `/offline` fallback page

**Method 3: Chrome Flags (Real PWA)**
1. Go to `chrome://flags/#enable-desktop-pwas`
2. Enable and restart Chrome
3. Install PWA from URL bar (install icon)
4. Disable network adapter → test offline functionality

### Verifying RLS Policies

**Test Multi-Tenant Isolation:**

```sql
-- 1. Create two test operators
INSERT INTO operators (id, name) VALUES
  ('op-test-1', 'Test Operator 1'),
  ('op-test-2', 'Test Operator 2');

-- 2. Create users for each operator
INSERT INTO user_profiles (user_id, operator_id) VALUES
  ('user-1', 'op-test-1'),
  ('user-2', 'op-test-2');

-- 3. Insert test data
INSERT INTO orders (operator_id, order_number, status) VALUES
  ('op-test-1', 'ORDER-A', 'pending'),
  ('op-test-2', 'ORDER-B', 'pending');

-- 4. Verify isolation (logged in as user-1)
SELECT * FROM orders;  -- Should only see ORDER-A

-- 5. Attempt cross-tenant access (should return 0 rows)
SELECT * FROM orders WHERE operator_id = 'op-test-2';  -- Returns empty!
```

**Check RLS Status:**
```sql
-- Verify RLS is enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE tablename IN ('orders', 'manifests', 'barcode_scans');

-- List all policies
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('orders', 'manifests', 'barcode_scans');
```

### IndexedDB Debugging

**Chrome DevTools:**
1. Open DevTools → **Application** tab
2. Expand **Storage** → **IndexedDB** → **AureonOfflineDB**
3. Inspect tables:
   - `scans` - Offline scan queue
   - `manifests` - Cached manifests
   - `orders` - Cached orders

**Query IndexedDB in Console:**
```javascript
// Open database
const db = await window.indexedDB.open('AureonOfflineDB');

// Check pending scans
const tx = db.transaction('scans', 'readonly');
const store = tx.objectStore('scans');
const scans = await store.getAll();
console.log('Pending scans:', scans);
```

### Code Quality Checks

```bash
# TypeScript type checking (strict mode)
npm run type-check

# ESLint (naming conventions enforced)
npm run lint

# Run all checks (recommended before commit)
npm run type-check && npm run lint && npm run test:run
```

---

## 📁 Project Structure

```
apps/frontend/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (auth)/              # Authentication routes
│   │   ├── api/                 # API routes
│   │   ├── sw.ts                # Service worker (Serwist)
│   │   ├── manifest.json        # PWA manifest
│   │   └── offline/page.tsx     # Offline fallback page
│   │
│   ├── components/              # React components (shadcn/ui)
│   │   └── ui/                  # Base UI components
│   │
│   ├── lib/
│   │   ├── stores/              # Zustand state management
│   │   │   └── scanStore.ts     # Offline scan queue
│   │   ├── offline/             # Offline functionality
│   │   │   └── indexedDB.ts     # Dexie schema (IndexedDB)
│   │   └── supabase/            # Supabase clients
│   │       ├── client.ts        # Browser client
│   │       └── server.ts        # Server client
│   │
│   └── test/                    # Test utilities
│       ├── setup.ts             # Global test setup
│       └── mocks/               # Mock implementations
│
├── supabase/
│   ├── migrations/              # Database migrations
│   │   ├── 20260209_multi_tenant_rls.sql     # RLS policies
│   │   ├── 20260209000001_auth_function.sql  # Auth helpers
│   │   └── 20260209000003_jwt_claims_fixed.sql # JWT setup
│   └── config.toml              # Supabase CLI config
│
├── public/                      # Static assets
│   ├── sw.js                    # Compiled service worker
│   └── icons/                   # PWA icons
│
├── coverage/                    # Test coverage reports (gitignored)
├── vitest.config.ts            # Vitest configuration
├── tsconfig.json               # TypeScript config
├── tailwind.config.ts          # Tailwind CSS config
├── next.config.ts              # Next.js config (with Serwist)
└── package.json                # Dependencies and scripts
```

---

## 🎯 Key Features

### ✅ Implemented (Story 1.1)

- **Multi-Tenant SaaS Architecture**
  - PostgreSQL RLS for data isolation
  - JWT-based authentication with operator claims
  - 6 protected tables with tenant_isolation policies

- **Progressive Web App (PWA)**
  - Service worker with Serwist
  - Offline fallback page (`/offline`)
  - Background sync for queued scans
  - Install to home screen capability

- **Offline-First Barcode Scanning**
  - IndexedDB storage (Dexie)
  - Zustand queue with immutable state updates
  - Automatic sync on network restoration
  - Retry logic for failed syncs

- **Type-Safe Development**
  - TypeScript strict mode (zero `any` types)
  - ESLint with naming conventions enforced
  - 75.78% test coverage (Vitest + React Testing Library)

### 🚧 Planned Features

- **BI Dashboard** (Story 2.1-2.5)
  - Real-time metrics for operators
  - Delivery performance analytics
  - Route optimization insights

- **Manifest Management** (Story 3.1-3.3)
  - Daily route assignment
  - Package tracking
  - Digital signatures

- **Order Processing** (Story 4.1-4.4)
  - Barcode scanning workflow
  - Delivery confirmation
  - Exception handling

---

## 🚀 Deployment

### Vercel (Frontend)

**Current Deployment:** [https://aureon-last-mile.vercel.app/](https://aureon-last-mile.vercel.app/)

**Deploy Your Own:**

1. **Connect GitHub Repository**
   - Go to [Vercel Dashboard](https://vercel.com/new)
   - Import `gerhard-tractis/aureon-last-mile`
   - Set **Root Directory:** `apps/frontend`

2. **Configure Environment Variables**
   - Add `NEXT_PUBLIC_SUPABASE_URL`
   - Add `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Add `SUPABASE_SERVICE_KEY` (server-side only)

3. **Deploy**
   - Vercel auto-deploys on push to `main`
   - Preview deployments on pull requests
   - Build time: ~2 minutes

**Environment:** Node.js 20, Next.js 15, Edge Runtime

### Supabase (Database)

**Current Project:** South America region (low latency for Chile)

**Setup:**
1. Create project at [supabase.com](https://supabase.com/dashboard)
2. Apply migrations from `supabase/migrations/`
3. Configure JWT secret in Supabase dashboard
4. Enable RLS on all tables

---

## 📚 Documentation & Resources

### Internal Documentation
- **PRD:** [`_bmad-output/planning-artifacts/prd.md`](../../_bmad-output/planning-artifacts/prd.md)
- **Architecture:** [`_bmad-output/planning-artifacts/architecture.md`](../../_bmad-output/planning-artifacts/architecture.md)
- **Database Schema:** [`_bmad-output/planning-artifacts/database-schema.md`](../../_bmad-output/planning-artifacts/database-schema.md)
- **Epics:** [`_bmad-output/planning-artifacts/epics.md`](../../_bmad-output/planning-artifacts/epics.md)
- **Story 1.1:** [`_bmad-output/implementation-artifacts/1-1-clone-and-deploy-razikus-template-skeleton.md`](../../_bmad-output/implementation-artifacts/1-1-clone-and-deploy-razikus-template-skeleton.md)

### External Resources
- [Next.js 15 Documentation](https://nextjs.org/docs)
- [Supabase Row-Level Security Guide](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Serwist PWA Setup](https://serwist.pages.dev/docs/next/getting-started)
- [Dexie IndexedDB Tutorial](https://dexie.org/docs/Tutorial/)
- [Zustand State Management](https://zustand-demo.pmnd.rs/)

### Community & Support
- **GitHub Issues:** [Report bugs or request features](https://github.com/gerhard-tractis/aureon-last-mile/issues)
- **Slack:** #aureon-dev (internal team)
- **Email:** dev@tractis.com

---

## 🧪 Testing Philosophy

We maintain **>70% code coverage** as a baseline requirement. Our testing strategy:

1. **Unit Tests (Vitest)**
   - State management (Zustand stores)
   - Utility functions
   - Data transformations
   - IndexedDB operations

2. **Integration Tests**
   - RLS policy enforcement
   - Authentication flows
   - API endpoint security

3. **Component Tests (React Testing Library)**
   - User interactions
   - Accessibility (a11y)
   - Responsive design

4. **E2E Tests (Planned - Playwright)**
   - Critical user journeys
   - PWA installation
   - Offline scenarios

**Test Data:**
- Use `fake-indexeddb` for database tests
- Mock Supabase client for isolation
- Never test against production database

---

## 🔧 Troubleshooting

### Service Worker Not Registering

**Symptom:** No service worker in DevTools → Application → Service Workers

**Solution:**
1. Ensure you're on **HTTPS** or **localhost**
2. Check browser console for errors
3. Verify `public/sw.js` exists (auto-generated on build)
4. Clear cache and hard reload (`Ctrl+Shift+R`)

```bash
# Rebuild service worker
npm run build
npm run dev
```

### IndexedDB Not Working

**Symptom:** No `AureonOfflineDB` in DevTools → Application → Storage

**Solution:**
1. Check browser console for `IndexedDB` errors
2. Verify `src/lib/offline/indexedDB.ts` is imported
3. Clear IndexedDB: DevTools → Application → Storage → IndexedDB → Delete

```javascript
// Manually initialize in browser console
import { db } from '@/lib/offline/indexedDB';
await db.open();
```

### RLS Policies Blocking Queries

**Symptom:** Empty results when querying database

**Solution:**
1. Verify JWT token includes `operator_id` claim
2. Check user is assigned to operator in `user_profiles`
3. Verify RLS policies allow current user

```sql
-- Check current user's operator_id
SELECT auth.operator_id();

-- Temporarily disable RLS for debugging (NEVER in production!)
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
SELECT * FROM orders;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
```

### Build Failures on Vercel

**Common Causes:**
- TypeScript errors (run `npm run type-check` locally)
- ESLint errors (run `npm run lint` locally)
- Missing environment variables (check Vercel dashboard)
- Node.js version mismatch (use Node 20)

**Debug Steps:**
1. Check Vercel build logs
2. Replicate build locally: `npm run build`
3. Verify `.env` variables match Vercel settings

---

## 🤝 Contributing

### Development Guidelines

1. **Naming Conventions**
   - Database: `snake_case` (tables, columns)
   - TypeScript: `camelCase` (variables, functions)
   - Components: `PascalCase` (React components)
   - Constants: `SCREAMING_SNAKE_CASE`

2. **Code Quality**
   - Maintain >70% test coverage
   - Zero TypeScript errors (strict mode)
   - All ESLint rules passing
   - Write tests for new features

3. **Git Workflow**
   - Create feature branches from `main`
   - Write descriptive commit messages
   - Request code review before merging
   - Squash commits when merging

4. **Security**
   - NEVER commit `.env.local` or secrets
   - NEVER use `service_role` key in client code
   - Always validate JWT tokens server-side
   - Test RLS policies for every new table

### Pull Request Process

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes and write tests
3. Run quality checks: `npm run lint && npm run type-check && npm test:run`
4. Commit with message: `git commit -m "feat: add your feature"`
5. Push branch: `git push origin feature/your-feature`
6. Open pull request on GitHub
7. Wait for CI checks to pass
8. Request review from team
9. Merge when approved

---

## 📄 License

Copyright © 2026 Tractis. All rights reserved.

---

## 🙏 Acknowledgments

Built with:
- [Razikus Supabase-Next.js Template](https://github.com/Razikus/supabase-nextjs-template) - Base template
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [Supabase](https://supabase.com/) - Database and authentication
- [Vercel](https://vercel.com/) - Hosting and deployment

---

**🚀 Ready to build the future of last-mile logistics in Chile!**

For questions or support, contact: dev@tractis.com
