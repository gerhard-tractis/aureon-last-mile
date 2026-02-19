# Deployment Runbook - Aureon Last Mile

**Version:** 1.1
**Last Updated:** February 19, 2026
**Owner:** Charlie (Senior Dev)
**Purpose:** Complete guide for deploying Aureon Last Mile to production environments

---

## Table of Contents

1. [GitHub Secrets Configuration](#github-secrets-configuration)
2. [Vercel Configuration](#vercel-configuration)
3. [Supabase Setup](#supabase-setup)
4. [VPS Deployment (Hostinger)](#vps-deployment-hostinger) ← Story 2.3+
5. [Railway Deployment](#railway-deployment) ← OBSOLETE (2026-02-18)
6. [Migration Workflow](#migration-workflow)
7. [Common Deployment Errors](#common-deployment-errors)
8. [Verification Checklist](#verification-checklist)

---

## GitHub Secrets Configuration

### Required Secrets

All secrets must be configured in **Settings → Secrets and variables → Actions → Repository secrets**

| Secret Name | Purpose | Where to Get It | Example Format |
|-------------|---------|-----------------|----------------|
| `SUPABASE_ACCESS_TOKEN` | Deploy migrations, manage project | Supabase Dashboard → Account → Access Tokens | `sbp_...` (starts with sbp_) |
| `VERCEL_TOKEN` | Deploy frontend to Vercel | Vercel Dashboard → Settings → Tokens | `vcp_...` (starts with vcp_) |
| `VERCEL_PROJECT_ID` | Identify Vercel project | `.vercel/project.json` → `projectId` | `prj_...` (starts with prj_) |
| `VERCEL_ORG_ID` | Identify Vercel team/org | `.vercel/project.json` → `orgId` | `team_...` (starts with team_) |
| `SENTRY_AUTH_TOKEN` | Upload source maps | Sentry → Settings → Auth Tokens | `sntryu_...` |
| `VPS_HOST` | VPS IP address for worker deploys | Hostinger dashboard → VPS details | `192.168.x.x` |
| `VPS_USER` | SSH username for VPS | Fixed value: `aureon` | `aureon` |
| `VPS_SSH_KEY` | ed25519 private key for VPS SSH | Generate locally (see VPS section) | Full file content including `-----BEGIN/END-----` |

### How to Add Secrets

```bash
# GitHub CLI method
gh secret set SUPABASE_ACCESS_TOKEN
# Paste value when prompted

# Web UI method
# 1. Go to https://github.com/gerhard-tractis/aureon-last-mile/settings/secrets/actions
# 2. Click "New repository secret"
# 3. Enter name and value
# 4. Click "Add secret"
```

### Common Secret Mistakes

❌ **DO NOT:**
- Use secret names with plural (e.g., `SUPABASE_ACCESS_TOKENS` ← wrong)
- Copy secrets with trailing spaces or newlines
- Commit secrets to `.env` files
- Share secrets via Slack or email

✅ **DO:**
- Use exact secret names as listed above
- Trim whitespace before adding
- Store secrets in password manager
- Rotate tokens every 90 days

**Lesson Learned (Epic 1):** We had a typo `SUPABASE_ACCESS_TOKENS` (plural) instead of `SUPABASE_ACCESS_TOKEN` (singular) that caused deployment to fail silently. Always double-check spelling!

---

## Vercel Configuration

### Initial Setup

1. **Link project to Vercel:**
   ```bash
   cd apps/frontend
   vercel link
   # Follow prompts to select team and project
   ```

2. **Verify `.vercel/project.json`:**
   ```json
   {
     "projectId": "prj_sTOYesUMjkSFfkFksFL2qEJ9xbks",
     "orgId": "team_VxdbIT9Y8Ob4ru9hb6FceC3F"
   }
   ```

3. **Add GitHub secrets** (see above section)

### Environment Variables

Configure in **Vercel Dashboard → Project → Settings → Environment Variables**

| Variable | Value Source | Environment | Required |
|----------|--------------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | All | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | All | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service key | Production, Preview | ✅ |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry project DSN | Production, Preview | ✅ |
| `SENTRY_DSN` | Sentry DSN (server-side) | Production, Preview | ✅ |
| `SENTRY_ORG` | Sentry organization slug | Production | ✅ |
| `SENTRY_PROJECT` | Sentry project name | Production | ✅ |
| `SENTRY_AUTH_TOKEN` | Sentry auth token | Production | ✅ |
| `NEXT_PUBLIC_VERCEL_ENV` | Auto-populated by Vercel | All | Auto |

### Build Settings

**Framework Preset:** Next.js
**Root Directory:** *Leave blank* (GitHub Actions workflow uses `working-directory: apps/frontend`)
**Build Command:** `npm run build` (default)
**Output Directory:** `.next` (default)
**Install Command:** `npm install` (default)

**⚠️ CRITICAL:** Leave Root Directory **blank** in Vercel settings. The GitHub Actions workflow already specifies `working-directory: apps/frontend`, so setting it in Vercel causes path doubling (`apps/frontend/apps/frontend`).

**Lesson Learned (Epic 1):** We set Root Directory to `apps/frontend` in Vercel, which combined with the workflow's `working-directory` caused the error: `The provided path "apps/frontend/apps/frontend" does not exist`. Leaving it blank fixed the issue.

### Deployment URLs

- **Production:** https://aureon.tractis.ai
- **Preview:** Auto-generated per PR (e.g., `aureon-pr-123.vercel.app`)
- **Development:** Local development server

---

## Supabase Setup

### Project Configuration

**Project:** `aureon-last-mile`
**Project ID:** `wfwlcpnkkxxzdvhvvsxb`
**URL:** https://wfwlcpnkkxxzdvhvvsxb.supabase.co
**Region:** US East (N. Virginia)

### Access Tokens

1. **Get Supabase Access Token:**
   - Go to https://supabase.com/dashboard/account/tokens
   - Click "Generate new token"
   - Name: `aureon-ci-cd`
   - Scopes: Select all
   - Copy token (starts with `sbp_`)

2. **Add to `.env.local`:**
   ```bash
   SUPABASE_ACCESS_TOKEN=sbp_...
   ```

3. **Add to GitHub Secrets** (see above)

### Database Connection Strings

```bash
# Direct connection (for migrations)
postgresql://postgres.[project-ref]:[password]@aws-0-us-east-1.pooler.supabase.com:5432/postgres

# Pooler connection (for application)
postgresql://postgres.[project-ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

### RLS Testing Procedure

**Before deploying any RLS policy:**

1. **Test with SQL:**
   ```sql
   -- Set session variables to simulate user context
   SET LOCAL request.jwt.claims = '{"sub": "test-user-id", "operator_id": "test-operator-id"}';

   -- Test SELECT
   SELECT * FROM users WHERE operator_id = 'test-operator-id'; -- Should work
   SELECT * FROM users WHERE operator_id = 'other-operator-id'; -- Should return empty

   -- Test INSERT
   INSERT INTO users (operator_id, ...) VALUES ('test-operator-id', ...); -- Should work
   INSERT INTO users (operator_id, ...) VALUES ('other-operator-id', ...); -- Should fail
   ```

2. **Test with Supabase Client:**
   ```typescript
   // Create test clients with different operator contexts
   const clientA = createClient(url, anonKey, {
     global: { headers: { 'x-operator-id': 'operator-a' } }
   });

   const clientB = createClient(url, anonKey, {
     global: { headers: { 'x-operator-id': 'operator-b' } }
   });

   // Verify isolation
   const { data: dataA } = await clientA.from('users').select();
   const { data: dataB } = await clientB.from('users').select();

   // dataA should only contain operator-a users
   // dataB should only contain operator-b users
   ```

3. **Verify in Test Suite:**
   ```bash
   npm run test -- __tests__/audit-rls.test.ts
   ```

---

## VPS Deployment (Hostinger)

> **Active as of Story 2.3 (2026-02-18).** n8n and automation worker run on a Hostinger KVM 2 VPS (São Paulo). See `apps/worker/README.md` for detailed setup instructions.

### VPS Specifications

| Property | Value |
|----------|-------|
| Provider | Hostinger KVM 2 |
| Location | São Paulo, Brazil |
| CPU | 2 vCPU |
| RAM | 8 GB + 4 GB swap |
| Storage | 100 GB NVMe |
| OS | Ubuntu 24.04 LTS |
| Cost | $6.99/month |

### Initial Provisioning Checklist

- [ ] Provision Hostinger KVM 2 VPS, verify billing/auto-renewal
- [ ] Generate SSH key pair: `ssh-keygen -t ed25519 -f aureon-vps-key -N "" -C "aureon-ci-cd"`
- [ ] Copy public key to VPS: `ssh-copy-id -i aureon-vps-key.pub root@<VPS_IP>`
- [ ] Clone repo on VPS as root: `git clone <repo> ~/aureon-last-mile`
- [ ] Copy `.env.example` to `/home/aureon/.env` and fill in values
- [ ] Run setup script: `bash ~/aureon-last-mile/apps/worker/scripts/setup.sh`
- [ ] Add GitHub secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`
- [ ] Navigate to `http://<VPS_IP>:5678` and create n8n owner account
- [ ] Verify Supabase connectivity (see setup.sh smoke tests)
- [ ] Create Supabase Storage bucket `raw-files` (Stories 2.5-2.6)
- [ ] Configure BetterStack: HTTP monitor on `http://<VPS_IP>:5678/healthz`
- [ ] Configure Sentry: Create `aureon-worker` project, add DSN to `.env`
- [ ] Trigger test deploy: push change to `apps/worker/`, verify GitHub Actions

### Running setup.sh

The setup script is **idempotent** — safe to re-run:

```bash
ssh root@<VPS_IP>
cd ~/aureon-last-mile
bash apps/worker/scripts/setup.sh
```

### Environment Variables Reference

| Variable | Required | Component | How to Generate |
|----------|----------|-----------|-----------------|
| `N8N_PORT` | Yes | n8n | Fixed: `5678` |
| `DB_TYPE` | Yes | n8n | Fixed: `postgresdb` |
| `DB_POSTGRESDB_PASSWORD` | Yes | n8n | `openssl rand -base64 24` |
| `SUPABASE_URL` | Yes | n8n + Worker | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | n8n + Worker | Supabase Dashboard → Settings → API |
| `SUPABASE_DB_HOST` | Yes | n8n PostgreSQL node | Supabase Dashboard → Database → Connection string |
| `SUPABASE_DB_PASSWORD` | Yes | n8n PostgreSQL node | Supabase Dashboard → Database → Settings |
| `NODE_ENV` | Yes | Worker | Fixed: `production` |
| `ENCRYPTION_KEY` | Yes | Worker (Story 2.4+) | `openssl rand -hex 32` |
| `SENTRY_DSN` | Yes | Worker | Sentry → aureon-worker → Client Keys |
| `GROQ_API_KEY` | Story 2.6 | Worker | console.groq.com |

### Service Management

```bash
# Status
sudo systemctl status n8n
sudo systemctl status aureon-worker

# Logs (live)
sudo journalctl -u n8n -f
sudo journalctl -u aureon-worker -f

# Restart
sudo systemctl restart n8n
sudo systemctl restart aureon-worker
```

### Deployment

**Automatic:** Push any change to `apps/worker/**` on `main` → triggers `deploy-worker.yml`.

**Manual:**
```bash
ssh aureon@<VPS_HOST>
bash ~/aureon-last-mile/apps/worker/scripts/deploy.sh
```

### SSH Key Rotation

```bash
# 1. Generate new key
ssh-keygen -t ed25519 -f aureon-vps-key-new -N "" -C "aureon-ci-cd-$(date +%Y%m)"

# 2. Add new key to VPS
ssh aureon@<VPS_HOST> "echo '$(cat aureon-vps-key-new.pub)' >> ~/.ssh/authorized_keys"

# 3. Test new key
ssh -i aureon-vps-key-new aureon@<VPS_HOST> "echo OK"

# 4. Update GitHub secret VPS_SSH_KEY with new private key content

# 5. Verify CI deploys successfully

# 6. Remove old key from VPS
ssh -i aureon-vps-key-new aureon@<VPS_HOST> "sed -i '/aureon-ci-cd$/d' ~/.ssh/authorized_keys"
```

### Rollback

```bash
# Option 1: Revert commit (triggers redeploy via CI)
git revert <commit-sha> && git push

# Option 2: SSH and checkout specific version
ssh aureon@<VPS_HOST>
cd ~/aureon-last-mile
git checkout <commit-sha>
bash apps/worker/scripts/deploy.sh
```

### Troubleshooting

| Issue | Debug Steps |
|-------|------------|
| n8n won't start | `journalctl -u n8n -n 50` → check `.env` exists, Node.js at `/usr/bin/node`, DB creds |
| Worker won't start | `journalctl -u aureon-worker -n 50` → check `dist/index.js` exists (`npm run build`) |
| Supabase unreachable | Test: `curl -sf "$SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"` |
| Disk full | `df -h` → `journalctl --vacuum-size=500M` |
| Memory pressure | `free -h` → ensure only 1 Chromium session at a time (Story 2.6) |

### Monitoring

- **BetterStack:** HTTP monitor `http://<VPS_IP>:5678/healthz` (n8n health endpoint)
- **Sentry:** Worker errors via `SENTRY_DSN` in `.env`

---

## Railway Deployment

> **OBSOLETE (2026-02-18):** n8n moved to Hostinger VPS. See [VPS Deployment (Hostinger)](#vps-deployment-hostinger) section above. This section is preserved for historical reference only.

**Required for:** Story 2.3+ (n8n email manifest parsing)
**Service:** n8n workflow automation

### Initial Setup

1. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   railway login
   ```

2. **Create Railway Project:**
   ```bash
   railway init
   # Name: aureon-n8n
   # Select team: Tractis
   ```

3. **Get Railway Token:**
   - Go to https://railway.app/account/tokens
   - Click "Create Token"
   - Name: `aureon-ci-cd`
   - Copy token
   - Add to GitHub Secrets as `RAILWAY_TOKEN`

### n8n Configuration

**Dockerfile Location:** `apps/backend/n8n/Dockerfile`

```dockerfile
FROM n8nio/n8n:latest

# Install custom nodes if needed
# RUN npm install -g n8n-nodes-supabase

EXPOSE 5678

CMD ["n8n", "start"]
```

**Environment Variables (Railway Dashboard):**

| Variable | Value | Purpose |
|----------|-------|---------|
| `N8N_BASIC_AUTH_ACTIVE` | `true` | Enable auth |
| `N8N_BASIC_AUTH_USER` | `admin` | Admin username |
| `N8N_BASIC_AUTH_PASSWORD` | `<secure-password>` | Admin password |
| `SUPABASE_URL` | `https://wfwlcpnkkxxzdvhvvsxb.supabase.co` | Connect to DB |
| `SUPABASE_SERVICE_KEY` | `<service-role-key>` | Write permissions |
| `WEBHOOK_URL` | `https://aureon.tractis.ai/api/webhooks/n8n` | Callback URL |

### Deploy to Railway

```bash
# Deploy from local
cd apps/backend/n8n
railway up

# Or use GitHub Actions workflow (apps/backend/n8n/deploy.yml)
# Triggers on push to main
```

### Railway CI/CD Workflow

Create `.github/workflows/deploy-railway.yml`:

```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]
    paths:
      - 'apps/backend/n8n/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy to Railway
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: |
          cd apps/backend/n8n
          railway up --service n8n
```

---

## Migration Workflow

### Pre-Migration Checklist

- [ ] Backup database before migration
- [ ] Test migration locally first
- [ ] Review migration SQL for errors
- [ ] Ensure RLS policies are correct
- [ ] Verify foreign key constraints
- [ ] Check for naming conflicts

### Creating a Migration

```bash
# 1. Create migration file
supabase migration new <descriptive_name>

# Example:
supabase migration new create_orders_table

# 2. Edit migration file
# Location: supabase/migrations/YYYYMMDDHHMMSS_<descriptive_name>.sql
```

### Migration Naming Convention

**Format:** `YYYYMMDDHHMMSS_descriptive_name.sql`

**Examples:**
- ✅ `20260217_create_orders_table.sql`
- ✅ `20260217_add_rls_policy_orders.sql`
- ✅ `20260217_add_operator_id_to_users.sql`
- ❌ `migration.sql` (too vague)
- ❌ `fix.sql` (not descriptive)

### Running Migrations Locally

```bash
# 1. Start local Supabase
supabase start

# 2. Apply migrations
supabase db push

# 3. Verify migration
supabase db diff

# 4. Reset database (if needed)
supabase db reset
```

### Deploying Migrations to Production

**GitHub Actions automatically runs migrations on merge to main.**

**Manual deployment (if needed):**
```bash
# Link to remote project
supabase link --project-ref wfwlcpnkkxxzdvhvvsxb

# Push migrations
supabase db push

# Verify
supabase db remote list
```

### Migration Rollback

**⚠️ WARNING:** Supabase migrations are forward-only by default. Plan rollbacks carefully.

**Rollback Steps:**

1. **Create rollback migration:**
   ```bash
   supabase migration new rollback_<original_name>
   ```

2. **Write inverse SQL:**
   ```sql
   -- Example: Rollback create_orders_table
   DROP TABLE IF EXISTS orders CASCADE;
   DROP POLICY IF EXISTS "orders_tenant_isolation" ON orders;
   DROP INDEX IF EXISTS idx_orders_operator_id;
   ```

3. **Test locally:**
   ```bash
   supabase db reset  # Start fresh
   supabase db push   # Apply all migrations including rollback
   ```

4. **Deploy rollback:**
   ```bash
   git add supabase/migrations/
   git commit -m "fix: Rollback orders table migration"
   git push
   ```

### Handling Migration Conflicts

**Problem:** Remote database has migrations not in local directory

**Solution:**

1. **List remote migrations:**
   ```bash
   supabase db remote list
   ```

2. **Pull remote migrations:**
   ```bash
   supabase db pull
   ```

3. **Mark remote migration as applied:**
   ```bash
   supabase migration repair <timestamp> --status applied
   ```

4. **Or rename conflicting local migration:**
   ```bash
   mv supabase/migrations/20260209_multi_tenant_rls.sql \
      supabase/migrations/20260209_multi_tenant_rls.sql.bak
   ```

**Lesson Learned (Epic 1):** We had a migration conflict where remote had `20260209_multi_tenant_rls` but local had a different version. We renamed the local file to `.bak` and marked the remote as applied.

---

## Common Deployment Errors

### 1. Path Doubling in Vercel

**Error:**
```
The provided path "apps/frontend/apps/frontend" does not exist
```

**Cause:** Root Directory set in Vercel + `working-directory` in GitHub Actions

**Solution:** Leave Vercel Root Directory **blank**

---

### 2. GitHub Secret Not Found

**Error:**
```
Error: SUPABASE_ACCESS_TOKEN not set
```

**Cause:** Secret name typo or not added to repository

**Solution:**
1. Check spelling: `SUPABASE_ACCESS_TOKEN` (singular, not TOKENS)
2. Verify secret exists: https://github.com/gerhard-tractis/aureon-last-mile/settings/secrets/actions
3. Re-add if missing

---

### 3. Supabase Migration Conflict

**Error:**
```
Remote migration versions not found in local migrations directory
```

**Cause:** Remote database has migrations not in your local folder

**Solution:**
```bash
# Option 1: Pull remote migrations
supabase db pull

# Option 2: Mark remote as applied
supabase migration repair <timestamp> --status applied

# Option 3: Rename conflicting local migration
mv supabase/migrations/<file>.sql supabase/migrations/<file>.sql.bak
```

---

### 4. Vercel Build Fails - Module Not Found

**Error:**
```
Module not found: Can't resolve '@/lib/...'
```

**Cause:** Path alias not configured or file doesn't exist

**Solution:**
1. Check `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@/*": ["./src/*"]
       }
     }
   }
   ```
2. Verify file exists at path
3. Restart Next.js dev server

---

### 5. Coverage Threshold Blocking Build

**Error:**
```
ERROR: Coverage for lines (65.49%) does not meet global threshold (70%)
```

**Cause:** Untested components pulling down coverage

**Solution:**
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      exclude: [
        'node_modules/',
        '**/*.test.ts',
        // Exclude specific untested components temporarily
        'src/components/admin/AuditLogFilters.tsx',
        'src/components/admin/AuditLogTable.tsx',
      ],
    },
  },
});
```

**Better Solution:** Write tests for the components!

---

### 6. Sentry Not Loading on Client

**Error (Browser Console):**
```
Uncaught ReferenceError: Sentry is not defined
```

**Cause:** Missing `instrumentation-client.ts` for Next.js 15

**Solution:**
```typescript
// instrumentation-client.ts (must be at app root)
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // ... config
});
```

Remove old `sentry.client.config.ts` if it exists.

---

### 7. Railway Deployment Timeout

**Error:**
```
Deployment timed out after 10 minutes
```

**Cause:** Large Docker image or slow build

**Solution:**
1. Optimize Dockerfile (multi-stage builds)
2. Use `.dockerignore`:
   ```
   node_modules
   .git
   .next
   dist
   ```
3. Increase timeout in Railway settings

---

### 8. Database Connection Pool Exhausted

**Error:**
```
Error: too many clients already
```

**Cause:** Too many concurrent connections to Supabase

**Solution:**
```typescript
// Use connection pooling
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    db: {
      schema: 'public',
    },
    auth: {
      persistSession: false, // Server-side: disable session
    },
  }
);
```

---

## Verification Checklist

### After Every Deployment

- [ ] **Frontend accessible:** https://aureon.tractis.ai loads without errors
- [ ] **Authentication works:** Can login with test user
- [ ] **Database queries work:** Can view users, operators, audit logs
- [ ] **RLS enforced:** Test cross-tenant queries return empty
- [ ] **Sentry initialized:** Check browser console for `[Sentry] Client initialized`
- [ ] **Error tracking works:** Trigger test error, verify appears in Sentry dashboard
- [ ] **Slack alerts working:** Verify error alert sent to #alertas-sentry
- [ ] **Email alerts working:** Verify alert sent to gerhard@tractis.ai
- [ ] **CI/CD passing:** All GitHub Actions workflows green
- [ ] **Migrations applied:** Verify latest migration in Supabase dashboard
- [ ] **No console errors:** Browser DevTools console clean

### Production Health Check

```bash
# Test health endpoint
curl https://aureon.tractis.ai/api/health

# Expected response:
{
  "status": "ok",
  "timestamp": "2026-02-17T20:00:00.000Z",
  "database": "connected",
  "version": "1.0.0"
}
```

### Rollback Plan

If deployment fails:

1. **Immediate:** Revert to previous Vercel deployment
   ```bash
   vercel rollback
   ```

2. **Database:** Run rollback migration (see Migration Workflow)

3. **Notify team:** Post in #dev-alerts Slack channel

4. **Investigate:** Check Sentry for errors, review GitHub Actions logs

5. **Fix forward:** Create hotfix PR, deploy when ready

---

## Emergency Contacts

| Issue | Contact | Method |
|-------|---------|--------|
| Vercel down | Vercel Support | https://vercel.com/support |
| Supabase down | Supabase Support | support@supabase.io |
| Hostinger VPS down | Hostinger Support | https://support.hostinger.com |
| Sentry down | Sentry Support | https://sentry.io/support |
| Critical production bug | Gerhard | Slack @gerhard or +56... |

---

## Changelog

### v1.1 - February 19, 2026
- Added VPS Deployment (Hostinger) section — Story 2.3
- Added `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` GitHub secrets; removed `RAILWAY_TOKEN`
- Marked Railway section as OBSOLETE (n8n moved to Hostinger VPS)
- Updated Emergency Contacts (Hostinger replaces Railway)
- Updated Table of Contents

### v1.0 - February 17, 2026
- Initial runbook created based on Epic 1 lessons learned
- Includes GitHub Secrets, Vercel, Supabase, Railway, migrations
- Documents 8 common deployment errors with solutions
- Added verification checklist and rollback procedures

---

**End of Runbook**

*This is a living document. Update it when you discover new deployment issues or solutions.*
