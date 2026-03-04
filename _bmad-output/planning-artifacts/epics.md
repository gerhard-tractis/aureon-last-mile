---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "_bmad-output/planning-artifacts/architecture.md"
  - "_bmad-output/planning-artifacts/ux-design-specification.md"
  - "_bmad-output/planning-artifacts/mockups/pickup-verification-mobile.html"
  - "_bmad-output/planning-artifacts/mockups/business-owner-dashboard-desktop.html"
  - "_bmad-output/planning-artifacts/mockups/operations-control-center-desktop.html"
  - "_bmad-output/planning-artifacts/mockups/operations-control-center-mobile.html"
---

# Aureon_Last_Mile - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Aureon_Last_Mile, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**Data Management & Business Intelligence**

**FR1**: Business owners can view real-time customer volume analysis showing orders per day per retailer

**FR2**: Business owners can view geographic heatmap showing order distribution by comuna/district

**FR3**: Business owners can track capacity utilization (forecast vs actual orders) per retailer

**FR4**: Business owners can view shortage claim costs broken down by customer, location, and time period

**FR5**: Business owners can track SLA performance metrics (on-time delivery percentage, delivery success rate)

**FR6**: Business owners can export operational and financial reports in CSV/PDF format for presentations and contract negotiations

**FR7**: Operations managers can view real-time operational monitoring dashboards showing capacity, pickup status, and inventory levels

**FR8**: The system can ingest order data from email manifests (automated parsing from attachments)

**FR9**: The system can ingest order data from manual CSV/Excel uploads

**FR10**: The system can ingest order data from retailer APIs (Falabella, Shopee, Mercado Libre) via real-time webhooks or polling

**FR11**: The system can store historical order data for trend analysis and contract negotiations

**Pickup Verification & Manifests**

**FR12**: Pickup crew can view their assigned pickup manifests on mobile devices

**FR13**: Pickup crew can scan package barcodes/QR codes using mobile device camera

**FR14**: Pickup crew can see real-time verification status (verified vs pending) with progress tracking during pickup

**FR15**: The system can detect and alert pickup crew when scanned packages don't match the manifest

**FR16**: Pickup crew can capture digital signatures (touch/mouse) to confirm pickup completion

**FR17**: The system can generate PDF receipts showing complete pickup audit trail (timestamp, user, discrepancies, signature)

**FR18**: Pickup crew can work offline (scan locally) and sync data when connection is restored

**FR19**: The system can reconcile pickup discrepancies and log them for shortage claim prevention

**Hub Reception & Chain of Custody**

**FR20**: Warehouse staff can scan packages during hub reception to log arrival

**FR21**: The system can automatically reconcile received packages against signed pickup manifests and alert discrepancies

**FR22**: Warehouse staff can distinguish between retailer shortages (never received) and internal handling issues

**FR23**: The system can log all hub reception activities with timestamp, user, and operator context for accountability

**Warehouse & Inventory Management**

**FR24**: Warehouse staff can assign packages to specific physical locations (docks, zones, shelves, staging areas) via barcode scanning

**FR25**: Warehouse staff can track package movements between locations with full audit trail

**FR26**: Warehouse staff can search for package locations in real-time by order number

**FR27**: The system can provide location history for packages to support theft investigation (last scan location + timestamp)

**FR28**: Warehouse staff can view reconciliation reports comparing signed manifests vs received inventory

**Loading & Route Management**

**FR29**: Loading supervisors can view all orders assigned to specific delivery zones/trucks

**FR30**: Loading supervisors can assign orders to delivery zones based on sectorization rules (comuna/district mappings)

**FR31**: The system can enforce sectorization rules and alert when orders are assigned to incorrect zones

**FR32**: Loading supervisors can override sectorization errors with manual reassignment when needed

**FR33**: Loading crew can scan packages during truck loading to confirm load completion

**FR34**: Loading crew can view real-time loading progress per truck (X of Y packages loaded)

**FR35**: Loading supervisors can mark trucks as loaded and ready for departure

**FR36**: The system can automatically create routes in operator's preferred last-mile tool (SimpliRoute, Beetrack, Driv.in) via API after loading completion

**FR37**: Loading supervisors can configure loading workflows based on hub layout (immediate scan-and-load vs batch scanning)

**Capacity Planning & Forecasting**

**FR38**: Operations managers can view real-time order visibility showing incoming orders from retailer e-commerce systems

**FR39**: Operations managers can receive automated alerts when retailers approach or exceed agreed capacity limits

**FR40**: The system can track retailer forecast accuracy (predicted vs actual order volumes) over time

**FR41**: Operations managers can plan resources 1-2 days in advance based on real-time order forecasts

**Integration & API Management**

**FR42**: The system can integrate with retailer e-commerce platforms (Falabella, Shopee, Mercado Libre, Ripley, Paris) to receive real-time order data

**FR43**: The system can integrate with last-mile routing tools (SimpliRoute, Beetrack, Driv.in) to push routes and receive delivery status updates

**FR44**: The system can receive delivery status updates from last-mile tools via webhooks

**FR45**: The system can transform delivery status data to each retailer's required JSON format and push updates to retailer systems

**FR46**: Admin users can configure retailer API integrations (endpoints, authentication, data mapping) without custom coding

**FR47**: The system can gracefully degrade to email manifest parsing when retailer APIs are unavailable

**FR48**: External retailer developers can access Aureon's public API documentation portal with authentication guides, endpoints, schemas, and code examples

**FR49**: External retailer developers can test integrations in a sandbox environment with test credentials

**User & Access Management**

**FR50**: Admins can create and manage user accounts for all roles (pickup crew, warehouse staff, loading crew, operations managers, admins)

**FR51**: The system can enforce role-based permissions preventing users from accessing unauthorized features

**FR52**: Pickup crew can only access pickup verification features on mobile devices

**FR53**: Warehouse staff can only access warehouse and inventory features

**FR54**: Loading crew can only access loading workflow features

**FR55**: Operations managers can access operational dashboards and reports but cannot modify configurations

**FR56**: Admins can access all features including BI dashboards, configuration management, and user administration

**FR57**: Users can authenticate via JWT-based login with secure session management

**FR58**: The system can enforce tenant isolation ensuring operators cannot access other operators' data

**Support & Troubleshooting**

**FR59**: Operators can submit support queries to the AI support agent (Claude Code) via natural language chat

**FR60**: The AI support agent can query audit logs, order history, and system diagnostics to investigate issues

**FR61**: The AI support agent can provide troubleshooting recommendations for common issues (missing packages, API failures, discrepancies)

**FR62**: The AI support agent can escalate complex issues to human Aureon support team when unable to resolve

**FR63**: The AI support agent can recommend security camera footage timestamps based on package location audit trails

**FR64**: Operations managers can view audit logs for troubleshooting operational issues

**Platform Administration (Aureon DevOps)**

**FR65**: Aureon DevOps can provision new operator tenants with environment configurations (hub layouts, sectorization rules, integration settings)

**FR66**: Aureon DevOps can configure retailer API integrations (endpoints, authentication tokens, data mapping) for operators

**FR67**: Aureon DevOps can monitor platform health (uptime, performance, error rates) via real-time dashboards

**FR68**: Aureon DevOps can access customer usage analytics (active users, API volume, feature adoption) for all operators

**FR69**: The system can alert Aureon DevOps when SLA thresholds are breached (uptime, response time)

**FR70**: Aureon DevOps can manage infrastructure scaling (database replicas, API servers, CDN)

**Multi-Tenant & Subscription Management**

**FR71**: The system can isolate operator data using PostgreSQL Row-Level Security policies

**FR72**: Admins can configure operator-specific settings (sectorization rules, hub layout, branding)

**FR73**: The system can track operator subscription tier (Starter, Growth, Enterprise) and enforce usage limits (order capacity, user count, integration count)

**FR74**: The system can calculate overage charges when operators exceed tier limits (orders, users, integrations)

**FR75**: Admins can view subscription billing history and upcoming charges

**Sectorization & Routing Intelligence**

**FR76**: Admins can define sectorization rules mapping comunas/districts to delivery zones

**FR77**: The system can validate order zone assignments against sectorization rules and prevent allocation errors

**FR78**: Loading supervisors can view suggested zone assignments based on address and sectorization rules

**Audit & Compliance**

**FR79**: The system can log all data access with user_id, operator_id, timestamp, action, and IP address

**FR80**: Admins can review audit trails for security investigations and compliance requirements

**FR81**: The system can retain audit logs for 7 years per Chilean commercial law requirements

**FR82**: The system can encrypt sensitive data (API credentials, retailer authentication tokens) at rest with operator-specific encryption keys

### Non-Functional Requirements

**Performance**

**NFR-P1: Page Load Performance**
- BI dashboard initial load: ≤2 seconds on 10 Mbps broadband connection
- Operational screens (pickup, warehouse, loading): ≤1.5 seconds on mobile 4G connection
- Chart/widget rendering: ≤500ms per widget

**NFR-P2: API Response Time**
- Read operations (GET requests): ≤200ms p95, ≤500ms p99
- Write operations (POST/PUT/PATCH): ≤500ms p95, ≤1s p99
- Bulk operations (manifest processing): ≤5 seconds per 100 orders

**NFR-P3: Concurrent User Support**
- System must support 100+ concurrent users across all operators without performance degradation
- Individual operator must support 20+ concurrent users during peak operations (Cyberdays, Black Friday)

**NFR-P4: Database Query Performance**
- Order search/lookup queries: ≤300ms
- BI aggregation queries: ≤2 seconds for standard date ranges (7 days), ≤10 seconds for extended ranges (90 days)
- Real-time inventory location queries: ≤200ms

**NFR-P5: Mobile Application Performance**
- Barcode scan processing: ≤100ms per scan
- Offline sync on reconnection: ≤30 seconds for 500 records
- Mobile app startup: ≤3 seconds

**Security**

**NFR-S1: Data Encryption**
- All data in transit encrypted with TLS 1.3 (minimum)
- All sensitive data at rest encrypted with AES-256
- Operator-specific encryption keys for API credentials and retailer authentication tokens

**NFR-S2: Multi-Tenant Isolation**
- PostgreSQL Row-Level Security (RLS) policies enforced at database level for 100% tenant data isolation
- No operator can access another operator's data through any API endpoint, database query, or system interface
- All database queries automatically filtered by tenant_id via RLS policies

**NFR-S3: Authentication & Authorization**
- JWT-based authentication with token expiration ≤24 hours
- Role-based access control (RBAC) enforced at API and UI layers
- Password requirements: minimum 12 characters, complexity rules enforced
- Failed login lockout: 5 attempts trigger 15-minute account lockout

**NFR-S4: API Security**
- Rate limiting: 1000 requests per minute per operator, 100 requests per minute per user
- API authentication via Bearer tokens with expiration
- CORS policies restrict origins to authorized domains only

**NFR-S5: Audit & Compliance**
- All data access logged with user_id, operator_id, timestamp, action, IP address
- Audit logs retained for 7 years per Chilean commercial law
- PII and sensitive data access logged separately with enhanced detail
- Quarterly security audits of RLS policies and access logs

**NFR-S6: Data Protection**
- Automated daily backups with 30-day retention
- Backup encryption with separate key management
- Disaster recovery plan with defined RTO/RPO

**Scalability**

**NFR-SC1: Operator Growth**
- System must scale from 1 operator (MVP launch) to 50+ operators within 12 months without architectural changes
- New operator provisioning time: ≤4 hours (including tenant setup, configuration, user creation)

**NFR-SC2: Order Volume Scaling**
- System must handle 4x peak load spikes (e.g., Cyberdays events) without manual intervention
- Starter tier: Support up to 5,000 orders/month per operator
- Growth tier: Support up to 50,000 orders/month per operator
- Enterprise tier: Support 100,000+ orders/month per operator

**NFR-SC3: Database Scalability**
- PostgreSQL database optimized for multi-tenant queries with appropriate indexing on tenant_id + common filter fields
- Database connection pooling configured to support 100+ concurrent connections
- Query execution plans reviewed quarterly to optimize performance as data grows

**NFR-SC4: Auto-Scaling**
- API servers auto-scale horizontally based on CPU utilization (target 70% average)
- Minimum 2 API server instances for redundancy
- Database read replicas provisioned when read load exceeds 60% of primary capacity

**NFR-SC5: Integration Scaling**
- System must support up to 10 retailer integrations per operator without performance degradation
- Webhook/API call queuing to handle burst traffic from retailers (e.g., daily manifest drops)

**Reliability**

**NFR-R1: System Uptime**
- Starter tier: 99% uptime SLA (maximum 7.3 hours downtime per month)
- Growth tier: 99.9% uptime SLA (maximum 43 minutes downtime per month)
- Enterprise tier: 99.95% uptime SLA (maximum 22 minutes downtime per month)

**NFR-R2: Disaster Recovery**
- Recovery Time Objective (RTO): ≤4 hours for critical services (order processing, BI dashboards, operational workflows)
- Recovery Point Objective (RPO): ≤15 minutes for transactional data (orders, inventory, manifests)

**NFR-R3: Data Integrity**
- Zero data loss tolerance for committed transactions (orders, manifests, inventory updates)
- Automated database integrity checks daily
- Referential integrity enforced via foreign key constraints

**NFR-R4: Error Handling & Resilience**
- All user-facing errors display actionable error messages (not generic "Error 500")
- Failed background jobs (manifest processing, retailer sync) automatically retry with exponential backoff (3 retries over 15 minutes)
- System degrades gracefully when dependencies fail (e.g., retailer APIs down → queue for retry, allow manual manifest entry)

**NFR-R5: Monitoring & Alerting**
- Real-time monitoring of API response times, error rates, database performance
- Automated alerts to DevOps when error rate exceeds 1% over 5-minute window, API response time p95 exceeds 1 second, database connections exceed 80% capacity, disk space below 20% free

**NFR-R6: Backup & Recovery**
- Automated daily database backups with 30-day retention
- Ability to restore from backup within 2 hours
- Monthly backup restoration testing to validate recovery procedures

**Integration**

**NFR-I1: External API Reliability**
- Retailer API integrations must maintain 99%+ uptime from Aureon's perspective (excluding retailer downtime)
- Failed API calls automatically queued for retry (3 attempts over 30 minutes with exponential backoff)

**NFR-I2: Graceful Degradation**
- When retailer APIs are unavailable, system falls back to email manifest parsing
- When email parsing fails, system allows manual manifest entry
- Integration failures do not block critical operational workflows (pickup verification, warehouse operations can continue offline)

**NFR-I3: API Versioning**
- Public APIs versioned (e.g., /v1/, /v2/) to prevent breaking changes for external integrations
- Deprecated API versions supported for minimum 12 months with migration notices

**NFR-I4: Data Synchronization**
- Order status updates pushed to retailer systems within 5 minutes of status change
- If push fails, retry queue processes updates until successful delivery or manual intervention required (after 24 hours)

