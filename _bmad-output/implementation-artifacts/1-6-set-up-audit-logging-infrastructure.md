# Story 1.6: Set Up Audit Logging Infrastructure

**Epic:** 1 - Platform Foundation & Multi-Tenant SaaS Setup
**Status:** ready-for-dev
**Story ID:** 1.6
**Story Key:** 1-6-set-up-audit-logging-infrastructure

---

## Story

As an **admin user**,
I want **all data access and modifications logged with user, operator, timestamp, and action details**,
So that **I can investigate security incidents and comply with Chilean 7-year retention law (FR79-FR82)**.

---

## Business Context

This story establishes the **audit trail foundation** for compliance and security:

**Critical Success Factors:**
- **7-year retention compliance**: Chilean commercial law (FR79-FR82) requires 7-year audit trail for delivery disputes
- **Tamper-proof logging**: Database triggers capture ALL changes (even direct SQL), cannot be bypassed
- **Security investigations**: Admins track "who did what when" for incident response
- **Immutable records**: Audit logs are append-only (no updates/deletes permitted)

**Business Impact:**
- Enables legal compliance with Chilean regulations (avoid fines/penalties)
- Supports dispute resolution: "Prove this order was delivered to correct address 2 years ago"
- Prevents insider threats: All admin actions logged (role changes, user deletions)
- Audit trails required for SOC 2 certification (future enterprise customers)

**Dependency Context:**
- **Blocks**: Story 5.7 (Audit Log Viewer with search/filters) - UI depends on schema
- **Depends on**: Story 1.2 (RLS policies), Story 1.3 (roles, JWT), Story 1.4 (user management)

---

## Acceptance Criteria

### Given
- ✅ Story 1.2 is COMPLETE (operators table, RLS policies, auth.operator_id())
- ✅ Story 1.3 is COMPLETE (users table, role ENUM, JWT custom claims)
- ✅ Story 1.4 is COMPLETE (user management actions to log)

### When
- I create the audit_logs table and database triggers

### Then
- ✅ **Audit logs table exists** with fields:
  - `id` (UUID PRIMARY KEY, auto-generated)
  - `operator_id` (UUID NOT NULL, multi-tenant isolation)
  - `user_id` (UUID NOT NULL, who performed action)
  - `action` (VARCHAR(50) NOT NULL, e.g., 'CREATE_USER', 'SCAN_ORDER')
  - `resource_type` (VARCHAR(50), e.g., 'user', 'order', 'manifest')
  - `resource_id` (UUID nullable, ID of modified resource)
  - `changes_json` (JSONB nullable, before/after state, max 10KB)
  - `ip_address` (VARCHAR(50), request source IP)
  - `timestamp` (TIMESTAMP DEFAULT NOW())
- ✅ **RLS enabled**: Users can ONLY query audit logs for their own operator_id
- ✅ **Database triggers** automatically log:
  - INSERT operations on: users, orders, manifests tables
  - UPDATE operations on: users, orders, manifests tables
  - DELETE operations on: users, orders, manifests tables (soft deletes)
- ✅ **Admin audit log viewer** accessible at `/admin/audit-logs` (admin role only):
  - Display columns: Timestamp, User (full name + role), Action, Resource (type + ID), Details (expandable JSON), IP Address
  - Default sort: Timestamp DESC (newest first)
  - Search/Filter toolbar: Date range (default 7 days), User dropdown, Action dropdown, Resource type dropdown
  - Pagination: 50 logs/page with virtual scrolling
  - Export CSV button
- ✅ **7-year retention policy** configured (partitioned table by month, automated archival)

### Edge Cases Handled
- ❌ **Trigger fails to create audit log** → Original operation succeeds, log error to Sentry (fail-open to prevent blocking business operations)
- ❌ **changes_json exceeds 10KB** → Truncate with `{truncated: true}` indicator
- ❌ **IP address header missing** → Store as "unknown"
- ❌ **Querying >100K audit logs** → Pagination required (100 records/page max)
- ❌ **Immutability enforcement** → GRANT INSERT only on audit_logs, REVOKE UPDATE/DELETE (except service role)

