---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - 'product-brief-Aureon_Last_Mile-2026-02-04.md'
  - 'prd.md'
  - 'ux-design-specification.md'
  - 'mockups/README.md'
  - 'mockups/ux-design-directions.html'
  - 'mockups/operations-control-center-desktop.html'
  - 'mockups/operations-control-center-mobile.html'
  - 'mockups/pickup-verification-mobile.html'
  - 'mockups/business-owner-dashboard-desktop.html'
workflowType: 'architecture'
project_name: 'Aureon_Last_Mile'
user_name: 'Gerhard'
date: '2026-02-06'
mvpPriority:
  - 'Weeks 1-2: BI Dashboard (Business Intelligence Foundation)'
  - 'Weeks 3-4: Pickup Verification Mobile App'
implementationTimeline: '4 weeks total (parallel development possible)'
techStack:
  frontend: 'Vercel (Next.js 14 App Router)'
  backend: 'Railway (Node.js/Express + Background Workers)'
  database: 'Supabase (PostgreSQL with RLS)'
  auth: 'Supabase Auth (JWT + RBAC)'
  realtime: 'Supabase Realtime (WebSockets)'
  storage: 'Supabase Storage'
  jobQueue: 'BullMQ on Railway'
  integration: 'n8n (self-hosted on Railway)'
starterTemplate:
  selected: 'Razikus Supabase-Next.js Template + PWA Enhancement'
  repo: 'https://github.com/Razikus/supabase-nextjs-template'
  features:
    - 'Next.js 15 (backwards compatible)'
    - 'Supabase with RLS policies'
    - 'Multi-tenant organizations'
    - 'Authentication + user management'
    - 'File storage + task management'
  pwaAddition:
    library: 'Serwist (service worker)'
    storage: 'IndexedDB (Dexie)'
    sync: 'Background Sync API'
  rationale: 'Production multi-tenant foundation + manageable PWA addition for 4-week MVP timeline'
architecturalDecisions:
  apiDesign: 'REST API with OpenAPI/Swagger documentation'
  stateManagement:
    local: 'Zustand (offline queue, UI state, filters)'
    server: 'TanStack Query (API responses, caching, background refetch)'
  dataModeling:
    - 'Multi-tenant isolation (operator_id on all tables)'
    - 'Audit logs (append-only, 7-year retention)'
    - 'Raw + normalized data storage (integration resilience)'
    - 'Soft deletes (deleted_at timestamp)'
  errorHandling:
    format: 'Standardized JSON with code, message, details, field, timestamp, request_id'
    statusCodes: 'Standard HTTP (400, 401, 403, 404, 409, 422, 429, 500, 503)'
    display: 'Toast notifications, inline validation, modal dialogs, error boundaries'
  caching:
    frontend: 'TanStack Query (30s stale, 60s background refresh)'
    api: 'Redis on Railway (5min metrics, 15min lists, 1hr rules)'
    cdn: 'Vercel (static assets cached forever with hash-based filenames)'
    offline: 'Service Worker + IndexedDB (app shell, scan queue, manifests)'
  migrations: 'Supabase Migrations (SQL files in Git, CLI-based deployment)'
  monitoring:
    errors: 'Sentry (5K/month free tier)'
    performance: 'Vercel Analytics + Railway Dashboard'
    uptime: 'BetterStack or UptimeRobot'
    logging: 'Structured logs with request IDs on Railway'
  cicd: 'GitHub Actions (CI: test → type-check → lint → build; CD: manual deployment for cost control)'
  apiDocs: 'OpenAPI/Swagger (interactive docs at /api/docs)'
  pdfGeneration: 'Client-side jsPDF (offline-capable for mobile PWA)'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

---

## Project Context Analysis

### Requirements Overview

**Functional Requirements Summary:**

Aureon Last Mile encompasses **82 functional requirements** organized into 13 categories:

1. **BI Dashboard & Data Ingestion (FR1-FR11)**: Business intelligence foundation providing customer volume analysis, geographic heatmaps, capacity utilization tracking, SLA performance metrics, and report exports in CSV/PDF formats. Multiple data ingestion methods (retailer APIs, email manifest parsing, manual CSV uploads) with historical data storage for trend analysis.

2. **Pickup Verification Mobile (FR12-FR19)**: Mobile-first barcode scanning workflow for pickup crews at retailer distribution centers. Includes real-time verification status, offline-first capability with local scanning and background sync, discrepancy detection before signing, digital signature capture, and PDF receipt generation with complete audit trails.

3. **Hub Reception & Reconciliation (FR20-FR23)**: Systematic package logging at operator hub with automatic reconciliation against signed pickup manifests, distinguishing between retailer shortages (never received) and internal handling issues, with full accountability tracking (timestamp, user, operator context).

4. **Warehouse/Inventory WMS (FR24-FR28)**: Location-based inventory tracking with barcode scanning for package movements, real-time search by order number, location history for theft investigation support, and reconciliation reports comparing signed manifests versus received inventory.

5. **Loading & Sectorization (FR29-FR37)**: Configurable loading workflows (immediate scan-and-load vs batch scanning based on hub layout), sectorization rules enforcement with comuna/district-to-zone mappings, real-time loading progress tracking, and automatic route creation in operator's preferred routing tool (SimpliRoute, Beetrack, Driv.in) via API.

6. **Capacity Planning (FR38-FR41)**: Real-time order visibility from retailer e-commerce systems, automated alerts when retailers exceed capacity limits, forecast accuracy tracking (predicted vs actual), enabling 1-2 day advance resource planning.

7. **Integration Hub (FR42-FR49)**: Multi-retailer API integrations (Falabella, Shopee, Mercado Libre, Ripley, Paris), last-mile routing tool integrations with bidirectional status sync, webhook-based delivery status transformation and distribution to each retailer's required JSON format, with graceful degradation to email parsing when APIs unavailable.

8. **User Management & Auth (FR50-FR58)**: Role-based access control (pickup crew, warehouse staff, loading crew, operations managers, admins) with JWT-based authentication, secure session management, and strict tenant isolation ensuring operators cannot access other operators' data.

9. **AI Support Agent (FR59-FR64)**: Natural language chat interface for troubleshooting, querying audit logs and system diagnostics, providing recommendations for common issues, escalating complex cases to human support, and suggesting security camera footage timestamps based on package location audit trails.

10. **Platform Administration (FR65-FR70)**: Tenant provisioning with environment configurations, retailer API integration setup, real-time platform health monitoring (uptime, performance, error rates), customer usage analytics, SLA threshold alerting, and infrastructure scaling management.

11. **Multi-Tenancy (FR71-FR75)**: PostgreSQL Row-Level Security for data isolation, operator-specific settings configuration (sectorization rules, hub layout, branding), subscription tier tracking (Starter, Growth, Enterprise) with usage limits enforcement, overage charge calculation, and billing history visibility.

12. **Configuration Management (FR76-FR78)**: Sectorization rule definition, automated zone assignment validation, and suggested assignments based on address and rules.

13. **Audit & Compliance (FR79-FR82)**: Comprehensive data access logging (user_id, operator_id, timestamp, action, IP address), 7-year audit log retention per Chilean commercial law, and encryption of sensitive data at rest with operator-specific keys.

**Architectural Implications:**
- **Multi-tenant SaaS** requires PostgreSQL RLS policies at database level
- **Offline-first mobile** demands IndexedDB local storage, background sync queues, conflict resolution
- **Real-time updates** need WebSocket connections for live dashboard data
- **Integration orchestration** requires retry queues, webhook handling, data transformation pipelines
- **Role-based workflows** demand distinct UI/UX per user type with permission enforcement at API and database layers

---

### Non-Functional Requirements

**Performance (NFR-P1 to NFR-P5):**
- BI dashboard initial load: ≤2 seconds on 10 Mbps broadband
- Operational mobile screens: ≤1.5 seconds on 4G
- API response times: ≤200ms p95 for reads, ≤500ms p95 for writes
- Barcode scan processing: ≤100ms per scan
- Database queries: ≤300ms for order lookups, ≤2s for BI aggregations
- Offline sync on reconnection: ≤30 seconds for 500 records
- Support 100+ concurrent users across all operators, 20+ per individual operator during peak

**Security (NFR-S1 to NFR-S6):**
- TLS 1.3 for all data in transit, AES-256 for data at rest
- PostgreSQL Row-Level Security for 100% tenant data isolation
- JWT-based authentication with ≤24 hour token expiration
- Role-based access control (RBAC) enforced at API and UI layers
- Rate limiting: 1000 req/min per operator, 100 req/min per user
- Comprehensive audit logging with 7-year retention
- Automated daily backups with 30-day retention, encrypted with separate keys

**Scalability (NFR-SC1 to NFR-SC5):**
- Scale from 1 operator (MVP) to 50+ operators within 12 months without architectural changes
- Handle 4x peak load spikes (Cyberdays) without manual intervention
- Order volume tiers: Starter (5K/month), Growth (50K/month), Enterprise (100K+/month)
- Auto-scaling API servers based on CPU utilization (target 70%)
- Support up to 10 retailer integrations per operator

**Reliability (NFR-R1 to NFR-R6):**
- Uptime SLA: 99% (Starter), 99.9% (Growth), 99.95% (Enterprise)
- Recovery Time Objective (RTO): ≤4 hours for critical services
- Recovery Point Objective (RPO): ≤15 minutes for transactional data
- Graceful error handling with actionable error messages
- Failed background jobs auto-retry with exponential backoff (3 retries over 15 minutes)
- Real-time monitoring with automated alerts (error rate >1%, API p95 >1s, DB connections >80%)

**Integration (NFR-I1 to NFR-I6):**
- Retailer API integrations maintain 99%+ uptime from Aureon perspective
- Graceful degradation: API → email parsing → manual entry fallback chain
- API versioning (/v1/, /v2/) with 12-month deprecation support
- Order status updates pushed to retailers within 5 minutes
- Sandbox environment for retailer integration testing

---

### Scale & Complexity Assessment

**Project Complexity: Medium-High**

**Complexity Indicators:**
- ✅ **Multi-tenancy**: PostgreSQL RLS, operator-specific encryption, tenant isolation
- ✅ **Real-time features**: Live dashboard updates, concurrent user coordination
- ✅ **Offline-first mobile**: Local storage, background sync, conflict resolution
- ✅ **Integration orchestration**: Multiple retailer APIs, routing tools, webhook transformations
- ✅ **Role-based workflows**: 5 distinct user types with different interfaces and permissions
- ✅ **Regulatory compliance**: 7-year audit retention, Chilean commercial law requirements
- ✅ **High-volume operations**: 100-200 orders per trip, 4x peak load handling
- ✅ **Background processing**: Nightly batch jobs, retry queues, scheduled tasks

**Primary Technical Domain:** Full-Stack (Backend API + Web Dashboards + Mobile PWA)

**Estimated Architectural Components:**
- Frontend Applications: 2 (BI Dashboard desktop, Pickup Verification mobile PWA)
- Backend Services: 1 API layer + Background job workers
- Database: PostgreSQL with multi-tenant RLS
- Real-time: WebSocket connections for live updates
- Storage: File storage for PDFs, digital signatures
- Integration Layer: Retailer API connectors, routing tool integrations
- Auth System: JWT-based with RBAC
- Background Jobs: Queue system for async processing

---

### Technical Constraints & Dependencies

**Team & Timeline:**
- **Team size**: 1 full-stack developer (Gerhard) + AI development tools (Claude Code CLI, GitHub Copilot)
- **MVP timeline**: 4 weeks total (2 weeks BI Dashboard + 2 weeks Pickup Verification)
- **Development velocity**: AI-powered SDD enables 10x faster development than traditional approaches
- **First customer**: Active collaboration during MVP for requirements validation and beta testing

**Technology Stack (Confirmed):**

**Frontend:**
- **Platform**: Vercel (Next.js 14 App Router)
- **BI Dashboard**: Desktop web application with responsive design
- **Mobile PWA**: Offline-first progressive web app for pickup crews
- **Deployment**: Manual deployment via dashboard/CLI (cost control), global CDN
- **Cost**: Free tier for MVP

**Backend API + Workers:**
- **Platform**: Railway (Node.js/Express or Next.js API)
- **Capabilities**: No timeout limits, background job workers, long-running batch processes
- **Job Queue**: BullMQ for background task processing
- **Deployment**: Manual deployment (cost control)
- **Cost**: ~$5-20/month for MVP, scales with usage

**Database + Services:**
- **Platform**: Supabase
- **Database**: PostgreSQL with Row-Level Security (RLS) policies
- **Auth**: JWT-based authentication, RBAC, user management (built-in)
- **Real-time**: WebSocket subscriptions for live data (built-in)
- **Storage**: File storage for PDFs, digital signatures (built-in)
- **Edge Functions**: Serverless functions for integration orchestration
- **Cost**: Free tier for MVP, ~$25/month Pro tier at 5-10 customers

**Rationale for Stack Choice:**
- **Supabase PostgreSQL RLS**: Solves multi-tenant isolation requirement (NFR-S2) out-of-box
- **Supabase Auth**: Provides JWT, RBAC, session management (FR50-FR58) without custom implementation
- **Railway**: Handles bulk operations (100-200 orders), no serverless timeout limits, background workers
- **Vercel**: Optimized for Next.js, fast CDN delivery, perfect for frontend hosting
- **Combined**: Fast MVP iteration, managed services reduce DevOps overhead, scales to production workload

**External Dependencies:**
- **Retailer APIs**: Falabella, Shopee, Mercado Libre, Ripley, Paris (Priority Tier 1-2)
- **Routing Tools**: SimpliRoute, Beetrack, Driv.in APIs
- **Email Service**: For manifest parsing when APIs unavailable
- **Chart Library**: Chart.js for BI dashboard visualizations (from mockups)

**Infrastructure Requirements:**
- **Hosting**: Cloud-based (Vercel + Railway + Supabase), no on-premise infrastructure
- **SSL/TLS**: Automatic via platform providers (TLS 1.3 requirement met)
- **CDN**: Vercel global CDN for frontend assets
- **Backups**: Automated daily via Supabase (30-day retention)
- **Monitoring**: Vercel Analytics, Railway metrics, Supabase dashboard

---

### Cross-Cutting Concerns Identified

**1. Multi-Tenant Data Isolation**
- **Concern**: Operators must never access other operators' data (NFR-S2, FR71)
- **Architectural Impact**:
  - PostgreSQL Row-Level Security (RLS) policies enforce isolation at database level
  - All queries automatically filtered by `tenant_id`/`operator_id`
  - Supabase RLS policies defined per table
  - API layer validates tenant context on every request
  - Frontend components filtered by authenticated operator
- **Affected Components**: Database schema, API endpoints, UI components, authentication middleware