**NFR-I5: Integration Testing**
- Sandbox environment provided for retailer developers to test integrations
- Automated integration tests run nightly to detect API contract changes or failures

**NFR-I6: Third-Party Dependencies**
- External dependencies (email services, SMS providers, map services) have fallback providers configured
- Critical features do not depend on single points of failure for third-party services

### Additional Requirements

**From Architecture Document:**

**Starter Template & Technology Foundation:**
- **CRITICAL - Epic 1 Story 1**: Use Razikus Supabase-Next.js Template as the foundation for the project
- Technology Stack: Next.js 14 App Router, TypeScript, Supabase PostgreSQL, Vercel (frontend hosting), Railway (backend + workers)
- PWA Enhancement Layer: Serwist for service workers, IndexedDB via Dexie for offline storage, Background Sync API for automatic upload when connectivity restored
- Multi-tenant isolation using PostgreSQL Row-Level Security (RLS) policies enforced at database level
- Authentication via Supabase Auth with JWT tokens (24-hour expiration) and role-based access control
- Audit log pattern for all data operations (user_id, operator_id, timestamp, action, IP address)
- Soft delete pattern for all main tables (deleted_at column) to enable recovery
- Raw + normalized data storage for retailer orders (store original JSON/CSV + parsed data)

**Infrastructure & Deployment:**
- Frontend deployment on Vercel with automatic Git deployments and preview URLs per PR
- Backend + workers on Railway with built-in Redis, BullMQ for background jobs, n8n for workflow orchestration
- Database + services on Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions)
- CI/CD pipeline via GitHub Actions (CI: test, type-check, lint, build on every commit; CD: manual deployment for cost control)
- Environment configuration: Development (local), Preview (per PR), Production

**Caching Strategy (Multi-Layer):**
- Layer 1 - Frontend (TanStack Query): Dashboard metrics 30s stale/60s refresh, customer lists 5min, order details 1min
- Layer 2 - API (Redis on Railway): SLA calculations 5min TTL, customer lists 15min TTL, sectorization rules 1hr TTL
- Layer 3 - CDN (Vercel): Static assets cached forever with hash-based invalidation, HTML no cache
- Layer 4 - Offline (Service Worker + IndexedDB): App shell cached forever, scan queue until synced, current manifest until complete

**Monitoring & Error Tracking:**
- Error tracking via Sentry (5,000 errors/month free tier) with stack traces, error grouping, release tracking
- Performance monitoring via Vercel Analytics (page load, Core Web Vitals), Railway Dashboard (CPU, memory, API response), Supabase Dashboard (query performance, connections)
- Uptime monitoring via BetterStack or UptimeRobot (check every 5 minutes, email/SMS alerts)
- Structured JSON logging with request_id, operator_id, user_id, timestamp (30-day retention on Railway)
- Alert rules: Critical (app downtime >5min, error rate >5%, DB connections >90%), Warning (API p95 >1s, failed jobs >10/hr, disk >80%), Info (new signups, integration failures, usage approaching limits)

**API & Communication:**
- REST API pattern with standard HTTP methods (GET, POST, PUT, DELETE) for universal compatibility
- OpenAPI/Swagger documentation for developer experience and AI agent integration
- Rate limiting: 1000 requests/min per operator, 100 requests/min per user
- API versioning (/v1/, /v2/) with 12-month deprecation support

**Database Patterns:**
- Supabase Migrations for version-controlled schema changes with rollback support
- Multi-tenant isolation: Every table includes operator_id, RLS policies enforce tenant filtering
- Database connection pooling for 100+ concurrent connections
- Indexing on tenant_id + common filter fields for query performance

**From UX Design Specification:**

**Mobile-First Operational Design:**
- Primary operational users (pickup crews, warehouse staff, loading crews) use mobile devices (smartphones/tablets) with RF barcode scanners
- Offline-first architecture: All scanning workflows must function without connectivity and sync when connection restored
- Multi-sensory feedback for every scan: Beep sound + vibration + visual confirmation (green flash for success, red overlay for error)
- Large touch targets: Minimum 44px for all interactive elements to support gloved hands and outdoor conditions
- High contrast UI for outdoor visibility in varying lighting conditions
- Progressive adoption support: Training mode vs production mode, confidence indicators, parallel workflow support during transition

**Responsive & Multi-Device:**
- Smartphone UI: Compact, thumb-friendly for pickup crews (primary operational interface)
- Tablet UI: Larger workspace for warehouse supervisors
- Desktop UI: Full dashboards for management with 1440px+ optimization
- Consistent workflows and data across all device types

**Interaction Patterns:**
- RF scanner + touchscreen integration with instant validation feedback (<100ms scan processing per NFR-P5)
- Real-time progress indicators ("You've verified 287/300 orders, 0 discrepancies detected")
- Context-aware error messages ("This order belongs to Yard B, not Yard A" not generic "Error")
- Intelligent validation to prevent costly mistakes while maintaining workflow speed

**Cultural & Localization:**
- Primary language: Spanish (Chilean logistics terminology: comuna, bodega, reparto, indemnización)
- Potential bilingual support (español/inglés) for management reporting

**From Mockup Specifications:**

**Pickup Verification Mobile (3-Screen Workflow):**
- Screen 1 - Manifest List: Display today's pickups (customer, order count, location, time, status), tap to select and start verification
- Screen 2 - Scanning: Real-time progress bar (0/347 → 347/347), large scan area with animation, success feedback (green flash + beep), error feedback (red overlay + triple beep), offline indicator support
- Screen 3 - Completion: Summary stats (orders verified, time, discrepancies, precision), generate digital receipt button, return to manifest list
- Pattern applies to: Loading and Hub Reception workflows (same UX pattern)

**Business Owner Dashboard Desktop:**
- Hero SLA section: 94.2% with color coding, trend indicator (+2.3%), progress bar visualization
- Primary metrics cards: FADR (First Attempt Delivery Rate), Claims (shortage costs in CLP), Efficiency (average time)
- Customer performance table: Sortable columns (Cliente, Pedidos, SLA %, FADR %, Fallos, Valor), color-coded SLA indicators (green/yellow/red), export CSV functionality
- Failed deliveries analysis: Bar chart for top 5 failure reasons with percentages, line chart for trend over time (Chart.js), peak/lowest insights
- Secondary metrics: Capacity utilization, orders per hour, cost per delivery, customer satisfaction rating
- Actions bar: Export report, send to retailers, configure settings

