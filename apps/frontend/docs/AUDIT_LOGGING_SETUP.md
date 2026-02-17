# Audit Logging Infrastructure Setup Guide

**Story 1.6: Set Up Audit Logging Infrastructure**
**Status:** Implemented with manual configuration steps required

---

## Overview

This document provides setup instructions for the audit logging infrastructure, including:
- Database triggers for automatic logging
- 7-year retention policy (Chilean compliance FR79-FR82)
- IP address capture
- Cron job scheduling for archival

---

## Database Migrations

### Applied Migrations

1. **20260217000001_enhance_audit_logging_with_triggers_and_partitioning.sql**
   - Creates audit trigger function
   - Attaches triggers to `users`, `orders`, `manifests` tables
   - Adds 4 performance indexes
   - Creates retention management functions (not scheduled)

2. **20260217000002_fix_audit_logging_critical_issues.sql** (Code Review Fixes)
   - Creates `set_config()` function for IP capture
   - Creates RLS policy idempotently
   - Adds timestamp-only index for platform queries
   - Creates `audit_trigger_failures` table for error tracking
   - Improves trigger error handling

### Apply Migrations

```bash
cd apps/frontend
npx supabase db push
```

### Verify Setup

Run the validation function to confirm all components are installed:

```sql
SELECT * FROM public.validate_audit_logging();
```

Expected output:
```
test_name                         | status | details
----------------------------------+--------+------------------
Trigger Function Exists           | PASS   | audit_trigger_func found
Users Trigger Attached            | PASS   | users_audit_trigger attached
Orders Trigger Attached           | PASS   | orders_audit_trigger attached
Manifests Trigger Attached        | PASS   | manifests_audit_trigger attached
Index: operator_id_timestamp      | PASS   | Index exists
Index: operator_user_timestamp    | PASS   | Index exists
Index: resource                   | PASS   | Index exists
Index: action                     | PASS   | Index exists
Audit Logging Validation          | COMPLETE | All structural tests passed
```

---

## 7-Year Retention Policy

### Current Implementation Status

**⚠️ IMPORTANT: Table partitioning is NOT yet implemented**

The migration prepares partitioning functions but **defers actual partitioning** to avoid data migration complexity. The current implementation:

- ✅ Retention functions exist: `archive_old_audit_logs()`
- ✅ Partition creation function exists: `create_audit_logs_partition()`
- ❌ Table is NOT partitioned yet
- ❌ Cron jobs are NOT scheduled yet

### Retention Strategy

**Phase 1 (0-2 years): Active Storage**
- All audit logs stored in PostgreSQL
- Full index coverage for fast queries
- Query time: <200ms for filtered queries

**Phase 2 (2-5 years): Warm Archive**
- Logs remain in PostgreSQL
- Partitioned by month (when implemented)
- Indexed for compliance investigations

**Phase 3 (5-7 years): Cold Archive**
- Export to S3 as encrypted CSV (requires implementation)
- Delete from local PostgreSQL
- Retrieval: Manual S3 download

**After 7 years:**
- Logs permanently deleted (compliance with Chilean law)

---

## Manual Setup Steps Required

### 1. Schedule Cron Jobs (REQUIRED)

The archival function exists but is **NOT scheduled automatically**. You must manually configure cron jobs via Supabase Dashboard:

#### Supabase Dashboard Steps:

1. Log into Supabase Dashboard
2. Navigate to: **Database → Cron Jobs**
3. Click **New Cron Job**
4. Configure archival job:
   - **Name:** `archive_old_audit_logs`
   - **Schedule:** `0 2 * * *` (daily at 2:00 AM UTC)
   - **Command:** `SELECT public.archive_old_audit_logs();`
   - **Active:** Enabled

#### Alternative: Direct SQL

