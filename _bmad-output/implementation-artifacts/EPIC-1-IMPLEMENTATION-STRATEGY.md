# Epic 1: Implementation Strategy & Dependency Map

**Epic:** 1 - Platform Foundation & Multi-Tenant SaaS Setup
**Status:** 7/8 stories ready-for-dev, 1 in review
**Created:** 2026-02-16
**Purpose:** Guide parallel implementation by documenting story dependencies and optimal execution order

---

## 📊 Story Status Overview

| Story | Status | Can Start? | Blocks | Blocked By |
|-------|--------|------------|--------|------------|
| 1.1 - Template Skeleton | ✅ **done** | ✅ Complete | 1.5, 1.7 | None |
| 1.2 - Multi-Tenant RLS | ✅ **done** | ✅ Complete | 1.6 | None |
| 1.3 - RBAC (5 roles) | 🔍 **review** | ⏳ In review | 1.4, 1.6 | None |
| 1.4 - User Management UI | 📋 ready-for-dev | ❌ Wait for 1.3 | 1.6 | **1.3** |
| 1.5 - PWA Enhancement | 📋 ready-for-dev | ✅ **START NOW** | None | 1.1 ✅ |
| 1.6 - Audit Logging | 📋 ready-for-dev | ❌ Wait for 1.4 | None | **1.3, 1.4** |
| 1.7 - CI/CD Pipeline | 📋 ready-for-dev | ✅ **START NOW** | 1.8 | 1.1 ✅ |
| 1.8 - Monitoring & Alerting | 📋 ready-for-dev | ❌ Wait for 1.7 | None | **1.7** |

---

## 🔀 Dependency Graph (Visual)

```
┌─────────────────────────────────────────────────────────────┐
│                    EPIC 1 DEPENDENCY MAP                     │
└─────────────────────────────────────────────────────────────┘

Story 1.1 (Template) ✅ DONE
    ├──────────────────┬──────────────────┐
    ↓                  ↓                  ↓
Story 1.2          Story 1.5          Story 1.7
(RLS Policies)     (PWA)              (CI/CD)
✅ DONE            📋 READY           📋 READY
    ↓              ✅ CAN START       ✅ CAN START
    ↓              (Independent)      (Independent)
Story 1.3                                 ↓
(RBAC)                               Story 1.8
🔍 IN REVIEW                         (Monitoring)
    ├──────────────┐                 📋 READY
    ↓              ↓                 ❌ BLOCKED
Story 1.4      Story 1.6                 ↑
(User Mgmt)    (Audit Log)               │
📋 READY       📋 READY              (Needs 1.7
❌ BLOCKED     ❌ BLOCKED              deployed)
    ↓              ↑
    └──────────────┘
```

---

## ✅ Stories That Can Be Implemented in Parallel

### **Phase 1: START IMMEDIATELY (While waiting for 1.3 review)**

**Parallel Group A - Independent Stories:**

- **Story 1.7 (CI/CD Pipeline)** 🚀 **RECOMMENDED FIRST**
  - **Dependencies:** None (just needs codebase from 1.1 ✅)
  - **Why start here:** Automates testing/deployment for ALL remaining stories
  - **Estimated effort:** 4-6 hours
  - **Deliverables:**
    - `.github/workflows/ci.yml` (quality gates)
    - `.github/workflows/deploy.yml` (production deployment)
    - Branch protection rules
    - Build status badges

- **Story 1.5 (PWA Enhancement Layer)**
  - **Dependencies:** None (just needs Next.js app from 1.1 ✅)
  - **Why independent:** Pure frontend enhancement, doesn't touch auth/users
  - **Estimated effort:** 6-8 hours
  - **Deliverables:**
    - Serwist service worker configuration
    - IndexedDB schema (Dexie.js)
    - Background sync implementation
    - Offline status banner

**Can these run in true parallel?**
✅ **YES** - No file conflicts, completely independent areas of codebase

---

### **Phase 2: AFTER Story 1.3 Review Completes**

**Sequential - User Management Chain:**

- **Story 1.4 (User Management UI)** ⚠️ **BLOCKED until 1.3 done**
  - **Dependencies:** Story 1.3 (needs users table, role ENUM, JWT claims)
  - **Why blocked:** Can't build user management UI without users table
  - **Estimated effort:** 8-10 hours
  - **Deliverables:**
    - Admin user management page
    - User creation/editing forms
    - API endpoints for CRUD operations
    - TanStack Query hooks