**Operations Control Center Desktop:**
- Collapsible sidebar navigation (70px collapsed → 250px expanded): Hover to expand with labels, click to lock expanded, navigate between sections (Ops Control, Business Dashboard, Inventory, Fleet, Team, Reports, Settings), current section highlighted in Tractis gold (#e6c15c)
- Operations view: Pipeline overview with real-time order counts across 8 stages, compact cards visible without scrolling, detailed orders table with status indicators, delivery promise dates and time windows, interactive filters and search
- Screen size optimization: 1440px+ displays

**Operations Control Center Mobile:**
- Bottom tab bar navigation (60px from bottom for thumb optimization): 5 tabs (📊 Ops, 💰 Dashboard, 📦 Orders, 📈 Reports, ⚙️ More), active tab highlighted in Tractis gold, badge indicator on Ops tab for urgent items, tap to switch sections with header title update
- Operations view: Phone-sized viewport (428px max-width), card-based layout for touch, status summary cards (Urgent/Alert/OK), essential order information at a glance, swipe gestures and pull-to-refresh support

**Design System (Tractis Theme):**
- Colors: Gold primary #e6c15c, Slate palette #f8fafc to #0f172a, status colors (red urgent, yellow alert, green ok, gray late)
- Typography: Inter Variable font family
- Component library: shadcn/ui components integrated with Tractis theme

### FR Coverage Map

**MVP Scope - 47 FRs Covered Across 5 Epics**

**Epic 1: Platform Foundation & Multi-Tenant SaaS Setup**
- Starter Template: Razikus Supabase-Next.js Template + PWA Enhancement Layer
- FR50: Admins can create and manage user accounts for all roles
- FR51: The system can enforce role-based permissions preventing users from accessing unauthorized features
- FR52: Pickup crew can only access pickup verification features on mobile devices
- FR53: Warehouse staff can only access warehouse and inventory features
- FR54: Loading crew can only access loading workflow features
- FR55: Operations managers can access operational dashboards and reports but cannot modify configurations
- FR56: Admins can access all features including BI dashboards, configuration management, and user administration
- FR57: Users can authenticate via JWT-based login with secure session management
- FR58: The system can enforce tenant isolation ensuring operators cannot access other operators' data
- FR65: Aureon DevOps can provision new operator tenants with environment configurations
- FR66: Aureon DevOps can configure retailer API integrations for operators
- FR71: The system can isolate operator data using PostgreSQL Row-Level Security policies
- FR72: Admins can configure operator-specific settings (sectorization rules, hub layout, branding)
- FR79: The system can log all data access with user_id, operator_id, timestamp, action, and IP address
- FR80: Admins can review audit trails for security investigations and compliance requirements
- FR81: The system can retain audit logs for 7 years per Chilean commercial law requirements
- FR82: The system can encrypt sensitive data at rest with operator-specific encryption keys

**Epic 2: Order Data Ingestion**
- FR8: The system can ingest order data from email manifests (automated parsing from attachments)
- FR9: The system can ingest order data from manual CSV/Excel uploads
- FR10: The system can ingest order data from retailer APIs via real-time webhooks or polling
- FR47: The system can gracefully degrade to email manifest parsing when retailer APIs are unavailable

**Epic 3: Business Intelligence Dashboard**
- FR1: Business owners can view real-time customer volume analysis showing orders per day per retailer
- FR2: Business owners can view geographic heatmap showing order distribution by comuna/district
- FR3: Business owners can track capacity utilization (forecast vs actual orders) per retailer
- FR4: Business owners can view shortage claim costs broken down by customer, location, and time period
- FR5: Business owners can track SLA performance metrics (on-time delivery percentage, delivery success rate)
- FR6: Business owners can export operational and financial reports in CSV/PDF format
- FR7: Operations managers can view real-time operational monitoring dashboards
- FR11: The system can store historical order data for trend analysis and contract negotiations

**Epic 4: Pickup Verification Mobile PWA**
- FR12: Pickup crew can view their assigned pickup manifests on mobile devices
- FR13: Pickup crew can scan package barcodes/QR codes using mobile device camera
- FR14: Pickup crew can see real-time verification status with progress tracking during pickup
- FR15: The system can detect and alert pickup crew when scanned packages don't match the manifest
- FR16: Pickup crew can capture digital signatures to confirm pickup completion
- FR17: The system can generate PDF receipts showing complete pickup audit trail
- FR18: Pickup crew can work offline and sync data when connection is restored
- FR19: The system can reconcile pickup discrepancies and log them for shortage claim prevention

**Epic 5: Operations Control Center**
- FR38: Operations managers can view real-time order visibility showing incoming orders from retailer e-commerce systems
- FR39: Operations managers can receive automated alerts when retailers approach or exceed agreed capacity limits
- FR40: The system can track retailer forecast accuracy (predicted vs actual order volumes) over time
- FR41: Operations managers can plan resources 1-2 days in advance based on real-time order forecasts
- FR64: Operations managers can view audit logs for troubleshooting operational issues
- FR67: Aureon DevOps can monitor platform health (uptime, performance, error rates) via real-time dashboards
- FR68: Aureon DevOps can access customer usage analytics (active users, API volume, feature adoption)
- FR69: The system can alert Aureon DevOps when SLA thresholds are breached
- FR70: Aureon DevOps can manage infrastructure scaling

**Post-MVP FRs (Not in Current Scope): 35 FRs**
- Hub Reception & Chain of Custody: FR20-FR23
- Warehouse & Inventory Management: FR24-FR28
- Loading & Route Management: FR29-FR37
- Retailer & Last-Mile Integrations: FR42-FR46, FR48-FR49
- Sectorization & Routing Intelligence: FR76-FR78
- Subscription & Tenant Management: FR73-FR75
- AI-Powered Support Agent: FR59-FR63

## Epic List

**MVP Scope: 5 Epics for 4-Week Implementation Timeline**

### Epic 1: Platform Foundation & Multi-Tenant SaaS Setup

Aureon DevOps can provision secure, isolated operator tenants with complete authentication, role-based access control, and audit infrastructure on a production-ready tech stack.

**FRs covered:** Starter Template (Architecture), FR50-FR58, FR65-FR66, FR71-FR72, FR79-FR82 (19 FRs)

**Technical Foundation:**
- Razikus Supabase-Next.js Template (Next.js 14 App Router, TypeScript)
- PWA Enhancement Layer (Serwist service workers, IndexedDB via Dexie, Background Sync API)
- Multi-tenant isolation via PostgreSQL Row-Level Security (RLS) policies
- Supabase Auth with JWT tokens (24-hour expiration) + RBAC
- Audit log pattern (user_id, operator_id, timestamp, action, IP address)
- Soft delete pattern for data recovery
- Deployment: Vercel (frontend) + Railway (backend + Redis + BullMQ) + Supabase (database + auth)
- CI/CD: GitHub Actions (CI on every commit: test, lint, build; CD: manual deployment)
- Monitoring: Sentry (error tracking), BetterStack (uptime), structured JSON logging

---

### Epic 2: Order Data Ingestion

Operations managers can import retailer orders into the platform via email manifests, CSV uploads, or manual entry with graceful fallback mechanisms.

**FRs covered:** FR8-FR10, FR47 (4 FRs)

**What this enables:**
- Automated email manifest parsing (extract attachments, parse order data)
- CSV/Excel upload interface with validation
- Manual order entry form for edge cases
- Raw + normalized data storage (keep original format + parsed data for debugging)
- Graceful degradation chain: API → Email → Manual entry

---

### Epic 3: Business Intelligence Dashboard

Business owners can track SLA performance, shortage costs, customer metrics, and operational efficiency through interactive dashboards with export capabilities to support data-driven decisions and contract negotiations.

**FRs covered:** FR1-FR7, FR11 (8 FRs)

**What this delivers:**
- Hero SLA section: Large percentage display (94.2%), trend indicator (+2.3%), color-coded progress bar
- Primary metrics cards: FADR (First Attempt Delivery Rate 92.1%), shortage claims (150K CLP), efficiency (42 min avg)
- Customer performance table: Sortable columns (Cliente, Pedidos, SLA %, FADR %, Fallos, Valor), color-coded SLA indicators (green ≥95%, yellow 90-95%, red <90%), export CSV
- Failed deliveries analysis: Chart.js bar chart (top 5 failure reasons with percentages), line chart (trend over time), peak/lowest insights
- Secondary metrics: Capacity utilization (89.2%), orders per hour (38.2), cost per delivery (2,847 CLP), satisfaction (4.6/5.0)
- Export reports: CSV/PDF generation for presentations and retailer meetings
- Historical data storage: Time-series data for trend analysis and contract negotiations

**Mockup:** ✅ business-owner-dashboard-desktop.html

---

### Epic 4: Pickup Verification Mobile PWA

Pickup crews can verify 300+ orders at retailer distribution centers using offline-capable mobile devices with real-time progress tracking, multi-sensory feedback, and digital audit trails to eliminate manual processes and prevent shortage penalties.

**FRs covered:** FR12-FR19 (8 FRs)

**What this delivers:**
- **Screen 1 - Manifest List:** Display today's pickups (Falabella 347 orders, Paris 189, Ripley 256), show customer name, order count, location, pickup time, status, tap card to select and start verification
- **Screen 2 - Scanning Workflow:** Real-time progress bar (0/347 → 347/347), large scan area with animation, barcode/QR scanning via mobile camera, success feedback (green flash + beep sound + vibration), error feedback (red overlay + triple beep + vibration), offline indicator badge, scan validation against manifest
- **Screen 3 - Completion Summary:** Summary stats (orders verified, time elapsed, discrepancies count, precision percentage), digital signature capture (touch/mouse), generate PDF receipt button, return to manifest list
- Offline-first architecture: IndexedDB queue for scans, background sync when connectivity restored, optimistic UI updates
- Multi-sensory feedback: Audio (beep/triple-beep) + haptic (vibration) + visual (green/red overlay) for every scan
- PDF receipt generation: Complete audit trail (timestamp, user, order list, discrepancies, signature)
- Discrepancy reconciliation: Log mismatches for shortage claim prevention

**Mockup:** ✅ pickup-verification-mobile.html

**UX Pattern:** This same pattern (manifest list → scanning → completion) applies to Hub Reception and Loading workflows in post-MVP.

---

### Epic 5: Operations Control Center

Operations managers can monitor real-time capacity, order pipeline status, pickup progress, and receive automated alerts through responsive dashboards (desktop + mobile) to enable proactive resource planning and prevent capacity overruns.

**FRs covered:** FR38-FR41, FR64, FR67-FR70 (10 FRs)

**What this delivers:**

**Desktop Interface (1440px+):**
- Collapsible sidebar navigation: Hover to expand (70px → 250px), click to lock, navigate sections (Ops Control, Business Dashboard, Inventory, Fleet, Team, Reports, Settings), current section highlighted in Tractis gold (#e6c15c)
- Pipeline overview: 8 stages with real-time order counts (Ingresado, Verificado, En Bodega, Asignado, En Carga, Listo, En Ruta, Entregado), compact cards visible without scrolling
- Orders table: Status indicators (🔴 urgent, 🟡 alert, 🟢 ok, ⚫ late), delivery promise dates with smart relative display ("Hoy", "Mañana"), time window countdowns with urgency levels, sortable/filterable columns, pagination
- Interactive features: Click pipeline cards to filter, search orders, live countdown simulation

**Mobile Interface (428px max-width):**
- Bottom tab bar navigation: 5 tabs (📊 Ops, 💰 Dashboard, 📦 Orders, 📈 Reports, ⚙️ More), thumb-optimized positioning (60px from bottom), active tab highlighted in gold, badge indicator for urgent items, header updates based on active tab
- Card-based touch UI: Status summary cards (Urgent/Alert/OK), essential order info at a glance, large touch targets (44px minimum), pull-to-refresh gesture, swipe interactions

**Real-Time Features:**
- Order visibility from retailer e-commerce systems (live ingestion tracking)
- Automated capacity limit alerts (email/SMS when approaching agreed limits)
- Retailer forecast accuracy tracking (predicted vs actual volumes with variance %)
- 1-2 day resource planning forecasts (staffing, truck allocation based on incoming orders)
- Audit log access for troubleshooting (search by user, action, timestamp, resource)

**Platform Monitoring (Aureon DevOps):**
- Platform health dashboard (uptime, API response times, error rates, database performance)
- Customer usage analytics (active users per operator, API volume, feature adoption rates)
- SLA breach alerts (automated notifications when uptime/performance thresholds breached)
- Infrastructure scaling controls (manage database replicas, API servers, CDN)

**Mockups:** ✅ operations-control-center-desktop.html, operations-control-center-mobile.html


---

## Epic 1: Platform Foundation & Multi-Tenant SaaS Setup

Aureon DevOps can provision secure, isolated operator tenants with complete authentication, role-based access control, and audit infrastructure on a production-ready tech stack.

**FRs covered:** Starter Template (Architecture), FR50-FR58, FR65-FR66, FR71-FR72, FR79-FR82 (19 FRs)

---

### Story 1.1: Clone and Deploy Razikus Template Skeleton

As an Aureon DevOps engineer,
I want to clone the Razikus Supabase-Next.js template and deploy the base application to Vercel, Railway, and Supabase,
So that we have a working multi-tenant foundation with authentication already configured.

**Acceptance Criteria:**

**Given** I have access to the Razikus template repository (https://github.com/Razikus/supabase-nextjs-template)
**When** I clone the template and configure environment variables
**Then** The Next.js 14 frontend deploys successfully to Vercel with automatic HTTPS
**And** The application connects to a new Supabase project (PostgreSQL database + Auth + Storage)
**And** The base authentication flow works (sign up, login, logout)
**And** Environment variables are configured: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
**And** GitHub repository is created with main branch protected (requires PR for merges)
**And** I can access the deployed application at a custom Vercel URL

**Edge Cases:**
- Supabase project creation fails → Retry with error logging
- Vercel deployment fails → Check build logs and environment variables
- Template has breaking changes → Pin to specific commit hash for stability

---

### Story 1.2: Configure Multi-Tenant Database Schema with RLS Policies

As an Aureon DevOps engineer,
I want to create the operators table with Row-Level Security policies enforced at the database level,
So that each operator's data is completely isolated and no operator can access another operator's data.

**Acceptance Criteria:**

**Given** Supabase PostgreSQL database is accessible
**When** I run the migration to create the operators table and RLS policies
**Then** The operators table exists with fields: id (UUID), name (VARCHAR), slug (VARCHAR unique), created_at (TIMESTAMP), deleted_at (TIMESTAMP nullable)
**And** RLS is enabled on the operators table
**And** A helper function auth.operator_id() returns the current user's operator_id from JWT claims
**And** RLS policy "tenant_isolation" is created: FOR ALL USING (id = auth.operator_id())
**And** Test queries confirm: User with operator_id 'A' cannot SELECT/INSERT/UPDATE/DELETE rows where operator_id = 'B'
**And** Migration is tracked in Supabase migrations folder with descriptive filename (e.g., 20260207_create_operators_table.sql)

**Edge Cases:**
- RLS not enabled → Migration fails with clear error message
- Helper function auth.operator_id() returns NULL → Queries return empty results (fail-secure)
- Migration rollback → Drops table and policies cleanly

---

### Story 1.3: Implement Role-Based Authentication (5 Roles)

As an Aureon DevOps engineer,
I want to extend Supabase Auth with 5 distinct user roles (pickup_crew, warehouse_staff, loading_crew, operations_manager, admin),
So that users have permissions appropriate to their job function.

**Acceptance Criteria:**

**Given** Supabase Auth is configured from the Razikus template
**When** I create the users table with role and operator_id fields
**Then** The users table exists with fields: id (UUID, FK to auth.users), operator_id (UUID, FK to operators), role (ENUM), email (VARCHAR), full_name (VARCHAR), created_at (TIMESTAMP), deleted_at (TIMESTAMP nullable)
**And** The role ENUM includes exactly: 'pickup_crew', 'warehouse_staff', 'loading_crew', 'operations_manager', 'admin'
**And** RLS policy on users table enforces: Users can only see users from their own operator (operator_id = auth.operator_id())
**And** A database trigger automatically creates a users table entry when a new auth.users record is created (linking id to id)
**And** JWT tokens include custom claims: { operator_id: 'uuid', role: 'pickup_crew' }
**And** Frontend can access role via useUser() hook or equivalent

**Edge Cases:**
- User signup without operator_id → Registration fails with error "Operator required"
- Invalid role value → Database constraint violation error
- User tries to change their own role via API → RLS policy blocks update (only admins can change roles)

---

### Story 1.4: Build User Management Interface (Create Users, Assign Roles)

As an admin user,
I want to create user accounts and assign them to roles and operators via a web interface,
So that I can onboard new users without writing SQL queries.

**Acceptance Criteria:**

**Given** I am logged in as a user with role 'admin'
**When** I navigate to /admin/users and click "Create User"
**Then** A form displays with fields: Email, Full Name, Role (dropdown: pickup_crew, warehouse_staff, loading_crew, operations_manager, admin), Operator (dropdown of operators I have access to)
**And** Submitting the form creates a new auth.users record and corresponding users table entry
**And** The new user receives a password setup email via Supabase Auth
**And** The users table displays all users for my operator in a sortable table (columns: Email, Full Name, Role, Created At, Actions)
**And** I can edit a user's role or full_name by clicking "Edit" (opens modal with form)
**And** I can soft-delete a user by clicking "Delete" (sets deleted_at = NOW(), user can no longer log in)
**And** Non-admin users cannot access /admin/users (route guard redirects to / with error toast)

**Edge Cases:**
- Email already exists → Form validation error: "User with this email already exists"
- User creation fails (Supabase error) → Display error toast with actionable message
- Editing user from different operator → API returns 403 Forbidden (RLS policy blocks)
- Soft-deleted user tries to log in → Supabase Auth blocks login with error "Account disabled"

---

### Story 1.5: Add PWA Enhancement Layer (Serwist + IndexedDB + Background Sync)

As a pickup crew member,
I want the mobile app to work offline and automatically sync my scans when connectivity is restored,
So that I can continue working in warehouses with unreliable WiFi.

**Acceptance Criteria:**

**Given** The Next.js app is deployed to Vercel
**When** I install and configure Serwist for service worker management
**Then** A service worker is registered on app load (visible in Chrome DevTools > Application > Service Workers)
**And** The app shell (HTML, CSS, JS bundles) is cached using cache-first strategy
**And** API requests use network-first strategy with 5-second timeout fallback to cache
**And** An offline fallback page displays when network is unavailable and no cached data exists
**And** IndexedDB database "aureon_offline" is created with table "scan_queue" (id, order_id, barcode, timestamp, synced BOOLEAN, operator_id)
**And** Background Sync API is registered to trigger sync event on connectivity change
**And** When online, queued scans batch-upload to /api/scans/sync endpoint (max 100 per request)
**And** Successful sync updates scan_queue records: synced = TRUE
**And** Connection status banner displays: Green "Online" | Yellow "Offline - XX scans queued" | Gray "Syncing..."

**Edge Cases:**
- Service worker fails to install → Log error to console, app works without offline capability
- IndexedDB quota exceeded (>50MB) → Clear old synced records, show warning toast
- Sync fails (API error) → Retry with exponential backoff (3 attempts over 15 min), then show persistent error notification
- User clears browser cache → IndexedDB persists, queued scans safe

**Technical Requirements:**
- Install Serwist: npm install @serwist/next
- Configure in next.config.js with caching strategies
- Use Dexie.js for type-safe IndexedDB operations

---

### Story 1.6: Set Up Audit Logging Infrastructure

As an admin user,
I want all data access and modifications logged with user, operator, timestamp, and action details,
So that I can investigate security incidents and comply with Chilean 7-year retention law.

**Acceptance Criteria:**

**Given** The database is configured with RLS policies
**When** I create the audit_logs table and database triggers
**Then** The audit_logs table exists with fields: id (UUID), operator_id (UUID), user_id (UUID), action (VARCHAR 50), resource_type (VARCHAR 50), resource_id (UUID nullable), changes_json (JSONB nullable), ip_address (VARCHAR 50), timestamp (TIMESTAMP default NOW())
**And** RLS policy enforces: Users can only query audit_logs for their own operator
**And** Database triggers automatically create audit log entries for: INSERT, UPDATE, DELETE on orders, manifests, inventory, users tables
**And** Audit log entries capture: user_id from JWT, operator_id from RLS context, action ('SCAN_ORDER', 'CREATE_USER', 'DELETE_MANIFEST'), changes_json (before/after state for UPDATEs)
**And** IP address is captured from request headers (X-Forwarded-For or X-Real-IP)
**And** Admins can view audit logs at /admin/audit-logs with filters: Date range, User, Action type, Resource type
**And** Audit logs are retained for 7 years (PostgreSQL retention policy configured)

**Edge Cases:**
- Trigger fails to create audit log → Original operation succeeds, log error to Sentry
- changes_json exceeds JSONB size limit → Truncate to first 10KB with indicator "...truncated"
- IP address header missing → Store as "unknown"
- Querying >100K audit logs → Pagination with 100 records per page

---

### Story 1.7: Configure CI/CD Pipeline (GitHub Actions)

As an Aureon DevOps engineer,
I want automated testing and deployment on every Git push,
So that code quality is enforced and deployments are consistent.

**Acceptance Criteria:**

**Given** The GitHub repository exists with main branch
**When** I create .github/workflows/ci.yml and .github/workflows/deploy.yml
**Then** The CI workflow runs on every push and PR with jobs: npm run test (Jest unit tests), npm run type-check (TypeScript compilation), npm run lint (ESLint), npm run build (verify Next.js builds successfully)
**And** All jobs must pass before PR can be merged to main (branch protection rule enforced)
**And** The deploy workflow runs on merge to main with jobs: Deploy frontend to Vercel production, Deploy backend to Railway production, Run Supabase migrations via CLI
**And** PR deployments create preview environments: Vercel preview URL, Railway preview environment, Supabase branch database
**And** GitHub Actions secrets are configured: VERCEL_TOKEN, RAILWAY_TOKEN, SUPABASE_ACCESS_TOKEN
**And** Build status badges display in README.md

**Edge Cases:**
- Tests fail on PR → Deployment blocked, PR status shows red X
- Vercel deployment fails → Rollback to previous version automatically, alert DevOps via email
- Migration fails on production → Stop deployment, alert DevOps, require manual intervention
- Preview environment cleanup → Delete after 7 days or when PR is closed

---

### Story 1.8: Set Up Monitoring and Alerting (Sentry + BetterStack)

As an Aureon DevOps engineer,
I want real-time error tracking and uptime monitoring with automated alerts,
So that I know immediately when the platform is down or throwing errors.

**Acceptance Criteria:**

**Given** The application is deployed to Vercel and Railway
**When** I configure Sentry and BetterStack integrations
**Then** Sentry is initialized in the Next.js app with DSN from environment variable SENTRY_DSN
**And** Frontend errors are captured with stack traces, user context (user_id, operator_id, role), and breadcrumbs (last 10 user actions)
**And** Backend API errors are captured with request context (endpoint, method, headers, body)
**And** Sentry groups errors by fingerprint and shows error count, affected users, first/last seen
**And** BetterStack monitors endpoints: https://app.aureon.com (every 5 minutes), https://api.aureon.com/health (every 5 minutes)
**And** Uptime alerts are sent via email and SMS when: Endpoint down >5 minutes, Response time >10 seconds, SSL certificate expires in <7 days
**And** Error alerts are sent via email when: Error rate >5% over 5-minute window, New error type appears, Error affects >10 users

**Edge Cases:**
- Sentry initialization fails → App works normally, errors not tracked (fail-open)
- BetterStack API unreachable → No uptime monitoring, alert DevOps manually
- Alert fatigue (too many alerts) → Group similar alerts, send digest every 30 minutes instead of per-error
- Free tier limits exceeded (5,000 Sentry errors/month) → Throttle error reporting to critical errors only


---

## Epic 2: Order Data Ingestion & Automation Worker

Operations managers can import retailer orders into the platform via automated connectors (email/CSV, browser scraping, API), manual CSV upload, or manual entry. A multi-tenant automation worker on a dedicated VPS handles automated ingestion with a typed connector framework and job queue. First tenant: Transportes Musan (Easy via CSV/email, Paris via Beetrack browser scraping).

**FRs covered:** FR8-FR10, FR47 (4 FRs)

**Scope expanded:** 2026-02-18 — Sprint Change Proposal added automation worker infrastructure (Stories 2.3-2.7), browser scraping capability, and job orchestration. See `_bmad-output/planning-artifacts/sprint-change-proposal-2026-02-18.md`.

---

### Story 2.1: Create Orders and Packages Tables with Data Model

As an Aureon DevOps engineer,
I want to create the orders and packages tables with fields for both normalized data and raw retailer format,
So that we can store orders from multiple sources, track individual scannable packages (cartons), and re-process if parsing errors occur.

**Note:** Scope expanded during implementation (2026-02-17) to include packages table (16 columns) based on domain analysis. Packages are the scannable units (CTN labels) that compose orders, supporting barcode scanning workflows in Epic 4 (Pickup Verification).

**Acceptance Criteria:**

**Given** The multi-tenant database is configured with RLS
**When** I run the migration to create the orders table
**Then** The orders table exists with fields: id (UUID), operator_id (UUID), order_number (VARCHAR 50 unique per operator), customer_name (VARCHAR 255), customer_phone (VARCHAR 20), delivery_address (TEXT), comuna (VARCHAR 100), delivery_date (DATE), delivery_window_start (TIME), delivery_window_end (TIME), retailer_name (VARCHAR 50), raw_data (JSONB), imported_via (ENUM: 'API', 'EMAIL', 'MANUAL', 'CSV'), imported_at (TIMESTAMP), created_at (TIMESTAMP), deleted_at (TIMESTAMP nullable)
**And** RLS policy enforces: Users can only access orders for their operator (operator_id = auth.operator_id())
**And** Unique constraint on (operator_id, order_number) prevents duplicate order numbers within an operator
**And** Index created on (operator_id, delivery_date) for fast date-range queries
**And** Index created on (operator_id, order_number) for fast order lookups
**And** raw_data JSONB field stores the original data format from retailer (email/CSV/API payload)

**Edge Cases:**
- Duplicate order_number within operator → INSERT fails with constraint violation error
- raw_data exceeds 1MB → Truncate with indicator in metadata
- Invalid delivery_date format → Database rejects with type mismatch error

---

### Story 2.2: Build CSV/Excel Upload Interface with Validation

As an operations manager,
I want to upload a CSV or Excel file with orders and see validation results before importing,
So that I can quickly import manifests received via email or downloaded from retailer portals.

**Acceptance Criteria:**

**Given** I am logged in as an operations_manager or admin
**When** I navigate to /orders/import and select "Upload CSV/Excel"
**Then** A file upload dropzone displays with accepted formats: .csv, .xlsx, .xls (max 10MB file size)
**And** Dragging a file or clicking "Browse" opens file picker
**And** After file selection, the system parses the file and displays a preview table with first 10 rows
**And** Required columns are validated: order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date (format: YYYY-MM-DD or DD/MM/YYYY)
**And** Missing required columns show error: "Missing required column: [column_name]"
**And** Optional columns are imported if present: delivery_window_start, delivery_window_end, retailer_name, notes
**And** Data validation errors display inline: Invalid phone format (not 9 digits), invalid date format, missing required field, duplicate order_number in file
**And** Valid rows show green checkmark, invalid rows show red X with error message
**And** Bottom summary shows: "X valid rows, Y errors" with button "Import X Valid Orders" (disabled if 0 valid)
**And** Clicking "Import" creates orders in database with imported_via = 'CSV', raw_data = entire row as JSON
**And** Success toast displays: "Imported X orders successfully. Y errors skipped."
**And** Failed rows can be exported as CSV with error column for correction and re-upload

**Edge Cases:**
- File exceeds 10MB → Error: "File too large. Maximum 10MB."
- File is not CSV/Excel → Error: "Invalid file format. Please upload .csv or .xlsx"
- CSV has wrong encoding (not UTF-8) → Auto-detect and convert, or show encoding error
- Duplicate order_number already exists in database → Mark as error: "Order #123 already exists"
- 0 valid rows → Disable import button, show "Fix errors before importing"

---

### Story 2.3: Set Up VPS Infrastructure and n8n

**Note:** Scope changed 2026-02-18 via Sprint Change Proposal. Original "Email Manifest Parsing" story replaced with automation worker infrastructure. See `_bmad-output/planning-artifacts/sprint-change-proposal-2026-02-18.md`.

As an Aureon DevOps engineer,
I want to provision a VPS with n8n and the automation worker runtime,
So that we have dedicated infrastructure for running data ingestion connectors (email, browser, API).

**Acceptance Criteria:**

**Given** A Hostinger KVM 2 VPS (São Paulo, 2 vCPU, 8GB RAM, 100GB NVMe) is provisioned
**When** I run the setup script and configure services
**Then** Ubuntu 24.04 LTS is installed and hardened (UFW firewall: allow SSH + n8n port only)
**And** Node.js 20+ is installed via nvm
**And** n8n is installed globally and running as a systemd service with auto-restart
**And** n8n basic auth is enabled (N8N_BASIC_AUTH_ACTIVE=true)
**And** n8n is connected to Supabase via environment variables (SUPABASE_URL, SUPABASE_SERVICE_KEY)
**And** Playwright with Chromium is installed (`npx playwright install --with-deps chromium`)
**And** The `apps/worker/` directory structure is created in the repository
**And** A deploy.sh script exists for pulling latest code and restarting services
**And** GitHub Actions workflow deploys to VPS via SSH on push to `apps/worker/**`
**And** Architecture doc is updated to reflect VPS infrastructure (replacing Railway n8n)
**And** Deployment runbook has new VPS section with setup instructions

**Edge Cases:**
- VPS provisioning fails → Document manual setup steps as fallback
- n8n crashes → systemd auto-restarts, alert via BetterStack
- SSH key rotation → Document in deployment runbook

**Technical Requirements:**
- Provider: Hostinger KVM 2 ($6.99/month, São Paulo)
- OS: Ubuntu 24.04 LTS
- Software: Node.js 20+, n8n (global), Playwright + Chromium
- Services: n8n (systemd, 24/7), worker process (systemd, 24/7)
- New repo structure: `apps/worker/` with src/, n8n/, scripts/

---

### Story 2.4: Create Automation Worker Database Schema

**Note:** Scope changed 2026-02-18 via Sprint Change Proposal. Original "Manual Order Entry Form" story moved to 2.8.

As an Aureon DevOps engineer,
I want to create the database tables for the automation worker's connector framework and job queue,
So that connectors can be configured per tenant/client and jobs can be tracked and orchestrated.

**Acceptance Criteria:**

**Given** The existing operators table serves as the tenant identity
**When** I run the migration
**Then** The `tenant_clients` table exists with fields: id (UUID), operator_id (UUID FK to operators), name (VARCHAR), slug (VARCHAR), connector_type (ENUM: 'csv_email', 'api', 'browser'), connector_config (JSONB), is_active (BOOLEAN), created_at, updated_at
**And** Unique constraint on (operator_id, slug) prevents duplicate client slugs per operator
**And** RLS policy enforces tenant isolation via operator_id = public.get_operator_id()
**And** The `jobs` table exists with fields: id (UUID), operator_id (UUID FK), client_id (UUID FK to tenant_clients), job_type (ENUM: 'csv_email', 'api', 'browser'), status (ENUM: 'pending', 'running', 'completed', 'failed', 'retrying'), priority (INT), scheduled_at (TIMESTAMPTZ), started_at, completed_at, result (JSONB), error_message (TEXT), retry_count (INT), max_retries (INT default 3), created_at
**And** Index on jobs (status, priority DESC, scheduled_at) WHERE status IN ('pending', 'retrying') for efficient worker polling
**And** The `raw_files` table exists with fields: id (UUID), operator_id (UUID FK), client_id (UUID FK), job_id (UUID FK to jobs), file_name (VARCHAR), storage_path (VARCHAR), file_size_bytes (INT), row_count (INT), received_at (TIMESTAMPTZ)
**And** RLS policies on all new tables enforce tenant isolation
**And** The `orders` table is extended with new columns: external_load_id (VARCHAR nullable), recipient_region (VARCHAR nullable), service_type (VARCHAR nullable), total_weight_kg (DECIMAL nullable), total_volume_m3 (DECIMAL nullable), status (VARCHAR default 'pending'), status_detail (VARCHAR nullable), source_file (VARCHAR nullable), tenant_client_id (UUID FK to tenant_clients nullable)
**And** Seed data inserted for Transportes Musan: operator record + Easy (csv_email) and Paris (browser) tenant_clients with connector_config templates

**Edge Cases:**
- connector_config contains credentials → Must be encrypted (application-level encryption with VPS env key)
- Migration conflicts with existing orders columns → Use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
- Seed data for Musan assumes operator already exists → Check and create if needed

**Technical Requirements:**
- Migration file: `apps/frontend/supabase/migrations/YYYYMMDD_create_automation_worker_schema.sql`
- Reuse existing RLS pattern: `public.get_operator_id()`
- connector_config examples documented in migration comments
- Credential fields use `ENCRYPTED:` prefix convention (decrypted by worker at runtime)

---

### Story 2.5: Implement Easy CSV/Email Connector

As an operations manager at Transportes Musan,
I want the system to automatically parse Easy's daily CSV manifests received via email,
So that orders from Easy/Cencosud are imported without manual intervention.

**Acceptance Criteria:**

**Given** n8n is running on the VPS and connected to Supabase
**When** An email arrives from Easy's sender address with a CSV attachment
**Then** n8n workflow triggers via IMAP polling (every 10 minutes)
**And** Email is filtered by sender address and subject line (from connector_config)
**And** CSV attachment is extracted and uploaded to Supabase Storage: `raw-files/{operator_slug}/{client_slug}/{date}/{filename}`
**And** CSV is parsed with correct encoding (Latin-1) and delimiter (;) as configured in connector_config
**And** CSV columns are mapped to orders table fields via the column_map in connector_config
**And** Orders are upserted using (operator_id, order_number) as conflict key — existing orders are updated (cumulative CSV logic)
**And** Each order is created with imported_via = 'EMAIL', raw_data = original CSV row as JSON, source_file = filename, tenant_client_id = Easy's client ID
**And** A job record is created/updated in the jobs table tracking rows_processed and errors
**And** Audit log entries are created: action = 'EMAIL_IMPORT', resource_type = 'order'
**And** On failure: job marked as failed, error logged to Sentry, notification sent

**Edge Cases:**
- Easy sends cumulative CSVs (12:00 has load 0001, 13:00 has 0001+0002) → UPSERT handles this, always process most recent email
- CSV encoding is Latin-1 with ; delimiter → Configured per-client in connector_config
- Email has no attachment → Log warning, skip processing
- CSV is corrupt/unreadable → Mark job as failed, log to Sentry
- Duplicate processing of same email → Track processed email IDs to prevent re-processing

**Technical Requirements:**
- n8n workflow: IMAP Trigger → Filter → Extract Attachment → Upload to Storage → Parse CSV → Column Map → Upsert to Supabase → Log Job
- n8n workflow exported as JSON: `apps/worker/n8n/workflows/easy-csv-import.json`
- Supabase Storage bucket: `raw-files` (create if not exists)
- Uses Supabase service role key for direct DB access (no API proxy)
- Validation reuses Story 2.2 logic where applicable (phone format, date format, comuna validation)

---

### Story 2.6: Implement Paris/Beetrack Browser Connector

As an operations manager at Transportes Musan,
I want the system to automatically extract today's orders from the Paris/Beetrack portal,
So that orders from Paris/Cencosud are imported without manual login and data copy.

**Acceptance Criteria:**

**Given** OpenClaw and Playwright are installed on the VPS with Groq API configured
**When** A scheduled browser job triggers (2x daily: 07:00 and 14:00 CLT)
**Then** The worker launches a Playwright headless Chrome session
**And** Navigates to Beetrack login page and authenticates with Paris credentials (from encrypted connector_config)
**And** Navigates to the orders/deliveries section
**And** Filters by today's date
**And** Extracts all order rows from the table (handles pagination if needed)
**And** Browser session is closed immediately after extraction (free RAM)
**And** Extracted data is mapped to orders table schema
**And** Orders are upserted to Supabase using (operator_id, external_order_id) as conflict key
**And** Raw extracted data is uploaded as JSON to Supabase Storage: `raw-files/{operator_slug}/{client_slug}/{date}/beetrack_extract.json`
**And** Job record is updated with rows_processed count
**And** On failure: screenshot is saved to Storage for debugging, job marked as failed, notification sent

**Edge Cases:**
- Login fails → Retry once, then mark job as failed with screenshot
- Beetrack is down/unreachable → Retry with exponential backoff (max 3 retries)
- Extraction fails mid-page → Save screenshot, log partial results, mark job as failed
- Session timeout during extraction → Catch error, close browser, retry
- Credentials expired → Mark job as failed, alert operations team to update credentials
- No orders for today → Job completes successfully with rows_processed = 0

**Technical Requirements:**
- Browser agent: OpenClaw with Playwright (headless Chromium)
- LLM: Groq API → Llama 4 Scout (17Bx16E, 128k context) — $0.11/$0.34 per MTok
- Credentials: Stored encrypted in connector_config, decrypted at runtime with VPS ENCRYPTION_KEY
- Sequential execution: Only one browser session at a time (conserve RAM on 8GB VPS)
- Scheduled via cron job creating entries in jobs table

---

### Story 2.7: Implement Job Queue Orchestration and Monitoring

As an Aureon DevOps engineer,
I want a reliable job orchestration system with monitoring and alerting,
So that connectors run on schedule, failures are retried, and the team is notified of issues.

**Acceptance Criteria:**

**Given** The jobs table and tenant_clients are configured
**When** The worker process is running on the VPS
**Then** Worker polls the jobs table every 30 seconds: `SELECT ... FROM jobs WHERE status IN ('pending', 'retrying') AND (scheduled_at IS NULL OR scheduled_at <= now()) ORDER BY priority DESC, scheduled_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
**And** When a job is found: status → 'running', started_at → now(), execute connector based on job_type
**And** On success: status → 'completed', completed_at → now(), result JSONB updated
**And** On failure: retry_count++, if < max_retries → status → 'retrying' (with backoff), else → 'failed'
**And** A cron process creates scheduled jobs daily at 06:00 CLT for all active browser connector clients
**And** CSV/email jobs are created by n8n on email receipt (event-driven) but still logged to jobs table
**And** Health monitoring: systemd watchdog for both n8n and worker processes
**And** Alerts via n8n workflow: job failed after max retries → notification, no jobs completed in expected window → warning, VPS disk usage > 80% → alert
**And** Sentry captures worker errors with job context
**And** Worker logs structured output to stdout (captured by journald)
**And** GitHub Actions workflow deploys `apps/worker/` to VPS via SSH on push

**Edge Cases:**
- Worker process crashes → systemd auto-restarts
- Two jobs picked simultaneously → FOR UPDATE SKIP LOCKED prevents double-processing
- Job runs longer than expected → No timeout by default (browser scraping can be slow), but log duration
- VPS disk fills up → Alert at 80%, auto-cleanup of old journald logs at 90%
- Supabase unreachable → Worker retries connection with exponential backoff

**Technical Requirements:**
- Worker: Node.js process running as systemd service
- Job polling: PostgreSQL advisory locks via FOR UPDATE SKIP LOCKED
- Notifications: n8n workflow triggered by Supabase webhook or polling failed jobs
- Logging: Structured JSON to stdout → journald
- Deployment: `apps/worker/scripts/deploy.sh` + GitHub Actions SSH workflow
- Monitoring: BetterStack for VPS uptime, Sentry for errors

---

### Story 2.8: Build Manual Order Entry Form (Fallback)

**Note:** Moved from original Story 2.4 position. Requirements unchanged.

As an operations manager,
I want to manually enter a single order via a web form,
So that I can add orders when email and CSV fail or for one-off special deliveries.

**Acceptance Criteria:**

**Given** I am logged in as an operations_manager or admin
**When** I navigate to /orders/new and fill out the manual entry form
**Then** A form displays with fields: Order Number (required, text), Customer Name (required, text), Customer Phone (required, text with validation: 9 digits), Delivery Address (required, textarea), Comuna (required, autocomplete dropdown from Chilean comuna list), Delivery Date (required, date picker), Delivery Window Start (optional, time picker), Delivery Window End (optional, time picker), Retailer Name (optional, dropdown: Falabella, Shopee, Mercado Libre, Ripley, Paris, Other), Notes (optional, textarea)
**And** Real-time validation on blur: Phone must be 9 digits (format: +56912345678 or 912345678), Order number cannot be duplicate (AJAX check), Comuna must be valid Chilean comuna
**And** Clicking "Save Order" creates order in database with imported_via = 'MANUAL', raw_data = {form_values, created_by: user_id}
**And** Success toast displays: "Order #[order_number] created successfully" with link to order detail page
**And** Form resets for next order entry with button "Add Another Order"
**And** Validation errors display inline in red below each field
**And** Submit button disabled until all required fields valid

**Edge Cases:**
- Duplicate order_number → Form error: "Order #123 already exists for this operator"
- Invalid phone format → Form error: "Phone must be 9 digits"
- Future delivery date >30 days away → Warning (not error): "Delivery date is more than 30 days away. Confirm?"
- Missing required field on submit → Focus first invalid field, show error message


---

## Epic 3: Business Intelligence Dashboard

Business owners can track SLA performance, shortage costs, customer metrics, and operational efficiency through interactive dashboards with export capabilities to support data-driven decisions and contract negotiations.

**FRs covered:** FR1-FR7, FR11 (8 FRs)

**Mockup:** ✅ business-owner-dashboard-desktop.html

---

### Story 3.1: Create Performance Metrics Tables and Calculation Logic

As an Aureon DevOps engineer,
I want to create database tables and functions for calculating SLA, FADR, and other performance metrics,
So that dashboard queries are fast and metrics are consistently calculated.

**Acceptance Criteria:**

**Given** The orders table exists with delivery data
**When** I create the performance_metrics and delivery_attempts tables with calculation functions
**Then** The delivery_attempts table exists with fields: id (UUID), operator_id (UUID), order_id (UUID FK), attempt_number (INT), status (ENUM: 'success', 'failed', 'returned'), failure_reason (VARCHAR 100 nullable), attempted_at (TIMESTAMP), driver_id (UUID nullable), created_at (TIMESTAMP)
**And** The performance_metrics table exists with fields: id (UUID), operator_id (UUID), metric_date (DATE), retailer_name (VARCHAR 50 nullable for per-retailer metrics), total_orders (INT), delivered_orders (INT), first_attempt_deliveries (INT), failed_deliveries (INT), shortage_claims_count (INT), shortage_claims_amount_clp (DECIMAL), avg_delivery_time_minutes (DECIMAL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**And** Unique constraint on (operator_id, metric_date, retailer_name) prevents duplicate metrics
**And** Database function calculate_sla(operator_id, start_date, end_date) returns: (delivered_orders / total_orders * 100) as percentage
**And** Database function calculate_fadr(operator_id, start_date, end_date) returns: (first_attempt_deliveries / total_orders * 100) as percentage
**And** Database function get_failure_reasons(operator_id, start_date, end_date) returns: JSON array of {reason, count, percentage}
**And** Nightly cron job (PostgreSQL pg_cron or Railway cron) runs at 2 AM to calculate yesterday's metrics for all operators and insert into performance_metrics table

**Edge Cases:**
- Division by zero (no orders on a day) → Return NULL or 0% with indicator
- Missing delivery attempt data → SLA calculation excludes orders without attempts
- Metrics calculation fails → Log to Sentry, send alert, retry next night

---

### Story 3.2: Build Hero SLA Section with Real-Time Calculation

As a business owner,
I want to see a prominent SLA percentage with trend indicator at the top of my dashboard,
So that I immediately know if delivery performance is improving or declining.

**Acceptance Criteria:**

**Given** I am logged in as admin or operations_manager and navigate to /dashboard
**When** The dashboard loads
**Then** The hero SLA section displays prominently at top with: Large percentage display (e.g., "94.2%"), Size: 48px font, Tractis gold (#e6c15c) if ≥95%, yellow if 90-95%, red if <90%
**And** Trend indicator shows: Arrow icon (↑ green if improving, ↓ red if declining), Percentage change from previous 7-day period (e.g., "+2.3%"), Comparison text: "vs. previous 7 days"
**And** Progress bar visualization below percentage: Width 100%, filled portion = SLA percentage, color matches percentage color coding
**And** Hover tooltip displays: "SLA: [delivered_orders] delivered / [total_orders] total orders", Date range: "Last 7 days ([start_date] - [end_date])"
**And** Clicking SLA section opens drill-down modal showing: Daily SLA breakdown (7-day chart), Per-retailer SLA table, Failed orders list with reasons
**And** Data refreshes every 30 seconds using TanStack Query background refetch
**And** Loading state shows skeleton loader (pulsing gray rectangle) while data fetches

**Edge Cases:**
- No orders in last 7 days → Display "N/A" with message "No orders in this period"
- SLA calculation in progress → Show loading spinner
- API error → Display last cached value with warning icon "Data may be outdated"

---

### Story 3.3: Implement Primary Metrics Cards (FADR, Claims, Efficiency)

As a business owner,
I want to see key operational metrics (FADR, shortage claims, delivery efficiency) in prominent cards below the SLA section,
So that I can quickly assess overall performance.

**Acceptance Criteria:**

**Given** I am viewing the dashboard at /dashboard
**When** The page loads below the hero SLA section
**Then** Three primary metrics cards display side-by-side: FADR card, Shortage Claims card, Efficiency card
**And** Each card shows: Large metric value (32px font), Metric label (16px, gray), Trend indicator (↑/↓ with percentage change vs. previous period), Small line chart (Chart.js) showing last 7 days trend
**And** FADR Card displays: Percentage (e.g., "92.1%"), Label: "First Attempt Delivery Rate", Color: Green if ≥90%, yellow if 80-90%, red if <80%, Calculation: (first_attempt_deliveries / total_orders * 100)
**And** Shortage Claims Card displays: Amount in CLP (e.g., "150,000 CLP"), Label: "Shortage Claims (Last 30 Days)", Color: Red if >100K, yellow if 50K-100K, green if <50K, Breakdown on hover: Count of claims, Average per claim
**And** Efficiency Card displays: Time in minutes (e.g., "42 min"), Label: "Avg. Delivery Time", Color: Green if ≤40min, yellow if 40-60min, red if >60min, Calculation: Average time from pickup to delivery
**And** Clicking any card opens detailed view with: Full historical chart (30-day), Breakdown by retailer, Contributing factors

**Edge Cases:**
- No delivery attempts → FADR shows "N/A"
- No shortage claims → Shows "0 CLP" in green
- Metric calculation fails → Show last cached value with staleness indicator

---

### Story 3.4: Build Customer Performance Table (Sortable, Color-Coded)

As a business owner,
I want to see a table of all retailers with their performance metrics in sortable columns,
So that I can identify which customers are performing well and which need attention.

**Acceptance Criteria:**

**Given** I am viewing the dashboard below the primary metrics cards
**When** The customer performance table loads
**Then** A table displays with columns: Cliente (retailer name), Pedidos (order count), SLA % (on-time delivery), FADR % (first attempt rate), Fallos (failed delivery count), Valor (revenue or order value), Actions (view details button)
**And** Default sort: By Pedidos (order count) descending (largest customers first)
**And** Clicking any column header toggles sort ascending/descending with visual indicator (↑/↓ icon)
**And** SLA % column has color-coded background: Green if ≥95%, Yellow if 90-95%, Red if <90%
**And** FADR % column has color-coded background: Green if ≥90%, Yellow if 80-90%, Red if <80%
**And** Each row shows data for last 30 days by default
**And** Date range filter above table: Dropdown (Last 7 days, Last 30 days, Last 90 days, Custom range)
**And** Search box filters table by retailer name (client-side filter, instant)
**And** Pagination: 10 rows per page with "Load More" button at bottom
**And** "Export CSV" button top-right downloads table data with current filters/sort applied

**Edge Cases:**
- No data for retailer in period → Show "0" for metrics, gray background
- Retailer name too long → Truncate with ellipsis, full name on hover
- Table >100 retailers → Virtual scrolling or pagination for performance

---

### Story 3.5: Create Failed Deliveries Analysis with Chart.js Visualizations

As a business owner,
I want to see visual charts analyzing failed delivery reasons and trends,
So that I can identify patterns and address root causes.

**Acceptance Criteria:**

**Given** I am viewing the dashboard below the customer table
**When** The failed deliveries analysis section loads
**Then** Two charts display side-by-side: Bar chart (failure reasons), Line chart (trend over time)
**And** Bar Chart shows: Title: "Top 5 Failure Reasons (Last 30 Days)", X-axis: Failure reasons (e.g., "Cliente ausente", "Dirección incorrecta", "Rechazado"), Y-axis: Count of occurrences, Bars colored by severity: Red (>50 occurrences), Yellow (20-50), Gray (<20), Percentage label on each bar (e.g., "Cliente ausente: 34%")
**And** Line Chart shows: Title: "Failed Deliveries Trend (Last 30 Days)", X-axis: Dates, Y-axis: Failed delivery count, Single line showing daily failed deliveries, Red color (#ef4444), Hover tooltip shows: Date, count, top failure reason for that day, Peak/Lowest annotations: "Peak: [date] ([count] failures)", "Lowest: [date] ([count] failures)"
**And** Both charts use Chart.js library with responsive sizing (resize with window)
**And** Clicking bar or line point opens drill-down: Filtered order list for that reason/date, Ability to export filtered list
**And** Date range filter applies to both charts simultaneously

**Edge Cases:**
- No failed deliveries in period → Show empty state: "Great news! No failed deliveries in this period."
- <5 failure reasons → Show all reasons, not just top 5
- Chart rendering fails → Show error message with retry button

---

### Story 3.6: Add Secondary Metrics Dashboard

As a business owner,
I want to see additional operational metrics (capacity utilization, orders/hour, cost/delivery, customer satisfaction),
So that I have a complete picture of business performance.

**Acceptance Criteria:**

**Given** I am viewing the dashboard below the failed deliveries charts
**When** The secondary metrics section loads
**Then** Four smaller metric cards display in a row: Capacity Utilization, Orders per Hour, Cost per Delivery, Customer Satisfaction
**And** Capacity Utilization card shows: Percentage (e.g., "89.2%"), Label: "Capacity Utilization", Color: Yellow if >85%, green if 60-85%, red if <60% or >95%, Calculation: (actual_orders / forecasted_capacity * 100), Tooltip: "Actual: X orders, Capacity: Y orders"
**And** Orders per Hour card shows: Number (e.g., "38.2"), Label: "Orders Processed per Hour", Color: Green if ≥40, yellow if 30-40, red if <30, Calculation: Total orders processed / total operational hours
**And** Cost per Delivery card shows: Amount in CLP (e.g., "2,847 CLP"), Label: "Average Cost per Delivery", Color: Green if ≤2500, yellow if 2500-3500, red if >3500, Breakdown on hover: Labor cost, fuel cost, overhead
**And** Customer Satisfaction card shows: Rating out of 5 (e.g., "4.6/5.0"), Label: "Customer Satisfaction", Star rating visualization (filled stars), Color: Green if ≥4.5, yellow if 4.0-4.5, red if <4.0
**And** All cards show trend indicators (↑/↓ percentage change vs. previous period)

**Edge Cases:**
- Missing satisfaction data → Show "N/A" with message "No satisfaction surveys completed"
- Cost data incomplete → Show estimate with disclaimer icon
- Capacity forecast not set → Show "Capacity not configured" with link to settings

---

### Story 3.7: Implement Export Functionality (CSV/PDF Reports)

As a business owner,
I want to export dashboard data as CSV or PDF reports,
So that I can share performance data with stakeholders and use in presentations.

**Acceptance Criteria:**

**Given** I am viewing the complete dashboard with all metrics loaded
**When** I click the "Export Report" button in the actions bar
**Then** A modal opens with export options: Format (CSV or PDF radio buttons), Date Range (Last 7/30/90 days or Custom), Include Sections (checkboxes: SLA Summary, Metrics, Customer Table, Failed Deliveries Chart, Secondary Metrics), File Name (editable text field, default: "aureon-dashboard-[date].csv")
**And** Clicking "Export CSV" downloads a CSV file containing: All selected sections as separate sheets (if multi-sheet format supported) or clearly labeled sections, Customer table with all columns and current filters, Metrics as rows: Metric Name, Value, Change vs. Previous Period, Date Range
**And** Clicking "Export PDF" generates a formatted PDF report with: Company logo (configurable in settings), Report title: "Aureon Performance Dashboard", Date range and generation timestamp, All selected sections with charts rendered as images, Page numbers and table of contents, Footer: "Generated by Aureon Last Mile"
**And** PDF uses professional styling: Tractis color scheme, Clean table formatting, Chart.js charts exported as high-res PNG, Page breaks between major sections
**And** Export progress shows: "Generating report..." with spinner, Success toast: "Report downloaded: [filename]", Download starts automatically
**And** Generated reports are logged in audit_logs: action = 'EXPORT_DASHBOARD', resource_type = 'report', metadata includes date range and sections

**Edge Cases:**
- Export >1000 rows in customer table → Paginate or warn about large file size
- PDF generation fails → Fallback to CSV export with error message
- Chart rendering in PDF fails → Include data table instead of chart
- User cancels during generation → Abort export, clean up temp files

---

### Story 3.8: Set Up TanStack Query Caching for Dashboard Performance

As a business owner,
I want the dashboard to load quickly and not spam the API with redundant requests,
So that I have a smooth user experience even when switching between tabs.

**Acceptance Criteria:**

**Given** The dashboard uses TanStack Query for data fetching
**When** I navigate to /dashboard
**Then** TanStack Query is configured with: Stale time: 30 seconds (data considered fresh for 30s, no refetch), Cache time: 5 minutes (data kept in memory for 5min after last use), Background refetch: Every 60 seconds while page is active, Refetch on window focus: true (refresh when switching back to tab), Retry logic: 3 attempts with exponential backoff (1s, 2s, 4s delays)
**And** Query keys are structured hierarchically: ['dashboard', operator_id, 'sla', {start_date, end_date}], ['dashboard', operator_id, 'metrics', {period}], ['dashboard', operator_id, 'customers', {sort, filters}]
**And** Loading states show skeleton loaders (not spinners) for better perceived performance
**And** Error states show toast notification with retry button, last cached data remains visible with staleness indicator
**And** Optimistic updates: Date range changes show immediately with old data, then update when new data arrives
**And** Query invalidation: Creating/updating orders invalidates dashboard queries, Export action does NOT invalidate (read-only)
**And** DevTools integration: TanStack Query DevTools available in development mode (bottom-right corner icon)

**Edge Cases:**
- Network offline → Show last cached data with "Offline" banner, queue refetch for when online
- API consistently failing → Show error state after 3 retries, option to force refresh
- Multiple tabs open → Shared cache across tabs (BroadcastChannel API), changes in one tab update others
- Cache size grows large (>50MB) → Automatically prune oldest unused queries


---

## Epic 4: Pickup Verification Mobile PWA

Pickup crews can verify 300+ orders at retailer distribution centers using offline-capable mobile devices with real-time progress tracking, multi-sensory feedback, and digital audit trails to eliminate manual processes and prevent shortage penalties.

**FRs covered:** FR12-FR19 (8 FRs)

**Mockup:** ✅ pickup-verification-mobile.html

---

### Story 4.1: Create Manifests and Pickup Scans Tables

As an Aureon DevOps engineer,
I want to create database tables for manifests and pickup scans with proper relationships,
So that we can track which orders are assigned to which pickups and verify scan completeness.

**Acceptance Criteria:**

**Given** The orders table exists from Epic 2
**When** I create the manifests and pickup_scans tables
**Then** The manifests table exists with fields: id (UUID), operator_id (UUID), retailer_name (VARCHAR 50), pickup_location (TEXT), pickup_date (DATE), pickup_time_start (TIME), pickup_time_end (TIME), total_orders (INT), assigned_to_user_id (UUID FK to users, nullable), status (ENUM: 'pending', 'in_progress', 'completed', 'cancelled'), created_at (TIMESTAMP), completed_at (TIMESTAMP nullable)
**And** The manifest_orders junction table exists with fields: id (UUID), manifest_id (UUID FK), order_id (UUID FK), sequence_number (INT), created_at (TIMESTAMP)
**And** Unique constraint on (manifest_id, order_id) prevents duplicate orders in a manifest
**And** The pickup_scans table exists with fields: id (UUID), operator_id (UUID), manifest_id (UUID FK), order_id (UUID FK), barcode_scanned (VARCHAR 100), scan_status (ENUM: 'success', 'mismatch', 'duplicate'), scanned_by_user_id (UUID FK to users), scanned_at (TIMESTAMP), synced_to_server (BOOLEAN default false), created_at (TIMESTAMP)
**And** RLS policies enforce: Users can only access manifests/scans for their operator
**And** Index on (manifest_id, synced_to_server) for fast offline sync queries
**And** Index on (order_id) for fast scan validation lookups

**Edge Cases:**
- Order deleted but still in manifest → Soft delete preserved, manifest shows as "Order not found"
- Manifest without orders → total_orders = 0, can still complete with note
- Scan without matching order → scan_status = 'mismatch', logged for review

---

### Story 4.2: Build Screen 1 - Manifest List (Today's Pickups)

As a pickup crew member,
I want to see all my assigned pickup manifests for today with order counts and locations,
So that I know which retailer DCs to visit and how many orders to verify.

**Acceptance Criteria:**

**Given** I am logged in as pickup_crew on a mobile device
**When** I navigate to /pickup (mobile PWA home screen)
**Then** Screen 1 displays with header: "Pickups - [Today's Date]", subtitle: "Tap a manifest to start verification"
**And** A list of manifest cards displays, each showing: Retailer name (large, bold, e.g., "Falabella"), Order count (e.g., "347 orders"), Location (e.g., "Centro de Distribución San Bernardo"), Pickup time window (e.g., "10:00 - 12:00"), Status badge (color-coded: Gray "Pending", Yellow "In Progress X/Y", Green "Completed ✓")
**And** Default sort: By pickup_time_start ascending (earliest pickups first)
**And** Cards for manifests with status 'in_progress' show progress: "In Progress: 287/347 scanned"
**And** Tapping a manifest card navigates to Screen 2 (Scanning) with manifest_id in route: /pickup/scan/[manifest_id]
**And** If manifest status is 'pending', tapping updates status to 'in_progress' and sets assigned_to_user_id = current user
**And** If manifest status is 'completed', tapping shows completion summary (Screen 3) in read-only mode
**And** Pull-to-refresh gesture fetches latest manifest list from server (or queue for sync if offline)
**And** Empty state displays when no manifests: "No pickups assigned for today" with illustration

**Edge Cases:**
- No manifests for today → Show empty state
- Manifest already assigned to different user → Show warning: "Assigned to [user_name]. Contact supervisor to reassign."
- Offline on first load → Show cached manifests from last sync with "Offline" banner
- Multiple pickups at same location → Group by location with expandable section

---

### Story 4.3: Build Screen 2 - Barcode Scanning with Camera Integration

As a pickup crew member,
I want to scan package barcodes using my mobile camera and see instant validation feedback,
So that I can quickly verify all orders in the manifest.

**Acceptance Criteria:**

**Given** I tapped a manifest card and navigated to /pickup/scan/[manifest_id]
**When** Screen 2 loads
**Then** The screen displays: Header with back button and manifest info: "[Retailer] - [Order Count] orders", Large progress bar showing: "0 / 347" initially, updates in real-time, colored: Red if <50%, Yellow if 50-90%, Green if ≥90%, Large scan area (60% of screen height) with: Animated scanning line pulsing up/down, Camera viewfinder overlay (rounded rectangle target zone), Text: "Position barcode in frame" or "Tap to scan", Bottom stats bar: "✓ Verified: 0 | ✗ Errors: 0 | ⏱ Time: 00:00"
**And** Camera permission is requested on first load with clear explanation: "We need camera access to scan barcodes"
**And** Camera auto-activates when screen loads (no "Start Camera" button needed)
**And** When barcode enters target zone: Auto-detect and scan using QuaggaJS or html5-qrcode library, Vibrate (100ms), Play beep sound, Immediately validate against manifest orders
**And** Manual scan button displays for devices without auto-scan or when camera fails: "Enter Barcode Manually" opens text input modal
**And** Scanned barcode is validated: If matches order in manifest → Success flow (Story 4.4), If NOT in manifest → Error flow (Story 4.4), If already scanned (duplicate) → Duplicate warning
**And** Timer starts when first scan occurs, displays as "MM:SS" format

**Edge Cases:**
- Camera permission denied → Show manual entry option with warning
- Poor lighting conditions → Show message: "Move to better lighting" and increase camera exposure
- Barcode unreadable (damaged) → After 3 failed scans, prompt manual entry
- QR code instead of barcode → Support both formats
- Device doesn't support camera (desktop browser) → Show keyboard input as primary method

---

### Story 4.4: Implement Multi-Sensory Feedback (Audio + Haptic + Visual)

As a pickup crew member,
I want to receive immediate multi-sensory confirmation when I scan a package,
So that I know the scan was registered even in noisy warehouse environments.

**Acceptance Criteria:**

**Given** I am on Screen 2 (Scanning) and scan a barcode
**When** The barcode validation completes
**Then** For SUCCESS (barcode matches manifest order): Visual feedback: Green flash overlay (500ms fade), success checkmark icon animation, progress bar increments (+1), "Verified" count increments, Audio feedback: Single beep sound (300ms, 800Hz tone), Haptic feedback: Single vibration pulse (100ms), UI update: Scanned order briefly highlights in green at bottom (3-second toast: "Order #12345 ✓")
**And** For ERROR (barcode not in manifest): Visual feedback: Red overlay (1 second), X icon animation, shake animation on scan area, Audio feedback: Triple beep (200ms beeps with 100ms gaps, 400Hz lower tone), Haptic feedback: Three vibration pulses (100ms each with 100ms gaps), UI update: Error toast (5 seconds): "Order #[barcode] not in manifest. Contact supervisor.", "Errors" count increments
**And** For DUPLICATE (already scanned): Visual feedback: Yellow overlay (500ms), warning icon, Audio feedback: Double beep (200ms beeps, 600Hz tone), Haptic feedback: Double vibration pulse (100ms each), UI update: Warning toast (3 seconds): "Order #12345 already scanned at [time]"
**And** All feedback happens simultaneously (not sequentially) for instant perception
**And** Sound can be muted via settings toggle (visual + haptic remain)
**And** Haptic feedback respects device settings (disabled if device has haptics off)

**Technical Requirements:**
- Audio: Use Web Audio API or HTML5 Audio with preloaded sound files
- Haptic: Use Vibration API (navigator.vibrate)
- Visual: CSS animations with Tailwind or Framer Motion

**Edge Cases:**
- Device doesn't support vibration → Visual + audio only
- Sound playback fails (iOS restrictions) → Visual + haptic only, show toast: "Enable sound in settings"
- Multiple rapid scans → Queue feedback, don't overlap (max 1 feedback per 200ms)

---

### Story 4.5: Build Offline Scan Queue with IndexedDB Storage

As a pickup crew member,
I want my scans to be saved locally when I'm offline,
So that I can continue working without WiFi and won't lose data.

**Acceptance Criteria:**

**Given** The PWA has IndexedDB configured from Epic 1 Story 1.5
**When** I scan a barcode on Screen 2
**Then** The scan is immediately saved to IndexedDB table "scan_queue" with fields: {id, manifest_id, order_id, barcode_scanned, scan_status, scanned_at, synced: false, operator_id, user_id}
**And** Optimistic UI update: Progress bar, counts, and feedback all update immediately (don't wait for server)
**And** Connection status banner displays at top: Green "Online - Syncing" when connected, Yellow "Offline - 15 scans queued" when disconnected, Gray "Syncing..." during background sync
**And** If online: Immediately POST scan to /api/pickup/scans endpoint, On success: Update IndexedDB record synced = true, On failure: Keep in queue, retry via background sync
**And** If offline: Save to IndexedDB only, Queue count displays in banner, No error shown to user (silent queueing)
**And** All scans remain in IndexedDB until synced (even if app is closed/refreshed)
**And** Progress bar and counts calculate from IndexedDB (local source of truth), not server

**Edge Cases:**
- IndexedDB quota exceeded (>50MB) → Delete synced scans older than 7 days, show warning
- Scan saved locally but POST fails (server error) → Keep in queue, show banner: "Will retry sync"
- App crashes mid-scan → On restart, IndexedDB preserves all scans, resume where left off
- User switches manifests → Current manifest scans saved, load different manifest from IndexedDB

---

### Story 4.6: Implement Background Sync When Connectivity Restored

As a pickup crew member,
I want my queued scans to automatically upload when WiFi returns,
So that I don't have to manually sync or worry about lost data.

**Acceptance Criteria:**

**Given** I have scans in IndexedDB with synced = false (offline queue)
**When** Network connectivity is restored (offline → online transition)
**Then** Background Sync API registers sync event: "pickup-scans-sync"
**And** Sync handler triggers automatically (no user action needed)
**And** Sync process: Query IndexedDB for scans where synced = false, Batch scans by manifest_id (max 100 scans per request), POST to /api/pickup/scans/bulk endpoint: {manifest_id, scans: [{order_id, barcode, scanned_at, user_id}, ...]}, On success: Update IndexedDB records synced = true for uploaded scans, On failure: Retry with exponential backoff (1s, 2s, 4s delays, max 3 attempts)
**And** UI updates during sync: Banner changes to "Syncing... X scans remaining", Progress indicator (spinner), Toast on completion: "Synced 15 scans successfully"
**And** If sync partially fails (some scans succeed, some fail): Successful scans marked synced = true, Failed scans remain in queue, Show toast: "Synced 10/15 scans. 5 failed, will retry."
**And** Sync runs in background (Service Worker), works even if app tab is closed

**Technical Requirements:**
- Use Background Sync API: navigator.serviceWorker.ready.then(reg => reg.sync.register('pickup-scans-sync'))
- Service Worker listens for 'sync' event and handles upload
- Fallback for browsers without Background Sync: Use online event listener + manual fetch

**Edge Cases:**
- Network flaky (goes offline during sync) → Pause sync, resume when stable
- Sync fails 3 times → Show persistent error notification: "Sync failed. Check connection or contact support."
- User forces sync via button → Trigger sync event manually, show progress
- Large queue (500+ scans) → Batch in chunks of 100, show progress: "Syncing batch 1/5"

---

### Story 4.7: Build Screen 3 - Completion Summary with Digital Signature

As a pickup crew member,
I want to review the verification summary and capture a digital signature to confirm pickup completion,
So that we have legal proof of what was verified.

**Acceptance Criteria:**

**Given** I have scanned all orders (progress = 100%) or clicked "Complete Pickup" button
**When** Screen 3 loads at /pickup/complete/[manifest_id]
**Then** The screen displays completion summary: Header: "Pickup Complete - [Retailer]", Four stat cards in grid: "Orders Verified: 347" (large, green), "Time Elapsed: 1h 23m" (calculated from first to last scan), "Discrepancies: 2" (red if >0, green if 0, count of error scans), "Precision: 99.4%" (calculated: verified / total * 100)
**And** Discrepancies section (if errors > 0): List of unverified/error orders: "Order #12345 - Not found in manifest", "Order #67890 - Already scanned", Explanation text: "Contact supervisor about discrepancies before leaving"
**And** Digital signature capture area: Canvas element (300x150px), responsive to touch and mouse, Text: "Sign to confirm pickup", Clear button to reset signature, Signature required before completing (button disabled if empty)
**And** Two action buttons: "Generate Receipt" (primary, green), "Back to Scanning" (secondary, gray)
**And** Clicking "Generate Receipt" validates: Signature is not empty → Error if empty: "Signature required", All critical errors resolved (configurable: allow minor discrepancies)
**And** On validation success: Save signature as base64 PNG to database (manifests.signature_data), Update manifest status = 'completed', completed_at = NOW(), Navigate to PDF receipt screen (Story 4.8)

**Edge Cases:**
- User tries to complete with 0 scans → Block with error: "No orders scanned. Cannot complete."
- Signature too simple (single dot) → Accept but log warning (no rejection, user might have simple signature)
- User navigates away without completing → Scans saved in IndexedDB, can resume later
- Multiple discrepancies (>10) → Require supervisor override code to complete

---

### Story 4.8: Generate PDF Receipt with Complete Audit Trail

As a pickup crew member,
I want to generate a PDF receipt showing all verified orders and my signature,
So that the retailer has proof of pickup and I have protection against future shortage claims.

**Acceptance Criteria:**

**Given** I completed the pickup and provided a digital signature
**When** I click "Generate Receipt" on Screen 3
**Then** A PDF is generated using jsPDF library with: Header section: "AUREON LAST MILE - PICKUP RECEIPT" title, Company logo (configurable), Receipt ID: [manifest_id] and date/time, Pickup details section: Retailer: [name], Location: [address], Date: [pickup_date], Time window: [start] - [end], Assigned to: [user full_name]
**And** Verification summary: Total orders in manifest: [count], Orders verified: [count] (green), Discrepancies: [count] (red if >0), Precision: [percentage], Time elapsed: [duration]
**And** Order list table (if ≤50 orders): Columns: Order Number, Status (✓ Verified or ✗ Error), Scanned At, All verified orders listed, Discrepancies highlighted in red with reason
**And** If >50 orders: Summary only, full list available via "Download Detailed List" button
**And** Discrepancy details section (if errors > 0): List of unverified orders with reasons, Retailer acknowledgment text: "Retailer acknowledges missing orders listed above"
**And** Signature section: Digital signature image (captured from Screen 3), Signature line with printed name: "[user full_name]", Date and time of signature
**And** Footer: "This is a legally binding document. Retain for 7 years per Chilean commercial law.", Page number (if multi-page), Generated by Aureon Last Mile
**And** PDF download options: Save to device (downloads/[manifest_id]-receipt.pdf), Email to supervisor (button: "Email Receipt"), Share via native share API (mobile)
**And** PDF generation logged in audit_logs: action = 'GENERATE_PICKUP_RECEIPT', resource_type = 'manifest', resource_id = manifest_id

**Technical Requirements:**
- Use jsPDF library for PDF generation
- Embed signature as base64 PNG image
- Support Spanish text (UTF-8 encoding)
- Professional formatting with Tractis branding

**Edge Cases:**
- PDF generation fails (memory limit) → Fallback to simplified version (summary only, no order list)
- Email fails → Show error toast, save PDF locally as backup
- Large manifest (500+ orders) → Generate PDF in background, show progress, notify when ready
- Signature image too large → Compress to max 100KB before embedding


---

## Epic 5: Operations Control Center

Operations managers can monitor real-time capacity, order pipeline status, pickup progress, and receive automated alerts through responsive dashboards (desktop + mobile) to enable proactive resource planning and prevent capacity overruns.

**FRs covered:** FR38-FR41, FR64, FR67-FR70 (10 FRs)

**Mockups:** ✅ operations-control-center-desktop.html, operations-control-center-mobile.html

---

### Story 5.1: Create Order Status Tracking and Capacity Forecast Tables

As an Aureon DevOps engineer,
I want to create tables for tracking order pipeline status and capacity forecasts,
So that operations managers can see real-time order flow and plan resources.

**Acceptance Criteria:**

**Given** The orders table exists with basic fields
**When** I extend the schema with status tracking and create forecast tables
**Then** The orders table is extended with fields: pipeline_status (ENUM: 'ingresado', 'verificado', 'en_bodega', 'asignado', 'en_carga', 'listo', 'en_ruta', 'entregado'), status_updated_at (TIMESTAMP), priority (ENUM: 'urgent', 'alert', 'ok', 'late'), delivery_promise_date (DATE), time_window_countdown_minutes (INT calculated field)
**And** The capacity_forecasts table exists with fields: id (UUID), operator_id (UUID), retailer_name (VARCHAR 50), forecast_date (DATE), forecasted_orders (INT), actual_orders (INT), variance_percentage (DECIMAL), created_at (TIMESTAMP), updated_at (TIMESTAMP)
**And** Unique constraint on (operator_id, retailer_name, forecast_date)
**And** Database function calculate_pipeline_counts(operator_id) returns JSON: {ingresado: count, verificado: count, en_bodega: count, ...}
**And** Database trigger auto-updates status_updated_at when pipeline_status changes
**And** Database function calculate_priority(delivery_date, current_time) returns: 'urgent' if <45min to deadline, 'alert' if 45min-2hr, 'ok' if >2hr, 'late' if past deadline
**And** Index on (operator_id, pipeline_status) for fast status filtering
**And** Index on (operator_id, delivery_promise_date) for deadline queries

**Edge Cases:**
- Order moves backward in pipeline (e.g., en_ruta → en_bodega for returns) → Allow with audit log entry
- Forecast not set for day → actual_orders recorded, forecasted_orders = NULL, variance = NULL
- Multiple status changes in 1 second → Only last update persists, all logged in audit

---

### Story 5.2: Build Desktop Navigation and Pipeline Overview (8 Stages)

As an operations manager,
I want to see a collapsible sidebar for navigation and a pipeline overview showing real-time order counts across all stages,
So that I can quickly understand order flow and navigate between sections.

**Acceptance Criteria:**

**Given** I am logged in as operations_manager or admin on desktop (≥1280px width)
**When** I navigate to /operations-control
**Then** A collapsible sidebar displays on the left: Width: 70px collapsed (default), 250px expanded, Hover to expand (shows labels), Click to lock expanded state, Navigation items: 📊 Ops Control (current, highlighted in Tractis gold #e6c15c), 💰 Business Dashboard, 📦 Inventory, 🚚 Fleet & Trucks, 👥 Team, 📈 Reports, ⚙️ Settings
**And** Main content area displays pipeline overview: Title: "Operations Control - [Operator Name]", 8 pipeline stage cards in responsive grid (all visible without scrolling on 1440px): Ingresado, Verificado, En Bodega, Asignado, En Carga, Listo, En Ruta, Entregado
**And** Each pipeline card shows: Stage name (Spanish), Large count number (e.g., "23"), Icon representing stage, Color coding: Red if urgent orders in stage, Yellow if alerts, Green if all ok, Click to filter orders table to this stage
**And** Real-time update: Counts refresh every 30 seconds via TanStack Query, Smooth count animation on change (count-up effect), Badge shows "Updated Xs ago"
**And** Sidebar state persists in localStorage (remains expanded/collapsed on page refresh)

**Edge Cases:**
- Narrow desktop (1280px-1440px) → Sidebar auto-collapses, cards in 2x4 grid
- 0 orders in stage → Show "0" in gray
- Network offline → Show last cached counts with "Offline" indicator

---

### Story 5.3: Build Desktop Orders Table with Filters, Search, Live Updates

As an operations manager,
I want to see a detailed orders table with status, delivery promises, time windows, and filtering capabilities,
So that I can monitor specific orders and identify urgent items.

**Acceptance Criteria:**

**Given** I am viewing /operations-control on desktop below the pipeline overview
**When** The orders table loads
**Then** A table displays with columns: Status (🔴🟡🟢⚫ indicator), Order # (clickable link), Cliente (retailer), Destino (comuna), Promesa (delivery promise date with smart display: "Hoy", "Mañana", "DD/MM"), Ventana (time window with countdown: "En 45 min", "En 2h 15m", "Pasado"), Estado (current pipeline_status), Acciones (reassign, view details buttons)
**And** Default sort: By time window countdown ascending (most urgent first)
**And** Status indicators: 🔴 Urgent (red) if <45min to window, 🟡 Alert (yellow) if 45min-2hr, 🟢 OK (green) if >2hr, ⚫ Late (gray) if past deadline
**And** Clicking column header toggles sort (asc/desc) with visual indicator
**And** Top toolbar contains: Search input (searches order #, cliente, destino), Date filter dropdown (Hoy, Mañana, Próximos 7 días, Custom range), Status filter (All, Urgentes, Alertas, OK, Pasados), Pipeline stage filter (populated from sidebar card clicks), Clear filters button
**And** Pagination: 25 rows per page, "Load More" button at bottom (infinite scroll), Virtual scrolling if >100 orders for performance
**And** Clicking order # opens detail modal: Full order info, History timeline (status changes), Reassign to different zone button, Notes field
**And** Real-time updates: New orders appear at top with highlight animation, Status changes update in-place, Countdown timers decrement every minute

**Edge Cases:**
- >500 orders → Virtual scrolling enabled, search becomes server-side
- Search no results → Show empty state: "No orders match '[query]'"
- Time window passed while viewing → Row color changes to gray, moves to bottom of list
- Filter combination returns 0 results → Show "No orders match filters. Clear filters?"

---

### Story 5.4: Build Mobile Bottom Tab Navigation and Status Summary Cards

As an operations manager on mobile,
I want bottom tab navigation and status summary cards for quick access to urgent items,
So that I can monitor operations while away from my desk.

**Acceptance Criteria:**

**Given** I am logged in as operations_manager or admin on mobile (max-width 768px)
**When** I navigate to /operations-control on mobile
**Then** Mobile interface displays with: Header: "Ops Control" (updates based on active tab), Content area showing current tab content, Bottom tab bar (fixed at bottom, 60px from bottom edge for thumb reach)
**And** Bottom tab bar contains 5 tabs: 📊 Ops (active by default, highlighted in Tractis gold), 💰 Dashboard, 📦 Orders, 📈 Reports, ⚙️ More (settings, logout)
**And** Active tab styling: Gold background (#e6c15c), Scale animation on tap, Badge indicator (e.g., "3" on Ops tab for urgent items)
**And** Tapping tab switches content, updates header title, persists scroll position per tab
**And** Ops tab content displays status summary cards at top: Three cards in row: "Urgentes" (red, count of urgent orders), "Alertas" (yellow, count of alerts), "OK" (green, count of ok orders)
**And** Each status card shows: Large count, Status label, Tap to filter orders list to this status, Visual indicator (icon + color)
**And** Status cards update in real-time (30s refresh)

**Edge Cases:**
- Badge count >99 → Display "99+"
- All statuses = 0 → Show "No active orders" with illustration
- Tab switch during network request → Cancel previous request, load new tab data

---

### Story 5.5: Build Mobile Orders List with Pull-to-Refresh

As an operations manager on mobile,
I want to see a card-based orders list optimized for touch with pull-to-refresh,
So that I can review orders on-the-go and get latest updates.

**Acceptance Criteria:**

**Given** I am on the Ops tab on mobile, below the status summary cards
**When** The orders list loads
**Then** Orders display as cards (not table) with: Order # (large, bold), Cliente + Comuna (secondary text), Delivery promise with countdown: "Hoy - En 45 min" (red if urgent), Pipeline status badge (colored chip), Large touch target (min 60px height), Swipe left reveals quick actions: "Ver detalles", "Reasignar"
**And** Default sort: Urgent orders first (red status), then alerts (yellow), then OK (green)
**And** Cards grouped by status with headers: "🔴 Urgentes (3)", "🟡 Alertas (12)", "🟢 OK (45)"
**And** Pull-to-refresh gesture (swipe down from top): Shows loading spinner, Fetches latest data from server, Animates content refresh, Shows toast: "Updated Xs ago"
**And** Infinite scroll: Loads 20 orders initially, "Load More" button loads next 20, Lazy loading as user scrolls
**And** Search input at top (collapsible): Tap to expand, searches order # and cliente, Shows results count: "3 results for 'Falabella'"
**And** Filter button opens modal with: Status checkboxes, Date range picker, Pipeline stage selector, Apply/Clear buttons

**Edge Cases:**
- Pull-to-refresh while offline → Show cached data with "Offline" message
- No orders for selected filters → Show empty state: "No orders match filters"
- Rapid scroll → Debounce load more to prevent duplicate requests
- Swipe gesture conflicts with browser back → Disable horizontal swipe gestures

---

### Story 5.6: Implement Capacity Alerts and Forecast Accuracy Tracking

As an operations manager,
I want to receive automated alerts when retailers approach capacity limits and see forecast accuracy,
So that I can proactively plan resources and avoid being overwhelmed.

**Acceptance Criteria:**

**Given** Capacity forecasts exist in the database for retailers
**When** Daily order ingestion occurs
**Then** System calculates capacity utilization: For each retailer on each day: actual_orders / forecasted_orders * 100 = utilization_percentage
**And** Automated alerts trigger when: ≥80% of forecast reached → Email + in-app notification: "Falabella approaching capacity (278/300 orders, 93%)", ≥100% of forecast reached → Urgent alert: "Falabella EXCEEDED capacity (347/300 orders, 116%)", ≥120% of forecast → Critical alert with SMS: "Falabella at 140% capacity (420/300). Immediate action required."
**And** Alert recipients: Operations managers for the operator, Aureon DevOps (for platform-wide capacity monitoring)
**And** In-app notifications display: Alert bell icon (badge count), Notification panel slides from right, List of alerts with: Timestamp, severity color, retailer name, utilization %, "Dismiss" and "View Details" buttons
**And** /capacity-planning page shows: Table of retailers with forecasted vs actual orders, Color-coded utilization: Green <80%, Yellow 80-100%, Orange 100-120%, Red >120%, Forecast accuracy trend chart (last 30 days): Line chart showing predicted vs actual variance, Retailer ranking by accuracy (best/worst forecasters)
**And** Forecast accuracy calculation: For each retailer: variance = abs(forecasted - actual) / forecasted * 100, Accuracy score = 100 - avg(variance) over last 30 days

**Edge Cases:**
- No forecast set for retailer → No alerts triggered, capacity page shows "N/A"
- Forecast = 0 → Treat as "no forecast", don't calculate utilization
- Alert fatigue (multiple alerts per day) → Group by retailer, send digest once per day
- SMS rate limit exceeded → Fallback to email only

---

### Story 5.7: Build Audit Log Viewer with Search and Filters

As an operations manager,
I want to search and filter audit logs to troubleshoot operational issues,
So that I can investigate what happened and when.

**Acceptance Criteria:**

**Given** Audit logs exist from Epic 1 Story 1.6
**When** I navigate to /audit-logs (admin or operations_manager only)
**Then** An audit log viewer displays with: Table columns: Timestamp (sortable), User (full name + role), Action (e.g., "SCAN_ORDER", "CREATE_USER"), Resource (type + ID link), Details (expandable JSON), IP Address
**And** Default sort: By timestamp descending (newest first)
**And** Search and filter toolbar: Date range picker (default: last 7 days), User dropdown (all users in operator), Action type dropdown (all action types), Resource type dropdown (order, manifest, user, etc.), Search input (searches resource ID, action details), "Export CSV" button
**And** Table pagination: 50 logs per page, Virtual scrolling if >500 logs
**And** Clicking resource ID opens detail: For orders → Order detail page, For manifests → Manifest summary, For users → User profile
**And** Expandable details row: Click row to expand, Shows full changes_json in formatted view, Before/after comparison for UPDATE actions, Syntax highlighting for JSON
**And** Real-time updates: New audit entries appear at top with highlight, Badge shows "X new logs" with refresh button
**And** Export CSV includes: All visible columns, Current filters applied, Date range in filename: "audit-logs-2026-02-07.csv"

**Edge Cases:**
- >10,000 logs in date range → Server-side pagination required, show warning: "Large date range. Consider narrowing filters."
- changes_json is huge (>100KB) → Truncate display, show "View Full JSON" button that opens modal
- Search no results → Show empty state: "No logs match search criteria"
- Non-admin user → Only see logs for actions they performed (filtered by user_id automatically)

---

### Story 5.8: Set Up Platform Health Monitoring Dashboard (Aureon DevOps)

As an Aureon DevOps engineer,
I want a platform health monitoring dashboard showing uptime, performance, and customer usage across all operators,
So that I can proactively identify issues and scale resources.

**Acceptance Criteria:**

**Given** I am logged in with an Aureon DevOps account (special role)
**When** I navigate to /devops/platform-health
**Then** Platform health dashboard displays: System status overview: Vercel (frontend) status: ✅ Up / 🔴 Down, Railway (backend) status: ✅ Up / 🔴 Down, Supabase (database) status: ✅ Up / 🔴 Down, n8n (workflows) status: ✅ Up / 🔴 Down, BetterStack uptime: 99.97% (last 30 days)
**And** Performance metrics section: API response times: Line chart (last 24 hours), p50, p95, p99 percentiles, Current: p95 = 287ms (green if <500ms, yellow if 500ms-1s, red if >1s), Error rate: Percentage of failed requests (last 24 hours), Current: 0.3% (green if <1%, yellow if 1-5%, red if >5%), Database connections: Current connections / max connections, Current: 47/100 (yellow if >80%, red if >90%), CPU & Memory: Railway backend CPU usage, Vercel Edge function invocations
**And** Customer usage analytics table: Columns: Operator Name, Active Users (last 7 days), Total Orders (month), API Calls (last 24h), Subscription Tier, Usage vs. Limit
**And** Sort by any column (default: by API calls descending)
**And** Alerts configuration section: Current alert rules displayed, "Add Alert" button opens modal to create new alert, Example: "API p95 > 1s for 5 minutes → Email devops@aureon.com"
**And** Infrastructure scaling controls: Button: "Add Database Replica", Button: "Scale API Servers" (shows current count + add/remove), Button: "Invalidate CDN Cache"

**Technical Requirements:**
- Integrate with Vercel Analytics API
- Integrate with Railway Metrics API
- Integrate with Supabase Dashboard API
- Integrate with BetterStack API

**Edge Cases:**
- External service API unavailable → Show last cached value with "Data stale" indicator
- Alert rule triggers → Send email + log to audit_logs
- Scaling action fails → Show error toast with rollback option

---

### Story 5.9: Configure Supabase Realtime for Live Order Updates

As an operations manager,
I want order status changes to appear instantly on my dashboard without refreshing,
So that I always see the current state without manual reloads.

**Acceptance Criteria:**

**Given** Supabase Realtime is enabled on the orders and manifests tables
**When** An order status changes (via any source: API, manual update, background job)
**Then** Supabase broadcasts the change to all subscribed clients via WebSocket
**And** Frontend subscribes to realtime channel on /operations-control page load: Channel: `operator:[operator_id]:orders`, Listen for: INSERT, UPDATE, DELETE events on orders table
**And** On INSERT event (new order): Toast notification: "New order received: #[order_number]", Order appears at top of list with highlight animation, Pipeline count increments (+1 in "Ingresado" card), Play subtle notification sound (if enabled)
**And** On UPDATE event (status change): Affected order row updates in-place (no full page reload), Pipeline counts adjust (decrement old status, increment new status), If status changes to urgent → Show alert toast: "Order #12345 now URGENT", If order is currently filtered out → Remove from view (smooth fade out)
**And** On DELETE event (order cancelled/deleted): Order row fades out and removes from list, Pipeline count decrements, Toast: "Order #[order_number] cancelled"
**And** Realtime connection status indicator: Green dot in header when connected, Red dot with "Disconnected" when WebSocket drops, Auto-reconnect attempts with exponential backoff
**And** Fallback: If Realtime disconnects for >30s, fall back to TanStack Query polling (every 30s)

**Technical Requirements:**
- Use Supabase Realtime JavaScript client
- Subscribe on component mount, unsubscribe on unmount
- Handle reconnection logic
- Debounce rapid updates (max 1 update per second per order)

**Edge Cases:**
- Realtime quota exceeded (free tier limit) → Fall back to polling permanently, show warning
- Mass update (100+ orders at once) → Batch UI updates, show summary toast: "100 orders updated"
- User on different tab → Queue updates, apply when tab becomes active
- WebSocket blocked by firewall → Graceful fallback to HTTP polling

---

## Epic 3A: Dashboard Data Pipeline & Onboarding Readiness

**Added:** 2026-03-03 (Course Correction — Epic 3 Retrospective finding: dashboard has no live data, Beetrack missing, data pipeline gap)
**Updated:** 2026-03-04 (Course Correction — Easy WMS webhook as Story 3A.7, Dashboard pipeline tabs as Story 3A.8)

Operations managers can see real, live data on the Aureon dashboard. The pipeline from external systems (DispatchTrack, Easy WMS) to the `delivery_attempts` and `orders`/`packages` tables is fully operational. Transportes Musan can onboard and use the platform with their real data. The Tractis brand is applied throughout.

**FR Coverage:** FR8, FR10 (webhook ingestion), FR47 (fallback), FR5 (SLA metrics with real data)

---

### Story 3A.1: Populate delivery_attempts from DispatchTrack Order Status

As an operations manager at Transportes Musan,
I want the system to automatically sync delivery attempt status from DispatchTrack into the delivery_attempts table,
So that the dashboard metrics reflect real delivery outcomes.

*(Full story in implementation-artifacts — status: review)*

---

### Story 3A.2: End-to-End Data Pipeline Validation and Metrics Calculation

As an operations manager,
I want to verify that orders flow correctly from ingestion through to dashboard metrics,
So that the numbers on the dashboard are accurate and trustworthy.

*(Full story in implementation-artifacts — status: ready-for-dev)*

---

### Story 3A.3: Tractis Branding on Auth Pages

As a platform user,
I want the login and auth pages to display Tractis branding,
So that the product feels professional and on-brand.

*(Completed — PRs #39, #42, #43, #45 merged)*

---

### Story 3A.4: Customer Branding Configuration on Dashboard

As an operations manager,
I want to see my operator's branding (logo, colors) on the dashboard,
So that the platform feels like it belongs to my company.

*(Completed — PR #49 + follow-ups #51, #54 merged)*

---

### Story 3A.5: User Onboarding Verification

As a new user at Transportes Musan,
I want to be able to create my account and access the platform without manual SQL setup,
So that onboarding is self-service and repeatable.

*(In progress)*

---

### Story 3A.6: Operational Alerting — n8n Failures and Cookie Expiry

As an operations manager,
I want to receive alerts when n8n workflows fail or Beetrack session cookies expire,
So that data ingestion issues are caught before they affect the dashboard.

*(Backlog)*

---

### Story 3A.7: Implement Easy WMS Webhook Receiver

**Added:** 2026-03-04 (Course Correction — Easy WMS stakeholder meeting with Cencosud)

As an operations manager at Transportes Musan,
I want the system to automatically receive and process order dispatches pushed by Easy WMS via webhook,
So that orders and packages are ingested in real-time with full carton-level detail as soon as Easy dispatches a load.

**Acceptance Criteria:**

**Given** the n8n webhook endpoint is active and Easy WMS is configured with our URL and API key
**When** Easy WMS sends a POST request to `https://n8n.tractis.ai/webhook/easy-wms` with header `Token: <api_key>`
**Then** n8n validates the `Token` header against the configured API key
**And** returns HTTP 200 immediately upon receiving the request
**And** for each `despacho` in the `despachos[]` array:
  - Upserts one row in `orders` using `(operator_id, order_number)` conflict key where `order_number = entrega`
  - Maps: `entrega → order_number`, `id_carga → external_load_id`, `fecha_compromiso → delivery_date`, `direccion → delivery_address`, `comuna → comuna`, `cliente_nombre → customer_name`, `cliente_telefono → customer_phone`
  - Stores full despacho JSON in `raw_data`, sets `imported_via = 'API'`, links `tenant_client_id` to Easy WMS webhook client
  - For each item in `despacho.items[]`, upserts one row in `packages`: `carton → label`, `bultos → declared_box_count`, `{sku, descripcion, cantidad, codigo_barra, mt3} → sku_items[]`
**And** a job record is created tracking `orders_upserted` and `packages_upserted` counts
**And** the raw webhook payload is stored to Supabase Storage: `raw-files/{operator_slug}/easy-webhook/{date}/carga-{id_carga}-{timestamp}.json`
**When** the `Token` header is missing or invalid → HTTP 401

**Edge Cases:**
- Duplicate `entrega` (resend/reprint event) → UPSERT — no duplicate created
- Empty `despachos[]` → HTTP 200, job recorded with 0 counts
- `items[]` empty for a despacho → upsert order only, no packages
- Supabase failure → log to Sentry, return HTTP 200 (avoid retry storm), job marked failed
- `fecha_compromiso` missing → fall back to `fecha_carga`

**Technical Requirements:**
- n8n workflow: Webhook node (Header Auth: `Token`) → validate → iterate despachos → upsert orders → iterate items → upsert packages → store raw payload → log job
- Staging URL: `https://n8n.tractis.ai/webhook-test/easy-wms` (share with Cencosud for testing)
- Production URL: `https://n8n.tractis.ai/webhook/easy-wms`
- New `tenant_clients` row: `slug = 'easy-webhook'`, `connector_type = 'api'`
- VPS env vars: `EASY_WMS_WEBHOOK_API_KEY` (staging), rotated for production after validation
- Workflow exported: `apps/worker/n8n/workflows/easy-wms-webhook.json`
- Fallback: `easy-csv-import` workflow stays active — populates orders + packages via `Cartón` column when webhook is unavailable

**Webhook payload reference:**
```json
{
  "evento": "impresion por numero de carga",
  "despachos": [{
    "entrega": "2916909648",
    "suborden": "23379215",
    "numero_guia": "27233378",
    "id_carga": "CARGACL30038696",
    "cd_origen": "E599",
    "tipo_guia": "despacho",
    "fecha_guia": "2026-03-04",
    "fecha_carga": "2026-03-04",
    "fecha_compromiso": "2026-03-07",
    "direccion": "PASAJE TIACA 1730 0",
    "comuna": "RANCAGUA",
    "cliente_rut": "18926544-1",
    "cliente_nombre": "FELIPE MATUS",
    "cliente_telefono": "982-058174",
    "cliente_correo": "felipe.ignaciom@gmail.com",
    "latitud": "",
    "longitud": "",
    "url_guia": "http://cencosud.paperless.cl:80/...",
    "items": [{
      "descripcion": "ESCRITORIO MADAGASCAR 43X121X76 BLANCO",
      "sku": "1285269",
      "mt3": "395.428",
      "cantidad": "1",
      "codigo_barra": "2082004256070",
      "carton": "LPNCL0003305047",
      "bultos": "1.00"
    }]
  }]
}
```

### Story 3A.8: Dashboard Pipeline Navigation & Loading Metrics Tab

**Added:** 2026-03-04 (Course Correction — dashboard restructure for pipeline visibility)

As an operations manager at Transportes Musan,
I want the dashboard restructured as a pipeline view with tabs for each operational stage, starting with a Loading Data tab showing order/package ingestion metrics,
So that I can understand what data came into the system and what deliveries are committed per day.

**Scope:**
- Pipeline tab navigation (7 tabs, 2 active: Overview + Loading)
- Desktop tabs / mobile dropdown (responsive, no horizontal scroll)
- Loading tab: date filter bar, 5 KPI cards, 2 charts (daily orders by client, committed orders), 2 breakdown tables (by client, by comuna)
- 5 Supabase RPC functions, 9 TanStack Query hooks
- URL state via `?tab=` query param

*(Completed — PR #61 merged 2026-03-04)*

---

## Epic 6: DispatchTrack Route Intelligence (Backlog)

**Status:** backlog — needs full story breakdown by SM agent

**Rationale:** The DispatchTrack (Beetrack) webhook sends a callback for EVERY status change in the delivery lifecycle — not just terminal states. We currently skip all non-terminal updates (En bodega, En reparto, En camino, Reagendado, etc.) and only store the final outcome in `delivery_attempts`. This means we're discarding ~90% of the operational data the webhook provides.

**Key Insight:** The webhook is a real-time feed of the entire last-mile operation. Capturing every event unlocks route tracking, driver performance, SLA timing analysis, and proactive alerting.

**High-Level Scope:**
- **Route Events Table** — append-only table capturing every webhook status change (no upsert, no skip). Fields: order_id, status_code, status_label, timestamp, driver_id, GPS lat/lng, raw payload JSONB.
- **State Machine Validation** — define valid state transitions, detect anomalies (e.g. order going backwards in pipeline).
- **Route Timeline API** — query full history of an order's journey for the Operations Control Center (Epic 5).
- **Driver Performance Metrics** — time-in-transit, stops per route, delivery speed by zone.
- **Proactive Alerting** — detect stuck orders (no status change in X hours), failed delivery patterns in real-time.
- **Backfill from XLSX** — optionally parse historical XLSX exports to populate route events retroactively.

**Dependencies:** Epic 3A (webhook infrastructure), Epic 5 (Operations Control Center consumes this data).

**Note:** `delivery_attempts` table remains for final outcome reporting (FADR, SLA). Route events is a separate, richer data layer.
