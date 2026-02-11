# Deployment Guide

## Manual Deployment with Vercel CLI

### Prerequisites
- Vercel CLI installed globally: `npm install -g vercel`
- Authenticated: `vercel login`
- Project linked: `vercel link`

### Deployment Commands

**Preview Deployment (for testing):**
```bash
cd apps/frontend
vercel
```
- Creates preview URL (e.g., `aureon-last-mile-abc123.vercel.app`)
- Does NOT affect production
- Good for testing changes before production deploy

**Production Deployment:**
```bash
cd apps/frontend
vercel --prod
```
- Deploys to production domain (`aureon-last-mile.vercel.app`)
- Updates live site
- Triggers Sentry source map upload

**Check Deployment Status:**
```bash
vercel ls
# Lists recent deployments

vercel inspect [deployment-url]
# Shows detailed deployment info
```

### Deployment Checklist

Before deploying to production:
1. ✅ All tests passing: `npm test`
2. ✅ Build succeeds: `npm run build`
3. ✅ TypeScript clean: `npx tsc --noEmit`
4. ✅ ESLint passing: `npm run lint`
5. ✅ Environment variables set in Vercel dashboard
6. ✅ CI/CD checks passing on GitHub

### Rollback

If you need to rollback to a previous deployment:

```bash
# List deployments
vercel ls

# Promote a previous deployment to production
vercel promote [deployment-url]
```

### Cost Control Strategy

**Why Manual Deployment?**
- Auto-deploy: ~80 deploys/month = 💸💸💸
- Manual deploy: ~8 deploys/month = 💰
- Savings: ~90% reduction in deployment costs

**When to Deploy:**
- After completing a story
- After code review
- For critical bug fixes
- When testing new features (use preview first!)

### Disable Auto-Deploy

To prevent automatic deployments from GitHub:

1. Go to: Vercel Dashboard → Project → Settings → Git
2. **Option A:** Set Production Branch to `(none)`
3. **Option B:** Add Ignored Build Step: `git diff HEAD^ HEAD --quiet`
4. **Option C (Recommended):** Disconnect Git integration entirely

### Environment Variables

Environment variables are managed in Vercel dashboard:
- Settings → Environment Variables
- Changes require redeployment to take effect

After adding/changing env vars:
```bash
cd apps/frontend
vercel --prod  # Redeploy with new env vars
```

### Monitoring Deployments

After deployment, verify:
1. ✅ Deployment successful (check Vercel dashboard)
2. ✅ Site loads: https://aureon-last-mile.vercel.app/
3. ✅ Health check: https://aureon-last-mile.vercel.app/api/health
4. ✅ Sentry release created: https://sentry.io/organizations/tractis/projects/aureon-last-mile/
5. ✅ No errors in Sentry dashboard

### Troubleshooting

**Build fails:**
- Check build logs in Vercel dashboard
- Run `npm run build` locally first
- Verify environment variables are set

**Sentry source maps not uploading:**
- Check SENTRY_AUTH_TOKEN is set in Vercel
- Verify SENTRY_ORG and SENTRY_PROJECT are correct
- Check build logs for Sentry errors

**Environment variables not working:**
- Remember to redeploy after changing env vars
- Check variable is set for correct environment (Production/Preview/Development)
- Verify sensitive variables are marked as "Sensitive"

### CI/CD Integration

Our strategy:
- ✅ **CI (Continuous Integration):** GitHub Actions runs on every push (FREE)
- ✅ **CD (Continuous Deployment):** Manual via Vercel CLI (COST CONTROL)

GitHub Actions validates:
- TypeScript compilation
- ESLint checks
- All tests (72 tests, 75.78% coverage)
- Production build

You deploy manually when ready.

### Quick Reference

```bash
# Common workflow
npm test                    # Run tests
npm run build               # Test build
vercel                      # Deploy to preview
# Test preview URL
vercel --prod               # Deploy to production

# Emergency rollback
vercel ls                   # Find previous deployment
vercel promote [url]        # Rollback to it
```

---

**Cost-Conscious Deployment = Happy Wallet** 💰
