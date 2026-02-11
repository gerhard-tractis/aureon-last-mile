# ADR-006: Railway Backend Deployment Deferral Strategy

**Status:** Accepted
**Date:** 2026-02-11
**Decision Makers:** Development Team, Technical Lead
**Related Stories:** Story 1.1 (Task 5), Story 2.3 (Email Parsing)

---

## Context

Story 1.1 includes Task 5: "Deploy to Railway (Backend)" which encompasses:
- Railway project setup with GitHub integration
- Redis deployment for caching and job queues
- n8n workflow automation for email parsing
- Backend API infrastructure

During Story 1.1 implementation, we evaluated whether Railway backend deployment should be completed immediately or deferred to a later phase.

### Current Architecture (Story 1.1)
- **Frontend:** Vercel (Next.js 15 App Router)
- **Database/Auth:** Supabase (PostgreSQL with RLS + Auth)
- **Storage:** Supabase Storage
- **Realtime:** Supabase Realtime (WebSocket subscriptions)

### Railway Backend Would Add
- **n8n:** Workflow automation server for email parsing webhooks
- **Redis:** In-memory cache and job queue
- **Custom API:** Node.js/Express backend (if needed)
- **Cost:** ~$5-10/month Railway hosting + n8n instance

---

## Decision

**We will defer Railway backend deployment (Task 5) until the start of Epic 2, to be completed before Story 2.3.**

### Trigger Point
Complete Task 5 when creating Story 2.1 (Epic 2: Order Ingestion begins).

---

## Rationale

### Why Defer (Stories 1.1-1.7 do not require Railway)

**✅ Epic 1 Stories Can Use Supabase Directly:**

| Story | Backend Needs | Solution |
|-------|---------------|----------|
| 1.1 - Template Skeleton | None | Supabase Auth + Database ✅ |
| 1.2 - Multi-Tenant Schema | Database RLS | Supabase PostgreSQL ✅ |
| 1.3 - Role-Based Auth | Authentication | Supabase Auth (5 roles) ✅ |
| 1.4 - User Management UI | CRUD operations | Supabase client SDK ✅ |
| 1.5 - PWA Enhancement | Offline storage | IndexedDB + Background Sync ✅ |
| 1.6 - Audit Logging | Database writes | Supabase RLS + triggers ✅ |
| 1.7 - CI/CD Pipeline | Build/deploy | GitHub Actions + Vercel ✅ |
| 1.8 - Monitoring | Error tracking | Sentry + Vercel Analytics ✅ |

**Key Insight:** None of Epic 1's 8 stories require custom backend infrastructure.

### When Railway Becomes Critical (Epic 2+)

**🔴 Critical Blocker:**
- **Story 2.3:** "Implement email manifest parsing n8n workflow"
  - **Requirement:** n8n server to receive webhook from email provider
  - **Requirement:** Workflow automation for parsing email attachments
  - **Cannot proceed without Railway** ❌

**🟡 Performance Optimization:**
- **Story 3.8:** "Set up TanStack Query caching for dashboard performance"
  - Redis improves cache layer beyond in-memory/localStorage
  - Can initially use React Query's default cache
  - Railway Redis is beneficial but not blocking ⚠️

**🟢 Future Enhancement:**
- **Epic 4+:** Background job processing, complex workflows
  - Redis for offline sync queue processing
  - Custom API for external integrations
  - Railway beneficial but workarounds exist 💡

### Cost-Benefit Analysis

**Benefits of Deferring:**
1. **Reduced Complexity:** Focus on core platform foundation first
2. **Cost Savings:** Avoid $5-10/month Railway costs for 4-6 weeks
3. **Incremental Architecture:** Deploy infrastructure only when needed
4. **Faster MVP:** Ship Epic 1 without backend dependency
5. **Clear Trigger:** n8n requirement is unambiguous blocker

**Risks of Deferring:**
1. **Context Switching:** Will need to revisit deployment mid-Epic 2
2. **Integration Work:** Need to connect frontend to new backend later
3. **Testing Overhead:** Additional integration testing when Railway added

**Mitigation:**
- Document clear trigger point (Story 2.3)
- Include Railway setup in Epic 2 planning
- Estimate 4-6 hours for Task 5 completion

---

## Consequences