---

## Tasks / Subtasks

### Task 1: Create Audit Logs Table with RLS (AC: Table exists, RLS enabled)
- [ ] **1.1** Create migration file `202602XX_create_audit_logs_table.sql`
- [ ] **1.2** Define audit_logs table schema
  - All fields as specified in AC (id, operator_id, user_id, action, resource_type, resource_id, changes_json, ip_address, timestamp)
  - Primary key: id (UUID, auto-generated)
  - Foreign keys: operator_id → operators(id), user_id → users(id)
- [ ] **1.3** Enable RLS on audit_logs
  - `ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;`
- [ ] **1.4** Create RLS policy for operator isolation
  - Policy: `audit_logs_operator_isolation` FOR ALL
  - USING: `operator_id = auth.operator_id()`
  - Admins can ONLY see audit logs from their operator
- [ ] **1.5** Add performance indexes
  - idx_audit_logs_operator_id_timestamp: (operator_id, timestamp DESC) - Primary query pattern
  - idx_audit_logs_operator_user_timestamp: (operator_id, user_id, timestamp DESC) - User activity lookup
  - idx_audit_logs_resource: (operator_id, resource_type, resource_id) - Resource change history
  - idx_audit_logs_action: (operator_id, action, timestamp DESC) - Action type filtering

### Task 2: Implement Database Triggers for Automatic Logging (AC: Triggers log all operations)
- [ ] **2.1** Create audit trigger function `audit_trigger_func()`
  - Captures INSERT, UPDATE, DELETE operations
  - Builds changes_json: `{before: OLD, after: NEW}`
  - Truncates changes_json if >10KB
  - Extracts operator_id from auth.operator_id()
  - Extracts user_id from auth.uid()
  - Reads IP address from session variable `app.request_ip`
- [ ] **2.2** Attach trigger to users table
  - `CREATE TRIGGER users_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON users`
- [ ] **2.3** Attach trigger to orders table (when created in Epic 2)
  - `CREATE TRIGGER orders_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON orders`
- [ ] **2.4** Attach trigger to manifests table (when created in Epic 4)
  - `CREATE TRIGGER manifests_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON manifests`
- [ ] **2.5** Test trigger capture
  - INSERT user → verify audit log created with action='INSERT_users'
  - UPDATE user role → verify changes_json shows before/after
  - DELETE user (soft delete) → verify audit log created with action='DELETE_users'

### Task 3: Configure 7-Year Retention Policy (AC: Retention policy configured)
- [ ] **3.1** Convert audit_logs to partitioned table (by month)
  - Use PARTITION BY RANGE (timestamp)
  - Create initial 12 monthly partitions
- [ ] **3.2** Create automated partition creation function
  - Runs monthly via Supabase Cron
  - Creates new partition for upcoming month
- [ ] **3.3** Create archival function `archive_old_audit_logs()`
  - Exports partitions >5 years old to S3 as encrypted CSV
  - Deletes local partitions >7 years old
  - Scheduled via Supabase Cron (daily at 2am)
- [ ] **3.4** Document retention policy
  - Phase 1 (0-2 years): Active storage in PostgreSQL
  - Phase 2 (2-5 years): Warm archive (partitioned, indexed)
  - Phase 3 (5-7 years): Cold archive (S3, encrypted CSV)

### Task 4: Create Admin Audit Log Viewer UI (AC: Admin audit log viewer)
- [ ] **4.1** Create `app/admin/audit-logs/page.tsx` (Next.js page)
  - Auth guard: Require role = 'admin'
  - Redirect non-admins to `/` with toast "Unauthorized access"