```sql
-- Schedule archival to run daily at 2:00 AM
SELECT cron.schedule(
  'archive_old_audit_logs',
  '0 2 * * *',
  'SELECT public.archive_old_audit_logs();'
);

-- Verify cron job was created
SELECT * FROM cron.job WHERE jobname = 'archive_old_audit_logs';
```

### 2. Implement Table Partitioning (OPTIONAL but RECOMMENDED)

For production deployments with high log volume, implement table partitioning:

#### Why Partitioning?

- Faster archival (drop partition vs DELETE)
- Better query performance on time-based queries
- Easier backup/restore of old data

#### Partitioning Migration (Separate Migration Required)

Create a new migration `YYYYMMDD_implement_audit_logs_partitioning.sql`:

```sql
-- 1. Create new partitioned table
CREATE TABLE public.audit_logs_partitioned (
  LIKE public.audit_logs INCLUDING ALL
) PARTITION BY RANGE (timestamp);

-- 2. Create initial partitions (last 12 months)
DO $$
DECLARE
  partition_date DATE;
  partition_name TEXT;
BEGIN
  FOR i IN 0..11 LOOP
    partition_date := DATE_TRUNC('month', CURRENT_DATE - (i || ' months')::INTERVAL);
    partition_name := 'audit_logs_' || TO_CHAR(partition_date, 'YYYY_MM');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs_partitioned
       FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      partition_date,
      partition_date + INTERVAL '1 month'
    );
  END LOOP;
END $$;

-- 3. Migrate existing data (during maintenance window)
INSERT INTO public.audit_logs_partitioned
SELECT * FROM public.audit_logs;

-- 4. Rename tables
ALTER TABLE public.audit_logs RENAME TO audit_logs_old;
ALTER TABLE public.audit_logs_partitioned RENAME TO audit_logs;

-- 5. Recreate triggers on new table
DROP TRIGGER IF EXISTS users_audit_trigger ON public.users;
CREATE TRIGGER users_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_trigger_func();

-- Repeat for orders and manifests...

-- 6. Update partition creation cron job
SELECT cron.schedule(
  'create_audit_logs_partition',
  '0 1 1 * *', -- First day of month at 1:00 AM
  'SELECT public.create_audit_logs_partition(CURRENT_DATE + INTERVAL ''1 month'');'
);
```

### 3. Configure S3 Export (OPTIONAL)

For Phase 3 cold archive, configure S3 export:

1. Install `pg_s3` extension (if available in Supabase)
2. Configure AWS credentials in Supabase secrets
3. Update `archive_old_audit_logs()` function to export to S3 before deletion

---

## IP Address Capture

### How It Works

1. **API Route Level:** IP addresses are captured at each API route using:
   ```typescript
   import { getClientIpAddress, setSupabaseSessionIp } from '@/lib/utils/ipAddress';

   const ipAddress = getClientIpAddress(request);
   await setSupabaseSessionIp(supabase, ipAddress);
   ```

2. **Session Variable:** The IP is stored in PostgreSQL session variable `app.request_ip`

3. **Trigger Access:** The audit trigger reads the session variable when logging

### Verified Implementation

✅ API routes updated:
- `src/app/api/audit-logs/route.ts` - Captures IP
- `src/app/api/audit-logs/export/route.ts` - Captures IP

⚠️ Other API routes need updates:
- Any route that modifies `users`, `orders`, or `manifests` should call `setSupabaseSessionIp()`

### Adding IP Capture to New API Routes

```typescript
// Example: src/app/api/users/route.ts
import { createSSRClient } from '@/lib/supabase/server';
import { getClientIpAddress, setSupabaseSessionIp } from '@/lib/utils/ipAddress';

export async function POST(request: NextRequest) {
  const supabase = await createSSRClient();

  // IMPORTANT: Set IP address BEFORE any database operations
  const ipAddress = getClientIpAddress(request);
  await setSupabaseSessionIp(supabase, ipAddress);

  // Now perform database operations - triggers will log the IP
  const { data } = await supabase.from('users').insert({ ... });

  return NextResponse.json(data);
}
```