### Positive
✅ **Faster Story 1.1 Completion:** Shipped production-ready MVP without backend dependency
✅ **Cost Optimization:** Saved ~$30-40 in hosting costs during Epic 1 development
✅ **Cleaner Architecture:** Supabase-first approach validated for simple CRUD operations
✅ **Incremental Complexity:** Team learns Supabase deeply before adding backend layer

### Negative
⚠️ **Epic 2 Dependency:** Must complete Task 5 before Story 2.3 (risk of delay)
⚠️ **Rework Risk:** If Supabase proves insufficient, may need earlier Railway deployment
⚠️ **Documentation Debt:** Must maintain clarity on when Railway is needed

### Neutral
🔵 **Architectural Flexibility:** Can deploy Railway incrementally (n8n first, Redis later if needed)
🔵 **Technology Evaluation:** More time to evaluate Railway alternatives (Render, Fly.io, Cloud Run)

---

## Implementation Plan

### Epic 1 (Current - Stories 1.1-1.8)
- ✅ Use Supabase for all backend operations
- ✅ Document Railway deferral in Story 1.1
- ✅ Create ADR-006 (this document)
- ✅ Update Epic 2 planning to include Railway setup

### Epic 2 (Order Ingestion - Before Story 2.3)
- 📋 Complete Task 5.1: Create Railway project
- 📋 Complete Task 5.2: Deploy Redis for caching
- 📋 Complete Task 5.3: Deploy n8n for email parsing
- 📋 Complete Task 5.4: Configure environment variables
- 📋 Test n8n webhook integration with email provider
- 📋 Update frontend to connect to Railway backend (if needed)

### Epic 3+ (Future)
- Use Redis for dashboard caching (Story 3.8)
- Expand Railway services as needed for job queues
- Consider custom API routes if Supabase Edge Functions insufficient

---

## Alternatives Considered

### Alternative 1: Deploy Railway Immediately
**Pros:** Infrastructure ready, no mid-Epic context switch
**Cons:** Unnecessary cost ($30-40 Epic 1), added complexity, unused services
**Verdict:** ❌ Rejected - Premature optimization

### Alternative 2: Use Supabase Edge Functions Instead of Railway
**Pros:** Stay within Supabase ecosystem, simpler architecture
**Cons:** n8n cannot run in Edge Functions (needs persistent server), limited Redis equivalent
**Verdict:** ❌ Rejected - Technical limitation (n8n requirement)

### Alternative 3: Deploy n8n Only (Skip Redis Initially)
**Pros:** Minimal Railway cost (~$5/mo), addresses Story 2.3 blocker
**Cons:** Still requires Railway, Redis needed soon after for caching
**Verdict:** 🤔 Possible - Could deploy n8n in Epic 2, add Redis in Epic 3

### Alternative 4: Use Third-Party Email Parsing Service (e.g., Zapier, Make)
**Pros:** No Railway needed, managed service
**Cons:** Monthly SaaS cost, less control over parsing logic, vendor lock-in
**Verdict:** ❌ Rejected - n8n self-hosted preferred for flexibility

---

## Review and Update

This decision should be reviewed at:
- **Epic 2 Planning:** Confirm Railway still needed for Story 2.3
- **Story 2.1 Start:** Begin Task 5 implementation
- **Post-Epic 2:** Evaluate if Redis is actually needed or if in-memory cache suffices

---

## References

- **Story 1.1 File:** `_bmad-output/implementation-artifacts/1-1-clone-and-deploy-razikus-template-skeleton.md`
- **Epic 2 File:** `_bmad-output/planning-artifacts/epics.md` (Epic 2: Order Ingestion)
- **Architecture Doc:** `_bmad-output/planning-artifacts/architecture.md` (Backend Strategy)
- **Railway Pricing:** https://railway.app/pricing (Hobby plan: $5/month + usage)
- **n8n Hosting:** https://docs.n8n.io/hosting/ (Self-hosting requirements)

---

## Decision Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-02-11 | Initial decision: Defer to Epic 2 | Supabase sufficient for Epic 1 |
| TBD | Review at Epic 2 planning | Confirm n8n requirement |

---

**Approved By:** Development Team
**Next Review:** Epic 2 Planning Session
**Status:** ✅ **ACCEPTED** - Railway deployment deferred to Epic 2 start