- [ ] **4.2** Create `components/admin/AuditLogTable.tsx` (table component)
  - Columns: Timestamp, User, Action, Resource, Details (expandable JSON), IP Address
  - Default sort: Timestamp DESC
  - Virtual scrolling for >500 logs (react-window)
  - Click row to expand/collapse changes_json
- [ ] **4.3** Create `components/admin/AuditLogFilters.tsx` (filter toolbar)
  - Date range picker (default: last 7 days, presets: Today, Yesterday, Last 7 days, Last 30 days, Custom)
  - User dropdown: All users in operator (multi-select)
  - Action dropdown: All action types (multi-select)
  - Resource type dropdown: user, order, manifest, inventory (multi-select)
  - Search input: Searches resource_id, action, changes_json text
  - Export CSV button: Downloads filtered results as CSV
- [ ] **4.4** Implement pagination
  - 50 logs per page
  - Page numbers: 1, 2, 3, ..., Last
  - Total count displayed: "Showing 1-50 of 1,234 logs"
- [ ] **4.5** Add CSV export functionality
  - Button: "Export CSV"
  - Applies current filters to export
  - Max 10,000 logs per export (prevent timeout)
  - Filename: `audit_logs_{operator}_{date}.csv`

### Task 5: Implement API Endpoints for Audit Log Retrieval (AC: API integration)
- [ ] **5.1** Create `GET /api/audit-logs` endpoint
  - Validate JWT token (require role = 'admin')
  - RLS policy auto-filters by operator_id
  - Query parameters: date_from, date_to, user_id, action, resource_type, resource_id, search, page, limit
  - Default: Last 7 days, limit 50, page 1
  - Return: `{data: AuditLog[], total: number, page: number, limit: number}`
- [ ] **5.2** Create `GET /api/audit-logs/export` endpoint
  - Validate JWT token (require role = 'admin')
  - Apply same filters as GET /api/audit-logs
  - Stream CSV response (prevents memory overflow for large exports)
  - Max 10,000 logs per export
  - Return: CSV file download

### Task 6: Add Middleware to Capture Request Context (AC: IP address captured)
- [ ] **6.1** Create `middleware.ts` for request context
  - Extract IP address from headers: X-Forwarded-For or X-Real-IP
  - Store in Supabase session variable for trigger access
  - Set app.request_ip session variable
- [ ] **6.2** Test IP address capture
  - Make authenticated request from known IP
  - Verify audit log contains correct IP address

### Task 7: Write Tests for Audit Logging (AC: Testing)
- [ ] **7.1** Unit tests for trigger function
  - Test INSERT capture (before/after state)
  - Test UPDATE capture (changes_json has before and after)
  - Test DELETE capture (before state only)
  - Test changes_json truncation at 10KB
- [ ] **7.2** Integration tests for RLS
  - Test cross-operator query returns empty (RLS blocks)
  - Test admin from operator A cannot see logs from operator B
- [ ] **7.3** E2E tests for audit log viewer
  - Login as admin → navigate to /admin/audit-logs
  - Filter by date range → verify results match filter
  - Export CSV → verify file downloads with correct data
- [ ] **7.4** Performance tests
  - Query 100K audit logs → verify <200ms response time
  - Test index usage via EXPLAIN ANALYZE

### Task 8: Update Documentation and Sprint Status (AC: Documentation)
- [ ] **8.1** Document audit logging architecture
  - Trigger-based logging pattern
  - RLS + audit log isolation
  - 7-year retention policy (partitioning + archival)
  - Query performance optimization (4 indexes)
- [ ] **8.2** Update sprint-status.yaml
  - Update story status: `backlog` → `ready-for-dev` (at completion)
- [ ] **8.3** Verify all acceptance criteria

---

## Dev Notes

### 🏗️ Architecture Patterns

**CRITICAL: Follow trigger-based pattern for tamper-proof logging!**

#### 1. Trigger-Based Logging (RECOMMENDED for Compliance)

