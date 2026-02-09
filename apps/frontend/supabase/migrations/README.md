# Supabase Migrations

## How to Apply Migrations

### Option 1: Via Supabase Dashboard (Recommended for now)

1. Go to your Supabase project dashboard:
   https://supabase.com/dashboard/project/wfwlcpnkkxxzdvhvvsxb

2. Navigate to **SQL Editor** (left sidebar)

3. Open the migration file: `20260209_multi_tenant_rls.sql`

4. Copy the entire SQL content

5. Paste into the SQL Editor

6. Click **Run** button

7. Verify success:
   - Check that tables were created
   - Verify RLS is enabled on all tables
   - Confirm seed data was inserted

### Option 2: Using Supabase CLI (For Production)

```bash
# Install Supabase CLI (Windows)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Link to your project
supabase link --project-ref wfwlcpnkkxxzdvhvvsxb

# Apply migrations
supabase db push

# Or apply specific migration
supabase migration up
```

## Migration Files

### 20260209_multi_tenant_rls.sql
**Purpose:** Multi-tenant RLS setup with operator-level isolation

**Creates:**
- `operators` table (tenants)
- `orders` table with `operator_id`
- `manifests` table with `operator_id`
- `barcode_scans` table with `operator_id`
- `audit_logs` table with `operator_id`

**Security:**
- Enables RLS on all tables
- Creates tenant isolation policies
- Adds performance indexes
- Implements JWT claim extraction (`auth.operator_id()`)

**Seed Data:**
- Demo operator: `demo-chile` (id: `00000000-0000-0000-0000-000000000001`)

## Verification Steps

After applying migration, verify RLS is working:

```sql
-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('operators', 'orders', 'manifests', 'barcode_scans', 'audit_logs');

-- Should show rowsecurity = true for all

-- Check policies exist
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public';

-- Should show tenant_isolation policies for each table
```

## Security Critical

⚠️ **NEVER disable RLS on these tables!**
⚠️ **NEVER use service_role key in client-side code!**
⚠️ **ALWAYS test cross-tenant access is blocked!**

## Next Steps After Migration

1. Configure JWT to include `operator_id` claim (see Task 3.3)
2. Test RLS isolation with multiple operators (see Task 3.4)
3. Apply migration to production when ready