---

### **Phase 3: AFTER Story 1.4 Completes**

**Sequential - Audit Logging:**

- **Story 1.6 (Audit Logging Infrastructure)** ⚠️ **BLOCKED until 1.4 done**
  - **Dependencies:**
    - Story 1.2 ✅ (operators table, RLS policies)
    - Story 1.3 🔍 (users table, auth.uid())
    - Story 1.4 📋 (user management actions to log)
  - **Why blocked:** Audit triggers need users table to exist
  - **Estimated effort:** 6-8 hours
  - **Deliverables:**
    - audit_logs table with RLS
    - Database triggers for automatic logging
    - Admin audit log viewer UI
    - 7-year retention policy (partitioning)

---

### **Phase 4: AFTER Story 1.7 Deploys to Production**

**Sequential - Monitoring:**

- **Story 1.8 (Monitoring & Alerting)** ⚠️ **BLOCKED until 1.7 deployed**
  - **Dependencies:** Story 1.7 (needs deployed app to monitor)
  - **Why blocked:** Can't monitor uptime/errors without production deployment
  - **Estimated effort:** 4-6 hours
  - **Deliverables:**
    - Sentry error tracking (frontend + backend)
    - BetterStack uptime monitoring
    - Health check endpoint
    - Alert rules and notification channels

---

## 🎯 Recommended Implementation Order

### **OPTION A: Maximum Parallelism (Fastest - 3 weeks)**