**2. Offline-First Mobile Architecture**
- **Concern**: Pickup crews work in areas with unreliable connectivity (warehouses, loading docks)
- **Architectural Impact**:
  - Service Workers for offline PWA functionality
  - IndexedDB for local scan queue storage
  - Background Sync API for automatic upload when connection restored
  - Optimistic UI updates (scan → save locally → show success → sync background)
  - Conflict resolution for concurrent edits
  - Offline indicator UI state
- **Affected Components**: Mobile PWA, service worker, sync engine, UI state management

**3. Real-Time Data Synchronization**
- **Concern**: Multiple users need live updates (dashboard metrics, scanning progress)
- **Architectural Impact**:
  - Supabase Realtime WebSocket subscriptions for database changes
  - Frontend components subscribe to relevant data streams
  - Efficient query patterns to avoid over-fetching
  - Optimistic updates with server reconciliation
- **Affected Components**: BI Dashboard, operations monitoring, pickup progress tracking

**4. Role-Based Access Control (RBAC)**
- **Concern**: 5 user roles with distinct permissions and interfaces (FR50-FR56)
- **Architectural Impact**:
  - JWT tokens include `role` claim
  - API middleware validates role permissions per endpoint
  - Database RLS policies filter by role
  - Frontend routing guards by role
  - Distinct UI layouts per role (pickup crew mobile, manager desktop)
- **Affected Components**: Auth system, API middleware, database policies, frontend routing, UI components

**5. Audit Logging & Compliance**
- **Concern**: 7-year retention for Chilean commercial law, shortage claim disputes (FR79-FR82)
- **Architectural Impact**:
  - Comprehensive logging middleware captures all data access
  - Separate audit_logs table with long-term retention policy
  - Log structure: user_id, operator_id, timestamp, action, resource_type, resource_id, IP address
  - Immutable logs (append-only, no deletes)
  - Indexed for efficient querying during investigations
- **Affected Components**: API middleware, database schema, admin reporting tools

**6. Integration Orchestration Layer**
- **Concern**: Coordinate between multiple retailer APIs and routing tools with different schemas (FR42-FR49)
- **Architectural Impact**:
  - Adapter pattern for each retailer/routing tool
  - Webhook receiver for inbound status updates
  - Data transformation pipelines (retailer schema → Aureon schema → routing tool schema)
  - Retry queue for failed API calls (exponential backoff)
  - Circuit breaker pattern for flaky APIs
  - Graceful degradation (API → email → manual)
- **Affected Components**: Integration workers, webhook handlers, retry queue, email parser, admin configuration UI

**7. Error Handling & Resilience**
- **Concern**: System must degrade gracefully, not fail catastrophically (NFR-R4)
- **Architectural Impact**:
  - Global error boundary in frontend (React Error Boundary)
  - API error responses with actionable messages
  - Retry logic for transient failures (network, rate limits)
  - Fallback mechanisms (API → email → manual entry)
  - Background job retry queues (BullMQ)
  - Circuit breakers for external dependencies
- **Affected Components**: Frontend error boundaries, API error handling, background job retry, integration layer

**8. Performance Optimization**
- **Concern**: Meet strict performance requirements (<2s page loads, <200ms API responses)
- **Architectural Impact**:
  - Database query optimization (indexes on tenant_id + common filters)
  - API response caching (Redis or Supabase caching)
  - Frontend code splitting (Next.js automatic)
  - Image optimization (Next.js Image component)
  - CDN for static assets (Vercel)
  - Database connection pooling
  - Lazy loading for dashboard widgets
- **Affected Components**: Database indexes, API caching layer, frontend build configuration, CDN

**9. Background Job Processing**
- **Concern**: Long-running tasks (manifest imports, nightly reconciliation, retry queues)
- **Architectural Impact**:
  - BullMQ job queue on Railway
  - Separate worker processes from API servers
  - Job priorities (urgent: retry failed API calls, normal: nightly reports)
  - Job persistence (Redis backend)
  - Monitoring and alerting for stuck jobs
- **Affected Components**: Railway workers, Redis job store, admin monitoring dashboard

**10. Authentication & Session Management**
- **Concern**: Secure JWT-based auth with 24-hour expiration, role enforcement (NFR-S3)
- **Architectural Impact**:
  - Supabase Auth handles JWT signing, verification, refresh
  - Frontend stores tokens in httpOnly cookies (XSS protection)
  - API validates JWT on every request
  - Automatic token refresh before expiration
  - Failed login lockout (5 attempts → 15 min)
- **Affected Components**: Supabase Auth configuration, API middleware, frontend auth hooks, login UI

---

## Starter Template Evaluation

### Selection Decision