---

## Testing

### Run Tests

```bash
# Unit tests (triggers, RLS, API)
npm test audit-trigger.test.ts
npm test audit-rls.test.ts
npm test audit-api.test.ts

# Performance tests (requires database with test data)
npm test audit-performance.test.ts

# E2E tests (requires Playwright)
npx playwright test audit-e2e.spec.ts
```

### Manual Testing Checklist

- [ ] Create a user → Verify audit log created with action='INSERT_users'
- [ ] Update user role → Verify changes_json shows before/after
- [ ] Soft delete user → Verify audit log created
- [ ] Query as different operator → Verify RLS blocks cross-operator access
- [ ] Navigate to `/admin/audit-logs` as admin → Verify UI loads
- [ ] Filter by date range → Verify results update
- [ ] Export CSV → Verify file downloads
- [ ] Check IP address in audit log → Verify real IP (not 'unknown')

---

## Monitoring & Troubleshooting

### Check Trigger Failures

```sql
SELECT * FROM public.audit_trigger_failures
ORDER BY timestamp DESC
LIMIT 20;
```

### Verify Indexes Are Being Used

```sql
EXPLAIN ANALYZE
SELECT * FROM audit_logs
WHERE operator_id = 'YOUR_OPERATOR_ID'
  AND timestamp >= NOW() - INTERVAL '30 days'
ORDER BY timestamp DESC
LIMIT 50;
```

Look for: `Index Scan using idx_audit_logs_operator_id_timestamp`

### Check Audit Log Volume

```sql
-- Total audit logs
SELECT COUNT(*) FROM audit_logs;

-- Audit logs per operator
SELECT operator_id, COUNT(*) as log_count
FROM audit_logs
GROUP BY operator_id
ORDER BY log_count DESC;

-- Audit logs by age
SELECT
  DATE_TRUNC('month', timestamp) as month,
  COUNT(*) as log_count
FROM audit_logs
GROUP BY month
ORDER BY month DESC;
```

### Performance Benchmarks

Target performance metrics (with 100K+ logs):

- Date range query (last 7 days): <200ms
- User activity lookup: <200ms
- Resource change history: <200ms
- Action type filter: <200ms
- Full-text search: <500ms
- Trigger overhead per INSERT: <10ms

---

## Known Limitations

### Current Limitations (As of Story 1.6 Completion)

1. **Table Not Partitioned:**
   - Partitioning functions exist but table is not partitioned yet
   - Manual migration required for production (see section above)

2. **Cron Jobs Not Scheduled:**
   - Archival function exists but not scheduled
   - Manual setup via Supabase Dashboard required

3. **S3 Export Not Implemented:**
   - Cold archive (5-7 years) currently only deletes locally
   - S3 export implementation pending

4. **CSV Streaming Not Implemented:**
   - Export endpoint loads entire result set into memory
   - 10K limit prevents memory issues but not ideal for large exports

5. **Rate Limiting Not Implemented:**
   - Export endpoint lacks rate limiting
   - Should implement 100 req/min per user (architecture requirement)

### Future Enhancements

- [ ] Implement table partitioning in production
- [ ] Add S3 export for cold archive
- [ ] Implement CSV streaming for large exports
- [ ] Add rate limiting to export endpoint
- [ ] Create dashboard for audit log analytics
- [ ] Add alerting for trigger failures

---

## Support

For questions or issues:
1. Check trigger failures: `SELECT * FROM audit_trigger_failures;`
2. Validate setup: `SELECT * FROM validate_audit_logging();`
3. Review migration logs in Supabase Dashboard
4. Contact platform team with error details

---

**Last Updated:** 2026-02-17
**Story:** 1.6 - Set Up Audit Logging Infrastructure
**Status:** ✅ Core implementation complete, ⚠️ manual setup steps required
