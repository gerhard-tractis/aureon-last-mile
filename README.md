# Aureon Last Mile 📦

> **Offline-First Last-Mile Logistics Management Platform for Chile**

[![Live Demo](https://img.shields.io/badge/demo-live-green?style=flat-square)](https://aureon-last-mile.vercel.app/)
[![Test Coverage](https://img.shields.io/badge/coverage-75.78%25-brightgreen?style=flat-square)](apps/frontend/coverage)

---

## 📖 Overview

Aureon Last Mile is a multi-tenant SaaS platform that enables Chilean logistics operators to manage last-mile deliveries with **offline-first capabilities**. Drivers can scan package barcodes without internet connectivity, and data automatically syncs when network is restored.

### Key Features

- **🔌 Offline-First PWA:** Works without internet using service workers and IndexedDB
- **👥 Multi-Tenant:** Secure operator isolation via PostgreSQL Row-Level Security
- **📱 Mobile-Ready:** Progressive Web App installable on iOS/Android
- **⚡ Real-Time Sync:** Automatic background synchronization
- **📊 Analytics:** BI dashboards for performance tracking

---

## 📁 Monorepo Structure

```
aureon-last-mile/
├── apps/
│   ├── frontend/          ← Main Next.js application (see apps/frontend/README.md)
│   └── mobile/            ← React Native app (future)
│
├── _bmad-output/          ← BMAD planning artifacts
│   ├── planning-artifacts/
│   │   ├── prd.md                    # Product Requirements Document
│   │   ├── architecture.md           # System architecture
│   │   ├── database-schema.md        # Database design
│   │   └── epics.md                  # Epic/Story breakdown
│   └── implementation-artifacts/
│       └── 1-1-clone-and-deploy-razikus-template-skeleton.md
│
├── .claude/              ← Claude Code configuration
└── README.md             ← This file
```

---

## 🚀 Quick Start

### Frontend Application

The main application lives in `apps/frontend/`:

```bash
cd apps/frontend
npm install
npm run dev
```

**📚 Full documentation:** [apps/frontend/README.md](apps/frontend/README.md)

### Key Commands

```bash
# Development
npm run dev              # Start dev server

# Testing
npm test                 # Run tests (watch mode)
npm run test:coverage   # Generate coverage report

# Production
npm run build           # Build for production
npm run start           # Start production server

# Quality Checks
npm run lint            # Run ESLint
npm run type-check      # TypeScript validation
```

---

## 🏗️ Tech Stack

- **Frontend:** Next.js 15, React 19, TypeScript 5
- **Database:** Supabase PostgreSQL (RLS enabled)
- **PWA:** Serwist service worker, Dexie IndexedDB
- **State:** Zustand (local), TanStack Query (server)
- **Styling:** Tailwind CSS, shadcn/ui
- **Testing:** Vitest, React Testing Library (75.78% coverage)
- **CI/CD:** GitHub Actions (CI on every commit, manual deployment)
- **Hosting:** Vercel (frontend), Supabase (database)

---

## 🔐 Multi-Tenant Architecture

Aureon uses **PostgreSQL Row-Level Security (RLS)** for tenant isolation:

- Every table includes `operator_id` for data segregation
- RLS policies automatically filter queries by operator
- JWT tokens include `operator_id` claim
- 6 protected tables with tenant_isolation policies

**Learn more:** [Multi-Tenant Architecture](apps/frontend/README.md#-multi-tenant-architecture)

---

## 📊 Project Status

### ✅ Completed (Story 1.1)

- [x] Multi-tenant RLS implementation
- [x] PWA with offline-first capabilities
- [x] Deployed to Vercel (manual deployment)
- [x] 75.78% test coverage (72/72 tests passing)
- [x] CI/CD pipeline (GitHub Actions - CI only, manual deploy)
- [x] Architectural Decision Records (4 ADRs)
- [x] Comprehensive documentation (README, ADRs, workflow guides)

### 🚧 In Progress

- [ ] Task 6.3-6.4: Complete CI/CD setup (branch protection, testing)
- [ ] Task 7: Monitoring and alerting (Sentry, BetterStack)
- [ ] Task 8: Final documentation and validation

### 📋 Planned

- Story 2.1-2.5: BI Dashboard
- Story 3.1-3.3: Manifest Management
- Story 4.1-4.4: Order Processing

---

## 🚀 Deployment & CI/CD

### CI/CD Pipeline
- **Strategy:** CI always, manual deployment (cost control)
- **CI:** GitHub Actions runs on every push/PR (type-check, lint, test, build)
- **Deployment:** Manual via Vercel dashboard or CLI
- **Documentation:** [.github/workflows/README.md](.github/workflows/README.md)
- **Cost Savings:** ~90% reduction vs auto-deploy (8 vs 80 deploys/month)

### Quick Deploy
```bash
# Option 1: Vercel Dashboard
# → Go to Vercel → Click "Deploy" button

# Option 2: CLI
cd apps/frontend && npx vercel --prod
```

**Full Guide:** [.github/workflows/README.md](.github/workflows/README.md)

---

## 📚 Documentation

### Planning Artifacts (BMAD)

- [Product Requirements Document](/_bmad-output/planning-artifacts/prd.md)
- [Architecture Specification](/_bmad-output/planning-artifacts/architecture.md)
- [Database Schema](/_bmad-output/planning-artifacts/database-schema.md)
- [Epics & Stories](/_bmad-output/planning-artifacts/epics.md)

### Architectural Decision Records (ADRs)

- [ADR-001: PWA Library Selection](/_bmad-output/architectural-decisions/ADR-001-pwa-library-selection.md) - Serwist vs Workbox
- [ADR-002: Multi-Tenant Isolation Strategy](/_bmad-output/architectural-decisions/ADR-002-multi-tenant-isolation-strategy.md) - RLS vs App-Level
- [ADR-003: Offline Storage Design](/_bmad-output/architectural-decisions/ADR-003-offline-storage-design.md) - IndexedDB Schema
- [ADR-004: Monorepo Structure](/_bmad-output/architectural-decisions/ADR-004-monorepo-structure.md) - Workspaces vs Polyrepo

### Implementation

- [Frontend README](apps/frontend/README.md) - Complete setup guide
- [Story 1.1 Implementation](/_bmad-output/implementation-artifacts/1-1-clone-and-deploy-razikus-template-skeleton.md)

### External Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase RLS Guide](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Serwist PWA Setup](https://serwist.pages.dev/docs/next/getting-started)

---

## 🤝 Contributing

1. Read the [Frontend README](apps/frontend/README.md) for detailed guidelines
2. Follow naming conventions (DB: `snake_case`, TS: `camelCase`)
3. Maintain >70% test coverage
4. Run quality checks before committing: `npm run lint && npm run type-check && npm test:run`

---

## 📄 License

Copyright © 2026 Tractis. All rights reserved.

---

## 🙏 Acknowledgments

Built with [Razikus Supabase-Next.js Template](https://github.com/Razikus/supabase-nextjs-template)

---

**Live Demo:** [https://aureon-last-mile.vercel.app/](https://aureon-last-mile.vercel.app/)

For questions or support, contact: dev@tractis.com