**Chosen Foundation:** [Razikus Supabase-Next.js Template](https://github.com/Razikus/supabase-nextjs-template) + PWA Enhancement Layer

### Template Research Summary

**Research Conducted:** Three key areas evaluated for compatibility with project requirements:

1. **Supabase + Next.js 14 Integration Options:**
   - Official Vercel Supabase Template (minimal, cookie-based auth)
   - Nextbase (comprehensive with testing suite)
   - Hikari (includes Stripe integration)
   - Supa-Next-Starter (shadcn/ui components)

2. **PWA Offline-First Technologies:**
   - Serwist (modern service worker solution, successor to next-pwa)
   - @ducanh2912/next-pwa (popular PWA package)
   - IndexedDB + Dexie (offline data storage and sync queues)
   - Background Sync API (automatic upload when connection restored)

3. **Multi-Tenant SaaS Templates:**
   - SupaSaaS (production-ready, paid, 40+ components)
   - Razikus Template (open-source, Next.js 15, comprehensive RLS policies)
   - Makerkit (production-ready, paid)
   - Nextbase (SaaS starter with Stripe)
   - Vercel B2B Multi-Tenant Kit (Stripe + Supabase)

### Requirements Coverage Analysis

| Requirement | Coverage |
|------------|----------|
| Next.js 14 App Router | ✅ All modern templates support this |
| Supabase Integration | ✅ Multiple excellent options with RLS, Auth, Realtime |
| Offline-first PWA | ⚠️ No templates include this - requires manual integration |
| Multi-tenant Patterns | ✅ SupaSaaS, Razikus have production RLS policies |
| TypeScript | ✅ Standard in all modern templates |
| Vercel Deployment | ✅ All templates support Vercel deployment |

**Key Finding:** No single template combines all three critical features (Supabase integration, multi-tenant RLS patterns, offline-first PWA capabilities). The PWA gap is expected since most SaaS starters focus on desktop dashboards rather than offline mobile workflows.

### Rationale for Razikus Template Selection

**Why Razikus Template + PWA Enhancement (vs. Alternatives)?**

**✅ Advantages:**
- **Free and open-source** - No licensing costs, full code control
- **Production-ready multi-tenant foundation** - Secure RLS policies already implemented
- **Comprehensive Supabase integration** - Auth, file storage, task management demos included
- **Next.js 15 ready** - Backwards compatible with Next.js 14, future-proof
- **Active maintenance** - Recent updates, responsive to Next.js ecosystem changes
- **Clean architecture** - Well-documented codebase with i18n support (EN/PL/ZH)
- **PWA addition is manageable** - Serwist integration well-documented, estimated 2-3 days
- **Aligns with 4-week MVP timeline** - Starter handles foundation, focus energy on business features

**❌ Rejected Alternatives:**

1. **Option B (Vercel Official Template + Build Everything):**
   - Rejected because: Requires implementing multi-tenant RLS policies from scratch (~1 week overhead)
   - Would extend MVP timeline beyond 4 weeks
   - Unnecessary greenfield work when production patterns exist

2. **Option C (Minimal Setup - Build from Scratch):**
   - Rejected because: 2+ weeks setup time incompatible with 4-week MVP
   - Risk of missing production security patterns (RLS policies, auth flows)
   - Reinventing solved problems (multi-tenancy, file storage)

3. **SupaSaaS (Paid Template):**
   - Rejected because: $199+ licensing cost unnecessary when Razikus offers equivalent features open-source
   - Similar implementation effort to add PWA layer
   - No significant time savings to justify cost

### PWA Enhancement Strategy

**Approach:** Augment Razikus template with offline-first capabilities using modern PWA technologies.

**Technology Stack for PWA Layer:**
- **Service Worker Management:** Serwist (successor to next-pwa, better Next.js 14+ support)
- **Offline Data Storage:** IndexedDB via Dexie (type-safe, promise-based API)
- **Background Synchronization:** Background Sync API (automatic upload when connectivity restored)
- **Offline Detection:** Navigator.onLine + custom connectivity monitoring

**Implementation Components:**
1. **Service Worker Configuration:**
   - Install Serwist and configure for Next.js App Router
   - Define caching strategies (network-first for API, cache-first for assets)
   - Enable offline page fallback

2. **Offline Scan Queue:**
   - IndexedDB schema: `scan_queue` table with fields (id, order_id, barcode, timestamp, synced)
   - Optimistic UI updates (scan → save locally → show success → sync background)
   - Conflict resolution strategy for duplicate scans

3. **Background Sync:**
   - Register sync event on connectivity change
   - Batch upload queued scans to Railway API
   - Update local IndexedDB status on successful sync
   - Retry logic for failed uploads (exponential backoff)

4. **Offline UI Indicators:**
   - Connection status banner (green: online, yellow: offline, gray: syncing)
   - Queued scan count badge
   - Visual feedback on sync completion

**Estimated Implementation Time:** 2-3 days
- Day 1: Serwist setup, basic service worker, offline page
- Day 2: IndexedDB schema, scan queue logic, optimistic updates
- Day 3: Background sync, conflict resolution, testing offline scenarios

### Implementation Timeline with Starter Template

**Week 0 (Pre-Development - 2 days):**
- Clone Razikus template
- Configure Supabase project (database, auth, RLS policies)
- Deploy skeleton to Vercel (frontend) + Railway (backend)
- Add Serwist PWA layer (2-3 days overlap with Week 1)

**Weeks 1-2 (BI Dashboard):**
- Build business intelligence screens using template's component patterns
- Implement Chart.js visualizations from mockups
- Configure Supabase Realtime for live metric updates
- Test multi-tenant data isolation with sample operators

**Weeks 3-4 (Pickup Verification Mobile PWA):**
- Build mobile PWA using template's auth + RLS foundation
- Leverage IndexedDB offline queue (already implemented in Week 0)
- Implement barcode scanning, digital signature, PDF generation
- Test offline scenarios (warehouse connectivity loss, background sync)

**Total Timeline:** 4 weeks MVP delivery maintained

### References

- [Razikus Supabase-Next.js Template](https://github.com/Razikus/supabase-nextjs-template)
- [Serwist PWA Guide for Next.js](https://blog.logrocket.com/nextjs-16-pwa-offline-support/)
- [Next.js 14 PWA with Offline Support Tutorial](https://benmukebo.medium.com/build-an-offline-ready-pwa-with-next-js-14-using-ducanh2912-next-pwa-17851765fa6b)
- [Building Progressive Web Apps with Next.js](https://javascript.plainenglish.io/building-a-progressive-web-app-pwa-in-next-js-with-serwist-next-pwa-successor-94e05cb418d7)

---

## Core Architectural Decisions

_This section documents the critical architectural decisions made collaboratively to guide consistent implementation across all development phases._

### Decision Priority Analysis

**Critical Decisions (Block Implementation Without These):**
1. **API Design Pattern**: REST API (required for external integrations, mobile sync, BI dashboard)
2. **State Management**: Zustand + TanStack Query (required for offline queue, dashboard caching)
3. **Data Modeling**: Multi-tenant isolation patterns (security requirement, prevents data leaks)
4. **Error Handling**: Standardized format (ensures consistent user experience, debugging)
5. **Integration Orchestration**: n8n for email/webhook processing (handles retailer integrations)

**Important Decisions (Shape Architecture Significantly):**
6. **Caching Strategy**: Multi-layer approach (impacts performance, costs, user experience)
7. **Database Migrations**: Supabase Migrations (schema evolution, deployment safety)
8. **Monitoring & Logging**: Sentry + Railway/Vercel dashboards (production observability)
9. **CI/CD Pipeline**: GitHub Actions (code quality, deployment automation)
10. **API Documentation**: OpenAPI/Swagger (developer experience, AI agent integration)

**Deferred Decisions (Post-MVP):**
- Advanced analytics dashboards (beyond basic BI metrics)
- Multi-language support beyond Spanish (i18n already in Razikus template)
- Mobile native apps (iOS/Android) - PWA sufficient for MVP
- Advanced AI features (route optimization, predictive analytics)

---

### Data Architecture

#### **Database: Supabase PostgreSQL**
- **Version**: Latest stable (provided by Supabase managed service)
- **Rationale**:
  - Row-Level Security (RLS) solves multi-tenant isolation at database level
  - Built-in auth, real-time, storage reduce custom implementation
  - Familiar PostgreSQL for complex queries, JSON support for flexible data
- **Affects**: All data persistence, queries, real-time updates

#### **Data Modeling Patterns**

**1. Multi-Tenant Isolation**
```sql
-- Every table includes operator_id
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  operator_id UUID NOT NULL,  -- Tenant identifier
  order_number VARCHAR(50),
  ...
);

-- RLS policy enforces isolation
CREATE POLICY "tenant_isolation" ON orders
  FOR ALL USING (operator_id = auth.operator_id());
```
- **Rationale**: Security requirement (NFR-S2), prevents accidental or malicious cross-tenant access
- **Affects**: All database tables, API queries, frontend filters

**2. Audit Log Pattern**
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
- **Rationale**: Chilean commercial law (7-year retention), shortage dispute resolution
- **Affects**: All write operations, compliance reporting, security investigations

**3. Raw + Normalized Data Storage**
```sql
CREATE TABLE retailer_orders (
  id UUID PRIMARY KEY,
  operator_id UUID NOT NULL,
  -- Normalized (internal format)
  order_number VARCHAR(50),
  customer_name VARCHAR(255),
  delivery_address TEXT,
  -- Raw (original retailer format)
  retailer_name VARCHAR(50),
  raw_data JSONB,                    -- Original JSON/CSV data
  imported_via VARCHAR(50),          -- 'API', 'EMAIL', 'MANUAL'
  imported_at TIMESTAMP
);
```
- **Rationale**: Enables re-processing if parsing errors occur, debugging integration issues, retailer format changes
- **Affects**: Integration layer, data imports, troubleshooting workflows

**4. Soft Deletes**
```sql
-- Add to all main tables
ALTER TABLE orders ADD COLUMN deleted_at TIMESTAMP NULL;

-- Queries filter deleted records
SELECT * FROM orders WHERE deleted_at IS NULL;

-- Recovery is simple
UPDATE orders SET deleted_at = NULL WHERE id = 'order-123';
```
- **Rationale**: Accidental deletion recovery, data retention compliance, audit trail
- **Affects**: All delete operations, queries, admin interfaces

#### **Migration Management: Supabase Migrations**
- **Tool**: Supabase CLI with Git-tracked SQL migration files
- **Workflow**:
  ```bash
  supabase migration new add_feature     # Create migration
  # Edit .sql file with schema changes
  supabase db reset                      # Test locally
  supabase db push                       # Deploy to production
  ```
- **Rationale**: Version-controlled schema changes, rollback support, works seamlessly with Supabase RLS
- **Affects**: Database schema evolution, deployment process, team collaboration

---

### Authentication & Security

#### **Authentication: Supabase Auth (JWT + RBAC)**
- **Provided by**: Razikus starter template + Supabase built-in
- **Features**:
  - JWT tokens with 24-hour expiration (NFR-S3)
  - Role-based access control (pickup_crew, warehouse_staff, loading_crew, operations_manager, admin)
  - Session management with httpOnly cookies (XSS protection)
  - Automatic token refresh
- **Rationale**: Production-ready auth system, saves weeks of custom implementation, meets security requirements
- **Affects**: All API endpoints, frontend routing guards, database RLS policies

#### **Security Middleware**
- **API Layer**: JWT validation on every request, rate limiting (1000 req/min per operator)
- **Database Layer**: RLS policies enforce tenant isolation + role permissions
- **Frontend Layer**: Route guards prevent unauthorized access to admin pages
- **Rationale**: Defense in depth (multiple layers), prevents common vulnerabilities (OWASP Top 10)
- **Affects**: API middleware, database policies, frontend routing

#### **Data Encryption**
- **In Transit**: TLS 1.3 for all HTTP traffic (automatic via Vercel/Railway/Supabase)
- **At Rest**: AES-256 encryption for database (Supabase managed)
- **Sensitive Fields**: Additional operator-specific keys for PII (future enhancement)
- **Rationale**: Security requirement (NFR-S1), protects customer data, regulatory compliance
- **Affects**: Infrastructure configuration, sensitive data handling

---

### API & Communication Patterns

#### **API Design: REST API**
- **Pattern**: RESTful endpoints with standard HTTP methods (GET, POST, PUT, DELETE)
- **Rationale**:
  - External integrations require REST (retailer webhooks)
  - Simple to implement, test, and debug
  - Excellent caching support (HTTP headers)
  - Universal compatibility (mobile, web, n8n)
- **Affects**: Railway backend endpoints, mobile app sync, n8n workflows
- **Example Endpoints**:
  ```
  GET    /api/orders                    # List orders
  POST   /api/orders                    # Create order
  GET    /api/orders/:id                # Get order details
  PUT    /api/orders/:id                # Update order
  DELETE /api/orders/:id                # Soft delete order
  POST   /api/manifests/import          # Import manifest (CSV/API)
  POST   /api/scans                     # Record barcode scan
  GET    /api/dashboard/metrics         # BI dashboard data
  ```

#### **API Documentation: OpenAPI/Swagger**
- **Tool**: Swagger/OpenAPI 3.0 specification
- **Interactive Docs**: Auto-generated at `/api/docs`
- **Rationale**:
  - Industry standard for REST APIs
  - Interactive testing (developers can try endpoints in browser)
  - AI agents can read spec (Claude can understand OpenAPI)
  - Auto-generate TypeScript types for frontend
- **Affects**: API development, frontend integration, AI agent implementation
- **Example**:
  ```typescript
  /**
   * @swagger
   * /api/scans:
   *   post:
   *     summary: Record barcode scan
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               barcode: { type: string }
   *               manifest_id: { type: string }
   *     responses:
   *       200:
   *         description: Scan recorded successfully
   *       409:
   *         description: Duplicate scan detected
   */
  ```

#### **Error Handling Standards**
- **Format**: Standardized JSON response for all errors
  ```json
  {
    "error": {
      "code": "BARCODE_NOT_FOUND",
      "message": "Código de barras no encontrado",
      "details": "Barcode '7804123456789' not in manifest",
      "field": "barcode",
      "timestamp": "2026-02-06T14:30:22Z",
      "request_id": "req_abc123"
    }
  }
  ```
- **HTTP Status Codes**: Standard codes (400 validation, 401 auth, 403 forbidden, 404 not found, 409 conflict, 429 rate limit, 500 server error, 503 unavailable)
- **Frontend Display**: Toast notifications, inline validation, modal dialogs, error boundaries
- **Rationale**: Consistent user experience, easy debugging via request_id, AI agents can parse errors uniformly
- **Affects**: All API endpoints, frontend error handling, logging

#### **Rate Limiting**
- **Strategy**: Token bucket algorithm
- **Limits**:
  - Per operator: 1000 requests/minute
  - Per user: 100 requests/minute
  - Burst allowance: 20 requests
- **Rationale**: Prevent abuse, protect infrastructure, ensure fair resource allocation
- **Affects**: API middleware, error responses (429 status)

#### **Integration Orchestration: n8n**
- **Platform**: n8n (self-hosted on Railway)
- **Purpose**: Handle retailer integrations, email parsing, webhook transformations
- **Workflows**:
  1. **Email Manifest Import**: IMAP → Parse CSV → POST to Railway API
  2. **Retailer API Polling**: Scheduled fetch → Transform data → POST to Railway API
  3. **Webhook Receiver**: Retailer status updates → Transform → Update database
  4. **Fallback Chain**: API → Email → Manual upload
- **Rationale**:
  - Visual workflow builder (non-developers can modify)
  - Separates integration logic from core app
  - Built-in retry, error handling, logging
  - Handles CSV emails with cron jobs (real-world retailer reality)
- **Affects**: Retailer integrations, data import workflows, webhook handling
- **Example n8n Workflow**:
  ```
  [IMAP Email Trigger] → Every 5 minutes check inbox
    ↓
  [Filter: Subject contains "Manifiesto"] → Only process manifest emails
    ↓
  [Download Attachment] → Get CSV file
    ↓
  [CSV Parser] → Parse rows to JSON
    ↓
  [Data Transformation] → Retailer schema → Aureon schema
    ↓
  [HTTP POST] → POST to Railway API /api/manifests/import
    ↓
  [Mark Email as Processed] → Move to "Processed" folder
  ```

---

### Frontend Architecture

#### **State Management**

**Local State: Zustand**
- **Version**: Latest stable (v4.x)
- **Purpose**: Client-side UI state, offline queue, sync status
- **Rationale**:
  - Lightweight (3KB), simple API (similar to useState)
  - Excellent TypeScript support
  - Built-in persistence middleware (localStorage/IndexedDB)
  - Perfect for offline scan queue
- **Affects**: Offline PWA, scan queue, UI filters, sync indicators
- **Example**:
  ```typescript
  // Offline scan queue store
  const useScanStore = create(
    persist(
      (set) => ({
        scans: [],
        addScan: (barcode) => set((state) => ({
          scans: [...state.scans, { barcode, synced: false, timestamp: Date.now() }]
        })),
        markSynced: (barcode) => set((state) => ({
          scans: state.scans.map(s => s.barcode === barcode ? { ...s, synced: true } : s)
        }))
      }),
      { name: 'scan-queue-storage' }
    )
  )
  ```

**Server State: TanStack Query**
- **Version**: v5.x (React Query)
- **Purpose**: API data fetching, caching, background refetching
- **Rationale**:
  - Automatic caching reduces API calls
  - Built-in loading/error states
  - Background refetch keeps data fresh
  - Optimistic updates for better UX
- **Affects**: BI Dashboard, order lists, customer data, all API interactions
- **Example**:
  ```typescript
  // Dashboard metrics with auto-refresh
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-metrics', operatorId],
    queryFn: () => fetchDashboardMetrics(operatorId),
    staleTime: 30000,        // Consider fresh for 30s
    refetchInterval: 60000   // Background refresh every 60s
  })
  ```

#### **Component Architecture**
- **Pattern**: Razikus template patterns (already established)
- **UI Library**: Tailwind CSS + shadcn/ui components (from template)
- **Structure**: Feature-based organization (dashboard/, pickup/, manifests/)
- **Rationale**: Leverage template's proven patterns, maintain consistency
- **Affects**: Code organization, component reusability, styling

#### **Routing Strategy**
- **Platform**: Next.js 14 App Router
- **Guards**: Middleware checks auth + role before rendering
- **Rationale**: Built-in to Next.js, server-side rendering support, automatic code splitting
- **Affects**: Page routing, role-based access control, SEO

#### **Performance Optimization**
- **Code Splitting**: Automatic via Next.js
- **Image Optimization**: Next.js Image component (automatic)
- **Bundle Analysis**: Use @next/bundle-analyzer in development
- **Lazy Loading**: Dashboard widgets load progressively
- **Rationale**: Meet NFR-P1 (≤2s page loads), reduce initial bundle size
- **Affects**: Build configuration, component loading patterns

---

### Infrastructure & Deployment

#### **Hosting Strategy**

**Frontend: Vercel (Next.js 14 App Router)**
- **Rationale**: Optimized for Next.js, global CDN, controlled deployments, Edge Functions
- **Features**: Manual deployment for cost control, CI via GitHub Actions, Edge Functions
- **Note**: Auto-deploy disabled to prevent excessive deployment costs (~90% cost savings)
- **Cost**: Free tier for MVP
- **Affects**: Frontend deployment, CDN delivery, preview environments

**Backend + Workers: Railway (Node.js/Express + n8n)**
- **Rationale**:
  - No timeout limits (handles 100-200 order manifests)
  - Background workers (BullMQ)
  - Built-in Redis (for BullMQ + caching)
  - Single-click n8n deployment
- **Features**: Manual deployment, environment variables, persistent storage
- **Cost**: ~$5-20/month MVP
- **Affects**: API hosting, background jobs, n8n workflows, job queues

**Database + Services: Supabase**
- **Components**: PostgreSQL, Auth, Realtime, Storage, Edge Functions
- **Rationale**: All-in-one platform, managed services, excellent DX
- **Cost**: Free tier MVP, ~$25/month Pro at 5-10 customers
- **Affects**: Data persistence, authentication, real-time updates, file storage

#### **Caching Strategy**

**Layer 1: Frontend (TanStack Query)**
- Dashboard metrics: **30 seconds** stale time, **60 seconds** background refresh
- Customer lists: **5 minutes** stale time
- Order details: **1 minute** stale time
- **Rationale**: Balance freshness vs performance, reduce unnecessary API calls

**Layer 2: API (Redis on Railway)**
- SLA calculations: **5 minutes** TTL
- Customer/retailer lists: **15 minutes** TTL
- Sectorization rules: **1 hour** TTL
- Real-time order status: **No cache** (use Supabase Realtime)
- **Rationale**: Expensive queries cached longer, frequently changing data cached shorter

**Layer 3: CDN (Vercel - Automatic)**
- Static assets: **Forever** (hash-based filenames invalidate automatically)
- HTML pages: **No cache** (dynamic content)
- **Rationale**: Maximize performance for static resources, ensure dynamic content is fresh

**Layer 4: Offline (Service Worker + IndexedDB)**
- App shell: **Cache forever**, update on new deployment
- Scan queue: **Until synced** to server
- Current manifest: **Until pickup complete**
- **Rationale**: Enable offline operation, critical for warehouse connectivity issues

**Cache Invalidation**:
- User updates data → Invalidate related cache keys immediately
- Background jobs complete → Invalidate affected metrics
- Manual invalidation: Admin dashboard "Clear cache" button

#### **CI/CD Pipeline: GitHub Actions**
- **Workflow**:
  ```yaml
  on: [push, pull_request]
  jobs:
    test:
      - npm run test           # Jest unit tests
      - npm run type-check     # TypeScript compilation
      - npm run lint           # ESLint code quality
      - npm run build          # Verify build succeeds

    deploy-preview:           # On PR: Deploy preview
      - Vercel preview URL
      - Railway preview environment

    deploy-production:        # On merge to main: Deploy prod
      - Vercel production
      - Railway production
  ```
- **Rationale**: Catch bugs before production, automated testing, preview environments for review
- **Affects**: Code quality, deployment process, team collaboration

#### **Monitoring & Logging**

**Error Tracking: Sentry**
- **Free Tier**: 5,000 errors/month
- **Features**: Stack traces, error grouping, release tracking, user context
- **Rationale**: Production error visibility, understand what breaks and when
- **Affects**: Error reporting, debugging production issues

**Performance Monitoring**:
- **Vercel Analytics**: Page load times, Core Web Vitals
- **Railway Dashboard**: CPU, memory, API response times
- **Supabase Dashboard**: Query performance, connection count
- **Rationale**: Meet NFR-P1 (≤2s loads), identify bottlenecks
- **Affects**: Performance optimization priorities

**Uptime Monitoring**:
- **Tool**: BetterStack or UptimeRobot (free tier)
- **Check Interval**: Every 5 minutes
- **Alerts**: Email/SMS on downtime
- **Rationale**: Know when app is down before customers complain
- **Affects**: Incident response, uptime SLA tracking

**Structured Logging**:
- **Format**: JSON logs with request_id, operator_id, user_id, timestamp
- **Destination**: Railway logs (searchable, filterable)
- **Retention**: 30 days on Railway
- **Rationale**: Debug production issues via request_id, trace user actions
- **Affects**: Debugging workflow, customer support

**Alert Rules**:
```
🚨 Critical (immediate notification):
  - App downtime > 5 minutes
  - Error rate > 5% of requests
  - Database connections > 90%

⚠️ Warning (check within hour):
  - API p95 response time > 1 second
  - Failed background jobs > 10 in 1 hour
  - Disk usage > 80%

ℹ️ Info (weekly review):
  - New operator signups
  - Integration failures (retailer API unavailable)
  - Usage approaching tier limits
```

#### **Environment Configuration**
- **Environments**: Development (local), Preview (per PR), Production
- **Secrets Management**: Environment variables in Vercel/Railway dashboards
- **Environment Variables**:
  ```bash
  # Supabase
  NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
  SUPABASE_SERVICE_KEY=eyJ...          # Backend only

  # Railway API
  NEXT_PUBLIC_API_URL=https://api.aureon.com

  # n8n
  N8N_WEBHOOK_URL=https://n8n.aureon.com/webhook

  # External Integrations
  FALABELLA_API_KEY=xxx
  SHOPEE_API_SECRET=xxx

  # Monitoring
  SENTRY_DSN=https://xxx@sentry.io/xxx
  ```
- **Rationale**: Separate credentials per environment, never commit secrets to Git
- **Affects**: Deployment configuration, security

---

### Decision Impact Analysis

#### **Implementation Sequence**

**Phase 0: Foundation (Pre-Development - 2 days)**
1. Clone Razikus template
2. Configure Supabase (database, auth, RLS policies)
3. Deploy skeleton to Vercel + Railway
4. Add Serwist PWA layer
5. Set up n8n on Railway
6. Configure GitHub Actions CI/CD

**Phase 1: BI Dashboard (Weeks 1-2)**
1. Implement data modeling (orders, manifests tables)
2. Set up TanStack Query for dashboard metrics
3. Build Chart.js visualizations from mockups
4. Configure Redis caching for expensive queries
5. Set up Supabase Realtime for live updates
6. Implement OpenAPI documentation

**Phase 2: Pickup Verification Mobile (Weeks 3-4)**
1. Build PWA using template's auth foundation
2. Implement Zustand offline queue
3. Add barcode scanning with IndexedDB storage
4. Configure Background Sync API
5. Implement client-side PDF generation (jsPDF)
6. Test offline scenarios

**Phase 3: Integrations (Parallel with Phase 1-2)**
1. Set up n8n workflows for email parsing
2. Build retailer API adapters
3. Implement webhook receivers
4. Configure fallback chains (API → email → manual)

#### **Cross-Component Dependencies**

```
Supabase Auth (JWT)
    ↓
├─ Frontend Route Guards (role-based access)
├─ API Middleware (validates JWT on every request)
└─ Database RLS Policies (enforces tenant isolation)

TanStack Query (frontend caching)
    ↓
├─ Reduces API load (fewer requests)
├─ Improves user experience (instant navigation)
└─ Requires cache invalidation strategy (API must notify)

n8n Integration Layer
    ↓
├─ Posts to Railway API (manifest imports)
├─ Reads from retailer APIs (order sync)
└─ Sends webhooks to retailers (status updates)

Offline PWA (Zustand + IndexedDB)
    ↓
├─ Scans saved locally (instant feedback)
├─ Background Sync uploads (when online)
└─ Requires conflict resolution (duplicate scans)

Multi-Tenant RLS
    ↓
├─ All queries filtered by operator_id (automatic)
├─ Frontend components assume filtered data (trust database)
└─ API layer validates tenant context (defense in depth)
```

#### **Technology Dependency Graph**

```
Next.js 14 App Router
    ↓
├─ Vercel (hosting, CDN, deployments)
├─ TanStack Query (server state)
├─ Zustand (local state)
├─ Serwist (PWA, offline)
└─ shadcn/ui (components from template)

Railway Backend
    ↓
├─ Express (REST API)
├─ BullMQ (background jobs)
├─ Redis (job queue + caching)
└─ n8n (integration workflows)

Supabase
    ↓
├─ PostgreSQL (data persistence)
├─ Auth (JWT, RBAC)
├─ Realtime (WebSockets)
└─ Storage (PDFs, signatures)

GitHub Actions
    ↓
├─ Jest (unit tests)
├─ Playwright (E2E tests)
├─ TypeScript (type checking)
├─ ESLint (linting)
└─ Vercel + Railway (manual deployment)
```

---

### PDF Generation Strategy

#### **Approach: Client-Side (jsPDF)**
- **Library**: jsPDF (open-source, maintained)
- **Rationale**:
  - ✅ Works offline (critical for mobile PWA)
  - ✅ No server load (Railway doesn't process PDFs)
  - ✅ Faster (no API roundtrip)
  - ✅ User can generate PDF even without internet
  - ⚠️ Slightly larger JavaScript bundle (~100KB)
- **Use Cases**:
  - Pickup verification receipt (after signing manifest)
  - Delivery confirmation (after drop-off)
  - Discrepancy reports (missing/damaged items)
- **Affects**: Mobile PWA bundle size, offline capabilities
- **Example**:
  ```typescript
  import jsPDF from 'jspdf'

  const generatePickupReceipt = (manifest, scans) => {
    const doc = new jsPDF()
    doc.text('Comprobante de Retiro', 10, 10)
    doc.text(`Cliente: ${manifest.retailer_name}`, 10, 20)
    doc.text(`Órdenes escaneadas: ${scans.length}/${manifest.total_orders}`, 10, 30)
    // Add signature image
    doc.addImage(signatureDataURL, 'PNG', 10, 40, 50, 20)
    doc.save(`retiro-${manifest.id}.pdf`)
  }
  ```

---

### Architectural Trade-Offs Accepted

**1. REST over GraphQL**
- **Trade-off**: Potential over-fetching, multiple requests for related data
- **Accepted because**: External webhooks require REST anyway, simpler to implement, 4-week timeline
- **Mitigation**: Use TanStack Query to batch and cache requests

**2. Client-Side PDF over Server-Side**
- **Trade-off**: Larger JavaScript bundle, limited PDF complexity
- **Accepted because**: Offline capability is critical, mobile workers often have poor connectivity
- **Mitigation**: Use code splitting to load jsPDF only when needed

**3. Supabase Managed Service over Self-Hosted PostgreSQL**
- **Trade-off**: Vendor lock-in, less control over database configuration
- **Accepted because**: Managed RLS, auth, realtime save weeks of development, can migrate later if needed
- **Mitigation**: Use standard PostgreSQL features, avoid Supabase-specific extensions

**4. n8n for Integrations over Custom Code**
- **Trade-off**: Additional service to maintain, learning curve for n8n
- **Accepted because**: Visual workflows enable non-developers to modify, faster iteration on retailer integrations
- **Mitigation**: Keep critical business logic in main app, use n8n only for data transformation

**5. Multi-Layer Caching over Simple Caching**
- **Trade-off**: Cache invalidation complexity, multiple systems to monitor
- **Accepted because**: Performance requirements are strict (≤2s loads), reduces database load significantly
- **Mitigation**: Clear cache invalidation rules, monitoring for stale data issues

---

### Success Metrics for Architectural Decisions

**Performance:**
- ✅ BI Dashboard initial load: ≤2 seconds (measured via Vercel Analytics)
- ✅ API p95 response time: ≤200ms reads, ≤500ms writes (measured via Railway metrics)
- ✅ Offline sync: ≤30 seconds for 500 scans (measured in Pickup PWA)

**Scalability:**
- ✅ Support 100+ concurrent users across all operators (load testing)
- ✅ Handle 4x peak load (Cyberdays simulation)
- ✅ Scale from 1 to 50 operators without architectural changes

**Developer Experience:**
- ✅ New developer onboarding: ≤1 day (Razikus template + docs)
- ✅ Feature implementation: ≤50% time vs custom (AI-assisted development)
- ✅ Bug fix time: ≤1 hour average (Sentry error tracking, request_id tracing)

**Reliability:**
- ✅ Uptime: 99.9% (monitored via BetterStack)
- ✅ Error rate: <1% of requests (monitored via Sentry)
- ✅ Data loss: 0 incidents (Supabase automated backups, audit logs)

**Security:**
- ✅ Multi-tenant isolation: 0 data leaks (RLS policies, audit reviews)
- ✅ Authentication: JWT 24-hour expiration enforced (Supabase Auth)
- ✅ Rate limiting: 1000 req/min per operator enforced (API middleware)

---

## Implementation Patterns & Consistency Rules

_This section defines mandatory patterns that ensure multiple AI agents (and future development sessions) write compatible, consistent code that works together seamlessly._

### Pattern Categories Defined

**Critical Conflict Points Identified:** 5 categories where AI agents could make different implementation choices that would cause integration conflicts:

1. **Naming Conflicts**: Database, API, code naming conventions
2. **Structure Conflicts**: File organization, project structure
3. **Format Conflicts**: API responses, data exchange formats
4. **Communication Conflicts**: Events, state management patterns
5. **Process Conflicts**: Error handling, loading states

These patterns are **mandatory** for all AI agents implementing features in this codebase.

---

### Naming Patterns

#### **Database Naming Conventions (PostgreSQL/Supabase)**

**Tables: `snake_case`, plural**
```sql
-- ✅ Correct
CREATE TABLE orders (...)
CREATE TABLE barcode_scans (...)
CREATE TABLE audit_logs (...)
CREATE TABLE retailer_orders (...)

-- ❌ Incorrect
CREATE TABLE Orders (...)          -- Don't use PascalCase
CREATE TABLE order (...)           -- Don't use singular
CREATE TABLE barcodeScan (...)     -- Don't use camelCase
```

**Columns: `snake_case`**
```sql
-- ✅ Correct
user_id, created_at, operator_id, order_number, delivery_address

-- ❌ Incorrect
userId, createdAt, OrderNumber    -- Don't use camelCase or PascalCase
```

**Foreign Keys: `referenced_table_singular_id`**
```sql
-- ✅ Correct
user_id REFERENCES users(id)
operator_id REFERENCES operators(id)
manifest_id REFERENCES manifests(id)

-- ❌ Incorrect
fk_user, user_fk, UserId         -- Don't use prefixes or different casing
```

**Indexes: `idx_table_column[_column]`**
```sql
-- ✅ Correct
CREATE INDEX idx_orders_operator_id ON orders(operator_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_scans_manifest_barcode ON scans(manifest_id, barcode);

-- ❌ Incorrect
CREATE INDEX orders_operator_index ...    -- Missing idx_ prefix
CREATE INDEX idx_orders_operator ...      -- Missing _id suffix for clarity
```

**Rationale:** PostgreSQL conventions, prevents case-sensitivity issues, readable, consistent with industry standards.

---

#### **API Naming Conventions (REST)**

**Endpoints: `/api/resource` (plural), lowercase**
```typescript
// ✅ Correct
GET    /api/orders              // List all orders
POST   /api/orders              // Create new order
GET    /api/orders/:id          // Get specific order
PUT    /api/orders/:id          // Update order
DELETE /api/orders/:id          // Delete order
GET    /api/manifests           // List manifests
POST   /api/manifests/:id/sign  // Action on manifest

// ❌ Incorrect
GET    /api/order               // Don't use singular
GET    /api/Orders              // Don't use PascalCase
GET    /api/get-orders          // Don't use verbs in endpoint names (except actions)
POST   /api/orders/create       // Redundant - POST implies create
```

**Nested Resources:**
```typescript
// ✅ Correct
GET    /api/manifests/:id/scans           // Get scans for manifest
POST   /api/manifests/:id/scans           // Create scan for manifest
GET    /api/operators/:id/orders          // Get orders for operator

// ❌ Incorrect
GET    /api/scans?manifest_id=:id         // Use nesting for clear relationships
```

**Action Endpoints (Non-CRUD):**
```typescript
// ✅ Correct (use verbs for actions)
POST   /api/manifests/:id/sign            // Sign manifest
POST   /api/orders/:id/verify             // Verify order
POST   /api/manifests/:id/import          // Import manifest

// ❌ Incorrect
POST   /api/manifests/:id/signature       // Use verb, not noun
```

**Route Parameters: `:paramName` (camelCase)**
```typescript
// ✅ Correct
/api/orders/:orderId
/api/manifests/:manifestId/scans/:scanId

// ❌ Incorrect
/api/orders/{id}                          // Don't use curly braces (Express uses colons)
/api/orders/:order_id                     // Don't use snake_case in routes
```

**Query Parameters: `snake_case`** (matches API response JSON)
```typescript
// ✅ Correct
GET /api/orders?operator_id=123&created_after=2026-02-01

// ❌ Incorrect
GET /api/orders?operatorId=123            // Don't use camelCase
```

**Rationale:** RESTful conventions, plural resources, consistent with industry standards, clear action endpoints.

---

#### **Code Naming Conventions (TypeScript/React)**

**Files:**
```
✅ Correct:
  Components:     UserCard.tsx, DashboardMetrics.tsx, PickupVerification.tsx (PascalCase)
  Utilities:      formatDate.ts, apiClient.ts, scanQueue.ts (camelCase)
  Stores:         scanStore.ts, authStore.ts (camelCase + Store suffix)
  Types:          api.ts, database.ts, models.ts (camelCase)
  API Routes:     route.ts (Next.js convention)

❌ Incorrect:
  user-card.tsx, user_card.tsx      // Don't use kebab-case or snake_case for components
  FormatDate.ts                      // Don't use PascalCase for utilities
```

**React Components: `PascalCase`**
```typescript
// ✅ Correct
function UserCard() {}
const DashboardMetrics = () => {}
export default PickupVerification

// ❌ Incorrect
function userCard() {}                     // Don't use camelCase
const dashboard_metrics = () => {}         // Don't use snake_case
```

**Functions: `camelCase`**
```typescript
// ✅ Correct
function getUserData() {}
async function fetchOrders() {}
const handleSubmit = () => {}

// ❌ Incorrect
function GetUserData() {}                  // Don't use PascalCase
function get_user_data() {}                // Don't use snake_case
```

**Variables: `camelCase`**
```typescript
// ✅ Correct
const userId = "123"
const orderCount = 42
const isLoading = true
let currentManifest = null

// ❌ Incorrect
const user_id = "123"                      // Don't use snake_case
const OrderCount = 42                      // Don't use PascalCase
```

**Constants: `SCREAMING_SNAKE_CASE`**
```typescript
// ✅ Correct
const API_BASE_URL = "https://api.aureon.com"
const MAX_RETRY_ATTEMPTS = 3
const DEFAULT_PAGE_SIZE = 50

// ❌ Incorrect
const apiBaseUrl = "..."                   // Use SCREAMING_SNAKE_CASE for true constants
const MaxRetryAttempts = 3                 // Don't use PascalCase
```

**Types/Interfaces: `PascalCase`**
```typescript
// ✅ Correct
interface User {
  id: string
  email: string
}

type OrderStatus = 'pending' | 'verified' | 'completed'

interface ApiResponse<T> {
  data: T
}

// ❌ Incorrect
interface user {}                          // Don't use camelCase
type order_status = 'pending'              // Don't use snake_case
```

**Enums: `PascalCase` for name, `SCREAMING_SNAKE_CASE` for values**
```typescript
// ✅ Correct
enum OrderStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  COMPLETED = 'COMPLETED'
}

// ❌ Incorrect
enum orderStatus {}                        // Don't use camelCase for enum name
enum OrderStatus { pending = 'pending' }   // Don't use camelCase for values
```

**Rationale:** TypeScript/React conventions, matches Next.js ecosystem, clear distinction between components and utilities.

---

### Structure Patterns

#### **Project Organization (Next.js 14 App Router)**

**Mandatory Directory Structure:**
```
aureon-last-mile/
├── src/
│   ├── app/                              # Next.js App Router (pages & API routes)
│   │   ├── (auth)/                       # Route group (doesn't affect URL)
│   │   │   ├── login/
│   │   │   │   └── page.tsx              # /login route
│   │   │   └── register/
│   │   │       └── page.tsx              # /register route
│   │   ├── dashboard/
│   │   │   ├── page.tsx                  # /dashboard route
│   │   │   ├── loading.tsx               # Loading UI
│   │   │   └── error.tsx                 # Error boundary
│   │   ├── pickup/
│   │   │   ├── page.tsx                  # /pickup route (manifest list)
│   │   │   └── [manifestId]/
│   │   │       ├── page.tsx              # /pickup/:manifestId (scanning)
│   │   │       └── loading.tsx
│   │   ├── api/                          # API Routes
│   │   │   ├── orders/
│   │   │   │   ├── route.ts              # GET/POST /api/orders
│   │   │   │   └── [id]/
│   │   │   │       └── route.ts          # GET/PUT/DELETE /api/orders/:id
│   │   │   ├── manifests/
│   │   │   │   ├── route.ts
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts
│   │   │   │       ├── sign/
│   │   │   │       │   └── route.ts      # POST /api/manifests/:id/sign
│   │   │   │       └── scans/
│   │   │   │           └── route.ts      # GET/POST /api/manifests/:id/scans
│   │   │   ├── scans/
│   │   │   │   └── route.ts
│   │   │   └── dashboard/
│   │   │       └── metrics/
│   │   │           └── route.ts          # GET /api/dashboard/metrics
│   │   ├── layout.tsx                    # Root layout
│   │   ├── page.tsx                      # Home page (/)
│   │   └── globals.css                   # Global styles
│   │
│   ├── components/                       # Shared React components
│   │   ├── ui/                           # shadcn/ui base components
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   └── Toast.tsx
│   │   ├── dashboard/                    # Dashboard-specific components
│   │   │   ├── MetricsCard.tsx
│   │   │   ├── OrdersTable.tsx
│   │   │   └── PerformanceChart.tsx
│   │   ├── pickup/                       # Pickup-specific components
│   │   │   ├── ManifestCard.tsx
│   │   │   ├── ScanButton.tsx
│   │   │   ├── ProgressBar.tsx
│   │   │   └── SignatureCapture.tsx
│   │   ├── layout/                       # Layout components
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── Footer.tsx
│   │   └── shared/                       # Truly shared components
│   │       ├── LoadingSpinner.tsx
│   │       ├── ErrorBoundary.tsx
│   │       └── OfflineIndicator.tsx
│   │
│   ├── lib/                              # Utilities, helpers, services
│   │   ├── api/                          # API client & endpoints
│   │   │   ├── client.ts                 # Axios/fetch wrapper with auth
│   │   │   ├── endpoints.ts              # API endpoint definitions
│   │   │   └── types.ts                  # API request/response types
│   │   ├── db/                           # Database utilities
│   │   │   ├── supabase.ts               # Supabase client
│   │   │   └── queries.ts                # Common database queries
│   │   ├── stores/                       # Zustand stores
│   │   │   ├── scanStore.ts              # Offline scan queue
│   │   │   ├── authStore.ts              # Auth state
│   │   │   └── syncStore.ts              # Sync status
│   │   ├── utils/                        # Utility functions
│   │   │   ├── formatDate.ts
│   │   │   ├── validation.ts
│   │   │   ├── errorHandling.ts
│   │   │   └── pdfGenerator.ts           # jsPDF wrapper
│   │   └── hooks/                        # Custom React hooks
│   │       ├── useAuth.ts
│   │       ├── useOrders.ts              # TanStack Query wrapper
│   │       └── useOfflineSync.ts
│   │
│   ├── types/                            # TypeScript type definitions
│   │   ├── api.ts                        # API types
│   │   ├── database.ts                   # Supabase/database types
│   │   ├── models.ts                     # Domain model types
│   │   └── index.ts                      # Re-export all types
│   │
│   └── middleware.ts                     # Next.js middleware (auth, rate limiting)
│
├── public/                               # Static assets
│   ├── icons/                            # PWA icons
│   ├── images/                           # Images
│   └── manifest.json                     # PWA manifest
│
├── __tests__/                            # Tests (centralized)
│   ├── components/
│   │   └── dashboard/
│   │       └── MetricsCard.test.tsx
│   ├── lib/
│   │   └── utils/
│   │       └── formatDate.test.ts
│   └── api/
│       └── orders.test.ts
│
├── supabase/                             # Supabase migrations & config
│   ├── migrations/
│   │   ├── 20260206_initial_schema.sql
│   │   └── 20260207_add_audit_logs.sql
│   └── config.toml
│
├── .github/
│   └── workflows/
│       ├── test.yml                      # CI/CD pipeline
│       └── deploy.yml
│
├── next.config.js                        # Next.js configuration
├── tailwind.config.ts                    # Tailwind CSS config
├── tsconfig.json                         # TypeScript config
├── package.json
└── README.md
```

**Key Organizational Principles:**

1. **Feature-based components**: Group by feature (`dashboard/`, `pickup/`) NOT by type (`cards/`, `buttons/`)
2. **Shared components**: Only truly reusable components go in `components/shared/`
3. **API routes**: Match REST resource structure (`/api/orders/:id/scans`)
4. **Utilities centralized**: All helpers in `lib/`, organized by purpose
5. **Types centralized**: All types in `types/`, re-exported from `index.ts`
6. **Tests mirror structure**: `__tests__/components/dashboard/` mirrors `src/components/dashboard/`

**Rationale:** Next.js App Router conventions, feature-based for easier navigation, clear separation of concerns, scalable structure.

---

#### **File Structure Patterns**

**Component File Structure:**
```typescript
// ✅ Correct: components/dashboard/MetricsCard.tsx

// 1. Imports (grouped: external → internal → types)
import React from 'react'
import { Card } from '@/components/ui/Card'
import { formatNumber } from '@/lib/utils/formatDate'
import type { Metric } from '@/types/models'

// 2. Types/Interfaces (if component-specific)
interface MetricsCardProps {
  metric: Metric
  isLoading?: boolean
}

// 3. Component
export function MetricsCard({ metric, isLoading }: MetricsCardProps) {
  // Component logic
  return (
    <Card>
      {/* JSX */}
    </Card>
  )
}

// 4. Sub-components (if any, keep co-located)
function MetricValue({ value }: { value: number }) {
  return <span>{formatNumber(value)}</span>
}

// ❌ Incorrect: Don't split into multiple files unless component is large (>200 lines)
```

**API Route File Structure:**
```typescript
// ✅ Correct: app/api/orders/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase'
import { validateAuth } from '@/lib/api/auth'
import type { Order } from '@/types/models'

// GET /api/orders
export async function GET(request: NextRequest) {
  const { user, operator_id } = await validateAuth(request)
  const supabase = createClient()

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('operator_id', operator_id)

  if (error) {
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    )
  }

  return NextResponse.json(data)
}

// POST /api/orders
export async function POST(request: NextRequest) {
  // Similar structure
}
```

---

### Format Patterns

#### **API Response Formats**

**Success Responses (200-299): Direct data, no wrapper**
```json
// ✅ Correct: Single resource
{
  "id": "order-123",
  "order_number": "FAL-20260206-001",
  "customer_name": "María González",
  "delivery_address": "Av. Providencia 123, Santiago",
  "status": "pending",
  "created_at": "2026-02-06T14:30:00Z"
}

// ✅ Correct: Collection (array)
[
  { "id": "order-1", "order_number": "FAL-001", ... },
  { "id": "order-2", "order_number": "FAL-002", ... }
]

// ❌ Incorrect: Don't use wrapper
{
  "data": { "id": "order-123", ... }      // Unnecessary wrapper
}

{
  "success": true,
  "payload": { ... }                      // Overly complex
}
```

**Error Responses (400-599): Standardized format** (from Decision 4)
```json
{
  "error": {
    "code": "BARCODE_NOT_FOUND",
    "message": "Código de barras no encontrado",
    "details": "Barcode '7804123456789' not in manifest 'FAL-20260206'",
    "field": "barcode",
    "timestamp": "2026-02-06T14:30:00Z",
    "request_id": "req_abc123"
  }
}
```

**Pagination Format: Cursor-based** (for large datasets)
```json
{
  "data": [ /* orders */ ],
  "pagination": {
    "next_cursor": "eyJpZCI6MTIzfQ==",
    "has_more": true
  }
}
```

**Rationale:** Direct responses are simpler, errors use standardized format, cursor pagination scales better than offset.

---

#### **Data Exchange Formats**

**Dates: Always ISO 8601 strings**
```json
// ✅ Correct
{
  "created_at": "2026-02-06T14:30:00Z",
  "updated_at": "2026-02-06T15:45:00Z"
}

// ❌ Incorrect
{
  "created_at": 1675694400,                // No timestamps
  "updated_at": "2026-02-06"               // No partial dates (missing time)
}
```

**Booleans: Always `true`/`false`**
```json
// ✅ Correct
{
  "is_verified": true,
  "has_discrepancies": false
}

// ❌ Incorrect
{
  "is_verified": 1,                        // Don't use 1/0
  "has_discrepancies": "false"             // Don't use strings
}
```

**Null Handling: Use `null`, not `undefined`**
```json
// ✅ Correct
{
  "signature_url": null,
  "notes": null
}

// ❌ Incorrect
{
  "signature_url": undefined,              // undefined doesn't exist in JSON
  // "notes": missing                      // Include null fields explicitly
}
```

**Arrays: Always arrays, even for single item**
```json
// ✅ Correct
{
  "scans": ["barcode1"]
}

// ❌ Incorrect
{
  "scans": "barcode1"                      // Don't change type based on count
}
```

**JSON Field Naming: `snake_case`** (matches database)
```json
// ✅ Correct
{
  "order_id": "123",
  "created_at": "2026-02-06T14:30:00Z",
  "operator_id": "op-456",
  "customer_name": "María González"
}

// ❌ Incorrect
{
  "orderId": "123",                        // Don't use camelCase
  "CreatedAt": "...",                      // Don't use PascalCase
}
```

**Rationale:** snake_case matches PostgreSQL, ISO dates are unambiguous timezone-aware, consistent array handling prevents bugs.

---

### Communication Patterns

#### **Event Naming (Supabase Realtime, Custom Events)**

**Format: `resource.action` (lowercase, dot-separated)**
```typescript
// ✅ Correct
"order.created"
"order.updated"
"order.deleted"
"manifest.signed"
"scan.completed"
"sync.started"
"sync.completed"

// ❌ Incorrect
"OrderCreated"                             // Don't use PascalCase
"ORDER_CREATED"                            // Don't use SCREAMING_SNAKE_CASE
"create-order"                             // Don't use action-resource order
"onOrderCreate"                            // Don't use handler naming
```

**Event Payload Structure:**
```typescript
// ✅ Correct
interface AppEvent<T = unknown> {
  type: string                             // Event name (e.g., "order.created")
  timestamp: string                        // ISO 8601
  operator_id: string                      // Tenant context
  user_id?: string                         // User who triggered (if applicable)
  data: T                                  // Event-specific data
}

// Example
{
  type: "order.created",
  timestamp: "2026-02-06T14:30:00Z",
  operator_id: "op-123",
  user_id: "user-456",
  data: {
    order_id: "order-789",
    order_number: "FAL-001",
    status: "pending"
  }
}
```

**Supabase Realtime Subscriptions:**
```typescript
// ✅ Correct
supabase
  .channel('orders')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'orders' },
    (payload) => {
      // Handle order.created
    }
  )
  .subscribe()
```

**Rationale:** Lowercase dot notation is clear, resource.action reads naturally, consistent with event sourcing patterns.

---

#### **Zustand Store Patterns**

**Store Naming: `use` + `ResourceName` + `Store`**
```typescript
// ✅ Correct
useScanStore
useAuthStore
useDashboardStore
useSyncStore

// ❌ Incorrect
scanStore                                  // Missing 'use' prefix (not a hook)
useScans                                   // Missing 'Store' suffix
ScanStore                                  // Don't use PascalCase
```

**Store Structure: State + Actions**
```typescript
// ✅ Correct
interface ScanStore {
  // State
  scans: Scan[]
  isSyncing: boolean
  lastSyncTime: string | null

  // Actions (verbs)
  addScan: (barcode: string) => void
  removeScan: (id: string) => void
  clearScans: () => void
  markSynced: (id: string) => void
  setSyncing: (syncing: boolean) => void
}

const useScanStore = create<ScanStore>((set) => ({
  // Initial state
  scans: [],
  isSyncing: false,
  lastSyncTime: null,

  // Actions
  addScan: (barcode) => set((state) => ({
    scans: [...state.scans, { id: generateId(), barcode, synced: false }]
  })),

  removeScan: (id) => set((state) => ({
    scans: state.scans.filter(s => s.id !== id)
  })),

  clearScans: () => set({ scans: [] }),

  markSynced: (id) => set((state) => ({
    scans: state.scans.map(s => s.id === id ? { ...s, synced: true } : s)
  })),

  setSyncing: (isSyncing) => set({ isSyncing })
}))
```

**Immutable Updates: ALWAYS**
```typescript
// ✅ Correct (immutable)
addScan: (barcode) => set((state) => ({
  scans: [...state.scans, newScan]         // Create new array
}))

removeScan: (id) => set((state) => ({
  scans: state.scans.filter(s => s.id !== id)  // Returns new array
}))

// ❌ Incorrect (mutation)
addScan: (barcode) => set((state) => {
  state.scans.push(newScan)                // Mutates existing array
  return state
})
```

**Persistence (for offline data):**
```typescript
// ✅ Correct
import { persist } from 'zustand/middleware'

const useScanStore = create(
  persist<ScanStore>(
    (set) => ({
      scans: [],
      addScan: (barcode) => set((state) => ({ ... }))
    }),
    {
      name: 'scan-queue-storage',          // localStorage key
      partialize: (state) => ({             // Only persist necessary state
        scans: state.scans
      })
    }
  )
)
```

**Rationale:** Zustand is simple, immutability prevents bugs, persist middleware enables offline capability.

---

### Process Patterns

#### **Error Handling Patterns**

**API Layer: Try-Catch with Structured Logging**
```typescript
// ✅ Correct
import { logger } from '@/lib/utils/logger'

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { user, operator_id } = await validateAuth(request)
    const body = await request.json()

    // Validation
    const validation = validateOrderInput(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Datos inválidos',
            details: validation.error,
            field: validation.field,
            timestamp: new Date().toISOString(),
            request_id: requestId
          }
        },
        { status: 400 }
      )
    }

    // Business logic
    const order = await createOrder(body, operator_id)

    return NextResponse.json(order, { status: 201 })

  } catch (error) {
    // Structured logging
    logger.error({
      error_code: 'ORDER_CREATE_FAILED',
      request_id: requestId,
      operator_id: request.user?.operator_id,
      user_id: request.user?.id,
      error_message: error.message,
      stack_trace: error.stack,
      timestamp: new Date().toISOString()
    })

    // User-facing error response
    return NextResponse.json(
      {
        error: {
          code: 'ORDER_CREATE_FAILED',
          message: 'No se pudo crear la orden',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined,
          timestamp: new Date().toISOString(),
          request_id: requestId
        }
      },
      { status: 500 }
    )
  }
}
```

**React Error Boundaries:**
```typescript
// ✅ Correct: components/shared/ErrorBoundary.tsx
import React from 'react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to Sentry
    logger.error({
      error_code: 'REACT_ERROR_BOUNDARY',
      error_message: error.message,
      component_stack: errorInfo.componentStack,
      timestamp: new Date().toISOString()
    })
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div>
          <h2>Algo salió mal</h2>
          <button onClick={() => window.location.reload()}>
            Recargar aplicación
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

// Usage in app/layout.tsx
<ErrorBoundary>
  <Dashboard />
</ErrorBoundary>
```

**Form Validation: Inline + Toast**
```typescript
// ✅ Correct
const handleSubmit = async (data) => {
  try {
    await apiClient.post('/api/orders', data)
    toast.success('Orden creada exitosamente')
  } catch (error) {
    if (error.response?.status === 400) {
      // Inline validation error
      setFieldError(error.response.data.error.field, error.response.data.error.message)
    } else {
      // General error toast
      toast.error(error.response?.data?.error?.message || 'Error al crear orden')
    }
  }
}
```

**Rationale:** Structured logging enables debugging, error boundaries prevent app crashes, inline validation provides immediate feedback.

---

#### **Loading State Patterns**

**Naming: `isLoading` prefix for booleans**
```typescript
// ✅ Correct
const [isLoading, setIsLoading] = useState(false)
const [isSubmitting, setIsSubmitting] = useState(false)
const [isSyncing, setIsSyncing] = useState(false)

// ❌ Incorrect
const [loading, setLoading] = useState(false)        // Not boolean-obvious
const [submitting, setSubmitting] = useState(false)  // Ambiguous type
```

**TanStack Query: Use provided states**
```typescript
// ✅ Correct
const { data, isLoading, isError, error } = useQuery({
  queryKey: ['orders'],
  queryFn: fetchOrders
})

if (isLoading) return <LoadingSpinner />
if (isError) return <ErrorMessage error={error} />
return <OrdersList orders={data} />

// ❌ Incorrect
const [loading, setLoading] = useState(false)        // Don't duplicate TanStack Query state
```

**Global vs Local Loading:**
```typescript
// ✅ Global: Full-page loading (initial page load)
app/dashboard/loading.tsx                            // Next.js loading UI

// ✅ Local: Component-level loading (button, card)
<Button disabled={isSubmitting}>
  {isSubmitting ? <Spinner /> : 'Guardar'}
</Button>
```

**Optimistic Updates (show immediate feedback):**
```typescript
// ✅ Correct
const { mutate } = useMutation({
  mutationFn: createOrder,
  onMutate: async (newOrder) => {
    // Optimistically add to UI
    queryClient.setQueryData(['orders'], (old) => [...old, newOrder])
  },
  onError: (error, newOrder, context) => {
    // Rollback on error
    queryClient.setQueryData(['orders'], context.previousOrders)
    toast.error('Error al crear orden')
  }
})
```

**Rationale:** Consistent loading state naming, leverage TanStack Query built-ins, optimistic updates improve perceived performance.

---

### Enforcement Guidelines

#### **All AI Agents MUST Follow These Rules**

**1. Naming Conventions:**
- ✅ Database: `snake_case` for tables/columns
- ✅ API JSON: `snake_case` for field names
- ✅ TypeScript: `camelCase` for variables/functions, `PascalCase` for components/types
- ✅ Constants: `SCREAMING_SNAKE_CASE`
- ✅ Files: `PascalCase.tsx` for components, `camelCase.ts` for utilities

**2. API Standards:**
- ✅ REST endpoints: `/api/resource` (plural, lowercase)
- ✅ Success: Return data directly (no `{data: ...}` wrapper)
- ✅ Errors: Use standardized format with `code`, `message`, `details`, `request_id`
- ✅ Dates: ISO 8601 strings only (`"2026-02-06T14:30:00Z"`)
- ✅ HTTP status codes: Standard codes (400, 401, 403, 404, 409, 422, 500, 503)

**3. State Management:**
- ✅ Zustand: Immutable updates always (use spread operators, `.map()`, `.filter()`)
- ✅ TanStack Query: Use for all API data fetching
- ✅ Loading states: `isLoading` prefix
- ✅ Events: `resource.action` format (lowercase, dot-separated)

**4. File Organization:**
- ✅ Components by feature: `components/dashboard/`, `components/pickup/`
- ✅ API routes: Match REST structure `/api/orders/[id]/route.ts`
- ✅ Types centralized: All in `types/` directory
- ✅ Tests mirror structure: `__tests__/components/dashboard/`

**5. Error Handling:**
- ✅ Try-catch in API routes with structured logging
- ✅ Error boundaries in React for component crashes
- ✅ Include `request_id` in all error responses
- ✅ Toast notifications for transient errors, inline validation for forms

---

#### **Pattern Enforcement**

**Linting (ESLint + TypeScript):**
```json
// .eslintrc.json
{
  "rules": {
    "@typescript-eslint/naming-convention": [
      "error",
      {
        "selector": "variable",
        "format": ["camelCase", "UPPER_CASE"]
      },
      {
        "selector": "function",
        "format": ["camelCase"]
      },
      {
        "selector": "typeLike",
        "format": ["PascalCase"]
      }
    ]
  }
}
```

**Code Review Checklist:**
- [ ] Naming follows conventions (snake_case DB, camelCase TS, PascalCase components)
- [ ] API responses use standardized format
- [ ] Dates are ISO 8601 strings
- [ ] Zustand updates are immutable
- [ ] Error handling includes request_id
- [ ] Tests exist for new components/functions
- [ ] TypeScript types are defined (no `any`)

**Documentation:**
- Patterns violations should be documented in GitHub PR comments
- Update this architecture document if patterns evolve
- Use OpenAPI schema validation for API contracts

---

### Pattern Examples

#### **Good Examples**

**✅ Creating a new API endpoint:**
```typescript
// app/api/scans/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/supabase'
import { validateAuth } from '@/lib/api/auth'
import { logger } from '@/lib/utils/logger'

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { user, operator_id } = await validateAuth(request)
    const { barcode, manifest_id } = await request.json()

    const supabase = createClient()

    const { data, error } = await supabase
      .from('barcode_scans')                           // snake_case table
      .insert({
        operator_id,                                    // snake_case column
        manifest_id,
        barcode,
        scanned_by: user.id,
        scanned_at: new Date().toISOString()            // ISO 8601
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data, { status: 201 })    // Direct response

  } catch (error) {
    logger.error({
      error_code: 'SCAN_CREATE_FAILED',
      request_id: requestId,
      operator_id: user?.operator_id,
      error: error.message
    })

    return NextResponse.json(
      {
        error: {
          code: 'SCAN_CREATE_FAILED',
          message: 'No se pudo registrar el escaneo',
          timestamp: new Date().toISOString(),
          request_id: requestId
        }
      },
      { status: 500 }
    )
  }
}
```

**✅ Creating a Zustand store:**
```typescript
// lib/stores/scanStore.ts

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface Scan {
  id: string
  barcode: string
  timestamp: string                        // ISO 8601
  synced: boolean
}

interface ScanStore {
  scans: Scan[]
  isSyncing: boolean

  addScan: (barcode: string) => void
  removeScan: (id: string) => void
  clearScans: () => void
  markSynced: (id: string) => void
}

export const useScanStore = create<ScanStore>()(
  persist(
    (set) => ({
      scans: [],
      isSyncing: false,

      addScan: (barcode) => set((state) => ({
        scans: [
          ...state.scans,                              // Immutable
          {
            id: crypto.randomUUID(),
            barcode,
            timestamp: new Date().toISOString(),       // ISO 8601
            synced: false
          }
        ]
      })),

      removeScan: (id) => set((state) => ({
        scans: state.scans.filter(s => s.id !== id)    // Immutable
      })),

      clearScans: () => set({ scans: [] }),

      markSynced: (id) => set((state) => ({
        scans: state.scans.map(s =>                    // Immutable
          s.id === id ? { ...s, synced: true } : s
        )
      }))
    }),
    {
      name: 'scan-queue-storage'                       // localStorage key
    }
  )
)
```

---

#### **Anti-Patterns (What to Avoid)**

**❌ Inconsistent naming:**
```typescript
// ❌ Bad
CREATE TABLE Orders (...)                              // Don't use PascalCase
const User_ID = "123"                                  // Don't use snake_case in TS
function GetUserData() {}                              // Don't use PascalCase for functions
```

**❌ Mutating state:**
```typescript
// ❌ Bad
addScan: (barcode) => set((state) => {
  state.scans.push({ barcode })                        // Mutation!
  return state
})
```

**❌ Wrapped API responses:**
```typescript
// ❌ Bad
return NextResponse.json({
  success: true,                                       // Unnecessary
  data: order                                          // Just return order directly
})
```

**❌ Inconsistent date formats:**
```typescript
// ❌ Bad
{
  "created_at": 1675694400,                            // Timestamp
  "updated_at": "2026-02-06"                           // Partial date
}

// ✅ Good
{
  "created_at": "2026-02-06T14:30:00Z",                // ISO 8601
  "updated_at": "2026-02-06T15:45:00Z"                 // ISO 8601
}
```

**❌ Missing error details:**
```typescript
// ❌ Bad
return NextResponse.json({ error: "Failed" }, { status: 500 })

// ✅ Good
return NextResponse.json({
  error: {
    code: 'ORDER_CREATE_FAILED',
    message: 'No se pudo crear la orden',
    timestamp: new Date().toISOString(),
    request_id: requestId
  }
}, { status: 500 })
```

---

### Pattern Update Process

**When patterns need to change:**
1. Propose change in GitHub issue/PR
2. Discuss with team (or user Gerhard)
3. Update this architecture document
4. Update `.eslintrc.json` rules if applicable
5. Run codemod/find-replace to update existing code
6. Communicate change to all AI agents (via updated architecture doc)

---

## Project Structure & Boundaries

_This section defines the complete file and directory structure for Aureon Last Mile, mapping all 82 functional requirements to specific locations in the codebase._

### Requirements to Structure Mapping

**13 FR Categories → Project Locations:**

| FR Category | Frontend Pages | Components | API Routes | Notes |
|------------|----------------|------------|------------|-------|
| **FR1-FR11: BI Dashboard** | `app/dashboard/` | `components/dashboard/` | `app/api/dashboard/` | Chart.js visualizations, real-time metrics |
| **FR12-FR19: Pickup Verification** | `app/pickup/` | `components/pickup/` | `app/api/manifests/`, `app/api/scans/` | Offline PWA, IndexedDB queue |
| **FR20-FR23: Hub Reception** | `app/hub/` | `components/hub/` | `app/api/reception/` | Reconciliation logic |
| **FR24-FR28: Warehouse WMS** | `app/warehouse/` | `components/warehouse/` | `app/api/inventory/` | Location tracking |
| **FR29-FR37: Loading & Sectorization** | `app/loading/` | `components/loading/` | `app/api/loading/`, `app/api/sectorization/` | Routing tool integration |
| **FR38-FR41: Capacity Planning** | `app/capacity/` | `components/capacity/` | `app/api/capacity/` | Forecast algorithms |
| **FR42-FR49: Integration Hub** | `app/integrations/` | `components/integrations/` | `lib/integrations/` | **Separate n8n instance on Railway** |
| **FR50-FR58: User Management** | `app/(auth)/` | `components/auth/` | `app/api/users/` | Supabase Auth integration |
| **FR59-FR64: AI Support Agent** | `app/support/` | `components/support/` | `app/api/ai/` | Claude API integration |
| **FR65-FR70: Platform Admin** | `app/admin/` | `components/admin/` | `app/api/admin/` | Tenant provisioning |
| **FR71-FR75: Multi-Tenancy** | *(All pages)* | `middleware.ts` | *(All API routes)* | RLS policies in Supabase |
| **FR76-FR78: Configuration** | `app/settings/` | `components/settings/` | `app/api/config/` | Sectorization rules |
| **FR79-FR82: Audit & Compliance** | *(Admin views)* | *(Audit tables)* | `app/api/audit/` | `audit_logs` table, 7-year retention |

---

### Complete Project Directory Structure

```
aureon-last-mile/
├── README.md
├── package.json
├── package-lock.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── .env.local
├── .env.example
├── .gitignore
├── .eslintrc.json
├── jest.config.js
├── playwright.config.ts
│
├── .github/
│   └── workflows/
│       ├── test.yml                      # Run tests on PR
│       ├── deploy-preview.yml            # Deploy preview to Vercel/Railway
│       └── deploy-production.yml         # Deploy to production
│
├── public/                               # Static assets
│   ├── icons/                            # PWA icons
│   │   ├── icon-192x192.png
│   │   ├── icon-512x512.png
│   │   └── favicon.ico
│   ├── images/
│   │   ├── logo.svg
│   │   └── placeholder-avatar.png
│   └── manifest.json                     # PWA manifest
│
├── src/
│   ├── app/                              # Next.js App Router
│   │   ├── globals.css
│   │   ├── layout.tsx                    # Root layout (header, sidebar)
│   │   ├── page.tsx                      # Home page (redirect to dashboard)
│   │   ├── loading.tsx                   # Global loading UI
│   │   ├── error.tsx                     # Global error boundary
│   │   ├── not-found.tsx                 # 404 page
│   │   │
│   │   ├── (auth)/                       # Auth route group (no layout)
│   │   │   ├── login/
│   │   │   │   └── page.tsx              # /login
│   │   │   ├── register/
│   │   │   │   └── page.tsx              # /register
│   │   │   ├── forgot-password/
│   │   │   │   └── page.tsx              # /forgot-password
│   │   │   └── reset-password/
│   │   │       └── page.tsx              # /reset-password
│   │   │
│   │   ├── dashboard/                    # BI Dashboard (FR1-FR11)
│   │   │   ├── page.tsx                  # Main dashboard
│   │   │   ├── loading.tsx
│   │   │   ├── metrics/
│   │   │   │   └── page.tsx              # Detailed metrics view
│   │   │   ├── customers/
│   │   │   │   ├── page.tsx              # Customer performance table
│   │   │   │   └── [customerId]/
│   │   │   │       └── page.tsx          # Customer details
│   │   │   └── reports/
│   │   │       ├── page.tsx              # Reports list
│   │   │       └── [reportId]/
│   │   │           └── page.tsx          # Report details
│   │   │
│   │   ├── pickup/                       # Pickup Verification (FR12-FR19)
│   │   │   ├── page.tsx                  # Manifest list
│   │   │   ├── loading.tsx
│   │   │   └── [manifestId]/
│   │   │       ├── page.tsx              # Scanning interface
│   │   │       ├── complete/
│   │   │       │   └── page.tsx          # Completion summary
│   │   │       └── sign/
│   │   │           └── page.tsx          # Digital signature
│   │   │
│   │   ├── hub/                          # Hub Reception (FR20-FR23)
│   │   │   ├── page.tsx                  # Hub reception dashboard
│   │   │   ├── receive/
│   │   │   │   └── page.tsx              # Receive packages
│   │   │   └── reconcile/
│   │   │       └── page.tsx              # Reconciliation view
│   │   │
│   │   ├── warehouse/                    # Warehouse WMS (FR24-FR28)
│   │   │   ├── page.tsx                  # Warehouse dashboard
│   │   │   ├── inventory/
│   │   │   │   └── page.tsx              # Inventory view
│   │   │   ├── search/
│   │   │   │   └── page.tsx              # Search orders
│   │   │   └── location/
│   │   │       └── [locationId]/
│   │   │           └── page.tsx          # Location details
│   │   │
│   │   ├── loading/                      # Loading & Sectorization (FR29-FR37)
│   │   │   ├── page.tsx                  # Loading dashboard
│   │   │   ├── scan/
│   │   │   │   └── page.tsx              # Scan and load interface
│   │   │   ├── sectorization/
│   │   │   │   └── page.tsx              # Sectorization rules
│   │   │   └── routes/
│   │   │       ├── page.tsx              # Route list
│   │   │       └── [routeId]/
│   │   │           └── page.tsx          # Route details
│   │   │
│   │   ├── capacity/                     # Capacity Planning (FR38-FR41)
│   │   │   ├── page.tsx                  # Capacity overview
│   │   │   ├── forecast/
│   │   │   │   └── page.tsx              # Forecasting view
│   │   │   └── alerts/
│   │   │       └── page.tsx              # Capacity alerts
│   │   │
│   │   ├── integrations/                 # Integration Hub (FR42-FR49)
│   │   │   ├── page.tsx                  # Integrations dashboard
│   │   │   ├── retailers/
│   │   │   │   ├── page.tsx              # Retailer integrations list
│   │   │   │   └── [retailerId]/
│   │   │   │       └── page.tsx          # Retailer config
│   │   │   ├── routing-tools/
│   │   │   │   └── page.tsx              # Routing tool integrations
│   │   │   └── logs/
│   │   │       └── page.tsx              # Integration logs
│   │   │
│   │   ├── support/                      # AI Support Agent (FR59-FR64)
│   │   │   ├── page.tsx                  # Support chat interface
│   │   │   └── history/
│   │   │       └── page.tsx              # Support history
│   │   │
│   │   ├── admin/                        # Platform Admin (FR65-FR70)
│   │   │   ├── page.tsx                  # Admin dashboard
│   │   │   ├── operators/
│   │   │   │   ├── page.tsx              # Operator management
│   │   │   │   └── [operatorId]/
│   │   │   │       └── page.tsx          # Operator details
│   │   │   ├── users/
│   │   │   │   ├── page.tsx              # User management
│   │   │   │   └── [userId]/
│   │   │   │       └── page.tsx          # User details
│   │   │   ├── monitoring/
│   │   │   │   └── page.tsx              # Platform health monitoring
│   │   │   └── billing/
│   │   │       └── page.tsx              # Billing and usage
│   │   │
│   │   ├── settings/                     # Configuration (FR76-FR78)
│   │   │   ├── page.tsx                  # Settings overview
│   │   │   ├── profile/
│   │   │   │   └── page.tsx              # User profile
│   │   │   ├── organization/
│   │   │   │   └── page.tsx              # Organization settings
│   │   │   ├── sectorization/
│   │   │   │   └── page.tsx              # Sectorization rules
│   │   │   └── notifications/
│   │   │       └── page.tsx              # Notification preferences
│   │   │
│   │   └── api/                          # API Routes (REST)
│   │       ├── auth/
│   │       │   ├── login/
│   │       │   │   └── route.ts          # POST /api/auth/login
│   │       │   ├── logout/
│   │       │   │   └── route.ts          # POST /api/auth/logout
│   │       │   └── refresh/
│   │       │       └── route.ts          # POST /api/auth/refresh
│   │       │
│   │       ├── users/
│   │       │   ├── route.ts              # GET/POST /api/users
│   │       │   └── [id]/
│   │       │       └── route.ts          # GET/PUT/DELETE /api/users/:id
│   │       │
│   │       ├── operators/
│   │       │   ├── route.ts              # GET/POST /api/operators
│   │       │   └── [id]/
│   │       │       └── route.ts          # GET/PUT/DELETE /api/operators/:id
│   │       │
│   │       ├── orders/
│   │       │   ├── route.ts              # GET/POST /api/orders
│   │       │   └── [id]/
│   │       │       ├── route.ts          # GET/PUT/DELETE /api/orders/:id
│   │       │       └── verify/
│   │       │           └── route.ts      # POST /api/orders/:id/verify
│   │       │
│   │       ├── manifests/
│   │       │   ├── route.ts              # GET/POST /api/manifests
│   │       │   ├── import/
│   │       │   │   └── route.ts          # POST /api/manifests/import
│   │       │   └── [id]/
│   │       │       ├── route.ts          # GET/PUT/DELETE /api/manifests/:id
│   │       │       ├── sign/
│   │       │       │   └── route.ts      # POST /api/manifests/:id/sign
│   │       │       └── scans/
│   │       │           └── route.ts      # GET/POST /api/manifests/:id/scans
│   │       │
│   │       ├── scans/
│   │       │   ├── route.ts              # GET/POST /api/scans
│   │       │   └── [id]/
│   │       │       └── route.ts          # GET/PUT/DELETE /api/scans/:id
│   │       │
│   │       ├── dashboard/
│   │       │   ├── metrics/
│   │       │   │   └── route.ts          # GET /api/dashboard/metrics
│   │       │   ├── customers/
│   │       │   │   └── route.ts          # GET /api/dashboard/customers
│   │       │   └── reports/
│   │       │       └── route.ts          # GET/POST /api/dashboard/reports
│   │       │
│   │       ├── inventory/
│   │       │   ├── route.ts              # GET/POST /api/inventory
│   │       │   ├── search/
│   │       │   │   └── route.ts          # GET /api/inventory/search
│   │       │   └── [id]/
│   │       │       └── route.ts          # GET/PUT /api/inventory/:id
│   │       │
│   │       ├── loading/
│   │       │   ├── route.ts              # GET/POST /api/loading
│   │       │   └── [id]/
│   │       │       └── route.ts          # GET/PUT /api/loading/:id
│   │       │
│   │       ├── sectorization/
│   │       │   ├── rules/
│   │       │   │   └── route.ts          # GET/POST /api/sectorization/rules
│   │       │   └── assign/
│   │       │       └── route.ts          # POST /api/sectorization/assign
│   │       │
│   │       ├── capacity/
│   │       │   ├── forecast/
│   │       │   │   └── route.ts          # GET /api/capacity/forecast
│   │       │   └── alerts/
│   │       │       └── route.ts          # GET/POST /api/capacity/alerts
│   │       │
│   │       ├── integrations/
│   │       │   ├── retailers/
│   │       │   │   └── route.ts          # GET/POST /api/integrations/retailers
│   │       │   ├── webhooks/
│   │       │   │   └── route.ts          # POST /api/integrations/webhooks
│   │       │   └── sync/
│   │       │       └── route.ts          # POST /api/integrations/sync
│   │       │
│   │       ├── ai/
│   │       │   ├── chat/
│   │       │   │   └── route.ts          # POST /api/ai/chat
│   │       │   └── suggest/
│   │       │       └── route.ts          # POST /api/ai/suggest
│   │       │
│   │       └── audit/
│   │           ├── route.ts              # GET /api/audit
│   │           └── search/
│   │               └── route.ts          # GET /api/audit/search
│   │
│   ├── components/                       # React components
│   │   ├── ui/                           # shadcn/ui base components
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Select.tsx
│   │   │   ├── Toast.tsx
│   │   │   ├── Table.tsx
│   │   │   ├── Dialog.tsx
│   │   │   └── ... (other shadcn components)
│   │   │
│   │   ├── dashboard/                    # BI Dashboard components
│   │   │   ├── MetricsCard.tsx
│   │   │   ├── SLAProgressBar.tsx
│   │   │   ├── CustomerPerformanceTable.tsx
│   │   │   ├── PerformanceChart.tsx        # Chart.js wrapper
│   │   │   ├── FailureReasonsChart.tsx
│   │   │   └── ExportButton.tsx
│   │   │
│   │   ├── pickup/                       # Pickup Verification components
│   │   │   ├── ManifestCard.tsx
│   │   │   ├── ScanButton.tsx
│   │   │   ├── ScanAnimation.tsx
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── OfflineIndicator.tsx
│   │   │   ├── SignatureCapture.tsx
│   │   │   └── CompletionSummary.tsx
│   │   │
│   │   ├── hub/                          # Hub Reception components
│   │   │   ├── ReceptionDashboard.tsx
│   │   │   ├── ReconciliationTable.tsx
│   │   │   └── DiscrepancyAlert.tsx
│   │   │
│   │   ├── warehouse/                    # Warehouse components
│   │   │   ├── InventorySearch.tsx
│   │   │   ├── LocationCard.tsx
│   │   │   └── MovementHistory.tsx
│   │   │
│   │   ├── loading/                      # Loading components
│   │   │   ├── LoadingProgress.tsx
│   │   │   ├── SectorizationMap.tsx
│   │   │   └── RouteCard.tsx
│   │   │
│   │   ├── capacity/                     # Capacity components
│   │   │   ├── ForecastChart.tsx
│   │   │   ├── CapacityAlert.tsx
│   │   │   └── UsageGauge.tsx
│   │   │
│   │   ├── integrations/                 # Integration components
│   │   │   ├── RetailerCard.tsx
│   │   │   ├── IntegrationStatus.tsx
│   │   │   └── SyncLog.tsx
│   │   │
│   │   ├── support/                      # AI Support components
│   │   │   ├── ChatInterface.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── SuggestionCard.tsx
│   │   │
│   │   ├── admin/                        # Admin components
│   │   │   ├── OperatorCard.tsx
│   │   │   ├── UserTable.tsx
│   │   │   ├── MonitoringDashboard.tsx
│   │   │   └── BillingTable.tsx
│   │   │
│   │   ├── auth/                         # Auth components
│   │   │   ├── LoginForm.tsx
│   │   │   ├── RegisterForm.tsx
│   │   │   └── PasswordResetForm.tsx
│   │   │
│   │   ├── layout/                       # Layout components
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Footer.tsx
│   │   │   └── MobileNav.tsx
│   │   │
│   │   └── shared/                       # Shared components
│   │       ├── LoadingSpinner.tsx
│   │       ├── ErrorBoundary.tsx
│   │       ├── ErrorMessage.tsx
│   │       ├── EmptyState.tsx
│   │       ├── Pagination.tsx
│   │       └── ConfirmDialog.tsx
│   │
│   ├── lib/                              # Utilities, services, helpers
│   │   ├── api/
│   │   │   ├── client.ts                 # Axios/fetch wrapper with auth
│   │   │   ├── endpoints.ts              # API endpoint constants
│   │   │   ├── types.ts                  # API request/response types
│   │   │   └── auth.ts                   # Auth helpers
│   │   │
│   │   ├── db/
│   │   │   ├── supabase.ts               # Supabase client
│   │   │   ├── queries.ts                # Common database queries
│   │   │   └── migrations.ts             # Migration helpers
│   │   │
│   │   ├── stores/                       # Zustand stores
│   │   │   ├── scanStore.ts              # Offline scan queue
│   │   │   ├── authStore.ts              # Auth state
│   │   │   ├── syncStore.ts              # Sync status
│   │   │   └── dashboardStore.ts         # Dashboard filters
│   │   │
│   │   ├── hooks/                        # Custom React hooks
│   │   │   ├── useAuth.ts
│   │   │   ├── useOrders.ts              # TanStack Query wrapper
│   │   │   ├── useManifests.ts
│   │   │   ├── useOfflineSync.ts
│   │   │   └── useRealtime.ts            # Supabase Realtime wrapper
│   │   │
│   │   ├── integrations/                 # Integration adapters
│   │   │   ├── retailers/
│   │   │   │   ├── falabella.ts
│   │   │   │   ├── shopee.ts
│   │   │   │   ├── mercadolibre.ts
│   │   │   │   └── types.ts
│   │   │   └── routing-tools/
│   │   │       ├── simpliroute.ts
│   │   │       ├── beetrack.ts
│   │   │       └── types.ts
│   │   │
│   │   └── utils/
│   │       ├── formatDate.ts
│   │       ├── formatCurrency.ts
│   │       ├── validation.ts
│   │       ├── errorHandling.ts
│   │       ├── logger.ts                 # Structured logging
│   │       ├── pdfGenerator.ts           # jsPDF wrapper
│   │       └── constants.ts
│   │
│   ├── types/                            # TypeScript type definitions
│   │   ├── api.ts                        # API types
│   │   ├── database.ts                   # Supabase/database types
│   │   ├── models.ts                     # Domain model types
│   │   ├── enums.ts                      # Enums
│   │   └── index.ts                      # Re-export all types
│   │
│   └── middleware.ts                     # Next.js middleware (auth, rate limiting)
│
├── supabase/                             # Supabase config & migrations
│   ├── config.toml
│   ├── migrations/
│   │   ├── 20260206000000_initial_schema.sql
│   │   ├── 20260206010000_operators_and_users.sql
│   │   ├── 20260206020000_orders_and_manifests.sql
│   │   ├── 20260206030000_barcode_scans.sql
│   │   ├── 20260206040000_audit_logs.sql
│   │   ├── 20260206050000_rls_policies.sql
│   │   └── 20260206060000_indexes.sql
│   └── seed.sql                          # Sample data for development
│
├── __tests__/                            # Tests
│   ├── components/
│   │   ├── dashboard/
│   │   │   └── MetricsCard.test.tsx
│   │   └── pickup/
│   │       └── ScanButton.test.tsx
│   ├── lib/
│   │   ├── utils/
│   │   │   └── formatDate.test.ts
│   │   └── api/
│   │       └── client.test.ts
│   ├── api/
│   │   ├── orders.test.ts
│   │   └── manifests.test.ts
│   └── e2e/
│       ├── login.spec.ts                 # Playwright E2E tests
│       ├── pickup-flow.spec.ts
│       └── dashboard.spec.ts
│
├── docs/                                 # Documentation
│   ├── API.md                            # API documentation
│   ├── ARCHITECTURE.md                   # This file (copy)
│   ├── DEPLOYMENT.md                     # Deployment guide
│   └── DEVELOPMENT.md                    # Dev setup guide
│
└── scripts/                              # Utility scripts
    ├── seed-db.ts                        # Seed database
    ├── generate-types.ts                 # Generate types from Supabase
    └── deploy.sh                         # Deployment script
```

---

### Architectural Boundaries

#### **API Boundaries**

**External API Endpoints (Public-Facing):**
```
Authentication:
  POST   /api/auth/login
  POST   /api/auth/logout
  POST   /api/auth/refresh

Webhooks (Retailers → Aureon):
  POST   /api/integrations/webhooks/:retailerId
```

**Internal API Endpoints (Authenticated, Tenant-Scoped):**
```
All endpoints require:
  - Valid JWT token (Authorization: Bearer <token>)
  - Automatic tenant filtering via middleware (operator_id)
  - Role-based access control (RBAC)

Example:
  GET /api/orders → Returns only orders for authenticated operator
  POST /api/scans → Automatically tagged with operator_id
```

**API Layer Responsibilities:**
- JWT validation (Supabase Auth)
- Rate limiting (1000 req/min per operator)
- Request logging with request_id
- Error handling (standardized format)
- Database queries (via Supabase client)
- Cache management (Redis on Railway)

---

#### **Component Boundaries**

**Frontend Component Communication:**

```
User Action (Button Click)
    ↓
Component Event Handler
    ↓
Zustand Store (Local State) OR TanStack Query (Server State)
    ↓
    ├─ Local: Update Zustand state → Re-render components
    └─ Server: API call → TanStack Query caches → Re-render components
    ↓
Other Components Subscribe to State
    ↓
UI Updates
```

**Component Hierarchy:**
```
App Layout (layout.tsx)
    ├─ Header (shared across all pages)
    ├─ Sidebar (navigation, role-based)
    └─ Page Content (route-specific)
        ├─ Feature Components (dashboard/, pickup/, etc.)
        │   └─ UI Components (buttons, cards, inputs)
        └─ Shared Components (loading, errors, pagination)
```

**State Boundaries:**
- **Zustand stores**: Isolated per domain (scanStore, authStore, syncStore)
- **TanStack Query**: Automatic caching per query key
- **Supabase Realtime**: Live updates push to TanStack Query cache
- **Component props**: One-way data flow (parent → child)

---

#### **Service Boundaries**

**Service Layer Organization:**

```
Frontend (Vercel - Next.js)
    ↓
API Layer (Next.js API Routes - Railway backend)
    ↓
    ├─ Supabase (PostgreSQL + Auth + Realtime + Storage)
    ├─ Redis (Caching + BullMQ job queue)
    └─ n8n (Integration orchestration)
    ↓
External Services
    ├─ Retailer APIs (Falabella, Shopee, Mercado Libre, etc.)
    ├─ Routing Tools (SimpliRoute, Beetrack, Driv.in)
    └─ AI Services (Claude API for support agent)
```

**Service Communication Patterns:**

1. **Frontend ↔ API:** HTTP/REST (fetch/Axios)
2. **API ↔ Database:** Supabase Client (PostgreSQL driver)
3. **API ↔ Cache:** Redis commands (SET/GET/DEL)
4. **API ↔ n8n:** HTTP webhooks + n8n API calls
5. **Frontend ↔ Realtime:** Supabase WebSocket subscriptions
6. **n8n ↔ Retailers:** HTTP (API calls + email IMAP)

---

#### **Data Boundaries**

**Database Schema Boundaries:**

```
Multi-Tenant Data (operator_id required on ALL tables):
  - operators
  - users
  - orders
  - manifests
  - barcode_scans
  - inventory_items
  - sectorization_rules
  - capacity_alerts

Shared Configuration (no operator_id):
  - retailers (global retailer definitions)
  - routing_tools (global routing tool definitions)

Audit Data (immutable, operator_id scoped):
  - audit_logs (7-year retention)
  - integration_logs

System Data (platform-wide):
  - platform_health_metrics
  - subscription_tiers
```

**Data Access Patterns:**

```
// Supabase RLS automatically filters by operator_id
const { data } = await supabase
  .from('orders')
  .select('*')
  // No WHERE operator_id needed - RLS adds automatically

// RLS Policy Example:
CREATE POLICY "tenant_isolation" ON orders
  FOR ALL
  USING (operator_id = auth.operator_id());
```

**Caching Boundaries:**
- **Redis (Railway)**: API response caching (5-60 min TTL)
- **TanStack Query (Frontend)**: Client-side caching (30s-5min stale time)
- **Supabase**: Database query caching (automatic)
- **IndexedDB (PWA)**: Offline scan queue (persists until synced)

---

### Integration Points

#### **Internal Communication**

**Frontend → API:**
```typescript
// lib/api/client.ts - Centralized API client
const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Automatic auth header injection
apiClient.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Automatic error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired, refresh or logout
    }
    return Promise.reject(error)
  }
)
```

**API → Database:**
```typescript
// lib/db/supabase.ts - Supabase client
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!  // Server-side only
)

// Example query with RLS
const { data, error } = await supabase
  .from('orders')
  .select('*')
  .eq('status', 'pending')
  // operator_id filter added automatically by RLS
```

**Frontend ↔ Real-time:**
```typescript
// lib/hooks/useRealtime.ts - Supabase Realtime wrapper
export function useOrderUpdates(operatorId: string) {
  useEffect(() => {
    const channel = supabase
      .channel('orders')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          // Update TanStack Query cache
          queryClient.setQueryData(['orders'], (old) => [...old, payload.new])
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [operatorId])
}
```

---

#### **External Integrations**

**n8n Integration Workflows:**

```
1. Email Manifest Import:
   IMAP (Gmail/Outlook)
      ↓
   n8n: Email Trigger (every 5 min)
      ↓
   n8n: Filter (subject contains "Manifiesto")
      ↓
   n8n: Download CSV Attachment
      ↓
   n8n: CSV Parser
      ↓
   n8n: Data Transform (Retailer schema → Aureon schema)
      ↓
   HTTP POST → Railway API /api/manifests/import
      ↓
   Aureon DB (orders created)

2. Retailer API Sync:
   n8n: Cron Trigger (every 15 min)
      ↓
   n8n: HTTP Request → Falabella API /orders
      ↓
   n8n: Transform Data
      ↓
   HTTP POST → Railway API /api/manifests/import
      ↓
   Aureon DB

3. Webhook Receiver (Routing Tools):
   SimpliRoute Webhook → /api/integrations/webhooks
      ↓
   Railway API receives delivery status update
      ↓
   n8n: Transform status (SimpliRoute format → Retailer format)
      ↓
   HTTP POST → Falabella Webhook /status
      ↓
   Retailer receives update
```

**Retailer API Adapters:**
```typescript
// lib/integrations/retailers/falabella.ts
export const falabellaAdapter = {
  async fetchOrders(date: string) {
    const response = await axios.get('https://api.falabella.com/orders', {
      headers: { 'X-API-Key': process.env.FALABELLA_API_KEY },
      params: { date }
    })

    // Transform Falabella format → Aureon format
    return response.data.orders.map(order => ({
      order_number: order.numero_pedido,
      customer_name: order.nombre_cliente,
      delivery_address: order.direccion,
      retailer_name: 'Falabella',
      raw_data: order  // Store original
    }))
  },

  async sendStatusUpdate(orderId: string, status: string) {
    // Transform Aureon status → Falabella format
    const falabellaStatus = mapStatus(status)

    await axios.post('https://api.falabella.com/webhooks/status', {
      numero_pedido: orderId,
      estado: falabellaStatus,
      timestamp: new Date().toISOString()
    }, {
      headers: { 'X-API-Key': process.env.FALABELLA_API_KEY }
    })
  }
}
```

---

#### **Data Flow**

**Complete Flow: Manifest Import → Pickup → Delivery → Status Update**

```
1. Manifest Import (Retailer → Aureon):
   Falabella Email (CSV)
      ↓
   n8n IMAP → Parse CSV
      ↓
   POST /api/manifests/import
      ↓
   Supabase: Insert into orders table (status: 'pending')
      ↓
   Realtime: Push to frontend (TanStack Query invalidates cache)
      ↓
   Dashboard updates live

2. Pickup Verification (Crew → Mobile PWA):
   Crew opens /pickup/:manifestId
      ↓
   TanStack Query: GET /api/manifests/:id
      ↓
   Display orders (347 orders for Falabella)
      ↓
   Crew scans barcode (offline)
      ↓
   Zustand: Add to offline queue (IndexedDB)
      ↓
   Optimistic UI update (progress bar 1/347 → 2/347)
      ↓
   Background Sync (when online)
      ↓
   POST /api/scans (batch upload)
      ↓
   Supabase: Insert into barcode_scans
      ↓
   Zustand: Mark scans as synced

3. Digital Signature & Receipt:
   Crew completes scanning (347/347)
      ↓
   Navigate to /pickup/:manifestId/sign
      ↓
   Capture signature (canvas element)
      ↓
   POST /api/manifests/:id/sign { signature_data_url }
      ↓
   Supabase Storage: Upload signature image
      ↓
   Supabase: Update manifest (signed: true)
      ↓
   Generate PDF receipt (client-side jsPDF)
      ↓
   Download PDF or share via WhatsApp

4. Status Updates (Aureon → Retailer):
   Order delivered
      ↓
   SimpliRoute webhook → POST /api/integrations/webhooks
      ↓
   Railway API: Update order status (delivered)
      ↓
   BullMQ Job: Notify retailer
      ↓
   n8n: Transform status
      ↓
   POST to Falabella webhook
      ↓
   Falabella receives update within 5 min
```

---

### File Organization Patterns

#### **Configuration Files (Root Level)**

```
package.json              # Dependencies, scripts
next.config.js            # Next.js config (PWA, environment variables)
tailwind.config.ts        # Tailwind CSS customization
tsconfig.json             # TypeScript compiler options
.env.local                # Local environment variables (not committed)
.env.example              # Example environment variables (committed)
.eslintrc.json            # ESLint rules (naming conventions)
jest.config.js            # Jest testing config
playwright.config.ts      # Playwright E2E config
```

#### **Source Organization (src/)**

**By Feature (Not By Type):**
```
✅ Good:
  components/dashboard/MetricsCard.tsx
  components/dashboard/PerformanceChart.tsx
  components/pickup/ScanButton.tsx

❌ Bad:
  components/cards/MetricsCard.tsx
  components/cards/ScanCard.tsx
  components/charts/PerformanceChart.tsx
```

**Utilities Centralized:**
```
lib/utils/formatDate.ts         # Date formatting utilities
lib/utils/validation.ts         # Form validation
lib/api/client.ts               # API client wrapper
lib/stores/scanStore.ts         # Zustand store
```

#### **Test Organization (__tests__/)**

**Mirrors Source Structure:**
```
src/components/dashboard/MetricsCard.tsx
  → __tests__/components/dashboard/MetricsCard.test.tsx

src/lib/utils/formatDate.ts
  → __tests__/lib/utils/formatDate.test.ts

src/app/api/orders/route.ts
  → __tests__/api/orders.test.ts
```

#### **Asset Organization (public/)**

```
public/
  icons/                  # PWA icons, favicon
  images/                 # Static images (logo, placeholders)
  manifest.json           # PWA manifest
```

---

### Development Workflow Integration

#### **Development Server Structure**

```bash
# Start all services locally
npm run dev                # Next.js dev server (http://localhost:3000)
supabase start             # Local Supabase (PostgreSQL on port 54322)
# n8n runs separately on Railway (or local Docker)

# Environment variables loaded from .env.local:
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_KEY=your-local-key
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

#### **Build Process Structure**

```bash
# Build for production
npm run build              # Next.js production build
  ↓
.next/                     # Build output
  ├── static/              # Static assets (hashed filenames)
  ├── server/              # Server-side code
  └── standalone/          # Standalone deployment bundle

# Type checking
npm run type-check         # TypeScript compilation check

# Testing
npm run test               # Jest unit tests
npm run test:e2e           # Playwright E2E tests
```

#### **Deployment Structure**

```
Vercel Deployment (Frontend):
  - Auto-deploy on git push to main
  - Preview deployments for PRs
  - Environment variables from Vercel dashboard
  - Serves .next/static/ from global CDN

Railway Deployment (Backend + n8n):
  - Auto-deploy on git push to main
  - Separate services:
    - aureon-api (Next.js API routes)
    - n8n (integration workflows)
    - redis (caching + BullMQ)
  - Environment variables from Railway dashboard

Supabase (Database):
  - Migrations applied via supabase db push
  - Production database separate from local
```

---

### MVP Implementation Phases

#### **Phase 0: Foundation (Pre-Development - 2 days)**
- Clone Razikus template → `aureon-last-mile/`
- Configure Supabase project
- Deploy skeleton to Vercel + Railway
- Add Serwist PWA configuration
- Set up n8n on Railway

#### **Phase 1: BI Dashboard (Weeks 1-2)**

**Files to Create:**
```
src/app/dashboard/page.tsx
src/components/dashboard/MetricsCard.tsx
src/components/dashboard/CustomerPerformanceTable.tsx
src/components/dashboard/PerformanceChart.tsx
src/app/api/dashboard/metrics/route.ts
src/lib/hooks/useOrders.ts
supabase/migrations/20260206_orders_manifests.sql
```

#### **Phase 2: Pickup Verification Mobile (Weeks 3-4)**

**Files to Create:**
```
src/app/pickup/page.tsx
src/app/pickup/[manifestId]/page.tsx
src/components/pickup/ScanButton.tsx
src/components/pickup/SignatureCapture.tsx
src/lib/stores/scanStore.ts
src/lib/utils/pdfGenerator.ts
src/app/api/scans/route.ts
supabase/migrations/20260206_barcode_scans.sql
next.config.js (PWA configuration with Serwist)
```

#### **Phase 3: Integrations (Parallel with Phase 1-2)**

**n8n Workflows to Create:**
1. Email manifest import (IMAP → CSV parse → API)
2. Falabella API sync (cron → API → transform)
3. Webhook receiver (routing tool → transform → retailer)

**Files to Create:**
```
src/lib/integrations/retailers/falabella.ts
src/app/api/integrations/webhooks/route.ts
```

---

This complete project structure is ready for AI agents to implement. Every requirement is mapped to a specific location, and all boundaries are clearly defined.