**Why Triggers Over Application Logging:**
- ✅ Automatic: Captures ALL database changes (including direct SQL, migrations, admin queries)
- ✅ Tamper-proof: Cannot bypass (enforced at database layer)
- ✅ Complete: No code instrumentation required (works even if app code forgets to log)
- ⚠️ Performance overhead: ~2-5% write latency (acceptable for compliance)

**Trigger Function Implementation:**
```sql
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
  v_changes JSONB;
  v_operator_id UUID;
  v_user_id UUID;
BEGIN
  -- Build changes JSON
  IF TG_OP = 'INSERT' THEN
    v_changes := jsonb_build_object('after', row_to_json(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_changes := jsonb_build_object(
      'before', row_to_json(OLD),
      'after', row_to_json(NEW)
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_changes := jsonb_build_object('before', row_to_json(OLD));
  END IF;

  -- Truncate if >10KB
  IF octet_length(v_changes::text) > 10240 THEN
    v_changes := jsonb_set(v_changes, '{truncated}', 'true'::jsonb);
  END IF;

  -- Get operator_id and user_id from session
  v_operator_id := COALESCE(auth.operator_id(), NEW.operator_id, OLD.operator_id);
  v_user_id := auth.uid();

  -- Insert audit log
  INSERT INTO audit_logs
    (operator_id, user_id, action, resource_type, resource_id, changes_json, ip_address)
  VALUES (
    v_operator_id,
    v_user_id,
    TG_OP || '_' || TG_TABLE_NAME,  -- e.g., 'UPDATE_users'
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    v_changes,
    current_setting('app.request_ip', 't')  -- From middleware
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    -- Fail-open: Log error but don't block operation
    RAISE WARNING 'Audit log failed: %', SQLERRM;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### 2. Time-Based Partitioning (7-Year Retention)

**Monthly Partitions:**
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL,
  user_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  changes_json JSONB,
  ip_address VARCHAR(50),
  timestamp TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (timestamp);

-- Create monthly partition
CREATE TABLE audit_logs_2026_02 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

**Automated Archival (Supabase Cron):**
```sql
CREATE OR REPLACE FUNCTION archive_old_audit_logs()
RETURNS void AS $$
DECLARE
  v_cutoff DATE := CURRENT_DATE - INTERVAL '5 years';
BEGIN
  -- Export to S3 before deletion (pg_s3 extension)
  -- Then delete old partitions
  DELETE FROM audit_logs WHERE timestamp < v_cutoff;
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule('archive_audit_logs', '0 2 * * *', 'SELECT archive_old_audit_logs()');
```

---

### 📂 Source Tree

**Files to Create:**
```
apps/frontend/
├── supabase/
│   └── migrations/
│       └── 202602XX_create_audit_logs_table.sql     # CREATE
├── app/
│   ├── admin/
│   │   └── audit-logs/
│   │       └── page.tsx                              # CREATE
│   └── api/
│       └── audit-logs/
│           ├── route.ts                              # CREATE - GET
│           └── export/
│               └── route.ts                          # CREATE - GET CSV
├── components/
│   └── admin/
│       ├── AuditLogTable.tsx                         # CREATE
│       └── AuditLogFilters.tsx                       # CREATE
└── middleware.ts                                     # UPDATE - Add IP capture
```

---

### 📚 References

**Architecture:**
- [Source: architecture.md - Audit Logging Pattern]
- [Postgres Audit Trigger - Wiki](https://wiki.postgresql.org/wiki/Audit_trigger)
- [Supabase Audit Logs](https://supabase.com/blog/postgres-audit)

---

## Dev Agent Record

**🚀 This story provides:**
- ✅ Trigger-based logging for tamper-proof audit trail
- ✅ 7-year retention with partitioning + archival
- ✅ Admin UI with search/filter/export
- ✅ Query performance (<200ms for 100K logs)

**Developer: Compliance-ready audit logging. Zero guessing!**
