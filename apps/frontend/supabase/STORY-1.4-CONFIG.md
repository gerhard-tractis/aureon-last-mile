# Story 1.4 Configuration Guide

This document outlines the configuration required for the User Management Interface to function properly.

## Prerequisites

✅ Story 1.3 must be complete (RBAC, users table, Auth Hook)
✅ Supabase project configured with service role key

---

## Required Environment Variables

### 1. Service Role Key Configuration

The User Management API uses `supabase.auth.admin.createUser()` which requires Supabase **Service Role Key** (not the public anon key).

**⚠️ CRITICAL:** The service role key bypasses RLS and should NEVER be exposed to the client.

### Setup Instructions:

#### Local Development (`.env.local`):

```env
# Supabase Service Role Key (from Supabase Dashboard > Settings > API)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...your-service-role-key
```

#### Production (Vercel Environment Variables):

1. Go to Vercel Project Settings > Environment Variables
2. Add new variable:
   - **Name:** `SUPABASE_SERVICE_ROLE_KEY`
   - **Value:** Your service role key from Supabase Dashboard
   - **Environments:** Production, Preview (optional)
3. Redeploy the application

---

## Where to Find the Service Role Key

1. Open Supabase Dashboard: https://wfwlcpnkkxxzdvhvvsxb.supabase.co
2. Navigate to **Settings** (left sidebar, bottom)
3. Click **API** tab
4. Scroll to **Project API keys** section
5. Copy the **service_role** key (starts with `eyJhbGciOiJIUzI1NiI...`)

**⚠️ Security Warning:**
- NEVER commit this key to git
- NEVER expose it in client-side code
- NEVER share it publicly
- Rotate immediately if exposed

---

## Verification

### Test User Creation API:

```bash
# 1. Get auth token (login as admin user first)
# 2. Test POST /api/users endpoint
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION_COOKIE" \
  -d '{
    "email": "test@example.com",
    "full_name": "Test User",
    "role": "pickup_crew",
    "operator_id": "YOUR_OPERATOR_ID"
  }'
```

**Expected Response:**
```json
{
  "id": "uuid",
  "email": "test@example.com",
  "full_name": "Test User",
  "role": "pickup_crew",
  "operator_id": "uuid",
  "created_at": "2026-02-16T...",
  "deleted_at": null
}
```

**If you see this error:**
```json
{
  "code": "AUTH_ERROR",
  "message": "Failed to create user",
  "details": "Invalid API key"
}
```

**Solution:** Your service role key is not configured or incorrect.

---

## How It Works

The Next.js route handler (`apps/frontend/src/app/api/users/route.ts`) uses:

```typescript
const supabase = createRouteHandlerClient({ cookies });

// This requires service role key in environment
const { data: authUser, error } = await supabase.auth.admin.createUser({
  email,
  email_confirm: false,
  app_metadata: { operator_id, role },
  user_metadata: { full_name }
});
```

The `createRouteHandlerClient` automatically uses the service role key when calling `auth.admin.*` methods if `SUPABASE_SERVICE_ROLE_KEY` is set in the environment.

---

## Rate Limiting Configuration

The API includes in-memory rate limiting:

**Default Limits:**
- **Window:** 60 seconds
- **Max Requests:** 10 user creations per minute per admin

**To Adjust:**
Edit `apps/frontend/src/app/api/users/route.ts`:

```typescript
const RATE_LIMIT_WINDOW = 60000; // milliseconds
const RATE_LIMIT_MAX_REQUESTS = 10; // requests
```

**Production Recommendation:**
Replace in-memory rate limiter with Redis-based solution for multi-instance deployments.

---

## Troubleshooting

### Issue: "User created but could not fetch details"

**Cause:** Database trigger `handle_new_user()` is slow or failing

**Solution:**
1. Check Supabase logs for trigger errors
2. Verify trigger exists: `SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created'`
3. Ensure `handle_new_user()` function is working

The API now includes retry logic (3 attempts, 100ms delay) to handle this race condition.

---

### Issue: "Cannot create users for a different operator"

**Cause:** Operator ID validation is enforced

**Solution:**
Ensure the `operator_id` in the request body matches the admin's `operator_id` from their JWT claims.

---

### Issue: "Too many user creation requests"

**Cause:** Rate limit exceeded (10 users/minute)

**Solution:**
- Wait 60 seconds and try again
- Increase rate limit if bulk onboarding is required
- Use bulk import feature (Story 2.2) for large batches

---

## Deployment Checklist

- [ ] Service role key added to environment variables
- [ ] Story 1.3 migration applied to production database
- [ ] Auth Hook enabled in production Supabase project
- [ ] Test user creation in production environment
- [ ] Verify soft delete functionality
- [ ] Verify role-based access control (non-admin cannot create users)
- [ ] Verify last admin protection (cannot delete/change last admin)

---

**✅ Configuration Complete**

Once the service role key is configured, the User Management Interface is fully operational.