**Week 1 - Start NOW (don't wait for 1.3 review):**
```
Day 1-2: Story 1.7 (CI/CD Pipeline) 🚀 PRIORITY
         ├─ Creates quality gates
         ├─ Automates deployments
         └─ Enables continuous integration for remaining stories

Day 3-4: Story 1.5 (PWA Enhancement)
         ├─ Independent work
         ├─ Can run in parallel with 1.7
         └─ Adds offline capability

Day 5:   Testing, documentation, wait for 1.3 review
```

**Week 2 - After Story 1.3 completes review:**
```
Day 1-3: Story 1.4 (User Management UI)
         ├─ Unblocked by 1.3 completion
         ├─ Builds admin interface
         └─ Validates RBAC patterns

Day 4-5: Story 1.6 (Audit Logging)
         ├─ Unblocked by 1.4 completion
         ├─ Implements tamper-proof logging
         └─ Compliance-ready (7-year retention)
```

**Week 3 - After deployment:**
```
Day 1-2: Story 1.8 (Monitoring & Alerting)
         ├─ Unblocked by 1.7 production deployment
         ├─ Sentry error tracking
         └─ BetterStack uptime monitoring

Day 3:   Epic 1 final testing + retrospective
```

**Total Duration: ~3 weeks**
**Parallel Efficiency: 2 stories done while waiting for 1.3 review**

---

### **OPTION B: Sequential (Safer, Learn-as-you-go - 3-4 weeks)**

**Week 1:**
```
Story 1.7 (CI/CD) → Get automation working first
  ↓
Story 1.5 (PWA) → Independent enhancement
```

**Week 2:**
```
Wait for Story 1.3 review ⏳
  ↓
Story 1.4 (User Management) → Once 1.3 approved
```

**Week 3:**
```
Story 1.6 (Audit Logging) → After 1.4 done
  ↓
Story 1.8 (Monitoring) → After 1.7 deployed
```

**Total Duration: ~3-4 weeks**
**Risk Level: Lower (learn from each story before next)**

---

## 📋 Critical Path Analysis

**What's blocking Epic 1 completion?**

```
CRITICAL PATH (longest dependency chain):

Story 1.3 Review 🔍 (BOTTLENECK - currently blocking)
    ↓ (estimated: 1-2 days)
Story 1.4 Implementation 📋 (8-10 hours)
    ↓
Story 1.6 Implementation 📋 (6-8 hours)
    ↓
Epic 1 Complete ✅

PARALLEL PATH (can run independently):

Story 1.7 Implementation 📋 (4-6 hours)
    ↓
Production Deployment
    ↓
Story 1.8 Implementation 📋 (4-6 hours)
    ↓
Epic 1 Complete ✅
```

**Optimization Strategy:**
- ✅ Start Story 1.7 + 1.5 NOW (don't wait for critical path)
- ✅ Reduces total time by ~2-3 days
- ✅ Productive use of wait time during 1.3 review

---

## ⚠️ Dependency Details (Why Each Story is Blocked)

### **Story 1.4 blocked by Story 1.3**
**Reason:** User Management UI needs:
- ✅ `users` table schema (created in 1.3)
- ✅ `role` ENUM type (created in 1.3)
- ✅ JWT custom claims (configured in 1.3)
- ✅ Database trigger for auto-user creation (created in 1.3)

**Can't implement:** Form validation, API endpoints, role assignment without these

---

### **Story 1.6 blocked by Stories 1.3 + 1.4**
**Reason:** Audit Logging needs:
- ✅ `users` table to attach triggers (created in 1.3)
- ✅ `auth.uid()` function to capture user_id (created in 1.3)
- ✅ User management actions to log (created in 1.4)
  - Example: CREATE_USER, UPDATE_USER_ROLE, DELETE_USER

**Can't implement:** Audit triggers on non-existent tables

---

### **Story 1.8 blocked by Story 1.7**
**Reason:** Monitoring needs:
- ✅ Production deployment to monitor (created by 1.7)
- ✅ Public URL for uptime checks (created by 1.7)
- ✅ CI/CD pipeline for error context (created by 1.7)

**Can't implement:** BetterStack uptime monitoring without deployed app

---

## 🚀 Quick Start Guide for Dev Agent

**When starting implementation, check this decision tree:**

```
START HERE:
    ↓
Is Story 1.3 review complete? ─── NO ──→ Start Story 1.7 or 1.5
    ↓                                    (Both independent, can run now)
   YES
    ↓
Implement Story 1.4 (User Management)
    ↓
Implement Story 1.6 (Audit Logging)
    ↓
Is Story 1.7 deployed to production? ─── NO ──→ Deploy it first
    ↓
   YES
    ↓
Implement Story 1.8 (Monitoring)
    ↓
Epic 1 Complete! 🎉
```

---

## 📊 Effort Estimates Summary

| Story | Estimated Hours | Complexity | Risk |
|-------|----------------|------------|------|
| 1.5 - PWA | 6-8 hours | Medium | Low (independent) |
| 1.7 - CI/CD | 4-6 hours | Low | Low (well-documented) |
| 1.4 - User Mgmt | 8-10 hours | Medium | Medium (depends on 1.3) |
| 1.6 - Audit Log | 6-8 hours | High | Medium (complex triggers) |
| 1.8 - Monitoring | 4-6 hours | Low | Low (SaaS integration) |

**Total Epic 1 Remaining:** 28-38 hours (~4-5 full work days)

---

## 💡 Tips for Dev Agent

1. **Start with Story 1.7 (CI/CD) FIRST** 🚀
   - Gets automation in place for all remaining stories
   - Fast win (4-6 hours)
   - High leverage (benefits all future work)

2. **Run Story 1.5 (PWA) in parallel with 1.7 if desired**
   - Completely independent codebases
   - No merge conflicts expected

3. **Don't start Story 1.4 until 1.3 review completes**
   - Will fail without users table
   - Better to wait than rework

4. **Implement 1.6 immediately after 1.4**
   - While user management patterns are fresh in mind
   - Audit triggers will log user management actions

5. **Save Story 1.8 (Monitoring) for last**
   - Needs production deployment to be meaningful
   - Good "victory lap" story to end Epic 1

---

## 🎯 Success Criteria for Epic 1 Completion

**Epic 1 is DONE when:**

- ✅ All 8 stories moved to `done` status
- ✅ All acceptance criteria verified
- ✅ CI/CD pipeline passing (green checkmarks)
- ✅ Production deployment successful
- ✅ Monitoring active (Sentry + BetterStack)
- ✅ Documentation updated (README, runbooks)
- ✅ Epic 1 retrospective completed

**Then and only then:** Begin Epic 2 story preparation! 🎉

---

## 📝 Notes for Future Epic Planning

**Learnings from Epic 1 dependency analysis:**

1. **Foundation stories should come first** (RLS, Auth, Users)
2. **Infrastructure stories can run in parallel** (CI/CD, PWA)
3. **Monitoring requires deployment** (always last in epic)
4. **Audit logging requires data models** (mid-epic placement)

**Apply these patterns to Epic 2-5 planning!**

---

*Last Updated: 2026-02-16*
*Created by: BMAD Scrum Master Agent*
*For: Epic 1 Implementation Planning*
